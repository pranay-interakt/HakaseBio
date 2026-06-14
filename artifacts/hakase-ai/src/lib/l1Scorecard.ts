/**
 * Layer 1 — Unified Go / Watch / No-Go Scorecard
 * ─────────────────────────────────────────────────────────────────────────
 * A single, calibrated decision layer that consumes the real L1 outputs
 * (ADMET 5-axis from `runAdmetSimulation`, the in-vitro panel from
 * `runInVitroSimulation`, and the ML overlay from `buildMlOverlay`) and
 * produces a defensible preclinical triage verdict the way an industry
 * portfolio committee would:
 *
 *   1. FLAG-BASED HARD OVERRIDES (No-Go) — deterministic chemistry / strong
 *      ML liabilities that veto a candidate regardless of the composite
 *      score (structural hard-reject alerts, hERG block, DILI, mutagenicity,
 *      clinical-tox, carcinogenicity, gross drug-likeness failure). A single
 *      hard flag forces NO-GO. This mirrors real stage-gate practice: you do
 *      not average away a genotoxic alert with good permeability.
 *
 *   2. WEIGHTED CALIBRATED COMPOSITE (0–100) — a null-aware weighted blend of
 *      potency, ADME, safety and developability sub-scores. Weights are
 *      renormalised over the dimensions that actually have data, so a
 *      molecule is never penalised for an endpoint the pipeline could not
 *      compute.
 *
 *   3. CONFIDENCE — driven by how much of the *safety-critical* signal came
 *      from real ML inference (provenance "ml") versus heuristic fallback,
 *      and by data completeness. A GO built on heuristics is downgraded to
 *      WATCH: we never issue a high-confidence GO on fabricated certainty.
 *
 * Provenance discipline matches the rest of L1 — every sub-score and every
 * flag carries the source it came from, and nothing here invents a number.
 * When an endpoint is unavailable the dimension is dropped (not defaulted
 * to a flattering value), and that absence lowers confidence.
 *
 * This module is pure and side-effect-free; pass it the already-computed
 * results and it returns the scorecard.
 */

import type { SimResults } from "./admet";
import type { InVitroResults } from "./inVitroSim";
import type { MlOverlay } from "./mlOverlay";

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export type L1Verdict = "GO" | "WATCH" | "NO-GO";
export type Provenance = "ml" | "heuristic" | "experimental" | "unavailable";

export interface L1Flag {
  /** Stable id for testing / de-duplication. */
  id: string;
  /** Short human label. */
  label: string;
  severity: "critical" | "warn" | "info";
  /** Model / rule that raised it. */
  source: string;
  provenance: Provenance;
  /** Observed value, formatted for display. */
  value: string;
  /** Threshold convention that triggered the flag. */
  threshold: string;
  /** One-sentence "why this matters". */
  rationale: string;
  /** True when this flag alone forces a NO-GO (hard veto). */
  hardNoGo: boolean;
}

export interface L1DimensionScore {
  dimension: string;
  /** 0–100, higher is better/safer. */
  score: number;
  /** Normalised weight actually applied in the composite. */
  weight: number;
  provenance: Provenance;
  detail: string;
}

export interface L1Scorecard {
  verdict: L1Verdict;
  /**
   * 0–100 verdict-consistent TRIAGE score — the number to rank a library by.
   * It is banded so it can never disagree with the verdict: GO ∈ [70,100],
   * WATCH ∈ [40,69], NO-GO ∈ [1,39]. Within a band, ordering follows the raw
   * endpoint composite, and NO-GO compounds are pushed lower for each
   * additional hard liability. This guarantees that sorting thousands of
   * compounds by `score` puts the genuinely advanceable ones on top and never
   * ranks a hard-vetoed compound above a salvageable one.
   */
  score: number;
  /**
   * The raw weighted endpoint composite (0–100) BEFORE verdict banding —
   * surfaced for transparency so reviewers can see that a vetoed compound may
   * have otherwise-good properties (e.g. terfenadine: clean ADME, fatal hERG).
   */
  compositeRaw: number;
  /** 0–1 confidence in the verdict. */
  confidence: number;
  confidenceLabel: "High" | "Moderate" | "Low";
  /** One-line headline for the UI badge. */
  headline: string;
  /** Paragraph rationale. */
  rationale: string;
  /** Sorted critical → warn → info. */
  flags: L1Flag[];
  dimensions: L1DimensionScore[];
  /** Fraction of safety-critical dimensions backed by real ML. */
  mlCoverage: number;
  recommendation: string;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Calibrated decision thresholds (single source of truth)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Hard-veto probability thresholds. These are deliberately conservative and
 * aligned with the consensus used across the platform's ML arbitration:
 *   - hERG: >0.80 blocker probability ≈ torsadogenic liability (Redfern margin
 *     logic) — a development-stopping cardiac risk absent mitigation.
 *   - DILI: >0.80 (or categorical "High") — idiosyncratic hepatotoxicity is
 *     the leading cause of post-marketing withdrawal.
 *   - Ames: >0.75 — bacterial mutagenicity is a genotoxic stop unless an
 *     impurity-level control strategy applies.
 *   - ClinTox: >0.80 — high modelled probability of clinical-trial toxicity
 *     failure.
 *   - Carcinogen: >0.80 — rodent carcinogenicity liability.
 */
const HARD = {
  herg: 0.80,
  dili: 0.80,
  ames: 0.75,
  clintox: 0.80,
  carcinogen: 0.80,
  lipinskiViolations: 3,
} as const;

/** Soft (WATCH) thresholds — borderline liabilities that warrant monitoring. */
const WATCH = {
  herg: 0.50,
  dili: 0.50,
  ames: 0.50,
  clintox: 0.55,
  carcinogen: 0.55,
  cypStrongInhib: 0.70,
  therapeuticIndex: 10,
  lipinskiViolations: 2,
  composite: 60,
} as const;

/** Composite floor for a clean GO (no warn flags, adequate confidence). */
const GO_COMPOSITE = 72;

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** Safety sub-score from a liability probability: safe = (1 - p), 0–100. */
function safetyFromProb(p: number): number {
  return clamp((1 - p) * 100);
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────

export interface L1ScorecardInput {
  admet: SimResults;
  inVitro: InVitroResults;
  /** ML overlay (may be all-null when the AI-service was unavailable). */
  overlay?: MlOverlay | null;
}

export function computeL1Scorecard(input: L1ScorecardInput): L1Scorecard {
  const { admet, inVitro } = input;
  const o = input.overlay ?? null;
  const ivProv = inVitro.provenance ?? {};
  const adProv = admet.provenance ?? {};

  const flags: L1Flag[] = [];
  const dims: L1DimensionScore[] = [];

  // helper to register a flag
  const flag = (f: L1Flag) => flags.push(f);
  // helper to register a dimension with an intended (pre-normalisation) weight
  const rawDims: Array<L1DimensionScore & { rawWeight: number }> = [];
  const dim = (
    dimension: string,
    score: number | null,
    rawWeight: number,
    provenance: Provenance,
    detail: string,
  ) => {
    if (score === null || !Number.isFinite(score)) return; // unavailable → dropped
    rawDims.push({ dimension, score: clamp(score), weight: 0, rawWeight, provenance, detail });
  };

  // ── 1. POTENCY / EFFICACY ──────────────────────────────────────────────
  const ic50 = inVitro.doseResponse.ic50_nM;
  if (ic50 !== null) {
    const potScore =
      ic50 < 10 ? 96 : ic50 < 50 ? 90 : ic50 < 200 ? 80 : ic50 < 1000 ? 66 : ic50 < 5000 ? 50 : 35;
    const prov: Provenance = ivProv.doseResponse_IC50 === "ml" ? "ml" : "heuristic";
    dim("Potency (on-target)", potScore, 0.12, prov,
      `On-target IC50 ≈ ${ic50.toFixed(1)} nM${inVitro.doseResponse.potencyClass ? ` (${inVitro.doseResponse.potencyClass})` : ""}`);
  }

  // ── 2. ABSORPTION / PERMEABILITY ───────────────────────────────────────
  dim("Absorption", admet.admet.absorption * 100, 0.10,
    adProv.absorption === "ml" ? "ml" : "heuristic",
    `Caco-2 ${inVitro.permeability.caco2Class}, HIA/permeability composite ${(admet.admet.absorption * 100).toFixed(0)}/100`);

  // ── 3. METABOLIC STABILITY ─────────────────────────────────────────────
  dim("Metabolic stability", admet.admet.metabolism * 100, 0.10,
    adProv.metabolism === "ml" ? "ml" : "heuristic",
    `Hepatic stability composite ${(admet.admet.metabolism * 100).toFixed(0)}/100; microsomal ${inVitro.metabolicStability.microsomalClass}`);

  // ── 4. DISTRIBUTION ────────────────────────────────────────────────────
  dim("Distribution", admet.admet.distribution * 100, 0.06,
    adProv.distribution === "ml" ? "ml" : "heuristic",
    `PPB ${inVitro.plasmaProteinBinding.bindingClass}, distribution composite ${(admet.admet.distribution * 100).toFixed(0)}/100`);

  // ── 5. SAFETY: hERG (cardiac) ──────────────────────────────────────────
  if (o?.herg_blocker_prob != null) {
    const p = o.herg_blocker_prob;
    dim("Cardiac (hERG)", safetyFromProb(p), 0.14, "ml",
      `CardioTox-ML blocker probability ${pct(p)}`);
    if (p > HARD.herg) {
      flag({ id: "herg_hard", label: "hERG block — high cardiac risk", severity: "critical",
        source: "CardioTox-ML (Wang/Karim hERG RF)", provenance: "ml",
        value: `blocker p = ${pct(p)}`, threshold: `> ${pct(HARD.herg)}`,
        rationale: "Strong predicted hERG block implies torsadogenic / QT-prolongation liability that stops development absent structural mitigation.",
        hardNoGo: true });
    } else if (p >= WATCH.herg) {
      flag({ id: "herg_watch", label: "Moderate hERG signal", severity: "warn",
        source: "CardioTox-ML", provenance: "ml",
        value: `blocker p = ${pct(p)}`, threshold: `${pct(WATCH.herg)}–${pct(HARD.herg)}`,
        rationale: "Borderline cardiac liability — confirm with patch-clamp and track the safety margin vs efficacious exposure.",
        hardNoGo: false });
    }
  } else {
    // heuristic hERG band from the in-vitro engine
    const cat = inVitro.herg.riskCategory;
    const hScore = cat === "High" ? 30 : cat === "Moderate" ? 60 : 88;
    dim("Cardiac (hERG)", hScore, 0.14, "heuristic", `hERG risk ${cat} (physchem heuristic — no ML / patch-clamp)`);
    if (cat === "High") {
      flag({ id: "herg_heur_watch", label: "hERG risk High (heuristic)", severity: "warn",
        source: "In-vitro physchem rule", provenance: "heuristic",
        value: `risk = High`, threshold: `IC50 < 1 µM band`,
        rationale: "Heuristic flags a cardiac liability; obtain the CardioTox-ML or patch-clamp readout before a NO-GO/GO call.",
        hardNoGo: false });
    }
  }

  // ── 6. SAFETY: DILI (hepatic) ──────────────────────────────────────────
  if (o?.dili_prob != null) {
    const p = o.dili_prob;
    dim("Hepatic (DILI)", safetyFromProb(p), 0.14, "ml", `DILI-ML probability ${pct(p)} (${o.dili_risk_class ?? "—"})`);
    if (p > HARD.dili || o.dili_risk_class === "High") {
      flag({ id: "dili_hard", label: "DILI — high hepatotoxicity risk", severity: "critical",
        source: "DILI-ML (DILIrank RF)", provenance: "ml",
        value: `p = ${pct(p)}${o.dili_risk_class ? `, class ${o.dili_risk_class}` : ""}`, threshold: `> ${pct(HARD.dili)} or class High`,
        rationale: "Predicted drug-induced liver injury is the leading cause of clinical attrition and post-market withdrawal.",
        hardNoGo: true });
    } else if (p >= WATCH.dili || o.dili_risk_class === "Moderate") {
      flag({ id: "dili_watch", label: "Moderate DILI signal", severity: "warn",
        source: "DILI-ML", provenance: "ml",
        value: `p = ${pct(p)}`, threshold: `${pct(WATCH.dili)}–${pct(HARD.dili)}`,
        rationale: "Monitor hepatic markers; consider covalent-/reactive-metabolite de-risking.",
        hardNoGo: false });
    }
  } else {
    dim("Hepatic (DILI)", admet.admet.toxicity * 100 * 0.9, 0.10, "heuristic", "No DILI-ML signal — using ADMET toxicity composite (heuristic)");
  }

  // ── 7. SAFETY: GENOTOXICITY (Ames) ─────────────────────────────────────
  if (o?.ames_prob != null) {
    const p = o.ames_prob;
    dim("Genotoxicity (Ames)", safetyFromProb(p), 0.10, "ml", `ADMET-AI Ames probability ${pct(p)}`);
    if (p > HARD.ames) {
      flag({ id: "ames_hard", label: "Mutagenicity (Ames) liability", severity: "critical",
        source: "ADMET-AI (Chemprop)", provenance: "ml",
        value: `p = ${pct(p)}`, threshold: `> ${pct(HARD.ames)}`,
        rationale: "High predicted bacterial mutagenicity is a genotoxic stop unless a qualified control strategy applies.",
        hardNoGo: true });
    } else if (p >= WATCH.ames) {
      flag({ id: "ames_watch", label: "Borderline mutagenicity signal", severity: "warn",
        source: "ADMET-AI", provenance: "ml",
        value: `p = ${pct(p)}`, threshold: `${pct(WATCH.ames)}–${pct(HARD.ames)}`,
        rationale: "Run an Ames screen and inspect structural alerts before advancing.",
        hardNoGo: false });
    }
  }

  // ── 8. SAFETY: OTHER TOX (ClinTox / Carcinogenicity) ───────────────────
  const otherProbs: number[] = [];
  if (o?.clintox_prob != null) otherProbs.push(o.clintox_prob);
  if (o?.carcinogen_prob != null) otherProbs.push(o.carcinogen_prob);
  if (otherProbs.length > 0) {
    const worst = Math.max(...otherProbs);
    dim("Other toxicity", safetyFromProb(worst), 0.06, "ml",
      `ClinTox/Carcinogen worst-case ${pct(worst)}`);
  }
  if (o?.clintox_prob != null && o.clintox_prob > HARD.clintox) {
    flag({ id: "clintox_hard", label: "High clinical-tox probability", severity: "critical",
      source: "ADMET-AI ClinTox", provenance: "ml",
      value: `p = ${pct(o.clintox_prob)}`, threshold: `> ${pct(HARD.clintox)}`,
      rationale: "Model predicts a high likelihood of clinical-trial toxicity failure.", hardNoGo: true });
  }
  if (o?.carcinogen_prob != null && o.carcinogen_prob > HARD.carcinogen) {
    flag({ id: "carc_hard", label: "Carcinogenicity liability", severity: "critical",
      source: "ADMET-AI Carcinogens", provenance: "ml",
      value: `p = ${pct(o.carcinogen_prob)}`, threshold: `> ${pct(HARD.carcinogen)}`,
      rationale: "High predicted rodent carcinogenicity.", hardNoGo: true });
  }

  // ── 9. SELECTIVITY ─────────────────────────────────────────────────────
  if (inVitro.selectivity.kinaseSelectivityScore !== null) {
    const s = inVitro.selectivity.kinaseSelectivityScore;
    dim("Selectivity", s * 100, 0.08,
      ivProv.selectivity === "ml" ? "ml" : "heuristic",
      `In-silico selectivity ${inVitro.selectivity.selectivityClass ?? "—"} (score ${(s * 100).toFixed(0)}/100)`);
    if (inVitro.selectivity.selectivityClass === "Non-Selective") {
      flag({ id: "selectivity_watch", label: "Predicted promiscuity", severity: "warn",
        source: "In-silico promiscuity model", provenance: "heuristic",
        value: `class Non-Selective`, threshold: `selectivity score < 0.5`,
        rationale: "High predicted off-target promiscuity raises the chance of mechanism-independent toxicity.", hardNoGo: false });
    }
  }

  // ── 10. DRUG-LIKENESS / DEVELOPABILITY ─────────────────────────────────
  const viol = admet.lipinski.violations;
  const dlScore = clamp(
    admet.qed_approx * 70                         // QED contributes most
    + (1 - Math.min(viol, 4) / 4) * 20            // Lipinski cleanliness
    + (1 - Math.min(Math.max(admet.saScore - 1, 0), 9) / 9) * 10, // synthesisability
  );
  dim("Drug-likeness", dlScore, 0.10, "heuristic",
    `QED ${admet.qed_approx.toFixed(2)}, Ro5 violations ${viol}, SA ${admet.saScore.toFixed(1)}`);
  if (viol >= HARD.lipinskiViolations) {
    flag({ id: "ro5_hard", label: "Gross drug-likeness failure", severity: "critical",
      source: "Lipinski Ro5", provenance: "heuristic",
      value: `${viol} violations`, threshold: `≥ ${HARD.lipinskiViolations}`,
      rationale: "Three or more Ro5 violations predict poor oral absorption and high developability risk.", hardNoGo: true });
  } else if (viol >= WATCH.lipinskiViolations) {
    flag({ id: "ro5_watch", label: "Borderline drug-likeness", severity: "warn",
      source: "Lipinski Ro5", provenance: "heuristic",
      value: `${viol} violations`, threshold: `${WATCH.lipinskiViolations}`,
      rationale: "Two Ro5 violations warrant attention to formulation / route.", hardNoGo: false });
  }

  // ── 11. STRUCTURAL HARD-REJECT ALERTS (deterministic chemistry) ────────
  const sa = admet.structuralAlerts;
  if (sa?.scanRan && sa.rejectCount > 0) {
    flag({ id: "struct_hard", label: "Structural hard-reject alert", severity: "critical",
      source: "Structural alert scan (Brenk/BMS/NIH)", provenance: "experimental",
      value: sa.rejectNames.slice(0, 3).join("; ") + (sa.rejectCount > 3 ? " +more" : ""),
      threshold: "any hard-reject motif",
      rationale: "Reactive / genotoxic substructures are deterministic chemical liabilities that veto advancement irrespective of probabilistic ML scores.",
      hardNoGo: true });
  }

  // ── 12. CYP DDI (metabolism modifier WATCH) ────────────────────────────
  const cypProbs = [o?.cyp3a4_inhibitor_prob, o?.cyp2d6_inhibitor_prob, o?.cyp2c9_inhibitor_prob].filter(
    (p): p is number => typeof p === "number" && Number.isFinite(p));
  if (cypProbs.length > 0 && Math.max(...cypProbs) >= WATCH.cypStrongInhib) {
    flag({ id: "cyp_watch", label: "Strong CYP inhibition (DDI risk)", severity: "warn",
      source: "ADMET-AI Veith CYP heads", provenance: "ml",
      value: `max p = ${pct(Math.max(...cypProbs))}`, threshold: `≥ ${pct(WATCH.cypStrongInhib)}`,
      rationale: "Strong CYP inhibition predicts drug–drug-interaction risk; check victim/perpetrator exposure.", hardNoGo: false });
  }

  // ── 13. THERAPEUTIC INDEX (WATCH) ──────────────────────────────────────
  if (ic50 !== null && inVitro.cellViability.therapeuticIndex > 0 &&
      inVitro.cellViability.therapeuticIndex < WATCH.therapeuticIndex) {
    flag({ id: "ti_watch", label: "Narrow therapeutic index", severity: "warn",
      source: "In-vitro CC50 / IC50", provenance: ivProv.cc50_uM === "ml" ? "ml" : "heuristic",
      value: `TI ≈ ${inVitro.cellViability.therapeuticIndex}`, threshold: `< ${WATCH.therapeuticIndex}`,
      rationale: "Cytotoxicity is close to the efficacious concentration — limited safety window.", hardNoGo: false });
  }

  // ── Composite score (null-aware weight renormalisation) ────────────────
  const totalRaw = rawDims.reduce((s, d) => s + d.rawWeight, 0) || 1;
  for (const d of rawDims) {
    d.weight = +(d.rawWeight / totalRaw).toFixed(4);
    dims.push({ dimension: d.dimension, score: +d.score.toFixed(1), weight: d.weight, provenance: d.provenance, detail: d.detail });
  }
  const composite = +rawDims.reduce((s, d) => s + d.score * d.weight, 0).toFixed(1);

  // ── Confidence: ML coverage of safety-critical dims + completeness ─────
  const safetyDims = dims.filter(d => /hERG|DILI|Ames|toxicity/i.test(d.dimension));
  const safetyMl = safetyDims.filter(d => d.provenance === "ml").length;
  const mlCoverage = safetyDims.length > 0 ? +(safetyMl / safetyDims.length).toFixed(2) : 0;
  // completeness: how many of the 10 canonical dimensions were computable.
  const completeness = Math.min(1, dims.length / 9);
  const confidence = +clamp(0.35 + 0.45 * mlCoverage + 0.20 * completeness, 0, 1).toFixed(2);
  const confidenceLabel: L1Scorecard["confidenceLabel"] =
    confidence >= 0.75 ? "High" : confidence >= 0.55 ? "Moderate" : "Low";

  // ── Verdict ────────────────────────────────────────────────────────────
  const hardFlags = flags.filter(f => f.hardNoGo);
  const warnFlags = flags.filter(f => f.severity === "warn");

  let verdict: L1Verdict;
  if (hardFlags.length > 0) {
    verdict = "NO-GO";
  } else if (warnFlags.length > 0 || composite < WATCH.composite) {
    verdict = "WATCH";
  } else if (composite >= GO_COMPOSITE) {
    verdict = "GO";
  } else {
    verdict = "WATCH";
  }
  // Conservative confidence gate: never issue a high-stakes GO on low
  // confidence (mostly-heuristic evidence). Downgrade to WATCH and say so.
  let confidenceDowngrade = false;
  if (verdict === "GO" && confidenceLabel === "Low") {
    verdict = "WATCH";
    confidenceDowngrade = true;
  }

  // ── Verdict-consistent triage score (the library-ranking number) ────────
  // Band the raw composite so the score can never disagree with the verdict:
  // GO ∈ [70,100], WATCH ∈ [40,69], NO-GO ∈ [1,39]. Ordering within a band
  // tracks the raw composite; NO-GO compounds drop further per extra hard
  // flag. Guarantees a correct sort over thousands of compounds.
  const score: number = (() => {
    if (verdict === "GO") return +clamp(composite, 70, 100).toFixed(1);
    if (verdict === "WATCH") return +clamp(40 + (composite / 100) * 29, 40, 69).toFixed(1);
    // NO-GO: map into [1,39] and penalise additional hard liabilities.
    const base = (composite / 100) * 38;
    return +clamp(base - (hardFlags.length - 1) * 6, 1, 39).toFixed(1);
  })();

  // ── Narrative ──────────────────────────────────────────────────────────
  const headline =
    verdict === "NO-GO"
      ? `NO-GO — ${hardFlags.length} hard liabilit${hardFlags.length === 1 ? "y" : "ies"} (L1 score ${score}/100)`
      : verdict === "WATCH"
        ? `WATCH — advance with monitoring (L1 score ${score}/100, ${warnFlags.length} flag${warnFlags.length === 1 ? "" : "s"})`
        : `GO — favourable L1 profile (score ${score}/100)`;

  const rationale = (() => {
    if (verdict === "NO-GO") {
      return `Vetoed by hard liabilit${hardFlags.length === 1 ? "y" : "ies"}: ${hardFlags.map(f => f.label).join("; ")}. ` +
        `These are stage-gating risks: the triage score is held at ${score}/100 even though the raw endpoint composite is ${composite}/100 (a vetoed compound can still have otherwise-good properties). Structural modification or a qualified control strategy is required before advancing. Confidence in the call: ${confidenceLabel.toLowerCase()} (${pct(confidence)}; ML safety coverage ${pct(mlCoverage)}).`;
    }
    if (verdict === "WATCH") {
      const reasons: string[] = [];
      if (warnFlags.length > 0) reasons.push(`${warnFlags.length} monitor-level flag${warnFlags.length === 1 ? "" : "s"} (${warnFlags.map(f => f.label).join("; ")})`);
      if (composite < WATCH.composite) reasons.push(`composite below the GO floor (${composite} < ${GO_COMPOSITE})`);
      if (confidenceDowngrade) reasons.push("GO withheld because the evidence is mostly heuristic (low confidence) — obtain the missing ML/assay readouts to confirm");
      return `Advance with close monitoring. ${reasons.join("; ")}. Triage score ${score}/100 (raw composite ${composite}), confidence ${confidenceLabel.toLowerCase()} (${pct(confidence)}).`;
    }
    return `Favourable across the available L1 dimensions with no hard or monitor-level liabilities. Triage score ${score}/100, confidence ${confidenceLabel.toLowerCase()} (${pct(confidence)}; ML safety coverage ${pct(mlCoverage)}). Recommend progressing to Layer 2 confirmation.`;
  })();

  const recommendation =
    verdict === "NO-GO"
      ? "Do not advance as-is. Re-design to remove the flagged liability, then re-run L1."
      : verdict === "WATCH"
        ? "Advance into Layer 2 confirmation with the flagged endpoints prioritised for orthogonal (ex-vivo / ML-ensemble) confirmation."
        : "Advance to Layer 2 confirmation.";

  // sort flags critical → warn → info
  const sevRank = { critical: 0, warn: 1, info: 2 } as const;
  flags.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  return {
    verdict,
    score,
    compositeRaw: composite,
    confidence,
    confidenceLabel,
    headline,
    rationale,
    flags,
    dimensions: dims,
    mlCoverage,
    recommendation,
    timestamp: new Date().toISOString(),
  };
}
