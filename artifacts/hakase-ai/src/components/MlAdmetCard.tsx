import { useEffect, useState, useMemo, useCallback } from "react";
import {
  predictAdmetMl,
  predictCardiotox,
  mlBadgeFromSource,
  type MlAdmetResult,
  type MlEndpointValue,
  type CardiotoxResult,
} from "@/lib/aiService";
import type { AdmetScores } from "@/lib/admet";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Brain,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Info,
  Heart,
} from "lucide-react";

type BucketKey = "absorption" | "distribution" | "metabolism" | "excretion" | "toxicity";

const BUCKET_LABELS: Record<BucketKey, string> = {
  absorption: "Absorption",
  distribution: "Distribution",
  metabolism: "Metabolism",
  excretion: "Excretion",
  toxicity: "Toxicity",
};

const CRITICAL_SAFETY_KEYS: Array<{ key: string; label: string; bad: "high" | "low" }> = [
  { key: "hERG", label: "hERG (cardiotoxicity)", bad: "high" },
  { key: "AMES", label: "AMES (mutagenicity)", bad: "high" },
  { key: "DILI", label: "DILI (liver injury)", bad: "high" },
  { key: "ClinTox", label: "ClinTox (clinical failure)", bad: "high" },
  { key: "Carcinogens_Lagunin", label: "Carcinogenicity", bad: "high" },
  { key: "Skin_Reaction", label: "Skin sensitization", bad: "high" },
];

/** ML probability endpoint keys. Single source of truth for axis-mapping + risk-tone display. */
const CYP_INHIBITION_KEY_RE = /^CYP\d+[A-Za-z]?\d*_(Veith|Inhibition)/i;

function isCypInhibitionKey(key: string): boolean {
  return CYP_INHIBITION_KEY_RE.test(key);
}

function isProbabilityKey(key: string): boolean {
  if (CRITICAL_SAFETY_KEYS.some(c => c.key === key)) return true;
  if (isCypInhibitionKey(key)) return true;
  if (key === "BBB_Martins" || key === "HIA_Hou" || key === "Pgp_Broccatelli") return true;
  if (key === "Bioavailability_Ma") return true;
  return false;
}

function formatValue(v: MlEndpointValue): { display: string; numeric: number | null } {
  if (v.value === null || v.value === undefined) return { display: "—", numeric: null };
  if (typeof v.value === "string") return { display: v.value, numeric: null };
  const n = v.value;
  if (Number.isNaN(n)) return { display: "—", numeric: null };
  if (Math.abs(n) >= 1000) return { display: n.toExponential(2), numeric: n };
  if (Math.abs(n) >= 10) return { display: n.toFixed(1), numeric: n };
  if (Math.abs(n) >= 1) return { display: n.toFixed(2), numeric: n };
  return { display: n.toFixed(3), numeric: n };
}

/** Risk tone for a probability-style endpoint where higher = worse. */
function probTone(p: number, badDirection: "high" | "low" = "high"): {
  text: string;
  bg: string;
  border: string;
  label: "Low" | "Moderate" | "High";
} {
  const r = badDirection === "high" ? p : 1 - p;
  if (r < 0.3) return { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", label: "Low" };
  if (r < 0.6) return { text: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", label: "Moderate" };
  return { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", label: "High" };
}

/** Map ML toxicity probability set to a 0–1 axis (lower prob = safer = higher score). */
function mlAxisScore(bucket: BucketKey, structured: MlAdmetResult["structured"]): number | null {
  const entries = Object.entries(structured[bucket] || {});
  if (entries.length === 0) return null;

  if (bucket === "toxicity") {
    // Average critical risk probabilities, invert so 1.0 = safest
    const risks: number[] = [];
    for (const c of CRITICAL_SAFETY_KEYS) {
      const v = structured.toxicity[c.key];
      if (v && typeof v.value === "number" && !Number.isNaN(v.value)) risks.push(v.value);
    }
    if (risks.length === 0) return null;
    const avg = risks.reduce((s, x) => s + x, 0) / risks.length;
    return Math.max(0, Math.min(1, 1 - avg));
  }

  if (bucket === "absorption") {
    const v = structured.absorption["HIA_Hou"] ?? structured.absorption["Bioavailability_Ma"];
    if (v && typeof v.value === "number") return Math.max(0, Math.min(1, v.value));
    return null;
  }

  if (bucket === "distribution") {
    const bbb = structured.distribution["BBB_Martins"];
    if (bbb && typeof bbb.value === "number") return Math.max(0, Math.min(1, bbb.value));
    return null;
  }

  if (bucket === "metabolism") {
    // Lower CYP inhibition = better. Average CYP inhibition probabilities and invert.
    const inhibs: number[] = [];
    for (const [k, v] of entries) {
      if (isCypInhibitionKey(k) && typeof v.value === "number" && !Number.isNaN(v.value)) {
        inhibs.push(v.value);
      }
    }
    if (inhibs.length === 0) return null;
    const avg = inhibs.reduce((s, x) => s + x, 0) / inhibs.length;
    return Math.max(0, Math.min(1, 1 - avg));
  }

  if (bucket === "excretion") {
    const cl = structured.excretion["Clearance_Hepatocyte_AZ"];
    if (cl && typeof cl.value === "number") {
      // Clearance ~1–50 mL/min/kg typical; normalize to a 0–1 scale (higher = better excretion).
      return Math.max(0, Math.min(1, cl.value / 30));
    }
    return null;
  }

  return null;
}

/** Map a 0–1 hERG blocker probability to qualitative class — same thresholds CardioTox uses. */
function hergProbToClass(p: number): "Low" | "Moderate" | "High" {
  if (p < 0.3) return "Low";
  if (p < 0.6) return "Moderate";
  return "High";
}

interface MlAdmetCardProps {
  smiles: string | null | undefined;
  heuristicAdmet: AdmetScores | null | undefined;
}

export function MlAdmetCard({ smiles, heuristicAdmet }: MlAdmetCardProps) {
  const [result, setResult] = useState<MlAdmetResult | null>(null);
  const [cardiotox, setCardiotox] = useState<CardiotoxResult | null>(null);
  const [cardiotoxError, setCardiotoxError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const trimmed = (smiles ?? "").trim();

  const fetchMl = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  useEffect(() => {
    if (!trimmed) {
      setResult(null);
      setCardiotox(null);
      setError(null);
      setCardiotoxError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCardiotoxError(null);
    // Fire both in parallel so the slower one (CardioTox cold-train ≈ 22s) doesn't
    // gate the ADMET-AI render. Each result lands independently.
    predictAdmetMl(trimmed)
      .then(r => { if (!cancelled) setResult(r); })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setResult(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    predictCardiotox(trimmed)
      .then(r => { if (!cancelled) setCardiotox(r); })
      .catch(e => { if (!cancelled) { setCardiotoxError(e instanceof Error ? e.message : String(e)); setCardiotox(null); } });
    return () => { cancelled = true; };
  }, [trimmed, refreshKey]);

  const badge = useMemo(() => {
    if (!result) return null;
    return mlBadgeFromSource(result.source);
  }, [result]);

  const axes: BucketKey[] = ["absorption", "distribution", "metabolism", "excretion", "toxicity"];
  const heuristicAxes = useMemo(() => {
    if (!heuristicAdmet) return null;
    return {
      absorption: heuristicAdmet.absorption,
      distribution: heuristicAdmet.distribution,
      metabolism: heuristicAdmet.metabolism,
      excretion: heuristicAdmet.excretion,
      toxicity: heuristicAdmet.toxicity,
    };
  }, [heuristicAdmet]);

  return (
    <div className="bg-[#0d0f17] border border-white/8 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-400" />
          <h3 className="text-[13px] font-semibold text-slate-200">ML-Enhanced ADMET</h3>
          {badge && (
            <Badge
              className={`text-[9px] ${
                badge.tone === "ml"
                  ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}
            >
              <Sparkles className="w-2.5 h-2.5 mr-1 inline" />
              {badge.label}
            </Badge>
          )}
          {result?.model_info?.engine && (
            <span className="text-[9px] text-slate-500">
              {result.model_info.engine}
              {typeof result.model_info.inference_time_ms === "number" &&
                ` · ${result.model_info.inference_time_ms.toFixed(0)} ms`}
            </span>
          )}
        </div>
        <button
          onClick={fetchMl}
          disabled={loading || !trimmed}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 disabled:opacity-40 px-2 py-1 rounded border border-white/10 hover:bg-white/5"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Predicting…" : "Re-run"}
        </button>
      </div>

      {/* Empty state */}
      {!trimmed && (
        <div className="text-[11px] text-slate-500 italic">Enter a SMILES to run ML predictions.</div>
      )}

      {/* Loading state */}
      {loading && !result && (
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
          <div className="text-[11px] text-slate-300">
            Running Chemprop ensemble inference…
            <span className="text-slate-500 ml-1">(first call ≈ 9s, warm ≈ 200ms)</span>
          </div>
        </div>
      )}

      {/* Error state (transport-level) */}
      {error && (
        <div className="bg-red-500/8 border border-red-500/25 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-[10px] text-red-300 leading-relaxed">
            <span className="font-semibold">ML service unavailable.</span> {error}
            <div className="text-slate-500 mt-0.5">
              Rule-based ADMET (left of comparison view) is still valid for this molecule.
            </div>
          </div>
        </div>
      )}

      {/* Fallback envelope (model returned but inference failed) */}
      {result && result.source === "fallback" && (
        <div className="bg-amber-500/8 border border-amber-500/25 rounded-lg px-3 py-2 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[10px] text-amber-300 leading-relaxed">
            <span className="font-semibold">ML inference unavailable for this molecule.</span>{" "}
            <span className="text-slate-400">
              {result.error ?? "The model returned no predictions."} Rule-based ADMET below remains the source of truth.
            </span>
          </div>
        </div>
      )}

      {/* 5-axis Computational ADMET — Consensus View
          Methodology: instead of hiding the disagreement between an
          independent ML predictor (Chemprop GNN ensemble) and the rule-based
          QSAR engine inside a single averaged number, we surface BOTH the
          consensus value AND the agreement strength as a badge — mirroring
          the hERG paired-prediction pattern used elsewhere in this card.
          - |Δ| < 8 pts → Consensus  (methods agree → high trust)
          - |Δ| < 20 pts → Aligned   (minor disagreement → use average)
          - else        → Divergent (flag for human review; do not auto-trust)
          The headline value is the arithmetic mean of the two methods, but
          the original ML and Rule-based numbers are always shown beneath so
          nothing is silently merged away. */}
      {result && result.source === "ml" && (
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Computational ADMET — Consensus View (ML × Rule-based)
          </div>
          <div className="grid grid-cols-5 gap-2">
            {axes.map(axis => {
              const ml = mlAxisScore(axis, result.structured);
              const heur = heuristicAxes ? heuristicAxes[axis] : null;
              const mlPct = ml !== null ? Math.round(ml * 100) : null;
              const heurPct = heur !== null && heur !== undefined ? Math.round(heur * 100) : null;
              const hasBoth = mlPct !== null && heurPct !== null;
              const consensusPct = hasBoth
                ? Math.round((mlPct! + heurPct!) / 2)
                : (mlPct ?? heurPct);
              const absDelta = hasBoth ? Math.abs(mlPct! - heurPct!) : null;
              const agreement = absDelta === null
                ? null
                : absDelta < 8
                  ? { label: "Consensus", text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30", bar: "bg-emerald-500" }
                  : absDelta < 20
                    ? { label: "Aligned", text: "text-yellow-300", bg: "bg-yellow-500/10", border: "border-yellow-500/30", bar: "bg-yellow-500" }
                    : { label: "Divergent", text: "text-orange-300", bg: "bg-orange-500/10", border: "border-orange-500/30", bar: "bg-orange-500" };
              return (
                <div
                  key={axis}
                  className={`rounded-lg p-2.5 space-y-1.5 border ${agreement?.bg ?? "bg-white/5"} ${agreement?.border ?? "border-white/10"}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider">{BUCKET_LABELS[axis]}</div>
                    {agreement && (
                      <Badge className={`text-[8px] ${agreement.bg} ${agreement.text} ${agreement.border}`}>
                        {agreement.label}
                      </Badge>
                    )}
                  </div>
                  {/* Consensus headline */}
                  <div>
                    <div className={`text-[18px] font-bold leading-none ${agreement?.text ?? "text-slate-200"}`}>
                      {consensusPct !== null && consensusPct !== undefined ? `${consensusPct}%` : "—"}
                    </div>
                    <div className="w-full bg-white/5 rounded h-1.5 mt-1">
                      <div
                        className={`h-1.5 rounded ${agreement?.bar ?? "bg-slate-500"}`}
                        style={{ width: `${consensusPct ?? 0}%` }}
                      />
                    </div>
                  </div>
                  {/* Per-method breakdown (always shown — never silently merged) */}
                  <div className="text-[9px] space-y-0.5 pt-0.5 border-t border-white/5">
                    <div className="flex items-center justify-between">
                      <span className="text-violet-300/80">ML</span>
                      <span className="text-violet-300 font-mono">{mlPct !== null ? `${mlPct}%` : "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Rule</span>
                      <span className="text-slate-400 font-mono">{heurPct !== null ? `${heurPct}%` : "—"}</span>
                    </div>
                    {absDelta !== null && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Δ</span>
                        <span className={`font-mono ${agreement?.text ?? "text-slate-500"}`}>{absDelta} pts</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[9px] text-slate-500 mt-2 leading-relaxed">
            Headline value is the mean of the ML (Chemprop GNN) and rule-based
            (QSAR / Lipinski) estimates. The badge reflects how much the two
            independent methods agree — <span className="text-emerald-400">Consensus</span> = high trust,
            <span className="text-yellow-400"> Aligned</span> = minor disagreement,
            <span className="text-orange-400"> Divergent</span> = methods disagree, route to human review.
          </div>
        </div>
      )}

      {/* Critical safety endpoints */}
      {result && result.source === "ml" && (
        <div>
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Critical Safety Endpoints (ML probabilities)
          </div>
          {/* Paired hERG card: ADMET-AI + CardioTox consensus view */}
          {(() => {
            const hergV = result.structured.toxicity["hERG"];
            const admetHergProb =
              hergV && typeof hergV.value === "number" && !Number.isNaN(hergV.value)
                ? hergV.value
                : null;
            const cardioProb =
              cardiotox && cardiotox.source === "ml"
                ? cardiotox.prediction.blocker_probability
                : null;
            const admetClass = admetHergProb !== null ? hergProbToClass(admetHergProb) : null;
            const cardioClass = cardiotox?.prediction.risk_class ?? null;

            // Consensus logic: identical class → Consensus; one step apart → Aligned; two apart → Divergent
            const orderMap = { Low: 0, Moderate: 1, High: 2 } as const;
            let consensus:
              | { label: string; bg: string; border: string; text: string }
              | null = null;
            if (admetClass && cardioClass) {
              const diff = Math.abs(orderMap[admetClass] - orderMap[cardioClass]);
              if (diff === 0) {
                consensus = {
                  label: "Consensus",
                  bg: "bg-emerald-500/15",
                  border: "border-emerald-500/40",
                  text: "text-emerald-300",
                };
              } else if (diff === 1) {
                consensus = {
                  label: "Aligned",
                  bg: "bg-yellow-500/15",
                  border: "border-yellow-500/40",
                  text: "text-yellow-300",
                };
              } else {
                consensus = {
                  label: "Divergent",
                  bg: "bg-orange-500/15",
                  border: "border-orange-500/40",
                  text: "text-orange-300",
                };
              }
            }

            const admetTone = admetHergProb !== null ? probTone(admetHergProb, "high") : null;
            const cardioTone = cardioProb !== null ? probTone(cardioProb, "high") : null;

            return (
              <div className="bg-white/5 border border-white/10 rounded-lg p-3 mb-2">
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Heart className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[11px] font-semibold text-slate-200">
                      hERG cardiotoxicity — paired prediction
                    </span>
                  </div>
                  {consensus && (
                    <Badge
                      className={`text-[9px] ${consensus.bg} ${consensus.text} ${consensus.border}`}
                    >
                      {consensus.label}
                    </Badge>
                  )}
                  {!consensus && cardiotoxError && (
                    <Badge className="text-[9px] bg-slate-500/15 text-slate-400 border-slate-500/30">
                      CardioTox unavailable
                    </Badge>
                  )}
                  {!consensus && !cardiotoxError && !cardiotox && (
                    <Badge className="text-[9px] bg-slate-500/15 text-slate-400 border-slate-500/30">
                      Loading CardioTox…
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {/* ADMET-AI hERG */}
                  <div
                    className={`rounded-lg px-2.5 py-2 border ${
                      admetTone?.bg ?? "bg-white/5"
                    } ${admetTone?.border ?? "border-white/10"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-400 uppercase tracking-wider">
                        ADMET-AI (hERG_Karim, GNN)
                      </span>
                      {admetTone && (
                        <Badge className={`text-[8px] ${admetTone.bg} ${admetTone.text} ${admetTone.border}`}>
                          {admetTone.label}
                        </Badge>
                      )}
                    </div>
                    <div className={`text-[16px] font-bold mt-1 ${admetTone?.text ?? "text-slate-200"}`}>
                      {admetHergProb !== null ? admetHergProb.toFixed(3) : "—"}
                      {admetHergProb !== null && (
                        <span className="text-[9px] text-slate-500 ml-1">blocker prob</span>
                      )}
                    </div>
                  </div>

                  {/* CardioTox */}
                  <div
                    className={`rounded-lg px-2.5 py-2 border ${
                      cardioTone?.bg ?? "bg-white/5"
                    } ${cardioTone?.border ?? "border-white/10"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-400 uppercase tracking-wider">
                        CardioTox (hERG-Wang, RF + Morgan FP)
                      </span>
                      {cardioTone && cardioClass && (
                        <Badge className={`text-[8px] ${cardioTone.bg} ${cardioTone.text} ${cardioTone.border}`}>
                          {cardioClass}
                        </Badge>
                      )}
                    </div>
                    <div className={`text-[16px] font-bold mt-1 ${cardioTone?.text ?? "text-slate-200"}`}>
                      {cardioProb !== null ? cardioProb.toFixed(3) : "—"}
                      {cardioProb !== null && (
                        <span className="text-[9px] text-slate-500 ml-1">blocker prob</span>
                      )}
                    </div>
                    {cardiotox?.source === "ml" && cardiotox.prediction.ic50_band && (
                      <div className="text-[9px] text-slate-500 mt-1">
                        IC₅₀ band: <span className="text-slate-300">{cardiotox.prediction.ic50_band}</span>
                      </div>
                    )}
                    {cardiotox?.source === "fallback" && (
                      <div className="text-[9px] text-amber-400 mt-1">
                        {cardiotox.error ?? "CardioTox inference unavailable"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-[9px] text-slate-500 mt-2 leading-relaxed">
                  Two methodologically independent models — different training sets, different
                  algorithms, different feature representations — for a more robust safety call.
                  {cardiotox?.source === "ml" &&
                    cardiotox.model_info.performance?.cv_roc_auc_mean != null && (
                      <>
                        {" "}CardioTox 5-fold CV ROC-AUC ={" "}
                        <span className="text-slate-300">
                          {cardiotox.model_info.performance.cv_roc_auc_mean.toFixed(3)}
                        </span>
                        {cardiotox.model_info.performance.cv_roc_auc_std != null && (
                          <>
                            {" "}±{" "}
                            <span className="text-slate-300">
                              {cardiotox.model_info.performance.cv_roc_auc_std.toFixed(3)}
                            </span>
                          </>
                        )}
                        .
                      </>
                    )}
                </div>
              </div>
            );
          })()}

          {/* Other critical safety endpoints (excluding hERG, shown above) */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {CRITICAL_SAFETY_KEYS.filter(c => c.key !== "hERG").map(({ key, label, bad }) => {
              const v = result.structured.toxicity[key];
              if (!v) return null;
              const f = formatValue(v);
              const tone = f.numeric !== null ? probTone(f.numeric, bad) : null;
              return (
                <div
                  key={key}
                  className={`rounded-lg px-2.5 py-2 border ${tone?.bg ?? "bg-white/5"} ${tone?.border ?? "border-white/10"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-300 font-medium leading-tight">{label}</span>
                    {tone && (
                      <Badge className={`text-[8px] ${tone.bg} ${tone.text} ${tone.border}`}>
                        {tone.label}
                      </Badge>
                    )}
                  </div>
                  <div className={`text-[14px] font-bold mt-1 ${tone?.text ?? "text-slate-200"}`}>
                    {f.display}
                    {f.numeric !== null && <span className="text-[9px] text-slate-500 ml-1">prob</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bucket details */}
      {result && result.source === "ml" && (
        <div className="space-y-3">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            All ML Endpoints by Bucket
          </div>
          {axes.map(bucket => {
            const entries = Object.entries(result.structured[bucket] || {});
            if (entries.length === 0) return null;
            return (
              <div key={bucket} className="bg-white/5 rounded-lg p-3">
                <div className="text-[10px] font-semibold text-slate-300 mb-2">{BUCKET_LABELS[bucket]}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                  {entries.map(([k, v]) => {
                    const f = formatValue(v);
                    const isProb = isProbabilityKey(k) && f.numeric !== null;
                    const tone = isProb && f.numeric !== null ? probTone(f.numeric, "high") : null;
                    return (
                      <div key={k} className="flex items-center justify-between gap-2 min-w-0">
                        <span
                          className="text-[10px] text-slate-400 truncate"
                          title={v.label || k}
                        >
                          {k}
                        </span>
                        <span
                          className={`text-[10px] font-semibold tabular-nums ${
                            tone ? tone.text : "text-slate-200"
                          }`}
                        >
                          {f.display}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer attribution */}
      {result && result.source === "ml" && result.model_info?.reference && (
        <div className="text-[9px] text-slate-600 pt-2 border-t border-white/5 space-y-1">
          <div className="flex items-start gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500/60 shrink-0 mt-0.5" />
            <span>
              Predictions from <span className="text-slate-400">{result.model_info.engine}</span>
              {result.model_info.method && ` (${result.model_info.method})`}
              {result.model_info.endpoint_count != null && ` · ${result.model_info.endpoint_count} endpoints`}
              {result.model_info.license && ` · ${result.model_info.license}`}
              {result.model_info.reference && ` · ${result.model_info.reference}`}
            </span>
          </div>
          {cardiotox?.source === "ml" && cardiotox.model_info?.reference && (
            <div className="flex items-start gap-1">
              <Heart className="w-3 h-3 text-red-500/60 shrink-0 mt-0.5" />
              <span>
                hERG second-opinion from{" "}
                <span className="text-slate-400">{cardiotox.model_info.engine}</span>
                {cardiotox.model_info.training?.dataset &&
                  ` · trained on ${cardiotox.model_info.training.dataset} (n=${cardiotox.model_info.training.n_train})`}
                {cardiotox.model_info.license && ` · ${cardiotox.model_info.license}`}
                {cardiotox.model_info.reference && ` · ${cardiotox.model_info.reference}`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
