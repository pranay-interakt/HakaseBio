"""Decision Policies (doc 05 ch.4).

A Policy is a named, versioned configuration object that defines which Core
Domains participate, how domains and their soft variables are weighted, which
hard constraints apply, and the GO / Conditional GO / NO-GO thresholds. Policies
are configuration, not code: every weight and threshold is inspectable and each
policy carries a scientific owner, a review date and a written justification —
the same evidentiary discipline the platform applies to evidence itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..domain.evidence import EvidenceType
from .variables import VARIABLE_REGISTRY


class VariableClass(str, Enum):
    HARD = "hard"
    SOFT = "soft"
    SUPPORTING = "supporting"


@dataclass(frozen=True)
class HardConstraint:
    """A variable that can, alone, force a NO-GO (doc 05 §5.1, ch.6)."""

    variable: str
    operator: str  # ">=", ">", "<=", "<"
    threshold: float
    rationale: str

    def violated(self, raw: Any) -> bool | None:
        if raw is None:
            return None  # cannot evaluate -> not a violation, but flagged as missing
        try:
            v = float(raw)
        except (TypeError, ValueError):
            return None
        return {
            ">=": v >= self.threshold,
            ">": v > self.threshold,
            "<=": v <= self.threshold,
            "<": v < self.threshold,
        }[self.operator]


@dataclass(frozen=True)
class DecisionThresholds:
    go_minimum_platform_score: float
    go_minimum_confidence: float
    conditional_go_minimum_platform_score: float
    no_go_maximum_platform_score: float


@dataclass(frozen=True)
class Policy:
    policy_id: str
    version: str
    policy_type: str  # "standard" | "composite"
    applicable_modalities: list[str]
    participating_domains: list[EvidenceType]
    domain_weights: dict[str, float]  # keyed by EvidenceType.value
    soft_variables: dict[str, float]  # variable name -> weight_within_domain
    hard_constraints: list[HardConstraint]
    thresholds: DecisionThresholds
    scientific_owner: str
    review_date: str
    justification: str
    validation_status: str = "internally_validated"
    supporting_variables: list[str] = field(default_factory=list)

    def variables_for_domain(self, domain: EvidenceType) -> dict[str, float]:
        out: dict[str, float] = {}
        for name, w in self.soft_variables.items():
            spec = VARIABLE_REGISTRY[name]
            if spec.domain is domain:
                out[name] = w
        return out

    def to_dict(self) -> dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "version": self.version,
            "policy_type": self.policy_type,
            "applicable_modalities": self.applicable_modalities,
            "participating_domains": [d.value for d in self.participating_domains],
            "domain_weights": self.domain_weights,
            "soft_variables": self.soft_variables,
            "hard_constraints": [
                {
                    "variable": h.variable,
                    "operator": h.operator,
                    "threshold": h.threshold,
                    "rationale": h.rationale,
                }
                for h in self.hard_constraints
            ],
            "thresholds": {
                "go_minimum_platform_score": self.thresholds.go_minimum_platform_score,
                "go_minimum_confidence": self.thresholds.go_minimum_confidence,
                "conditional_go_minimum_platform_score": self.thresholds.conditional_go_minimum_platform_score,
                "no_go_maximum_platform_score": self.thresholds.no_go_maximum_platform_score,
            },
            "scientific_owner": self.scientific_owner,
            "review_date": self.review_date,
            "justification": self.justification,
            "validation_status": self.validation_status,
            "supporting_variables": self.supporting_variables,
        }


# ---- built-in policies ------------------------------------------------------
_ALL_DOMAINS = [
    EvidenceType.PHYSICOCHEMICAL,
    EvidenceType.STRUCTURAL,
    EvidenceType.FUNCTIONAL,
    EvidenceType.DEVELOPABILITY,
    EvidenceType.SAFETY,
]


def _generic_policy() -> Policy:
    return Policy(
        policy_id="generic-peptide-policy",
        version="1.0.0",
        policy_type="standard",
        applicable_modalities=["generic", "unknown", "hormone", "targeted"],
        participating_domains=list(_ALL_DOMAINS),
        domain_weights={
            EvidenceType.PHYSICOCHEMICAL.value: 0.10,
            EvidenceType.STRUCTURAL.value: 0.20,
            EvidenceType.FUNCTIONAL.value: 0.25,
            EvidenceType.DEVELOPABILITY.value: 0.25,
            EvidenceType.SAFETY.value: 0.20,
        },
        soft_variables={
            "instability_index": 1.0,
            "mean_plddt": 1.0,
            "receptor_engagement_score": 1.0,
            "camsol_score": 0.5,
            "aggregation_mean_a3v": 0.3,
            "synthesis_difficulty": 0.2,
            "hemolysis_probability": 0.6,
            "immunogenicity_band": 0.4,
        },
        hard_constraints=[
            HardConstraint(
                "hemolysis_probability",
                ">=",
                0.8,
                "Strong predicted hemolysis disqualifies a systemic peptide therapeutic.",
            ),
        ],
        thresholds=DecisionThresholds(0.65, 0.5, 0.45, 0.45),
        scientific_owner="Hakase Computational Biology (default owner)",
        review_date="2027-01-01",
        justification=(
            "Balanced weighting across all five domains for a target-agnostic peptide. "
            "Safety carries a hard constraint on predicted hemolysis for systemic use."
        ),
    )


def _amp_policy() -> Policy:
    return Policy(
        policy_id="amp-policy",
        version="1.0.0",
        policy_type="standard",
        applicable_modalities=["antimicrobial", "amp"],
        participating_domains=list(_ALL_DOMAINS),
        domain_weights={
            EvidenceType.PHYSICOCHEMICAL.value: 0.10,
            EvidenceType.STRUCTURAL.value: 0.10,
            EvidenceType.FUNCTIONAL.value: 0.40,
            EvidenceType.DEVELOPABILITY.value: 0.20,
            EvidenceType.SAFETY.value: 0.20,
        },
        soft_variables={
            "net_charge_pH7": 0.4,
            "instability_index": 0.6,
            "mean_plddt": 1.0,
            "amp_probability": 0.7,
            "receptor_engagement_score": 0.3,
            "camsol_score": 0.5,
            "aggregation_mean_a3v": 0.3,
            "synthesis_difficulty": 0.2,
            "hemolysis_probability": 0.6,
            "immunogenicity_band": 0.4,
        },
        hard_constraints=[
            # AMPs are frequently membrane-lytic; a very high hemolysis flags a
            # therapeutic-index problem but is not auto-disqualifying for topical
            # use — so the bar is higher than the systemic generic policy.
            HardConstraint(
                "hemolysis_probability",
                ">=",
                0.9,
                "Extreme predicted hemolysis indicates an unacceptable therapeutic index even for an AMP.",
            ),
        ],
        thresholds=DecisionThresholds(0.6, 0.5, 0.4, 0.4),
        scientific_owner="Hakase Antimicrobial Program (default owner)",
        review_date="2027-01-01",
        justification=(
            "Antimicrobial peptides are judged primarily on functional activity and "
            "manufacturability; structure confidence and safety modulate the score."
        ),
    )


def _cpp_policy() -> Policy:
    return Policy(
        policy_id="cpp-policy",
        version="1.0.0",
        policy_type="standard",
        applicable_modalities=["cell_penetrating", "cpp", "delivery"],
        participating_domains=list(_ALL_DOMAINS),
        domain_weights={
            EvidenceType.PHYSICOCHEMICAL.value: 0.10,
            EvidenceType.STRUCTURAL.value: 0.10,
            EvidenceType.FUNCTIONAL.value: 0.35,
            EvidenceType.DEVELOPABILITY.value: 0.20,
            EvidenceType.SAFETY.value: 0.25,
        },
        soft_variables={
            "net_charge_pH7": 0.3,
            "instability_index": 0.7,
            "mean_plddt": 1.0,
            "cpp_probability": 1.0,
            "camsol_score": 0.6,
            "aggregation_mean_a3v": 0.4,
            "hemolysis_probability": 0.6,
            "immunogenicity_band": 0.4,
        },
        hard_constraints=[
            HardConstraint(
                "hemolysis_probability",
                ">=",
                0.85,
                "A delivery peptide with high predicted hemolysis is unsuitable.",
            ),
        ],
        thresholds=DecisionThresholds(0.6, 0.5, 0.4, 0.4),
        scientific_owner="Hakase Delivery Program (default owner)",
        review_date="2027-01-01",
        justification=(
            "Cell-penetrating peptides are judged primarily on CPP propensity and "
            "safety, since they are typically used as delivery vehicles."
        ),
    )


class PolicyStore:
    def __init__(self) -> None:
        self._policies: dict[str, Policy] = {}
        for p in (_generic_policy(), _amp_policy(), _cpp_policy()):
            self._policies[p.policy_id] = p
        self._default_id = "generic-peptide-policy"

    def get(self, policy_id: str) -> Policy | None:
        return self._policies.get(policy_id)

    def all(self) -> list[Policy]:
        return list(self._policies.values())

    def resolve(
        self, *, policy_id: str | None = None, modality: str | None = None
    ) -> PolicyResolution:
        # Priority 1: explicit policy id.
        if policy_id:
            p = self._policies.get(policy_id)
            if not p:
                raise KeyError(f"Requested policy '{policy_id}' not found.")
            return PolicyResolution(p, "explicit_policy_id")
        # Priority 2: modality match.
        if modality:
            m = modality.strip().lower()
            for p in self._policies.values():
                if m in [x.lower() for x in p.applicable_modalities]:
                    return PolicyResolution(p, f"modality_match:{m}")
        # Priority 3: platform default.
        return PolicyResolution(self._policies[self._default_id], "platform_default")


@dataclass(frozen=True)
class PolicyResolution:
    policy: Policy
    resolved_by: str


_STORE: PolicyStore | None = None


def get_policy_store() -> PolicyStore:
    global _STORE
    if _STORE is None:
        _STORE = PolicyStore()
    return _STORE
