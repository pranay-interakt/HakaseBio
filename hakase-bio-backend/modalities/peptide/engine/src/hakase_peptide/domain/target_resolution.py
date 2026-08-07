"""Deterministic target resolution for peptide structural workflows.

Task 12 validates and normalizes target syntax. This module interprets that
validated target into one canonical, typed result without fabricating missing
biological or structural data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Protocol

from .target import Target

RESOLVER_VERSION = "1.0.0"
AVAILABLE_INPUT_ORDER = (
    "name",
    "uniprot_accession",
    "sequence",
    "pdb_id",
    "chain_id",
    "organism",
)


class TargetResolutionStatus(str, Enum):
    AVAILABLE = "available"
    BLOCKED = "blocked"
    NOT_APPLICABLE = "not_applicable"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"


class TargetResolutionLevel(str, Enum):
    NONE = "none"
    IDENTIFIER_ONLY = "identifier_only"
    SEQUENCE_ONLY = "sequence_only"
    STRUCTURE_ONLY = "structure_only"
    SEQUENCE_AND_IDENTIFIER = "sequence_and_identifier"
    STRUCTURE_AND_IDENTIFIER = "structure_and_identifier"
    STRUCTURE_AND_SEQUENCE = "structure_and_sequence"
    COMPLETE = "complete"


class TargetResolutionSource(str, Enum):
    NONE = "none"
    PROVIDED_PDB = "provided_pdb"
    PROVIDED_SEQUENCE = "provided_sequence"
    PROVIDED_UNIPROT = "provided_uniprot"
    PROVIDED_NAME = "provided_name"
    PROVIDED_COMBINATION = "provided_combination"
    UNIPROT_LOOKUP = "uniprot_lookup"
    PDB_LOOKUP = "pdb_lookup"


class TargetResolutionConfidence(str, Enum):
    HIGH = "high"
    MODERATE = "moderate"
    LOW = "low"
    NOT_APPLICABLE = "not_applicable"


@dataclass(frozen=True)
class TargetResolutionWarning:
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


@dataclass(frozen=True)
class TargetResolutionError:
    code: str
    message: str
    recoverable: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "recoverable": self.recoverable}


@dataclass(frozen=True)
class ProviderResolution:
    name: str
    status: str
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def provenance(self) -> dict[str, Any]:
        payload = {"name": self.name, "status": self.status}
        payload.update(
            {
                key: value
                for key, value in self.data.items()
                if key
                in {
                    "accession",
                    "pdb_id",
                    "chain_id",
                    "sequence_length",
                    "found",
                }
                and value is not None
            }
        )
        if self.error:
            payload["error"] = self.error
        return payload


class TargetResolutionProvider(Protocol):
    name: str

    def resolve_uniprot(self, accession: str) -> dict[str, Any] | None: ...

    def resolve_pdb(self, pdb_id: str, chain_id: str | None = None) -> dict[str, Any] | None: ...


@dataclass(frozen=True)
class TargetResolutionResult:
    status: TargetResolutionStatus
    resolution_level: TargetResolutionLevel
    source: TargetResolutionSource
    input: dict[str, Any] | None
    resolved_target: dict[str, Any] | None
    available_inputs: list[str]
    selected_strategy: TargetResolutionSource
    confidence: TargetResolutionConfidence
    warnings: list[TargetResolutionWarning] = field(default_factory=list)
    errors: list[TargetResolutionError] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "resolution_level": self.resolution_level.value,
            "source": self.source.value,
            "input": self.input,
            "resolved_target": self.resolved_target,
            "available_inputs": list(self.available_inputs),
            "selected_strategy": self.selected_strategy.value,
            "confidence": self.confidence.value,
            "warnings": [warning.to_dict() for warning in self.warnings],
            "errors": [error.to_dict() for error in self.errors],
            "provenance": dict(self.provenance),
        }


class TargetResolver:
    def __init__(self, providers: list[TargetResolutionProvider] | None = None) -> None:
        self._providers = list(providers or [])

    def resolve_target(self, target: Target | None) -> TargetResolutionResult:
        if target is None:
            return self._not_provided()

        input_payload = _target_payload(target)
        resolved = dict(input_payload)
        resolved["sequence_length"] = len(target.sequence) if target.sequence else None
        available_inputs = [
            field_name for field_name in AVAILABLE_INPUT_ORDER if input_payload.get(field_name)
        ]
        source = _select_source(target)
        warnings: list[TargetResolutionWarning] = []
        errors: list[TargetResolutionError] = []
        provider_results: list[ProviderResolution] = []
        network_lookup_performed = False

        if self._providers:
            if target.pdb_id:
                network_lookup_performed = True
                provider_results.extend(
                    self._resolve_with_providers(
                        "pdb", target.pdb_id, target.chain_id, resolved, warnings, errors
                    )
                )
            if target.uniprot_accession:
                network_lookup_performed = True
                provider_results.extend(
                    self._resolve_with_providers(
                        "uniprot",
                        target.uniprot_accession,
                        target.chain_id,
                        resolved,
                        warnings,
                        errors,
                    )
                )
        else:
            if target.pdb_id:
                warnings.append(
                    TargetResolutionWarning(
                        "target_pdb_lookup_unavailable",
                        "PDB lookup is not configured; PDB ID and chain were not verified.",
                    )
                )
            if target.uniprot_accession and not target.sequence:
                warnings.append(
                    TargetResolutionWarning(
                        "target_uniprot_lookup_unavailable",
                        "UniProt lookup is not configured; accession was preserved without sequence enrichment.",
                    )
                )

        warnings.extend(_local_warnings(target, source, network_lookup_performed))
        resolution_level = _resolution_level(resolved)
        status = _status_for(target, resolution_level, errors)
        confidence = _confidence_for(target, resolved, resolution_level, provider_results)

        return TargetResolutionResult(
            status=status,
            resolution_level=resolution_level,
            source=source,
            input=input_payload,
            resolved_target=resolved,
            available_inputs=available_inputs,
            selected_strategy=source,
            confidence=confidence,
            warnings=_dedupe_warnings(warnings),
            errors=errors,
            provenance={
                "resolver": "target_resolver",
                "resolver_version": RESOLVER_VERSION,
                "selected_source": source.value,
                "network_lookup_performed": network_lookup_performed,
                "providers": [result.provenance() for result in provider_results],
            },
        )

    def _resolve_with_providers(
        self,
        kind: str,
        identifier: str,
        chain_id: str | None,
        resolved: dict[str, Any],
        warnings: list[TargetResolutionWarning],
        errors: list[TargetResolutionError],
    ) -> list[ProviderResolution]:
        results: list[ProviderResolution] = []
        for provider in self._providers:
            try:
                if kind == "uniprot":
                    data = provider.resolve_uniprot(identifier)
                else:
                    data = provider.resolve_pdb(identifier, chain_id)
            except TimeoutError as exc:
                errors.append(
                    TargetResolutionError(
                        "target_provider_timeout",
                        f"{provider.name} target resolution timed out.",
                        recoverable=True,
                    )
                )
                results.append(ProviderResolution(provider.name, "timeout", error=str(exc)))
                continue
            except Exception as exc:  # noqa: BLE001 - provider failures are recoverable here
                errors.append(
                    TargetResolutionError(
                        "target_provider_error",
                        f"{provider.name} target resolution failed.",
                        recoverable=True,
                    )
                )
                results.append(ProviderResolution(provider.name, "error", error=str(exc)))
                continue

            if not data:
                warnings.append(
                    TargetResolutionWarning(
                        f"target_{kind}_provider_incomplete",
                        f"{provider.name} returned no usable target {kind} data.",
                    )
                )
                results.append(ProviderResolution(provider.name, "not_found", {"found": False}))
                continue

            self._merge_provider_data(kind, provider.name, data, chain_id, resolved, warnings)
            results.append(ProviderResolution(provider.name, "success", data))
        return results

    @staticmethod
    def _merge_provider_data(
        kind: str,
        provider_name: str,
        data: dict[str, Any],
        chain_id: str | None,
        resolved: dict[str, Any],
        warnings: list[TargetResolutionWarning],
    ) -> None:
        provider_sequence = data.get("sequence")
        if provider_sequence:
            if resolved.get("sequence") and len(resolved["sequence"]) != len(provider_sequence):
                warnings.append(
                    TargetResolutionWarning(
                        "target_sequence_conflict",
                        "Provided target sequence length differs from provider sequence length; explicit input was preserved.",
                    )
                )
            elif not resolved.get("sequence"):
                resolved["sequence"] = provider_sequence
                resolved["sequence_length"] = len(provider_sequence)

        for field_name, provider_key in (
            ("name", "name"),
            ("uniprot_accession", "uniprot_accession"),
            ("organism", "organism"),
        ):
            value = data.get(provider_key)
            if value and not resolved.get(field_name):
                resolved[field_name] = value

        if kind == "pdb" and chain_id:
            chains = data.get("chains")
            if isinstance(chains, list) and chain_id not in chains:
                warnings.append(
                    TargetResolutionWarning(
                        "target_chain_conflict",
                        f"Provided chain_id '{chain_id}' was not found in {provider_name} PDB metadata.",
                    )
                )

    @staticmethod
    def _not_provided() -> TargetResolutionResult:
        return TargetResolutionResult(
            status=TargetResolutionStatus.NOT_APPLICABLE,
            resolution_level=TargetResolutionLevel.NONE,
            source=TargetResolutionSource.NONE,
            input=None,
            resolved_target=None,
            available_inputs=[],
            selected_strategy=TargetResolutionSource.NONE,
            confidence=TargetResolutionConfidence.NOT_APPLICABLE,
            warnings=[],
            errors=[],
            provenance={
                "resolver": "target_resolver",
                "resolver_version": RESOLVER_VERSION,
                "selected_source": TargetResolutionSource.NONE.value,
                "network_lookup_performed": False,
                "providers": [],
            },
        )


def resolve_target(target: Target | None) -> dict[str, Any]:
    return TargetResolver().resolve_target(target).to_dict()


def _target_payload(target: Target) -> dict[str, Any]:
    return {
        "name": target.name,
        "uniprot_accession": target.uniprot_accession,
        "sequence": target.sequence,
        "pdb_id": target.pdb_id,
        "chain_id": target.chain_id,
        "organism": target.organism,
    }


def _select_source(target: Target) -> TargetResolutionSource:
    if target.pdb_id:
        return TargetResolutionSource.PROVIDED_PDB
    if target.sequence:
        return TargetResolutionSource.PROVIDED_SEQUENCE
    if target.uniprot_accession:
        return TargetResolutionSource.PROVIDED_UNIPROT
    if target.name:
        return TargetResolutionSource.PROVIDED_NAME
    return TargetResolutionSource.NONE


def _resolution_level(resolved: dict[str, Any]) -> TargetResolutionLevel:
    has_structure = bool(resolved.get("pdb_id"))
    has_sequence = bool(resolved.get("sequence"))
    has_identifier = bool(
        resolved.get("uniprot_accession") or resolved.get("name") or resolved.get("organism")
    )
    if has_structure and has_sequence and has_identifier:
        return TargetResolutionLevel.COMPLETE
    if has_structure and has_sequence:
        return TargetResolutionLevel.STRUCTURE_AND_SEQUENCE
    if has_structure and has_identifier:
        return TargetResolutionLevel.STRUCTURE_AND_IDENTIFIER
    if has_structure:
        return TargetResolutionLevel.STRUCTURE_ONLY
    if has_sequence and has_identifier:
        return TargetResolutionLevel.SEQUENCE_AND_IDENTIFIER
    if has_sequence:
        return TargetResolutionLevel.SEQUENCE_ONLY
    if has_identifier:
        return TargetResolutionLevel.IDENTIFIER_ONLY
    return TargetResolutionLevel.NONE


def _status_for(
    target: Target,
    level: TargetResolutionLevel,
    errors: list[TargetResolutionError],
) -> TargetResolutionStatus:
    if errors and level is TargetResolutionLevel.NONE:
        return TargetResolutionStatus.UNAVAILABLE
    if target.pdb_id or target.sequence:
        return TargetResolutionStatus.AVAILABLE
    if target.uniprot_accession or target.name:
        return TargetResolutionStatus.BLOCKED
    return TargetResolutionStatus.BLOCKED


def _confidence_for(
    target: Target,
    resolved: dict[str, Any],
    level: TargetResolutionLevel,
    provider_results: list[ProviderResolution],
) -> TargetResolutionConfidence:
    if target.pdb_id and target.chain_id:
        return TargetResolutionConfidence.HIGH
    if target.pdb_id and target.sequence:
        return TargetResolutionConfidence.HIGH
    if target.sequence and target.uniprot_accession:
        return TargetResolutionConfidence.HIGH
    if target.pdb_id:
        return TargetResolutionConfidence.MODERATE
    if target.sequence:
        return TargetResolutionConfidence.MODERATE
    if (
        target.uniprot_accession
        and resolved.get("sequence")
        and any(result.status == "success" for result in provider_results)
    ):
        return TargetResolutionConfidence.MODERATE
    if level is TargetResolutionLevel.NONE:
        return TargetResolutionConfidence.NOT_APPLICABLE
    return TargetResolutionConfidence.LOW


def _local_warnings(
    target: Target,
    source: TargetResolutionSource,
    network_lookup_performed: bool,
) -> list[TargetResolutionWarning]:
    warnings: list[TargetResolutionWarning] = []
    if source is TargetResolutionSource.PROVIDED_NAME:
        warnings.append(
            TargetResolutionWarning(
                "target_name_only",
                "Target name alone is insufficient for reliable structural prediction; provide a sequence, UniProt accession, or PDB ID.",
            )
        )
    if not target.sequence and not target.pdb_id:
        warnings.append(
            TargetResolutionWarning(
                "target_sequence_unavailable",
                "A target sequence was not provided or resolved.",
            )
        )
    if target.pdb_id and target.chain_id and not network_lookup_performed:
        warnings.append(
            TargetResolutionWarning(
                "target_chain_not_verified",
                "Provided PDB chain was preserved but not verified against PDB metadata.",
            )
        )
    if (target.sequence and target.uniprot_accession) or (target.sequence and target.pdb_id):
        warnings.append(
            TargetResolutionWarning(
                "target_inputs_not_cross_validated",
                "Explicit target inputs were preserved but not cross-validated against external records.",
            )
        )
    return warnings


def _dedupe_warnings(
    warnings: list[TargetResolutionWarning],
) -> list[TargetResolutionWarning]:
    seen: set[str] = set()
    deduped: list[TargetResolutionWarning] = []
    for warning in warnings:
        if warning.code in seen:
            continue
        seen.add(warning.code)
        deduped.append(warning)
    return deduped
