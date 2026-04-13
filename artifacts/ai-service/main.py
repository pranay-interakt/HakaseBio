import os
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json

from models.admet import predict_admet
from models.molecular_properties import predict_properties
from models.drug_target import predict_binding
from models.protein import predict_protein


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
