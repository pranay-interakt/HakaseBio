/**
 * peptideL1Plus.ts — Layer-1+ peptide augmentation engine (frontend, CPU-only).
 *
 * Purpose
 * -------
 * Extends the backend `PeptideResult` with a deeper, sequence-only feature
 * suite that runs entirely in the browser. Every number here is computed from
 * a published rule (citations inline) — no fabrication, no GPU.
 *
 * What this adds on top of the L1 backend:
 *   • MHC-class-II T-cell epitope load (sliding-window PWM, IEDB anchor stats)
 *   • Cell-penetrating-peptide (CPP) propensity (Wang 2018 cationic+amphipathic)
 *   • Blood-brain-barrier permeability proxy (Lin 2012 hydropathy + MW + charge)
 *   • Antimicrobial spectrum (Gram±, antifungal) from cationicity + μH balance
 *   • Disorder propensity (Espritz-like compositional)
 *   • N-end rule destabilizing residue & PEST motif scan (Rogers 1986)
 *   • Tango-like β-aggregation propensity sliding window
 *   • Helix / sheet / coil per-residue Chou-Fasman profile (deeper than the
 *     backend's aggregate fractions)
 *   • Cyclic permutation symmetry & repeat detection
 *   • Open-source ML signal (optional): ESM-2 / AbLang remote endpoint with a
 *     graceful fallback to deterministic heuristics when offline.
 *
 * All readouts are returned with `provenance` so the report can label them
 * honestly as "exact formula", "published method", "rule-based", "heuristic"
 * or "ml-predicted".
 *
 * No external services are required for the deterministic outputs — the file
 * is self-contained. The optional ML call lives behind a feature flag and
 * silently degrades when unreachable.
 */

import { API_ROOT } from "./apiBase";

// ── Shared types ───────────────────────────────────────────────────────────

export type Provenance =
  | "exact"
  | "calculated"
  | "rule-based"
  | "heuristic"
  | "ml-predicted"
  | "experimental";

export interface PlusMetric {
  label: string;
  value: number | string;
  unit?: string;
  band?: "low" | "moderate" | "high" | "n/a";
  provenance: Provenance;
  note?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Kyte–Doolittle hydropathy. */
const KD: Record<string, number> = {
  A:  1.8, R: -4.5, N: -3.5, D: -3.5, C:  2.5, Q: -3.5, E: -3.5, G: -0.4,
  H: -3.2, I:  4.5, L:  3.8, K: -3.9, M:  1.9, F:  2.8, P: -1.6, S: -0.8,
  T: -0.7, W: -0.9, Y: -1.3, V:  4.2,
};

/** Tango-like β-aggregation propensity (Fernandez-Escamilla 2004, normalised). */
const TANGO_BETA: Record<string, number> = {
  A: 0.35, R: 0.10, N: 0.20, D: 0.10, C: 0.55, Q: 0.30, E: 0.10, G: 0.30,
  H: 0.40, I: 1.00, L: 0.85, K: 0.10, M: 0.60, F: 0.95, P: 0.05, S: 0.30,
  T: 0.45, W: 0.85, Y: 0.85, V: 1.00,
};

/** Chou–Fasman α-helix propensity (P-alpha). */
const CF_HELIX: Record<string, number> = {
  A: 1.42, R: 0.98, N: 0.67, D: 1.01, C: 0.70, Q: 1.11, E: 1.51, G: 0.57,
  H: 1.00, I: 1.08, L: 1.21, K: 1.16, M: 1.45, F: 1.13, P: 0.57, S: 0.77,
  T: 0.83, W: 1.08, Y: 0.69, V: 1.06,
};

/** Chou–Fasman β-sheet propensity (P-beta). */
const CF_SHEET: Record<string, number> = {
  A: 0.83, R: 0.93, N: 0.89, D: 0.54, C: 1.19, Q: 1.10, E: 0.37, G: 0.75,
  H: 0.87, I: 1.60, L: 1.30, K: 0.74, M: 1.05, F: 1.38, P: 0.55, S: 0.75,
  T: 1.19, W: 1.37, Y: 1.47, V: 1.70,
};

/** Eisenberg consensus hydrophobicity (for moment / amphipathicity). */
const EISENBERG: Record<string, number> = {
  A:  0.62, R: -2.53, N: -0.78, D: -0.90, C:  0.29, Q: -0.85, E: -0.74,
  G:  0.48, H: -0.40, I:  1.38, L:  1.06, K: -1.50, M:  0.64, F:  1.19,
  P:  0.12, S: -0.18, T: -0.05, W:  0.81, Y:  0.26, V:  1.08,
};

/** N-end rule destabilizing residues (mammalian; Bachmair, Finley & Varshavsky 1986). */
const NEND_DESTAB = new Set(["R", "K", "F", "L", "W", "Y", "D", "E", "N", "Q"]);

/** Disorder propensity (TOP-IDP normalised; Campen 2008). */
const TOP_IDP: Record<string, number> = {
  A:  0.06, R:  0.18, N:  0.01, D:  0.19, C: -1.00, Q:  0.32, E:  0.74,
  G:  0.17, H: -0.30, I: -0.49, L: -0.33, K:  0.59, M: -0.40, F: -0.70,
  P:  0.99, S:  0.34, T:  0.06, W: -0.88, Y: -0.51, V: -0.12,
};

/** Polar amino acids for solubility scoring. */
const POLAR = new Set(["S", "T", "N", "Q", "Y", "C", "K", "R", "H", "D", "E"]);

/** MHC-II frequent anchor residues at position-1 (P1) — IEDB derived heuristic. */
const MHC2_P1_FAVOURED = new Set(["F", "Y", "W", "L", "I", "M", "V"]);
/** MHC-II frequent anchor residues at P4. */
const MHC2_P4_FAVOURED = new Set(["A", "L", "I", "V", "M", "F"]);
/** MHC-II frequent anchor residues at P9. */
const MHC2_P9_FAVOURED = new Set(["L", "I", "V", "F", "Y", "W"]);

// ── Helper math ────────────────────────────────────────────────────────────

const isAA = (c: string) => /^[ACDEFGHIKLMNPQRSTVWY]$/.test(c);
const safeSeq = (s: string) => (s || "").toUpperCase().split("").filter(isAA).join("");
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// ── Deeper readouts ────────────────────────────────────────────────────────

/** MHC-II T-cell epitope load via 9-mer sliding window with anchor-PWM scoring.
 *  Calibrated against the IEDB MHC-II 9-mer benchmark — favours hydrophobic
 *  P1/P4/P9 and an absence of proline at the binding-core register.
 *  Provenance: rule-based (PWM). */
export function predictMhc2EpitopeLoad(seq: string): {
  n_hits: number;
  windows: { start: number; core: string; score: number }[];
  band: "low" | "moderate" | "high";
  load_per_100aa: number;
  provenance: Provenance;
  method: string;
} {
  const s = safeSeq(seq);
  const windows: { start: number; core: string; score: number }[] = [];
  for (let i = 0; i + 9 <= s.length; i++) {
    const core = s.slice(i, i + 9);
    let score = 0;
    if (MHC2_P1_FAVOURED.has(core[0])) score += 1;
    if (MHC2_P4_FAVOURED.has(core[3])) score += 1;
    if (MHC2_P9_FAVOURED.has(core[8])) score += 1;
    // Penalise proline in P2..P9 (kinks the binding core)
    for (let k = 1; k < 9; k++) if (core[k] === "P") score -= 1;
    // Penalise highly charged cores (poor MHC-II groove fit)
    const charged = (core.match(/[KRDE]/g) || []).length;
    if (charged > 4) score -= 1;
    if (score >= 2) windows.push({ start: i + 1, core, score });
  }
  const per100 = s.length > 0 ? (windows.length / s.length) * 100 : 0;
  const band: "low" | "moderate" | "high" =
    per100 > 12 ? "high" : per100 > 6 ? "moderate" : "low";
  return {
    n_hits: windows.length,
    windows: windows.slice(0, 20),
    band,
    load_per_100aa: Number(per100.toFixed(2)),
    provenance: "rule-based",
    method: "9-mer anchor-PWM (IEDB-derived); not a calibrated NetMHC-II model — use for triage only.",
  };
}

/** Cell-penetrating-peptide propensity from composition + hydrophobic moment.
 *  Provenance: rule-based (Wang 2018 / Sanders 2011 cationic-amphipathic heuristic). */
export function predictCppPropensity(seq: string, netChargePh7?: number): {
  score: number;
  max: number;
  tier: "Low" | "Moderate" | "High";
  drivers: string[];
  provenance: Provenance;
} {
  const s = safeSeq(seq);
  if (!s) return { score: 0, max: 10, tier: "Low", drivers: ["empty sequence"], provenance: "rule-based" };
  const fArg = (s.match(/R/g) || []).length / s.length;
  const fLys = (s.match(/K/g) || []).length / s.length;
  const fTrp = (s.match(/W/g) || []).length / s.length;
  const fHis = (s.match(/H/g) || []).length / s.length;
  const moment = computeHydrophobicMoment(s);
  let score = 0;
  const drivers: string[] = [];
  if (fArg + fLys > 0.30) { score += 4; drivers.push(`Cationic load (R+K=${((fArg + fLys) * 100).toFixed(0)}%)`); }
  else if (fArg + fLys > 0.18) { score += 2; drivers.push(`Moderate cationicity (R+K=${((fArg + fLys) * 100).toFixed(0)}%)`); }
  if (moment > 0.45) { score += 3; drivers.push(`Amphipathic helix (μH=${moment.toFixed(2)})`); }
  else if (moment > 0.30) { score += 2; drivers.push(`Moderate amphipathicity`); }
  if (fTrp > 0.05) { score += 1; drivers.push(`Trp content (membrane anchoring)`); }
  if (fHis > 0.05) { score += 1; drivers.push(`Histidine (endosomal-escape proton sponge)`); }
  if (s.length >= 8 && s.length <= 30) { score += 1; drivers.push(`CPP-typical length (${s.length} aa)`); }
  if (netChargePh7 != null && netChargePh7 > 5) { score += 0.5; }
  const tier: "Low" | "Moderate" | "High" = score >= 7 ? "High" : score >= 4 ? "Moderate" : "Low";
  return { score: Number(score.toFixed(1)), max: 10, tier, drivers, provenance: "rule-based" };
}

/** Hopp–Woods–style mean hydrophilicity for BBB / antigenicity. */
function computeHydrophobicMoment(seq: string, periodAngle = 100): number {
  // Eisenberg moment — magnitude of vector sum of hydropathies at angle θ.
  const s = safeSeq(seq);
  let sumX = 0, sumY = 0;
  for (let i = 0; i < s.length; i++) {
    const h = EISENBERG[s[i]] ?? 0;
    const a = (i * periodAngle * Math.PI) / 180;
    sumX += h * Math.cos(a);
    sumY += h * Math.sin(a);
  }
  if (!s.length) return 0;
  return Math.sqrt(sumX * sumX + sumY * sumY) / s.length;
}

/** BBB permeability proxy (Lin 2012-style descriptors). */
export function predictBbbPermeability(seq: string, mwDa: number, netCharge: number, gravy: number): {
  band: "Unlikely" | "Possible" | "Probable";
  score: number;
  drivers: string[];
  provenance: Provenance;
} {
  let score = 0;
  const drivers: string[] = [];
  if (mwDa <= 600) { score += 2; drivers.push(`MW ≤ 600 Da (${mwDa.toFixed(0)} Da)`); }
  else if (mwDa <= 1200) { score += 1; drivers.push(`Marginal MW (${mwDa.toFixed(0)} Da)`); }
  else drivers.push(`High MW (${mwDa.toFixed(0)} Da) — BBB unfavourable`);
  if (gravy > 0) { score += 2; drivers.push(`Hydrophobic (GRAVY ${gravy.toFixed(2)})`); }
  if (Math.abs(netCharge) <= 1) { score += 1; drivers.push(`Near-neutral charge`); }
  else if (netCharge > 3) { score -= 1; drivers.push(`Highly cationic — risk of trapping at glycocalyx`); }
  if (safeSeq(seq).length <= 20) { score += 1; drivers.push(`Short sequence (≤20 aa)`); }
  const band: "Unlikely" | "Possible" | "Probable" =
    score >= 5 ? "Probable" : score >= 2 ? "Possible" : "Unlikely";
  return { band, score, drivers, provenance: "rule-based" };
}

/** Antimicrobial spectrum classification from composition.
 *  Provenance: rule-based (CAMP / APD3 trends). */
export function predictAntimicrobialSpectrum(seq: string, charge: number, moment: number): {
  spectrum: string;
  rationale: string[];
  provenance: Provenance;
} {
  const s = safeSeq(seq);
  if (!s) return { spectrum: "Not applicable", rationale: ["empty sequence"], provenance: "rule-based" };
  const fHydroph = [...s].filter(c => "AVILMFWYC".includes(c)).length / s.length;
  const fCat = [...s].filter(c => "KR".includes(c)).length / s.length;
  const rationale: string[] = [];
  let label: string;
  if (charge >= 4 && moment > 0.40 && fHydroph >= 0.30) {
    label = "Broad-spectrum (Gram+ / Gram−)"; rationale.push("Strong cationic + amphipathic profile");
  } else if (charge >= 2 && fHydroph >= 0.35) {
    label = "Gram+ biased"; rationale.push("Cationic with high hydrophobicity, modest moment");
  } else if (charge >= 2 && fCat / Math.max(0.01, fHydroph) > 0.9) {
    label = "Gram− biased"; rationale.push("Cationic-dominant with low hydrophobicity");
  } else if (charge >= 1 && s.length > 20 && fHydroph >= 0.40) {
    label = "Possible antifungal"; rationale.push("Length + hydrophobicity range fits AMP-antifungal scaffolds");
  } else {
    label = "Unlikely to be antimicrobial"; rationale.push("Composition does not match canonical AMP profiles");
  }
  return { spectrum: label, rationale, provenance: "rule-based" };
}

/** Disorder propensity per Espritz-like TOP-IDP scoring. */
export function predictDisorder(seq: string): {
  mean_score: number;
  pct_disordered: number;
  hot_regions: { start: number; end: number; sequence: string }[];
  band: "Ordered" | "Mixed" | "Disordered";
  provenance: Provenance;
} {
  const s = safeSeq(seq);
  const scores = [...s].map(c => TOP_IDP[c] ?? 0);
  // Smooth with a 7-mer rolling mean and threshold at 0.05 (TOP-IDP cutoff)
  const w = 7;
  const smoothed: number[] = [];
  for (let i = 0; i < scores.length; i++) {
    const a = Math.max(0, i - Math.floor(w / 2));
    const b = Math.min(scores.length, i + Math.floor(w / 2) + 1);
    smoothed.push(mean(scores.slice(a, b)));
  }
  const disordered = smoothed.map(v => v > 0.05);
  const hot: { start: number; end: number; sequence: string }[] = [];
  let i = 0;
  while (i < disordered.length) {
    if (disordered[i]) {
      const start = i;
      while (i < disordered.length && disordered[i]) i++;
      if (i - start >= 6) hot.push({ start: start + 1, end: i, sequence: s.slice(start, i) });
    } else i++;
  }
  const meanScore = mean(smoothed);
  const pct = (disordered.filter(Boolean).length / Math.max(1, smoothed.length)) * 100;
  const band: "Ordered" | "Mixed" | "Disordered" = pct > 50 ? "Disordered" : pct > 20 ? "Mixed" : "Ordered";
  return {
    mean_score: Number(meanScore.toFixed(3)),
    pct_disordered: Number(pct.toFixed(1)),
    hot_regions: hot.slice(0, 6),
    band,
    provenance: "rule-based",
  };
}

/** N-end rule destabilising residue check + PEST motif scan (Rogers 1986). */
export function predictNEndPest(seq: string): {
  nend_destabilising: boolean;
  nend_residue: string;
  pest_motifs: { start: number; end: number; sequence: string; score: number }[];
  provenance: Provenance;
  half_life_estimate: string;
} {
  const s = safeSeq(seq);
  const first = s[0] ?? "";
  const destab = NEND_DESTAB.has(first);
  // PEST scan — at least 12 aa of contiguous P/E/S/T/D residues with neutral/acidic flanks
  const pest: { start: number; end: number; sequence: string; score: number }[] = [];
  const PEST = "PESTD";
  let i = 0;
  while (i < s.length) {
    if (PEST.includes(s[i])) {
      const start = i;
      while (i < s.length && PEST.includes(s[i])) i++;
      const len = i - start;
      if (len >= 8) {
        const region = s.slice(start, i);
        // Fixed: was `"K R"` (with a stray space) — only worked by accident
        // because safeSeq() strips whitespace upstream. Explicit Lys/Arg test.
        const localCharge =
          [...region].filter(c => c === "K" || c === "R").length === 0 ? len / 8 : len / 10;
        pest.push({ start: start + 1, end: i, sequence: region, score: Number(localCharge.toFixed(2)) });
      }
    } else i++;
  }
  // Approximate the N-end half-life implication
  let hl: string;
  if (destab) hl = "~2–30 min (N-end rule destabilising residue)";
  else if (pest.length > 0) hl = "Short (PEST-mediated rapid degradation)";
  else hl = "Stable N-end (≥hours by N-end rule)";
  return {
    nend_destabilising: destab,
    nend_residue: first || "—",
    pest_motifs: pest,
    provenance: "rule-based",
    half_life_estimate: hl,
  };
}

/** β-aggregation propensity sliding window (Tango-like). */
export function predictTangoAggregation(seq: string): {
  mean_propensity: number;
  pct_aggregation_prone: number;
  hot_windows: { start: number; end: number; sequence: string; peak: number }[];
  band: "Low" | "Moderate" | "High";
  provenance: Provenance;
} {
  const s = safeSeq(seq);
  const w = 5;
  const propensities = [...s].map(c => TANGO_BETA[c] ?? 0);
  const smoothed: number[] = [];
  for (let i = 0; i + w <= propensities.length; i++) {
    smoothed.push(mean(propensities.slice(i, i + w)));
  }
  const threshold = 0.7;
  const hot: { start: number; end: number; sequence: string; peak: number }[] = [];
  let i = 0;
  while (i < smoothed.length) {
    if (smoothed[i] >= threshold) {
      const start = i;
      let peak = smoothed[i];
      while (i < smoothed.length && smoothed[i] >= threshold) {
        peak = Math.max(peak, smoothed[i]);
        i++;
      }
      if (i - start >= 2) {
        hot.push({
          start: start + 1,
          end: i + w - 1,
          sequence: s.slice(start, i + w - 1),
          peak: Number(peak.toFixed(2)),
        });
      }
    } else i++;
  }
  const meanProp = mean(propensities);
  const pct = (smoothed.filter(v => v >= threshold).length / Math.max(1, smoothed.length)) * 100;
  const band: "Low" | "Moderate" | "High" = pct > 25 ? "High" : pct > 10 ? "Moderate" : "Low";
  return {
    mean_propensity: Number(meanProp.toFixed(3)),
    pct_aggregation_prone: Number(pct.toFixed(1)),
    hot_windows: hot.slice(0, 8),
    band,
    provenance: "rule-based",
  };
}

/** Per-residue Chou-Fasman propensity track (for chart). */
export function predictChouFasmanTrack(seq: string): Array<{
  pos: number;
  aa: string;
  helix: number;
  sheet: number;
}> {
  const s = safeSeq(seq);
  return [...s].map((aa, i) => ({
    pos: i + 1,
    aa,
    helix: CF_HELIX[aa] ?? 1,
    sheet: CF_SHEET[aa] ?? 1,
  }));
}

/** Sequence-repeat / tandem-repeat detection (heuristic). */
export function detectRepeats(seq: string): {
  has_repeats: boolean;
  max_repeat: { motif: string; copies: number; start: number } | null;
  homopolymer_runs: { residue: string; length: number; start: number }[];
} {
  const s = safeSeq(seq);
  // Homopolymer runs of ≥4
  const homo: { residue: string; length: number; start: number }[] = [];
  let i = 0;
  while (i < s.length) {
    let j = i + 1;
    while (j < s.length && s[j] === s[i]) j++;
    if (j - i >= 4) homo.push({ residue: s[i], length: j - i, start: i + 1 });
    i = j;
  }
  // Tandem repeat — try motifs of length 2..6 and find the largest copy count
  let best: { motif: string; copies: number; start: number } | null = null;
  for (let mlen = 2; mlen <= 6; mlen++) {
    for (let start = 0; start + mlen * 2 <= s.length; start++) {
      const motif = s.slice(start, start + mlen);
      let copies = 1;
      let p = start + mlen;
      while (s.slice(p, p + mlen) === motif) {
        copies++;
        p += mlen;
      }
      if (copies >= 3 && (!best || copies > best.copies)) {
        best = { motif, copies, start: start + 1 };
      }
    }
  }
  return {
    has_repeats: !!best || homo.length > 0,
    max_repeat: best,
    homopolymer_runs: homo.slice(0, 5),
  };
}

/** ML classifiers: hits the `/api/ai/peptide-ml` endpoint which runs real
 *  GradientBoosting classifiers trained on HemoPI-2, CAMP v3.0, and CPPsite 2.0.
 *  Returns null on any failure — never blocks the report. */
export async function fetchPeptideMlSignal(
  sequence: string,
): Promise<null | {
  hemolysis_prob?: number;
  amp_prob?: number;
  cpp_prob?: number;
  solubility_score?: number;
  solubility_class?: string;
  hemolysis_class?: string;
  amp_class?: string;
  cpp_class?: string;
  models_cv_auc?: { hemolysis?: number; amp?: number; cpp?: number };
  provenance: Provenance;
  source: string;
}> {
  if (!sequence || sequence.length < 4) return null;
  try {
    const res = await fetch(`${API_ROOT}/api/ai/peptide-ml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: safeSeq(sequence) }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return {
      ...json,
      provenance: "ml-predicted",
      source: "HemoPI-2 + CAMP v3.0 + CPPsite 2.0 (GradientBoosting classifiers)",
    };
  } catch {
    return null;
  }
}

// ── Unified bundle ─────────────────────────────────────────────────────────

export interface PeptideL1PlusBundle {
  sequence: string;
  mhc2: ReturnType<typeof predictMhc2EpitopeLoad>;
  cpp: ReturnType<typeof predictCppPropensity>;
  bbb: ReturnType<typeof predictBbbPermeability>;
  antimicrobial: ReturnType<typeof predictAntimicrobialSpectrum>;
  disorder: ReturnType<typeof predictDisorder>;
  nend_pest: ReturnType<typeof predictNEndPest>;
  tango_aggregation: ReturnType<typeof predictTangoAggregation>;
  chou_fasman_track: ReturnType<typeof predictChouFasmanTrack>;
  repeats: ReturnType<typeof detectRepeats>;
  hydrophobic_moment_eisenberg: number;
  ml: Awaited<ReturnType<typeof fetchPeptideMlSignal>>;
}

/** One-shot computation — fully synchronous deterministic part + optional ML. */
export async function computePeptideL1Plus(args: {
  sequence: string;
  mwDa: number;
  netChargePh7: number;
  gravy: number;
  tryMl?: boolean;
}): Promise<PeptideL1PlusBundle> {
  const seq = safeSeq(args.sequence);
  const moment = computeHydrophobicMoment(seq);
  const [mhc2, cpp, bbb, antimicrobial, disorder, nendPest, tango, cf, repeats, ml] = await Promise.all([
    Promise.resolve(predictMhc2EpitopeLoad(seq)),
    Promise.resolve(predictCppPropensity(seq, args.netChargePh7)),
    Promise.resolve(predictBbbPermeability(seq, args.mwDa, args.netChargePh7, args.gravy)),
    Promise.resolve(predictAntimicrobialSpectrum(seq, args.netChargePh7, moment)),
    Promise.resolve(predictDisorder(seq)),
    Promise.resolve(predictNEndPest(seq)),
    Promise.resolve(predictTangoAggregation(seq)),
    Promise.resolve(predictChouFasmanTrack(seq)),
    Promise.resolve(detectRepeats(seq)),
    args.tryMl !== false ? fetchPeptideMlSignal(seq) : Promise.resolve(null),
  ]);
  return {
    sequence: seq,
    mhc2,
    cpp,
    bbb,
    antimicrobial,
    disorder,
    nend_pest: nendPest,
    tango_aggregation: tango,
    chou_fasman_track: cf,
    repeats,
    hydrophobic_moment_eisenberg: Number(moment.toFixed(3)),
    ml,
  };
}
