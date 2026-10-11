"""Ledger hashing schemes: scheme-1 entries (written before docs/15 P0.3) keep verifying, new
entries use scheme 2, and tampering is detected under either."""

import hashlib
from dataclasses import replace

import pytest

from hos.kernel.errors import LedgerIntegrityError
from hos.kernel.ledger import GENESIS_HASH, LEDGER_SCHEME, Ledger, LedgerEntry, canonical_json


def _scheme1(seq: int, prev: str) -> LedgerEntry:
    """An entry exactly as releases before scheme 2 wrote it."""
    body = {"seq": seq, "recorded_at": f"2026-10-0{seq}T00:00:00+00:00", "actor_id": "sci",
            "actor_kind": "human", "action": "program.created", "subject_type": "program",
            "subject_id": f"prg_{seq}",
            "payload_sha256": hashlib.sha256(canonical_json({}).encode()).hexdigest(),
            "prev_hash": prev, "reason": None}
    return LedgerEntry(payload={}, entry_hash=LedgerEntry.compute_hash(body), **body)


def _mixed() -> Ledger:
    ledger = Ledger()
    e1 = _scheme1(1, GENESIS_HASH)
    e2 = _scheme1(2, e1.entry_hash)
    ledger._backend.append(e1)
    ledger._backend.append(e2)
    for i in range(3):
        ledger.record(actor_id="sci", actor_kind="human", action="study.created",
                      subject_type="study", subject_id=f"stu_{i}", payload={"i": i})
    return ledger


def test_old_and_new_entries_verify_together():
    ledger = _mixed()
    assert ledger.verify() == 5
    assert [e.scheme for e in ledger.entries()] == [1, 1, LEDGER_SCHEME, 2, 2]
    new = ledger.entries()[2]
    assert "scheme" in new.body() and "scheme" not in ledger.entries()[0].body()
    assert new.entry_hash == LedgerEntry.chain_hash(new.prev_hash, new.content_digest())


@pytest.mark.parametrize("index", [0, 3])
def test_tampering_is_detected_under_either_scheme(index):
    ledger = _mixed()
    entries = ledger._backend._entries  # type: ignore[attr-defined]
    entries[index] = replace(entries[index], actor_id="someone-else")
    with pytest.raises(LedgerIntegrityError, match="hash does not match"):
        ledger.verify()


def test_a_scheme_2_hash_binds_its_predecessor():
    ledger = _mixed()
    entries = ledger._backend._entries  # type: ignore[attr-defined]
    e = entries[3]
    entries[3] = replace(e, prev_hash="f" * 64)
    with pytest.raises(LedgerIntegrityError):
        ledger.verify()
