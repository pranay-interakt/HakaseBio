import { useState, useMemo, useEffect, Fragment } from "react";
import {
  Cpu, ArrowRight, Database, Microscope, Atom, Sparkles, AlertCircle, AlertTriangle,
  CircleDot, Play, Activity, Shield, Beaker, CheckCircle2, Settings2, ChevronDown, ChevronRight,
  Sliders, Loader2, Zap, FlaskConical, ServerCrash, Copy,
} from "lucide-react";
import type { SimResults } from "@/lib/admet";
import type { InVitroResults } from "@/lib/inVitroSim";
import type { L2DoseProjection, MarginTier, L2InputParams } from "@/lib/l2DoseProjection";
import {
  humanFuPlasma, humanFuMic, humanBpRatio,
  type IvieWetLabInputs,
} from "@/lib/ivieInputs";
import {
  runFullPipeline, runStage0, runStage1, runStage2Docking, runStage3, runStage4,
  runStage5, runStage5Fep, runStage6, runStage7, runStage8, runStage9,
  type PipelineResults, type StageResult, type StageStatus,
} from "@/lib/l2Pipeline";
import { getFepConfig, type FepConfigStatus, type FepJobStatus } from "@/lib/aiService";

interface Layer2InSilicoScaffoldProps {
  layer1Ready: boolean;
  simResults: SimResults | null;
  inVitroResults: InVitroResults | null;
  /** P0 IVIVE substrate inputs (cross-species fu_p, fu_mic, B/P).
   *  When supplied, human values are merged into the L2 params right before
   *  invoking the pipeline — form overrides still win. */
  ivieInputs?: IvieWetLabInputs;
  onContinue: () => void;
  onComplete?: () => void;
  /** Fires whenever Stage 8 (L2 Dose Projection) finishes wiring — surfaces
   *  the IVIVE outputs (Cmax target, Vd, F, hepatic CL, predicted dose,
   *  margins, verdict) to the parent so downstream layers (L3 Animal Cohort)
   *  can display the values that will be fed into allometric scaling. */
  onProjectionReady?: (proj: L2DoseProjection) => void;
}

// ── Stage definitions (text from architecture doc §4.3, paraphrased) ────────
type StageDef = {
  n: number;
  name: string;
  detail: string;
  wired: "in-house" | "ai-service" | "out-of-scope";
  engines: { name: string; note: string }[];
};

const L2_STAGES: StageDef[] = [
  {
    n: 0, name: "Ingest L1 outputs", wired: "in-house",
    detail: "Validate L1 fields, pin timestamps. Records what was actually handed off — no transformation yet.",
    engines: [
      { name: "L1 Parquet writer (in-memory)",   note: "direct hand-off via simResults + inVitroResults" },
      { name: "ChEMBL / IUPHAR",     note: "L1 already queries ChEMBL via api-server proxy" },
      { name: "UniProt / PDB / AlphaFold", note: "L1 already fetches these" },
    ],
  },
  {
    n: 1, name: "Target druggability", wired: "ai-service",
    detail: "Protein druggability via ESM-embedded random-forest classifier on the L1 UniProt target. L1 ligand descriptors (MW, logP, TPSA, QED, SA, RoF, Veber) are passively surfaced for at-a-glance context — they are not recomputed (RDKit-JS is deterministic; integrity is enforced by the L1 EvidencePointer frozen in Stage 0, not by a fake re-derivation falsifier).",
    engines: [
      { name: "ai-service /predict/protein-ml",   note: "ESM2 embedding → druggability classifier" },
      { name: "L1 ligand context (passive)",      note: "MW/logP/TPSA/QED/SA/RoF/Veber re-rendered from L1 SimResults; not recomputed" },
      { name: "fpocket / P2Rank",                 note: "OOS — pocket detection requires PDB + GPU" },
    ],
  },
  {
    n: 2, name: "Docking", wired: "ai-service",
    detail: "AutoDock Vina (CPU) on the L1 UniProt's top experimental PDB. Receptor auto-prepped via OpenBabel (-xr); ligand 3D-embedded with RDKit/UFF then PDBQT'd via OpenBabel (Gasteiger, pH 7.4). Box auto-picked from a co-crystallized HETATM ligand when available (HETATM blocklist excludes waters/ions/buffers/cryoprotectants); blind-dock fallback is explicit and warning-flagged.",
    engines: [
      { name: "AutoDock Vina 1.2.7",   note: "Apache 2.0 — classical docking, runs locally via subprocess" },
      { name: "OpenBabel 3.1.1",       note: "GPL-2 — receptor & ligand PDBQT preparation" },
      { name: "RDKit 2026.3.1",        note: "BSD-3 — ligand 3D embedding + UFF energy minimisation" },
      { name: "Deep-learning co-folding", note: "OOS — structure-prediction + affinity co-folding (GPU)" },
    ],
  },
  {
    n: 3, name: "ML affinity + ADMET cross-check", wired: "ai-service",
    detail: "DeepDTA-style GBM (ESM target embedding × Morgan ligand FP) for orthogonal pKd. ADMET-AI Chemprop GNN for cross-check vs L1. Disagreement is flagged, never hidden.",
    engines: [
      { name: "ai-service /predict/binding-ml", note: "ESM2 + Morgan FP → pKd regressor" },
      { name: "ai-service /predict/admet-ml",   note: "ADMET-AI Chemprop multi-task GNN" },
      { name: "Uni-Mol / MoLFormer-XL",         note: "OOS today — would replace GBM with foundation embedding" },
    ],
  },
  {
    n: 4, name: "Selectivity + cardiotox cross-check", wired: "ai-service",
    detail: "L1 selectivity panel (off-target IC50/fold). Cardiotox: trained Morgan-FP RF for Kv11.1 blocker probability — consensus with L1 categorical hERG risk.",
    engines: [
      { name: "L1 selectivity panel", note: "in-house — kinase / GPCR off-target hits" },
      { name: "ai-service /predict/cardiotox", note: "Morgan FP RF — hERG blocker probability" },
      { name: "ChEMBL / IUPHAR off-target panel", note: "cited reference; not run by Stage 4 today" },
    ],
  },
  {
    n: 5, name: "Free-energy refinement", wired: "ai-service",
    detail: "OpenMM + OpenFF Sage with TIES relative-binding-FEP, dispatched to a RunPod Serverless GPU endpoint (A100/H100). Computes ΔΔG (Ligand B − Ligand A) for the same PDB receptor. Opt-in per pair: ~24 GPU-h ≈ $40–$50. Use Ligand A = current L1 compound, Ligand B = proposed analog.",
    engines: [
      { name: "OpenMM 8.x",            note: "MIT — Python-first, GPU-accelerated MD (worker container)" },
      { name: "OpenFF Toolkit (Sage 2.x)", note: "MIT — modern force fields with auto-parameterisation" },
      { name: "TIES-MD",               note: "open relative-binding-FEP framework on OpenMM" },
      { name: "RunPod Serverless",     note: "dispatch backend — requires RUNPOD_API_KEY + RUNPOD_FEP_ENDPOINT_ID" },
    ],
  },
  {
    n: 6, name: "PBPK projection", wired: "in-house",
    detail: "Two-compartment PBPK (RK4 ODE). Allometric scaling on body weight; albumin- and logP-corrected hepatic CL; Caco-2-derived F. Computes plasma curve, Cmax, AUC, t½, Vdss.",
    engines: [
      { name: "lib/pbpk.ts (in-house)", note: "RK4 ODE; Davies & Morris physiology constants" },
      { name: "PK-Sim / mrgsolve",      note: "cited reference; replace this when wired into a job queue" },
    ],
  },
  {
    n: 7, name: "QSP / PD coupling", wired: "in-house",
    detail: "Hill-equation receptor occupancy from PBPK unbound-concentration curve. Computes peak occupancy, time-above-50%, AUC of effect.",
    engines: [
      { name: "lib/l2Pipeline.ts runStage7", note: "Hill slope 1, Ki from L1, fu from L1 or override" },
      { name: "Tellurium / libRoadRunner", note: "cited reference for full SBML / QSP model coupling" },
    ],
  },
  {
    n: 8, name: "Therapeutic-index ranking", wired: "in-house",
    detail: "Receptor occupancy → required Cmax,unbound. Margins: hERG, CYP3A4, CC50, worst-off-target. First-pass human dose projection (well-stirred liver model + Caco-2 → F bins).",
    engines: [
      { name: "lib/l2DoseProjection.ts", note: "in-house — Hill, well-stirred liver, Yee 1997, Obach 2008" },
    ],
  },
  {
    n: 9, name: "Output / handoff", wired: "in-house",
    detail: "L2-handoff-v1 JSON: predicted human dose, predicted unbound + total Cmax, liability flags, FEP estimate (null — Stage 5 OOS), confidence flag. Copyable for L3 ingest.",
    engines: [
      { name: "Stage9Result schema", note: "in-house — schema_version='L2-handoff-v1'" },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, digits: number, suffix = ""): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
}

function tierColor(t: MarginTier): string {
  if (t === "SAFE")    return "border-emerald-500/35 bg-emerald-500/8 text-emerald-300";
  if (t === "CAUTION") return "border-amber-500/35 bg-amber-500/8 text-amber-300";
  if (t === "RISK")    return "border-rose-500/35 bg-rose-500/8 text-rose-300";
  return "border-slate-500/30 bg-slate-500/8 text-slate-400";
}

function verdictColor(v: "GO" | "WATCH" | "NO-GO"): string {
  if (v === "GO")    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (v === "WATCH") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

function statusBadgeClass(s: StageStatus | "ready"): string {
  if (s === "wired")        return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (s === "out-of-scope") return "border-slate-500/40 bg-slate-500/10 text-slate-400";
  if (s === "error")        return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  if (s === "skipped")      return "border-amber-500/30 bg-amber-500/8 text-amber-300";
  return "border-cyan-500/40 bg-cyan-500/8 text-cyan-300";
}

// ── MarginBar (Stage 8 result card) ─────────────────────────────────────────
function MarginBar({ row }: { row: { label: string; ratio: number | null; tier: MarginTier; numerator: string; denominator: string; assumption: string } }) {
  const display = row.ratio === null || !isFinite(row.ratio)
    ? "—"
    : row.ratio >= 1000 ? `${(row.ratio / 1000).toFixed(1)}k×`
    : row.ratio >= 100  ? `${row.ratio.toFixed(0)}×`
    : `${row.ratio.toFixed(1)}×`;
  const fillPct = row.ratio === null || !isFinite(row.ratio)
    ? 0
    : Math.min(100, Math.max(2, (Math.log10(Math.max(1, row.ratio)) / 3) * 100));
  const fillClass =
    row.tier === "SAFE"    ? "bg-emerald-500/60"
    : row.tier === "CAUTION" ? "bg-amber-500/60"
    : row.tier === "RISK"  ? "bg-rose-500/60"
    : "bg-slate-500/40";
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold text-white">{row.label}</div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-mono text-cyan-300">{display}</span>
          <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${tierColor(row.tier)}`}>{row.tier}</span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full ${fillClass}`} style={{ width: `${fillPct}%` }} />
      </div>
      <div className="text-[10px] text-slate-500 leading-relaxed">
        <span className="text-slate-400">{row.numerator}</span> ÷ <span className="text-slate-400">{row.denominator}</span>
      </div>
      <div className="text-[9px] text-slate-600 leading-relaxed italic">{row.assumption}</div>
    </div>
  );
}

function L1OutputRow({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5">
      <div className="flex flex-col">
        <span className="text-[11px] text-slate-300">{label}</span>
        {source && <span className="text-[9px] text-slate-600 uppercase tracking-wider">{source}</span>}
      </div>
      <span className={value === "—" ? "text-slate-600 text-[11px] font-mono" : "text-cyan-300 text-[11px] font-mono"}>{value}</span>
    </div>
  );
}

// ── Stage card (left panel) ────────────────────────────────────────────────
function StageCard({
  stage, status, busy, onRun, hasResult, runDisabled, runDisabledReason,
}: {
  stage: StageDef;
  status: StageStatus | "ready";
  busy: boolean;
  hasResult: boolean;
  onRun: () => void;
  runDisabled: boolean;
  runDisabledReason?: string;
}) {
  const canRun = stage.wired !== "out-of-scope";
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-semibold flex items-center justify-center shrink-0">
          {stage.n}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12px] font-semibold text-white">Stage {stage.n} — {stage.name}</div>
            {hasResult && (
              <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusBadgeClass(status)}`}>{status}</span>
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
                  {e.note && <span className="text-slate-500">— {e.note}</span>}
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
      {canRun && (
        <div className="pl-8 mt-2.5 flex items-center gap-2">
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
      )}
    </div>
  );
}

// ── Input parameters card ──────────────────────────────────────────────────
function InputParamsCard({
  params, setParams,
}: { params: L2InputParams; setParams: (p: L2InputParams) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const occ = params.targetOccupancy ?? 0.75;
  const bw  = params.bodyWeightKg ?? 70;
  const route = params.route ?? "oral";
  const dpd = params.dosesPerDay ?? 1;
  return (
    <section className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Sliders className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-[11px] font-semibold text-slate-200 uppercase tracking-widest">L2 Input Parameters</span>
        <span className="ml-auto text-[9px] text-slate-500 italic">applied to Stage 6, 7, 8 + handoff</span>
      </div>

      {/* Occupancy slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-300">Target receptor occupancy</span>
          <span className="text-cyan-300 font-mono">{(occ * 100).toFixed(0)}% (Cmax,u = {(occ / Math.max(1e-3, 1 - occ)).toFixed(2)}× Ki)</span>
        </div>
        <input
          type="range" min={0.5} max={0.95} step={0.05} value={occ}
          onChange={e => setParams({ ...params, targetOccupancy: parseFloat(e.target.value) })}
          className="w-full accent-cyan-400"
        />
        <div className="flex justify-between text-[9px] text-slate-600">
          <span>50% (1×Ki)</span><span>75% (3×Ki)</span><span>95% (19×Ki)</span>
        </div>
      </div>

      {/* Body weight + route + freq */}
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Body weight (kg)</span>
          <input
            type="number" min={1} max={250} step={1} value={bw}
            onChange={e => setParams({ ...params, bodyWeightKg: parseFloat(e.target.value) })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 font-mono focus:outline-none focus:border-cyan-500/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Route</span>
          <select
            value={route}
            onChange={e => setParams({ ...params, route: e.target.value as "oral" | "iv" })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 focus:outline-none focus:border-cyan-500/50"
          >
            <option value="oral">Oral (PO)</option>
            <option value="iv">IV (F=1)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Dosing freq.</span>
          <select
            value={dpd}
            onChange={e => setParams({ ...params, dosesPerDay: parseInt(e.target.value, 10) })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 focus:outline-none focus:border-cyan-500/50"
          >
            <option value={1}>QD (1×)</option>
            <option value={2}>BID (2×)</option>
            <option value={3}>TID (3×)</option>
            <option value={4}>QID (4×)</option>
          </select>
        </label>
      </div>

      {/* Advanced overrides */}
      <button
        type="button"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="text-[10px] text-slate-400 hover:text-slate-300 flex items-center gap-1"
      >
        {advancedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced overrides (bypass L1 / models — clear to revert)
      </button>
      {advancedOpen && (
        <div className="grid grid-cols-2 gap-3 pt-1">
          {[
            { k: "fuOverride" as const, label: "fu (0–1)",         hint: "L1 plasma protein binding" },
            { k: "VdOverride" as const, label: "Vd (L/kg)",        hint: "logP-binned proxy" },
            { k: "FOverride"  as const, label: "F oral (0–1)",     hint: "Caco-2 → F bins (Yee 1997)" },
            { k: "CLOverride" as const, label: "CL (mL/min/kg)",   hint: "well-stirred liver model" },
          ].map(({ k, label, hint }) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</span>
              <input
                type="number" min={0} step="any"
                value={params[k] ?? ""}
                placeholder={`use ${hint}`}
                onChange={e => {
                  const v = e.target.value;
                  setParams({ ...params, [k]: v === "" ? undefined : parseFloat(v) });
                }}
                className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-cyan-200 font-mono placeholder:text-slate-600 placeholder:text-[10px] placeholder:italic focus:outline-none focus:border-cyan-500/50"
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Result card scaffolding ────────────────────────────────────────────────
function ResultShell({ stage, name, icon: Icon, status, reason, children }: {
  stage: number; name: string; icon: any;
  status: StageStatus | "ready"; reason?: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-cyan-300" />
        <h3 className="text-[13px] font-semibold text-white">Stage {stage} — {name}</h3>
        <span className={`ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${statusBadgeClass(status)}`}>{status}</span>
      </div>
      {reason && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-2.5 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span className="text-[10px] text-amber-200 leading-relaxed">{reason}</span>
        </div>
      )}
      {children}
    </div>
  );
}

// ── Inline mini PK chart (SVG) ─────────────────────────────────────────────
function MiniLineChart({ data, xKey, yKey, color, height = 80 }: {
  data: any[]; xKey: string; yKey: string; color: string; height?: number;
}) {
  if (!data.length) return null;
  const W = 320, H = height, P = 6;
  const xs = data.map(d => d[xKey]);
  const ys = data.map(d => d[yKey]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = 0,                ymax = Math.max(...ys, 0.001);
  const sx = (x: number) => P + ((x - xmin) / Math.max(1e-6, xmax - xmin)) * (W - 2 * P);
  const sy = (y: number) => H - P - ((y - ymin) / Math.max(1e-6, ymax - ymin)) * (H - 2 * P);
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${sx(d[xKey]).toFixed(1)} ${sy(d[yKey]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
      <text x={P} y={10} fill="#475569" fontSize="9">{ymax.toFixed(2)}</text>
      <text x={P} y={H - 1} fill="#475569" fontSize="9">0</text>
      <text x={W - 14} y={H - 1} fill="#475569" fontSize="9">{xmax}h</text>
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function Layer2InSilicoScaffold({ layer1Ready, simResults, inVitroResults, ivieInputs, onContinue, onComplete, onProjectionReady }: Layer2InSilicoScaffoldProps) {
  // Merge IVIVE substrate inputs into L2 params at run-time.
  // Precedence: explicit form override > IVIVE measured value > L1 fallback.
  const mergeIvie = (p: L2InputParams): L2InputParams => {
    if (!ivieInputs) return p;
    const out: L2InputParams = { ...p };
    if (out.fuOverride === undefined) {
      const fp = humanFuPlasma(ivieInputs);
      if (fp !== null) out.fuOverride = fp;
    }
    if (out.fuMicHuman === undefined) {
      const fm = humanFuMic(ivieInputs);
      if (fm !== null) out.fuMicHuman = fm;
    }
    if (out.bpRatioHuman === undefined) {
      const bp = humanBpRatio(ivieInputs);
      if (bp !== null) out.bpRatioHuman = bp;
    }
    return out;
  };
  const hasL1 = !!simResults && !!inVitroResults;

  const [params, setParams] = useState<L2InputParams>({
    targetOccupancy: 0.75, bodyWeightKg: 70, route: "oral", dosesPerDay: 1,
  });
  const [results, setResults] = useState<PipelineResults>({});
  const [busyStage, setBusyStage] = useState<number | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);

  // FEP inputs — Stage 5 needs a Ligand B SMILES + PDB ID + explicit GPU-cost confirmation.
  // Ligand A defaults to the L1 compound; PDB defaults to the Stage 2-resolved receptor when present.
  const [fepLigandB,     setFepLigandB]     = useState<string>("");
  const [fepPdbId,       setFepPdbId]       = useState<string>("");
  const [fepCostOk,      setFepCostOk]      = useState<boolean>(false);
  const [fepConfig,      setFepConfig]      = useState<FepConfigStatus | null>(null);
  const [fepProgress,    setFepProgress]    = useState<string>("");

  // Load Stage-5 backend config status once on mount so the Run button can be
  // disabled with the exact missing-secret reason instead of letting the user click and 503.
  useEffect(() => {
    let cancelled = false;
    getFepConfig().then(c => { if (!cancelled) setFepConfig(c); })
                  .catch(e => { if (!cancelled) setFepConfig({ configured: false, reason: e?.message ?? "config probe failed" }); });
    return () => { cancelled = true; };
  }, []);

  // Auto-prefill PDB from Stage 2 once it lands, only if the user hasn't typed something.
  useEffect(() => {
    const s2pdb = results.s2?.result?.pdb_id;
    if (s2pdb && !fepPdbId) setFepPdbId(s2pdb);
  }, [results.s2, fepPdbId]);

  // "Auto-pipeline" stages = wired stages that the Run-Full-Pipeline button executes.
  // Stage 2 (Vina docking, 30–90 s/ligand) and Stage 5 (TIES FEP, ~24 GPU-h ≈ $50/pair)
  // are both wired but intentionally opt-in — full-pipeline skips both, user clicks each card.
  const wiredCount   = useMemo(() => L2_STAGES.filter(s => s.wired !== "out-of-scope").length, []);
  const autoRunCount = useMemo(() => L2_STAGES.filter(s => s.wired !== "out-of-scope" && s.n !== 2 && s.n !== 5).length, []);

  // ── Per-stage runners ────────────────────────────────────────────────────
  const setOne = (key: keyof PipelineResults, value: any) => {
    setResults(prev => ({ ...prev, [key]: value }));
  };

  const stage8DosePerAdmin = (): number => {
    const proj = results.s8?.result;
    if (!proj || !isFinite(proj.predictedDose_mg_per_day)) return NaN;
    return proj.predictedDose_mg_per_day / Math.max(1, Math.floor(params.dosesPerDay ?? 1));
  };

  const runStageHandler = async (n: number) => {
    if (!simResults || !inVitroResults) return;
    setBusyStage(n);
    try {
      switch (n) {
        case 0: setOne("s0", runStage0(simResults, inVitroResults)); break;
        case 1: setOne("s1", await runStage1(simResults)); break;
        case 2: setOne("s2", await runStage2Docking(simResults)); break;
        case 3: {
          // Stage 3 now works for ALL targets (including off-catalog). It runs
          // ML binding + ADMET-AI for any UniProt. The L1↔ML agreement check
          // is simply skipped when L1 catalog binding is not available.
          // Pass Stage 2 Vina result for the physics↔ML cross-comparison when
          // docking has already been run via the Stage 2 "Run" button.
          const s2r = results.s2?.status === "wired" ? results.s2.result : undefined;
          setOne("s3", await runStage3(simResults, s2r));
          break;
        }
        case 4: setOne("s4", await runStage4(simResults, inVitroResults)); break;
        case 5: {
          // Stage 5 is opt-in and requires explicit Ligand B + PDB ID + cost confirmation
          // + a configured RunPod backend. runDisabledReasonForStage(5) gates the button,
          // but re-check here so we never silently dispatch an unconfirmed $50 job.
          if (!fepConfig?.configured) {
            setOne("s5", {
              stage: 5, name: "Free-energy refinement", status: "error",
              reason: `RunPod is not configured: ${fepConfig?.reason ?? "config probe pending"}. Set RUNPOD_API_KEY and RUNPOD_FEP_ENDPOINT_ID secrets on the AI service.`,
            } as StageResult<any>);
            break;
          }
          if (!fepCostOk) {
            setOne("s5", {
              stage: 5, name: "Free-energy refinement", status: "error",
              reason: "GPU-cost confirmation required — tick the ‘I understand ~24 GPU-h ≈ $40–$50’ box on the Stage 5 card before dispatching.",
            } as StageResult<any>);
            break;
          }
          setFepProgress("submitting…");
          const r = await runStage5Fep(simResults, fepLigandB, fepPdbId, {
            onProgress: (s: FepJobStatus) => setFepProgress(`${s.status}: ${s.progress}`),
          });
          setOne("s5", r);
          setFepProgress("");
          break;
        }
        case 6: setOne("s6", runStage6(simResults, inVitroResults, params, stage8DosePerAdmin())); break;
        case 7: {
          // Stage 7 now works with or without L1 catalog binding — it prefers
          // the ML pKd from Stage 3 when available, falls back to L1 heuristic
          // Ki, and uses a labeled fallback default when neither is available.
          const pk = results.s6?.result;
          const fu = results.s8?.result?.fu_fraction;
          if (!pk || !fu) {
            setOne("s7", {
              stage: 7, name: "QSP / PD coupling", status: "error",
              reason: "Run Stage 6 (PBPK) and Stage 8 (TI) first — Stage 7 needs the PK curve and a valid fu.",
            } as StageResult<any>);
          } else {
            // Pass ML Kd from Stage 3 (preferred) — null if Stage 3 hasn't run
            const mlKd = results.s3?.result?.binding_ml.available
              ? results.s3.result.binding_ml.Kd_nM
              : null;
            setOne("s7", runStage7(simResults, pk, fu, mlKd));
          }
          break;
        }
        case 8: {
          // RF#1 / §9 step 1 (code-review fix): L2 dose projection requires
          // an L1 binding estimate (primaryKi). When the target UniProt is
          // off-catalog, sim.binding is null and computeL2DoseProjection
          // throws. Surface this as a friendly stage-error instead of a
          // runtime overlay.
          if (!simResults.binding) {
            setOne("s8", {
              stage: 8, name: "Dose projection", status: "error",
              reason: "L2 dose projection requires an L1 binding estimate. The selected UniProt is not in the validated catalog — pick a curated target (EGFR, HER2, KRAS, BRAF, BTK, JAK2, ABL1, ALK).",
            } as StageResult<any>);
            break;
          }
          const r = runStage8(simResults, inVitroResults, mergeIvie(params));
          setOne("s8", r);
          if (r.status === "wired") {
            onComplete?.();
            if (r.result) onProjectionReady?.(r.result);
          }
          break;
        }
        case 9: setOne("s9", runStage9(simResults, results.s8?.result, results.s6?.result, params, results.s5?.result)); break;
      }
    } finally {
      setBusyStage(null);
    }
  };

  const runFull = async () => {
    if (!simResults || !inVitroResults) return;
    // RF#1 / §9 step 1 (code-review fix): runFullPipeline drives stages 3,
    // 7, 8, and tissue-selectivity which all throw on null binding. Block
    // the full-pipeline run upfront and tell the user why.
    if (!simResults.binding) {
      alert(
        "L2 pipeline requires a validated on-target binding estimate.\n\n" +
        "L1 returned binding=null because the selected UniProt is not in the validated catalog. " +
        "Pick a curated target (EGFR, HER2, KRAS, BRAF, BTK, JAK2, ABL1, ALK) before running the full L2 pipeline."
      );
      return;
    }
    setPipelineRunning(true);
    setResults({});
    try {
      const out = await runFullPipeline(simResults, inVitroResults, mergeIvie(params), n => setBusyStage(n));
      setResults(out);
      if (out.s8?.status === "wired") {
        onComplete?.();
        if (out.s8.result) onProjectionReady?.(out.s8.result);
      }
    } finally {
      setPipelineRunning(false);
      setBusyStage(null);
    }
  };

  const runDisabledReasonForStage = (n: number): string | undefined => {
    if (!hasL1) return "awaiting L1";
    if (n === 5) {
      if (fepConfig === null) return "checking RunPod config…";
      if (!fepConfig.configured) return "RunPod not configured";
      if (!fepLigandB.trim())    return "needs Ligand B SMILES";
      if (fepPdbId.trim().length !== 4) return "needs 4-letter PDB ID";
      if (!fepCostOk)            return "confirm ~$50 GPU cost";
      return undefined;
    }
    if (n === 6) return isFinite(stage8DosePerAdmin()) ? undefined : "needs Stage 8 dose";
    if (n === 7) return (results.s6?.result && results.s8?.result?.fu_fraction) ? undefined : "needs Stage 6 + 8";
    if (n === 9) return results.s8?.result ? undefined : "needs Stage 8";
    return undefined;
  };

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT STATUS / INPUTS PANEL ─────────────────────────────────────── */}
      <div className="w-[480px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h2 className="text-[15px] font-semibold text-white">Layer 2 — In Silico</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              {wiredCount}/10 wired · {autoRunCount} auto + S2/S5 opt-in
            </span>
          </div>
          <p className="text-[12px] text-slate-500">Ten stages wired. Two are opt-in from their own cards: <span className="text-cyan-300">Stage 2</span> docking (AutoDock Vina, 30–90 s CPU) and <span className="text-cyan-300">Stage 5</span> TIES relative-binding FEP (RunPod Serverless, ~24 GPU-h ≈ $40–$50 per pair). Run-Full-Pipeline executes the other {autoRunCount} auto stages.</p>
        </div>

        <div className="flex-1 p-5 space-y-6">

          {/* L1 readiness banner */}
          <div className={`rounded-xl border p-3 flex items-start gap-2.5 ${
            layer1Ready ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"
          }`}>
            {layer1Ready
              ? <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />}
            <div className="flex-1">
              <div className={`text-[11px] font-semibold ${layer1Ready ? "text-emerald-300" : "text-amber-300"}`}>
                {layer1Ready ? "L1 simulation complete" : "Awaiting L1 In Vitro completion"}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                {layer1Ready
                  ? "L1 produced the in-vitro digital twin below. These are the actual fields L2 ingests."
                  : "Run L1 In Vitro first to enable L2 stages."}
              </p>
            </div>
          </div>

          {/* L1 INPUTS */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">L1 Inputs</span>
              <span className={`ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${hasL1 ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-400/80" : "border-amber-500/30 bg-amber-500/8 text-amber-400/80"}`}>
                {hasL1 ? "Live" : "Pending"}
              </span>
            </div>
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
              <L1OutputRow label="Compound"            source="L1 / chemistry.ts (RDKit)" value={simResults ? simResults.molName : "—"} />
              <L1OutputRow label="UniProt target"      source="L1 / UniProt KB API"       value={simResults ? simResults.uniprotId : "—"} />
              <L1OutputRow label="MW · LogP · TPSA"    source="RDKit descriptors"          value={simResults ? `${simResults.lipinski.mw.toFixed(0)} · ${simResults.lipinski.logP.toFixed(2)} · ${simResults.lipinski.tpsa.toFixed(0)}` : "—"} />
              <L1OutputRow label="Predicted Ki (nM)"   source="ai-service / DeepDTA-GBM"   value={simResults?.binding ? `${simResults.binding.primaryKi.toFixed(1)}` : "—"} />
              <L1OutputRow label="hERG IC50 (µM)"      source="L1 in-vitro sim"            value={inVitroResults ? `${inVitroResults.herg.ic50_uM.toFixed(2)}` : "—"} />
              <L1OutputRow label="Plasma fu (%)"       source="L1 PPB sim"                  value={inVitroResults ? `${inVitroResults.plasmaProteinBinding.fuPercent.toFixed(2)}` : "—"} />
              <L1OutputRow label="Caco-2 Papp (×10⁻⁶)" source="L1 permeability sim"        value={inVitroResults ? `${inVitroResults.permeability.caco2Papp.toFixed(1)}` : "—"} />
              <L1OutputRow label="Microsomal CLint"    source="L1 metabolic stability"      value={inVitroResults ? `${inVitroResults.metabolicStability.microsomalCLint.toFixed(0)} µL/min/mg` : "—"} />
              <L1OutputRow label="Off-target hits"     source="L1 selectivity panel"        value={inVitroResults && inVitroResults.selectivity.offTargetHits !== null && inVitroResults.selectivity.totalTargetsTested !== null ? `${inVitroResults.selectivity.offTargetHits} / ${inVitroResults.selectivity.totalTargetsTested}` : "no off-target panel"} />
              <L1OutputRow label="L1 Go / No-Go"       source="L1 cascade gate"             value={simResults ? simResults.goNogo : "—"} />
            </div>
          </section>

          {/* INPUT PARAMETERS */}
          <InputParamsCard params={params} setParams={setParams} />

          {/* PIPELINE STAGES */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Atom className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">L2 Pipeline (architecture doc §4.3)</span>
            </div>
            <div className="space-y-2">
              {L2_STAGES.map(s => {
                const key = (`s${s.n}`) as keyof PipelineResults;
                const r = results[key];
                const status: StageStatus | "ready" = r ? r.status : "ready";
                return (
                  <StageCard
                    key={s.n} stage={s} status={status}
                    busy={busyStage === s.n} hasResult={!!r}
                    onRun={() => runStageHandler(s.n)}
                    runDisabled={!hasL1 || pipelineRunning || !!runDisabledReasonForStage(s.n)}
                    runDisabledReason={!hasL1 ? "awaiting L1" : runDisabledReasonForStage(s.n)}
                  />
                );
              })}
            </div>
          </section>

          {/* RUN FULL PIPELINE */}
          <button
            type="button"
            disabled={!hasL1 || pipelineRunning}
            onClick={runFull}
            className={`w-full font-semibold h-11 rounded-lg gap-2 text-[13px] flex items-center justify-center transition-colors ${
              hasL1 && !pipelineRunning
                ? "bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer"
                : "bg-slate-700/40 border border-slate-600/40 text-slate-500 cursor-not-allowed"
            }`}
            title={hasL1 ? "Run all wired L2 stages with current inputs" : "Awaiting L1 In Vitro completion"}
          >
            {pipelineRunning
              ? <><Loader2 className="w-4 h-4 animate-spin" />Running pipeline (Stage {busyStage ?? "…"})…</>
              : <><Play className="w-4 h-4" />Run Full L2 Pipeline ({autoRunCount} auto · S2/S5 opt-in)</>}
          </button>

        </div>
      </div>

      {/* ── RIGHT OUTPUT / DOCUMENTATION PANE ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="w-full space-y-5">

          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Cpu className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-[18px] font-semibold text-white">L2 — In Silico</h2>
              <p className="text-[12px] text-slate-400 leading-relaxed mt-0.5">
                Computational triage between L1 wet-style assays and the Ex-Vivo sub-track within L2 Confirmation.
                Architecture doc §4.3 — {wiredCount} of 10 stages wired ({autoRunCount} auto-run by Run-Full; Stage 2 docking and Stage 5 TIES FEP are opt-in from their own cards due to wall time / GPU cost).
              </p>
            </div>
          </div>

          {/* Stage 0 */}
          {results.s0 && results.s0.result && (
            <ResultShell stage={0} name="Ingest L1 outputs" icon={Database} status={results.s0.status}>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="text-slate-500">Compound</div><div className="text-cyan-300 font-mono text-right truncate">{results.s0.result.molName}</div>
                <div className="text-slate-500">UniProt</div><div className="text-cyan-300 font-mono text-right">{results.s0.result.uniprotId}</div>
                <div className="text-slate-500">L1 timestamp</div><div className="text-cyan-300 font-mono text-right">{new Date(results.s0.result.l1Stamp).toLocaleTimeString()}</div>
              </div>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                Field availability: {Object.entries(results.s0.result.l1Fields).filter(([_, v]) => v).length} / {Object.keys(results.s0.result.l1Fields).length} required L1 fields present.
              </div>
            </ResultShell>
          )}

          {/* Stage 1 — Target druggability */}
          {results.s1 && (
            <ResultShell stage={1} name="Target druggability" icon={FlaskConical} status={results.s1.status} reason={results.s1.reason}>
              {results.s1.result && (() => {
                const r = results.s1.result;
                return (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1" title="Passively rendered from the frozen L1 SimResults — these values are not recomputed by Stage 1. Integrity is enforced by the L1 EvidencePointer (Stage 0), not by a re-derivation check.">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider">L1 ligand context · passive</div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                          <span className="text-slate-500">MW</span><span className="text-cyan-300 font-mono text-right">{r.rdkit_descriptors.mw.toFixed(0)}</span>
                          <span className="text-slate-500">LogP</span><span className="text-cyan-300 font-mono text-right">{r.rdkit_descriptors.logP.toFixed(2)}</span>
                          <span className="text-slate-500">TPSA</span><span className="text-cyan-300 font-mono text-right">{r.rdkit_descriptors.tpsa.toFixed(0)}</span>
                          <span className="text-slate-500">HBD/HBA</span><span className="text-cyan-300 font-mono text-right">{r.rdkit_descriptors.hbd}/{r.rdkit_descriptors.hba}</span>
                          <span className="text-slate-500">RotB</span><span className="text-cyan-300 font-mono text-right">{r.rdkit_descriptors.rotBonds}</span>
                          <span className="text-slate-500">QED~ · SA</span><span className="text-cyan-300 font-mono text-right">{r.rdkit_descriptors.qed_approx.toFixed(2)} · {r.rdkit_descriptors.saScore.toFixed(2)}</span>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${r.rule_of_5.pass ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/8" : "border-amber-500/30 text-amber-300 bg-amber-500/8"}`}>RoF {r.rule_of_5.pass ? "pass" : `${r.rule_of_5.violations} viol.`}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${r.veber_pass ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/8" : "border-amber-500/30 text-amber-300 bg-amber-500/8"}`}>Veber {r.veber_pass ? "pass" : "fail"}</span>
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wider">Protein druggability (ESM2)</div>
                        <div className="text-[18px] font-mono text-cyan-200">
                          {r.protein.druggability_probability !== null ? `${(r.protein.druggability_probability * 100).toFixed(0)}%` : "—"}
                        </div>
                        <div className="text-[10px] text-slate-300">{r.protein.druggability_class ?? "unavailable"}</div>
                        <div className="text-[9px] text-slate-500 italic">source: {r.protein.source}{r.protein.error ? ` · ${r.protein.error}` : ""}</div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </ResultShell>
          )}

          {/* Stage 2 — AutoDock Vina docking */}
          {results.s2 && (
            <ResultShell stage={2} name="Docking (AutoDock Vina)" icon={Atom} status={results.s2.status} reason={results.s2.reason}>
              {results.s2.result && (() => {
                const s2 = results.s2.result;
                const dock = s2.dock;
                const mlPKd = results.s3?.result?.binding_ml.pKd_predicted ?? null;
                const dockPkd = s2.best_pKd_equivalent;
                const cross = (mlPKd !== null && isFinite(mlPKd)) ? Math.abs(dockPkd - mlPKd) : null;
                const crossClass: "strong" | "moderate" | "disagreement" | "unknown" =
                  cross === null ? "unknown" : cross < 1 ? "strong" : cross < 2 ? "moderate" : "disagreement";
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">Best ΔG</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{s2.best_affinity_kcal_mol.toFixed(2)}</div>
                        <div className="text-[9px] text-slate-600">kcal/mol</div>
                      </div>
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center" title="Heuristic transform of Vina score, NOT an experimental or thermodynamic Kd. Use only as orthogonal sanity-check vs ML pKd.">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">pKd-equiv*</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{s2.best_pKd_equivalent.toFixed(2)}</div>
                        <div className="text-[9px] text-slate-600">heuristic, 298 K</div>
                      </div>
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">Pose RMSD₂</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{s2.pose_convergence_rmsd !== null ? s2.pose_convergence_rmsd.toFixed(2) : "—"}</div>
                        <div className="text-[9px] text-slate-600">Å (mode 2 vs 1)</div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">Receptor</span>
                        <span className="text-[11px] text-cyan-300 font-mono">{dock.pdb_id}</span>
                        <span className="text-[9px] text-slate-500">({dock.receptor_atom_count.toLocaleString()} atoms)</span>
                        <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full border ${
                          dock.box.method === "co_crystal"
                            ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/8"
                            : "border-amber-500/30 text-amber-300 bg-amber-500/8"
                        }`}>
                          box: {dock.box.method === "co_crystal" ? `co-crystal (${dock.box.source_residue})` : "blind dock"}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        center [{dock.box.center.map(c => c.toFixed(1)).join(", ")}] Å · size [{dock.box.size.map(c => c.toFixed(1)).join(", ")}] Å
                      </div>
                      {s2.pdb_candidates.length > 0 && (
                        <div className="pt-1 border-t border-white/5 mt-1">
                          <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">PDB ranking ({s2.pdb_candidates.length} considered)</div>
                          <ul className="text-[10px] text-slate-400 space-y-0.5">
                            {s2.pdb_candidates.map((c, i) => (
                              <li key={c.pdbId} className={i === 0 ? "text-cyan-300" : ""}>
                                <span className="font-mono">{i === 0 ? "▸" : " "} {c.pdbId}</span>
                                <span className="text-slate-500"> — {c.rationale} (score {c.score.toFixed(0)})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1">
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Top {dock.poses.length} poses</div>
                      <div className="grid grid-cols-4 gap-x-3 gap-y-0.5 text-[10px]">
                        <span className="text-slate-500">mode</span>
                        <span className="text-slate-500 text-right">ΔG (kcal/mol)</span>
                        <span className="text-slate-500 text-right">RMSD lb</span>
                        <span className="text-slate-500 text-right">RMSD ub</span>
                        {dock.poses.map(p => (
                          <Fragment key={p.mode}>
                            <span className="text-cyan-300 font-mono">{p.mode}</span>
                            <span className="text-cyan-300 font-mono text-right">{p.affinity_kcal_mol.toFixed(2)}</span>
                            <span className="text-cyan-300 font-mono text-right">{p.rmsd_lb.toFixed(2)}</span>
                            <span className="text-cyan-300 font-mono text-right">{p.rmsd_ub.toFixed(2)}</span>
                          </Fragment>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1">
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider">Cross-check vs Stage 3 binding-ml</div>
                      <div className="text-[9px] text-amber-300/70 italic leading-snug">
                        * pKd-equiv is a heuristic transform of the empirical Vina score (pKd ≈ −score / 1.364 at 298 K) — not an experimental or thermodynamic Kd. Used here only as an orthogonal sanity-check against the ML pKd.
                      </div>
                      {mlPKd === null ? (
                        <div className="text-[10px] text-slate-500 italic">Run Stage 3 to compare Vina pKd-equiv vs ML pKd.</div>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-x-2 text-[10px]">
                            <span className="text-slate-500">Vina pKd-equiv</span>
                            <span className="text-slate-500 text-center">ML pKd</span>
                            <span className="text-slate-500 text-right">|Δ| (log)</span>
                            <span className="text-cyan-300 font-mono">{dockPkd.toFixed(2)}</span>
                            <span className="text-cyan-300 font-mono text-center">{mlPKd.toFixed(2)}</span>
                            <span className="text-cyan-300 font-mono text-right">{cross!.toFixed(2)}</span>
                          </div>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border inline-block ${
                            crossClass === "strong" ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/8"
                            : crossClass === "moderate" ? "border-amber-500/30 text-amber-300 bg-amber-500/8"
                            : "border-rose-500/30 text-rose-300 bg-rose-500/8"
                          }`}>{crossClass}</span>
                        </>
                      )}
                    </div>

                    {dock.warnings.length > 0 && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-0.5">
                        <div className="text-[10px] text-amber-300 uppercase tracking-wider flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Warnings
                        </div>
                        <ul className="text-[10px] text-amber-200/80 list-disc list-inside space-y-0.5">
                          {dock.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="text-[9px] text-slate-500 italic">
                      {dock.vina_version} · {dock.runtime_seconds.toFixed(1)} s wall · ligand {dock.ligand_atom_count} atoms · physical-tier scoring (provenance: {s2.source})
                    </div>
                  </>
                );
              })()}
            </ResultShell>
          )}

          {/* Stage 3 — ML cross-check */}
          {results.s3 && results.s3.result && (() => {
            const r = results.s3.result;
            return (
              <ResultShell stage={3} name="ML affinity + ADMET cross-check" icon={Zap} status={results.s3.status}>
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">Affinity cross-check</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                      <span className="text-slate-500">L1 pKi</span><span className="text-cyan-300 font-mono text-right">{fmt(r.l1_pKi, 2)}</span>
                      <span className="text-slate-500">ML pKd</span><span className="text-cyan-300 font-mono text-right">{fmt(r.binding_ml.pKd_predicted, 2)}</span>
                      <span className="text-slate-500">|Δ| (log)</span><span className="text-cyan-300 font-mono text-right">{fmt(r.log_disagreement, 2)}</span>
                      <span className="text-slate-500">ML Kd</span><span className="text-cyan-300 font-mono text-right">{r.binding_ml.Kd_nM !== null ? `${r.binding_ml.Kd_nM.toFixed(1)} nM` : "—"}</span>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                      r.agreement_class === "strong" ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/8"
                      : r.agreement_class === "moderate" ? "border-amber-500/30 text-amber-300 bg-amber-500/8"
                      : r.agreement_class === "disagreement" ? "border-rose-500/30 text-rose-300 bg-rose-500/8"
                      : "border-slate-500/30 text-slate-400 bg-slate-500/8"
                    }`}>{r.agreement_class}</span>
                    <div className="text-[9px] text-slate-500 italic">source: {r.binding_ml.source}{r.binding_ml.error ? ` · ${r.binding_ml.error}` : ""}</div>
                  </div>
                  <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">ADMET-AI consistency</div>
                    <div className="text-[10px] text-slate-300">L1: abs {(r.l1_admet_consistency.absorption_l1*100).toFixed(0)}%, met {(r.l1_admet_consistency.metabolism_l1*100).toFixed(0)}%, tox {(r.l1_admet_consistency.toxicity_l1*100).toFixed(0)}%</div>
                    <div className="text-[10px] text-slate-300">ML available: {r.admet_ml.available ? "yes" : "no"} ({r.admet_ml.endpoint_count} endpoints)</div>
                    <ul className="text-[9px] text-slate-500 italic list-disc list-inside space-y-0.5">
                      {r.l1_admet_consistency.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                </div>
              </ResultShell>
            );
          })()}

          {/* Stage 4 — Selectivity + cardiotox */}
          {results.s4 && results.s4.result && (() => {
            const r = results.s4.result;
            return (
              <ResultShell stage={4} name="Selectivity + cardiotox cross-check" icon={Shield} status={results.s4.status}>
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">Selectivity</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                      <span className="text-slate-500">Class</span><span className="text-cyan-300 text-right">{r.l1_selectivity.selectivityClass}</span>
                      <span className="text-slate-500">Hits / tested</span><span className="text-cyan-300 font-mono text-right">{r.l1_selectivity.offTargetHits} / {r.l1_selectivity.totalTargetsTested}</span>
                      <span className="text-slate-500">Worst fold</span><span className="text-cyan-300 font-mono text-right">{r.l1_selectivity.worstFold !== null ? `${r.l1_selectivity.worstFold.toFixed(1)}×` : "—"}</span>
                      <span className="text-slate-500">Worst target</span><span className="text-cyan-300 text-right truncate">{r.l1_selectivity.worstName ?? "—"}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5 space-y-1">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">Cardiac risk consensus</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                      <span className="text-slate-500">L1 hERG</span><span className="text-cyan-300 text-right">{r.herg_l1.risk} ({r.herg_l1.ic50_uM.toFixed(2)} µM)</span>
                      <span className="text-slate-500">ML class</span><span className="text-cyan-300 text-right">{r.cardiotox_ml.risk_class ?? "—"}</span>
                      <span className="text-slate-500">ML p(blocker)</span><span className="text-cyan-300 font-mono text-right">{r.cardiotox_ml.blocker_probability !== null ? `${(r.cardiotox_ml.blocker_probability * 100).toFixed(0)}%` : "—"}</span>
                    </div>
                    <div className={`text-[10px] px-1.5 py-0.5 rounded-full border inline-block ${
                      r.consensus_cardiac_risk === "Conflict" ? "border-rose-500/40 text-rose-300 bg-rose-500/10"
                      : r.consensus_cardiac_risk === "High" ? "border-rose-500/40 text-rose-300 bg-rose-500/10"
                      : r.consensus_cardiac_risk === "Moderate" ? "border-amber-500/40 text-amber-300 bg-amber-500/10"
                      : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                    }`}>Consensus: {r.consensus_cardiac_risk}</div>
                    <div className="text-[9px] text-slate-500 italic">source: {r.cardiotox_ml.source}{r.cardiotox_ml.error ? ` · ${r.cardiotox_ml.error}` : ""}</div>
                  </div>
                </div>
              </ResultShell>
            );
          })()}

          {/* Stage 5 — TIES relative-binding FEP (opt-in, RunPod GPU) */}
          <ResultShell
            stage={5} name="Free-energy refinement (TIES on RunPod)" icon={Zap}
            status={results.s5?.status ?? "ready"}
            reason={results.s5?.reason}
          >
            {/* Backend status banner — surfaces missing-secret reason verbatim */}
            <div className={`rounded-lg border p-2.5 flex items-start gap-2 ${
              fepConfig === null ? "border-slate-500/30 bg-slate-500/8"
              : fepConfig.configured ? "border-emerald-500/30 bg-emerald-500/8"
              : "border-amber-500/30 bg-amber-500/8"
            }`}>
              {fepConfig === null
                ? <Loader2 className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5 animate-spin" />
                : fepConfig.configured
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  : <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />}
              <div className="flex-1">
                <div className={`text-[11px] font-semibold ${
                  fepConfig === null ? "text-slate-300"
                  : fepConfig.configured ? "text-emerald-300" : "text-amber-300"
                }`}>
                  {fepConfig === null
                    ? "Probing RunPod backend…"
                    : fepConfig.configured
                      ? "RunPod backend configured — Stage 5 dispatch enabled"
                      : "RunPod backend not configured"}
                </div>
                {fepConfig && !fepConfig.configured && fepConfig.reason && (
                  <div className="text-[10px] text-amber-200/80 leading-relaxed mt-1">
                    {fepConfig.reason}. Set <span className="font-mono text-amber-100">RUNPOD_API_KEY</span> and <span className="font-mono text-amber-100">RUNPOD_FEP_ENDPOINT_ID</span> on the AI service to enable Stage 5. Per project policy, no ΔΔG estimate is fabricated when the GPU backend is unavailable.
                  </div>
                )}
              </div>
            </div>

            {/* Inputs (hidden after a successful run; collapsible) */}
            {results.s5?.status !== "wired" && (
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-2.5">
                <div className="grid grid-cols-1 gap-2.5">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Ligand A SMILES (reference, from L1)</span>
                    <input
                      type="text" value={simResults?.smiles ?? ""} readOnly
                      className="bg-black/30 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-slate-400 font-mono focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">Ligand B SMILES (perturbed analog)</span>
                    <input
                      type="text" value={fepLigandB}
                      onChange={e => setFepLigandB(e.target.value)}
                      placeholder="e.g. Cc1ccc(NC(=O)c2cccnc2)cc1"
                      className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-cyan-200 font-mono focus:outline-none focus:border-cyan-500/50 placeholder:text-slate-600 placeholder:italic"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">PDB ID (4-letter receptor; auto-filled from Stage 2 when available)</span>
                    <input
                      type="text" value={fepPdbId} maxLength={4}
                      onChange={e => setFepPdbId(e.target.value.toUpperCase())}
                      placeholder="e.g. 6G2N"
                      className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-cyan-200 font-mono uppercase focus:outline-none focus:border-cyan-500/50 placeholder:text-slate-600 placeholder:italic"
                    />
                  </label>
                </div>

                <label className="flex items-start gap-2 pt-1">
                  <input
                    type="checkbox" checked={fepCostOk}
                    onChange={e => setFepCostOk(e.target.checked)}
                    className="mt-0.5 accent-cyan-500"
                  />
                  <span className="text-[10px] text-slate-300 leading-relaxed">
                    I understand this dispatch consumes <span className="text-amber-300 font-semibold">~24 GPU-h on a RunPod A100 (~$40–$50)</span> and is billed to the RunPod account associated with <span className="font-mono">RUNPOD_API_KEY</span>.
                  </span>
                </label>

                <button
                  type="button"
                  disabled={
                    !hasL1 || pipelineRunning || busyStage === 5 ||
                    !!runDisabledReasonForStage(5)
                  }
                  onClick={() => runStageHandler(5)}
                  className={`w-full font-semibold h-9 rounded-md gap-2 text-[12px] flex items-center justify-center transition-colors ${
                    !runDisabledReasonForStage(5) && !pipelineRunning && busyStage !== 5
                      ? "bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer"
                      : "bg-slate-700/40 border border-slate-600/40 text-slate-500 cursor-not-allowed"
                  }`}
                  title={runDisabledReasonForStage(5) ?? "Dispatch FEP job to RunPod"}
                >
                  {busyStage === 5
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />FEP running… {fepProgress && <span className="font-mono text-[10px] opacity-80">({fepProgress})</span>}</>
                    : <><Play className="w-3.5 h-3.5" />Dispatch FEP {runDisabledReasonForStage(5) && <span className="text-[10px] opacity-70">— {runDisabledReasonForStage(5)}</span>}</>}
                </button>
                <p className="text-[9px] text-slate-500 italic leading-relaxed">
                  TIES protocol: 12 λ-windows × 3 replicas × 5 ns/window. Job is async; this card polls every 30 s for up to 36 h. RunPod job_id is recorded in the result and visible in the RunPod console.
                </p>
              </div>
            )}

            {/* Result */}
            {results.s5?.status === "wired" && results.s5.result && (() => {
              const r = results.s5.result;
              const f = r.fep;
              const ddgClass =
                f.ddg_kcal_mol < -1.5 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : f.ddg_kcal_mol >  1.5 ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-300";
              const verdict =
                f.ddg_kcal_mol < -1.5 ? "Ligand B substantially tighter than A"
                : f.ddg_kcal_mol > 1.5 ? "Ligand B substantially weaker than A"
                : "Within ±1.5 kcal/mol — within FEP noise floor";
              return (
                <>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div className={`rounded border p-2 text-center ${ddgClass}`}>
                      <div className="text-[9px] uppercase tracking-wider opacity-80">ΔΔG (B − A)</div>
                      <div className="text-[14px] font-mono font-semibold">{f.ddg_kcal_mol >= 0 ? "+" : ""}{f.ddg_kcal_mol.toFixed(2)}</div>
                      <div className="text-[9px] opacity-80">kcal/mol ± {f.ddg_uncertainty_kcalmol.toFixed(2)}</div>
                    </div>
                    <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">ΔΔG / k_B T</div>
                      <div className="text-[14px] text-cyan-300 font-mono">{f.ddg_kT.toFixed(2)}</div>
                      <div className="text-[9px] text-slate-600">k_B T units (298 K)</div>
                    </div>
                    <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider">GPU time</div>
                      <div className="text-[14px] text-cyan-300 font-mono">{(f.gpu_minutes / 60).toFixed(1)}</div>
                      <div className="text-[9px] text-slate-600">GPU-hours</div>
                    </div>
                  </div>

                  <div className={`text-[10px] px-2.5 py-1.5 rounded-md border ${ddgClass}`}>
                    {verdict}
                  </div>

                  <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-1">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Perturbation</div>
                    <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5 text-[10px]">
                      <span className="text-slate-500">Ligand A</span><span className="text-cyan-300 font-mono break-all">{r.ligand_a_smiles}</span>
                      <span className="text-slate-500">Ligand B</span><span className="text-cyan-300 font-mono break-all">{r.ligand_b_smiles}</span>
                      <span className="text-slate-500">Receptor</span><span className="text-cyan-300 font-mono">PDB {r.pdb_id}</span>
                      <span className="text-slate-500">Engine</span><span className="text-cyan-300 font-mono">{f.engine_version}</span>
                      <span className="text-slate-500">Force field</span><span className="text-cyan-300 font-mono">{f.force_field}</span>
                      <span className="text-slate-500">Wallclock</span><span className="text-cyan-300 font-mono">{f.wallclock_minutes.toFixed(1)} min</span>
                      <span className="text-slate-500">RunPod job</span><span className="text-cyan-300 font-mono break-all">{f.runpod_job_id}</span>
                    </div>
                  </div>

                  <details className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                    <summary className="cursor-pointer text-[10px] text-slate-300 hover:text-cyan-300">
                      Per-λ-window breakdown ({f.windows.length} windows)
                    </summary>
                    <table className="w-full text-[10px] mt-2 font-mono">
                      <thead className="text-slate-500 border-b border-white/10">
                        <tr><th className="text-left py-1 px-1">λ</th><th className="text-right py-1 px-1">ΔG (kcal/mol)</th><th className="text-right py-1 px-1">stderr</th></tr>
                      </thead>
                      <tbody className="text-slate-300">
                        {f.windows.map((w, i) => (
                          <tr key={i} className="border-b border-white/5">
                            <td className="py-0.5 px-1">{w.lambda.toFixed(3)}</td>
                            <td className="text-right py-0.5 px-1 text-cyan-300">{w.dG_kcal_mol >= 0 ? "+" : ""}{w.dG_kcal_mol.toFixed(3)}</td>
                            <td className="text-right py-0.5 px-1 text-slate-500">±{w.stderr_kcal_mol.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>

                  {f.warnings.length > 0 && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-2">
                      <div className="text-[10px] text-amber-300 font-semibold mb-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />Worker warnings
                      </div>
                      <ul className="text-[10px] text-amber-200 list-disc list-inside space-y-0.5 leading-relaxed">
                        {f.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => { setOne("s5", undefined); setFepCostOk(false); setFepProgress(""); }}
                    className="text-[10px] text-slate-400 hover:text-cyan-300 underline underline-offset-2"
                  >
                    Reset Stage 5 (run another perturbation)
                  </button>
                </>
              );
            })()}
          </ResultShell>


          {/* Stage 6 — PBPK */}
          {results.s6 && (
            <ResultShell stage={6} name="PBPK projection (2-compartment)" icon={Activity} status={results.s6.status} reason={results.s6.reason}>
              {results.s6.result && (() => {
                const pk = results.s6.result;
                return (
                  <>
                    <div className="grid grid-cols-4 gap-2 text-[11px]">
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">Cmax</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{pk.cmax.toFixed(3)}</div>
                        <div className="text-[9px] text-slate-600">µg/mL</div>
                      </div>
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">Tmax</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{pk.tmax.toFixed(1)}</div>
                        <div className="text-[9px] text-slate-600">h</div>
                      </div>
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">AUC₀₋₄₈</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{pk.auc.toFixed(1)}</div>
                        <div className="text-[9px] text-slate-600">µg·h/mL</div>
                      </div>
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">t½</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{pk.halfLifeHr.toFixed(1)}</div>
                        <div className="text-[9px] text-slate-600">h</div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                      <div className="text-[10px] text-slate-400 mb-1">Plasma concentration vs time (per administration · {pk.model})</div>
                      <MiniLineChart data={pk.pkCurve} xKey="time" yKey="conc" color="#67e8f9" height={90} />
                    </div>
                    <div className="text-[9px] text-slate-500 italic">Vdss {pk.vdss.toFixed(2)} L/kg · CL {pk.clearance.toFixed(3)} L/h/kg · 1-min RK4 ODE solver, 50-h horizon, Davies & Morris physiology.</div>
                  </>
                );
              })()}
            </ResultShell>
          )}

          {/* Stage 7 — PD */}
          {results.s7 && (
            <ResultShell stage={7} name="QSP / PD coupling" icon={Activity} status={results.s7.status} reason={results.s7.reason}>
              {results.s7.result && (() => {
                const r = results.s7.result;
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">Peak occupancy</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{r.peakOccupancyPct.toFixed(0)}%</div>
                      </div>
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">Time &gt;50%</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{r.timeAbove50pctH.toFixed(1)}h</div>
                      </div>
                      <div className="rounded border border-white/8 bg-white/[0.02] p-2 text-center">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider">AUC effect</div>
                        <div className="text-[13px] text-cyan-300 font-mono">{r.AUC_effectH.toFixed(1)}h</div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-2">
                      <div className="text-[10px] text-slate-400 mb-1">Receptor occupancy vs time (Hill slope {r.hillCoeff}, Ki={r.ki_nM.toFixed(1)} nM)</div>
                      <MiniLineChart data={r.pkPdCurve} xKey="time" yKey="occupancy_pct" color="#a78bfa" height={90} />
                    </div>
                    <div className="text-[10px] text-slate-300">{r.rationale}</div>
                  </>
                );
              })()}
            </ResultShell>
          )}

          {/* Stage 8 — TI ranking (existing) */}
          {results.s8 && results.s8.result && (() => {
            const proj: L2DoseProjection = results.s8.result;
            return (
              <ResultShell stage={8} name="Therapeutic-index ranking" icon={CheckCircle2} status={results.s8.status}>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${verdictColor(proj.verdict)}`}>
                    {proj.verdict}
                  </span>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    <div className="text-[11px] font-semibold text-slate-200">Receptor-occupancy target</div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <div className="text-slate-500">Target occupancy</div><div className="text-cyan-300 font-mono text-right">{fmt(proj.targetOccupancy * 100, 0, "%")}</div>
                    <div className="text-slate-500">L1 Ki</div><div className="text-cyan-300 font-mono text-right">{fmt(proj.ki_nM, 2, " nM")}</div>
                    <div className="text-slate-500">Required Cmax,unbound</div><div className="text-cyan-300 font-mono text-right">{fmt(proj.targetCmaxUnbound_nM, 2, " nM")}</div>
                    <div className="text-slate-500">Plasma fu</div><div className="text-cyan-300 font-mono text-right">{fmt(proj.fu_fraction * 100, 2, "%")}</div>
                    <div className="text-slate-500">Required Cmax,total</div><div className="text-cyan-300 font-mono text-right">{fmt(proj.targetCmaxTotal_nM, 2, " nM")}</div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="w-3.5 h-3.5 text-cyan-400" />
                    <div className="text-[11px] font-semibold text-slate-200">Therapeutic-index margins</div>
                    <span className="text-[9px] text-slate-600 ml-auto">SAFE ≥30× · CAUTION 10–30× · RISK &lt;10×</span>
                  </div>
                  <div className="space-y-2">
                    {proj.margins.map(m => <MarginBar key={m.label} row={m} />)}
                  </div>
                </div>
                <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Beaker className="w-3.5 h-3.5 text-cyan-400" />
                    <div className="text-[11px] font-semibold text-slate-200">First-pass human dose projection</div>
                    <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/8 text-amber-300">Confidence: low</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <div className="text-slate-500">Estimated Vd</div><div className="text-cyan-300 font-mono text-right">{fmt(proj.Vd_L_per_kg, 2, " L/kg")}</div>
                    <div className="text-slate-500">Estimated F</div><div className="text-cyan-300 font-mono text-right">{fmt(proj.F_oral * 100, 0, "%")}</div>
                    <div className="text-slate-500">Estimated hepatic CL</div><div className="text-cyan-300 font-mono text-right">{proj.hepaticCL_mL_min_kg !== null ? fmt(proj.hepaticCL_mL_min_kg, 1, " mL/min/kg") : "—"}</div>
                    <div className="text-slate-500">Predicted dose (mg/kg/day)</div><div className="text-cyan-300 font-mono text-right">{fmt(proj.predictedDose_mg_per_kg, 3)}</div>
                    <div className="text-slate-300 font-semibold">Predicted dose (mg/day)</div><div className="text-cyan-200 font-mono text-right font-semibold">{fmt(proj.predictedDose_mg_per_day, 1)}</div>
                  </div>
                  <details className="text-[9px] text-slate-500 leading-relaxed mt-1">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-300">Assumptions used</summary>
                    <ul className="list-disc list-inside mt-1 space-y-0.5 italic">
                      <li>{proj.Vd_assumption}</li>
                      <li>{proj.F_assumption}</li>
                      <li>{proj.CL_assumption}</li>
                      <li>{proj.doseAssumption}</li>
                    </ul>
                  </details>
                </div>
                <div className={`rounded-lg border p-3 ${verdictColor(proj.verdict)}`}>
                  <div className="text-[11px] font-semibold mb-1.5">Verdict — {proj.verdict}</div>
                  <ul className="text-[10px] list-disc list-inside space-y-0.5 leading-relaxed">
                    {proj.rationale.map((r, i) => <li key={`r${i}`}>{r}</li>)}
                  </ul>
                  {proj.warnings.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10">
                      <div className="text-[10px] font-semibold mb-1">L1 carry-forward warnings</div>
                      <ul className="text-[10px] list-disc list-inside space-y-0.5 leading-relaxed">
                        {proj.warnings.map((w, i) => <li key={`w${i}`}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="text-[9px] text-slate-600 italic leading-relaxed">
                  {proj.confidenceNote} Generated {new Date(proj.generatedAt).toLocaleTimeString()} from L1 stamp {new Date(proj.l1Stamp).toLocaleTimeString()}.
                </div>
              </ResultShell>
            );
          })()}

          {/* Stage 9 — Handoff JSON */}
          {results.s9 && results.s9.result && (
            <ResultShell stage={9} name="Output / handoff JSON" icon={ArrowRight} status={results.s9.status}>
              <div className="rounded-lg border border-white/8 bg-black/30 p-3 relative">
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(JSON.stringify(results.s9!.result, null, 2))}
                  className="absolute top-2 right-2 text-[9px] text-slate-400 hover:text-cyan-300 flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/10 bg-white/5"
                  title="Copy JSON to clipboard"
                ><Copy className="w-3 h-3" />Copy</button>
                <pre className="text-[10px] text-slate-300 font-mono overflow-x-auto whitespace-pre">
{JSON.stringify(results.s9.result, null, 2)}
                </pre>
              </div>
              <div className="text-[10px] text-slate-500 italic">Schema <span className="font-mono text-slate-400">L2-handoff-v1</span> — what the Ex-Vivo sub-track would receive when wired.</div>
            </ResultShell>
          )}

          {/* L1 → L2 input contract */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-violet-400" />
              <h3 className="text-[13px] font-semibold text-white">L1 → L2 Input Contract</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Per compound, L1 hands L2 a record keyed on InChIKey (architecture doc §4.3 Stage 0):
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                ["Canonical SMILES + InChIKey", "Identity"],
                ["Primary-target Ki / IC50 + assay provenance", "Potency"],
                ["ADMET panel (CYP, microsomal, PPB, sol, perm)", "ADMET"],
                ["hERG IC50", "Cardiac"],
                ["Selectivity panel hits", "Off-target"],
                ["Cytotoxicity (where measured)", "Tox"],
                ["Cellosaurus CVCL accession + replicate count", "Provenance"],
                ["Statistical confidence", "QC"],
              ].map(([field, kind]) => (
                <div key={field} className="flex items-center justify-between gap-3 border-b border-white/5 py-1">
                  <span className="text-slate-300">{field}</span>
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider">{kind}</span>
                </div>
              ))}
            </div>
          </div>

          {/* L2 In-Silico → L2 Ex-Vivo sub-track output contract */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-amber-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 In-Silico → Ex-Vivo Output Contract</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              When wired, the in-silico sub-track hands the ex-vivo sub-track a ranked shortlist (architecture doc §4 — no specific shortlist size or cost estimate is asserted), each carrying:
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                "Predicted human dose range",
                "Predicted unbound Cmax + AUC at each candidate dose",
                "PoseBusters-cleared docking poses",
                "Free-energy estimates (where computed)",
                "Off-target liability flags",
                "Predicted IVIVE-derived clearance",
                "Confidence + uncertainty estimates per prediction",
                "Ranking rationale",
              ].map(field => (
                <div key={field} className="flex items-center gap-2 border-b border-white/5 py-1">
                  <Database className="w-3 h-3 text-slate-600 shrink-0" />
                  <span className="text-slate-300">{field}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Continue */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onContinue}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[12px] font-semibold transition-colors"
            >
              <Microscope className="w-4 h-4" />
              Reviewed L2 In-Silico — switch to Ex-Vivo sub-track
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}
