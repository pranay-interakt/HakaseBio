"""IND readiness and Module 4 assembly."""

import io
import json
import zipfile

import pytest

from hos.ind import assemble_module4, readiness_report
from hos.kernel.attestation import Role, SignatureMeaning
from hos.kernel.errors import EvidenceInadmissible
from tests.drivers.test_metabolic_stability import HL, _measured_csv
from tests.drivers.test_metabolic_stability import PARAMS as MS_PARAMS
from tests.drivers.test_metabolic_stability import SIM as MS_SIM
from tests.drivers.test_repeat_dose_tox import PARAMS as RD_PARAMS
from tests.kernel.test_glp_flow import _lab_file
from tests.kernel.test_kernel import CTX, k  # noqa: F401


def _program(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="IND-1", context=CTX)
    c = k.register_compound(sci, prog["id"], name="cmp", smiles="CC(=O)Nc1ccc(O)cc1")
    return sci, prog["id"], c["id"]


def _approved_metstab(k, sci, pid, cid):  # noqa: F811
    sid = k.create_study(sci, program_id=pid, compound_id=cid,
                         requirement_id="adme.metabolic_stability")["id"]
    k.design_study(sci, sid, MS_PARAMS)
    k.plan_study(sci, sid)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "CRO"})
    k.receive_data(sci, sid, _measured_csv(HL, ref=sid))
    k.analyze_study(sci, sid)
    k.report_study(sci, sid)
    k.sign_study(sci, sid, role=Role.RESPONSIBLE_SCIENTIST, meaning=SignatureMeaning.APPROVAL,
                 statement="approve")
    k.approve_study(sci, sid)
    return sid


def test_readiness_on_a_new_programme(k):  # noqa: F811
    _sci, pid, _ = _program(k)
    r = readiness_report(k, pid)
    s = r["summary"]
    assert s["done"] == 0 and s["required_for_milestone"] > 0
    ms = next(i for i in r["items"] if i["requirement_id"] == "adme.metabolic_stability")
    assert ms["status"] == "missing" and ms["driver_available"]
    # driver availability follows the registry, whatever drivers are installed
    reg = k.registry
    for i in r["items"]:
        if i["status"] == "missing" and not i["components"]:
            served = any(i["requirement_id"] in reg.get(d).requirement_ids for d in reg.ids())
            assert i["driver_available"] == served, i["requirement_id"]
    cb = next(i for i in r["items"] if i["requirement_id"] == "safety.core_battery")
    parts = {c for d in reg.ids() for c in reg.get(d).components_for("safety.core_battery")}
    assert cb["driver_available"] == (parts >= {"cns", "cardiovascular", "respiratory"})
    assert "UV-visible absorption spectrum" in s["conditional_pending_facts"]


def test_readiness_progress_and_simulation_never_counts(k):  # noqa: F811
    sci, pid, cid = _program(k)
    _approved_metstab(k, sci, pid, cid)
    k.create_study(sci, program_id=pid, compound_id=cid,
                         requirement_id="safety.herg")["id"]
    r = readiness_report(k, pid)
    st = {i["requirement_id"]: i["status"] for i in r["items"]}
    assert st["adme.metabolic_stability"] == "done"
    assert st["safety.herg"] == "in_progress"
    # a programme whose only metabolic-stability study is simulated
    sci2, pid2, cid2 = _program_named(k, "IND-2")
    sid = k.create_study(sci2, program_id=pid2, compound_id=cid2,
                         requirement_id="adme.metabolic_stability")["id"]
    k.design_study(sci2, sid, MS_PARAMS)
    k.plan_study(sci2, sid)
    k.dispatch_study(sci2, sid, {"kind": "simulation", "simulation_parameters": MS_SIM, "seed": 1})
    k.receive_data(sci2, sid)
    k.cancel_study(sci2, sid, reason="demo only")
    st2 = {i["requirement_id"]: i["status"] for i in readiness_report(k, pid2)["items"]}
    assert st2["adme.metabolic_stability"] == "simulated_only"


def _program_named(k, name):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name=name, context=CTX)
    c = k.register_compound(sci, prog["id"], name=name, smiles="c1ccccc1O")
    return sci, prog["id"], c["id"]


def test_module4_assembly_with_noael_dose_projection(k):  # noqa: F811
    sci, pid, cid = _program(k)
    sd, qa = k.get_principal("sd"), k.get_principal("qa")
    ms = _approved_metstab(k, sci, pid, cid)
    rd = k.create_study(sci, program_id=pid, compound_id=cid,
                        requirement_id="tox.repeat_dose_rodent")["id"]
    k.design_study(sci, rd, RD_PARAMS)
    k.plan_study(sci, rd)
    k.dispatch_study(sci, rd, {"kind": "external_lab", "laboratory": "GLP CRO"})
    k.receive_data(sci, rd, _lab_file(rd))
    k.analyze_study(sci, rd)
    k.record_determination(sd, rd, key="noael", value=30, unit="mg/kg/day",
                           rationale="adverse liver findings at 100 mg/kg/day")
    k.report_study(sci, rd)
    k.sign_study(sd, rd, role=Role.STUDY_DIRECTOR, meaning=SignatureMeaning.APPROVAL,
                 statement="approve")
    k.sign_study(qa, rd, role=Role.QUALITY_ASSURANCE, meaning=SignatureMeaning.QA_COMPLIANCE,
                 statement="QA statement")
    k.approve_study(sd, rd)
    pkg = assemble_module4(k, sci, pid)
    secs = {t["section"]: t["reports"] for t in pkg["toc"]}
    assert [r["study_id"] for r in secs["4.2.2.4"]] == [ms]
    assert [r["study_id"] for r in secs["4.2.3.2"]] == [rd]
    assert {s["role"] for s in secs["4.2.3.2"][0]["signatures"]} == {"study_director",
                                                                     "quality_assurance"}
    # FDA 2005: rat NOAEL 30 -> HED 30*6/37 -> MRSD /10
    mrsd = pkg["dose_projection"]["projection"]["mrsd_per_kg"]["value"]
    assert mrsd == pytest.approx(30 * 6 / 37 / 10)
    bundle = k.files.get(pkg["bundle_sha256"])
    with zipfile.ZipFile(io.BytesIO(bundle)) as z:
        names = set(z.namelist())
        assert f"m4/4.2.3.2/{rd}.md" in names and "m4/index.md" in names
        assert json.loads(z.read("m4/index.json"))["package_hash"] == pkg["package_hash"]
    assert "ind.module4_assembled" in [e["action"] for e in k.history(pid)]


def test_assembler_refuses_simulated_content():
    from hos.ind.assembler import _check_no_simulation
    with pytest.raises(EvidenceInadmissible):
        _check_no_simulation({"sections": [{"tables": [{"rows": [[{"provenance":
                              {"kind": "simulated"}}]]}]}]})
    with pytest.raises(EvidenceInadmissible):
        _check_no_simulation({"q": {"qc_flags": ["derived_from_simulated_data"]}})


def _imported_core_battery(k, sci, pid, cid, components):  # noqa: F811
    sid = k.imports.import_study(
        sci, program_id=pid, compound_id=cid, requirement_id="safety.core_battery",
        report=b"%PDF-1.4 core battery report", filename="sp.pdf", title="Safety pharmacology",
        laboratory="CRO", report_date="2026-06-30", glp=False, components=components)["id"]
    k.imports.add_import_value(sci, sid, key="overall_conclusion", page="5",
                               category="no_effect_identified")
    k.imports.sign_import(sci, sid, role=Role.RESPONSIBLE_SCIENTIST,
                          meaning=SignatureMeaning.APPROVAL, statement="Reviewed.")
    k.imports.complete_import(sci, sid)
    return sid


def test_core_battery_is_done_only_when_every_s7a_part_is_covered(k):  # noqa: F811
    sci, pid, cid = _program(k)
    item = lambda: next(i for i in readiness_report(k, pid)["items"]  # noqa: E731
                        if i["requirement_id"] == "safety.core_battery")
    assert item()["status"] == "missing"
    assert item()["components"]["missing"] == ["cns", "cardiovascular", "respiratory"]
    _imported_core_battery(k, sci, pid, cid, ["cns"])
    i = item()
    assert i["status"] == "partial" and i["components"]["imported"] == ["cns"]
    assert i["components"]["missing"] == ["cardiovascular", "respiratory"]
    _imported_core_battery(k, sci, pid, cid, ["cardiovascular", "respiratory"])
    assert item()["status"] == "imported" and not item()["components"]["missing"]


def test_core_battery_import_must_name_its_parts(k):  # noqa: F811
    from hos.kernel.errors import KernelError
    sci, pid, cid = _program(k)
    for bad in (None, [], ["renal"]):
        with pytest.raises(KernelError, match="parts"):
            k.imports.import_study(
                sci, program_id=pid, compound_id=cid, requirement_id="safety.core_battery",
                report=b"%PDF", filename="sp.pdf", title="SP", laboratory="CRO",
                report_date="2026-06-30", glp=False, components=bad)
    with pytest.raises(KernelError, match="no parts"):
        k.imports.import_study(
            sci, program_id=pid, compound_id=cid, requirement_id="safety.herg",
            report=b"%PDF", filename="h.pdf", title="hERG", laboratory="CRO",
            report_date="2026-06-30", glp=False, components=["cns"])
