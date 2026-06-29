/**
 * Structure-Confidence Gate — gates co-folding outputs before propagation.
 *
 * A co-folded complex is a deep-learning structure prediction. Its
 * trustworthiness varies enormously with interface confidence. This module
 * provides a pure-function gate that every downstream consumer (L1 binding
 * panel, L2 Stage 3, Stage 8, cascade gate, handoff package) must call before
 * using a co-folding affinity or pose.
 *
 * Gate policy:
 *   FULL         — ipTM ≥ 0.75 AND ligand pLDDT ≥ 70
 *                  Affinity propagates at full weight.
 *   DOWNWEIGHTED — ipTM 0.55–0.75 (or ligand pLDDT 50–70 when ipTM meets)
 *                  Affinity propagates but down-weighted; UI shows a
 *                  "low interface confidence" badge.
 *   SUPPRESSED   — ipTM < 0.55 (or confidence unavailable)
 *                  Affinity suppressed from headline panels. Pose still
 *                  viewable, clearly marked. No silently-weak number reaches
 *                  a verdict.
 *
 * Thresholds are policy-snapshotted (like the Confirmation Engine tolerance
 * bands) so they are auditable and tunable without a code change.
 */

import type { CoFoldConfidence, CoFoldAffinity } from "./aiService";

// ── Policy snapshot ─────────────────────────────────────────────────────────

export interface CofoldConfidencePolicy {
  policyId:          string;
  policyVersion:     string;
  snapshottedAt:     string;
  /** ipTM threshold for full propagation. */
  iptmFull:          number;
  /** ipTM threshold for downweighted propagation (below this → suppressed). */
  iptmDownweighted:  number;
  /** Ligand-region pLDDT threshold for full propagation. */
  plddtFull:         number;
  /** Ligand-region pLDDT threshold for downweighted propagation. */
  plddtDownweighted: number;
  /** Affinity weight at full confidence (0–1). */
  weightFull:        number;
  /** Affinity weight at downweighted confidence (0–1). */
  weightDownweighted:number;
}

export function defaultCofoldConfidencePolicy(): CofoldConfidencePolicy {
  return {
    policyId:          "hakase-cofold-confidence-v1",
    policyVersion:     "1.0.0",
    snapshottedAt:     new Date().toISOString(),
    iptmFull:          0.75,
    iptmDownweighted:  0.55,
    plddtFull:         70,
    plddtDownweighted: 50,
    weightFull:        0.65,
    weightDownweighted:0.40,
  };
}

// ── Gate verdict ────────────────────────────────────────────────────────────

export type CofoldGateVerdict = "full" | "downweighted" | "suppressed";

export interface CofoldGateResult {
  verdict:       CofoldGateVerdict;
  /** Affinity propagation weight (0–1). 0 means suppressed. */
  weight:        number;
  iptm:          number | null;
  ligandPlddt:   number | null;
  reason:        string;
  /** The policy snapshot used for this gate decision. */
  policy:        CofoldConfidencePolicy;
}

/**
 * Gate a co-folding result's affinity before propagation.
 *
 * Pure function — no I/O, deterministic given the same inputs and policy.
 * Callers should check `result.verdict` before using any affinity number.
 */
export function gateCofoldConfidence(
  confidence: CoFoldConfidence | null | undefined,
  policy: CofoldConfidencePolicy = defaultCofoldConfidencePolicy(),
): CofoldGateResult {
  const iptm = confidence?.iptm ?? confidence?.ligand_iptm ?? null;
  const plddt = confidence?.complex_plddt ?? null;

  // No confidence data at all → suppressed
  if (iptm === null || !isFinite(iptm)) {
    return {
      verdict: "suppressed",
      weight:  0,
      iptm,
      ligandPlddt: plddt,
      reason:  "Interface confidence (ipTM) unavailable — affinity suppressed from headline panels.",
      policy,
    };
  }

  // Below minimum threshold → suppressed
  if (iptm < policy.iptmDownweighted) {
    return {
      verdict: "suppressed",
      weight:  0,
      iptm,
      ligandPlddt: plddt,
      reason:  `ipTM ${iptm.toFixed(3)} < ${policy.iptmDownweighted} — interface unreliable; affinity suppressed.`,
      policy,
    };
  }

  // Check full confidence: ipTM ≥ threshold AND pLDDT ≥ threshold (or pLDDT unavailable — ipTM alone sufficient)
  const plddtOk = plddt === null || !isFinite(plddt) || plddt >= policy.plddtFull;
  if (iptm >= policy.iptmFull && plddtOk) {
    return {
      verdict: "full",
      weight:  policy.weightFull,
      iptm,
      ligandPlddt: plddt,
      reason:  `ipTM ${iptm.toFixed(3)} ≥ ${policy.iptmFull}${plddt !== null ? ` · pLDDT ${plddt.toFixed(1)} ≥ ${policy.plddtFull}` : ""} — full confidence.`,
      policy,
    };
  }

  // Between thresholds → downweighted
  return {
    verdict: "downweighted",
    weight:  policy.weightDownweighted,
    iptm,
    ligandPlddt: plddt,
    reason:  `ipTM ${iptm.toFixed(3)} in ${policy.iptmDownweighted}–${policy.iptmFull} range${plddt !== null && plddt < policy.plddtFull ? ` · pLDDT ${plddt.toFixed(1)} < ${policy.plddtFull}` : ""} — affinity propagates down-weighted.`,
    policy,
  };
}

// ── Affinity extraction (confidence-gated) ──────────────────────────────────

export interface GatedAffinity {
  /** pKd derived from Boltz-2 affinity head. Null when suppressed. */
  pKd:               number | null;
  /** Kd in nM. Null when suppressed. */
  Kd_nM:             number | null;
  /** Ki in nM (Cheng–Prusoff approximation: Ki ≈ 0.85 × Kd). Null when suppressed. */
  Ki_nM:             number | null;
  /** IC50 in µM (direct from Boltz-2 head). Null when suppressed. */
  IC50_uM:           number | null;
  /** ΔG-like value in kcal/mol. Null when suppressed. */
  dg_kcal_mol:       number | null;
  /** Gate result — consumers MUST check verdict before using any number. */
  gate:              CofoldGateResult;
  /** Source provenance label. */
  source:            "cofolded";
}

/**
 * Extract a confidence-gated affinity from a co-folding result.
 *
 * When the gate verdict is "suppressed", all numeric fields are null.
 * When "downweighted", the numbers are present but consumers must apply
 * the weight from `gate.weight` and surface the low-confidence badge.
 *
 * Never fabricates an affinity — if the Boltz-2 result has no affinity
 * block, all fields are null regardless of confidence.
 */
export function extractGatedAffinity(
  affinity: CoFoldAffinity | null | undefined,
  confidence: CoFoldConfidence | null | undefined,
  policy?: CofoldConfidencePolicy,
): GatedAffinity {
  const gate = gateCofoldConfidence(confidence, policy);

  // No affinity from Boltz-2 at all
  if (!affinity || affinity.affinity_pred_value === null) {
    return {
      pKd: null, Kd_nM: null, Ki_nM: null, IC50_uM: null, dg_kcal_mol: null,
      gate,
      source: "cofolded",
    };
  }

  // Suppressed by confidence gate — numbers exist but must not propagate
  if (gate.verdict === "suppressed") {
    return {
      pKd: null, Kd_nM: null, Ki_nM: null, IC50_uM: null, dg_kcal_mol: null,
      gate,
      source: "cofolded",
    };
  }

  // Affinity available and gate passed (full or downweighted)
  // Boltz-2 affinity_pred_value is log10(IC50 / µM)
  const log10_ic50_uM = affinity.affinity_pred_value;
  const ic50_uM = affinity.ic50_uM ?? Math.pow(10, log10_ic50_uM);
  const ic50_nM = ic50_uM * 1000;

  // pKd = -log10(Kd_M). For a competitive inhibitor at [S]≈Km,
  // Kd ≈ IC50 / 2 (Cheng–Prusoff). pKd = -log10(IC50_M / 2).
  const Kd_nM = ic50_nM / 2;
  const Kd_M = Kd_nM * 1e-9;
  const pKd = Kd_M > 0 ? -Math.log10(Kd_M) : null;

  // Ki ≈ 0.85 × Kd (competitive inhibition, Cheng–Prusoff 1973)
  const Ki_nM = Kd_nM * 0.85;

  const dg = affinity.binding_dg_kcal_mol ?? null;

  return {
    pKd:         pKd !== null ? parseFloat(pKd.toFixed(3)) : null,
    Kd_nM:       parseFloat(Kd_nM.toFixed(2)),
    Ki_nM:       parseFloat(Ki_nM.toFixed(2)),
    IC50_uM:     parseFloat(ic50_uM.toFixed(4)),
    dg_kcal_mol: dg !== null ? parseFloat(dg.toFixed(2)) : null,
    gate,
    source: "cofolded",
  };
}
