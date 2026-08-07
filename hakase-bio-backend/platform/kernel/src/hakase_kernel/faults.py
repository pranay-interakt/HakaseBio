"""Fault-tolerance taxonomy (doc 01 §4.10).

Failures are classified so the orchestrator can decide whether to retry, to
continue with partial evidence, or to terminate. A service that cannot compute
does NOT crash the workflow — it yields an ``unavailable`` Evidence Object and
the workflow continues (partial), preserving transparency.
"""

from __future__ import annotations

from enum import Enum


class FailureType(str, Enum):
    RECOVERABLE = "recoverable"  # transient — retry automatically
    PARTIAL = "partial"  # this analysis fails, others proceed
    CRITICAL = "critical"  # cannot continue — terminate with diagnostics


class ServiceFailure(Exception):
    """Raised by a service when computation cannot proceed.

    ``failure_type`` drives orchestrator behaviour; ``reason_code`` is a stable
    machine-readable tag surfaced in the resulting evidence / diagnostics.
    """

    def __init__(
        self,
        message: str,
        *,
        failure_type: FailureType = FailureType.PARTIAL,
        reason_code: str = "service_error",
    ) -> None:
        super().__init__(message)
        self.failure_type = failure_type
        self.reason_code = reason_code


def classify_exception(exc: BaseException) -> FailureType:
    """Best-effort classification of an unexpected exception."""
    if isinstance(exc, ServiceFailure):
        return exc.failure_type
    name = type(exc).__name__.lower()
    transient = ("timeout", "connection", "temporarilyunavailable", "ratelimit")
    if any(t in name for t in transient):
        return FailureType.RECOVERABLE
    # Programming errors are critical; everything else degrades to partial.
    if isinstance(exc, (KeyError, AttributeError, TypeError, IndexError)):
        return FailureType.CRITICAL
    return FailureType.PARTIAL
