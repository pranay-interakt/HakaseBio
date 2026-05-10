"""RunPod Serverless entry point for the HakaseAI FEP worker.

Receives a job event from RunPod, runs relative-binding-FEP via TIES-MD on
the local GPU, and returns the strict 8-field payload defined in the
upstream contract (`artifacts/ai-service/models/fep_runpod.py`).

Honesty contract (project-wide):
- NO fabricated ΔΔG. If TIES fails or required outputs are missing, raise
  with the exact reason — no surrogate values, no MM-PBSA fallback.
- NO defaults for required output fields. Either we have a real number
  from TIES or the job fails.
"""

from __future__ import annotations

import os
import sys
import time
import traceback
from typing import Any

import runpod

from ties_runner import (
    TiesRunError,
    TiesInput,
    run_relative_binding_fep,
)


# ---------------------------------------------------------------------------
# Input validation — fail fast on the worker side too. The upstream server
# already validates, but defence-in-depth keeps us honest if anyone calls the
# endpoint directly with malformed input.
# ---------------------------------------------------------------------------

REQUIRED_INPUT = ("ligand_a_smiles", "ligand_b_smiles", "pdb_id")
DEFAULTS = {
    "n_lambda_windows": 12,
    "n_replicas":       3,
    "ns_per_window":    5.0,
}


def _validate_input(payload: dict[str, Any]) -> TiesInput:
    if not isinstance(payload, dict):
        raise ValueError(f"input must be an object, got {type(payload).__name__}")
    missing = [k for k in REQUIRED_INPUT if not payload.get(k)]
    if missing:
        raise ValueError(f"missing required input fields: {missing}")
    pdb_id = str(payload["pdb_id"]).strip().upper()
    if len(pdb_id) != 4 or not pdb_id.isalnum():
        raise ValueError(f"pdb_id must be a 4-char alphanumeric RCSB ID, got {pdb_id!r}")

    # Optional fields: distinguish "missing" (use default) from "explicitly
    # provided" (validate, never silently coerce 0/false-y values to default).
    def _opt_num(key: str, cast):
        if key not in payload or payload[key] is None:
            return cast(DEFAULTS[key])
        try:
            return cast(payload[key])
        except (TypeError, ValueError) as e:
            raise ValueError(f"{key} must be a {cast.__name__}, got {payload[key]!r}") from e

    n_lambda      = _opt_num("n_lambda_windows", int)
    n_replicas    = _opt_num("n_replicas",       int)
    ns_per_window = _opt_num("ns_per_window",    float)
    if not (3 <= n_lambda <= 32):
        raise ValueError(f"n_lambda_windows must be 3..32, got {n_lambda}")
    if not (1 <= n_replicas <= 5):
        raise ValueError(f"n_replicas must be 1..5, got {n_replicas}")
    if not (0.5 <= ns_per_window <= 50.0):
        raise ValueError(f"ns_per_window must be 0.5..50.0, got {ns_per_window}")
    return TiesInput(
        ligand_a_smiles=str(payload["ligand_a_smiles"]).strip(),
        ligand_b_smiles=str(payload["ligand_b_smiles"]).strip(),
        pdb_id=pdb_id,
        n_lambda_windows=n_lambda,
        n_replicas=n_replicas,
        ns_per_window=ns_per_window,
    )


# ---------------------------------------------------------------------------
# RunPod handler
# ---------------------------------------------------------------------------

def handler(event: dict[str, Any]) -> dict[str, Any]:
    """RunPod calls this with `{"input": {...}}`. Return the JSON the upstream
    `fep_runpod._store_result` expects. Raising propagates as a job-level error
    surfaced to the upstream poll as `status: FAILED`."""
    t0 = time.time()
    payload = event.get("input") or {}
    # Per project policy: errors propagate VERBATIM — no message rewriting,
    # no class substitution. The upstream `fep_runpod._run_job` surfaces the
    # raw text directly to the user. Only truly unexpected exceptions get an
    # appended traceback tail (the original message is preserved in full).
    ti = _validate_input(payload)  # ValueError propagates as-is
    try:
        result = run_relative_binding_fep(ti)
    except TiesRunError:
        # Honest failure from TIES — re-raise unchanged. The class name +
        # exact message reach the upstream poll verbatim.
        raise
    except Exception as e:
        tb = "".join(traceback.format_exception(type(e), e, e.__traceback__))[-1500:]
        # Preserve the original message and class name verbatim; only
        # APPEND the traceback tail for debuggability.
        raise type(e)(f"{e}\n--- tb tail ---\n{tb}") from e

    wallclock_min = (time.time() - t0) / 60.0
    # Per-project policy: every required field must be present. We assert here
    # so a buggy ties_runner can't silently emit an incomplete payload.
    required = (
        "ddg_kcal_mol", "ddg_uncertainty_kcalmol", "ddg_kT",
        "windows", "gpu_minutes", "engine_version", "force_field",
    )
    missing = [k for k in required if k not in result]
    if missing:
        raise RuntimeError(f"ties_runner returned incomplete result, missing: {missing}")

    # We override wallclock_minutes from the actual handler measurement —
    # the runner's own estimate may not include conda/import overhead.
    result["wallclock_minutes"] = round(wallclock_min, 2)
    result.setdefault("warnings", [])
    return result


# ---------------------------------------------------------------------------
# Local smoke test (RUNPOD_TEST=1) — runs a tiny in-tree input so you can
# verify the chemistry stack inside ~20 min on an H100 before flipping the
# endpoint live in production.
# ---------------------------------------------------------------------------

def _smoke_test() -> int:
    print("[smoke] RUNPOD_TEST=1 — running tiny FEP on 1HVR (HIV protease)...", flush=True)
    test_event = {
        "input": {
            # Two minor analogues — both bind HIV-1 protease.
            "ligand_a_smiles":  "CC(C)NC(=O)C(NC(=O)c1ccccc1)Cc1ccccc1",
            "ligand_b_smiles":  "CC(C)NC(=O)C(NC(=O)c1ccc(F)cc1)Cc1ccccc1",
            "pdb_id":           "1HVR",
            "n_lambda_windows": 3,
            "n_replicas":       1,
            "ns_per_window":    2.0,
        }
    }
    try:
        out = handler(test_event)
    except Exception as e:
        print(f"[smoke] FAILED: {e}", flush=True)
        return 1
    print(f"[smoke] OK  ddg={out['ddg_kcal_mol']:.3f} ± {out['ddg_uncertainty_kcalmol']:.3f} kcal/mol", flush=True)
    print(f"[smoke] engine: {out['engine_version']}", flush=True)
    print(f"[smoke] wallclock: {out['wallclock_minutes']:.1f} min  gpu: {out['gpu_minutes']:.1f} min", flush=True)
    return 0


if __name__ == "__main__":
    if os.environ.get("RUNPOD_TEST") == "1":
        sys.exit(_smoke_test())
    # Production: hand control to the RunPod serverless event loop.
    runpod.serverless.start({"handler": handler})
