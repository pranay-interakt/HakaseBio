// ── BindingDB Proxy ────────────────────────────────────────────────────────
// BindingDB blocks browser fetch (CORS). This proxy forwards the request
// server-side using native fetch (Node 18+).

import { Router } from "express";

const router = Router();

router.get("/bindingdb", async (req, res) => {
  const uniprot = req.query.uniprot as string | undefined;
  const smiles  = req.query.smiles  as string | undefined;

  if (!uniprot && !smiles) {
    res.status(400).json({ error: "Provide ?uniprot=<ID> or ?smiles=<SMILES>" });
    return;
  }

  try {
    let url: string;
    if (uniprot) {
      url = `https://www.bindingdb.org/rest/json/getLigandsByUniprot/${encodeURIComponent(uniprot)}`;
    } else {
      url = `https://www.bindingdb.org/rest/json/getLigandsBySMILES?smiles=${encodeURIComponent(smiles!)}&cutoff=0.8&max=20`;
    }

    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "HakaseAI-BioDigitalTwin/1.0",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `BindingDB returned ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "BindingDB proxy error" });
  }
});

export default router;
