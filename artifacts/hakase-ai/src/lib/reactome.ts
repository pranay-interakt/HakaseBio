// ── Reactome Pathway Database ─────────────────────────────────────────────
// Reactome ContentService REST API
// https://reactome.org/ContentService/
// Free, no auth, CORS-enabled

export interface ReactomePathway {
  stId:        string;   // Stable identifier e.g. R-HSA-1640170
  displayName: string;
  species:     string;
  isInferred:  boolean;
  schemaClass: string;
}

export interface ReactomeResult {
  uniprotId:    string;
  pathways:     ReactomePathway[];
  topLevelPaths:string[];      // Biological process categories
  totalPathways:number;
  complexCount: number;        // Number of complexes this protein is part of
  reactionCount:number;
  status:       "live" | "unavailable" | "error";
}

const REACTOME_BASE = "https://reactome.org/ContentService";

export async function fetchReactomePathways(uniprotId: string): Promise<ReactomeResult> {
  const base: ReactomeResult = {
    uniprotId, pathways: [], topLevelPaths: [],
    totalPathways: 0, complexCount: 0, reactionCount: 0, status: "unavailable",
  };
  if (!uniprotId) return base;

  try {
    // Get pathways containing this protein
    const res = await fetch(
      `${REACTOME_BASE}/data/mapping/UniProt/${uniprotId.toUpperCase()}/pathways?species=Homo+sapiens`,
    );
    if (!res.ok) return { ...base, status: "error" };
    const data: any[] = await res.json();
    if (!Array.isArray(data) || !data.length) return { ...base, status: "unavailable" };

    const pathways: ReactomePathway[] = data.slice(0, 20).map((p: any) => ({
      stId:        p.stId ?? "",
      displayName: p.displayName ?? "—",
      species:     p.speciesName ?? "Homo sapiens",
      isInferred:  p.isInferred ?? false,
      schemaClass: p.schemaClass ?? "Pathway",
    }));

    // Extract top-level biological categories from displayName patterns
    const topLevelSet = new Set<string>();
    pathways.forEach(p => {
      const name = p.displayName;
      if (name.includes("Signal")) topLevelSet.add("Signal Transduction");
      else if (name.includes("Metabol")) topLevelSet.add("Metabolism");
      else if (name.includes("Cell Cycle") || name.includes("Division")) topLevelSet.add("Cell Cycle");
      else if (name.includes("Immune") || name.includes("Innate") || name.includes("Adaptive")) topLevelSet.add("Immune System");
      else if (name.includes("Gene Expression") || name.includes("Transcri")) topLevelSet.add("Gene Expression");
      else if (name.includes("Apoptosis") || name.includes("Death")) topLevelSet.add("Apoptosis");
      else if (name.includes("DNA") || name.includes("Repair")) topLevelSet.add("DNA Repair");
      else if (name.includes("Transport")) topLevelSet.add("Transport");
    });

    // Get reaction count
    let reactionCount = 0;
    try {
      const reactRes = await fetch(
        `${REACTOME_BASE}/data/mapping/UniProt/${uniprotId.toUpperCase()}/reactions?species=Homo+sapiens`,
      );
      if (reactRes.ok) {
        const reactions: any[] = await reactRes.json();
        reactionCount = reactions.length;
      }
    } catch { /* ignore */ }

    return {
      uniprotId,
      pathways,
      topLevelPaths: Array.from(topLevelSet).slice(0, 6),
      totalPathways: data.length,
      complexCount: 0,
      reactionCount,
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
