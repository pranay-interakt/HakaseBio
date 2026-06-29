/**
 * ADMET-AI endpoint metadata — units, readable names, and per-endpoint
 * benchmark accuracy.
 * ─────────────────────────────────────────────────────────────────────────
 * This is transcribed verbatim from the ADMET-AI package's own metadata file
 * (`admet_ai/resources/data/admet.csv`, bundled with the model that produces
 * these predictions) so the UI can show the CORRECT unit and an honest
 * reliability tier next to every number instead of a bare float.
 *
 * Two facts this encodes that matter for trust:
 *   1. CLASSIFICATION endpoints (hERG, AMES, DILI, CYPs, BBB, …) are
 *      probabilities in [0,1]; their accuracy is the published TEST-set
 *      AUROC on the TDC benchmark.
 *   2. REGRESSION endpoints have real units (log(mol/L), L/kg, hr, …) and a
 *      test-set R². TWO of them — Volume of Distribution (VDss, R²≈-1.2) and
 *      Half-Life (R²≈-2.4) — have NEGATIVE R², i.e. the model is worse than
 *      predicting the dataset mean. We surface those as "unreliable" rather
 *      than pretend the number means something.
 *
 * Source: Swanson et al., ADMET-AI (Bioinformatics 2024); metrics are the TDC
 * ADMET benchmark values shipped in admet.csv. R²/AUROC are the model's own
 * reported test performance, not a claim about this specific molecule.
 */

export type AdmetTask = "classification" | "regression";
export type AdmetReliability = "high" | "moderate" | "low" | "unreliable";

export interface AdmetEndpointMeta {
  /** ADMET-AI column id (the raw key the backend returns). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short unit string for display ("prob" for classification probabilities). */
  unit: string;
  task: AdmetTask;
  /** Test-set AUROC (classification) — published TDC benchmark. */
  auroc?: number;
  /** Test-set R² (regression) — published TDC benchmark. */
  r2?: number;
  /** Reliability tier derived from auroc / r2 (see reliabilityOf). */
  reliability: AdmetReliability;
  /** For classification probabilities, higher = worse liability? (tox/inhibition) */
  higherIsWorse?: boolean;
  /** One-line note shown on hover. */
  note?: string;
}

function classReliability(auroc: number): AdmetReliability {
  if (auroc >= 0.85) return "high";
  if (auroc >= 0.75) return "moderate";
  return "low";
}
function regrReliability(r2: number): AdmetReliability {
  if (r2 < 0) return "unreliable";
  if (r2 >= 0.6) return "high";
  if (r2 >= 0.3) return "moderate";
  return "low";
}

const C = (id: string, name: string, auroc: number, higherIsWorse = true, note?: string): AdmetEndpointMeta =>
  ({ id, name, unit: "prob", task: "classification", auroc, reliability: classReliability(auroc), higherIsWorse, note });
const R = (id: string, name: string, unit: string, r2: number, note?: string): AdmetEndpointMeta =>
  ({ id, name, unit, task: "regression", r2, reliability: regrReliability(r2), note });

/** Authoritative metadata for the endpoints the platform surfaces. */
export const ADMET_META: Record<string, AdmetEndpointMeta> = {
  // ── Absorption ──────────────────────────────────────────────────────
  Caco2_Wang:                R("Caco2_Wang", "Caco-2 permeability", "log(10⁻⁶ cm/s)", 0.71),
  HIA_Hou:                   C("HIA_Hou", "Human intestinal absorption", 0.99, false),
  Pgp_Broccatelli:           C("Pgp_Broccatelli", "P-gp inhibition", 0.95),
  Bioavailability_Ma:        C("Bioavailability_Ma", "Oral bioavailability", 0.72, false,
                               "Low benchmark AUROC (0.72) — treat as directional."),
  Lipophilicity_AstraZeneca: R("Lipophilicity_AstraZeneca", "Lipophilicity (logD₇.₄)", "log-ratio", 0.77),
  Solubility_AqSolDB:        R("Solubility_AqSolDB", "Aqueous solubility", "log(mol/L)", 0.82),
  // ── Distribution ────────────────────────────────────────────────────
  BBB_Martins:               C("BBB_Martins", "Blood-brain barrier penetration", 0.90, false),
  PPBR_AZ:                   R("PPBR_AZ", "Plasma protein binding", "%", 0.59),
  VDss_Lombardo:             R("VDss_Lombardo", "Volume of distribution (Vdss)", "L/kg", -1.21,
                               "NEGATIVE R² on the benchmark — model is worse than the mean. Do not rely on the absolute value."),
  // ── Metabolism ──────────────────────────────────────────────────────
  CYP1A2_Veith:              C("CYP1A2_Veith", "CYP1A2 inhibition", 0.94),
  CYP2C19_Veith:             C("CYP2C19_Veith", "CYP2C19 inhibition", 0.91),
  CYP2C9_Veith:              C("CYP2C9_Veith", "CYP2C9 inhibition", 0.91),
  CYP2D6_Veith:              C("CYP2D6_Veith", "CYP2D6 inhibition", 0.89),
  CYP3A4_Veith:              C("CYP3A4_Veith", "CYP3A4 inhibition", 0.91),
  // ── Excretion ───────────────────────────────────────────────────────
  Clearance_Hepatocyte_AZ:   R("Clearance_Hepatocyte_AZ", "Hepatocyte clearance", "µL/min/10⁶ cells", 0.26),
  Clearance_Microsome_AZ:    R("Clearance_Microsome_AZ", "Microsomal clearance", "µL/min/mg", 0.28),
  Half_Life_Obach:           R("Half_Life_Obach", "Half-life", "hr", -2.39,
                               "NEGATIVE R² on the benchmark — model is worse than the mean. Do not rely on the absolute value."),
  // ── Toxicity ────────────────────────────────────────────────────────
  hERG:                      C("hERG", "hERG blockade", 0.84),
  AMES:                      C("AMES", "Ames mutagenicity", 0.88),
  DILI:                      C("DILI", "Drug-induced liver injury", 0.88),
  LD50_Zhu:                  R("LD50_Zhu", "Acute toxicity LD50", "log(1/(mol/kg))", 0.60),
  Carcinogens_Lagunin:       C("Carcinogens_Lagunin", "Carcinogenicity", 0.77),
  ClinTox:                   C("ClinTox", "Clinical-trial toxicity", 0.93),
  Skin_Reaction:             C("Skin_Reaction", "Skin sensitization", 0.72, true,
                               "Low benchmark AUROC (0.72) — treat as directional."),
  // ── Tox21 stress & endocrine pathways ───────────────────────────────
  "SR-MMP":                  C("SR-MMP", "Mitochondrial Membrane Potential", 0.92, true,
                               "Tox21 mitochondrial dysfunction pathway."),
  "SR-ATAD5":                C("SR-ATAD5", "ATAD5 Genotoxicity stress", 0.88, true,
                               "ATPase Family AAA Domain-Containing Protein 5 stress indicator."),
  "SR-p53":                  C("SR-p53", "Tumor Protein p53 activation", 0.88, true,
                               "p53 tumor suppressor DNA damage stress response."),
  "SR-ARE":                  C("SR-ARE", "Antioxidant Response Element activation", 0.84, true,
                               "Nrf2/ARE oxidative stress pathway."),
  "SR-HSE":                  C("SR-HSE", "Heat Shock Factor Response Element", 0.84, true,
                               "Heat shock response stress pathway."),
  "NR-AR":                   C("NR-AR", "Androgen Receptor binding", 0.78, true,
                               "Androgen receptor binding activity (endocrine disruption)."),
  "NR-AR-LBD":               C("NR-AR-LBD", "Androgen Receptor (LBD) binding", 0.88, true,
                               "Androgen receptor ligand binding domain activity."),
  "NR-AhR":                  C("NR-AhR", "Aryl Hydrocarbon Receptor binding", 0.90, true,
                               "Dioxin receptor pathway (endocrine disruption)."),
  "NR-Aromatase":            C("NR-Aromatase", "Aromatase inhibition", 0.91, true,
                               "Aromatase enzyme inhibition (endocrine disruption)."),
  "NR-ER":                   C("NR-ER", "Estrogen Receptor binding", 0.75, true,
                               "Estrogen receptor binding activity (endocrine disruption)."),
  "NR-ER-LBD":               C("NR-ER-LBD", "Estrogen Receptor (LBD) binding", 0.83, true,
                               "Estrogen receptor ligand binding domain activity."),
  "NR-PPAR-gamma":           C("NR-PPAR-gamma", "PPAR-gamma activation", 0.92, true,
                               "Peroxisome proliferator-activated receptor gamma activity."),
};

export function admetMeta(id: string): AdmetEndpointMeta | null {
  return ADMET_META[id] ?? null;
}

/** Format a raw model value with its correct unit. Probabilities → "53%". */
export function formatAdmetValue(id: string, value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  const m = ADMET_META[id];
  if (!m) return `${value}`;
  if (m.task === "classification") return `${Math.round(value * 100)}%`;
  // regression — show the value with a sensible precision + unit
  const v = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return `${v} ${m.unit}`;
}

/** Short accuracy descriptor for display, e.g. "AUROC 0.84" or "R² 0.71". */
export function admetAccuracyLabel(id: string): string | null {
  const m = ADMET_META[id];
  if (!m) return null;
  if (m.task === "classification" && m.auroc != null) return `AUROC ${m.auroc.toFixed(2)}`;
  if (m.task === "regression" && m.r2 != null) return `R² ${m.r2.toFixed(2)}`;
  return null;
}

/** Tailwind text color for a reliability tier (NOT a value verdict). */
export const RELIABILITY_TONE: Record<AdmetReliability, string> = {
  high:       "text-emerald-400",
  moderate:   "text-amber-300",
  low:        "text-orange-300",
  unreliable: "text-red-400",
};
export const RELIABILITY_LABEL: Record<AdmetReliability, string> = {
  high: "high reliability",
  moderate: "moderate reliability",
  low: "low reliability",
  unreliable: "unreliable on benchmark",
};
