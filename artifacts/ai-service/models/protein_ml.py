"""ESM-2 protein druggability — ML second opinion to the rule-based score.

Independent second-opinion model that augments `protein.py`'s heuristic
druggability score (binding-site count + active-site count + sequence length).
Methodologically distinct in three ways:

  1. Different feature representation: 480-dim mean-pooled per-residue
     embedding from ESM-2 t12 35M (`facebook/esm2_t12_35M_UR50D`) — a
     self-supervised protein language model trained on UniRef50. This captures
     learned biophysical / evolutionary signal across the full sequence,
     not just per-residue annotations.
  2. Different training data: a small curated set of ~80 well-known human
     drug targets (multiple FDA-approved small molecules each) vs ~80
     essential housekeeping proteins with no approved small-molecule drug.
     See `protein_ml_data.py` for the full list and curator notes.
  3. Different algorithm class: logistic regression on top of the frozen
     ESM-2 embedding — distinct from the deterministic heuristic in
     `protein.py::_assess_druggability`.

On first call, fetches sequences for the curated training set, computes
ESM-2 mean-pooled embeddings, trains the logistic-regression head with
5-fold cross-validation, and pickles the result. Embeddings are cached so
retraining is sub-second; the (large) ESM-2 weights are cached by
HuggingFace under `~/.cache/huggingface`. End-to-end first-call cost on CPU
is dominated by the 161 training-set forward passes (~5-15 min).
"""
from __future__ import annotations

import json
import logging
import os
import pickle
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import requests

from .protein_ml_data import get_training_set

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Module-level state (singleton)
# --------------------------------------------------------------------------- #

_HEAD: Any = None  # the trained logistic-regression bundle
_HEAD_LOCK = threading.Lock()
_HEAD_LOAD_ERROR: Optional[str] = None
_HEAD_LOAD_TIME_S: Optional[float] = None
_HEAD_TRAIN_METRICS: Dict[str, Any] = {}

_ESM_MODEL = None
_ESM_TOKENIZER = None
_ESM_LOCK = threading.Lock()
_ESM_LOAD_ERROR: Optional[str] = None
_ESM_LOAD_TIME_S: Optional[float] = None

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

ESM_MODEL_NAME = "facebook/esm2_t12_35M_UR50D"
ESM_EMBED_DIM = 480  # t12_35M hidden size
# ESM-2 positional embeddings are trained up to 1024 tokens (incl. CLS/EOS).
# Conservative max residue chunk size with room for special tokens.
MAX_CHUNK_RESIDUES = 1022
# When chunking long sequences, chunks must NOT overlap — otherwise the
# downstream length-weighted average over chunk-mean embeddings double-counts
# residues in the overlap zone (each shared residue contributes once to chunk
# A's mean and once to chunk B's mean, so weighting by chunk length
# over-weights the overlap region). With stride == MAX_CHUNK_RESIDUES the
# chunks tile, every residue contributes to exactly one chunk-mean, and the
# length-weighted sum reduces algebraically to the true global per-residue
# mean. Trade-off: residues at chunk boundaries lose context from the other
# side, but for a global mean-pool that effect is negligible vs. correctness.
CHUNK_STRIDE = MAX_CHUNK_RESIDUES

CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "cache")
SEQ_CACHE_PATH = os.path.join(CACHE_DIR, "protein_ml_seqs.json")
EMBED_CACHE_PATH = os.path.join(CACHE_DIR, "protein_ml_embeddings.npz")
HEAD_PATH = os.path.join(CACHE_DIR, "protein_ml_lr.pkl")
HEAD_VERSION = "1.0.0"

UNIPROT_FASTA = "https://rest.uniprot.org/uniprotkb/{uid}.fasta"

# Druggability class thresholds. Calibrated qualitatively for a binary
# classifier where positives are "well-drugged" targets:
#   < 0.40 → Likely undruggable
#   < 0.65 → Borderline
#   else   → Druggable
DRUGGABLE_THRESHOLD = 0.65
BORDERLINE_THRESHOLD = 0.40

VALID_AAS = set("ACDEFGHIKLMNPQRSTVWY")


# --------------------------------------------------------------------------- #
# UniProt sequence fetch
# --------------------------------------------------------------------------- #

def _fetch_sequence(uniprot_id: str, timeout: float = 10.0) -> Optional[str]:
    """Fetch a UniProt protein sequence as a plain amino-acid string.

    Uses the FASTA endpoint (lighter than the JSON record). Returns ``None``
    on lookup failure so callers can skip cleanly.
    """
    url = UNIPROT_FASTA.format(uid=uniprot_id)
    try:
        resp = requests.get(url, timeout=timeout)
        if resp.status_code != 200:
            return None
        text = resp.text.strip()
        if not text or not text.startswith(">"):
            return None
        # Drop the FASTA header, join the rest, strip whitespace.
        lines = text.splitlines()
        seq = "".join(l.strip() for l in lines[1:])
        # UniProt occasionally includes ambiguous letters (B, Z, U, X). Replace
        # them with the conservative "X" (unknown) token which ESM-2 supports.
        cleaned = "".join(c if c in VALID_AAS else "X" for c in seq.upper())
        return cleaned or None
    except Exception as exc:  # noqa: BLE001
        logger.warning("protein_ml: UniProt fetch failed for %s (%s)", uniprot_id, exc)
        return None


def _load_seq_cache() -> Dict[str, str]:
    if not os.path.exists(SEQ_CACHE_PATH):
        return {}
    try:
        with open(SEQ_CACHE_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_seq_cache(cache: Dict[str, str]) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(SEQ_CACHE_PATH, "w") as f:
        json.dump(cache, f)


# --------------------------------------------------------------------------- #
# ESM-2 model load + embedding
# --------------------------------------------------------------------------- #

def _load_esm():
    """Lazy-load the ESM-2 t12 35M tokenizer + model on CPU. Singleton."""
    global _ESM_MODEL, _ESM_TOKENIZER, _ESM_LOAD_ERROR, _ESM_LOAD_TIME_S
    if _ESM_MODEL is not None and _ESM_TOKENIZER is not None:
        return _ESM_TOKENIZER, _ESM_MODEL
    with _ESM_LOCK:
        if _ESM_MODEL is not None and _ESM_TOKENIZER is not None:
            return _ESM_TOKENIZER, _ESM_MODEL
        try:
            t0 = time.time()
            import torch  # noqa: F401  (warm import)
            from transformers import AutoModel, AutoTokenizer

            logger.info("protein_ml: loading ESM-2 (%s) on CPU...", ESM_MODEL_NAME)
            tok = AutoTokenizer.from_pretrained(ESM_MODEL_NAME)
            mdl = AutoModel.from_pretrained(ESM_MODEL_NAME)
            mdl.eval()  # inference only; no dropout, no grad
            _ESM_TOKENIZER = tok
            _ESM_MODEL = mdl
            _ESM_LOAD_TIME_S = time.time() - t0
            logger.info("protein_ml: ESM-2 ready in %.2fs", _ESM_LOAD_TIME_S)
            return _ESM_TOKENIZER, _ESM_MODEL
        except Exception as exc:  # noqa: BLE001
            _ESM_LOAD_ERROR = f"{type(exc).__name__}: {exc}"
            logger.exception("protein_ml: failed to load ESM-2")
            raise


def _embed_chunk(seq_chunk: str) -> np.ndarray:
    """Mean-pool ESM-2 per-residue embeddings for one chunk of <= MAX_CHUNK_RESIDUES."""
    import torch

    tok, mdl = _load_esm()
    inputs = tok(seq_chunk, return_tensors="pt", add_special_tokens=True)
    with torch.no_grad():
        out = mdl(**inputs)
    # last_hidden_state: [1, T, D]  where T includes CLS/EOS
    hidden = out.last_hidden_state[0]  # [T, D]
    attn = inputs.get("attention_mask", torch.ones(hidden.shape[0]))[0]  # [T]
    # Drop CLS (index 0) and EOS (last unmasked index).
    mask = attn.bool().clone()
    mask[0] = False  # CLS
    # Find the last True position (EOS) and zero it out.
    if mask.any():
        last_true = int(torch.nonzero(mask, as_tuple=False)[-1].item())
        mask[last_true] = False  # EOS
    if not mask.any():
        # Pathological — fall back to plain mean.
        return hidden.mean(dim=0).cpu().numpy().astype(np.float32)
    pooled = (hidden[mask].mean(dim=0)).cpu().numpy().astype(np.float32)
    return pooled


def _embed_sequence(sequence: str) -> np.ndarray:
    """Compute a single mean-pooled embedding for an arbitrary-length sequence.

    For sequences longer than `MAX_CHUNK_RESIDUES`, processes overlapping chunks
    and averages the chunk embeddings weighted by chunk length so each residue
    contributes proportionally.
    """
    if len(sequence) <= MAX_CHUNK_RESIDUES:
        return _embed_chunk(sequence)

    embs: List[np.ndarray] = []
    weights: List[int] = []
    start = 0
    n = len(sequence)
    while start < n:
        end = min(start + MAX_CHUNK_RESIDUES, n)
        chunk = sequence[start:end]
        embs.append(_embed_chunk(chunk))
        weights.append(end - start)
        if end == n:
            break
        start += CHUNK_STRIDE
    w = np.asarray(weights, dtype=np.float32)
    e = np.vstack(embs).astype(np.float32)  # [n_chunks, D]
    return (e * (w / w.sum())[:, None]).sum(axis=0)


# --------------------------------------------------------------------------- #
# Build training embeddings (cached)
# --------------------------------------------------------------------------- #

def _build_training_embeddings() -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """Fetch sequences + embed for every entry in the curated training set.

    Caches sequences in JSON and embeddings in NPZ keyed by uniprot_id, so
    re-runs are instant.
    """
    seq_cache = _load_seq_cache()

    embed_cache: Dict[str, np.ndarray] = {}
    if os.path.exists(EMBED_CACHE_PATH):
        try:
            with np.load(EMBED_CACHE_PATH) as npz:
                embed_cache = {k: npz[k] for k in npz.files}
            logger.info("protein_ml: loaded %d cached embeddings", len(embed_cache))
        except Exception as exc:  # noqa: BLE001
            logger.warning("protein_ml: embedding cache unreadable (%s); rebuilding", exc)
            embed_cache = {}

    entries = get_training_set()
    Xs: List[np.ndarray] = []
    ys: List[int] = []
    ids: List[str] = []
    seq_cache_dirty = False
    embed_cache_dirty = False

    for uid, label, _note in entries:
        # Sequence
        seq = seq_cache.get(uid)
        if not seq:
            seq = _fetch_sequence(uid)
            if seq:
                seq_cache[uid] = seq
                seq_cache_dirty = True
            else:
                logger.warning("protein_ml: skipping %s (no sequence)", uid)
                continue
        # Embedding
        emb = embed_cache.get(uid)
        if emb is None:
            try:
                emb = _embed_sequence(seq)
            except Exception as exc:  # noqa: BLE001
                logger.warning("protein_ml: embedding failed for %s (%s)", uid, exc)
                continue
            embed_cache[uid] = emb
            embed_cache_dirty = True
            if len(embed_cache) % 10 == 0:
                logger.info("protein_ml: embedded %d / %d training proteins",
                            len(embed_cache), len(entries))
        Xs.append(emb)
        ys.append(label)
        ids.append(uid)

    if seq_cache_dirty:
        _save_seq_cache(seq_cache)
    if embed_cache_dirty:
        os.makedirs(CACHE_DIR, exist_ok=True)
        np.savez_compressed(EMBED_CACHE_PATH, **{k: v for k, v in embed_cache.items()})

    if not Xs:
        raise RuntimeError("protein_ml: no training embeddings could be built")

    X = np.vstack(Xs).astype(np.float32)
    y = np.asarray(ys, dtype=np.int8)
    return X, y, ids


# --------------------------------------------------------------------------- #
# Train + cache logistic regression head
# --------------------------------------------------------------------------- #

def _train_head() -> Dict[str, Any]:
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline

    X, y, ids = _build_training_embeddings()
    logger.info("protein_ml: training LR head on %d samples (%d pos / %d neg)",
                len(y), int(y.sum()), int(len(y) - y.sum()))

    pipe = Pipeline([
        ("scale", StandardScaler()),
        ("lr", LogisticRegression(
            C=1.0,
            max_iter=2000,
            class_weight="balanced",
            random_state=42,
        )),
    ])

    # 5-fold CV ROC-AUC for honest performance reporting. Use None on failure
    # (NOT NaN) — Starlette's strict JSON encoder rejects NaN.
    cv_auc_mean: Optional[float]
    cv_auc_std: Optional[float]
    try:
        scores = cross_val_score(pipe, X, y, cv=5, scoring="roc_auc", n_jobs=-1)
        cv_auc_mean = float(np.mean(scores))
        cv_auc_std = float(np.std(scores))
    except Exception as exc:  # noqa: BLE001
        logger.warning("protein_ml: CV failed (%s); proceeding without metric", exc)
        cv_auc_mean = None
        cv_auc_std = None

    pipe.fit(X, y)

    bundle: Dict[str, Any] = {
        "version": HEAD_VERSION,
        "model": pipe,
        "n_train": int(len(y)),
        "n_positives": int(y.sum()),
        "n_negatives": int(len(y) - y.sum()),
        "training_uniprot_ids": ids,
        "cv_roc_auc_mean": cv_auc_mean,
        "cv_roc_auc_std": cv_auc_std,
        "esm_model": ESM_MODEL_NAME,
        "embed_dim": int(X.shape[1]),
        "trained_at": time.time(),
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(HEAD_PATH, "wb") as f:
        pickle.dump(bundle, f)
    if cv_auc_mean is not None and cv_auc_std is not None:
        logger.info("protein_ml: head cached (CV ROC-AUC = %.3f ± %.3f)",
                    cv_auc_mean, cv_auc_std)
    else:
        logger.info("protein_ml: head cached (CV unavailable)")
    return bundle


def _load_head() -> Dict[str, Any]:
    """Singleton loader for the trained LR head. Trains on first call if needed."""
    global _HEAD, _HEAD_LOAD_ERROR, _HEAD_LOAD_TIME_S, _HEAD_TRAIN_METRICS
    if _HEAD is not None:
        return _HEAD
    with _HEAD_LOCK:
        if _HEAD is not None:
            return _HEAD
        try:
            t0 = time.time()
            if os.path.exists(HEAD_PATH):
                with open(HEAD_PATH, "rb") as f:
                    bundle = pickle.load(f)
                if bundle.get("version") != HEAD_VERSION:
                    logger.info("protein_ml: cached head version mismatch, retraining")
                    bundle = _train_head()
            else:
                logger.info("protein_ml: no cached head, training from scratch")
                bundle = _train_head()
            _HEAD = bundle
            _HEAD_TRAIN_METRICS = {
                k: bundle.get(k) for k in (
                    "n_train", "n_positives", "n_negatives",
                    "cv_roc_auc_mean", "cv_roc_auc_std",
                    "esm_model", "embed_dim", "trained_at", "version",
                )
            }
            _HEAD_LOAD_TIME_S = time.time() - t0
            logger.info("protein_ml: head ready in %.2fs", _HEAD_LOAD_TIME_S)
            return _HEAD
        except Exception as exc:  # noqa: BLE001
            _HEAD_LOAD_ERROR = f"{type(exc).__name__}: {exc}"
            logger.exception("protein_ml: failed to load/train head")
            raise


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

def is_ready() -> Dict[str, Any]:
    """Report load status without forcing a load (mirrors cardiotox.is_ready)."""
    return {
        "loaded": _HEAD is not None,
        "load_time_s": _HEAD_LOAD_TIME_S,
        "error": _HEAD_LOAD_ERROR,
        "engine": "ProteinML v1 (ESM-2 t12 35M mean-pool → Logistic Regression)",
        "esm_loaded": _ESM_MODEL is not None,
        "esm_load_time_s": _ESM_LOAD_TIME_S,
        "esm_error": _ESM_LOAD_ERROR,
        "metrics": _HEAD_TRAIN_METRICS,
    }


def warmup() -> Dict[str, Any]:
    """Force load + train. Used by /models/warmup and the startup prewarm thread."""
    try:
        _load_head()
        return {"status": "ready", **is_ready()}
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc), **is_ready()}


def _druggability_class(prob: float) -> str:
    if prob >= DRUGGABLE_THRESHOLD:
        return "Druggable"
    if prob >= BORDERLINE_THRESHOLD:
        return "Borderline"
    return "Likely undruggable"


def _fallback_envelope(uniprot_id: str, error: str) -> Dict[str, Any]:
    return {
        "uniprot_id": uniprot_id,
        "source": "fallback",
        "ml_available": False,
        "error": error,
        "prediction": {
            "druggability_probability": None,
            "druggability_class": None,
        },
        "model_info": {
            "engine": "ProteinML (unavailable)",
            "method": "Model failed to load or sequence lookup failed; consumer should rely on rule-based druggability only",
            "load_status": is_ready(),
        },
    }


def predict_protein_ml(uniprot_id: str) -> Dict[str, Any]:
    """ESM-2 druggability probability for a single UniProt ID.

    Returns a structured envelope mirroring `predict_cardiotox` so the frontend
    can render an identical paired-card UI.

    Raises:
        ValueError if ``uniprot_id`` is empty/whitespace (true client error).
    """
    if not uniprot_id or not uniprot_id.strip():
        raise ValueError("uniprot_id is required")
    uniprot_id = uniprot_id.strip().upper()

    try:
        bundle = _load_head()
    except Exception as exc:  # noqa: BLE001
        return _fallback_envelope(uniprot_id, f"model_load_failed: {exc}")

    sequence = _fetch_sequence(uniprot_id)
    if not sequence:
        return _fallback_envelope(uniprot_id, "uniprot_lookup_failed_or_empty_sequence")

    try:
        t0 = time.time()
        emb = _embed_sequence(sequence)
        clf = bundle["model"]
        proba = clf.predict_proba(emb.reshape(1, -1))[0]
        classes = list(clf.named_steps["lr"].classes_)
        if 1 in classes:
            prob = float(proba[classes.index(1)])
        else:
            prob = float(proba[-1])
        inference_time_ms = round((time.time() - t0) * 1000, 2)
    except Exception as exc:  # noqa: BLE001
        logger.exception("protein_ml: inference failed for %s", uniprot_id)
        return _fallback_envelope(uniprot_id, f"inference_failed: {exc}")

    # How many chunks were used (purely informational for the UI).
    if len(sequence) <= MAX_CHUNK_RESIDUES:
        n_chunks = 1
    else:
        n_chunks = 1 + max(0, -(-(len(sequence) - MAX_CHUNK_RESIDUES) // CHUNK_STRIDE))

    return {
        "uniprot_id": uniprot_id,
        "source": "ml",
        "ml_available": True,
        "sequence_length": len(sequence),
        "prediction": {
            "druggability_probability": prob,
            "druggability_class": _druggability_class(prob),
        },
        "model_info": {
            "engine": "ProteinML v1 (ESM-2 t12 35M mean-pool → Logistic Regression)",
            "method": "Independent second-opinion classifier on top of frozen ESM-2 embeddings",
            "training": {
                "n_train": bundle.get("n_train"),
                "n_positives": bundle.get("n_positives"),
                "n_negatives": bundle.get("n_negatives"),
                "label_definition": "Positive = human protein with multiple FDA-approved small-molecule drugs; Negative = essential housekeeping with no approved direct binder",
            },
            "performance": {
                "cv_roc_auc_mean": bundle.get("cv_roc_auc_mean"),
                "cv_roc_auc_std": bundle.get("cv_roc_auc_std"),
                "cv_folds": 5,
            },
            "features": {
                "esm_model": ESM_MODEL_NAME,
                "embed_dim": bundle.get("embed_dim"),
                "pooling": "mean over residue tokens (CLS + EOS excluded)",
                "max_chunk_residues": MAX_CHUNK_RESIDUES,
                "chunk_stride": CHUNK_STRIDE,
                "chunks_used": n_chunks,
            },
            "thresholds": {
                "druggable": DRUGGABLE_THRESHOLD,
                "borderline": BORDERLINE_THRESHOLD,
            },
            "inference_time_ms": inference_time_ms,
            "license": "MIT (HakaseAI internal); ESM-2 weights MIT (Meta AI Research)",
            "reference": "Lin et al., Science 2023 — Evolutionary-scale prediction of atomic-level protein structure (ESM-2)",
        },
    }
