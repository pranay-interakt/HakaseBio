/**
 * chem-core — production-grade cheminformatics for Hakase BioTwin Layer 1.
 *
 * Public API.
 *
 *   evaluateMolecule(smiles)        Full per-molecule profile (descriptors,
 *                                   drug-likeness, QED, SA, alerts, ADMET,
 *                                   solubility).
 *   validateSmiles(smiles)          Parse-only validation (cheap).
 *   computeDescriptors(smiles)      Just the descriptor block.
 *   compositeScore(profile, w)      Composite ranking score for batch sorting.
 *   resolvePubChem(query)           Real PubChem PUG-REST lookup.
 *   getChEMBLById(id)               Real ChEMBL REST lookup.
 *   getUniProt(acc)                 Real UniProt REST lookup.
 *   lookupPdb(pdbId)                Real RCSB PDB REST lookup.
 *   structuresForUniprot(acc)       Real RCSB search for structures.
 *   getBindingMeasurements(...)     Real ChEMBL binding data.
 *
 * Every model output carries `provenance` (paper reference + DOI + year +
 * applicability note). Every external data fetch carries the source URL.
 */

export type {
  Descriptors, DrugLikeness, DrugLikenessRule, AlertHit, StructuralAlerts,
  ADMETProfile, ADMETValue, MolecularProfile, Predicted, Provenance,
  RankingWeights, BindingMeasurement, Solubility,
} from "./types";

export { validateSmiles, canonicalize, inchiKey, depictSvg } from "./smiles";
export type { SmilesValidation } from "./smiles";

export { computeDescriptors } from "./descriptors";
export { computeDrugLikeness } from "./druglikeness";
export { computeQEDFromDescriptors } from "./qed";
export { computeSA } from "./sascore";
export { detectAlerts } from "./alerts";
export { computeESOL } from "./solubility";
export { computeADMET } from "./admet";
export {
  evaluateMolecule, compositeScore,
  pKiToNanomolar, nanomolarToPKi, bindingScoreFromNanomolar,
} from "./profile";
export { getRDKit, parseMol, withMol } from "./rdkit-loader";

export {
  getPubChemByCid, getPubChemByName, getPubChemByInchiKey, resolvePubChem,
} from "./data/pubchem";
export type { PubChemCompound } from "./data/pubchem";

export {
  getChEMBLById, getChEMBLByInchiKey, searchChEMBLByName, getBindingMeasurements,
} from "./data/chembl";
export type { ChEMBLCompound } from "./data/chembl";

export { getUniProt } from "./data/uniprot";
export type { UniProtEntry } from "./data/uniprot";

export { lookupPdb, structuresForUniprot } from "./data/rcsb";
export type { PdbEntry } from "./data/rcsb";
