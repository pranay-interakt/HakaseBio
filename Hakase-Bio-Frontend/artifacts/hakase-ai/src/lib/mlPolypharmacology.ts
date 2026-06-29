/**
 * ML-predicted polypharmacology — diverse-target Binding-ML panel.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Why this exists
 * ───────────────
 * For a TRULY novel small molecule with no ChEMBL Tanimoto ≥ 70% neighbour,
 * the existing target-suggestion pipeline falls back to a 29-target
 * pharmacophore catalogue (`targetSuggestion.ts → CATALOGUE`).  That
 * catalogue is heavily kinase-biased, so an off-class scaffold
 * (anti-oxidant, peroxisome ligand, GPCR ligand outside the 4 in the
 * catalogue, ion-channel modulator) under-triggers and the user sees
 * canned-looking kinase suggestions that don't fit.
 *
 * This module closes the gap by running the AI-service Binding-ML head
 * (DeepDTA-GBM, ESM-2 + Morgan FP) IN PARALLEL against a diverse
 * shortlist of DrugCentral targets — one or two representatives per
 * major target class.  Each call returns a predicted pKd and an
 * applicability-domain flag (Tanimoto-NN to the BindingDB training set).
 * The orchestrator surfaces ML-predicted Kd hits as TargetSuggestions
 * with `source: "chembl-similar"` provenance so the cascade gate scores
 * them at the ML tier (0.7), not the structural tier (0.6).
 *
 * Design constraints
 * ──────────────────
 *   • At most 12 backend calls per molecule — keeps total latency under
 *     ~6 s with a warm cache.
 *   • Shortlist is curated by target class (kinase × 4, GPCR × 2,
 *     NR × 2, enzyme × 2, ion channel × 2) to give a polypharmacology
 *     readout that covers the typical novel-molecule design space.
 *   • Out-of-domain predictions (Tanimoto < 0.3 to training set) are
 *     still surfaced but tagged "ad_in_domain=false" so the UI can
 *     show a low-confidence chip.
 *   • Anything below the high-affinity pKd cutoff (default 6, ≈ 1 µM Kd)
 *     is dropped so the panel stays informative.
 */

import { predictBindingMl, type BindingMlResult } from "./aiService";
import { DRUGCENTRAL_TARGET_META } from "./drugcentralValidatedTargets";

export interface MlTargetPrediction {
  uniprotId:        string;
  geneName:         string;
  fullName:         string;
  targetClass:      string;
  pKd_predicted:    number;
  Kd_nM:            number;
  affinityClass:    "High affinity" | "Moderate affinity" | "Weak affinity" | "Negligible";
  /** Applicability-domain Tanimoto NN to BindingML training set. */
  adTanimoto:       number | null;
  /** True when ad_tanimoto ≥ 0.4 (in-distribution). */
  adInDomain:       boolean;
  /** "ml" when ai-service returned source: "ml" AND Kd_nM is finite. */
  source:           "ml" | "fallback";
}

/**
 * Curated diverse-class shortlist — one or two representatives per major
 * target class drawn from the DrugCentral 179-UniProt allow-list.  All
 * accessions are validated against DrugCentral so the surface UI can
 * cite measured bioactivity counts.  These are the targets a small-molecule
 * project is most likely to be hitting if it's not a kinase inhibitor;
 * the existing 29-target SMARTS catalogue already covers the kinase &
 * cancer-target axes, so this shortlist deliberately broadens coverage.
 */
const DIVERSE_PANEL: readonly string[] = [
  // Kinases — well-trained, broad polypharmacology readout
  "P00533",  // EGFR     — receptor tyrosine kinase
  "P00519",  // ABL1     — non-receptor tyrosine kinase
  "P06493",  // CDK1     — cell-cycle Ser/Thr kinase
  "O60674",  // JAK2     — JAK family
  // Enzymes — non-kinase enzymes outside the kinase catalogue
  "P00918",  // CA2      — carbonic anhydrase (sulfonamide-class)
  "P08684",  // CYP3A4   — major xenobiotic metabolism
  // Ion channels — high-priority cardiac/CNS safety classes
  "Q14524",  // SCN5A    — Nav1.5 cardiac sodium channel
  "Q12809",  // KCNH2    — hERG / Kv11.1
  // (HCN4, KCNK2 also in DrugCentral; capped at 12 for latency.)
  "O95180",  // CACNA1H  — Cav3.2 T-type calcium channel
  // Receptors / NRs / GPCRs — covers PPARs and other classes
  "P37231",  // PPARG    — peroxisome proliferator-activated γ
  "P11473",  // VDR      — vitamin D receptor
  "P21731",  // TBXA2R   — thromboxane A2 receptor (GPCR)
] as const;

/**
 * Filter `DIVERSE_PANEL` to only those UniProts that actually appear in
 * the vendored DrugCentral allow-list — guarantees every prediction can
 * cite a published bioactivity count and target-class label.
 */
function panelInDrugCentral(): readonly string[] {
  return DIVERSE_PANEL.filter(u => u in DRUGCENTRAL_TARGET_META);
}

/**
 * Run Binding-ML in parallel against the diverse-class shortlist and
 * return the high-affinity hits, ranked by predicted Kd.  Failed calls
 * and below-threshold predictions are dropped silently — the orchestrator
 * treats an empty result as "no polypharmacology hits", not as an error.
 */
export async function predictPolypharmacologyPanel(
  smiles: string,
  opts: {
    /** Minimum predicted pKd to surface.  Default 5.5 (≈ 3 µM Kd) — keeps
     *  the panel informative without dropping weak-but-real hits. */
    minPKd?: number;
    /** Maximum number of hits to return.  Default 6. */
    topN?: number;
  } = {},
): Promise<MlTargetPrediction[]> {
  const minPKd = opts.minPKd ?? 5.5;
  const topN = opts.topN ?? 6;
  if (!smiles || !smiles.trim()) return [];

  const panel = panelInDrugCentral();
  // Promise.allSettled so a single backend failure (or 404) doesn't bring
  // down the whole panel.  Each entry is independent.
  const settled = await Promise.allSettled(
    panel.map(uid => predictBindingMl(smiles, uid)),
  );

  const hits: MlTargetPrediction[] = [];
  settled.forEach((s, idx) => {
    if (s.status !== "fulfilled") return;
    const r: BindingMlResult = s.value;
    if (r.source !== "ml" || !r.ml_available) return;
    const pKd = r.prediction.pKd_predicted;
    const Kd  = r.prediction.Kd_nM;
    if (pKd === null || Kd === null) return;
    if (!Number.isFinite(pKd) || !Number.isFinite(Kd)) return;
    if (pKd < minPKd) return;
    const meta = DRUGCENTRAL_TARGET_META[panel[idx]];
    if (!meta) return;  // defensive — should never happen given panelInDrugCentral filter
    // Applicability-domain hint (lives on .applicability_domain when the
    // backend has it; falls back to null when older deployments don't).
    const ad: { ad_tanimoto_nearest?: number | null; ad_in_domain?: boolean | null } | undefined =
      (r as unknown as { applicability_domain?: { ad_tanimoto_nearest?: number | null; ad_in_domain?: boolean | null } }).applicability_domain;
    const adTan = ad?.ad_tanimoto_nearest ?? null;
    const adIn  = ad?.ad_in_domain ?? (typeof adTan === "number" ? adTan >= 0.4 : false);
    hits.push({
      uniprotId:     panel[idx],
      geneName:      meta.gene,
      fullName:      meta.targetName,
      targetClass:   meta.targetClass,
      pKd_predicted: pKd,
      Kd_nM:         Kd,
      affinityClass: r.prediction.affinity_class ?? "Weak affinity",
      adTanimoto:    adTan,
      adInDomain:    !!adIn,
      source:        "ml",
    });
  });

  // Rank by predicted pKd descending (highest affinity first), then cap.
  hits.sort((a, b) => b.pKd_predicted - a.pKd_predicted);
  return hits.slice(0, topN);
}
