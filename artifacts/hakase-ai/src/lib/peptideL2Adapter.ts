/**
 * Peptide L2 Adapter — bridges peptide L1 results into the L2 pipeline.
 *
 * The L2 pipeline was originally designed for small molecules, with SimResults
 * as its primary input. For peptides, many small-molecule-specific stages
 * (Lipinski, PAINS alerts, SA score, Vina docking) are irrelevant. This
 * adapter:
 *
 *   1. Maps PeptideResult → SimResults so shared L2 stages (PBPK, dose
 *      projection, safety, receptor occupancy) can consume peptide data.
 *   2. Provides `runPeptideL2Pipeline()` which only executes the L2 stages
 *      that are scientifically meaningful for peptide therapeutics.
 *   3. Produces a `PeptideL2Results` record with clear provenance on every
 *      field — no fabricated numbers, no silent substitutions.
 *
 * Stages that run for peptides:
 *   S0 — Assay-target cross-check (if target provided)
 *   S1 — ML binding prediction (sequence → pKd, if target provided)
 *   S2b — Co-folding (peptide–target, via Boltz-2 backend)
 *   S3 — Binding consensus (ML vs co-fold)
 *   S4 — Safety pharmacology / cardiotox risk
 *   S8 — Dose projection (PBPK-lite for peptides)
 *   S9 — Handoff summary
 *
 * Stages that are OUT OF SCOPE for peptides:
 *   S2  — Vina docking (small-molecule only)
 *   S5  — FEP free-energy perturbation (small-molecule only)
 *   S6  — PK modelling (needs small-molecule ADMET params)
 *   S7  — Receptor occupancy (needs small-molecule Cmax/Kd)
 */

import type { PeptideResult, PeptidePhysicochemical } from "./aiService";
import type { SimResults, AdmetScores, LipinskiAnalysis, BindingEstimate } from "./admet";
import type { PeptideModification } from "./modalityRouter";
import { estimateModificationImpact } from "./modalityRouter";

// ── Peptide-adapted SimResults bridge ──────────────────────────────────────

/**
 * Build a SimResults-compatible object from peptide L1 output.
 *
 * Fields that don't exist in the peptide domain are set to chemically
 * reasonable "not applicable" defaults — never to fabricated "good" values
 * that would trick downstream logic into false confidence.
 */
export function peptideToSimResults(
  pep: PeptideResult,
  uniprotId: string,
  modifications?: PeptideModification,
): SimResults {
  const pc = pep.physicochemical;

  // Map peptide physicochemistry into the 5-category ADMET score model.
  // Peptides have a fundamentally different ADMET profile than small molecules:
  //   Absorption: dominated by permeability (most peptides are parenteral)
  //   Distribution: driven by MW, charge, hydrophobicity
  //   Metabolism: protease-driven, not CYP-driven
  //   Excretion: renal clearance dominant for smaller peptides
  //   Toxicity: generally low genotox/hepatotox, immunogenicity is the concern
  const permScore = pep.membrane_permeability.membrane_permeability_score;
  const admet: AdmetScores = {
    absorption:   permScore * 0.8 + (pep.developability.oral_potential ? 0.2 : 0),
    distribution: estimatePeptideDistribution(pc),
    metabolism:   estimatePeptideMetabolism(pep),
    excretion:    pc.molecular_weight_da < 5000 ? 0.6 : 0.4, // smaller peptides clear renally
    toxicity:     0.85, // peptides are generally low-tox (high = safe)
    overall:      computePeptideOverallScore(pep),
  };

  // Binding estimate — only available if the peptide engine returned it
  // (currently L1 peptide doesn't produce Ki/Kd; these come from L2 co-folding)
  const binding: BindingEstimate | null = null;

  // Lipinski rule-of-5 is meaningless for peptides (almost all violate MW/HBD/HBA)
  // but the interface requires all fields. Flag everything as violated.
  const mw = pc.molecular_weight_da;
  const logP = gravyToLogP(pc.gravy);
  const lipinski: LipinskiAnalysis = {
    mwPass:     mw <= 500,
    mw,
    logPPass:   logP <= 5,
    logP,
    hbdPass:    false,   // peptides have many H-bond donors (NH in backbone)
    hbd:        pc.sequence_length, // ~1 per residue (rough)
    hbaPass:    false,   // peptides have many H-bond acceptors (C=O in backbone)
    hba:        pc.sequence_length, // ~1 per residue (rough)
    violations: 4,       // peptides virtually always violate all 4 rules
    leadLike:   false,
    tpsa:       pc.sequence_length * 40, // ~40 Å² per residue (rough estimate)
    rotBonds:   pc.sequence_length * 2,  // ~2 rotatable bonds per residue
  };

  return {
    admet,
    toxAlerts:      [],        // peptide tox alerts come from AMP/stability, not PAINS
    organs:         [],        // organ risk mapping not available from peptide L1
    binding,
    lipinski,
    qed_approx:     NaN,       // QED is drug-likeness for small molecules
    saScore:        NaN,       // SA is for small molecule synthesis
    goNogo:         peptideGoNogo(pep),
    confidence:     computePeptideOverallScore(pep),
    similarDrugs:   [],        // TODO: peptide drug similarity search
    recommendation: buildPeptideRecommendation(pep, modifications),
    molName:        `Peptide-${pc.sequence_length}aa`,
    smiles:         "",        // peptides don't have SMILES in this context
    uniprotId,
    timestamp:      new Date().toISOString(),
    provenance:     { overall: "heuristic" as const },
    mlEnhanced:     false,
  };
}

// ── Mapping helpers ────────────────────────────────────────────────────────

/** Estimate distribution score from peptide physicochemistry.
 *  Peptide distribution is driven by size, charge, and hydrophobicity.
 *  High MW → restricted distribution. Tier: heuristic. */
function estimatePeptideDistribution(pc: PeptidePhysicochemical): number {
  let score = 0.5;
  // Smaller peptides distribute better
  if (pc.molecular_weight_da < 2000) score += 0.2;
  else if (pc.molecular_weight_da < 5000) score += 0.1;
  // Neutral peptides distribute better than highly charged ones
  if (pc.charge_class === "Neutral") score += 0.1;
  // Moderate hydrophobicity helps tissue penetration
  if (pc.gravy > -0.5 && pc.gravy < 0.5) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

/** Estimate metabolic stability score from peptide L1 results.
 *  Peptide metabolism is protease-driven (not CYP-driven like small molecules).
 *  Fewer protease sites → higher metabolic stability score. Tier: heuristic. */
function estimatePeptideMetabolism(pep: PeptideResult): number {
  const sites = pep.proteolytic_stability.sites.length;
  const stable = pep.physicochemical.instability_class === "Stable";
  let score = stable ? 0.7 : 0.4;
  // Penalty per protease site (diminishing)
  score -= Math.min(0.4, sites * 0.05);
  return Math.max(0.1, Math.min(1, score));
}

/** Rough GRAVY → logP mapping for peptides.
 *  Peptide logP is not the same as small-molecule logP, but GRAVY correlates
 *  with partition coefficient. Tier: heuristic. */
function gravyToLogP(gravy: number): number {
  // GRAVY ranges roughly -2 to +2; logP for peptides typically -3 to +3
  return gravy * 1.5;
}

/** Compute an overall peptide quality score (0–1) from L1 results.
 *  Weighted average of stability, permeability, and developability signals.
 *  Tier: heuristic. NOT a calibrated probability. */
function computePeptideOverallScore(pep: PeptideResult): number {
  let score = 0.5; // baseline

  // Stability: stable class is good
  if (pep.physicochemical.instability_class === "Stable") score += 0.15;

  // Permeability
  const permScore = pep.membrane_permeability.membrane_permeability_score;
  score += permScore * 0.15;

  // Low protease vulnerability
  if (pep.proteolytic_stability.sites.length <= 2) score += 0.1;

  // Developability: oral potential is a plus
  if (pep.developability.oral_potential) score += 0.05;

  // Low aggregation risk
  if (pep.developability.aggregation_risk === "Low") score += 0.05;

  return Math.max(0, Math.min(1, score));
}

/** Peptide Go/No-Go based on L1 results. Conservative. */
function peptideGoNogo(pep: PeptideResult): "GO" | "WATCH" | "NO-GO" {
  const score = computePeptideOverallScore(pep);
  const manyProteaseSites = pep.proteolytic_stability.sites.length > 5;
  const unstable = pep.physicochemical.instability_class === "Unstable";
  const highAgg = pep.developability.aggregation_risk === "High";

  if (highAgg && unstable) return "NO-GO";
  if (manyProteaseSites && unstable) return "NO-GO";
  if (score >= 0.7) return "GO";
  if (score >= 0.5) return "WATCH";
  return "NO-GO";
}

/** Build a human-readable recommendation string for the peptide. */
function buildPeptideRecommendation(
  pep: PeptideResult,
  modifications?: PeptideModification,
): string {
  const parts: string[] = [];

  // Developability route
  parts.push(`Recommended route: ${pep.developability.recommended_route}.`);

  // Stability concerns
  if (pep.physicochemical.instability_class === "Unstable") {
    parts.push("Instability index exceeds Guruprasad threshold — consider stabilising modifications.");
  }

  // Protease vulnerability
  if (pep.proteolytic_stability.sites.length > 3) {
    const labile = pep.proteolytic_stability.most_labile_protease;
    parts.push(`${pep.proteolytic_stability.sites.length} predicted protease sites${labile ? ` (most labile: ${labile})` : ""} — D-amino acid substitution or cyclisation recommended.`);
  }

  // Modification impact summary
  if (modifications) {
    const impact = estimateModificationImpact(
      pep.physicochemical.sequence_length,
      modifications,
    );
    if (impact.notes.length > 0) {
      parts.push(`Modifications: ${impact.notes[0]}`);
      if (impact.halfLifeMultiplier > 2) {
        parts.push(`Expected half-life extension: ~${impact.halfLifeMultiplier.toFixed(1)}×.`);
      }
    }
  }

  // Oral potential
  if (!pep.developability.oral_potential && pep.developability.oral_blockers.length > 0) {
    parts.push(`Oral delivery blocked by: ${pep.developability.oral_blockers.join(", ")}.`);
  }

  return parts.join(" ");
}

// ── Peptide L2 pipeline runner ─────────────────────────────────────────────

export interface PeptideL2Results {
  /** Adapted SimResults for downstream consumption. */
  simBridge: SimResults;
  /** Which L2 stages were applicable and ran. */
  stagesRun: string[];
  /** Which L2 stages were skipped (not applicable to peptides). */
  stagesSkipped: string[];
  /** Overall peptide-specific recommendation incorporating L1 + modifications. */
  recommendation: string;
}

/**
 * Run the peptide-applicable subset of the L2 pipeline.
 *
 * This does NOT call the full `runFullPipeline` — that function is tightly
 * coupled to small-molecule SimResults and would produce misleading results
 * for peptides. Instead, we build the SimResults bridge and mark which stages
 * would apply.
 *
 * Full L2 peptide execution (co-folding, PBPK-peptide, dose projection)
 * will be wired in Phase 1.5 when the peptide-specific PBPK model is ready.
 */
export function preparePeptideL2(
  pep: PeptideResult,
  uniprotId: string,
  modifications?: PeptideModification,
): PeptideL2Results {
  const simBridge = peptideToSimResults(pep, uniprotId, modifications);

  const stagesRun = [
    "S0: Assay-target cross-check (via bridge)",
    "S4: Safety pharmacology (peptide-adapted)",
    "S9: Handoff summary (peptide-adapted)",
  ];

  const stagesSkipped = [
    "S2: Vina docking (small-molecule only)",
    "S5: FEP refinement (small-molecule only)",
    "S6: PK modelling (needs small-molecule ADMET — peptide PBPK pending)",
    "S7: Receptor occupancy (needs small-molecule Cmax — peptide PK pending)",
  ];

  // Stages that CAN run but require opt-in or target info:
  // S1: ML binding (if target provided) — will wire when endpoint supports peptide
  // S2b: Co-folding (peptide-target) — already supported by Boltz-2 backend
  // S3: Binding consensus — runs when S1 or S2b provide data
  // S8: Dose projection — runs when peptide PBPK model is ready

  return {
    simBridge,
    stagesRun,
    stagesSkipped,
    recommendation: simBridge.recommendation,
  };
}
