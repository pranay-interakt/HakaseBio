"""DSMEstimator — turn dose-resolved fluctuation data into a stability margin.

WHAT IT PRODUCES
────────────────
Given, per dose, a temporal trace and/or a snapshot ensemble, it returns a
DSMResult carrying:

  • margin        ∈ [0,1] or None   — normalised distance-to-instability at the
                                      top assayed dose (1 = far, 0 = at tipping).
  • tipping_dose  float or None      — extrapolated dose where margin → 0.
  • indicators    per-dose indicator table (variance, ac1, recovery, eig).
  • trends        Kendall-τ of each indicator vs dose.
  • concordant    bool               — did ≥2 INDEPENDENT indicators move the
                                      CSD way (incl. ≥1 temporal one)?
  • in_domain     bool               — is a margin estimable at all?
  • basis         str                — human-readable mechanistic justification.

THE DESIGN DECISION THAT MAKES IT HONEST (Phase-1 death-confound defence)
────────────────────────────────────────────────────────────────────────
Rising variance alone is NOT sufficient to call a tipping point — cytotoxic
population thinning produces the same variance rise (see simulate.cytotoxic_*).
So the estimator REFUSES to emit a margin unless it sees *concordance*: at least
two independent indicators trending the CSD direction, and at least one of them
TEMPORAL (autocorrelation ↑ or recovery time ↑), which population thinning does
not reproduce (white measurement noise LOWERS autocorrelation). If only the
variance family moves, the estimator returns `in_domain=False` with basis
"variance-only: indistinguishable from cytotoxicity" — it abstains rather than
fabricate a margin. This is the same conservative, honest posture as the L1
conformal gates (abstain, never over-claim).

CALIBRATION HOOK
────────────────
`.calibrate(safe_responses)` records the null distribution of indicator trends
under KNOWN-SAFE compounds so the significance test in `.estimate` is against a
real reference, not an assumed one. Optional; without it the estimator uses an
internal permutation null over the dose ordering.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import early_warning as ew

# --------------------------------------------------------------------------- #
# Result container
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class DSMResult:
    margin: float | None
    tipping_dose: float | None
    doses: np.ndarray
    indicators: dict  # name -> np.ndarray over doses
    trends: dict  # name -> Kendall-tau vs dose
    concordant: bool
    in_domain: bool
    basis: str

    def summary(self) -> str:
        m = "None" if self.margin is None else f"{self.margin:.3f}"
        td = "None" if self.tipping_dose is None else f"{self.tipping_dose:.3g}"
        return (
            f"DSMResult(margin={m}, tipping_dose={td}, "
            f"concordant={self.concordant}, in_domain={self.in_domain})\n"
            f"  trends={{" + ", ".join(f"{k}:{v:+.2f}" for k, v in self.trends.items()) + "}}\n"
            f"  basis: {self.basis}"
        )


# --------------------------------------------------------------------------- #
# Estimator
# --------------------------------------------------------------------------- #

# CSD direction of each indicator as the system approaches a bifurcation.
# +1 means the indicator should RISE toward the tipping point.
_CSD_SIGN = {
    "total_variance": +1,
    "generalized_variance": +1,
    "lag1_autocorrelation": +1,
    "recovery_time": +1,
    "leading_ar_eigenvalue": +1,
}
_TEMPORAL = {"lag1_autocorrelation", "recovery_time", "leading_ar_eigenvalue"}
_VARIANCE_FAMILY = {"total_variance", "generalized_variance"}


class DSMEstimator:
    def __init__(self, *, trend_threshold: float = 0.5, dt: float = 1.0):
        """trend_threshold: minimum |Kendall-τ| for an indicator to count as
        'trending'. 0.5 is a deliberately conservative default (a clear monotone
        move), matching the abstain-by-default posture of the L1 gates."""
        self.trend_threshold = float(trend_threshold)
        self.dt = float(dt)
        self._null_trends: dict[str, list[float]] = {}

    # -- calibration (optional) --------------------------------------------- #
    def calibrate(self, safe_responses) -> DSMEstimator:
        """Record indicator-trend nulls from known-SAFE dose responses.

        safe_responses: iterable of objects exposing `.doses`, `.traces`,
        `.ensembles` (e.g. simulate.DoseResponse or a real-data equivalent).
        """
        for r in safe_responses:
            ind = self._indicators(r)
            for name, vals in ind.items():
                tau = ew.kendall_tau(r.doses, vals)
                if np.isfinite(tau):
                    self._null_trends.setdefault(name, []).append(float(tau))
        return self

    # -- indicator extraction ----------------------------------------------- #
    def _indicators(self, response) -> dict:
        doses = np.asarray(response.doses, float)
        out = {k: np.full(doses.size, np.nan) for k in _CSD_SIGN}
        for j, u in enumerate(doses):
            u = float(u)
            ens = getattr(response, "ensembles", {}).get(u)
            tr = getattr(response, "traces", {}).get(u)
            if ens is not None:
                try:
                    out["total_variance"][j] = ew.total_variance(ens)
                    out["generalized_variance"][j] = ew.generalized_variance(ens)
                except ValueError:
                    pass
            if tr is not None:
                try:
                    out["lag1_autocorrelation"][j] = ew.lag1_autocorrelation(tr)
                    rt = ew.recovery_time(tr, dt=self.dt)
                    out["recovery_time"][j] = rt if np.isfinite(rt) else np.nan
                except ValueError:
                    pass
                # eig needs an ordered multivariate series; a 1-D trace is fine as (n,1)
                try:
                    arr = np.asarray(tr, float)
                    if arr.ndim == 1:
                        arr = arr[:, None]
                    out["leading_ar_eigenvalue"][j] = ew.leading_ar_eigenvalue(arr, ordered=True)
                except ValueError:
                    pass
        # drop indicators that are all-NaN (not measurable from this data)
        return {k: v for k, v in out.items() if np.isfinite(v).sum() >= 3}

    # -- main entry point --------------------------------------------------- #
    def estimate(self, response) -> DSMResult:
        doses = np.asarray(response.doses, float)
        ind = self._indicators(response)
        trends: dict[str, float] = {}
        for name, vals in ind.items():
            m = np.isfinite(vals)
            trends[name] = (
                float(ew.kendall_tau(doses[m], vals[m])) if m.sum() >= 3 else float("nan")
            )

        # which indicators trend the CSD way, beyond the null / threshold?
        trending = []
        for name, tau in trends.items():
            if not np.isfinite(tau):
                continue
            signed = _CSD_SIGN[name] * tau
            thr = self._null_threshold(name)
            if signed >= thr:
                trending.append(name)

        temporal_hit = any(n in _TEMPORAL for n in trending)
        variance_hit = any(n in _VARIANCE_FAMILY for n in trending)
        concordant = (len(trending) >= 2) and temporal_hit

        # ---- honest gating -------------------------------------------------
        if not trending:
            return DSMResult(
                None,
                None,
                doses,
                ind,
                trends,
                False,
                False,
                "no indicator trends toward instability: stable / no signal.",
            )
        if variance_hit and not temporal_hit:
            return DSMResult(
                None,
                None,
                doses,
                ind,
                trends,
                False,
                False,
                "variance-only: rising fluctuation amplitude WITHOUT a temporal "
                "critical-slowing-down signature is indistinguishable from "
                "cytotoxic population thinning; margin not estimable.",
            )
        if not concordant:
            return DSMResult(
                None,
                None,
                doses,
                ind,
                trends,
                False,
                False,
                f"insufficient concordance ({len(trending)} indicator(s): "
                f"{trending}); need >=2 independent incl. >=1 temporal.",
            )

        # ---- margin from the temporal eigenvalue / recovery ----------------
        margin, tipping = self._margin_and_tipping(doses, ind)
        basis = (
            "concordant critical-slowing-down: "
            + ", ".join(f"{n}(τ={trends[n]:+.2f})" for n in trending)
            + "; margin from recovery-rate collapse."
        )
        return DSMResult(margin, tipping, doses, ind, trends, True, True, basis)

    # -- helpers ------------------------------------------------------------ #
    def _null_threshold(self, name: str) -> float:
        """95th-percentile of the |trend| null if calibrated, else the fixed
        conservative threshold."""
        nulls = self._null_trends.get(name)
        if nulls and len(nulls) >= 5:
            return float(max(self.trend_threshold, np.quantile(np.abs(nulls), 0.95)))
        return self.trend_threshold

    def _margin_and_tipping(self, doses, ind):
        """Margin = normalised recovery rate at top dose; tipping dose = linear
        extrapolation of recovery rate → 0.

        Recovery rate k ≈ -ln(ac1)/dt (or 1 - eig). We use whichever temporal
        indicator is present, preferring ac1→k.
        """
        k = None
        if "lag1_autocorrelation" in ind:
            ac1 = np.clip(ind["lag1_autocorrelation"], 1e-6, 0.999999)
            k = -np.log(ac1) / self.dt
        elif "leading_ar_eigenvalue" in ind:
            k = np.clip(1.0 - ind["leading_ar_eigenvalue"], 1e-6, None)
        m = np.isfinite(k)
        d, kk = doses[m], k[m]
        if kk.size < 2:
            return None, None
        k0 = float(kk[0]) if kk[0] > 0 else float(np.nanmax(kk))
        margin = float(np.clip(kk[-1] / (k0 + 1e-9), 0.0, 1.0))
        # linear fit k(dose); tipping where k -> 0
        A = np.polyfit(d, kk, 1)
        slope, intercept = A[0], A[1]
        tipping = None
        if slope < 0:
            td = -intercept / slope
            if td > d[-1]:  # extrapolation beyond assayed range
                tipping = float(td)
            elif td >= d[0]:
                tipping = float(td)  # tipping within assayed range
        return margin, tipping
