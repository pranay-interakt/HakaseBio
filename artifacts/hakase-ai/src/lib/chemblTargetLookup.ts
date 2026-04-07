export interface ChEMBLTargetHit {
  targetChemblId: string;
  targetName: string;
  targetType: string;
  uniprotId: string | null;
  bestActivityType: string;
  bestValue_nM: number;
  pChembl: number | null;
}

export interface ChEMBLTargetSearchResult {
  compoundChemblId: string;
  compoundName: string;
  targets: ChEMBLTargetHit[];
  status: "found" | "compound_not_found" | "no_targets" | "error";
}

export async function fetchChEMBLTargets(smiles: string): Promise<ChEMBLTargetSearchResult> {
  const empty: ChEMBLTargetSearchResult = {
    compoundChemblId: "",
    compoundName: "",
    targets: [],
    status: "compound_not_found",
  };

  if (!smiles) return empty;

  try {
    const res = await fetch(`/api/chembl/target-search?smiles=${encodeURIComponent(smiles)}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { ...empty, status: "error" };
    const data = await res.json();
    return {
      compoundChemblId: data.compoundChemblId ?? "",
      compoundName: data.compoundName ?? "",
      targets: (data.targets ?? []).map((t: any) => ({
        targetChemblId: t.targetChemblId ?? "",
        targetName: t.targetName ?? "",
        targetType: t.targetType ?? "",
        uniprotId: t.uniprotId ?? null,
        bestActivityType: t.bestActivityType ?? "",
        bestValue_nM: t.bestValue_nM ?? 0,
        pChembl: t.pChembl ?? null,
      })),
      status: data.status ?? "error",
    };
  } catch {
    return { ...empty, status: "error" };
  }
}
