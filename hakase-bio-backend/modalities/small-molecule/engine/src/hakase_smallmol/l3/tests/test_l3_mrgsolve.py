"""mrgsolve engine tests + kernel-vs-mrgsolve cross-validation.

The whole file skips automatically when R/mrgsolve is not installed (so CI without
R stays green) or when the ADMET ML stack is unavailable (disposition inputs
cannot be produced). When both are present, it asserts that the two independent
PBPK engines — the in-house scipy kernel and Metrum's mrgsolve — agree on the
key PK metrics for the same disposition, which is the whole point of having two.

Run:
    pytest modalities/small-molecule/engine/src/hakase_smallmol/l3/tests/test_l3_mrgsolve.py -q
"""

from __future__ import annotations

import pytest

from hakase_smallmol.l3.mrgsolve_adapter import mrgsolve_available


def _ml_available() -> bool:
    try:
        from hakase_smallmol.admet.admet_ml import predict_admet_ml

        return bool(predict_admet_ml("CCO").get("ml_available"))
    except Exception:  # noqa: BLE001
        return False


pytestmark = [
    pytest.mark.skipif(not mrgsolve_available(), reason="R/mrgsolve not installed"),
    pytest.mark.skipif(not _ml_available(), reason="ADMET ML stack unavailable"),
]

_CAFFEINE = "Cn1cnc2c1c(=O)n(C)c(=O)n2C"


def _arm(engine: str, route: str = "IV", freq: str | None = None):
    from hakase_smallmol.l3.pbpk_adapter import AnimalSpec, ArmSpec, run_arm_exposure

    return run_arm_exposure(
        _CAFFEINE,
        animal=AnimalSpec(species="rat", strain="sprague_dawley"),
        arm=ArmSpec(label="M", dose_mg_per_kg=10.0, route=route, frequency=freq, duration_h=24.0),
        formulation="plain",
        cohort_size=6,
        seed=42,
        engine=engine,
    )


def test_mrgsolve_engine_runs_and_reports_itself():
    r = _arm("mrgsolve")
    assert r["available"] is True
    assert r["engine_used"] == "mrgsolve"
    assert r["cohort"].get("engine") == "mrgsolve"
    ep = r["cohort"]["endpoints"]["plasma"]
    assert ep["c_max"]["median"] > 0
    assert ep["auc"]["median"] > 0
    assert ep["t_half"]["median"] > 0
    # Time axis is in hours and matches the 24 h window.
    assert abs(r["cohort"]["time"][-1] - 24.0) < 1e-6


@pytest.mark.parametrize("route,freq", [("IV", None), ("ORAL", "QD")])
def test_kernel_and_mrgsolve_cross_validate(route, freq):
    k = _arm("kernel", route=route, freq=freq)
    m = _arm("mrgsolve", route=route, freq=freq)
    assert k["available"] and m["available"]
    ek = k["cohort"]["endpoints"]["plasma"]
    em = m["cohort"]["endpoints"]["plasma"]
    # Two independent PBPK engines, same disposition → agree within 5%.
    for metric in ("c_max", "auc", "t_half"):
        vk = ek[metric]["median"]
        vm = em[metric]["median"]
        assert vk == pytest.approx(vm, rel=0.05), f"{metric}: kernel {vk} vs mrgsolve {vm}"


def test_auto_engine_prefers_mrgsolve_when_available():
    from hakase_smallmol.l3.pipeline import run_animal_study

    rec = run_animal_study(
        smiles=_CAFFEINE,
        animal={"species": "rat", "strain": "sprague_dawley"},
        dose_groups=[{"dose_mg_per_kg": 10}],
        route="IV",
        formulation="plain",
        cohort_size=4,
        duration_h=24.0,
        seed=42,
        collect_public_evidence=False,
        engine="auto",
    )
    assert rec["available"] is True
    assert rec["study_summary"]["engine_used"] == "mrgsolve"
