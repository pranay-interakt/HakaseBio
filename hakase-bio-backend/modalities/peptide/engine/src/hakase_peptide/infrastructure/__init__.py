"""Layer 1 — Platform Infrastructure (doc 01 ch.4).

Coordinates execution, manages models and resources, standardizes communication
via the Evidence Bus, and records a complete audit trail. Performs **no**
biological computation.
"""

from hakase_kernel.faults import FailureType, ServiceFailure, classify_exception

from .audit import AuditLog, AuditRecord, get_audit_log
from .evidence_bus import EvidenceBus
from .model_registry import ModelEntry, ModelRegistry, get_model_registry
from .orchestrator import WorkflowOrchestrator, WorkflowResult
from .resource_manager import ResourceManager, get_resource_manager

__all__ = [
    "FailureType",
    "ServiceFailure",
    "classify_exception",
    "AuditLog",
    "AuditRecord",
    "get_audit_log",
    "ModelRegistry",
    "ModelEntry",
    "get_model_registry",
    "EvidenceBus",
    "ResourceManager",
    "get_resource_manager",
    "WorkflowOrchestrator",
    "WorkflowResult",
]
