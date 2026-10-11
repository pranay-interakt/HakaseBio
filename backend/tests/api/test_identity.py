"""Part 11 access control (docs/15 P1.1, P1.2, P1.4): database sessions with timeouts and
revocation, lockout and throttling, and the user lifecycle, each on the record."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import text

from hos.api import create_app
from hos.core.provenance import utc_now
from hos.db.store import Database, FileStore
from hos.kernel.kernel import AuthPolicy, Kernel
from tests.api.test_api import CTX, PW, SETUP, _login
from tests.drivers.test_metabolic_stability import PARAMS


def _app(tmp_path, monkeypatch=None, attempts=None, policy=None):
    if monkeypatch is not None and attempts is not None:
        monkeypatch.setenv("HOS_LOGIN_ATTEMPTS_PER_MINUTE", str(attempts))
    k = Kernel(
        db=Database(f"sqlite:///{tmp_path / 'id.sqlite3'}"),
        files=FileStore(tmp_path / "objects"),
        auth_policy=policy,
    )
    c = TestClient(create_app(k, bootstrap_token=SETUP))
    c.post(
        "/api/setup",
        json={"principal_id": "admin", "name": "Ada Admin", "password": PW, "setup_token": SETUP},
    )
    adm = _login(c, "admin")
    for pid, roles in (("sci", ["scientist", "responsible_scientist"]), ("sd", ["study_director"])):
        c.post(
            "/api/principals",
            headers=adm,
            json={
                "principal_id": pid,
                "name": pid,
                "kind": "human",
                "roles": roles,
                "password": PW,
            },
        )
    return c, k, adm


def _actions(c, adm, subject):
    return [e["action"] for e in c.get(f"/api/ledger/{subject}", headers=adm).json()]


def test_sessions_survive_a_restart_and_store_only_hashes(tmp_path):
    c, k, adm = _app(tmp_path)
    h = _login(c, "sci")
    token = h["Authorization"].split()[1]
    restarted = TestClient(create_app(k, bootstrap_token=SETUP))  # a second worker
    assert restarted.get("/api/me", headers=h).status_code == 200
    with k.db.session() as s:
        stored = [r[0] for r in s.execute(text("SELECT token_hash FROM sessions"))]
    assert token not in stored and len(stored[0]) == 64
    assert c.post("/api/auth/logout", headers=h).status_code == 200
    assert restarted.get("/api/me", headers=h).status_code == 401  # revoked everywhere
    assert {"auth.login", "auth.logout"} <= set(_actions(c, adm, "sci"))


def test_idle_and_absolute_timeouts(tmp_path):
    c, k, _ = _app(tmp_path)
    h = _login(c, "sci")
    with k.db.session() as s:
        s.execute(
            text("UPDATE sessions SET last_seen_at=:t WHERE principal_id='sci'"),
            {"t": utc_now() - timedelta(hours=2)},
        )
    assert c.get("/api/me", headers=h).status_code == 401  # idle 30 min by default
    h = _login(c, "sci")
    with k.db.session() as s:
        s.execute(
            text(
                "UPDATE sessions SET expires_at=:t WHERE principal_id='sci' AND revoked_at IS NULL"
            ),
            {"t": utc_now() - timedelta(seconds=1)},
        )
    assert c.get("/api/me", headers=h).status_code == 401


def test_lockout_at_login_and_at_signing(tmp_path):
    c, k, adm = _app(tmp_path, policy=AuthPolicy(lockout_attempts=3))
    for _ in range(3):
        r = c.post("/api/auth/login", json={"principal_id": "sci", "password": "wrong-password!"})
        assert r.status_code == 403 and r.json()["detail"] == "invalid credentials"
    r = c.post("/api/auth/login", json={"principal_id": "sci", "password": PW})
    assert r.status_code == 403 and "locked" in r.json()["detail"]  # only with the password
    r = c.post("/api/auth/login", json={"principal_id": "sci", "password": "wrong-password!"})
    assert r.json()["detail"] == "invalid credentials"
    assert "principal.locked" in _actions(c, adm, "sci")
    assert (
        c.post(
            "/api/principals/sci/unlock", headers=adm, json={"reason": "confirmed with the user"}
        ).status_code
        == 200
    )
    assert (
        c.post("/api/auth/login", json={"principal_id": "sci", "password": PW}).status_code == 200
    )
    # failed re-authentication at a signature counts too
    sci, sd = _login(c, "sci"), _login(c, "sd")
    prog = c.post("/api/programs", headers=sci, json={"name": "L", "context": CTX}).json()["id"]
    cid = c.post(
        f"/api/programs/{prog}/compounds", headers=sci, json={"name": "c", "smiles": "CCO"}
    ).json()["id"]
    sid = c.post(
        "/api/studies",
        headers=sci,
        json={"program_id": prog, "compound_id": cid, "requirement_id": "adme.metabolic_stability"},
    ).json()["id"]
    c.post(f"/api/studies/{sid}/design", headers=sci, json={"parameters": PARAMS})
    for _ in range(3):
        r = c.post(
            f"/api/studies/{sid}/protocol/sign",
            headers=sd,
            json={"statement": "approve", "password": "wrong-password!"},
        )
        assert r.status_code == 403
    assert k.repo.principal("sd").locked_at is not None


def test_sign_in_is_throttled_per_address(tmp_path, monkeypatch):
    c, _, _ = _app(tmp_path, monkeypatch, attempts=4)
    codes = [
        c.post("/api/auth/login", json={"principal_id": "nobody", "password": "x" * 12}).status_code
        for _ in range(4)
    ]
    assert codes[-1] == 429


def test_deactivation_ends_access_but_not_past_signatures(tmp_path):
    c, _, adm = _app(tmp_path)
    sci, sd = _login(c, "sci"), _login(c, "sd")
    prog = c.post("/api/programs", headers=sci, json={"name": "D", "context": CTX}).json()["id"]
    cid = c.post(
        f"/api/programs/{prog}/compounds", headers=sci, json={"name": "c", "smiles": "CCO"}
    ).json()["id"]
    sid = c.post(
        "/api/studies",
        headers=sci,
        json={"program_id": prog, "compound_id": cid, "requirement_id": "adme.metabolic_stability"},
    ).json()["id"]
    c.post(f"/api/studies/{sid}/design", headers=sci, json={"parameters": PARAMS})
    assert (
        c.post(
            f"/api/studies/{sid}/protocol/sign",
            headers=sd,
            json={"statement": "I approve this protocol.", "password": PW},
        ).status_code
        == 200
    )
    assert (
        c.post(
            "/api/principals/sd/deactivate", headers=adm, json={"reason": "left the company"}
        ).status_code
        == 200
    )
    assert c.get("/api/me", headers=sd).status_code == 401  # sessions ended
    assert c.post("/api/auth/login", json={"principal_id": "sd", "password": PW}).status_code == 403
    integrity = c.get("/api/ledger/verify", headers=adm).json()
    assert integrity["valid"], integrity["findings"]  # the signature still reconciles
    sigs = c.get(f"/api/studies/{sid}", headers=sci).json()["signatures"]
    assert [g["signer_id"] for g in sigs] == ["sd"]
    assert (
        c.post("/api/principals/sd/reactivate", headers=adm, json={"reason": "rehired"}).status_code
        == 200
    )
    assert c.post("/api/auth/login", json={"principal_id": "sd", "password": PW}).status_code == 200


def test_role_changes_reconcile(tmp_path):
    c, _, adm = _app(tmp_path)
    r = c.post(
        "/api/principals/sci/roles",
        headers=adm,
        json={"roles": ["scientist"], "reason": "moved to discovery"},
    )
    assert r.status_code == 200 and r.json()["roles"] == ["scientist"]
    assert c.get("/api/ledger/verify", headers=adm).json()["valid"]
    assert (
        c.post(
            "/api/principals/admin/roles", headers=adm, json={"roles": ["scientist"], "reason": "x"}
        ).status_code
        == 400
    )


def test_reset_password_forces_a_change(tmp_path):
    c, _, adm = _app(tmp_path)
    temp = "temporary-password-1"
    assert (
        c.post(
            "/api/principals/sci/reset-password",
            headers=adm,
            json={"new_password": temp, "reason": "forgotten"},
        ).status_code
        == 200
    )
    r = c.post("/api/auth/login", json={"principal_id": "sci", "password": temp})
    assert r.status_code == 200 and r.json()["must_change_password"]
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert c.get("/api/programs", headers=h).status_code == 403
    assert c.get("/api/me", headers=h).json()["must_change_password"]
    assert (
        c.post(
            "/api/auth/password",
            headers=h,
            json={"current_password": temp, "new_password": "a-new-password-2"},
        ).status_code
        == 200
    )
    assert c.get("/api/programs", headers=h).status_code == 200
    assert "principal.password_changed" in _actions(c, adm, "sci")


def test_agent_keys_and_organisation_scope(tmp_path):
    c, _, adm = _app(tmp_path)
    c.post(
        "/api/principals",
        headers=adm,
        json={"principal_id": "bot", "name": "Agent", "kind": "agent", "roles": ["scientist"]},
    )
    key = c.post("/api/principals/bot/agent-token", headers=adm).json()["token"]
    bot = {"Authorization": f"Bearer {key}"}
    assert c.get("/api/me", headers=bot).json()["kind"] == "agent"
    c.post("/api/principals/bot/deactivate", headers=adm, json={"reason": "retired"})
    assert c.get("/api/me", headers=bot).status_code == 401
    c.post(
        "/api/principals",
        headers=adm,
        json={
            "principal_id": "a_admin",
            "name": "A",
            "kind": "human",
            "roles": ["admin"],
            "password": PW,
            "organisation": "Org A",
        },
    )
    a = _login(c, "a_admin")
    assert (
        c.post("/api/principals/sci/deactivate", headers=a, json={"reason": "x"}).status_code == 404
    )  # another organisation
