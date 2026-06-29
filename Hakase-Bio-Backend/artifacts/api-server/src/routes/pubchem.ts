/**
 * PubChem PUG REST proxy — compound data for Layer 1 enrichment.
 *
 * Routes:
 *  GET /pubchem/compound/smiles      — lookup by SMILES → CID + properties
 *  GET /pubchem/compound/name        — lookup by compound name → CID + properties
 *  GET /pubchem/compound/:cid        — lookup by CID
 *  GET /pubchem/compound/:cid/assays — bioassay activity summary for a compound
 *  GET /pubchem/similar              — similar compound search by SMILES
 *
 * Enriches Layer 1 with:
 *  - Canonical SMILES, InChIKey for cross-referencing
 *  - Physicochemical properties from PubChem Compound
 *  - Bioassay activity data (experimental confirmations)
 *  - Similar compound suggestions for SAR exploration
 */

import { Router } from "express";

const router  = Router();
const PUG     = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const HEADERS = { Accept: "application/json", "User-Agent": "HakaseAI-BioTwin/2.0" };
const TIMEOUT = 15_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function pugFetch(path: string): Promise<any> {
  const resp = await fetch(`${PUG}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT) });
  if (resp.status === 404) return null;
  if (!resp.ok) throw Object.assign(new Error(`PubChem HTTP ${resp.status}`), { status: resp.status });
  return resp.json();
}

const PROPERTY_LIST = [
  "MolecularFormula", "MolecularWeight", "CanonicalSMILES", "IsomericSMILES",
  "InChI", "InChIKey", "IUPACName", "XLogP", "TPSA", "HBondDonorCount",
  "HBondAcceptorCount", "RotatableBondCount", "HeavyAtomCount",
  "Complexity", "Charge", "MonoisotopicMass",
].join(",");

function shapedCompound(props: any, cid: number) {
  return {
    cid,
    pubchemUrl:         `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
    iupacName:          props.IUPACName ?? null,
    canonicalSmiles:    props.CanonicalSMILES ?? null,
    isomericSmiles:     props.IsomericSMILES ?? null,
    inchiKey:           props.InChIKey ?? null,
    inchi:              props.InChI ?? null,
    molecularFormula:   props.MolecularFormula ?? null,
    molecularWeight:    props.MolecularWeight != null ? parseFloat(props.MolecularWeight) : null,
    monoisotopicMass:   props.MonoisotopicMass != null ? parseFloat(props.MonoisotopicMass) : null,
    xLogP:              props.XLogP != null ? parseFloat(props.XLogP) : null,
    tpsa:               props.TPSA != null ? parseFloat(props.TPSA) : null,
    hBondDonors:        props.HBondDonorCount ?? null,
    hBondAcceptors:     props.HBondAcceptorCount ?? null,
    rotatableBonds:     props.RotatableBondCount ?? null,
    heavyAtomCount:     props.HeavyAtomCount ?? null,
    complexity:         props.Complexity != null ? parseFloat(props.Complexity) : null,
    formalCharge:       props.Charge ?? null,
    // Quick Lipinski flags (computed here, not from PubChem)
    lipinskiCompliant:  (
      (props.MolecularWeight ?? 9999) <= 500 &&
      (props.XLogP ?? 99) <= 5 &&
      (props.HBondDonorCount ?? 99) <= 5 &&
      (props.HBondAcceptorCount ?? 99) <= 10
    ),
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** Look up a compound by SMILES → returns CID + full property set. */
router.get("/pubchem/compound/smiles", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  if (!smiles) { res.status(400).json({ error: "Provide ?smiles=<SMILES>" }); return; }

  try {
    const encodedSmiles = encodeURIComponent(smiles);
    // Step 1: resolve to CID
    const cidData = await pugFetch(`/compound/smiles/cids/JSON?smiles=${encodedSmiles}`);
    if (!cidData) { res.json({ found: false, smiles }); return; }
    const cid: number = cidData.IdentifierList?.CID?.[0];
    if (!cid) { res.json({ found: false, smiles }); return; }

    // Step 2: fetch properties
    const propData = await pugFetch(`/compound/cid/${cid}/property/${PROPERTY_LIST}/JSON`);
    const props = propData?.PropertyTable?.Properties?.[0] ?? {};
    res.json({ found: true, smiles, ...shapedCompound(props, cid) });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "PubChem compound lookup failed" });
  }
});

/** Look up a compound by name (drug name, trade name, etc.). */
router.get("/pubchem/compound/name", async (req, res) => {
  const name = req.query.name as string | undefined;
  if (!name) { res.status(400).json({ error: "Provide ?name=<compound name>" }); return; }

  try {
    const cidData = await pugFetch(`/compound/name/${encodeURIComponent(name)}/cids/JSON`);
    if (!cidData) { res.json({ found: false, name }); return; }
    const cid: number = cidData.IdentifierList?.CID?.[0];
    if (!cid) { res.json({ found: false, name }); return; }

    const propData = await pugFetch(`/compound/cid/${cid}/property/${PROPERTY_LIST}/JSON`);
    const props = propData?.PropertyTable?.Properties?.[0] ?? {};
    res.json({ found: true, name, ...shapedCompound(props, cid) });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "PubChem name lookup failed" });
  }
});

/** Look up a compound by CID directly. */
router.get("/pubchem/compound/:cid", async (req, res) => {
  const cid = parseInt(req.params.cid);
  if (isNaN(cid) || cid < 1) { res.status(400).json({ error: "Invalid CID" }); return; }

  try {
    const propData = await pugFetch(`/compound/cid/${cid}/property/${PROPERTY_LIST}/JSON`);
    if (!propData) { res.status(404).json({ found: false, cid }); return; }
    const props = propData?.PropertyTable?.Properties?.[0] ?? {};
    res.json({ found: true, ...shapedCompound(props, cid) });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "PubChem CID lookup failed" });
  }
});

/** Bioassay activity summary for a compound — experimental confirmation data. */
router.get("/pubchem/compound/:cid/assays", async (req, res) => {
  const cid  = parseInt(req.params.cid);
  const type = (req.query.type as string ?? "active").toLowerCase(); // active | all
  if (isNaN(cid) || cid < 1) { res.status(400).json({ error: "Invalid CID" }); return; }

  try {
    // Fetch bioassay summary from PubChem
    const outcome = type === "active" ? "active" : undefined;
    const outcomeParam = outcome ? `&activity_outcome_method=${outcome}` : "";
    const data = await pugFetch(
      `/compound/cid/${cid}/assaysummary/JSON?limit=50${outcomeParam}`
    );
    if (!data) { res.json({ cid, assays: [], total: 0 }); return; }

    const table = data.Table ?? {};
    const columns: string[] = (table.Columns?.Column ?? []).map((c: any) => c);
    const rows: any[]       = table.Row ?? [];

    const colIdx = (name: string) => columns.indexOf(name);
    const aIdx   = colIdx("AID");
    const nameIdx = colIdx("Assay Name");
    const outIdx  = colIdx("Bioactivity Outcome");
    const typeIdx = colIdx("Target Type");
    const tNameIdx = colIdx("Target Name");
    const acIdx   = colIdx("Active Concentration (µM)");

    const assays = rows.map((r: any) => {
      const cells = r.Cell ?? [];
      return {
        aid:          cells[aIdx]    ?? null,
        name:         cells[nameIdx] ?? null,
        outcome:      cells[outIdx]  ?? null,
        targetType:   cells[typeIdx] ?? null,
        targetName:   cells[tNameIdx] ?? null,
        activeConcUm: cells[acIdx]   ? parseFloat(cells[acIdx]) : null,
        pubchemUrl:   cells[aIdx] ? `https://pubchem.ncbi.nlm.nih.gov/bioassay/${cells[aIdx]}` : null,
      };
    }).filter((a: any) => a.outcome === "Active" || type !== "active");

    res.json({ cid, assays, total: assays.length, type });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "PubChem assay fetch failed" });
  }
});

/** Similar compound search by SMILES — for SAR and scaffold hopping. */
router.get("/pubchem/similar", async (req, res) => {
  const smiles     = req.query.smiles as string | undefined;
  const threshold  = Math.max(50, Math.min(100, parseInt((req.query.threshold as string) ?? "85")));
  const maxResults = Math.min(20, parseInt((req.query.limit as string) ?? "10") || 10);

  if (!smiles) { res.status(400).json({ error: "Provide ?smiles=<SMILES>" }); return; }

  try {
    // PubChem 2D similarity search
    const listKeyData = await pugFetch(
      `/compound/fastsimilarity_2d/smiles/cids/JSON?smiles=${encodeURIComponent(smiles)}` +
      `&Threshold=${threshold}&MaxRecords=${maxResults}`
    );
    if (!listKeyData) { res.json({ smiles, similar: [], total: 0 }); return; }

    const cids: number[] = listKeyData.IdentifierList?.CID ?? [];
    if (!cids.length) { res.json({ smiles, similar: [], total: 0 }); return; }

    // Fetch properties for all CIDs in one batch call
    const propData = await pugFetch(
      `/compound/cid/${cids.slice(0, maxResults).join(",")}/property/${PROPERTY_LIST}/JSON`
    );
    const props: any[] = propData?.PropertyTable?.Properties ?? [];
    const similar = props.map((p: any) => shapedCompound(p, p.CID));

    res.json({ smiles, threshold, similar, total: similar.length });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "PubChem similarity search failed" });
  }
});

export default router;
