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
  const estimatedDuration = Math.ceil(n / (enrollmentRate * 20) + medianPFS_treatment * 1.5);
  const estimatedCost     = n * 98500 + 20 * 1200000;

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
    estimatedCost: Math.round(estimatedCost / 1e5) / 10,
    siteRecommendations,
    goNogo: trialGoNogo,
    successProbability: parseFloat(clamp(power * 0.75 + (1 - pValue) * 0.25).toFixed(3)),
    recommendation,
  };
}
