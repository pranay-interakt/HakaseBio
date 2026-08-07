"""The ``DispositionParameters`` contract — the plug interface between the
disposition front-end (IVIVE, per-modality) and the tissue-PBPK ODE (kernel).

This is Stage-1 task S1-T1 of the PBPK layer (see ``docs/pbpk-layer.md`` Part 6).
It defines *only* the data shape; no science is computed here. The disposition
producer (``modalities/small-molecule/.../disposition.py``, S1-T6) fills it in;
the Stage-2 kernel ODE (S2-T1) consumes it as its single source of truth for
clearance, binding, and partitioning.

Design constraints this file must honour (``docs/pbpk-layer.md`` §5.1):

  1. **Common-core + modality-extension**, never a small-molecule-shaped struct.
     Small molecules fill the core (and leave the extension empty); mAbs will add
     FcRn/TMDD terms and nucleic acids delivery-vehicle terms into the extension
     slot — without the core ever needing to know about them.
  2. **Every numeric field carries the full provenance envelope**
     ``{value, ci_low, ci_high, provenance, source, units}`` — a point estimate
     with its interval, where the number came from, and its units. This mirrors
     the existing IVIVE no-fallback / provenance contract (a value is either
     measured, ML-predicted, a cited reference, an explicit assumption, or
     derived from other such values — never a silent guess). Confidence bounds
     are *optional* at this stage: the deterministic point estimate exists from
     S1-T5, and Monte-Carlo intervals are attached later; an absent bound is
     honestly ``None`` rather than a fabricated tight interval.

Kernel policy: this module is modality-agnostic — pure stdlib, no RDKit, no
SMILES, no numpy. It is a contract, not an engine.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Provenance(str, Enum):
    """Where a quantity's value came from.

    The vocabulary matches the existing IVIVE provenance contract
    (``pk_ivive.py``) and extends it with ``DERIVED`` for quantities computed
    from other envelope-carrying quantities (e.g. ``cl_total = cl_hepatic +
    cl_renal``, or a Kp-derived ``Vss``). Precedence, high to low:
    ``MEASURED`` > ``ML`` > ``REFERENCE`` / ``ASSUMED`` — with ``DERIVED``
    inheriting the weakest provenance of its inputs.
    """

    MEASURED = "measured"
    ML = "ml"
    REFERENCE = "reference"
    ASSUMED = "assumed"
    DERIVED = "derived"


_ALLOWED_PROVENANCE = frozenset(p.value for p in Provenance)

# Canonical key order for a serialised quantity, per docs/pbpk-layer.md §4.2.
_QUANTITY_KEYS = ("value", "ci_low", "ci_high", "provenance", "source", "units")


@dataclass(frozen=True)
class Quantity:
    """A single numeric field with its full provenance envelope.

    ``value`` is the deterministic point estimate; ``ci_low``/``ci_high`` are the
    optional confidence bounds (both ``None`` until an interval is computed).
    ``provenance`` is one of :class:`Provenance`; ``source`` is a human-readable
    citation/derivation note; ``units`` names the physical units.
    """

    value: float
    units: str
    provenance: str
    source: str
    ci_low: float | None = None
    ci_high: float | None = None

    def __post_init__(self) -> None:
        # Normalise provenance to a plain str (accepts a Provenance member too),
        # then enforce the controlled vocabulary — a value must declare where it
        # came from; there is no unlabelled number.
        prov = self.provenance.value if isinstance(self.provenance, Provenance) else self.provenance
        object.__setattr__(self, "provenance", str(prov))
        if self.provenance not in _ALLOWED_PROVENANCE:
            raise ValueError(
                f"provenance must be one of {sorted(_ALLOWED_PROVENANCE)}, got {self.provenance!r}"
            )
        if not self.units:
            raise ValueError("units must be a non-empty string")
        if not self.source:
            raise ValueError("source must be a non-empty string")
        if not isinstance(self.value, (int, float)):
            raise ValueError(f"value must be numeric, got {type(self.value).__name__}")
        # Coerce ints to float so the envelope is uniformly float-typed.
        object.__setattr__(self, "value", float(self.value))
        if self.ci_low is not None:
            object.__setattr__(self, "ci_low", float(self.ci_low))
        if self.ci_high is not None:
            object.__setattr__(self, "ci_high", float(self.ci_high))
        self._validate_interval()

    def _validate_interval(self) -> None:
        lo, hi, val = self.ci_low, self.ci_high, self.value
        # Only order-check when the relevant numbers are present and finite; a
        # NaN sentinel (e.g. indeterminate value) or a one-sided bound is allowed
        # to pass through rather than being rejected.
        if lo is not None and hi is not None and math.isfinite(lo) and math.isfinite(hi):
            if lo > hi:
                raise ValueError(f"ci_low ({lo}) must be <= ci_high ({hi})")
        if math.isfinite(val):
            if lo is not None and math.isfinite(lo) and lo > val:
                raise ValueError(f"ci_low ({lo}) must be <= value ({val})")
            if hi is not None and math.isfinite(hi) and hi < val:
                raise ValueError(f"ci_high ({hi}) must be >= value ({val})")

    def to_dict(self) -> dict[str, Any]:
        """Serialise in the canonical ``value, ci_low, ci_high, provenance,
        source, units`` key order (JSON-friendly for the service endpoint)."""
        return {
            "value": self.value,
            "ci_low": self.ci_low,
            "ci_high": self.ci_high,
            "provenance": self.provenance,
            "source": self.source,
            "units": self.units,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Quantity:
        """Inverse of :meth:`to_dict`; ignores unknown keys defensively."""
        return cls(
            value=data["value"],
            units=data["units"],
            provenance=data["provenance"],
            source=data["source"],
            ci_low=data.get("ci_low"),
            ci_high=data.get("ci_high"),
        )


@dataclass(frozen=True)
class SpeciesContext:
    """The (species, strain, sex, age, body weight) the disposition was computed
    for. A context label, not a predicted quantity — so it carries no interval.

    The physiology store (S1-T2) is the source of these; here they are recorded
    so a consumer knows which animal the parameters describe.
    """

    species: str
    strain: str | None = None
    sex: str | None = None
    age: str | None = None
    body_weight_kg: float | None = None

    def __post_init__(self) -> None:
        if not self.species:
            raise ValueError("species must be a non-empty string")
        if self.body_weight_kg is not None:
            bw = float(self.body_weight_kg)
            if not (bw > 0):
                raise ValueError(f"body_weight_kg must be > 0, got {bw}")
            object.__setattr__(self, "body_weight_kg", bw)

    def to_dict(self) -> dict[str, Any]:
        return {
            "species": self.species,
            "strain": self.strain,
            "sex": self.sex,
            "age": self.age,
            "body_weight_kg": self.body_weight_kg,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SpeciesContext:
        return cls(
            species=data["species"],
            strain=data.get("strain"),
            sex=data.get("sex"),
            age=data.get("age"),
            body_weight_kg=data.get("body_weight_kg"),
        )


class DomainVerdict(str, Enum):
    """Applicability-domain gate outcome (the OOD gating of S1-T4)."""

    IN = "in"
    EDGE = "edge"
    OUT = "out"


_ALLOWED_VERDICTS = frozenset(v.value for v in DomainVerdict)


@dataclass(frozen=True)
class ApplicabilityDomain:
    """Whether the query compound is in / at the edge of / out of the domain the
    underlying ADMET models were trained on.

    This is the contract-side representation only; the actual gate is computed by
    ``platform/kernel/.../uncertainty`` (S1-T4). ``verdict`` drives the
    no-fallback envelope — an ``OUT`` verdict lets the producer refuse rather than
    return a confidently-wrong number.
    """

    verdict: str
    score: float | None = None
    threshold: float | None = None
    rationale: str | None = None

    def __post_init__(self) -> None:
        verdict = self.verdict.value if isinstance(self.verdict, DomainVerdict) else self.verdict
        object.__setattr__(self, "verdict", str(verdict))
        if self.verdict not in _ALLOWED_VERDICTS:
            raise ValueError(
                f"verdict must be one of {sorted(_ALLOWED_VERDICTS)}, got {self.verdict!r}"
            )
        if self.score is not None:
            object.__setattr__(self, "score", float(self.score))
        if self.threshold is not None:
            object.__setattr__(self, "threshold", float(self.threshold))

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "score": self.score,
            "threshold": self.threshold,
            "rationale": self.rationale,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ApplicabilityDomain:
        return cls(
            verdict=data["verdict"],
            score=data.get("score"),
            threshold=data.get("threshold"),
            rationale=data.get("rationale"),
        )


@dataclass(frozen=True)
class ModalityExtension:
    """The modality-specific slot of the contract (§5.1 requirement 1).

    Small molecules leave this empty; other modalities add their own
    envelope-carrying quantities (mAbs: FcRn/TMDD terms; nucleic acids:
    delivery-vehicle terms) under ``parameters``, plus any non-numeric context
    under ``metadata``. The common core never needs to know these keys exist.
    """

    modality: str
    parameters: dict[str, Quantity] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.modality:
            raise ValueError("modality must be a non-empty string")
        for key, qty in self.parameters.items():
            if not isinstance(qty, Quantity):
                raise ValueError(f"extension parameter {key!r} must be a Quantity, got {type(qty)}")

    def is_empty(self) -> bool:
        """True when no modality-specific parameters or metadata are present
        (the small-molecule case)."""
        return not self.parameters and not self.metadata

    def to_dict(self) -> dict[str, Any]:
        return {
            "modality": self.modality,
            "parameters": {k: q.to_dict() for k, q in self.parameters.items()},
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ModalityExtension:
        params = {k: Quantity.from_dict(v) for k, v in (data.get("parameters") or {}).items()}
        return cls(
            modality=data["modality"],
            parameters=params,
            metadata=dict(data.get("metadata") or {}),
        )


@dataclass(frozen=True)
class DispositionParameters:
    """The complete disposition contract handed from the front-end to the PBPK
    ODE: fraction unbound, blood/plasma partitioning, the clearance split,
    per-organ partition coefficients, distribution volume, first-pass terms, the
    species it was computed for, its applicability-domain verdict, and a
    modality-extension slot.

    Every numeric field is a :class:`Quantity` carrying the full
    ``{value, ci_low, ci_high, provenance, source, units}`` envelope. ``kp`` is a
    per-organ mapping of such quantities (organ name -> partition coefficient).
    """

    # --- common core (modality-agnostic) ---
    fu_plasma: Quantity
    fu_blood: Quantity
    blood_plasma_ratio: Quantity
    cl_hepatic: Quantity
    cl_renal: Quantity
    cl_total: Quantity
    kp: dict[str, Quantity]
    vdss: Quantity
    extraction_ratio: Quantity
    hepatic_first_pass: Quantity
    species_context: SpeciesContext
    applicability_domain: ApplicabilityDomain

    # --- modality-extension slot (empty for small molecules) ---
    modality_extension: ModalityExtension

    def __post_init__(self) -> None:
        for organ, qty in self.kp.items():
            if not isinstance(qty, Quantity):
                raise ValueError(f"kp[{organ!r}] must be a Quantity, got {type(qty)}")

    def to_dict(self) -> dict[str, Any]:
        """Serialise the whole contract to nested plain dicts (JSON-friendly)."""
        return {
            "fu_plasma": self.fu_plasma.to_dict(),
            "fu_blood": self.fu_blood.to_dict(),
            "blood_plasma_ratio": self.blood_plasma_ratio.to_dict(),
            "cl_hepatic": self.cl_hepatic.to_dict(),
            "cl_renal": self.cl_renal.to_dict(),
            "cl_total": self.cl_total.to_dict(),
            "kp": {organ: q.to_dict() for organ, q in self.kp.items()},
            "vdss": self.vdss.to_dict(),
            "extraction_ratio": self.extraction_ratio.to_dict(),
            "hepatic_first_pass": self.hepatic_first_pass.to_dict(),
            "species_context": self.species_context.to_dict(),
            "applicability_domain": self.applicability_domain.to_dict(),
            "modality_extension": self.modality_extension.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DispositionParameters:
        """Inverse of :meth:`to_dict`; reconstructs an equal instance."""
        return cls(
            fu_plasma=Quantity.from_dict(data["fu_plasma"]),
            fu_blood=Quantity.from_dict(data["fu_blood"]),
            blood_plasma_ratio=Quantity.from_dict(data["blood_plasma_ratio"]),
            cl_hepatic=Quantity.from_dict(data["cl_hepatic"]),
            cl_renal=Quantity.from_dict(data["cl_renal"]),
            cl_total=Quantity.from_dict(data["cl_total"]),
            kp={organ: Quantity.from_dict(q) for organ, q in data["kp"].items()},
            vdss=Quantity.from_dict(data["vdss"]),
            extraction_ratio=Quantity.from_dict(data["extraction_ratio"]),
            hepatic_first_pass=Quantity.from_dict(data["hepatic_first_pass"]),
            species_context=SpeciesContext.from_dict(data["species_context"]),
            applicability_domain=ApplicabilityDomain.from_dict(data["applicability_domain"]),
            modality_extension=ModalityExtension.from_dict(data["modality_extension"]),
        )


__all__ = [
    "Provenance",
    "Quantity",
    "SpeciesContext",
    "DomainVerdict",
    "ApplicabilityDomain",
    "ModalityExtension",
    "DispositionParameters",
]
