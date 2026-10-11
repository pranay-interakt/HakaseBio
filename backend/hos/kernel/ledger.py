"""The append-only, hash-chained provenance ledger.

Every state change in the system - a study created, a protocol amended, data
received, a result computed, a signature applied - is written here as an entry
whose hash covers the previous entry's hash. Altering or deleting any historical
entry breaks the chain, and :meth:`Ledger.verify` detects it.

This is the ALCOA+ "original record" and the substrate for the 21 CFR Part 11
audit trail: entries are attributable (actor), contemporaneous (server-set UTC
timestamp), original (append-only), and enduring (persisted; see storage).
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from hos.core.provenance import utc_now
from hos.kernel.errors import LedgerIntegrityError

__all__ = [
    "GENESIS_HASH",
    "LEDGER_SCHEME",
    "Ledger",
    "LedgerBackend",
    "LedgerEntry",
    "MemoryLedgerBackend",
    "canonical_json",
]

GENESIS_HASH = "0" * 64
#: Hashing scheme for new entries (see LedgerEntry.scheme); scheme-1 entries keep theirs.
LEDGER_SCHEME = 2


def _default(o: Any) -> Any:
    if isinstance(o, datetime):
        return o.isoformat()
    if hasattr(o, "to_dict"):
        return o.to_dict()
    if hasattr(o, "value") and hasattr(o, "name"):  # Enum
        return o.value
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    raise TypeError(f"not JSON serialisable: {type(o).__name__}")


def canonical_json(obj: Any) -> str:
    """Deterministic JSON used for hashing (sorted keys, no whitespace)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=_default)


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    seq: int
    recorded_at: str
    actor_id: str
    actor_kind: str
    action: str
    subject_type: str
    subject_id: str
    payload: dict[str, Any]
    payload_sha256: str
    prev_hash: str
    entry_hash: str
    reason: str | None = None
    scheme: int = 1
    """1: the hash covers the whole body. 2 (every entry written since docs/15 P0.3): the hash
    covers the previous hash and a digest of the rest of the body, so an entry can be shown to
    a third party as (prev_hash, content_digest, entry_hash) without its content and the chain
    still recomputes."""

    def body(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "seq": self.seq,
            "recorded_at": self.recorded_at,
            "actor_id": self.actor_id,
            "actor_kind": self.actor_kind,
            "action": self.action,
            "subject_type": self.subject_type,
            "subject_id": self.subject_id,
            "payload_sha256": self.payload_sha256,
            "prev_hash": self.prev_hash,
            "reason": self.reason,
        }
        if self.scheme != 1:
            d["scheme"] = self.scheme
        return d

    @staticmethod
    def compute_hash(body: dict[str, Any]) -> str:
        """Scheme 1: SHA-256 of the whole canonical body."""
        return hashlib.sha256(canonical_json(body).encode()).hexdigest()

    @staticmethod
    def content_digest_of(body: dict[str, Any]) -> str:
        """Scheme 2: SHA-256 of the body without ``prev_hash``."""
        return hashlib.sha256(canonical_json(
            {k: v for k, v in body.items() if k != "prev_hash"}).encode()).hexdigest()

    @staticmethod
    def chain_hash(prev_hash: str, content_digest: str) -> str:
        """Scheme 2: the entry hash from the previous hash and the content digest."""
        return hashlib.sha256(canonical_json({"scheme": 2, "prev_hash": prev_hash,
                                              "content_digest": content_digest}).encode()
                              ).hexdigest()

    @staticmethod
    def hash_of(body: dict[str, Any]) -> str:
        """The entry hash a body commits to, under its own scheme."""
        if body.get("scheme", 1) == 2:
            return LedgerEntry.chain_hash(body["prev_hash"], LedgerEntry.content_digest_of(body))
        return LedgerEntry.compute_hash(body)

    def content_digest(self) -> str:
        return self.content_digest_of(self.body())

    def to_dict(self) -> dict[str, Any]:
        d = self.body()
        d["payload"] = self.payload
        d["entry_hash"] = self.entry_hash
        return d


class LedgerBackend(Protocol):
    def append(self, entry: LedgerEntry) -> None: ...
    def last(self) -> LedgerEntry | None: ...
    def iter_all(self) -> Iterator[LedgerEntry]: ...
    def for_subject(self, subject_id: str) -> list[LedgerEntry]: ...


class MemoryLedgerBackend:
    """In-process backend (tests, ephemeral sessions)."""

    def __init__(self) -> None:
        self._entries: list[LedgerEntry] = []

    def append(self, entry: LedgerEntry) -> None:
        self._entries.append(entry)

    def last(self) -> LedgerEntry | None:
        return self._entries[-1] if self._entries else None

    def iter_all(self) -> Iterator[LedgerEntry]:
        return iter(list(self._entries))

    def for_subject(self, subject_id: str) -> list[LedgerEntry]:
        return [e for e in self._entries if e.subject_id == subject_id]


class Ledger:
    """Append-only hash-chained ledger over a pluggable backend."""

    def __init__(self, backend: LedgerBackend | None = None,
                 clock: Callable[[], datetime] = utc_now) -> None:
        self._backend: LedgerBackend = backend or MemoryLedgerBackend()
        self._clock = clock
        self._lock = threading.Lock()

    def record(
        self,
        *,
        actor_id: str,
        actor_kind: str,
        action: str,
        subject_type: str,
        subject_id: str,
        payload: dict[str, Any] | None = None,
        reason: str | None = None,
    ) -> LedgerEntry:
        payload = payload or {}
        payload_json = canonical_json(payload)
        normalised_payload = json.loads(payload_json)
        with self._lock:
            last = self._backend.last()
            seq = (last.seq + 1) if last else 1
            prev = last.entry_hash if last else GENESIS_HASH
            body: dict[str, Any] = {
                "seq": seq,
                "recorded_at": self._clock().isoformat(),
                "actor_id": actor_id,
                "actor_kind": actor_kind,
                "action": action,
                "subject_type": subject_type,
                "subject_id": subject_id,
                "payload_sha256": hashlib.sha256(payload_json.encode()).hexdigest(),
                "prev_hash": prev,
                "reason": reason,
                "scheme": LEDGER_SCHEME,
            }
            entry = LedgerEntry(
                payload=normalised_payload,
                entry_hash=LedgerEntry.hash_of(body),
                **body,
            )
            self._backend.append(entry)
            return entry

    def verify(self) -> int:
        """Walk the whole chain; raise on any break. Returns the entry count."""
        prev = GENESIS_HASH
        expected_seq = 1
        n = 0
        for e in self._backend.iter_all():
            if e.seq != expected_seq:
                raise LedgerIntegrityError(f"sequence gap at {e.seq} (expected {expected_seq})")
            if e.prev_hash != prev:
                raise LedgerIntegrityError(f"chain broken at entry {e.seq}: prev_hash mismatch")
            if hashlib.sha256(canonical_json(e.payload).encode()).hexdigest() != e.payload_sha256:
                raise LedgerIntegrityError(f"payload of entry {e.seq} was altered")
            if LedgerEntry.hash_of(e.body()) != e.entry_hash:
                raise LedgerIntegrityError(f"entry {e.seq} hash does not match its contents")
            prev = e.entry_hash
            expected_seq += 1
            n += 1
        return n

    def history(self, subject_id: str) -> list[LedgerEntry]:
        return self._backend.for_subject(subject_id)

    def entries(self) -> list[LedgerEntry]:
        return list(self._backend.iter_all())

    def last(self) -> LedgerEntry | None:
        return self._backend.last()

    @property
    def head(self) -> str:
        last = self._backend.last()
        return last.entry_hash if last else GENESIS_HASH
