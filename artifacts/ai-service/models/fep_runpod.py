"""Free-energy refinement (TIES relative-binding-FEP) via RunPod Serverless.

L2 Stage 5 — opt-in GPU job. Submits a relative-binding-FEP job (Ligand A → B
in a given PDB receptor) to a RunPod Serverless endpoint that runs the actual
OpenMM + OpenFF Sage + TIES protocol on an A100/H100. Worker container is
out-of-scope for this repo; this module only handles the dispatch / poll /
result-shape contract.

Strict project policy:
- NO fabricated ΔΔG. If RUNPOD_API_KEY or RUNPOD_FEP_ENDPOINT_ID is unset,
  any submission attempt raises and the UI surfaces the exact reason.
- NO silent fallback. RunPod errors propagate verbatim.

Worker I/O contract (the container the user provisions on RunPod must honour):
  Input  JSON: {
    "ligand_a_smiles":  str,   # reference ligand
    "ligand_b_smiles":  str,   # perturbed ligand
    "pdb_id":           str,   # 4-letter RCSB ID
    "n_lambda_windows": int,   # default 12
    "n_replicas":       int,   # default 3
    "ns_per_window":    float, # default 5.0
  }
  Output JSON: {
    "ddg_kcal_mol":            float,                 # ΔΔG (B - A)
    "ddg_uncertainty_kcalmol": float,                 # 1-sigma
    "ddg_kT":                  float,                 # ΔΔG / (k_B T) at 298 K
    "windows": [                                      # per-lambda-window data
       { "lambda": float, "dG_kcal_mol": float, "stderr_kcal_mol": float },
       ...
    ],
    "wallclock_minutes":       float,
    "gpu_minutes":             float,
    "engine_version":          str,                   # e.g. "OpenMM 8.1.1 + OpenFF Sage 2.2.0 + TIES-MD 1.7"
    "force_field":             str,                   # e.g. "openff-2.2.0"
    "warnings":                list[str],
  }

Job model: in-memory dict + ThreadPoolExecutor + Lock (same as docking_vina).
Restart wipes pending jobs (acceptable: each FEP run is a deliberate user
action and the RunPod-side job_id is recorded in the warning trail).
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, asdict
from typing import Optional

import requests


RUNPOD_BASE = "https://api.runpod.ai/v2"
RUNPOD_TIMEOUT_S = 30  # per-HTTP-call timeout (job runs in background on RunPod side)


def _env(key: str) -> Optional[str]:
    v = os.environ.get(key)
    if v is None or not v.strip():
        return None
    return v.strip()


def runpod_configured() -> tuple[bool, str]:
    """(is_configured, missing_reason). Used by the endpoint to refuse honestly."""
    if not _env("RUNPOD_API_KEY"):
        return False, "RUNPOD_API_KEY environment secret is not set"
    if not _env("RUNPOD_FEP_ENDPOINT_ID"):
        return False, "RUNPOD_FEP_ENDPOINT_ID environment secret is not set"
    return True, ""


# ---------------------------------------------------------------------------
# Job store
# ---------------------------------------------------------------------------

@dataclass
class FepJobResult:
    ddg_kcal_mol:            float
    ddg_uncertainty_kcalmol: float
    ddg_kT:                  float
    windows:                 list[dict]
    wallclock_minutes:       float
    gpu_minutes:             float
    engine_version:          str
    force_field:             str
    warnings:                list[str]
    runpod_job_id:           str


@dataclass
class FepJob:
    job_id:           str
    status:           str = "queued"   # queued | running | done | failed
    ligand_a_smiles:  str = ""
    ligand_b_smiles:  str = ""
    pdb_id:           str = ""
    started_at:       float = 0.0
    finished_at:      float = 0.0
    progress:         str = ""
    runpod_job_id:    Optional[str] = None
    result:           Optional[FepJobResult] = None
    error:            Optional[str] = None


_JOBS: dict[str, FepJob] = {}
_JOBS_LOCK = threading.Lock()
# Single worker — multiple in-flight $50 FEP jobs is a footgun.
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fep-runpod")


def _set(job_id: str, **fields):
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        for k, v in fields.items():
            setattr(job, k, v)


def get_job(job_id: str) -> Optional[dict]:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return None
        return {
            "job_id":          job.job_id,
            "status":          job.status,
            "ligand_a_smiles": job.ligand_a_smiles,
            "ligand_b_smiles": job.ligand_b_smiles,
            "pdb_id":          job.pdb_id,
            "progress":        job.progress,
            "started_at":      job.started_at,
            "finished_at":     job.finished_at,
            "runpod_job_id":   job.runpod_job_id,
            "error":           job.error,
            "result":          asdict(job.result) if job.result else None,
        }


def submit_fep(
    ligand_a_smiles:  str,
    ligand_b_smiles:  str,
    pdb_id:           str,
    n_lambda_windows: int = 12,
    n_replicas:       int = 3,
    ns_per_window:    float = 5.0,
) -> str:
    """Submit a relative-binding-FEP job. Raises if RunPod is not configured —
    the caller (FastAPI handler) translates that into a 503 with the exact reason."""
    ok, reason = runpod_configured()
    if not ok:
        raise RuntimeError(
            f"RunPod is not configured: {reason}. "
            f"Stage 5 free-energy refinement requires RunPod Serverless credentials. "
            f"Per project policy, no ΔΔG estimate is fabricated when the GPU backend is unavailable."
        )

    job_id = uuid.uuid4().hex[:12]
    job = FepJob(
        job_id=job_id,
        ligand_a_smiles=ligand_a_smiles,
        ligand_b_smiles=ligand_b_smiles,
        pdb_id=pdb_id.upper(),
    )
    with _JOBS_LOCK:
        _JOBS[job_id] = job
    _EXECUTOR.submit(
        _run_job, job_id,
        ligand_a_smiles, ligand_b_smiles, pdb_id.upper(),
        n_lambda_windows, n_replicas, ns_per_window,
    )
    return job_id


# ---------------------------------------------------------------------------
# Pipeline (RunPod Serverless dispatch + poll)
# ---------------------------------------------------------------------------

def _run_job(
    job_id: str,
    ligand_a_smiles: str,
    ligand_b_smiles: str,
    pdb_id: str,
    n_lambda_windows: int,
    n_replicas: int,
    ns_per_window: float,
):
    t0 = time.time()
    _set(job_id, status="running", started_at=t0, progress="submitting to RunPod")
    try:
        api_key     = _env("RUNPOD_API_KEY")
        endpoint_id = _env("RUNPOD_FEP_ENDPOINT_ID")
        # runpod_configured() was checked at submit_fep, but re-verify for thread safety
        if not api_key or not endpoint_id:
            raise RuntimeError("RunPod credentials disappeared between submit and dispatch")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
        }
        payload = {
            "input": {
                "ligand_a_smiles":  ligand_a_smiles,
                "ligand_b_smiles":  ligand_b_smiles,
                "pdb_id":           pdb_id,
                "n_lambda_windows": n_lambda_windows,
                "n_replicas":       n_replicas,
                "ns_per_window":    ns_per_window,
            }
        }

        # 1. Submit (async run)
        run_url = f"{RUNPOD_BASE}/{endpoint_id}/run"
        r = requests.post(run_url, headers=headers, json=payload, timeout=RUNPOD_TIMEOUT_S)
        if r.status_code != 200:
            raise RuntimeError(f"RunPod /run failed HTTP {r.status_code}: {r.text[:300]}")
        data = r.json()
        runpod_job_id = data.get("id")
        if not runpod_job_id:
            raise RuntimeError(f"RunPod /run returned no id: {data}")
        _set(job_id, runpod_job_id=runpod_job_id, progress=f"queued on RunPod ({runpod_job_id})")

        # 2. Poll status
        status_url = f"{RUNPOD_BASE}/{endpoint_id}/status/{runpod_job_id}"
        # FEP runs can take many hours; poll every 30 s, hard cap at 36 h.
        deadline = time.time() + 36 * 3600
        last_status = ""
        while time.time() < deadline:
            time.sleep(30)
            try:
                rs = requests.get(status_url, headers=headers, timeout=RUNPOD_TIMEOUT_S)
            except requests.RequestException as e:
                # Transient network errors — keep polling; don't kill a long job
                _set(job_id, progress=f"poll transient error ({type(e).__name__}); retrying")
                continue
            if rs.status_code != 200:
                raise RuntimeError(f"RunPod /status failed HTTP {rs.status_code}: {rs.text[:300]}")
            sdata = rs.json()
            rp_status = sdata.get("status", "UNKNOWN")
            if rp_status != last_status:
                last_status = rp_status
                _set(job_id, progress=f"RunPod status: {rp_status}")
            if rp_status == "COMPLETED":
                output = sdata.get("output")
                if output is None:
                    raise RuntimeError("RunPod COMPLETED but no output payload")
                _store_result(job_id, output, runpod_job_id)
                return
            if rp_status in ("FAILED", "CANCELLED", "TIMED_OUT"):
                err = sdata.get("error") or sdata.get("output") or "no error message"
                raise RuntimeError(f"RunPod job {rp_status}: {err}")
            # IN_QUEUE / IN_PROGRESS — keep polling

        raise RuntimeError(
            f"RunPod job {runpod_job_id} exceeded 36 h poll window without completing. "
            f"Job may still be running on RunPod — check the RunPod console with this id."
        )
    except Exception as e:
        _set(
            job_id, status="failed", finished_at=time.time(),
            progress="failed", error=f"{type(e).__name__}: {e}",
        )


def _store_result(job_id: str, output: dict, runpod_job_id: str) -> None:
    """Validate the worker's output JSON and convert to FepJobResult. Per project
    policy, missing required fields raise — we never substitute defaults."""
    required = [
        "ddg_kcal_mol", "ddg_uncertainty_kcalmol", "ddg_kT",
        "windows", "wallclock_minutes", "gpu_minutes",
        "engine_version", "force_field",
    ]
    missing = [k for k in required if k not in output]
    if missing:
        raise RuntimeError(
            f"RunPod worker output missing required fields {missing}. "
            f"Per project policy, no defaults are substituted. Worker payload keys: {list(output.keys())}"
        )

    result = FepJobResult(
        ddg_kcal_mol            = float(output["ddg_kcal_mol"]),
        ddg_uncertainty_kcalmol = float(output["ddg_uncertainty_kcalmol"]),
        ddg_kT                  = float(output["ddg_kT"]),
        windows                 = list(output["windows"]),
        wallclock_minutes       = float(output["wallclock_minutes"]),
        gpu_minutes             = float(output["gpu_minutes"]),
        engine_version          = str(output["engine_version"]),
        force_field             = str(output["force_field"]),
        warnings                = list(output.get("warnings", [])),
        runpod_job_id           = runpod_job_id,
    )
    _set(job_id, status="done", finished_at=time.time(),
         progress="complete", result=result)
