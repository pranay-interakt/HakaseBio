// ── STRING Protein Interaction Network ────────────────────────────────────
// STRING DB REST API — protein interaction data
// https://string-db.org/cgi/help.pl?subpage=api%23getting-all-partners-of-proteins
// Free, no auth, CORS-enabled

export interface StringInteraction {
  protein1:    string;
  protein2:    string;
  geneName2:   string;
  score:       number;   // combined_score 0–1000
  experiments: number;
  database:    number;
  textmining:  number;
  coexpression:number;
  neighborhood:number;
  fusion:      number;
}

export interface StringResult {
  queryGene:    string;
  interactions: StringInteraction[];
  topPartners:  Array<{ gene: string; score: number; type: string }>;
  hubScore:     number;   // network centrality proxy (interaction count)
  functionalPartners: number;  // partners with experimental score > 700
  status:       "live" | "unavailable" | "error";
}

const STRING_API = "https://string-db.org/api/json";
const HUMAN_TAXON = "9606";

export async function fetchStringInteractions(
  geneOrUniProt: string,
  minScore = 700,
  limit = 20,
): Promise<StringResult> {
  const base: StringResult = {
    queryGene: geneOrUniProt, interactions: [], topPartners: [],
    hubScore: 0, functionalPartners: 0, status: "unavailable",
  };
  if (!geneOrUniProt) return base;

  try {
    // Step 1: Resolve to STRING ID
    const resolveRes = await fetch(
      `${STRING_API}/get_string_ids?identifiers=${encodeURIComponent(geneOrUniProt)}&species=${HUMAN_TAXON}&limit=1`,
    );
    if (!resolveRes.ok) return { ...base, status: "error" };
    const resolved: any[] = await resolveRes.json();
    const stringId = resolved?.[0]?.stringId ?? resolved?.[0]?.preferredName;
    if (!stringId) return { ...base, status: "unavailable" };

    // Step 2: Get interaction partners
    const partnersRes = await fetch(
      `${STRING_API}/interaction_partners?identifiers=${encodeURIComponent(stringId)}&species=${HUMAN_TAXON}&limit=${limit}&required_score=${minScore}`,
    );
    if (!partnersRes.ok) return { ...base, status: "error" };
    const partners: any[] = await partnersRes.json();

    const interactions: StringInteraction[] = partners.map((p: any) => ({
      protein1:     p.stringId_A ?? "",
      protein2:     p.stringId_B ?? "",
      geneName2:    p.preferredName_B ?? p.stringId_B ?? "",
      score:        p.score ?? 0,
      experiments:  p.escore ?? 0,
      database:     p.dscore ?? 0,
      textmining:   p.tscore ?? 0,
      coexpression: p.ascore ?? 0,
      neighborhood: p.nscore ?? 0,
      fusion:       p.fscore ?? 0,
    }));

    const topPartners = interactions.slice(0, 10).map(i => ({
      gene:  i.geneName2,
      score: i.score,
      type:  i.experiments > 500 ? "Experimental" :
             i.database   > 500 ? "Database"     :
             i.textmining > 500 ? "Literature"   : "Predicted",
    }));

    const functionalPartners = interactions.filter(i => i.score >= 700).length;

    return {
      queryGene:    resolved[0]?.preferredName ?? geneOrUniProt,
      interactions,
      topPartners,
      hubScore:     interactions.length,
      functionalPartners,
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
