/**
 * Phase 1 Starter Templates — identity-only skeletons.
 *
 * Per project policy (NO fake data, NO assumptions, NO silent fallbacks),
 * templates pre-populate ONLY the verifiable identity fields (compound
 * identifiers, primary target UniProt + gene symbol, indication context).
 * Every clinical / animal / PBPK / DDI number is left blank for the user
 * to provide via Manual Entry — they are the things a real Hakase
 * BioDigital Twin run produces. Templates are starting scaffolds, never
 * fake results.
 */

export interface Phase1Template {
  id: string;
  name: string;
  indication: string;
  compound: {
    smiles: string;
    preferredName: string;
    chemblId: string | null;
    inchiKey: string | null;
  };
  primaryTarget: {
    uniprot: string | null;
    geneSymbol: string | null;
  };
  routeOfAdministration: "oral" | "iv" | "subcutaneous" | "intramuscular";
  speciesId: "rat" | "dog" | "cynomolgus";
  speciesDisplayName: string;
  studyTypeId: "28-day-tox" | "90-day-tox";
  studyTypeLabel: string;
  notes: string;
}

export const PHASE1_TEMPLATES: Phase1Template[] = [
  {
    id: "ibuprofen-oral",
    name: "Ibuprofen — Oral SAD/MAD reference",
    indication: "Inflammation / Pain (reference compound)",
    compound: {
      smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O",
      preferredName: "Ibuprofen",
      chemblId: "CHEMBL521",
      inchiKey: "HEFNNWSXXWATRW-UHFFFAOYSA-N",
    },
    primaryTarget: {
      uniprot: "P23219",
      geneSymbol: "PTGS1",
    },
    routeOfAdministration: "oral",
    speciesId: "rat",
    speciesDisplayName: "Sprague-Dawley Rat",
    studyTypeId: "28-day-tox",
    studyTypeLabel: "28-day repeat-dose toxicology",
    notes:
      "Reference Phase 1 scaffold for an established small-molecule NSAID. " +
      "Compound identity + primary target are pre-filled; all clinical / animal " +
      "numbers must be supplied from a real BioDigital Twin run.",
  },
  {
    id: "imatinib-oral",
    name: "Imatinib — Targeted oral kinase inhibitor",
    indication: "Chronic myeloid leukaemia (BCR-ABL)",
    compound: {
      smiles:
        "CC1=C(C=C(C=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C)NC4=NC=CC(=N4)C5=CN=CC=C5",
      preferredName: "Imatinib",
      chemblId: "CHEMBL941",
      inchiKey: "KTUFNOKKBVMGRW-UHFFFAOYSA-N",
    },
    primaryTarget: {
      uniprot: "P00519",
      geneSymbol: "ABL1",
    },
    routeOfAdministration: "oral",
    speciesId: "dog",
    speciesDisplayName: "Beagle Dog",
    studyTypeId: "28-day-tox",
    studyTypeLabel: "28-day repeat-dose toxicology",
    notes:
      "Targeted kinase inhibitor scaffold (oncology). Identity + primary target " +
      "pre-filled; all PK/PBPK/animal numbers must come from a real run.",
  },
  {
    id: "monoclonal-iv",
    name: "Biologic IV — clean-slate scaffold",
    indication: "Custom — fill in via Manual Entry",
    compound: {
      smiles: "",
      preferredName: "",
      chemblId: null,
      inchiKey: null,
    },
    primaryTarget: {
      uniprot: null,
      geneSymbol: null,
    },
    routeOfAdministration: "iv",
    speciesId: "cynomolgus",
    speciesDisplayName: "Cynomolgus Monkey",
    studyTypeId: "28-day-tox",
    studyTypeLabel: "28-day repeat-dose toxicology",
    notes:
      "Empty IV biologic scaffold (pre-selects cynomolgus + IV route, the " +
      "common large-molecule pre-clinical context). Fill compound identity " +
      "and all numbers via Manual Entry.",
  },
];
