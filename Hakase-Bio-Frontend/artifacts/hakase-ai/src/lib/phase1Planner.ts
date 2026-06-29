/**
 * Phase 1 Planner — v2.0.0 §7.3 internal consumer.
 *
 * Pure functions on PreClinicalPackageV2_0_0:
 *   derivePhase1Defaults       — MABEL / HED / FIH starting dose
 *   shouldApplyMabelBias       — branches on accepted FalsifierId values
 *   evaluateINDGate            — reads embedded gatePolicy
 *
 * Consumed by FirstInHumanPanel (slot 4 in HakaseAI.tsx). No I/O.
 */

import {
  FALSIFIER_REGISTRY,
  getFalsifierEntry,
  type FalsifierId,
  type GatePolicySnapshot,
  type PreClinicalPackageV2_0_0,
} from "@workspace/preclinical-handoff";

export type IndGateDecision =
  | { decision: "go"; reasons: string[] }
  | { decision: "no-go"; reasons: string[] }
  | { decision: "conditional-go"; reasons: string[]; conditions: string[] };

export interface Phase1DefaultsDraft {
  /** Adult body weight assumption used to convert mg/kg → mg. */
  adultBwKg: number;
  hedMgPerKg: number;
  fihStartingMgPerKg: number;
  fihStartingMg: number;
  mabelMg: number;
  mabelDerivation:
    | "1/10 HED (no MABEL bias required)"
    | "MABEL bias: 1/100 HED (accepted falsifier on MABEL-bias-required list)";
  appliedMabelBias: boolean;
  mabelBiasReasonFalsifierId: FalsifierId | null;
  escalationSteps: string[];
  perLayerConfidence: {
    inVitro: "low" | "moderate" | "high";
    confirmationInSilico: "low" | "moderate" | "high";
    confirmationExVivo: "low" | "moderate" | "high";
    animalCohort: "low" | "moderate" | "high";
  };
}

const ADULT_BW_KG = 70;

export function shouldApplyMabelBias(pkg: PreClinicalPackageV2_0_0): {
  apply: boolean;
  reasonFalsifierId: FalsifierId | null;
  acceptedFalsifiers: FalsifierId[];
} {
  // Every override that explicitly accepted a FalsifierId.
  const accepted = pkg.overrideAuditTrail
    .map((o) => o.falsifierAccepted)
    .filter((f): f is FalsifierId => !!f);
  for (const f of accepted) {
    const entry = getFalsifierEntry(f);
    if (entry?.mabelBiasRequired) {
      return {
        apply: true,
        reasonFalsifierId: f,
        acceptedFalsifiers: accepted,
      };
    }
  }
  return { apply: false, reasonFalsifierId: null, acceptedFalsifiers: accepted };
}

function gateConfidence(
  status: "passed" | "failed" | "overridden",
): "low" | "moderate" | "high" {
  switch (status) {
    case "passed":
      return "high";
    case "overridden":
      return "moderate";
    case "failed":
      return "low";
  }
}

export function derivePhase1Defaults(
  pkg: PreClinicalPackageV2_0_0,
): Phase1DefaultsDraft {
  // HED: take the rodent NOAEL × Km factor approximation if present in the
  // animal record's hedMgPerKg; otherwise fall back to NOAEL/6.2 (standard
  // FDA Km for rat → human conversion). Builders should populate hedMgPerKg.
  const animalRec = pkg.animalCohort.evidence[0];
  const hed =
    animalRec?.hedMgPerKg ??
    (animalRec?.noaelMgPerKg ? animalRec.noaelMgPerKg / 6.2 : 0);

  const bias = shouldApplyMabelBias(pkg);
  // 1/10 HED is standard ICH-S9 / EMA non-oncology MABEL anchor; 1/100 when an
  // accepted falsifier on the registry's mabelBiasRequired list demands extra
  // conservatism (spec §9.6 worked example).
  const fihMgKg = bias.apply ? hed / 100 : hed / 10;
  const mabel = fihMgKg * ADULT_BW_KG; // already MABEL-aligned

  return {
    adultBwKg: ADULT_BW_KG,
    hedMgPerKg: Number(hed.toFixed(4)),
    fihStartingMgPerKg: Number(fihMgKg.toFixed(4)),
    fihStartingMg: Number((fihMgKg * ADULT_BW_KG).toFixed(3)),
    mabelMg: Number(mabel.toFixed(3)),
    mabelDerivation: bias.apply
      ? "MABEL bias: 1/100 HED (accepted falsifier on MABEL-bias-required list)"
      : "1/10 HED (no MABEL bias required)",
    appliedMabelBias: bias.apply,
    mabelBiasReasonFalsifierId: bias.reasonFalsifierId,
    escalationSteps: bias.apply
      ? ["1× MABEL", "2×", "3×", "5×", "8×", "12×", "MTD probe"]
      : ["1× MABEL", "2×", "5×", "10×", "20×", "MTD probe"],
    perLayerConfidence: {
      inVitro: gateConfidence(pkg.inVitro.gateStatus),
      confirmationInSilico: gateConfidence(pkg.confirmation.inSilico.gateStatus),
      confirmationExVivo: gateConfidence(pkg.confirmation.exVivo.gateStatus),
      animalCohort: gateConfidence(pkg.animalCohort.gateStatus),
    },
  };
}

export function evaluateINDGate(
  pkg: PreClinicalPackageV2_0_0,
  policyOverride?: GatePolicySnapshot,
): IndGateDecision {
  const policy = policyOverride ?? pkg.gatePolicy;
  const reasons: string[] = [];
  const conditions: string[] = [];

  // Block 1: confirmation gate must not be hard-failed.
  if (pkg.confirmation.gateStatus === "failed") {
    reasons.push(
      "Confirmation gate is failed — at least one falsifier triggered without an accepted override.",
    );
    return { decision: "no-go", reasons };
  }

  // Block 2: animal cohort gate must not be high-risk failed.
  if (pkg.animalCohort.gateStatus === "failed") {
    reasons.push(
      "Animal cohort gate is failed — overall risk reads as high.",
    );
    return { decision: "no-go", reasons };
  }

  // Block 3: every joint output must be reconciled (agree | partial-w-repair |
  // mlGap | accepted-disagree).
  const accepted = new Set(
    pkg.overrideAuditTrail
      .map((o) => o.falsifierAccepted)
      .filter((f): f is FalsifierId => !!f),
  );
  const jo = pkg.confirmation.jointOutputs;
  for (const [name, out] of Object.entries(jo)) {
    if (out.status === "disagree" && (!out.falsifierTriggered || !accepted.has(out.falsifierTriggered))) {
      reasons.push(`Joint output ${name} disagrees without accepted override.`);
      return { decision: "no-go", reasons };
    }
    if (out.status === "partial") {
      conditions.push(
        `${name}: partial — repair via ${out.repairPath?.missingAssay.assayId ?? "(missing assay)"} before IND filing.`,
      );
    }
    if (out.status === "mlGap") {
      conditions.push(`${name}: in-silico gap — extended ex-vivo panel cited.`);
    }
  }

  // Block 4: if MABEL bias was applied, surface it as a condition (the IND
  // narrative must reference the accepted falsifier and SOP citation).
  const bias = shouldApplyMabelBias(pkg);
  if (bias.apply) {
    conditions.push(
      `MABEL bias applied — accepted ${bias.reasonFalsifierId} requires conservative FIH (1/100 HED).`,
    );
  }

  // Block 5: every override on the trail must satisfy its policy authority
  // requirement (write-time invariants already enforced shape; this checks
  // role-allowed and policyMustCite per overrideKind).
  for (const o of pkg.overrideAuditTrail) {
    const req = policy.overrideAuthorityRequired[o.overrideKind];
    if (!req) continue;
    if (!req.rolesAllowed.includes(o.role)) {
      reasons.push(
        `Override ${o.overrideId} (${o.overrideKind}) actor role ${o.role} not in allowed: ${req.rolesAllowed.join("/")}`,
      );
      return { decision: "no-go", reasons };
    }
    const cited = String(o.authorityCitation);
    if (req.policyMustCite.length > 0 && !req.policyMustCite.some((p) => cited.startsWith(String(p)))) {
      reasons.push(
        `Override ${o.overrideId} authority citation ${cited} does not cite required policy (${req.policyMustCite.join("/")}).`,
      );
      return { decision: "no-go", reasons };
    }
  }

  if (conditions.length > 0) {
    reasons.push("Conditional GO — see conditions for IND filing prerequisites.");
    return { decision: "conditional-go", reasons, conditions };
  }
  reasons.push("All gate criteria satisfied; package is IND-ready.");
  return { decision: "go", reasons };
}

export const _registry = FALSIFIER_REGISTRY; // re-export for UI inspection
