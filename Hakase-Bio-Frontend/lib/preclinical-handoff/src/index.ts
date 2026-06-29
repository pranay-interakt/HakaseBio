/**
 * PreClinicalPackage v1.0.0
 *
 * The single typed handoff from BioDigital Twin (L1–L4 pre-clinical) to
 * Hakase Clinical (Phase 1–4 planners).
 *
 * Authoritative reference:
 *   - HakaseBio_4Layer_Architecture_Research §8 (the §8 boundary contract)
 *   - Hakase_Clinical_Databases_and_AI_Models §6.1 (CYP/transporter +
 *     renal/hepatic clearance fraction extensions required for Phase1Planner)
 *
 * STRICT POLICY (project-wide, do not relax):
 *   1. Every field that may not be derivable from current data is `T | null`
 *      — NEVER defaulted to a guess. Consumers MUST narrow on null and
 *      either surface the gap explicitly or refuse to plan downstream.
 *   2. No silent fallbacks. Every numeric default is forbidden; if the
 *      builder cannot honestly produce a value, it returns null and adds
 *      a warning to provenance.
 *   3. Schema is versioned — bump SCHEMA_VERSION on any breaking change.
 */

export const PRECLINICAL_PACKAGE_SCHEMA_VERSION = "1.0.0" as const;

// v2 (per-layer evidence blocks; in-silico + ex-vivo sub-tracks under L2
// Confirmation; per-layer confidence + user overrides; explicit
// pre-confirmation handoff). v1 remains the active contract consumed by
// Phase1Planner; v2 is published alongside and migration is opt-in via
// migrateV1ToV2(). See ./v2.ts for full design rationale.
export * from "./v2.js";

// v2.0.0 (Confirmation Architecture Specification — May 2026). Adds typed
// PreConfirmationDirective contract, FalsifierId registry, GatePolicySnapshot,
// OverrideRecord with authority chain, CategoricalExemption, JointOutput
// agree/disagree/partial/mlGap discriminator, RepairPath, write-time
// invariant validators (§6). See ./v2_0_0.ts for full design rationale.
export * from "./v2_0_0.js";
export * from "./falsifierRegistry.js";

// Evidence Hash Chain (May 2026) — tamper-evident SHA-256 chain across the
// four pre-clinical gates. See ./hashChain.ts for the construction rule.
export * from "./hashChain.js";

export type IsoTimestamp = string;

/** Where a derived field came from. `null` when the field itself is null. */
export type EvidenceSource =
  | "in-vitro-experimental"
  | "ml-prediction"
  | "user-provided"
  | null;

// ── Compound identity ────────────────────────────────────────────────────────

export interface CompoundIdentity {
  smiles: string;
  inchiKey: string | null;
  molecularWeight: number | null; // g/mol
  chemblId: string | null;
  preferredName: string | null;
}

// ── L1 In Vitro summary ──────────────────────────────────────────────────────

export interface InVitroSummary {
  hergIc50UM: number | null;
  caco2Permeability: number | null; // 10^-6 cm/s
  plasmaProteinBindingFraction: number | null; // 0..1 fraction bound
  primaryTargetUniprot: string | null;
  primaryTargetGeneSymbol: string | null;
  primaryTargetIc50nM: number | null;
}

// ── L2 In Silico summary ─────────────────────────────────────────────────────

export interface InSilicoSummary {
  humanProjectedCmaxNgPerMl: number | null;
  humanProjectedAucNgHPerMl: number | null;
  humanProjectedHalfLifeHours: number | null;
  humanProjectedClearanceLPerHPerKg: number | null;
  /** Stage 5 free-energy ΔΔG (only present if FEP was opt-in run). */
  freeEnergyDdgKcalPerMol: number | null;
  freeEnergyUncertaintyKcalPerMol: number | null;
}

// ── L4 Animal Cohort summary ─────────────────────────────────────────────────

export interface AnimalToxicityFlag {
  organ: string;
  risk: "low" | "moderate" | "high";
  finding: string;
  ichReference: string;
}

export interface AnimalCohortSummary {
  speciesId: string;
  speciesDisplayName: string;
  studyTypeId: string;
  studyTypeLabel: string;
  routeOfAdministration: string;
  noaelMgPerKg: number;
  mtdMgPerKg: number;
  fihDoseMg: number;
  fihDoseMgPerKg: number;
  hedBsaMgPerKg: number;
  hedPbpkMgPerKg: number;
  safetyMarginNoael: number;
  overallRisk: "low" | "moderate" | "high";
  toxicityFlags: AnimalToxicityFlag[];
  formulation: {
    formulationType: string;
    bcsClass: string | null;
  };
  indEnablingComplete: boolean;
}

// ── §6.1.a — CYP / transporter sub-payload ───────────────────────────────────
/**
 * Required by Phase1Planner DDI module. Each value is a probability (0..1)
 * of inhibition / substrate status, OR null if no signal is available.
 *
 * Per §6.1.a, the ground-truth source is in-vitro CYP/transporter assays.
 * In an MVP without those assays, an ML predictor (ADMET-AI) is acceptable
 * as long as `source` is set to `"ml-prediction"` and the consumer treats
 * those values as screening priors only — never as a substitute for the
 * regulatory-required in-vitro panel.
 */
export interface CypTransporterPanel {
  cyp: {
    cyp1a2InhibitionProb: number | null;
    cyp2c9InhibitionProb: number | null;
    cyp2c19InhibitionProb: number | null;
    cyp2d6InhibitionProb: number | null;
    cyp3a4InhibitionProb: number | null;
    /** Primary-hepatocyte mRNA fold-change. In-vitro only — null otherwise. */
    inductionMrnaFoldChange: number | null;
    source: EvidenceSource;
  };
  transporters: {
    pgpInhibitionProb: number | null;
    bcrpInhibitionProb: number | null;
    oatp1b1InhibitionProb: number | null;
    oatp1b3InhibitionProb: number | null;
    oct2InhibitionProb: number | null;
    mate1InhibitionProb: number | null;
    source: EvidenceSource;
  };
}

// ── §6.1.b — Renal-vs-hepatic clearance fractions ───────────────────────────
/**
 * Required by Phase1Planner Special-Pop module to branch
 * renal-impairment vs hepatic-impairment study planning.
 *
 * Fractions sum to 1.0 when the object is present. If estimation isn't
 * supportable from available data, the entire object is null — NOT
 * defaulted to 0.5/0.5 (which would be a silent fabrication).
 */
export interface ClearanceFractions {
  renalFraction: number;   // 0..1
  hepaticFraction: number; // 0..1
  biliaryFraction: number; // 0..1
  otherFraction: number;   // 0..1
  basis: string;           // textual derivation rationale
  source: EvidenceSource;
}

// ── Provenance ──────────────────────────────────────────────────────────────

export interface DatabasePullRecord {
  database: string;
  status: "success" | "failed" | "cached" | "skipped";
  timestamp: IsoTimestamp | null;
  resultCount: number | null;
}

export interface PreClinicalProvenance {
  emittedAt: IsoTimestamp;
  emitterEngine: string;
  emitterVersion: string;
  l1EngineVersion: string | null;
  l2EngineVersion: string | null;
  l4EngineVersion: string | null;
  databaseQueries: DatabasePullRecord[];
  warnings: string[];
}

// ── Top-level package ───────────────────────────────────────────────────────

export interface PreClinicalPackage {
  schemaVersion: typeof PRECLINICAL_PACKAGE_SCHEMA_VERSION;
  compound: CompoundIdentity;
  inVitro: InVitroSummary;
  inSilico: InSilicoSummary;
  animalCohort: AnimalCohortSummary;
  /** §6.1.a — null if no L1 ADMET-ML or in-vitro CYP data is available. */
  cypTransporterPanel: CypTransporterPanel | null;
  /** §6.1.b — null if route-fractional CL cannot be estimated. */
  clearanceFractions: ClearanceFractions | null;
  provenance: PreClinicalProvenance;
}

// ── Runtime guard (shape-only; consumers should still validate semantics) ───

// Internal shape predicates ------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNumOrNull(v: unknown): boolean {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}

function isStrOrNull(v: unknown): boolean {
  return v === null || typeof v === "string";
}

function isEvidenceSource(v: unknown): boolean {
  return (
    v === null ||
    v === "in-vitro-experimental" ||
    v === "ml-prediction" ||
    v === "user-provided"
  );
}

function isCompoundIdentity(v: unknown): boolean {
  if (!isObject(v)) return false;
  return (
    typeof v.smiles === "string" &&
    isStrOrNull(v.inchiKey) &&
    isNumOrNull(v.molecularWeight) &&
    isStrOrNull(v.chemblId) &&
    isStrOrNull(v.preferredName)
  );
}

function isInVitroSummary(v: unknown): boolean {
  if (!isObject(v)) return false;
  return (
    isNumOrNull(v.hergIc50UM) &&
    isNumOrNull(v.caco2Permeability) &&
    isNumOrNull(v.plasmaProteinBindingFraction) &&
    isStrOrNull(v.primaryTargetUniprot) &&
    isStrOrNull(v.primaryTargetGeneSymbol) &&
    isNumOrNull(v.primaryTargetIc50nM)
  );
}

function isInSilicoSummary(v: unknown): boolean {
  if (!isObject(v)) return false;
  return (
    isNumOrNull(v.humanProjectedCmaxNgPerMl) &&
    isNumOrNull(v.humanProjectedAucNgHPerMl) &&
    isNumOrNull(v.humanProjectedHalfLifeHours) &&
    isNumOrNull(v.humanProjectedClearanceLPerHPerKg) &&
    isNumOrNull(v.freeEnergyDdgKcalPerMol) &&
    isNumOrNull(v.freeEnergyUncertaintyKcalPerMol)
  );
}

function isAnimalCohortSummary(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (typeof v.speciesId !== "string") return false;
  if (typeof v.speciesDisplayName !== "string") return false;
  if (typeof v.studyTypeId !== "string") return false;
  if (typeof v.studyTypeLabel !== "string") return false;
  if (typeof v.routeOfAdministration !== "string") return false;
  for (const k of [
    "noaelMgPerKg",
    "mtdMgPerKg",
    "fihDoseMg",
    "fihDoseMgPerKg",
    "hedBsaMgPerKg",
    "hedPbpkMgPerKg",
    "safetyMarginNoael",
  ]) {
    if (typeof v[k] !== "number" || !Number.isFinite(v[k] as number))
      return false;
  }
  if (
    v.overallRisk !== "low" &&
    v.overallRisk !== "moderate" &&
    v.overallRisk !== "high"
  )
    return false;
  if (!Array.isArray(v.toxicityFlags)) return false;
  if (typeof v.indEnablingComplete !== "boolean") return false;
  if (!isObject(v.formulation)) return false;
  if (typeof (v.formulation as Record<string, unknown>).formulationType !== "string")
    return false;
  if (!isStrOrNull((v.formulation as Record<string, unknown>).bcsClass))
    return false;
  return true;
}

function isCypTransporterPanel(v: unknown): boolean {
  if (v === null) return true;
  if (!isObject(v)) return false;
  const cyp = v.cyp;
  const tx = v.transporters;
  if (!isObject(cyp) || !isObject(tx)) return false;
  for (const k of [
    "cyp1a2InhibitionProb",
    "cyp2c9InhibitionProb",
    "cyp2c19InhibitionProb",
    "cyp2d6InhibitionProb",
    "cyp3a4InhibitionProb",
    "inductionMrnaFoldChange",
  ]) {
    if (!isNumOrNull(cyp[k])) return false;
  }
  if (!isEvidenceSource(cyp.source)) return false;
  for (const k of [
    "pgpInhibitionProb",
    "bcrpInhibitionProb",
    "oatp1b1InhibitionProb",
    "oatp1b3InhibitionProb",
    "oct2InhibitionProb",
    "mate1InhibitionProb",
  ]) {
    if (!isNumOrNull(tx[k])) return false;
  }
  if (!isEvidenceSource(tx.source)) return false;
  return true;
}

function isClearanceFractions(v: unknown): boolean {
  if (v === null) return true;
  if (!isObject(v)) return false;
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
  if (!isEvidenceSource(v.source)) return false;
  return true;
}

function isProvenance(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (typeof v.emittedAt !== "string") return false;
  if (typeof v.emitterEngine !== "string") return false;
  if (typeof v.emitterVersion !== "string") return false;
  if (!isStrOrNull(v.l1EngineVersion)) return false;
  if (!isStrOrNull(v.l2EngineVersion)) return false;
  if (!isStrOrNull(v.l4EngineVersion)) return false;
  if (!Array.isArray(v.databaseQueries)) return false;
  if (!Array.isArray(v.warnings)) return false;
  if (!v.warnings.every((w: unknown) => typeof w === "string")) return false;
  return true;
}

/**
 * Strict shape guard for v1.0.0. Validates schemaVersion, every top-level
 * sub-object, and the §6.1 sub-payloads (which MUST be either a valid object
 * or explicitly `null` — `undefined` is rejected so consumers can safely
 * branch on `=== null`). This is the §8 boundary contract — do not weaken.
 */
export function isPreClinicalPackage(v: unknown): v is PreClinicalPackage {
  if (!isObject(v)) return false;
  if (v.schemaVersion !== PRECLINICAL_PACKAGE_SCHEMA_VERSION) return false;
  if (!isCompoundIdentity(v.compound)) return false;
  if (!isInVitroSummary(v.inVitro)) return false;
  if (!isInSilicoSummary(v.inSilico)) return false;
  if (!isAnimalCohortSummary(v.animalCohort)) return false;
  // §6.1 sub-payloads must be present as `null` or a valid object — never undefined.
  if (!("cypTransporterPanel" in v)) return false;
  if (!isCypTransporterPanel(v.cypTransporterPanel)) return false;
  if (!("clearanceFractions" in v)) return false;
  if (!isClearanceFractions(v.clearanceFractions)) return false;
  if (!isProvenance(v.provenance)) return false;
  return true;
}
