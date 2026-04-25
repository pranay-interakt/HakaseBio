import type { SourceQuality } from "./sourceQuality";

export interface ChEMBLTargetHit {
  targetChemblId: string;
  targetName: string;
  targetType: string;
  uniprotId: string | null;
  geneName?: string | null;
  organism?: string | null;
  bestActivityType: string;
  bestValue_nM: number;
  pChembl: number | null;
  /** PDB structure IDs available for this UniProt accession (≤ 10 shown). */
  pdbIds?: string[];
  pdbCount?: number;
  /** Provenance: which similar molecule contributed the strongest hit. */
  bestSourceChemblId?: string;
  bestSourceName?: string;
  bestSimilarity?: number;
  /** True when this row came from similarity inference, not exact-match measured data. */
  fromSimilarity?: boolean;
  /** Source-quality metadata. Present when v2 endpoint succeeded. */
  quality?: SourceQuality;
}

export interface ChEMBLTargetSearchResult {
  compoundChemblId: string;
  compoundName: string;
  targets: ChEMBLTargetHit[];
  status: "found" | "compound_not_found" | "no_targets" | "error";
  /** Method used to obtain targets — "exact" (compound in ChEMBL) or "similarity" (inferred). */
  method?: "exact" | "similarity" | "none";
  /** Number of similar compounds queried when method === "similarity". */
  similarCount?: number;
  similarityThreshold?: number;
}

/**
 * Real target prediction:
 *   1. Exact-match search in ChEMBL (preferred — direct measured data)
 *   2. If no exact match (novel compound), similarity search ≥ 70%
 *   3. Aggregate measured targets from similar molecules, weighted by similarity × pIC50
 *   4. Enrich each predicted target with UniProt + PDB structures
 */
export async function fetchChEMBLTargets(smiles: string): Promise<ChEMBLTargetSearchResult> {
  const empty: ChEMBLTargetSearchResult = {
    compoundChemblId: "",
    compoundName: "",
    targets: [],
    status: "compound_not_found",
    method: "none",
  };
  if (!smiles) return empty;

  // Pass 1: exact-match
  try {
    const res = await fetch(`/api/chembl/target-search?smiles=${encodeURIComponent(smiles)}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const data = await res.json();
      const targets = (data.targets ?? []) as any[];
      if (targets.length > 0) {
        // Enrich exact-match targets with PDB IDs in parallel
        const enriched = await enrichWithPdb(targets.map((t: any) => ({
          targetChemblId: t.targetChemblId ?? "",
          targetName: t.targetName ?? "",
          targetType: t.targetType ?? "",
          uniprotId: t.uniprotId ?? null,
          bestActivityType: t.bestActivityType ?? "",
          bestValue_nM: t.bestValue_nM ?? 0,
          pChembl: t.pChembl ?? null,
          fromSimilarity: false,
        })));
        return {
          compoundChemblId: data.compoundChemblId ?? "",
          compoundName: data.compoundName ?? "",
          targets: enriched,
          status: "found",
          method: "exact",
        };
      }
    }
  } catch { /* fall through to similarity */ }

  // Pass 2: similarity search — v2 (full quality payload) with v1 fallback.
  const mapV2Target = (t: any): ChEMBLTargetHit => ({
    targetChemblId: t.targetChemblId ?? "",
    targetName: t.targetName ?? "",
    targetType: t.targetType ?? "",
    uniprotId: t.uniprotId ?? null,
    geneName: t.geneName ?? null,
    organism: t.organism ?? null,
    bestActivityType: t.bestActivityType ?? "",
    bestValue_nM: t.bestValue_nM ?? 0,
    pChembl: t.bestPChembl ?? null,
    pdbIds: t.pdbIds ?? [],
    pdbCount: t.pdbCount ?? 0,
    bestSourceChemblId: t.bestSourceChemblId ?? null,
    bestSourceName: t.bestSourceName ?? null,
    bestSimilarity: t.bestSimilarity ?? null,
    fromSimilarity: true,
    quality: t.quality ?? undefined,
  });

  // Try v2 first
  try {
    const res = await fetch(`/api/chembl/similar-targets/v2?smiles=${encodeURIComponent(smiles)}&threshold=70&limit=25`, {
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      const data = await res.json();
      const targets = ((data.targets ?? []) as any[]).map(mapV2Target);
      if (targets.length > 0 || (data.status ?? "") === "no_targets" || (data.status ?? "") === "no_similar") {
        return {
          compoundChemblId: "",
          compoundName: "",
          targets,
          status: targets.length > 0 ? "found" : "no_targets",
          method: "similarity",
          similarCount: data.similarCount ?? 0,
          similarityThreshold: data.threshold ?? 70,
        };
      }
    }
  } catch { /* fall through to v1 */ }

  // Fallback: v1 (no quality payload)
  try {
    const res = await fetch(`/api/chembl/similar-targets?smiles=${encodeURIComponent(smiles)}&threshold=70&limit=25`, {
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return { ...empty, status: "error", method: "none" };
    const data = await res.json();
    const targets = ((data.targets ?? []) as any[]).map(mapV2Target);
    return {
      compoundChemblId: "",
      compoundName: "",
      targets,
      status: targets.length > 0 ? "found" : "no_targets",
      method: "similarity",
      similarCount: data.similarCount ?? 0,
      similarityThreshold: data.threshold ?? 70,
    };
  } catch {
    return { ...empty, status: "error", method: "none" };
  }
}

/** Enrich exact-match targets with PDB IDs (parallel UniProt fetches). */
async function enrichWithPdb(targets: ChEMBLTargetHit[]): Promise<ChEMBLTargetHit[]> {
  const accessions = Array.from(new Set(targets.map(t => t.uniprotId).filter((x): x is string => !!x)));
  if (accessions.length === 0) return targets;
  const pdbMap = new Map<string, { ids: string[]; count: number }>();
  await Promise.allSettled(accessions.map(async (acc) => {
    try {
      const r = await fetch(`/api/pdb/by-uniprot?accession=${encodeURIComponent(acc)}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const d = await r.json();
      pdbMap.set(acc, { ids: (d.pdbIds ?? []).slice(0, 10), count: d.pdbCount ?? 0 });
    } catch { /* skip */ }
  }));
  return targets.map(t => {
    const pdb = t.uniprotId ? pdbMap.get(t.uniprotId) : null;
    return { ...t, pdbIds: pdb?.ids ?? [], pdbCount: pdb?.count ?? 0 };
  });
}
