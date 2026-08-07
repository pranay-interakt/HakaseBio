from typing import Any

import numpy as np

_EMPTY = {"within_2x": 0.0, "within_3x": 0.0, "coverage": 0.0, "median_fold_error": 0.0}


def compute_fold_error(y_true: np.ndarray, y_pred: np.ndarray) -> np.ndarray:
    """Symmetric fold error: max(pred/true, true/pred), always >= 1.

    Non-finite or non-positive entries (a failed prediction or a zero
    observation) yield ``inf`` rather than a divide-by-zero, so they count as
    outside every fold band instead of silently corrupting the distribution.
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    valid = (y_true > 0) & (y_pred > 0) & np.isfinite(y_true) & np.isfinite(y_pred)
    ratio = np.full(y_true.shape, np.inf, dtype=float)
    ratio[valid] = np.maximum(y_pred[valid] / y_true[valid], y_true[valid] / y_pred[valid])
    return ratio


def compute_coverage(y_true: np.ndarray, ci_low: np.ndarray, ci_high: np.ndarray) -> float:
    """Fraction of true values falling within the [ci_low, ci_high] interval."""
    y_true = np.asarray(y_true, dtype=float)
    ci_low = np.asarray(ci_low, dtype=float)
    ci_high = np.asarray(ci_high, dtype=float)
    covered = (y_true >= ci_low) & (y_true <= ci_high)
    return float(np.mean(covered))


def calculate_pbpk_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    ci_low: np.ndarray,
    ci_high: np.ndarray,
) -> dict[str, Any]:
    """Fold-error distribution (% within 2x / 3x, median) and interval coverage."""
    if len(y_true) == 0:
        return dict(_EMPTY)

    fold_errors = compute_fold_error(y_true, y_pred)

    return {
        "within_2x": float(np.mean(fold_errors <= 2.0)),
        "within_3x": float(np.mean(fold_errors <= 3.0)),
        "coverage": compute_coverage(y_true, ci_low, ci_high),
        "median_fold_error": float(np.median(fold_errors)),
    }


def calculate_permutation_control(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    ci_low: np.ndarray,
    ci_high: np.ndarray,
    n_permutations: int = 100,
    seed: int = 42,
) -> dict[str, Any]:
    """Random baseline: shuffle predictions against truth and re-score.

    A real model must beat this control. If the metrics on the true pairing are
    indistinguishable from the shuffled control, the harness has no discriminating
    power — either the model ignores compound identity or the set is too small.
    """
    if len(y_true) == 0:
        return dict(_EMPTY)

    results: dict[str, list[float]] = {k: [] for k in _EMPTY}
    rng = np.random.default_rng(seed)

    for _ in range(n_permutations):
        idx = rng.permutation(len(y_pred))
        m = calculate_pbpk_metrics(y_true, y_pred[idx], ci_low[idx], ci_high[idx])
        for k in results:
            results[k].append(m[k])

    return {k: float(np.mean(v)) for k, v in results.items()}
