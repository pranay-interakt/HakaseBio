"""Request IDs, structured logs and alerts (docs/15 P2.7).

* Every request gets an ID. A well-formed ``X-Request-ID`` from the proxy is kept; anything else
  is replaced. The ID is returned in the ``X-Request-ID`` header and in every error body, so a
  user can quote it and an operator can find the request.
* With ``HOS_LOG_FORMAT=json`` (the default) the ``hos`` loggers write one JSON object per line.
  Each line carries the request ID and the signed-in principal's ID. One line per request
  records the method, the path (never the query string), the status and the duration. Headers
  and bodies are never logged, so passwords and tokens cannot reach the log.
* :func:`alert` is for events a person must act on: the audit trail failing its integrity check,
  or an unexpected server error. It logs at CRITICAL and, when ``HOS_ALERT_WEBHOOK`` is set,
  POSTs a small JSON document there (for a paging service or chat channel). The same alert is
  sent at most once an hour per process.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import time
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from hos.api.limits import ASGIApp, Message, Receive, Scope, Send

__all__ = [
    "JsonFormatter",
    "RequestLog",
    "alert",
    "configure_logging",
    "request_context",
    "set_principal",
]

_log = logging.getLogger("hos.request")
_alerts = logging.getLogger("hos.alert")
_errors = logging.getLogger("hos.error")

#: one mutable record per request; contexts copied into worker threads share it
_context: ContextVar[dict[str, str | None] | None] = ContextVar("hos_request", default=None)
_VALID_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")


def request_context() -> dict[str, str | None]:
    return _context.get() or {"request_id": None, "principal_id": None}


def set_principal(principal_id: str) -> None:
    ctx = _context.get()
    if ctx is not None:
        ctx["principal_id"] = principal_id


class JsonFormatter(logging.Formatter):
    _RESERVED = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message"}

    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            **request_context(),
        }
        out.update({k: v for k, v in vars(record).items() if k not in self._RESERVED})
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


class _Stderr(logging.StreamHandler):  # type: ignore[type-arg]
    """Writes to whatever ``sys.stderr`` is at the time of each record."""

    @property  # type: ignore[override]
    def stream(self) -> Any:
        return sys.stderr

    @stream.setter
    def stream(self, _: Any) -> None:
        pass


def configure_logging() -> None:
    """JSON lines on stderr for the ``hos`` loggers, unless HOS_LOG_FORMAT=text."""
    root = logging.getLogger("hos")
    if getattr(root, "_hos_configured", False):
        return
    handler = _Stderr()
    if os.environ.get("HOS_LOG_FORMAT", "json").lower() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    root.setLevel(os.environ.get("HOS_LOG_LEVEL", "INFO").upper())
    root.propagate = False
    root._hos_configured = True  # type: ignore[attr-defined]


class RequestLog:
    """Assigns the request ID, returns it in ``X-Request-ID`` and logs one line per request."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        given = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        rid = given if _VALID_ID.match(given) else uuid.uuid4().hex
        token = _context.set({"request_id": rid, "principal_id": None})
        status = 500
        started = False
        start = time.perf_counter()

        async def with_id(message: Message) -> None:
            nonlocal status, started
            if message["type"] == "http.response.start":
                status, started = message["status"], True
                message.setdefault("headers", [])
                message["headers"] = [*message["headers"], (b"x-request-id", rid.encode())]
            await send(message)

        try:
            await self.app(scope, receive, with_id)
        except Exception:
            # an error no handler expected: logged with its traceback; the client gets only
            # the request ID to quote
            _errors.exception("unhandled error", extra={"path": scope["path"]})
            if status != 500 or started:
                raise
            body = json.dumps(
                {
                    "error": "InternalError",
                    "detail": "an unexpected error "
                    "occurred; quote the request ID to your administrator",
                    "request_id": rid,
                }
            ).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"x-request-id", rid.encode()),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
        finally:
            client = scope.get("client")
            _log.info(
                "request",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                    "client": client[0] if client else None,
                },
            )
            _context.reset(token)


_sent: dict[str, float] = {}
_sent_lock = threading.Lock()


def alert(event: str, detail: str, *, wait: bool = False, **fields: Any) -> None:
    """Something a person must act on now. Never include credentials or record content.
    ``wait``: deliver before returning (a command-line check that exits next)."""
    _alerts.critical(detail, extra={"event": event, **fields})
    url = os.environ.get("HOS_ALERT_WEBHOOK")
    if not url:
        return
    key = f"{event}:{detail}"
    with _sent_lock:
        if time.monotonic() - _sent.get(key, -3600.0) < 3600:
            return
        _sent[key] = time.monotonic()
    body = {
        "source": "hakase",
        "event": event,
        "detail": detail,
        "at": datetime.now(UTC).isoformat(),
        **request_context(),
        **fields,
    }
    sender = threading.Thread(target=_post, args=(url, body), daemon=True)
    sender.start()
    if wait:
        sender.join(10)


def _post(url: str, body: dict[str, Any]) -> None:
    import httpx

    try:
        httpx.post(url, json=body, timeout=5).raise_for_status()
    except httpx.HTTPError as exc:
        _alerts.error(
            "alert delivery failed", extra={"event": body["event"], "reason": type(exc).__name__}
        )
