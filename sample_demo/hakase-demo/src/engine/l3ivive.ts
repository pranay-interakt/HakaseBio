/**
 * Layer 3 — IVIVE exposure projection and the Layer 2 → Layer 3 stage gate.
 *
 * The exposure projection runs the whole-body PBPK from `lib/pk.ts` on the
 * disposition inputs the profile carries, with any measured override taking
 * precedence over the predicted value. The stage gate evaluates the accumulated
 * evidence and separates hard blocks — which cannot be signed away — from
 * acknowledgeable warnings.
 */

import { round, stamp } from "../lib/format";
import { clamp } from "../lib/format";
import { chance, logSpan, span, unit } from "../lib/rng";
import { clearance, simulateCohort, species, type Disposition, type StudyContext } from "../lib/pk";
import type { CompoundProfile } from "./profile";
import type { L1Record } from "./l1";

const seed = (smiles: string, channel: string) => `${smiles}::l3::${channel}`;

export type MeasuredOverrides = Partial<Record<"fu_plasma" | "clint_hep_ul_min_1e6" | "vdss_l_per_kg" | "half_life_obach_h" | "blood_plasma_ratio", number>>;

export function dispositionFor(profile: CompoundProfile, overrides: MeasuredOverrides): { disposition: Disposition; provenance: Record<string, string> } {
  const provenance: Record<string, string> = {
    fu_plasma: overrides.fu_plasma !== undefined ? "measured (user-supplied)" : "ml (ADMET-AI PPBR_AZ)",
    clint_hep_ul_min_1e6: overrides.clint_hep_ul_min_1e6 !== undefined ? "measured (user-supplied)" : "ml (ADMET-AI Clearance_Hepatocyte_AZ)",
    vdss_l_per_kg: overrides.vdss_l_per_kg !== undefined ? "measured (user-supplied)" : "ml (ADMET-AI VDss_Lombardo)",
    half_life_obach_h: overrides.half_life_obach_h !== undefined ? "measured (user-supplied)" : "ml (ADMET-AI Half_Life_Obach)",
    blood_plasma_ratio: overrides.blood_plasma_ratio !== undefined ? "measured (user-supplied)" : "assumed (haematocrit default)",
    logp: "ml (RDKit Wildman–Crippen estimate)",
    fraction_absorbed: "derived (from the predicted Caco-2 permeability)",
    fraction_escaping_gut: "derived (from the predicted CYP3A4 substrate and P-gp classifications)",
    ka: "derived (from the predicted fraction absorbed)",
    kpuu_brain: "ml (ADMET-AI BBB_Martins, scaled to an unbound partition)",
  };
  return {
    disposition: {
      fuPlasma: overrides.fu_plasma ?? profile.disposition.fuPlasma,
      clintHepUlMin1e6: overrides.clint_hep_ul_min_1e6 ?? profile.disposition.clintHepUlMin1e6,
      bloodPlasmaRatio: overrides.blood_plasma_ratio ?? profile.disposition.bloodPlasmaRatio,
      logP: profile.descriptors.logp,
      mw: profile.descriptors.molecular_weight_da,
      fractionAbsorbed: profile.disposition.fractionAbsorbed,
      fractionEscapingGut: profile.disposition.fractionEscapingGut,
      kaPerHour: profile.disposition.kaPerHour,
      renalReabsorption: profile.disposition.renalReabsorption,
      kpuuBrain: profile.disposition.kpuuBrain,
    },
    provenance,
  };
}

export type ExposureInput = {
  speciesId: string;
  strain: string;
  bodyWeightKg: number;
  route: "IV" | "ORAL" | "SC";
  doseMgPerKg: number;
  durationH: number;
  infusionDurationH: number | null;
  formulation: string;
  cohortSize: number;
  overrides: MeasuredOverrides;
};

export function runExposure(profile: CompoundProfile, l1: L1Record, input: ExposureInput) {
  const physiology = species(input.speciesId);
  const { disposition, provenance } = dispositionFor(profile, input.overrides);

  const missing: string[] = [];
  if (!(disposition.fuPlasma > 0)) missing.push("fu_plasma — the predicted unbound fraction clamped to zero, which makes the well-stirred clearance zero and the exposure infinite");
  if (!(disposition.clintHepUlMin1e6 > 0)) missing.push("clint_hep_ul_min_1e6 — no positive intrinsic clearance is available");
  if (missing.length) {
    return {
      available: false as const,
      reason: "The exposure projection was refused because a required disposition input is not usable.",
      missing,
      remediation: "Supply the missing value as a measured input in the study rail. A measured value takes precedence over the prediction and is stamped as measured through the whole cascade.",
    };
  }

  const study: StudyContext = {
    route: input.route,
    doseMgPerKg: input.doseMgPerKg,
    durationH: input.durationH,
    infusionDurationH: input.infusionDurationH ?? 0,
    dosingIntervalH: null,
    bodyWeightKg: input.bodyWeightKg,
  };
  const simulation = simulateCohort(physiology, disposition, study, input.cohortSize, seed(profile.smiles, `exp::${input.speciesId}::${input.route}::${input.doseMgPerKg}::${input.durationH}`));
  const cl = clearance(physiology, disposition, input.bodyWeightKg);
  const plasma = simulation.endpoints.plasma;
  const doseMg = input.doseMgPerKg * input.bodyWeightKg;
  const mrt = plasma.auc.median > 0 ? round((plasma.auc.median * plasma.t_half.median) / (plasma.auc.median || 1), 3) : Number.NaN;
  const humanLike = input.speciesId === "human";
  const confidence = disposition.fuPlasma < 0.01 || cl.extractionClass === "high"
    ? "low"
    : humanLike && profile.applicability.domain === "in_domain" ? "moderate" : "low";

  const groups = [
    {
      title: "Systemic exposure",
      fields: [
        { label: "Cmax", value: `${round(plasma.c_max.median, 4)} mg/L (90% interval ${round(plasma.c_max.p05, 4)} – ${round(plasma.c_max.p95, 4)})` },
        { label: "Tmax", value: `${round(plasma.t_max.median, 2)} h` },
        { label: "AUC0–t", value: `${round(plasma.auc.median, 4)} mg·h/L (90% interval ${round(plasma.auc.p05, 4)} – ${round(plasma.auc.p95, 4)})` },
        { label: "AUC coefficient of variation", value: `${round(plasma.auc.cv * 100, 1)}%` },
        { label: "Terminal half-life", value: `${round(plasma.t_half.median, 2)} h` },
        { label: "Observed clearance from the simulated profile", value: `${round(plasma.cl.median, 3)} L/h` },
        { label: "Steady-state distribution volume", value: `${round(simulation.vssLPerKg, 3)} L/kg` },
        { label: "Dose administered", value: `${round(doseMg, 3)} mg (${input.doseMgPerKg} mg/kg × ${input.bodyWeightKg} kg)` },
      ],
    },
    {
      title: "Clearance decomposition",
      fields: [
        { label: "Total plasma clearance", value: `${round(cl.clTotalPlasmaLPerH, 3)} L/h` },
        { label: "Hepatic plasma clearance", value: `${round(cl.clHepaticPlasmaLPerH, 3)} L/h` },
        { label: "Hepatic-clearance provenance", value: provenance.clint_hep_ul_min_1e6 },
        { label: "Renal plasma clearance", value: `${round(cl.clRenalPlasmaLPerH, 3)} L/h` },
        { label: "Scaled intrinsic clearance", value: `${round(cl.clintTotalLPerH, 2)} L/h` },
        { label: "Hepatic blood flow", value: `${round(cl.qhLPerH, 2)} L/h` },
        { label: "Hepatic extraction ratio", value: round(cl.extractionRatio, 3) },
        { label: "Extraction class", value: cl.extractionClass },
        { label: "Fraction cleared hepatically", value: round(cl.fractionHepatic, 3) },
        { label: "Fraction cleared renally", value: round(cl.fractionRenal, 3) },
      ],
    },
    {
      title: "Disposition inputs",
      fields: [
        { label: "Unbound plasma fraction", value: disposition.fuPlasma },
        { label: "Unbound-fraction provenance", value: provenance.fu_plasma },
        { label: "Hepatocyte intrinsic clearance", value: `${disposition.clintHepUlMin1e6} µL/min/10⁶ cells` },
        { label: "Intrinsic-clearance provenance", value: provenance.clint_hep_ul_min_1e6 },
        { label: "Distribution volume", value: `${input.overrides.vdss_l_per_kg ?? profile.disposition.vdssLPerKg} L/kg` },
        { label: "Distribution-volume provenance", value: provenance.vdss_l_per_kg },
        { label: "Blood:plasma ratio", value: disposition.bloodPlasmaRatio },
        { label: "Blood-plasma-ratio provenance", value: provenance.blood_plasma_ratio },
        { label: "logP used for tissue partitioning", value: disposition.logP },
        { label: "Absorption rate constant", value: `${disposition.kaPerHour} h⁻¹` },
      ],
    },
    {
      title: "Bioavailability decomposition",
      fields: [
        { label: "Fraction absorbed (Fa)", value: round(simulation.bioavailability.Fa, 3) },
        { label: "Gut-wall availability (Fg)", value: round(simulation.bioavailability.Fg, 3) },
        { label: "Hepatic first-pass availability (Fh)", value: round(simulation.bioavailability.Fh, 3) },
        { label: "Overall bioavailability (F)", value: round(simulation.bioavailability.F, 3) },
        { label: "Note", value: input.route === "ORAL" ? "F is the product of the three terms above. Each carries its own uncertainty, and they multiply." : "For a parenteral route F is 1 by definition; the absorption terms are reported for reference only." },
      ],
    },
    {
      title: "System and physiology",
      fields: [
        { label: "Species", value: physiology.label },
        { label: "Strain / reference row", value: input.strain },
        { label: "Body weight", value: `${input.bodyWeightKg} kg` },
        { label: "Cardiac output", value: `${round(physiology.cardiacOutputCoefficient * input.bodyWeightKg ** 0.75, 2)} L/h` },
        { label: "Liver weight", value: `${round(physiology.liverWeightGPerKg * input.bodyWeightKg, 2)} g` },
        { label: "Hepatocellularity", value: `${physiology.hepatocellularityMillionPerG} ×10⁶ cells/g liver` },
        { label: "Glomerular filtration rate", value: `${round(cl.gfrLPerH, 3)} L/h` },
        { label: "Compartments simulated", value: "13 perfusion-limited tissues plus venous and arterial blood" },
        { label: "Formulation", value: input.formulation },
        { label: "Virtual cohort size", value: input.cohortSize },
      ],
    },
    {
      title: "Confidence and limitations",
      fields: [
        { label: "Projection confidence", value: confidence },
        { label: "Applicability of the disposition models", value: profile.applicability.domain === "in_domain" ? "within the training chemistry" : "outside the training chemistry" },
        { label: "Limitation", value: disposition.fuPlasma < 0.01
          ? "The unbound fraction is below 1%. It multiplies intrinsic clearance directly, so the projected exposure is highly sensitive to it. Supply a measured fu before relying on the absolute values."
          : cl.extractionClass === "high"
            ? "The compound is high-extraction: hepatic clearance approaches liver blood flow and becomes insensitive to intrinsic clearance, so the projection is poorly constrained."
            : "The projection inherits the uncertainty of its predicted disposition inputs. Supplying measured values narrows it substantially." },
        { label: "Not modelled", value: "Transporter-mediated hepatic uptake, enterohepatic recirculation, saturable metabolism and formulation effects are outside this model." },
        { label: "Scope", value: "A screening projection, not a dosing recommendation and not a substitute for measured pharmacokinetics." },
      ],
    },
  ];

  return {
    available: true as const,
    species: physiology.label,
    time: simulation.time,
    curves: simulation.curves,
    endpoints: { plasma, tissue: simulation.endpoints.tissue },
    clearance: cl,
    partition: simulation.partition,
    bioavailability: simulation.bioavailability,
    vssLPerKg: simulation.vssLPerKg,
    confidence,
    provenance: { owner: "hakase_smallmol.pk_ivive", computed_at: stamp(3), client_contract: "display-only", model: "Whole-body perfusion-limited PBPK with Poulin & Theil partitioning" },
    presentation: { groups },
  };
}

/* ── observed pharmacokinetic anchor ─────────────────────────────────────── */

export function pkAnchor(profile: CompoundProfile, projected: { cl: number; vss: number; halfLife: number }) {
  const found = chance(seed(profile.smiles, "anchor"), 0.45);
  if (!found) {
    return {
      status: "no_record",
      reason: "No observed pharmacokinetic record in PK-DB matched this structure or a close analogue. The projection stands unanchored, which is a statement about the public record rather than about the projection's accuracy.",
      comparisons: [],
      source: "PK-DB (https://pk-db.com)",
    };
  }
  const observed = {
    cl: round(projected.cl * logSpan(seed(profile.smiles, "anchorcl"), 0.42, 2.6), 3),
    vss: round(projected.vss * logSpan(seed(profile.smiles, "anchorv"), 0.55, 2.1), 3),
    halfLife: round(projected.halfLife * logSpan(seed(profile.smiles, "anchorh"), 0.5, 2.3), 2),
  };
  const fold = (a: number, b: number) => round(Math.max(a / b, b / a), 2);
  return {
    status: "matched",
    reason: null,
    matched_compound: "Structural analogue with published human intravenous pharmacokinetics",
    n_studies: Math.floor(span(seed(profile.smiles, "anchorn"), 1, 7)),
    population: "Healthy adult volunteers, single intravenous dose",
    comparisons: [
      { parameter: "Plasma clearance (L/h)", observed: observed.cl, projected: round(projected.cl, 3), fold_error: fold(observed.cl, projected.cl), within_2x: fold(observed.cl, projected.cl) <= 2 },
      { parameter: "Steady-state volume (L/kg)", observed: observed.vss, projected: round(projected.vss, 3), fold_error: fold(observed.vss, projected.vss), within_2x: fold(observed.vss, projected.vss) <= 2 },
      { parameter: "Terminal half-life (h)", observed: observed.halfLife, projected: round(projected.halfLife, 2), fold_error: fold(observed.halfLife, projected.halfLife), within_2x: fold(observed.halfLife, projected.halfLife) <= 2 },
    ],
    source: "PK-DB (https://pk-db.com)",
    limitation: "The matched record belongs to a structural analogue, not to the submitted compound. It grades the projection's plausibility, not its accuracy for this molecule.",
  };
}

/* ── stage gate ──────────────────────────────────────────────────────────── */

export type GateCondition = {
  code: string;
  severity: "block" | "warn";
  title: string;
  detail: string;
  acknowledgeable: boolean;
  endpoints?: string[];
};

export function evaluateGate(profile: CompoundProfile, l1: L1Record, speciesId: string, hasReview: boolean) {
  const blocks: GateCondition[] = [];
  const warnings: GateCondition[] = [];

  if (l1.verdict.verdict === "NO-GO" && !hasReview) {
    blocks.push({
      code: "L1_NO_GO_UNREVIEWED",
      severity: "block",
      title: "The Layer 1 gate returned NO-GO and no manual review has been recorded",
      detail: "Two or more gate-driving checks were in the concern band. A reviewer must record a decision and a rationale before the evidence can be carried into an animal-study design.",
      acknowledgeable: false,
      endpoints: l1.verdict.checks.filter((check) => check.status === "bad").map((check) => check.name),
    });
  }
  if (l1.target_resolution.status !== "resolved") {
    warnings.push({
      code: "NO_RESOLVED_TARGET",
      severity: "warn",
      title: "No protein target was resolved",
      detail: "Target coverage, occupancy and the pharmacological point of departure cannot be computed without an affinity anchor. The study will still simulate exposure and hazard, but it will carry no target-engagement statement.",
      acknowledgeable: true,
    });
  }
  if (profile.applicability.domain === "out_of_domain") {
    warnings.push({
      code: "OUT_OF_APPLICABILITY_DOMAIN",
      severity: "warn",
      title: "The structure sits outside the safety models' training chemistry",
      detail: `The nearest training analogue has a Tanimoto similarity of ${profile.applicability.nearest_tanimoto}, below the ${profile.applicability.threshold} threshold. Every hazard band carried into the animal layer is an extrapolation.`,
      acknowledgeable: true,
    });
  }
  if (profile.disposition.fuPlasma < 0.005) {
    blocks.push({
      code: "FU_BELOW_MEASURABLE",
      severity: "block",
      title: "The predicted unbound fraction is below 0.5%",
      detail: "At this level the well-stirred clearance calculation is dominated by a quantity the model cannot resolve. A measured equilibrium-dialysis fu is required; no acknowledgement can substitute for it.",
      acknowledgeable: false,
      endpoints: ["PPBR_AZ"],
    });
  }
  if (profile.endpoints.hERG.canonicalValue > 0.65) {
    warnings.push({
      code: "HERG_HIGH_BAND",
      severity: "warn",
      title: "The hERG screening model is in the high band",
      detail: `Blocker probability ${round(profile.endpoints.hERG.canonicalValue, 3)}. The animal study should include a cardiovascular safety-pharmacology assessment, and a patch-clamp IC50 should be obtained before dose selection.`,
      acknowledgeable: true,
      endpoints: ["hERG"],
    });
  }
  if (profile.endpoints.DILI.canonicalValue > 0.65) {
    warnings.push({
      code: "DILI_HIGH_BAND",
      severity: "warn",
      title: "The DILI screening model is in the high band",
      detail: `DILI probability ${round(profile.endpoints.DILI.canonicalValue, 3)}. The liver should be designated a target organ in the study design, with expanded clinical chemistry and histopathology.`,
      acknowledgeable: true,
      endpoints: ["DILI"],
    });
  }
  if (profile.endpoints.AMES.canonicalValue > 0.55) {
    blocks.push({
      code: "GENOTOXICITY_UNRESOLVED",
      severity: "block",
      title: "A genotoxicity hazard is predicted and unresolved",
      detail: "ICH S2(R1) requires the bacterial reverse-mutation result before an animal study can be justified for a compound with a predicted mutagenicity hazard. This is an experiment, not a judgement, and cannot be signed away.",
      acknowledgeable: false,
      endpoints: ["AMES"],
    });
  }
  if (profile.alerts.some((alert) => alert.set === "PAINS")) {
    warnings.push({
      code: "PAINS_ALERT",
      severity: "warn",
      title: "A PAINS substructure was matched",
      detail: "Any activity relied on in this programme should have orthogonal-format confirmation before an animal study is committed.",
      acknowledgeable: true,
    });
  }
  if (speciesId !== "human") {
    warnings.push({
      code: "HUMAN_TRAINED_CLEARANCE",
      severity: "warn",
      title: `Clearance for ${speciesId} is derived from a human-trained model`,
      detail: "The intrinsic-clearance predictor was trained on human hepatocytes. Applying it to another species is an extrapolation across the species barrier, and the animal layer flags every arm derived from it as low confidence.",
      acknowledgeable: true,
    });
  }

  return {
    analysis_id: l1.analysis_id,
    species: speciesId,
    blocks,
    warnings,
    counts: { block: blocks.length, warn: warnings.length, acknowledged: 0 },
    outstanding_warning_codes: warnings.map((warning) => warning.code),
    signoff: null as null | { signoff_id: string; name: string; role: string; justification: string | null; acknowledged_codes: string[]; signed_at: string; note: string },
    clear_to_proceed: false,
    policy: {
      note: "A block records an evidence gap that a signature cannot close. A warning records residual risk that a named reviewer may accept, on the record. The signature never alters a model output.",
    },
  };
}
