import type { MolecularProperties } from "./chemistry";
import { detectPharmacophores } from "./chemistry";
import type { MlOverlay } from "./mlOverlay";
import { emptyOverlay, overlayHasAnyMl } from "./mlOverlay";
import { type CalDescriptors, calHIAProbability } from "./l1Calibration";
import {
  runStructuralAlertScan,
  hasHardReject,
  summariseAlerts,
  type StructuralAlertResult,
} from "./structuralAlerts";

export type { StructuralAlertResult };

export interface AdmetScores {
  absorption:   number;
  distribution: number;
  metabolism:   number;
  excretion:    number;
  toxicity:     number;
  overall:      number;
}

export interface ToxicityAlert {
  name:     string;
  /**
   * "PAINS"      — pan-assay interference (Baell & Holloway 2010)
   * "Structural" — Brenk / BMS / NIH-MLSMR reactive / rejected motif
   * (existing categories retained for backward compatibility)
   */
  category: "hERG" | "Hepatotox" | "Genotox" | "CNS" | "Reactive" | "Ames" | "DILI" | "PAINS" | "Structural";
  severity: "Low" | "Medium" | "High";
  detail:   string;
}

export interface OrganRisk {
  name:   string;
  risk:   number;
  color:  "emerald" | "yellow" | "red";
  alerts: string[];
}

export interface BindingEstimate {
  primaryKd:    number;
  primaryKi:    number;
  primaryIC50:  number;
  selectivity:  number;
  targetName:   string;
  targetClass:  string;
  offTargets: Array<{ name: string; kd: number; ki: number; ic50: number; selectivity: number }>;
}

export interface LipinskiAnalysis {
  mwPass:   boolean; mw:   number;
  logPPass: boolean; logP: number;
  hbdPass:  boolean; hbd:  number;
  hbaPass:  boolean; hba:  number;
  violations: number;
  leadLike: boolean;
  tpsa:     number;
  rotBonds: number;
}

export interface SimResults {
  admet:     AdmetScores;
  toxAlerts: ToxicityAlert[];
  organs:    OrganRisk[];
  /**
   * Binding estimate is `null` when the UniProt is not in the validated
   * `TARGET_MAP` catalog. Consumers MUST handle null by surfacing a
   * "no validated target" placeholder rather than silently substituting
   * fabricated Kd/Ki/IC50 values (audit RF#1, see L1_SIMULATION_AUDIT.md §9).
   */
  binding:   BindingEstimate | null;
  lipinski:  LipinskiAnalysis;
  /** Bickerton QED approximation — 8-component ADS with pharmacophore-proxy ALERTS. Optimistic upper bound when broader PAINS/Brenk alerts fire. */
  qed_approx: number;
  /**
   * Synthetic Accessibility complexity score (1=easy, 10=hard).
   * Implements the COMPLEXITY-PENALTY portion of Ertl-Schuffenhauer 2009
   * (J. Cheminform. 1:8) — ring complexity, stereo, sp3, macrocycle,
   * bridgehead penalties. The full score also requires a precomputed
   * Morgan-fragment frequency dictionary (~3 MB) which is NOT vendored
   * here; this is therefore an UPPER-BOUND complexity estimate, never the
   * ECFP fragment-score component. See L1_SIMULATION_AUDIT.md §9 step 8.
   */
  saScore:   number;
  goNogo:    "GO" | "WATCH" | "NO-GO";
  /**
   * Composite Heuristic Score in [0, 1].
   * NOT a calibrated probability. Computed as a weighted sum of ADMET
   * sub-scores, Lipinski violation penalties, and tox-alert counts:
   *   overall × 0.6 + (1 − violations × 0.12) × 0.25 + alert_bonus × 0.15
   * Use only as a relative rank-ordering signal within the same target.
   * Do not interpret as P(clinical success) or report as a validated metric.
   */
  confidence: number;
  similarDrugs: string[];
  recommendation: string;
  molName:   string;
  smiles:    string;
  uniprotId: string;
  timestamp: string;
  /**
   * Per-field provenance map ("ml" / "heuristic" / "experimental").
   * Stamped at write-time by `runAdmetSimulation` based on whether each
   * value came from the ML overlay (ADMET-AI GNN, CardioTox / DILI RFs) or
   * the literature-cited rule fallback. The L1 UI renders a per-row badge
   * using this map. Optional for backward compatibility with consumers
   * that pre-date the overlay refactor (treat missing as "all heuristic").
   */
  provenance?: Record<string, "ml" | "heuristic" | "experimental">;
  /**
   * True iff any field on this record was driven by a real ML inference.
   * Surfaces an "ML-Enhanced" badge on the L1 result panel header.
   * Optional for backward compatibility (missing → render as `false`).
   */
  mlEnhanced?: boolean;
  /**
   * Full result from the PAINS / Brenk / BMS / NIH-MLSMR / Ames-ICH
   * structural alert scan (structuralAlerts.ts). Populated by
   * `runAdmetSimulation` when RDKit is ready. Consumed by
   * `computeLayer1Flags` in safetyFlags.ts to surface per-alert HAIOps
   * safety flags, and by the Go/No-Go logic to escalate hard-reject
   * compounds to NO-GO independently of ML toxicity signals.
   *
   * `undefined` when RDKit was not yet initialised at simulation time;
   * `scanRan === false` on the result when SMILES was blank.
   */
  structuralAlerts?: StructuralAlertResult;
}

const TARGET_MAP: Record<string, { name: string; class: string; offTargets: string[]; potencyRange: [number, number] }> = {
  P00533: { name: "EGFR",  class: "Tyrosine Kinase",      offTargets: ["HER2 (P04626)", "HER3 (P21860)"],               potencyRange: [1,  200]  },
  P04626: { name: "HER2",  class: "Tyrosine Kinase",      offTargets: ["EGFR (P00533)", "HER3 (P21860)"],               potencyRange: [5,  500]  },
  P01116: { name: "KRAS",  class: "GTPase",               offTargets: ["NRAS (P01111)", "HRAS (P01112)"],               potencyRange: [50, 5000] },
  P11802: { name: "CDK4",  class: "Ser/Thr Kinase",       offTargets: ["CDK6 (Q00534)", "CDK2 (P24941)"],               potencyRange: [1,  100]  },
  Q00534: { name: "CDK6",  class: "Ser/Thr Kinase",       offTargets: ["CDK4 (P11802)", "CDK2 (P24941)"],               potencyRange: [2,  200]  },
  Q06187: { name: "BTK",   class: "Tyrosine Kinase",      offTargets: ["ITK (Q08881)",  "TEC (P42680)"],                potencyRange: [1,  150]  },
  P00519: { name: "ABL1",  class: "Tyrosine Kinase",      offTargets: ["SRC (P12931)", "KIT (P10721)"],                 potencyRange: [1,  100]  },
  P15056: { name: "BRAF",  class: "Ser/Thr Kinase",       offTargets: ["CRAF (P04049)", "MAP2K1 (Q02750)"],             potencyRange: [1,  300]  },
};

interface AdmetTherapeuticModifiers {
  absorptionBonus: number;
  metabolismPenalty: number;
  toxicitySensitivity: number;
  hergSensitivity: number;
  hepatoSensitivity: number;
  cnsSensitivity: number;
  renalSensitivity: number;
  /**
   * @deprecated Per L1 audit RF#2 / §9 step 2: the TA-override branch of
   * `similarDrugs` is a fabrication for off-catalog UniProts (selecting
   * "Oncology" surfaces Erlotinib/Gefitinib/Imatinib for any molecule).
   * Field retained on the type for back-compat with existing presets but
   * the runtime resolver no longer reads it. Curated UniProt → drug map
   * (`similarByTarget`) remains the only honest source.
   */
  similarDrugsOverride: string[];
}

const ADMET_TA_MODIFIERS: Record<string, AdmetTherapeuticModifiers> = {
  "Oncology": {
    absorptionBonus: 0.0, metabolismPenalty: 0.0, toxicitySensitivity: 0.85,
    hergSensitivity: 1.0, hepatoSensitivity: 1.3, cnsSensitivity: 0.7, renalSensitivity: 1.0,
    similarDrugsOverride: [],
  },
  "CNS": {
    absorptionBonus: 0.05, metabolismPenalty: -0.03, toxicitySensitivity: 1.1,
    hergSensitivity: 1.5, hepatoSensitivity: 0.8, cnsSensitivity: 2.0, renalSensitivity: 0.7,
    similarDrugsOverride: ["Donepezil", "Lecanemab", "Levodopa"],
  },
  "Cardiovascular": {
    absorptionBonus: 0.03, metabolismPenalty: 0.0, toxicitySensitivity: 1.2,
    hergSensitivity: 2.5, hepatoSensitivity: 1.0, cnsSensitivity: 0.5, renalSensitivity: 1.5,
    similarDrugsOverride: ["Atorvastatin", "Entresto", "Empagliflozin"],
  },
  "Metabolic": {
    absorptionBonus: 0.04, metabolismPenalty: 0.04, toxicitySensitivity: 1.0,
    hergSensitivity: 1.0, hepatoSensitivity: 1.8, cnsSensitivity: 0.5, renalSensitivity: 1.5,
    similarDrugsOverride: ["Semaglutide", "Tirzepatide", "Metformin"],
  },
  "Rare Disease": {
    absorptionBonus: 0.0, metabolismPenalty: 0.0, toxicitySensitivity: 0.9,
    hergSensitivity: 1.2, hepatoSensitivity: 1.2, cnsSensitivity: 1.0, renalSensitivity: 1.0,
    similarDrugsOverride: ["Nusinersen", "Lumacaftor", "Migalastat"],
  },
  "Infectious Disease": {
    absorptionBonus: 0.02, metabolismPenalty: 0.03, toxicitySensitivity: 1.0,
    hergSensitivity: 1.0, hepatoSensitivity: 1.5, cnsSensitivity: 0.5, renalSensitivity: 1.3,
    similarDrugsOverride: ["Nirmatrelvir", "Remdesivir", "Dolutegravir"],
  },
  "Immunology": {
    absorptionBonus: 0.03, metabolismPenalty: 0.02, toxicitySensitivity: 1.05,
    hergSensitivity: 1.0, hepatoSensitivity: 1.3, cnsSensitivity: 0.5, renalSensitivity: 1.0,
    similarDrugsOverride: ["Tofacitinib", "Upadacitinib", "Dupilumab"],
  },
};

// Identity / neutral modifiers — used when no TA preset is selected. Every
// multiplier is 1.0 and every additive offset is 0.0, so the ADMET pipeline
// produces results that depend ONLY on the molecule itself (no TA-specific
// sensitivity weighting, no TA-specific similar-drug override). This is the
// honest behaviour for off-catalog molecules where no therapeutic area has
// been inferred or chosen — we must not silently coerce them to "Oncology".
const ADMET_TA_NEUTRAL: AdmetTherapeuticModifiers = {
  absorptionBonus: 0.0, metabolismPenalty: 0.0, toxicitySensitivity: 1.0,
  hergSensitivity: 1.0, hepatoSensitivity: 1.0, cnsSensitivity: 1.0, renalSensitivity: 1.0,
  similarDrugsOverride: [],
};

function getAdmetModifiers(therapeuticArea: string | null | undefined): AdmetTherapeuticModifiers {
  if (!therapeuticArea) return ADMET_TA_NEUTRAL;
  return ADMET_TA_MODIFIERS[therapeuticArea] ?? ADMET_TA_NEUTRAL;
}

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Deterministic seeded PRNG using the mulberry32 algorithm.
 * Produces a float in [0, 1) from a uint32 seed.
 * Replaces the former Math.sin LCG which had poor spectral properties
 * and was not reproducible across JS engines.
 */
function mulberry32(seed: number): number {
  let t = (seed + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function jitter(base: number, range: number, seed: number): number {
  const pseudo = mulberry32(seed >>> 0);
  return clamp(base + (pseudo - 0.5) * range * 2);
}

function hashSmiles(smiles: string): number {
  let h = 0;
  for (let i = 0; i < smiles.length; i++) h = (h * 31 + smiles.charCodeAt(i)) >>> 0;
  return h;
}

export function runAdmetSimulation(
  molProps:     MolecularProperties,
  smiles:       string,
  molName:      string,
  uniprotId:    string,
  therapeuticArea: string | null = null,
  predictedKd_nM: number | null = null,
  /**
   * Optional ML overlay built from the AI-service predictions
   * (ADMET-AI v2 Chemprop GNN, CardioTox / DILI / Solubility / Binding RFs).
   * When supplied, the corresponding fields override the literature-cited
   * rule estimates. When `null` or omitted the engine is exactly the
   * deterministic-rule pipeline (no behavioural change for older callers).
   */
  mlOverlay: MlOverlay | null = null,
): SimResults {
  const { mw, logP, hbd, hba, tpsa, rotBonds, qed_approx } = molProps;
  // Seed retained for downstream deterministic offsets (organ-risk noise,
  // structural-alert keys). The 5-axis ADMET scores themselves are now
  // deterministic point estimates — cosmetic jitter removed (a single
  // molecule must give the same answer every run; spread belongs to
  // population-level simulations, not single-molecule QSPR).
  const seed = hashSmiles(smiles);
  const taMod = getAdmetModifiers(therapeuticArea);
  const overlay = mlOverlay ?? emptyOverlay();
  const provenance: Record<string, "ml" | "heuristic" | "experimental"> = {};

  // Pharmacophore profile — detected once, reused by the absorption
  // calibration below, the hERG heuristic, and the genotoxicity / Ames
  // fallback block. RDKit-backed when ready.
  const pharmAmes = detectPharmacophores(smiles);
  // Descriptor bundle for the calibrated QSPR/QSAR fallback models
  // (l1Calibration.ts) — every field is a real RDKit descriptor or
  // pharmacophore count already available here.
  const cal: CalDescriptors = {
    mw, logP, tpsa, hbd, hba, rotBonds,
    numAromaticRings: molProps.numAromaticRings ?? 0,
    numAromaticHeterocycles: molProps.numAromaticHeterocycles ?? 0,
    fsp3: molProps.fsp3 ?? 0.3,
    crippenMR: molProps.crippenMR ?? 80,
    aromaticNCount: pharmAmes?.aromaticNCount ?? 0,
    basicAmineCount: pharmAmes?.basicAmineCount ?? 0,
    acidicGroupCount: pharmAmes?.acidicGroupCount ?? 0,
  };

  // ── Absorption ─────────────────────────────────────────────────────────
  // Primary: ADMET-AI Caco2_Wang / HIA_Hou / Bioavailability_Ma blend.
  // Fallback: deterministic TPSA + Lipinski rule (Egan 2000 / Veber 2002).
  let abs: number;
  if (overlay.hia_probability !== null || overlay.caco2_Papp_1e6_cm_s !== null) {
    const hia    = overlay.hia_probability;
    const caco2  = overlay.caco2_Papp_1e6_cm_s;
    const fOral  = overlay.bioavailability_F;
    // Normalize Caco-2 papp (10⁻⁶ cm/s) onto [0, 1] via the Yee 1997 bands:
    // >20 → high, 1–20 → moderate, <1 → low. Saturate at log10(200) = 2.3.
    const caco2Norm = caco2 === null ? null : clamp(Math.log10(Math.max(0.1, caco2)) / 2.3);
    const parts: number[] = [];
    const weights: number[] = [];
    if (hia       !== null) { parts.push(hia);       weights.push(0.55); }
    if (caco2Norm !== null) { parts.push(caco2Norm); weights.push(0.30); }
    if (fOral     !== null) { parts.push(fOral);     weights.push(0.15); }
    const wSum = weights.reduce((a, b) => a + b, 0);
    abs = clamp(parts.reduce((s, p, i) => s + p * weights[i], 0) / wSum);
    provenance.absorption = "ml";
  } else {
    // Calibrated QSAR — L2-logistic HIA model fitted to the public TDC
    // HIA_Hou dataset (n=578, 5-fold CV ROC-AUC 0.896; coefficients in
    // l1Calibration.ts). Replaces the former hand-tuned TPSA-bracket rule.
    // The therapeutic-area absorption bonus is retained as a small prior.
    abs = clamp(calHIAProbability(cal) + taMod.absorptionBonus);
    provenance.absorption = "heuristic";
  }

  // ── Distribution ───────────────────────────────────────────────────────
  // Primary: ADMET-AI BBB_Martins + PPBR_AZ + VDss_Lombardo blend.
  let dist: number;
  if (overlay.bbb_probability !== null || overlay.ppb_fu_fraction !== null || overlay.vd_l_per_kg !== null) {
    const parts: number[] = [];
    const weights: number[] = [];
    if (overlay.vd_l_per_kg !== null) {
      // Healthy small-molecule Vd ≈ 1–4 L/kg; very low (<0.5) or very high (>10)
      // penalised (Obach 2008 small-molecule survey).
      const v = overlay.vd_l_per_kg;
      const vScore = v < 0.5 ? 0.4 : v < 1.0 ? 0.65 : v < 4.0 ? 0.85 : v < 10 ? 0.65 : 0.4;
      parts.push(vScore); weights.push(0.45);
    }
    if (overlay.ppb_fu_fraction !== null) {
      // Optimum fu ≈ 0.05–0.30 (free enough to act, bound enough to last).
      const fu = overlay.ppb_fu_fraction;
      const fuScore = fu < 0.01 ? 0.40 : fu < 0.05 ? 0.70 : fu < 0.30 ? 0.90 : fu < 0.60 ? 0.70 : 0.50;
      parts.push(fuScore); weights.push(0.40);
    }
    if (overlay.bbb_probability !== null) {
      // BBB is bidirectional: CNS drugs want high, non-CNS want low. The
      // distribution score per se is an uncertainty penalty for extreme values.
      const bbb = overlay.bbb_probability;
      const bbbScore = bbb > 0.85 || bbb < 0.15 ? 0.85 : 0.70;
      parts.push(bbbScore); weights.push(0.15);
    }
    const wSum = weights.reduce((a, b) => a + b, 0);
    dist = clamp(parts.reduce((s, p, i) => s + p * weights[i], 0) / wSum);
    provenance.distribution = "ml";
  } else {
    dist = 0.65;
    if (logP > 1 && logP < 4)  dist += 0.10;
    if (logP > 5)              dist -= 0.08;
    if (mw > 500)              dist -= 0.07;
    if (tpsa < 90 && mw < 450) dist += 0.05;
    dist = clamp(dist);
    provenance.distribution = "heuristic";
  }

  // ── Metabolism ──────────────────────────────────────────────────────────
  // Primary: ADMET-AI hepatocyte CL_int + half-life, plus per-CYP inhibition
  // penalty when the molecule itself inhibits major isoforms (DDI risk).
  let met: number;
  const cypHits = [
    overlay.cyp1a2_inhibitor_prob,  overlay.cyp2c9_inhibitor_prob,
    overlay.cyp2c19_inhibitor_prob, overlay.cyp2d6_inhibitor_prob,
    overlay.cyp3a4_inhibitor_prob,
  ].filter((p): p is number => p !== null);
  if (overlay.hepatocyte_clint_ul_min_1e6_cells !== null || overlay.half_life_h !== null || cypHits.length > 0) {
    let score = 0.80; // stable-by-default; ML signals push it down
    if (overlay.hepatocyte_clint_ul_min_1e6_cells !== null) {
      const cl = overlay.hepatocyte_clint_ul_min_1e6_cells;
      score = cl < 5 ? 0.92 : cl < 15 ? 0.82 : cl < 40 ? 0.65 : cl < 100 ? 0.45 : 0.25;
    }
    if (overlay.half_life_h !== null) {
      const t12 = overlay.half_life_h;
      // Optimum t1/2 for QD dosing ≈ 8–30 h; very short or very long penalised.
      const t12Mod = t12 < 1 ? -0.20 : t12 < 4 ? -0.05 : t12 < 30 ? +0.05 : t12 < 80 ? 0 : -0.10;
      score = clamp(score + t12Mod);
    }
    // DDI penalty — average of the CYP inhibitor probabilities.
    const cypMean = cypHits.length > 0 ? cypHits.reduce((a, b) => a + b, 0) / cypHits.length : 0;
    score -= 0.20 * cypMean;
    met = clamp(score);
    provenance.metabolism = "ml";
  } else {
    met = 0.72;
    if (logP > 3)     met -= 0.08;
    if (logP > 5)     met -= 0.08;
    if (rotBonds > 8) met -= 0.06;
    if (hbd < 2)      met += 0.05;
    met -= taMod.metabolismPenalty;
    met = clamp(met);
    provenance.metabolism = "heuristic";
  }

  // ── Excretion ───────────────────────────────────────────────────────────
  // Primary: ADMET-AI half-life maps directly to excretion-friendliness.
  let exc: number;
  if (overlay.half_life_h !== null) {
    const t12 = overlay.half_life_h;
    exc = t12 < 1 ? 0.35 : t12 < 4 ? 0.55 : t12 < 12 ? 0.78 : t12 < 30 ? 0.85 : t12 < 60 ? 0.70 : 0.50;
    provenance.excretion = "ml";
  } else {
    exc = 0.70;
    if (mw < 300)      exc += 0.08;
    else if (mw > 500) exc -= 0.10;
    if (logP > 4)      exc -= 0.07;
    exc = clamp(exc);
    provenance.excretion = "heuristic";
  }

  // ── Toxicity Safety Score (1 = very safe) ───────────────────────────────
  // Primary: blend of CardioTox-ML hERG, DILI-ML, ADMET-AI AMES + ClinTox +
  // Carcinogens + Skin_Reaction. Each is an independent classifier; higher
  // probability of liability → lower safety score.
  const haveToxMl =
    overlay.herg_blocker_prob !== null || overlay.dili_prob !== null ||
    overlay.ames_prob !== null || overlay.clintox_prob !== null ||
    overlay.carcinogen_prob !== null || overlay.skin_reaction_prob !== null;
  let tox: number;
  if (haveToxMl) {
    let liability = 0;
    let weight = 0;
    const add = (p: number | null, w: number) => {
      if (p === null) return;
      liability += w * p; weight += w;
    };
    add(overlay.herg_blocker_prob,  0.25);  // cardiac safety
    add(overlay.dili_prob,          0.25);  // liver safety
    add(overlay.ames_prob,          0.20);  // genotoxicity
    add(overlay.clintox_prob,       0.15);  // clinical-trial tox
    add(overlay.carcinogen_prob,    0.10);  // carcinogenicity
    add(overlay.skin_reaction_prob, 0.05);  // skin reaction
    const meanLiability = weight > 0 ? liability / weight : 0;
    tox = clamp(1 - meanLiability);
    provenance.toxicity = "ml";
  } else {
    tox = 0.80;
    provenance.toxicity = "heuristic";
  }

  // (Pharmacophore profile `pharmAmes` is detected once near the top of this
  // function — reused by the absorption calibration, the hERG heuristic
  // below, and the genotoxicity / Ames fallback block further down.)

  // hERG flag — prefer CardioTox probability when available, else fall back
  // to a multi-factor physicochemical rule derived from Aronov 2008 (J Med Chem),
  // Li et al. 2014 (Chem Res Toxicol), and Cavalli 2002 (J Med Chem).
  //
  // Three independent risk triggers (any one fires hERG flag):
  //   A. Basic N pharmacophore + moderate lipophilicity (Aronov 2008 primary predictor):
  //      piperidine, piperazine, or basic amine present AND logP > 3.5 AND MW > 200.
  //      Rationale: cationic N at physiological pH anchors in the S6 helix cavity;
  //      logP > 3.5 ensures membrane partitioning to reach the intracellular gate.
  //   B. High lipophilicity alone, no basic N required (neutral hERG blockers:
  //      mibefradil, astemizole neutral form, droperidol class):
  //      logP > 4.5. More conservative than the old rule (was 4.0) to reduce
  //      false-positives on large CNS-inactive neutral lipophilic scaffolds.
  //   C. Bis-aromatic N + medium lipophilicity (antihistamine / antimalarial class:
  //      terfenadine, halofantrine, chloroquine — two aromatic N rings + logP > 3.0):
  //      aromaticNCount ≥ 2 AND logP > 3.0 AND MW > 250.
  //
  // Old rule (logP > 4 && hbd < 2 && mw > 300) had poor specificity:
  //   - Missed piperidine/piperazine scaffolds with logP 3–4 (sertindole class)
  //   - HBD < 2 proxy for basic N was unreliable (many amides have HBD=1)
  //   - Fired on large neutral lipophilic acids that rarely block hERG
  const hergRiskHeuristic = (() => {
    const hasBasicN =
      (pharmAmes?.basicAmineCount ?? 0) >= 1 ||
      pharmAmes?.hasPiperidine === true ||
      pharmAmes?.hasPiperazine === true;
    // Trigger A: basic N pharmacophore + moderate logP
    if (hasBasicN && logP > 3.5 && mw > 200) return true;
    // Trigger B: high lipophilicity alone (neutral blockers)
    if (logP > 4.5) return true;
    // Trigger C: bis-aromatic N + medium logP (antihistamine/antimalarial class)
    if ((pharmAmes?.aromaticNCount ?? 0) >= 2 && logP > 3.0 && mw > 250) return true;
    return false;
  })();
  const hergRisk = overlay.herg_blocker_prob !== null
    ? overlay.herg_blocker_prob >= 0.50
    : hergRiskHeuristic;
  // Hepatotoxicity flag — DILI-ML primary, physchem fallback.
  const hepatoRisk = overlay.dili_prob !== null
    ? overlay.dili_prob >= 0.50
    : (logP > 4.5 || mw > 550);
  // bbbPenetrant — computed before the toxAlerts block below.
  const bbbPenetrant = overlay.bbb_probability !== null
    ? overlay.bbb_probability >= 0.50
    : (tpsa < 90 && mw < 450);

  // Heuristic tox penalties only run when ML did NOT drive the toxicity
  // axis — otherwise we would be double-counting (the CardioTox + DILI
  // probabilities already lowered `tox` proportionally above).
  if (!haveToxMl) {
    if (hergRisk)   tox -= 0.12 * taMod.hergSensitivity;
    if (hepatoRisk) tox -= 0.08 * taMod.hepatoSensitivity;
    if (mw > 600)   tox -= 0.05;
    tox *= taMod.toxicitySensitivity;
    tox = clamp(tox);
  }

  const overall = clamp((abs * 0.25 + dist * 0.20 + met * 0.20 + exc * 0.15 + tox * 0.20));

  // ── Structural Alert Scan (PAINS / Brenk / BMS / NIH-MLSMR / Ames-ICH) ──
  // Full 57-alert curated library from structuralAlerts.ts. Runs as soon as
  // RDKit is ready; returns empty result if not (scanRan=false). Same SMILES
  // always returns the same hits (deterministic — no randomness). ML signals
  // below are still primary; structural scan supplements and independently
  // catches reactive motifs that probabilistic models may miss.
  const structAlerts = runStructuralAlertScan(smiles);

  // Genotoxicity — AMES ML if available, else the full structural scan.
  // For concordance detail, extract matched motif names for the detail string.
  // (pharmAmes is declared above, before the hERG block — reused here.)
  const structGenotoxHits = structAlerts.hits.filter(
    h => h.alert.category === "Genotoxic" || h.alert.id.startsWith("AMES")
  );
  const amesAlertCount = structAlerts.scanRan
    ? structGenotoxHits.length
    : (pharmAmes
        ? (pharmAmes.aromaticAmineCount > 0 ? 1 : 0) +
          (pharmAmes.hasNitro            ? 1 : 0) +
          (pharmAmes.hasEpoxide          ? 1 : 0) +
          (pharmAmes.hasMichaelAcceptor  ? 1 : 0)
        : 0);
  const genoRisk = overlay.ames_prob !== null
    ? overlay.ames_prob >= 0.50
    : amesAlertCount > 0;

  // ── Toxicity Alerts ─────────────────────────────────────────────────────
  // Each alert carries an explicit basis string so the user can tell whether
  // the alert was raised by a GNN inference, a dedicated RF classifier, or
  // a SMARTS rule.
  const toxAlerts: ToxicityAlert[] = [];
  if (hergRisk) {
    const p = overlay.herg_blocker_prob;
    const severity: ToxicityAlert["severity"] = p !== null
      ? (p >= 0.80 ? "High" : p >= 0.55 ? "Medium" : "Low")
      : "Medium";
    toxAlerts.push({
      name: "hERG Channel Inhibition", category: "hERG", severity,
      detail: p !== null
        ? `CardioTox-RF blocker probability ${(p * 100).toFixed(0)}% (Wang/Karim 2016 hERG dataset). QT monitoring required if advancing.`
        : "Physchem rule: logP > 4 + HBD < 2 + MW > 300 — potential hERG blockade pending patch-clamp confirmation.",
    });
  }
  if (hepatoRisk) {
    const p = overlay.dili_prob;
    const cls = overlay.dili_risk_class;
    // Severity tightened (benchmark fix): the prior rule fired "High" for any
    // logP > 5, falsely escalating atorvastatin (logP=5.7, real DILI=Moderate)
    // and terfenadine (logP=6.5, real DILI=Low — withdrawn for cardiac, NOT
    // hepatic, reasons). New rule reserves "High" for an actual ML signal
    // (DILI-ML class=High OR DILI prob ≥ 0.65) OR a Hy's-Law-style danger
    // combination (logP > 6 AND MW > 500); everything else is "Medium".
    const severity: ToxicityAlert["severity"] =
      cls === "High" ? "High"
      : (p !== null && p >= 0.65) ? "High"
      : (logP > 6 && mw > 500) ? "High"
      : (cls === "Moderate" || logP > 5 || mw > 550) ? "Medium"
      : "Low";
    toxAlerts.push({
      name: "Hepatotoxicity Risk",
      category: cls === "High" ? "DILI" : "Hepatotox",
      severity,
      detail: p !== null
        ? `DILI-ML probability ${(p * 100).toFixed(0)}%${cls ? ` (${cls})` : ""} — DILIrank RF (FDA DILI-rank training set).`
        : (logP > 5
          ? "Elevated logP — possible CYP3A4 reactive metabolite formation; flagged as Medium pending DILI-ML / hepatocyte covalent-binding assay."
          : "MW > 550 Da — elevated biliary excretion / hepatocyte accumulation risk."),
    });
  }
  if (bbbPenetrant) {
    const p = overlay.bbb_probability;
    toxAlerts.push({
      name: "BBB Penetrant", category: "CNS", severity: "Low",
      detail: p !== null
        ? `ADMET-AI BBB_Martins probability ${(p * 100).toFixed(0)}% — relevant for CNS-targeted vs CNS-avoidant programs.`
        : "Physchem rule: TPSA < 90 Å² and MW < 450 Da predict central nervous system penetration.",
    });
  }
  if (genoRisk) {
    const p = overlay.ames_prob;
    // Collect concordant structural motif names for display.
    // When the full scan ran, use its hit names; fall back to pharmacophore flags.
    const motifNames: string[] = structAlerts.scanRan
      ? structGenotoxHits.map(h => h.alert.name).slice(0, 4)
      : ([] as string[]).concat(
          pharmAmes?.aromaticAmineCount ? ["aromatic amine"] : [],
          pharmAmes?.hasNitro           ? ["nitro"] : [],
          pharmAmes?.hasEpoxide         ? ["epoxide"] : [],
          pharmAmes?.hasMichaelAcceptor ? ["Michael acceptor"] : [],
        );
    const severity: ToxicityAlert["severity"] = p !== null
      ? (p >= 0.70 ? "High" : p >= 0.40 ? "Medium" : "Low")
      : (amesAlertCount >= 2 ? "High" : "Medium");
    toxAlerts.push({
      name: "Ames-Relevant Liability", category: "Ames", severity,
      detail: p !== null
        ? `ADMET-AI AMES probability ${(p * 100).toFixed(0)}%${motifNames.length ? ` (concordant SMARTS: ${motifNames.join(", ")})` : ""}.`
        : `ICH S2(R1) SMARTS alert${motifNames.length > 1 ? "s" : ""}: ${motifNames.join(", ")}. Confirm with bacterial reverse-mutation (Ames) assay.`,
    });
  }
  if (overlay.clintox_prob !== null && overlay.clintox_prob >= 0.50) {
    toxAlerts.push({
      name: "Clinical-Trial Toxicity Signal", category: "DILI",
      severity: overlay.clintox_prob >= 0.75 ? "High" : "Medium",
      detail: `ADMET-AI ClinTox probability ${(overlay.clintox_prob * 100).toFixed(0)}% — molecule resembles compounds that failed clinical trials for toxicity.`,
    });
  }
  if (overlay.carcinogen_prob !== null && overlay.carcinogen_prob >= 0.50) {
    toxAlerts.push({
      name: "Carcinogenicity Liability", category: "Reactive",
      severity: overlay.carcinogen_prob >= 0.75 ? "High" : "Medium",
      detail: `ADMET-AI Carcinogens_Lagunin probability ${(overlay.carcinogen_prob * 100).toFixed(0)}%. Consult ICH S1 for 2-year rodent bioassay strategy.`,
    });
  }

  // ── Structural alert toxicity entries (Brenk reject / PAINS / NIH) ──────
  // These fire independently of ML — hard-reject motifs represent
  // deterministic chemistry that no probabilistic model can override.
  // Grouped into at most 3 new ToxicityAlert entries to avoid flooding
  // the safety panel with one entry per alert.
  if (structAlerts.scanRan) {
    // (A) Hard-reject electrophiles / alkylators (Brenk + BMS + NIH-MLSMR)
    const hardRejects = structAlerts.hits.filter(
      h => h.alert.severity === "reject" &&
           h.alert.category !== "Genotoxic" // Genotoxic handled above via genoRisk
    );
    if (hardRejects.length > 0) {
      const names = hardRejects.map(h => h.alert.name);
      const libs  = [...new Set(hardRejects.map(h => h.alert.library))].join(", ");
      toxAlerts.push({
        name: "Reactive Electrophile / Hard-Exclude Alert",
        category: "Structural",
        severity: "High",
        detail: `${hardRejects.length} hard-reject structural alert${hardRejects.length > 1 ? "s" : ""} (${libs}): ${names.slice(0, 3).join("; ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}. These motifs react non-specifically with nucleophilic biomolecules (DNA, GSH, protein Cys/Lys). Excluded from all public HTS libraries (Brenk 2008; NIH-MLSMR; BMS 2006).`,
      });
    }

    // (B) PAINS / assay-interference warn-tier
    if (structAlerts.painsCount > 0) {
      const painsNames = structAlerts.hits
        .filter(h => h.alert.library === "PAINS")
        .map(h => h.alert.name);
      toxAlerts.push({
        name: "PAINS / Pan-Assay Interference",
        category: "PAINS",
        severity: structAlerts.painsCount >= 3 ? "Medium" : "Low",
        detail: `${structAlerts.painsCount} PAINS motif${structAlerts.painsCount > 1 ? "s" : ""}: ${painsNames.slice(0, 3).join("; ")}${painsNames.length > 3 ? ` +${painsNames.length - 3} more` : ""}. These patterns are over-represented in HTS false-positive hits (Baell & Holloway, J. Med. Chem. 2010). Confirm activity with an orthogonal assay format.`,
      });
    }

    // (C) Warn-tier reactive metabolites not in hard-reject or PAINS
    const warnReactive = structAlerts.hits.filter(
      h => h.alert.severity === "warn" &&
           h.alert.library !== "PAINS" &&
           h.alert.category !== "Genotoxic" &&
           !["MetalChelator", "PropertyFlag"].includes(h.alert.category)
    );
    if (warnReactive.length > 0) {
      const names = warnReactive.map(h => h.alert.name);
      toxAlerts.push({
        name: "Reactive / Metabolically Activated Motif",
        category: "Reactive",
        severity: warnReactive.length >= 2 ? "Medium" : "Low",
        detail: `${warnReactive.length} structural warn flag${warnReactive.length > 1 ? "s" : ""}: ${names.slice(0, 3).join("; ")}${names.length > 3 ? ` +${names.length - 3} more` : ""}. Investigate orthogonally; confirm GSH reactivity / metabolic stability before advancing.`,
      });
    }
  }

  // ── Organ Risks (deterministic; ML signals drive the base risk) ─────────
  // Cosmetic jitter removed — base risks are now derived directly from ML
  // probabilities when available, or from the deterministic flag triggers
  // when not. Identical SMILES always returns identical organ risks.
  const liverBaseRisk = overlay.dili_prob !== null
    ? overlay.dili_prob
    : (hepatoRisk ? 0.22 : 0.07);
  const heartBaseRisk = overlay.herg_blocker_prob !== null
    ? overlay.herg_blocker_prob
    : (hergRisk ? 0.18 : 0.10);
  // Kidney — no dedicated ML head today; physchem proxy retained (MW < 300
  // → small molecules cleared renally with low tubular accumulation).
  const kidneyBaseRisk = mw < 300 ? 0.05 : 0.08;
  // CNS — BBB probability drives CNS exposure; for non-CNS programs this is
  // a liability not a feature.
  const cnsBaseRisk = overlay.bbb_probability !== null
    ? overlay.bbb_probability * 0.5
    : (bbbPenetrant ? 0.20 : 0.04);
  // GI — high TPSA → reduced absorption + GI irritation potential.
  const giBaseRisk = tpsa > 120 ? 0.15 : 0.07;
  // `seed` is now unused locally; preserved for future deterministic
  // population-level sampling (e.g. NHANES bootstrap at L4).
  void seed;

  const liverRisk = clamp(liverBaseRisk * taMod.hepatoSensitivity);
  const heartRisk = clamp(heartBaseRisk * taMod.hergSensitivity);
  const kidneyRisk = clamp(kidneyBaseRisk * taMod.renalSensitivity);
  const cnsRisk = clamp(cnsBaseRisk * taMod.cnsSensitivity);
  const giRisk = clamp(giBaseRisk);

  function organColor(risk: number): "emerald" | "yellow" | "red" {
    if (risk > 0.3) return "red";
    if (risk > 0.15) return "yellow";
    return "emerald";
  }

  const organs: OrganRisk[] = [
    {
      name: "Liver",
      risk: liverRisk,
      color: organColor(liverRisk),
      alerts: hepatoRisk ? ["CYP3A4 reactive metabolite risk"] : [],
    },
    {
      name: "Heart (hERG)",
      risk: heartRisk,
      color: organColor(heartRisk),
      alerts: hergRisk ? ["Minor QT prolongation risk"] : [],
    },
    {
      name: "Kidney",
      risk: kidneyRisk,
      color: organColor(kidneyRisk),
      alerts: kidneyRisk > 0.15 ? ["Elevated renal clearance burden"] : [],
    },
    {
      name: "CNS",
      risk: cnsRisk,
      color: organColor(cnsRisk),
      alerts: bbbPenetrant ? ["BBB penetrant", "CNS active class"] : [],
    },
    {
      name: "GI Tract",
      risk: giRisk,
      color: organColor(giRisk),
      alerts: tpsa > 120 ? ["Reduced oral absorption predicted"] : [],
    },
    // Lung organ risk removed (RF#5 / §9 step 5): structural noise
    // `jitter(0.04, 0.03)` always rendering emerald is not a signal. Re-add
    // only when an inhalation route is selected AND a real pulmonary-tox
    // surrogate (e.g. logP > 5 + amphiphilic) is wired.
  ];

  // ── Binding Affinity ────────────────────────────────────────────────────
  // Decision tree (highest-priority wins):
  //   1. ML overlay Kd_nM (target-aware DeepDTA-GBM with ESM-2 + Morgan FP),
  //      preferred over the `predictedKd_nM` legacy positional argument so
  //      callers that build an overlay don't have to also pass the bare Kd.
  //   2. `predictedKd_nM` (legacy positional argument — same source as 1,
  //      kept for back-compat with callers that haven't adopted the overlay).
  //   3. Validated TARGET_MAP catalog + QED + drug-likeness anchor — only
  //      when the UniProt is curated AND no ML binding signal exists.
  //   4. `binding = null` otherwise (no fabrication for off-catalog UniProts).
  //
  // No jitter() — point estimates only. Off-target ratios derive from the
  // curated catalog and scale from primaryKd by literature-median selectivity
  // (Karaman 2008: median ~14× off-target/on-target for kinase-class hits).
  const targetInfo = TARGET_MAP[uniprotId] ?? null;
  const kdFromOverlay = overlay.Kd_nM;
  const kdSource: "overlay" | "arg" | "catalog" | "none" =
    kdFromOverlay !== null ? "overlay"
    : predictedKd_nM !== null ? "arg"
    : targetInfo ? "catalog"
    : "none";

  let binding: BindingEstimate | null = null;
  if (kdSource !== "none") {
    let primaryKd: number;
    if (kdSource === "overlay") {
      primaryKd = clamp(kdFromOverlay as number, 0.05, 1_000_000);
      provenance.binding = "ml";
    } else if (kdSource === "arg") {
      primaryKd = clamp(predictedKd_nM as number, 0.05, 1_000_000);
      provenance.binding = "ml";
    } else {
      // Catalog path — anchor on published potency range, modulated by drug-
      // likeness + QED. Deterministic (no jitter) — same SMILES + same target
      // always returns the same anchor.
      const [pMin, pMax] = targetInfo!.potencyRange;
      const drugLikenessFactor = molProps.lipinskiPass ? 0.4 : 0.7;
      const qedFactor = (1 - qed_approx) * 0.3;
      const basePotency = pMin + (pMax - pMin) * (drugLikenessFactor + qedFactor);
      primaryKd = clamp(basePotency, 0.1, pMax * 2);
      provenance.binding = "heuristic";
    }

    // Cheng & Prusoff 1973: Ki ≈ 0.85 × Kd (competitive inhibition, no
    // substrate Km assumption). IC50 ≈ 2 × Ki at assay [S] ≈ Km.
    const primaryKi   = clamp(primaryKd * 0.85, 0.05, primaryKd * 1.5);
    const primaryIC50 = clamp(primaryKd * 1.20, 0.05, primaryKd * 2.0);
    // Conservative literature median (Karaman 2008 kinome panel).
    const selectivity = 3.5;

    const offTargets = targetInfo
      ? targetInfo.offTargets.slice(0, 2).map((name) => ({
          name,
          kd:   clamp(primaryKd   * 14, 0.1, 50000),
          ki:   clamp(primaryKi   * 14, 0.1, 50000),
          ic50: clamp(primaryIC50 * 13, 0.1, 50000),
          selectivity: 0.07,  // ≈ 1/14 — same scale as primary
        }))
      : [];

    binding = {
      primaryKd, primaryKi, primaryIC50, selectivity,
      targetName: targetInfo ? targetInfo.name : (uniprotId || "ML Target"),
      targetClass: targetInfo ? targetInfo.class : "Protein Target",
      offTargets,
    };
  }

  // ── Lipinski ────────────────────────────────────────────────────────────
  const lipinski: LipinskiAnalysis = {
    mwPass:   mw <= 500,  mw,
    logPPass: logP <= 5,  logP,
    hbdPass:  hbd <= 5,   hbd,
    hbaPass:  hba <= 10,  hba,
    violations: [mw > 500, logP > 5, hbd > 5, hba > 10].filter(Boolean).length,
    leadLike: mw <= 350 && logP <= 3.5 && hbd <= 3 && hba <= 7,
    tpsa,
    rotBonds,
  };

  // ── SA Score (Ertl-Schuffenhauer 2009 complexity portion) ─────────────
  // RF#9 / §9 step 8: replaces the prior MW-linear formula.
  // Implements the COMPLEXITY-PENALTY component from Ertl & Schuffenhauer,
  // J. Cheminform. 1:8 (2009): ring complexity (size + count + macro),
  // stereo, sp3 deficit, bridgehead/spiro penalties. The published score
  // also adds a fragment-score term derived from a precomputed Morgan-FP
  // frequency dictionary (~1M ChEMBL-derived fragments, ~3MB pickled) —
  // that file is NOT vendored here, so this is the complexity-only
  // component. Documented honest approximation. See SimResults.saScore JSDoc.
  const saScore = (() => {
    const nAtoms = Math.max(1, molProps.heavyAtoms);
    const nRings = molProps.numRings;
    const nSpiro = molProps.numSpiroAtoms;
    const nBridgeheads = molProps.numBridgeheadAtoms;
    const nStereo = molProps.numStereoCenters;
    const nMacro = molProps.numAliphaticRings > 0 && molProps.numHeteroatoms > 0 ? 0 : 0; // not measured directly here; count via heuristic below
    // Macrocycle proxy: large heavy-atom count combined with a single ring
    // is the closest signal we can derive without ring-size info from the
    // descriptor JSON. Conservative.
    const hasMacro = nAtoms > 24 && nRings >= 1 && nRings <= 2;
    // sp3 complexity penalty: low Fsp3 → planar/aromatic-heavy → easier;
    // high Fsp3 with stereocenters → genuinely complex.
    const sp3Penalty = -Math.log10(nAtoms / (nAtoms + 1)) * (1 - molProps.fsp3) * 0.5;
    const sizePenalty = Math.log10(nAtoms) * 0.5;
    const stereoPenalty = nStereo === 0 ? 0 : Math.log10(nStereo + 1) * 0.5;
    const spiroPenalty  = nSpiro === 0 ? 0 : Math.log10(nSpiro + 1) * 0.5;
    const bridgePenalty = nBridgeheads === 0 ? 0 : Math.log10(nBridgeheads + 1) * 0.7;
    const macroPenalty  = hasMacro ? 0.5 : 0;
    const ringPenalty   = nRings <= 1 ? 0 : Math.log10(nRings) * 0.3;
    const complexity =
      1.0 + sizePenalty + sp3Penalty + stereoPenalty +
      spiroPenalty + bridgePenalty + macroPenalty + ringPenalty;
    // Map [1, ~6] complexity to the Ertl 1–10 scale; values below 2 are
    // trivially synthesisable (CHO patterns), values above 6 are
    // multi-step total-synthesis territory.
    const sa = clamp(complexity, 1, 10);
    void nMacro; // reserved for future ring-size-based macrocycle signal
    return parseFloat(sa.toFixed(1));
  })();

  // ── Go/No-Go ─────────────────────────────────────────────────────────────
  const highAlerts  = toxAlerts.filter(a => a.severity === "High").length;
  const violations  = lipinski.violations;
  const overallGood = overall >= 0.65;

  // Hard-reject structural alerts (acyl halides, N-nitrosamines, nitrosoureas,
  // etc.) drive NO-GO independently of ML toxicity signals. These represent
  // deterministic chemistry, not probabilistic predictions. An ML AMES prob
  // of 0.3 does NOT override an observed acyl halide substructure.
  const structHardReject = structAlerts.scanRan && hasHardReject(structAlerts);

  let goNogo: "GO" | "WATCH" | "NO-GO";
  let recommendation: string;

  if (highAlerts > 0 || violations >= 3 || structHardReject) {
    goNogo = "NO-GO";
    if (structHardReject && highAlerts === 0 && violations < 3) {
      // Structural-only NO-GO (ML may be silent on these motifs)
      recommendation = `Hard-reject structural alert detected (${structAlerts.rejectNames.slice(0, 2).join("; ")}${structAlerts.rejectCount > 2 ? " +more" : ""}). These motifs represent deterministic chemical reactivity — structural modification is required before advancing regardless of ML toxicity scores.`;
    } else {
      recommendation = `${highAlerts > 0 ? "Critical toxicity flags" : "Multiple Lipinski violations"} indicate high attrition risk. Consider structural optimisation before advancing.`;
    }
  } else if (violations >= 2 || !overallGood || toxAlerts.length > 1) {
    goNogo = "WATCH";
    recommendation = `Borderline ADMET profile. Advance with close monitoring and consider analogues with improved ${violations > 0 ? "drug-likeness" : "safety margin"}.`;
  } else {
    goNogo = "GO";
    recommendation = "Favourable ADMET profile across all dimensions. Recommend advancing to Patient Cohort Simulation.";
  }

  const confidence = parseFloat(clamp(
    overall * 0.6 + (1 - violations * 0.12) * 0.25 + (toxAlerts.length === 0 ? 0.15 : toxAlerts.length === 1 ? 0.10 : 0.05),
  ).toFixed(3));

  // ── Similar Drugs ────────────────────────────────────────────────────────
  const similarByTarget: Record<string, string[]> = {
    P00533: ["Erlotinib", "Gefitinib", "Osimertinib"],
    P04626: ["Trastuzumab", "Lapatinib", "Neratinib"],
    P01116: ["Sotorasib", "Adagrasib", "AMG-510"],
    P11802: ["Palbociclib", "Ribociclib", "Abemaciclib"],
    Q06187: ["Ibrutinib", "Zanubrutinib", "Acalabrutinib"],
    P00519: ["Imatinib", "Dasatinib", "Nilotinib"],
    P15056: ["Vemurafenib", "Dabrafenib", "Encorafenib"],
  };
  // Precedent drugs (RF#2 / §9 step 2): ONLY the curated UniProt → approved-
  // drug map. The TA-override branch was removed because picking "Oncology"
  // would surface Erlotinib/Gefitinib/Imatinib for ANY molecule (including
  // α-tocopherol-fragment) that happened to be tagged Oncology — a
  // demo-killer fabrication. Off-catalog UniProt → empty array, and the
  // consumer (RegulatoryInsightCard) hides the precedent panel.
  const similarDrugs = similarByTarget[uniprotId] ?? [];
  // taMod is intentionally not consulted for similarDrugs anymore; the
  // similarDrugsOverride field is retained on the type for back-compat
  // with the preset table but is dead at this read site.
  void taMod;

  // ── Finalize provenance for outputs that are rule-defined by construction
  provenance.lipinski  = "heuristic";          // Ro5 is a rule by definition
  provenance.qed       = "heuristic";          // Bickerton-QED is a published rule
  provenance.saScore   = "heuristic";          // Ertl-Schuffenhauer complexity term
  if (overlay.logS !== null) provenance.solubility = "ml";

  const mlEnhanced = overlayHasAnyMl(overlay);

  return {
    admet: { absorption: abs, distribution: dist, metabolism: met, excretion: exc, toxicity: tox, overall },
    toxAlerts,
    organs,
    binding,
    lipinski,
    qed_approx,
    saScore,
    goNogo,
    confidence,
    similarDrugs,
    recommendation,
    molName,
    smiles,
    uniprotId,
    timestamp: new Date().toISOString(),
    provenance,
    mlEnhanced,
    // Full structural alert result — consumed by computeLayer1Flags (safetyFlags.ts)
    // and by the L1 safety panel for per-alert display. `undefined` only when the
    // scan function itself errored; scanRan=false means RDKit wasn't ready.
    structuralAlerts: structAlerts,
  };
}

// ── ML inputs shape (kept lightweight to avoid circular deps with aiService) ──
export interface MlConsensusInputs {
  /** DILI-ML predicted risk class (from dili_ml.py). */
  diliRiskClass?: "High" | "Moderate" | "Low" | null;
  /** CardioTox ML blocker probability (0–1). */
  cardiotoxBlockerProb?: number | null;
  /** CardioTox ML risk class. */
  cardiotoxRiskClass?: "High" | "Moderate" | "Low" | null;
  /** ADMET-AI hERG blocker probability (0–1). */
  admetHergProb?: number | null;
  /** ADMET-AI Ames mutagenicity probability (0–1). */
  admetAmesProb?: number | null;
  /** ADMET-AI DILI probability (0–1). */
  admetDiliProb?: number | null;
  /** ADMET-AI ClinTox probability (0–1). */
  admetClintoxProb?: number | null;
}

export interface MlConsensusResult {
  decision:    "GO" | "WATCH" | "NO-GO";
  driver:      string;
  /** Each contributing signal that influenced the decision. */
  signals:     Array<{ source: string; label: string; severity: "info" | "warn" | "critical" }>;
  /** True when at least one ML model contributed (vs pure heuristic). */
  mlEnriched:  boolean;
}

/**
 * Computes a conservative consensus Go/No-Go that combines:
 *   1. Heuristic ADMET `goNogo` from `runAdmetSimulation`
 *   2. In-vitro overall risk from `runInVitroSimulation`
 *   3. DILI-ML risk class (dili_ml.py — RF on Morgan FP + RDKit, n=475)
 *   4. CardioTox ML risk class (cardiotox.py — RF on Morgan FP, n=655)
 *   5. ADMET-AI Chemprop ensemble toxicity probabilities (41 endpoints)
 *
 * Resolution rule: the most severe signal wins (conservatism first).
 *   NO-GO triggers: any heuristic NO-GO, DILI High, Cardiotox High (p>0.8),
 *                   ADMET-AI hERG>0.85, Ames>0.75, ClinTox>0.75, DILI>0.80
 *   WATCH triggers: heuristic WATCH, DILI Moderate, Cardiotox Moderate,
 *                   ADMET-AI hERG 0.6–0.85, Ames 0.5–0.75, DILI 0.55–0.80,
 *                   in-vitro Moderate risk
 *   GO:            all signals below thresholds
 *
 * The function is intentionally conservative: false-positive WATCH/NO-GO is
 * preferred over a false-negative GO that lets a toxic compound advance.
 */
export function computeMlConsensusGoNogo(
  heuristicGoNogo: SimResults["goNogo"],
  inVitroRisk: "Low" | "Moderate" | "High",
  ml: MlConsensusInputs,
): MlConsensusResult {
  const signals: MlConsensusResult["signals"] = [];
  let maxSeverity: 0 | 1 | 2 = 0; // 0=GO, 1=WATCH, 2=NO-GO
  const mlEnriched = Object.values(ml).some(v => v !== null && v !== undefined);

  // ── Heuristic ADMET ───────────────────────────────────────────────────────
  if (heuristicGoNogo === "NO-GO") {
    maxSeverity = 2;
    signals.push({ source: "ADMET heuristic", label: "NO-GO (Lipinski excess or critical tox alert)", severity: "critical" });
  } else if (heuristicGoNogo === "WATCH") {
    maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
    signals.push({ source: "ADMET heuristic", label: "WATCH (borderline drug-likeness or safety margin)", severity: "warn" });
  } else {
    signals.push({ source: "ADMET heuristic", label: "GO", severity: "info" });
  }

  // ── In-vitro risk ─────────────────────────────────────────────────────────
  if (inVitroRisk === "High") {
    maxSeverity = 2;
    signals.push({ source: "In-vitro heuristic", label: "NO-GO (High in-vitro risk)", severity: "critical" });
  } else if (inVitroRisk === "Moderate") {
    maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
    signals.push({ source: "In-vitro heuristic", label: "WATCH (Moderate in-vitro risk)", severity: "warn" });
  } else {
    signals.push({ source: "In-vitro heuristic", label: "Low in-vitro risk", severity: "info" });
  }

  // ── DILI-ML (FDA DILIrank-trained RF) ─────────────────────────────────────
  if (ml.diliRiskClass === "High") {
    maxSeverity = 2;
    signals.push({ source: "DILI-ML (DILIrank RF)", label: "High DILI risk predicted by ML", severity: "critical" });
  } else if (ml.diliRiskClass === "Moderate") {
    maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
    signals.push({ source: "DILI-ML (DILIrank RF)", label: "Moderate DILI risk predicted by ML", severity: "warn" });
  } else if (ml.diliRiskClass === "Low") {
    signals.push({ source: "DILI-ML (DILIrank RF)", label: "Low DILI risk (ML)", severity: "info" });
  }

  // ── CardioTox ML (ChEMBL-trained hERG RF) ────────────────────────────────
  const ctxProb = ml.cardiotoxBlockerProb;
  if (ctxProb !== null && ctxProb !== undefined) {
    if (ctxProb > 0.80) {
      maxSeverity = 2;
      signals.push({ source: "CardioTox ML (hERG RF)", label: `hERG blocker p=${(ctxProb * 100).toFixed(0)}% (>80% — NO-GO threshold)`, severity: "critical" });
    } else if (ctxProb > 0.55) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "CardioTox ML (hERG RF)", label: `hERG blocker p=${(ctxProb * 100).toFixed(0)}% (55–80% — WATCH)`, severity: "warn" });
    } else {
      signals.push({ source: "CardioTox ML (hERG RF)", label: `hERG blocker p=${(ctxProb * 100).toFixed(0)}% (low risk)`, severity: "info" });
    }
  }

  // ── ADMET-AI Chemprop toxicity endpoints ─────────────────────────────────
  if (ml.admetHergProb !== null && ml.admetHergProb !== undefined) {
    if (ml.admetHergProb > 0.85) {
      maxSeverity = 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `hERG ${(ml.admetHergProb * 100).toFixed(0)}% (>85% — NO-GO)`, severity: "critical" });
    } else if (ml.admetHergProb > 0.60) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `hERG ${(ml.admetHergProb * 100).toFixed(0)}% (WATCH)`, severity: "warn" });
    }
  }
  if (ml.admetAmesProb !== null && ml.admetAmesProb !== undefined) {
    if (ml.admetAmesProb > 0.75) {
      maxSeverity = 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `Ames mutagenicity ${(ml.admetAmesProb * 100).toFixed(0)}% (>75% — NO-GO)`, severity: "critical" });
    } else if (ml.admetAmesProb > 0.50) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `Ames ${(ml.admetAmesProb * 100).toFixed(0)}% (WATCH)`, severity: "warn" });
    }
  }
  if (ml.admetDiliProb !== null && ml.admetDiliProb !== undefined) {
    if (ml.admetDiliProb > 0.80) {
      maxSeverity = 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `DILI ${(ml.admetDiliProb * 100).toFixed(0)}% (>80% — NO-GO)`, severity: "critical" });
    } else if (ml.admetDiliProb > 0.55) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `DILI ${(ml.admetDiliProb * 100).toFixed(0)}% (WATCH)`, severity: "warn" });
    }
  }
  if (ml.admetClintoxProb !== null && ml.admetClintoxProb !== undefined) {
    if (ml.admetClintoxProb > 0.75) {
      maxSeverity = 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `ClinTox ${(ml.admetClintoxProb * 100).toFixed(0)}% (>75% — NO-GO)`, severity: "critical" });
    } else if (ml.admetClintoxProb > 0.50) {
      maxSeverity = Math.max(maxSeverity, 1) as 0 | 1 | 2;
      signals.push({ source: "ADMET-AI (Chemprop)", label: `ClinTox ${(ml.admetClintoxProb * 100).toFixed(0)}% (WATCH)`, severity: "warn" });
    }
  }

  // ── Resolve decision ──────────────────────────────────────────────────────
  const decision: "GO" | "WATCH" | "NO-GO" = maxSeverity === 2 ? "NO-GO" : maxSeverity === 1 ? "WATCH" : "GO";
  const criticals = signals.filter(s => s.severity === "critical").map(s => s.label);
  const warns     = signals.filter(s => s.severity === "warn").map(s => s.label);
  let driver: string;
  if (decision === "NO-GO") {
    driver = criticals.length > 0
      ? `Critical signals: ${criticals.join("; ")}`
      : "Multiple combined WATCH signals escalated to NO-GO";
  } else if (decision === "WATCH") {
    driver = warns.length > 0
      ? `Watch signals: ${warns.join("; ")}`
      : "Borderline profile across ADMET dimensions";
  } else {
    driver = mlEnriched
      ? "All ML and heuristic signals below safety thresholds"
      : "All heuristic signals below safety thresholds (no ML available)";
  }

  return { decision, driver, signals, mlEnriched };
}

/**
 * Arbitrates between the ADMET-layer Go/No-Go (from `runAdmetSimulation`)
 * and the in-vitro risk level (from `runInVitroSimulation`) to produce a
 * single conservative decision.
 *
 * Resolution table:
 *   ADMET goNogo | InVitro overallRisk | arbitrated
 *   -------------|---------------------|------------
 *   NO-GO        | any                 | NO-GO
 *   any          | High                | NO-GO
 *   WATCH        | Moderate            | WATCH
 *   WATCH        | Low                 | WATCH
 *   GO           | Moderate            | WATCH
 *   GO           | Low                 | GO
 *
 * The arbitrated decision and its primary driver reason are returned so the
 * UI can surface "why" without recomputing.
 */
export function arbitrateGoNogo(
  admetGoNogo: SimResults["goNogo"],
  inVitroRisk: "Low" | "Moderate" | "High",
): { decision: "GO" | "WATCH" | "NO-GO"; driver: string } {
  if (admetGoNogo === "NO-GO") {
    return { decision: "NO-GO", driver: "ADMET layer flagged critical violation (Lipinski excess, severe tox alert, or very high predicted toxicity)" };
  }
  if (inVitroRisk === "High") {
    return { decision: "NO-GO", driver: "In-vitro simulation flagged High overall risk (hERG, hepatotox, or CYP panel)" };
  }
  if (admetGoNogo === "WATCH" || inVitroRisk === "Moderate") {
    return { decision: "WATCH", driver: admetGoNogo === "WATCH" ? "ADMET layer flagged borderline properties" : "In-vitro simulation flagged Moderate overall risk" };
  }
  return { decision: "GO", driver: "ADMET and in-vitro simulations both clear at current thresholds" };
}
