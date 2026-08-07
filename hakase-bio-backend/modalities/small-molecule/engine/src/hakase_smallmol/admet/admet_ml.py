"""ADMET-AI ML predictor wrapper.

Wraps the open-source ADMET-AI Chemprop model (41 ADMET endpoints + 60 physchem
descriptors). Uses lazy singleton loading so the FastAPI service starts fast
and only pays the ~30s model-load cost on first prediction. Falls back
gracefully when the underlying package or weights are unavailable.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from functools import lru_cache
from importlib import import_module
from typing import Any

from hakase_kernel.runtime.privacy import scrub_smiles

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
            # Use the LOCAL vendored engine (hakase_admet, Chemprop-RDKit
            # ensemble with weights in hakase_admet/resources/models) — NOT the
            # external `admet_ai` PyPI package, which is not a declared/installed
            # dependency and made every ADMET-ML call fall through to an empty
            # envelope. hakase_admet.ADMETModel is a drop-in (same predict() API)
            # and runs fully offline, so no external API can take ADMET down.
            from hakase_smallmol.vendor.hakase_admet import (
                ADMETModel,  # type: ignore[import-not-found]
            )

            t0 = time.time()
            logger.info("Loading Hakase ADMET model (local engine, first call only)...")
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


# --------------------------------------------------------------------------- #
# Endpoint registry — derived from ADMET-AI's OWN metadata
# --------------------------------------------------------------------------- #
# This used to be a hand-typed dict of {bucket: {id: label}}. It had drifted
# from the engine it describes in two ways that reached the UI:
#   * It listed 35 of the 41 real ADMET endpoints, silently omitting the three
#     CYP *substrate* heads, Clearance_Microsome_AZ, PAMPA_NCATS and
#     HydrationFreeEnergy_FreeSolv.
#   * It declared Clearance_Hepatocyte_AZ as "mL/min/kg" when the engine's true
#     unit is "uL/min/10^6 cells" — a different dimension entirely.
# Both are the predictable failure mode of transcribing metadata by hand, so we
# now read `hakase_admet.admet_info` (the table shipped WITH the weights) as the
# single source of truth for id, bucket, units, display bounds and the model's
# published TDC benchmark performance. Add an endpoint to the engine and it
# appears here automatically.

# Endpoints served by a Hakase model INSTEAD of ADMET-AI, and why.
# ADMET-AI fits these two on the raw linear scale (VDss spans 0.01-700 L/kg,
# skew ~27; half-life 0.065-1200 h, skew ~10) and scores a NEGATIVE benchmark
# R² on both — i.e. worse than predicting the training mean, which makes the
# number unusable rather than merely imprecise. `models/vdss_ml.py` and
# `models/half_life_ml.py` fit the same TDC datasets in log10 space and reach
# R² 0.44 / 0.20 respectively, so they replace ADMET-AI here. They also carry an
# applicability domain and a calibrated conformal interval, which ADMET-AI does
# not provide for any endpoint.
_OVERRIDES: dict[str, dict[str, Any]] = {
    "VDss_Lombardo": {
        "module": "vdss_ml",
        "fn": "predict_vdss_ml",
        "value_key": "vdss_l_per_kg",
        "ci_low_key": "ci_low_l_per_kg",
        "ci_high_key": "ci_high_l_per_kg",
        "metric": ("R^2", 0.4371),
        "reason": "ADMET-AI benchmark R^2 = -1.21 (worse than the mean) on the raw L/kg scale; "
        "Hakase VDss-ML fits log10(VDss) and reaches out-of-fold R^2 = 0.44.",
    },
    "Half_Life_Obach": {
        "module": "half_life_ml",
        "fn": "predict_half_life_ml",
        "value_key": "half_life_hours",
        "ci_low_key": "ci_low_hours",
        "ci_high_key": "ci_high_hours",
        "metric": ("R^2", 0.1980),
        "reason": "ADMET-AI benchmark R^2 = -2.39 (worse than the mean) on the raw hour scale; "
        "Hakase HalfLife-ML fits log10(t1/2) and reaches out-of-fold R^2 = 0.20.",
    },
}


def _finite(x: Any) -> float | None:
    """inf/-inf/NaN → None. ADMET-AI's metadata uses ±inf for unbounded
    regression ranges, and FastAPI's strict JSON encoder rejects both, so an
    un-sanitized bound would 500 the endpoint rather than render."""
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _reliability(task: str, auroc: Any, r2: Any) -> str:
    """Reliability tier from the engine's published benchmark score.

    Mirrors `admetMeta.ts` on the frontend so the API and the UI cannot
    disagree about how trustworthy an endpoint is. A negative R² means the
    model loses to predicting the dataset mean — that is reported as
    "unreliable", not dressed up as a low score.
    """
    if task == "classification":
        a = _finite(auroc)
        if a is None:
            return "unknown"
        return "high" if a >= 0.85 else "moderate" if a >= 0.75 else "low"
    v = _finite(r2)
    if v is None:
        return "unknown"
    if v < 0:
        return "unreliable"
    return "high" if v >= 0.6 else "moderate" if v >= 0.3 else "low"


@lru_cache(maxsize=1)
def _registry() -> dict[str, dict[str, Any]]:
    """id -> display metadata, straight from the engine's admet_info table."""
    from hakase_smallmol.vendor.hakase_admet.admet_info import get_admet_info

    info = get_admet_info()
    reg: dict[str, dict[str, Any]] = {}
    for _, row in info.iterrows():
        eid = str(row["id"])
        task = str(row["task_type"])
        units = str(row["units"])
        ov = _OVERRIDES.get(eid)
        metric_name, metric_value = (
            ov["metric"]
            if ov
            else (("AUROC", row["AUROC"]) if task == "classification" else ("R^2", row["R^2"]))
        )
        reg[eid] = {
            "id": eid,
            "label": str(row["name"]),
            "bucket": str(row["category"]).lower(),
            "task_type": task,
            # Classification endpoints are probabilities; the engine writes "-".
            "units": (
                "probability" if task == "classification" else (units if units != "-" else None)
            ),
            "display_min": _finite(row["minimum"]),
            "display_max": _finite(row["maximum"]),
            "dataset_size": _finite(row["size"]),
            "reference_metric": metric_name,
            "reference_value": _finite(metric_value),
            # Typical absolute error on the benchmark — the honest "expected
            # range" for a regression readout. None for classification.
            "reference_mae": _finite(row["MAE"]) if task == "regression" else None,
            "reliability": _reliability(task, row["AUROC"], metric_value if ov else row["R^2"]),
            "species": (str(row["species"]) if str(row["species"]) not in ("-", "nan") else None),
            "reference_url": str(row["url"]) if str(row["url"]) != "nan" else None,
            "served_by": "hakase" if ov else "admet-ai",
            "override_reason": ov["reason"] if ov else None,
        }
    return reg


def _buckets() -> list[str]:
    """Stable, ordered bucket list (ADMET order, physicochemical last)."""
    order = ["absorption", "distribution", "metabolism", "excretion", "toxicity", "physicochemical"]
    present = {m["bucket"] for m in _registry().values()}
    return [b for b in order if b in present] + sorted(present - set(order))


def _apply_overrides(smiles: str) -> dict[str, dict[str, Any]]:
    """Run the Hakase models that replace an ADMET-AI endpoint.

    Never raises: if an override model is unavailable the endpoint falls back to
    ADMET-AI's own (unreliable) value rather than disappearing from the UI, and
    says which engine produced it.
    """
    out: dict[str, dict[str, Any]] = {}
    for eid, ov in _OVERRIDES.items():
        try:
            mod = import_module(f".{ov['module']}", package=__package__)
            res = getattr(mod, ov["fn"])(smiles)
            if res.get("source") != "ml":
                continue
            pred = res.get("prediction") or {}
            ci = res.get("conformal_interval") or {}
            out[eid] = {
                "value": pred.get(ov["value_key"]),
                "conformal_interval": {
                    "low": ci.get(ov["ci_low_key"]),
                    "high": ci.get(ov["ci_high_key"]),
                    "confidence_level": ci.get("confidence_level"),
                    "realised_coverage": ci.get("realised_coverage"),
                },
                "applicability_domain": res.get("applicability_domain"),
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("ADMET override %s failed (%s); using ADMET-AI value", eid, exc)
    return out


def _structured_view(
    flat: dict[str, float | str | None],
    overrides: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, dict[str, Any]]]:
    """Group EVERY engine endpoint into its bucket, with display metadata.

    Always returns every bucket key so consumers can dereference without
    conditional shape checks. Each entry carries the value plus the units,
    display bounds and published benchmark performance needed to render it
    honestly — a bare float is not renderable without them.
    """
    overrides = overrides or {}
    structured: dict[str, dict[str, dict[str, Any]]] = {b: {} for b in _buckets()}
    for eid, meta in _registry().items():
        ov = overrides.get(eid)
        if eid not in flat and ov is None:
            continue
        entry: dict[str, Any] = {k: v for k, v in meta.items() if k != "bucket"}
        if ov is not None:
            entry["value"] = ov["value"]
            entry["conformal_interval"] = ov["conformal_interval"]
            entry["applicability_domain"] = ov["applicability_domain"]
        else:
            entry["value"] = flat.get(eid)
            # Only the Hakase-served endpoints carry an AD / interval; saying so
            # explicitly stops a null being read as "no uncertainty".
            if meta["served_by"] == "hakase":
                entry["served_by"] = "admet-ai"
                entry["override_reason"] = None
        structured[meta["bucket"]][eid] = entry
    return structured


def _empty_structured() -> dict[str, dict[str, dict[str, Any]]]:
    """Stable shape for fallback responses — every bucket present, all empty."""
    try:
        return {bucket: {} for bucket in _buckets()}
    except Exception:  # noqa: BLE001 - engine metadata unreadable
        return {
            b: {}
            for b in (
                "absorption",
                "distribution",
                "metabolism",
                "excretion",
                "toxicity",
                "physicochemical",
            )
        }


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
    # produce identical predictions.
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
        logger.exception("ADMET-AI inference failed for %s", scrub_smiles(smiles))
        return _fallback_envelope(smiles, f"inference_failed: {exc}")

    overrides = _apply_overrides(smiles)
    # Patch the FLAT map too, not just the structured view. `endpoints` is what
    # every downstream consumer reads — `invitro_panel.build_panel` (and through
    # it the wet-lab readout panel and the L1 verdict) does `flat = admet
    # ["endpoints"]`. Overriding only the structured view would leave the two
    # disagreeing about the same endpoint, and the simulation would still be
    # driven by the ADMET-AI value this override exists to replace.
    for _eid, _ov in overrides.items():
        if _ov.get("value") is not None:
            flat[_eid] = _ov["value"]

    structured = _structured_view(flat, overrides)

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
    """Run ADMET-AI over a library of SMILES in a single model call.

    Accepts a list of SMILES, validates/canonicalises them, runs batch prediction
    in a single call, and returns structured result rows.
    """
    if not isinstance(smiles_list, list) or len(smiles_list) == 0:
        raise ValueError("smiles_list (non-empty) is required")

    try:
        from rdkit import Chem as _Chem
    except Exception:
        _Chem = None  # type: ignore

    # Validate + canonicalise, preserving original order and de-duplicating.
    cleaned: list[str] = []
    valid: list[str] = []  # canonical SMILES sent to the model
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
        return {
            "results": [{"smiles": s, "found": False, "error": "invalid SMILES"} for s in invalid],
            "count": 0,
            "ml_available": False,
            "model_info": {},
        }

    try:
        model = _load_model()
    except Exception as exc:  # noqa: BLE001
        return {
            "results": [
                _fallback_envelope(s, f"model_load_failed: {exc}") | {"found": False} for s in valid
            ],
            "count": 0,
            "ml_available": False,
            "model_info": {},
        }

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
            results.append(
                {
                    "smiles": canon,
                    "found": True,
                    "ml_available": True,
                    "structured": _structured_view(flat),
                }
            )
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
