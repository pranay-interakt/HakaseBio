"""Decision Engine (doc 05 ch.6, ch.11–17).

Deterministic rule evaluation over the Platform Evidence Object: evaluate hard
constraints, score participating domains, compute the Platform Score, aggregate
confidence and consistency, then apply the active policy's thresholds to produce
a GO / Conditional GO / NO-GO recommendation with an explicit rationale,
experimental recommendations and a full evidence trace. Performs no scientific
prediction and calls no model — it only interprets standardized evidence.
"""

from __future__ import annotations

from typing import Any

from ..domain.evidence import EvidenceType
from ..domain.platform_evidence import PlatformEvidence
from .policy import Policy
from .record import Decision, DecisionRecord
from .scoring import aggregate_confidence, assess_consistency, score_domains
from .variables import VARIABLE_REGISTRY, extract_variables

# Maps a weak domain to the experimental validation the platform recommends
# (doc 06 §6.7 experimental-priority list).
_DOMAIN_ASSAYS = {
    EvidenceType.STRUCTURAL.value: "Experimental structural validation (CD spectroscopy / NMR).",
    EvidenceType.FUNCTIONAL.value: "Functional activity assay (e.g. broth-microdilution MIC for AMPs, "
    "receptor-binding assay for targeted peptides).",
    EvidenceType.DEVELOPABILITY.value: "Solubility, aggregation (ThT/SEC) and protease-stability studies.",
    EvidenceType.SAFETY.value: "Hemolysis assay, immunogenicity (MHC-II binding) and cytotoxicity screening.",
    EvidenceType.PHYSICOCHEMICAL.value: "Analytical confirmation of MW / purity (LC-MS).",
}


class DecisionEngine:
    def decide(
        self,
        platform_evidence: PlatformEvidence,
        policy: Policy,
        *,
        resolved_by: str = "explicit_policy_id",
    ) -> DecisionRecord:
        warnings: list[str] = []

        # ---- completeness ----
        available, unavailable = [], []
        for domain in policy.participating_domains:
            ev = platform_evidence.get(domain)
            (available if (ev and ev.is_available) else unavailable).append(domain.value)
        completeness_fraction = (
            len(available) / len(policy.participating_domains)
            if policy.participating_domains
            else 0.0
        )
        completeness = {
            "participating_domains": [d.value for d in policy.participating_domains],
            "available_domains": available,
            "unavailable_domains": unavailable,
            "completeness_fraction": round(completeness_fraction, 4),
        }
        for d in unavailable:
            warnings.append(f"Evidence for domain '{d}' is unavailable; it did not contribute.")

        # ---- variables ----
        var_names = sorted(
            set(policy.soft_variables.keys()) | {h.variable for h in policy.hard_constraints}
        )
        variables = extract_variables(platform_evidence, var_names)

        # ---- hard constraints (evaluated on raw values) ----
        hard_evals: list[dict[str, Any]] = []
        forced = False
        for hc in policy.hard_constraints:
            ev = variables.get(hc.variable)
            raw = ev.raw if (ev and ev.present) else None
            violated = hc.violated(raw)
            hard_evals.append(
                {
                    "variable": hc.variable,
                    "operator": hc.operator,
                    "threshold": hc.threshold,
                    "raw_value": raw,
                    "violated": violated,
                    "rationale": hc.rationale,
                    "reference": VARIABLE_REGISTRY[hc.variable].reference,
                }
            )
            if violated is True:
                forced = True
            elif violated is None:
                warnings.append(
                    f"Hard-constraint variable '{hc.variable}' could not be evaluated "
                    f"(missing evidence); constraint not applied."
                )

        # ---- scoring ----
        scoring = score_domains(policy, variables)
        platform_score = scoring["platform_score"]

        conf = aggregate_confidence(platform_evidence, policy)
        consistency = assess_consistency(variables)

        # Decision confidence: our confidence in the recommendation itself —
        # a product of evidence confidence, cross-domain consistency and completeness.
        parts = [
            conf["aggregated_confidence"],
            consistency["consistency_score"],
            completeness_fraction,
        ]
        parts = [p for p in parts if p is not None]
        decision_confidence = round(_product(parts), 4) if parts else None

        # Scientific readiness: completeness + confidence + consistency, explicitly
        # independent of peptide quality (doc 05 ch.12).
        readiness_parts = [
            completeness_fraction,
            conf["aggregated_confidence"],
            consistency["consistency_score"],
        ]
        readiness_parts = [p for p in readiness_parts if p is not None]
        scientific_readiness = (
            round(sum(readiness_parts) / len(readiness_parts), 4) if readiness_parts else None
        )

        # ---- decision policy application ----
        decision, rationale = self._apply_thresholds(
            policy,
            platform_score,
            decision_confidence,
            forced,
            hard_evals,
            scoring["domain_scores"],
            completeness_fraction,
        )

        recommendations = self._recommendations(
            decision,
            policy,
            scoring["domain_scores"],
            consistency,
            unavailable,
            platform_evidence,
        )

        evidence_trace = self._trace(platform_evidence, policy)

        return DecisionRecord(
            subject_id=platform_evidence.subject_id,
            execution_id=platform_evidence.execution_id,
            decision=decision,
            forced_by_hard_constraint=forced,
            platform_score=platform_score,
            decision_confidence=decision_confidence,
            scientific_readiness=scientific_readiness,
            policy={**policy.to_dict(), "resolved_by": resolved_by},
            resolved_by=resolved_by,
            domain_scores=scoring["domain_scores"],
            domain_detail=scoring["domain_detail"],
            hard_constraint_evaluations=hard_evals,
            consistency=consistency,
            completeness=completeness,
            aggregated_confidence=conf["aggregated_confidence"],
            aggregated_uncertainty=conf["aggregated_uncertainty"],
            rationale=rationale,
            recommendations=recommendations,
            evidence_trace=evidence_trace,
            warnings=warnings,
        )

    # ---- helpers ------------------------------------------------------------
    def _apply_thresholds(
        self,
        policy: Policy,
        platform_score: float | None,
        decision_confidence: float | None,
        forced: bool,
        hard_evals: list[dict[str, Any]],
        domain_scores: dict[str, float | None],
        completeness_fraction: float,
    ):
        t = policy.thresholds
        if forced:
            violated = [h["variable"] for h in hard_evals if h["violated"] is True]
            return Decision.NO_GO, (
                f"NO-GO forced by hard constraint(s): {', '.join(violated)}. "
                "A hard-constraint violation overrides all domain scores."
            )
        if platform_score is None:
            return Decision.NO_GO, (
                "NO-GO: no participating domain produced a score (insufficient evidence "
                "to evaluate this candidate)."
            )
        if platform_score >= t.go_minimum_platform_score and (
            decision_confidence is None or decision_confidence >= t.go_minimum_confidence
        ):
            return Decision.GO, (
                f"GO: platform score {platform_score:.3f} ≥ {t.go_minimum_platform_score} "
                f"with decision confidence {decision_confidence}. Computational evidence "
                "supports progression to the next stage."
            )
        if (
            platform_score >= t.go_minimum_platform_score
            and decision_confidence is not None
            and decision_confidence < t.go_minimum_confidence
        ):
            return Decision.CONDITIONAL_GO, (
                f"Conditional GO: platform score {platform_score:.3f} meets the GO bar but "
                f"decision confidence {decision_confidence} is below "
                f"{t.go_minimum_confidence}; additional validation is required to promote to GO."
            )
        if platform_score >= t.conditional_go_minimum_platform_score:
            return Decision.CONDITIONAL_GO, (
                f"Conditional GO: platform score {platform_score:.3f} is between the "
                f"conditional ({t.conditional_go_minimum_platform_score}) and GO "
                f"({t.go_minimum_platform_score}) thresholds; promising but not yet sufficient."
            )
        return Decision.NO_GO, (
            f"NO-GO: platform score {platform_score:.3f} ≤ "
            f"{t.no_go_maximum_platform_score}; current computational evidence does not "
            "support continued development."
        )

    def _recommendations(
        self,
        decision: Decision,
        policy: Policy,
        domain_scores: dict[str, float | None],
        consistency: dict[str, Any],
        unavailable: list[str],
        platform_evidence: PlatformEvidence,
    ) -> list[str]:
        recs: list[str] = []
        # Missing evidence first.
        for d in unavailable:
            if d in _DOMAIN_ASSAYS:
                recs.append(f"Obtain missing {d} evidence: {_DOMAIN_ASSAYS[d]}")
        # Weakest scored domains.
        scored = {k: v for k, v in domain_scores.items() if v is not None}
        for d, s in sorted(scored.items(), key=lambda kv: kv[1]):
            if s < 0.6 and d in _DOMAIN_ASSAYS:
                recs.append(f"Strengthen {d} (score {s:.2f}): {_DOMAIN_ASSAYS[d]}")
        # Conflicts.
        for c in consistency.get("conflicts", []):
            recs.append(f"Resolve {c['type']} conflict experimentally: {c['detail']}")
        if decision is Decision.GO and not recs:
            recs.append(
                "Confirmatory validation of the top-weighted domains before synthesis scale-up."
            )
        return recs

    def _trace(self, platform_evidence: PlatformEvidence, policy: Policy) -> list[dict[str, Any]]:
        trace = []
        for domain in policy.participating_domains:
            ev = platform_evidence.get(domain)
            if ev is None:
                trace.append({"domain": domain.value, "evidence_id": None, "status": "missing"})
                continue
            trace.append(
                {
                    "domain": domain.value,
                    "evidence_id": ev.evidence_id,
                    "evidence_tier": ev.evidence_tier.value,
                    "validation_status": ev.validation_status.value,
                    "confidence": ev.confidence.score,
                    "producing_service": ev.producing_service,
                    "model_checkpoints": ev.provenance.model_checkpoints,
                }
            )
        return trace


def _product(values: list[float]) -> float:
    out = 1.0
    for v in values:
        out *= v
    return out
