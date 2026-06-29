/**
 * biologicL2.ts — Modality-aware Layer 2 (Confirmation) engine for biologics.
 *
 * The original L2 pipeline (`l2Pipeline.ts` + `Layer2InSilicoScaffold`) is
 * built around small-molecule `SimResults` — RDKit descriptors, Vina docking,
 * 2-compartment PBPK, FEP. None of that is meaningful for a peptide or an
 * antibody. This module is the biologics-native counterpart: it consumes the
 * Layer-1 `PeptideResult` / `AntibodyResult` and runs the subset of L2
 * confirmation that is scientifically valid for biologics.
 *
 * Honesty contract (identical to the small-molecule pipeline):
 *   - Never fabricate a structure, an affinity or a PK number. Anything that
 *     cannot be computed honestly returns an explicit out-of-scope / pending
 *     status with a reason.
 *   - Every numeric output carries a provenance tier.
 *   - Co-folding affinity is always confidence-gated (confidenceGate.ts) before
 *     it is allowed to influence a verdict.
 *
 * Stage map (biologic L2):
 *   S0 — Ingest L1 evidence            (in-house, deterministic)
 *   S1 — Target-engagement co-folding  (Boltz-2, opt-in GPU)
 *   S2 — Binding confirmation          (confidence-gated affinity / ipTM proxy)
 *   S3 — Modality PK projection        (peptide class-based / antibody TMDD-FcRn)
 *   S4 — Exposure & therapeutic index  (dosing-frequency + TI readiness)
 *   S5 — Immunogenicity & safety       (ADA risk, aggregation, off-target)
 *   S6 — Confirmation falsifiers       (per-modality wet-lab criteria registry)
 *   S7 — Handoff summary               (L2 verdict + what L3 must measure)
 */

import type {
  PeptideResult,
  AntibodyResult,
  CoFoldRequest,
  CoFoldResult,
} from "./aiService";
import { runCofoldToCompletion } from "./aiService";
import {
  extractGatedAffinity,
  type GatedAffinity,
} from "./confidenceGate";

// ── Shared types ────────────────────────────────────────────────────────────

export type BiologicModality = "peptide" | "antibody";

export type ProvenanceTier =
  | "experimental"
  | "enriched"
  | "ml"
  | "structural"
  | "cofolded"
  | "heuristic"
  | "unavailable";

export type BioStageStatus = "idle" | "wired" | "out-of-scope" | "error" | "skipped";

export interface BioStageResult<T> {
  stage:   number;
  name:    string;
  status:  BioStageStatus;
  result?: T;
  reason?: string;
}

/** Loose-input bundle shared by every stage. */
export interface BiologicL2Input {
  modality:        BiologicModality;
  peptide?:        PeptideResult | null;
  antibody?:       AntibodyResult | null;
  /** Co-folding design sequences. */
  peptideSequence?: string;
  peptideCyclic?:   boolean;
  antibodyHeavy?:   string;
  antibodyLight?:   string;
  /** Target (peptide) or antigen (antibody) sequence — required for S1. */
  targetSequence?:  string;
  targetLabel?:     string;
}

/** User-tunable L2 parameters (left-panel input card). */
export interface BiologicL2Params {
  /** Desired steady-state target occupancy (drives dosing math in S4). */
  targetOccupancy: number;
  /** Route of administration. */
  route: "iv" | "sc" | "im" | "oral";
  /** Body weight (kg) for exposure scaling. */
  bodyWeightKg: number;
  /** Co-folding: request the Boltz-2 affinity head (peptide binders only). */
  requestAffinity: boolean;
  /** Co-folding: explicit GPU-cost acknowledgement before dispatch. */
  gpuCostAck: boolean;
}

export function defaultBiologicL2Params(): BiologicL2Params {
  return {
    targetOccupancy: 0.80,
    route: "sc",
    bodyWeightKg: 70,
    requestAffinity: true,
    gpuCostAck: false,
  };
}

const AA_RE = /^[ACDEFGHIKLMNPQRSTVWYX]+$/;
const cleanSeq = (s: string | undefined): string =>
  (s ?? "").toUpperCase().replace(/[^A-Z]/g, "");

// ════════════════════════════════════════════════════════════════════════════
// Stage 0 — Ingest L1 evidence
// ════════════════════════════════════════════════════════════════════════════

export interface BioStage0 {
  modality:           BiologicModality;
  designLabel:        string;
  developabilityTier: string;
  goNoGo:             "GO" | "WATCH" | "NO-GO";
  l1Verdict:          string;
  keyLiabilities:     string[];
  evidenceFields:     { label: string; value: string; source: string }[];
}

/** Peptide go/no-go derived from L1 — conservative, no fabrication. */
function peptideGoNoGo(p: PeptideResult): "GO" | "WATCH" | "NO-GO" {
  const unstable  = p.physicochemical.instability_class === "Unstable";
  const highAgg   = p.developability.aggregation_risk === "High";
  const manySites = p.proteolytic_stability.sites.length > 5;
  if (highAgg && unstable) return "NO-GO";
  if (manySites && unstable) return "NO-GO";
  if (!unstable && !highAgg && p.proteolytic_stability.sites.length <= 2) return "GO";
  return "WATCH";
}

function antibodyGoNoGo(a: AntibodyResult): "GO" | "WATCH" | "NO-GO" {
  const v = a.summary.verdict.toUpperCase();
  if (v.startsWith("FAIL") || a.summary.n_liabilities_high >= 3) return "NO-GO";
  if (v.startsWith("PASS") && a.summary.n_liabilities_high === 0) return "GO";
  return "WATCH";
}

export function runBioStage0(input: BiologicL2Input): BioStageResult<BioStage0> {
  const { modality } = input;

  if (modality === "peptide") {
    const p = input.peptide;
    if (!p) {
      return { stage: 0, name: "Ingest L1 evidence", status: "error",
        reason: "No peptide Layer-1 result available. Run the Layer-1 peptide analysis first." };
    }
    const pc = p.physicochemical;
    const liabilities: string[] = [];
    if (pc.instability_class === "Unstable")
      liabilities.push(`Instability index ${pc.instability_index.toFixed(1)} > 40 (Guruprasad)`);
    if (p.proteolytic_stability.sites.length > 3)
      liabilities.push(`${p.proteolytic_stability.sites.length} predicted protease cleavage sites`);
    if (p.developability.aggregation_risk !== "Low")
      liabilities.push(`Aggregation risk: ${p.developability.aggregation_risk}`);
    if (p.membrane_permeability.membrane_permeability_score < 35)
      liabilities.push("Low predicted membrane permeability");

    return {
      stage: 0, name: "Ingest L1 evidence", status: "wired",
      result: {
        modality, designLabel: `${pc.sequence_length}-mer ${p.cyclic ? "cyclic" : "linear"} peptide`,
        developabilityTier: p.developability.recommended_route,
        goNoGo: peptideGoNoGo(p),
        l1Verdict: pc.instability_class === "Stable" ? "Stable / developable" : "Stability concern flagged at L1",
        keyLiabilities: liabilities,
        evidenceFields: [
          { label: "MW",                value: `${pc.molecular_weight_da.toFixed(1)} Da`, source: "L1 / peptide engine" },
          { label: "Net charge (pH 7.4)", value: pc.net_charge_pH7.toFixed(1),            source: "Henderson-Hasselbalch" },
          { label: "Instability index", value: `${pc.instability_index.toFixed(1)} (${pc.instability_class})`, source: "Guruprasad" },
          { label: "Protease sites",    value: String(p.proteolytic_stability.sites.length), source: "L1 protease scan" },
          { label: "Permeability score", value: p.membrane_permeability.membrane_permeability_score.toFixed(0), source: "L1 permeability model" },
          { label: "Recommended route", value: p.developability.recommended_route,        source: "L1 developability" },
        ],
      },
    };
  }

  // antibody
  const a = input.antibody;
  if (!a) {
    return { stage: 0, name: "Ingest L1 evidence", status: "error",
      reason: "No antibody Layer-1 result available. Run the Layer-1 antibody analysis first." };
  }
  const liabilities: string[] = [];
  if (a.summary.n_liabilities_high > 0)
    liabilities.push(`${a.summary.n_liabilities_high} high-severity CDR/sequence liabilit${a.summary.n_liabilities_high === 1 ? "y" : "ies"}`);
  if (a.summary.aggregation_risk && !/^0 /.test(a.summary.aggregation_risk))
    liabilities.push(`Aggregation hot spots (L1 scan): ${a.summary.aggregation_risk}`);
  if (/review|fail/i.test(a.summary.developability_tier))
    liabilities.push(`Developability tier: ${a.summary.developability_tier}`);

  return {
    stage: 0, name: "Ingest L1 evidence", status: "wired",
    result: {
      modality, designLabel: `${a.inferred_format} · ${a.chains.length} chain${a.chains.length === 1 ? "" : "s"}`,
      developabilityTier: a.summary.developability_tier,
      goNoGo: antibodyGoNoGo(a),
      l1Verdict: a.summary.verdict,
      keyLiabilities: liabilities,
      evidenceFields: [
        { label: "Format",             value: a.inferred_format,                          source: "L1 / antibody engine" },
        { label: "Developability tier", value: a.summary.developability_tier,             source: "L1 TAP-style flags" },
        { label: "Aggregation (L1 scan)", value: a.summary.aggregation_risk,               source: "L1 AGGRESCAN — graded in L2" },
        { label: "High liabilities",   value: String(a.summary.n_liabilities_high),       source: "L1 CDR liability scan" },
        { label: "Total liabilities",  value: String(a.summary.n_liabilities_total),      source: "L1 CDR liability scan" },
      ],
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Stage 1 — Target-engagement co-folding (Boltz-2, opt-in GPU)
// ════════════════════════════════════════════════════════════════════════════

export interface BioStage1 {
  cofold:          CoFoldResult;
  iptm:            number | null;
  complexPlddt:    number | null;
  interfaceClass:  "high" | "moderate" | "low";
  affinityRequested: boolean;
}

/** Build a Boltz-2 co-folding request for a biologic–target complex. */
export function buildBiologicCofoldRequest(
  input: BiologicL2Input,
  params: BiologicL2Params,
): { ok: true; req: CoFoldRequest } | { ok: false; reason: string } {
  const target = cleanSeq(input.targetSequence);
  if (target.length < 20 || !AA_RE.test(target)) {
    return { ok: false, reason: "A valid target/antigen protein sequence (≥20 residues, one-letter codes) is required to co-fold the complex." };
  }

  if (input.modality === "peptide") {
    const pep = cleanSeq(input.peptideSequence);
    if (pep.length < 2 || !AA_RE.test(pep)) {
      return { ok: false, reason: "Peptide sequence missing or invalid — cannot build the co-folding design." };
    }
    return {
      ok: true,
      req: {
        name: `l2-peptide-cofold-${input.targetLabel || "target"}`,
        entities: [
          { type: "protein", id: "A", sequence: target, use_msa: true },
          { type: "peptide", id: "B", sequence: pep, cyclic: !!input.peptideCyclic },
        ],
        affinity_binder: params.requestAffinity ? "B" : null,
        options: { output_format: "mmcif", use_msa_server: true },
      },
    };
  }

  // antibody — antigen + heavy (+ optional light)
  const heavy = cleanSeq(input.antibodyHeavy);
  const light = cleanSeq(input.antibodyLight);
  if (heavy.length < 70 || !AA_RE.test(heavy)) {
    return { ok: false, reason: "Antibody heavy/VHH chain missing or invalid — cannot build the co-folding design." };
  }
  const entities: CoFoldRequest["entities"] = [
    { type: "protein", id: "A", sequence: target, use_msa: true },
    { type: "protein", id: "H", sequence: heavy, use_msa: true },
  ];
  if (light.length >= 70 && AA_RE.test(light)) {
    entities.push({ type: "protein", id: "L", sequence: light, use_msa: true });
  }
  return {
    ok: true,
    req: {
      name: `l2-antibody-cofold-${input.targetLabel || "antigen"}`,
      // Boltz-2's affinity head is trained mostly on protein–small-molecule and
      // protein–peptide data; for antibody–antigen we rely on ipTM as the
      // binding-confidence proxy and do NOT request a (mis-calibrated) affinity.
      affinity_binder: null,
      entities,
      options: { output_format: "mmcif", use_msa_server: true },
    },
  };
}

function interfaceClassOf(iptm: number | null): "high" | "moderate" | "low" {
  if (iptm === null || !isFinite(iptm)) return "low";
  if (iptm >= 0.75) return "high";
  if (iptm >= 0.55) return "moderate";
  return "low";
}

/**
 * Run co-folding to completion. Async — dispatches to the Boltz-2 GPU worker.
 * Honours the cost-acknowledgement gate; returns an explicit error status
 * rather than throwing so the UI can render it like every other stage.
 */
export async function runBioStage1Cofold(
  input: BiologicL2Input,
  params: BiologicL2Params,
  onProgress?: (msg: string) => void,
): Promise<BioStageResult<BioStage1>> {
  if (!params.gpuCostAck) {
    return { stage: 1, name: "Target-engagement co-folding", status: "skipped",
      reason: "Co-folding is GPU-priced and opt-in — tick the cost-acknowledgement box, then click Run." };
  }
  const built = buildBiologicCofoldRequest(input, params);
  if (!built.ok) {
    return { stage: 1, name: "Target-engagement co-folding", status: "error", reason: built.reason };
  }
  try {
    const final = await runCofoldToCompletion(built.req, {
      onProgress: s => onProgress?.(`${s.status}${s.progress ? `: ${s.progress}` : ""}`),
    });
    if (final.status !== "done" || !final.result) {
      return { stage: 1, name: "Target-engagement co-folding", status: "error",
        reason: final.error || "Co-folding job failed without a specific error." };
    }
    const cf = final.result;
    const iptm = cf.confidence.iptm ?? cf.confidence.ligand_iptm ?? null;
    return {
      stage: 1, name: "Target-engagement co-folding", status: "wired",
      result: {
        cofold: cf,
        iptm,
        complexPlddt: cf.confidence.complex_plddt ?? null,
        interfaceClass: interfaceClassOf(iptm),
        affinityRequested: input.modality === "peptide" && params.requestAffinity,
      },
    };
  } catch (e: any) {
    return { stage: 1, name: "Target-engagement co-folding", status: "error",
      reason: e?.message || "Co-folding dispatch failed." };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Stage 2 — Binding confirmation (confidence-gated)
// ════════════════════════════════════════════════════════════════════════════

export interface BioStage2 {
  method:          "boltz2-affinity" | "iptm-proxy";
  provenance:      ProvenanceTier;
  gated:           GatedAffinity | null;
  iptm:            number | null;
  engagementClass: "strong" | "moderate" | "weak" | "uncertain";
  headlineValue:   string;
  notes:           string[];
}

export function runBioStage2Binding(
  modality: BiologicModality,
  s1: BioStage1 | undefined,
): BioStageResult<BioStage2> {
  if (!s1) {
    return { stage: 2, name: "Binding confirmation", status: "skipped",
      reason: "Run Stage 1 co-folding first — binding confirmation reads the predicted complex." };
  }

  const iptm = s1.iptm;
  const notes: string[] = [];

  // Peptide path — Boltz-2 affinity head ran; confidence-gate the number.
  if (modality === "peptide" && s1.affinityRequested && s1.cofold.affinity) {
    const gated = extractGatedAffinity(s1.cofold.affinity, s1.cofold.confidence);
    notes.push(s1.cofold.affinity.units_note);
    notes.push(gated.gate.reason);
    if (gated.gate.verdict === "downweighted")
      notes.push("Affinity propagates DOWN-WEIGHTED — treat as a ranking-grade estimate, not a calibrated KD.");
    const engagement: BioStage2["engagementClass"] =
      gated.gate.verdict === "suppressed" ? "uncertain"
      : gated.Ki_nM === null ? "uncertain"
      : gated.Ki_nM < 100 ? "strong"
      : gated.Ki_nM < 1000 ? "moderate" : "weak";
    return {
      stage: 2, name: "Binding confirmation", status: "wired",
      result: {
        method: "boltz2-affinity",
        provenance: gated.gate.verdict === "full" ? "cofolded" : "heuristic",
        gated,
        iptm,
        engagementClass: engagement,
        headlineValue: gated.Ki_nM !== null ? `Ki ≈ ${gated.Ki_nM.toFixed(1)} nM` : "Ki unavailable (gate-suppressed)",
        notes,
      },
    };
  }

  // Antibody / no-affinity path — ipTM interface confidence as engagement proxy.
  notes.push("Boltz-2's affinity head is not calibrated for antibody–antigen complexes; interface confidence (ipTM) is used as the binding-confidence proxy.");
  notes.push("A measured KD (SPR / BLI) is required to confirm the affinity — see Stage 6 falsifiers.");
  const engagement: BioStage2["engagementClass"] =
    iptm === null ? "uncertain"
    : iptm >= 0.80 ? "strong"
    : iptm >= 0.60 ? "moderate"
    : iptm >= 0.45 ? "weak" : "uncertain";
  return {
    stage: 2, name: "Binding confirmation", status: "wired",
    result: {
      method: "iptm-proxy",
      provenance: "structural",
      gated: null,
      iptm,
      engagementClass: engagement,
      headlineValue: iptm !== null ? `Interface ipTM = ${iptm.toFixed(3)}` : "ipTM unavailable",
      notes,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Stage 3 — Modality PK projection
// ════════════════════════════════════════════════════════════════════════════

export interface BioStage3 {
  modality:               BiologicModality;
  provenance:             ProvenanceTier;
  halfLifeText:           string;
  halfLifeHours:          { low: number; high: number } | null;
  clearanceRoute:         string;
  volumeDistributionText: string;
  bioavailabilityText:    string;
  tmddRelevant:           boolean;
  dosingImplication:      string;
  notes:                  string[];
}

/** Lenient parse of an L1 half-life string ("1–2 h", "< 30 min", "~6 h"). */
function parseHalfLifeHours(s: string | undefined): { low: number; high: number } | null {
  if (!s) return null;
  const isMin = /min/i.test(s);
  const nums = (s.match(/[\d.]+/g) || []).map(Number).filter(n => isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  const scale = isMin ? 1 / 60 : 1;
  const lo = Math.min(...nums) * scale;
  const hi = Math.max(...nums) * scale;
  return { low: lo, high: hi };
}

export function runBioStage3PK(
  input: BiologicL2Input,
  params: BiologicL2Params,
): BioStageResult<BioStage3> {
  if (input.modality === "peptide") {
    const p = input.peptide;
    if (!p) {
      return { stage: 3, name: "Modality PK projection", status: "error",
        reason: "Peptide L1 result required for the peptide PK projection." };
    }
    const hl = p.half_life;
    const hours = parseHalfLifeHours(hl.plasma_h);
    const mw = p.physicochemical.molecular_weight_da;
    const renalDominant = mw < 5000;
    const notes: string[] = [
      "Peptide PK is class-based — the small-molecule 2-compartment PBPK is hard-gated OFF for this modality.",
      "Linear peptides are cleared by plasma/tissue proteases and (for MW < ~5 kDa) glomerular filtration; the small-molecule CYP/hepatic model does not apply.",
    ];
    if (p.developability.pegylation_recommended || p.developability.lipidation_recommended)
      notes.push("L1 recommends a half-life-extension strategy (PEGylation / lipidation / Fc-fusion) — projected t½ above is for the UNMODIFIED peptide.");
    return {
      stage: 3, name: "Modality PK projection", status: "wired",
      result: {
        modality: "peptide",
        provenance: "heuristic",
        halfLifeText: `Plasma t½ ${hl.plasma_h} · GI ${hl.gi_h} · renal ${hl.renal_h}`,
        halfLifeHours: hours,
        clearanceRoute: renalDominant
          ? "Renal filtration + proteolysis (MW < 5 kDa — filtered at the glomerulus)"
          : "Proteolysis-dominant (MW ≥ 5 kDa — minimal glomerular filtration)",
        volumeDistributionText: "Vd ≈ 0.06–0.30 L/kg — distribution largely confined to plasma + interstitial fluid",
        bioavailabilityText: p.developability.oral_potential
          ? "Oral bioavailability possible but typically <5%; parenteral route preferred"
          : "Oral bioavailability negligible — parenteral (SC/IV) route required",
        tmddRelevant: false,
        dosingImplication: hours && hours.high < 6
          ? "Short t½ — frequent dosing or a half-life-extension modification is needed for a practical regimen."
          : "t½ supports a once-daily or less-frequent regimen pending in-vivo confirmation.",
        notes,
      },
    };
  }

  // antibody — IgG-class TMDD / FcRn recycling
  const a = input.antibody;
  if (!a) {
    return { stage: 3, name: "Modality PK projection", status: "error",
      reason: "Antibody L1 result required for the antibody PK projection." };
  }
  const isVHH    = /vhh|nanobody|single.?domain/i.test(a.inferred_format);
  const isScFv   = /scfv/i.test(a.inferred_format);
  const isFcLess = isVHH || isScFv || /fab/i.test(a.inferred_format);
  const hours = isFcLess
    ? { low: 2, high: 24 }          // no FcRn recycling — hours, not weeks
    : { low: 14 * 24, high: 28 * 24 }; // full IgG — ~2–4 weeks
  return {
    stage: 3, name: "Modality PK projection", status: "wired",
    result: {
      modality: "antibody",
      provenance: "heuristic",
      halfLifeText: isFcLess
        ? "Class-typical t½ ≈ 2–24 h (no Fc → no FcRn recycling)"
        : "Class-typical t½ ≈ 2–4 weeks (FcRn-mediated recycling)",
      halfLifeHours: hours,
      clearanceRoute: isFcLess
        ? "Renal filtration (small size, no Fc) + proteolytic catabolism"
        : "Reticuloendothelial catabolism + target-mediated drug disposition (TMDD)",
      volumeDistributionText: "Vd central ≈ 3–4 L (≈plasma volume); slow distribution to interstitial space",
      bioavailabilityText: params.route === "sc"
        ? "Subcutaneous bioavailability typically 60–80% (lymphatic absorption)"
        : params.route === "iv" ? "IV — bioavailability 100% by definition"
        : "Route-dependent; SC/IV are standard for biologics",
      tmddRelevant: !isFcLess,
      dosingImplication: isFcLess
        ? "Short t½ — continuous infusion, frequent dosing, or an Fc/albumin-fusion half-life extension is required."
        : "Long FcRn-recycled t½ supports a Q2W–Q4W regimen; expect non-linear TMDD clearance at low doses / low target occupancy.",
      notes: [
        "Antibody PK is class-based — the small-molecule 2-compartment PBPK is hard-gated OFF for this modality.",
        isFcLess
          ? "This format lacks an Fc domain, so FcRn-mediated recycling does not apply — half-life is short."
          : "Half-life is dominated by FcRn recycling and target-mediated drug disposition (TMDD); a measured serum-PK study is required to calibrate clearance.",
        "Projected values are IgG-class typical ranges, not a calibrated model fit — confirm with an in-vivo serum-PK study (Stage 6 falsifier).",
      ],
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Stage 4 — Exposure & therapeutic-index readiness
// ════════════════════════════════════════════════════════════════════════════

export interface BioStage4 {
  provenance:         ProvenanceTier;
  dosingFrequency:    string;
  occupancyFeasible:  boolean;
  therapeuticIndexReady: boolean;
  exposureNotes:      string[];
  blockers:           string[];
}

export function runBioStage4Exposure(
  modality: BiologicModality,
  s2: BioStage2 | undefined,
  s3: BioStage3 | undefined,
  params: BiologicL2Params,
): BioStageResult<BioStage4> {
  if (!s3) {
    return { stage: 4, name: "Exposure & therapeutic index", status: "skipped",
      reason: "Run Stage 3 (PK projection) first — exposure math needs the half-life." };
  }
  const blockers: string[] = [];
  const notes: string[] = [];

  // Dosing frequency from t½ (≈3–5 half-lives between doses for trough control).
  let dosingFrequency = "Pending in-vivo PK";
  if (s3.halfLifeHours) {
    const tHalf = (s3.halfLifeHours.low + s3.halfLifeHours.high) / 2;
    dosingFrequency =
      tHalf < 6   ? "Multiple times daily or continuous infusion"
      : tHalf < 24  ? "Once or twice daily"
      : tHalf < 96  ? "Every 2–3 days"
      : tHalf < 14 * 24 ? "Weekly"
      : "Every 2–4 weeks";
    notes.push(`Dosing interval estimated from a mean projected t½ of ${tHalf < 48 ? tHalf.toFixed(1) + " h" : (tHalf / 24).toFixed(1) + " d"}.`);
  } else {
    blockers.push("No parseable half-life — in-vivo PK needed before a dosing interval can be set.");
  }

  // Therapeutic-index readiness needs a binding number.
  let tiReady = false;
  if (!s2 || s2.engagementClass === "uncertain") {
    blockers.push("Binding confirmation is uncertain — a measured KD is required before a therapeutic index can be projected.");
  } else if (modality === "peptide" && s2.method === "boltz2-affinity" && s2.gated?.Ki_nM != null && s2.gated.gate.verdict !== "suppressed") {
    tiReady = true;
    const occ = params.targetOccupancy;
    const ratio = occ / Math.max(1e-3, 1 - occ);
    notes.push(`Target occupancy ${(occ * 100).toFixed(0)}% requires free drug ≈ ${ratio.toFixed(1)}× Ki (≈ ${(ratio * s2.gated.Ki_nM).toFixed(0)} nM) at the biophase.`);
    notes.push("Co-fold-derived Ki is ranking-grade — first-in-human dose selection still requires a measured KD and an in-vivo PK study.");
  } else {
    notes.push("Antibody therapeutic window / MABEL first-dose is set in Layer 3 from a measured KD, receptor density and a TMDD model — out of scope for in-silico L2.");
  }

  return {
    stage: 4, name: "Exposure & therapeutic index", status: "wired",
    result: {
      provenance: "heuristic",
      dosingFrequency,
      occupancyFeasible: !!s3.halfLifeHours,
      therapeuticIndexReady: tiReady,
      exposureNotes: notes,
      blockers,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Stage 5 — Immunogenicity & safety confirmation
// ════════════════════════════════════════════════════════════════════════════

export interface BioSafetySignal {
  category: string;
  level:    "low" | "moderate" | "high";
  detail:   string;
}

export interface BioStage5 {
  modality:        BiologicModality;
  immunogenicityBand: "low" | "moderate" | "high" | "not scored";
  signals:         BioSafetySignal[];
  provenance:      ProvenanceTier;
  caveat:          string;
}

export function runBioStage5Safety(input: BiologicL2Input): BioStageResult<BioStage5> {
  const signals: BioSafetySignal[] = [];

  if (input.modality === "peptide") {
    const p = input.peptide;
    if (!p) {
      return { stage: 5, name: "Immunogenicity & safety", status: "error",
        reason: "Peptide L1 result required." };
    }
    // Proteolytic exposure
    const sites = p.proteolytic_stability.sites.length;
    signals.push({
      category: "Proteolytic stability",
      level: sites > 5 ? "high" : sites > 2 ? "moderate" : "low",
      detail: `${sites} predicted protease cleavage site(s)${p.proteolytic_stability.most_labile_protease ? ` — most labile: ${p.proteolytic_stability.most_labile_protease}` : ""}.`,
    });
    // Aggregation
    const agg = p.developability.aggregation_risk;
    signals.push({
      category: "Aggregation / immunogenic aggregates",
      level: /high/i.test(agg) ? "high" : /moder/i.test(agg) ? "moderate" : "low",
      detail: `L1 aggregation risk: ${agg}. Aggregates are a known driver of anti-drug-antibody (ADA) responses.`,
    });
    // AMP / membrane-lysis off-target
    const ampClass = p.amp_score.amp_class;
    if (/strong|moderate/i.test(ampClass)) {
      signals.push({
        category: "Off-target membrane activity",
        level: /strong/i.test(ampClass) ? "high" : "moderate",
        detail: `Scored as ${ampClass} — cationic/amphipathic peptides can lyse host membranes (haemolysis / cytotoxicity). Screen with a haemolysis assay.`,
      });
    }
    // Charge as a coarse immunogenicity input
    const band: BioStage5["immunogenicityBand"] =
      /high/i.test(agg) ? "high"
      : sites > 5 || /moder/i.test(agg) ? "moderate" : "low";
    return {
      stage: 5, name: "Immunogenicity & safety", status: "wired",
      result: {
        modality: "peptide",
        immunogenicityBand: band,
        signals,
        provenance: "heuristic",
        caveat: "Peptide immunogenicity is a coarse heuristic from aggregation + proteolytic load. A calibrated MHC-II / T-cell-epitope screen and an in-vitro ADA assay are required for confirmation.",
      },
    };
  }

  // antibody
  const a = input.antibody;
  if (!a) {
    return { stage: 5, name: "Immunogenicity & safety", status: "error",
      reason: "Antibody L1 result required." };
  }
  // Worst per-chain immunogenicity band
  let worst: "low" | "moderate" | "high" = "low";
  for (const c of a.chains) {
    const b = (c.immunogenicity?.band || "").toLowerCase();
    if (/high|elevated/.test(b)) worst = "high";
    else if (/moder/.test(b) && worst !== "high") worst = "moderate";
  }
  const totalAgretopes = a.chains.reduce((n, c) => n + (c.immunogenicity?.candidate_agretope_windows ?? 0), 0);
  signals.push({
    category: "T-cell epitope content (coarse)",
    level: worst,
    detail: `${totalAgretopes} candidate agretope window(s) across ${a.chains.length} chain(s). Humanness is NOT scored by L1 — see caveat.`,
  });
  const anchoredHS = a.chains.reduce((n, c) => n + (c.aggregation?.anchored_cdr_hotspots ?? 0), 0);
  signals.push({
    category: "Aggregation (sequence-level)",
    level: anchoredHS >= 2 ? "moderate" : "low",
    detail: `${anchoredHS} AGGRESCAN hot spot(s) overlap an anchored CDR-H3/L3. A graded aggregation risk is computed in Layer 2 from the co-folded Fv structure — aggregates are a primary ADA driver for biologics.`,
  });
  signals.push({
    category: "CDR / sequence liabilities",
    level: a.summary.n_liabilities_high > 0 ? "high" : a.summary.n_liabilities_moderate > 0 ? "moderate" : "low",
    detail: `${a.summary.n_liabilities_high} high + ${a.summary.n_liabilities_moderate} moderate liability motif(s) (deamidation / isomerisation / oxidation / glycosylation sequons / unpaired Cys).`,
  });
  return {
    stage: 5, name: "Immunogenicity & safety", status: "wired",
    result: {
      modality: "antibody",
      immunogenicityBand: worst,
      signals,
      provenance: "heuristic",
      caveat: "Humanness and T-cell-epitope content are coarse screens. A calibrated humanness model (germline / repertoire) and a measured ADA-incidence study are required for confirmation.",
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Stage 6 — Confirmation falsifier registry (per-modality)
// ════════════════════════════════════════════════════════════════════════════

export interface BioFalsifier {
  id:           string;
  description:  string;
  predicted:    string;
  comparator:   "gte" | "lte" | "within-fold";
  threshold:    string;
  assay:        string;
  /** A biologic L2 falsifier is always pending until a wet-lab value exists. */
  status:       "pending-measurement";
}

export interface BioStage6 {
  modality:    BiologicModality;
  falsifiers:  BioFalsifier[];
  note:        string;
}

export function runBioStage6Falsifiers(
  input: BiologicL2Input,
  s2: BioStage2 | undefined,
  s3: BioStage3 | undefined,
): BioStageResult<BioStage6> {
  const falsifiers: BioFalsifier[] = [];

  if (input.modality === "peptide") {
    falsifiers.push({
      id: "PEP-T-HALF", description: "Measured plasma half-life is not far below the projection",
      predicted: s3?.halfLifeText ?? "see Stage 3", comparator: "gte",
      threshold: "≥ predicted t½ ÷ 3", assay: "In-vivo / ex-vivo plasma PK (LC-MS/MS)",
      status: "pending-measurement",
    });
    falsifiers.push({
      id: "PEP-PROTEASE", description: "Peptide remains substantially intact in plasma",
      predicted: `${input.peptide?.proteolytic_stability.sites.length ?? "?"} predicted cleavage sites`, comparator: "gte",
      threshold: "≥ 50% intact at 4 h in human plasma", assay: "Plasma-stability assay (LC-MS)",
      status: "pending-measurement",
    });
    falsifiers.push({
      id: "PEP-ADA", description: "Anti-drug-antibody incidence is acceptable",
      predicted: "coarse heuristic — see Stage 5", comparator: "lte",
      threshold: "≤ 30% ADA-positive", assay: "Bridging ELISA / in-vitro MAPPs",
      status: "pending-measurement",
    });
    if (s2?.method === "boltz2-affinity" && s2.gated?.Ki_nM != null) {
      falsifiers.push({
        id: "PEP-KD", description: "Measured affinity agrees with the co-fold estimate",
        predicted: `Ki ≈ ${s2.gated.Ki_nM.toFixed(1)} nM (co-fold, ranking-grade)`, comparator: "within-fold",
        threshold: "within 10× of measured KD", assay: "SPR / BLI / fluorescence polarisation",
        status: "pending-measurement",
      });
    }
    return {
      stage: 6, name: "Confirmation falsifiers", status: "wired",
      result: {
        modality: "peptide", falsifiers,
        note: "Each criterion is a falsifiable wet-lab test. A measured value that breaches the threshold should trigger a No-Go or a redesign — not a quiet override.",
      },
    };
  }

  // antibody
  falsifiers.push({
    id: "AB-TM", description: "Fv thermostability is acceptable for development",
    predicted: "not scored by L1 (structure-based Tm pending)", comparator: "gte",
    threshold: "≥ 65 °C apparent Tm", assay: "DSF / nanoDSF / DSC",
    status: "pending-measurement",
  });
  falsifiers.push({
    id: "AB-KD", description: "Measured antigen affinity confirms the predicted engagement",
    predicted: s2 ? `${s2.headlineValue} (${s2.engagementClass})` : "see Stage 2", comparator: "within-fold",
    threshold: "measured KD within 10× of the predicted engagement class", assay: "SPR / BLI",
    status: "pending-measurement",
  });
  falsifiers.push({
    id: "AB-MONOMER", description: "Purified material is predominantly monomeric",
    predicted: `L1 hot-spot scan: ${input.antibody?.summary.aggregation_risk ?? "?"}`, comparator: "gte",
    threshold: "≥ 95% monomer", assay: "SEC-HPLC",
    status: "pending-measurement",
  });
  falsifiers.push({
    id: "AB-ADA", description: "Clinical immunogenicity (ADA) incidence is acceptable",
    predicted: "humanness not scored by L1 — coarse epitope screen only", comparator: "lte",
    threshold: "≤ 15% ADA-positive", assay: "Bridging ELISA / in-vitro MAPPs / DC-T assay",
    status: "pending-measurement",
  });
  falsifiers.push({
    id: "AB-TITER", description: "Expression titer supports manufacturability",
    predicted: `developability tier: ${input.antibody?.summary.developability_tier ?? "?"}`, comparator: "gte",
    threshold: "≥ 50 mg/L transient expression", assay: "Transient CHO/HEK expression + Protein-A quantitation",
    status: "pending-measurement",
  });
  return {
    stage: 6, name: "Confirmation falsifiers", status: "wired",
    result: {
      modality: "antibody", falsifiers,
      note: "Each criterion is a falsifiable wet-lab test. A measured value that breaches the threshold should trigger a No-Go or a redesign — not a quiet override.",
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Stage 7 — Handoff summary
// ════════════════════════════════════════════════════════════════════════════

export interface BioStage7 {
  modality:        BiologicModality;
  l2Verdict:       "ADVANCE" | "ADVANCE-WITH-WATCH" | "HOLD";
  confirmedInSilico: string[];
  needsWetLab:     string[];
  recommendation:  string;
  schemaVersion:   string;
}

export function runBioStage7Handoff(
  input: BiologicL2Input,
  stages: {
    s0?: BioStage0; s2?: BioStage2; s3?: BioStage3;
    s4?: BioStage4; s5?: BioStage5; s6?: BioStage6;
  },
): BioStageResult<BioStage7> {
  const confirmed: string[] = [];
  const needs: string[] = [];

  if (stages.s0) confirmed.push(`L1 evidence ingested — go/no-go: ${stages.s0.goNoGo}.`);
  if (stages.s2) {
    if (stages.s2.engagementClass !== "uncertain")
      confirmed.push(`Structural target engagement: ${stages.s2.engagementClass} (${stages.s2.headlineValue}).`);
    else
      needs.push("Target binding — co-folding interface confidence is too low; a measured KD is required.");
  } else {
    needs.push("Target binding — Stage 1/2 co-folding not yet run.");
  }
  if (stages.s3) confirmed.push(`PK class projected: ${stages.s3.halfLifeText}.`);
  needs.push("In-vivo serum PK to calibrate clearance and half-life.");
  if (stages.s5 && stages.s5.immunogenicityBand !== "low")
    needs.push(`Immunogenicity — L1 band is ${stages.s5.immunogenicityBand}; an ADA / MHC-II assay is required.`);
  if (stages.s6) needs.push(`${stages.s6.falsifiers.length} falsifier criteria pending wet-lab measurement.`);

  // Verdict
  const goNoGo = stages.s0?.goNoGo ?? "WATCH";
  const highSafety = stages.s5?.signals.some(s => s.level === "high") ?? false;
  let verdict: BioStage7["l2Verdict"];
  if (goNoGo === "NO-GO" || (highSafety && stages.s2?.engagementClass === "uncertain")) verdict = "HOLD";
  else if (goNoGo === "GO" && !highSafety && stages.s2 && stages.s2.engagementClass !== "uncertain" && stages.s2.engagementClass !== "weak")
    verdict = "ADVANCE";
  else verdict = "ADVANCE-WITH-WATCH";

  const recommendation =
    verdict === "ADVANCE"
      ? "In-silico L2 confirmation is consistent — advance to a focused wet-lab confirmation package (binding KD, PK, stability) before committing to a full preclinical program."
      : verdict === "HOLD"
      ? "In-silico L2 surfaced a blocking liability or uncertain target engagement — resolve via redesign or a decisive assay before spending on the full package."
      : "In-silico L2 is promising but carries open risks — advance, but front-load the falsifier assays that could kill the program cheaply.";

  return {
    stage: 7, name: "Handoff summary", status: "wired",
    result: {
      modality: input.modality,
      l2Verdict: verdict,
      confirmedInSilico: confirmed,
      needsWetLab: needs,
      recommendation,
      schemaVersion: "L2-biologic-handoff-v1",
    },
  };
}
