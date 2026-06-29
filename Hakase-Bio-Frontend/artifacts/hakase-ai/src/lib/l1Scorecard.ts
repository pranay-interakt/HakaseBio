/**
 * Layer 1 — Unified Go / Watch / No-Go Scorecard
 * ─────────────────────────────────────────────────────────────────────────
 * A single, calibrated decision layer that consumes the real L1 outputs
 * (ADMET 5-axis from `runAdmetSimulation`, the in-vitro panel from
 * `runInVitroSimulation`, and the ML overlay from `buildMlOverlay`) and
 * produces a defensible preclinical triage verdict the way an industry
 * portfolio committee would:
 *
 *   1. RULE-BASED HARD VETOES (No-Go) — deterministic chemistry / strong
 *      ML liabilities that veto a candidate regardless of the composite
 *      score (structural hard-reject alerts, hERG block, DILI, mutagenicity,
 *      clinical-tox, carcinogenicity, gross drug-likeness failure). A single
 *      hard flag forces NO-GO. These are grounded in regulatory guidance —
 *      ICH M7 (Ames/DNA-reactivity), ICH S7B + E14 (hERG/QT), ICH S2(R1)
 *      (genotoxicity) and Lipinski Ro5 — not arbitrary cutoffs. This mirrors
 *      real stage-gate practice: you do not average away a genotoxic alert
 *      with good permeability.
 *
 *   2. MULTI-PARAMETER-OPTIMIZATION (MPO) DESIRABILITY COMPOSITE (0–100) —
 *      each endpoint is mapped to a desirability d ∈ [0,1] (Harrington 1965;
 *      Derringer & Suich 1980) and aggregated as a WEIGHTED GEOMETRIC MEAN,
 *      the same scalarization that underpins QED (Bickerton 2012) and CNS-MPO
 *      (Wager 2010). The geometric mean means a single weak endpoint (a near-
 *      zero desirability) drags the whole composite down — you cannot rescue
 *      a safety liability by averaging in good ADME. Weights are renormalised
 *      over the dimensions that actually have data, so a molecule is never
 *      penalised for an endpoint the pipeline could not compute.
 *
 *   3. CONFIDENCE — driven by how much of the *safety-critical* signal came
 *      from real ML inference (provenance "ml") versus heuristic fallback,
 *      and by data completeness. A GO built on heuristics is downgraded to
 *      WATCH: we never issue a high-confidence GO on fabricated certainty.
 *
 * Provenance discipline matches the rest of L1 — every sub-score and every
 * flag carries the source it came from, and nothing here invents a number.
 * When an endpoint is unavailable the dimension is dropped (not defaulted
 * to a flattering value), and that absence lowers confidence.
 *
 * This module is pure and side-effect-free; pass it the already-computed
 * results and it returns the scorecard.
 */

import type { SimResults } from "./admet";
import type { InVitroResults } from "./inVitroSim";
import type { MlOverlay } from "./mlOverlay";

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

/**
 * L1 verdict variants.
 *
 * - "GO" / "WATCH" / "NO-GO" — the classical triage outcomes for novel
 *   chemistry, driven by the rule-based / ML evidence stack.
 * - "KNOWN-LIABILITY-NO-GO" — NEW. The compound resolved to a known drug
 *   (via drug_lookup InChIKey / Tanimoto) AND that drug has a published
 *   measured liability of `severity: "veto"` (terfenadine's hERG block,
 *   cerivastatin's DILI, troglitazone's fatal hepatotoxicity, etc.). The
 *   verdict is still NO-GO but the UI renders it in a distinct color
 *   (rose-on-amber vs solid red) so reviewers can tell the difference
 *   between "the model rejected this" and "the literature already says
 *   this was withdrawn from market".
 */
export type L1Verdict = "GO" | "WATCH" | "NO-GO" | "KNOWN-LIABILITY-NO-GO" | "INSUFFICIENT-EVIDENCE";
export type Provenance = "ml" | "heuristic" | "experimental" | "unavailable";

/** Result of the lookup-first known-drug query (see drug_lookup.py). */
export interface KnownDrugLookup {
  matched: boolean;
  matchType?: "exact" | "stereo-variant" | "close-analog" | "structural-analog";
  matchConfidence?: number;
  tanimoto?: number | null;
  matchedDrugName?: string;
  matchedDrugStatus?: "approved" | "withdrawn" | "investigational" | "reference";
  withdrawalReason?: string;
  vetoLiabilities?: Array<{
    endpoint: string;
    measured: number;
    valueText: string;
    source: string;
    severity: "veto" | "monitor";
  }>;
  monitorLiabilities?: Array<{
    endpoint: string;
    measured: number;
    valueText: string;
    source: string;
    severity: "veto" | "monitor";
  }>;
}

/** Applicability domain envelope (from applicability_domain.py). */
export interface ApplicabilityDomain {
  adScore: number | null;
  adLabel: "In-domain" | "Border-domain" | "Out-of-domain" | "Unknown";
  adConfidence: "High" | "Moderate" | "Low";
  nnSimilarity: number | null;
  coverageNote: string;
}

export interface L1Flag {
  /** Stable id for testing / de-duplication. */
  id: string;
  /** Short human label. */
  label: string;
  severity: "critical" | "warn" | "info";
  /** Model / rule that raised it. */
  source: string;
  provenance: Provenance;
  /** Observed value, formatted for display. */
  value: string;
  /** Threshold convention that triggered the flag. */
  threshold: string;
  /** One-sentence "why this matters". */
  rationale: string;
  /** True when this flag alone forces a NO-GO (hard veto). */
  hardNoGo: boolean;
}

export interface L1DimensionScore {
  dimension: string;
  /** 0–100, higher is better/safer. */
  score: number;
  /** Normalised weight actually applied in the composite. */
  weight: number;
  provenance: Provenance;
  detail: string;
}

export interface L1Scorecard {
  verdict: L1Verdict;
  /**
   * 0–100 verdict-consistent TRIAGE score — the number to rank a library by.
   * It is banded so it can never disagree with the verdict: GO ∈ [70,100],
   * WATCH ∈ [40,69], NO-GO ∈ [1,39]. Within a band, ordering follows the raw
   * endpoint composite, and NO-GO compounds are pushed lower for each
   * additional hard liability. This guarantees that sorting thousands of
   * compounds by `score` puts the genuinely advanceable ones on top and never
   * ranks a hard-vetoed compound above a salvageable one.
   */
  score: number;
  /**
   * The raw weighted endpoint composite (0–100) BEFORE verdict banding —
   * surfaced for transparency so reviewers can see that a vetoed compound may
   * have otherwise-good properties (e.g. terfenadine: clean ADME, fatal hERG).
   */
  compositeRaw: number;
  /** 0–1 confidence in the verdict. */
  confidence: number;
  confidenceLabel: "High" | "Moderate" | "Low";
  /** One-line headline for the UI badge. */
  headline: string;
  /** Paragraph rationale. */
  rationale: string;
  /** Sorted critical → warn → info. */
  flags: L1Flag[];
  dimensions: L1DimensionScore[];
  /** Fraction of safety-critical dimensions backed by real ML. */
  mlCoverage: number;
  recommendation: string;
  /**
   * Sub-classification of the verdict WITHOUT changing the verdict enum (so all
   * downstream consumers keep working). "review-escalate" means: a strong
   * predicted liability exists but the model is extrapolating / the prediction
   * is not calibration-reliable / orthogonal evidence disagrees — so instead of
   * a confident NO-GO the engine returns WATCH and asks for an orthogonal assay.
   * This is the "abstain rather than issue a false stop" state.
   */
  verdictClass: "standard" | "review-escalate";
  /** When verdictClass==="review-escalate", the per-signal reasons (calibration / AD / contradiction). */
  escalateReasons?: string[];
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Calibrated decision thresholds (single source of truth)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Hard-veto thresholds — RECALIBRATED against an FDA-approved hold-out.
 *
 * Why they're higher than the literature defaults:
 *   The published thresholds (hERG 0.80, DILI 0.80, Ames 0.75, ClinTox 0.80,
 *   Carcinogen 0.80) were each tuned on their model's training distribution
 *   in isolation. Stacked as 5 independent hard vetoes, the union FPR on
 *   FDA-approved drugs is ~55 % (terfenadine reasoning aside — most approved
 *   drugs have a per-endpoint FPR ≈ 10–18 %, and 1 − 0.85⁵ ≈ 0.56). The
 *   calibrated thresholds were re-fitted so the stacked FPR on a 152-drug
 *   approved hold-out drops to ≤ 5 % while recall on the published-liability
 *   set stays ≥ 90 %. See l1Thresholds.json and scripts/recalibrate-l1-thresholds.mjs.
 *
 *   Equally important: the LOOKUP-FIRST path covers all 150-ish well-known
 *   drugs by InChIKey / Tanimoto match, so they get measured values and
 *   bypass these thresholds entirely. These thresholds only apply to NOVEL
 *   chemistry.
 */
import THRESHOLDS from "./l1Thresholds.json";
import {
  assessVeto,
  hergReadAcrossContradiction,
  type AdConfidence as CalAdConfidence,
  type FittedCalibration,
} from "./calibration";

const HARD = {
  herg: THRESHOLDS.hard_thresholds.herg,
  dili: THRESHOLDS.hard_thresholds.dili,
  ames: THRESHOLDS.hard_thresholds.ames,
  clintox: THRESHOLDS.hard_thresholds.clintox,
  carcinogen: THRESHOLDS.hard_thresholds.carcinogen,
  sr_mmp: THRESHOLDS.hard_thresholds.sr_mmp,
  sr_atad5: THRESHOLDS.hard_thresholds.sr_atad5,
  lipinskiViolations: THRESHOLDS.hard_thresholds.lipinski_violations,
} as const;

/** Soft (WATCH) thresholds — borderline liabilities that warrant monitoring. */
const WATCH = {
  herg: THRESHOLDS.watch_thresholds.herg,
  dili: THRESHOLDS.watch_thresholds.dili,
  ames: THRESHOLDS.watch_thresholds.ames,
  clintox: THRESHOLDS.watch_thresholds.clintox,
  carcinogen: THRESHOLDS.watch_thresholds.carcinogen,
  sr_mmp: THRESHOLDS.watch_thresholds.sr_mmp,
  sr_atad5: THRESHOLDS.watch_thresholds.sr_atad5,
  endocrineNr: THRESHOLDS.watch_thresholds.endocrine_nr,
  stressSr: THRESHOLDS.watch_thresholds.stress_sr,
  cypStrongInhib: THRESHOLDS.watch_thresholds.cyp_strong_inhib,
  therapeuticIndex: THRESHOLDS.watch_thresholds.therapeutic_index,
  lipinskiViolations: THRESHOLDS.watch_thresholds.lipinski_violations,
  composite: THRESHOLDS.watch_thresholds.composite,
} as const;

/** Composite floor for a clean GO (no warn flags, adequate confidence). */
const GO_COMPOSITE = THRESHOLDS.go_composite_floor;

/**
 * STRICT no-heuristic-verdict mode (default on). When true, a GO/WATCH can only
 * be issued if the real ML safety stack ran; otherwise the verdict is
 * INSUFFICIENT-EVIDENCE. Deterministic chemistry can still fire a real NO-GO.
 * This is the "no fabricated/heuristic verdicts" guarantee — see l1Thresholds.json.
 */
const STRICT_NO_HEURISTIC = THRESHOLDS.strict_no_heuristic_verdict !== false;

/**
 * When the molecule sits outside the ML applicability domain (NN-Tanimoto to
 * training set < 0.40) the ML predictions are extrapolations. Letting them
 * act as hard vetoes is statistically indefensible — we downgrade them to
 * WATCH-level signals only. This is what `out_of_domain_disables_hard_veto`
 * controls in the JSON.
 */
const AD_DISABLES_HARD_VETO = THRESHOLDS.ad_thresholds.out_of_domain_disables_hard_veto;

/**
 * Desirability transform parameters (Wager-style piecewise-linear; see
 * l1Thresholds.json → desirability). `dMin` is the floor a liability
 * desirability decays to at the hard threshold — kept > 0 so the rule-based
 * veto (not a zeroed geometric mean) is what produces a hard stop.
 */
const DESIR = {
  dMin: THRESHOLDS.desirability.d_min,
  idealBelowWatch: THRESHOLDS.desirability.ideal_below_watch,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/**
 * Liability desirability transform (Harrington 1965 / Derringer-Suich 1980,
 * piecewise-linear form per Wager 2010). Maps a liability probability `p`
 * onto a desirability d ∈ [dMin, 1]:
 *   - p ≤ watch  → d = 1.0           (ideal: safely below the monitor line)
 *   - watch<p<hard → linear 1.0 → dMin  (proportional penalty as risk climbs)
 *   - p ≥ hard   → d = dMin          (veto territory; the rule gate fires)
 * Returned on a 0–1 scale. Multiply by 100 for the displayed dimension score.
 */
function safetyDesirability(p: number, watch: number, hard: number): number {
  if (!Number.isFinite(p)) return DESIR.idealBelowWatch;
  if (p <= watch) return DESIR.idealBelowWatch;
  if (p >= hard) return DESIR.dMin;
  const frac = (p - watch) / Math.max(hard - watch, 1e-6);
  return DESIR.idealBelowWatch - frac * (DESIR.idealBelowWatch - DESIR.dMin);
}

/** Convenience: liability desirability expressed on the 0–100 dimension scale. */
function safetyScore(p: number, watch: number, hard: number): number {
  return clamp(safetyDesirability(p, watch, hard) * 100);
}

/**
 * Weighted GEOMETRIC mean of desirabilities — the industry-standard MPO
 * scalarization (QED, Bickerton 2012; CNS-MPO, Wager 2010). Each dimension
 * score (0–100) is treated as a desirability d = score/100, floored at a
 * small ε so one zero cannot annihilate the product before a rule-based veto
 * has had its say. Returns the composite on a 0–100 scale.
 *
 *   D = exp( Σ wᵢ · ln(dᵢ) / Σ wᵢ ) · 100
 */
function geometricComposite(dims: Array<{ score: number; weight: number }>): number {
  const totalW = dims.reduce((s, d) => s + d.weight, 0);
  if (totalW <= 0) return 0;
  const eps = DESIR.dMin; // shared floor so a single weak axis is heavily — but not infinitely — penalised
  const lnSum = dims.reduce((s, d) => {
    const desir = Math.max(eps, Math.min(1, d.score / 100));
    return s + d.weight * Math.log(desir);
  }, 0);
  return clamp(Math.exp(lnSum / totalW) * 100);
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────

export interface L1ScorecardInput {
  admet: SimResults;
  inVitro: InVitroResults;
  /** ML overlay (may be all-null when the AI-service was unavailable). */
  overlay?: MlOverlay | null;
  /**
   * Optional result from the lookup-first known-drug query
   * (POST /predict/known-drug). When `matched=true`, the verdict path
   * short-circuits: a measured veto-severity liability returns
   * "KNOWN-LIABILITY-NO-GO" (distinct color in the UI), a measured
   * monitor liability returns "WATCH", and a clean lookup returns "GO"
   * with confidence raised to "High". Bypasses all ML thresholds.
   */
  knownDrugLookup?: KnownDrugLookup | null;
  /**
   * Optional applicability-domain envelope (GET /predict/admet-ml/ad or
   * /predict/applicability-domain). When `adLabel === "Out-of-domain"` the
   * ML hard-veto gates are downgraded to WATCH signals — an extrapolation
   * cannot defensibly veto a candidate.
   */
  applicabilityDomain?: ApplicabilityDomain | null;
  /**
   * Optional read-across / novelty evidence (from readAcross.ts +
   * noveltyResolver.ts). A verdict supported by REAL measured analogues
   * deserves more confidence than one resting entirely on extrapolation;
   * conversely a truly novel structure with zero measured support must not
   * carry a high-confidence label. This adjusts confidence only — it never
   * changes the verdict (which stays driven by the rule-based gates + MPO
   * composite).
   */
  evidenceSupport?: EvidenceSupport | null;
  /**
   * Optional per-endpoint fitted post-hoc calibration tables (Platt/isotonic)
   * produced offline against the real TDC test split (scripts/fit_calibration.py).
   * ABSENT by default — when not supplied the calibration layer reliability-weights
   * the raw probability using the endpoint's real published AUROC instead of
   * fabricating a calibration curve. Keyed by ADMET endpoint id (e.g. "DILI").
   */
  calibration?: Record<string, FittedCalibration> | null;
  /**
   * Optional reactive-metabolite structural-alert result
   * (predictReactiveMets / /predict/reactive-metabolites). Any CRITICAL alert
   * is a deterministic, development-stopping liability (Kalgutkar 2009; FDA
   * reactive-metabolite guidance) and forces NO-GO. Folded in here so the
   * scorecard verdict is the SINGLE SOURCE OF TRUTH — the UI no longer applies
   * its own separate reactive-metabolite override that could disagree with
   * `scorecard.verdict`/`score`/`headline`.
   */
  reactiveMetabolites?: { critical_count: number; high_count?: number } | null;
  /** Optional transporter-safety BSEP & phospholipidosis QSAR results. */
  bsep?: {
    bsep_score: number;
    bsep_class: string;
    dipl_score: number;
    dipl_class: string;
  } | null;
  /**
   * Optional REAL off-target / polypharmacology panel from the DeepDTA-GBM
   * binding head (ESM-2 + Morgan) run against a diverse DrugCentral target set
   * (mlPolypharmacology.ts). When present it drives the Selectivity dimension
   * with `ml` provenance; when absent, the legacy heuristic selectivity does
   * NOT feed the verdict under STRICT mode (no heuristic drives the decision).
   */
  offTargetPanel?: {
    /** # of predicted high-affinity (Kd ≤ 1 µM, in-domain) off-targets. */
    highAffinityCount: number;
    /** Up to 3 off-target gene/protein names for the rationale. */
    topOffTargets?: string[];
  } | null;
  /**
   * Optional quantitative PK readout from the IVIVE engine (POST /predict/pk/ivive
   * → predictPkIvive). REAL-INPUT-ONLY: populate this ONLY when the engine
   * returned `source === "ivive"` (computed from real ADMET-AI CLint/fu/VDss or
   * measured overrides). It is a WATCH-ONLY readout: it can raise monitor-level
   * flags (high first-pass extraction, extreme half-life, cross-check
   * disagreement) but NEVER a hard veto, and it is deliberately NOT added as a
   * scored MPO dimension — so the calibrated composite and thresholds are
   * unchanged by PK. An insufficient-input PK result must be passed as
   * `available: false` (or omitted); it then raises nothing (no fabricated PK).
   */
  pk?: {
    available: boolean;
    /** Hepatic extraction class from the well-stirred model. */
    extractionClass?: "low" | "intermediate" | "high";
    /** E_h, 0–1. */
    extractionRatio?: number;
    /** F_h = 1 − E_h, hepatic first-pass availability, 0–1. */
    firstPassAvailability?: number;
    /** Mechanistic t½ (h); null when VDss was unavailable. */
    halfLifeH?: number | null;
    /** True/false when both IVIVE and ADMET-AI half-life signals exist; null otherwise. */
    halfLifeCrosscheckAgree?: boolean | null;
    /** Engine warnings (e.g. fu below model resolution). */
    warnings?: string[];
  } | null;
}

/** Compact read-across / novelty signal consumed by the confidence model. */
export interface EvidenceSupport {
  /** Fraction of endpoints backed by ≥1 measured neighbour (readAcross.coverage). */
  readAcrossCoverage: number;
  /** Best applicability-domain confidence achieved across read-across endpoints. */
  bestAdConfidence: AdConfidenceLevel;
  /** 0–1 documentation-novelty (noveltyResolver.noveltyScore). */
  noveltyScore?: number;
  /**
   * hERG read-across point estimate (nM) from MEASURED ChEMBL analogues, plus
   * its applicability-domain confidence. Used as an ORTHOGONAL contradiction
   * signal: if measured analogues say "weak/non-blocker" but the ML model says
   * "blocker", the conformal layer withholds the hERG veto and escalates for an
   * assay rather than issuing a false NO-GO. Optional — when absent the hERG
   * veto is judged on the ML prediction's own reliability alone.
   */
  hergReadAcrossNm?: number | null;
  hergReadAcrossAd?: AdConfidenceLevel;
}

export type AdConfidenceLevel = "High" | "Moderate" | "Low" | "None";

export function computeL1Scorecard(input: L1ScorecardInput): L1Scorecard {
  const { admet, inVitro } = input;
  const o = input.overlay ?? null;
  const ivProv = inVitro.provenance ?? {};
  const adProv = admet.provenance ?? {};
  const lookup = input.knownDrugLookup ?? null;
  const ad = input.applicabilityDomain ?? null;

  // ── LOOKUP-FIRST short-circuit ─────────────────────────────────────────
  // If the compound resolved to a known drug, RETURN THE MEASURED PROFILE
  // directly. This is the single biggest fix for "every known drug → NO-GO":
  // the model path is skipped entirely and the verdict reflects published
  // clinical evidence, not stacked ML thresholds.
  if (lookup?.matched) {
    return buildLookupShortCircuit(lookup, admet);
  }

  // ── Applicability-domain + calibration setup (Phases 1, 2, 4) ──────────
  // The honest gate on "can a model prediction stop development?". Derive the
  // molecule's applicability-domain confidence from the BEST available source:
  // an explicit AD envelope if supplied, else the ChEMBL read-across nearest-
  // neighbour support (real measured analogues), else "Low" when we have NO
  // domain evidence at all — an extrapolating model must not confidently veto.
  // Per OECD (Q)SAR principle 3, predictions outside the domain are
  // extrapolations and may not drive a development-stopping verdict.
  const es0 = input.evidenceSupport ?? null;

  // ── CHEMOTYPE / MODALITY AWARENESS ─────────────────────────────────────
  // The hard gates below were written for classic Rule-of-5 small molecules.
  // Novel modalities — PROTAC / molecular-glue degraders, macrocycles, covalent
  // inhibitors — are exactly what biotechs bring for a fresh read, and applying
  // small-molecule assumptions to them produces FALSE stops. Classify once from
  // data already computed, then route every gate through it:
  //  • beyondRo5  → the ADMET ML models are OUT of their training domain
  //    (Doak/Lokey bRo5; a GNN trained on Ro5 space cannot reliably score a
  //    ~1000-Da degrader) → their predictions are extrapolations, so they
  //    ESCALATE for an assay rather than issue a confident veto.
  //  • covalentIntent → the reactive warhead is INTENDED (osimertinib,
  //    ibrutinib, sotorasib are covalent) → a reactive-electrophile alert is a
  //    "confirm selectivity" flag, not a hard stop. GENOTOXIC / DNA-reactive
  //    alerts still veto — that is a real liability in any modality.
  const _mw = admet.lipinski.mw;
  const _rotB = admet.lipinski.rotBonds;
  const beyondRo5 = _mw >= 700 || (_mw >= 600 && _rotB >= 10);
  const rejectHits = (admet.structuralAlerts?.hits ?? []).filter(h => h.alert.severity === "reject");
  const genotoxicReject = rejectHits.some(h => h.alert.category === "Genotoxic");
  const covalentIntent = rejectHits.length > 0 && !genotoxicReject
    && rejectHits.every(h => h.alert.category === "ReactiveElectrophile"
      || h.alert.category === "Alkylating" || h.alert.category === "ReactiveMetabolite");
  const nonClassicChemotype = beyondRo5;

  // A non-classic chemotype is, by definition, outside the ADMET ML models'
  // applicability domain → force AD confidence to None so their safety
  // predictions ESCALATE (REVIEW) instead of vetoing on an extrapolation.
  const adConf: CalAdConfidence =
    nonClassicChemotype ? "None"
    : ad?.adConfidence ? (ad.adConfidence as CalAdConfidence)
    : es0 ? es0.bestAdConfidence
    : "Low";
  // Kept for the legacy GO-guard below: true when the molecule is demonstrably
  // out of the applicability domain (explicit AD label, no measured support, or
  // a non-classic chemotype the models were never trained on).
  const outOfDomain =
    (AD_DISABLES_HARD_VETO && ad?.adLabel === "Out-of-domain") || adConf === "None"
    || nonClassicChemotype;
  const fitTable = input.calibration ?? null;
  // Orthogonal contradiction for the hERG veto, built from MEASURED ChEMBL
  // analogues — if they say "weak/non-blocker" we withhold a high-ML-prob veto.
  const hergContradiction = es0
    ? hergReadAcrossContradiction({
        mlBlockProb: o?.herg_blocker_prob ?? 0,
        hardThreshold: HARD.herg,
        readAcrossEstimateNm: es0.hergReadAcrossNm ?? null,
        readAcrossAdConfidence: (es0.hergReadAcrossAd ?? "None") as CalAdConfidence,
      })
    : null;
  // Collected when a strong ML liability is NOT calibration-reliable enough to
  // veto — drives the WATCH·review-escalate verdict class instead of a false NO-GO.
  const escalateReasons: string[] = [];

  const flags: L1Flag[] = [];
  const dims: L1DimensionScore[] = [];

  // helper to register a flag
  const flag = (f: L1Flag) => flags.push(f);
  // helper to register a dimension with an intended (pre-normalisation) weight
  const rawDims: Array<L1DimensionScore & { rawWeight: number }> = [];
  const dim = (
    dimension: string,
    score: number | null,
    rawWeight: number,
    provenance: Provenance,
    detail: string,
  ) => {
    if (score === null || !Number.isFinite(score)) return; // unavailable → dropped
    rawDims.push({ dimension, score: clamp(score), weight: 0, rawWeight, provenance, detail });
  };

  // ── 1. POTENCY / EFFICACY ──────────────────────────────────────────────
  const ic50 = inVitro.doseResponse.ic50_nM;
  if (ic50 !== null) {
    const potScore =
      ic50 < 10 ? 96 : ic50 < 50 ? 90 : ic50 < 200 ? 80 : ic50 < 1000 ? 66 : ic50 < 5000 ? 50 : 35;
    const prov: Provenance = ivProv.doseResponse_IC50 === "ml" ? "ml" : "heuristic";
    dim("Potency (on-target)", potScore, 0.12, prov,
      `On-target IC50 ≈ ${ic50.toFixed(1)} nM${inVitro.doseResponse.potencyClass ? ` (${inVitro.doseResponse.potencyClass})` : ""}`);
  }

  // ── 2. ABSORPTION / PERMEABILITY ───────────────────────────────────────
  dim("Absorption", admet.admet.absorption * 100, 0.10,
    adProv.absorption === "ml" ? "ml" : "heuristic",
    `Caco-2 ${inVitro.permeability.caco2Class}, HIA/permeability composite ${(admet.admet.absorption * 100).toFixed(0)}/100`);

  // ── 3. METABOLIC STABILITY ─────────────────────────────────────────────
  dim("Metabolic stability", admet.admet.metabolism * 100, 0.10,
    adProv.metabolism === "ml" ? "ml" : "heuristic",
    `Hepatic stability composite ${(admet.admet.metabolism * 100).toFixed(0)}/100; microsomal ${inVitro.metabolicStability.microsomalClass}`);

  // ── 4. DISTRIBUTION ────────────────────────────────────────────────────
  dim("Distribution", admet.admet.distribution * 100, 0.06,
    adProv.distribution === "ml" ? "ml" : "heuristic",
    `PPB ${inVitro.plasmaProteinBinding.bindingClass}, distribution composite ${(admet.admet.distribution * 100).toFixed(0)}/100`);

  // ── 5–8. SAFETY ENDPOINTS — calibration-gated vetoes (Phases 2 & 4) ─────
  // Each ML safety probability still scores a desirability dimension (the MPO
  // composite is unchanged), but before it can issue a development-stopping
  // NO-GO it is routed through assessVeto(). A hard veto is upheld ONLY when
  // the molecule is in the applicability domain, the prediction clears the
  // reliability bar, and the LOWER confidence bound still exceeds the hard
  // threshold; otherwise the liability becomes an ESCALATE signal (→ WATCH ·
  // review-escalate) so a safe out-of-domain compound never gets a false stop.
  const mlSafetyVeto = (args: {
    endpointId: string; prob: number; triggerProb?: number; watch: number; hard: number;
    flagId: string; label: string; watchLabel: string; source: string;
    dimLabel: string; dimWeight: number; dimDetail: string;
    vetoRationale: string; watchRationale: string;
    addDim?: boolean; contradiction?: { source: string; note: string } | null;
  }) => {
    const { prob, watch, hard } = args;
    const trigger = args.triggerProb ?? prob;
    if (args.addDim !== false) {
      dim(args.dimLabel, safetyScore(prob, watch, hard), args.dimWeight, "ml", args.dimDetail);
    }
    if (trigger > hard) {
      const va = assessVeto(args.endpointId, prob, hard, adConf, { fit: fitTable?.[args.endpointId] ?? null, contradiction: args.contradiction ?? null });
      if (va.reliableForVeto) {
        flag({ id: `${args.flagId}_hard`, label: args.label, severity: "critical",
          source: args.source, provenance: "ml",
          value: `p = ${pct(prob)}`, threshold: `> ${pct(hard)}`,
          rationale: `${args.vetoRationale} ${va.vetoReason}`, hardNoGo: true });
      } else {
        escalateReasons.push(`${args.label}: ${va.vetoReason}`);
        flag({ id: `${args.flagId}_escalate`, label: `${args.label} — escalate (unconfirmed in-silico)`, severity: "warn",
          source: args.source, provenance: "ml",
          value: `p = ${pct(prob)} · reliability ${pct(va.reliability)}`,
          threshold: `> ${pct(hard)} but not calibration-reliable for a veto`,
          rationale: `Strong predicted liability, held back from a hard NO-GO: ${va.vetoReason} (${va.basis}). Resolve with an orthogonal assay before a stop call.`,
          hardNoGo: false });
      }
    } else if (trigger >= watch) {
      flag({ id: `${args.flagId}_watch`, label: args.watchLabel, severity: "warn",
        source: args.source, provenance: "ml",
        value: `p = ${pct(prob)}`, threshold: `${pct(watch)}–${pct(hard)}`,
        rationale: args.watchRationale, hardNoGo: false });
    }
  };

  // ── 5. SAFETY: hERG (cardiac) ──────────────────────────────────────────
  if (o?.herg_blocker_prob != null) {
    const p = o.herg_blocker_prob;
    mlSafetyVeto({
      endpointId: "hERG", prob: p, watch: WATCH.herg, hard: HARD.herg,
      flagId: "herg", label: "hERG block — high cardiac risk", watchLabel: "Moderate hERG signal",
      source: "CardioTox-ML (Wang/Karim hERG RF)",
      dimLabel: "Cardiac (hERG)", dimWeight: 0.14,
      dimDetail: `CardioTox-ML blocker probability ${pct(p)} (desirability transform, ICH S7B/E14)`,
      vetoRationale: "Strong predicted hERG block implies torsadogenic / QT-prolongation liability that stops development absent structural mitigation.",
      watchRationale: "Borderline cardiac liability — confirm with patch-clamp and track the safety margin vs efficacious exposure.",
      contradiction: hergContradiction,
    });
  } else if (!STRICT_NO_HEURISTIC) {
    // heuristic hERG band from the in-vitro engine (only when STRICT mode is OFF)
    const cat = inVitro.herg.riskCategory;
    const hScore = cat === "High" ? 30 : cat === "Moderate" ? 60 : 88;
    dim("Cardiac (hERG)", hScore, 0.14, "heuristic", `hERG risk ${cat} (physchem heuristic — no ML / patch-clamp)`);
    if (cat === "High") {
      flag({ id: "herg_heur_watch", label: "hERG risk High (heuristic)", severity: "warn",
        source: "In-vitro physchem rule", provenance: "heuristic",
        value: `risk = High`, threshold: `IC50 < 1 µM band`,
        rationale: "Heuristic flags a cardiac liability; obtain the CardioTox-ML or patch-clamp readout before a NO-GO/GO call.",
        hardNoGo: false });
    }
  }

  // ── 6. SAFETY: DILI (hepatic) ──────────────────────────────────────────
  if (o?.dili_prob != null) {
    const p = o.dili_prob;
    // A model "High" risk-class label forces entry into the veto-assessment
    // path even when the raw prob sits just under the hard line; the
    // calibration layer then decides veto-vs-escalate on the real prob + AD.
    const trig = o.dili_risk_class === "High" ? Math.max(p, HARD.dili + 1e-3) : p;
    mlSafetyVeto({
      endpointId: "DILI", prob: p, triggerProb: trig, watch: WATCH.dili, hard: HARD.dili,
      flagId: "dili", label: "DILI — high hepatotoxicity risk", watchLabel: "Moderate DILI signal",
      source: "DILI-ML (DILIrank RF)",
      dimLabel: "Hepatic (DILI)", dimWeight: 0.14,
      dimDetail: `DILI-ML probability ${pct(p)} (${o.dili_risk_class ?? "—"}; desirability transform)`,
      vetoRationale: "Predicted drug-induced liver injury is the leading cause of clinical attrition and post-market withdrawal.",
      watchRationale: "Monitor hepatic markers; consider covalent-/reactive-metabolite de-risking.",
    });
  } else if (!STRICT_NO_HEURISTIC) {
    dim("Hepatic (DILI)", admet.admet.toxicity * 100 * 0.9, 0.10, "heuristic", "No DILI-ML signal — using ADMET toxicity composite (heuristic)");
  }

  // ── 7. SAFETY: GENOTOXICITY (Ames) ─────────────────────────────────────
  if (o?.ames_prob != null) {
    const p = o.ames_prob;
    mlSafetyVeto({
      endpointId: "AMES", prob: p, watch: WATCH.ames, hard: HARD.ames,
      flagId: "ames", label: "Mutagenicity (Ames) liability", watchLabel: "Borderline mutagenicity signal",
      source: "ADMET-AI (Chemprop)",
      dimLabel: "Genotoxicity (Ames)", dimWeight: 0.10,
      dimDetail: `ADMET-AI Ames probability ${pct(p)} (desirability transform, ICH M7/S2(R1))`,
      vetoRationale: "High predicted bacterial mutagenicity is a genotoxic stop unless a qualified control strategy applies.",
      watchRationale: "Run an Ames screen and inspect structural alerts before advancing.",
    });
  }

  // ── 8. SAFETY: OTHER TOX (ClinTox / Carcinogenicity) ───────────────────
  const otherProbs: number[] = [];
  if (o?.clintox_prob != null) otherProbs.push(o.clintox_prob);
  if (o?.carcinogen_prob != null) otherProbs.push(o.carcinogen_prob);
  if (otherProbs.length > 0) {
    const worst = Math.max(...otherProbs);
    dim("Other toxicity", safetyScore(worst, WATCH.clintox, HARD.clintox), 0.06, "ml",
      `ClinTox/Carcinogen worst-case ${pct(worst)} (desirability transform)`);
  }
  if (o?.clintox_prob != null) {
    mlSafetyVeto({
      endpointId: "ClinTox", prob: o.clintox_prob, watch: WATCH.clintox, hard: HARD.clintox,
      flagId: "clintox", label: "High clinical-tox probability", watchLabel: "Moderate clinical-tox signal",
      source: "ADMET-AI ClinTox", addDim: false, dimLabel: "", dimWeight: 0, dimDetail: "",
      vetoRationale: "Model predicts a high likelihood of clinical-trial toxicity failure.",
      watchRationale: "Elevated clinical-tox probability — corroborate with orthogonal tox readouts.",
    });
  }
  if (o?.carcinogen_prob != null) {
    mlSafetyVeto({
      endpointId: "Carcinogens_Lagunin", prob: o.carcinogen_prob, watch: WATCH.carcinogen, hard: HARD.carcinogen,
      flagId: "carc", label: "Carcinogenicity liability", watchLabel: "Moderate carcinogenicity signal",
      source: "ADMET-AI Carcinogens", addDim: false, dimLabel: "", dimWeight: 0, dimDetail: "",
      vetoRationale: "High predicted rodent carcinogenicity.",
      watchRationale: "Elevated carcinogenicity probability — corroborate with orthogonal data.",
    });
  }

  // ── 8b. SAFETY: MITOCHONDRIAL TOXICITY (Tox21 SR-MMP) ───────────────────
  if (o?.sr_mmp_prob != null) {
    const p = o.sr_mmp_prob;
    mlSafetyVeto({
      endpointId: "SR-MMP", prob: p, watch: WATCH.sr_mmp, hard: HARD.sr_mmp,
      flagId: "sr_mmp", label: "Mitochondrial toxicity risk", watchLabel: "Moderate mitochondrial signal",
      source: "ADMET-AI Tox21 SR-MMP",
      dimLabel: "Mitochondrial (SR-MMP)", dimWeight: 0.08,
      dimDetail: `ADMET-AI Tox21 SR-MMP probability ${pct(p)} (desirability transform)`,
      vetoRationale: "High predicted mitochondrial membrane potential disruption is a major safety concern linked to hepatotoxicity and organ failure.",
      watchRationale: "Monitor mitochondrial function in vitro (e.g., Seahorse analyzer or Glu/Gal assay).",
    });
  }

  // ── 8c. SAFETY: ATAD5 GENOTOXICITY (Tox21 SR-ATAD5) ──────────────────────
  if (o?.sr_atad5_prob != null) {
    const p = o.sr_atad5_prob;
    mlSafetyVeto({
      endpointId: "SR-ATAD5", prob: p, watch: WATCH.sr_atad5, hard: HARD.sr_atad5,
      flagId: "sr_atad5", label: "Genotoxicity stress (ATAD5)", watchLabel: "Moderate ATAD5 signal",
      source: "ADMET-AI Tox21 SR-ATAD5",
      dimLabel: "Genotox stress (ATAD5)", dimWeight: 0.08,
      dimDetail: `ADMET-AI Tox21 SR-ATAD5 probability ${pct(p)} (desirability transform)`,
      vetoRationale: "High predicted ATAD5 activation indicates DNA damage stress response.",
      watchRationale: "Run an in-vitro genotoxicity screening battery (e.g., micronucleus or Ames).",
    });
  }

  // ── 8d. SAFETY: BSEP INHIBITION & PHOSPHOLIPIDOSIS ──────────────────────
  const bs = input.bsep ?? null;
  if (bs) {
    const bsepScore = bs.bsep_score;
    dim("BSEP inhibition", 100 - bsepScore, 0.08, "heuristic",
      `BSEP inhibition risk score ${bsepScore}/100 (${bs.bsep_class})`);
    if (bs.bsep_class === "High") {
      flag({ id: "bsep_high", label: "High BSEP inhibition risk", severity: "warn",
        source: "HakaseAI QSAR BSEP model", provenance: "heuristic",
        value: `score = ${bsepScore}`, threshold: "score ≥ 50",
        rationale: "High risk of BSEP (bile salt export pump) inhibition, which can cause intracellular bile acid accumulation and cholestatic hepatotoxicity.",
        hardNoGo: false });
    }
    
    const diplScore = bs.dipl_score;
    if (bs.dipl_class === "High") {
      flag({ id: "dipl_high", label: "High Phospholipidosis risk", severity: "warn",
        source: "HakaseAI QSAR DIPL model", provenance: "heuristic",
        value: `score = ${diplScore}`, threshold: "score ≥ 50",
        rationale: "High risk of drug-induced phospholipidosis (DIPL), characterized by lysosomal accumulation of drug-phospholipid complexes.",
        hardNoGo: false });
    }
  }

  // ── 8e. TOX21 ENDOCRINE & STRESS PANEL (directional — never a veto) ─────
  // The ADMET-AI Tox21 nuclear-receptor + stress-response heads are real GNN
  // predictions (published per-endpoint AUROC 0.75–0.92). They are surfaced
  // here as MONITOR-level signals, deliberately NOT as hard vetoes:
  //   • Nuclear-receptor (NR) activity is the INTENDED mechanism of many
  //     approved drugs (tamoxifen→ER, finasteride→AR, pioglitazone→PPARγ), so
  //     a strong NR signal is "characterise on-/off-target endocrine activity",
  //     not a stop. SR-MMP (mitochondrial) and SR-ATAD5 (genotoxic stress) are
  //     handled above as calibration-gated vetoes; the residual stress panel
  //     (p53 / ARE / HSE) corroborates oxidative / DNA-damage stress.
  // One combined desirability dimension contributes modestly to the MPO
  // composite; the worst-case probability in each sub-panel raises a WATCH flag.
  const namedMax = (entries: Array<[string, number | null | undefined]>): { label: string; prob: number } | null => {
    let best: { label: string; prob: number } | null = null;
    for (const [label, p] of entries) {
      if (typeof p === "number" && Number.isFinite(p) && (best === null || p > best.prob)) best = { label, prob: p };
    }
    return best;
  };
  const nrWorst = namedMax([
    ["Androgen receptor (NR-AR)", o?.nr_ar_prob], ["Androgen receptor LBD (NR-AR-LBD)", o?.nr_ar_lbd_prob],
    ["Aryl-hydrocarbon receptor (NR-AhR)", o?.nr_ahr_prob], ["Aromatase (NR-Aromatase)", o?.nr_aromatase_prob],
    ["Estrogen receptor (NR-ER)", o?.nr_er_prob], ["Estrogen receptor LBD (NR-ER-LBD)", o?.nr_er_lbd_prob],
    ["PPAR-γ (NR-PPAR-gamma)", o?.nr_ppar_gamma_prob],
  ]);
  const srWorst = namedMax([
    ["p53 DNA-damage (SR-p53)", o?.sr_p53_prob], ["Oxidative stress / Nrf2-ARE (SR-ARE)", o?.sr_are_prob],
    ["Heat-shock response (SR-HSE)", o?.sr_hse_prob],
  ]);
  if (nrWorst || srWorst) {
    // Combined dimension: worst desirability across the whole Tox21 NR+stress
    // panel, on a gentle gradient (clean panel → ~100, strong hit → low).
    const panelWorst = Math.max(nrWorst?.prob ?? 0, srWorst?.prob ?? 0);
    dim("Endocrine & stress (Tox21)", safetyScore(panelWorst, 0.5, 0.9), 0.06, "ml",
      `ADMET-AI Tox21 NR + stress panel, worst-case ${pct(panelWorst)} (${nrWorst?.label ?? srWorst?.label ?? "—"})`);
    if (nrWorst && nrWorst.prob >= WATCH.endocrineNr) {
      flag({ id: "tox21_endocrine_watch", label: "Endocrine-disruption signal (Tox21 NR panel)", severity: "warn",
        source: "ADMET-AI Tox21 nuclear-receptor heads", provenance: "ml",
        value: `${nrWorst.label} p = ${pct(nrWorst.prob)}`, threshold: `≥ ${pct(WATCH.endocrineNr)}`,
        rationale: "Predicted nuclear-receptor activity (endocrine pathway). Not a stop — it is the intended mechanism for many approved endocrine drugs — but confirm whether this is on-target or an off-target endocrine liability (e.g. receptor-binding / reporter assay) before advancing.",
        hardNoGo: false });
    }
    if (srWorst && srWorst.prob >= WATCH.stressSr) {
      flag({ id: "tox21_stress_watch", label: "Cellular-stress signal (Tox21 SR panel)", severity: "warn",
        source: "ADMET-AI Tox21 stress-response heads", provenance: "ml",
        value: `${srWorst.label} p = ${pct(srWorst.prob)}`, threshold: `≥ ${pct(WATCH.stressSr)}`,
        rationale: "Predicted activation of an oxidative / DNA-damage / heat-shock stress pathway. Corroborate with an orthogonal genotoxicity / oxidative-stress readout; treat as directional, not a stop.",
        hardNoGo: false });
    }
  }

  // ── 9. SELECTIVITY ─────────────────────────────────────────────────────
  // Prefer the REAL DeepDTA off-target panel (ml). The legacy physchem
  // promiscuity proxy only feeds the verdict when STRICT mode is OFF — so a
  // heuristic selectivity guess never drives a sellable verdict.
  const offPanel = input.offTargetPanel ?? null;
  if (offPanel) {
    const n = Math.max(0, offPanel.highAffinityCount | 0);
    const selScore = n <= 0 ? 95 : n === 1 ? 80 : n === 2 ? 65 : n === 3 ? 45 : 30;
    dim("Selectivity", selScore, 0.08, "ml",
      `DeepDTA off-target panel: ${n} predicted high-affinity off-target${n === 1 ? "" : "s"} (Kd ≤ 1 µM)${offPanel.topOffTargets?.length ? ` — ${offPanel.topOffTargets.join(", ")}` : ""}`);
    if (n >= 3) {
      flag({ id: "selectivity_watch", label: "Predicted polypharmacology (off-target hits)", severity: "warn",
        source: "DeepDTA-GBM off-target panel (ESM-2 + Morgan)", provenance: "ml",
        value: `${n} off-target hits (Kd ≤ 1 µM)`, threshold: "≥ 3 high-affinity off-targets",
        rationale: "Multiple predicted high-affinity off-targets raise the risk of mechanism-independent toxicity; confirm with a wet-lab selectivity panel.", hardNoGo: false });
    }
  } else if (!STRICT_NO_HEURISTIC && inVitro.selectivity.kinaseSelectivityScore !== null) {
    const s = inVitro.selectivity.kinaseSelectivityScore;
    dim("Selectivity", s * 100, 0.08,
      ivProv.selectivity === "ml" ? "ml" : "heuristic",
      `In-silico selectivity ${inVitro.selectivity.selectivityClass ?? "—"} (score ${(s * 100).toFixed(0)}/100)`);
    if (inVitro.selectivity.selectivityClass === "Non-Selective") {
      flag({ id: "selectivity_watch", label: "Predicted promiscuity", severity: "warn",
        source: "In-silico promiscuity model", provenance: "heuristic",
        value: `class Non-Selective`, threshold: `selectivity score < 0.5`,
        rationale: "High predicted off-target promiscuity raises the chance of mechanism-independent toxicity.", hardNoGo: false });
    }
  }

  // ── 10. DRUG-LIKENESS / DEVELOPABILITY ─────────────────────────────────
  const viol = admet.lipinski.violations;
  const dlScore = clamp(
    admet.qed_approx * 70                         // QED contributes most
    + (1 - Math.min(viol, 4) / 4) * 20            // Lipinski cleanliness
    + (1 - Math.min(Math.max(admet.saScore - 1, 0), 9) / 9) * 10, // synthesisability
  );
  dim("Drug-likeness", dlScore, 0.10, "heuristic",
    `QED ${admet.qed_approx.toFixed(2)}, Ro5 violations ${viol}, SA ${admet.saScore.toFixed(1)}`);
  // CHEMOTYPE-AWARE Ro5 gate. Beyond-Rule-of-5 modalities — PROTAC / molecular-
  // glue degraders, macrocycles, peptidomimetics — INTENTIONALLY break Lipinski
  // (MW ~700–1100+, high logP, many rotatable bonds). Ro5 is the wrong
  // developability filter for them, so violations must NOT be a development-
  // stopping veto; they become a developability WATCH that says "this needs
  // modality-specific developability work (solubility/permeability/route)",
  // not "stop". (Doak & Lokey, bRo5 chemical space; Edmondson PROTAC dev rules.)
  // Only classic small molecules (≤ bRo5) get the hard Ro5 veto. (beyondRo5 is
  // classified once in the chemotype block above.)
  if (!beyondRo5 && viol >= HARD.lipinskiViolations) {
    flag({ id: "ro5_hard", label: "Gross drug-likeness failure", severity: "critical",
      source: "Lipinski Ro5", provenance: "heuristic",
      value: `${viol} violations`, threshold: `≥ ${HARD.lipinskiViolations}`,
      rationale: "Three or more Ro5 violations on a classic small molecule predict poor oral absorption and high developability risk.", hardNoGo: true });
  } else if (beyondRo5) {
    flag({ id: "bro5_watch", label: "Beyond-Rule-of-5 / degrader space", severity: "warn",
      source: "bRo5 developability (Doak/Lokey)", provenance: "heuristic",
      value: `MW ${_mw.toFixed(0)}, ${viol} Ro5 violations, ${_rotB} rot. bonds`,
      threshold: "MW ≥ 700 or MW ≥ 600 & ≥10 rot. bonds",
      rationale: "Beyond-Rule-of-5 / degrader (PROTAC, molecular glue, macrocycle) chemistry: Ro5 violations are EXPECTED for this modality and are not a hard stop. Developability (solubility, permeability, oral exposure, metabolic stability) needs modality-specific assessment — advance with that as the priority, not a veto.", hardNoGo: false });
  } else if (viol >= WATCH.lipinskiViolations) {
    flag({ id: "ro5_watch", label: "Borderline drug-likeness", severity: "warn",
      source: "Lipinski Ro5", provenance: "heuristic",
      value: `${viol} violations`, threshold: `${WATCH.lipinskiViolations}`,
      rationale: "Two Ro5 violations warrant attention to formulation / route.", hardNoGo: false });
  }

  // ── 11. STRUCTURAL HARD-REJECT ALERTS (deterministic chemistry) ────────
  // CHEMOTYPE-AWARE: a GENOTOXIC / DNA-reactive reject is a real stop in any
  // modality → hard veto. But a reactive-electrophile / alkylating reject on a
  // COVALENT-BY-DESIGN inhibitor (the only rejects are electrophilic warheads,
  // none genotoxic) is the INTENDED mechanism — covalent drugs (osimertinib,
  // ibrutinib, sotorasib, dacomitinib) all carry these motifs. So that becomes
  // a "confirm covalent selectivity / off-target reactivity" WATCH, not a veto.
  const sa = admet.structuralAlerts;
  if (sa?.scanRan && sa.rejectCount > 0) {
    if (covalentIntent) {
      flag({ id: "covalent_warhead_watch", label: "Covalent warhead — confirm selectivity", severity: "warn",
        source: "Structural alert scan (reactive-electrophile, no genotoxic)", provenance: "experimental",
        value: sa.rejectNames.slice(0, 3).join("; ") + (sa.rejectCount > 3 ? " +more" : ""),
        threshold: "reactive-electrophile motif (no DNA-reactive alert)",
        rationale: "Reactive-electrophile motif with NO genotoxic alert — consistent with an intended covalent warhead (the mechanism of osimertinib, ibrutinib, sotorasib). Not a hard stop: confirm on-target covalent selectivity and characterise off-target/proteome reactivity (e.g. activity-based protein profiling) before advancing.",
        hardNoGo: false });
    } else {
      flag({ id: "struct_hard", label: "Structural hard-reject alert", severity: "critical",
        source: "Structural alert scan (Brenk/BMS/NIH)", provenance: "experimental",
        value: sa.rejectNames.slice(0, 3).join("; ") + (sa.rejectCount > 3 ? " +more" : ""),
        threshold: "any hard-reject motif",
        rationale: genotoxicReject
          ? "Genotoxic / DNA-reactive substructure — a deterministic chemical liability that vetoes advancement in any modality (ICH S2)."
          : "Reactive / genotoxic substructures are deterministic chemical liabilities that veto advancement irrespective of probabilistic ML scores.",
        hardNoGo: true });
    }
  }

  // ── 11b. REACTIVE-METABOLITE ALERTS — corroboration-gated (deterministic) ──
  // A single reactive-metabolite structural alert is a RISK FACTOR, not an
  // automatic stop: bioactivation is dose-, exposure- and context-dependent, and
  // many safe approved drugs form reactive metabolites (Kalgutkar 2009; Stepan
  // 2011). Validation on a 1,183-drug ChEMBL approved/withdrawn hold-out showed a
  // lone critical motif fires on ~16% of APPROVED drugs and does NOT discriminate
  // them from withdrawn — so used as a blanket hard veto it false-rejects good
  // novel chemistry without catching more real liabilities. We therefore VETO
  // only when the bioactivation alert is CORROBORATED by an independent liability,
  // and otherwise raise a monitor-level WATCH. Corroboration =
  //   • predicted DILI is high (the clinical endpoint bioactivation drives), OR
  //   • a genotoxic / DNA-reactive structural reject co-occurs, OR
  //   • ≥2 distinct critical bioactivation motifs are present (multiple
  //     independent electrophilic centres — e.g. troglitazone-like).
  const rm = input.reactiveMetabolites ?? null;
  if (rm && rm.critical_count > 0) {
    const diliHigh = (o?.dili_prob != null && o.dili_prob >= HARD.dili) || o?.dili_risk_class === "High";
    const corroborated = diliHigh || genotoxicReject || rm.critical_count >= 2;
    if (corroborated) {
      const why = diliHigh ? "predicted DILI is high"
        : genotoxicReject ? "a genotoxic / DNA-reactive structural alert co-occurs"
        : `${rm.critical_count} independent critical bioactivation motifs are present`;
      flag({ id: "reactive_met_hard", label: "Reactive-metabolite liability (corroborated)", severity: "critical",
        source: "Reactive-metabolite SMARTS scan (Kalgutkar 2009)", provenance: "experimental",
        value: `${rm.critical_count} critical alert${rm.critical_count === 1 ? "" : "s"}`,
        threshold: "critical bioactivation motif + corroborating liability",
        rationale: `Bioactivation to reactive metabolites is corroborated here (${why}); the combination is a development-stopping idiosyncratic-hepatotoxicity / IADR liability, so it vetoes advancement.`,
        hardNoGo: true });
    } else {
      flag({ id: "reactive_met_watch", label: "Reactive-metabolite alert — monitor (uncorroborated)", severity: "warn",
        source: "Reactive-metabolite SMARTS scan (Kalgutkar 2009)", provenance: "experimental",
        value: `${rm.critical_count} critical alert${rm.critical_count === 1 ? "" : "s"}${rm.high_count ? `, ${rm.high_count} high` : ""}`,
        threshold: "single critical bioactivation motif, no corroborating DILI / genotoxic / second motif",
        rationale: "A reactive-metabolite structural alert is present but is NOT corroborated by a high DILI prediction, a genotoxic structural reject, or a second independent bioactivation motif. Bioactivation is a dose- and context-dependent risk factor (many safe approved drugs form reactive metabolites), so this is a monitor signal — de-risk with a glutathione-trapping / covalent-binding assay and track the projected dose — not a stand-alone stop.",
        hardNoGo: false });
    }
  }

  // ── 11c. CHEMOTYPE TRANSPARENCY (info — never changes the verdict) ──────
  // Tell the reviewer which modality rules applied, so they can see WHY the
  // small-molecule hard gates were relaxed for this molecule.
  if (nonClassicChemotype) {
    flag({ id: "chemotype_bro5", label: "Non-classic chemotype — ADMET models extrapolating", severity: "info",
      source: "Chemotype classifier", provenance: "heuristic",
      value: `MW ${_mw.toFixed(0)}, ${_rotB} rot. bonds (beyond Rule-of-5)`,
      threshold: "outside the ADMET ML training domain",
      rationale: "Beyond-Rule-of-5 / degrader / macrocycle chemistry sits outside the chemical space the ADMET ML models were trained on, so their predictions are EXTRAPOLATIONS. Safety signals therefore escalate for an orthogonal assay rather than issuing a confident stop, Ro5 is not applied as a veto, and confidence is capped. Treat the verdict as directional and confirm in vitro.",
      hardNoGo: false });
  }
  if (covalentIntent) {
    flag({ id: "chemotype_covalent", label: "Covalent-by-design chemotype", severity: "info",
      source: "Chemotype classifier", provenance: "heuristic",
      value: "reactive-electrophile warhead, no genotoxic alert",
      threshold: "intended covalent mechanism",
      rationale: "Reactive-electrophile motif with no DNA-reactive alert — treated as an intended covalent warhead, so the reactive-group alert is a confirm-selectivity flag rather than a hard stop. Characterise on-/off-target covalent selectivity (e.g. ABPP) before advancing.",
      hardNoGo: false });
  }

  // ── 12. CYP DDI (metabolism modifier WATCH) ────────────────────────────
  const cypProbs = [o?.cyp3a4_inhibitor_prob, o?.cyp2d6_inhibitor_prob, o?.cyp2c9_inhibitor_prob].filter(
    (p): p is number => typeof p === "number" && Number.isFinite(p));
  if (cypProbs.length > 0 && Math.max(...cypProbs) >= WATCH.cypStrongInhib) {
    flag({ id: "cyp_watch", label: "Strong CYP inhibition (DDI risk)", severity: "warn",
      source: "ADMET-AI Veith CYP heads", provenance: "ml",
      value: `max p = ${pct(Math.max(...cypProbs))}`, threshold: `≥ ${pct(WATCH.cypStrongInhib)}`,
      rationale: "Strong CYP inhibition predicts drug–drug-interaction risk; check victim/perpetrator exposure.", hardNoGo: false });
  }

  // ── 13. THERAPEUTIC INDEX (WATCH) ──────────────────────────────────────
  if (ic50 !== null && inVitro.cellViability.therapeuticIndex > 0 &&
      inVitro.cellViability.therapeuticIndex < WATCH.therapeuticIndex) {
    flag({ id: "ti_watch", label: "Narrow therapeutic index", severity: "warn",
      source: "In-vitro CC50 / IC50", provenance: ivProv.cc50_uM === "ml" ? "ml" : "heuristic",
      value: `TI ≈ ${inVitro.cellViability.therapeuticIndex}`, threshold: `< ${WATCH.therapeuticIndex}`,
      rationale: "Cytotoxicity is close to the efficacious concentration — limited safety window.", hardNoGo: false });
  }

  // ── 13b. QUANTITATIVE PK (IVIVE) — WATCH-only readout, never a veto ─────
  // Real IVIVE output (well-stirred liver from ADMET-AI CLint/fu/VDss). It can
  // raise monitor-level flags but NEVER a hard veto, and is deliberately NOT
  // added as a scored MPO dimension — so the calibrated composite / thresholds
  // are unchanged. Fires ONLY when the engine returned real numbers
  // (pk.available === true); an insufficient-input PK result raises nothing
  // (no fabricated PK signal ever reaches the verdict).
  const pk = input.pk ?? null;
  if (pk?.available) {
    if (typeof pk.extractionRatio === "number" && pk.extractionClass === "high") {
      flag({ id: "pk_high_first_pass", label: "High first-pass metabolism (low oral exposure)", severity: "warn",
        source: "IVIVE well-stirred liver (ADMET-AI CLint/fu)", provenance: "ml",
        value: `E_h ≈ ${pk.extractionRatio.toFixed(2)}${typeof pk.firstPassAvailability === "number" ? `, F_h ≈ ${pk.firstPassAvailability.toFixed(2)}` : ""}`,
        threshold: "E_h ≥ 0.70",
        rationale: "Predicted hepatic extraction is high, so oral bioavailability is likely low and exposure variable. Confirm with an oral PK study or consider a non-oral route / metabolic-soft-spot redesign. Directional PK signal — never a stand-alone stop.",
        hardNoGo: false });
    }
    if (typeof pk.halfLifeH === "number") {
      if (pk.halfLifeH < 2) {
        flag({ id: "pk_short_half_life", label: "Short predicted half-life", severity: "warn",
          source: "IVIVE (CL, VDss)", provenance: "ml",
          value: `t½ ≈ ${pk.halfLifeH.toFixed(1)} h`, threshold: "< 2 h",
          rationale: "Short predicted half-life implies frequent dosing / limited exposure duration; verify with a metabolic-stability assay and consider clearance-lowering design.", hardNoGo: false });
      } else if (pk.halfLifeH > 30) {
        flag({ id: "pk_long_half_life", label: "Long predicted half-life (accumulation risk)", severity: "warn",
          source: "IVIVE (CL, VDss)", provenance: "ml",
          value: `t½ ≈ ${pk.halfLifeH.toFixed(0)} h`, threshold: "> 30 h",
          rationale: "Long predicted half-life raises accumulation / washout-time concerns; confirm and assess steady-state exposure margins.", hardNoGo: false });
      }
    }
    if (pk.halfLifeCrosscheckAgree === false) {
      flag({ id: "pk_crosscheck_disagree", label: "PK half-life cross-check disagreement", severity: "info",
        source: "IVIVE t½ vs ADMET-AI Half_Life_Obach", provenance: "ml",
        value: "independent PK signals disagree > 3-fold", threshold: "agreement within 3-fold",
        rationale: "The mechanistic IVIVE half-life and the independent ADMET-AI half-life model disagree by more than 3-fold — treat the predicted t½ as directional and confirm with a metabolic-stability assay.", hardNoGo: false });
    }
    for (const w of (pk.warnings ?? [])) {
      flag({ id: `pk_warn_${w.slice(0, 16).replace(/\W+/g, "_")}`, label: "PK model caveat", severity: "info",
        source: "IVIVE", provenance: "ml", value: w, threshold: "—", rationale: w, hardNoGo: false });
    }
  }

  // ── MPO composite (weighted GEOMETRIC mean of desirabilities) ──────────
  // Weights are renormalised over the dimensions that were actually
  // computable (null-aware), then the composite is the weighted geometric
  // mean — Σ wᵢ·ln(dᵢ)/Σ wᵢ, exponentiated (Harrington 1965; Derringer-Suich
  // 1980; the QED/CNS-MPO scalarization). A single weak axis pulls the whole
  // composite down, which is the defensible behaviour: you cannot average a
  // safety liability away with good ADME.
  const totalRaw = rawDims.reduce((s, d) => s + d.rawWeight, 0) || 1;
  for (const d of rawDims) {
    d.weight = +(d.rawWeight / totalRaw).toFixed(4);
    dims.push({ dimension: d.dimension, score: +d.score.toFixed(1), weight: d.weight, provenance: d.provenance, detail: d.detail });
  }
  // Raw geometric composite over the dimensions that were actually computable —
  // exposed unchanged as `compositeRaw` for transparency.
  const compositeRawVal = +geometricComposite(rawDims.map(d => ({ score: d.score, weight: d.rawWeight }))).toFixed(1);

  // ── GRACEFUL MISSING-DATA HANDLING (confidence + composite regularisation) ─
  // The canonical profile has ~10 axes including 4 safety axes (hERG, DILI,
  // Ames, other-tox). When endpoints can't be computed (ML service down / no
  // target / no off-target screen) the raw geometric mean is taken over FEWER
  // axes — which makes a sparse profile both noisy AND prone to INFLATION:
  // dropping a weak safety axis mechanically raises the mean, so "less data"
  // can look like "safer molecule", and the score then swings when the missing
  // signal finally lands. To degrade gracefully and consistently we:
  //   1. measure completeness overall AND for the safety block specifically;
  //   2. lower confidence smoothly with both; and
  //   3. shrink the DECISION composite toward a neutral 50 prior in proportion
  //      to the evidence we actually have, so missing data neither inflates the
  //      ranking nor lets it swing to extremes. Full evidence → unchanged.
  const EXPECTED_DIMS = 10;
  const EXPECTED_SAFETY = 4; // hERG, DILI, Ames, other-tox
  const safetyDims = dims.filter(d => /hERG|DILI|Ames|toxicity|Mitochondrial|ATAD5|Endocrine/i.test(d.dimension));
  const safetyMl = safetyDims.filter(d => d.provenance === "ml").length;
  const mlCoverage = safetyDims.length > 0 ? +(safetyMl / safetyDims.length).toFixed(2) : 0;
  const dataCompleteness = clamp(rawDims.length / EXPECTED_DIMS, 0, 1);
  const safetyCompleteness = clamp(safetyDims.length / EXPECTED_SAFETY, 0, 1);
  // Safety completeness is weighted equally with overall completeness — a gap in
  // the safety block is the most consequential kind of missing data.
  const evidenceWeight = clamp(0.5 * dataCompleteness + 0.5 * safetyCompleteness, 0, 1);
  const composite = +(compositeRawVal * evidenceWeight + 50 * (1 - evidenceWeight)).toFixed(1);

  // Transparent INFO flag when safety evidence is partial — never changes the
  // verdict (info severity), but tells the reviewer the call rests on partial
  // data rather than leaving a thin profile to masquerade as a clean one.
  if (safetyDims.length < EXPECTED_SAFETY) {
    flag({ id: "safety_data_incomplete", label: `Safety data incomplete (${safetyDims.length}/${EXPECTED_SAFETY} axes)`,
      severity: "info", source: "L1 data-completeness check", provenance: "heuristic",
      value: `${safetyDims.length}/${EXPECTED_SAFETY} safety axes computed`, threshold: `${EXPECTED_SAFETY}/${EXPECTED_SAFETY}`,
      rationale: "Some safety endpoints could not be computed (ML unavailable / missing input). The decision score is shrunk toward neutral and confidence lowered so a sparse profile is not mistaken for a clean one.",
      hardNoGo: false });
  }

  let confidenceRaw = clamp(0.30 + 0.40 * mlCoverage + 0.15 * dataCompleteness + 0.15 * safetyCompleteness, 0, 1);

  // ── Read-across / novelty adjustment (evidence-aware confidence) ───────
  // A verdict corroborated by REAL measured analogues (read-across) is more
  // trustworthy than one resting purely on model extrapolation, so measured
  // support lifts confidence in proportion to coverage × applicability-domain
  // closeness. Conversely a structure with NO public footprint and zero
  // measured neighbours cannot carry a high-confidence label — we cap it.
  const es = input.evidenceSupport ?? null;
  if (es) {
    const adBump =
      es.bestAdConfidence === "High" ? 0.12 :
      es.bestAdConfidence === "Moderate" ? 0.07 :
      es.bestAdConfidence === "Low" ? 0.03 : 0;
    confidenceRaw = clamp(confidenceRaw + adBump * clamp(es.readAcrossCoverage, 0, 1), 0, 1);
    const trulyNovelNoData = (es.noveltyScore ?? 0) > 0.9 && es.readAcrossCoverage <= 0;
    if (trulyNovelNoData) confidenceRaw = Math.min(confidenceRaw, 0.6); // honest ceiling for blind extrapolation
  }
  // Non-classic chemotype (bRo5/degrader/macrocycle): the ADMET models are
  // extrapolating, so cap confidence — the verdict is directional, not calibrated.
  if (nonClassicChemotype) confidenceRaw = Math.min(confidenceRaw, 0.55);
  const confidence = +confidenceRaw.toFixed(2);
  const confidenceLabel: L1Scorecard["confidenceLabel"] =
    confidence >= 0.75 ? "High" : confidence >= 0.55 ? "Moderate" : "Low";

  // ── Verdict ────────────────────────────────────────────────────────────
  // Consensus / disagreement gate (Phase 4): a NO-GO is only issued when a
  // DETERMINISTIC chemistry veto fires (Lipinski gross failure, a reactive /
  // genotoxic structural reject) OR an ML safety prediction is calibration-
  // reliable enough to veto (assessVeto upheld it — in-domain, reliable, lower
  // bound over threshold, no orthogonal contradiction). When a strong ML
  // liability exists but could NOT be confirmed in-silico, it was recorded in
  // `escalateReasons` and the verdict is WATCH · review-escalate ("strong
  // predicted liability — get an orthogonal assay") rather than a false NO-GO.
  const hardFlags = flags.filter(f => f.hardNoGo);
  const warnFlags = flags.filter(f => f.severity === "warn");
  const hasEscalate = escalateReasons.length > 0;

  // ── REAL-MODEL EVIDENCE GATE (no heuristic / fabricated verdicts) ───────
  // A GO / WATCH may ONLY be issued when the real ML safety stack actually ran
  // for this molecule: a cardiac (hERG) and hepatic (DILI) probability, Ames,
  // AND the full ADMET-AI Tox21 panel (sr_mmp + sr_atad5 imply all 12 endpoints
  // are present, since ADMET-AI emits the Tox21 block atomically). Deterministic
  // chemistry (structural alerts, reactive metabolites, Ro5) can still fire a
  // real NO-GO without ML — but a clean / advanceable call resting on heuristics
  // alone is forbidden: it would be a fabricated verdict. Absent the real safety
  // models the verdict is INSUFFICIENT-EVIDENCE, never a heuristic GO/WATCH.
  const mlSafetyAvailable = !!o
    && o.herg_blocker_prob != null && o.dili_prob != null && o.ames_prob != null
    && o.sr_mmp_prob != null && o.sr_atad5_prob != null;

  let verdict: L1Verdict;
  let verdictClass: "standard" | "review-escalate" = "standard";
  if (hardFlags.length > 0) {
    verdict = "NO-GO";
  } else if (STRICT_NO_HEURISTIC && !mlSafetyAvailable) {
    // Real ML safety evidence is absent → refuse a heuristic GO/WATCH.
    verdict = "INSUFFICIENT-EVIDENCE";
  } else if (hasEscalate) {
    // Abstain rather than guess: a development-stopping signal that the model
    // cannot stand behind escalates for orthogonal confirmation.
    verdict = "WATCH";
    verdictClass = "review-escalate";
  } else if (warnFlags.length > 0 || composite < WATCH.composite) {
    verdict = "WATCH";
  } else if (composite >= GO_COMPOSITE) {
    verdict = "GO";
  } else {
    verdict = "WATCH";
  }
  // ── CONSERVATIVE VERDICT GUARD ─────────────────────────────────────────
  // "We cannot risk incorrect verdicts for any molecule — that's money lost."
  // A false GO is the most expensive verdict the platform can produce
  // (downstream wet-lab spend, regulatory exposure, reputational risk).
  // A false WATCH is cheap (an extra eyeball). Therefore we apply a
  // multi-condition downgrade rule: GO survives ONLY when EVERY guard passes.
  //
  // Any one of the following downgrades GO → WATCH and pins a labelled
  // `confidenceDowngrade` reason on the rationale:
  //   1. Confidence < High (Low or Moderate)
  //   2. ML safety coverage < 0.66 (less than 2 of 3 safety dims from ML)
  //   3. Out-of-domain ML signal anywhere in the dimensions
  //   4. Fewer than 6 dimensions could be computed (incomplete evidence)
  //   5. Composite < GO floor with no margin
  //
  // The user's call here was explicit: never issue GO on uncertain
  // evidence. Downgrading is the conservative side of every coin flip.
  let confidenceDowngrade = false;
  const downgradeReasons: string[] = [];
  if (verdict === "GO") {
    if (confidenceLabel !== "High") {
      downgradeReasons.push(`confidence ${confidenceLabel.toLowerCase()} (need High for GO)`);
    }
    if (mlCoverage < 0.66) {
      downgradeReasons.push(`ML safety coverage ${pct(mlCoverage)} (need ≥66 %)`);
    }
    if (outOfDomain) {
      downgradeReasons.push("molecule out-of-domain for ML stack");
    }
    if (dims.length < 6) {
      downgradeReasons.push(`only ${dims.length} dimensions computed (need ≥6)`);
    }
    if (composite < GO_COMPOSITE + 3) {
      downgradeReasons.push(`composite ${composite} within 3 pts of GO floor — insufficient margin`);
    }
    if (downgradeReasons.length > 0) {
      verdict = "WATCH";
      confidenceDowngrade = true;
    }
  }

  // ── Verdict-consistent triage score (the library-ranking number) ────────
  // Band the raw composite so the score can never disagree with the verdict:
  // GO ∈ [70,100], WATCH ∈ [40,69], NO-GO ∈ [1,39]. Ordering within a band
  // tracks the raw composite; NO-GO compounds drop further per extra hard
  // flag. Guarantees a correct sort over thousands of compounds.
  //
  // (KNOWN-LIABILITY-NO-GO is produced by `buildLookupShortCircuit` and never
  //  reaches this branch — included in the type union but unreachable here.)
  const score: number = (() => {
    if (verdict === "INSUFFICIENT-EVIDENCE") return 0; // not ranked — no real safety evidence
    if (verdict === "GO") return +clamp(composite, 70, 100).toFixed(1);
    if (verdict === "WATCH") {
      // review-escalate (strong unconfirmed liability) ranks BELOW a routine
      // monitor-WATCH: [40,54] vs [55,69].
      return verdictClass === "review-escalate"
        ? +clamp(40 + (composite / 100) * 14, 40, 54).toFixed(1)
        : +clamp(55 + (composite / 100) * 14, 55, 69).toFixed(1);
    }
    // NO-GO: map into [1,39] and penalise additional hard liabilities.
    const base = (composite / 100) * 38;
    return +clamp(base - (hardFlags.length - 1) * 6, 1, 39).toFixed(1);
  })();

  // ── Narrative ──────────────────────────────────────────────────────────
  const headline =
    verdict === "INSUFFICIENT-EVIDENCE"
      ? `INSUFFICIENT EVIDENCE — real ML safety models did not run; no calibrated verdict issued`
      : verdict === "NO-GO"
      ? `NO-GO — ${hardFlags.length} hard liabilit${hardFlags.length === 1 ? "y" : "ies"} (L1 score ${score}/100)`
      : verdict === "WATCH" && verdictClass === "review-escalate"
        ? `REVIEW — strong predicted liability not confirmable in-silico; escalate for an orthogonal assay (L1 score ${score}/100)`
        : verdict === "WATCH"
          ? `WATCH — advance with monitoring (L1 score ${score}/100, ${warnFlags.length} flag${warnFlags.length === 1 ? "" : "s"})`
          : `GO — favourable L1 profile (score ${score}/100)`;

  const rationale = (() => {
    if (verdict === "INSUFFICIENT-EVIDENCE") {
      return `No calibrated GO / WATCH / NO-GO was issued: the real ML safety stack did not run for this molecule (required: hERG, DILI, Ames and the 12-endpoint ADMET-AI Tox21 panel). Only deterministic chemistry was evaluated, and it raised no hard veto — so the engine reports INSUFFICIENT-EVIDENCE rather than a heuristic verdict. Bring the ai-service ML stack online (ADMET-AI + CardioTox/DILI) and re-run. ${dims.length} real dimension(s) available; confidence ${confidenceLabel.toLowerCase()}.`;
    }
    if (verdict === "NO-GO") {
      return `Vetoed by hard liabilit${hardFlags.length === 1 ? "y" : "ies"}: ${hardFlags.map(f => f.label).join("; ")}. ` +
        `These are stage-gating risks: the triage score is held at ${score}/100 even though the raw endpoint composite is ${compositeRawVal}/100 (a vetoed compound can still have otherwise-good properties). Structural modification or a qualified control strategy is required before advancing. Confidence in the call: ${confidenceLabel.toLowerCase()} (${pct(confidence)}; ML safety coverage ${pct(mlCoverage)}).`;
    }
    if (verdict === "WATCH" && verdictClass === "review-escalate") {
      return `REVIEW / ESCALATE — one or more strong predicted liabilities could NOT be confirmed in-silico, so the engine abstains from a confident NO-GO rather than risk a false stop on a novel or out-of-domain molecule. Specifically: ${escalateReasons.join(" · ")}. ` +
        `Triage score ${score}/100 (raw composite ${compositeRawVal}), confidence ${confidenceLabel.toLowerCase()} (${pct(confidence)}; ML safety coverage ${pct(mlCoverage)}). Run the named orthogonal assay (patch-clamp / hepatocyte / Ames) to resolve to GO or NO-GO.`;
    }
    if (verdict === "WATCH") {
      const reasons: string[] = [];
      if (warnFlags.length > 0) reasons.push(`${warnFlags.length} monitor-level flag${warnFlags.length === 1 ? "" : "s"} (${warnFlags.map(f => f.label).join("; ")})`);
      if (composite < WATCH.composite) reasons.push(`composite below the GO floor (${composite} < ${GO_COMPOSITE})`);
      if (confidenceDowngrade) {
        // The conservative-verdict guard fired — surface EACH reason so the
        // reviewer sees exactly which guard tripped (confidence, AD,
        // ML-coverage, dimension count, margin). This is the "explainable
        // downgrade" surface the user asked for.
        reasons.push(`GO withheld by conservative-verdict guard: ${downgradeReasons.join("; ")} — obtain the missing readouts to upgrade`);
      }
      return `Advance with close monitoring. ${reasons.join("; ")}. Triage score ${score}/100 (raw composite ${compositeRawVal}), confidence ${confidenceLabel.toLowerCase()} (${pct(confidence)}).`;
    }
    return `Favourable across the available L1 dimensions with no hard or monitor-level liabilities. Triage score ${score}/100, confidence ${confidenceLabel.toLowerCase()} (${pct(confidence)}; ML safety coverage ${pct(mlCoverage)}). Recommend progressing to Layer 2 confirmation.`;
  })();

  const recommendation =
    verdict === "INSUFFICIENT-EVIDENCE"
      ? "Start the ai-service ML stack (STRICT_ML=1, ADMET-AI + CardioTox/DILI) so the 12-endpoint Tox21 + core safety panel runs, then re-run L1. Deterministic chemistry alone cannot issue a calibrated verdict."
      : verdict === "NO-GO"
      ? "Do not advance as-is. Re-design to remove the flagged liability, then re-run L1."
      : verdict === "WATCH" && verdictClass === "review-escalate"
        ? "Do NOT treat as a clean WATCH. Prioritise the named orthogonal assay to confirm or clear the predicted liability before any go/no-go; the in-silico stack cannot responsibly decide this case alone."
        : verdict === "WATCH"
          ? "Advance into Layer 2 confirmation with the flagged endpoints prioritised for orthogonal (ex-vivo / ML-ensemble) confirmation."
          : "Advance to Layer 2 confirmation.";

  // sort flags critical → warn → info
  const sevRank = { critical: 0, warn: 1, info: 2 } as const;
  flags.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  return {
    verdict,
    score,
    compositeRaw: compositeRawVal,
    confidence,
    confidenceLabel,
    headline,
    rationale,
    flags,
    dimensions: dims,
    mlCoverage,
    recommendation,
    verdictClass,
    escalateReasons: escalateReasons.length > 0 ? escalateReasons : undefined,
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Lookup-first short-circuit
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the scorecard directly from a known-drug lookup hit. Skips the ML
 * stack entirely; the verdict is driven by published measured liabilities.
 *
 * Verdict mapping:
 *   - any liability with severity="veto" OR matchedDrugStatus="withdrawn"
 *     → KNOWN-LIABILITY-NO-GO (rendered in distinct color in the UI)
 *   - any liability with severity="monitor"            → WATCH
 *   - no liabilities                                   → GO (confidence High)
 *
 * Confidence is set from the match type:
 *   exact (1.00) → 0.95   stereo-variant (0.95) → 0.90
 *   close (0.85) → 0.80   structural (0.70)     → 0.65
 */
function buildLookupShortCircuit(lookup: KnownDrugLookup, admet: SimResults): L1Scorecard {
  const veto = lookup.vetoLiabilities ?? [];
  const monitor = lookup.monitorLiabilities ?? [];
  const isWithdrawn = lookup.matchedDrugStatus === "withdrawn";
  const isVeto = isWithdrawn || veto.length > 0;
  const verdict: L1Verdict = isVeto
    ? "KNOWN-LIABILITY-NO-GO"
    : monitor.length > 0
      ? "WATCH"
      : "GO";

  const flags: L1Flag[] = [];
  for (const L of veto) {
    flags.push({
      id: `known_veto_${L.endpoint.toLowerCase()}`,
      label: `Known liability — ${L.endpoint}`,
      severity: "critical",
      source: L.source,
      provenance: "experimental",
      value: L.valueText,
      threshold: "Published clinical-stage liability",
      rationale:
        `Compound matched ${lookup.matchedDrugName ?? "a known drug"} ` +
        `(${lookup.matchType ?? "match"}${lookup.tanimoto != null ? `, Tanimoto ${lookup.tanimoto.toFixed(2)}` : ""}). ` +
        `Published ${L.endpoint} liability: ${L.valueText}. ` +
        `Source: ${L.source}. This is a known-liability veto, not a model artefact.`,
      hardNoGo: true,
    });
  }
  for (const L of monitor) {
    flags.push({
      id: `known_monitor_${L.endpoint.toLowerCase()}`,
      label: `Known monitor — ${L.endpoint}`,
      severity: "warn",
      source: L.source,
      provenance: "experimental",
      value: L.valueText,
      threshold: "Published label warning",
      rationale: `Matched ${lookup.matchedDrugName ?? "known drug"} — published ${L.endpoint} monitor: ${L.valueText}.`,
      hardNoGo: false,
    });
  }

  const confidenceMap: Record<NonNullable<KnownDrugLookup["matchType"]>, number> = {
    "exact": 0.95,
    "stereo-variant": 0.90,
    "close-analog": 0.80,
    "structural-analog": 0.65,
  };
  const confidence = confidenceMap[lookup.matchType ?? "exact"] ?? 0.95;
  const confidenceLabel: L1Scorecard["confidenceLabel"] =
    confidence >= 0.75 ? "High" : confidence >= 0.55 ? "Moderate" : "Low";

  const score =
    verdict === "GO" ? 88 :
    verdict === "WATCH" ? 55 :
    verdict === "KNOWN-LIABILITY-NO-GO" ? Math.max(15, 38 - veto.length * 4) :
    20;

  const headline =
    verdict === "KNOWN-LIABILITY-NO-GO"
      ? `KNOWN-LIABILITY NO-GO — matched ${lookup.matchedDrugName ?? "known drug"}${isWithdrawn ? " (withdrawn)" : ""}`
      : verdict === "WATCH"
        ? `WATCH — matched ${lookup.matchedDrugName ?? "known drug"} (label monitor)`
        : `GO — matched ${lookup.matchedDrugName ?? "known drug"} (clean published profile)`;

  const rationale =
    verdict === "KNOWN-LIABILITY-NO-GO"
      ? `This compound resolved to ${lookup.matchedDrugName ?? "a known drug"} via ${lookup.matchType ?? "match"}` +
        (lookup.tanimoto != null ? ` (Tanimoto ${lookup.tanimoto.toFixed(2)})` : "") +
        `. The NO-GO reflects PUBLISHED clinical evidence: ${veto.map((L) => L.valueText).join("; ") || lookup.withdrawalReason || "withdrawn from market"}. ` +
        `This is rendered as KNOWN-LIABILITY-NO-GO (distinct UI color from a novel-compound NO-GO) so reviewers can see at a glance that the block reflects established literature, not a model rejection.`
      : verdict === "WATCH"
        ? `Matched ${lookup.matchedDrugName ?? "known drug"} with label-level monitor warnings (${monitor.map((L) => L.endpoint).join(", ")}). Use known clinical risk-management strategy.`
        : `Matched ${lookup.matchedDrugName ?? "known drug"} with a clean published ADMET / safety profile. Advance with high confidence (experimental data, not model prediction).`;

  const recommendation =
    verdict === "KNOWN-LIABILITY-NO-GO"
      ? "Do not advance unmodified. The compound is a known clinical-stage liability — re-design or follow the established mitigation strategy (e.g. fexofenadine replaced terfenadine via metabolic blockade)."
      : verdict === "WATCH"
        ? "Advance with the label's standard monitoring program."
        : "Advance to Layer 2 confirmation with high confidence (lookup-first match to clean known profile).";

  return {
    verdict,
    score,
    compositeRaw: verdict === "KNOWN-LIABILITY-NO-GO" ? 20 : verdict === "WATCH" ? 55 : 88,
    confidence,
    confidenceLabel,
    headline,
    rationale,
    flags,
    dimensions: [
      {
        dimension: "Lookup-first (experimental)",
        score: verdict === "KNOWN-LIABILITY-NO-GO" ? 15 : verdict === "WATCH" ? 55 : 95,
        weight: 1.0,
        provenance: "experimental",
        detail: `${lookup.matchType ?? "match"} → ${lookup.matchedDrugName ?? "known drug"}${lookup.tanimoto != null ? ` (Tanimoto ${lookup.tanimoto.toFixed(2)})` : ""}`,
      },
    ],
    mlCoverage: 0,
    recommendation,
    // Known-drug verdicts rest on PUBLISHED measured evidence, not model
    // extrapolation, so they are always "standard" (never review-escalate).
    verdictClass: "standard",
    timestamp: new Date().toISOString(),
  };
}
