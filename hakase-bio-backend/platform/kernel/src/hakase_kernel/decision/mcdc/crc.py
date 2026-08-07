"""Decision-level conformal risk control -- the core theoretical contribution.

The field certifies *predictions* (calibrated probabilities, conformal coverage).
This module certifies the *decision*. Given a calibration corpus of compounds
with known ground-truth outcomes, it selects the single policy parameter ``lam``
so that the expected cost of the safety-critical decision error -- advancing a
truly unsafe compound -- is provably bounded, with a finite-sample,
distribution-free guarantee that holds *under arbitrary statistical dependence
among the endpoint models*.

Guarantee
---------
Let ``L_i(lam) = L(advanced_i(lam), y_i)`` be a per-compound loss bounded in
``[0, B]`` that is **non-increasing in ``lam``** (advancing fewer compounds
cannot increase the false-advancement loss). Let

    R_hat(lam) = (1 / n) * sum_i L_i(lam)

be the empirical risk on ``n`` calibration compounds, and choose

    lam_hat = inf { lam : R_hat(lam) <= alpha - (B - alpha) / n }.

Then, for a fresh compound exchangeable with the calibration corpus,

    E[ L(advanced(lam_hat), Y) ] <= alpha.                       (Angelopoulos et
                                                                  al., Conformal
                                                                  Risk Control)

Why this is valid where per-endpoint composition is not
-------------------------------------------------------
The bound is a statement about the *distribution of the realised decision loss*,
whose exchangeable unit is the whole compound. Dependence *among the endpoints of
one compound* is fully inside that unit and therefore cannot violate
exchangeability *across compounds*. A union bound over per-endpoint conformal
sets, by contrast, needs the endpoints to behave independently to reach the
nominal decision-level rate, and silently loses validity under the positive
dependence that ADMET endpoints exhibit. Moving the calibration target from the
prediction to the decision is the methodological pivot.

Scope of the guarantee (stated honestly)
-----------------------------------------
* It is **marginal** (an average over compounds), not conditional on a specific
  compound. Group-conditional (Mondrian) calibration -- fitting ``lam_hat`` per
  scaffold stratum -- narrows this but does not make it per-compound.
* It requires **exchangeability** between calibration and deployment compounds.
  Prospective discovery is a covariate shift; the guarantee degrades under shift
  and must be monitored. This module implements the *proven* exchangeable case
  and exposes diagnostics for shift rather than overclaiming a weighted variant.
* It is only as meaningful as the **outcome labels** in the calibration corpus,
  which are scarce and can be survivorship-biased. That dependency is explicit,
  not hidden inside a model.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

# A loss maps (advanced?, y_true) -> non-negative cost. Must be non-increasing in
# the advancement indicator collapsing to 0 (i.e. not advancing costs no more).
LossFn = Callable[[np.ndarray, np.ndarray], np.ndarray]


def false_advancement_loss(advanced: np.ndarray, y_true: np.ndarray) -> np.ndarray:
    """0/1 loss for advancing a truly unsafe compound (``y_true == 1``).

    Bound ``B = 1``. This is the canonical safety-critical loss: the certified
    quantity is the expected rate of advancing unsafe compounds.
    """
    advanced = np.asarray(advanced, dtype=bool)
    y_true = np.asarray(y_true, dtype=int)
    return (advanced & (y_true == 1)).astype(float)


@dataclass(frozen=True)
class CRCResult:
    lam_hat: float
    alpha: float
    n: int
    bound_B: float
    empirical_risk_at_lam_hat: float
    feasible: bool  # whether any lam < 1 met the corrected threshold
    lam_grid: np.ndarray
    risk_curve: np.ndarray  # R_hat(lam) over lam_grid

    def summary(self) -> str:
        return (
            f"CRC(alpha={self.alpha:g}, n={self.n}): lam_hat={self.lam_hat:.4f}, "
            f"R_hat(lam_hat)={self.empirical_risk_at_lam_hat:.4f}, "
            f"feasible={self.feasible}"
        )


def calibrate_risk_control(
    m: np.ndarray,
    g: np.ndarray,
    y_true: np.ndarray,
    thresholds,
    alpha: float,
    *,
    loss_fn: LossFn = false_advancement_loss,
    bound_B: float = 1.0,
    grid_size: int = 1001,
) -> CRCResult:
    """Select ``lam_hat`` giving the finite-sample guarantee ``E[L] <= alpha``.

    Parameters
    ----------
    m, g:
        Per-compound liability and ignorance scalars on the calibration corpus
        (from :func:`mcdc.decision.read_scalars`).
    y_true:
        Ground-truth safety label per compound (1 = unsafe, 0 = safe).
    thresholds:
        :class:`mcdc.decision.DecisionThresholds`.
    alpha:
        Target bound on the expected decision loss, in ``(0, bound_B]``.
    loss_fn:
        Bounded, monotone (non-increasing in ``lam``) loss. Defaults to the
        false-advancement 0/1 loss.
    bound_B:
        Upper bound of the loss. Must match ``loss_fn``.
    grid_size:
        Resolution of the ``lam`` search grid. The selected ``lam_hat`` is the
        smallest grid point meeting the corrected threshold; grid discretisation
        can only make the choice *more* conservative, preserving validity.
    """
    from .decision import advanced_mask  # local import avoids a cycle

    m = np.asarray(m, dtype=float)
    g = np.asarray(g, dtype=float)
    y_true = np.asarray(y_true, dtype=int)
    n = m.shape[0]
    if not (m.shape == g.shape == y_true.shape):
        raise ValueError("m, g, y_true must have identical shape")
    if n == 0:
        raise ValueError("calibration corpus is empty")
    if not (0.0 < alpha <= bound_B):
        raise ValueError(f"alpha must lie in (0, B={bound_B}], got {alpha}")
    if bound_B <= 0.0:
        raise ValueError(f"bound_B must be positive, got {bound_B}")

    lam_grid = np.linspace(0.0, 1.0, grid_size)
    risk_curve = np.empty(grid_size, dtype=float)
    for i, lam in enumerate(lam_grid):
        adv = advanced_mask(m, g, float(lam), thresholds)
        risk_curve[i] = float(np.mean(loss_fn(adv, y_true)))

    # Conformal risk control correction. The threshold can be negative for small
    # n / small alpha, in which case no lam < 1 qualifies and we fall back to the
    # maximally conservative lam_hat = 1 (advance nothing), which trivially
    # satisfies E[L] = 0 <= alpha. This is an honest, safe boundary, not a
    # silent numerical fudge.
    corrected = alpha - (bound_B - alpha) / n
    qualifying = np.where(risk_curve <= corrected)[0]
    if qualifying.size > 0:
        idx = int(qualifying[0])  # smallest lam meeting the bound (the inf)
        lam_hat = float(lam_grid[idx])
        feasible = lam_hat < 1.0
    else:
        idx = grid_size - 1
        lam_hat = 1.0
        feasible = False

    return CRCResult(
        lam_hat=lam_hat,
        alpha=alpha,
        n=n,
        bound_B=bound_B,
        empirical_risk_at_lam_hat=float(risk_curve[idx]),
        feasible=feasible,
        lam_grid=lam_grid,
        risk_curve=risk_curve,
    )


@dataclass(frozen=True)
class GroupedCRCResult:
    """Group-conditional (Mondrian) risk-control result.

    Holds one :class:`CRCResult` per group. Because each group is calibrated on
    its own exchangeable subset, the guarantee is *per group*:

        E[ L(advance(lam_hat[grp]), Y) | group = grp ] <= alpha   for every grp.

    This is strictly stronger than the marginal guarantee -- a novel-scaffold or
    out-of-domain subpopulation cannot hide behind a benign average, which is the
    single most common objection to marginal conformal coverage.
    """

    per_group: dict
    alpha: float
    group_labels: tuple

    def lam_for(self, group) -> float:
        if group not in self.per_group:
            raise KeyError(f"no calibrated threshold for group {group!r}")
        return self.per_group[group].lam_hat

    def summary(self) -> str:
        parts = [
            f"{g}: lam_hat={r.lam_hat:.3f} (n={r.n}, R={r.empirical_risk_at_lam_hat:.3f}, "
            f"feasible={r.feasible})"
            for g, r in self.per_group.items()
        ]
        return f"Grouped CRC(alpha={self.alpha:g}) | " + " | ".join(parts)


def calibrate_risk_control_grouped(
    m: np.ndarray,
    g: np.ndarray,
    y_true: np.ndarray,
    groups: np.ndarray,
    thresholds,
    alpha: float,
    **kwargs,
) -> GroupedCRCResult:
    """Fit a separate ``lam_hat`` per group for a per-group finite-sample guarantee.

    Parameters
    ----------
    groups:
        Integer or string label per calibration compound assigning it to a
        stratum (e.g. an applicability-domain band, or a scaffold cluster). The
        same labelling must be computable for query compounds at decision time.

    Notes
    -----
    A group with too few labelled points for the conformal correction to be
    feasible receives the maximally conservative ``lam_hat = 1`` (advance nothing
    in that group), which trivially satisfies the per-group bound. This is an
    honest, safe boundary rather than a silent relaxation.
    """
    m = np.asarray(m, dtype=float)
    g = np.asarray(g, dtype=float)
    y_true = np.asarray(y_true, dtype=int)
    groups = np.asarray(groups)
    if not (m.shape == g.shape == y_true.shape == groups.shape):
        raise ValueError("m, g, y_true, groups must share shape")

    labels = tuple(sorted(set(groups.tolist())))
    per_group: dict = {}
    for grp in labels:
        sel = groups == grp
        per_group[grp] = calibrate_risk_control(
            m[sel], g[sel], y_true[sel], thresholds, alpha, **kwargs
        )
    return GroupedCRCResult(per_group=per_group, alpha=alpha, group_labels=labels)


def advanced_mask_grouped(
    m: np.ndarray, g: np.ndarray, groups: np.ndarray, grouped: GroupedCRCResult, thresholds
) -> np.ndarray:
    """Vectorised advancement decision using each compound's group-specific lam_hat.

    A compound whose group was never seen in calibration is conservatively not
    advanced (lam = 1), rather than silently falling back to a global threshold.
    """
    from .decision import advanced_mask

    m = np.asarray(m, dtype=float)
    g = np.asarray(g, dtype=float)
    groups = np.asarray(groups)
    out = np.zeros(m.shape[0], dtype=bool)
    for grp in np.unique(groups):
        sel = groups == grp
        lam = grouped.per_group[grp].lam_hat if grp in grouped.per_group else 1.0
        out[sel] = advanced_mask(m[sel], g[sel], lam, thresholds)
    return out
