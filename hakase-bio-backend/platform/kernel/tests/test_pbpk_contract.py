"""Tests for the ``DispositionParameters`` contract (PBPK layer S1-T1).

Covers the acceptance criteria in ``docs/pbpk-layer.md`` Part 6:
  1. The dataclass is instantiable.
  2. A fully-populated small-molecule instance round-trips through ``to_dict`` /
     ``from_dict`` unchanged.
  3. An empty modality-extension round-trips.
Plus the envelope invariants the contract must enforce (provenance vocabulary,
interval ordering).

Pure stdlib logic — no ML bundles, no numpy — so it runs fast and standalone:
    pytest platform/kernel/tests/test_pbpk_contract.py -q
"""

from __future__ import annotations

import pytest
from hakase_kernel.pbpk import contract as C


def _qty(
    value: float, units: str, *, ci=(None, None), provenance="ml", source="test"
) -> C.Quantity:
    return C.Quantity(
        value=value,
        units=units,
        provenance=provenance,
        source=source,
        ci_low=ci[0],
        ci_high=ci[1],
    )


def _small_molecule_disposition() -> C.DispositionParameters:
    """A representative, fully-populated small-molecule contract instance."""
    return C.DispositionParameters(
        fu_plasma=_qty(0.12, "fraction", ci=(0.09, 0.15), provenance="ml", source="PPBR_AZ"),
        fu_blood=_qty(
            0.10, "fraction", ci=(0.07, 0.13), provenance="derived", source="fu_p / R_bp"
        ),
        blood_plasma_ratio=_qty(1.0, "ratio", provenance="assumed", source="R_bp assumed 1.0"),
        cl_hepatic=_qty(12.0, "mL/min/kg", ci=(8.0, 18.0), provenance="ml", source="well-stirred"),
        cl_renal=_qty(2.0, "mL/min/kg", ci=(1.4, 2.7), provenance="derived", source="GFR*fu"),
        cl_total=_qty(14.0, "mL/min/kg", ci=(9.4, 20.7), provenance="derived", source="hep+renal"),
        kp={
            "liver": _qty(3.5, "unitless", ci=(2.1, 5.0), provenance="derived", source="R&R"),
            "kidney": _qty(2.8, "unitless", provenance="derived", source="R&R"),
            "heart": _qty(1.9, "unitless", provenance="derived", source="R&R"),
        },
        vdss=_qty(0.7, "L/kg", ci=(0.5, 1.0), provenance="ml", source="VDss_Lombardo"),
        extraction_ratio=_qty(0.58, "fraction", provenance="derived", source="CL_blood/Q_h"),
        hepatic_first_pass=_qty(0.42, "fraction", provenance="derived", source="1 - E_h"),
        species_context=C.SpeciesContext(
            species="rat", strain="sprague_dawley", sex="male", age="adult", body_weight_kg=0.25
        ),
        applicability_domain=C.ApplicabilityDomain(
            verdict="in", score=0.82, threshold=0.4, rationale="within ADMET training domain"
        ),
        modality_extension=C.ModalityExtension(modality="small-molecule"),
    )


def test_dataclass_instantiable():
    dp = _small_molecule_disposition()
    assert dp.fu_plasma.value == pytest.approx(0.12)
    assert dp.kp["liver"].value == pytest.approx(3.5)
    assert dp.species_context.species == "rat"
    assert dp.applicability_domain.verdict == "in"
    assert dp.modality_extension.is_empty()


def test_small_molecule_round_trips():
    dp = _small_molecule_disposition()
    restored = C.DispositionParameters.from_dict(dp.to_dict())
    assert restored == dp  # frozen dataclasses compare by value


def test_empty_modality_extension_round_trips():
    ext = C.ModalityExtension(modality="small-molecule")
    assert ext.is_empty()
    assert C.ModalityExtension.from_dict(ext.to_dict()) == ext

    # And the whole contract still round-trips with the empty extension in place.
    dp = _small_molecule_disposition()
    assert dp.modality_extension.is_empty()
    assert C.DispositionParameters.from_dict(dp.to_dict()) == dp


def test_non_empty_modality_extension_round_trips():
    # A future modality (e.g. mAb) fills the slot; the core is untouched.
    ext = C.ModalityExtension(
        modality="antibody",
        parameters={
            "fcrn_affinity": _qty(5.0, "1/uM", provenance="ml", source="FcRn model"),
        },
        metadata={"target": "IL-6R"},
    )
    assert not ext.is_empty()
    assert C.ModalityExtension.from_dict(ext.to_dict()) == ext


def test_quantity_canonical_serialisation_order():
    keys = list(_qty(1.0, "L/kg").to_dict().keys())
    assert keys == ["value", "ci_low", "ci_high", "provenance", "source", "units"]


def test_quantity_rejects_unknown_provenance():
    with pytest.raises(ValueError):
        _qty(1.0, "L/kg", provenance="guessed")


def test_quantity_accepts_provenance_enum_member():
    q = C.Quantity(value=1.0, units="L/kg", provenance=C.Provenance.MEASURED, source="lab")
    assert q.provenance == "measured"
    assert isinstance(q.provenance, str)


def test_quantity_rejects_inverted_interval():
    with pytest.raises(ValueError):
        _qty(1.0, "L/kg", ci=(2.0, 0.5))


def test_quantity_rejects_value_outside_interval():
    with pytest.raises(ValueError):
        _qty(5.0, "L/kg", ci=(1.0, 2.0))


def test_quantity_requires_units_and_source():
    with pytest.raises(ValueError):
        C.Quantity(value=1.0, units="", provenance="ml", source="x")
    with pytest.raises(ValueError):
        C.Quantity(value=1.0, units="L/kg", provenance="ml", source="")


def test_applicability_domain_rejects_unknown_verdict():
    with pytest.raises(ValueError):
        C.ApplicabilityDomain(verdict="maybe")


def test_species_context_rejects_nonpositive_bw():
    with pytest.raises(ValueError):
        C.SpeciesContext(species="rat", body_weight_kg=0.0)
