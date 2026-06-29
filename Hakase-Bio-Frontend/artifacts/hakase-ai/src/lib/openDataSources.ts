/**
 * Open Data Sources — trusted public-database API helpers
 * ─────────────────────────────────────────────────────────────────────────
 * Lightweight, dependency-free fetch helpers for three trusted, free,
 * no-API-key open scientific databases. They strengthen the platform's data
 * backing and provide citable references alongside the predicted values.
 *
 * They are DATA-BACKING helpers, not predictors: each call either returns a
 * real record from the public API (status "ok", with a citable URL) or an
 * honest "unavailable" envelope — never a fabricated value. Manual entry
 * remains available everywhere; these simply supply an independent,
 * reference-able cross-check when the network is reachable.
 *
 * Sources & licences
 *   • PubChem (NIH/NCBI)            — public domain. https://pubchem.ncbi.nlm.nih.gov
 *   • IUPHAR/BPS Guide to PHARMACOLOGY — CC BY-SA 4.0. https://www.guidetopharmacology.org
 *   • Europe PMC (EMBL-EBI)        — open metadata.   https://europepmc.org
 *
 * All endpoints used here are free, require no key, and are CORS-enabled for
 * direct browser use. Every call is time-boxed and fails soft.
 */

export type OpenDataStatus = "ok" | "unavailable";

const TIMEOUT_MS = 8000;

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────
// 1. PubChem (NIH/NCBI) — compound identity + reference physicochemistry.
//    Gives an independent, citable cross-check for the RDKit descriptors.
// ─────────────────────────────────────────────────────────────────────────
export interface PubChemRecord {
  status: OpenDataStatus;
  cid: number | null;
  iupacName: string | null;
  molecularFormula: string | null;
  /** PubChem-computed XLogP3 — an independent reference lipophilicity value. */
  xlogp: number | null;
  /** PubChem-computed topological polar surface area (Å²). */
  tpsa: number | null;
  /** Citable PubChem compound page. */
  url: string | null;
  source: "PubChem (NIH/NCBI)";
  error?: string;
}

export async function fetchPubChemRecord(smiles: string): Promise<PubChemRecord> {
  const base: PubChemRecord = {
    status: "unavailable", cid: null, iupacName: null, molecularFormula: null,
    xlogp: null, tpsa: null, url: null, source: "PubChem (NIH/NCBI)",
  };
  if (!smiles || !smiles.trim()) return { ...base, error: "empty SMILES" };
  try {
    // SMILES is POSTed as a form field so reserved URL characters survive.
    const json = await getJson(
      "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/property/" +
        "XLogP,TPSA,MolecularFormula,IUPACName/JSON",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "smiles=" + encodeURIComponent(smiles.trim()),
      },
    );
    const p = json?.PropertyTable?.Properties?.[0];
    if (!p || typeof p.CID !== "number") return { ...base, error: "no PubChem match" };
    return {
      status: "ok",
      cid: p.CID,
      iupacName: p.IUPACName ?? null,
      molecularFormula: p.MolecularFormula ?? null,
      xlogp: typeof p.XLogP === "number" ? p.XLogP : null,
      tpsa: typeof p.TPSA === "number" ? p.TPSA : null,
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
      source: "PubChem (NIH/NCBI)",
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. IUPHAR/BPS Guide to PHARMACOLOGY — expert-curated drug-target reference.
//    Confirms a UniProt is a recognised pharmacological target and gives a
//    citable target record (useful backing for "valid target" selection).
// ─────────────────────────────────────────────────────────────────────────
export interface GtoPdbTarget {
  status: OpenDataStatus;
  targetId: number | null;
  name: string | null;
  abbreviation: string | null;
  /** Target class, e.g. "CatalyticReceptor", "Enzyme", "GPCR". */
  type: string | null;
  /** True when the UniProt is a curated GtoPdb pharmacological target. */
  isCuratedTarget: boolean;
  /** Citable GtoPdb target page. */
  url: string | null;
  source: "IUPHAR/BPS Guide to PHARMACOLOGY";
  error?: string;
}

export async function fetchGtoPdbTarget(uniprotId: string): Promise<GtoPdbTarget> {
  const base: GtoPdbTarget = {
    status: "unavailable", targetId: null, name: null, abbreviation: null,
    type: null, isCuratedTarget: false, url: null,
    source: "IUPHAR/BPS Guide to PHARMACOLOGY",
  };
  if (!uniprotId || !uniprotId.trim() || uniprotId === "—") {
    return { ...base, error: "no UniProt ID" };
  }
  try {
    const arr = await getJson(
      "https://www.guidetopharmacology.org/services/targets?accession=" +
        encodeURIComponent(uniprotId.trim()) + "&database=UniProt",
    );
    const t = Array.isArray(arr) ? arr[0] : null;
    if (!t || typeof t.targetId !== "number") {
      // A valid "not a curated target" answer — still status ok.
      return { ...base, status: "ok", error: "not a curated GtoPdb target" };
    }
    return {
      status: "ok",
      targetId: t.targetId,
      name: t.name ?? null,
      abbreviation: t.abbreviation ?? null,
      type: t.type ?? null,
      isCuratedTarget: true,
      url: `https://www.guidetopharmacology.org/GRAC/ObjectDisplayForward?objectId=${t.targetId}`,
      source: "IUPHAR/BPS Guide to PHARMACOLOGY",
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Europe PMC (EMBL-EBI) — peer-reviewed literature references.
//    Supplies citable primary-literature backing for any prediction context.
// ─────────────────────────────────────────────────────────────────────────
export interface LiteratureRef {
  title: string;
  authors: string;
  year: string | null;
  doi: string | null;
  pmid: string | null;
  /** Citable Europe PMC article page. */
  url: string;
}
export interface EuropePmcResult {
  status: OpenDataStatus;
  hitCount: number;
  references: LiteratureRef[];
  source: "Europe PMC (EMBL-EBI)";
  error?: string;
}

export async function fetchEuropePmcReferences(
  query: string,
  limit = 5,
): Promise<EuropePmcResult> {
  const base: EuropePmcResult = {
    status: "unavailable", hitCount: 0, references: [],
    source: "Europe PMC (EMBL-EBI)",
  };
  if (!query || !query.trim()) return { ...base, error: "empty query" };
  try {
    const json = await getJson(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=" +
        encodeURIComponent(query.trim()) +
        `&format=json&resultType=lite&pageSize=${Math.max(1, Math.min(25, limit))}`,
    );
    const results: any[] = json?.resultList?.result ?? [];
    const references: LiteratureRef[] = results.map((r) => ({
      title: r.title ?? "(untitled)",
      authors: r.authorString ?? "",
      year: r.pubYear ?? null,
      doi: r.doi ?? null,
      pmid: r.pmid ?? null,
      url: r.pmid
        ? `https://europepmc.org/article/MED/${r.pmid}`
        : r.doi
          ? `https://doi.org/${r.doi}`
          : `https://europepmc.org/search?query=${encodeURIComponent(query.trim())}`,
    }));
    return {
      status: "ok",
      hitCount: typeof json?.hitCount === "number" ? json.hitCount : references.length,
      references,
      source: "Europe PMC (EMBL-EBI)",
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}
