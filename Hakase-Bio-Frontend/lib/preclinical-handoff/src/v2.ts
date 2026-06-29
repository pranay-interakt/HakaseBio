/**
 * PreClinicalPackage v2.0.0
 *
 * Per-layer typed handoff from BioDigital Twin pre-clinical to Hakase
 * Clinical Phase 1+ planners. v2 restructures v1's flat
 * inVitro/inSilico/animalCohort siblings into three first-class layer blocks,
 * each carrying its own evidence, user overrides, confidence rating, and
 * provenance. The ex-vivo confirmation track that the architecture refactor
 * introduced lives under L2 alongside the in-silico track, with an explicit
 * `PreConfirmationHandoff` contract between them so the two sub-tracks
 * cannot silently drift apart.
 *
 * STRICT POLICY (carried over from v1, do not relax):
 *   1. Every field that may not be derivable is `T | null` — never defaulted.
 *   2. No silent fallbacks. If a value cannot be honestly derived, the field
 *      is null and a warning is appended to the layer's provenance.
 *   3. Layer blocks themselves are nullable: a layer that has not yet been
 *      run is `null`. Downstream consumers MUST refuse to plan when a
 *      required layer is missing — never substitute a default.
 *   4. User overrides are first-class records with a ≥20-char rationale,
 *      mirroring the IND-gate override policy from Phase1Planner.
 *   5. Schema is versioned. Any breaking change bumps SCHEMA_VERSION_V2.
 *
 * v1 (PreClinicalPackage) remains exported and is still the active contract
 * consumed by Phase1Planner. Use `migrateV1ToV2()` to lift a v1 package into
 * v2 shape (lossy where v1 had no concept of ex-vivo or per-layer confidence
 * — those gaps surface as nulls + warnings, not as fabricated values).
 */

import type {
  CompoundIdentity,
  InVitroSummary,
  InSilicoSummary,
  AnimalCohortSummary,
  CypTransporterPanel,
  ClearanceFractions,
  DatabasePullRecord,
  EvidenceSource,
  IsoTimestamp,
  PreClinicalPackage,
} from "./index.js";

export const PRECLINICAL_PACKAGE_SCHEMA_VERSION_V2 = "2.0.0" as const;

// ── Shared layer primitives ─────────────────────────────────────────────────

export type ConfidenceLevel = "low" | "moderate" | "high";

/**
 * Per-layer confidence rating. `level` is the categorical signal Phase 1
 * branches on (e.g. "if L1 confidence is low, bias MABEL"). `basis` is a
 * short human-readable string explaining the rating. Never defaulted —
 * builders that cannot rate a layer must omit the layer (set the block to
 * null) rather than pick a level.
 */
export interface LayerConfidence {
  level: ConfidenceLevel;
  basis: string;
}

/**
 * One user override applied at the layer level. Mirrors the
 * IndGateOverride pattern from Phase1Planner — `rationale` is required and
 * must be ≥20 chars (enforced at builder time, not at type level).
 */
export interface UserOverride {
  /** Dotted path within the layer's `evidence` block, e.g. "hergIc50UM". */
  field: string;
  previousValue: unknown;
  newValue: unknown;
  rationale: string;
  appliedAt: IsoTimestamp;
  appliedBy: string | null;
}

/**
 * Per-layer provenance. Distinct from the top-level package provenance:
 * each layer records who/when/how its evidence was produced so Phase 1+
 * can attribute every field back to the originating engine.
 */
export interface LayerProvenance {
  emittedAt: IsoTimestamp;
  engine: string;
  engineVersion: string;
  databaseQueries: DatabasePullRecord[];
  warnings: string[];
}

// ── L1 In Vitro layer ───────────────────────────────────────────────────────

/**
 * L1 evidence = the v1 InVitroSummary plus L1 ADMET-ML probabilities that
 * v1 leaked into the §6.1 sub-payloads. Bringing them home to L1 makes the
 * provenance clean: ADMET-AI predictions originate at L1, are confirmed at
 * L2, and are joined into the §6.1 panels at L2.
 */
export interface L1InVitroEvidence {
  // Wet-lab in-vitro measurements
  hergIc50UM: number | null;
  caco2Permeability: number | null;
  plasmaProteinBindingFraction: number | null;
  primaryTargetUniprot: string | null;
  primaryTargetGeneSymbol: string | null;
  primaryTargetIc50nM: number | null;
  // L1 ML ADMET screening priors. Each is a probability in [0,1] or null.
  // These are screening-grade — see §6.1.a — and must be confirmed at L2
  // before they show up on the §6.1 joint panel.
  mlAdmetPriors: {
    cyp1a2InhibitionProb: number | null;
    cyp2c9InhibitionProb: number | null;
    cyp2c19InhibitionProb: number | null;
    cyp2d6InhibitionProb: number | null;
    cyp3a4InhibitionProb: number | null;
    pgpInhibitionProb: number | null;
    bcrpInhibitionProb: number | null;
    renalExcretionProb: number | null;
    hepaticClearanceProxy: number | null;
    /** Source of the ML priors (always ml-prediction when present). */
    source: EvidenceSource;
  } | null;
}

export interface L1InVitroBlock {
  evidence: L1InVitroEvidence;
  overrides: UserOverride[];
  confidence: LayerConfidence;
  provenance: LayerProvenance;
}

// ── L2 Confirmation layer (in-silico + ex-vivo sub-tracks) ──────────────────

/**
 * In-silico → ex-vivo pre-confirmation handoff. Emitted by the in-silico
 * sub-track to tell the ex-vivo sub-track which assays to prioritize, what
 * ranges to expect, and what would falsify the in-silico prediction.
 *
 * This is the explicit contract that prevents the two L2 sub-tracks from
 * drifting into "two unrelated blobs under one layer" — every ex-vivo run
 * either consumes a handoff (with deltas recorded against predictions) or
 * is flagged as an unblinded run.
 */
export const PRE_CONFIRMATION_HANDOFF_SCHEMA_VERSION = "1.0.0" as const;

export interface PrioritizedAssay {
  assayId: string;
  rationale: string;
  priority: "must-run" | "should-run" | "optional";
}

export interface PredictedRange {
  assayId: string;
  unit: string;
  predictedMin: number | null;
  predictedMax: number | null;
  predictedPoint: number | null;
  basis: string;
}

export interface PreConfirmationHandoff {
  schemaVersion: typeof PRE_CONFIRMATION_HANDOFF_SCHEMA_VERSION;
  handoffId: string;
  emittedAt: IsoTimestamp;
  prioritizedAssays: PrioritizedAssay[];
  predictedRanges: PredictedRange[];
  /** Plain-language criteria that, if observed in ex-vivo, falsify the in-silico prediction. */
  falsificationCriteria: string[];
}

/** A single observed ex-vivo result vs its in-silico prediction. */
export interface HandoffDelta {
  assayId: string;
  predictedPoint: number | null;
  observedPoint: number | null;
  unit: string;
  /** "within-range" | "above-range" | "below-range" | "no-prediction" | "no-observation" */
  status:
    | "within-range"
    | "above-range"
    | "below-range"
    | "no-prediction"
    | "no-observation";
  notes: string | null;
}

export interface InSilicoEvidence {
  humanProjectedCmaxNgPerMl: number | null;
  humanProjectedAucNgHPerMl: number | null;
  humanProjectedHalfLifeHours: number | null;
  humanProjectedClearanceLPerHPerKg: number | null;
  freeEnergyDdgKcalPerMol: number | null;
  freeEnergyUncertaintyKcalPerMol: number | null;
}

export interface InSilicoSubTrack {
  evidence: InSilicoEvidence;
  /**
   * Pre-confirmation handoff this in-silico run emitted to ex-vivo. `null`
   * is a legitimate state — used when the in-silico run was made without a
   * planned ex-vivo follow-up (or for compounds, like biologics, where the
   * ex-vivo CYP panel is not applicable). Migration from v1 leaves this
   * `null` (v1 had no concept of a handoff) rather than fabricating one.
   */
  preConfirmationHandoff: PreConfirmationHandoff | null;
  overrides: UserOverride[];
  confidence: LayerConfidence;
  provenance: LayerProvenance;
}

/**
 * Ex-vivo evidence — wet-lab confirmation of the L1 priors and L2 in-silico
 * predictions. Fields are the regulatory-grade in-vitro CYP/transporter
 * panel that §6.1.a calls for, plus hERG patch-clamp confirmation and
 * hepatocyte clearance for §6.1.b derivation.
 */
export interface ExVivoEvidence {
  cypInhibitionIc50uM: {
    cyp1a2: number | null;
    cyp2c9: number | null;
    cyp2c19: number | null;
    cyp2d6: number | null;
    cyp3a4: number | null;
  };
  /** Primary-hepatocyte mRNA fold-change vs vehicle, per CYP isoform. */
  cypInductionMrnaFoldChange: {
    cyp1a2: number | null;
    cyp2b6: number | null;
    cyp3a4: number | null;
  };
  transporterInhibitionIc50uM: {
    pgp: number | null;
    bcrp: number | null;
    oatp1b1: number | null;
    oatp1b3: number | null;
    oct2: number | null;
    mate1: number | null;
  };
  hergPatchClampIc50uM: number | null;
  hepatocyteClearanceUlPerMinPerMillionCells: number | null;
}

export interface ExVivoSubTrack {
  evidence: ExVivoEvidence;
  /**
   * Links each ex-vivo observation back to the in-silico prediction it
   * confirmed (or refuted). May be `null` only when `unblindedRunReason` is
   * present — this is the anti-drift invariant: an ex-vivo run that does
   * NOT consume a handoff must declare why it was run unblinded. The guard
   * enforces this XOR.
   */
  consumedHandoff: {
    handoffId: string;
    deltas: HandoffDelta[];
  } | null;
  /**
   * Required justification (≥20 chars) when `consumedHandoff` is null —
   * names why this ex-vivo run was performed without consuming an in-silico
   * handoff. Mirrors the IND-gate override policy: silent drift is forbidden;
   * unblinded runs are allowed but must be accountable.
   */
  unblindedRunReason: string | null;
  overrides: UserOverride[];
  confidence: LayerConfidence;
  provenance: LayerProvenance;
}

/**
 * Where a §6.1 joint panel was derived from. `"unattributed"` is an
 * explicit marker for "we don't know which track these numbers came from"
 * — used by the v1→v2 migrator when the v1 `source` field was `null` or
 * `"user-provided"`. Consumers MUST treat `unattributed` as the lowest
 * possible confirmation grade and either refuse or surface it; they must
 * NEVER silently coalesce it to `"in-silico"`.
 */
export type DerivedFromTrack = "in-silico" | "ex-vivo" | "unattributed";

/**
 * §6.1 joint panels — derived at L2 from one or both sub-tracks.
 * `derivedFrom` records exactly which sub-tracks contributed; consumers can
 * branch on `derivedFrom = ["in-silico"]` (= screening-grade only) vs
 * `["in-silico","ex-vivo"]` (= confirmation-grade) without re-deriving.
 */
export interface CypTransporterPanelV2 extends CypTransporterPanel {
  derivedFrom: DerivedFromTrack[];
  confidence: LayerConfidence;
}

export interface ClearanceFractionsV2 extends ClearanceFractions {
  derivedFrom: DerivedFromTrack[];
  confidence: LayerConfidence;
}

export interface L2ConfirmationBlock {
  inSilico: InSilicoSubTrack | null;
  exVivo: ExVivoSubTrack | null;
  /** §6.1.a — null if neither sub-track produced enough data. */
  cypTransporterPanel: CypTransporterPanelV2 | null;
  /** §6.1.b — null if route-fractional CL cannot be estimated. */
  clearanceFractions: ClearanceFractionsV2 | null;
}

// ── L4 Animal Cohort layer ──────────────────────────────────────────────────

export type L4AnimalCohortEvidence = AnimalCohortSummary;

export interface L4AnimalCohortBlock {
  evidence: L4AnimalCohortEvidence;
  overrides: UserOverride[];
  confidence: LayerConfidence;
  provenance: LayerProvenance;
}

// ── Top-level package ───────────────────────────────────────────────────────

export interface PackageProvenanceV2 {
  emittedAt: IsoTimestamp;
  builderEngine: string;
  builderVersion: string;
  aggregateWarnings: string[];
}

/** Where the compound came from (relevant for partner collaborations). */
export interface CompoundSourceRequest {
  compoundProvidedBy: "internal" | "partner";
  partnerOrg: string | null;
}

export interface PreClinicalPackageV2 {
  schemaVersion: typeof PRECLINICAL_PACKAGE_SCHEMA_VERSION_V2;
  compound: CompoundIdentity;
  sourceRequest: CompoundSourceRequest;
  /** L1 In Vitro. `null` if the layer has not been run for this compound. */
  l1InVitro: L1InVitroBlock | null;
  /** L2 Confirmation (in-silico + ex-vivo). `null` if the layer has not been run. */
  l2Confirmation: L2ConfirmationBlock | null;
  /** L4 Animal Cohort. `null` if the layer has not been run. */
  l4AnimalCohort: L4AnimalCohortBlock | null;
  provenance: PackageProvenanceV2;
}

// ── Runtime guard ──────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNumOrNull(v: unknown): boolean {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}
function isStrOrNull(v: unknown): boolean {
  return v === null || typeof v === "string";
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isConfidence(v: unknown): v is LayerConfidence {
  if (!isObj(v)) return false;
  if (v.level !== "low" && v.level !== "moderate" && v.level !== "high")
    return false;
  return typeof v.basis === "string";
}
function isLayerProvenance(v: unknown): v is LayerProvenance {
  if (!isObj(v)) return false;
  return (
    typeof v.emittedAt === "string" &&
    typeof v.engine === "string" &&
    typeof v.engineVersion === "string" &&
    Array.isArray(v.databaseQueries) &&
    isStringArray(v.warnings)
  );
}
function isUserOverride(v: unknown): v is UserOverride {
  if (!isObj(v)) return false;
  return (
    typeof v.field === "string" &&
    typeof v.rationale === "string" &&
    typeof v.appliedAt === "string" &&
    isStrOrNull(v.appliedBy) &&
    "previousValue" in v &&
    "newValue" in v
  );
}
function isOverrideArray(v: unknown): boolean {
  return Array.isArray(v) && v.every(isUserOverride);
}

function isL1InVitroEvidence(v: unknown): boolean {
  if (!isObj(v)) return false;
  for (const k of [
    "hergIc50UM",
    "caco2Permeability",
    "plasmaProteinBindingFraction",
    "primaryTargetIc50nM",
  ]) {
    if (!isNumOrNull(v[k])) return false;
  }
  if (!isStrOrNull(v.primaryTargetUniprot)) return false;
  if (!isStrOrNull(v.primaryTargetGeneSymbol)) return false;
  const m = v.mlAdmetPriors;
  if (m === null) return true;
  if (!isObj(m)) return false;
  for (const k of [
    "cyp1a2InhibitionProb",
    "cyp2c9InhibitionProb",
    "cyp2c19InhibitionProb",
    "cyp2d6InhibitionProb",
    "cyp3a4InhibitionProb",
    "pgpInhibitionProb",
    "bcrpInhibitionProb",
    "renalExcretionProb",
    "hepaticClearanceProxy",
  ]) {
    if (!isNumOrNull(m[k])) return false;
  }
  return (
    m.source === null ||
    m.source === "in-vitro-experimental" ||
    m.source === "ml-prediction" ||
    m.source === "user-provided"
  );
}

function isPreConfirmationHandoff(v: unknown): v is PreConfirmationHandoff {
  if (!isObj(v)) return false;
  if (v.schemaVersion !== PRE_CONFIRMATION_HANDOFF_SCHEMA_VERSION) return false;
  if (typeof v.handoffId !== "string") return false;
  if (typeof v.emittedAt !== "string") return false;
  if (!Array.isArray(v.prioritizedAssays)) return false;
  for (const a of v.prioritizedAssays) {
    if (!isObj(a)) return false;
    if (typeof a.assayId !== "string") return false;
    if (typeof a.rationale !== "string") return false;
    if (
      a.priority !== "must-run" &&
      a.priority !== "should-run" &&
      a.priority !== "optional"
    )
      return false;
  }
  if (!Array.isArray(v.predictedRanges)) return false;
  for (const r of v.predictedRanges) {
    if (!isObj(r)) return false;
    if (typeof r.assayId !== "string") return false;
    if (typeof r.unit !== "string") return false;
    if (!isNumOrNull(r.predictedMin)) return false;
    if (!isNumOrNull(r.predictedMax)) return false;
    if (!isNumOrNull(r.predictedPoint)) return false;
    if (typeof r.basis !== "string") return false;
  }
  if (!isStringArray(v.falsificationCriteria)) return false;
  return true;
}

function isInSilicoEvidence(v: unknown): boolean {
  if (!isObj(v)) return false;
  for (const k of [
    "humanProjectedCmaxNgPerMl",
    "humanProjectedAucNgHPerMl",
    "humanProjectedHalfLifeHours",
    "humanProjectedClearanceLPerHPerKg",
    "freeEnergyDdgKcalPerMol",
    "freeEnergyUncertaintyKcalPerMol",
  ]) {
    if (!isNumOrNull(v[k])) return false;
  }
  return true;
}

function isInSilicoSubTrack(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v)) return false;
  if (!("preConfirmationHandoff" in v)) return false;
  if (
    v.preConfirmationHandoff !== null &&
    !isPreConfirmationHandoff(v.preConfirmationHandoff)
  )
    return false;
  return (
    isInSilicoEvidence(v.evidence) &&
    isOverrideArray(v.overrides) &&
    isConfidence(v.confidence) &&
    isLayerProvenance(v.provenance)
  );
}

function isExVivoEvidence(v: unknown): boolean {
  if (!isObj(v)) return false;
  const cyp = v.cypInhibitionIc50uM;
  if (!isObj(cyp)) return false;
  for (const k of ["cyp1a2", "cyp2c9", "cyp2c19", "cyp2d6", "cyp3a4"]) {
    if (!isNumOrNull(cyp[k])) return false;
  }
  const ind = v.cypInductionMrnaFoldChange;
  if (!isObj(ind)) return false;
  for (const k of ["cyp1a2", "cyp2b6", "cyp3a4"]) {
    if (!isNumOrNull(ind[k])) return false;
  }
  const tx = v.transporterInhibitionIc50uM;
  if (!isObj(tx)) return false;
  for (const k of ["pgp", "bcrp", "oatp1b1", "oatp1b3", "oct2", "mate1"]) {
    if (!isNumOrNull(tx[k])) return false;
  }
  if (!isNumOrNull(v.hergPatchClampIc50uM)) return false;
  if (!isNumOrNull(v.hepatocyteClearanceUlPerMinPerMillionCells)) return false;
  return true;
}

/** Minimum chars for an `unblindedRunReason`, mirroring IND-gate override policy. */
export const UNBLINDED_RUN_REASON_MIN_CHARS = 20 as const;

function isExVivoSubTrack(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v)) return false;
  if (!isExVivoEvidence(v.evidence)) return false;
  if (!("consumedHandoff" in v)) return false;
  if (!("unblindedRunReason" in v)) return false;
  const ch = v.consumedHandoff;
  if (ch !== null) {
    if (!isObj(ch)) return false;
    if (typeof ch.handoffId !== "string") return false;
    if (!Array.isArray(ch.deltas)) return false;
    for (const d of ch.deltas) {
      if (!isObj(d)) return false;
      if (typeof d.assayId !== "string") return false;
      if (typeof d.unit !== "string") return false;
      if (!isNumOrNull(d.predictedPoint)) return false;
      if (!isNumOrNull(d.observedPoint)) return false;
      if (
        d.status !== "within-range" &&
        d.status !== "above-range" &&
        d.status !== "below-range" &&
        d.status !== "no-prediction" &&
        d.status !== "no-observation"
      )
        return false;
      if (!isStrOrNull(d.notes)) return false;
    }
  }
  // Anti-drift XOR: exactly one of consumedHandoff / unblindedRunReason
  // must be present. unblindedRunReason, when present, must be ≥20 chars.
  const ur = v.unblindedRunReason;
  if (ch === null) {
    if (typeof ur !== "string") return false;
    if (ur.trim().length < UNBLINDED_RUN_REASON_MIN_CHARS) return false;
  } else {
    if (ur !== null) return false; // mutually exclusive
  }
  return (
    isOverrideArray(v.overrides) &&
    isConfidence(v.confidence) &&
    isLayerProvenance(v.provenance)
  );
}

function isDerivedFrom(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every(
    (x) => x === "in-silico" || x === "ex-vivo" || x === "unattributed",
  );
}

function isCypTransporterPanelV2(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v)) return false;
  if (!isObj(v.cyp) || !isObj(v.transporters)) return false;
  if (!isDerivedFrom(v.derivedFrom)) return false;
  if (!isConfidence(v.confidence)) return false;
  // Lean validation of cyp/transporters subfields
  for (const k of [
    "cyp1a2InhibitionProb",
    "cyp2c9InhibitionProb",
    "cyp2c19InhibitionProb",
    "cyp2d6InhibitionProb",
    "cyp3a4InhibitionProb",
    "inductionMrnaFoldChange",
  ]) {
    if (!isNumOrNull((v.cyp as Record<string, unknown>)[k])) return false;
  }
  for (const k of [
    "pgpInhibitionProb",
    "bcrpInhibitionProb",
    "oatp1b1InhibitionProb",
    "oatp1b3InhibitionProb",
    "oct2InhibitionProb",
    "mate1InhibitionProb",
  ]) {
    if (!isNumOrNull((v.transporters as Record<string, unknown>)[k]))
      return false;
  }
  return true;
}

function isClearanceFractionsV2(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v)) return false;
  for (const k of [
    "renalFraction",
    "hepaticFraction",
    "biliaryFraction",
    "otherFraction",
  ]) {
    if (typeof v[k] !== "number" || !Number.isFinite(v[k] as number))
      return false;
  }
  if (typeof v.basis !== "string") return false;
  if (!isDerivedFrom(v.derivedFrom)) return false;
  if (!isConfidence(v.confidence)) return false;
  return true;
}

function isL1Block(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v)) return false;
  return (
    isL1InVitroEvidence(v.evidence) &&
    isOverrideArray(v.overrides) &&
    isConfidence(v.confidence) &&
    isLayerProvenance(v.provenance)
  );
}

function isL2Block(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v)) return false;
  if (!("inSilico" in v) || !isInSilicoSubTrack(v.inSilico)) return false;
  if (!("exVivo" in v) || !isExVivoSubTrack(v.exVivo)) return false;
  if (!("cypTransporterPanel" in v)) return false;
  if (!isCypTransporterPanelV2(v.cypTransporterPanel)) return false;
  if (!("clearanceFractions" in v)) return false;
  if (!isClearanceFractionsV2(v.clearanceFractions)) return false;
  return true;
}

function isL4Block(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v)) return false;
  // Re-use lightweight checks — full v1 guard lives in index.ts
  if (!isObj(v.evidence)) return false;
  return (
    isOverrideArray(v.overrides) &&
    isConfidence(v.confidence) &&
    isLayerProvenance(v.provenance)
  );
}

function isPackageProvenanceV2(v: unknown): boolean {
  if (!isObj(v)) return false;
  return (
    typeof v.emittedAt === "string" &&
    typeof v.builderEngine === "string" &&
    typeof v.builderVersion === "string" &&
    isStringArray(v.aggregateWarnings)
  );
}

function isCompoundSourceRequest(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (
    v.compoundProvidedBy !== "internal" &&
    v.compoundProvidedBy !== "partner"
  )
    return false;
  return isStrOrNull(v.partnerOrg);
}

/**
 * Strict shape guard for v2.0.0. Validates schemaVersion, compound, source
 * request, every layer block (each may be `null`), and provenance. Layer
 * blocks must be present as a key (either object or `null`) — `undefined`
 * is rejected so consumers can safely branch on `=== null`.
 */
export function isPreClinicalPackageV2(
  v: unknown,
): v is PreClinicalPackageV2 {
  if (!isObj(v)) return false;
  if (v.schemaVersion !== PRECLINICAL_PACKAGE_SCHEMA_VERSION_V2) return false;
  if (!isObj(v.compound)) return false;
  if (typeof (v.compound as Record<string, unknown>).smiles !== "string")
    return false;
  if (!isCompoundSourceRequest(v.sourceRequest)) return false;
  if (!("l1InVitro" in v) || !isL1Block(v.l1InVitro)) return false;
  if (!("l2Confirmation" in v) || !isL2Block(v.l2Confirmation)) return false;
  if (!("l4AnimalCohort" in v) || !isL4Block(v.l4AnimalCohort)) return false;
  if (!isPackageProvenanceV2(v.provenance)) return false;
  return true;
}

// ── v1 → v2 migration ──────────────────────────────────────────────────────

/**
 * Lift a v1 PreClinicalPackage into v2 shape. Lossy where v1 had no concept
 * (ex-vivo sub-track, per-layer confidence, user overrides, pre-confirmation
 * handoff): missing data surfaces as `null` blocks or "moderate" confidence
 * with an explicit "migrated from v1" basis, plus warnings appended at the
 * package level. NEVER fabricates evidence values.
 *
 * The v1 §6.1.a CYP/transporter panel and §6.1.b clearance-fractions are
 * lifted onto the L2 block with `derivedFrom: ["in-silico"]` when their
 * source was `"ml-prediction"` (i.e. derived from L1 ML priors flowing
 * through L2 in-silico), and `["ex-vivo"]` when their source was
 * `"in-vitro-experimental"`. `"user-provided"` → `["in-silico"]` with a
 * warning — user-provided in v1 had no track attribution and we refuse to
 * assume.
 */
export function migrateV1ToV2(
  v1: PreClinicalPackage,
  opts?: {
    sourceRequest?: CompoundSourceRequest;
    builderEngine?: string;
    builderVersion?: string;
  },
): PreClinicalPackageV2 {
  const now = new Date().toISOString();
  const builderEngine = opts?.builderEngine ?? "preclinical-handoff:migrateV1ToV2";
  const builderVersion = opts?.builderVersion ?? "1.0.0";
  const aggregateWarnings: string[] = [
    `Migrated from PreClinicalPackage v${v1.schemaVersion}; per-layer confidence ratings are placeholders ("moderate", basis="migrated from v1") because v1 carried no per-layer confidence.`,
  ];

  // Carry v1 provenance warnings forward at package level.
  for (const w of v1.provenance.warnings) {
    aggregateWarnings.push(`[v1.provenance] ${w}`);
  }

  // ── L1 In Vitro ────────────────────────────────────────────────────────
  const l1InVitro: L1InVitroBlock = {
    evidence: {
      hergIc50UM: v1.inVitro.hergIc50UM,
      caco2Permeability: v1.inVitro.caco2Permeability,
      plasmaProteinBindingFraction: v1.inVitro.plasmaProteinBindingFraction,
      primaryTargetUniprot: v1.inVitro.primaryTargetUniprot,
      primaryTargetGeneSymbol: v1.inVitro.primaryTargetGeneSymbol,
      primaryTargetIc50nM: v1.inVitro.primaryTargetIc50nM,
      // v1 had no L1-level ML-priors block — they appeared inside §6.1
      // (cypTransporterPanel) when sourced from ML. Migration cannot safely
      // back-fill them onto L1 without re-deriving, so we leave as null and
      // emit a warning. Phase 1 consumers will see L1.mlAdmetPriors=null.
      mlAdmetPriors: null,
    },
    overrides: [],
    confidence: { level: "moderate", basis: "migrated from v1; no rating recorded" },
    provenance: {
      emittedAt: v1.provenance.emittedAt,
      engine: v1.provenance.emitterEngine,
      engineVersion: v1.provenance.l1EngineVersion ?? v1.provenance.emitterVersion,
      databaseQueries: [],
      warnings: [
        "L1.mlAdmetPriors is null after migration — v1 stored these inside §6.1.a; re-derive at L1 before relying on them.",
      ],
    },
  };

  // ── L2 Confirmation (in-silico sub-track only — v1 had no ex-vivo) ───
  const inSilicoSubTrack: InSilicoSubTrack = {
    evidence: {
      humanProjectedCmaxNgPerMl: v1.inSilico.humanProjectedCmaxNgPerMl,
      humanProjectedAucNgHPerMl: v1.inSilico.humanProjectedAucNgHPerMl,
      humanProjectedHalfLifeHours: v1.inSilico.humanProjectedHalfLifeHours,
      humanProjectedClearanceLPerHPerKg:
        v1.inSilico.humanProjectedClearanceLPerHPerKg,
      freeEnergyDdgKcalPerMol: v1.inSilico.freeEnergyDdgKcalPerMol,
      freeEnergyUncertaintyKcalPerMol:
        v1.inSilico.freeEnergyUncertaintyKcalPerMol,
    },
    // v1 had no handoff concept. We emit an empty handoff with a single
    // falsification criterion noting the migration so downstream tooling
    // can still narrow on `preConfirmationHandoff` without an `if/null`.
    preConfirmationHandoff: {
      schemaVersion: PRE_CONFIRMATION_HANDOFF_SCHEMA_VERSION,
      handoffId: `migrated-${v1.compound.smiles.slice(0, 16)}-${now}`,
      emittedAt: now,
      prioritizedAssays: [],
      predictedRanges: [],
      falsificationCriteria: [
        "MIGRATED FROM v1 — no in-silico predictions were emitted with explicit ex-vivo falsification criteria. Re-emit at L2 before relying on confirmation deltas.",
      ],
    },
    overrides: [],
    confidence: { level: "moderate", basis: "migrated from v1; no rating recorded" },
    provenance: {
      emittedAt: v1.provenance.emittedAt,
      engine: v1.provenance.emitterEngine,
      engineVersion: v1.provenance.l2EngineVersion ?? v1.provenance.emitterVersion,
      databaseQueries: [],
      warnings: [],
    },
  };

  // §6.1 panels — derivedFrom inferred from v1 source field.
  const ctpV1 = v1.cypTransporterPanel;
  let cypTransporterPanel: CypTransporterPanelV2 | null = null;
  if (ctpV1 !== null) {
    const sources = new Set<"in-silico" | "ex-vivo">();
    const map = (s: EvidenceSource) => {
      if (s === "ml-prediction") sources.add("in-silico");
      else if (s === "in-vitro-experimental") sources.add("ex-vivo");
      else if (s === "user-provided") {
        sources.add("in-silico");
        aggregateWarnings.push(
          "§6.1.a panel had source=user-provided in v1; mapped to derivedFrom=['in-silico'] in v2 — re-attribute manually if ex-vivo data backed it.",
        );
      }
    };
    map(ctpV1.cyp.source);
    map(ctpV1.transporters.source);
    if (sources.size === 0) sources.add("in-silico");
    cypTransporterPanel = {
      ...ctpV1,
      derivedFrom: Array.from(sources),
      confidence: {
        level: sources.has("ex-vivo") ? "moderate" : "low",
        basis: sources.has("ex-vivo")
          ? "ex-vivo confirmation present"
          : "ML/in-silico priors only; no ex-vivo confirmation",
      },
    };
  }

  const cfV1 = v1.clearanceFractions;
  let clearanceFractions: ClearanceFractionsV2 | null = null;
  if (cfV1 !== null) {
    const derived: ("in-silico" | "ex-vivo")[] =
      cfV1.source === "in-vitro-experimental" ? ["ex-vivo"] : ["in-silico"];
    if (cfV1.source === "user-provided") {
      aggregateWarnings.push(
        "§6.1.b clearance fractions had source=user-provided in v1; mapped to derivedFrom=['in-silico'] in v2 — re-attribute manually.",
      );
    }
    clearanceFractions = {
      ...cfV1,
      derivedFrom: derived,
      confidence: {
        level: derived.includes("ex-vivo") ? "moderate" : "low",
        basis: derived.includes("ex-vivo")
          ? "ex-vivo hepatocyte clearance present"
          : "in-silico/ML proxy only; no ex-vivo confirmation",
      },
    };
  }

  const l2Confirmation: L2ConfirmationBlock = {
    inSilico: inSilicoSubTrack,
    exVivo: null, // v1 had no ex-vivo concept
    cypTransporterPanel,
    clearanceFractions,
  };
  if (cypTransporterPanel === null) {
    aggregateWarnings.push(
      "L2.cypTransporterPanel is null after migration — v1 had no §6.1.a panel for this compound.",
    );
  }
  if (clearanceFractions === null) {
    aggregateWarnings.push(
      "L2.clearanceFractions is null after migration — v1 had no §6.1.b fractions for this compound.",
    );
  }

  // ── L4 Animal Cohort ───────────────────────────────────────────────────
  const l4AnimalCohort: L4AnimalCohortBlock = {
    evidence: v1.animalCohort,
    overrides: [],
    confidence: { level: "moderate", basis: "migrated from v1; no rating recorded" },
    provenance: {
      emittedAt: v1.provenance.emittedAt,
      engine: v1.provenance.emitterEngine,
      engineVersion: v1.provenance.l4EngineVersion ?? v1.provenance.emitterVersion,
      databaseQueries: v1.provenance.databaseQueries,
      warnings: [],
    },
  };

  return {
    schemaVersion: PRECLINICAL_PACKAGE_SCHEMA_VERSION_V2,
    compound: v1.compound,
    sourceRequest:
      opts?.sourceRequest ?? { compoundProvidedBy: "internal", partnerOrg: null },
    l1InVitro,
    l2Confirmation,
    l4AnimalCohort,
    provenance: {
      emittedAt: now,
      builderEngine,
      builderVersion,
      aggregateWarnings,
    },
  };
}
