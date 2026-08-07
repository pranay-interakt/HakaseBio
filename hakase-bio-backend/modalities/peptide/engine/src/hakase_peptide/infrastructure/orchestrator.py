"""Workflow Orchestrator (doc 01 §4.4).

Coordinates execution of the Scientific Services in dependency order, runs
independent services concurrently, retries recoverable failures, continues past
partial failures (emitting ``unavailable`` evidence), and terminates only on
critical failures. Contains **no scientific logic** — services are duck-typed
(anything exposing ``name``, ``evidence_type``, ``depends_on`` and
``run(context)``).
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from hakase_kernel.config import PlatformConfig, get_config
from hakase_kernel.faults import FailureType, ServiceFailure, classify_exception

from ..domain.evidence import (
    EvidenceObject,
    EvidenceType,
    Provenance,
    unavailable_evidence,
)
from ..domain.ids import new_id
from ..domain.peptide import Peptide
from ..domain.target import Target
from .audit import AuditLog, get_audit_log
from .evidence_bus import EvidenceBus
from .model_registry import ModelRegistry, get_model_registry
from .resource_manager import ResourceManager, get_resource_manager

logger = logging.getLogger("hakase_peptide.timing")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    logger.addHandler(_handler)
logger.propagate = False


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


@dataclass
class ExecutionContext:
    """Everything a service needs to run one analysis. Passed to ``run``."""

    execution_id: str
    peptide: Peptide
    target: Target | None
    policy_id: str | None
    modality: str | None
    config: PlatformConfig
    registry: ModelRegistry
    resources: ResourceManager
    audit: AuditLog
    options: dict[str, Any] = field(default_factory=dict)
    _evidence: dict[str, EvidenceObject] = field(default_factory=dict)

    def evidence(self, evidence_type: EvidenceType) -> EvidenceObject | None:
        return self._evidence.get(evidence_type.value)

    def _put(self, ev: EvidenceObject) -> None:
        self._evidence[ev.evidence_type.value] = ev


class ScientificServiceProto(Protocol):
    name: str
    evidence_type: EvidenceType
    depends_on: list[EvidenceType]

    def run(self, context: ExecutionContext) -> EvidenceObject: ...


@dataclass
class WorkflowResult:
    execution_id: str
    subject_id: str
    evidence: list[EvidenceObject]
    terminated: bool
    diagnostics: dict[str, Any] = field(default_factory=dict)


class WorkflowOrchestrator:
    def __init__(
        self,
        services: list[ScientificServiceProto],
        *,
        bus: EvidenceBus | None = None,
        config: PlatformConfig | None = None,
        max_workers: int = 4,
    ) -> None:
        self._services = {s.evidence_type.value: s for s in services}
        self._order = [s.evidence_type.value for s in services]
        self._bus = bus or EvidenceBus()
        self._config = config or get_config()
        self._registry = get_model_registry()
        self._resources = get_resource_manager()
        self._audit = get_audit_log()
        self._max_workers = max_workers

    # ---- scheduling ---------------------------------------------------------
    def _waves(self) -> list[list[str]]:
        """Kahn topological layering: each wave is a set of ready services."""
        remaining = set(self._order)
        done: set = set()
        waves: list[list[str]] = []
        while remaining:
            ready = [
                key
                for key in self._order
                if key in remaining
                and all(dep.value in done for dep in self._services[key].depends_on)
            ]
            if not ready:
                raise ServiceFailure(
                    "Service dependency cycle or missing dependency detected.",
                    failure_type=FailureType.CRITICAL,
                    reason_code="dependency_cycle",
                )
            waves.append(ready)
            for key in ready:
                remaining.discard(key)
                done.add(key)
        return waves

    # ---- execution ----------------------------------------------------------
    def run(
        self,
        peptide: Peptide,
        *,
        target: Target | None = None,
        policy_id: str | None = None,
        modality: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> WorkflowResult:
        execution_id = new_id("exec")
        ctx = ExecutionContext(
            execution_id=execution_id,
            peptide=peptide,
            target=target,
            policy_id=policy_id,
            modality=modality,
            config=self._config,
            registry=self._registry,
            resources=self._resources,
            audit=self._audit,
            options=dict(options or {}),
        )
        diagnostics: dict[str, Any] = {"services": {}}
        terminated = False

        for wave in self._waves():
            if terminated:
                break
            results: dict[str, EvidenceObject] = {}
            if len(wave) == 1:
                key = wave[0]
                results[key] = self._run_one(self._services[key], ctx, diagnostics)
            else:
                with ThreadPoolExecutor(max_workers=min(self._max_workers, len(wave))) as pool:
                    futs = {
                        key: pool.submit(self._run_one, self._services[key], ctx, diagnostics)
                        for key in wave
                    }
                    for key, fut in futs.items():
                        results[key] = fut.result()
            for key, ev in results.items():
                ctx._put(ev)
                self._bus.publish(ev)
                if (
                    diagnostics["services"].get(key, {}).get("failure_type")
                    == FailureType.CRITICAL.value
                ):
                    terminated = True

        collected = self._bus.collect(execution_id)
        return WorkflowResult(
            execution_id=execution_id,
            subject_id=peptide.subject_id,
            evidence=collected,
            terminated=terminated,
            diagnostics=diagnostics,
        )

    def _run_one(
        self,
        service: ScientificServiceProto,
        ctx: ExecutionContext,
        diagnostics: dict[str, Any],
    ) -> EvidenceObject:
        key = service.evidence_type.value
        attempts = 0
        max_attempts_fn = getattr(service, "max_attempts", None)
        if callable(max_attempts_fn):
            max_attempts = max(1, int(max_attempts_fn(ctx)))
        else:
            max_attempts = 1 + max(0, self._config.structure_max_retries)
        retry_delay_fn = getattr(service, "retry_delay_s", None)
        last_exc: BaseException | None = None
        started = time.perf_counter()
        started_at = _utc_now_iso()
        logger.info(
            "[peptide-v3-timing] domain_start domain=%s service=%s execution_id=%s started_at=%s",
            key,
            service.name,
            ctx.execution_id,
            started_at,
        )

        while attempts < max_attempts:
            attempts += 1
            try:
                ev = service.run(ctx)
                completed_at = _utc_now_iso()
                dur_ms = (time.perf_counter() - started) * 1000.0
                status = "success" if ev.is_available else "unavailable"
                logger.info(
                    "[peptide-v3-timing] domain_complete domain=%s service=%s execution_id=%s "
                    "started_at=%s completed_at=%s duration_ms=%.1f status=%s attempts=%s",
                    key,
                    service.name,
                    ctx.execution_id,
                    started_at,
                    completed_at,
                    dur_ms,
                    status,
                    attempts,
                )
                ctx.audit.record(
                    execution_id=ctx.execution_id,
                    service=service.name,
                    input_id=ctx.peptide.subject_id,
                    status=status,
                    duration_ms=dur_ms,
                    output_id=ev.evidence_id,
                    model_versions=ctx.registry.version_map(ev.provenance.model_checkpoints or []),
                    warnings=list(ev.warnings),
                    detail={"attempts": attempts},
                )
                diagnostics["services"][key] = {
                    "status": status,
                    "attempts": attempts,
                    "duration_ms": round(dur_ms, 1),
                    "started_at": started_at,
                    "completed_at": completed_at,
                }
                return ev
            except BaseException as exc:  # noqa: BLE001 — deliberate: classify & isolate
                last_exc = exc
                ftype = classify_exception(exc)
                if ftype is FailureType.RECOVERABLE and attempts < max_attempts:
                    if callable(retry_delay_fn):
                        delay_s = max(0.0, float(retry_delay_fn(ctx, attempts, exc)))
                    else:
                        delay_s = min(2.0 * attempts, 5.0)
                    time.sleep(delay_s)
                    continue
                completed_at = _utc_now_iso()
                dur_ms = (time.perf_counter() - started) * 1000.0
                reason_code = getattr(exc, "reason_code", "service_error")
                failure_metadata_fn = getattr(service, "failure_metadata", None)
                failure_metadata = (
                    dict(failure_metadata_fn(ctx, exc, attempts))
                    if callable(failure_metadata_fn)
                    else {}
                )
                failure_provenance_fn = getattr(service, "failure_provenance", None)
                failure_provenance = (
                    failure_provenance_fn(ctx, exc, attempts)
                    if callable(failure_provenance_fn)
                    else Provenance(originating_service=service.name)
                )
                failure_payload_fn = getattr(service, "failure_payload", None)
                failure_payload = (
                    dict(failure_payload_fn(ctx, exc, attempts))
                    if callable(failure_payload_fn)
                    else None
                )
                logger.info(
                    "[peptide-v3-timing] domain_complete domain=%s service=%s execution_id=%s "
                    "started_at=%s completed_at=%s duration_ms=%.1f status=error attempts=%s "
                    "failure_type=%s reason_code=%s",
                    key,
                    service.name,
                    ctx.execution_id,
                    started_at,
                    completed_at,
                    dur_ms,
                    attempts,
                    ftype.value,
                    reason_code,
                )
                ctx.audit.record(
                    execution_id=ctx.execution_id,
                    service=service.name,
                    input_id=ctx.peptide.subject_id,
                    status="error",
                    duration_ms=dur_ms,
                    warnings=[str(exc)],
                    detail={
                        "attempts": attempts,
                        "failure_type": ftype.value,
                        "reason_code": reason_code,
                    },
                )
                diagnostics["services"][key] = {
                    "status": "error",
                    "attempts": attempts,
                    "failure_type": ftype.value,
                    "reason_code": reason_code,
                    "message": str(exc),
                    "duration_ms": round(dur_ms, 1),
                    "started_at": started_at,
                    "completed_at": completed_at,
                    **failure_metadata,
                }
                ev = unavailable_evidence(
                    evidence_type=service.evidence_type,
                    producing_service=service.name,
                    subject_id=ctx.peptide.subject_id,
                    execution_id=ctx.execution_id,
                    reason_code=reason_code,
                    reason_detail=str(exc),
                    provenance=failure_provenance,
                    metadata={
                        "failure_type": ftype.value,
                        "attempts": attempts,
                        **failure_metadata,
                    },
                )
                if failure_payload is not None:
                    ev.scientific_payload.update(failure_payload)
                return ev
        # unreachable, but keeps type-checkers happy
        raise last_exc if last_exc else RuntimeError("unknown orchestration error")
