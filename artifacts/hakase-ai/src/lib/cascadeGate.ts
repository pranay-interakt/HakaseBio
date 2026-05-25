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
import type { InVitroResults } from "./inVitroSim";
import type { TargetSuggestion } from "./targetSuggestion";
import { TIER_SCORE, makeCofoldedQuality, type QualityTier } from "./sourceQuality";
import type { CofoldGateResult } from "./confidenceGate";

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
  /**
   * Optional in-vitro result envelope. When provided, per-field provenance
   * on hERG / CYP / Caco-2 / PPB / etc. is read directly off the live
   * `iv.provenance` map — so the gate stops lying about quality the moment
   * the L1 engine actually consumes the ML overlay (instead of waiting for
   * the caller to also remember to pass the matching `mlOverrides`).
   */
  inVitroResults: InVitroResults | null = null,
  /**
   * Optional co-folding confidence gate result from Stage 2b.
   * When provided and the gate verdict is not "suppressed", adds a
   * `cofolded_binding` entry to the quality detail map. The quality score
   * is ipTM-interpolated via `makeCofoldedQuality()`.
   */
  cofoldGate: CofoldGateResult | null = null,
): CascadeGateResult {
  const detail = defaultDetail();

  // Override target_identification with live evidence from suggestions.
  const tgt = bestTargetTier(targetSuggestions);
  detail.target_identification = {
    tier:  tgt.tier,
    score: TIER_SCORE[tgt.tier],
    note:  tgt.note,
  };

  // ── 1. Read live per-field provenance from L1 outputs ────────────────────
  // The L1 engines now stamp `provenance: Record<key, "ml"|"heuristic"|...>`
  // on every numeric output (see admet.ts / inVitroSim.ts). When the value
  // is sourced from a real ML signal we immediately upgrade the matching
  // cascade-gate tier — no need for the orchestrator to also pass a
  // CascadeMlOverrides entry that duplicates what L1 already knows.
  const lifProv = (key: string): "ml" | "heuristic" | "experimental" | undefined =>
    inVitroResults?.provenance?.[key];
  const simProv = (key: string): "ml" | "heuristic" | "experimental" | undefined =>
    simResults?.provenance?.[key];

  if (lifProv("hergRisk") === "ml" || lifProv("herg_ic50_uM") === "ml") {
    detail.hERG = {
      tier: "ml", score: TIER_SCORE.ml,
      note: "ML — CardioTox-ML hERG channel blocker probability (Wang/Karim 2016 RF)",
    };
  }
  if (simProv("toxicity") === "ml" || lifProv("hergRisk") === "experimental") {
    // ADMET-AI toxicity head OR experimental data already covers hepatotox.
    detail.hepatotoxicity = {
      tier: simProv("toxicity") === "ml" ? "ml" : "experimental",
      score: simProv("toxicity") === "ml" ? TIER_SCORE.ml : TIER_SCORE.experimental,
      note:  simProv("toxicity") === "ml"
        ? "ML — ADMET-AI / DILI-ML toxicity composite (Chemprop GNN + DILIrank RF)"
        : "Experimental measurement supplied",
    };
  }
  if (lifProv("cypInhibition") === "ml") {
    detail.cyp_panel = {
      tier: "ml", score: TIER_SCORE.ml,
      note: "ML — ADMET-AI Veith 5-isoform CYP inhibition panel (1A2/2C9/2C19/2D6/3A4)",
    };
  }
  if (simProv("absorption") === "ml" || lifProv("caco2Papp") === "ml") {
    detail.absorption_admet = {
      tier: "ml", score: TIER_SCORE.ml,
      note: "ML — ADMET-AI Caco2_Wang + HIA_Hou + Bioavailability_Ma blend",
    };
  }
  if (simProv("distribution") === "ml" || lifProv("fuPercent") === "ml") {
    detail.distribution_admet = {
      tier: "ml", score: TIER_SCORE.ml,
      note: "ML — ADMET-AI BBB_Martins + PPBR_AZ + VDss_Lombardo blend",
    };
  }
  if (simProv("metabolism") === "ml" || lifProv("hepatoCLint") === "ml" || lifProv("halfLifeMin") === "ml") {
    detail.metabolism_admet = {
      tier: "ml", score: TIER_SCORE.ml,
      note: "ML — ADMET-AI Clearance_Hepatocyte_AZ + Half_Life_Obach heads",
    };
  }
  if (simProv("binding") === "ml" || lifProv("doseResponse_IC50") === "ml") {
    detail.binding_estimate = {
      tier: "ml", score: TIER_SCORE.ml,
      note: "ML — Binding-ML DeepDTA-GBM (ESM-2 + Morgan FP)",
    };
  } else if (simProv("binding") === "experimental") {
    detail.binding_estimate = {
      tier: "experimental", score: TIER_SCORE.experimental,
      note: "Measured ChEMBL exact-match Kd/Ki",
    };
  }

  // ── 2. Apply explicit caller overrides (still wins over the L1 read) ─────
  // The orchestrator may have richer note strings (model versions, ROC-AUC,
  // training-set sizes) it wants to show. We let those replace the auto-
  // derived note. We DO NOT downgrade — an override that is `available:false`
  // must NOT roll an ML tier back to heuristic; explicit fallbacks should
  // already be reflected as "no override" in the orchestrator's logic.
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

  // ── 3. Co-folding binding (ipTM-scaled quality tier) ──────────────────────
  // When Stage 2b ran and the confidence gate did not suppress the affinity,
  // add a non-safety `cofolded_binding` entry. Its score is ipTM-interpolated
  // (0.45–0.70) so a high-ipTM result lifts the non-safety average; a marginal
  // one barely helps — and a suppressed result is simply absent.
  if (cofoldGate && cofoldGate.verdict !== "suppressed") {
    const cq = makeCofoldedQuality("Stage 2b co-folding", cofoldGate.iptm);
    detail["cofolded_binding"] = {
      tier:  cq.tier,
      score: cq.score,
      note:  `Co-folding affinity (${cofoldGate.verdict}) — ipTM ${cofoldGate.iptm?.toFixed(3) ?? "N/A"}, quality score ${cq.score.toFixed(3)}`,
    };
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
