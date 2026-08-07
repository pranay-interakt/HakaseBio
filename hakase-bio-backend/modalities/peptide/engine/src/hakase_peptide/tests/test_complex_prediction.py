from __future__ import annotations

from typing import Any

from hakase_peptide.domain.structural_strategy import select_structural_strategy
from hakase_peptide.domain.target import Target
from hakase_peptide.domain.target_resolution import resolve_target
from hakase_peptide.structure.complex_prediction import predict_complex

PEPTIDE_SEQUENCE = "ACDEFGHIK"
TARGET_SEQUENCE = "MRPSGTAGAALLALLAALCPASRA"
COMPLEX_PDB = "ATOM      1  CA  ALA P   1       1.000   0.000   0.000  1.00 80.00           C\nEND"


class FakeComplexProvider:
    name = "boltz2"
    model_version = "1.0"

    def __init__(
        self,
        *,
        available: bool = True,
        error: Exception | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        self.available = available
        self.error = error
        self.result = result or {
            "structure": COMPLEX_PDB,
            "structure_format": "pdb",
            "confidence": {"confidence_score": 0.62},
            "engine": "Boltz-2",
            "boltz_version": "1.0",
            "warnings": [],
        }
        self.sequence_called = False
        self.pdb_called = False

    def availability(self) -> tuple[bool, str]:
        return self.available, "configured" if self.available else "provider offline"

    def predict_from_sequences(
        self, *, peptide_sequence: str, target_sequence: str
    ) -> dict[str, Any]:
        self.sequence_called = True
        assert peptide_sequence == PEPTIDE_SEQUENCE
        assert target_sequence == TARGET_SEQUENCE
        if self.error:
            raise self.error
        return self.result

    def predict_from_pdb(
        self, *, peptide_sequence: str, pdb_id: str, chain_id: str
    ) -> dict[str, Any]:
        self.pdb_called = True
        assert peptide_sequence == PEPTIDE_SEQUENCE
        assert pdb_id == "1M17"
        assert chain_id == "A"
        if self.error:
            raise self.error
        return self.result


def _target_resolution(**kwargs: Any) -> dict[str, Any]:
    return resolve_target(Target.create(**kwargs)) if kwargs else resolve_target(None)


def _strategy(target_resolution: dict[str, Any], *, configured: bool = True) -> dict[str, Any]:
    return select_structural_strategy(
        peptide_sequence=PEPTIDE_SEQUENCE,
        target_resolution=target_resolution,
        isolated_structure={"status": "available"},
        model_configuration={"complex_prediction_provider_configured": configured},
    )


def _predict(
    target_resolution: dict[str, Any],
    *,
    provider: FakeComplexProvider | None = None,
    strategy_selection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return predict_complex(
        peptide_sequence=PEPTIDE_SEQUENCE,
        target_resolution=target_resolution,
        strategy_selection=strategy_selection or _strategy(target_resolution),
        provider=provider or FakeComplexProvider(),
    )


def test_no_target_is_not_applicable() -> None:
    result = _predict(_target_resolution())

    assert result["status"] == "not_applicable"
    assert result["strategy"] == "isolated_peptide_only"
    assert result["complex_available"] is False


def test_target_name_only_is_blocked() -> None:
    result = _predict(_target_resolution(name="EGFR"))

    assert result["status"] == "blocked"
    assert result["strategy"] == "target_enrichment_required"
    assert result["complex_available"] is False


def test_uniprot_only_is_blocked() -> None:
    result = _predict(_target_resolution(uniprot_accession="P00533"))

    assert result["status"] == "blocked"
    assert result["strategy"] == "target_enrichment_required"
    assert result["complex_available"] is False


def test_target_sequence_executes_sequence_based_prediction() -> None:
    provider = FakeComplexProvider()

    result = _predict(_target_resolution(sequence=TARGET_SEQUENCE), provider=provider)

    assert provider.sequence_called is True
    assert provider.pdb_called is False
    assert result["status"] == "available"
    assert result["strategy"] == "sequence_target_complex_prediction"
    assert result["provider"] == "boltz2"
    assert result["model_version"] == "1.0"
    assert result["confidence"] == "moderate"
    assert result["complex_available"] is True
    assert result["structure_format"] == "pdb"
    assert result["structure"] == COMPLEX_PDB


def test_pdb_and_chain_executes_pdb_based_prediction() -> None:
    provider = FakeComplexProvider()

    result = _predict(_target_resolution(pdb_id="1M17", chain_id="A"), provider=provider)

    assert provider.pdb_called is True
    assert provider.sequence_called is False
    assert result["status"] == "available"
    assert result["strategy"] == "pdb_target_complex_prediction"
    assert result["complex_available"] is True


def test_provider_unavailable_returns_unavailable_without_switching_strategy() -> None:
    provider = FakeComplexProvider(available=False)

    result = _predict(_target_resolution(sequence=TARGET_SEQUENCE), provider=provider)

    assert provider.sequence_called is False
    assert result["status"] == "unavailable"
    assert result["strategy"] == "sequence_target_complex_prediction"
    assert result["complex_available"] is False
    assert result["warnings"][0]["code"] == "provider_unavailable"


def test_provider_error_returns_failed() -> None:
    result = _predict(
        _target_resolution(sequence=TARGET_SEQUENCE),
        provider=FakeComplexProvider(error=RuntimeError("worker failed")),
    )

    assert result["status"] == "failed"
    assert result["complex_available"] is False
    assert result["errors"][0]["code"] == "provider_error"
    assert "worker failed" in result["errors"][0]["message"]


def test_invalid_pdb_returns_failed_validation_error() -> None:
    target_resolution = {
        "status": "resolved",
        "input": {"pdb_id": "BAD", "chain_id": "A"},
        "resolved_target": {"pdb_id": "BAD", "chain_id": "A"},
    }
    strategy_selection = {
        "selected_strategy": "pdb_target_complex_prediction",
        "warnings": [],
        "errors": [],
        "provenance": {},
    }

    result = _predict(target_resolution, strategy_selection=strategy_selection)

    assert result["status"] == "failed"
    assert result["errors"][0]["code"] == "invalid_pdb_id"


def test_invalid_sequence_returns_failed_validation_error() -> None:
    target_resolution = _target_resolution(sequence=TARGET_SEQUENCE)
    strategy_selection = _strategy(target_resolution)

    result = predict_complex(
        peptide_sequence="ACDX",
        target_resolution=target_resolution,
        strategy_selection=strategy_selection,
        provider=FakeComplexProvider(),
    )

    assert result["status"] == "failed"
    assert result["complex_available"] is False
    assert result["errors"][0]["code"] == "invalid_peptide_sequence"


def test_provider_failed_status_returns_failed_prediction() -> None:
    result = _predict(
        _target_resolution(sequence=TARGET_SEQUENCE),
        provider=FakeComplexProvider(result={"status": "failed", "error": "bad pose"}),
    )

    assert result["status"] == "failed"
    assert result["complex_available"] is False
    assert result["errors"][0]["code"] == "provider_failed"


def test_async_provider_job_returns_pending_without_fabricated_structure() -> None:
    result = _predict(
        _target_resolution(sequence=TARGET_SEQUENCE),
        provider=FakeComplexProvider(
            result={"job_id": "abc123", "status": "queued", "summary": {"n_chains": 2}}
        ),
    )

    assert result["status"] == "pending"
    assert result["complex_available"] is False
    assert result["structure"] is None
    assert result["provenance"]["provider_result"]["job_id"] == "abc123"
