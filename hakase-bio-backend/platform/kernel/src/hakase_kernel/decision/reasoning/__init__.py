# VENDORED from repo-root reasoning-engine/src/reasoning (pure-numpy, no deps).
# Canonical source + full test suite (40 tests) live there; keep in sync.
# Deployed in-tree so the ai-service app imports it without a cross-repo path.

"""reasoning-engine — the per-prediction scientific trust layer for Hakase.

Sits BELOW the MC-DC decision engine (which certifies the multi-endpoint decision) and
turns any single model output into an auditable, calibration-backed, abstention-aware
:class:`~reasoning.evidence.EvidenceRecord` that answers the seven questions a cautious
computational scientist would ask of it.

Design axioms (shared with mcdc-engine / the ai-service):
  • Pure NumPy, no silent fallbacks — where a quantity is not estimable, abstain and say so.
  • Every algorithm carries its scientific rationale and primary references in-module.
  • A "confidence" is only shown once it is calibrated against realised correctness; the
    honest alternative to a fabricated number is "not estimable".

Public API
----------
Calibration      reliability_curve, expected_calibration_error, brier_decomposition,
                 IsotonicCalibrator, fit_temperature
Reliability      CalibratedReliability, ReliabilityEstimate, audit_heuristic_confidence
Selective pred.  risk_coverage_curve, area_under_risk_coverage, guaranteed_risk_threshold,
                 chow_threshold
Shift / OOD      detect_shift, population_stability_index, ks_two_sample, conformal_pvalues
Evidence         build_record, EvidenceRecord, AbstainPolicy
"""

from .calibration import (
    BrierDecomposition,
    IsotonicCalibrator,
    ReliabilityCurve,
    brier_decomposition,
    brier_score,
    calibration_in_the_large,
    expected_calibration_error,
    fit_temperature,
    maximum_calibration_error,
    reliability_curve,
    temperature_transform,
)
from .evidence import AbstainPolicy, EvidenceRecord, build_record
from .ood import (
    ShiftReport,
    conformal_pvalues,
    detect_shift,
    ks_two_sample,
    population_stability_index,
)
from .reliability import (
    CalibratedReliability,
    ReliabilityEstimate,
    audit_heuristic_confidence,
)
from .selective import (
    GuaranteedThreshold,
    RiskCoverage,
    area_under_risk_coverage,
    chow_threshold,
    guaranteed_risk_threshold,
    hoeffding_upper_bound,
    risk_coverage_curve,
)

__version__ = "0.1.0"

__all__ = [
    # calibration
    "ReliabilityCurve",
    "reliability_curve",
    "expected_calibration_error",
    "maximum_calibration_error",
    "brier_score",
    "BrierDecomposition",
    "brier_decomposition",
    "calibration_in_the_large",
    "IsotonicCalibrator",
    "fit_temperature",
    "temperature_transform",
    # reliability
    "CalibratedReliability",
    "ReliabilityEstimate",
    "audit_heuristic_confidence",
    # selective prediction
    "RiskCoverage",
    "risk_coverage_curve",
    "area_under_risk_coverage",
    "guaranteed_risk_threshold",
    "GuaranteedThreshold",
    "chow_threshold",
    "hoeffding_upper_bound",
    # shift / ood
    "detect_shift",
    "ShiftReport",
    "population_stability_index",
    "ks_two_sample",
    "conformal_pvalues",
    # evidence
    "build_record",
    "EvidenceRecord",
    "AbstainPolicy",
    "__version__",
]
