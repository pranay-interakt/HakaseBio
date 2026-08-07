"""HTTP surface for this modality.

Expose a module-level ``router``; the composition root
(``service/src/hakase_service/main.py``) mounts it by import path.

Prefer a single prefixed router (``APIRouter(prefix="/v1/<modality>")``) over
scattered top-level paths: the gateway can then forward the whole prefix with
one wildcard mount instead of a per-endpoint table that drifts out of sync.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from hakase_kernel.utils import sanitize
from pydantic import BaseModel

router = APIRouter(prefix="/v1/MODALITY", tags=["MODALITY"])


class AnalyzeRequest(BaseModel):
    """Replace with the real input contract for this modality."""

    identifier: str


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "modality": "MODALITY"}


@router.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    """Run this modality's analysis.

    Never fabricate values. If a model or upstream service is unavailable,
    return a structured ``unavailable`` result with a machine-readable reason —
    a caller must be able to tell "we could not compute" from "we computed a
    low score".
    """
    try:
        result: dict[str, Any] = {"identifier": req.identifier, "verdict": None}
        return sanitize(result)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Analysis failed: {type(e).__name__}: {e}")
