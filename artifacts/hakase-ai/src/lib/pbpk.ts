/**
 * Two-Compartment PBPK Model
 * Replaces the one-compartment analytical model in cohortSim.ts.
 *
 * Model structure (PK-Sim inspired, OSP Suite physiological values):
 *   Central compartment  C1: plasma + highly-perfused organs (liver, kidney, lung)
 *   Peripheral compartment C2: muscle, fat, poorly-perfused tissues
 *
 * ODEs (concentration form):
 *   dC1/dt = [Input(t) − CL·C1 − Q·C1 + Q·C2/Kp] / Vc
 *   dC2/dt = [Q·C1 − Q·C2/Kp] / Vp
 *
 * Parameters derived from:
 *   - Drug physicochemistry (logP, MW, ADMET scores)
 *   - Patient body weight (allometric scaling, BW^0.75 for clearance)
 *   - PK-Sim human physiology reference (70 kg adult)
 *
 * Reference physiological values (PK-Sim OSP Suite, 2024):
 *   Cardiac output:         6.5  L/min
 *   Liver blood flow:       1.65 L/min
 *   Liver volume:           1.69 L
 *   Total body water:       42   L (70 kg reference)
 */

export interface PBPKDrugParams {
  mw:          number;   // g/mol
  logP:        number;
  tpsa:        number;   // Å²
  hbd:         number;
  bioavailF:   number;   // 0–1
  absorptionScore: number; // ADMET absorption (0–1)
  excretionScore:  number; // ADMET excretion  (0–1)
  metabolismScore: number; // ADMET metabolism (0–1)
  dosingMg:    number;   // mg
  routeIV:     boolean;
}

export interface PBPKPatientParams {
  weightKg: number;
  egfr:     number;   // mL/min/1.73 m²
  albuminGdL: number;
}

export interface PBPKOutput {
  pkCurve: Array<{ time: number; conc: number; ci_lo: number; ci_hi: number }>;
  cmax:    number;
  tmax:    number;
  auc:     number;
  halfLifeHr: number;
  vdss:    number;
  clearance: number;
  model:   "2-compartment";
}

const TIME_POINTS = [0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 36, 48];

function allometricCL(baseCL: number, weightKg: number, refWeight = 70): number {
  return baseCL * Math.pow(weightKg / refWeight, 0.75);
}

function allometricV(baseV: number, weightKg: number, refWeight = 70): number {
  return baseV * (weightKg / refWeight);
}

/**
 * Solve the two-compartment ODE numerically (4th-order Runge–Kutta, 1-min steps).
 */
function solveODE(
  drug: PBPKDrugParams,
  Vc: number, Vp: number, CL: number, Q: number, Kp: number,
  ka: number, weightKg: number,
): number[] {
  const dtH = 1 / 60; // 1-minute steps in hours
  const maxT = 50;    // simulate 50 hours
  const nSteps = Math.ceil(maxT / dtH);

  let A_gut = drug.routeIV ? 0 : drug.dosingMg * drug.bioavailF;
  let C1 = drug.routeIV ? (drug.dosingMg / weightKg) / Vc * weightKg : 0;
  let C2 = 0;

  const result: number[] = new Array(TIME_POINTS.length).fill(0);
  let resultIdx = 0;
  let t = 0;

  const step = (C1: number, C2: number, A_gut: number) => {
    const input = drug.routeIV ? 0 : ka * A_gut;
    const dC1 = (input / Vc - (CL / Vc) * C1 - (Q / Vc) * C1 + (Q / Vp) * (C2 / Kp));
    const dC2 = (Q / Vc) * C1 - (Q / Vp) * (C2 / Kp);
    const dAg = -ka * A_gut;
    return { dC1, dC2, dAg };
  };

  for (let i = 0; i < nSteps; i++) {
    // Record if we're at a time-point
    if (resultIdx < TIME_POINTS.length && t >= TIME_POINTS[resultIdx]) {
      result[resultIdx] = Math.max(0, C1);
      resultIdx++;
    }

    // RK4
    const k1 = step(C1, C2, A_gut);
    const k2 = step(C1 + k1.dC1 * dtH / 2, C2 + k1.dC2 * dtH / 2, A_gut + k1.dAg * dtH / 2);
    const k3 = step(C1 + k2.dC1 * dtH / 2, C2 + k2.dC2 * dtH / 2, A_gut + k2.dAg * dtH / 2);
    const k4 = step(C1 + k3.dC1 * dtH,     C2 + k3.dC2 * dtH,     A_gut + k3.dAg * dtH);

    C1    += (k1.dC1 + 2 * k2.dC1 + 2 * k3.dC1 + k4.dC1) * dtH / 6;
    C2    += (k1.dC2 + 2 * k2.dC2 + 2 * k3.dC2 + k4.dC2) * dtH / 6;
    A_gut += (k1.dAg + 2 * k2.dAg + 2 * k3.dAg + k4.dAg) * dtH / 6;
    C1 = Math.max(0, C1);
    C2 = Math.max(0, C2);
    A_gut = Math.max(0, A_gut);
    t += dtH;
  }
  // Fill remaining time points
  while (resultIdx < TIME_POINTS.length) {
    result[resultIdx++] = 0;
  }
  return result;
}

export function runPBPK(drug: PBPKDrugParams, patient: PBPKPatientParams): PBPKOutput {
  const BW = patient.weightKg;

  // ── Tissue-to-plasma partition coefficient (Kp) ──────────────────────────
  // Simplified Rodgers & Rowland approach:
  //   logP > 2 → lipophilic: higher peripheral distribution
  const Kp = Math.max(0.3, Math.min(15, 1 + (drug.logP - 1) * 0.8));

  // ── Volume of distribution (allometric from 70 kg reference) ─────────────
  // Vc ≈ plasma volume + highly-perfused organs (reference: ~5–8 L for 70 kg)
  const VcRef = 5.0 + drug.logP * 0.5;
  const VpRef = Math.max(5, 20 + drug.logP * 4.0 + drug.mw / 80);
  const Vc = allometricV(Math.max(3, VcRef), BW);
  const Vp = allometricV(Math.max(10, VpRef), BW);
  const Vdss = (Vc + Vp * Kp) / BW; // L/kg

  // ── Clearance (allometric, renal adjustment) ──────────────────────────────
  // Base hepatic CL from ADMET metabolism score (0=poor, 1=ideal)
  const CLhep_ref = (1 - drug.metabolismScore) * 25 + 2; // L/h, 70 kg ref
  // Renal CL proportional to eGFR deviation from normal (100 mL/min)
  const renalFraction = drug.mw < 400 ? 0.25 : 0.10;
  const CLren_ref     = 6.0 * renalFraction * (patient.egfr / 100);
  const CL_ref        = CLhep_ref + CLren_ref;
  const CL            = allometricCL(Math.max(0.5, CL_ref), BW);

  // Albumin binding correction: low albumin → higher free fraction → faster CL
  const albNorm = (patient.albuminGdL - 4.1) / 4.1;
  const CLadj   = CL * (1 - albNorm * 0.3 * Math.min(1, drug.logP / 4));

  // ── Inter-compartmental clearance (Q) ────────────────────────────────────
  // Typically 30–60% of CL for moderate lipophilicity
  const Q = Math.max(1, CLadj * (0.3 + drug.logP * 0.05));

  // ── Absorption rate constant (ka, oral) ──────────────────────────────────
  // High TPSA → slow absorption; high logP → rapid
  const ka = drug.routeIV ? 0
    : Math.max(0.2, Math.min(5.0, drug.absorptionScore * 3.5 - drug.tpsa / 200));

  // ── Solve ODE ────────────────────────────────────────────────────────────
  const concentrations = solveODE(drug, Vc, Vp, CLadj, Q, Kp, ka, BW);

  // ── Derive PK metrics ────────────────────────────────────────────────────
  const cmax = Math.max(...concentrations);
  const tmaxIdx = concentrations.indexOf(cmax);
  const tmax = TIME_POINTS[tmaxIdx] ?? 2;
  const halfLifeHr = Math.log(2) / (CLadj / (Vc + Vp));

  // Trapezoidal AUC (0→48h)
  let auc = 0;
  for (let i = 1; i < TIME_POINTS.length; i++) {
    auc += (concentrations[i] + concentrations[i - 1]) / 2 * (TIME_POINTS[i] - TIME_POINTS[i - 1]);
  }

  // CI based on inter-individual variability (30% CV typical for PK)
  const cv = 0.30;
  const pkCurve = TIME_POINTS.map((time, i) => {
    const conc = parseFloat(Math.max(0, concentrations[i]).toFixed(4));
    const ci   = conc * cv;
    return {
      time,
      conc,
      ci_lo: parseFloat(Math.max(0, conc - ci).toFixed(4)),
      ci_hi: parseFloat((conc + ci).toFixed(4)),
    };
  });

  return {
    pkCurve,
    cmax:       parseFloat(cmax.toFixed(4)),
    tmax:       parseFloat(tmax.toFixed(1)),
    auc:        parseFloat(auc.toFixed(2)),
    halfLifeHr: parseFloat(halfLifeHr.toFixed(1)),
    vdss:       parseFloat(Vdss.toFixed(2)),
    clearance:  parseFloat((CLadj / BW).toFixed(4)),
    model:      "2-compartment",
  };
}
