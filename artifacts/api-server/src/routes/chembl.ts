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

// Animal-PK: filter ADME assays by animal organism, then fetch activities.
// Two-step pattern (more reliable than activity?target_organism__in=…).
router.get("/chembl/animal-pk", async (req, res) => {
  const chemblId = req.query.chembl_id as string | undefined;
  if (!chemblId) { res.status(400).json({ error: "Provide ?chembl_id=<CHEMBLXXXXX>" }); return; }
  const SPECIES = ["Rattus norvegicus", "Canis lupus familiaris", "Macaca fascicularis", "Mus musculus"];
  try {
    const perSpecies = await Promise.all(SPECIES.map(async (organism) => {
      const assayUrl = `${CHEMBL_BASE}/assay.json?assay_organism=${encodeURIComponent(organism)}&assay_type=A&limit=50`;
      const aRes = await fetch(assayUrl, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
      if (!aRes.ok) return { organism, records: [] as any[] };
      const aData = (await aRes.json()) as { assays?: any[] };
      const assayIds: string[] = (aData?.assays ?? []).map((a: any) => a.assay_chembl_id).filter(Boolean);
      if (!assayIds.length) return { organism, records: [] as any[] };
      // Fetch activities for this molecule across these assays
      const ids = assayIds.slice(0, 30).join(",");
      const actUrl = `${CHEMBL_BASE}/activity.json?molecule_chembl_id=${encodeURIComponent(chemblId)}&assay_chembl_id__in=${encodeURIComponent(ids)}&limit=100`;
      const actRes = await fetch(actUrl, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
      if (!actRes.ok) return { organism, records: [] as any[] };
      const actData = (await actRes.json()) as { activities?: any[] };
      const records = (actData?.activities ?? [])
        .filter((act: any) => {
          if (act.standard_value == null) return false;
          const n = parseFloat(String(act.standard_value));
          return !isNaN(n) && n > 0;
        })
        .map((act: any) => ({
          assayId: act.assay_chembl_id,
          species: organism,
          standardType: act.standard_type ?? "",
          standardValue: parseFloat(String(act.standard_value)),
          standardUnits: act.standard_units ?? "",
          relation: act.standard_relation ?? "=",
        }));
      return { organism, records };
    }));
    const all = perSpecies.flatMap(s => s.records);
    res.json({ chemblId, totalRecords: all.length, records: all });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL animal-pk proxy error" });
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

// ─── Similarity-based target prediction ────────────────────────────────────
// For novel compounds: find structurally similar known molecules in ChEMBL,
// aggregate their measured targets weighted by (similarity × potency).
// Enriches each predicted target with UniProt accession + PDB structure IDs.
router.get("/chembl/similar-targets", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  const threshold = Math.max(40, Math.min(100, parseInt((req.query.threshold as string) ?? "70")));
  const maxSimilar = Math.max(5, Math.min(50, parseInt((req.query.limit as string) ?? "25")));

  if (!smiles) {
    res.status(400).json({ error: "Provide ?smiles=<SMILES>" });
    return;
  }

  try {
    // 1. Similarity search
    const simUrl = `${CHEMBL_BASE}/similarity/${encodeURIComponent(smiles)}/${threshold}.json?limit=${maxSimilar}`;
    const simRes = await fetch(simUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!simRes.ok) {
      res.json({ similarCompounds: [], targets: [], threshold, status: "no_similar" });
      return;
    }
    const simData = (await simRes.json()) as { molecules?: any[] };
    const similarCompounds = (simData?.molecules ?? []).map(m => ({
      chemblId: m.molecule_chembl_id,
      name: m.pref_name ?? m.molecule_chembl_id,
      similarity: parseFloat(String(m.similarity ?? 0)),
    })).filter(c => c.chemblId && c.similarity >= threshold);

    if (similarCompounds.length === 0) {
      res.json({ similarCompounds: [], targets: [], threshold, status: "no_similar" });
      return;
    }

    // 2. Fetch activities for top similar compounds in parallel batches
    const targetAgg = new Map<string, {
      name: string;
      type: string;
      bestActivityType: string;
      bestValue_nM: number;
      bestPChembl: number | null;
      sourceChemblIds: Set<string>; // distinct similar compounds hitting this target
      similarityWeighted: number;   // Σ (similarity × pIC50) over distinct (target, source) pairs
      bestSimilarity: number;
      bestSourceChemblId: string;
      bestSourceName: string;
      _seenSourceWeights: Set<string>; // track (tid, sourceChemblId) to dedupe weight contributions
    }>();

    const relevantTypes = ["IC50", "KI", "KD", "EC50"];
    const BATCH = 5;
    for (let i = 0; i < similarCompounds.length; i += BATCH) {
      const batch = similarCompounds.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (cmp) => {
          const aUrl = `${CHEMBL_BASE}/activity.json?molecule_chembl_id=${encodeURIComponent(cmp.chemblId)}&limit=50`;
          const aRes = await fetch(aUrl, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
          if (!aRes.ok) return { cmp, activities: [] };
          const aData = (await aRes.json()) as { activities?: any[] };
          return { cmp, activities: aData?.activities ?? [] };
        })
      );

      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { cmp, activities } = r.value;
        const sim01 = cmp.similarity / 100;
        for (const act of activities) {
          const tid = act.target_chembl_id;
          const tname = act.target_pref_name;
          if (!tid || !tname) continue;
          // NOTE: activity payload's target_type is always null; we filter by target_type
          // at the target-detail step below (after we resolve target metadata).
          const actType = (act.standard_type ?? "").toUpperCase();
          if (!relevantTypes.some(t => actType === t)) continue;

          const rawVal = act.standard_value;
          const units = act.standard_units;
          let valueNm: number | null = null;
          if (rawVal != null) {
            const n = parseFloat(String(rawVal));
            if (!isNaN(n) && n > 0) {
              if (units === "uM" || units === "µM") valueNm = n * 1000;
              else if (units === "pM") valueNm = n / 1000;
              else if (units === "nM") valueNm = n;
            }
          }
          if (valueNm == null || valueNm > 1e6) continue;

          const pchembl = act.pchembl_value != null ? parseFloat(act.pchembl_value) : (9 - Math.log10(valueNm));
          const sourceKey = `${tid}::${cmp.chemblId}`;
          const existing = targetAgg.get(tid);
          if (!existing) {
            const sourceIds = new Set<string>([cmp.chemblId]);
            const seenWeights = new Set<string>([sourceKey]);
            targetAgg.set(tid, {
              name: tname,
              type: act.target_type ?? "SINGLE PROTEIN",
              bestActivityType: act.standard_type ?? actType,
              bestValue_nM: valueNm,
              bestPChembl: pchembl,
              sourceChemblIds: sourceIds,
              similarityWeighted: sim01 * pchembl,
              bestSimilarity: cmp.similarity,
              bestSourceChemblId: cmp.chemblId,
              bestSourceName: cmp.name,
              _seenSourceWeights: seenWeights,
            });
          } else {
            existing.sourceChemblIds.add(cmp.chemblId);
            // Only contribute weight once per (target, source) pair to prevent
            // multi-row activity entries inflating the similarityWeighted score.
            if (!existing._seenSourceWeights.has(sourceKey)) {
              existing._seenSourceWeights.add(sourceKey);
              existing.similarityWeighted += sim01 * pchembl;
            }
            if (valueNm < existing.bestValue_nM) {
              existing.bestValue_nM = valueNm;
              existing.bestActivityType = act.standard_type ?? actType;
              existing.bestPChembl = pchembl;
            }
            if (cmp.similarity > existing.bestSimilarity) {
              existing.bestSimilarity = cmp.similarity;
              existing.bestSourceChemblId = cmp.chemblId;
              existing.bestSourceName = cmp.name;
            }
          }
        }
      }
    }

    // 3. Rank targets by (distinct-compound-hits) × weighted score → top 10 → resolve UniProt
    const topTargets = Array.from(targetAgg.entries())
      .map(([tid, info]) => ({
        tid,
        ...info,
        hits: info.sourceChemblIds.size,
        score: info.sourceChemblIds.size * info.similarityWeighted,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const targetDetails = await Promise.allSettled(
      topTargets.map(async (t) => {
        const tUrl = `${CHEMBL_BASE}/target/${encodeURIComponent(t.tid)}.json`;
        const tRes = await fetch(tUrl, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
        if (!tRes.ok) return null;
        return tRes.json();
      })
    );

    const uniprotMap = new Map<string, { uniprot: string; geneName: string | null; organism: string | null }>();
    const targetTypeMap = new Map<string, string>();
    const ALLOWED_TARGET_TYPES = new Set([
      "SINGLE PROTEIN",
      "PROTEIN COMPLEX",
      "PROTEIN FAMILY",
      "PROTEIN-PROTEIN INTERACTION",
      "CHIMERIC PROTEIN",
      "PROTEIN COMPLEX GROUP",
      "SELECTIVITY GROUP",
    ]);
    for (let i = 0; i < topTargets.length; i++) {
      const td = targetDetails[i];
      if (td.status !== "fulfilled" || !td.value) continue;
      const tdv = td.value as any;
      const ttype = (tdv.target_type ?? "").toUpperCase();
      // Filter at the target level — drops CELL-LINE, ORGANISM, TISSUE, UNCHECKED
      if (!ALLOWED_TARGET_TYPES.has(ttype)) continue;
      targetTypeMap.set(topTargets[i].tid, ttype);
      const components = tdv.target_components ?? [];
      for (const comp of components) {
        const xrefs = comp.target_component_xrefs ?? [];
        const upXref = xrefs.find((x: any) => x.xref_src_db === "UniProt");
        if (upXref?.xref_id) {
          uniprotMap.set(topTargets[i].tid, {
            uniprot: upXref.xref_id,
            geneName: comp.component_synonyms?.find((s: any) => s.syn_type === "GENE_SYMBOL")?.component_synonym ?? null,
            organism: comp.organism ?? null,
          });
          break;
        }
      }
    }

    // 4. Enrich with PDB IDs via UniProt cross-references (parallel)
    const uniprotAccessions = Array.from(new Set(Array.from(uniprotMap.values()).map(v => v.uniprot)));
    const pdbByUniprot = new Map<string, string[]>();
    if (uniprotAccessions.length > 0) {
      const pdbResults = await Promise.allSettled(
        uniprotAccessions.map(async (acc) => {
          const upUrl = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(acc)}.json?fields=xref_pdb`;
          const upRes = await fetch(upUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
          if (!upRes.ok) return { acc, pdbs: [] as string[] };
          const upData = await upRes.json() as any;
          const xrefs = (upData?.uniProtKBCrossReferences ?? []) as any[];
          const pdbs = xrefs.filter(x => x.database === "PDB").map(x => x.id).filter(Boolean) as string[];
          return { acc, pdbs };
        })
      );
      for (const r of pdbResults) {
        if (r.status === "fulfilled") pdbByUniprot.set(r.value.acc, r.value.pdbs);
      }
    }

    // 5. Compose response — only emit targets that passed type-filter AND resolved a UniProt
    const targets = topTargets
      .filter(t => targetTypeMap.has(t.tid) && uniprotMap.has(t.tid))
      .map(t => {
        const up = uniprotMap.get(t.tid)!;
        const pdbs = pdbByUniprot.get(up.uniprot) ?? [];
        return {
          targetChemblId: t.tid,
          targetName: t.name,
          targetType: targetTypeMap.get(t.tid) ?? t.type,
          uniprotId: up.uniprot,
          geneName: up.geneName,
          organism: up.organism,
          bestActivityType: t.bestActivityType,
          bestValue_nM: Math.round(t.bestValue_nM * 100) / 100,
          bestPChembl: t.bestPChembl != null ? Math.round(t.bestPChembl * 100) / 100 : null,
          hits: t.hits,
          bestSimilarity: t.bestSimilarity,
          bestSourceChemblId: t.bestSourceChemblId,
          bestSourceName: t.bestSourceName,
          pdbIds: pdbs.slice(0, 10),
          pdbCount: pdbs.length,
          confidenceScore: Math.round(t.score * 100) / 100,
        };
      });

    res.json({
      similarCompounds: similarCompounds.slice(0, 10),
      similarCount: similarCompounds.length,
      targets,
      threshold,
      status: targets.length > 0 ? "found" : "no_targets",
      method: "ChEMBL similarity → activity aggregation → UniProt → PDB enrichment",
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL similar-targets proxy error" });
  }
});

// ─── Similarity-based target prediction v2 ─────────────────────────────────
// Same flow as v1, but aggregates ALL valid measurements per target (not just
// "best") and returns a full quality payload: nMeasurements, range_nM,
// geometricMean_nM, species breakdown, assay-type and assay-format breakdown,
// and a derived confidence tier (high|medium|low).
router.get("/chembl/similar-targets/v2", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  const threshold = Math.max(40, Math.min(100, parseInt((req.query.threshold as string) ?? "70")));
  const maxSimilar = Math.max(5, Math.min(50, parseInt((req.query.limit as string) ?? "25")));

  if (!smiles) {
    res.status(400).json({ error: "Provide ?smiles=<SMILES>" });
    return;
  }

  try {
    // 1. Similarity search
    const simUrl = `${CHEMBL_BASE}/similarity/${encodeURIComponent(smiles)}/${threshold}.json?limit=${maxSimilar}`;
    const simRes = await fetch(simUrl, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!simRes.ok) {
      res.json({ similarCompounds: [], targets: [], threshold, status: "no_similar", version: "v2" });
      return;
    }
    const simData = (await simRes.json()) as { molecules?: any[] };
    const similarCompounds = (simData?.molecules ?? []).map(m => ({
      chemblId: m.molecule_chembl_id as string,
      name: (m.pref_name ?? m.molecule_chembl_id) as string,
      similarity: parseFloat(String(m.similarity ?? 0)),
    })).filter(c => c.chemblId && c.similarity >= threshold);

    if (similarCompounds.length === 0) {
      res.json({ similarCompounds: [], targets: [], threshold, status: "no_similar", version: "v2" });
      return;
    }

    const sourceNameById = new Map(similarCompounds.map(c => [c.chemblId, c.name]));

    // 2. Fetch activities & retain ALL valid measurements per target
    interface Measurement {
      value_nM:       number;
      activityType:   string;
      species:        string | null;
      assayType:      string | null; // ChEMBL B/F/A/T/P
      sourceChemblId: string;
      similarity:     number;
      pChembl:        number | null;
    }
    const targetAgg = new Map<string, { name: string; type: string; measurements: Measurement[] }>();

    const relevantTypes = ["IC50", "KI", "KD", "EC50"];
    const BATCH = 5;
    for (let i = 0; i < similarCompounds.length; i += BATCH) {
      const batch = similarCompounds.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (cmp) => {
          const aUrl = `${CHEMBL_BASE}/activity.json?molecule_chembl_id=${encodeURIComponent(cmp.chemblId)}&limit=50`;
          const aRes = await fetch(aUrl, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
          if (!aRes.ok) return { cmp, activities: [] as any[] };
          const aData = (await aRes.json()) as { activities?: any[] };
          return { cmp, activities: aData?.activities ?? [] };
        })
      );

      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { cmp, activities } = r.value;
        for (const act of activities) {
          const tid = act.target_chembl_id as string | undefined;
          const tname = act.target_pref_name as string | undefined;
          if (!tid || !tname) continue;
          const actType = (act.standard_type ?? "").toUpperCase();
          if (!relevantTypes.some(t => actType === t)) continue;

          const rawVal = act.standard_value;
          const units = act.standard_units;
          let valueNm: number | null = null;
          if (rawVal != null) {
            const n = parseFloat(String(rawVal));
            if (!isNaN(n) && n > 0) {
              if (units === "uM" || units === "µM") valueNm = n * 1000;
              else if (units === "pM") valueNm = n / 1000;
              else if (units === "nM") valueNm = n;
            }
          }
          if (valueNm == null || valueNm > 1e6) continue;

          const pchembl = act.pchembl_value != null ? parseFloat(act.pchembl_value) : (9 - Math.log10(valueNm));
          const m: Measurement = {
            value_nM:       valueNm,
            activityType:   act.standard_type ?? actType,
            species:        (act.target_organism ?? null) as string | null,
            assayType:      (act.assay_type ?? null) as string | null,
            sourceChemblId: cmp.chemblId,
            similarity:     cmp.similarity,
            pChembl:        isNaN(pchembl) ? null : pchembl,
          };
          const existing = targetAgg.get(tid);
          if (!existing) {
            targetAgg.set(tid, {
              name: tname,
              type: act.target_type ?? "SINGLE PROTEIN",
              measurements: [m],
            });
          } else {
            existing.measurements.push(m);
          }
        }
      }
    }

    // 3. Rank by (distinct compound hits) × Σ(similarity × bestPChembl per source)
    const topTargets = Array.from(targetAgg.entries())
      .map(([tid, info]) => {
        const sourceMap = new Map<string, { sim: number; bestP: number }>();
        for (const m of info.measurements) {
          const p = m.pChembl ?? 0;
          const cur = sourceMap.get(m.sourceChemblId);
          if (!cur || p > cur.bestP) sourceMap.set(m.sourceChemblId, { sim: m.similarity / 100, bestP: p });
        }
        const distinctSources = sourceMap.size;
        const weighted = Array.from(sourceMap.values()).reduce((acc, v) => acc + v.sim * v.bestP, 0);
        return { tid, info, distinctSources, weighted, score: distinctSources * weighted };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // 4. Resolve UniProt + filter to protein targets via target-detail metadata
    const targetDetails = await Promise.allSettled(
      topTargets.map(async (t) => {
        const tUrl = `${CHEMBL_BASE}/target/${encodeURIComponent(t.tid)}.json`;
        const tRes = await fetch(tUrl, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
        if (!tRes.ok) return null;
        return tRes.json();
      })
    );

    const ALLOWED_TARGET_TYPES = new Set([
      "SINGLE PROTEIN",
      "PROTEIN COMPLEX",
      "PROTEIN FAMILY",
      "PROTEIN-PROTEIN INTERACTION",
      "CHIMERIC PROTEIN",
      "PROTEIN COMPLEX GROUP",
      "SELECTIVITY GROUP",
    ]);
    const uniprotMap = new Map<string, { uniprot: string; geneName: string | null; organism: string | null }>();
    const targetTypeMap = new Map<string, string>();
    for (let i = 0; i < topTargets.length; i++) {
      const td = targetDetails[i];
      if (td.status !== "fulfilled" || !td.value) continue;
      const tdv = td.value as any;
      const ttype = (tdv.target_type ?? "").toUpperCase();
      if (!ALLOWED_TARGET_TYPES.has(ttype)) continue;
      targetTypeMap.set(topTargets[i].tid, ttype);
      const components = tdv.target_components ?? [];
      for (const comp of components) {
        const xrefs = comp.target_component_xrefs ?? [];
        const upXref = xrefs.find((x: any) => x.xref_src_db === "UniProt");
        if (upXref?.xref_id) {
          uniprotMap.set(topTargets[i].tid, {
            uniprot: upXref.xref_id,
            geneName: comp.component_synonyms?.find((s: any) => s.syn_type === "GENE_SYMBOL")?.component_synonym ?? null,
            organism: comp.organism ?? null,
          });
          break;
        }
      }
    }

    // 5. PDB enrichment
    const uniprotAccessions = Array.from(new Set(Array.from(uniprotMap.values()).map(v => v.uniprot)));
    const pdbByUniprot = new Map<string, string[]>();
    if (uniprotAccessions.length > 0) {
      const pdbResults = await Promise.allSettled(
        uniprotAccessions.map(async (acc) => {
          const upUrl = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(acc)}.json?fields=xref_pdb`;
          const upRes = await fetch(upUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
          if (!upRes.ok) return { acc, pdbs: [] as string[] };
          const upData = await upRes.json() as any;
          const xrefs = (upData?.uniProtKBCrossReferences ?? []) as any[];
          const pdbs = xrefs.filter(x => x.database === "PDB").map(x => x.id).filter(Boolean) as string[];
          return { acc, pdbs };
        })
      );
      for (const r of pdbResults) {
        if (r.status === "fulfilled") pdbByUniprot.set(r.value.acc, r.value.pdbs);
      }
    }

    // 6. Build per-target measurement aggregations
    const round = (n: number) => Math.round(n * 100) / 100;
    const targets = topTargets
      .filter(t => targetTypeMap.has(t.tid) && uniprotMap.has(t.tid))
      .map(t => {
        const ms = t.info.measurements;
        const values = ms.map(m => m.value_nM);
        const minV = Math.min(...values);
        const maxV = Math.max(...values);
        const geomean = Math.exp(values.reduce((a, b) => a + Math.log(b), 0) / values.length);

        const speciesCount: Record<string, number> = {};
        const assayTypeCount: Record<string, number> = {};
        const assayFormatCount: Record<string, number> = {};
        for (const m of ms) {
          if (m.species) speciesCount[m.species] = (speciesCount[m.species] ?? 0) + 1;
          assayTypeCount[m.activityType] = (assayTypeCount[m.activityType] ?? 0) + 1;
          if (m.assayType) {
            // ChEMBL assay_type codes: B=Binding, F=Functional, A=ADMET, P=Physico-chem, T=Toxicity, U=Unassigned
            const fmt =
              m.assayType === "B" ? "biochemical" :
              m.assayType === "F" ? "functional"  :
              m.assayType === "A" ? "ADMET"       :
              m.assayType === "T" ? "toxicity"    :
              m.assayType === "P" ? "physchem"    :
              m.assayType === "U" ? "unassigned"  : m.assayType;
            assayFormatCount[fmt] = (assayFormatCount[fmt] ?? 0) + 1;
          }
        }
        const speciesList = Object.keys(speciesCount);

        // Confidence tier:
        //   high   — n ≥ 5, range spread < 100×, ≥50% measurements human, dominant assay type ≥ 60%
        //   medium — n ≥ 3, range spread < 1000×
        //   low    — n < 3 OR range spread ≥ 1000×
        const spread = maxV / Math.max(minV, 0.01);
        const humanShare = (speciesCount["Homo sapiens"] ?? 0) / ms.length;
        const dominantAssayShare = ms.length > 0 ? Math.max(...Object.values(assayTypeCount)) / ms.length : 0;
        let confidence: "high" | "medium" | "low";
        if (ms.length >= 5 && spread < 100 && humanShare >= 0.5 && dominantAssayShare >= 0.6) confidence = "high";
        else if (ms.length >= 3 && spread < 1000) confidence = "medium";
        else confidence = "low";

        const up = uniprotMap.get(t.tid)!;
        const pdbs = pdbByUniprot.get(up.uniprot) ?? [];
        const bestSimMeasurement = ms.reduce((a, b) => (a.similarity > b.similarity ? a : b));
        const mostPotent = ms.reduce((a, b) => (a.value_nM < b.value_nM ? a : b));
        const bestSourceName = sourceNameById.get(bestSimMeasurement.sourceChemblId) ?? bestSimMeasurement.sourceChemblId;

        return {
          targetChemblId:   t.tid,
          targetName:       t.info.name,
          targetType:       targetTypeMap.get(t.tid),
          uniprotId:        up.uniprot,
          geneName:         up.geneName,
          organism:         up.organism,
          bestActivityType: mostPotent.activityType,
          bestValue_nM:     round(minV),
          bestPChembl:      mostPotent.pChembl != null ? round(mostPotent.pChembl) : null,
          hits:             t.distinctSources,
          bestSimilarity:   bestSimMeasurement.similarity,
          bestSourceChemblId: bestSimMeasurement.sourceChemblId,
          bestSourceName,
          pdbIds:           pdbs.slice(0, 10),
          pdbCount:         pdbs.length,
          quality: {
            tier:        "experimental" as const,
            score:       1.0,
            source:      "ChEMBL",
            provenance:  `https://www.ebi.ac.uk/chembl/g/#browse/activities/filter/target_chembl_id%3A${encodeURIComponent(t.tid)}`,
            payload: {
              nMeasurements:    ms.length,
              distinctCompounds:t.distinctSources,
              range_nM:         [round(minV), round(maxV)] as [number, number],
              geometricMean_nM: round(geomean),
              species:          speciesList,
              speciesCount,
              assayTypes:       assayTypeCount,
              assayFormats:     assayFormatCount,
              confidence,
            },
          },
        };
      });

    res.json({
      similarCompounds: similarCompounds.slice(0, 10),
      similarCount: similarCompounds.length,
      targets,
      threshold,
      status: targets.length > 0 ? "found" : "no_targets",
      method: "ChEMBL similarity → full measurement aggregation → UniProt → PDB",
      version: "v2",
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL similar-targets v2 proxy error" });
  }
});

// ─── PDB structures by UniProt accession (standalone enrichment endpoint) ──
router.get("/pdb/by-uniprot", async (req, res) => {
  const accession = req.query.accession as string | undefined;
  if (!accession) {
    res.status(400).json({ error: "Provide ?accession=<UniProt accession>" });
    return;
  }
  try {
    const upUrl = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.json?fields=xref_pdb,protein_name,gene_names`;
    const upRes = await fetch(upUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!upRes.ok) {
      res.status(upRes.status).json({ accession, pdbIds: [], error: `UniProt ${upRes.status}` });
      return;
    }
    const data = await upRes.json() as any;
    const xrefs = (data?.uniProtKBCrossReferences ?? []) as any[];
    const pdbEntries = xrefs.filter(x => x.database === "PDB").map(x => {
      const propsArr = (x.properties ?? []) as any[];
      const propMap: Record<string, string> = {};
      for (const p of propsArr) if (p?.key) propMap[p.key] = p.value;
      return {
        id: x.id,
        method: propMap.Method ?? null,
        resolution: propMap.Resolution ?? null,
        chains: propMap.Chains ?? null,
      };
    });
    res.json({
      accession,
      proteinName: data?.proteinDescription?.recommendedName?.fullName?.value ?? null,
      pdbIds: pdbEntries.map(p => p.id),
      pdbEntries,
      pdbCount: pdbEntries.length,
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "PDB-by-uniprot proxy error" });
  }
});

export default router;
