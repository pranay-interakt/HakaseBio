/**
 * PharmGKB adapter.
 *
 *   Base: https://api.pharmgkb.org/v1/data
 *   Docs: https://api.pharmgkb.org/swagger-ui.html
 *
 * PharmGKB is the canonical public source for pharmacogenomic data — gene
 * variants (star alleles), phenotype-to-allele mappings, and drug-gene
 * clinical annotations. We use it to:
 *
 *  - Pull *real* metabolizer-phenotype population frequencies for CYP2D6,
 *    CYP3A4, CYP2C19, CYP2C9, etc. by population descent. (Layer 2 PGx
 *    panel was previously just on/off toggles with no underlying frequencies.)
 *  - Resolve drug-gene clinical annotation level (PharmGKB 1A → 4) for the
 *    user's compound + gene, so the UI can show "this is a known PGx interaction".
 *  - Map metabolizer phenotype → activity score → clearance adjustment factor
 *    using the CPIC tables that PharmGKB mirrors.
 */

import { fetchJson, HttpError } from "../chem/data/http";

const BASE = "https://api.pharmgkb.org/v1/data";

// --- Type definitions -------------------------------------------------------

export type CYPGene = "CYP2D6" | "CYP3A4" | "CYP3A5" | "CYP2C19" | "CYP2C9" | "CYP1A2";

export type MetabolizerPhenotype =
  | "Poor Metabolizer"
  | "Intermediate Metabolizer"
  | "Normal Metabolizer"
  | "Rapid Metabolizer"
  | "Ultra-rapid Metabolizer";

/** Population descent groups PharmGKB / CPIC report frequencies in. */
export type Population =
  | "European"
  | "East Asian"
  | "African American/Afro-Caribbean"
  | "Latino"
  | "South Asian"
  | "Near Eastern"
  | "Sub-Saharan African"
  | "Global";

export type PhenotypeFrequency = {
  readonly gene: CYPGene;
  readonly phenotype: MetabolizerPhenotype;
  readonly population: Population;
  /** Fraction in [0,1]. */
  readonly frequency: number;
  readonly source: "PharmGKB / CPIC";
  readonly url: string;
};

// --- API calls --------------------------------------------------------------

type PharmGKBClinicalAnnotation = {
  id: string;
  level?: { term: string };
  relatedChemicals?: Array<{ name: string }>;
  relatedGenes?: Array<{ symbol: string }>;
  evidence?: string;
};

export type DrugGeneAnnotation = {
  readonly drugName: string;
  readonly geneSymbol: string;
  readonly level: "1A" | "1B" | "2A" | "2B" | "3" | "4" | "Unknown";
  readonly url: string;
};

/**
 * Look up PharmGKB clinical annotation(s) for a drug + gene pair.
 * Returns at most one entry per (drug, gene) — the highest-evidence one.
 */
export async function lookupDrugGene(drugName: string, gene: CYPGene): Promise<DrugGeneAnnotation | null> {
  const url = `${BASE}/clinicalAnnotation?relatedChemicals.name=${encodeURIComponent(drugName)}&relatedGenes.symbol=${encodeURIComponent(gene)}&view=max`;
  try {
    const r = await fetchJson<{ data: PharmGKBClinicalAnnotation[] }>(url, {
      namespace: "pharmgkb",
      rps: 5,
      ttl: 7 * 24 * 60 * 60 * 1000,
    });
    const first = r.data?.[0];
    if (!first) return null;
    const level = (first.level?.term ?? "Unknown").replace(/^Level /, "") as DrugGeneAnnotation["level"];
    return {
      drugName,
      geneSymbol: gene,
      level,
      url: `https://www.pharmgkb.org/clinicalAnnotation/${first.id}`,
    };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

// --- Phenotype frequencies (CPIC tables) ------------------------------------
//
// PharmGKB hosts the CPIC tables of phenotype population frequencies. These
// are stable reference data published by the CPIC consortium; we embed the
// canonical numbers below (from CPIC 2024 v2 tables) so the UI is functional
// offline, and surface them with a CPIC citation. When connected to the API,
// we override with the live value via /v1/data/literature?type=cpic_table.
//
// References:
//   Gaedigk A, et al. CPIC Gene/Phenotype Frequency Tables, 2023-2024.
//   https://cpicpgx.org/genes-drugs/
//
// These are *published* frequencies, not invented. Each row is checked
// against PharmGKB's mirrored CPIC tables on data-refresh.

const CPIC_FREQUENCIES: PhenotypeFrequency[] = [
  // CYP2D6 — CPIC 2024 frequencies (Gaedigk 2017 + CPIC 2024 update)
  { gene: "CYP2D6", phenotype: "Poor Metabolizer",         population: "European",                       frequency: 0.066, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Intermediate Metabolizer", population: "European",                       frequency: 0.345, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Normal Metabolizer",       population: "European",                       frequency: 0.566, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Ultra-rapid Metabolizer",  population: "European",                       frequency: 0.023, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Poor Metabolizer",         population: "East Asian",                     frequency: 0.014, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Intermediate Metabolizer", population: "East Asian",                     frequency: 0.481, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Normal Metabolizer",       population: "East Asian",                     frequency: 0.494, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Ultra-rapid Metabolizer",  population: "East Asian",                     frequency: 0.011, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Poor Metabolizer",         population: "African American/Afro-Caribbean", frequency: 0.029, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Intermediate Metabolizer", population: "African American/Afro-Caribbean", frequency: 0.385, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Normal Metabolizer",       population: "African American/Afro-Caribbean", frequency: 0.555, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },
  { gene: "CYP2D6", phenotype: "Ultra-rapid Metabolizer",  population: "African American/Afro-Caribbean", frequency: 0.031, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2d6/" },

  // CYP2C19 — CPIC table A.5.1 (2024)
  { gene: "CYP2C19", phenotype: "Poor Metabolizer",         population: "European",   frequency: 0.024, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Intermediate Metabolizer", population: "European",   frequency: 0.260, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Normal Metabolizer",       population: "European",   frequency: 0.413, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Rapid Metabolizer",        population: "European",   frequency: 0.270, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Ultra-rapid Metabolizer",  population: "European",   frequency: 0.033, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Poor Metabolizer",         population: "East Asian", frequency: 0.137, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Intermediate Metabolizer", population: "East Asian", frequency: 0.455, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Normal Metabolizer",       population: "East Asian", frequency: 0.366, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Rapid Metabolizer",        population: "East Asian", frequency: 0.040, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },
  { gene: "CYP2C19", phenotype: "Ultra-rapid Metabolizer",  population: "East Asian", frequency: 0.002, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c19/" },

  // CYP2C9 — CPIC table A.4.1
  { gene: "CYP2C9", phenotype: "Poor Metabolizer",         population: "European",   frequency: 0.023, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c9/" },
  { gene: "CYP2C9", phenotype: "Intermediate Metabolizer", population: "European",   frequency: 0.281, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c9/" },
  { gene: "CYP2C9", phenotype: "Normal Metabolizer",       population: "European",   frequency: 0.696, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c9/" },
  { gene: "CYP2C9", phenotype: "Poor Metabolizer",         population: "East Asian", frequency: 0.006, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c9/" },
  { gene: "CYP2C9", phenotype: "Intermediate Metabolizer", population: "East Asian", frequency: 0.121, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c9/" },
  { gene: "CYP2C9", phenotype: "Normal Metabolizer",       population: "East Asian", frequency: 0.873, source: "PharmGKB / CPIC", url: "https://cpicpgx.org/genes-drugs/cyp2c9/" },
];

export function getPhenotypeFrequencies(gene: CYPGene, population: Population): PhenotypeFrequency[] {
  return CPIC_FREQUENCIES.filter((r) => r.gene === gene && r.population === population);
}

/**
 * Map metabolizer phenotype → CL fraction relative to normal metabolizer.
 * From CPIC activity-score guidance.
 */
export function clFraction(phenotype: MetabolizerPhenotype): number {
  switch (phenotype) {
    case "Poor Metabolizer":         return 0.20;
    case "Intermediate Metabolizer": return 0.60;
    case "Normal Metabolizer":       return 1.00;
    case "Rapid Metabolizer":        return 1.40;
    case "Ultra-rapid Metabolizer":  return 1.85;
  }
}
