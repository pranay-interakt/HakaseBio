import { API_ROOT } from "@/lib/apiBase";
/**
 * FdaPsgPanel — FDA Product-Specific Guidance / Bioequivalence Intelligence
 *
 * Shows reference drug status, TE codes, recommended BE methodology,
 * BCS classification context, and direct links to FDA databases.
 * Drop into any page with: <FdaPsgPanel drugName="ibuprofen" />
 */

import { useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BEMethodology {
  methodology: string;
  study_type: string;
  be_window: string;
  fasting: boolean;
  fed: boolean;
  notes: string;
}

interface RLDProduct {
  application_number: string;
  application_type: string;
  sponsor: string;
  brand_name: string;
  dosage_form: string;
  route: string;
  active_ingredients: { name: string; strength: string }[];
  te_code: string | null;
  te_description: string;
  reference_drug: boolean;
  reference_standard: boolean;
  marketing_status: string;
  be_methodology: BEMethodology;
}

interface PSGResult {
  drug_name: string;
  total_apps_found: number;
  reference_listed_drugs: RLDProduct[];
  all_products_sample: RLDProduct[];
  bcs_class: string | null;
  bcs_context: { solubility: string; permeability: string; be_approach: string; biowaiver_eligible: boolean } | null;
  bcs_note: string;
  clinical_pharmacology_snippet: string | null;
  psg_search_url: string;
  dissolution_db_url: string;
  be_window_standard: string;
  be_window_nti: string;
  be_standard_ref: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TEBadge({ code, description }: { code: string | null; description: string }) {
  if (!code) return <span className="text-[10px] text-slate-500 italic">No TE rating</span>;
  const isA = code[0] === "A";
  return (
    <span
      title={description}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
        isA ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25" : "bg-red-500/15 text-red-300 border border-red-500/25"
      }`}
    >
      {code}
    </span>
  );
}

function BCSBadge({ cls }: { cls: string }) {
  const colors: Record<string, string> = {
    I:  "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    II: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    III:"bg-blue-500/15 text-blue-300 border-blue-500/25",
    IV: "bg-red-500/15 text-red-300 border-red-500/25",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${colors[cls] ?? "bg-slate-500/15 text-slate-300 border-slate-500/25"}`}>
      BCS {cls}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[12px]">
      <span className="text-slate-500 shrink-0 w-28">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}

function RLDCard({ product }: { product: RLDProduct }) {
  const [expanded, setExpanded] = useState(false);
  const me = product.be_methodology;

  return (
    <div className="rounded-xl border border-white/8 bg-white/2 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-white">{product.brand_name || product.drug_name}</span>
            {product.reference_drug && (
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">RLD</span>
            )}
            {product.reference_standard && (
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">RS</span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{product.sponsor} · {product.application_number} ({product.application_type})</div>
        </div>
        <TEBadge code={product.te_code} description={product.te_description} />
      </div>

      {/* Core info */}
      <div className="space-y-1.5">
        <InfoRow label="Dosage Form" value={product.dosage_form} />
        <InfoRow label="Route" value={product.route} />
        <InfoRow
          label="Active Ingredient"
          value={product.active_ingredients?.map(ai => `${ai.name} ${ai.strength}`).join(", ") || "—"}
        />
        <InfoRow label="TE Code" value={
          <span title={product.te_description} className="cursor-help">
            {product.te_code || "—"} — {product.te_description.slice(0, 60)}{product.te_description.length > 60 ? "…" : ""}
          </span>
        } />
      </div>

      {/* BE Methodology accordion */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left flex items-center justify-between py-2 border-t border-white/5 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
      >
        <span>Bioequivalence Methodology</span>
        <span>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="space-y-2.5 pt-1">
          <div className="rounded-lg bg-blue-500/8 border border-blue-500/15 p-3 space-y-2">
            <InfoRow label="Approach" value={me.methodology} />
            <InfoRow label="Study Design" value={me.study_type} />
            <InfoRow label="BE Window" value={<span className="font-mono text-emerald-300">{me.be_window}</span>} />
            {me.fasting && <InfoRow label="Fasting arm" value="Required" />}
            {me.fed && <InfoRow label="Fed arm" value="Required" />}
          </div>
          {me.notes && (
            <div className="rounded-lg bg-amber-500/6 border border-amber-500/15 p-3 text-[11px] text-amber-200 leading-relaxed">
              📋 {me.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  drugName?: string;         // optional pre-fill
  compact?: boolean;         // condensed mode for embedding in ADMET results
  predictedBCS?: "I"|"II"|"III"|"IV"; // from Hakase ADMET — overrides label-parsed BCS
}

export function FdaPsgPanel({ drugName: initialDrug = "", compact = false, predictedBCS }: Props) {
  const [query, setQuery]       = useState(initialDrug);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<PSGResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"rld"|"be"|"links">("rld");

  const search = useCallback(async (drug: string) => {
    if (!drug.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`${API_ROOT}/api/fda-psg/search?drug=${encodeURIComponent(drug.trim())}`);
      if (!r.ok) throw new Error(`API error ${r.status}`);
      const data: PSGResult = await r.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Failed to fetch FDA data");
    } finally {
      setLoading(false);
    }
  }, []);

  const resolvedBCS = predictedBCS || result?.bcs_class || null;

  return (
    <div className={`${compact ? "" : "rounded-2xl border border-white/8 bg-[#0c0e15] p-6"} space-y-5`}>

      {/* Header */}
      {!compact && (
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] uppercase tracking-widest font-bold text-blue-400">FDA · Regulatory Intelligence</span>
            </div>
            <h3 className="text-[18px] font-black text-white tracking-tight">Product-Specific Guidance Lookup</h3>
            <p className="text-[12px] text-slate-500 mt-1 max-w-xl">
              Reference Listed Drug (RLD) status, TE codes, recommended bioequivalence methodology, and BCS classification context
              drawn from openFDA and FDA PSG database links.
            </p>
          </div>
        </div>
      )}

      {/* Search box */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search(query)}
          placeholder="Drug or active ingredient (e.g. ibuprofen, atorvastatin...)"
          className="flex-1 bg-white/4 border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/50"
        />
        <button
          onClick={() => search(query)}
          disabled={loading || !query.trim()}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[13px] font-semibold transition-colors"
        >
          {loading ? "…" : "Look up"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/8 p-3 text-[12px] text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] font-semibold text-white">{result.drug_name}</span>
            <span className="text-[11px] text-slate-500">{result.total_apps_found} FDA applications found</span>
            {resolvedBCS && <BCSBadge cls={resolvedBCS} />}
            {result.reference_listed_drugs.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25">
                {result.reference_listed_drugs.length} RLD / RS product{result.reference_listed_drugs.length > 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* BCS context banner (use Hakase prediction if available) */}
          {resolvedBCS && result.bcs_context && (
            <div className="rounded-xl border border-white/8 bg-white/2 p-4">
              <div className="flex items-center gap-2 mb-2">
                <BCSBadge cls={resolvedBCS} />
                <span className="text-[11px] font-semibold text-slate-300">
                  BCS Class {resolvedBCS} — {result.bcs_context.solubility} solubility / {result.bcs_context.permeability} permeability
                </span>
                {predictedBCS && (
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                    from Hakase ADMET
                  </span>
                )}
              </div>
              <p className="text-[12px] text-slate-400 leading-relaxed">{result.bcs_context.be_approach}</p>
              {result.bcs_context.biowaiver_eligible && (
                <div className="mt-2 text-[11px] text-emerald-400 font-medium">
                  ✓ Biowaiver potentially eligible — confirm with PSG and dissolution data
                </div>
              )}
            </div>
          )}
          {!resolvedBCS && (
            <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3 text-[12px] text-amber-300">
              BCS class not found in FDA label text. Run Hakase ADMET predictions (solubility + permeability) to estimate BCS class and then pass it here.
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-white/8">
            {([["rld", "Reference Drugs"], ["be", "BE Methodology"], ["links", "FDA Links"]] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-4 py-2 text-[12px] font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === id
                    ? "border-blue-500 text-blue-300"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab: RLD products */}
          {activeTab === "rld" && (
            <div className="space-y-3">
              {result.reference_listed_drugs.length === 0 ? (
                <div className="text-[12px] text-slate-500 py-4 text-center">
                  No reference listed drugs found in openFDA for "{result.drug_name}".
                  <br />
                  Check the <a href={result.psg_search_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">FDA PSG database directly</a>.
                </div>
              ) : (
                result.reference_listed_drugs.map((p, i) => <RLDCard key={i} product={p} />)
              )}
              {result.all_products_sample.length > 0 && result.reference_listed_drugs.length === 0 && (
                <details className="text-[12px]">
                  <summary className="text-slate-500 cursor-pointer hover:text-slate-300">
                    Show {result.all_products_sample.length} non-RLD products found
                  </summary>
                  <div className="mt-3 space-y-3">
                    {result.all_products_sample.map((p, i) => <RLDCard key={i} product={p} />)}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Tab: BE methodology grid */}
          {activeTab === "be" && (
            <div className="space-y-3">
              {/* Show methodology for each unique dosage form found */}
              {(() => {
                const seen = new Set<string>();
                const forms = [...result.reference_listed_drugs, ...result.all_products_sample]
                  .filter(p => {
                    const key = `${p.dosage_form}::${p.route}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                  });

                return forms.length === 0 ? (
                  <div className="text-[12px] text-slate-500">No dosage form data found.</div>
                ) : (
                  forms.map((p, i) => {
                    const me = p.be_methodology;
                    return (
                      <div key={i} className="rounded-xl border border-white/8 bg-white/2 p-4 space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-semibold text-white">{p.dosage_form}</span>
                          <span className="text-[11px] text-slate-500">({p.route})</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {[
                            ["Approach", me.methodology],
                            ["Study Design", me.study_type],
                            ["BE Window (90% CI)", me.be_window],
                            ["Fasting arm", me.fasting ? "Required" : "Not required"],
                            ["Fed arm", me.fed ? "Required" : "Not required"],
                          ].map(([k, v]) => (
                            <div key={k} className="text-[11px]">
                              <div className="text-slate-500">{k}</div>
                              <div className="text-slate-200 font-medium">{v}</div>
                            </div>
                          ))}
                        </div>
                        {me.notes && (
                          <div className="rounded-lg bg-amber-500/6 border border-amber-500/15 p-2.5 text-[11px] text-amber-200 leading-relaxed">
                            {me.notes}
                          </div>
                        )}
                      </div>
                    );
                  })
                );
              })()}

              {/* BE window reference */}
              <div className="rounded-xl border border-white/6 bg-white/1 p-4 space-y-2">
                <div className="text-[11px] font-semibold text-slate-400">Standard BE Windows</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-slate-500">Standard drugs</div>
                    <div className="text-emerald-300 font-mono">{result.be_window_standard}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Narrow Therapeutic Index</div>
                    <div className="text-amber-300 font-mono">{result.be_window_nti}</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-600">{result.be_standard_ref}</div>
              </div>

              {/* Clinical pharmacology snippet */}
              {result.clinical_pharmacology_snippet && (
                <details className="text-[12px]">
                  <summary className="text-slate-500 cursor-pointer hover:text-slate-300 py-1">
                    Clinical pharmacology excerpt (from FDA label)
                  </summary>
                  <div className="mt-2 rounded-lg border border-white/6 bg-white/1 p-3 text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap">
                    {result.clinical_pharmacology_snippet}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Tab: FDA links */}
          {activeTab === "links" && (
            <div className="space-y-3">
              {[
                {
                  label: "FDA PSG Database",
                  desc: "Product-Specific Guidances — full methodology PDFs, dissolution specs, and BE study requirements for this drug",
                  url: result.psg_search_url,
                  cta: "Search PSGs →",
                  color: "blue",
                },
                {
                  label: "Dissolution Methods Database",
                  desc: "FDA-recommended dissolution media, apparatus, RPM, and pH for in vitro testing",
                  url: result.dissolution_db_url,
                  cta: "Search Dissolution Methods →",
                  color: "violet",
                },
                {
                  label: "Drugs@FDA",
                  desc: "Application documents, approval letters, labels, and review packages for FDA-approved drugs",
                  url: `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=BasicSearch.process&Fld_Appl_Type=ANDA&Query=${encodeURIComponent(result.drug_name)}`,
                  cta: "Search Drugs@FDA →",
                  color: "emerald",
                },
                {
                  label: "Orange Book",
                  desc: "Approved Drug Products with Therapeutic Equivalence Evaluations — the authoritative TE code source",
                  url: `https://www.accessdata.fda.gov/scripts/cder/ob/results_product.cfm?Appl_type=ANDA&Appl_No=&trade_name=&applicant=&strength=&action=Search&ingredient=${encodeURIComponent(result.drug_name)}`,
                  cta: "Search Orange Book →",
                  color: "amber",
                },
              ].map(({ label, desc, url, cta, color }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className={`block rounded-xl border p-4 transition-colors group ${
                    color === "blue"    ? "border-blue-500/15 bg-blue-500/4 hover:bg-blue-500/8" :
                    color === "violet"  ? "border-violet-500/15 bg-violet-500/4 hover:bg-violet-500/8" :
                    color === "emerald" ? "border-emerald-500/15 bg-emerald-500/4 hover:bg-emerald-500/8" :
                                          "border-amber-500/15 bg-amber-500/4 hover:bg-amber-500/8"
                  }`}
                >
                  <div className={`text-[12px] font-semibold mb-1 ${
                    color === "blue" ? "text-blue-300" : color === "violet" ? "text-violet-300" :
                    color === "emerald" ? "text-emerald-300" : "text-amber-300"
                  }`}>{label}</div>
                  <div className="text-[11px] text-slate-400 mb-2">{desc}</div>
                  <div className={`text-[11px] font-medium group-hover:underline ${
                    color === "blue" ? "text-blue-400" : color === "violet" ? "text-violet-400" :
                    color === "emerald" ? "text-emerald-400" : "text-amber-400"
                  }`}>{cta}</div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="py-8 text-center text-[12px] text-slate-600">
          Enter a drug name to look up FDA bioequivalence guidance, reference drug status, and PSG links.
        </div>
      )}
    </div>
  );
}
