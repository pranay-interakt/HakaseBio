"""ADMET-AI ML predictor wrapper.

Wraps the open-source ADMET-AI Chemprop model (41 ADMET endpoints + 60 physchem
descriptors). Uses lazy singleton loading so the FastAPI service starts fast
and only pays the ~30s model-load cost on first prediction.

Operating modes
───────────────
By default the wrapper degrades gracefully — if ADMET-AI isn't installed, the
loader raises and `predict_admet_ml` returns a `_fallback_envelope`. Upstream
consumers must check `ml_available` and re-route to the heuristic path.

When environment variable `STRICT_ML=1`, the wrapper REFUSES to fall back:
- `warmup()` raises if the model can't load
- `predict_admet_ml()` raises if the model can't run

Strict mode is the production default — the L1 scorecard's recalibrated
thresholds (`thresholds.json`) are tuned to the ML output distribution, so
silently substituting heuristics produces miscalibrated verdicts. Strict mode
makes "no ML" a startup-time configuration error, not a runtime soft failure
that the user only notices because every drug is suddenly NO-GO.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

# Set STRICT_ML=1 to refuse to start when ADMET-AI isn't available.
STRICT_ML = os.environ.get("STRICT_ML", "0") == "1"

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
            try:
                import lightning.pytorch as pl
                original_init = pl.Trainer.__init__
                def patched_init(self, *args, **kwargs):
                    kwargs["enable_progress_bar"] = False
                    original_init(self, *args, **kwargs)
                pl.Trainer.__init__ = patched_init
            except Exception as patch_err:
                logger.warning("Could not patch lightning.pytorch.Trainer: %s", patch_err)

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
    """Force model load (used by /models/warmup endpoint).

    In STRICT_ML mode, re-raises on failure so the FastAPI startup hook can
    crash the process rather than serve mis-calibrated heuristic predictions
    under an "ML-Enhanced" badge.
    """
    try:
        _load_model()
        return {"status": "ready", **is_ready()}
    except Exception as exc:  # noqa: BLE001
        if STRICT_ML:
            logger.critical(
                "STRICT_ML=1 and ADMET-AI failed to load: %s. "
                "Refusing to serve to avoid silent heuristic fallback under an "
                "'ML-Enhanced' badge. Pin admet_ai>=1.4 in requirements.txt or "
                "unset STRICT_ML to allow degraded mode.", exc,
            )
            raise
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
        "Caco2_Wang": "Caco-2 permeability (log 10^-6 cm/s)",
        "HIA_Hou": "Human intestinal absorption (probability)",
        "Pgp_Broccatelli": "P-glycoprotein inhibition (probability)",
        "Bioavailability_Ma": "Oral bioavailability (probability)",
        "Lipophilicity_AstraZeneca": "Lipophilicity (logD7.4)",
        "Solubility_AqSolDB": "Aqueous solubility (log mol/L)",
    },
    "distribution": {
        "BBB_Martins": "Blood-brain barrier penetration (probability)",
        "PPBR_AZ": "Plasma protein binding (%)",
        "VDss_Lombardo": "Volume of distribution (L/kg) [low model reliability]",
    },
    "metabolism": {
        "CYP1A2_Veith": "CYP1A2 inhibition (probability)",
        "CYP2C9_Veith": "CYP2C9 inhibition (probability)",
        "CYP2C19_Veith": "CYP2C19 inhibition (probability)",
        "CYP2D6_Veith": "CYP2D6 inhibition (probability)",
        "CYP3A4_Veith": "CYP3A4 inhibition (probability)",
    },
    "excretion": {
        "Clearance_Hepatocyte_AZ": "Hepatocyte clearance (uL/min/10^6 cells)",
        "Half_Life_Obach": "Half-life (hours) [low model reliability]",
    },
    "toxicity": {
        "hERG": "hERG channel blockade (probability)",
        "AMES": "Ames mutagenicity (probability)",
        "DILI": "Drug-induced liver injury (probability)",
        "LD50_Zhu": "Acute toxicity LD50 (log 1/(mol/kg))",
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

    # Canonicalize SMILES so any two representations of the same molecule
    # produce identical predictions (Chemprop is graph-invariant but
    # canonicalization removes any remaining string-level sensitivity).
    try:
        from rdkit import Chem as _Chem
        _mol = _Chem.MolFromSmiles(smiles.strip())
        if _mol is not None:
            smiles = _Chem.MolToSmiles(_mol, canonical=True)
    except Exception:
        pass  # If RDKit unavailable, proceed with raw SMILES

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


def predict_admet_ml_batch(smiles_list: list[str], limit: int = 500) -> dict[str, Any]:
    """Run ADMET-AI over a LIBRARY of SMILES in a single model call.

    ADMET-AI's `model.predict()` natively accepts a list and returns one
    DataFrame row per molecule, so we run inference ONCE for the whole batch
    (the single-molecule path's [s, s] duplication hack is unnecessary and
    wasteful at scale). Each SMILES is RDKit-validated/canonicalised first;
    invalid ones are returned flagged rather than silently dropped.

    Returns:
      {
        "results": [ { "smiles", "found": true, "structured", ... }
                     | { "smiles", "found": false, "error": "invalid SMILES" } ],
        "count": <valid count>, "ml_available": bool, "model_info": {...},
      }
    """
    if not isinstance(smiles_list, list) or len(smiles_list) == 0:
        raise ValueError("smiles_list (non-empty) is required")

    try:
        from rdkit import Chem as _Chem
    except Exception:
        _Chem = None  # type: ignore

    # Validate + canonicalise, preserving original order and de-duplicating.
    cleaned: list[str] = []
    valid: list[str] = []          # canonical SMILES sent to the model
    invalid: list[str] = []
    seen: set[str] = set()
    for raw_smi in smiles_list[: max(1, limit)]:
        s = (raw_smi or "").strip()
        if not s:
            invalid.append(raw_smi)
            continue
        canon = s
        if _Chem is not None:
            mol = _Chem.MolFromSmiles(s)
            if mol is None:
                invalid.append(s)
                continue
            canon = _Chem.MolToSmiles(mol, canonical=True)
        if canon in seen:
            continue
        seen.add(canon)
        cleaned.append(s)
        valid.append(canon)

    if not valid:
        return {"results": [{"smiles": s, "found": False, "error": "invalid SMILES"} for s in invalid],
                "count": 0, "ml_available": False, "model_info": {}}

    try:
        model = _load_model()
    except Exception as exc:  # noqa: BLE001
        return {"results": [_fallback_envelope(s, f"model_load_failed: {exc}") | {"found": False} for s in valid],
                "count": 0, "ml_available": False, "model_info": {}}

    # Pad a size-1 batch to avoid the Chemprop dataset_size<batch_size teardown.
    query = valid if len(valid) >= 2 else (valid + valid)
    t0 = time.time()
    raw = model.predict(smiles=query)
    inference_time_ms = round((time.time() - t0) * 1000, 1)

    results: list[dict[str, Any]] = []
    for i, canon in enumerate(valid):
        try:
            row = raw.iloc[[i]] if hasattr(raw, "iloc") else raw
            flat = _normalize_result(row, canon)
            results.append({
                "smiles": canon,
                "found": True,
                "ml_available": True,
                "structured": _structured_view(flat),
            })
        except Exception as exc:  # noqa: BLE001
            results.append({"smiles": canon, "found": False, "error": f"normalize_failed: {exc}"})
    for s in invalid:
        results.append({"smiles": s, "found": False, "error": "invalid SMILES"})

    return {
        "results": results,
        "count": len(valid),
        "ml_available": True,
        "model_info": {
            "engine": "ADMET-AI v2 (Chemprop-RDKit GNN ensemble)",
            "inference_time_ms": inference_time_ms,
            "batch_size": len(valid),
        },
    }
