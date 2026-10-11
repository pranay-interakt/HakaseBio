"""Common result type for data-source clients."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping, Optional

from hos.core.quantity import Quantity

__all__ = ["SourceStatus", "SourceResult"]


class SourceStatus(str, Enum):
    OK = "ok"
    NOT_FOUND = "not_found"
    RATE_LIMITED = "rate_limited"
    UNREACHABLE = "unreachable"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class SourceResult:
    source: str
    status: SourceStatus
    query: str
    url: str
    retrieved_at: Optional[str]
    records: tuple[Mapping[str, Any], ...] = ()
    quantities: Mapping[str, Quantity] = field(default_factory=dict)
    from_cache: bool = False
    license: Optional[str] = None
    attribution: Optional[str] = None
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.status is SourceStatus.OK

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source, "status": self.status.value, "query": self.query,
            "url": self.url, "retrieved_at": self.retrieved_at, "from_cache": self.from_cache,
            "records": [dict(r) for r in self.records],
            "quantities": {k: q.to_dict() for k, q in self.quantities.items()},
            "license": self.license, "attribution": self.attribution, "error": self.error,
        }
