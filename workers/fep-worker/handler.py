"""
Hakase BioTwin — FEP/TIES RunPod Serverless Worker
====================================================
Runs a relative-binding free energy calculation using:
  OpenMM 8.x + OpenFF Sage 2.2 + TIES-MD 1.x

Input JSON (job["input"]):
  {
    "ligand_a_smiles":  str,    # reference ligand SMILES
    "ligand_b_smiles":  str,    # perturbed ligand SMILES
    "pdb_id":           str,    # 4-letter RCSB PDB ID
    "n_lambda_windows": int,    # default 12
    "n_replicas":       int,    # default 3
    "ns_per_window":    float   # default 5.0
  }

Output JSON (returned from handler):
  {
    "ddg_kcal_mol":            float,
    "ddg_uncertainty_kcalmol": float,
    "ddg_kT":                  float,
    "windows": [
      { "lambda": float, "dG_kcal_mol": float, "stderr_kcal_mol": float },
      ...
    ],
    "wallclock_minutes": float,
    "gpu_minutes":       float,
    "engine_version":    str,
    "force_field":       str,
    "warnings":          list[str]
  }
"""

from __future__ import annotations

import os
import time
import tempfile
import subprocess
import json
import math
import traceback
from pathlib import Path

import runpod

# ── Optional heavy imports — graceful degradation in test mode ───────────────
try:
    from openmm.app import PDBFile, ForceField, Simulation, PME, HBonds
    from openmm import unit, LangevinMiddleIntegrator, MonteCarloBarostat
    import openmm as omm
    _OPENMM = True
except ImportError:
    _OPENMM = False

try:
    from openff.toolkit import Molecule, ForceField as OFFForceField
    from openff.interchange import Interchange
    _OPENFF = True
except ImportError:
    _OPENFF = False

try:
    import requests as _req
    _REQUESTS = True
except ImportError:
    _REQUESTS = False


ENGINE_VERSION = "OpenMM 8.1 + OpenFF Sage 2.2.0 + TIES-MD protocol"
FORCE_FIELD    = "openff-2.2.0"
RT_KCAL        = 0.5922   # k_B * T at 298 K in kcal/mol


# ── Helpers ──────────────────────────────────────────────────────────────────

def fetch_pdb(pdb_id: str, dest: Path) -> Path:
    """Download PDB file from RCSB."""
    url = f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb"
    if not _REQUESTS:
        import urllib.request
        urllib.request.urlretrieve(url, dest)
    else:
        r = _req.get(url, timeout=30)
        r.raise_for_status()
        dest.write_bytes(r.content)
    return dest


def smiles_to_mol2(smiles: str, name: str, out: Path) -> Path:
    """Convert SMILES → MOL2 via OpenBabel (must be in PATH)."""
    result = subprocess.run(
        ["obabel", f"-:{smiles}", "-omol2", f"-O{out}", "--gen3d", f"--title={name}"],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"obabel failed: {result.stderr}")
    return out


def run_ties_protocol(
    ligand_a_mol2: Path,
    ligand_b_mol2: Path,
    receptor_pdb:  Path,
    n_lambda:      int,
    n_replicas:    int,
    ns_per_window: float,
    workdir:       Path,
) -> dict:
    """
    Run TIES-MD free energy calculation.
    Returns per-window ΔG values and overall ΔΔG.

    TIES-MD CLI:
      ties_ana --engine openmm --legs bound free \
               --lambdas <N> --reps <R> --ns <ns> \
               --lig_a <mol2> --lig_b <mol2> \
               --protein <pdb> --output results.json
    """
    out_json = workdir / "results.json"
    cmd = [
        "ties_ana",
        "--engine", "openmm",
        "--legs", "bound", "free",
        "--lambdas", str(n_lambda),
        "--reps", str(n_replicas),
        "--ns", str(ns_per_window),
        "--lig_a", str(ligand_a_mol2),
        "--lig_b", str(ligand_b_mol2),
        "--protein", str(receptor_pdb),
        "--output", str(out_json),
        "--workdir", str(workdir),
    ]
    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True,
                            timeout=int(ns_per_window * n_lambda * n_replicas * 600 + 3600))
    elapsed_min = (time.time() - t0) / 60.0

    if result.returncode != 0:
        raise RuntimeError(f"TIES-MD failed:\n{result.stderr[-2000:]}")

    if not out_json.exists():
        raise RuntimeError("TIES-MD completed but produced no results.json")

    raw = json.loads(out_json.read_text())
    return {"raw": raw, "elapsed_min": elapsed_min}


def parse_ties_output(raw: dict, elapsed_min: float) -> dict:
    """
    Parse TIES-MD results.json into the Hakase output contract.
    TIES-MD outputs: {"ddG": float, "ddG_err": float, "windows": [...]}
    """
    ddg      = float(raw["ddG"])
    ddg_err  = float(raw.get("ddG_err", raw.get("ddG_uncertainty", 0.0)))
    windows  = [
        {
            "lambda":         float(w["lambda"]),
            "dG_kcal_mol":    float(w["dG"]),
            "stderr_kcal_mol": float(w.get("err", w.get("stderr", 0.0))),
        }
        for w in raw.get("windows", [])
    ]

    return {
        "ddg_kcal_mol":            ddg,
        "ddg_uncertainty_kcalmol": ddg_err,
        "ddg_kT":                  ddg / RT_KCAL,
        "windows":                 windows,
        "wallclock_minutes":       elapsed_min,
        "gpu_minutes":             elapsed_min,   # single-GPU run; approximate
        "engine_version":          ENGINE_VERSION,
        "force_field":             FORCE_FIELD,
        "warnings":                [],
    }


# ── RunPod handler ────────────────────────────────────────────────────────────

def handler(job: dict) -> dict:
    inp = job.get("input", {})

    ligand_a_smiles  = inp["ligand_a_smiles"]
    ligand_b_smiles  = inp["ligand_b_smiles"]
    pdb_id           = inp["pdb_id"].upper()
    n_lambda         = int(inp.get("n_lambda_windows", 12))
    n_replicas       = int(inp.get("n_replicas", 3))
    ns_per_window    = float(inp.get("ns_per_window", 5.0))

    warnings: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)

        # 1. Download receptor
        receptor_pdb = workdir / f"{pdb_id}.pdb"
        try:
            fetch_pdb(pdb_id, receptor_pdb)
        except Exception as e:
            raise RuntimeError(f"Could not download PDB {pdb_id}: {e}")

        # 2. Convert ligands SMILES → MOL2
        lig_a_mol2 = workdir / "ligand_a.mol2"
        lig_b_mol2 = workdir / "ligand_b.mol2"
        try:
            smiles_to_mol2(ligand_a_smiles, "LIG_A", lig_a_mol2)
            smiles_to_mol2(ligand_b_smiles, "LIG_B", lig_b_mol2)
        except Exception as e:
            raise RuntimeError(f"Ligand preparation failed: {e}")

        # 3. Run TIES-MD
        try:
            ties_result = run_ties_protocol(
                lig_a_mol2, lig_b_mol2, receptor_pdb,
                n_lambda, n_replicas, ns_per_window,
                workdir / "ties_run",
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("TIES-MD timed out — reduce ns_per_window or n_lambda_windows")
        except Exception as e:
            raise RuntimeError(f"TIES-MD run failed: {e}\n{traceback.format_exc()[-1000:]}")

        # 4. Parse + return
        output = parse_ties_output(ties_result["raw"], ties_result["elapsed_min"])
        output["warnings"] = warnings
        return output


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
