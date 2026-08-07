"""Tests for the DispositionParameters assembler (S1-T6).

Acceptance:
  * emits a valid DispositionParameters object (the S1-T1 contract);
  * the Kp-derived Vss cross-check flags divergence correctly.

Inputs supplied directly so no ADMET ML model is loaded. Run:
    pytest modalities/small-molecule/engine/src/hakase_smallmol/tests/test_disposition.py -q
"""

from __future__ import annotations

import pytest
from hakase_kernel.pbpk.contract import ApplicabilityDomain, DispositionParameters
from hakase_kernel.pbpk.physiology.tissue_composition import TISSUE_COMPOSITION
from hakase_kernel.uncertainty import ad_distance as AD

from hakase_smallmol.pk_ivive import disposition as D
from hakase_smallmol.pk_ivive import kp as KP
from hakase_smallmol.pk_ivive import pk_ivive as IV
from hakase_smallmol.pk_ivive import pka as PKA

_ML = {
    "clint_hep_ul_min_1e6": 20.0,
    "fu_plasma": 0.1,
    "vdss_l_per_kg": 3.5,
    "half_life_obach_h": 5.0,
}


def _ivive(montecarlo: bool = False, **kw):
    return IV.predict_pk_ivive("CCO", ml_inputs=_ML, montecarlo=montecarlo, **kw)


def _kp(logp: float = 3.8, fu: float = 0.1, bp: float = 0.74):
    sites = PKA.PkaPredictor().predict("C", measured_sites=[PKA.MicroPka(8.9, PKA.SiteType.BASE)])
    return KP.compute_kp(logp, sites, fu, bp)


# --------------------------------------------------------------------------- #
# Emits a valid DispositionParameters
# --------------------------------------------------------------------------- #


def test_emits_valid_disposition_and_round_trips():
    dp = D.assemble_disposition(_ivive(), _kp(), applicability_domain="in")
    assert isinstance(dp, DispositionParameters)
    # Core quantities all present with the right units.
    assert dp.fu_plasma.units == "fraction" and dp.fu_plasma.value == pytest.approx(0.1)
    assert dp.cl_hepatic.units == "mL/min/kg"
    assert dp.vdss.units == "L/kg" and dp.vdss.value == pytest.approx(3.5)
    assert set(dp.kp) == set(TISSUE_COMPOSITION)
    assert dp.species_context.species == "human"
    assert dp.applicability_domain.verdict == "in"
    # Round-trips through the contract serialisation.
    assert DispositionParameters.from_dict(dp.to_dict()) == dp


def test_cl_split_and_provenance():
    dp = D.assemble_disposition(_ivive(), _kp(), applicability_domain="in")
    assert dp.fu_plasma.provenance == "ml"
    assert dp.cl_hepatic.provenance == "derived"
    assert dp.cl_renal.provenance == "derived"
    # total = hepatic + renal (both plasma mL/min/kg).
    assert dp.cl_total.value == pytest.approx(dp.cl_hepatic.value + dp.cl_renal.value)
    # Kp is a per-organ mapping of derived quantities.
    assert dp.kp["liver"].provenance == "derived"


def test_monte_carlo_intervals_are_attached():
    dp = D.assemble_disposition(
        _ivive(montecarlo=True, mc_samples=1000, mc_seed=1), _kp(), applicability_domain="in"
    )
    assert dp.cl_hepatic.ci_low is not None and dp.cl_hepatic.ci_high is not None
    assert dp.cl_hepatic.ci_low < dp.cl_hepatic.value < dp.cl_hepatic.ci_high
    # No MC block -> no intervals (honest None, not fabricated).
    dp2 = D.assemble_disposition(_ivive(), _kp(), applicability_domain="in")
    assert dp2.cl_hepatic.ci_low is None and dp2.cl_hepatic.ci_high is None


def test_applicability_domain_from_ad_distance_verdict():
    ad = AD.ApplicabilityDomain.fit(
        [[0.0], [1.0]], metric="euclidean", standardize=False, in_threshold=1.0, edge_threshold=3.0
    )
    dp = D.assemble_disposition(_ivive(), _kp(), applicability_domain=ad.classify([0.2]))
    assert isinstance(dp.applicability_domain, ApplicabilityDomain)
    assert dp.applicability_domain.verdict == "in"
    assert dp.applicability_domain.score is not None


# --------------------------------------------------------------------------- #
# Vss cross-check (the acceptance-critical behaviour)
# --------------------------------------------------------------------------- #


def test_vss_crosscheck_formula_and_agreement():
    # Vss = Vplasma + Σ Vtissue·Kp with explicit volumes for a deterministic check.
    volumes = {"liver": 0.02, "muscle": 0.40}
    kp = {"liver": 10.0, "muscle": 2.0}  # 0.2 + 0.8 = 1.0
    res = D.vss_crosscheck(kp, 1.0, tissue_volumes=volumes, plasma_volume_l_per_kg=0.04)
    assert res["vss_predicted_l_per_kg"] == pytest.approx(1.04)  # 0.04 + 1.0
    assert res["fold_ratio"] == pytest.approx(1.04)
    assert res["within_fold"] is True and res["diverges"] is False


def test_vss_crosscheck_flags_divergence_both_directions():
    volumes = {"liver": 0.02, "muscle": 0.40}
    kp = {"liver": 10.0, "muscle": 2.0}  # Vss_pred = 1.04
    # ML VDss far above the Kp-derived Vss -> diverges.
    hi = D.vss_crosscheck(kp, 10.0, tissue_volumes=volumes, plasma_volume_l_per_kg=0.04)
    assert hi["diverges"] is True and hi["fold_ratio"] < 1 / 3
    # ML VDss far below -> diverges the other way.
    lo = D.vss_crosscheck(kp, 0.1, tissue_volumes=volumes, plasma_volume_l_per_kg=0.04)
    assert lo["diverges"] is True and lo["fold_ratio"] > 3


def test_vss_crosscheck_recorded_in_extension_and_flags():
    # Assemble with a Kp result but force divergence via a tiny fold threshold.
    dp = D.assemble_disposition(_ivive(), _kp(), applicability_domain="in", vss_fold_threshold=1.01)
    vx = dp.modality_extension.metadata["vss_crosscheck"]
    assert "vss_predicted_l_per_kg" in vx and "fold_ratio" in vx
    # A 1.01x gate is essentially always divergent for a real drug.
    assert vx["diverges"] is True
    assert dp.modality_extension.modality == "small-molecule"


def test_vss_crosscheck_requires_positive_vdss():
    with pytest.raises(ValueError):
        D.vss_crosscheck({"liver": 1.0}, 0.0)


# --------------------------------------------------------------------------- #
# Metabolic-clearance applicability guard
# --------------------------------------------------------------------------- #

# Rosuvastatin — an OATP transporter substrate, out of domain for metabolic CL.
_ROSUVASTATIN = "CC(C)c1nc(N(C)S(C)(=O)=O)nc(-c2ccc(F)cc2)c1/C=C/[C@@H](O)C[C@@H](O)CC(=O)O"


def test_metabolic_out_of_domain_escalates_ad_verdict_to_out():
    ivive = IV.predict_pk_ivive(_ROSUVASTATIN, ml_inputs=_ML, species="human")
    # Caller passes an "in" structural AD; the metabolic guard escalates to "out".
    dp = D.assemble_disposition(ivive, _kp(), applicability_domain="in")
    assert dp.applicability_domain.verdict == "out"
    assert "metabolic clearance" in (dp.applicability_domain.rationale or "").lower()
    md = dp.modality_extension.metadata["metabolic_clearance_domain"]
    assert md["flagged"] is True
    assert md["verdict"] == "out-of-domain-for-metabolic-CL"


def test_pure_metabolic_drug_preserves_ad_verdict():
    dp = D.assemble_disposition(_ivive(), _kp(), applicability_domain="in")
    # "CCO" is not a flagged transporter substrate -> structural verdict preserved.
    assert dp.applicability_domain.verdict == "in"
    md = dp.modality_extension.metadata["metabolic_clearance_domain"]
    assert md["flagged"] is False


# --------------------------------------------------------------------------- #
# Guards
# --------------------------------------------------------------------------- #


def test_requires_successful_ivive():
    bad = {"source": "insufficient-input", "available": False}
    with pytest.raises(ValueError):
        D.assemble_disposition(bad, _kp(), applicability_domain="in")


def test_requires_vdss(monkeypatch):
    # Force ML off so VDss stays genuinely absent (the ADMET model would otherwise
    # supply it); this test is about assemble_disposition requiring VDss.
    monkeypatch.setattr(
        "hakase_smallmol.admet.admet_ml.predict_admet_ml",
        lambda *a, **k: {"ml_available": False, "source": "unavailable"},
    )
    ivive = IV.predict_pk_ivive(
        "CCO",
        ml_inputs={"clint_hep_ul_min_1e6": 20.0, "fu_plasma": 0.1, "half_life_obach_h": 5.0},
    )
    assert ivive["source"] == "ivive"  # CL computable without VDss
    with pytest.raises(ValueError):
        D.assemble_disposition(ivive, _kp(), applicability_domain="in")
