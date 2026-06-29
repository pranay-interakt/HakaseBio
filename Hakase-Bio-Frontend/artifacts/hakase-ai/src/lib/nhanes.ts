/**
 * NHANES Population Distributions
 * Derived from: NHANES 2017–2020 Pre-Pandemic Cycle
 * Source: CDC NHANES https://wwwn.cdc.gov/nchs/nhanes/
 * Used for: realistic virtual patient cohort parameter distributions
 */

export interface NHANESPatient {
  ageYr:       number;
  weightKg:    number;
  bmi:         number;
  egfr:        number;   // mL/min/1.73 m²
  altUL:       number;   // U/L (alanine aminotransferase)
  albuminGdL:  number;   // g/dL (serum albumin → protein binding)
  creatMgdL:   number;   // mg/dL
  sex:         "M" | "F";
}

// Published summary statistics (mean, SD) from NHANES 2017-2020
const STATS = {
  weight:     { male: { mean: 90.0, sd: 22.0 }, female: { mean: 76.8, sd: 20.5 } },
  bmi:        { mean: 29.6, sd: 7.0 },
  alt:        { mean: 22.0, sd: 18.0 },
  albumin:    { mean: 4.1,  sd: 0.35 },
  creatinine: { male: { mean: 1.05, sd: 0.22 }, female: { mean: 0.82, sd: 0.17 } },
  egfr: {
    "18-30": { mean: 102.0, sd: 13.0 },
    "31-40": { mean:  95.0, sd: 14.0 },
    "41-50": { mean:  87.0, sd: 15.0 },
    "51-60": { mean:  79.0, sd: 17.0 },
    "61-70": { mean:  70.0, sd: 19.0 },
    "71+":   { mean:  59.0, sd: 20.0 },
  },
};

function pseudoRand(seed: number): number {
  const v = Math.sin(seed * 9301 + 49297) * 233280;
  return v - Math.floor(v);
}

function normalSample(mean: number, sd: number, seed: number, lo?: number, hi?: number): number {
  const u1 = pseudoRand(seed);
  const u2 = pseudoRand(seed + 7);
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2);
  const v = mean + sd * z;
  if (lo !== undefined && hi !== undefined) return Math.max(lo, Math.min(hi, v));
  return v;
}

function eGFRForAge(ageYr: number, seed: number): number {
  const key = ageYr < 31 ? "18-30" : ageYr < 41 ? "31-40" : ageYr < 51 ? "41-50"
    : ageYr < 61 ? "51-60" : ageYr < 71 ? "61-70" : "71+";
  const { mean, sd } = STATS.egfr[key as keyof typeof STATS.egfr];
  return normalSample(mean, sd, seed, 15, 150);
}

/**
 * Sample a single virtual patient from NHANES distributions.
 * seed should be unique per patient index.
 */
export function samplePatient(seed: number, ageRange: [number, number]): NHANESPatient {
  const sex: "M" | "F" = pseudoRand(seed) > 0.48 ? "M" : "F";
  const ageYr  = Math.round(normalSample(
    (ageRange[0] + ageRange[1]) / 2,
    (ageRange[1] - ageRange[0]) / 4,
    seed + 1, ageRange[0], ageRange[1]
  ));
  const wStats  = sex === "M" ? STATS.weight.male : STATS.weight.female;
  const weightKg = normalSample(wStats.mean, wStats.sd, seed + 2, 40, 200);
  const bmi      = normalSample(STATS.bmi.mean, STATS.bmi.sd, seed + 3, 16, 60);
  const egfr     = eGFRForAge(ageYr, seed + 4);
  const altUL    = Math.max(5, normalSample(STATS.alt.mean, STATS.alt.sd, seed + 5, 5, 200));
  const albuminGdL = normalSample(STATS.albumin.mean, STATS.albumin.sd, seed + 6, 2.5, 5.5);
  const cStats   = sex === "M" ? STATS.creatinine.male : STATS.creatinine.female;
  const creatMgdL = normalSample(cStats.mean, cStats.sd, seed + 7, 0.4, 5.0);

  return { ageYr, weightKg, bmi, egfr, altUL, albuminGdL, creatMgdL, sex };
}

/**
 * Summarise a simulated cohort's NHANES-derived parameters.
 * Returns mean and SD for each key parameter across N patients.
 */
export function summariseCohort(
  n: number,
  ageRange: [number, number],
  baseSeed: number,
): {
  meanWeight: number; sdWeight: number;
  meanAge: number;    sdAge: number;
  meanEGFR: number;   sdEGFR: number;
  pctRenalImpaired: number;  // eGFR < 60
  pctHepaticRisk:   number;  // ALT > 3× ULN (>168 U/L) rare; here ALT > 56
  maleFraction:     number;
} {
  const patients = Array.from({ length: n }, (_, i) => samplePatient(baseSeed + i * 37, ageRange));
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const sdArr = (arr: number[], m: number) => Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);

  const weights = patients.map(p => p.weightKg);
  const ages    = patients.map(p => p.ageYr);
  const egfrs   = patients.map(p => p.egfr);
  const alts    = patients.map(p => p.altUL);
  const mw = avg(weights);
  const ma = avg(ages);
  const me = avg(egfrs);

  return {
    meanWeight:       parseFloat(mw.toFixed(1)),
    sdWeight:         parseFloat(sdArr(weights, mw).toFixed(1)),
    meanAge:          parseFloat(ma.toFixed(1)),
    sdAge:            parseFloat(sdArr(ages, ma).toFixed(1)),
    meanEGFR:         parseFloat(me.toFixed(1)),
    sdEGFR:           parseFloat(sdArr(egfrs, me).toFixed(1)),
    pctRenalImpaired: parseFloat((egfrs.filter(e => e < 60).length / n).toFixed(3)),
    pctHepaticRisk:   parseFloat((alts.filter(a => a > 56).length / n).toFixed(3)),
    maleFraction:     parseFloat((patients.filter(p => p.sex === "M").length / n).toFixed(3)),
  };
}
