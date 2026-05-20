/**
 * Layer 1 — Calibrated QSPR / QSAR fallback models
 * ─────────────────────────────────────────────────────────────────────────
 * Replaces the former hand-tuned "rule of thumb" bracket formulas in the L1
 * heuristic engines (admet.ts / inVitroSim.ts) with **regression / logistic
 * models fitted to public measured datasets**.
 *
 * Why this exists
 * ───────────────
 * The pre-calibration heuristics (e.g. `tpsa < 60 → abs 0.88`,
 * `log10(hERG IC50) = 1.8 − 0.22·logP …`) were never fitted to a labelled
 * dataset — their coefficients were hand-picked. Head-to-head against
 * published wet-lab values that produced large fold-errors on the L1
 * benchmark (hERG IC50 ≈ 27×, plasma fu ≈ 7.5×, half-life ≈ 4×).
 *
 * Each model below was fitted (Ridge / L2-logistic, 5-fold cross-validated)
 * against a public Therapeutics Data Commons (tdcommons.ai) dataset using
 * ONLY descriptors that already exist on `MolecularProperties` +
 * `PharmacophoreProfile`, so the fitted coefficients port verbatim into the
 * browser engine with no new RDKit descriptor and no data file shipped.
 *
 * IMPORTANT — what these are and are not
 * ──────────────────────────────────────
 *   • These are the HEURISTIC FALLBACK. When the AI-service ML overlay
 *     (ADMET-AI Chemprop GNN, CardioTox / DILI RFs) is available it still
 *     takes priority — those models are stronger (see mlOverlay.ts).
 *   • A linear/logistic model on 2-D descriptors has a real accuracy
 *     ceiling. Expect ~2.5–3× geometric fold-error on the continuous PK
 *     endpoints and ROC-AUC ~0.75–0.90 on the classifiers. They are a
 *     triage / rank-ordering signal, NOT a replacement for measured assays.
 *   • Provenance stays honest: callers tag these outputs `heuristic`, never
 *     `ml` or `experimental`.
 *
 * Reproducibility
 * ───────────────
 * The fitting pipeline lives in `scripts/calibrate_l1_models.py`. It pulls
 * every training set live from the TDC API (no local dataset is vendored),
 * recomputes the coefficients and prints this table. Re-run it to refresh.
 *
 * Fitted: 2026-05 against TDC datasets (Caco2_Wang, PPBR_AZ,
 * Half_Life_Obach, Clearance_Hepatocyte_AZ, HIA_Hou, hERG_Karim,
 * CYP{1A2,2C9,2C19,2D6,3A4}_Veith). Licences: CC-BY 4.0 (TDC).
 */

// ─────────────────────────────────────────────────────────────────────────
// Descriptor bundle — every field is already present on MolecularProperties
// (mw … numAromaticHeterocycles) or PharmacophoreProfile (the three counts).
// ─────────────────────────────────────────────────────────────────────────
export interface CalDescriptors {
  mw: number;
  logP: number;
  tpsa: number;
  hbd: number;
  hba: number;
  rotBonds: number;
  numAromaticRings: number;
  numAromaticHeterocycles: number;
  fsp3: number;
  crippenMR: number;
  /** Aromatic-nitrogen atom count — PharmacophoreProfile.aromaticNCount. */
  aromaticNCount: number;
  /** Basic (ionisable) amine count — PharmacophoreProfile.basicAmineCount. */
  basicAmineCount: number;
  /** Carboxylic-acid + sulfonic-acid count — PharmacophoreProfile.acidicGroupCount. */
  acidicGroupCount: number;
}

interface LinModel {
  endpoint: string;
  dataset: string;
  n: number;
  /** Cross-validated performance string, surfaced in UI tooltips. */
  cvMetric: string;
  intercept: number;
  coef: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────
// Fitted coefficient table (see header for provenance). Feature key "logP2"
// is the squared logP term (lipophilicity parabola); all other keys map
// directly onto CalDescriptors.
// ─────────────────────────────────────────────────────────────────────────
const MODELS = {
  /** Caco-2 apparent permeability — target = log10(Papp in cm/s). */
  caco2_logPapp: {
    endpoint: "Caco-2 log10(Papp cm/s)",
    dataset: "TDC Caco2_Wang",
    n: 910,
    cvMetric: "R²=0.578, geomean fold-error 2.5× (5-fold CV)",
    intercept: -4.11903,
    coef: {
      logP: 0.085779, logP2: -0.005407, tpsa: -0.004965, hbd: -0.147524,
      hba: 0.05497, mw: 9e-6, rotBonds: -0.004465, numAromaticRings: -0.203557,
      aromaticNCount: -0.026548, acidicGroupCount: -0.41344, fsp3: -0.51126,
    },
  },
  /** Plasma protein binding — target = log10(fraction unbound). */
  ppb_log10_fu: {
    endpoint: "PPB log10(fu)",
    dataset: "TDC PPBR_AZ",
    n: 1614,
    cvMetric: "R²=0.358, geomean fold-error 2.8× (5-fold CV)",
    intercept: -0.36232,
    coef: {
      logP: -0.18173, logP2: -0.022124, tpsa: -0.006874, hbd: 0.027519,
      hba: -0.024177, mw: 0.001997, aromaticNCount: 0.094072,
      acidicGroupCount: 0.054428, numAromaticRings: -0.172221,
      basicAmineCount: 0.168782,
    },
  },
  /** Terminal half-life — target = log10(t½ in hours). */
  half_life_log10_h: {
    endpoint: "Half-life log10(h)",
    dataset: "TDC Half_Life_Obach",
    n: 667,
    cvMetric: "R²=0.159, geomean fold-error 2.7× (5-fold CV)",
    intercept: 0.33659,
    coef: {
      logP: 0.076524, logP2: 0.003016, tpsa: 0.001142, mw: -0.0001,
      hbd: 0.043704, rotBonds: -0.023982, fsp3: 0.13867,
      aromaticNCount: -0.031426, numAromaticRings: 0.08636,
      acidicGroupCount: -0.239348, crippenMR: -0.00014,
    },
  },
  /** Hepatocyte intrinsic clearance — target = log10(CLint µL/min/10⁶ cells). */
  hepatocyte_clint_log10: {
    endpoint: "Hepatocyte CLint log10",
    dataset: "TDC Clearance_Hepatocyte_AZ",
    n: 1213,
    cvMetric: "R²=0.054, geomean fold-error 3.1× (5-fold CV)",
    intercept: 1.37828,
    coef: {
      logP: 0.052317, logP2: -0.002686, tpsa: -0.001106, mw: -0.000604,
      fsp3: -0.180614, rotBonds: 0.037551, numAromaticRings: -0.019178,
      aromaticNCount: -0.05772, hbd: -0.032476, numAromaticHeterocycles: 0.132342,
    },
  },
  /** Human intestinal absorption — logistic, P(absorbed). */
  hia_prob: {
    endpoint: "HIA probability",
    dataset: "TDC HIA_Hou",
    n: 578,
    cvMetric: "ROC-AUC 0.896 (5-fold CV)",
    intercept: 1.93818,
    coef: {
      tpsa: -0.002796, logP: 1.80502, logP2: -0.130176, mw: -0.021,
      hbd: 0.079366, hba: 0.910758, rotBonds: -0.1985, aromaticNCount: 0.166899,
      acidicGroupCount: -1.075046, fsp3: 0.035386,
    },
  },
  /** hERG channel block — logistic, P(blocker at ~10 µM). */
  herg_blocker_prob: {
    endpoint: "hERG blocker probability",
    dataset: "TDC hERG_Karim",
    n: 13445,
    cvMetric: "ROC-AUC 0.739 (5-fold CV)",
    intercept: -2.35093,
    coef: {
      logP: 0.594708, logP2: -0.052364, mw: 0.000249, tpsa: -0.023865,
      basicAmineCount: 0.27131, aromaticNCount: 0.069903,
      numAromaticRings: 0.526299, hbd: -0.040801, rotBonds: 0.106473,
      fsp3: 1.700807, numAromaticHeterocycles: -0.174942,
    },
  },
  cyp1a2_inhibitor_prob: {
    endpoint: "CYP1A2 inhibitor probability",
    dataset: "TDC CYP1A2_Veith",
    n: 12579,
    cvMetric: "ROC-AUC 0.852 (5-fold CV)",
    intercept: 1.0076,
    coef: {
      logP: 1.163428, logP2: -0.090121, mw: -0.002527, tpsa: -0.021431,
      hbd: 0.177677, hba: 0.432505, aromaticNCount: -0.070561,
      numAromaticRings: 1.130966, rotBonds: 0.022715, crippenMR: -0.062916,
      numAromaticHeterocycles: -0.054553,
    },
  },
  cyp2c9_inhibitor_prob: {
    endpoint: "CYP2C9 inhibitor probability",
    dataset: "TDC CYP2C9_Veith",
    n: 12092,
    cvMetric: "ROC-AUC 0.791 (5-fold CV)",
    intercept: -3.76912,
    coef: {
      logP: 1.23153, logP2: -0.109497, mw: 0.009473, tpsa: 0.007315,
      hbd: -0.21622, hba: -0.0077, aromaticNCount: -0.228994,
      numAromaticRings: 0.583306, rotBonds: 0.08279, crippenMR: -0.041519,
      numAromaticHeterocycles: 0.108274,
    },
  },
  cyp2c19_inhibitor_prob: {
    endpoint: "CYP2C19 inhibitor probability",
    dataset: "TDC CYP2C19_Veith",
    n: 12665,
    cvMetric: "ROC-AUC 0.780 (5-fold CV)",
    intercept: -1.84802,
    coef: {
      logP: 1.206729, logP2: -0.10369, mw: 0.00698, tpsa: -0.007456,
      hbd: -0.052141, hba: 0.138242, aromaticNCount: -0.253113,
      numAromaticRings: 0.63087, rotBonds: 0.135983, crippenMR: -0.051669,
      numAromaticHeterocycles: -0.006216,
    },
  },
  cyp2d6_inhibitor_prob: {
    endpoint: "CYP2D6 inhibitor probability",
    dataset: "TDC CYP2D6_Veith",
    n: 13130,
    cvMetric: "ROC-AUC 0.753 (5-fold CV)",
    intercept: -1.1482,
    coef: {
      logP: 0.49016, logP2: -0.075987, mw: 0.001825, tpsa: -0.041641,
      hbd: 0.542251, hba: 0.163285, aromaticNCount: -0.113849,
      numAromaticRings: 0.247796, rotBonds: 0.151543, crippenMR: 0.001989,
      numAromaticHeterocycles: -0.0184,
    },
  },
  cyp3a4_inhibitor_prob: {
    endpoint: "CYP3A4 inhibitor probability",
    dataset: "TDC CYP3A4_Veith",
    n: 12328,
    cvMetric: "ROC-AUC 0.801 (5-fold CV)",
    intercept: -4.88054,
    coef: {
      logP: 1.237138, logP2: -0.153032, mw: 0.001624, tpsa: -0.009065,
      hbd: -0.061688, hba: 0.051905, aromaticNCount: 0.032541,
      numAromaticRings: 0.333267, rotBonds: 0.144973, crippenMR: 0.011282,
      numAromaticHeterocycles: 0.130784,
    },
  },
} as const satisfies Record<string, LinModel>;

export type CalModelKey = keyof typeof MODELS;

// ─────────────────────────────────────────────────────────────────────────
// Core evaluation.
// ─────────────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sigmoid(x: number): number {
  // Numerically stable logistic.
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/** Feature value resolver — handles the derived `logP2` term. */
function featureValue(d: CalDescriptors, key: string): number {
  if (key === "logP2") return d.logP * d.logP;
  const v = (d as unknown as Record<string, number>)[key];
  return Number.isFinite(v) ? v : 0;
}

/** Raw linear score: intercept + Σ coefᵢ·featureᵢ. */
function linearScore(model: LinModel, d: CalDescriptors): number {
  let s = model.intercept;
  for (const key in model.coef) {
    s += model.coef[key] * featureValue(d, key);
  }
  return s;
}

/** Metadata accessor — used by callers that surface the CV metric in tooltips. */
export function calModelInfo(key: CalModelKey): { endpoint: string; dataset: string; n: number; cvMetric: string } {
  const m = MODELS[key];
  return { endpoint: m.endpoint, dataset: m.dataset, n: m.n, cvMetric: m.cvMetric };
}

// ─────────────────────────────────────────────────────────────────────────
// Public endpoint functions. Each returns the value in the same unit the
// L1 engines already use, so they are drop-in replacements for the former
// hand-tuned `compute*` helpers.
// ─────────────────────────────────────────────────────────────────────────

/** Caco-2 apparent permeability, Papp A→B in 10⁻⁶ cm/s. */
export function calCaco2Papp(d: CalDescriptors): number {
  const log10PappCmS = linearScore(MODELS.caco2_logPapp, d);
  // cm/s → 10⁻⁶ cm/s : Papp[1e-6] = 10^(log10(Papp cm/s) + 6).
  const papp = Math.pow(10, log10PappCmS + 6);
  return clamp(papp, 0.05, 200);
}

/** Plasma fraction unbound, as a percentage (0–100). */
export function calPPBfuPercent(d: CalDescriptors): number {
  const log10Fu = linearScore(MODELS.ppb_log10_fu, d);
  return clamp(Math.pow(10, log10Fu) * 100, 0.05, 100);
}

/** Terminal half-life in hours. */
export function calHalfLifeHours(d: CalDescriptors): number {
  return clamp(Math.pow(10, linearScore(MODELS.half_life_log10_h, d)), 0.1, 300);
}

/** Hepatocyte intrinsic clearance, µL/min/10⁶ cells. */
export function calHepatocyteCLint(d: CalDescriptors): number {
  return clamp(Math.pow(10, linearScore(MODELS.hepatocyte_clint_log10, d)), 0.5, 500);
}

/** Human intestinal absorption probability [0, 1]. */
export function calHIAProbability(d: CalDescriptors): number {
  return clamp(sigmoid(linearScore(MODELS.hia_prob, d)), 0, 1);
}

/** hERG channel blocker probability [0, 1] (block at ~10 µM). */
export function calHERGBlockerProbability(d: CalDescriptors): number {
  return clamp(sigmoid(linearScore(MODELS.herg_blocker_prob, d)), 0, 1);
}

export interface CYPProbabilities {
  CYP1A2: number;
  CYP2C9: number;
  CYP2C19: number;
  CYP2D6: number;
  CYP3A4: number;
}

/** Per-isoform CYP inhibitor probability [0, 1]. */
export function calCYPInhibitorProbabilities(d: CalDescriptors): CYPProbabilities {
  return {
    CYP1A2:  clamp(sigmoid(linearScore(MODELS.cyp1a2_inhibitor_prob, d)), 0, 1),
    CYP2C9:  clamp(sigmoid(linearScore(MODELS.cyp2c9_inhibitor_prob, d)), 0, 1),
    CYP2C19: clamp(sigmoid(linearScore(MODELS.cyp2c19_inhibitor_prob, d)), 0, 1),
    CYP2D6:  clamp(sigmoid(linearScore(MODELS.cyp2d6_inhibitor_prob, d)), 0, 1),
    CYP3A4:  clamp(sigmoid(linearScore(MODELS.cyp3a4_inhibitor_prob, d)), 0, 1),
  };
}
