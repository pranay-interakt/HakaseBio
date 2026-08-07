"""ADMETlab 3.0 HTTPS client.

Replaces the Ersilia Docker sidecar path for four L1 endpoints:
  * pgp_substrate     — P-gp substrate probability
  * bsep_inhibition   — cholestatic-DILI liability (mapped to H-HT hepatotox
                        head; ADMETlab 3.0 doesn't expose a distinct BSEP
                        endpoint, and H-HT is the closest peer-reviewed
                        surrogate — Fu et al. NAR 2024, §Toxicity).
  * pampa             — parallel artificial membrane permeability
  * phospholipidosis  — CAD phospholipidosis probability

Design
------
* Simple. One HTTP client, one mapping table, four thin wrappers, no cache
  layers, no retry gymnastics. The frontend already tolerates a slow first
  call because ai-service fires it in parallel with 10 other ML calls.
* No fallback. If ADMETlab is down, unreachable, or the endpoint key isn't
  in the response, we return source="unavailable" with a structured reason
  and the UI shows the honest empty state. The rule the user set is
  "no shitty fallbacks" — this file has zero.
* No hardcoded fabrications. Every number rendered downstream came from
  the HTTP response body of admetlab3.scbdd.com or nothing came at all.

Environment
-----------
  HAKASE_ADMETLAB_URL      Base URL (default: https://admetlab3.scbdd.com).
                            Override for a staging endpoint or a reverse-proxy.
  HAKASE_ADMETLAB_TIMEOUT  Per-request timeout in seconds (default 15).
                            ADMETlab occasionally takes ~5 s on cold requests.

Contract
--------
Every wrapper returns:

  { "smiles": str, "endpoint": str, "source": "ml"|"unavailable",
    "ml_available": bool, "value": float|None, "value_kind": str,
    "raw": dict|None, "model_card": {...},
    "error_reason": str|None, "error": str|None }

plus one semantically-typed derived field per endpoint
(``substrate_probability`` / ``inhibition_probability`` / ``risk_class`` /
``pampa_pe_1e6_cm_s`` / ``pld_probability``).

Reference
---------
Fu et al. "ADMETlab 3.0: an updated comprehensive online ADMET prediction
platform..." Nucleic Acids Research (2024). https://admetlab3.scbdd.com
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get("HAKASE_ADMETLAB_URL", "https://admetlab3.scbdd.com").rstrip("/")
# Short by default: ADMETlab is a best-effort SECONDARY signal on the L1 critical
# path, and its public server (admetlab3.scbdd.com) is frequently slow/down. A
# tight timeout means a degraded upstream fails fast (its signal is then simply
# omitted) instead of freezing the L1 verdict for ~15s per call. Raise
# HAKASE_ADMETLAB_TIMEOUT when pointing at a known-fast mirror.
TIMEOUT_S = float(os.environ.get("HAKASE_ADMETLAB_TIMEOUT", "3.0"))

# OFF by default. admetlab3.scbdd.com is a third-party academic server with no
# uptime guarantee — when it is slow or down it used to stall the L1 verdict for
# ~15s per call ("AWAITING ML ENGINE"). BSEP/cholestasis and phospholipidosis are
# now served by LOCAL trained models (bsep_ml, phospholipidosis_ml); ADMETlab is
# only an optional extra second opinion. Enable it (HAKASE_ADMETLAB_ENABLED=1)
# ONLY when BASE_URL points at a mirror you know is fast. When disabled, every
# endpoint returns an honest "unavailable/disabled" envelope (no fabrication, no
# network call).
ENABLED = os.environ.get("HAKASE_ADMETLAB_ENABLED", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
ERR_DISABLED = "disabled"

# Structured error reasons — mirrors ersilia_hub for consistency in the
# frontend health pill.
ERR_HTTP = "http_error"
ERR_TIMEOUT = "timeout"
ERR_INVALID_RESPONSE = "invalid_response"
ERR_NO_VALUE = "no_value"
ERR_INVALID_SMILES = "invalid_smiles"

# L1 endpoint → ADMETlab 3.0 response-key. If a key is renamed in a future
# ADMETlab release, override at deploy time via HAKASE_ADMETLAB_KEYS json
# (same format as HAKASE_ERSILIA_MODELS was).
KEY_MAP: dict[str, str] = {
    "pgp_substrate": "Pgp-sub",
    "bsep_inhibition": "H-HT",  # closest peer-reviewed hepatotox surrogate
    "pampa": "PAMPA",  # log(Papp), cm/s
    "phospholipidosis": "Phospholipidosis",
}

MODEL_CARDS: dict[str, dict[str, str]] = {
    "pgp_substrate": {
        "name": "P-gp substrate",
        "reference": "ADMETlab 3.0 · Pgp-sub head",
        "about": "MDR1 (P-gp) substrate probability.",
    },
    "bsep_inhibition": {
        "name": "Hepatotoxicity (H-HT surrogate for BSEP)",
        "reference": "ADMETlab 3.0 · H-HT head",
        "about": "Broad human hepatotoxicity — used as a cholestatic-DILI surrogate. "
        "ADMETlab does not expose a dedicated BSEP head.",
    },
    "pampa": {
        "name": "PAMPA permeability",
        "reference": "ADMETlab 3.0 · PAMPA head",
        "about": "log Papp — parallel artificial membrane permeability.",
    },
    "phospholipidosis": {
        "name": "Drug-induced phospholipidosis",
        "reference": "ADMETlab 3.0 · Phospholipidosis head",
        "about": "CAD lysosomal-lamellar-body accumulation probability.",
    },
}


def _unavailable(smiles: str, endpoint: str, reason: str, msg: str) -> dict[str, Any]:
    logger.warning(
        "admetlab: unavailable endpoint=%s reason=%s msg=%s",
        endpoint,
        reason,
        msg,
    )
    return {
        "smiles": smiles,
        "endpoint": endpoint,
        "source": "unavailable",
        "ml_available": False,
        "value": None,
        "value_kind": "raw",
        "raw": None,
        "model_card": {
            "engine": "ADMETlab 3.0",
            "endpoint": endpoint,
            **MODEL_CARDS.get(endpoint, {}),
        },
        "error_reason": reason,
        "error": msg,
    }


def _predict_raw(endpoint: str, smiles: str) -> dict[str, Any]:
    """POST a single SMILES to ADMETlab 3.0 and return the raw JSON envelope
    the caller can pull an endpoint key out of.

    Returns the standard envelope shape from _unavailable() on any failure,
    else `{"source": "ml", "ml_available": True, "raw": <admetlab-response>}`.
    """
    if not ENABLED:
        # Gated off — do NOT touch the network. Honest unavailable envelope so the
        # caller omits/flags the signal instead of waiting on a flaky server.
        return _unavailable(
            smiles or "",
            endpoint,
            ERR_DISABLED,
            "ADMETlab is disabled (HAKASE_ADMETLAB_ENABLED=0); "
            "BSEP/phospholipidosis are served by local models.",
        )
    if not smiles or not smiles.strip():
        return _unavailable(smiles or "", endpoint, ERR_INVALID_SMILES, "smiles is required")
    smiles = smiles.strip()

    try:
        import httpx
    except ImportError as exc:
        return _unavailable(
            smiles,
            endpoint,
            ERR_HTTP,
            f"httpx not installed on this host ({exc}). " f"Add httpx to ai-service deps.",
        )

    try:
        with httpx.Client(timeout=TIMEOUT_S, verify=False) as client:
            r = client.post(
                f"{BASE_URL}/api/single/admet",
                json={"SMILES": smiles},
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
            r.raise_for_status()
            body = r.json()
    except httpx.TimeoutException as exc:
        logger.error("admetlab: TIMEOUT endpoint=%s: %s", endpoint, exc)
        return _unavailable(
            smiles, endpoint, ERR_TIMEOUT, f"ADMETlab 3.0 timed out after {TIMEOUT_S}s."
        )
    except httpx.HTTPStatusError as exc:
        logger.error("admetlab: HTTP %s endpoint=%s: %s", exc.response.status_code, endpoint, exc)
        return _unavailable(
            smiles, endpoint, ERR_HTTP, f"ADMETlab 3.0 returned HTTP {exc.response.status_code}."
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("admetlab: %s endpoint=%s: %s", type(exc).__name__, endpoint, exc)
        return _unavailable(
            smiles, endpoint, ERR_HTTP, f"ADMETlab 3.0 call failed: {type(exc).__name__}: {exc}"
        )

    if not isinstance(body, dict):
        return _unavailable(
            smiles,
            endpoint,
            ERR_INVALID_RESPONSE,
            f"ADMETlab 3.0 returned non-object body: {type(body).__name__}.",
        )

    return {"source": "ml", "ml_available": True, "raw": body}


def _extract(endpoint: str, smiles: str) -> tuple[float | None, dict[str, Any]]:
    """Run the HTTP call and pull the mapped numeric value out of the
    response. Returns (value_or_None, envelope). Envelope is either a
    successful `source="ml"` skeleton (with `raw`) or a full unavailable
    envelope from _unavailable(). Caller stamps the derived field."""
    key = KEY_MAP.get(endpoint)
    result = _predict_raw(endpoint, smiles)
    if result.get("source") != "ml":
        return None, result

    raw = result["raw"]
    # ADMETlab has returned two shapes historically: a flat dict of
    # endpoint→value, or a {"data": [{endpoint: value, ...}]} wrapper.
    # Handle both so a schema tweak on their side doesn't break us silently.
    payload: Any = raw
    if isinstance(raw.get("data"), list) and raw["data"]:
        payload = raw["data"][0]
    if not isinstance(payload, dict):
        return None, _unavailable(
            smiles, endpoint, ERR_INVALID_RESPONSE, "ADMETlab payload was not a dict."
        )
    val = payload.get(key)
    if val is None:
        # Loud "key missing" so we can spot ADMETlab API drift immediately.
        logger.warning(
            "admetlab: key %r not found in response endpoint=%s. " "Present keys: %s",
            key,
            endpoint,
            sorted(list(payload)[:10]),
        )
        return None, _unavailable(
            smiles,
            endpoint,
            ERR_NO_VALUE,
            f"ADMETlab response did not contain '{key}' — " f"the endpoint key may have changed.",
        )
    try:
        fval = float(val)
    except (TypeError, ValueError):
        return None, _unavailable(
            smiles,
            endpoint,
            ERR_NO_VALUE,
            f"ADMETlab returned non-numeric value for '{key}': {val!r}",
        )

    envelope = {
        "smiles": smiles,
        "endpoint": endpoint,
        "source": "ml",
        "ml_available": True,
        "value": fval,
        "value_kind": "raw",
        "raw": raw,
        "model_card": {
            "engine": "ADMETlab 3.0",
            "endpoint": endpoint,
            "source_key": key,
            **MODEL_CARDS.get(endpoint, {}),
        },
        "error_reason": None,
        "error": None,
    }
    return fval, envelope


# ─────────────────────────────────────────────────────────────────────────────
# Public wrappers — one per L1 endpoint. Each stamps a semantically-typed
# derived field so downstream code doesn't have to interpret raw ADMETlab keys.
# ─────────────────────────────────────────────────────────────────────────────


def predict_pgp_substrate(smiles: str) -> dict[str, Any]:
    """P-gp substrate probability [0, 1] via ADMETlab 3.0 Pgp-sub head."""
    val, env = _extract("pgp_substrate", smiles)
    if val is not None and 0.0 <= val <= 1.0:
        env["substrate_probability"] = val
    else:
        env["substrate_probability"] = None
    return env


def predict_bsep_inhibition(smiles: str) -> dict[str, Any]:
    """Cholestatic-DILI surrogate via ADMETlab 3.0 H-HT head.

    Returns ``inhibition_probability`` in [0, 1] and a Low/Moderate/High
    ``risk_class`` (threshold convention 0.4/0.7, matching the Warner 2012
    pQSAR triage widely used in pharma).
    """
    val, env = _extract("bsep_inhibition", smiles)
    prob = None
    risk = None
    if val is not None and 0.0 <= val <= 1.0:
        prob = val
        risk = "High" if val >= 0.70 else "Moderate" if val >= 0.40 else "Low"
    env["inhibition_probability"] = prob
    env["risk_class"] = risk
    return env


def predict_pampa(smiles: str) -> dict[str, Any]:
    """PAMPA permeability via ADMETlab 3.0.

    ADMETlab reports PAMPA as a log Papp (log cm/s) — we convert to a
    linear ×10⁻⁶ cm/s so the L1 Permeability tab can render a number in
    the same unit as the Caco-2 column.

        Pe[×10⁻⁶ cm/s]  =  10 ** (log_papp + 6)   (log_papp in log cm/s)

    Guards against exotic exponents from a corrupt response.
    """
    val, env = _extract("pampa", smiles)
    pe = None
    if val is not None:
        try:
            pe_raw = 10.0 ** (val + 6.0)
            if 0.0 < pe_raw < 1e4:
                pe = pe_raw
        except Exception:
            pe = None
    env["pampa_pe_1e6_cm_s"] = pe
    return env


def predict_phospholipidosis(smiles: str) -> dict[str, Any]:
    """CAD phospholipidosis probability [0, 1] via ADMETlab 3.0.

    Thresholds: 0.5 → Moderate, 0.75 → High (Kruhlak 2008 / Przybyla 2020
    industry convention).
    """
    val, env = _extract("phospholipidosis", smiles)
    prob = None
    risk = None
    if val is not None and 0.0 <= val <= 1.0:
        prob = val
        risk = "High" if val >= 0.75 else "Moderate" if val >= 0.50 else "Low"
    env["pld_probability"] = prob
    env["risk_class"] = risk
    return env


# ─────────────────────────────────────────────────────────────────────────────
# Health probe for the frontend status pill.
# ─────────────────────────────────────────────────────────────────────────────


def is_ready() -> dict[str, Any]:
    """Report ADMETlab reachability + configuration. Cheap probe: GET the
    base URL with a 3 s timeout. Green when it answers <500."""
    entry: dict[str, Any] = {
        "engine": "ADMETlab 3.0",
        "url": BASE_URL,
        "timeout_s": TIMEOUT_S,
        "endpoints_wired": list(KEY_MAP),
        "state": "unknown",
        "reason": None,
    }
    try:
        import httpx

        with httpx.Client(timeout=3.0, verify=False) as client:
            r = client.get(BASE_URL)
        entry["state"] = "live" if r.status_code < 500 else "unhealthy"
        if r.status_code >= 500:
            entry["reason"] = f"HTTP {r.status_code}"
    except Exception as exc:  # noqa: BLE001
        entry["state"] = "unreachable"
        entry["reason"] = f"{type(exc).__name__}: {exc}"
    return entry
