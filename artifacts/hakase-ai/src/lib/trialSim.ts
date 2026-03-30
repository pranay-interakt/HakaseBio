import type { SimResults } from "./admet";
import type { CohortResults } from "./cohortSim";

export interface VarianceReductionEntry {
  area: string;
  endpointType: string;
  minR: number;
  maxR: number;
  defaultR: number;
  source: string;
}

export const VARIANCE_REDUCTION_TABLE: VarianceReductionEntry[] = [
  { area: "alzheimer",           endpointType: "Continuous",     minR: 0.15, maxR: 0.20, defaultR: 0.17, source: "EMA Qualification Opinion; Unlearn published studies" },
  { area: "multiple sclerosis",  endpointType: "Continuous",     minR: 0.12, maxR: 0.18, defaultR: 0.15, source: "Published PROCOVA validation studies" },
  { area: "als",                 endpointType: "Continuous",     minR: 0.14, maxR: 0.19, defaultR: 0.16, source: "VectorY PIONEER-ALS collaboration data" },
  { area: "parkinson",           endpointType: "Continuous",     minR: 0.10, maxR: 0.16, defaultR: 0.13, source: "Extrapolated from neurology data" },
  { area: "oncology",            endpointType: "Time-to-Event",  minR: 0.05, maxR: 0.10, defaultR: 0.07, source: "Estimated; PROCOVA-MMRM adaptation needed" },
  { area: "rare disease",        endpointType: "Continuous",     minR: 0.08, maxR: 0.15, defaultR: 0.11, source: "Extrapolated from neurology data" },
  { area: "general",             endpointType: "Binary",         minR: 0.05, maxR: 0.12, defaultR: 0.08, source: "Estimated; logistic PROCOVA extension" },
  { area: "general",             endpointType: "Continuous",     minR: 0.10, maxR: 0.18, defaultR: 0.14, source: "Meta-analysis of published PROCOVA results" },
  { area: "general",             endpointType: "Time-to-Event",  minR: 0.05, maxR: 0.10, defaultR: 0.07, source: "Estimated; requires PROCOVA-MMRM extension" },
];

export function lookupVarianceReduction(indication: string, endpointType: string): VarianceReductionEntry {
  const ind = indication.toLowerCase();
  const areaMatchers: Array<[string, string[]]> = [
    ["alzheimer",          ["alzheimer"]],
    ["multiple sclerosis", ["multiple sclerosis", "ms"]],
    ["als",                ["als", "amyotrophic"]],
    ["parkinson",          ["parkinson"]],
    ["oncology",           ["nsclc", "lung", "breast", "colorect", "cancer", "oncol", "carcinoma", "leukemia", "lymphoma", "myeloma", "glioma", "tumor", "melanoma", "sarcoma"]],
    ["rare disease",       ["rare", "orphan", "huntington", "sickle"]],
  ];

  let matchedArea = "general";
  for (const [area, keywords] of areaMatchers) {
    if (keywords.some(k => ind.includes(k))) { matchedArea = area; break; }
  }

  const endNorm = endpointType || "Continuous";
  const exact = VARIANCE_REDUCTION_TABLE.find(e => e.area === matchedArea && e.endpointType === endNorm);
  if (exact) return exact;
  const endpointFallback = VARIANCE_REDUCTION_TABLE.find(e => e.area === "general" && e.endpointType === endNorm);
  if (endpointFallback) return endpointFallback;
  const areaFallback = VARIANCE_REDUCTION_TABLE.find(e => e.area === matchedArea);
  if (areaFallback) return areaFallback;
  return VARIANCE_REDUCTION_TABLE[VARIANCE_REDUCTION_TABLE.length - 1];
}

export interface ProcovaConfig {
  enabled: boolean;
  varianceReduction: number;
  randomizationRatio: string;
  customRatioT?: number;
  customRatioC?: number;
}

export interface ProcovaResults {
  standardN: number;
  standardNt: number;
  standardNc: number;
  enhancedN: number;
  enhancedNt: number;
  enhancedNc: number;
  varianceReductionApplied: number;
  ratioLabel: string;

  standardPower: number;
  enhancedPower: number;
  standardCost: number;
  enhancedCost: number;
  costSavings: number;
  costSavingsPct: number;

  standardDuration: number;
  enhancedDuration: number;
  durationSavingsMonths: number;

  placeboReduction: number;

  dualPowerCurve: Array<{ n: number; standardPower: number; enhancedPower: number }>;
  dualEnrollment: Array<{ month: number; standardEnrolled: number; enhancedEnrolled: number }>;

  costBreakdown: {
    category: string;
    standard: number;
    enhanced: number;
    savings: number;
  }[];

  sensitivityGrid: Array<{
    varianceReduction: number;
    ratio: string;
    sampleSize: number;
    controlArm: number;
    power: number;
    viable: boolean;
  }>;

  lookupEntry: VarianceReductionEntry;
}

function parseRatio(ratio: string): [number, number] {
  const parts = ratio.split(":").map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return [parts[0], parts[1]];
  return [1, 1];
}

function inverseNormalCDF(p: number): number {
  const a1 = -3.969683028665376e+01, a2 =  2.209460984245205e+02;
  const a3 = -2.759285104469687e+02, a4 =  1.383577518672690e+02;
  const a5 = -3.066479806614716e+01, a6 =  2.506628277459239e+00;
  const b1 = -5.447609879822406e+01, b2 =  1.615858368580409e+02;
  const b3 = -1.556989798598866e+02, b4 =  6.680131188771972e+01;
  const b5 = -1.328068155288572e+01;
  const c1 = -7.784894002430293e-03, c2 = -3.223964580411365e-01;
  const c3 = -2.400758277161838e+00, c4 = -2.549732539343734e+00;
  const c5 =  4.374664141464968e+00, c6 =  2.938163982698783e+00;
  const d1 =  7.784695709041462e-03, d2 =  3.224671290700398e-01;
  const d3 =  2.445134137142996e+00, d4 =  3.754408661907416e+00;
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  }
}

function computePowerAsymmetric(
  nT: number, nC: number, hr: number, alpha: number, dropoutRate: number, varianceReduction: number
): number {
  const eventFraction = 0.75 * (1 - dropoutRate);
  const eventsT = nT * eventFraction;
  const eventsC = nC * eventFraction;
  const totalEvents = eventsT + eventsC;
  if (totalEvents <= 0) return 0;

  const R = clamp(varianceReduction, 0, 0.99);
  const pT = nT / (nT + nC);
  const pC = nC / (nT + nC);
  const effectiveEvents = totalEvents * 4 * pT * pC;
  const logHR = Math.log(hr);
  const se = Math.sqrt((1 - R) * (4 / effectiveEvents));
  const z_alpha = inverseNormalCDF(1 - alpha / 2);
  const z_beta = (Math.abs(logHR) / se) - z_alpha;
  return clamp(normalCDF(z_beta));
}

function solveNForPower(
  targetPower: number, hr: number, alpha: number, dropoutRate: number,
  varianceReduction: number, ratioT: number, ratioC: number
): number {
  let lo = 10, hi = 5000;
  for (let iter = 0; iter < 50; iter++) {
    const mid = Math.round((lo + hi) / 2);
    const nT = Math.round(mid * ratioT / (ratioT + ratioC));
    const nC = mid - nT;
    const p = computePowerAsymmetric(nT, nC, hr, alpha, dropoutRate, varianceReduction);
    if (p < targetPower) lo = mid; else hi = mid;
    if (hi - lo <= 1) break;
  }
  return hi;
}

export function runProcovaAnalysis(
  standardResults: TrialResults,
  config: ProcovaConfig,
  indication: string,
  endpointType: string,
  trialPhase: string,
  numSites: number,
  dropoutRate: number,
  powerTarget: number,
  sigLevel: number,
): ProcovaResults {
  const hr = standardResults.hazardRatio;
  const R = config.varianceReduction;
  const lookupEntry = lookupVarianceReduction(indication, endpointType);

  const [ratioT, ratioC] = parseRatio(config.randomizationRatio);
  const ratioLabel = `${ratioT}:${ratioC}`;

  const stdN = standardResults.sampleSize;
  const stdNt = Math.round(stdN / 2);
  const stdNc = stdN - stdNt;
  const stdPower = standardResults.power;

  const enhN = solveNForPower(powerTarget, hr, sigLevel, dropoutRate, R, ratioT, ratioC);
  const enhNt = Math.round(enhN * ratioT / (ratioT + ratioC));
  const enhNc = enhN - enhNt;
  const enhPower = computePowerAsymmetric(enhNt, enhNc, hr, sigLevel, dropoutRate, R);

  const nSamples = [50, 100, 150, 200, 250, 300, 350, 400, 500, 600, 800];
  if (!nSamples.includes(stdN)) nSamples.push(stdN);
  if (!nSamples.includes(enhN)) nSamples.push(enhN);
  nSamples.sort((a, b) => a - b);

  const dualPowerCurve = nSamples.map(n => {
    const sNt = Math.round(n / 2);
    const sNc = n - sNt;
    const eNt = Math.round(n * ratioT / (ratioT + ratioC));
    const eNc = n - eNt;
    return {
      n,
      standardPower: parseFloat(computePowerAsymmetric(sNt, sNc, hr, sigLevel, dropoutRate, 0).toFixed(3)),
      enhancedPower: parseFloat(computePowerAsymmetric(eNt, eNc, hr, sigLevel, dropoutRate, R).toFixed(3)),
    };
  });

  const enrollRate = 4.2;
  const totalRate = enrollRate * numSites;
  const months = Array.from({ length: 37 }, (_, i) => i);
  const dualEnrollment = months.map(m => ({
    month: m,
    standardEnrolled: Math.min(stdN, Math.round(stdN * (1 - Math.exp(-0.15 * m)))),
    enhancedEnrolled: Math.min(enhN, Math.round(enhN * (1 - Math.exp(-0.15 * m)))),
  }));

  const phLower = trialPhase.toLowerCase();
  const isPhI = phLower.includes("i") && !phLower.includes("ii");
  const isPhII = phLower.includes("ii") && !phLower.includes("iii");
  const isPhIII = phLower.includes("iii");
  const perPatientBase = isPhI ? 28_000 : isPhII ? 58_000 : isPhIII ? 105_000 : 42_000;

  const ind = indication.toLowerCase();
  const indicationMul =
    (ind.includes("nsclc") || ind.includes("lung") || ind.includes("breast") || ind.includes("colorect") || ind.includes("cancer") || ind.includes("oncol") || ind.includes("carcinoma") || ind.includes("leukemia") || ind.includes("lymphoma") || ind.includes("myeloma") || ind.includes("glioma") || ind.includes("tumor")) ? 1.45 :
    (ind.includes("alzheimer") || ind.includes("parkinson") || ind.includes("cns") || ind.includes("neuro") || ind.includes("psychiatr") || ind.includes("schizo") || ind.includes("ms") || ind.includes("multiple sclerosis")) ? 1.60 :
    (ind.includes("rare") || ind.includes("orphan") || ind.includes("aml") || ind.includes("sickle") || ind.includes("huntington")) ? 1.55 :
    (ind.includes("cardio") || ind.includes("heart") || ind.includes("hf ") || ind.includes("coronary") || ind.includes("stroke")) ? 1.30 :
    (ind.includes("infect") || ind.includes("hiv") || ind.includes("hepatit") || ind.includes("covid") || ind.includes("antimicr")) ? 0.90 :
    1.00;

  const computeCostForN = (n: number) => {
    const siteStartup = numSites * 90_000;
    const siteMgmt = numSites * (isPhIII ? 1_800_000 : isPhII ? 900_000 : 320_000);
    const fixedReg = isPhIII ? 5_500_000 : isPhII ? 2_200_000 : 1_100_000;
    const mfg = 2 * (isPhIII ? 7_000_000 : isPhII ? 2_800_000 : 1_100_000);
    return (n * perPatientBase * indicationMul + siteStartup + siteMgmt + fixedReg + mfg) * 1.33;
  };

  const stdCostRaw = computeCostForN(stdN);
  const enhCostRaw = computeCostForN(enhN);
  const stdCostM = Math.round(stdCostRaw / 1e5) / 10;
  const enhCostM = Math.round(enhCostRaw / 1e5) / 10;

  const patientSavings = stdN - enhN;
  const siteOpsPct = 0.42;
  const drugPct = 0.28;
  const monitorPct = 0.20;
  const labPct = 0.10;
  const totalSavingsM = stdCostM - enhCostM;

  const costBreakdown = [
    { category: "Site Operations",     standard: parseFloat((stdCostM * siteOpsPct).toFixed(1)),   enhanced: parseFloat((enhCostM * siteOpsPct).toFixed(1)),   savings: 0 },
    { category: "Drug Supply",         standard: parseFloat((stdCostM * drugPct).toFixed(1)),      enhanced: parseFloat((enhCostM * drugPct).toFixed(1)),      savings: 0 },
    { category: "Clinical Monitoring", standard: parseFloat((stdCostM * monitorPct).toFixed(1)),   enhanced: parseFloat((enhCostM * monitorPct).toFixed(1)),   savings: 0 },
    { category: "Lab & Biomarker",     standard: parseFloat((stdCostM * labPct).toFixed(1)),       enhanced: parseFloat((enhCostM * labPct).toFixed(1)),       savings: 0 },
  ].map(c => ({ ...c, savings: parseFloat((c.standard - c.enhanced).toFixed(1)) }));

  const enrollmentRate2 = totalRate > 0 ? totalRate : 20;
  const medianPFS = standardResults.medianPFS_treatment;
  const stdDur = Math.ceil(stdN / enrollmentRate2 + medianPFS * 1.5);
  const enhDur = Math.ceil(enhN / enrollmentRate2 + medianPFS * 1.5);

  const sensitivityGrid: ProcovaResults["sensitivityGrid"] = [];
  const rValues = [0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25];
  const ratios = ["1:1", "2:1", "3:1", "4:1"];
  for (const rv of rValues) {
    for (const rat of ratios) {
      const [rT, rC] = parseRatio(rat);
      const n = solveNForPower(powerTarget, hr, sigLevel, dropoutRate, rv, rT, rC);
      const nT = Math.round(n * rT / (rT + rC));
      const nC = n - nT;
      const p = computePowerAsymmetric(nT, nC, hr, sigLevel, dropoutRate, rv);
      sensitivityGrid.push({
        varianceReduction: rv,
        ratio: rat,
        sampleSize: n,
        controlArm: nC,
        power: parseFloat(p.toFixed(3)),
        viable: p >= powerTarget,
      });
    }
  }

  return {
    standardN: stdN, standardNt: stdNt, standardNc: stdNc,
    enhancedN: enhN, enhancedNt: enhNt, enhancedNc: enhNc,
    varianceReductionApplied: R,
    ratioLabel,
    standardPower: stdPower,
    enhancedPower: parseFloat(enhPower.toFixed(3)),
    standardCost: stdCostM,
    enhancedCost: enhCostM,
    costSavings: parseFloat(totalSavingsM.toFixed(1)),
    costSavingsPct: stdCostM > 0 ? parseFloat(((totalSavingsM / stdCostM) * 100).toFixed(1)) : 0,
    standardDuration: stdDur,
    enhancedDuration: enhDur,
    durationSavingsMonths: stdDur - enhDur,
    placeboReduction: stdNc - enhNc,
    dualPowerCurve,
    dualEnrollment,
    costBreakdown,
    sensitivityGrid,
    lookupEntry,
  };
}

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
