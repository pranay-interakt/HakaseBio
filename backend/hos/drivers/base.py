"""The StudyDriver interface and the documents a driver produces.

Lifecycle of a study through its driver::

    design()               -> ProtocolDocument   (DESIGNED)
    plan()                 -> StudyPlan          (PLANNED)
    instruction_package()  -> InstructionPackage (sent to the lab on DISPATCHED)
    data_template()        -> DataTemplate       (what the lab must return)
    ingest(raw file)       -> IngestedData       (DATA_RECEIVED)
    analyze()              -> AnalysisResult     (ANALYZED)
    interpret()            -> Interpretation     (cited statements only)
    report()               -> StudyReport        (REPORTED)
    simulate()             -> raw file bytes     (verification data, SIMULATED)
"""

from __future__ import annotations

import csv
import io
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar, Optional, Sequence

from pydantic import BaseModel

from hos.core.provenance import Citation
from hos.core.qc import QCVerdict
from hos.core.regulatory.context import Modality, ProgramContext

__all__ = [
    "ProtocolStep",
    "AcceptanceCriterion",
    "ProtocolDocument",
    "StudyPlan",
    "InstructionPackage",
    "DataColumn",
    "DataTemplate",
    "IngestedData",
    "AnalysisResult",
    "InterpretiveStatement",
    "Interpretation",
    "ReportSection",
    "StudyReport",
    "CompoundInfo",
    "StudyDriver",
    "IngestError",
]


class IngestError(ValueError):
    """Returned data does not satisfy the driver's data template."""


@dataclass(frozen=True, slots=True)
class CompoundInfo:
    """The compound facts a driver may need (passed in by the kernel)."""

    id: str
    name: str
    smiles: str
    molecular_weight: Optional[float] = None
    clogp: Optional[float] = None
    profile: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ProtocolStep:
    number: int
    title: str
    instruction: str
    critical_parameters: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {"number": self.number, "title": self.title, "instruction": self.instruction,
                "critical_parameters": list(self.critical_parameters)}


@dataclass(frozen=True, slots=True)
class AcceptanceCriterion:
    code: str
    description: str
    basis: str

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "description": self.description, "basis": self.basis}


@dataclass(frozen=True, slots=True)
class ProtocolDocument:
    """A structured, executable, versioned protocol."""

    title: str
    objective: str
    hypothesis: Optional[str]
    test_article: dict[str, Any]
    test_system: dict[str, Any]
    design: dict[str, Any]
    steps: tuple[ProtocolStep, ...]
    acceptance_criteria: tuple[AcceptanceCriterion, ...]
    materials: tuple[str, ...]
    deliverables: tuple[str, ...]
    glp: bool
    references: tuple[Citation, ...]
    regulatory_basis: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "objective": self.objective,
            "hypothesis": self.hypothesis,
            "test_article": self.test_article,
            "test_system": self.test_system,
            "design": self.design,
            "steps": [s.to_dict() for s in self.steps],
            "acceptance_criteria": [a.to_dict() for a in self.acceptance_criteria],
            "materials": list(self.materials),
            "deliverables": list(self.deliverables),
            "glp": self.glp,
            "references": [c.to_dict() for c in self.references],
            "regulatory_basis": list(self.regulatory_basis),
        }


@dataclass(frozen=True, slots=True)
class StudyPlan:
    """Logistics for a study. Durations are the protocol's own timings; cost is
    deliberately *not* estimated by the system, because price is a quote from a
    named laboratory, not a property of the science."""

    in_life_or_bench_duration_days: float
    reporting_allowance_days: Optional[float]
    sample_count: int
    dependencies: tuple[str, ...]
    material_requirements: tuple[str, ...]
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "in_life_or_bench_duration_days": self.in_life_or_bench_duration_days,
            "reporting_allowance_days": self.reporting_allowance_days,
            "sample_count": self.sample_count,
            "dependencies": list(self.dependencies),
            "material_requirements": list(self.material_requirements),
            "notes": list(self.notes),
            "cost": None,
            "cost_note": "obtain a quote from the executing laboratory; not estimated by the system",
        }


@dataclass(frozen=True, slots=True)
class DataColumn:
    name: str
    unit: Optional[str]
    description: str
    required: bool = True
    kind: str = "number"  # number | text | integer

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "unit": self.unit, "description": self.description,
                "required": self.required, "kind": self.kind}


@dataclass(frozen=True, slots=True)
class DataTemplate:
    """The exact form in which results must be returned (CSV)."""

    format: str
    columns: tuple[DataColumn, ...]
    description: str
    example_rows: tuple[dict[str, Any], ...] = ()

    def header(self) -> list[str]:
        return [c.name for c in self.columns]

    def csv_template(self) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(self.header())
        return buf.getvalue()

    def to_dict(self) -> dict[str, Any]:
        return {"format": self.format, "columns": [c.to_dict() for c in self.columns],
                "description": self.description, "csv_header": self.header()}


@dataclass(frozen=True, slots=True)
class InstructionPackage:
    """Everything an executing laboratory needs. Rendered as the dispatch document."""

    study_title: str
    protocol: ProtocolDocument
    data_template: DataTemplate
    sample_manifest: tuple[dict[str, Any], ...]
    return_instructions: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "study_title": self.study_title,
            "protocol": self.protocol.to_dict(),
            "data_template": self.data_template.to_dict(),
            "sample_manifest": list(self.sample_manifest),
            "return_instructions": self.return_instructions,
        }


@dataclass(frozen=True, slots=True)
class IngestedData:
    """Validated, structured data parsed from a returned file."""

    records: tuple[dict[str, Any], ...]
    provenance_kind: str           # measured | simulated
    source_description: str
    file_sha256: str
    warnings: tuple[str, ...] = ()

    @property
    def is_simulated(self) -> bool:
        return self.provenance_kind == "simulated"

    def to_dict(self) -> dict[str, Any]:
        return {
            "records": list(self.records),
            "n_records": len(self.records),
            "provenance_kind": self.provenance_kind,
            "source_description": self.source_description,
            "file_sha256": self.file_sha256,
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True, slots=True)
class AnalysisResult:
    """Provenance-typed results of a driver's analysis."""

    summary: dict[str, Any]          # key -> Quantity.to_dict() or plain metadata
    detail: dict[str, Any]
    qc: QCVerdict
    evidence_admissible: bool

    def to_dict(self) -> dict[str, Any]:
        return {"summary": self.summary, "detail": self.detail, "qc": self.qc.to_dict(),
                "evidence_admissible": self.evidence_admissible}


@dataclass(frozen=True, slots=True)
class InterpretiveStatement:
    """One conclusion. Every statement names the rule and citation it rests on."""

    statement: str
    basis: str
    citation_keys: tuple[str, ...]
    severity: str = "info"  # info | notable | concern

    def to_dict(self) -> dict[str, Any]:
        return {"statement": self.statement, "basis": self.basis,
                "citation_keys": list(self.citation_keys), "severity": self.severity}


@dataclass(frozen=True, slots=True)
class Interpretation:
    statements: tuple[InterpretiveStatement, ...]
    requires_expert_judgement: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {"statements": [s.to_dict() for s in self.statements],
                "requires_expert_judgement": list(self.requires_expert_judgement)}


@dataclass(frozen=True, slots=True)
class ReportSection:
    heading: str
    body: str
    tables: tuple[dict[str, Any], ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {"heading": self.heading, "body": self.body, "tables": list(self.tables)}


@dataclass(frozen=True, slots=True)
class StudyReport:
    title: str
    ctd_section: str
    sections: tuple[ReportSection, ...]
    evidence_admissible: bool
    disclaimer: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {"title": self.title, "ctd_section": self.ctd_section,
                "sections": [s.to_dict() for s in self.sections],
                "evidence_admissible": self.evidence_admissible, "disclaimer": self.disclaimer}


SIMULATION_DISCLAIMER = (
    "THIS REPORT CONTAINS SIMULATED DATA generated by a declared model for software "
    "verification and workflow demonstration. It is not a measurement and is not "
    "admissible as evidence in any regulatory submission."
)


class StudyDriver(ABC):
    """Base class every study driver implements."""

    id: ClassVar[str]
    name: ClassVar[str]
    version: ClassVar[str]
    requirement_ids: ClassVar[tuple[str, ...]]
    modalities: ClassVar[frozenset[Modality]]
    ctd_section: ClassVar[str]
    glp_capable: ClassVar[bool] = False
    description: ClassVar[str] = ""

    # -- design ---------------------------------------------------------------

    @classmethod
    @abstractmethod
    def parameters_model(cls) -> type[BaseModel]:
        """Pydantic model describing (and validating) the design parameters."""

    @abstractmethod
    def design(self, compound: CompoundInfo, params: BaseModel,
               context: Optional[ProgramContext] = None,
               hypothesis: Optional[str] = None) -> ProtocolDocument: ...

    @abstractmethod
    def plan(self, protocol: ProtocolDocument, params: BaseModel) -> StudyPlan: ...

    @abstractmethod
    def data_template(self, params: BaseModel) -> DataTemplate: ...

    def instruction_package(self, protocol: ProtocolDocument, params: BaseModel,
                            compound: CompoundInfo) -> InstructionPackage:
        template = self.data_template(params)
        return InstructionPackage(
            study_title=protocol.title,
            protocol=protocol
