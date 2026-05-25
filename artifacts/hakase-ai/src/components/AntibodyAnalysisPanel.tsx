/**
 * AntibodyAnalysisPanel — Layer 1 antibody-native developability analysis.
 *
 * Self-contained: owns its heavy/light-chain input, runs the analysis, and
 * renders the full result. Calls POST /ai/antibody → predict_antibody_properties().
 *
 * Every value shown is computed from published, citable rules in the Python
 * engine — no GPU, no fabrication. Anything that cannot be derived honestly
 * (e.g. a calibrated humanness score) is shown as "not scored", never invented.
 */

import { useState, useCallback } from "react";
import {
  Shield, Play, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Info,
  FlaskConical, Activity, Microscope, Layers,
} from "lucide-react";
import {
  predictAntibody,
  type AntibodyResult,
  type AntibodyChain,
  type AntibodyLiability,
} from "@/lib/aiService";

// Trastuzumab (Herceptin) variable domains — a one-click example.
const EXAMPLE_VH =
  "EVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS";
const EXAMPLE_VL =
  "DIQMTQSPSSLSASVGDRVTITCRASQDVNTAVAWYQQKPGKAPKLLIYSASFLYSGVPSRFSGSRSGTDFTLTISSLQPEDFATYYCQQHYTTPPTFGQGTKVEIK";

const AA_RE = /^[ACDEFGHIKLMNPQRSTVWY]+$/;

function cleanSeq(s: string): string {
  return s.toUpperCase().replace(/[^A-Z]/g, "");
}

// ── small display helpers ────────────────────────────────────────────────────

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="text-[12px] font-semibold text-slate-100 text-right">
        {value}
        {sub && <span className="ml-1 text-[10px] font-normal text-slate-500">{sub}</span>}
      </span>
    </div>
  );
}

type PillTone = "emerald" | "amber" | "red" | "slate" | "violet";

function Pill({ text, tone }: { text: string; tone: PillTone }) {
  const map: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    amber:   "bg-amber-500/15   text-amber-300   border-amber-500/30",
    red:     "bg-red-500/15     text-red-300     border-red-500/30",
    slate:   "bg-slate-500/15   text-slate-300   border-slate-500/30",
    violet:  "bg-violet-500/15  text-violet-300  border-violet-500/30",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-semibold ${map[tone]}`}>
      {text}
    </span>
  );
}

function Section({
  icon: Icon, title, children,
}: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-white/8 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 bg-white/[0.02]">
        <Icon className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="text-[12px] font-semibold text-slate-200">{title}</span>
      </div>
      <div className="px-3.5 py-3">{children}</div>
    </div>
  );
}

const sevTone = (s: string): PillTone => (s === "high" ? "red" : s === "moderate" ? "amber" : "slate");
const lvlTone = (l: string): PillTone => (l === "red" ? "red" : l === "amber" ? "amber" : "emerald");
const bandTone = (b: string): PillTone =>
  /high|elevated/i.test(b) ? "red" : /moderate/i.test(b) ? "amber" : "emerald";

// ── per-chain card ───────────────────────────────────────────────────────────

function ChainCard({ chain }: { chain: AntibodyChain }) {
  const pc = chain.physicochemical;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Layers className="w-4 h-4 text-violet-400" />
        <span className="text-[13px] font-bold text-slate-100">{chain.label} chain</span>
        <Pill text={`${chain.length} residues`} tone="slate" />
        <Pill text={chain.architecture.chain_type.replace(/_/g, " ")} tone="violet" />
      </div>
      <p className="text-[11px] text-slate-400 -mt-1">{chain.architecture.note}</p>

      {/* physicochemical */}
      <Section icon={FlaskConical} title="Physicochemistry">
        <div className="grid grid-cols-2 gap-x-5">
          <MetricRow label="Molecular weight" value={`${pc.molecular_weight_da.toFixed(0)} Da`} />
          <MetricRow label="Isoelectric point" value={pc.isoelectric_point.toFixed(1)} />
          <MetricRow label="Net charge (pH 7.4)" value={pc.net_charge_pH7.toFixed(1)} />
          <MetricRow label="GRAVY" value={pc.gravy.toFixed(2)} />
          <MetricRow label="Aliphatic index" value={pc.aliphatic_index.toFixed(0)} />
          <MetricRow label="Aromaticity" value={pc.aromaticity.toFixed(2)} />
          <MetricRow label="Instability index" value={pc.instability_index.toFixed(1)}
            sub={pc.instability_class} />
          <MetricRow label="A280 (ε, oxidised)" value={`${pc.extinction_280_oxidised} M⁻¹cm⁻¹`} />
          <MetricRow label="Cysteines" value={String(pc.cysteine_count)} />
          <MetricRow label="Disulfide pairs" value={String(pc.n_disulfide_pairs)} />
        </div>
      </Section>

      {/* CDRs */}
      <Section icon={Microscope} title="Complementarity-determining regions">
        <div className="flex flex-col gap-1.5">
          {chain.cdrs.map((c) => (
            <div key={c.name} className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-300 w-16 shrink-0">{c.name}</span>
              {c.sequence ? (
                <span className="font-mono text-[11px] text-violet-200 bg-violet-500/10 px-1.5 py-0.5 rounded">
                  {c.sequence}
                </span>
              ) : (
                <span className="text-[11px] text-slate-500 italic">not localised</span>
              )}
              {c.length > 0 && <span className="text-[10px] text-slate-500">{c.length} aa</span>}
              <Pill
                text={c.confidence === "imgt_anarci" ? "IMGT (exact)" : c.confidence}
                tone={
                  c.confidence === "imgt_anarci" || c.confidence === "anchored" ? "emerald"
                  : c.confidence === "approximate" ? "amber" : "slate"
                }
              />
            </div>
          ))}
        </div>
      </Section>

      {/* liabilities */}
      <Section icon={AlertTriangle} title={`CDR & sequence liabilities (${chain.liabilities.length})`}>
        {chain.liabilities.length === 0 ? (
          <p className="text-[11px] text-emerald-300">No flagged liability motifs in this chain.</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
            {chain.liabilities.map((l: AntibodyLiability, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-white/5 pb-1.5 last:border-0">
                <Pill text={l.severity} tone={sevTone(l.severity)} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-slate-200">
                    <span className="font-semibold">{l.type}</span>
                    <span className="text-slate-500"> · {l.motif} @ {l.position} · {l.location}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 leading-snug">{l.note}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* developability */}
      <Section icon={Activity} title="Developability (TAP-style flags)">
        <div className="mb-2 text-[11px] text-slate-300">
          {chain.developability.tier} · total CDR length {chain.developability.total_cdr_length}
        </div>
        <div className="flex flex-col gap-1.5">
          {chain.developability.flags.map((f, i) => (
            <div key={i} className="flex items-start gap-2">
              <Pill text={f.value} tone={lvlTone(f.level)} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-slate-200">{f.metric}</div>
                <div className="text-[10px] text-slate-500 leading-snug">{f.note}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* aggregation + immunogenicity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Section icon={Shield} title="Aggregation (AGGRESCAN)">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <Pill text="Sequence-level data — graded in L2" tone="slate" />
            <span className="text-[11px] text-slate-400">
              {chain.aggregation.anchored_cdr_hotspots} in anchored CDR · {chain.aggregation.n_regions} total hot spot(s)
            </span>
            <span className="px-1.5 py-0.5 rounded border text-[9px] font-semibold bg-slate-500/15 text-slate-400 border-slate-500/30">
              {chain.aggregation.provenance}
            </span>
          </div>
          {chain.aggregation.regions.slice(0, 5).map((r, i) => (
            <div key={i} className="text-[10px] font-mono flex items-center gap-1.5">
              <span className={r.location === "framework" ? "text-slate-600" : "text-amber-300"}>
                {r.start}-{r.end}: {r.sequence}
              </span>
              <span className="text-slate-600">peak {r.peak_a4v}</span>
              <span className={`px-1 rounded text-[8px] not-italic ${
                r.location === "framework"
                  ? "bg-slate-500/15 text-slate-500"
                  : "bg-amber-500/15 text-amber-300"}`}>
                {r.location}
              </span>
            </div>
          ))}
          <div className="text-[9px] text-slate-600 leading-snug mt-1">{chain.aggregation.note}</div>
        </Section>
        <Section icon={Microscope} title="Immunogenicity (coarse screen)">
          <div className="flex items-center gap-2 mb-1">
            <Pill text={chain.immunogenicity.band} tone={bandTone(chain.immunogenicity.band)} />
            <span className="text-[11px] text-slate-400">
              {chain.immunogenicity.candidate_agretope_windows} candidate agretope window(s)
            </span>
          </div>
          <div className="text-[10px] text-slate-500 leading-snug">
            Humanness: <span className="text-slate-400">not scored</span> — {chain.immunogenicity.caveat}
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── main panel ───────────────────────────────────────────────────────────────

export interface AntibodyAnalysisPanelProps {
  heavy: string;
  light: string;
  formatHint: string;
  loading: boolean;
  error: string | null;
  result: AntibodyResult | null;
  onClear: () => void;
}

export function AntibodyAnalysisPanel({
  heavy,
  light,
  formatHint,
  loading,
  error,
  result,
  onClear,
}: AntibodyAnalysisPanelProps) {
  const verdictTone = !result
    ? "slate"
    : result.summary.verdict.startsWith("PASS")
      ? "emerald"
      : result.summary.verdict.startsWith("REVIEW")
        ? "amber"
        : "red";

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-violet-400" />
        <h3 className="text-[14px] font-bold text-slate-100">Antibody Developability — Layer 1</h3>
      </div>
      <p className="text-[11px] text-slate-400 -mt-2">
        Heavy-chain (or VHH / scFv) required; light chain optional. Pure-Python developability
        engine — chain typing, CDR localisation, liability scan, TAP-style flags, aggregation
        and a coarse immunogenicity screen. No GPU, no fabrication.
      </p>

      {/* Running animation — matches the small-molecule Layer-1 style */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-full bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
            <Shield className="w-8 h-8 text-violet-400 animate-spin" style={{ animationDuration: "2s" }} />
          </div>
          <div className="text-[14px] font-medium text-white">Running Antibody Developability Analysis</div>
          <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full w-1/2 bg-violet-500 rounded-full animate-pulse" />
          </div>
          <p className="text-[11px] text-slate-500">
            Chain typing · CDR scan · Liabilities · Aggregation · Stability
          </p>
        </div>
      )}

      {/* error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3.5 py-2.5 flex items-start gap-2">
          <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="text-[12px] text-red-300">{error}</div>
        </div>
      )}

      {/* empty state */}
      {!result && !loading && !error && (
        <div className="rounded-lg border border-white/8 bg-white/[0.01] px-4 py-8 text-center">
          <Shield className="w-8 h-8 text-slate-700 mx-auto mb-2" />
          <p className="text-[12px] text-slate-500">
            Configure your antibody sequences on the left and run the analysis.
          </p>
        </div>
      )}

      {/* results */}
      {result && !loading && (
        <div className="flex flex-col gap-4 mt-2">
          {/* Action Row */}
          <div className="flex justify-end">
            <button
              onClick={onClear}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all text-[10px] font-medium"
            >
              Clear Results
            </button>
          </div>
          {/* verdict banner */}
          <div className={`rounded-lg border px-4 py-3 ${
            verdictTone === "emerald" ? "border-emerald-500/30 bg-emerald-500/[0.07]" :
            verdictTone === "amber"   ? "border-amber-500/30   bg-amber-500/[0.07]" :
                                        "border-red-500/30     bg-red-500/[0.07]"}`}>
            <div className="flex items-center gap-2 mb-1.5">
              {verdictTone === "emerald"
                ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                : <AlertTriangle className="w-4 h-4 text-amber-400" />}
              <span className="text-[13px] font-bold text-slate-100">{result.summary.verdict}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Pill text={result.inferred_format} tone="violet" />
              <Pill
                text={result.numbering_method.startsWith("ANARCI") ? "Numbering: ANARCI/IMGT (exact)" : "Numbering: heuristic (approx.)"}
                tone={result.numbering_method.startsWith("ANARCI") ? "emerald" : "amber"}
              />
              <Pill text={result.summary.developability_tier} tone={bandTone(result.summary.developability_tier)} />
              <Pill text={`Aggregation: ${result.summary.aggregation_risk}`} tone="slate" />
              <Pill text={`${result.summary.n_liabilities_high} high`} tone={result.summary.n_liabilities_high > 0 ? "red" : "emerald"} />
              <Pill text={`${result.summary.n_liabilities_moderate} moderate`} tone={result.summary.n_liabilities_moderate > 0 ? "amber" : "slate"} />
              <Pill text={`${result.summary.n_liabilities_total} total liabilities`} tone="slate" />
            </div>
          </div>

          {/* ── Developability flag tally (TAP-style, transparent) ─────── */}
          <Section icon={Activity} title="Developability Flags (TAP-style)">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Pill text={result.summary.developability_tier} tone={bandTone(result.summary.developability_tier)} />
              <span className="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-slate-500/15 text-slate-400 border-slate-500/30">
                rule-based
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {([
                ["Red flags",   result.summary.developability_flags.red,   "red"],
                ["Amber flags", result.summary.developability_flags.amber, "amber"],
                ["Green",       result.summary.developability_flags.green, "emerald"],
              ] as const).map(([label, n, tone]) => (
                <div key={label} className={`rounded-lg p-2.5 text-center border ${
                  tone === "red" ? "border-red-500/30 bg-red-500/[0.06]"
                  : tone === "amber" ? "border-amber-500/30 bg-amber-500/[0.06]"
                  : "border-emerald-500/30 bg-emerald-500/[0.06]"}`}>
                  <div className={`text-[20px] font-bold font-mono ${
                    tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-emerald-300"}`}>
                    {n}
                  </div>
                  <div className="text-[9px] text-slate-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-slate-500 leading-snug">
              A transparent count of the Therapeutic-Antibody-Profiler-style flags below —
              not a tuned composite score. Structure-dependent TAP metrics (surface
              hydrophobic / charge patches) require the Layer-2 co-folded Fv.
            </div>
          </Section>

          {/* ── Conformational stability (no fabricated Tm) ────────────── */}
          <Section icon={FlaskConical} title="Conformational Stability (sequence-level)">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Pill
                text={`Outlook: ${result.stability.outlook}`}
                tone={
                  result.stability.outlook === "Favourable" ? "emerald"
                  : result.stability.outlook === "Monitor" ? "amber" : "red"
                }
              />
              <span className="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-slate-500/15 text-slate-400 border-slate-500/30">
                {result.stability.provenance}
              </span>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.02] px-2.5 py-1.5 mb-2">
              <div className="text-[11px] text-slate-300">
                Numeric Tm: <span className="text-slate-400 font-semibold">not predicted from sequence</span>
              </div>
              <div className="text-[9px] text-slate-500 leading-snug mt-0.5">
                {result.stability.assay_required}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {result.stability.signals.map((s, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Pill
                    text={s.value}
                    tone={s.level === "concern" ? "red" : s.level === "watch" ? "amber" : "emerald"}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-slate-200">
                      <span className="font-semibold">{s.chain}</span> · {s.signal}
                    </div>
                    <div className="text-[10px] text-slate-500 leading-snug">{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-slate-500 italic mt-2">{result.stability.caveat}</div>
          </Section>

          {/* ── Manufacturability ─────────────────────────────────────── */}
          <Section icon={Layers} title="Expression & Manufacturability">
            <div className="mb-2 flex items-center gap-2 flex-wrap">
              <Pill
                text={result.manufacturability.expression_outlook}
                tone={
                  /Favourable/.test(result.manufacturability.expression_outlook) ? "emerald"
                  : /Moderate/.test(result.manufacturability.expression_outlook) ? "amber" : "red"
                }
              />
              <span className="px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-slate-500/15 text-slate-400 border-slate-500/30">
                {result.manufacturability.provenance}
              </span>
            </div>
            <ul className="space-y-1">
              {result.manufacturability.factors.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[10px] text-slate-400">
                  <span className="text-slate-600 mt-0.5">•</span>{f}
                </li>
              ))}
            </ul>
            <div className="text-[9px] text-slate-500 italic mt-1.5">{result.manufacturability.note}</div>
          </Section>

          {/* per-chain cards */}
          {result.chains.map((c, i) => <ChainCard key={i} chain={c} />)}

          {/* limitations */}
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3.5 py-2.5 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
            <div className="text-[10px] text-slate-500 leading-snug">
              <span className="font-semibold text-slate-400">Scope: </span>{result.limitations}
              <span className="block mt-1">Engine: {result.engine}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
