/**
 * GTEx Portal v2 client — open REST API, no auth, CORS allow `*`.
 *
 *   https://gtexportal.org/api/v2/
 *
 * v1.1 build note:  the spec calls for GTEx v10.  As of build time the public
 * `medianGeneExpression` endpoint only exposes the `gtex_v8` dataset; the v10
 * release is announced on the portal but not yet wired into this endpoint.
 * We honestly use v8 and surface the dataset version + snapshot date in every
 * row's provenance.  When v10 lands at this endpoint, change `DATASET_ID` and
 * the snapshot date carries forward unchanged.
 *
 * Endpoints used:
 *   GET /reference/gene?geneId={symbol}             → gene metadata + gencodeId
 *   GET /expression/medianGeneExpression?gencodeId  → per-tissue median TPM
 */

const GTEX_BASE = "https://gtexportal.org/api/v2";
const DATASET_ID = "gtex_v8";

export interface GtexGeneRecord {
  geneSymbol: string;
  gencodeId: string;
  entrezGeneId: number;
  chromosome: string;
  description: string;
}

export interface GtexTissueExpression {
  tissueSiteDetailId: string;   // e.g. "Liver", "Brain_Cortex"
  ontologyId: string;           // UBERON:xxxxxxx
  median: number;               // median TPM
  unit: "TPM";
}

export interface GtexExpressionResult {
  geneSymbol: string;
  gencodeId: string;
  datasetId: string;
  datasetSnapshot: string;      // human-readable version label
  rows: GtexTissueExpression[];
  fetchedAt: string;
}

export class GtexNotFoundError extends Error {
  constructor(public readonly geneSymbol: string) {
    super(`GTEx: no record for gene "${geneSymbol}"`);
  }
}

export class GtexServiceError extends Error {
  constructor(public readonly status: number, msg: string) {
    super(`GTEx service error (${status}): ${msg}`);
  }
}

/** Resolve a gene symbol → gencodeId via the reference endpoint. */
export async function resolveGencodeId(geneSymbol: string): Promise<GtexGeneRecord> {
  const url = `${GTEX_BASE}/reference/gene?geneId=${encodeURIComponent(geneSymbol)}&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new GtexServiceError(res.status, `gene resolve failed for "${geneSymbol}"`);
  }
  const j = await res.json();
  const rows: any[] = j?.data ?? [];
  if (rows.length === 0) throw new GtexNotFoundError(geneSymbol);
  // Prefer the protein-coding entry when multiple rows return.
  const preferred = rows.find(r => r.geneType === "protein coding") ?? rows[0];
  return {
    geneSymbol: preferred.geneSymbol,
    gencodeId: preferred.gencodeId,
    entrezGeneId: preferred.entrezGeneId,
    chromosome: preferred.chromosome,
    description: preferred.description,
  };
}

/** Fetch the median expression across all 54 GTEx tissues for a gene. */
export async function fetchMedianTissueExpression(
  geneSymbol: string,
): Promise<GtexExpressionResult> {
  const gene = await resolveGencodeId(geneSymbol);
  const url =
    `${GTEX_BASE}/expression/medianGeneExpression` +
    `?gencodeId=${encodeURIComponent(gene.gencodeId)}` +
    `&datasetId=${DATASET_ID}` +
    `&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new GtexServiceError(res.status, `median expression fetch failed for "${gene.gencodeId}"`);
  }
  const j = await res.json();
  const rawRows: any[] = j?.data ?? [];
  if (rawRows.length === 0) {
    throw new GtexNotFoundError(`${geneSymbol} (gencodeId ${gene.gencodeId}) — no expression rows`);
  }
  const rows: GtexTissueExpression[] = rawRows.map(r => ({
    tissueSiteDetailId: r.tissueSiteDetailId,
    ontologyId: r.ontologyId,
    median: typeof r.median === "number" ? r.median : 0,
    unit: "TPM",
  }));
  return {
    geneSymbol: gene.geneSymbol,
    gencodeId: gene.gencodeId,
    datasetId: DATASET_ID,
    datasetSnapshot: "GTEx v8 / 2017-06-05 release",
    rows,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Map a GTEx tissueSiteDetailId → coarse PBPK compartment when one exists.
 * Returns null when our 2-compartment PBPK does not have an explicit
 * compartment for this tissue (the surrogate falls back to plasma-equilibrium
 * Cu and marks the row's confidence as "low").
 *
 * The 2-compartment PBPK in `lib/pbpk.ts` only has central / peripheral, so
 * we cannot deliver a per-organ Cu from PBPK alone.  This map is the honest
 * statement of what we cover; it will be expanded when the PBPK gains
 * explicit organ compartments.
 */
export function tissueToPbpkCompartment(tissueSiteDetailId: string): string | null {
  const t = tissueSiteDetailId.toLowerCase();
  if (t === "liver") return "liver (peripheral)";
  if (t.startsWith("kidney")) return "kidney (peripheral)";
  if (t.startsWith("brain")) return "brain (BBB-restricted)";
  if (t.startsWith("heart")) return "heart (peripheral)";
  if (t.startsWith("adipose")) return "adipose (peripheral)";
  if (t === "stomach" || t.startsWith("small_intestine") || t === "colon_sigmoid" || t === "colon_transverse") {
    return "gut (oral absorption)";
  }
  if (t.startsWith("muscle")) return "muscle (peripheral)";
  if (t === "lung") return "lung (highly perfused)";
  return null;
}

/** Human-readable tissue label from a tissueSiteDetailId. */
export function humanTissueLabel(tissueSiteDetailId: string): string {
  return tissueSiteDetailId.replace(/_/g, " ");
}
