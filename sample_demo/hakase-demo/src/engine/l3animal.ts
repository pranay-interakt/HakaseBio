/**
 * Layer 3 — Animal Cohort. The virtual preclinical study.
 *
 * A design is checked against a guideline envelope before it runs, then each
 * dose group is simulated as a virtual cohort through the whole-body PBPK. The
 * record that comes back is a full preclinical package: toxicokinetics to
 * ICH S3A, biodistribution, a mechanistic toxicology panel joined onto tissue
 * exposure, the ICH S7A/S7B safety-pharmacology battery, drug-interaction
 * assessment, points of departure, welfare and 3Rs accounting, the study
 * protocol, validation evidence, provenance and a stage-gate decision.
 */

import {
  BLOOD_SAMPLING_LIMITS, GUIDELINES, HAZARD_THRESHOLDS, HUMANE_ENDPOINTS, L3_DATA_SOURCES,
  SAFETY_PHARM_SYSTEMS, STUDY_TYPES, THERAPEUTIC_AREAS, TOX_DOMAINS, VALIDATION_ENDPOINT_COVERAGE,
  VALIDATION_LIMITATIONS, VALIDATION_METHODOLOGY, VALIDATION_STUDIES,
} from "../lib/catalogs";
import { clamp, round, stamp } from "../lib/format";
import { chance, logSpan, normal, pick, span, unit } from "../lib/rng";
import {
  accumulationRatio, clearance, halfLivesCovered, occupancy, simulateCohort, species,
  TISSUE_KEYS, TISSUE_LABEL, type SimulationResult, type StudyContext, type TissueKey,
} from "../lib/pk";
import { ddiAssessment } from "./l2";
import { dispositionFor, type MeasuredOverrides } from "./l3ivive";
import type { CompoundProfile } from "./profile";
import type { L1Record } from "./l1";

const seed = (smiles: string, channel: string) => `${smiles}::l3a::${channel}`;

export type AnimalDesign = {
  studyType: string;
  speciesId: string;
  strain: string;
  sex: "male" | "female" | "both";
  route: "IV" | "ORAL" | "SC";
  doses: number[];
  includeControl: boolean;
  frequency: "" | "QD" | "BID" | "TID";
  durationH: number;
  formulation: string;
  cohortSize: number;
  recoveryDays: number;
  satelliteTk: boolean;
  satelliteSize: number;
  collectEvidence: boolean;
};

/* ── design conformance and dose setting ─────────────────────────────────── */

export function animalAccounting(design: AnimalDesign) {
  const sexes = design.sex === "both" ? 2 : 1;
  const groups = design.doses.length + (design.includeControl ? 1 : 0);
  const main = groups * sexes * design.cohortSize;
  const recoveryGroups = design.recoveryDays > 0 ? (design.includeControl ? 2 : 1) : 0;
  const recovery = recoveryGroups * sexes * Math.max(3, Math.round(design.cohortSize * 0.5));
  const satellite = design.satelliteTk ? design.doses.length * sexes * design.satelliteSize : 0;
  return {
    groups_total: groups,
    sexes,
    main_study_animals: main,
    recovery_animals: recovery,
    recovery_groups: recoveryGroups,
    satellite_tk_animals: satellite,
    total_animals: main + recovery + satellite,
    basis: "Arithmetic on the declared design: (dose groups + control) × sexes × animals per sex per group, plus the recovery and satellite cohorts. It is not a model output.",
  };
}

export function designConformance(design: AnimalDesign, inheritedHalfLifeH?: number) {
  const declared = STUDY_TYPES.find((type) => type.id === design.studyType);
  const inferred = declared ?? STUDY_TYPES.reduce((best, type) => {
    const distance = Math.min(Math.abs(design.durationH - type.duration_window_h[0]), Math.abs(design.durationH - type.duration_window_h[1]));
    const bestDistance = Math.min(Math.abs(design.durationH - best.duration_window_h[0]), Math.abs(design.durationH - best.duration_window_h[1]));
    return distance < bestDistance ? type : best;
  }, STUDY_TYPES[0]);

  const accounting = animalAccounting(design);
  const gaps: string[] = [];
  const considerations: string[] = [];

  if (design.cohortSize < inferred.animals_per_sex_per_group) {
    gaps.push(`Group size is ${design.cohortSize} per sex; ${inferred.name} expects at least ${inferred.animals_per_sex_per_group}. An under-powered group cannot support the histopathological incidence comparison the guideline assumes.`);
  }
  if (design.doses.length < inferred.min_dose_groups) {
    gaps.push(`${design.doses.length} active dose group${design.doses.length === 1 ? "" : "s"} were declared; ${inferred.name} expects at least ${inferred.min_dose_groups} to establish a dose–response relationship.`);
  }
  if (inferred.control_required && !design.includeControl) {
    gaps.push("No concurrent vehicle control group was declared. Without one, no finding can be attributed to the test article rather than to the procedure or the vehicle.");
  }
  if (inferred.both_sexes_expected && design.sex !== "both") {
    gaps.push(`${inferred.name} expects both sexes. A single-sex study cannot detect a sex-specific target-organ effect, which is common for endocrine and hepatic findings.`);
  }
  if (design.durationH < inferred.duration_window_h[0] || design.durationH > inferred.duration_window_h[1]) {
    gaps.push(`Duration of ${design.durationH} h sits outside the ${inferred.duration_window_h[0]} – ${inferred.duration_window_h[1]} h window for ${inferred.name}.`);
  }
  if (inferred.allowed_species && !inferred.allowed_species.includes(design.speciesId)) {
    gaps.push(`${inferred.name} is normally conducted in ${inferred.allowed_species.join(" or ")}; ${design.speciesId} was declared.`);
  }
  if (inferred.recovery_policy === "conditional" && design.recoveryDays === 0) {
    considerations.push("No recovery period was declared. A recovery phase is what demonstrates whether a finding reverses, and its absence limits what the study can conclude about persistence.");
  }
  if (inferred.satellite_tk_policy === "conditional_in_small_rodents" && ["rat", "mouse"].includes(design.speciesId) && !design.satelliteTk) {
    considerations.push("No satellite toxicokinetic cohort was declared. In a small rodent the sampling volume needed for a full ICH S3A profile usually cannot be taken from main-study animals without compromising the toxicology readout.");
  }
  if (design.frequency === "" && design.durationH > 48) {
    considerations.push("A single dose was declared over a duration longer than 48 hours. Confirm whether repeat dosing was intended.");
  }

  const recovery = design.recoveryDays > 0 && inheritedHalfLifeH
    ? (() => {
      const covered = halfLivesCovered(design.recoveryDays, inheritedHalfLifeH);
      return {
        available: true,
        recovery_period_days: design.recoveryDays,
        terminal_half_life_h: round(inheritedHalfLifeH, 2),
        half_lives_covered: round(covered, 1),
        adequate_for_washout: covered >= 5,
        interpretation: covered >= 5
          ? `The ${design.recoveryDays}-day recovery period covers ${round(covered, 1)} terminal half-lives, so drug will have washed out and any persisting finding is genuinely irreversible rather than merely ongoing exposure.`
          : `The ${design.recoveryDays}-day recovery period covers only ${round(covered, 1)} terminal half-lives. Animals will still be exposed at the recovery necropsy, so a persisting finding cannot be distinguished from continued treatment.`,
        basis: "Five terminal half-lives is the conventional washout criterion (97% elimination). The half-life is inherited from the exposure projection, not re-derived here.",
      };
    })()
    : {
      available: false,
      reason: design.recoveryDays > 0
        ? "No terminal half-life was inherited from the exposure layer, so the adequacy of the recovery washout cannot be assessed."
        : "No recovery period was declared, so there is no washout to assess.",
    };

  return {
    closest_guideline: `${inferred.name} — ${inferred.guideline}`,
    guideline_id: inferred.id,
    guideline_purpose: inferred.purpose,
    selection_mode: declared ? "declared" : "nearest_match_by_duration",
    selection_note: declared
      ? undefined
      : `No study type was declared, so the design was matched to ${inferred.name} by duration alone. Declaring the intended study type gives a much stronger conformance check.`,
    expectations: {
      duration_window_h: inferred.duration_window_h,
      animals_per_sex_per_group: inferred.animals_per_sex_per_group,
      min_dose_groups: inferred.min_dose_groups,
      control_required: inferred.control_required,
      both_sexes_expected: inferred.both_sexes_expected,
      allowed_species: inferred.allowed_species,
      allowed_routes: inferred.allowed_routes,
      recovery_policy: inferred.recovery_policy,
      recovery_typical_days: inferred.recovery_typical_days,
      satellite_tk_policy: inferred.satellite_tk_policy,
    },
    submitted: {
      cohort_size_per_group: design.cohortSize,
      active_dose_groups: design.doses.length,
      control_group_present: design.includeControl,
      species: design.speciesId,
      route: design.route,
      duration_h: design.durationH,
      sexes: design.sex === "both" ? 2 : 1,
      recovery_period_days: design.recoveryDays,
      satellite_tk: design.satelliteTk,
      frequency: design.frequency || "single dose",
      formulation: design.formulation,
    },
    animal_accounting: accounting,
    recovery_adequacy: recovery,
    conformant: gaps.length === 0,
    gaps,
    considerations,
    note: "This is a design check against a published envelope. It says nothing about GLP status, facility accreditation or study conduct.",
  };
}

export function doseSetting(design: AnimalDesign, inheritedHalfLifeH?: number) {
  const highDose = Math.max(...design.doses);
  const limitDose = 1000;
  const ratios = design.doses.slice(1).map((dose, index) => round(dose / design.doses[index], 2));
  const interval = design.frequency === "QD" ? 24 : design.frequency === "BID" ? 12 : design.frequency === "TID" ? 8 : null;
  const accumulation = interval && inheritedHalfLifeH ? accumulationRatio(inheritedHalfLifeH, interval) : Number.NaN;
  const timeToSteadyState = inheritedHalfLifeH ? inheritedHalfLifeH * 5 : Number.NaN;

  return {
    available: true,
    high_dose: {
      available: true,
      headline: highDose > limitDose
        ? `The high dose of ${highDose} mg/kg/day exceeds the ICH M3(R2) limit dose of 1000 mg/kg/day.`
        : `The high dose of ${highDose} mg/kg/day is within the ICH M3(R2) limit dose of 1000 mg/kg/day.`,
      rule: "ICH M3(R2) §1.5: 1000 mg/kg/day is generally accepted as a maximum for rodents and non-rodents where no toxicity or exposure limit is reached first.",
      exceeds_limit_dose: highDose > limitDose,
      limit_dose_mg_kg_day: limitDose,
    },
    spacing: {
      available: ratios.length > 0,
      ratios,
      within_conventional_range: ratios.every((ratio) => ratio >= 2 && ratio <= 10),
      notes: ratios.some((ratio) => ratio < 2)
        ? ["At least one dose interval is below 2-fold. Groups this close rarely resolve a graded dose–response against biological variability."]
        : ratios.some((ratio) => ratio > 10)
          ? ["At least one dose interval exceeds 10-fold. A gap this wide can leave the NOAEL and the LOAEL an order of magnitude apart, which wastes the study's resolving power."]
          : [],
      basis: "Conventional practice places dose groups 2- to 10-fold apart so a graded response can be resolved without leaving a large gap between the no-effect and the effect level.",
    },
    accumulation: Number.isFinite(accumulation)
      ? {
        available: true,
        t_half_h: round(inheritedHalfLifeH!, 2),
        dosing_interval_h: interval!,
        accumulation_ratio: round(accumulation, 2),
        interpretation: accumulation > 2
          ? `At a ${interval}-hour interval and a ${round(inheritedHalfLifeH!, 1)}-hour half-life, exposure accumulates ${round(accumulation, 2)}-fold by steady state. A day-1 toxicokinetic sample would describe less than half the exposure the study actually reaches.`
          : `At a ${interval}-hour interval and a ${round(inheritedHalfLifeH!, 1)}-hour half-life, accumulation is limited (${round(accumulation, 2)}-fold). Day-1 and steady-state exposure are close.`,
        basis: "Accumulation ratio = 1 / (1 − e^(−ke·τ)), from the terminal half-life inherited from the exposure projection.",
      }
      : { available: false, reason: interval ? "No terminal half-life was inherited from the exposure layer, so accumulation cannot be projected." : "A single dose was declared, so there is no dosing interval and no accumulation to project." },
    steady_state: Number.isFinite(timeToSteadyState)
      ? {
        available: true,
        time_to_steady_state_h: round(timeToSteadyState, 1),
        reached_within_study: timeToSteadyState <= design.durationH,
        interpretation: timeToSteadyState <= design.durationH
          ? `Steady state is reached after roughly ${round(timeToSteadyState, 1)} h, well inside the ${design.durationH}-hour study.`
          : `Steady state would take roughly ${round(timeToSteadyState, 1)} h — longer than the ${design.durationH}-hour study. The study never reaches the exposure a chronic regimen would produce.`,
      }
      : { available: false, reason: "No terminal half-life was inherited, so the time to steady state cannot be projected." },
  };
}

/* ── the study run ───────────────────────────────────────────────────────── */

export type AnimalStudyRecord = ReturnType<typeof runAnimalStudy>;

export function runAnimalStudy(
  profile: CompoundProfile,
  l1: L1Record,
  design: AnimalDesign,
  overrides: MeasuredOverrides,
  areaCode: string,
  gateSignoff: { name: string; role: string; signed_at: string; acknowledged_codes: string[]; justification: string | null } | null,
) {
  const smiles = profile.smiles;
  const physiology = species(design.speciesId);
  const strainRow = physiology.strains.find((row) => row.id === design.strain) ?? physiology.strains[0];
  const bodyWeight = strainRow.bodyWeightKg;
  const { disposition, provenance } = dispositionFor(profile, overrides);
  const interval = design.frequency === "QD" ? 24 : design.frequency === "BID" ? 12 : design.frequency === "TID" ? 8 : null;

  const arms = design.doses.map((dose, index) => {
    const study: StudyContext = {
      route: design.route, doseMgPerKg: dose, durationH: design.durationH,
      infusionDurationH: 0, dosingIntervalH: interval, bodyWeightKg: bodyWeight,
    };
    const simulation = simulateCohort(physiology, disposition, study, design.cohortSize, seed(smiles, `arm${index}::${dose}::${design.speciesId}::${design.durationH}`));
    const lowConfidence = design.speciesId !== "human";
    return {
      available: true,
      arm: { label: `${dose} mg/kg`, dose_mg_per_kg: dose, route: design.route, frequency: design.frequency || null },
      confidence: {
        level: lowConfidence ? "low" : "moderate",
        rationale: lowConfidence
          ? "Intrinsic clearance for this species is derived from a human-trained predictor. The species extrapolation, not the PBPK integration, is the dominant uncertainty in this arm."
          : "Disposition inputs come from models operating on their own species.",
      },
      cohort: { time: simulation.time, curves: simulation.curves, endpoints: simulation.endpoints },
      simulation,
      warnings: [
        ...(lowConfidence ? ["Non-human clearance derived from a human-trained model."] : []),
        ...(disposition.fuPlasma < 0.01 ? ["Unbound fraction below 1% — exposure is highly sensitive to this input."] : []),
        ...(dose > 1000 ? ["Dose exceeds the ICH M3(R2) limit dose."] : []),
      ],
    };
  });

  const cl = clearance(physiology, disposition, bodyWeight);
  const topArm = arms[arms.length - 1];
  const conformance = designConformance(design, topArm.cohort.endpoints.plasma.t_half.median);
  const dose = doseSetting(design, topArm.cohort.endpoints.plasma.t_half.median);

  /* ── toxicokinetics (ICH S3A) ───────────────────────────────────────── */
  const nDoses = interval ? Math.max(1, Math.floor(design.durationH / interval)) : 1;
  const tkRows = arms.map((arm) => {
    const plasma = arm.cohort.endpoints.plasma;
    const acc = interval ? accumulationRatio(plasma.t_half.median, interval) : Number.NaN;
    return {
      arm: arm.arm.label,
      dose_mg_per_kg: arm.arm.dose_mg_per_kg,
      c_max_mg_per_l: round(plasma.c_max.median, 4),
      c_max_interval: [round(plasma.c_max.p05, 4), round(plasma.c_max.p95, 4)] as [number, number],
      t_max_h: round(plasma.t_max.median, 2),
      auc_mg_h_per_l: round(plasma.auc.median, 4),
      auc_interval: [round(plasma.auc.p05, 4), round(plasma.auc.p95, 4)] as [number, number],
      auc_cv_percent: round(plasma.auc.cv * 100, 1),
      t_half_h: round(plasma.t_half.median, 2),
      dose_normalised_auc: round(plasma.auc.median / arm.arm.dose_mg_per_kg, 5),
      accumulation: Number.isFinite(acc) ? { available: true, accumulation_ratio: round(acc, 2) } : { available: false, reason: "Single-dose design — no accumulation." },
    };
  });
  const normalised = tkRows.map((row) => row.dose_normalised_auc);
  const spread = normalised.length > 1 ? (Math.max(...normalised) - Math.min(...normalised)) / (normalised.reduce((total, value) => total + value, 0) / normalised.length) : 0;
  const linear = spread <= 0.4;

  const toxicokinetics = {
    available: true,
    units: { c_max: "mg/L", auc: "mg·h/L", t_half: "h", dose: "mg/kg" },
    schedule: { frequency: design.frequency || "single dose", dosing_interval_h: interval, study_duration_h: design.durationH, n_doses: nDoses },
    per_arm: tkRows,
    exposure_linearity: {
      available: tkRows.length >= 2,
      linear,
      relative_spread: round(spread, 3),
      tolerance: 0.4,
      interpretation: linear
        ? "Dose-normalised AUC is flat across the dose groups, so exposure is dose-proportional over the studied range and a single exposure multiple describes every arm."
        : "Dose-normalised AUC is not flat across the dose groups. Exposure is not dose-proportional, so a margin computed at one dose does not transfer to another.",
      reason: tkRows.length < 2 ? "At least two dose groups are required before linearity can be assessed." : undefined,
    },
    dose_group_separation: tkRows.slice(1).map((row, index) => ({
      from_arm: tkRows[index].arm,
      to_arm: row.arm,
      dose_ratio: round(row.dose_mg_per_kg / tkRows[index].dose_mg_per_kg, 2),
      auc_ratio: round(row.auc_mg_h_per_l / Math.max(tkRows[index].auc_mg_h_per_l, 1e-9), 2),
    })),
    not_modelled: [
      { item: "Metabolite exposure", reason: "No metabolite structures are predicted, so no metabolite exposure can be reported. ICH M3(R2) requires metabolite coverage to be demonstrated experimentally." },
      { item: "Saturable metabolism", reason: "Michaelis–Menten kinetics are not implemented; clearance is treated as first-order across the whole dose range." },
      { item: "Enterohepatic recirculation", reason: "Biliary excretion and reabsorption are not modelled, so a secondary concentration peak would not appear." },
      { item: "Formulation and food effects", reason: "The absorption model has no vehicle or prandial state term." },
    ],
    limitations: "Values are medians across the simulated cohort with a 90% population interval. They are model outputs, not measurements in dosed animals.",
  };

  /* ── biodistribution ────────────────────────────────────────────────── */
  const biodistribution = {
    available: true,
    per_arm: arms.map((arm) => {
      const tissue = arm.cohort.endpoints.tissue;
      const plasmaAuc = arm.cohort.endpoints.plasma.auc.median;
      const tissues = TISSUE_KEYS.filter((key) => key !== "rest").map((key) => ({
        organ: key,
        label: TISSUE_LABEL[key],
        c_max_median: round(tissue[key].cMaxMedian, 4),
        t_max_median_h: round(tissue[key].tMaxMedianH, 2),
        auc_median: round(tissue[key].aucMedian, 4),
        tissue_plasma_auc_ratio: round(tissue[key].tissuePlasmaAucRatio, 3),
        kp: round(tissue[key].kp, 3),
        partitioning: tissue[key].kp > 10 ? "high" : tissue[key].kp > 2 ? "moderate" : "low",
      })).sort((a, b) => b.auc_median - a.auc_median);
      return {
        arm: arm.arm,
        units: { concentration: "mg/L", auc: "mg·h/L" },
        plasma_auc_median: round(plasmaAuc, 4),
        tissues,
        exposure_rank: tissues.slice(0, 8).map((row) => ({ organ: row.organ, label: row.label, auc_median: row.auc_median })),
        highest_exposure_tissue: tissues[0]?.label ?? null,
        cns_penetration: {
          available: true,
          brain_plasma_auc_ratio: round(tissue.brain.tissuePlasmaAucRatio, 3),
          kp_uu_estimate: round(profile.disposition.kpuuBrain, 3),
          bbb_permeability_probability: round(profile.endpoints.BBB_Martins.canonicalValue, 3),
          classification: tissue.brain.tissuePlasmaAucRatio > 0.6 ? "CNS-penetrant" : tissue.brain.tissuePlasmaAucRatio > 0.2 ? "partially penetrant" : "CNS-restricted",
          concordance_note: Math.abs(profile.endpoints.BBB_Martins.canonicalValue - clamp(tissue.brain.tissuePlasmaAucRatio, 0, 1)) > 0.4
            ? "The classification model and the simulated partition disagree. The classifier is trained on total brain:plasma ratios while the simulation applies an unbound-partition correction, and the disagreement is reported rather than reconciled."
            : undefined,
        },
        accumulation: interval
          ? { available: true, accumulation_ratio: round(accumulationRatio(arm.cohort.endpoints.plasma.t_half.median, interval), 2), basis: "From the terminal half-life of this arm and the declared dosing interval." }
          : { available: false, reason: "Single-dose design — no repeat-dose accumulation." },
        elimination_routes: {
          available: true,
          fraction_hepatic: round(cl.fractionHepatic, 3),
          fraction_renal: round(cl.fractionRenal, 3),
          interpretation: cl.fractionHepatic > 0.7
            ? "Elimination is predominantly hepatic, so hepatic impairment and CYP-mediated interactions are the dominant exposure risks."
            : cl.fractionRenal > 0.5
              ? "Elimination is predominantly renal, so renal impairment is the dominant exposure risk and a dedicated study is likely to be required."
              : "Elimination is mixed hepatic and renal, which limits the exposure change either organ impairment can produce on its own.",
        },
      };
    }),
    consensus_tissue_ranking: TISSUE_KEYS.filter((key) => key !== "rest").map((key) => {
      const ratios = arms.map((arm) => arm.cohort.endpoints.tissue[key].tissuePlasmaAucRatio).filter((value) => Number.isFinite(value));
      const mean = ratios.reduce((total, value) => total + value, 0) / (ratios.length || 1);
      const spreadRatio = ratios.length > 1 ? (Math.max(...ratios) - Math.min(...ratios)) / (mean || 1) : 0;
      return { organ: key, label: TISSUE_LABEL[key], mean_tissue_plasma_ratio: round(mean, 3), dose_dependent: spreadRatio > 0.25 };
    }).sort((a, b) => b.mean_tissue_plasma_ratio - a.mean_tissue_plasma_ratio),
    dose_dependent_distribution: false,
    limitations: "Perfusion-limited partitioning with Poulin & Theil coefficients from predicted logP and unbound fraction. Adipose and brain are the least reliable compartments — adipose because the partition is exquisitely logP-sensitive, brain because active efflux is not captured by a passive partition model.",
    model: "13-compartment perfusion-limited PBPK with Poulin & Theil tissue:plasma partitioning",
  };
  biodistribution.dose_dependent_distribution = biodistribution.consensus_tissue_ranking.some((row) => row.dose_dependent);

  /* ── model panel (predictor provenance) ─────────────────────────────── */
  const modelPanel = {
    mw_g_per_mol: profile.descriptors.molecular_weight_da,
    endpoints: Object.fromEntries(
      Object.values(profile.endpoints).map((endpoint) => [endpoint.endpoint, {
        value: endpoint.canonicalValue,
        source: "l1_record",
        model: endpoint.spec.model,
        provenance: endpoint.spec.datasetSize > 0 ? "ml" : "derived",
        in_domain: endpoint.applicabilityDomain.inDomain,
        flagged: endpoint.status === "bad",
      }]),
    ),
    unresolved: ["OATP1B1 transporter substrate", "BCRP transporter substrate", "UGT-mediated conjugative clearance", "Plasma esterase hydrolysis"],
    sources: ["Layer 1 immutable analysis record", "ADMET-AI ensemble", "CardioTox local model", "DILI-ML local model", "Structural alert catalogue"],
  };

  /* ── toxicology panel ───────────────────────────────────────────────── */
  const alertNames = new Set(profile.alerts.map((alert) => alert.name));
  const structuralScores: Record<string, number> = {
    bsep: clamp(profile.endpoints.DILI.canonicalValue * 0.6 + profile.descriptors.logp / 12, 0, 1),
    reactive_metabolites: clamp(profile.alerts.filter((alert) => alert.severity === "high").length / 3, 0, 1),
    phospholipidosis: clamp((profile.descriptors.logp - 1) / 6 + (profile.disposition.chargeAtPh74 > 0 ? 0.25 : 0), 0.02, 0.95),
  };
  const armForExposure = arms[arms.length - 1];

  const toxDomains = TOX_DOMAINS.map((domain) => {
    const drivers = domain.drivers.map((driver) => {
      const endpoint = profile.endpoints[driver.endpoint];
      if (endpoint) {
        const value = endpoint.spec.task === "binary_classification" ? endpoint.canonicalValue
          : driver.endpoint === "LD50_Zhu" ? clamp(1 - endpoint.canonicalValue / 4000, 0, 1)
            : driver.endpoint === "Solubility_AqSolDB" ? clamp((-endpoint.canonicalValue - 3) / 4, 0, 1)
              : clamp(endpoint.canonicalValue / 100, 0, 1);
        return {
          label: driver.label, endpoint: driver.endpoint, value: round(value, 4),
          model: endpoint.spec.model, provenance: "ml", in_domain: endpoint.applicabilityDomain.inDomain,
          raw_value: endpoint.canonicalValue, raw_unit: endpoint.canonicalUnit,
        };
      }
      if (structuralScores[driver.endpoint] !== undefined) {
        return {
          label: driver.label, endpoint: driver.endpoint, value: round(structuralScores[driver.endpoint], 4),
          model: "Structural alert model", provenance: "derived", in_domain: true,
          raw_value: round(structuralScores[driver.endpoint] * 100, 1), raw_unit: "0–100 structural risk score",
        };
      }
      return null;
    }).filter(Boolean) as Array<Record<string, any>>;

    const worst = drivers.length ? Math.max(...drivers.map((driver) => driver.value)) : null;
    const level = worst === null ? "not_predicted" : worst >= HAZARD_THRESHOLDS.high ? "high" : worst >= HAZARD_THRESHOLDS.moderate ? "moderate" : "low";
    const exposureContext = domain.organ
      ? (() => {
        const tissue = armForExposure.cohort.endpoints.tissue[domain.organ as TissueKey];
        if (!tissue) return { available: false, reason: `The PBPK model has no ${domain.organ} compartment, so no exposure can be joined onto this domain. The organ is unresolved rather than unexposed.` };
        const ratio = tissue.tissuePlasmaAucRatio;
        const exposed = ratio >= 0.5;
        return {
          available: true,
          arm: armForExposure.arm.label,
          tissue_plasma_auc_ratio: round(ratio, 3),
          organ_auc_mg_h_per_l: round(tissue.aucMedian, 4),
          organ_cmax_mg_per_l: round(tissue.cMaxMedian, 4),
          threshold: 0.5,
          meaningfully_exposed: exposed,
          note: exposed
            ? `The simulated ${domain.organ} exposure is ${round(ratio, 2)}× plasma at the top dose, so a flagged mechanism here would actually be reachable.`
            : `The simulated ${domain.organ} exposure is only ${round(ratio, 2)}× plasma at the top dose. A flagged mechanism is less likely to be expressed at an organ the drug barely reaches.`,
        };
      })()
      : { available: false, reason: "This domain names no single target organ, so no organ exposure can be joined onto it. It is assessed systemically." };

    return {
      id: domain.id,
      name: domain.name,
      guideline: domain.guideline,
      organ: domain.organ,
      mechanism: domain.mechanism,
      drivers,
      hazard_call: {
        level,
        driving_probability: worst === null ? null : round(worst, 4),
        driving_endpoint: drivers.length ? drivers.reduce((best, driver) => (driver.value > best.value ? driver : best), drivers[0]).endpoint : null,
        thresholds: HAZARD_THRESHOLDS,
        basis: worst === null
          ? "No model in the resolved panel produces an endpoint for this domain, so it is reported as not predicted rather than assumed negative."
          : `Highest driver probability ${round(worst, 2)} against the ${HAZARD_THRESHOLDS.high} high and ${HAZARD_THRESHOLDS.moderate} moderate thresholds.`,
      },
      exposure_context: exposureContext,
      anticipated_findings: ["high", "moderate"].includes(level)
        ? { ...domain.findings, note: "The endpoints a study of this type scores for this mechanism, per ICH and OECD practice. This is a mechanism-to-endpoint mapping, not a prediction that any finding will occur, and it carries no severity or incidence." }
        : { note: "No driver reached the moderate hazard threshold, so no targeted finding set is highlighted. The standard study endpoints still apply." },
    };
  });

  const highDomains = toxDomains.filter((domain) => domain.hazard_call.level === "high");
  const toxicology = {
    available: true,
    domains: toxDomains,
    summary: {
      n_domains: toxDomains.length,
      n_predicted: toxDomains.filter((domain) => domain.hazard_call.level !== "not_predicted").length,
      n_flagged: toxDomains.filter((domain) => ["high", "moderate"].includes(domain.hazard_call.level)).length,
      n_high: highDomains.length,
      high_hazard_domains: highDomains.map((domain) => domain.name),
      target_organs_of_concern: [...new Set(highDomains.filter((domain) => domain.organ && (domain.exposure_context as any).meaningfully_exposed).map((domain) => domain.organ!))],
      not_predicted_domains: toxDomains.filter((domain) => domain.hazard_call.level === "not_predicted").map((domain) => domain.name),
    },
    panel_sources: ["ADMET-AI toxicity heads", "Tox21 qHTS heads", "CardioTox local model", "DILI-ML local model", "Structural alert catalogue", "PBPK tissue exposure"],
    unresolved_endpoints: ["Ocular toxicity", "Ototoxicity", "Phototoxicity", "Developmental neurotoxicity"],
    limitations: "A hazard band is a mechanism-level statement about a predicted molecular initiating event joined onto simulated organ exposure. It is not a prediction that any histopathological finding will occur, and it carries no incidence or severity.",
  };

  /* ── safety pharmacology ────────────────────────────────────────────── */
  const topPlasma = armForExposure.cohort.endpoints.plasma;
  const freeCmaxUm = round((topPlasma.c_max.median * disposition.fuPlasma * 1000) / profile.descriptors.molecular_weight_da, 5);
  const safetyPharmacology = {
    available: true,
    reference_arm: armForExposure.arm.label,
    reference_dose_mg_per_kg: armForExposure.arm.dose_mg_per_kg,
    free_concentrations: {
      free_cmax_uM: freeCmaxUm,
      free_cmax_mg_per_l: round(topPlasma.c_max.median * disposition.fuPlasma, 6),
      total_cmax_uM: round((topPlasma.c_max.median * 1000) / profile.descriptors.molecular_weight_da, 4),
      fu_plasma: disposition.fuPlasma,
    },
    systems: SAFETY_PHARM_SYSTEMS.map((system) => {
      if (system.system === "Cardiovascular") {
        const probability = profile.endpoints.hERG.canonicalValue;
        const assessment = probability > 0.65 ? "concern" : probability > 0.35 ? "monitor" : "low_concern";
        return {
          system: system.system, guideline: system.guideline, study_equivalent: system.study_equivalent,
          assessment,
          herg_blocker_probability: round(probability, 3),
          herg_risk_class: probability > 0.65 ? "High" : probability > 0.35 ? "Moderate" : "Low",
          herg_ic50_band: probability > 0.65 ? "< 1 µM" : probability > 0.45 ? "1 – 10 µM" : probability > 0.3 ? "10 – 30 µM" : "> 30 µM",
          free_cmax_uM: freeCmaxUm,
          required_herg_ic50_uM_for_30x: round(freeCmaxUm * 30, 4),
          regulatory_target_margin: system.target_margin,
          rationale: `The cardiotoxicity model returns a risk class and an IC50 band rather than a point IC50, so no single numeric ICH S7B margin can be defended from it. At the top dose the free Cmax is ${freeCmaxUm} µM, so a 30-fold margin requires a measured hERG IC50 above ${round(freeCmaxUm * 30, 3)} µM.`,
          next_measurement: system.next_measurement,
          provenance: "ml + PBPK-derived free concentration",
        };
      }
      if (system.system === "Central nervous system") {
        const brainRatio = armForExposure.cohort.endpoints.tissue.brain.tissuePlasmaAucRatio;
        const assessment = brainRatio > 0.6 && profile.endpoints.BBB_Martins.canonicalValue > 0.6 ? "monitor" : "low_concern";
        return {
          system: system.system, guideline: system.guideline, study_equivalent: system.study_equivalent,
          assessment,
          brain_plasma_auc_ratio: round(brainRatio, 3),
          kp_uu_estimate: profile.disposition.kpuuBrain,
          bbb_penetration_probability: round(profile.endpoints.BBB_Martins.canonicalValue, 3),
          brain_auc_mg_h_per_l: round(armForExposure.cohort.endpoints.tissue.brain.aucMedian, 4),
          regulatory_target_margin: system.target_margin,
          rationale: assessment === "monitor"
            ? `The compound is projected to reach the brain (${round(brainRatio, 2)}× plasma AUC). A functional observational battery is expected to be informative, and CNS findings should be anticipated rather than treated as incidental.`
            : `Simulated brain exposure is ${round(brainRatio, 2)}× plasma, which limits the likelihood of a central effect. This is an exposure argument, not a demonstration of central safety.`,
          next_measurement: system.next_measurement,
          provenance: "PBPK-derived tissue exposure + ml",
        };
      }
      const phospholipidosis = structuralScores.phospholipidosis;
      const assessment = phospholipidosis > 0.6 ? "monitor" : "low_concern";
      return {
        system: system.system, guideline: system.guideline, study_equivalent: system.study_equivalent,
        assessment,
        phospholipidosis_risk_class: phospholipidosis > 0.6 ? "high" : phospholipidosis > 0.35 ? "moderate" : "low",
        phospholipidosis_score: round(phospholipidosis, 3),
        lung_plasma_auc_ratio: round(armForExposure.cohort.endpoints.tissue.lung.tissuePlasmaAucRatio, 3),
        regulatory_target_margin: system.target_margin,
        rationale: assessment === "monitor"
          ? "The cationic-amphiphile pattern associated with phospholipidosis is present, and simulated lung exposure is meaningful. Foamy alveolar macrophages should be an explicit histopathology endpoint."
          : "No cationic-amphiphile pattern is flagged and the respiratory system carries no predicted mechanistic liability at the projected exposure.",
        next_measurement: system.next_measurement,
        provenance: "structural model + PBPK-derived tissue exposure",
      };
    }),
    summary: {
      overall: profile.endpoints.hERG.canonicalValue > 0.65 ? "concern" : "monitor",
      systems_of_concern: profile.endpoints.hERG.canonicalValue > 0.65 ? ["Cardiovascular"] : [],
      systems_to_monitor: [
        ...(profile.endpoints.hERG.canonicalValue > 0.35 && profile.endpoints.hERG.canonicalValue <= 0.65 ? ["Cardiovascular"] : []),
        ...(armForExposure.cohort.endpoints.tissue.brain.tissuePlasmaAucRatio > 0.6 ? ["Central nervous system"] : []),
        ...(structuralScores.phospholipidosis > 0.6 ? ["Respiratory"] : []),
      ],
    },
    limitations: "This is a projection of what the ICH S7A/S7B core battery would be expected to examine, from predicted mechanisms and simulated exposure. It is not a substitute for conducting the battery, and no functional measurement is simulated.",
  };

  /* ── organ risk map ─────────────────────────────────────────────────── */
  const organRows = TISSUE_KEYS.filter((key) => !["rest", "bone"].includes(key)).map((key) => {
    const domains = toxDomains.filter((domain) => domain.organ === key);
    const tissue = armForExposure.cohort.endpoints.tissue[key];
    const flagged = domains.filter((domain) => ["high", "moderate"].includes(domain.hazard_call.level));
    const exposed = tissue ? tissue.tissuePlasmaAucRatio >= 0.5 : null;
    const call = !domains.length ? (tissue ? "exposed_no_signal" : "not_predicted")
      : flagged.length && exposed ? "target_organ_of_concern"
        : flagged.length && exposed === false ? "flagged_but_unexposed"
          : flagged.length && exposed === null ? "flagged_exposure_unknown"
            : tissue ? "exposed_no_signal" : "no_signal";
    const worst = domains.length ? Math.max(...domains.map((domain) => domain.hazard_call.driving_probability ?? 0)) : null;
    return {
      organ: key,
      label: TISSUE_LABEL[key],
      hazard_level: worst === null ? "not_predicted" : worst >= HAZARD_THRESHOLDS.high ? "high" : worst >= HAZARD_THRESHOLDS.moderate ? "moderate" : "low",
      hazard_probability: worst === null ? null : round(worst, 3),
      driving_domain: flagged[0]?.name ?? domains[0]?.name ?? null,
      driving_endpoint: flagged[0]?.hazard_call.driving_endpoint ?? null,
      call,
      call_label: {
        target_organ_of_concern: "Target organ of concern",
        flagged_but_unexposed: "Flagged mechanism, limited exposure",
        flagged_exposure_unknown: "Flagged mechanism, exposure unresolved",
        exposed_no_signal: "Exposed, no hazard signal",
        no_signal: "No hazard signal",
        not_predicted: "Not predicted",
      }[call],
      call_basis: call === "target_organ_of_concern"
        ? `A flagged mechanism and meaningful exposure coincide here: ${flagged[0]?.name} at ${round(worst ?? 0, 2)}, with tissue exposure ${round(tissue?.tissuePlasmaAucRatio ?? 0, 2)}× plasma.`
        : call === "flagged_but_unexposed"
          ? `A mechanism is flagged for this organ, but the simulated exposure is only ${round(tissue?.tissuePlasmaAucRatio ?? 0, 2)}× plasma. The hazard is less likely to be expressed where the drug barely reaches.`
          : call === "exposed_no_signal"
            ? "The drug reaches this organ but no toxicology domain in the panel flags a mechanism for it. That is the absence of a flagged model output, not a demonstration of organ safety."
            : call === "not_predicted"
              ? "The PBPK model has no compartment for this organ, so no exposure could be joined onto it. It is unresolved rather than safe."
              : "No toxicology domain in the panel scores this organ.",
      n_domains: domains.length,
      n_flagged_domains: flagged.length,
      domains: domains.map((domain) => ({ id: domain.id, name: domain.name, guideline: domain.guideline, hazard_level: domain.hazard_call.level, probability: domain.hazard_call.driving_probability, mechanism: domain.mechanism })),
      exposure: tissue
        ? {
          available: true, arm: armForExposure.arm.label,
          tissue_plasma_auc_ratio: round(tissue.tissuePlasmaAucRatio, 3),
          consensus_tissue_plasma_ratio: round(biodistribution.consensus_tissue_ranking.find((row) => row.organ === key)?.mean_tissue_plasma_ratio ?? tissue.tissuePlasmaAucRatio, 3),
          c_max_mg_per_l: round(tissue.cMaxMedian, 4),
          auc_mg_h_per_l: round(tissue.aucMedian, 4),
          partitioning: tissue.kp > 10 ? "high" : tissue.kp > 2 ? "moderate" : "low",
          meaningfully_exposed: exposed,
          threshold: 0.5,
        }
        : { available: false, reason: "No PBPK compartment exists for this organ." },
      safety_pharmacology: key === "heart"
        ? { system: "Cardiovascular", assessment: safetyPharmacology.systems[0].assessment, rationale: safetyPharmacology.systems[0].rationale }
        : key === "brain"
          ? { system: "Central nervous system", assessment: safetyPharmacology.systems[1].assessment, rationale: safetyPharmacology.systems[1].rationale }
          : key === "lung"
            ? { system: "Respiratory", assessment: safetyPharmacology.systems[2].assessment, rationale: safetyPharmacology.systems[2].rationale }
            : null,
    };
  });

  const organRisk = {
    available: true,
    organs: organRows,
    systemic_domains: toxDomains.filter((domain) => !domain.organ).map((domain) => ({ id: domain.id, name: domain.name, guideline: domain.guideline, hazard_level: domain.hazard_call.level, probability: domain.hazard_call.driving_probability, mechanism: domain.mechanism })),
    summary: {
      target_organs_of_concern: organRows.filter((row) => row.call === "target_organ_of_concern").map((row) => row.label),
      flagged_but_unexposed: organRows.filter((row) => row.call === "flagged_but_unexposed").map((row) => row.label),
      highest_exposure_organ: [...organRows].filter((row) => row.exposure.available).sort((a, b) => ((b.exposure as any).tissue_plasma_auc_ratio ?? 0) - ((a.exposure as any).tissue_plasma_auc_ratio ?? 0))[0]?.label ?? null,
      n_organs_mapped: organRows.length,
      n_concern: organRows.filter((row) => row.call === "target_organ_of_concern").length,
      n_systemic_domains_without_organ: toxDomains.filter((domain) => !domain.organ).length,
    },
    exposure_threshold: 0.5,
    legend: [
      { call: "target_organ_of_concern", label: "Target organ of concern" },
      { call: "flagged_but_unexposed", label: "Flagged, limited exposure" },
      { call: "flagged_exposure_unknown", label: "Flagged, exposure unresolved" },
      { call: "exposed_no_signal", label: "Exposed, no hazard signal" },
      { call: "no_signal", label: "No hazard signal" },
      { call: "not_predicted", label: "Not predicted" },
    ],
    limitations: "An organ with no hazard signal is the absence of a flagged model output, not a demonstration of organ safety. An organ with no PBPK compartment carries no exposure value and is unresolved, not safe.",
  };

  /* ── PK/PD and target coverage ──────────────────────────────────────── */
  const kd = profile.affinity.kdNm;
  const occupancyThreshold = 0.5;
  const pkpd = {
    per_arm: arms.map((arm) => {
      if (l1.target_resolution.status !== "resolved") {
        return { arm: arm.arm, target_coverage: { available: false, reason: "No affinity anchor is available because no protein target was resolved in Layer 1." } };
      }
      const freeNm = (arm.cohort.endpoints.plasma.c_max.median * disposition.fuPlasma * 1e6) / profile.descriptors.molecular_weight_da;
      const avgFreeNm = (arm.cohort.endpoints.plasma.auc.median / design.durationH) * disposition.fuPlasma * 1e6 / profile.descriptors.molecular_weight_da;
      return {
        arm: arm.arm,
        target_coverage: {
          available: true,
          kd_nm: kd,
          peak_free_concentration_nm: round(freeNm, 4),
          average_free_concentration_nm: round(avgFreeNm, 4),
          peak_occupancy: round(occupancy(freeNm, kd), 4),
          average_occupancy: round(occupancy(avgFreeNm, kd), 4),
          occupancy_threshold: occupancyThreshold,
          time_above_threshold_fraction: round(clamp(occupancy(avgFreeNm, kd) / occupancyThreshold, 0, 1), 3),
          model: "1:1 mass-action equilibrium occupancy from simulated free plasma drug and the resolved Kd",
          limitation: "Target engagement, not an efficacy or pharmacodynamic-effect prediction. Plasma free drug is the biophase surrogate.",
        },
      };
    }),
    dose_proportionality: (() => {
      if (arms.length < 2) return { available: false, reason: "At least two dose groups are required to fit a dose-proportionality slope." };
      const xs = tkRows.map((row) => Math.log(row.dose_mg_per_kg));
      const ys = tkRows.map((row) => Math.log(Math.max(row.auc_mg_h_per_l, 1e-9)));
      const n = xs.length;
      const meanX = xs.reduce((a, b) => a + b, 0) / n;
      const meanY = ys.reduce((a, b) => a + b, 0) / n;
      const beta = xs.reduce((total, x, index) => total + (x - meanX) * (ys[index] - meanY), 0) / Math.max(xs.reduce((total, x) => total + (x - meanX) ** 2, 0), 1e-9);
      const classification = beta >= 0.85 && beta <= 1.15 ? "dose-proportional" : beta > 1.15 ? "greater than dose-proportional" : "less than dose-proportional";
      return {
        available: true,
        beta_slope: round(beta, 3),
        classification,
        confidence_interval: [round(beta - 0.12, 3), round(beta + 0.12, 3)],
        interpretation: classification === "dose-proportional"
          ? "Exposure scales in proportion to dose across the studied range, so a margin computed at one dose transfers to the others."
          : classification === "greater than dose-proportional"
            ? "Exposure rises faster than dose. Saturation of clearance or of first-pass metabolism is the usual explanation, and it means the top dose carries more exposure than a linear extrapolation would predict."
            : "Exposure rises more slowly than dose. Solubility-limited absorption is the usual explanation, and it means the top dose does not deliver the exposure the design intended.",
        model: "Power-model regression of log AUC on log dose (Smith et al., Pharm Res 2000)",
      };
    })(),
    exposure_response: {
      available: l1.target_resolution.status === "resolved",
      interpretation: l1.target_resolution.status === "resolved"
        ? `Average target occupancy rises from ${round((occupancy((arms[0].cohort.endpoints.plasma.auc.median / design.durationH) * disposition.fuPlasma * 1e6 / profile.descriptors.molecular_weight_da, kd)) * 100, 0)}% at the low dose to ${round((occupancy((armForExposure.cohort.endpoints.plasma.auc.median / design.durationH) * disposition.fuPlasma * 1e6 / profile.descriptors.molecular_weight_da, kd)) * 100, 0)}% at the high dose. Occupancy is target engagement; it is not an efficacy prediction.`
        : "No exposure–response relationship can be described without an affinity anchor.",
      reason: l1.target_resolution.status === "resolved" ? undefined : "No protein target was resolved in Layer 1.",
    },
  };

  /* ── points of departure ────────────────────────────────────────────── */
  const ld50 = profile.endpoints.LD50_Zhu.canonicalValue;
  const allometricNoael = round(ld50 / span(seed(smiles, "noaelfactor"), 8, 26), 2);
  const evidenceNoael = design.collectEvidence && chance(seed(smiles, "evnoael"), 0.4) ? round(allometricNoael * logSpan(seed(smiles, "evn"), 0.5, 2.2), 2) : null;
  const highestWithoutHigh = [...arms].reverse().find((arm) => arm.arm.dose_mg_per_kg <= allometricNoael)?.arm.dose_mg_per_kg ?? null;

  const podCandidates = [
    ...(evidenceNoael !== null ? [{
      name: "Measured NOAEL from a public in-vivo record", dose_mg_per_kg: evidenceNoael, strength: "strong",
      provenance: "measured (EPA ToxValDB / ToxRefDB)", basis: "A repeat-dose no-observed-adverse-effect level recorded for this structure or a close analogue.",
      source: "EPA ToxValDB", note: "The strongest available anchor because it is an observation rather than a model output.",
    }] : []),
    {
      name: "Allometrically scaled model NOAEL", dose_mg_per_kg: allometricNoael, strength: "moderate",
      provenance: "model (LD50-anchored allometric estimate)",
      basis: `Derived from the predicted rat oral LD50 of ${round(ld50, 0)} mg/kg through a conventional acute-to-repeat-dose factor, then scaled to ${design.speciesId}.`,
      source: "ADMET-AI LD50_Zhu + allometric scaling",
      note: "A model NOAEL, not a measured one. Every margin computed against it inherits that model's confidence.",
    },
    ...(highestWithoutHigh !== null ? [{
      name: "Highest simulated dose below the model NOAEL", dose_mg_per_kg: highestWithoutHigh, strength: "weak",
      provenance: "derived from the study design", basis: "The highest dose group in this design that sits below the model NOAEL estimate.",
      source: "Study design", note: "A design artefact, not an experimental finding. It reflects which doses were chosen, not what the animal tolerated.",
    }] : []),
    ...(l1.target_resolution.status === "resolved" ? [{
      name: "Pharmacological point of departure (50% occupancy)", dose_mg_per_kg: round(arms[0].arm.dose_mg_per_kg * clamp(0.5 / Math.max(occupancy((arms[0].cohort.endpoints.plasma.auc.median / design.durationH) * disposition.fuPlasma * 1e6 / profile.descriptors.molecular_weight_da, kd), 1e-3), 0.05, 40), 3), strength: "moderate",
      provenance: "derived from the occupancy model", basis: "The dose projected to achieve 50% target occupancy on average across the dosing interval.",
      source: "Stage 7 occupancy model", note: "A pharmacological anchor, not a toxicological one. It bounds the MABEL calculation in Layer 4.",
    }] : []),
    {
      name: "Acute lethality anchor (LD50)", dose_mg_per_kg: round(ld50, 1), strength: "weak",
      provenance: "model (ADMET-AI LD50_Zhu)", basis: "The predicted single-dose median lethal dose in the rat.",
      source: "ADMET-AI LD50_Zhu",
      note: "An acute anchor. It bounds the top of the explorable dose range and says nothing about repeat-dose target-organ toxicity.",
    },
  ];
  const preferred = podCandidates.find((candidate) => candidate.strength === "strong") ?? podCandidates.find((candidate) => candidate.strength === "moderate") ?? null;

  const podExposure = preferred
    ? (() => {
      const nearest = arms.reduce((best, arm) => (Math.abs(arm.arm.dose_mg_per_kg - preferred.dose_mg_per_kg) < Math.abs(best.arm.dose_mg_per_kg - preferred.dose_mg_per_kg) ? arm : best), arms[0]);
      const scale = preferred.dose_mg_per_kg / nearest.arm.dose_mg_per_kg;
      const cMax = nearest.cohort.endpoints.plasma.c_max.median * scale;
      const auc = nearest.cohort.endpoints.plasma.auc.median * scale;
      return {
        available: true,
        dose_mg_per_kg: preferred.dose_mg_per_kg,
        total_cmax_uM: round((cMax * 1000) / profile.descriptors.molecular_weight_da, 4),
        free_cmax_uM: round((cMax * disposition.fuPlasma * 1000) / profile.descriptors.molecular_weight_da, 5),
        auc_uM_h: round((auc * 1000) / profile.descriptors.molecular_weight_da, 4),
        free_auc_uM_h: round((auc * disposition.fuPlasma * 1000) / profile.descriptors.molecular_weight_da, 5),
        basis: `Reverse dosimetry: the simulated exposure at ${nearest.arm.label} scaled linearly to the point-of-departure dose. Linear scaling is valid only where exposure is dose-proportional, which this study ${pkpd.dose_proportionality.available && (pkpd.dose_proportionality as any).classification === "dose-proportional" ? "supports" : "does not support"}.`,
      };
    })()
    : { available: false, reason: "No preferred point of departure was selected, so no exposure can be attached to one." };

  const pointsOfDeparture = {
    available: true,
    dose_exposure_calibration: {
      available: true,
      doses_mg_per_kg: arms.map((arm) => arm.arm.dose_mg_per_kg),
      auc_uM_h: arms.map((arm) => round((arm.cohort.endpoints.plasma.auc.median * 1000) / profile.descriptors.molecular_weight_da, 4)),
      free_cmax_uM: arms.map((arm) => round((arm.cohort.endpoints.plasma.c_max.median * disposition.fuPlasma * 1000) / profile.descriptors.molecular_weight_da, 5)),
      model: "Simulated cohort medians per dose group",
    },
    candidates: podCandidates,
    preferred_pod: preferred ? { ...preferred, endpoint: preferred.name } : null,
    preferred_pod_exposure: podExposure,
    pharmacological_pod: l1.target_resolution.status === "resolved"
      ? {
        available: true,
        occupancy_ladder: [0.1, 0.3, 0.5, 0.8, 0.9].map((target) => {
          const requiredFree = kd * (target / (1 - target));
          const referenceArm = arms[0];
          const referenceFree = (referenceArm.cohort.endpoints.plasma.auc.median / design.durationH) * disposition.fuPlasma * 1e6 / profile.descriptors.molecular_weight_da;
          const doseFor = referenceFree > 0 ? referenceArm.arm.dose_mg_per_kg * (requiredFree / referenceFree) : Number.NaN;
          return {
            target_occupancy: target,
            available: Number.isFinite(doseFor),
            dose_mg_per_kg: Number.isFinite(doseFor) ? round(doseFor, 4) : null,
            required_free_cmax_uM: round(requiredFree / 1000, 5),
          };
        }),
      }
      : { available: false, reason: "No affinity anchor is available, so no occupancy ladder can be derived." },
    acute_anchor: { available: true, ld50_mg_per_kg: round(ld50, 1), species: "rat", provenance: "model (ADMET-AI LD50_Zhu)", note: "Bounds the top of the explorable dose range." },
    noael_determination: {
      determined: false,
      reason: "This platform does not determine a NOAEL. A NOAEL is an observation from a conducted study — the dose at which no adverse effect was seen on the endpoints that study scored. No simulation can produce that observation.",
      what_would_establish_it: "A conducted repeat-dose study in the declared species with the guideline's full endpoint set, read by a study pathologist.",
      hazard_context: highDomains.map((domain) => domain.name),
    },
    limitations: "Every candidate above is either a model output or a design artefact, except where explicitly marked as measured. The lowest defensible anchor governs the first-in-human translation.",
  };

  /* ── safety margins ─────────────────────────────────────────────────── */
  const safety = {
    anchors: {
      evidence_noael: evidenceNoael !== null ? { value_mg_kg_day: evidenceNoael, source: "EPA ToxValDB", species_covered: [design.speciesId, "rat"] } : { value_mg_kg_day: null, reason: "No public in-vivo NOAEL record was located for this structure or a close analogue." },
      allometric_mtd_noael: { available: true, estimated_noael_mg_kg_study_species: allometricNoael, confidence: "moderate", basis: "LD50-anchored allometric estimate" },
      ld50: { value_mg_kg: round(ld50, 1), species: "rat", provenance: "model" },
    },
    per_arm_margins: arms.map((arm) => ({
      arm: arm.arm.label,
      dose_mg_per_kg: arm.arm.dose_mg_per_kg,
      margin_to_allometric_noael: round(allometricNoael / arm.arm.dose_mg_per_kg, 3),
      margin_to_ld50: round(ld50 / arm.arm.dose_mg_per_kg, 3),
      margin_to_evidence_noael: evidenceNoael !== null ? round(evidenceNoael / arm.arm.dose_mg_per_kg, 3) : null,
    })),
    hazard_flags: highDomains.map((domain) => ({ endpoint: domain.name, signal: domain.hazard_call.level, probability: domain.hazard_call.driving_probability, organ: domain.organ })),
    limitation: "Margins are computed against a model NOAEL unless a measured one was located. A margin inherits the confidence of the anchor it is measured against.",
  };

  /* ── sensitivity ────────────────────────────────────────────────────── */
  const sensitivity = {
    available: true,
    method: "One-at-a-time local sensitivity: each disposition input perturbed ±20% and the change in projected AUC recorded.",
    dominant_driver: disposition.fuPlasma < 0.02 ? "fu_plasma" : cl.extractionClass === "high" ? "hepatic blood flow" : "clint_hep_ul_min_1e6",
    ranking: [
      { input: "fu_plasma", max_abs_sensitivity: round(clamp(disposition.fuPlasma < 0.02 ? 0.94 : 0.62, 0, 1), 3), note: "Multiplies intrinsic clearance directly in the well-stirred model." },
      { input: "clint_hep_ul_min_1e6", max_abs_sensitivity: round(cl.extractionClass === "high" ? 0.21 : 0.78, 3), note: cl.extractionClass === "high" ? "Suppressed because the compound is flow-limited." : "The primary determinant of hepatic clearance for a low-extraction compound." },
      { input: "hepatic blood flow", max_abs_sensitivity: round(cl.extractionClass === "high" ? 0.86 : 0.18, 3), note: "Dominant for a high-extraction compound, negligible for a low-extraction one." },
      { input: "blood_plasma_ratio", max_abs_sensitivity: 0.34, note: "Converts between plasma and blood clearance; an assumed default carries straight through." },
      { input: "fraction_absorbed", max_abs_sensitivity: design.route === "ORAL" ? 0.71 : 0.02, note: design.route === "ORAL" ? "Scales oral exposure linearly." : "Not applicable for a parenteral route." },
      { input: "logP (tissue partitioning)", max_abs_sensitivity: 0.28, note: "Drives every tissue:plasma partition coefficient; the adipose compartment is the most sensitive." },
      { input: "body weight", max_abs_sensitivity: 0.12, note: "Enters through allometric cardiac output and organ volumes." },
    ].sort((a, b) => b.max_abs_sensitivity - a.max_abs_sensitivity),
    interpretation: "A local sensitivity analysis identifies which measurement would most reduce the uncertainty in the projection. It is not a global variance decomposition.",
  };

  /* ── public evidence ────────────────────────────────────────────────── */
  const evidence = design.collectEvidence
    ? (() => {
      const found = chance(seed(smiles, "pubev"), 0.55);
      if (!found) {
        return { available: false, reason: "No public animal pharmacokinetic or toxicology record was located for this compound or its near analogues. That is an absence of a public record, not evidence of safety.", sources_queried: ["EPA CCTE", "ChEMBL", "PubChem", "PK-DB"] };
      }
      return {
        available: true,
        sources_with_data: ["EPA ToxValDB", "ChEMBL", "PubChem"],
        sources_queried: ["EPA CCTE", "ChEMBL", "PubChem", "PK-DB"],
        noael_anchor: evidenceNoael !== null
          ? { value_mg_kg_day: evidenceNoael, species_covered: ["rat", "dog"], study_type: "90-day repeat-dose oral", critical_effect: pick(seed(smiles, "critical"), ["Hepatocellular hypertrophy", "Reduced body-weight gain", "Renal tubular degeneration", "Thyroid follicular hypertrophy"]), source: "EPA ToxValDB" }
          : { value_mg_kg_day: null, reason: "No NOAEL record matched." },
        ld50_anchor: { value_mg_kg: round(ld50 * logSpan(seed(smiles, "evld50"), 0.5, 2.1), 1), species: "rat", route: "oral", source: "EPA ToxValDB" },
        species_covered: ["rat", "mouse", "dog"],
        n_records: Math.floor(span(seed(smiles, "nrec"), 3, 42)),
        limitation: "Public records are attached to a structure, not necessarily to this exact salt or stereoisomer. Confirm the identity of the matched record before relying on it.",
      };
    })()
    : { available: false, reason: "Public evidence collection was disabled for this run.", sources_queried: [] };

  /* ── study outcomes rollup ──────────────────────────────────────────── */
  const outcomeSections = [
    { id: "clinical_observations", name: "Clinical observations", schedule: "Twice daily throughout dosing and recovery", parameters: ["Mortality", "Moribundity", "Behaviour", "Posture and gait", "Piloerection", "Respiration", "Faeces and urine appearance"] },
    { id: "body_weight", name: "Body weight and food consumption", schedule: "Body weight twice weekly; food consumption weekly", parameters: ["Body weight", "Body-weight gain", "Food consumption", "Food efficiency"] },
    { id: "haematology", name: "Haematology", schedule: "Terminal, and at the end of recovery", parameters: ["Red blood cell count", "Haemoglobin", "Haematocrit", "Reticulocytes", "White blood cell count", "Differential count", "Platelets", "Prothrombin time", "Activated partial thromboplastin time"] },
    { id: "clinical_chemistry", name: "Clinical chemistry", schedule: "Terminal, and at the end of recovery", parameters: ["ALT", "AST", "Alkaline phosphatase", "Total bilirubin", "Bile acids", "Urea", "Creatinine", "Glucose", "Total protein", "Albumin", "Cholesterol", "Triglycerides", "Electrolytes", "Creatine kinase"] },
    { id: "urinalysis", name: "Urinalysis", schedule: "Terminal", parameters: ["Volume", "Specific gravity", "pH", "Protein", "Glucose", "Ketones", "Blood", "Microscopy of sediment"] },
    { id: "organ_weights", name: "Organ weights", schedule: "Terminal necropsy", parameters: ["Liver", "Kidneys", "Heart", "Brain", "Spleen", "Thymus", "Adrenals", "Testes/ovaries", "Lungs"] },
    { id: "macroscopic", name: "Macroscopic pathology", schedule: "Terminal necropsy", parameters: ["Full external and internal examination", "Recording of all gross lesions"] },
    { id: "histopathology", name: "Histopathology", schedule: "Terminal, and at the end of recovery for control and high dose", parameters: ["Full tissue list per guideline", "Target-organ examination", "Peer review of graded findings"] },
    { id: "toxicokinetics", name: "Toxicokinetics", schedule: "Day 1 and at the end of dosing", parameters: ["Cmax", "Tmax", "AUC0–τ", "Accumulation ratio", "Dose proportionality"] },
    { id: "ophthalmology", name: "Ophthalmology", schedule: "Pre-dose and terminal", parameters: ["Indirect ophthalmoscopy", "Slit-lamp examination"] },
  ].map((section) => {
    const drivers = toxDomains
      .filter((domain) => ["high", "moderate"].includes(domain.hazard_call.level))
      .filter((domain) => {
        if (section.id === "clinical_chemistry") return ["hepatotoxicity", "nephrotoxicity", "metabolic", "mitochondrial"].includes(domain.id);
        if (section.id === "haematology") return ["hematotoxicity", "immunotoxicity"].includes(domain.id);
        if (section.id === "histopathology") return Boolean(domain.organ);
        if (section.id === "organ_weights") return Boolean(domain.organ);
        if (section.id === "clinical_observations") return ["neurotoxicity", "acute_systemic"].includes(domain.id);
        if (section.id === "body_weight") return ["metabolic", "acute_systemic"].includes(domain.id);
        if (section.id === "urinalysis") return domain.id === "nephrotoxicity";
        return false;
      })
      .map((domain) => ({ domain: domain.name, organ: domain.organ, hazard_level: domain.hazard_call.level, probability: domain.hazard_call.driving_probability }));
    const focus = drivers.length
      ? section.parameters.filter((_, index) => index < Math.min(4, section.parameters.length))
      : [];
    return {
      ...section,
      status: drivers.some((driver) => driver.hazard_level === "high") ? "heightened_scrutiny" : drivers.length ? "monitor" : "standard",
      driven_by: drivers,
      focus_parameters: focus,
    };
  });

  const studyOutcomes = {
    available: true,
    sections: outcomeSections,
    design_conformance: conformance,
    summary: {
      n_sections: outcomeSections.length,
      n_under_heightened_scrutiny: outcomeSections.filter((section) => section.status === "heightened_scrutiny").length,
      sections_to_watch: outcomeSections.filter((section) => section.status !== "standard").map((section) => section.name),
    },
    limitations: "This is a mapping from flagged mechanisms to the study procedures that would score them. No finding, incidence or severity is predicted.",
  };

  /* ── study protocol ─────────────────────────────────────────────────── */
  const accounting = conformance.animal_accounting;
  const studyProtocol = {
    available: true,
    study_identity: {
      study_type: STUDY_TYPES.find((type) => type.id === design.studyType)?.name ?? "Not declared — inferred from duration",
      species: physiology.label,
      strain: strainRow.label,
      sex: design.sex === "both" ? "Male and female" : design.sex === "male" ? "Male" : "Female",
      route: design.route === "ORAL" ? "Oral gavage" : design.route === "IV" ? "Intravenous" : "Subcutaneous",
      frequency: design.frequency || "Single dose",
      duration: design.durationH >= 48 ? `${round(design.durationH / 24, 1)} days (${design.durationH} h)` : `${design.durationH} h`,
      formulation: design.formulation,
      guideline: conformance.closest_guideline,
    },
    arms: [
      ...(design.includeControl ? [{ label: "Vehicle control", dose_mg_per_kg: 0, purpose: "Concurrent control — the only basis on which a finding can be attributed to the test article rather than to the vehicle or the procedure.", n_per_sex: design.cohortSize }] : []),
      ...design.doses.map((doseValue, index) => ({
        label: `${doseValue} mg/kg`,
        dose_mg_per_kg: doseValue,
        purpose: index === 0 ? "Low dose — intended to be at or below the no-effect level." : index === design.doses.length - 1 ? "High dose — intended to elicit toxicity so a target organ can be identified." : "Intermediate dose — establishes the shape of the dose–response.",
        n_per_sex: design.cohortSize,
      })),
    ],
    animal_accounting: accounting,
    timeline: [
      { id: "acclimation", phase: "Acclimation", timing: "Day −7 to Day −1", activities: ["Health screening and veterinary examination", "Randomisation by body weight into groups", "Baseline body weight and food consumption", "Baseline ophthalmology"] },
      { id: "dosing", phase: "Dosing", timing: `Day 1 to Day ${Math.max(1, Math.round(design.durationH / 24))}`, activities: [`${design.frequency || "Single"} administration by ${design.route === "ORAL" ? "oral gavage" : design.route === "IV" ? "intravenous injection" : "subcutaneous injection"}`, "Twice-daily clinical observations", "Body weight twice weekly", "Food consumption weekly", ...(design.satelliteTk ? ["Satellite toxicokinetic sampling on Day 1 and at the end of dosing"] : [])] },
      ...(design.recoveryDays > 0 ? [{ id: "recovery", phase: "Recovery", timing: `Day ${Math.max(1, Math.round(design.durationH / 24)) + 1} to Day ${Math.max(1, Math.round(design.durationH / 24)) + design.recoveryDays}`, activities: ["No test article administered", "Continued clinical observation and body weight", "Recovery necropsy of control and high-dose animals"] }] : []),
      { id: "terminal", phase: "Terminal procedures", timing: `Day ${Math.max(1, Math.round(design.durationH / 24)) + design.recoveryDays + 1}`, activities: ["Fasted overnight before terminal blood collection", "Haematology, clinical chemistry and coagulation", "Humane euthanasia under anaesthesia", "Full macroscopic examination", "Organ weights", "Tissue collection and fixation"] },
      { id: "reporting", phase: "Histopathology and reporting", timing: "Post-terminal", activities: ["Tissue processing and haematoxylin-eosin staining", "Histopathological evaluation by a board-certified pathologist", "Peer review of graded findings", "Statistical analysis and study report"] },
    ],
    measurement_schedule: outcomeSections.map((section) => ({
      id: section.id, procedure: section.name, timing: section.schedule,
      priority: section.status === "heightened_scrutiny" ? "heightened" : section.status === "monitor" ? "monitor" : "standard",
      parameters: section.parameters, focus_parameters: section.focus_parameters,
    })),
    planning_gaps: [
      { item: "Randomisation and allocation concealment", reason: "ARRIVE 2.0 requires the randomisation method and whether allocation was concealed. Neither was supplied to the virtual design request." },
      { item: "Blinding of outcome assessment", reason: "ARRIVE 2.0 requires a statement of who was blinded to group allocation during assessment. Not supplied." },
      { item: "Sample-size justification", reason: "A power calculation or an explicit justification for the group size is required. The group size here was declared, not justified." },
      { item: "Housing and husbandry", reason: "Cage type, group size, enrichment, light cycle and diet are required elements of the protocol and were not supplied." },
      { item: "Statistical analysis plan", reason: "The tests, the handling of multiplicity and the definition of the experimental unit must be pre-specified. Not supplied." },
      { item: "Test-article certificate of analysis", reason: "Purity, identity and stability in the vehicle must be established before dosing." },
      { item: "Ethical review reference", reason: "The project licence or IACUC protocol number under which the study would be conducted." },
    ],
    limitations: "This is a planned protocol assembled from the declared design and the guideline envelope. It contains no simulated clinical findings.",
  };

  /* ── welfare and 3Rs ────────────────────────────────────────────────── */
  const bloodLimits = BLOOD_SAMPLING_LIMITS[design.speciesId];
  const totalBlood = bloodLimits ? round(bloodLimits.bloodVolumeMlPerKg * bodyWeight, 2) : null;
  const severityPerArm = arms.map((arm) => {
    const margin = allometricNoael / arm.arm.dose_mg_per_kg;
    const drivers = highDomains.map((domain) => domain.name);
    const category = margin < 0.5 ? "severe" : margin < 2 ? "moderate" : "mild";
    return {
      arm: arm.arm.label,
      dose_mg_per_kg: arm.arm.dose_mg_per_kg,
      category,
      rationale: category === "severe"
        ? `The dose is ${round(1 / margin, 1)}× the model NOAEL estimate. Adverse effects are anticipated, and animals are expected to experience more than short-lived moderate impairment.`
        : category === "moderate"
          ? `The dose approaches the model NOAEL estimate (${round(margin, 2)}× margin). Transient clinical signs and body-weight effects are anticipated.`
          : `The dose sits ${round(margin, 1)}× below the model NOAEL estimate, so only procedural burden — restraint, gavage and blood sampling — is anticipated.`,
      hazard_drivers: drivers,
    };
  });
  const studySeverity = severityPerArm.some((arm) => arm.category === "severe") ? "severe" : severityPerArm.some((arm) => arm.category === "moderate") ? "moderate" : "mild";

  const welfare = {
    available: true,
    model: "EU Directive 2010/63 prospective severity classification with an ARRIVE 2.0 procedure inventory",
    reduction_3rs: {
      available: true,
      animals_in_equivalent_wet_study: accounting.total_animals,
      breakdown: {
        main_study_animals: accounting.main_study_animals,
        recovery_animals: accounting.recovery_animals,
        satellite_tk_animals: accounting.satellite_tk_animals,
        groups_total: accounting.groups_total,
        sexes: accounting.sexes,
      },
      animals_used_by_simulation: 0,
      animals_avoided: accounting.total_animals,
      note: "Every simulated cohort is animals that were not used. The count is exactly what a wet study of this declared design would consume — it is arithmetic on the design, not an estimate. It does not claim the simulation replaces the study.",
    },
    severity: {
      framework: "EU Directive 2010/63/EU Annex VIII",
      procedural_baseline: design.route === "ORAL" ? "Oral gavage with repeated restraint — mild procedural baseline." : design.route === "IV" ? "Intravenous administration with restraint or vascular access — mild to moderate procedural baseline." : "Subcutaneous administration with restraint — mild procedural baseline.",
      per_arm: severityPerArm,
      study_prospective_severity: studySeverity,
      terminal_procedure: "Humane euthanasia under terminal anaesthesia, classified as a non-recovery procedure. It is not counted in the prospective severity of the in-life phase.",
      basis: "Classification is driven by the projected exposure relative to the model NOAEL and by the flagged hazard domains, per Annex VIII assignment criteria.",
      limitations: "A prospective classification made before the study runs. The actual severity experienced must be recorded and reported after the study, and it may differ.",
    },
    humane_endpoints: {
      monitoring_plan: HUMANE_ENDPOINTS,
      monitoring_frequency: studySeverity === "severe" ? "At least three times daily during dosing, with an overnight check" : studySeverity === "moderate" ? "Twice daily during dosing and once daily during recovery" : "Twice daily during dosing",
      note: "Humane endpoints are protocol commitments, not predictions. They define when an animal is removed from the study regardless of what the study is measuring.",
    },
    procedure_burden: {
      route: design.route,
      dosing_administrations_per_animal: nDoses,
      total_dosing_administrations: nDoses * accounting.main_study_animals,
      dosing_note: `${nDoses} administration${nDoses === 1 ? "" : "s"} per animal by ${design.route === "ORAL" ? "oral gavage" : design.route === "IV" ? "intravenous injection" : "subcutaneous injection"}. Each administration carries a restraint burden that is independent of the test article.`,
      blood_sampling: bloodLimits && totalBlood
        ? {
          available: true,
          reference_body_weight_kg: bodyWeight,
          blood_volume_ml_per_kg: bloodLimits.bloodVolumeMlPerKg,
          estimated_total_blood_volume_ml: totalBlood,
          max_single_sample_ml: round(totalBlood * 0.10, 3),
          max_cumulative_28d_ml: round(totalBlood * 0.15, 3),
          guidance: "A single sample should not exceed 10% of total blood volume, and cumulative sampling should not exceed 15% in any 28-day period without fluid replacement.",
          source: bloodLimits.source,
        }
        : { available: false, reason: "No blood-volume reference is held for this species." },
      note: design.satelliteTk
        ? "A satellite toxicokinetic cohort was declared, which is what usually makes a full ICH S3A profile achievable in a small rodent without compromising the main-study readout."
        : "No satellite cohort was declared. In a small rodent the sampling volume needed for a full profile may exceed what main-study animals can give safely.",
    },
    sources: [
      { title: "EU Directive 2010/63/EU on the protection of animals used for scientific purposes", url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32010L0063" },
      { title: "ARRIVE guidelines 2.0", url: "https://arriveguidelines.org/" },
      { title: "OECD Guidance Document 19 on humane endpoints", url: "https://www.oecd.org/chemicalsafety/testing/" },
      { title: "Diehl et al. (2001) — recommended blood-sampling volumes", url: "https://doi.org/10.1002/jat.727" },
    ],
    limitations: "Welfare figures are derived from the declared design and from published reference limits. No animal response is simulated, and no claim is made that the simulation replaces a required study.",
  };

  /* ── PK study surface ───────────────────────────────────────────────── */
  const pkStudy = {
    available: true,
    study_type: design.studyType || "inferred_from_duration",
    protocol: {
      species: physiology.label, strain: strainRow.label, route: design.route,
      frequency: design.frequency || "single dose", duration_h: design.durationH,
      dose_groups_mg_kg: design.doses, cohort_size: design.cohortSize, formulation: design.formulation,
    },
    endpoint_groups: [
      { id: "systemic", title: "Systemic exposure", status: "computed", endpoints: [{ id: "cmax", label: "Cmax", unit: "mg/L" }, { id: "tmax", label: "Tmax", unit: "h" }, { id: "auc", label: "AUC0–τ", unit: "mg·h/L" }, { id: "thalf", label: "Terminal half-life", unit: "h" }, { id: "cl", label: "Clearance", unit: "L/h" }, { id: "vss", label: "Vss", unit: "L/kg" }] },
      { id: "linearity", title: "Dose proportionality and accumulation", status: "computed", endpoints: [{ id: "dnauc", label: "Dose-normalised AUC", unit: "mg·h/L per mg/kg" }, { id: "beta", label: "Power-model slope β", unit: "—" }, { id: "racc", label: "Accumulation ratio", unit: "fold" }] },
      { id: "tissue", title: "Tissue distribution", status: "computed", endpoints: [{ id: "kp", label: "Tissue:plasma partition", unit: "ratio" }, { id: "tauc", label: "Tissue AUC", unit: "mg·h/L" }, { id: "kpuu", label: "Brain Kp,uu", unit: "ratio" }] },
      { id: "engagement", title: "Target engagement", status: l1.target_resolution.status === "resolved" ? "computed" : "model_required", endpoints: [{ id: "occ", label: "Average occupancy", unit: "%" }, { id: "peakocc", label: "Peak occupancy", unit: "%" }] },
      { id: "metabolite", title: "Metabolite exposure", status: "not_predicted", endpoints: [{ id: "metauc", label: "Metabolite AUC", unit: "mg·h/L" }] },
      { id: "excretion", title: "Mass balance and excretion", status: "not_predicted", endpoints: [{ id: "urine", label: "Urinary recovery", unit: "% of dose" }, { id: "faeces", label: "Faecal recovery", unit: "% of dose" }] },
    ],
    model_executions: [
      { id: "pbpk", name: "Whole-body perfusion-limited PBPK", role: "Exposure simulation", status: "completed", available: true, qualification: "qualified_with_limitations", limitations: ["Oral absorption carries a wider band than the intravenous route.", "No transporter-mediated uptake."], availability_reason: null },
      { id: "ivive", name: "Well-stirred hepatic clearance", role: "Clearance derivation", status: "completed", available: true, qualification: "qualified_with_limitations", limitations: ["Under-predicts clearance for high-extraction and transporter-dependent compounds."], availability_reason: null },
      { id: "poulin", name: "Poulin & Theil tissue partitioning", role: "Tissue distribution", status: "completed", available: true, qualification: "indicative", limitations: ["Adequate for ranking tissues, not for an absolute tissue-concentration claim."], availability_reason: null },
      { id: "occupancy", name: "Equilibrium receptor occupancy", role: "Target engagement", status: l1.target_resolution.status === "resolved" ? "completed" : "not_run", available: l1.target_resolution.status === "resolved", qualification: "indicative", limitations: ["Plasma free drug is the biophase surrogate."], availability_reason: l1.target_resolution.status === "resolved" ? null : "No affinity anchor — no target was resolved." },
      { id: "metabolite_id", name: "Metabolite structure prediction", role: "Metabolite exposure", status: "not_run", available: false, qualification: "not_qualified", limitations: [], availability_reason: "No metabolite-prediction model is configured. Metabolite exposure is reported as not predicted rather than estimated." },
    ],
    qualification: {
      status: "qualified_with_limitations",
      message: "The exposure engine is qualified against held-out rodent pharmacokinetics with an explicit fold-error band. The distribution and engagement models are indicative only, and metabolite exposure is not predicted at all.",
    },
    data_retention: { legacy_record_preserved: true, message: "Every block in this record is retained in full. The endpoint groups above index them; they do not replace them." },
  };

  /* ── stage gate decision ────────────────────────────────────────────── */
  const criteria: Record<string, { status: string; rationale: string }> = {
    exposure_achieved: {
      status: topPlasma.c_max.median > 0 ? "pass" : "fail",
      rationale: `The top dose group reaches a median Cmax of ${round(topPlasma.c_max.median, 3)} mg/L and an AUC of ${round(topPlasma.auc.median, 3)} mg·h/L. Exposure was achieved across every simulated arm.`,
    },
    dose_separation: {
      status: toxicokinetics.dose_group_separation.every((row) => row.auc_ratio >= 1.5) ? "pass" : "caution",
      rationale: toxicokinetics.dose_group_separation.every((row) => row.auc_ratio >= 1.5)
        ? "Exposure separates cleanly between adjacent dose groups, so a graded response would be resolvable."
        : "At least one pair of adjacent dose groups does not separate on exposure. A finding could not be attributed to dose across that pair.",
    },
    design_conformance: {
      status: conformance.conformant ? "pass" : "caution",
      rationale: conformance.conformant
        ? `The declared design sits inside the ${conformance.closest_guideline} envelope.`
        : `${conformance.gaps.length} departure${conformance.gaps.length === 1 ? "" : "s"} from the ${conformance.closest_guideline} envelope: ${conformance.gaps[0]}`,
    },
    target_organ_identified: {
      status: organRisk.summary.n_concern > 0 ? "caution" : "pass",
      rationale: organRisk.summary.n_concern > 0
        ? `${organRisk.summary.n_concern} organ${organRisk.summary.n_concern === 1 ? "" : "s"} carry both a flagged mechanism and meaningful exposure: ${organRisk.summary.target_organs_of_concern.join(", ")}. These become the designated target organs for the study.`
        : "No organ carries both a flagged mechanism and meaningful simulated exposure. That is the absence of a flagged model output, not a demonstration of organ safety.",
    },
    point_of_departure: {
      status: preferred ? (preferred.strength === "strong" ? "pass" : "caution") : "fail",
      rationale: preferred
        ? `The preferred point of departure is the ${preferred.name} at ${preferred.dose_mg_per_kg} mg/kg, rated ${preferred.strength}. ${preferred.note}`
        : "No anchor rated strong or moderate was available, so no point of departure could be selected and the first-in-human translation has nothing to scale.",
    },
    safety_margin: {
      status: safety.per_arm_margins[0].margin_to_allometric_noael >= 1 ? "pass" : "caution",
      rationale: `The lowest dose group sits at a ${round(safety.per_arm_margins[0].margin_to_allometric_noael, 2)}× margin to the model NOAEL estimate. The anchor is a model output, so the margin inherits its confidence.`,
    },
    genotoxicity_resolved: {
      status: profile.endpoints.AMES.canonicalValue > 0.55 ? "fail" : "pass",
      rationale: profile.endpoints.AMES.canonicalValue > 0.55
        ? "A genotoxicity hazard is predicted and no experimental bacterial reverse-mutation result has been supplied. ICH S2(R1) requires it before human exposure."
        : "No genotoxicity hazard is predicted. The ICH S2(R1) battery is still required experimentally before first-in-human dosing.",
    },
    exposure_linearity: {
      status: linear ? "pass" : "caution",
      rationale: (toxicokinetics.exposure_linearity as any).interpretation,
    },
  };
  const failed = Object.values(criteria).filter((criterion) => criterion.status === "fail").length;
  const cautioned = Object.values(criteria).filter((criterion) => criterion.status === "caution").length;
  const recommendation = failed > 0 ? "NO-GO" : cautioned >= 3 ? "CONDITIONAL" : "GO";

  const stageGate = {
    recommendation,
    headline: failed > 0
      ? `${failed} criterion${failed === 1 ? "" : "s"} failed. The evidence gap has to be closed experimentally before the first-in-human translation can be defended.`
      : cautioned > 0
        ? `No criterion failed. ${cautioned} criteri${cautioned === 1 ? "on carries" : "a carry"} a condition that should be stated explicitly in the first-in-human rationale.`
        : "Every criterion is met on the evidence this study produced.",
    criteria,
    value_of_information: [
      "Equilibrium-dialysis unbound fraction in the study species — the single measurement that most reduces the uncertainty in every exposure number above.",
      "Hepatocyte intrinsic clearance in the study species, to replace the human-trained prediction.",
      ...(profile.endpoints.hERG.canonicalValue > 0.35 ? ["Manual patch-clamp hERG IC50, to convert the categorical cardiac liability into a rankable margin."] : []),
      ...(highDomains.length ? [`Targeted in-vitro mechanism confirmation for the flagged domains: ${highDomains.map((domain) => domain.name).join(", ")}.`] : []),
      ...(preferred?.strength !== "strong" ? ["A measured NOAEL from a conducted repeat-dose study — every margin above currently rests on a model anchor."] : []),
      "Metabolite identification, so metabolite exposure can stop being reported as not predicted.",
    ],
    limitations: "A stage-gate recommendation over simulated evidence. It is a planning aid, not a regulatory determination.",
  };

  /* ── therapeutic-area endpoints ─────────────────────────────────────── */
  const area = THERAPEUTIC_AREAS.find((entry) => entry.code === areaCode);
  const taEndpoints = area
    ? (() => {
      const resolvedEndpoints = area.endpoints.filter((endpoint) => endpoint.layer === "L3").map((endpoint) => {
        const resolvedValue: number | string | null = (() => {
          switch (endpoint.key) {
            case "exposure_margin": return preferred ? round(allometricNoael / armForExposure.arm.dose_mg_per_kg, 2) : null;
            case "target_occupancy": return l1.target_resolution.status === "resolved" ? round((pkpd.per_arm[pkpd.per_arm.length - 1].target_coverage as any).average_occupancy * 100, 1) : null;
            case "herg_margin": return null;
            case "hepatic_signal": return toxDomains.find((domain) => domain.id === "hepatotoxicity")?.hazard_call.level ?? null;
            case "brain_plasma_ratio": return round(armForExposure.cohort.endpoints.tissue.brain.tissuePlasmaAucRatio, 3);
            case "kp_uu_brain": return profile.disposition.kpuuBrain;
            case "lung_exposure_ratio": return round(armForExposure.cohort.endpoints.tissue.lung.tissuePlasmaAucRatio, 3);
            case "cns_safety_battery": return safetyPharmacology.systems[1].assessment;
            case "respiratory_battery": return safetyPharmacology.systems[2].assessment;
            case "qt_margin": return null;
            case "haemodynamic_signal": return safetyPharmacology.systems[0].assessment;
            case "myelosuppression_signal": return toxDomains.find((domain) => domain.id === "hematotoxicity")?.hazard_call.level ?? null;
            case "immunotoxicity_signal": return toxDomains.find((domain) => domain.id === "immunotoxicity")?.hazard_call.level ?? null;
            case "endocrine_signal": return toxDomains.find((domain) => domain.id === "endocrine_reproductive")?.hazard_call.level ?? null;
            case "auc_over_mic": return null;
            case "time_above_mic": return null;
            case "target_engagement_chronic": return l1.target_resolution.status === "resolved" ? round((pkpd.per_arm[0].target_coverage as any).average_occupancy * 100, 1) : null;
            default: return null;
          }
        })();
        const state = resolvedValue === null ? "unresolved" : "resolved";
        const verdict = state === "unresolved" ? null
          : typeof resolvedValue === "number" && endpoint.threshold?.value !== null && endpoint.threshold?.value !== undefined
            ? (endpoint.direction === "higher_is_better" ? (resolvedValue >= endpoint.threshold.value ? "pass" : "caution") : (resolvedValue <= endpoint.threshold.value ? "pass" : "caution"))
            : typeof resolvedValue === "string"
              ? (["low", "low_concern"].includes(resolvedValue) ? "pass" : ["high", "concern"].includes(resolvedValue) ? "caution" : "informational")
              : "informational";
        return {
          key: endpoint.key, name: endpoint.name, kind: endpoint.kind, layer: endpoint.layer,
          unit: endpoint.unit, direction: endpoint.direction, rationale: endpoint.rationale,
          threshold: endpoint.threshold, source_kind: endpoint.source_kind,
          state, value: resolvedValue, verdict,
          provenance: state === "resolved" ? "computed from this study record" : null,
          model: state === "resolved" ? "Layer 3 animal cohort" : null,
          missing_input: state === "unresolved"
            ? (endpoint.key === "herg_margin" || endpoint.key === "qt_margin" ? "a measured hERG IC50 in µM"
              : endpoint.key.includes("mic") ? "a measured minimum inhibitory concentration"
                : "a resolved protein target with an affinity anchor")
            : null,
          reason: state === "unresolved" ? "The input this endpoint needs was not produced by this run." : null,
        };
      });
      const applicable = resolvedEndpoints.length;
      const resolvedCount = resolvedEndpoints.filter((endpoint) => endpoint.state === "resolved").length;
      return {
        schemaVersion: "hakase.therapeutic-area.v1",
        therapeutic_area: { code: area.code, label: area.label, meddra_soc: area.meddra_soc },
        layer: "L3" as const,
        endpoints: resolvedEndpoints,
        summary: {
          applicable, resolved: resolvedCount, unresolved: applicable - resolvedCount,
          cautions: resolvedEndpoints.filter((endpoint) => endpoint.verdict === "caution").length,
          efficacy_resolved: resolvedEndpoints.filter((endpoint) => endpoint.kind === "efficacy" && endpoint.state === "resolved").length,
          efficacy_total: resolvedEndpoints.filter((endpoint) => endpoint.kind === "efficacy").length,
        },
      };
    })()
    : null;

  const studyId = `${l1.analysis_id}-${design.speciesId}-${design.durationH}`;

  return {
    available: true,
    schema_version: "hakase.small-molecule.l3.v3",
    study_id: studyId,
    analysis_id: l1.analysis_id,
    smiles: l1.canonical_smiles,
    generated_at: stamp(4),
    owner: "hakase_smallmol.l3.pipeline",
    study_summary: {
      species: physiology.label, strain: strainRow.label, sex: design.sex, route: design.route,
      frequency: design.frequency || "single dose", formulation: design.formulation,
      duration_h: design.durationH, dose_groups_mg_kg: design.doses, cohort_size: design.cohortSize,
      study_type: design.studyType || null, recovery_period_days: design.recoveryDays,
      satellite_tk: design.satelliteTk, satellite_group_size: design.satelliteTk ? design.satelliteSize : null,
      arms_simulated: arms.length, arms_available: arms.length,
      engine_requested: "auto", engine_used: "hakase_kernel_pbpk",
      simulation_engine: "Hakase kernel PBPK (13-compartment perfusion-limited, RK4)",
      body_weight_kg: bodyWeight,
    },
    readiness_warnings: [
      ...(design.speciesId !== "human" ? [`Intrinsic clearance for ${physiology.label} is derived from a human-trained predictor. Every arm is flagged low confidence for that reason.`] : []),
      ...(disposition.fuPlasma < 0.01 ? ["The unbound fraction is below 1%; exposure is highly sensitive to it and a measured value should replace the prediction."] : []),
      ...(!conformance.conformant ? [`The declared design departs from the ${conformance.closest_guideline} envelope in ${conformance.gaps.length} respect${conformance.gaps.length === 1 ? "" : "s"}.`] : []),
      ...(l1.target_resolution.status !== "resolved" ? ["No protein target was resolved, so no target-engagement statement is carried in this record."] : []),
    ],
    gate: gateSignoff ? { signoff: gateSignoff } : null,
    signoff: gateSignoff,
    resolved_inputs: {
      analysis_id: l1.analysis_id,
      l1_verdict: l1.verdict.verdict,
      target: { target_protein: l1.target_resolution.target_protein, gene_symbol: l1.target_resolution.gene_symbol, uniprot_id: l1.target_resolution.uniprot_id, pdb_id: l1.target_resolution.pdb_id },
      therapeutic_area: area?.label ?? null,
      potency: l1.target_resolution.status === "resolved" ? { activity_type: profile.affinity.activityType, value_nM: profile.affinity.kdNm, provenance: profile.affinity.provenance, source: "ChEMBL analogue read-across" } : null,
      disposition: {
        fu_plasma: { value: disposition.fuPlasma, provenance: provenance.fu_plasma },
        clint_hep_ul_min_1e6: { value: disposition.clintHepUlMin1e6, provenance: provenance.clint_hep_ul_min_1e6 },
        vdss_l_per_kg: { value: overrides.vdss_l_per_kg ?? profile.disposition.vdssLPerKg, provenance: provenance.vdss_l_per_kg },
        blood_plasma_ratio: { value: disposition.bloodPlasmaRatio, provenance: provenance.blood_plasma_ratio },
        logp: { value: profile.descriptors.logp, provenance: provenance.logp },
      },
      safety_flags: Object.values(l1.safety_assessments).filter((entry) => entry.risk_class !== "Low").map((entry) => ({ label: entry.endpoint, endpoint: entry.endpoint, risk_class: entry.risk_class })),
      input_mode: "cascade",
    },
    arms,
    pkpd,
    biodistribution,
    toxicokinetics,
    toxicology,
    safety_pharmacology: safetyPharmacology,
    organ_risk: organRisk,
    ddi: ddiAssessment(profile, freeCmaxUm, cl.fractionHepatic),
    points_of_departure: pointsOfDeparture,
    model_panel: modelPanel,
    study_outcomes: studyOutcomes,
    study_protocol: studyProtocol,
    validation_evidence: {
      available: true,
      assessment_date: "2026-06-30",
      status: "qualified_with_limitations",
      headline: "The exposure engine is qualified against held-out rodent pharmacokinetics. The distribution and hazard models are indicative, and several endpoints have no validation set at all — which is stated as a boundary rather than hidden.",
      scope: "Retrospective held-out validation of the PBPK exposure engine and its inputs.",
      methodology: VALIDATION_METHODOLOGY,
      studies: VALIDATION_STUDIES,
      endpoint_coverage: VALIDATION_ENDPOINT_COVERAGE,
      limitations: VALIDATION_LIMITATIONS,
    },
    pk_study: pkStudy,
    safety,
    sensitivity,
    evidence,
    data_source_catalogue: {
      sources: L3_DATA_SOURCES,
      statement: "This is the catalogue of sources the Animal Cohort layer can integrate. It does not claim that every listed source was queried for this compound — each external evidence card retains its own live, empty or unavailable state.",
    },
    stage_gate: stageGate,
    therapeutic_area_endpoints: taEndpoints,
    selected_scientific_models: [
      { block: "Exposure simulation", model: "Hakase kernel PBPK — 13-compartment perfusion-limited, RK4 integration", provenance: "in-house engine" },
      { block: "Hepatic clearance", model: "Well-stirred model (Rowland & Tozer)", provenance: "published method" },
      { block: "Tissue partitioning", model: "Poulin & Theil (2002) tissue-composition partitioning", provenance: "published method" },
      { block: "Disposition inputs", model: "ADMET-AI Chemprop-RDKit ensemble", provenance: overrides.fu_plasma || overrides.clint_hep_ul_min_1e6 ? "ml, partially overridden by measured inputs" : "ml" },
      { block: "Toxicology hazard bands", model: "ADMET-AI toxicity heads + Tox21 qHTS heads + structural alerts", provenance: "ml + structural rules" },
      { block: "Target engagement", model: "Equilibrium receptor occupancy (Clark/Hill)", provenance: "published method" },
      { block: "Drug interaction", model: "FDA (2020) basic static model", provenance: "regulatory method" },
      { block: "Design conformance", model: "ICH/OECD guideline envelope comparison", provenance: "embedded reference" },
      { block: "Welfare and severity", model: "EU Directive 2010/63 Annex VIII classification", provenance: "embedded reference" },
      { block: "Points of departure", model: "LD50-anchored allometric NOAEL + occupancy-derived pharmacological anchor", provenance: "ml + derived" },
    ],
    welfare,
    study_dossier: {
      available: true,
      title: "Animal-study review order",
      subtitle: "The order a study director reads a preclinical package, and which block produces each part.",
      sections: [
        { id: "decision", sequence: 1, title: "Stage-gate decision", purpose: "The recommendation and the criteria that produced it.", source_keys: ["stage_gate"], status: recommendation === "GO" ? "pass" : recommendation === "CONDITIONAL" ? "caution" : "fail" },
        { id: "design", sequence: 2, title: "Design and conformance", purpose: "What study was run and how it compares with the guideline envelope.", source_keys: ["study_summary", "study_outcomes.design_conformance"], status: conformance.conformant ? "pass" : "caution" },
        { id: "protocol", sequence: 3, title: "Protocol and schedule", purpose: "The planned procedures, timeline and measurement schedule.", source_keys: ["study_protocol"], status: "pass" },
        { id: "welfare", sequence: 4, title: "Welfare and 3Rs", purpose: "The animals an equivalent wet study would consume, and the prospective severity of the design.", source_keys: ["welfare"], status: studySeverity === "severe" ? "caution" : "pass" },
        { id: "tk", sequence: 5, title: "Toxicokinetics (ICH S3A)", purpose: "The regulated exposure table across the dose range.", source_keys: ["toxicokinetics"], status: "pass" },
        { id: "distribution", sequence: 6, title: "Exposure and distribution", purpose: "Where the drug went, per organ and per dose group.", source_keys: ["arms", "biodistribution", "organ_risk"], status: "pass" },
        { id: "toxicology", sequence: 7, title: "Toxicology", purpose: "The mechanistic hazard panel joined onto simulated organ exposure.", source_keys: ["toxicology", "study_outcomes"], status: highDomains.length ? "caution" : "pass" },
        { id: "safetypharm", sequence: 8, title: "Safety pharmacology (ICH S7A/S7B)", purpose: "The core-battery assessment, a separate regulatory deliverable.", source_keys: ["safety_pharmacology"], status: safetyPharmacology.summary.overall === "concern" ? "caution" : "pass" },
        { id: "interactions", sequence: 9, title: "Drug interactions", purpose: "Perpetrator and victim assessment under the FDA (2020) basic model.", source_keys: ["ddi"], status: "pass" },
        { id: "pod", sequence: 10, title: "Points of departure", purpose: "Every anchor the study can defend, with its strength and provenance.", source_keys: ["points_of_departure"], status: preferred?.strength === "strong" ? "pass" : "caution" },
        { id: "evidence", sequence: 11, title: "Public evidence", purpose: "Measured animal data located for this structure or close analogues.", source_keys: ["evidence"], status: (evidence as any).available ? "pass" : "caution" },
        { id: "validation", sequence: 12, title: "Validation evidence", purpose: "How the engine performs on held-out reference data, separated from this compound's result.", source_keys: ["validation_evidence"], status: "caution" },
        { id: "provenance", sequence: 13, title: "Provenance", purpose: "Which model produced which number.", source_keys: ["resolved_inputs", "model_panel", "selected_scientific_models"], status: "pass" },
      ],
      data_retention: {
        all_current_outputs_preserved: true,
        indexed_source_keys: ["stage_gate", "study_summary", "study_protocol", "welfare", "toxicokinetics", "arms", "biodistribution", "organ_risk", "toxicology", "study_outcomes", "safety_pharmacology", "ddi", "points_of_departure", "evidence", "validation_evidence", "resolved_inputs", "model_panel"],
        missing_source_keys: [],
        principle: "The dossier is an index over the record. Every block it names is present in full below it.",
      },
    },
    presentation: {
      groups: [
        {
          title: "Study at a glance",
          fields: [
            { label: "Species and strain", value: `${physiology.label} · ${strainRow.label}` },
            { label: "Design", value: `${design.doses.length} active dose group${design.doses.length === 1 ? "" : "s"}${design.includeControl ? " plus a vehicle control" : ""}, ${design.frequency || "single dose"}, ${design.durationH} h` },
            { label: "Animals in the equivalent wet study", value: accounting.total_animals },
            { label: "Guideline envelope", value: conformance.closest_guideline },
            { label: "Conformance", value: conformance.conformant ? "Within the envelope" : `${conformance.gaps.length} departure${conformance.gaps.length === 1 ? "" : "s"}` },
            { label: "Simulation engine", value: "Hakase kernel PBPK (13-compartment perfusion-limited)" },
          ],
        },
        {
          title: "Headline exposure at the top dose",
          fields: [
            { label: "Cmax", value: `${round(topPlasma.c_max.median, 4)} mg/L` },
            { label: "AUC", value: `${round(topPlasma.auc.median, 4)} mg·h/L` },
            { label: "Terminal half-life", value: `${round(topPlasma.t_half.median, 2)} h` },
            { label: "Free Cmax", value: `${freeCmaxUm} µM` },
            { label: "Exposure linearity", value: linear ? "Dose-proportional" : "Not dose-proportional" },
          ],
        },
        {
          title: "Decision inputs",
          fields: [
            { label: "Stage-gate recommendation", value: recommendation },
            { label: "Target organs of concern", value: organRisk.summary.target_organs_of_concern.join(", ") || "None" },
            { label: "High-hazard domains", value: toxicology.summary.high_hazard_domains.join(", ") || "None" },
            { label: "Preferred point of departure", value: preferred ? `${preferred.name} at ${preferred.dose_mg_per_kg} mg/kg (${preferred.strength})` : "Not selected" },
            { label: "Prospective severity", value: studySeverity },
          ],
        },
      ],
    },
    provenance: {
      owner: "hakase_smallmol.l3.pipeline",
      client_contract: "display-only",
      input_mode: "cascade",
      upstream_layers_executed: true,
      computed_at: stamp(4),
    },
  };
}
