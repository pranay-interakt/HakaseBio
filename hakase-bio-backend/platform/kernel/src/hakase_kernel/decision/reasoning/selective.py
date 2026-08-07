"""Selective prediction — turning "when should Hakase abstain?" into a guarantee.

A cautious computational scientist declines to answer when the evidence is too thin.
This module makes that quantitative. Given a confidence signal and realised errors on a
held-out set, it produces:

  • the risk–coverage curve and its area (AURC) — how error falls as the system answers
    only its most confident cases (El-Yaniv & Wiener 2010; Geifman & El-Yaniv 2017);
  • Chow's optimal reject rule for a stated cost of abstaining (Chow 1970);
  • a *guaranteed* confidence threshold: the most coverage attainable while a
    distribution-free upper bound on the selective risk stays ≤ a target, with confidence
    1−δ (Geifman & El-Yaniv 2017, "Selective classification with guaranteed risk").

The guarantee is finite-sample and assumption-light (Hoeffding, with a Bonferroni union
over the candidate thresholds so that *selecting* the threshold on the same data does not
invalidate the bound). It requires exchangeability between the calibration and deployment
sets; if that breaks under covariate shift (see :mod:`reasoning.ood`) the guarantee
weakens and must be re-checked. If no threshold meets the target the honest result is
zero coverage — abstain on everything — never a relaxed target.

References
──────────
  • Chow C.K. (1970) On optimum recognition error and reject tradeoff. IEEE T-IT 16:41.
  • El-Yaniv R., Wiener Y. (2010) On the foundations of noise-free selective
    classification. JMLR 11:1605.
  • Geifman Y., El-Yaniv R. (2017) Selective classification for deep neural networks.
    NeurIPS.  (SGR — risk with a guarantee)
  • Angelopoulos A., Bates S. (2021) A gentle introduction to conformal prediction.
    (finite-sample distribution-free risk control)
  • Hoeffding W. (1963) Probability inequalities for sums of bounded random variables.
    JASA 58:13.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

__all__ = [
    "RiskCoverage",
    "risk_coverage_curve",
    "area_under_risk_coverage",
    "hoeffding_upper_bound",
    "GuaranteedThreshold",
    "guaranteed_risk_threshold",
    "chow_threshold",
]


def _as_err_conf(errors, confidences) -> tuple[np.ndarray, np.ndarray]:
    e = np.asarray(errors, dtype=float).ravel()
    c = np.asarray(confidences, dtype=float).ravel()
    if e.size == 0:
        raise ValueError("empty input")
    if e.size != c.size:
        raise ValueError(f"errors and confidences length mismatch: {e.size} vs {c.size}")
    if not (np.all(np.isfinite(e)) and np.all(np.isfinite(c))):
        raise ValueError("non-finite values")
    if e.min() < -1e-9 or e.max() > 1 + 1e-9:
        raise ValueError("errors must be a bounded loss in [0, 1] (e.g. 0/1 mistakes)")
    return np.clip(e, 0.0, 1.0), c


@dataclass(frozen=True)
class RiskCoverage:
    coverage: np.ndarray  # fraction of points answered (ascending in acceptance)
    risk: np.ndarray  # selective risk (mean error over the accepted set)
    threshold: np.ndarray  # confidence threshold defining each accepted set


def risk_coverage_curve(errors, confidences) -> RiskCoverage:
    """Selective risk as a function of coverage, accepting most-confident points first.

    Point k of the curve corresponds to answering the ``k`` highest-confidence cases and
    abstaining on the rest; its risk is the mean error over those ``k``. A useful
    confidence signal makes risk rise monotonically as coverage grows.
    """
    e, c = _as_err_conf(errors, confidences)
    order = np.argsort(-c, kind="mergesort")  # most confident first
    e_sorted = e[order]
    c_sorted = c[order]
    n = e.size
    cum_err = np.cumsum(e_sorted)
    k = np.arange(1, n + 1)
    coverage = k / n
    risk = cum_err / k
    return RiskCoverage(coverage=coverage, risk=risk, threshold=c_sorted)


def area_under_risk_coverage(errors, confidences) -> float:
    """AURC — mean selective risk integrated over coverage (Geifman 2017). Lower is better.

    A confidence signal that ranks errors well pushes mistakes to low coverage and
    shrinks the AURC; a useless (random) signal gives AURC ≈ the base error rate.
    """
    rc = risk_coverage_curve(errors, confidences)
    return (
        float(np.trapezoid(rc.risk, rc.coverage) / (rc.coverage[-1] - rc.coverage[0] + 1e-12))
        if rc.coverage.size > 1
        else float(rc.risk[-1])
    )


def hoeffding_upper_bound(p_hat: float, n: int, delta: float) -> float:
    """Distribution-free (1−δ) upper confidence bound on a bounded-[0,1] mean (Hoeffding 1963).

    ``p_hat + sqrt(ln(1/δ) / (2n))``, clipped to [0,1]. Conservative but exact and
    assumption-free — the honest choice for a safety bound.
    """
    if n <= 0:
        return 1.0
    if not (0.0 < delta < 1.0):
        raise ValueError("delta must lie in (0, 1)")
    return float(min(1.0, p_hat + np.sqrt(np.log(1.0 / delta) / (2.0 * n))))


@dataclass(frozen=True)
class GuaranteedThreshold:
    threshold: float  # accept predictions with confidence >= threshold
    coverage: float  # fraction of calibration points accepted
    empirical_risk: float  # selective risk on the accepted calibration points
    guaranteed_risk: float  # (1-δ) distribution-free upper bound on true selective risk
    target_risk: float
    delta: float
    feasible: bool  # did any threshold meet the guarantee?

    def summary(self) -> str:
        if not self.feasible:
            return (
                f"No confidence threshold guarantees selective risk ≤ {self.target_risk:g} "
                f"at 1−δ={1-self.delta:g}: abstain on all (coverage 0)."
            )
        return (
            f"Answer the {self.coverage:.0%} most-confident cases (confidence ≥ "
            f"{self.threshold:.4g}); selective risk ≤ {self.guaranteed_risk:.3f} "
            f"guaranteed at 1−δ={1-self.delta:g} (empirical {self.empirical_risk:.3f})."
        )


def guaranteed_risk_threshold(
    errors,
    confidences,
    target_risk: float,
    delta: float = 0.05,
    max_candidates: int = 200,
) -> GuaranteedThreshold:
    """Most coverage with a distribution-free guarantee that selective risk ≤ target.

    Scans a bounded grid of ``M ≤ max_candidates`` candidate confidence thresholds and, for
    each, computes the Hoeffding (1−δ/M) upper bound on the accepted-set risk. The δ/M
    Bonferroni union makes *selecting* the threshold on this same sample valid (Geifman &
    El-Yaniv 2017's SGR unions over the candidate set, not over every distinct score — a
    per-point union is needlessly loose and would make the guarantee unusable). Returns the
    largest-coverage threshold whose bound is ≤ ``target_risk``; if none qualifies, returns
    an infeasible result with zero coverage (abstain on everything) — never a weakened target.
    """
    e, c = _as_err_conf(errors, confidences)
    if not (0.0 < target_risk < 1.0):
        raise ValueError("target_risk must lie in (0, 1)")
    if not (0.0 < delta < 1.0):
        raise ValueError("delta must lie in (0, 1)")
    if max_candidates < 1:
        raise ValueError("max_candidates must be >= 1")

    # Candidate thresholds: distinct confidence values, subsampled to a bounded grid so the
    # Bonferroni correction stays tight. Each candidate t defines the accepted set {c >= t}.
    distinct = np.unique(c)  # ascending
    if distinct.size > max_candidates:
        pick = np.linspace(0, distinct.size - 1, max_candidates).round().astype(int)
        candidates = distinct[np.unique(pick)]
    else:
        candidates = distinct
    M = candidates.size
    delta_bonf = delta / max(M, 1)
    n = e.size

    best: GuaranteedThreshold | None = None
    for t in candidates:  # each t is a real deployment rule: accept c>=t
        mask = c >= t
        m = int(mask.sum())
        if m == 0:
            continue
        phat = float(e[mask].mean())
        bound = hoeffding_upper_bound(phat, m, delta_bonf)
        if bound <= target_risk:
            cand = GuaranteedThreshold(
                threshold=float(t),
                coverage=m / n,
                empirical_risk=phat,
                guaranteed_risk=float(bound),
                target_risk=float(target_risk),
                delta=float(delta),
                feasible=True,
            )
            if best is None or cand.coverage > best.coverage:
                best = cand
    if best is None:
        return GuaranteedThreshold(
            threshold=float("inf"),
            coverage=0.0,
            empirical_risk=float("nan"),
            guaranteed_risk=float("nan"),
            target_risk=float(target_risk),
            delta=float(delta),
            feasible=False,
        )
    return best


def chow_threshold(errors, confidences, reject_cost: float) -> dict:
    """Chow's optimal reject rule (Chow 1970) for a stated cost of abstaining.

    Chooses the confidence threshold minimising total expected cost =
    (errors on accepted) + reject_cost × (number rejected), normalised per point.
    ``reject_cost`` is the cost of one abstention relative to one wrong answer (in [0,1]);
    reject_cost ≥ 1 means never worth abstaining (answer everything). Returns the
    threshold and the achieved coverage/risk.
    """
    e, c = _as_err_conf(errors, confidences)
    if reject_cost < 0:
        raise ValueError("reject_cost must be >= 0")
    order = np.argsort(-c, kind="mergesort")
    e_sorted, c_sorted = e[order], c[order]
    n = e.size
    cum_err = np.cumsum(e_sorted)
    k = np.arange(1, n + 1)
    # accept top-k: cost = accepted_errors + reject_cost*(n-k), per point
    total_cost = (cum_err + reject_cost * (n - k)) / n
    # also consider accepting nothing (k=0): cost = reject_cost
    best_k = int(np.argmin(total_cost)) + 1
    cost_answer = float(total_cost[best_k - 1])
    if reject_cost <= cost_answer:  # abstaining on all is at least as cheap
        return {
            "threshold": float("inf"),
            "coverage": 0.0,
            "selective_risk": float("nan"),
            "expected_cost": float(reject_cost),
            "answer_all": False,
        }
    return {
        "threshold": float(c_sorted[best_k - 1]),
        "coverage": best_k / n,
        "selective_risk": float(cum_err[best_k - 1] / best_k),
        "expected_cost": cost_answer,
        "answer_all": best_k == n,
    }
