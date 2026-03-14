import type { SimResults } from "./admet";

export interface PkTimePoint {
  time:   number;
  conc:   number;
  ci_lo:  number;
  ci_hi:  number;
}

export interface DoseGroup {
  dose:    number;
  unit:    string;
  respRate: number;
  dltRate:  number;
  pkAuc:    number;
}

export interface CohortResults {
  cohortSize:       number;
  responderRate:    number;
  nonResponderRate: number;
  partialRate:      number;
  dltRate:          number;
  sdRate:           number;
  grade3AERate:     number;
  pkCurve:          PkTimePoint[];
  halfLifeHr:       number;
  cmax:             number;
  cmaxSD:           number;
  tmax:             number;
  auc:              number;
  vdss:             number;
  clearance:        number;
  doseGroups:       DoseGroup[];
  subgroupBreakdown: Array<{ label: string; rate: number; n: number }>;
  adverseEvents: Array<{ name: string; anyGrade: number; grade3Plus: number; color: string }>;
  biomarkerPositive: number;
  biomarkerNegative: number;
}

function jitter(base: number, range: number, seed: number): number {
  const v = Math.sin(seed * 9301 + 49297) * 233280;
  const f = v - Math.floor(v);
  return Math.max(0, Math.min(1, base + (f - 0.5) * range * 2));
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function runCohortSimulation(
  simResults: SimResults,
  cohortSize: number,
  startingDose: number,
  routeOfAdmin: string,
  dosingFreq: string,
  ageRange: [number, number],
  severity: string,
): CohortResults {
  const seed = hashStr(simResults.smiles + String(cohortSize));
  const { absorption, distribution, metabolism, excretion } = simResults.admet;

  const bioavail = routeOfAdmin === "IV Bolus" || routeOfAdmin === "IV Infusion" ? 1.0 : absorption;

  const responderBase = jitter(
    bioavail * 0.55 + distribution * 0.20 + (simResults.goNogo === "GO" ? 0.10 : simResults.goNogo === "WATCH" ? 0.05 : 0),
    0.10,
    seed + 1,
  );

  const severityPenalty = severity === "Severe" ? 0.08 : severity === "Critical" ? 0.15 : 0;
  const responderRate = Math.min(0.92, Math.max(0.10, responderBase - severityPenalty));
  const partialRate   = jitter(0.18, 0.06, seed + 2);
  const nonResponderRate = Math.max(0.05, 1 - responderRate - partialRate);
  const dltRate       = jitter(
    simResults.admet.toxicity < 0.6 ? 0.25 : simResults.admet.toxicity < 0.75 ? 0.15 : 0.08,
    0.05, seed + 3,
  );
  const sdRate = jitter(0.12, 0.05, seed + 4);

  // PK parameters
  const halfLifeHr = Math.max(0.5, jitter(6 + simResults.lipinski.mw / 50, 4, seed + 5));
  const kelim      = Math.log(2) / halfLifeHr;
  const vdss       = Math.max(0.5, jitter(distribution * 8 + 1, 2, seed + 6));
  const clearance  = kelim * vdss;
  const tmax       = routeOfAdmin.includes("IV") ? 0.25 : jitter(1.5 + simResults.lipinski.mw / 300, 1.0, seed + 7);
  const doseInMg   = startingDose || 100;
  const cmax       = (bioavail * doseInMg) / (vdss * 70);
  const auc        = cmax / kelim;

  // PK curve
  const timePoints = [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 36, 48];
  const pkCurve: PkTimePoint[] = timePoints.map(t => {
    let base: number;
    if (t === 0) {
      base = 0;
    } else if (t <= tmax) {
      base = cmax * (t / tmax) * Math.exp(-kelim * (t - tmax) * 0.2);
    } else {
      base = cmax * Math.exp(-kelim * (t - tmax));
    }
    const noise = jitter(1, 0.10, seed + 50 + t);
    const conc = base * noise;
    const ci   = conc * 0.18;
    return { time: t, conc: parseFloat(conc.toFixed(3)), ci_lo: parseFloat((conc - ci).toFixed(3)), ci_hi: parseFloat((conc + ci).toFixed(3)) };
  });

  // Dose groups (escalation)
  const baseDose = doseInMg;
  const fibSteps = [1, 1.67, 2.5, 3.5];
  const doseGroups: DoseGroup[] = fibSteps.map((f, i) => {
    const dose = Math.round(baseDose * f);
    const efficacyFactor = Math.min(1, f * 0.6 * bioavail);
    const dlt = Math.min(0.50, dltRate * f * 0.8);
    return {
      dose,
      unit: "mg",
      respRate: parseFloat(jitter(efficacyFactor * responderRate * 1.2, 0.05, seed + 60 + i).toFixed(2)),
      dltRate:  parseFloat(dlt.toFixed(2)),
      pkAuc:    parseFloat((auc * f).toFixed(2)),
    };
  });

  // Subgroup breakdown
  const subgroupBreakdown = [
    { label: `Age ${ageRange[0]}–${Math.floor((ageRange[0] + ageRange[1]) / 2)} yrs`, rate: parseFloat(jitter(responderRate + 0.05, 0.06, seed + 70).toFixed(2)), n: Math.round(cohortSize * 0.45) },
    { label: `Age ${Math.floor((ageRange[0] + ageRange[1]) / 2) + 1}–${ageRange[1]} yrs`, rate: parseFloat(jitter(responderRate - 0.04, 0.06, seed + 71).toFixed(2)), n: Math.round(cohortSize * 0.55) },
    { label: "Male",         rate: parseFloat(jitter(responderRate + 0.02, 0.05, seed + 72).toFixed(2)), n: Math.round(cohortSize * 0.52) },
    { label: "Female",       rate: parseFloat(jitter(responderRate - 0.02, 0.05, seed + 73).toFixed(2)), n: Math.round(cohortSize * 0.48) },
    { label: "eGFR ≥ 60",   rate: parseFloat(jitter(responderRate + 0.03, 0.04, seed + 74).toFixed(2)), n: Math.round(cohortSize * 0.70) },
    { label: "eGFR < 60",   rate: parseFloat(jitter(responderRate - 0.08, 0.06, seed + 75).toFixed(2)), n: Math.round(cohortSize * 0.30) },
  ];

  const adverseEvents = [
    { name: "Fatigue",          anyGrade: parseFloat(jitter(0.42, 0.10, seed + 80).toFixed(2)), grade3Plus: parseFloat(jitter(0.06, 0.03, seed + 81).toFixed(2)), color: "#8b5cf6" },
    { name: "Nausea",           anyGrade: parseFloat(jitter(0.35, 0.10, seed + 82).toFixed(2)), grade3Plus: parseFloat(jitter(0.04, 0.02, seed + 83).toFixed(2)), color: "#3b82f6" },
    { name: "Diarrhoea",        anyGrade: parseFloat(jitter(0.28, 0.08, seed + 84).toFixed(2)), grade3Plus: parseFloat(jitter(0.05, 0.02, seed + 85).toFixed(2)), color: "#06b6d4" },
    { name: "ALT Elevation",    anyGrade: parseFloat(jitter(simResults.organs.find(o => o.name === "Liver")?.risk ?? 0.08, 0.04, seed + 86).toFixed(2)), grade3Plus: parseFloat(jitter(0.03, 0.02, seed + 87).toFixed(2)), color: "#eab308" },
    { name: "Rash",             anyGrade: parseFloat(jitter(0.22, 0.08, seed + 88).toFixed(2)), grade3Plus: parseFloat(jitter(0.02, 0.01, seed + 89).toFixed(2)), color: "#f97316" },
    { name: "QTc Prolongation", anyGrade: parseFloat(jitter(simResults.organs.find(o => o.name === "Heart (hERG)")?.risk ?? 0.10, 0.04, seed + 90).toFixed(2)), grade3Plus: parseFloat(jitter(0.01, 0.01, seed + 91).toFixed(2)), color: "#ef4444" },
  ];

  const biomarkerPositive = parseFloat(jitter(responderRate + 0.15, 0.08, seed + 100).toFixed(2));
  const biomarkerNegative = parseFloat(jitter(responderRate - 0.15, 0.08, seed + 101).toFixed(2));

  const grade3AERate = adverseEvents.reduce((sum, ae) => sum + ae.grade3Plus, 0) / adverseEvents.length;

  return {
    cohortSize,
    responderRate:    parseFloat(responderRate.toFixed(2)),
    nonResponderRate: parseFloat(nonResponderRate.toFixed(2)),
    partialRate:      parseFloat(partialRate.toFixed(2)),
    dltRate:          parseFloat(dltRate.toFixed(2)),
    sdRate:           parseFloat(sdRate.toFixed(2)),
    grade3AERate:     parseFloat(grade3AERate.toFixed(3)),
    pkCurve,
    halfLifeHr:       parseFloat(halfLifeHr.toFixed(1)),
    cmax:             parseFloat(cmax.toFixed(3)),
    cmaxSD:           parseFloat((cmax * 0.145).toFixed(3)),
    tmax:             parseFloat(tmax.toFixed(1)),
    auc:              parseFloat(auc.toFixed(2)),
    vdss:             parseFloat(vdss.toFixed(2)),
    clearance:        parseFloat(clearance.toFixed(3)),
    doseGroups,
    subgroupBreakdown,
    adverseEvents,
    biomarkerPositive: Math.min(0.95, biomarkerPositive),
    biomarkerNegative: Math.max(0.05, biomarkerNegative),
  };
}
