"""SEND export over HTTP: Study Director protocol signature, export, download."""

import io
import zipfile

from hos.send.define import validate_define
from tests.api.test_api import CTX, PW, _login, api  # noqa: F401 - fixture
from tests.drivers.test_repeat_dose_tox import PARAMS as RD
from tests.drivers.test_toxicokinetics import PARAMS as TK_PARAMS
from tests.drivers.test_toxicokinetics import _file as tk_file
from tests.kernel.test_glp_flow import _lab_file
from tests.send.test_send_export import BASE, ENDPOINTS, FACTS, _animals


def _study(c, h, prog, cmp_id, requirement, params):
    sid = c.post("/api/studies", headers=h, json={
        "program_id": prog, "compound_id": cmp_id, "requirement_id": requirement}).json()["id"]
    assert c.post(f"/api/studies/{sid}/design", headers=h,
                  json={"parameters": params}).status_code == 200
    return sid


def _run(c, h, sid, content):
    c.post(f"/api/studies/{sid}/plan", headers=h)
    c.post(f"/api/studies/{sid}/dispatch", headers=h,
           json={"target": {"kind": "external_lab", "laboratory": "Example CRO"}})
    r = c.post(f"/api/studies/{sid}/data?filename=lab.csv", headers=h, content=content(sid))
    assert r.status_code == 200, r.text
    assert c.post(f"/api/studies/{sid}/analyze", headers=h, json={}).status_code == 200


def test_send_export_over_http(api):  # noqa: F811
    c = api
    adm = _login(c, "admin")
    for pid, name, roles in (("sci", "Sam Scientist", ["scientist", "responsible_scientist"]),
                             ("sd", "Dana Director", ["study_director"])):
        assert c.post("/api/principals", headers=adm, json={
            "principal_id": pid, "name": name, "kind": "human", "roles": roles,
            "password": PW}).status_code == 200
    h, sd = _login(c, "sci"), _login(c, "sd")
    prog = c.post("/api/programs", headers=h, json={"name": "SEND-API", "context": CTX}).json()
    cmp_id = c.post(f"/api/programs/{prog['id']}/compounds", headers=h,
                    json={"name": "paracetamol", "smiles": "CC(=O)Nc1ccc(O)cc1"}).json()["id"]
    rd = _study(c, h, prog["id"], cmp_id, "tox.repeat_dose_rodent", RD)
    statement = {"statement": "I approve this protocol as Study Director."}
    assert c.post(f"/api/studies/{rd}/protocol/sign", headers=h,
                  json={**statement, "password": PW}).status_code == 403
    assert c.post(f"/api/studies/{rd}/protocol/sign", headers=sd,
                  json={**statement, "password": "wrong password!"}).status_code == 403
    assert c.post(f"/api/studies/{rd}/protocol/sign", headers=sd,
                  json={**statement, "password": PW}).status_code == 200
    _run(c, h, rd, _lab_file)
    tk = _study(c, h, prog["id"], cmp_id, "tox.toxicokinetics", TK_PARAMS)
    _run(c, h, tk, lambda s: tk_file(ref=s))

    ctx = c.get(f"/api/studies/{rd}/send-export", headers=h).json()
    assert ctx["study_director"] == "Dana Director" and len(ctx["study_start"]) == 10
    assert [t["id"] for t in ctx["tk_studies"]] == [tk] and ctx["tk_studies"][0]["analysed"]
    assert {e["name"] for e in ctx["endpoints"]} == set(ENDPOINTS)
    assert ctx["recovery"] and ctx["exports"] == []

    bad = c.post(f"/api/studies/{rd}/send-export", headers=h, json={"facts": {}})
    assert bad.status_code == 422 and any(e.startswith("facts.studyid") for e in
                                          bad.json()["errors"])
    subjects = ctx["subjects"]
    spec = dict(facts=FACTS, endpoints=ENDPOINTS,
                animals=_animals([s["subject_id"] for s in subjects],
                                 [s["subject_id"] for s in subjects
                                  if s["phase"] == "recovery"]),
                timepoints={"day 29": 29}, recovery_timepoints={"day 29": 43},
                pk=dict(tk_study_id=tk, analyte_testcd="PARACET", analyte_test="Paracetamol",
                        specimen="PLASMA", concentration_unit="ng/mL", auc_unit="h*ng/mL",
                        time_unit="h", animals=_animals(
                            [s["subject_id"] for s in ctx["tk_studies"][0]["subjects"]])))
    rec = c.post(f"/api/studies/{rd}/send-export", headers=h, json=spec).json()
    assert rec["ok"], rec["errors"]
    z = zipfile.ZipFile(io.BytesIO(c.get(f"/api/files/{rec['package_sha256']}",
                                         headers=h).content))
    assert validate_define(z.read(f"{BASE}define.xml").decode()) == []
    exports = c.get(f"/api/studies/{rd}/send-export", headers=h).json()["exports"]
    assert [e["package_sha256"] for e in exports] == [rec["package_sha256"]]
    actions = [e["action"] for e in c.get(f"/api/ledger/{rd}", headers=h).json()]
    assert "study.protocol_signed" in actions and "study.send_exported" in actions
