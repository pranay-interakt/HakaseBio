"""Tests for the scientific reasoning + verdict layer.

Covers:
  1. The provenance registry is structurally complete — every constant/threshold the
     verdict uses carries a definition, a source_type, a citation, a status, a limitation;
     and every remaining heuristic is explicitly flagged.
  2. The data-derived applicability-domain threshold (ad_threshold) behaves and beats the
     arbitrary fixed 0.4 in being data-driven and reproducible.
  3. The vendored reasoning trust-layer imports and its guarantees hold in-service.

These run without the heavy ML bundles (pure logic + numpy). The full end-to-end
explain_verdict() is exercised against the real bundles by experiments/, not here, so the
suite stays fast and bundle-independent.  Run:
    pytest platform/kernel/tests/test_scientific_verdict.py -q
"""

from __future__ import annotations

import numpy as np
import pytest
from hakase_kernel.decision import verdict_provenance as prov
from hakase_kernel.uncertainty import ad_threshold as adt

# --------------------------------------------------------------------------- #
# 1. Provenance registry — the "no unexplained constant" guarantee
# --------------------------------------------------------------------------- #


def test_provenance_audit_is_complete():
    summary = prov.audit()  # raises if any entry lacks definition/source/citation/status/limitation
    assert summary["n_registered"] >= 10
    # every source_type is one of the accepted, defensible categories
    for p in prov.REGISTRY.values():
        assert p.source_type in {
            "literature",
            "learned_from_data",
            "experimental",
            "structural",
            "heuristic",
        }
        assert p.citation.strip()
        assert p.definition.strip()


def test_every_heuristic_is_flagged_for_action():
    # A heuristic that is neither justified nor slated for replacement/removal would be an
    # unexplained magic constant — the registry must not contain one.
    for p in prov.heuristics():
        assert p.status in {
            "justified",
            "improve",
            "replace",
            "remove",
        }, f"heuristic {p.key} is not flagged for action"


def test_known_constants_are_registered_with_right_semantics():
    assert prov.get("veto_alpha").source_type == "literature"
    assert prov.get("veto_alpha").value == 0.05
    # the fixed AD cutoff is correctly identified as a heuristic to replace
    ad = prov.get("AD_THRESHOLD")
    assert ad.source_type == "heuristic" and ad.status == "replace"
    # the confidence maps are flagged for replacement
    assert prov.get("classifier_confidence_0.35").status == "replace"
    # the FWER control and the calibrated-probability boundary are justified, not arbitrary
    assert prov.get("TOX21_FWER_MIN_FLAGS").status == "justified"
    assert prov.get("QSAR_CORROBORATES").status == "justified"


def test_registry_serialisable():
    import json

    json.dumps(prov.as_table())


# --------------------------------------------------------------------------- #
# 2. Data-derived applicability-domain threshold
# --------------------------------------------------------------------------- #


def _bit_matrix(n, d, density, seed):
    rng = np.random.default_rng(seed)
    return (rng.uniform(size=(n, d)) < density).astype(np.float32)


def test_derived_threshold_is_reproducible_and_floored():
    T = _bit_matrix(400, 128, 0.1, seed=0)
    a = adt.derive_ad_threshold(T)
    b = adt.derive_ad_threshold(T)
    assert a.threshold == b.threshold  # deterministic (fixed seed)
    assert a.threshold >= a.floor  # never below the conservative floor
    assert 0.0 <= a.derived <= 1.0
    assert a.n_train == 400


def test_denser_training_set_gives_higher_cutoff():
    # A tightly clustered training set (high pairwise similarity) should yield a STRICTER
    # (higher) derived cutoff than a diffuse one — the whole point of deriving from data.
    tight = _bit_matrix(400, 128, 0.5, seed=1)  # many shared bits ⇒ similar rows
    diffuse = _bit_matrix(400, 128, 0.05, seed=2)  # few shared bits ⇒ dissimilar rows
    assert adt.derive_ad_threshold(tight).derived >= adt.derive_ad_threshold(diffuse).derived


def test_tanimoto_nearest_bounds_and_identity():
    T = _bit_matrix(50, 64, 0.2, seed=3)
    # a molecule identical to a training row has Tanimoto 1.0
    assert adt.tanimoto_nearest(T[7], T) == pytest.approx(1.0)
    # bounded in [0,1]
    q = _bit_matrix(1, 64, 0.2, seed=99)[0]
    s = adt.tanimoto_nearest(q, T)
    assert 0.0 <= s <= 1.0


def test_rejects_degenerate_training():
    with pytest.raises(ValueError):
        adt.derive_ad_threshold(np.zeros((2, 10), dtype=np.float32))


# --------------------------------------------------------------------------- #
# 3. Vendored reasoning trust-layer works in-service
# --------------------------------------------------------------------------- #


def test_reasoning_layer_imports_and_abstains_without_calibration():
    from hakase_kernel.decision.reasoning import CalibratedReliability, build_record

    cr = CalibratedReliability(higher_is_better=False)
    est = cr.estimate(0.1)
    assert est.estimable is False  # no calibration ⇒ honest abstention
    rec = build_record(
        endpoint="x",
        prediction=1,
        method="m",
        reliability=est,
        applicability={"ad_in_domain": True},
    )
    assert rec.abstain is True  # policy abstains when reliability not estimable


def test_reasoning_layer_guaranteed_selective_risk_holds():
    from hakase_kernel.decision.reasoning import guaranteed_risk_threshold

    rng = np.random.default_rng(0)
    n = 8000
    conf = rng.uniform(0, 1, n)
    err = (rng.uniform(0, 1, n) < 0.5 * (1 - conf)).astype(float)
    gt = guaranteed_risk_threshold(err, conf, target_risk=0.1, delta=0.05)
    assert gt.feasible
    assert gt.guaranteed_risk <= 0.1 + 1e-9
