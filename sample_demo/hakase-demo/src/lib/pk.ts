/**
 * Pharmacokinetics — the computational core of the demonstration cascade.
 *
 * In the platform this work is done by the kernel PBPK engine. Here it is a
 * faithful, smaller reimplementation in TypeScript so the IVIVE, animal-cohort
 * and first-in-human layers are genuinely computed rather than replayed:
 *
 *   · species physiology tables (13 perfusion-limited compartments)
 *   · Poulin & Theil tissue:plasma partition coefficients from logP and fu
 *   · well-stirred hepatic clearance and glomerular-filtration renal clearance
 *   · an RK4-integrated whole-body PBPK with oral, IV bolus and infusion input
 *   · a log-normally sampled virtual cohort with population percentiles
 *   · FDA (2005) body-surface-area allometry, MABEL, and escalation schemes
 *   · a 3+3 dose-escalation Monte Carlo for operating characteristics
 *
 * Every function returns the quantities the workspace displays, in the units it
 * displays them in.
 */

import { logNormalSample, makeRng, quantile, summarise, type Rng } from "./rng";

/* ── physiology ──────────────────────────────────────────────────────────── */

export const TISSUE_KEYS = [
  "lung", "heart", "brain", "muscle", "adipose", "skin", "liver",
  "kidney", "gut", "spleen", "bone", "pancreas", "rest",
] as const;
export type TissueKey = (typeof TISSUE_KEYS)[number];

export const TISSUE_LABEL: Record<TissueKey, string> = {
  lung: "Lung", heart: "Heart", brain: "Brain", muscle: "Skeletal muscle",
  adipose: "Adipose", skin: "Skin", liver: "Liver", kidney: "Kidney",
  gut: "Gut wall", spleen: "Spleen", bone: "Bone", pancreas: "Pancreas", rest: "Remainder",
};

/** Poulin & Theil tissue composition — neutral lipid, phospholipid, water. */
const TISSUE_COMPOSITION: Record<TissueKey | "plasma", { nl: number; ph: number; w: number }> = {
  adipose: { nl: 0.7900, ph: 0.0020, w: 0.1800 },
  bone: { nl: 0.0174, ph: 0.0017, w: 0.4460 },
  brain: { nl: 0.0392, ph: 0.0015, w: 0.7700 },
  gut: { nl: 0.0487, ph: 0.0163, w: 0.7180 },
  heart: { nl: 0.0115, ph: 0.0166, w: 0.7580 },
  kidney: { nl: 0.0207, ph: 0.0162, w: 0.7830 },
  liver: { nl: 0.0348, ph: 0.0252, w: 0.7510 },
  lung: { nl: 0.0030, ph: 0.0090, w: 0.8110 },
  muscle: { nl: 0.0238, ph: 0.0072, w: 0.7600 },
  pancreas: { nl: 0.0403, ph: 0.0090, w: 0.6640 },
  skin: { nl: 0.0284, ph: 0.0111, w: 0.7180 },
  spleen: { nl: 0.0201, ph: 0.0198, w: 0.7710 },
  rest: { nl: 0.0300, ph: 0.0090, w: 0.7300 },
  plasma: { nl: 0.0035, ph: 0.00225, w: 0.9450 },
};

export type Physiology = {
  id: string;
  label: string;
  defaultStrain: string;
  strains: Array<{ id: string; label: string; bodyWeightKg: number }>;
  bodyWeightKg: number;
  /** Cardiac output, L/h/kg^0.75 coefficient applied as CO = k · BW^0.75. */
  cardiacOutputCoefficient: number;
  /** Tissue volume as a fraction of body weight (L/kg). */
  volumes: Record<TissueKey, number>;
  /** Tissue blood flow as a fraction of cardiac output. */
  flows: Record<TissueKey, number>;
  plasmaVolumeLPerKg: number;
  bloodVolumeLPerKg: number;
  liverWeightGPerKg: number;
  hepatocellularityMillionPerG: number;
  microsomalProteinMgPerG: number;
  gfrMlPerMinPerKg: number;
  /** FDA (2005) body-surface-area conversion factor. */
  km: number;
  lifespanYears: number;
  bloodPlasmaDefault: number;
};

function baseVolumes(overrides: Partial<Record<TissueKey, number>> = {}): Record<TissueKey, number> {
  const base: Record<TissueKey, number> = {
    lung: 0.0076, heart: 0.0047, brain: 0.0200, muscle: 0.4000, adipose: 0.2142,
    skin: 0.0371, liver: 0.0257, kidney: 0.0044, gut: 0.0171, spleen: 0.0026,
    bone: 0.0856, pancreas: 0.0014, rest: 0.0500,
  };
  return { ...base, ...overrides };
}

function baseFlows(overrides: Partial<Record<TissueKey, number>> = {}): Record<TissueKey, number> {
  const base: Record<TissueKey, number> = {
    lung: 1.0, heart: 0.040, brain: 0.120, muscle: 0.170, adipose: 0.050,
    skin: 0.050, liver: 0.065, kidney: 0.190, gut: 0.170, spleen: 0.030,
    bone: 0.050, pancreas: 0.010, rest: 0.055,
  };
  return { ...base, ...overrides };
}

export const SPECIES: Physiology[] = [
  {
    id: "rat", label: "Rat", defaultStrain: "sprague_dawley",
    strains: [
      { id: "sprague_dawley", label: "Sprague-Dawley", bodyWeightKg: 0.30 },
      { id: "wistar", label: "Wistar Han", bodyWeightKg: 0.28 },
      { id: "fischer_344", label: "Fischer 344", bodyWeightKg: 0.22 },
      { id: "long_evans", label: "Long-Evans", bodyWeightKg: 0.32 },
    ],
    bodyWeightKg: 0.30, cardiacOutputCoefficient: 15.0,
    volumes: baseVolumes({ adipose: 0.0700, muscle: 0.4040, liver: 0.0366, brain: 0.0057, kidney: 0.0073, gut: 0.0271, bone: 0.0600 }),
    flows: baseFlows({ adipose: 0.070, brain: 0.020, liver: 0.021, kidney: 0.141, gut: 0.151, muscle: 0.278, skin: 0.058 }),
    plasmaVolumeLPerKg: 0.0313, bloodVolumeLPerKg: 0.0640,
    liverWeightGPerKg: 36.6, hepatocellularityMillionPerG: 108, microsomalProteinMgPerG: 45,
    gfrMlPerMinPerKg: 5.2, km: 6, lifespanYears: 2.5, bloodPlasmaDefault: 1.0,
  },
  {
    id: "mouse", label: "Mouse", defaultStrain: "cd1",
    strains: [
      { id: "cd1", label: "CD-1 (ICR)", bodyWeightKg: 0.025 },
      { id: "c57bl6", label: "C57BL/6", bodyWeightKg: 0.022 },
      { id: "balbc", label: "BALB/c", bodyWeightKg: 0.020 },
      { id: "nsg", label: "NSG (immunodeficient)", bodyWeightKg: 0.024 },
    ],
    bodyWeightKg: 0.025, cardiacOutputCoefficient: 15.5,
    volumes: baseVolumes({ adipose: 0.0700, muscle: 0.3840, liver: 0.0550, brain: 0.0170, kidney: 0.0170, gut: 0.0422, bone: 0.0430 }),
    flows: baseFlows({ adipose: 0.070, brain: 0.033, liver: 0.020, kidney: 0.091, gut: 0.141, muscle: 0.159, skin: 0.058 }),
    plasmaVolumeLPerKg: 0.0500, bloodVolumeLPerKg: 0.0850,
    liverWeightGPerKg: 55.0, hepatocellularityMillionPerG: 135, microsomalProteinMgPerG: 45,
    gfrMlPerMinPerKg: 14.0, km: 3, lifespanYears: 2.0, bloodPlasmaDefault: 1.0,
  },
  {
    id: "dog", label: "Dog (beagle)", defaultStrain: "beagle",
    strains: [{ id: "beagle", label: "Beagle", bodyWeightKg: 10.0 }],
    bodyWeightKg: 10.0, cardiacOutputCoefficient: 13.5,
    volumes: baseVolumes({ adipose: 0.1400, muscle: 0.5400, liver: 0.0323, brain: 0.0080, kidney: 0.0050, gut: 0.0250, bone: 0.0750 }),
    flows: baseFlows({ adipose: 0.035, brain: 0.020, liver: 0.047, kidney: 0.173, gut: 0.180, muscle: 0.217, skin: 0.060 }),
    plasmaVolumeLPerKg: 0.0515, bloodVolumeLPerKg: 0.0850,
    liverWeightGPerKg: 32.3, hepatocellularityMillionPerG: 169, microsomalProteinMgPerG: 45,
    gfrMlPerMinPerKg: 4.0, km: 20, lifespanYears: 12, bloodPlasmaDefault: 1.0,
  },
  {
    id: "monkey", label: "Cynomolgus monkey", defaultStrain: "cynomolgus",
    strains: [
      { id: "cynomolgus", label: "Cynomolgus (M. fascicularis)", bodyWeightKg: 3.5 },
      { id: "rhesus", label: "Rhesus (M. mulatta)", bodyWeightKg: 6.0 },
    ],
    bodyWeightKg: 3.5, cardiacOutputCoefficient: 14.0,
    volumes: baseVolumes({ adipose: 0.1000, muscle: 0.4400, liver: 0.0300, brain: 0.0200, kidney: 0.0053, gut: 0.0270, bone: 0.0700 }),
    flows: baseFlows({ adipose: 0.050, brain: 0.100, liver: 0.055, kidney: 0.140, gut: 0.180, muscle: 0.170, skin: 0.060 }),
    plasmaVolumeLPerKg: 0.0448, bloodVolumeLPerKg: 0.0650,
    liverWeightGPerKg: 30.0, hepatocellularityMillionPerG: 120, microsomalProteinMgPerG: 45,
    gfrMlPerMinPerKg: 2.1, km: 12, lifespanYears: 25, bloodPlasmaDefault: 1.0,
  },
  {
    id: "rabbit", label: "Rabbit", defaultStrain: "nzw",
    strains: [{ id: "nzw", label: "New Zealand White", bodyWeightKg: 2.5 }],
    bodyWeightKg: 2.5, cardiacOutputCoefficient: 13.0,
    volumes: baseVolumes({ adipose: 0.0700, muscle: 0.5400, liver: 0.0300, brain: 0.0050, kidney: 0.0070, gut: 0.0300, bone: 0.0700 }),
    flows: baseFlows({ adipose: 0.070, brain: 0.020, liver: 0.040, kidney: 0.156, gut: 0.170, muscle: 0.240, skin: 0.060 }),
    plasmaVolumeLPerKg: 0.0440, bloodVolumeLPerKg: 0.0700,
    liverWeightGPerKg: 30.0, hepatocellularityMillionPerG: 100, microsomalProteinMgPerG: 45,
    gfrMlPerMinPerKg: 3.1, km: 12, lifespanYears: 8, bloodPlasmaDefault: 1.0,
  },
  {
    id: "minipig", label: "Göttingen minipig", defaultStrain: "gottingen",
    strains: [{ id: "gottingen", label: "Göttingen", bodyWeightKg: 20.0 }],
    bodyWeightKg: 20.0, cardiacOutputCoefficient: 12.5,
    volumes: baseVolumes({ adipose: 0.2300, muscle: 0.3600, liver: 0.0230, brain: 0.0030, kidney: 0.0035, gut: 0.0280, bone: 0.0700 }),
    flows: baseFlows({ adipose: 0.080, brain: 0.020, liver: 0.060, kidney: 0.110, gut: 0.170, muscle: 0.200, skin: 0.060 }),
    plasmaVolumeLPerKg: 0.0430, bloodVolumeLPerKg: 0.0650,
    liverWeightGPerKg: 23.0, hepatocellularityMillionPerG: 100, microsomalProteinMgPerG: 45,
    gfrMlPerMinPerKg: 2.5, km: 27, lifespanYears: 15, bloodPlasmaDefault: 1.0,
  },
  {
    id: "human", label: "Human", defaultStrain: "adult_reference",
    strains: [
      { id: "adult_reference", label: "Adult reference (60 kg)", bodyWeightKg: 60 },
      { id: "adult_male", label: "Adult male (73 kg)", bodyWeightKg: 73 },
      { id: "adult_female", label: "Adult female (60 kg)", bodyWeightKg: 60 },
    ],
    bodyWeightKg: 60, cardiacOutputCoefficient: 15.0,
    volumes: baseVolumes(),
    flows: baseFlows(),
    plasmaVolumeLPerKg: 0.0424, bloodVolumeLPerKg: 0.0771,
    liverWeightGPerKg: 25.7, hepatocellularityMillionPerG: 99, microsomalProteinMgPerG: 40,
    gfrMlPerMinPerKg: 1.8, km: 37, lifespanYears: 80, bloodPlasmaDefault: 1.0,
  },
];

export function species(id: string): Physiology {
  return SPECIES.find((row) => row.id === id) ?? SPECIES[0];
}

/* ── disposition ─────────────────────────────────────────────────────────── */

export type Disposition = {
  /** Unbound fraction in plasma (0–1). */
  fuPlasma: number;
  /** Hepatocyte intrinsic clearance, µL/min per 10⁶ cells. */
  clintHepUlMin1e6: number;
  /** Blood:plasma concentration ratio. */
  bloodPlasmaRatio: number;
  /** logP used for the partition coefficients. */
  logP: number;
  /** Molecular weight, g/mol. */
  mw: number;
  /** Fraction absorbed from the gut lumen (0–1). */
  fractionAbsorbed: number;
  /** Gut-wall availability (0–1). */
  fractionEscapingGut: number;
  /** First-order absorption rate constant, 1/h. */
  kaPerHour: number;
  /** Fraction of the unbound drug filtered that is reabsorbed (0–1). */
  renalReabsorption: number;
  /** Brain unbound partition coefficient — the BBB term. */
  kpuuBrain: number;
};

export type DispositionProvenance = Record<keyof Disposition | string, string>;

/** Poulin & Theil tissue:plasma partition coefficient. */
export function partitionCoefficient(tissue: TissueKey, logP: number, fuPlasma: number): number {
  const t = TISSUE_COMPOSITION[tissue];
  const p = TISSUE_COMPOSITION.plasma;
  const P = 10 ** logP;
  const fuTissue = 1 / (1 + ((1 - fuPlasma) / fuPlasma) * 0.5);
  const numerator = (t.nl + 0.3 * t.ph) * P + (t.w + 0.7 * t.ph);
  const denominator = (p.nl + 0.3 * p.ph) * P + (p.w + 0.7 * p.ph);
  const kpu = numerator / denominator;
  const kp = (kpu * fuPlasma) / fuTissue;
  return Math.max(0.03, Math.min(400, kp));
}

export function partitionSet(logP: number, fuPlasma: number, kpuuBrain: number): Record<TissueKey, number> {
  const out = {} as Record<TissueKey, number>;
  for (const key of TISSUE_KEYS) out[key] = partitionCoefficient(key, logP, fuPlasma);
  // The brain compartment is efflux-limited: the passive partition is scaled by
  // the unbound brain:plasma ratio rather than being trusted on its own.
  out.brain = Math.max(0.02, out.brain * kpuuBrain);
  return out;
}

export type ClearanceReadout = {
  qhLPerH: number;
  clintTotalLPerH: number;
  clHepaticBloodLPerH: number;
  clHepaticPlasmaLPerH: number;
  clRenalPlasmaLPerH: number;
  clTotalPlasmaLPerH: number;
  extractionRatio: number;
  extractionClass: "low" | "intermediate" | "high";
  hepaticFirstPassAvailabilityFh: number;
  gfrLPerH: number;
  fractionHepatic: number;
  fractionRenal: number;
};

export function clearance(physiology: Physiology, disposition: Disposition, bodyWeightKg: number): ClearanceReadout {
  const cardiacOutput = physiology.cardiacOutputCoefficient * bodyWeightKg ** 0.75;
  // Total hepatic blood flow = arterial + portal (gut + spleen), against the same
  // normalised flow fractions the simulation uses. If the two disagreed, the
  // analytic clearance and the simulated exposure would describe different livers.
  const flowFractionSum = TISSUE_KEYS
    .filter((key) => key !== "lung")
    .reduce((total, key) => total + physiology.flows[key], 0);
  const qh = (cardiacOutput * (physiology.flows.liver + physiology.flows.gut + physiology.flows.spleen)) / flowFractionSum;
  const liverGrams = physiology.liverWeightGPerKg * bodyWeightKg;
  const clintTotal =
    (disposition.clintHepUlMin1e6 * physiology.hepatocellularityMillionPerG * liverGrams * 60) / 1e6;
  const fuBlood = disposition.fuPlasma / Math.max(disposition.bloodPlasmaRatio, 1e-6);
  const clHepaticBlood = (qh * fuBlood * clintTotal) / (qh + fuBlood * clintTotal);
  const clHepaticPlasma = clHepaticBlood * disposition.bloodPlasmaRatio;
  const gfr = (physiology.gfrMlPerMinPerKg * bodyWeightKg * 60) / 1000;
  const clRenal = disposition.fuPlasma * gfr * (1 - disposition.renalReabsorption);
  const clTotal = clHepaticPlasma + clRenal;
  const extractionRatio = clHepaticBlood / qh;
  return {
    qhLPerH: qh,
    clintTotalLPerH: clintTotal,
    clHepaticBloodLPerH: clHepaticBlood,
    clHepaticPlasmaLPerH: clHepaticPlasma,
    clRenalPlasmaLPerH: clRenal,
    clTotalPlasmaLPerH: clTotal,
    extractionRatio,
    extractionClass: extractionRatio < 0.3 ? "low" : extractionRatio < 0.7 ? "intermediate" : "high",
    hepaticFirstPassAvailabilityFh: 1 - extractionRatio,
    gfrLPerH: gfr,
    fractionHepatic: clTotal ? clHepaticPlasma / clTotal : 0,
    fractionRenal: clTotal ? clRenal / clTotal : 0,
  };
}

/* ── PBPK simulation ─────────────────────────────────────────────────────── */

export type StudyContext = {
  route: "IV" | "ORAL" | "SC" | "IM";
  doseMgPerKg: number;
  durationH: number;
  /** Zero for an IV bolus. */
  infusionDurationH: number;
  /** Null for a single dose. */
  dosingIntervalH: number | null;
  bodyWeightKg: number;
};

export type Curve = { mean: number[]; p05: number[]; p95: number[] };

export type SimulationResult = {
  time: number[];
  curves: Record<string, Curve>;
  endpoints: {
    plasma: Record<string, { median: number; p05: number; p95: number; cv: number }>;
    tissue: Record<TissueKey, { cMaxMedian: number; tMaxMedianH: number; aucMedian: number; kp: number; tissuePlasmaAucRatio: number }>;
  };
  clearance: ClearanceReadout;
  partition: Record<TissueKey, number>;
  bioavailability: { F: number; Fa: number; Fg: number; Fh: number };
  vssLPerKg: number;
};

/**
 * Whole-body perfusion-limited PBPK for one individual.
 *
 * Integrated with an exponential (semi-implicit) scheme rather than an explicit
 * Runge-Kutta one. Each compartment's own loss term is solved exactly over the
 * step — C(t+h) = C·e^(-bh) + (a/b)(1 - e^(-bh)) — while its inflow is held at
 * the start-of-step value. That matters here because the blood and lung
 * compartments have time constants of a second or two against a step measured
 * in minutes: an explicit integrator is unconditionally unstable on that ratio
 * and diverges, while this scheme is unconditionally stable and mass-consistent.
 */
function simulateIndividual(
  physiology: Physiology,
  disposition: Disposition,
  study: StudyContext,
  partition: Record<TissueKey, number>,
  clearanceReadout: ClearanceReadout,
  timeGrid: number[],
): { plasma: number[]; tissues: Record<TissueKey, number[]> } {
  const bw = study.bodyWeightKg;
  const cardiacOutput = physiology.cardiacOutputCoefficient * bw ** 0.75;
  const volume = {} as Record<TissueKey, number>;
  const flow = {} as Record<TissueKey, number>;
  // Every litre the heart pumps passes through some tissue and returns. The
  // tabulated fractions do not sum to exactly one, so they are normalised here:
  // without it a few percent of cardiac output — and the drug it carries —
  // vanishes on every pass, and the projected exposure is silently too low.
  const flowFractionSum = TISSUE_KEYS
    .filter((key) => key !== "lung")
    .reduce((total, key) => total + physiology.flows[key], 0);
  for (const key of TISSUE_KEYS) {
    volume[key] = Math.max(physiology.volumes[key] * bw, 1e-9);
    flow[key] = key === "lung"
      ? cardiacOutput
      : Math.max((cardiacOutput * physiology.flows[key]) / flowFractionSum, 1e-9);
  }
  const bp = disposition.bloodPlasmaRatio;
  const fuBlood = disposition.fuPlasma / bp;
  const venousVolume = Math.max(physiology.bloodVolumeLPerKg * bw * 0.6, 1e-9);

  // Blood-referenced partition: the tissue concentration divided by this gives
  // the concentration in the blood leaving that tissue.
  const kpBlood = {} as Record<TissueKey, number>;
  for (const key of TISSUE_KEYS) kpBlood[key] = Math.max(partition[key] / bp, 1e-6);

  const order: TissueKey[] = [...TISSUE_KEYS];
  const lungIndex = order.indexOf("lung");
  const gutIndex = order.indexOf("gut");
  const spleenIndex = order.indexOf("spleen");
  const liverIndex = order.indexOf("liver");
  const kidneyIndex = order.indexOf("kidney");

  const tissueConcentration = new Float64Array(order.length);
  let venous = 0;
  let gutDepot = 0;

  const doseMg = study.doseMgPerKg * bw;
  const ka = study.route === "ORAL" ? disposition.kaPerHour : study.route === "SC" ? disposition.kaPerHour * 0.45 : 0;
  const oralAvailability = disposition.fractionAbsorbed * disposition.fractionEscapingGut;
  const qLiverTotal = flow.liver + flow.gut + flow.spleen;
  const metabolicClearance = fuBlood * clearanceReadout.clintTotalLPerH;

  const doseTimes: number[] = [];
  if (study.dosingIntervalH && study.dosingIntervalH > 0) {
    for (let time = 0; time < study.durationH - 1e-9; time += study.dosingIntervalH) doseTimes.push(time);
  } else {
    doseTimes.push(0);
  }

  // A bench "IV bolus" is a rapid push, not an instantaneous one. Injecting the
  // whole dose into the venous pool in zero time produces a concentration spike
  // that is an artefact of the pool's size rather than a measurable peak, and it
  // dominates both Cmax and the early AUC. One minute is the physical answer.
  const infusionDuration = study.route === "IV"
    ? (study.infusionDurationH > 0 ? study.infusionDurationH : 1 / 60)
    : 0;

  const plasma: number[] = [];
  const tissues = {} as Record<TissueKey, number[]>;
  for (const key of TISSUE_KEYS) tissues[key] = [];

  // The step is chosen for accuracy, not stability — the scheme is stable at
  // any step. It is bounded so a 4-week study stays tractable in the browser.
  const dt = Math.min(0.05, Math.max(0.002, study.durationH / 4000));
  const nextConcentration = new Float64Array(order.length);

  let time = 0;
  let gridIndex = 0;
  let nextDose = 0;

  const record = () => {
    plasma.push(Math.max(0, venous / bp));
    for (let index = 0; index < order.length; index += 1) tissues[order[index]].push(Math.max(0, tissueConcentration[index]));
  };

  /** One exponential step: dC/dt = production/volume - rate·C. */
  const step = (current: number, production: number, lossRate: number, compartmentVolume: number, h: number) => {
    const b = lossRate / compartmentVolume;
    const a = production / compartmentVolume;
    if (b < 1e-12) return current + a * h;
    const decay = Math.exp(-b * h);
    return current * decay + (a / b) * (1 - decay);
  };

  while (gridIndex < timeGrid.length) {
    while (nextDose < doseTimes.length && doseTimes[nextDose] <= time + 1e-9) {
      if (study.route !== "IV") gutDepot += doseMg;
      nextDose += 1;
    }
    if (time >= timeGrid[gridIndex] - 1e-9) { record(); gridIndex += 1; continue; }

    const arterial = tissueConcentration[lungIndex] / kpBlood.lung;
    const gutOut = tissueConcentration[gutIndex] / kpBlood.gut;
    const spleenOut = tissueConcentration[spleenIndex] / kpBlood.spleen;
    const absorptionRate = ka > 0 ? ka * gutDepot * oralAvailability : 0;

    let infusionRate = 0;
    if (study.route === "IV") {
      for (const start of doseTimes) {
        if (time >= start && time < start + infusionDuration) infusionRate += doseMg / infusionDuration;
      }
    }

    // Tissues, each with its own exact self-decay over the step.
    let venousInflow = 0;
    for (let index = 0; index < order.length; index += 1) {
      const key = order[index];
      if (key === "lung") { nextConcentration[index] = tissueConcentration[index]; continue; }
      let production: number;
      let lossRate: number;
      if (key === "liver") {
        production = flow.liver * arterial + flow.gut * gutOut + flow.spleen * spleenOut + absorptionRate;
        lossRate = (qLiverTotal + metabolicClearance) / kpBlood.liver;
      } else if (key === "kidney") {
        production = flow.kidney * arterial;
        lossRate = (flow.kidney + clearanceReadout.clRenalPlasmaLPerH) / kpBlood.kidney;
      } else {
        production = flow[key] * arterial;
        lossRate = flow[key] / kpBlood[key];
      }
      nextConcentration[index] = step(tissueConcentration[index], production, lossRate, volume[key], dt);
      if (key !== "gut" && key !== "spleen") {
        const outflow = key === "liver" ? qLiverTotal : flow[key];
        venousInflow += outflow * (tissueConcentration[index] / kpBlood[key]);
      }
    }

    // Venous blood, then the lung that drains it into the arterial pool.
    const nextVenous = step(venous, venousInflow + infusionRate, cardiacOutput, venousVolume, dt);
    nextConcentration[lungIndex] = step(
      tissueConcentration[lungIndex], cardiacOutput * venous, cardiacOutput / kpBlood.lung, volume.lung, dt,
    );

    if (ka > 0) gutDepot *= Math.exp(-ka * dt);
    for (let index = 0; index < order.length; index += 1) {
      tissueConcentration[index] = Math.max(0, nextConcentration[index]);
    }
    venous = Math.max(0, nextVenous);
    time += dt;
  }
  return { plasma, tissues };
}

function trapezoid(time: number[], values: number[]): number {
  let total = 0;
  for (let index = 1; index < time.length; index += 1) {
    total += ((values[index] + values[index - 1]) / 2) * (time[index] - time[index - 1]);
  }
  return total;
}

function terminalHalfLife(time: number[], values: number[]): number {
  const tail = values.map((value, index) => ({ t: time[index], c: value })).filter((point) => point.c > 1e-9);
  if (tail.length < 6) return Number.NaN;
  const window = tail.slice(Math.floor(tail.length * 0.6));
  if (window.length < 3) return Number.NaN;
  const n = window.length;
  const sumX = window.reduce((total, point) => total + point.t, 0);
  const sumY = window.reduce((total, point) => total + Math.log(point.c), 0);
  const sumXY = window.reduce((total, point) => total + point.t * Math.log(point.c), 0);
  const sumXX = window.reduce((total, point) => total + point.t * point.t, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  if (!Number.isFinite(slope) || slope >= 0) return Number.NaN;
  return Math.log(2) / -slope;
}

/**
 * Run a virtual cohort. Population variability is applied to clearance,
 * unbound fraction, volume and absorption as independent log-normal draws — the
 * same structure the kernel engine uses, with the same 5th/95th percentile
 * reporting.
 */
export function simulateCohort(
  physiology: Physiology,
  disposition: Disposition,
  study: StudyContext,
  cohortSize: number,
  seed: string,
): SimulationResult {
  const points = 160;
  const timeGrid = Array.from({ length: points }, (_, index) => (study.durationH * index) / (points - 1));
  const rng: Rng = makeRng(seed);
  const individuals: Array<{ plasma: number[]; tissues: Record<TissueKey, number[]> }> = [];
  const size = Math.max(2, Math.min(cohortSize, 60));

  const referenceClearance = clearance(physiology, disposition, study.bodyWeightKg);
  const referencePartition = partitionSet(disposition.logP, disposition.fuPlasma, disposition.kpuuBrain);

  /** Steady-state distribution volume, summed over the model's own compartments. */
  const distributionVolume = (partition: Record<TissueKey, number>, weightKg: number) =>
    physiology.plasmaVolumeLPerKg * weightKg
    + TISSUE_KEYS.reduce((total, key) => total + physiology.volumes[key] * weightKg * partition[key], 0);

  const subjectParameters: Array<{ clLPerH: number; vssLPerKg: number; halfLifeH: number }> = [];

  for (let subject = 0; subject < size; subject += 1) {
    const individualDisposition: Disposition = {
      ...disposition,
      clintHepUlMin1e6: logNormalSample(rng, disposition.clintHepUlMin1e6, 0.32),
      fuPlasma: Math.min(0.999, logNormalSample(rng, disposition.fuPlasma, 0.22)),
      kaPerHour: logNormalSample(rng, disposition.kaPerHour, 0.30),
      fractionAbsorbed: Math.min(1, logNormalSample(rng, disposition.fractionAbsorbed, 0.15)),
    };
    const individualWeight = logNormalSample(rng, study.bodyWeightKg, 0.10);
    const individualStudy: StudyContext = { ...study, bodyWeightKg: individualWeight };
    const individualClearance = clearance(physiology, individualDisposition, individualWeight);
    const individualPartition = partitionSet(individualDisposition.logP, individualDisposition.fuPlasma, individualDisposition.kpuuBrain);
    individuals.push(simulateIndividual(physiology, individualDisposition, individualStudy, individualPartition, individualClearance, timeGrid));

    // Clearance and steady-state volume are properties of the model, so they are
    // taken from it directly rather than back-fitted from a truncated curve. The
    // effective half-life follows from the two of them.
    const vssTotal = distributionVolume(individualPartition, individualWeight);
    subjectParameters.push({
      clLPerH: individualClearance.clTotalPlasmaLPerH,
      vssLPerKg: vssTotal / individualWeight,
      halfLifeH: (Math.log(2) * vssTotal) / Math.max(individualClearance.clTotalPlasmaLPerH, 1e-9),
    });
  }

  function band(series: number[][]): Curve {
    const mean: number[] = []; const p05: number[] = []; const p95: number[] = [];
    for (let index = 0; index < timeGrid.length; index += 1) {
      const column = series.map((row) => row[index] ?? 0).sort((a, b) => a - b);
      mean.push(column.reduce((total, value) => total + value, 0) / column.length);
      p05.push(quantile(column, 0.05));
      p95.push(quantile(column, 0.95));
    }
    return { mean, p05, p95 };
  }

  const curves: Record<string, Curve> = { plasma: band(individuals.map((row) => row.plasma)) };
  for (const key of TISSUE_KEYS) curves[key] = band(individuals.map((row) => row.tissues[key]));

  const perSubject = individuals.map((row) => {
    const cMax = Math.max(...row.plasma);
    const tMax = timeGrid[row.plasma.indexOf(cMax)] ?? 0;
    const auc = trapezoid(timeGrid, row.plasma);
    return { cMax, tMax, auc };
  });

  const cMaxStats = summarise(perSubject.map((row) => row.cMax));
  const tMaxStats = summarise(perSubject.map((row) => row.tMax));
  const aucStats = summarise(perSubject.map((row) => row.auc));
  const tHalfStats = summarise(subjectParameters.map((row) => row.halfLifeH));
  const clStats = summarise(subjectParameters.map((row) => row.clLPerH));
  const vssStats = summarise(subjectParameters.map((row) => row.vssLPerKg));

  const F = study.route === "ORAL"
    ? disposition.fractionAbsorbed * disposition.fractionEscapingGut * referenceClearance.hepaticFirstPassAvailabilityFh
    : study.route === "SC" ? 0.92 : 1;
  const vss = vssStats.median;

  const plasmaAuc = trapezoid(timeGrid, curves.plasma.mean);
  const tissueEndpoints = {} as SimulationResult["endpoints"]["tissue"];
  for (const key of TISSUE_KEYS) {
    const curve = curves[key].mean;
    const cMax = Math.max(...curve);
    const tMax = timeGrid[curve.indexOf(cMax)] ?? 0;
    const auc = trapezoid(timeGrid, curve);
    tissueEndpoints[key] = {
      cMaxMedian: cMax,
      tMaxMedianH: tMax,
      aucMedian: auc,
      kp: referencePartition[key],
      tissuePlasmaAucRatio: plasmaAuc > 0 ? auc / plasmaAuc : Number.NaN,
    };
  }

  return {
    time: timeGrid,
    curves,
    endpoints: {
      plasma: {
        c_max: { median: cMaxStats.median, p05: cMaxStats.p05, p95: cMaxStats.p95, cv: cMaxStats.cv },
        t_max: { median: tMaxStats.median, p05: tMaxStats.p05, p95: tMaxStats.p95, cv: tMaxStats.cv },
        auc: { median: aucStats.median, p05: aucStats.p05, p95: aucStats.p95, cv: aucStats.cv },
        t_half: { median: tHalfStats.median, p05: tHalfStats.p05, p95: tHalfStats.p95, cv: tHalfStats.cv },
        cl: { median: clStats.median, p05: clStats.p05, p95: clStats.p95, cv: clStats.cv },
        vss: { median: vssStats.median, p05: vssStats.p05, p95: vssStats.p95, cv: vssStats.cv },
      },
      tissue: tissueEndpoints,
    },
    clearance: referenceClearance,
    partition: referencePartition,
    bioavailability: {
      F,
      Fa: disposition.fractionAbsorbed,
      Fg: disposition.fractionEscapingGut,
      Fh: referenceClearance.hepaticFirstPassAvailabilityFh,
    },
    vssLPerKg: vss,
  };
}

/* ── translation ─────────────────────────────────────────────────────────── */

/** FDA (2005) body-surface-area conversion: HED = animal dose × (Km,animal / Km,human). */
export function humanEquivalentDose(animalDoseMgPerKg: number, animalKm: number, humanKm = 37) {
  const hedMgPerKg = animalDoseMgPerKg * (animalKm / humanKm);
  return {
    hed_mg_per_kg: hedMgPerKg,
    hed_mg_per_m2: hedMgPerKg * humanKm,
    conversion_factor: animalKm / humanKm,
    animal_km: animalKm,
    human_km: humanKm,
  };
}

export function maximumRecommendedStartingDose(hedMgPerKg: number, safetyFactor: number, weightKg = 60) {
  const mrsdMgPerKg = hedMgPerKg / safetyFactor;
  return {
    mrsd_mg_per_kg: mrsdMgPerKg,
    mrsd_total_mg_60kg: mrsdMgPerKg * weightKg,
    safety_factor: safetyFactor,
  };
}

/** Simple allometry — CL_human = a · BW^b with the standard 0.75 exponent. */
export function allometricScale(animalClLPerH: number, animalWeightKg: number, humanWeightKg = 60, exponent = 0.75) {
  const coefficient = animalClLPerH / animalWeightKg ** exponent;
  const humanCl = coefficient * humanWeightKg ** exponent;
  return {
    coefficient,
    exponent,
    human_cl_l_per_h_60kg: humanCl,
    human_cl_l_per_h_per_kg: humanCl / humanWeightKg,
  };
}

/** Equilibrium receptor occupancy under the Hill/Clark model. */
export function occupancy(unboundConcentrationNm: number, kdNm: number, hill = 1): number {
  if (!Number.isFinite(unboundConcentrationNm) || !Number.isFinite(kdNm) || kdNm <= 0) return Number.NaN;
  const ratio = (unboundConcentrationNm / kdNm) ** hill;
  return ratio / (1 + ratio);
}

/** The unbound concentration required for a target occupancy. */
export function concentrationForOccupancy(target: number, kdNm: number, hill = 1): number {
  return kdNm * (target / (1 - target)) ** (1 / hill);
}

export const ESCALATION_SCHEMES = [
  { id: "modified_fibonacci", name: "Modified Fibonacci", reference: "Penel & Kramar (2012); classical oncology Phase 1 practice", multipliers: [2.0, 1.67, 1.5, 1.33, 1.33, 1.33, 1.33, 1.33, 1.33, 1.33] },
  { id: "fixed_fold", name: "Fixed-fold escalation", reference: "EMA/CHMP/SWP/28367/07 Rev.1 — pre-specified constant increments", multipliers: null },
  { id: "accelerated_titration", name: "Accelerated titration", reference: "Simon et al. (1997) — 100% steps until the first toxicity", multipliers: [2.0, 2.0, 2.0, 1.4, 1.4, 1.33, 1.33, 1.33, 1.33, 1.33] },
  { id: "pk_guided", name: "PK-guided escalation", reference: "Collins et al. (1990) — steps capped by the projected AUC margin", multipliers: [1.8, 1.6, 1.5, 1.4, 1.35, 1.3, 1.3, 1.25, 1.25, 1.2] },
] as const;

export function escalationLadder(startingDoseMg: number, schemeId: string, levels: number, fold: number, maxDoseMg: number | null) {
  const scheme = ESCALATION_SCHEMES.find((row) => row.id === schemeId) ?? ESCALATION_SCHEMES[0];
  const doses: number[] = [startingDoseMg];
  for (let index = 1; index < levels; index += 1) {
    const multiplier = scheme.multipliers ? scheme.multipliers[Math.min(index - 1, scheme.multipliers.length - 1)] : fold;
    doses.push(doses[doses.length - 1] * multiplier);
  }
  const capped = maxDoseMg !== null && doses.some((dose) => dose > maxDoseMg);
  const kept = maxDoseMg !== null ? doses.filter((dose) => dose <= maxDoseMg) : doses;
  return {
    scheme_id: scheme.id,
    scheme_name: scheme.name,
    reference: scheme.reference,
    capped_at_max_dose: capped,
    max_dose_mg: maxDoseMg,
    levels: (kept.length ? kept : [doses[0]]).map((dose, index, all) => ({
      level: index + 1,
      dose_total_mg: dose,
      step_from_previous: index === 0 ? null : dose / all[index - 1],
      fold_over_starting_dose: dose / startingDoseMg,
    })),
  };
}

/**
 * 3+3 dose-escalation operating characteristics.
 *
 * The platform does not predict human dose-limiting-toxicity rates. This
 * simulation is conditional on a DLT probability the sponsor supplies for each
 * level; without those probabilities the block reports itself as not simulable.
 */
export function threePlusThree(dltProbabilities: number[], trials = 2000, seed = "3+3") {
  if (!dltProbabilities.length) return null;
  const rng = makeRng(seed);
  const declared = new Map<string, number>();
  let totalPatients = 0;
  let totalDlts = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    let level = 0;
    let mtd = "No MTD declared";
    let patients = 0;
    let dlts = 0;
    while (level < dltProbabilities.length) {
      let cohortDlts = 0;
      for (let subject = 0; subject < 3; subject += 1) { patients += 1; if (rng() < dltProbabilities[level]) cohortDlts += 1; }
      dlts += cohortDlts;
      if (cohortDlts === 0) {
        if (level === dltProbabilities.length - 1) { mtd = `Level ${level + 1} (highest planned)`; break; }
        level += 1;
        continue;
      }
      if (cohortDlts === 1) {
        let extra = 0;
        for (let subject = 0; subject < 3; subject += 1) { patients += 1; if (rng() < dltProbabilities[level]) extra += 1; }
        dlts += extra;
        if (extra === 0) {
          if (level === dltProbabilities.length - 1) { mtd = `Level ${level + 1} (highest planned)`; break; }
          level += 1;
          continue;
        }
        mtd = level === 0 ? "Below the starting dose" : `Level ${level}`;
        break;
      }
      mtd = level === 0 ? "Below the starting dose" : `Level ${level}`;
      break;
    }
    declared.set(mtd, (declared.get(mtd) ?? 0) + 1);
    totalPatients += patients;
    totalDlts += dlts;
  }

  return {
    available: true,
    n_simulated_trials: trials,
    mean_patients_per_trial: totalPatients / trials,
    mean_dlts_per_trial: totalDlts / trials,
    mtd_distribution: [...declared.entries()]
      .map(([label, count]) => ({ label, probability: count / trials }))
      .sort((a, b) => b.probability - a.probability),
    limitations:
      "Conditional on the supplied per-level DLT probabilities. This platform predicts hazard mechanisms, not human DLT rates; the operating characteristics inherit whatever the sponsor assumed.",
  };
}

/** Accumulation ratio at steady state for a given half-life and interval. */
export function accumulationRatio(halfLifeH: number, intervalH: number): number {
  if (!Number.isFinite(halfLifeH) || !Number.isFinite(intervalH) || intervalH <= 0) return Number.NaN;
  const ke = Math.log(2) / halfLifeH;
  return 1 / (1 - Math.exp(-ke * intervalH));
}

/** Number of half-lives covered by a washout window. */
export function halfLivesCovered(days: number, halfLifeH: number): number {
  if (!Number.isFinite(halfLifeH) || halfLifeH <= 0) return Number.NaN;
  return (days * 24) / halfLifeH;
}
