/**
 * IVIVE Wet-Lab Inputs (P0 — Cross-Species Foundation)
 *
 * Captures the single most defensibility-critical block of inputs for IVIVE:
 *   1. fu_p   — fraction unbound in plasma (per species)
 *   2. fu_mic — microsomal binding fraction unbound (per species)
 *   3. B/P    — blood-to-plasma ratio (per species)
 *
 * Per the IVIVE Input Scoping doc, fu_mic is the #1 reason published IVIVE
 * predictions diverge from observed clearance, and the cross-species rule
 * (human + ≥1 preclinical species value for every species-dependent
 * measurement) is the single biggest defensibility gap. This module is the
 * substrate for closing both.
 *
 * Anti-fabrication policy:
 *   - null means "not measured". The UI must render `—`. Never zero, never
 *     a synthetic fallback, never an inferred default.
 *   - Each cell carries its own `assayMethod` and `notes` provenance fields.
 *     If a value is supplied without a method, it is allowed but flagged in
 *     the audit trail.
 *   - Validation is range-strict: out-of-range values are rejected, not
 *     silently coerced.
 */

export const IVIE_SPECIES = ["human", "mouse", "rat", "dog", "monkey"] as const;
export type IvieSpecies = (typeof IVIE_SPECIES)[number];

export const IVIE_PRECLINICAL_SPECIES: ReadonlyArray<IvieSpecies> = ["mouse", "rat", "dog", "monkey"];

export const IVIE_SPECIES_LABEL: Record<IvieSpecies, string> = {
  human:  "Human",
  mouse:  "Mouse",
  rat:    "Rat",
  dog:    "Dog (Beagle)",
  monkey: "Monkey (Cyno)",
};

export type IvieMeasurement = "fuPlasma" | "fuMic" | "bpRatio";

export const IVIE_MEASUREMENT_LABEL: Record<IvieMeasurement, string> = {
  fuPlasma: "fu_p (plasma)",
  fuMic:    "fu_mic (microsomal)",
  bpRatio:  "B/P ratio",
};

export const IVIE_MEASUREMENT_UNIT: Record<IvieMeasurement, string> = {
  fuPlasma: "fraction (0–1)",
  fuMic:    "fraction (0–1)",
  bpRatio:  "ratio",
};

export const IVIE_MEASUREMENT_HELP: Record<IvieMeasurement, string> = {
  fuPlasma: "Fraction unbound in plasma at therapeutic concentration. Typical: 0.001–0.5. Equilibrium dialysis or ultrafiltration.",
  fuMic:    "Fraction unbound in microsomal incubation (1 mg/mL protein convention). Typical: 0.1–1.0. Equilibrium dialysis recommended.",
  bpRatio:  "Whole-blood-to-plasma concentration ratio. Typical: 0.5–2.5. Required by well-stirred liver model for hepatic clearance.",
};

export interface IvieCell {
  /** null = not measured. Never auto-fill. */
  value: number | null;
  /** Free-text assay method, e.g. "Equilibrium dialysis, 37°C, 4h, 1 mg/mL HLM". */
  assayMethod: string;
  /** Free-text notes (lot, source, deviations). */
  notes: string;
}

export type IvieMatrix = Record<IvieSpecies, IvieCell>;

export interface IvieWetLabInputs {
  fuPlasma: IvieMatrix;
  fuMic:    IvieMatrix;
  bpRatio:  IvieMatrix;
  enteredBy: string;
  enteredAt: string | null;
  /** Engine version pin — bumped when the schema changes. */
  schemaVersion: string;
}

const IVIE_SCHEMA_VERSION = "1.0.0";

export function emptyIvieCell(): IvieCell {
  return { value: null, assayMethod: "", notes: "" };
}

export function emptyIvieMatrix(): IvieMatrix {
  return IVIE_SPECIES.reduce((acc, sp) => {
    acc[sp] = emptyIvieCell();
    return acc;
  }, {} as IvieMatrix);
}

export function emptyIvieWetLabInputs(): IvieWetLabInputs {
  return {
    fuPlasma: emptyIvieMatrix(),
    fuMic:    emptyIvieMatrix(),
    bpRatio:  emptyIvieMatrix(),
    enteredBy: "",
    enteredAt: null,
    schemaVersion: IVIE_SCHEMA_VERSION,
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateIvieValue(kind: IvieMeasurement, raw: number): ValidationResult {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, reason: "must be a finite number" };
  }
  switch (kind) {
    case "fuPlasma":
      if (raw <= 0 || raw > 1) return { ok: false, reason: "fu_p must be in (0, 1]" };
      return { ok: true };
    case "fuMic":
      if (raw <= 0 || raw > 1) return { ok: false, reason: "fu_mic must be in (0, 1]" };
      return { ok: true };
    case "bpRatio":
      if (raw <= 0 || raw > 10) return { ok: false, reason: "B/P must be in (0, 10]" };
      return { ok: true };
  }
}

// ─── Tier assessment (matches the three-tier scoping in the IVIVE doc) ───────

export type IvieTier = "Insufficient" | "Minimum" | "Standard" | "Premium";

export interface IvieTierAssessment {
  tier: IvieTier;
  /** True iff the cross-species rule is satisfied for fu_p AND B/P. */
  crossSpeciesRuleSatisfied: boolean;
  haveFuPlasmaHuman: boolean;
  haveFuMicHuman: boolean;
  haveBpHuman: boolean;
  preclinicalSpeciesWithFuPlasma: IvieSpecies[];
  preclinicalSpeciesWithFuMic:    IvieSpecies[];
  preclinicalSpeciesWithBp:       IvieSpecies[];
  /** Concrete next-step gaps to reach the next tier up. */
  missingForNextTier: string[];
  /** Total non-null cells / total cells (15 = 3 measurements × 5 species). */
  completionFraction: number;
}

function hasValue(cell: IvieCell | undefined): boolean {
  // Strict: only `number` values count. `Number.isFinite` (not the global
  // `isFinite`) does not coerce strings — protects engine math from any
  // accidental string-numeric leak (e.g. legacy / corrupted localStorage).
  return !!cell && typeof cell.value === "number" && Number.isFinite(cell.value);
}

function preclinicalWith(matrix: IvieMatrix): IvieSpecies[] {
  return IVIE_PRECLINICAL_SPECIES.filter((sp) => hasValue(matrix[sp]));
}

export function assessIvieTier(inputs: IvieWetLabInputs): IvieTierAssessment {
  const haveFuPlasmaHuman = hasValue(inputs.fuPlasma.human);
  const haveFuMicHuman    = hasValue(inputs.fuMic.human);
  const haveBpHuman       = hasValue(inputs.bpRatio.human);

  const preFuP = preclinicalWith(inputs.fuPlasma);
  const preFuM = preclinicalWith(inputs.fuMic);
  const preBp  = preclinicalWith(inputs.bpRatio);

  const filledCells =
    IVIE_SPECIES.reduce((n, sp) => n
      + (hasValue(inputs.fuPlasma[sp]) ? 1 : 0)
      + (hasValue(inputs.fuMic[sp])    ? 1 : 0)
      + (hasValue(inputs.bpRatio[sp])  ? 1 : 0), 0);
  const completionFraction = filledCells / (IVIE_SPECIES.length * 3);

  // Tier rules — see IVIVE Input Scoping doc:
  //   Minimum   = fu_p (human)
  //   Standard  = + cross-species (mouse + rat) fu_p + B/P (human + ≥1 pre)
  //   Premium   = + fu_mic (human + ≥1 pre)
  const isMinimum  = haveFuPlasmaHuman;
  const hasMouseAndRatFuP = hasValue(inputs.fuPlasma.mouse) && hasValue(inputs.fuPlasma.rat);
  const isStandard = isMinimum && hasMouseAndRatFuP && haveBpHuman && preBp.length >= 1;
  const isPremium  = isStandard && haveFuMicHuman && preFuM.length >= 1;

  // Cross-species rule (the doc's defensibility test): both fu_p AND B/P need
  // human + ≥1 preclinical. (fu_mic is premium.)
  const crossSpeciesRuleSatisfied =
    haveFuPlasmaHuman && preFuP.length >= 1 &&
    haveBpHuman       && preBp.length  >= 1;

  let tier: IvieTier = "Insufficient";
  if (isPremium)       tier = "Premium";
  else if (isStandard) tier = "Standard";
  else if (isMinimum)  tier = "Minimum";

  const missingForNextTier: string[] = [];
  if (!isMinimum) {
    missingForNextTier.push("fu_p (human) — required for Minimum tier");
  } else if (!isStandard) {
    if (!hasValue(inputs.fuPlasma.mouse)) missingForNextTier.push("fu_p (mouse)");
    if (!hasValue(inputs.fuPlasma.rat))   missingForNextTier.push("fu_p (rat)");
    if (!haveBpHuman)                     missingForNextTier.push("B/P (human)");
    if (preBp.length === 0)               missingForNextTier.push("B/P for ≥1 preclinical species");
  } else if (!isPremium) {
    if (!haveFuMicHuman)        missingForNextTier.push("fu_mic (human) — premium tier");
    if (preFuM.length === 0)    missingForNextTier.push("fu_mic for ≥1 preclinical species");
  }

  return {
    tier,
    crossSpeciesRuleSatisfied,
    haveFuPlasmaHuman,
    haveFuMicHuman,
    haveBpHuman,
    preclinicalSpeciesWithFuPlasma: preFuP,
    preclinicalSpeciesWithFuMic:    preFuM,
    preclinicalSpeciesWithBp:       preBp,
    missingForNextTier,
    completionFraction,
  };
}

// ─── IVIVE math helpers ──────────────────────────────────────────────────────

/**
 * fu_mic correction for microsomal CL_int (Obach 1999).
 *
 * The well-stirred liver model assumes free-drug intrinsic clearance, but the
 * raw microsomal CL_int measured at 1 mg/mL protein contains *bound* drug too.
 * The corrected CL_int = measured CL_int / fu_mic.
 *
 * Returns the corrected CL_int (µL/min/mg). Throws if fu_mic is invalid.
 */
export function applyFuMicCorrection(
  microsomalCLint_uL_min_mg: number,
  fuMic: number,
): number {
  const v = validateIvieValue("fuMic", fuMic);
  if (!v.ok) throw new Error(`applyFuMicCorrection: invalid fu_mic — ${v.reason}`);
  if (typeof microsomalCLint_uL_min_mg !== "number"
      || !Number.isFinite(microsomalCLint_uL_min_mg)
      || microsomalCLint_uL_min_mg < 0) {
    throw new Error("applyFuMicCorrection: invalid CL_int");
  }
  return microsomalCLint_uL_min_mg / fuMic;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "hakase.ivieInputs.v1";

// ─── Strict runtime decoders (no blind cast — anti-fabrication) ──────────────
//
// localStorage is user-controllable; we decode it field-by-field and:
//   • drop any cell whose value is not a `number` (no string coercion),
//   • drop any cell whose value fails the per-measurement range check,
//   • fall back to `emptyIvieMatrix()` when the persisted matrix is missing
//     or malformed.
// Per project policy: no synthetic defaults. A dropped value becomes `null`
// (i.e. "—" in the UI), never zero or any placeholder.

function decodeCell(kind: IvieMeasurement, raw: unknown): IvieCell {
  if (!raw || typeof raw !== "object") return emptyIvieCell();
  const r = raw as Record<string, unknown>;
  let value: number | null = null;
  if (typeof r.value === "number" && Number.isFinite(r.value)) {
    if (validateIvieValue(kind, r.value).ok) value = r.value;
  }
  return {
    value,
    assayMethod: typeof r.assayMethod === "string" ? r.assayMethod : "",
    notes:       typeof r.notes       === "string" ? r.notes       : "",
  };
}

function decodeMatrix(kind: IvieMeasurement, raw: unknown): IvieMatrix {
  const r = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  return IVIE_SPECIES.reduce((acc, sp) => {
    acc[sp] = decodeCell(kind, r[sp]);
    return acc;
  }, {} as IvieMatrix);
}

/** Load from localStorage. Returns null if missing, wrong schema, or unparseable. */
export function loadIvieWetLabInputs(): IvieWetLabInputs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    // Schema-version pin — bump IVIE_SCHEMA_VERSION on any breaking change so
    // legacy payloads are rejected (rather than coerced) on load.
    if (p.schemaVersion !== IVIE_SCHEMA_VERSION) return null;
    const enteredAt = typeof p.enteredAt === "string" ? p.enteredAt : null;
    return {
      fuPlasma:  decodeMatrix("fuPlasma", p.fuPlasma),
      fuMic:     decodeMatrix("fuMic",    p.fuMic),
      bpRatio:   decodeMatrix("bpRatio",  p.bpRatio),
      enteredBy: typeof p.enteredBy === "string" ? p.enteredBy : "",
      enteredAt,
      schemaVersion: IVIE_SCHEMA_VERSION,
    };
  } catch {
    return null;
  }
}

/** Persist to localStorage. Silent failure (private mode, quota, etc.). */
export function saveIvieWetLabInputs(inputs: IvieWetLabInputs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(inputs));
  } catch {
    /* noop */
  }
}

// ─── Convenience accessors for the well-stirred model ────────────────────────

/** Returns human fu_p as a fraction or null if not provided. */
export function humanFuPlasma(inputs: IvieWetLabInputs): number | null {
  const c = inputs.fuPlasma.human;
  return hasValue(c) ? c.value : null;
}
export function humanFuMic(inputs: IvieWetLabInputs): number | null {
  const c = inputs.fuMic.human;
  return hasValue(c) ? c.value : null;
}
export function humanBpRatio(inputs: IvieWetLabInputs): number | null {
  const c = inputs.bpRatio.human;
  return hasValue(c) ? c.value : null;
}
