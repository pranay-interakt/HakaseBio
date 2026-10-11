"""Every state change commits together with its ledger entry, or not at all (docs/15 P0.1).

Fault injection: before each step of a full lifecycle the ledger write is made to fail; the
step must raise and leave every table byte-for-byte unchanged. The step is then run for real.
A concurrency test checks that writers racing in one process leave a gap-free chain."""

import threading

import pytest
from sqlalchemy import inspect, text

from hos.core.regulatory import Indication, Modality, PeptideOrigin, ProgramContext, Route
from hos.ind import assemble_module4
from hos.kernel.attestation import PrincipalKind, Role, SignatureMeaning
from hos.kernel.errors import PermissionDenied
from tests.drivers.test_repeat_dose_tox import PARAMS as RD
from tests.kernel.test_glp_flow import _lab_file
from tests.kernel.test_imports import REPORT
from tests.kernel.test_kernel import CTX, FU, HL, PARAMS, PW, _measured_csv, k  # noqa: F401


class LedgerDown(RuntimeError):
    pass


def _snapshot(k):  # noqa: F811
    with k.db.engine.connect() as c:
        return {t: sorted(repr(tuple(r)) for r in c.execute(text(f"SELECT * FROM {t}")))
                for t in inspect(k.db.engine).get_table_names()}


def _step(k, monkeypatch, fn):  # noqa: F811
    """Fail the ledger write: ``fn`` must raise and change nothing. Then run it for real."""
    before = _snapshot(k)
    original = k.ledger._backend.append

    def down(entry):
        raise LedgerDown(entry.action)

    monkeypatch.setattr(k.ledger._backend, "append", down)
    with pytest.raises(LedgerDown):
        fn()
    monkeypatch.setattr(k.ledger._backend, "append", original)
    assert _snapshot(k) == before, "state changed although its ledger entry was not written"
    return fn()


def test_every_step_is_atomic_with_its_ledger_entry(k, monkeypatch):  # noqa: F811
    adm, sci, sd = (k.get_principal(x) for x in ("admin", "sci", "sd"))
    s = lambda fn: _step(k, monkeypatch, fn)  # noqa: E731

    # the audit's reproduction: a registered user with no ledger entry
    s(lambda: k.register_principal(adm, principal_id="bob", name="Bob", kind=PrincipalKind.HUMAN,
                                   roles=[Role.SCIENTIST], password=PW))
    prog = s(lambda: k.create_program(sci, name="ATOM", context=CTX))["id"]
    s(lambda: k.update_program_context(sci, prog, {"max_trial_duration_days": 14},
                                       reason="trial shortened"))
    cid = s(lambda: k.register_compound(sci, prog, name="c", smiles="CC(=O)Nc1ccc(O)cc1"))["id"]
    s(lambda: k.attach_external_record(sci, cid, "pubchem", {"status": "not_found"}))

    # a measured study through approval
    sid = s(lambda: k.create_study(sci, program_id=prog, compound_id=cid,
                                   requirement_id="adme.metabolic_stability"))["id"]
    s(lambda: k.design_study(sci, sid, PARAMS))
    s(lambda: k.plan_study(sci, sid))
    s(lambda: k.dispatch_study(sci, sid, {"kind": "external_lab", "laboratory": "CRO"}))
    s(lambda: k.receive_data(sci, sid, _measured_csv(HL, ref=sid)))
    s(lambda: k.set_analysis_inputs(sci, sid, FU))
    s(lambda: k.analyze_study(sci, sid))
    s(lambda: k.report_study(sci, sid))
    s(lambda: k.sign_study(sci, sid, role=Role.RESPONSIBLE_SCIENTIST,
                           meaning=SignatureMeaning.APPROVAL, statement="approve"))
    s(lambda: k.approve_study(sci, sid))

    # a GLP study: protocol signature and an expert determination
    rd = s(lambda: k.create_study(sci, program_id=prog, compound_id=cid,
                                  requirement_id="tox.repeat_dose_rodent"))["id"]
    s(lambda: k.design_study(sci, rd, RD))
    s(lambda: k.sign_protocol(sd, rd, statement="I approve this protocol."))
    s(lambda: k.plan_study(sci, rd))
    s(lambda: k.dispatch_study(sci, rd, {"kind": "external_lab", "laboratory": "GLP CRO"}))
    s(lambda: k.receive_data(sci, rd, _lab_file(rd)))
    s(lambda: k.analyze_study(sci, rd))
    s(lambda: k.record_determination(sd, rd, key="noael", value=30, unit="mg/kg/day",
                                     rationale="liver findings at 100 mg/kg/day"))
    s(lambda: k.cancel_study(sci, rd, reason="programme decision"))

    # an imported study
    imp = s(lambda: k.imports.import_study(
        sci, program_id=prog, compound_id=cid, requirement_id="genotox.ames", report=REPORT,
        filename="ames.pdf", title="Ames", laboratory="Lab", report_date="2026-05-01",
        glp=False))["id"]
    s(lambda: k.imports.add_import_value(sci, imp, key="overall_call", page="5",
                                         category="negative"))
    s(lambda: k.imports.sign_import(sci, imp, role=Role.RESPONSIBLE_SCIENTIST,
                                    meaning=SignatureMeaning.APPROVAL, statement=""))
    s(lambda: k.imports.complete_import(sci, imp))
    s(lambda: assemble_module4(k, sci, prog))

    # peptides: sequence entity and a signed programme determination
    pep_ctx = ProgramContext(modality=Modality.PEPTIDE, indication=Indication.CHRONIC_NON_ONCOLOGY,
                             route=Route.SUBCUTANEOUS, intended_clinical_duration_days=365,
                             max_trial_duration_days=28,
                             peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS)
    pep = s(lambda: k.create_program(sci, name="ATOM-P", context=pep_ctx))["id"]
    s(lambda: k.register_biologic(sci, pep, name="p", entity={
        "format": "sequence",
        "chains": [{"name": "p", "role": "peptide", "sequence": "HAEGTFTSDV", "copies": 1}]}))
    s(lambda: k.record_program_determination(sci, pep, key="s6_principles_apply",
                                             applies=False, rationale="short synthetic peptide"))
    assert k.verify_ledger() == len(k.ledger.entries())


def test_refusals_stay_on_the_record(k):  # noqa: F811
    """A failed login is recorded although the call fails (the unit of work commits it)."""
    n = len(k.ledger.entries())
    with pytest.raises(PermissionDenied):
        k.authenticate("sci", "wrong password!")
    assert [e.action for e in k.ledger.entries()[n:]] == ["auth.failed"]


def test_concurrent_writers_leave_a_gap_free_chain(k):  # noqa: F811
    sci = k.get_principal("sci")
    start = len(k.ledger.entries())
    errors: list[BaseException] = []

    def work(i):
        try:
            for j in range(5):
                k.create_program(sci, name=f"T{i}-{j}", context=CTX)
        except BaseException as exc:  # noqa: BLE001 - surfaced by the assertion below
            errors.append(exc)

    threads = [threading.Thread(target=work, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    entries = k.ledger.entries()
    assert [e.seq for e in entries] == list(range(1, len(entries) + 1))
    assert sum(e.action == "program.created" for e in entries[start:]) == 40
    assert len(k.programs()) == 40 and k.verify_ledger() == len(entries)


def _writes(fn) -> set[str]:
    """Write calls in a method: self/_k repo writes, ledger records, _record, record_event,
    and calls to private helpers (resolved by the caller)."""
    import ast
    out = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
            chain = ast.unparse(n.func)
            name = n.func.attr
            if (chain.startswith(("self.repo.", "self.k.repo.")) and (
                    name in ("add", "add_artifact", "store_file", "register_simulated")
                    or name.startswith("update_"))) or chain in ("self.ledger.record", "self.k.ledger.record") or \
                    name in ("_record", "record_event") or chain.startswith("self._"):
                out.add(chain)
    return out


@pytest.mark.parametrize(("module", "cls"), [("hos/kernel/kernel.py", "Kernel"),
                                             ("hos/kernel/imports.py", "ImportService")])
def test_every_writing_operation_is_a_unit_of_work(module, cls):
    import ast
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    tree = ast.parse((root / module).read_text())
    c = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == cls)
    methods = {n.name: n for n in c.body if isinstance(n, ast.FunctionDef)}
    direct = {m for m, fn in methods.items()
              if any(not w.startswith("self._") or w.endswith("._record") for w in _writes(fn))}
    writers, changed = set(direct), True
    while changed:
        changed = False
        for m, fn in methods.items():
            if m not in writers and any(w.split(".")[-1] in writers for w in _writes(fn)):
                writers.add(m)
                changed = True
    undecorated = sorted(m for m in writers if not m.startswith("_") and not any(
        isinstance(d, ast.Name) and d.id == "atomic" for d in methods[m].decorator_list))
    assert not undecorated, f"{cls} methods that write without @atomic: {undecorated}"
