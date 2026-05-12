/**
 * Aqueous solubility — ESOL.
 *
 * Reference:
 *   Delaney, J. S. "ESOL: Estimating Aqueous Solubility Directly from
 *    Molecular Structure." J. Chem. Inf. Comput. Sci. 2004, 44, 1000–1005.
 *    doi:10.1021/ci034243x
 *
 * Equation 1 of the paper:
 *
 *   logS = 0.16 − 0.63·clogP − 0.0062·MWT + 0.066·RB − 0.74·AP
 *
 *     RB = number of rotatable bonds
 *     AP = aromatic proportion = (aromatic atoms) / (heavy atoms)
 *
 * The paper reports RMSE ≈ 0.83 log units on the 2,874-compound training set.
 *
 * Coverage / applicability domain:
 *   MW 100–700 Da, logP -3 to +6. Outside this we flag outOfDomain.
 */

import type { Descriptors, Predicted } from "./types";
import type { RDKitMol } from "./rdkit-loader";

function aromaticProportion(_mol: RDKitMol, d: Descriptors): number {
  // RDKit MinimalLib returns NumAromaticRings but not aromatic atoms.
  // A close estimate: aromatic_atoms ≈ 6 * NumAromaticRings minus shared atoms.
  // For drug-like rings (mostly benzene/pyridine), ~6 per ring with -2 per
  // fused ring pair. We use a simple 6·rings, then cap at heavyAtoms.
  // For final-grade accuracy, swap to mol.get_aromatic_atom_count() — not
  // exposed in MinimalLib at time of writing.
  const aromaticAtoms = Math.min(d.heavyAtoms, 6 * d.aromaticRings);
  return d.heavyAtoms > 0 ? aromaticAtoms / d.heavyAtoms : 0;
}

export function computeESOL(mol: RDKitMol, d: Descriptors): Predicted<number> {
  const ap = aromaticProportion(mol, d);
  const logS = 0.16 - 0.63 * d.clogP - 0.0062 * d.mw + 0.066 * d.rotatableBonds - 0.74 * ap;
  const ood = d.mw < 100 || d.mw > 700 || d.clogP < -3 || d.clogP > 6;
  return {
    value: logS,
    confidence: ood ? 0.45 : 0.85,
    ci95: [logS - 1.63, logS + 1.63], // ±1.96·RMSE
    outOfDomain: ood,
    provenance: {
      model: "ESOL",
      reference: "Delaney 2004, J. Chem. Inf. Comput. Sci. 44:1000",
      doi: "10.1021/ci034243x",
      year: 2004,
      note: ood ? "Outside ESOL training domain (MW 100–700, logP -3 to 6)" : undefined,
    },
  };
}
