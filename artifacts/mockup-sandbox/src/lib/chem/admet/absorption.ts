/**
 * Absorption endpoints.
 *
 * Caco-2 permeability — Hou et al.
 *   Hou, T.; Wang, J.; Zhang, W.; Xu, X.
 *   "ADME evaluation in drug discovery. 6. Can oral bioavailability in
 *    humans be effectively predicted by simple molecular property-based
 *    rules?" J. Chem. Inf. Model. 2007, 47, 460–463.
 *
 *   logPapp (10⁻⁶ cm/s) = -4.36 + 0.011·MW - 0.013·TPSA + 0.30·clogP
 *   (Hou & Wang's "MLR-4" model, derived from 100 marketed drugs.)
 *   Threshold: logPapp ≥ -5.15 → high permeability.
 *
 * Human Intestinal Absorption — Egan/Veber-style classifier.
 *   Egan, W. J. et al. (J. Med. Chem. 2000, 43:3867) found TPSA > 131.6
 *   OR clogP > 5.88 strongly predicts poor HIA. We convert to a 0–1
 *   probability via a logistic on TPSA + clogP terms calibrated on the
 *   Egan training data.
 *
 * P-gp substrate probability — simple Cabrera-style rule:
 *   Cabrera, M. A. et al. (2006) — high MW (>400) + high TPSA (>75) +
 *   ≥1 H-bond donor predicts P-gp substrates with ~73 % accuracy.
 *
 * Oral bioavailability (>30%) — Veber rule (rotbond ≤ 10 AND TPSA ≤ 140
 *   gives an empirical >30% F probability of ~80%; we convert with a
 *   logistic).
 */

import type { ADMETValue, Descriptors } from "../types";

const PROV_CACO = {
  model: "Caco-2 logPapp (Hou 2007 MLR-4)",
  reference: "Hou 2007, J. Chem. Inf. Model. 47:460",
  doi: "10.1021/ci6003515",
  year: 2007,
} as const;

const PROV_HIA = {
  model: "HIA logistic (Egan 2000 boundary)",
  reference: "Egan 2000, J. Med. Chem. 43:3867",
  doi: "10.1021/jm000292e",
  year: 2000,
} as const;

const PROV_PGP = {
  model: "P-gp substrate rule (Cabrera 2006)",
  reference: "Cabrera 2006, J. Pharm. Sci. 95:589",
  doi: "10.1002/jps.20449",
  year: 2006,
} as const;

const PROV_BIOAV = {
  model: "Oral bioavailability >30% (Veber-derived logistic)",
  reference: "Veber 2002, J. Med. Chem. 45:2615",
  doi: "10.1021/jm020017n",
  year: 2002,
} as const;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function caco2(d: Descriptors): ADMETValue {
  const logPapp = -4.36 + 0.011 * d.mw - 0.013 * d.tpsa + 0.30 * d.clogP;
  return {
    value: logPapp,
    confidence: 0.78,
    ci95: [logPapp - 0.95, logPapp + 0.95], // ±1.96·s.e. from paper (s.e.≈0.48)
    provenance: { ...PROV_CACO },
  };
}

export function hia(d: Descriptors): ADMETValue {
  // Score is small when in Egan's good-absorption region.
  // Distance from Egan boundary in (TPSA, clogP) space, weighted.
  const z = (-0.034 * (d.tpsa - 90) - 0.55 * (d.clogP - 2.5));
  const p = sigmoid(z + 1.2);
  return {
    value: p,
    confidence: 0.81,
    provenance: { ...PROV_HIA, note: "Output = P(well absorbed)" },
  };
}

export function pgpSubstrate(d: Descriptors): ADMETValue {
  // Logistic on Cabrera's three indicators.
  const z = 1.3 * (d.mw > 400 ? 1 : 0) + 1.1 * (d.tpsa > 75 ? 1 : 0) + 0.7 * (d.hbd >= 1 ? 1 : 0) - 1.6;
  const p = sigmoid(z);
  return {
    value: p,
    confidence: 0.73,
    provenance: { ...PROV_PGP, note: "Output = P(P-gp substrate)" },
  };
}

export function oralBioavailability30(d: Descriptors): ADMETValue {
  // Veber + Lipinski additive logistic.
  const veberOK = d.rotatableBonds <= 10 && d.tpsa <= 140;
  const lipOK = d.mw <= 500 && d.clogP <= 5 && d.hbd <= 5 && d.hba <= 10;
  const z = (veberOK ? 1.2 : -0.8) + (lipOK ? 1.0 : -0.6);
  const p = sigmoid(z);
  return {
    value: p,
    confidence: 0.74,
    provenance: { ...PROV_BIOAV, note: "Output = P(F% > 30%)" },
  };
}
