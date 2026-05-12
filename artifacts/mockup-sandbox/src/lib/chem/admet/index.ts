/**
 * ADMET aggregator — runs every endpoint and produces a single
 * `ADMETProfile`. Also derives the five-axis radar aggregate used by the
 * UI, mapped onto [0, 1] using domain-appropriate "good direction".
 */

import type { ADMETProfile, Descriptors, StructuralAlerts } from "../types";
import {
  caco2, hia, pgpSubstrate, oralBioavailability30,
} from "./absorption";
import { logBB, bbbPenetrant, vss, ppb } from "./distribution";
import {
  cyp1a2Inhibition, cyp2c9Inhibition, cyp2c19Inhibition,
  cyp2d6Inhibition, cyp3a4Inhibition,
} from "./metabolism";
import { clearance, halfLife } from "./excretion";
import { hergRisk, ames, dili, ld50, skinSens } from "./toxicity";

function clip01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Map each ADMET axis to a "goodness" score in [0,1] where higher = better.
 * Calibration uses domain conventions:
 *   - Absorption: high HIA, high Caco-2 logPapp, high F>30%, low P-gp efflux
 *   - Distribution: Vss in 0.5-5 L/kg range, PPB neither too high (>99%) nor 0
 *   - Metabolism: low CYP inhibition (averaged across isoforms)
 *   - Excretion: half-life in 4-24 h range (drug-like), CL not extreme
 *   - Toxicity: low hERG, low AMES, low DILI, high LD50
 */
function buildAggregate(d: Descriptors, alerts: StructuralAlerts): ADMETProfile["aggregate"] {
  const absorption = clip01(
    0.4 * hia(d).value +
    0.3 * clip01((caco2(d).value + 6) / 2.5) + // map logPapp ≈ -6..-3.5 → 0..1
    0.2 * oralBioavailability30(d).value +
    0.1 * (1 - pgpSubstrate(d).value),
  );
  const vssV = vss(d).value;
  const vssGoodness = vssV >= 0.5 && vssV <= 5 ? 1 - Math.abs(Math.log10(vssV) - Math.log10(1.5)) : 0.4;
  const ppbF = ppb(d).value;
  const ppbGoodness = ppbF < 0.99 ? 1 - Math.max(0, ppbF - 0.9) * 5 : 0.2;
  const distribution = clip01(0.6 * vssGoodness + 0.4 * ppbGoodness);

  const cypAvg = (
    cyp1a2Inhibition(d).value + cyp2c9Inhibition(d).value +
    cyp2c19Inhibition(d).value + cyp2d6Inhibition(d).value +
    cyp3a4Inhibition(d).value
  ) / 5;
  const metabolism = clip01(1 - cypAvg);

  const t12 = halfLife(d).value;
  const clV = clearance(d).value;
  const t12Goodness = t12 >= 4 && t12 <= 24 ? 1 : t12 < 4 ? Math.max(0, t12 / 4) : Math.max(0, 1 - (t12 - 24) / 100);
  const clGoodness  = clV >= 1 && clV <= 15 ? 1 : 0.5;
  const excretion = clip01(0.7 * t12Goodness + 0.3 * clGoodness);

  const toxicity = clip01(
    1 - 0.35 * hergRisk(d).value
      - 0.25 * ames(d, alerts).value
      - 0.20 * dili(d).value
      - 0.10 * (1 - clip01(Math.log10(Math.max(1, ld50(d).value)) / 4))
      - 0.10 * skinSens(d, alerts).value,
  );

  return { absorption, distribution, metabolism, excretion, toxicity };
}

export function computeADMET(d: Descriptors, alerts: StructuralAlerts): ADMETProfile {
  return {
    caco2: caco2(d),
    hia: hia(d),
    pgpSubstrate: pgpSubstrate(d),
    oralBioavailability30: oralBioavailability30(d),

    logBB: logBB(d),
    bbbPenetrant: bbbPenetrant(d),
    vss: vss(d),
    ppb: ppb(d),

    cyp1a2Inhibition: cyp1a2Inhibition(d),
    cyp2c9Inhibition: cyp2c9Inhibition(d),
    cyp2c19Inhibition: cyp2c19Inhibition(d),
    cyp2d6Inhibition: cyp2d6Inhibition(d),
    cyp3a4Inhibition: cyp3a4Inhibition(d),

    clearance: clearance(d),
    halfLife: halfLife(d),

    hergRisk: hergRisk(d),
    dili: dili(d),
    ames: ames(d, alerts),
    ld50: ld50(d),
    skinSens: skinSens(d, alerts),

    aggregate: buildAggregate(d, alerts),
  };
}
