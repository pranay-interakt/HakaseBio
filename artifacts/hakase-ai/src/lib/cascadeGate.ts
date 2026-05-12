/**
 * L1 → L3 Cascade Gate
 *
 * Decides whether the auto-cascade ("Cascade" diagen mode) is permitted to push
 * Layer 1 results forward into Layer 3 animal study configuration WITHOUT
 * stage-gate human review. (Layer 2 is Confirmation — In-Silico ↔ Ex-Vivo —
 * which has its own confirmation engine; this gate governs the direct L1 →
 * Animal Cohort auto-derivation path under the May 2026 4-layer restructure.)
 *
 * This file intentionally lives outside `safetyFlags.ts` (per repo conventions)
 * and contains only product-policy rules: it does not modify the underlying
 * safety flag engine.
 *
 * Rules
 *   1. NO-GO compounds: never auto-cascade, regardless of data quality.
 *   2. Safety-critical outputs (hERG, hepatotoxicity, bioactivation, CYP)
 *      must each meet *minimum* quality ≥ 0.6 ("structural" tier or better).
 *      A single heuristic-only safety output blocks the cascade.
 *
 *      DELIBERATE POLICY (May 2026): the "structural" tier (score 0.6) sits
 *      EXACTLY at SAFETY_MIN_SCORE so a SMARTS-based bioactivation alert scan
 *      passes the safety gate by itself. Rationale: deterministic substructure
 *      matching against a curated reactive-metabolite alert library is a
 *      defensible discovery-stage signal, even though it is not a predictive
 *      model. If a future critic decides this is too permissive, raise
 *      SAFETY_MIN_SCORE to 0.7 (only ML/enriched/experimental will then pass).
 *   3. Average quality of non-safety outputs must be ≥ 0.6.
 *
 * When blocked, the UI is expected to show a "Stage-Gate Review Required"
 * banner with the explicit blocked-by list, and require an override that is
 * logged to provenance.
 */

import type { SimResults } from "./admet";
import type { TargetSuggestion } from "./targetSuggestion";
import { TIER_SCORE, type QualityTier } from "./sourceQuality";

const SAFETY_MIN_SCORE     = 0.6;
const NON_SAFETY_MIN_AVG   = 0.6;

const SAFETY_KEYS = ["hERG", "hepatotoxicity", "bioactivation", "cyp_panel"] as const;
type SafetyKey = typeof SAFETY_KEYS[number];

export interface OutputQualitySummary {
  tier:  QualityTier;
  score: number;
  note:  string;
}

export interface CascadeGateResult {
  canAutoCascade:           boolean;
  requiresStageGateReview:  boolean;
  reason:                   string;
  blockedBy:                string[];
  safetyMinScore:           number;
  avgNonSafetyScore:        number;
  detail:                   Record<string, OutputQualitySummary>;
}

/**
 * Live ML predictions surfaced from the ai-service. When a row is `available`
 * the gate flips that output's tier from "heuristic" to "ml" (score 0.7) and
 * uses the `note` as the per-output rationale. Pass only what's actually loaded
 * — undefined keys leave the heuristic default in place.
 *
 * NOTE: each override must be set to `available: true` ONLY when the underlying
 * service returned `source === "ml"` AND the relevant value is non-null. A
 * fallback / failed prediction MUST NOT upgrade the tier — the gate would
 * silently lie about quality.
 */
export interface CascadeMlOverrides {
  hERG?:               { available: boolean; note: string };
  hepatotoxicity?:     { available: boolean; note: string };
  cyp_panel?:          { available: boolean; note: string };
  absorption_admet?:   { available: boolean; note: string };
  distribution_admet?: { available: boolean; note: string };
  metabolism_admet?:   { available: boolean; note: string };
  binding_estimate?:   { available: boolean; note: string };
}

/**
 * Source attribution is currently *static* per-output — derived from inspection
 * of the underlying engine, not from runtime metadata. As individual L1 engines
 * (admet.ts, inVitroSim.ts, bioactivationEngine.ts) get rewritten to surface
 * real quality on a per-value basis, this map should accept overrides.
 */
function defaultDetail(): Record<string, OutputQualitySummary> {
  return {
    hERG: {
      tier: "heuristic", score: TIER_SCORE.heuristic,
      note: "Rule-based: logP > 4 + low HBD + MW > 300",
    },
    hepatotoxicity: {
      tier: "heuristic", score: TIER_SCORE.heuristic,
      note: "Rule-based: logP > 4.5 or MW > 550 (no reactive metabolite modelling)",
    },
    bioactivation: {
      tier: "structural", score: TIER_SCORE.structural,
      note: "SMARTS structural alert scan (substructure match — no CYP transformation prediction)",
    },
    cyp_panel: {
      tier: "heuristic", score: TIER_SCORE.heuristic,
      note: "Inferred from logP / MW (no enzyme kinetics)",
    },
    absorption_admet: {
      tier: "heuristic", score: TIER_SCORE.heuristic,
      note: "TPSA brackets — no transporter (P-gp / BCRP) modelling",
    },
    distribution_admet: {
      tier: "heuristic", score: TIER_SCORE.heuristic,
      note: "LogP-derived; PPB / Vd not modelled mechanistically",
    },
    metabolism_admet: {
      tier: "heuristic", score: TIER_SCORE.heuristic,
      note: "LogP rules of thumb; no species differences",
    },
    binding_estimate: {
      tier: "heuristic", score: TIER_SCORE.heuristic,
      note: "Pharmacophore + jitter from hardcoded potency range",
    },
    target_identification: {
      tier: "structural", score: TIER_SCORE.structural,
      note: "Pharmacophore catalogue — substructure match, no measured target evidence",
    },
  };
}

function bestTargetTier(suggestions: TargetSuggestion[]): { tier: QualityTier; note: string } {
  if (suggestions.length === 0) {
    return { tier: "inferred", note: "No targets surfaced — chemistry novel or off-class" };
  }
  let best: QualityTier = "structural";
  let bestScore = TIER_SCORE.structural;
  for (const s of suggestions) {
    const t: QualityTier =
      s.source === "chembl"          ? "experimental" :
      s.source === "chembl-similar"  ? "enriched"     :
                                       "structural";  // pharmacophore SMARTS match
    if (TIER_SCORE[t] > bestScore) { best = t; bestScore = TIER_SCORE[t]; }
  }
  const counts = {
    chembl:         suggestions.filter(s => s.source === "chembl").length,
    similar:        suggestions.filter(s => s.source === "chembl-similar").length,
    heuristic:      suggestions.filter(s => s.source === "heuristic").length,
  };
  const parts: string[] = [];
  if (counts.chembl > 0)    parts.push(`${counts.chembl} ChEMBL exact-match`);
  if (counts.similar > 0)   parts.push(`${counts.similar} similarity-inferred`);
  if (counts.heuristic > 0) parts.push(`${counts.heuristic} pharmacophore`);
  return { tier: best, note: `${suggestions.length} target(s); ${parts.join(", ")}` };
}

export function evaluateCascadeGate(
  simResults: SimResults | null,
  targetSuggestions: TargetSuggestion[],
  mlOverrides: CascadeMlOverrides = {},
): CascadeGateResult {
  const detail = defaultDetail();

  // Override target_identification with live evidence from suggestions.
  const tgt = bestTargetTier(targetSuggestions);
  detail.target_identification = {
    tier:  tgt.tier,
    score: TIER_SCORE[tgt.tier],
    note:  tgt.note,
  };

  // Override per-output tier to "ml" when a validated ML prediction is loaded.
  // We check `available` explicitly so a fallback / failed prediction does NOT
  // upgrade the tier (otherwise the gate would silently lie about quality).
  const mlKeys = [
    "hERG",
    "hepatotoxicity",
    "cyp_panel",
    "absorption_admet",
    "distribution_admet",
    "metabolism_admet",
    "binding_estimate",
  ] as const;
  for (const k of mlKeys) {
    const ov = mlOverrides[k];
    if (ov?.available) {
      detail[k] = { tier: "ml", score: TIER_SCORE.ml, note: ov.note };
    }
  }

  // Compute safety-min and non-safety-avg.
  const safetyScores = SAFETY_KEYS.map((k) => detail[k as SafetyKey].score);
  const safetyMinScore = Math.min(...safetyScores);

  const nonSafetyKeys = Object.keys(detail).filter((k) => !SAFETY_KEYS.includes(k as SafetyKey));
  const nonSafetyScores = nonSafetyKeys.map((k) => detail[k].score);
  const avgNonSafetyScore = nonSafetyScores.length > 0
    ? nonSafetyScores.reduce((a, b) => a + b, 0) / nonSafetyScores.length
    : 0;

  const blockedBy: string[] = [];

  if (simResults?.goNogo === "NO-GO") {
    blockedBy.push("NO-GO decision");
  }
  for (const k of SAFETY_KEYS) {
    if (detail[k as SafetyKey].score < SAFETY_MIN_SCORE) blockedBy.push(k);
  }
  if (avgNonSafetyScore < NON_SAFETY_MIN_AVG) {
    blockedBy.push("avg_non_safety_quality");
  }

  const canAutoCascade = blockedBy.length === 0;

  let reason: string;
  if (canAutoCascade) {
    reason = "All quality thresholds met — auto-cascade permitted.";
  } else if (simResults?.goNogo === "NO-GO") {
    reason = "NO-GO compound — manual review required regardless of data quality.";
  } else {
    const safetyBlocked = blockedBy.filter((k) => SAFETY_KEYS.includes(k as SafetyKey));
    if (safetyBlocked.length > 0) {
      reason = `Safety-critical outputs are heuristic-only (${safetyBlocked.join(", ")}). Human reviewer must sign off before advancing to Layer 3 — animal study configuration cannot be auto-derived from these signals.`;
    } else {
      reason = `Average non-safety data quality (${avgNonSafetyScore.toFixed(2)}) below threshold ${NON_SAFETY_MIN_AVG}. Stage-gate review required.`;
    }
  }

  return {
    canAutoCascade,
    requiresStageGateReview: !canAutoCascade,
    reason,
    blockedBy,
    safetyMinScore,
    avgNonSafetyScore,
    detail,
  };
}

/**
 * Free-text justification a reviewer must record when overriding the gate.
 * The UI passes this back to provenance so the cascade is auditable.
 */
export interface CascadeOverrideRecord {
  timestamp:        string;
  reviewer:         string;
  justification:    string;
  blockedBy:        string[];
  safetyMinScore:   number;
  avgNonSafetyScore:number;
}

export function recordCascadeOverride(
  gate: CascadeGateResult,
  reviewer: string,
  justification: string,
): CascadeOverrideRecord {
  return {
    timestamp:         new Date().toISOString(),
    reviewer,
    justification,
    blockedBy:         gate.blockedBy,
    safetyMinScore:    gate.safetyMinScore,
    avgNonSafetyScore: gate.avgNonSafetyScore,
  };
}
