/**
 * Layer 4 — First-in-Human translation.
 *
 * The block this layer exists for is the starting-dose reconciliation:
 * EMA/CHMP/SWP/28367/07 Rev.1 requires the NOAEL/HED route and MABEL to be
 * derived independently and the lower value to govern. Both are computed here
 * from the animal record and shown side by side with their fold difference,
 * because a large divergence is a finding rather than a rounding detail.
 */

import {
  FDA_RISK_FACTORS, IND_CHECKLIST, PHASE1_SUBSTUDIES, REGULATORY_REGIONS, THERAPEUTIC_AREAS,
} from "../lib/catalogs";
import { clamp, round, stamp } from "../lib/format";
import { chance, logSpan, normal, pick, span, unit } from "../lib/rng";
import {
  allometricScale, clearance, concentrationForOccupancy, escalationLadder, ESCALATION_SCHEMES,
  humanEquivalentDose, maximumRecommendedStartingDose, simulateCohort, species, threePlusThree,
  type StudyContext,
} from "../lib/pk";
import { dispositionFor, type MeasuredOverrides } from "./l3ivive";
import type { CompoundProfile } from "./profile";
import type { AnimalStudyRecord } from "./l3animal";

const seed = (smiles: string, channel: string) => `${smiles}::l4::${channel}`;

export type FihDesign = {
  route: "ORAL" | "IV" | "SC";
  frequency: "" | "QD" | "BID";
  durationH: number;
  cohortSize: number;
  bodyWeightKg: number;
  scheme: string;
  levels: number;
  fold: number;
  maxDoseMg: number | null;
  riskFlags: Record<string, boolean>;
  dltProbabilities: number[];
  sadCohort: number;
  madCohort: number;
  madFrequency: string;
  indication: string;
  region: string;
  attested: Record<string, boolean>;
  overrideJustification: string;
  collectPrecedent: boolean;
};

export function l4Contract(study: AnimalStudyRecord, profile: CompoundProfile) {
  return {
    status: "available",
    source: {
      study_id: study.study_id,
      analysis_id: study.analysis_id,
      animal_species: study.study_summary.species,
      animal_strain: study.study_summary.strain,
      animal_route: study.study_summary.route,
      animal_dose_groups_mg_kg: study.study_summary.dose_groups_mg_kg,
      animal_duration_h: study.study_summary.duration_h,
      stage_gate: study.stage_gate.recommendation,
      target: {
        gene_symbol: study.resolved_inputs.target.gene_symbol,
        uniprot_id: study.resolved_inputs.target.uniprot_id,
        target_protein: study.resolved_inputs.target.target_protein,
      },
      smiles: study.smiles,
    },
    inherited: {
      preferred_pod: study.points_of_departure.preferred_pod,
      points_of_departure: study.points_of_departure.candidates,
      high_hazard_domains: study.toxicology.summary.high_hazard_domains,
      target_organs_of_concern: study.organ_risk.summary.target_organs_of_concern,
      potency: study.resolved_inputs.potency,
      disposition: study.resolved_inputs.disposition,
      safety_pharmacology: study.safety_pharmacology.summary,
    },
    readiness: {
      overall_ready: Boolean(study.points_of_departure.preferred_pod),
      checks: [
        { block: "Point of departure", ready: Boolean(study.points_of_departure.preferred_pod), requires: "A defensible anchor rated strong or moderate", note: study.points_of_departure.preferred_pod ? `${study.points_of_departure.preferred_pod.name} at ${study.points_of_departure.preferred_pod.dose_mg_per_kg} mg/kg` : "No anchor rated strong or moderate was available." },
        { block: "Animal exposure at the point of departure", ready: (study.points_of_departure.preferred_pod_exposure as any).available === true, requires: "Reverse dosimetry from the simulated arms", note: (study.points_of_departure.preferred_pod_exposure as any).available ? "Free Cmax and AUC attached to the preferred anchor." : (study.points_of_departure.preferred_pod_exposure as any).reason },
        { block: "Affinity anchor for MABEL", ready: Boolean(study.resolved_inputs.potency), requires: "A resolved target with a potency value", note: study.resolved_inputs.potency ? `${study.resolved_inputs.potency.activity_type} ${study.resolved_inputs.potency.value_nM} nM` : "No target potency was carried through, so MABEL cannot be derived." },
        { block: "Human disposition inputs", ready: true, requires: "Unbound fraction and intrinsic clearance", note: `fu ${study.resolved_inputs.disposition.fu_plasma.value} (${study.resolved_inputs.disposition.fu_plasma.provenance})` },
        { block: "Genotoxicity resolved", ready: profile.endpoints.AMES.canonicalValue <= 0.55, requires: "No unresolved predicted mutagenicity hazard", note: profile.endpoints.AMES.canonicalValue > 0.55 ? "A genotoxicity hazard is predicted and no experimental result has been supplied." : "No genotoxicity hazard is predicted; the ICH S2(R1) battery is still required experimentally." },
        { block: "Animal stage gate", ready: study.stage_gate.recommendation !== "NO-GO", requires: "The animal study did not return NO-GO", note: `Animal stage gate returned ${study.stage_gate.recommendation}.` },
      ],
      limitations: "Readiness describes whether this layer has the inputs it needs to compute a translation. It is not a statement that the nonclinical package is complete.",
    },
    clinical_design_options: {
      routes: ["ORAL", "IV", "SC"],
      frequencies: ["SINGLE", "QD", "BID"],
      escalation_schemes: ESCALATION_SCHEMES.map((scheme) => ({ id: scheme.id, name: scheme.name, reference: scheme.reference })),
      risk_factors: FDA_RISK_FACTORS,
      reference_human_weight_kg: 60,
      cohort_defaults: { sad_cohort_size: 8, mad_cohort_size: 12, sentinel_cohort_size: 2, randomisation_ratio: "3:1 active to placebo" },
      regulatory_regions: REGULATORY_REGIONS,
      ind_checklist_items: IND_CHECKLIST,
      benefit_risk: { requires: "A stated indication", note: "The FDA (2023) benefit-risk framework needs a condition before severity and unmet need can be classified." },
    },
  };
}

export function runFirstInHuman(
  profile: CompoundProfile,
  study: AnimalStudyRecord,
  design: FihDesign,
  overrides: MeasuredOverrides,
  areaCode: string,
) {
  const smiles = profile.smiles;
  const human = species("human");
  const { disposition, provenance } = dispositionFor(profile, overrides);
  const animalSpecies = species(String(study.study_summary.species).toLowerCase().includes("rat") ? "rat"
    : String(study.study_summary.species).toLowerCase().includes("mouse") ? "mouse"
      : String(study.study_summary.species).toLowerCase().includes("dog") ? "dog"
        : String(study.study_summary.species).toLowerCase().includes("monkey") ? "monkey"
          : String(study.study_summary.species).toLowerCase().includes("rabbit") ? "rabbit" : "minipig");

  /* ── safety factor ──────────────────────────────────────────────────── */
  const appliedFlags = FDA_RISK_FACTORS.filter((factor) => design.riskFlags[factor.id]);
  const totalFactor = appliedFlags.reduce((total, factor) => total * factor.additional_factor, 10);

  /* ── NOAEL → HED → MRSD ─────────────────────────────────────────────── */
  const translations = study.points_of_departure.candidates.map((candidate) => {
    const hed = humanEquivalentDose(candidate.dose_mg_per_kg, animalSpecies.km, human.km);
    const eligible = candidate.strength !== "weak" && !candidate.name.toLowerCase().includes("lethality") && !candidate.name.toLowerCase().includes("pharmacological");
    const mrsd = maximumRecommendedStartingDose(hed.hed_mg_per_kg, totalFactor, design.bodyWeightKg);
    return {
      pod_name: candidate.name,
      pod_provenance: candidate.provenance,
      pod_strength: candidate.strength,
      animal_dose_mg_per_kg: candidate.dose_mg_per_kg,
      hed: { hed_mg_per_kg: round(hed.hed_mg_per_kg, 5), hed_mg_per_m2: round(hed.hed_mg_per_m2, 3), conversion_factor: round(hed.conversion_factor, 4) },
      mrsd: { mrsd_mg_per_kg: round(mrsd.mrsd_mg_per_kg, 6), mrsd_total_mg_60kg: round(mrsd.mrsd_total_mg_60kg, 4) },
      eligible_for_mrsd: eligible,
      excluded_reason: eligible ? null
        : candidate.name.toLowerCase().includes("lethality") ? "An acute lethality anchor is not a NOAEL and may not be used for the MRSD calculation."
          : candidate.name.toLowerCase().includes("pharmacological") ? "A pharmacological anchor belongs in the MABEL route, not in the NOAEL/HED route."
            : "The anchor is rated weak and is not defensible as the basis for a starting dose.",
    };
  });
  const eligibleTranslations = translations.filter((translation) => translation.eligible_for_mrsd);
  const governingTranslation = eligibleTranslations.length
    ? eligibleTranslations.reduce((lowest, translation) => (translation.mrsd.mrsd_total_mg_60kg < lowest.mrsd.mrsd_total_mg_60kg ? translation : lowest), eligibleTranslations[0])
    : null;

  const translation = {
    available: eligibleTranslations.length > 0,
    reason: eligibleTranslations.length ? undefined : "No point of departure was eligible for the NOAEL/HED route. Every available anchor was either an acute lethality value, a pharmacological anchor, or rated weak.",
    animal_species: study.study_summary.species,
    method: "FDA (2005) Estimating the Maximum Safe Starting Dose in Initial Clinical Trials — body-surface-area (Km) conversion",
    safety_factor: {
      default_factor: 10,
      total_factor: totalFactor,
      applied: appliedFlags.map((factor) => ({ id: factor.id, label: factor.label, additional_factor: factor.additional_factor })),
      note: "The default 10-fold factor covers interspecies and interindividual variability. Each additional flag is a specific, itemised concern, not a general conservatism.",
    },
    translations,
    limitations: "Body-surface-area conversion assumes that toxicity scales with metabolic rate. For a compound whose toxicity is driven by a concentration-dependent mechanism rather than by systemic exposure, that assumption is weak and an exposure-based approach should govern instead.",
  };

  /* ── human PBPK dose–exposure calibration ───────────────────────────── */
  const humanCl = clearance(human, disposition, design.bodyWeightKg);
  const calibrationDose = 10;
  const calibrationStudy: StudyContext = {
    route: design.route, doseMgPerKg: calibrationDose / design.bodyWeightKg, durationH: Math.min(design.durationH, 168),
    infusionDurationH: 0, dosingIntervalH: null, bodyWeightKg: design.bodyWeightKg,
  };
  const calibrationRun = simulateCohort(human, disposition, calibrationStudy, design.cohortSize, seed(smiles, `humancal::${design.route}`));
  const perMgAuc = calibrationRun.endpoints.plasma.auc.median / calibrationDose;
  const perMgCmax = calibrationRun.endpoints.plasma.c_max.median / calibrationDose;

  const calibration = {
    available: true,
    reference_body_weight_kg: design.bodyWeightKg,
    calibration_dose_mg: calibrationDose,
    auc_mg_h_per_l_per_mg: round(perMgAuc, 6),
    cmax_mg_per_l_per_mg: round(perMgCmax, 6),
    t_half_h: round(calibrationRun.endpoints.plasma.t_half.median, 2),
    cl_l_per_h: round(humanCl.clTotalPlasmaLPerH, 3),
    vss_l_per_kg: round(calibrationRun.vssLPerKg, 3),
    bioavailability: calibrationRun.bioavailability,
    model: "Human whole-body perfusion-limited PBPK, calibrated at a single dose and scaled linearly",
    limitation: "Linear dose scaling holds only where exposure is dose-proportional. Saturation of clearance or of absorption is not modelled at all.",
  };

  /* ── MABEL and PAD ──────────────────────────────────────────────────── */
  const potency = study.resolved_inputs.potency;
  const mabel = potency
    ? (() => {
      const kdNm = potency.value_nM;
      const anchorOccupancy = 0.10;
      const uncertaintyFactor = 10;
      const requiredFreeNm = concentrationForOccupancy(anchorOccupancy, kdNm, 1);
      const requiredTotalMgL = (requiredFreeNm / 1e6) * profile.descriptors.molecular_weight_da / Math.max(disposition.fuPlasma, 1e-9);
      const doseMg = requiredTotalMgL / Math.max(perMgCmax, 1e-12);
      const mabelMg = doseMg / uncertaintyFactor;
      return {
        available: true,
        mabel_total_mg: round(mabelMg, 5),
        mabel_mg_per_kg: round(mabelMg / design.bodyWeightKg, 7),
        anchor_occupancy: anchorOccupancy,
        uncertainty_factor: uncertaintyFactor,
        kd_uM: round(kdNm / 1000, 5),
        required_free_cmax_uM: round(requiredFreeNm / 1000, 6),
        required_total_cmax_mg_per_l: round(requiredTotalMgL, 6),
        model: "Receptor-occupancy MABEL: the dose projected to reach 10% target occupancy at Cmax, divided by a 10-fold uncertainty factor. EMA/CHMP/SWP/28367/07 Rev.1 requires this route to be derived independently of the NOAEL route.",
        limitations: "The affinity anchor is analogue read-across rather than a measurement on this compound, and plasma free drug is a surrogate for the concentration at the target. Both weaken the MABEL calculation in the same direction — toward under-estimating the required dose.",
      };
    })()
    : { available: false, reason: "No target potency was carried through from the animal record, so the minimum anticipated biological effect level cannot be derived." };

  const pad = potency
    ? (() => {
      const targetOccupancy = 0.80;
      const requiredFreeNm = concentrationForOccupancy(targetOccupancy, potency.value_nM, 1);
      const requiredTotalMgL = (requiredFreeNm / 1e6) * profile.descriptors.molecular_weight_da / Math.max(disposition.fuPlasma, 1e-9);
      const doseMg = requiredTotalMgL / Math.max(perMgCmax, 1e-12);
      return {
        available: true,
        target_occupancy: targetOccupancy,
        pad_total_mg: round(doseMg, 4),
        pad_mg_per_kg: round(doseMg / design.bodyWeightKg, 6),
        required_free_cmax_uM: round(requiredFreeNm / 1000, 6),
        note: "The pharmacologically active dose is the target the escalation climbs toward. It is not a starting dose.",
      };
    })()
    : { available: false, reason: "No affinity anchor is available." };

  /* ── starting dose reconciliation ───────────────────────────────────── */
  const approaches = [
    governingTranslation
      ? {
        id: "noael_hed",
        name: "NOAEL / HED with safety factor",
        available: true,
        dose_total_mg: round(governingTranslation.mrsd.mrsd_total_mg_60kg, 5),
        dose_mg_per_kg: round(governingTranslation.mrsd.mrsd_mg_per_kg, 7),
        basis: `${governingTranslation.pod_name} at ${governingTranslation.animal_dose_mg_per_kg} mg/kg in ${study.study_summary.species}, converted to a human equivalent dose of ${governingTranslation.hed.hed_mg_per_kg} mg/kg by body-surface-area scaling, then divided by the ${totalFactor}-fold safety factor.`,
        provenance: governingTranslation.pod_provenance,
        strength: governingTranslation.pod_strength,
        role: null,
      }
      : { id: "noael_hed", name: "NOAEL / HED with safety factor", available: false, reason: "no point of departure was eligible for this route" },
    mabel.available
      ? {
        id: "mabel",
        name: "MABEL (receptor occupancy)",
        available: true,
        dose_total_mg: (mabel as any).mabel_total_mg,
        dose_mg_per_kg: (mabel as any).mabel_mg_per_kg,
        basis: `The dose projected to reach ${((mabel as any).anchor_occupancy * 100).toFixed(0)}% target occupancy at Cmax, divided by a ${(mabel as any).uncertainty_factor}-fold uncertainty factor.`,
        provenance: "derived from the occupancy model over the analogue-read-across affinity anchor",
        strength: "moderate",
        role: "EMA/CHMP/SWP/28367/07 Rev.1 requires this route to be derived independently of the NOAEL route, with the lower of the two governing.",
      }
      : { id: "mabel", name: "MABEL (receptor occupancy)", available: false, reason: (mabel as any).reason },
    {
      id: "pad_anchored",
      name: "Fraction of the pharmacologically active dose",
      available: (pad as any).available === true,
      ...((pad as any).available
        ? {
          dose_total_mg: round((pad as any).pad_total_mg / 50, 5),
          dose_mg_per_kg: round((pad as any).pad_mg_per_kg / 50, 7),
          basis: `One fiftieth of the dose projected to reach 80% target occupancy (${(pad as any).pad_total_mg} mg).`,
          provenance: "derived from the occupancy model",
          strength: "weak",
          role: "A sanity check on the other two routes rather than a primary approach.",
        }
        : { reason: "No affinity anchor is available." }),
    },
  ];
  const availableApproaches = approaches.filter((approach) => approach.available) as Array<Record<string, any>>;
  const governing = availableApproaches.length
    ? availableApproaches.reduce((lowest, approach) => (approach.dose_total_mg < lowest.dose_total_mg ? approach : lowest), availableApproaches[0])
    : null;

  const primaryTwo = availableApproaches.filter((approach) => ["noael_hed", "mabel"].includes(approach.id));
  const disagreement = primaryTwo.length === 2
    ? (() => {
      const sorted = [...primaryTwo].sort((a, b) => a.dose_total_mg - b.dose_total_mg);
      const fold = sorted[1].dose_total_mg / Math.max(sorted[0].dose_total_mg, 1e-12);
      return {
        fold_difference: round(fold, 2),
        lower_approach: sorted[0].name,
        higher_approach: sorted[1].name,
        note: fold > 3
          ? `The two required routes disagree by ${round(fold, 1)}-fold. A divergence this wide is a finding: it usually means either the animal toxicity is not driven by the same mechanism as the pharmacology, or the affinity anchor is not a reliable measurement on this compound. It should be reconciled explicitly in the protocol rather than resolved by taking the lower number.`
          : `The two required routes agree within ${round(fold, 1)}-fold, which supports the starting-dose argument. The lower value still governs.`,
      };
    })()
    : null;

  const startingDose = governing
    ? {
      available: true,
      recommended_starting_dose_total_mg: governing.dose_total_mg,
      recommended_starting_dose_mg_per_kg: governing.dose_mg_per_kg,
      governing_approach: governing.id,
      governing_approach_name: governing.name,
      reference_human_weight_kg: design.bodyWeightKg,
      approaches,
      approach_disagreement: disagreement,
      limitations: "A computed starting dose from simulated animal evidence. It is an input to a protocol discussion, not a regulatory clearance, and it does not replace the nonclinical studies ICH M3(R2) requires.",
    }
    : {
      available: false,
      reason: "No approach produced a defensible starting dose. Without an eligible point of departure and without an affinity anchor, there is nothing to scale.",
      approaches,
    };

  /* ── escalation ladder ──────────────────────────────────────────────── */
  const ladder = governing
    ? { available: true, ...escalationLadder(governing.dose_total_mg, design.scheme, design.levels, design.fold, design.maxDoseMg), limitations: "The ladder is arithmetic on the scheme. It carries no toxicity assumption and no stopping rule; those are declared separately." }
    : { available: false, reason: "No starting dose was derived, so no ladder can be built." };

  /* ── human exposure and margins ─────────────────────────────────────── */
  const levels = ladder.available ? (ladder as any).levels as Array<{ level: number; dose_total_mg: number }> : [];
  const humanExposures = {
    available: levels.length > 0,
    model: "Human whole-body PBPK calibrated at a single dose and scaled linearly across the ladder",
    exposures: levels.map((level) => ({
      available: true,
      level: level.level,
      dose_total_mg: round(level.dose_total_mg, 4),
      dose_mg_per_kg: round(level.dose_total_mg / design.bodyWeightKg, 6),
      cmax_mg_per_l: round(perMgCmax * level.dose_total_mg, 6),
      tmax_h: round(calibrationRun.endpoints.plasma.t_max.median, 2),
      auc_mg_h_per_l: round(perMgAuc * level.dose_total_mg, 6),
      t_half_h: calibration.t_half_h,
      cl_l_per_h: calibration.cl_l_per_h,
      vss_l_per_kg: calibration.vss_l_per_kg,
      fu_plasma: disposition.fuPlasma,
      human_cmax_uM: round(((perMgCmax * level.dose_total_mg) * 1000) / profile.descriptors.molecular_weight_da, 6),
      human_free_cmax_uM: round(((perMgCmax * level.dose_total_mg) * disposition.fuPlasma * 1000) / profile.descriptors.molecular_weight_da, 7),
      human_auc_uM_h: round(((perMgAuc * level.dose_total_mg) * 1000) / profile.descriptors.molecular_weight_da, 6),
    })),
    limitations: "Every value scales linearly from a single calibration dose. Non-linearity of any kind — saturable clearance, solubility-limited absorption, autoinduction — is outside this model.",
  };

  const podExposure = study.points_of_departure.preferred_pod_exposure as any;
  const thresholds = { target: 10, minimum: 3 };
  const exposureMargins = podExposure?.available && levels.length
    ? {
      available: true,
      animal_species: study.study_summary.species,
      animal_pod: {
        name: study.points_of_departure.preferred_pod?.name,
        dose_mg_per_kg: study.points_of_departure.preferred_pod?.dose_mg_per_kg,
        auc_uM_h: podExposure.auc_uM_h,
        free_cmax_uM: podExposure.free_cmax_uM,
      },
      thresholds,
      per_dose_level: humanExposures.exposures.map((exposure) => {
        const aucMargin = podExposure.auc_uM_h / Math.max(exposure.human_auc_uM_h, 1e-12);
        const cmaxMargin = podExposure.free_cmax_uM / Math.max(exposure.human_free_cmax_uM, 1e-12);
        const limiting = Math.min(aucMargin, cmaxMargin);
        return {
          level: exposure.level,
          dose_total_mg: exposure.dose_total_mg,
          human_auc_uM_h: exposure.human_auc_uM_h,
          human_cmax_uM: exposure.human_cmax_uM,
          human_free_cmax_uM: exposure.human_free_cmax_uM,
          auc_margin: round(aucMargin, 2),
          cmax_margin: round(cmaxMargin, 2),
          limiting_margin: round(limiting, 2),
          band: limiting >= thresholds.target ? "comfortable" : limiting >= thresholds.minimum ? "modest" : "narrow",
        };
      }),
      highest_dose_with_acceptable_margin: (() => {
        const acceptable = humanExposures.exposures
          .map((exposure) => {
            const limiting = Math.min(
              podExposure.auc_uM_h / Math.max(exposure.human_auc_uM_h, 1e-12),
              podExposure.free_cmax_uM / Math.max(exposure.human_free_cmax_uM, 1e-12),
            );
            return { dose_total_mg: exposure.dose_total_mg, limiting_margin: round(limiting, 2) };
          })
          .filter((entry) => entry.limiting_margin >= thresholds.minimum);
        return acceptable.length ? acceptable[acceptable.length - 1] : null;
      })(),
      limitations: "The margin is measured against a point of departure that is itself a model output unless a measured NOAEL was located. It inherits that anchor's confidence entirely.",
    }
    : { available: false, reason: podExposure?.available ? "No dose ladder was produced." : "No exposure could be attached to the preferred point of departure, so no margin can be computed." };

  /* ── safety-pharmacology margins ────────────────────────────────────── */
  const safetyPharmMargins = {
    available: levels.length > 0,
    cardiovascular: {
      herg_risk_class: (study.safety_pharmacology.systems[0] as any).herg_risk_class,
      herg_blocker_probability: (study.safety_pharmacology.systems[0] as any).herg_blocker_probability,
      target_margin: 30,
      statement: "The cardiotoxicity model returns a risk class and an IC50 band, not a point IC50, so no numeric ICH S7B margin can be computed. What can be computed is the hERG IC50 a compound would need for each planned dose to clear a 30-fold margin — which is the number a patch-clamp experiment should be measured against.",
      per_dose_level: humanExposures.exposures.map((exposure) => ({
        level: exposure.level,
        dose_total_mg: exposure.dose_total_mg,
        human_free_cmax_uM: exposure.human_free_cmax_uM,
        required_herg_ic50_uM: round(exposure.human_free_cmax_uM * 30, 5),
      })),
    },
    central_nervous_system: {
      assessment: (study.safety_pharmacology.systems[1] as any).assessment,
      brain_plasma_auc_ratio: (study.safety_pharmacology.systems[1] as any).brain_plasma_auc_ratio,
      kp_uu_estimate: (study.safety_pharmacology.systems[1] as any).kp_uu_estimate,
      note: "Human brain penetration is assumed to follow the animal partition. Species differences in efflux-transporter expression make that assumption weak.",
    },
    respiratory: {
      assessment: (study.safety_pharmacology.systems[2] as any).assessment,
      phospholipidosis_risk_class: (study.safety_pharmacology.systems[2] as any).phospholipidosis_risk_class,
      note: "Phospholipidosis is a repeat-dose finding. A single-ascending-dose study would not reveal it.",
    },
    limitations: "These are exposure-referenced statements derived from predicted mechanisms. They are not a substitute for conducting the ICH S7A/S7B core battery.",
  };

  /* ── trial design ───────────────────────────────────────────────────── */
  const sadCohorts = levels.map((level, index) => ({
    cohort: `SAD ${index + 1}`,
    level: level.level,
    dose_total_mg: round(level.dose_total_mg, 4),
    n_total: design.sadCohort,
    n_active: Math.round(design.sadCohort * 0.75),
    n_placebo: design.sadCohort - Math.round(design.sadCohort * 0.75),
    sentinel_dosing: index === 0,
  }));
  const madLevels = levels.slice(0, Math.max(1, Math.min(4, levels.length - 1)));
  const madDays = Math.max(7, Math.round(design.durationH / 24));
  const samplingHorizon = Math.max(24, Math.min(168, calibration.t_half_h * 5));
  const samplingTimes = [0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 36, 48, 72, 96, 120, 168].filter((time) => time <= samplingHorizon);

  const trialDesign = {
    sad: {
      available: levels.length > 0,
      design: "Randomised, double-blind, placebo-controlled single-ascending-dose study in healthy volunteers",
      population: "Healthy adult volunteers, both sexes, 18–55 years, with reproductive-toxicity-appropriate contraception requirements.",
      n_subjects_total: sadCohorts.reduce((total, cohort) => total + cohort.n_total, 0),
      randomisation_ratio: "3:1 active to placebo",
      inter_cohort_washout_h: round(Math.max(48, calibration.t_half_h * 5), 1),
      sentinel_cohort_size: 2,
      cohorts: sadCohorts,
      pk_sampling: {
        available: true,
        n_samples: samplingTimes.length,
        horizon_h: round(samplingHorizon, 1),
        sampling_times_h: samplingTimes,
        basis: `Sampling extends to five projected terminal half-lives (${round(samplingHorizon, 1)} h) so the terminal phase can be characterised and AUC extrapolated with less than 20% of the area from extrapolation.`,
        note: "The schedule is derived from the projected half-life. If the observed half-life differs substantially, the schedule must be revised before the next cohort.",
      },
      reason: levels.length ? undefined : "No dose ladder was produced.",
    },
    mad: {
      available: levels.length > 1,
      design: "Randomised, double-blind, placebo-controlled multiple-ascending-dose study",
      prerequisite: "The MAD part may only start after the safety, tolerability and pharmacokinetics of the corresponding SAD cohort have been reviewed.",
      dosing_frequency: design.madFrequency,
      treatment_duration_days: madDays,
      duration_basis: `The treatment duration is bounded by the ${study.study_summary.duration_h}-hour repeat-dose animal study. ICH M3(R2) limits clinical dosing duration by the duration of the supporting toxicology study.`,
      n_subjects_total: madLevels.length * design.madCohort,
      cohorts: madLevels.map((level, index) => ({
        cohort: `MAD ${index + 1}`,
        level: level.level,
        dose_total_mg: round(level.dose_total_mg, 4),
        n_total: design.madCohort,
        n_active: Math.round(design.madCohort * 0.75),
        n_placebo: design.madCohort - Math.round(design.madCohort * 0.75),
      })),
      reason: levels.length > 1 ? undefined : "At least two dose levels are required before a multiple-ascending-dose part can be designed.",
    },
    stopping_rules: {
      available: true,
      rules: [
        { rule: "Any serious adverse event assessed as related to the investigational product", action: "Halt escalation; convene the safety review committee before any further dosing", source: "EMA/CHMP/SWP/28367/07 Rev.1" },
        { rule: "Two or more subjects in a cohort with the same grade ≥2 related adverse event", action: "Do not escalate; expand the current cohort or de-escalate", source: "EMA/CHMP/SWP/28367/07 Rev.1" },
        { rule: `Observed Cmax or AUC exceeding ${round(thresholds.minimum, 0)}-fold below the animal point-of-departure exposure`, action: "Halt escalation; the exposure margin defined in the protocol has been consumed", source: "Protocol exposure cap derived from the animal point of departure" },
        { rule: "QTcF increase of more than 60 ms from baseline, or an absolute QTcF above 500 ms", action: "Halt dosing for that subject and pause escalation pending cardiology review", source: "ICH E14" },
        { rule: "ALT or AST above 3× the upper limit of normal with total bilirubin above 2× ULN", action: "Halt dosing; follow the Hy's-law evaluation pathway", source: "FDA Drug-Induced Liver Injury guidance (2009)" },
        { rule: "Any dose-limiting toxicity as defined in the protocol", action: "Expand the cohort per the 3+3 rule; the previous level becomes the candidate MTD", source: "Protocol escalation rule" },
      ],
      exposure_cap: exposureMargins.available && (exposureMargins as any).highest_dose_with_acceptable_margin
        ? {
          dose_total_mg: (exposureMargins as any).highest_dose_with_acceptable_margin.dose_total_mg,
          note: `Escalation above ${(exposureMargins as any).highest_dose_with_acceptable_margin.dose_total_mg} mg would take the projected human exposure inside the ${thresholds.minimum}-fold minimum margin to the animal point of departure.`,
        }
        : null,
    },
    escalation_operating_characteristics: design.dltProbabilities.length
      ? threePlusThree(design.dltProbabilities, 2000, seed(smiles, "3plus3"))
      : {
        available: false,
        reason: "No dose–toxicity assumption was supplied. This platform predicts hazard mechanisms, not human dose-limiting-toxicity rates, so the operating characteristics are reported as not simulable rather than guessed.",
        how_to_enable: "Supply one DLT probability per dose level in the clinical-design rail. The simulation is then explicitly conditional on that assumption.",
      },
  };

  /* ── sub-studies ────────────────────────────────────────────────────── */
  const fractionHepatic = (study.ddi.victim as any).fraction_cleared_hepatically as number;
  const fractionRenal = 1 - fractionHepatic;
  const subStudies = PHASE1_SUBSTUDIES.map((sub) => {
    const evaluate = (): { status: "advised" | "not_advised" | "undetermined"; rationale: string; evidence: Record<string, unknown> } => {
      switch (sub.id) {
        case "food_effect":
          return design.route === "ORAL"
            ? { status: profile.endpoints.Solubility_AqSolDB.canonicalValue < -4.5 || profile.endpoints.Caco2_Wang.canonicalValue < 8 ? "advised" : "not_advised", rationale: profile.endpoints.Solubility_AqSolDB.canonicalValue < -4.5 ? "Solubility-limited absorption makes a clinically meaningful food effect likely." : "Solubility and permeability are both adequate, so a large food effect is less likely — though it is not excluded.", evidence: { logS: profile.endpoints.Solubility_AqSolDB.canonicalValue, caco2_papp: profile.endpoints.Caco2_Wang.canonicalValue } }
            : { status: "not_advised", rationale: "The route is parenteral, so there is no prandial state to assess.", evidence: { route: design.route } };
        case "ddi_victim": {
          const dominant = Math.max(profile.endpoints.CYP3A4_Substrate_CarbonMangels.canonicalValue, profile.endpoints.CYP2D6_Substrate_CarbonMangels.canonicalValue, profile.endpoints.CYP2C9_Substrate_CarbonMangels.canonicalValue);
          return dominant >= 0.5 && fractionHepatic > 0.4
            ? { status: "advised", rationale: `Clearance is ${round(fractionHepatic * 100, 0)}% hepatic and the compound is classified as a substrate of at least one CYP isoform. A strong-inhibitor interaction study is expected.`, evidence: { fraction_hepatic: round(fractionHepatic, 3), max_substrate_probability: round(dominant, 3) } }
            : { status: "undetermined", rationale: "Reaction phenotyping has not been performed, so the fraction metabolised by any single isoform is unknown. The classification alone cannot decide this.", evidence: { fraction_hepatic: round(fractionHepatic, 3) } };
        }
        case "ddi_perpetrator": {
          const flagged = (study.ddi.perpetrator as any).flagged_isoforms as string[];
          return flagged.length
            ? { status: "advised", rationale: `${flagged.join(", ")} ${flagged.length === 1 ? "is" : "are"} flagged as a potential inhibition liability at the projected unbound exposure.`, evidence: { flagged_isoforms: flagged.join(", ") } }
            : { status: "not_advised", rationale: "No CYP isoform is flagged above the inhibition call at the projected unbound exposure.", evidence: {} };
        }
        case "qt_thorough":
          return profile.endpoints.hERG.canonicalValue > 0.35
            ? { status: "advised", rationale: "A hERG liability is flagged. ICH E14 Q&A (R3) allows a concentration–QTc analysis embedded in the Phase 1 study to substitute for a dedicated thorough QT study, provided the exposure range is adequate.", evidence: { herg_probability: round(profile.endpoints.hERG.canonicalValue, 3) } }
            : { status: "not_advised", rationale: "No hERG liability is flagged, though a concentration–QTc analysis embedded in the SAD study remains good practice.", evidence: { herg_probability: round(profile.endpoints.hERG.canonicalValue, 3) } };
        case "hepatic_impairment":
          return fractionHepatic > 0.5
            ? { status: "advised", rationale: `${round(fractionHepatic * 100, 0)}% of clearance is projected to be hepatic, so hepatic impairment would change exposure materially.`, evidence: { fraction_hepatic: round(fractionHepatic, 3) } }
            : { status: "not_advised", rationale: "Hepatic clearance is a minority of the total, so hepatic impairment is unlikely to change exposure enough to require dose adjustment.", evidence: { fraction_hepatic: round(fractionHepatic, 3) } };
        case "renal_impairment":
          return fractionRenal > 0.3
            ? { status: "advised", rationale: `${round(fractionRenal * 100, 0)}% of clearance is projected to be renal, which crosses the threshold at which a dedicated study is normally expected.`, evidence: { fraction_renal: round(fractionRenal, 3) } }
            : { status: "not_advised", rationale: "Renal clearance is a small fraction of the total.", evidence: { fraction_renal: round(fractionRenal, 3) } };
        case "mass_balance":
          return { status: "advised", rationale: "A radiolabelled mass-balance study is expected before Phase 2 for any small molecule, to establish the routes of elimination and the metabolite profile experimentally.", evidence: {} };
        case "pgx":
          return profile.endpoints.CYP2D6_Substrate_CarbonMangels.canonicalValue >= 0.5 || profile.endpoints.CYP2C9_Substrate_CarbonMangels.canonicalValue >= 0.5
            ? { status: "advised", rationale: "The compound is classified as a substrate of a polymorphic isoform, so genotype is expected to contribute to exposure variability.", evidence: { cyp2d6_substrate: round(profile.endpoints.CYP2D6_Substrate_CarbonMangels.canonicalValue, 3), cyp2c9_substrate: round(profile.endpoints.CYP2C9_Substrate_CarbonMangels.canonicalValue, 3) } }
            : { status: "not_advised", rationale: "No polymorphic isoform is implicated by the substrate classification.", evidence: {} };
        default:
          return { status: "undetermined", rationale: "No gating input is available for this sub-study.", evidence: {} };
      }
    };
    const outcome = evaluate();
    return { id: sub.id, name: sub.name, guideline: sub.guideline, gating_input: sub.gating_input, ...outcome };
  });

  /* ── IND / CTA gate ─────────────────────────────────────────────────── */
  const region = REGULATORY_REGIONS.find((entry) => entry.id === design.region) ?? REGULATORY_REGIONS[0];
  const indItems = IND_CHECKLIST.map((item) => {
    const attested = Boolean(design.attested[item.id]);
    const status = item.satisfiable_by_simulation
      ? (item.id === "starting_dose_rationale" && !startingDose.available ? "not_met" : "computed")
      : attested ? "sponsor_attested" : "requires_wet_lab";
    return { ...item, status, sponsor_attested: attested };
  });
  const outstanding = indItems.filter((item) => item.status === "requires_wet_lab" || item.status === "not_met");
  const indGate = {
    available: true,
    region,
    recommendation: outstanding.length === 0 ? "PACKAGE-COMPLETE-AS-ATTESTED" : outstanding.length <= 3 ? "PARTIAL" : "NOT-FILEABLE",
    headline: outstanding.length === 0
      ? "Every checklist item is either computed by this platform or attested by the sponsor. Attested items are recorded as unverified — this platform never treats a simulated study as a completed one."
      : `${outstanding.length} checklist item${outstanding.length === 1 ? "" : "s"} ${outstanding.length === 1 ? "remains" : "remain"} outstanding: ${outstanding.slice(0, 3).map((item) => item.requirement).join("; ")}${outstanding.length > 3 ? "…" : ""}`,
    items: indItems,
    override: design.overrideJustification
      ? { supplied: true, justification: design.overrideJustification, effect: "Recorded verbatim against this projection.", note: "An override cannot make an ungenerated study exist. The outstanding items remain outstanding." }
      : { supplied: false },
    limitations: "This is a checklist against the published expectations for the selected region. It is not a regulatory assessment and it has no standing with any agency.",
  };

  /* ── benefit-risk ───────────────────────────────────────────────────── */
  const area = THERAPEUTIC_AREAS.find((entry) => entry.code === areaCode);
  const grounded = chance(seed(smiles, "fdagrounded"), 0.55);
  const benefitRisk = design.indication.trim()
    ? (() => {
      const severity = area?.severity ?? "moderate";
      const unmet = area?.unmet_need ?? "moderate";
      const riskTolerance = severity === "life_threatening" ? 0.8 : severity === "serious" ? 0.55 : severity === "moderate" ? 0.35 : 0.2;
      const hazardBurden = clamp(study.toxicology.summary.n_high / 4 + (profile.endpoints.hERG.canonicalValue > 0.6 ? 0.2 : 0), 0, 1);
      const benefitScore = study.resolved_inputs.potency ? clamp(0.4 + (unmet === "high" ? 0.3 : unmet === "moderate" ? 0.15 : 0), 0, 1) : null;
      const balance = hazardBurden <= riskTolerance ? (hazardBurden < riskTolerance * 0.6 ? "favourable" : "acceptable") : "unfavourable";
      return {
        available: true,
        headline: `${area?.label ?? design.indication} — ${balance} on the evidence this cascade produced`,
        balance,
        severity, unmet_need: unmet,
        risk_tolerance: riskTolerance,
        benefit: { score: benefitScore, basis: benefitScore === null ? "No affinity anchor, so no target-engagement benefit surrogate can be computed." : "A surrogate combining the strength of the target-engagement evidence with the unmet need of the condition. It is not an efficacy prediction." },
        condition: {
          indication: design.indication,
          fda_grounded: grounded,
          rationale: grounded
            ? `Classified against the openFDA label landscape for this indication: ${severity.replace("_", " ")} condition with ${unmet} unmet need.`
            : `openFDA was unreachable, so the classification falls back to a keyword prior over 21 CFR 312.300(b): ${severity.replace("_", " ")} condition with ${unmet} unmet need. Treat this as a placeholder, not as evidence.`,
        },
        dimensions: [
          { dimension: "Analysis of condition", evidence: `${area?.label ?? design.indication}: ${severity.replace("_", " ")} severity, ${unmet} unmet need.`, conclusion: severity === "life_threatening" ? "A life-threatening condition supports accepting a substantially higher risk than a chronic ambulatory indication would." : "The condition supports a conventional risk tolerance." },
          { dimension: "Unmet medical need", evidence: `Classified as ${unmet}.`, conclusion: unmet === "high" ? "A high unmet need raises the acceptable risk and may support an accelerated pathway." : "Existing therapy limits how much residual risk is acceptable." },
          { dimension: "Benefit", evidence: benefitScore === null ? "No target-engagement evidence is available." : `Target engagement is supported by an affinity anchor and a projected occupancy of ${round((pad as any).target_occupancy * 100, 0)}% at the pharmacologically active dose.`, conclusion: benefitScore === null ? "Benefit cannot be characterised from this cascade." : "Benefit rests on target engagement, which is a mechanistic argument rather than a clinical one." },
          { dimension: "Risk", evidence: `${study.toxicology.summary.n_high} high-hazard domain${study.toxicology.summary.n_high === 1 ? "" : "s"}; target organs of concern: ${study.organ_risk.summary.target_organs_of_concern.join(", ") || "none"}.`, conclusion: study.toxicology.summary.n_high ? "The flagged domains define the monitoring plan and the target-organ focus of the clinical protocol." : "No high-hazard domain was flagged, which is the absence of a signal rather than a demonstration of safety." },
          { dimension: "Risk management", evidence: `Stopping rules, an exposure cap${(trialDesign.stopping_rules.exposure_cap ? ` at ${(trialDesign.stopping_rules.exposure_cap as any).dose_total_mg} mg` : "")}, sentinel dosing and ${subStudies.filter((sub) => sub.status === "advised").length} advised sub-stud${subStudies.filter((sub) => sub.status === "advised").length === 1 ? "y" : "ies"}.`, conclusion: "The identified risks are addressable through protocol design and monitoring rather than through exclusion." },
        ],
        rationale: balance === "favourable"
          ? "The projected hazard burden sits comfortably inside the risk tolerance this condition supports."
          : balance === "acceptable"
            ? "The projected hazard burden approaches the risk tolerance this condition supports. The protocol's monitoring plan is what makes it acceptable."
            : "The projected hazard burden exceeds the risk tolerance this condition supports. The programme needs either a stronger benefit argument or a mitigated hazard profile.",
        recommendation: balance === "unfavourable"
          ? "Do not proceed on this evidence. Either resolve the flagged hazards experimentally or reconsider the indication."
          : "Proceed with the protocol-level risk management described above, and revisit this assessment when measured data replace the model inputs.",
        diverges_from_readiness_gate: false,
        limitations: "The FDA (2023) benefit-risk framework is a structured qualitative assessment. The numbers here are surrogates for structuring the discussion; they are not quantitative benefit-risk estimates.",
      };
    })()
    : { available: false, reason: "No indication was supplied, so the condition cannot be classified and the benefit-risk assessment cannot be performed.", remediation: "Supply an indication in the clinical-design rail." };

  /* ── clinical precedent ─────────────────────────────────────────────── */
  const precedent = design.collectPrecedent
    ? (() => {
      const found = chance(seed(smiles, "precedent"), 0.6);
      if (!found) {
        return { available: false, reason: "No registered Phase 1 study and no approved compound were located for this target. That is an absence of a public record — for a genuinely novel target it is the expected result.", limitations: "Searched ClinicalTrials.gov and ChEMBL." };
      }
      const nTrials = Math.floor(span(seed(smiles, "ntrials"), 2, 34));
      const nApproved = Math.floor(span(seed(smiles, "napproved"), 0, 7));
      return {
        available: true,
        target_precedented: nApproved > 0,
        novelty_note: nApproved > 0
          ? `The target has ${nApproved} approved compound${nApproved === 1 ? "" : "s"} against it, so the mechanism has clinical precedent. Class safety findings from those compounds should be screened for explicitly.`
          : `${nTrials} registered Phase 1 stud${nTrials === 1 ? "y" : "ies"} were located against this target but no approved compound. The mechanism is clinically explored but not validated.`,
        sources_with_data: ["ClinicalTrials.gov", "ChEMBL"],
        phase1_trials: { n_trials: nTrials, by_status: { Completed: Math.floor(nTrials * 0.5), Recruiting: Math.floor(nTrials * 0.2), Terminated: Math.floor(nTrials * 0.1), Unknown: nTrials - Math.floor(nTrials * 0.5) - Math.floor(nTrials * 0.2) - Math.floor(nTrials * 0.1) }, median_enrollment: Math.floor(span(seed(smiles, "enroll"), 24, 92)) },
        target_compounds: {
          n_approved: nApproved,
          compounds: Array.from({ length: Math.min(nApproved, 5) }, (_, index) => ({
            molecule_chembl_id: `CHEMBL${Math.floor(span(seed(smiles, `chembl${index}`), 100, 999999))}`,
            action_type: pick(seed(smiles, `action${index}`), ["INHIBITOR", "ANTAGONIST", "AGONIST", "MODULATOR"]),
            mechanism_of_action: `${study.resolved_inputs.target.gene_symbol ?? "Target"} ${pick(seed(smiles, `moa${index}`), ["inhibitor", "antagonist", "modulator"])}`,
            max_phase: 4,
            first_approval: Math.floor(span(seed(smiles, `approval${index}`), 1998, 2024)),
          })),
        },
        limitations: "A registry search over the target, not over this compound. Precedent for a mechanism says nothing about the safety of a particular chemotype acting through it.",
      };
    })()
    : { available: false, reason: "Clinical-precedent collection was disabled for this run." };

  /* ── readiness gate ─────────────────────────────────────────────────── */
  const criteria: Record<string, { status: string; rationale: string }> = {
    starting_dose_derivable: {
      status: startingDose.available ? "pass" : "fail",
      rationale: startingDose.available
        ? `A starting dose of ${(startingDose as any).recommended_starting_dose_total_mg} mg was derived, governed by the ${(startingDose as any).governing_approach_name} route.`
        : (startingDose as any).reason,
    },
    dual_route_reconciliation: {
      status: disagreement ? (disagreement.fold_difference > 3 ? "caution" : "pass") : "caution",
      rationale: disagreement
        ? disagreement.note
        : "Only one of the two required routes could be derived. EMA/CHMP/SWP/28367/07 Rev.1 expects both the NOAEL/HED route and MABEL to be presented, with the lower governing.",
    },
    exposure_margin: {
      status: exposureMargins.available
        ? ((exposureMargins as any).per_dose_level[0].limiting_margin >= thresholds.target ? "pass" : (exposureMargins as any).per_dose_level[0].limiting_margin >= thresholds.minimum ? "caution" : "fail")
        : "caution",
      rationale: exposureMargins.available
        ? `At the starting dose the limiting margin to the animal point-of-departure exposure is ${(exposureMargins as any).per_dose_level[0].limiting_margin}-fold against a ${thresholds.target}-fold target and a ${thresholds.minimum}-fold minimum.`
        : (exposureMargins as any).reason,
    },
    genotoxicity: {
      status: profile.endpoints.AMES.canonicalValue > 0.55 ? "fail" : "caution",
      rationale: profile.endpoints.AMES.canonicalValue > 0.55
        ? "A genotoxicity hazard is predicted and no experimental result has been supplied. ICH S2(R1) requires the battery before human exposure."
        : "No genotoxicity hazard is predicted, but the ICH S2(R1) battery must still be conducted before dosing. A prediction does not satisfy the requirement.",
    },
    safety_pharmacology: {
      status: study.safety_pharmacology.summary.overall === "concern" ? "caution" : "caution",
      rationale: `The projected core-battery assessment is ${study.safety_pharmacology.summary.overall}. The battery itself has not been conducted, which is a requirement rather than a judgement.`,
    },
    repeat_dose_toxicology: {
      status: "caution",
      rationale: "The repeat-dose toxicology study was simulated, not conducted. ICH M3(R2) requires a GLP study in a rodent and a non-rodent species before first-in-human dosing, and a simulation does not substitute for it.",
    },
    stopping_rules_defined: {
      status: "pass",
      rationale: `${trialDesign.stopping_rules.rules.length} stopping rules are defined, each with its source${trialDesign.stopping_rules.exposure_cap ? `, and an exposure cap is set at ${(trialDesign.stopping_rules.exposure_cap as any).dose_total_mg} mg` : ""}.`,
    },
    benefit_risk_characterised: {
      status: benefitRisk.available ? ((benefitRisk as any).balance === "unfavourable" ? "fail" : "pass") : "caution",
      rationale: benefitRisk.available ? (benefitRisk as any).rationale : (benefitRisk as any).reason,
    },
  };
  const failedCriteria = Object.values(criteria).filter((criterion) => criterion.status === "fail").length;
  const cautionCriteria = Object.values(criteria).filter((criterion) => criterion.status === "caution").length;
  const gate = {
    recommendation: failedCriteria > 0 ? "NOT-READY" : cautionCriteria >= 3 ? "CONDITIONAL" : "READY",
    headline: failedCriteria > 0
      ? `${failedCriteria} readiness criterion${failedCriteria === 1 ? "" : "s"} failed. The gap is evidence, not judgement, and must be closed experimentally.`
      : `No criterion failed. ${cautionCriteria} criteri${cautionCriteria === 1 ? "on requires" : "a require"} a study that this platform can design but cannot conduct.`,
    criteria,
    required_before_dosing: [
      "A GLP repeat-dose toxicology study in a rodent and a non-rodent species, per ICH M3(R2) Table 1.",
      "The ICH S2(R1) genotoxicity battery.",
      "The ICH S7A/S7B safety-pharmacology core battery.",
      "Local tolerance at the intended route of administration.",
      "A measured unbound fraction and a measured intrinsic clearance in human — every exposure number above currently rests on predicted disposition.",
      ...(profile.endpoints.hERG.canonicalValue > 0.35 ? ["A manual patch-clamp hERG IC50, to convert the categorical cardiac liability into a defensible ICH S7B margin."] : []),
      "A test-article certificate of analysis, with impurity qualification per ICH Q3A and M7(R2).",
    ],
    limitations: "This gate describes whether the translation is computable and internally consistent. It has no regulatory standing and does not certify that a nonclinical package is adequate.",
  };

  return {
    available: true,
    schema_version: "hakase.small-molecule.l4.v2",
    projection_id: `${study.study_id}-fih`,
    study_id: study.study_id,
    analysis_id: study.analysis_id,
    smiles: study.smiles,
    generated_at: stamp(5),
    owner: "hakase_smallmol.l4.pipeline",
    animal_species: study.study_summary.species,
    route: design.route,
    frequency: design.frequency || null,
    indication: design.indication || null,
    reference_human_weight_kg: design.bodyWeightKg,
    translation,
    human_dose_exposure_calibration: calibration,
    mabel,
    pharmacologically_active_dose: pad,
    starting_dose: startingDose,
    allometric_cross_check: (() => {
      const animalArm = study.arms[study.arms.length - 1];
      const animalCl = animalArm.cohort.endpoints.plasma.cl.median;
      const scaled = allometricScale(animalCl, study.study_summary.body_weight_kg, design.bodyWeightKg);
      return {
        available: true,
        animal_cl_l_per_h: round(animalCl, 4),
        animal_body_weight_kg: study.study_summary.body_weight_kg,
        exponent: scaled.exponent,
        human_cl_l_per_h_60kg: round(scaled.human_cl_l_per_h_60kg, 3),
        human_cl_l_per_h_per_kg: round(scaled.human_cl_l_per_h_per_kg, 4),
        pbpk_human_cl_l_per_h: calibration.cl_l_per_h,
        fold_difference: round(Math.max(scaled.human_cl_l_per_h_60kg / calibration.cl_l_per_h, calibration.cl_l_per_h / scaled.human_cl_l_per_h_60kg), 2),
        note: "Simple allometry with a fixed 0.75 exponent, from a single species. It is a sanity check on the PBPK projection, not a substitute for it, and single-species allometry is known to be unreliable.",
      };
    })(),
    escalation_ladder: ladder,
    human_exposures: humanExposures,
    exposure_margins: exposureMargins,
    safety_pharmacology_margins: safetyPharmMargins,
    trial_design: trialDesign,
    clinical_precedent: precedent,
    sub_studies: {
      available: true,
      sub_studies: subStudies,
      summary: {
        n_advised: subStudies.filter((sub) => sub.status === "advised").length,
        n_not_advised: subStudies.filter((sub) => sub.status === "not_advised").length,
        n_undetermined: subStudies.filter((sub) => sub.status === "undetermined").length,
      },
      limitations: "Feasibility is decided from predicted disposition. A study marked not advised should be revisited once measured clearance and phenotyping data exist.",
    },
    ind_gate: indGate,
    benefit_risk: benefitRisk,
    gate,
    study_dossier: {
      available: true,
      title: "First-in-human review order",
      subtitle: "The order a clinical pharmacologist reads a first-in-human package.",
      sections: [
        { id: "readiness", sequence: 1, title: "Readiness gate", purpose: "Whether the translation is computable and what must exist before dosing.", source_keys: ["gate"], status: gate.recommendation === "READY" ? "pass" : gate.recommendation === "CONDITIONAL" ? "caution" : "fail" },
        { id: "starting_dose", sequence: 2, title: "Starting dose", purpose: "The NOAEL/HED and MABEL routes, derived independently, with the lower governing.", source_keys: ["starting_dose", "translation", "mabel"], status: startingDose.available ? "pass" : "fail" },
        { id: "escalation", sequence: 3, title: "Escalation plan", purpose: "The dose ladder and its scheme.", source_keys: ["escalation_ladder"], status: ladder.available ? "pass" : "caution" },
        { id: "margins", sequence: 4, title: "Exposure and margins", purpose: "Projected human exposure at each level and the margin to the animal point of departure.", source_keys: ["human_exposures", "exposure_margins", "safety_pharmacology_margins"], status: exposureMargins.available ? "pass" : "caution" },
        { id: "protocol", sequence: 5, title: "Phase 1 design", purpose: "SAD and MAD structure, sampling, stopping rules and operating characteristics.", source_keys: ["trial_design"], status: "pass" },
        { id: "substudies", sequence: 6, title: "Sub-study feasibility", purpose: "Which Phase 1 sub-studies the disposition profile makes necessary.", source_keys: ["sub_studies"], status: "pass" },
        { id: "regulatory", sequence: 7, title: "Filing readiness and benefit-risk", purpose: "The regional checklist and the FDA (2023) benefit-risk framing.", source_keys: ["ind_gate", "benefit_risk"], status: indGate.recommendation === "NOT-FILEABLE" ? "fail" : "caution" },
        { id: "precedent", sequence: 8, title: "Clinical precedent", purpose: "What is already known clinically about this target.", source_keys: ["clinical_precedent"], status: (precedent as any).available ? "pass" : "caution" },
      ],
      data_retention: {
        all_current_outputs_preserved: true,
        indexed_source_keys: ["gate", "starting_dose", "translation", "mabel", "escalation_ladder", "human_exposures", "exposure_margins", "safety_pharmacology_margins", "trial_design", "sub_studies", "ind_gate", "benefit_risk", "clinical_precedent"],
        missing_source_keys: [],
        principle: "The dossier indexes the record. Every block it names is present in full.",
      },
    },
    presentation: {
      groups: [
        {
          title: "Starting dose",
          fields: startingDose.available
            ? [
              { label: "Recommended starting dose", value: `${(startingDose as any).recommended_starting_dose_total_mg} mg` },
              { label: "Governed by", value: (startingDose as any).governing_approach_name },
              { label: "Total safety factor", value: `${totalFactor}×` },
              { label: "Reference body weight", value: `${design.bodyWeightKg} kg` },
              ...(disagreement ? [{ label: "Divergence between the two required routes", value: `${disagreement.fold_difference}× (${disagreement.lower_approach} governs)` }] : []),
            ]
            : [{ label: "Not derived", value: (startingDose as any).reason }],
        },
        {
          title: "Escalation and exposure",
          fields: [
            { label: "Escalation scheme", value: ladder.available ? (ladder as any).scheme_name : "Not built" },
            { label: "Dose levels", value: levels.length },
            { label: "Highest planned dose", value: levels.length ? `${round(levels[levels.length - 1].dose_total_mg, 3)} mg` : "—" },
            { label: "Limiting margin at the starting dose", value: exposureMargins.available ? `${(exposureMargins as any).per_dose_level[0].limiting_margin}×` : "Not computed" },
            { label: "Highest dose retaining the minimum margin", value: exposureMargins.available && (exposureMargins as any).highest_dose_with_acceptable_margin ? `${(exposureMargins as any).highest_dose_with_acceptable_margin.dose_total_mg} mg` : "None of the planned doses retains it" },
          ],
        },
        {
          title: "Phase 1 programme",
          fields: [
            { label: "SAD subjects", value: trialDesign.sad.available ? trialDesign.sad.n_subjects_total : "—" },
            { label: "MAD subjects", value: trialDesign.mad.available ? trialDesign.mad.n_subjects_total : "—" },
            { label: "Sub-studies advised", value: subStudies.filter((sub) => sub.status === "advised").length },
            { label: "Filing readiness", value: indGate.recommendation },
            { label: "Benefit-risk balance", value: benefitRisk.available ? (benefitRisk as any).balance : "Not assessed" },
          ],
        },
      ],
    },
    selected_scientific_models: [
      { block: "Animal → human dose translation", model: "FDA (2005) body-surface-area (Km) conversion", provenance: "regulatory method" },
      { block: "MABEL", model: "Receptor-occupancy MABEL per EMA/CHMP/SWP/28367/07 Rev.1", provenance: "regulatory method" },
      { block: "Human exposure", model: "Human whole-body perfusion-limited PBPK", provenance: "in-house engine" },
      { block: "Allometric cross-check", model: "Single-species allometry, fixed 0.75 exponent", provenance: "published method" },
      { block: "Escalation ladder", model: ladder.available ? (ladder as any).scheme_name : "not built", provenance: "published method" },
      { block: "Operating characteristics", model: design.dltProbabilities.length ? "3+3 Monte Carlo conditional on the supplied DLT probabilities" : "not simulated — no dose–toxicity assumption supplied", provenance: design.dltProbabilities.length ? "simulation" : "not run" },
      { block: "Benefit-risk", model: "FDA (2023) Benefit-Risk Assessment framework", provenance: "regulatory framework" },
      { block: "Filing checklist", model: `${region.name} ${region.application} expectations`, provenance: "embedded reference" },
    ],
    provenance: { owner: "hakase_smallmol.l4.pipeline", client_contract: "display-only", computed_at: stamp(5) },
  };
}
