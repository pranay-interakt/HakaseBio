const BASE = "https://api.fda.gov";

export interface FAERSReaction {
  term: string;
  count: number;
  rate: number;
}

export interface DrugsAtFDAResult {
  appNumber: string;
  reviewType: "PRIORITY" | "STANDARD";
  approvalYear?: string;
}

export interface DrugLabelResult {
  boxedWarning: boolean;
}

async function safeFetch(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchFAERSReactions(
  drugName: string,
  limit = 8
): Promise<{ reactions: FAERSReaction[]; totalReports: number }> {
  const enc = encodeURIComponent(`"${drugName.toLowerCase()}"`);
  const [totalData, countData] = await Promise.all([
    safeFetch(`${BASE}/drug/event.json?search=patient.drug.openfda.generic_name:${enc}&limit=1`),
    safeFetch(`${BASE}/drug/event.json?search=patient.drug.openfda.generic_name:${enc}&count=patient.reaction.reactionmeddrapt.exact&limit=${limit}`),
  ]);

  const totalReports = (totalData as any)?.meta?.results?.total ?? 0;
  const rows: Array<{ term: string; count: number }> = (countData as any)?.results ?? [];
  const reactions: FAERSReaction[] = rows.map(r => ({
    term: r.term,
    count: r.count,
    rate: totalReports > 0 ? r.count / totalReports : 0,
  }));

  return { reactions, totalReports };
}

export async function fetchDrugsAtFDA(
  drugs: string[]
): Promise<Record<string, DrugsAtFDAResult>> {
  const results = await Promise.all(
    drugs.slice(0, 4).map(async drug => {
      const enc = encodeURIComponent(drug.toLowerCase());
      const data = await safeFetch(
        `${BASE}/drug/drugsfda.json?search=openfda.generic_name:"${enc}"&limit=1`
      );
      const r = (data as any)?.results?.[0];
      if (!r) return { drug, result: null };

      const subs: Array<{ submission_type?: string; review_priority?: string; submission_status_date?: string }> =
        r.submissions ?? [];
      const orig =
        subs.find(s => s.submission_type === "ORIG" || s.submission_type?.startsWith("ORIG-")) ??
        subs[0];

      return {
        drug,
        result: {
          appNumber: r.application_number ?? "—",
          reviewType: (orig?.review_priority === "PRIORITY" ? "PRIORITY" : "STANDARD") as "PRIORITY" | "STANDARD",
          approvalYear: orig?.submission_status_date?.slice(0, 4),
        } satisfies DrugsAtFDAResult,
      };
    })
  );

  const map: Record<string, DrugsAtFDAResult> = {};
  results.forEach(({ drug, result }) => { if (result) map[drug] = result; });
  return map;
}

export async function fetchDrugLabels(
  drugs: string[]
): Promise<Record<string, DrugLabelResult>> {
  const results = await Promise.all(
    drugs.slice(0, 4).map(async drug => {
      const enc = encodeURIComponent(drug.toLowerCase());
      const data = await safeFetch(
        `${BASE}/drug/label.json?search=openfda.generic_name:"${enc}"&limit=1`
      );
      const r = (data as any)?.results?.[0];
      return { drug, result: { boxedWarning: !!(r?.boxed_warning) } satisfies DrugLabelResult };
    })
  );

  const map: Record<string, DrugLabelResult> = {};
  results.forEach(({ drug, result }) => { map[drug] = result; });
  return map;
}
