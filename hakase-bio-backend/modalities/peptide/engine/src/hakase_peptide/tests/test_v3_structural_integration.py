from __future__ import annotations

from typing import Any

import pytest
from fastapi.routing import APIRoute
from hakase_kernel.faults import FailureType, ServiceFailure
from hakase_structure.prediction import StructurePrediction

from hakase_peptide.api import get_router
from hakase_peptide.api.router import AnalyzeRequest
from hakase_peptide.domain.evidence import (
    ApplicabilityDomain,
    Confidence,
    EvidenceObject,
    EvidenceTier,
    EvidenceType,
    Provenance,
    Uncertainty,
    ValidationStatus,
)
from hakase_peptide.infrastructure import WorkflowOrchestrator
from hakase_peptide.infrastructure.orchestrator import ExecutionContext
from hakase_peptide.services.structural import StructuralBiologyService

STRUCTURAL_EVIDENCE_KEYS = {
    "status",
    "analysis_scope",
    "isolated_structure",
    "target_resolution",
    "strategy_selection",
    "complex_prediction",
    "interface_analysis",
    "interface_confidence_summary",
    "structural_confidence_summary",
    "provenance",
    "known_limitations",
    "validation_status",
}


def _pdb_for(sequence: str) -> str:
    return "\n".join(
        [
            f"ATOM  {idx:5d}  CA  ALA A{idx:4d}    "
            f"{float(idx):8.3f}{0.0:8.3f}{0.0:8.3f}  1.00 85.00           C"
            for idx, _residue in enumerate(sequence, start=1)
        ]
        + ["END"]
    )


class _RecordingStructureProvider:
    name = "fake_esmfold"
    model_id = "esmfold_v1"
    model_version = "test"
    max_length = 1024

    def __init__(self) -> None:
        self.calls: list[str] = []

    def fold(self, sequence: str) -> StructurePrediction:
        self.calls.append(sequence)
        return StructurePrediction(
            sequence=sequence,
            pdb=_pdb_for(sequence),
            per_residue_plddt=[85.0 for _ in sequence],
            mean_plddt=85.0,
            provider=self.name,
            model_id=self.model_id,
            model_version=self.model_version,
            raw_plddt_scale="0-100",
        )


class _FailingStructureProvider:
    max_length = 1024

    def fold(self, sequence: str) -> StructurePrediction:
        raise ServiceFailure(
            f"test provider unavailable for {sequence}",
            failure_type=FailureType.RECOVERABLE,
            reason_code="test_structure_provider_unavailable",
        )


class _StubService:
    name: str
    evidence_type: EvidenceType
    depends_on: list[EvidenceType]
    payload: dict[str, Any]
    tier = EvidenceTier.ML_MODEL

    def run(self, context: ExecutionContext) -> EvidenceObject:
        return EvidenceObject(
            evidence_type=self.evidence_type,
            producing_service=self.name,
            subject_id=context.peptide.subject_id,
            execution_id=context.execution_id,
            scientific_payload=self.payload,
            confidence=Confidence.make(0.9, "test_stub"),
            uncertainty=Uncertainty(model_uncertainty=0.1, sources=["test_stub"]),
            applicability_domain=ApplicabilityDomain(in_domain=True),
            validation_status=ValidationStatus.INTERNALLY_VALIDATED,
            provenance=Provenance(
                originating_service=self.name,
                upstream_evidence_ids=[
                    ev.evidence_id
                    for ev in context._evidence.values()
                    if ev.evidence_type in self.depends_on
                ],
            ),
            evidence_tier=self.tier,
        )


class _PhysicochemicalStub(_StubService):
    name = "physicochemical_service"
    evidence_type = EvidenceType.PHYSICOCHEMICAL
    depends_on = []
    tier = EvidenceTier.DETERMINISTIC
    payload = {
        "status": "available",
        "validation_status": "complete",
        "physicochemical": {
            "instability_index": 20.0,
            "net_charge_pH7": 4.0,
            "hydrophobic_moment": 0.8,
            "sequence_length": 9,
        },
        "confidence_summary": {"aggregate_tier": "exact"},
    }


class _FunctionalStub(_StubService):
    name = "functional_analysis_service"
    evidence_type = EvidenceType.FUNCTIONAL
    depends_on = [EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL]
    payload = {
        "antimicrobial": {"probability": 0.9},
        "cell_permeability": {"probability": 0.3},
        "receptor_engagement": {"receptor_engagement_score": 6},
    }


class _DevelopabilityStub(_StubService):
    name = "developability_service"
    evidence_type = EvidenceType.DEVELOPABILITY
    depends_on = [EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL]
    tier = EvidenceTier.DETERMINISTIC
    payload = {
        "solubility": {"camsol_score": 0.5},
        "aggregation": {"mean_a3v": -0.05},
        "synthesis": {"difficulty_score": 3},
        "stability": {"instability_index": 20.0},
    }


class _SafetyStub(_StubService):
    name = "safety_service"
    evidence_type = EvidenceType.SAFETY
    depends_on = [EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL, EvidenceType.FUNCTIONAL]
    payload = {
        "hemolysis": {"probability": 0.05},
        "immunogenicity": {"band": "Low"},
        "chemical_liabilities": {"n_high": 0},
    }


def _analyze_endpoint(monkeypatch: pytest.MonkeyPatch, provider: Any):
    import hakase_peptide.pipeline as pipeline

    pipeline._ORCHESTRATOR = WorkflowOrchestrator(
        [
            _PhysicochemicalStub(),
            StructuralBiologyService(),
            _FunctionalStub(),
            _DevelopabilityStub(),
            _SafetyStub(),
        ]
    )
    monkeypatch.setattr(
        "hakase_peptide.services.structural.resolve_structure_provider",
        lambda _config=None: provider,
    )
    return next(
        route.endpoint
        for route in get_router().routes
        if isinstance(route, APIRoute) and route.path == "/v3/peptide/analyze"
    )


@pytest.mark.parametrize(
    ("name", "payload"),
    [
        (
            "pdb_target",
            {
                "sequence": "ACDEFGHIK",
                "target": {"pdb_id": "1M17", "chain_id": "A"},
            },
        ),
        (
            "uniprot_target",
            {
                "sequence": "ACDEFGHIK",
                "target": {"uniprot_accession": "P00533"},
            },
        ),
        ("no_target", {"sequence": "ACDEFGHIK"}),
        ("pdb_output_requested", {"sequence": "ACDEFGHIK", "include_pdb": True}),
        (
            "long_disulfide_peptide",
            {
                "sequence": "CACDEFGHIKLMNPQRSTVWC",
                "disulfide_bridges": "1-21",
            },
        ),
    ],
)
def test_v3_analyze_runs_structural_service_and_returns_canonical_evidence(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    payload: dict[str, Any],
) -> None:
    provider = _RecordingStructureProvider()
    endpoint = _analyze_endpoint(monkeypatch, provider)

    body = endpoint(AnalyzeRequest.model_validate(payload))

    assert provider.calls == [payload["sequence"]]
    assert body["decision"]["decision"] in {"GO", "CONDITIONAL_GO", "NO_GO"}
    assert body["diagnostics"]["services"]["structural"]["status"] == "success"

    evidence = body["platform_evidence"]["evidence"]
    assert set(evidence) == {
        "physicochemical",
        "structural",
        "functional",
        "developability",
        "safety",
    }

    physicochemical = evidence["physicochemical"]
    structural = evidence["structural"]
    structural_payload = structural["scientific_payload"]
    structural_evidence = structural_payload["structural_evidence"]

    assert STRUCTURAL_EVIDENCE_KEYS <= set(structural_evidence)
    assert structural_evidence["status"] == "available"
    assert set(structural_payload["strategy_selection"]["available_inputs"]) >= {
        "peptide_sequence",
        "isolated_peptide_structure",
        "physicochemical_evidence",
    }
    assert (
        structural_payload["strategy_selection"]["provenance"][
            "upstream_physicochemical_evidence_id"
        ]
        == physicochemical["evidence_id"]
    )
    assert structural["provenance"]["upstream_evidence_ids"] == [physicochemical["evidence_id"]]

    if payload.get("include_pdb"):
        assert structural_payload["pdb_output"]["status"] == "available"
        assert structural_payload["pdb_output"]["content"].startswith("ATOM")


def test_v3_analyze_returns_structural_section_when_structural_provider_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    endpoint = _analyze_endpoint(monkeypatch, _FailingStructureProvider())

    body = endpoint(AnalyzeRequest.model_validate({"sequence": "ACDEFGHIK"}))

    assert body["decision"]["decision"] in {"GO", "CONDITIONAL_GO", "NO_GO"}
    assert body["diagnostics"]["services"]["structural"]["status"] == "error"
    structural = body["platform_evidence"]["evidence"]["structural"]
    structural_evidence = structural["scientific_payload"]["structural_evidence"]

    assert STRUCTURAL_EVIDENCE_KEYS <= set(structural_evidence)
    assert structural_evidence["status"] == "unavailable"
    assert structural["validation_status"] == "unavailable"
    assert structural["scientific_payload"]["reason_code"] == "test_structure_provider_unavailable"
    assert (
        structural["scientific_payload"]["strategy_selection"]["provenance"][
            "physicochemical_evidence_provided"
        ]
        is True
    )
