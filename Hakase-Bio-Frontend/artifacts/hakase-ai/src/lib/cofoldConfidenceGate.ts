/**
 * cofoldConfidenceGate — COMPATIBILITY ALIAS.
 *
 * The canonical structure-confidence gate for Boltz-2 co-folded complexes is
 * `confidenceGate.ts`. It is the implementation wired into `l2Pipeline.ts` and
 * `cascadeGate.ts`, and it also extracts a confidence-gated affinity
 * (`extractGatedAffinity`).
 *
 * This file previously held a second, parallel implementation. To avoid two
 * competing gates, it now simply re-exports the canonical module. Import from
 * `./confidenceGate` directly in new code; this alias exists only so any
 * lingering `cofoldConfidenceGate` import keeps resolving.
 */

export * from "./confidenceGate";
