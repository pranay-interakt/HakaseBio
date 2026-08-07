"""Validation metrics — transparent numpy implementations, verified vs sklearn.

Every function takes real (truth, prediction) arrays and returns a real number.
No thresholds are hard-coded; classification metrics at a decision threshold take
the threshold as an argument. The unit tests in validation/tests assert these
match scikit-learn on real datasets, so the engine is trustworthy without
importing sklearn at runtime (numpy only).
"""

from __future__ import annotations

import math

import numpy as np


def _pair(y_true, y_score) -> tuple[np.ndarray, np.ndarray]:
    yt = np.asarray(y_true, dtype=float).ravel()
    ys = np.asarray(y_score, dtype=float).ravel()
    if yt.size != ys.size:
        raise ValueError("length mismatch")
    if yt.size == 0:
        raise ValueError("empty input")
    if not np.all(np.isfinite(ys)):
        raise ValueError("non-finite scores")
    return yt, ys


# ── Binary classification ─────────────────────────────────────────────────────
def auroc(y_true, y_score) -> float:
    """ROC-AUC via the Mann–Whitney U statistic (exact, ties handled by midranks)."""
    yt, ys = _pair(y_true, y_score)
    pos = ys[yt == 1]
    neg = ys[yt == 0]
    n_pos, n_neg = pos.size, neg.size
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    order = np.argsort(ys, kind="mergesort")
    ranks = np.empty(ys.size, dtype=float)
    sorted_scores = ys[order]
    # average ranks for ties
    i = 0
    while i < ys.size:
        j = i
        while j + 1 < ys.size and sorted_scores[j + 1] == sorted_scores[i]:
            j += 1
        avg = (i + j) / 2.0 + 1.0  # 1-indexed average rank
        ranks[order[i : j + 1]] = avg
        i = j + 1
    sum_ranks_pos = ranks[yt == 1].sum()
    u = sum_ranks_pos - n_pos * (n_pos + 1) / 2.0
    return float(u / (n_pos * n_neg))


def auprc(y_true, y_score) -> float:
    """Average precision (area under precision–recall), step interpolation —
    matches sklearn.average_precision_score."""
    yt, ys = _pair(y_true, y_score)
    n_pos = int((yt == 1).sum())
    if n_pos == 0:
        return float("nan")
    order = np.argsort(-ys, kind="mergesort")
    yt_sorted = yt[order]
    tp = np.cumsum(yt_sorted == 1)
    fp = np.cumsum(yt_sorted == 0)
    precision = tp / np.maximum(tp + fp, 1)
    recall = tp / n_pos
    # sum precision_k * (recall_k - recall_{k-1})  (sklearn AP convention)
    recall_prev = np.concatenate([[0.0], recall[:-1]])
    ap = float(np.sum(precision * (recall - recall_prev)))
    return ap


def brier(y_true, y_score) -> float:
    yt, ys = _pair(y_true, y_score)
    return float(np.mean((ys - yt) ** 2))


def confusion_at(y_true, y_score, threshold: float) -> dict[str, int]:
    yt, ys = _pair(y_true, y_score)
    pred = (ys >= threshold).astype(int)
    tp = int(np.sum((pred == 1) & (yt == 1)))
    fp = int(np.sum((pred == 1) & (yt == 0)))
    tn = int(np.sum((pred == 0) & (yt == 0)))
    fn = int(np.sum((pred == 0) & (yt == 1)))
    return {"tp": tp, "fp": fp, "tn": tn, "fn": fn}


def classification_metrics(y_true, y_score, threshold: float = 0.5) -> dict[str, float]:
    c = confusion_at(y_true, y_score, threshold)
    tp, fp, tn, fn = c["tp"], c["fp"], c["tn"], c["fn"]
    recall = tp / (tp + fn) if (tp + fn) else float("nan")  # sensitivity / TPR
    specificity = tn / (tn + fp) if (tn + fp) else float("nan")
    fpr = fp / (fp + tn) if (fp + tn) else float("nan")
    precision = tp / (tp + fp) if (tp + fp) else float("nan")
    bal_acc = np.nanmean([recall, specificity])
    denom = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    mcc = ((tp * tn - fp * fn) / denom) if denom > 0 else float("nan")
    return {
        "auroc": auroc(y_true, y_score),
        "auprc": auprc(y_true, y_score),
        "brier": brier(y_true, y_score),
        "threshold": float(threshold),
        "recall_sensitivity": float(recall),
        "specificity": float(specificity),
        "fpr": float(fpr),
        "precision": float(precision),
        "balanced_accuracy": float(bal_acc),
        "mcc": float(mcc),
        **{k: float(v) for k, v in c.items()},
    }


def expected_calibration_error(y_true, y_score, n_bins: int = 10) -> dict[str, float]:
    """ECE + per-bin reliability (equal-width bins). Lower ECE = better calibrated."""
    yt, ys = _pair(y_true, y_score)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n = ys.size
    bins = []
    for b in range(n_bins):
        lo, hi = edges[b], edges[b + 1]
        mask = (ys >= lo) & (ys < hi) if b < n_bins - 1 else (ys >= lo) & (ys <= hi)
        if not np.any(mask):
            continue
        conf = float(np.mean(ys[mask]))
        acc = float(np.mean(yt[mask]))
        w = float(np.mean(mask))
        ece += w * abs(acc - conf)
        bins.append({"bin": b, "mean_pred": conf, "frac_positive": acc, "weight": w})
    return {"ece": float(ece), "bins": bins}


# ── Regression (ADMET numeric endpoints) ──────────────────────────────────────
def regression_metrics(y_true, y_pred) -> dict[str, float]:
    yt, yp = _pair(y_true, y_pred)
    err = yp - yt
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err**2)))
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((yt - np.mean(yt)) ** 2))
    r2 = float(1.0 - ss_res / ss_tot) if ss_tot > 0 else float("nan")
    # Spearman ρ (rank correlation) — robust to monotone scaling.
    rt = _rankdata(yt)
    rp = _rankdata(yp)
    spearman = float(np.corrcoef(rt, rp)[0, 1]) if yt.size > 1 else float("nan")
    return {"n": int(yt.size), "mae": mae, "rmse": rmse, "r2": r2, "spearman": spearman}


def fold_error_metrics(y_true_linear, y_pred_linear) -> dict[str, float]:
    """Fold-error stats for STRICTLY POSITIVE linear-scale quantities
    (clearance, IC50, t½). fold_i = max(pred/true, true/pred) ≥ 1. Reports the
    geometric-mean fold error (GMFE), % within 2-/3-fold, and the geometric-mean
    bias (pred/true; <1 = under-prediction). The standard PK/ADMET error report.
    """
    yt = np.asarray(y_true_linear, dtype=float).ravel()
    yp = np.asarray(y_pred_linear, dtype=float).ravel()
    if yt.size != yp.size or yt.size == 0:
        raise ValueError("length mismatch / empty")
    if np.any(yt <= 0) or np.any(yp <= 0):
        raise ValueError("fold-error requires strictly positive values")
    ratio = yp / yt
    fold = np.maximum(ratio, 1.0 / ratio)
    gmfe = float(np.exp(np.mean(np.abs(np.log(ratio)))))
    gm_bias = float(np.exp(np.mean(np.log(ratio))))
    return {
        "n": int(yt.size),
        "gmfe": gmfe,  # geometric-mean fold error (≥1)
        "geometric_mean_bias": gm_bias,  # <1 under-predicts, >1 over-predicts
        "pct_within_2fold": float(np.mean(fold <= 2.0)),
        "pct_within_3fold": float(np.mean(fold <= 3.0)),
        "median_fold_error": float(np.median(fold)),
    }


def bootstrap_ci(
    values_true, values_pred, stat_fn, n_boot: int = 2000, alpha: float = 0.05, seed: int = 0
) -> dict[str, float]:
    """Nonparametric percentile bootstrap CI for any paired statistic.

    Resamples (truth, pred) pairs with replacement n_boot times and returns the
    point estimate plus the [alpha/2, 1-alpha/2] percentile interval — so every
    headline number in the report card carries an honest uncertainty band rather
    than a single point estimate. `stat_fn(true_arr, pred_arr) -> float`.
    """
    yt = np.asarray(values_true).ravel()
    yp = np.asarray(values_pred).ravel()
    if yt.size != yp.size or yt.size == 0:
        raise ValueError("length mismatch / empty")
    rng = np.random.RandomState(seed)
    n = yt.size
    point = float(stat_fn(yt, yp))
    stats = np.empty(n_boot)
    for b in range(n_boot):
        idx = rng.randint(0, n, n)
        try:
            stats[b] = stat_fn(yt[idx], yp[idx])
        except Exception:
            stats[b] = np.nan
    lo = float(np.nanpercentile(stats, 100 * alpha / 2))
    hi = float(np.nanpercentile(stats, 100 * (1 - alpha / 2)))
    return {"point": point, "ci_low": lo, "ci_high": hi, "confidence": 1 - alpha, "n_boot": n_boot}


def _rankdata(a: np.ndarray) -> np.ndarray:
    order = np.argsort(a, kind="mergesort")
    ranks = np.empty(a.size, dtype=float)
    sa = a[order]
    i = 0
    while i < a.size:
        j = i
        while j + 1 < a.size and sa[j + 1] == sa[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2.0 + 1.0
        i = j + 1
    return ranks


# ── Verdict-level (triage) ────────────────────────────────────────────────────
def triage_metrics(advance_pred, advance_true) -> dict[str, float]:
    """Triage performance where 1 = 'advance' (approved) and 0 = 'halt'
    (withdrawn/liability). Reports the buyer-facing numbers: FPR on approved,
    recall on withdrawn, enrichment factor of the advance set, MCC, balanced acc.
    """
    ap = np.asarray(advance_pred, dtype=int).ravel()
    at = np.asarray(advance_true, dtype=int).ravel()
    if ap.size != at.size or ap.size == 0:
        raise ValueError("length mismatch / empty")
    # 'positive event' for safety = WITHDRAWN (halt-true). Recall-on-withdrawn:
    halt_true = at == 0
    halt_pred = ap == 0
    recall_withdrawn = float(np.mean(halt_pred[halt_true])) if np.any(halt_true) else float("nan")
    approved_true = at == 1
    # FPR on approved = fraction of approved drugs that were (wrongly) halted.
    fpr_on_approved = (
        float(np.mean(halt_pred[approved_true])) if np.any(approved_true) else float("nan")
    )
    base_rate_advanceable = float(np.mean(at == 1))
    advanced = ap == 1
    prec_advance = float(np.mean(at[advanced] == 1)) if np.any(advanced) else float("nan")
    enrichment = (
        float(prec_advance / base_rate_advanceable)
        if base_rate_advanceable > 0 and not math.isnan(prec_advance)
        else float("nan")
    )
    tp = int(np.sum((ap == 0) & (at == 0)))  # correctly halted withdrawn
    fp = int(np.sum((ap == 0) & (at == 1)))  # wrongly halted approved
    tn = int(np.sum((ap == 1) & (at == 1)))  # correctly advanced approved
    fn = int(np.sum((ap == 1) & (at == 0)))  # missed withdrawn
    denom = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    mcc = ((tp * tn - fp * fn) / denom) if denom > 0 else float("nan")
    bal_acc = float(np.nanmean([recall_withdrawn, 1.0 - fpr_on_approved]))
    return {
        "n": int(ap.size),
        "recall_on_withdrawn": recall_withdrawn,
        "fpr_on_approved": fpr_on_approved,
        "precision_of_advance_set": prec_advance,
        "enrichment_factor": enrichment,
        "balanced_accuracy": bal_acc,
        "mcc": mcc,
        "confusion": {
            "halted_withdrawn": tp,
            "halted_approved": fp,
            "advanced_approved": tn,
            "advanced_withdrawn": fn,
        },
    }
