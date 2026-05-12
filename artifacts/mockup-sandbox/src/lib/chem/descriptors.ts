/**
 * Molecular descriptors via RDKit.
 *
 * RDKit's get_descriptors() returns a JSON blob with these fields, all computed
 * using the original algorithms shipped with RDKit (so the values match the
 * Python toolkit byte-for-byte):
 *
 *   amw                  : average molecular weight (Da)
 *   exactmw              : monoisotopic mass (Da)
 *   lipinskiHBA          : Lipinski H-bond acceptors (N or O)
 *   lipinskiHBD          : Lipinski H-bond donors (NH or OH)
 *   NumHBA               : RDKit HBA (Daylight definition)
 *   NumHBD               : RDKit HBD (Daylight definition)
 *   NumRotatableBonds    : rotatable bond count (RDKit definition)
 *   NumHeavyAtoms        : heavy atom count
 *   NumAtoms             : total atoms incl. H
 *   NumRings             : SSSR ring count
 *   NumAromaticRings     : aromatic rings
 *   NumAliphaticRings    : aliphatic rings
 *   NumHeteroatoms       : non-C/H atoms
 *   FractionCSP3         : Lovering 2009 Fsp3
 *   tpsa                 : Ertl 2000 topological polar surface area
 *   CrippenClogP         : Wildman & Crippen 1999 logP
 *   CrippenMR            : Wildman & Crippen molar refractivity
 *   NumAtomStereoCenters : assigned tetrahedral stereo centers
 *
 * Wildman, S. A.; Crippen, G. M.
 *   "Prediction of physicochemical parameters by atomic contributions."
 *   J. Chem. Inf. Comput. Sci. 1999, 39, 868–873.
 * Ertl, P.; Rohde, B.; Selzer, P.
 *   "Fast Calculation of Molecular Polar Surface Area..."
 *   J. Med. Chem. 2000, 43, 3714–3717.
 * Lovering, F.; Bikker, J.; Humblet, C.
 *   "Escape from Flatland..." J. Med. Chem. 2009, 52, 6752.
 */

import type { Descriptors } from "./types";
import { parseMol } from "./rdkit-loader";
import type { RDKitMol } from "./rdkit-loader";

type RDKitDescriptorJSON = {
  amw: number;
  exactmw: number;
  lipinskiHBA: number;
  lipinskiHBD: number;
  NumHBA: number;
  NumHBD: number;
  NumRotatableBonds: number;
  NumHeavyAtoms: number;
  NumAtoms: number;
  NumRings: number;
  NumAromaticRings: number;
  NumAliphaticRings: number;
  NumSaturatedRings?: number;
  NumHeteroatoms: number;
  FractionCSP3: number;
  tpsa: number;
  CrippenClogP: number;
  CrippenMR: number;
  NumAtomStereoCenters?: number;
};

export function descriptorsFromMol(mol: RDKitMol): Descriptors {
  const raw = JSON.parse(mol.get_descriptors()) as RDKitDescriptorJSON;
  return {
    mw: raw.amw,
    exactMass: raw.exactmw,
    formula: mol.get_mol_formula(),
    clogP: raw.CrippenClogP,
    mr: raw.CrippenMR,
    tpsa: raw.tpsa,
    hba: raw.lipinskiHBA,
    hbd: raw.lipinskiHBD,
    rotatableBonds: raw.NumRotatableBonds,
    heavyAtoms: raw.NumHeavyAtoms,
    aromaticRings: raw.NumAromaticRings,
    aliphaticRings: raw.NumAliphaticRings,
    totalRings: raw.NumRings,
    fsp3: raw.FractionCSP3,
    heteroatoms: raw.NumHeteroatoms,
    stereocenters: raw.NumAtomStereoCenters ?? 0,
  };
}

export async function computeDescriptors(smiles: string): Promise<Descriptors> {
  const mol = await parseMol(smiles);
  try {
    return descriptorsFromMol(mol);
  } finally {
    mol.delete();
  }
}
