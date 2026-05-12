/**
 * openFDA FAERS adapter.
 *
 *   Base: https://api.fda.gov/drug/event.json
 *   Docs: https://open.fda.gov/apis/drug/event/
 *
 * Replaces the "Toxicity Signal Detection · FAERS cross-reference" toggle in
 * Layer 1/2 (previously just a UI label) with actual disproportionality
 * mining on the FDA Adverse Event Reporting System.
 *
 * What we compute:
 *
 *   - Proportional Reporting Ratio (PRR) — Evans, Waller, Davis 2001:
 *       PRR = (a / (a+b)) / (c / (c+d))
 *     where a = reports with drug X and AE Y,
 *           b = reports with drug X but not AE Y,
 *           c = reports with AE Y but not drug X,
 *           d = reports with neither.
 *     A PRR > 2, χ² > 4, and ≥ 3 case counts is the classic FDA signal
 *     threshold.
 *
 *   - Reporting Odds Ratio (ROR) — Rothman 2004:
 *       ROR = (a/c) / (b/d) with 95% CI = exp(ln(ROR) ± 1.96·√(1/a+1/b+1/c+1/d)).
 *
 *   - Information Component (IC) — Bate 1998, BCPNN (used by WHO VigiBase).
 *
 * Note: openFDA enforces 240 requests/minute/IP without a key (~4/s).
 */

import { fetchJson } from "../chem/data/http";

const BASE = "https://api.fda.gov/drug/event.json";

export type SignalRow = {
  readonly drug: string;
  readonly adverseEvent: string;
  /** Case count (a). */
  readonly cases: number;
  readonly prr: number;
  readonly prrChiSq: number;
  readonly ror: number;
  readonly rorCI95: readonly [number, number];
  readonly ic: number; // Information Component (BCPNN)
  /** "signal" if PRR > 2 AND chi² > 4 AND cases ≥ 3 (Evans 2001). */
  readonly isSignal: boolean;
  readonly source: "openFDA FAERS";
  readonly url: string;
};

type CountPayload = {
  results?: Array<{ term: string; count: number }>;
};

async function totalReports(): Promise<number> {
  // Use a known-no-op filter so we get the total count.
  const r = await fetchJson<CountPayload>(
    `${BASE}?count=patient.drug.medicinalproduct.exact&limit=1`,
    { namespace: "openfda", rps: 4, ttl: 12 * 60 * 60 * 1000 },
  );
  return r.results?.[0]?.count ?? 0;
}

async function countDrug(drug: string): Promise<number> {
  const url = `${BASE}?search=patient.drug.medicinalproduct:"${encodeURIComponent(drug)}"&limit=1`;
  try {
    const r = await fetchJson<{ meta?: { results?: { total?: number } } }>(url, {
      namespace: "openfda", rps: 4, ttl: 6 * 60 * 60 * 1000,
    });
    return r.meta?.results?.total ?? 0;
  } catch { return 0; }
}

async function countDrugAE(drug: string, ae: string): Promise<number> {
  const q = `patient.drug.medicinalproduct:"${encodeURIComponent(drug)}"+AND+patient.reaction.reactionmeddrapt:"${encodeURIComponent(ae)}"`;
  const url = `${BASE}?search=${q}&limit=1`;
  try {
    const r = await fetchJson<{ meta?: { results?: { total?: number } } }>(url, {
      namespace: "openfda", rps: 4, ttl: 6 * 60 * 60 * 1000,
    });
    return r.meta?.results?.total ?? 0;
  } catch { return 0; }
}

async function countAE(ae: string): Promise<number> {
  const url = `${BASE}?search=patient.reaction.reactionmeddrapt:"${encodeURIComponent(ae)}"&limit=1`;
  try {
    const r = await fetchJson<{ meta?: { results?: { total?: number } } }>(url, {
      namespace: "openfda", rps: 4, ttl: 6 * 60 * 60 * 1000,
    });
    return r.meta?.results?.total ?? 0;
  } catch { return 0; }
}

/**
 * Top adverse-event terms for a drug, ranked by FAERS report count.
 */
export async function topAdverseEvents(
  drug: string,
  limit: number = 25,
): Promise<Array<{ term: string; count: number }>> {
  const url = `${BASE}?search=patient.drug.medicinalproduct:"${encodeURIComponent(drug)}"&count=patient.reaction.reactionmeddrapt.exact&limit=${limit}`;
  const r = await fetchJson<CountPayload>(url, {
    namespace: "openfda", rps: 4, ttl: 6 * 60 * 60 * 1000,
  });
  return r.results ?? [];
}

/**
 * Mine FAERS for disproportionality signals for a drug's top adverse events.
 * Returns sorted by PRR descending, with PRR/ROR/IC and signal classification.
 */
export async function mineFAERSSignals(drug: string, topN: number = 15): Promise<SignalRow[]> {
  const [total, drugTotal, top] = await Promise.all([
    totalReports(),
    countDrug(drug),
    topAdverseEvents(drug, topN),
  ]);
  if (drugTotal === 0 || top.length === 0) return [];

  const out: SignalRow[] = [];
  for (const { term: ae, count: a } of top) {
    const c = (await countAE(ae)) - a; // AE without this drug
    const b = drugTotal - a;            // drug without this AE
    const d = total - a - b - c;        // neither

    if (a < 1 || b < 1 || c < 1 || d < 1) continue;

    const prr = (a / (a + b)) / (c / (c + d));
    // Chi-squared with Yates' correction
    const expectedA = ((a + b) * (a + c)) / total;
    const prrChiSq = total > 0
      ? Math.pow(Math.abs(a - expectedA) - 0.5, 2) / expectedA
      : 0;

    const ror = (a * d) / (b * c);
    const seLnRor = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
    const rorCI: [number, number] = [
      Math.exp(Math.log(ror) - 1.96 * seLnRor),
      Math.exp(Math.log(ror) + 1.96 * seLnRor),
    ];

    // BCPNN Information Component (Bate 1998), Bayesian shrinkage.
    const ic = Math.log2((a + 0.5) * (total + 2) / ((a + b + 1) * (a + c + 1))) ;

    const isSignal = prr > 2 && prrChiSq > 4 && a >= 3;

    out.push({
      drug, adverseEvent: ae,
      cases: a, prr, prrChiSq, ror, rorCI95: rorCI, ic,
      isSignal,
      source: "openFDA FAERS",
      url: `https://open.fda.gov/data/faers/`,
    });
  }
  return out.sort((x, y) => y.prr - x.prr);
}
