"""Writers in separate processes (docs/15 P2.2, P2.6).

Several worker processes, each with its own kernel on the same database, change the same
record at the same time. Each change reads a JSON field, modifies it and writes it back, which
is exactly how two concurrent signatures could lose one. Nothing may be lost or refused, and
the ledger must stay one gap-free chain that reconciles with the stored state. CI runs this on
SQLite and on PostgreSQL."""

import multiprocessing as mp
from pathlib import Path

from sqlalchemy import text

from hos.db.store import Database, FileStore
from hos.kernel.kernel import Kernel
from tests.api.test_api import CTX as API_CTX
from tests.api.test_api import _login
from tests.api.test_identity import _app
from tests.kernel.test_kernel import CTX, k  # noqa: F401

WORKERS, CHANGES = 4, 12


def _writer(url: str, files_root: str, cid: str, tag: str) -> list[str]:
    kern = Kernel(db=Database(url), files=FileStore(Path(files_root)))
    sci = kern.get_principal("sci")
    errors = []
    for i in range(CHANGES):
        try:
            kern.attach_external_record(sci, cid, f"{tag}-{i}", {"change": i})
        except Exception as e:  # noqa: BLE001 - every failure is the finding
            errors.append(repr(e))
    kern.db.engine.dispose()
    return errors


def test_writers_in_separate_processes_lose_nothing(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="CONC", context=CTX)["id"]
    cid = k.register_compound(sci, prog, name="c", smiles="CCO")["id"]
    before = len(k.ledger.entries())
    with mp.get_context("spawn").Pool(WORKERS) as pool:
        errors = pool.starmap(_writer, [(k.db.url, str(k.files.root), cid, f"w{j}")
                                        for j in range(WORKERS)])
    assert errors == [[]] * WORKERS
    expected = {f"w{j}-{i}" for j in range(WORKERS) for i in range(CHANGES)}
    assert set(k.repo.compound(cid).external) == expected          # no lost update
    entries = k.ledger.entries()
    assert [e.seq for e in entries] == list(range(1, len(entries) + 1))
    assert len(entries) == before + WORKERS * CHANGES
    assert k.verify_ledger() == len(entries)
    report = k.integrity()
    assert report["valid"], report["findings"]


def test_a_writer_that_waits_too_long_changes_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("HOS_WRITE_WAIT_SECONDS", "0.3")
    c, kern, _ = _app(tmp_path)
    sci = _login(c, "sci")
    n = len(kern.ledger.entries())
    with kern.db.engine.connect() as other:      # another process mid-way through a write
        other.execute(text("UPDATE writer_lock SET writes = writes + 1 WHERE id = 1"))
        r = c.post("/api/programs", headers=sci, json={"name": "W", "context": API_CTX})
        other.rollback()
    assert r.status_code == 503, r.text
    assert "writer_lock" not in r.text and "UPDATE" not in r.text
    assert len(kern.ledger.entries()) == n
    assert c.post("/api/programs", headers=sci, json={"name": "W", "context": API_CTX}).status_code == 200
