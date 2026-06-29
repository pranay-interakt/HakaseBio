/**
 * Single source of truth for ADMET endpoint units.
 *
 * Every numeric ADMET / in-vitro output the pipeline produces is reachable
 * here. The UI MUST use `formatAdmetValue(key, value)` (or `unitFor(key)`)
 * instead of hand-typing "nM" / "µM" / "L/kg" — that's how we guarantee a
 * unitless number never reaches a buyer's screen.
 *
 * Conventions
 * ───────────
 * - `unit`           short human label rendered next to the number
 * - `decimals`       how many digits past the decimal point to show
 * - `scale`          optional multiplier applied at display time (e.g. ML
 *                    overlay returns PPB as a fraction 0–1; UI shows %)
 * - `siUnit`         canonical SI / pharmacology unit string (good for CSV
 *                    export, regulatory submissions, audit trails)
 * - `references`     where the convention comes from (FDA guidance, IUPAC,
 *                    DrugCentral schema, ChEMBL standard_units).
 *
 * Adding a new ADMET output? Add an entry here BEFORE touching the UI.
 */

export interface UnitSpec {
  unit: string;          // short display: "nM", "µM", "L/kg", "h"
  siUnit: string;        // canonical for export: "nmol/L", "L·kg^-1"
  decimals: number;      // formatting precision
  scale?: number;        // optional multiplier (e.g. 100 to convert 0–1 → %)
  description: string;   // 1-line UI tooltip
}

export const ADMET_UNITS: Record<string, UnitSpec> = {
  // ── Absorption ──────────────────────────────────────────────────────────
  caco2_papp: {
    unit: "×10⁻⁶ cm/s",
    siUnit: "1e-6 cm/s",
    decimals: 1,
    description: "Caco-2 apparent permeability (apical→basolateral)",
  },
  caco2_log_papp: {
    unit: "log cm/s",
    siUnit: "log10(cm·s^-1)",
    decimals: 2,
    description: "Caco-2 log10 apparent permeability",
  },
  hia_probability: {
    unit: "%",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "Human intestinal absorption probability",
  },
  bioavailability_F: {
    unit: "%",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "Oral bioavailability fraction F",
  },
  pgp_substrate_prob: {
    unit: "% probability",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "P-glycoprotein substrate probability",
  },
  pampa_pe: {
    unit: "×10⁻⁶ cm/s",
    siUnit: "1e-6 cm/s",
    decimals: 1,
    description: "PAMPA effective permeability",
  },
  efflux_ratio: {
    unit: "ratio (B→A / A→B)",
    siUnit: "dimensionless",
    decimals: 2,
    description: "Basolateral→apical / apical→basolateral efflux ratio",
  },

  // ── Distribution ────────────────────────────────────────────────────────
  bbb_probability: {
    unit: "% probability",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "Blood-brain barrier penetration probability",
  },
  ppb_percent: {
    unit: "%",
    siUnit: "percent bound",
    decimals: 1,
    description: "Plasma protein binding",
  },
  ppb_fu_fraction: {
    unit: "% unbound",
    siUnit: "percent",
    decimals: 2,
    scale: 100,
    description: "Plasma free fraction (fu)",
  },
  vd_l_per_kg: {
    unit: "L/kg",
    siUnit: "L·kg^-1",
    decimals: 2,
    description: "Volume of distribution at steady state (Vd,ss)",
  },

  // ── Metabolism ──────────────────────────────────────────────────────────
  hepatocyte_clint_ul_min_1e6_cells: {
    unit: "µL/min/10⁶ cells",
    siUnit: "µL·min^-1·10^6 cells^-1",
    decimals: 1,
    description: "Intrinsic hepatocyte clearance",
  },
  microsomal_clint_ul_min_mg: {
    unit: "µL/min/mg",
    siUnit: "µL·min^-1·mg^-1",
    decimals: 1,
    description: "Intrinsic microsomal clearance",
  },
  hepatic_clearance: {
    unit: "mL/min/kg",
    siUnit: "mL·min^-1·kg^-1",
    decimals: 2,
    description: "Hepatic clearance",
  },
  renal_clearance: {
    unit: "mL/min/kg",
    siUnit: "mL·min^-1·kg^-1",
    decimals: 2,
    description: "Renal clearance",
  },
  cyp_inhibition_prob: {
    unit: "% probability",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "CYP isoform inhibitor probability",
  },
  cyp_ic50_um: {
    unit: "µM",
    siUnit: "µmol/L",
    decimals: 2,
    description: "CYP inhibitor IC50",
  },

  // ── Excretion ───────────────────────────────────────────────────────────
  half_life_h: {
    unit: "h",
    siUnit: "hours",
    decimals: 1,
    description: "Elimination half-life",
  },
  half_life_min: {
    unit: "min",
    siUnit: "minutes",
    decimals: 0,
    description: "Elimination half-life",
  },
  total_clearance: {
    unit: "mL/min/kg",
    siUnit: "mL·min^-1·kg^-1",
    decimals: 2,
    description: "Total body clearance",
  },

  // ── Toxicity ────────────────────────────────────────────────────────────
  herg_blocker_prob: {
    unit: "% probability",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "hERG channel blocker probability",
  },
  herg_ic50_um: {
    unit: "µM",
    siUnit: "µmol/L",
    decimals: 2,
    description: "hERG patch-clamp IC50",
  },
  ames_prob: {
    unit: "% probability",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "Ames mutagenicity probability",
  },
  dili_prob: {
    unit: "% probability",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "Drug-induced liver injury probability",
  },
  clintox_prob: {
    unit: "% probability",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "Clinical-trial toxicity probability",
  },
  carcinogen_prob: {
    unit: "% probability",
    siUnit: "percent",
    decimals: 1,
    scale: 100,
    description: "Rodent carcinogenicity probability",
  },
  ld50_mg_kg: {
    unit: "mg/kg",
    siUnit: "mg·kg^-1",
    decimals: 0,
    description: "Acute oral rat LD50",
  },
  ld50_log_mol_kg: {
    unit: "log mol/kg",
    siUnit: "log10(mol·kg^-1)",
    decimals: 2,
    description: "ADMET-AI Zhu LD50 (log mol/kg)",
  },
  mrdd_mg: {
    unit: "mg/day",
    siUnit: "mg·d^-1",
    decimals: 0,
    description: "Maximum recommended daily dose",
  },

  // ── Potency / binding ──────────────────────────────────────────────────
  ic50_nm: {
    unit: "nM",
    siUnit: "nmol/L",
    decimals: 1,
    description: "Half-maximal inhibitory concentration",
  },
  ec50_nm: {
    unit: "nM",
    siUnit: "nmol/L",
    decimals: 1,
    description: "Half-maximal effective concentration",
  },
  ki_nm: {
    unit: "nM",
    siUnit: "nmol/L",
    decimals: 1,
    description: "Inhibition constant",
  },
  kd_nm: {
    unit: "nM",
    siUnit: "nmol/L",
    decimals: 1,
    description: "Dissociation constant",
  },
  pkd: {
    unit: "-log10(M)",
    siUnit: "pKd",
    decimals: 2,
    description: "-log10(Kd in mol/L)",
  },
  pic50: {
    unit: "-log10(M)",
    siUnit: "pIC50",
    decimals: 2,
    description: "-log10(IC50 in mol/L)",
  },
  cc50_um: {
    unit: "µM",
    siUnit: "µmol/L",
    decimals: 2,
    description: "50% cytotoxic concentration",
  },
  therapeutic_index: {
    unit: "× (CC50/IC50)",
    siUnit: "dimensionless",
    decimals: 1,
    description: "Therapeutic index = CC50 / IC50",
  },

  // ── Solubility ──────────────────────────────────────────────────────────
  log_s: {
    unit: "log mol/L",
    siUnit: "log10(mol·L^-1)",
    decimals: 2,
    description: "Aqueous solubility (log10)",
  },
  solubility_mg_ml: {
    unit: "mg/mL",
    siUnit: "mg·mL^-1",
    decimals: 3,
    description: "Aqueous solubility at 25 °C, pH 7.4",
  },

  // ── Lipophilicity / physchem ────────────────────────────────────────────
  logp: {
    unit: "log P",
    siUnit: "log10(Po/w)",
    decimals: 2,
    description: "Octanol/water partition coefficient",
  },
  logd_7_4: {
    unit: "log D",
    siUnit: "log10(D7.4)",
    decimals: 2,
    description: "Distribution coefficient at pH 7.4",
  },
  tpsa: {
    unit: "Å²",
    siUnit: "Å²",
    decimals: 1,
    description: "Topological polar surface area",
  },
  mol_weight: {
    unit: "Da",
    siUnit: "g·mol^-1",
    decimals: 1,
    description: "Molecular weight",
  },

  // ── Drug-likeness ───────────────────────────────────────────────────────
  qed: {
    unit: "0–1",
    siUnit: "dimensionless",
    decimals: 3,
    description: "Bickerton drug-likeness (QED)",
  },
  sa_score: {
    unit: "1–10 (easy→hard)",
    siUnit: "dimensionless",
    decimals: 1,
    description: "Synthetic accessibility (Ertl-Schuffenhauer)",
  },
};

/** Format a numeric ADMET value with its unit. Returns "—" when value is null/undefined/non-finite. */
export function formatAdmetValue(key: string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const spec = ADMET_UNITS[key];
  if (!spec) return value.toString();
  const v = value * (spec.scale ?? 1);
  return `${v.toFixed(spec.decimals)} ${spec.unit}`;
}

/** Just the unit string for a given endpoint, or empty string if unknown. */
export function unitFor(key: string): string {
  return ADMET_UNITS[key]?.unit ?? "";
}

/** SI/regulatory unit string for CSV export, audit trails. */
export function siUnitFor(key: string): string {
  return ADMET_UNITS[key]?.siUnit ?? "";
}

/** Human-readable description for tooltips. */
export function descriptionFor(key: string): string {
  return ADMET_UNITS[key]?.description ?? "";
}

/** Bundle for tests / introspection. */
export function listKnownEndpoints(): string[] {
  return Object.keys(ADMET_UNITS);
}
