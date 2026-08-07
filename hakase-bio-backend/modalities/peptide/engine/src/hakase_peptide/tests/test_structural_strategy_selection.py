from __future__ import annotations

from typing import Any

from fastapi.routing import APIRoute
from hakase_structure.prediction import StructurePrediction

from hakase_peptide.api import get_router
from hakase_peptide.api.router import StructureRequest
from hakase_peptide.domain.structural_strategy import select_structural_strategy
from hakase_peptide.domain.target import Target
from hakase_peptide.domain.target_resolution import resolve_target

PEPTIDE_SEQUENCE = "ACDEFGHIK"
TARGET_SEQUENCE = "MRPSGTAGAALLALLAALCPASRA"


def _target_resolution(**kwargs: Any) -> dict[str, Any]:
    return resolve_target(Target.create(**kwargs)) if kwargs else resolve_target(None)


def _isolated(status: str = "available") -> dict[str, Any]:
    return {"status": status, "prediction": {"provider": "fake_esmfold"}}


def _select(
    target_resolution: dict[str, Any] | None,
    *,
    configured: bool = False,
    isolated_structure: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return select_structural_strategy(
        peptide_sequence=PEPTIDE_SEQUENCE,
        target_resolution=target_resolution,
        isolated_structure=isolated_structure if isolated_structure is not None else _isolated(),
        model_configuration={"complex_prediction_provider_configured": configured},
    )


def _warning_codes(result: dict[str, Any]) -> set[str]:
    return {item["code"] for item in result["warnings"]}


def _route(path: str) -> APIRoute:
    return next(
        route
        for route in get_router().routes
        if isinstance(route, APIRoute) and route.path == path and "POST" in route.methods
    )


class _FakeStructureProvider:
    max_length = 1024

    def __init__(self, prediction: StructurePrediction) -> None:
        self._prediction = prediction
        self.called = False

    def fold(self, sequence: str) -> StructurePrediction:
        self.called = True
        assert sequence == self._prediction.sequence
        return self._prediction


def _prediction(sequence: str = PEPTIDE_SEQUENCE) -> StructurePrediction:
    pdb = "\n".join(
        [
            f"ATOM  {idx:5d}  CA  ALA A{idx:4d}    {float(idx):8.3f}{0.0:8.3f}{0.0:8.3f}  1.00 85.00           C"
            for idx, _residue in enumerate(sequence, start=1)
        ]
        + ["END"]
    )
    return StructurePrediction(
        sequence=sequence,
        pdb=pdb,
        per_residue_plddt=[85.0 for _ in sequence],
        mean_plddt=85.0,
        provider="fake_esmfold",
        model_id="esmfold_v1",
        model_version="test",
        raw_plddt_scale="0-100",
    )


def test_no_target_selects_isolated_peptide_only() -> None:
    result = _select(_target_resolution())

    assert result["status"] == "not_applicable"
    assert result["selected_strategy"] == "isolated_peptide_only"
    assert result["analysis_scope"] == "isolated_peptide"
    assert result["can_run_isolated_prediction"] is True
    assert result["can_run_complex_prediction"] is False


def test_target_name_only_blocks_for_enrichment() -> None:
    result = _select(_target_resolution(name="EGFR"))

    assert result["status"] == "blocked"
    assert result["selected_strategy"] == "target_enrichment_required"
    assert result["analysis_scope"] == "target_resolution"
    assert result["missing_inputs"] == ["target_sequence_or_pdb"]
    assert result["can_run_isolated_prediction"] is True
    assert result["can_run_complex_prediction"] is False


def test_uniprot_only_without_lookup_blocks_for_resolved_target_data() -> None:
    result = _select(_target_resolution(uniprot_accession="P00533"))

    assert result["status"] == "blocked"
    assert result["selected_strategy"] == "target_enrichment_required"
    assert result["missing_inputs"] == ["resolved_target_sequence_or_pdb"]
    assert result["can_run_complex_prediction"] is False


def test_target_sequence_without_provider_selects_sequence_strategy_as_unavailable() -> None:
    result = _select(_target_resolution(sequence=TARGET_SEQUENCE), configured=False)

    assert result["status"] == "unavailable"
    assert result["selected_strategy"] == "sequence_target_complex_prediction"
    assert result["analysis_scope"] == "peptide_target_complex"
    assert result["target_input_type"] == "sequence"
    assert result["provider_ready"] is False
    assert result["can_run_complex_prediction"] is False
    assert "complex_provider_not_configured" in _warning_codes(result)


def test_pdb_id_only_selects_pdb_strategy_and_requires_chain_selection_later() -> None:
    result = _select(_target_resolution(pdb_id="1M17"), configured=False)

    assert result["status"] == "unavailable"
    assert result["selected_strategy"] == "pdb_target_complex_prediction"
    assert result["target_input_type"] == "pdb"
    assert "target_chain_not_selected" in _warning_codes(result)
    assert "target_pdb_not_verified" in _warning_codes(result)


def test_pdb_id_with_chain_selects_pdb_strategy() -> None:
    result = _select(_target_resolution(pdb_id="1M17", chain_id="A"), configured=False)

    assert result["status"] == "unavailable"
    assert result["selected_strategy"] == "pdb_target_complex_prediction"
    assert result["required_inputs"] == ["peptide_sequence", "target_pdb", "target_chain"]
    assert "target_chain_not_selected" not in _warning_codes(result)


def test_target_sequence_with_provider_configured_can_run_complex_prediction() -> None:
    result = _select(_target_resolution(sequence=TARGET_SEQUENCE), configured=True)

    assert result["status"] == "available"
    assert result["selected_strategy"] == "sequence_target_complex_prediction"
    assert result["provider_ready"] is True
    assert result["can_run_complex_prediction"] is True
    assert result["required_providers"] == ["complex_structure_predictor"]
    assert result["available_providers"] == ["complex_structure_predictor"]


def test_pdb_target_with_provider_configured_can_run_complex_prediction() -> None:
    result = _select(_target_resolution(pdb_id="1M17", chain_id="A"), configured=True)

    assert result["status"] == "available"
    assert result["selected_strategy"] == "pdb_target_complex_prediction"
    assert result["provider_ready"] is True
    assert result["can_run_complex_prediction"] is True


def test_empty_or_invalid_target_resolution_is_handled_without_fabrication() -> None:
    empty = _select({})
    invalid = _select("not-a-resolution")  # type: ignore[arg-type]

    assert empty["status"] == "not_applicable"
    assert empty["selected_strategy"] == "isolated_peptide_only"
    assert invalid["status"] == "blocked"
    assert invalid["selected_strategy"] == "target_enrichment_required"
    assert invalid["errors"][0]["code"] == "target_resolution_invalid"


def test_same_input_produces_same_result() -> None:
    resolution = _target_resolution(sequence=TARGET_SEQUENCE)

    first = _select(resolution, configured=True)
    second = _select(resolution, configured=True)

    assert first == second


def test_isolated_peptide_result_remains_available_when_complex_prediction_is_blocked() -> None:
    result = _select(_target_resolution(name="EGFR"), isolated_structure=_isolated())

    assert result["status"] == "blocked"
    assert result["can_run_isolated_prediction"] is True
    assert "isolated_peptide_structure" in result["available_inputs"]


def test_strategy_selection_does_not_call_external_complex_provider(monkeypatch) -> None:
    def fail_submit(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("complex provider must not be invoked by strategy selection")

    monkeypatch.setattr("hakase_peptide.structure.ConformationLayer.submit_complex", fail_submit)

    result = _select(_target_resolution(sequence=TARGET_SEQUENCE), configured=True)

    assert result["selected_strategy"] == "sequence_target_complex_prediction"


def test_structure_api_keeps_existing_fields_and_adds_strategy_selection(monkeypatch) -> None:
    fake_provider = _FakeStructureProvider(_prediction())
    monkeypatch.setattr(
        "hakase_peptide.api.router.resolve_structure_provider",
        lambda: fake_provider,
    )

    body = _route("/v3/peptide/structure").endpoint(
        StructureRequest.model_validate(
            {
                "sequence": PEPTIDE_SEQUENCE,
                "include_pdb": False,
                "target": {"sequence": TARGET_SEQUENCE},
            }
        )
    )

    assert fake_provider.called is True
    assert "structure" in body
    assert "isolated_structure" in body
    assert "target_resolution" in body
    assert body["strategy_selection"]["selected_strategy"] == ("sequence_target_complex_prediction")
    assert body["isolated_structure"]["status"] == "available"
