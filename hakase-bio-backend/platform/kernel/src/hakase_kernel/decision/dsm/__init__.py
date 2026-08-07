"""dsm-engine — Dynamical Stability Margin estimator (V0 kernel).

A self-contained, pure-numpy sibling package to `mcdc-engine`. It implements the
rescued, product-useful form of DSM from the falsification review: an
uncertainty-carrying dynamical covariate, NOT a replacement toxicity label.

Public surface
──────────────
    from dsm import (
        DSMEstimator, DSMResult,
        early_warning as ew,
        simulate as sim,
    )

Nothing here touches the live ai-service. Integration into safety_triage /
mcdc-engine is gated on the V0 experiments passing (see experiments/run_v0.py).
"""

from __future__ import annotations

from . import early_warning, simulate
from .early_warning import (
    Estimate,
    bootstrap_indicator,
    generalized_variance,
    kendall_tau,
    lag1_autocorrelation,
    leading_ar_eigenvalue,
    mann_whitney_u_greater,
    recovery_time,
    total_variance,
)
from .estimator import DSMEstimator, DSMResult

__all__ = [
    "early_warning",
    "simulate",
    "total_variance",
    "generalized_variance",
    "lag1_autocorrelation",
    "recovery_time",
    "leading_ar_eigenvalue",
    "bootstrap_indicator",
    "kendall_tau",
    "mann_whitney_u_greater",
    "Estimate",
    "DSMEstimator",
    "DSMResult",
]
__version__ = "0.1.0"
