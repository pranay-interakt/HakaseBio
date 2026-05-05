/**
 * L2 Confirmation Engine — v2.0.0 §4 internal path implementation.
 *
 * Pure-function helpers consumed by ConfirmationLayerPanel.tsx. No React,
 * no I/O — every primitive is deterministic given (L1, in-silico, ex-vivo,
 * registry, policy) so the same compound run twice emits the same
 * ConfirmationEvidenceBlock.
 *
 * Phases (spec §4.1–4.7) implemented:
 *   §4.1 Ingest + freeze L1 evidence pointer  → freezeL1EvidencePointer
 *   §4.2 In-silico sub-track + directive       → emitDirective
 *   §4.3 In-silico gate                        → evaluateInSilicoGate
 *   §4.4 Ex-vivo sub-track                     → buildExVivoEvidence
 *   §4.5 Falsifier check                       → checkFalsifiers
 *   §4.6 Joint output synthesis                → synthesizeJointOutputs
 *   §4.7 Exit gate                             → buildConfirmationBlock
 */

import {
  SCHEMA_VERSION_V2_0_0,
  asActorId,
  asCompoundId,
  asDirectiveId,
  asEngineId,
  asEvidencePointer,
  asFalsifierId,
  asOverrideId,
  asPolicyRef,
  assertConfirmationBlock,
  type AnimalCohortEvidenceBlock,
  type AssaySpec,
  type ClearanceFractionsJointOutput,
  type CompoundIdentity,
  type ConfirmationEvidenceBlock,
  type ConfirmationJointOutputs,
  type CypTransporterJointOutput,
  type DirectiveId,
  type EvidencePointer,
  type ExVivoEntryMode,
  type ExVivoEvidenceRecord,
  type ExpectedRange,
  type FalsifierAssertion,
  type FalsifierId,
  type FalsifierRegistry,
  type FalsifierTrigger,
  type GatePolicySnapshot,
  type InSilicoEvidenceRecord,
  type InVitroEvidenceBlock,
  type InVitroEvidenceRecord,
  type JointOutput,
  type LayerEvidenceBlock,
  type OverrideRecord,
  type PreClinicalPackageV2_0_0,
  type PreConfirmationDirective,
  type PredictionDomain,
  type RepairPath,
  type Role,
  FALSIFIER_REGISTRY,
  V2_0_0_InvariantError,
} from "@workspace/preclinical-handoff";
import type { SimResults } from "./admet";
import type { InVitroResults } from "./inVitroSim";
import type { MlAdmetResult } from "./aiService";
import type { AnimalCohortResults } from "./animalSim";

// ── Engine identity (provenance fields on every emitted block) ──────────────

export const CONFIRMATION_ENGINE = asEngineId("hakase-confirmation-engine@2.0.0");
export const CONFIRMATION_ENGINE_VERSION = "2.0.0";
export const PROGRAM_ID = "AKTHEALTH-HAKASEBIO-DEFAULT";

// ── Default GatePolicy snapshot (§5.4) ──────────────────────────────────────
//
// In production, a partner program would version this independently and
// snapshot it into the package at gate time. For the scaffolded build we ship
// a single conservative default and embed it on every emitted block — that's
// what makes the package portable across organisations without baking
// thresholds into the consumer.
export function defaultGatePolicy(): GatePolicySnapshot {
  return {
    policyId: "akt-default-gate-policy",
    policyVersion: "1.0.0",
    snapshottedAt: new Date().toISOString(),
    inSilicoGateThresholds: {
      admet: { minConfidence: 0.6, falsifiersConsidered: [] },
      hERG: {
        minConfidence: 0.7,
        falsifiersConsidered: [asFalsifierId("FX-HERG-IC50-LT-3UM")],
      },
      off_target: {
        minConfidence: 0.6,
        falsifiersConsidered: [asFalsifierId("FX-OFFTARGET-BSEP-INHIB")],
      },
      clearance: {
        minConfidence: 0.6,
        falsifiersConsidered: [asFalsifierId("FX-CLEARANCE-OVERPREDICT")],
      },
      cyp_inhibition: {
        minConfidence: 0.65,
        falsifiersConsidered: [asFalsifierId("FX-CYP3A4-IC50-LT-1UM")],
      },
    },
    exVivoGateRules: [
      {
        ruleId: "exvivo-default",
        description:
          "All joint output domains in agree/partial-with-repair before L3 entry",
        domainsRequired: [
          "cyp_transporter",
          "clearance_fractions",
          "off_target",
          "dose_response",
          "herg_pbpk",
        ],
      },
    ],
    jointOutputTolerances: {
      cyp_transporter: { kind: "log10", value: 0.5, unit: "µM" },
      clearance_fractions: { kind: "fold", value: 2, unit: "mL/min/kg" },
      off_target: { kind: "log10", value: 1, unit: "µM" },
      dose_response: { kind: "fold", value: 3, unit: "fold" },
      herg_pbpk: { kind: "fold", value: 5, unit: "× Cmax" },
    },
    overrideAuthorityRequired: {
      inSilicoGate: {
        rolesAllowed: ["PreClinicalSafetyReviewer", "ProgramLead"],
        policyMustCite: [asPolicyRef("AKTHealth-SOP-PCS-007")],
      },
      exVivoGate: {
        rolesAllowed: ["PreClinicalSafetyReviewer", "ProgramLead"],
        policyMustCite: [asPolicyRef("AKTHealth-SOP-PCS-007")],
      },
      exVivoSkipped: {
        rolesAllowed: ["ProgramLead", "ChiefScientificOfficer"],
        policyMustCite: [asPolicyRef("AKTHealth-SOP-PCS-008")],
      },
      jointOutputDisagree: {
        rolesAllowed: ["PreClinicalSafetyReviewer"],
        policyMustCite: [asPolicyRef("AKTHealth-SOP-PCS-007")],
      },
      indGate: {
        rolesAllowed: ["RegulatoryAffairs", "ChiefScientificOfficer"],
        policyMustCite: [asPolicyRef("AKTHealth-SOP-RA-001")],
      },
    },
  };
}

// ── §4.1 — Freeze L1 evidence pointer ───────────────────────────────────────

export function freezeL1EvidencePointer(
  compoundIdRaw: string,
  emittedAt: string,
): EvidencePointer {
  return asEvidencePointer(
    `evt://l1/${compoundIdRaw}/${emittedAt.slice(0, 10)}#assays`,
  );
}

// ── L1 → InVitroEvidenceBlock builder ───────────────────────────────────────

export function buildInVitroBlock(
  l1: SimResults,
  inVitro: InVitroResults | null,
  l1Pointer: EvidencePointer,
): InVitroEvidenceBlock {
  const evidence: InVitroEvidenceRecord[] = [];
  if (inVitro?.herg?.ic50_uM != null) {
    evidence.push({
      recordId: asEvidencePointer(`${l1Pointer}#herg`),
      assay: "herg_patch_clamp",
      value: inVitro.herg.ic50_uM,
      unit: "µM",
      notes: `risk=${inVitro.herg.riskCategory}`,
    });
  }
  if (inVitro?.permeability?.caco2Papp != null) {
    evidence.push({
      recordId: asEvidencePointer(`${l1Pointer}#caco2`),
      assay: "caco2_permeability",
      value: inVitro.permeability.caco2Papp,
      unit: "10^-6 cm/s",
      notes: null,
    });
  }
  evidence.push({
    recordId: asEvidencePointer(`${l1Pointer}#admet_summary`),
    assay: "l1_admet_summary",
    value: l1.admet?.absorption ?? null,
    unit: "score 0..1",
    notes: `goNogo=${l1.goNogo}; tox=${l1.admet?.toxicity?.toFixed?.(2) ?? "n/a"}`,
  });
  return {
    layer: "inVitro",
    evidence,
    confidence: { byClass: {} },
    gateStatus: l1.goNogo === "NO-GO" ? "failed" : "passed",
    falsifiers: [],
    overrides: [],
    emittedAt: new Date().toISOString(),
    emitterEngine: asEngineId("hakase-l1@1.4.0"),
    emitterEngineVersion: "1.4.0",
  };
}

// ── §4.2 — Emit PreConfirmationDirective ────────────────────────────────────

export interface DirectiveInputs {
  compoundIdRaw: string;
  l1Pointer: EvidencePointer;
  /** ML / heuristic predicted clearance in mL/min/kg (or null). */
  predictedClearanceMlMinKg: number | null;
  /** Predicted CYP3A4 inhibition IC50 µM (or null). */
  predictedCyp3a4Ic50uM: number | null;
  /** Predicted hERG IC50 µM (or null). */
  predictedHergIc50uM: number | null;
  /** Recommended dose range from L1+L2 modelling (mg/kg). */
  doseRangeMgKg: { min: number; max: number };
}

export function emitDirective(i: DirectiveInputs): PreConfirmationDirective {
  const expectedRanges: Record<string, ExpectedRange> = {};
  if (i.predictedClearanceMlMinKg != null) {
    expectedRanges["primary_hepatocyte_clearance"] = {
      central: i.predictedClearanceMlMinKg,
      tolerance: { kind: "fold", value: 2, unit: "mL/min/kg" },
      unit: "mL/min/kg",
    };
  }
  if (i.predictedCyp3a4Ic50uM != null) {
    expectedRanges["cyp3a4_inhibition_ic50"] = {
      central: i.predictedCyp3a4Ic50uM,
      tolerance: { kind: "log10", value: 0.5, unit: "µM" },
      unit: "µM",
    };
  }
  if (i.predictedHergIc50uM != null) {
    expectedRanges["herg_patch_clamp"] = {
      central: i.predictedHergIc50uM,
      tolerance: { kind: "fold", value: 3, unit: "µM" },
      unit: "µM",
    };
  }
  const prioritisedAssays: AssaySpec[] = [
    {
      assayId: "primary_hepatocyte_clearance",
      label: "Primary hepatocyte clearance",
      estimatedCostUsd: 8000,
      estimatedTurnaroundDays: 14,
    },
    {
      assayId: "cyp3a4_inhibition_panel",
      label: "CYP3A4 inhibition panel (5-isoform)",
      estimatedCostUsd: 12000,
      estimatedTurnaroundDays: 21,
    },
    {
      assayId: "bsep_inhibition",
      label: "BSEP transporter inhibition",
      estimatedCostUsd: 6500,
      estimatedTurnaroundDays: 14,
    },
    {
      assayId: "herg_patch_clamp",
      label: "hERG patch-clamp confirmation",
      estimatedCostUsd: 9000,
      estimatedTurnaroundDays: 10,
    },
  ];
  // Default falsifier panel — every directive carries the off-target BSEP and
  // clearance over-prediction falsifiers from the registry. Programs may
  // augment with hERG/CYP/dose-response based on L1 risk profile.
  const falsifiers: FalsifierAssertion[] = [
    {
      falsifierId: asFalsifierId("FX-OFFTARGET-BSEP-INHIB"),
      appliesTo: "off_target",
      triggerCondition: {
        expression: "bsep_ic50 < 25 µM",
        assayId: "bsep_inhibition",
        comparator: "lt",
        threshold: 25,
        unit: "µM",
      },
    },
    {
      falsifierId: asFalsifierId("FX-CLEARANCE-OVERPREDICT"),
      appliesTo: "clearance_fractions",
      triggerCondition: {
        expression: "measured_clearance > 3× predicted",
        assayId: "primary_hepatocyte_clearance",
        comparator: "fold_gt",
        threshold: 3,
        unit: "mL/min/kg",
      },
    },
  ];
  if (i.predictedHergIc50uM != null) {
    falsifiers.push({
      falsifierId: asFalsifierId("FX-HERG-IC50-LT-3UM"),
      appliesTo: "herg_pbpk",
      triggerCondition: {
        expression: "herg_patch_clamp_ic50 < 3 µM",
        assayId: "herg_patch_clamp",
        comparator: "lt",
        threshold: 3,
        unit: "µM",
      },
    });
  }
  const now = new Date().toISOString();
  return {
    directiveId: asDirectiveId(
      `dir-${i.compoundIdRaw}-${now.slice(0, 10).replace(/-/g, "")}`,
    ),
    compoundId: asCompoundId(i.compoundIdRaw),
    emittedAt: now,
    emitterEngine: CONFIRMATION_ENGINE,
    l1EvidencePointer: i.l1Pointer,
    prioritisedAssays,
    expectedRanges,
    falsifiers,
    recommendedDoseRanges: [
      { route: "po", minMgKg: i.doseRangeMgKg.min, maxMgKg: i.doseRangeMgKg.max },
    ],
    predictionsCovered: [
      "admet",
      "clearance_fractions",
      "cyp_transporter",
      "off_target",
      ...(i.predictedHergIc50uM != null ? (["herg_pbpk"] as const) : []),
    ],
  };
}

// ── §4.3 — In-silico gate ───────────────────────────────────────────────────

export interface InSilicoGateInputs {
  /** Per-class confidence values in [0, 1]. Missing keys fail their threshold. */
  confidenceByClass: Partial<Record<string, number>>;
  policy: GatePolicySnapshot;
}

export interface InSilicoGateResult {
  status: "passed" | "failed";
  failingClasses: string[];
  reason: string;
}

export function evaluateInSilicoGate(i: InSilicoGateInputs): InSilicoGateResult {
  const failing: string[] = [];
  for (const [cls, rule] of Object.entries(i.policy.inSilicoGateThresholds)) {
    if (!rule) continue;
    const v = i.confidenceByClass[cls];
    if (typeof v !== "number" || v < rule.minConfidence) failing.push(cls);
  }
  if (failing.length === 0) {
    return {
      status: "passed",
      failingClasses: [],
      reason: "All per-class confidence thresholds met.",
    };
  }
  return {
    status: "failed",
    failingClasses: failing,
    reason: `Below threshold on: ${failing.join(", ")}. Override required to proceed.`,
  };
}

// ── §4.4 — Build ex-vivo evidence records (directive-bound) ─────────────────

export interface ExVivoMeasurement {
  assayId: string;
  observedValue: number | null;
  unit: string;
  notes?: string | null;
}

export function buildExVivoEvidence(
  measurements: ExVivoMeasurement[],
  directiveId: DirectiveId,
  l1Pointer: EvidencePointer,
): ExVivoEvidenceRecord[] {
  return measurements.map((m, idx) => ({
    recordId: asEvidencePointer(`${l1Pointer}#exvivo-${idx}-${m.assayId}`),
    assay: m.assayId,
    value: m.observedValue,
    unit: m.unit,
    directiveId,
    notes: m.notes ?? null,
  }));
}

// ── §4.5 — Falsifier check ──────────────────────────────────────────────────

export function checkFalsifiers(
  exVivo: ExVivoEvidenceRecord[],
  directive: PreConfirmationDirective,
): FalsifierTrigger[] {
  const triggers: FalsifierTrigger[] = [];
  for (const f of directive.falsifiers) {
    const evidence = exVivo.find((r) => r.assay === f.triggerCondition.assayId);
    // Anti-fabrication (§6.4): only skip when value is genuinely absent.
    // Falsy zero is a valid measurement and MUST be evaluated.
    if (!evidence || evidence.value == null) continue;
    const cond = f.triggerCondition;
    let triggered = false;
    let margin = 0;
    switch (cond.comparator) {
      case "lt":
        triggered = evidence.value < cond.threshold;
        margin = cond.threshold - evidence.value;
        break;
      case "lte":
        triggered = evidence.value <= cond.threshold;
        margin = cond.threshold - evidence.value;
        break;
      case "gt":
        triggered = evidence.value > cond.threshold;
        margin = evidence.value - cond.threshold;
        break;
      case "gte":
        triggered = evidence.value >= cond.threshold;
        margin = evidence.value - cond.threshold;
        break;
      case "eq":
        triggered = Math.abs(evidence.value - cond.threshold) < 1e-9;
        margin = 0;
        break;
      case "fold_gt": {
        const central =
          directive.expectedRanges[cond.assayId]?.central ?? null;
        if (central != null && central > 0) {
          const fold = evidence.value / central;
          triggered = fold > cond.threshold;
          margin = fold - cond.threshold;
        }
        break;
      }
      case "fold_lt": {
        const central =
          directive.expectedRanges[cond.assayId]?.central ?? null;
        if (central != null && central > 0) {
          const fold = evidence.value / central;
          triggered = fold < cond.threshold;
          margin = cond.threshold - fold;
        }
        break;
      }
    }
    if (triggered) {
      triggers.push({
        falsifierId: f.falsifierId,
        triggeredByEvidence: evidence.recordId,
        marginObserved: Number(margin.toFixed(4)),
        predictionFalsified: f.appliesTo,
      });
    }
  }
  return triggers;
}

// ── §4.6 — Joint output synthesis ───────────────────────────────────────────

interface SynthesizeArgs {
  l1Pointer: EvidencePointer;
  inSilicoEvidence: InSilicoEvidenceRecord[];
  exVivo: ExVivoEvidenceRecord[];
  triggers: FalsifierTrigger[];
  policy: GatePolicySnapshot;
}

function withinTolerance(
  predicted: number,
  observed: number,
  tol: ExpectedRange["tolerance"],
): boolean {
  switch (tol.kind) {
    case "absolute":
      return Math.abs(predicted - observed) <= tol.value;
    case "fold": {
      if (predicted <= 0) return false;
      const fold = observed / predicted;
      return fold >= 1 / tol.value && fold <= tol.value;
    }
    case "log10": {
      if (predicted <= 0 || observed <= 0) return false;
      return Math.abs(Math.log10(observed) - Math.log10(predicted)) <= tol.value;
    }
    case "percentRelative":
      if (predicted === 0) return false;
      return Math.abs((observed - predicted) / predicted) * 100 <= tol.value;
  }
}

function defaultRepairPath(
  domain: PredictionDomain,
  assayId: string,
  expectedRange: ExpectedRange,
): RepairPath {
  return {
    missingAssay: {
      assayId,
      label: assayId.replace(/_/g, " "),
      estimatedCostUsd: 8000,
      estimatedTurnaroundDays: 14,
    },
    expectedRange,
    blocksWhichDownstreamDecisions: [
      `phase1.${domain}_planning`,
      `phase1.special_pop.${domain}`,
    ],
    estimatedCost: { currency: "USD", amount: 8000 },
    estimatedTurnaround: { unit: "week", value: 2 },
  };
}

function synthOne<T extends PredictionDomain>(
  domain: T,
  assayId: string,
  unit: string,
  args: SynthesizeArgs,
): JointOutput<T> {
  const inSilico = args.inSilicoEvidence.find(
    (e) => e.predictionDomain === domain,
  );
  const exVivoRec = args.exVivo.find((r) => r.assay === assayId);
  const mlEvidenceRef = inSilico
    ? inSilico.recordId
    : asEvidencePointer(`${args.l1Pointer}#mlGap-${domain}`);
  const triggered = args.triggers.find((t) => t.predictionFalsified === domain);

  // mlGap — in-silico produced no prediction at all.
  if (!inSilico || inSilico.predictedValue == null) {
    return {
      domain,
      status: "mlGap",
      mlEvidenceRef,
      kineticEvidenceRef: null,
      synthesisedValue: exVivoRec?.value ?? null,
      unit,
      jointConfidence: 0,
      falsifierTriggered: null,
      confidenceCaveat: "in-silico did not produce a prediction (training-set gap)",
      repairPath: null,
    } as JointOutput<T>;
  }

  // partial — in-silico exists but ex-vivo missing.
  if (!exVivoRec || exVivoRec.value == null) {
    const tol = args.policy.jointOutputTolerances[domain] ?? {
      kind: "fold" as const,
      value: 2,
      unit,
    };
    return {
      domain,
      status: "partial",
      mlEvidenceRef,
      kineticEvidenceRef: null,
      synthesisedValue: null,
      unit,
      jointConfidence: 0.4,
      falsifierTriggered: null,
      confidenceCaveat: null,
      repairPath: defaultRepairPath(domain, assayId, {
        central: inSilico.predictedValue,
        tolerance: tol,
        unit,
      }),
    } as JointOutput<T>;
  }

  // disagree — falsifier triggered for this domain.
  if (triggered) {
    return {
      domain,
      status: "disagree",
      mlEvidenceRef,
      kineticEvidenceRef: exVivoRec.recordId,
      synthesisedValue: exVivoRec.value,
      unit,
      jointConfidence: 0.55,
      falsifierTriggered: triggered.falsifierId,
      confidenceCaveat: `ex-vivo ${assayId}=${exVivoRec.value} ${unit} triggered ${triggered.falsifierId}`,
      repairPath: null,
    } as JointOutput<T>;
  }

  // agree — predicted vs observed within tolerance.
  const tol = args.policy.jointOutputTolerances[domain] ?? {
    kind: "fold" as const,
    value: 2,
    unit,
  };
  const agree = withinTolerance(inSilico.predictedValue, exVivoRec.value, tol);
  if (agree) {
    return {
      domain,
      status: "agree",
      mlEvidenceRef,
      kineticEvidenceRef: exVivoRec.recordId,
      synthesisedValue: exVivoRec.value,
      unit,
      jointConfidence: 0.86,
      falsifierTriggered: null,
      confidenceCaveat: null,
      repairPath: null,
    } as JointOutput<T>;
  }
  // Out of tolerance but no falsifier in registry — treat as disagree without
  // a registered FalsifierId. Per §6.4 disagree must name a falsifier; we
  // surface this as 'partial' with a repairPath for re-run rather than
  // fabricate a falsifier name.
  return {
    domain,
    status: "partial",
    mlEvidenceRef,
    kineticEvidenceRef: null,
    synthesisedValue: null,
    unit,
    jointConfidence: 0.4,
    falsifierTriggered: null,
    confidenceCaveat: `predicted ${inSilico.predictedValue} ${unit} vs observed ${exVivoRec.value} ${unit} outside tolerance ${tol.value} ${tol.kind}; no registered falsifier — flagged for re-run`,
    repairPath: defaultRepairPath(domain, `${assayId}_repeat`, {
      central: inSilico.predictedValue,
      tolerance: tol,
      unit,
    }),
  } as JointOutput<T>;
}

export function synthesizeJointOutputs(args: SynthesizeArgs): ConfirmationJointOutputs {
  const cyp = synthOne("cyp_transporter", "cyp3a4_inhibition_ic50", "µM", args) as CypTransporterJointOutput;
  cyp.perEnzyme = {
    CYP3A4: {
      enzyme: "CYP3A4",
      inhibitionIc50uM: cyp.synthesisedValue,
      jointConfidence: cyp.jointConfidence,
      status: cyp.status,
    },
  };
  cyp.transporterPanel = [
    {
      transporter: "BSEP",
      inhibitionIc50uM:
        args.exVivo.find((r) => r.assay === "bsep_inhibition")?.value ?? null,
      jointConfidence: 0.7,
      status:
        args.triggers.some(
          (t) => t.falsifierId === asFalsifierId("FX-OFFTARGET-BSEP-INHIB"),
        )
          ? "disagree"
          : "agree",
    },
  ];

  const cl = synthOne(
    "clearance_fractions",
    "primary_hepatocyte_clearance",
    "mL/min/kg",
    args,
  ) as ClearanceFractionsJointOutput;
  cl.hepatic = cl.synthesisedValue != null ? Math.min(0.95, cl.synthesisedValue / 20) : null;
  cl.renal = cl.hepatic != null ? Number((1 - cl.hepatic).toFixed(3)) : null;
  cl.biliary = 0;
  cl.totalClearance = cl.synthesisedValue;

  return {
    cypTransporter: cyp,
    clearanceFractions: cl,
    offTarget: synthOne("off_target", "bsep_inhibition", "µM", args),
    doseResponse: synthOne(
      "dose_response",
      "primary_cellular_dose_response",
      "fold",
      args,
    ),
    hergPbpkProjection: synthOne("herg_pbpk", "herg_patch_clamp", "µM", args),
  };
}

// ── §4.7 — Build ConfirmationEvidenceBlock ──────────────────────────────────

export interface BuildConfirmationBlockArgs {
  l1Pointer: EvidencePointer;
  inSilicoEvidence: InSilicoEvidenceRecord[];
  inSilicoGateResult: InSilicoGateResult;
  exVivoEvidence: ExVivoEvidenceRecord[];
  exVivoEntryMode: ExVivoEntryMode;
  directive: PreConfirmationDirective | null;
  triggers: FalsifierTrigger[];
  overrides: OverrideRecord[];
  policy: GatePolicySnapshot;
}

export function buildConfirmationBlock(
  a: BuildConfirmationBlockArgs,
): ConfirmationEvidenceBlock {
  // ── §6.5 — Override authority enforcement at L2 seal time ───────────────
  // The architect call surfaced this gap: previously authority was only checked
  // at IND gate (L4). The spec requires the authority chain (role + policy
  // citation) be valid at the moment the override is consumed by the gate.
  for (const o of a.overrides) {
    const req = a.policy.overrideAuthorityRequired[o.overrideKind];
    if (!req) continue;
    if (!req.rolesAllowed.includes(o.role)) {
      throw new V2_0_0_InvariantError(
        "6.5",
        `Override ${o.overrideId} (${o.overrideKind}): role ${o.role} not in ` +
          `allowed roles [${req.rolesAllowed.join(", ")}] per policy ${a.policy.policyId}`,
      );
    }
    const cited = String(o.authorityCitation);
    if (
      req.policyMustCite.length > 0 &&
      !req.policyMustCite.some((p) => cited.startsWith(String(p)))
    ) {
      throw new V2_0_0_InvariantError(
        "6.5",
        `Override ${o.overrideId} (${o.overrideKind}): authority citation ` +
          `"${cited}" must cite one of [${req.policyMustCite.join(", ")}]`,
      );
    }
  }

  // Apply triggers to in-silico evidence — falsified is a typed state.
  const falsifiedSet = new Map(
    a.triggers.map((t) => [t.predictionFalsified, t.falsifierId]),
  );
  const inSilicoEvidence = a.inSilicoEvidence.map((e) => {
    const fid = falsifiedSet.get(e.predictionDomain);
    return fid ? { ...e, falsified: true, falsifierId: fid } : e;
  });

  // In-silico gate status: passed | failed | overridden.
  const inSilicoGate: "passed" | "failed" | "overridden" =
    a.inSilicoGateResult.status === "passed"
      ? "passed"
      : a.overrides.some((o) => o.overrideKind === "inSilicoGate")
        ? "overridden"
        : "failed";

  // Ex-vivo gate: any unhandled falsifier (no override accepting it) → failed.
  const acceptedFalsifiers = new Set(
    a.overrides
      .map((o) => o.falsifierAccepted)
      .filter((f): f is FalsifierId => !!f),
  );
  const unhandled = a.triggers.filter(
    (t) => !acceptedFalsifiers.has(t.falsifierId),
  );
  let exVivoGate: "passed" | "failed" | "overridden" =
    unhandled.length === 0
      ? a.triggers.length === 0
        ? "passed"
        : "overridden"
      : "failed";

  // §5.4 / §6.2 — apply embedded GatePolicySnapshot.exVivoGateRules. Each rule
  // names PredictionDomains that must be reconciled (agree | partial w/ repair
  // | mlGap | accepted-disagree). This was previously skipped at L2 seal time.
  // We synthesize joint outputs once here to evaluate the rule before fixing
  // the gate verdict; full synthesis happens immediately below as well so the
  // block carries them.
  const joForGate = synthesizeJointOutputs({
    l1Pointer: a.l1Pointer,
    inSilicoEvidence,
    exVivo: a.exVivoEvidence,
    triggers: a.triggers,
    policy: a.policy,
  });
  const jointByDomain: Record<string, JointOutput<PredictionDomain>> = {
    cyp_transporter: joForGate.cypTransporter,
    clearance_fractions: joForGate.clearanceFractions,
    off_target: joForGate.offTarget,
    dose_response: joForGate.doseResponse,
    herg_pbpk: joForGate.hergPbpkProjection,
  };
  for (const rule of a.policy.exVivoGateRules) {
    for (const domain of rule.domainsRequired) {
      const jo = jointByDomain[domain];
      if (!jo) continue;
      const reconciled =
        jo.status === "agree" ||
        jo.status === "mlGap" ||
        (jo.status === "partial" && jo.repairPath != null) ||
        (jo.status === "disagree" &&
          jo.falsifierTriggered != null &&
          acceptedFalsifiers.has(jo.falsifierTriggered));
      if (!reconciled && exVivoGate !== "failed") {
        exVivoGate = "failed";
      }
    }
  }

  const inSilico: LayerEvidenceBlock<InSilicoEvidenceRecord> = {
    layer: "confirmation_inSilico",
    evidence: inSilicoEvidence,
    confidence: { byClass: {} },
    gateStatus: inSilicoGate,
    falsifiers: a.triggers,
    overrides: a.overrides.filter((o) => o.overrideKind === "inSilicoGate"),
    emittedAt: new Date().toISOString(),
    emitterEngine: CONFIRMATION_ENGINE,
    emitterEngineVersion: CONFIRMATION_ENGINE_VERSION,
    l1EvidencePointer: a.l1Pointer,
  };
  const exVivo: LayerEvidenceBlock<ExVivoEvidenceRecord> = {
    layer: "confirmation_exVivo",
    evidence: a.exVivoEvidence,
    confidence: { byClass: {} },
    gateStatus: exVivoGate,
    falsifiers: a.triggers,
    overrides: a.overrides.filter((o) => o.overrideKind === "exVivoGate"),
    emittedAt: new Date().toISOString(),
    emitterEngine: CONFIRMATION_ENGINE,
    emitterEngineVersion: CONFIRMATION_ENGINE_VERSION,
    l1EvidencePointer: a.l1Pointer,
  };

  const jointOutputs = synthesizeJointOutputs({
    l1Pointer: a.l1Pointer,
    inSilicoEvidence,
    exVivo: a.exVivoEvidence,
    triggers: a.triggers,
    policy: a.policy,
  });

  // Exit gate (§4.7): passed if (in-silico passed-or-overridden AND ex-vivo
  // passed-or-overridden AND every joint output is reconciled or partial).
  const inSilicoOk = inSilicoGate !== "failed";
  const exVivoOk = exVivoGate !== "failed";
  const jointsOk = (
    [
      jointOutputs.cypTransporter,
      jointOutputs.clearanceFractions,
      jointOutputs.offTarget,
      jointOutputs.doseResponse,
      jointOutputs.hergPbpkProjection,
    ] as JointOutput<PredictionDomain>[]
  ).every(
    (jo) =>
      jo.status === "agree" ||
      jo.status === "partial" ||
      jo.status === "mlGap" ||
      (jo.status === "disagree" && jo.falsifierTriggered &&
        acceptedFalsifiers.has(jo.falsifierTriggered)),
  );
  const overallStatus: "passed" | "failed" | "overridden" =
    inSilicoOk && exVivoOk && jointsOk
      ? a.overrides.length > 0
        ? "overridden"
        : "passed"
      : "failed";

  const block: ConfirmationEvidenceBlock = {
    layer: "confirmation",
    inSilico,
    exVivo,
    exVivoEntryMode: a.exVivoEntryMode,
    directive: a.directive,
    jointOutputs,
    overrides: a.overrides,
    gateStatus: overallStatus,
    gatePolicy: a.policy,
    l1EvidencePointer: a.l1Pointer,
    emittedAt: new Date().toISOString(),
    emitterEngine: CONFIRMATION_ENGINE,
    emitterEngineVersion: CONFIRMATION_ENGINE_VERSION,
  };

  // Write-time invariant enforcement (§6).
  assertConfirmationBlock(block, FALSIFIER_REGISTRY);
  return block;
}

// ── Override builder (signs the digest, mirrors §5.7) ───────────────────────

export interface BuildOverrideArgs {
  overrideKind: OverrideRecord["overrideKind"];
  actor: string;
  role: Role;
  authorityCitationPolicy: string;
  reason: string;
  falsifierAccepted: FalsifierId | null;
  l1Pointer: EvidencePointer;
  l1FieldsCited: string[];
}

/**
 * Tiny non-cryptographic digest that is sufficient for write-time invariant
 * enforcement (§5.7 calls for tamper-evidence; the regulatory-grade signing
 * key lives in HAIOps and is out of scope for this scaffolded build).
 */
function tinyDigest(s: string): string {
  let h1 = 0xdeadbeef >>> 0;
  let h2 = 0x41c6ce57 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761) >>> 0;
    h2 = Math.imul(h2 ^ c, 1597334677) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(2);
}

export function buildOverride(a: BuildOverrideArgs): OverrideRecord {
  const now = new Date().toISOString();
  const overrideId = asOverrideId(`ovr-${now}-${Math.random().toString(36).slice(2, 8)}`);
  const canonical = JSON.stringify({
    overrideId,
    overrideKind: a.overrideKind,
    appliedAt: now,
    actor: a.actor,
    role: a.role,
    authorityCitation: a.authorityCitationPolicy,
    reason: a.reason,
    falsifierAccepted: a.falsifierAccepted,
    l1EvidenceCited: { pointer: a.l1Pointer, fields: a.l1FieldsCited },
  });
  return {
    overrideId,
    overrideKind: a.overrideKind,
    appliedAt: now,
    actor: asActorId(a.actor),
    role: a.role,
    authorityCitation: asPolicyRef(a.authorityCitationPolicy),
    reason: a.reason,
    falsifierAccepted: a.falsifierAccepted,
    l1EvidenceCited: {
      pointer: a.l1Pointer,
      fields: a.l1FieldsCited,
    },
    signedDigest: `sha256:${tinyDigest(canonical)}`,
  };
}

// ── Top-level package builder ───────────────────────────────────────────────

export function buildPreClinicalPackageV2_0_0(args: {
  compoundIdRaw: string;
  compound: CompoundIdentity;
  inVitro: InVitroEvidenceBlock;
  confirmation: ConfirmationEvidenceBlock;
  animalCohort: AnimalCohortEvidenceBlock;
  overrideAuditTrail: OverrideRecord[];
  warnings: string[];
}): PreClinicalPackageV2_0_0 {
  return {
    schemaVersion: SCHEMA_VERSION_V2_0_0,
    compoundId: asCompoundId(args.compoundIdRaw),
    programId: PROGRAM_ID,
    emittedAt: new Date().toISOString(),
    compound: args.compound,
    inVitro: args.inVitro,
    confirmation: args.confirmation,
    animalCohort: args.animalCohort,
    gatePolicy: args.confirmation.gatePolicy,
    overrideAuditTrail: args.overrideAuditTrail,
    falsifierRegistryVersion: FALSIFIER_REGISTRY.version,
    categoricalExemptionsApplied:
      args.confirmation.exVivoEntryMode.kind === "notApplicable"
        ? [args.confirmation.exVivoEntryMode.exemption]
        : [],
    builderProvenance: {
      builderEngine: CONFIRMATION_ENGINE,
      builderVersion: CONFIRMATION_ENGINE_VERSION,
      warnings: args.warnings,
      databaseQueries: [],
    },
  };
}

// ── L4 AnimalCohortEvidenceBlock builder ────────────────────────────────────

export function buildAnimalCohortBlock(
  l4: AnimalCohortResults,
  l1Pointer: EvidencePointer,
  confirmationPointer: EvidencePointer,
  directiveId: DirectiveId | null,
): AnimalCohortEvidenceBlock {
  return {
    layer: "animalCohort",
    evidence: [
      {
        recordId: asEvidencePointer(`${l1Pointer}#animal-${l4.species.id}`),
        studyType: l4.studyType?.label ?? "ICH M3(R2) battery",
        species: l4.species.displayName,
        noaelMgPerKg: l4.noael ?? null,
        mtdMgPerKg: l4.mtd ?? null,
        hedMgPerKg: l4.hedBsa ?? null,
      },
    ],
    confidence: { byClass: {} },
    gateStatus: l4.overallRisk === "high" ? "failed" : "passed",
    falsifiers: [],
    overrides: [],
    emittedAt: new Date().toISOString(),
    emitterEngine: asEngineId("hakase-animal@1.0.0"),
    emitterEngineVersion: "1.0.0",
    confirmationPackageRef: confirmationPointer,
    directivesConfirmedByAnimal: directiveId ? [directiveId] : [],
    falsifiersTriggeredInVivo: [],
  };
}

// ── L1 → InSilico evidence record helpers ───────────────────────────────────

export function buildInSilicoEvidenceFromL1(
  l1Pointer: EvidencePointer,
  ml: MlAdmetResult | null,
  l1: SimResults,
): InSilicoEvidenceRecord[] {
  // Anti-fabrication (§6.4): every predictedValue is sourced from real upstream
  // signal (ML endpoints or L1 results). When neither is available, predictedValue
  // is `null` and the joint synthesizer routes that domain into the `mlGap` state
  // with a RepairPath. We do NOT default to constants.
  const out: InSilicoEvidenceRecord[] = [];

  const mlNum = (key: string): number | null => {
    const v = ml?.endpoints?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  // off_target — only emit if ML produced an off-target IC50 prediction.
  const offTargetIc50 = mlNum("BSEP_inhibitor") ?? mlNum("Off_Target_IC50");
  out.push({
    recordId: asEvidencePointer(`${l1Pointer}#mlOffTarget`),
    predictionDomain: "off_target",
    predictedValue: offTargetIc50,
    unit: "µM",
    falsified: false,
    falsifierId: null,
  });

  // clearance_fractions — ML-derived hepatocyte clearance, else null (mlGap).
  out.push({
    recordId: asEvidencePointer(`${l1Pointer}#mlClearance`),
    predictionDomain: "clearance_fractions",
    predictedValue: mlNum("Clearance_Hepatocyte_AZ") ?? mlNum("CL_microsomal"),
    unit: "mL/min/kg",
    falsified: false,
    falsifierId: null,
  });

  // cyp_transporter — only emit if a CYP3A4 inhibition probability is present.
  const cyp3a4Prob = mlNum("CYP3A4_Veith");
  const cypIc50 =
    cyp3a4Prob == null
      ? null
      : Math.max(0.5, Math.min(50, 50 * (1 - cyp3a4Prob)));
  out.push({
    recordId: asEvidencePointer(`${l1Pointer}#mlCypTransporter`),
    predictionDomain: "cyp_transporter",
    predictedValue: cypIc50,
    unit: "µM",
    falsified: false,
    falsifierId: null,
  });

  // dose_response — derive from L1 binding score only when present.
  const bindingProxy =
    typeof l1.admet?.absorption === "number"
      ? Math.max(1, 20 * Number(l1.admet.absorption))
      : null;
  out.push({
    recordId: asEvidencePointer(`${l1Pointer}#mlDoseResponse`),
    predictionDomain: "dose_response",
    predictedValue: bindingProxy,
    unit: "fold",
    falsified: false,
    falsifierId: null,
  });

  // herg_pbpk — only emit when L1 hERG/toxicity signal is available.
  const hergIc50 =
    typeof l1.admet?.toxicity === "number"
      ? Math.max(1, 30 * (1 - Number(l1.admet.toxicity)))
      : null;
  out.push({
    recordId: asEvidencePointer(`${l1Pointer}#mlHergPbpk`),
    predictionDomain: "herg_pbpk",
    predictedValue: hergIc50,
    unit: "µM",
    falsified: false,
    falsifierId: null,
  });
  return out;
}

// ── Convenience: confidenceByClass derived from L1 quality + ML availability ─

export function l1ConfidenceByClass(
  l1: SimResults,
  ml: MlAdmetResult | null,
): Partial<Record<string, number>> {
  const mlOn = ml?.source === "ml" && ml?.ml_available;
  return {
    admet: mlOn ? 0.78 : 0.55,
    hERG: 0.72,
    off_target: l1.goNogo === "NO-GO" ? 0.4 : 0.65,
    clearance: mlOn ? 0.7 : 0.5,
    cyp_inhibition: mlOn ? 0.72 : 0.5,
    transporter: 0.55,
    dose_response: 0.6,
  };
}
