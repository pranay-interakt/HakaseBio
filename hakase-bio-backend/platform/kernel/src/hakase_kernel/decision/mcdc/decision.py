"""The monotone Go / Watch / No-Go decision rule.

From the propagated credal beliefs we read two scalars off the adverse-outcome
nodes:

* ``liability m(x)``  = max over adverse outcomes of the *upper* credal bound
                        (a conservative worst-case liability);
* ``ignorance g(x)``  = max over adverse outcomes of the credal *width*
                        (reducible epistemic uncertainty).

A single scalar policy parameter ``lam`` in ``[0, 1]`` sets the operating point:

    tau(lam)   = tau_max   * (1 - lam)        # liability threshold to *advance*
    gamma(lam) = gamma_max * (1 - lam)        # ignorance tolerance to *advance*

    advance(x, lam)  <=>  m(x) <= tau(lam)  AND  g(x) <= gamma(lam)

Because both thresholds *shrink* as ``lam`` increases, the advanced (Go) set is
*nested and non-increasing* in ``lam``. This monotonicity is the precondition
that lets conformal risk control certify the advancement error rate
(:mod:`mcdc.crc`).

Compounds that are not advanced are split into No-Go (confidently liable:
``m(x) >= tau_nogo``) and Watch (abstain: too ignorant to act). This split does
not affect the guaranteed quantity -- both are "not advanced".
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import numpy as np

from .interval import Interval


class Decision(str, Enum):
    GO = "GO"
    WATCH = "WATCH"
    NO_GO = "NO_GO"


@dataclass(frozen=True)
class DecisionThresholds:
    tau_max: float  # maximum liability tolerated to advance (at lam = 0)
    gamma_max: float  # maximum ignorance tolerated to advance (at lam = 0)
    tau_nogo: float  # liability at/above which a non-advanced compound is No-Go

    def __post_init__(self) -> None:
        for name, v in (
            ("tau_max", self.tau_max),
            ("gamma_max", self.gamma_max),
            ("tau_nogo", self.tau_nogo),
        ):
            if not (0.0 <= v <= 1.0):
                raise ValueError(f"{name} must lie in [0, 1], got {v}")


def read_scalars(
    beliefs: dict[str, Interval], adverse_outcomes: list[str]
) -> tuple[float, float, float]:
    """Extract ``(liability_upper, liability_lower, ignorance)`` from adverse-outcome beliefs.

    * ``liability_upper`` = max over adverse outcomes of the credal *upper* bound
      -- the conservative worst-case used to gate advancement (Go).
    * ``liability_lower`` = max over adverse outcomes of the credal *lower* bound
      -- the *confident* liability used to justify a No-Go (we only reject a
      compound as toxic when the evidence is confidently high, not merely wide).
    * ``ignorance`` = max over adverse outcomes of the credal *width*.
    """
    uppers = [beliefs[a].hi for a in adverse_outcomes]
    lowers = [beliefs[a].lo for a in adverse_outcomes]
    widths = [beliefs[a].width for a in adverse_outcomes]
    return float(max(uppers)), float(max(lowers)), float(max(widths))


def is_advanced(m: float, g: float, lam: float, th: DecisionThresholds) -> bool:
    """Whether a compound with liability ``m`` and ignorance ``g`` is advanced at ``lam``."""
    if not (0.0 <= lam <= 1.0):
        raise ValueError(f"lam must lie in [0, 1], got {lam}")
    tau = th.tau_max * (1.0 - lam)
    gamma = th.gamma_max * (1.0 - lam)
    return (m <= tau) and (g <= gamma)


def advanced_mask(m: np.ndarray, g: np.ndarray, lam: float, th: DecisionThresholds) -> np.ndarray:
    """Vectorised advancement indicator over arrays of ``m`` and ``g``."""
    if not (0.0 <= lam <= 1.0):
        raise ValueError(f"lam must lie in [0, 1], got {lam}")
    tau = th.tau_max * (1.0 - lam)
    gamma = th.gamma_max * (1.0 - lam)
    m = np.asarray(m, dtype=float)
    g = np.asarray(g, dtype=float)
    return (m <= tau) & (g <= gamma)


def decide(
    m_upper: float, m_lower: float, g: float, lam: float, th: DecisionThresholds
) -> Decision:
    """Return the three-way decision for a single compound.

    * Go   -- advanced (worst-case liability and ignorance both within tolerance);
    * No-Go -- not advanced *and* confidently liable (lower credal bound high);
    * Watch -- not advanced and not confidently liable, i.e. too uncertain to act
              (the risk-controlled abstention region).
    """
    if is_advanced(m_upper, g, lam, th):
        return Decision.GO
    if m_lower >= th.tau_nogo:
        return Decision.NO_GO
    return Decision.WATCH
