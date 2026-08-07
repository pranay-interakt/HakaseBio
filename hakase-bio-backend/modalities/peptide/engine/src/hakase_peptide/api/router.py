"""FastAPI router for the HakaseAI Peptide Discovery Platform V3.

Mounted under ``/v3/peptide``. Endpoints return standardized Evidence Objects
and Decision Records. Errors are surfaced as structured HTTP responses; the
platform never returns a fabricated result in place of a real one.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from hakase_kernel.config import get_config
from hakase_kernel.faults import ServiceFailure
from hakase_structure.confidence import build_confidence_report
from hakase_structure.structural_confidence import (
    build_interface_confidence_summary,
    build_structural_confidence_summary,
)
from pydantic import BaseModel, Field, model_validator

from .. import PLATFORM_NAME, PLATFORM_VERSION
from ..decision import get_policy_store
from ..domain.ids import utc_now_iso
from ..domain.peptide import DisulfideBridgeSpec, Peptide, PeptideValidationError
from ..domain.structural_strategy import select_structural_strategy
from ..domain.target import Target, TargetValidationError
from ..domain.target_resolution import resolve_target
from ..infrastructure import get_audit_log, get_model_registry
from ..jsonsafe import sanitize as _sanitize
from ..pipeline import analyze_functional, analyze_peptide, analyze_physicochemical
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
)


# ---- request models ---------------------------------------------------------
class TargetModel(BaseModel):
    name: str | None = Field(default=None, description="Human-readable target name.")
    uniprot_accession: str | None = Field(
        default=None,
        description="UniProt protein accession; syntax is validated but not resolved.",
    )
    sequence: str | None = Field(
        default=None,
        description=(
            "Target protein sequence. Whitespace is removed and only the 20 standard "
            "amino acids are accepted; ambiguous/non-standard B/Z/X/J/U/O follow the "
            "peptide-domain convention and are rejected."
        ),
    )
    pdb_id: str | None = Field(
        default=None,
        description="Four-character PDB identifier; syntax is validated but not resolved.",
    )
    chain_id: str | None = Field(
        default=None,
        description="Optional PDB chain identifier. Requires pdb_id and preserves case.",
    )
    organism: str | None = Field(default=None, description="Optional source organism name.")

    @model_validator(mode="after")
    def normalize_and_validate(self) -> TargetModel:
        try:
            target = Target.create(**self.model_dump())
        except TargetValidationError as exc:
            raise ValueError(str(exc)) from exc
        self.name = target.name
        self.uniprot_accession = target.uniprot_accession
        self.sequence = target.sequence
        self.pdb_id = target.pdb_id
        self.chain_id = target.chain_id
        self.organism = target.organism
        return self


class AnalyzeRequest(BaseModel):
    sequence: str
    cyclic: bool = False
    ph: float = 7.4
    ionic_strength_mM: float = 150.0
    disulfide_bridges: DisulfideBridgeSpec | None = None
    modifications: dict[str, Any] | None = None
    target: TargetModel | None = None
    policy_id: str | None = None
    modality: str | None = None
    include_pdb: bool = False


class PhysicochemicalRequest(BaseModel):
    sequence: str
    cyclic: bool = False
    ph: float = 7.4
    ionic_strength_mM: float = 150.0
    disulfide_bridges: DisulfideBridgeSpec | None = None
    modifications: dict[str, Any] | None = None


class StructureRequest(BaseModel):
    sequence: str
    disulfide_bridges: DisulfideBridgeSpec | None = None
    target: TargetModel | None = None
    include_pdb: bool = True


class FunctionalRequest(BaseModel):
    sequence: str
    cyclic: bool = False
    ph: float = 7.4
    ionic_strength_mM: float = 150.0
    disulfide_bridges: str | None = None
    modifications: dict[str, Any] | None = None
    target: TargetModel | None = None
    modality: str | None = None


class ConformationRequest(BaseModel):
    sequence: str
    target: TargetModel | None = None
    with_affinity: bool = True
    options: dict[str, Any] | None = None


def get_router() -> APIRouter:
    router = APIRouter(prefix="/v3/peptide", tags=["peptide-v3"])

    @router.get("/health")
    def health() -> dict[str, Any]:
        cfg = get_config()
        return {
            "platform": PLATFORM_NAME,
            "version": PLATFORM_VERSION,
            "structure_provider": cfg.structure_provider,
            "embedding_provider": cfg.embedding_provider,
            "nvidia_enabled": cfg.nvidia_enabled,
            "conformation_layer_enabled": cfg.conformation_layer_enabled,
            "strict_ml": cfg.strict_ml,
        }

    @router.get("/policies")
    def policies() -> dict[str, Any]:
        return _sanitize({"policies": [p.to_dict() for p in get_policy_store().all()]})

    @router.get("/models")
    def models() -> dict[str, Any]:
        return _sanitize({"models": [m.to_dict() for m in get_model_registry().all()]})

    @router.get("/audit/{execution_id}")
    def audit(execution_id: str) -> dict[str, Any]:
        recs = get_audit_log().for_execution(execution_id)
        if not recs:
            raise HTTPException(status_code=404, detail="No audit records for that execution_id.")
        return _sanitize({"execution_id": execution_id, "records": [r.to_dict() for r in recs]})

    @router.post("/analyze")
    def analyze(req: AnalyzeRequest) -> dict[str, Any]:
        try:
            result = analyze_peptide(
                sequence=req.sequence,
                cyclic=req.cyclic,
                ph=req.ph,
                ionic_strength_mM=req.ionic_strength_mM,
                disulfide_bridges=req.disulfide_bridges,
                modifications=req.modifications,
                target=req.target.model_dump() if req.target else None,
                policy_id=req.policy_id,
                modality=req.modality,
                include_pdb=req.include_pdb,
            )
            return _sanitize(result)
        except (PeptideValidationError, TargetValidationError) as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except ServiceFailure as exc:
            raise HTTPException(
                status_code=503, detail={"reason_code": exc.reason_code, "message": str(exc)}
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")

    @router.post("/physicochemical")
    def physicochemical(req: PhysicochemicalRequest) -> dict[str, Any]:
        """Deterministic physicochemical evidence only (no decision layer).

        Exposes the single §14 Physicochemical Evidence Object assembled by the
        Physicochemical Service — descriptors, embeddings (by reference),
        provenance and per-descriptor confidence — without running the other
        services or resolving a decision policy.
        """
        try:
            result = analyze_physicochemical(
                sequence=req.sequence,
                cyclic=req.cyclic,
                ph=req.ph,
                ionic_strength_mM=req.ionic_strength_mM,
                disulfide_bridges=req.disulfide_bridges,
                modifications=req.modifications,
            )
            return _sanitize(result)
        except PeptideValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except ServiceFailure as exc:
            raise HTTPException(
                status_code=503, detail={"reason_code": exc.reason_code, "message": str(exc)}
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")

    @router.post("/structure")
    def structure(req: StructureRequest) -> dict[str, Any]:
        try:
            pep = Peptide.create(req.sequence, disulfide_bridges=req.disulfide_bridges)
            target = Target.create(**req.target.model_dump()) if req.target else None
            target_resolution = resolve_target(target)
            provider = resolve_structure_provider()
            pred = provider.fold(pep.sequence)
            generated_at = utc_now_iso()
            confidence_report = build_confidence_report(pep.sequence, pred.per_residue_plddt)
            structure = pred.to_public_dict(include_pdb=False)
            analysis = None
            try:
                analysis = analyze_structure(
                    pred.pdb, declared_disulfides=list(pep.disulfide_bridges)
                )
            except ValueError:
                analysis = None
            pdb_output = build_pdb_output(
                prediction=pred,
                include_pdb=req.include_pdb,
                structure=structure,
                geometry=analysis,
                confidence_summary=confidence_report["confidence_summary"],
            )
            if pdb_output["status"] == "available":
                structure["pdb"] = pdb_output["content"]
                structure["per_residue_plddt"] = [round(v, 2) for v in pred.per_residue_plddt]
            isolated_structure = build_isolated_structure(
                prediction=pred,
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
                include_pdb=req.include_pdb,
                isolated_structure_status=isolated_structure["status"],
            )
            isolated_structure["structural_feasibility"] = structural_feasibility
            cfg = get_config()
            strategy_selection = select_structural_strategy(
                peptide_sequence=pep.sequence,
                target_resolution=target_resolution,
                isolated_structure=isolated_structure,
                model_configuration=cfg,
            )
            complex_prediction = predict_complex(
                peptide_sequence=pep.sequence,
                target_resolution=target_resolution,
                strategy_selection=strategy_selection,
                config=cfg,
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
                "target": req.target.model_dump() if req.target else None,
                "target_resolution": target_resolution,
                "strategy_selection": strategy_selection,
                "complex_prediction": complex_prediction,
                "interface_analysis": interface_analysis,
                "interface_confidence_summary": interface_confidence_summary,
                "structural_confidence_summary": structural_confidence_summary,
                "structural_evidence": structural_evidence,
                "warnings": confidence_report["warnings"],
            }
            return _sanitize(
                apply_structural_provenance(
                    payload,
                    generated_at=generated_at,
                    provider=pred.provider,
                    model_id=pred.model_id,
                    model_version=pred.model_version,
                )
            )
        except PeptideValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except ServiceFailure as exc:
            raise HTTPException(
                status_code=503, detail={"reason_code": exc.reason_code, "message": str(exc)}
            )

    @router.post("/functional")
    def functional(req: FunctionalRequest) -> dict[str, Any]:
        """Deterministic + ML functional evidence only (no decision layer).

        Runs Physicochemical -> Structural -> Functional (Functional depends on
        the first two) and returns the Functional Evidence Object plus the
        upstream evidence it was derived from, without resolving a decision
        policy. ``modality`` drives the Workflow Selector (§6.1); omitted or
        unrecognized modalities fall back to a generic predictor set.
        """
        try:
            result = analyze_functional(
                sequence=req.sequence,
                cyclic=req.cyclic,
                ph=req.ph,
                ionic_strength_mM=req.ionic_strength_mM,
                disulfide_bridges=req.disulfide_bridges,
                modifications=req.modifications,
                target=req.target.model_dump() if req.target else None,
                modality=req.modality,
            )
            return _sanitize(result)
        except (PeptideValidationError, TargetValidationError) as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except ServiceFailure as exc:
            raise HTTPException(
                status_code=503, detail={"reason_code": exc.reason_code, "message": str(exc)}
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")

    @router.get("/conformation/availability")
    def conformation_availability() -> dict[str, Any]:
        available, reason = ConformationLayer().availability()
        return {"available": available, "reason": reason, "engine": "boltz2"}

    @router.post("/conformation/submit")
    def conformation_submit(req: ConformationRequest) -> dict[str, Any]:
        try:
            pep = Peptide.create(req.sequence)
            tgt = Target.create(**req.target.model_dump()) if req.target else None
            job = ConformationLayer().submit_complex(
                pep, tgt, with_affinity=req.with_affinity, options=req.options
            )
            return _sanitize(job)
        except PeptideValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except ServiceFailure as exc:
            # Disabled conformation layer -> 503 with a clear, structured reason.
            raise HTTPException(
                status_code=503, detail={"reason_code": exc.reason_code, "message": str(exc)}
            )

    @router.get("/conformation/status/{job_id}")
    def conformation_status(job_id: str) -> dict[str, Any]:
        job = ConformationLayer().job_status(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found.")
        return _sanitize(job)

    return router
