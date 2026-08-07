import { Router, type IRouter } from "express";

const router: IRouter = Router();

const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "HakaseAI-BioDigitalTwin/1.0",
};

// ─────────────────────────────────────────────────────────────────────────
// Safe fetch with timeout — avoids AbortSignal.timeout() which throws an
// unhandled DOMException in Node 25 when used inside nested async functions.
// ─────────────────────────────────────────────────────────────────────────
function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─────────────────────────────────────────────────────────────────────────
// Cached + de-duplicated upstream GET.
// ─────────────────────────────────────────────────────────────────────────
// Why this exists: a single molecule fans out into many ChEMBL calls
// (compound match + activities + up to 15 per-target detail fetches +
// similarity + UniProt enrichment), and the frontend fires target-search,
// similar-targets v2/v1 and read-across nearly simultaneously. That's 30-50+
// requests to EBI per molecule — which ChEMBL RATE-LIMITS, producing the
// "works sometimes, randomly slow / times out" behaviour. This wrapper:
//   • CACHES successful responses (ChEMBL data is static) for 10 min, so the
//     same target/compound/UniProt URL is fetched from EBI only once;
//   • DE-DUPLICATES in-flight identical requests so the parallel endpoints
//     share ONE upstream call instead of each hitting EBI;
//   • briefly caches HTTP errors (30 s) so a flaky upstream isn't hammered.
// It is a drop-in for `fetch` for the JSON GETs in this file (callers only use
// .ok / .status / .json()). Network errors/timeouts are NOT cached — they
// reject to the caller's existing try/catch and will be retried next time.
interface ChEMBLCacheEntry { exp: number; status: number; ok: boolean; data: any }
const _chemblCache = new Map<string, ChEMBLCacheEntry>();
const _chemblInflight = new Map<string, Promise<ChEMBLCacheEntry>>();
const CHEMBL_OK_TTL_MS = 10 * 60 * 1000;
const CHEMBL_ERR_TTL_MS = 30 * 1000;

async function cachedFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 10000,
): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  const now = Date.now();
  const hit = _chemblCache.get(url);
  if (hit && hit.exp > now) {
    return { ok: hit.ok, status: hit.status, json: async () => hit.data };
  }
  let pending = _chemblInflight.get(url);
  if (!pending) {
    pending = (async () => {
      const res = await fetchWithTimeout(url, init ?? {}, timeoutMs);
      let data: any = null;
      try { data = await res.json(); } catch { /* non-JSON / empty — leave null */ }
      const entry: ChEMBLCacheEntry = {
        exp: Date.now() + (res.ok ? CHEMBL_OK_TTL_MS : CHEMBL_ERR_TTL_MS),
        status: res.status, ok: res.ok, data,
      };
      _chemblCache.set(url, entry);
      if (_chemblCache.size > 2000) {
        const oldest = _chemblCache.keys().next().value;
        if (oldest) _chemblCache.delete(oldest);
      }
      return entry;
    })();
    _chemblInflight.set(url, pending);
    pending.finally(() => _chemblInflight.delete(url));
  }
  const entry = await pending;
  return { ok: entry.ok, status: entry.status, json: async () => entry.data };
}

type ProteinResolution = {
  status: "resolved" | "unresolved" | "invalid_override";
  target_protein: string | null;
  uniprot_id: string | null;
  pdb_id: string | null;
  organism: string | null;
  gene_symbol?: string | null;
  confidence: "high" | "moderate" | "not_confident";
  evidence_type: "database_derived" | "user_provided" | "predicted_evidence" | "unavailable";
  provenance: string[];
  limitations: string[];
  validated_pdb_ids?: string[];
  reason?: string;
};

async function resolveUniprot(accession: string, evidenceType: ProteinResolution["evidence_type"]): Promise<ProteinResolution> {
  const normalized = accession.trim().toUpperCase();
  const url = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(normalized)}.json?fields=protein_name,gene_names,organism_name,xref_pdb`;
  const response = await cachedFetch(url, { headers: { Accept: "application/json" } }, 10000);
  if (!response.ok) return { status: "invalid_override", target_protein: null, uniprot_id: null, pdb_id: null, organism: null, confidence: "not_confident", evidence_type: evidenceType, provenance: ["UniProt"], limitations: [], reason: `UniProt accession ${normalized} was not validated.` };
  const record = await response.json() as any;
  const pdbs = (record?.uniProtKBCrossReferences ?? []).filter((xref: any) => xref.database === "PDB").map((xref: any) => String(xref.id)).filter(Boolean);
  const proteinName = record?.proteinDescription?.recommendedName?.fullName?.value ?? record?.proteinDescription?.submissionNames?.[0]?.fullName?.value ?? null;
  const geneSymbol = record?.genes?.[0]?.geneName?.value ?? null;
  return {
    status: "resolved",
    target_protein: proteinName,
    uniprot_id: String(record?.primaryAccession ?? normalized),
    pdb_id: pdbs[0] ?? null,
    organism: record?.organism?.scientificName ?? null,
    gene_symbol: geneSymbol,
    confidence: proteinName ? "high" : "moderate",
    evidence_type: evidenceType,
    provenance: ["UniProt"],
    limitations: pdbs.length ? [] : ["No suitable experimental structure was returned for this protein."],
    validated_pdb_ids: pdbs,
    reason: pdbs.length ? undefined : "No suitable structure available.",
  };
}


// ─── Offline-first known-drug seed ────────────────────────────────────────
// DEPRECATED: Hardcoded known-drug seed table removed. Every lookup uses
// live API sources (ChEMBL + PubChem + PubMed) to prevent hardcoded answers.

// ─── Reliable SMILES → ChEMBL molecule lookup ─────────────────────────────
// Goal: resolve a SMILES to its FULL ChEMBL molecule record (with correct
// max_phase, pref_name, etc.) quickly and without depending on ChEMBL's heavy,
// 500-prone structure-search endpoints under load.
//
// Key insight: the InChIKey is the canonical structural identifier. Looking a
// compound up by `standard_inchi_key__exact` is a cheap *indexed* lookup
// (~0.5–1s, returns the complete record) — unlike `flexmatch`/`similarity`
// which run a structure search server-side and are the slow/500-prone calls.
//
// Strategy (first hit wins):
//  1. PubChem: SMILES → canonical InChIKey (+ CID). Canonicalises arbitrary
//     user-entered SMILES so step 2 matches regardless of atom ordering.
//  2. PRIMARY  — ChEMBL molecule.json?standard_inchi_key__exact=<key> (fast,
//     canonical, full record). This is what fixes "shows novel for known drugs".
//  3. FALLBACK — ChEMBL flexmatch on the raw SMILES (structure-aware; used only
//     when PubChem is unreachable or the InChIKey isn't indexed in ChEMBL).
//  4. TERTIARY — PubChem CID → ChEMBL RegistryID xref → /molecule/{id}.json
//     (covers compounds whose structure index in ChEMBL lags PubChem).
//
// NOTE: we no longer synthesise "pubchem_fallback" stub molecules. They carried
// max_phase=null and heuristic names, which made approved drugs look preclinical
// and corrupted downstream verdicts. Returning null (→ genuinely novel) is the
// honest behaviour when no real ChEMBL record exists.
async function resolveChemblMolecule(smiles: string): Promise<any | null> {
  // Step 1 — PubChem: SMILES → canonical InChIKey (+ CID)
  let cid: number | null = null;
  let inchiKey: string | null = null;
  try {
    const pcUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/property/InChIKey/JSON`;
    const pcRes = await cachedFetch(pcUrl, {}, 8000);
    if (pcRes.ok) {
      const pcData: any = await pcRes.json();
      const prop = pcData?.PropertyTable?.Properties?.[0];
      cid = prop?.CID ?? null;
      inchiKey = prop?.InChIKey ?? null;
    }
  } catch { /* fall through */ }

  // Step 1b — OFFLINE-FIRST seed: removed to enforce pure dynamic lookups.

  // Step 2 — PRIMARY: ChEMBL exact lookup by canonical InChIKey (retry on 5xx —
  // EBI's structure endpoint 500s intermittently; a couple of quick retries ride
  // through the flakiness without the cached error poisoning the result).
  if (inchiKey) {
    const url = `${CHEMBL_BASE}/molecule.json?molecule_structures__standard_inchi_key__exact=${encodeURIComponent(inchiKey)}&limit=1`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await cachedFetch(url, { headers: HEADERS }, 8000);
        if (res.ok) {
          const mol = (await res.json())?.molecules?.[0];
          if (mol?.molecule_chembl_id) return mol;
          break; // query succeeded but no record → genuine miss, stop retrying
        }
        // 5xx: drop the cached error so the retry actually re-hits EBI
        if (res.status >= 500) _chemblCache.delete(url);
      } catch { /* network error — retry */ }
    }
  }

  // Step 3 — FALLBACK: ChEMBL flexmatch on the raw SMILES (structure-aware).
  // Slower, but only reached when PubChem is down or the InChIKey isn't indexed.
  try {
    const url = `${CHEMBL_BASE}/molecule.json?molecule_structures__canonical_smiles__flexmatch=${encodeURIComponent(smiles)}&limit=1`;
    const res = await cachedFetch(url, { headers: HEADERS }, 12000);
    if (res.ok) {
      const mol = (await res.json())?.molecules?.[0];
      if (mol?.molecule_chembl_id) return mol;
    }
  } catch { /* fall through */ }

  // Step 4 — TERTIARY: PubChem CID → ChEMBL RegistryID xref → full record.
  if (cid) {
    try {
      const xrefUrl = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/xrefs/RegistryID/JSON`;
      const xRes = await cachedFetch(xrefUrl, {}, 8000);
      if (xRes.ok) {
        const xData: any = await xRes.json();
        const regIds: string[] = xData?.InformationList?.Information?.[0]?.RegistryID ?? [];
        const chemblId = regIds.find((r: string) => /^CHEMBL\d+$/i.test(r));
        if (chemblId) {
          const molUrl = `${CHEMBL_BASE}/molecule/${encodeURIComponent(chemblId.toUpperCase())}.json`;
          const molRes = await cachedFetch(molUrl, { headers: HEADERS }, 8000);
          if (molRes.ok) {
            const mol: any = await molRes.json();
            if (mol?.molecule_chembl_id) return mol;
          }
        }
      }
    } catch { /* give up */ }
  }

  return null;
}

router.get("/chembl/compound", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  if (!smiles) {
    res.status(400).json({ error: "Provide ?smiles=<SMILES>" });
    return;
  }

  try {
    const mol = await resolveChemblMolecule(smiles);
    if (!mol) {
      res.json({ molecules: [], page_meta: { total_count: 0 } });
      return;
    }
    res.json({ molecules: [mol], page_meta: { total_count: 1 } });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL compound proxy error" });
  }
});

/**
 * ChEMBL development stage — how far this exact structure has progressed
 * clinically. max_phase: 4 = approved, 1-3 = clinical phases, 0/null =
 * preclinical/research. Bio-relevant translational signal (not a drug label).
 */
router.get("/chembl/development", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  if (!smiles) { res.status(400).json({ error: "Provide ?smiles=<SMILES>" }); return; }
  try {
    const m = await resolveChemblMolecule(smiles);
    if (!m) { res.json({ found: false }); return; }
    res.json({
      found: true,
      chemblId: m.molecule_chembl_id ?? null,
      prefName: m.pref_name ?? null,
      maxPhase: m.max_phase ?? null,
      withdrawn: !!m.withdrawn_flag,
      firstApproval: m.first_approval ?? null,
      moleculeType: m.molecule_type ?? null,
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL development proxy error" });
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
    const upstream = await cachedFetch(url, { headers: HEADERS }, 12000);
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
    const upstream = await cachedFetch(url, { headers: HEADERS }, 8000);
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
      const aRes = await cachedFetch(assayUrl, { headers: HEADERS }, 8000);
      if (!aRes.ok) return { organism, records: [] as any[] };
      const aData = (await aRes.json()) as { assays?: any[] };
      const assayIds: string[] = (aData?.assays ?? []).map((a: any) => a.assay_chembl_id).filter(Boolean);
      if (!assayIds.length) return { organism, records: [] as any[] };
      // Fetch activities for this molecule across these assays
      const ids = assayIds.slice(0, 30).join(",");
      const actUrl = `${CHEMBL_BASE}/activity.json?molecule_chembl_id=${encodeURIComponent(chemblId)}&assay_chembl_id__in=${encodeURIComponent(ids)}&limit=100`;
      const actRes = await cachedFetch(actUrl, { headers: HEADERS }, 10000);
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

// Resolve a biological protein target and optional user overrides.  This is
// data integration only: the UI never infers an accession or structure.
router.get("/chembl/resolve-protein", async (req, res) => {
  const protein = String(req.query.protein ?? "").trim();
  const uniprotId = String(req.query.uniprot_id ?? "").trim();
  const pdbId = String(req.query.pdb_id ?? "").trim().toUpperCase();
  if (!protein && !uniprotId && !pdbId) { res.status(400).json({ error: "Provide protein, uniprot_id, or pdb_id." }); return; }
  try {
    let resolution: ProteinResolution;
    if (uniprotId) {
      resolution = await resolveUniprot(uniprotId, "user_provided");
    } else if (protein) {
      const searchUrl = `${CHEMBL_BASE}/target/search.json?q=${encodeURIComponent(protein)}&limit=25`;
      const search = await cachedFetch(searchUrl, { headers: HEADERS }, 12000);
      const candidates = search.ok ? ((await search.json())?.targets ?? []) as any[] : [];
      const normalizedProtein = protein.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const candidate = candidates.find((target) => {
        if (String(target.target_type ?? "").toUpperCase() !== "SINGLE PROTEIN" || String(target.organism ?? "").toLowerCase() !== "homo sapiens" || !target.target_components?.[0]?.accession) return false;
        const searchable = [target.pref_name, target.target_name, target.target_chembl_id, ...(target.target_components ?? []).flatMap((component: any) => [component.component_description, component.accession])]
          .filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
        return searchable.includes(normalizedProtein);
      });
      if (!candidate) {
        const geneSearch = await cachedFetch(`https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(`gene:${protein} AND organism_id:9606`)}&format=json&fields=accession,gene_names&size=10`, { headers: { Accept: "application/json" } }, 10000);
        const genes = geneSearch.ok ? ((await geneSearch.json())?.results ?? []) as any[] : [];
        if (genes[0]?.primaryAccession) {
          resolution = await resolveUniprot(String(genes[0].primaryAccession), "user_provided");
          resolution.provenance = ["UniProt", ...resolution.provenance.filter((value) => value !== "UniProt")];
        } else {
          resolution = { status: "unresolved", target_protein: null, uniprot_id: null, pdb_id: null, organism: null, confidence: "not_confident", evidence_type: "unavailable", provenance: ["Protein reference service"], limitations: ["No unambiguous human protein record could be resolved for the supplied target text."], reason: "Not confidently resolved." };
        }
      } else {
        resolution = await resolveUniprot(String(candidate.target_components[0].accession), "user_provided");
        resolution.provenance = ["ChEMBL", ...resolution.provenance];
      }
    } else {
      // A structure identifier may be real without establishing its protein
      // identity.  Validate its existence and state that limitation plainly.
      const entryUrl = `https://data.rcsb.org/rest/v1/core/entry/${encodeURIComponent(pdbId)}`;
      const entry = await cachedFetch(entryUrl, { headers: { Accept: "application/json" } }, 10000);
      resolution = entry.ok
        ? { status: "unresolved", target_protein: null, uniprot_id: null, pdb_id: pdbId, organism: null, confidence: "not_confident", evidence_type: "user_provided", provenance: ["RCSB PDB"], limitations: ["The supplied structure exists, but protein identity cannot be validated without a matching protein or UniProt override."], reason: "Not confidently resolved." }
        : { status: "invalid_override", target_protein: null, uniprot_id: null, pdb_id: null, organism: null, confidence: "not_confident", evidence_type: "user_provided", provenance: ["RCSB PDB"], limitations: [], reason: `PDB identifier ${pdbId} was not validated.` };
    }
    if (pdbId && resolution.status === "resolved") {
      if (!(resolution.validated_pdb_ids ?? []).includes(pdbId)) {
        resolution.status = "invalid_override";
        resolution.reason = `PDB identifier ${pdbId} was not validated as a structure for the resolved protein.`;
        resolution.pdb_id = null;
      } else {
        resolution.pdb_id = pdbId;
        resolution.evidence_type = "user_provided";
        resolution.provenance = [...resolution.provenance, "RCSB PDB"];
      }
    }
    res.json(resolution);
  } catch {
    res.json({ status: "unresolved", target_protein: null, uniprot_id: null, pdb_id: null, organism: null, confidence: "not_confident", evidence_type: "unavailable", provenance: [], limitations: ["The protein-resolution service did not return sufficient evidence."], reason: "Not confidently resolved." } satisfies ProteinResolution);
  }
});

router.get("/chembl/target-search", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  if (!smiles) {
    res.status(400).json({ error: "Provide ?smiles=<SMILES>" });
    return;
  }

  try {
    const mol = await resolveChemblMolecule(smiles);
    if (!mol) {
      res.json({ targets: [], status: "compound_not_found" });
      return;
    }

    const chemblId = mol.molecule_chembl_id;
    const compoundName = mol.pref_name ?? chemblId;

    const actUrl = `${CHEMBL_BASE}/activity.json?molecule_chembl_id=${encodeURIComponent(chemblId)}&limit=100`;
    const actRes = await cachedFetch(actUrl, { headers: HEADERS }, 12000);
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
          const tRes = await cachedFetch(tUrl, { headers: HEADERS }, 6000);
          if (!tRes.ok) return null;
          return tRes.json();
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) targetDetails.push(r.value);
      }
    }

    // A Layer-2 binding target must be an experimentally annotated protein,
    // not a cell line, organism, tissue, or generic ChEMBL grouping.  Prefer
    // human single-protein targets so UniProt and PDB can be auto-populated.
    const uniprotMap = new Map<string, { uniprotId: string; geneName: string | null; organism: string | null; targetType: string }>();
    for (const td of targetDetails) {
      const chemblTargetId = td.target_chembl_id;
      const targetType = String(td.target_type ?? "").toUpperCase();
      if (targetType !== "SINGLE PROTEIN") continue;
      const components = td.target_components ?? [];
      for (const comp of components) {
        if (String(comp.organism ?? "").toLowerCase() !== "homo sapiens") continue;
        const xrefs = comp.target_component_xrefs ?? [];
        for (const xref of xrefs) {
          if (xref.xref_src_db === "UniProt" && xref.xref_id) {
            uniprotMap.set(chemblTargetId, {
              uniprotId: xref.xref_id,
              geneName: comp.component_synonyms?.find((s: any) => s.syn_type === "GENE_SYMBOL")?.component_synonym ?? null,
              organism: comp.organism ?? null,
              targetType,
            });
            break;
          }
        }
      }
    }

    const pdbByUniprot = new Map<string, string[]>();
    await Promise.allSettled(Array.from(new Set(Array.from(uniprotMap.values()).map(value => value.uniprotId))).map(async (accession) => {
      const upUrl = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.json?fields=xref_pdb`;
      const upRes = await cachedFetch(upUrl, { headers: { Accept: "application/json" } }, 8000);
      if (!upRes.ok) return;
      const upData = await upRes.json() as any;
      pdbByUniprot.set(accession, (upData?.uniProtKBCrossReferences ?? []).filter((xref: any) => xref.database === "PDB").map((xref: any) => xref.id).filter(Boolean));
    }));

    const targets = Array.from(targetBestActivity.entries())
      .filter(([tid]) => uniprotMap.has(tid))
      .map(([tid, info]) => {
        const protein = uniprotMap.get(tid)!;
        const pdbIds = pdbByUniprot.get(protein.uniprotId) ?? [];
        return {
          targetChemblId: tid,
          targetName: info.name,
          targetType: protein.targetType,
          uniprotId: protein.uniprotId,
          geneName: protein.geneName,
          organism: protein.organism,
          bestActivityType: info.activityType,
          bestValue_nM: info.value_nM,
          pChembl: info.pChembl,
          pdbIds: pdbIds.slice(0, 10),
          pdbCount: pdbIds.length,
        };
      })
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

// ─── Measured off-target and selectivity evidence ─────────────────────────
// This is deliberately evidence retrieval, not a frontend-derived selectivity
// score.  It returns only exact-relation, standardised concentration records
// from ChEMBL for close structural neighbours.  Summaries are built here so
// reviewers can inspect the returned assay provenance rather than trust a
// browser-side calculation.
router.get("/chembl/selectivity-evidence", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  const selectedTarget = String(req.query.selected_target_chembl_id ?? "").trim();
  const threshold = Math.max(40, Math.min(100, parseInt(String(req.query.threshold ?? "70"), 10) || 70));
  const limit = Math.max(5, Math.min(30, parseInt(String(req.query.limit ?? "15"), 10) || 15));
  if (!smiles || !selectedTarget) {
    res.status(400).json({ error: "Provide ?smiles=<SMILES>&selected_target_chembl_id=<CHEMBL target>" });
    return;
  }

  const toNm = (value: unknown, units: unknown): number | null => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (units === "nM") return numeric;
    if (units === "uM" || units === "µM") return numeric * 1000;
    if (units === "pM") return numeric / 1000;
    return null;
  };
  const median = (values: number[]) => {
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  };

  try {
    const similarityUrl = `${CHEMBL_BASE}/similarity/${encodeURIComponent(smiles)}/${threshold}.json?only=molecule_chembl_id,pref_name,similarity&limit=${limit}`;
    const similarityResponse = await cachedFetch(similarityUrl, { headers: HEADERS }, 15000);
    if (!similarityResponse.ok) {
      res.json({ status: "unavailable", reason: "ChEMBL similarity service did not return a response.", off_targets: [], primary_target_evidence: [] });
      return;
    }
    const similar = ((await similarityResponse.json())?.molecules ?? []) as any[];
    const neighbours = similar
      .map((m) => ({ chemblId: String(m.molecule_chembl_id ?? ""), name: m.pref_name ?? null, similarity: Number(m.similarity ?? 0) }))
      .filter((m) => m.chemblId && Number.isFinite(m.similarity) && m.similarity >= threshold);
    if (!neighbours.length) {
      res.json({ status: "insufficient_data", reason: `No ChEMBL neighbours met the ${threshold}% similarity threshold.`, off_targets: [], primary_target_evidence: [], threshold });
      return;
    }

    type Evidence = { molecule_chembl_id: string; molecule_name: string | null; similarity: number; target_chembl_id: string; target_name: string; standard_type: string; value_nM: number; original_unit: string; assay_chembl_id: string | null; document_chembl_id: string | null; assay_confidence_score: number | null; organism: string | null; assay_context: string | null };
    const evidence: Evidence[] = [];
    const allowedTypes = new Set(["IC50", "EC50", "KI", "KD"]);
    const activityResults = await Promise.allSettled(neighbours.map(async (neighbour) => {
      const activityUrl = `${CHEMBL_BASE}/activity.json?molecule_chembl_id=${encodeURIComponent(neighbour.chemblId)}&standard_relation__exact=%3D&limit=100`;
      const response = await cachedFetch(activityUrl, { headers: HEADERS }, 12000);
      return { neighbour, activities: response.ok ? ((await response.json())?.activities ?? []) as any[] : [] as any[] };
    }));
    for (const item of activityResults) {
      if (item.status !== "fulfilled") continue;
      const { neighbour, activities } = item.value;
      for (const activity of activities) {
        const standardType = String(activity.standard_type ?? "").toUpperCase();
        const valueNm = toNm(activity.standard_value, activity.standard_units);
        const assayType = String(activity.assay_type ?? "").toUpperCase();
        const assayConfidence = activity.assay_confidence_score == null ? null : Number(activity.assay_confidence_score);
        // Restrict read-across to curated binding or functional protein assays.
        // This excludes generic chemistry, ADMET and low-confidence assay rows
        // that can be attached to a protein record without measuring that protein.
        const assayDescription = String(activity.assay_description ?? "");
        const nonTargetDirectedScreen = /\b(dpph|radical scaveng|total antioxidant|antioxidant activity)\b/i.test(assayDescription);
        if (!allowedTypes.has(standardType) || valueNm === null || activity.standard_relation !== "=") continue;
        // Some curated legacy measurements do not expose a confidence score;
        // retain those only when the assay type is appropriate, while rejecting
        // an explicitly low confidence score and non-target-directed screens.
        if (!new Set(["B", "F"]).has(assayType) || (assayConfidence !== null && assayConfidence < 7) || nonTargetDirectedScreen) continue;
        const targetChemblId = String(activity.target_chembl_id ?? "");
        const targetName = String(activity.target_pref_name ?? "");
        if (!targetChemblId || !targetName) continue;
        evidence.push({
          molecule_chembl_id: neighbour.chemblId,
          molecule_name: neighbour.name,
          similarity: neighbour.similarity,
          target_chembl_id: targetChemblId,
          target_name: targetName,
          standard_type: standardType,
          value_nM: valueNm,
          original_unit: String(activity.standard_units ?? ""),
          assay_chembl_id: activity.assay_chembl_id ?? null,
          document_chembl_id: activity.document_chembl_id ?? null,
          assay_confidence_score: assayConfidence,
          organism: activity.assay_organism ?? activity.target_organism ?? null,
          assay_context: activity.assay_description ?? activity.assay_type ?? null,
        });
      }
    }

    // Activity rows alone can represent organisms, cell systems, and generic
    // groups.  For a receptor/off-target panel, retain only ChEMBL targets
    // that resolve to one Homo sapiens SINGLE PROTEIN target record.
    const targetIds = Array.from(new Set(evidence.map((row) => row.target_chembl_id))).slice(0, 60);
    const detailResults = await Promise.allSettled(targetIds.map(async (targetId) => {
      const detailUrl = `${CHEMBL_BASE}/target/${encodeURIComponent(targetId)}.json`;
      const response = await cachedFetch(detailUrl, { headers: HEADERS }, 8000);
      return response.ok ? response.json() : null;
    }));
    const proteinAccessions = new Map<string, string>();
    for (let index = 0; index < targetIds.length; index++) {
      const item = detailResults[index];
      if (item.status !== "fulfilled" || !item.value) continue;
      const target = item.value as any;
      const components = target.target_components ?? [];
      const uniProt = components.flatMap((component: any) => component.target_component_xrefs ?? []).find((xref: any) => xref.xref_src_db === "UniProt")?.xref_id;
      if (String(target.target_type ?? "").toUpperCase() === "SINGLE PROTEIN" && uniProt) proteinAccessions.set(targetIds[index], String(uniProt));
    }
    const organismResults = await Promise.allSettled(Array.from(new Set(proteinAccessions.values())).map(async (accession) => {
      const uniProtUrl = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.json?fields=organism_name`;
      const response = await cachedFetch(uniProtUrl, { headers: { Accept: "application/json" } }, 8000);
      const payload = response.ok ? await response.json() : null;
      return { accession, human: String(payload?.organism?.scientificName ?? "").toLowerCase() === "homo sapiens" };
    }));
    const humanAccessions = new Set(organismResults.filter((item): item is PromiseFulfilledResult<{ accession: string; human: boolean }> => item.status === "fulfilled" && item.value.human).map((item) => item.value.accession));
    const humanProteinTargets = new Set(Array.from(proteinAccessions.entries()).filter(([, accession]) => humanAccessions.has(accession)).map(([targetId]) => targetId));
    const proteinEvidence = evidence.filter((row) => humanProteinTargets.has(row.target_chembl_id));
    const byTarget = new Map<string, Evidence[]>();
    for (const row of proteinEvidence) byTarget.set(row.target_chembl_id, [...(byTarget.get(row.target_chembl_id) ?? []), row]);
    const displayConcentration = (valueNm: number) => valueNm >= 1_000_000
      ? `${valueNm.toLocaleString(undefined, { maximumFractionDigits: 2 })} nM (${(valueNm / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 })} mM)`
      : valueNm >= 1_000
        ? `${valueNm.toLocaleString(undefined, { maximumFractionDigits: 2 })} nM (${(valueNm / 1_000).toLocaleString(undefined, { maximumFractionDigits: 3 })} µM)`
        : `${valueNm.toLocaleString(undefined, { maximumFractionDigits: 2 })} nM`;
    const summary = (targetRows: Evidence[]) => {
      const assayIds = Array.from(new Set(targetRows.map((row) => row.assay_chembl_id).filter(Boolean)));
      const docs = Array.from(new Set(targetRows.map((row) => row.document_chembl_id).filter(Boolean)));
      const best = targetRows.reduce((a, b) => a.value_nM < b.value_nM ? a : b);
      const potency_groups = Array.from(new Set(targetRows.map((row) => row.standard_type))).sort().map((activity_type) => {
        const rows = targetRows.filter((row) => row.standard_type === activity_type);
        const compounds = Array.from(new Set(rows.map((row) => row.molecule_chembl_id)));
        const values = rows.map((row) => row.value_nM);
        const sufficient = compounds.length >= 3;
        const median_nM = sufficient ? median(values) : null;
        return {
          activity_type: activity_type === "KI" ? "Ki" : activity_type === "KD" ? "Kd" : activity_type,
          independent_compound_count: compounds.length,
          supporting_measurement_count: rows.length,
          potency_estimate: sufficient && median_nM !== null ? { median_nM, display: displayConcentration(median_nM) } : null,
          organisms: Array.from(new Set(rows.map((row) => row.organism).filter(Boolean))),
          assay_contexts: Array.from(new Set(rows.map((row) => row.assay_context).filter(Boolean))).slice(0, 4),
          reported_units: Array.from(new Set(rows.map((row) => row.original_unit).filter(Boolean))),
          evidence: rows.slice(0, 12),
          insufficient_reason: sufficient ? null : `Only ${compounds.length} suitable analogue compound(s) were found. At least 3 independent analogues are required for a potency estimate.`,
        };
      });
      return {
        target_chembl_id: best.target_chembl_id,
        target_name: best.target_name,
        potency_groups,
        provenance: { source: "ChEMBL", assay_ids: assayIds, document_ids: docs },
      };
    };
    const primaryRows = byTarget.get(selectedTarget) ?? [];
    const offTargetReports = Array.from(byTarget.entries())
      .filter(([target]) => target !== selectedTarget)
      .map(([, rows]) => {
        const report = summary(rows);
        return report;
      });
    // A target is eligible for the selectivity display only when a potency
    // estimate is supported by at least three independent analogue compounds.
    // Weak one-compound records remain accounted for, but are not presented as
    // a list of apparent off-target findings.
    const eligibleOffTargets = offTargetReports
      .filter((report) => report.potency_groups.some((group) => group.potency_estimate !== null))
      .slice(0, 15);
    const insufficientOffTargetTargetCount = offTargetReports.length - eligibleOffTargets.length;
    res.json({
      status: primaryRows.length ? "completed" : "insufficient_data",
      selected_target_chembl_id: selectedTarget,
      method: "ChEMBL structural-neighbour retrieval with exact-relation standardised activity records; no predicted potency is generated.",
      threshold,
      primary_target_evidence: primaryRows.length ? [summary(primaryRows)] : [],
      off_targets: eligibleOffTargets,
      insufficient_off_target_target_count: insufficientOffTargetTargetCount,
      limitations: ["Read-across evidence from similar known compounds is not an experimental result for the submitted novel compound.", "Potency ratios are descriptive only and must not be interpreted as a validated selectivity claim."],
      reason: primaryRows.length ? null : "No exact-relation standardised ChEMBL activity was found for the selected target among returned structural neighbours.",
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL selectivity evidence proxy error", off_targets: [], primary_target_evidence: [] });
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
    const simRes = await cachedFetch(simUrl, { headers: HEADERS }, 15000);
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
          const aRes = await cachedFetch(aUrl, { headers: HEADERS }, 10000);
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
        const tRes = await cachedFetch(tUrl, { headers: HEADERS }, 6000);
        if (!tRes.ok) return null;
        return tRes.json();
      })
    );

    const uniprotMap = new Map<string, { uniprot: string; geneName: string | null; organism: string | null }>();
    const targetTypeMap = new Map<string, string>();
    // Target selection for the in-vitro binding workflow is intentionally
    // constrained to a human single protein.  Complexes/families are useful
    // evidence classes, but cannot safely auto-fill one UniProt/PDB receptor.
    for (let i = 0; i < topTargets.length; i++) {
      const td = targetDetails[i];
      if (td.status !== "fulfilled" || !td.value) continue;
      const tdv = td.value as any;
      const ttype = (tdv.target_type ?? "").toUpperCase();
      // Filter at the target level — drops CELL-LINE, ORGANISM, TISSUE, UNCHECKED
      if (ttype !== "SINGLE PROTEIN") continue;
      targetTypeMap.set(topTargets[i].tid, ttype);
      const components = tdv.target_components ?? [];
      for (const comp of components) {
        if (String(comp.organism ?? "").toLowerCase() !== "homo sapiens") continue;
        const xrefs = comp.target_component_xrefs ?? [];
        const accession = comp.accession ?? xrefs.find((x: any) => x.xref_src_db === "UniProt")?.xref_id;
        if (accession) {
          uniprotMap.set(topTargets[i].tid, {
            uniprot: accession,
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
    const humanByUniprot = new Map<string, boolean>();
    if (uniprotAccessions.length > 0) {
      const pdbResults = await Promise.allSettled(
        uniprotAccessions.map(async (acc) => {
          const upUrl = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(acc)}.json?fields=xref_pdb,organism_name`;
          const upRes = await cachedFetch(upUrl, { headers: { Accept: "application/json" } }, 8000);
          if (!upRes.ok) return { acc, pdbs: [] as string[], human: false };
          const upData = await upRes.json() as any;
          const xrefs = (upData?.uniProtKBCrossReferences ?? []) as any[];
          const pdbs = xrefs.filter(x => x.database === "PDB").map(x => x.id).filter(Boolean) as string[];
          return { acc, pdbs, human: String(upData?.organism?.scientificName ?? "").toLowerCase() === "homo sapiens" };
        })
      );
      for (const r of pdbResults) {
        if (r.status === "fulfilled") {
          pdbByUniprot.set(r.value.acc, r.value.pdbs);
          humanByUniprot.set(r.value.acc, r.value.human);
        }
      }
    }

    // 5. Compose response — only emit targets that passed type-filter AND resolved a UniProt
    const targets = topTargets
      .filter(t => targetTypeMap.has(t.tid) && uniprotMap.has(t.tid) && humanByUniprot.get(uniprotMap.get(t.tid)!.uniprot) === true)
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
    const simRes = await cachedFetch(simUrl, { headers: HEADERS }, 15000);
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
          const aRes = await cachedFetch(aUrl, { headers: HEADERS }, 10000);
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
        const tRes = await cachedFetch(tUrl, { headers: HEADERS }, 6000);
        if (!tRes.ok) return null;
        return tRes.json();
      })
    );

    // Auto-fill one UniProt receptor and PDB structure only for a human
    // single-protein target.  Complexes, families and organism/cell entries
    // remain valid ChEMBL evidence but are not safe docking targets.
    const uniprotMap = new Map<string, { uniprot: string; geneName: string | null; organism: string | null }>();
    const targetTypeMap = new Map<string, string>();
    for (let i = 0; i < topTargets.length; i++) {
      const td = targetDetails[i];
      if (td.status !== "fulfilled" || !td.value) continue;
      const tdv = td.value as any;
      const ttype = (tdv.target_type ?? "").toUpperCase();
      if (ttype !== "SINGLE PROTEIN") continue;
      targetTypeMap.set(topTargets[i].tid, ttype);
      const components = tdv.target_components ?? [];
      for (const comp of components) {
        const xrefs = comp.target_component_xrefs ?? [];
        const accession = comp.accession ?? xrefs.find((x: any) => x.xref_src_db === "UniProt")?.xref_id;
        if (accession) {
          uniprotMap.set(topTargets[i].tid, {
            uniprot: accession,
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
    const humanByUniprot = new Map<string, boolean>();
    if (uniprotAccessions.length > 0) {
      const pdbResults = await Promise.allSettled(
        uniprotAccessions.map(async (acc) => {
          const upUrl = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(acc)}.json?fields=xref_pdb,organism_name`;
          const upRes = await cachedFetch(upUrl, { headers: { Accept: "application/json" } }, 8000);
          if (!upRes.ok) return { acc, pdbs: [] as string[], human: false };
          const upData = await upRes.json() as any;
          const xrefs = (upData?.uniProtKBCrossReferences ?? []) as any[];
          const pdbs = xrefs.filter(x => x.database === "PDB").map(x => x.id).filter(Boolean) as string[];
          return { acc, pdbs, human: String(upData?.organism?.scientificName ?? "").toLowerCase() === "homo sapiens" };
        })
      );
      for (const r of pdbResults) {
        if (r.status === "fulfilled") {
          pdbByUniprot.set(r.value.acc, r.value.pdbs);
          humanByUniprot.set(r.value.acc, r.value.human);
        }
      }
    }

    // 6. Build per-target measurement aggregations
    const round = (n: number) => Math.round(n * 100) / 100;
    const targets = topTargets
      .filter(t => targetTypeMap.has(t.tid) && uniprotMap.has(t.tid) && humanByUniprot.get(uniprotMap.get(t.tid)!.uniprot) === true)
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
    const upRes = await cachedFetch(upUrl, { headers: { Accept: "application/json" } }, 8000);
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

// ─── Similar known compounds (read-across for NOVEL chemistry) ─────────────
// For a novel molecule, find the nearest KNOWN ChEMBL compounds and report each
// one's development STATE (approved / withdrawn / clinical / research) and what
// it implies. This is the strongest direction we can give a fresh molecule:
// "you're 82% similar to a drug withdrawn for cardiotoxicity" is actionable.
// Resilient: small `only=` payload + retry-on-5xx (EBI similarity 500s under load).
router.get("/chembl/similar-compounds", async (req, res) => {
  const smiles = req.query.smiles as string | undefined;
  const threshold = Math.max(40, Math.min(100, parseInt((req.query.threshold as string) ?? "70")));
  const limit = Math.max(5, Math.min(50, parseInt((req.query.limit as string) ?? "25")));
  if (!smiles) { res.status(400).json({ error: "Provide ?smiles=<SMILES>" }); return; }

  const url = `${CHEMBL_BASE}/similarity/${encodeURIComponent(smiles)}/${threshold}.json`
    + `?only=molecule_chembl_id,pref_name,similarity,max_phase,withdrawn_flag&limit=${limit}`;
  try {
    let molecules: any[] | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await cachedFetch(url, { headers: HEADERS }, 15000);
      if (r.ok) { molecules = (await r.json())?.molecules ?? []; break; }
      if (r.status >= 500) _chemblCache.delete(url); // don't let the cached 5xx stick
    }
    if (molecules === null) { res.json({ compounds: [], status: "chembl_unavailable", threshold }); return; }

    const seen = new Set<string>();
    const compounds = molecules
      .map((m) => {
        const mp = m.max_phase == null ? null : Number(m.max_phase);
        const withdrawn = !!m.withdrawn_flag;
        const status =
          withdrawn ? "withdrawn"
          : mp != null && mp >= 4 ? "approved"
          : mp != null && mp >= 1 ? `clinical (phase ${mp})`
          : "research";
        const implication =
          withdrawn ? "Structural neighbour was WITHDRAWN — inspect this liability in your scaffold."
          : status === "approved" ? "Approved drug in this chemical space — developability precedent."
          : status.startsWith("clinical") ? "In clinical development — active chemotype."
          : "Research compound — measured data may exist for read-across.";
        return {
          chemblId: m.molecule_chembl_id as string,
          name: (m.pref_name as string) ?? null,
          similarity: Math.round(Number(m.similarity ?? 0) * 10) / 10,
          maxPhase: mp,
          withdrawn,
          status,
          implication,
          chemblUrl: `https://www.ebi.ac.uk/chembl/compound_report_card/${m.molecule_chembl_id}/`,
        };
      })
      .filter((c) => c.chemblId && !seen.has(c.chemblId) && seen.add(c.chemblId))
      // Most useful first: named drugs with a known clinical state, then by similarity.
      .sort((a, b) => {
        const rank = (c: typeof a) => (c.withdrawn ? 3 : c.status === "approved" ? 2 : c.status.startsWith("clinical") ? 1 : 0);
        return rank(b) - rank(a) || b.similarity - a.similarity;
      });

    const withdrawnHits = compounds.filter((c) => c.withdrawn).length;
    const approvedHits = compounds.filter((c) => c.status === "approved").length;
    res.json({
      compounds,
      count: compounds.length,
      withdrawnHits,
      approvedHits,
      threshold,
      status: compounds.length > 0 ? "found" : "no_similar",
      summary:
        compounds.length === 0
          ? `No ChEMBL compounds within ${threshold}% similarity — genuinely novel chemical space.`
          : `${compounds.length} known neighbours ≥ ${threshold}% similar`
            + (withdrawnHits ? ` · ${withdrawnHits} WITHDRAWN (liability signal)` : "")
            + (approvedHits ? ` · ${approvedHits} approved (developability precedent)` : "") + ".",
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "ChEMBL similar-compounds proxy error", compounds: [] });
  }
});

export default router;
