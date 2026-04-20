// EPA CCTE Hazard (ToxRefDB / ToxValDB mirror)
// Real measured NOAEL/LOAEL from animal studies — ground truth for Layer 2 safety margin.

export interface ToxRefRecord {
  studyType: string;
  species: string;          // rat | mouse | rabbit | dog
  toxValType: "NOAEL" | "LOAEL" | "LD50" | "other";
  value_mgKgDay: number;
  exposureRoute: string;
  durationDays: number | null;
  criticalEffect: string;
}

export interface ToxRefResult {
  dtxsid: string | null;
  preferredName: string | null;
  records: ToxRefRecord[];
  noaelMin: number | null;     // most-conservative NOAEL across studies
  loaelMin: number | null;
  speciesCovered: string[];
  status: "live" | "no-data" | "unresolved" | "error";
}

const ANIMAL_SPECIES = ["rat", "mouse", "rabbit", "dog"];

function mapToxValType(t: string | undefined): ToxRefRecord["toxValType"] {
  if (!t) return "other";
  const u = t.toUpperCase();
  if (u.includes("NOAEL") || u.includes("NOEL")) return "NOAEL";
  if (u.includes("LOAEL") || u.includes("LOEL")) return "LOAEL";
  if (u.includes("LD50")) return "LD50";
  return "other";
}

async function resolveDtxsid(inchiKey: string | undefined, name: string | undefined): Promise<{ dtxsid: string | null; preferredName: string | null }> {
  const params = new URLSearchParams();
  if (inchiKey) params.set("inchikey", inchiKey);
  else if (name) params.set("name", name);
  else return { dtxsid: null, preferredName: null };
  try {
    const r = await fetch(`/api/ccte/resolve?${params.toString()}`);
    if (!r.ok) return { dtxsid: null, preferredName: null };
    const j = await r.json();
    return { dtxsid: j?.dtxsid ?? null, preferredName: j?.preferredName ?? null };
  } catch {
    return { dtxsid: null, preferredName: null };
  }
}

export async function fetchToxRef(opts: { inchiKey?: string; name?: string }): Promise<ToxRefResult> {
  const base: ToxRefResult = {
    dtxsid: null, preferredName: null, records: [], noaelMin: null, loaelMin: null, speciesCovered: [], status: "unresolved",
  };
  const { dtxsid, preferredName } = await resolveDtxsid(opts.inchiKey, opts.name);
  if (!dtxsid) return base;

  try {
    const r = await fetch(`/api/ccte/hazard/${encodeURIComponent(dtxsid)}`);
    if (!r.ok) return { ...base, dtxsid, preferredName, status: "error" };
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) {
      return { ...base, dtxsid, preferredName, status: "no-data" };
    }

    const records: ToxRefRecord[] = data
      .map((rec: any) => {
        const sp = String(rec.species ?? "").toLowerCase();
        if (!ANIMAL_SPECIES.some(a => sp.includes(a))) return null;
        const v = parseFloat(String(rec.toxvalNumeric ?? rec.toxval_numeric ?? rec.value ?? ""));
        if (!isFinite(v) || v <= 0) return null;
        const speciesCanonical = ANIMAL_SPECIES.find(a => sp.includes(a)) ?? sp;
        return {
          studyType: rec.studyType ?? rec.study_type ?? "—",
          species: speciesCanonical,
          toxValType: mapToxValType(rec.toxvalType ?? rec.toxval_type),
          value_mgKgDay: v,
          exposureRoute: rec.exposureRoute ?? rec.exposure_route ?? "oral",
          durationDays: parseFloat(String(rec.studyDuration ?? rec.study_duration_value ?? "")) || null,
          criticalEffect: rec.criticalEffect ?? rec.critical_effect ?? "—",
        } as ToxRefRecord;
      })
      .filter((r: ToxRefRecord | null): r is ToxRefRecord => r !== null);

    const noaels = records.filter(r => r.toxValType === "NOAEL").map(r => r.value_mgKgDay);
    const loaels = records.filter(r => r.toxValType === "LOAEL").map(r => r.value_mgKgDay);

    return {
      dtxsid,
      preferredName,
      records,
      noaelMin: noaels.length ? Math.min(...noaels) : null,
      loaelMin: loaels.length ? Math.min(...loaels) : null,
      speciesCovered: Array.from(new Set(records.map(r => r.species))),
      status: records.length > 0 ? "live" : "no-data",
    };
  } catch {
    return { ...base, dtxsid, preferredName, status: "error" };
  }
}

// Validate predicted NOAEL against measured ToxRefDB.
// Returns fold-error and a confidence score (1.0 within 2-fold, 0.5 within 5-fold, 0.2 worse).
export function validateNoaelPrediction(predictedNoael: number, measured: ToxRefResult): {
  measuredNoael: number | null;
  foldError: number | null;
  confidence: number;
} {
  if (measured.noaelMin == null || predictedNoael <= 0) {
    return { measuredNoael: null, foldError: null, confidence: 0 };
  }
  const fold = Math.max(predictedNoael, measured.noaelMin) / Math.min(predictedNoael, measured.noaelMin);
  let conf = 0;
  if (fold <= 2) conf = 1.0;
  else if (fold <= 5) conf = 0.5;
  else if (fold <= 10) conf = 0.25;
  else conf = 0.1;
  return { measuredNoael: measured.noaelMin, foldError: fold, confidence: conf };
}
