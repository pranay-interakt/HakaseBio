"""End-to-end orchestration facade (ties Layers 1–3 together).

``analyze_peptide`` runs the full V3 workflow: validate input -> orchestrate the
five Scientific Services -> assemble & aggregate the Platform Evidence Object ->
apply the resolved Decision Policy -> return evidence + a GO/Conditional/NO-GO
Decision Record. This is the single entry point the API and any batch job use.
"""

from __future__ import annotations

import dataclasses
import logging
import time
from datetime import UTC, datetime
from typing import Any

from hakase_kernel.faults import ServiceFailure

from .decision import DecisionEngine, get_policy_store
from .decision.scoring import aggregate_confidence, assess_consistency
from .decision.variables import extract_variables
from .domain.evidence import EvidenceType
from .domain.peptide import DisulfideBridgeSpec, Peptide
from .domain.platform_evidence import PlatformEvidence
from .domain.target import Target
from .infrastructure import WorkflowOrchestrator
from .services import default_services
from .services.functional import FunctionalAnalysisService
from .services.physicochemical import PhysicochemicalService
from .services.structural import StructuralBiologyService

_ORCHESTRATOR: WorkflowOrchestrator | None = None
_PHYS_ORCHESTRATOR: WorkflowOrchestrator | None = None
_FUNC_ORCHESTRATOR: WorkflowOrchestrator | None = None
_ENGINE = DecisionEngine()
logger = logging.getLogger("hakase_peptide.timing")
logger.setLevel(logging.INFO)


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def _orchestrator() -> WorkflowOrchestrator:
    global _ORCHESTRATOR
    if _ORCHESTRATOR is None:
        _ORCHESTRATOR = WorkflowOrchestrator(default_services())
    return _ORCHESTRATOR


def _phys_orchestrator() -> WorkflowOrchestrator:
    """Single-service orchestrator for the physicochemical-only entry point.

    Reuses the orchestrator's failure isolation (a raised service error becomes
    a sanctioned ``unavailable`` Evidence Object plus an audit record) rather
    than calling the service bare, so the helper matches ``analyze_peptide``'s
    never-fabricate contract."""
    global _PHYS_ORCHESTRATOR
    if _PHYS_ORCHESTRATOR is None:
        _PHYS_ORCHESTRATOR = WorkflowOrchestrator([PhysicochemicalService()])
    return _PHYS_ORCHESTRATOR


def _func_orchestrator() -> WorkflowOrchestrator:
    """Orchestrator for the functional-only entry point.

    FunctionalAnalysisService.depends_on = [PHYSICOCHEMICAL, STRUCTURAL], so both
    upstream services must run first -- included here so their evidence lands in
    ExecutionContext before FunctionalAnalysisService runs; the orchestrator's
    topological scheduler handles the ordering.
    """
    global _FUNC_ORCHESTRATOR
    if _FUNC_ORCHESTRATOR is None:
        _FUNC_ORCHESTRATOR = WorkflowOrchestrator(
            [PhysicochemicalService(), StructuralBiologyService(), FunctionalAnalysisService()]
        )
    return _FUNC_ORCHESTRATOR


def analyze_peptide(
    *,
    sequence: str,
    cyclic: bool = False,
    ph: float = 7.4,
    ionic_strength_mM: float = 150.0,
    disulfide_bridges: DisulfideBridgeSpec | None = None,
    modifications: dict[str, Any] | None = None,
    target: dict[str, Any] | None = None,
    policy_id: str | None = None,
    modality: str | None = None,
    include_pdb: bool = False,
) -> dict[str, Any]:
    peptide = Peptide.create(
        sequence,
        cyclic=cyclic,
        ph=ph,
        ionic_strength_mM=ionic_strength_mM,
        disulfide_bridges=disulfide_bridges,
        modifications=modifications,
    )
    tgt: Target | None = None
    if target:
        tgt = Target.create(**target)

    # Layer 1+2: orchestrate services -> evidence.
    result = _orchestrator().run(
        peptide, target=tgt, policy_id=policy_id, options={"include_pdb": include_pdb}
    )

    # Assemble + aggregate the Platform Evidence Object.
    platform_evidence = PlatformEvidence.assemble(
        result.subject_id, result.execution_id, result.evidence
    )
    resolution = get_policy_store().resolve(policy_id=policy_id, modality=modality)
    policy = resolution.policy

    conf = aggregate_confidence(platform_evidence, policy)
    var_names = sorted(set(policy.soft_variables) | {h.variable for h in policy.hard_constraints})
    variables = extract_variables(platform_evidence, var_names)
    consistency = assess_consistency(variables)
    platform_evidence = dataclasses.replace(
        platform_evidence,
        aggregated_confidence=conf["aggregated_confidence"],
        aggregated_uncertainty=conf["aggregated_uncertainty"],
        consistency_assessment=consistency,
        conflict_summary=consistency["conflicts"],
    )

    # Layer 3: decision.
    decision_started_at = _utc_now_iso()
    decision_started = time.perf_counter()
    logger.info(
        "[peptide-v3-timing] domain_start domain=decision service=decision_engine execution_id=%s started_at=%s",
        result.execution_id,
        decision_started_at,
    )
    try:
        record = _ENGINE.decide(platform_evidence, policy, resolved_by=resolution.resolved_by)
    except BaseException:
        decision_completed_at = _utc_now_iso()
        decision_duration_ms = (time.perf_counter() - decision_started) * 1000.0
        logger.info(
            "[peptide-v3-timing] domain_complete domain=decision service=decision_engine execution_id=%s "
            "started_at=%s completed_at=%s duration_ms=%.1f status=error",
            result.execution_id,
            decision_started_at,
            decision_completed_at,
            decision_duration_ms,
        )
        raise
    decision_completed_at = _utc_now_iso()
    decision_duration_ms = (time.perf_counter() - decision_started) * 1000.0
    logger.info(
        "[peptide-v3-timing] domain_complete domain=decision service=decision_engine execution_id=%s "
        "started_at=%s completed_at=%s duration_ms=%.1f status=success",
        result.execution_id,
        decision_started_at,
        decision_completed_at,
        decision_duration_ms,
    )
    result.diagnostics["decision"] = {
        "status": "success",
        "duration_ms": round(decision_duration_ms, 1),
        "started_at": decision_started_at,
        "completed_at": decision_completed_at,
    }

    return {
        "input": peptide.to_dict(),
        "target": tgt.to_dict() if tgt else None,
        "execution_id": result.execution_id,
        "terminated": result.terminated,
        "platform_evidence": platform_evidence.to_dict(),
        "decision": record.to_dict(),
        "diagnostics": result.diagnostics,
    }


def analyze_physicochemical(
    *,
    sequence: str,
    cyclic: bool = False,
    ph: float = 7.4,
    ionic_strength_mM: float = 150.0,
    disulfide_bridges: DisulfideBridgeSpec | None = None,
    modifications: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run only the Physicochemical Service and return its Evidence Object.

    A thin, decision-free entry point that exposes the single §14 Physicochemical
    Evidence Object (descriptors, embeddings-by-reference, provenance, per-field
    confidence) assembled by Milestones A/B/C — without orchestrating the other
    services or resolving a decision policy. The returned dict is plain Python
    but may still carry numpy scalars from the engine/embeddings; callers that
    serialise it (the API layer) sanitise via ``api.jsonsafe.sanitize``.
    """
    peptide = Peptide.create(
        sequence,
        cyclic=cyclic,
        ph=ph,
        ionic_strength_mM=ionic_strength_mM,
        disulfide_bridges=disulfide_bridges,
        modifications=modifications,
    )
    result = _phys_orchestrator().run(peptide)
    evidence = next(
        (ev for ev in result.evidence if ev.evidence_type is EvidenceType.PHYSICOCHEMICAL),
        None,
    )
    if evidence is None:  # pragma: no cover — single-service run always emits one
        raise ServiceFailure(
            "Physicochemical Service produced no evidence.",
            reason_code="physicochemical_missing",
        )
    return {
        "input": peptide.to_dict(),
        "execution_id": result.execution_id,
        "evidence": evidence.to_dict(),
        "diagnostics": result.diagnostics,
    }


def analyze_functional(
    *,
    sequence: str,
    cyclic: bool = False,
    ph: float = 7.4,
    ionic_strength_mM: float = 150.0,
    disulfide_bridges: str | None = None,
    modifications: dict[str, Any] | None = None,
    target: dict[str, Any] | None = None,
    modality: str | None = None,
) -> dict[str, Any]:
    """Run Physicochemical -> Structural -> Functional and return the Functional
    Evidence Object (plus the upstream evidence it was derived from).

    ``modality`` (e.g. "antimicrobial", "cell_penetrating", "receptor_binding",
    "enzyme_inhibitory") drives the Functional Analysis Service's Workflow
    Selector (Functional Analysis Service Spec §5.1/§6.1); an unrecognized or
    omitted modality falls back to a generic predictor set rather than failing.

    A decision-free entry point, same contract as ``analyze_physicochemical``:
    no policy resolution, just the evidence. Physicochemical and Structural are
    run because FunctionalAnalysisService.depends_on requires their evidence to
    already be in the ExecutionContext -- they are not decision inputs here,
    just dependencies, so their evidence is included for transparency/debugging.
    """
    peptide = Peptide.create(
        sequence,
        cyclic=cyclic,
        ph=ph,
        ionic_strength_mM=ionic_strength_mM,
        disulfide_bridges=disulfide_bridges,
        modifications=modifications,
    )
    tgt: Target | None = Target.create(**target) if target else None

    result = _func_orchestrator().run(peptide, target=tgt, modality=modality)

    evidence = next(
        (ev for ev in result.evidence if ev.evidence_type is EvidenceType.FUNCTIONAL),
        None,
    )
    if evidence is None:  # pragma: no cover — service run always emits one (or an unavailable one)
        raise ServiceFailure(
            "Functional Analysis Service produced no evidence.",
            reason_code="functional_missing",
        )

    upstream = {
        ev.evidence_type.value: ev.to_dict()
        for ev in result.evidence
        if ev.evidence_type is not EvidenceType.FUNCTIONAL
    }

    return {
        "input": peptide.to_dict(),
        "target": tgt.to_dict() if tgt else None,
        "modality": modality,
        "execution_id": result.execution_id,
        "evidence": evidence.to_dict(),
        "upstream_evidence": upstream,
        "diagnostics": result.diagnostics,
    }
