/**
 * FDA Benefit-Risk card — surfaces the structured benefit-risk context next
 * to the L1 verdict. See lib/benefitRisk.ts for the methodology (FDA 2023
 * Benefit-Risk Framework). This card is informational: it never changes the
 * go/no-go verdict, it explains how the condition's severity + unmet need
 * shift the acceptable-risk line.
 */
import { useState, useEffect } from "react";
import { Scale, ChevronDown, AlertTriangle } from "lucide-react";
import { assessBenefitRisk, fetchFdaConditionContext, fetchFdaDrugLabel, type BenefitRiskBalance, type FdaConditionContext, type FdaDrugLabel } from "@/lib/benefitRisk";
import { fetchPharosTarget } from "@/lib/preclinicalSources";
import type { L1Scorecard } from "@/lib/l1Scorecard";

const TONE: Record<BenefitRiskBalance, { chip: string; dot: string; bar: string }> = {
  favorable:   { chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", dot: "bg-emerald-400", bar: "bg-emerald-500" },
  borderline:  { chip: "border-amber-500/40 bg-amber-500/10 text-amber-300",       dot: "bg-amber-400",   bar: "bg-amber-500" },
  conditional: { chip: "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",          dot: "bg-cyan-400",    bar: "bg-cyan-500" },
  unfavorable: { chip: "border-red-500/40 bg-red-500/10 text-red-300",             dot: "bg-red-400",     bar: "bg-red-500" },
};

export interface BenefitRiskCardProps {
  scorecard: L1Scorecard | null;
  indication: string;
  therapeuticArea?: string;
  /** Target gene symbol / UniProt — used to pull Pharos validation into benefit. */
  targetSymbol?: string;
  /** Molecule / matched-drug name — used to pull the FDA boxed-warning fact. */
  drugName?: string;
}

export function BenefitRiskCard({ scorecard, indication, therapeuticArea, targetSymbol, drugName }: BenefitRiskCardProps) {
  const [open, setOpen] = useState(false);
  const [fda, setFda] = useState<FdaConditionContext | null>(null);
  const [tdl, setTdl] = useState<string | null>(null);
  const [drugLabel, setDrugLabel] = useState<FdaDrugLabel | null>(null);

  // Pull live openFDA grounding for the indication (fail-soft; the assessment
  // falls back to the keyword prior if this is null).
  useEffect(() => {
    let alive = true;
    setFda(null);
    const term = (indication || therapeuticArea || "").trim();
    if (!term) return;
    fetchFdaConditionContext(indication, therapeuticArea).then((r) => { if (alive) setFda(r); }).catch(() => {});
    return () => { alive = false; };
  }, [indication, therapeuticArea]);

  // Pull Pharos target validation so it feeds the benefit side (fail-soft).
  useEffect(() => {
    let alive = true;
    setTdl(null);
    const t = (targetSymbol ?? "").trim();
    if (!t || t === "—") return;
    fetchPharosTarget(t).then((r) => { if (alive && r.status === "ok") setTdl(r.tdl); }).catch(() => {});
    return () => { alive = false; };
  }, [targetSymbol]);

  // FDA label boxed-warning fact for the molecule (fail-soft).
  useEffect(() => {
    let alive = true;
    setDrugLabel(null);
    const n = (drugName ?? "").trim();
    if (!n) return;
    fetchFdaDrugLabel(n).then((r) => { if (alive) setDrugLabel(r); }).catch(() => {});
    return () => { alive = false; };
  }, [drugName]);

  if (!scorecard) return null;

  const a = assessBenefitRisk({ scorecard, indication, therapeuticArea, fda, targetValidation: tdl ? { tdl } : null, drugLabel });
  const tone = TONE[a.balance];
  const fdaLive = fda?.status === "ok";

  return (
    <div className="hk-panel hk-topline overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="hk-icon-tile"><Scale className="h-3.5 w-3.5" /></span>
          <div className="leading-tight">
            <div className="hk-display text-[16px] text-white">Benefit-Risk Assessment</div>
            <div className="hk-eyebrow mt-0.5">FDA Benefit-Risk Framework{fdaLive ? " · openFDA live" : ""}</div>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${tone.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          {a.balance.toUpperCase()}
        </span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Condition severity vs unmet need vs risk tolerance */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: "Condition", v: a.severity },
            { l: "Unmet need", v: a.unmetNeed },
            { l: "Risk tolerance", v: `${(a.riskTolerance * 100).toFixed(0)}/100` },
          ].map((m) => (
            <div key={m.l} className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2">
              <div className="hk-kpi-label">{m.l}</div>
              <div className="text-[12px] font-semibold text-slate-200 mt-0.5 capitalize">{m.v}</div>
            </div>
          ))}
        </div>

        {/* Risk-tolerance meter */}
        <div>
          <div className="flex justify-between text-[9px] text-slate-500 mb-1">
            <span>acceptable-risk ceiling (severity × unmet need)</span>
            <span className="hk-chip-mono">{(a.riskTolerance * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${a.riskTolerance * 100}%` }} />
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-300">{a.rationale}</p>

        {a.divergesFromVerdict && (
          <div className="flex items-start gap-2 rounded-lg border border-cyan-500/25 bg-cyan-500/5 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-cyan-300 shrink-0 mt-0.5" />
            <p className="text-[10px] leading-relaxed text-cyan-100">
              The benefit-risk view diverges from the safety verdict — this is a benefit-risk-committee decision, not an automatic advance. {a.recommendation}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[10px] text-cyan-300 hover:text-cyan-200"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          {open ? "Hide" : "Show"} the five FDA dimensions
        </button>

        {open && (
          <div className="space-y-2">
            {a.dimensions.map((d) => (
              <div key={d.dimension} className="hk-rail rounded-lg border border-white/8 bg-white/[0.015] px-3 py-2">
                <div className="text-[10px] font-semibold text-slate-200">{d.dimension}</div>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{d.evidence}</p>
                <p className="text-[10px] text-slate-300 mt-1 leading-relaxed"><span className="text-slate-500">→ </span>{d.conclusion}</p>
              </div>
            ))}
          </div>
        )}

        <p className="text-[9px] leading-relaxed text-slate-600 italic">{a.disclaimer}</p>
      </div>
    </div>
  );
}
