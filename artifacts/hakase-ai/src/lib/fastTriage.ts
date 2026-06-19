/**
 * Fast library-triage scorer (shared, single source of truth).
 * ─────────────────────────────────────────────────────────────────────────
 * Used by the batch-screening page to rank a library. Deliberately a LIGHTER
 * pass than the full single-molecule L1 scorecard (no in-vitro sim, docking,
 * structural-alert scan, read-across or applicability-domain envelope) — but
 * built to stay DIRECTIONALLY CONSISTENT with it, not contradict it:
 *
 *   • Same calibrated thresholds + desirability transform as l1Scorecard
 *     (imported from l1Thresholds.json), so a liability reads the same way.
 *   • Scores over a BROADER endpoint set than just toxicity — it folds in the
 *     absorption signals ADMET-AI is reliable at (HIA AUROC 0.99, solubility
 *     R² 0.82) alongside the safety endpoints (hERG/DILI/Ames/ClinTox/Carc).
 *   • CRITICAL — ML probabilities FLAG, they do NOT issue a hard NO-GO. The
 *     full engine downgrades out-of-domain ML signals to WATCH because a model
 *     extrapolating on novel chemistry must not veto a candidate; at batch
 *     stage we have no AD envelope, so we treat every compound as potentially
 *     out-of-domain and cap the worst tier at REVIEW ("strong predicted
 *     liability — confirm in the full L1 report + lab"), never an absolute
 *     NO-GO. This is why the batch verdict can read REVIEW where the full
 *     dashboard might later say NO-GO: the dashboard has more evidence.
 *
 * Verdicts: GO (clean) · WATCH (monitor) · REVIEW (strong liability, escalate).
 */

import THRESH from "./l1Thresholds.json";

const HARD = THRESH.hard_thresholds as Record<string, number>;
const WATCH = THRESH.watch_thresholds as Record<string, number>;
const DMIN: number = (THRESH as any).desirability?.d_min ?? 0.05;

export type TriageVerdict = "GO" | "WATCH" | "REVIEW";

/** Minimal shape we read from ADMET-AI's structured output. */
export interface TriageStructured {
  toxicity?: Record<string, { value: number | string | null } | undefined>;
  absorption?: Record<string, { value: number | string | null } | undefined>;
  distribution?: Record<string, { value: number | string | null } | undefined>;
}

export interface TriageResult {
  verdict: TriageVerdict;
  score: number;          // 0–100, verdict-consistent (GO 70–100 · WATCH 45–69 · REVIEW 1–44)
  desirability: number;   // 0–1 raw composite
  flags: string[];        // human-readable liabilities (⛔ strong · ⚠ monitor)
  endpoints: { hERG: number | null; DILI: number | null; AMES: number | null; ClinTox: number | null };
  nScored: number;        // how many endpoints contributed (for honesty/coverage)
}

function num(v: { value: number | string | null } | undefined | null): number | null {
  const x = v?.value;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

/** Liability desirability (Wager-style): 1 below watch, ramps to dMin at hard. */
function liabilityDesir(p: number | null, watch: number, hard: number): number {
  if (p == null) return 1; // missing endpoint must not penalise (null-aware, like l1Scorecard)
  if (p <= watch) return 1;
  if (p >= hard) return DMIN;
  return 1 - ((p - watch) / Math.max(hard - watch, 1e-6)) * (1 - DMIN);
}

/** Aqueous solubility logS → desirability (>= -4 good, <= -6 poor). */
function solubilityDesir(logS: number | null): number | null {
  if (logS == null) return null;
  if (logS >= -4) return 1;
  if (logS <= -6) return 0.2;
  return 0.2 + ((logS + 6) / 2) * 0.8;
}

export function fastTriage(structured: TriageStructured): TriageResult {
  const tox = structured.toxicity ?? {};
  const abs = structured.absorption ?? {};

  const herg = num(tox["hERG"]);
  const dili = num(tox["DILI"]);
  const ames = num(tox["AMES"]);
  const clintox = num(tox["ClinTox"]);
  const carc = num(tox["Carcinogens_Lagunin"]);
  const hia = num(abs["HIA_Hou"]);                 // higher = better (prob)
  const solLogS = num(abs["Solubility_AqSolDB"]);  // logS

  const flags: string[] = [];
  let strong = false;
  const liabilities: Array<[string, number | null, number, number, string]> = [
    ["hERG", herg, WATCH.herg, HARD.herg, "Cardiac (hERG)"],
    ["DILI", dili, WATCH.dili, HARD.dili, "Hepatotoxicity (DILI)"],
    ["Ames", ames, WATCH.ames, HARD.ames, "Mutagenicity (Ames)"],
    ["ClinTox", clintox, WATCH.clintox, HARD.clintox, "Clinical toxicity"],
    ["Carcinogen", carc, WATCH.carcinogen, HARD.carcinogen, "Carcinogenicity"],
  ];

  const desirs: number[] = [];
  for (const [, p, w, h, label] of liabilities) {
    if (p == null) continue;
    desirs.push(liabilityDesir(p, w, h));
    if (p >= h) { strong = true; flags.push(`⛔ ${label}`); }
    else if (p >= w) flags.push(`⚠ ${label}`);
  }
  // Absorption signals (good-direction): HIA prob + solubility.
  if (hia != null) desirs.push(Math.max(0, Math.min(1, hia)));
  const sol = solubilityDesir(solLogS);
  if (sol != null) desirs.push(sol);

  const nScored = desirs.length;
  // Weighted geometric mean (equal weights) — one weak axis drags it down,
  // consistent with the full engine's MPO aggregation.
  const desirability = nScored
    ? Math.pow(desirs.reduce((a, b) => a * Math.max(DMIN, b), 1), 1 / nScored)
    : 0.6;

  let verdict: TriageVerdict;
  if (strong) verdict = "REVIEW";
  else if (flags.length > 0 || desirability < 0.6) verdict = "WATCH";
  else verdict = "GO";

  const comp100 = desirability * 100;
  const score =
    verdict === "GO" ? Math.round(Math.max(70, Math.min(100, comp100)))
    : verdict === "WATCH" ? Math.round(Math.max(45, Math.min(69, comp100)))
    : Math.round(Math.max(1, Math.min(44, comp100 * 0.44)));

  return {
    verdict, score, desirability: +desirability.toFixed(3), flags,
    endpoints: { hERG: herg, DILI: dili, AMES: ames, ClinTox: clintox },
    nScored,
  };
}
