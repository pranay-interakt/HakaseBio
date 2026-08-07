import json
from typing import Any

import numpy as np
from fastapi import APIRouter, Body, HTTPException
from hakase_kernel.utils import sanitize
from pydantic import BaseModel

from hakase_structure import cofolding
from hakase_structure.protein import predict_protein
from hakase_structure.protein_ml import predict_protein_ml

router = APIRouter()


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


class SmilesRequest(BaseModel):
    smiles: str


class BindingRequest(BaseModel):
    smiles: str
    target_id: str | None = None


class ProteinRequest(BaseModel):
    uniprot_id: str


class FullPipelineRequest(BaseModel):
    smiles: str
    uniprot_id: str | None = None
    target_id: str | None = None


class DTAReq(BaseModel):
    smiles: str
    uniprot_or_seq: str


class BatchSmilesRequest(BaseModel):
    smiles: list[str]


class FpOrSmilesRequest(BaseModel):
    """Privacy-preserving input: send EITHER `smiles` OR a client-computed
    `features` vector (Morgan-1024 r2 || [MolWt, MolLogP, TPSA, HBD, HBA,
    FractionCSP3]). In `features` mode the server never receives the structure.
    """

    smiles: str | None = None
    features: list[float] | None = None


class Tox21HeadRequest(BaseModel):
    smiles: str
    assay: str


class PkAnchorRequest(BaseModel):
    """Layer-3 human-PK anchor request.

    Provide at least one identifier (InChIKey preferred for exact structural
    matching). `projected` optionally carries the Layer-3 allometric human PK
    (clearance, vd, thalf, auc, cmax) so the service can return an
    observed-vs-projected validation verdict.
    """

    name: str | None = None
    inchikey: str | None = None
    chembl_id: str | None = None
    smiles: str | None = None
    projected: dict[str, float] | None = None
    parameters: list[str] | None = None


class InVitroPanelRequest(BaseModel):
    smiles: str
    uniprot_id: str | None = None  # optional target → adds DeepDTA binding
    therapeutic_area: str | None = None


class ExplainRequest(BaseModel):
    """SHAP explanation request for a Layer-1 ML prediction."""

    smiles: str
    model: str = "dili"  # one of available_models(): cardiotox | dili | solubility
    top_k: int = 12


class BindingMlRequest(BaseModel):
    smiles: str
    uniprot_id: str


class CellTypeAggregationTarget(BaseModel):
    gene_symbol: str
    uniprot_id: str | None = None
    affinity_pKi: float | None = None


class CellTypeAggregationRequest(BaseModel):
    targets: list[CellTypeAggregationTarget]
    top_n: int = 25


class PatientLineRequest(BaseModel):
    target_gene_symbol: str
    l1_ic50_nM: float
    oncology: bool
    indication_keyword: str | None = None
    alpha: float = 1.0
    top_n: int = 25


class PkIviveRequest(BaseModel):
    """Layer 1 — quantitative human PK by IVIVE.

    `overrides` lets a caller substitute a MEASURED value for any Hakase ADMET input
    (keys: clint_hep_ul_min_1e6, fu_plasma, vdss_l_per_kg, half_life_obach_h,
    blood_plasma_ratio); measured wins over ML. `dose_mg` (optional) adds an
    assumption-free IV-bolus exposure block (AUC, C-t curve).
    """

    smiles: str
    overrides: dict[str, float] | None = None
    ml_inputs: dict[str, float] | None = None
    body_weight_kg: float = 70.0
    blood_plasma_ratio: float | None = None
    dose_mg: float | None = None


class AnimalCohortRequest(BaseModel):
    smiles: str
    species_id: str
    study_type_id: str
    route_of_admin: str
    cohort_size: int
    formulation: str
    starting_dose_mg_kg: float
    ml_admet: dict[str, Any]
    measured_noael_override: float | None = None


class AntibodyRequest(BaseModel):
    heavy_chain: str
    light_chain: str | None = None
    format_hint: str | None = None
    expression_host: str | None = None
    subclass: str | None = None
    target_antigen: str | None = None


class AntibodyMlRequest(BaseModel):
    heavy_chain: str
    light_chain: str | None = None


class ErsiliaRequest(BaseModel):
    endpoint: str
    smiles: str


class DockingRequest(BaseModel):
    smiles: str
    pdb_id: str
    exhaustiveness: int = 8
    num_modes: int = 5


class FepRequest(BaseModel):
    ligand_a_smiles: str
    ligand_b_smiles: str
    pdb_id: str
    n_lambda_windows: int = 12
    n_replicas: int = 3
    ns_per_window: float = 5.0


@router.post("/predict/protein-ml")
def api_predict_protein_ml(req: ProteinRequest):
    """Dedicated ESM-2 druggability prediction (independent second opinion)."""
    try:
        return sanitize(predict_protein_ml(req.uniprot_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ProteinML prediction failed: {str(e)}")


@router.post("/predict/protein")
def api_predict_protein(req: ProteinRequest):
    try:
        return sanitize(predict_protein(req.uniprot_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Protein analysis failed: {str(e)}")


@router.get("/predict/cofold/config")
def api_cofold_config():
    """Report whether the Boltz-2 RunPod GPU backend is configured.

    Returned to the UI so the Run button can be disabled with an honest
    message when credentials are missing — the design builder + validation
    still work without a GPU."""
    ok, reason = cofolding.cofolding_configured()
    return {
        "configured": ok,
        "reason": reason if not ok else None,
        "engine": cofolding.ENGINE,
        "engine_label": cofolding.ENGINE_LABEL,
    }


@router.post("/predict/cofold/validate")
def api_cofold_validate(req: dict = Body(...)):
    """Validate a biologics co-folding design and return the generated Boltz
    YAML plus a cost/runtime summary. Runs with NO GPU — lets clients iterate
    on a design for free before paying for a prediction."""
    try:
        design = cofolding.validate_design(req)
        yaml_text, needs_msa = cofolding.build_boltz_yaml(design)
        summary = cofolding.summarize_design(design)
        return sanitize(
            {
                "valid": True,
                "boltz_yaml": yaml_text,
                "uses_msa_server": needs_msa,
                "summary": summary,
                "engine": cofolding.ENGINE_LABEL,
            }
        )
    except cofolding.CoFoldValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Co-folding validation failed: {type(e).__name__}: {e}"
        )


@router.post("/predict/cofold")
def api_cofold_submit(req: dict = Body(...)):
    """Submit a biologics co-folding job to the Boltz-2 RunPod GPU endpoint.

    Asynchronous: returns job_id immediately. Poll
    GET /predict/cofold/status/{job_id} for progress + result.

    The design is validated and the Boltz YAML is built BEFORE any GPU is
    used. If the GPU backend is unconfigured this returns 503 with the exact
    missing-secret name; per project policy no structure is fabricated."""
    try:
        return sanitize(cofolding.submit_cofold(req))
    except cofolding.CoFoldValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # GPU backend not configured — endpoint exists, backend intentionally absent.
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Co-folding submission failed: {type(e).__name__}: {e}"
        )


@router.get("/predict/cofold/status/{job_id}")
def api_cofold_status(job_id: str):
    job = cofolding.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    return sanitize(job)
