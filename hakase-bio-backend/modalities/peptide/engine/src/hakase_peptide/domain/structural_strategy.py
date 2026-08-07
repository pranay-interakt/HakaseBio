"""Deterministic structural strategy selection for peptide workflows.

This module only decides which structural analysis strategy is scientifically
appropriate for the normalized target state and local model configuration. It
does not download target data, run complex prediction, or submit external jobs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from hakase_kernel.config import PlatformConfig

SELECTOR_VERSION = "1.0.0"
RULESET_VERSION = "1.0.0"
COMPLEX_PROVIDER = "complex_structure_predictor"


class StructuralStrategyStatus(str, Enum):
    AVAILABLE = "available"
    BLOCKED = "blocked"
    NOT_APPLICABLE = "not_applicable"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True)
class StrategyMessage:
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


@dataclass(frozen=True)
class StructuralStrategySelection:
    status: StructuralStrategyStatus
    selected_strategy: str
    analysis_scope: str
    target_input_type: str | None
    can_run_isolated_prediction: bool
    can_run_complex_prediction: bool
    required_inputs: list[str]
    available_inputs: list[str]
    missing_inputs: list[str]
    required_providers: list[str]
    available_providers: list[str]
    provider_ready: bool
    decision_reason: StrategyMessage
    warnings: list[StrategyMessage] = field(default_factory=list)
    errors: list[StrategyMessage] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "selected_strategy": self.selected_strategy,
            "analysis_scope": self.analysis_scope,
            "target_input_type": self.target_input_type,
            "can_run_isolated_prediction": self.can_run_isolated_prediction,
            "can_run_complex_prediction": self.can_run_complex_prediction,
            "required_inputs": list(self.required_inputs),
            "available_inputs": list(self.available_inputs),
            "missing_inputs": list(self.missing_inputs),
            "required_providers": list(self.required_providers),
            "available_providers": list(self.available_providers),
            "provider_ready": self.provider_ready,
            "decision_reason": self.decision_reason.to_dict(),
            "warnings": [warning.to_dict() for warning in self.warnings],
            "errors": [error.to_dict() for error in self.errors],
            "provenance": {
                "selector": "structural_strategy_selector",
                "selector_version": SELECTOR_VERSION,
                "ruleset_version": RULESET_VERSION,
                "deterministic": True,
                **dict(self.provenance),
            },
        }


def select_structural_strategy(
    *,
    peptide_sequence: str,
    target_resolution: dict[str, Any] | None,
    isolated_structure: dict[str, Any] | None,
    model_configuration: PlatformConfig | dict[str, Any] | None,
    physicochemical_evidence: Any | None = None,
) -> dict[str, Any]:
    selection = _select(
        peptide_sequence=peptide_sequence,
        target_resolution=target_resolution,
        isolated_structure=isolated_structure,
        model_configuration=model_configuration,
        physicochemical_evidence=physicochemical_evidence,
    )
    return selection.to_dict()


def _select(
    *,
    peptide_sequence: str,
    target_resolution: dict[str, Any] | None,
    isolated_structure: dict[str, Any] | None,
    model_configuration: PlatformConfig | dict[str, Any] | None,
    physicochemical_evidence: Any | None = None,
) -> StructuralStrategySelection:
    warnings: list[StrategyMessage] = []
    errors: list[StrategyMessage] = []
    available_inputs = ["peptide_sequence"] if peptide_sequence else []
    if _isolated_available(isolated_structure):
        available_inputs.append("isolated_peptide_structure")
    if physicochemical_evidence is not None:
        available_inputs.append("physicochemical_evidence")
    provenance = _physicochemical_provenance(physicochemical_evidence)

    provider_ready = _complex_provider_ready(model_configuration)
    supports_pdb = _provider_supports(model_configuration, "pdb")
    supports_sequence = _provider_supports(model_configuration, "sequence")
    available_providers = [COMPLEX_PROVIDER] if provider_ready else []

    resolved_target = _resolved_target(target_resolution)
    target_supplied = _target_supplied(target_resolution)
    target_available_inputs = _target_available_inputs(target_resolution, resolved_target)
    available_inputs.extend(
        field for field in target_available_inputs if field not in available_inputs
    )

    if not target_supplied:
        return _selection(
            status=StructuralStrategyStatus.NOT_APPLICABLE,
            selected_strategy="isolated_peptide_only",
            analysis_scope="isolated_peptide",
            target_input_type=None,
            can_run_complex_prediction=False,
            required_inputs=["peptide_sequence"],
            available_inputs=available_inputs,
            missing_inputs=[],
            required_providers=[],
            available_providers=available_providers,
            provider_ready=False,
            reason=StrategyMessage(
                "target_not_supplied",
                "No target was supplied, so peptide-target complex prediction is not applicable.",
            ),
            warnings=warnings,
            errors=errors,
            provenance=provenance,
        )

    if not isinstance(target_resolution, dict):
        errors.append(
            StrategyMessage(
                "target_resolution_invalid",
                "Target resolution is missing or invalid; provide a normalized target_resolution object.",
            )
        )
        return _blocked(
            available_inputs,
            available_providers,
            provider_ready,
            ["target_resolution"],
            errors=errors,
            provenance=provenance,
        )

    pdb_id = _clean(resolved_target.get("pdb_id"))
    chain_id = _clean(resolved_target.get("chain_id"))
    target_sequence = _clean(resolved_target.get("sequence"))
    source = _clean(target_resolution.get("source"))

    if pdb_id:
        required_inputs = ["peptide_sequence", "target_pdb"]
        if chain_id:
            required_inputs.append("target_chain")
        else:
            warnings.append(
                StrategyMessage(
                    "target_chain_not_selected",
                    "A target PDB ID is available, but no chain was supplied; chain selection is required before execution.",
                )
            )
        warnings.extend(_verification_warnings(target_resolution, "pdb"))
        return _complex_selection(
            provider_ready=provider_ready and supports_pdb,
            selected_strategy="pdb_target_complex_prediction",
            target_input_type="pdb",
            required_inputs=required_inputs,
            available_inputs=available_inputs,
            available_providers=available_providers,
            reason=StrategyMessage(
                "target_pdb_available",
                "A target PDB structure is available for PDB-based peptide-target complex prediction.",
            ),
            warnings=warnings,
            provenance=provenance,
        )

    if target_sequence:
        return _complex_selection(
            provider_ready=provider_ready and supports_sequence,
            selected_strategy="sequence_target_complex_prediction",
            target_input_type="sequence",
            required_inputs=["peptide_sequence", "target_sequence"],
            available_inputs=available_inputs,
            available_providers=available_providers,
            reason=StrategyMessage(
                "target_sequence_available",
                "A target sequence is available for sequence-based peptide-target complex prediction.",
            ),
            warnings=warnings,
            provenance=provenance,
        )

    missing = (
        ["resolved_target_sequence_or_pdb"]
        if source == "provided_uniprot" or "uniprot_accession" in target_available_inputs
        else ["target_sequence_or_pdb"]
    )
    return _blocked(
        available_inputs,
        available_providers,
        provider_ready,
        missing,
        reason=StrategyMessage(
            "target_resolution_incomplete",
            "Target information was supplied, but no target sequence or verified PDB structure is available.",
        ),
        warnings=warnings,
        errors=errors,
        provenance=provenance,
    )


def _complex_selection(
    *,
    provider_ready: bool,
    selected_strategy: str,
    target_input_type: str,
    required_inputs: list[str],
    available_inputs: list[str],
    available_providers: list[str],
    reason: StrategyMessage,
    warnings: list[StrategyMessage],
    provenance: dict[str, Any] | None = None,
) -> StructuralStrategySelection:
    provider_warnings = list(warnings)
    if not provider_ready:
        provider_warnings.append(
            StrategyMessage(
                "complex_provider_not_configured",
                "The required complex-prediction provider is not configured.",
            )
        )
    return _selection(
        status=(
            StructuralStrategyStatus.AVAILABLE
            if provider_ready
            else StructuralStrategyStatus.UNAVAILABLE
        ),
        selected_strategy=selected_strategy,
        analysis_scope="peptide_target_complex",
        target_input_type=target_input_type,
        can_run_complex_prediction=provider_ready,
        required_inputs=required_inputs,
        available_inputs=available_inputs,
        missing_inputs=[],
        required_providers=[COMPLEX_PROVIDER],
        available_providers=available_providers,
        provider_ready=provider_ready,
        reason=reason,
        warnings=provider_warnings,
        errors=[],
        provenance=provenance,
    )


def _blocked(
    available_inputs: list[str],
    available_providers: list[str],
    provider_ready: bool,
    missing_inputs: list[str],
    *,
    reason: StrategyMessage | None = None,
    warnings: list[StrategyMessage] | None = None,
    errors: list[StrategyMessage] | None = None,
    provenance: dict[str, Any] | None = None,
) -> StructuralStrategySelection:
    return _selection(
        status=StructuralStrategyStatus.BLOCKED,
        selected_strategy="target_enrichment_required",
        analysis_scope="target_resolution",
        target_input_type=None,
        can_run_complex_prediction=False,
        required_inputs=["peptide_sequence", *missing_inputs],
        available_inputs=available_inputs,
        missing_inputs=missing_inputs,
        required_providers=[],
        available_providers=available_providers,
        provider_ready=provider_ready,
        reason=reason
        or StrategyMessage(
            "target_resolution_incomplete",
            "Target information was supplied, but no target sequence or verified PDB structure is available.",
        ),
        warnings=list(warnings or []),
        errors=list(errors or []),
        provenance=provenance,
    )


def _selection(
    *,
    status: StructuralStrategyStatus,
    selected_strategy: str,
    analysis_scope: str,
    target_input_type: str | None,
    can_run_complex_prediction: bool,
    required_inputs: list[str],
    available_inputs: list[str],
    missing_inputs: list[str],
    required_providers: list[str],
    available_providers: list[str],
    provider_ready: bool,
    reason: StrategyMessage,
    warnings: list[StrategyMessage],
    errors: list[StrategyMessage],
    provenance: dict[str, Any] | None = None,
) -> StructuralStrategySelection:
    return StructuralStrategySelection(
        status=status,
        selected_strategy=selected_strategy,
        analysis_scope=analysis_scope,
        target_input_type=target_input_type,
        can_run_isolated_prediction=True,
        can_run_complex_prediction=can_run_complex_prediction,
        required_inputs=_dedupe(required_inputs),
        available_inputs=_dedupe(available_inputs),
        missing_inputs=_dedupe(missing_inputs),
        required_providers=_dedupe(required_providers),
        available_providers=_dedupe(available_providers),
        provider_ready=provider_ready,
        decision_reason=reason,
        warnings=_dedupe_messages(warnings),
        errors=_dedupe_messages(errors),
        provenance=dict(provenance or {}),
    )


def _physicochemical_provenance(physicochemical_evidence: Any | None) -> dict[str, Any]:
    if physicochemical_evidence is None:
        return {}
    evidence_id = getattr(physicochemical_evidence, "evidence_id", None)
    payload = getattr(physicochemical_evidence, "scientific_payload", None)
    payload_keys = sorted(payload.keys()) if isinstance(payload, dict) else []
    provenance: dict[str, Any] = {
        "physicochemical_evidence_provided": True,
        "physicochemical_payload_keys": payload_keys,
    }
    if evidence_id:
        provenance["upstream_physicochemical_evidence_id"] = str(evidence_id)
    return provenance


def _target_supplied(target_resolution: dict[str, Any] | None) -> bool:
    if not isinstance(target_resolution, dict):
        return bool(target_resolution)
    if target_resolution.get("status") in {"not_provided", "not_applicable"}:
        return False
    if target_resolution.get("input") or target_resolution.get("resolved_target"):
        return True
    return bool(target_resolution.get("available_inputs"))


def _resolved_target(target_resolution: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(target_resolution, dict):
        return {}
    resolved = target_resolution.get("resolved_target")
    if isinstance(resolved, dict):
        return resolved
    input_payload = target_resolution.get("input")
    if isinstance(input_payload, dict):
        return input_payload
    return {}


def _target_available_inputs(
    target_resolution: dict[str, Any] | None, resolved_target: dict[str, Any]
) -> list[str]:
    available = []
    if isinstance(target_resolution, dict) and isinstance(
        target_resolution.get("available_inputs"), list
    ):
        available.extend(
            _canonical_target_input(str(item)) for item in target_resolution["available_inputs"]
        )
    for field_name, canonical_name in (
        ("sequence", "target_sequence"),
        ("pdb_id", "target_pdb"),
        ("chain_id", "target_chain"),
        ("uniprot_accession", "uniprot_accession"),
        ("name", "target_name"),
    ):
        if resolved_target.get(field_name):
            available.append(canonical_name)
    return _dedupe(available)


def _canonical_target_input(field_name: str) -> str:
    return {
        "name": "target_name",
        "sequence": "target_sequence",
        "pdb_id": "target_pdb",
        "chain_id": "target_chain",
        "organism": "target_organism",
    }.get(field_name, field_name)


def _complex_provider_ready(config: PlatformConfig | dict[str, Any] | None) -> bool:
    if config is None:
        return False
    if isinstance(config, dict):
        if "complex_structure_predictor" in config:
            return bool(config["complex_structure_predictor"])
        if "complex_prediction_provider_configured" in config:
            return bool(config["complex_prediction_provider_configured"])
        return bool(config.get("conformation_layer_enabled") or config.get("gpu_provider"))
    return bool(getattr(config, "conformation_layer_enabled", False))


def _provider_supports(config: PlatformConfig | dict[str, Any] | None, input_type: str) -> bool:
    if not isinstance(config, dict):
        return True
    key = f"supports_{input_type}_input"
    if key in config:
        return bool(config[key])
    provider = config.get("complex_structure_predictor")
    if isinstance(provider, dict):
        provider_key = f"supports_{input_type}_input"
        if provider_key in provider:
            return bool(provider[provider_key])
    return True


def _isolated_available(isolated_structure: dict[str, Any] | None) -> bool:
    return isinstance(isolated_structure, dict) and isolated_structure.get("status") == "available"


def _verification_warnings(
    target_resolution: dict[str, Any] | None, input_type: str
) -> list[StrategyMessage]:
    if input_type != "pdb" or not isinstance(target_resolution, dict):
        return []
    warnings = []
    provenance = target_resolution.get("provenance") or {}
    if isinstance(provenance, dict) and not provenance.get("network_lookup_performed"):
        warnings.append(
            StrategyMessage(
                "target_pdb_not_verified",
                "Provided PDB information was preserved but not downloaded or verified.",
            )
        )
    return warnings


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _dedupe_messages(messages: list[StrategyMessage]) -> list[StrategyMessage]:
    seen: set[str] = set()
    out: list[StrategyMessage] = []
    for message in messages:
        if message.code in seen:
            continue
        seen.add(message.code)
        out.append(message)
    return out
