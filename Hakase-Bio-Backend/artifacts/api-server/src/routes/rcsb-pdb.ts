/**
 * RCSB PDB proxy — crystal structure data for Layer 1 + structural templates.
 *
 * Crystal structures are the highest-confidence structural templates for the
 * twin's structural engine because they are experimentally determined.
 * This route surfaces:
 *  - Structure metadata (resolution, method, deposition date, ligands)
 *  - Polymer chain summary (sequence, organism, UniProt mapping)
 *  - Direct CIF download URL for use as a structural engine template
 *  - Text search across PDB entries by protein name / gene / UniProt
 *
 * Routes:
 *  GET /rcsb/entry/:pdbId          — structure metadata + template URL
 *  GET /rcsb/search                — text / gene / UniProt search
 *  GET /rcsb/ligands/:pdbId        — ligands in a structure (for binding site info)
 */

import { Router } from "express";

const router   = Router();
const DATA_API = "https://data.rcsb.org/rest/v1/core";
const SEARCH   = "https://search.rcsb.org/rcsbsearch/v2/query";
const FILES    = "https://files.rcsb.org/download";
const HEADERS  = { Accept: "application/json", "User-Agent": "HakaseAI-BioTwin/2.0" };
const TIMEOUT  = 12_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function rcsbFetch(url: string): Promise<any> {
  const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
  if (resp.status === 404) return null;
  if (!resp.ok) throw Object.assign(new Error(`RCSB HTTP ${resp.status}`), { status: resp.status });
  return resp.json();
}

function cifDownloadUrl(pdbId: string): string {
  return `${FILES}/${pdbId.toUpperCase()}.cif`;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** Full metadata for one PDB entry + template URL. */
router.get("/rcsb/entry/:pdbId", async (req, res) => {
  const pdbId = req.params.pdbId.toUpperCase().slice(0, 8);

  try {
    const [entryData, polymerData] = await Promise.all([
      rcsbFetch(`${DATA_API}/entry/${pdbId}`),
      rcsbFetch(`${DATA_API}/entry/${pdbId}/polymer_entities`),
    ]);

    if (!entryData) { res.status(404).json({ found: false, pdbId }); return; }

    const exptl      = entryData.exptl?.[0] ?? {};
    const refine     = entryData.refine?.[0] ?? {};
    const cell       = entryData.cell ?? {};
    const struct     = entryData.struct ?? {};
    const rcsb       = entryData.rcsb_entry_info ?? {};
    const audit      = (entryData.audit_author ?? []).map((a: any) => a.name);

    // Polymer chain summary (which proteins/sequences are in this structure)
    const chains = (polymerData ?? []).map((pe: any) => {
      const entity = pe.entity_poly ?? {};
      const uniprots = (pe.rcsb_polymer_entity_container_identifiers?.uniprot_ids ?? []);
      return {
        entityId:     pe.rcsb_id,
        type:         entity.type,
        sequence:     entity.pdbx_seq_one_letter_code_can ?? null,
        length:       entity.rcsb_sample_sequence_length ?? null,
        organism:     pe.rcsb_entity_source_organism?.[0]?.scientific_name ?? null,
        uniprotIds:   uniprots,
        description:  pe.rcsb_polymer_entity?.pdbx_description ?? null,
      };
    });

    res.json({
      pdbId,
      found:         true,
      title:         struct.title ?? null,
      description:   struct.pdbx_descriptor ?? null,
      resolution:    refine.ls_d_res_high ?? rcsb.resolution_combined?.[0] ?? null,
      method:        exptl.method ?? rcsb.experimental_method ?? null,
      depositionDate: entryData.rcsb_accession_info?.deposit_date ?? null,
      releaseDate:    entryData.rcsb_accession_info?.initial_release_date ?? null,
      authors:        audit,
      nChains:        rcsb.polymer_entity_count ?? null,
      nAtoms:         rcsb.deposited_atom_count ?? null,
      nResidues:      rcsb.deposited_polymer_monomer_count ?? null,
      hasFreeRFactor: refine.ls_rfactor_rfree != null,
      rFactor:        refine.ls_rfactor_obs ?? null,
      rFree:          refine.ls_rfactor_rfree ?? null,
      spaceGroup:     cell.angle_beta != null ? `${entryData.symmetry?.space_group_name_hm ?? "?"}` : null,
      chains,
      // Template URL — pass as source_url in a structural engine template block
      templateCifUrl:   cifDownloadUrl(pdbId),
      templateFormat:   "cif",
      rcsbUrl:          `https://www.rcsb.org/structure/${pdbId}`,
      // Convenience: pre-built template block for the structural engine API
      structuralEngineTemplate: {
        source_url:    cifDownloadUrl(pdbId),
        source_format: "cif",
        force:         false,
      },
    });
  } catch (err: any) {
    res.status(err?.status ?? 502).json({ error: err?.message ?? "RCSB entry fetch failed", pdbId });
  }
});

/** Text / gene / UniProt search over PDB entries. */
router.get("/rcsb/search", async (req, res) => {
  const q          = req.query.q as string | undefined;
  const uniprotId  = req.query.uniprot as string | undefined;
  const maxResults = Math.min(20, parseInt((req.query.limit as string) ?? "10") || 10);

  if (!q && !uniprotId) {
    res.status(400).json({ error: "Provide ?q=<text> or ?uniprot=<accession>" }); return;
  }

  // Build RCSB search JSON query
  let queryNode: any;
  if (uniprotId) {
    queryNode = {
      type:    "terminal",
      service: "text",
      parameters: {
        attribute:   "rcsb_polymer_entity_container_identifiers.uniprot_ids",
        operator:    "in",
        negation:    false,
        value:       [uniprotId.toUpperCase()],
      },
    };
  } else {
    queryNode = {
      type:    "terminal",
      service: "full_text",
      parameters: { value: q },
    };
  }

  const payload = {
    query: queryNode,
    return_type: "entry",
    request_options: {
      paginate: { start: 0, rows: maxResults },
      sort:     [{ sort_by: "score", direction: "desc" }],
      scoring_strategy: "combined",
    },
    // Minimal set of fields for the results panel
    request_info: { query_id: "hakase_pdb_search" },
  };

  try {
    const resp = await fetch(SEARCH, {
      method:  "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) {
      res.status(resp.status).json({ error: `RCSB search HTTP ${resp.status}`, results: [] }); return;
    }
    const data = (await resp.json()) as any;
    const hits  = (data.result_set ?? []) as any[];
    const total = data.total_count ?? 0;

    // Fetch brief metadata for top hits in parallel
    const details = await Promise.allSettled(
      hits.slice(0, maxResults).map(async (h: any) => {
        const pdbId = h.identifier;
        const d = await rcsbFetch(`${DATA_API}/entry/${pdbId}`) as any;
        if (!d) return null;
        return {
          pdbId,
          title:          d.struct?.title ?? null,
          method:         d.exptl?.[0]?.method ?? null,
          resolution:     d.refine?.[0]?.ls_d_res_high ?? d.rcsb_entry_info?.resolution_combined?.[0] ?? null,
          releaseDate:    d.rcsb_accession_info?.initial_release_date ?? null,
          score:          h.score,
          templateCifUrl: cifDownloadUrl(pdbId),
          rcsbUrl:        `https://www.rcsb.org/structure/${pdbId}`,
        };
      })
    );

    const results = (details as PromiseSettledResult<any>[])
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled" && r.value != null)
      .map((r: PromiseFulfilledResult<any>) => r.value);

    res.json({ query: q ?? `uniprot:${uniprotId}`, total, results });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "RCSB search failed" });
  }
});

/** Ligands present in a PDB structure — useful for binding site context. */
router.get("/rcsb/ligands/:pdbId", async (req, res) => {
  const pdbId = req.params.pdbId.toUpperCase().slice(0, 8);

  try {
    const data = await rcsbFetch(`${DATA_API}/entry/${pdbId}/nonpolymer_entities`);
    if (!data) { res.status(404).json({ found: false, pdbId, ligands: [] }); return; }

    const ligands = (data ?? []).map((lig: any) => ({
      entityId:     lig.rcsb_id,
      name:         lig.rcsb_nonpolymer_entity?.pdbx_description ?? null,
      ccdId:        lig.pdbx_entity_nonpoly?.comp_id ?? null,
      formula:      lig.rcsb_nonpolymer_entity?.formula ?? null,
      mw:           lig.rcsb_nonpolymer_entity?.formula_weight ?? null,
    })).filter((l: any) => l.ccdId && l.ccdId !== "HOH"); // exclude water

    res.json({ pdbId, found: true, ligands, count: ligands.length });
  } catch (err: any) {
    res.status(err?.status ?? 502).json({ error: err?.message ?? "RCSB ligands fetch failed", pdbId });
  }
});

export default router;
