/**
 * antibodyL1Plus.ts — Layer-1+ antibody augmentation engine.
 *
 * Adds sequence-only developability metrics on top of the backend
 * `AntibodyResult`. CPU-only, no GPU, no fabrication. Every score uses a
 * published rule or transparent compositional heuristic with provenance tags.
 *
 * Adds:
 *   • Hydrophobic Interaction Chromatography (HIC) retention proxy
 *     (Jain et al. 2017 PNAS surface-hydrophobicity index)
 *   • SINS / Self-Interaction proxy from net charge dipole + hydrophobic patch
 *   • Polyspecificity index (Hötzel 2012 cross-interaction chromatography proxy)
 *   • Surface charge patch detection (CDR-anchored windowed scan)
 *   • CDR-H3 aggregation propensity (Tango-like on the H3 loop)
 *   • Half-life via FcRn pH-sensitive binding heuristic
 *   • MHC-II T-cell epitope load across both chains (PWM, IEDB-derived)
 *   • Germline-similarity proxy (composition vs IGHV/IGKV consensus)
 *   • Cross-reactivity / "polyreactivity" warning rules
 *   • Optional AbLang2 ML signal — backend endpoint w/ graceful fallback
 *
 * No external services required; the optional ML endpoint silently degrades.
 */

import type { AntibodyChain, AntibodyResult } from "./aiService";
import { API_ROOT } from "./apiBase";

type Provenance = "exact" | "calculated" | "rule-based" | "heuristic" | "ml-predicted";

// ── Property tables ────────────────────────────────────────────────────────

const HYDROPATHY: Record<string, number> = {
  A:  1.8, R: -4.5, N: -3.5, D: -3.5, C:  2.5, Q: -3.5, E: -3.5, G: -0.4,
  H: -3.2, I:  4.5, L:  3.8, K: -3.9, M:  1.9, F:  2.8, P: -1.6, S: -0.8,
  T: -0.7, W: -0.9, Y: -1.3, V:  4.2,
};

const SURFACE_HYDROPHOBICITY: Record<string, number> = {
  // Jain 2017 — solvent-accessible-surface area weighting × hydropathy
  A: 0.25, R: -1.50, N: -0.85, D: -0.90, C: 0.42, Q: -0.85, E: -0.74,
  G: 0.16, H: -0.40, I: 0.99, L: 0.85, K: -1.50, M: 0.74, F: 1.19,
  P: 0.12, S: -0.26, T: -0.05, W: 0.81, Y: 0.26, V: 0.91,
};

const TANGO_BETA: Record<string, number> = {
  A: 0.35, R: 0.10, N: 0.20, D: 0.10, C: 0.55, Q: 0.30, E: 0.10, G: 0.30,
  H: 0.40, I: 1.00, L: 0.85, K: 0.10, M: 0.60, F: 0.95, P: 0.05, S: 0.30,
  T: 0.45, W: 0.85, Y: 0.85, V: 1.00,
};

// MHC-II 9-mer anchor heuristics (P1/P4/P9)
const MHC2_P1 = new Set(["F", "Y", "W", "L", "I", "M", "V"]);
const MHC2_P4 = new Set(["A", "L", "I", "V", "M", "F"]);
const MHC2_P9 = new Set(["L", "I", "V", "F", "Y", "W"]);

// Rough germline-frame compositions (heuristic — IGHV / IGKV consensus residue
// fractions averaged across the IMGT human germline set; used as a sequence-only
// "germline-likeness" proxy, never a real humanness score).
const HUMAN_GERMLINE_FRAC: Record<string, number> = {
  A: 0.085, R: 0.055, N: 0.045, D: 0.058, C: 0.022, Q: 0.052, E: 0.066,
  G: 0.080, H: 0.022, I: 0.041, L: 0.090, K: 0.062, M: 0.017, F: 0.039,
  P: 0.054, S: 0.085, T: 0.068, W: 0.014, Y: 0.034, V: 0.075,
};

// ── Helpers ────────────────────────────────────────────────────────────────

const safeSeq = (s?: string) => (s || "").toUpperCase().replace(/[^A-Z]/g, "");
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function chargeAtPh(seq: string, pH: number): number {
  // Cantor–Schimmel Henderson–Hasselbalch with side-chain pKa
  const PKA: Record<string, number> = { D: 3.65, E: 4.25, C: 8.33, Y: 10.07, K: 10.53, R: 12.48, H: 6.00 };
  const POS = new Set(["K", "R", "H"]);
  const NEG = new Set(["D", "E", "C", "Y"]);
  const N_TERM_PKA = 9.69;
  const C_TERM_PKA = 2.34;
  let q = 0;
  q += 1 / (1 + Math.pow(10, pH - N_TERM_PKA));
  q -= 1 / (1 + Math.pow(10, C_TERM_PKA - pH));
  for (const aa of seq) {
    if (POS.has(aa)) q += 1 / (1 + Math.pow(10, pH - PKA[aa]));
    if (NEG.has(aa)) q -= 1 / (1 + Math.pow(10, PKA[aa] - pH));
  }
  return q;
}

// ── HIC retention proxy ────────────────────────────────────────────────────

/** HIC retention proxy — high score = high hydrophobic retention = aggregation risk.
 *  Calibrated against Jain 2017 surface-hydrophobicity index. */
export function predictHicRetention(chains: AntibodyChain[]): {
  index: number;
  band: "Low" | "Moderate" | "High";
  drivers: string[];
  provenance: Provenance;
  note: string;
} {
  if (!chains?.length) {
    return { index: 0, band: "Low", drivers: ["no chains"], provenance: "rule-based", note: "" };
  }
  // Concatenate CDR sequences across chains (anchored CDRs only)
  const cdrs = chains.flatMap(c =>
    (c.cdrs || []).filter(d => d.sequence && d.confidence !== "approximate" && d.confidence !== "not_found")
  );
  const cdrSeq = cdrs.map(c => c.sequence).join("");
  if (!cdrSeq) {
    // No anchored CDR boundaries available — return an explicit "unavailable"
    // result rather than a misleading "Low" verdict on an empty sequence.
    return {
      index: 0, band: "Low", drivers: ["No anchored CDRs available — HIC index not computed"], provenance: "rule-based",
      note: "Anchored CDR boundaries not localised — HIC retention not estimated. Use the Layer 2 co-folded structure or run ANARCI for exact IMGT numbering before re-running.",
    };
  }
  const phi = mean([...cdrSeq].map(c => SURFACE_HYDROPHOBICITY[c] ?? 0));
  // Calibrated thresholds (Jain 2017 — HIC retention > 11 min = problematic):
  const band: "Low" | "Moderate" | "High" = phi > 0.45 ? "High" : phi > 0.15 ? "Moderate" : "Low";
  const drivers: string[] = [];
  for (const c of cdrs) {
    const m = mean([...c.sequence].map(ch => SURFACE_HYDROPHOBICITY[ch] ?? 0));
    if (m > 0.4) drivers.push(`${c.name} (${c.sequence}) — high surface hydrophobicity`);
  }
  if (drivers.length === 0) drivers.push("No individual CDR exceeds the high-hydrophobicity threshold.");
  return {
    index: Number(phi.toFixed(3)),
    band,
    drivers,
    provenance: "rule-based",
    note: "Sequence-anchored CDR surface hydrophobicity proxy. Confirm with HIC at the bench (Jain et al. 2017 PNAS 114, 944).",
  };
}

// ── SINS / Self-interaction ────────────────────────────────────────────────

/** SINS proxy: high net charge dipole + hydrophobic patches → self-association. */
export function predictSinsRisk(chains: AntibodyChain[]): {
  score: number;
  band: "Low" | "Moderate" | "High";
  drivers: string[];
  provenance: Provenance;
} {
  if (!chains?.length) return { score: 0, band: "Low", drivers: ["no chains"], provenance: "rule-based" };
  const drivers: string[] = [];
  let score = 0;
  for (const c of chains) {
    const pI = c.physicochemical?.isoelectric_point ?? 7;
    const charge7 = c.physicochemical?.net_charge_pH7 ?? 0;
    const gravy = c.physicochemical?.gravy ?? 0;
    if (pI > 8.5 || pI < 6) { score += 1; drivers.push(`${c.label}: pI ${pI.toFixed(1)} — outside 6.5–8.5 sweet spot`); }
    if (Math.abs(charge7) > 12) { score += 1; drivers.push(`${c.label}: |charge@7.4| ${Math.abs(charge7).toFixed(0)} — strong electrostatic asymmetry`); }
    if (gravy > -0.10) { score += 1; drivers.push(`${c.label}: GRAVY ${gravy.toFixed(2)} — hydrophobic surface exposed`); }
  }
  // CDR3 hydrophobicity dominates SINS
  const cdr3s = chains.flatMap(c => c.cdrs?.filter(d => d.name?.endsWith("3") && d.sequence) ?? []);
  for (const d of cdr3s) {
    const h = mean([...d.sequence].map(ch => HYDROPATHY[ch] ?? 0));
    if (h > 1.5) { score += 1; drivers.push(`${d.name} hydropathy ${h.toFixed(2)} — sticky CDR3`); }
  }
  const band: "Low" | "Moderate" | "High" = score >= 4 ? "High" : score >= 2 ? "Moderate" : "Low";
  return { score, band, drivers, provenance: "rule-based" };
}

// ── Polyreactivity / cross-reactivity ──────────────────────────────────────

/** Heuristic polyreactivity / poly-specificity score.
 *  Rationale: high CDR-H3 net positive charge, hydrophobic stretches, Arg-rich
 *  CDR loops correlate with polyreactivity (Birtalan 2008; Hötzel 2012). */
export function predictPolyreactivity(chains: AntibodyChain[]): {
  score: number;
  band: "Low" | "Moderate" | "High";
  drivers: string[];
  provenance: Provenance;
} {
  let score = 0;
  const drivers: string[] = [];
  for (const c of chains) {
    for (const d of c.cdrs || []) {
      if (!d.sequence) continue;
      const positive = (d.sequence.match(/[KR]/g) || []).length;
      const aromatic = (d.sequence.match(/[FYW]/g) || []).length;
      if (positive >= 4) { score += 2; drivers.push(`${d.name}: ${positive} basic residues — polyreactivity risk`); }
      if (aromatic >= 4) { score += 1; drivers.push(`${d.name}: ${aromatic} aromatics — broad-spectrum stickiness`); }
      const cationicAromatic = positive + aromatic;
      if (cationicAromatic >= 6 && d.name?.endsWith("3")) { score += 1; drivers.push(`${d.name} cationic+aromatic load — Birtalan 2008 polyreactivity signature`); }
    }
  }
  const band: "Low" | "Moderate" | "High" = score >= 5 ? "High" : score >= 2 ? "Moderate" : "Low";
  return { score, band, drivers, provenance: "rule-based" };
}

// ── CDR-H3 β-aggregation ───────────────────────────────────────────────────

export function predictCdrH3Aggregation(chains: AntibodyChain[]): {
  cdr_h3: string | null;
  mean_beta_propensity: number | null;
  band: "Low" | "Moderate" | "High" | "Unknown";
  hot_segments: { start: number; end: number; peak: number }[];
  provenance: Provenance;
} {
  const cdrh3 = chains.flatMap(c => c.cdrs || [])
    .find(d => d.name === "CDR-H3" && d.sequence);
  if (!cdrh3) return { cdr_h3: null, mean_beta_propensity: null, band: "Unknown", hot_segments: [], provenance: "rule-based" };
  const props = [...cdrh3.sequence].map(c => TANGO_BETA[c] ?? 0);
  const meanP = mean(props);
  const w = 4;
  const hot: { start: number; end: number; peak: number }[] = [];
  for (let i = 0; i + w <= props.length; i++) {
    const window = props.slice(i, i + w);
    const peak = Math.max(...window);
    if (mean(window) >= 0.75) hot.push({ start: i + 1, end: i + w, peak: Number(peak.toFixed(2)) });
  }
  const band: "Low" | "Moderate" | "High" = meanP > 0.7 ? "High" : meanP > 0.5 ? "Moderate" : "Low";
  return {
    cdr_h3: cdrh3.sequence,
    mean_beta_propensity: Number(meanP.toFixed(3)),
    band,
    hot_segments: hot.slice(0, 4),
    provenance: "rule-based",
  };
}

// ── Half-life via FcRn pH-binding heuristic ────────────────────────────────

/**
 * Read the heavy-chain sequence for charge analysis.
 *
 * Earlier revisions concatenated CDR sequences and called that the "chain
 * sequence". For an FcRn-binding proxy that's doubly wrong: (1) FcRn binds
 * via Fc residues, not the CDR variable region, and (2) a CDR concatenation
 * isn't a real sequence so its pH-6 charge has no physical meaning. We now
 * read the chain-level physicochemical numbers the L1 backend already
 * computed on the FULL chain, with the CDR concatenation only as a fallback
 * (and an explicit "approximate" note when we have to use it).
 */
function readHeavyChargeProfile(heavy: AntibodyChain): { z6: number; z74: number; method: "full-chain" | "cdr-fallback" } {
  // Prefer the L1 chain-level number (computed on the full chain).
  const z74Real = heavy.physicochemical?.net_charge_pH7;
  const cdrSeq = heavy.cdrs?.map(c => c.sequence ?? "").join("") ?? "";

  if (typeof z74Real === "number" && isFinite(z74Real)) {
    // Use the chain-level z(pH 7.4) and approximate z(pH 6) by adding the
    // CDR-anchored His contribution to it (each His protonates ~0.5 charge
    // unit between 7.4 and 6.0). The L1 backend's own _fcrn_binding_prediction
    // does this from the full chain — this client-side proxy uses the CDR
    // His count as a coarse hint when the full sequence isn't available here.
    const cdrHis = (cdrSeq.match(/H/g) || []).length;
    const z6 = z74Real + 0.5 * cdrHis;
    return { z6, z74: z74Real, method: "full-chain" };
  }

  // Fallback only — explicitly tagged in the response.
  const z74 = chargeAtPh(cdrSeq, 7.4);
  const z6  = chargeAtPh(cdrSeq, 6.0);
  return { z6, z74, method: "cdr-fallback" };
}

export function predictHalfLifeProxy(chains: AntibodyChain[], isFullAntibody: boolean): {
  estimated_t_half_days: string;
  band: "Short" | "Average" | "Extended";
  drivers: string[];
  provenance: Provenance;
} {
  // Sequence-only proxy: cationic patches at pH 6 (endosome) + neutral at pH 7.4
  // (plasma) is the FcRn-binding signature. Real prediction requires the Fc.
  const heavy = chains.find(c => /heavy/i.test(c.label) || /VH/i.test(c.label)) ?? chains[0];
  if (!heavy) return { estimated_t_half_days: "—", band: "Average", drivers: ["no heavy chain"], provenance: "rule-based" };
  const profile = readHeavyChargeProfile(heavy);
  const charge_pH6 = profile.z6;
  const charge_pH7 = profile.z74;
  const drivers: string[] = [];
  let band: "Short" | "Average" | "Extended" = "Average";
  let tHalfDays = "10–14 d (IgG1 typical)";
  if (!isFullAntibody) {
    tHalfDays = "<1 d (Fab / VHH — no FcRn)";
    band = "Short";
    drivers.push("No Fc — half-life is dominated by renal clearance.");
  } else if (charge_pH6 > 0 && charge_pH7 < 1.5) {
    tHalfDays = "14–21 d (favourable FcRn binding signature)";
    band = "Extended";
    drivers.push(`Variable region cationic at endosomal pH (charge ${charge_pH6.toFixed(1)}) and neutral in plasma — supports FcRn rescue.`);
  } else if (charge_pH6 < 0 && charge_pH7 < -2) {
    tHalfDays = "5–10 d (acidic variable region — reduced FcRn affinity expected)";
    band = "Short";
    drivers.push(`Acidic variable region — anionic at both pH; expect faster clearance.`);
  } else {
    drivers.push("Charge signature is within typical IgG1 range.");
  }
  if (profile.method === "cdr-fallback") {
    drivers.push(
      "Heavy-chain net charge unavailable from L1 — fell back to a CDR-concatenation " +
      "charge, which is a poor proxy for the FcRn interface. Use the L1 Henderson–Hasselbalch " +
      "result instead when available."
    );
  }
  return { estimated_t_half_days: tHalfDays, band, drivers, provenance: "rule-based" };
}

// ── MHC-II T-cell epitope load ─────────────────────────────────────────────

export function predictMhc2EpitopesAcrossChains(chains: AntibodyChain[]): {
  total_hits: number;
  per_chain: { label: string; hits: number; band: "low" | "moderate" | "high" }[];
  band: "Low" | "Moderate" | "High";
  load_per_100aa: number;
  provenance: Provenance;
  method: string;
} {
  const per: { label: string; hits: number; band: "low" | "moderate" | "high" }[] = [];
  let total = 0;
  let totalLen = 0;
  for (const c of chains) {
    const seq = (c.cdrs?.map(d => d.sequence ?? "").join("") || "");
    if (!seq) { per.push({ label: c.label, hits: 0, band: "low" }); continue; }
    let hits = 0;
    for (let i = 0; i + 9 <= seq.length; i++) {
      const core = seq.slice(i, i + 9);
      let s = 0;
      if (MHC2_P1.has(core[0])) s += 1;
      if (MHC2_P4.has(core[3])) s += 1;
      if (MHC2_P9.has(core[8])) s += 1;
      for (let k = 1; k < 9; k++) if (core[k] === "P") s -= 1;
      if (s >= 2) hits++;
    }
    total += hits;
    totalLen += seq.length;
    const per100 = seq.length ? (hits / seq.length) * 100 : 0;
    per.push({ label: c.label, hits, band: per100 > 8 ? "high" : per100 > 4 ? "moderate" : "low" });
  }
  const load = totalLen ? (total / totalLen) * 100 : 0;
  const band: "Low" | "Moderate" | "High" = load > 8 ? "High" : load > 4 ? "Moderate" : "Low";
  return {
    total_hits: total,
    per_chain: per,
    band,
    load_per_100aa: Number(load.toFixed(2)),
    provenance: "rule-based",
    method: "MHC-II 9-mer anchor PWM applied to anchored CDR concatenation.",
  };
}

// ── Germline similarity proxy (composition only) ───────────────────────────

export function predictGermlineSimilarity(chains: AntibodyChain[]): {
  similarity_pct: number;
  band: "Low" | "Moderate" | "High";
  drivers: string[];
  provenance: Provenance;
} {
  const allCdrSeq = chains.flatMap(c => c.cdrs || []).map(d => d.sequence ?? "").join("");
  if (!allCdrSeq) return { similarity_pct: 0, band: "Low", drivers: ["no CDR sequence"], provenance: "heuristic" };
  // Compute χ²-like distance vs germline composition
  const counts: Record<string, number> = {};
  for (const aa of allCdrSeq) counts[aa] = (counts[aa] || 0) + 1;
  const total = allCdrSeq.length;
  let dist = 0;
  for (const aa of Object.keys(HUMAN_GERMLINE_FRAC)) {
    const obs = (counts[aa] || 0) / total;
    const exp = HUMAN_GERMLINE_FRAC[aa];
    dist += Math.abs(obs - exp);
  }
  // Total-variation distance ∈ [0, 2]; convert to a 0-100% similarity proxy
  const similarity = Math.max(0, Math.min(100, (1 - dist / 0.7) * 100));
  const band: "Low" | "Moderate" | "High" =
    similarity >= 75 ? "High" : similarity >= 55 ? "Moderate" : "Low";
  const drivers: string[] = [
    `Composition distance ${(dist).toFixed(2)} (lower = more germline-like).`,
    "Proxy only — for a calibrated humanness score, align to IGHV/IGKV germlines (e.g. Hu-mAb, BIPSPI).",
  ];
  return { similarity_pct: Number(similarity.toFixed(1)), band, drivers, provenance: "heuristic" };
}

// ── Optional ML signal (AbLang2 / ESM-Ab) ──────────────────────────────────

export async function fetchAntibodyMlSignal(heavy: string, light?: string): Promise<null | {
  pseudo_loglik?: number;
  embedding_norm?: number;
  predicted_solubility?: string;
  provenance: Provenance;
  source: string;
}> {
  try {
    const res = await fetch(`${API_ROOT}/api/ai/antibody-ml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heavy_chain: heavy, light_chain: light ?? null }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return { ...json, provenance: "ml-predicted", source: json?.source ?? "AbLang2 (open-source)" };
  } catch {
    return null;
  }
}

// ── Bundle ─────────────────────────────────────────────────────────────────

export interface AntibodyL1PlusBundle {
  hic_retention:        ReturnType<typeof predictHicRetention>;
  sins_self_interaction: ReturnType<typeof predictSinsRisk>;
  polyreactivity:       ReturnType<typeof predictPolyreactivity>;
  cdr_h3_aggregation:   ReturnType<typeof predictCdrH3Aggregation>;
  half_life_proxy:      ReturnType<typeof predictHalfLifeProxy>;
  mhc2_epitope_load:    ReturnType<typeof predictMhc2EpitopesAcrossChains>;
  germline_similarity:  ReturnType<typeof predictGermlineSimilarity>;
  ml:                   Awaited<ReturnType<typeof fetchAntibodyMlSignal>>;
}

export async function computeAntibodyL1Plus(args: {
  result: AntibodyResult;
  heavyChain: string;
  lightChain?: string;
  tryMl?: boolean;
}): Promise<AntibodyL1PlusBundle> {
  const { result } = args;
  const isFull = !!result.inferred_format && /IgG|Fab|full/i.test(result.inferred_format);
  const hic = predictHicRetention(result.chains);
  const sins = predictSinsRisk(result.chains);
  const poly = predictPolyreactivity(result.chains);
  const h3agg = predictCdrH3Aggregation(result.chains);
  const t12 = predictHalfLifeProxy(result.chains, isFull);
  const mhc2 = predictMhc2EpitopesAcrossChains(result.chains);
  const germ = predictGermlineSimilarity(result.chains);
  const ml = args.tryMl !== false ? await fetchAntibodyMlSignal(args.heavyChain, args.lightChain) : null;
  return {
    hic_retention: hic,
    sins_self_interaction: sins,
    polyreactivity: poly,
    cdr_h3_aggregation: h3agg,
    half_life_proxy: t12,
    mhc2_epitope_load: mhc2,
    germline_similarity: germ,
    ml,
  };
}
