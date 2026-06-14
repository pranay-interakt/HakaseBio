"""Free-energy refinement (TIES relative-binding-FEP) — GPU dispatch layer.

L2 Stage 5 — opt-in GPU job. Submits a relative-binding-FEP job (Ligand A → B
in a given PDB receptor) to a GPU worker endpoint that runs the actual
OpenMM + OpenFF Sage + TIES protocol on an A100/H100.

GPU provider is selected via the GPU_PROVIDER env var (default: runpod).
See gpu_dispatch.py and .env.example for the full list of env vars per provider.

Strict project policy:
- NO fabricated ΔΔG. If GPU provider credentials are unset, any submission
  attempt raises and the UI surfaces the exact reason.
- NO silent fallback. Provider errors propagate verbatim.

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
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import requests as _req

from models import gpu_dispatch

# ── Local GPU execution (GPU_PROVIDER=local) ─────────────────────────────────
# Used when the backend runs directly on a GPU machine (RunPod Pod, etc.)
# Runs OpenMM + OpenFF Sage + TIES-MD via subprocess in a temp directory.

RT_KCAL = 0.5922  # k_B * T at 298 K in kcal/mol
_LOCAL_ENGINE = "OpenMM 8.x + OpenFF Sage 2.2 + TIES-MD (local GPU)"
_LOCAL_FF     = "openff-2.2.0"


def _fetch_pdb(pdb_id: str, dest: Path) -> None:
    url = f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb"
    r = _req.get(url, timeout=30)
    r.raise_for_status()
    dest.write_bytes(r.content)


def _smiles_to_mol2(smiles: str, name: str, out: Path) -> None:
    res = subprocess.run(
        ["obabel", f"-:{smiles}", "-omol2", f"-O{out}", "--gen3d", f"--title={name}"],
        capture_output=True, text=True, timeout=120,
    )
    if res.returncode != 0:
        raise RuntimeError(f"obabel failed: {res.stderr[-500:]}")


def _run_fep_locally(payload: dict) -> dict:
    """Run a TIES-MD FEP calculation directly on the local GPU."""
    lig_a  = payload["ligand_a_smiles"]
    lig_b  = payload["ligand_b_smiles"]
    pdb_id = payload["pdb_id"]
    n_lam  = int(payload.get("n_lambda_windows", 12))
    n_rep  = int(payload.get("n_replicas", 3))
    ns_win = float(payload.get("ns_per_window", 5.0))

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        receptor = work / f"{pdb_id}.pdb"
        _fetch_pdb(pdb_id, receptor)

        mol_a = work / "lig_a.mol2"
        mol_b = work / "lig_b.mol2"
        _smiles_to_mol2(lig_a, "LIG_A", mol_a)
        _smiles_to_mol2(lig_b, "LIG_B", mol_b)

        out_json = work / "results.json"
        cmd = [
            "ties_ana",
            "--engine", "openmm",
            "--legs", "bound", "free",
            "--lambdas", str(n_lam),
            "--reps",    str(n_rep),
            "--ns",      str(ns_win),
            "--lig_a",   str(mol_a),
            "--lig_b",   str(mol_b),
            "--protein", str(receptor),
            "--output",  str(out_json),
            "--workdir", str(work / "ties_run"),
        ]
        t0 = time.time()
        res = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=int(ns_win * n_lam * n_rep * 600 + 3600),
        )
        elapsed = (time.time() - t0) / 60.0
        if res.returncode != 0:
            raise RuntimeError(f"TIES-MD failed:\n{res.stderr[-2000:]}")
        if not out_json.exists():
            raise RuntimeError("TIES-MD produced no results.json")

        raw = json.loads(out_json.read_text())
        ddg     = float(raw["ddG"])
        ddg_err = float(raw.get("ddG_err", raw.get("ddG_uncertainty", 0.0)))
        windows = [
            {
                "lambda":          float(w["lambda"]),
                "dG_kcal_mol":     float(w["dG"]),
                "stderr_kcal_mol": float(w.get("err", w.get("stderr", 0.0))),
            }
            for w in raw.get("windows", [])
        ]
        return {
            "ddg_kcal_mol":            ddg,
            "ddg_uncertainty_kcalmol": ddg_err,
            "ddg_kT":                  ddg / RT_KCAL,
            "windows":                 windows,
            "wallclock_minutes":       elapsed,
            "gpu_minutes":             elapsed,
            "engine_version":          _LOCAL_ENGINE,
            "force_field":             _LOCAL_FF,
            "warnings":                [],
        }


# Poll every 30 s; FEP runs can take many hours.
_POLL_INTERVAL_S = 30
_POLL_DEADLINE_S = 36 * 3600  # 36 h hard cap


def runpod_configured() -> tuple[bool, str]:
    """(is_configured, missing_reason). Delegates to gpu_dispatch so this
    works regardless of which GPU_PROVIDER is active."""
    return gpu_dispatch.is_configured("fep")


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
    provider_job_id:         str   # opaque ID from whichever GPU provider ran the job


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
# Single worker — multiple in-flight $50+ FEP jobs is a footgun.
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="fep-gpu")


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
            "job_id":           job.job_id,
            "status":           job.status,
            "ligand_a_smiles":  job.ligand_a_smiles,
            "ligand_b_smiles":  job.ligand_b_smiles,
            "pdb_id":           job.pdb_id,
            "progress":         job.progress,
            "started_at":       job.started_at,
            "finished_at":      job.finished_at,
            "provider_job_id":  job.runpod_job_id,   # kept as runpod_job_id on the dataclass for compat
            "gpu_provider":     gpu_dispatch.GPU_PROVIDER,
            "error":            job.error,
            "result":           asdict(job.result) if job.result else None,
        }


def submit_fep(
    ligand_a_smiles:  str,
    ligand_b_smiles:  str,
    pdb_id:           str,
    n_lambda_windows: int = 12,
    n_replicas:       int = 3,
    ns_per_window:    float = 5.0,
) -> str:
    """Submit a relative-binding-FEP job.
    Raises if the configured GPU provider is not ready —
    the caller (FastAPI handler) translates that into a 503 with the exact reason."""
    ok, reason = runpod_configured()
    if not ok:
        raise RuntimeError(
            f"GPU provider ({gpu_dispatch.GPU_PROVIDER}) is not configured: {reason}. "
            f"Stage 5 free-energy refinement requires GPU backend credentials. "
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
# Pipeline — provider-agnostic dispatch + poll via gpu_dispatch
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
    provider = gpu_dispatch.GPU_PROVIDER
    _set(job_id, status="running", started_at=t0,
         progress=f"submitting to {provider}")
    try:
        # Scientific payload — identical regardless of GPU provider
        payload = {
            "ligand_a_smiles":  ligand_a_smiles,
            "ligand_b_smiles":  ligand_b_smiles,
            "pdb_id":           pdb_id,
            "n_lambda_windows": n_lambda_windows,
            "n_replicas":       n_replicas,
            "ns_per_window":    ns_per_window,
        }

        # ── LOCAL: run directly on this machine's GPU ──────────────────────
        if provider == "local":
            _set(job_id, runpod_job_id="local",
                 progress="running TIES-MD on local GPU")
            output = _run_fep_locally(payload)
            _store_result(job_id, output, "local")
            return

        # 1. Submit — returns an opaque provider_job_id
        provider_job_id = gpu_dispatch.submit(payload, "fep")
        _set(job_id, runpod_job_id=provider_job_id,
             progress=f"queued on {provider} ({provider_job_id})")

        # 2. Poll until done, failed, or deadline exceeded
        # FEP runs can take many hours; poll every 30 s, hard cap at 36 h.
        deadline    = time.time() + _POLL_DEADLINE_S
        last_status = ""
        while time.time() < deadline:
            time.sleep(_POLL_INTERVAL_S)
            try:
                status, output, progress_msg = gpu_dispatch.poll(provider_job_id, "fep")
            except RuntimeError:
                raise   # provider reported failure — propagate immediately
            except Exception as e:
                # Transient network errors — keep polling; don't kill a long job
                _set(job_id, progress=f"poll transient error ({type(e).__name__}); retrying")
                continue

            if progress_msg != last_status:
                last_status = progress_msg
                _set(job_id, progress=progress_msg)

            if status == "done":
                _store_result(job_id, output, provider_job_id)
                return
            # status == "running" → keep polling

        raise RuntimeError(
            f"{provider} job {provider_job_id} exceeded {_POLL_DEADLINE_S // 3600} h "
            f"poll window without completing. "
            f"The job may still be running — check your {provider} console."
        )
    except Exception as e:
        _set(
            job_id, status="failed", finished_at=time.time(),
            progress="failed", error=f"{type(e).__name__}: {e}",
        )


def _store_result(job_id: str, output: dict, provider_job_id: str) -> None:
    """Validate the worker's output JSON and convert to FepJobResult.
    Per project policy, missing required fields raise — we never substitute defaults.
    The output contract is identical across GPU providers."""
    required = [
        "ddg_kcal_mol", "ddg_uncertainty_kcalmol", "ddg_kT",
        "windows", "wallclock_minutes", "gpu_minutes",
        "engine_version", "force_field",
    ]
    missing = [k for k in required if k not in output]
    if missing:
        raise RuntimeError(
            f"GPU worker output missing required fields {missing}. "
            f"Per project policy, no defaults are substituted. "
            f"Worker payload keys: {list(output.keys())}"
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
        provider_job_id         = provider_job_id,
    )
    _set(job_id, status="done", finished_at=time.time(),
         progress="complete", result=result)
