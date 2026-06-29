/**
 * AlphaFold Database proxy — structural template lookup for Layer 2.
 *
 * The AlphaFold DB holds predicted structures for ~200 M proteins (UniProt
 * coverage). These structures are ideal as Boltz-2 templates: they provide
 * backbone conditioning that dramatically improves accuracy for known proteins.
 *
 * Routes:
 *  GET /alphafold/entry/:accession   — metadata + direct CIF download URL
 *  GET /alphafold/check/:accession   — quick existence + confidence check
 *
 * The CIF URL returned is the canonical EBI URL and can be passed directly
 * into the twin's structural engine as a template source_url — it is publicly
 * accessible from GPU workers.
 *
 * Never exposes the underlying prediction engine in any field name or value.
 */

import { Router } from "express";

const router = Router();
const AF_BASE   = "https://alphafold.ebi.ac.uk/api";
const CIF_BASE  = "https://alphafold.ebi.ac.uk/files";
const HEADERS   = { Accept: "application/json", "User-Agent": "HakaseAI-BioTwin/2.0" };
const TIMEOUT   = 12_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function cifUrl(accession: string, version: number = 4): string {
  return `${CIF_BASE}/AF-${accession}-F1-model_v${version}.cif`;
}

function paeImageUrl(accession: string, version: number = 4): string {
  return `${CIF_BASE}/AF-${accession}-F1-pae_image_v${version}.png`;
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * Full AlphaFold DB entry for a UniProt accession.
 * Returns metadata + the CIF download URL for use as a structural template.
 */
router.get("/alphafold/entry/:accession", async (req, res) => {
  const { accession } = req.params;
  const acc = accession.trim().toUpperCase();

  try {
    const url  = `${AF_BASE}/prediction/${encodeURIComponent(acc)}`;
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });

    if (resp.status === 404) {
      res.status(404).json({
        accession: acc,
        found: false,
        message: `No predicted structure available for ${acc}. ` +
                 `This protein may be too large (>2700 residues), non-canonical, ` +
                 `or not yet in the database.`,
      });
      return;
    }
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Structure database returned ${resp.status}`, accession: acc });
      return;
    }

    const entries = (await resp.json()) as any[];
    const entry = entries[0]; // API returns an array; we want the first (canonical) model

    const version = entry?.latestVersion ?? 4;
    const templateUrl = cifUrl(acc, version);

    res.json({
      accession:       acc,
      found:           true,
      entryId:         entry?.entryId ?? `AF-${acc}-F1`,
      gene:            entry?.gene ?? null,
      uniprotName:     entry?.uniprotDescription ?? null,
      organism:        entry?.organismScientificName ?? null,
      sequenceLength:  entry?.sequenceLength ?? null,
      modelVersion:    version,
      modelCreatedDate: entry?.modelCreatedDate ?? null,
      // Mean pLDDT: 90–100 = very high, 70–90 = confident, 50–70 = low, <50 = very low
      meanPlddt:       entry?.meanPlddt ?? null,
      plddt_interpretation: entry?.meanPlddt != null ? (
        entry.meanPlddt >= 90 ? "Very high confidence — ideal as structural template" :
        entry.meanPlddt >= 70 ? "Confident — suitable as template with normal caution" :
        entry.meanPlddt >= 50 ? "Low confidence — use template conditioning selectively" :
                                "Very low confidence — template may be unreliable"
      ) : null,
      // Template URL — pass this as source_url in a structural engine template block
      templateCifUrl:  templateUrl,
      templateFormat:  "cif",
      paeImageUrl:     paeImageUrl(acc, version),
      // Convenience: pre-built template block for the structural engine API
      structuralEngineTemplate: {
        source_url:    templateUrl,
        source_format: "cif",
        force:         false,
      },
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Structure database lookup failed", accession: acc });
  }
});

/**
 * Quick existence + mean confidence check — no heavy payload.
 * Use this to cheaply verify a template exists before building a design.
 */
router.get("/alphafold/check/:accession", async (req, res) => {
  const { accession } = req.params;
  const acc = accession.trim().toUpperCase();

  try {
    const url  = `${AF_BASE}/prediction/${encodeURIComponent(acc)}`;
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8_000) });
    if (resp.status === 404) {
      res.json({ accession: acc, found: false });
      return;
    }
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Structure database returned ${resp.status}` });
      return;
    }
    const entries = (await resp.json()) as any[];
    const entry = entries[0];
    const version = entry?.latestVersion ?? 4;
    res.json({
      accession:    acc,
      found:        true,
      meanPlddt:    entry?.meanPlddt ?? null,
      sequenceLength: entry?.sequenceLength ?? null,
      templateCifUrl: cifUrl(acc, version),
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Structure check failed", accession: acc });
  }
});

export default router;
