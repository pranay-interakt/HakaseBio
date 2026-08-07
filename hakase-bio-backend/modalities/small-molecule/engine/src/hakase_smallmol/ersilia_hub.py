"""Ersilia Model Hub adapter — real open-source ML predictors, on demand.

Bridges the in-vitro (L1) layer to the Ersilia Model Hub (https://ersilia.io,
catalog: https://catalog.ersilia.io) — 150+ pretrained, open-source models
(cytotoxicity, ADMET, mutagenicity, antimicrobial, …) each behind a uniform
SMILES → prediction interface. This lets the L1 engine source a REAL model
prediction for an endpoint that would otherwise fall back to a heuristic —
with honest provenance and graceful degradation (it NEVER fabricates a number;
on any failure it returns ``source="unavailable"`` and ``value=None``).

Why this is an adapter and not in-process model code
----------------------------------------------------
Ersilia models run as isolated services (Docker / conda), so they belong on the
GPU/worker tier, not inside the CPU API process. Two backends are supported:

  mode="local"   ``from ersilia import ErsiliaModel`` — serve + run on this host.
                 Requires ``ersilia`` + Docker and the model fetched once via
                 ``ersilia -v fetch <eos_id>``.
  mode="client"  Talk to an already-served model over HTTP via
                 ``ersilia_client.ErsiliaClient(url)`` — the standard pattern
                 when models are served on a separate worker/pod.
  mode="off"     Default. Every endpoint reports ``unavailable`` so nothing
                 breaks and the engine keeps its labelled fallback.

Configuration (environment)
---------------------------
  HAKASE_ERSILIA_MODE    off | local | client                    (default off)
  HAKASE_ERSILIA_MODELS  '{"cytotoxicity":"eos9ei3","ames":"eos3804"}'
                         JSON map: L1 endpoint -> Ersilia eos model id.
  HAKASE_ERSILIA_URLS    '{"cytotoxicity":"http://worker:3000"}'  (client mode)
                         JSON map: L1 endpoint -> served model URL.
  HAKASE_ERSILIA_OUTPUT  '{"cytotoxicity":{"kind":"cc50_uM","key":"cc50"}}'
                         Optional per-endpoint output hint: which field of the
                         model output to read (``key``) and what it means
                         (``kind``: ``cc50_uM`` | ``ic50_uM`` | ``probability``
                         | ``raw``). When absent the adapter best-effort-extracts
                         the first finite numeric leaf and marks kind="raw".

eos ids are deliberately NOT hardcoded — pick the exact model for each endpoint
from https://catalog.ersilia.io and set it here. The adapter validates the id
shape (``eos[1-9][a-z0-9]{3}``) and refuses to run an unset / malformed id.

Output contract (matches the rest of ai-service)
------------------------------------------------
  { "smiles", "endpoint", "source": "ml"|"unavailable", "ml_available": bool,
    "value": float|None, "value_kind": str, "raw": <model output>,
    "model_id": str|None, "model_card": {...}, "error": str|None }
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from typing import Any

logger = logging.getLogger(__name__)

_EOS_RE = re.compile(r"^eos[1-9][a-z0-9]{3}$")

# ─────────────────────────────────────────────────────────────────────────────
# Structured error / observability contract.
#
# The user requirement is: NO silent Ersilia failures. Every "unavailable"
# envelope carries:
#   error_reason  — a machine-readable enum (used by /predict/ersilia/status
#                   for the sidecar-health pill in the frontend and by log
#                   filters for the ops dashboard).
#   error         — human-readable message (unchanged).
# Every failure path also LOG.error()s so the ai-service container's stderr
# has the full context (endpoint, eos id, url, exception). This means an
# `unavailable` sidebar row is never a mystery — you can grep the logs.
# ─────────────────────────────────────────────────────────────────────────────
ERR_MODE_OFF = "mode_off"  # HAKASE_ERSILIA_MODE is off
ERR_MODEL_UNSET = "model_unset"  # HAKASE_ERSILIA_MODELS missing this endpoint
ERR_URL_UNSET = "url_unset"  # client mode but HAKASE_ERSILIA_URLS missing
ERR_ERSILIA_MISSING = "ersilia_import_error"  # `import ersilia` / `import ersilia_client` failed
ERR_TIMEOUT = "timeout"  # HTTP timed out after all retries
ERR_HTTP = "http_error"  # non-200 or network error after all retries
ERR_INVALID_RESPONSE = "invalid_response"  # sidecar returned a shape we can't parse
ERR_NO_VALUE = "no_value"  # model ran but returned no numeric leaf
ERR_INVALID_SMILES = "invalid_smiles"  # blank/whitespace SMILES passed in

# Retry policy for transient HTTP failures. Two retries × exponential backoff
# swallow the common transient failures (Docker network hiccup, sidecar
# restart mid-call, worker briefly OOM) without hiding real outages.
RETRY_ATTEMPTS = 3  # 1 initial + 2 retries
RETRY_BACKOFF_S = (0.4, 1.0)  # sleep between attempts 1→2 and 2→3
HTTP_TIMEOUT_S = float(os.environ.get("HAKASE_ERSILIA_TIMEOUT", "8.0"))

# In-memory LRU cache keyed on (endpoint, canonical SMILES). Repeat lookups
# for the same molecule inside a session are served in ~0 ms so the L1
# scorecard, similar-compounds panel, and PDF report reuse the same call.
# 1024 entries × ~2 KB envelope ≈ 2 MB; well within a worker's RSS budget.
_CACHE_MAX = int(os.environ.get("HAKASE_ERSILIA_CACHE_SIZE", "1024"))
_CACHE: OrderedDict[tuple[str, str], dict[str, Any]] = OrderedDict()
_CACHE_LOCK = threading.Lock()
_CACHE_HITS = 0
_CACHE_MISSES = 0


def _canon_smiles(smiles: str) -> str:
    """Cheap normalization for cache keying — full RDKit canonicalization
    happens on the model side. We only fold whitespace + trivial variants.
    Never returns None; a blank input is caught by the caller."""
    return smiles.strip()


def _cache_get(endpoint: str, canon: str) -> dict[str, Any] | None:
    global _CACHE_HITS, _CACHE_MISSES
    key = (endpoint, canon)
    with _CACHE_LOCK:
        v = _CACHE.get(key)
        if v is None:
            _CACHE_MISSES += 1
            return None
        # Move to end → LRU touch.
        _CACHE.move_to_end(key)
        _CACHE_HITS += 1
        # Return a shallow copy so a downstream `sanitize` mutation doesn't
        # corrupt the cached entry for the next caller.
        return dict(v)


def _cache_put(endpoint: str, canon: str, res: dict[str, Any]) -> None:
    # Only cache successful ML predictions — never cache unavailable/error
    # envelopes, because the sidecar might come back online next call and
    # we don't want to lock ourselves into a stale failure state.
    if res.get("source") != "ml" or not res.get("ml_available"):
        return
    key = (endpoint, canon)
    with _CACHE_LOCK:
        _CACHE[key] = dict(res)
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_MAX:
            _CACHE.popitem(last=False)


def cache_stats() -> dict[str, Any]:
    """Surface cache utilisation on the /predict/ersilia/status route."""
    with _CACHE_LOCK:
        return {
            "size": len(_CACHE),
            "max": _CACHE_MAX,
            "hits": _CACHE_HITS,
            "misses": _CACHE_MISSES,
            "hit_rate": (
                round(_CACHE_HITS / (_CACHE_HITS + _CACHE_MISSES), 3)
                if (_CACHE_HITS + _CACHE_MISSES)
                else 0.0
            ),
        }


_VALID_MODES = ("off", "local", "client")

# Static descriptive metadata for the endpoints the L1 layer can consume. The
# eos model id itself is supplied via config; this only enriches the model_card
# so the UI/audit log can show what the prediction MEANS and where it comes from.
ENDPOINT_INFO: dict[str, dict[str, str]] = {
    "cytotoxicity": {
        "name": "General cytotoxicity (cell viability / CC50)",
        "about": "Predicted intrinsic cytotoxicity against human cell lines — the in-vitro readout behind the therapeutic-index safety window.",
        "catalog": "https://catalog.ersilia.io (filter: cytotoxicity / cell viability)",
    },
    "hepatotoxicity": {
        "name": "Hepatotoxicity",
        "about": "Predicted liver-injury liability — orthogonal corroboration of the DILI head.",
        "catalog": "https://catalog.ersilia.io (filter: hepatotoxicity / DILI)",
    },
    "ames": {
        "name": "Ames mutagenicity",
        "about": "Bacterial reverse-mutation (genotoxicity) probability.",
        "catalog": "https://catalog.ersilia.io (filter: mutagenicity / Ames)",
    },
    "herg": {
        "name": "hERG cardiac liability",
        "about": "IKr (hERG) channel block probability — torsadogenic / QT risk.",
        "catalog": "https://catalog.ersilia.io (filter: hERG / cardiotoxicity)",
    },
    "solubility": {
        "name": "Aqueous solubility",
        "about": "Kinetic/thermodynamic aqueous solubility (logS).",
        "catalog": "https://catalog.ersilia.io (filter: solubility)",
    },
    # (pgp_substrate, bsep_inhibition, pampa, phospholipidosis) moved to
    # ADMETlab 3.0 — see models/admetlab.py. This adapter still backs the
    # `cytotoxicity` endpoint (an independent path used by the CC50 signal).
}

_LICENSE = "Model licenses vary per Ersilia catalog entry (mostly permissive / GPL-compatible). Framework: GPLv3 (Ersilia Open Source Initiative)."


def _env_json(name: str) -> dict[str, Any]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return {}
    try:
        val = json.loads(raw)
        return val if isinstance(val, dict) else {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("ersilia_hub: %s is not valid JSON (%s) — ignoring.", name, exc)
        return {}


MODE = os.environ.get("HAKASE_ERSILIA_MODE", "off").strip().lower()
if MODE not in _VALID_MODES:
    logger.warning("ersilia_hub: HAKASE_ERSILIA_MODE=%r invalid; defaulting to 'off'.", MODE)
    MODE = "off"

_MODELS = _env_json("HAKASE_ERSILIA_MODELS")  # endpoint -> eos id
_URLS = _env_json("HAKASE_ERSILIA_URLS")  # endpoint -> served url (client mode)
_OUTPUT = _env_json("HAKASE_ERSILIA_OUTPUT")  # endpoint -> {"kind","key"}

_served: dict[str, Any] = {}  # eos id -> served ErsiliaModel (local mode)
_serve_lock = threading.Lock()


def _model_id_for(endpoint: str) -> str | None:
    mid = (_MODELS.get(endpoint) or "").strip()
    if not mid:
        return None
    if not _EOS_RE.match(mid):
        logger.warning(
            "ersilia_hub: model id %r for endpoint %r is not a valid eos id; ignoring.",
            mid,
            endpoint,
        )
        return None
    return mid


def _extract_value(raw: Any, endpoint: str) -> tuple[float | None, str]:
    """Best-effort scalar extraction from an Ersilia model output.

    Honours an explicit HAKASE_ERSILIA_OUTPUT hint (key + kind) when present;
    otherwise returns the first finite numeric leaf with kind="raw". Returns
    (None, "raw") when nothing numeric is found — never invents a value.
    """
    hint = _OUTPUT.get(endpoint) or {}
    want_key = hint.get("key")
    kind = hint.get("kind", "raw")

    def first_number(obj: Any) -> float | None:
        if isinstance(obj, (int, float)) and not isinstance(obj, bool):
            v = float(obj)
            return v if v == v and v not in (float("inf"), float("-inf")) else None
        if isinstance(obj, dict):
            if want_key and want_key in obj:
                return first_number(obj[want_key])
            for v in obj.values():
                n = first_number(v)
                if n is not None:
                    return n
        if isinstance(obj, (list, tuple)):
            for v in obj:
                n = first_number(v)
                if n is not None:
                    return n
        return None

    return first_number(raw), kind


def _run_local(model_id: str, smiles: str) -> Any:
    import csv
    import tempfile

    mdl = _served.get(model_id)
    if mdl is None:
        with _serve_lock:
            mdl = _served.get(model_id)
            if mdl is None:
                from ersilia import ErsiliaModel  # lazy import — only on worker

                mdl = ErsiliaModel(model_id)
                mdl.serve()
                _served[model_id] = mdl

    # Use file-based I/O to bypass PyPI Ersilia packaging bugs
    fd_in, temp_input = tempfile.mkstemp(suffix=".csv")
    os.close(fd_in)
    try:
        with open(temp_input, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["smiles"])
            writer.writerow([smiles])

        fd_out, temp_output = tempfile.mkstemp(suffix=".json")
        os.close(fd_out)
        try:
            os.remove(temp_output)
            mdl.run(input=temp_input, output=temp_output)
            with open(temp_output) as f:
                return json.load(f)
        finally:
            if os.path.exists(temp_output):
                os.remove(temp_output)
    finally:
        if os.path.exists(temp_input):
            os.remove(temp_input)


def _run_client(url: str, smiles: str) -> Any:
    """Talk to an already-served Ersilia model over HTTP with retries.

    Direct HTTP against the Ersilia sidecar's `/run` endpoint. We use `httpx`
    (already in the ai-service deps) rather than the `ersilia_client` package
    because httpx exposes per-request timeouts and connection pooling and
    doesn't pull the Docker SDK. On retryable failure (network error, 5xx,
    timeout) we retry with exponential backoff. On the last attempt we raise
    with the underlying exception so the caller stamps `ERR_HTTP` or
    `ERR_TIMEOUT` on the envelope AND logs it.
    """
    import httpx  # lazy import — keeps import time low on cold start

    last_exc: Exception | None = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
                r = client.post(
                    url.rstrip("/") + "/run",
                    json={"input": smiles},
                    headers={"Content-Type": "application/json"},
                )
                r.raise_for_status()
                return r.json()
        except httpx.TimeoutException as exc:
            last_exc = exc
            logger.warning(
                "ersilia_hub: TIMEOUT on %s (attempt %d/%d): %s",
                url,
                attempt,
                RETRY_ATTEMPTS,
                exc,
            )
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_exc = exc
            logger.warning(
                "ersilia_hub: HTTP error on %s (attempt %d/%d): %s",
                url,
                attempt,
                RETRY_ATTEMPTS,
                exc,
            )
        except Exception as exc:  # noqa: BLE001 — any other failure is worth retrying once
            last_exc = exc
            logger.warning(
                "ersilia_hub: unexpected error on %s (attempt %d/%d): %s",
                url,
                attempt,
                RETRY_ATTEMPTS,
                exc,
            )
        # Only sleep if we still have retries left.
        if attempt <= len(RETRY_BACKOFF_S):
            time.sleep(RETRY_BACKOFF_S[attempt - 1])
    # All attempts exhausted — re-raise the last exception so the caller
    # can classify it (Timeout vs HTTP vs other) and stamp the envelope.
    assert last_exc is not None
    raise last_exc


def predict_ersilia(endpoint: str, smiles: str) -> dict[str, Any]:
    """Run a configured Ersilia model for an L1 endpoint.

    Contract
    --------
    * Never fabricates a number. Any failure returns
      ``source="unavailable"`` with a structured ``error_reason`` (see the
      ``ERR_*`` constants near the top of this module) and a human message
      on ``error``. The reason is what the frontend sidecar-health pill and
      the ops dashboard filter on.
    * Every failure path also LOG.error()s or LOG.warning()s so the
      ai-service container's stderr carries the full context.
    * Successful ML results are memoized per (endpoint, canonical SMILES)
      in an LRU cache so repeat lookups inside a session are 0 ms.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    smiles = _canon_smiles(smiles)
    info = ENDPOINT_INFO.get(
        endpoint, {"name": endpoint, "about": "", "catalog": "https://catalog.ersilia.io"}
    )
    model_id = _model_id_for(endpoint)

    card = {
        "engine": "Ersilia Model Hub",
        "endpoint": endpoint,
        "name": info.get("name", endpoint),
        "about": info.get("about", ""),
        "catalog": info.get("catalog"),
        "license": _LICENSE,
        "reference": "https://ersilia.io",
        "mode": MODE,
        "model_id": model_id,
    }

    def unavailable(reason: str, msg: str) -> dict[str, Any]:
        # Loud logging so the source of an "unavailable" is never a mystery.
        logger.warning(
            "ersilia_hub: unavailable endpoint=%s reason=%s model_id=%s msg=%s",
            endpoint,
            reason,
            model_id,
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
            "model_id": model_id,
            "model_card": card,
            "error_reason": reason,
            "error": msg,
        }

    # ── Fast paths that don't touch the sidecar ────────────────────────────
    if MODE == "off":
        return unavailable(
            ERR_MODE_OFF, "Ersilia integration disabled (set HAKASE_ERSILIA_MODE=local|client)."
        )
    if not model_id:
        return unavailable(
            ERR_MODEL_UNSET,
            f"No Ersilia model configured for '{endpoint}' — set HAKASE_ERSILIA_MODELS "
            f"and pick an eos id from {info.get('catalog')}.",
        )
    if MODE == "client":
        url = (_URLS.get(endpoint) or "").strip()
        if not url:
            return unavailable(
                ERR_URL_UNSET,
                f"Client mode but no URL set for '{endpoint}' — populate HAKASE_ERSILIA_URLS.",
            )

    # ── Cache lookup ──────────────────────────────────────────────────────
    cached = _cache_get(endpoint, smiles)
    if cached is not None:
        return cached

    # ── Sidecar call (with retries in _run_client) ────────────────────────
    try:
        if MODE == "local":
            raw = _run_local(model_id, smiles)
        else:
            raw = _run_client((_URLS.get(endpoint) or "").strip(), smiles)
    except ModuleNotFoundError as exc:
        return unavailable(
            ERR_ERSILIA_MISSING,
            f"Ersilia not installed on this host ({exc}). Install on the worker: "
            f"pip install ersilia (mode=local) or add httpx (mode=client).",
        )
    except TimeoutError as exc:
        logger.error(
            "ersilia_hub: TIMEOUT after all retries endpoint=%s model_id=%s: %s",
            endpoint,
            model_id,
            exc,
        )
        return unavailable(
            ERR_TIMEOUT,
            f"Ersilia sidecar timed out after {RETRY_ATTEMPTS} attempts "
            f"(timeout={HTTP_TIMEOUT_S}s).",
        )
    except Exception as exc:  # noqa: BLE001
        # httpx.TimeoutException doesn't subclass TimeoutError, so classify by name.
        name = type(exc).__name__
        if "Timeout" in name:
            reason = ERR_TIMEOUT
        else:
            reason = ERR_HTTP
        logger.error(
            "ersilia_hub: %s endpoint=%s model_id=%s: %s: %s", reason, endpoint, model_id, name, exc
        )
        return unavailable(reason, f"Ersilia sidecar call failed: {name}: {exc}")

    # ── Response shape check ──────────────────────────────────────────────
    if raw is None:
        return unavailable(ERR_INVALID_RESPONSE, "Sidecar returned no body.")

    value, kind = _extract_value(raw, endpoint)
    if value is None:
        return {
            **unavailable(
                ERR_NO_VALUE, "Model ran but returned no numeric leaf for this molecule."
            ),
            "raw": raw,
        }

    result = {
        "smiles": smiles,
        "endpoint": endpoint,
        "source": "ml",
        "ml_available": True,
        "value": value,
        "value_kind": kind,
        "raw": raw,
        "model_id": model_id,
        "model_card": card,
        "error_reason": None,
        "error": None,
    }
    _cache_put(endpoint, smiles, result)
    return result


def predict_cytotoxicity(smiles: str) -> dict[str, Any]:
    """Cytotoxicity convenience wrapper.

    Returns the standard Ersilia contract plus a derived ``cc50_uM`` when the
    configured model's declared output kind is a concentration; otherwise
    ``cc50_uM`` is None and the raw ``value``/``value_kind`` carry the signal
    (e.g. an active-probability). The L1 engine only consumes ``cc50_uM`` when
    present, so an unconfigured/ambiguous model never injects a fake number.
    """
    res = predict_ersilia("cytotoxicity", smiles)
    cc50 = None
    if res.get("source") == "ml" and isinstance(res.get("value"), (int, float)):
        kind = res.get("value_kind")
        if kind == "cc50_uM":
            cc50 = float(res["value"])
        elif kind == "ic50_uM":
            cc50 = float(res["value"])
    res["cc50_uM"] = cc50
    return res


def is_ready() -> dict[str, Any]:
    """Report Ersilia integration state — mode, installed deps, per-endpoint
    liveness, cache stats.

    Liveness is a real ping (HTTP HEAD against `/` on each sidecar URL, 2 s
    timeout). This is what the frontend header pill polls to decide whether
    to render the "ML-enriched" verdict badge (hybrid policy — see the L1
    verdict banner).
    """
    try:
        import importlib.util as _u

        ersilia_installed = _u.find_spec("ersilia") is not None or _u.find_spec("httpx") is not None
    except Exception:  # noqa: BLE001
        ersilia_installed = False
    configured = {ep: _model_id_for(ep) for ep in ENDPOINT_INFO if _model_id_for(ep)}

    # Per-endpoint liveness probe (client mode only). Local mode reports
    # `served` based on the in-process `_served` dict populated by
    # `_run_local` / `warmup()`.
    endpoints: dict[str, dict[str, Any]] = {}
    for ep in ENDPOINT_INFO:
        mid = _model_id_for(ep)
        url = (_URLS.get(ep) or "").strip() if MODE == "client" else None
        entry: dict[str, Any] = {
            "model_id": mid,
            "url": url,
            "state": "not-configured",
            "reason": None,
        }
        if MODE == "off":
            entry["state"] = "off"
            entry["reason"] = ERR_MODE_OFF
        elif not mid:
            entry["state"] = "not-configured"
            entry["reason"] = ERR_MODEL_UNSET
        elif MODE == "local":
            entry["state"] = "served" if mid in _served else "not-served"
        else:  # client mode — ping the sidecar
            if not url:
                entry["state"] = "not-configured"
                entry["reason"] = ERR_URL_UNSET
            else:
                try:
                    import httpx

                    with httpx.Client(timeout=2.0) as client:
                        r = client.get(url.rstrip("/") + "/")
                    entry["state"] = "live" if r.status_code < 500 else "unhealthy"
                    if r.status_code >= 500:
                        entry["reason"] = f"HTTP {r.status_code}"
                except Exception as exc:  # noqa: BLE001
                    entry["state"] = "unreachable"
                    entry["reason"] = f"{type(exc).__name__}: {exc}"
        endpoints[ep] = entry

    live_count = sum(1 for e in endpoints.values() if e["state"] in ("live", "served"))
    configured_count = sum(1 for e in endpoints.values() if e["model_id"])

    return {
        "mode": MODE,
        "ersilia_installed": ersilia_installed,
        "configured_endpoints": configured,
        "active": MODE != "off" and bool(configured),
        "catalog": "https://catalog.ersilia.io",
        "endpoints": endpoints,
        "live_count": live_count,
        "configured_count": configured_count,
        "all_live": configured_count > 0 and live_count == configured_count,
        "cache": cache_stats(),
        "retry_policy": {
            "attempts": RETRY_ATTEMPTS,
            "backoff_s": list(RETRY_BACKOFF_S),
            "timeout_s": HTTP_TIMEOUT_S,
        },
    }


def warmup() -> dict[str, Any]:
    """Pre-serve / prime all configured Ersilia models.

    * ``local`` mode: calls each `ErsiliaModel.serve()` and runs a cheap CCO
      inference so weights load into RSS.
    * ``client`` mode: fires a parallel HTTP `POST /run` with CCO against each
      sidecar so their internal model-load latency is paid at ai-service
      startup rather than by the first user. Falls back gracefully if a
      sidecar isn't up yet — the FastAPI lifespan retries on demand.

    Best-effort; NEVER raises. Every failure is logged. Result carries per-
    endpoint timing so the ops dashboard can spot slow-loading models.
    """
    if MODE == "off":
        return {"status": "skipped", "reason": "HAKASE_ERSILIA_MODE=off", **is_ready()}

    endpoints_to_warm = [(ep, _model_id_for(ep)) for ep in ENDPOINT_INFO if _model_id_for(ep)]
    timings: dict[str, dict[str, Any]] = {}

    if MODE == "local":
        for ep, mid in endpoints_to_warm:
            if mid in _served:
                timings[ep] = {"model_id": mid, "state": "already-served", "took_s": 0.0}
                continue
            t0 = time.time()
            try:
                _run_local(mid, "CCO")
                timings[ep] = {
                    "model_id": mid,
                    "state": "warmed",
                    "took_s": round(time.time() - t0, 2),
                }
            except Exception as exc:  # noqa: BLE001
                logger.error("ersilia_hub: local warmup FAILED for %s/%s: %s", ep, mid, exc)
                timings[ep] = {
                    "model_id": mid,
                    "state": "failed",
                    "took_s": round(time.time() - t0, 2),
                    "error": f"{type(exc).__name__}: {exc}",
                }
        return {"status": "ok", "timings": timings, **is_ready()}

    # ── client mode: parallel warmup ───────────────────────────────────────
    # Uses a thread pool because each POST spends ~1–5 s waiting on the
    # sidecar's in-container model load. Parallel keeps total warmup
    # bounded by max() rather than sum() — matters when 4 sidecars are
    # cold-starting simultaneously.
    from concurrent.futures import ThreadPoolExecutor

    def _one(ep: str, mid: str) -> tuple[str, dict[str, Any]]:
        url = (_URLS.get(ep) or "").strip()
        if not url:
            logger.error("ersilia_hub: no URL configured for %s/%s during warmup", ep, mid)
            return ep, {"model_id": mid, "state": "no-url", "took_s": 0.0}
        t0 = time.time()
        try:
            _run_client(url, "CCO")
            elapsed = round(time.time() - t0, 2)
            logger.info("ersilia_hub: warmup OK ep=%s model=%s took=%ss", ep, mid, elapsed)
            return ep, {"model_id": mid, "state": "warmed", "took_s": elapsed}
        except Exception as exc:  # noqa: BLE001
            elapsed = round(time.time() - t0, 2)
            logger.error(
                "ersilia_hub: client warmup FAILED for %s/%s after %ss: %s", ep, mid, elapsed, exc
            )
            return ep, {
                "model_id": mid,
                "state": "failed",
                "took_s": elapsed,
                "error": f"{type(exc).__name__}: {exc}",
            }

    with ThreadPoolExecutor(max_workers=min(8, max(1, len(endpoints_to_warm)))) as pool:
        for ep, entry in pool.map(lambda t: _one(*t), endpoints_to_warm):
            timings[ep] = entry

    return {"status": "ok", "timings": timings, **is_ready()}
