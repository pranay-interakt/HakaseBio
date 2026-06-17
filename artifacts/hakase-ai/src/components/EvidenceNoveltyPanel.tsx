/**
 * Evidence & Novelty Panel
 * ─────────────────────────────────────────────────────────────────────────
 * Surfaces two things a reviewer needs *before* trusting an L1 verdict on a
 * novel compound:
 *
 *   1. NOVELTY — has this exact structure been seen before? Resolved across
 *      PubChem, EBI UniChem (ChEMBL / DrugBank / SureChEMBL / ZINC …) and
 *      Europe PMC. A marketed drug, a patented chemical and a clean-slate
 *      structure are very different risk positions.
 *
 *   2. READ-ACROSS — for hERG / on-target IC50 / permeability, the nearest
 *      MEASURED analogues in ChEMBL, with their real values and Tanimoto
 *      similarity. This is what lets a pre-lab estimate be anchored to real
 *      data instead of blind extrapolation (OECD/ECHA read-across).
 *
 * The panel is self-fetching (runs on SMILES change), fails soft, and reports
 * a compact EvidenceSupport back to the parent via `onEvidence` so the L1
 * scorecard's confidence can reflect how much measured support exists.
 */
import { useState, useEffect, useCallback } from "react";
import { Database, ExternalLink, FlaskConical, ChevronDown, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { resolveNovelty, type NoveltyReport } from "@/lib/noveltyResolver";
import { runReadAcross, type ReadAcrossReport, type ReadAcrossEndpoint, type AdConfidence } from "@/lib/readAcross";
import type { EvidenceSupport, AdConfidenceLevel } from "@/lib/l1Scorecard";

const AD_RANK: Record<AdConfidence, number> = { None: 0, Low: 1, Moderate: 2, High: 3 };
const AD_BY_RANK: AdConfidenceLevel[] = ["None", "Low", "Moderate", "High"];

function bestAd(report: ReadAcrossReport): AdConfidenceLevel {
  const eps = [report.herg, report.onTarget, report.caco2].filter(Boolean) as ReadAcrossEndpoint[];
  const r = eps.reduce((mx, e) => Math.max(mx, AD_RANK[e.adConfidence]), 0);
  return AD_BY_RANK[r];
}

const verdictTone: Record<NoveltyReport["verdict"], { chip: string; dot: string }> = {
  "Marketed / clinical drug":            { chip: "border-amber-500/40 bg-amber-500/10 text-amber-200", dot: "bg-amber-400" },
  "Known chemical (literature/patent)":  { chip: "border-blue-500/40 bg-blue-500/10 text-blue-200",   dot: "bg-blue-400" },
  "Sparsely documented":                 { chip: "border-slate-500/40 bg-slate-500/10 text-slate-200", dot: "bg-slate-400" },
  "Novel — no public record":            { chip: "border-violet-500/40 bg-violet-500/10 text-violet-200", dot: "bg-violet-400" },
  "Unknown (lookup unavailable)":        { chip: "border-slate-600/40 bg-slate-600/10 text-slate-400", dot: "bg-slate-500" },
};

const adChip: Record<AdConfidence, string> = {
  High:     "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  Moderate: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  Low:      "border-orange-500/40 bg-orange-500/10 text-orange-300",
  None:     "border-white/10 bg-white/5 text-slate-500",
};

function EndpointCard({ ep }: { ep: ReadAcrossEndpoint }) {
  const [open, setOpen] = useState(false);
  const hasData = ep.status === "ok" && ep.estimate != null;
  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-colors ${hasData ? "border-cyan-500/15 bg-cyan-500/[0.03]" : "border-dashed border-white/10 bg-white/[0.015]"}`}>
      <button
        type="button"
        onClick={() => ep.neighbors.length > 0 && setOpen(o => !o)}
        className={`flex w-full items-center justify-between gap-2 text-left ${ep.neighbors.length > 0 ? "cursor-pointer" : "cursor-default"}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`hk-icon-tile ${hasData ? "" : "opacity-50"}`}><FlaskConical className="h-3.5 w-3.5" /></span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-200">{ep.endpoint}</div>
            <div className="text-[10px] mt-0.5">
              {hasData ? (
                <span className="text-slate-500">
                  read-across ≈ <span className="font-mono font-semibold text-slate-200">{ep.neighbors[0]?.valueText ?? fmt(ep.estimate!, ep.unit)}</span>{ep.geoSDfold && ep.geoSDfold > 1 ? <span className="text-slate-500"> ±{ep.geoSDfold}×</span> : null}
                </span>
              ) : (
                <span className="text-slate-600 italic">no measured analogue — model extrapolation</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasData && (
            <span className="hk-chip text-[9px] py-0">n {ep.nNeighbors} · sim {ep.maxSimilarity != null ? `${(ep.maxSimilarity * 100).toFixed(0)}%` : "—"}</span>
          )}
          <span className={`text-[9px] font-semibold rounded-full border px-2 py-0.5 ${adChip[ep.adConfidence]}`}>AD {ep.adConfidence}</span>
          {ep.neighbors.length > 0 && <ChevronDown className={`h-3 w-3 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />}
        </div>
      </button>
      {open && ep.neighbors.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
          {ep.neighbors.map(n => (
            <a
              key={n.chemblId}
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[10px] hover:bg-white/5"
            >
              <span className="min-w-0 truncate text-slate-400">{n.name ?? n.chemblId}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-slate-500">sim {(n.similarity * 100).toFixed(0)}%</span>
                <span className="font-mono text-slate-300">{n.valueText}</span>
                <ExternalLink className="h-2.5 w-2.5 text-slate-600" />
              </span>
            </a>
          ))}
          <p className="px-1.5 pt-1 text-[9px] leading-relaxed text-slate-600">{ep.note}</p>
        </div>
      )}
    </div>
  );
}

function fmt(v: number, unit: string): string {
  if (unit === "nM") {
    if (v >= 1e6) return `${(v / 1e6).toFixed(2)} mM`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(2)} µM`;
    return `${v.toFixed(1)} nM`;
  }
  return `${v} ${unit}`;
}

export interface EvidenceNoveltyPanelProps {
  smiles: string;
  /** Optional selected target ChEMBL id for on-target IC50 read-across. */
  onTargetChemblId?: string | null;
  /** Reports compact evidence support up so the L1 scorecard confidence can use it. */
  onEvidence?: (e: EvidenceSupport | null) => void;
}

export function EvidenceNoveltyPanel({ smiles, onTargetChemblId, onEvidence }: EvidenceNoveltyPanelProps) {
  const [loading, setLoading] = useState(false);
  const [novelty, setNovelty] = useState<NoveltyReport | null>(null);
  const [readAcross, setReadAcross] = useState<ReadAcrossReport | null>(null);
  const [ran, setRan] = useState(false);

  const run = useCallback(async () => {
    if (!smiles || !smiles.trim()) return;
    setLoading(true);
    setRan(true);
    try {
      const [nov, ra] = await Promise.all([
        resolveNovelty(smiles),
        runReadAcross(smiles, { onTargetChemblId }),
      ]);
      setNovelty(nov);
      setReadAcross(ra);
      onEvidence?.({
        readAcrossCoverage: ra.coverage,
        bestAdConfidence: bestAd(ra),
        noveltyScore: nov.noveltyScore,
      });
    } catch {
      onEvidence?.(null);
    } finally {
      setLoading(false);
    }
  }, [smiles, onTargetChemblId, onEvidence]);

  // Auto-run once per SMILES (debounced a tick so rapid edits don't spam APIs).
  useEffect(() => {
    setRan(false);
    setNovelty(null);
    setReadAcross(null);
    if (!smiles || !smiles.trim()) return;
    const t = setTimeout(() => { void run(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smiles, onTargetChemblId]);

  const tone = novelty ? verdictTone[novelty.verdict] : null;

  return (
    <div className="hk-panel hk-topline hk-aura overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="hk-icon-tile"><Database className="h-3.5 w-3.5" /></span>
          <div className="leading-tight">
            <div className="hk-display text-[16px] text-white">Evidence &amp; Novelty</div>
            <div className="hk-eyebrow mt-0.5">Public DB cross-check</div>
          </div>
        </div>
        {loading ? (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <div className="h-3 w-3 animate-spin rounded-full border border-slate-500 border-t-transparent" /> Verifying…
          </span>
        ) : (
          <button onClick={() => void run()} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-medium text-slate-300 transition-colors hover:bg-white/5">
            <RefreshCw className="h-3 w-3" /> Re-check
          </button>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        {/* Novelty verdict */}
        {novelty ? (
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone?.chip}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${tone?.dot}`} />
                {novelty.verdict}
              </span>
              <span className="text-[9px] text-slate-500">novelty {(novelty.noveltyScore * 100).toFixed(0)}%</span>
              {novelty.inPatents && <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-semibold text-amber-300">IN PATENTS</span>}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{novelty.summary}</p>
            {novelty.hits.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {novelty.hits.slice(0, 10).map(h => (
                  h.url ? (
                    <a key={`${h.source}:${h.id}`} href={h.url} target="_blank" rel="noreferrer"
                      className="hk-chip transition-colors hover:border-cyan-500/40">
                      {h.source}<ExternalLink className="h-2.5 w-2.5 text-slate-500" />
                    </a>
                  ) : (
                    <span key={`${h.source}:${h.id}`} className="hk-chip">{h.source}</span>
                  )
                ))}
              </div>
            )}
          </div>
        ) : ran && !loading ? (
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-slate-600" />
            Public databases unreachable — novelty unknown. Verdict rests on the model alone.
          </div>
        ) : !ran && !loading ? (
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <Sparkles className="h-3.5 w-3.5 text-slate-600" /> Enter a SMILES to verify novelty and pull measured analogues.
          </div>
        ) : null}

        {/* Read-across */}
        {readAcross && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="hk-eyebrow">Read-across from measured analogues</span>
              <span className="hk-chip"><FlaskConical className="h-2.5 w-2.5 text-cyan-400" />coverage {(readAcross.coverage * 100).toFixed(0)}%</span>
            </div>
            <div className="grid gap-2">
              <EndpointCard ep={readAcross.herg} />
              {readAcross.onTarget && <EndpointCard ep={readAcross.onTarget} />}
              <EndpointCard ep={readAcross.caco2} />
            </div>
            <p className="text-[9px] leading-relaxed text-slate-600">
              Read-across anchors a pre-lab estimate to the nearest structures that already have measured data
              (OECD/ECHA read-across). It complements — it does not replace — the wet-lab assay. Where no close
              measured analogue exists, the value stays a model extrapolation and confidence is lowered accordingly.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
