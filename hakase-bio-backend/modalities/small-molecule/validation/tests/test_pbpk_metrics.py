"""Unit tests for the PBPK validation metrics (S2-T5).

Pure-function tests — no PBPK engine, no PK data. They pin the fold-error /
coverage / permutation-control mechanics so a future change that silently breaks
the gate's scoring is caught.

Run:  python3 -m pytest validation/tests/test_pbpk_metrics.py
"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pbpk_metrics import (  # noqa: E402
    calculate_pbpk_metrics,
    calculate_permutation_control,
    compute_coverage,
    compute_fold_error,
)


def test_fold_error_is_symmetric():
    true = np.array([10.0, 10.0])
    # 2x over and 2x under must both read as a 2.0 fold error.
    pred = np.array([20.0, 5.0])
    fe = compute_fold_error(true, pred)
    assert np.allclose(fe, [2.0, 2.0])


def test_fold_error_perfect_is_one():
    x = np.array([1.0, 50.0, 900.0])
    assert np.allclose(compute_fold_error(x, x), 1.0)


def test_fold_error_nonpositive_and_nonfinite_are_inf():
    true = np.array([10.0, 10.0, 10.0, 0.0])
    pred = np.array([0.0, np.nan, -5.0, 10.0])
    fe = compute_fold_error(true, pred)
    assert np.all(np.isinf(fe))


def test_within_bands_counting():
    true = np.array([10.0, 10.0, 10.0, 10.0])
    # fold errors: 1x, 2x, 3x, 5x
    pred = np.array([10.0, 20.0, 30.0, 50.0])
    m = calculate_pbpk_metrics(true, pred, pred, pred)
    assert m["within_2x"] == 0.5  # 1x, 2x
    assert m["within_3x"] == 0.75  # 1x, 2x, 3x
    assert m["median_fold_error"] == 2.5  # median of [1,2,3,5]


def test_coverage():
    true = np.array([5.0, 5.0, 5.0])
    lo = np.array([1.0, 6.0, 4.0])
    hi = np.array([10.0, 9.0, 6.0])
    # only rows 0 and 2 bracket the truth
    assert compute_coverage(true, lo, hi) == 2 / 3


def test_empty_inputs_do_not_crash():
    empty = np.array([])
    m = calculate_pbpk_metrics(empty, empty, empty, empty)
    assert m["within_2x"] == 0.0 and m["coverage"] == 0.0


def test_permutation_control_is_beaten_by_a_real_signal():
    # Perfectly ordered, well-separated predictions: the true pairing scores
    # 100% within-2x, but shuffling truth against prediction must score far
    # lower. A control that ties the real metric means no discriminating power.
    x = np.array([1.0, 10.0, 100.0, 1000.0, 10000.0])
    real = calculate_pbpk_metrics(x, x, x, x)
    ctrl = calculate_permutation_control(x, x, x, x, n_permutations=200)
    assert real["within_2x"] == 1.0
    assert ctrl["within_2x"] < 0.5


def test_permutation_control_is_deterministic():
    x = np.array([1.0, 10.0, 100.0, 1000.0])
    a = calculate_permutation_control(x, x, x, x, seed=7)
    b = calculate_permutation_control(x, x, x, x, seed=7)
    assert a == b


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
