"""Structural Biology Service (doc 01 §5.5).

Predicts the peptide's single-chain 3D structure on the default GPU-free path
(ESMFold via API) and derives real geometric evidence from the coordinates
(mean/min pLDDT, confident-residue fraction, radius of gyration, compactness,
disulfide-bond geometry check). Structure confidence is the model's own pLDDT.

Peptide–target complex modelling, binding affinity and conformational ensembles
are delegated to the optional Boltz-2 **conformation layer**; this service
reports that layer's availability but does not fabricate a complex when it is
disabled.
"""

from __future__ import annotations

from hakase_structure.confidence import build_confidence_report
from hakase_structure.plddt import PLDDT_OUTPUT_SCALE
from hakase_structure.structural_confidence import (
    build_interface_confidence_summary,
    build_structural_confidence_summary,
)

from ..domain.evidence import (
    Confidence,
    EvidenceObject,
    EvidenceTier,
    EvidenceType,
    Provenance,
    Uncertainty,
    ValidationStatus,
)
from ..domain.ids import utc_now_iso
from ..domain.structural_strategy import select_structural_strategy
from ..domain.target_resolution import resolve_target
from ..infrastructure.orchestrator import ExecutionContext
from ..structure import (
    ConformationLayer,
    analyze_structure,
    apply_structural_provenance,
    build_isolated_structure,
    build_pdb_output,
    build_structural_evidence,
    build_structural_feasibility,
    predict_complex,
    resolve_structure_provider,
    unavailable_interface_analysis,
    unavailable_isolated_structure,
)
from .base import ScientificService


class StructuralBiologyService(ScientificService):
    name = "structural_biology_service"
    evidence_type = EvidenceType.STRUCTURAL
    depends_on = [EvidenceType.PHYSICOCHEMICAL]

    def max_attempts(self, context: ExecutionContext) -> int:
        if context.config.structure_provider == "esmfold_esmatlas":
            return self._esmatlas_max_attempts(context)
        return 1 + max(0, context.config.structure_max_retries)

    def retry_delay_s(self, context: ExecutionContext, attempt: int, _exc: BaseException) -> float:
        if context.config.structure_provider == "esmfold_esmatlas":
            return max(0.0, context.config.esmatlas_retry_delay_s)
        return min(2.0 * attempt, 5.0)

    def failure_metadata(
        self,
        context: ExecutionContext,
        _exc: BaseException,
        attempts: int,
    ):
        provider = context.config.structure_provider
        metadata = {"structure_provider": provider, "provider": provider, "attempts": attempts}
        if provider == "esmfold_esmatlas":
            metadata.update(
                {
                    "provider_timeout_s": context.config.esmatlas_timeout_s,
                    "provider_max_attempts": self._esmatlas_max_attempts(context),
                }
            )
        return metadata

    def failure_payload(
        self,
        context: ExecutionContext,
        exc: BaseException,
        _attempts: int,
    ):
        reason_code = getattr(exc, "reason_code", "structure_prediction_failed")
        include_pdb = bool(context.options.get("include_pdb", True))
        pdb_output = {
            "status": "unavailable" if include_pdb else "not_requested",
            "format": "pdb",
            "content": None,
        }
        if include_pdb:
            pdb_output.update({"reason_code": reason_code, "reason_detail": str(exc)})
        generated_at = utc_now_iso()
        isolated_structure = unavailable_isolated_structure(
            provider=context.config.structure_provider,
            reason_code=reason_code,
            reason_detail=str(exc),
            include_pdb=include_pdb,
        )
        physicochemical_evidence = context.evidence(EvidenceType.PHYSICOCHEMICAL)
        target_resolution = resolve_target(context.target)
        strategy_selection = select_structural_strategy(
            peptide_sequence=context.peptide.sequence,
            target_resolution=target_resolution,
            isolated_structure=isolated_structure,
            model_configuration=context.config,
            physicochemical_evidence=physicochemical_evidence,
        )
        complex_prediction = predict_complex(
            peptide_sequence=context.peptide.sequence,
            target_resolution=target_resolution,
            strategy_selection=strategy_selection,
            config=context.config,
        )
        interface_analysis = unavailable_interface_analysis(complex_prediction)
        structural_confidence_summary = build_structural_confidence_summary(
            isolated_structure=isolated_structure,
            geometry=None,
            confidence_summary=None,
            structural_feasibility=isolated_structure["structural_feasibility"],
            target_resolution=target_resolution,
            complex_prediction=complex_prediction,
            interface_analysis=interface_analysis,
        )
        interface_confidence_summary = build_interface_confidence_summary(
            complex_prediction=complex_prediction,
            interface_analysis=interface_analysis,
        )
        structural_evidence = build_structural_evidence(
            isolated_structure=isolated_structure,
            target_resolution=target_resolution,
            strategy_selection=strategy_selection,
            complex_prediction=complex_prediction,
            interface_analysis=interface_analysis,
            interface_confidence_summary=interface_confidence_summary,
            structural_confidence_summary=structural_confidence_summary,
            peptide_sequence=context.peptide.sequence,
            peptide_modifications=context.peptide.mod_set.to_list(),
            disulfide_bridges=list(context.peptide.disulfide_bridges),
        )
        payload = {
            "status": "unavailable",
            "reason_code": reason_code,
            "reason_detail": str(exc),
            "target_resolution": target_resolution,
            "strategy_selection": strategy_selection,
            "complex_prediction": complex_prediction,
            "interface_analysis": interface_analysis,
            "interface_confidence_summary": interface_confidence_summary,
            "structural_confidence_summary": structural_confidence_summary,
            "structural_evidence": structural_evidence,
            "pdb_output": pdb_output,
            "structural_feasibility": isolated_structure["structural_feasibility"],
            "isolated_structure": isolated_structure,
        }
        return apply_structural_provenance(
            payload,
            generated_at=generated_at,
            provider=context.config.structure_provider,
            model_id="esmfold_v1",
            model_version="1.0.0",
        )

    def failure_provenance(
        self,
        context: ExecutionContext,
        _exc: BaseException,
        _attempts: int,
    ) -> Provenance:
        provider = context.config.structure_provider
        return Provenance(
            originating_service=self.name,
            algorithms=["ESMFold single-chain folding", "CA-geometry analysis"],
            upstream_evidence_ids=self._upstream_ids(context),
            model_checkpoints=["esmfold_v1"],
            parameters={
                "provider": provider,
                **(
                    {
                        "provider_timeout_s": context.config.esmatlas_timeout_s,
                        "provider_max_attempts": self._esmatlas_max_attempts(context),
                    }
                    if provider == "esmfold_esmatlas"
                    else {}
                ),
            },
            references=["Lin et al. 2023 Science 379:1123 (ESMFold / ESM-2)"],
        )

    def run(self, context: ExecutionContext) -> EvidenceObject:
        pep = context.peptide
        provider = resolve_structure_provider(context.config)
        physicochemical_evidence = context.evidence(EvidenceType.PHYSICOCHEMICAL)
        target_resolution = resolve_target(context.target)

        prediction = provider.fold(pep.sequence)
        generated_at = utc_now_iso()

        include_pdb = bool(context.options.get("include_pdb", True))
        conf_layer = ConformationLayer(context.config)
        conf_available, conf_reason = conf_layer.availability()
        confidence_report = build_confidence_report(pep.sequence, prediction.per_residue_plddt)

        structure = prediction.to_public_dict(include_pdb=False)
        analysis = None
        try:
            analysis = analyze_structure(
                prediction.pdb, declared_disulfides=list(pep.disulfide_bridges)
            )
        except ValueError:
            analysis = None
        pdb_output = build_pdb_output(
            prediction=prediction,
            include_pdb=include_pdb,
            structure=structure,
            geometry=analysis,
            confidence_summary=confidence_report["confidence_summary"],
        )
        if pdb_output["status"] == "available":
            structure["pdb"] = pdb_output["content"]
            structure["per_residue_plddt"] = [round(v, 2) for v in prediction.per_residue_plddt]
        isolated_structure = build_isolated_structure(
            prediction=prediction,
            structure=structure,
            geometry=analysis,
            confidence_report=confidence_report,
            pdb_output=pdb_output,
        )
        structural_feasibility = build_structural_feasibility(
            structure=structure,
            geometry=analysis,
            confidence_summary=confidence_report["confidence_summary"],
            low_confidence_regions=confidence_report["low_confidence_regions"],
            requested_disulfides=list(pep.disulfide_bridges),
            pdb_output=pdb_output,
            include_pdb=include_pdb,
            isolated_structure_status=isolated_structure["status"],
        )
        isolated_structure["structural_feasibility"] = structural_feasibility
        strategy_selection = select_structural_strategy(
            peptide_sequence=pep.sequence,
            target_resolution=target_resolution,
            isolated_structure=isolated_structure,
            model_configuration=context.config,
            physicochemical_evidence=physicochemical_evidence,
        )
        complex_prediction = predict_complex(
            peptide_sequence=pep.sequence,
            target_resolution=target_resolution,
            strategy_selection=strategy_selection,
            config=context.config,
        )
        interface_analysis = unavailable_interface_analysis(complex_prediction)
        structural_confidence_summary = build_structural_confidence_summary(
            isolated_structure=isolated_structure,
            geometry=analysis,
            confidence_summary=confidence_report["confidence_summary"],
            structural_feasibility=structural_feasibility,
            target_resolution=target_resolution,
            complex_prediction=complex_prediction,
            interface_analysis=interface_analysis,
        )
        interface_confidence_summary = build_interface_confidence_summary(
            complex_prediction=complex_prediction,
            interface_analysis=interface_analysis,
        )
        structural_evidence = build_structural_evidence(
            isolated_structure=isolated_structure,
            target_resolution=target_resolution,
            strategy_selection=strategy_selection,
            complex_prediction=complex_prediction,
            interface_analysis=interface_analysis,
            interface_confidence_summary=interface_confidence_summary,
            structural_confidence_summary=structural_confidence_summary,
            peptide_sequence=pep.sequence,
            peptide_modifications=pep.mod_set.to_list(),
            disulfide_bridges=list(pep.disulfide_bridges),
        )

        payload = {
            "structure": structure,
            "geometry": (
                analysis
                if analysis is not None
                else {"status": "unavailable", "reason_code": "pdb_content_unavailable"}
            ),
            "per_residue_confidence": confidence_report["per_residue_confidence"],
            "low_confidence_regions": confidence_report["low_confidence_regions"],
            "confidence_summary": confidence_report["confidence_summary"],
            "pdb_output": pdb_output,
            "structural_feasibility": structural_feasibility,
            "isolated_structure": isolated_structure,
            "target_resolution": target_resolution,
            "strategy_selection": strategy_selection,
            "complex_prediction": complex_prediction,
            "interface_analysis": interface_analysis,
            "interface_confidence_summary": interface_confidence_summary,
            "structural_confidence_summary": structural_confidence_summary,
            "structural_evidence": structural_evidence,
            "conformation_layer": {
                "engine": "boltz2",
                "available": conf_available,
                "reason": conf_reason,
                "capabilities": [
                    "peptide_target_complex",
                    "binding_affinity",
                    "conformational_ensemble",
                ],
            },
        }
        apply_structural_provenance(
            payload,
            generated_at=generated_at,
            provider=prediction.provider,
            model_id=prediction.model_id,
            model_version=prediction.model_version,
        )

        mean_plddt = (
            analysis.get("mean_plddt") if analysis is not None else structure.get("mean_plddt")
        )
        # pLDDT is on 0..100; use it directly as a [0,1] structural confidence.
        conf_score = (mean_plddt / 100.0) if mean_plddt is not None else None

        warnings = []
        if mean_plddt is not None and mean_plddt < 50:
            warnings.append(
                "Low mean pLDDT (<50): peptide is likely disordered or the model is "
                "uncertain; treat 3D geometry as low-confidence."
            )
        warnings.extend(confidence_report["warnings"])

        provenance = Provenance(
            originating_service=self.name,
            algorithms=["ESMFold single-chain folding", "CA-geometry analysis"],
            upstream_evidence_ids=self._upstream_ids(context),
            model_checkpoints=[prediction.model_id],
            parameters={"provider": prediction.provider},
            external_databases=[],
            references=["Lin et al. 2023 Science 379:1123 (ESMFold / ESM-2)"],
        )

        return self._evidence(
            context,
            payload=payload,
            confidence=Confidence.make(
                conf_score,
                "model_plddt",
                rationale="Structural confidence taken from ESMFold per-residue pLDDT (mean).",
            ),
            uncertainty=Uncertainty(
                model_uncertainty=(1.0 - conf_score) if conf_score is not None else None,
                sources=["folding_model_uncertainty", "single_model_no_ensemble"],
            ),
            applicability=self._length_applicability(
                pep,
                min_len=2,
                max_len=provider.max_length,
                modality="all",
                notes=f"ESMFold via {prediction.provider}.",
            ),
            provenance=provenance,
            tier=EvidenceTier.STRUCTURE_MODEL,
            validation_status=ValidationStatus.INTERNALLY_VALIDATED,
            metadata={
                "structure_provider": prediction.provider,
                "plddt_scale": PLDDT_OUTPUT_SCALE,
                "raw_plddt_scale": prediction.raw_plddt_scale,
            },
            warnings=warnings,
        )

    @staticmethod
    def _upstream_ids(context: ExecutionContext):
        from ..domain.evidence import EvidenceType as ET

        ev = context.evidence(ET.PHYSICOCHEMICAL)
        return [ev.evidence_id] if ev else []

    @staticmethod
    def _esmatlas_max_attempts(context: ExecutionContext) -> int:
        return min(2, max(1, context.config.esmatlas_max_attempts))
