"""Tests for the pKa predictor wrapper (S1-T3a).

Acceptance (docs/pbpk-layer.md §4.5 / Part 6):
  * benchmark RMSE reported;
  * returns per-site pKa + ionisation class;
  * measured override bypasses prediction;
  * cache-hit test passes.

The QupKake and pkasolver backends are unavailable in this environment (no xtb
binary; pkasolver not installable). The coarse heuristic is gated behind an
explicit opt-in (``allow_heuristic=True`` / ``STRICT_PKA=0``) mirroring the
pk_ivive no-fallback contract, so these tests opt in where they exercise it.
Needs RDKit (a modality dependency). Run:
    pytest modalities/small-molecule/engine/src/hakase_smallmol/tests/test_pka.py -q
"""

from __future__ import annotations

import math

import pytest

from hakase_smallmol.pk_ivive import pka as P

# --------------------------------------------------------------------------- #
# Benchmark RMSE reported
# --------------------------------------------------------------------------- #


def test_benchmark_reports_rmse():
    result = P.benchmark(P.PkaPredictor())
    assert result.n_covered == result.n_total  # every reference compound matched
    assert result.rmse is not None
    assert isinstance(result.rmse, float)
    assert 0.0 <= result.rmse < 2.0  # coarse heuristic, but on-set within ~2 pKa
    assert result.mae is not None and result.mae <= result.rmse + 1e-9


# --------------------------------------------------------------------------- #
# Per-site pKa + ionisation class (heuristic opt-in)
# --------------------------------------------------------------------------- #


def test_returns_per_site_pka_and_class_acid():
    r = P.PkaPredictor().predict("CC(=O)O", allow_heuristic=True)  # acetic acid
    assert r.ionisation_class is P.IonisationClass.ACID
    assert len(r.sites) == 1
    assert r.sites[0].site_type is P.SiteType.ACID
    assert r.sites[0].pka == pytest.approx(4.5)


def test_base_classification():
    r = P.PkaPredictor().predict("c1ccncc1", allow_heuristic=True)  # pyridine
    assert r.ionisation_class is P.IonisationClass.BASE
    assert r.sites[0].site_type is P.SiteType.BASE


def test_neutral_classification():
    r = P.PkaPredictor().predict("CCO", allow_heuristic=True)  # ethanol
    assert r.ionisation_class is P.IonisationClass.NEUTRAL
    assert r.sites == ()


def test_zwitterion_classification_tyrosine():
    r = P.PkaPredictor().predict("NC(Cc1ccc(O)cc1)C(=O)O", allow_heuristic=True)  # tyrosine
    assert r.ionisation_class is P.IonisationClass.ZWITTERION
    types = sorted({s.site_type.value for s in r.sites})
    assert types == ["acid", "base"]


# --------------------------------------------------------------------------- #
# Fraction ionised (Henderson-Hasselbalch)
# --------------------------------------------------------------------------- #


def test_fraction_ionised_matches_henderson_hasselbalch():
    r = P.PkaPredictor().predict("CC(=O)O", allow_heuristic=True)  # acid pKa 4.5
    expected = 1.0 / (1.0 + 10.0 ** (4.5 - P.PLASMA_PH))
    assert r.fraction_ionised(P.PLASMA_PH)[0] == pytest.approx(expected)


def test_base_fraction_ionised_and_net_charge():
    r = P.PkaPredictor().predict("CN", allow_heuristic=True)  # methylamine, base pKa 10.5
    expected = 1.0 / (1.0 + 10.0 ** (P.PLASMA_PH - 10.5))
    assert r.fraction_ionised()[0] == pytest.approx(expected)
    assert r.net_charge() == pytest.approx(expected)  # a single base -> positive


# --------------------------------------------------------------------------- #
# Measured override bypasses prediction (works even in strict mode)
# --------------------------------------------------------------------------- #


def test_measured_override_bypasses_prediction():
    pred = P.PkaPredictor()
    measured = [P.MicroPka(pka=9.87, site_type=P.SiteType.ACID)]
    r = pred.predict("CC(=O)O", measured_sites=measured)  # no allow_heuristic needed
    assert r.provenance == "measured"
    assert r.backend == "measured"
    assert r.low_confidence is False
    assert [s.pka for s in r.sites] == [9.87]  # the measured value, not the predicted 4.5
    assert pred.misses == 0  # prediction path was never taken


def test_measured_override_empty_raises():
    with pytest.raises(ValueError):
        P.PkaPredictor().predict("CC(=O)O", measured_sites=[])


# --------------------------------------------------------------------------- #
# Cache keyed on canonical SMILES
# --------------------------------------------------------------------------- #


def test_cache_hit_on_repeat_and_equivalent_smiles():
    pred = P.PkaPredictor()
    first = pred.predict("CC(=O)O", allow_heuristic=True)
    assert pred.misses == 1 and pred.hits == 0
    second = pred.predict("CC(=O)O", allow_heuristic=True)
    assert pred.hits == 1 and pred.misses == 1
    assert second is first  # same cached object
    # A different but equivalent SMILES canonicalises to the same key -> hit.
    third = pred.predict("OC(C)=O", allow_heuristic=True)
    assert third is first
    assert pred.hits == 2 and pred.misses == 1


# --------------------------------------------------------------------------- #
# Low-confidence flag for pKa in [6, 8]
# --------------------------------------------------------------------------- #


def test_low_confidence_flag_when_pka_in_6_8():
    r = P.PkaPredictor().predict("c1c[nH]cn1", allow_heuristic=True)  # imidazole, base pKa 7.0
    assert r.low_confidence is True
    assert any("[6, 8]" in n for n in r.notes)


def test_no_low_confidence_flag_outside_6_8():
    r = P.PkaPredictor().predict("CC(=O)O", allow_heuristic=True)  # pKa 4.5
    assert r.low_confidence is False


# --------------------------------------------------------------------------- #
# Strict opt-in gate for the coarse heuristic
# --------------------------------------------------------------------------- #


def test_strict_default_refuses_heuristic():
    # No validated predictor here; the auto path must refuse rather than guess.
    with pytest.raises(P.PkaBackendUnavailable):
        P.PkaPredictor().predict("CC(=O)O")


def test_forcing_heuristic_backend_is_explicit_optin():
    # Naming the backend is itself opt-in; no allow_heuristic needed.
    r = P.PkaPredictor().predict("CC(=O)O", backend="heuristic")
    assert r.backend == "heuristic"
    assert r.provenance == "heuristic"


def test_env_strict_pka_off_permits_heuristic(monkeypatch):
    monkeypatch.setenv("STRICT_PKA", "0")
    r = P.PkaPredictor().predict("CC(=O)O")  # auto path now allowed to fall back
    assert r.backend == "heuristic"


# --------------------------------------------------------------------------- #
# Canonicalisation + backend availability / selection
# --------------------------------------------------------------------------- #


def test_canonical_smiles_and_invalid():
    assert P.canonical_smiles("OC(C)=O") == P.canonical_smiles("CC(=O)O")
    with pytest.raises(ValueError):
        P.canonical_smiles("this-is-not-a-molecule")


def test_heuristic_available_qm_backends_not():
    pred = P.PkaPredictor()
    assert "heuristic" in pred.available_backends()
    # In this environment neither QM/ML (validated) backend is installed.
    assert not P.QupKakeBackend().is_available()
    assert not P.PkasolverBackend().is_available()
    assert P.QupKakeBackend().trusted and P.PkasolverBackend().trusted
    assert not P.HeuristicBackend().trusted


def test_forcing_unavailable_backend_raises():
    with pytest.raises(P.PkaBackendUnavailable):
        P.PkaPredictor().predict("CC(=O)O", backend="qupkake")


def test_forcing_unknown_backend_raises():
    with pytest.raises(KeyError):
        P.PkaPredictor().predict("CC(=O)O", backend="nope")


def test_ionised_fraction_is_monotonic_in_ph_for_acid():
    site = P.MicroPka(pka=4.5, site_type=P.SiteType.ACID)
    assert site.ionised_fraction(2.0) < site.ionised_fraction(7.4)
    assert math.isclose(site.ionised_fraction(4.5), 0.5)
