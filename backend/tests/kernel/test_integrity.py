"""Reconciliation and anchoring (docs/15 P0.2): edits made straight to the database, a deleted
ledger tail and a rewritten chain are all detected, although the chain alone still verifies."""

import json

import pytest
from sqlalchemy import text

from hos.core.regulatory import Indication, Modality, PeptideOrigin, ProgramContext, Route
from hos.db.repository import content_hash
from hos.kernel.attestation import Role, SignatureMeaning
from hos.kernel.ledger import LedgerEntry
from tests.kernel.test_imports import REPORT
from tests.kernel.test_kernel import CTX, FU, HL, PARAMS, _measured_csv, k  # noqa: F401


def _world(k):  # noqa: F811
    """One of everything the reconciler checks."""
    sci, sd = k.get_principal("sci"), k.get_principal("sd")
    prog = k.create_program(sci, name="I-1", context=CTX)["id"]
    cid = k.register_compound(sci, prog, name="c", smiles="CC(=O)Nc1ccc(O)cc1")["id"]
    sid = k.create_study(sci, program_id=prog, compound_id=cid,
                         requirement_id="adme.metabolic_stability")["id"]
    k.design_study(sci, sid, PARAMS)
    k.plan_study(sci, sid)
    k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "CRO"})
    k.receive_data(sci, sid, _measured_csv(HL, ref=sid))
    k.set_analysis_inputs(sci, sid, FU)
    k.analyze_study(sci, sid)
    k.report_study(sci, sid)
    k.sign_study(sci, sid, role=Role.RESPONSIBLE_SCIENTIST, meaning=SignatureMeaning.APPROVAL,
                 statement="approve")
    k.approve_study(sci, sid)
    imp = k.imports.import_study(sci, program_id=prog, compound_id=cid,
                                 requirement_id="genotox.ames", report=REPORT,
                                 filename="ames.pdf", title="Ames", laboratory="Lab",
                                 report_date="2026-05-01", glp=False)["id"]
    k.imports.add_import_value(sci, imp, key="overall_call", page="5", category="negative")
    k.imports.sign_import(sci, imp, role=Role.RESPONSIBLE_SCIENTIST,
                          meaning=SignatureMeaning.APPROVAL, statement="")
    k.imports.complete_import(sci, imp)
    pep = k.create_program(sci, name="I-P", context=ProgramContext(
        modality=Modality.PEPTIDE, indication=Indication.CHRONIC_NON_ONCOLOGY,
        route=Route.SUBCUTANEOUS, intended_clinical_duration_days=365,
        max_trial_duration_days=28, peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS))["id"]
    bio = k.register_biologic(sci, pep, name="p", entity={"format": "sequence", "chains": [
        {"name": "p", "role": "peptide", "sequence": "HAEGTFTSDV", "copies": 1}]})["id"]
    k.record_program_determination(sci, pep, key="s6_principles_apply", applies=True,
                                   rationale="target conserved")
    return {"prog": prog, "cid": cid, "sid": sid, "imp": imp, "pep": pep, "bio": bio, "sd": sd}


def _sql(k, stmt, **params):  # noqa: F811
    with k.db.session() as s:
        s.execute(text(stmt), params)


def _checks(k):  # noqa: F811
    report = k.integrity()
    return {f["check"] for f in report["findings"]}


def test_a_genuine_record_reconciles_and_is_anchored(k):  # noqa: F811
    _world(k)
    report = k.integrity()
    assert report["valid"], report["findings"]
    assert report["anchors"] > 10
    assert k.anchors.checkpoints()[-1]["head"] == k.ledger.head


@pytest.mark.parametrize(("table", "edit", "check"), [
    ("studies", "state='reported'", "state follows from its last event"),
    ("principals", "roles='[\"admin\", \"study_director\"]'",
     "principal matches its registration and role changes"),
    ("compounds", "smiles='CCO'", "structure matches its registration"),
])
def test_direct_edits_to_rows_are_detected(k, table, edit, check):  # noqa: F811
    w = _world(k)
    target = {"studies": w["sid"], "principals": "sd", "compounds": w["cid"]}[table]
    _sql(k, f"UPDATE {table} SET {edit} WHERE id=:id", id=target)
    assert k.verify_ledger() > 0                       # the chain itself still verifies
    assert check in _checks(k)


def test_edited_content_is_detected(k):  # noqa: F811
    w = _world(k)
    row = k.repo.study(w["sid"])
    report = dict(row.report)
    report["markdown"] = report["markdown"].replace("approve", "x") + "\nAll clear.\n"
    results = json.loads(json.dumps(row.results))
    results["notes"] = ["edited"]
    sigs = [*row.signatures, {**row.signatures[0], "statement": "forged"}]
    k.repo.update_study(w["sid"], report=report, results=results, signatures=sigs)
    prog = k.repo.program(w["prog"])
    k.repo.update_program(w["prog"], context={**prog.context, "max_trial_duration_days": 999})
    checks = _checks(k)
    for c in ("rendered report matches its event", "analysis matches its event and recomputes",
              "signatures are exactly those recorded",
              "context matches the study set derived from it"):
        assert c in checks, checks


def test_an_unrecorded_guest_and_a_changed_sequence_are_detected(k):  # noqa: F811
    from hos.core.provenance import utc_now
    from hos.db.models import ProgramMemberRow
    w = _world(k)
    k.repo.add(ProgramMemberRow(program_id=w["prog"], principal_id="qa", added_by="x",
                                added_at=utc_now()))
    ent = k.repo.compound(w["bio"]).entity
    ent["spec"]["chains"][0]["sequence"] = "HAEGTFTSDA"
    k.repo.update_compound(w["bio"], entity=json.loads(json.dumps(ent)))
    checks = _checks(k)
    assert "guests replay from their membership events" in checks
    assert "sequence matches its registration" in checks


def test_a_deleted_ledger_tail_is_detected_by_the_anchors(k):  # noqa: F811
    _world(k)
    n = len(k.ledger.entries())
    _sql(k, "DELETE FROM ledger WHERE seq > :n", n=n - 3)
    assert k.verify_ledger() == n - 3                  # a shorter chain is still a valid chain
    assert "chain reaches every checkpoint" in _checks(k)


def test_a_rewritten_chain_is_detected_by_the_anchors(k):  # noqa: F811
    """Someone with database access forges entry 5 and re-hashes everything after it: the
    chain verifies again, but no longer passes through the anchored heads."""
    _world(k)
    entries = k.ledger.entries()
    prev = entries[4].prev_hash
    with k.db.session() as s:
        for e in entries[4:]:
            body = {**e.body(), "prev_hash": prev}
            if e.seq == 5:
                body["actor_id"] = "someone-else"
            prev = LedgerEntry.hash_of(body)
            s.execute(text("UPDATE ledger SET actor_id=:a, prev_hash=:p, entry_hash=:h "
                           "WHERE seq=:seq"), {"a": body["actor_id"], "p": body["prev_hash"],
                                               "h": prev, "seq": e.seq})
    assert k.verify_ledger() == len(entries)
    assert "chain passes through every checkpoint" in _checks(k)


def test_checkpoints_are_authenticated_with_a_key(k, monkeypatch):  # noqa: F811
    from hos.kernel.integrity import AnchorLog
    k.anchors = AnchorLog(k.anchors.path.parent / "keyed.jsonl", key=b"anchor-key")
    _world(k)
    lines = k.anchors.path.read_text().splitlines()
    forged = json.loads(lines[-1])
    forged["head"] = "0" * 64
    k.anchors.path.write_text("\n".join([*lines[:-1], json.dumps(forged)]) + "\n")
    assert "checkpoint is authentic" in _checks(k)


def test_the_report_record_hash_covers_the_rendered_text(k):  # noqa: F811
    w = _world(k)
    ev = [e for e in k.history(w["sid"]) if e["action"] == "study.reported"][-1]
    assert ev["payload"]["report_record_hash"] == content_hash(k.repo.study(w["sid"]).report)
