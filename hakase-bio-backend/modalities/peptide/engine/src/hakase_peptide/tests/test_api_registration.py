"""Route registration tests for the V3 peptide FastAPI surface."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from hakase_kernel.faults import FailureType, ServiceFailure
from hakase_service.main import app
from hakase_structure.prediction import StructurePrediction

from hakase_peptide.api import get_router
from hakase_peptide.api.router import StructureRequest
from hakase_peptide.domain.schemas.structural import IsolatedStructure


def _pdb_for(sequence: str, scores: list[float]) -> str:
    three = {
        "A": "ALA",
        "C": "CYS",
        "D": "ASP",
        "E": "GLU",
        "F": "PHE",
        "G": "GLY",
        "H": "HIS",
        "I": "ILE",
        "K": "LYS",
    }
    lines = []
    for idx, (residue, score) in enumerate(zip(sequence, scores), start=1):
        lines.append(
            f"ATOM  {idx:5d}  CA  {three[residue]} A{idx:4d}    "
            f"{idx:8.3f}{0.0:8.3f}{0.0:8.3f}  1.00{score:6.2f}           C"
        )
    lines.append("END")
    return "\n".join(lines)


def _contains_text(value, needle: str) -> bool:
    if isinstance(value, str):
        return needle in value
    if isinstance(value, dict):
        return any(_contains_text(item, needle) for item in value.values())
    if isinstance(value, list):
        return any(_contains_text(item, needle) for item in value)
    return False


class _FakeStructureProvider:
    name = "fake_esmfold"
    model_id = "esmfold_v1"
    model_version = "test"
    max_length = 400

    def __init__(self, prediction: StructurePrediction) -> None:
        self._prediction = prediction

    def fold(self, sequence: str) -> StructurePrediction:
        assert sequence == self._prediction.sequence
        return self._prediction


def test_v3_peptide_router_is_registered() -> None:
    peptide_app = FastAPI()
    peptide_app.include_router(get_router())
    client = TestClient(peptide_app)

    paths = client.get("/openapi.json").json()["paths"]

    assert "/v3/peptide/health" in paths
    assert "/v3/peptide/analyze" in paths
    assert "/v3/peptide/policies" in paths
    assert "/v3/peptide/models" in paths
    assert "/v3/peptide/structure" in paths
    assert "/v3/peptide/conformation/availability" in paths


def test_v3_peptide_health_returns_200() -> None:
    client = TestClient(app)

    response = client.get("/v3/peptide/health")

    assert response.status_code == 200
    assert response.json()["platform"]


def test_v3_peptide_structure_returns_task_6_confidence_fields(monkeypatch) -> None:
    sequence = "ACDEFGHIK"
    scores = [79.0, 92.0, 70.0, 67.0, 51.2, 85.0, 49.0, 88.0, 90.0]
    prediction = StructurePrediction(
        sequence=sequence,
        pdb=_pdb_for(sequence, scores),
        per_residue_plddt=scores,
        mean_plddt=sum(scores) / len(scores),
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )
    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: _FakeStructureProvider(prediction),
    )
    router = get_router()
    route = next(
        route
        for route in router.routes
        if isinstance(route, APIRoute)
        and route.path == "/v3/peptide/structure"
        and "POST" in route.methods
    )

    body = route.endpoint(
        StructureRequest(
            sequence=sequence,
            disulfide_bridges="",
            include_pdb=False,
        )
    )

    assert "structure" in body
    assert "geometry" in body
    assert "pdb" not in body["structure"]
    assert body["pdb_output"] == {
        "status": "not_requested",
        "format": "pdb",
        "content": None,
    }
    assert body["structural_feasibility"] == body["isolated_structure"]["structural_feasibility"]
    assert body["structural_feasibility"]["status"] == "feasible_with_caution"
    assert body["structural_feasibility"]["decision"] == "proceed_with_caution"
    assert body["structural_feasibility"]["rules_triggered"]
    assert body["isolated_structure"]["pdb"] == body["pdb_output"]
    assert not _contains_text(body, "ATOM")
    assert body["structure"]["mean_plddt"] == 74.58
    assert body["geometry"]["mean_plddt"] == 74.58
    assert body["geometry"]["plddt_scale"] == "0-100"

    assert body["per_residue_confidence"] == [
        {
            "position": 1,
            "residue": "A",
            "plddt": 79.0,
            "confidence_category": "confident",
        },
        {
            "position": 2,
            "residue": "C",
            "plddt": 92.0,
            "confidence_category": "very_high",
        },
        {
            "position": 3,
            "residue": "D",
            "plddt": 70.0,
            "confidence_category": "confident",
        },
        {"position": 4, "residue": "E", "plddt": 67.0, "confidence_category": "low"},
        {"position": 5, "residue": "F", "plddt": 51.2, "confidence_category": "low"},
        {
            "position": 6,
            "residue": "G",
            "plddt": 85.0,
            "confidence_category": "confident",
        },
        {
            "position": 7,
            "residue": "H",
            "plddt": 49.0,
            "confidence_category": "very_low",
        },
        {
            "position": 8,
            "residue": "I",
            "plddt": 88.0,
            "confidence_category": "confident",
        },
        {
            "position": 9,
            "residue": "K",
            "plddt": 90.0,
            "confidence_category": "very_high",
        },
    ]
    assert body["low_confidence_regions"] == [
        {
            "start": 4,
            "end": 5,
            "length": 2,
            "mean_plddt": 59.1,
            "minimum_plddt": 51.2,
            "residues": "EF",
            "severity": "low",
        },
        {
            "start": 7,
            "end": 7,
            "length": 1,
            "mean_plddt": 49.0,
            "minimum_plddt": 49.0,
            "residues": "H",
            "severity": "very_low",
        },
    ]
    assert body["confidence_summary"]["total_residues"] == 9
    assert body["confidence_summary"]["low_confidence_residue_count"] == 3
    assert body["confidence_summary"]["low_confidence_region_count"] == 2
    assert body["confidence_summary"]["plddt_scale"] == "0-100"

    isolated = body["isolated_structure"]
    assert isolated["status"] == "available"
    assert isolated["prediction"] == {
        "provider": "fake_esmfold",
        "model_id": "esmfold_v1",
        "model_version": "test",
        "n_residues": 9,
        "mean_plddt": body["structure"]["mean_plddt"],
        "plddt_scale": "0-100",
        "raw_plddt_scale": "0-100",
    }
    assert isolated["geometry"]["n_residues"] == body["geometry"]["n_residues"]
    assert isolated["geometry"]["mean_plddt"] == body["geometry"]["mean_plddt"]
    assert isolated["geometry"]["minimum_plddt"] == body["geometry"]["min_plddt"]
    assert isolated["geometry"]["maximum_plddt"] == body["geometry"]["max_plddt"]
    assert (
        isolated["geometry"]["confident_residue_fraction"]
        == body["geometry"]["confident_residue_fraction"]
    )
    assert isolated["confidence"]["per_residue"] == body["per_residue_confidence"]
    assert isolated["confidence"]["low_confidence_regions"] == body["low_confidence_regions"]
    assert isolated["confidence"]["summary"] == body["confidence_summary"]
    assert isolated["prediction"]["mean_plddt"] == body["geometry"]["mean_plddt"]
    assert isolated["prediction"]["mean_plddt"] == body["confidence_summary"]["mean_plddt"]
    assert isolated["provenance"]["generator"] == "structural_service"
    assert isolated["provenance"]["provider"] == "fake_esmfold"
    assert isolated["provenance"]["model_id"] == "esmfold_v1"
    assert isolated["provenance"]["model_version"] == "test"
    assert isolated["provenance"]["schema_version"] == "1.0.0"
    assert isolated["provenance"]["generated_at"]
    assert isolated["provenance"]["deterministic"] is True
    assert isolated["provenance"]["plddt_scale"] == "0-100"
    assert isolated["provenance"]["raw_plddt_scale"] == "0-100"
    assert {item["code"] for item in isolated["limitations"]} >= {
        "isolated_peptide_prediction_only",
        "model_derived_confidence_not_experimental",
    }

    isolated_model = IsolatedStructure.model_validate(isolated)
    serialized = isolated_model.model_dump(mode="json", exclude_none=True)
    full_serialized = isolated_model.model_dump(mode="json")
    assert serialized["status"] == "available"
    assert serialized["prediction"] == isolated["prediction"]
    assert serialized["pdb"]["status"] == body["pdb_output"]["status"]
    assert serialized["pdb"]["format"] == body["pdb_output"]["format"]
    assert full_serialized["structural_feasibility"] == body["structural_feasibility"]
    assert serialized["confidence"]["summary"]["plddt_scale"] == "0-100"


def test_v3_peptide_structure_returns_valid_requested_pdb_output(monkeypatch) -> None:
    sequence = "ACDEFGHIK"
    scores = [79.0, 92.0, 70.0, 67.0, 51.2, 85.0, 49.0, 88.0, 90.0]
    pdb = _pdb_for(sequence, scores)
    prediction = StructurePrediction(
        sequence=sequence,
        pdb=pdb,
        per_residue_plddt=scores,
        mean_plddt=sum(scores) / len(scores),
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )
    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: _FakeStructureProvider(prediction),
    )
    route = next(
        route
        for route in get_router().routes
        if isinstance(route, APIRoute)
        and route.path == "/v3/peptide/structure"
        and "POST" in route.methods
    )

    body = route.endpoint(StructureRequest(sequence=sequence, include_pdb=True))

    pdb_output = body["pdb_output"]
    assert pdb_output["status"] == "available"
    assert pdb_output["format"] == "pdb"
    assert pdb_output["content_encoding"] == "plain_text"
    assert pdb_output["content"] == pdb
    assert "ATOM" in pdb_output["content"]
    assert "\nEND" in pdb_output["content"]
    assert pdb_output["n_residues"] == body["structure"]["n_residues"]
    assert pdb_output["n_residues"] == body["geometry"]["n_residues"]
    assert pdb_output["n_residues"] == body["confidence_summary"]["total_residues"]
    assert pdb_output["provider"] == body["structure"]["provider"]
    assert pdb_output["model_id"] == body["isolated_structure"]["prediction"]["model_id"]
    assert pdb_output["model_version"] == body["isolated_structure"]["provenance"]["model_version"]
    assert pdb_output["byte_length"] == len(pdb.encode("utf-8"))
    assert body["structure"]["pdb"] == pdb_output["content"]
    assert body["isolated_structure"]["pdb"] == pdb_output
    assert body["structural_feasibility"] == body["isolated_structure"]["structural_feasibility"]
    assert "/tmp/" not in repr(body)
    assert "/home/" not in repr(body)
    serialized = IsolatedStructure.model_validate(body["isolated_structure"]).model_dump(
        mode="json", exclude_none=True
    )
    assert serialized["pdb"] == pdb_output


def test_v3_peptide_structure_marks_requested_invalid_pdb_unavailable(monkeypatch) -> None:
    sequence = "AC"
    prediction = StructurePrediction(
        sequence=sequence,
        pdb="HEADER    NO COORDINATES\nEND",
        per_residue_plddt=[80.0, 82.0],
        mean_plddt=81.0,
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )
    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: _FakeStructureProvider(prediction),
    )
    route = next(
        route
        for route in get_router().routes
        if isinstance(route, APIRoute)
        and route.path == "/v3/peptide/structure"
        and "POST" in route.methods
    )

    body = route.endpoint(StructureRequest(sequence=sequence, include_pdb=True))

    assert "pdb" not in body["structure"]
    assert body["pdb_output"] == {
        "status": "unavailable",
        "format": "pdb",
        "content": None,
        "reason_code": "pdb_content_unavailable",
    }
    assert body["isolated_structure"]["status"] == "unavailable"
    assert body["isolated_structure"]["reason_code"] == "pdb_content_unavailable"
    assert body["isolated_structure"]["pdb"] == body["pdb_output"]
    assert body["structural_feasibility"] == body["isolated_structure"]["structural_feasibility"]
    assert body["structural_feasibility"]["status"] == "insufficient_evidence"
    assert body["geometry"]["status"] == "unavailable"
    assert body["per_residue_confidence"]
    assert not _contains_text(body, "NO COORDINATES")
    IsolatedStructure.model_validate(body["isolated_structure"])


def test_v3_peptide_structure_marks_isolated_structure_unavailable_on_confidence_mismatch(
    monkeypatch,
) -> None:
    sequence = "ACD"
    scores = [80.0, 82.0]
    prediction = StructurePrediction(
        sequence=sequence,
        pdb=_pdb_for("AC", scores),
        per_residue_plddt=scores,
        mean_plddt=sum(scores) / len(scores),
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )
    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: _FakeStructureProvider(prediction),
    )
    route = next(
        route
        for route in get_router().routes
        if isinstance(route, APIRoute)
        and route.path == "/v3/peptide/structure"
        and "POST" in route.methods
    )

    body = route.endpoint(StructureRequest(sequence=sequence, include_pdb=False))

    assert body["per_residue_confidence"] == []
    assert body["low_confidence_regions"] == []
    assert body["confidence_summary"]["reason_code"] == "plddt_sequence_length_mismatch"
    assert body["isolated_structure"]["status"] == "unavailable"
    assert body["isolated_structure"]["reason_code"] == "plddt_sequence_length_mismatch"
    assert body["isolated_structure"]["confidence"]["summary"] == body["confidence_summary"]
    assert body["structural_feasibility"] == body["isolated_structure"]["structural_feasibility"]
    assert body["structural_feasibility"]["status"] == "insufficient_evidence"


def test_v3_peptide_structure_prediction_failure_still_returns_structured_http_error(
    monkeypatch,
) -> None:
    class _FailingProvider:
        def fold(self, _sequence: str) -> StructurePrediction:
            raise ServiceFailure(
                "provider unavailable",
                failure_type=FailureType.RECOVERABLE,
                reason_code="esmatlas_http_error",
            )

    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: _FailingProvider(),
    )
    route = next(
        route
        for route in get_router().routes
        if isinstance(route, APIRoute)
        and route.path == "/v3/peptide/structure"
        and "POST" in route.methods
    )

    try:
        route.endpoint(StructureRequest(sequence="AC", include_pdb=False))
    except HTTPException as exc:
        assert exc.status_code == 503
        assert exc.detail["reason_code"] == "esmatlas_http_error"
    else:  # pragma: no cover
        raise AssertionError("Expected HTTPException")
