"""Quality-control verdicts.

A computation that produced a number which should not be trusted must say so.
QC findings travel with the result rather than being logged and forgotten, and a
``FAIL`` verdict propagates into the flags of every derived quantity.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

__all__ = ["QCFinding", "QCStatus", "QCVerdict"]


class QCStatus(str, Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"

    @property
    def rank(self) -> int:
        return {"pass": 0, "warn": 1, "fail": 2}[self.value]


@dataclass(frozen=True, slots=True)
class QCFinding:
    code: str
    status: QCStatus
    message: str
    observed: Any = None
    threshold: Any = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "status": self.status.value,
            "message": self.message,
            "observed": self.observed,
            "threshold": self.threshold,
        }


@dataclass(frozen=True, slots=True)
class QCVerdict:
    findings: tuple[QCFinding, ...] = field(default_factory=tuple)

    @classmethod
    def of(cls, findings: Iterable[QCFinding]) -> QCVerdict:
        return cls(tuple(findings))

    @property
    def status(self) -> QCStatus:
        if not self.findings:
            return QCStatus.PASS
        return max((f.status for f in self.findings), key=lambda s: s.rank)

    @property
    def passed(self) -> bool:
        return self.status is not QCStatus.FAIL

    @property
    def flags(self) -> tuple[str, ...]:
        return tuple(f.code for f in self.findings if f.status is not QCStatus.PASS)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "findings": [f.to_dict() for f in self.findings],
        }
