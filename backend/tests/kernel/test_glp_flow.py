"""GLP repeat-dose study through the kernel: NOAEL by signed human determination only,
Study Director + QA approval."""

import csv
import io

import numpy as np
import pytest

from hos.kernel.attestation import Role, SignatureMeaning
from hos.kernel.errors import AttestationRequired, PermissionDenied
from tests.drivers.test_repeat_dose_tox import COMPOUND, PARAMS, SIM, D
from tests.kernel.test_kernel import CTX, k  # noqa: F401  (fixture)


def _lab_file(study_id: str) -> bytes:
    """A laboratory-format return file (test input) built from declared group means."""
    p = D.validate_parameters(PARAMS)
    rows, _ = D._simulate_rows(p, COMPOUND, D.simulation_parameters_model().model_validate(SIM),
                               np.random.default_rng(5))
    buf = io.StringIO()
    buf.write("# laboratory: Tox Lab\n# analyst: T. Path\n# run_date: 2026-09-30\n"
              f"# study_reference: {study_id}\n")
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["subject_id", "sex", "dose [mg/kg/day]", "phase", "endpoint", "timepoint", "unit",
                "value"])
    for r in rows:
        w.writerow([r["subject_id"], r["sex"], r["dose"], r["phase"], r["endpoint"],
                    r["timepoint"], r["unit"], r["value"]])
    return buf.getvalue().encode()


def test_glp_repeat_dose_noael_and_dual_signature(k):  # noqa: F811
    sci, sd, qa = (k.get_principal(x) for x in ("sci", "sd", "qa"))
    prog = k.create_program(sci, name="TOX", context=CTX)
    c = k.register_compound(sci, prog["id"], name="cmp", smiles="CC(=O)Nc1ccc(O)cc1")
    st = k.create_study(sci, program_id=prog["id"], compound_id=c["id"],
                        requirement_id="tox.repeat_dose_rodent")
    sid = st["id"]
    k.design_study(sci, sid, PARAMS)
    assert k.repo.study(sid).glp
    k.plan_study(sci, sid)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "GLP CRO",
                                "glp_certified": True})
    k.receive_data(sci, sid, _lab_file(sid))
    k.analyze_study(sci, sid)
    with pytest.raises(AttestationRequired):
        k.report_study(sci, sid)                       # NOAEL not yet determined
    with pytest.raises(PermissionDenied):
        k.record_determination(sci, sid, key="noael", value=30, unit="mg/kg/day",
                               rationale="scientist is not the study director")
    k.record_determination(sd, sid, key="noael", value=30, unit="mg/kg/day",
                           rationale="ALT and liver weight increases at 100 mg/kg/day judged "
                                     "adverse with correlating histopathology")
    v = k.report_study(sci, sid)
    assert "NOAEL determined by Dana Director" in v["report"]["markdown"]
    k.sign_study(sd, sid, role=Role.STUDY_DIRECTOR, meaning=SignatureMeaning.APPROVAL,
                 statement="I approve this report.")
    with pytest.raises(AttestationRequired):
        k.approve_study(sd, sid)                       # QA statement missing
    k.sign_study(qa, sid, role=Role.QUALITY_ASSURANCE, meaning=SignatureMeaning.QA_COMPLIANCE,
                 statement="QA inspections performed; report reflects raw data.")
    assert k.approve_study(sd, sid)["state"] == "approved"
    det = k.repo.study(sid).determinations[0]
    assert det["quantity"]["provenance"]["kind"] == "user_supplied"
    assert det["signature"]["role"] == "study_director"


def test_noael_not_established_is_recordable(k):  # noqa: F811
    sci, sd = k.get_principal("sci"), k.get_principal("sd")
    prog = k.create_program(sci, name="TOX2", context=CTX)
    c = k.register_compound(sci, prog["id"], name="cmp2", smiles="CCN")
    sid = k.create_study(sci, program_id=prog["id"], compound_id=c["id"],
                         requirement_id="tox.repeat_dose_rodent")["id"]
    k.design_study(sci, sid, PARAMS)
    k.plan_study(sci, sid)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "CRO"})
    k.receive_data(sci, sid, _lab_file(sid))
    k.analyze_study(sci, sid)
    v = k.record_determination(sd, sid, key="noael", value=None, unit="mg/kg/day",
                               rationale="adverse findings at the lowest dose")
    q = v["determinations"][0]["quantity"]
    assert not q["available"] and "not established" in q["provenance"]["reason"]
