import { Router } from "express";

const router = Router();

const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "HakaseAI-BioDigitalTwin/1.0",
};

router.get("/chembl/compound", async (req, res) => {
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

router.get("/chembl/activities", async (req, res) => {
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

router.get("/chembl/target", async (req, res) => {
  const targetId = req.query.target_chembl_id as string | undefined;
  if (!targetId) {
    res.status(400).json({ error: "Provide ?target_chembl_id=<CHEMBLXXXXX>" });
    return;
  }

  try {
    const url = `${CHEMBL_BASE}/target/${encodeURIComponent(targetId)}.json`;
    const upstream = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `ChEMBL returned ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL target proxy error" });
  }
});

router.get("/chembl/target-search", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  if (!smiles) {
    res.status(400).json({ error: "Provide ?smiles=<SMILES>" });
    return;
  }

  try {
    const compUrl = `${CHEMBL_BASE}/molecule.json?molecule_structures__canonical_smiles__flexmatch=${encodeURIComponent(smiles)}&limit=1`;
    const compRes = await fetch(compUrl, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!compRes.ok) {
      res.json({ targets: [], status: "compound_not_found" });
      return;
    }
    const compData = (await compRes.json()) as { molecules?: any[] };
    const molecules = compData?.molecules ?? [];
    if (!molecules.length) {
      res.json({ targets: [], status: "compound_not_found" });
      return;
    }

    const chemblId = molecules[0].molecule_chembl_id;
    const compoundName = molecules[0].pref_name ?? chemblId;

    const actUrl = `${CHEMBL_BASE}/activity.json?molecule_chembl_id=${encodeURIComponent(chemblId)}&limit=100`;
    const actRes = await fetch(actUrl, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
    if (!actRes.ok) {
      res.json({ targets: [], status: "activities_error", compoundChemblId: chemblId, compoundName });
      return;
    }
    const actData = (await actRes.json()) as { activities?: any[] };
    const rawActivities: any[] = actData?.activities ?? [];

    const targetIds = new Set<string>();
    const targetBestActivity = new Map<string, { name: string; type: string; activityType: string; value_nM: number; pChembl: number | null }>();

    const relevantTypes = ["IC50", "KI", "KD", "EC50", "INHIBITION", "ACTIVITY"];
    for (const act of rawActivities) {
      const tid = act.target_chembl_id;
      const tname = act.target_pref_name;
      if (!tid || !tname) continue;

      const actType = (act.standard_type ?? "").toUpperCase();
      if (!relevantTypes.some(t => actType.includes(t))) continue;

      let valueNm: number | null = null;
      const rawVal = act.standard_value;
      const units = act.standard_units;
      if (rawVal != null) {
        const n = parseFloat(String(rawVal));
        if (!isNaN(n) && n > 0) {
          if (units === "uM" || units === "µM") valueNm = n * 1000;
          else if (units === "pM") valueNm = n / 1000;
          else valueNm = n;
        }
      }
      if (valueNm == null) continue;

      targetIds.add(tid);
      const existing = targetBestActivity.get(tid);
      if (!existing || existing.value_nM > valueNm) {
        targetBestActivity.set(tid, {
          name: tname,
          type: act.target_type ?? "SINGLE PROTEIN",
          activityType: act.standard_type ?? actType,
          value_nM: valueNm,
          pChembl: act.pchembl_value != null ? parseFloat(act.pchembl_value) : null,
        });
      }
    }

    const targetChemblIds = Array.from(targetIds);
    const targetDetails: any[] = [];

    const batchSize = 5;
    for (let i = 0; i < targetChemblIds.length && i < 15; i += batchSize) {
      const batch = targetChemblIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (tid) => {
          const tUrl = `${CHEMBL_BASE}/target/${encodeURIComponent(tid)}.json`;
          const tRes = await fetch(tUrl, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
          if (!tRes.ok) return null;
          return tRes.json();
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) targetDetails.push(r.value);
      }
    }

    const uniprotMap = new Map<string, string>();
    for (const td of targetDetails) {
      const chemblTargetId = td.target_chembl_id;
      const components = td.target_components ?? [];
      for (const comp of components) {
        const xrefs = comp.target_component_xrefs ?? [];
        for (const xref of xrefs) {
          if (xref.xref_src_db === "UniProt" && xref.xref_id) {
            uniprotMap.set(chemblTargetId, xref.xref_id);
            break;
          }
        }
      }
    }

    const targets = Array.from(targetBestActivity.entries())
      .map(([tid, info]) => ({
        targetChemblId: tid,
        targetName: info.name,
        targetType: info.type,
        uniprotId: uniprotMap.get(tid) ?? null,
        bestActivityType: info.activityType,
        bestValue_nM: info.value_nM,
        pChembl: info.pChembl,
      }))
      .sort((a, b) => a.bestValue_nM - b.bestValue_nM);

    res.json({
      compoundChemblId: chemblId,
      compoundName,
      targets,
      status: targets.length > 0 ? "found" : "no_targets",
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL target-search proxy error" });
  }
});

export default router;
