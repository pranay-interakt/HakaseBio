/**
 * PreClinicalPackage v2.0.0 — Confirmation Architecture Specification.
 *
 * Implements the typed contracts from
 *   attached_assets/HakaseBio_v2.0.0_Confirmation_Architecture_Spec_*.docx
 * sections §5 (Schema) and §6 (Anti-Fabrication Invariants).
 *
 * Key shape changes vs v1 / v2:
 *   - Per-layer `LayerEvidenceBlock<T>` replaces flat `derivedFrom`.
 *   - `cypTransporter` and `clearanceFractions` move into
 *     `confirmation.jointOutputs.*` with explicit `mlEvidenceRef` /
 *     `kineticEvidenceRef` pointers (§5.9).
 *   - `PreConfirmationDirective` is the contract emitted by in-silico and
 *     consumed by ex-vivo (§5.3). Ex-vivo records lacking an `ExVivoEntryMode`
 *     are rejected at write time (§6.2).
 *   - `FalsifierId` is a typed reference into a versioned registry (§5.6).
 *     `falsified` is a typed state distinct from low-confidence (§6.3).
 *   - `OverrideRecord` carries actor / role / authorityCitation /
 *     falsifierAccepted / l1EvidenceCited (§5.7). Records lacking the
 *     authority chain are rejected at write time (§6.5).
 *   - `JointOutput` is an `agree | disagree | partial | mlGap` discriminator
 *     with `RepairPath` on partial (§5.10). Silent fallback is forbidden
 *     (§6.4).
 *   - `GatePolicySnapshot` is embedded in the package at gate time so the
 *     package is portable across organisations (§5.4).
 *
 * STRICT POLICY (carried over from v1, do not relax):
 *   1. Every nullable field is explicitly `T | null`. Builders never default.
 *   2. Validators are write-time, not soft. Failed records throw.
 *   3. Schema is versioned. Any breaking change bumps SCHEMA_VERSION_V2_0_0.
 */

import type { CompoundIdentity, IsoTimestamp, DatabasePullRecord } from "./index.js";

export const SCHEMA_VERSION_V2_0_0 = "2.0.0" as const;

// ── Branded primitives ──────────────────────────────────────────────────────

export type FalsifierId = string & { readonly __brand: "FalsifierId" };
export type DirectiveId = string & { readonly __brand: "DirectiveId" };
export type EvidencePointer = string & { readonly __brand: "EvidencePointer" };
export type CompoundId = string & { readonly __brand: "CompoundId" };
export type ExemptionId = string & { readonly __brand: "ExemptionId" };
export type OverrideId = string & { readonly __brand: "OverrideId" };
export type PolicyRef = string & { readonly __brand: "PolicyRef" };
export type ActorId = string & { readonly __brand: "ActorId" };
export type EngineId = string & { readonly __brand: "EngineId" };

export const asFalsifierId = (s: string): FalsifierId => s as FalsifierId;
export const asDirectiveId = (s: string): DirectiveId => s as DirectiveId;
export const asEvidencePointer = (s: string): EvidencePointer => s as EvidencePointer;
export const asCompoundId = (s: string): CompoundId => s as CompoundId;
export const asExemptionId = (s: string): ExemptionId => s as ExemptionId;
export const asOverrideId = (s: string): OverrideId => s as OverrideId;
export const asPolicyRef = (s: string): PolicyRef => s as PolicyRef;
export const asActorId = (s: string): ActorId => s as ActorId;
export const asEngineId = (s: string): EngineId => s as EngineId;

// ── Domain enums ────────────────────────────────────────────────────────────

export type PredictionDomain =
  | "admet"
  | "cyp_transporter"
  | "clearance_fractions"
  | "off_target"
  | "dose_response"
  | "herg_pbpk";

export type PredictionClass =
  | "admet"
  | "hERG"
  | "off_target"
  | "clearance"
  | "cyp_inhibition"
  | "transporter"
  | "dose_response";

export type Role =
  | "PreClinicalSafetyReviewer"
  | "ProgramLead"
  | "RegulatoryAffairs"
  | "ChiefScientificOfficer";

export type OverrideKind =
  | "inSilicoGate"
  | "exVivoGate"
  | "exVivoSkipped"
  | "jointOutputDisagree"
  | "indGate";

// ── Tolerance (§5.5) ────────────────────────────────────────────────────────

export interface Tolerance {
  kind: "absolute" | "log10" | "fold" | "percentRelative";
  value: number;
  /** Required even for fold/log10 — names the underlying measure. */
  unit: string;
}

// ── ConfidenceVector (§5.2) ─────────────────────────────────────────────────

export interface ConfidenceEntry {
  value: number; // 0..1
  method: "model_uncertainty" | "ensemble_variance" | "calibration_proximity";
  derivedFrom: EvidencePointer[];
}

export interface ConfidenceVector {
  byClass: Partial<Record<PredictionClass, ConfidenceEntry>>;
}

// ── FalsifierRegistry (§5.6) ────────────────────────────────────────────────

export type RegulatoryRelevance =
  | "ICH-S7A"
  | "ICH-S7B"
  | "ICH-M3R2"
  | "FDA-DILI-guidance"
  | "EMA-MABEL-guidance";

export interface TriggerCondition {
  /** Short human-readable form of the trigger, e.g. "bsep_ic50 < 25 µM". */
  expression: string;
  /** Assay this trigger reads, e.g. "bsep_inhibition". */
  assayId: string;
  comparator: "lt" | "gt" | "eq" | "lte" | "gte" | "fold_lt" | "fold_gt";
  threshold: number;
  unit: string;
}

export interface FalsifierRegistryEntry {
  id: FalsifierId;
  description: string;
  appliesTo: PredictionDomain;
  defaultTriggerCondition: TriggerCondition;
  regulatoryRelevance: RegulatoryRelevance[];
  /**
   * If true, accepting this falsifier via override forces Phase1Planner to
   * apply MABEL bias on FIH dose derivation (§9.6 worked example). This is
   * the single property `shouldApplyMabelBias()` branches on.
   */
  mabelBiasRequired: boolean;
  introducedInVersion: string;
}

export interface FalsifierRegistry {
  version: string;
  entries: FalsifierRegistryEntry[];
}

// ── PreConfirmationDirective (§5.3) ─────────────────────────────────────────

export interface AssaySpec {
  assayId: string;
  label: string;
  estimatedCostUsd: number | null;
  estimatedTurnaroundDays: number | null;
}

export interface ExpectedRange {
  central: number;
  tolerance: Tolerance;
  unit: string;
}

export interface FalsifierAssertion {
  falsifierId: FalsifierId;
  appliesTo: PredictionDomain;
  triggerCondition: TriggerCondition;
}

export interface DoseRange {
  route: "po" | "iv" | "sc" | "im" | "ip";
  minMgKg: number;
  maxMgKg: number;
}

export interface PreConfirmationDirective {
  directiveId: DirectiveId;
  compoundId: CompoundId;
  emittedAt: IsoTimestamp;
  emitterEngine: EngineId;
  l1EvidencePointer: EvidencePointer;
  prioritisedAssays: AssaySpec[];
  expectedRanges: Record<string, ExpectedRange>;
  falsifiers: FalsifierAssertion[];
  recommendedDoseRanges: DoseRange[];
  predictionsCovered: PredictionDomain[];
}

// ── GatePolicySnapshot (§5.4) ───────────────────────────────────────────────

export interface ExVivoGateRule {
  ruleId: string;
  description: string;
  /**
   * Names the joint output domains that must be in `agree` or `partial` (with
   * an active repairPath) for this rule to allow the gate to pass.
   */
  domainsRequired: PredictionDomain[];
}

export interface AuthorityRequirement {
  rolesAllowed: Role[];
  policyMustCite: PolicyRef[];
}

export interface GatePolicySnapshot {
  policyId: string;
  policyVersion: string;
  snapshottedAt: IsoTimestamp;
  inSilicoGateThresholds: Partial<
    Record<PredictionClass, { minConfidence: number; falsifiersConsidered: FalsifierId[] }>
  >;
  exVivoGateRules: ExVivoGateRule[];
  jointOutputTolerances: Partial<Record<PredictionDomain, Tolerance>>;
  overrideAuthorityRequired: Partial<Record<OverrideKind, AuthorityRequirement>>;
}

// ── OverrideRecord with authority chain (§5.7) ──────────────────────────────

export interface OverrideRecord {
  overrideId: OverrideId;
  overrideKind: OverrideKind;
  appliedAt: IsoTimestamp;
  // Authority chain
  actor: ActorId;
  role: Role;
  authorityCitation: PolicyRef;
  // Substantive
  reason: string;
  falsifierAccepted: FalsifierId | null;
  l1EvidenceCited: {
    pointer: EvidencePointer;
    fields: string[];
  };
  // Audit
  signedDigest: string; // sha256 of the canonical record
}

// ── CategoricalExemption (§5.8) ─────────────────────────────────────────────

export type CompoundClass =
  | "small_molecule"
  | "monoclonal_antibody"
  | "peptide"
  | "cell_therapy"
  | "gene_therapy";

export interface CategoricalExemption {
  exemptionId: ExemptionId;
  compoundClass: CompoundClass;
  predictionDomain: PredictionDomain;
  reason: string;
  evidenceCited: EvidencePointer[];
  catalogueVersion: string;
}

export type ExVivoEntryMode =
  | { kind: "consumedDirective"; directiveId: DirectiveId }
  | { kind: "notApplicable"; exemption: CategoricalExemption }
  | { kind: "overrideSkipped"; override: OverrideRecord };

// ── FalsifierTrigger / LayerEvidenceBlock (§5.2) ────────────────────────────

export interface FalsifierTrigger {
  falsifierId: FalsifierId;
  triggeredByEvidence: EvidencePointer;
  marginObserved: number;
  predictionFalsified: PredictionDomain;
}

export interface LayerEvidenceBlock<TEvidence> {
  layer: "inVitro" | "confirmation_inSilico" | "confirmation_exVivo" | "animalCohort";
  evidence: TEvidence[];
  confidence: ConfidenceVector;
  gateStatus: "passed" | "failed" | "overridden";
  falsifiers: FalsifierTrigger[];
  overrides: OverrideRecord[];
  emittedAt: IsoTimestamp;
  emitterEngine: EngineId;
  emitterEngineVersion: string;
  /** null only for the inVitro block itself. */
  l1EvidencePointer: EvidencePointer | null;
}

// ── Joint outputs (§5.9 / §5.10) ────────────────────────────────────────────

export interface RepairPath {
  missingAssay: AssaySpec;
  expectedRange: ExpectedRange;
  blocksWhichDownstreamDecisions: string[];
  estimatedCost: { currency: string; amount: number } | null;
  estimatedTurnaround: { unit: "day" | "week"; value: number } | null;
}

export interface JointOutput<TDomain extends PredictionDomain> {
  domain: TDomain;
  status: "agree" | "disagree" | "partial" | "mlGap";
  mlEvidenceRef: EvidencePointer;
  /** null when status = 'partial' or 'mlGap'. */
  kineticEvidenceRef: EvidencePointer | null;
  synthesisedValue: number | null;
  unit: string;
  jointConfidence: number;
  /** Populated only when status = 'disagree'. */
  falsifierTriggered: FalsifierId | null;
  confidenceCaveat: string | null;
  /** Populated only when status = 'partial'. */
  repairPath: RepairPath | null;
}

export type CypEnzyme = "CYP1A2" | "CYP2C9" | "CYP2C19" | "CYP2D6" | "CYP3A4";

export interface EnzymeJointSignal {
  enzyme: CypEnzyme;
  inhibitionIc50uM: number | null;
  jointConfidence: number;
  status: "agree" | "disagree" | "partial" | "mlGap";
}

export interface TransporterJointSignal {
  transporter: "P-gp" | "BCRP" | "OATP1B1" | "OATP1B3" | "OCT2" | "MATE1" | "BSEP";
  inhibitionIc50uM: number | null;
  jointConfidence: number;
  status: "agree" | "disagree" | "partial" | "mlGap";
}

export interface CypTransporterJointOutput extends JointOutput<"cyp_transporter"> {
  perEnzyme: Partial<Record<CypEnzyme, EnzymeJointSignal>>;
  transporterPanel: TransporterJointSignal[];
}

export interface ClearanceFractionsJointOutput extends JointOutput<"clearance_fractions"> {
  hepatic: number | null;
  renal: number | null;
  biliary: number | null;
  totalClearance: number | null;
}

// ── Layer-specific evidence shapes ──────────────────────────────────────────

export interface InVitroEvidenceRecord {
  recordId: EvidencePointer;
  assay: string;
  value: number | null;
  unit: string;
  notes: string | null;
}

export interface InSilicoEvidenceRecord {
  recordId: EvidencePointer;
  predictionDomain: PredictionDomain;
  predictedValue: number | null;
  unit: string;
  /** True when a registered FalsifierId triggered for this prediction (§6.3). */
  falsified: boolean;
  falsifierId: FalsifierId | null;
}

export interface ExVivoEvidenceRecord {
  recordId: EvidencePointer;
  assay: string;
  value: number | null;
  unit: string;
  /** Each ex-vivo record references the directive it was bound to (§6.2). */
  directiveId: DirectiveId | null;
  notes: string | null;
}

export interface AnimalStudyRecord {
  recordId: EvidencePointer;
  studyType: string;
  species: string;
  noaelMgPerKg: number | null;
  mtdMgPerKg: number | null;
  hedMgPerKg: number | null;
}

// ── ConfirmationEvidenceBlock (§5.11) ───────────────────────────────────────

export interface ConfirmationJointOutputs {
  cypTransporter: CypTransporterJointOutput;
  clearanceFractions: ClearanceFractionsJointOutput;
  offTarget: JointOutput<"off_target">;
  doseResponse: JointOutput<"dose_response">;
  hergPbpkProjection: JointOutput<"herg_pbpk">;
}

export interface ConfirmationEvidenceBlock {
  layer: "confirmation";
  inSilico: LayerEvidenceBlock<InSilicoEvidenceRecord>;
  exVivo: LayerEvidenceBlock<ExVivoEvidenceRecord>;
  exVivoEntryMode: ExVivoEntryMode;
  /** null only when entry mode is notApplicable / overrideSkipped. */
  directive: PreConfirmationDirective | null;
  jointOutputs: ConfirmationJointOutputs;
  overrides: OverrideRecord[];
  gateStatus: "passed" | "failed" | "overridden";
  gatePolicy: GatePolicySnapshot;
  l1EvidencePointer: EvidencePointer;
  emittedAt: IsoTimestamp;
  emitterEngine: EngineId;
  emitterEngineVersion: string;
}

// ── AnimalCohort block (§7.2 internal representation) ───────────────────────

export interface AnimalCohortEvidenceBlock {
  layer: "animalCohort";
  evidence: AnimalStudyRecord[];
  confidence: ConfidenceVector;
  gateStatus: "passed" | "failed" | "overridden";
  falsifiers: FalsifierTrigger[];
  overrides: OverrideRecord[];
  emittedAt: IsoTimestamp;
  emitterEngine: EngineId;
  emitterEngineVersion: string;
  /** Reference to the ConfirmationPackage that drove the study design (§7.2). */
  confirmationPackageRef: EvidencePointer;
  directivesConfirmedByAnimal: DirectiveId[];
  falsifiersTriggeredInVivo: FalsifierTrigger[];
}

// ── InVitro block ───────────────────────────────────────────────────────────

export interface InVitroEvidenceBlock {
  layer: "inVitro";
  evidence: InVitroEvidenceRecord[];
  confidence: ConfidenceVector;
  gateStatus: "passed" | "failed" | "overridden";
  falsifiers: FalsifierTrigger[];
  overrides: OverrideRecord[];
  emittedAt: IsoTimestamp;
  emitterEngine: EngineId;
  emitterEngineVersion: string;
}

// ── Top-level PreClinicalPackage v2.0.0 (§5.1) ──────────────────────────────

export interface PreClinicalPackageV2_0_0 {
  schemaVersion: typeof SCHEMA_VERSION_V2_0_0;
  compoundId: CompoundId;
  programId: string;
  emittedAt: IsoTimestamp;
  compound: CompoundIdentity;

  inVitro: InVitroEvidenceBlock;
  confirmation: ConfirmationEvidenceBlock;
  animalCohort: AnimalCohortEvidenceBlock;

  gatePolicy: GatePolicySnapshot;
  overrideAuditTrail: OverrideRecord[];
  falsifierRegistryVersion: string;
  categoricalExemptionsApplied: CategoricalExemption[];
  /** Aggregated provenance + warnings emitted by the builder. */
  builderProvenance: {
    builderEngine: string;
    builderVersion: string;
    warnings: string[];
    databaseQueries: DatabasePullRecord[];
  };
}

// ════════════════════════════════════════════════════════════════════════════
// §6 Anti-Fabrication Invariants — write-time validators.
// Each guard throws with a precise message so producers cannot fabricate
// against an unenforced contract (§6 / §8.2 Phase B).
// ════════════════════════════════════════════════════════════════════════════

export class V2_0_0_InvariantError extends Error {
  constructor(
    public readonly invariant: string,
    message: string,
  ) {
    super(`[v2.0.0 invariant ${invariant}] ${message}`);
    this.name = "V2_0_0_InvariantError";
  }
}

const HEX_RE = /^[a-f0-9]{8,}$/i;

/** §6.5 — every override carries authority chain + symmetric evidence side. */
export function assertOverrideRecord(o: OverrideRecord): void {
  if (!o.overrideId) throw new V2_0_0_InvariantError("6.5", "missing overrideId");
  if (!o.actor) throw new V2_0_0_InvariantError("6.5", "missing actor");
  if (!o.role) throw new V2_0_0_InvariantError("6.5", "missing role");
  if (!o.authorityCitation)
    throw new V2_0_0_InvariantError("6.5", "missing authorityCitation");
  if (!o.reason || o.reason.trim().length < 20)
    throw new V2_0_0_InvariantError(
      "6.5",
      "reason must be ≥20 chars (mirrors IND-gate override policy)",
    );
  if (!o.l1EvidenceCited?.pointer)
    throw new V2_0_0_InvariantError(
      "6.5",
      "l1EvidenceCited.pointer is required",
    );
  if (
    !Array.isArray(o.l1EvidenceCited.fields) ||
    o.l1EvidenceCited.fields.length === 0
  )
    throw new V2_0_0_InvariantError(
      "6.5",
      "l1EvidenceCited.fields must name ≥1 specific field",
    );
  if (
    typeof o.signedDigest !== "string" ||
    !o.signedDigest.startsWith("sha256:") ||
    !HEX_RE.test(o.signedDigest.slice(7))
  )
    throw new V2_0_0_InvariantError(
      "6.5",
      "signedDigest must be sha256:<hex≥8>",
    );
}

/** §6.2 — ex-vivo records cannot exist without an entry mode. */
export function assertExVivoEntryMode(
  mode: ExVivoEntryMode,
  registry: FalsifierRegistry,
): void {
  if (mode.kind === "consumedDirective") {
    if (!mode.directiveId)
      throw new V2_0_0_InvariantError("6.2", "consumedDirective requires directiveId");
    return;
  }
  if (mode.kind === "notApplicable") {
    if (!mode.exemption?.exemptionId)
      throw new V2_0_0_InvariantError(
        "6.2",
        "notApplicable requires CategoricalExemption from catalogue",
      );
    return;
  }
  if (mode.kind === "overrideSkipped") {
    assertOverrideRecord(mode.override);
    if (mode.override.overrideKind !== "exVivoSkipped")
      throw new V2_0_0_InvariantError(
        "6.2",
        "overrideSkipped entry mode must reference an exVivoSkipped override",
      );
    return;
  }
  // Compile-time exhaustiveness — runtime guard for partner emitters.
  throw new V2_0_0_InvariantError(
    "6.2",
    `unknown ExVivoEntryMode (got ${JSON.stringify(mode)}); allowed: consumedDirective | notApplicable | overrideSkipped`,
  );
  // Reference registry to keep the parameter live in case future kinds need it.
  void registry;
}

/** §6.4 — partial joint outputs MUST carry a typed RepairPath. */
export function assertJointOutput<T extends PredictionDomain>(
  jo: JointOutput<T>,
): void {
  if (jo.status === "partial") {
    if (jo.kineticEvidenceRef !== null)
      throw new V2_0_0_InvariantError(
        "6.4",
        `partial joint output (${jo.domain}) must have kineticEvidenceRef = null`,
      );
    if (!jo.repairPath)
      throw new V2_0_0_InvariantError(
        "6.4",
        `partial joint output (${jo.domain}) requires repairPath — silent fallback to ML-only is forbidden`,
      );
    if (jo.synthesisedValue !== null)
      throw new V2_0_0_InvariantError(
        "6.4",
        `partial joint output (${jo.domain}) must have synthesisedValue = null`,
      );
  }
  if (jo.status === "mlGap") {
    if (jo.kineticEvidenceRef !== null)
      throw new V2_0_0_InvariantError(
        "6.4",
        `mlGap joint output (${jo.domain}) must have kineticEvidenceRef = null`,
      );
  }
  if (jo.status === "disagree") {
    if (!jo.falsifierTriggered)
      throw new V2_0_0_InvariantError(
        "6.4",
        `disagree joint output (${jo.domain}) must name the falsifier that triggered`,
      );
  }
  if (jo.status === "agree") {
    if (jo.kineticEvidenceRef === null)
      throw new V2_0_0_InvariantError(
        "6.4",
        `agree joint output (${jo.domain}) must reference the ex-vivo record that confirmed it`,
      );
  }
}

/** §6.1 — every confirmation block must reference a frozen L1 evidence pointer. */
export function assertConfirmationBlock(
  block: ConfirmationEvidenceBlock,
  registry: FalsifierRegistry,
): void {
  if (!block.l1EvidencePointer)
    throw new V2_0_0_InvariantError(
      "6.1",
      "confirmation block missing frozen L1 evidence pointer",
    );
  if (!block.gatePolicy?.policyId)
    throw new V2_0_0_InvariantError(
      "5.4",
      "confirmation block missing embedded GatePolicySnapshot",
    );
  // §6.2 ex-vivo entry mode
  assertExVivoEntryMode(block.exVivoEntryMode, registry);
  if (block.exVivoEntryMode.kind === "consumedDirective") {
    if (!block.directive)
      throw new V2_0_0_InvariantError(
        "6.2",
        "consumedDirective entry mode requires directive on the block",
      );
    if (block.directive.directiveId !== block.exVivoEntryMode.directiveId)
      throw new V2_0_0_InvariantError(
        "6.2",
        "directiveId on entry mode does not match block.directive.directiveId",
      );
    // Every ex-vivo evidence record must reference the directive (§6.2).
    for (const r of block.exVivo.evidence) {
      if (r.directiveId !== block.directive.directiveId)
        throw new V2_0_0_InvariantError(
          "6.2",
          `ex-vivo record ${r.recordId} does not reference the consumed directive`,
        );
    }
  }
  // §6.4 each joint output
  for (const jo of [
    block.jointOutputs.cypTransporter,
    block.jointOutputs.clearanceFractions,
    block.jointOutputs.offTarget,
    block.jointOutputs.doseResponse,
    block.jointOutputs.hergPbpkProjection,
  ]) {
    assertJointOutput(jo);
  }
  // §6.5 each override
  for (const o of block.overrides) assertOverrideRecord(o);
  // §6.3 falsified state typing — every block.inSilico falsified record must
  // name a registered FalsifierId that exists in the registry.
  const known = new Set(registry.entries.map((e) => e.id));
  for (const ev of block.inSilico.evidence) {
    if (ev.falsified) {
      if (!ev.falsifierId)
        throw new V2_0_0_InvariantError(
          "6.3",
          `falsified in-silico record ${ev.recordId} must name a falsifierId`,
        );
      if (!known.has(ev.falsifierId))
        throw new V2_0_0_InvariantError(
          "6.3",
          `falsifierId ${ev.falsifierId} not in registry ${registry.version}`,
        );
    }
  }
}

/** Top-level package guard — runs all five invariants. */
export function assertPreClinicalPackageV2_0_0(
  pkg: PreClinicalPackageV2_0_0,
  registry: FalsifierRegistry,
): void {
  if (pkg.schemaVersion !== SCHEMA_VERSION_V2_0_0)
    throw new V2_0_0_InvariantError(
      "5.1",
      `schemaVersion must be ${SCHEMA_VERSION_V2_0_0} (got ${pkg.schemaVersion})`,
    );
  if (pkg.falsifierRegistryVersion !== registry.version)
    throw new V2_0_0_InvariantError(
      "5.6",
      `package falsifierRegistryVersion ${pkg.falsifierRegistryVersion} ≠ runtime registry ${registry.version}`,
    );
  // Per-block guards
  assertConfirmationBlock(pkg.confirmation, registry);
  for (const o of pkg.overrideAuditTrail) assertOverrideRecord(o);
}
