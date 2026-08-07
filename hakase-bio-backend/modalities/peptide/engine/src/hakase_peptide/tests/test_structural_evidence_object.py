from __future__ import annotations

from hakase_peptide.domain.modifications import ModType
from hakase_peptide.domain.schemas.structural import StructuralEvidenceObject
from hakase_peptide.domain.target import Target
from hakase_peptide.domain.target_resolution import resolve_target
from hakase_peptide.structure.structural_evidence import build_structural_evidence

LONG_PEPTIDE = "ACDEFGHIKLMNPQRSTVWYCC"
TARGET_SEQUENCE = "MRPSGTAGAALLALLAALCPASRA"


def _target_resolution(**kwargs):
    return resolve_target(Target.create(**kwargs)) if kwargs else resolve_target(None)


def _isolated(n=12, mean=85.0, minimum=80.0, low_regions=0):
    return {
        "status": "available",
        "prediction": {"n_residues": n, "mean_plddt": mean},
        "confidence": {
            "summary": {
                "total_residues": n,
                "low_confidence_region_count": low_regions,
                "low_confidence_residue_fraction": 0.0 if low_regions == 0 else 0.25,
                "mean_plddt": mean,
                "minimum_plddt": minimum,
                "maximum_plddt": 95.0,
                "plddt_scale": "0-100",
            }
        },
    }


def _structural_summary():
    return {
        "status": "available",
        "overall_score": 78,
        "analysis_scope": "isolated_peptide_with_target_context",
        "provenance": {
            "calculator": "structural_confidence_aggregator",
            "calculator_version": "1.0.0",
            "ruleset_version": "1.0.0",
            "deterministic": True,
        },
    }


def _evidence(**overrides):
    values = {
        "isolated_structure": _isolated(),
        "target_resolution": _target_resolution(sequence=TARGET_SEQUENCE),
        "strategy_selection": {"selected_strategy": "sequence_target_complex_prediction"},
        "complex_prediction": {"status": "unavailable", "complex_available": False},
        "interface_analysis": {"status": "not_applicable", "present": False},
        "interface_confidence_summary": {"status": "not_applicable"},
        "structural_confidence_summary": _structural_summary(),
        "peptide_sequence": "ACDEFGHIKLMN",
        "peptide_modifications": [],
        "disulfide_bridges": [],
    }
    values.update(overrides)
    return build_structural_evidence(**values)


def _limitation_codes(result):
    return {item["code"] for item in result["known_limitations"]}


def test_structural_evidence_builder_preserves_existing_outputs_by_reference() -> None:
    isolated_structure = {"status": "available", "prediction": {"mean_plddt": 81.0}}
    target_resolution = {"status": "available", "source": "provided_sequence"}
    strategy_selection = {"selected_strategy": "sequence_target_complex_prediction"}
    complex_prediction = {"status": "not_applicable", "complex_available": False}
    interface_analysis = {"status": "not_applicable", "present": False}
    interface_confidence_summary = {"status": "not_applicable"}
    structural_confidence_summary = {
        "status": "available",
        "overall_score": 78,
        "analysis_scope": "isolated_peptide_with_target_context",
    }

    result = build_structural_evidence(
        isolated_structure=isolated_structure,
        target_resolution=target_resolution,
        strategy_selection=strategy_selection,
        complex_prediction=complex_prediction,
        interface_analysis=interface_analysis,
        interface_confidence_summary=interface_confidence_summary,
        structural_confidence_summary=structural_confidence_summary,
    )

    assert result["status"] == "available"
    assert result["analysis_scope"] == "isolated_peptide_with_target_context"
    assert result["generated_by"] == "structural_service"
    assert result["schema_version"] == "1.0.0"
    assert result["validation_status"] == "computational_only"
    assert result["known_limitations"] == []
    assert result["isolated_structure"] is isolated_structure
    assert result["target_resolution"] is target_resolution
    assert result["strategy_selection"] is strategy_selection
    assert result["complex_prediction"] is complex_prediction
    assert result["interface_analysis"] is interface_analysis
    assert result["interface_confidence_summary"] is interface_confidence_summary
    assert result["structural_confidence_summary"] is structural_confidence_summary
    assert result["provenance"] == {
        "generator": "structural_evidence_builder",
        "version": "1.0.0",
        "deterministic": True,
    }


def test_structural_evidence_builder_reuses_structural_confidence_analysis_scope() -> None:
    result = build_structural_evidence(
        isolated_structure={"status": "available"},
        target_resolution={"status": "not_applicable"},
        strategy_selection=None,
        complex_prediction=None,
        interface_analysis={"status": "not_applicable", "present": False},
        interface_confidence_summary=None,
        structural_confidence_summary={"analysis_scope": "isolated_peptide"},
    )

    assert result["analysis_scope"] == "isolated_peptide"
    assert result["known_limitations"] == []
    assert result["validation_status"] == "computational_only"


def test_structural_evidence_builder_status_rules() -> None:
    common = {
        "target_resolution": None,
        "strategy_selection": None,
        "complex_prediction": None,
        "interface_analysis": {"status": "not_applicable", "present": False},
        "interface_confidence_summary": None,
        "structural_confidence_summary": None,
    }

    assert (
        build_structural_evidence(
            isolated_structure={"status": "available"},
            **common,
        )["status"]
        == "available"
    )
    assert (
        build_structural_evidence(
            isolated_structure={"status": "unavailable"},
            **common,
        )["status"]
        == "unavailable"
    )
    assert (
        build_structural_evidence(
            isolated_structure={"status": "not_applicable"},
            **common,
        )["status"]
        == "not_applicable"
    )
    assert (
        build_structural_evidence(
            isolated_structure={"status": "skipped"},
            **common,
        )["status"]
        == "not_applicable"
    )


def test_structural_evidence_pdb_target_remains_computational_only() -> None:
    result = _evidence(target_resolution=_target_resolution(pdb_id="1M17", chain_id="A"))

    assert result["target_resolution"]["status"] == "available"
    assert result["validation_status"] == "computational_only"
    assert result["known_limitations"] == []
    assert StructuralEvidenceObject.model_validate(result)


def test_structural_evidence_uniprot_target_reports_incomplete_target_limitation() -> None:
    result = _evidence(target_resolution=_target_resolution(uniprot_accession="P00533"))

    assert result["validation_status"] == "computational_only"
    assert _limitation_codes(result) == {"missing_or_incomplete_target_information"}


def test_structural_evidence_no_target_reports_missing_target_limitation() -> None:
    result = _evidence(target_resolution=_target_resolution())

    assert result["validation_status"] == "computational_only"
    assert _limitation_codes(result) == {"missing_or_incomplete_target_information"}


def test_structural_evidence_short_peptide_reports_short_sequence_limitation() -> None:
    result = _evidence(peptide_sequence="ACDEFG", isolated_structure=_isolated(n=6))

    assert result["validation_status"] == "computational_only"
    assert _limitation_codes(result) == {"short_sequence_limitations"}


def test_structural_evidence_long_peptide_with_disulfide_bridges_reports_partial_support() -> None:
    result = _evidence(
        peptide_sequence=LONG_PEPTIDE,
        isolated_structure=_isolated(n=len(LONG_PEPTIDE)),
        peptide_modifications=[
            {
                "type": ModType.DISULFIDE.value,
                "site": 0,
                "descriptor": "disulfide",
                "mass_increment_avg_da": -2.0159,
                "mass_increment_mono_da": -2.01565,
                "smiles": None,
                "mass_resolved": True,
                "note": "Disulfide cyclization; bridge geometry carried by disulfide_bridges.",
            }
        ],
        disulfide_bridges=[(21, 22)],
    )

    assert result["validation_status"] == "computational_only"
    assert _limitation_codes(result) == {"partially_supported_modifications"}


def test_structural_evidence_explicit_internal_peptide_validation_is_internally_checked() -> None:
    isolated = _isolated()
    isolated["peptide_validation_evidence"] = {"status": "internal_verification_completed"}

    result = _evidence(isolated_structure=isolated)

    assert result["validation_status"] == "internally_checked"


def test_structural_evidence_explicit_benchmark_validation_is_benchmarked() -> None:
    isolated = _isolated()
    isolated["peptide_validation_evidence"] = {"benchmark_dataset": "peptide_structure_qc_v1"}

    result = _evidence(isolated_structure=isolated)

    assert result["validation_status"] == "benchmarked"


def test_structural_evidence_explicit_peptide_experimental_structure_is_validated() -> None:
    isolated = _isolated()
    isolated["experimental_peptide_structure"] = {"method": "NMR"}

    result = _evidence(isolated_structure=isolated)

    assert result["validation_status"] == "experimentally_validated"


def test_structural_evidence_low_plddt_reports_structural_uncertainty_limitations() -> None:
    result = _evidence(isolated_structure=_isolated(n=12, mean=48.0, minimum=42.0, low_regions=1))

    assert {
        "low_confidence_structural_regions",
        "flexible_or_disordered_peptide_uncertainty",
    } <= _limitation_codes(result)


def test_structural_evidence_unresolved_modification_reports_unsupported_limitation() -> None:
    result = _evidence(
        peptide_modifications=[
            {
                "type": ModType.PEGYLATION.value,
                "site": "N",
                "descriptor": "PEG2000",
                "mass_increment_avg_da": None,
                "mass_increment_mono_da": None,
                "smiles": None,
                "mass_resolved": False,
                "note": "PEGylation mass via cheminformatics engine.",
            }
        ],
    )

    assert _limitation_codes(result) == {"unsupported_or_unresolved_modifications"}
