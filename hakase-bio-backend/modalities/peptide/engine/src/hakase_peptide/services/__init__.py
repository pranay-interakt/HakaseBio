"""Layer 2 — Core Scientific Services (doc 01 ch.5).

Five reusable services, each producing exactly one immutable Evidence Object and
making NO therapeutic decision. They reorganize the platform's existing real
science (deterministic biochemistry + trained classifiers + folding) under the
standardized evidence contract.
"""

from .base import ScientificService
from .developability import DevelopabilityService
from .functional import FunctionalAnalysisService
from .physicochemical import PhysicochemicalService
from .safety import SafetyService
from .structural import StructuralBiologyService


def default_services():
    """The standard V3 service set, in declaration order (deps resolved by the
    orchestrator's topological scheduler)."""
    return [
        PhysicochemicalService(),
        StructuralBiologyService(),
        FunctionalAnalysisService(),
        DevelopabilityService(),
        SafetyService(),
    ]


__all__ = [
    "ScientificService",
    "PhysicochemicalService",
    "StructuralBiologyService",
    "FunctionalAnalysisService",
    "DevelopabilityService",
    "SafetyService",
    "default_services",
]
