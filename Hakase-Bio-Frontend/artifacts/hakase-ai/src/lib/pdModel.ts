/**
 * PD Response Model — ChEMBL Bioactivity → Emax Parameters
 *
 * Fetches experimental IC50 / EC50 / Ki values from ChEMBL for a known drug
 * (using the most similar approved drug from simResults.similarDrugs).
 * Derives Emax model parameters:
 *   E(C) = Emax * C^n / (EC50^n + C^n)
 *
 * ChEMBL Activity API (free, CORS-enabled):
 *   https://www.ebi.ac.uk/chembl/api/data/activity.json?molecule_chembl_id=CHEMBL...
 *
 * Unit conversion:
 *   IC50 [nM] → EC50 [μg/mL] = IC50 [nM] × MW [g/mol] × 1e-6
 *   (consistent with cohortSim cmax units: mg_dose / (Vdss_L_per_kg × BW_kg) = mg/L = μg/mL)
 */

const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";

export interface ChEMBLActivity {
  type:     string;  // IC50, EC50, Ki
  value:    number;  // nM
  target:   string;
  assay:    string;
}

export interface PDParameters {
  emax:           number;    // 0–1 (normalised maximum effect)
  ec50_nM:        number;    // nM (raw from ChEMBL, for display)
  ec50_ugmL:      number;    // μg/mL (for Emax computation vs cmax)
  hillCoeff:      number;    // Hill exponent, typically 1–2
  source:         "chembl-live" | "estimated";
  drugQueried:    string;    // drug name actually queried
  activities:     ChEMBLActivity[];
}

// Known ChEMBL IDs for commonly referenced kinase inhibitors
const DRUG_CHEMBL: Record<string, string> = {
  "erlotinib":    "CHEMBL553",
  "gefitinib":    "CHEMBL939",
  "osimertinib":  "CHEMBL3353410",
  "lapatinib":    "CHEMBL554",
  "neratinib":    "CHEMBL180022",
  "ibrutinib":    "CHEMBL1873475",
  "zanubrutinib": "CHEMBL4523769",
  "acalabrutinib":"CHEMBL3882310",
  "imatinib":     "CHEMBL941",
  "dasatinib":    "CHEMBL1421",
  "nilotinib":    "CHEMBL255863",
  "palbociclib":  "CHEMBL189963",
  "ribociclib":   "CHEMBL3545062",
  "abemaciclib":  "CHEMBL3301610",
  "sotorasib":    "CHEMBL4523582",
  "adagrasib":    "CHEMBL4523583",
  "vemurafenib":  "CHEMBL1229517",
  "dabrafenib":   "CHEMBL2028658",
  "encorafenib":  "CHEMBL3707321",
};

async function fetchActivitiesForChEMBLId(
  chemblId: string,
): Promise<ChEMBLActivity[]> {
  const params = new URLSearchParams({
    molecule_chembl_id: chemblId,
    standard_type__in:  "IC50,EC50,Ki",
    assay_type:         "B",
    limit:              "10",
  });
  const res = await fetch(`${CHEMBL_BASE}/activity.json?${params}`, {
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`ChEMBL activity ${res.status}`);
  const json = await res.json();
  const activities: Array<Record<string, any>> = json?.activities ?? [];

  return activities
    .filter(a => a.standard_value != null && Number(a.standard_value) > 0)
    .map(a => ({
      type:   a.standard_type ?? "IC50",
      value:  parseFloat(a.standard_value),      // reported in nM by ChEMBL
      target: a.target_pref_name ?? "Unknown",
      assay:  a.assay_chembl_id ?? "",
    }))
    .slice(0, 5);
}

/**
 * Derive PD parameters from ChEMBL bioactivity data.
 *
 * @param similarDrugs  List of known similar drugs (from simResults.similarDrugs)
 * @param mw            Molecular weight of the query compound (g/mol)
 * @param baseSeed      Deterministic seed for fallback estimates
 */
export async function fetchPDParameters(
  similarDrugs: string[],
  mw: number,
  baseSeed: number,
): Promise<PDParameters> {

  // Try each similar drug in order until we get activities
  for (const drug of similarDrugs) {
    const key = drug.toLowerCase();
    const chemblId = DRUG_CHEMBL[key];
    if (!chemblId) continue;

    try {
      const activities = await fetchActivitiesForChEMBLId(chemblId);
      if (!activities.length) continue;

      // Take geometric mean of IC50/Ki values (most conservative potency estimate)
      const values = activities
        .filter(a => ["IC50", "Ki"].includes(a.type))
        .map(a => a.value);

      if (!values.length) continue;

      const geoMean = Math.exp(values.reduce((s, v) => s + Math.log(Math.max(v, 0.01)), 0) / values.length);
      const ec50_nM   = Math.max(0.01, geoMean);
      const ec50_ugmL = ec50_nM * mw * 1e-6; // nM → μg/mL

      // Emax: potent drugs (low Ki) → high Emax; weak → lower ceiling
      const emax = Math.min(0.98, Math.max(0.30, 1 - Math.log10(Math.max(ec50_nM, 0.1)) / 10));

      // Hill coefficient: steeper for covalent/irreversible binders
      const hillCoeff = activities.some(a => a.type === "IC50" && a.value < 10) ? 1.8 : 1.2;

      return {
        emax, ec50_nM, ec50_ugmL, hillCoeff,
        source: "chembl-live",
        drugQueried: drug,
        activities,
      };
    } catch {
      continue;
    }
  }

  // Fallback: estimate from seed (same approach as before but explicit)
  const pseudo = (Math.sin(baseSeed * 9301 + 49297) * 233280);
  const f = pseudo - Math.floor(pseudo);
  const ec50_nM = 10 + f * 990; // 10–1000 nM estimated range
  const ec50_ugmL = ec50_nM * mw * 1e-6;

  return {
    emax:       0.70 + f * 0.20,
    ec50_nM,
    ec50_ugmL,
    hillCoeff:  1.2 + f * 0.5,
    source:     "estimated",
    drugQueried: similarDrugs[0] ?? "unknown",
    activities: [],
  };
}

/**
 * Compute Emax model effect at a given concentration.
 * E(C) = Emax * C^n / (EC50^n + C^n)
 * @param c     concentration (μg/mL)
 * @param pd    PD parameters (ec50_ugmL, emax, hillCoeff)
 */
export function emaxEffect(c: number, pd: PDParameters): number {
  if (c <= 0) return 0;
  const cn    = Math.pow(c, pd.hillCoeff);
  const ec50n = Math.pow(Math.max(pd.ec50_ugmL, 1e-9), pd.hillCoeff);
  return pd.emax * cn / (ec50n + cn);
}
