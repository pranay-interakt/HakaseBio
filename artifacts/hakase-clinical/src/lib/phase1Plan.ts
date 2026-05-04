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
