// ── PharmGKB Integration ──────────────────────────────────────────────────
// Pharmacogenomics knowledge base
// https://api.pharmgkb.org/v1/
// Free (academic), no auth required for basic lookups, CORS-enabled

export interface PharmGKBVariant {
  id:          string;
  name:        string;
  gene:        string;
  phenotype:   string;
  significance:"Actionable" | "Informative" | "Uncertain";
  level:       "1A" | "1B" | "2A" | "2B" | "3" | "4";
  chemicals:   string[];
}

export interface CYPImpact {
  enzyme:   string;   // CYP3A4, CYP2D6, etc.
  role:     "Substrate" | "Inhibitor" | "Inducer" | "Unknown";
  strength: "Strong" | "Moderate" | "Weak" | "Unknown";
}

export interface PharmGKBResult {
  geneId:       string;
  geneName:     string;
  variants:     PharmGKBVariant[];
  cypImpacts:   CYPImpact[];
  hasGuideline: boolean;
  guidelineCount:number;
  drugCount:    number;
  status:       "live" | "unavailable" | "error";
}

const PGKB_BASE = "https://api.pharmgkb.org/v1";

export async function fetchPharmGKB(geneSymbol: string): Promise<PharmGKBResult> {
  const base: PharmGKBResult = {
    geneId: "", geneName: geneSymbol, variants: [],
    cypImpacts: [], hasGuideline: false, guidelineCount: 0,
    drugCount: 0, status: "unavailable",
  };
  if (!geneSymbol) return base;

  try {
    // Search gene by symbol
    const geneRes = await fetch(
      `${PGKB_BASE}/data/gene?symbol=${encodeURIComponent(geneSymbol)}&view=base`,
    );
    if (!geneRes.ok) return { ...base, status: "error" };
    const geneJson = await geneRes.json();
    const gene = geneJson?.data?.[0];
    if (!gene) return { ...base, status: "unavailable" };

    const geneId: string = gene.id ?? "";

    // Fetch guideline annotations for this gene
    const guidelineRes = await fetch(
      `${PGKB_BASE}/data/guideline?genes=${encodeURIComponent(geneId)}&view=base`,
    );
    const guidelines: any[] = guidelineRes.ok
      ? (await guidelineRes.json())?.data ?? []
      : [];

    // Fetch variant annotations
    const variantRes = await fetch(
      `${PGKB_BASE}/data/clinicalAnnotation?gene=${encodeURIComponent(geneId)}&view=base`,
    );
    const annotRaw: any[] = variantRes.ok
      ? (await variantRes.json())?.data ?? []
      : [];

    const variants: PharmGKBVariant[] = annotRaw.slice(0, 10).map((a: any) => {
      const level = String(a.level ?? "3") as PharmGKBVariant["level"];
      return {
        id:           a.id ?? "",
        name:         a.variant?.name ?? a.haplotypes?.[0]?.name ?? "—",
        gene:         geneSymbol,
        phenotype:    a.phenotypes?.[0]?.name ?? a.phenotypeCategories?.[0]?.term ?? "—",
        significance: level === "1A" || level === "1B" ? "Actionable" :
                      level === "2A" || level === "2B" ? "Informative" : "Uncertain",
        level,
        chemicals:    a.chemicals?.map((c: any) => c.name ?? "").filter(Boolean) ?? [],
      };
    });

    // CYP impact: check if this gene is a major CYP enzyme
    const cypImpacts: CYPImpact[] = [];
    const cypGenes = ["CYP3A4", "CYP2D6", "CYP2C9", "CYP2C19", "CYP1A2", "CYP2B6", "CYP2E1"];
    if (cypGenes.includes(geneSymbol.toUpperCase())) {
      // This gene IS a CYP enzyme — query metabolized drugs
      cypImpacts.push({
        enzyme:   geneSymbol.toUpperCase(),
        role:     "Substrate",  // the gene itself is the metabolizing enzyme
        strength: "Strong",
      });
    }

    return {
      geneId,
      geneName:     gene.symbol ?? geneSymbol,
      variants,
      cypImpacts,
      hasGuideline: guidelines.length > 0,
      guidelineCount: guidelines.length,
      drugCount:    gene.relatedChemicals?.length ?? 0,
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
