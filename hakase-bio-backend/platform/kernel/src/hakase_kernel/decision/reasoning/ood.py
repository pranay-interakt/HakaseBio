"""Distribution-shift / OOD detection — the guard on every other guarantee.

WHY THIS MATTERS MORE THAN IT LOOKS
───────────────────────────────────
Conformal coverage, calibration, and the selective-risk bound all rest on ONE
assumption: the deployment points are exchangeable with the calibration points. Drug
discovery violates it constantly — prospective chemistry drifts away from the training
distribution. When that happens the guarantees do not fail loudly; they silently stop
holding. This module supplies the missing alarm: cheap, assumption-light tests that say
"the query looks unlike the calibration set — treat the certified numbers with caution."

It is deliberately conservative and descriptive: it never *repairs* shift (that needs
weighted conformal or reweighting with a known likelihood ratio), it only *flags* it, so a
downstream record can widen intervals or abstain. Chemical applicability domain
(Tanimoto-to-training) already lives in the service; this complements it with
distribution-level tests on any feature/score, including model outputs.

References
──────────
  • Vovk V., Gammerman A., Shafer G. (2005) Algorithmic Learning in a Random World.
    (conformal p-values; exchangeability martingales)
  • Tibshirani R. et al. (2019) Conformal prediction under covariate shift. NeurIPS.
  • Gama J. et al. (2014) A survey on concept drift adaptation. ACM Comput. Surv.
  • Rabanser S., Günnemann S., Lipton Z. (2019) Failing loudly: detecting dataset
    shift. NeurIPS.  (two-sample shift detection)
  • Wang H., et al. — Population Stability Index is standard model-monitoring practice.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

__all__ = [
    "population_stability_index",
    "ks_two_sample",
    "conformal_pvalues",
    "ShiftReport",
    "detect_shift",
]


def _as1d(x, name="x") -> np.ndarray:
    a = np.asarray(x, dtype=float).ravel()
    if a.size == 0:
        raise ValueError(f"{name}: empty")
    if not np.all(np.isfinite(a)):
        raise ValueError(f"{name}: non-finite values")
    return a


def population_stability_index(reference, query, n_bins: int = 10) -> float:
    """PSI between a reference and a query sample of a scalar (standard drift metric).

    Bins the reference into ``n_bins`` quantile bins, then sums
    ``(q − r) · ln(q / r)`` over bins (q, r = query/reference bin fractions). Rules of
    thumb: <0.1 no material shift, 0.1–0.25 moderate, >0.25 major shift.
    """
    r = _as1d(reference, "reference")
    q = _as1d(query, "query")
    edges = np.unique(np.quantile(r, np.linspace(0, 1, n_bins + 1)))
    if edges.size < 3:
        raise ValueError("reference is too degenerate to form PSI bins")
    edges[0], edges[-1] = -np.inf, np.inf
    r_frac = np.histogram(r, edges)[0].astype(float)
    q_frac = np.histogram(q, edges)[0].astype(float)
    r_frac = np.clip(r_frac / r_frac.sum(), 1e-6, None)
    q_frac = np.clip(q_frac / q_frac.sum(), 1e-6, None)
    return float(np.sum((q_frac - r_frac) * np.log(q_frac / r_frac)))


def ks_two_sample(reference, query) -> tuple[float, float]:
    """Two-sample Kolmogorov–Smirnov statistic and asymptotic p-value (pure numpy).

    D = sup_x |F_ref(x) − F_query(x)|; p from the Kolmogorov distribution. Small p ⇒ the
    two samples are unlikely to share a distribution (evidence of shift).
    """
    r = np.sort(_as1d(reference, "reference"))
    q = np.sort(_as1d(query, "query"))
    allv = np.concatenate([r, q])
    cdf_r = np.searchsorted(r, allv, side="right") / r.size
    cdf_q = np.searchsorted(q, allv, side="right") / q.size
    d = float(np.max(np.abs(cdf_r - cdf_q)))
    n_e = r.size * q.size / (r.size + q.size)
    lam = (np.sqrt(n_e) + 0.12 + 0.11 / np.sqrt(n_e)) * d
    # Kolmogorov distribution survival: 2 Σ (-1)^{k-1} exp(-2 k² λ²)
    k = np.arange(1, 101)
    p = 2.0 * np.sum(((-1) ** (k - 1)) * np.exp(-2.0 * (k**2) * (lam**2)))
    return d, float(min(1.0, max(0.0, p)))


def conformal_pvalues(reference_scores, query_scores) -> np.ndarray:
    """Conformal p-value per query point: (1 + #{ref ≥ s}) / (n_ref + 1) (Vovk 2005).

    ``reference_scores`` are nonconformity scores (e.g. distance-to-training, or −density)
    on calibration points; a small p means the query point is more atypical than almost
    all calibration points. Under exchangeability these p-values are ~Uniform(0,1); a
    systematic excess of tiny p-values is direct evidence of shift.
    """
    r = _as1d(reference_scores, "reference_scores")
    q = _as1d(query_scores, "query_scores")
    n = r.size
    rs = np.sort(r)
    ge = n - np.searchsorted(rs, q, side="left")  # #{ref >= s}
    return (1.0 + ge) / (n + 1.0)


@dataclass(frozen=True)
class ShiftReport:
    shifted: bool
    psi: float | None
    ks_stat: float | None
    ks_pvalue: float | None
    frac_atypical: float | None  # fraction of query with conformal p < atypical_alpha
    atypical_alpha: float
    basis: str

    def as_dict(self) -> dict:
        return {
            "shifted": self.shifted,
            "psi": None if self.psi is None else round(self.psi, 4),
            "ks_stat": None if self.ks_stat is None else round(self.ks_stat, 4),
            "ks_pvalue": None if self.ks_pvalue is None else round(self.ks_pvalue, 4),
            "frac_atypical": None if self.frac_atypical is None else round(self.frac_atypical, 4),
            "basis": self.basis,
        }


def detect_shift(
    reference,
    query,
    *,
    psi_major: float = 0.25,
    ks_alpha: float = 0.05,
    ks_effect_min: float = 0.1,
    atypical_alpha: float = 0.05,
    atypical_frac_max: float = 0.15,
) -> ShiftReport:
    """Combine PSI, KS, and conformal-p-value tests into one honest shift verdict.

    Flags ``shifted=True`` if PSI exceeds ``psi_major`` OR the KS test is BOTH significant
    (p < ``ks_alpha``) AND a non-trivial effect (D ≥ ``ks_effect_min``) OR the fraction of
    atypical query points (conformal p < ``atypical_alpha``) materially exceeds its null
    expectation (allowing up to ``atypical_frac_max``). Requiring an effect size on the KS
    test avoids the significance-without-magnitude trap: at large n the KS p-value rejects
    on differences too small to matter operationally (statistical ≠ practical significance).
    Any single test may be unavailable (too few points); the verdict uses whatever is
    computable and says which.
    """
    psi = ks = ksp = frac = None
    hits: list[str] = []  # indicators that fired (evidence of shift)
    notes: list[str] = []  # indicators that could not be computed
    computed = 0
    try:
        psi = population_stability_index(reference, query)
        computed += 1
        if psi > psi_major:
            hits.append(f"PSI={psi:.2f}>{psi_major} (major)")
    except Exception as e:
        notes.append(f"PSI n/a ({type(e).__name__})")
    try:
        ks, ksp = ks_two_sample(reference, query)
        computed += 1
        if ksp < ks_alpha and ks >= ks_effect_min:
            hits.append(f"KS D={ks:.2f}≥{ks_effect_min}, p={ksp:.3f}<{ks_alpha}")
    except Exception as e:
        notes.append(f"KS n/a ({type(e).__name__})")
    try:
        pv = conformal_pvalues(reference, query)
        computed += 1
        frac = float(np.mean(pv < atypical_alpha))
        if frac > max(atypical_frac_max, 2 * atypical_alpha):
            hits.append(f"{frac:.0%} of query atypical (p<{atypical_alpha})")
    except Exception as e:
        notes.append(f"conformal-p n/a ({type(e).__name__})")

    shifted = bool(
        (psi is not None and psi > psi_major)
        or (ksp is not None and ks is not None and ksp < ks_alpha and ks >= ks_effect_min)
        or (frac is not None and frac > max(atypical_frac_max, 2 * atypical_alpha))
    )
    if hits:
        basis = "shift indicators: " + "; ".join(hits + notes)
    elif computed:
        basis = (
            "no distribution shift detected (query looks exchangeable with the "
            "reference) — " + ", ".join(notes)
            if notes
            else "no distribution shift detected (query looks exchangeable with the reference)"
        )
    else:
        basis = "no shift indicators computable: " + "; ".join(notes)
    if shifted:
        basis = (
            "DISTRIBUTION SHIFT flagged — exchangeability with the calibration set is "
            "doubtful, so conformal/calibration/selective guarantees may not hold. " + basis
        )
    return ShiftReport(shifted, psi, ks, ksp, frac, atypical_alpha, basis)
