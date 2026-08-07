"""MC-DC: Mechanistic Conformal Decision Control.

A decision engine that sits above a platform's ADMET / toxicity endpoint models
and converts their outputs -- plus a mechanistic adverse-outcome-pathway graph and
a labelled outcome corpus -- into a Go / Watch / No-Go decision that carries a
finite-sample, distribution-free bound on the expected cost of the safety-critical
decision error, valid under statistical dependence among the endpoints.

Public API
----------
- :class:`~mcdc.graph.CredalGraph`, :class:`~mcdc.graph.Edge`
- :class:`~mcdc.evidence.EndpointReading`
- :class:`~mcdc.decision.DecisionThresholds`, :class:`~mcdc.decision.Decision`
- :class:`~mcdc.engine.MCDCEngine`, :func:`~mcdc.engine.readings_from_arrays`
- :class:`~mcdc.reliability.KNNApplicabilityScorer`
- :class:`~mcdc.interfaces.EndpointModel`, :class:`~mcdc.interfaces.ApplicabilityScorer`
- :func:`~mcdc.crc.calibrate_risk_control`
"""

from .crc import (
    CRCResult,
    GroupedCRCResult,
    advanced_mask_grouped,
    calibrate_risk_control,
    calibrate_risk_control_grouped,
    false_advancement_loss,
)
from .decision import Decision, DecisionThresholds, decide, read_scalars
from .engine import DecisionRecord, MCDCEngine, readings_from_arrays
from .evidence import EndpointReading, build_evidence
from .graph import CredalGraph, Edge
from .interfaces import ApplicabilityScorer, EndpointModel
from .interval import Interval
from .reliability import KNNApplicabilityScorer
from .verdict import NeymanPearsonVerdict
from .voi import ExperimentValue, rank_experiments

__version__ = "0.1.0"

__all__ = [
    "CRCResult",
    "GroupedCRCResult",
    "calibrate_risk_control",
    "calibrate_risk_control_grouped",
    "advanced_mask_grouped",
    "false_advancement_loss",
    "Decision",
    "DecisionThresholds",
    "decide",
    "read_scalars",
    "DecisionRecord",
    "MCDCEngine",
    "readings_from_arrays",
    "EndpointReading",
    "build_evidence",
    "CredalGraph",
    "Edge",
    "ApplicabilityScorer",
    "EndpointModel",
    "Interval",
    "KNNApplicabilityScorer",
    "ExperimentValue",
    "rank_experiments",
    "NeymanPearsonVerdict",
    "__version__",
]
