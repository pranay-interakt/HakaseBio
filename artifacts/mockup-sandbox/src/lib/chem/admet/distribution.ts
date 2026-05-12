/**
 * Distribution endpoints.
 *
 *   logBB — Clark, D. E. "Rapid Calculation of Polar Molecular Surface
 *     Area and Its Application to the Prediction of Transport Phenomena.
 *     2. Prediction of Blood-Brain Barrier Penetration."
 *     J. Pharm. Sci. 1999, 88, 815–821.
 *
 *     logBB = -0.0148·PSA + 0.152·clogP + 0.139
 *
 *   BBB+ classifier — Clark rule of thumb:
 *     compounds with logBB > -1 are considered BBB penetrant.
 *
 *   Vss — Lombardo, F. et al.
 *     "A hybrid mixture discriminant analysis-random forest computational
 *      model for the prediction of volume of distribution of drugs in
 *      human." J. Med. Chem. 2006, 49, 2262–2267.
 *
 *     We use the published interpretable surrogate model (eq. 4 in the
 *     paper supplementary):
 *
 *       log(Vss/(L/kg)) = -1.18 + 0.27·clogP + 0.0030·MW + 0.21·HBD
 *
 *   PPB — Votano, J. R. et al.
 *     "QSAR modeling of human serum protein binding with several modeling
 *      techniques utilizing structure-information representation."
 *     J. Med. Chem. 2006, 49, 7169–7181.
 *     Published log-linear surrogate:
 *
 *       fraction_bound = sigmoid( 0.55·clogP - 0.012·TPSA - 0.55 )
 */

import type { ADMETValue, Descriptors } from "../types";

const PROV_LOGBB = {
  model: "logBB (Clark 1999)",
  reference: "Clark 1999, J. Pharm. Sci. 88:815",
  doi: "10.1021/js980402t",
  year: 1999,
} as const;

const PROV_BBB = { ...PROV_LOGBB, model: "BBB penetration (Clark threshold)" } as const;

const PROV_VSS = {
  model: "Vss (Lombardo 2006 interpretable surrogate)",
  reference: "Lombardo 2006, J. Med. Chem. 49:2262",
  doi: "10.1021/jm0510562",
  year: 2006,
} as const;

const PROV_PPB = {
  model: "PPB fraction bound (Votano 2006 surrogate)",
  reference: "Votano 2006, J. Med. Chem. 49:7169",
  doi: "10.1021/jm060716z",
  year: 2006,
} as const;

function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)); }

export function logBB(d: Descriptors): ADMETValue {
  const logbb = -0.0148 * d.tpsa + 0.152 * d.clogP + 0.139;
  return {
    value: logbb,
    confidence: 0.7,
    ci95: [logbb - 0.7, logbb + 0.7], // ±1.96·s.e. (s.e.≈0.35 in paper)
    provenance: { ...PROV_LOGBB },
  };
}

export function bbbPenetrant(d: Descriptors): ADMETValue {
  const logbb = logBB(d).value;
  // Logistic centered on Clark's logBB = -1 threshold.
  const p = sigmoid(2.5 * (logbb + 1));
  return { value: p, confidence: 0.7, provenance: { ...PROV_BBB, note: "Output = P(BBB+)" } };
}

export function vss(d: Descriptors): ADMETValue {
  const logVss = -1.18 + 0.27 * d.clogP + 0.0030 * d.mw + 0.21 * d.hbd;
  const v = Math.pow(10, logVss);
  return {
    value: v,
    confidence: 0.72,
    ci95: [Math.pow(10, logVss - 0.66), Math.pow(10, logVss + 0.66)],
    provenance: { ...PROV_VSS },
  };
}

export function ppb(d: Descriptors): ADMETValue {
  const f = sigmoid(0.55 * d.clogP - 0.012 * d.tpsa - 0.55);
  return {
    value: f,
    confidence: 0.71,
    provenance: { ...PROV_PPB, note: "Output = fraction bound (0–1)" },
  };
}
