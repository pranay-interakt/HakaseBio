/**
 * FDA FAERS Adverse Event Signal Fetcher
 * Uses the openFDA Drug Event API (public, no auth required).
 * https://open.fda.gov/apis/drug/event/
 *
 * Strategy:
 *   1. Query by drug brand/generic name → get top MedDRA reaction terms + counts
 *   2. Normalise counts to frequencies (relative to total reports)
 *   3. Map MedDRA terms to display names and assign a severity grade
 *
 * Rate limits: 240 req/min (unauthenticated), CORS supported.
 */

export interface FAERSSignal {
  term:       string;    // MedDRA preferred term (display-ready)
  count:      number;    // absolute report count
  frequency:  number;    // 0–1, relative to total in query
  grade3Est:  number;    // estimated grade-3+ fraction (heuristic)
  color:      string;    // display colour
}

export interface FAERSResult {
  signals:   FAERSSignal[];
  drugName:  string;
  totalHits: number;
  source:    "faers-live" | "faers-fallback";
}

const OPENFDA = "https://api.fda.gov/drug/event.json";

// MedDRA term → human-readable label + colour
const TERM_MAP: Record<string, { label: string; color: string; grade3Factor: number }> = {
  "fatigue":                     { label: "Fatigue",          color: "#8b5cf6", grade3Factor: 0.10 },
  "nausea":                      { label: "Nausea",           color: "#3b82f6", grade3Factor: 0.08 },
  "diarrhoea":                   { label: "Diarrhoea",        color: "#06b6d4", grade3Factor: 0.12 },
  "diarrhea":                    { label: "Diarrhoea",        color: "#06b6d4", grade3Factor: 0.12 },
  "alanine aminotransferase increased": { label: "ALT Elevation", color: "#eab308", grade3Factor: 0.18 },
  "rash":                        { label: "Rash",             color: "#f97316", grade3Factor: 0.07 },
  "qt prolongation":             { label: "QTc Prolongation", color: "#ef4444", grade3Factor: 0.15 },
  "electrocardiogram qt prolonged": { label: "QTc Prolongation", color: "#ef4444", grade3Factor: 0.15 },
  "vomiting":                    { label: "Vomiting",         color: "#a855f7", grade3Factor: 0.09 },
  "decreased appetite":          { label: "Decreased Appetite", color: "#64748b", grade3Factor: 0.06 },
  "peripheral neuropathy":       { label: "Peripheral Neuropathy", color: "#e11d48", grade3Factor: 0.22 },
  "hypertension":                { label: "Hypertension",     color: "#dc2626", grade3Factor: 0.25 },
  "anaemia":                     { label: "Anaemia",          color: "#b91c1c", grade3Factor: 0.20 },
  "anemia":                      { label: "Anaemia",          color: "#b91c1c", grade3Factor: 0.20 },
  "constipation":                { label: "Constipation",     color: "#78716c", grade3Factor: 0.05 },
  "headache":                    { label: "Headache",         color: "#6366f1", grade3Factor: 0.06 },
  "dyspnoea":                    { label: "Dyspnoea",         color: "#0ea5e9", grade3Factor: 0.18 },
  "dyspnea":                     { label: "Dyspnoea",         color: "#0ea5e9", grade3Factor: 0.18 },
  "neutropenia":                 { label: "Neutropenia",      color: "#7c3aed", grade3Factor: 0.35 },
  "thrombocytopenia":            { label: "Thrombocytopenia", color: "#be123c", grade3Factor: 0.28 },
  "oedema peripheral":           { label: "Peripheral Oedema", color: "#0284c7", grade3Factor: 0.08 },
  "edema peripheral":            { label: "Peripheral Oedema", color: "#0284c7", grade3Factor: 0.08 },
};

const FALLBACK_AES: FAERSSignal[] = [
  { term: "Fatigue",          count: 0, frequency: 0.42, grade3Est: 0.06,  color: "#8b5cf6" },
  { term: "Nausea",           count: 0, frequency: 0.35, grade3Est: 0.04,  color: "#3b82f6" },
  { term: "Diarrhoea",        count: 0, frequency: 0.28, grade3Est: 0.05,  color: "#06b6d4" },
  { term: "ALT Elevation",    count: 0, frequency: 0.18, grade3Est: 0.03,  color: "#eab308" },
  { term: "Rash",             count: 0, frequency: 0.22, grade3Est: 0.02,  color: "#f97316" },
  { term: "QTc Prolongation", count: 0, frequency: 0.12, grade3Est: 0.015, color: "#ef4444" },
];

function normaliseTerm(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

function mapSignals(
  hits: Array<{ term: string; count: number }>,
  total: number,
): FAERSSignal[] {
  const seen = new Set<string>();
  const out: FAERSSignal[] = [];

  for (const h of hits) {
    const key = normaliseTerm(h.term);
    const mapped = TERM_MAP[key];
    const label  = mapped?.label ?? h.term;
    if (seen.has(label)) continue;
    seen.add(label);

    out.push({
      term:      label,
      count:     h.count,
      frequency: Math.min(0.95, h.count / Math.max(1, total)),
      grade3Est: parseFloat((Math.min(0.45, (mapped?.grade3Factor ?? 0.08))).toFixed(3)),
      color:     mapped?.color ?? "#94a3b8",
    });
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Fetch adverse event signals from openFDA FAERS.
 * drugName: the INN or brand name to query (e.g. "erlotinib", "imatinib").
 * Returns up to 6 signals sorted by frequency descending.
 * Falls back gracefully if the API is unreachable or returns no data.
 */
export async function fetchFAERSSignals(drugName: string): Promise<FAERSResult> {
  const name = drugName.trim();
  if (!name) return { signals: FALLBACK_AES, drugName: name, totalHits: 0, source: "faers-fallback" };

  try {
    const params = new URLSearchParams({
      search: `patient.drug.medicinalproduct:"${name}"`,
      count:  "patient.reaction.reactionmeddrapt.exact",
      limit:  "15",
    });
    const res = await fetch(`${OPENFDA}?${params.toString()}`, {
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) throw new Error(`openFDA: ${res.status}`);
    const json = await res.json();

    const results: Array<{ term: string; count: number }> = json?.results ?? [];
    if (!results.length) throw new Error("no results");

    const total = results.reduce((s: number, r: { count: number }) => s + r.count, 0);
    const signals = mapSignals(results, total);

    if (signals.length < 3) throw new Error("insufficient signals");

    return { signals, drugName: name, totalHits: total, source: "faers-live" };
  } catch {
    return { signals: FALLBACK_AES, drugName: name, totalHits: 0, source: "faers-fallback" };
  }
}
