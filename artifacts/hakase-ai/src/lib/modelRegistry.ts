/**
 * HAIOps Model Registry — typed manifest of every computational model that
 * influences a Layer 1 prediction.
 *
 * Why a registry:
 *   - HAIOps requires every safety-relevant prediction to declare the model
 *     that produced it, its risk tier, and its validation status, *before*
 *     downstream layers consume the output.
 *   - When a `ProvenanceRecord` lists a `modelVersion`, this registry is the
 *     single source of truth for "is this version approved, what risk class
 *     does it live in, and what governance steps apply?"
 *   - Drift / regression checks compare the live equation against the
 *     `reproducibilityHash` recorded here — any silent change to a model
 *     equation produces a mismatch and a HAIOps audit event.
 *
 * Risk tiers follow the published HAIOps definition surfaced in
 * `pages/HAIOps.tsx`:
 *   foundational : deterministic, no ML inference
 *   moderate     : ML inference, advisory output only
 *   high         : ML inference influencing quantitative predictions
 *   critical     : direct influence on safety-relevant decisions
 *
 * `validationStatus` separates models that have a published external
 * validation set from those used purely for directional ranking.
 */

import { fnv1a32 } from "./uncertainty";

export type RiskTier = "foundational" | "moderate" | "high" | "critical";

export type ValidationStatus =
  | "validated"          // external held-out validation reported
  | "directional"        // descriptor-derived, not externally validated
  | "research_only";     // experimental — not for safety decisions

export interface RegisteredModel {
  modelVersion: string;          // stable id, eg. "aronov_herg_2008@v1"
  displayName: string;
  riskTier: RiskTier;
  validationStatus: ValidationStatus;
  /** Bibliographic citation. */
  source: string;
  /** Plain-language description of what the model predicts. */
  predicts: string;
  /** Governance steps required by HAIOps for this risk tier. */
  governance: string[];
  /** Reported residual SD or RMSE on the model's natural scale, when known. */
  reportedRmse?: number;
  /** Reported applicability-domain bounds — descriptive only. */
  applicabilityDomain?: string;
  /**
   * Fingerprint of the canonical equation/parameter set. Computed from a
   * static string that changes only when the model itself changes; used by
   * drift detection to detect silent edits to the implementation.
   */
  reproducibilityHash: string;
}

/**
 * Build a reproducibility hash from a stable string describing the equation.
 * Pass a string that uniquely identifies the equation form + coefficients +
 * source — changing the implementation should change this hash.
 */
export function buildReproHash(spec: string): string {
  return fnv1a32(spec).toString(16).padStart(8, "0");
}

/**
 * Layer 1 governance manifest. Every QSAR/QED/SA model used in L1 is listed
 * here. Adding a new model is a registry change first, code change second.
 */
export const L1_MODEL_REGISTRY: Record<string, RegisteredModel> = {
  // ── Foundational ───────────────────────────────────────────────────────
  "rdkit_descriptors@2025.03.4": {
    modelVersion: "rdkit_descriptors@2025.03.4",
    displayName: "RDKit descriptor pipeline",
    riskTier: "foundational",
    validationStatus: "validated",
    source: "RDKit Open-Source Cheminformatics, version 2025.03.4",
    predicts: "Molecular descriptors (MW, LogP, TPSA, HBD/HBA, rings, kappa, …)",
    governance: ["Version-pinned WASM binary", "Deterministic-output regression test"],
    applicabilityDomain: "Any valid SMILES",
    reproducibilityHash: buildReproHash("rdkit|2025.03.4|get_descriptors+pharmacophores"),
  },

  // ── Critical (drive safety decisions) ──────────────────────────────────
  "aronov_herg_2008@v1": {
    modelVersion: "aronov_herg_2008@v1",
    displayName: "Aronov 2008 hERG IC50",
    riskTier: "critical",
    validationStatus: "validated",
    source: "Aronov, J. Med. Chem. 51:6917 (2008)",
    predicts: "hERG channel inhibition IC50 (µM)",
    governance: [
      "ICH S7B cross-reference required on outputs",
      "Mandatory cardiac safety flag if IC50 < 10 µM",
      "Out-of-domain inputs trigger extrapolation warning",
    ],
    reportedRmse: 0.60,
    applicabilityDomain: "logP ∈ [0, 6]; TPSA ∈ [10, 180] Å²; MW ∈ [150, 700]",
    reproducibilityHash: buildReproHash("aronov|pIC50=1.49*logP-0.087*tpsa/10+1.5*basic-0.6"),
  },
  "veith_cyp_2009@v1": {
    modelVersion: "veith_cyp_2009@v1",
    displayName: "Veith 2009 CYP isoform inhibition panel",
    riskTier: "critical",
    validationStatus: "validated",
    source: "Veith et al., Nat. Biotechnol. 27:1050 (2009)",
    predicts: "CYP1A2/2C9/2C19/2D6/3A4 inhibition IC50 (µM) + p(inhibitor)",
    governance: [
      "FDA DDI Guidance cross-reference on outputs",
      "Mandatory DDI flag if any isoform IC50 < 5 µM",
    ],
    reportedRmse: 0.50,
    applicabilityDomain: "logP ∈ [-1, 6]; MW ∈ [120, 700]",
    reproducibilityHash: buildReproHash("veith|logistic_per_isoform|cyp1a2|cyp2c9|cyp2c19|cyp2d6|cyp3a4"),
  },
  "bayes_pic50@v1": {
    modelVersion: "bayes_pic50@v1",
    displayName: "Bayesian pIC50 posterior",
    riskTier: "critical",
    validationStatus: "directional",
    source: "Bayesian posterior: ChEMBL active-median prior × descriptor likelihood",
    predicts: "Target binding pIC50 (M) with 95% CI",
    governance: [
      "Posterior SD must propagate to dose projection",
      "Out-of-domain inputs downgrade GO → WATCH",
    ],
    reportedRmse: 1.0,
    applicabilityDomain: "MW ∈ [180, 650]; logP ∈ [-1, 6]; TPSA ∈ [10, 180]",
    reproducibilityHash: buildReproHash("bayes_pic50|prior_mean=6.0_sd=1.2|likelihood_sd=1.0"),
  },

  // ── High (quantitative inputs to safety reasoning) ─────────────────────
  "hou_caco2_2007@v1": {
    modelVersion: "hou_caco2_2007@v1",
    displayName: "Hou 2007 Caco-2 permeability",
    riskTier: "high",
    validationStatus: "validated",
    source: "Hou et al., J. Chem. Inf. Model. 47:208 (2007)",
    predicts: "Caco-2 apparent permeability (10⁻⁶ cm·s⁻¹)",
    governance: ["Used as input to oral bioavailability projection", "Confidence band rendered on output"],
    reportedRmse: 0.41,
    applicabilityDomain: "TPSA ∈ [0, 170]; logP ∈ [-1.5, 6]",
    reproducibilityHash: buildReproHash("hou|log(Papp)=-4.36-0.01*tpsa+0.043*logP"),
  },
  "lewis_riley_clint@v1": {
    modelVersion: "lewis_riley_clint@v1",
    displayName: "Lewis/Riley microsomal CLint",
    riskTier: "high",
    validationStatus: "validated",
    source: "Lewis, Drug Metab. Rev. 35:1 (2003); Riley et al. DMD 33:1304 (2005)",
    predicts: "Hepatic microsomal intrinsic clearance (µL·min⁻¹·mg⁻¹)",
    governance: ["Feeds Obach-1999 microsome→hepatocyte scaling"],
    reportedRmse: 0.45,
    applicabilityDomain: "logP ∈ [-1, 5.5]; MW ∈ [120, 700]; fsp3 ∈ [0, 1]",
    reproducibilityHash: buildReproHash("lewis|log(CLint)=0.34*logP+0.27|+lovering_fsp3|+obach_bands"),
  },
  "lobell_ppb_2003@v1": {
    modelVersion: "lobell_ppb_2003@v1",
    displayName: "Lobell & Sivarajah PPB",
    riskTier: "high",
    validationStatus: "validated",
    source: "Lobell & Sivarajah, Mol. Diversity 7:69 (2003)",
    predicts: "Plasma free fraction fu (%)",
    governance: ["fu propagates to Lombardo Vd prediction and unbound-CL projection"],
    reportedRmse: 0.50,
    applicabilityDomain: "logP ∈ [-1, 6]; MW ∈ [120, 700]",
    reproducibilityHash: buildReproHash("lobell|logK=0.85*logP-0.55|acid+0.7|base-0.3|alb=600uM"),
  },
  "egan_2000@v1": {
    modelVersion: "egan_2000@v1",
    displayName: "Egan oral absorption (Egan-egg)",
    riskTier: "high",
    validationStatus: "validated",
    source: "Egan, Merz & Baldwin, J. Med. Chem. 43:3867 (2000)",
    predicts: "p(well-absorbed) ∈ [0, 1] + Fa estimate",
    governance: ["Drives Absorption dimension of the ADMET radar"],
    reportedRmse: 0.08,
    applicabilityDomain: "TPSA ∈ [0, 200]; logP ∈ [-2, 6.5]",
    reproducibilityHash: buildReproHash("egan|centre=(64.63,2.518)|sigma=(47.0,1.43)|p=sigmoid(d-1.5)"),
  },
  "lombardo_vd_2013@v1": {
    modelVersion: "lombardo_vd_2013@v1",
    displayName: "Lombardo Vss prediction",
    riskTier: "high",
    validationStatus: "validated",
    source: "Lombardo et al., J. Med. Chem. 56:3924 (2013)",
    predicts: "log Vss = 0.42·logP − 0.99·log(fu) − 0.31",
    governance: ["Drives Distribution dimension of the ADMET radar"],
    reportedRmse: 0.52,
    applicabilityDomain: "logP ∈ [-1, 6]; fu ∈ [0.001, 1]",
    reproducibilityHash: buildReproHash("lombardo|logVss=0.42*logP-0.99*log(fu)-0.31"),
  },

  // ── Moderate (directional advisory outputs) ────────────────────────────
  "bickerton_qed_2012@v1": {
    modelVersion: "bickerton_qed_2012@v1",
    displayName: "Bickerton QED",
    riskTier: "moderate",
    validationStatus: "validated",
    source: "Bickerton et al., Nat. Chem. 4:90 (2012)",
    predicts: "Quantitative Estimate of Drug-likeness (weighted, 0..1)",
    governance: ["Advisory — does not enter safety decisions directly"],
    applicabilityDomain: "Any drug-like small molecule",
    reproducibilityHash: buildReproHash("bickerton|8props|canonical_ADS_table|weights=[0.66,0.46,0.05,0.61,0.06,0.65,0.48,0.95]"),
  },
  "ertl_sa_complexity@v1": {
    modelVersion: "ertl_sa_complexity@v1",
    displayName: "Ertl SA score (complexity component)",
    riskTier: "moderate",
    validationStatus: "directional",
    source: "Ertl & Schuffenhauer, J. Cheminform. 1:8 (2009)",
    predicts: "Synthetic accessibility score (1=easy .. 10=hard)",
    governance: [
      "Advisory — fragment-frequency dictionary not bundled, applicability flagged",
      "Bias-low correction note surfaced in UI",
    ],
    applicabilityDomain: "5 ≤ heavyAtoms ≤ 80; numRings ≤ 8",
    reproducibilityHash: buildReproHash("ertl|complexity_only|fragmentScore=0"),
  },
  "smith_excretion_2010@v1": {
    modelVersion: "smith_excretion_2010@v1",
    displayName: "Smith excretion balance",
    riskTier: "moderate",
    validationStatus: "directional",
    source: "Smith, Di & Kerns, Nat. Rev. Drug Disc. 9:929 (2010)",
    predicts: "Excretion balance score (0..1)",
    governance: ["Advisory — combined with Vd and CL in projection"],
    applicabilityDomain: "MW ∈ [120, 700]; fu ∈ [0.001, 1]",
    reproducibilityHash: buildReproHash("smith|fu_gt_0.05_and_mw_lt_400=renal_favorable"),
  },
};

/** Lookup helper. Returns `null` if the model is not in the registry. */
export function lookupModel(modelVersion: string): RegisteredModel | null {
  return L1_MODEL_REGISTRY[modelVersion] ?? null;
}

/** Filter the registry by risk tier. */
export function modelsByRiskTier(tier: RiskTier): RegisteredModel[] {
  return Object.values(L1_MODEL_REGISTRY).filter(m => m.riskTier === tier);
}

/**
 * Verify a `modelVersion` declared in a ProvenanceRecord is in the registry
 * and matches the recorded reproducibility hash. A mismatch indicates the
 * model equation has been edited without bumping its version — an HAIOps
 * incident.
 */
export interface DriftCheckResult {
  ok: boolean;
  modelVersion: string;
  reason?: "unknown_model" | "hash_mismatch" | "research_only_in_critical_path";
  registered?: RegisteredModel;
  observedReproHash?: string;
}

export function checkModelDrift(
  modelVersion: string,
  inCriticalPath: boolean,
  observedReproHash?: string,
): DriftCheckResult {
  const registered = lookupModel(modelVersion);
  if (!registered) {
    return { ok: false, modelVersion, reason: "unknown_model" };
  }
  if (observedReproHash !== undefined && observedReproHash !== registered.reproducibilityHash) {
    return { ok: false, modelVersion, reason: "hash_mismatch", registered, observedReproHash };
  }
  if (inCriticalPath && registered.validationStatus === "research_only") {
    return { ok: false, modelVersion, reason: "research_only_in_critical_path", registered };
  }
  return { ok: true, modelVersion, registered };
}
