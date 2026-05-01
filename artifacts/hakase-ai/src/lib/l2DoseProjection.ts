/**
 * L2 Stage 8 — Therapeutic-Index Ranking + first-pass human dose projection.
 *
 * Wires ONE real L2 engine end-to-end on top of live L1 outputs.
 * The doc (HakaseBio_4Layer_Architecture_Research §4.3, Stage 8) describes
 * this stage as: "efficacy margin = predicted Cmax,unbound / Ki; safety
 * margin = hERG IC50 / Cmax,unbound (and CYP, off-target). MRSD computed
 * from L1 NOAEL via FDA workflow."
 *
 * Honesty constraints kept by this implementation:
 *   1. Every input is read from real L1 outputs (admet.ts SimResults +
 *      inVitroSim.ts InVitroResults). No fabricated input values.
 *   2. Every transformation cites a published equation (Hill receptor
 *      occupancy, well-stirred liver model, Yee 1997 Caco-2 → F bins,
 *      logP-binned Vd proxy, FDA cardiac safety margin convention).
 *   3. Each computed value carries an `assumption` string so the UI can
 *      show provenance.
 *   4. The result is explicitly labelled "first-pass projection — not
 *      a substitute for PBPK or measured human PK".
 */

import type { SimResults } from "./admet";
import type { InVitroResults } from "./inVitroSim";

// ── Physiological constants (human, 70 kg adult) ────────────────────────────
const HUMAN_BODY_WEIGHT_KG = 70;
const HUMAN_HEPATIC_BLOOD_FLOW_ML_MIN_KG = 20;   // Davies & Morris 1993
const MPPGL = 45;                                // mg microsomal protein per g liver — Barter 2007
const LIVER_WEIGHT_G_PER_KG = 25.7;              // ICRP Reference Adult Male

// ── Receptor-occupancy target (Stage 8 default) ─────────────────────────────
const TARGET_OCCUPANCY = 0.75;                   // 75% — common pre-clinical target
const KI_MULTIPLIER_FOR_TARGET = TARGET_OCCUPANCY / (1 - TARGET_OCCUPANCY); // = 3.0 for 75%

// ── Safety-margin tier cutoffs (FDA cardiac safety convention) ──────────────
const MARGIN_SAFE_THRESHOLD     = 30;
const MARGIN_CAUTION_THRESHOLD  = 10;

export type MarginTier = "SAFE" | "CAUTION" | "RISK" | "UNKNOWN";

export interface L2MarginRow {
  label:      string;
  ratio:      number | null;     // Xfold of Cmax,u — higher is safer
  tier:       MarginTier;
  numerator:  string;            // Human-readable, e.g. "hERG IC50 4.5 µM"
  denominator:string;            // Human-readable, e.g. "Cmax,u 12 nM"
  assumption: string;
}

export interface L2DoseProjection {
  // ── Provenance ────────────────────────────────────────────────────────────
  generatedAt: string;
  l1Stamp:     string;           // L1 timestamp this projection was computed from
  molName:     string;
  smiles:      string;
  uniprotId:   string;

  // ── Receptor-occupancy target ─────────────────────────────────────────────
  targetOccupancy:        number;
  targetCmaxUnbound_nM:   number;
  targetCmaxTotal_nM:     number;
  fu_fraction:            number;       // fraction (0–1) — from L1 plasma protein binding
  ki_nM:                  number;

  // ── PK projection (heuristic — first-pass) ────────────────────────────────
  Vd_L_per_kg:            number;
  Vd_assumption:          string;
  F_oral:                 number;
  F_assumption:           string;
  hepaticCL_mL_min_kg:    number | null;  // null if microsomal CLint unavailable
  CL_assumption:          string;
  predictedDose_mg_per_kg:number;
  predictedDose_mg_per_day:number;
  doseAssumption:         string;

  // ── Therapeutic-index margins ─────────────────────────────────────────────
  margins: L2MarginRow[];

  // ── Verdict ───────────────────────────────────────────────────────────────
  verdict:   "GO" | "WATCH" | "NO-GO";
  rationale: string[];
  warnings:  string[];

  // ── Confidence flag — always low for a first-pass projection ──────────────
  confidence: "low";
  confidenceNote: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper computations — each cites its published basis.
// ─────────────────────────────────────────────────────────────────────────────

/** Vd estimation from logP (binned proxy — see Obach 2008 review for ranges). */
function estimateVd(logP: number): { Vd: number; assumption: string } {
  let Vd: number;
  if (logP < 1)        Vd = 0.5;
  else if (logP < 2)   Vd = 1.0;
  else if (logP < 3)   Vd = 2.0;
  else if (logP < 4)   Vd = 4.0;
  else                 Vd = 8.0;
  return {
    Vd,
    assumption: `logP-binned proxy (logP=${logP.toFixed(2)} → Vd≈${Vd} L/kg). Range matches Obach 2008 small-molecule survey; not a substitute for PBPK Vd.`,
  };
}

/** Oral F estimation from Caco-2 Papp (Yee 1997 / Artursson textbook bins). */
function estimateF(caco2Papp: number): { F: number; assumption: string } {
  let F: number;
  let bin: string;
  if (caco2Papp >= 10)      { F = 0.85; bin = "high";     }
  else if (caco2Papp >= 1)  { F = 0.50; bin = "moderate"; }
  else                       { F = 0.15; bin = "low";      }
  return {
    F,
    assumption: `Caco-2 Papp ${caco2Papp.toFixed(1)}×10⁻⁶ cm/s → F≈${F.toFixed(2)} (${bin} permeability bin, Yee 1997). Excludes first-pass metabolism beyond gut wall.`,
  };
}

/** Hepatic CL from microsomal CLint via well-stirred liver model. */
function scaleHepaticCL(
  microsomalCLint_uL_min_mg: number,
  fu: number,
): { CL: number; assumption: string } {
  // Scale microsomal CLint to whole-liver in vivo (mL/min/kg)
  const CLintScaled =
    (microsomalCLint_uL_min_mg / 1000) *  // µL/min/mg → mL/min/mg
    MPPGL *                                // × mg microsomal protein / g liver
    LIVER_WEIGHT_G_PER_KG;                 // × g liver / kg body weight
  // Well-stirred model
  const Qh = HUMAN_HEPATIC_BLOOD_FLOW_ML_MIN_KG;
  const CL = (Qh * fu * CLintScaled) / (Qh + fu * CLintScaled);
  return {
    CL,
    assumption: `Well-stirred liver model: CLint(microsomal) ${microsomalCLint_uL_min_mg.toFixed(0)} µL/min/mg → in-vivo CL ${CL.toFixed(1)} mL/min/kg (MPPGL=45, liver=25.7 g/kg, Q_h=20 mL/min/kg, fu=${fu.toFixed(2)}).`,
  };
}

/** Tier a safety ratio. */
function tier(ratio: number | null): MarginTier {
  if (ratio === null || !isFinite(ratio)) return "UNKNOWN";
  if (ratio >= MARGIN_SAFE_THRESHOLD)    return "SAFE";
  if (ratio >= MARGIN_CAUTION_THRESHOLD) return "CAUTION";
  return "RISK";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point.
// ─────────────────────────────────────────────────────────────────────────────

export function computeL2DoseProjection(
  sim: SimResults,
  iv:  InVitroResults,
): L2DoseProjection {

  // ── Read live L1 inputs ───────────────────────────────────────────────────
  const ki_nM    = sim.binding.primaryKi;
  const mw       = sim.lipinski.mw;
  const logP     = sim.lipinski.logP;
  const fuPct    = iv.plasmaProteinBinding.fuPercent;
  const hergUM   = iv.herg.ic50_uM;
  const cyp3a4   = iv.metabolicStability.cypInhibition.CYP3A4.ic50_uM;
  const cc50_uM  = iv.cellViability.cc50_uM;
  const caco2    = iv.permeability.caco2Papp;
  const clint    = iv.metabolicStability.microsomalCLint;

  // ── Validate fu (no silent fallback per user policy) ──────────────────────
  // fu is required for Cmax,total math and CL scaling. If invalid, we surface
  // it as an explicit warning + degrade to Cmax,unbound-only margins rather
  // than substituting a guess.
  const fuValid = isFinite(fuPct) && fuPct > 0 && fuPct <= 100;
  const fu      = fuValid ? fuPct / 100 : NaN;
  const fuWarning = fuValid
    ? null
    : `L1 plasma fu out of range (fuPercent=${fuPct}). Cmax,total and dose projection cannot be computed without a valid fu — neither will be reported. Margins below use Cmax,unbound only.`;

  // ── Receptor-occupancy target (Hill slope 1, 75%) ─────────────────────────
  const targetCmaxUnbound_nM = KI_MULTIPLIER_FOR_TARGET * ki_nM;
  const targetCmaxTotal_nM   = fuValid ? targetCmaxUnbound_nM / fu : NaN;

  // ── PK estimation (heuristic, clearly flagged) ────────────────────────────
  const { Vd, assumption: VdNote } = estimateVd(logP);
  const { F,  assumption: FNote  } = estimateF(caco2);
  const clResult = fuValid
    ? scaleHepaticCL(clint, fu)
    : { CL: NaN, assumption: `Hepatic CL not computed — invalid plasma fu (fuPercent=${fuPct}); well-stirred liver model requires fu.` };
  const { CL, assumption: CLNote } = clResult;

  // ── Required oral dose for target Cmax,total ──────────────────────────────
  const dose_mg_per_kg = fuValid
    ? (targetCmaxTotal_nM * Vd * mw) / (F * 1e6)
    : NaN;
  const dose_mg_per_day = fuValid ? dose_mg_per_kg * HUMAN_BODY_WEIGHT_KG : NaN;

  const doseAssumption = fuValid
    ? `Steady-state Cmax = Dose × F / Vd. ` +
      `Dose(mg/day) = Cmax,total(${targetCmaxTotal_nM.toFixed(1)} nM) × Vd(${Vd} L/kg) × MW(${mw.toFixed(0)}) / F(${F.toFixed(2)}) × 70 kg / 10⁶. ` +
      `Ignores accumulation, F1st-pass beyond gut, formulation. First-pass projection only.`
    : `Dose projection skipped — invalid plasma fu prevents Cmax,total calculation.`;

  // ── Therapeutic-index margins (per architecture doc §4.3 Stage 8: ─────────
  // ── safety margin = IC50 / Cmax,UNBOUND. Pharmacologically, only unbound  ─
  // ── drug interacts with target/off-target/ion channel.) ───────────────────
  const ratioVsUnbound = (iC50_uM: number): number =>
    (iC50_uM * 1000) / targetCmaxUnbound_nM;

  // Worst-case off-target selectivity = lowest fold ratio across L1 panel hits.
  // selectivityRatio is computed by L1 as (off-target IC50 / on-target IC50),
  // clamped to [1, 100] — a true fold metric on the same scale as 30×/10×.
  const offTargets = iv.selectivity.topOffTargets;
  const worstOffTargetRatio = offTargets.length > 0
    ? Math.min(...offTargets.map(o => o.selectivityRatio))
    : null;
  const worstOffTargetName = worstOffTargetRatio !== null
    ? offTargets.reduce((min, o) => o.selectivityRatio < min.selectivityRatio ? o : min, offTargets[0]).name
    : null;

  const margins: L2MarginRow[] = [
    {
      label:       "hERG safety margin",
      ratio:       ratioVsUnbound(hergUM),
      tier:        tier(ratioVsUnbound(hergUM)),
      numerator:   `hERG IC50 ${hergUM.toFixed(2)} µM`,
      denominator: `Cmax,unbound ${targetCmaxUnbound_nM.toFixed(2)} nM`,
      assumption:  "FDA cardiac safety convention: ratio ≥30 SAFE, 10–30 CAUTION, <10 RISK. Compared against unbound concentration — only unbound drug blocks Kv11.1.",
    },
    {
      label:       "CYP3A4 inhibition margin",
      ratio:       ratioVsUnbound(cyp3a4),
      tier:        tier(ratioVsUnbound(cyp3a4)),
      numerator:   `CYP3A4 IC50 ${cyp3a4.toFixed(2)} µM`,
      denominator: `Cmax,unbound ${targetCmaxUnbound_nM.toFixed(2)} nM`,
      assumption:  "DDI risk indicator (ICH M9 / FDA DDI guidance). Compared against unbound — protein-bound drug does not enter hepatocytes for CYP inhibition.",
    },
    {
      label:       "Cytotoxicity margin (CC50)",
      ratio:       ratioVsUnbound(cc50_uM),
      tier:        tier(ratioVsUnbound(cc50_uM)),
      numerator:   `CC50 ${cc50_uM.toFixed(2)} µM (${iv.cellViability.cellLine})`,
      denominator: `Cmax,unbound ${targetCmaxUnbound_nM.toFixed(2)} nM`,
      assumption:  "Selectivity-vs-cytotoxicity ratio against unbound concentration. <10 indicates narrow window between efficacy and non-specific cell death.",
    },
    {
      label:       "Worst-case off-target selectivity",
      ratio:       worstOffTargetRatio,
      tier:        tier(worstOffTargetRatio),
      numerator:   worstOffTargetName !== null
        ? `${worstOffTargetName} IC50 / on-target IC50`
        : "no off-target hits in L1 panel",
      denominator: `selectivity fold ratio`,
      assumption:  worstOffTargetRatio !== null
        ? `Lowest fold ratio across ${offTargets.length} L1-panel hit(s). Same fold scale as hERG/CYP — ≥30× SAFE, <10× RISK.`
        : `L1 selectivity panel reported zero off-target hits — margin not applicable.`,
    },
  ];

  // ── Verdict ───────────────────────────────────────────────────────────────
  const rationale: string[] = [];
  const warnings:  string[] = [];

  // Surface fu validation issue first if it occurred
  if (fuWarning) warnings.push(fuWarning);

  // Carry through L1 categorical signals
  if (sim.goNogo === "NO-GO") {
    warnings.push(`L1 cascade gate: NO-GO (${sim.recommendation})`);
  }
  if (iv.overallRisk === "High") {
    warnings.push(`L1 in-vitro overall risk: HIGH`);
  }
  if (sim.toxAlerts.some(a => a.severity === "High")) {
    warnings.push(`L1 has ${sim.toxAlerts.filter(a => a.severity === "High").length} high-severity tox alert(s)`);
  }
  if (iv.bioactivation.overallBioactivationRisk === "High") {
    warnings.push(`L1 bioactivation risk: HIGH (${iv.bioactivation.mechanisticToxicities.length} mechanistic flag(s))`);
  }

  const numericMargins = margins.filter(m => m.ratio !== null && isFinite(m.ratio!));
  const tiers = numericMargins.map(m => m.tier);
  const hasRisk    = tiers.includes("RISK");
  const hasCaution = tiers.includes("CAUTION");

  let verdict: "GO" | "WATCH" | "NO-GO";
  if (sim.goNogo === "NO-GO" || hasRisk) {
    verdict = "NO-GO";
    rationale.push(hasRisk
      ? "One or more therapeutic-index margins fell below the 10× cutoff."
      : "Carried forward from L1 cascade-gate NO-GO.");
  } else if (sim.goNogo === "WATCH" || hasCaution || warnings.length > 0) {
    verdict = "WATCH";
    rationale.push(hasCaution
      ? "One or more margins between 10–30× — additional in-vivo data needed before dose escalation."
      : "Cleared all margins but L1 carries forward ≥1 categorical warning.");
  } else {
    verdict = "GO";
    rationale.push("All therapeutic-index margins ≥30× and L1 cascade gate passed.");
  }

  if (fuValid) {
    rationale.push(
      `Predicted starting human dose ≈ ${dose_mg_per_day.toFixed(1)} mg/day for 70-kg adult ` +
      `to reach ${(TARGET_OCCUPANCY * 100).toFixed(0)}% receptor occupancy ` +
      `(Cmax,u ≈ ${targetCmaxUnbound_nM.toFixed(1)} nM = ${KI_MULTIPLIER_FOR_TARGET}× Ki).`,
    );
  } else {
    rationale.push(
      `Required Cmax,unbound ≈ ${targetCmaxUnbound_nM.toFixed(1)} nM = ${KI_MULTIPLIER_FOR_TARGET}× Ki ` +
      `for ${(TARGET_OCCUPANCY * 100).toFixed(0)}% receptor occupancy. ` +
      `Dose projection withheld — invalid plasma fu.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    l1Stamp:     iv.timestamp,
    molName:     sim.molName,
    smiles:      sim.smiles,
    uniprotId:   sim.uniprotId,

    targetOccupancy:      TARGET_OCCUPANCY,
    targetCmaxUnbound_nM,
    targetCmaxTotal_nM,
    fu_fraction:          fu,
    ki_nM,

    Vd_L_per_kg:           Vd,
    Vd_assumption:         VdNote,
    F_oral:                F,
    F_assumption:          FNote,
    hepaticCL_mL_min_kg:   CL,
    CL_assumption:         CLNote,
    predictedDose_mg_per_kg: dose_mg_per_kg,
    predictedDose_mg_per_day: dose_mg_per_day,
    doseAssumption,

    margins,
    verdict,
    rationale,
    warnings,
    confidence: "low",
    confidenceNote:
      "First-pass projection from in-vitro QSPR + receptor-occupancy theory. Vd, F, and CL are heuristic estimates — replace with PBPK (PK-Sim / Pumas.jl / mrgsolve) when wired. Not a substitute for clinical pharmacology review.",
  };
}
