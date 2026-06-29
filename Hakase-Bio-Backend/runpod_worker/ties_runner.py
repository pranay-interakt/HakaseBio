"""TIES-MD relative-binding free-energy perturbation runner.

Drives the OpenMM + OpenFF Sage 2.2.0 + TIES-MD 1.7 protocol end-to-end:
fetch receptor PDB from RCSB → embed ligand 3D conformers → auto-dock both
ligands into the binding site → build hybrid topology → run alchemical FEP
across n_lambda_windows × n_replicas → analyze with MBAR → report ΔΔG.

This module is intentionally a thin orchestration layer over TIES-MD's CLI.
The hard chemistry lives inside TIES-MD itself; we keep this file readable
so the I/O contract is auditable.

Honesty contract (project-wide):
- NO fabricated numbers. If TIES doesn't emit a ΔΔG, we raise.
- NO retries with relaxed convergence criteria. Either the requested
  protocol succeeds or the job fails — the upstream user can rerun with
  longer ns_per_window if uncertainty is too wide.
- Every limitation we know about (auto-pose, atom-mapping, congeneric
  scope) is appended to `warnings` so the upstream UI surfaces it.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from dock_runner import DockingError, dock_ligand


ENGINE_VERSION = "OpenMM 8.1.1 + OpenFF Sage 2.2.0 + TIES-MD 1.7"
FORCE_FIELD    = "openff-2.2.0"
RCSB_PDB_URL   = "https://files.rcsb.org/download/{pdb_id}.pdb"
KBT_KCAL_298K  = 0.5924  # k_B * T at 298.15 K, in kcal/mol


class TiesRunError(RuntimeError):
    pass


@dataclass
class TiesInput:
    ligand_a_smiles:  str
    ligand_b_smiles:  str
    pdb_id:           str
    n_lambda_windows: int
    n_replicas:       int
    ns_per_window:    float


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_pdb(pdb_id: str, dest: Path) -> Path:
    url = RCSB_PDB_URL.format(pdb_id=pdb_id)
    r = requests.get(url, timeout=60)
    if r.status_code != 200:
        raise TiesRunError(f"RCSB PDB fetch failed for {pdb_id}: HTTP {r.status_code}")
    if len(r.content) < 1000:
        raise TiesRunError(f"RCSB returned implausibly small PDB for {pdb_id} ({len(r.content)} bytes)")
    dest.write_bytes(r.content)
    return dest


def _prepare_receptor(raw_pdb: Path, out_pdb: Path) -> None:
    """Strip waters/cofactors not handled by AMBER ff14SB, add missing
    residues + hydrogens via PDBFixer. Raises on failure (no half-built pdb)."""
    try:
        from pdbfixer import PDBFixer
        from openmm.app import PDBFile
    except ImportError as e:
        raise TiesRunError(f"chemistry stack import failed: {e}") from e
    try:
        fixer = PDBFixer(filename=str(raw_pdb))
        fixer.removeHeterogens(keepWater=False)
        fixer.findMissingResidues()
        fixer.findMissingAtoms()
        fixer.addMissingAtoms()
        fixer.addMissingHydrogens(pH=7.4)
        with out_pdb.open("w") as fh:
            PDBFile.writeFile(fixer.topology, fixer.positions, fh, keepIds=True)
    except Exception as e:
        raise TiesRunError(f"PDBFixer preparation failed: {e}") from e


def _embed_ligand(smiles: str, out_sdf: Path, label: str) -> None:
    """SMILES → 3D SDF with a single low-energy conformer + UFF minimization."""
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem
    except ImportError as e:
        raise TiesRunError(f"RDKit import failed: {e}") from e
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise TiesRunError(f"RDKit could not parse SMILES for {label}: {smiles!r}")
    mol = Chem.AddHs(mol)
    embed_rc = AllChem.EmbedMolecule(mol, randomSeed=1, useRandomCoords=True)
    if embed_rc != 0:
        raise TiesRunError(f"RDKit 3D embed failed for {label} (smiles={smiles!r})")
    try:
        AllChem.UFFOptimizeMolecule(mol, maxIters=400)
    except Exception as e:
        raise TiesRunError(f"UFF minimization failed for {label}: {e}") from e
    mol.SetProp("_Name", label)
    writer = Chem.SDWriter(str(out_sdf))
    writer.write(mol)
    writer.close()


def _check_congeneric(smiles_a: str, smiles_b: str) -> list[str]:
    """Cheap sanity check on perturbation scope. Returns warnings only — does
    not refuse. The upstream UI is responsible for SAR scope policing."""
    warns: list[str] = []
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem, DataStructs
        ma = Chem.MolFromSmiles(smiles_a)
        mb = Chem.MolFromSmiles(smiles_b)
        if ma is None or mb is None:
            return warns
        fa = AllChem.GetMorganFingerprintAsBitVect(ma, 2, 2048)
        fb = AllChem.GetMorganFingerprintAsBitVect(mb, 2, 2048)
        tan = DataStructs.TanimotoSimilarity(fa, fb)
        if tan < 0.5:
            warns.append(
                f"Ligands A/B Tanimoto similarity = {tan:.2f} (<0.5). TIES-MD "
                "atom mapping is reliable only for congeneric series — treat "
                "this ΔΔG with skepticism."
            )
        n_atoms_diff = abs(ma.GetNumHeavyAtoms() - mb.GetNumHeavyAtoms())
        if n_atoms_diff > 4:
            warns.append(
                f"Heavy-atom count differs by {n_atoms_diff} between A and B; "
                "large perturbations have higher hysteresis — consider stepping "
                "through intermediates."
            )
    except Exception:
        pass
    return warns


# ---------------------------------------------------------------------------
# TIES-MD invocation
# ---------------------------------------------------------------------------

def _run_ties_cli(
    work_dir:    Path,
    receptor:    Path,
    ligand_a:    Path,
    ligand_b:    Path,
    n_lambda:    int,
    n_replicas:  int,
    ns_per_win:  float,
) -> dict[str, Any]:
    """Drive ties-md as a subprocess. Returns the parsed results JSON."""
    out_dir = work_dir / "ties_out"
    out_dir.mkdir(exist_ok=True)
    log = work_dir / "ties.log"

    # ties_md exposes a Python API; we use the CLI form so a crash is
    # cleanly contained in a subprocess boundary instead of taking down
    # the worker event loop.
    config = {
        "engine":         "openmm",
        "ligand_a":       str(ligand_a),
        "ligand_b":       str(ligand_b),
        "receptor":       str(receptor),
        "forcefield":     "openff-2.2.0.offxml",
        "protein_ff":     "amber/ff14SB.xml",
        "water_model":    "tip3p",
        "n_lambda":       n_lambda,
        "n_replicas":     n_replicas,
        "production_ns":  ns_per_win,
        "equilibration_ns": 2.0,  # 0.5 ns was too short for solvated complex relaxation; 2 ns is minimum for well-equilibrated box
        "temperature_K":  298.15,
        "ionic_strength_M": 0.15,
        "platform":       "CUDA",
        "output_dir":     str(out_dir),
        "results_json":   str(out_dir / "results.json"),
    }
    cfg_path = work_dir / "ties_config.json"
    cfg_path.write_text(json.dumps(config, indent=2))

    cmd = ["ties_md", "--config", str(cfg_path)]
    try:
        proc = subprocess.run(
            cmd, check=False, capture_output=True, text=True,
            timeout=23 * 3600,  # leave 1 h headroom under the 24 h endpoint cap
        )
    except subprocess.TimeoutExpired as e:
        raise TiesRunError(
            f"TIES-MD exceeded 23 h wall-clock limit (n_lambda={n_lambda}, "
            f"n_replicas={n_replicas}, ns/window={ns_per_win}). "
            f"Reduce ns_per_window or n_replicas and retry."
        ) from e
    log.write_text(
        f"$ {' '.join(cmd)}\n\n--- stdout (tail) ---\n{proc.stdout[-4000:]}\n"
        f"--- stderr (tail) ---\n{proc.stderr[-4000:]}\n"
    )
    if proc.returncode != 0:
        raise TiesRunError(
            f"ties_md exited rc={proc.returncode}. See {log}. "
            f"Stderr tail: {proc.stderr[-400:]}"
        )
    results_json = out_dir / "results.json"
    if not results_json.exists():
        raise TiesRunError(
            f"ties_md completed but produced no results.json at {results_json}. "
            "Per project policy, no surrogate ΔΔG is computed."
        )
    try:
        return json.loads(results_json.read_text())
    except json.JSONDecodeError as e:
        raise TiesRunError(f"ties_md results.json is not valid JSON: {e}") from e


def _normalize_ties_output(raw: dict[str, Any]) -> dict[str, Any]:
    """Translate ties_md's native results JSON into the strict 8-field
    contract. Raise on anything missing — never substitute defaults."""
    required_native = ("ddg_kcal_mol", "ddg_uncertainty_kcalmol", "windows", "gpu_minutes")
    missing = [k for k in required_native if k not in raw]
    if missing:
        raise TiesRunError(
            f"ties_md results.json missing required fields {missing}. "
            f"Got keys: {list(raw.keys())}"
        )
    ddg = float(raw["ddg_kcal_mol"])
    ddg_u = float(raw["ddg_uncertainty_kcalmol"])
    windows = []
    for w in raw["windows"]:
        if not all(k in w for k in ("lambda", "dG_kcal_mol", "stderr_kcal_mol")):
            raise TiesRunError(f"ties_md window entry missing required keys: {w}")
        windows.append({
            "lambda":           float(w["lambda"]),
            "dG_kcal_mol":      float(w["dG_kcal_mol"]),
            "stderr_kcal_mol":  float(w["stderr_kcal_mol"]),
        })
    # Forward/reverse hysteresis check.
    # If ties_md emits separate forward and reverse ΔΔG estimates (rare but
    # possible with MBAR estimator), check that they agree within 1 kcal/mol.
    # |ΔΔG_fwd + ΔΔG_rev| should be ~0 at convergence (time-reversibility).
    fwd = raw.get("ddg_forward_kcalmol")
    rev = raw.get("ddg_reverse_kcalmol")
    if fwd is not None and rev is not None:
        hysteresis = abs(float(fwd) + float(rev))
        hysteresis_warn = hysteresis > 1.0
    else:
        hysteresis = None
        hysteresis_warn = None

    # MBAR cycle-closure flag (available when ties_md runs MBAR post-processing).
    mbar_cycle_closure = raw.get("mbar_cycle_closure_kcalmol")

    return {
        "ddg_kcal_mol":            ddg,
        "ddg_uncertainty_kcalmol": ddg_u,
        "ddg_kT":                  ddg / KBT_KCAL_298K,
        "windows":                 windows,
        "gpu_minutes":             float(raw["gpu_minutes"]),
        "engine_version":          ENGINE_VERSION,
        "force_field":             FORCE_FIELD,
        # Convergence quality indicators
        "hysteresis_kcalmol":      round(hysteresis, 3) if hysteresis is not None else None,
        "hysteresis_warn":         hysteresis_warn,
        "mbar_cycle_closure_kcalmol": float(mbar_cycle_closure) if mbar_cycle_closure is not None else None,
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_relative_binding_fep(ti: TiesInput) -> dict[str, Any]:
    """End-to-end: fetch → prep → dock → TIES → normalize."""
    t0 = time.time()
    warnings: list[str] = []
    warnings.extend(_check_congeneric(ti.ligand_a_smiles, ti.ligand_b_smiles))

    with tempfile.TemporaryDirectory(prefix="fep_", dir="/tmp") as tmp:
        work = Path(tmp)

        # 1. receptor
        raw_pdb = _fetch_pdb(ti.pdb_id, work / f"{ti.pdb_id}_raw.pdb")
        prep_pdb = work / f"{ti.pdb_id}_prep.pdb"
        _prepare_receptor(raw_pdb, prep_pdb)

        # 2. ligand 3D embeds
        lig_a_sdf = work / "lig_a.sdf"
        lig_b_sdf = work / "lig_b.sdf"
        _embed_ligand(ti.ligand_a_smiles, lig_a_sdf, "ligand_a")
        _embed_ligand(ti.ligand_b_smiles, lig_b_sdf, "ligand_b")

        # 3. auto-dock both ligands into binding site (raw_pdb keeps cocrystal
        # ligand for centre-finding; prep_pdb is what TIES sees)
        try:
            pose_a = dock_ligand(lig_a_sdf, raw_pdb, work / "dock_a", "ligand_a")
            pose_b = dock_ligand(lig_b_sdf, raw_pdb, work / "dock_b", "ligand_b")
        except DockingError as e:
            raise TiesRunError(f"auto-pose generation failed: {e}") from e
        warnings.append(
            "Bound poses were auto-generated by smina, not expert-curated. "
            f"smina vinardo scores: A={pose_a.score_kcal:.2f}, "
            f"B={pose_b.score_kcal:.2f} kcal/mol (RANK ONLY, not binding ΔG). "
            "For publication-grade FEP, supply a curated pose."
        )

        # 4. TIES-MD
        try:
            raw = _run_ties_cli(
                work_dir=work,
                receptor=prep_pdb,
                ligand_a=pose_a.pdb_path,
                ligand_b=pose_b.pdb_path,
                n_lambda=ti.n_lambda_windows,
                n_replicas=ti.n_replicas,
                ns_per_win=ti.ns_per_window,
            )
        except TiesRunError:
            raise
        except Exception as e:
            raise TiesRunError(f"unexpected TIES failure: {type(e).__name__}: {e}") from e

        result = _normalize_ties_output(raw)

    # Convergence-quality warnings (non-blocking — upstream surfaces them).
    if result["ddg_uncertainty_kcalmol"] > 1.0:
        warnings.append(
            f"ΔΔG uncertainty {result['ddg_uncertainty_kcalmol']:.2f} kcal/mol "
            "exceeds 1.0 — recommend rerun with longer ns_per_window or more replicas."
        )
    if result.get("hysteresis_warn"):
        warnings.append(
            f"Forward/reverse hysteresis {result['hysteresis_kcalmol']:.2f} kcal/mol "
            "exceeds 1.0 — FEP simulation may not be converged. "
            "Increase equilibration_ns and/or ns_per_window before trusting this ΔΔG."
        )
    if result.get("mbar_cycle_closure_kcalmol") is not None and result["mbar_cycle_closure_kcalmol"] > 1.0:
        warnings.append(
            f"MBAR cycle-closure residual {result['mbar_cycle_closure_kcalmol']:.2f} kcal/mol "
            "exceeds 1.0 — consider adding more λ windows or longer sampling per window."
        )

    result["warnings"] = warnings
    result["wallclock_minutes"] = round((time.time() - t0) / 60.0, 2)
    return result
