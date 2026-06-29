/**
 * antibodyL1Scorecard.ts — Unified Go / Watch / No-Go scorecard for antibodies.
 *
 * Consumes the backend `AntibodyResult` (from antibody_properties.py) and the
 * ML signal from `/api/ai/antibody-ml` to produce a defensible triage verdict
 * aligned with the Therapeutic Antibody Profiler (TAP) framework:
 *
 *   Raybould et al. (2019) PNAS 116, 4025
 *   Jain et al. (2017) PNAS 114, 944
 *   Shire, Shahrokh & Liu (2004) J. Pharm. Sci. 93, 1390
 *
 * Verdict dimensions:
 *   1. CDR liabilities (deamidation, isomerisation, glycosylation, free-thiol)
 *   2. Aggregation / HIC retention (sequence-level hydrophobic patch)
 *   3. Immunogenicity / T-cell epitope load (MHC-II agretope proxy)
 *   4. Solubility (CamSol CDR score)
 *   5. Polyreactivity (cationic + aromatic CDR)
 *   6. FcRn recycling / half-life proxy
 *   7. Manufacturability / expression outlook
 *   8. Viscosity risk (high-conc SC formulation)
 *   9. Humanness proxy (composition vs IGHV/IGKV consensus)
 *
 * GO ∈ [70,100] · WATCH ∈ [40,69] · NO-GO ∈ [1,39]
 */

import type { AntibodyResult } from "./aiService";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AntibodyVerdict = "GO" | "WATCH" | "NO-GO";
export type AbProvenance = "ml" | "rule-based" | "heuristic" | "unavailable";

export interface AntibodyFlag {
  id: string;
  label: string;
  severity: "critical" | "warn" | "info";
  source: string;
  provenance: AbProvenance;
  value: string;
  threshold: string;
  rationale: string;
  hardNoGo: boolean;
}

export interface AntibodyDimensionScore {
  dimension: string;
  score: number;       // 0–100, higher = better/safer
  weight: number;      // renormalised weight in composite
  provenance: AbProvenance;
  detail: string;
}

export interface AntibodyScorecard {
  verdict: AntibodyVerdict;
  /** 0–100 triage score consistent with verdict band. */
  score: number;
  compositeRaw: number;
  confidence: "High" | "Medium" | "Low";
  confidenceNote: string;
  flags: AntibodyFlag[];
  dimensions: AntibodyDimensionScore[];
  summary: string;
}

export interface AntibodyScorecardInput {
  result: AntibodyResult;
  /** Output of `/api/ai/antibody-ml` — null if endpoint unreachable. */
  mlSignal?: {
    developability_tier?: string;
    n_liabilities_high?: number;
    n_liabilities_moderate?: number;
    cdr_solubility_camsol?: number;
    cdr_solubility_class?: string;
    heavy_solubility_camsol?: number;
    viscosity_risk_score?: number;
    fcrn_recycling_score?: string;
    expression_outlook?: string;
    predicted_solubility?: string;
    provenance?: string;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension scorers
// ─────────────────────────────────────────────────────────────────────────────

type DimRaw = { score: number | null; provenance: AbProvenance; detail: string };

function dimCdrLiabilities(result: AntibodyResult): DimRaw {
  const summary = result?.summary;
  if (!summary) return { score: null, provenance: "unavailable", detail: "No liability data" };
  const n_high = summary.n_liabilities_high ?? 0;
  const n_mod  = summary.n_liabilities_moderate ?? 0;
  let score = 90 - n_high * 20 - n_mod * 6;
  return {
    score: Math.max(0, score),
    provenance: "rule-based",
    detail: `${n_high} high-severity, ${n_mod} moderate liabilities (deamidation, isomerisation, glycosylation, free-thiol, oxidation)`,
  };
}

function dimAggregation(
  result: AntibodyResult,
  ml: AntibodyScorecardInput["mlSignal"],
): DimRaw {
  const cdrSol = ml?.cdr_solubility_camsol;
  if (cdrSol != null) {
    // CamSol CDR score: positive = soluble, negative = aggregation risk
    const score = Math.round(50 + cdrSol * 30);
    return {
      score: Math.max(0, Math.min(100, score)),
      provenance: "ml",
      detail: `CamSol CDR score ${cdrSol.toFixed(3)} (Sormanni 2017). Viscosity risk score: ${ml?.viscosity_risk_score ?? "—"}`,
    };
  }
  // Fall back to rule-based developability tier
  const tier = result?.summary?.developability_tier ?? "";
  const score = /red/i.test(tier) ? 20 : /amber/i.test(tier) ? 55 : 80;
  return {
    score,
    provenance: "rule-based",
    detail: `TAP developability tier: ${tier || "unknown"}`,
  };
}

function dimImmunogenicity(result: AntibodyResult): DimRaw {
  // Use immunogenicity data from the first chain
  const chains = result?.chains ?? [];
  let maxAgretopes = 0;
  let band = "Low";
  for (const c of chains) {
    const immuno = (c as any).immunogenicity;
    if (!immuno) continue;
    const n = immuno.candidate_agretope_windows ?? 0;
    if (n > maxAgretopes) {
      maxAgretopes = n;
      band = immuno.band ?? "Low";
    }
  }
  if (chains.length === 0) return { score: null, provenance: "unavailable", detail: "No chain data" };
  const score = /elevated/i.test(band) ? 20 : /moderate/i.test(band) ? 55 : 85;
  return {
    score,
    provenance: "heuristic",
    detail: `Max agretope windows: ${maxAgretopes}, band: ${band}`,
  };
}

function dimHumanness(result: AntibodyResult): DimRaw {
  const chains = result?.chains ?? [];
  if (chains.length === 0) return { score: null, provenance: "unavailable", detail: "No chains" };
  let minSim: number | null = null;
  for (const c of chains) {
    const immuno = (c as any).immunogenicity;
    const h = immuno?.humanness;
    if (h?.similarity_pct != null) {
      if (minSim == null || h.similarity_pct < minSim) minSim = h.similarity_pct;
    }
  }
  if (minSim == null) return { score: 50, provenance: "heuristic", detail: "Humanness unavailable — defaulting to 50" };
  const score = Math.round(minSim);
  return {
    score,
    provenance: "heuristic",
    detail: `Composition-vs-IGHV/IGKV consensus humanness: ${minSim.toFixed(1)}%`,
  };
}

function dimPolyreactivity(result: AntibodyResult): DimRaw {
  const chains = result?.chains ?? [];
  if (chains.length === 0) return { score: null, provenance: "unavailable", detail: "No chains" };
  // Use CDR composition flags from cdr_composition
  const cdrComps = (result as any).cdr_composition ?? [];
  let redCount = 0, amberCount = 0;
  for (const cdr of cdrComps) {
    if (cdr.tap_status === "RED") redCount++;
    else if (cdr.tap_status === "AMBER") amberCount++;
  }
  let score = 85 - redCount * 20 - amberCount * 8;
  return {
    score: Math.max(0, score),
    provenance: "rule-based",
    detail: `CDR TAP flags: ${redCount} RED, ${amberCount} AMBER (hydrophobicity, charge, aromaticity)`,
  };
}

function dimFcRnHalfLife(
  result: AntibodyResult,
  ml: AntibodyScorecardInput["mlSignal"],
): DimRaw {
  const mlScore = ml?.fcrn_recycling_score;
  const fcrn = (result as any).fcrn_binding;
  const score_str = mlScore ?? fcrn?.overall_fcrn_score;
  if (!score_str) return { score: null, provenance: "unavailable", detail: "No FcRn data" };
  const score = /high/i.test(score_str) ? 90 : /moderate/i.test(score_str) ? 60 : 25;
  return {
    score,
    provenance: "rule-based",
    detail: `FcRn recycling: ${score_str}. ${fcrn?.t_half_implication ?? ""}`,
  };
}

function dimManufacturability(
  result: AntibodyResult,
  ml: AntibodyScorecardInput["mlSignal"],
): DimRaw {
  const outlook = ml?.expression_outlook ?? (result as any).manufacturability?.expression_outlook ?? "";
  if (!outlook) return { score: null, provenance: "unavailable", detail: "No manufacturability data" };
  const score = /favourable/i.test(outlook) ? 90 : /moderate/i.test(outlook) ? 60 : /challenging/i.test(outlook) ? 25 : 50;
  return {
    score,
    provenance: "rule-based",
    detail: `Expression outlook: ${outlook}`,
  };
}

function dimViscosity(
  result: AntibodyResult,
  ml: AntibodyScorecardInput["mlSignal"],
): DimRaw {
  const riskScore = ml?.viscosity_risk_score ?? (result as any).viscosity_risk?.risk_score ?? null;
  if (riskScore == null) return { score: null, provenance: "unavailable", detail: "No viscosity data" };
  const score = riskScore >= 5 ? 10 : riskScore >= 2 ? 55 : 90;
  const risk = riskScore >= 5 ? "High" : riskScore >= 2 ? "Moderate" : "Low";
  return {
    score,
    provenance: "rule-based",
    detail: `Viscosity risk score ${riskScore} (${risk}) — SC formulation concern at ≥100 mg/mL`,
  };
}

function dimStability(result: AntibodyResult): DimRaw {
  const stability = (result as any).stability;
  if (!stability) return { score: null, provenance: "unavailable", detail: "No stability data" };
  const outlook = stability.outlook ?? "";
  const score = /favourable/i.test(outlook) ? 90 : /monitor/i.test(outlook) ? 55 : 20;
  return {
    score,
    provenance: "rule-based",
    detail: `Stability outlook: ${outlook}. ${stability.signals?.length ?? 0} signals`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flag builder
// ─────────────────────────────────────────────────────────────────────────────

function buildAntibodyFlags(input: AntibodyScorecardInput): AntibodyFlag[] {
  const flags: AntibodyFlag[] = [];
  const { result, mlSignal: ml } = input;
  const summary = result?.summary;
  const fcrn = (result as any).fcrn_binding;
  const viscosity = (result as any).viscosity_risk;
  const manufact = (result as any).manufacturability;

  // ── Hard No-Go ─────────────────────────────────────────────────────────────

  if ((summary?.n_liabilities_high ?? 0) >= 4) {
    flags.push({
      id: "liabilities_critical",
      label: "Critical CDR Liability Count",
      severity: "critical",
      source: "antibody_properties.py liability scan",
      provenance: "rule-based",
      value: `${summary?.n_liabilities_high} high-severity liabilities`,
      threshold: "≥4 high-severity",
      rationale: "≥4 high-severity CDR liabilities (free-thiol, glycosylation, Asn deamidation, Asp isomerisation) indicate a developability-unfeasible sequence without significant engineering.",
      hardNoGo: true,
    });
  }

  // CDR free-thiol (unpaired cysteine) — hard No-Go
  const chains = result?.chains ?? [];
  for (const chain of chains) {
    const liabs = (chain as any).liabilities ?? [];
    if (liabs.some((l: any) => l.type === "Unpaired cysteine" && l.severity === "high")) {
      flags.push({
        id: "free_thiol_chain",
        label: "Unpaired Cysteine (Free Thiol)",
        severity: "critical",
        source: "CDR liability scan (antibody_properties.py)",
        provenance: "rule-based",
        value: `${(chain as any).label} — odd Cys count`,
        threshold: "Any unpaired Cys (odd count)",
        rationale: "Free thiols drive covalent aggregation and disulfide scrambling during expression and storage. Must be resolved before any CMC work.",
        hardNoGo: true,
      });
      break;
    }
  }

  // ── Watch flags ────────────────────────────────────────────────────────────

  if ((summary?.n_liabilities_high ?? 0) >= 2 && (summary?.n_liabilities_high ?? 0) < 4) {
    flags.push({
      id: "liabilities_watch",
      label: "Multiple High-Severity Liabilities",
      severity: "warn",
      source: "antibody_properties.py liability scan",
      provenance: "rule-based",
      value: `${summary?.n_liabilities_high} high-severity liabilities`,
      threshold: "2–3 high-severity",
      rationale: "Multiple high-severity CDR liabilities. Engineering to remove deamidation/isomerisation hotspots and glycosylation sequons is recommended before advancing.",
      hardNoGo: false,
    });
  }

  const devTier = summary?.developability_tier ?? ml?.developability_tier ?? "";
  if (/red/i.test(devTier)) {
    flags.push({
      id: "tap_red",
      label: "TAP Red — Developability Concern",
      severity: "warn",
      source: "Therapeutic Antibody Profiler (Raybould 2019)",
      provenance: "rule-based",
      value: devTier,
      threshold: "TAP tier = Red",
      rationale: "Combined CDR length / hydrophobicity / charge flags outside the clinical-stage antibody space (Raybould 2019). Sequence engineering or reformulation recommended.",
      hardNoGo: false,
    });
  }

  if (viscosity?.risk_score >= 5 || ml?.viscosity_risk_score != null && (ml.viscosity_risk_score >= 5)) {
    flags.push({
      id: "viscosity_high",
      label: "High Viscosity Risk at SC Concentrations",
      severity: "warn",
      source: "Sequence-level viscosity model (Shire 2004 / Sharma 2014)",
      provenance: "rule-based",
      value: `risk score ${viscosity?.risk_score ?? ml?.viscosity_risk_score ?? "—"}`,
      threshold: "risk score ≥5",
      rationale: "High predicted viscosity at ≥100 mg/mL subcutaneous concentrations. Engineering or formulation excipients required for SC delivery.",
      hardNoGo: false,
    });
  }

  if (fcrn?.overall_fcrn_score === "Low") {
    flags.push({
      id: "fcrn_low",
      label: "Suboptimal FcRn Recycling",
      severity: "warn",
      source: "pH-based FcRn model (Saxena & Wu 2016)",
      provenance: "rule-based",
      value: "Low",
      threshold: "FcRn score = Low",
      rationale: fcrn.t_half_implication ?? "Poor pH-switch signature — FcRn-mediated recycling may be impaired, shortening plasma half-life.",
      hardNoGo: false,
    });
  }

  if (/elevated/i.test(((chains[0] as any)?.immunogenicity?.band) ?? "")) {
    flags.push({
      id: "immuno_elevated",
      label: "Elevated T-Cell Epitope Load",
      severity: "warn",
      source: "Hydrophobic 15-mer agretope proxy",
      provenance: "heuristic",
      value: "Elevated",
      threshold: "band = Elevated",
      rationale: "High immunogenicity signal from agretope scan. Consider deimmunisation of the identified CDR windows.",
      hardNoGo: false,
    });
  }

  if (/challenging/i.test(manufact?.expression_outlook ?? "")) {
    flags.push({
      id: "expression_challenging",
      label: "Challenging Expression Outlook",
      severity: "warn",
      source: "Manufacturability assessment (antibody_properties.py)",
      provenance: "rule-based",
      value: manufact?.expression_outlook ?? "Challenging",
      threshold: "outlook = Challenging",
      rationale: "Sequence features predict low transient-expression titer. Address free thiols, instability, and CDR hotspots before entering CMC.",
      hardNoGo: false,
    });
  }

  return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scorer
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

const AB_WEIGHTS: Record<string, number> = {
  cdr_liabilities:   0.22,
  aggregation:       0.17,
  immunogenicity:    0.13,
  humanness:         0.10,
  polyreactivity:    0.10,
  fcrn_halflife:     0.10,
  manufacturability: 0.08,
  viscosity:         0.06,
  stability:         0.04,
};

export function computeAntibodyL1Scorecard(input: AntibodyScorecardInput): AntibodyScorecard {
  const { result, mlSignal: ml } = input;

  const rawDims: Record<string, DimRaw> = {
    cdr_liabilities:   dimCdrLiabilities(result),
    aggregation:       dimAggregation(result, ml),
    immunogenicity:    dimImmunogenicity(result),
    humanness:         dimHumanness(result),
    polyreactivity:    dimPolyreactivity(result),
    fcrn_halflife:     dimFcRnHalfLife(result, ml),
    manufacturability: dimManufacturability(result, ml),
    viscosity:         dimViscosity(result, ml),
    stability:         dimStability(result),
  };

  // Null-aware renormalisation
  let totalW = 0;
  for (const [dim, raw] of Object.entries(rawDims)) {
    if (raw.score != null) totalW += AB_WEIGHTS[dim] ?? 0;
  }

  const dimensions: AntibodyDimensionScore[] = [];
  let composite = 0;
  let mlCoverage = 0;
  let completeness = 0;

  for (const [dim, raw] of Object.entries(rawDims)) {
    const w = totalW > 0 ? (AB_WEIGHTS[dim] ?? 0) / totalW : 0;
    if (raw.score != null) {
      composite += raw.score * w;
      completeness++;
      if (raw.provenance === "ml") mlCoverage += w;
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

  const flags = buildAntibodyFlags(input);
  const hardFlags = flags.filter(f => f.hardNoGo);

  let verdict: AntibodyVerdict;
  if (hardFlags.length > 0) {
    verdict = "NO-GO";
  } else if (composite >= 65 && flags.filter(f => f.severity === "critical").length === 0) {
    verdict = "GO";
  } else if (composite >= 40) {
    verdict = "WATCH";
  } else {
    verdict = "NO-GO";
  }

  const hasMl = ml != null;
  const confRaw = 0.35 + 0.45 * mlCoverage + 0.20 * completeness;
  const confidence: "High" | "Medium" | "Low" =
    hasMl && confRaw >= 0.55 ? "High"
    : confRaw >= 0.40 ? "Medium"
    : "Low";
  const confidenceNote =
    confidence === "High"
      ? "ML-enriched signal (CamSol CDR solubility, FcRn model, viscosity score) integrated with rule-based TAP metrics."
      : confidence === "Medium"
      ? "Rule-based assessment with partial ML coverage. Confirm with L2 structural analysis."
      : "No ML signal available — pure rule-based triage. Wire up backend for improved confidence.";

  if (verdict === "GO" && confidence === "Low") {
    verdict = "WATCH";
  }

  const compositeRaw = +composite.toFixed(1);
  const score: number = (() => {
    if (verdict === "GO") return +clamp(composite, 70, 100).toFixed(1);
    if (verdict === "WATCH") return +clamp(40 + (composite / 100) * 29, 40, 69).toFixed(1);
    const base = (composite / 100) * 38;
    return +clamp(base - (hardFlags.length - 1) * 6, 1, 39).toFixed(1);
  })();

  const n_high = result?.summary?.n_liabilities_high ?? 0;
  const devTier = result?.summary?.developability_tier ?? "";
  const summary =
    verdict === "GO"
      ? `Clean antibody scaffold — ${n_high} high-severity liabilities, ${devTier.includes("Green") ? "green TAP tier" : devTier.split("—")[0]}. Advance to L2 structural assessment and binding confirmation.`
      : verdict === "NO-GO"
      ? `${hardFlags.map(f => f.label).join("; ")}. Engineering required before CMC.`
      : `Watch-level: ${flags.filter(f => f.severity === "warn").map(f => f.label).slice(0, 3).join("; ") || "borderline composite"}. Targeted sequence engineering recommended.`;

  return { verdict, score, compositeRaw, confidence, confidenceNote, flags, dimensions, summary };
}
