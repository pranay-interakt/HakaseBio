"""Per-programme access (docs/15 P0.3). A user of organisation B gets 404 or 403 on every route
that names organisation A's objects; the routes are enumerated from the app, so a new route is
covered automatically. Membership lets a CRO in, on the record, and out again."""

import re

from fastapi.routing import APIRoute

from tests.api.test_api import PW, _login, api  # noqa: F401 - fixture
from tests.drivers.test_metabolic_stability import HL, PARAMS, _measured_csv
from tests.kernel.test_imports import REPORT

CTX = {"modality": "small_molecule", "indication": "chronic_non_oncology", "route": "oral",
       "intended_clinical_duration_days": 365, "max_trial_duration_days": 28}
SCOPED = {"program_id", "study_id", "compound_id", "sha", "subject_id"}


def _user(c, adm, pid, org, roles=("scientist", "responsible_scientist")):
    assert c.post("/api/principals", headers=adm, json={
        "principal_id": pid, "name": pid, "kind": "human", "roles": list(roles),
        "password": PW, "organisation": org}).status_code == 200
    return _login(c, pid)


def _org_a_world(c, a):
    prog = c.post("/api/programs", headers=a, json={"name": "A-1", "context": CTX}).json()["id"]
    cmp_ = c.post(f"/api/programs/{prog}/compounds", headers=a,
                  json={"name": "x", "smiles": "CC(=O)Oc1ccccc1C(=O)O"}).json()["id"]
    sid = c.post("/api/studies", headers=a, json={
        "program_id": prog, "compound_id": cmp_,
        "requirement_id": "adme.metabolic_stability"}).json()["id"]
    c.post(f"/api/studies/{sid}/design", headers=a, json={"parameters": PARAMS})
    c.post(f"/api/studies/{sid}/plan", headers=a)
    c.post(f"/api/studies/{sid}/dispatch", headers=a,
           json={"target": {"kind": "external_lab", "laboratory": "CRO"}})
    r = c.post(f"/api/studies/{sid}/data?filename=cro.csv", headers=a,
               content=_measured_csv(HL, ref=sid))
    assert r.status_code == 200
    sha = r.json()["raw_files"][0]["sha256"]
    imp = c.post(f"/api/programs/{prog}/imports", headers=a, content=REPORT, params={
        "compound_id": cmp_, "requirement_id": "genotox.ames", "filename": "ames.pdf",
        "title": "Ames", "laboratory": "Lab", "report_date": "2026-05-01", "glp": False}).json()
    return {"program_id": prog, "compound_id": cmp_, "study_id": sid, "sha": sha,
            "subject_id": sid, "import_id": imp["id"]}


def test_another_organisation_sees_nothing(api):  # noqa: F811
    c = api
    adm = _login(c, "admin")
    a = _user(c, adm, "a_sci", "Org A")
    b = _user(c, adm, "b_sci", "Org B")
    ids = _org_a_world(c, a)

    assert ids["program_id"] not in {p["id"] for p in c.get("/api/programs", headers=b).json()}
    assert c.get("/api/studies", headers=b).json() == []
    checked = 0
    for route in c.app.routes:
        if not isinstance(route, APIRoute):
            continue
        params = set(re.findall(r"{(\w+)}", route.path))
        if not params & SCOPED:
            continue
        for method in route.methods:
            path = route.path
            for p in params:
                value = ids.get(p, "dummy")
                if p == "study_id" and "/import" in route.path:
                    value = ids["import_id"]
                path = path.replace("{" + p + "}", value)
            r = c.request(method, path, headers=b, json={})
            assert r.status_code in (403, 404), (method, route.path, r.status_code, r.text[:200])
            assert ids["program_id"] not in r.text or r.status_code == 404
            checked += 1
    assert checked >= 45
    # ids in a request body are checked too
    r = c.post("/api/studies", headers=b, json={
        "program_id": ids["program_id"], "compound_id": ids["compound_id"],
        "requirement_id": "adme.metabolic_stability"})
    assert r.status_code == 404
    # and the owning organisation still has everything
    assert c.get(f"/api/studies/{ids['study_id']}", headers=a).status_code == 200
    assert c.get(f"/api/files/{ids['sha']}", headers=a).status_code == 200


def test_a_cro_is_let_in_on_the_record_and_out_again(api):  # noqa: F811
    c = api
    adm = _login(c, "admin")
    a = _user(c, adm, "a_sci", "Org A")
    cro = _user(c, adm, "cro_tech", "CRO Ltd", roles=("scientist",))
    ids = _org_a_world(c, a)
    prog, sid = ids["program_id"], ids["study_id"]
    assert c.get(f"/api/studies/{sid}", headers=cro).status_code == 404
    assert c.post(f"/api/programs/{prog}/members", headers=a,
                  json={"principal_id": "cro_tech", "reason": ""}).status_code == 422
    r = c.post(f"/api/programs/{prog}/members", headers=a,
               json={"principal_id": "cro_tech", "reason": "CRO running the Ames study"})
    assert r.status_code == 200 and r.json()["members"][0]["organisation"] == "CRO Ltd"
    assert c.get(f"/api/studies/{sid}", headers=cro).status_code == 200
    assert prog in {p["id"] for p in c.get("/api/programs", headers=cro).json()}
    # a guest cannot invite others
    assert c.post(f"/api/programs/{prog}/members", headers=cro,
                  json={"principal_id": "admin", "reason": "x"}).status_code == 403
    log = [e["action"] for e in c.get(f"/api/ledger/{prog}", headers=a).json()]
    assert "program.member_added" in log
    assert c.post(f"/api/programs/{prog}/members/cro_tech/remove", headers=a,
                  json={"reason": "study complete"}).status_code == 200
    assert c.get(f"/api/studies/{sid}", headers=cro).status_code == 404


def test_an_organisation_administrator_works_inside_it(api):  # noqa: F811
    c = api
    adm = _login(c, "admin")                                       # platform administrator
    a_adm = _user(c, adm, "a_admin", "Org A", roles=("admin",))
    _user(c, adm, "b_sci", "Org B")
    listed = {p["id"] for p in c.get("/api/principals", headers=a_adm).json()}
    assert "b_sci" not in listed and "a_admin" in listed
    r = c.post("/api/principals", headers=a_adm, json={
        "principal_id": "x", "name": "x", "kind": "human", "roles": ["scientist"],
        "password": PW, "organisation": "Org B"})
    assert r.status_code == 403
    r = c.post("/api/principals", headers=a_adm, json={
        "principal_id": "a2", "name": "a2", "kind": "human", "roles": ["scientist"],
        "password": PW})
    assert r.status_code == 200 and r.json()["organisation"] == "Org A"
    assert c.get("/api/ledger/b_sci", headers=a_adm).status_code == 403
