"""Logging & Audit System (doc 01 §4.9, doc 04 §18).

Records one immutable audit record per computational operation. "No prediction
should exist without an associated audit record." Records are held in a bounded
in-memory ring (for live inspection) and emitted to the standard logging system
so they land in the platform's persistent logs. An independent auditor can
reconstruct any prediction from the recorded service, model versions, config
hash, timing and status.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any

from ..domain.ids import new_id, utc_now_iso

logger = logging.getLogger("hakase_peptide.audit")


@dataclass(frozen=True)
class AuditRecord:
    audit_id: str
    execution_id: str
    service: str
    model_versions: dict[str, str]
    config_hash: str | None
    input_id: str
    output_id: str | None
    status: str  # "success" | "unavailable" | "error"
    duration_ms: float
    hardware: str
    warnings: list[str] = field(default_factory=list)
    detail: dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AuditLog:
    def __init__(self, capacity: int = 5000) -> None:
        self._records: deque[AuditRecord] = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def record(
        self,
        *,
        execution_id: str,
        service: str,
        input_id: str,
        status: str,
        duration_ms: float,
        model_versions: dict[str, str] | None = None,
        config_hash: str | None = None,
        output_id: str | None = None,
        hardware: str = "cpu",
        warnings: list[str] | None = None,
        detail: dict[str, Any] | None = None,
    ) -> AuditRecord:
        rec = AuditRecord(
            audit_id=new_id("audit"),
            execution_id=execution_id,
            service=service,
            model_versions=model_versions or {},
            config_hash=config_hash,
            input_id=input_id,
            output_id=output_id,
            status=status,
            duration_ms=round(duration_ms, 3),
            hardware=hardware,
            warnings=warnings or [],
            detail=detail or {},
        )
        with self._lock:
            self._records.append(rec)
        logger.info(
            "audit exec=%s service=%s status=%s dur_ms=%.1f models=%s",
            execution_id,
            service,
            status,
            rec.duration_ms,
            rec.model_versions,
        )
        return rec

    def for_execution(self, execution_id: str) -> list[AuditRecord]:
        with self._lock:
            return [r for r in self._records if r.execution_id == execution_id]

    def recent(self, n: int = 100) -> list[AuditRecord]:
        with self._lock:
            return list(self._records)[-n:]


_AUDIT: AuditLog | None = None
_AUDIT_LOCK = threading.Lock()


def get_audit_log() -> AuditLog:
    global _AUDIT
    if _AUDIT is None:
        with _AUDIT_LOCK:
            if _AUDIT is None:
                _AUDIT = AuditLog()
    return _AUDIT
