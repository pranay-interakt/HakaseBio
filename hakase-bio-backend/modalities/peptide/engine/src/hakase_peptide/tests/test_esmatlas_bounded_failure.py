from __future__ import annotations

import pytest
import requests
from hakase_kernel.config import PlatformConfig
from hakase_kernel.faults import FailureType, ServiceFailure
from hakase_structure.pdb_tools import analyze_structure
from hakase_structure.prediction import StructurePrediction
from hakase_structure.providers import ESMFoldAtlasProvider

from hakase_peptide.domain.evidence import EvidenceType, ValidationStatus
from hakase_peptide.domain.peptide import Peptide
from hakase_peptide.infrastructure.orchestrator import WorkflowOrchestrator
from hakase_peptide.services import default_services
from hakase_peptide.services.physicochemical import PhysicochemicalService
from hakase_peptide.services.structural import StructuralBiologyService

PDB = "\n".join(
    [
        "ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00 80.00           C",
        "ATOM      2  CA  CYS A   2       1.000   0.000   0.000  1.00 82.00           C",
        "END",
    ]
)

PDB_0_TO_1 = "\n".join(
    [
        "ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00  0.80           C",
        "ATOM      2  CA  CYS A   2       1.000   0.000   0.000  1.00  0.82           C",
        "END",
    ]
)


class _Response:
    def __init__(self, status_code: int = 200, text: str = PDB) -> None:
        self.status_code = status_code
        self.text = text


def _config(**overrides) -> PlatformConfig:
    values = {
        "structure_provider": "esmfold_esmatlas",
        "esmatlas_fold_url": "https://example.test/fold",
        "esmatlas_max_length": 400,
        "esmatlas_timeout_s": 0.01,
        "esmatlas_max_attempts": 2,
        "esmatlas_retry_delay_s": 0.0,
        "nvidia_api_key": None,
        "nvidia_esmfold_url": "https://example.test/nvidia/fold",
        "nvidia_esm2_url": "https://example.test/nvidia/esm2",
        "structure_timeout_s": 120.0,
        "structure_max_retries": 2,
        "embedding_provider": "descriptors",
        "embedding_storage_backend": "local_fs",
        "embedding_storage_dir": None,
        "gpu_provider": None,
        "uniprot_base_url": "https://example.test/uniprot",
        "rcsb_base_url": "https://example.test/rcsb",
        "pubchem_base_url": "https://example.test/pubchem",
        "chembl_base_url": "https://example.test/chembl",
        "resource_timeout_s": 30.0,
        "strict_ml": False,
        "http_user_agent": "hakase-test",
    }
    values.update(overrides)
    return PlatformConfig(**values)


def _structural_evidence(result):
    return next(ev for ev in result.evidence if ev.evidence_type is EvidenceType.STRUCTURAL)


class _FakeProvider:
    name = "fake_esmfold"
    model_id = "esmfold_v1"
    model_version = "test"
    max_length = 400

    def __init__(self, prediction: StructurePrediction) -> None:
        self._prediction = prediction

    def fold(self, sequence: str) -> StructurePrediction:
        assert sequence == self._prediction.sequence
        return self._prediction


def test_esmatlas_successful_response_uses_provider_timeout(monkeypatch):
    seen = {}
    cfg = _config(esmatlas_timeout_s=12.5)

    def post(url, *, data, headers, timeout):
        seen.update(
            {"url": url, "data": data, "timeout": timeout, "user_agent": headers["User-Agent"]}
        )
        return _Response()

    monkeypatch.setattr("hakase_structure.providers.requests.post", post)

    prediction = ESMFoldAtlasProvider(cfg).fold("AC")

    assert prediction.provider == "esmfold_esmatlas"
    assert prediction.mean_plddt == pytest.approx(81.0)
    assert seen == {
        "url": "https://example.test/fold",
        "data": "AC",
        "timeout": 12.5,
        "user_agent": "hakase-test",
    }


def test_esmatlas_plddt_outputs_are_normalized_to_0_100(monkeypatch):
    monkeypatch.setattr(
        "hakase_structure.providers.requests.post",
        lambda *_, **__: _Response(text=PDB_0_TO_1),
    )

    prediction = ESMFoldAtlasProvider(_config()).fold("AC")
    public = prediction.to_public_dict(include_pdb=False)
    geometry = analyze_structure(prediction.pdb)

    assert prediction.raw_plddt_scale == "0-1"
    assert prediction.per_residue_plddt == pytest.approx([80.0, 82.0])
    assert public["mean_plddt"] == pytest.approx(81.0)
    assert public["plddt_scale"] == "0-100"
    assert public["raw_plddt_scale"] == "0-1"
    assert geometry["mean_plddt"] == pytest.approx(81.0)
    assert geometry["plddt_scale"] == "0-100"
    assert geometry["plddt_scale_detected"] == "0-1"
    assert geometry["raw_plddt_scale_detected"] == "0-1"


def test_esmatlas_provider_timeout_is_recoverable(monkeypatch):
    monkeypatch.setattr(
        "hakase_structure.providers.requests.post",
        lambda *_, **__: (_ for _ in ()).throw(requests.Timeout("slow provider")),
    )

    with pytest.raises(ServiceFailure) as exc_info:
        ESMFoldAtlasProvider(_config(esmatlas_timeout_s=13.0)).fold("AC")

    assert exc_info.value.failure_type is FailureType.RECOVERABLE
    assert exc_info.value.reason_code == "esmatlas_timeout"
    assert "13s" in str(exc_info.value)


def test_esmatlas_http_504_is_recoverable(monkeypatch):
    monkeypatch.setattr(
        "hakase_structure.providers.requests.post",
        lambda *_, **__: _Response(504, "Gateway timeout"),
    )

    with pytest.raises(ServiceFailure) as exc_info:
        ESMFoldAtlasProvider(_config()).fold("AC")

    assert exc_info.value.failure_type is FailureType.RECOVERABLE
    assert exc_info.value.reason_code == "esmatlas_http_error"
    assert "HTTP 504" in str(exc_info.value)


def test_esmatlas_retry_succeeds_on_second_attempt(monkeypatch):
    calls = {"count": 0}

    def post(*_, **__):
        calls["count"] += 1
        if calls["count"] == 1:
            raise requests.Timeout("first attempt timed out")
        return _Response()

    monkeypatch.setattr("hakase_structure.providers.requests.post", post)

    orchestrator = WorkflowOrchestrator(
        [PhysicochemicalService(), StructuralBiologyService()],
        config=_config(esmatlas_retry_delay_s=0.0),
    )
    result = orchestrator.run(Peptide.create("AC"))
    structural = _structural_evidence(result)

    assert calls["count"] == 2
    assert structural.is_available is True
    assert result.diagnostics["services"]["structural"]["status"] == "success"
    assert result.diagnostics["services"]["structural"]["attempts"] == 2


def test_structural_service_adds_per_residue_confidence_without_changing_existing_fields(
    monkeypatch,
):
    prediction = StructurePrediction(
        sequence="AC",
        pdb=PDB,
        per_residue_plddt=[80.0, 82.0],
        mean_plddt=81.0,
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )
    monkeypatch.setattr(
        "hakase_peptide.services.structural.resolve_structure_provider",
        lambda _config: _FakeProvider(prediction),
    )

    orchestrator = WorkflowOrchestrator(
        [PhysicochemicalService(), StructuralBiologyService()],
        config=_config(structure_provider="fake_esmfold"),
    )
    result = orchestrator.run(Peptide.create("AC"))
    payload = _structural_evidence(result).scientific_payload

    assert payload["structure"]["provider"] == "fake_esmfold"
    assert payload["structure"]["mean_plddt"] == pytest.approx(81.0)
    assert payload["structure"]["n_residues"] == 2
    assert payload["structure"]["plddt_scale"] == "0-100"
    assert payload["structure"]["raw_plddt_scale"] == "0-100"
    assert payload["structure"]["per_residue_plddt"] == [80.0, 82.0]
    assert payload["geometry"]["mean_plddt"] == pytest.approx(81.0)
    assert payload["geometry"]["min_plddt"] == pytest.approx(80.0)
    assert payload["geometry"]["max_plddt"] == pytest.approx(82.0)
    assert payload["geometry"]["confident_residue_fraction"] == pytest.approx(1.0)
    assert payload["geometry"]["plddt_scale"] == "0-100"

    assert payload["per_residue_confidence"] == [
        {
            "position": 1,
            "residue": "A",
            "plddt": 80.0,
            "confidence_category": "confident",
        },
        {
            "position": 2,
            "residue": "C",
            "plddt": 82.0,
            "confidence_category": "confident",
        },
    ]
    assert payload["low_confidence_regions"] == []
    assert payload["confidence_summary"]["total_residues"] == 2
    assert payload["confidence_summary"]["low_confidence_region_count"] == 0
    assert payload["confidence_summary"]["plddt_scale"] == "0-100"
    assert (
        payload["structural_feasibility"] == payload["isolated_structure"]["structural_feasibility"]
    )
    assert payload["structural_feasibility"]["status"] == "feasible"
    assert payload["structural_feasibility"]["decision"] == "proceed"

    isolated = payload["isolated_structure"]
    assert isolated["status"] == "available"
    assert isolated["prediction"]["provider"] == payload["structure"]["provider"]
    assert isolated["prediction"]["model_id"] == payload["structure"]["model_id"]
    assert isolated["prediction"]["model_version"] == payload["structure"]["model_version"]
    assert isolated["prediction"]["mean_plddt"] == payload["structure"]["mean_plddt"]
    assert isolated["prediction"]["mean_plddt"] == payload["geometry"]["mean_plddt"]
    assert isolated["prediction"]["mean_plddt"] == payload["confidence_summary"]["mean_plddt"]
    assert isolated["geometry"]["minimum_plddt"] == payload["geometry"]["min_plddt"]
    assert isolated["geometry"]["maximum_plddt"] == payload["geometry"]["max_plddt"]
    assert isolated["confidence"]["per_residue"] == payload["per_residue_confidence"]
    assert isolated["confidence"]["low_confidence_regions"] == payload["low_confidence_regions"]
    assert isolated["confidence"]["summary"] == payload["confidence_summary"]

    structural_evidence = payload["structural_evidence"]
    assert structural_evidence["status"] == "available"
    assert structural_evidence["analysis_scope"] == "isolated_peptide"
    assert structural_evidence["generated_by"] == "structural_service"
    assert structural_evidence["schema_version"] == "1.0.0"
    assert structural_evidence["isolated_structure"] == payload["isolated_structure"]
    assert structural_evidence["target_resolution"] == payload["target_resolution"]
    assert structural_evidence["strategy_selection"] == payload["strategy_selection"]
    assert structural_evidence["complex_prediction"] == payload["complex_prediction"]
    assert (
        structural_evidence["interface_confidence_summary"]
        == payload["interface_confidence_summary"]
    )
    assert (
        structural_evidence["structural_confidence_summary"]
        == payload["structural_confidence_summary"]
    )
    assert structural_evidence["provenance"]["generator"] == "structural_service"
    assert structural_evidence["provenance"]["component_generator"] == "structural_evidence_builder"
    assert structural_evidence["provenance"]["version"] == "1.0.0"
    assert structural_evidence["provenance"]["provider"] == "structural_evidence_builder"
    assert structural_evidence["provenance"]["model_id"] == "structural_evidence_builder"
    assert structural_evidence["provenance"]["model_version"] == "1.0.0"
    assert structural_evidence["provenance"]["schema_version"] == "1.0.0"
    assert structural_evidence["provenance"]["generated_at"]
    assert structural_evidence["provenance"]["deterministic"] is True


def test_structural_service_reports_mismatch_without_assigning_residue_scores(monkeypatch):
    prediction = StructurePrediction(
        sequence="ACD",
        pdb=PDB,
        per_residue_plddt=[80.0, 82.0],
        mean_plddt=81.0,
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )
    monkeypatch.setattr(
        "hakase_peptide.services.structural.resolve_structure_provider",
        lambda _config: _FakeProvider(prediction),
    )

    orchestrator = WorkflowOrchestrator(
        [PhysicochemicalService(), StructuralBiologyService()],
        config=_config(structure_provider="fake_esmfold"),
    )
    result = orchestrator.run(Peptide.create("ACD"))
    structural = _structural_evidence(result)
    payload = structural.scientific_payload

    assert payload["structure"]["mean_plddt"] == pytest.approx(81.0)
    assert payload["geometry"]["mean_plddt"] == pytest.approx(81.0)
    assert payload["per_residue_confidence"] == []
    assert payload["low_confidence_regions"] == []
    assert payload["confidence_summary"]["status"] == "unavailable"
    assert payload["confidence_summary"]["reason_code"] == "plddt_sequence_length_mismatch"
    assert payload["confidence_summary"]["total_residues"] == 3
    assert payload["confidence_summary"]["plddt_value_count"] == 2
    assert payload["isolated_structure"]["status"] == "unavailable"
    assert payload["isolated_structure"]["reason_code"] == "plddt_sequence_length_mismatch"
    assert payload["isolated_structure"]["confidence"]["summary"] == payload["confidence_summary"]
    assert (
        payload["structural_feasibility"] == payload["isolated_structure"]["structural_feasibility"]
    )
    assert payload["structural_feasibility"]["status"] == "insufficient_evidence"
    assert any("does not match" in warning for warning in structural.warnings)


def test_esmatlas_both_attempts_fail_pipeline_still_completes(monkeypatch):
    calls = {"count": 0}

    def post(*_, **__):
        calls["count"] += 1
        return _Response(504, "Gateway timeout")

    monkeypatch.setattr("hakase_structure.providers.requests.post", post)

    orchestrator = WorkflowOrchestrator(
        default_services(),
        config=_config(esmatlas_max_attempts=5, esmatlas_retry_delay_s=0.0),
    )
    result = orchestrator.run(Peptide.create("LLKKLLKKLLKLL"))
    structural = _structural_evidence(result)

    assert calls["count"] == 2
    assert result.terminated is False
    assert structural.validation_status is ValidationStatus.UNAVAILABLE
    assert structural.scientific_payload["status"] == "unavailable"
    assert structural.scientific_payload["reason_code"] == "esmatlas_http_error"
    assert structural.scientific_payload["isolated_structure"]["status"] == "unavailable"
    assert (
        structural.scientific_payload["isolated_structure"]["reason_code"] == "esmatlas_http_error"
    )
    assert structural.scientific_payload["isolated_structure"]["prediction"] is None
    assert structural.scientific_payload["isolated_structure"]["geometry"] is None
    assert structural.scientific_payload["isolated_structure"]["confidence"] is None
    assert structural.scientific_payload["structural_evidence"]["status"] == "unavailable"
    assert (
        structural.scientific_payload["structural_evidence"]["isolated_structure"]
        == structural.scientific_payload["isolated_structure"]
    )
    assert (
        structural.scientific_payload["structural_evidence"]["target_resolution"]
        == structural.scientific_payload["target_resolution"]
    )
    assert (
        structural.scientific_payload["structural_feasibility"]
        == structural.scientific_payload["isolated_structure"]["structural_feasibility"]
    )
    assert structural.scientific_payload["structural_feasibility"]["status"] == (
        "insufficient_evidence"
    )
    assert structural.scientific_payload["structural_feasibility"]["score"] is None
    assert structural.metadata["provider"] == "esmfold_esmatlas"
    assert structural.metadata["attempts"] == 2
    assert structural.metadata["provider_max_attempts"] == 2
    assert structural.provenance.parameters["provider"] == "esmfold_esmatlas"
    assert structural.provenance.parameters["provider_max_attempts"] == 2
    assert {ev.evidence_type for ev in result.evidence} == set(EvidenceType)
