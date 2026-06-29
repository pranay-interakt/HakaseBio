// ── KEGG (Kyoto Encyclopedia of Genes and Genomes) ────────────────────────
// KEGG REST API — pathways, disease, drug targets
// https://rest.kegg.jp/
// Free for academic use, no auth, CORS-enabled

export interface KEGGPathway {
  id:       string;   // e.g. "hsa04010"
  name:     string;
  category: string;
}

export interface KEGGDrug {
  id:       string;   // e.g. "D00001"
  name:     string;
}

export interface KEGGGene {
  id:       string;   // e.g. "hsa:207" for Homo sapiens gene 207 (AKT1)
  symbol:   string;
  name:     string;
}

export interface KEGGResult {
  geneId:    string;
  pathways:  KEGGPathway[];
  diseases:  Array<{ id: string; name: string }>;
  drugs:     KEGGDrug[];
  network:   string;   // KEGG BRITE functional category
  status:    "live" | "unavailable" | "error";
}

const KEGG_BASE = "https://rest.kegg.jp";

async function keggGet(endpoint: string): Promise<string> {
  const res = await fetch(`${KEGG_BASE}/${endpoint}`);
  if (!res.ok) throw new Error(`KEGG ${res.status}: ${endpoint}`);
  return res.text();
}

function parseKeggList(text: string): Array<{ id: string; name: string }> {
  return text.trim().split("\n")
    .filter(l => l.trim())
    .map(l => {
      const [id, ...rest] = l.split("\t");
      return { id: id.trim(), name: rest.join(" ").trim() };
    });
}

export async function fetchKEGGPathways(
  geneSymbol: string,
  organism = "hsa",
): Promise<KEGGResult> {
  const base: KEGGResult = {
    geneId: "", pathways: [], diseases: [],
    drugs: [], network: "", status: "unavailable",
  };
  if (!geneSymbol) return base;

  try {
    // Step 1: Find gene entry in KEGG
    const geneSearch = await keggGet(`find/${organism}/${encodeURIComponent(geneSymbol)}`);
    const geneLines = parseKeggList(geneSearch);
    if (!geneLines.length) return { ...base, status: "unavailable" };
    const geneId = geneLines[0].id; // e.g. "hsa:207"

    // Step 2: Get gene entry (links to pathways, diseases, drugs)
    const geneEntry = await keggGet(`get/${geneId}`);

    // Parse pathways
    const pathwayLines = geneEntry
      .split("\n")
      .filter(l => l.startsWith("PATHWAY"))
      .map(l => l.replace("PATHWAY", "").trim());

    // Parse additional PATHWAY lines (continued lines start with whitespace)
    const pathwaySection: string[] = [];
    let inPathway = false;
    for (const line of geneEntry.split("\n")) {
      if (line.startsWith("PATHWAY")) {
        inPathway = true;
        pathwaySection.push(line.replace("PATHWAY", "").trim());
      } else if (inPathway && line.startsWith(" ")) {
        pathwaySection.push(line.trim());
      } else if (inPathway) {
        break;
      }
    }

    const pathways: KEGGPathway[] = pathwaySection
      .filter(l => l)
      .map(l => {
        const match = l.match(/^(hsa\d+)\s+(.+)$/);
        return match
          ? { id: match[1], name: match[2].trim(), category: "KEGG Pathway" }
          : { id: l, name: l, category: "KEGG Pathway" };
      })
      .slice(0, 12);

    // Parse diseases from DISEASE section
    const diseaseSection: string[] = [];
    let inDisease = false;
    for (const line of geneEntry.split("\n")) {
      if (line.startsWith("DISEASE")) {
        inDisease = true;
        diseaseSection.push(line.replace("DISEASE", "").trim());
      } else if (inDisease && line.startsWith(" ")) {
        diseaseSection.push(line.trim());
      } else if (inDisease) {
        break;
      }
    }
    const diseases = diseaseSection
      .filter(l => l)
      .map(l => {
        const match = l.match(/^(H\d+)\s+(.+)$/);
        return match ? { id: match[1], name: match[2].trim() } : { id: l, name: l };
      })
      .slice(0, 6);

    // Parse drugs
    const drugSection: string[] = [];
    let inDrug = false;
    for (const line of geneEntry.split("\n")) {
      if (line.startsWith("DRUG")) {
        inDrug = true;
        drugSection.push(line.replace("DRUG", "").trim());
      } else if (inDrug && line.startsWith(" ")) {
        drugSection.push(line.trim());
      } else if (inDrug) {
        break;
      }
    }
    const drugs: KEGGDrug[] = drugSection
      .filter(l => l)
      .map(l => {
        const match = l.match(/^(D\d+)\s+(.+)$/);
        return match ? { id: match[1], name: match[2].trim() } : { id: l, name: l };
      })
      .slice(0, 8);

    return {
      geneId,
      pathways,
      diseases,
      drugs,
      network: pathways.length > 5 ? "High connectivity" : pathways.length > 2 ? "Moderate" : "Low",
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
