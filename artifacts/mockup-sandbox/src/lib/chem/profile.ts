/**
 * Top-level "evaluate this molecule" entry point.
 *
 * Given a SMILES string, returns a complete `MolecularProfile`:
 *   - canonical SMILES, InChI, InChI key, formula
 *   - all standard descriptors
 *   - drug-likeness verdicts (Lipinski, Veber, Egan, Ghose, Muegge, Pfizer, GSK)
 *   - QED (Bickerton 2012)
 *   - SA score (Ertl 2009)
 *   - structural alerts (PAINS A/B/C, Brenk, NIH)
 *   - aqueous solubility (Delaney ESOL)
 *   - 19-axis ADMET profile + 5-axis aggregate
 *
 * Everything runs locally in WASM (RDKit) + pure TS. No network access here.
 */

import type { MolecularProfile, RankingWeights } from "./types";
import { parseMol } from "./rdkit-loader";
import { descriptorsFromMol } from "./descriptors";
import { computeDrugLikeness } from "./druglikeness";
import { computeQED } from "./qed";
import { computeSA } from "./sascore";
import { detectAlerts } from "./alerts";
import { computeESOL } from "./solubility";
import { computeADMET } from "./admet";
import { getRDKit } from "./rdkit-loader";

export async function evaluateMolecule(smiles: string): Promise<MolecularProfile> {
  const rdkit = await getRDKit();
  const mol = await parseMol(smiles);
  try {
    const canonicalSmiles = mol.get_smiles();
    const inchi = mol.get_inchi();
    const inchiKey = rdkit.get_inchikey_for_inchi(inchi);
    const descriptors = descriptorsFromMol(mol);
    const druglikeness = computeDrugLikeness(descriptors);
    const alerts = await detectAlerts(mol);
    const qed = await computeQED(mol, descriptors);
    const saScore = computeSA(mol, descriptors);
    const solubility = computeESOL(mol, descriptors);
    const admet = computeADMET(descriptors, alerts);
    return {
      smiles,
      canonicalSmiles,
      inchi,
      inchiKey,
      descriptors,
      druglikeness,
      qed,
      saScore,
      alerts,
      solubility,
      admet,
    };
  } finally {
    mol.delete();
  }
}

/**
 * Compute a composite ranking score in [0, 1] using user-supplied weights.
 * Higher = better candidate. Used by the BatchTable / composite ranking UI.
 *
 *   composite = w_qed · QED
 *             + w_tox · (1 − P(any toxicity flag))
 *             + w_bind · binding_score
 *             + w_sa  · (1 − (SA − 1)/9)            ; map SA score 1→1, 10→0
 *
 * `bindingScore` should be a [0, 1] mapping of pKi/pIC50 against the user's
 * target of interest; if not supplied we use the absorption-aggregate as a
 * sensible default proxy.
 */
export function compositeScore(
  profile: MolecularProfile,
  weights: RankingWeights,
  bindingScore?: number,
): number {
  const wSum = Math.max(1e-9, weights.qed + weights.toxicity + weights.binding + weights.sa);
  const w = {
    qed: weights.qed / wSum,
    toxicity: weights.toxicity / wSum,
    binding: weights.binding / wSum,
    sa: weights.sa / wSum,
  };
  const toxScore = profile.admet.aggregate.toxicity;
  const saMapped = Math.max(0, 1 - (profile.saScore.value - 1) / 9);
  const bScore = bindingScore ?? profile.admet.aggregate.absorption;
  return w.qed * profile.qed.value
    + w.toxicity * toxScore
    + w.binding * bScore
    + w.sa * saMapped;
}

/**
 * Convert pKi (M⁻¹) ↔ nanomolar binding constant.
 * Cheng-Prusoff-style direct conversion. Useful for normalising ChEMBL
 * activity to a 0–1 score for compositeScore.
 */
export function pKiToNanomolar(pKi: number): number {
  return Math.pow(10, -pKi) * 1e9;
}

export function nanomolarToPKi(nM: number): number {
  return -Math.log10(nM / 1e9);
}

/**
 * Map a binding affinity in nanomolar to a [0,1] score using a logistic
 * centered at 100 nM (typical late-stage potency threshold). 1 nM → ~0.99,
 * 1 µM → ~0.30, 10 µM → ~0.05.
 */
export function bindingScoreFromNanomolar(nM: number): number {
  const pKi = nanomolarToPKi(nM);
  return 1 / (1 + Math.exp(-(pKi - 7))); // centered at 100 nM (pKi 7)
}
