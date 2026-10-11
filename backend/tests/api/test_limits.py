"""Request limits and pagination (docs/15 P2.5)."""

import pytest

from tests.api.test_api import CTX, PW, _login
from tests.api.test_identity import _app


@pytest.fixture()
def small(tmp_path, monkeypatch):
    monkeypatch.setenv("HOS_MAX_UPLOAD_MB", str(4 / 1024))  # 4 KB
    monkeypatch.setenv("HOS_MAX_JSON_KB", "1")
    return _app(tmp_path)


def _chunks(n):
    for _ in range(n):
        yield b"x" * 1024


def test_an_upload_over_the_limit_is_refused_and_nothing_is_stored(small):
    c, k, _ = small
    sci = _login(c, "sci")
    prog = c.post("/api/programs", headers=sci, json={"name": "L", "context": CTX}).json()["id"]
    cid = c.post(
        f"/api/programs/{prog}/compounds", headers=sci, json={"name": "c", "smiles": "CCO"}
    ).json()["id"]
    n = len(k.ledger.entries())
    q = {
        "compound_id": cid,
        "requirement_id": "genotox.ames",
        "filename": "r.pdf",
        "title": "Ames",
        "laboratory": "Lab",
        "report_date": "2026-05-01",
        "glp": "false",
    }
    r = c.post(f"/api/programs/{prog}/imports", headers=sci, params=q, content=b"%PDF" * 2048)
    assert r.status_code == 413 and "4 KB" in r.json()["detail"]
    # without a Content-Length the body is counted as it arrives
    r = c.post(f"/api/programs/{prog}/imports", headers=sci, params=q, content=_chunks(8))
    assert r.status_code == 413
    assert c.post("/api/verify", headers=sci, content=_chunks(8)).status_code == 413
    assert len(k.ledger.entries()) == n
    assert k.repo.studies(prog) == []


def test_json_bodies_have_their_own_smaller_limit(small):
    c, _, _ = small
    sci = _login(c, "sci")
    big = {"name": "x" * 2048, "context": CTX}
    assert c.post("/api/programs", headers=sci, json=big).status_code == 413
    r = c.post(
        "/api/programs", headers={**sci, "Content-Type": "application/json"}, content=_chunks(3)
    )
    assert r.status_code == 413  # not FastAPI's 400 for an unreadable body
    assert (
        c.post("/api/programs", headers=sci, json={"name": "ok", "context": CTX}).status_code == 200
    )


def test_lists_are_paged_in_the_database(tmp_path):
    c, _, adm = _app(tmp_path)
    sci = _login(c, "sci")
    ids = [
        c.post("/api/programs", headers=sci, json={"name": f"P{i}", "context": CTX}).json()["id"]
        for i in range(3)
    ]
    # another organisation's programme is neither listed nor counted
    c.post(
        "/api/principals",
        headers=adm,
        json={
            "principal_id": "other",
            "name": "O",
            "kind": "human",
            "roles": ["scientist"],
            "password": PW,
            "organisation": "Other Org",
        },
    )
    c.post("/api/programs", headers=_login(c, "other"), json={"name": "X", "context": CTX})
    r = c.get("/api/programs?limit=2", headers=sci)
    assert [p["id"] for p in r.json()] == ids[:2] and r.headers["X-Total-Count"] == "3"
    r = c.get("/api/programs?limit=2&offset=2", headers=sci)
    assert [p["id"] for p in r.json()] == ids[2:]
    assert c.get("/api/programs?limit=1001", headers=sci).status_code == 422
    assert c.get("/api/programs?offset=-1", headers=sci).status_code == 422

    history = c.get(f"/api/ledger/{ids[0]}", headers=sci)
    total = int(history.headers["X-Total-Count"])
    pages = [
        c.get(f"/api/ledger/{ids[0]}?limit=1&offset={i}", headers=sci).json()[0]
        for i in range(total)
    ]
    assert pages == history.json()
    r = c.get(f"/api/studies?program_id={ids[0]}", headers=sci)
    assert r.json() == [] and r.headers["X-Total-Count"] == "0"
