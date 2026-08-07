"""Integration test: the real IVIVE → cohort → study pipeline end to end.

Skipped automatically when the ADMET ML stack is unavailable (the disposition
inputs cannot be produced without it, per the no-fallback contract). Uses a
small cohort for speed and a fixed seed for reproducibility.
"""

from __future__ import annotations

import pytest


def _ml_available() -> bool:
    try:
        from hakase_smallmol.admet.admet_ml import predict_admet_ml

        res = predict_admet_ml("CCO")
        return bool(res.get("ml_available"))
    except Exception:  # noqa: BLE001
        return False


pytestmark = pytest.mark.skipif(not _ml_available(), reason="ADMET ML stack unavailable")


def test_full_study_pipeline_runs():
    from hakase_smallmol.l3.pipeline import run_animal_study
    from hakase_smallmol.l3.store import get_study

    rec = run_animal_study(
        smiles="Cn1cnc2c1c(=O)n(C)c(=O)n2C",  # caffeine
        animal={"species": "rat", "strain": "sprague_dawley", "sex": "male"},
        dose_groups=[{"dose_mg_per_kg": 5}, {"dose_mg_per_kg": 25}, {"dose_mg_per_kg": 100}],
        route="ORAL",
        frequency="QD",
        duration_h=48.0,
        formulation="plain",
        cohort_size=4,
        seed=42,
        collect_public_evidence=False,  # keep the test offline/deterministic
    )
    assert rec["available"] is True
    assert rec["study_summary"]["arms_available"] == 3

    # Dose-proportionality on a linear PBPK must be ~1.
    dp = rec["pkpd"]["dose_proportionality"]
    assert dp["available"] and abs(dp["beta_slope"] - 1.0) < 0.15

    # Every arm carries per-tissue PK metrics with intervals.
    per_arm = rec["pkpd"]["per_arm"]
    assert all(a["pk_metrics"]["available"] for a in per_arm)
    plasma = per_arm[0]["pk_metrics"]["tissues"]["plasma"]
    assert plasma["c_max"]["median"] > 0
    assert plasma["auc"]["p95"] >= plasma["auc"]["p05"]

    # Sensitivity identifies a dominant driver; stage gate + report present.
    assert rec["sensitivity"]["available"]
    assert rec["stage_gate"]["recommendation"] in {"GO", "NO-GO", "CONDITIONAL"}
    assert rec["presentation"]["groups"]

    # Persisted and retrievable by id.
    assert get_study(rec["study_id"])["study_id"] == rec["study_id"]


def test_study_reproducible_with_seed():
    from hakase_smallmol.l3.pbpk_adapter import AnimalSpec, ArmSpec, run_arm_exposure

    kwargs = dict(
        animal=AnimalSpec(species="rat", strain="sprague_dawley"),
        arm=ArmSpec(label="Mid", dose_mg_per_kg=25.0, route="ORAL", duration_h=24.0),
        formulation="plain",
        cohort_size=4,
        seed=7,
    )
    a = run_arm_exposure("Cn1cnc2c1c(=O)n(C)c(=O)n2C", **kwargs)
    b = run_arm_exposure("Cn1cnc2c1c(=O)n(C)c(=O)n2C", **kwargs)
    assert a["available"] and b["available"]
    ca = a["cohort"]["endpoints"]["plasma"]["c_max"]["median"]
    cb = b["cohort"]["endpoints"]["plasma"]["c_max"]["median"]
    # Same seed → identical cohort to ODE-solver tolerance (BLAS/FP ordering can
    # differ in the last ~1e-15, which is not a reproducibility break).
    assert ca == pytest.approx(cb, rel=1e-9)
