/**
 * Preclinical Evidence Sources card — FDA/NLM/NCATS/EBI grade.
 * Surfaces NCATS Pharos (target development level) and DailyMed (official FDA
 * labels) for this molecule/target, plus a transparent list of every trusted
 * source the platform draws on. See lib/preclinicalSources.ts. Self-fetching,
 * fail-soft; informational only.
 */
import { useState, useEffect } from "react";
import { Library, ExternalLink, ChevronDown, Target as TargetIcon, ShieldCheck } from "lucide-react";
import {
  fetchPharosTarget, fetchDailyMedLabel, TRUSTED_SOURCES,
  type PharosTarget, type DailyMedLabel,
} from "@/lib/preclinicalSources";

const TDL_TONE: Record<string, string> = {
  Tclin: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  Tchem: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
  Tbio:  "border-amber-500/40 bg-amber-500/10 text-amber-300",
  Tdark: "border-orange-500/40 bg-orange-500/10 text-orange-300",
};

export interface PreclinicalEvidenceCardProps {
  targetSymbol?: string;   // gene symbol or UniProt for Pharos
  drugName?: string;       // molecule / matched-drug name for DailyMed
}

export function PreclinicalEvidenceCard({ targetSymbol, drugName }: PreclinicalEvidenceCardProps) {
  const [pharos, setPharos] = useState<PharosTarget | null>(null);
  const [dailymed, setDailymed] = useState<DailyMedLabel | null>(null);
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    let alive = true;
    setPharos(null);
    const t = (targetSymbol ?? "").trim();
    if (t && t !== "—") fetchPharosTarget(t).then(r => { if (alive) setPharos(r); }).catch(() => {});
    return () => { alive = false; };
  }, [targetSymbol]);

  useEffect(() => {
    let alive = true;
    setDailymed(null);
    const n = (drugName ?? "").trim();
    if (n) fetchDailyMedLabel(n).then(r => { if (alive) setDailymed(r); }).catch(() => {});
    return () => { alive = false; };
  }, [drugName]);

  return (
    <div className="hk-panel hk-topline overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="hk-icon-tile"><Library className="h-3.5 w-3.5" /></span>
          <div className="leading-tight">
            <div className="hk-display text-[16px] text-white">Preclinical Evidence Sources</div>
            <div className="hk-eyebrow mt-0.5">FDA · NLM · NCATS · EBI grade</div>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Pharos target development level — only render when loading or it
            actually returned (hide hard errors so there's no dead row). */}
        {(pharos == null || pharos.status === "ok") && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <TargetIcon className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
              <span className="text-[11px] font-semibold text-slate-200">Target validation · NCATS Pharos</span>
            </div>
            {pharos?.status === "ok" && pharos.tdl && (
              <span className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 ${TDL_TONE[pharos.tdl] ?? "border-white/10 text-slate-400"}`}>{pharos.tdl}</span>
            )}
          </div>
          {pharos == null ? (
            <p className="text-[10px] text-slate-500 mt-1.5">{targetSymbol ? "Checking target development level…" : "Select a target to validate it against Pharos."}</p>
          ) : pharos.tdl ? (
            <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
              {pharos.interpretation}{" "}
              {pharos.url && <a href={pharos.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-200">Pharos<ExternalLink className="h-2.5 w-2.5" /></a>}
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 mt-1.5">Target not catalogued in NCATS Pharos — no validated chemical/clinical precedent for it yet.</p>
          )}
        </div>
        )}

        {/* DailyMed official FDA labels — hide on hard error (no dead row). */}
        {(dailymed == null || dailymed.status === "ok") && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] font-semibold text-slate-200">FDA labels · DailyMed (SPL)</span>
          </div>
          {dailymed == null ? (
            <p className="text-[10px] text-slate-500 mt-1.5">{drugName ? "Searching official FDA labels…" : "Name the molecule to search FDA labels."}</p>
          ) : (
            <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
              {dailymed.note}{" "}
              {dailymed.url && dailymed.count ? <a href={dailymed.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-cyan-300 hover:text-cyan-200">View label<ExternalLink className="h-2.5 w-2.5" /></a> : null}
            </p>
          )}
        </div>
        )}

        {/* Transparent trusted-source registry */}
        <button type="button" onClick={() => setShowSources(s => !s)} className="flex items-center gap-1.5 text-[10px] text-cyan-300 hover:text-cyan-200">
          <ChevronDown className={`h-3 w-3 transition-transform ${showSources ? "rotate-180" : ""}`} />
          {showSources ? "Hide" : "Show"} all {TRUSTED_SOURCES.length} trusted data sources
        </button>
        {showSources && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {TRUSTED_SOURCES.map(s => (
              <a key={s.name} href={s.url} target="_blank" rel="noreferrer"
                className="rounded-lg border border-white/8 bg-white/[0.015] px-2.5 py-1.5 hover:border-cyan-500/30 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-slate-200 truncate">{s.name}</span>
                  <span className={`text-[8px] font-semibold uppercase tracking-wide rounded px-1 py-0.5 ${
                    s.grade === "regulatory" ? "bg-emerald-500/10 text-emerald-300"
                    : s.grade === "ml" ? "bg-cyan-500/10 text-cyan-300"
                    : "bg-white/5 text-slate-400"}`}>{s.grade}</span>
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5">{s.org} · {s.use}</div>
              </a>
            ))}
          </div>
        )}
        <p className="text-[9px] leading-relaxed text-slate-600 italic">
          "FDA-grade" = signals sourced from official FDA / NLM / NCATS / EPA / EBI records. It strengthens traceability;
          it is not a regulatory determination and does not replace wet-lab or clinical validation.
        </p>
      </div>
    </div>
  );
}
