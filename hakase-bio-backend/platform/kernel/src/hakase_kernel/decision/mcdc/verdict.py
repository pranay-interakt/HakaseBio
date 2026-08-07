"""Neyman-Pearson Conformal Verdict (NPCV).

A corrected verdict rule. The original MC-DC engine thresholds a hand-crafted
credal liability m(x); on real data that score is *dominated* -- it leaves much of
the false-advancement budget unused and therefore advances fewer safe compounds
than it safely could.

By the Neyman-Pearson lemma, the rule that maximises the number of advanced safe
compounds subject to a cap on advanced unsafe compounds must threshold the
likelihood ratio, equivalently the calibrated posterior P(unsafe | evidence). NPCV
therefore thresholds that posterior and uses conformal risk control to choose the
threshold with a finite-sample, distribution-free bound on the false-advancement
rate. Validity comes from CRC; efficiency comes from using the (optimal) score and
the full risk budget.

Honest scope. On the Tox21 scaffold-split benchmark the posterior score is only
marginally better than a trivial "advance if every endpoint is low" rule; the bulk
of NPCV's practical gain over the original credal rule is from removing
over-conservatism, not from the score being dramatically better. NPCV is a
principled correction, not a breakthrough. An optional ignorance gate reintroduces
the credal abstention, which trades yield for extra robustness under strong shift.
"""

from __future__ import annotations

import numpy as np

from .crc import CRCResult, calibrate_risk_control
from .decision import Decision, DecisionThresholds, advanced_mask


class NeymanPearsonVerdict:
    """Posterior-thresholding verdict rule with a conformal false-advancement bound.

    Parameters
    ----------
    alpha:
        Target bound on the expected false-advancement rate.
    abstain_gamma:
        If given (in (0, 1]), compounds whose epistemic ignorance exceeds this are
        routed to Watch rather than advanced -- the credal abstention gate. If
        ``None``, NPCV never abstains on ignorance (pure efficiency).
    nogo_posterior:
        Posterior at/above which a non-advanced compound is labelled No-Go rather
        than Watch.
    """

    def __init__(
        self, alpha: float, abstain_gamma: float | None = None, nogo_posterior: float = 0.5
    ) -> None:
        if not (0.0 < alpha < 1.0):
            raise ValueError(f"alpha must lie in (0, 1), got {alpha}")
        if abstain_gamma is not None and not (0.0 < abstain_gamma <= 1.0):
            raise ValueError("abstain_gamma must lie in (0, 1] or be None")
        self.alpha = alpha
        self.abstain_gamma = abstain_gamma
        self.nogo_posterior = nogo_posterior
        gamma_max = abstain_gamma if abstain_gamma is not None else 1.0
        self._th = DecisionThresholds(tau_max=1.0, gamma_max=gamma_max, tau_nogo=nogo_posterior)
        self._crc: CRCResult | None = None

    def calibrate(
        self, posterior_cal: np.ndarray, y_cal: np.ndarray, ignorance_cal: np.ndarray | None = None
    ) -> CRCResult:
        """Fit the conformal threshold on calibration compounds with known outcomes."""
        posterior_cal = np.asarray(posterior_cal, dtype=float)
        g = (
            np.zeros_like(posterior_cal)
            if ignorance_cal is None
            else np.asarray(ignorance_cal, float)
        )
        self._crc = calibrate_risk_control(posterior_cal, g, y_cal, self._th, alpha=self.alpha)
        return self._crc

    @property
    def lam_hat(self) -> float:
        if self._crc is None:
            raise RuntimeError("NPCV is not calibrated; call calibrate() first")
        return self._crc.lam_hat

    def advance_mask(
        self, posterior: np.ndarray, ignorance: np.ndarray | None = None
    ) -> np.ndarray:
        """Boolean advance (Go) decision for query compounds."""
        posterior = np.asarray(posterior, dtype=float)
        g = np.zeros_like(posterior) if ignorance is None else np.asarray(ignorance, float)
        return advanced_mask(posterior, g, self.lam_hat, self._th)

    def decide(self, posterior: np.ndarray, ignorance: np.ndarray | None = None) -> list[Decision]:
        """Three-way Go / Watch / No-Go decision per compound."""
        posterior = np.asarray(posterior, dtype=float)
        g = np.zeros_like(posterior) if ignorance is None else np.asarray(ignorance, float)
        adv = self.advance_mask(posterior, ignorance)
        out: list[Decision] = []
        for i in range(posterior.shape[0]):
            if adv[i]:
                out.append(Decision.GO)
            elif posterior[i] >= self.nogo_posterior:
                out.append(Decision.NO_GO)
            else:
                out.append(Decision.WATCH)
        return out
