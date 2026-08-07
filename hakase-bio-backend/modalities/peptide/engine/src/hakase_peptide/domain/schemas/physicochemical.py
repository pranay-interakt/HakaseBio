"""Typed Physicochemical Evidence payload — spec §14 ("Evidence Generated").

Ported and adapted from ``Docs/Evidence Object Schemas/physicochemical.py`` and
the ``common.py`` primitives it depends on. Two deliberate deviations from the
architecture-repo original, driven by how the in-backend evidence actually works:

1. ``peptide_object_reference`` is a ``str`` (the platform's deterministic
   ``Peptide.subject_id``, e.g. ``"peptide:ab12…"``), not a ``uuid.UUID``.
2. Only the payload sub-blocks that the Physicochemical Service populates today
   are modeled — the full ``EvidenceObjectBase`` envelope (header, metadata,
   top-level uncertainty) already lives on the dataclass ``EvidenceObject`` and
   is not duplicated here.

Every model uses ``extra="forbid"`` so an unexpected or misspelled key fails
validation rather than passing silently.
"""

from __future__ import annotations

from enum import Enum
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Per-field confidence primitives (spec §10.1 — exact/reduced/unavailable)
# ---------------------------------------------------------------------------


class ConfidenceTier(str, Enum):
    """Qualitative per-descriptor confidence tier.

    Deterministic descriptors carry *no statistical uncertainty*; the only
    question is whether the reference constants exist for the input (§10.1).
    Hence a small ordinal set rather than a continuous probability.
    """

    EXACT = "exact"  # closed-form value, all constants available
    REDUCED = "reduced"  # computed but flagged (e.g. extreme length)
    UNAVAILABLE = "unavailable"  # could not be computed for this input


class FieldConfidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tier: ConfidenceTier
    rationale: str | None = Field(default=None, description="Short justification for this tier.")


class ValueConfidence(BaseModel, Generic[T]):
    """Recurring ``{ value, confidence }`` leaf (spec §14)."""

    model_config = ConfigDict(extra="forbid")

    value: T | None
    confidence: FieldConfidence


# ---------------------------------------------------------------------------
# Descriptor sub-blocks (spec §6 / §14)
# ---------------------------------------------------------------------------


class NetChargeByPhModel(BaseModel):
    """§6.2 — Henderson–Hasselbalch net charge across a pH range."""

    model_config = ConfigDict(extra="forbid")

    profile: dict[str, float] = Field(description="pH (string key, e.g. '7.4') -> net charge Q(p).")
    confidence: FieldConfidence


class HydrophobicityProfileModel(BaseModel):
    """§6.3 — windowed hydrophobicity H_window(k)."""

    model_config = ConfigDict(extra="forbid")

    windowed_values: list[float]
    window_size: int = Field(ge=1, description="Effective window width used.")
    scale: str = "Kyte-Doolittle"
    confidence: FieldConfidence


class HydrophobicMomentModel(BaseModel):
    """§6.4 — Eisenberg hydrophobic moment μH with assumed periodicity."""

    model_config = ConfigDict(extra="forbid")

    value: float | None
    assumed_periodicity_degrees: float = Field(
        description="100 for α-helix, 160-180 for β-strand (§6.4)."
    )
    beta_value: float | None = Field(
        default=None, description="μH at β-strand periodicity (160°), if computed."
    )
    confidence: FieldConfidence


class ChargeDistributionModel(BaseModel):
    """§6.5 — positional charge profile and its variance."""

    model_config = ConfigDict(extra="forbid")

    profile: list[float]
    variance: float = Field(ge=0.0, description="Positional variance of charge sign.")
    confidence: FieldConfidence


class InstabilityIndexModel(BaseModel):
    """§6.6 — Guruprasad instability index. II > 40 => 'unstable'."""

    model_config = ConfigDict(extra="forbid")

    value: float | None
    classification: Literal["stable", "unstable"] | None = None
    confidence: FieldConfidence


class CompositionalStatisticsModel(BaseModel):
    """§6.10 — auxiliary compositional statistics."""

    model_config = ConfigDict(extra="forbid")

    aa_frequencies: dict[str, float]
    dipeptide_frequencies: dict[str, float]
    cys_count: int = Field(ge=0)
    pro_content: float = Field(ge=0.0, le=1.0)
    gly_content: float = Field(ge=0.0, le=1.0)
    confidence: FieldConfidence


class DescriptorsModel(BaseModel):
    """The full deterministic descriptor set (spec §6 / §14)."""

    model_config = ConfigDict(extra="forbid")

    molecular_weight: ValueConfidence[float]  # §6.1
    isoelectric_point: ValueConfidence[float]  # §6.2
    net_charge_by_ph: NetChargeByPhModel  # §6.2
    gravy_score: ValueConfidence[float]  # §6.3
    hydrophobicity_profile: HydrophobicityProfileModel  # §6.3
    hydrophobic_moment: HydrophobicMomentModel  # §6.4
    charge_distribution: ChargeDistributionModel  # §6.5
    instability_index: InstabilityIndexModel  # §6.6
    aliphatic_index: ValueConfidence[float]  # §6.7
    aromaticity: ValueConfidence[float]  # §6.8
    boman_index: ValueConfidence[float]  # §6.9
    compositional_statistics: CompositionalStatisticsModel  # §6.10


# ---------------------------------------------------------------------------
# Embeddings (spec §6.11 / §14) — deferred (M4); emitted as unavailable (§12)
# ---------------------------------------------------------------------------


class EmbeddingVectorModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension: int | None = Field(default=None, ge=1)
    confidence: FieldConfidence
    storage_uri: str | None = None


class EmbeddingsModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pooled_vector: EmbeddingVectorModel
    per_residue_matrix: EmbeddingVectorModel


# ---------------------------------------------------------------------------
# Provenance & confidence summary (spec §14)
# ---------------------------------------------------------------------------


class PhysicochemicalProvenanceModel(BaseModel):
    """§14 provenance sub-block carried inside the typed payload."""

    model_config = ConfigDict(extra="forbid")

    originating_modules: list[str] = Field(default_factory=list)
    model_identifier_and_version: str | None = Field(
        default=None, description="e.g. 'peptide_biochem_engine:1.0.0'."
    )
    embedding_model_identifier_and_version: str | None = None
    reference_parameter_sets: dict[str, str] = Field(
        default_factory=dict,
        description="Scale / pKa / mass-table versions per §6, §14.",
    )


class PhysicochemicalConfidenceSummary(BaseModel):
    """§10.3 / §14 — deterministic vs embedding confidence, reported separately.

    This roll-up NEVER replaces the per-descriptor breakdown; it is a
    convenience for the Decision Layer only (§10.3)."""

    model_config = ConfigDict(extra="forbid")

    deterministic_tier: ConfidenceTier
    embedding_tier: ConfidenceTier
    aggregate_note: str | None = None


# ---------------------------------------------------------------------------
# Top-level typed payload
# ---------------------------------------------------------------------------


class PhysicochemicalTypedPayload(BaseModel):
    """The §14-conforming payload block, validated at build time and stored on
    the dataclass ``EvidenceObject.scientific_payload``."""

    model_config = ConfigDict(extra="forbid")

    peptide_object_reference: str
    descriptors: DescriptorsModel
    embeddings: EmbeddingsModel
    provenance: PhysicochemicalProvenanceModel
    confidence_summary: PhysicochemicalConfidenceSummary
    validation_status: Literal["complete", "partially_complete", "failed"]
