# """Functional Analysis Service (doc 01 §5.6).

# Estimates biological activities supported by the evidence: antimicrobial and
# cell-penetrating propensity from the trained GradientBoosting classifiers, plus
# deterministic receptor-engagement and MIC estimates. It does NOT judge whether
# an activity is therapeutically desirable — that is the Decision Layer's job.

# Quantitative target binding affinity requires the Boltz-2 conformation layer;
# when that layer is disabled this service reports target engagement as
# ``unavailable`` rather than inventing an affinity.
# """

# from __future__ import annotations

# from ..domain.evidence import (
#     Confidence,
#     EvidenceObject,
#     EvidenceTier,
#     EvidenceType,
#     Provenance,
#     Uncertainty,
#     ValidationStatus,
# )
# from ..infrastructure.orchestrator import ExecutionContext
# from ..structure import ConformationLayer
# from .base import ScientificService
# from .compute import activity_ml_for, properties_for


# class FunctionalAnalysisService(ScientificService):
#     name = "functional_analysis_service"
#     evidence_type = EvidenceType.FUNCTIONAL
#     depends_on = [EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL]

#     def run(self, context: ExecutionContext) -> EvidenceObject:
#         pep = context.peptide
#         ml = activity_ml_for(pep)
#         props = properties_for(pep)
#         cv = ml.get("models_cv_auc", {})

#         target_engagement = self._target_engagement(context)

#         payload = {
#             "antimicrobial": {
#                 "probability": ml.get("amp_prob"),
#                 "class": ml.get("amp_class"),
#                 "cv_auc": cv.get("amp"),
#                 "source": ml.get("source", {}).get("amp"),
#             },
#             "cell_permeability": {
#                 "probability": ml.get("cpp_prob"),
#                 "class": ml.get("cpp_class"),
#                 "cv_auc": cv.get("cpp"),
#                 "source": ml.get("source", {}).get("cpp"),
#             },
#             "amp_heuristic": props.get("amp_score", {}),
#             "mic_estimate": props.get("mic_estimate", {}),
#             "receptor_engagement": props.get("receptor_engagement", {}),
#             "target_engagement": target_engagement,
#         }

#         # Confidence from the classifiers' measured cross-validated AUCs.
#         aucs: list[float] = [
#             v for v in (cv.get("amp"), cv.get("cpp")) if isinstance(v, (int, float))
#         ]
#         conf_score = (sum(aucs) / len(aucs)) if aucs else None
#         model_unc = (1.0 - conf_score) if conf_score is not None else None

#         provenance = Provenance(
#             originating_service=self.name,
#             algorithms=[
#                 "GradientBoosting AMP classifier",
#                 "GradientBoosting CPP classifier",
#                 "Boman-index receptor engagement",
#                 "APD3-calibrated MIC estimate",
#             ],
#             upstream_evidence_ids=self._upstream_ids(context),
#             model_checkpoints=["peptide_activity_classifiers", "peptide_biochem_engine"],
#             references=[
#                 "CAMP v3.0: Wang 2016 NAR 44:D1087",
#                 "CPPsite 2.0: Gautam 2015 Database 2015:bav007",
#                 "APD3 antimicrobial peptide database",
#             ],
#         )

#         return self._evidence(
#             context,
#             payload=payload,
#             confidence=Confidence.make(
#                 conf_score,
#                 "cross_validated_auc",
#                 supporting_evidence_count=len(aucs),
#                 rationale="Confidence is the mean stratified-CV AUC of the AMP/CPP classifiers.",
#             ),
#             uncertainty=Uncertainty(
#                 model_uncertainty=model_unc,
#                 sources=["classifier_generalization_error", "small_curated_training_sets"],
#             ),
#             applicability=self._length_applicability(
#                 pep,
#                 min_len=5,
#                 max_len=60,
#                 modality="amp/cpp/targeted",
#                 notes="Activity classifiers trained on peptides ~5–60 residues.",
#             ),
#             provenance=provenance,
#             tier=EvidenceTier.ML_MODEL,
#             validation_status=ValidationStatus.INTERNALLY_VALIDATED,
#         )

#     def _target_engagement(self, context: ExecutionContext):
#         target = context.target
#         if not target or not target.is_specified:
#             return {
#                 "status": "not_requested",
#                 "detail": "No biological target supplied; target engagement not evaluated.",
#             }
#         conf_layer = ConformationLayer(context.config)
#         available, reason = conf_layer.availability()
#         return {
#             "status": "available_via_conformation_layer" if available else "unavailable",
#             "target": target.to_dict(),
#             "method": "boltz2_affinity" if available else None,
#             "detail": (
#                 "Submit a conformation-layer job for a quantitative peptide–target " "affinity."
#                 if available
#                 else reason
#             ),
#         }

#     @staticmethod
#     def _upstream_ids(context: ExecutionContext):
#         ids = []
#         for et in (EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL):
#             ev = context.evidence(et)
#             if ev:
#                 ids.append(ev.evidence_id)
#         return ids
# =======================================================================================

# """Functional Analysis Service (doc 01 §5.6; Functional Analysis Service Spec, doc 09).

# Pipeline per §5:
#   1. Workflow Selector (M1, ``domain/functional_routing.py``) — deterministic
#      rule table mapping the declared/requested modality to the predictors,
#      reference datasets, and engagement procedure appropriate to it.
#   2. Structured Functional Predictors (M3, ``properties/functional_ml.py``) —
#      XGBoost over engineered biochemical features.
#   3. Embedding Functional Predictors (M4, ``properties/functional_embedding_ml.py``)
#      — small PyTorch classifiers over pooled ESM sequence embeddings.
#   4. Target Engagement Estimator (M5, ``structure/target_engagement.py``) —
#      combines structural complex evidence with the modality-relevant
#      predictor score. See that module's docstring for an explicitly flagged
#      known gap (no per-residue interface geometry yet).
#   5. Consistency Validator (M6, ``domain/functional_consistency.py``) —
#      deterministic agreement scoring across independent estimates; conflicts
#      are flagged, never averaged away.

# Similarity Engine (§5.2 — FAISS/MMseqs2/BLAST over DBAASP/APD3/SATPdb/
# PeptideAtlas) is deliberately deferred: no reference database exists in this
# codebase yet. ``similarity_analysis`` in the payload is reported ``absent``
# until that milestone, never fabricated.

# It does NOT judge whether an activity is therapeutically desirable — that is
# the Decision Layer's job.
# """

# from __future__ import annotations

# from typing import Any

# from ..domain.evidence import (
#     Confidence,
#     EvidenceObject,
#     EvidenceTier,
#     EvidenceType,
#     Provenance,
#     Uncertainty,
#     ValidationStatus,
# )
# from ..domain.functional_consistency import assess_consistency
# from ..domain.functional_routing import select_functional_workflow
# from ..domain.target_resolution import resolve_target
# from ..infrastructure.orchestrator import ExecutionContext
# from ..properties.functional_embedding_ml import predict_functional_embedding
# from ..properties.functional_ml import predict_functional_structured
# from ..structure.target_engagement import estimate_target_engagement
# from .base import ScientificService

# _PRIMARY_STRUCTURED_ENDPOINT = {
#     "antimicrobial": "antimicrobial_activity",
#     "cell_penetrating": "cell_penetration_activity",
#     "receptor_binding": "receptor_binding_propensity",
#     "enzyme_inhibitory": "enzyme_inhibition_propensity",
#     "general": "antimicrobial_activity",
# }
# _PRIMARY_EMBEDDING_ENDPOINT = {
#     "antimicrobial": "antimicrobial_activity_embedding",
#     "cell_penetrating": "cell_penetration_activity_embedding",
#     "receptor_binding": "receptor_binding_propensity_embedding",
#     "enzyme_inhibitory": "enzyme_inhibition_propensity_embedding",
#     "general": None,
# }


# class FunctionalAnalysisService(ScientificService):
#     name = "functional_analysis_service"
#     evidence_type = EvidenceType.FUNCTIONAL
#     depends_on = [EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL]

#     def run(self, context: ExecutionContext) -> EvidenceObject:
#         pep = context.peptide
#         target_resolution = resolve_target(context.target)

#         workflow = select_functional_workflow(
#             modality=context.modality,
#             target_resolution=target_resolution,
#             model_configuration=context.config,
#         )
#         resolved_modality = workflow["resolved_modality"]
#         config = workflow["config"]

#         structured = predict_functional_structured(
#             pep.sequence, endpoints=list(config["structured_predictors"])
#         )

#         embedding = predict_functional_embedding(
#             pep.sequence, endpoints=list(config["embedding_predictors"])
#         )

#         complex_prediction = self._complex_prediction(context)
#         primary_structured_ep = _PRIMARY_STRUCTURED_ENDPOINT.get(resolved_modality)
#         primary_entry = structured.get(primary_structured_ep) if primary_structured_ep else None
#         primary_score = (
#             primary_entry.get("value")
#             if primary_entry and primary_entry.get("status") == "complete"
#             else None
#         )
#         primary_conf = (
#             (primary_entry.get("confidence") or {}).get("score")
#             if primary_entry and primary_entry.get("status") == "complete"
#             else None
#         )
#         target_engagement = estimate_target_engagement(
#             engagement_procedure=config["engagement_procedure"],
#             complex_prediction=complex_prediction,
#             relevant_predictor_score=primary_score,
#             relevant_predictor_confidence=primary_conf,
#         )

#         primary_embedding_ep = _PRIMARY_EMBEDDING_ENDPOINT.get(resolved_modality)
#         embedding_entry = embedding.get(primary_embedding_ep) if primary_embedding_ep else None
#         embedding_score = (
#             embedding_entry.get("value")
#             if embedding_entry and embedding_entry.get("status") == "complete"
#             else None
#         )
#         consistency = assess_consistency(
#             {
#                 "structured_model": primary_score,
#                 "embedding_model": embedding_score,
#                 "target_engagement": target_engagement.get("engagement_score"),
#             }
#         )

#         payload = {
#             "modality": {
#                 "requested": workflow["requested_modality"],
#                 "resolved": resolved_modality,
#                 "status": workflow["status"],
#                 "decision_reason": workflow["decision_reason"],
#                 "warnings": workflow["warnings"],
#             },
#             "similarity_analysis": {
#                 "status": "absent",
#                 "reason_code": "similarity_engine_not_yet_implemented",
#                 "message": (
#                     "The Similarity Engine (FAISS + MMseqs2/BLAST over DBAASP/"
#                     "APD3/SATPdb/PeptideAtlas) is a deferred milestone — no "
#                     "reference database exists in this codebase yet."
#                 ),
#             },
#             "functional_predictions": {
#                 "structured": structured,
#                 "embedding": embedding,
#             },
#             "target_engagement": target_engagement,
#             "consistency_assessment": consistency,
#             "reference_datasets_configured": list(config["reference_datasets"]),
#             "provenance": {
#                 "workflow_selector": workflow["provenance"],
#             },
#         }

#         cv_aucs = [
#             v["training_cv_auc"]
#             for v in structured.values()
#             if v.get("status") == "complete" and isinstance(v.get("training_cv_auc"), (int, float))
#         ]
#         conf_score = (sum(cv_aucs) / len(cv_aucs)) if cv_aucs else None
#         model_unc = (1.0 - conf_score) if conf_score is not None else None

#         provenance = Provenance(
#             originating_service=self.name,
#             algorithms=[
#                 "functional_workflow_selector (deterministic rule table)",
#                 "XGBoost structured functional predictors",
#                 "PyTorch embedding functional predictors",
#                 "target engagement heuristic combiner (placeholder pending interface geometry)",
#                 "functional_consistency_validator (deterministic agreement scoring)",
#             ],
#             upstream_evidence_ids=self._upstream_ids(context),
#             model_checkpoints=["functional_structured_ml_v1", "functional_embedding_ml_v1"],
#             references=[
#                 "CAMP v3.0: Wang 2016 NAR 44:D1087",
#                 "CPPsite 2.0: Gautam 2015 Database 2015:bav007",
#                 "HemoPI-2: Chaudhary 2016 Biomed Res Int 2016:8525987",
#             ],
#         )

#         return self._evidence(
#             context,
#             payload=payload,
#             confidence=Confidence.make(
#                 conf_score,
#                 "cross_validated_auc",
#                 supporting_evidence_count=len(cv_aucs),
#                 rationale=(
#                     "Confidence is the mean stratified-CV AUC of the structured "
#                     "predictors selected for this modality by the Workflow Selector."
#                 ),
#             ),
#             uncertainty=Uncertainty(
#                 model_uncertainty=model_unc,
#                 sources=[
#                     "classifier_generalization_error",
#                     "small_curated_training_sets",
#                     "target_engagement_heuristic_placeholder",
#                 ],
#             ),
#             applicability=self._length_applicability(
#                 pep,
#                 min_len=5,
#                 max_len=60,
#                 modality=resolved_modality,
#                 notes="Structured/embedding predictors trained on peptides ~5-60 residues.",
#             ),
#             provenance=provenance,
#             tier=EvidenceTier.ML_MODEL,
#             validation_status=ValidationStatus.INTERNALLY_VALIDATED,
#             warnings=[w["message"] for w in workflow["warnings"]],
#         )

#     @staticmethod
#     def _complex_prediction(context: ExecutionContext) -> dict[str, Any] | None:
#         structural = context.evidence(EvidenceType.STRUCTURAL)
#         if not structural:
#             return None
#         return (structural.payload or {}).get("complex_prediction")

#     @staticmethod
#     def _upstream_ids(context: ExecutionContext):
#         ids = []
#         for et in (EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL):
#             ev = context.evidence(et)
#             if ev:
#                 ids.append(ev.evidence_id)
#         return ids


"""Functional Analysis Service (doc 01 §5.6; Functional Analysis Service Spec, doc 09).

Pipeline per §5:
  1. Workflow Selector (M1, ``domain/functional_routing.py``) — deterministic
     rule table mapping the declared/requested modality to the predictors,
     reference datasets, and engagement procedure appropriate to it.
  2. Structured Functional Predictors (M3, ``properties/functional_ml.py``) —
     XGBoost over engineered biochemical features.
  3. Embedding Functional Predictors (M4, ``properties/functional_embedding_ml.py``)
     — small PyTorch classifiers over pooled ESM sequence embeddings.
  4. Target Engagement Estimator (M5, ``structure/target_engagement.py``) —
     combines structural complex evidence with the modality-relevant
     predictor score. See that module's docstring for an explicitly flagged
     known gap (no per-residue interface geometry yet).
  5. Consistency Validator (M6, ``domain/functional_consistency.py``) —
     deterministic agreement scoring across independent estimates; conflicts
     are flagged, never averaged away.

Similarity Engine (§5.2 — FAISS/MMseqs2/BLAST over DBAASP/APD3/SATPdb/
PeptideAtlas) is deliberately deferred: no reference database exists in this
codebase yet. ``similarity_analysis`` in the payload is reported ``absent``
until that milestone, never fabricated.

It does NOT judge whether an activity is therapeutically desirable — that is
the Decision Layer's job.
"""

from __future__ import annotations

from typing import Any

from ..domain.evidence import (
    Confidence,
    EvidenceObject,
    EvidenceTier,
    EvidenceType,
    Provenance,
    Uncertainty,
    ValidationStatus,
)
from ..domain.functional_consistency import assess_consistency
from ..domain.functional_routing import select_functional_workflow
from ..domain.target_resolution import resolve_target
from ..infrastructure.orchestrator import ExecutionContext
from ..properties.functional_embedding_ml import predict_functional_embedding
from ..properties.functional_ml import predict_functional_structured
from ..structure.target_engagement import estimate_target_engagement
from .base import ScientificService

_PRIMARY_STRUCTURED_ENDPOINT = {
    "antimicrobial": "antimicrobial_activity",
    "cell_penetrating": "cell_penetration_activity",
    "receptor_binding": "receptor_binding_propensity",
    "enzyme_inhibitory": "enzyme_inhibition_propensity",
    "general": "antimicrobial_activity",
}
_PRIMARY_EMBEDDING_ENDPOINT = {
    "antimicrobial": "antimicrobial_activity_embedding",
    "cell_penetrating": "cell_penetration_activity_embedding",
    "receptor_binding": "receptor_binding_propensity_embedding",
    "enzyme_inhibitory": "enzyme_inhibition_propensity_embedding",
    "general": None,
}

# §11 Limitations -- recorded explicitly on every Evidence Object so
# downstream services and the Decision Layer can account for them rather
# than treating functional evidence as ground truth, per §11's closing
# instruction.
KNOWN_LIMITATIONS = [
    {
        "code": "no_experimental_validation",
        "message": (
            "All functional and engagement estimates are computational "
            "predictions; none are confirmed against wet-lab bioassay data "
            "within this service's boundary."
        ),
    },
    {
        "code": "reference_database_bias",
        "message": (
            "Similarity-based inference is not yet implemented in this "
            "deployment (Similarity Engine deferred); when it is, its "
            "quality will be bounded by reference database coverage."
        ),
    },
    {
        "code": "model_applicability_domain_limits",
        "message": (
            "Functional Predictors are trained on finite, historically "
            "available curated datasets; predictions outside the measured "
            "applicability domain are flagged in each predictor's "
            "'applicability_domain' field, per §10.2."
        ),
    },
    {
        "code": "dependence_on_upstream_evidence_quality",
        "message": (
            "Target engagement estimates inherit the limitations of the "
            "Structural Biology Service's structure and complex "
            "predictions; a low-confidence or unavailable structural "
            "complex necessarily constrains engagement reliability."
        ),
    },
    {
        "code": "modality_misclassification_risk",
        "message": (
            "If the declared or inferred therapeutic modality does not "
            "accurately reflect the peptide's true biological behavior, the "
            "Workflow Selector may route to a mechanistically inappropriate "
            "predictor set; this service cannot detect that error from its "
            "own evidence alone."
        ),
    },
    {
        "code": "cross_method_agreement_not_proof",
        "message": (
            "Convergence among independent functional estimates increases "
            "confidence but does not constitute experimental confirmation; "
            "correlated failure modes can produce concordant but incorrect "
            "conclusions."
        ),
    },
]


class FunctionalAnalysisService(ScientificService):
    name = "functional_analysis_service"
    evidence_type = EvidenceType.FUNCTIONAL
    depends_on = [EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL]

    def run(self, context: ExecutionContext) -> EvidenceObject:
        pep = context.peptide
        target_resolution = resolve_target(context.target)

        workflow = select_functional_workflow(
            modality=context.modality,
            target_resolution=target_resolution,
            model_configuration=context.config,
        )
        resolved_modality = workflow["resolved_modality"]
        config = workflow["config"]

        # §5.3: structured predictors consume the Physicochemical Evidence
        # Object's already-computed descriptors -- real upstream evidence,
        # not a re-derivation from the sequence.
        physicochemical = context.evidence(EvidenceType.PHYSICOCHEMICAL)
        pc_descriptors = (
            (physicochemical.scientific_payload or {}).get("descriptors")
            if physicochemical
            else None
        )

        structured = predict_functional_structured(
            pep.sequence,
            endpoints=list(config["structured_predictors"]),
            physicochemical_descriptors=pc_descriptors,
        )

        embedding = predict_functional_embedding(
            pep.sequence, endpoints=list(config["embedding_predictors"])
        )

        complex_prediction = self._complex_prediction(context)
        primary_structured_ep = _PRIMARY_STRUCTURED_ENDPOINT.get(resolved_modality)
        primary_entry = structured.get(primary_structured_ep) if primary_structured_ep else None
        primary_score = (
            primary_entry.get("value")
            if primary_entry and primary_entry.get("status") == "complete"
            else None
        )
        primary_conf = (
            (primary_entry.get("confidence") or {}).get("score")
            if primary_entry and primary_entry.get("status") == "complete"
            else None
        )
        target_engagement = estimate_target_engagement(
            engagement_procedure=config["engagement_procedure"],
            complex_prediction=complex_prediction,
            relevant_predictor_score=primary_score,
            relevant_predictor_confidence=primary_conf,
        )

        primary_embedding_ep = _PRIMARY_EMBEDDING_ENDPOINT.get(resolved_modality)
        embedding_entry = embedding.get(primary_embedding_ep) if primary_embedding_ep else None
        embedding_score = (
            embedding_entry.get("value")
            if embedding_entry and embedding_entry.get("status") == "complete"
            else None
        )
        consistency = assess_consistency(
            {
                "structured_model": primary_score,
                "embedding_model": embedding_score,
                "target_engagement": target_engagement.get("engagement_score"),
            }
        )

        payload = {
            "modality": {
                "requested": workflow["requested_modality"],
                "resolved": resolved_modality,
                "status": workflow["status"],
                "decision_reason": workflow["decision_reason"],
                "warnings": workflow["warnings"],
            },
            "similarity_analysis": {
                "status": "absent",
                "reason_code": "similarity_engine_not_yet_implemented",
                "message": (
                    "The Similarity Engine (FAISS + MMseqs2/BLAST over DBAASP/"
                    "APD3/SATPdb/PeptideAtlas) is a deferred milestone — no "
                    "reference database exists in this codebase yet."
                ),
            },
            "functional_predictions": {
                "structured": structured,
                "embedding": embedding,
            },
            "target_engagement": target_engagement,
            "consistency_assessment": consistency,
            "reference_datasets_configured": list(config["reference_datasets"]),
            "known_limitations": KNOWN_LIMITATIONS,
            "provenance": {
                "workflow_selector": workflow["provenance"],
            },
        }

        cv_aucs = [
            v["training_cv_auc"]
            for v in structured.values()
            if v.get("status") == "complete" and isinstance(v.get("training_cv_auc"), (int, float))
        ]
        conf_score = (sum(cv_aucs) / len(cv_aucs)) if cv_aucs else None
        model_unc = (1.0 - conf_score) if conf_score is not None else None

        provenance = Provenance(
            originating_service=self.name,
            algorithms=[
                "functional_workflow_selector (deterministic rule table)",
                "XGBoost structured functional predictors",
                "PyTorch embedding functional predictors",
                "target engagement heuristic combiner (placeholder pending interface geometry)",
                "functional_consistency_validator (deterministic agreement scoring)",
            ],
            upstream_evidence_ids=self._upstream_ids(context),
            model_checkpoints=["functional_structured_ml_v2", "functional_embedding_ml_v1"],
            references=[
                "CAMP v3.0: Wang 2016 NAR 44:D1087",
                "CPPsite 2.0: Gautam 2015 Database 2015:bav007",
                "HemoPI-2: Chaudhary 2016 Biomed Res Int 2016:8525987",
            ],
        )

        return self._evidence(
            context,
            payload=payload,
            confidence=Confidence.make(
                conf_score,
                "cross_validated_auc",
                supporting_evidence_count=len(cv_aucs),
                rationale=(
                    "Confidence is the mean stratified-CV AUC of the structured "
                    "predictors selected for this modality by the Workflow Selector."
                ),
            ),
            uncertainty=Uncertainty(
                model_uncertainty=model_unc,
                sources=[
                    "classifier_generalization_error",
                    "small_curated_training_sets",
                    "target_engagement_heuristic_placeholder",
                ],
            ),
            applicability=self._length_applicability(
                pep,
                min_len=5,
                max_len=60,
                modality=resolved_modality,
                notes="Structured/embedding predictors trained on peptides ~5-60 residues.",
            ),
            provenance=provenance,
            tier=EvidenceTier.ML_MODEL,
            validation_status=ValidationStatus.INTERNALLY_VALIDATED,
            warnings=[w["message"] for w in workflow["warnings"]],
        )

    @staticmethod
    def _complex_prediction(context: ExecutionContext) -> dict[str, Any] | None:
        structural = context.evidence(EvidenceType.STRUCTURAL)
        if not structural:
            return None
        return (structural.scientific_payload or {}).get("complex_prediction")

    @staticmethod
    def _upstream_ids(context: ExecutionContext):
        ids = []
        for et in (EvidenceType.PHYSICOCHEMICAL, EvidenceType.STRUCTURAL):
            ev = context.evidence(et)
            if ev:
                ids.append(ev.evidence_id)
        return ids
