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

// ── Receptor-occupancy default (Stage 8) ────────────────────────────────────
const DEFAULT_TARGET_OCCUPANCY = 0.75;           // 75% — common pre-clinical target

// ── Safety-margin tier cutoffs (FDA cardiac safety convention) ──────────────
const MARGIN_SAFE_THRESHOLD     = 30;
const MARGIN_CAUTION_THRESHOLD  = 10;

// ── User-tunable inputs for Stage 8 ─────────────────────────────────────────
export interface L2InputParams {
  /** Target receptor occupancy (0–1). Default 0.75. */
  targetOccupancy?: number;
  /** Body weight in kg. Default 70. */
  bodyWeightKg?: number;
  /** Dosing route. Affects oral F. Default "oral". */
  route?: "oral" | "iv";
  /** Doses per day (1=QD, 2=BID, 3=TID). Default 1. */
  dosesPerDay?: number;
  /** Override fu (0–1) — bypass L1 plasma protein binding. */
  fuOverride?: number;
  /** Override Vd in L/kg — bypass logP-binned proxy. */
  VdOverride?: number;
  /** Override F (0–1) — bypass Caco-2 → F bins. */
  FOverride?: number;
  /** Override hepatic CL in mL/min/kg — bypass well-stirred liver model. */
  CLOverride?: number;

  // ── IVIVE wet-lab inputs (P0 — cross-species foundation) ────────────────
  // These are *measured* values the biotech brings from their CRO. When
  // supplied, they replace the corresponding L1/heuristic value AND are
  // recorded in the projection's assumption strings for evidence trail.
  // null/undefined means "not measured" — the engine falls back to L1.

  /** Human fu_mic — applies Obach 1999 correction to microsomal CL_int. */
  fuMicHuman?: number;
  /** Human B/P ratio — used to convert plasma CL to blood CL. */
  bpRatioHuman?: number;
}

const DEFAULTS: Required<Omit<L2InputParams, "fuOverride" | "VdOverride" | "FOverride" | "CLOverride" | "fuMicHuman" | "bpRatioHuman">> = {
  targetOccupancy: DEFAULT_TARGET_OCCUPANCY,
  bodyWeightKg:    HUMAN_BODY_WEIGHT_KG,
  route:           "oral",
  dosesPerDay:     1,
};

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
  /** Where the Ki used for receptor-occupancy came from. */
  ki_source:              "l1_catalog" | "cofolded" | "user_override";

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

/**
 * Hepatic CL from microsomal CLint via well-stirred liver model.
 * Optional fu_mic correction (Obach 1999) and B/P conversion (plasma → blood
 * CL) are applied when the IVIVE wet-lab inputs supply them — otherwise the
 * legacy heuristic path is preserved.
 */
function scaleHepaticCL(
  microsomalCLint_uL_min_mg: number,
  fu: number,
  opts: { fuMic?: number; bpRatio?: number } = {},
): { CL: number; assumption: string } {
  // Optional fu_mic correction: CLint_corrected = CLint / fu_mic
  const fuMicValid = typeof opts.fuMic === "number" && isFinite(opts.fuMic) && opts.fuMic > 0 && opts.fuMic <= 1;
  const CLintRaw = microsomalCLint_uL_min_mg;
  const CLintForScale = fuMicValid ? CLintRaw / (opts.fuMic as number) : CLintRaw;

  // Scale microsomal CLint to whole-liver in vivo (mL/min/kg)
  const CLintScaled =
    (CLintForScale / 1000) *               // µL/min/mg → mL/min/mg
    MPPGL *                                // × mg microsomal protein / g liver
    LIVER_WEIGHT_G_PER_KG;                 // × g liver / kg body weight

  // Well-stirred model (plasma CL)
  const Qh = HUMAN_HEPATIC_BLOOD_FLOW_ML_MIN_KG;
  const CL_plasma = (Qh * fu * CLintScaled) / (Qh + fu * CLintScaled);

  // Optional B/P conversion: plasma CL → blood CL
  const bpValid = typeof opts.bpRatio === "number" && isFinite(opts.bpRatio) && opts.bpRatio > 0 && opts.bpRatio <= 10;
  const CL = bpValid ? CL_plasma / (opts.bpRatio as number) : CL_plasma;

  const fuMicNote = fuMicValid ? `, fu_mic=${(opts.fuMic as number).toFixed(2)} (Obach 1999 correction applied)` : "";
  const bpNote    = bpValid    ? `, B/P=${(opts.bpRatio as number).toFixed(2)} (plasma CL → blood CL)` : "";

  return {
    CL,
    assumption: `Well-stirred liver model: CLint(microsomal) ${CLintRaw.toFixed(0)} µL/min/mg → in-vivo CL ${CL.toFixed(1)} mL/min/kg (MPPGL=45, liver=25.7 g/kg, Q_h=20 mL/min/kg, fu=${fu.toFixed(2)}${fuMicNote}${bpNote}).`,
  };
}

/** Clamp a value to [0, 1]. */
function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
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
  params: L2InputParams = {},
  /**
   * Optional co-fold-derived Ki (nM) from Stage 2b.
   * Used as a fallback when L1 catalog binding is unavailable (off-catalog
   * target), or as a cross-reference source when L1 binding exists.
   * Callers must confidence-gate this value BEFORE passing it here —
   * suppressed cofold affinities should be passed as null.
   */
  cofoldKi_nM?: number | null,
): L2DoseProjection {

  // ── Resolve input params (with defaults) ──────────────────────────────────
  const occupancy   = clamp01(params.targetOccupancy ?? DEFAULTS.targetOccupancy);
  const bodyWeight  = isFinite(params.bodyWeightKg as number) && (params.bodyWeightKg as number) > 0
                      ? (params.bodyWeightKg as number) : DEFAULTS.bodyWeightKg;
  const route       = params.route ?? DEFAULTS.route;
  const dosesPerDay = Math.max(1, Math.floor(params.dosesPerDay ?? DEFAULTS.dosesPerDay));
  const kiMultiplier = occupancy / Math.max(1e-6, 1 - occupancy);

  // ── Resolve Ki: L1 catalog → co-folded fallback → refuse ─────────────────
  // Priority: L1 experimental/catalog Ki > co-fold-derived Ki > error.
  // Dose projection without ANY Ki is not meaningful — refuse explicitly.
  let ki_nM: number;
  let ki_source: "l1_catalog" | "cofolded" | "user_override";
  if (sim.binding) {
    ki_nM    = sim.binding.primaryKi;
    ki_source = "l1_catalog";
  } else if (
    cofoldKi_nM !== null && cofoldKi_nM !== undefined &&
    isFinite(cofoldKi_nM) && cofoldKi_nM > 0
  ) {
    ki_nM    = cofoldKi_nM;
    ki_source = "cofolded";
  } else {
    throw new Error(
      "L2 dose projection requires a Ki estimate. " +
      "L1 returned binding=null (target not in validated catalog) and " +
      "no confidence-gated co-fold Ki was available — pick a curated target, " +
      "wire ML binding, or run co-folding before attempting dose projection.",
    );
  }
  const mw       = sim.lipinski.mw;
  const logP     = sim.lipinski.logP;
  const fuPct    = iv.plasmaProteinBinding.fuPercent;
  const hergUM   = iv.herg.ic50_uM;
  const cyp3a4   = iv.metabolicStability.cypInhibition.CYP3A4.ic50_uM;
  const cc50_uM  = iv.cellViability.cc50_uM;
  const caco2    = iv.permeability.caco2Papp;
  const clint    = iv.metabolicStability.microsomalCLint;

  // ── Override validity helpers (explicit, no silent fallback) ──────────────
  // For each override: undefined = "not supplied" (use L1/model). Any *supplied*
  // value that fails validation is surfaced as an explicit warning so the user
  // sees their typo instead of silently getting the L1 value back.
  const overrideWarnings: string[] = [];
  const supplied = (v: number | undefined): boolean => v !== undefined && !Number.isNaN(v);

  const fuOverrideSupplied = supplied(params.fuOverride);
  const fuOverrideValid    = fuOverrideSupplied
                              && isFinite(params.fuOverride as number)
                              && (params.fuOverride as number) > 0
                              && (params.fuOverride as number) <= 1;
  if (fuOverrideSupplied && !fuOverrideValid) {
    overrideWarnings.push(`fu override ${params.fuOverride} rejected — must be in (0, 1]. Falling back to L1 plasma fu.`);
  }
  const fuFromL1 = isFinite(fuPct) && fuPct > 0 && fuPct <= 100 ? fuPct / 100 : NaN;
  const fu       = fuOverrideValid ? (params.fuOverride as number) : fuFromL1;
  const fuValid  = isFinite(fu) && fu > 0 && fu <= 1;
  const fuSource = fuOverrideValid ? "user override" : "L1 plasma protein binding";
  const fuWarning = fuValid
    ? null
    : `Plasma fu unavailable (L1 reports fuPercent=${fuPct}; no valid override). Cmax,total and dose projection cannot be computed without a valid fu — margins below use Cmax,unbound only.`;

  // ── Receptor-occupancy target (Hill slope 1, user-tunable occupancy) ──────
  const targetCmaxUnbound_nM = kiMultiplier * ki_nM;
  const targetCmaxTotal_nM   = fuValid ? targetCmaxUnbound_nM / fu : NaN;

  // ── PK estimation: override > model ───────────────────────────────────────
  const VdOverrideSupplied = supplied(params.VdOverride);
  const VdOverrideValid    = VdOverrideSupplied
                              && isFinite(params.VdOverride as number)
                              && (params.VdOverride as number) > 0
                              && (params.VdOverride as number) <= 100;
  if (VdOverrideSupplied && !VdOverrideValid) {
    overrideWarnings.push(`Vd override ${params.VdOverride} L/kg rejected — must be in (0, 100]. Falling back to logP-binned proxy.`);
  }
  const VdEstimated = estimateVd(logP);
  const Vd     = VdOverrideValid ? (params.VdOverride as number) : VdEstimated.Vd;
  const VdNote = VdOverrideValid
                 ? `Vd ${Vd.toFixed(2)} L/kg — user override (logP-binned proxy would have suggested ${VdEstimated.Vd} L/kg).`
                 : VdEstimated.assumption;

  const FOverrideSupplied = supplied(params.FOverride);
  const FOverrideValid    = FOverrideSupplied
                              && isFinite(params.FOverride as number)
                              && (params.FOverride as number) > 0
                              && (params.FOverride as number) <= 1;
  if (FOverrideSupplied && !FOverrideValid && route !== "iv") {
    overrideWarnings.push(`F override ${params.FOverride} rejected — must be in (0, 1]. Falling back to Caco-2 → F bin.`);
  }
  const FEstimated = estimateF(caco2);
  const F = route === "iv" ? 1.0
            : (FOverrideValid ? (params.FOverride as number) : FEstimated.F);
  const FNote = route === "iv"
                ? `IV route — F = 1.0 by definition.`
                : (FOverrideValid
                  ? `F ${F.toFixed(2)} — user override (Caco-2 → F bins would have suggested ${FEstimated.F.toFixed(2)}).`
                  : FEstimated.assumption);

  const CLOverrideSupplied = supplied(params.CLOverride);
  const CLOverrideValid    = CLOverrideSupplied
                              && isFinite(params.CLOverride as number)
                              && (params.CLOverride as number) > 0
                              && (params.CLOverride as number) <= 1000;
  if (CLOverrideSupplied && !CLOverrideValid) {
    overrideWarnings.push(`CL override ${params.CLOverride} mL/min/kg rejected — must be in (0, 1000]. Falling back to well-stirred liver model.`);
  }
  let CL: number; let CLNote: string;
  if (CLOverrideValid) {
    CL = params.CLOverride as number;
    CLNote = `Hepatic CL ${CL.toFixed(1)} mL/min/kg — user override (well-stirred liver model bypassed).`;
  } else if (fuValid) {
    // Validate IVIVE wet-lab inputs (passed only when supplied; otherwise the
    // legacy heuristic path is preserved with no synthetic defaults).
    const fuMicSupplied = supplied(params.fuMicHuman);
    const fuMicValid = fuMicSupplied && (params.fuMicHuman as number) > 0 && (params.fuMicHuman as number) <= 1;
    if (fuMicSupplied && !fuMicValid) {
      overrideWarnings.push(`fu_mic ${params.fuMicHuman} rejected — must be in (0, 1]. Microsomal binding correction not applied.`);
    }
    const bpSupplied = supplied(params.bpRatioHuman);
    const bpValid = bpSupplied && (params.bpRatioHuman as number) > 0 && (params.bpRatioHuman as number) <= 10;
    if (bpSupplied && !bpValid) {
      overrideWarnings.push(`B/P ${params.bpRatioHuman} rejected — must be in (0, 10]. Plasma-to-blood CL conversion not applied.`);
    }
    const r = scaleHepaticCL(clint, fu, {
      fuMic:   fuMicValid ? (params.fuMicHuman as number)   : undefined,
      bpRatio: bpValid    ? (params.bpRatioHuman as number) : undefined,
    });
    CL = r.CL; CLNote = r.assumption;
  } else {
    CL = NaN;
    CLNote = `Hepatic CL not computed — invalid plasma fu (fuPercent=${fuPct}); well-stirred liver model requires fu and no valid override given.`;
  }

  // ── Required oral dose for target Cmax,total per administration ───────────
  // Dose per administration = Cmax,total × Vd × MW / F (μM·L/kg → mg/kg)
  // Daily dose = (per-administration dose) × dosesPerDay
  const dose_per_admin_mg_per_kg = fuValid
    ? (targetCmaxTotal_nM * Vd * mw) / (F * 1e6)
    : NaN;
  const dose_mg_per_kg  = fuValid ? dose_per_admin_mg_per_kg * dosesPerDay : NaN;
  const dose_mg_per_day = fuValid ? dose_mg_per_kg * bodyWeight : NaN;

  const freqLabel = dosesPerDay === 1 ? "QD" : dosesPerDay === 2 ? "BID" : dosesPerDay === 3 ? "TID" : `${dosesPerDay}×/day`;
  const doseAssumption = fuValid
    ? `Per-admin Cmax = Dose × F / Vd. ` +
      `Dose/admin(mg/kg) = Cmax,total(${targetCmaxTotal_nM.toFixed(1)} nM) × Vd(${Vd.toFixed(2)} L/kg) × MW(${mw.toFixed(0)}) / F(${F.toFixed(2)}) / 10⁶. ` +
      `Daily dose = ${dose_per_admin_mg_per_kg.toFixed(3)} mg/kg × ${dosesPerDay} (${freqLabel}) × ${bodyWeight} kg = ${dose_mg_per_day.toFixed(1)} mg/day. ` +
      `Ignores accumulation beyond simple multiplication, gut first-pass, formulation. First-pass projection only.`
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
  // Surface any rejected user overrides (typo guard, no silent fallback)
  overrideWarnings.forEach(w => warnings.push(w));

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
      `Predicted starting human dose ≈ ${dose_mg_per_day.toFixed(1)} mg/day (${freqLabel}) for ${bodyWeight}-kg adult ` +
      `to reach ${(occupancy * 100).toFixed(0)}% receptor occupancy ` +
      `(Cmax,u ≈ ${targetCmaxUnbound_nM.toFixed(1)} nM = ${kiMultiplier.toFixed(2)}× Ki). ` +
      `fu source: ${fuSource}.`,
    );
  } else {
    rationale.push(
      `Required Cmax,unbound ≈ ${targetCmaxUnbound_nM.toFixed(1)} nM = ${kiMultiplier.toFixed(2)}× Ki ` +
      `for ${(occupancy * 100).toFixed(0)}% receptor occupancy. ` +
      `Dose projection withheld — invalid plasma fu.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    l1Stamp:     iv.timestamp,
    molName:     sim.molName,
    smiles:      sim.smiles,
    uniprotId:   sim.uniprotId,

    targetOccupancy:      occupancy,
    targetCmaxUnbound_nM,
    targetCmaxTotal_nM,
    fu_fraction:          fu,
    ki_nM,
    ki_source,

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
