"""Tests for the curated, cited measured-input reference and its integration
into ``predict_pk_ivive``.

The reference lifts primary-source-traced rat hepatocyte CLint / fu / B:P
(Naritomi 2003, Ito 2004) into a production resource consulted BELOW a caller
override but ABOVE any ML value — so a rat prediction uses real rat data instead
of the human-trained ML CLint, which is uninformative for rat.

Run:
    pytest modalities/small-molecule/engine/src/hakase_smallmol/tests/test_measured_reference.py -q
"""

from __future__ import annotations

import pytest

from hakase_smallmol.pk_ivive import measured_reference as MR
from hakase_smallmol.pk_ivive import pk_ivive as PK

# Diazepam in a DIFFERENT SMILES form than the reference file stores, to prove
# matching is by InChIKey (canonicalising) rather than string equality.
DIAZEPAM = "CN1C(=O)CN=C(C2=C1C=CC(=C2)Cl)C3=CC=CC=C3"
# Diclofenac — an Ito 2004 row that carries CLint + fu but NO blood:plasma ratio.
DICLOFENAC = "OC(=O)Cc1ccccc1Nc1c(Cl)cccc1Cl"
# A full ml_inputs set with values DISTINCT from the reference, so a test can tell
# which tier won. Supplying all four keys means no server ADMET call is made.
_ML = {
    "clint_hep_ul_min_1e6": 999.0,
    "fu_plasma": 0.99,
    "vdss_l_per_kg": 0.7,
    "half_life_obach_h": 5.0,
}


# --------------------------------------------------------------------------- #
# The loader
# --------------------------------------------------------------------------- #


def test_loader_matches_rat_diazepam_by_inchikey():
    rec = MR.lookup_measured_record(DIAZEPAM, "rat")
    assert rec is not None
    assert rec.compound_name == "Diazepam"
    assert rec.species == "rat"
    assert rec.clint_hep_ul_min_1e6 == pytest.approx(71.875)
    assert rec.fu_plasma == pytest.approx(0.137)
    assert rec.blood_plasma_ratio == pytest.approx(1.04)
    assert rec.reference_pmid == "12695346"
    assert rec.provenance_label() == "measured (Naritomi 2003, PMID:12695346)"


def test_loader_is_species_aware():
    # Every curated record is rat; a human request must not be served rat data.
    assert MR.lookup_measured_record(DIAZEPAM, "human") is None
    assert MR.lookup_measured_reference(DIAZEPAM, "human") is None
    # Case-insensitive species handling.
    assert MR.lookup_measured_record(DIAZEPAM, "RAT") is not None


def test_loader_omits_blank_cells_never_zero_fills():
    # Ito rows carry no blood:plasma ratio — the key must be absent, not 0.0.
    resolved = MR.lookup_measured_reference(DICLOFENAC, "rat")
    assert resolved is not None
    assert "clint_hep_ul_min_1e6" in resolved and "fu_plasma" in resolved
    assert "blood_plasma_ratio" not in resolved


def test_loader_unknown_compound_returns_none():
    assert MR.lookup_measured_record("CCO", "rat") is None  # ethanol, not curated
    assert MR.lookup_measured_reference("not a smiles", "rat") is None


def test_reference_provenance_is_measured_with_pmid():
    resolved = MR.lookup_measured_reference(DIAZEPAM, "rat")
    for key in ("clint_hep_ul_min_1e6", "fu_plasma", "blood_plasma_ratio"):
        prov = resolved[key]["provenance"]
        assert prov.startswith("measured (") and "PMID:12695346" in prov


# --------------------------------------------------------------------------- #
# Integration into predict_pk_ivive — the priority ladder
# --------------------------------------------------------------------------- #


def test_rat_no_overrides_resolves_measured_not_ml(monkeypatch):
    """The literal task requirement: diazepam via predict_pk_ivive(smiles,
    species='rat') with NO overrides resolves CLint to the measured value with a
    'measured…' provenance, never the ML fallback. ADMET ML is forced off so the
    only way clint can resolve is the curated reference."""
    import hakase_smallmol.admet.admet_ml as admet_ml

    monkeypatch.setattr(
        admet_ml, "predict_admet_ml", lambda smiles: {"ml_available": False, "source": "off"}
    )

    res = PK.predict_pk_ivive(DIAZEPAM, species="rat")
    assert res["source"] == "ivive" and res["available"] is True
    clint = res["inputs"]["clint_hep_ul_min_1e6"]
    assert clint["value"] == pytest.approx(71.875)
    assert clint["provenance"] == "measured"
    assert "Naritomi 2003" in clint["source"] and "PMID:12695346" in clint["source"]
    fu = res["inputs"]["fu_plasma"]
    assert fu["value"] == pytest.approx(0.137) and fu["provenance"] == "measured"


def test_curated_reference_beats_ml_inputs():
    # ml_inputs supply every key (no server call), yet the reference must win for
    # the rat quantities it carries — clint/fu/BPR — over the ml overlay values.
    res = PK.predict_pk_ivive(DIAZEPAM, species="rat", ml_inputs=_ML)
    clint = res["inputs"]["clint_hep_ul_min_1e6"]
    assert clint["value"] == pytest.approx(71.875) and clint["provenance"] == "measured"
    fu = res["inputs"]["fu_plasma"]
    assert fu["value"] == pytest.approx(0.137) and fu["provenance"] == "measured"
    bpr = res["system_parameters"]["blood_plasma_ratio"]
    assert bpr["value"] == pytest.approx(1.04) and bpr["provenance"] == "measured"
    # A key the reference does NOT carry still comes from ml_inputs.
    vdss = res["inputs"]["vdss_l_per_kg"]
    assert vdss["value"] == pytest.approx(0.7) and vdss["provenance"] == "ml"


def test_caller_override_beats_curated_reference():
    res = PK.predict_pk_ivive(
        DIAZEPAM,
        species="rat",
        overrides={"clint_hep_ul_min_1e6": 500.0},
        ml_inputs=_ML,
    )
    clint = res["inputs"]["clint_hep_ul_min_1e6"]
    assert clint["value"] == pytest.approx(500.0)
    assert clint["provenance"] == "measured"
    assert clint["source"] == "user-supplied measured value"
    # fu, untouched by the override, still comes from the curated reference.
    assert res["inputs"]["fu_plasma"]["value"] == pytest.approx(0.137)


def test_human_prediction_does_not_use_rat_reference():
    # Same molecule, human species: the rat reference must NOT fire; clint falls
    # through to the supplied ml overlay value.
    res = PK.predict_pk_ivive(DIAZEPAM, species="human", ml_inputs=_ML)
    clint = res["inputs"]["clint_hep_ul_min_1e6"]
    assert clint["value"] == pytest.approx(999.0) and clint["provenance"] == "ml"


def test_uncurated_rat_compound_falls_through_to_ml():
    # Ethanol is not in the reference — the ml overlay must supply clint/fu.
    res = PK.predict_pk_ivive("CCO", species="rat", ml_inputs=_ML)
    clint = res["inputs"]["clint_hep_ul_min_1e6"]
    assert clint["value"] == pytest.approx(999.0) and clint["provenance"] == "ml"


def test_reference_bpr_absent_falls_back_to_assumed():
    # Diclofenac (Ito) has clint+fu measured but no B:P → BPR stays assumed 1.0.
    res = PK.predict_pk_ivive(DICLOFENAC, species="rat", ml_inputs=_ML)
    assert res["inputs"]["clint_hep_ul_min_1e6"]["provenance"] == "measured"
    bpr = res["system_parameters"]["blood_plasma_ratio"]
    assert bpr["value"] == pytest.approx(PK.DEFAULT_BLOOD_PLASMA_RATIO)
    assert bpr["provenance"] == "assumed"


def test_measured_reference_input_carries_no_mc_uncertainty():
    # A measured input contributes zero model error in the Monte-Carlo wrapper —
    # so the reference-sourced clint must be flagged 'measured' there too.
    res = PK.predict_pk_ivive(
        DIAZEPAM, species="rat", ml_inputs=_ML, montecarlo=True, mc_samples=200
    )
    models = res["uncertainty"]["residual_models"]
    assert models["clint_hep_ul_min_1e6"]["provenance"] == "measured"
    assert models["clint_hep_ul_min_1e6"]["sigma"] == 0.0
