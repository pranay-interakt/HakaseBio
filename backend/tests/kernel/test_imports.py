"""Study import (docs/14 P1): transcription with page references, agent proposals that only a
human can confirm, GLP dual signature, readiness 'imported', Module 4 inclusion and supersession."""

import io
import zipfile

import pytest

from hos.ind import assemble_module4, readiness_report
from hos.kernel.attestation import Role, SignatureMeaning
from hos.kernel.errors import AttestationRequired, IllegalTransition, KernelError, PermissionDenied
from tests.kernel.test_kernel import CTX, k  # noqa: F401  (fixture)

REPORT = b"%PDF-1.4 test fixture: stands in for a CRO final report file in these tests\n"


def _setup(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="IMP", context=CTX)
    c = k.register_compound(sci, prog["id"], name="cmp", smiles="CC(=O)Nc1ccc(O)cc1")
    return sci, prog["id"], c["id"]


def _import(k, sci, pid, cid, req="tox.repeat_dose_rodent", glp=True):  # noqa: F811
    return k.imports.import_study(
        sci, program_id=pid, compound_id=cid, requirement_id=req, report=REPORT,
        filename="cro_final_report.pdf", title="28-day oral toxicity study in rats",
        laboratory="Example CRO", report_date="2026-06-30", glp=glp,
        lab_study_number="CRO-1234")


def test_full_glp_import_flow(k):  # noqa: F811
    sci, pid, cid = _setup(k)
    sd, qa = k.get_principal("sd"), k.get_principal("qa")
    v = _import(k, sci, pid, cid)
    sid = v["id"]
    assert v["state"] == "import_draft" and v["origin"] == "import"
    assert v["import"]["missing"] == ["NOAEL (noael)"]
    # no page reference, no value
    with pytest.raises(KernelError):
        k.imports.add_import_value(sci, sid, key="noael", page=" ", value=30, unit="mg/kg/day",
                                   species="rat")
    # NOAEL must name its species
    with pytest.raises(KernelError):
        k.imports.add_import_value(sci, sid, key="noael", page="12", value=30, unit="mg/kg/day")
    # incompatible unit
    with pytest.raises(KernelError):
        k.imports.add_import_value(sci, sid, key="noael", page="12", value=30, unit="mg",
                                   species="rat")
    v = k.imports.add_import_value(sci, sid, key="noael", page="12", table="3", value=30,
                                   unit="mg/kg/day", species="rat")
    val = v["import_record"]["values"][0]
    q = val["quantity"]
    assert q["provenance"]["kind"] == "measured"
    assert q["provenance"]["source_record_id"].startswith("sha256:")
    assert "page 12, table 3" in q["provenance"]["notes"] and val["attested_from_report"]
    assert not v["import"]["missing"]
    # GLP: Study Director approval alone is not enough
    k.imports.sign_import(sd, sid, role=Role.STUDY_DIRECTOR, meaning=SignatureMeaning.APPROVAL,
                          statement="Reviewed against the report.")
    with pytest.raises(AttestationRequired):
        k.imports.complete_import(sd, sid)
    k.imports.sign_import(qa, sid, role=Role.QUALITY_ASSURANCE,
                          meaning=SignatureMeaning.QA_COMPLIANCE, statement="QA verified.")
    sig = k.repo.study(sid).signatures[0]
    assert "transcribed from the report cro_final_report.pdf" in sig["statement"]
    v = k.imports.complete_import(sd, sid)
    assert v["state"] == "imported"
    # readiness: imported, never done
    r = readiness_report(k, pid)
    item = next(i for i in r["items"] if i["requirement_id"] == "tox.repeat_dose_rodent")
    assert item["status"] == "imported"
    assert r["summary"]["done"] == 0 and r["summary"]["imported"] == 1
    assert r["summary"]["percent_covered"] > 0
    # Module 4: original report + transcribed values; NOAEL drives the MRSD projection
    pkg = assemble_module4(k, sci, pid)
    sec = next(t for t in pkg["toc"] if t["section"] == "4.2.3.2")
    entry = sec["reports"][0]
    assert entry["imported"] and entry["values"][0]["status"].startswith("attested from report")
    assert pkg["dose_projection"]["projection"]["mrsd_per_kg"]["value"] == pytest.approx(30 * 6 / 37 / 10)
    with zipfile.ZipFile(io.BytesIO(k.files.get(pkg["bundle_sha256"]))) as z:
        assert z.read(f"m4/4.2.3.2/{sid}/cro_final_report.pdf") == REPORT
        assert "attested from report, not recomputed" in z.read(
            f"m4/4.2.3.2/{sid}/transcribed_values.md").decode()
    acts = [e["action"] for e in k.history(sid)]
    assert acts[:2] == ["import.created", "import.value_added"] and "import.completed" in acts


def test_agent_proposals_need_human_confirmation(k):  # noqa: F811
    sci, pid, cid = _setup(k)
    agent = k.get_principal("agent")
    sid = _import(k, sci, pid, cid, req="genotox.ames", glp=False)["id"]
    # agents cannot transcribe directly or create imports
    with pytest.raises(PermissionDenied):
        k.imports.add_import_value(agent, sid, key="overall_call", page="4", category="negative")
    with pytest.raises(KernelError):
        k.imports.propose_import_value(agent, sid, key="overall_call", page="", category="negative")
    v = k.imports.propose_import_value(agent, sid, key="overall_call", page="4",
                                       category="negative", excerpt="...was not mutagenic...")
    prop = v["import_record"]["proposals"][0]
    assert v["import"]["missing"] == ["Overall result (overall_call)"]  # not a value yet
    with pytest.raises(PermissionDenied):
        k.imports.confirm_import_proposal(agent, sid, prop["id"])
    v = k.imports.confirm_import_proposal(sci, sid, prop["id"])
    assert v["import_record"]["values"][0]["origin"] == f"proposal:{prop['id']}"
    assert v["import_record"]["values"][0]["category"] == "negative"
    assert not v["import"]["missing"]
    # categorical results reject numbers and unknown categories
    with pytest.raises(KernelError):
        k.imports.add_import_value(sci, sid, key="overall_call", page="4", category="maybe")
    # non-GLP: a responsible scientist signs and completes
    k.imports.sign_import(sci, sid, role=Role.RESPONSIBLE_SCIENTIST,
                          meaning=SignatureMeaning.APPROVAL, statement="")
    assert k.imports.complete_import(sci, sid)["state"] == "imported"


def test_change_after_signing_invalidates_signature(k):  # noqa: F811
    sci, pid, cid = _setup(k)
    sid = _import(k, sci, pid, cid, req="safety.herg", glp=False)["id"]
    k.imports.add_import_value(sci, sid, key="herg_ic50", page="7", value=12.0, unit="uM")
    k.imports.sign_import(sci, sid, role=Role.RESPONSIBLE_SCIENTIST,
                          meaning=SignatureMeaning.APPROVAL, statement="ok")
    vid = k.repo.study(sid).import_record["values"][0]["id"]
    with pytest.raises(KernelError):
        k.imports.withdraw_import_value(sci, sid, vid, reason=" ")
    k.imports.withdraw_import_value(sci, sid, vid, reason="mis-keyed; report says 1.2 uM")
    k.imports.add_import_value(sci, sid, key="herg_ic50", page="7", value=1.2, unit="uM")
    with pytest.raises(AttestationRequired):
        k.imports.complete_import(sci, sid)  # signature bound to the earlier content
    k.imports.sign_import(sci, sid, role=Role.RESPONSIBLE_SCIENTIST,
                          meaning=SignatureMeaning.APPROVAL, statement="re-signed")
    v = k.imports.complete_import(sci, sid)
    vals = v["import_record"]["values"]
    assert vals[0]["withdrawn"]["reason"].startswith("mis-keyed") and len(vals) == 2
    with pytest.raises(KernelError):
        k.imports.add_import_value(sci, sid, key="herg_ic50", page="7", value=1.0, unit="uM")


def test_import_rules(k):  # noqa: F811
    sci, pid, cid = _setup(k)
    agent = k.get_principal("agent")
    with pytest.raises(PermissionDenied):
        _import(k, agent, pid, cid)
    with pytest.raises(KernelError):
        k.imports.import_study(sci, program_id=pid, compound_id=cid, requirement_id="safety.herg",
                               report=b"", filename="r.pdf", title="t", laboratory="l",
                               report_date="2026-01-01", glp=False)
    with pytest.raises(KernelError):
        k.imports.import_study(sci, program_id=pid, compound_id=cid, requirement_id="safety.herg",
                               report=REPORT, filename="r.pdf", title="t", laboratory="l",
                               report_date="30/06/2026", glp=False)
    sid = _import(k, sci, pid, cid, req="adme.plasma_protein_binding", glp=False)["id"]
    with pytest.raises(AttestationRequired):  # generic requirement: at least one result
        k.imports.sign_import(sci, sid, role=Role.RESPONSIBLE_SCIENTIST,
                              meaning=SignatureMeaning.APPROVAL, statement="")
    with pytest.raises(KernelError):  # literature values need the full citation
        k.imports.add_import_value(sci, sid, key="fu_plasma_human", page="3", value=0.1,
                                   unit="dimensionless", kind="literature")
    # the driver lifecycle is closed to imported studies
    with pytest.raises(IllegalTransition):
        k.design_study(sci, sid, {}, reason="x")


def test_supersession_by_driver_run_study(k):  # noqa: F811
    from tests.ind.test_ind import _approved_metstab
    sci, pid, cid = _setup(k)
    sid = _import(k, sci, pid, cid, req="adme.metabolic_stability", glp=False)["id"]
    k.imports.add_import_value(sci, sid, key="clint_app_human", label="CLint,app (human)",
                               page="9", value=25.0, unit="uL/min/mg")
    k.imports.sign_import(sci, sid, role=Role.RESPONSIBLE_SCIENTIST,
                          meaning=SignatureMeaning.APPROVAL, statement="")
    k.imports.complete_import(sci, sid)
    with pytest.raises(KernelError):
        k.imports.supersede_import(sci, sid, by_study_id=sid, reason="self")
    run = _approved_metstab(k, sci, pid, cid)
    r = readiness_report(k, pid)
    assert next(i for i in r["items"]
                if i["requirement_id"] == "adme.metabolic_stability")["status"] == "done"
    v = k.imports.supersede_import(sci, sid, by_study_id=run, reason="driver-run study approved")
    assert v["state"] == "superseded"
    assert v["import_record"]["superseded_by"]["study_id"] == run
    pkg = assemble_module4(k, sci, pid)
    assert pkg["imported_studies"] == 0 and pkg["included_studies"] == 1


def test_import_over_http(tmp_path):
    from fastapi.testclient import TestClient

    from hos.api import create_app
    from hos.db.store import Database, FileStore
    from hos.kernel.kernel import Kernel
    pw = "correct horse battery staple"
    kern = Kernel(db=Database(f"sqlite:///{tmp_path / 'h.sqlite3'}"),
                  files=FileStore(tmp_path / "o"))
    c = TestClient(create_app(kern, bootstrap_token="t"))
    c.post("/api/setup", json={"principal_id": "admin", "name": "A", "password": pw,
                               "setup_token": "t"})
    adm = {"Authorization": "Bearer " + c.post(
        "/api/auth/login", json={"principal_id": "admin", "password": pw}).json()["token"]}
    c.post("/api/principals", headers=adm, json={
        "principal_id": "s", "name": "S", "kind": "human",
        "roles": ["scientist", "responsible_scientist"], "password": pw})
    h = {"Authorization": "Bearer " + c.post(
        "/api/auth/login", json={"principal_id": "s", "password": pw}).json()["token"]}
    prog = c.post("/api/programs", headers=h, json={"name": "P", "context": {
        "modality": "small_molecule", "indication": "chronic_non_oncology", "route": "oral",
        "intended_clinical_duration_days": 365, "max_trial_duration_days": 28}}).json()
    cmp_ = c.post(f"/api/programs/{prog['id']}/compounds", headers=h,
                  json={"name": "x", "smiles": "CCO"}).json()
    assert c.get("/api/requirements/genotox.ames/import-fields",
                 headers=h).json()[0]["key"] == "overall_call"
    r = c.post(f"/api/programs/{prog['id']}/imports", headers=h, content=REPORT, params={
        "compound_id": cmp_["id"], "requirement_id": "genotox.ames", "filename": "ames.pdf",
        "title": "Ames test", "laboratory": "Lab", "report_date": "2026-05-01", "glp": "false"})
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert c.post(f"/api/studies/{sid}/import/values", headers=h, json={
        "key": "overall_call", "page": "", "category": "negative"}).status_code == 400
    c.post(f"/api/studies/{sid}/import/values", headers=h,
           json={"key": "overall_call", "page": "5", "category": "negative"})
    sign = {"role": "responsible_scientist", "meaning": "approval", "statement": "ok"}
    assert c.post(f"/api/studies/{sid}/import/sign", headers=h,
                  json={**sign, "password": "wrong password!"}).status_code == 403
    assert c.post(f"/api/studies/{sid}/import/sign", headers=h,
                  json={**sign, "password": pw}).status_code == 200
    v = c.post(f"/api/studies/{sid}/import/complete", headers=h, json={"password": pw}).json()
    assert v["state"] == "imported"
    assert c.get(f"/api/studies/{sid}/import/report", headers=h).content == REPORT
