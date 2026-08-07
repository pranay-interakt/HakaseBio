"""Tests for any-species resolution: allometric extrapolation + data-file load (S1-T2b).

Acceptance:
  1. An unknown species (e.g. "rabbit", body weight only) resolves to an
     allometric row carrying the extrapolation flag and widened uncertainty.
  2. A calibrated species (rat_sd) is byte-for-byte unaffected (regression).
  3. Adding a species via the data file needs no code change (fixture load).

Pure stdlib logic — no ML bundles, no numpy. Run:
    pytest platform/kernel/tests/test_pbpk_species_extrapolation.py -q
"""

from __future__ import annotations

from pathlib import Path

import pytest
from hakase_kernel.pbpk.physiology import loader as L
from hakase_kernel.pbpk.physiology import reliability as R
from hakase_kernel.pbpk.physiology import store as S

FIXTURE = Path(__file__).parent / "fixtures" / "pbpk_species_fixture.json"


# --------------------------------------------------------------------------- #
# 2. Regression — a calibrated species is byte-for-byte unaffected
# --------------------------------------------------------------------------- #


def test_calibrated_rat_sd_byte_for_byte():
    phys = S.get_physiology("rat", "sprague_dawley")
    # Pin the full numeric output (identical to the S1-T2 scaling math).
    assert phys.body_weight_kg == pytest.approx(0.300)
    assert phys.cardiac_output_ml_min == pytest.approx(360.0 * 0.300)
    assert phys.hepatic_blood_flow_ml_min == pytest.approx(70.0 * 0.300)
    assert phys.gfr_ml_min == pytest.approx(5.5 * 0.300)
    assert phys.plasma_albumin_g_l == pytest.approx(34.0)
    assert phys.blood_volume_l == pytest.approx(0.074 * 0.300)
    assert phys.plasma_volume_l == pytest.approx(0.074 * 0.300 * (1.0 - 0.46))
    assert phys.organ_volume_l["liver"] == pytest.approx(0.0366 * 0.300)
    assert phys.organ_blood_flow_ml_min["liver"] == pytest.approx(0.174 * 360.0 * 0.300)
    # And the new metadata: not an extrapolation.
    assert phys.allometric_extrapolation is False
    assert phys.uncertainty[R.METABOLIC_CLEARANCE].reliability is not R.Reliability.VERY_LOW


def test_calibrated_scaling_unchanged_under_bw_change():
    # The S1-T2 allometric behaviour still holds for calibrated species.
    ref = S.get_physiology("rat", "sprague_dawley")
    heavy = S.get_physiology("rat", "sprague_dawley", body_weight_kg=0.600)
    assert heavy.cardiac_output_ml_min == pytest.approx(
        ref.cardiac_output_ml_min * 2.0**S.ALLOMETRIC_FLOW_EXPONENT
    )
    assert heavy.allometric_extrapolation is False


# --------------------------------------------------------------------------- #
# 1. Unknown species -> allometric extrapolation
# --------------------------------------------------------------------------- #


def test_unknown_species_extrapolates_with_flag():
    phys = S.get_physiology("rabbit", body_weight_kg=3.5)
    assert phys.allometric_extrapolation is True
    assert phys.species == "rabbit"
    assert phys.body_weight_kg == pytest.approx(3.5)
    # Built from the generic-mammal anchor, scaled to 3.5 kg.
    gm = S.GENERIC_MAMMAL
    expected_co = (
        gm.cardiac_output_ml_min_kg
        * gm.reference_body_weight_kg
        * (3.5 / gm.reference_body_weight_kg) ** S.ALLOMETRIC_FLOW_EXPONENT
    )
    assert phys.cardiac_output_ml_min == pytest.approx(expected_co)


def test_extrapolated_row_uses_conserved_tissue_composition():
    phys = S.get_physiology("rabbit", body_weight_kg=3.5)
    # Same conserved mammalian R&R table every calibrated row uses.
    assert phys.tissue_composition is S.TISSUE_COMPOSITION


def test_extrapolated_uncertainty_is_widened_and_metabolic_is_least_reliable():
    phys = S.get_physiology("rabbit", body_weight_kg=3.5)
    calib = R.calibrated_uncertainty(is_human=False)
    # Every group is at least as uncertain as the calibrated non-human baseline.
    for group in R.PARAMETER_GROUPS:
        assert phys.uncertainty[group].cv >= calib[group].cv, group
    # Metabolic clearance is the single least-reliable quantity.
    metabolic = phys.uncertainty[R.METABOLIC_CLEARANCE]
    assert metabolic.reliability is R.Reliability.VERY_LOW
    least = min(R.reliability_rank(u.reliability) for u in phys.uncertainty.values())
    assert R.reliability_rank(metabolic.reliability) == least
    assert all(
        u.reliability is not R.Reliability.VERY_LOW
        for g, u in phys.uncertainty.items()
        if g != R.METABOLIC_CLEARANCE
    )


def test_extrapolated_flows_scale_allometrically():
    small = S.get_physiology("rabbit", body_weight_kg=2.0)
    big = S.get_physiology("rabbit", body_weight_kg=4.0)
    ratio = 2.0**S.ALLOMETRIC_FLOW_EXPONENT
    assert big.cardiac_output_ml_min == pytest.approx(small.cardiac_output_ml_min * ratio)
    assert big.organ_volume_l["liver"] == pytest.approx(small.organ_volume_l["liver"] * 2.0)


def test_unknown_species_without_body_weight_raises():
    with pytest.raises(ValueError):
        S.get_physiology("rabbit")


# --------------------------------------------------------------------------- #
# 3. Adding a species via the data file needs no code change
# --------------------------------------------------------------------------- #


@pytest.fixture
def fixture_species():
    added = L.load_species_definitions(FIXTURE)
    keys = [(r.species, r.strain) for r in added]
    try:
        yield added
    finally:
        for sp, st in keys:
            S.SPECIES_PHYSIOLOGY.pop((sp, st), None)
            if S.DEFAULT_STRAIN.get(sp) == st:
                S.DEFAULT_STRAIN.pop(sp, None)


def test_data_file_species_resolves_as_calibrated(fixture_species):
    phys = S.get_physiology("hakase_test_critter")  # strain defaults from the file
    assert phys.strain == "reference"
    assert phys.allometric_extrapolation is False  # a calibrated row, not extrapolated
    assert phys.body_weight_kg == pytest.approx(0.5)
    assert phys.cardiac_output_ml_min == pytest.approx(320.0 * 0.5)
    assert phys.organ_volume_l["liver"] == pytest.approx(0.040 * 0.5)
    # It is a real registry entry now.
    assert ("hakase_test_critter", "reference") in S.SPECIES_PHYSIOLOGY


def test_data_file_species_gone_after_fixture_teardown():
    # Confirms the fixture cleanup leaves no residue (isolation).
    assert ("hakase_test_critter", "reference") not in S.SPECIES_PHYSIOLOGY


def test_data_file_may_not_override_calibrated_row(tmp_path):
    clash = tmp_path / "clash.json"
    clash.write_text(
        """
        {"species": [
          {"species": "rat", "strain": "sprague_dawley",
           "reference_body_weight_kg": 0.3, "cardiac_output_ml_min_kg": 1.0,
           "hepatic_blood_flow_ml_min_kg": 1.0, "gfr_ml_min_kg": 1.0,
           "plasma_albumin_g_l": 1.0, "blood_volume_fraction": 0.07, "hematocrit": 0.45,
           "organ_volume_fraction": {"liver": 0.03},
           "organ_blood_flow_fraction": {"liver": 0.2}}
        ]}
        """,
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        L.load_species_definitions(clash)


def test_malformed_data_file_entry_raises(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text('{"species": [{"species": "x", "strain": "y"}]}', encoding="utf-8")
    with pytest.raises(ValueError):  # missing required numeric fields
        L.load_species_definitions(bad)


def test_default_data_file_loads_and_is_empty():
    # The shipped default file parses and (being empty) adds nothing.
    added = L.load_default(registry={}, default_strain={})
    assert added == []
