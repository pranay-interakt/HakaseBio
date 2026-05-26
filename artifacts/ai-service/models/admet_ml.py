"""ADMET-AI ML predictor wrapper.

Wraps the open-source ADMET-AI Chemprop model (41 ADMET endpoints + 60 physchem
descriptors). Uses lazy singleton loading so the FastAPI service starts fast
and only pays the ~30s model-load cost on first prediction. Falls back
gracefully when the underlying package or weights are unavailable.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

_MODEL: Any = None
_LOAD_LOCK = threading.Lock()
_LOAD_ERROR: str | None = None
_LOAD_TIME_S: float | None = None


def _load_model() -> Any:
    """Lazy-load the ADMET-AI model (singleton, thread-safe)."""
    global _MODEL, _LOAD_ERROR, _LOAD_TIME_S
    if _MODEL is not None:
        return _MODEL
    with _LOAD_LOCK:
        if _MODEL is not None:
            return _MODEL
        try:
            from admet_ai import ADMETModel  # type: ignore[import-not-found]

            t0 = time.time()
            logger.info("Loading ADMET-AI model (first call only)...")
            _MODEL = ADMETModel()
            _LOAD_TIME_S = time.time() - t0
            logger.info("ADMET-AI model loaded in %.2fs", _LOAD_TIME_S)
            return _MODEL
        except Exception as exc:  # noqa: BLE001 - we want any failure here
            _LOAD_ERROR = f"{type(exc).__name__}: {exc}"
            logger.exception("Failed to load ADMET-AI model")
            raise


def is_ready() -> dict[str, Any]:
    """Report load status without forcing a load."""
    return {
        "loaded": _MODEL is not None,
        "load_time_s": _LOAD_TIME_S,
        "error": _LOAD_ERROR,
        "engine": "ADMET-AI v2 (Chemprop-RDKit ensemble)",
    }


def warmup() -> dict[str, Any]:
    """Force model load (used by /models/warmup endpoint)."""
    try:
        _load_model()
        return {"status": "ready", **is_ready()}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc), **is_ready()}


def _normalize_result(raw: Any, smiles: str) -> dict[str, float | str | None]:
    """ADMET-AI returns a pandas DataFrame; normalize to a flat dict."""
    if hasattr(raw, "iloc") and hasattr(raw, "columns"):
        try:
            row = raw.iloc[0].to_dict()
        except Exception:
            row = dict(raw.iloc[0])
    elif isinstance(raw, dict):
        row = raw
    else:
        row = {}
    cleaned: dict[str, float | str | None] = {}
    for k, v in row.items():
        if v is None:
            cleaned[k] = None
            continue
        try:
            cleaned[k] = float(v)
        except (TypeError, ValueError):
            cleaned[k] = str(v)
    return cleaned


# Endpoints we surface as the primary safety/ADMET signal in the UI.
# Names match ADMET-AI's column conventions; values are probabilities (0-1)
# unless otherwise noted.
KEY_ENDPOINTS: dict[str, dict[str, str]] = {
    "absorption": {
        "Caco2_Wang": "Caco-2 permeability (log cm/s)",
        "HIA_Hou": "Human intestinal absorption (probability)",
        "Pgp_Broccatelli": "P-glycoprotein substrate (probability)",
        "Bioavailability_Ma": "Oral bioavailability (probability)",
        "Lipophilicity_AstraZeneca": "Lipophilicity (logD7.4)",
        "Solubility_AqSolDB": "Aqueous solubility (logS)",
    },
    "distribution": {
        "BBB_Martins": "Blood-brain barrier penetration (probability)",
        "PPBR_AZ": "Plasma protein binding (%)",
        "VDss_Lombardo": "Volume of distribution (L/kg)",
    },
    "metabolism": {
        "CYP1A2_Veith": "CYP1A2 inhibition (probability)",
        "CYP2C9_Veith": "CYP2C9 inhibition (probability)",
        "CYP2C19_Veith": "CYP2C19 inhibition (probability)",
        "CYP2D6_Veith": "CYP2D6 inhibition (probability)",
        "CYP3A4_Veith": "CYP3A4 inhibition (probability)",
    },
    "excretion": {
        "Clearance_Hepatocyte_AZ": "Hepatocyte clearance (mL/min/kg)",
        "Half_Life_Obach": "Half-life (hours)",
    },
    "toxicity": {
        "hERG": "hERG channel blockade (probability)",
        "AMES": "Ames mutagenicity (probability)",
        "DILI": "Drug-induced liver injury (probability)",
        "LD50_Zhu": "Acute toxicity LD50 (log mol/kg)",
        "Carcinogens_Lagunin": "Carcinogenicity (probability)",
        "ClinTox": "Clinical toxicity (probability)",
        "Skin_Reaction": "Skin sensitization (probability)",
    },
}


def _structured_view(flat: dict[str, float | str | None]) -> dict[str, dict[str, dict[str, float | str | None]]]:
    """Group the key endpoints into ADMET buckets for the UI.

    Always returns every bucket key (absorption/distribution/metabolism/
    excretion/toxicity) so consumers can rely on a stable shape even when
    the ML model is unavailable.
    """
    structured: dict[str, dict[str, dict[str, float | str | None]]] = {}
    for bucket, endpoints in KEY_ENDPOINTS.items():
        structured[bucket] = {}
        for key, label in endpoints.items():
            if key in flat:
                structured[bucket][key] = {
                    "value": flat[key],
                    "label": label,
                }
    return structured


def _empty_structured() -> dict[str, dict[str, dict[str, float | str | None]]]:
    """Stable shape for fallback responses — every bucket present, all empty."""
    return {bucket: {} for bucket in KEY_ENDPOINTS}


def _fallback_envelope(smiles: str, error: str) -> dict[str, Any]:
    return {
        "smiles": smiles,
        "source": "fallback",
        "ml_available": False,
        "error": error,
        "endpoints": {},
        "structured": _empty_structured(),
        "model_info": {
            "engine": "ADMET-AI (unavailable)",
            "method": "ML model failed; consumer should use heuristic source",
            "load_status": is_ready(),
        },
    }


def predict_admet_ml(smiles: str) -> dict[str, Any]:
    """Run ADMET-AI on a SMILES string.

    Returns a dict with both the full 100+ endpoint flat map and a curated
    structured view grouped by ADMET bucket. The structured view always
    contains every bucket key (possibly empty) so consumers can dereference
    without conditional shape checks.

    Graceful degradation:
      * If the model fails to load, returns a fallback envelope.
      * If inference fails at runtime, also returns a fallback envelope.
      * Only invalid SMILES (empty/whitespace) raise ValueError so the API
        layer can return a true 4xx for client error.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    try:
        model = _load_model()
    except Exception as exc:  # noqa: BLE001 - any load failure → fallback
        return _fallback_envelope(smiles, f"model_load_failed: {exc}")

    try:
        t0 = time.time()
        # Chemprop drops any batch of size 1 (dataset_size=1 < batch_size=64)
        # which causes lightning's Rich progress teardown to crash with
        # "IndexError: pop from empty list". Duplicating the SMILES ensures
        # the batch is size 2 so nothing gets dropped; we only use iloc[0].
        smiles_batch = [smiles, smiles]
        raw = model.predict(smiles=smiles_batch)
        inference_time_ms = round((time.time() - t0) * 1000, 1)
        flat = _normalize_result(raw, smiles)
    except Exception as exc:  # noqa: BLE001 - runtime inference error → fallback
        logger.exception("ADMET-AI inference failed for SMILES=%r", smiles)
        return _fallback_envelope(smiles, f"inference_failed: {exc}")

    structured = _structured_view(flat)

    return {
        "smiles": smiles,
        "source": "ml",
        "ml_available": True,
        "endpoints": flat,
        "structured": structured,
        "model_info": {
            "engine": "ADMET-AI v2 (Chemprop-RDKit GNN ensemble)",
            "method": "Pretrained on TDC ADMET benchmark (41 endpoints)",
            "endpoint_count": len(flat),
            "inference_time_ms": inference_time_ms,
            "license": "MIT",
            "reference": "https://github.com/swansonk14/admet_ai",
        },
    }
