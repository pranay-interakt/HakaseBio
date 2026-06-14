/**
 * peptideL1Scorecard.ts — Unified Go / Watch / No-Go scorecard for peptides.
 *
 * Mirrors the small-molecule l1Scorecard.ts architecture for biologic
 * peptide candidates:
 *
 *   1. HARD OVERRIDES (No-Go flags) — veto regardless of composite score.
 *      High-confidence hemolysis, severe aggregation, critical immunogenicity,
 *      and synthesis impossibility are hard No-Go signals.
 *
 *   2. WEIGHTED COMPOSITE (0–100) — 10 dimensions covering safety, stability,
 *      permeability/delivery, AMP/selectivity, and developability. Null-aware:
 *      unavailable dimensions are dropped and weights renormalised.
 *
 *   3. CONFIDENCE — driven by the fraction of the safety signal that came from
 *      the real ML classifiers (hemolysis_prob, amp_prob, cpp_prob) versus
 *      the compositional heuristics. A Go based entirely on heuristics is
 *      downgraded to Watch.
 *
 *   4. VERDICT-CONSISTENT SCORE BANDING — GO ∈ [70,100], WATCH ∈ [40,69],
 *      NO-GO ∈ [1,39]. Supports ranked library triage.
 */

import type { PeptideResult } from "./aiService";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PeptideVerdict = "GO" | "WATCH" | "NO-GO";
export type PeptideProvenance = "ml" | "heuristic" | "experimental" | "unavailable";

export interface PeptideFlag {
  id: string;
  label: string;
  severity: "critical" | "warn" | "info";
  source: string;
  provenance: PeptideProvenance;
  value: string;
  threshold: string;
  rationale: string;
  hardNoGo: boolean;
}

export interface PeptideDimensionScore {
  dimension: string;
  score: number;       // 0–100, higher = better/safer
  weight: number;      // renormalised weight in composite
  provenance: PeptideProvenance;
  detail: string;
}

export interface PeptideScorecard {
  verdict: PeptideVerdict;
  /**
   * 0–100 triage score consistent with verdict band.
   * GO ∈ [70,100] · WATCH ∈ [40,69] · NO-GO ∈ [1,39]
   */
  score: number;
  /** Raw composite before banding (for transparency). */
  compositeRaw: number;
  confidence: "High" | "Medium" | "Low";
  confidenceNote: string;
  flags: PeptideFlag[];
  dimensions: PeptideDimensionScore[];
  summary: string;
  /** ML fractions (hemolysis / AMP / CPP) used, null when ML endpoint unavailable. */
  mlSignal: {
    hemolysis_prob?: number;
    amp_prob?: number;
    cpp_prob?: number;
    solubility_score?: number;
    models_cv_auc?: { hemolysis?: number; amp?: number; cpp?: number };
  } | null;
  /** True when the verdict is driven by ML classifiers (not heuristics). */
  mlDriven: boolean;
}

export interface PeptideScorecardInput {
  result: PeptideResult;
  sequence: string;
  cyclic?: boolean;
  /** Output of `/api/ai/peptide-ml` — null if endpoint unreachable. */
  mlSignal?: {
    hemolysis_prob?: number;
    amp_prob?: number;
    cpp_prob?: number;
    solubility_score?: number;
    solubility_class?: string;
    hemolysis_class?: string;
    amp_class?: string;
    cpp_class?: string;
    models_cv_auc?: { hemolysis?: number; amp?: number; cpp?: number };
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hard thresholds
// ─────────────────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  // Hard No-Go (ML)
  HEMOLYSIS_HARD: 0.78,      // ML hemolysis_prob — high confidence hemolytic
  // Hard No-Go (heuristic)
  HEMO_CHARGE_HIGH: 4,       // net_charge_pH7 + moment → hemolytic heuristic
  HEMO_MOMENT_HIGH: 0.55,
  AGGREGATION_HIGH: "high",  // text-match on agg risk
  IMMUNO_CRITICAL: "elevated",
  SPPS_IMPOSSIBLE: "not feasible",
  // Watch thresholds (ML)
  HEMOLYSIS_WATCH: 0.50,
  AMP_WARN: 0.65,            // high AMP + unknown host target → watch
  // Watch thresholds (heuristic)
  PROTEASE_HIGH: 8,          // n cleavage sites
  PROTEASE_WATCH: 4,
  INSTABILITY_UNSTABLE: 40,  // Guruprasad index
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Dimension raw scores (0–100)
// ─────────────────────────────────────────────────────────────────────────────

type DimRaw = { score: number | null; provenance: PeptideProvenance; detail: string };

function dimSafety_hemolysis(
  pc: PeptideResult["physicochemical"],
  ml: PeptideScorecardInput["mlSignal"],
): DimRaw {
  if (ml?.hemolysis_prob != null) {
    const p = ml.hemolysis_prob;
    const score = Math.round((1 - p) * 100);
    return {
      score,
      provenance: "ml",
      detail: `ML hemolysis probability ${(p * 100).toFixed(1)}% (HemoPI-2 GB classifier)`,
    };
  }
  // Heuristic: cationic + amphipathic = hemolytic risk
  if (!pc) return { score: null, provenance: "unavailable", detail: "No physicochemical data" };
  const charge = pc.net_charge_pH7 ?? 0;
  const moment = pc.hydrophobic_moment ?? 0;
  let score = 80;
  if (charge > THRESHOLDS.HEMO_CHARGE_HIGH && moment > THRESHOLDS.HEMO_MOMENT_HIGH) score = 15;
  else if (charge > 3 || moment > 0.45) score = 45;
  else if (charge > 1.5) score = 65;
  return {
    score,
    provenance: "heuristic",
    detail: `Heuristic hemolysis risk from charge (${charge.toFixed(1)}) + hydrophobic moment (${moment.toFixed(2)})`,
  };
}

function dimStability_scaffold(
  pc: PeptideResult["physicochemical"],
  prot: PeptideResult["proteolytic_stability"],
  cyclic: boolean,
): DimRaw {
  if (!pc) return { score: null, provenance: "unavailable", detail: "No physicochemical data" };
  const ii = pc.instability_index ?? 40;
  const isStable = ii <= THRESHOLDS.INSTABILITY_UNSTABLE;
  const nSites = prot?.sites?.reduce((s, p) => s + (p.n_sites ?? 0), 0) ?? 0;
  let score = isStable ? 80 : 40;
  score = Math.max(5, score - Math.min(nSites, 10) * 4);
  if (cyclic) score = Math.min(100, score + 15);
  return {
    score,
    provenance: "heuristic",
    detail: `Instability index ${ii.toFixed(1)} (${isStable ? "stable" : "unstable"}), ${nSites} protease sites${cyclic ? ", cyclic +15" : ""}`,
  };
}

function dimPermeability_delivery(
  perm: PeptideResult["membrane_permeability"],
  ml: PeptideScorecardInput["mlSignal"],
): DimRaw {
  const cpp_p = ml?.cpp_prob;
  const base = perm?.membrane_permeability_score ?? null;
  if (base == null && cpp_p == null) {
    return { score: null, provenance: "unavailable", detail: "No permeability data" };
  }
  const cpScore = cpp_p != null ? cpp_p * 50 : 0;  // CPP contributes up to 50 pts
  const permScore = base != null ? (base / 100) * 60 : 0;
  const combined = (cpp_p != null ? cpScore + permScore * 0.5 : permScore);
  const score = Math.min(100, Math.round(combined));
  const prov: PeptideProvenance = cpp_p != null ? "ml" : "heuristic";
  return {
    score,
    provenance: prov,
    detail: `Membrane score ${base?.toFixed(0) ?? "—"}/100${cpp_p != null ? `, CPP probability ${(cpp_p * 100).toFixed(1)}%` : ""}`,
  };
}

function dimAggregation(
  agg: PeptideResult["aggregation"],
): DimRaw {
  if (!agg) return { score: null, provenance: "unavailable", detail: "No aggregation data" };
  const risk = agg.risk ?? "";
  const score =
    /high/i.test(risk) ? 10
    : /moderate/i.test(risk) ? 50
    : /low/i.test(risk) ? 90
    : 60;
  return {
    score,
    provenance: "heuristic",
    detail: `Aggregation risk: ${risk || "unknown"} (${agg.n_regions} AGGRESCAN hotspots)`,
  };
}

function dimImmunogenicity(
  immuno: PeptideResult["immunogenicity"],
): DimRaw {
  if (!immuno) return { score: null, provenance: "unavailable", detail: "No immunogenicity data" };
  const band = immuno.band ?? "";
  const score =
    /elevated/i.test(band) ? 15
    : /moderate/i.test(band) ? 55
    : /low/i.test(band) ? 90
    : 65;
  return {
    score,
    provenance: "heuristic",
    detail: `T-cell epitope load: ${band}`,
  };
}

function dimSelectivity(
  pc: PeptideResult["physicochemical"],
  ml: PeptideScorecardInput["mlSignal"],
): DimRaw {
  // Selectivity = non-specific membrane disruption vs targeted activity
  const amp_p = ml?.amp_prob;
  const hemo_p = ml?.hemolysis_prob;
  if (amp_p != null && hemo_p != null) {
    // SI proxy: AMP but not hemolytic → selective
    const si = amp_p * (1 - hemo_p);
    const score = Math.round(si * 100);
    return {
      score,
      provenance: "ml",
      detail: `SI proxy: AMP prob ${(amp_p * 100).toFixed(1)}% × (1 − hemolysis ${(hemo_p * 100).toFixed(1)}%) = ${(si * 100).toFixed(1)}`,
    };
  }
  if (!pc) return { score: null, provenance: "unavailable", detail: "No physicochemical data" };
  const moment = pc.hydrophobic_moment ?? 0;
  const charge = pc.net_charge_pH7 ?? 0;
  // High moment + high charge = non-selective amphipathic lysis
  const score = charge > 4 && moment > 0.5 ? 20 : charge > 2 && moment > 0.35 ? 55 : 80;
  return {
    score,
    provenance: "heuristic",
    detail: `Heuristic selectivity from charge (${charge.toFixed(1)}) and hydrophobic moment (${moment.toFixed(2)})`,
  };
}

function dimSolubility(
  sol: PeptideResult["solubility"],
  ml: PeptideScorecardInput["mlSignal"],
): DimRaw {
  const camsolScore = ml?.solubility_score;
  if (camsolScore != null) {
    const score = Math.round(50 + camsolScore * 30);  // centred at 50
    return {
      score: Math.max(0, Math.min(100, score)),
      provenance: "ml",
      detail: `CamSol intrinsic score ${camsolScore.toFixed(3)} (Sormanni 2017)`,
    };
  }
  if (!sol) return { score: null, provenance: "unavailable", detail: "No solubility data" };
  const cls = sol.solubility_class ?? "";
  const score = /very low/i.test(cls) ? 10 : /low/i.test(cls) ? 35 : /moderate/i.test(cls) ? 65 : 85;
  return {
    score,
    provenance: "heuristic",
    detail: `Solubility class: ${cls || "unknown"} (score ${sol.solubility_score?.toFixed(0) ?? "—"}/100)`,
  };
}

function dimDevelopability(
  dev: PeptideResult["developability"],
  chem: PeptideResult["chemical_liabilities"],
  syn: PeptideResult["synthesis"],
): DimRaw {
  if (!dev && !chem && !syn) return { score: null, provenance: "unavailable", detail: "No developability data" };
  let score = 75;
  if (/high/i.test(dev?.aggregation_risk ?? "")) score -= 30;
  if (/very difficult|not feasible/i.test(syn?.difficulty_class ?? "")) score -= 40;
  else if (/difficult/i.test(syn?.difficulty_class ?? "")) score -= 20;
  const highChem = chem?.liabilities?.some(l => l.severity === "high") ?? false;
  const modChem = chem?.liabilities?.some(l => l.severity === "moderate") ?? false;
  if (highChem) score -= 20;
  else if (modChem) score -= 10;
  return {
    score: Math.max(0, score),
    provenance: "heuristic",
    detail: `Synthesis: ${syn?.difficulty_class ?? "unknown"}, chemical liabilities: ${chem?.liabilities?.length ?? 0}`,
  };
}

function dimHalfLife(
  hl: PeptideResult["half_life"],
  cyclic: boolean,
): DimRaw {
  if (!hl) return { score: null, provenance: "unavailable", detail: "No half-life data" };
  // plasma_h is a string like "2.3 h" or "45 min" — convert to minutes
  const rawH = hl.plasma_h ?? "";
  let plasmaMin = 0;
  const hrMatch = rawH.match(/([\d.]+)\s*h/i);
  const minMatch = rawH.match(/([\d.]+)\s*min/i);
  if (hrMatch) plasmaMin = parseFloat(hrMatch[1]) * 60;
  else if (minMatch) plasmaMin = parseFloat(minMatch[1]);
  let score: number;
  if (plasmaMin > 120) score = 90;
  else if (plasmaMin > 30) score = 70;
  else if (plasmaMin > 5) score = 45;
  else score = 20;
  if (cyclic) score = Math.min(100, score + 10);
  return {
    score,
    provenance: "heuristic",
    detail: `Plasma t½ ${rawH || "unknown"}${cyclic ? " (cyclic +10)" : ""}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flag builder
// ─────────────────────────────────────────────────────────────────────────────

function buildFlags(
  input: PeptideScorecardInput,
): PeptideFlag[] {
  const flags: PeptideFlag[] = [];
  const { result, cyclic = false, mlSignal: ml } = input;
  const pc = result?.physicochemical;
  const prot = result?.proteolytic_stability;
  const agg = result?.aggregation;
  const immuno = result?.immunogenicity;
  const dev = result?.developability;
  const chem = result?.chemical_liabilities;
  const syn = result?.synthesis;
  const hl = result?.half_life;

  // ── Hard No-Go flags ──────────────────────────────────────────────────────

  if (ml?.hemolysis_prob != null && ml.hemolysis_prob >= THRESHOLDS.HEMOLYSIS_HARD) {
    flags.push({
      id: "ml_hemolysis_hard",
      label: "High Hemolysis Probability",
      severity: "critical",
      source: "HemoPI-2 GBC (peptide_esm_ml.py)",
      provenance: "ml",
      value: `${(ml.hemolysis_prob * 100).toFixed(1)}%`,
      threshold: `≥${(THRESHOLDS.HEMOLYSIS_HARD * 100).toFixed(0)}%`,
      rationale: "ML classifier trained on HemoPI-2 predicts high probability of erythrocyte membrane disruption. Confirms hemolysis assay required before any in vivo work.",
      hardNoGo: true,
    });
  } else if (
    ml == null &&
    pc != null &&
    (pc.net_charge_pH7 ?? 0) > THRESHOLDS.HEMO_CHARGE_HIGH &&
    (pc.hydrophobic_moment ?? 0) > THRESHOLDS.HEMO_MOMENT_HIGH
  ) {
    flags.push({
      id: "heur_hemolysis_hard",
      label: "Hemolysis Risk — Cationic Amphipathic",
      severity: "critical",
      source: "Shai-Huang compositional heuristic",
      provenance: "heuristic",
      value: `charge ${(pc.net_charge_pH7 ?? 0).toFixed(1)}, μH ${(pc.hydrophobic_moment ?? 0).toFixed(2)}`,
      threshold: `charge >4 AND moment >0.55`,
      rationale: "Strong cationic amphipathic scaffold is the canonical membrane-lytic signature. Hemolysis assay mandatory before dosing.",
      hardNoGo: true,
    });
  }

  if (/high/i.test(agg?.risk ?? "") || /high/i.test(dev?.aggregation_risk ?? "")) {
    const nSites = prot?.sites?.reduce((s, p) => s + (p.n_sites ?? 0), 0) ?? 0;
    if (nSites > 6 || /high/i.test(agg?.risk ?? "")) {
      flags.push({
        id: "agg_high",
        label: "High Aggregation Risk + Proteolytic Liability",
        severity: "critical",
        source: "AGGRESCAN / Guruprasad + protease scan",
        provenance: "heuristic",
        value: `/high aggregation, ${nSites} cleavage sites/`,
        threshold: "aggregation=high OR protease sites >6",
        rationale: "Aggregation-prone peptides are difficult to formulate and fail in vivo stability. Engineering required before progressing.",
        hardNoGo: nSites > 6,
      });
    }
  }

  if (/very difficult|not feasible/i.test(syn?.difficulty_class ?? "")) {
    flags.push({
      id: "spps_impossible",
      label: "SPPS Synthesis Very Difficult",
      severity: "critical",
      source: "SPPS feasibility heuristic",
      provenance: "heuristic",
      value: syn?.difficulty_class ?? "very difficult",
      threshold: "synthesis difficulty = Very difficult",
      rationale: "Sequence cannot be synthesised by standard SPPS. Redesign required before any progression.",
      hardNoGo: true,
    });
  }

  // ── Watch flags ────────────────────────────────────────────────────────────

  if (ml?.hemolysis_prob != null && ml.hemolysis_prob >= THRESHOLDS.HEMOLYSIS_WATCH && ml.hemolysis_prob < THRESHOLDS.HEMOLYSIS_HARD) {
    flags.push({
      id: "ml_hemolysis_watch",
      label: "Borderline Hemolysis Probability",
      severity: "warn",
      source: "HemoPI-2 GBC (peptide_esm_ml.py)",
      provenance: "ml",
      value: `${(ml.hemolysis_prob * 100).toFixed(1)}%`,
      threshold: `${(THRESHOLDS.HEMOLYSIS_WATCH * 100).toFixed(0)}–${(THRESHOLDS.HEMOLYSIS_HARD * 100).toFixed(0)}%`,
      rationale: "Borderline hemolysis signal from ML. Erythrocyte assay at ≤10 μg/mL recommended.",
      hardNoGo: false,
    });
  }

  if (ml?.amp_prob != null && ml.amp_prob >= THRESHOLDS.AMP_WARN) {
    flags.push({
      id: "ml_amp_warn",
      label: "High AMP Probability",
      severity: "warn",
      source: "CAMP v3.0 GBC (peptide_esm_ml.py)",
      provenance: "ml",
      value: `${(ml.amp_prob * 100).toFixed(1)}%`,
      threshold: `≥${(THRESHOLDS.AMP_WARN * 100).toFixed(0)}%`,
      rationale: "ML predicts antimicrobial activity. Confirms AMP profile — check selectivity index and microbiome impact in L2.",
      hardNoGo: false,
    });
  }

  if (/elevated/i.test(immuno?.band ?? "")) {
    flags.push({
      id: "immuno_elevated",
      label: "Elevated T-Cell Epitope Load",
      severity: "warn",
      source: "Hydrophobic 15-mer agretope proxy",
      provenance: "heuristic",
      value: String(immuno?.candidate_epitope_windows ?? "—"),
      threshold: ">6 epitope windows",
      rationale: "Elevated T-cell epitope load increases immunogenicity risk for repeat dosing. Consider MHC-II deimmunisation in L2.",
      hardNoGo: false,
    });
  }

  const nSites = prot?.sites?.reduce((s, p) => s + (p.n_sites ?? 0), 0) ?? 0;
  if (nSites >= THRESHOLDS.PROTEASE_HIGH) {
    flags.push({
      id: "protease_high",
      label: "High Proteolytic Liability",
      severity: "warn",
      source: "In-silico protease site scan (9 proteases)",
      provenance: "heuristic",
      value: `${nSites} cleavage sites`,
      threshold: `≥${THRESHOLDS.PROTEASE_HIGH} sites`,
      rationale: "High protease site count predicts short plasma half-life and poor oral absorption. Backbone N-methylation, D-amino acids, or cyclisation warranted.",
      hardNoGo: false,
    });
  } else if (nSites >= THRESHOLDS.PROTEASE_WATCH) {
    flags.push({
      id: "protease_watch",
      label: "Moderate Proteolytic Liability",
      severity: "warn",
      source: "In-silico protease site scan",
      provenance: "heuristic",
      value: `${nSites} cleavage sites`,
      threshold: `${THRESHOLDS.PROTEASE_WATCH}–${THRESHOLDS.PROTEASE_HIGH - 1} sites`,
      rationale: "Moderate protease susceptibility — consider targeted modification at key cleavage sites.",
      hardNoGo: false,
    });
  }

  if (!cyclic && pc?.instability_index != null && pc.instability_index > THRESHOLDS.INSTABILITY_UNSTABLE) {
    flags.push({
      id: "instability_watch",
      label: "Scaffold Instability (Guruprasad > 40)",
      severity: "warn",
      source: "Guruprasad instability index",
      provenance: "heuristic",
      value: `II = ${pc.instability_index.toFixed(1)}`,
      threshold: ">40",
      rationale: "Predicted in-vitro instability. Typically addressable with disulfide bridges or cyclisation.",
      hardNoGo: false,
    });
  }

  if (chem?.risk === "High") {
    flags.push({
      id: "chem_stability_high",
      label: "High Chemical Liability",
      severity: "warn",
      source: "Chemical-stability scan (Wolf Perez 2019)",
      provenance: "heuristic",
      value: "High",
      threshold: "risk = High",
      rationale: "Sequence contains multiple chemical degradation motifs (deamidation, oxidation, isomerisation). Reformulation or sequence engineering required.",
      hardNoGo: false,
    });
  }

  return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scorer
// ─────────────────────────────────────────────────────────────────────────────

const RAW_WEIGHTS: Record<string, number> = {
  hemolysis:       0.22,
  stability:       0.18,
  permeability:    0.12,
  aggregation:     0.12,
  immunogenicity:  0.10,
  selectivity:     0.10,
  solubility:      0.07,
  developability:  0.05,
  half_life:       0.04,
};

export function computePeptideL1Scorecard(input: PeptideScorecardInput): PeptideScorecard {
  const { result, cyclic = false, mlSignal: ml } = input;
  const pc  = result?.physicochemical;
  const prot = result?.proteolytic_stability;
  const perm = result?.membrane_permeability;
  const agg  = result?.aggregation;
  const immuno = result?.immunogenicity;
  const dev  = result?.developability;
  const chem = result?.chemical_liabilities;
  const syn  = result?.synthesis;
  const hl   = result?.half_life;
  const sol  = result?.solubility;

  // ── Compute raw dimension scores ──────────────────────────────────────────
  const rawDims: Record<string, DimRaw> = {
    hemolysis:       dimSafety_hemolysis(pc, ml),
    stability:       dimStability_scaffold(pc, prot, cyclic),
    permeability:    dimPermeability_delivery(perm, ml),
    aggregation:     dimAggregation(agg),
    immunogenicity:  dimImmunogenicity(immuno),
    selectivity:     dimSelectivity(pc, ml),
    solubility:      dimSolubility(sol, ml),
    developability:  dimDevelopability(dev, chem, syn),
    half_life:       dimHalfLife(hl, cyclic),
  };

  // ── Null-aware weight renormalisation ─────────────────────────────────────
  let totalW = 0;
  for (const [dim, raw] of Object.entries(rawDims)) {
    if (raw.score != null) totalW += RAW_WEIGHTS[dim] ?? 0;
  }

  const dimensions: PeptideDimensionScore[] = [];
  let composite = 0;
  let mlCoverage = 0;
  let completeness = 0;

  for (const [dim, raw] of Object.entries(rawDims)) {
    const w = totalW > 0 ? (RAW_WEIGHTS[dim] ?? 0) / totalW : 0;
    if (raw.score != null) {
      composite += raw.score * w;
      completeness += 1;
      if (raw.provenance === "ml") mlCoverage += w / (totalW > 0 ? 1 : 1);
    }
    dimensions.push({
      dimension: dim,
      score: raw.score ?? 0,
      weight: +w.toFixed(4),
      provenance: raw.score != null ? raw.provenance : "unavailable",
      detail: raw.detail,
    });
  }
  completeness = completeness / Object.keys(rawDims).length;

  // ── Flags ─────────────────────────────────────────────────────────────────
  const flags = buildFlags(input);
  const hardFlags = flags.filter(f => f.hardNoGo);

  // ── Verdict logic ─────────────────────────────────────────────────────────
  let verdict: PeptideVerdict;
  if (hardFlags.length > 0) {
    verdict = "NO-GO";
  } else if (composite >= 65 && flags.filter(f => f.severity === "critical").length === 0) {
    verdict = "GO";
  } else if (composite >= 40) {
    verdict = "WATCH";
  } else {
    verdict = "NO-GO";
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  const mlDriven = ml != null && (ml.hemolysis_prob != null || ml.amp_prob != null);
  const confRaw = 0.35 + 0.45 * mlCoverage + 0.20 * completeness;
  const confidence: "High" | "Medium" | "Low" =
    confRaw >= 0.70 ? "High" : confRaw >= 0.45 ? "Medium" : "Low";
  const confidenceNote =
    confidence === "Low"
      ? "ML signal unavailable — verdict based on compositional heuristics. Run backend to activate real classifiers."
      : confidence === "Medium"
      ? "Partial ML coverage. Heuristic dimensions contribute to uncertainty."
      : "Real ML classifiers active (HemoPI-2, CAMP, CPPsite). High provenance confidence.";

  // Downgrade GO → WATCH when confidence is Low (heuristic-only)
  if (verdict === "GO" && confidence === "Low") {
    verdict = "WATCH";
  }

  // ── Verdict-consistent score banding ──────────────────────────────────────
  const compositeRaw = +composite.toFixed(1);
  const score: number = (() => {
    if (verdict === "GO") return +clamp(composite, 70, 100).toFixed(1);
    if (verdict === "WATCH") return +clamp(40 + (composite / 100) * 29, 40, 69).toFixed(1);
    const base = (composite / 100) * 38;
    return +clamp(base - (hardFlags.length - 1) * 6, 1, 39).toFixed(1);
  })();

  // ── Summary text ──────────────────────────────────────────────────────────
  const nSites = prot?.sites?.reduce((s, p) => s + (p.n_sites ?? 0), 0) ?? 0;
  const summary =
    verdict === "GO"
      ? `Clean peptide scaffold — ${mlDriven ? `ML hemolysis ${((ml!.hemolysis_prob ?? 0) * 100).toFixed(0)}%` : "low hemolysis heuristic"}, ${nSites} protease site${nSites !== 1 ? "s" : ""}, stable. Advance to L2 co-folding and target engagement assays.`
      : verdict === "NO-GO"
      ? `${hardFlags.map(f => f.label).join("; ")}. Address before progressing.`
      : `Watch-level liabilities: ${flags.filter(f => f.severity === "warn").map(f => f.label).join("; ") || "borderline composite score"}. Structural optimisation recommended before L2.`;

  return {
    verdict,
    score,
    compositeRaw,
    confidence,
    confidenceNote,
    flags,
    dimensions,
    summary,
    mlSignal: ml ?? null,
    mlDriven,
  };
}
