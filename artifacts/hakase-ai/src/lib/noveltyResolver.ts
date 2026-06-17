/**
 * Novelty / Existence Resolver — "is this compound novel or already known?"
 * ─────────────────────────────────────────────────────────────────────────
 * Before the L1 engine spends ML/heuristic effort on a molecule, this module
 * asks a prior question a medicinal chemist always asks first: *has anyone
 * seen this structure before?* The answer changes everything downstream — a
 * marketed drug should resolve to its measured profile (the lookup-first
 * path), a compound already in patents/literature is not a clean-slate IP
 * position, and a structure with no public record anywhere is genuinely
 * novel chemistry where every endpoint is an extrapolation.
 *
 * It consolidates four independent, free, CORS-enabled public sources and
 * returns ONE consensus verdict plus per-source citable evidence. It never
 * fabricates: each source returns a real record or an honest "unavailable".
 *
 * Sources
 *   • PubChem (NIH/NCBI)      — definitive existence by structure (>110 M
 *                               compounds) + BioAssay testing footprint.
 *   • EBI UniChem             — one structure resolved across ~40 source DBs
 *                               at once: ChEMBL, DrugBank, SureChEMBL
 *                               (patents), ZINC, Guide to Pharmacology, etc.
 *   • Europe PMC (EMBL-EBI)   — peer-reviewed / preprint literature mentions.
 *   • DrugBank / DrugCentral  — clinical/approval status (via UniChem source
 *                               membership; DrugBank src_id=2).
 *
 * All endpoints are free, key-less, CORS-enabled, time-boxed, and fail soft.
 *
 * References for the read-across rationale that consumes this:
 *   OECD (2014) Guidance on Grouping of Chemicals (read-across); ECHA RAAF
 *   (2017). Presence in measured public data is what makes a downstream
 *   read-across defensible.
 */

export type NoveltyStatus = "ok" | "unavailable";

const TIMEOUT_MS = 9000;

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── UniChem source-id map (the subset we interpret) ─────────────────────────
// Full registry: https://www.ebi.ac.uk/unichem/sources
const UNICHEM_SOURCES: Record<number, { name: string; kind: "drug" | "patent" | "chem" | "screening" | "pharmacology"; url?: (id: string) => string }> = {
  1:  { name: "ChEMBL",                 kind: "chem",        url: (id) => `https://www.ebi.ac.uk/chembl/compound_report_card/${id}/` },
  2:  { name: "DrugBank",               kind: "drug",        url: (id) => `https://go.drugbank.com/drugs/${id}` },
  3:  { name: "PDBe",                   kind: "chem" },
  4:  { name: "Guide to Pharmacology",  kind: "pharmacology" },
  7:  { name: "ZINC",                   kind: "screening" },
  14: { name: "FDA SRS",                kind: "drug" },
  15: { name: "SureChEMBL (patents)",   kind: "patent",      url: (id) => `https://www.surechembl.org/chemical/${id}` },
  17: { name: "PharmGKB",               kind: "drug" },
  22: { name: "PubChem",                kind: "chem",        url: (id) => `https://pubchem.ncbi.nlm.nih.gov/compound/${id}` },
  31: { name: "BindingDB",              kind: "chem" },
  34: { name: "DrugCentral",            kind: "drug",        url: (id) => `https://drugcentral.org/drugcard/${id}` },
};

// ─────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────

export interface SourceHit {
  source: string;
  /** Identifier in that source (CID, ChEMBL ID, DrugBank ID, patent id…). */
  id: string | null;
  /** Citable page when one exists. */
  url: string | null;
  /** Free-text note (e.g. "approved drug", "appears in N patents"). */
  note?: string;
}

export interface NoveltyEvidence {
  /** PubChem identity + how heavily the compound has been bioassayed. */
  pubchem: {
    status: NoveltyStatus;
    cid: number | null;
    inchikey: string | null;
    iupacName: string | null;
    bioassayActive: number | null;
    bioassayTested: number | null;
    url: string | null;
    error?: string;
  };
  /** UniChem cross-reference breadth. */
  unichem: {
    status: NoveltyStatus;
    hits: SourceHit[];
    sourceCount: number;
    error?: string;
  };
  /** Europe PMC literature footprint. */
  literature: {
    status: NoveltyStatus;
    hitCount: number | null;
    topUrl: string | null;
    error?: string;
  };
}

export type NoveltyVerdict =
  | "Marketed / clinical drug"          // resolves to DrugBank/DrugCentral/FDA + heavy bioassay
  | "Known chemical (literature/patent)" // in ChEMBL/PubChem/SureChEMBL but not a clinical entity
  | "Sparsely documented"                // exists in PubChem but little else
  | "Novel — no public record"           // no PubChem CID, no UniChem, no literature
  | "Unknown (lookup unavailable)";       // network failed everywhere

export interface NoveltyReport {
  verdict: NoveltyVerdict;
  /**
   * 0–1 novelty score. 1.0 = no public footprint anywhere (true clean-slate
   * chemistry); 0.0 = marketed drug with a deep bioassay + clinical record.
   * This is a *documentation* score, not a chemistry-quality score.
   */
  noveltyScore: number;
  /** True when the structure is a recognised clinical/marketed drug. */
  isKnownDrug: boolean;
  /** True when patents (SureChEMBL) reference this exact structure. */
  inPatents: boolean;
  /** One-line human summary. */
  summary: string;
  /** Sorted, de-duplicated citable hits across all sources. */
  hits: SourceHit[];
  evidence: NoveltyEvidence;
  /** ISO timestamp. */
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────
// PURE consensus logic (unit-tested; no network)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Derive the consensus verdict + novelty score from already-fetched evidence.
 * Separated from the network layer so it can be tested deterministically.
 */
export function deriveNoveltyVerdict(ev: NoveltyEvidence): Omit<NoveltyReport, "evidence" | "timestamp" | "hits"> {
  const pcOk = ev.pubchem.status === "ok" && ev.pubchem.cid != null;
  const uniHits = ev.unichem.status === "ok" ? ev.unichem.hits : [];
  const litCount = ev.literature.status === "ok" ? (ev.literature.hitCount ?? 0) : 0;

  const drugHit = uniHits.some((h) => {
    const src = Object.values(UNICHEM_SOURCES).find((s) => s.name === h.source);
    return src?.kind === "drug";
  });
  const patentHit = uniHits.some((h) => /SureChEMBL/i.test(h.source));
  const chemHit = pcOk || uniHits.length > 0;
  const heavilyAssayed = (ev.pubchem.bioassayActive ?? 0) >= 5 || (ev.pubchem.bioassayTested ?? 0) >= 25;

  // Everything failed → honest unknown.
  if (ev.pubchem.status !== "ok" && ev.unichem.status !== "ok" && ev.literature.status !== "ok") {
    return {
      verdict: "Unknown (lookup unavailable)",
      noveltyScore: 0.5,
      isKnownDrug: false,
      inPatents: false,
      summary: "Could not reach any public database to verify this structure — treat novelty as unknown and rely on the model verdict.",
    };
  }

  let verdict: NoveltyVerdict;
  let noveltyScore: number;
  if (drugHit) {
    verdict = "Marketed / clinical drug";
    noveltyScore = 0.05;
  } else if (chemHit && (patentHit || litCount > 0 || heavilyAssayed)) {
    verdict = "Known chemical (literature/patent)";
    // More documentation → less novel. Scale within [0.2, 0.55].
    noveltyScore = clamp01(0.55 - Math.min(0.35, (litCount / 50) * 0.2 + (patentHit ? 0.15 : 0) + (heavilyAssayed ? 0.1 : 0)));
  } else if (pcOk) {
    verdict = "Sparsely documented";
    noveltyScore = 0.75;
  } else {
    verdict = "Novel — no public record";
    noveltyScore = 0.97;
  }

  const summary = (() => {
    switch (verdict) {
      case "Marketed / clinical drug":
        return "Structure resolves to a recognised clinical/marketed drug — use its measured profile (lookup-first path), not a model extrapolation.";
      case "Known chemical (literature/patent)":
        return `Structure is already documented in public chemistry${patentHit ? " and patents (SureChEMBL)" : ""}${litCount > 0 ? `, with ${litCount}+ literature mention${litCount === 1 ? "" : "s"}` : ""}. Not a clean-slate IP position; measured analog data is likely available for read-across.`;
      case "Sparsely documented":
        return "Exists in PubChem but with a thin downstream footprint — partial precedent; expect limited measured data for read-across.";
      case "Novel — no public record":
        return "No public structural record found in PubChem, UniChem, or the literature — treat as genuinely novel chemistry. Every endpoint is an extrapolation; weight read-across by nearest measured neighbours and keep confidence honest.";
      default:
        return "";
    }
  })();

  return { verdict, noveltyScore, isKnownDrug: drugHit, inPatents: patentHit, summary };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ─────────────────────────────────────────────────────────────────────────
// Network layer (each call fails soft)
// ─────────────────────────────────────────────────────────────────────────

async function fetchPubChemIdentity(smiles: string): Promise<NoveltyEvidence["pubchem"]> {
  const base: NoveltyEvidence["pubchem"] = {
    status: "unavailable", cid: null, inchikey: null, iupacName: null,
    bioassayActive: null, bioassayTested: null, url: null,
  };
  if (!smiles?.trim()) return { ...base, error: "empty SMILES" };
  try {
    const json = await getJson(
      "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/property/InChIKey,IUPACName/JSON",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "smiles=" + encodeURIComponent(smiles.trim()),
      },
    );
    const p = json?.PropertyTable?.Properties?.[0];
    if (!p || typeof p.CID !== "number") return { ...base, status: "ok", error: "no PubChem match" };
    const cid: number = p.CID;
    // PubChem returns CID 0 for "structure is valid but NOT a registered
    // PubChem compound" — i.e. a genuinely novel structure. Treat that as a
    // no-match (cid stays null, no broken /compound/0 link), while still
    // keeping the standardised InChIKey so UniChem / literature can run.
    const validCid = cid > 0;
    const out: NoveltyEvidence["pubchem"] = {
      status: "ok",
      cid: validCid ? cid : null,
      inchikey: p.InChIKey ?? null,
      iupacName: p.IUPACName ?? null,
      bioassayActive: null, bioassayTested: null,
      url: validCid ? `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` : null,
      error: validCid ? undefined : "structure not registered in PubChem (CID 0) — novel",
    };
    if (!validCid) return out;
    // Bioassay footprint — best-effort, never blocks the verdict.
    try {
      const counts = await getJson(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/assaysummary/JSON`,
      );
      const rows: any[] = counts?.Table?.Row ?? [];
      const cols: string[] = counts?.Table?.Columns?.Column ?? [];
      const outcomeIdx = cols.findIndex((c) => /activity outcome/i.test(c));
      let active = 0;
      for (const r of rows) {
        const cell = Array.isArray(r?.Cell) ? r.Cell[outcomeIdx] : undefined;
        if (typeof cell === "string" && /active/i.test(cell)) active++;
      }
      out.bioassayTested = rows.length;
      out.bioassayActive = outcomeIdx >= 0 ? active : null;
    } catch { /* leave bioassay null */ }
    return out;
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

async function fetchUniChem(inchikey: string | null): Promise<NoveltyEvidence["unichem"]> {
  const base: NoveltyEvidence["unichem"] = { status: "unavailable", hits: [], sourceCount: 0 };
  if (!inchikey) return { ...base, error: "no InChIKey (PubChem identity required first)" };
  try {
    // Legacy UniChem REST: array of { src_id, src_compound_id }.
    const arr = await getJson(`https://www.ebi.ac.uk/unichem/rest/inchikey/${encodeURIComponent(inchikey)}`);
    if (!Array.isArray(arr)) return { ...base, status: "ok", error: "no UniChem mapping" };
    const hits: SourceHit[] = [];
    for (const row of arr) {
      const sid = Number(row?.src_id);
      const cid = String(row?.src_compound_id ?? "");
      const meta = UNICHEM_SOURCES[sid];
      if (!meta || !cid) continue;
      hits.push({
        source: meta.name,
        id: cid,
        url: meta.url ? meta.url(cid) : null,
        note: meta.kind === "drug" ? "drug database" : meta.kind === "patent" ? "patent reference" : meta.kind,
      });
    }
    return { status: "ok", hits, sourceCount: new Set(hits.map((h) => h.source)).size };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

async function fetchLiterature(query: string): Promise<NoveltyEvidence["literature"]> {
  const base: NoveltyEvidence["literature"] = { status: "unavailable", hitCount: null, topUrl: null };
  if (!query?.trim()) return { ...base, error: "no query term" };
  try {
    const json = await getJson(
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=" +
        encodeURIComponent(`"${query.trim()}"`) + "&format=json&pageSize=1",
    );
    const count: number = json?.hitCount ?? 0;
    return {
      status: "ok",
      hitCount: count,
      topUrl: count > 0 ? `https://europepmc.org/search?query=${encodeURIComponent(query.trim())}` : null,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve novelty for a SMILES across all sources. Network calls fan out in
 * the right order (PubChem identity must resolve the InChIKey before UniChem
 * and the literature query can use it), all fail soft.
 */
export async function resolveNovelty(smiles: string): Promise<NoveltyReport> {
  const pubchem = await fetchPubChemIdentity(smiles);
  const inchikey = pubchem.inchikey;
  // UniChem (needs InChIKey) and literature (best keyed on InChIKey, falls
  // back to IUPAC name) run in parallel.
  const litQuery = inchikey ?? pubchem.iupacName ?? "";
  const [unichem, literature] = await Promise.all([
    fetchUniChem(inchikey),
    fetchLiterature(litQuery),
  ]);

  const evidence: NoveltyEvidence = { pubchem, unichem, literature };
  const core = deriveNoveltyVerdict(evidence);

  // Assemble a sorted, de-duplicated citable hit list (drug sources first).
  const hits: SourceHit[] = [];
  if (pubchem.status === "ok" && pubchem.cid != null) {
    hits.push({ source: "PubChem", id: String(pubchem.cid), url: pubchem.url, note: "compound record" });
  }
  for (const h of unichem.hits) hits.push(h);
  const seen = new Set<string>();
  const dedup = hits.filter((h) => {
    const k = `${h.source}:${h.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const kindRank = (h: SourceHit) => (/DrugBank|DrugCentral|FDA/i.test(h.source) ? 0 : /SureChEMBL/i.test(h.source) ? 1 : 2);
  dedup.sort((a, b) => kindRank(a) - kindRank(b));

  return { ...core, hits: dedup, evidence, timestamp: new Date().toISOString() };
}
