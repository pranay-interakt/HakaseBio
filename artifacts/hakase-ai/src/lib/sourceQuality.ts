/**
 * Source-quality scoring for L1 outputs.
 *
 * Tiers (per critic spec):
 *   experimental (1.0) — direct measured assay data (ChEMBL activity, BindingDB)
 *   enriched     (0.7) — database-derived but inferred (ChEMBL similarity, Open Targets tractability)
 *   ml           (0.7) — validated ML model (held-out CV AUC reported, training set cited)
 *   heuristic    (0.3) — rules / patterns / interpolation (TPSA brackets, pharmacophore matching)
 *   inferred     (0.1) — model prediction without validation (pharmacophore-jitter pIC50)
 *
 * One score per data point — never one score per compound. Used by `cascadeGate`
 * to decide whether L1→L2 auto-advance is permitted.
 */

export type QualityTier = "experimental" | "physical" | "enriched" | "ml" | "heuristic" | "inferred";

export const TIER_SCORE: Record<QualityTier, number> = {
  experimental: 1.0,
  physical:     0.85, // physics-based on actual coordinates (e.g. AutoDock Vina docking)
  enriched:     0.7,
  ml:           0.7,
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

/** Tailwind classes for tier chip rendering (dark theme). */
export function tierChipClasses(tier: QualityTier): string {
  switch (tier) {
    case "experimental": return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "physical":     return "bg-teal-500/15    text-teal-300    border-teal-500/30";
    case "enriched":     return "bg-blue-500/15    text-blue-300    border-blue-500/30";
    case "ml":           return "bg-violet-500/15  text-violet-300  border-violet-500/30";
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
