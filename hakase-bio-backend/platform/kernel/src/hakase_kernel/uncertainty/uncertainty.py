"""Model-native uncertainty quantification + calibration.

Per-prediction uncertainty for the Layer-1 models WITHOUT any local dataset,
reference file, or cache — everything is computed live from the already-loaded
model at inference time. Two real, well-founded signals:

  * Ensemble disagreement — for bagging ensembles (RandomForest) the spread of
    the individual estimators' predictions is a direct estimate of epistemic
    uncertainty. Computed live from `model.estimators_` on the query's own
    features. No labels, no data files.

  * Probability calibration — a temperature/Platt transform APPLIED at inference
    from parameters that live inside the trained model bundle (fit at train time
    from the model's own cross-validation, never from a runtime lookup). If a
    model carries no calibration parameters we pass the probability through and
    label it "uncalibrated" — we never invent a calibration.

Honesty: a *formal* conformal coverage guarantee needs a held-out calibration
set. What we provide here are principled ensemble prediction intervals and
calibrated probabilities — we label them as such and do not overclaim a
coverage guarantee we cannot back without that set.

Pure functions are unit-tested offline with numpy; the sklearn extraction path
runs where the models are served.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

MODULE_VERSION = "1.0.0"

# z-multipliers for symmetric normal intervals.
Z = {80: 1.2816, 90: 1.6449, 95: 1.9600}


# --------------------------------------------------------------------------- #
# Pure ensemble statistics
# --------------------------------------------------------------------------- #


def ensemble_mean_std(members: np.ndarray) -> tuple[float, float]:
    """Mean and (population) std of an ensemble's per-member predictions."""
    arr = np.asarray(members, dtype=float).ravel()
    if arr.size == 0:
        return float("nan"), float("nan")
    return float(arr.mean()), float(arr.std())


def prediction_interval(mean: float, std: float, coverage: int = 90) -> tuple[float, float]:
    """Symmetric ensemble prediction interval at the given nominal coverage."""
    z = Z.get(coverage, 1.6449)
    return (mean - z * std, mean + z * std)


def classifier_confidence(std_prob: float) -> float:
    """Confidence [0,1] from ensemble std of a class probability.

    Trees rarely disagree by more than ~0.35 in practice; map std 0→1.0 (full
    agreement, high confidence) and std>=0.35→~0 (maximal disagreement).
    """
    if not math.isfinite(std_prob):
        return 0.5
    return max(0.0, min(1.0, 1.0 - std_prob / 0.35))


def regressor_confidence(mean: float, std: float) -> float:
    """Confidence [0,1] from the relative ensemble spread of a regression value.

    Uses the interval half-width relative to the magnitude of the estimate:
    tight spread → high confidence. Scale-free, no per-endpoint constants.
    """
    if not (math.isfinite(mean) and math.isfinite(std)):
        return 0.5
    denom = abs(mean) + 1e-6
    rel = std / denom
    return max(0.0, min(1.0, 1.0 - rel / 0.5))  # rel>=50% of value → ~0


def reliability_band(confidence: float) -> str:
    if confidence >= 0.66:
        return "High"
    if confidence >= 0.33:
        return "Medium"
    return "Low"


# --------------------------------------------------------------------------- #
# Probability calibration (applied from model-bundle params; never invented)
# --------------------------------------------------------------------------- #


def _sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def _logit(p: float, eps: float = 1e-6) -> float:
    p = min(1.0 - eps, max(eps, p))
    return math.log(p / (1.0 - p))


def temperature_scale(prob: float, temperature: float) -> float:
    """Calibrate a probability by temperature scaling: sigmoid(logit(p)/T).

    T==1 → identity. T>1 softens overconfident probabilities toward 0.5.
    """
    if temperature is None or not math.isfinite(temperature) or temperature <= 0:
        return prob
    return _sigmoid(_logit(prob) / temperature)


def apply_calibration(prob: float | None, calibration: dict[str, Any] | None) -> dict[str, Any]:
    """Return {value, calibrated} for a probability given optional bundle params.

    `calibration` is expected to have come from the model bundle (fit at train
    time). Supported forms: {"type": "temperature", "T": float} or
    {"type": "platt", "a": float, "b": float}. Anything else → passthrough,
    flagged uncalibrated. Never fabricates parameters.
    """
    if prob is None:
        return {"value": None, "calibrated": False, "method": None}
    if not calibration:
        return {"value": round(prob, 4), "calibrated": False, "method": None}
    ctype = calibration.get("type")
    if ctype == "temperature":
        return {
            "value": round(temperature_scale(prob, calibration.get("T", 1.0)), 4),
            "calibrated": True,
            "method": "temperature",
        }
    if ctype == "platt":
        a = calibration.get("a")
        b = calibration.get("b")
        if a is not None and b is not None:
            return {
                "value": round(_sigmoid(a * _logit(prob) + b), 4),
                "calibrated": True,
                "method": "platt",
            }
    return {"value": round(prob, 4), "calibrated": False, "method": None}


def fit_temperature(probs: np.ndarray, labels: np.ndarray) -> float:
    """Fit a single temperature to minimise NLL — a train-time helper.

    Provided so calibration params can be fit from a model's OWN CV out-of-fold
    predictions (part of building the model), then stored in its bundle. Not
    used at inference. Pure numpy grid+refine, no scipy.
    """
    probs = np.clip(np.asarray(probs, dtype=float).ravel(), 1e-6, 1 - 1e-6)
    labels = np.asarray(labels, dtype=float).ravel()
    logits = np.log(probs / (1.0 - probs))

    def nll(T: float) -> float:
        if T <= 0:
            return float("inf")
        p = 1.0 / (1.0 + np.exp(-logits / T))
        p = np.clip(p, 1e-9, 1 - 1e-9)
        return float(-np.mean(labels * np.log(p) + (1 - labels) * np.log(1 - p)))

    grid = np.linspace(0.25, 5.0, 96)
    best = min(grid, key=nll)
    # local refine
    fine = np.linspace(max(0.05, best - 0.1), best + 0.1, 41)
    best = min(fine, key=nll)
    return float(best)


# --------------------------------------------------------------------------- #
# sklearn ensemble extraction (runs where models are served; not tested here)
# --------------------------------------------------------------------------- #


def rf_classifier_member_probs(
    model: Any, X: np.ndarray, positive_class: int = 1
) -> np.ndarray | None:
    """Per-estimator P(positive_class) for a fitted RandomForestClassifier.

    Returns a 1-D array (one prob per tree) or None if the model is not a
    bagging ensemble exposing `estimators_`.
    """
    estimators = getattr(model, "estimators_", None)
    if not estimators:
        return None
    classes = list(getattr(model, "classes_", [0, 1]))
    idx = classes.index(positive_class) if positive_class in classes else -1
    out = []
    for est in estimators:
        try:
            p = est.predict_proba(X)[0]
            out.append(float(p[idx]))
        except Exception:  # noqa: BLE001
            continue
    return np.asarray(out, dtype=float) if out else None


def rf_regressor_member_preds(model: Any, X: np.ndarray) -> np.ndarray | None:
    """Per-estimator predictions for a fitted RandomForestRegressor."""
    estimators = getattr(model, "estimators_", None)
    if not estimators:
        return None
    out = []
    for est in estimators:
        try:
            out.append(float(est.predict(X)[0]))
        except Exception:  # noqa: BLE001
            continue
    return np.asarray(out, dtype=float) if out else None
