/**
 * Source-quality scoring for L1 outputs.
 *
 * Tiers (per critic spec):
 *   experimental (1.0) — direct measured assay data (ChEMBL activity, BindingDB)
 *   enriched     (0.7) — database-derived but inferred (ChEMBL similarity, Open Targets tractability)
 *   ml           (0.7) — validated ML model (held-out CV AUC reported, training set cited)
 *   cofolded     (~0.65) — AlphaFold3-class co-folding (Boltz-2) predicted complex.
 *                       Deep-learning predicted coordinates — not a measurement and
 *                       not physics on experimental coordinates. The score scales
 *                       with the interface confidence (ipTM) of the specific
 *                       complex via `makeCofoldedQuality()`.
 *   structural   (0.6) — deterministic structural query (SMARTS alerts, pharmacophore
 *                       catalogue). Not a prediction — a literal substructure match.
 *                       Defensible signal but does not estimate magnitude/affinity.
 *   heuristic    (0.3) — rules / patterns / interpolation (TPSA brackets, logP rules)
 *   inferred     (0.1) — model prediction without validation (pharmacophore-jitter pIC50)
 *
 * One score per data point — never one score per compound. Used by `cascadeGate`
 * to decide whether L1→L2 auto-advance is permitted.
 */

export type QualityTier =
  | "experimental"
  | "physical"
  | "cofolded"
  | "enriched"
  | "ml"
  | "structural"
  | "heuristic"
  | "inferred";

export const TIER_SCORE: Record<QualityTier, number> = {
  experimental: 1.0,
  physical:     0.85, // physics-based on actual coordinates (e.g. AutoDock Vina docking)
  cofolded:     0.65, // AF3-class co-folding (Boltz-2) — DL-predicted complex.
                      // Base score; use makeCofoldedQuality() to scale by ipTM.
  enriched:     0.7,
  ml:           0.7,
  structural:   0.6,  // deterministic SMARTS / pharmacophore match — not a prediction
  heuristic:    0.3,
  inferred:     0.1,
};

/** Confidence sub-label used inside ChEMBL v2 measurement payloads. */
export type MeasurementConfidence = "high" | "medium" | "low";

/** Per-target measurement aggregation surfaced from `/api/chembl/similar-targets/v2`. */
export interface ChEMBLMeasurementPayload {
  nMeasurements:    number;
  distinctCompounds:number;
  range_nM:         [number, number];
  geometricMean_nM: number;
  species:          string[];
  speciesCount:     Record<string, number>;
  assayTypes:       Record<string, number>;
  assayFormats:     Record<string, number>;
  confidence:       MeasurementConfidence;
}

export interface SourceQuality {
  tier:        QualityTier;
  score:       number;
  source:      string;
  provenance?: string;
  /** Optional measurement metadata when `tier === "experimental"`. */
  payload?:    ChEMBLMeasurementPayload;
  /** Optional human-readable note (e.g. "Heuristic — pharmacophore match"). */
  note?:       string;
}

export function makeQuality(
  tier: QualityTier,
  source: string,
  extras: Partial<SourceQuality> = {},
): SourceQuality {
  return { tier, score: TIER_SCORE[tier], source, ...extras };
}

export function tierLabel(tier: QualityTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/**
 * Co-folding (Boltz-2) evidence quality, scaled by interface confidence.
 *
 * A co-folded complex is a deep-learning structure prediction — not a measurement,
 * and not physics on experimental coordinates. Its trustworthiness depends almost
 * entirely on the interface confidence (ipTM): a high-ipTM complex is a credible
 * pose worth an ml-grade score; a marginal one is no better than a heuristic.
 *
 * The score is interpolated from ipTM:
 *   ipTM >= 0.85  ->  0.70  (approaches the `ml` tier)
 *   ipTM  = 0.55  ->  0.50  (falls to the `heuristic` band)
 *   ipTM <  0.55  ->  floored at 0.45
 * When ipTM is unknown/non-finite, the static `cofolded` base score (0.65) is used.
 *
 * Honesty note: this never invents confidence. A null ipTM yields the base score,
 * and callers should still surface the missing-confidence state to the user.
 */
export function makeCofoldedQuality(
  source: string,
  iptm: number | null | undefined,
  extras: Partial<SourceQuality> = {},
): SourceQuality {
  let score = TIER_SCORE.cofolded;
  if (typeof iptm === "number" && Number.isFinite(iptm)) {
    const interpolated = 0.5 + ((iptm - 0.55) / (0.85 - 0.55)) * (0.7 - 0.5);
    score = Math.min(0.7, Math.max(0.45, Number(interpolated.toFixed(3))));
  }
  return { tier: "cofolded", score, source, ...extras };
}

/** Tailwind classes for tier chip rendering (dark theme). */
export function tierChipClasses(tier: QualityTier): string {
  switch (tier) {
    case "experimental": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "physical":     return "bg-teal-500/15    text-teal-300    border-teal-500/30";
    case "cofolded":     return "bg-indigo-500/15  text-indigo-300  border-indigo-500/30";
    case "enriched":     return "bg-blue-500/15    text-blue-300    border-blue-500/30";
    case "ml":           return "bg-violet-500/15  text-violet-300  border-violet-500/30";
    case "structural":   return "bg-cyan-500/15    text-cyan-300    border-cyan-500/30";
    case "heuristic":    return "bg-amber-500/15   text-amber-300   border-amber-500/30";
    case "inferred":     return "bg-rose-500/15    text-rose-300    border-rose-500/30";
  }
}

/**
 * Should the UI suppress the point estimate and surface "insufficient data"
 * instead? True when the measurement payload is too thin to defend a single
 * number — i.e. low confidence OR fewer than 3 measurements.
 */
export function shouldSuppressEstimate(q: SourceQuality | undefined): boolean {
  if (!q) return false;
  const p = q.payload;
  if (!p) return false;
  return p.confidence === "low" || p.nMeasurements < 3;
}
