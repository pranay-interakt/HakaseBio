"""Tests for the Rodgers & Rowland Kp model (S1-T3).

Acceptance:
  * Kp for >= 3 published reference drugs consistent with literature R&R values;
  * ionisation handled via the S1-T3a pKa output.

Validation basis (honest note): the exact per-tissue Kpu tables in the R&R
papers are paywalled, so the reference-drug tests combine (a) an independent
longhand recomputation of the published equations — which pins equation wiring
and units exactly — with (b) literature-consistent regime, magnitude and
ordering for verapamil (base), warfarin (acid) and diazepam (neutral), whose
input parameters are taken from a published table (PMC6750188). Constants and
equations were cross-checked against the Simulations-Plus general-approach
poster and the mrgsolve Calc_KpRR reference.

Needs RDKit only indirectly (pKa built via the measured-override path). Run:
    pytest modalities/small-molecule/engine/src/hakase_smallmol/tests/test_kp.py -q
"""

from __future__ import annotations

import pytest
from hakase_kernel.pbpk.physiology import tissue_composition as TC

from hakase_smallmol.pk_ivive import kp as K
from hakase_smallmol.pk_ivive import pka as P


def _pka(sites: list[P.MicroPka]) -> P.PkaResult:
    """Build a measured-provenance PkaResult directly (supports the neutral,
    zero-site case, which the measured-override predict path rejects)."""
    s = tuple(sites)
    return P.PkaResult(
        smiles="C",
        sites=s,
        ionisation_class=P.classify(s),
        provenance="measured",
        backend="measured",
        low_confidence=False,
    )


# Published reference-drug parameters (PMC6750188, Table 2).
VERAPAMIL = dict(logp=3.79, fu=0.088, bp=0.74, sites=[P.MicroPka(8.92, P.SiteType.BASE)])
WARFARIN = dict(logp=2.70, fu=0.0076, bp=0.55, sites=[P.MicroPka(5.05, P.SiteType.ACID)])
DIAZEPAM = dict(logp=2.82, fu=0.012, bp=0.64, sites=[P.MicroPka(14.0, P.SiteType.ACID)])


def _kp(drug: dict) -> K.KpResult:
    return K.compute_kp(drug["logp"], _pka(drug["sites"]), drug["fu"], drug["bp"])


# --------------------------------------------------------------------------- #
# Equation wiring: independent longhand recomputation
# --------------------------------------------------------------------------- #


def test_verapamil_muscle_kpu_matches_longhand():
    """Recompute the base-regime muscle Kpu by hand and match the module."""
    muscle = TC.TISSUE_COMPOSITION["muscle"]
    logp, fu, bp, pka_b = 3.79, 0.088, 0.74, 8.92
    hct = K.DEFAULT_HEMATOCRIT
    p = 10.0**logp
    pl = 0.3 * p + 0.7
    rp = 1.0 + 10.0 ** (pka_b - TC.PLASMA_PH)
    riw = 1.0 + 10.0 ** (pka_b - muscle.ph_intracellular)
    rbc = 1.0 + 10.0 ** (pka_b - TC.RED_CELL_INTRACELLULAR_PH)
    kpu_bc = (bp - (1.0 - hct)) / (hct * fu)
    lipid_bc = p * K.RBC_F_NEUTRAL_LIPID + pl * K.RBC_F_NEUTRAL_PHOSPHOLIPID
    ka = ((kpu_bc * rp - rbc * K.RBC_F_INTRACELLULAR_WATER - lipid_bc) / (rbc - 1.0)) / (
        K.RBC_ACIDIC_PHOSPHOLIPID_MG_G
    )
    lipid = p * muscle.f_neutral_lipid + pl * muscle.f_neutral_phospholipid
    ap = ka * muscle.acidic_phospholipid_mg_g * (riw - 1.0)
    expected = (
        muscle.f_extracellular_water + (riw / rp) * muscle.f_intracellular_water + (lipid + ap) / rp
    )

    res = _kp(VERAPAMIL)
    assert res.regime.kind == "base"
    assert res.ka_acidic_phospholipid == pytest.approx(ka)
    assert res.kpu["muscle"] == pytest.approx(expected)
    assert res.kp["muscle"] == pytest.approx(expected * 0.088)


def test_warfarin_muscle_kpu_matches_longhand():
    """Recompute the acid/albumin-regime muscle Kpu by hand and match the module."""
    muscle = TC.TISSUE_COMPOSITION["muscle"]
    logp, fu, pka_a = 2.70, 0.0076, 5.05
    p = 10.0**logp
    pl = 0.3 * p + 0.7
    rp = 1.0 + 10.0 ** (TC.PLASMA_PH - pka_a)
    riw = 1.0 + 10.0 ** (muscle.ph_intracellular - pka_a)
    lipid = p * muscle.f_neutral_lipid + pl * muscle.f_neutral_phospholipid
    plasma_lipid = p * TC.PLASMA_F_NEUTRAL_LIPID + pl * TC.PLASMA_F_NEUTRAL_PHOSPHOLIPID
    protein = (1.0 / fu - 1.0 - plasma_lipid / rp) * muscle.albumin_ratio
    expected = (
        muscle.f_extracellular_water
        + (riw / rp) * muscle.f_intracellular_water
        + lipid / rp
        + protein
    )

    res = _kp(WARFARIN)
    assert res.regime.kind == "acid" and res.regime.protein == "albumin"
    assert res.kpu["muscle"] == pytest.approx(expected)


# --------------------------------------------------------------------------- #
# Reference drugs: regime + literature-consistent magnitude / ordering
# --------------------------------------------------------------------------- #


def test_verapamil_is_a_tissue_accumulating_base():
    res = _kp(VERAPAMIL)
    assert res.regime.kind == "base"
    assert res.ka_acidic_phospholipid is not None and res.ka_acidic_phospholipid > 0
    # A lipophilic base accumulates in tissue: Kp (total) well above 1.
    assert 1.0 < res.kp["muscle"] < 5.0
    assert res.kp["liver"] > res.kp["muscle"]  # high-AP liver > muscle


def test_warfarin_is_a_restricted_acid():
    res = _kp(WARFARIN)
    assert res.regime.kind == "acid"
    # A highly albumin-bound acid stays largely in plasma: every Kp (total) < 1.
    assert all(v < 1.0 for v in res.kp.values())
    assert res.kp["muscle"] < 0.3


def test_diazepam_neutral_accumulates_in_adipose():
    res = _kp(DIAZEPAM)
    assert res.regime.kind == "neutral"
    # A lipophilic neutral concentrates in fat: adipose is the highest-Kp tissue.
    assert max(res.kp, key=res.kp.get) == "adipose"


def test_base_accumulates_more_than_acid_for_similar_lipophilicity():
    # The whole point of the AP term: bases partition into tissue far more than
    # acids of comparable logP.
    verapamil = _kp(VERAPAMIL)
    warfarin = _kp(WARFARIN)
    assert verapamil.kpu["muscle"] > warfarin.kpu["muscle"]
    assert verapamil.kp["muscle"] > warfarin.kp["muscle"]


# --------------------------------------------------------------------------- #
# Ionisation consumed from the S1-T3a output
# --------------------------------------------------------------------------- #


def test_regime_tracks_ionisation_from_pka_output():
    assert K.classify_regime(_pka([P.MicroPka(9.0, P.SiteType.BASE)])).kind == "base"
    assert K.classify_regime(_pka([P.MicroPka(4.0, P.SiteType.ACID)])).kind == "acid"
    assert K.classify_regime(_pka([])).kind == "neutral"
    # A weak base (pKa < 7) is not a strong base -> not the AP regime.
    assert K.classify_regime(_pka([P.MicroPka(5.0, P.SiteType.BASE)])).kind == "neutral"


def test_total_to_neutral_ratio_closed_forms():
    base = _pka([P.MicroPka(9.0, P.SiteType.BASE)])
    assert K.total_to_neutral_ratio(base, 7.4) == pytest.approx(1.0 + 10.0 ** (9.0 - 7.4))
    acid = _pka([P.MicroPka(4.0, P.SiteType.ACID)])
    assert K.total_to_neutral_ratio(acid, 7.4) == pytest.approx(1.0 + 10.0 ** (7.4 - 4.0))
    # Diprotic base -> product of the per-site factors.
    di = _pka([P.MicroPka(9.0, P.SiteType.BASE), P.MicroPka(6.0, P.SiteType.BASE)])
    expected = (1.0 + 10.0 ** (9.0 - 7.4)) * (1.0 + 10.0 ** (6.0 - 7.4))
    assert K.total_to_neutral_ratio(di, 7.4) == pytest.approx(expected)


# --------------------------------------------------------------------------- #
# Limit cases + coverage + validation
# --------------------------------------------------------------------------- #


def test_nonlipophilic_neutral_reduces_to_tissue_water():
    # logP very low, unbound, non-ionisable -> Kpu ~ tissue water (fEW + fIW).
    res = K.compute_kp(-3.0, _pka([]), fu_plasma=1.0, blood_plasma_ratio=1.0)
    muscle = TC.TISSUE_COMPOSITION["muscle"]
    water = muscle.f_extracellular_water + muscle.f_intracellular_water
    assert res.kpu["muscle"] == pytest.approx(water, abs=0.02)


def test_neutral_muscle_kpu_increases_with_logp():
    # For a neutral (no acidic-phospholipid refit), more lipophilic -> more
    # lipid partitioning -> higher tissue Kpu, monotonically.
    values = [
        K.compute_kp(lp, _pka([]), 1.0, 1.0).kpu["muscle"] for lp in (0.0, 1.0, 2.0, 3.0, 4.0)
    ]
    assert values == sorted(values)
    assert values[-1] > values[0]


def test_full_compartment_set_is_covered():
    res = _kp(VERAPAMIL)
    assert set(res.kp) == set(TC.TISSUE_COMPOSITION)
    assert set(res.kpu) == set(TC.TISSUE_COMPOSITION)
    assert all(v > 0 for v in res.kpu.values())


def test_ka_fit_reproduces_blood_cell_kpu():
    # Self-consistency: the fitted Ka, plugged back into the RBC equation,
    # recovers the blood-cell:unbound-plasma-water partition it was fit to.
    res = _kp(VERAPAMIL)
    ka = res.ka_acidic_phospholipid
    logp, fu, bp, pka_b = 3.79, 0.088, 0.74, 8.92
    hct = K.DEFAULT_HEMATOCRIT
    p = 10.0**logp
    pl = 0.3 * p + 0.7
    rp = 1.0 + 10.0 ** (pka_b - TC.PLASMA_PH)
    rbc = 1.0 + 10.0 ** (pka_b - TC.RED_CELL_INTRACELLULAR_PH)
    lipid_bc = p * K.RBC_F_NEUTRAL_LIPID + pl * K.RBC_F_NEUTRAL_PHOSPHOLIPID
    ap_bc = ka * K.RBC_ACIDIC_PHOSPHOLIPID_MG_G * (rbc - 1.0)
    recomputed = (rbc / rp) * K.RBC_F_INTRACELLULAR_WATER + (lipid_bc + ap_bc) / rp
    expected_kpu_bc = (bp - (1.0 - hct)) / (hct * fu)
    assert recomputed == pytest.approx(expected_kpu_bc)


def test_input_validation():
    good = _pka([P.MicroPka(9.0, P.SiteType.BASE)])
    with pytest.raises(K.KpError):
        K.compute_kp(2.0, good, fu_plasma=0.0, blood_plasma_ratio=1.0)
    with pytest.raises(K.KpError):
        K.compute_kp(2.0, good, fu_plasma=1.5, blood_plasma_ratio=1.0)
    with pytest.raises(K.KpError):
        K.compute_kp(2.0, good, fu_plasma=0.1, blood_plasma_ratio=0.0)
