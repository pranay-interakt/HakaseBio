"""Execution target implementations. See package docstring."""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pydantic import BaseModel

from hos.core.provenance import utc_now
from hos.drivers.base import (
    CompoundInfo,
    DataOrigin,
    InstructionPackage,
    SimulatedDataset,
    StudyDriver,
)
from hos.kernel.errors import KernelError

__all__ = [
    "DispatchRecord",
    "DispatchStatus",
    "ExecutionTarget",
    "ExternalLabTarget",
    "InHouseTarget",
    "SimulationTarget",
    "TargetKind",
    "target_from_spec",
]


class TargetKind(str, Enum):
    EXTERNAL_LAB = "external_lab"
    IN_HOUSE = "in_house"
    SIMULATION = "simulation"


class DispatchStatus(str, Enum):
    AWAITING_DATA = "awaiting_data"
    DATA_AVAILABLE = "data_available"


@dataclass(frozen=True, slots=True)
class DispatchRecord:
    """What was sent where, when, and what data origin the kernel must expect back."""

    target: Mapping[str, Any]
    target_kind: TargetKind
    dispatched_at: str
    bundle: bytes
    bundle_sha256: str
    protocol_hash: str
    status: DispatchStatus
    expected_origin: DataOrigin
    simulated: SimulatedDataset | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "target": dict(self.target),
            "target_kind": self.target_kind.value,
            "dispatched_at": self.dispatched_at,
            "bundle_sha256": self.bundle_sha256,
            "protocol_hash": self.protocol_hash,
            "status": self.status.value,
            "expected_origin": self.expected_origin.value,
            "simulation": self.simulated.to_dict() if self.simulated else None,
            "notes": list(self.notes),
        }


class ExecutionTarget(ABC):
    kind: TargetKind

    @abstractmethod
    def spec(self) -> dict[str, Any]:
        """Serialisable description, enough to reconstruct the target."""

    def dispatch(self, package: InstructionPackage, *, driver: StudyDriver, params: BaseModel,
                 compound: CompoundInfo) -> DispatchRecord:
        bundle = package.to_bundle()
        return DispatchRecord(
            target=self.spec(), target_kind=self.kind, dispatched_at=utc_now().isoformat(),
            bundle=bundle, bundle_sha256=hashlib.sha256(bundle).hexdigest(),
            protocol_hash=package.protocol.content_hash, status=DispatchStatus.AWAITING_DATA,
            expected_origin=DataOrigin.MEASURED, notes=self._notes(),
        )

    def _notes(self) -> tuple[str, ...]:
        return ()


@dataclass(frozen=True)
class ExternalLabTarget(ExecutionTarget):
    """A contract laboratory. ``quote_reference`` is the laboratory's own quote number;
    HOS records it but never estimates a price."""

    laboratory: str
    contact: str | None = None
    quote_reference: str | None = None
    glp_certified: bool | None = None
    kind: TargetKind = TargetKind.EXTERNAL_LAB

    def __post_init__(self) -> None:
        if not self.laboratory.strip():
            raise KernelError("an external laboratory target must name the laboratory")

    def spec(self) -> dict[str, Any]:
        return {"kind": self.kind.value, "laboratory": self.laboratory, "contact": self.contact,
                "quote_reference": self.quote_reference, "glp_certified": self.glp_certified}

    def _notes(self) -> tuple[str, ...]:
        n = ["bundle to be transmitted to the laboratory by the user; HOS does not send it"]
        if self.quote_reference is None:
            n.append("no laboratory quote reference recorded")
        return tuple(n)


@dataclass(frozen=True)
class InHouseTarget(ExecutionTarget):
    laboratory: str
    responsible_scientist: str
    kind: TargetKind = TargetKind.IN_HOUSE

    def __post_init__(self) -> None:
        if not self.laboratory.strip() or not self.responsible_scientist.strip():
            raise KernelError("an in-house target must name the laboratory and the responsible "
                              "scientist")

    def spec(self) -> dict[str, Any]:
        return {"kind": self.kind.value, "laboratory": self.laboratory,
                "responsible_scientist": self.responsible_scientist}


@dataclass(frozen=True)
class SimulationTarget(ExecutionTarget):
    """Runs the driver's declared generator. Data are SIMULATED and never evidence."""

    simulation_parameters: Mapping[str, Any]
    seed: int
    kind: TargetKind = TargetKind.SIMULATION

    def spec(self) -> dict[str, Any]:
        return {"kind": self.kind.value, "simulation_parameters": dict(self.simulation_parameters),
                "seed": self.seed}

    def dispatch(self, package: InstructionPackage, *, driver: StudyDriver, params: BaseModel,
                 compound: CompoundInfo) -> DispatchRecord:
        base = super().dispatch(package, driver=driver, params=params, compound=compound)
        sim = driver.simulate(params, compound, self.simulation_parameters, seed=self.seed,
                              study_reference=package.study_reference)
        return DispatchRecord(
            target=base.target, target_kind=self.kind, dispatched_at=base.dispatched_at,
            bundle=base.bundle, bundle_sha256=base.bundle_sha256,
            protocol_hash=base.protocol_hash, status=DispatchStatus.DATA_AVAILABLE,
            expected_origin=DataOrigin.SIMULATED, simulated=sim,
            notes=("SIMULATED execution: data generated by "
                   f"{sim.method_id} with seed {sim.seed}; not admissible as evidence",),
        )


def target_from_spec(spec: Mapping[str, Any]) -> ExecutionTarget:
    kind = TargetKind(spec.get("kind"))
    if kind is TargetKind.EXTERNAL_LAB:
        return ExternalLabTarget(laboratory=spec.get("laboratory", ""), contact=spec.get("contact"),
                                 quote_reference=spec.get("quote_reference"),
                                 glp_certified=spec.get("glp_certified"))
    if kind is TargetKind.IN_HOUSE:
        return InHouseTarget(laboratory=spec.get("laboratory", ""),
                             responsible_scientist=spec.get("responsible_scientist", ""))
    if "seed" not in spec or "simulation_parameters" not in spec:
        raise KernelError("a simulation target needs simulation_parameters and an explicit seed")
    return SimulationTarget(simulation_parameters=spec["simulation_parameters"],
                            seed=int(spec["seed"]))
