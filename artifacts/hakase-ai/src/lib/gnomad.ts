// ── gnomAD Integration ────────────────────────────────────────────────────
// Genome Aggregation Database — population variant frequencies
// GraphQL API: https://gnomad.broadinstitute.org/api
// Free, no auth, CORS-enabled

export interface GnomADVariant {
  variantId:   string;
  rsid:        string | null;
  consequence: string;
  af:          number;     // Allele frequency (all populations)
  afr_af:      number;
  amr_af:      number;
  eas_af:      number;
  nfe_af:      number;
  sas_af:      number;
  isLoF:       boolean;
  isMissense:  boolean;
  clinSig:     string | null;
}

export interface GnomADResult {
  geneId:         string;
  geneName:       string;
  chromosome:     string;
  variants:       GnomADVariant[];
  lofCount:       number;
  missenseCount:  number;
  constraintOe:   number | null;  // Observed/Expected LoF ratio (lower = more constrained)
  pliScore:       number | null;  // pLI score (probability of LoF intolerance)
  zScore:         number | null;  // Missense Z score
  status:         "live" | "unavailable" | "error";
}

const GNOMAD_GRAPHQL = "https://gnomad.broadinstitute.org/api";

const GENE_QUERY = `
query GeneVariants($geneSymbol: String!, $dataset: DatasetId!) {
  gene(gene_symbol: $geneSymbol, reference_genome: GRCh38) {
    gene_id
    symbol
    chrom
    gnomad_constraint {
      oe_lof
      oe_lof_upper
      pLI
      z_score_mis
    }
    variants(dataset: $dataset) {
      variant_id
      rsids
      consequence
      genome { af af_afr af_amr af_eas af_nfe af_sas }
      lof
      flags
      clinvar_clinsig
    }
  }
}`;

export async function fetchGnomAD(
  geneSymbol: string,
  dataset: "gnomad_r4" | "gnomad_r3" | "gnomad_r2_1" = "gnomad_r4",
): Promise<GnomADResult> {
  const base: GnomADResult = {
    geneId: "", geneName: geneSymbol, chromosome: "",
    variants: [], lofCount: 0, missenseCount: 0,
    constraintOe: null, pliScore: null, zScore: null, status: "unavailable",
  };
  if (!geneSymbol) return base;

  try {
    const res = await fetch(GNOMAD_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: GENE_QUERY,
        variables: { geneSymbol: geneSymbol.toUpperCase(), dataset },
      }),
    });
    if (!res.ok) return { ...base, status: "error" };
    const json = await res.json();
    if (json.errors?.length) return { ...base, status: "error" };

    const gene = json.data?.gene;
    if (!gene) return { ...base, status: "unavailable" };

    const rawVariants: any[] = (gene.variants ?? []).slice(0, 50);
    const variants: GnomADVariant[] = rawVariants.map((v: any) => ({
      variantId:   v.variant_id ?? "",
      rsid:        v.rsids?.[0] ?? null,
      consequence: v.consequence ?? "—",
      af:          v.genome?.af ?? 0,
      afr_af:      v.genome?.af_afr ?? 0,
      amr_af:      v.genome?.af_amr ?? 0,
      eas_af:      v.genome?.af_eas ?? 0,
      nfe_af:      v.genome?.af_nfe ?? 0,
      sas_af:      v.genome?.af_sas ?? 0,
      isLoF:       v.lof === "HC",
      isMissense:  (v.consequence ?? "").includes("missense"),
      clinSig:     v.clinvar_clinsig ?? null,
    }));

    const constraint = gene.gnomad_constraint;

    return {
      geneId:       gene.gene_id ?? "",
      geneName:     gene.symbol ?? geneSymbol,
      chromosome:   gene.chrom ?? "",
      variants,
      lofCount:     variants.filter(v => v.isLoF).length,
      missenseCount:variants.filter(v => v.isMissense).length,
      constraintOe: constraint?.oe_lof ?? null,
      pliScore:     constraint?.pLI ?? null,
      zScore:       constraint?.z_score_mis ?? null,
      status: "live",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
