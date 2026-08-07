from __future__ import annotations

import json
from typing import Any

from fastapi.routing import APIRoute
from hakase_kernel.config import get_config
from hakase_structure.prediction import StructurePrediction

from hakase_peptide.api import get_router
from hakase_peptide.api.router import StructureRequest
from hakase_peptide.domain.peptide import Peptide
from hakase_peptide.domain.target import Target
from hakase_peptide.domain.target_resolution import TargetResolver, resolve_target
from hakase_peptide.infrastructure import get_audit_log, get_model_registry, get_resource_manager
from hakase_peptide.infrastructure.orchestrator import ExecutionContext
from hakase_peptide.services.structural import StructuralBiologyService

TARGET_SEQUENCE = "MRPSGTAGAALLALLAALCPASRA"


def _target(**kwargs: Any) -> Target:
    return Target.create(**kwargs)


def _resolve(**kwargs: Any) -> dict[str, Any]:
    return resolve_target(_target(**kwargs))


def _codes(result: dict[str, Any], key: str = "warnings") -> set[str]:
    return {item["code"] for item in result[key]}


def _route(path: str) -> APIRoute:
    return next(
        route
        for route in get_router().routes
        if isinstance(route, APIRoute) and route.path == path and "POST" in route.methods
    )


def _prediction(sequence: str = "ACDEFGHIK") -> StructurePrediction:
    pdb_lines = [
        f"ATOM  {idx:5d}  CA  ALA A{idx:4d}    {float(idx):8.3f}{0.0:8.3f}{0.0:8.3f}  1.00 85.00           C"
        for idx, _residue in enumerate(sequence, start=1)
    ]
    return StructurePrediction(
        sequence=sequence,
        pdb="\n".join(pdb_lines + ["END"]),
        per_residue_plddt=[85.0 for _ in sequence],
        mean_plddt=85.0,
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )


class FakeStructureProvider:
    max_length = 1024

    def __init__(self, prediction: StructurePrediction) -> None:
        self._prediction = prediction

    def fold(self, sequence: str) -> StructurePrediction:
        assert sequence == self._prediction.sequence
        return self._prediction


def test_target_omitted_and_null_return_not_applicable() -> None:
    omitted = resolve_target(None)
    null = TargetResolver().resolve_target(None).to_dict()

    for result in (omitted, null):
        assert result["status"] == "not_applicable"
        assert result["resolution_level"] == "none"
        assert result["source"] == "none"
        assert result["resolved_target"] is None
        assert result["selected_strategy"] == "none"
        assert result["confidence"] == "not_applicable"
        assert result["warnings"] == []
        assert result["errors"] == []
        assert result["provenance"]["network_lookup_performed"] is False


def test_name_only_returns_low_confidence_partial_resolution() -> None:
    result = _resolve(name="EGFR")

    assert result["status"] == "blocked"
    assert result["resolution_level"] == "identifier_only"
    assert result["source"] == "provided_name"
    assert result["resolved_target"]["name"] == "EGFR"
    assert result["confidence"] == "low"
    assert {"target_name_only", "target_sequence_unavailable"} <= _codes(result)


def test_uniprot_only_is_preserved_without_fabricated_sequence() -> None:
    result = _resolve(uniprot_accession="P00533")

    assert result["status"] == "blocked"
    assert result["source"] == "provided_uniprot"
    assert result["resolved_target"]["uniprot_accession"] == "P00533"
    assert result["resolved_target"]["sequence"] is None
    assert result["confidence"] == "low"
    assert "target_uniprot_lookup_unavailable" in _codes(result)


def test_sequence_only_returns_sequence_length() -> None:
    result = _resolve(sequence=TARGET_SEQUENCE)

    assert result["status"] == "available"
    assert result["resolution_level"] == "sequence_only"
    assert result["source"] == "provided_sequence"
    assert result["resolved_target"]["sequence"] == TARGET_SEQUENCE
    assert result["resolved_target"]["sequence_length"] == len(TARGET_SEQUENCE)
    assert result["confidence"] == "moderate"


def test_pdb_only_selects_provided_pdb() -> None:
    result = _resolve(pdb_id="1m17")

    assert result["status"] == "available"
    assert result["source"] == "provided_pdb"
    assert result["selected_strategy"] == "provided_pdb"
    assert result["resolution_level"] == "structure_only"
    assert result["resolved_target"]["pdb_id"] == "1M17"
    assert result["resolved_target"]["chain_id"] is None
    assert result["confidence"] == "moderate"


def test_pdb_with_chain_is_higher_confidence_than_pdb_only() -> None:
    pdb_only = _resolve(pdb_id="1M17")
    with_chain = _resolve(pdb_id="1M17", chain_id="A")

    assert with_chain["source"] == "provided_pdb"
    assert with_chain["resolved_target"]["chain_id"] == "A"
    assert pdb_only["confidence"] == "moderate"
    assert with_chain["confidence"] == "high"
    assert "target_chain_not_verified" in _codes(with_chain)


def test_complete_target_preserves_every_explicit_field() -> None:
    result = _resolve(
        name="EGFR",
        uniprot_accession="P00533",
        sequence=TARGET_SEQUENCE,
        pdb_id="1M17",
        chain_id="A",
        organism="Homo sapiens",
    )

    assert result["status"] == "available"
    assert result["resolution_level"] == "complete"
    assert result["source"] == "provided_pdb"
    assert result["confidence"] == "high"
    assert result["resolved_target"] == {
        "name": "EGFR",
        "uniprot_accession": "P00533",
        "sequence": TARGET_SEQUENCE,
        "pdb_id": "1M17",
        "chain_id": "A",
        "organism": "Homo sapiens",
        "sequence_length": len(TARGET_SEQUENCE),
    }


def test_available_inputs_are_stable_and_deterministic() -> None:
    result = _resolve(name="EGFR", uniprot_accession="P00533", pdb_id="1M17", chain_id="A")

    assert result["available_inputs"] == ["name", "uniprot_accession", "pdb_id", "chain_id"]


def test_resolution_source_priority_is_deterministic() -> None:
    assert _resolve(sequence="ACDEFG", uniprot_accession="P00533")["source"] == "provided_sequence"
    assert _resolve(pdb_id="1M17", sequence="ACDEFG")["source"] == "provided_pdb"
    assert _resolve(name="EGFR", uniprot_accession="P00533")["source"] == "provided_uniprot"


def test_confidence_mapping_is_deterministic() -> None:
    assert _resolve(name="EGFR")["confidence"] == "low"
    assert _resolve(uniprot_accession="P00533")["confidence"] == "low"
    assert _resolve(sequence="ACDEFG")["confidence"] == "moderate"
    assert _resolve(pdb_id="1M17")["confidence"] == "moderate"
    assert _resolve(pdb_id="1M17", chain_id="A")["confidence"] == "high"
    assert _resolve(sequence="ACDEFG", uniprot_accession="P00533")["confidence"] == "high"


def test_provider_unavailable_is_recoverable() -> None:
    class FailingProvider:
        name = "uniprot"

        def resolve_uniprot(self, accession: str) -> dict[str, Any] | None:
            raise RuntimeError("offline")

        def resolve_pdb(self, pdb_id: str, chain_id: str | None = None) -> dict[str, Any] | None:
            return None

    result = (
        TargetResolver([FailingProvider()])
        .resolve_target(_target(uniprot_accession="P00533"))
        .to_dict()
    )

    assert result["status"] == "blocked"
    assert result["errors"] == [
        {
            "code": "target_provider_error",
            "message": "uniprot target resolution failed.",
            "recoverable": True,
        }
    ]
    assert result["provenance"]["network_lookup_performed"] is True


def test_provider_timeout_does_not_terminate_resolution() -> None:
    class TimeoutProvider:
        name = "uniprot"

        def resolve_uniprot(self, accession: str) -> dict[str, Any] | None:
            raise TimeoutError("slow")

        def resolve_pdb(self, pdb_id: str, chain_id: str | None = None) -> dict[str, Any] | None:
            return None

    result = (
        TargetResolver([TimeoutProvider()])
        .resolve_target(_target(uniprot_accession="P00533"))
        .to_dict()
    )

    assert result["status"] == "blocked"
    assert result["errors"][0]["code"] == "target_provider_timeout"
    assert result["errors"][0]["recoverable"] is True


def test_conflicting_explicit_and_provider_sequence_produces_warning() -> None:
    class UniProtProvider:
        name = "uniprot"

        def resolve_uniprot(self, accession: str) -> dict[str, Any] | None:
            return {
                "accession": accession,
                "sequence": "ACDEFGHIKLMN",
                "sequence_length": 12,
            }

        def resolve_pdb(self, pdb_id: str, chain_id: str | None = None) -> dict[str, Any] | None:
            return None

    result = (
        TargetResolver([UniProtProvider()])
        .resolve_target(_target(uniprot_accession="P00533", sequence="ACDEFG"))
        .to_dict()
    )

    assert result["resolved_target"]["sequence"] == "ACDEFG"
    assert result["resolved_target"]["sequence_length"] == 6
    assert "target_sequence_conflict" in _codes(result)


def test_provider_provenance_is_correct() -> None:
    class UniProtProvider:
        name = "uniprot"

        def resolve_uniprot(self, accession: str) -> dict[str, Any] | None:
            return {"accession": accession, "sequence": "ACDEFG", "sequence_length": 6}

        def resolve_pdb(self, pdb_id: str, chain_id: str | None = None) -> dict[str, Any] | None:
            return None

    result = (
        TargetResolver([UniProtProvider()])
        .resolve_target(_target(uniprot_accession="P00533"))
        .to_dict()
    )

    assert result["resolved_target"]["sequence"] == "ACDEFG"
    assert result["provenance"]["network_lookup_performed"] is True
    assert result["provenance"]["providers"] == [
        {
            "name": "uniprot",
            "status": "success",
            "accession": "P00533",
            "sequence_length": 6,
        }
    ]


def test_no_network_lookup_is_claimed_when_none_occurred() -> None:
    result = _resolve(pdb_id="1M17", chain_id="A")

    assert result["provenance"]["network_lookup_performed"] is False
    assert result["provenance"]["providers"] == []


def test_serialization_is_stable() -> None:
    result = _resolve(sequence="ACDEFG")

    assert json.loads(json.dumps(result, sort_keys=True)) == result


def test_target_resolution_appears_in_v3_peptide_structure(monkeypatch) -> None:
    sequence = "ACDEFGHIK"
    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: FakeStructureProvider(_prediction(sequence)),
    )

    body = _route("/v3/peptide/structure").endpoint(
        StructureRequest.model_validate(
            {
                "sequence": sequence,
                "include_pdb": False,
                "target": {"pdb_id": "1m17", "chain_id": "A"},
            }
        )
    )

    assert body["target_resolution"]["status"] == "available"
    assert body["target_resolution"]["source"] == "provided_pdb"
    assert body["target_resolution"]["resolved_target"]["pdb_id"] == "1M17"
    assert body["target_resolution"]["resolved_target"]["chain_id"] == "A"
    assert body["structural_evidence"]["target_resolution"]["status"] == "available"
    assert body["structural_evidence"]["validation_status"] == "computational_only"
    assert body["target"]["pdb_id"] == "1M17"


def test_target_null_does_not_change_existing_structural_output(monkeypatch) -> None:
    sequence = "ACDEFGHIK"
    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: FakeStructureProvider(_prediction(sequence)),
    )

    body = _route("/v3/peptide/structure").endpoint(
        StructureRequest.model_validate(
            {"sequence": sequence, "include_pdb": False, "target": None}
        )
    )

    assert body["structure"]["n_residues"] == len(sequence)
    assert body["isolated_structure"]["status"] == "available"
    assert body["target"] is None
    assert body["target_resolution"]["status"] == "not_applicable"
    assert body["structural_evidence"]["status"] == "available"
    assert body["structural_evidence"]["isolated_structure"] == body["isolated_structure"]
    assert body["structural_evidence"]["target_resolution"] == body["target_resolution"]
    assert body["structural_evidence"]["validation_status"] == "computational_only"


def test_uniprot_target_keeps_structural_validation_computational_only(monkeypatch) -> None:
    sequence = "ACDEFGHIK"
    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: FakeStructureProvider(_prediction(sequence)),
    )

    body = _route("/v3/peptide/structure").endpoint(
        StructureRequest.model_validate(
            {
                "sequence": sequence,
                "include_pdb": False,
                "target": {"uniprot_accession": "P00533"},
            }
        )
    )

    assert body["target_resolution"]["source"] == "provided_uniprot"
    assert body["structural_evidence"]["validation_status"] == "computational_only"


def test_target_resolution_appears_in_structural_payload_for_v3_analyze(monkeypatch) -> None:
    sequence = "ACDEFGHIK"
    monkeypatch.setattr(
        "hakase_peptide.services.structural.resolve_structure_provider",
        lambda _config: FakeStructureProvider(_prediction(sequence)),
    )
    service = StructuralBiologyService()
    context = ExecutionContext(
        execution_id="exec_test",
        peptide=Peptide.create(sequence),
        target=_target(sequence=TARGET_SEQUENCE),
        policy_id=None,
        config=get_config(),
        registry=get_model_registry(),
        resources=get_resource_manager(),
        audit=get_audit_log(),
        options={"include_pdb": False},
    )

    evidence = service.run(context)
    target_resolution = evidence.scientific_payload["target_resolution"]

    assert target_resolution["status"] == "available"
    assert target_resolution["source"] == "provided_sequence"
    assert target_resolution["resolved_target"]["sequence_length"] == len(TARGET_SEQUENCE)
    assert evidence.scientific_payload["structural_evidence"]["status"] == "available"
    assert (
        evidence.scientific_payload["structural_evidence"]["validation_status"]
        == "computational_only"
    )
    assert (
        evidence.scientific_payload["structural_evidence"]["target_resolution"]
        == evidence.scientific_payload["target_resolution"]
    )
