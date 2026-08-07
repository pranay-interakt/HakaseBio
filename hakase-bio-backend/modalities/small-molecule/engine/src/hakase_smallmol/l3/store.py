"""In-memory persistence for L3 study records (mirrors the L1 analysis store).

A completed virtual preclinical study is kept by ``study_id`` so the report and
handoff can be retrieved by reference, exactly as L2 retrieves L1 by id. This is
a process-local store (bounded, thread-safe); swapping in a durable backend is a
drop-in replacement behind these four functions.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any

_STUDY_LOCK = threading.Lock()
_STUDY_STORE: OrderedDict[str, dict[str, Any]] = OrderedDict()
_MAX_STORED_STUDIES = 200


def put_study(study_id: str, record: dict[str, Any]) -> None:
    with _STUDY_LOCK:
        if len(_STUDY_STORE) >= _MAX_STORED_STUDIES:
            _STUDY_STORE.popitem(last=False)
        _STUDY_STORE[study_id] = record


def get_study(study_id: str) -> dict[str, Any]:
    with _STUDY_LOCK:
        record = _STUDY_STORE.get(study_id)
        if record is None:
            raise ValueError("study_id was not found; run the animal study before requesting it")
        return record


def has_study(study_id: str) -> bool:
    with _STUDY_LOCK:
        return study_id in _STUDY_STORE


def clear_studies() -> None:
    with _STUDY_LOCK:
        _STUDY_STORE.clear()


__all__ = ["put_study", "get_study", "has_study", "clear_studies"]
