"""The REST API end to end over HTTP (FastAPI TestClient, temporary database)."""

import pytest
from fastapi.testclient import TestClient

from hos.api import create_app
from hos.db.store import Database, FileStore
from hos.kernel.kernel import Kernel
from tests.drivers.test_metabolic_stability import HL, PARAMS, _measured_csv

PW = "correct horse battery staple"
SETUP = "test-setup-token"
CTX = {"modality": "small_molecule", "indication": "chronic_non_oncology", "route": "oral",
       "intended_clinical_duration_days": 365, "max_trial_duration_days": 28}


@pytest.fixture()
def api(tmp_path):
    k = Kernel(db=Database(f"sqlite:///{tmp_path / 'api.sqlite3'}"),
               files=FileStore(tmp_path / "objects"))
    c = TestClient(create_app(k, bootstrap_token=SETUP))
    assert c.get("/api/health").json() == {"status": "ok"}
    assert c.get("/api/setup").json() == {"initialised": False}
    r = c.get("/api/ready")
    assert r.status_code == 200 and r.json() == {"ready": True, "checks": {
        "database": True, "schema": True, "file_store": True, "anchors": True}}
    assert c.post("/api/setup", json={"principal_id": "admin", "name": "Ada Admin",
                                      "password": PW, "setup_token": "guess"}).status_code == 403
    assert c.post("/api/setup", json={"principal_id": "admin", "name": "Ada Admin",
                                      "password": PW, "setup_token": SETUP}).status_code == 200
    assert c.post("/api/setup", json={"principal_id": "x", "name": "x", "password": PW,
                                      "setup_token": SETUP}).status_code == 403
    return c


def _login(c, pid):
    r = c.post("/api/auth/login", json={"principal_id": pid, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_full_flow_over_http(api):
    c = api
    adm = _login(c, "admin")
    for pid, name, roles in (("sci", "Sam Scientist", ["scientist", "responsible_scientist"]),):
        assert c.post("/api/principals", headers=adm, json={
            "principal_id": pid, "name": name, "kind": "human", "roles": roles,
            "password": PW}).status_code == 200
    h = _login(c, "sci")
    assert c.get("/api/programs").status_code == 401
    prog = c.post("/api/programs", headers=h, json={"name": "API-1", "context": CTX}).json()
    assert prog["study_set"]["summary"]["required"] > 0
    cmp_ = c.post(f"/api/programs/{prog['id']}/compounds", headers=h,
                  json={"name": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O"}).json()
    assert c.post(f"/api/programs/{prog['id']}/compounds", headers=h,
                  json={"name": "bad", "smiles": "not a molecule"}).status_code == 400
    st = c.post("/api/studies", headers=h, json={
        "program_id": prog["id"], "compound_id": cmp_["id"],
        "requirement_id": "adme.metabolic_stability"}).json()
    sid = st["id"]
    assert c.post(f"/api/studies/{sid}/design", headers=h,
                  json={"parameters": {"species": ["human"]}}).status_code == 400
    assert c.post(f"/api/studies/{sid}/design", headers=h,
                  json={"parameters": PARAMS}).status_code == 200
    assert c.post(f"/api/studies/{sid}/plan", headers=h).json()["plan"]["cost"] is None
    c.post(f"/api/studies/{sid}/dispatch", headers=h,
           json={"target": {"kind": "external_lab", "laboratory": "Example CRO"}})
    assert c.get(f"/api/studies/{sid}/bundle", headers=h).content[:2] == b"PK"
    assert f"# study_reference: {sid}" in c.get(f"/api/studies/{sid}/template", headers=h).text
    bad = c.post(f"/api/studies/{sid}/data?filename=bad.csv", headers=h, content=b"x,y\n1,2\n")
    assert bad.status_code == 422 and bad.json()["errors"]
    ok = c.post(f"/api/studies/{sid}/data?filename=cro.csv", headers=h,
                content=_measured_csv(HL, ref=sid))
    assert ok.status_code == 200 and ok.json()["state"] == "data_received"
    c.put(f"/api/studies/{sid}/inputs", headers=h, json={"inputs": {
        "fu_plasma.human": {"value": 0.1, "unit": "dimensionless", "kind": "measured",
                            "source": "PPB study"},
        "blood_plasma_ratio.human": {"value": 1.0, "unit": "dimensionless",
                                     "kind": "user_supplied"}}})
    v = c.post(f"/api/studies/{sid}/analyze", headers=h, json={}).json()
    clh = v["results"]["quantities"]["human.clh"]
    assert clh["provenance"]["kind"] == "computed" and clh["provenance"]["citations"]
    c.post(f"/api/studies/{sid}/report", headers=h)
    assert "Data provenance" in c.get(f"/api/studies/{sid}/report.md", headers=h).text
    sign = {"role": "responsible_scientist", "meaning": "approval", "statement": "I approve."}
    assert c.post(f"/api/studies/{sid}/sign", headers=h,
                  json={**sign, "password": "wrong password!"}).status_code == 403
    assert c.post(f"/api/studies/{sid}/sign", headers=h,
                  json={**sign, "password": PW}).status_code == 200
    assert c.post(f"/api/studies/{sid}/approve", headers=h,
                  json={"password": PW}).json()["state"] == "approved"
    r = c.get(f"/api/programs/{prog['id']}/readiness", headers=h).json()
    assert r["summary"]["done"] == 1
    pkg = c.post(f"/api/programs/{prog['id']}/module4", headers=h).json()
    assert pkg["included_studies"] == 1
    assert c.get(f"/api/files/{pkg['bundle_sha256']}", headers=h).content[:2] == b"PK"
    integrity = c.get("/api/ledger/verify", headers=adm).json()
    assert integrity["valid"], integrity["findings"]
    assert c.get("/api/ledger/verify", headers=h).json()["findings"] == 0   # counts only
    acts = [e["action"] for e in c.get(f"/api/ledger/{sid}", headers=h).json()]
    assert "data.rejected" in acts and "study.approved" in acts


def test_agent_token_can_work_but_not_sign(api):
    c = api
    adm = _login(c, "admin")
    c.post("/api/principals", headers=adm, json={"principal_id": "bot", "name": "Design agent",
                                                 "kind": "agent", "roles": ["scientist"]})
    tok = c.post("/api/principals/bot/agent-token", headers=adm).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    prog = c.post("/api/programs", headers=h, json={"name": "BOT", "context": CTX})
    assert prog.status_code == 200
    assert c.post("/api/auth/login", json={"principal_id": "bot", "password": PW}).status_code == 403


def test_reference_and_driver_catalogue(api):
    c = api
    h = _login(c, "admin")
    drivers = {d["id"]: d for d in c.get("/api/drivers", headers=h).json()}
    from hos.drivers.registry import default_registry
    assert set(drivers) == set(default_registry().ids())
    assert {"metabolic_stability", "herg_patch_clamp", "repeat_dose_toxicity",
            "bioanalytical_validation"} <= set(drivers)
    assert drivers["herg_patch_clamp"]["parameters_schema"]["properties"]
    params = c.get("/api/reference/parameters", headers=h).json()
    assert params["parameters"]["km.rat"]["provenance"]["kind"] == "guideline"
    assert "obach1999" in c.get("/api/reference/citations", headers=h).json()


def test_api_docs_only_when_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("HOS_API_DOCS", "1")
    k = Kernel(db=Database(f"sqlite:///{tmp_path / 'd.sqlite3'}"),
               files=FileStore(tmp_path / "objects"))
    assert TestClient(create_app(k)).get("/openapi.json").status_code == 200


def test_what_clients_cannot_see(api):
    c = api
    adm = _login(c, "admin")
    assert c.post("/api/principals", headers=adm, json={
        "principal_id": "sci", "name": "Sam Scientist", "kind": "human", "roles": ["scientist"],
        "password": PW}).status_code == 200
    h = _login(c, "sci")
    # validation errors name the field, never echo the submitted values (incl. passwords)
    r = c.post("/api/auth/login", json={"password": "SECRETPASS123"})
    assert r.status_code == 422 and "SECRETPASS123" not in r.text
    assert any(e.startswith("body.principal_id") for e in r.json()["errors"])
    # one refusal for an unknown id and a wrong password
    a = c.post("/api/auth/login", json={"principal_id": "nobody", "password": "x" * 12})
    b = c.post("/api/auth/login", json={"principal_id": "sci", "password": "x" * 12})
    assert (a.status_code, a.json()["detail"]) == (b.status_code, b.json()["detail"])
    # users are listed only to administrators; a user's history only to them and admins
    assert c.get("/api/principals", headers=h).status_code == 403
    assert c.get("/api/principals", headers=adm).status_code == 200
    assert c.get("/api/ledger/admin", headers=h).status_code == 403
    assert c.get("/api/ledger/sci", headers=h).status_code == 200
    # reference data and system details need a session; the API docs are off by default
    assert c.get("/api/drivers").status_code == 401
    assert c.get("/api/system").status_code == 401
    assert c.get("/api/system", headers=h).is_success
    assert c.get("/docs").status_code == 404 and c.get("/openapi.json").status_code == 404


def test_first_run_token_is_logged_and_works(tmp_path, monkeypatch, caplog):
    monkeypatch.delenv("HOS_BOOTSTRAP_TOKEN", raising=False)
    k = Kernel(db=Database(f"sqlite:///{tmp_path / 'b.sqlite3'}"),
               files=FileStore(tmp_path / "objects"))
    with caplog.at_level("WARNING", logger="hos.api.app"), TestClient(create_app(k)) as c:
        token = next(r.args[0] for r in caplog.records if "setup token" in r.getMessage())
        assert c.post("/api/setup", json={"principal_id": "admin", "name": "A", "password": PW,
                                          "setup_token": "wrong"}).status_code == 403
        assert c.post("/api/setup", json={"principal_id": "admin", "name": "A", "password": PW,
                                          "setup_token": token}).status_code == 200
