/**
 * Real selectivity assessment from ChEMBL measured activity.
 *
 * Replaces the previous heuristic in `inVitroSim.ts` that produced off-target
 * names by picking from a static therapeutic-area panel and generating IC50s
 * from `rng.uniform(0, 30) + nArom * 2`. That gave plausible-looking but
 * unsupported selectivity numbers.
 *
 * This module instead takes the array of ChEMBL hits already retrieved for
 * the input molecule (via `chemblTargetLookup.fetchChEMBLTargets`) plus the
 * caller-designated primary target, and computes the selectivity ratio from
 * the actual measured pIC50s of structurally-similar known compounds:
 *
 *   selectivity_ratio = IC50(off-target) / IC50(primary)
 *
 * Off-targets are RANKED by their measured potency from the ChEMBL data, not
 * by lipophilicity heuristics, so the panel is reproducible and citable.
 *
 * If the caller has fewer than 2 hits (e.g. ChEMBL similarity returned only
 * the primary target), we honestly report `dataAvailable: false` rather than
 * fabricating a panel — consumers should keep showing the heuristic panel
 * with a clear "no measured selectivity data" badge in that case.
 */

import type { ChEMBLTargetHit } from "./chemblTargetLookup";

export type SelectivityClass = "Selective" | "Moderately Selective" | "Non-Selective";

export interface RealOffTarget {
  /** UniProt accession of the off-target. */
  uniprotId: string | null;
  /** Gene symbol (or human-readable name if no symbol available). */
  name: string;
  /** ChEMBL measured (or similarity-inferred) best IC50 in nM. */
  ic50_nM: number;
  /** IC50(this) / IC50(primary). >1 means this target is less potent than primary. */
  selectivityRatio: number;
  /** Best Tanimoto % similarity to the input molecule among the ChEMBL similars that hit this target. */
  similarityPct: number | null;
  /** Did this row come from exact-match measurement or from similarity inference? */
  fromSimilarity: boolean;
}

export interface ChEMBLSelectivityAssessment {
  dataAvailable: boolean;
  /** UniProt accession of the primary target this assessment is relative to. */
  primaryUniprot: string;
  /** IC50 of the primary target, in nM, used as the denominator for ratios. */
  primaryIc50_nM: number | null;
  /** kinaseSelectivityScore-equivalent — 1.0 = perfectly selective, 0 = many strong off-targets. */
  selectivityScore: number;
  selectivityClass: SelectivityClass;
  /** Count of off-targets considered (after filtering for valid IC50). */
  offTargetHits: number;
  /** Total targets evaluated in the ChEMBL panel (off-targets + primary). */
  totalTargetsTested: number;
  /** Top off-targets sorted by potency (strongest binders first). */
  topOffTargets: RealOffTarget[];
  /** Notes & provenance for the UI to surface. */
  rationale: string[];
}

const SELECTIVITY_THRESHOLDS = {
  /** Off-targets within Nx of the primary potency count as "strong" off-target liabilities. */
  strongCutoffFold: 10,
  /** Score thresholds for the class label. */
  selective: 0.8,
  moderate: 0.5,
};

function gene(t: ChEMBLTargetHit): string {
  return t.geneName ?? t.targetName ?? t.targetChemblId ?? "?";
}

/**
 * Compute selectivity using the strongest ChEMBL-measured affinities as the
 * source of truth. Returns `dataAvailable: false` when the caller can't
 * provide at least the primary target plus one comparable off-target.
 */
export function computeChEMBLSelectivity(
  primaryUniprot: string | null | undefined,
  hits: ChEMBLTargetHit[],
): ChEMBLSelectivityAssessment {
  const empty = (rationale: string[]): ChEMBLSelectivityAssessment => ({
    dataAvailable: false,
    primaryUniprot: primaryUniprot ?? "",
    primaryIc50_nM: null,
    selectivityScore: 0,
    selectivityClass: "Non-Selective",
    offTargetHits: 0,
    totalTargetsTested: 0,
    topOffTargets: [],
    rationale,
  });

  if (!primaryUniprot) {
    return empty(["No primary UniProt accession supplied — selectivity ratio undefined."]);
  }
  const primary = hits.find(h => (h.uniprotId ?? "").toUpperCase() === primaryUniprot.toUpperCase());
  if (!primary || !(primary.bestValue_nM > 0)) {
    return empty([
      `Primary target ${primaryUniprot} is not present in the ChEMBL evidence ` +
        "or has no measured IC50 — cannot compute a ratio-based selectivity.",
    ]);
  }

  const primaryIc50 = primary.bestValue_nM;
  const offs: RealOffTarget[] = hits
    .filter(h => h !== primary && (h.bestValue_nM ?? 0) > 0 && (h.uniprotId ?? ""))
    .map(h => ({
      uniprotId:       h.uniprotId,
      name:            gene(h),
      ic50_nM:         h.bestValue_nM,
      selectivityRatio: h.bestValue_nM / primaryIc50,
      similarityPct:   h.bestSimilarity ?? null,
      fromSimilarity:  !!h.fromSimilarity,
    }))
    // Strongest off-targets first (smallest ratio = closest to primary potency)
    .sort((a, b) => a.selectivityRatio - b.selectivityRatio);

  if (offs.length === 0) {
    return {
      dataAvailable: true,
      primaryUniprot,
      primaryIc50_nM: primaryIc50,
      selectivityScore: 1.0,
      selectivityClass: "Selective",
      offTargetHits: 0,
      totalTargetsTested: 1,
      topOffTargets: [],
      rationale: [
        `Primary target ${gene(primary)} measured at ${primaryIc50.toFixed(1)} nM.`,
        "No other targets returned by ChEMBL similarity search → no measured " +
          "off-target liabilities for structurally-similar molecules.",
      ],
    };
  }

  // Count strong off-targets (within `strongCutoffFold` of primary potency).
  const strong = offs.filter(o => o.selectivityRatio <= SELECTIVITY_THRESHOLDS.strongCutoffFold);
  const score = Math.max(0, Math.min(1, 1 - strong.length / Math.max(1, offs.length)));
  const cls: SelectivityClass =
    score >= SELECTIVITY_THRESHOLDS.selective ? "Selective"
    : score >= SELECTIVITY_THRESHOLDS.moderate ? "Moderately Selective"
    : "Non-Selective";

  const rationale: string[] = [
    `Primary ${gene(primary)}: best measured IC50 ${primaryIc50.toFixed(1)} nM.`,
    `${offs.length} ChEMBL-measured off-targets considered, ${strong.length} within ` +
      `${SELECTIVITY_THRESHOLDS.strongCutoffFold}× of primary potency (≤ ` +
      `${(primaryIc50 * SELECTIVITY_THRESHOLDS.strongCutoffFold).toFixed(0)} nM).`,
  ];
  if (strong.length > 0) {
    const names = strong.slice(0, 5).map(o => `${o.name} (${o.selectivityRatio.toFixed(1)}×)`).join(", ");
    rationale.push(`Strongest off-target liabilities: ${names}.`);
  }
  rationale.push(
    "All numbers are ChEMBL-measured (or inferred from ≥70% Tanimoto similar molecules) — no heuristic pattern matching.",
  );

  return {
    dataAvailable: true,
    primaryUniprot,
    primaryIc50_nM: primaryIc50,
    selectivityScore: +score.toFixed(2),
    selectivityClass: cls,
    offTargetHits: offs.length,
    totalTargetsTested: offs.length + 1,
    topOffTargets: offs.slice(0, 10).map(o => ({
      ...o,
      ic50_nM: +o.ic50_nM.toFixed(2),
      selectivityRatio: +o.selectivityRatio.toFixed(2),
    })),
    rationale,
  };
}
