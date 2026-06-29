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
from typing import Any

logger = logging.getLogger(__name__)

_EOS_RE = re.compile(r"^eos[1-9][a-z0-9]{3}$")
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

_MODELS = _env_json("HAKASE_ERSILIA_MODELS")   # endpoint -> eos id
_URLS = _env_json("HAKASE_ERSILIA_URLS")       # endpoint -> served url (client mode)
_OUTPUT = _env_json("HAKASE_ERSILIA_OUTPUT")   # endpoint -> {"kind","key"}

_served: dict[str, Any] = {}                   # eos id -> served ErsiliaModel (local mode)
_serve_lock = threading.Lock()


def _model_id_for(endpoint: str) -> str | None:
    mid = (_MODELS.get(endpoint) or "").strip()
    if not mid:
        return None
    if not _EOS_RE.match(mid):
        logger.warning("ersilia_hub: model id %r for endpoint %r is not a valid eos id; ignoring.", mid, endpoint)
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
    import tempfile
    import csv
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
            with open(temp_output, "r") as f:
                return json.load(f)
        finally:
            if os.path.exists(temp_output):
                os.remove(temp_output)
    finally:
        if os.path.exists(temp_input):
            os.remove(temp_input)


def _run_client(url: str, smiles: str) -> Any:
    from ersilia_client import ErsiliaClient  # lazy import
    return ErsiliaClient(url=url).run([smiles])


def predict_ersilia(endpoint: str, smiles: str) -> dict[str, Any]:
    """Run a configured Ersilia model for an L1 endpoint. Never fabricates."""
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    smiles = smiles.strip()
    info = ENDPOINT_INFO.get(endpoint, {"name": endpoint, "about": "", "catalog": "https://catalog.ersilia.io"})
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

    def unavailable(msg: str) -> dict[str, Any]:
        return {"smiles": smiles, "endpoint": endpoint, "source": "unavailable",
                "ml_available": False, "value": None, "value_kind": "raw",
                "raw": None, "model_id": model_id, "model_card": card, "error": msg}

    if MODE == "off":
        return unavailable("Ersilia integration disabled (set HAKASE_ERSILIA_MODE=local|client).")
    if not model_id:
        return unavailable(f"No Ersilia model configured for '{endpoint}' — set HAKASE_ERSILIA_MODELS and pick an eos id from {info.get('catalog')}.")

    try:
        raw = _run_local(model_id, smiles) if MODE == "local" else _run_client((_URLS.get(endpoint) or "").strip(), smiles)
    except ModuleNotFoundError as exc:
        return unavailable(f"Ersilia not installed on this host ({exc}). Install on the worker: pip install ersilia (mode=local) or ersilia-client (mode=client).")
    except Exception as exc:  # noqa: BLE001 — any serve/run failure → honest unavailable
        logger.exception("ersilia_hub: run failed for %s/%s", endpoint, model_id)
        return unavailable(f"Ersilia run failed: {type(exc).__name__}: {exc}")

    value, kind = _extract_value(raw, endpoint)
    if value is None:
        return {**unavailable("Model returned no numeric value for this molecule."), "raw": raw}
    return {"smiles": smiles, "endpoint": endpoint, "source": "ml", "ml_available": True,
            "value": value, "value_kind": kind, "raw": raw, "model_id": model_id,
            "model_card": card, "error": None}


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
    try:
        import importlib.util as _u
        ersilia_installed = _u.find_spec("ersilia") is not None or _u.find_spec("ersilia_client") is not None
    except Exception:  # noqa: BLE001
        ersilia_installed = False
    configured = {ep: _model_id_for(ep) for ep in ENDPOINT_INFO if _model_id_for(ep)}
    return {
        "mode": MODE,
        "ersilia_installed": ersilia_installed,
        "configured_endpoints": configured,
        "active": MODE != "off" and bool(configured),
        "catalog": "https://catalog.ersilia.io",
    }


def warmup() -> dict[str, Any]:
    """Pre-serve configured models (local mode only). Best-effort; never raises."""
    if MODE != "local":
        return {"status": "skipped", **is_ready()}
    for ep in list(ENDPOINT_INFO):
        mid = _model_id_for(ep)
        if not mid or mid in _served:
            continue
        try:
            _run_local(mid, "CCO")  # cheap serve+run priming call
        except Exception as exc:  # noqa: BLE001
            logger.warning("ersilia_hub: warmup failed for %s/%s: %s", ep, mid, exc)
    return {"status": "ok", **is_ready()}
