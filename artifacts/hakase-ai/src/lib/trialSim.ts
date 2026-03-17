import type { SimResults } from "./admet";
import type { CohortResults } from "./cohortSim";

export interface SurvivalPoint {
  month:     number;
  treatment: number;
  control:   number;
  ci_lo:     number;
  ci_hi:     number;
  atRisk:    number;
}

export interface InterimAnalysis {
  planned:  number;
  alpha:    number;
  boundary: number;
  decision: "Continue" | "Stop for efficacy" | "Stop for futility";
}

export interface TrialResults {
  power:              number;
  pValue:             number;
  sampleSize:         number;
  eventsRequired:     number;
  eventsObserved:     number;
  medianPFS_treatment: number;
  medianPFS_control:   number;
  hazardRatio:        number;
  confidenceInterval: [number, number];
  survivalCurve:      SurvivalPoint[];
  powerCurve:         Array<{ n: number; power: number }>;
  interimAnalyses:    InterimAnalysis[];
  estimatedDuration:  number;
  estimatedCost:      number;
  numSites:           number;
  siteRecommendations: Array<{ site: string; region: string; enrollPerMonth: number; quality: number; composite: number }>;
  goNogo:             "GO" | "CONDITIONAL GO" | "NO-GO";
  successProbability: number;
  recommendation:     string;
}

function clamp(v: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, v)); }
function jitter(base: number, range: number, seed: number): number {
  const v = Math.sin(seed * 9301 + 49297) * 233280;
  return Math.max(0, base + (v - Math.floor(v) - 0.5) * range * 2);
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return z >= 0 ? 1 - p : p;
}

function computePower(n: number, hr: number, alpha: number, dropoutRate: number): number {
  const eventFraction = 0.75 * (1 - dropoutRate);
  const events = n * eventFraction;
  const logHR = Math.log(hr);
  const se = Math.sqrt(4 / events);
  const z_alpha = hr < 1 ? 1.96 : 1.645;
  const z_beta = (Math.abs(logHR) / se) - z_alpha;
  return clamp(normalCDF(z_beta));
}

function weibullSurvival(month: number, medianMonths: number): number {
  return Math.exp(-Math.log(2) * Math.pow(month / medianMonths, 1.2));
}

export function runTrialSimulation(
  simResults:   SimResults,
  cohortResults: CohortResults,
  trialPhase:   string,
  primaryEndpoint: string,
  clinicalDiff:    number,
  targetSampleSize: number,
  sigLevel:     number,
  powerTarget:  number,
  dropoutRate:  number,
  numArms:      number,
  adaptiveEnabled: boolean,
  numSites:     number,
  indication:   string,
): TrialResults {
  const seed = hashStr(simResults.smiles + trialPhase + primaryEndpoint);
  const { responderRate } = cohortResults;

  // Derive hazard ratio from responder rate
  const controlRate = Math.max(0.10, responderRate - clinicalDiff / 10 - 0.15);
  const hr = clamp(controlRate / responderRate, 0.30, 0.90);

  // Compute power at given sample size
  const n = targetSampleSize;
  const power = computePower(n, hr, sigLevel, dropoutRate);

  // Compute p-value from power
  const logHR = Math.log(hr);
  const eventFraction = 0.75 * (1 - dropoutRate);
  const events = Math.round(n * eventFraction);
  const se = Math.sqrt(4 / events);
  const zStat = Math.abs(logHR) / se;
  const pValue = clamp(2 * (1 - normalCDF(zStat)), 0.0001, 0.999);

  // Median PFS
  const medianPFS_treatment = Math.max(1, jitter(4 + responderRate * 12, 2, seed + 1));
  const medianPFS_control   = Math.max(1, medianPFS_treatment * hr * jitter(1, 0.1, seed + 2));
  const ci_lo = clamp(hr * 0.82, 0.20, 0.98);
  const ci_hi = clamp(hr * 1.18, 0.30, 0.99);

  // Survival curve (24 months)
  const months = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 21, 24];
  const survivalCurve: SurvivalPoint[] = months.map((m, i) => {
    const trt  = weibullSurvival(m, medianPFS_treatment);
    const ctrl = weibullSurvival(m, medianPFS_control);
    const ciW  = trt * 0.10;
    return {
      month: m,
      treatment: parseFloat(trt.toFixed(3)),
      control:   parseFloat(ctrl.toFixed(3)),
      ci_lo:     parseFloat(Math.max(0, trt - ciW).toFixed(3)),
      ci_hi:     parseFloat(Math.min(1, trt + ciW).toFixed(3)),
      atRisk:    Math.round(n / 2 * trt),
    };
  });

  // Power curve
  const nSamples = [50, 100, 150, 200, targetSampleSize, Math.round(targetSampleSize * 1.2), Math.round(targetSampleSize * 1.5), Math.round(targetSampleSize * 2)];
  const powerCurve = nSamples.map(ns => ({
    n: ns,
    power: parseFloat(computePower(ns, hr, sigLevel, dropoutRate).toFixed(3)),
  }));

  // Interim analyses
  const interimAnalyses: InterimAnalysis[] = [
    { planned: Math.round(n * 0.33), alpha: 0.005, boundary: 2.963, decision: power > 0.85 ? "Stop for efficacy" : "Continue" },
    { planned: Math.round(n * 0.66), alpha: 0.014, boundary: 2.197, decision: power > 0.70 ? "Continue" : "Stop for futility" },
    { planned: n,                    alpha: sigLevel, boundary: 1.960, decision: power > powerTarget ? "Stop for efficacy" : "Continue" },
  ];

  // Trial duration
  const enrollmentRate = 4.2;
  const estimatedDuration = Math.ceil(n / (enrollmentRate * numSites) + medianPFS_treatment * 1.5);

  // ── Realistic cost model (based on published industry benchmarks) ──────────
  // Phase-based per-patient direct costs (Tufts CSDD / IQVIA data)
  const phLower = trialPhase.toLowerCase();
  const isPhI   = phLower.includes("i")   && !phLower.includes("ii");
  const isPhII  = phLower.includes("ii")  && !phLower.includes("iii");
  const isPhIII = phLower.includes("iii");

  const perPatientBase =
    isPhI   ? 28_000 :   // Phase I: simple escalation, small n
    isPhII  ? 58_000 :   // Phase II: PK/PD, dose-expansion cohorts
    isPhIII ? 105_000 :  // Phase III: full pivotal, REMS, comparator
              42_000;    // Hybrid / adaptive

  // Indication-area multiplier (oncology & CNS are most expensive)
  const ind = indication.toLowerCase();
  const indicationMul =
    (ind.includes("nsclc") || ind.includes("lung") || ind.includes("breast") ||
     ind.includes("colorect") || ind.includes("cancer") || ind.includes("oncol") ||
     ind.includes("carcinoma") || ind.includes("leukemia") || ind.includes("lymphoma") ||
     ind.includes("myeloma") || ind.includes("glioma") || ind.includes("tumor"))  ? 1.45 :
    (ind.includes("alzheimer") || ind.includes("parkinson") || ind.includes("cns") ||
     ind.includes("neuro") || ind.includes("psychiatr") || ind.includes("schizo") ||
     ind.includes("ms") || ind.includes("multiple sclerosis"))                     ? 1.60 :
    (ind.includes("rare") || ind.includes("orphan") || ind.includes("aml") ||
     ind.includes("sickle") || ind.includes("huntington"))                          ? 1.55 :
    (ind.includes("cardio") || ind.includes("heart") || ind.includes("hf ") ||
     ind.includes("coronary") || ind.includes("stroke"))                            ? 1.30 :
    (ind.includes("infect") || ind.includes("hiv") || ind.includes("hepatit") ||
     ind.includes("covid") || ind.includes("antimicr"))                             ? 0.90 :
    1.00;

  // Site-level costs: startup + per-visit management
  const siteStartup     = numSites * 90_000;
  const siteManagement  = numSites * (
    isPhIII ? 1_800_000 : isPhII ? 900_000 : 320_000
  );

  // Fixed regulatory & programme costs
  const fixedRegulatory =
    isPhIII ? 5_500_000 : isPhII ? 2_200_000 : 1_100_000;

  // Drug manufacturing for trial supply (per arm)
  const manufacturing = numArms * (
    isPhIII ? 7_000_000 : isPhII ? 2_800_000 : 1_100_000
  );

  // Adaptive design premium (IA infrastructure, DMC, re-randomisation)
  const adaptivePremium = adaptiveEnabled ? 1_400_000 : 0;

  // Base cost
  const baseCost =
    n * perPatientBase * indicationMul
    + siteStartup + siteManagement
    + fixedRegulatory + manufacturing
    + adaptivePremium;

  // Overhead: CRO management (18%), safety/pharmacovigilance (7%),
  //           data management + biostatistics (8%) → ×1.33 total
  const estimatedCostRaw = baseCost * 1.33;

  // Site recommendations
  const siteRecommendations = [
    { site: "Johns Hopkins, Baltimore",    region: "North America", enrollPerMonth: parseFloat(jitter(4.2, 0.5, seed + 40).toFixed(1)), quality: parseFloat(jitter(9.2, 0.4, seed + 41).toFixed(1)), composite: Math.round(jitter(91, 5, seed + 42)) },
    { site: "Royal Marsden, London",       region: "Europe",        enrollPerMonth: parseFloat(jitter(3.8, 0.5, seed + 43).toFixed(1)), quality: parseFloat(jitter(9.4, 0.3, seed + 44).toFixed(1)), composite: Math.round(jitter(88, 4, seed + 45)) },
    { site: "MD Anderson, Houston",        region: "North America", enrollPerMonth: parseFloat(jitter(3.9, 0.5, seed + 46).toFixed(1)), quality: parseFloat(jitter(8.9, 0.4, seed + 47).toFixed(1)), composite: Math.round(jitter(86, 5, seed + 48)) },
    { site: "Memorial Sloan Kettering",   region: "North America", enrollPerMonth: parseFloat(jitter(3.5, 0.4, seed + 49).toFixed(1)), quality: parseFloat(jitter(9.1, 0.3, seed + 50).toFixed(1)), composite: Math.round(jitter(84, 4, seed + 51)) },
    { site: "Tokyo Medical Univ.",        region: "Asia-Pacific",  enrollPerMonth: parseFloat(jitter(3.3, 0.4, seed + 52).toFixed(1)), quality: parseFloat(jitter(8.7, 0.5, seed + 53).toFixed(1)), composite: Math.round(jitter(79, 5, seed + 54)) },
  ].sort((a, b) => b.composite - a.composite);

  // Trial Go/No-Go
  let trialGoNogo: "GO" | "CONDITIONAL GO" | "NO-GO";
  let recommendation: string;

  if (power >= powerTarget && pValue < sigLevel) {
    trialGoNogo = "GO";
    recommendation = `Simulated trial achieves ${(power * 100).toFixed(0)}% power (target ${(powerTarget * 100).toFixed(0)}%) at n=${n}. Proceed with trial initiation.`;
  } else if (power >= powerTarget * 0.85) {
    trialGoNogo = "CONDITIONAL GO";
    recommendation = `Trial is borderline powered (${(power * 100).toFixed(0)}%). Consider enrolling n=${Math.round(n * 1.15)} or adding an adaptive interim analysis.`;
  } else {
    trialGoNogo = "NO-GO";
    recommendation = `Insufficient power (${(power * 100).toFixed(0)}%) at current sample size and effect size. Revisit cohort design or molecular candidate.`;
  }

  return {
    power: parseFloat(power.toFixed(3)),
    pValue: parseFloat(pValue.toFixed(4)),
    sampleSize: n,
    eventsRequired: events,
    eventsObserved: Math.round(events * jitter(0.92, 0.05, seed + 60)),
    medianPFS_treatment: parseFloat(medianPFS_treatment.toFixed(1)),
    medianPFS_control:   parseFloat(medianPFS_control.toFixed(1)),
    hazardRatio: parseFloat(hr.toFixed(3)),
    confidenceInterval: [parseFloat(ci_lo.toFixed(3)), parseFloat(ci_hi.toFixed(3))],
    survivalCurve,
    powerCurve,
    interimAnalyses,
    estimatedDuration,
    estimatedCost: Math.round(estimatedCostRaw / 1e5) / 10,
    numSites,
    siteRecommendations,
    goNogo: trialGoNogo,
    successProbability: parseFloat(clamp(
      // Realistic compound/trial specific probability with meaningful variation
      // Historical base: ~58% Phase III, ~35% Phase II, ~65% Phase I
      (trialPhase.toLowerCase().includes("iii") ? 0.58 : trialPhase.toLowerCase().includes("ii") ? 0.35 : 0.65)
      // Effect-size quality: HR 0.30 = full bonus, HR 0.90 = no bonus
      * (0.55 + clamp(1 - (hr - 0.30) / 0.60, 0, 1) * 0.45)
      // Power adequacy: penalise if underpowered
      * (power >= powerTarget ? 1.0 : 0.60 + (power / powerTarget) * 0.40)
      // Molecule-specific noise (±10%)
      + jitter(0, 0.10, seed + 200),
      0.12, 0.92
    ).toFixed(3)),
    recommendation,
  };
}
