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
