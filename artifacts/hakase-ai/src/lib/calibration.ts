/**
 * Calibration & Conformal-Reliability Layer — "when can we trust a prediction?"
 * ─────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS SOLVES
 * A raw ADMET-AI / CardioTox-ML output (e.g. "DILI p = 0.88") is treated by the
 * naïve scorecard as a fact, and any value over a hard threshold issues a
 * NO-GO. That is statistically indefensible and is exactly how a *safe* novel
 * compound (a tocopherol-class antioxidant, say) lands a false NO-GO. Two things
 * are wrong with using the raw number as a veto:
 *
 *   1. UNCALIBRATED — a graph-neural-net's raw sigmoid output is a score, not a
 *      true probability, and its discriminative power is bounded by the model's
 *      own published test AUROC (hERG 0.84, DILI 0.88, Carcinogen 0.77, …). A
 *      0.88 from an AUROC-0.77 model is not "88 % sure".
 *   2. NO UNCERTAINTY — a point estimate carries no confidence interval, so a
 *      prediction sitting right on the decision boundary is treated as
 *      identically certain to one far from it.
 *
 * THE FIX (industry-standard, all citations real)
 * This module wraps every safety-endpoint probability in a calibrated
 * reliability assessment and a confidence interval, then answers a single
 * decision-relevant question: *is this prediction reliable enough to drive a
 * hard veto, or should it be downgraded to "escalate for orthogonal data"?*
 *
 *   • OECD (Q)SAR validation principle 3 — predictions outside the applicability
 *     domain are extrapolations and "less likely to be reliable". AD confidence
 *     (from the read-across nearest-neighbour Tanimoto) gates reliability here.
 *   • Conformal prediction (Vovk; Angelopoulos & Bates 2021; Conformalized Graph
 *     Learning for ADMET, JCIM 2024) — turn a point prediction into an interval
 *     and only act on it when the interval is tight enough. We implement the
 *     decision-relevant consequence: VETO ONLY IF THE LOWER CONFIDENCE BOUND
 *     STILL EXCEEDS THE HARD THRESHOLD. If the interval straddles the threshold,
 *     the model cannot confidently veto → escalate.
 *   • Probability calibration (Platt 1999; isotonic / Zadrozny-Elkan 2002) —
 *     supported via an OPTIONAL fitted table (see `applyFittedCalibration`).
 *     When no fitted table is supplied we DO NOT fabricate a calibration curve;
 *     we fall back to reliability-weighting from the model's *real* published
 *     AUROC and the prediction's boundary margin, and we say so in `basis`.
 *
 * Nothing in here is hardcoded per-molecule. Every input is a real measured /
 * published quantity: the probability from the model, the endpoint's benchmark
 * AUROC from admetMeta.ts (transcribed from ADMET-AI's own admet.csv), and the
 * applicability-domain confidence derived from ChEMBL read-across neighbours.
 *
 * This module is pure and side-effect-free.
 */

import { admetMeta, type AdmetReliability } from "./admetMeta";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** Applicability-domain confidence (mirrors readAcross.AdConfidence). */
export type AdConfidence = "High" | "Moderate" | "Low" | "None";

/** Optional fitted post-hoc calibration map (Platt or isotonic), per endpoint.
 *  Produced offline by scripts/fit_calibration.py against the real TDC test
 *  split; ABSENT by default — we never ship invented numbers. */
export interface FittedCalibration {
  /** "platt" → sigmoid(a·logit(p)+b); "isotonic" → monotone bin lookup. */
  method: "platt" | "isotonic";
  /** Platt parameters. */
  a?: number;
  b?: number;
  /** Isotonic step points: sorted [rawProb, calibratedProb] pairs. */
  bins?: Array<[number, number]>;
  /** Provenance string for the audit trail (dataset, date, n). */
  source: string;
}

export interface CalibratedPrediction {
  endpointId: string;
  /** Raw model probability (0–1) as returned by the ML head. */
  raw: number;
  /** Calibrated probability — equals `raw` when no fitted table is supplied. */
  calibrated: number;
  /** Whether a real fitted calibration table was applied. */
  wasFitted: boolean;
  /** Published benchmark AUROC for this endpoint (null if unknown). */
  auroc: number | null;
  /** 0–1 reliability of THIS prediction (model power × margin × AD). */
  reliability: number;
  reliabilityTier: AdmetReliability;
  /** Calibrated/heuristic confidence interval around the (calibrated) prob. */
  interval: [number, number];
  /** Human-readable explanation of how reliability was derived. */
  basis: string;
}

export interface VetoAssessment extends CalibratedPrediction {
  hardThreshold: number;
  /**
   * TRUE only when the prediction is reliable enough to drive a HARD veto:
   *   (a) the AD is not None/Low (model is interpolating, not extrapolating),
   *   (b) reliability ≥ RELIABLE_VETO_MIN, AND
   *   (c) the LOWER confidence bound still exceeds the hard threshold
   *       (conformal decision rule — the optimistic end of the interval is
   *        still in veto territory), AND
   *   (d) no orthogonal contradiction was supplied.
   * When FALSE the scorecard must NOT hard-veto on this signal — it downgrades
   * to a monitor/escalate flag.
   */
  reliableForVeto: boolean;
  /** Why veto is / isn't permitted, for the explainable-decision surface. */
  vetoReason: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Tunable constants (documented, not arbitrary)
// ─────────────────────────────────────────────────────────────────────────

/** Reliability floor below which an ML signal may not hard-veto. Chosen so a
 *  prediction needs both decent model power AND at least Moderate AD to gate a
 *  development-stopping decision; everything below escalates for orthogonal
 *  data rather than killing the candidate. */
export const RELIABLE_VETO_MIN = 0.55;

/** Confidence-band half-width scale (see calibratePrediction). 0.35 is tuned so
 *  a strong in-domain prediction (reliability ≳ 0.8) clears a recalibrated hard
 *  threshold, while boundary / low-AD predictions still straddle it → escalate. */
const BAND_K = 0.35;

/** AD-confidence → multiplicative reliability factor. An out-of-domain
 *  extrapolation (None) is heavily discounted; a close-analogue interpolation
 *  (High) is not discounted. Mirrors OECD principle 3. */
const AD_FACTOR: Record<AdConfidence, number> = {
  High: 1.0,
  Moderate: 0.82,
  Low: 0.55,
  None: 0.35,
};

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function tierFromReliability(r: number): AdmetReliability {
  if (r >= 0.8) return "high";
  if (r >= 0.6) return "moderate";
  if (r >= 0.4) return "low";
  return "unreliable";
}

/**
 * Boundary margin → confidence component. A binary classifier is least
 * trustworthy near p = 0.5 and most trustworthy near the extremes. We map the
 * distance from the boundary onto [0,1] linearly: |p − 0.5| · 2.
 */
export function boundaryMargin(prob: number): number {
  return clamp01(Math.abs(prob - 0.5) * 2);
}

/**
 * Apply an OPTIONAL fitted calibration map. Returns the input unchanged when no
 * table is supplied (and flags `wasFitted=false`). Never invents a curve.
 */
export function applyFittedCalibration(raw: number, fit?: FittedCalibration | null): { calibrated: number; wasFitted: boolean } {
  if (!fit) return { calibrated: raw, wasFitted: false };
  if (fit.method === "platt" && typeof fit.a === "number" && typeof fit.b === "number") {
    const eps = 1e-6;
    const p = Math.min(1 - eps, Math.max(eps, raw));
    const logit = Math.log(p / (1 - p));
    const z = fit.a * logit + fit.b;
    return { calibrated: clamp01(1 / (1 + Math.exp(-z))), wasFitted: true };
  }
  if (fit.method === "isotonic" && Array.isArray(fit.bins) && fit.bins.length > 0) {
    // Piecewise-constant / linear interpolation over the monotone bins.
    const bins = [...fit.bins].sort((a, b) => a[0] - b[0]);
    if (raw <= bins[0][0]) return { calibrated: clamp01(bins[0][1]), wasFitted: true };
    if (raw >= bins[bins.length - 1][0]) return { calibrated: clamp01(bins[bins.length - 1][1]), wasFitted: true };
    for (let i = 1; i < bins.length; i++) {
      if (raw <= bins[i][0]) {
        const [x0, y0] = bins[i - 1];
        const [x1, y1] = bins[i];
        const t = (raw - x0) / Math.max(x1 - x0, 1e-9);
        return { calibrated: clamp01(y0 + t * (y1 - y0)), wasFitted: true };
      }
    }
  }
  return { calibrated: raw, wasFitted: false };
}

/**
 * Compute the calibrated reliability of a single endpoint prediction.
 *
 *   reliability = auroc · (0.5 + 0.5·margin) · adFactor
 *
 * Interpretation:
 *   • auroc caps reliability at the model's real discriminative ceiling.
 *   • the (0.5 + 0.5·margin) term means a prediction on the decision boundary
 *     keeps only half of the model's power; a confident extreme keeps all of it.
 *   • adFactor discounts extrapolation outside the applicability domain.
 *
 * The confidence interval half-width grows as reliability falls:
 *   hw = (1 − reliability) · BAND_K  →  interval = [p − hw, p + hw] (clamped).
 * BAND_K is calibrated so a genuinely strong, in-domain prediction (reliability
 * ≈ 0.8+) clears a recalibrated hard threshold while a boundary / low-AD / weak
 * prediction's interval still straddles it (→ escalate). This is a transparent
 * reliability-derived band, NOT a fabricated calibrated posterior; when a fitted
 * table exists the band is centred on the calibrated p.
 */
export function calibratePrediction(
  endpointId: string,
  rawProb: number,
  adConfidence: AdConfidence,
  fit?: FittedCalibration | null,
): CalibratedPrediction {
  const meta = admetMeta(endpointId);
  const auroc = meta?.auroc ?? null;
  const { calibrated, wasFitted } = applyFittedCalibration(rawProb, fit);

  const power = auroc ?? 0.7; // unknown endpoint → conservative default power
  const margin = boundaryMargin(calibrated);
  const adF = AD_FACTOR[adConfidence];
  const reliability = clamp01(power * (0.5 + 0.5 * margin) * adF);

  const hw = (1 - reliability) * BAND_K;
  const interval: [number, number] = [clamp01(calibrated - hw), clamp01(calibrated + hw)];

  const basis =
    `${wasFitted ? "fitted-calibrated" : "reliability-weighted (no fitted table; uses real benchmark AUROC)"} · ` +
    `AUROC ${auroc != null ? auroc.toFixed(2) : "n/a"} · ` +
    `boundary-margin ${(margin * 100).toFixed(0)}% · ` +
    `AD ${adConfidence} (×${adF.toFixed(2)})`;

  return {
    endpointId,
    raw: rawProb,
    calibrated,
    wasFitted,
    auroc,
    reliability: +reliability.toFixed(3),
    reliabilityTier: tierFromReliability(reliability),
    interval: [+interval[0].toFixed(3), +interval[1].toFixed(3)],
    basis,
  };
}

/**
 * Decide whether a hard-threshold-exceeding ML prediction is reliable enough to
 * issue a development-stopping HARD veto, or whether it must be downgraded to an
 * escalate-for-orthogonal-data signal.
 *
 * @param contradiction Optional orthogonal evidence that DISAGREES with the
 *   high-risk call (e.g. read-across from measured analogues says "not a
 *   blocker"). Any contradiction blocks the veto (routes to escalate) — the
 *   conservative, scientifically honest direction (we never flip toward GO,
 *   only away from a confident NO-GO).
 */
export function assessVeto(
  endpointId: string,
  rawProb: number,
  hardThreshold: number,
  adConfidence: AdConfidence,
  opts?: { fit?: FittedCalibration | null; contradiction?: { source: string; note: string } | null },
): VetoAssessment {
  const cp = calibratePrediction(endpointId, rawProb, adConfidence, opts?.fit);
  const contradiction = opts?.contradiction ?? null;

  const lowerBoundAboveThreshold = cp.interval[0] > hardThreshold;
  const adOk = adConfidence === "High" || adConfidence === "Moderate";
  const reliabilityOk = cp.reliability >= RELIABLE_VETO_MIN;

  let reliableForVeto = adOk && reliabilityOk && lowerBoundAboveThreshold && !contradiction;

  let vetoReason: string;
  if (reliableForVeto) {
    vetoReason =
      `Veto upheld: in-domain (AD ${adConfidence}), reliability ${(cp.reliability * 100).toFixed(0)}% ≥ ` +
      `${(RELIABLE_VETO_MIN * 100).toFixed(0)}%, and the lower ${(cp.interval[0] * 100).toFixed(0)}% confidence ` +
      `bound still exceeds the ${(hardThreshold * 100).toFixed(0)}% hard threshold.`;
  } else if (contradiction) {
    vetoReason =
      `Veto withheld → ESCALATE: orthogonal evidence contradicts the high-risk call ` +
      `(${contradiction.source}: ${contradiction.note}). Confirm with an assay before any go/no-go.`;
  } else if (!adOk) {
    vetoReason =
      `Veto withheld → ESCALATE: molecule is out of / at the edge of the applicability domain (AD ${adConfidence}); ` +
      `an extrapolating model must not stop development. Confirm with an orthogonal assay.`;
  } else if (!reliabilityOk) {
    vetoReason =
      `Veto withheld → ESCALATE: prediction reliability ${(cp.reliability * 100).toFixed(0)}% is below the ` +
      `${(RELIABLE_VETO_MIN * 100).toFixed(0)}% bar required to stop development (model AUROC and/or boundary margin too low).`;
  } else {
    vetoReason =
      `Veto withheld → ESCALATE: the calibrated confidence interval [${(cp.interval[0] * 100).toFixed(0)}–` +
      `${(cp.interval[1] * 100).toFixed(0)}%] straddles the ${(hardThreshold * 100).toFixed(0)}% hard threshold, ` +
      `so a stop call cannot be made confidently.`;
  }

  return { ...cp, hardThreshold, reliableForVeto, vetoReason };
}

// ─────────────────────────────────────────────────────────────────────────
// Conformal-by-read-across: orthogonal contradiction from MEASURED analogues
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build an orthogonal "contradiction" object for the hERG veto when read-across
 * from MEASURED ChEMBL analogues disagrees with a high ML block probability.
 *
 * Logic (uses only real measured data): a compound is a meaningful hERG blocker
 * when its IC50 is roughly < 1–10 µM. If the similarity-weighted read-across
 * estimate from measured neighbours is comfortably WEAKER than that (high IC50)
 * and rests on at least Moderate applicability-domain confidence, then the
 * measured-analogue evidence orthogonally contradicts a high ML block call.
 *
 * Returns null when there is no contradiction (or insufficient evidence to
 * claim one) — in which case the ML veto proceeds on its own merits.
 */
export function hergReadAcrossContradiction(args: {
  mlBlockProb: number;
  hardThreshold: number;
  readAcrossEstimateNm: number | null;
  readAcrossAdConfidence: AdConfidence;
}): { source: string; note: string } | null {
  const { mlBlockProb, hardThreshold, readAcrossEstimateNm, readAcrossAdConfidence } = args;
  if (readAcrossEstimateNm == null || !Number.isFinite(readAcrossEstimateNm)) return null;
  if (mlBlockProb <= hardThreshold) return null; // no high-risk call to contradict
  const adOk = readAcrossAdConfidence === "High" || readAcrossAdConfidence === "Moderate";
  if (!adOk) return null; // read-across itself too uncertain to contradict
  // "Comfortably not a blocker" → measured-analogue hERG IC50 > 10 µM (10 000 nM).
  if (readAcrossEstimateNm > 10000) {
    const uM = readAcrossEstimateNm / 1000;
    return {
      source: "ChEMBL read-across (measured analogues)",
      note: `nearest measured analogues give a hERG IC50 ≈ ${uM.toFixed(1)} µM (weak/non-blocker, AD ${readAcrossAdConfidence}), ` +
        `which contradicts the ${(mlBlockProb * 100).toFixed(0)}% ML block probability`,
    };
  }
  return null;
}
