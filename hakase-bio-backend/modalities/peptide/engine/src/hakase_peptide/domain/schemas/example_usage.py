"""
Minimal worked example: constructing a valid PhysicochemicalEvidence object.

Run locally (after `pip install pydantic`) with:
    python -m hakase_evidence_schemas.example_usage

This is meant as a smoke test / usage reference, not fixture data for tests.
"""

from __future__ import annotations

import uuid

from .common import ConfidenceTier, FieldConfidence, MetadataBlock, ValueConfidence
from .physicochemical import (
    ChargeDistribution,
    CompositionalStatistics,
    Descriptors,
    Embeddings,
    EmbeddingVector,
    HydrophobicityProfile,
    HydrophobicMoment,
    InstabilityIndex,
    NetChargeByPh,
    PhysicochemicalConfidenceSummary,
    PhysicochemicalEvidence,
    PhysicochemicalProvenance,
)


def build_example() -> PhysicochemicalEvidence:
    peptide_id = uuid.uuid4()
    execution_id = uuid.uuid4()

    exact = FieldConfidence(tier=ConfidenceTier.EXACT, numerical_confidence=1.0)

    descriptors = Descriptors(
        molecular_weight=ValueConfidence(value=1234.5, confidence=exact),
        isoelectric_point=ValueConfidence(value=8.2, confidence=exact),
        net_charge_by_ph=NetChargeByPh(profile={"7.4": 2.1}, confidence=exact),
        gravy_score=ValueConfidence(value=-0.42, confidence=exact),
        hydrophobicity_profile=HydrophobicityProfile(
            windowed_values=[-0.3, -0.1, 0.4], window_size=7, confidence=exact
        ),
        hydrophobic_moment=HydrophobicMoment(
            value=0.61, assumed_periodicity_degrees=100.0, confidence=exact
        ),
        charge_distribution=ChargeDistribution(profile=[1, 0, 1, -1], confidence=exact),
        instability_index=InstabilityIndex(value=32.1, classification="stable", confidence=exact),
        aliphatic_index=ValueConfidence(value=70.0, confidence=exact),
        aromaticity=ValueConfidence(value=0.05, confidence=exact),
        boman_index=ValueConfidence(value=1.8, confidence=exact),
        compositional_statistics=CompositionalStatistics(
            aa_frequencies={"A": 0.1, "L": 0.2},
            dipeptide_frequencies={"AL": 0.05},
            cys_count=0,
            pro_content=0.0,
            gly_content=0.1,
            confidence=exact,
        ),
    )

    embeddings = Embeddings(
        pooled_vector=EmbeddingVector(
            dimension=1280,
            confidence=FieldConfidence(tier=ConfidenceTier.HIGH, numerical_confidence=0.9),
            storage_uri="s3://hakase/embeddings/example_pooled.npy",
        ),
        per_residue_matrix=EmbeddingVector(
            dimension=1280,
            confidence=FieldConfidence(tier=ConfidenceTier.HIGH, numerical_confidence=0.9),
            storage_uri="s3://hakase/embeddings/example_per_residue.npy",
        ),
    )

    evidence = PhysicochemicalEvidence(
        header=PhysicochemicalEvidence.new_header(subject_id=peptide_id, execution_id=execution_id),
        peptide_object_reference=peptide_id,
        descriptors=descriptors,
        embeddings=embeddings,
        provenance=PhysicochemicalProvenance(
            originating_service="physicochemical-service",
            algorithms=["ProtParam", "Eisenberg-hydrophobic-moment"],
            originating_modules=[
                "sequence_validation",
                "descriptor_calculator",
                "feature_generator",
                "evidence_generator",
            ],
            embedding_model_identifier_and_version="ESM-2:esm2_t33_650M_UR50D",
            reference_parameter_sets={"hydrophobicity_scale": "Kyte-Doolittle"},
        ),
        confidence_summary=PhysicochemicalConfidenceSummary(
            deterministic_tier=exact,
            embedding_tier=FieldConfidence(tier=ConfidenceTier.HIGH, numerical_confidence=0.9),
            aggregate_note="Deterministic descriptors exact; embedding tier reflects "
            "standard ESM-2 domain coverage for this sequence length.",
        ),
        metadata=MetadataBlock(
            platform_version="3.0.0",
            service_version="1.0.0",
            model_versions={"ESM-2": "esm2_t33_650M_UR50D"},
            configuration_hash="sha256:example",
            execution_environment="k8s-gpu-pool-a",
        ),
    )
    return evidence


if __name__ == "__main__":
    ev = build_example()
    print(ev.model_dump_json(indent=2)[:2000], "...")
    print("\nValid PhysicochemicalEvidence object constructed successfully.")
