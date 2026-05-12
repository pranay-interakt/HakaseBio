/**
 * SMILES utilities backed by RDKit.
 *
 * Replaces the previous heuristic ("does the string have any characters? then
 * it's valid and MW = 206.3 Da") with actual structure parsing.
 */

import { getRDKit, withMol } from "./rdkit-loader";

export type SmilesValidation =
  | { readonly valid: true; readonly canonical: string; readonly inchi: string; readonly inchiKey: string; readonly formula: string }
  | { readonly valid: false; readonly reason: string };

/**
 * Validate a SMILES string by attempting to parse it with RDKit.
 * Cheap (~1 ms after WASM is warm). Never throws.
 */
export async function validateSmiles(smiles: string): Promise<SmilesValidation> {
  const trimmed = smiles.trim();
  if (!trimmed) {
    return { valid: false, reason: "Empty SMILES" };
  }
  // Quick syntactic guards before paying the WASM cost.
  if (trimmed.length > 1024) {
    return { valid: false, reason: "SMILES exceeds 1024 characters" };
  }
  try {
    const rdkit = await getRDKit();
    const mol = rdkit.get_mol(trimmed);
    if (!mol || !mol.is_valid()) {
      mol?.delete?.();
      return { valid: false, reason: "SMILES could not be parsed into a valid molecule" };
    }
    try {
      const canonical = mol.get_smiles();
      const inchi = mol.get_inchi();
      const inchiKey = rdkit.get_inchikey_for_inchi(inchi);
      const formula = mol.get_mol_formula();
      return { valid: true, canonical, inchi, inchiKey, formula };
    } finally {
      mol.delete();
    }
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Canonicalize a SMILES string. Throws on invalid input. */
export async function canonicalize(smiles: string): Promise<string> {
  return withMol(smiles, (m) => m.get_smiles());
}

/** Get the InChI Key, which is the universally stable molecule identifier. */
export async function inchiKey(smiles: string): Promise<string> {
  const rdkit = await getRDKit();
  return withMol(smiles, (m) => rdkit.get_inchikey_for_inchi(m.get_inchi()));
}

/** Render the molecule as an SVG depiction (CoordGen). */
export async function depictSvg(
  smiles: string,
  opts: { width?: number; height?: number } = {},
): Promise<string> {
  return withMol(smiles, (m) => m.get_svg(opts.width ?? 300, opts.height ?? 200));
}
