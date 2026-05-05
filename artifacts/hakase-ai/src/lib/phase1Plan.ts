/**
 * Phase 1 trial design types + starting-dose computation + dose-escalation
 * generator. Honest about what's computable: every method refuses with an
 * explicit reason when the upstream PreClinicalPackage lacks the inputs it
 * needs (NO silent fallbacks, NO assumed numbers).
 */

import type { PreClinicalPackage } from "@workspace/preclinical-handoff";

// ── Clinical-side scoping ──────────────────────────────────────────────────

export type PopulationBranch = "healthy-volunteers" | "patients";
export type RegulatoryRegion = "FDA" | "EMA" | "PMDA" | "CDSCO";
export type RiskTolerance = "conservative" | "standard" | "aggressive";

export interface ClinicalScoping {
  population: PopulationBranch;
  indication: string;
  targetProductProfile: string;
  region: RegulatoryRegion;
  riskTolerance: RiskTolerance;
  priorHumanExposure: boolean;
  populationRationale: string; // required when patients chosen for non-oncology
}

// ── Starting-dose method ───────────────────────────────────────────────────

export type StartingDoseMethod =
  | "HED-BSA"
  | "HED-PBPK"
  | "Lower-of-both"
  | "MABEL"
  | "Manual";

export interface StartingDoseInput {
  method: StartingDoseMethod;
  safetyFactor: number; // typically 10 (standard), 100 (high-risk biologic), 1000 (mAb FIH)
  mabelTargetOccupancy: number; // 0..1, default 0.1
  manualStartingDoseMgPerKg: number | null;
  bodyWeightKg: number; // default 70
}

// ── SAD / MAD design ───────────────────────────────────────────────────────

export type EscalationScheme =
  | "modified-fibonacci"
  | "geometric-2x"
  | "geometric-1.5x"
  | "PK-guided"
  | "manual";

export interface SadDesign {
  cohortSize: number; // 6+2 sentinel typical
  sentinelDosing: boolean;
  escalationScheme: EscalationScheme;
  maxPlannedDoseMg: number | null;
  exposureCapMultipleOfNoael: number; // Cmax × CapMultiple <= NOAEL exposure
  manualDoseLevelsMg: string; // comma-sep
}

export interface MadDesign {
  enabled: boolean;
  durationDays: number; // 7–14 typical, longer for chronic
  cohortSize: number;
  accumulationRatioTarget: number;
  carryForwardLowest: number; // index of SAD level to start MAD at
}

// ── Sub-studies ────────────────────────────────────────────────────────────

export interface SubStudies {
  foodEffect: boolean;
  ddiCocktail: boolean;
  tqtRequired: boolean; // conditional on hERG signal
  renalImpairment: boolean;
  hepaticImpairment: boolean;
}

// ── Stopping rules / Gate ──────────────────────────────────────────────────

export interface StoppingRules {
  haltOnAeGrade: 2 | 3 | 4;
  dltRateThreshold: number; // 0..1
  pauseOnExposureMultiple: number; // pause if Cmax > X × NOAEL exposure
  additionalRules: string;
}

export interface IndGateOverride {
  active: boolean;
  justification: string;
}

// ── Full Phase 1 design bundle ─────────────────────────────────────────────

export interface Phase1Design {
  scoping: ClinicalScoping;
  startingDose: StartingDoseInput;
  sad: SadDesign;
  mad: MadDesign;
  subStudies: SubStudies;
  stoppingRules: StoppingRules;
  indGateOverride: IndGateOverride;
}

export const EMPTY_PHASE1_DESIGN: Phase1Design = {
  scoping: {
    population: "healthy-volunteers",
    indication: "",
    targetProductProfile: "",
    region: "FDA",
    riskTolerance: "standard",
    priorHumanExposure: false,
    populationRationale: "",
  },
  startingDose: {
    method: "Lower-of-both",
    safetyFactor: 10,
    mabelTargetOccupancy: 0.1,
    manualStartingDoseMgPerKg: null,
    bodyWeightKg: 70,
  },
  sad: {
    cohortSize: 8,
    sentinelDosing: true,
    escalationScheme: "modified-fibonacci",
    maxPlannedDoseMg: null,
    exposureCapMultipleOfNoael: 0.5,
    manualDoseLevelsMg: "",
  },
  mad: {
    enabled: true,
    durationDays: 14,
    cohortSize: 8,
    accumulationRatioTarget: 1.5,
    carryForwardLowest: 1,
  },
  subStudies: {
    foodEffect: false,
    ddiCocktail: false,
    tqtRequired: false,
    renalImpairment: false,
    hepaticImpairment: false,
  },
  stoppingRules: {
    haltOnAeGrade: 3,
    dltRateThreshold: 0.33,
    pauseOnExposureMultiple: 0.5,
    additionalRules: "",
  },
  indGateOverride: {
    active: false,
    justification: "",
  },
};

// ── Smart defaults from §8 ────────────────────────────────────────────────

export interface AutoFilledField {
  /** Dotted path into Phase1Design, e.g. "scoping.riskTolerance". */
  path: string;
  /** Human label for the banner. */
  label: string;
  /** Concise rationale anchored to a §8 field. */
  reason: string;
  /** Stringified value applied. */
  value: string;
}

export interface DerivedPhase1Defaults {
  overrides: Phase1Design;
  applied: AutoFilledField[];
}

const isFinitePos = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Derive Phase 1 design defaults from a §8 PreClinicalPackage.
 * Only fields with a *defensible* §8 anchor are populated. Free-text fields
 * (indication, TPP, populationRationale beyond a stub) and fields needing a
 * therapeutic-target input (max planned dose) are left at EMPTY values for
 * the user to fill — never invented.
 *
 * Returns the FULL Phase1Design (caller decides whether to merge per-field).
 */
export function derivePhase1Defaults(
  pkg: PreClinicalPackage,
): DerivedPhase1Defaults {
  const out: Phase1Design = JSON.parse(JSON.stringify(EMPTY_PHASE1_DESIGN));
  const applied: AutoFilledField[] = [];

  const ac = pkg.animalCohort;
  const iv = pkg.inVitro;
  const isBiologic =
    pkg.compound.smiles.startsWith("BIOLOGIC:") ||
    (isFinitePos(pkg.compound.molecularWeight) &&
      pkg.compound.molecularWeight > 5000);

  // Risk tolerance ← overall preclinical risk
  if (ac.overallRisk === "high") {
    out.scoping.riskTolerance = "conservative";
    applied.push({
      path: "scoping.riskTolerance",
      label: "Risk tolerance",
      value: "conservative",
      reason: `animalCohort.overallRisk = "high"`,
    });
  }

  // Population branch ← high-risk signal
  const highRiskFlag = ac.toxicityFlags.some((f) => f.risk === "high");
  if (ac.overallRisk === "high" || highRiskFlag) {
    out.scoping.population = "patients";
    out.scoping.populationRationale =
      ac.overallRisk === "high"
        ? "L4 overall risk = high — healthy-volunteer exposure not appropriate."
        : `Toxicity flag of risk=high present (${ac.toxicityFlags.find((f) => f.risk === "high")?.organ ?? "unspecified organ"}).`;
    applied.push({
      path: "scoping.population",
      label: "Population branch",
      value: "patients",
      reason:
        ac.overallRisk === "high"
          ? `animalCohort.overallRisk = "high"`
          : `animalCohort.toxicityFlags contains risk = "high"`,
    });
  }

  // Starting-dose method
  const hedBsaOk = isFinitePos(ac.hedBsaMgPerKg);
  const hedPbpkOk = isFinitePos(ac.hedPbpkMgPerKg);
  if (isBiologic && isFinitePos(iv.primaryTargetIc50nM)) {
    out.startingDose.method = "MABEL";
    applied.push({
      path: "startingDose.method",
      label: "Starting-dose method",
      value: "MABEL",
      reason: `compound.molecularWeight > 5000 (or BIOLOGIC: prefix) AND inVitro.primaryTargetIc50nM is present — MABEL is the FDA/EMA-recommended method for biologics with a defined target.`,
    });
  } else if (hedBsaOk && hedPbpkOk) {
    out.startingDose.method = "Lower-of-both";
    applied.push({
      path: "startingDose.method",
      label: "Starting-dose method",
      value: "Lower-of-both (HED-BSA / HED-PBPK)",
      reason: `Both animalCohort.hedBsaMgPerKg and animalCohort.hedPbpkMgPerKg are present — most conservative choice.`,
    });
  } else if (hedBsaOk) {
    out.startingDose.method = "HED-BSA";
    applied.push({
      path: "startingDose.method",
      label: "Starting-dose method",
      value: "HED-BSA",
      reason: `Only animalCohort.hedBsaMgPerKg is present (HED-PBPK missing).`,
    });
  } else if (hedPbpkOk) {
    out.startingDose.method = "HED-PBPK";
    applied.push({
      path: "startingDose.method",
      label: "Starting-dose method",
      value: "HED-PBPK",
      reason: `Only animalCohort.hedPbpkMgPerKg is present (HED-BSA missing).`,
    });
  }

  // Safety factor — anchored to risk + biologic
  let sf = 10;
  let sfReason = `animalCohort.overallRisk = "low" → standard 10×.`;
  if (out.startingDose.method === "MABEL") {
    sf = 100;
    sfReason = `MABEL selected (biologic with defined target) — EMA TGN1412 lessons advise ≥100×.`;
  } else if (ac.overallRisk === "high") {
    sf = 100;
    sfReason = `animalCohort.overallRisk = "high" — 100× per FDA 2005 guidance.`;
  } else if (ac.overallRisk === "moderate") {
    sf = 50;
    sfReason = `animalCohort.overallRisk = "moderate" — 50× midpoint.`;
  }
  if (sf !== EMPTY_PHASE1_DESIGN.startingDose.safetyFactor) {
    out.startingDose.safetyFactor = sf;
    applied.push({
      path: "startingDose.safetyFactor",
      label: "Safety factor",
      value: `${sf}×`,
      reason: sfReason,
    });
  }

  // Sub-studies
  if (ac.routeOfAdministration === "oral") {
    out.subStudies.foodEffect = true;
    applied.push({
      path: "subStudies.foodEffect",
      label: "Food-effect arm",
      value: "enabled",
      reason: `animalCohort.routeOfAdministration = "oral" — food-effect arm is meaningful.`,
    });
  }
  if (isFinitePos(iv.hergIc50UM) && iv.hergIc50UM < 10) {
    out.subStudies.tqtRequired = true;
    applied.push({
      path: "subStudies.tqtRequired",
      label: "Thorough-QT arm",
      value: "enabled",
      reason: `inVitro.hergIc50UM = ${iv.hergIc50UM} µM < 10 µM threshold — TQT advised per ICH E14.`,
    });
  }
  const cyp = pkg.cypTransporterPanel;
  if (cyp) {
    const inhibProbs = [
      cyp.cyp.cyp1a2InhibitionProb,
      cyp.cyp.cyp2c9InhibitionProb,
      cyp.cyp.cyp2c19InhibitionProb,
      cyp.cyp.cyp2d6InhibitionProb,
      cyp.cyp.cyp3a4InhibitionProb,
      cyp.transporters.pgpInhibitionProb,
      cyp.transporters.bcrpInhibitionProb,
      cyp.transporters.oatp1b1InhibitionProb,
      cyp.transporters.oatp1b3InhibitionProb,
    ].filter((v): v is number => typeof v === "number");
    const maxInhib = inhibProbs.length ? Math.max(...inhibProbs) : 0;
    const induction = cyp.cyp.inductionMrnaFoldChange;
    const inductionTrip =
      typeof induction === "number" && induction >= 2;
    if (maxInhib > 0.5 || inductionTrip) {
      out.subStudies.ddiCocktail = true;
      applied.push({
        path: "subStudies.ddiCocktail",
        label: "DDI cocktail arm",
        value: "enabled",
        reason: inductionTrip
          ? `cypTransporterPanel.cyp.inductionMrnaFoldChange = ${induction}× ≥ 2 — induction risk.`
          : `cypTransporterPanel max inhibition probability = ${maxInhib.toFixed(2)} > 0.5 — DDI signal.`,
      });
    }
  }
  const cf = pkg.clearanceFractions;
  if (cf) {
    if (cf.renalFraction > 0.3) {
      out.subStudies.renalImpairment = true;
      applied.push({
        path: "subStudies.renalImpairment",
        label: "Renal-impairment arm",
        value: "enabled",
        reason: `clearanceFractions.renalFraction = ${(cf.renalFraction * 100).toFixed(0)}% > 30% — FDA renal-impairment study advised.`,
      });
    }
    if (cf.hepaticFraction > 0.3) {
      out.subStudies.hepaticImpairment = true;
      applied.push({
        path: "subStudies.hepaticImpairment",
        label: "Hepatic-impairment arm",
        value: "enabled",
        reason: `clearanceFractions.hepaticFraction = ${(cf.hepaticFraction * 100).toFixed(0)}% > 30% — FDA hepatic-impairment study advised.`,
      });
    }
  }

  // MAD duration ← projected human t½
  const t12 = pkg.inSilico.humanProjectedHalfLifeHours;
  if (typeof t12 === "number" && Number.isFinite(t12)) {
    let dur = 14;
    let durReason = "";
    if (t12 > 48) {
      dur = 28;
      durReason = `inSilico.humanProjectedHalfLifeHours = ${t12} h > 48 h — 28-day MAD needed for steady-state.`;
    } else if (t12 < 6) {
      dur = 7;
      durReason = `inSilico.humanProjectedHalfLifeHours = ${t12} h < 6 h — 7-day MAD sufficient for steady-state.`;
    }
    if (dur !== EMPTY_PHASE1_DESIGN.mad.durationDays) {
      out.mad.durationDays = dur;
      applied.push({
        path: "mad.durationDays",
        label: "MAD duration",
        value: `${dur} days`,
        reason: durReason,
      });
    }
  }

  // Stopping rule severity
  if (ac.overallRisk === "high") {
    out.stoppingRules.haltOnAeGrade = 2;
    applied.push({
      path: "stoppingRules.haltOnAeGrade",
      label: "Halt-on AE grade",
      value: "Grade 2",
      reason: `animalCohort.overallRisk = "high" — halt threshold lowered to Grade 2.`,
    });
  }

  return { overrides: out, applied };
}

// ── Computation ────────────────────────────────────────────────────────────

export interface StartingDoseResult {
  ok: boolean;
  doseMgPerKg: number | null;
  doseMg: number | null;
  rationale: string;
  refuseReason: string | null;
  warnings: string[];
}

export function computeStartingDose(
  pkg: PreClinicalPackage,
  input: StartingDoseInput,
): StartingDoseResult {
  const w = input.bodyWeightKg;
  const sf = input.safetyFactor;
  const warnings: string[] = [];

  if (!Number.isFinite(sf) || sf <= 0) {
    return {
      ok: false,
      doseMgPerKg: null,
      doseMg: null,
      rationale: "",
      refuseReason: "Safety factor must be a positive finite number.",
      warnings,
    };
  }

  if (input.method === "Manual") {
    const v = input.manualStartingDoseMgPerKg;
    if (v === null || !Number.isFinite(v) || v <= 0) {
      return {
        ok: false,
        doseMgPerKg: null,
        doseMg: null,
        rationale: "",
        refuseReason: "Manual method requires a positive starting dose (mg/kg).",
        warnings,
      };
    }
    return {
      ok: true,
      doseMgPerKg: v,
      doseMg: v * w,
      rationale: `Manual starting dose: ${v.toFixed(4)} mg/kg × ${w} kg = ${(v * w).toFixed(3)} mg.`,
      refuseReason: null,
      warnings: [
        "Manual method bypasses HED/MABEL derivation — provenance must record the source.",
      ],
    };
  }

  if (input.method === "HED-BSA") {
    const hed = pkg.animalCohort.hedBsaMgPerKg;
    if (!Number.isFinite(hed) || hed <= 0) {
      return refuseWith(
        "HED-BSA method requires animalCohort.hedBsaMgPerKg from the §8 package; current value is missing or non-positive.",
      );
    }
    const v = hed / sf;
    return {
      ok: true,
      doseMgPerKg: v,
      doseMg: v * w,
      rationale: `HED-BSA: ${hed.toFixed(3)} mg/kg ÷ safety factor ${sf} = ${v.toFixed(4)} mg/kg → ${(v * w).toFixed(3)} mg @ ${w} kg.`,
      refuseReason: null,
      warnings,
    };
  }

  if (input.method === "HED-PBPK") {
    const hed = pkg.animalCohort.hedPbpkMgPerKg;
    if (!Number.isFinite(hed) || hed <= 0) {
      return refuseWith(
        "HED-PBPK method requires animalCohort.hedPbpkMgPerKg from the §8 package.",
      );
    }
    const v = hed / sf;
    return {
      ok: true,
      doseMgPerKg: v,
      doseMg: v * w,
      rationale: `HED-PBPK: ${hed.toFixed(3)} mg/kg ÷ safety factor ${sf} = ${v.toFixed(4)} mg/kg → ${(v * w).toFixed(3)} mg @ ${w} kg.`,
      refuseReason: null,
      warnings,
    };
  }

  if (input.method === "Lower-of-both") {
    const a = pkg.animalCohort.hedBsaMgPerKg;
    const b = pkg.animalCohort.hedPbpkMgPerKg;
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) {
      return refuseWith(
        "Lower-of-both requires BOTH hedBsaMgPerKg and hedPbpkMgPerKg from the §8 package.",
      );
    }
    const lower = Math.min(a, b);
    const which = a < b ? "HED-BSA" : "HED-PBPK";
    const v = lower / sf;
    return {
      ok: true,
      doseMgPerKg: v,
      doseMg: v * w,
      rationale: `min(HED-BSA ${a.toFixed(3)}, HED-PBPK ${b.toFixed(3)}) = ${lower.toFixed(3)} mg/kg [${which}] ÷ ${sf} = ${v.toFixed(4)} mg/kg → ${(v * w).toFixed(3)} mg @ ${w} kg.`,
      refuseReason: null,
      warnings:
        Math.abs(a - b) / Math.max(a, b) > 0.5
          ? [
              `BSA and PBPK HED differ by >50% — review the L4 emit before locking the protocol.`,
            ]
          : [],
    };
  }

  // MABEL
  const ic50nM = pkg.inVitro.primaryTargetIc50nM;
  const mw = pkg.compound.molecularWeight;
  const cl = pkg.inSilico.humanProjectedClearanceLPerHPerKg;
  const t12 = pkg.inSilico.humanProjectedHalfLifeHours;
  const occ = input.mabelTargetOccupancy;
  if (
    ic50nM === null ||
    !Number.isFinite(ic50nM) ||
    ic50nM <= 0 ||
    mw === null ||
    !Number.isFinite(mw) ||
    mw <= 0 ||
    cl === null ||
    !Number.isFinite(cl) ||
    cl <= 0 ||
    t12 === null ||
    !Number.isFinite(t12) ||
    t12 <= 0
  ) {
    return refuseWith(
      "MABEL requires primaryTargetIc50nM, compound.molecularWeight, humanProjectedClearance and humanProjectedHalfLife — at least one is null or non-positive in the §8 package.",
    );
  }
  if (!Number.isFinite(occ) || occ <= 0 || occ >= 1) {
    return refuseWith("MABEL target occupancy must be in (0, 1).");
  }
  // C_target (M) for fractional Hill occupancy: C = IC50 × occ/(1-occ)
  const ic50_M = ic50nM * 1e-9;
  const c_target_M = ic50_M * (occ / (1 - occ));
  const c_target_ngml = c_target_M * mw * 1e6; // M → g/L → ng/mL
  // Vd estimate: Vd = CL × t½ / ln2  (L/kg given CL in L/h/kg)
  const vd_L_per_kg = (cl * t12) / Math.LN2;
  // dose_per_kg (mg/kg) ≈ C_target (mg/L) × Vd (L/kg)
  const c_target_mg_per_L = c_target_ngml / 1000;
  const mabelDoseMgPerKg = c_target_mg_per_L * vd_L_per_kg;
  const v = mabelDoseMgPerKg / sf;
  return {
    ok: true,
    doseMgPerKg: v,
    doseMg: v * w,
    rationale: `MABEL @ ${(occ * 100).toFixed(0)}% target occupancy: C_target=${c_target_ngml.toFixed(2)} ng/mL · Vd≈${vd_L_per_kg.toFixed(2)} L/kg → MABEL dose ${mabelDoseMgPerKg.toFixed(4)} mg/kg ÷ ${sf} = ${v.toFixed(5)} mg/kg → ${(v * w).toFixed(3)} mg @ ${w} kg.`,
    refuseReason: null,
    warnings: [
      "MABEL Vd is derived from CL × t½ / ln2 (one-compartment estimator). Cross-check with the L2 PBPK Vd if available.",
    ],
  };
}

function refuseWith(reason: string): StartingDoseResult {
  return {
    ok: false,
    doseMgPerKg: null,
    doseMg: null,
    rationale: "",
    refuseReason: reason,
    warnings: [],
  };
}

// ── Dose escalation ────────────────────────────────────────────────────────

const MOD_FIBONACCI_SEED = [2.0, 1.67, 1.5, 1.4];
const MOD_FIBONACCI_TAIL = 1.33;
const MAX_ESCALATION_LEVELS = 12;

export interface EscalationLevel {
  index: number;
  doseMg: number;
  doseMgPerKg: number;
  factorFromPrev: number | null;
}

export interface EscalationResult {
  ok: boolean;
  levels: EscalationLevel[];
  refuseReason: string | null;
  warnings: string[];
}

export function generateEscalation(
  startingDoseMgPerKg: number,
  bodyWeightKg: number,
  scheme: EscalationScheme,
  maxPlannedDoseMg: number | null,
  manualLevelsMg: string,
): EscalationResult {
  const warnings: string[] = [];
  const levels: EscalationLevel[] = [];

  if (scheme === "manual") {
    const parts = manualLevelsMg
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      return {
        ok: false,
        levels: [],
        refuseReason:
          "Manual escalation requires a comma-separated list of dose levels (mg).",
        warnings: [],
      };
    }
    const nums: number[] = [];
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isFinite(n) || n <= 0) {
        return {
          ok: false,
          levels: [],
          refuseReason: `Manual dose level "${p}" is not a positive finite number.`,
          warnings: [],
        };
      }
      nums.push(n);
    }
    nums.forEach((mg, i) => {
      levels.push({
        index: i + 1,
        doseMg: mg,
        doseMgPerKg: mg / bodyWeightKg,
        factorFromPrev: i === 0 ? null : mg / nums[i - 1],
      });
    });
    return { ok: true, levels, refuseReason: null, warnings };
  }

  if (!Number.isFinite(startingDoseMgPerKg) || startingDoseMgPerKg <= 0) {
    return {
      ok: false,
      levels: [],
      refuseReason: "Starting dose (mg/kg) must be positive to generate escalation.",
      warnings: [],
    };
  }
  if (
    maxPlannedDoseMg === null ||
    !Number.isFinite(maxPlannedDoseMg) ||
    maxPlannedDoseMg <= 0
  ) {
    return {
      ok: false,
      levels: [],
      refuseReason:
        "Max planned dose (mg) is required for non-manual escalation schemes.",
      warnings: [],
    };
  }

  const factorAt = (stepIdx: number): number | null => {
    if (scheme === "modified-fibonacci") {
      return stepIdx < MOD_FIBONACCI_SEED.length
        ? MOD_FIBONACCI_SEED[stepIdx]
        : MOD_FIBONACCI_TAIL;
    }
    if (scheme === "geometric-2x") return 2.0;
    if (scheme === "geometric-1.5x") return 1.5;
    return null;
  };

  if (factorAt(0) === null) {
    if (scheme === "PK-guided") {
      return {
        ok: false,
        levels: [],
        refuseReason:
          "PK-guided escalation requires Bayesian dose-finding inputs not yet wired. Use modified-fibonacci or geometric for now.",
        warnings: [],
      };
    }
    return {
      ok: false,
      levels: [],
      refuseReason: "Unknown escalation scheme.",
      warnings: [],
    };
  }

  let curMg = startingDoseMgPerKg * bodyWeightKg;
  levels.push({
    index: 1,
    doseMg: curMg,
    doseMgPerKg: startingDoseMgPerKg,
    factorFromPrev: null,
  });
  while (levels.length < MAX_ESCALATION_LEVELS) {
    const f = factorAt(levels.length - 1);
    if (f === null) break;
    const next = curMg * f;
    if (next > maxPlannedDoseMg * 1.001) break;
    curMg = next;
    levels.push({
      index: levels.length + 1,
      doseMg: curMg,
      doseMgPerKg: curMg / bodyWeightKg,
      factorFromPrev: f,
    });
  }
  if (levels.length < 3) {
    warnings.push(
      "Fewer than 3 escalation levels reached — verify max planned dose vs starting dose.",
    );
  }
  return { ok: true, levels, refuseReason: null, warnings };
}

// ── IND-enabling gate ──────────────────────────────────────────────────────

export interface IndGateStatus {
  pass: boolean;
  reason: string;
}

export function evaluateIndGate(
  pkg: PreClinicalPackage,
  override: IndGateOverride,
): IndGateStatus {
  if (pkg.animalCohort.indEnablingComplete) {
    return { pass: true, reason: "L4 marked indEnablingComplete = true." };
  }
  if (override.active && override.justification.trim().length >= 20) {
    return {
      pass: true,
      reason: `Override active — justification: "${override.justification.trim()}"`,
    };
  }
  return {
    pass: false,
    reason:
      "indEnablingComplete=false and no valid override (≥20 char justification) supplied — protocol emit blocked.",
  };
}

// ── Sub-study gating ───────────────────────────────────────────────────────

export interface SubStudyGate {
  feasible: boolean;
  reason: string;
}

export function gateSubStudies(pkg: PreClinicalPackage): {
  ddiCocktail: SubStudyGate;
  tqtAdvised: SubStudyGate;
  renalArm: SubStudyGate;
  hepaticArm: SubStudyGate;
  foodEffect: SubStudyGate;
} {
  const ddiCocktail: SubStudyGate =
    pkg.cypTransporterPanel === null
      ? {
          feasible: false,
          reason: "Requires §6.1.a CYP/Transporter panel — currently null.",
        }
      : { feasible: true, reason: "CYP/Transporter panel available." };

  const renalArm: SubStudyGate =
    pkg.clearanceFractions === null
      ? {
          feasible: false,
          reason: "Requires §6.1.b clearance fractions — currently null.",
        }
      : pkg.clearanceFractions.renalFraction >= 0.3
        ? {
            feasible: true,
            reason: `Renal fraction ${(pkg.clearanceFractions.renalFraction * 100).toFixed(0)}% ≥ 30% — renal-impairment arm advised.`,
          }
        : {
            feasible: true,
            reason: `Renal fraction ${(pkg.clearanceFractions.renalFraction * 100).toFixed(0)}% < 30% — arm optional.`,
          };

  const hepaticArm: SubStudyGate =
    pkg.clearanceFractions === null
      ? {
          feasible: false,
          reason: "Requires §6.1.b clearance fractions — currently null.",
        }
      : pkg.clearanceFractions.hepaticFraction +
            pkg.clearanceFractions.biliaryFraction >=
          0.3
        ? {
            feasible: true,
            reason: `Hepatic+biliary ${(((pkg.clearanceFractions.hepaticFraction || 0) + (pkg.clearanceFractions.biliaryFraction || 0)) * 100).toFixed(0)}% ≥ 30% — hepatic-impairment arm advised.`,
          }
        : {
            feasible: true,
            reason: "Hepatic clearance < 30% — arm optional.",
          };

  // hERG → TQT: heuristic, hERG IC50 < 10 µM is a standard concern flag
  const herg = pkg.inVitro.hergIc50UM;
  const tqtAdvised: SubStudyGate =
    herg === null
      ? {
          feasible: false,
          reason: "hERG IC₅₀ unavailable — TQT advisability undetermined.",
        }
      : herg < 10
        ? {
            feasible: true,
            reason: `hERG IC₅₀ ${herg.toFixed(2)} µM < 10 µM — TQT or thorough QT assessment advised.`,
          }
        : {
            feasible: true,
            reason: `hERG IC₅₀ ${herg.toFixed(2)} µM ≥ 10 µM — TQT not flagged.`,
          };

  const foodEffect: SubStudyGate =
    pkg.animalCohort.routeOfAdministration === "oral"
      ? {
          feasible: true,
          reason: "Oral route — fed/fasted crossover at mid-SAD typical.",
        }
      : {
          feasible: false,
          reason: `Route is ${pkg.animalCohort.routeOfAdministration} — food-effect arm not applicable.`,
        };

  return { ddiCocktail, tqtAdvised, renalArm, hepaticArm, foodEffect };
}

// ── §9 Phase 1 Protocol output ────────────────────────────────────────────

export const PHASE1_PLAN_SCHEMA_VERSION = "1.0.0" as const;

export interface SubStudyDecision {
  selected: boolean;
  feasible: boolean;
  reason: string;
}

export interface Phase1Plan {
  schemaVersion: typeof PHASE1_PLAN_SCHEMA_VERSION;
  emittedAt: string;
  source: {
    schemaVersion: string;
    compoundName: string | null;
    smiles: string;
    pkgEmittedAt: string;
    pkgEmitterEngine: string;
    pkgEmitterVersion: string;
  };
  scoping: ClinicalScoping;
  startingDose: {
    method: StartingDoseMethod;
    safetyFactor: number;
    bodyWeightKg: number;
    mabelTargetOccupancy: number | null;
    doseMgPerKg: number;
    doseMg: number;
    rationale: string;
    warnings: string[];
  };
  sad: {
    escalationScheme: EscalationScheme;
    cohortSize: number;
    sentinelDosing: boolean;
    maxPlannedDoseMg: number | null;
    exposureCapMultipleOfNoael: number;
    levels: EscalationLevel[];
    warnings: string[];
  };
  mad:
    | {
        enabled: true;
        durationDays: number;
        cohortSize: number;
        accumulationRatioTarget: number;
        carryForwardLowestSadIndex: number;
      }
    | { enabled: false };
  subStudies: {
    foodEffect: SubStudyDecision;
    ddiCocktail: SubStudyDecision;
    tqtRequired: SubStudyDecision;
    renalImpairment: SubStudyDecision;
    hepaticImpairment: SubStudyDecision;
  };
  stoppingRules: StoppingRules;
  indGate: {
    pass: boolean;
    reason: string;
    indEnablingComplete: boolean;
    override: IndGateOverride;
  };
  warnings: string[];
}

export interface BuildPhase1PlanArgs {
  pkg: PreClinicalPackage;
  design: Phase1Design;
  dose: StartingDoseResult;
  escalation: EscalationResult;
  indGate: IndGateStatus;
  subGates: ReturnType<typeof gateSubStudies>;
}

export type BuildPhase1PlanResult =
  | { ok: true; plan: Phase1Plan }
  | { ok: false; refuseReason: string };

/**
 * Assemble the §9 Phase 1 Protocol handoff. Refuses (no fake fallbacks) if
 * any required upstream computation is not OK.
 */
export function buildPhase1Plan(
  args: BuildPhase1PlanArgs,
): BuildPhase1PlanResult {
  const { pkg, design, dose, escalation, indGate, subGates } = args;
  if (!indGate.pass)
    return { ok: false, refuseReason: `IND-enabling gate is closed: ${indGate.reason}` };
  if (!dose.ok || dose.doseMgPerKg === null || dose.doseMg === null)
    return {
      ok: false,
      refuseReason: dose.refuseReason ?? "Starting-dose computation refused.",
    };
  if (!escalation.ok)
    return {
      ok: false,
      refuseReason:
        escalation.refuseReason ?? "Escalation generation refused.",
    };

  const warnings: string[] = [
    ...dose.warnings,
    ...escalation.warnings,
    ...pkg.provenance.warnings,
  ];

  const decide = (
    selected: boolean,
    gate: { feasible: boolean; reason: string },
  ): SubStudyDecision => ({
    selected,
    feasible: gate.feasible,
    reason: gate.reason,
  });

  const plan: Phase1Plan = {
    schemaVersion: PHASE1_PLAN_SCHEMA_VERSION,
    emittedAt: new Date().toISOString(),
    source: {
      schemaVersion: pkg.schemaVersion,
      compoundName: pkg.compound.preferredName,
      smiles: pkg.compound.smiles,
      pkgEmittedAt: pkg.provenance.emittedAt,
      pkgEmitterEngine: pkg.provenance.emitterEngine,
      pkgEmitterVersion: pkg.provenance.emitterVersion,
    },
    scoping: design.scoping,
    startingDose: {
      method: design.startingDose.method,
      safetyFactor: design.startingDose.safetyFactor,
      bodyWeightKg: design.startingDose.bodyWeightKg,
      mabelTargetOccupancy:
        design.startingDose.method === "MABEL"
          ? design.startingDose.mabelTargetOccupancy
          : null,
      doseMgPerKg: dose.doseMgPerKg,
      doseMg: dose.doseMg,
      rationale: dose.rationale,
      warnings: dose.warnings,
    },
    sad: {
      escalationScheme: design.sad.escalationScheme,
      cohortSize: design.sad.cohortSize,
      sentinelDosing: design.sad.sentinelDosing,
      maxPlannedDoseMg: design.sad.maxPlannedDoseMg,
      exposureCapMultipleOfNoael: design.sad.exposureCapMultipleOfNoael,
      levels: escalation.levels,
      warnings: escalation.warnings,
    },
    mad: design.mad.enabled
      ? {
          enabled: true,
          durationDays: design.mad.durationDays,
          cohortSize: design.mad.cohortSize,
          accumulationRatioTarget: design.mad.accumulationRatioTarget,
          carryForwardLowestSadIndex: design.mad.carryForwardLowest,
        }
      : { enabled: false },
    subStudies: {
      foodEffect: decide(design.subStudies.foodEffect, subGates.foodEffect),
      ddiCocktail: decide(design.subStudies.ddiCocktail, subGates.ddiCocktail),
      tqtRequired: decide(design.subStudies.tqtRequired, subGates.tqtAdvised),
      renalImpairment: decide(design.subStudies.renalImpairment, subGates.renalArm),
      hepaticImpairment: decide(design.subStudies.hepaticImpairment, subGates.hepaticArm),
    },
    stoppingRules: design.stoppingRules,
    indGate: {
      pass: indGate.pass,
      reason: indGate.reason,
      indEnablingComplete: pkg.animalCohort.indEnablingComplete,
      override: design.indGateOverride,
    },
    warnings,
  };

  // Honest cross-checks
  for (const k of ["foodEffect","ddiCocktail","tqtRequired","renalImpairment","hepaticImpairment"] as const) {
    const d = plan.subStudies[k];
    if (d.selected && !d.feasible) {
      warnings.push(
        `Sub-study "${k}" selected but gate is not feasible — ${d.reason}`,
      );
    }
  }
  return { ok: true, plan };
}
