"""Shared HTTP helpers for the public-database clients.

Every external call is time-boxed and fail-soft. A transport failure is turned
into a typed result by the caller, never into an exception that would take down
a whole evidence panel because one registry was unreachable.
"""

from __future__ import annotations

from typing import Any

import requests

DEFAULT_TIMEOUT = 15.0
USER_AGENT = "HakaseAI-BioTwin/2.0 (small-molecule evidence panel)"


class SourceUnavailable(Exception):
    """A public source could not be reached or returned an unusable response."""


def _headers(accept: str) -> dict[str, str]:
    return {"Accept": accept, "User-Agent": USER_AGENT}


def get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ok_statuses: tuple[int, ...] = (200,),
    empty_statuses: tuple[int, ...] = (404,),
) -> Any | None:
    """GET JSON. ``None`` means "the source answered, with nothing"."""
    try:
        response = requests.get(url, params=params, headers=_headers("application/json"), timeout=timeout)
    except requests.RequestException as exc:
        raise SourceUnavailable(f"{type(exc).__name__}: {exc}") from exc
    if response.status_code in empty_statuses:
        return None
    if response.status_code not in ok_statuses:
        raise SourceUnavailable(f"HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise SourceUnavailable(f"Response was not JSON: {exc}") from exc


def post_json(
    url: str,
    payload: dict[str, Any],
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any:
    """POST a JSON body and return the decoded JSON response."""
    try:
        response = requests.post(
            url,
            json=payload,
            headers={**_headers("application/json"), "Content-Type": "application/json"},
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise SourceUnavailable(f"{type(exc).__name__}: {exc}") from exc
    if response.status_code != 200:
        raise SourceUnavailable(f"HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise SourceUnavailable(f"Response was not JSON: {exc}") from exc


def get_text(url: str, *, timeout: float = DEFAULT_TIMEOUT) -> str | None:
    """GET a plain-text payload (KEGG's flat-file REST interface)."""
    try:
        response = requests.get(url, headers=_headers("text/plain"), timeout=timeout)
    except requests.RequestException as exc:
        raise SourceUnavailable(f"{type(exc).__name__}: {exc}") from exc
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        raise SourceUnavailable(f"HTTP {response.status_code}")
    return response.text


def unavailable(source: str, reason: str, **extra: Any) -> dict[str, Any]:
    """The standard 'this source did not answer' envelope."""
    return {"status": "error", "source": source, "reason": reason, **extra}


def no_data(source: str, reason: str, **extra: Any) -> dict[str, Any]:
    """The standard 'this source answered, with nothing' envelope."""
    return {"status": "no-data", "source": source, "reason": reason, **extra}


def as_float(value: Any) -> float | None:
    """Coerce to float, refusing bools, NaN/inf, and unparsable strings."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out and abs(out) != float("inf") else None


__all__ = [
    "DEFAULT_TIMEOUT",
    "SourceUnavailable",
    "as_float",
    "get_json",
    "get_text",
    "no_data",
    "post_json",
    "unavailable",
]
