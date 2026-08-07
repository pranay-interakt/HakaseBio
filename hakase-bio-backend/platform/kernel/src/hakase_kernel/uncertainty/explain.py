"""SHAP explainability for the tree-based Layer-1 ML models.

The platform surfaces ML predictions (CardioTox hERG, DILI, aqueous solubility)
but previously exposed **no per-prediction explanation** — a reviewer could see
"DILI probability 0.72" with no basis. This module adds genuine, model-faithful
attributions using **SHAP** (Lundberg & Lee, NeurIPS 2017) `TreeExplainer`,
which computes exact Shapley values for tree ensembles (RandomForest / GBM).

Design principles (consistent with the rest of the service):
  * REAL or nothing. If the `shap` package is not installed we return
    `{available: false, reason: ...}` — we never synthesise importances from
    `feature_importances_` and label them as per-prediction attributions
    (global impurity importance is not a Shapley value and would be misleading).
  * Model-faithful. Attributions come from the *same fitted model* and the
    *same featurizer* that produced the prediction, by reusing each model
    module's `_featurize` and `_load_model`. No parallel re-implementation.
  * Human-readable. The 6 RDKit descriptors are named; Morgan bits are labelled
    by index and reported only when the bit is ON for this molecule (an OFF bit
    with a non-zero Shapley value is still reported but flagged), so a chemist
    sees which structural features pushed the score up or down.

Feature layout for the supported models is [Morgan(1024) || descriptors(k)].
"""

from __future__ import annotations

import importlib
import logging
from collections.abc import Callable
from typing import Any

import numpy as np
from hakase_kernel.runtime.privacy import scrub_smiles

logger = logging.getLogger(__name__)

MODULE_VERSION = "1.0.0"


def _shap_available() -> bool:
    try:
        import shap  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


# --------------------------------------------------------------------------- #
# Model registry — modalities register their explainable models here.
#
# The SHAP machinery below is modality-agnostic: it works against any module
# exposing `_load_model()`, `_featurize()` and `is_ready()`. Which models exist
# is modality knowledge, and `platform/` may not import `modalities/`, so the
# kernel holds only what it has been handed. Modules are registered by dotted
# path and imported on use, keeping the heavy ML imports lazy — a model that
# fails to import is skipped rather than breaking the whole service.
# --------------------------------------------------------------------------- #

_REGISTRY: dict[str, dict[str, Any]] = {}


def register_model(
    key: str,
    module: str,
    *,
    label: str,
    kind: str,
    positive_class: int | None = None,
    descriptors: list[str] | None = None,
    morgan_nbits: int = 1024,
) -> None:
    """Register one explainable model.

    `module` is a dotted path, imported lazily. `descriptors` names the feature
    block that follows the Morgan bits; when omitted the module's own
    DESCRIPTOR_NAMES is used, which keeps the labels in step with its featurizer
    instead of duplicating the list here.
    """
    _REGISTRY[key] = {
        "module": module,
        "descriptors": descriptors,
        "morgan_nbits": morgan_nbits,
        "kind": kind,
        "positive_class": positive_class,
        "label": label,
    }


def _registry() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for key, cfg in _REGISTRY.items():
        try:
            mod = importlib.import_module(cfg["module"])
        except Exception:  # noqa: BLE001
            logger.warning("explain: model %r not importable (%s)", key, cfg["module"])
            continue
        descriptors = cfg["descriptors"]
        if descriptors is None:
            descriptors = getattr(mod, "DESCRIPTOR_NAMES", [])
        out[key] = {
            **cfg,
            "module": mod,
            "descriptors": list(descriptors),
            "morgan_nbits": getattr(mod, "MORGAN_NBITS", cfg["morgan_nbits"]),
        }
    return out


def available_models() -> list[str]:
    try:
        return list(_registry().keys())
    except Exception:  # noqa: BLE001
        return []


def feature_label(index: int, morgan_nbits: int, descriptors: list[str]) -> str:
    """Map a feature index to a human-readable label."""
    if index < morgan_nbits:
        return f"Morgan bit #{index}"
    di = index - morgan_nbits
    if 0 <= di < len(descriptors):
        return descriptors[di]
    return f"feature #{index}"


def _shap_values_for_row(
    explainer: Any, row: np.ndarray, positive_class: int | None, classes: list | None
) -> np.ndarray:
    """Normalise the several shapes shap.TreeExplainer can return into a 1-D
    per-feature vector for the class/target of interest."""
    sv = explainer.shap_values(row)
    # Classifier: list [n_classes] of (1, n_features); or array (1, n_features,
    # n_classes) in newer shap. Regressor: (1, n_features).
    if isinstance(sv, list):
        if positive_class is not None and classes is not None and positive_class in classes:
            arr = np.asarray(sv[classes.index(positive_class)])
        else:
            arr = np.asarray(sv[-1])
    else:
        arr = np.asarray(sv)
        if arr.ndim == 3:  # (1, n_features, n_classes)
            idx = (
                classes.index(positive_class)
                if (positive_class is not None and classes and positive_class in classes)
                else -1
            )
            arr = arr[..., idx]
    return arr.reshape(-1)


def top_contributions(
    shap_row: np.ndarray,
    feature_row: np.ndarray,
    morgan_nbits: int,
    descriptors: list[str],
    top_k: int,
) -> list[dict[str, Any]]:
    """Rank features by |Shapley value| and format the top_k."""
    order = np.argsort(-np.abs(shap_row))
    out: list[dict[str, Any]] = []
    for i in order[:top_k]:
        i = int(i)
        val = float(shap_row[i])
        feat_on = bool(feature_row[i] != 0)
        out.append(
            {
                "feature": feature_label(i, morgan_nbits, descriptors),
                "feature_index": i,
                "shap_value": round(val, 5),
                "direction": "increases" if val > 0 else "decreases",
                "feature_value": round(float(feature_row[i]), 4),
                "morgan_bit_on": feat_on if i < morgan_nbits else None,
            }
        )
    return out


def explain(
    model_key: str, smiles: str, top_k: int = 12, shap_available: Callable[[], bool] | None = None
) -> dict[str, Any]:
    """Return SHAP attributions for one model's prediction on one SMILES.

    On any unavailability (no shap, model won't load, SMILES unparseable) returns
    an explicit `available: false` envelope with a reason — never fabricated
    attributions.
    """
    has_shap = (shap_available or _shap_available)()
    base_prov = {
        "module": "explain",
        "module_version": MODULE_VERSION,
        "method": "SHAP TreeExplainer (Lundberg & Lee 2017)",
    }

    if not smiles or not smiles.strip():
        return {"available": False, "reason": "smiles is required", "provenance": base_prov}
    if not has_shap:
        return {
            "available": False,
            "reason": "shap package not installed — run `pip install shap`. "
            "No attributions fabricated.",
            "provenance": base_prov,
        }

    reg = _registry()
    if model_key not in reg:
        return {
            "available": False,
            "reason": f"unknown model '{model_key}'. Available: {list(reg)}",
            "provenance": base_prov,
        }

    cfg = reg[model_key]
    mod = cfg["module"]
    try:
        bundle = mod._load_model()
        clf = bundle["model"]
    except Exception as e:  # noqa: BLE001
        return {
            "available": False,
            "reason": f"model '{model_key}' failed to load: {e}",
            "provenance": base_prov,
        }

    feats = mod._featurize(smiles)
    if feats is None:
        return {
            "available": False,
            "reason": "rdkit could not parse/featurize SMILES",
            "provenance": base_prov,
        }

    try:
        import shap

        row = np.asarray(feats, dtype=float).reshape(1, -1)
        explainer = shap.TreeExplainer(clf)
        classes = list(getattr(clf, "classes_", [])) or None
        shap_row = _shap_values_for_row(explainer, row, cfg.get("positive_class"), classes)
        contribs = top_contributions(
            shap_row, row.reshape(-1), cfg["morgan_nbits"], cfg["descriptors"], top_k
        )
        expected = explainer.expected_value
        if isinstance(expected, (list, np.ndarray)):
            expected = float(np.asarray(expected).reshape(-1)[-1])
        return {
            "available": True,
            "model": model_key,
            "target": cfg["label"],
            "base_value": round(float(expected), 5),
            "top_contributions": contribs,
            "n_features": int(row.shape[1]),
            "provenance": {**base_prov, "model_engine": mod.is_ready().get("engine")},
        }
    except Exception as e:  # noqa: BLE001
        logger.exception("SHAP explain failed for %s / %s", model_key, scrub_smiles(smiles))
        return {
            "available": False,
            "reason": f"shap computation failed: {e}",
            "provenance": base_prov,
        }
