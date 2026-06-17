/**
 * Preclinical trusted-source proxies — server-side so the browser never hits
 * CORS. Mirrors the pubchem/chembl proxy pattern.
 *
 * Routes:
 *   GET /preclinical/pharos?q=<gene symbol | UniProt>  — NCATS Pharos TDL
 *   GET /preclinical/dailymed?name=<drug/ingredient>    — official FDA SPL labels
 *
 * Each returns a shaped, honest envelope: { found, ... } on success, or a 502
 * with an error string the client surfaces (never a fabricated value).
 */
import { Router } from "express";

const router = Router();
const PHAROS = "https://pharos-api.ncats.io/graphql";
const DAILYMED = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json";
const TIMEOUT = 15_000;

/** UniProt accession shape (covers the standard 6- and 10-char forms). */
function isUniProt(s: string): boolean {
  return /^[OPQ][0-9][A-Z0-9]{3}[0-9]$|^[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2}$/.test(s.toUpperCase());
}

/** NCATS Pharos — Target Development Level (Tclin/Tchem/Tbio/Tdark). */
router.get("/preclinical/pharos", async (req, res) => {
  const q = ((req.query.q as string) ?? "").trim();
  if (!q || q === "—") { res.status(400).json({ error: "Provide ?q=<gene symbol or UniProt>" }); return; }
  const field = isUniProt(q) ? "uniprot" : "sym";
  const query = `{ target(q:{ ${field}:"${q.replace(/"/g, "")}" }) { name sym tdl fam novelty } }`;
  try {
    const r = await fetch(PHAROS, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "HakaseAI-BioTwin/2.0" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) { res.status(502).json({ error: `Pharos HTTP ${r.status}` }); return; }
    const j: any = await r.json();
    const t = j?.data?.target;
    if (!t) { res.json({ found: false, q, queriedBy: field }); return; }
    res.json({
      found: true,
      queriedBy: field,
      name: t.name ?? null,
      sym: t.sym ?? null,
      tdl: t.tdl ?? null,
      family: t.fam ?? null,
      novelty: typeof t.novelty === "number" ? +t.novelty.toFixed(2) : null,
      url: t.sym ? `https://pharos.ncats.io/targets/${encodeURIComponent(t.sym)}` : "https://pharos.ncats.io",
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Pharos lookup failed" });
  }
});

/** DailyMed — official FDA Structured Product Labels (SPL). */
router.get("/preclinical/dailymed", async (req, res) => {
  const name = ((req.query.name as string) ?? "").trim();
  if (!name) { res.status(400).json({ error: "Provide ?name=<drug/ingredient>" }); return; }
  try {
    const r = await fetch(`${DAILYMED}?drug_name=${encodeURIComponent(name)}&pagesize=1`, {
      headers: { Accept: "application/json", "User-Agent": "HakaseAI-BioTwin/2.0" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) { res.status(502).json({ error: `DailyMed HTTP ${r.status}` }); return; }
    const j: any = await r.json();
    const total: number = j?.metadata?.total_elements ?? 0;
    const first = j?.data?.[0] ?? null;
    res.json({
      found: total > 0 && !!first,
      count: total,
      setId: first?.setid ?? null,
      title: first?.title ?? null,
      url: first?.setid ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${first.setid}` : "https://dailymed.nlm.nih.gov",
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "DailyMed lookup failed" });
  }
});

export default router;
