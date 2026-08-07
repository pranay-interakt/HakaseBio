"""In-memory persistence for L4 first-in-human records (mirrors the L3 store)."""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any

_LOCK = threading.Lock()
_STORE: OrderedDict[str, dict[str, Any]] = OrderedDict()
_MAX_STORED = 200


def put_projection(projection_id: str, record: dict[str, Any]) -> None:
    with _LOCK:
        if len(_STORE) >= _MAX_STORED:
            _STORE.popitem(last=False)
        _STORE[projection_id] = record


def get_projection(projection_id: str) -> dict[str, Any]:
    with _LOCK:
        record = _STORE.get(projection_id)
        if record is None:
            raise ValueError(
                "projection_id was not found; run the first-in-human projection before "
                "requesting it"
            )
        return record


def has_projection(projection_id: str) -> bool:
    with _LOCK:
        return projection_id in _STORE


def clear_projections() -> None:
    with _LOCK:
        _STORE.clear()


__all__ = ["clear_projections", "get_projection", "has_projection", "put_projection"]
