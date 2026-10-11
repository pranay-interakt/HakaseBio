"""Request IDs, structured logs and alerts (docs/15 P2.7)."""

import json
import time

import pytest
from sqlalchemy import text

from hos.api import observability
from hos.db import cli
from tests.api.test_api import CTX, PW, _login
from tests.api.test_identity import _app


@pytest.fixture()
def alerts(monkeypatch):
    sent = []
    monkeypatch.setenv("HOS_ALERT_WEBHOOK", "https://alerts.example.invalid/hook")
    monkeypatch.setattr(observability, "_post", lambda url, body: sent.append((url, body)))
    monkeypatch.setattr(observability, "_sent", {})
    return sent


def _wait(sent, n=1):
    for _ in range(100):
        if len(sent) >= n:
            return sent
        time.sleep(0.02)
    return sent


def _lines(capsys):
    return [json.loads(line) for line in capsys.readouterr().err.splitlines()
            if line.startswith("{")]


def test_every_response_and_error_carries_the_request_id(tmp_path):
    c, _, _ = _app(tmp_path)
    r = c.get("/api/health")
    assert len(r.headers["X-Request-ID"]) == 32
    assert c.get("/api/health", headers={"X-Request-ID": "proxy-id-12345"}
                 ).headers["X-Request-ID"] == "proxy-id-12345"
    forged = c.get("/api/health", headers={"X-Request-ID": "x\" injected"})
    assert forged.headers["X-Request-ID"] != "x\" injected"
    sci = _login(c, "sci")
    for r in (c.get("/api/programs/prg_missing", headers=sci),               # 404
              c.get("/api/programs"),                                          # 401
              c.post("/api/programs", headers=sci, json={"name": "x"}),        # 422
              c.post("/api/programs", headers=sci, json={"name": "x" * 3_000_000})):  # 413
        assert r.status_code in (401, 404, 413, 422)
        assert r.json()["request_id"] == r.headers["X-Request-ID"], r.text


def test_one_json_line_per_request_without_secrets(tmp_path, capsys):
    c, _, _ = _app(tmp_path)
    capsys.readouterr()
    r = c.post("/api/auth/login", json={"principal_id": "sci", "password": PW})
    token = r.json()["token"]
    c.get("/api/programs?limit=5", headers={"Authorization": f"Bearer {token}"})
    out = capsys.readouterr().err
    assert PW not in out and token not in out
    lines = [json.loads(x) for x in out.splitlines() if x.startswith("{")]
    req = [x for x in lines if x["msg"] == "request"]
    assert [(x["method"], x["path"], x["status"]) for x in req] == [
        ("POST", "/api/auth/login", 200), ("GET", "/api/programs", 200)]
    assert req[1]["principal_id"] == "sci" and req[0]["principal_id"] is None
    assert all(len(x["request_id"]) == 32 and x["duration_ms"] >= 0 for x in req)


def test_an_unexpected_error_shows_only_the_request_id(tmp_path, monkeypatch, capsys):
    c, k, _ = _app(tmp_path)
    sci = _login(c, "sci")

    def broken(*a, **kw):
        raise RuntimeError("internal detail that must not reach the client")

    monkeypatch.setattr(k, "programs_page", broken)
    r = c.get("/api/programs", headers=sci)
    assert r.status_code == 500 and "internal detail" not in r.text
    assert r.json()["request_id"] == r.headers["X-Request-ID"]
    logged = [x for x in _lines(capsys) if x["msg"] == "unhandled error"]
    assert logged and "internal detail" in logged[0]["exc"]
    assert logged[0]["request_id"] == r.headers["X-Request-ID"]


def test_a_failed_integrity_check_alerts_once(tmp_path, alerts):
    c, k, adm = _app(tmp_path)
    sci = _login(c, "sci")
    pid = c.post("/api/programs", headers=sci, json={"name": "A", "context": CTX}).json()["id"]
    with k.db.session() as s:                       # an edit made straight to the database
        s.execute(text("UPDATE programs SET name='edited' WHERE id=:id"), {"id": pid})
        s.execute(text("UPDATE programs SET context=:c WHERE id=:id"),
                  {"c": json.dumps({**CTX, "max_trial_duration_days": 999}), "id": pid})
    assert not c.get("/api/ledger/verify", headers=adm).json()["valid"]
    c.get("/api/ledger/verify", headers=adm)
    sent = _wait(alerts)
    time.sleep(0.1)
    assert len(sent) == 1                           # the repeat within the hour is not re-sent
    body = sent[0][1]
    assert body["event"] == "ledger_integrity" and body["request_id"]
    assert "context matches the study set derived from it" in body["checks"]


def test_a_broken_chain_answers_500_and_alerts(tmp_path, alerts):
    c, k, adm = _app(tmp_path)
    with k.db.session() as s:
        s.execute(text("UPDATE ledger SET payload=:p WHERE seq=2"), {"p": json.dumps({"x": 1})})
    r = c.get("/api/ledger/verify", headers=adm)
    assert r.status_code == 500 and r.json()["error"] == "LedgerIntegrityError"
    assert "reported to the administrators" in r.json()["detail"]
    assert _wait(alerts)[0][1]["detail"] == "payload of entry 2 was altered"


def test_the_scheduled_integrity_check(tmp_path, monkeypatch, alerts, capsys):
    monkeypatch.setenv("HOS_DATABASE_URL", f"sqlite:///{tmp_path / 'id.sqlite3'}")
    monkeypatch.setenv("HOS_DATA_DIR", str(tmp_path))
    _, k, _ = _app(tmp_path)
    assert cli.main(["integrity"]) == 0
    with k.db.session() as s:
        s.execute(text("UPDATE principals SET roles='[\"admin\"]' WHERE id='sci'"))
    assert cli.main(["integrity"]) == 1
    assert alerts and alerts[0][1]["source_check"] == "hos-db integrity"
    assert "principal matches its registration" in capsys.readouterr().out
