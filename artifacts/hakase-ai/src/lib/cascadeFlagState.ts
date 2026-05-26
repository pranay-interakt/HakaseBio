/**
 * Cascade flag state — discriminated union per L3 In-Silico Surrogate Spec v1.1 §8.
 *
 * The HAIOps six-flag cascade returns a state per flag per readout.  Prior to v1.1,
 * the state was a free-form string ("pass" | "fail" | "prediction_only" | ...) which
 * downstream consumers could silently treat as "pass" if they forgot to handle the
 * new T0 surrogate state.  v1.1 promotes the state to a tagged enum so every consumer
 * is forced (at compile time) to handle each branch explicitly.
 *
 * The Amber Curator's refusal-to-sign at L4 is implemented as a function whose type
 * signature only accepts a `{ kind: "pass" }` state for load-bearing fields — making
 * the gating a compile-time guarantee, not a runtime check.
 *
 * Ref: HakaseBio_Layer3_InSilico_Surrogate_Spec v1.1 §8.2
 */

export type FoldErrorBand = {
  /** Median fold-error vs. wet measurement on the calibration cohort. */
  median: number;
  /** 90th-percentile fold-error vs. wet measurement on the calibration cohort. */
  p90: number;
  /** Number of compound-pairs in the calibration cohort.  When 0 the band is unset. */
  cohortN: number;
  /** ISO timestamp the cohort was last assembled. */
  measuredAt: string | null;
};

export type ApplicabilityDomain = {
  inDomain: boolean;
  /** 0–1 — higher = closer to training distribution. */
  score: number;
  /** Free-text rationale: which features fall outside the AD. */
  rationale: string;
};

export type RemediationRoute =
  | { route: "rerun_upstream"; layer: 1 | 2 | 3 | 4; missingInput: string }
  | { route: "request_cro_panel"; cro: "Charles River" | "Eurofins Discovery" | "Inotiv" | "WuXi AppTec" | "Pharmaron"; assay: string }
  | { route: "request_vendor_adapter"; vendor: "Emulate" | "CN Bio" | "Mimetas" | "TissUse" | "InSphero"; chip: string }
  | { route: "manual_review"; owner: string };

export type CascadeFlagState =
  | {
      kind: "pass";
      checkedAt: string;
    }
  | {
      kind: "fail";
      checkedAt: string;
      reason: string;
      remediation: RemediationRoute;
    }
  | {
      kind: "prediction_only";
      checkedAt: string;
      method: string;
      foldError: FoldErrorBand;
      applicabilityDomain: ApplicabilityDomain;
      snapshotsWithinCadence: boolean;
      /** Non-removable UI banner text. */
      uiBanner: string;
    }
  | {
      kind: "not_applicable";
      checkedAt: string;
      reason: string;
    };

/**
 * Exhaustive switch helper.  Use this in every consumer:
 *
 *   switch (state.kind) {
 *     case "pass":             return canSign;
 *     case "fail":             return blockWithReason(state.reason);
 *     case "prediction_only":  return requireWetAnchor(state.method);
 *     case "not_applicable":   return skip;
 *     default:                 return assertExhaustive(state);
 *   }
 *
 * Adding a new branch to CascadeFlagState without updating callers becomes a
 * compile-time error.
 */
export function assertExhaustive(s: never): never {
  throw new Error(`Unhandled CascadeFlagState branch: ${JSON.stringify(s)}`);
}

/**
 * L4 Amber Curator gating predicate.  Load-bearing fields (regulatory-relevant
 * claims) require a `pass` state; T0 `prediction_only` outputs are explicitly
 * rejected per spec §8.2.  Triage decisions can use any state.
 */
export function canSignLoadBearing(state: CascadeFlagState): boolean {
  return state.kind === "pass";
}

/** Convenience constructor for T0 surrogate outputs. */
export function predictionOnly(args: {
  method: string;
  foldError: FoldErrorBand;
  applicabilityDomain: ApplicabilityDomain;
  snapshotsWithinCadence: boolean;
  uiBanner?: string;
}): CascadeFlagState {
  return {
    kind: "prediction_only",
    checkedAt: new Date().toISOString(),
    method: args.method,
    foldError: args.foldError,
    applicabilityDomain: args.applicabilityDomain,
    snapshotsWithinCadence: args.snapshotsWithinCadence,
    uiBanner:
      args.uiBanner ??
      "T0 in-silico surrogate — predicted, not measured. Wet anchoring (T2/T3) required for IND-supporting claims.",
  };
}
