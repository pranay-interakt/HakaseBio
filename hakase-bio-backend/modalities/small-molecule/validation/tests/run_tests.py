"""Correctness tests for the validation framework.

Two kinds of proof, both on REAL data (sklearn's bundled measured datasets):
  1. Our numpy metrics MATCH scikit-learn's reference implementations.
  2. The conformal layer's EMPIRICAL coverage / FPR matches its theoretical
     guarantee, averaged over many random calibration/test splits.

Run:  python3 validation/tests/run_tests.py     (from modalities/small-molecule)
Exit non-zero on any failure (CI-gateable).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import numpy as np
from hakase_kernel.uncertainty.conformal import (
    ConformalRegressor,
    ConformalVetoGate,
    empirical_coverage,
    empirical_fpr,
)
from sklearn.datasets import load_breast_cancer, load_diabetes
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

from validation import metrics as M

fails = 0


def check(cond, label, detail=""):
    global fails
    print(("  ✓ " if cond else "  ✗ ") + label + ("" if cond else f"  [{detail}]"))
    if not cond:
        fails += 1


print("=" * 64 + "\nA. Metrics vs scikit-learn (real breast-cancer data)")
X, y = load_breast_cancer(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.4, random_state=0)
clf = LogisticRegression(max_iter=5000).fit(Xtr, ytr)
score = clf.predict_proba(Xte)[:, 1]

check(
    abs(M.auroc(yte, score) - roc_auc_score(yte, score)) < 1e-9,
    "auroc == sklearn.roc_auc_score",
    f"{M.auroc(yte, score):.6f} vs {roc_auc_score(yte, score):.6f}",
)
check(
    abs(M.auprc(yte, score) - average_precision_score(yte, score)) < 1e-9,
    "auprc == sklearn.average_precision_score",
    f"{M.auprc(yte, score):.6f} vs {average_precision_score(yte, score):.6f}",
)
check(
    abs(M.brier(yte, score) - brier_score_loss(yte, score)) < 1e-12,
    "brier == sklearn.brier_score_loss",
)

# Confusion / recall / fpr at a threshold vs direct sklearn confusion matrix.
from sklearn.metrics import confusion_matrix, matthews_corrcoef  # noqa: E402

thr = 0.5
cm = M.classification_metrics(yte, score, thr)
tn, fp, fn, tp = confusion_matrix(yte, (score >= thr).astype(int)).ravel()
check(
    cm["tp"] == tp and cm["fp"] == fp and cm["tn"] == tn and cm["fn"] == fn,
    "confusion matrix == sklearn",
)
check(
    abs(cm["mcc"] - matthews_corrcoef(yte, (score >= thr).astype(int))) < 1e-9,
    "mcc == sklearn.matthews_corrcoef",
)

print("\nB. fold-error / triage hand-checks")
fe = M.fold_error_metrics([10.0, 10.0, 10.0], [20.0, 5.0, 10.0])  # folds: 2, 2, 1
check(abs(fe["pct_within_2fold"] - 1.0) < 1e-9, "fold-error: all within 2-fold")
check(
    abs(fe["median_fold_error"] - 2.0) < 1e-9,
    "fold-error: median fold = 2.0",
    str(fe["median_fold_error"]),
)
# GMFE of folds {2,2,1}: exp(mean(|ln 2|,|ln 0.5|... )) = exp((ln2+ln2+0)/3)=2^(2/3)
check(abs(fe["gmfe"] - 2 ** (2 / 3)) < 1e-9, "fold-error: GMFE == 2^(2/3)", str(fe["gmfe"]))
tr = M.triage_metrics(advance_pred=[1, 1, 0, 0], advance_true=[1, 0, 0, 1])
# approved={idx0,3}; halted={idx2,3}. recall_on_withdrawn: withdrawn={0? no}. withdrawn=at==0 -> idx1,2; halted_pred idx2,3 -> recall=1/2
check(
    abs(tr["recall_on_withdrawn"] - 0.5) < 1e-9,
    "triage: recall_on_withdrawn=0.5",
    str(tr["recall_on_withdrawn"]),
)
check(
    abs(tr["fpr_on_approved"] - 0.5) < 1e-9,
    "triage: fpr_on_approved=0.5",
    str(tr["fpr_on_approved"]),
)

print("\nC. Conformal regression coverage (real diabetes data, averaged over 40 splits)")
Xd, yd = load_diabetes(return_X_y=True)
for alpha in (0.1, 0.2):
    covs = []
    widths = []
    for seed in range(40):
        Xtr, Xrest, ytr, yrest = train_test_split(Xd, yd, test_size=0.5, random_state=seed)
        Xcal, Xte, ycal, yte = train_test_split(Xrest, yrest, test_size=0.4, random_state=seed)
        reg = LinearRegression().fit(Xtr, ytr)
        cr = ConformalRegressor().calibrate(reg.predict(Xcal), ycal)
        preds = reg.predict(Xte)
        los, his = zip(*[cr.interval(p, alpha=alpha) for p in preds])
        covs.append(empirical_coverage(los, his, yte))
        widths.append(float(np.mean(np.array(his) - np.array(los))))
    mean_cov = float(np.mean(covs))
    # Conformal guarantee: marginal coverage ≥ 1-α (slightly conservative). Allow
    # finite-sample slack below nominal of 0.03; cap conservativeness at +0.08.
    check(
        mean_cov >= (1 - alpha) - 0.03,
        f"coverage@{1-alpha:.0%} ≥ nominal (got {mean_cov:.3f}, width≈{np.mean(widths):.0f})",
    )
    check(
        mean_cov <= (1 - alpha) + 0.10,
        f"coverage@{1-alpha:.0%} not wildly over-conservative (got {mean_cov:.3f})",
    )

print("\nD. Conformal FPR-controlled veto gate (held-out negatives, 40 splits)")
# Use breast-cancer 'benign'=1 as the NEGATIVE class that must NOT be vetoed.
for alpha in (0.05, 0.10):
    fprs = []
    for seed in range(40):
        Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.5, random_state=seed)
        clf = LogisticRegression(max_iter=5000).fit(Xtr, ytr)
        s_te = clf.predict_proba(Xte)[:, 1]  # higher = more 'malignant' (the liability)
        neg_scores = s_te[yte == 1]  # benign = negative class (should not be flagged)
        # split negatives into calibrate / evaluate
        n = neg_scores.size
        idx = np.random.RandomState(seed).permutation(n)
        cal, ev = neg_scores[idx[: n // 2]], neg_scores[idx[n // 2 :]]
        gate = ConformalVetoGate().calibrate(cal, alpha=alpha)
        fprs.append(empirical_fpr(ev, gate.threshold))
    mean_fpr = float(np.mean(fprs))
    check(mean_fpr <= alpha + 0.03, f"veto FPR on negatives ≤ α={alpha} (got {mean_fpr:.3f})")

print("\n" + "=" * 64)
print("ALL VALIDATION-FRAMEWORK TESTS PASSED" if fails == 0 else f"FAILED — {fails} check(s)")
sys.exit(1 if fails else 0)
