"""Read-across: the weighting, and the applicability domain that stops it.

The worked example is checked against the arithmetic of the method itself
(y = sum(s*y)/sum(s)), so the test fails if the weighting changes rather than merely
re-stating the implementation.
"""

import math

import pytest
from rdkit import Chem

from hos.triage.readacross import (
    ReadAcrossParams,
    fingerprint,
    read_across,
    tanimoto,
)

PARACETAMOL = "CC(=O)Nc1ccc(O)cc1"
PHENACETIN = "CCOc1ccc(NC(C)=O)cc1"
CAFFEINE = "Cn1cnc2c1c(=O)n(C)c(=O)n2C"


def _fp(smiles):
    return fingerprint(Chem.MolFromSmiles(smiles))


def test_tanimoto_of_a_structure_with_itself_is_one():
    assert tanimoto(_fp(PARACETAMOL), _fp(PARACETAMOL)) == 1.0


def test_a_close_analogue_scores_above_an_unrelated_structure():
    close = tanimoto(_fp(PARACETAMOL), _fp(PHENACETIN))
    far = tanimoto(_fp(PARACETAMOL), _fp(CAFFEINE))
    assert 0.3 < close < 1.0
    assert far < close


def test_an_empty_fingerprint_carries_no_similarity():
    assert tanimoto(frozenset(), _fp(PARACETAMOL)) == 0.0
    assert tanimoto(frozenset(), frozenset()) == 0.0


def test_weighted_mean_matches_the_stated_equation():
    sims = [0.9, 0.7, 0.6]
    values = [6.0, 5.0, 4.4]
    r = read_across(sims, values, ReadAcrossParams(min_similarity=0.5, min_analogues=3))
    expected = sum(s * v for s, v in zip(sims, values, strict=True)) / sum(sims)
    assert r.value == pytest.approx(expected)
    assert r.in_domain and r.used == (0, 1, 2)
    assert (r.low, r.high) == (4.4, 6.0)
    assert r.nearest_similarity == 0.9


def test_the_nearest_analogues_are_the_ones_used():
    sims = [0.55, 0.95, 0.75, 0.85]
    values = [1.0, 2.0, 3.0, 4.0]
    r = read_across(
        sims, values, ReadAcrossParams(min_similarity=0.5, max_analogues=2, min_analogues=2)
    )
    assert r.used == (1, 3)  # 0.95 then 0.85
    assert r.value == pytest.approx((0.95 * 2.0 + 0.85 * 4.0) / (0.95 + 0.85))


def test_too_few_analogues_abstains_and_says_why():
    r = read_across([0.9, 0.8], [5.0, 4.0], ReadAcrossParams(min_analogues=3))
    assert r.value is None and not r.in_domain
    assert "2 analogue(s)" in r.reason and "3 are required" in r.reason
    assert r.nearest_similarity == 0.9  # what was found is still reported


def test_analogues_below_the_threshold_do_not_count():
    r = read_across([0.9, 0.4, 0.3], [5.0, 1.0, 1.0], ReadAcrossParams(min_analogues=2))
    assert r.value is None
    assert "1 analogue(s) at Tanimoto >= 0.5" in r.reason


def test_an_empty_neighbourhood_abstains_without_a_nearest():
    r = read_across([], [], ReadAcrossParams())
    assert r.value is None and r.nearest_similarity is None


def test_parallel_inputs_are_required():
    with pytest.raises(ValueError, match="same length"):
        read_across([0.9], [1.0, 2.0])


@pytest.mark.parametrize(
    "kwargs",
    [
        {"min_similarity": 0.0},
        {"min_similarity": 1.5},
        {"min_analogues": 0},
        {"max_analogues": 1, "min_analogues": 3},
    ],
)
def test_an_impossible_neighbourhood_is_refused(kwargs):
    with pytest.raises(ValueError):
        ReadAcrossParams(**kwargs)


def test_the_neighbourhood_is_recorded_with_the_result():
    d = ReadAcrossParams().to_dict()
    assert d["similarity"] == "Tanimoto" and d["fingerprint"] == "ECFP4/2048 bits"
    assert math.isclose(d["min_similarity"], 0.5)
