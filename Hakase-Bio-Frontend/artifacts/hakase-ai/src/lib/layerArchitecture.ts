/**
 * Pre-Clinical 4-Layer Architecture (April 2026 redesign · May 2026 v2.0.0 update)
 * ─────────────────────────────────────────────────────────────────────────────────
 * Per `attached_assets/HakaseBio_4Layer_Architecture_Research_*.docx` and the
 * v2.0.0 Confirmation Architecture spec, the BioDigital Twin is restructured to
 * a clean four-layer pre-clinical-only model. v2.0.0 absorbed the former
 * standalone Ex-Vivo layer into L2 as the Ex-Vivo sub-track of Confirmation,
 * promoting Animal Cohort to L3 and adding First In Human as L4:
 *
 *   L1 In Vitro  →  L2 Confirmation (In-Silico ↔ Ex-Vivo)  →  L3 Animal Cohort  →  L4 First In Human
 *
 * The Patient Cohort and Trial layers — which previously occupied internal
 * slots 3 and 4 — belong to the Hakase Clinical module, not Pre-Clinical.
 * The handoff to Clinical is an API contract, NOT a shared module
 * (Section 1.3 of the architecture doc — "Module boundaries (hard rule)").
 *
 * Per user instruction "I dont want to delete things", the Patient Cohort
 * and Trial code paths are PRESERVED in `HakaseAI.tsx` but are gated behind
 * this flag so they are unreachable from the navigation. This keeps the
 * code as living documentation / reference for the eventual Clinical-module
 * integration without having to reconstruct the simulation logic.
 *
 * Internal layer slot mapping after the v2.0.0 redesign:
 *   activeLayer 1 → L1 In Vitro       (existing — anchor, no change)
 *   activeLayer 2 → L2 Confirmation   (In-Silico sub-track ↔ Ex-Vivo sub-track,
 *                                      reconciled by ConfirmationLayerPanel)
 *   activeLayer 3 → L3 Animal Cohort  (RELOCATED — full animal-cohort simulation)
 *   activeLayer 4 → L4 First In Human (NEW — Phase-1 design seeds from L3 outputs)
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
  "Confirmation",
  "Animal Cohort",
  "First In Human",
] as const;

/**
 * Per-layer cost ranges from the architecture doc (Section 2.1, Layer summary).
 * Used by scaffold panels so the cost-curve rationale is visible in the UI.
 */
export const PRECLINICAL_LAYER_COSTS = [
  { layer: 1, label: "In Vitro",       perCompound: "$50 – $2,000 / endpoint" },
  { layer: 2, label: "Confirmation",   perCompound: "$0.10 – $10 / cmpd in-silico · $15k – $250k / cmpd ex-vivo" },
  { layer: 3, label: "Animal Cohort",  perCompound: "$300k – multi-M / study" },
  { layer: 4, label: "First In Human", perCompound: "Phase-1 seed (handoff)" },
] as const;
