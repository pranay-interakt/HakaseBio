"""Embedding-based Functional Predictors (Functional Analysis Service Spec §5.3, §6.4).

Small PyTorch classifiers over pooled sequence embeddings from
``platform/sequence/esm`` (deterministic descriptor surrogate by default, real
ESM2-650M when NVIDIA_API_KEY is configured -- see that package's docstring).
Same curated, cited datasets as ``esm_ml.py``/``functional_ml.py``; different
representation (learned/embedding-derived features instead of hand-engineered
biochemistry), which is the point of running both predictor families and
comparing them in the Consistency Validator (M6).

Endpoint coverage is honest: only endpoints with curated data are trained.
``receptor_binding_propensity_embedding`` and
``enzyme_inhibition_propensity_embedding`` report ``unavailable`` rather than
a fabricated score (§12), same as functional_ml.py.

NOTE ON TRAINING COST: if the active embedding provider is the real NVIDIA
ESM2 PLM (not the default local descriptor surrogate), warmup makes one
network call per curated training sequence (~100-150 calls, one-time, cached
to disk afterward). With the default descriptor provider, everything is local
and fast.
"""

from __future__ import annotations

import logging
import os
import pickle
import threading
from typing import Any

import numpy as np
import torch
import torch.nn as nn
from hakase_kernel.runtime.paths import cache_dir
from hakase_sequence.esm import resolve_embedding_provider

from .esm_ml import _AMP_NEG, _AMP_POS, _CPP_NEG, _CPP_POS, _clean

logger = logging.getLogger(__name__)

CACHE_DIR = str(cache_dir())
MODEL_PATH = os.path.join(CACHE_DIR, "functional_embedding_ml_v1.pkl")
MODEL_VERSION = "1.0.0"
_EPOCHS = 300
_LR = 1e-3
_SEED = 42

_DATASETS: dict[str, tuple[list[str], list[str]]] = {
    "antimicrobial_activity_embedding": (_AMP_POS, _AMP_NEG),
    "cell_penetration_activity_embedding": (_CPP_POS, _CPP_NEG),
}
SUPPORTED_ENDPOINTS: tuple[str, ...] = tuple(_DATASETS.keys())
UNSUPPORTED_ENDPOINTS: tuple[str, ...] = (
    "receptor_binding_propensity_embedding",
    "enzyme_inhibition_propensity_embedding",
)
_AD_ZSCORE_THRESHOLD = 3.0  # §10.2: flag out-of-applicability-domain inputs

_MODELS: dict[str, Any] | None = None
_LOAD_LOCK = threading.Lock()


class _TinyMLP(nn.Module):
    """A deliberately small classifier head: with ~100-150 training examples
    per endpoint, a deep network would overfit; this is a 2-hidden-layer MLP."""

    def __init__(self, in_dim: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


def _embed_all(sequences: list[str], provider: Any) -> np.ndarray:
    vectors = [provider.embed(_clean(s)).mean_vector for s in sequences]
    return np.asarray(vectors, dtype=np.float32)


def _train_one(name: str, pos: list[str], neg: list[str], provider: Any) -> dict[str, Any]:
    torch.manual_seed(_SEED)
    X = np.concatenate([_embed_all(pos, provider), _embed_all(neg, provider)], axis=0)
    y = np.concatenate([np.ones(len(pos)), np.zeros(len(neg))]).astype(np.float32)

    mean = X.mean(axis=0, keepdims=True)
    std = X.std(axis=0, keepdims=True) + 1e-6
    Xn = (X - mean) / std

    X_t = torch.tensor(Xn, dtype=torch.float32)
    y_t = torch.tensor(y, dtype=torch.float32)

    model = _TinyMLP(in_dim=X.shape[1])
    opt = torch.optim.Adam(model.parameters(), lr=_LR, weight_decay=1e-4)
    loss_fn = nn.BCEWithLogitsLoss()

    model.train()
    for _epoch in range(_EPOCHS):
        opt.zero_grad()
        logits = model(X_t)
        loss = loss_fn(logits, y_t)
        loss.backward()
        opt.step()

    model.eval()
    with torch.no_grad():
        final_logits = model(X_t)
        final_probs = torch.sigmoid(final_logits).numpy()
        train_auc = _roc_auc(y, final_probs)

    logger.info(
        "functional_embedding_ml: %s trained — n=%d, train_auc=%.3f", name, len(y), train_auc
    )
    return {
        "state_dict": model.state_dict(),
        "in_dim": X.shape[1],
        "mean": mean,
        "std": std,
        "train_auc": train_auc,
        "n_pos": len(pos),
        "n_neg": len(neg),
        "embedding_model_id": getattr(provider, "model_id", "unknown"),
        "embedding_model_version": getattr(provider, "model_version", "unknown"),
        "embedding_provider": getattr(provider, "name", "unknown"),
        "is_plm": bool(getattr(provider, "is_plm", False)),
    }


def _roc_auc(y_true: np.ndarray, scores: np.ndarray) -> float:
    """Minimal dependency-free ROC-AUC (Mann-Whitney U form) -- avoids pulling
    in sklearn just for this metric report."""
    pos = scores[y_true == 1]
    neg = scores[y_true == 0]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return float(wins / (len(pos) * len(neg)))


def _train_all() -> dict[str, Any]:
    provider = resolve_embedding_provider()
    results: dict[str, Any] = {
        "version": MODEL_VERSION,
        "provider_name": getattr(provider, "name", "unknown"),
        "provider_model_id": getattr(provider, "model_id", "unknown"),
    }
    for name, (pos, neg) in _DATASETS.items():
        results[name] = _train_one(name, pos, neg, provider)
    return results


def _load_models() -> dict[str, Any]:
    global _MODELS
    if _MODELS is not None:
        return _MODELS
    with _LOAD_LOCK:
        if _MODELS is not None:
            return _MODELS
        current_provider_name = getattr(resolve_embedding_provider(), "name", "unknown")
        if os.path.exists(MODEL_PATH):
            with open(MODEL_PATH, "rb") as f:
                cached = pickle.load(f)
            if (
                cached.get("version") == MODEL_VERSION
                and cached.get("provider_name") == current_provider_name
            ):
                _MODELS = cached
                return _MODELS
            logger.info(
                "functional_embedding_ml: cache stale (version or embedding provider changed) — retraining"
            )
        _MODELS = _train_all()
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(MODEL_PATH, "wb") as f:
            pickle.dump(_MODELS, f)
        return _MODELS


def is_ready() -> bool:
    return _MODELS is not None


def warmup() -> None:
    try:
        _load_models()
    except Exception:
        logger.exception(
            "functional_embedding_ml: warmup failed (non-fatal, will retry on request)"
        )


def _tier_for(auc: float) -> str:
    if auc != auc:  # NaN
        return "unavailable"
    if auc >= 0.85:
        return "high"
    if auc >= 0.65:
        return "moderate"
    return "low"


def predict_functional_embedding(
    sequence: str, *, endpoints: list[str]
) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    seq = _clean(sequence)
    if len(seq) < 3:
        for ep in endpoints:
            out[ep] = {"status": "unavailable", "value": None, "reason_code": "sequence_too_short"}
        return out

    supported = [ep for ep in endpoints if ep in SUPPORTED_ENDPOINTS]
    if supported:
        try:
            models = _load_models()
            provider = resolve_embedding_provider()
            vec = np.asarray(provider.embed(seq).mean_vector, dtype=np.float32)[None, :]
        except Exception as exc:  # noqa: BLE001
            for ep in supported:
                out[ep] = {
                    "status": "unavailable",
                    "value": None,
                    "reason_code": f"embedding_failed:{exc}",
                }
            supported = []

        for ep in supported:
            m = models[ep]
            if vec.shape[1] != m["in_dim"]:
                out[ep] = {
                    "status": "unavailable",
                    "value": None,
                    "reason_code": "embedding_dim_mismatch",
                    "message": (
                        f"Active embedding provider dim ({vec.shape[1]}) does not "
                        f"match the trained model's dim ({m['in_dim']}); the cache "
                        "is stale for the current provider config -- clear "
                        f"{MODEL_PATH} and warm up again."
                    ),
                }
                continue
            xn = (vec - m["mean"]) / m["std"]
            # §10.2 applicability domain: xn is already in z-score units
            # relative to the training distribution (that's what mean/std
            # normalization computes) -- reuse it directly rather than a
            # second pass.
            max_z = float(np.max(np.abs(xn)))
            ad = {
                "status": "in_domain" if max_z <= _AD_ZSCORE_THRESHOLD else "out_of_domain",
                "max_feature_zscore": round(max_z, 2),
                "threshold": _AD_ZSCORE_THRESHOLD,
            }
            model = _TinyMLP(in_dim=m["in_dim"])
            model.load_state_dict(m["state_dict"])
            model.eval()
            with torch.no_grad():
                prob = float(torch.sigmoid(model(torch.tensor(xn, dtype=torch.float32)))[0])
            tier = _tier_for(m["train_auc"])
            if ad["status"] == "out_of_domain":
                # §10.2: forced down regardless of raw output score.
                tier = "low"
            out[ep] = {
                "status": "complete",
                "value": round(prob, 4),
                "confidence": {"tier": tier, "score": round(prob, 4)},
                "applicability_domain": ad,
                "model_identifier": f"functional_embedding_ml.mlp.{ep}",
                "model_version": MODEL_VERSION,
                "training_auc": (
                    None if m["train_auc"] != m["train_auc"] else round(m["train_auc"], 3)
                ),
                "n_training_positive": m["n_pos"],
                "n_training_negative": m["n_neg"],
                "embedding_provider": m["embedding_provider"],
                "embedding_model_id": m["embedding_model_id"],
                "embedding_is_plm": m["is_plm"],
            }

    for ep in endpoints:
        if ep not in SUPPORTED_ENDPOINTS:
            out[ep] = {
                "status": "unavailable",
                "value": None,
                "reason_code": "no_training_data",
                "message": (
                    f"No curated training dataset exists for '{ep}' yet; see "
                    "properties/functional_embedding_ml.py's UNSUPPORTED_ENDPOINTS."
                ),
            }
    return out
