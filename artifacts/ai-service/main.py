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
from fastapi import FastAPI, HTTPException
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
