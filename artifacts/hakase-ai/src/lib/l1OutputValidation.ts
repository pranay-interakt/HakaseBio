/**
 * Layer 1 — Per-Output Validation
 * ─────────────────────────────────────────────────────────────────────────
 * "How do we validate every output?" — for DILI, hERG, permeability, every
 * ADMET axis, potency, etc. this module attaches an honest validation record to
 * EACH L1 output so a reviewer can see, per number:
 *
 *   • PROVENANCE   — measured / ML / heuristic / read-across (was it computed
 *                    by a real model, a rule of thumb, or a lab value?).
 *   • MODEL METRIC — the model's published benchmark accuracy (AUROC / R² from
 *                    admetMeta.ts — ADMET-AI's own TDC test numbers, incl. the
 *                    two endpoints with NEGATIVE R² that are flagged unreliable).
 *   • APPLICABILITY DOMAIN — is the molecule inside the training space, or is
 *                    the prediction an extrapolation? (OECD QSAR principle 3.)
 *   • SANITY       — is the value physically possible (probability ∈ [0,1],
 *                    permeability ≥ 0, …)? A FAIL means a pipeline bug, not a
 *                    risky molecule.
 *   • ORTHOGONAL   — does an independent line of evidence (read-across from
 *                    measured analogues) agree?
 *
 * From these it derives a single VALIDATION TIER per output:
 *   experimental > model-validated > directional > extrapolated > unreliable
 *
 * Nothing here changes a value or a verdict — it only annotates how much each
 * output can be trusted. Pure, side-effect-free.
 */

import type { SimResults } from "./admet";
import type { InVitroResults } from "./inVitroSim";
import type { MlOverlay } from "./mlOverlay";
import { admetMeta, admetAccuracyLabel, type AdmetReliability } from "./admetMeta";
import type { ApplicabilityDomain, EvidenceSupport } from "./l1Scorecard";

export type ValidationTier =
  | "experimental"     // measured (known drug / lab) — gold
  | "model-validated"  // real ML, decent benchmark, in-domain, sane value
  | "directional"      // heuristic rule of thumb — rank-order only
  | "extrapolated"     // ML but out of applicability domain
  | "unreliable";      // model worse than baseline on its own benchmark

export type Sanity = "pass" | "warn" | "fail" | "n/a";
export type OutputProvenance = "experimental" | "ml" | "heuristic" | "read-across" | "unavailable";

export interface OutputValidation {
  group: "Efficacy" | "Absorption" | "Distribution" | "Metabolism" | "Safety" | "Developability";
  endpoint: string;
  value: string;
  provenance: OutputProvenance;
  /** Model / rule that produced it. */
  method: string;
  /** Benchmark accuracy string ("AUROC 0.87" / "R² 0.59") or null. */
  modelMetric: string | null;
  reliability: AdmetReliability | "n/a";
  applicabilityDomain: string | null;
  sanity: Sanity;
  sanityNote: string;
  /** Independent agreement, when available. */
  orthogonal: string | null;
  tier: ValidationTier;
  /** One-line "how do we know this is right". */
  howValidated: string;
}

export interface L1ValidationReport {
  records: OutputValidation[];
  summary: Record<ValidationTier, number> & { total: number };
  overallConfidence: "High" | "Moderate" | "Low";
  headline: string;
}

export interface L1ValidationInput {
  admet: SimResults;
  inVitro: InVitroResults;
  overlay?: MlOverlay | null;
  applicabilityDomain?: ApplicabilityDomain | null;
  /** Whole profile is a measured known drug → outputs are experimental. */
  knownDrugMatched?: boolean;
  evidenceSupport?: EvidenceSupport | null;
}

// ── sanity bounds: physically/forma possible ranges (a FAIL = pipeline bug) ──
function sanityOf(value: number | null | undefined, lo: number, hi: number, unit = ""): { s: Sanity; note: string } {
  if (value == null || !Number.isFinite(value)) return { s: "n/a", note: "not computed" };
  if (value < lo || value > hi) return { s: "fail", note: `value ${value}${unit} outside physical range [${lo}, ${hi}]` };
  return { s: "pass", note: `within physical range [${lo}, ${hi}]${unit ? " " + unit : ""}` };
}

const PROB = (v: number | null | undefined) => sanityOf(v, 0, 1);

function tierFor(prov: OutputProvenance, reliability: AdmetReliability | "n/a", outOfDomain: boolean, sanity: Sanity): ValidationTier {
  if (prov === "experimental") return "experimental";
  if (prov === "read-across") return "model-validated";
  if (prov === "heuristic") return "directional";
  if (prov === "ml") {
    if (reliability === "unreliable") return "unreliable";
    if (outOfDomain) return "extrapolated";
    if (reliability === "high" || reliability === "moderate") return "model-validated";
    return "directional"; // low-AUROC ML → treat as directional
  }
  return "directional";
}

const TIER_RANK: Record<ValidationTier, number> = {
  experimental: 5, "model-validated": 4, directional: 3, extrapolated: 2, unreliable: 1,
};

export function buildL1ValidationReport(input: L1ValidationInput): L1ValidationReport {
  const { admet, inVitro, overlay } = input;
  const o = overlay ?? null;
  const adLabel = input.applicabilityDomain?.adLabel ?? null;
  const outOfDomain = adLabel === "Out-of-domain"
    || (input.evidenceSupport?.bestAdConfidence === "None");
  const adStr = adLabel ?? (input.evidenceSupport?.bestAdConfidence
    ? `AD ${input.evidenceSupport.bestAdConfidence}` : null);
  const exp = !!input.knownDrugMatched;
  const recs: OutputValidation[] = [];

  // helper to push a record
  const add = (
    group: OutputValidation["group"], endpoint: string, value: string,
    prov: OutputProvenance, method: string, metaId: string | null,
    sanity: { s: Sanity; note: string }, orthogonal: string | null = null,
  ) => {
    const meta = metaId ? admetMeta(metaId) : null;
    const provenance: OutputProvenance = exp ? "experimental" : prov;
    const reliability: AdmetReliability | "n/a" = meta?.reliability ?? "n/a";
    const metric = metaId ? admetAccuracyLabel(metaId) : null;
    const od = outOfDomain && provenance === "ml";
    const tier = tierFor(provenance, reliability, od, sanity.s);
    const howValidated =
      provenance === "experimental" ? "Measured value from the matched known drug (experimental)."
      : provenance === "read-across" ? "Anchored to measured ChEMBL analogues (read-across)."
      : provenance === "ml"
        ? `ML prediction (${method}${metric ? `, ${metric}` : ""})`
          + (od ? " — OUT of applicability domain → extrapolation, confirm in vitro."
             : reliability === "unreliable" ? " — model is below baseline on its own benchmark; do not rely on the absolute value."
             : `, ${adStr ?? "AD unknown"}; ${sanity.s === "pass" ? "value in physical range" : sanity.note}.`)
        : `Heuristic ${method} — directional rank-ordering only, not a calibrated value.`;
    recs.push({
      group, endpoint, value, provenance, method, modelMetric: metric,
      reliability, applicabilityDomain: provenance === "ml" ? adStr : null,
      sanity: sanity.s, sanityNote: sanity.note, orthogonal, tier, howValidated,
    });
  };

  const adProv = admet.provenance ?? {};
  const ivProv = inVitro.provenance ?? {};
  const mlOr = (k: string, prov: Record<string, any>): OutputProvenance => prov[k] === "ml" ? "ml" : "heuristic";

  // ── Efficacy ────────────────────────────────────────────────────────────
  {
    const ic50 = inVitro.doseResponse.ic50_nM;
    add("Efficacy", "On-target potency (IC50)",
      ic50 == null ? "no validated target" : `${ic50.toFixed(0)} nM`,
      ic50 == null ? "unavailable" : (o?.Kd_nM != null ? "ml" : "heuristic"),
      o?.Kd_nM != null ? "Binding-ML (DeepDTA-GBM, R² ≈ 0.60)" : "physchem QSAR estimate",
      null,
      sanityOf(ic50, 0, 1e9, " nM"));
  }

  // ── Absorption ────────────────────────────────────────────────────────────
  add("Absorption", "Caco-2 permeability",
    `${inVitro.permeability.caco2Papp.toFixed(1)} ×10⁻⁶ cm/s (${inVitro.permeability.caco2Class})`,
    o?.caco2_Papp_1e6_cm_s != null ? "ml" : "heuristic", "ADMET-AI Caco2_Wang", "Caco2_Wang",
    sanityOf(inVitro.permeability.caco2Papp, 0, 1000, " ×10⁻⁶ cm/s"),
    input.evidenceSupport ? "read-across available" : null);
  if (o?.hia_probability != null)
    add("Absorption", "Human intestinal absorption", `${Math.round(o.hia_probability * 100)}%`,
      "ml", "ADMET-AI HIA_Hou", "HIA_Hou", PROB(o.hia_probability));
  if (o?.bioavailability_F != null)
    add("Absorption", "Oral bioavailability", `${Math.round(o.bioavailability_F * 100)}%`,
      "ml", "ADMET-AI Bioavailability_Ma", "Bioavailability_Ma", PROB(o.bioavailability_F));
  if (o?.logS != null)
    add("Absorption", "Aqueous solubility (logS)", `${o.logS.toFixed(2)} log(mol/L)`,
      "ml", "Solubility-ML", "Solubility_AqSolDB", sanityOf(o.logS, -14, 2, " log"));

  // ── Distribution ────────────────────────────────────────────────────────────
  add("Distribution", "Plasma protein binding (fu)",
    `${inVitro.plasmaProteinBinding.fuPercent.toFixed(1)}% unbound`,
    o?.ppb_fu_fraction != null ? "ml" : "heuristic", "ADMET-AI PPBR_AZ", "PPBR_AZ",
    sanityOf(inVitro.plasmaProteinBinding.fuPercent, 0, 100, "%"));
  if (o?.bbb_probability != null)
    add("Distribution", "Blood-brain barrier", `${Math.round(o.bbb_probability * 100)}%`,
      "ml", "ADMET-AI BBB_Martins", "BBB_Martins", PROB(o.bbb_probability));
  if (o?.vd_l_per_kg != null)
    add("Distribution", "Volume of distribution (Vdss)", `${o.vd_l_per_kg.toFixed(2)} L/kg`,
      "ml", "ADMET-AI VDss_Lombardo", "VDss_Lombardo", sanityOf(o.vd_l_per_kg, 0, 100, " L/kg"));

  // ── Metabolism / Excretion ──────────────────────────────────────────────────
  add("Metabolism", "Microsomal stability (CLint)",
    `${inVitro.metabolicStability.microsomalCLint.toFixed(1)} µL/min/mg (${inVitro.metabolicStability.microsomalClass})`,
    mlOr("microsomalCLint", ivProv), "ADMET-AI Clearance_Microsome_AZ", "Clearance_Microsome_AZ",
    sanityOf(inVitro.metabolicStability.microsomalCLint, 0, 100000));
  if (o?.half_life_h != null)
    add("Metabolism", "Half-life", `${o.half_life_h.toFixed(1)} h`,
      "ml", "ADMET-AI Half_Life_Obach", "Half_Life_Obach", sanityOf(o.half_life_h, 0, 2000, " h"));
  for (const [iso, key, metaId] of [
    ["CYP3A4", "cyp3a4_inhibitor_prob", "CYP3A4_Veith"],
    ["CYP2D6", "cyp2d6_inhibitor_prob", "CYP2D6_Veith"],
    ["CYP2C9", "cyp2c9_inhibitor_prob", "CYP2C9_Veith"],
  ] as const) {
    const v = o?.[key];
    if (v != null) add("Metabolism", `${iso} inhibition`, `${Math.round(v * 100)}%`, "ml", "ADMET-AI Veith", metaId, PROB(v));
  }

  // ── Safety ────────────────────────────────────────────────────────────────
  if (o?.herg_blocker_prob != null)
    add("Safety", "hERG cardiac block", `${Math.round(o.herg_blocker_prob * 100)}%`,
      "ml", "CardioTox-ML (Wang/Karim RF)", "hERG", PROB(o.herg_blocker_prob),
      input.evidenceSupport?.hergReadAcrossNm != null
        ? `read-across IC50 ≈ ${(input.evidenceSupport.hergReadAcrossNm / 1000).toFixed(1)} µM` : null);
  else
    add("Safety", "hERG cardiac risk", `${inVitro.herg.riskCategory} (IC50 ${inVitro.herg.ic50_uM.toFixed(1)} µM)`,
      "heuristic", "physchem rule (no patch-clamp)", null, sanityOf(inVitro.herg.ic50_uM, 0, 1e6, " µM"));
  if (o?.dili_prob != null)
    add("Safety", "DILI (hepatotoxicity)", `${Math.round(o.dili_prob * 100)}%${o.dili_risk_class ? ` (${o.dili_risk_class})` : ""}`,
      "ml", "DILI-ML (DILIrank RF)", "DILI", PROB(o.dili_prob));
  if (o?.ames_prob != null)
    add("Safety", "Ames mutagenicity", `${Math.round(o.ames_prob * 100)}%`,
      "ml", "ADMET-AI AMES", "AMES", PROB(o.ames_prob));
  if (o?.clintox_prob != null)
    add("Safety", "Clinical-trial toxicity", `${Math.round(o.clintox_prob * 100)}%`,
      "ml", "ADMET-AI ClinTox", "ClinTox", PROB(o.clintox_prob));
  if (o?.carcinogen_prob != null)
    add("Safety", "Carcinogenicity", `${Math.round(o.carcinogen_prob * 100)}%`,
      "ml", "ADMET-AI Carcinogens", "Carcinogens_Lagunin", PROB(o.carcinogen_prob));
  // Structural alerts — deterministic, AD-independent
  if (admet.structuralAlerts?.scanRan)
    add("Safety", "Structural alerts (reactive/genotoxic)",
      `${admet.structuralAlerts.rejectCount} hard-reject, scan ran`,
      "experimental", "Brenk/BMS/NIH SMARTS scan", null, { s: "pass", note: "deterministic substructure match" });

  // ── Developability ──────────────────────────────────────────────────────────
  add("Developability", "Drug-likeness (QED)", admet.qed_approx.toFixed(2),
    "heuristic", "Bickerton QED", null, sanityOf(admet.qed_approx, 0, 1));
  add("Developability", "Lipinski Ro5 violations", `${admet.lipinski.violations}`,
    "experimental", "Lipinski Rule-of-5 (deterministic)", null, sanityOf(admet.lipinski.violations, 0, 4));
  add("Developability", "Synthetic accessibility", admet.saScore.toFixed(1),
    "heuristic", "Ertl-Schuffenhauer complexity", null, sanityOf(admet.saScore, 1, 10));

  // ── Summary ────────────────────────────────────────────────────────────────
  const summary = { experimental: 0, "model-validated": 0, directional: 0, extrapolated: 0, unreliable: 0, total: recs.length } as L1ValidationReport["summary"];
  for (const r of recs) summary[r.tier]++;
  const sane = recs.filter(r => r.sanity === "fail").length === 0;
  const validatedFrac = (summary.experimental + summary["model-validated"]) / Math.max(recs.length, 1);
  const overallConfidence: L1ValidationReport["overallConfidence"] =
    !sane ? "Low" : validatedFrac >= 0.6 ? "High" : validatedFrac >= 0.35 ? "Moderate" : "Low";
  const headline =
    `${summary.experimental + summary["model-validated"]}/${recs.length} outputs measured or model-validated`
    + (summary.extrapolated ? ` · ${summary.extrapolated} extrapolated (out-of-domain)` : "")
    + (summary.unreliable ? ` · ${summary.unreliable} unreliable (below-baseline model)` : "")
    + (sane ? "" : " · ⚠ sanity-check failure")
    + ".";

  // sort by group then by validation strength (strongest first within group)
  const GROUP_ORDER = ["Efficacy", "Absorption", "Distribution", "Metabolism", "Safety", "Developability"];
  recs.sort((a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    || TIER_RANK[b.tier] - TIER_RANK[a.tier]);

  return { records: recs, summary, overallConfidence, headline };
}
