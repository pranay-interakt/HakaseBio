import type { InVitroResults } from "./inVitroSim";

export type SafetyFlagType =
  | "cardiac"
  | "hepatotoxicity"
  | "ddi"
  | "narrow-margin"
  | "high-grade-ae"
  | "subgroup-disparity";

export type SafetyFlagSeverity = "critical" | "major" | "warning";

export interface SafetyFlag {
  type: SafetyFlagType;
  severity: SafetyFlagSeverity;
  label: string;
  detail: string;
  originLayer: number;
  ichReference?: string;
  reviewRequired: boolean;
  acknowledged: boolean;
  value?: string;
}

export interface SafetyFlagState {
  flags: SafetyFlag[];
  overrides: SafetyOverride[];
}

export interface SafetyOverride {
  fromLayer: number;
  toLayer: number;
  verdict: string;
  timestamp: string;
  reason?: string;
}

export interface ProvenanceRecord {
  engineVersion: string;
  engineFile: string;
  timestamp: string;
  inputSource: string;
  smiles?: string;
  rdkitVersion: string;
  databaseQueries: DatabaseQueryRecord[];
  randomSeed?: number;
}

export interface DatabaseQueryRecord {
  database: string;
  status: "success" | "failed" | "cached" | "skipped";
  timestamp?: string;
  resultCount?: number;
  version?: string;
  staleness?: string;
}

export function computeLayer1Flags(iv: InVitroResults): SafetyFlag[] {
  const flags: SafetyFlag[] = [];

  if (iv.herg.ic50_uM < 10) {
    flags.push({
      type: "cardiac",
      severity: iv.herg.riskCategory === "High" ? "critical" : "major",
      label: "Cardiac Safety",
      detail: `hERG IC50 = ${iv.herg.ic50_uM.toFixed(2)} µM (safety margin ${iv.herg.safetyMargin.toFixed(0)}×). ${iv.herg.patchClampResult}. QT prolongation risk requires ICH S7B evaluation before advancing.`,
      originLayer: 1,
      ichReference: "ICH S7B",
      reviewRequired: true,
      acknowledged: false,
      value: `${iv.herg.ic50_uM.toFixed(2)} µM`,
    });
  }

  const hepatoAlerts = iv.bioactivation.mechanisticToxicities.filter(
    t => t.organ.toLowerCase().includes("liver") && t.confidence > 0.7
  );
  if (hepatoAlerts.length > 0) {
    const top = hepatoAlerts.sort((a, b) => b.confidence - a.confidence)[0];
    flags.push({
      type: "hepatotoxicity",
      severity: top.confidence > 0.8 ? "critical" : "major",
      label: "Hepatotoxicity Alert",
      detail: `Structural alert: ${top.structuralAlert} (${top.aopId}, confidence ${(top.confidence * 100).toFixed(0)}%). Mechanism: ${top.aopChain[top.aopChain.length - 1]}. ALT/AST monitoring required in preclinical studies.`,
      originLayer: 1,
      ichReference: "ICH M3(R2)",
      reviewRequired: true,
      acknowledged: false,
      value: `${(top.confidence * 100).toFixed(0)}% confidence`,
    });
  }

  const highCypHits = Object.entries(iv.metabolicStability.cypInhibition).filter(
    ([, data]) => data.ic50_uM < 5
  );
  if (highCypHits.length > 0) {
    const enzymes = highCypHits.map(([name, data]) => `${name} (${data.ic50_uM} µM)`).join(", ");
    flags.push({
      type: "ddi",
      severity: highCypHits.length >= 3 ? "critical" : "major",
      label: "Drug-Drug Interaction Risk",
      detail: `CYP inhibition below 5 µM threshold: ${enzymes}. Concomitant medication restrictions may apply. Time-dependent inhibition (TDI) assay recommended.`,
      originLayer: 1,
      ichReference: "FDA DDI Guidance",
      reviewRequired: highCypHits.length >= 2,
      acknowledged: false,
      value: `${highCypHits.length} enzyme(s)`,
    });
  }

  return flags;
}

export interface AnimalSimResultsMinimal {
  safetyMargin?: number;
  noael?: number;
  hedConservative?: number;
}

export function computeLayer2Flags(animalResults: AnimalSimResultsMinimal): SafetyFlag[] {
  const flags: SafetyFlag[] = [];

  const margin = animalResults.safetyMargin ?? 999;
  if (margin < 3) {
    flags.push({
      type: "narrow-margin",
      severity: margin < 1.5 ? "critical" : "major",
      label: "Narrow Safety Margin",
      detail: `NOAEL/HED safety margin = ${margin.toFixed(1)}× (threshold: 3×). Conservative dose escalation required in clinical development. Enhanced safety monitoring protocol mandatory.`,
      originLayer: 2,
      ichReference: "ICH M3(R2)",
      reviewRequired: true,
      acknowledged: false,
      value: `${margin.toFixed(1)}×`,
    });
  }

  return flags;
}

export interface CohortResultsMinimal {
  grade3PlusRate?: number;
  subgroupBreakdown?: Array<{ label: string; rate: number; n: number }>;
  overallAeRate?: number;
}

export function computeLayer3Flags(cohortResults: CohortResultsMinimal): SafetyFlag[] {
  const flags: SafetyFlag[] = [];

  const grade3 = cohortResults.grade3PlusRate ?? 0;
  if (grade3 > 0.15) {
    flags.push({
      type: "high-grade-ae",
      severity: grade3 > 0.25 ? "critical" : "major",
      label: "High-Grade AE Risk",
      detail: `Grade ≥3 adverse event incidence = ${(grade3 * 100).toFixed(1)}% (threshold: 15%). DSMB requirement, stopping rules, and enhanced safety monitoring required in trial design.`,
      originLayer: 3,
      ichReference: "ICH E6(R2)",
      reviewRequired: true,
      acknowledged: false,
      value: `${(grade3 * 100).toFixed(1)}%`,
    });
  }

  const overallAe = cohortResults.overallAeRate ?? 0;
  if (overallAe > 0 && cohortResults.subgroupBreakdown) {
    const disparities = cohortResults.subgroupBreakdown.filter(
      sg => sg.rate > overallAe * 2
    );
    if (disparities.length > 0) {
      const groups = disparities.map(d => d.label).join(", ");
      flags.push({
        type: "subgroup-disparity",
        severity: "major",
        label: "Subgroup Safety Disparity",
        detail: `AE rate >2× overall cohort in: ${groups}. Stratified randomization required. Subgroup-specific inclusion/exclusion criteria recommended.`,
        originLayer: 3,
        ichReference: "ICH E9(R1)",
        reviewRequired: true,
        acknowledged: false,
        value: `${disparities.length} subgroup(s)`,
      });
    }
  }

  return flags;
}

export function getFlagsForLayer(allFlags: SafetyFlag[], targetLayer: number): SafetyFlag[] {
  return allFlags.filter(f => f.originLayer < targetLayer);
}

export function getActiveFlags(allFlags: SafetyFlag[], currentLayer: number): SafetyFlag[] {
  return allFlags.filter(f => f.originLayer <= currentLayer);
}

export function hasReviewRequired(flags: SafetyFlag[]): boolean {
  return flags.some(f => f.reviewRequired && !f.acknowledged);
}

export function getUnacknowledgedCritical(flags: SafetyFlag[]): SafetyFlag[] {
  return flags.filter(f => f.severity === "critical" && !f.acknowledged);
}

export function createProvenance(
  engineFile: string,
  inputSource: string,
  smiles?: string
): ProvenanceRecord {
  return {
    engineVersion: "1.0.0-haiopscompliant",
    engineFile,
    timestamp: new Date().toISOString(),
    inputSource,
    smiles,
    rdkitVersion: "2024.03.5",
    databaseQueries: [],
    randomSeed: smiles ? hashSmiles(smiles) : undefined,
  };
}

function hashSmiles(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export const SAFETY_FLAG_COLORS: Record<SafetyFlagSeverity, { bg: string; text: string; border: string; glow: string }> = {
  critical: { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", glow: "bg-red-400 shadow-red-400" },
  major:    { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30", glow: "bg-amber-400 shadow-amber-400" },
  warning:  { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30", glow: "bg-yellow-400 shadow-yellow-400" },
};

export const SAFETY_FLAG_ICONS: Record<SafetyFlagType, string> = {
  cardiac: "Heart",
  hepatotoxicity: "Liver",
  ddi: "Pill",
  "narrow-margin": "Shield",
  "high-grade-ae": "AlertTriangle",
  "subgroup-disparity": "Users",
};

export interface HAIOpsContext {
  flags: SafetyFlag[];
  overrides: SafetyOverride[];
  provenance: Partial<Record<number, ProvenanceRecord>>;
  dbStatus: Record<string, DatabaseQueryRecord>;
  reviewAcknowledged: boolean;
}

export function createHAIOpsContext(): HAIOpsContext {
  return {
    flags: [],
    overrides: [],
    provenance: {},
    dbStatus: {},
    reviewAcknowledged: false,
  };
}

export function mergeLayerProvenance(
  ctx: HAIOpsContext,
  layer: number,
  prov: ProvenanceRecord
): HAIOpsContext {
  const next = { ...ctx, provenance: { ...ctx.provenance, [layer]: prov } };
  const newDbStatus = { ...next.dbStatus };
  for (const q of prov.databaseQueries) {
    newDbStatus[q.database] = q;
  }
  next.dbStatus = newDbStatus;
  return next;
}

export function mergeLayerFlags(
  ctx: HAIOpsContext,
  layer: number,
  newFlags: SafetyFlag[]
): HAIOpsContext {
  const updatedFlags = [...ctx.flags.filter(f => f.originLayer !== layer), ...newFlags];
  const hasUnacknowledged = updatedFlags.some(f => f.reviewRequired && !f.acknowledged);
  return {
    ...ctx,
    flags: updatedFlags,
    reviewAcknowledged: hasUnacknowledged ? false : ctx.reviewAcknowledged,
  };
}

export function addOverride(ctx: HAIOpsContext, override: SafetyOverride): HAIOpsContext {
  return { ...ctx, overrides: [...ctx.overrides, override] };
}

export function acknowledgeReview(ctx: HAIOpsContext): HAIOpsContext {
  return {
    ...ctx,
    reviewAcknowledged: true,
    flags: ctx.flags.map(f => ({ ...f, acknowledged: true })),
  };
}

export function getDbDegradationWarnings(ctx: HAIOpsContext): DatabaseQueryRecord[] {
  return Object.values(ctx.dbStatus).filter(q => q.status === "failed" || q.status === "cached");
}

export function serializeForExport(ctx: HAIOpsContext): Record<string, unknown> {
  return {
    _haiopsMeta: {
      version: "1.0.0",
      framework: "HAIOps",
      exportTimestamp: new Date().toISOString(),
    },
    _safetyFlags: ctx.flags.map(f => ({
      type: f.type,
      severity: f.severity,
      label: f.label,
      originLayer: f.originLayer,
      ichReference: f.ichReference,
      value: f.value,
      reviewRequired: f.reviewRequired,
      acknowledged: f.acknowledged,
    })),
    _overrides: ctx.overrides,
    _provenance: ctx.provenance,
    _dbStatus: ctx.dbStatus,
    _reviewAcknowledged: ctx.reviewAcknowledged,
  };
}
