"""Layer 3 — Decision & Validation Framework (doc 01 ch.6, doc 05 v2).

Policy-based, deterministic reasoning over the Platform Evidence Object. No LLM,
no opaque model: every score, weight and threshold is inspectable, and every
decision cites the evidence that produced it. Scientific prediction (Layer 2) is
strictly separated from scientific decision making (here).
"""

from .engine import Decision, DecisionEngine
from .policy import Policy, PolicyStore, VariableClass, get_policy_store
from .record import DecisionRecord
from .scoring import aggregate_confidence, assess_consistency, score_domains
from .variables import VARIABLE_REGISTRY, VariableSpec, extract_variables

__all__ = [
    "VARIABLE_REGISTRY",
    "VariableSpec",
    "extract_variables",
    "Policy",
    "PolicyStore",
    "get_policy_store",
    "VariableClass",
    "score_domains",
    "aggregate_confidence",
    "assess_consistency",
    "DecisionEngine",
    "Decision",
    "DecisionRecord",
]
