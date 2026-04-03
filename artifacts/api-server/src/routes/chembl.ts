import { Router } from "express";

const router = Router();

const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "HakaseAI-BioDigitalTwin/1.0",
};

router.get("/api/chembl/compound", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  if (!smiles) {
    res.status(400).json({ error: "Provide ?smiles=<SMILES>" });
    return;
  }

  try {
    const url = `${CHEMBL_BASE}/molecule.json?molecule_structures__canonical_smiles__flexmatch=${encodeURIComponent(smiles)}&limit=1`;
    const upstream = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `ChEMBL returned ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL compound proxy error" });
  }
});

router.get("/api/chembl/activities", async (req, res) => {
  const chemblId = req.query.chembl_id as string | undefined;
  if (!chemblId) {
    res.status(400).json({ error: "Provide ?chembl_id=<CHEMBLXXXXX>" });
    return;
  }

  try {
    const url = `${CHEMBL_BASE}/activity.json?molecule_chembl_id=${encodeURIComponent(chemblId)}&limit=100`;
    const upstream = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `ChEMBL returned ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL activities proxy error" });
  }
});

export default router;
