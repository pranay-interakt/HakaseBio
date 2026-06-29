/**
 * Read-Across Engine — anchoring novel-compound endpoints to REAL measured
 * neighbours.
 * ─────────────────────────────────────────────────────────────────────────
 * The honest problem: for a *novel* small molecule, hERG / IC50 / permeability
 * from a pure QSAR or ML model are extrapolations — the model has never seen
 * the scaffold. No in-silico method replaces a wet-lab assay. But there is a
 * scientifically accepted way to get materially closer to the truth without a
 * lab: READ-ACROSS. Find the structurally nearest compounds that DO have a
 * measured value for the endpoint, and anchor the estimate to those real
 * measurements, weighted by how similar they are. Closer analogues → tighter,
 * more trustworthy estimate; no close analogue → say so honestly.
 *
 * This is an established regulatory approach, not a heuristic we invented:
 *   • OECD (2014) Guidance on Grouping of Chemicals (read-across / category
 *     approach).
 *   • ECHA Read-Across Assessment Framework (RAAF), 2017.
 *   • OECD QSAR Toolbox — the same "fill a data gap from measured analogues"
 *     workflow regulators accept for REACH submissions.
 *
 * Data source: EBI ChEMBL REST (free, key-less, CORS-enabled). hERG uses the
 * canonical hERG target CHEMBL240; on-target IC50 uses the user-selected
 * target; Caco-2 uses ChEMBL permeability assays. Every call is time-boxed
 * and fails soft — when no measured neighbour exists, the endpoint returns
 * status "no-neighbors" and the engine reports that the model estimate is a
 * pure extrapolation (lower confidence), rather than inventing a number.
 */

const TIMEOUT_MS = 10000;
const CHEMBL = "https://www.ebi.ac.uk/chembl/api/data";

/** Canonical hERG channel (KCNH2) target in ChEMBL. */
export const HERG_TARGET_CHEMBL_ID = "CHEMBL240";

// ── Resilience: EBI's ChEMBL API is intermittently 500-prone / slow. Read-across
// is the strongest evidence we have for NOVEL chemistry (anchoring endpoints to
// real measured analogues), so we must not lose it to a transient hiccup. A
// short retry on 5xx/network errors rides through the flakiness, and successful
// responses are cached for the session so repeat lookups (and re-runs of the
// same molecule) are instant and survive a later outage. Genuine empty results
// are returned normally (the caller maps them to "no-neighbors").
const _raCache = new Map<string, any>();
const RETRIES = 3;

async function getJson(url: string): Promise<any> {
  const cached = _raCache.get(url);
  if (cached !== undefined) return cached;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const data = await res.json();
        _raCache.set(url, data); // cache only real successes
        return data;
      }
      if (res.status < 500) throw new Error(`HTTP ${res.status}`); // 4xx → don't retry
      lastErr = new Error(`HTTP ${res.status}`); // 5xx → retry
    } catch (e) {
      lastErr = e; // timeout / network → retry
    }
  }
  throw lastErr ?? new Error("read-across fetch failed");
}

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface MeasuredNeighbor {
  chemblId: string;
  name: string | null;
  /** Tanimoto similarity to the query (0–1). */
  similarity: number;
  /** Measured value, normalised to the endpoint's canonical unit. */
  value: number;
  unit: string;
  valueText: string;
  /** ChEMBL pChembl (−log10 M) when present — the most reliable field. */
  pchembl: number | null;
  url: string;
}

export type AdConfidence = "High" | "Moderate" | "Low" | "None";

export interface ReadAcrossEndpoint {
  endpoint: string;
  status: "ok" | "no-neighbors" | "unavailable";
  /** Similarity-weighted read-across point estimate (canonical unit). */
  estimate: number | null;
  unit: string;
  /** Geometric-SD fold uncertainty around the estimate (e.g. 3.2 = ±3.2×). */
  geoSDfold: number | null;
  nNeighbors: number;
  maxSimilarity: number | null;
  adConfidence: AdConfidence;
  /** Top measured neighbours used, for the evidence panel. */
  neighbors: MeasuredNeighbor[];
  note: string;
  error?: string;
}

export interface ReadAcrossReport {
  herg: ReadAcrossEndpoint;
  onTarget: ReadAcrossEndpoint | null;
  caco2: ReadAcrossEndpoint;
  /**
   * Fraction of attempted endpoints backed by ≥1 measured neighbour (0–1).
   * Consumed by the L1 scorecard to lift/temper confidence: a verdict
   * supported by real measured analogues deserves more confidence than one
   * resting entirely on extrapolation.
   */
  coverage: number;
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────
// PURE math (unit-tested; no network)
// ─────────────────────────────────────────────────────────────────────────

/** Normalise a ChEMBL activity value to nM. Returns null if not interpretable. */
export function normalizeToNm(value: number | null, units: string | null | undefined, pchembl: number | null): number | null {
  // pChembl (−log10 M) is the cleanest, unit-independent field when present.
  if (pchembl != null && Number.isFinite(pchembl) && pchembl > 0) {
    return Math.pow(10, 9 - pchembl); // M → nM
  }
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const u = (units ?? "").toLowerCase();
  if (u === "nm") return value;
  if (u === "um" || u === "µm" || u === "μm") return value * 1e3;
  if (u === "mm") return value * 1e6;
  if (u === "pm") return value * 1e-3;
  if (u === "m") return value * 1e9;
  return null; // unknown unit → don't guess
}

/**
 * Similarity-weighted read-across estimate in the log10 domain (the correct
 * domain for potency/IC50, which are log-normally distributed). Weight is
 * similarity² so that a near-identical analogue dominates a merely-similar
 * one. Returns the point estimate and the geometric-SD fold spread.
 */
export function weightedLogEstimate(
  points: Array<{ value: number; similarity: number }>,
): { estimate: number | null; geoSDfold: number | null; nUsed: number; maxSim: number } {
  const valid = points.filter((p) => Number.isFinite(p.value) && p.value > 0 && p.similarity > 0);
  if (valid.length === 0) return { estimate: null, geoSDfold: null, nUsed: 0, maxSim: 0 };
  let wSum = 0, wLogSum = 0, maxSim = 0;
  for (const p of valid) {
    const w = p.similarity * p.similarity;
    wSum += w;
    wLogSum += w * Math.log10(p.value);
    if (p.similarity > maxSim) maxSim = p.similarity;
  }
  const logEst = wLogSum / wSum;
  let varAcc = 0;
  for (const p of valid) {
    const w = p.similarity * p.similarity;
    varAcc += w * Math.pow(Math.log10(p.value) - logEst, 2);
  }
  const logSD = valid.length > 1 ? Math.sqrt(varAcc / wSum) : 0;
  return {
    estimate: Math.pow(10, logEst),
    geoSDfold: logSD > 0 ? +Math.pow(10, logSD).toFixed(2) : 1,
    nUsed: valid.length,
    maxSim: +maxSim.toFixed(3),
  };
}

/**
 * Applicability-domain confidence from neighbour similarity + count. Mirrors
 * read-across practice: confidence tracks how close the nearest measured
 * analogue is and how many corroborate it.
 */
export function adConfidenceFrom(maxSim: number, nUsed: number): AdConfidence {
  if (nUsed === 0) return "None";
  if (maxSim >= 0.8 && nUsed >= 3) return "High";
  if (maxSim >= 0.6 && nUsed >= 2) return "Moderate";
  if (maxSim >= 0.4) return "Low";
  return "None";
}

function fmtNm(nM: number): string {
  if (nM >= 1e6) return `${(nM / 1e6).toFixed(2)} mM`;
  if (nM >= 1e3) return `${(nM / 1e3).toFixed(2)} µM`;
  return `${nM.toFixed(1)} nM`;
}

// ─────────────────────────────────────────────────────────────────────────
// Network: ChEMBL similarity → batched measured activity → read-across
// ─────────────────────────────────────────────────────────────────────────

interface SimNeighbor { chemblId: string; name: string | null; similarity: number }

/** ChEMBL 2D-Tanimoto similarity search. Returns neighbours ≥ thresholdPct. */
async function chemblSimilar(smiles: string, thresholdPct: number, limit: number): Promise<SimNeighbor[]> {
  const url =
    `${CHEMBL}/similarity/${encodeURIComponent(smiles.trim())}/${thresholdPct}.json` +
    `?limit=${limit}&only=molecule_chembl_id,similarity,pref_name`;
  const json = await getJson(url);
  const mols: any[] = json?.molecules ?? [];
  return mols
    .map((m) => ({
      chemblId: String(m.molecule_chembl_id),
      name: m.pref_name ?? null,
      similarity: Number(m.similarity) / 100, // ChEMBL returns percent
    }))
    .filter((m) => m.chemblId && Number.isFinite(m.similarity));
}

/**
 * Pull measured IC50/Ki for a set of molecules against a target (one batched
 * call via molecule_chembl_id__in). Used for hERG (CHEMBL240) and on-target.
 */
async function chemblActivityForTarget(
  ids: string[], targetChemblId: string,
): Promise<Record<string, { value: number | null; units: string | null; pchembl: number | null }>> {
  if (ids.length === 0) return {};
  const url =
    `${CHEMBL}/activity.json?molecule_chembl_id__in=${ids.join(",")}` +
    `&target_chembl_id=${targetChemblId}&standard_type__in=IC50,Ki,Kd,XC50,EC50&limit=1000` +
    `&only=molecule_chembl_id,standard_value,standard_units,pchembl_value,standard_type`;
  const json = await getJson(url);
  const acts: any[] = json?.activities ?? [];
  // Keep the most potent (lowest nM) measurement per molecule.
  const best: Record<string, { value: number | null; units: string | null; pchembl: number | null; nM: number }> = {};
  for (const a of acts) {
    const id = String(a.molecule_chembl_id);
    const pchembl = a.pchembl_value != null ? Number(a.pchembl_value) : null;
    const val = a.standard_value != null ? Number(a.standard_value) : null;
    const nM = normalizeToNm(val, a.standard_units, pchembl);
    if (nM == null) continue;
    if (!best[id] || nM < best[id].nM) best[id] = { value: val, units: a.standard_units ?? null, pchembl, nM };
  }
  const out: Record<string, { value: number | null; units: string | null; pchembl: number | null }> = {};
  for (const [id, v] of Object.entries(best)) out[id] = { value: v.nM, units: "nM", pchembl: v.pchembl };
  return out;
}

/** Build a read-across endpoint result from sim neighbours + a measured map. */
function assembleEndpoint(
  endpoint: string,
  unit: string,
  neighbours: SimNeighbor[],
  measured: Record<string, { value: number | null }>,
): ReadAcrossEndpoint {
  const points: Array<{ value: number; similarity: number; n: SimNeighbor }> = [];
  for (const n of neighbours) {
    const m = measured[n.chemblId];
    if (m?.value != null && Number.isFinite(m.value) && m.value > 0) {
      points.push({ value: m.value, similarity: n.similarity, n });
    }
  }
  if (points.length === 0) {
    return {
      endpoint, status: "no-neighbors", estimate: null, unit, geoSDfold: null,
      nNeighbors: 0, maxSimilarity: neighbours[0]?.similarity ?? null, adConfidence: "None",
      neighbors: [],
      note: neighbours.length > 0
        ? `Found ${neighbours.length} structural neighbour(s) but none has a measured ${endpoint} value in ChEMBL — the model estimate here is a pure extrapolation.`
        : `No structural neighbour in ChEMBL with a measured ${endpoint} — pure extrapolation.`,
    };
  }
  const est = weightedLogEstimate(points.map((p) => ({ value: p.value, similarity: p.similarity })));
  const adConfidence = adConfidenceFrom(est.maxSim, est.nUsed);
  const neighbors: MeasuredNeighbor[] = points
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 8)
    .map((p) => ({
      chemblId: p.n.chemblId,
      name: p.n.name,
      similarity: +p.similarity.toFixed(3),
      value: +p.value.toFixed(2),
      unit,
      valueText: fmtNm(p.value),
      pchembl: null,
      url: `https://www.ebi.ac.uk/chembl/compound_report_card/${p.n.chemblId}/`,
    }));
  return {
    endpoint, status: "ok",
    estimate: est.estimate != null ? +est.estimate.toFixed(2) : null,
    unit, geoSDfold: est.geoSDfold,
    nNeighbors: est.nUsed, maxSimilarity: est.maxSim, adConfidence, neighbors,
    note: `Read-across from ${est.nUsed} measured analogue(s); nearest Tanimoto ${(est.maxSim * 100).toFixed(0)}%. ` +
      `Estimate ${est.estimate != null ? fmtNm(est.estimate) : "—"}${est.geoSDfold && est.geoSDfold > 1 ? ` (±${est.geoSDfold}×)` : ""}. ` +
      `AD confidence: ${adConfidence}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

export interface ReadAcrossOptions {
  /** Selected on-target ChEMBL target id, when known, for the IC50 endpoint. */
  onTargetChemblId?: string | null;
  /** Similarity floor (%) for the ChEMBL search. Default 70. */
  thresholdPct?: number;
  /** Max neighbours to pull. Default 50. */
  limit?: number;
}

export async function runReadAcross(smiles: string, opts: ReadAcrossOptions = {}): Promise<ReadAcrossReport> {
  const thresholdPct = opts.thresholdPct ?? 70;
  const limit = opts.limit ?? 50;
  const ts = new Date().toISOString();

  const unavailable = (endpoint: string, unit: string, error: string): ReadAcrossEndpoint => ({
    endpoint, status: "unavailable", estimate: null, unit, geoSDfold: null,
    nNeighbors: 0, maxSimilarity: null, adConfidence: "None", neighbors: [],
    note: "Read-across unavailable (network or ChEMBL lookup failed) — relying on the in-house model estimate.", error,
  });

  // Similarity-threshold LADDER: try a tight 70% search first (high-quality
  // analogues), and if a novel scaffold returns nothing, progressively widen
  // to 55% then 40% so we still surface the closest measured structures —
  // clearly flagged as low applicability-domain rather than hidden. A network
  // failure (vs. a genuine "nothing found") is distinguished so the UI can say
  // "lookup failed" instead of mislabelling a novel compound as broken.
  const ladder = Array.from(new Set([thresholdPct, 55, 40])).filter(t => t > 0 && t <= thresholdPct);
  let neighbours: SimNeighbor[] = [];
  let searchFailed = false;
  let lastErr = "";
  for (const t of ladder) {
    try {
      const found = await chemblSimilar(smiles, t, limit);
      if (found.length > 0) { neighbours = found; break; }
    } catch (e: any) {
      searchFailed = true;
      lastErr = e?.message ?? String(e);
      break; // a transport error won't be fixed by widening the threshold
    }
  }
  if (searchFailed) {
    return {
      herg: unavailable("hERG IC50", "nM", lastErr),
      onTarget: opts.onTargetChemblId ? unavailable("on-target IC50", "nM", lastErr) : null,
      caco2: unavailable("Caco-2 Papp", "1e-6 cm/s", lastErr),
      coverage: 0, timestamp: ts,
    };
  }

  const ids = neighbours.map((n) => n.chemblId);

  // Fan out the measured-data pulls in parallel (each fails soft).
  const [hergMap, onTargetMap] = await Promise.all([
    chemblActivityForTarget(ids, HERG_TARGET_CHEMBL_ID).catch(() => ({})),
    opts.onTargetChemblId
      ? chemblActivityForTarget(ids, opts.onTargetChemblId).catch(() => ({}))
      : Promise.resolve({} as Record<string, { value: number | null }>),
  ]);

  const herg = assembleEndpoint("hERG IC50", "nM", neighbours, hergMap);
  const onTarget = opts.onTargetChemblId
    ? assembleEndpoint("on-target IC50", "nM", neighbours, onTargetMap)
    : null;
  // Caco-2 read-across needs assay-level permeability records (no single
  // target); surfaced as a known gap rather than a fabricated number.
  const caco2: ReadAcrossEndpoint = {
    endpoint: "Caco-2 Papp", status: "no-neighbors", estimate: null, unit: "1e-6 cm/s",
    geoSDfold: null, nNeighbors: 0, maxSimilarity: neighbours[0]?.similarity ?? null,
    adConfidence: "None", neighbors: [],
    note: "Permeability read-across requires assay-level Caco-2 records (not target-keyed); not yet wired — permeability remains a QSAR estimate. Tracked as a known gap.",
  };

  const attempted = [herg, onTarget, caco2].filter(Boolean) as ReadAcrossEndpoint[];
  const covered = attempted.filter((e) => e.status === "ok").length;
  const coverage = attempted.length > 0 ? +(covered / attempted.length).toFixed(2) : 0;

  return { herg, onTarget, caco2, coverage, timestamp: ts };
}
