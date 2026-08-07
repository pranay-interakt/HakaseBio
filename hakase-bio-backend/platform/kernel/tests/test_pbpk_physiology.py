"""Tests for the PBPK species/strain physiology store (S1-T2).

Acceptance (docs/pbpk-layer.md Part 6):
  1. Constants match their cited literature.
  2. Lookup by (species, strain, sex, age, bw) with modifiers works.
  3. Body-weight allometric scaling behaves as BW**0.75 (flows) / BW (volumes).

Pure stdlib logic — no ML bundles, no numpy. Run:
    pytest platform/kernel/tests/test_pbpk_physiology.py -q
"""

from __future__ import annotations

import pytest
from hakase_kernel.pbpk.physiology import store as S
from hakase_kernel.pbpk.physiology import tissue_composition as TC

# --------------------------------------------------------------------------- #
# 1. Constants match cited literature
# --------------------------------------------------------------------------- #


def test_human_constants_copied_from_ivive():
    # These must equal the pk_ivive.py SYSTEM constants verbatim (this task
    # mirrors them; it does not modify pk_ivive).
    human = S.SPECIES_PHYSIOLOGY[("human", "reference")]
    assert human.reference_body_weight_kg == 70.0  # DEFAULT_BODY_WEIGHT_KG
    assert human.hepatic_blood_flow_ml_min_kg == 20.7  # Q_h, Davies & Morris 1993
    assert human.hepatocellularity_1e6_per_g == 99.0  # HPGL, Barter 2007
    # Liver weight 25.7 g/kg -> volume fraction 0.0257 (Davies & Morris 1993).
    assert human.organ_volume_fraction["liver"] == 0.0257


def test_rat_hepatocellularity_is_species_specific():
    # Rat HPGL is 120e6 cells/g (Houston & Carlile 1997) — species-specific, NOT
    # the human 99e6/g. This is the value the rat hepatocyte-CLint benchmark
    # (Naritomi 2003, Ito & Houston 2004) is scaled with; setting it here keeps
    # the IVIVE scale-up consistent with the benchmark's deconvolution.
    for strain in ("sprague_dawley", "wistar"):
        rat = S.SPECIES_PHYSIOLOGY[("rat", strain)]
        assert rat.hepatocellularity_1e6_per_g == 120.0


def test_plasma_reference_constants():
    assert TC.PLASMA_PH == 7.4  # R&R 2005/2006
    assert TC.RED_CELL_INTRACELLULAR_PH == 7.22  # R&R 2005/2006
    assert TC.PLASMA_F_NEUTRAL_LIPID == 0.0023
    assert TC.PLASMA_F_NEUTRAL_PHOSPHOLIPID == 0.0013


def test_rr_tissue_composition_matches_literature():
    # Spot-check against the standardised Rodgers & Rowland rat composition
    # (Utsey 2020 / R&R 2005-2006).
    liver = TC.TISSUE_COMPOSITION["liver"]
    assert liver.f_extracellular_water == 0.161
    assert liver.f_intracellular_water == 0.573
    assert liver.f_neutral_lipid == 0.0135
    assert liver.f_neutral_phospholipid == 0.0238
    assert liver.acidic_phospholipid_mg_g == 4.56  # R&R 2005 rat
    kidney = TC.TISSUE_COMPOSITION["kidney"]
    assert kidney.acidic_phospholipid_mg_g == 5.03  # R&R 2005 rat
    assert kidney.f_intracellular_water == 0.483


def test_adipose_neutral_lipid_not_transposed():
    # Guard against the known NL/NP column transposition: adipose is lipid-rich.
    adipose = TC.TISSUE_COMPOSITION["adipose"]
    assert adipose.f_neutral_lipid == 0.853
    assert adipose.f_neutral_lipid > adipose.f_neutral_phospholipid


def test_all_tissue_fractions_are_physiological():
    for organ, comp in TC.TISSUE_COMPOSITION.items():
        for frac in (
            comp.f_extracellular_water,
            comp.f_intracellular_water,
            comp.f_neutral_lipid,
            comp.f_neutral_phospholipid,
        ):
            assert 0.0 <= frac <= 1.0, organ
        assert comp.acidic_phospholipid_mg_g >= 0.0, organ
        assert 6.0 <= comp.ph_intracellular <= 8.0, organ


def test_all_expected_species_and_strains_present():
    expected = {
        ("human", "reference"),
        ("rat", "sprague_dawley"),
        ("rat", "wistar"),
        ("mouse", "cd1"),
        ("mouse", "c57bl6"),
        ("dog", "beagle"),
        ("monkey", "cynomolgus"),
    }
    assert expected <= set(S.SPECIES_PHYSIOLOGY)


# --------------------------------------------------------------------------- #
# 2. Lookup by (species, strain, sex, age, bw) with modifiers
# --------------------------------------------------------------------------- #


def test_lookup_defaults_strain_and_reference_weight():
    phys = S.get_physiology("rat")  # strain + bw default
    assert phys.strain == "sprague_dawley"
    assert phys.body_weight_kg == pytest.approx(0.300)
    # CO absolute at reference weight = per-kg * BW.
    assert phys.cardiac_output_ml_min == pytest.approx(360.0 * 0.300)


def test_lookup_accepts_full_key():
    phys = S.get_physiology(
        "mouse", "c57bl6", sex=S.Sex.FEMALE, age=S.AgeClass.JUVENILE, body_weight_kg=0.020
    )
    assert (phys.species, phys.strain) == ("mouse", "c57bl6")
    assert phys.sex is S.Sex.FEMALE
    assert phys.age is S.AgeClass.JUVENILE
    assert phys.body_weight_kg == pytest.approx(0.020)


def test_plasma_volume_from_hematocrit():
    phys = S.get_physiology("human")
    base = S.SPECIES_PHYSIOLOGY[("human", "reference")]
    assert phys.blood_volume_l == pytest.approx(base.blood_volume_fraction * 70.0)
    assert phys.plasma_volume_l == pytest.approx(phys.blood_volume_l * (1.0 - base.hematocrit))


def test_unknown_strain_of_known_species_raises():
    # A known species with a bogus strain is a typo, not an extrapolation target.
    with pytest.raises(KeyError):
        S.get_physiology("rat", "nonexistent_strain")


def test_unknown_species_without_body_weight_raises():
    # S1-T2b: an unknown species needs a body weight to extrapolate; without one
    # there is nothing to scale from, so it raises (no silent fallback).
    with pytest.raises(ValueError):
        S.get_physiology("elephant")


def test_nonpositive_body_weight_raises():
    with pytest.raises(ValueError):
        S.get_physiology("rat", body_weight_kg=0.0)


def test_typed_sex_modifier_is_applied(monkeypatch):
    # The default sex modifier is identity; prove the mechanism actually applies
    # a factor by injecting a non-identity one through the typed table.
    monkeypatch.setitem(
        S.SEX_MODIFIERS,
        S.Sex.FEMALE,
        S.PhysiologyModifier(cardiac_output_factor=0.9, gfr_factor=0.8),
    )
    male = S.get_physiology("rat", sex=S.Sex.MALE)
    female = S.get_physiology("rat", sex=S.Sex.FEMALE)
    assert female.cardiac_output_ml_min == pytest.approx(male.cardiac_output_ml_min * 0.9)
    assert female.gfr_ml_min == pytest.approx(male.gfr_ml_min * 0.8)


# --------------------------------------------------------------------------- #
# 3. Body-weight allometric scaling
# --------------------------------------------------------------------------- #


def test_flows_scale_as_bw_power_075():
    ref = S.get_physiology("rat", "sprague_dawley")  # bw 0.300
    heavy = S.get_physiology("rat", "sprague_dawley", body_weight_kg=0.600)  # 2x
    ratio = 2.0**S.ALLOMETRIC_FLOW_EXPONENT
    assert heavy.cardiac_output_ml_min == pytest.approx(ref.cardiac_output_ml_min * ratio)
    assert heavy.gfr_ml_min == pytest.approx(ref.gfr_ml_min * ratio)
    assert heavy.hepatic_blood_flow_ml_min == pytest.approx(ref.hepatic_blood_flow_ml_min * ratio)


def test_volumes_scale_linearly_with_bw():
    ref = S.get_physiology("rat", "sprague_dawley")
    heavy = S.get_physiology("rat", "sprague_dawley", body_weight_kg=0.600)
    assert heavy.organ_volume_l["liver"] == pytest.approx(ref.organ_volume_l["liver"] * 2.0)
    assert heavy.blood_volume_l == pytest.approx(ref.blood_volume_l * 2.0)


def test_per_kg_flow_falls_as_bw_power_minus_025():
    ref = S.get_physiology("rat", "sprague_dawley")  # bw 0.300
    heavy = S.get_physiology("rat", "sprague_dawley", body_weight_kg=0.600)
    per_kg_ref = ref.cardiac_output_ml_min / ref.body_weight_kg
    per_kg_heavy = heavy.cardiac_output_ml_min / heavy.body_weight_kg
    assert per_kg_heavy == pytest.approx(per_kg_ref * 2.0**-0.25)


def test_organ_blood_flow_is_fraction_of_cardiac_output():
    phys = S.get_physiology("dog")
    base = S.SPECIES_PHYSIOLOGY[("dog", "beagle")]
    assert phys.organ_blood_flow_ml_min["liver"] == pytest.approx(
        base.organ_blood_flow_fraction["liver"] * phys.cardiac_output_ml_min
    )
