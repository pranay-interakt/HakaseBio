import os
import numpy as np
# Eagerly import sklearn submodules on the main thread BEFORE any prewarm
# background thread can race on them. sklearn's submodules import each other
# lazily and concurrent first-imports from worker threads can deadlock with
# `ImportError: cannot import name 'clone' from partially initialized module
# 'sklearn.base'`. We have two ML prewarm threads (cardiotox + protein_ml) that
# both touch sklearn — pre-import here is the safe fix.
import sklearn  # noqa: F401
import sklearn.base  # noqa: F401
import sklearn.ensemble  # noqa: F401
import sklearn.linear_model  # noqa: F401
import sklearn.model_selection  # noqa: F401
import sklearn.pipeline  # noqa: F401
import sklearn.preprocessing  # noqa: F401
from fastapi import FastAPI, HTTPException, Body
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json

from models.admet import predict_admet
from models.molecular_properties import predict_properties
from models.drug_target import predict_binding
from models.protein import predict_protein
from models.admet_ml import (
    predict_admet_ml,
    is_ready as admet_ml_status,
    warmup as admet_ml_warmup,
)
from models.cardiotox import (
    predict_cardiotox,
    is_ready as cardiotox_status,
    warmup as cardiotox_warmup,
)
from models.protein_ml import (
    predict_protein_ml,
    is_ready as protein_ml_status,
    warmup as protein_ml_warmup,
)
from models.solubility_ml import (
    predict_solubility_ml,
    is_ready as solubility_ml_status,
    warmup as solubility_ml_warmup,
)
from models.binding_ml import (
    predict_binding_ml,
    is_ready as binding_ml_status,
    warmup as binding_ml_warmup,
)
from models.dili_ml import (
    predict_dili_ml,
    is_ready as dili_ml_status,
    warmup as dili_ml_warmup,
)
from models.celltype_aggregation import (
    predict_celltype_aggregation,
    is_ready as celltype_aggregation_status,
    warmup as celltype_aggregation_warmup,
)
from models.patient_line import (
    predict_patient_line,
    is_ready as patient_line_status,
    warmup as patient_line_warmup,
)
from models import docking_vina
from models import fep_runpod
from models import cofolding
from models.peptide_properties import predict_peptide_properties
from models.antibody_properties import predict_antibody_properties


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


def sanitize(obj):
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj

app = FastAPI(
    title="HakaseAI — AI Drug Discovery Service",
    description="Python-based AI prediction service for ADMET, molecular properties, drug-target interaction, and protein analysis.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _prewarm_in_background() -> None:
    """Background-prewarm small ML models so the first user doesn't pay cold-load.

    - CardioTox: ~22s fresh train, ~1s from cache.
    - ProteinML: heavy on first cold start (downloads ~140 MB ESM-2 weights and
      embeds ~160 training proteins, can take 5-15 min on CPU). Subsequent
      starts read everything from cache and are seconds. Either way, running on
      a background thread means /health and other endpoints stay responsive.

    ADMET-AI is intentionally not prewarmed (~30s + heavy memory; existing UI
    handles cold-load gracefully).
    """
    import threading
    threading.Thread(target=cardiotox_warmup, name="cardiotox-prewarm", daemon=True).start()
    threading.Thread(target=protein_ml_warmup, name="protein-ml-prewarm", daemon=True).start()
    threading.Thread(target=solubility_ml_warmup, name="solubility-ml-prewarm", daemon=True).start()
    threading.Thread(target=binding_ml_warmup, name="binding-ml-prewarm", daemon=True).start()
    threading.Thread(target=dili_ml_warmup, name="dili-ml-prewarm", daemon=True).start()
    threading.Thread(target=celltype_aggregation_warmup, name="celltype-aggregation-prewarm", daemon=True).start()
    threading.Thread(target=patient_line_warmup, name="patient-line-prewarm", daemon=True).start()


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


@app.get("/health")
def health():
    return {"status": "ok", "service": "HakaseAI AI Service", "version": "1.0.0"}


@app.post("/predict/admet")
def api_predict_admet(req: SmilesRequest):
    try:
        return sanitize(predict_admet(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ADMET prediction failed: {str(e)}")


@app.post("/predict/admet-ml")
def api_predict_admet_ml(req: SmilesRequest):
    """ML-enhanced ADMET prediction via ADMET-AI (Chemprop GNN ensemble)."""
    try:
        return sanitize(predict_admet_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ADMET-ML prediction failed: {str(e)}")


@app.post("/predict/cardiotox")
def api_predict_cardiotox(req: SmilesRequest):
    """Dedicated hERG cardiotoxicity prediction (independent second opinion)."""
    try:
        return sanitize(predict_cardiotox(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CardioTox prediction failed: {str(e)}")


@app.post("/predict/dili-ml")
def api_predict_dili_ml(req: SmilesRequest):
    """Layer 3 Stage 2 — binary DILI-risk classifier (TDC DILI / Xu 2015, RF)."""
    try:
        return sanitize(predict_dili_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DILI-ML prediction failed: {str(e)}")


@app.post("/predict/protein-ml")
def api_predict_protein_ml(req: ProteinRequest):
    """Dedicated ESM-2 druggability prediction (independent second opinion)."""
    try:
        return sanitize(predict_protein_ml(req.uniprot_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ProteinML prediction failed: {str(e)}")


@app.post("/predict/solubility-ml")
def api_predict_solubility_ml(req: SmilesRequest):
    """Dedicated aqueous-solubility (logS) prediction (independent second opinion)."""
    try:
        return sanitize(predict_solubility_ml(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SolubilityML prediction failed: {str(e)}")


class BindingMlRequest(BaseModel):
    smiles: str
    uniprot_id: str


@app.post("/predict/binding-ml")
def api_predict_binding_ml(req: BindingMlRequest):
    """Dedicated DeepDTA-style binding-affinity prediction (independent second opinion).

    Pairs the existing ChEMBL-similarity binding path: that path looks up
    measured pIC50 from ≥70%-Tanimoto neighbors in ChEMBL (no learning,
    coverage gap when no neighbors exist). This path is a learned regressor
    on (Morgan FP + RDKit descriptors) ⊕ ESM-2 mean-pool embedding so it
    generalizes to unseen drug-target pairs.
    """
    try:
        return sanitize(predict_binding_ml(req.smiles, req.uniprot_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BindingML prediction failed: {str(e)}")


class CellTypeAggregationTarget(BaseModel):
    gene_symbol: str
    uniprot_id: str | None = None
    affinity_pKi: float | None = None


class CellTypeAggregationRequest(BaseModel):
    targets: list[CellTypeAggregationTarget]
    top_n: int = 25


@app.post("/predict/celltype-aggregation")
def api_predict_celltype_aggregation(req: CellTypeAggregationRequest):
    """Layer 3 Stage 3 — Drug2cell-style scoring over Tabula Sapiens v2.

    Atlas Parquet must be provisioned via colab_notebooks/prepare_tabula_sapiens.ipynb
    before this endpoint can succeed. When the Parquet is missing the endpoint returns
    HTTP 503 with `source = "data-not-provisioned"` and a remediation hint — there is
    NO synthetic fallback (project-wide policy: NO fake data, NO silent fallbacks).
    """
    try:
        result = predict_celltype_aggregation(
            targets=[t.model_dump() for t in req.targets],
            top_n=req.top_n,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CellTypeAggregation failed: {type(e).__name__}: {e}")

    sanitized = sanitize(result)
    if sanitized.get("source") == "data-not-provisioned":
        # 503 lets callers distinguish "atlas not loaded yet" from a real prediction failure.
        raise HTTPException(status_code=503, detail=sanitized)
    if sanitized.get("source") == "input-error":
        raise HTTPException(status_code=400, detail=sanitized)
    return sanitized


class PatientLineRequest(BaseModel):
    target_gene_symbol: str
    l1_ic50_nM: float
    oncology: bool
    indication_keyword: str | None = None
    alpha: float = 1.0
    top_n: int = 25


@app.post("/predict/patient-line")
def api_predict_patient_line(req: PatientLineRequest):
    """Layer 3 Stage 4 — Patient-line projection across DepMap PRISM 24Q2 oncology panel.

    Snapshot Parquet must be provisioned via colab_notebooks/prepare_depmap_prism.ipynb
    before this endpoint can succeed. When the Parquet is missing the endpoint returns
    HTTP 503 with `source = "data-not-provisioned"` and a remediation hint — there is
    NO synthetic fallback (project-wide policy: NO fake data, NO silent fallbacks).

    Non-oncology callers (oncology=False) get HTTP 400 with `source = "out-of-domain"` —
    they should mark Stage 4 as not_applicable via the Manual Entry path instead.
    """
    try:
        result = predict_patient_line(
            target_gene_symbol=req.target_gene_symbol,
            l1_ic50_nM=req.l1_ic50_nM,
            oncology=req.oncology,
            indication_keyword=req.indication_keyword,
            alpha=req.alpha,
            top_n=req.top_n,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PatientLine projection failed: {type(e).__name__}: {e}")

    sanitized = sanitize(result)
    if sanitized.get("source") == "data-not-provisioned":
        raise HTTPException(status_code=503, detail=sanitized)
    if sanitized.get("source") == "out-of-domain":
        raise HTTPException(status_code=400, detail=sanitized)
    if sanitized.get("source") == "input-error":
        raise HTTPException(status_code=400, detail=sanitized)
    return sanitized


@app.get("/models/status")
def api_models_status():
    """Report which ML models are loaded and ready."""
    return {
        "admet_ml": admet_ml_status(),
        "cardiotox": cardiotox_status(),
        "dili_ml": dili_ml_status(),
        "protein_ml": protein_ml_status(),
        "solubility_ml": solubility_ml_status(),
        "binding_ml": binding_ml_status(),
        "celltype_aggregation": celltype_aggregation_status(),
        "patient_line": patient_line_status(),
    }


@app.post("/models/warmup")
def api_models_warmup():
    """Force-load ML models (use after deploy or first session)."""
    return {
        "admet_ml": admet_ml_warmup(),
        "cardiotox": cardiotox_warmup(),
        "dili_ml": dili_ml_warmup(),
        "protein_ml": protein_ml_warmup(),
        "solubility_ml": solubility_ml_warmup(),
        "binding_ml": binding_ml_warmup(),
        "celltype_aggregation": celltype_aggregation_warmup(),
        "patient_line": patient_line_warmup(),
    }


@app.post("/predict/properties")
def api_predict_properties(req: SmilesRequest):
    try:
        return sanitize(predict_properties(req.smiles))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Property prediction failed: {str(e)}")


@app.post("/predict/binding")
def api_predict_binding(req: BindingRequest):
    try:
        return sanitize(predict_binding(req.smiles, req.target_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Binding prediction failed: {str(e)}")


@app.post("/predict/protein")
def api_predict_protein(req: ProteinRequest):
    try:
        return sanitize(predict_protein(req.uniprot_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Protein analysis failed: {str(e)}")


class PeptideRequest(BaseModel):
    sequence: str
    cyclic: bool = False


@app.post("/predict/peptide")
def api_predict_peptide(req: PeptideRequest):
    """Layer 1 — Peptide-native property engine.

    Accepts a single-letter amino acid sequence (standard + modified residues)
    and returns physicochemical, stability, permeability, AMP, and
    developability predictions computed purely from published formulae
    (Kyte-Doolittle, Guruprasad, Ikai, Boman, Eisenberg, Chou-Fasman).

    No external API calls — runs in-process, sub-millisecond.
    """
    try:
        return sanitize(predict_peptide_properties(req.sequence, req.cyclic))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Peptide analysis failed: {str(e)}")


class AntibodyRequest(BaseModel):
    heavy_chain: str
    light_chain: str | None = None
    format_hint: str | None = None


@app.post("/predict/antibody")
def api_predict_antibody(req: AntibodyRequest):
    """Layer 1 — Antibody-native developability engine.

    Accepts a heavy-chain (or VHH / single-domain / scFv) sequence and an
    optional light-chain sequence, and returns a developability profile:
    chain-type and format inference, CDR localisation, a deterministic CDR
    liability scan (glycosylation, deamidation, isomerisation, oxidation,
    free cysteine), Therapeutic-Antibody-Profiler-style developability flags,
    aggregation-prone regions and a coarse immunogenicity screen.

    All values are computed from published, citable rules — no external API
    calls, no fabrication. Anything that cannot be derived honestly (e.g. a
    calibrated humanness score) is returned as null with an explicit note.
    """
    try:
        return sanitize(predict_antibody_properties(
            req.heavy_chain, req.light_chain, req.format_hint,
        ))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Antibody analysis failed: {str(e)}")


class DockingRequest(BaseModel):
    smiles: str
    pdb_id: str
    exhaustiveness: int = 8
    num_modes: int = 5


@app.post("/predict/dock")
def api_dock_submit(req: DockingRequest):
    """Layer 2 Stage 2 — AutoDock Vina docking (in-app, physical scoring).

    Asynchronous job: returns job_id immediately. Poll
    GET /predict/dock/status/{job_id} for progress + result.

    Pipeline (subprocess-based, no conflicting Python deps):
      RDKit 2026 → 3D embed + UFF optimize
      → obabel → ligand PDBQT (Gasteiger charges, pH 7.4)
      → RCSB fetch + clean → receptor PDBQT
      → box selection (co-crystal centroid first, blind dock fallback)
      → AutoDock Vina v1.2.7

    Strict project policy: NO fake data, NO silent fallbacks. Box method is
    always reported (`co_crystal` | `blind_dock`) so the reviewer can never
    confuse a blind dock for a pocket-targeted one.
    """
    if not req.smiles or not req.smiles.strip():
        raise HTTPException(status_code=400, detail="smiles is required")
    if not req.pdb_id or not req.pdb_id.strip():
        raise HTTPException(status_code=400, detail="pdb_id is required")
    if not (1 <= req.exhaustiveness <= 32):
        raise HTTPException(status_code=400, detail="exhaustiveness must be 1..32")
    if not (1 <= req.num_modes <= 20):
        raise HTTPException(status_code=400, detail="num_modes must be 1..20")
    job_id = docking_vina.submit_dock(
        smiles=req.smiles.strip(),
        pdb_id=req.pdb_id.strip(),
        exhaustiveness=req.exhaustiveness,
        num_modes=req.num_modes,
    )
    return {"job_id": job_id, "status": "queued"}


@app.get("/predict/dock/status/{job_id}")
def api_dock_status(job_id: str):
    job = docking_vina.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    return sanitize(job)


class FepRequest(BaseModel):
    ligand_a_smiles: str
    ligand_b_smiles: str
    pdb_id: str
    n_lambda_windows: int = 12
    n_replicas: int = 3
    ns_per_window: float = 5.0


@app.get("/predict/fep/config")
def api_fep_config():
    """Report whether the RunPod backend for Stage 5 FEP is configured.

    Returned to the UI so the Run button can be disabled with an honest
    message when credentials are missing — instead of letting the user
    click and hit a 503 mid-submission.
    """
    ok, reason = fep_runpod.runpod_configured()
    return {"configured": ok, "reason": reason if not ok else None}


@app.post("/predict/fep")
def api_fep_submit(req: FepRequest):
    """Layer 2 Stage 5 — relative-binding free-energy refinement (TIES on RunPod).

    Asynchronous job: returns job_id immediately. Poll
    GET /predict/fep/status/{job_id} for progress + result.

    Pipeline (delegated to a user-provisioned RunPod Serverless worker):
      OpenMM + OpenFF Sage + TIES → relative-binding FEP, ΔΔG (B - A)
      Typical wall time ~24 GPU-h on A100 per ligand pair.

    Strict project policy: NO fabricated ΔΔG. If RunPod credentials are
    unset, this endpoint returns 503 with the exact missing-secret name
    so the operator can fix it; the UI surfaces the reason verbatim.
    """
    if not req.ligand_a_smiles or not req.ligand_a_smiles.strip():
        raise HTTPException(status_code=400, detail="ligand_a_smiles is required")
    if not req.ligand_b_smiles or not req.ligand_b_smiles.strip():
        raise HTTPException(status_code=400, detail="ligand_b_smiles is required")
    if not req.pdb_id or not req.pdb_id.strip():
        raise HTTPException(status_code=400, detail="pdb_id is required")
    if not (4 <= req.n_lambda_windows <= 32):
        raise HTTPException(status_code=400, detail="n_lambda_windows must be 4..32")
    if not (1 <= req.n_replicas <= 5):
        raise HTTPException(status_code=400, detail="n_replicas must be 1..5")
    if not (0.1 <= req.ns_per_window <= 50.0):
        raise HTTPException(status_code=400, detail="ns_per_window must be 0.1..50.0")

    ok, reason = fep_runpod.runpod_configured()
    if not ok:
        # 503 (Service Unavailable) — the endpoint exists but its GPU backend
        # is intentionally unconfigured. The UI shows `reason` verbatim.
        raise HTTPException(status_code=503, detail=f"RunPod not configured: {reason}")

    try:
        job_id = fep_runpod.submit_fep(
            ligand_a_smiles  = req.ligand_a_smiles.strip(),
            ligand_b_smiles  = req.ligand_b_smiles.strip(),
            pdb_id           = req.pdb_id.strip(),
            n_lambda_windows = req.n_lambda_windows,
            n_replicas       = req.n_replicas,
            ns_per_window    = req.ns_per_window,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"job_id": job_id, "status": "queued"}


@app.get("/predict/fep/status/{job_id}")
def api_fep_status(job_id: str):
    job = fep_runpod.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    return sanitize(job)


# ---------------------------------------------------------------------------
# L2 Stage 2b — Biologics Co-Folding (AlphaFold3-class structure + affinity)
#
# Boltz-2 (MIT license) co-folds an arbitrary biomolecular complex — proteins,
# peptides, DNA, RNA, ligands, ions, modified residues, covalent bonds — and
# predicts a binding affinity for ligand binders. This extends the platform
# beyond small-molecule-only scope to peptide / antibody / nucleic-acid
# modalities. AlphaFold 3 itself is non-commercial-only and is intentionally
# NOT used as a backend here; see models/cofolding.py for the rationale.
# ---------------------------------------------------------------------------

@app.get("/predict/cofold/config")
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


@app.post("/predict/cofold/validate")
def api_cofold_validate(req: dict = Body(...)):
    """Validate a biologics co-folding design and return the generated Boltz
    YAML plus a cost/runtime summary. Runs with NO GPU — lets clients iterate
    on a design for free before paying for a prediction."""
    try:
        design = cofolding.validate_design(req)
        yaml_text, needs_msa = cofolding.build_boltz_yaml(design)
        summary = cofolding.summarize_design(design)
        return sanitize({
            "valid": True,
            "boltz_yaml": yaml_text,
            "uses_msa_server": needs_msa,
            "summary": summary,
            "engine": cofolding.ENGINE_LABEL,
        })
    except cofolding.CoFoldValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Co-folding validation failed: {type(e).__name__}: {e}")


@app.post("/predict/cofold")
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
        raise HTTPException(status_code=500, detail=f"Co-folding submission failed: {type(e).__name__}: {e}")


@app.get("/predict/cofold/status/{job_id}")
def api_cofold_status(job_id: str):
    job = cofolding.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job_id: {job_id}")
    return sanitize(job)


@app.post("/predict/full-pipeline")
def api_full_pipeline(req: FullPipelineRequest):
    try:
        admet_result = predict_admet(req.smiles)
        properties_result = predict_properties(req.smiles)
        binding_result = predict_binding(req.smiles, req.target_id)

        protein_result = None
        if req.uniprot_id:
            protein_result = predict_protein(req.uniprot_id)

        return sanitize({
            "smiles": req.smiles,
            "admet": admet_result,
            "molecular_properties": properties_result,
            "drug_target_interaction": binding_result,
            "protein_analysis": protein_result,
            "pipeline_info": {
                "engine": "HakaseAI Full AI Pipeline v1.0",
                "modules_run": [
                    "ADMET Profiling",
                    "Molecular Properties",
                    "Drug-Target Interaction",
                ] + (["Protein Analysis"] if req.uniprot_id else []),
            },
        })
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("AI_SERVICE_PORT", "8090"))
    uvicorn.run(app, host="0.0.0.0", port=port)
