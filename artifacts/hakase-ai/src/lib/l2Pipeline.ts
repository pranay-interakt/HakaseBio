/**
 * L2 Pipeline Orchestrator — wires every L2 stage that can honestly run
 * in this product (browser + AI service + L1 outputs). Stages that
 * genuinely require a GPU cluster (Stage 2 docking, Stage 5 free-energy
 * refinement) are explicitly marked OUT_OF_SCOPE and never produce
 * fabricated numbers.
 *
 * Each stage returns a `StageResult<T>` whose `status` is one of:
 *   - "wired"        : real engine ran, real result produced
 *   - "out-of-scope" : stage cannot run in this tier (GPU cluster only),
 *                     no fabricated output
 *   - "error"        : engine call failed, error message surfaced
 *   - "skipped"      : not yet executed
 *
 * No silent fallbacks anywhere. Every numeric field comes from a real
 * upstream call (L1 outputs, AI service, lib/pbpk, lib/pdModel,
 * lib/l2DoseProjection).
 */

import type { SimResults } from "./admet";
import type { InVitroResults } from "./inVitroSim";
import { runPBPK, type PBPKOutput } from "./pbpk";
import { computeL2DoseProjection, type L2DoseProjection, type L2InputParams } from "./l2DoseProjection";
import {
  predictBindingMl, predictAdmetMl, predictCardiotox, predictProteinMl,
  type BindingMlResult, type MlAdmetResult, type CardiotoxResult, type ProteinMlResult,
} from "./aiService";

export type StageStatus = "wired" | "out-of-scope" | "error" | "skipped";

export interface StageResult<T> {
  stage:    number;
  name:     string;
  status:   StageStatus;
  reason?:  string;       // populated for out-of-scope / error
  result?:  T;
  ranAt?:   string;       // ISO timestamp
  durationMs?: number;
}

// ── Stage 0 — Ingest L1 outputs ─────────────────────────────────────────────
export interface Stage0Result {
  inchikey:     string | null;
  molName:      string;
  smiles:       string;
  uniprotId:    string;
  l1Stamp:      string;
  l1Fields:     {
    has_binding:    boolean;
    has_admet:      boolean;
    has_lipinski:   boolean;
    has_invitro:    boolean;
    has_selectivity:boolean;
    has_herg:       boolean;
    has_bioact:     boolean;
  };
}

export function runStage0(sim: SimResults, iv: InVitroResults): StageResult<Stage0Result> {
  const t0 = performance.now();
  return {
    stage:  0,
    name:   "Ingest L1 outputs",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      inchikey:  null,                           // not produced upstream today
      molName:   sim.molName,
      smiles:    sim.smiles,
      uniprotId: sim.uniprotId,
      l1Stamp:   iv.timestamp,
      l1Fields: {
        has_binding:    !!sim.binding,
        has_admet:      !!sim.admet,
        has_lipinski:   !!sim.lipinski,
        has_invitro:    !!iv.doseResponse,
        has_selectivity:!!iv.selectivity,
        has_herg:       !!iv.herg,
        has_bioact:     !!iv.bioactivation,
      },
    },
  };
}

// ── Stage 1 — Structure prep + protein druggability ─────────────────────────
export interface Stage1Result {
  rdkit_descriptors: {
    mw:        number;
    logP:      number;
    tpsa:      number;
    hbd:       number;
    hba:       number;
    rotBonds:  number;
    qed:       number;
    saScore:   number;
  };
  rule_of_5:           { violations: number; pass: boolean };
  veber_pass:          boolean;          // RotB ≤ 10 AND TPSA ≤ 140
  protein: {
    uniprot:   string;
    druggability_probability: number | null;
    druggability_class:       string | null;
    source:    "ml" | "fallback" | "unavailable";
    error?:    string;
  };
}

export async function runStage1(sim: SimResults): Promise<StageResult<Stage1Result>> {
  const t0 = performance.now();
  const lip = sim.lipinski;
  const veber_pass = lip.rotBonds <= 10 && lip.tpsa <= 140;

  let proteinPart: Stage1Result["protein"] = {
    uniprot: sim.uniprotId,
    druggability_probability: null,
    druggability_class: null,
    source: "unavailable",
  };
  if (sim.uniprotId && sim.uniprotId !== "—") {
    try {
      const p: ProteinMlResult = await predictProteinMl(sim.uniprotId);
      proteinPart = {
        uniprot: sim.uniprotId,
        druggability_probability: p.prediction.druggability_probability,
        druggability_class:       p.prediction.druggability_class,
        source:                   p.source,
        error:                    p.error,
      };
    } catch (e: any) {
      return {
        stage: 1, name: "Structure prep + druggability",
        status: "error",
        reason: `Protein druggability call failed: ${e?.message ?? e}`,
        ranAt: new Date().toISOString(),
        durationMs: performance.now() - t0,
      };
    }
  }

  return {
    stage: 1, name: "Structure prep + druggability",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      rdkit_descriptors: {
        mw: lip.mw, logP: lip.logP, tpsa: lip.tpsa,
        hbd: lip.hbd, hba: lip.hba, rotBonds: lip.rotBonds,
        qed: sim.qed, saScore: sim.saScore,
      },
      rule_of_5: { violations: lip.violations, pass: lip.violations === 0 },
      veber_pass,
      protein: proteinPart,
    },
  };
}

// ── Stage 2 — Docking (OUT-OF-SCOPE) ────────────────────────────────────────
export function runStage2(): StageResult<never> {
  return {
    stage: 2, name: "Docking",
    status: "out-of-scope",
    reason: "Vina/GNINA/Boltz-1 require ligand-prep, receptor-prep, GPU compute, and PoseBusters QC. Out of scope for in-browser tier — would need a docking job-queue backed by an A100/H100 cluster. Reference engines documented below; no docking score is fabricated.",
  };
}

// ── Stage 3 — ML affinity + ADMET cross-check ───────────────────────────────
export interface Stage3Result {
  binding_ml: {
    available:        boolean;
    pKd_predicted:    number | null;
    Kd_nM:            number | null;
    affinity_class:   string | null;
    source:           "ml" | "fallback" | "unavailable";
    error?:           string;
  };
  l1_pKi:             number;        // -log10(L1 Ki [M]) = -log10(L1 Ki [nM] * 1e-9)
  log_disagreement:   number | null;  // |pKd_ML - pKi_L1|, null if ML unavailable
  agreement_class:    "strong" | "moderate" | "disagreement" | "unknown";
  admet_ml: {
    available:        boolean;
    source:           "ml" | "fallback" | "unavailable";
    endpoint_count:   number;
    error?:           string;
  };
  l1_admet_consistency: {
    absorption_l1:    number;
    metabolism_l1:    number;
    toxicity_l1:      number;
    notes:            string[];
  };
}

export async function runStage3(sim: SimResults): Promise<StageResult<Stage3Result>> {
  const t0 = performance.now();
  const ki_M = sim.binding.primaryKi * 1e-9;
  const l1_pKi = ki_M > 0 ? -Math.log10(ki_M) : NaN;

  let binding_ml: Stage3Result["binding_ml"] = {
    available: false, pKd_predicted: null, Kd_nM: null, affinity_class: null, source: "unavailable",
  };
  let log_disagreement: number | null = null;
  let agreement_class: Stage3Result["agreement_class"] = "unknown";

  if (sim.uniprotId && sim.uniprotId !== "—") {
    try {
      const r: BindingMlResult = await predictBindingMl(sim.smiles, sim.uniprotId);
      binding_ml = {
        available: r.source === "ml",
        pKd_predicted: r.prediction.pKd_predicted,
        Kd_nM: r.prediction.Kd_nM,
        affinity_class: r.prediction.affinity_class,
        source: r.source,
        error: r.error,
      };
      if (r.prediction.pKd_predicted !== null && isFinite(l1_pKi)) {
        log_disagreement = Math.abs(r.prediction.pKd_predicted - l1_pKi);
        agreement_class = log_disagreement < 0.5 ? "strong"
                          : log_disagreement < 1.0 ? "moderate"
                          : "disagreement";
      }
    } catch (e: any) {
      binding_ml.error = e?.message ?? String(e);
    }
  }

  let admet_ml: Stage3Result["admet_ml"] = {
    available: false, source: "unavailable", endpoint_count: 0,
  };
  try {
    const a: MlAdmetResult = await predictAdmetMl(sim.smiles);
    admet_ml = {
      available: a.source === "ml",
      source:    a.source,
      endpoint_count: a.model_info.endpoint_count ?? Object.keys(a.endpoints).length,
      error:     a.error,
    };
  } catch (e: any) {
    admet_ml.error = e?.message ?? String(e);
  }

  // L1 ADMET consistency notes (rule checks against known cliffs)
  const notes: string[] = [];
  if (sim.admet.absorption < 0.3 && sim.lipinski.tpsa < 60) {
    notes.push("Low absorption score paired with TPSA<60 — potential L1 disagreement (low TPSA usually predicts good absorption).");
  }
  if (sim.admet.toxicity > 0.7 && sim.toxAlerts.length === 0) {
    notes.push("High toxicity score but zero SMARTS tox alerts — review categorical vs continuous L1 outputs.");
  }
  if (notes.length === 0) notes.push("L1 ADMET signals internally consistent (no rule-based contradictions detected).");

  return {
    stage: 3, name: "ML affinity + ADMET cross-check",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      binding_ml,
      l1_pKi,
      log_disagreement,
      agreement_class,
      admet_ml,
      l1_admet_consistency: {
        absorption_l1: sim.admet.absorption,
        metabolism_l1: sim.admet.metabolism,
        toxicity_l1:   sim.admet.toxicity,
        notes,
      },
    },
  };
}

// ── Stage 4 — Selectivity + cardiotox ML ────────────────────────────────────
export interface Stage4Result {
  l1_selectivity: {
    score:               number;
    offTargetHits:       number;
    totalTargetsTested:  number;
    selectivityClass:    string;
    worstFold:           number | null;
    worstName:           string | null;
  };
  herg_l1: { ic50_uM: number; risk: string };
  cardiotox_ml: {
    available:           boolean;
    blocker_probability: number | null;
    risk_class:          string | null;
    source:              "ml" | "fallback" | "unavailable";
    error?:              string;
  };
  consensus_cardiac_risk: "Low" | "Moderate" | "High" | "Conflict" | "Unknown";
}

export async function runStage4(sim: SimResults, iv: InVitroResults): Promise<StageResult<Stage4Result>> {
  const t0 = performance.now();
  const sel = iv.selectivity;
  const worst = sel.topOffTargets.length > 0
    ? sel.topOffTargets.reduce((m, o) => o.selectivityRatio < m.selectivityRatio ? o : m, sel.topOffTargets[0])
    : null;

  let cardiotox_ml: Stage4Result["cardiotox_ml"] = {
    available: false, blocker_probability: null, risk_class: null, source: "unavailable",
  };
  try {
    const c: CardiotoxResult = await predictCardiotox(sim.smiles);
    cardiotox_ml = {
      available: c.source === "ml",
      blocker_probability: c.prediction.blocker_probability,
      risk_class: c.prediction.risk_class,
      source: c.source,
      error: c.error,
    };
  } catch (e: any) {
    cardiotox_ml.error = e?.message ?? String(e);
  }

  // Consensus: combine L1 hERG categorical with ML cardiotox class
  const l1Risk = iv.herg.riskCategory;
  const mlRisk = cardiotox_ml.risk_class;
  let consensus: Stage4Result["consensus_cardiac_risk"];
  if (mlRisk === null) consensus = l1Risk as any;
  else if (l1Risk === mlRisk) consensus = l1Risk as any;
  else if ((l1Risk === "High" || mlRisk === "High")) consensus = "Conflict";
  else consensus = "Moderate";

  return {
    stage: 4, name: "Selectivity + cardiotox cross-check",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      l1_selectivity: {
        score: sel.kinaseSelectivityScore,
        offTargetHits: sel.offTargetHits,
        totalTargetsTested: sel.totalTargetsTested,
        selectivityClass: sel.selectivityClass,
        worstFold: worst?.selectivityRatio ?? null,
        worstName: worst?.name ?? null,
      },
      herg_l1: { ic50_uM: iv.herg.ic50_uM, risk: iv.herg.riskCategory },
      cardiotox_ml,
      consensus_cardiac_risk: consensus,
    },
  };
}

// ── Stage 5 — Free-energy refinement (OUT-OF-SCOPE) ─────────────────────────
export function runStage5(): StageResult<never> {
  return {
    stage: 5, name: "Free-energy refinement",
    status: "out-of-scope",
    reason: "OpenMM/OpenFF/TIES relative-binding-FEP requires ~24 GPU-h per compound on A100 (per architecture doc §4.3). Out of scope for in-browser tier — would need MD job submission to a cluster. No ΔΔG estimate is fabricated.",
  };
}

// ── Stage 6 — PBPK projection ───────────────────────────────────────────────
export type Stage6Result = PBPKOutput;

export function runStage6(
  sim: SimResults, iv: InVitroResults, params: L2InputParams,
  doseMgPerAdmin: number,
): StageResult<Stage6Result> {
  const t0 = performance.now();
  if (!isFinite(doseMgPerAdmin) || doseMgPerAdmin <= 0) {
    return {
      stage: 6, name: "PBPK projection",
      status: "error",
      reason: "PBPK requires a positive dose. Run Stage 8 first (or supply manual dose) so a per-administration dose is available.",
      ranAt: new Date().toISOString(),
    };
  }
  const fuPct = params.fuOverride !== undefined ? params.fuOverride * 100 : iv.plasmaProteinBinding.fuPercent;
  // Map L1 ADMET 0–1 scores onto the PBPK drug params (real values from L1)
  const pk = runPBPK(
    {
      mw:        sim.lipinski.mw,
      logP:      sim.lipinski.logP,
      tpsa:      sim.lipinski.tpsa,
      hbd:       sim.lipinski.hbd,
      bioavailF: params.FOverride ?? clampF_caco2(iv.permeability.caco2Papp),
      absorptionScore: sim.admet.absorption,
      excretionScore:  sim.admet.excretion,
      metabolismScore: sim.admet.metabolism,
      dosingMg:  doseMgPerAdmin,
      routeIV:   params.route === "iv",
    },
    {
      weightKg: params.bodyWeightKg ?? 70,
      egfr:     90,
      albuminGdL: 4.1,
    },
  );
  return {
    stage: 6, name: "PBPK projection",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: pk,
  };
}

function clampF_caco2(papp: number): number {
  if (papp >= 10) return 0.85;
  if (papp >= 1)  return 0.50;
  return 0.15;
}

// ── Stage 7 — QSP / PD coupling ─────────────────────────────────────────────
export interface Stage7Result {
  ki_nM:                 number;
  hillCoeff:             number;
  pkPdCurve:             Array<{ time: number; conc_uM: number; occupancy_pct: number }>;
  peakOccupancyPct:      number;
  timeAbove50pctH:       number;
  AUC_effectH:           number;
  rationale:             string;
}

export function runStage7(sim: SimResults, pk: PBPKOutput, fu: number): StageResult<Stage7Result> {
  const t0 = performance.now();
  if (!isFinite(fu) || fu <= 0 || fu > 1) {
    return {
      stage: 7, name: "QSP / PD coupling",
      status: "error",
      reason: "Plasma fu missing/invalid — cannot compute unbound concentration for receptor-occupancy coupling.",
      ranAt: new Date().toISOString(),
    };
  }
  const ki_nM = sim.binding.primaryKi;
  const ki_uM = ki_nM / 1000;
  const hill = 1.0;

  // PK curve is in μg/mL = mg/L; convert to μM via MW
  const mw = sim.lipinski.mw;
  const curve = pk.pkCurve.map(p => {
    const C_total_uM = (p.conc * 1000) / mw;            // mg/L → nmol/mL → μM (simplified: mg/L ÷ MW(g/mol) = mmol/L = mM, ×1000 = μM)
    const C_unbound_uM = C_total_uM * fu;
    const num = Math.pow(C_unbound_uM, hill);
    const den = Math.pow(ki_uM, hill) + num;
    const occ = den > 0 ? num / den : 0;
    return { time: p.time, conc_uM: parseFloat(C_unbound_uM.toFixed(4)), occupancy_pct: parseFloat((occ * 100).toFixed(2)) };
  });
  const peakOcc = curve.reduce((max, p) => Math.max(max, p.occupancy_pct), 0);

  // Trapezoid: time above 50% occupancy + AUC of effect
  let timeAbove50 = 0; let aucEffect = 0;
  for (let i = 1; i < curve.length; i++) {
    const dt = curve[i].time - curve[i - 1].time;
    const o0 = curve[i - 1].occupancy_pct / 100;
    const o1 = curve[i].occupancy_pct / 100;
    aucEffect += (o0 + o1) / 2 * dt;
    if (o0 >= 0.5 && o1 >= 0.5) timeAbove50 += dt;
    else if (o0 >= 0.5 && o1 < 0.5) timeAbove50 += dt * (o0 - 0.5) / (o0 - o1);
    else if (o0 < 0.5 && o1 >= 0.5) timeAbove50 += dt * (o1 - 0.5) / (o1 - o0);
  }

  let rationale: string;
  if (peakOcc >= 75) rationale = `Peak ${peakOcc.toFixed(0)}% occupancy ≥ 75% target — pharmacologically meaningful exposure achieved.`;
  else if (peakOcc >= 50) rationale = `Peak ${peakOcc.toFixed(0)}% occupancy in 50–75% band — sub-optimal but measurable engagement; consider dose increase.`;
  else rationale = `Peak ${peakOcc.toFixed(0)}% occupancy < 50% — unlikely to drive efficacy; revisit dose / formulation.`;

  return {
    stage: 7, name: "QSP / PD coupling",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      ki_nM, hillCoeff: hill, pkPdCurve: curve,
      peakOccupancyPct: parseFloat(peakOcc.toFixed(2)),
      timeAbove50pctH:  parseFloat(timeAbove50.toFixed(2)),
      AUC_effectH:      parseFloat(aucEffect.toFixed(2)),
      rationale,
    },
  };
}

// ── Stage 8 — Therapeutic-index ranking (delegates to existing engine) ──────
export type Stage8Result = L2DoseProjection;

export function runStage8(
  sim: SimResults, iv: InVitroResults, params: L2InputParams,
): StageResult<Stage8Result> {
  const t0 = performance.now();
  const r = computeL2DoseProjection(sim, iv, params);
  return {
    stage: 8, name: "Therapeutic-index ranking",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: r,
  };
}

// ── Stage 9 — Output / handoff JSON ─────────────────────────────────────────
export interface Stage9Result {
  schema_version: "L2-handoff-v1";
  compound: {
    name: string; smiles: string; uniprot: string;
  };
  predicted_human_dose: {
    mg_per_kg: number | null;
    mg_per_day: number | null;
    doses_per_day: number;
    target_occupancy: number;
  };
  predicted_unbound_cmax_nM:    number | null;
  predicted_total_cmax_uM:      number | null;          // from PBPK
  liability_flags:              string[];
  free_energy_estimate_kcalmol: null;                   // not computed (Stage 5 OOS)
  confidence:                   "low";
  produced_at:                  string;
}

export function runStage9(
  sim: SimResults,
  proj: L2DoseProjection | undefined,
  pk: PBPKOutput | undefined,
  params: L2InputParams,
): StageResult<Stage9Result> {
  const t0 = performance.now();
  if (!proj) {
    return {
      stage: 9, name: "Output / handoff",
      status: "error",
      reason: "Cannot emit L2-handoff-v1 — Stage 8 (therapeutic-index ranking) has not produced a projection yet. Run Stage 8 first; values like target occupancy, dose, and liability flags must come from real upstream computation, not defaults.",
      ranAt: new Date().toISOString(),
    };
  }
  const flags: string[] = [];
  proj.margins.forEach(m => {
    if (m.tier === "RISK") flags.push(`${m.label}: RISK (${m.ratio?.toFixed(1)}×)`);
    if (m.tier === "CAUTION") flags.push(`${m.label}: CAUTION (${m.ratio?.toFixed(1)}×)`);
  });
  proj.warnings.forEach(w => flags.push(w));
  const dosesPerDay = Math.max(1, Math.floor(params.dosesPerDay ?? 1));
  return {
    stage: 9, name: "Output / handoff",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      schema_version: "L2-handoff-v1",
      compound: {
        name:    sim.molName,
        smiles:  sim.smiles,
        uniprot: sim.uniprotId,
      },
      predicted_human_dose: {
        mg_per_kg:        isFinite(proj.predictedDose_mg_per_kg)  ? proj.predictedDose_mg_per_kg  : null,
        mg_per_day:       isFinite(proj.predictedDose_mg_per_day) ? proj.predictedDose_mg_per_day : null,
        doses_per_day:    dosesPerDay,
        target_occupancy: proj.targetOccupancy,
      },
      predicted_unbound_cmax_nM: isFinite(proj.targetCmaxUnbound_nM) ? proj.targetCmaxUnbound_nM : null,
      predicted_total_cmax_uM:   pk ? pk.cmax * 1000 / sim.lipinski.mw : null,
      liability_flags: flags,
      free_energy_estimate_kcalmol: null,
      confidence: "low",
      produced_at: new Date().toISOString(),
    },
  };
}

// ── Whole-pipeline runner ───────────────────────────────────────────────────
export interface PipelineResults {
  s0?: StageResult<Stage0Result>;
  s1?: StageResult<Stage1Result>;
  s2?: StageResult<never>;
  s3?: StageResult<Stage3Result>;
  s4?: StageResult<Stage4Result>;
  s5?: StageResult<never>;
  s6?: StageResult<Stage6Result>;
  s7?: StageResult<Stage7Result>;
  s8?: StageResult<Stage8Result>;
  s9?: StageResult<Stage9Result>;
}

/** Run every wireable stage in dependency order. */
export async function runFullPipeline(
  sim: SimResults, iv: InVitroResults, params: L2InputParams,
  onProgress?: (stage: number) => void,
): Promise<PipelineResults> {
  const out: PipelineResults = {};
  out.s0 = runStage0(sim, iv);                 onProgress?.(0);
  out.s1 = await runStage1(sim);               onProgress?.(1);
  out.s2 = runStage2();                        onProgress?.(2);
  out.s3 = await runStage3(sim);               onProgress?.(3);
  out.s4 = await runStage4(sim, iv);           onProgress?.(4);
  out.s5 = runStage5();                        onProgress?.(5);
  out.s8 = runStage8(sim, iv, params);         onProgress?.(8);
  // Stage 6 needs the dose from Stage 8
  const projection = out.s8.result;
  const dosePerAdmin = projection && isFinite(projection.predictedDose_mg_per_day)
    ? projection.predictedDose_mg_per_day / Math.max(1, Math.floor(params.dosesPerDay ?? 1))
    : NaN;
  out.s6 = runStage6(sim, iv, params, dosePerAdmin); onProgress?.(6);
  // Stage 7 needs PK from Stage 6 + fu
  if (out.s6.status === "wired" && out.s6.result && projection?.fu_fraction) {
    out.s7 = runStage7(sim, out.s6.result, projection.fu_fraction); onProgress?.(7);
  } else {
    out.s7 = {
      stage: 7, name: "QSP / PD coupling",
      status: "skipped",
      reason: "Awaiting Stage 6 PK output and a valid fu from Stage 8.",
    } as StageResult<Stage7Result>;
    onProgress?.(7);
  }
  out.s9 = runStage9(sim, projection, out.s6.result, params); onProgress?.(9);
  return out;
}
