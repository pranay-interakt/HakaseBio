"""Identifier, hashing, and timestamp helpers (doc 04 §12, doc 03 §3.6).

UUIDs for object identity, deterministic content hashes for reproducibility /
config hashing / output checksums, and ISO-8601 UTC timestamps everywhere.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any


def new_id(prefix: str = "") -> str:
    """A fresh random UUID4, optionally namespaced (e.g. ``evidence_<uuid>``)."""
    u = str(uuid.uuid4())
    return f"{prefix}_{u}" if prefix else u


def utc_now_iso() -> str:
    """Current time as an ISO-8601 UTC timestamp with millisecond precision."""
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def sha256_hex(data: Any) -> str:
    """Deterministic SHA-256 of an arbitrary JSON-serialisable object.

    Keys are sorted and separators are canonical so that identical logical
    inputs always hash identically (required for config hashing and output
    checksums per the Evidence Framework, doc 04 §5 & §19).
    """
    if isinstance(data, (bytes, bytearray)):
        raw = bytes(data)
    elif isinstance(data, str):
        raw = data.encode("utf-8")
    else:
        raw = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def deterministic_id(namespace: str, *parts: Any) -> str:
    """A stable UUID5 derived from a namespace and content parts.

    Used where an object's identity must be reproducible from its inputs (e.g.
    the same peptide + policy version always yields the same subject id).
    """
    seed = namespace + "|" + "|".join(str(p) for p in parts)
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))
