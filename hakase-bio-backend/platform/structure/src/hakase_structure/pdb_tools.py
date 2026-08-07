"""Real geometric analysis of predicted PDB coordinates.

Everything here is computed directly from the atomic coordinates returned by the
folding model — no synthetic values. Provides per-residue and mean pLDDT
(parsed from the B-factor column and normalized to 0..100), radius of gyration,
end-to-end distance, a compactness ratio, and disulfide-geometry verification
(Cys SG–SG distances) which is a genuine structural check on declared bridges.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .plddt import PLDDT_OUTPUT_SCALE

_THREE_TO_ONE = {
    "ALA": "A",
    "ARG": "R",
    "ASN": "N",
    "ASP": "D",
    "CYS": "C",
    "GLN": "Q",
    "GLU": "E",
    "GLY": "G",
    "HIS": "H",
    "ILE": "I",
    "LEU": "L",
    "LYS": "K",
    "MET": "M",
    "PHE": "F",
    "PRO": "P",
    "SER": "S",
    "THR": "T",
    "TRP": "W",
    "TYR": "Y",
    "VAL": "V",
}


def _parse_atoms(pdb: str) -> list[dict[str, Any]]:
    atoms: list[dict[str, Any]] = []
    for line in pdb.splitlines():
        if not (line.startswith("ATOM") or line.startswith("HETATM")):
            continue
        try:
            atoms.append(
                {
                    "name": line[12:16].strip(),
                    "resname": line[17:20].strip(),
                    "chain": line[21:22].strip(),
                    "resseq": int(line[22:26]),
                    "x": float(line[30:38]),
                    "y": float(line[38:46]),
                    "z": float(line[46:54]),
                    "bfactor": float(line[60:66]) if line[60:66].strip() else 0.0,
                }
            )
        except (ValueError, IndexError):
            continue
    return atoms


def parsed_residue_count(pdb: str) -> int:
    """Return the number of unique coordinate residues in PDB text."""
    atoms = _parse_atoms(pdb)
    residues = {(a["chain"], a["resseq"]) for a in atoms}
    return len(residues)


def has_coordinate_records(pdb: str) -> bool:
    """True when PDB text includes structural coordinate records."""
    if not isinstance(pdb, str) or not pdb.strip():
        return False
    return any(line.startswith(("ATOM", "HETATM")) for line in pdb.splitlines())


def parse_per_residue_plddt(pdb: str) -> tuple[list[float], str]:
    """Return (per-residue CA pLDDT normalized to 0..100, detected_scale).

    ESM Atlas returns pLDDT on a 0..1 scale in the B-factor; conventional
    ESMFold/AlphaFold PDBs use 0..100. We detect the scale from the observed
    maximum and normalize to 0..100.
    """
    atoms = _parse_atoms(pdb)
    ca = [a for a in atoms if a["name"] == "CA"]
    if not ca:
        # fall back to per-residue mean B-factor if no CA (rare)
        by_res: dict[tuple[str, int], list[float]] = {}
        for a in atoms:
            by_res.setdefault((a["chain"], a["resseq"]), []).append(a["bfactor"])
        vals = [float(np.mean(v)) for _, v in sorted(by_res.items())]
    else:
        ca.sort(key=lambda a: (a["chain"], a["resseq"]))
        vals = [a["bfactor"] for a in ca]
    if not vals:
        return [], "unknown"
    scale = "0-1" if max(vals) <= 1.0 + 1e-9 else "0-100"
    if scale == "0-1":
        vals = [v * 100.0 for v in vals]
    return vals, scale


def analyze_structure(
    pdb: str, declared_disulfides: list[tuple[int, int]] | None = None
) -> dict[str, Any]:
    atoms = _parse_atoms(pdb)
    if not atoms:
        raise ValueError("No ATOM records found in PDB; cannot analyze structure.")

    ca = [a for a in atoms if a["name"] == "CA"]
    ca.sort(key=lambda a: (a["chain"], a["resseq"]))
    coords = np.array([[a["x"], a["y"], a["z"]] for a in ca], dtype=float)

    plddt, scale = parse_per_residue_plddt(pdb)
    mean_plddt = float(np.mean(plddt)) if plddt else None
    confident_fraction = (
        float(np.mean([1.0 if v >= 70.0 else 0.0 for v in plddt])) if plddt else None
    )

    # Radius of gyration and end-to-end distance from CA coordinates.
    rg = None
    end_to_end = None
    compactness = None
    if len(coords) >= 2:
        centroid = coords.mean(axis=0)
        rg = float(np.sqrt(((coords - centroid) ** 2).sum(axis=1).mean()))
        end_to_end = float(np.linalg.norm(coords[0] - coords[-1]))
        # Expected Rg for a compact globular chain ~ 2.2 * N^0.38 (Angstrom).
        n = len(coords)
        rg_compact_ref = 2.2 * (n**0.38)
        compactness = round(rg_compact_ref / rg, 3) if rg > 0 else None

    # Disulfide geometry check: real SG–SG distances (bonded ~2.05 A, allow <2.5).
    disulfide_report: list[dict[str, Any]] = []
    if declared_disulfides:
        sg = {a["resseq"]: a for a in atoms if a["name"] == "SG"}
        for i, j in declared_disulfides:
            ai, aj = sg.get(i), sg.get(j)
            if ai and aj:
                d = math.dist((ai["x"], ai["y"], ai["z"]), (aj["x"], aj["y"], aj["z"]))
                disulfide_report.append(
                    {
                        "pair": [i, j],
                        "sg_sg_distance_angstrom": round(d, 3),
                        "geometry_consistent": bool(d <= 2.5),
                    }
                )
            else:
                disulfide_report.append(
                    {
                        "pair": [i, j],
                        "sg_sg_distance_angstrom": None,
                        "geometry_consistent": None,
                        "note": "SG atom(s) absent in model",
                    }
                )

    return {
        "n_residues": len(ca),
        "mean_plddt": round(mean_plddt, 2) if mean_plddt is not None else None,
        "min_plddt": round(float(np.min(plddt)), 2) if plddt else None,
        "max_plddt": round(float(np.max(plddt)), 2) if plddt else None,
        "plddt_scale": PLDDT_OUTPUT_SCALE,
        "confident_residue_fraction": (
            round(confident_fraction, 3) if confident_fraction is not None else None
        ),
        "plddt_scale_detected": scale,
        "raw_plddt_scale_detected": scale,
        "radius_of_gyration_angstrom": round(rg, 3) if rg is not None else None,
        "end_to_end_distance_angstrom": round(end_to_end, 3) if end_to_end is not None else None,
        "compactness_ratio": compactness,
        "disulfide_geometry": disulfide_report,
    }
