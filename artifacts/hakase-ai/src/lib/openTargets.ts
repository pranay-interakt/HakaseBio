// ── Open Targets Platform Integration ────────────────────────────────────
// Open Targets GraphQL API — target-disease associations, drug evidence
// https://api.platform.opentargets.org/api/v4/graphql
// Free, no auth, CORS-enabled

export interface OTAssociation {
  diseaseId:   string;
  diseaseName: string;
  score:       number;       // 0–1 overall association score
  geneticScore:number;
  clinicalScore:number;
  literatureScore:number;
  knownDrugs:  number;       // approved drugs for this indication
  clinicalTrials: number;
}

export interface OTTargetResult {
  targetId:     string;      // Ensembl gene ID
  geneName:     string;
  targetClass:  string;
  topDiseases:  OTAssociation[];
  totalDiseases:number;
  approvedDrugs:number;
  tractability: {
    smallMolecule: number;
    antibody:      number;
  };
  safetyLiabilities: number;
  status: "live" | "unavailable" | "error";
}

const OT_GRAPHQL = "https://api.platform.opentargets.org/api/v4/graphql";

async function otQuery(query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(OT_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`OT API ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

// First resolve UniProt → Ensembl target ID via Open Targets
const UNIPROT_TO_TARGET_QUERY = `
query UniProtToTarget($uniprotId: String!) {
  target(ensemblId: $uniprotId) {
    id
    approvedSymbol
    approvedName
    targetClass { label }
  }
}`;

const TARGET_ASSOC_QUERY = `
query TargetAssociations($targetId: String!, $size: Int!) {
  target(ensemblId: $targetId) {
    id
    approvedSymbol
    approvedName
    targetClass { label }
    safetyLiabilities { event }
    tractability { smallmolecule { topBucket } antibody { topBucket } }
    knownDrugs { count }
    associatedDiseases(page: { size: $size, index: 0 }) {
      count
      rows {
        disease { id name }
        score
        datatypeScores { componentId score }
        evidenceCount
        knownDrugs { count }
        clinicalTrials { count }
      }
    }
  }
}`;

// Search target by gene symbol to get Ensembl ID
const GENE_SEARCH_QUERY = `
query GeneSearch($query: String!) {
  search(queryString: $query, entityNames: ["target"], page: { index: 0, size: 3 }) {
    hits {
      id
      object {
        ... on Target {
          id
          approvedSymbol
          approvedName
        }
      }
    }
  }
}`;

export async function fetchOpenTargets(
  uniprotOrGene: string,
  isGeneSymbol = false,
): Promise<OTTargetResult> {
  const base: OTTargetResult = {
    targetId: "", geneName: "", targetClass: "",
    topDiseases: [], totalDiseases: 0, approvedDrugs: 0,
    tractability: { smallMolecule: 0, antibody: 0 },
    safetyLiabilities: 0, status: "unavailable",
  };
  if (!uniprotOrGene) return base;

  try {
    let ensemblId: string | null = null;

    // Try direct Ensembl ID lookup (OT uses Ensembl IDs, not UniProt directly)
    // But we can search by gene symbol or UniProt
    const searchData = await otQuery(GENE_SEARCH_QUERY, { query: uniprotOrGene });
    ensemblId = searchData?.search?.hits?.[0]?.id ?? null;
    if (!ensemblId) return { ...base, status: "unavailable" };

    // Fetch detailed target info with associations
    const data = await otQuery(TARGET_ASSOC_QUERY, { targetId: ensemblId, size: 10 });
    const t = data?.target;
    if (!t) return { ...base, status: "unavailable" };

    const diseases = t?.associatedDiseases?.rows ?? [];
    const topDiseases: OTAssociation[] = diseases.map((d: any) => {
      const scores = d.datatypeScores ?? [];
      const getScore = (id: string) => scores.find((s: any) => s.componentId === id)?.score ?? 0;
      return {
        diseaseId:     d.disease?.id ?? "",
        diseaseName:   d.disease?.name ?? "—",
        score:         d.score ?? 0,
        geneticScore:  getScore("genetic_association"),
        clinicalScore: getScore("clinical_trial"),
        literatureScore: getScore("literature"),
        knownDrugs:    d.knownDrugs?.count ?? 0,
        clinicalTrials:d.clinicalTrials?.count ?? 0,
      };
    });

    return {
      targetId:     ensemblId,
      geneName:     t.approvedSymbol ?? uniprotOrGene,
      targetClass:  t.targetClass?.[0]?.label ?? "—",
      topDiseases,
      totalDiseases:t.associatedDiseases?.count ?? 0,
      approvedDrugs:t.knownDrugs?.count ?? 0,
      tractability: {
        smallMolecule: t.tractability?.smallmolecule?.topBucket ?? 0,
        antibody:      t.tractability?.antibody?.topBucket ?? 0,
      },
      safetyLiabilities: t.safetyLiabilities?.length ?? 0,
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
