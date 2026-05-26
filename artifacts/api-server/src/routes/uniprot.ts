/**
 * UniProt REST API proxy — full protein annotation for Layer 1 + Layer 2.
 *
 * Surfaces:
 *  GET /uniprot/entry/:accession          — full annotation (sequence, function,
 *                                           diseases, GO terms, pathways, PDB xrefs)
 *  GET /uniprot/search                    — keyword / gene / disease search
 *  GET /uniprot/sequence/:accession       — raw FASTA (for Boltz-2 entity blocks)
 *  GET /uniprot/similar-peptides          — find UniProt peptides similar to a query
 *
 * All responses are shaped for direct consumption by the twin's Layer 1 panels
 * without any upstream tool names being leaked.
 */

import { Router } from "express";

const router = Router();
const UP_BASE = "https://rest.uniprot.org/uniprotkb";
const HEADERS  = { Accept: "application/json", "User-Agent": "HakaseAI-BioTwin/2.0" };
const TIMEOUT  = 12_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function upFetch(url: string): Promise<any> {
  const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
  if (!resp.ok) throw Object.assign(new Error(`UniProt HTTP ${resp.status}`), { status: resp.status });
  return resp.json();
}

function shapedEntry(raw: any) {
  /** Normalise a UniProt JSON entry into the fields Layer 1 needs. */
  const xrefs: any[] = raw.uniProtKBCrossReferences ?? [];
  const pdbIds  = xrefs.filter((x: any) => x.database === "PDB").map((x: any) => x.id);
  const pathways = xrefs.filter((x: any) => x.database === "Reactome").map((x: any) => ({
    id: x.id,
    name: x.properties?.find((p: any) => p.key === "PathwayName")?.value ?? x.id,
  }));
  const omimIds  = xrefs.filter((x: any) => x.database === "MIM").map((x: any) => x.id);
  const interpro = xrefs.filter((x: any) => x.database === "InterPro").map((x: any) => ({
    id: x.id,
    name: x.properties?.find((p: any) => p.key === "EntryName")?.value ?? x.id,
  }));

  const goCc: any[] = [], goMf: any[] = [], goBp: any[] = [];
  for (const x of xrefs) {
    if (x.database !== "GO") continue;
    const aspect = x.properties?.find((p: any) => p.key === "GoTerm")?.value ?? "";
    const entry  = { id: x.id, term: aspect.replace(/^[CPF]:/, "") };
    if (aspect.startsWith("C:")) goCc.push(entry);
    else if (aspect.startsWith("F:")) goMf.push(entry);
    else if (aspect.startsWith("P:")) goBp.push(entry);
  }

  const diseases: any[] = (raw.comments ?? [])
    .filter((c: any) => c.commentType === "DISEASE")
    .map((c: any) => ({
      id:          c.disease?.diseaseId ?? null,
      name:        c.disease?.diseaseAccession ?? c.disease?.diseaseId ?? null,
      description: c.disease?.description ?? null,
      omim:        c.disease?.diseaseCrossReference?.id ?? null,
    }));

  const subcellular: string[] = (raw.comments ?? [])
    .filter((c: any) => c.commentType === "SUBCELLULAR LOCATION")
    .flatMap((c: any) => (c.subcellularLocations ?? [])
      .map((sl: any) => sl.location?.value).filter(Boolean));

  const keywords = (raw.keywords ?? []).map((k: any) => k.name);
  const features = (raw.features ?? []).map((f: any) => ({
    type:        f.type,
    description: f.description,
    start:       f.location?.start?.value,
    end:         f.location?.end?.value,
  }));

  return {
    accession:      raw.primaryAccession,
    entryName:      raw.uniProtkbId,
    proteinName:    raw.proteinDescription?.recommendedName?.fullName?.value
                    ?? raw.proteinDescription?.submissionNames?.[0]?.fullName?.value
                    ?? null,
    geneName:       raw.genes?.[0]?.geneName?.value ?? null,
    geneNames:      (raw.genes ?? []).map((g: any) => g.geneName?.value).filter(Boolean),
    organism:       raw.organism?.scientificName ?? null,
    taxId:          raw.organism?.taxonId ?? null,
    length:         raw.sequence?.length ?? null,
    sequence:       raw.sequence?.value ?? null,
    reviewed:       raw.entryType === "UniProtKB reviewed (Swiss-Prot)",
    function:       (raw.comments ?? [])
                    .filter((c: any) => c.commentType === "FUNCTION")
                    .map((c: any) => c.texts?.[0]?.value).filter(Boolean).join(" "),
    subcellularLocation: subcellular,
    diseases,
    keywords,
    features,
    pdbIds:    pdbIds.slice(0, 20),
    pdbCount:  pdbIds.length,
    pathways,
    omimIds,
    interpro:  interpro.slice(0, 10),
    go: { cellular_component: goCc, molecular_function: goMf, biological_process: goBp },
    alphafoldId: `AF-${raw.primaryAccession}-F1`,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** Full annotation for one protein. */
router.get("/uniprot/entry/:accession", async (req, res) => {
  const { accession } = req.params;
  try {
    const raw = await upFetch(
      `${UP_BASE}/${encodeURIComponent(accession)}.json` +
      `?fields=accession,id,protein_name,gene_names,organism_name,organism_id,` +
      `length,sequence,reviewed,function,subcellular_location,disease,keyword,` +
      `feature,xref_pdb,xref_reactome,xref_interpro,xref_mim,xref_go`
    );
    res.json(shapedEntry(raw));
  } catch (err: any) {
    const status = err?.status ?? 502;
    res.status(status).json({ error: err?.message ?? "UniProt entry fetch failed", accession });
  }
});

/** FASTA sequence — useful for populating Boltz-2 entity blocks directly. */
router.get("/uniprot/sequence/:accession", async (req, res) => {
  const { accession } = req.params;
  try {
    const resp = await fetch(
      `${UP_BASE}/${encodeURIComponent(accession)}.fasta`,
      { headers: { "User-Agent": "HakaseAI-BioTwin/2.0" }, signal: AbortSignal.timeout(TIMEOUT) }
    );
    if (!resp.ok) { res.status(resp.status).json({ error: `UniProt FASTA ${resp.status}` }); return; }
    const fasta = await resp.text();
    // Extract raw sequence (strip header lines)
    const sequence = fasta.split("\n").filter(l => !l.startsWith(">")).join("").trim();
    res.json({ accession, fasta, sequence });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "UniProt sequence fetch failed" });
  }
});

/** Keyword / gene / disease text search. */
router.get("/uniprot/search", async (req, res) => {
  const query   = req.query.q as string | undefined;
  const organism = req.query.organism as string | undefined;  // e.g. "Homo sapiens"
  const reviewed = req.query.reviewed !== "false";            // default SwissProt only
  const size     = Math.min(25, parseInt((req.query.size as string) ?? "10") || 10);

  if (!query) { res.status(400).json({ error: "Provide ?q=<search term>" }); return; }

  try {
    let qStr = encodeURIComponent(query);
    if (organism) qStr += `+AND+organism_name:"${encodeURIComponent(organism)}"`;
    if (reviewed) qStr += "+AND+reviewed:true";

    const url = `${UP_BASE}/search?query=${qStr}&fields=accession,id,protein_name,gene_names,organism_name,length,reviewed&size=${size}&format=json`;
    const raw = await upFetch(url);
    const results = (raw.results ?? []).map((r: any) => ({
      accession:   r.primaryAccession,
      entryName:   r.uniProtkbId,
      proteinName: r.proteinDescription?.recommendedName?.fullName?.value
                   ?? r.proteinDescription?.submissionNames?.[0]?.fullName?.value ?? null,
      geneName:    r.genes?.[0]?.geneName?.value ?? null,
      organism:    r.organism?.scientificName ?? null,
      length:      r.sequence?.length ?? null,
      reviewed:    r.entryType === "UniProtKB reviewed (Swiss-Prot)",
    }));
    res.json({ query, results, total: raw.results?.length ?? 0 });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "UniProt search failed" });
  }
});

export default router;
