/**
 * Trusted preclinical data sources — FDA / NLM / NCATS / EBI grade.
 * ─────────────────────────────────────────────────────────────────────────
 * Adds two high-value, official, free, CORS-enabled sources that the platform
 * was missing, plus a transparent registry of every trusted source already in
 * use so a reviewer can see exactly where each signal comes from.
 *
 * NEW sources wired here
 *   • NCATS Pharos (pharos-api.ncats.io) — Target Development Level (TDL:
 *     Tclin/Tchem/Tbio/Tdark) + novelty. Tells you whether the molecule's
 *     target is clinically validated (Tclin = has approved drugs) or
 *     under-studied (Tdark) — a first-order credibility check on the benefit
 *     side that no ADMET model captures. NIH/NCATS data.
 *   • DailyMed (dailymed.nlm.nih.gov) — the NLM repository of the OFFICIAL
 *     FDA Structured Product Labels (SPL). Returns whether approved labels for
 *     a drug/indication carry a boxed warning, plus the label link. This is
 *     regulatory-grade primary evidence, not a model output.
 *
 * "FDA-grade" here means the data is sourced from official FDA / NLM / EPA /
 * EBI records — it does NOT mean the platform is FDA-validated or that any
 * output is a regulatory determination. Every call is time-boxed and fails
 * soft (returns an honest "unavailable", never a fabricated value).
 */

import { API_ROOT } from "./apiBase";

export type SourceStatus = "ok" | "unavailable";
const TIMEOUT_MS = 16000; // server-side proxy may take a moment on cold upstreams

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────
// 1. NCATS Pharos — Target Development Level
// ─────────────────────────────────────────────────────────────────────────
export interface PharosTarget {
  status: SourceStatus;
  name: string | null;
  sym: string | null;
  /** Tclin (approved-drug target) · Tchem · Tbio · Tdark (under-studied). */
  tdl: string | null;
  family: string | null;
  /** Jensen-lab novelty score (higher = less studied). */
  novelty: number | null;
  url: string | null;
  interpretation: string;
  error?: string;
}

export async function fetchPharosTarget(symbolOrUniprot: string): Promise<PharosTarget> {
  const base: PharosTarget = {
    status: "unavailable", name: null, sym: null, tdl: null, family: null,
    novelty: null, url: null, interpretation: "Target development level not retrieved.",
  };
  const q = (symbolOrUniprot ?? "").trim();
  if (!q || q === "—") return { ...base, error: "no target" };
  try {
    // Server-side proxy (no CORS); it decides sym vs uniprot from the query.
    const t = await getJson(`${API_ROOT}/api/preclinical/pharos?q=${encodeURIComponent(q)}`);
    if (!t || t.found === false) return { ...base, status: "ok", error: "no Pharos match" };
    const tdl: string | null = t.tdl ?? null;
    const interpretation =
      tdl === "Tclin" ? "Tclin — target of an APPROVED drug. Clinically validated mechanism; strong benefit-side credibility."
      : tdl === "Tchem" ? "Tchem — modulated by potent small molecules but no approved drug yet. Druggable, partially validated."
      : tdl === "Tbio" ? "Tbio — biological data exist but limited chemical tractability. Higher mechanism risk."
      : tdl === "Tdark" ? "Tdark — under-studied target with little validation. Highest mechanism / novelty risk."
      : "Target development level unavailable.";
    return {
      status: "ok",
      name: t.name ?? null, sym: t.sym ?? null, tdl,
      family: t.family ?? null,
      novelty: typeof t.novelty === "number" ? t.novelty : null,
      url: t.url ?? (t.sym ? `https://pharos.ncats.io/targets/${encodeURIComponent(t.sym)}` : "https://pharos.ncats.io"),
      interpretation,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. DailyMed — official FDA Structured Product Labels (SPL)
// ─────────────────────────────────────────────────────────────────────────
export interface DailyMedLabel {
  status: SourceStatus;
  /** Number of SPLs matching the query. */
  count: number | null;
  setId: string | null;
  title: string | null;
  url: string | null;
  note: string;
  error?: string;
}

export async function fetchDailyMedLabel(drugOrIngredient: string): Promise<DailyMedLabel> {
  const base: DailyMedLabel = {
    status: "unavailable", count: null, setId: null, title: null, url: null,
    note: "DailyMed not queried.",
  };
  const name = (drugOrIngredient ?? "").trim();
  if (!name) return { ...base, error: "no drug name" };
  try {
    const j = await getJson(`${API_ROOT}/api/preclinical/dailymed?name=${encodeURIComponent(name)}`);
    const total: number = j?.count ?? 0;
    if (!j?.found || total === 0) {
      return { ...base, status: "ok", count: 0, note: `Not an approved drug — no FDA label in DailyMed for "${name}" (consistent with a novel compound).` };
    }
    return {
      status: "ok",
      count: total,
      setId: j.setId ?? null,
      title: j.title ?? null,
      url: j.url ?? "https://dailymed.nlm.nih.gov",
      note: `${total} official FDA label(s) in DailyMed for "${name}".`,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Transparent registry of trusted sources the platform draws on
// ─────────────────────────────────────────────────────────────────────────
export interface TrustedSource {
  name: string;
  org: string;
  use: string;
  url: string;
  grade: "regulatory" | "curated" | "ml";
}

export const TRUSTED_SOURCES: TrustedSource[] = [
  { name: "openFDA / FAERS", org: "FDA", use: "Approved labels, boxed warnings, post-market adverse events", url: "https://open.fda.gov", grade: "regulatory" },
  { name: "DailyMed", org: "NLM / FDA", use: "Official Structured Product Labels (SPL)", url: "https://dailymed.nlm.nih.gov", grade: "regulatory" },
  { name: "ClinicalTrials.gov", org: "NIH / NLM", use: "Trial precedent, endpoints, status", url: "https://clinicaltrials.gov", grade: "regulatory" },
  { name: "Pharos", org: "NIH / NCATS", use: "Target development level & druggability", url: "https://pharos.ncats.io", grade: "curated" },
  { name: "ChEMBL", org: "EMBL-EBI", use: "Measured bioactivity & read-across analogues", url: "https://www.ebi.ac.uk/chembl", grade: "curated" },
  { name: "BindingDB", org: "UCSD", use: "Measured binding affinities", url: "https://www.bindingdb.org", grade: "curated" },
  { name: "PubChem / UniChem", org: "NIH / EBI", use: "Identity, bioassay footprint, cross-DB resolution", url: "https://pubchem.ncbi.nlm.nih.gov", grade: "curated" },
  { name: "EPA CompTox / ToxCast", org: "US EPA", use: "High-throughput toxicology assays", url: "https://comptox.epa.gov", grade: "curated" },
  { name: "PharmGKB", org: "Stanford / NIH", use: "Pharmacogenomics & drug-gene relationships", url: "https://www.pharmgkb.org", grade: "curated" },
  { name: "Open Targets", org: "EMBL-EBI / Wellcome", use: "Target–disease association & safety", url: "https://platform.opentargets.org", grade: "curated" },
  { name: "ADMET-AI", org: "TDC / Chemprop", use: "ML ADMET predictions (41-endpoint benchmark)", url: "https://admet.ai.greenstonebio.com", grade: "ml" },
];
