"""
Structural Evidence Object.

Source: 08_Structural_Biology_Service_Specification.md, Section 14.
"""

from __future__ import annotations

import uuid
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from .common import EvidenceObjectBase, FieldConfidence, ProvenanceBase

StructuralModule = Literal[
    "triage",
    "structure_prediction",
    "complex_modeling",
    "interface_analysis",
    "confidence_assessment",
    "evidence_generator",
]

InteractionType = Literal["hydrogen_bond", "electrostatic", "hydrophobic", "aromatic_stacking"]
PLDDTConfidenceCategory = Literal["very_high", "confident", "low", "very_low"]
IsolatedStructureStatus = Literal["available", "unavailable", "partial", "error"]


class PerResidueConfidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: int = Field(ge=1, description="1-based residue position in the input sequence.")
    residue: str = Field(min_length=1, max_length=1)
    plddt: float = Field(ge=0.0, le=100.0, description="Normalized pLDDT on the 0-100 scale.")
    confidence_category: PLDDTConfidenceCategory


class LowConfidenceRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: int = Field(ge=1, description="1-based inclusive start position.")
    end: int = Field(ge=1, description="1-based inclusive end position.")
    length: int = Field(ge=1)
    mean_plddt: float = Field(ge=0.0, le=100.0)
    minimum_plddt: float = Field(ge=0.0, le=100.0)
    residues: str
    severity: Literal["low", "very_low"]


class PerResidueConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    total_residues: int = Field(ge=0)
    category_counts: dict[PLDDTConfidenceCategory, int] | None = None
    category_fractions: dict[PLDDTConfidenceCategory, float] | None = None
    low_confidence_residue_count: int | None = Field(default=None, ge=0)
    low_confidence_residue_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    low_confidence_region_count: int | None = Field(default=None, ge=0)
    mean_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    minimum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    maximum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    plddt_scale: Literal["0-100"]


class StructuralProvenance(ProvenanceBase):
    originating_modules: list[StructuralModule] = Field(default_factory=list)
    model_identifier_and_version: list[str] = Field(
        default_factory=list,
        description="e.g. ['Boltz-2:v1.4', 'AutoDock-Vina:v1.2.5'] per §14.",
    )
    reference_structures_used: list[str] = Field(
        default_factory=list, description="PDB / AlphaFold DB identifiers, if any."
    )


class StructuralClassification(BaseModel):
    """Triage result -- determines downstream structural modeling strategy."""

    model_config = ConfigDict(extra="forbid")

    triage_result: Literal["rigid", "constrained", "flexible_disordered"]
    confidence: FieldConfidence


class CoordinateSet(BaseModel):
    """A single structure or an ensemble of k samples. Coordinates themselves
    live in Object Storage (PDB/mmCIF files); this carries a reference."""

    model_config = ConfigDict(extra="forbid")

    storage_uri: str = Field(description="e.g. 's3://hakase/structures/{evidence_id}/model_1.pdb'")
    ensemble_size: int = Field(default=1, ge=1)


class IsolatedStructurePrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    model_id: str
    model_version: str
    n_residues: int = Field(ge=0)
    mean_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    plddt_scale: Literal["0-100"]
    raw_plddt_scale: str


class IsolatedStructureGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    n_residues: int = Field(ge=0)
    mean_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    minimum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    maximum_plddt: float | None = Field(default=None, ge=0.0, le=100.0)
    plddt_scale: Literal["0-100"]
    confident_residue_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    radius_of_gyration_angstrom: float | None = Field(default=None, ge=0.0)
    end_to_end_distance_angstrom: float | None = Field(default=None, ge=0.0)
    compactness_ratio: float | None = Field(default=None, ge=0.0)
    disulfide_geometry: list[dict[str, object]] = Field(default_factory=list)


class IsolatedStructureConfidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    per_residue: list[PerResidueConfidence] = Field(default_factory=list)
    low_confidence_regions: list[LowConfidenceRegion] = Field(default_factory=list)
    summary: PerResidueConfidenceSummary


class IsolatedStructureProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    model_id: str
    model_version: str
    plddt_scale: Literal["0-100"]
    raw_plddt_scale: str | None = None


class IsolatedStructureLimitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    description: str


class IsolatedStructure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: IsolatedStructureStatus
    reason_code: str | None = None
    reason_detail: str | None = None
    prediction: IsolatedStructurePrediction | None = None
    geometry: IsolatedStructureGeometry | None = Field(
        default=None, description="Coordinate-derived geometry; Angstrom fields use Angstrom units."
    )
    confidence: IsolatedStructureConfidence | None = None
    provenance: IsolatedStructureProvenance
    limitations: list[IsolatedStructureLimitation] = Field(default_factory=list)


class ComplexPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    present: bool
    coordinate_set: CoordinateSet | None = None
    modeling_approach: Literal["co_folding", "docking"] | None = None
    pairwise_confidence_matrix_uri: str | None = Field(
        default=None,
        description="Reference to a PAE-like NxN matrix, stored as an object "
        "rather than inlined (may be large for long sequences).",
    )
    pairwise_confidence_summary: FieldConfidence | None = None
    modeling_method: str | None = Field(default=None, description="Modeling engine and version.")


class InterfaceAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    present: bool
    contact_residues: dict[str, list[int]] = Field(
        default_factory=dict, description="partner_id -> list of residue indices."
    )
    interaction_types: list[InteractionType] = Field(default_factory=list)
    buried_surface_area: float | None = Field(default=None, description="Angstrom^2.")
    shape_complementarity: float | None = None


class StructuralConfidenceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    structural_tier: FieldConfidence
    interface_tier: FieldConfidence | None = None
    aggregate_note: str | None = None


class StructuralEvidence(EvidenceObjectBase):
    """Structural Evidence Object -- Structural Biology Service Spec §14.
    Published per peptide, or per peptide-target pair where applicable."""

    EVIDENCE_TYPE: ClassVar[str] = "structural"
    PRODUCING_SERVICE: ClassVar[str] = "structural-biology-service"

    peptide_object_reference: uuid.UUID
    target_reference: uuid.UUID | None = Field(
        default=None, description="None => 'not_applicable' per §14."
    )
    structural_classification: StructuralClassification
    isolated_structure: IsolatedStructure
    complex_prediction: ComplexPrediction
    interface_analysis: InterfaceAnalysis
    provenance: StructuralProvenance
    confidence_summary: StructuralConfidenceSummary
