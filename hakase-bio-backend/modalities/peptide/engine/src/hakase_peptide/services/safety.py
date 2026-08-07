"""Safety Service (doc 01 §5.8).

Predicts computationally identifiable liabilities: hemolysis (trained
classifier), immunogenicity (MHC-II binding-motif / sequence-based estimate),
and chemical/toxicity liabilities (reactive motifs, problematic residues).
Off-target proteome cross-reactivity requires a structural/proteomic scan and is
reported as ``not_evaluated`` here rather than guessed.

Safety predictions are computational hypotheses; validation status and
limitations make that explicit.
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


class SafetyService(ScientificService):
    name = "safety_service"
    evidence_type = EvidenceType.SAFETY
    depends_on = [EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL, EvidenceType.FUNCTIONAL]

    def run(self, context: ExecutionContext) -> EvidenceObject:
        pep = context.peptide
        ml = activity_ml_for(pep)
        props = properties_for(pep)
        cv = ml.get("models_cv_auc", {})

        payload = {
            "hemolysis": {
                "probability": ml.get("hemolysis_prob"),
                "class": ml.get("hemolysis_class"),
                "cv_auc": cv.get("hemolysis"),
                "source": ml.get("source", {}).get("hemolysis"),
            },
            "immunogenicity": props.get("immunogenicity", {}),
            "chemical_liabilities": props.get("chemical_liabilities", {}),
            "off_target": {
                "status": "not_evaluated",
                "detail": "Proteome-wide off-target cross-reactivity requires a "
                "structural/proteomic scan; not part of the default pipeline.",
            },
        }

        hemo_auc = cv.get("hemolysis")
        conf_score = float(hemo_auc) if isinstance(hemo_auc, (int, float)) else None

        provenance = Provenance(
            originating_service=self.name,
            algorithms=[
                "GradientBoosting hemolysis classifier",
                "MHC-II binding-motif immunogenicity estimate",
                "reactive-motif chemical-liability scan",
            ],
            upstream_evidence_ids=self._upstream_ids(context),
            model_checkpoints=["peptide_activity_classifiers", "peptide_biochem_engine"],
            references=[
                "HemoPI-2: Chaudhary 2016 Biomed Res Int 2016:8525987",
                "IEDB MHC-II binding motifs",
            ],
        )

        return self._evidence(
            context,
            payload=payload,
            confidence=Confidence.make(
                conf_score,
                "cross_validated_auc",
                rationale="Confidence anchored to the hemolysis classifier's stratified-CV AUC.",
            ),
            uncertainty=Uncertainty(
                model_uncertainty=(1.0 - conf_score) if conf_score is not None else None,
                sources=[
                    "classifier_generalization_error",
                    "immunogenicity_sequence_only",
                    "no_off_target_scan",
                ],
            ),
            applicability=self._length_applicability(
                pep,
                min_len=5,
                max_len=60,
                modality="all",
                notes="Hemolysis classifier trained on peptides ~5–60 residues.",
            ),
            provenance=provenance,
            tier=EvidenceTier.ML_MODEL,
            validation_status=ValidationStatus.INTERNALLY_VALIDATED,
            limitations=[
                "Safety predictions are computational hypotheses, not wet-lab results.",
                "Off-target and organ-specific toxicity are not modelled.",
            ],
        )

    @staticmethod
    def _upstream_ids(context: ExecutionContext) -> list[str]:
        ids = []
        for et in (EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL, EvidenceType.FUNCTIONAL):
            ev = context.evidence(et)
            if ev:
                ids.append(ev.evidence_id)
        return ids
