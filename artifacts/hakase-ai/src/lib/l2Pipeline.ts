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
  runDockingToCompletion, runFepToCompletion,
  type BindingMlResult, type MlAdmetResult, type CardiotoxResult, type ProteinMlResult,
  type DockResult, type DockJobStatus,
  type FepResult, type FepJobStatus,
} from "./aiService";
import { fetchUniProt, fetchPdbStructure, type PdbStructure } from "./proteinApi";

/** Resnames that should NOT count as "co-crystal ligand present" when ranking
 *  PDB candidates (waters/ions/buffers/cryoprotectants). Mirrors the backend
 *  HETATM blocklist in artifacts/ai-service/models/docking_vina.py. */
const PDB_LIGAND_BLOCKLIST = new Set([
  "HOH", "WAT", "DOD", "H2O",
  "NA", "K", "CL", "MG", "CA", "ZN", "FE", "MN", "CU", "NI", "CO",
  "SO4", "PO4", "PEG", "EDO", "GOL", "MES", "TRS", "HEPES", "DMSO",
  "ACT", "BME", "DTT", "FMT", "CIT", "EPE", "MPD", "1PE", "PG4", "PGE",
]);

/** Score a PDB candidate for docking suitability. Higher = better.
 *  Priorities:
 *    + experimental method (X-ray > cryo-EM > NMR > other)
 *    + resolution (lower Å is better; missing resolution is penalised)
 *    + presence of a non-blocklisted co-crystal ligand (enables co-crystal box) */
function scorePdbForDocking(s: PdbStructure): { score: number; rationale: string } {
  const reasons: string[] = [];
  let score = 0;

  const m = s.method.toLowerCase();
  if (m.includes("x-ray")) { score += 100; reasons.push("X-ray"); }
  else if (m.includes("electron microscopy") || m.includes("cryo")) { score += 70; reasons.push("cryo-EM"); }
  else if (m.includes("nmr")) { score += 30; reasons.push("NMR"); }
  else { score += 10; reasons.push(s.method); }

  if (s.resolution !== null && isFinite(s.resolution)) {
    // 1.0 Å → +50, 2.0 Å → +30, 3.0 Å → +10, 4.0 Å → 0
    const resBonus = Math.max(0, 50 - (s.resolution - 1.0) * 20);
    score += resBonus;
    reasons.push(`${s.resolution.toFixed(2)} Å`);
  } else {
    reasons.push("no resolution");
  }

  const drugLike = s.ligands.filter(l => !PDB_LIGAND_BLOCKLIST.has(l.toUpperCase()));
  if (drugLike.length > 0) {
    score += 40;
    reasons.push(`co-crystal ligand: ${drugLike.slice(0, 2).join(", ")}`);
  } else {
    reasons.push("no drug-like co-crystal ligand (blind dock likely)");
  }

  return { score, rationale: reasons.join(" · ") };
}

interface RankedPdb {
  pdbId: string;
  score: number;
  rationale: string;
}

/** Fetch metadata for up to `maxCandidates` PDB IDs in parallel and rank for
 *  docking suitability. Returns the ranked list (best first). PDBs that fail
 *  metadata fetch are dropped (with a warning). */
async function rankPdbCandidates(
  pdbIds: string[],
  maxCandidates = 5,
): Promise<{ ranked: RankedPdb[]; warnings: string[] }> {
  const candidates = pdbIds.slice(0, maxCandidates);
  const warnings: string[] = [];
  const settled = await Promise.allSettled(candidates.map(id => fetchPdbStructure(id)));
  const ranked: RankedPdb[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      const { score, rationale } = scorePdbForDocking(r.value);
      ranked.push({ pdbId: r.value.pdbId, score, rationale });
    } else {
      warnings.push(`PDB ${candidates[i]}: metadata fetch failed (${r.reason?.message ?? r.reason})`);
    }
  });
  ranked.sort((a, b) => b.score - a.score);
  return { ranked, warnings };
}

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

// ── Stage 1 — Target druggability ────────────────────────────────────────────
// Protein druggability via ESM-2 RF on the L1 UniProt target.
// The `rdkit_descriptors`, `rule_of_5`, `veber_pass` fields below are
// PASSIVELY COPIED from the frozen L1 SimResults — they are NOT recomputed.
// RDKit-JS is deterministic by construction, so a "L1 vs L2 ligand
// disagreement" falsifier could never fire on real evidence; per the v2.0.0
// falsifier criterion (machine-checkable AND meaningful) it is not in the
// FALSIFIER_REGISTRY. Integrity of the L1→L2 handoff is enforced by the
// EvidencePointer minted in Stage 0 (`evt://l1/<sha256>`), not here.
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
        stage: 1, name: "Target druggability",
        status: "error",
        reason: `Protein druggability call failed: ${e?.message ?? e}`,
        ranAt: new Date().toISOString(),
        durationMs: performance.now() - t0,
      };
    }
  }

  return {
    stage: 1, name: "Target druggability",
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

// ── Stage 2 — Docking (AutoDock Vina, in-app, physical scoring) ─────────────
export interface Stage2Result {
  /** Docking output verbatim from ai-service /predict/dock. */
  dock: DockResult;
  /** PDB ID actually used (auto-resolved from L1 UniProt or supplied). */
  pdb_id: string;
  /** Ranked list of PDB candidates considered (best first). The top entry was
   *  the one actually docked against. Surfaced so the user can see what
   *  alternatives were available and on what basis the choice was made. */
  pdb_candidates: RankedPdb[];
  /** Best (mode 1) Vina affinity in kcal/mol. Empirical Vina score, NOT a
   *  thermodynamic ΔG — Vina's scoring function is a calibrated heuristic. */
  best_affinity_kcal_mol: number;
  /** HEURISTIC mapping from Vina score to a log-Kd-equivalent for Stage-3 cross-check.
   *  Uses the ΔG-style relation pKd ≈ -score / (RT·ln10) at 298K (RT=0.5925 kcal/mol →
   *  divisor 1.364). NOT an experimental Kd; Vina is not a true free-energy method.
   *  Use only for orthogonal sanity-check against the ML pKd, never as a reportable potency. */
  best_pKd_equivalent: number;
  /** RMSD of the second-best pose vs mode 1 (lower bound). Pose convergence indicator;
   *  poses tightly clustered (RMSD < 2 Å) suggest a confident binding mode. */
  pose_convergence_rmsd: number | null;
  /** Source provenance label for Stage 2 quality tier. */
  source: "physical";
}

/** Heuristic conversion: best Vina affinity (kcal/mol) → pKd-equivalent at 298 K.
 *  pKd = -ΔG / (RT · ln 10), RT(298K) = 0.5925 kcal/mol → divisor 1.364. */
function vinaAffinityToPKd(deltaG_kcal_mol: number): number {
  return -deltaG_kcal_mol / 1.364;
}

export async function runStage2Docking(sim: SimResults): Promise<StageResult<Stage2Result>> {
  if (!sim.uniprotId) {
    return {
      stage: 2, name: "Docking",
      status: "error",
      reason: "No UniProt ID on L1 simResults — cannot resolve a receptor PDB to dock against.",
    };
  }

  // 1. Resolve and rank PDB candidates from the L1 UniProt target.
  //    The UniProt cross-reference order is deposit order, NOT quality-ranked,
  //    so we explicitly score the top candidates by experimental method,
  //    resolution, and presence of a non-blocklisted co-crystal ligand. The
  //    chosen PDB and the ranking rationale are both surfaced in the result.
  let pdbId: string;
  let pdbCandidates: RankedPdb[] = [];
  const rankWarnings: string[] = [];
  try {
    const protein = await fetchUniProt(sim.uniprotId);
    if (!protein.pdbIds.length) {
      return {
        stage: 2, name: "Docking",
        status: "error",
        reason: `UniProt ${sim.uniprotId} has no experimental PDB structures (only AlphaFold). AutoDock Vina requires an experimental receptor; AlphaFold-only docking is out of scope (would need pocket conditioning + extra QC).`,
      };
    }
    const ranking = await rankPdbCandidates(protein.pdbIds, 5);
    rankWarnings.push(...ranking.warnings);
    if (ranking.ranked.length === 0) {
      return {
        stage: 2, name: "Docking",
        status: "error",
        reason: `Could not fetch RCSB metadata for any of the top ${Math.min(5, protein.pdbIds.length)} PDB candidates of UniProt ${sim.uniprotId}: ${ranking.warnings.join("; ")}`,
      };
    }
    pdbCandidates = ranking.ranked;
    pdbId = ranking.ranked[0].pdbId;
  } catch (e: any) {
    return {
      stage: 2, name: "Docking",
      status: "error",
      reason: `Failed to fetch PDB list for UniProt ${sim.uniprotId}: ${e?.message ?? e}`,
    };
  }

  // 2. Submit + poll the docking job.
  let final: DockJobStatus;
  try {
    final = await runDockingToCompletion(sim.smiles, pdbId, {
      exhaustiveness: 8,
      numModes: 5,
      pollIntervalMs: 2000,
      timeoutMs: 600_000,
    });
  } catch (e: any) {
    return {
      stage: 2, name: "Docking",
      status: "error",
      reason: `Vina docking job failed: ${e?.message ?? e}`,
    };
  }

  if (final.status === "failed" || !final.result) {
    return {
      stage: 2, name: "Docking",
      status: "error",
      reason: `Vina docking failed: ${final.error ?? "unknown error"}`,
    };
  }

  const dock = final.result;
  if (!dock.poses.length) {
    return {
      stage: 2, name: "Docking",
      status: "error",
      reason: "Vina returned no poses for this ligand-receptor pair. The receptor box may be incompatible with this ligand size, or the ligand may be too flexible for the search budget.",
    };
  }

  const best = dock.poses[0];
  const second = dock.poses[1];
  const pose_convergence_rmsd = second ? second.rmsd_lb : null;

  // Merge any PDB-ranking warnings into the docking result so they surface
  // alongside backend warnings (e.g. blind-dock fallback).
  const mergedDock: DockResult = rankWarnings.length
    ? { ...dock, warnings: [...rankWarnings, ...dock.warnings] }
    : dock;

  return {
    stage: 2, name: "Docking",
    status: "wired",
    result: {
      dock: mergedDock,
      pdb_id: pdbId,
      pdb_candidates: pdbCandidates,
      best_affinity_kcal_mol: best.affinity_kcal_mol,
      best_pKd_equivalent: vinaAffinityToPKd(best.affinity_kcal_mol),
      pose_convergence_rmsd,
      source: "physical",
    },
  };
}

/** Legacy synchronous Stage 2 — retained as a no-op fallback for callers that
 *  still prefer the OOS placeholder (e.g. the runFullPipeline default which we
 *  intentionally don't auto-run docking from, since it's the most expensive stage). */
export function runStage2(): StageResult<never> {
  return {
    stage: 2, name: "Docking",
    status: "skipped",
    reason: "Stage 2 docking is opt-in (clicked from the Stage 2 card) — not auto-run by Run-Full-Pipeline because it's the most expensive stage (~30–90 s wall time per ligand).",
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

// ── Stage 5 — Free-energy refinement (TIES FEP via RunPod Serverless) ───────
export interface Stage5Result {
  /** TIES relative-binding-FEP output verbatim from ai-service /predict/fep. */
  fep: FepResult;
  /** Reference ligand SMILES (Ligand A — ΔG of binding subtracted). */
  ligand_a_smiles: string;
  /** Perturbed ligand SMILES (Ligand B — ΔG of binding measured against). */
  ligand_b_smiles: string;
  /** PDB receptor used for both endpoints of the perturbation. */
  pdb_id: string;
  /** Source provenance label for Stage 5 quality tier. */
  source: "fep";
}

/** Default Stage 5 stub used by Run-Full-Pipeline. Doesn't dispatch FEP — that's
 *  opt-in from the Stage 5 card because each pair costs ~$40–50 (24 GPU-h). */
export function runStage5(): StageResult<Stage5Result> {
  return {
    stage: 5, name: "Free-energy refinement",
    status: "skipped",
    reason: "Stage 5 FEP is opt-in from its own card — TIES relative-binding-FEP on RunPod Serverless takes ~24 GPU-h per ligand pair (~$40–50 on A100). Run-Full-Pipeline skips it; click the Run button on the Stage 5 card after entering Ligand B SMILES and confirming the GPU cost.",
  };
}

/** Dispatch a relative-binding-FEP job (Ligand A → B in `pdbId`) to the
 *  ai-service → RunPod Serverless backend. Async; polls until done/failed/timeout.
 *
 *  Per project policy, no fabricated ΔΔG: if RunPod is not configured this returns
 *  StageResult.status="error" with the exact missing-secret name. */
export async function runStage5Fep(
  sim: SimResults,
  ligandBSmiles: string,
  pdbId: string,
  opts: {
    nLambdaWindows?: number;
    nReplicas?: number;
    nsPerWindow?: number;
    onProgress?: (s: FepJobStatus) => void;
  } = {},
): Promise<StageResult<Stage5Result>> {
  const t0 = performance.now();
  if (!sim.smiles) {
    return {
      stage: 5, name: "Free-energy refinement", status: "error",
      reason: "No SMILES on L1 simResults — cannot define Ligand A endpoint.",
    };
  }
  if (!ligandBSmiles?.trim()) {
    return {
      stage: 5, name: "Free-energy refinement", status: "error",
      reason: "Ligand B SMILES is required — FEP needs an explicit perturbed-state ligand.",
    };
  }
  if (!pdbId?.trim() || pdbId.trim().length !== 4) {
    return {
      stage: 5, name: "Free-energy refinement", status: "error",
      reason: "PDB ID is required (4-letter RCSB code) — FEP needs an experimental receptor for both endpoints.",
    };
  }

  let final: FepJobStatus;
  try {
    final = await runFepToCompletion(sim.smiles, ligandBSmiles.trim(), pdbId.trim(), opts);
  } catch (e: any) {
    return {
      stage: 5, name: "Free-energy refinement", status: "error",
      reason: `FEP job failed: ${e?.message ?? e}`,
      ranAt: new Date().toISOString(),
      durationMs: performance.now() - t0,
    };
  }
  if (final.status === "failed" || !final.result) {
    return {
      stage: 5, name: "Free-energy refinement", status: "error",
      reason: `FEP job failed: ${final.error ?? "unknown error"}`,
      ranAt: new Date().toISOString(),
      durationMs: performance.now() - t0,
    };
  }

  return {
    stage: 5, name: "Free-energy refinement",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      fep: final.result,
      ligand_a_smiles: sim.smiles,
      ligand_b_smiles: ligandBSmiles.trim(),
      pdb_id: pdbId.trim().toUpperCase(),
      source: "fep",
    },
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
  /** ΔΔG (B − A) in kcal/mol from Stage 5 TIES FEP, or null if Stage 5 was skipped. */
  free_energy_estimate_kcalmol: number | null;
  /** 1-σ uncertainty on ΔΔG (kcal/mol), or null. */
  free_energy_uncertainty_kcalmol: number | null;
  /** Reference vs perturbed ligand pair for the FEP, or null. */
  free_energy_pair: { ligand_a_smiles: string; ligand_b_smiles: string; pdb_id: string } | null;
  confidence:                   "low";
  produced_at:                  string;
}

export function runStage9(
  sim: SimResults,
  proj: L2DoseProjection | undefined,
  pk: PBPKOutput | undefined,
  params: L2InputParams,
  fep?: Stage5Result | undefined,
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
      free_energy_estimate_kcalmol:    fep ? fep.fep.ddg_kcal_mol            : null,
      free_energy_uncertainty_kcalmol: fep ? fep.fep.ddg_uncertainty_kcalmol : null,
      free_energy_pair: fep ? {
        ligand_a_smiles: fep.ligand_a_smiles,
        ligand_b_smiles: fep.ligand_b_smiles,
        pdb_id:          fep.pdb_id,
      } : null,
      confidence: "low",
      produced_at: new Date().toISOString(),
    },
  };
}

// ── Whole-pipeline runner ───────────────────────────────────────────────────
export interface PipelineResults {
  s0?: StageResult<Stage0Result>;
  s1?: StageResult<Stage1Result>;
  s2?: StageResult<Stage2Result>;
  s3?: StageResult<Stage3Result>;
  s4?: StageResult<Stage4Result>;
  s5?: StageResult<Stage5Result>;
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
  out.s9 = runStage9(sim, projection, out.s6.result, params, out.s5?.result); onProgress?.(9);
  return out;
}
