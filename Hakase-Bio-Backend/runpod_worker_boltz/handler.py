"""RunPod Serverless entry point for the HakaseAI Boltz-2 co-folding worker.

Receives a job event from RunPod, runs Boltz-2 biomolecular co-folding (and,
when requested, the binding-affinity head) on the local GPU, and returns the
strict JSON payload defined in the upstream contract
(`artifacts/ai-service/models/cofolding.py`).

Honesty contract (project-wide):
- NO fabricated structures, confidence, or affinity. If Boltz fails or a
  required artifact is missing, raise with the exact reason.
- NO silent CPU fallback — Boltz-2 on CPU is not a real result.
- NO defaults for required output fields.

The upstream server (`cofolding.py`) builds and validates the Boltz YAML
BEFORE this worker is ever invoked, so a paid GPU is never spent on an input
that was going to be rejected anyway.
"""

from __future__ import annotations

import os
import sys
import time
import traceback
from typing import Any

import runpod

from boltz_runner import BoltzInput, BoltzRunError, run_cofolding


REQUIRED_INPUT = ("boltz_yaml",)


def _validate_input(payload: dict[str, Any]) -> BoltzInput:
    """Defence-in-depth validation. The upstream already validated the design;
    this guards against malformed direct calls to the endpoint."""
    if not isinstance(payload, dict):
        raise ValueError(f"input must be an object, got {type(payload).__name__}")
    missing = [k for k in REQUIRED_INPUT if not payload.get(k)]
    if missing:
        raise ValueError(f"missing required input fields: {missing}")

    yaml_text = str(payload["boltz_yaml"])
    if "sequences:" not in yaml_text:
        raise ValueError("boltz_yaml does not contain a 'sequences:' block — not a valid Boltz input")

    def _int(key: str, default: int, lo: int, hi: int) -> int:
        if key not in payload or payload[key] is None:
            return default
        try:
            v = int(payload[key])
        except (TypeError, ValueError) as e:
            raise ValueError(f"{key} must be an integer, got {payload[key]!r}") from e
        if not (lo <= v <= hi):
            raise ValueError(f"{key} must be in [{lo}, {hi}], got {v}")
        return v

    def _bool(key: str, default: bool) -> bool:
        if key not in payload or payload[key] is None:
            return default
        return bool(payload[key])

    output_format = str(payload.get("output_format") or "mmcif").lower()
    if output_format not in ("mmcif", "pdb"):
        raise ValueError(f"output_format must be 'mmcif' or 'pdb', got {output_format!r}")

    def _float(key: str, default: float, lo: float, hi: float) -> float:
        if key not in payload or payload[key] is None:
            return default
        try:
            v = float(payload[key])
        except (TypeError, ValueError) as e:
            raise ValueError(f"{key} must be a float, got {payload[key]!r}") from e
        if not (lo <= v <= hi):
            raise ValueError(f"{key} must be in [{lo}, {hi}], got {v}")
        return v

    return BoltzInput(
        yaml_text=yaml_text,
        job_name=str(payload.get("job_name") or "cofold"),
        # Structure diffusion
        diffusion_samples=_int("diffusion_samples", 1, 1, 25),
        recycling_steps=_int("recycling_steps", 3, 1, 10),
        sampling_steps=_int("sampling_steps", 200, 25, 1000),
        step_scale=_float("step_scale", 1.638, 0.5, 3.0),
        max_parallel_samples=_int("max_parallel_samples", 5, 1, 25),
        # MSA
        use_msa_server=_bool("use_msa_server", True),
        msa_server_url=str(payload.get("msa_server_url") or "https://api.colabfold.com"),
        max_msa_seqs=_int("max_msa_seqs", 8192, 32, 65536),
        subsample_msa=_bool("subsample_msa", False),
        num_subsampled_msa=_int("num_subsampled_msa", 1024, 32, 8192),
        # Physics / kernels
        use_potentials=_bool("use_potentials", False),
        no_kernels=_bool("no_kernels", False),
        # Output
        output_format=output_format,
        write_full_pae=_bool("write_full_pae", False),
        write_full_pde=_bool("write_full_pde", False),
        max_pae_dim=_int("max_pae_dim", 600, 64, 2000),
        # Affinity
        affinity_requested=_bool("affinity_requested", False),
        affinity_binder_type=str(payload.get("affinity_binder_type") or "ligand"),
        affinity_mw_correction=_bool("affinity_mw_correction", False),
        sampling_steps_affinity=_int("sampling_steps_affinity", 200, 25, 1000),
        diffusion_samples_affinity=_int("diffusion_samples_affinity", 5, 1, 25),
    )


def handler(event: dict[str, Any]) -> dict[str, Any]:
    """RunPod calls this with `{"input": {...}}`. Returns the JSON the upstream
    `cofolding._store_result` expects. Raising propagates as `status: FAILED`."""
    t0 = time.time()
    payload = event.get("input") or {}
    bi = _validate_input(payload)  # ValueError propagates verbatim

    try:
        result = run_cofolding(bi)
    except BoltzRunError:
        # Honest failure from Boltz — re-raise unchanged so the exact message
        # reaches the upstream poll and the user.
        raise
    except Exception as e:  # noqa: BLE001
        tb = "".join(traceback.format_exception(type(e), e, e.__traceback__))[-1800:]
        raise type(e)(f"{e}\n--- tb tail ---\n{tb}") from e

    # Every required field must be present — a buggy runner cannot emit a
    # silently-incomplete payload.
    required = ("structure", "structure_format", "confidence", "boltz_version", "engine")
    miss = [k for k in required if k not in result]
    if miss:
        raise RuntimeError(f"boltz_runner returned incomplete result, missing: {miss}")

    result["handler_wallclock_seconds"] = round(time.time() - t0, 1)
    result.setdefault("warnings", [])
    return result


# ---------------------------------------------------------------------------
# Local smoke test (RUNPOD_TEST=1) — a tiny peptide↔protein co-fold so you can
# verify the GPU + Boltz stack for a few cents before going live.
# ---------------------------------------------------------------------------

_SMOKE_YAML = """\
version: 1
sequences:
  - protein:
      id: A
      sequence: MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKR
      msa: empty
  - protein:
      id: B
      sequence: GSGSGSWFKAGSGS
      msa: empty
"""


def _smoke_test() -> int:
    print("[smoke] RUNPOD_TEST=1 — tiny peptide↔protein co-fold (single-sequence)...", flush=True)
    event = {
        "input": {
            "boltz_yaml": _SMOKE_YAML,
            "diffusion_samples": 1,
            "recycling_steps": 1,
            "sampling_steps": 50,
            "use_msa_server": False,
        }
    }
    try:
        out = handler(event)
    except Exception as e:  # noqa: BLE001
        print(f"[smoke] FAILED: {e}", flush=True)
        return 1
    conf = out.get("confidence") or {}
    print(f"[smoke] OK  engine={out['engine']}  gpu={out.get('gpu_name')}", flush=True)
    print(f"[smoke] chains={out.get('n_chains')} residues={out.get('n_residues_modeled')} "
          f"ptm={conf.get('ptm')} iptm={conf.get('iptm')}", flush=True)
    print(f"[smoke] wallclock={out.get('wallclock_seconds')}s", flush=True)
    return 0


if __name__ == "__main__":
    if os.environ.get("RUNPOD_TEST") == "1":
        sys.exit(_smoke_test())
    runpod.serverless.start({"handler": handler})
