import type { InVitroResults } from "./inVitroSim";
import type { SimResults } from "./admet";
import { canonicalJSON, fnv1a32, fingerprint64, sha256Hex, composeSeed } from "./uncertainty";
import {
  type AuditChain,
  type AuditAttestation,
  type AuditEvent,
  appendEvent,
  createAuditChain,
  Events,
  verifyChain,
  findAcknowledgement,
  findActiveOverride,
} from "./haiopsAudit";
import {
  checkModelDrift,
  lookupModel,
  type RegisteredModel,
} from "./modelRegistry";

export type SafetyFlagType =
  | "cardiac"
  | "hepatotoxicity"
  | "ddi"
  | "narrow-margin"
  | "high-grade-ae"
  | "subgroup-disparity"
  /** Prediction lands outside the model's published applicability domain. */
  | "applicability-domain"
  /** External database query failed or returned stale data. */
  | "data-degradation"
  /** Downstream-watch flag automatically raised after a NO-GO override. */
  | "override-watch"
  /** Registered model's reproducibility hash changed without a version bump. */
  | "model-drift";

export type SafetyFlagSeverity = "critical" | "major" | "warning";

export interface SafetyFlag {
  /**
   * Stable content-derived ID — same triggering condition on the same input
   * always produces the same id, so duplicates are de-duplicated and audit
   * events can reference a flag without ambiguity. Assigned by
   * `assignFlagId` if not already set.
   */
  id?: string;
  type: SafetyFlagType;
  severity: SafetyFlagSeverity;
  label: string;
  detail: string;
  originLayer: number;
  ichReference?: string;
  reviewRequired: boolean;
  acknowledged: boolean;
  value?: string;
  /** Optional: the modelVersion that produced this flag (from modelRegistry). */
  modelVersion?: string;
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
  /**
   * Free-text rationale. Optional on the legacy interface for backwards
   * compatibility; the new `recordOverride` helper requires it.
   */
  reason?: string;
  /** Stable id of the attesting actor (HAIOps audit). */
  actorId?: string;
  /** Hash of the corresponding audit event. */
  auditEventHash?: string;
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
  /**
   * SHA-256 content hash of the canonical-JSON serialization of the layer's
   * scientific output. Stable across runs of the same code on the same
   * inputs; used as the L1 `EvidencePointer` by Layer 2.
   *
   * Optional because it is computed asynchronously (SubtleCrypto) and
   * recorded after the synchronous simulation has completed.
   */
  evidenceHash?: string;
  /** Synchronous 64-bit fingerprint of the same canonical form. */
  fingerprint?: string;
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
  smiles?: string,
): ProvenanceRecord {
  return {
    engineVersion: "1.1.0-l1-validated",
    engineFile,
    timestamp: new Date().toISOString(),
    inputSource,
    smiles,
    rdkitVersion: "2025.03.4",
    databaseQueries: [],
    randomSeed: smiles ? composeSeed(smiles) : undefined,
  };
}

/**
 * Canonical-form payload for a Layer 1 evidence pointer. Includes only the
 * fields that are scientifically load-bearing — timestamps and UI-only data
 * are excluded so two runs of the same code on the same SMILES produce the
 * same hash.
 */
export function layer1EvidencePayload(
  smiles: string,
  uniprotId: string,
  inVitro: InVitroResults,
  sim: SimResults,
): unknown {
  return {
    schemaVersion: "l1.evidence/1",
    smiles,
    uniprotId,
    seed: inVitro.seed,
    doseResponse: {
      pIC50: inVitro.estimates.pIC50.value,
      pIC50Sd: inVitro.estimates.pIC50.sd,
      ic50nM: inVitro.estimates.ic50nM.value,
      ic50CI95: inVitro.estimates.ic50nM.ci95,
      hill: inVitro.doseResponse.hillCoefficient,
      emax: inVitro.doseResponse.maxInhibition,
    },
    admet: sim.admet,
    binding: {
      primaryIC50: sim.binding.primaryIC50,
      primaryKd: sim.binding.primaryKd,
      primaryKi: sim.binding.primaryKi,
      ci95: sim.binding.primaryIC50CI95,
    },
    permeability: {
      caco2: inVitro.permeability.caco2Papp,
      caco2CI95: inVitro.estimates.caco2PappE6.ci95,
    },
    metabolism: {
      microsomalCLint: inVitro.metabolicStability.microsomalCLint,
      microsomalCI95: inVitro.estimates.microsomalClint.ci95,
      cypIc50: inVitro.metabolicStability.cypInhibition,
    },
    herg: {
      ic50uM: inVitro.herg.ic50_uM,
      ci95: inVitro.estimates.hergIc50uM.ci95,
    },
    qed: sim.qed,
    saScore: sim.saScore,
    lipinski: sim.lipinski,
    goNogo: sim.goNogo,
    modelSources: {
      qed: "Bickerton et al., Nat. Chem. 4:90 (2012)",
      sa: "Ertl & Schuffenhauer, J. Cheminform. 1:8 (2009)",
      absorption: "Egan et al., J. Med. Chem. 43:3867 (2000)",
      caco2: "Hou et al., J. Chem. Inf. Model. 47:208 (2007)",
      clint: "Lewis, Drug Metab. Rev. 35:1 (2003) / Riley et al. DMD 33:1304 (2005)",
      herg: "Aronov, J. Med. Chem. 51:6917 (2008)",
      ppb: "Lobell & Sivarajah, Mol. Diversity 7:69 (2003)",
      cyp: "Veith et al., Nat. Biotechnol. 27:1050 (2009)",
      vd: "Lombardo et al., J. Med. Chem. 56:3924 (2013)",
    },
  };
}

/**
 * Compute the synchronous 64-bit fingerprint for the L1 evidence payload.
 * Use this when an async hash is undesirable (e.g. inline rendering).
 */
export function layer1EvidenceFingerprint(payload: unknown): string {
  return fingerprint64(canonicalJSON(payload));
}

/**
 * Compute the canonical SHA-256 of the L1 evidence payload — used as the
 * `evt://l1/<sha256>` EvidencePointer consumed by Layer 2.
 */
export async function layer1EvidenceHash(payload: unknown): Promise<string> {
  return sha256Hex(canonicalJSON(payload));
}

/**
 * Update a ProvenanceRecord with the evidence fingerprint + hash for a
 * specific InVitroResults / SimResults pair. Fingerprint is set synchronously;
 * the SHA-256 hash resolves asynchronously and the returned promise yields
 * the fully-populated record.
 */
export function attachLayer1Evidence(
  prov: ProvenanceRecord,
  smiles: string,
  uniprotId: string,
  inVitro: InVitroResults,
  sim: SimResults,
): { provenance: ProvenanceRecord; hashPromise: Promise<ProvenanceRecord> } {
  const payload = layer1EvidencePayload(smiles, uniprotId, inVitro, sim);
  const canonical = canonicalJSON(payload);
  const fingerprint = fingerprint64(canonical);
  const provenance: ProvenanceRecord = { ...prov, fingerprint };
  const hashPromise = sha256Hex(canonical).then((h) => ({
    ...provenance,
    evidenceHash: h,
  }));
  return { provenance, hashPromise };
}

// Internal compatibility shim — preserved so any caller still passing the
// classic Java-polynomial `hashSmiles` continues to work; new code should
// import `composeSeed` / `fnv1a32` from `./uncertainty`.
function hashSmiles(s: string): number { return fnv1a32(s); }
export { hashSmiles as _legacyHashSmiles };

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
  "applicability-domain": "Crosshair",
  "data-degradation": "WifiOff",
  "override-watch": "Eye",
  "model-drift": "GitCommit",
};

export interface HAIOpsContext {
  flags: SafetyFlag[];
  overrides: SafetyOverride[];
  provenance: Partial<Record<number, ProvenanceRecord>>;
  dbStatus: Record<string, DatabaseQueryRecord>;
  reviewAcknowledged: boolean;
  /** Append-only, hash-chained audit log (initialised at session start). */
  audit: AuditChain;
  /** Stable session id — same value used in evidence pointer derivations. */
  sessionId: string;
}

export function createHAIOpsContext(opts: { sessionId?: string; molName?: string; smiles?: string } = {}): HAIOpsContext {
  const sessionId = opts.sessionId ?? `sess_${Date.now().toString(36)}_${fnv1a32(Math.random().toString()).toString(16)}`;
  const audit = appendEvent(createAuditChain(), Events.sessionStarted({
    sessionId,
    molName: opts.molName,
    smiles: opts.smiles,
  }));
  return {
    flags: [],
    overrides: [],
    provenance: {},
    dbStatus: {},
    reviewAcknowledged: false,
    audit,
    sessionId,
  };
}

/**
 * Derive a stable, content-addressed id for a flag. The id depends only on
 * `type`, `originLayer`, and `value`/`label`, so the same triggering
 * condition on the same input always produces the same id.
 */
export function assignFlagId(flag: SafetyFlag): SafetyFlag {
  if (flag.id) return flag;
  const id = "flag_" + fnv1a32(`${flag.type}|${flag.originLayer}|${flag.label}|${flag.value ?? ""}`)
    .toString(16).padStart(8, "0");
  return { ...flag, id };
}

export function mergeLayerProvenance(
  ctx: HAIOpsContext,
  layer: number,
  prov: ProvenanceRecord,
): HAIOpsContext {
  const newDbStatus = { ...ctx.dbStatus };
  let audit = ctx.audit;
  for (const q of prov.databaseQueries) {
    const wasGood = ctx.dbStatus[q.database]?.status === "success";
    newDbStatus[q.database] = q;
    if (q.status !== "success" && q.status !== "skipped" && wasGood !== false) {
      audit = appendEvent(audit, Events.dbDegraded(q.database, q.status as "failed" | "cached" | "skipped"));
    }
  }
  // Check declared models against the registry; emit drift events on mismatch.
  if (prov.engineFile) {
    // engineFile carries an opaque hint to the model; we can't pull every
    // modelVersion from the provenance record here — drift checks happen
    // explicitly via `checkAndRecordModelDrift` below.
  }
  let nextProv: ProvenanceRecord = prov;
  if (prov.evidenceHash || prov.fingerprint) {
    audit = appendEvent(audit, Events.evidenceSigned(
      layer,
      prov.evidenceHash ?? "(pending)",
      prov.fingerprint ?? "(pending)",
      [],
    ));
    nextProv = prov;
  }
  return {
    ...ctx,
    provenance: { ...ctx.provenance, [layer]: nextProv },
    dbStatus: newDbStatus,
    audit,
  };
}

export function mergeLayerFlags(
  ctx: HAIOpsContext,
  layer: number,
  newFlags: SafetyFlag[],
): HAIOpsContext {
  const withIds = newFlags.map(assignFlagId);
  const existingIds = new Set(ctx.flags.filter(f => f.originLayer === layer).map(f => f.id));
  const previouslyRaised = new Set(ctx.audit.events
    .filter(e => e.type === "flag_raised")
    .map(e => e.subjectId));

  let audit = ctx.audit;
  for (const f of withIds) {
    if (!previouslyRaised.has(f.id) && !existingIds.has(f.id)) {
      audit = appendEvent(audit, Events.flagRaised({
        id: f.id!,
        type: f.type,
        severity: f.severity,
        label: f.label,
        originLayer: f.originLayer,
        value: f.value,
      }));
    }
  }

  const updatedFlags = [...ctx.flags.filter(f => f.originLayer !== layer), ...withIds];
  const hasUnacknowledged = updatedFlags.some(f => f.reviewRequired && !f.acknowledged);
  return {
    ...ctx,
    flags: updatedFlags,
    reviewAcknowledged: hasUnacknowledged ? false : ctx.reviewAcknowledged,
    audit,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// HAIOps governance — attestation-gated mutations
// ────────────────────────────────────────────────────────────────────────────

/**
 * Acknowledge a *single* flag with attestation. Replaces the legacy global
 * `acknowledgeReview` for production use: HAIOps requires accountability
 * per finding, not a single bulk dismiss.
 *
 * Throws if the attestation reason is empty — an empty reason is an
 * accountability bypass and is rejected at the type / runtime boundary.
 */
export function acknowledgeFlag(
  ctx: HAIOpsContext,
  flagId: string,
  attestation: AuditAttestation,
): HAIOpsContext {
  if (!attestation.reason || attestation.reason.trim().length === 0) {
    throw new Error("HAIOps: acknowledgement requires a non-empty reason");
  }
  const target = ctx.flags.find(f => f.id === flagId);
  if (!target) return ctx;
  const updatedFlags = ctx.flags.map(f => f.id === flagId ? { ...f, acknowledged: true } : f);
  const audit = appendEvent(ctx.audit, Events.flagAcknowledged(flagId, target.originLayer, attestation));
  const allCriticalAck = updatedFlags.filter(f => f.reviewRequired).every(f => f.acknowledged);
  return {
    ...ctx,
    flags: updatedFlags,
    reviewAcknowledged: allCriticalAck,
    audit,
  };
}

/**
 * Record an override of a Go/No-Go verdict with attestation. Side-effect:
 * automatically raises an "override-watch" SafetyFlag on the next layer so
 * the override is visible (and non-droppable) downstream — overrides do not
 * silently disappear once acknowledged.
 */
export function recordOverride(
  ctx: HAIOpsContext,
  override: SafetyOverride,
  fromVerdict: string,
  attestation: AuditAttestation,
): HAIOpsContext {
  if (!attestation.reason || attestation.reason.trim().length === 0) {
    throw new Error("HAIOps: verdict override requires a non-empty reason");
  }
  const flagsAtTime = ctx.flags.filter(f => f.originLayer <= override.fromLayer).map(f => f.id ?? f.label);
  const auditAfter = appendEvent(ctx.audit, Events.verdictOverridden(
    fromVerdict, override.verdict, override.fromLayer, attestation, flagsAtTime as string[],
  ));
  const enrichedOverride: SafetyOverride = {
    ...override,
    actorId: attestation.actor.id,
    auditEventHash: auditAfter.events[auditAfter.events.length - 1]?.hash,
    reason: attestation.reason,
  };
  // Auto-raise a downstream-watch flag so subsequent layers see the override.
  const watchFlag: SafetyFlag = assignFlagId({
    type: "override-watch",
    severity: "warning",
    label: `Override watch — L${override.fromLayer} ${fromVerdict} → ${override.verdict}`,
    detail: `Operator overrode the L${override.fromLayer} verdict (${fromVerdict} → ${override.verdict}) with rationale: "${attestation.reason}". This finding persists into all downstream layers and cannot be silently dropped.`,
    originLayer: override.toLayer,
    reviewRequired: true,
    acknowledged: false,
    value: `${fromVerdict} → ${override.verdict}`,
  });
  return {
    ...ctx,
    overrides: [...ctx.overrides, enrichedOverride],
    flags: [...ctx.flags, watchFlag],
    audit: appendEvent(auditAfter, Events.flagRaised({
      id: watchFlag.id!,
      type: watchFlag.type,
      severity: watchFlag.severity,
      label: watchFlag.label,
      originLayer: watchFlag.originLayer,
      value: watchFlag.value,
    })),
  };
}

/**
 * Legacy alias retained for callers that don't yet use the attestation API.
 * NOT recommended for new code — see `acknowledgeFlag` and `recordOverride`.
 */
export function acknowledgeReview(ctx: HAIOpsContext): HAIOpsContext {
  return {
    ...ctx,
    reviewAcknowledged: true,
    flags: ctx.flags.map(f => ({ ...f, acknowledged: true })),
  };
}

/** Legacy alias for the unattested override path; new code should use `recordOverride`. */
export function addOverride(ctx: HAIOpsContext, override: SafetyOverride): HAIOpsContext {
  return { ...ctx, overrides: [...ctx.overrides, override] };
}

// ────────────────────────────────────────────────────────────────────────────
// Automatic flag generators
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert applicability-domain breaches in an InVitroResults / SimResults
 * bundle into structured SafetyFlags. Out-of-domain ⇒ `major`; near-boundary
 * ⇒ `warning`. Critical-tier models always produce a `reviewRequired` flag.
 */
export function flagsFromApplicabilityDomain(
  inVitro: InVitroResults,
  layer = 1,
): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  const items: Array<{ name: string; modelVersion: string; status: string; notes?: string[] }> = [
    { name: "Caco-2 permeability", modelVersion: inVitro.estimates.caco2PappE6.modelVersion, status: inVitro.estimates.caco2PappE6.applicabilityDomain, notes: inVitro.estimates.caco2PappE6.domainNotes },
    { name: "Microsomal CLint",    modelVersion: inVitro.estimates.microsomalClint.modelVersion, status: inVitro.estimates.microsomalClint.applicabilityDomain, notes: inVitro.estimates.microsomalClint.domainNotes },
    { name: "hERG IC50",           modelVersion: inVitro.estimates.hergIc50uM.modelVersion,      status: inVitro.estimates.hergIc50uM.applicabilityDomain,      notes: inVitro.estimates.hergIc50uM.domainNotes },
    { name: "Free fraction (fu)",  modelVersion: inVitro.estimates.fuPercent.modelVersion,       status: inVitro.estimates.fuPercent.applicabilityDomain,       notes: inVitro.estimates.fuPercent.domainNotes },
    { name: "pIC50 posterior",     modelVersion: inVitro.estimates.pIC50.modelVersion,           status: inVitro.estimates.pIC50.applicabilityDomain,           notes: inVitro.estimates.pIC50.domainNotes },
    { name: "Oral absorption",     modelVersion: inVitro.estimates.pAbsorbed.modelVersion,        status: inVitro.estimates.pAbsorbed.applicabilityDomain,        notes: inVitro.estimates.pAbsorbed.domainNotes },
  ];
  for (const it of items) {
    if (it.status === "in_domain") continue;
    const reg = lookupModel(it.modelVersion);
    const criticalModel = reg?.riskTier === "critical";
    const oop = it.status === "out_of_domain";
    flags.push(assignFlagId({
      type: "applicability-domain",
      severity: oop ? "major" : "warning",
      label: `${it.name} — ${oop ? "out-of-domain" : "near boundary"}`,
      detail: `Input descriptors lie ${oop ? "outside" : "near the edge of"} the published training distribution for ${reg?.displayName ?? it.modelVersion}. ${it.notes?.join("; ") ?? "Review for extrapolation."}`,
      originLayer: layer,
      reviewRequired: oop && criticalModel,
      acknowledged: false,
      value: oop ? "out of domain" : "near boundary",
      modelVersion: it.modelVersion,
    }));
  }
  return flags;
}

/**
 * Convert failed/cached/skipped database queries into structured SafetyFlags.
 * Failed = `warning`, cached = `warning` with staleness note, skipped silent.
 */
export function flagsFromDatabaseDegradation(ctx: HAIOpsContext): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  for (const q of Object.values(ctx.dbStatus)) {
    if (q.status === "success" || q.status === "skipped") continue;
    flags.push(assignFlagId({
      type: "data-degradation",
      severity: "warning",
      label: `Data source unavailable: ${q.database}`,
      detail: `External database ${q.database} returned status "${q.status}"${q.staleness ? ` (${q.staleness} stale)` : ""}. Predictions that depend on this source are flagged for review.`,
      originLayer: 0,
      reviewRequired: false,
      acknowledged: false,
      value: q.status,
    }));
  }
  return flags;
}

/**
 * Check a single model's reproducibility hash against the registry and emit
 * a model-drift SafetyFlag (and audit event) if it has drifted.
 */
export function checkAndRecordModelDrift(
  ctx: HAIOpsContext,
  modelVersion: string,
  observedReproHash: string,
  inCriticalPath: boolean,
): HAIOpsContext {
  const result = checkModelDrift(modelVersion, inCriticalPath, observedReproHash);
  if (result.ok) return ctx;
  const audit = appendEvent(ctx.audit, Events.modelDriftDetected(
    modelVersion,
    result.reason ?? "unknown",
    result.registered?.reproducibilityHash ?? "(missing)",
    observedReproHash,
  ));
  const flag = assignFlagId({
    type: "model-drift",
    severity: inCriticalPath ? "critical" : "major",
    label: `Model drift: ${result.registered?.displayName ?? modelVersion}`,
    detail: `Reproducibility hash mismatch for ${modelVersion}: registry=${result.registered?.reproducibilityHash ?? "?"}, observed=${observedReproHash}. Reason: ${result.reason}. ${inCriticalPath ? "Critical-path model — predictions blocked." : "Advisory — review pending."}`,
    originLayer: 0,
    reviewRequired: true,
    acknowledged: false,
    value: result.reason,
    modelVersion,
  });
  return { ...ctx, audit, flags: [...ctx.flags, flag] };
}

// ────────────────────────────────────────────────────────────────────────────
// HAIOps governance summary  (used by UI and export)
// ────────────────────────────────────────────────────────────────────────────

export interface HAIOpsSummary {
  /** Number of unacknowledged critical flags. */
  blockingFindings: number;
  /** Boolean: chain integrity intact? */
  auditOk: boolean;
  /** Number of audit events (excluding the genesis session_started). */
  auditEvents: number;
  /** Number of registered models referenced this session. */
  modelsReferenced: RegisteredModel[];
  /** Active overrides not yet aged out. */
  activeOverrides: SafetyOverride[];
  /** Database degradation count. */
  degradedSources: number;
  /** Highest risk tier of any unacknowledged flag. */
  highestUnackTier: SafetyFlagSeverity | null;
}

export function summarizeHAIOps(ctx: HAIOpsContext): HAIOpsSummary {
  const verification = verifyChain(ctx.audit);
  const blocking = ctx.flags.filter(f => f.reviewRequired && !f.acknowledged && f.severity === "critical");
  const tierOrder: SafetyFlagSeverity[] = ["critical", "major", "warning"];
  const highest = tierOrder.find(t => ctx.flags.some(f => f.severity === t && !f.acknowledged)) ?? null;
  const referenced = new Set<string>();
  for (const p of Object.values(ctx.provenance)) {
    if (p?.engineFile) referenced.add(p.engineFile);
  }
  // Also pull model versions out of flags
  for (const f of ctx.flags) if (f.modelVersion) referenced.add(f.modelVersion);
  const models: RegisteredModel[] = [];
  for (const mv of referenced) {
    const m = lookupModel(mv);
    if (m) models.push(m);
  }
  return {
    blockingFindings: blocking.length,
    auditOk: verification.ok,
    auditEvents: Math.max(0, ctx.audit.events.length - 1),
    modelsReferenced: models,
    activeOverrides: ctx.overrides,
    degradedSources: Object.values(ctx.dbStatus).filter(q => q.status === "failed" || q.status === "cached").length,
    highestUnackTier: highest,
  };
}

export { findAcknowledgement, findActiveOverride };
export type { AuditAttestation, AuditEvent };

export function getDbDegradationWarnings(ctx: HAIOpsContext): DatabaseQueryRecord[] {
  return Object.values(ctx.dbStatus).filter(q => q.status === "failed" || q.status === "cached");
}

export function serializeForExport(ctx: HAIOpsContext): Record<string, unknown> {
  const summary = summarizeHAIOps(ctx);
  return {
    _haiopsMeta: {
      version: "1.2.0",
      framework: "HAIOps",
      exportTimestamp: new Date().toISOString(),
      sessionId: ctx.sessionId,
      auditChainIntegrity: summary.auditOk ? "verified" : "BROKEN",
      auditHeadHash: ctx.audit.headHash,
    },
    _safetyFlags: ctx.flags.map(f => ({
      id: f.id,
      type: f.type,
      severity: f.severity,
      label: f.label,
      originLayer: f.originLayer,
      ichReference: f.ichReference,
      value: f.value,
      reviewRequired: f.reviewRequired,
      acknowledged: f.acknowledged,
      modelVersion: f.modelVersion,
    })),
    _overrides: ctx.overrides,
    _provenance: ctx.provenance,
    _dbStatus: ctx.dbStatus,
    _reviewAcknowledged: ctx.reviewAcknowledged,
    _auditChain: ctx.audit.events,
    _summary: summary,
  };
}

/**
 * Build a regulator-ready evidence manifest:
 *   - canonical-JSON of the full HAIOps context
 *   - SHA-256 of the canonical form (for digital-signature workflows)
 *   - chain-of-custody hash list (every event's SHA-256, not just FNV)
 */
export async function buildRegulatoryManifest(ctx: HAIOpsContext): Promise<{
  canonicalJson: string;
  sha256: string;
  chainSha256s: string[];
}> {
  const exportObj = serializeForExport(ctx);
  const canonicalJson = canonicalJSON(exportObj);
  const sha = await sha256Hex(canonicalJson);
  const chainSha256s = await Promise.all(
    ctx.audit.events.map(e => sha256Hex(canonicalJSON(e))),
  );
  return { canonicalJson, sha256: sha, chainSha256s };
}
