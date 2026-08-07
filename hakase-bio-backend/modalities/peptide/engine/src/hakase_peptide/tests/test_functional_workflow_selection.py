from __future__ import annotations

from typing import Any

import pytest

from hakase_peptide.domain.functional_routing import (
    GENERIC_MODALITY,
    FunctionalWorkflowStatus,
    known_modalities,
    select_functional_workflow,
)


def _no_target() -> dict[str, Any]:
    return {}


def _with_target() -> dict[str, Any]:
    return {"status": "resolved", "target": {"sequence": "MRPSGTAGAALLALLAALCPASRA"}}


@pytest.mark.parametrize("modality", list(known_modalities()))
def test_recognized_modality_is_selected_not_fallback(modality: str) -> None:
    result = select_functional_workflow(modality=modality, target_resolution=_no_target())
    assert result["status"] == FunctionalWorkflowStatus.SELECTED.value
    assert result["resolved_modality"] == modality
    assert result["config"]["modality"] == modality
    # every dedicated modality declares at least one structured predictor
    assert result["config"]["structured_predictors"]
    assert result["decision_reason"]["code"] == "modality_recognized"


def test_unrecognized_modality_falls_back_and_is_annotated() -> None:
    result = select_functional_workflow(
        modality="not_a_real_modality", target_resolution=_no_target()
    )
    assert result["status"] == FunctionalWorkflowStatus.FALLBACK.value
    assert result["resolved_modality"] == GENERIC_MODALITY
    codes = {w["code"] for w in result["warnings"]}
    assert "modality_unrecognized" in codes


def test_missing_modality_falls_back_and_is_annotated() -> None:
    result = select_functional_workflow(modality=None, target_resolution=_no_target())
    assert result["status"] == FunctionalWorkflowStatus.FALLBACK.value
    assert result["resolved_modality"] == GENERIC_MODALITY
    codes = {w["code"] for w in result["warnings"]}
    assert "modality_not_specified" in codes


def test_engagement_eligible_only_when_target_supplied() -> None:
    without = select_functional_workflow(
        modality="receptor_binding", target_resolution=_no_target()
    )
    assert without["engagement_requested"] is False
    assert without["engagement_eligible"] is False
    # structural_interface_scoring modality + no target -> explicit warning
    codes = {w["code"] for w in without["warnings"]}
    assert "target_engagement_not_requested" in codes

    withit = select_functional_workflow(
        modality="receptor_binding", target_resolution=_with_target()
    )
    assert withit["engagement_requested"] is True
    assert withit["engagement_eligible"] is True


def test_provenance_is_deterministic_and_versioned() -> None:
    result = select_functional_workflow(modality="antimicrobial", target_resolution=_no_target())
    prov = result["provenance"]
    assert prov["deterministic"] is True
    assert prov["selector"] == "functional_workflow_selector"
    assert "selector_version" in prov and "ruleset_version" in prov
    assert set(known_modalities()) <= set(prov["known_modalities"])


def test_reference_datasets_are_modality_specific() -> None:
    amp = select_functional_workflow(modality="antimicrobial", target_resolution=_no_target())
    assert "DBAASP" in amp["config"]["reference_datasets"]

    cpp = select_functional_workflow(modality="cell_penetrating", target_resolution=_no_target())
    assert "SATPdb" in cpp["config"]["reference_datasets"]
