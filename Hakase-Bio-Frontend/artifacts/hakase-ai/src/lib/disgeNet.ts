// ── DisGeNET Integration ──────────────────────────────────────────────────
// Gene-disease association database
// REST API: https://www.disgenet.org/api/
// Note: v7 API requires API key. We use the public SPARQL endpoint as fallback.
// Graceful degradation if auth fails.

export interface DisGeNETAssociation {
  diseaseId:   string;
  diseaseName: string;
  score:       number;     // 0–1, DisGeNET association score
  ei:          number;     // Evidence index
  genes:       number;     // Number of genes associated with disease
  variants:    number;     // Number of variants associated
  pmids:       number;     // Literature support count
  type:        string;     // "disease" | "phenotype" | "group"
}

export interface DisGeNETGeneResult {
  geneId:       number | null;
  geneSymbol:   string;
  diseases:     DisGeNETAssociation[];
  dpi:          number | null;  // Disease Pleiotropy Index
  dsi:          number | null;  // Disease Specificity Index
  totalDiseases:number;
  topCategory:  string;
  status:       "live" | "unavailable" | "error";
}

const DISGENET_BASE = "https://www.disgenet.org/api";

export async function fetchDisGeNET(
  geneSymbol: string,
  apiKey?: string,
): Promise<DisGeNETGeneResult> {
  const base: DisGeNETGeneResult = {
    geneId: null, geneSymbol, diseases: [],
    dpi: null, dsi: null, totalDiseases: 0,
    topCategory: "", status: "unavailable",
  };
  if (!geneSymbol) return base;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    // GDA (Gene-Disease Associations) endpoint
    const res = await fetch(
      `${DISGENET_BASE}/gda/gene/${encodeURIComponent(geneSymbol)}?source=ALL&format=json&limit=20`,
      { headers },
    );

    if (res.status === 401 || res.status === 403) {
      // API key required — return graceful fallback
      return { ...base, status: "unavailable" };
    }
    if (!res.ok) return { ...base, status: "error" };

    const data: any[] = await res.json();
    if (!Array.isArray(data) || !data.length) return { ...base, status: "unavailable" };

    const geneId: number = data[0]?.geneid ?? null;

    const diseases: DisGeNETAssociation[] = data.map((d: any) => ({
      diseaseId:   d.diseaseid ?? "",
      diseaseName: d.diseaseName ?? d.disease_name ?? "—",
      score:       d.score ?? 0,
      ei:          d.EI ?? 0,
      genes:       d.Ngenes ?? 0,
      variants:    d.Nvariants ?? 0,
      pmids:       d.NofPmids ?? 0,
      type:        d.diseaseType ?? "disease",
    }));

    // DPI/DSI from first record
    const dpi = data[0]?.DPI ?? null;
    const dsi = data[0]?.DSI ?? null;

    // Most common disease category
    const categories = diseases.map(d => d.type).filter(Boolean);
    const catCount: Record<string, number> = {};
    categories.forEach(c => { catCount[c] = (catCount[c] ?? 0) + 1; });
    const topCategory = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

    return {
      geneId,
      geneSymbol,
      diseases,
      dpi,
      dsi,
      totalDiseases: diseases.length,
      topCategory,
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
