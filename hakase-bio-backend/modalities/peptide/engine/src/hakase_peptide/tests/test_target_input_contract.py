"""Target input contract tests for V3 peptide structural requests."""

from __future__ import annotations

import pytest
from fastapi.routing import APIRoute
from hakase_structure.prediction import StructurePrediction
from pydantic import ValidationError

from hakase_peptide.api import get_router
from hakase_peptide.api.router import AnalyzeRequest, StructureRequest, TargetModel
from hakase_peptide.domain.target import Target

CANONICAL_STRUCTURAL_STATUSES = {
    "available",
    "unavailable",
    "blocked",
    "pending",
    "failed",
    "not_applicable",
}
STRUCTURAL_STATUS_COMPONENTS = (
    "isolated_structure",
    "target_resolution",
    "strategy_selection",
    "complex_prediction",
    "interface_analysis",
    "interface_confidence_summary",
    "structural_confidence_summary",
    "structural_evidence",
)
REQUIRED_STRUCTURAL_PROVENANCE_FIELDS = (
    "generator",
    "provider",
    "model_id",
    "model_version",
    "schema_version",
    "generated_at",
    "deterministic",
)


def _route(path: str) -> APIRoute:
    return next(
        route
        for route in get_router().routes
        if isinstance(route, APIRoute) and route.path == path and "POST" in route.methods
    )


def _target_payload(**overrides: str | None) -> dict[str, str | None]:
    payload: dict[str, str | None] = {
        "name": "Epidermal growth factor receptor",
        "uniprot_accession": "P00533",
        "sequence": "MRPSGTAGAALLALLAALCPASRA",
        "pdb_id": "1M17",
        "chain_id": "A",
        "organism": "Homo sapiens",
    }
    payload.update(overrides)
    return payload


def _pdb_for_sequence(sequence: str) -> str:
    serial = 1
    lines: list[str] = []
    sg_offsets = {
        6: (0.0, 0.0, 0.0),
        20: (0.0, 0.0, 2.0),
        14: (10.0, 0.0, 0.0),
        31: (10.0, 0.0, 2.0),
        33: (20.0, 0.0, 0.0),
        42: (20.0, 0.0, 2.0),
    }
    for pos, residue in enumerate(sequence, start=1):
        resname = "CYS" if residue == "C" else "ALA"
        lines.append(_pdb_atom(serial, "CA", resname, pos, float(pos), 0.0, 0.0))
        serial += 1
        if pos in sg_offsets:
            x, y, z = sg_offsets[pos]
            lines.append(_pdb_atom(serial, "SG", resname, pos, x, y, z))
            serial += 1
    lines.append("END")
    return "\n".join(lines)


def _pdb_atom(
    serial: int,
    name: str,
    resname: str,
    resseq: int,
    x: float,
    y: float,
    z: float,
) -> str:
    return (
        f"ATOM  {serial:5d} {name:<4} {resname:>3} A{resseq:4d}"
        f"    {x:8.3f}{y:8.3f}{z:8.3f}  1.00 85.00           C"
    )


def _assert_target(payload: dict[str, str], expected: dict[str, str | None]) -> None:
    assert TargetModel.model_validate(payload).model_dump() == expected


def test_structural_statuses_and_provenance_are_canonical_for_required_scenarios(
    monkeypatch,
) -> None:
    route = _route("/v3/peptide/structure")

    class FakeStructureProvider:
        def fold(self, sequence: str) -> StructurePrediction:
            return StructurePrediction(
                sequence=sequence,
                pdb=_pdb_for_sequence(sequence),
                per_residue_plddt=[85.0] * len(sequence),
                mean_plddt=85.0,
                provider="fake_esmfold",
                model_id="esmfold_v1",
                model_version="test",
                raw_plddt_scale="0-100",
            )

    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: FakeStructureProvider(),
    )

    scenarios = (
        StructureRequest.model_validate(
            {"sequence": "ACDE", "target": {"pdb_id": "1m17", "chain_id": "A"}}
        ),
        StructureRequest.model_validate(
            {"sequence": "ACDE", "target": {"uniprot_accession": "P00533"}}
        ),
        StructureRequest.model_validate({"sequence": "ACDE", "target": None}),
        StructureRequest.model_validate({"sequence": "ACDE", "include_pdb": True}),
        StructureRequest.model_validate(
            {
                "sequence": "AAAAACAAAAAAACAAAAACAAAAAAAAAACACAAAAAAAACAAA",
                "target": {"sequence": "MRPSGTAGAALLALLAALCPASRA"},
                "include_pdb": False,
            }
        ),
    )

    for request in scenarios:
        body = route.endpoint(request)
        generated_at_values = set()
        for component in STRUCTURAL_STATUS_COMPONENTS:
            assert body[component]["status"] in CANONICAL_STRUCTURAL_STATUSES
            provenance = body[component]["provenance"]
            for field in REQUIRED_STRUCTURAL_PROVENANCE_FIELDS:
                assert field in provenance
                assert provenance[field] is not None
            assert provenance["generator"] == "structural_service"
            assert provenance["schema_version"] == "1.0.0"
            assert provenance["deterministic"] is True
            generated_at_values.add(provenance["generated_at"])
        assert len(generated_at_values) == 1

    no_target = route.endpoint(scenarios[2])
    assert no_target["target_resolution"]["status"] == "not_applicable"
    assert no_target["strategy_selection"]["status"] == "not_applicable"
    assert no_target["complex_prediction"]["status"] == "not_applicable"
    assert no_target["interface_analysis"]["status"] == "not_applicable"


def test_target_can_be_omitted_or_null() -> None:
    assert AnalyzeRequest.model_validate({"sequence": "ACDE"}).target is None
    assert AnalyzeRequest.model_validate({"sequence": "ACDE", "target": None}).target is None
    assert StructureRequest.model_validate({"sequence": "ACDE"}).target is None
    assert StructureRequest.model_validate({"sequence": "ACDE", "target": None}).target is None


def test_target_accepts_supported_identifier_combinations() -> None:
    _assert_target(
        {"name": "EGFR"},
        {
            "name": "EGFR",
            "uniprot_accession": None,
            "sequence": None,
            "pdb_id": None,
            "chain_id": None,
            "organism": None,
        },
    )
    _assert_target(
        {"uniprot_accession": "P00533"},
        {
            "name": None,
            "uniprot_accession": "P00533",
            "sequence": None,
            "pdb_id": None,
            "chain_id": None,
            "organism": None,
        },
    )
    _assert_target(
        {"sequence": "MRPSGTAGAALLALLAALCPASRA"},
        {
            "name": None,
            "uniprot_accession": None,
            "sequence": "MRPSGTAGAALLALLAALCPASRA",
            "pdb_id": None,
            "chain_id": None,
            "organism": None,
        },
    )
    _assert_target(
        {"pdb_id": "1M17"},
        {
            "name": None,
            "uniprot_accession": None,
            "sequence": None,
            "pdb_id": "1M17",
            "chain_id": None,
            "organism": None,
        },
    )
    _assert_target(
        {"pdb_id": "1M17", "chain_id": "A"},
        {
            "name": None,
            "uniprot_accession": None,
            "sequence": None,
            "pdb_id": "1M17",
            "chain_id": "A",
            "organism": None,
        },
    )
    _assert_target(_target_payload(), _target_payload())


def test_target_normalizes_whitespace_case_and_multiline_sequence() -> None:
    target = TargetModel.model_validate(
        {
            "name": " EGFR ",
            "uniprot_accession": " p00533 ",
            "sequence": " mrpsgta\n gaallallaa ",
            "pdb_id": " 1m17 ",
            "chain_id": " A ",
            "organism": " Homo sapiens ",
        }
    )

    assert target.model_dump() == {
        "name": "EGFR",
        "uniprot_accession": "P00533",
        "sequence": "MRPSGTAGAALLALLAA",
        "pdb_id": "1M17",
        "chain_id": "A",
        "organism": "Homo sapiens",
    }


def test_empty_string_fields_normalize_to_null_before_minimum_identifier_check() -> None:
    target = TargetModel.model_validate({"name": " EGFR ", "sequence": " \n "})

    assert target.name == "EGFR"
    assert target.sequence is None


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {},
            "Target must include at least one of: name, uniprot_accession, sequence, or pdb_id.",
        ),
        (
            {"organism": "Homo sapiens"},
            "Target must include at least one of: name, uniprot_accession, sequence, or pdb_id.",
        ),
        ({"chain_id": "A"}, "Target chain_id requires pdb_id."),
        ({"name": "EGFR", "chain_id": "A"}, "Target chain_id requires pdb_id."),
        ({"uniprot_accession": "NOTREAL!!"}, "not a valid UniProt accession"),
        ({"pdb_id": "ABCDE"}, "not a valid PDB id"),
        ({"sequence": "MKT123ABC"}, "Target sequence contains invalid residues"),
    ],
)
def test_invalid_target_contract_inputs_are_rejected(payload: dict[str, str], message: str) -> None:
    with pytest.raises(ValidationError) as exc_info:
        TargetModel.model_validate(payload)

    assert message in str(exc_info.value)


def test_request_validation_reports_target_errors() -> None:
    with pytest.raises(ValidationError) as exc_info:
        AnalyzeRequest.model_validate({"sequence": "ACDE", "target": {"chain_id": "A"}})

    assert "Target chain_id requires pdb_id" in str(exc_info.value)


def test_existing_request_without_target_remains_valid(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_analyze_peptide(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"ok": True, "target": kwargs["target"]}

    monkeypatch.setattr("hakase_peptide.api.router.analyze_peptide", fake_analyze_peptide)

    response = _route("/v3/peptide/analyze").endpoint(AnalyzeRequest(sequence="ACDE"))

    assert captured["target"] is None
    assert response["target"] is None


def test_disulfide_bridges_accept_canonical_array_and_legacy_string() -> None:
    array_request = StructureRequest.model_validate(
        {"sequence": "ACCA", "disulfide_bridges": [[2, 3]]}
    )
    string_request = StructureRequest.model_validate(
        {"sequence": "ACCA", "disulfide_bridges": "2-3"}
    )

    assert array_request.disulfide_bridges == [[2, 3]]
    assert string_request.disulfide_bridges == "2-3"


def test_target_fields_appear_in_v3_analyze_pipeline_input(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_analyze_peptide(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"ok": True, "target": kwargs["target"]}

    monkeypatch.setattr("hakase_peptide.api.router.analyze_peptide", fake_analyze_peptide)

    response = _route("/v3/peptide/analyze").endpoint(
        AnalyzeRequest.model_validate(
            {
                "sequence": "ACDE",
                "target": {
                    "name": " EGFR ",
                    "uniprot_accession": " p00533 ",
                    "pdb_id": " 1m17 ",
                    "chain_id": " A ",
                    "organism": " Homo sapiens ",
                },
            }
        )
    )

    expected = {
        "name": "EGFR",
        "uniprot_accession": "P00533",
        "sequence": None,
        "pdb_id": "1M17",
        "chain_id": "A",
        "organism": "Homo sapiens",
    }
    assert captured["target"] == expected
    assert response["target"] == expected


def test_target_fields_survive_request_to_domain_mapping() -> None:
    request_target = TargetModel.model_validate(_target_payload(chain_id="a"))
    domain_target = Target.create(**request_target.model_dump())

    assert domain_target.name == "Epidermal growth factor receptor"
    assert domain_target.uniprot_accession == "P00533"
    assert domain_target.sequence == "MRPSGTAGAALLALLAALCPASRA"
    assert domain_target.pdb_id == "1M17"
    assert domain_target.chain_id == "a"
    assert domain_target.organism == "Homo sapiens"


def test_isolated_structure_request_with_target_remains_backward_compatible(monkeypatch) -> None:
    sequence = "ACDE"
    prediction = StructurePrediction(
        sequence=sequence,
        pdb=(
            "ATOM      1  CA  ALA A   1       1.000   0.000   0.000  1.00 80.00           C\n"
            "ATOM      2  CA  CYS A   2       2.000   0.000   0.000  1.00 82.00           C\n"
            "ATOM      3  CA  ASP A   3       3.000   0.000   0.000  1.00 84.00           C\n"
            "ATOM      4  CA  GLU A   4       4.000   0.000   0.000  1.00 86.00           C\n"
            "END"
        ),
        per_residue_plddt=[80.0, 82.0, 84.0, 86.0],
        mean_plddt=83.0,
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )

    class FakeStructureProvider:
        def fold(self, folded_sequence: str) -> StructurePrediction:
            assert folded_sequence == sequence
            return prediction

    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: FakeStructureProvider(),
    )

    body = _route("/v3/peptide/structure").endpoint(
        StructureRequest.model_validate(
            {"sequence": sequence, "target": {"pdb_id": "1m17", "chain_id": "A"}}
        )
    )

    assert body["isolated_structure"]["status"] == "available"
    assert body["structural_confidence_summary"]["status"] == "available"
    assert body["structural_confidence_summary"]["target_confidence"]["status"] == "available"
    assert body["structural_confidence_summary"]["complex_confidence"]["status"] in {
        "unavailable",
        "pending",
    }
    assert body["interface_analysis"]["status"] == "unavailable"
    assert body["interface_confidence_summary"]["status"] == "unavailable"
    assert body["interface_confidence_summary"]["overall_confidence"] == "unavailable"
    assert body["interface_confidence_summary"]["overall_score"] is None
    assert body["interface_confidence_summary"]["reason_code"] == "interface_analysis_unavailable"
    assert body["target"] == {
        "name": None,
        "uniprot_accession": None,
        "sequence": None,
        "pdb_id": "1M17",
        "chain_id": "A",
        "organism": None,
    }


def test_uniprot_only_structure_request_reports_interface_confidence_unavailable(
    monkeypatch,
) -> None:
    sequence = "ACDE"
    prediction = StructurePrediction(
        sequence=sequence,
        pdb=(
            "ATOM      1  CA  ALA A   1       1.000   0.000   0.000  1.00 80.00           C\n"
            "ATOM      2  CA  CYS A   2       2.000   0.000   0.000  1.00 82.00           C\n"
            "ATOM      3  CA  ASP A   3       3.000   0.000   0.000  1.00 84.00           C\n"
            "ATOM      4  CA  GLU A   4       4.000   0.000   0.000  1.00 86.00           C\n"
            "END"
        ),
        per_residue_plddt=[80.0, 82.0, 84.0, 86.0],
        mean_plddt=83.0,
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )

    class FakeStructureProvider:
        def fold(self, folded_sequence: str) -> StructurePrediction:
            assert folded_sequence == sequence
            return prediction

    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: FakeStructureProvider(),
    )

    body = _route("/v3/peptide/structure").endpoint(
        StructureRequest.model_validate(
            {"sequence": sequence, "target": {"uniprot_accession": "P00533"}}
        )
    )

    assert body["interface_analysis"]["status"] == "blocked"
    assert body["interface_confidence_summary"]["status"] == "blocked"
    assert body["interface_confidence_summary"]["overall_confidence"] == "unavailable"
    assert body["interface_confidence_summary"]["overall_score"] is None
    assert body["interface_confidence_summary"]["reason_code"] == "complex_prediction_blocked"


def test_long_peptide_structure_request_accepts_array_disulfides_with_target_context(
    monkeypatch,
) -> None:
    sequence = "AAAAACAAAAAAACAAAAACAAAAAAAAAACACAAAAAAAACAAA"
    bridges = [[6, 20], [14, 31], [33, 42]]
    prediction = StructurePrediction(
        sequence=sequence,
        pdb=_pdb_for_sequence(sequence),
        per_residue_plddt=[85.0] * len(sequence),
        mean_plddt=85.0,
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )

    class FakeStructureProvider:
        def fold(self, folded_sequence: str) -> StructurePrediction:
            assert folded_sequence == sequence
            return prediction

    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: FakeStructureProvider(),
    )

    body = _route("/v3/peptide/structure").endpoint(
        StructureRequest.model_validate(
            {
                "sequence": sequence,
                "disulfide_bridges": bridges,
                "target": {"sequence": "MRPSGTAGAALLALLAALCPASRA"},
                "include_pdb": False,
            }
        )
    )

    assert body["structural_evidence"]["status"] == "available"
    assert body["structural_evidence"]["analysis_scope"] == ("isolated_peptide_with_target_context")
    assert body["target_resolution"]["status"] == "available"
    assert body["complex_prediction"]["status"] == "unavailable"
    assert body["interface_confidence_summary"]["status"] == "unavailable"
    assert body["structural_confidence_summary"]["status"] == "available"
    assert body["geometry"]["disulfide_geometry"] == [
        {
            "pair": [6, 20],
            "sg_sg_distance_angstrom": 2.0,
            "geometry_consistent": True,
        },
        {
            "pair": [14, 31],
            "sg_sg_distance_angstrom": 2.0,
            "geometry_consistent": True,
        },
        {
            "pair": [33, 42],
            "sg_sg_distance_angstrom": 2.0,
            "geometry_consistent": True,
        },
    ]
    assert body["isolated_structure"]["geometry"]["disulfide_geometry"] == (
        body["geometry"]["disulfide_geometry"]
    )
    assert body["structural_feasibility"]["metrics"]["requested_disulfide_count"] == 3
    assert body["structural_feasibility"]["metrics"]["validated_disulfide_count"] == 3
