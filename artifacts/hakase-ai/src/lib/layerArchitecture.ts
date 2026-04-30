/**
 * Pre-Clinical 4-Layer Architecture (April 2026 redesign)
 * ─────────────────────────────────────────────────────────
 * Per `attached_assets/HakaseBio_4Layer_Architecture_Research_*.docx`,
 * the BioDigital Twin is restructured to a clean four-layer pre-clinical-only
 * model with the cheapest filter (in-silico) immediately downstream of the
 * cheapest data source (in-vitro):
 *
 *   L1 In Vitro  →  L2 In Silico  →  L3 Ex Vivo  →  L4 Animal Cohort
 *
 * The Patient Cohort and Trial layers — which previously occupied internal
 * slots 3 and 4 — belong to the Hakase Clinical module, not Pre-Clinical.
 * The L4 → Clinical handoff is an API contract, NOT a shared module
 * (Section 1.3 of the architecture doc — "Module boundaries (hard rule)").
 *
 * Per user instruction "I dont want to delete things", the Patient Cohort
 * and Trial code paths are PRESERVED in `HakaseAI.tsx` but are gated behind
 * this flag so they are unreachable from the navigation. This keeps the
 * code as living documentation / reference for the eventual Clinical-module
 * integration without having to reconstruct the simulation logic.
 *
 * Internal layer slot mapping after the redesign:
 *   activeLayer 1 → L1 In Vitro      (existing — anchor, no change)
 *   activeLayer 2 → L2 In Silico     (NEW — scaffold; documents L1→L2 contract)
 *   activeLayer 3 → L3 Ex Vivo       (NEW — scaffold; documents L2→L3 contract)
 *   activeLayer 4 → L4 Animal Cohort (RELOCATED — was internal slot 2; full sim)
 *
 * The animal-cohort simulation runner and panel were moved from internal
 * slot 2 to internal slot 4 to match the new L4 position. The Patient Cohort
 * runner (was slot 3) and Trial runner (was slot 4) are gated by the constant
 * below, never fire, and never render — but the code remains in place.
 */

export const HIDE_PATIENT_TRIAL_LAYERS = true as const;

/**
 * Human-readable labels for the four pre-clinical layers, in order.
 * Must match the `layerLabels` array in `HakaseAI.tsx` for consistency.
 */
export const PRECLINICAL_LAYER_LABELS = [
  "In Vitro",
  "In Silico",
  "Ex Vivo",
  "Animal Cohort",
] as const;

/**
 * Per-layer cost ranges from the architecture doc (Section 2.1, Layer summary).
 * Used by scaffold panels so the cost-curve rationale is visible in the UI.
 */
export const PRECLINICAL_LAYER_COSTS = [
  { layer: 1, label: "In Vitro",      perCompound: "$50 – $2,000 / endpoint" },
  { layer: 2, label: "In Silico",     perCompound: "$0.10 – $10 / cmpd / model" },
  { layer: 3, label: "Ex Vivo",       perCompound: "$15k – $250k / cmpd" },
  { layer: 4, label: "Animal Cohort", perCompound: "$300k – multi-M / study" },
] as const;
