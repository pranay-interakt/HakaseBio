"""Auto-pose a ligand into a receptor using smina.

Used by `ties_runner.py` to generate starting bound poses for ligands A and B
when no expert-curated pose was supplied. The pose is centred on the
co-crystal ligand if the receptor PDB has one (HETATM record with a non-
standard residue), otherwise on the protein's geometric centre.

Honesty contract:
- NO synthetic poses if smina fails — raise.
- NO scoring-function-only ΔG estimate is returned. This module ONLY
  produces a pose; downstream FEP is the only source of binding affinity.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np


SMINA_EXE = shutil.which("smina") or "smina"


class DockingError(RuntimeError):
    pass


@dataclass
class DockedPose:
    pdb_path:    Path
    score_kcal:  float  # smina vinardo score — RANK ONLY, not a binding ΔG.


def _binding_site_centre(receptor_pdb: Path) -> tuple[float, float, float, float]:
    """Return (cx, cy, cz, box_size_A). Uses the largest HETATM cluster (i.e.
    the co-crystal ligand) if present, else the protein's geometric centre."""
    coords_het: list[tuple[float, float, float]] = []
    coords_atom: list[tuple[float, float, float]] = []
    SKIP_RES = {"HOH", "WAT", "NA", "CL", "MG", "ZN", "CA", "K", "FE", "MN"}
    with receptor_pdb.open() as fh:
        for line in fh:
            rec = line[:6].strip()
            if rec not in ("ATOM", "HETATM"):
                continue
            try:
                resname = line[17:20].strip()
                x, y, z = float(line[30:38]), float(line[38:46]), float(line[46:54])
            except ValueError:
                continue
            if rec == "HETATM" and resname not in SKIP_RES:
                coords_het.append((x, y, z))
            elif rec == "ATOM":
                coords_atom.append((x, y, z))
    if coords_het:
        arr = np.asarray(coords_het, dtype=float)
    elif coords_atom:
        arr = np.asarray(coords_atom, dtype=float)
    else:
        raise DockingError(f"no usable atoms found in {receptor_pdb}")
    centre = arr.mean(axis=0)
    span = float(np.linalg.norm(arr.max(axis=0) - arr.min(axis=0)))
    # Tight box around co-crystal ligand; loose box around bare protein
    # so the docker has somewhere to look.
    box = 22.0 if coords_het else max(22.0, min(40.0, span * 0.6))
    return float(centre[0]), float(centre[1]), float(centre[2]), box


def dock_ligand(
    ligand_sdf:   Path,
    receptor_pdb: Path,
    work_dir:     Path,
    label:        str,
    exhaustiveness: int = 16,
) -> DockedPose:
    """Run smina to dock `ligand_sdf` into `receptor_pdb`. Returns the top
    pose's PDB path + raw smina score. Raises DockingError on any failure."""
    work_dir.mkdir(parents=True, exist_ok=True)
    out_sdf = work_dir / f"{label}_docked.sdf"
    out_pdb = work_dir / f"{label}_docked.pdb"
    log     = work_dir / f"{label}_smina.log"

    cx, cy, cz, box = _binding_site_centre(receptor_pdb)

    cmd = [
        SMINA_EXE,
        "--receptor", str(receptor_pdb),
        "--ligand",   str(ligand_sdf),
        "--out",      str(out_sdf),
        "--center_x", f"{cx:.3f}",
        "--center_y", f"{cy:.3f}",
        "--center_z", f"{cz:.3f}",
        "--size_x",   f"{box:.1f}",
        "--size_y",   f"{box:.1f}",
        "--size_z",   f"{box:.1f}",
        "--exhaustiveness", str(exhaustiveness),
        "--num_modes", "1",
        "--cpu", str(max(1, os.cpu_count() or 1)),
        "--seed", "1",
    ]
    try:
        proc = subprocess.run(
            cmd, check=False, capture_output=True, text=True, timeout=20 * 60,
        )
    except subprocess.TimeoutExpired as e:
        raise DockingError(f"smina timed out after 20 min for {label}") from e
    log.write_text(f"$ {' '.join(cmd)}\n\n--- stdout ---\n{proc.stdout}\n--- stderr ---\n{proc.stderr}\n")
    if proc.returncode != 0 or not out_sdf.exists():
        raise DockingError(
            f"smina failed (rc={proc.returncode}) for {label}. "
            f"See {log}. Stderr tail: {proc.stderr[-400:]}"
        )

    # Parse top-pose score from SDF tag.
    score: float | None = None
    sdf_text = out_sdf.read_text()
    for marker in ("> <minimizedAffinity>", "> <Affinity>", "> <vina_affinity>"):
        if marker in sdf_text:
            try:
                idx = sdf_text.index(marker)
                line = sdf_text[idx:].split("\n", 2)[1].strip()
                score = float(line)
                break
            except (ValueError, IndexError):
                continue
    if score is None:
        raise DockingError(
            f"smina output for {label} contained no parseable affinity tag — "
            "refusing to proceed without a score"
        )

    # Convert SDF → PDB for downstream OpenMM topology assembly.
    try:
        from rdkit import Chem
        suppl = Chem.SDMolSupplier(str(out_sdf), removeHs=False)
        mol = next((m for m in suppl if m is not None), None)
        if mol is None:
            raise DockingError(f"could not parse {out_sdf} via RDKit")
        Chem.MolToPDBFile(mol, str(out_pdb))
    except Exception as e:
        raise DockingError(f"SDF→PDB conversion failed for {label}: {e}") from e

    return DockedPose(pdb_path=out_pdb, score_kcal=score)
