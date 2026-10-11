"""Kernel facade end to end on a real (temporary) SQLite database."""

import pytest
from sqlalchemy import text

from hos.core.regulatory import Indication, Modality, ProgramContext, Route
from hos.db.store import Database, FileStore
from hos.drivers.base import IngestError
from hos.kernel.attestation import PrincipalKind, Role, SignatureMeaning
from hos.kernel.errors import (
    AttestationRequired, DriverError, EvidenceInadmissible, KernelError, LedgerIntegrityError,
    PermissionDenied,
)
from hos.kernel.kernel import Kernel
from tests.drivers.test_metabolic_stability import HL, PARAMS, SIM, _measured_csv

PW = "correct horse battery staple"
CTX = ProgramContext(modality=Modality.SMALL_MOLECULE, indication=Indication.CHRONIC_NON_ONCOLOGY,
                     route=Route.ORAL, intended_clinical_duration_days=365,
                     max_trial_duration_days=28)
FU = {"fu_plasma.human": {"value": 0.1, "unit": "dimensionless", "kind": "measured",
                          "source": "PPB study STU-x (equilibrium dialysis)"},
      "blood_plasma_ratio.human": {"value": 1.0, "unit": "dimensionless",
                                   "kind": "user_supplied", "note": "assumed pending B:P study"}}


@pytest.fixture()
def k(tmp_path):
    kern = Kernel(db=Database(f"sqlite:///{tmp_path / 'hos.sqlite3'}"),
                  files=FileStore(tmp_path / "objects"))
    admin = kern.register_principal(None, principal_id="admin", name="Ada Admin",
                                    kind=PrincipalKind.HUMAN, roles=[Role.ADMIN], password=PW)
    for pid, name, roles in (("sci", "Sam Scientist", [Role.SCIENTIST, Role.RESPONSIBLE_SCIENTIST]),
                             ("sd", "Dana Director", [Role.STUDY_DIRECTOR]),
                             ("qa", "Quinn QA", [Role.QUALITY_ASSURANCE])):
        kern.register_principal(admin, principal_id=pid, name=name, kind=PrincipalKind.HUMAN,
                                roles=roles, password=PW)
    kern.register_principal(admin, principal_id="agent", name="Design agent",
                            kind=PrincipalKind.AGENT, roles=[Role.SCIENTIST])
    return kern


def _setup(k):
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="HOS-001", context=CTX, sponsor="Example Bio")
    cmp_ = k.register_compound(sci, prog["id"], name="aspirin", smiles="CC(=O)Oc1ccccc1C(=O)O")
    st = k.create_study(sci, program_id=prog["id"], compound_id=cmp_["id"],
                        requirement_id="adme.metabolic_stability",
                        hypothesis="CLint is low enough to support once-daily dosing")
    assert st["parameters"]["species"] == ["human", "rat", "dog"]  # prefilled from requirement
    k.design_study(sci, st["id"], PARAMS)
    k.plan_study(sci, st["id"])
    return sci, prog, st["id"]


def test_measured_study_full_lifecycle_to_approval(k):
    sci, _, sid = _setup(k)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "Example CRO",
                                "quote_reference": "Q-77"})
    assert k.dispatch_bundle(sid)[:2] == b"PK"
    k.receive_data(sci, sid, _measured_csv(HL, ref=sid), filename="cro_return.csv")
    k.set_analysis_inputs(sci, sid, FU)
    v = k.analyze_study(sci, sid)
    assert v["evidence_admissible"]
    clh = v["results"]["quantities"]["human.clh"]
    assert clh["available"] and clh["provenance"]["kind"] == "computed"
    v = k.report_study(sci, sid)
    with pytest.raises(AttestationRequired):
        k.approve_study(sci, sid)
    k.sign_study(sci, sid, role=Role.RESPONSIBLE_SCIENTIST, meaning=SignatureMeaning.APPROVAL,
                 statement="I approve this report as an accurate account of the study.")
    v = k.approve_study(sci, sid)
    assert v["state"] == "approved"
    actions = [e["action"] for e in k.history(sid)]
    for a in ("study.created", "study.designed", "study.planned", "study.dispatched",
              "data.received", "study.inputs_set", "study.analyzed", "study.reported",
              "study.signed", "study.approved"):
        assert a in actions
    assert k.verify_ledger() == len(k.ledger.entries())
    assert [a["kind"] for a in k.artifacts(sid)].count("report") == 1


def test_simulated_study_can_never_be_approved(k):
    sci, _, sid = _setup(k)
    k.dispatch_study(sci, sid, {"kind": "simulation", "simulation_parameters": SIM, "seed": 1})
    v = k.receive_data(sci, sid)
    assert v["simulated"] and not v["evidence_admissible"]
    k.analyze_study(sci, sid)
    v = k.report_study(sci, sid)
    assert "SIMULATED" in v["report"]["markdown"]
    k.sign_study(sci, sid, role=Role.RESPONSIBLE_SCIENTIST, meaning=SignatureMeaning.APPROVAL,
                 statement="approve")
    with pytest.raises(EvidenceInadmissible):
        k.approve_study(sci, sid)
    assert "study.approval_refused" in [e["action"] for e in k.history(sid)]


def test_simulated_file_cannot_be_laundered_as_measured(k):
    sci, prog, sid = _setup(k)
    k.dispatch_study(sci, sid, {"kind": "simulation", "simulation_parameters": SIM, "seed": 2})
    sim_bytes = k.files.get(k.repo.study(sid).execution["simulated_file"])
    st2 = k.create_study(sci, program_id=prog["id"], compound_id=k.repo.study(sid).compound_id,
                         requirement_id="adme.metabolic_stability")
    k.design_study(sci, st2["id"], PARAMS)
    k.plan_study(sci, st2["id"])
    k.dispatch_study(sci, st2["id"], {"kind": "external_lab", "laboratory": "CRO"})
    # same bytes with a different study reference would fail ingest; the hash check comes first
    with pytest.raises(IngestError):
        k.receive_data(sci, st2["id"], sim_bytes)
    assert "data.origin_overridden" in [e["action"] for e in k.history(st2["id"])]


def test_rejected_upload_is_recorded_with_errors(k):
    sci, _, sid = _setup(k)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "CRO"})
    with pytest.raises(IngestError):
        k.receive_data(sci, sid, b"garbage,file\n1,2\n")
    rej = [e for e in k.history(sid) if e["action"] == "data.rejected"]
    assert rej and rej[0]["payload"]["errors"]
    assert k.repo.study(sid).state == "dispatched"


def test_agents_can_work_but_never_sign(k):
    sci, _, sid = _setup(k)
    agent = k.get_principal("agent")
    k.design_study(agent, sid, PARAMS, reason="agent re-design for test")
    k.plan_study(agent, sid)
    k.dispatch_study(agent, sid, {"kind": "external_lab", "laboratory": "CRO"})
    k.receive_data(agent, sid, _measured_csv(HL, ref=sid))
    k.analyze_study(agent, sid)
    k.report_study(agent, sid)
    with pytest.raises(PermissionDenied):
        k.sign_study(agent, sid, role=Role.SCIENTIST, meaning=SignatureMeaning.REVIEW,
                     statement="x")
    with pytest.raises(PermissionDenied):
        k.approve_study(agent, sid)


def test_signature_on_superseded_report_does_not_count(k):
    sci, _, sid = _setup(k)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "CRO"})
    k.receive_data(sci, sid, _measured_csv(HL, ref=sid))
    k.analyze_study(sci, sid)
    k.report_study(sci, sid)
    k.sign_study(sci, sid, role=Role.RESPONSIBLE_SCIENTIST, meaning=SignatureMeaning.APPROVAL,
                 statement="approve v1")
    k.analyze_study(sci, sid, reason="re-analysis after review")
    k.set_analysis_inputs(sci, sid, FU)
    k.analyze_study(sci, sid, reason="inputs supplied")
    v = k.report_study(sci, sid)
    assert v["approval_missing"]
    with pytest.raises(AttestationRequired):
        k.approve_study(sci, sid)


def test_amendment_needs_reason_and_protocol_hash_is_guarded(k):
    sci, _, sid = _setup(k)
    with pytest.raises(KernelError):
        k.design_study(sci, sid, PARAMS)
    with k.db.session() as s:
        s.execute(text("UPDATE studies SET protocol_hash='0000' WHERE id=:i"), {"i": sid})
    with pytest.raises(DriverError):
        k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "CRO"})


def test_ledger_tampering_is_detected(k):
    _setup(k)
    with k.db.session() as s:
        s.execute(text("UPDATE ledger SET payload='{\"forged\": true}' WHERE seq=3"))
    with pytest.raises(LedgerIntegrityError):
        k.verify_ledger()


def test_authentication_and_bootstrap_rules(k):
    assert k.authenticate("sd", PW).name == "Dana Director"
    with pytest.raises(PermissionDenied):
        k.authenticate("sd", "wrong password!!")
    assert any(e["action"] == "auth.failed" for e in k.history("sd"))
    with pytest.raises(PermissionDenied):
        k.register_principal(k.get_principal("sci"), principal_id="x", name="x",
                             kind=PrincipalKind.HUMAN, roles=[Role.SCIENTIST], password=PW)
    with pytest.raises(PermissionDenied):
        k.register_principal(k.get_principal("admin"), principal_id="bot", name="bot",
                             kind=PrincipalKind.AGENT, roles=[Role.STUDY_DIRECTOR])


def test_waived_requirement_cannot_be_started(k):
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="ONC", context=ProgramContext(
        modality=Modality.SMALL_MOLECULE, indication=Indication.ADVANCED_CANCER, route=Route.ORAL,
        intended_clinical_duration_days=90, max_trial_duration_days=28))
    c = k.register_compound(sci, prog["id"], name="x", smiles="CCO")
    with pytest.raises(KernelError):
        k.create_study(sci, program_id=prog["id"], compound_id=c["id"],
                       requirement_id="carc.bioassay")
    with pytest.raises(DriverError):
        k.create_study(sci, program_id=prog["id"], compound_id=c["id"],
                       requirement_id="genotox.battery")
