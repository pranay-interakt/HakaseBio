"""HTTP access with a content cache, polite rate limiting and honest failure.

``CachedHttp.get_json`` returns ``(status, payload, retrieved_at, from_cache, error)``.
The cache stores the original response body and retrieval time, so a value served from
cache still states when it was actually retrieved.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from hos.core.provenance import utc_now
from hos.data_sources.base import SourceStatus

_log = logging.getLogger(__name__)

__all__ = ["USER_AGENT", "CachedHttp"]

USER_AGENT = "hakase-os/0.1 (+https://hakase.ai)"

#: Minimum interval between requests per host. PubChem's usage policy asks for no more than
#: 5 requests per second; ChEMBL publishes no limit, so the same courtesy is applied.
_MIN_INTERVAL_S = {"pubchem.ncbi.nlm.nih.gov": 0.25, "www.ebi.ac.uk": 0.25}


class CachedHttp:
    def __init__(
        self,
        client: httpx.Client | None = None,
        cache_dir: Path | None = None,
        ttl: timedelta = timedelta(days=30),
        retries: int = 2,
        timeout_s: float = 30.0,
    ) -> None:
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=timeout_s, follow_redirects=True
        )
        self.cache_dir = cache_dir
        if cache_dir is not None:
            cache_dir.mkdir(parents=True, exist_ok=True)
        self.ttl = ttl
        self.retries = retries
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def _cache_path(self, url: str) -> Path | None:
        if self.cache_dir is None:
            return None
        return self.cache_dir / (hashlib.sha256(url.encode()).hexdigest() + ".json")

    def _throttle(self, url: str) -> None:
        host = urlparse(url).hostname or ""
        gap = _MIN_INTERVAL_S.get(host, 0.0)
        with self._lock:
            wait = self._last.get(host, 0.0) + gap - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last[host] = time.monotonic()

    def get_json(
        self, url: str, *, refresh: bool = False
    ) -> tuple[SourceStatus, Any | None, str | None, bool, str | None]:
        path = self._cache_path(url)
        if path is not None and path.exists() and not refresh:
            entry = json.loads(path.read_text())
            fetched = datetime.fromisoformat(entry["retrieved_at"])
            if utc_now() - fetched <= self.ttl:
                return (
                    SourceStatus(entry["status"]),
                    entry.get("payload"),
                    entry["retrieved_at"],
                    True,
                    entry.get("error"),
                )
        status, payload, err = SourceStatus.ERROR, None, None
        for attempt in range(self.retries + 1):
            self._throttle(url)
            try:
                r = self.client.get(url)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                # the exception text can carry DNS, proxy or host details of the server; the
                # client gets the failure type, the server log the detail
                _log.warning("data source request failed: %s: %s", type(exc).__name__, exc)
                status, err = SourceStatus.UNREACHABLE, f"request failed ({type(exc).__name__})"
                break
            if r.status_code == 200:
                try:
                    status, payload = SourceStatus.OK, r.json()
                except ValueError as exc:
                    status, err = SourceStatus.ERROR, f"invalid JSON: {exc}"
                break
            if r.status_code == 404:
                status, err = SourceStatus.NOT_FOUND, _fault(r)
                break
            if r.status_code in (429, 503) and attempt < self.retries:
                delay = _retry_after(r) or 2.0**attempt
                time.sleep(min(delay, 10.0))
                continue
            status = (
                SourceStatus.RATE_LIMITED if r.status_code in (429, 503) else SourceStatus.ERROR
            )
            err = f"HTTP {r.status_code}: {_fault(r)}"
            break
        retrieved = utc_now().isoformat()
        # cache definitive answers only; transient failures are retried next time
        if path is not None and status in (SourceStatus.OK, SourceStatus.NOT_FOUND):
            path.write_text(
                json.dumps(
                    {
                        "url": url,
                        "status": status.value,
                        "payload": payload,
                        "retrieved_at": retrieved,
                        "error": err,
                    }
                )
            )
        return status, payload, retrieved, False, err


def _fault(r: httpx.Response) -> str:
    try:
        d = r.json()
        if isinstance(d, dict) and "Fault" in d:
            return str(d["Fault"].get("Message", ""))
        return json.dumps(d)[:300]
    except ValueError:
        return r.text[:300]


def _retry_after(r: httpx.Response) -> float | None:
    v = r.headers.get("Retry-After")
    try:
        return float(v) if v else None
    except ValueError:
        return None


def iso_to_dt(s: str) -> datetime:
    return datetime.fromisoformat(s).astimezone(UTC)
