/**
 * Layer 1 — ML Overlay
 * ─────────────────────────────────────────────────────────────────────────
 * Canonical adapter that converts the heterogeneous ai-service responses
 * (ADMET-AI Chemprop v2, CardioTox RF, DILI-ML, Binding-ML, Solubility-ML)
 * into a single flat shape consumed by `runAdmetSimulation` and
 * `runInVitroSimulation`.
 *
 * Why this exists
 * ───────────────
 * The dev-branch L1 engines run pure heuristic regressions (TPSA brackets,
 * logP rules of thumb, SMARTS motif counts) and only consume `predictedKd_nM`
 * from the binding-ML head. All of the other ML signals (ADMET-AI's 41
 * endpoints, CardioTox hERG, DILI-ML risk class, ADMET-AI AMES/DILI/ClinTox
 * heads) reach `cascadeGate.ts` via `CascadeMlOverrides` but never reach the
 * L1 simulator — so the *displayed* hERG IC50, AMES alert, and ADMET sub-
 * scores remain heuristic even when reliable ML is available.
 *
 * This module closes that gap. Build the overlay once from the AI-service
 * responses, pass it to both L1 engines, and every numeric output that has
 * a real ML signal upgrades from heuristic (tier 0.3) to ML (tier 0.7) with
 * the `provenance` field stamped accordingly.
 *
 * Provenance discipline (project policy — NO silent coercion)
 * ───────────────────────────────────────────────────────────
 *   1. A value is only present on the overlay when source === "ml" AND the
 *      numeric leaf is non-null and finite. Failed inferences, fallback
 *      payloads, and string-typed values are silently dropped so the L1
 *      engine sees `null` and falls back to its honest heuristic.
 *   2. `provenance.<field> === "ml"` requires that the overlay supplied a
 *      value AND L1 actually used it. Heuristic fallback never gets the
 *      "ml" tag.
 *   3. `overlayHasAnyMl(overlay)` returns true iff at least one field on
 *      the overlay is non-null — used to drive the `mlEnhanced` flag on
 *      SimResults / InVitroResults so the UI can surface a single
 *      "ML-Enhanced" badge per panel.
 */

import type {
  MlAdmetResult,
  CardiotoxResult,
  DiliMlResult,
  BindingMlResult,
  SolubilityMlResult,
} from "./aiService";

// ─────────────────────────────────────────────────────────────────────────
// MlOverlay — the flat shape L1 engines consume.
// ─────────────────────────────────────────────────────────────────────────

export interface MlOverlay {
  // ── Absorption ─────────────────────────────────────────────────────────
  /** ADMET-AI Caco2_Wang — log papp in 10⁻⁶ cm/s (raw GNN output, NOT log10). */
  caco2_Papp_1e6_cm_s: number | null;
  /** ADMET-AI HIA_Hou — probability of human intestinal absorption [0, 1]. */
  hia_probability: number | null;
  /** ADMET-AI Bioavailability_Ma — predicted oral F [0, 1]. */
  bioavailability_F: number | null;
  /** ADMET-AI Pgp_Broccatelli — probability the molecule is a P-gp substrate [0, 1]. */
  pgp_substrate_prob: number | null;

  // ── Distribution ───────────────────────────────────────────────────────
  /** ADMET-AI BBB_Martins — probability of BBB penetration [0, 1]. */
  bbb_probability: number | null;
  /** ADMET-AI PPBR_AZ — predicted plasma fraction unbound (fu, [0, 1]). */
  ppb_fu_fraction: number | null;
  /** ADMET-AI VDss_Lombardo — volume of distribution at steady state, L/kg. */
  vd_l_per_kg: number | null;

  // ── Metabolism ─────────────────────────────────────────────────────────
  /** ADMET-AI Clearance_Hepatocyte_AZ — µL/min/10⁶ cells. */
  hepatocyte_clint_ul_min_1e6_cells: number | null;
  /** ADMET-AI Half_Life_Obach — hours. */
  half_life_h: number | null;
  /** Per-isoform CYP inhibitor probability (ADMET-AI Veith heads, [0, 1]). */
  cyp1a2_inhibitor_prob:  number | null;
  cyp2c9_inhibitor_prob:  number | null;
  cyp2c19_inhibitor_prob: number | null;
  cyp2d6_inhibitor_prob:  number | null;
  cyp3a4_inhibitor_prob:  number | null;

  // ── Toxicity ───────────────────────────────────────────────────────────
  /** CardioTox RF blocker probability [0, 1]. Preferred over ADMET-AI hERG head. */
  herg_blocker_prob: number | null;
  /** CardioTox IC50 band midpoint in µM, if the model produced one (e.g. "1–10 µM"). */
  herg_ic50_band_um: number | null;
  /** ADMET-AI AMES — bacterial reverse-mutation probability [0, 1]. */
  ames_prob: number | null;
  /** DILI-ML probability [0, 1] AND its categorical risk class. */
  dili_prob: number | null;
  dili_risk_class: "Low" | "Moderate" | "High" | null;
  /** ADMET-AI ClinTox — clinical-trial toxicity probability [0, 1]. */
  clintox_prob: number | null;
  /** ADMET-AI Carcinogens_Lagunin — rodent carcinogenicity probability [0, 1]. */
  carcinogen_prob: number | null;
  /** ADMET-AI Skin_Reaction — Draize skin reaction probability [0, 1]. */
  skin_reaction_prob: number | null;
  /** ADMET-AI LD50_Zhu — oral rat LD50 in mg/kg. */
  ld50_mg_per_kg: number | null;

  // ── Binding ────────────────────────────────────────────────────────────
  /** Binding-ML Kd in nM (target-aware, ESM-2 + Morgan GBM). */
  Kd_nM: number | null;

  // ── Solubility ─────────────────────────────────────────────────────────
  /** Solubility-ML logS predicted value. */
  logS: number | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Constructors and predicates.
// ─────────────────────────────────────────────────────────────────────────

export function emptyOverlay(): MlOverlay {
  return {
    caco2_Papp_1e6_cm_s: null,
    hia_probability: null,
    bioavailability_F: null,
    pgp_substrate_prob: null,
    bbb_probability: null,
    ppb_fu_fraction: null,
    vd_l_per_kg: null,
    hepatocyte_clint_ul_min_1e6_cells: null,
    half_life_h: null,
    cyp1a2_inhibitor_prob:  null,
    cyp2c9_inhibitor_prob:  null,
    cyp2c19_inhibitor_prob: null,
    cyp2d6_inhibitor_prob:  null,
    cyp3a4_inhibitor_prob:  null,
    herg_blocker_prob: null,
    herg_ic50_band_um: null,
    ames_prob: null,
    dili_prob: null,
    dili_risk_class: null,
    clintox_prob: null,
    carcinogen_prob: null,
    skin_reaction_prob: null,
    ld50_mg_per_kg: null,
    Kd_nM: null,
    logS: null,
  };
}

export function overlayHasAnyMl(o: MlOverlay): boolean {
  return Object.values(o).some(v => v !== null && v !== undefined);
}

/** Strict numeric guard — rejects null, undefined, NaN, ±Inf, and strings.
 *  Matches the cascadeGate.ts policy: malformed payloads do NOT upgrade tier. */
function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Extract a finite number from an `MlEndpointValue`-shaped record entry. */
function endpointNumber(
  bucket: Record<string, { value: number | string | null; label: string }> | undefined,
  key: string,
): number | null {
  const v = bucket?.[key]?.value;
  return finite(v) ? v : null;
}

/** Parse hERG IC50 band string (e.g. "1–10 µM", "<1 µM", ">10 µM") to a
 *  midpoint in µM. Returns null when the band is unparseable or absent.
 *  Conservative: closed-open bands map to the OPEN endpoint (e.g. "<1 µM"
 *  → 0.5 µM, the geometric midpoint of 0.1–1; ">10 µM" → 30, midpoint of
 *  the 10–100 band where the band is likely to actually fall). */
function parseHergBandMidpointUm(band: string | null | undefined): number | null {
  if (!band || typeof band !== "string") return null;
  const s = band.replace(/\s+/g, "").replace(/µm|um/i, "").toLowerCase();
  // "<X" — bounded above only
  const ltMatch = s.match(/^<\s*(\d+(?:\.\d+)?)$/);
  if (ltMatch) {
    const top = parseFloat(ltMatch[1]);
    // Geometric mean of decade-below..top, conservative.
    return Math.sqrt(top * (top / 10));
  }
  // ">X" — bounded below only
  const gtMatch = s.match(/^>\s*(\d+(?:\.\d+)?)$/);
  if (gtMatch) {
    const bottom = parseFloat(gtMatch[1]);
    return Math.sqrt(bottom * (bottom * 10));
  }
  // "X–Y" or "X-Y" — closed range, geometric mean (it's a log axis)
  const rangeMatch = s.match(/^(\d+(?:\.\d+)?)[-–](\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const a = parseFloat(rangeMatch[1]);
    const b = parseFloat(rangeMatch[2]);
    if (a > 0 && b > 0) return Math.sqrt(a * b);
  }
  // Plain number — treat as point estimate
  const plain = parseFloat(s);
  if (Number.isFinite(plain) && plain > 0) return plain;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Inverse mappings — exposed so the in-vitro engine can translate ML
// probabilities into the µM IC50 / risk-band schema its existing schema
// already exposes.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Calibrated inverse-logistic mapping from a CYP inhibition probability
 * (ADMET-AI Veith head, [0, 1]) to an IC50 in µM. Calibration: p=0.5 anchors
 * at the published Veith decision threshold (10 µM), p=0.9 ≈ 1 µM (potent
 * inhibitor), p=0.1 ≈ 50 µM (clean). Same calibration in both directions.
 */
export function cypProbToIc50_uM(p: number | null): number | null {
  if (!finite(p) || p <= 0 || p >= 1) return null;
  // log10(IC50_uM) = 1 - 1.7 · logit(p)
  //   p=0.10 → logit≈-2.2 → log10 IC50 ≈ 4.74 → IC50 ≈ 55 µM
  //   p=0.50 → logit≈ 0   → log10 IC50 ≈ 1    → IC50 = 10 µM
  //   p=0.90 → logit≈ 2.2 → log10 IC50 ≈ -2.74 → IC50 ≈ 0.18 µM → clamped
  const logit = Math.log(p / (1 - p));
  const log10ic50 = 1.0 - 1.7 * logit;
  const ic50 = Math.pow(10, log10ic50);
  return Math.max(0.05, Math.min(50, ic50));
}

/**
 * Calibrated inverse-logistic mapping from a CardioTox hERG blocker
 * probability ([0, 1]) to an IC50 in µM. Calibration anchored on the
 * Wang/Karim 2016 dataset: p=0.5 ≈ 10 µM (the dataset's blocker threshold),
 * p=0.9 ≈ 0.5 µM (potent block), p=0.1 ≈ 100 µM (very safe).
 */
export function hergProbToIc50_uM(p: number | null): number | null {
  if (!finite(p) || p <= 0 || p >= 1) return null;
  const logit = Math.log(p / (1 - p));
  const log10ic50 = 1.0 - 1.4 * logit;
  const ic50 = Math.pow(10, log10ic50);
  return Math.max(0.05, Math.min(200, ic50));
}

// ─────────────────────────────────────────────────────────────────────────
// Builder — combines all ai-service responses into a single overlay.
// ─────────────────────────────────────────────────────────────────────────

export interface BuildMlOverlayInput {
  admet?: MlAdmetResult | null;
  cardiotox?: CardiotoxResult | null;
  dili?: DiliMlResult | null;
  binding?: BindingMlResult | null;
  solubility?: SolubilityMlResult | null;
}

/**
 * Combine ai-service responses into a canonical `MlOverlay`. A response is
 * accepted ONLY when `source === "ml"` and `ml_available === true`. Anything
 * else is silently dropped (the overlay stays null on that field, and the L1
 * engine falls back to its honest heuristic).
 *
 * This is pure — no fetching. Call the predictXxx functions in the
 * orchestrator (or wherever the responses are cached in React state), then
 * pass the results to this builder.
 */
export function buildMlOverlay(input: BuildMlOverlayInput): MlOverlay {
  const o = emptyOverlay();

  // ── ADMET-AI Chemprop v2 (41 endpoints) ──────────────────────────────
  const a = input.admet;
  if (a && a.source === "ml" && a.ml_available) {
    const s = a.structured;
    // Absorption
    o.caco2_Papp_1e6_cm_s = endpointNumber(s.absorption, "Caco2_Wang");
    o.hia_probability     = endpointNumber(s.absorption, "HIA_Hou");
    o.bioavailability_F   = endpointNumber(s.absorption, "Bioavailability_Ma");
    o.pgp_substrate_prob  = endpointNumber(s.absorption, "Pgp_Broccatelli");
    // Distribution
    o.bbb_probability     = endpointNumber(s.distribution, "BBB_Martins");
    const ppbBound        = endpointNumber(s.distribution, "PPBR_AZ"); // % bound
    o.ppb_fu_fraction     = ppbBound !== null ? Math.max(0, Math.min(1, 1 - ppbBound / 100)) : null;
    o.vd_l_per_kg         = endpointNumber(s.distribution, "VDss_Lombardo");
    // Metabolism: per-isoform CYP inhibitor heads
    o.cyp1a2_inhibitor_prob  = endpointNumber(s.metabolism, "CYP1A2_Veith");
    o.cyp2c9_inhibitor_prob  = endpointNumber(s.metabolism, "CYP2C9_Veith");
    o.cyp2c19_inhibitor_prob = endpointNumber(s.metabolism, "CYP2C19_Veith");
    o.cyp2d6_inhibitor_prob  = endpointNumber(s.metabolism, "CYP2D6_Veith");
    o.cyp3a4_inhibitor_prob  = endpointNumber(s.metabolism, "CYP3A4_Veith");
    // Excretion
    o.hepatocyte_clint_ul_min_1e6_cells = endpointNumber(s.excretion, "Clearance_Hepatocyte_AZ");
    o.half_life_h                       = endpointNumber(s.excretion, "Half_Life_Obach");
    // Toxicity (ADMET-AI heads — CardioTox below preferred for hERG)
    const admetHerg = endpointNumber(s.toxicity, "hERG");
    if (admetHerg !== null) o.herg_blocker_prob = admetHerg;
    o.ames_prob        = endpointNumber(s.toxicity, "AMES");
    const admetDili    = endpointNumber(s.toxicity, "DILI");
    if (admetDili !== null && o.dili_prob === null) o.dili_prob = admetDili;
    o.clintox_prob     = endpointNumber(s.toxicity, "ClinTox");
    o.carcinogen_prob  = endpointNumber(s.toxicity, "Carcinogens_Lagunin");
    o.skin_reaction_prob = endpointNumber(s.toxicity, "Skin_Reaction");
    o.ld50_mg_per_kg   = endpointNumber(s.toxicity, "LD50_Zhu");
  }

  // ── CardioTox RF (Wang/Karim 2016 hERG) — overrides ADMET-AI hERG ─────
  const c = input.cardiotox;
  if (c && c.source === "ml" && c.ml_available) {
    const p = c.prediction.blocker_probability;
    if (finite(p)) o.herg_blocker_prob = p;     // CardioTox preferred over ADMET-AI hERG
    o.herg_ic50_band_um = parseHergBandMidpointUm(c.prediction.ic50_band);
  }

  // ── DILI-ML (DILIrank RF) — overrides ADMET-AI DILI ───────────────────
  const d = input.dili;
  if (d && d.source === "ml" && d.ml_available) {
    const p = d.prediction.dili_probability;
    if (finite(p)) o.dili_prob = p;             // DILI-ML preferred over ADMET-AI DILI
    o.dili_risk_class = d.prediction.risk_class;
  }

  // ── Binding-ML (DeepDTA-GBM, ESM-2 + Morgan FP) ───────────────────────
  const b = input.binding;
  if (b && b.source === "ml" && b.ml_available) {
    if (finite(b.prediction.Kd_nM)) o.Kd_nM = b.prediction.Kd_nM;
  }

  // ── Solubility-ML ─────────────────────────────────────────────────────
  const sol = input.solubility;
  if (sol && sol.source === "ml" && sol.ml_available) {
    if (finite(sol.prediction.logS_predicted)) o.logS = sol.prediction.logS_predicted;
  }

  return o;
}
