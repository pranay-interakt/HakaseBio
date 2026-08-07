"""Deterministic workflow routing for the Functional Analysis Service.

Functional Analysis Service Specification §5.1, §6.1: a deterministic rule-based
module that maps a declared or inferred therapeutic modality to the specific set
of Functional Predictors, similarity reference datasets, and target engagement
procedures appropriate to that modality. Per the Architecture Specification's AI
Usage Philosophy (§1.6), modality/workflow routing is a Deterministic Algorithm,
not a learned classifier — this module performs no predictive computation of its
own; it only configures the rest of the pipeline.

This module does not run any prediction, fetch any data, or call any model. It
only decides which predictors/datasets/procedures are scientifically appropriate
for a given modality.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

SELECTOR_VERSION = "1.0.0"
RULESET_VERSION = "1.0.0"

# The generic fallback used when a modality is unspecified or unrecognized
# (§12: "proceed with a generic/default predictor set ... record the fallback
# explicitly in provenance", rather than silently guessing or hard-failing).
GENERIC_MODALITY = "general"


class FunctionalWorkflowStatus(str, Enum):
    SELECTED = "selected"
    FALLBACK = "fallback"  # unrecognized modality -> generic config, annotated
    NOT_APPLICABLE = "not_applicable"  # no modality at all and no target either


@dataclass(frozen=True)
class RoutingMessage:
    code: str
    message: str

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}


@dataclass(frozen=True)
class ModalityConfig:
    """One rule-table row: §6.1's config(m) = ({predictors}_m, {reference
    datasets}_m, engagement_procedure_m)."""

    modality: str
    structured_predictors: tuple[str, ...]
    embedding_predictors: tuple[str, ...]
    reference_datasets: tuple[str, ...]
    engagement_procedure: str
    biological_rationale: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "modality": self.modality,
            "structured_predictors": list(self.structured_predictors),
            "embedding_predictors": list(self.embedding_predictors),
            "reference_datasets": list(self.reference_datasets),
            "engagement_procedure": self.engagement_procedure,
            "biological_rationale": self.biological_rationale,
        }


@dataclass(frozen=True)
class FunctionalWorkflowSelection:
    status: FunctionalWorkflowStatus
    requested_modality: str | None
    resolved_modality: str
    config: ModalityConfig
    engagement_requested: bool
    engagement_eligible: bool
    decision_reason: RoutingMessage
    warnings: list[RoutingMessage] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "requested_modality": self.requested_modality,
            "resolved_modality": self.resolved_modality,
            "config": self.config.to_dict(),
            "engagement_requested": self.engagement_requested,
            "engagement_eligible": self.engagement_eligible,
            "decision_reason": self.decision_reason.to_dict(),
            "warnings": [w.to_dict() for w in self.warnings],
            "provenance": {
                "selector": "functional_workflow_selector",
                "selector_version": SELECTOR_VERSION,
                "ruleset_version": RULESET_VERSION,
                "deterministic": True,
                **dict(self.provenance),
            },
        }


# ---- the rule table (§6.1, §7 biological rationale) -------------------------
#
# Each modality's biophysical mechanism determines which tools are mechanistically
# appropriate (§6.1's rationale): antimicrobial activity is membrane/amphipathicity
# driven, receptor engagement is steric/electrostatic-interface driven, enzyme
# inhibition is active-site-geometry driven — so no single model serves all of
# them. Extending this table is the sanctioned way to add a new modality (§15).
_RULE_TABLE: dict[str, ModalityConfig] = {
    "antimicrobial": ModalityConfig(
        modality="antimicrobial",
        structured_predictors=("antimicrobial_activity", "hemolytic_liability"),
        embedding_predictors=("antimicrobial_activity_embedding",),
        reference_datasets=("DBAASP", "APD3"),
        engagement_procedure="membrane_interaction_heuristic",
        biological_rationale=(
            "Antimicrobial activity depends heavily on membrane interaction and "
            "amphipathicity rather than a discrete binding pocket."
        ),
    ),
    "cell_penetrating": ModalityConfig(
        modality="cell_penetrating",
        structured_predictors=("cell_penetration_activity",),
        embedding_predictors=("cell_penetration_activity_embedding",),
        reference_datasets=("SATPdb",),
        engagement_procedure="membrane_interaction_heuristic",
        biological_rationale=(
            "Cell-penetrating activity is governed by cationic/amphipathic "
            "membrane translocation, mechanistically related to but distinct "
            "from antimicrobial membrane disruption."
        ),
    ),
    "receptor_binding": ModalityConfig(
        modality="receptor_binding",
        structured_predictors=("receptor_binding_propensity",),
        embedding_predictors=("receptor_binding_propensity_embedding",),
        reference_datasets=("SATPdb", "ChEMBL"),
        engagement_procedure="structural_interface_scoring",
        biological_rationale=(
            "Receptor engagement depends on precise steric and electrostatic "
            "complementarity at a binding interface, requiring structural "
            "complex evidence when available rather than sequence alone."
        ),
    ),
    "enzyme_inhibitory": ModalityConfig(
        modality="enzyme_inhibitory",
        structured_predictors=("enzyme_inhibition_propensity",),
        embedding_predictors=("enzyme_inhibition_propensity_embedding",),
        reference_datasets=("ChEMBL",),
        engagement_procedure="structural_interface_scoring",
        biological_rationale=(
            "Enzyme inhibition depends on active-site geometry, requiring "
            "structural complex evidence when available rather than sequence "
            "alone."
        ),
    ),
    GENERIC_MODALITY: ModalityConfig(
        modality=GENERIC_MODALITY,
        structured_predictors=("antimicrobial_activity", "cell_penetration_activity"),
        embedding_predictors=(),
        reference_datasets=("PeptideAtlas",),
        engagement_procedure="structural_interface_scoring",
        biological_rationale=(
            "No specific therapeutic modality was declared or recognized; a "
            "modality-general predictor set is used instead of guessing a "
            "mechanism, and the fallback is recorded explicitly (§12)."
        ),
    ),
}


def known_modalities() -> tuple[str, ...]:
    """Modalities with a dedicated (non-fallback) rule-table entry."""
    return tuple(m for m in _RULE_TABLE if m != GENERIC_MODALITY)


def select_functional_workflow(
    *,
    modality: str | None,
    target_resolution: dict[str, Any] | None,
    model_configuration: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Public entry point — mirrors ``select_structural_strategy``'s shape.

    Never raises for an unrecognized/missing modality (§12): falls back to the
    generic config and records that explicitly in ``status``/``warnings``/
    ``provenance`` rather than rejecting the request or guessing silently.
    """
    selection = _select(
        modality=modality,
        target_resolution=target_resolution,
        model_configuration=model_configuration,
    )
    return selection.to_dict()


def _target_supplied(target_resolution: dict[str, Any] | None) -> bool:
    if not target_resolution:
        return False
    # target_resolution follows domain/target_resolution.py's shape: a dict
    # that is falsy/empty when no target was supplied, and otherwise carries
    # at least a resolution `status`/`target` payload.
    return bool(target_resolution.get("target") or target_resolution.get("status"))


def _select(
    *,
    modality: str | None,
    target_resolution: dict[str, Any] | None,
    model_configuration: dict[str, Any] | None,
) -> FunctionalWorkflowSelection:
    warnings: list[RoutingMessage] = []
    normalized = modality.strip().lower().replace("-", "_") if modality else None

    if normalized and normalized in _RULE_TABLE and normalized != GENERIC_MODALITY:
        status = FunctionalWorkflowStatus.SELECTED
        resolved = normalized
        reason = RoutingMessage(
            code="modality_recognized",
            message=f"Modality '{resolved}' matched a dedicated rule-table entry.",
        )
    else:
        status = FunctionalWorkflowStatus.FALLBACK
        resolved = GENERIC_MODALITY
        if normalized is None:
            code, msg = (
                "modality_not_specified",
                "No modality was declared; using the generic predictor set.",
            )
        else:
            code, msg = (
                "modality_unrecognized",
                f"Modality '{modality}' is not in the rule table; using the "
                "generic predictor set. See §15 to add a dedicated entry.",
            )
        reason = RoutingMessage(code=code, message=msg)
        warnings.append(reason)

    config = _RULE_TABLE[resolved]
    target_supplied = _target_supplied(target_resolution)
    # Engagement is only *eligible* when a target was actually supplied; whether
    # a structural complex is actually available is decided downstream by the
    # Target Engagement Estimator itself (M5), which also needs structural
    # evidence this module never sees.
    engagement_eligible = target_supplied

    if (
        modality
        and not target_supplied
        and config.engagement_procedure == "structural_interface_scoring"
    ):
        warnings.append(
            RoutingMessage(
                code="target_engagement_not_requested",
                message=(
                    f"Modality '{resolved}' typically benefits from target "
                    "engagement scoring, but no target was supplied; target "
                    "engagement will be reported as not_applicable."
                ),
            )
        )

    return FunctionalWorkflowSelection(
        status=status,
        requested_modality=modality,
        resolved_modality=resolved,
        config=config,
        engagement_requested=target_supplied,
        engagement_eligible=engagement_eligible,
        decision_reason=reason,
        warnings=warnings,
        provenance={
            "known_modalities": list(known_modalities()),
        },
    )
