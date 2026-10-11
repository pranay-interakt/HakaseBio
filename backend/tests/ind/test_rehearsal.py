"""Programme rehearsal (docs/14 P10): runs what can run, names everything that cannot, never
invents parameters, and computes the critical path from cited prerequisites only."""

import pytest

from hos.db.store import Database, FileStore
from hos.ind.rehearsal import rehearse
from hos.kernel.attestation import PrincipalKind, Role
from hos.kernel.kernel import Kernel
from tests.drivers.test_herg import PARAMS as HG
from tests.drivers.test_herg import SIM as HG_SIM
from tests.drivers.test_metabolic_stability import PARAMS as MS
from tests.drivers.test_metabolic_stability import SIM as MS_SIM
from tests.drivers.test_repeat_dose_tox import PARAMS as RD
from tests.drivers.test_repeat_dose_tox import SIM as RD_SIM
from tests.kernel.test_kernel import CTX, PW, k  # noqa: F401  (fixture)

PLAN = {
    "adme.metabolic_stability": {"parameters": MS, "simulation_parameters": MS_SIM, "seed": 1},
    "safety.herg": {
        "parameters": HG,
        "simulation_parameters": HG_SIM,
        "seed": 2,
        "inputs": {
            "free_cmax_high_clinical_exposure": {
                "value": 0.5,
                "unit": "uM",
                "kind": "user_supplied",
            }
        },
    },
    "tox.repeat_dose_rodent": {"parameters": RD, "simulation_parameters": RD_SIM, "seed": 3},
}


def _prog(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="REH", context=CTX)
    k.register_compound(sci, prog["id"], name="cmp", smiles="CC(=O)Nc1ccc(O)cc1")
    return sci, prog["id"]


def test_rehearsal_runs_supplied_plans_and_names_gaps(k):  # noqa: F811
    sci, pid = _prog(k)
    r = rehearse(k, sci, pid, PLAN)
    items = {i["requirement_id"]: i for i in r["items"]}
    for rid in PLAN:
        assert items[rid]["outcome"] == "rehearsed" and items[rid]["simulated"]
    # non-rodent repeat-dose: driver exists but no design parameters were supplied
    nr = items["tox.repeat_dose_nonrodent"]
    assert nr["outcome"] == "needs_design_parameters" and "strain" in nr["missing_parameters"]
    s = r["summary"]
    for rid in s["missing_drivers"]:
        assert items[rid]["outcome"] == "no_driver"
    assert items["genotox.ames"]["outcome"] == "needs_design_parameters"
    # the metabolic-stability rehearsal reports the fu inputs it was not given
    assert "fu_plasma.human" in s["missing_inputs"]["adme.metabolic_stability"]
    assert any(
        u["label"].startswith("CLh")
        for u in items["adme.metabolic_stability"]["unavailable_results"]
    )
    # critical path: dose range-finding (no driver, unknown duration) -> 28 d + 14 d recovery
    cp = s["critical_path"]
    assert cp["requirements"][-2:] == ["tox.dose_range_finding", "tox.repeat_dose_rodent"]
    assert cp["known_duration_days"] == pytest.approx(42.0)
    assert "tox.dose_range_finding" in cp["unknown_durations_on_path"]
    # NOAEL determination has a study director available in this system
    noael = items["tox.repeat_dose_rodent"]["determinations"][0]
    assert noael["role"] == "study_director" and noael["assigned_to"] == ["Dana Director"]
    assert "program.rehearsed" in [e["action"] for e in k.history(pid)]
    # nothing persisted
    assert k.studies(pid) == []


def test_missing_simulation_parameters_are_not_invented(k):  # noqa: F811
    sci, pid = _prog(k)
    r = rehearse(k, sci, pid, {"adme.metabolic_stability": {"parameters": MS}})
    i = next(x for x in r["items"] if x["requirement_id"] == "adme.metabolic_stability")
    assert i["outcome"] == "needs_simulation_parameters"


def test_unassigned_determination_is_reported(tmp_path):
    k2 = Kernel(db=Database(f"sqlite:///{tmp_path / 'r.sqlite3'}"), files=FileStore(tmp_path / "o"))
    a = k2.register_principal(
        None,
        principal_id="a",
        name="A",
        kind=PrincipalKind.HUMAN,
        roles=[Role.ADMIN, Role.SCIENTIST],
        password=PW,
    )
    prog = k2.create_program(a, name="X", context=CTX)
    k2.register_compound(a, prog["id"], name="c", smiles="CCO")
    r = rehearse(k2, a, prog["id"], {"tox.repeat_dose_rodent": {"parameters": RD}})
    assert {
        "requirement_id": "tox.repeat_dose_rodent",
        "determination": "NOAEL",
        "role": "study_director",
    } in r["summary"]["unassigned_determinations"]


def test_existing_study_parameters_are_used(k):  # noqa: F811
    sci, pid = _prog(k)
    cid = k.repo.compounds(pid)[0].id
    sid = k.create_study(
        sci, program_id=pid, compound_id=cid, requirement_id="adme.metabolic_stability"
    )["id"]
    k.design_study(sci, sid, MS)
    r = rehearse(
        k, sci, pid, {"adme.metabolic_stability": {"simulation_parameters": MS_SIM, "seed": 5}}
    )
    i = next(x for x in r["items"] if x["requirement_id"] == "adme.metabolic_stability")
    assert i["outcome"] == "rehearsed"


def test_what_if_and_diff_over_http(tmp_path):
    from fastapi.testclient import TestClient

    from hos.api import create_app

    kern = Kernel(
        db=Database(f"sqlite:///{tmp_path / 'w.sqlite3'}"), files=FileStore(tmp_path / "o")
    )
    c = TestClient(create_app(kern, bootstrap_token="t"))
    c.post(
        "/api/setup",
        json={"principal_id": "admin", "name": "A", "password": PW, "setup_token": "t"},
    )
    h = {
        "Authorization": "Bearer "
        + c.post("/api/auth/login", json={"principal_id": "admin", "password": PW}).json()["token"]
    }
    ctx = {
        "modality": "small_molecule",
        "indication": "chronic_non_oncology",
        "route": "oral",
        "intended_clinical_duration_days": 365,
        "max_trial_duration_days": 28,
    }
    d = c.post(
        "/api/regulatory/diff",
        headers=h,
        json={"a": ctx, "b": {**ctx, "max_trial_duration_days": 200}},
    )
    assert d.json()["summary"]["lengthened"] == 2
    assert (
        c.post(
            "/api/regulatory/diff", headers=h, json={"a": ctx, "b": {"modality": "x"}}
        ).status_code
        == 400
    )
    prog = c.post("/api/programs", headers=h, json={"name": "W", "context": ctx}).json()
    w = c.post(
        f"/api/programs/{prog['id']}/what-if",
        headers=h,
        json={"changes": {"populations": ["women_of_childbearing_potential"]}},
    ).json()
    assert [x["requirement_id"] for x in w["changes"] if x["change"] == "retimed"] == ["dart.efd"]
    assert c.post(f"/api/programs/{prog['id']}/what-if", json={"changes": {}}).status_code == 401
    r = c.post(f"/api/programs/{prog['id']}/rehearsal", headers=h, json={})
    assert r.status_code == 200 and r.json()["simulated"]


def test_no_known_durations_means_no_critical_path(k):  # noqa: F811
    sci, pid = _prog(k)
    cp = rehearse(k, sci, pid, {})["summary"]["critical_path"]
    assert cp["requirements"] == [] and not cp["determined"]
    assert "cannot be determined" in cp["note"]
