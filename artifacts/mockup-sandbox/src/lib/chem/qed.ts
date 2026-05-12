/**
 * QED — Quantitative Estimation of Drug-likeness (Bickerton et al. 2012).
 *
 * Reference:
 *   Bickerton, G. R.; Paolini, G. V.; Besnard, J.; Muresan, S.;
 *   Hopkins, A. L.
 *   "Quantifying the chemical beauty of drugs."
 *   Nature Chemistry 2012, 4, 90–98.  doi:10.1038/nchem.1243
 *
 * Implementation notes:
 *  - Eight desirability functions (ADS) are applied to MW, ALOGP, HBA, HBD,
 *    PSA, ROTB, AROM, ALERTS. Coefficients below are Table 1 of the paper
 *    (the "mean QED" / w_mean weighting set, which is the default in the
 *    RDKit Contrib implementation by Sereina Riniker).
 *  - The "ALERTS" descriptor counts substructure hits from the curated set of
 *    8 functional-group alert SMARTS the paper used; we use Bickerton's
 *    published SMARTS list (see ./alerts/bickerton.ts).
 *  - The aggregate is a weighted geometric mean of the eight ADS values.
 *
 * The numbers below MUST NOT be edited casually — they are taken verbatim
 * from the published model.
 */

import type { Descriptors, Predicted } from "./types";
import { countBickertonAlerts } from "./alerts-bickerton";
import type { RDKitMol } from "./rdkit-loader";

type ADSCoef = {
  a: number; b: number; c: number; d: number;
  e: number; f: number; dmax: number;
};

const ADS_COEFS: Record<string, ADSCoef> = {
  MW:     { a: 2.817065973, b: 392.5754953, c: 290.7489764, d: 2.419764353,    e: 49.22325677,  f: 65.37051707,  dmax: 104.9805561 },
  ALOGP:  { a: 3.172690585, b: 137.8624751, c: 2.534937431, d: 4.581497897,    e: 0.822739154,  f: 0.576295591,  dmax: 131.3186604 },
  HBA:    { a: 2.948620388, b: 160.4605972, c: 3.615294657, d: 4.435986202,    e: 0.290141953,  f: 1.300669958,  dmax: 148.7763046 },
  HBD:    { a: 1.618662227, b: 1010.051101, c: 0.985094388, d: 0.000000000389, e: 0.713820843,  f: 0.920922555,  dmax: 258.1632616 },
  PSA:    { a: 1.876861559, b: 125.2232657, c: 62.90773554, d: 87.83366614,    e: 12.01999824,  f: 28.51324732,  dmax: 104.5686167 },
  ROTB:   { a: 0.010000000, b: 272.4121427, c: 2.558379970, d: 1.565547684,    e: 1.271567166,  f: 2.758063707,  dmax: 105.4420403 },
  AROM:   { a: 3.217788970, b: 957.7374108, c: 2.274627939, d: 0.000000001,    e: 1.317690384,  f: 0.375760881,  dmax: 312.3372610 },
  ALERTS: { a: 0.010000000, b: 1199.094025, c: -0.09002883, d: 0.185904477,    e: 0.000000038,  f: 0.087290224,  dmax: 417.7253140 },
};

// "QED_w_mean" weights from the paper. There are also "max" and "none"
// weighting sets in the paper; "mean" is the canonical default.
const WEIGHTS = {
  MW: 0.66, ALOGP: 0.46, HBA: 0.05, HBD: 0.61,
  PSA: 0.06, ROTB: 0.65, AROM: 0.48, ALERTS: 0.95,
} as const;

function ads(x: number, p: ADSCoef): number {
  const left  = p.b / (1 + Math.exp(-1 * (x - p.c + p.d / 2) / p.e));
  const right = 1 - 1 / (1 + Math.exp(-1 * (x - p.c - p.d / 2) / p.f));
  return (p.a + left * right) / p.dmax;
}

export function computeQEDFromDescriptors(
  d: Descriptors,
  alertsCount: number,
): Predicted<number> {
  const dvals = {
    MW: ads(d.mw, ADS_COEFS.MW),
    ALOGP: ads(d.clogP, ADS_COEFS.ALOGP),
    HBA: ads(d.hba, ADS_COEFS.HBA),
    HBD: ads(d.hbd, ADS_COEFS.HBD),
    PSA: ads(d.tpsa, ADS_COEFS.PSA),
    ROTB: ads(d.rotatableBonds, ADS_COEFS.ROTB),
    AROM: ads(d.aromaticRings, ADS_COEFS.AROM),
    ALERTS: ads(alertsCount, ADS_COEFS.ALERTS),
  };

  // Weighted geometric mean: exp( sum(w_i * log(d_i)) / sum(w_i) )
  let logSum = 0;
  let wSum = 0;
  for (const k of Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>) {
    const w = WEIGHTS[k];
    // Floor desirability away from 0 to avoid log(0); standard practice.
    const di = Math.max(dvals[k], 1e-7);
    logSum += w * Math.log(di);
    wSum += w;
  }
  const qed = Math.exp(logSum / wSum);

  // Coverage of the training set is well-defined for typical small molecules
  // (MW < 800). Flag OOD beyond that.
  const outOfDomain = d.mw > 800 || d.heavyAtoms > 60;

  return {
    value: qed,
    confidence: outOfDomain ? 0.4 : 0.9,
    outOfDomain,
    provenance: {
      model: "QED (w_mean)",
      reference: "Bickerton 2012, Nature Chemistry",
      doi: "10.1038/nchem.1243",
      year: 2012,
      note: outOfDomain
        ? "Outside the paper's typical small-molecule applicability domain"
        : undefined,
    },
  };
}

export async function computeQED(
  mol: RDKitMol,
  d: Descriptors,
): Promise<Predicted<number>> {
  const alertsCount = await countBickertonAlerts(mol);
  return computeQEDFromDescriptors(d, alertsCount);
}
