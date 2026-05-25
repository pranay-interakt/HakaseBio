/**
 * Layer2BiologicScaffold — Layer 2 (Confirmation) UI for biologic modalities.
 *
 * The small-molecule Layer 2 (`Layer2InSilicoScaffold`) is hard-wired to
 * `SimResults` and a small-molecule toolchain (Vina, PBPK, FEP). This scaffold
 * is its biologics-native sibling: it drives the modality-aware engine in
 * `lib/biologicL2.ts` for peptides and antibodies.
 *
 * Layout contract (matches the small-molecule pages):
 *   LEFT  — all inputs + every Run button (L2 parameters, target sequence,
 *           per-stage run controls).
 *   RIGHT — outputs only (per-stage result cards).
 */

import { useMemo, useState } from "react";
import {
  Play, Loader2, CircleDot, Sliders, ArrowRight, CheckCircle2,
  AlertTriangle, XCircle, Info, FlaskConical, Activity, Shield,
  Clock, Target, Zap, Beaker, Microscope,
} from "lucide-react";
import type { PeptideResult, AntibodyResult } from "@/lib/aiService";
import {
  runBioStage0, runBioStage1Cofold, runBioStage2Binding, runBioStage3PK,
  runBioStage4Exposure, runBioStage5Safety, runBioStage6Falsifiers,
  runBioStage7Handoff, defaultBiologicL2Params,
  type BiologicModality, type BiologicL2Input, type BiologicL2Params,
  type BioStageResult, type BioStageStatus,
  type BioStage0, type BioStage1, type BioStage2, type BioStage3,
  type BioStage4, type BioStage5, type BioStage6, type BioStage7,
} from "@/lib/biologicL2";

// ── Props ───────────────────────────────────────────────────────────────────

export interface Layer2BiologicScaffoldProps {
  modality:        BiologicModality;
  layer1Ready:     boolean;
  peptideResult:   PeptideResult | null;
  antibodyResult:  AntibodyResult | null;
  peptideSequence: string;
  peptideCyclic:   boolean;
  antibodyHeavy:   string;
  antibodyLight:   string;
  onComplete?:     () => void;
}

// ── Stage registry (left-panel cards) ───────────────────────────────────────

interface StageDef {
  n: number;
  key: keyof PipelineResults;
  name: string;
  detail: string;
  engines: { name: string; note: string }[];
  /** Stages that dispatch a GPU job. */
  gpu?: boolean;
}

const STAGES: StageDef[] = [
  {
    n: 0, key: "s0", name: "Ingest L1 evidence",
    detail: "Freezes the Layer-1 biologic profile (developability, liabilities, go/no-go) as the evidence base for every downstream stage.",
    engines: [{ name: "biologicL2.runBioStage0", note: "in-house — deterministic, no network" }],
  },
  {
    n: 1, key: "s1", name: "Target-engagement co-folding", gpu: true,
    detail: "Co-folds the biologic with its target/antigen via Boltz-2 to obtain a predicted complex and interface confidence (ipTM). GPU-priced, opt-in.",
    engines: [
      { name: "Boltz-2 (MIT)", note: "co-folding + affinity head — RunPod GPU worker" },
      { name: "ColabFold MSA", note: "multiple-sequence alignment for the target" },
    ],
  },
  {
    n: 2, key: "s2", name: "Binding confirmation",
    detail: "Extracts a confidence-gated binding read-out. Peptide binders use the Boltz-2 affinity head (gated); antibody–antigen uses interface ipTM as the engagement proxy.",
    engines: [{ name: "confidenceGate.extractGatedAffinity", note: "in-house — structure-confidence gate" }],
  },
  {
    n: 3, key: "s3", name: "Modality PK projection",
    detail: "Class-based PK. Peptide: proteolysis + renal filtration. Antibody: FcRn recycling + TMDD. The small-molecule 2-compartment PBPK is hard-gated OFF.",
    engines: [{ name: "biologicL2.runBioStage3PK", note: "in-house — class-based, heuristic tier" }],
  },
  {
    n: 4, key: "s4", name: "Exposure & therapeutic index",
    detail: "Derives a dosing-frequency band from the projected half-life and flags whether a therapeutic index can yet be projected.",
    engines: [{ name: "biologicL2.runBioStage4Exposure", note: "in-house — needs Stage 2 + Stage 3" }],
  },
  {
    n: 5, key: "s5", name: "Immunogenicity & safety",
    detail: "Consolidates ADA / immunogenicity risk, aggregation and off-target signals from the Layer-1 scan into a confirmation read-out.",
    engines: [{ name: "biologicL2.runBioStage5Safety", note: "in-house — coarse heuristic screen" }],
  },
  {
    n: 6, key: "s6", name: "Confirmation falsifiers",
    detail: "Emits the per-modality registry of falsifiable wet-lab criteria (KD, Tm, t½, ADA, monomer %). Each is a pre-registered kill/redesign trigger.",
    engines: [{ name: "biologicL2.runBioStage6Falsifiers", note: "in-house — falsifier registry" }],
  },
  {
    n: 7, key: "s7", name: "Handoff summary",
    detail: "Synthesises the L2 verdict, what is confirmed in-silico vs. what must be measured, and the recommendation into L3.",
    engines: [{ name: "biologicL2.runBioStage7Handoff", note: "in-house — schema L2-biologic-handoff-v1" }],
  },
];

interface PipelineResults {
  s0?: BioStageResult<BioStage0>;
  s1?: BioStageResult<BioStage1>;
  s2?: BioStageResult<BioStage2>;
  s3?: BioStageResult<BioStage3>;
  s4?: BioStageResult<BioStage4>;
  s5?: BioStageResult<BioStage5>;
  s6?: BioStageResult<BioStage6>;
  s7?: BioStageResult<BioStage7>;
}

// ── small helpers ───────────────────────────────────────────────────────────

function statusBadgeClass(s: BioStageStatus): string {
  switch (s) {
    case "wired":        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "error":        return "bg-red-500/15 text-red-300 border-red-500/30";
    case "skipped":      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "out-of-scope": return "bg-slate-500/15 text-slate-400 border-slate-500/30";
    default:             return "bg-slate-500/15 text-slate-400 border-slate-500/30";
  }
}

function toneOf(level: string): string {
  if (/high|elevated|strong|no-go|hold|fail/i.test(level)) return "text-red-300";
  if (/moder|watch|weak/i.test(level)) return "text-amber-300";
  if (/low|go|advance|pass/i.test(level)) return "text-emerald-300";
  return "text-slate-300";
}

function Pill({ text, tone }: { text: string; tone: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-semibold ${tone}`}>
      {text}
    </span>
  );
}

// ── Stage card (left panel) ─────────────────────────────────────────────────

function StageCard({
  stage, result, busy, onRun, runDisabled, runDisabledReason,
}: {
  stage: StageDef;
  result?: BioStageResult<any>;
  busy: boolean;
  onRun: () => void;
  runDisabled: boolean;
  runDisabledReason?: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-semibold flex items-center justify-center shrink-0">
          {stage.n}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12px] font-semibold text-white">Stage {stage.n} — {stage.name}</div>
            {stage.gpu && (
              <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border bg-violet-500/15 text-violet-300 border-violet-500/30">GPU</span>
            )}
            {result && (
              <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusBadgeClass(result.status)}`}>
                {result.status}
              </span>
            )}
          </div>
          <details className="mt-0.5 group">
            <summary className="cursor-pointer list-none text-[10px] text-slate-500 hover:text-slate-300 select-none inline-flex items-center gap-1">
              <span className="text-slate-600 group-open:rotate-90 transition-transform inline-block w-2">▸</span>
              <span>What this stage does &amp; toolchain</span>
            </summary>
            <div className="text-[10px] text-slate-500 leading-relaxed mt-1.5">{stage.detail}</div>
            <div className="space-y-1 mt-1.5">
              {stage.engines.map(e => (
                <div key={e.name} className="flex items-baseline gap-2 text-[10px]">
                  <CircleDot className="w-2 h-2 text-slate-600 shrink-0 translate-y-0.5" />
                  <span className="text-slate-300 font-medium">{e.name}</span>
                  <span className="text-slate-500">— {e.note}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
      <div className="pl-8 mt-2.5 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={runDisabled || busy}
          onClick={onRun}
          title={runDisabled ? runDisabledReason : `Run Stage ${stage.n}`}
          className={`text-[10px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
            !runDisabled && !busy
              ? "bg-cyan-600/30 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-500/40 cursor-pointer"
              : "bg-slate-700/30 border border-slate-600/30 text-slate-500 cursor-not-allowed"
          }`}
        >
          {busy
            ? <><Loader2 className="w-3 h-3 animate-spin" />Running…</>
            : <><Play className="w-3 h-3" />Run stage</>}
        </button>
        {runDisabled && runDisabledReason && (
          <span className="text-[9px] text-slate-500 italic">{runDisabledReason}</span>
        )}
      </div>
    </div>
  );
}

// ── Result shell (right panel) ──────────────────────────────────────────────

function ResultShell({
  n, name, status, icon: Icon, children,
}: {
  n: number; name: string; status: BioStageStatus; icon: any; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white/[0.02] border-b border-white/8">
        <Icon className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
        <span className="text-[12px] font-semibold text-white">Stage {n} — {name}</span>
        <span className={`ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusBadgeClass(status)}`}>
          {status}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function KV({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[11px] text-slate-400">{label}</div>
        {source && <div className="text-[9px] text-slate-600">{source}</div>}
      </div>
      <div className="text-[11px] font-mono font-semibold text-slate-200 text-right shrink-0">{value}</div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function Layer2BiologicScaffold({
  modality, layer1Ready, peptideResult, antibodyResult,
  peptideSequence, peptideCyclic, antibodyHeavy, antibodyLight, onComplete,
}: Layer2BiologicScaffoldProps) {
  const [params, setParams]   = useState<BiologicL2Params>(defaultBiologicL2Params());
  const [targetSeq, setTargetSeq] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [results, setResults] = useState<PipelineResults>({});
  const [busyStage, setBusyStage] = useState<number | null>(null);
  const [cofoldProgress, setCofoldProgress] = useState("");

  const buildInput = (): BiologicL2Input => ({
    modality,
    peptide: peptideResult,
    antibody: antibodyResult,
    peptideSequence,
    peptideCyclic,
    antibodyHeavy,
    antibodyLight,
    targetSequence: targetSeq,
    targetLabel: targetLabel || undefined,
  });

  const setOne = (key: keyof PipelineResults, value: BioStageResult<any>) =>
    setResults(prev => ({ ...prev, [key]: value }));

  // Why a stage cannot run yet (null = runnable).
  const runBlock = (n: number): string | null => {
    if (!layer1Ready) return "Run Layer 1 first";
    switch (n) {
      case 1: return targetSeq.trim().length < 20
        ? "Enter a target/antigen sequence"
        : !params.gpuCostAck ? "Acknowledge GPU cost" : null;
      case 2: return results.s1?.status === "wired" ? null : "Needs Stage 1";
      case 4: return results.s3?.status === "wired" ? null : "Needs Stage 3";
      case 7: return results.s0?.status === "wired" ? null : "Needs Stage 0";
      default: return null;
    }
  };

  const runStage = async (n: number) => {
    setBusyStage(n);
    try {
      const input = buildInput();
      switch (n) {
        case 0: setOne("s0", runBioStage0(input)); break;
        case 1: {
          setCofoldProgress("submitting…");
          const r = await runBioStage1Cofold(input, params, msg => setCofoldProgress(msg));
          setOne("s1", r);
          setCofoldProgress("");
          if (r.status === "wired") setOne("s2", runBioStage2Binding(modality, r.result));
          break;
        }
        case 2: setOne("s2", runBioStage2Binding(modality, results.s1?.result)); break;
        case 3: {
          const r = runBioStage3PK(input, params);
          setOne("s3", r);
          break;
        }
        case 4: setOne("s4", runBioStage4Exposure(modality, results.s2?.result, results.s3?.result, params)); break;
        case 5: setOne("s5", runBioStage5Safety(input)); break;
        case 6: setOne("s6", runBioStage6Falsifiers(input, results.s2?.result, results.s3?.result)); break;
        case 7: {
          const r = runBioStage7Handoff(input, {
            s0: results.s0?.result, s2: results.s2?.result, s3: results.s3?.result,
            s4: results.s4?.result, s5: results.s5?.result, s6: results.s6?.result,
          });
          setOne("s7", r);
          if (r.status === "wired") onComplete?.();
          break;
        }
      }
    } finally {
      setBusyStage(null);
    }
  };

  // Run every in-house (non-GPU) stage in dependency order.
  const runInHouse = async () => {
    if (!layer1Ready) return;
    setBusyStage(99);
    try {
      const input = buildInput();
      const s0 = runBioStage0(input);
      const s3 = runBioStage3PK(input, params);
      const s5 = runBioStage5Safety(input);
      const s2 = results.s1?.status === "wired" ? runBioStage2Binding(modality, results.s1.result) : results.s2;
      const s4 = runBioStage4Exposure(modality, s2?.result, s3.result, params);
      const s6 = runBioStage6Falsifiers(input, s2?.result, s3.result);
      const s7 = runBioStage7Handoff(input, {
        s0: s0.result, s2: s2?.result, s3: s3.result, s4: s4.result, s5: s5.result, s6: s6.result,
      });
      setResults(prev => ({ ...prev, s0, s2: s2 ?? prev.s2, s3, s4, s5, s6, s7 }));
      if (s7.status === "wired") onComplete?.();
    } finally {
      setBusyStage(null);
    }
  };

  const completedCount = useMemo(
    () => Object.values(results).filter(r => r && r.status === "wired").length,
    [results],
  );

  const modalityLabel = modality === "peptide" ? "Peptide" : "Antibody";

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT — inputs + run controls ──────────────────────────────── */}
      <div className="w-[480px] border-r border-white/8 overflow-y-auto flex flex-col shrink-0">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="w-4 h-4 text-cyan-300" />
            <h3 className="text-[13px] font-semibold text-white flex-1">
              Layer 2 — {modalityLabel} Confirmation
            </h3>
            <span className="text-[9px] text-slate-500">{completedCount}/8 stages</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Modality-aware in-silico confirmation. Co-folding binding, class-based PK,
            immunogenicity and a falsifier registry — the small-molecule docking / PBPK /
            FEP toolchain is hard-gated off for biologics.
          </p>
        </div>

        <div className="flex-1 p-5 space-y-5">

          {/* L1-not-ready notice */}
          {!layer1Ready && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-amber-200">
                Run the Layer-1 {modalityLabel.toLowerCase()} analysis first — Layer 2 reads its frozen evidence.
              </div>
            </div>
          )}

          {/* Target / antigen sequence */}
          <section className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Target className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[11px] font-semibold text-slate-200 uppercase tracking-widest">
                {modality === "peptide" ? "Target protein" : "Antigen"}
              </span>
              <span className="ml-auto text-[9px] text-slate-500 italic">required for Stage 1</span>
            </div>
            <input
              value={targetLabel}
              onChange={e => setTargetLabel(e.target.value)}
              placeholder={modality === "peptide" ? "Target name (e.g. GLP-1R)" : "Antigen name (e.g. HER2)"}
              className="w-full bg-white/5 border border-white/10 text-white text-[11px] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
            />
            <textarea
              value={targetSeq}
              onChange={e => setTargetSeq(e.target.value.toUpperCase().replace(/[^A-Z\s]/g, ""))}
              placeholder={`Paste the ${modality === "peptide" ? "target protein" : "antigen"} amino-acid sequence (one-letter codes)…`}
              rows={4}
              className="w-full bg-black/30 border border-white/10 text-white text-[11px] font-mono rounded-md px-2.5 py-1.5 resize-y focus:outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
            />
            <div className="text-[9px] text-slate-600">
              {targetSeq.replace(/\s/g, "").length} residues · co-folding needs ≥ 20.
            </div>
          </section>

          {/* L2 parameters */}
          <section className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[11px] font-semibold text-slate-200 uppercase tracking-widest">L2 Parameters</span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">Target occupancy</span>
                <span className="text-cyan-300 font-mono">{(params.targetOccupancy * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min={0.5} max={0.95} step={0.05} value={params.targetOccupancy}
                onChange={e => setParams({ ...params, targetOccupancy: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Route</span>
                <select
                  value={params.route}
                  onChange={e => setParams({ ...params, route: e.target.value as BiologicL2Params["route"] })}
                  className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="sc">Subcutaneous</option>
                  <option value="iv">Intravenous</option>
                  <option value="im">Intramuscular</option>
                  <option value="oral">Oral</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">Body weight (kg)</span>
                <input
                  type="number" min={1} max={250} step={1} value={params.bodyWeightKg}
                  onChange={e => setParams({ ...params, bodyWeightKg: parseFloat(e.target.value) || 70 })}
                  className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 font-mono focus:outline-none focus:border-cyan-500/50"
                />
              </label>
            </div>

            {modality === "peptide" && (
              <label className="flex items-center gap-2 text-[10px] text-slate-300">
                <input
                  type="checkbox" checked={params.requestAffinity}
                  onChange={e => setParams({ ...params, requestAffinity: e.target.checked })}
                  className="accent-cyan-400"
                />
                Request the Boltz-2 affinity head (peptide binder)
              </label>
            )}

            <label className="flex items-start gap-2 text-[10px] text-slate-300 rounded-md border border-violet-500/25 bg-violet-500/[0.05] p-2">
              <input
                type="checkbox" checked={params.gpuCostAck}
                onChange={e => setParams({ ...params, gpuCostAck: e.target.checked })}
                className="accent-violet-400 mt-0.5"
              />
              <span>I understand Stage 1 co-folding dispatches a <strong>GPU job</strong> (Boltz-2, ~5–40 min, metered cost).</span>
            </label>
          </section>

          {/* Run-all */}
          <button
            type="button"
            disabled={!layer1Ready || busyStage !== null}
            onClick={runInHouse}
            className={`w-full text-[11px] font-semibold px-3 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors ${
              layer1Ready && busyStage === null
                ? "bg-cyan-600 hover:bg-cyan-500 text-white"
                : "bg-slate-700/40 text-slate-500 cursor-not-allowed"
            }`}
          >
            {busyStage === 99
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Running in-house stages…</>
              : <><Play className="w-3.5 h-3.5" />Run all in-house stages (skip GPU)</>}
          </button>

          {/* Stage cards */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Confirmation Stages</span>
            </div>
            {STAGES.map(stage => {
              const block = runBlock(stage.n);
              return (
                <StageCard
                  key={stage.n}
                  stage={stage}
                  result={results[stage.key]}
                  busy={busyStage === stage.n}
                  runDisabled={block !== null || busyStage !== null}
                  runDisabledReason={block ?? undefined}
                  onRun={() => runStage(stage.n)}
                />
              );
            })}
          </div>

          {cofoldProgress && (
            <div className="rounded-md border border-violet-500/25 bg-violet-500/[0.05] px-3 py-2 text-[10px] text-violet-200 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Co-folding — {cofoldProgress}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT — outputs ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {completedCount === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <FlaskConical className="w-7 h-7 text-cyan-400/50" />
            </div>
            <div className="text-[14px] font-medium text-slate-400">No confirmation results yet</div>
            <div className="text-[11px] text-slate-600 max-w-sm">
              Configure the L2 parameters on the left and run the confirmation stages.
              Results — co-folding binding, class-based PK, immunogenicity and the
              falsifier registry — appear here.
            </div>
          </div>
        )}

        {/* Stage 0 */}
        {results.s0 && (
          <ResultShell n={0} name="L1 Evidence" status={results.s0.status} icon={Beaker}>
            {results.s0.status === "error"
              ? <div className="text-[11px] text-red-300">{results.s0.reason}</div>
              : results.s0.result && (() => {
                const r = results.s0!.result!;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill text={`Go/No-Go: ${r.goNoGo}`} tone={
                        r.goNoGo === "GO" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : r.goNoGo === "NO-GO" ? "bg-red-500/15 text-red-300 border-red-500/30"
                        : "bg-amber-500/15 text-amber-300 border-amber-500/30"} />
                      <Pill text={r.designLabel} tone="bg-cyan-500/15 text-cyan-300 border-cyan-500/30" />
                      <span className="text-[11px] text-slate-400">{r.l1Verdict}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-5">
                      {r.evidenceFields.map(f => (
                        <KV key={f.label} label={f.label} value={f.value} source={f.source} />
                      ))}
                    </div>
                    {r.keyLiabilities.length > 0 && (
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2">
                        <div className="text-[10px] font-semibold text-amber-300 mb-1">Key liabilities carried into L2</div>
                        {r.keyLiabilities.map((l, i) => (
                          <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                            <span className="text-amber-500/70 mt-0.5">•</span>{l}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
          </ResultShell>
        )}

        {/* Stage 1 */}
        {results.s1 && (
          <ResultShell n={1} name="Target-engagement co-folding" status={results.s1.status} icon={Target}>
            {results.s1.status !== "wired"
              ? <div className={`text-[11px] ${results.s1.status === "error" ? "text-red-300" : "text-amber-300"}`}>{results.s1.reason}</div>
              : results.s1.result && (() => {
                const r = results.s1!.result!;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill text={`Interface: ${r.interfaceClass}`} tone={
                        r.interfaceClass === "high" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : r.interfaceClass === "moderate" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                        : "bg-red-500/15 text-red-300 border-red-500/30"} />
                      <Pill text={`ipTM ${r.iptm !== null ? r.iptm.toFixed(3) : "—"}`} tone="bg-cyan-500/15 text-cyan-300 border-cyan-500/30" />
                    </div>
                    <div className="grid grid-cols-2 gap-x-5">
                      <KV label="ipTM (interface)" value={r.iptm !== null ? r.iptm.toFixed(3) : "—"} />
                      <KV label="Complex pLDDT" value={r.complexPlddt !== null ? r.complexPlddt.toFixed(1) : "—"} />
                      <KV label="Engine" value={r.cofold.engine} />
                      <KV label="Boltz version" value={r.cofold.boltz_version} />
                      <KV label="Chains modelled" value={String(r.cofold.n_chains)} />
                      <KV label="Residues modelled" value={String(r.cofold.n_residues_modeled)} />
                    </div>
                    {r.cofold.warnings.length > 0 && (
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[10px] text-amber-200">
                        {r.cofold.warnings.map((w, i) => <div key={i}>• {w}</div>)}
                      </div>
                    )}
                  </div>
                );
              })()}
          </ResultShell>
        )}

        {/* Stage 2 */}
        {results.s2 && (
          <ResultShell n={2} name="Binding confirmation" status={results.s2.status} icon={Zap}>
            {results.s2.status !== "wired"
              ? <div className="text-[11px] text-amber-300">{results.s2.reason}</div>
              : results.s2.result && (() => {
                const r = results.s2!.result!;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill text={r.headlineValue} tone="bg-cyan-500/15 text-cyan-300 border-cyan-500/30" />
                      <Pill text={`Engagement: ${r.engagementClass}`} tone={
                        /strong/.test(r.engagementClass) ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : /moder/.test(r.engagementClass) ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                        : "bg-red-500/15 text-red-300 border-red-500/30"} />
                      <Pill text={`provenance: ${r.provenance}`} tone="bg-slate-500/15 text-slate-400 border-slate-500/30" />
                    </div>
                    {r.gated && r.gated.Ki_nM !== null && (
                      <div className="grid grid-cols-2 gap-x-5">
                        <KV label="Ki" value={`${r.gated.Ki_nM.toFixed(1)} nM`} />
                        <KV label="Kd" value={r.gated.Kd_nM !== null ? `${r.gated.Kd_nM.toFixed(1)} nM` : "—"} />
                        <KV label="IC50" value={r.gated.IC50_uM !== null ? `${r.gated.IC50_uM.toFixed(3)} µM` : "—"} />
                        <KV label="Gate verdict" value={r.gated.gate.verdict} />
                      </div>
                    )}
                    <div className="space-y-1">
                      {r.notes.map((n, i) => (
                        <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                          <Info className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />{n}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
          </ResultShell>
        )}

        {/* Stage 3 */}
        {results.s3 && (
          <ResultShell n={3} name="Modality PK projection" status={results.s3.status} icon={Clock}>
            {results.s3.status === "error"
              ? <div className="text-[11px] text-red-300">{results.s3.reason}</div>
              : results.s3.result && (() => {
                const r = results.s3!.result!;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill text={r.halfLifeText} tone="bg-cyan-500/15 text-cyan-300 border-cyan-500/30" />
                      {r.tmddRelevant && <Pill text="TMDD-relevant" tone="bg-violet-500/15 text-violet-300 border-violet-500/30" />}
                      <Pill text={`provenance: ${r.provenance}`} tone="bg-slate-500/15 text-slate-400 border-slate-500/30" />
                    </div>
                    <div className="grid grid-cols-1 gap-x-5">
                      <KV label="Clearance route" value={r.clearanceRoute} />
                      <KV label="Volume of distribution" value={r.volumeDistributionText} />
                      <KV label="Bioavailability" value={r.bioavailabilityText} />
                      <KV label="Dosing implication" value={r.dosingImplication} />
                    </div>
                    <div className="space-y-1">
                      {r.notes.map((n, i) => (
                        <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                          <Info className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />{n}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
          </ResultShell>
        )}

        {/* Stage 4 */}
        {results.s4 && (
          <ResultShell n={4} name="Exposure & therapeutic index" status={results.s4.status} icon={Activity}>
            {results.s4.status !== "wired"
              ? <div className="text-[11px] text-amber-300">{results.s4.reason}</div>
              : results.s4.result && (() => {
                const r = results.s4!.result!;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill text={`Dosing: ${r.dosingFrequency}`} tone="bg-cyan-500/15 text-cyan-300 border-cyan-500/30" />
                      <Pill text={r.therapeuticIndexReady ? "TI projectable" : "TI not yet projectable"}
                        tone={r.therapeuticIndexReady ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"} />
                    </div>
                    {r.exposureNotes.map((n, i) => (
                      <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                        <Info className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />{n}
                      </div>
                    ))}
                    {r.blockers.length > 0 && (
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2">
                        {r.blockers.map((b, i) => (
                          <div key={i} className="text-[10px] text-amber-200 flex items-start gap-1.5">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{b}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
          </ResultShell>
        )}

        {/* Stage 5 */}
        {results.s5 && (
          <ResultShell n={5} name="Immunogenicity & safety" status={results.s5.status} icon={Shield}>
            {results.s5.status === "error"
              ? <div className="text-[11px] text-red-300">{results.s5.reason}</div>
              : results.s5.result && (() => {
                const r = results.s5!.result!;
                return (
                  <div className="space-y-3">
                    <Pill text={`Immunogenicity band: ${r.immunogenicityBand}`} tone={
                      /high/.test(r.immunogenicityBand) ? "bg-red-500/15 text-red-300 border-red-500/30"
                      : /moder/.test(r.immunogenicityBand) ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"} />
                    <div className="space-y-1.5">
                      {r.signals.map((s, i) => (
                        <div key={i} className="flex items-start gap-2 border-b border-white/5 pb-1.5 last:border-0">
                          <Pill text={s.level} tone={
                            s.level === "high" ? "bg-red-500/15 text-red-300 border-red-500/30"
                            : s.level === "moderate" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                            : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold text-slate-200">{s.category}</div>
                            <div className="text-[10px] text-slate-500 leading-snug">{s.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="text-[10px] text-slate-500 italic flex items-start gap-1.5">
                      <Info className="w-3 h-3 shrink-0 mt-0.5" />{r.caveat}
                    </div>
                  </div>
                );
              })()}
          </ResultShell>
        )}

        {/* Stage 6 */}
        {results.s6 && (
          <ResultShell n={6} name="Confirmation falsifiers" status={results.s6.status} icon={Microscope}>
            {results.s6.result && (
              <div className="space-y-2.5">
                <p className="text-[10px] text-slate-500">{results.s6.result.note}</p>
                {results.s6.result.falsifiers.map(f => (
                  <div key={f.id} className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono font-bold text-cyan-300">{f.id}</span>
                      <span className="text-[11px] font-semibold text-slate-200">{f.description}</span>
                      <Pill text="pending measurement" tone="bg-slate-500/15 text-slate-400 border-slate-500/30" />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 text-[10px]">
                      <KV label="Predicted / L1 signal" value={f.predicted} />
                      <KV label={`Pass threshold (${f.comparator})`} value={f.threshold} />
                    </div>
                    <div className="text-[10px] text-slate-500">Confirmatory assay: <span className="text-slate-400">{f.assay}</span></div>
                  </div>
                ))}
              </div>
            )}
          </ResultShell>
        )}

        {/* Stage 7 */}
        {results.s7 && results.s7.result && (
          <ResultShell n={7} name="Handoff summary" status={results.s7.status} icon={ArrowRight}>
            {(() => {
              const r = results.s7!.result!;
              return (
                <div className="space-y-3">
                  <div className={`rounded-lg border px-4 py-3 ${
                    r.l2Verdict === "ADVANCE" ? "border-emerald-500/30 bg-emerald-500/[0.07]"
                    : r.l2Verdict === "HOLD" ? "border-red-500/30 bg-red-500/[0.07]"
                    : "border-amber-500/30 bg-amber-500/[0.07]"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {r.l2Verdict === "ADVANCE"
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        : r.l2Verdict === "HOLD"
                        ? <XCircle className="w-4 h-4 text-red-400" />
                        : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                      <span className={`text-[13px] font-bold ${toneOf(r.l2Verdict)}`}>L2 verdict: {r.l2Verdict}</span>
                    </div>
                    <p className="text-[11px] text-slate-300">{r.recommendation}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
                      <div className="text-[10px] font-semibold text-emerald-300 mb-1.5">Confirmed in-silico</div>
                      {r.confirmedInSilico.map((c, i) => (
                        <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />{c}
                        </div>
                      ))}
                    </div>
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.04] p-3">
                      <div className="text-[10px] font-semibold text-amber-300 mb-1.5">Needs wet-lab measurement</div>
                      {r.needsWetLab.map((c, i) => (
                        <div key={i} className="text-[10px] text-slate-400 flex items-start gap-1.5">
                          <ArrowRight className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />{c}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-[9px] text-slate-600 text-right">schema: {r.schemaVersion}</div>
                </div>
              );
            })()}
          </ResultShell>
        )}
      </div>
    </div>
  );
}
