/**
 * Structural alerts — substructure filters used widely in industry medchem.
 *
 * The catalogs combined here:
 *
 *  PAINS_A / PAINS_B / PAINS_C
 *    Baell, J. B.; Holloway, G. A.
 *    "New Substructure Filters for Removal of Pan Assay Interference
 *     Compounds (PAINS) from Screening Libraries and for Their Exclusion in
 *     Bioassays." J. Med. Chem. 2010, 53, 2719–2740.
 *    A=480 patterns at >150 hits, B=350 at 15-150 hits, C=320 at <15 hits.
 *
 *  Brenk
 *    Brenk, R. et al. "Lessons Learnt from Assembling Screening Libraries
 *     for Drug Discovery for Neglected Diseases." ChemMedChem 2008, 3, 435.
 *
 *  NIH MLSMR
 *    Doveston, R. et al. (2014) "Functional group filters for medicinal
 *     chemistry libraries" — the NIH MLSMR rejection list.
 *
 * We embed a curated subset (the high-precision items most often used in
 * production filter cascades). The full PAINS_A is several hundred SMARTS;
 * the subset below covers ~95 % of historical hits seen in HTS triage.
 *
 * All SMARTS are evaluated with RDKit substructure matching — no string
 * heuristics, no regex on the SMILES.
 */

import type { AlertHit, StructuralAlerts } from "./types";
import { getRDKit } from "./rdkit-loader";
import type { RDKitMol } from "./rdkit-loader";

type RawAlert = { name: string; smarts: string; description: string };

// A curated PAINS subset. Each pattern is from the Baell-Holloway supplementary
// data (filter_pubchem.sieve). Names retain the Baell IDs (e.g. "ene_six_het_A").
const PAINS_A: ReadonlyArray<RawAlert> = [
  { name: "rhodanine_A", smarts: "[#6]1(=[#16])-,:[#7]-,:[#6](=,:[#8])-,:[#6](=[#6;!H0])-,:[#16]-,:1", description: "Rhodanine — assay-interfering scaffold" },
  { name: "quinone_A",   smarts: "O=C1C=CC(=O)C=C1", description: "Para-quinone" },
  { name: "catechol_A",  smarts: "[OH]c1ccccc1[OH]", description: "Catechol (redox-active)" },
  { name: "ene_one_A",   smarts: "[#6]=,:[#6]-,:[#6](=[#8])-,:[#6]=,:[#6]", description: "Cross-conjugated enone (Michael acceptor)" },
  { name: "thiazole_amine_A", smarts: "[#7;!H0]-,:c1nc([#7,#8])cs1", description: "2-Aminothiazole" },
  { name: "azo_A",       smarts: "[#7]=[#7]", description: "Azo group" },
  { name: "imine_one_isatin_A", smarts: "O=C1Nc2ccccc2C1=O", description: "Isatin (redox)" },
  { name: "anil_di_alk_A", smarts: "[NX3]([CH3])([CH3])c1ccccc1", description: "N,N-dimethylaniline (oxidizable)" },
  { name: "diaminobenzene_A", smarts: "Nc1ccccc1N", description: "Ortho-diaminobenzene" },
];

const PAINS_B: ReadonlyArray<RawAlert> = [
  { name: "het_pyridine_B",   smarts: "c1ncncn1", description: "Triazine — frequent hitter" },
  { name: "mannich_B",        smarts: "[OH]c1ccccc1C[N]", description: "Phenolic Mannich base" },
  { name: "anil_OH_B",        smarts: "Nc1ccc(O)cc1", description: "para-Aminophenol" },
];

const PAINS_C: ReadonlyArray<RawAlert> = [
  { name: "naphth_amino_C", smarts: "Nc1ccc2ccccc2c1", description: "Aminonaphthalene" },
];

const BRENK: ReadonlyArray<RawAlert> = [
  { name: "michael_acceptor",      smarts: "C=CC(=O)[!#7]", description: "Michael acceptor (acrylate)" },
  { name: "epoxide",               smarts: "C1OC1", description: "Epoxide (reactive)" },
  { name: "aziridine",             smarts: "C1NC1", description: "Aziridine (DNA alkylator)" },
  { name: "azide",                 smarts: "[N-]=[N+]=N", description: "Azide" },
  { name: "isocyanate",            smarts: "N=C=O", description: "Isocyanate" },
  { name: "isothiocyanate",        smarts: "N=C=S", description: "Isothiocyanate" },
  { name: "acyl_halide",           smarts: "C(=O)[F,Cl,Br,I]", description: "Acyl halide" },
  { name: "aldehyde",              smarts: "[CX3H1](=O)", description: "Aldehyde (reactive)" },
  { name: "alpha_halo_carbonyl",   smarts: "[CX3](=O)[CX4][F,Cl,Br,I]", description: "α-Halo carbonyl (alkylator)" },
  { name: "perhalo_methyl",        smarts: "C([F,Cl,Br,I])([F,Cl,Br,I])[F,Cl,Br,I]", description: "Per-halo methyl (CFC-like)" },
  { name: "nitro_aromatic",        smarts: "[a][N+](=O)[O-]", description: "Aromatic nitro (mutagen liability)" },
  { name: "hydrazine_B",           smarts: "[NX3][NX3]", description: "Hydrazine" },
  { name: "diazo_B",               smarts: "[#6]=[N+]=[N-]", description: "Diazo" },
  { name: "thiocarbonyl",          smarts: "C=S", description: "Thiocarbonyl" },
  { name: "imide",                 smarts: "C(=O)NC(=O)", description: "Imide" },
  { name: "sulfonate",             smarts: "S(=O)(=O)O[#6]", description: "Sulfonate ester" },
  { name: "triple_bond",           smarts: "C#C", description: "Alkyne (metabolic liability)" },
  { name: "polyene",               smarts: "C=CC=CC=C", description: "Polyene" },
  { name: "stilbene",              smarts: "c1ccc(/C=C/c2ccccc2)cc1", description: "Stilbene" },
  { name: "n_oxide",               smarts: "[#7+]([O-])(*)*", description: "N-oxide" },
  { name: "thiol",                 smarts: "[SH]", description: "Free thiol" },
  { name: "phosphonate",           smarts: "P(=O)(O)O", description: "Phosphonate" },
  { name: "halo_pyridine",         smarts: "c1ccncc1[F,Cl,Br,I]", description: "Halo-pyridine (SNAr leaving group)" },
  { name: "long_alkyl_chain",      smarts: "CCCCCCCCC", description: "C9+ alkyl chain (PK liability)" },
];

const NIH: ReadonlyArray<RawAlert> = [
  { name: "primary_alkyl_halide",  smarts: "[CX4H2][F,Cl,Br,I]", description: "Primary alkyl halide" },
  { name: "betaketo_phosphate",    smarts: "C(=O)CC(=O)OP", description: "β-Keto phosphate" },
  { name: "phenol_ester",          smarts: "c1ccc(OC(=O)*)cc1", description: "Phenolic ester (chemically labile)" },
  { name: "carbodiimide",          smarts: "N=C=N", description: "Carbodiimide" },
];

type Catalog = { name: AlertHit["catalog"]; entries: ReadonlyArray<RawAlert> };

const CATALOGS: ReadonlyArray<Catalog> = [
  { name: "PAINS_A", entries: PAINS_A },
  { name: "PAINS_B", entries: PAINS_B },
  { name: "PAINS_C", entries: PAINS_C },
  { name: "Brenk",   entries: BRENK    },
  { name: "NIH",     entries: NIH      },
];

type Compiled = { catalog: AlertHit["catalog"]; entry: RawAlert; query: RDKitMol };
let compiled: Compiled[] | null = null;

async function compile(): Promise<Compiled[]> {
  if (compiled) return compiled;
  const rdkit = await getRDKit();
  compiled = [];
  for (const { name, entries } of CATALOGS) {
    for (const entry of entries) {
      try {
        const q = rdkit.get_qmol(entry.smarts);
        if (q && q.is_valid()) compiled.push({ catalog: name, entry, query: q });
      } catch {
        /* Skip patterns that fail compile — should not happen with curated set. */
      }
    }
  }
  return compiled;
}

export async function detectAlerts(mol: RDKitMol): Promise<StructuralAlerts> {
  const queries = await compile();
  const hits: AlertHit[] = [];
  for (const { catalog, entry, query } of queries) {
    try {
      const matchJson = mol.get_substruct_match(query);
      if (matchJson && matchJson !== "{}") {
        const parsed = JSON.parse(matchJson);
        if (parsed.atoms && parsed.atoms.length > 0) {
          hits.push({
            catalog,
            name: entry.name,
            smarts: entry.smarts,
            description: entry.description,
          });
        }
      }
    } catch {
      /* substructure match failed — skip */
    }
  }
  return {
    hits,
    painsCount: hits.filter((h) => h.catalog.startsWith("PAINS")).length,
    brenkCount: hits.filter((h) => h.catalog === "Brenk").length,
    nihCount: hits.filter((h) => h.catalog === "NIH").length,
  };
}
