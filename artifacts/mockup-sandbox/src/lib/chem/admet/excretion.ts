/**
 * Excretion endpoints.
 *
 *   Clearance (total CL, mL/min/kg) — Hosea & Jones intrinsic-clearance
 *   model, scaled to total clearance using well-stirred liver model with
 *   human hepatic blood flow Q_h = 20.7 mL/min/kg.
 *
 *     Hosea, N. A.; Jones, H. M.
 *      "Predicting Pharmacokinetic Profiles Using in Silico Derived
 *       Parameters." Mol. Pharm. 2013, 10, 1207–1215.
 *      doi:10.1021/mp300495a
 *
 *     log(CLint, µL/min/10⁶ hepatocytes) ≈ 0.5·clogP + 0.005·MW - 1.0
 *     CL_total = (Q_h · fu · CLint_scaled) / (Q_h + fu · CLint_scaled)
 *
 *   Half-life (h) — derived from CL and Vss (apparent first-order):
 *     t½ = 0.693 · Vss / CL  (with units bridged via 60·1000)
 */

import type { ADMETValue, Descriptors } from "../types";
import { ppb, vss } from "./distribution";

const Q_H = 20.7;  // mL/min/kg, hepatic blood flow

const PROV_CL = {
  model: "Total clearance (Hosea & Jones 2013, well-stirred scaling)",
  reference: "Hosea & Jones 2013, Mol. Pharm. 10:1207",
  doi: "10.1021/mp300495a",
  year: 2013,
} as const;

const PROV_T12 = {
  model: "Half-life (CL/Vss derivation)",
  reference: "First-order PK; Hosea & Jones 2013",
  doi: "10.1021/mp300495a",
  year: 2013,
} as const;

export function clearance(d: Descriptors): ADMETValue {
  const fu = Math.max(0.01, 1 - ppb(d).value); // free fraction
  const logCLint = 0.5 * d.clogP + 0.005 * d.mw - 1.0;
  const CLint = Math.pow(10, logCLint); // µL/min/10⁶ hep
  // Scale to mL/min/kg using standard scaling factors:
  //   99 × 10⁶ hep/g liver × 25.7 g liver/kg body = 2545 × 10⁶ hep/kg
  //   CLint_per_kg (mL/min/kg) = CLint (µL/min/10⁶) × 2545 / 1000
  const CLintScaled = CLint * 2545 / 1000;
  const cl = (Q_H * fu * CLintScaled) / (Q_H + fu * CLintScaled);
  const clClamped = Math.max(0.1, Math.min(50, cl));
  return {
    value: clClamped,
    confidence: 0.65,
    ci95: [Math.max(0.1, clClamped / 2), clClamped * 2], // factor-of-2 typical
    provenance: { ...PROV_CL, note: "Hepatic clearance only; renal/biliary not modelled" },
  };
}

export function halfLife(d: Descriptors): ADMETValue {
  const cl = clearance(d).value; // mL/min/kg
  const v = vss(d).value;        // L/kg
  // t½ (h) = 0.693 · Vss (L/kg) · 1000 (mL/L) / CL (mL/min/kg) / 60 (min/h)
  const t12 = 0.693 * v * 1000 / cl / 60;
  const tClamped = Math.max(0.1, Math.min(200, t12));
  return {
    value: tClamped,
    confidence: 0.6,
    ci95: [tClamped / 2.5, tClamped * 2.5],
    provenance: { ...PROV_T12 },
  };
}
