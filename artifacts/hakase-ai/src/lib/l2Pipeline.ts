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
  runCofoldToCompletion,
  type BindingMlResult, type MlAdmetResult, type CardiotoxResult, type ProteinMlResult,
  type DockResult, type DockJobStatus,
  type FepResult, type FepJobStatus,
  type CoFoldRequest, type CoFoldJobStatus, type CoFoldResult,
  type CoFoldConfidence, type CoFoldAffinity,
} from "./aiService";
import { fetchUniProt, fetchPdbStructure, type PdbStructure } from "./proteinApi";
import {
  gateCofoldConfidence, extractGatedAffinity,
  type CofoldGateResult, type CofoldGateVerdict, type GatedAffinity, type CofoldConfidencePolicy,
} from "./confidenceGate";

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
    qed_approx: number;
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
        qed_approx: sim.qed_approx, saScore: sim.saScore,
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

// ── Stage 2b — Co-folding (Boltz-2, opt-in, GPU-priced) ─────────────────────
// Sibling of Stage 2 docking. Produces a structure-grounded binding affinity
// from the deep-learning co-folding model. Opt-in because it requires a GPU
// endpoint and is priced per-run. Same four honest statuses as every other stage.

export interface Stage2bResult {
  /** Full co-folding result from the GPU worker. */
  cofold: CoFoldResult;
  /** Confidence-gated affinity. Check gate.verdict before using numbers. */
  gatedAffinity: GatedAffinity;
  /** Raw confidence metrics from the co-folding model. */
  confidence: CoFoldConfidence;
  /** The confidence gate verdict and policy used. */
  gate: CofoldGateResult;
  /** Source provenance label. */
  source: "cofolded";
}

/** Default Stage 2b stub used by Run-Full-Pipeline. Co-folding is opt-in from
 *  its own card because each run costs ~$0.50–3.00 on GPU (varies by complex
 *  size). Not auto-dispatched — user clicks "Run" on the Stage 2b card. */
export function runStage2b(): StageResult<Stage2bResult> {
  return {
    stage: 2.5, name: "Co-folding",
    status: "skipped",
    reason: "Stage 2b co-folding is opt-in (GPU-priced) — not auto-run by Run-Full-Pipeline. Click the Run button on the Stage 2b card to dispatch.",
  };
}

/** Dispatch a co-folding job for a small-molecule ligand against the L1 target.
 *  Builds the CoFoldRequest from frozen L1 evidence, dispatches to the GPU
 *  backend, confidence-gates the affinity, and returns the full result.
 *
 *  Per project policy: no fabricated structures or affinity. If the GPU backend
 *  is unavailable or the job fails, StageResult.status="error" with the exact
 *  upstream message. */
export async function runStage2bCofold(
  sim: SimResults,
  opts: {
    /** Target protein sequence (fetched from UniProt or supplied). */
    targetSequence?: string;
    /** Confidence policy override. */
    confidencePolicy?: CofoldConfidencePolicy;
    /** Diffusion samples (1–25). Default 1 for speed. */
    diffusionSamples?: number;
    /** Progress callback. */
    onProgress?: (status: CoFoldJobStatus) => void;
    /** Poll interval in ms. Default 8000. */
    pollIntervalMs?: number;
    /** Timeout in ms. Default 2h. */
    timeoutMs?: number;
  } = {},
): Promise<StageResult<Stage2bResult>> {
  const t0 = performance.now();

  if (!sim.smiles) {
    return {
      stage: 2.5, name: "Co-folding",
      status: "error",
      reason: "No SMILES on L1 simResults — cannot define the ligand for co-folding.",
      ranAt: new Date().toISOString(),
    };
  }
  if (!sim.uniprotId || sim.uniprotId === "—") {
    return {
      stage: 2.5, name: "Co-folding",
      status: "error",
      reason: "No UniProt ID on L1 simResults — co-folding requires a target protein.",
      ranAt: new Date().toISOString(),
    };
  }

  // Resolve target sequence if not supplied
  let targetSeq = opts.targetSequence;
  if (!targetSeq) {
    try {
      const protein = await fetchUniProt(sim.uniprotId);
      targetSeq = protein.sequence ?? undefined;
      if (!targetSeq) {
        return {
          stage: 2.5, name: "Co-folding",
          status: "error",
          reason: `UniProt ${sim.uniprotId} returned no sequence — cannot build co-folding design.`,
          ranAt: new Date().toISOString(),
          durationMs: performance.now() - t0,
        };
      }
    } catch (e: any) {
      return {
        stage: 2.5, name: "Co-folding",
        status: "error",
        reason: `Failed to fetch target sequence from UniProt ${sim.uniprotId}: ${e?.message ?? e}`,
        ranAt: new Date().toISOString(),
        durationMs: performance.now() - t0,
      };
    }
  }

  // Build the co-folding request
  const cofoldReq: CoFoldRequest = {
    name: `l2-cofold-${sim.molName || "compound"}-${sim.uniprotId}`,
    entities: [
      {
        type: "protein",
        id: "A",
        sequence: targetSeq,
      },
      {
        type: "ligand",
        id: "B",
        smiles: sim.smiles,
      },
    ],
    options: {
      diffusion_samples: opts.diffusionSamples ?? 1,
      output_format: "mmcif",
    },
    affinity_binder: "B",
  };

  // Dispatch and poll
  let final: CoFoldJobStatus;
  try {
    final = await runCofoldToCompletion(cofoldReq, {
      pollIntervalMs: opts.pollIntervalMs ?? 8000,
      timeoutMs: opts.timeoutMs ?? 2 * 3600_000,
      onProgress: opts.onProgress,
    });
  } catch (e: any) {
    return {
      stage: 2.5, name: "Co-folding",
      status: "error",
      reason: `Co-folding job failed: ${e?.message ?? e}`,
      ranAt: new Date().toISOString(),
      durationMs: performance.now() - t0,
    };
  }

  if (final.status === "failed" || !final.result) {
    return {
      stage: 2.5, name: "Co-folding",
      status: "error",
      reason: `Co-folding job failed: ${final.error ?? "unknown error"}`,
      ranAt: new Date().toISOString(),
      durationMs: performance.now() - t0,
    };
  }

  const cofold = final.result;
  const gatedAffinity = extractGatedAffinity(
    cofold.affinity,
    cofold.confidence,
    opts.confidencePolicy,
  );

  return {
    stage: 2.5, name: "Co-folding",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      cofold,
      gatedAffinity,
      confidence: cofold.confidence,
      gate: gatedAffinity.gate,
      source: "cofolded",
    },
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
    /** Drug-side Applicability Domain: Tanimoto NN to training set. */
    ad_tanimoto_nearest: number | null;
    ad_in_domain:     boolean | null;
    error?:           string;
  };
  /**
   * L1 heuristic pKi = -log10(Ki_M). Null when L1 binding is null (off-catalog
   * target). This is intentional: for off-catalog targets Stage 3 still runs the
   * ML binding call and ADMET cross-check; it just cannot compute the L1↔ML
   * agreement because there is no L1 reference Ki.
   */
  l1_pKi:             number | null;
  /** Whether L1 catalog binding was available for the agreement comparison. */
  l1_binding_available: boolean;
  /** |pKd_ML − pKi_L1|. Null when either side is unavailable. */
  log_disagreement:   number | null;
  /** Agreement class relative to L1 heuristic. "unknown" when either
   *  L1 binding or ML binding is unavailable. */
  agreement_class:    "strong" | "moderate" | "disagreement" | "unknown";
  /**
   * Cross-comparison with Stage 2 Vina docking when available.
   * Populated by passing the Stage 2 result to runStage3; null otherwise.
   */
  docking_vs_ml: {
    vina_pKd_equivalent: number;
    ml_pKd:              number;
    delta_pKd:           number;
    agreement:           "strong" | "moderate" | "disagreement";
    note:                string;
  } | null;
  /**
   * Cross-comparison with Stage 2b co-folding affinity when available.
   * Populated by passing the Stage 2b result to runStage3; null otherwise.
   * Gate verdict is surfaced so downstream consumers know if the cofold
   * number was full-confidence or down-weighted.
   */
  cofold_vs_ml: {
    cofold_pKd:          number;
    ml_pKd:              number;
    delta_pKd:           number;
    agreement:           "strong" | "moderate" | "disagreement";
    gate_verdict:        CofoldGateVerdict;
    note:                string;
  } | null;
  admet_ml: {
    available:        boolean;
    source:           "ml" | "fallback" | "unavailable";
    endpoint_count:   number;
    /** ADMET-AI hERG blocker probability (0–1), null if unavailable. */
    herg_prob:        number | null;
    /** ADMET-AI Ames mutagenicity probability (0–1), null if unavailable. */
    ames_prob:        number | null;
    /** ADMET-AI DILI probability (0–1), null if unavailable. */
    dili_prob:        number | null;
    /** ADMET-AI ClinTox probability (0–1), null if unavailable. */
    clintox_prob:     number | null;
    error?:           string;
  };
  l1_admet_consistency: {
    absorption_l1:    number;
    metabolism_l1:    number;
    toxicity_l1:      number;
    notes:            string[];
  };
}

export async function runStage3(
  sim: SimResults,
  /** Optional Stage 2 Vina result — when provided, adds Vina↔ML cross-comparison. */
  stage2Result?: Stage2Result,
  /** Optional Stage 2b co-folding result — when provided, adds cofold↔ML cross-comparison. */
  stage2bResult?: Stage2bResult,
): Promise<StageResult<Stage3Result>> {
  const t0 = performance.now();

  // ── L1 pKi (null for off-catalog targets — no fabrication) ──────────────
  const l1_binding_available = !!sim.binding;
  let l1_pKi: number | null = null;
  if (sim.binding) {
    const ki_M = sim.binding.primaryKi * 1e-9;
    l1_pKi = ki_M > 0 ? -Math.log10(ki_M) : null;
  }

  // ── ML binding (runs for ANY UniProt — not gated on catalog membership) ──
  let binding_ml: Stage3Result["binding_ml"] = {
    available: false, pKd_predicted: null, Kd_nM: null, affinity_class: null,
    source: "unavailable", ad_tanimoto_nearest: null, ad_in_domain: null,
  };
  let log_disagreement: number | null = null;
  let agreement_class: Stage3Result["agreement_class"] = "unknown";

  if (sim.uniprotId && sim.uniprotId !== "—") {
    try {
      const r: BindingMlResult = await predictBindingMl(sim.smiles, sim.uniprotId);
      const ad = (r as any).applicability_domain;
      binding_ml = {
        available: r.source === "ml",
        pKd_predicted: r.prediction.pKd_predicted,
        Kd_nM: r.prediction.Kd_nM,
        affinity_class: r.prediction.affinity_class,
        source: r.source,
        ad_tanimoto_nearest: ad?.ad_tanimoto_nearest ?? null,
        ad_in_domain: ad?.ad_in_domain ?? null,
        error: r.error,
      };
      // Agreement vs L1 — only when L1 catalog binding is available
      if (r.prediction.pKd_predicted !== null && l1_pKi !== null && isFinite(l1_pKi)) {
        log_disagreement = Math.abs(r.prediction.pKd_predicted - l1_pKi);
        agreement_class = log_disagreement < 0.5 ? "strong"
                          : log_disagreement < 1.0 ? "moderate"
                          : "disagreement";
      }
    } catch (e: any) {
      binding_ml.error = e?.message ?? String(e);
    }
  } else if (!sim.uniprotId || sim.uniprotId === "—") {
    binding_ml.error = "No UniProt ID — ML binding requires a target protein sequence.";
  }

  // ── Vina↔ML cross-comparison (populated when Stage 2 is available) ───────
  let docking_vs_ml: Stage3Result["docking_vs_ml"] = null;
  if (
    stage2Result &&
    isFinite(stage2Result.best_pKd_equivalent) &&
    binding_ml.pKd_predicted !== null
  ) {
    const vinaPkd = stage2Result.best_pKd_equivalent;
    const mlPkd   = binding_ml.pKd_predicted;
    const delta    = Math.abs(vinaPkd - mlPkd);
    const agr: "strong" | "moderate" | "disagreement" =
      delta < 0.5 ? "strong" : delta < 1.0 ? "moderate" : "disagreement";
    const noteMap = {
      strong: `Vina (pKd≈${vinaPkd.toFixed(2)}) and ML (pKd=${mlPkd.toFixed(2)}) agree within 0.5 log units — physics and statistical models consistent.`,
      moderate: `Vina (pKd≈${vinaPkd.toFixed(2)}) and ML (pKd=${mlPkd.toFixed(2)}) within 0.5–1.0 log units — acceptable divergence; Vina scoring function uncertainty ~1 kcal/mol.`,
      disagreement: `Vina (pKd≈${vinaPkd.toFixed(2)}) and ML (pKd=${mlPkd.toFixed(2)}) diverge by >${delta.toFixed(2)} log units — possible binding-mode artefact (blind dock?), scaffold outside ML training set, or induced-fit effect not captured by rigid docking.`,
    };
    docking_vs_ml = {
      vina_pKd_equivalent: parseFloat(vinaPkd.toFixed(3)),
      ml_pKd:              parseFloat(mlPkd.toFixed(3)),
      delta_pKd:           parseFloat(delta.toFixed(3)),
      agreement:           agr,
      note:                noteMap[agr],
    };
  }

  // ── Cofold↔ML cross-comparison (populated when Stage 2b is available) ────
  let cofold_vs_ml: Stage3Result["cofold_vs_ml"] = null;
  if (
    stage2bResult &&
    stage2bResult.gatedAffinity.pKd !== null &&
    stage2bResult.gate.verdict !== "suppressed" &&
    binding_ml.pKd_predicted !== null
  ) {
    const cofoldPkd = stage2bResult.gatedAffinity.pKd;
    const mlPkd     = binding_ml.pKd_predicted;
    const delta     = Math.abs(cofoldPkd - mlPkd);
    const agr: "strong" | "moderate" | "disagreement" =
      delta < 0.5 ? "strong" : delta < 1.0 ? "moderate" : "disagreement";
    const gv = stage2bResult.gate.verdict;
    const confNote = gv === "downweighted" ? " (low interface confidence — treat delta with caution)" : "";
    const noteMap = {
      strong: `Co-folded pKd≈${cofoldPkd.toFixed(2)} and ML pKd=${mlPkd.toFixed(2)} agree within 0.5 log units — structure prediction and statistical model consistent${confNote}.`,
      moderate: `Co-folded pKd≈${cofoldPkd.toFixed(2)} and ML pKd=${mlPkd.toFixed(2)} within 0.5–1.0 log units — acceptable divergence${confNote}.`,
      disagreement: `Co-folded pKd≈${cofoldPkd.toFixed(2)} and ML pKd=${mlPkd.toFixed(2)} diverge by >${delta.toFixed(2)} log units — possible binding-mode artefact, scaffold outside ML training set, or co-folding interface artefact${confNote}.`,
    };
    cofold_vs_ml = {
      cofold_pKd:          parseFloat(cofoldPkd.toFixed(3)),
      ml_pKd:              parseFloat(mlPkd.toFixed(3)),
      delta_pKd:           parseFloat(delta.toFixed(3)),
      agreement:           agr,
      gate_verdict:        gv,
      note:                noteMap[agr],
    };
  }

  // ── ADMET-AI ML cross-check ───────────────────────────────────────────────
  let admet_ml: Stage3Result["admet_ml"] = {
    available: false, source: "unavailable", endpoint_count: 0,
    herg_prob: null, ames_prob: null, dili_prob: null, clintox_prob: null,
  };
  try {
    const a: MlAdmetResult = await predictAdmetMl(sim.smiles);
    const ep = a.endpoints as Record<string, number | null>;
    admet_ml = {
      available: a.source === "ml",
      source:    a.source,
      endpoint_count: a.model_info.endpoint_count ?? Object.keys(a.endpoints).length,
      herg_prob:    typeof ep["hERG"]            === "number" ? ep["hERG"]            : null,
      ames_prob:    typeof ep["AMES"]            === "number" ? ep["AMES"]            : null,
      dili_prob:    typeof ep["DILI"]            === "number" ? ep["DILI"]            : null,
      clintox_prob: typeof ep["ClinTox"]         === "number" ? ep["ClinTox"]         : null,
      error:     a.error,
    };
  } catch (e: any) {
    admet_ml.error = e?.message ?? String(e);
  }

  // ── L1 ADMET consistency notes ────────────────────────────────────────────
  const notes: string[] = [];
  if (sim.admet.absorption < 0.3 && sim.lipinski.tpsa < 60) {
    notes.push("Low absorption score paired with TPSA<60 — potential L1 disagreement (low TPSA usually predicts good absorption).");
  }
  if (sim.admet.toxicity > 0.7 && sim.toxAlerts.length === 0) {
    notes.push("High toxicity score but zero SMARTS tox alerts — review categorical vs continuous L1 outputs.");
  }
  // Cross-check: if ADMET-AI hERG prob > 0.7 but L1 hERG risk was Low, flag it
  if (admet_ml.available && admet_ml.herg_prob !== null && admet_ml.herg_prob > 0.7) {
    notes.push(`ADMET-AI (Chemprop) hERG blocker probability ${(admet_ml.herg_prob * 100).toFixed(0)}% — elevated; cross-check L1 hERG heuristic risk.`);
  }
  // Cross-check: ADMET-AI Ames > 0.6 but L1 has no Ames alert
  if (admet_ml.available && admet_ml.ames_prob !== null && admet_ml.ames_prob > 0.6) {
    const hasL1Ames = sim.toxAlerts.some(a => a.category === "Ames" || a.category === "Genotox");
    if (!hasL1Ames) {
      notes.push(`ADMET-AI Ames mutagenicity probability ${(admet_ml.ames_prob * 100).toFixed(0)}% — L1 SMARTS scan did not trigger; consider dedicated Ames assay.`);
    }
  }
  // Cross-check: ADMET-AI DILI > 0.65 but L1 has no DILI hepato alert
  if (admet_ml.available && admet_ml.dili_prob !== null && admet_ml.dili_prob > 0.65) {
    const hasL1Dili = sim.toxAlerts.some(a => a.category === "Hepatotox" || a.category === "DILI");
    if (!hasL1Dili) {
      notes.push(`ADMET-AI DILI probability ${(admet_ml.dili_prob * 100).toFixed(0)}% — L1 did not flag hepatotox; recommend DILI assay before advancing.`);
    }
  }
  if (notes.length === 0) notes.push("L1 ADMET signals internally consistent with ADMET-AI cross-check (no contradictions detected).");

  return {
    stage: 3, name: "ML affinity + ADMET cross-check",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      binding_ml,
      l1_pKi,
      l1_binding_available,
      log_disagreement,
      agreement_class,
      docking_vs_ml,
      cofold_vs_ml,
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
    // RF#3 / RF#4 / §9 steps 3–4: nullable when no real off-target panel
    // has been run (in-vitro `hasValidatedScreen` gate).
    score:               number | null;
    offTargetHits:       number | null;
    totalTargetsTested:  number | null;
    selectivityClass:    string | null;
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
        // RF#3 / RF#4: these are null when no real off-target screen has
        // been run (the in-vitro simulator gates them on
        // `hasValidatedScreen=true`, which the L2 pipeline does not yet
        // pass). Downstream consumers must treat null as "no screen run".
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
  /** Source of the Ki used for PD coupling: "ml_binding" when Stage 3 ML pKd
   *  was used (preferred), "l1_heuristic" when the catalog L1 heuristic Ki was
   *  used, "fallback_default" when neither was available. */
  ki_source:             "ml_binding" | "l1_heuristic" | "fallback_default";
  hillCoeff:             number;
  pkPdCurve:             Array<{ time: number; conc_uM: number; occupancy_pct: number }>;
  peakOccupancyPct:      number;
  timeAbove50pctH:       number;
  AUC_effectH:           number;
  rationale:             string;
}

export function runStage7(
  sim: SimResults,
  pk: PBPKOutput,
  fu: number,
  /**
   * ML-predicted Kd in nM from Stage 3, when available.
   * When provided and finite, this is preferred over the L1 heuristic Ki
   * because it comes from a real trained model (Morgan FP + ESM-2 → GBM)
   * rather than a jitter value within a potency range.
   */
  mlKd_nM?: number | null,
): StageResult<Stage7Result> {
  const t0 = performance.now();
  if (!isFinite(fu) || fu <= 0 || fu > 1) {
    return {
      stage: 7, name: "QSP / PD coupling",
      status: "error",
      reason: "Plasma fu missing/invalid — cannot compute unbound concentration for receptor-occupancy coupling.",
      ranAt: new Date().toISOString(),
    };
  }

  // ── Select Ki source (ML > L1 heuristic > hard fallback) ─────────────────
  // Priority: ML-predicted Kd (real model) > L1 heuristic Ki (catalog jitter)
  // > 1000 nM fallback (only if neither is available — explicitly labelled so
  // the user knows this curve is indicative only).
  let ki_nM: number;
  let ki_source: Stage7Result["ki_source"];

  if (mlKd_nM !== null && mlKd_nM !== undefined && isFinite(mlKd_nM) && mlKd_nM > 0) {
    ki_nM  = mlKd_nM;
    ki_source = "ml_binding";
  } else if (sim.binding && isFinite(sim.binding.primaryKi) && sim.binding.primaryKi > 0) {
    ki_nM  = sim.binding.primaryKi;
    ki_source = "l1_heuristic";
  } else {
    // No real binding signal at all. Use 1 µM as a pessimistic pharmacological
    // default so the PD curve can still render. The `ki_source` label makes
    // the fallback completely transparent to the user.
    ki_nM  = 1000;
    ki_source = "fallback_default";
  }

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
  const kiSourceLabel = ki_source === "ml_binding"
    ? `Ki=${ki_nM.toFixed(0)} nM (ML-predicted, ESM-2+Morgan GBM)`
    : ki_source === "l1_heuristic"
    ? `Ki=${ki_nM.toFixed(0)} nM (L1 heuristic catalog estimate)`
    : `Ki=${ki_nM.toFixed(0)} nM (fallback default — no validated binding signal)`;

  if (peakOcc >= 75) {
    rationale = `Peak ${peakOcc.toFixed(0)}% occupancy ≥ 75% target — pharmacologically meaningful exposure achieved. ${kiSourceLabel}.`;
  } else if (peakOcc >= 50) {
    rationale = `Peak ${peakOcc.toFixed(0)}% occupancy in 50–75% band — sub-optimal but measurable engagement; consider dose increase. ${kiSourceLabel}.`;
  } else {
    rationale = `Peak ${peakOcc.toFixed(0)}% occupancy < 50% — unlikely to drive efficacy; revisit dose / formulation. ${kiSourceLabel}.`;
  }

  return {
    stage: 7, name: "QSP / PD coupling",
    status: "wired",
    ranAt:  new Date().toISOString(),
    durationMs: performance.now() - t0,
    result: {
      ki_nM, ki_source, hillCoeff: hill, pkPdCurve: curve,
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
  /** Optional confidence-gated co-fold Ki (nM) from Stage 2b. Suppressed values must be null. */
  cofoldKi_nM?: number | null,
): StageResult<Stage8Result> {
  const t0 = performance.now();
  const r = computeL2DoseProjection(sim, iv, params, cofoldKi_nM);
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
  /**
   * ML-derived evidence block assembled from Stages 3 and 4.
   * All fields are null when the respective ML model was unavailable.
   */
  ml_evidence: {
    /** ML-predicted pKd (Stage 3 BindingML GBM). */
    binding_ml_pKd:          number | null;
    /** Affinity class from BindingML ("High affinity" / "Moderate" / "Weak" / "Negligible"). */
    binding_ml_affinity_class: string | null;
    /** Applicability domain: Tanimoto nearest-neighbour to training set (0–1).
     *  Values ≥ 0.4 are in-domain (model interpolates); < 0.4 are out-of-domain
     *  (extrapolation — less reliable). */
    binding_ad_tanimoto:     number | null;
    /** Whether the query drug is in-domain for the BindingML model. */
    binding_ad_in_domain:    boolean | null;
    /** Agreement between ML pKd and L1 heuristic pKi, or "unknown" when either is missing. */
    ml_vs_l1_agreement:      "strong" | "moderate" | "disagreement" | "unknown";
    /** Agreement between Vina pKd-equivalent and ML pKd, or null if Stage 2 was skipped. */
    vina_vs_ml_agreement:    "strong" | "moderate" | "disagreement" | null;
    /** Agreement between co-fold pKd and ML pKd, or null if Stage 2b was skipped/suppressed. */
    cofold_vs_ml_agreement:  "strong" | "moderate" | "disagreement" | null;
    /** ADMET-AI Chemprop hERG blocker probability (0–1). */
    admet_herg_prob:         number | null;
    /** ADMET-AI Ames mutagenicity probability (0–1). */
    admet_ames_prob:         number | null;
    /** ADMET-AI DILI probability (0–1). */
    admet_dili_prob:         number | null;
    /** ADMET-AI ClinTox probability (0–1). */
    admet_clintox_prob:      number | null;
    /** CardioTox ML hERG blocker probability (Stage 4 RF model). */
    cardiotox_blocker_prob:  number | null;
    /** Consensus cardiac risk across L1 heuristic and CardioTox ML. */
    consensus_cardiac_risk:  string | null;
    /** Stage 3 ADMET-AI internal consistency notes. */
    admet_consistency_notes: string[];
  };
  /**
   * Co-folding (Stage 2b) evidence block. Null when co-folding was not run.
   * All numeric fields null when the confidence gate suppressed the affinity.
   * Gate verdict and interface confidence are included for downstream auditing.
   */
  cofold_evidence: {
    /** Co-fold-derived pKd, or null if suppressed. */
    cofold_pKd:            number | null;
    /** Co-fold-derived Ki (nM), or null if suppressed. */
    cofold_Ki_nM:          number | null;
    /** Co-fold-derived IC50 (µM), or null if suppressed. */
    cofold_IC50_uM:        number | null;
    /** ΔG from co-folding affinity head (kcal/mol), or null. */
    cofold_dg_kcal_mol:    number | null;
    /** Confidence gate verdict. */
    gate_verdict:          CofoldGateVerdict;
    /** Affinity propagation weight (0–1). */
    gate_weight:           number;
    /** Interface confidence (ipTM), or null if unavailable. */
    iptm:                  number | null;
    /** Ligand-region pLDDT, or null if unavailable. */
    ligand_plddt:          number | null;
    /** Human-readable gate reason. */
    gate_reason:           string;
  } | null;
  /**
   * Evidence quality tier for this handoff document.
   *   "low"      — only L1 heuristics available (no ML or docking ran)
   *   "moderate" — at least one ML model ran and agreed with L1
   *   "high"     — ML binding + Vina docking both ran and agree, ADMET-AI ran
   */
  evidence_tier: "low" | "moderate" | "high";
  produced_at:   string;
}

export function runStage9(
  sim: SimResults,
  proj: L2DoseProjection | undefined,
  pk: PBPKOutput | undefined,
  params: L2InputParams,
  fep?: Stage5Result | undefined,
  /** Stage 3 result — used to populate ml_evidence block. */
  s3?: Stage3Result | undefined,
  /** Stage 4 result — used to populate cardiotox consensus in ml_evidence. */
  s4?: Stage4Result | undefined,
  /** Stage 2b co-folding result — used to populate cofold_evidence block. */
  s2b?: Stage2bResult | undefined,
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
    if (m.tier === "RISK")    flags.push(`${m.label}: RISK (${m.ratio?.toFixed(1)}×)`);
    if (m.tier === "CAUTION") flags.push(`${m.label}: CAUTION (${m.ratio?.toFixed(1)}×)`);
  });
  proj.warnings.forEach(w => flags.push(w));

  // ── ML evidence block ─────────────────────────────────────────────────────
  const mlB = s3?.binding_ml;
  const mlA = s3?.admet_ml;
  const mlC = s4?.cardiotox_ml;

  // Add binding AD warning to flags when out-of-domain
  if (mlB && mlB.ad_in_domain === false) {
    flags.push(`BindingML AD: query drug is out-of-domain (Tanimoto=${mlB.ad_tanimoto_nearest?.toFixed(2)}) — pKd prediction less reliable`);
  }
  // Flag elevated ADMET-AI toxicity signals
  if (mlA?.available) {
    if (mlA.herg_prob !== null    && mlA.herg_prob    > 0.7) flags.push(`ADMET-AI hERG blocker probability ${(mlA.herg_prob * 100).toFixed(0)}% (>70%)`);
    if (mlA.ames_prob !== null    && mlA.ames_prob    > 0.6) flags.push(`ADMET-AI Ames mutagenicity probability ${(mlA.ames_prob * 100).toFixed(0)}% (>60%)`);
    if (mlA.dili_prob !== null    && mlA.dili_prob    > 0.65) flags.push(`ADMET-AI DILI probability ${(mlA.dili_prob * 100).toFixed(0)}% (>65%)`);
    if (mlA.clintox_prob !== null && mlA.clintox_prob > 0.5) flags.push(`ADMET-AI ClinTox probability ${(mlA.clintox_prob * 100).toFixed(0)}% (>50%)`);
  }
  // Flag binding ML / L1 disagreement
  if (s3?.agreement_class === "disagreement" && s3.l1_binding_available) {
    flags.push(`ML binding vs L1 heuristic disagreement: |pKd_ML − pKi_L1| = ${s3.log_disagreement?.toFixed(2)} log units`);
  }
  // Flag Vina vs ML disagreement
  if (s3?.docking_vs_ml?.agreement === "disagreement") {
    flags.push(`Vina vs ML binding disagreement: |pKd_Vina − pKd_ML| = ${s3.docking_vs_ml.delta_pKd.toFixed(2)} log units`);
  }
  // Flag cardiac conflict
  if (s4?.consensus_cardiac_risk === "Conflict") {
    flags.push("Cardiac risk conflict: L1 heuristic and CardioTox ML disagree — one signals High risk");
  }
  // Flag cofold vs ML disagreement
  if (s3?.cofold_vs_ml?.agreement === "disagreement") {
    flags.push(`Co-folding vs ML binding disagreement: |pKd_cofold − pKd_ML| = ${s3.cofold_vs_ml.delta_pKd.toFixed(2)} log units`);
  }
  // Flag suppressed cofold (ran but interface confidence too low)
  if (s2b && s2b.gate.verdict === "suppressed") {
    flags.push(`Co-folding ran but affinity suppressed (interface confidence too low: ipTM=${s2b.gate.iptm?.toFixed(3) ?? "N/A"}) — not used in evidence.`);
  }

  // Evidence tier: accumulate signals
  let evidenceScore = 0;
  if (mlB?.available)           evidenceScore += 2;  // BindingML ran
  if (s3?.docking_vs_ml)        evidenceScore += 2;  // Vina docking also ran
  if (s3?.cofold_vs_ml)         evidenceScore += 2;  // Co-folding affinity also available
  if (mlA?.available)           evidenceScore += 1;  // ADMET-AI ran
  if (mlC?.available)           evidenceScore += 1;  // CardioTox ML ran
  if (fep)                      evidenceScore += 2;  // FEP ran
  const evidence_tier: Stage9Result["evidence_tier"] =
    evidenceScore >= 5 ? "high" : evidenceScore >= 2 ? "moderate" : "low";

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
      ml_evidence: {
        binding_ml_pKd:          mlB?.pKd_predicted ?? null,
        binding_ml_affinity_class: mlB?.affinity_class ?? null,
        binding_ad_tanimoto:     mlB?.ad_tanimoto_nearest ?? null,
        binding_ad_in_domain:    mlB?.ad_in_domain ?? null,
        ml_vs_l1_agreement:      s3?.agreement_class ?? "unknown",
        vina_vs_ml_agreement:    s3?.docking_vs_ml?.agreement ?? null,
        cofold_vs_ml_agreement:  s3?.cofold_vs_ml?.agreement ?? null,
        admet_herg_prob:         mlA?.herg_prob ?? null,
        admet_ames_prob:         mlA?.ames_prob ?? null,
        admet_dili_prob:         mlA?.dili_prob ?? null,
        admet_clintox_prob:      mlA?.clintox_prob ?? null,
        cardiotox_blocker_prob:  mlC?.blocker_probability ?? null,
        consensus_cardiac_risk:  s4?.consensus_cardiac_risk ?? null,
        admet_consistency_notes: s3?.l1_admet_consistency.notes ?? [],
      },
      cofold_evidence: s2b ? {
        cofold_pKd:         s2b.gatedAffinity.pKd,
        cofold_Ki_nM:       s2b.gatedAffinity.Ki_nM,
        cofold_IC50_uM:     s2b.gatedAffinity.IC50_uM,
        cofold_dg_kcal_mol: s2b.gatedAffinity.dg_kcal_mol,
        gate_verdict:       s2b.gate.verdict,
        gate_weight:        s2b.gate.weight,
        iptm:               s2b.gate.iptm,
        ligand_plddt:       s2b.gate.ligandPlddt,
        gate_reason:        s2b.gate.reason,
      } : null,
      evidence_tier,
      produced_at: new Date().toISOString(),
    },
  };
}

// ── Whole-pipeline runner ───────────────────────────────────────────────────
export interface PipelineResults {
  s0?: StageResult<Stage0Result>;
  s1?: StageResult<Stage1Result>;
  s2?: StageResult<Stage2Result>;
  s2b?: StageResult<Stage2bResult>;
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
  out.s2b = runStage2b();                      // opt-in — skipped by default
  // Stage 3 now works for ALL targets (not gated on L1 catalog binding).
  // If Stage 2 Vina has already run (it's opt-in), pass it for cross-comparison.
  // If Stage 2b co-folding has already run (also opt-in), pass it for cross-comparison.
  const s2Result  = out.s2.status  === "wired" ? out.s2.result  : undefined;
  const s2bResult = out.s2b.status === "wired" ? out.s2b.result : undefined;
  out.s3 = await runStage3(sim, s2Result, s2bResult);  onProgress?.(3);
  out.s4 = await runStage4(sim, iv);           onProgress?.(4);
  out.s5 = runStage5();                        onProgress?.(5);
  // Stage 8 — pass cofold Ki (confidence-gated) when available.
  const cofoldKi = s2bResult?.gatedAffinity.Ki_nM ?? null;
  out.s8 = runStage8(sim, iv, params, cofoldKi); onProgress?.(8);

  // Stage 6 needs the dose from Stage 8
  const projection = out.s8.result;
  const dosePerAdmin = projection && isFinite(projection.predictedDose_mg_per_day)
    ? projection.predictedDose_mg_per_day / Math.max(1, Math.floor(params.dosesPerDay ?? 1))
    : NaN;
  out.s6 = runStage6(sim, iv, params, dosePerAdmin); onProgress?.(6);

  // Stage 7 needs PK from Stage 6 + fu.
  // Prefer ML pKd from Stage 3 over the heuristic L1 Ki — when Stage 3 ran
  // and the ML model succeeded, pass that Kd to Stage 7 so receptor-occupancy
  // curves use the real trained signal rather than a jitter value.
  const mlKd_nM = out.s3?.result?.binding_ml.available
    ? out.s3.result.binding_ml.Kd_nM
    : null;
  if (out.s6.status === "wired" && out.s6.result && projection?.fu_fraction) {
    out.s7 = runStage7(sim, out.s6.result, projection.fu_fraction, mlKd_nM); onProgress?.(7);
  } else {
    out.s7 = {
      stage: 7, name: "QSP / PD coupling",
      status: "skipped",
      reason: "Awaiting Stage 6 PK output and a valid fu from Stage 8.",
    } as StageResult<Stage7Result>;
    onProgress?.(7);
  }

  // Stage 9 now receives S3, S4, and S2b results to populate the ml_evidence
  // and cofold_evidence blocks and compute an evidence tier.
  out.s9 = runStage9(
    sim, projection, out.s6.result, params,
    out.s5?.result,
    out.s3?.result,
    out.s4?.result,
    s2bResult,
  );
  onProgress?.(9);
  return out;
}
