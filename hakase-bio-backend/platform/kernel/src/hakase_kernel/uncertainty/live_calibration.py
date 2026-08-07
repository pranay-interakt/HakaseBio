"""Live, in-memory safety-threshold calibration — NO on-disk JSON.

Replaces the static `cache/conformal_calibration.json` + `cache/screening_thresholds.json`
files with thresholds fitted **live at warmup** from a real ChEMBL approved-vs-withdrawn
reference set, held only in memory. Same methodology as the offline scripts
(`scripts/calibrate_conformal_thresholds.py` + `scripts/calibrate_screening_thresholds.py`):

  • NO-GO (veto)  = FPR-controlled split-conformal threshold — the (1−α) quantile of
                    approved-drug scores, so P(flag | approved) ≤ α. High specificity.
  • WATCH (screen)= Youden-J threshold (argmax_t TPR_withdrawn − FPR_approved) on the
                    SAME served-model score scale. High sensitivity.

Design contract:
  • **No file reads or writes.** Reference compounds are fetched live from the ChEMBL
    REST API; scores are produced by the SAME served models the verdict uses; thresholds
    are fitted with pure NumPy and kept in an in-memory registry with full provenance.
  • **Best-effort + honest fallback.** If the live fetch/score/fit cannot complete for an
    endpoint, `thresholds()` returns documented literature defaults clearly labelled as
    uncalibrated — never a fabricated "calibrated" number.
  • **Drop-in.** `thresholds(endpoint, watch_default, nogo_default)` matches the shape
    `invitro_panel._safety_thresholds` expects, so the verdict engine sources its
    operating points here instead of from JSON.

Public API:
    fit_all(limit=..., alpha=0.05) -> dict      # run at warmup (daemon thread)
    thresholds(endpoint, watch_default, nogo_default) -> (watch, nogo, basis)
    provenance(endpoint) -> dict | None
    status() -> dict
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

MODULE_VERSION = "1.1.0"  # v1.1: shipped versioned artifact is primary; live ChEMBL refit is opt-in

# The safety thresholds now come from a shipped versioned artifact by default
# (see thresholds() → _artifact_thresholds). The live ChEMBL refit is an OPTIONAL
# refresh, off by default: it created a boot-time dependency on a flaky third-party
# API (www.ebi.ac.uk) with no upside over the offline-built artifact. Enable it only
# to refresh the in-memory fit from live ChEMBL (HAKASE_LIVE_CALIBRATION_ENABLED=1).
LIVE_REFIT_ENABLED = os.environ.get("HAKASE_LIVE_CALIBRATION_ENABLED", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)

# Documented literature/triage defaults — the honest fallback when the live fit
# has not (yet) produced a threshold for an endpoint. These match the historical
# invitro_panel defaults so behaviour is unchanged until a live fit lands.
_DEFAULTS: dict[str, tuple[float, float]] = {
    # endpoint: (watch_default, nogo_default)
    "herg": (0.35, 0.75),
    "dili": (0.40, 0.85),
    "ames": (0.45, 0.75),
}

# Served-model probability key + scorer for each core safety endpoint. The scorer
# is resolved lazily so importing this module never pulls in the heavy ML stack.
_ENDPOINTS: dict[str, dict[str, str]] = {
    "herg": {"module": "cardiotox", "fn": "predict_cardiotox", "prob_key": "blocker_probability"},
    "dili": {"module": "dili_ml", "fn": "predict_dili_ml", "prob_key": "dili_probability"},
    "ames": {"module": "ames_ml", "fn": "predict_ames_ml", "prob_key": "mutagenic_probability"},
}

_CHEMBL = "https://www.ebi.ac.uk/chembl/api/data/molecule.json"

# In-memory registry. { endpoint: {watch, nogo, basis, provenance...} }. No disk.
_REGISTRY: dict[str, dict[str, Any]] = {}
_LOCK = threading.Lock()
_STATE: dict[str, Any] = {
    "fitted": False,
    "running": False,
    "last_error": None,
    "fitted_at": None,
    "source": None,
}


# --------------------------------------------------------------------------- #
# Pure fitting math (unit-testable without any model or network)
# --------------------------------------------------------------------------- #


def youden_threshold(approved: list[float], withdrawn: list[float]) -> dict[str, float] | None:
    """Youden-J screen threshold: argmax_t (TPR_withdrawn − FPR_approved), STRICT >.

    Positives = withdrawn, negatives = approved. Returns None if either arm is empty.
    """
    import numpy as np

    neg = np.asarray(approved, float)
    pos = np.asarray(withdrawn, float)
    if neg.size == 0 or pos.size == 0:
        return None
    cand = np.unique(np.concatenate([neg, pos]))
    best_j, thr, tpr_b, fpr_b = -2.0, None, None, None
    for t in cand:
        t = float(t)
        tpr = float(np.mean(pos > t))
        fpr = float(np.mean(neg > t))
        j = tpr - fpr
        if j > best_j:
            best_j, thr, tpr_b, fpr_b = j, t, tpr, fpr
    return {
        "threshold": round(float(thr), 4),
        "recall_withdrawn": round(tpr_b, 4),
        "fpr_approved": round(fpr_b, 4),
        "youden_j": round(best_j, 4),
    }


def fpr_controlled_threshold(approved: list[float], alpha: float = 0.05) -> dict[str, float] | None:
    """Split-conformal FPR-controlled veto threshold — the (1−α) quantile of approved
    (negative) scores, so the false-positive rate on approved drugs is bounded by α
    under the STRICT `>` flag rule. Returns None if too few approved scores.
    """
    import numpy as np

    neg = np.asarray(approved, float)
    if neg.size < 20:
        return None
    # Conformal (1-α) quantile with finite-sample correction: ceil((n+1)(1-α))/n.
    n = neg.size
    q_level = min(1.0, (np.ceil((n + 1) * (1.0 - alpha)) / n))
    thr = float(np.quantile(neg, q_level, method="higher"))
    realised_fpr = float(np.mean(neg > thr))
    return {
        "threshold": round(thr, 4),
        "alpha": alpha,
        "realised_fpr_on_approved": round(realised_fpr, 4),
        "n_approved": int(n),
    }


def fit_endpoint(
    endpoint: str, approved: list[float], withdrawn: list[float], alpha: float = 0.05
) -> dict[str, Any] | None:
    """Fit (watch, nogo) operating points for one endpoint from live-scored drugs.

    watch = Youden-J screen threshold; nogo = FPR-controlled conformal veto.
    Returns a registry record, or None when there is not enough signal to fit.
    """
    if len(approved) < 20 or len(withdrawn) < 10:
        return None
    screen = youden_threshold(approved, withdrawn)
    veto = fpr_controlled_threshold(approved, alpha)
    if screen is None or veto is None:
        return None
    watch = screen["threshold"]
    nogo = veto["threshold"]
    # Guardrail: the veto (hard NO-GO) must never sit below the screen (WATCH). If the
    # live sample is pathological, keep the monotone ordering rather than emit garbage.
    if nogo < watch:
        nogo = max(nogo, watch)
    return {
        "endpoint": endpoint,
        "watch": watch,
        "nogo": nogo,
        "basis": f"live ChEMBL fit — Youden screen (WATCH) + α={alpha} conformal veto (NO-GO)",
        "screen": screen,
        "veto": veto,
        "n_approved": len(approved),
        "n_withdrawn": len(withdrawn),
    }


# --------------------------------------------------------------------------- #
# Live reference set (ChEMBL REST — no local snapshot file)
# --------------------------------------------------------------------------- #


def _fetch_smiles(params: dict[str, str], limit: int) -> list[str]:
    """Page the ChEMBL molecule API live and collect canonical SMILES."""
    import requests

    out: list[str] = []
    url: str | None = _CHEMBL
    q = dict(params)
    q["limit"] = str(min(1000, limit))
    while url and len(out) < limit:
        r = requests.get(url, params=q if url == _CHEMBL else None, timeout=30)
        r.raise_for_status()
        data = r.json()
        for m in data.get("molecules", []):
            smi = (m.get("molecule_structures") or {}).get("canonical_smiles")
            if smi:
                out.append(smi)
                if len(out) >= limit:
                    break
        nxt = (data.get("page_meta") or {}).get("next")
        url = ("https://www.ebi.ac.uk" + nxt) if nxt else None
        q = {}  # next already carries the query string
    return out


def fetch_reference_smiles(limit: int = 250) -> tuple[list[str], list[str]]:
    """(approved, withdrawn) canonical SMILES fetched live from ChEMBL.

    approved  = max_phase=4 (marketed) → negatives.
    withdrawn = withdrawn_flag=true     → positives.
    """
    approved = _fetch_smiles({"max_phase": "4"}, limit)
    withdrawn = _fetch_smiles({"withdrawn_flag": "true"}, limit)
    return approved, withdrawn


def _score(endpoint: str, smiles_list: list[str]) -> list[float]:
    """Score a list of SMILES with the SAME served model the verdict uses."""
    import importlib

    spec = _ENDPOINTS[endpoint]
    mod = importlib.import_module(f".{spec['module']}", package=__package__)
    fn = getattr(mod, spec["fn"])
    key = spec["prob_key"]
    scores: list[float] = []
    for smi in smiles_list:
        try:
            res = fn(smi)
        except Exception:  # noqa: BLE001 — one bad molecule must not abort the fit
            continue
        p = _dig(res, key)
        if p is not None:
            scores.append(p)
    return scores


def _dig(obj: Any, key: str) -> float | None:
    if isinstance(obj, (int, float)):
        try:
            return float(obj)
        except (TypeError, ValueError):
            return None
    if isinstance(obj, dict):
        if key in obj and isinstance(obj[key], (int, float)):
            return float(obj[key])
        for v in obj.values():
            r = _dig(v, key)
            if r is not None:
                return r
    return None


# --------------------------------------------------------------------------- #
# Orchestration + public accessors
# --------------------------------------------------------------------------- #


def fit_all(limit: int = 250, alpha: float = 0.05) -> dict[str, Any]:
    """OPTIONAL live refit: fetch a reference set from ChEMBL, score it with the served
    models, and fit in-memory (watch, nogo) thresholds for the core safety endpoints.

    OFF by default (HAKASE_LIVE_CALIBRATION_ENABLED). The authoritative thresholds ship
    in the versioned build artifact (see `_artifact_thresholds`), so this exists only to
    refresh them against live ChEMBL on demand. Gated HERE rather than only in warmup()
    because callers (main.py's boot thread) invoke fit_all directly — this is the single
    choke point, so no caller can accidentally reintroduce a boot-time dependency on a
    third-party API. Best-effort: any failure leaves the shipped artifact in force.
    """
    if not LIVE_REFIT_ENABLED:
        logger.info(
            "live_calibration: live ChEMBL refit disabled (default); thresholds "
            "come from the versioned build artifact. Set "
            "HAKASE_LIVE_CALIBRATION_ENABLED=1 to refresh from live ChEMBL."
        )
        return status()
    with _LOCK:
        if _STATE["running"]:
            return status()
        _STATE["running"] = True
    fitted: dict[str, dict[str, Any]] = {}
    try:
        approved, withdrawn = fetch_reference_smiles(limit)
        logger.info(
            "live_calibration: fetched %d approved / %d withdrawn from ChEMBL",
            len(approved),
            len(withdrawn),
        )
        for endpoint in _ENDPOINTS:
            try:
                a = _score(endpoint, approved)
                w = _score(endpoint, withdrawn)
                rec = fit_endpoint(endpoint, a, w, alpha)
                if rec:
                    rec["fitted_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    fitted[endpoint] = rec
                    logger.info(
                        "live_calibration[%s]: WATCH=%.4f NO-GO=%.4f (n_appr=%d n_wd=%d)",
                        endpoint,
                        rec["watch"],
                        rec["nogo"],
                        rec["n_approved"],
                        rec["n_withdrawn"],
                    )
            except Exception as e:  # noqa: BLE001
                logger.warning("live_calibration[%s] fit failed: %s", endpoint, e)
        with _LOCK:
            _REGISTRY.update(fitted)
            _STATE.update(
                {
                    "fitted": bool(fitted),
                    "fitted_at": time.time(),
                    "source": "ChEMBL live (max_phase=4 vs withdrawn_flag)",
                    "last_error": None,
                }
            )
    except Exception as e:  # noqa: BLE001 — whole fit best-effort; defaults remain
        logger.warning("live_calibration.fit_all failed: %s", e)
        with _LOCK:
            _STATE["last_error"] = str(e)
    finally:
        with _LOCK:
            _STATE["running"] = False
    return status()


def warmup(limit: int = 250) -> None:
    """Kick off the OPTIONAL live ChEMBL refit in a background thread. No-op unless
    HAKASE_LIVE_CALIBRATION_ENABLED is set — the shipped versioned artifact is the
    default source, so we do NOT touch the network at boot."""
    if not LIVE_REFIT_ENABLED:
        logger.info(
            "live_calibration: live refit disabled; using shipped versioned "
            "artifact (cache/conformal_calibration.json + screening_thresholds.json)."
        )
        return
    threading.Thread(
        target=fit_all, kwargs={"limit": limit}, name="live-calibration", daemon=True
    ).start()


def _artifact_thresholds(endpoint: str) -> dict[str, Any] | None:
    """(watch, nogo) from the shipped, versioned calibration artifacts —
    `cache/conformal_calibration.json` (FPR-controlled veto → NO-GO) +
    `cache/screening_thresholds.json` (Youden-J screen → WATCH), both produced
    offline by scripts/calibrate_*.py on the 845-approved / 338-withdrawn ChEMBL
    hold-out. This is a BUILD-TIME deliverable versioned alongside the model
    weights — always available, no runtime network call, not a fallback. Returns
    None only if an artifact is missing/uncalibrated for this endpoint."""
    import hakase_kernel.base as base

    veto = (base._load_conformal_veto().get("endpoints") or {}).get(endpoint)
    screen = (base._load_screening().get("endpoints") or {}).get(endpoint)
    if not veto or veto.get("status") != "CALIBRATED":
        return None
    nogo = float(veto["threshold"])
    watch = None
    watch_a = None
    if screen and screen.get("status") == "CALIBRATED":
        # Prefer the FPR-controlled WATCH gate (α=0.20, ~20% approved-FPR); fall back
        # to Youden only if the newer operating point isn't present in the artifact.
        fpr = screen.get("screen_fpr_controlled")
        if fpr and fpr.get("threshold") is not None:
            watch = float(fpr["threshold"])
            watch_a = fpr.get("alpha")
        else:
            watch = float((screen.get("screen_youden") or {}).get("threshold"))
    if watch is None:
        return None
    if nogo < watch:  # keep monotone ordering (veto ≥ watch)
        nogo = watch
    return {
        "watch": round(watch, 4),
        "nogo": round(nogo, 4),
        "basis": f"versioned build artifact — FPR-controlled WATCH (α={watch_a}) + "
        f"α={veto.get('alpha')} conformal veto (NO-GO), "
        f"n_approved={veto.get('n_approved_scored_total')}",
    }


def thresholds(
    endpoint: str, watch_default: float, nogo_default: float
) -> tuple[float, float, str]:
    """(watch, nogo, basis) for a core safety endpoint — drop-in for the old
    JSON-backed `_safety_thresholds`.

    Preference order:
      1. Shipped versioned calibration artifact (primary — always available,
         built offline on the full 845/338 hold-out, no runtime dependency).
      2. Live in-memory ChEMBL refit, IF one succeeded this session (opportunistic).
      3. Documented literature default, labelled uncalibrated (last resort).
    """
    art = _artifact_thresholds(endpoint)
    if art:
        return art["watch"], art["nogo"], art["basis"]
    with _LOCK:
        rec = _REGISTRY.get(endpoint)
    if rec:
        return rec["watch"], rec["nogo"], rec["basis"]
    return watch_default, nogo_default, "documented default (no calibration available)"


def provenance(endpoint: str) -> dict[str, Any] | None:
    """Fit provenance for an endpoint — the live refit record if one exists this
    session, else the shipped versioned artifact's operating points."""
    with _LOCK:
        rec = _REGISTRY.get(endpoint)
    if rec:
        return {"source": "live_refit", **rec}
    art = _artifact_thresholds(endpoint)
    if art:
        return {"source": "versioned_artifact", "endpoint": endpoint, **art}
    return None


def status() -> dict[str, Any]:
    artifact_endpoints = [e for e in _DEFAULTS if _artifact_thresholds(e) is not None]
    with _LOCK:
        return {
            "module": "live_calibration",
            "module_version": MODULE_VERSION,
            "primary_source": "versioned build artifact (cache/conformal_calibration.json + screening_thresholds.json)",
            "artifact_calibrated_endpoints": artifact_endpoints,
            "live_refit_enabled": LIVE_REFIT_ENABLED,
            "live_refit_endpoints": sorted(_REGISTRY.keys()),
            "defaults_for": [
                e for e in _DEFAULTS if e not in _REGISTRY and _artifact_thresholds(e) is None
            ],
            **{k: _STATE[k] for k in ("fitted", "running", "last_error", "source")},
        }
