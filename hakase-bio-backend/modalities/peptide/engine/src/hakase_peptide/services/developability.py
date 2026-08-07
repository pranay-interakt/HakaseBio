"""Developability Service (doc 01 §5.7).

Evaluates pharmaceutical feasibility from validated algorithmic methods:
intrinsic solubility (CamSol), aggregation propensity (AGGRESCAN-style),
synthesis complexity, and stability liabilities (instability index, predicted
half-life, proteolytic-cleavage sites, serum stability). Confidence is computed
from evidence completeness — the fraction of sub-analyses that returned a real
value — rather than asserted.
"""

from __future__ import annotations

from ..domain.evidence import (
    Confidence,
    EvidenceObject,
    EvidenceTier,
    EvidenceType,
    Provenance,
    Uncertainty,
    ValidationStatus,
)
from ..infrastructure.orchestrator import ExecutionContext
from .base import ScientificService
from .compute import activity_ml_for, properties_for


class DevelopabilityService(ScientificService):
    name = "developability_service"
    evidence_type = EvidenceType.DEVELOPABILITY
    depends_on = [EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL]

    def run(self, context: ExecutionContext) -> EvidenceObject:
        pep = context.peptide
        props = properties_for(pep)
        ml = activity_ml_for(pep)

        solubility = {
            "camsol_score": ml.get("solubility_score"),
            "camsol_class": ml.get("solubility_class"),
            "detail": props.get("solubility", {}),
            "source": ml.get("source", {}).get("solubility"),
        }
        stability = {
            "instability_index": props.get("physicochemical", {}).get("instability_index"),
            "proteolytic_stability": props.get("proteolytic_stability", {}),
            "half_life": props.get("half_life", {}),
            "serum_stability": props.get("serum_stability", {}),
        }

        payload = {
            "solubility": solubility,
            "aggregation": props.get("aggregation", {}),
            "synthesis": props.get("synthesis", {}),
            "stability": stability,
            "developability_summary": props.get("developability", {}),
        }

        # Completeness-based confidence: fraction of the five sub-blocks that
        # actually carry data (real signal, not a fixed number).
        blocks = [
            solubility.get("camsol_score") is not None,
            bool(payload["aggregation"]),
            bool(payload["synthesis"]),
            stability.get("instability_index") is not None,
            bool(stability.get("proteolytic_stability")),
        ]
        completeness = sum(1 for b in blocks if b) / len(blocks)

        provenance = Provenance(
            originating_service=self.name,
            algorithms=[
                "CamSol intrinsic solubility",
                "AGGRESCAN aggregation propensity",
                "Guruprasad instability index",
                "protease-site half-life estimate",
            ],
            upstream_evidence_ids=self._upstream_ids(context),
            model_checkpoints=["camsol_intrinsic", "peptide_biochem_engine"],
            references=[
                "Sormanni 2015 J Mol Biol 427:478 (CamSol)",
                "Conchillo-Sole 2007 BMC Bioinformatics 8:65 (AGGRESCAN)",
                "Guruprasad 1990 Protein Eng 4:155",
            ],
        )

        return self._evidence(
            context,
            payload=payload,
            confidence=Confidence.make(
                completeness,
                "evidence_completeness",
                supporting_evidence_count=sum(1 for b in blocks if b),
                rationale="Fraction of developability sub-analyses returning a real value.",
            ),
            uncertainty=Uncertainty(
                model_uncertainty=1.0 - completeness,
                sources=["empirical_method_error", "no_formulation_context"],
            ),
            applicability=self._length_applicability(
                pep,
                min_len=2,
                max_len=200,
                modality="all",
                notes="Developability heuristics validated on therapeutic-length peptides/proteins.",
            ),
            provenance=provenance,
            tier=EvidenceTier.DETERMINISTIC,
            validation_status=ValidationStatus.INTERNALLY_VALIDATED,
        )

    @staticmethod
    def _upstream_ids(context: ExecutionContext) -> list[str]:
        ids = []
        for et in (EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL):
            ev = context.evidence(et)
            if ev:
                ids.append(ev.evidence_id)
        return ids
