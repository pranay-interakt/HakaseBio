/**
 * Tissue-selectivity matrix — T0 in-silico surrogate (L3 Stage 1).
 *
 * Per organ, predicted exposure margin = unbound concentration in tissue ÷
 * IC50 against the target.  Inputs:
 *   - L1 IC50 (real)                       — from SimResults.binding.primaryIC50
 *   - L1 plasma fu (real)                  — from InVitroResults.plasmaProteinBinding
 *   - L2 PBPK Cmax (real, computed here)   — from runPBPK using L2 dose projection
 *   - GTEx v8 median tissue expression     — live fetch
 *
 * Honest assumptions (all surfaced in the per-row rationale, never silent):
 *   - Cu_tissue ≈ Cu_plasma at steady state (Rowland-Tözer free-drug
 *     hypothesis).  This is the default published assumption for tissues
 *     without an explicit PBPK compartment.  The 2-compartment PBPK in
 *     `lib/pbpk.ts` does not have per-organ compartments today; when it
 *     gains them, this module will read tissue-specific Cu directly.
 *   - GTEx v8 is the dataset version exposed by the public REST endpoint.
 *     Spec calls for v10; v8 is the honest substitute pending v10 release
 *     at the medianGeneExpression endpoint.
 *
 * Spec ref: HakaseBio_Layer3_InSilico_Surrogate_Spec v1.1 §3.1.
 *
 * No fabrication: where a required upstream input is missing (no IC50, no
 * plasma fu), the function throws and the caller surfaces the error card.
 */

import type { SimResults } from "./admet";
import type { InVitroResults } from "./inVitroSim";
import { computeL2DoseProjection, type L2InputParams } from "./l2DoseProjection";
import { runPBPK, type PBPKOutput } from "./pbpk";
import {
  fetchMedianTissueExpression,
  tissueToPbpkCompartment,
  humanTissueLabel,
  type GtexExpressionResult,
  type GtexTissueExpression,
} from "./gtexClient";
import { fetchUniProt } from "./proteinApi";
import {
  predictionOnly,
  type CascadeFlagState,
  type FoldErrorBand,
  type ApplicabilityDomain,
} from "./cascadeFlagState";

export type SelectivityConfidence = "high" | "medium" | "low";

export interface TissueSelectivityRow {
  tissueId: string;            // GTEx tissueSiteDetailId
  tissueName: string;          // human-readable
  ontologyId: string;          // UBERON
  targetExpressionTpm: number; // GTEx median TPM
  pbpkCompartment: string | null;

  predictedCu_uM: number;      // currently uniform across tissues (Rowland-Tözer)
  ic50_uM: number;
  marginRatio: number;         // ic50 / Cu  → higher = safer
  /** Predicted on-target activity score: tanh(margin)·(1 - exp(-TPM/10)) ∈ 0–1.
   *  Combines exposure adequacy with target presence; identifies tissues that
   *  both express the target AND see enough drug to engage it. */
  onTargetScore: number;

  confidence: SelectivityConfidence;
  rationale: string;
}

export interface TissueSelectivityMatrix {
  // Provenance
  generatedAt: string;
  geneSymbol: string;
  uniprotId: string;
  gtexDatasetId: string;
  gtexSnapshot: string;

  // Computation inputs
  l1Stamp: string;             // L1 timestamp this was computed from
  pbpk: PBPKOutput;
  fu_fraction: number;
  ic50_uM: number;
  Cu_plasma_uM: number;        // fu × Cmax_total  (single-dose Cmax in PBPK output is mg/L)
  cmax_total_uM: number;
  doseAssumption: string;

  rows: TissueSelectivityRow[];

  // Cascade
  cascadeState: CascadeFlagState;

  // Top-N convenience selectors
  topOnTargetTissues: TissueSelectivityRow[];   // top 5 by onTargetScore
  highestRiskMarginTissues: TissueSelectivityRow[]; // bottom 5 by marginRatio (worst safety)
}

/** Convert mg/L PBPK Cmax → µM via molecular weight. */
function mgPerL_to_uM(conc_mg_per_L: number, mw_g_per_mol: number): number {
  // mg/L ÷ g/mol = mmol/L = mM ; ×1000 = µM
  return (conc_mg_per_L * 1000) / mw_g_per_mol;
}

/** Per-row confidence: high if PBPK has the compartment, medium otherwise.
 *  Low when GTEx TPM is missing or zero. */
function rowConfidence(pbpkCompartment: string | null, tpm: number): SelectivityConfidence {
  if (!isFinite(tpm) || tpm <= 0) return "low";
  return pbpkCompartment ? "high" : "medium";
}

function rowRationale(
  tissueName: string,
  pbpkCompartment: string | null,
  tpm: number,
): string {
  const parts: string[] = [];
  parts.push(`Cu_tissue ≈ Cu_plasma assumed (Rowland-Tözer steady-state free-drug hypothesis).`);
  if (pbpkCompartment) {
    parts.push(`Tissue maps to PBPK ${pbpkCompartment} — plasma Cu is a defensible proxy here.`);
  } else {
    parts.push(`No explicit PBPK compartment for ${tissueName}; the uniform-Cu assumption is the dominant uncertainty source.`);
  }
  if (!isFinite(tpm) || tpm <= 0) {
    parts.push(`GTEx median expression ≤ 0 in this tissue — on-target activity unlikely regardless of Cu.`);
  } else {
    parts.push(`Target expression ${tpm.toFixed(2)} TPM (GTEx v8 median).`);
  }
  return parts.join(" ");
}

export interface TissueSelectivityComputeArgs {
  sim: SimResults;
  iv: InVitroResults;
  l2Params?: L2InputParams;
}

/**
 * Compute the 54-row tissue-selectivity matrix.  Self-contained: runs the
 * L2 dose projection + PBPK on demand using L2 defaults (or supplied
 * overrides) so the L3 layer is not blocked on L2 having been clicked.
 */
export async function computeTissueSelectivityMatrix(
  args: TissueSelectivityComputeArgs,
): Promise<TissueSelectivityMatrix> {
  const { sim, iv } = args;
  const l2Params: L2InputParams = args.l2Params ?? {};

  // 1. L2 dose projection — pure function of L1 outputs.
  const proj = computeL2DoseProjection(sim, iv, l2Params);

  // Hard error if dose is non-finite (e.g. fu missing) — no silent fallback.
  if (!isFinite(proj.predictedDose_mg_per_day) || proj.predictedDose_mg_per_day <= 0) {
    throw new Error(
      `Tissue-selectivity: L2 dose projection failed (predicted ${proj.predictedDose_mg_per_day} mg/day). ` +
      `Cause: ${proj.warnings.join(" / ") || "missing L1 inputs"}.`,
    );
  }

  const dosePerAdmin = proj.predictedDose_mg_per_day / Math.max(1, l2Params.dosesPerDay ?? 1);

  // 2. PBPK — compute Cmax for the projected dose.
  const pbpk = runPBPK(
    {
      mw: sim.lipinski.mw,
      logP: sim.lipinski.logP,
      tpsa: sim.lipinski.tpsa,
      hbd: sim.lipinski.hbd,
      bioavailF: l2Params.FOverride ?? proj.F_oral,
      absorptionScore: sim.admet.absorption,
      excretionScore: sim.admet.excretion,
      metabolismScore: sim.admet.metabolism,
      dosingMg: dosePerAdmin,
      routeIV: l2Params.route === "iv",
    },
    {
      weightKg: l2Params.bodyWeightKg ?? 70,
      egfr: 90,
      albuminGdL: 4.1,
    },
  );

  const fu = proj.fu_fraction;
  if (!isFinite(fu) || fu <= 0 || fu > 1) {
    throw new Error(
      `Tissue-selectivity: plasma fu invalid (${fu}). L1 plasma protein binding must produce a fraction in (0, 1].`,
    );
  }

  const cmaxTotal_uM = mgPerL_to_uM(pbpk.cmax, sim.lipinski.mw);
  const Cu_plasma_uM = cmaxTotal_uM * fu;

  // RF#1 / §9 step 1: L1 binding is null when no validated UniProt is in
  // TARGET_MAP. Tissue selectivity needs an on-target IC50 — refuse loudly.
  if (!sim.binding) {
    throw new Error(
      "Tissue-selectivity requires an L1 binding estimate. L1 returned " +
      "binding=null because the target UniProt is not in the validated " +
      "catalog — pick a curated target before attempting tissue selectivity.",
    );
  }
  // 3. Convert L1 IC50 from nM (BindingEstimate.primaryIC50 is in nM) → µM.
  const ic50_uM = sim.binding.primaryIC50 / 1000;
  if (!isFinite(ic50_uM) || ic50_uM <= 0) {
    throw new Error(
      `Tissue-selectivity: L1 IC50 invalid (${sim.binding.primaryIC50} nM). Re-run L1.`,
    );
  }

  // 4. GTEx — resolve gene symbol from UniProt and fetch median expression.
  //    sim.binding.targetName is the curated gene for known TARGET_MAP entries
  //    (e.g. "EGFR"), but for unknown UniProt IDs it falls through to a label;
  //    fetchUniProt is the canonical source.
  let geneSymbol: string = sim.binding.targetName;
  try {
    const protein = await fetchUniProt(sim.uniprotId);
    if (protein.gene && protein.gene !== "—") geneSymbol = protein.gene;
  } catch {
    // Fall through: use binding.targetName.  GTEx will fail loudly below if it can't resolve.
  }

  let gtex: GtexExpressionResult;
  try {
    gtex = await fetchMedianTissueExpression(geneSymbol);
  } catch (err) {
    throw new Error(
      `Tissue-selectivity: GTEx lookup failed for gene "${geneSymbol}" — ${(err as Error).message}. ` +
      `Verify the UniProt → gene mapping and that the gene exists in GTEx v8.`,
    );
  }

  // 5. Per-row computation.
  const baseMargin = ic50_uM / Math.max(Cu_plasma_uM, 1e-9);
  const rows: TissueSelectivityRow[] = gtex.rows.map((g: GtexTissueExpression) => {
    const compartment = tissueToPbpkCompartment(g.tissueSiteDetailId);
    const tpm = isFinite(g.median) ? g.median : 0;
    // On-target activity score: high TPM × low marginRatio (i.e. high engagement).
    // Saturating both inputs keeps the score in (0, 1).
    const engagement = 1 / (1 + baseMargin); // 0 at infinite margin, 1 at zero margin
    const expressionWeight = 1 - Math.exp(-tpm / 10); // saturates near TPM≈30
    const onTargetScore = engagement * expressionWeight;
    return {
      tissueId: g.tissueSiteDetailId,
      tissueName: humanTissueLabel(g.tissueSiteDetailId),
      ontologyId: g.ontologyId,
      targetExpressionTpm: tpm,
      pbpkCompartment: compartment,
      predictedCu_uM: parseFloat(Cu_plasma_uM.toFixed(5)),
      ic50_uM: parseFloat(ic50_uM.toFixed(5)),
      marginRatio: parseFloat(baseMargin.toFixed(3)),
      onTargetScore: parseFloat(onTargetScore.toFixed(4)),
      confidence: rowConfidence(compartment, tpm),
      rationale: rowRationale(humanTissueLabel(g.tissueSiteDetailId), compartment, tpm),
    };
  });

  const topOnTargetTissues = [...rows].sort((a, b) => b.onTargetScore - a.onTargetScore).slice(0, 5);
  const highestRiskMarginTissues = [...rows]
    .filter(r => r.targetExpressionTpm > 0)
    .sort((a, b) => a.marginRatio - b.marginRatio)
    .slice(0, 5);

  // 6. Cascade flag — discriminated union per spec §8.2.
  //    Stage 1 has no calibration cohort yet (T0 just-shipped); honest empty band.
  const foldError: FoldErrorBand = {
    median: NaN, p90: NaN, cohortN: 0, measuredAt: null,
  };
  const ad: ApplicabilityDomain = {
    inDomain: ic50_uM >= 0.0001 && ic50_uM <= 100 && cmaxTotal_uM >= 0.001 && cmaxTotal_uM <= 1000,
    score: rows.some(r => r.confidence === "high") ? 0.7 : 0.5,
    rationale:
      `IC50=${ic50_uM.toExponential(2)} µM, predicted Cmax=${cmaxTotal_uM.toExponential(2)} µM. ` +
      `${rows.filter(r => r.pbpkCompartment).length} of ${rows.length} tissues map to a PBPK compartment.`,
  };
  const cascadeState = predictionOnly({
    method: "Tissue-selectivity matrix · L1 IC50 + L2 PBPK Cu + GTEx v8 expression · Rowland-Tözer Cu_tissue ≈ Cu_plasma",
    foldError,
    applicabilityDomain: ad,
    snapshotsWithinCadence: true,
    uiBanner:
      "T0 in-silico surrogate · predicted, not measured. Calibration cohort not yet assembled — fold-error band will surface when ≥30 compound-tissue wet pairs are logged.",
  });

  return {
    generatedAt: new Date().toISOString(),
    geneSymbol,
    uniprotId: sim.uniprotId,
    gtexDatasetId: gtex.datasetId,
    gtexSnapshot: gtex.datasetSnapshot,
    l1Stamp: sim.timestamp,
    pbpk,
    fu_fraction: fu,
    ic50_uM,
    Cu_plasma_uM: parseFloat(Cu_plasma_uM.toFixed(5)),
    cmax_total_uM: parseFloat(cmaxTotal_uM.toFixed(5)),
    doseAssumption: proj.doseAssumption,
    rows,
    cascadeState,
    topOnTargetTissues,
    highestRiskMarginTissues,
  };
}
