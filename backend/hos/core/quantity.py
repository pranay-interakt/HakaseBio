"""The provenance-typed scientific value.

``Quantity`` is the only way a scientific number enters, moves through, or leaves
the Hakase OS. It binds four things that must never be separated:

* the **value** (or its absence),
* the **unit** (checked against a real unit registry),
* the **provenance** (how it came to exist, with citations),
* the **uncertainty**, where it is known.

There is no constructor that produces a number without provenance. A gap in the
data is represented by :meth:`Quantity.unavailable`, which carries a reason and
has ``value is None`` -- so downstream arithmetic fails loudly rather than
silently propagating a fabricated default.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field, replace
from typing import Any, Iterable, Optional, Sequence

from hos.core import units as U
from hos.core.provenance import (
    ApplicabilityCheck,
    Citation,
    Method,
    Provenance,
    ProvenanceKind,
)

__all__ = ["Quantity", "MeasurementSeries", "QuantityError", "SIMULATION_TAINT"]

#: QC flag carried by every value derived, at any distance, from simulated data. A COMPUTED
#: value is only as admissible as its inputs; this flag is how that is preserved once the
#: inputs are no longer attached.
SIMULATION_TAINT = "derived_from_simulated_data"


class QuantityError(ValueError):
    """Raised when an operation is attempted on an unusable quantity."""


@dataclass(frozen=True, slots=True)
class Quantity:
    """A scientific value that knows where it came from."""

    value: Optional[float]
    unit: str
    provenance: Provenance
    uncertainty: Optional[Any] = None
    label: Optional[str] = None
    qc_flags: tuple[str, ...] = field(default_factory=tuple)

    # -- invariants ---------------------------------------------------------

    def __post_init__(self) -> None:
        U.parse_unit(self.unit)  # raises on an unrecognised unit
        if self.provenance.kind is ProvenanceKind.UNAVAILABLE:
            if self.value is not None:
                raise QuantityError("UNAVAILABLE quantity must not carry a value")
        else:
            if self.value is None:
                raise QuantityError(
                    "a quantity with a value-bearing provenance must have a value; "
                    "use Quantity.unavailable(...) to represent a gap"
                )
            if not isinstance(self.value, (int, float)) or isinstance(self.value, bool):
                raise QuantityError(f"value must be a real number, got {type(self.value).__name__}")
            if not math.isfinite(float(self.value)):
                raise QuantityError("value must be finite (NaN/inf indicate a failed computation)")

    # -- constructors -------------------------------------------------------

    @classmethod
    def measured(
        cls,
        value: float,
        unit: str,
        *,
        source_name: str,
        actor: Optional[str] = None,
        source_record_id: Optional[str] = None,
        uncertainty: Optional[Any] = None,
        label: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> "Quantity":
        return cls(
            value=float(value),
            unit=unit,
            provenance=Provenance.measured(
                source_name=source_name,
                actor=actor,
                source_record_id=source_record_id,
                notes=notes,
            ),
            uncertainty=uncertainty,
            label=label,
        )

    @classmethod
    def literature(
        cls,
        value: float,
        unit: str,
        *,
        source_name: str,
        citation: Optional[Citation] = None,
        source_url: Optional[str] = None,
        source_record_id: Optional[str] = None,
        uncertainty: Optional[Any] = None,
        label: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> "Quantity":
        return cls(
            value=float(value),
            unit=unit,
            provenance=Provenance.literature(
                source_name=source_name,
                citation=citation,
                source_url=source_url,
                source_record_id=source_record_id,
                notes=notes,
            ),
            uncertainty=uncertainty,
            label=label,
        )

    @classmethod
    def computed(
        cls,
        value: float,
        unit: str,
        *,
        method: Method,
        inputs: Sequence["Quantity"] = (),
        software: Optional[dict[str, str]] = None,
        parameter_set_version: Optional[str] = None,
        uncertainty: Optional[Any] = None,
        label: Optional[str] = None,
        qc_flags: Iterable[str] = (),
        notes: Optional[str] = None,
    ) -> "Quantity":
        return cls(
            value=float(value),
            unit=unit,
            provenance=Provenance.computed(
                method=method,
                input_ids=[q.id for q in inputs],
                software=software,
                parameter_set_version=parameter_set_version,
                notes=notes,
            ),
            uncertainty=uncertainty,
            label=label,
            qc_flags=tuple(qc_flags),
        )

    @classmethod
    def predicted(
        cls,
        value: float,
        unit: str,
        *,
        method: Method,
        applicability: ApplicabilityCheck,
        inputs: Sequence["Quantity"] = (),
        software: Optional[dict[str, str]] = None,
        uncertainty: Optional[Any] = None,
        label: Optional[str] = None,
        qc_flags: Iterable[str] = (),
        notes: Optional[str] = None,
    ) -> "Quantity":
        flags = list(qc_flags)
        if not applicability.in_domain:
            flags.append("out_of_applicability_domain")
        return cls(
            value=float(value),
            unit=unit,
            provenance=Provenance.predicted(
                method=method,
                applicability=applicability,
                input_ids=[q.id for q in inputs],
                software=software,
                notes=notes,
            ),
            uncertainty=uncertainty,
            label=label,
            qc_flags=tuple(flags),
        )

    @classmethod
    def guideline(
        cls,
        value: float,
        unit: str,
        *,
        citation: Citation,
        source_record_id: Optional[str] = None,
        parameter_set_version: Optional[str] = None,
        label: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> "Quantity":
        return cls(
            value=float(value),
            unit=unit,
            provenance=Provenance.guideline(
                citation=citation,
                source_record_id=source_record_id,
                parameter_set_version=parameter_set_version,
                notes=notes,
            ),
            label=label,
        )

    @classmethod
    def user_supplied(
        cls,
        value: float,
        unit: str,
        *,
        actor: str,
        label: Optional[str] = None,
        uncertainty: Optional[Any] = None,
        notes: Optional[str] = None,
    ) -> "Quantity":
        return cls(
            value=float(value),
            unit=unit,
            provenance=Provenance.user_supplied(actor=actor, notes=notes),
            uncertainty=uncertainty,
            label=label,
        )

    @classmethod
    def unavailable(
        cls,
        unit: str,
        *,
        reason: str,
        source_name: Optional[str] = None,
        label: Optional[str] = None,
    ) -> "Quantity":
        """Represent an honest gap. ``value`` is ``None`` and the reason is carried."""
        return cls(
            value=None,
            unit=unit,
            provenance=Provenance.unavailable(reason=reason, source_name=source_name),
            label=label,
        )

    # -- access -------------------------------------------------------------

    @property
    def is_available(self) -> bool:
        return self.value is not None

    @property
    def kind(self) -> ProvenanceKind:
        return self.provenance.kind

    @property
    def is_empirical(self) -> bool:
        """True when this value traces to an observation rather than a model."""
        return self.provenance.kind.is_empirical

    @property
    def is_simulated(self) -> bool:
        return self.provenance.kind is ProvenanceKind.SIMULATED

    @property
    def admissible_as_evidence(self) -> bool:
        """False for simulated or unavailable values and for anything derived from simulation."""
        return self.provenance.kind.admissible_as_evidence and SIMULATION_TAINT not in self.qc_flags

    def tainted_by_simulation(self) -> "Quantity":
        """Mark this value as derived from simulated data (idempotent)."""
        return self.with_flags(SIMULATION_TAINT)

    @property
    def id(self) -> str:
        """Content hash identifying this exact value+unit+origin."""
        payload = {
            "v": None if self.value is None else repr(round(float(self.value), 12)),
            "u": str(U.parse_unit(self.unit)),
            "p": self.provenance.fingerprint(),
            "l": self.label,
        }
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return "q_" + hashlib.sha256(blob.encode()).hexdigest()[:20]

    def require(self) -> float:
        """Return the magnitude, or raise if the value is unavailable.

        Call this at the point where a real number is genuinely needed, so that a
        missing input surfaces as an explicit error rather than a silent default.
        """
        if self.value is None:
            raise QuantityError(
                f"required quantity {self.label or self.unit!r} is unavailable: "
                f"{self.provenance.reason}"
            )
        return float(self.value)

    def magnitude_in(self, unit: str) -> float:
        """Magnitude converted to ``unit``; raises if unavailable or incompatible."""
        return U.convert(self.require(), self.unit, unit)

    def to(self, unit: str) -> "Quantity":
        """Convert to another unit, preserving provenance and recording the conversion."""
        if self.value is None:
            return replace(self, unit=unit)
        converted = U.convert(float(self.value), self.unit, unit)
        return replace(
            self,
            value=converted,
            unit=unit,
            provenance=self.provenance.with_note(f"converted {self.unit} -> {unit}"),
        )

    def with_flags(self, *flags: str) -> "Quantity":
        return replace(self, qc_flags=tuple(dict.fromkeys((*self.qc_flags, *flags))))

    def relabel(self, label: str) -> "Quantity":
        return replace(self, label=label)

    # -- presentation -------------------------------------------------------

    def __str__(self) -> str:
        if self.value is None:
            return f"{self.label or 'value'}: unavailable ({self.provenance.reason})"
        unit = "" if self.unit == U.DIMENSIONLESS else f" {self.unit}"
        name = f"{self.label}: " if self.label else ""
        return f"{name}{self.value:.6g}{unit} [{self.provenance.kind.value}]"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
            "available": self.is_available,
            "provenance": self.provenance.to_dict(),
            "uncertainty": (
                self.uncertainty.to_dict()
                if self.uncertainty is not None and hasattr(self.uncertainty, "to_dict")
                else self.uncertainty
            ),
            "qc_flags": list(self.qc_flags),
        }


@dataclass(frozen=True, slots=True)
class MeasurementSeries:
    """A raw observed series (e.g. concentration vs time) with shared provenance.

    Series are the typical *input* to a driver's analysis step. They keep the raw
    observations addressable so that any derived :class:`Quantity` can point back
    at the exact measurements that produced it.
    """

    x: tuple[float, ...]
    y: tuple[float, ...]
    x_unit: str
    y_unit: str
    provenance: Provenance
    x_label: str = "x"
    y_label: str = "y"

    def __post_init__(self) -> None:
        U.parse_unit(self.x_unit)
        U.parse_unit(self.y_unit)
        if len(self.x) != len(self.y):
            raise QuantityError("x and y must have equal length")
        if len(self.x) < 2:
            raise QuantityError("a series needs at least two points")
        for arr, nm in ((self.x, "x"), (self.y, "y")):
            for v in arr:
                if not math.isfinite(float(v)):
                    raise QuantityError(f"non-finite value in {nm} series")

    @property
    def n(self) -> int:
        return len(self.x)

    @property
    def id(self) -> str:
        blob = json.dumps(
            {
                "x": [round(float(v), 12) for v in self.x],
                "y": [round(float(v), 12) for v in self.y],
                "xu": self.x_unit,
                "yu": self.y_unit,
                "p": self.provenance.fingerprint(),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return "s_" + hashlib.sha256(blob.encode()).hexdigest()[:20]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "x": list(self.x),
            "y": list(self.y),
            "x_unit": self.x_unit,
            "y_unit": self.y_unit,
            "x_label": self.x_label,
            "y_label": self.y_label,
            "n": self.n,
            "provenance": self.provenance.to_dict(),
        }
