import { Router } from "express";

const router = Router();

const CCTE_BASE = "https://api-ccte.epa.gov";

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "HakaseAI-BioDigitalTwin/1.0",
  };
  const key = process.env.EPA_CCTE_API_KEY;
  if (key) headers["x-api-key"] = key;
  return headers;
}

router.get("/ccte/resolve", async (req, res) => {
  const inchiKey = req.query.inchikey as string | undefined;
  const name = req.query.name as string | undefined;
  if (!inchiKey && !name) {
    res.status(400).json({ error: "Provide ?inchikey=<key> or ?name=<name>" });
    return;
  }
  try {
    const url = inchiKey
      ? `${CCTE_BASE}/chemical/search/equal/${encodeURIComponent(inchiKey)}`
      : `${CCTE_BASE}/chemical/search/start-with/${encodeURIComponent(name!)}`;
    const upstream = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `CCTE returned ${upstream.status}`, dtxsid: null });
      return;
    }
    const data = (await upstream.json()) as any;
    const first = Array.isArray(data) ? data[0] : (data?.[0] ?? null);
    res.json({ dtxsid: first?.dtxsid ?? null, preferredName: first?.preferredName ?? null, casrn: first?.casrn ?? null });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "CCTE resolve error", dtxsid: null });
  }
});

router.get("/ccte/hazard/:dtxsid", async (req, res) => {
  const dtxsid = req.params.dtxsid;
  if (!dtxsid) { res.status(400).json({ error: "dtxsid required" }); return; }
  try {
    const url = `${CCTE_BASE}/hazard/search/by-dtxsid/${encodeURIComponent(dtxsid)}`;
    const upstream = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(12000) });
    if (upstream.status === 404) { res.json([]); return; }
    if (!upstream.ok) { res.status(upstream.status).json({ error: `CCTE hazard returned ${upstream.status}` }); return; }
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "CCTE hazard proxy error" });
  }
});

router.get("/ccte/chemical/:dtxsid", async (req, res) => {
  const dtxsid = req.params.dtxsid;
  if (!dtxsid) { res.status(400).json({ error: "dtxsid required" }); return; }
  try {
    const url = `${CCTE_BASE}/chemical/detail/search/by-dtxsid/${encodeURIComponent(dtxsid)}`;
    const upstream = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) { res.status(upstream.status).json({ error: `CCTE chemical returned ${upstream.status}` }); return; }
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "CCTE chemical proxy error" });
  }
});

export default router;
