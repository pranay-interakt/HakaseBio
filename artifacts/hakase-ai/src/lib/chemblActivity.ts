export interface ChEMBLTargetActivity {
  targetChemblId: string;
  targetName: string;
  targetType: string;
  activityType: string;
  value_nM: number;
  assayType: string;
  pChembl: number | null;
}

export interface ChEMBLMultiTargetResult {
  compoundChemblId: string;
  compoundName: string;
  targetCount: number;
  activities: ChEMBLTargetActivity[];
  status: "live" | "unavailable" | "error";
}

function parseActivityValue(val: string | number | null | undefined, units: string | null | undefined): number | null {
  if (val == null) return null;
  const n = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(n) || n <= 0) return null;
  if (units === "uM" || units === "µM") return n * 1000;
  if (units === "pM") return n / 1000;
  return n;
}

// ── ChEMBL Animal-PK ────────────────────────────────────────────────────────
// Measured rat/dog/monkey/mouse PK params (AUC, Cmax, CL, t½) from ADME assays.
// Used to validate Layer 2 allometric projections against real data.

export interface ChEMBLAnimalPkRecord {
  assayId: string;
  species: string;
  standardType: string;        // AUC, Cmax, CL, t½, etc.
  standardValue: number;
  standardUnits: string;
  relation: string;
}

export interface ChEMBLAnimalPkResult {
  chemblId: string | null;
  totalRecords: number;
  records: ChEMBLAnimalPkRecord[];
  speciesCovered: string[];
  status: "live" | "no-data" | "unresolved" | "error";
}

export async function fetchChemblAnimalPk(smiles: string): Promise<ChEMBLAnimalPkResult> {
  const base: ChEMBLAnimalPkResult = {
    chemblId: null, totalRecords: 0, records: [], speciesCovered: [], status: "unresolved",
  };
  if (!smiles) return base;
  try {
    const compRes = await fetch(`/api/chembl/compound?smiles=${encodeURIComponent(smiles)}`);
    if (!compRes.ok) return { ...base, status: "error" };
    const compData = await compRes.json();
    const chemblId = compData?.molecules?.[0]?.molecule_chembl_id ?? null;
    if (!chemblId) return base;

    const r = await fetch(`/api/chembl/animal-pk?chembl_id=${encodeURIComponent(chemblId)}`);
    if (!r.ok) return { ...base, chemblId, status: "error" };
    const data = await r.json();
    const records: ChEMBLAnimalPkRecord[] = data?.records ?? [];
    return {
      chemblId,
      totalRecords: records.length,
      records,
      speciesCovered: Array.from(new Set(records.map(r => r.species))),
      status: records.length > 0 ? "live" : "no-data",
    };
  } catch {
    return { ...base, status: "error" };
  }
}

// Validate predicted AUC against measured ChEMBL animal AUC (rat preferred).
// Returns fold-error & confidence score same scale as ToxRef validator.
export function validateAucPrediction(predictedAuc_ngHmL: number, animalPk: ChEMBLAnimalPkResult): {
  measuredAuc: number | null;
  species: string | null;
  foldError: number | null;
  confidence: number;
} {
  if (predictedAuc_ngHmL <= 0 || animalPk.records.length === 0) {
    return { measuredAuc: null, species: null, foldError: null, confidence: 0 };
  }
  // Prefer rat AUC; fall back to first species with AUC
  const aucRecs = animalPk.records.filter(r => r.standardType.toUpperCase().includes("AUC"));
  if (aucRecs.length === 0) return { measuredAuc: null, species: null, foldError: null, confidence: 0 };
  const ratAuc = aucRecs.find(r => r.species.includes("Rattus")) ?? aucRecs[0];
  // Normalize units to ng·h/mL when possible (rough — assumes ng·h/mL or µg·h/mL)
  let measured = ratAuc.standardValue;
  const u = (ratAuc.standardUnits || "").toLowerCase();
  if (u.includes("ug") || u.includes("µg")) measured *= 1000;
  if (u.includes("nmol") || u.includes("mol")) {
    return { measuredAuc: null, species: ratAuc.species, foldError: null, confidence: 0 };
  }
  const fold = Math.max(predictedAuc_ngHmL, measured) / Math.min(predictedAuc_ngHmL, measured);
  let conf = 0;
  if (fold <= 2) conf = 1.0;
  else if (fold <= 5) conf = 0.5;
  else if (fold <= 10) conf = 0.25;
  else conf = 0.1;
  return { measuredAuc: measured, species: ratAuc.species, foldError: fold, confidence: conf };
}

export async function fetchChEMBLMultiTarget(smiles: string): Promise<ChEMBLMultiTargetResult> {
  const base: ChEMBLMultiTargetResult = {
    compoundChemblId: "", compoundName: "", targetCount: 0,
    activities: [], status: "unavailable",
  };

  if (!smiles) return base;

  try {
    const compoundRes = await fetch(`/api/chembl/compound?smiles=${encodeURIComponent(smiles)}`);
    if (!compoundRes.ok) return { ...base, status: "error" };
    const compoundData = await compoundRes.json();

    const molecules = compoundData?.molecules ?? [];
    if (!molecules.length) return base;

    const mol = molecules[0];
    const chemblId = mol.molecule_chembl_id;
    const compoundName = mol.pref_name ?? mol.molecule_chembl_id ?? "";

    const activityRes = await fetch(`/api/chembl/activities?chembl_id=${encodeURIComponent(chemblId)}`);
    if (!activityRes.ok) return { ...base, compoundChemblId: chemblId, compoundName, status: "error" };
    const activityData = await activityRes.json();

    const rawActivities: any[] = activityData?.activities ?? [];

    const targetMap = new Map<string, ChEMBLTargetActivity>();

    for (const act of rawActivities) {
      const targetId = act.target_chembl_id;
      const targetName = act.target_pref_name;
      if (!targetId || !targetName) continue;

      const actType = act.standard_type ?? act.type ?? "";
      const relevantTypes = ["IC50", "Ki", "Kd", "EC50", "IC50", "Inhibition", "Activity"];
      if (!relevantTypes.some(t => actType.toUpperCase().includes(t.toUpperCase()))) continue;

      const valueNm = parseActivityValue(act.standard_value, act.standard_units);
      if (valueNm == null) continue;

      const pChembl = act.pchembl_value != null ? parseFloat(act.pchembl_value) : null;

      const key = `${targetId}__${actType}`;
      const existing = targetMap.get(key);
      if (!existing || (existing.value_nM > valueNm)) {
        targetMap.set(key, {
          targetChemblId: targetId,
          targetName,
          targetType: act.target_type ?? "SINGLE PROTEIN",
          activityType: actType,
          value_nM: valueNm,
          assayType: act.assay_type ?? "B",
          pChembl: pChembl && !isNaN(pChembl) ? pChembl : null,
        });
      }
    }

    const activities = Array.from(targetMap.values())
      .sort((a, b) => a.value_nM - b.value_nM)
      .slice(0, 20);

    const uniqueTargets = new Set(activities.map(a => a.targetChemblId));

    return {
      compoundChemblId: chemblId,
      compoundName,
      targetCount: uniqueTargets.size,
      activities,
      status: activities.length > 0 ? "live" : "unavailable",
    };
  } catch {
    return { ...base, status: "error" };
  }
}
