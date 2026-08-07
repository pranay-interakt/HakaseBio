"""Persistence for L2→L3 stage-gate sign-offs, keyed by ``analysis_id``.

A sign-off is an audit record, not a model edit. It states which named reviewer
accepted which residual warnings, when, and why. The underlying analysis and
every model verdict remain immutable — signing changes nothing except whether
the animal cohort layer is permitted to run.

Process-local and thread-safe, mirroring ``l3.store``. Swapping in a durable
backend is a drop-in replacement behind these functions.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

_LOCK = threading.Lock()
_STORE: OrderedDict[str, dict[str, Any]] = OrderedDict()
_MAX_STORED = 500


class SignoffError(ValueError):
    """Raised when a sign-off is incomplete or does not clear the gate."""


def record_signoff(
    *,
    analysis_id: str,
    name: str,
    role: str,
    acknowledged_codes: list[str],
    justification: str | None,
    gate_snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Persist a reviewer signature against an analysis.

    Validates that every outstanding warning in ``gate_snapshot`` is
    acknowledged and that no hard block is present. Raises ``SignoffError``
    otherwise — a signature can never clear a block.
    """
    clean_name = (name or "").strip()
    clean_role = (role or "").strip()
    if not clean_name:
        raise SignoffError("A reviewer name is required to sign the stage gate.")
    if not clean_role:
        raise SignoffError("A reviewer role is required to sign the stage gate.")

    blocks = gate_snapshot.get("blocks") or []
    if blocks:
        raise SignoffError(
            "The stage gate carries hard blocks, which a signature cannot clear: "
            + "; ".join(str(b.get("title")) for b in blocks)
        )

    warning_codes = {str(w.get("code")) for w in (gate_snapshot.get("warnings") or [])}
    acked = {str(c) for c in (acknowledged_codes or [])}
    unknown = acked - warning_codes
    if unknown:
        raise SignoffError(
            "Acknowledgement references warnings that are not on this gate: "
            + ", ".join(sorted(unknown))
        )
    missing = warning_codes - acked
    if missing:
        raise SignoffError(
            "Every warning must be acknowledged before signing. Outstanding: "
            + ", ".join(sorted(missing))
        )

    record = {
        "signoff_id": str(uuid4()),
        "analysis_id": analysis_id,
        "name": clean_name,
        "role": clean_role,
        "justification": (justification or "").strip() or None,
        "acknowledged_codes": sorted(acked),
        "acknowledged_titles": [str(w.get("title")) for w in (gate_snapshot.get("warnings") or [])],
        "block_count_at_signing": 0,
        "warning_count_at_signing": len(warning_codes),
        "signed_at": datetime.now(UTC).isoformat(),
        "persistence": (
            "backend runtime audit record; durable storage is added with authentication"
        ),
        "note": (
            "This signature records accepted residual risk. It does not alter any model "
            "output — the original verdict and every safety flag remain on the record."
        ),
    }

    with _LOCK:
        if len(_STORE) >= _MAX_STORED:
            _STORE.popitem(last=False)
        _STORE[analysis_id] = record
    return record


def get_signoff(analysis_id: str | None) -> dict[str, Any] | None:
    if not analysis_id:
        return None
    with _LOCK:
        return _STORE.get(analysis_id)


def clear_signoffs() -> None:
    with _LOCK:
        _STORE.clear()


__all__ = ["SignoffError", "record_signoff", "get_signoff", "clear_signoffs"]
