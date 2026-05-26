import type { SimResults } from "./admet";
import { runPBPK, type PBPKDrugParams, type PBPKPatientParams } from "./pbpk";
import { summariseCohort } from "./nhanes";
import { emaxEffect, type PDParameters } from "./pdModel";
import type { FAERSResult } from "./faersApi";

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

export interface CohortDataSources {
  pbpk:        "2-compartment" | "1-compartment";
  pd:          "chembl-live" | "estimated";
  ae:          "faers-live"  | "faers-fallback";
  population:  "nhanes"      | "seeded";
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
  nhanesStats?: {
    meanWeight: number; sdWeight: number;
    meanAge: number;    sdAge: number;
    meanEGFR: number;   sdEGFR: number;
    pctRenalImpaired: number;
    maleFraction: number;
  };
  dataSources: CohortDataSources;
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

// PK parameter overrides derived from Layer 2 animal study allometric scaling
export interface L2PkOverrides {
  bioavailF?:       number;   // formulation-adjusted F% (0–1) from formulationResult.formulatedF
  humanHalfLifeHr?: number;   // allometrically-projected human t½ (h) — used to blend PBPK output
  humanCmaxNgMl?:  number;   // projected Cmax at FIH dose for PD calibration
  humanAucNgHMl?:  number;   // projected AUC — used to derive CL for Vd calculation
}

export function runCohortSimulation(
  simResults:    SimResults,
  cohortSize:    number,
  startingDose:  number,
  routeOfAdmin:  string,
  dosingFreq:    string,
  ageRange:      [number, number],
  severity:      string,
  pdParams?:     PDParameters,
  faersResult?:  FAERSResult,
  l2pk?:         L2PkOverrides,
): CohortResults {
  const seed    = hashStr(simResults.smiles + String(cohortSize));
  const { absorption, distribution, metabolism, excretion } = simResults.admet;
  const { mw, logP, tpsa, hbd } = simResults.lipinski;
  const routeIV = routeOfAdmin === "IV Bolus" || routeOfAdmin === "IV Infusion";
  // L2 formulation-adjusted bioavailability overrides L1 ADMET score when available
  const bioavail = routeIV ? 1.0 : (l2pk?.bioavailF ?? absorption);
  const doseInMg = startingDose || 100;

  // ── NHANES population summary ─────────────────────────────────────────────
  const nhanes = summariseCohort(Math.min(cohortSize, 200), ageRange, seed);

  // ── Two-Compartment PBPK (representative patient at mean weight) ──────────
  const drugParams: PBPKDrugParams = {
    mw, logP, tpsa, hbd,
    bioavailF:       bioavail,
    absorptionScore: absorption,
    excretionScore:  excretion,
    metabolismScore: metabolism,
    dosingMg:        doseInMg,
    routeIV,
  };
  const patientParams: PBPKPatientParams = {
    weightKg:   nhanes.meanWeight,
    egfr:       nhanes.meanEGFR,
    albuminGdL: 4.1,
  };
  const pk = runPBPK(drugParams, patientParams);

  // When L2 animal data is available, blend the PBPK half-life with the
  // allometrically-scaled human projection (weighted 40/60 toward L2 — measured > modelled).
  const rawHalfLife = l2pk?.humanHalfLifeHr != null
    ? 0.4 * pk.halfLifeHr + 0.6 * l2pk.humanHalfLifeHr
    : pk.halfLifeHr;

  // If L2 gives a projected Cmax, blend it into the PBPK Cmax for PD calibration
  const blendedCmax = l2pk?.humanCmaxNgMl != null
    ? 0.4 * pk.cmax + 0.6 * l2pk.humanCmaxNgMl
    : pk.cmax;

  const { pkCurve, tmax, auc, vdss, clearance } = pk;
  const halfLifeHr = rawHalfLife;
  const cmax = blendedCmax;

  // ── PD Response: Emax model ───────────────────────────────────────────────
  let responderBase: number;
  if (pdParams) {
    const effect = emaxEffect(cmax, pdParams);
    responderBase = jitter(effect * 0.85, 0.08, seed + 1);
  } else {
    responderBase = jitter(
      bioavail * 0.55 + distribution * 0.20 + (simResults.goNogo === "GO" ? 0.10 : simResults.goNogo === "WATCH" ? 0.05 : 0),
      0.10, seed + 1,
    );
  }

  const severityPenalty = severity === "Severe" ? 0.08 : severity === "Critical" ? 0.15 : 0;
  const responderRate    = Math.min(0.92, Math.max(0.10, responderBase - severityPenalty));
  const partialRate      = jitter(0.18, 0.06, seed + 2);
  const nonResponderRate = Math.max(0.05, 1 - responderRate - partialRate);
  const dltRate          = jitter(
    simResults.admet.toxicity < 0.6 ? 0.25 : simResults.admet.toxicity < 0.75 ? 0.15 : 0.08,
    0.05, seed + 3,
  );
  const sdRate           = jitter(0.12, 0.05, seed + 4);

  // ── Cmax SD from NHANES population variability ────────────────────────────
  // PK variability is higher in an eGFR-impaired subpopulation
  const renalCVBoost = nhanes.pctRenalImpaired > 0.25 ? 1.3 : 1.0;
  const cmaxSD       = parseFloat((cmax * 0.30 * renalCVBoost).toFixed(4));

  // ── Dose escalation groups ────────────────────────────────────────────────
  const fibSteps = [1, 1.67, 2.5, 3.5];
  const doseGroups: DoseGroup[] = fibSteps.map((f, i) => {
    const dose = Math.round(doseInMg * f);
    const cAtDose = cmax * f * bioavail;
    const effAtDose = pdParams ? emaxEffect(cAtDose, pdParams) : Math.min(1, f * 0.6 * bioavail);
    const dlt = Math.min(0.50, dltRate * f * 0.8);
    return {
      dose,
      unit: "mg",
      respRate: parseFloat(jitter(effAtDose * responderRate * 1.15, 0.05, seed + 60 + i).toFixed(2)),
      dltRate:  parseFloat(dlt.toFixed(2)),
      pkAuc:    parseFloat((auc * f).toFixed(2)),
    };
  });

  // ── Subgroup breakdown using NHANES age/sex/eGFR distributions ───────────
  const midAge    = Math.floor((ageRange[0] + ageRange[1]) / 2);
  const eGFRPen   = nhanes.meanEGFR < 70 ? 0.05 : 0;
  const subgroupBreakdown = [
    { label: `Age ${ageRange[0]}–${midAge} yrs`,      rate: parseFloat(jitter(responderRate + 0.05, 0.06, seed + 70).toFixed(2)), n: Math.round(cohortSize * 0.45) },
    { label: `Age ${midAge + 1}–${ageRange[1]} yrs`,  rate: parseFloat(jitter(responderRate - 0.04 - eGFRPen, 0.06, seed + 71).toFixed(2)), n: Math.round(cohortSize * 0.55) },
    { label: "Male",                                    rate: parseFloat(jitter(responderRate + 0.02, 0.05, seed + 72).toFixed(2)), n: Math.round(cohortSize * nhanes.maleFraction) },
    { label: "Female",                                  rate: parseFloat(jitter(responderRate - 0.02, 0.05, seed + 73).toFixed(2)), n: Math.round(cohortSize * (1 - nhanes.maleFraction)) },
    { label: "eGFR ≥ 60",                              rate: parseFloat(jitter(responderRate + 0.03, 0.04, seed + 74).toFixed(2)), n: Math.round(cohortSize * (1 - nhanes.pctRenalImpaired)) },
    { label: "eGFR < 60",                              rate: parseFloat(jitter(responderRate - 0.08, 0.06, seed + 75).toFixed(2)), n: Math.round(cohortSize * nhanes.pctRenalImpaired) },
  ];

  // ── Adverse Events: FAERS if available, else structural estimates ─────────
  const liverRisk = simResults.organs.find(o => o.name === "Liver")?.risk ?? 0.08;
  const heartRisk = simResults.organs.find(o => o.name === "Heart (hERG)")?.risk ?? 0.10;

  let adverseEvents: Array<{ name: string; anyGrade: number; grade3Plus: number; color: string }>;

  if (faersResult && faersResult.source === "faers-live" && faersResult.signals.length >= 4) {
    adverseEvents = faersResult.signals.slice(0, 6).map(sig => ({
      name:       sig.term,
      anyGrade:   parseFloat(jitter(sig.frequency, 0.05, seed + 80 + faersResult.signals.indexOf(sig)).toFixed(2)),
      grade3Plus: parseFloat(Math.min(sig.grade3Est, sig.frequency * 0.4).toFixed(3)),
      color:      sig.color,
    }));
  } else {
    adverseEvents = [
      { name: "Fatigue",          anyGrade: parseFloat(jitter(0.42, 0.10, seed + 80).toFixed(2)), grade3Plus: parseFloat(jitter(0.06, 0.03, seed + 81).toFixed(2)), color: "#8b5cf6" },
      { name: "Nausea",           anyGrade: parseFloat(jitter(0.35, 0.10, seed + 82).toFixed(2)), grade3Plus: parseFloat(jitter(0.04, 0.02, seed + 83).toFixed(2)), color: "#3b82f6" },
      { name: "Diarrhoea",        anyGrade: parseFloat(jitter(0.28, 0.08, seed + 84).toFixed(2)), grade3Plus: parseFloat(jitter(0.05, 0.02, seed + 85).toFixed(2)), color: "#06b6d4" },
      { name: "ALT Elevation",    anyGrade: parseFloat(jitter(liverRisk, 0.04, seed + 86).toFixed(2)),  grade3Plus: parseFloat(jitter(0.03, 0.02, seed + 87).toFixed(2)), color: "#eab308" },
      { name: "Rash",             anyGrade: parseFloat(jitter(0.22, 0.08, seed + 88).toFixed(2)), grade3Plus: parseFloat(jitter(0.02, 0.01, seed + 89).toFixed(2)), color: "#f97316" },
      { name: "QTc Prolongation", anyGrade: parseFloat(jitter(heartRisk, 0.04, seed + 90).toFixed(2)), grade3Plus: parseFloat(jitter(0.01, 0.01, seed + 91).toFixed(2)), color: "#ef4444" },
    ];
  }

  const biomarkerPositive = parseFloat(jitter(responderRate + 0.15, 0.08, seed + 100).toFixed(2));
  const biomarkerNegative = parseFloat(jitter(responderRate - 0.15, 0.08, seed + 101).toFixed(2));
  const grade3AERate      = adverseEvents.reduce((s, ae) => s + ae.grade3Plus, 0) / adverseEvents.length;

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
    cmax:             parseFloat(cmax.toFixed(4)),
    cmaxSD,
    tmax:             parseFloat(tmax.toFixed(1)),
    auc:              parseFloat(auc.toFixed(2)),
    vdss:             parseFloat(vdss.toFixed(2)),
    clearance:        parseFloat(clearance.toFixed(4)),
    doseGroups,
    subgroupBreakdown,
    adverseEvents,
    biomarkerPositive: Math.min(0.95, biomarkerPositive),
    biomarkerNegative: Math.max(0.05, biomarkerNegative),
    nhanesStats: nhanes,
    dataSources: {
      pbpk:       "2-compartment",
      pd:         pdParams?.source ?? "estimated",
      ae:         faersResult?.source ?? "faers-fallback",
      population: "nhanes",
    },
  };
}
