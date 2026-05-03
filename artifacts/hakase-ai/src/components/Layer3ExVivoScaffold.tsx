import { useState, useMemo } from "react";
import {
  Microscope, ArrowRight, Database, Shield, Sparkles, AlertCircle, AlertTriangle,
  CircleDot, Play, Activity, Loader2, Copy, Check, Sliders, ChevronDown, ChevronRight,
  FlaskConical, ServerCrash, FileText, Atom, Beaker,
} from "lucide-react";
import type { SimResults } from "@/lib/admet";
import type { InVitroResults } from "@/lib/inVitroSim";
import type { L2InputParams } from "@/lib/l2DoseProjection";
import {
  computeTissueSelectivityMatrix,
  type TissueSelectivityMatrix,
  type TissueSelectivityRow,
} from "@/lib/tissueSelectivity";
import {
  predictTransporterFlags,
  TRANSPORTER_LABELS,
  type TransporterFlagsResult,
  type TransporterChannel,
} from "@/lib/transporterFlags";

interface Layer3ExVivoScaffoldProps {
  layer2Ready: boolean;
  simResults: SimResults | null;
  inVitroResults: InVitroResults | null;
  onContinue: () => void;
}

/* ─── Stage definitions (per Spec v1.1 §3 + §10 + Appendix B) ─────────────── */

type WiredKind = "in-house" | "ml-service" | "external-data" | "out-of-scope-yet";

type StageStatus = "ready" | "running" | "complete" | "error" | "out-of-scope-yet";

type StageDef = {
  n: number;
  name: string;
  detail: string;
  wired: WiredKind;
  engines: { name: string; note: string }[];
  /** When wired = "out-of-scope-yet": short reason shown on the disabled Run button. */
  pendingReason?: string;
};

const L3_STAGES: StageDef[] = [
  {
    n: 1, name: "Tissue selectivity + transporter flags", wired: "in-house",
    detail: "Per-tissue exposure margin (54 GTEx organs) using L1 IC50 ÷ predicted Cu (fu × L2 PBPK Cmax) weighted by GTEx target expression. 9-channel transporter substrate / inhibitor QSAR on L1 ADMET descriptors.",
    engines: [
      { name: "lib/tissueSelectivity.ts (in-house)", note: "54-row matrix; PBPK-compartment map for liver/kidney/brain/heart/adipose/gut/muscle/lung" },
      { name: "GTEx Portal v2 REST",                  note: "v8 dataset (v10 not yet at medianGeneExpression endpoint)" },
      { name: "lib/transporterFlags.ts (QSAR)",       note: "BSEP, OAT1/3, OCT2, OATP1B1/3, P-gp, BCRP, MRP2 — Polli/Morgan/Karlgren/Truong/Wittwer/Matsson/El-Sheikh" },
    ],
  },
  {
    n: 2, name: "DILI severity + mechanism classifier", wired: "out-of-scope-yet",
    detail: "Gradient-boosted ensemble on Morgan FP (radius 2, 2048 bits) + L1 ADMET vector + L2 hepatic Cu + transporter flags. Targets: 3-class severity + 4-channel mechanism (mitochondrial / BSEP / ROS / immune). Calibrated probabilities via temperature scaling.",
    engines: [
      { name: "ai-service /predict/dili-ml", note: "LightGBM/XGBoost — TO BUILD (not yet wired in ai-service)" },
      { name: "DILIrank (FDA) + LTKB",        note: "~700 adjudicated compounds — bulk-download to Parquet" },
      { name: "QMRF + V&V40 reports",         note: "OECD QSAR five validation principles + FDA 2024 AI draft guidance" },
    ],
    pendingReason: "Stage 2 not wired — dili-ml service + DILIrank training pipeline pending (spec §7.1, ETA 5–7 d).",
  },
  {
    n: 3, name: "Cell-type aggregation (Drug2cell + Tabula Sapiens)", wired: "out-of-scope-yet",
    detail: "Per cell type in Tabula Sapiens v2 (~480 across 28 organs): score = target_gene_expression × predicted drug affinity. Aggregated to organoid IC50 prediction via published organoid-composition fractions and Hill fit.",
    engines: [
      { name: "drug2cell (Teichmann lab, MIT)", note: "pip install — pin Tabula Sapiens v2 by SHA" },
      { name: "Tabula Sapiens v2 (CELLxGENE)",  note: "bulk-download to local Parquet for v1 (Census API later)" },
      { name: "lib/cellTypeAggregator.ts",      note: "TO BUILD — wraps drug2cell output with organoid-composition map" },
    ],
    pendingReason: "Stage 3 not wired — Drug2cell sidecar + Tabula Sapiens v2 bulk ingest pending (spec §3.2, ETA 7–10 d).",
  },
  {
    n: 4, name: "Patient-line projection (oncology only)", wired: "out-of-scope-yet",
    detail: "Predicted IC50 distribution across patient-line genomics from HCMI catalogue + DepMap PRISM cell-line response, conditioned on indication + target gene.",
    engines: [
      { name: "lib/patientLineProjection.ts",   note: "TO BUILD — null when out-of-domain (non-oncology)" },
      { name: "HCMI (NCI / ATCC)",              note: "~700 next-gen cancer models with paired matched-normal genomics" },
      { name: "DepMap PRISM",                   note: "6,000 cmpds × 2,000 cell lines IC50 — labelled-proxy with explicit '2D not organoid' tag" },
    ],
    pendingReason: "Stage 4 not wired — HCMI + DepMap snapshots pending DVC ingest (spec §3.5, ETA 5–7 d, oncology only).",
  },
  {
    n: 5, name: "DILI biomarker proxy + permeability surfacing", wired: "out-of-scope-yet",
    detail: "Rule-based mapping from Stage 2 mechanism flags to expected biomarker pattern (mito → GLDH; cholestatic → ALP; hepatocellular → ALT, miR-122; immune → eosinophilia priors). Permeability + brain Kp,uu surfaced from L1 Caco-2 + L2 PBPK gut + brain compartments.",
    engines: [
      { name: "lib/biomarkerProxy.ts",          note: "TO BUILD — deterministic mapping table" },
      { name: "lib/permeabilityProjection.ts",  note: "TO BUILD — wraps L1 Caco-2 + L2 gut/brain Cu" },
    ],
    pendingReason: "Stage 5 depends on Stage 2 (DILI mechanism flags) and the L2 PBPK gut + brain compartments (spec §3.6 + §3.7, ETA 3 d after Stage 2).",
  },
  {
    n: 6, name: "Cascade integration tests + L3→L4 envelope", wired: "out-of-scope-yet",
    detail: "End-to-end integration tests across all wired stages. Per-readout `tier` field, per-readout CascadeFlagState, applicability-domain score, fold-error band (cohortN=0 until calibration). Mixed-tier envelopes are normal.",
    engines: [
      { name: "lib/exVivoSurrogate.ts",         note: "TO BUILD — top-level orchestrator with per-readout ReadoutBlock<V> envelope" },
      { name: "L3→L4 envelope tests",           note: "round-trip cascade integrity, Amber-Curator load-bearing predicate" },
    ],
    pendingReason: "Stage 6 depends on Stages 1–5 (spec §10.6 / Appendix B, ETA 2–3 d after Stage 5).",
  },
];

/* ─── L3 input parameter shape (extends L2 + L3-specific knobs) ─────────────── */

interface L3InputParams {
  /** L2 chain params — target occupancy, BW, route, dosing freq, fu/Vd/F/CL overrides. */
  l2: L2InputParams;
  /** Bypass L1 primaryIC50 (nM). Empty/undefined = use L1. */
  ic50_nM_override?: number;
  /** Floor for surfacing transporter flags. 0 surfaces all; 0.5 hides low-confidence calls. */
  transporterConfidenceFloor: number;
}

const L3_DEFAULT_PARAMS: L3InputParams = {
  l2: { targetOccupancy: 0.75, bodyWeightKg: 70, route: "oral", dosesPerDay: 1 },
  transporterConfidenceFloor: 0,
};

/* ─── Reference content (preserved verbatim from prior scaffold) ─────────── */

const L3_MODALITIES = [
  {
    name: "Precision-cut tissue slices (PCLS)",
    summary: "Lung, liver, kidney, brain — preserves architecture + multi-cell-type context.",
    sources: [
      { name: "EU-ToxRisk / ONTOX", note: "Horizon Europe NAM datasets through 2027" },
      { name: "Tox21 / NCATS",     note: "qHTS pre-screen — ~10K cmpds × ~70 assays" },
    ],
  },
  {
    name: "Isolated perfused organs",
    summary: "Langendorff heart, isolated perfused liver / kidney — full-organ pharmacology.",
    sources: [
      { name: "Internal / academic protocols", note: "no public packaged dataset of meaningful size" },
    ],
  },
  {
    name: "Patient-derived organoids",
    summary: "Tumour + non-tumour 3D cultures with patient genomics + clinical metadata.",
    sources: [
      { name: "HCMI (NCI / ATCC)",          note: "~700 next-gen cancer models with paired matched-normal genomics" },
      { name: "Hubrecht HUB Organoid Biobank", note: "largest non-cancer + cancer biobank globally; HUB Foundation MTA, commercial sublicensing required" },
      { name: "hPSCreg",                     note: "~7,500 hiPSC/hESC lines with provenance, ethics, QC" },
      { name: "ATCC organoid lines",         note: "Commercial MTA (~$2–6k / line — only concrete cost asserted by the doc)" },
      { name: "Cellosaurus (organoid records)", note: "~5K entries, CC-BY 4.0 — every L3 row should carry a CVCL accession" },
    ],
  },
  {
    name: "Microphysiological systems / organ-on-chip",
    summary: "Multi-tissue chips with media flow + mechanical cues. Public footprint is qualification papers; T3 vendor adapters are opt-in upgrades per surrogate spec.",
    sources: [
      { name: "Emulate (Liver-/Brain-/Intestine-/Lung-Chip S1)", note: "Liver-Chip qualification, Ewart 2022: 87% sensitivity vs Tox21" },
      { name: "CN Bio (PhysioMimix OOC)",                       note: "strong on liver clearance + first-pass metabolism" },
      { name: "Mimetas (OrganoPlate 3-lane / Graft)",            note: "higher throughput (96-well), tubule + BBB models" },
      { name: "TissUse (HUMIMIC Chip2 / Chip4 / ChipX)",         note: "multi-organ co-culture, ADME-T focused" },
      { name: "InSphero (Akura Flow / 96-well 3D)",              note: "scaffold-free spheroids, high-throughput hepatotox" },
      { name: "MPS-Database (FDA / U. Pittsburgh DILI consortium)", note: "T1 retrieval target; only public MPS dataset of meaningful size" },
    ],
  },
] as const;

/* ─── Reusable bits (visual mirror of L2 scaffold) ────────────────────────── */

function wiredBadge(w: WiredKind): { text: string; cls: string } {
  switch (w) {
    case "in-house":
      return { text: "in-house", cls: "border-emerald-500/30 bg-emerald-500/8 text-emerald-300" };
    case "ml-service":
      return { text: "ai-service", cls: "border-violet-500/30 bg-violet-500/8 text-violet-300" };
    case "external-data":
      return { text: "external data", cls: "border-cyan-500/30 bg-cyan-500/8 text-cyan-300" };
    case "out-of-scope-yet":
      return { text: "not wired yet", cls: "border-amber-500/30 bg-amber-500/8 text-amber-300" };
  }
}

function statusBadgeClass(s: StageStatus): string {
  switch (s) {
    case "complete": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "running":  return "border-violet-500/40 bg-violet-500/10 text-violet-300";
    case "error":    return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    case "out-of-scope-yet": return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "ready":    return "border-white/10 bg-white/[0.02] text-slate-400";
  }
}

function L1OutputRow({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5">
      <div className="flex flex-col">
        <span className="text-[11px] text-slate-300">{label}</span>
        {source && <span className="text-[9px] text-slate-600 uppercase tracking-wider">{source}</span>}
      </div>
      <span className={value === "—" ? "text-slate-600 text-[11px] font-mono" : "text-amber-300 text-[11px] font-mono"}>{value}</span>
    </div>
  );
}

function StageCard({
  stage, status, busy, hasResult, onRun, runDisabled, runDisabledReason,
}: {
  stage: StageDef;
  status: StageStatus;
  busy: boolean;
  hasResult: boolean;
  onRun: () => void;
  runDisabled: boolean;
  runDisabledReason?: string;
}) {
  const wb = wiredBadge(stage.wired);
  const canRun = stage.wired !== "out-of-scope-yet";
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-6 h-6 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[11px] font-semibold flex items-center justify-center shrink-0">
          {stage.n}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[12px] font-semibold text-white">Stage {stage.n} — {stage.name}</div>
            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${wb.cls}`}>{wb.text}</span>
            {hasResult && (
              <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${statusBadgeClass(status)}`}>{status}</span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{stage.detail}</div>
        </div>
      </div>
      <div className="pl-8 space-y-1">
        {stage.engines.map(e => (
          <div key={e.name} className="flex items-baseline gap-2 text-[10px]">
            <CircleDot className="w-2 h-2 text-slate-600 shrink-0 translate-y-0.5" />
            <span className="text-slate-300 font-medium">{e.name}</span>
            {e.note && <span className="text-slate-500">— {e.note}</span>}
          </div>
        ))}
      </div>
      <div className="pl-8 mt-2.5 flex items-center gap-2">
        {canRun ? (
          <button
            type="button"
            disabled={runDisabled || busy}
            onClick={onRun}
            title={runDisabled ? runDisabledReason : `Run Stage ${stage.n}`}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors ${
              !runDisabled && !busy
                ? "bg-amber-600/30 hover:bg-amber-500/40 text-amber-200 border border-amber-500/40 cursor-pointer"
                : "bg-slate-700/30 border border-slate-600/30 text-slate-500 cursor-not-allowed"
            }`}
          >
            {busy
              ? <><Loader2 className="w-3 h-3 animate-spin" />Running…</>
              : <><Play className="w-3 h-3" />Run stage</>}
          </button>
        ) : (
          <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/8 text-amber-300/80 italic">
            Stub · honest absence
          </span>
        )}
        {runDisabled && runDisabledReason && (
          <span className="text-[9px] text-slate-500 italic">{runDisabledReason}</span>
        )}
        {!canRun && stage.pendingReason && (
          <span className="text-[9px] text-slate-500 italic">{stage.pendingReason}</span>
        )}
      </div>
    </div>
  );
}

function ResultShell({ stage, name, icon: Icon, status, reason, children }: {
  stage: number; name: string; icon: any;
  status: StageStatus; reason?: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-amber-300" />
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

/* ─── L3 input parameters card (mirrors L2) ──────────────────────────────── */

function L3InputParamsCard({
  params, setParams, simResults,
}: { params: L3InputParams; setParams: (p: L3InputParams) => void; simResults: SimResults | null }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const occ = params.l2.targetOccupancy ?? 0.75;
  const bw  = params.l2.bodyWeightKg ?? 70;
  const route = params.l2.route ?? "oral";
  const dpd = params.l2.dosesPerDay ?? 1;
  const tcf = params.transporterConfidenceFloor;
  const ic50_nM = simResults?.binding.primaryIC50;
  return (
    <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Sliders className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[11px] font-semibold text-slate-200 uppercase tracking-widest">L3 Input Parameters</span>
        <span className="ml-auto text-[9px] text-slate-500 italic">applied to Stage 1 (L2 chain auto-rerun)</span>
      </div>

      {/* Occupancy slider — reused from L2 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-300">Target receptor occupancy (drives L2 dose → L3 Cu)</span>
          <span className="text-amber-300 font-mono">{(occ * 100).toFixed(0)}% (Cmax,u = {(occ / Math.max(1e-3, 1 - occ)).toFixed(2)}× Ki)</span>
        </div>
        <input
          type="range" min={0.5} max={0.95} step={0.05} value={occ}
          onChange={e => setParams({ ...params, l2: { ...params.l2, targetOccupancy: parseFloat(e.target.value) } })}
          className="w-full accent-amber-400"
        />
        <div className="flex justify-between text-[9px] text-slate-600">
          <span>50% (1×Ki)</span><span>75% (3×Ki)</span><span>95% (19×Ki)</span>
        </div>
      </div>

      {/* BW + Route + Freq */}
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Body weight (kg)</span>
          <input
            type="number" min={1} max={250} step={1} value={bw}
            onChange={e => setParams({ ...params, l2: { ...params.l2, bodyWeightKg: parseFloat(e.target.value) } })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-amber-200 font-mono focus:outline-none focus:border-amber-500/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Route</span>
          <select
            value={route}
            onChange={e => setParams({ ...params, l2: { ...params.l2, route: e.target.value as "oral" | "iv" } })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-amber-200 focus:outline-none focus:border-amber-500/50"
          >
            <option value="oral">Oral (PO)</option>
            <option value="iv">IV (F=1)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Dosing freq.</span>
          <select
            value={dpd}
            onChange={e => setParams({ ...params, l2: { ...params.l2, dosesPerDay: parseInt(e.target.value, 10) } })}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-amber-200 focus:outline-none focus:border-amber-500/50"
          >
            <option value={1}>QD (1×)</option>
            <option value={2}>BID (2×)</option>
            <option value={3}>TID (3×)</option>
            <option value={4}>QID (4×)</option>
          </select>
        </label>
      </div>

      {/* L3-specific row: transporter floor + GTEx dataset (display-only) */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Transporter conf. floor</span>
          <div className="flex items-center gap-2">
            <input
              type="range" min={0} max={0.9} step={0.05} value={tcf}
              onChange={e => setParams({ ...params, transporterConfidenceFloor: parseFloat(e.target.value) })}
              className="flex-1 accent-amber-400"
            />
            <span className="text-amber-300 font-mono text-[11px] w-10 text-right">{tcf.toFixed(2)}</span>
          </div>
          <span className="text-[9px] text-slate-600 italic">flags below this confidence are suppressed (still computed)</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">GTEx dataset</span>
          <input
            type="text" value="gtex_v8 (v10 not yet on REST endpoint)" readOnly
            className="bg-white/[0.02] border border-white/10 rounded-md px-2 py-1 text-[11px] text-slate-400 font-mono italic cursor-not-allowed"
          />
        </label>
      </div>

      {/* Advanced overrides */}
      <button
        type="button"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="text-[10px] text-slate-400 hover:text-slate-300 flex items-center gap-1"
      >
        {advancedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced overrides (bypass L1 / L2 — clear to revert)
      </button>
      {advancedOpen && (
        <div className="grid grid-cols-2 gap-3 pt-1">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">IC50 (nM) — bypass L1</span>
            <input
              type="number" min={0} step="any"
              value={params.ic50_nM_override ?? ""}
              placeholder={ic50_nM ? `L1: ${ic50_nM.toFixed(1)} nM` : "use L1 IC50"}
              onChange={e => {
                const v = e.target.value;
                setParams({ ...params, ic50_nM_override: v === "" ? undefined : parseFloat(v) });
              }}
              className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-amber-200 font-mono placeholder:text-slate-600 placeholder:text-[10px] placeholder:italic focus:outline-none focus:border-amber-500/50"
            />
          </label>
          {[
            { k: "fuOverride" as const, label: "fu (0–1)",         hint: "L1 plasma protein binding" },
            { k: "VdOverride" as const, label: "Vd (L/kg)",        hint: "logP-binned proxy" },
            { k: "FOverride"  as const, label: "F oral (0–1)",     hint: "Caco-2 → F bins (Yee 1997)" },
            { k: "CLOverride" as const, label: "CL (mL/min/kg)",   hint: "well-stirred liver model" },
          ].map(({ k, label, hint }) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">{label} (L2)</span>
              <input
                type="number" min={0} step="any"
                value={params.l2[k] ?? ""}
                placeholder={`use ${hint}`}
                onChange={e => {
                  const v = e.target.value;
                  setParams({ ...params, l2: { ...params.l2, [k]: v === "" ? undefined : parseFloat(v) } });
                }}
                className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-amber-200 font-mono placeholder:text-slate-600 placeholder:text-[10px] placeholder:italic focus:outline-none focus:border-amber-500/50"
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─── Stage-1 result rendering (tissue selectivity + transporter cards) ──── */

function ConfidencePill({ c }: { c: "high" | "medium" | "low" }) {
  const styles = c === "high"
    ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300"
    : c === "medium"
    ? "border-amber-500/30 bg-amber-500/8 text-amber-300"
    : "border-rose-500/30 bg-rose-500/8 text-rose-300";
  return <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${styles}`}>{c}</span>;
}

function MarginCell({ ratio }: { ratio: number }) {
  const isSafe = ratio >= 30;
  const isCaution = ratio >= 10 && ratio < 30;
  const cls = isSafe ? "text-emerald-300" : isCaution ? "text-amber-300" : "text-rose-300";
  return <span className={`font-mono ${cls}`}>{ratio < 0.01 ? ratio.toExponential(1) : ratio.toFixed(2)}×</span>;
}

function CascadeBlock({ matrix }: { matrix: TissueSelectivityMatrix }) {
  const s = matrix.cascadeState;
  if (s.kind !== "prediction_only") return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <div className="text-[11px] font-semibold text-amber-300">Cascade flag · prediction_only</div>
      </div>
      <p className="text-[10px] text-slate-300 leading-relaxed">{s.uiBanner}</p>
      <div className="text-[10px] text-slate-400 grid grid-cols-2 gap-x-4 gap-y-0.5">
        <div><span className="text-slate-500">Method:</span> {s.method}</div>
        <div><span className="text-slate-500">Applicability:</span> {s.applicabilityDomain.inDomain ? "in domain" : "out of domain"} (score {s.applicabilityDomain.score.toFixed(2)})</div>
        <div className="col-span-2">
          <span className="text-slate-500">Fold-error band:</span>{" "}
          {s.foldError.cohortN > 0
            ? `median ${s.foldError.median.toFixed(2)}× / p90 ${s.foldError.p90.toFixed(2)}× (n=${s.foldError.cohortN})`
            : "not yet measured (calibration cohort pending — ≥30 wet pairs)"}
        </div>
      </div>
    </div>
  );
}

function TissueMatrixBlock({ matrix }: { matrix: TissueSelectivityMatrix }) {
  const [showAll, setShowAll] = useState(false);
  const sortedRows = [...matrix.rows].sort((a, b) => b.onTargetScore - a.onTargetScore);
  const visible = showAll ? sortedRows : sortedRows.slice(0, 12);
  return (
    <div className="space-y-3">
      <div className="text-[10px] text-slate-400 leading-relaxed space-y-1">
        <div>
          <span className="text-slate-500">Provenance:</span>{" "}
          gene <span className="text-amber-300">{matrix.geneSymbol}</span> ·{" "}
          dataset <span className="text-amber-300">{matrix.gtexDatasetId}</span> ·{" "}
          IC50 <span className="text-amber-300">{matrix.ic50_uM.toFixed(4)} µM</span> ·{" "}
          Cu_plasma <span className="text-amber-300">{matrix.Cu_plasma_uM.toFixed(4)} µM</span> ·{" "}
          Cmax_total <span className="text-amber-300">{matrix.cmax_total_uM.toFixed(3)} µM</span>
        </div>
        <div className="text-amber-300/90">
          ⚠ Cu_tissue ≈ Cu_plasma assumed (Rowland-Tözer steady-state). Per-organ PBPK
          compartments not yet wired — confidence column reflects this.
        </div>
      </div>
      <div className="rounded-lg border border-white/8 bg-black/30 overflow-hidden">
        <div className="grid grid-cols-[1fr_70px_70px_70px_70px_56px] text-[10px] uppercase tracking-wider text-slate-500 px-2.5 py-1.5 border-b border-white/8 bg-white/[0.02]">
          <div>Tissue</div>
          <div className="text-right">TPM</div>
          <div className="text-right">Cu (µM)</div>
          <div className="text-right">Margin</div>
          <div className="text-right">On-target</div>
          <div className="text-center">Conf</div>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {visible.map(r => (
            <div
              key={r.tissueId}
              className="grid grid-cols-[1fr_70px_70px_70px_70px_56px] items-center px-2.5 py-1.5 text-[11px] border-b border-white/5 last:border-b-0 hover:bg-white/[0.02]"
              title={r.rationale}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-slate-200 truncate">{r.tissueName}</span>
                {r.pbpkCompartment && (
                  <span className="text-[8px] uppercase text-emerald-400/70 shrink-0">PBPK</span>
                )}
              </div>
              <div className="text-right font-mono text-slate-300">{r.targetExpressionTpm.toFixed(2)}</div>
              <div className="text-right font-mono text-slate-400">{r.predictedCu_uM.toExponential(1)}</div>
              <div className="text-right"><MarginCell ratio={r.marginRatio} /></div>
              <div className="text-right font-mono text-amber-300">{r.onTargetScore.toFixed(3)}</div>
              <div className="flex justify-center"><ConfidencePill c={r.confidence} /></div>
            </div>
          ))}
        </div>
      </div>
      {sortedRows.length > 12 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="w-full text-center text-[10px] text-slate-400 hover:text-amber-300 py-1"
        >
          {showAll ? "Collapse" : `Show all ${sortedRows.length} tissues`}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2">
          <div className="text-amber-300 uppercase tracking-wider font-semibold mb-1">Top on-target tissues</div>
          {matrix.topOnTargetTissues.map((r: TissueSelectivityRow) => (
            <div key={r.tissueId} className="flex justify-between text-slate-300">
              <span>{r.tissueName}</span>
              <span className="font-mono">{r.onTargetScore.toFixed(3)}</span>
            </div>
          ))}
        </div>
        <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-2">
          <div className="text-rose-300 uppercase tracking-wider font-semibold mb-1">Tightest safety margins</div>
          {matrix.highestRiskMarginTissues.map((r: TissueSelectivityRow) => (
            <div key={r.tissueId} className="flex justify-between text-slate-300">
              <span>{r.tissueName}</span>
              <span className="font-mono"><MarginCell ratio={r.marginRatio} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TransporterFlagsBlock({ flags, floor }: { flags: TransporterFlagsResult; floor: number }) {
  const channels = Object.keys(TRANSPORTER_LABELS) as TransporterChannel[];
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-400">
        QSAR · {flags.qsarVersion} · descriptors MW {flags.inputs.mw.toFixed(1)} ·
        logP {flags.inputs.logP.toFixed(2)} · TPSA {flags.inputs.tpsa.toFixed(1)} ·
        HBD {flags.inputs.hbd} · HBA {flags.inputs.hba}
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {channels.map(ch => {
          const f = flags[ch];
          const meta = TRANSPORTER_LABELS[ch];
          const suppressed = f.confidence < floor;
          return (
            <div
              key={ch}
              className={`rounded-md border p-2 ${suppressed ? "border-white/5 bg-white/[0.01] opacity-50" : "border-white/8 bg-black/30"}`}
              title={f.rationale}
            >
              <div className="flex items-center justify-between mb-1">
                <div>
                  <div className="text-[11px] font-semibold text-white">{meta.label}</div>
                  <div className="text-[9px] text-slate-500">{meta.site}</div>
                </div>
                <div className="flex gap-1.5">
                  {suppressed
                    ? <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-white/10 bg-white/[0.02] text-slate-500">below conf. floor</span>
                    : <>
                        {f.substrate && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">substrate</span>
                        )}
                        {f.inhibitor && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-300">inhibitor</span>
                        )}
                        {!f.substrate && !f.inhibitor && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-white/10 bg-white/[0.02] text-slate-500">no flag</span>
                        )}
                      </>}
                  <span className="text-[9px] font-mono text-slate-400">conf {f.confidence.toFixed(2)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main scaffold ────────────────────────────────────────────────────────── */

interface Stage1Result {
  matrix: TissueSelectivityMatrix;
  transporters: TransporterFlagsResult;
}

type StageResultBlock<V> =
  | { status: "running" }
  | { status: "complete"; result: V }
  | { status: "error"; reason: string }
  | { status: "out-of-scope-yet"; reason: string };

interface PipelineResults {
  s1?: StageResultBlock<Stage1Result>;
  s2?: StageResultBlock<never>;
  s3?: StageResultBlock<never>;
  s4?: StageResultBlock<never>;
  s5?: StageResultBlock<never>;
  s6?: StageResultBlock<never>;
}

export function Layer3ExVivoScaffold({
  layer2Ready,
  simResults,
  inVitroResults,
  onContinue,
}: Layer3ExVivoScaffoldProps) {
  const hasL1 = !!simResults && !!inVitroResults;
  const [params, setParams] = useState<L3InputParams>(L3_DEFAULT_PARAMS);
  const [results, setResults] = useState<PipelineResults>({});
  const [busyStage, setBusyStage] = useState<number | null>(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const wiredCount = useMemo(() => L3_STAGES.filter(s => s.wired !== "out-of-scope-yet").length, []);

  const setOne = <K extends keyof PipelineResults>(key: K, value: PipelineResults[K]) => {
    setResults(prev => ({ ...prev, [key]: value }));
  };

  /** Stage 1 runner — tissue selectivity + transporter flags. */
  const runStage1 = async () => {
    if (!simResults || !inVitroResults) return;
    setBusyStage(1);
    setOne("s1", { status: "running" });
    try {
      const transporters = predictTransporterFlags(simResults.lipinski);
      // Apply IC50 override by temporarily mutating a shallow copy of simResults.
      const simForRun = params.ic50_nM_override !== undefined && isFinite(params.ic50_nM_override) && params.ic50_nM_override > 0
        ? { ...simResults, binding: { ...simResults.binding, primaryIC50: params.ic50_nM_override } }
        : simResults;
      const matrix = await computeTissueSelectivityMatrix({
        sim: simForRun,
        iv: inVitroResults,
        l2Params: params.l2,
      });
      setOne("s1", { status: "complete", result: { matrix, transporters } });
    } catch (err: any) {
      setOne("s1", { status: "error", reason: err?.message ?? String(err) });
    } finally {
      setBusyStage(null);
    }
  };

  const runStageHandler = async (n: number) => {
    if (n === 1) return runStage1();
    // Stages 2–6 are honest stubs — do not invent results.
    const def = L3_STAGES.find(s => s.n === n);
    setOne((`s${n}` as keyof PipelineResults), {
      status: "out-of-scope-yet",
      reason: def?.pendingReason ?? "Stage not yet wired.",
    });
  };

  const runFull = async () => {
    if (!simResults || !inVitroResults) return;
    setPipelineRunning(true);
    setResults({});
    try {
      await runStage1();
      // Stages 2–6 surface as "not yet wired" cards rather than running fake work.
      for (const s of L3_STAGES) {
        if (s.wired === "out-of-scope-yet") {
          setOne((`s${s.n}` as keyof PipelineResults), {
            status: "out-of-scope-yet",
            reason: s.pendingReason ?? "Stage not yet wired.",
          });
        }
      }
    } finally {
      setPipelineRunning(false);
    }
  };

  const copyHandoff = async () => {
    const s1 = results.s1;
    if (!s1 || s1.status !== "complete") return;
    const handoff = {
      schema_version: "L3-T0-stage1-v1",
      tier: "t0",
      compound: { name: simResults?.molName, smiles: simResults?.smiles, uniprot: simResults?.uniprotId },
      tissue_selectivity: {
        gene: s1.result.matrix.geneSymbol,
        gtex_dataset: s1.result.matrix.gtexDatasetId,
        gtex_snapshot: s1.result.matrix.gtexSnapshot,
        ic50_uM: s1.result.matrix.ic50_uM,
        Cu_plasma_uM: s1.result.matrix.Cu_plasma_uM,
        cmax_total_uM: s1.result.matrix.cmax_total_uM,
        rows: s1.result.matrix.rows,
      },
      transporter_flags: s1.result.transporters,
      cascade_state: s1.result.matrix.cascadeState,
      l3_input_params: params,
      generated_at: s1.result.matrix.generatedAt,
      stages_pending: L3_STAGES.filter(s => s.wired === "out-of-scope-yet").map(s => ({ n: s.n, name: s.name, reason: s.pendingReason })),
    };
    await navigator.clipboard.writeText(JSON.stringify(handoff, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const stage1Status: StageStatus = (() => {
    const r = results.s1;
    if (!r) return "ready";
    return r.status as StageStatus;
  })();

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT STATUS / INPUTS PANEL ──────────────────────────────────────── */}
      <div className="w-[480px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Microscope className="w-4 h-4 text-amber-400" />
            <h2 className="text-[15px] font-semibold text-white">Layer 3 — Ex Vivo</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
              {wiredCount}/6 stages wired
            </span>
          </div>
          <p className="text-[12px] text-slate-500">
            T0 in-silico surrogate (default) · Stage 1 wired · Stages 2–6 honest stubs per Spec v1.1 Appendix B
          </p>
        </div>

        <div className="flex-1 p-5 space-y-6">

          {/* L1/L2 readiness banner */}
          <div className={`rounded-xl border p-3 flex items-start gap-2.5 ${
            hasL1 ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"
          }`}>
            {hasL1
              ? <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />}
            <div className="flex-1">
              <div className={`text-[11px] font-semibold ${hasL1 ? "text-emerald-300" : "text-amber-300"}`}>
                {hasL1
                  ? (layer2Ready ? "L1 + L2 complete" : "L1 complete — L2 chain auto-rerun on Stage 1 click")
                  : "Awaiting L1 In Vitro completion"}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                {hasL1
                  ? "Stage 1 self-computes the L2 dose projection + PBPK from L1 outputs using the parameters below — L2 click is not required."
                  : "Run L1 In Vitro first to enable L3 Stage 1."}
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
              <L1OutputRow label="UniProt target"      source="L1 / UniProt KB API"        value={simResults ? simResults.uniprotId : "—"} />
              <L1OutputRow label="Target gene (display)" source="L1 binding"               value={simResults ? simResults.binding.targetName : "—"} />
              <L1OutputRow label="L1 IC50 (nM)"        source="L1 binding · primary"        value={simResults ? simResults.binding.primaryIC50.toFixed(1) : "—"} />
              <L1OutputRow label="Plasma fu (%)"       source="L1 PPB sim"                  value={inVitroResults ? inVitroResults.plasmaProteinBinding.fuPercent.toFixed(2) : "—"} />
              <L1OutputRow label="Caco-2 Papp (×10⁻⁶)" source="L1 permeability sim"         value={inVitroResults ? inVitroResults.permeability.caco2Papp.toFixed(1) : "—"} />
              <L1OutputRow label="MW · LogP · TPSA"    source="RDKit descriptors"           value={simResults ? `${simResults.lipinski.mw.toFixed(0)} · ${simResults.lipinski.logP.toFixed(2)} · ${simResults.lipinski.tpsa.toFixed(0)}` : "—"} />
              <L1OutputRow label="L1 Go / No-Go"       source="L1 cascade gate"             value={simResults ? simResults.goNogo : "—"} />
            </div>
          </section>

          {/* INPUT PARAMETERS */}
          <L3InputParamsCard params={params} setParams={setParams} simResults={simResults} />

          {/* PIPELINE STAGES */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Atom className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">L3 Pipeline (Spec v1.1 §3 + §10)</span>
            </div>
            <div className="space-y-2">
              {L3_STAGES.map(s => {
                const key = (`s${s.n}`) as keyof PipelineResults;
                const r = results[key];
                const status: StageStatus = r ? (r.status as StageStatus) : "ready";
                return (
                  <StageCard
                    key={s.n} stage={s} status={status}
                    busy={busyStage === s.n} hasResult={!!r}
                    onRun={() => runStageHandler(s.n)}
                    runDisabled={!hasL1 || pipelineRunning}
                    runDisabledReason={!hasL1 ? "awaiting L1" : undefined}
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
                ? "bg-amber-600 hover:bg-amber-500 text-white cursor-pointer"
                : "bg-slate-700/40 border border-slate-600/40 text-slate-500 cursor-not-allowed"
            }`}
            title={hasL1 ? "Run all L3 stages — Stage 1 computes; Stages 2–6 surface their honest pending status" : "Awaiting L1 In Vitro completion"}
          >
            {pipelineRunning
              ? <><Loader2 className="w-4 h-4 animate-spin" />Running pipeline…</>
              : <><Play className="w-4 h-4" />Run Full L3 Pipeline ({wiredCount} wired + {6 - wiredCount} stub{6 - wiredCount === 1 ? "" : "s"})</>}
          </button>

          {results.s1?.status === "complete" && (
            <button
              type="button"
              onClick={copyHandoff}
              className="w-full h-9 rounded-lg gap-2 text-[12px] flex items-center justify-center border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15 text-amber-300"
            >
              {copied ? <><Check className="w-4 h-4" /> Copied L3-T0 handoff JSON</> : <><Copy className="w-4 h-4" /> Copy L3-T0 handoff JSON</>}
            </button>
          )}

          {/* MODALITIES (reference) */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Microscope className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">L3 Modality Reference (T2 / T3 — opt-in)</span>
            </div>
            <div className="space-y-2">
              {L3_MODALITIES.map(m => (
                <div key={m.name} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-start gap-2 mb-1.5">
                    <Microscope className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-[12px] font-semibold text-white">{m.name}</div>
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/8 text-amber-300/80">T2/T3 opt-in</span>
                      </div>
                      <div className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{m.summary}</div>
                    </div>
                  </div>
                  <div className="pl-5 space-y-1 mt-2">
                    {m.sources.map(s => (
                      <div key={s.name} className="flex items-baseline gap-2 text-[10px]">
                        <CircleDot className="w-2 h-2 text-slate-600 shrink-0 translate-y-0.5" />
                        <span className="text-slate-300 font-medium">{s.name}</span>
                        <span className="text-slate-500">— {s.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>

      {/* ── RIGHT OUTPUT / DOCUMENTATION PANE ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Microscope className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-[18px] font-semibold text-white">L3 — Ex Vivo · T0 In-Silico Surrogate</h2>
              <p className="text-[12px] text-slate-400 leading-relaxed mt-0.5">
                Heuristic + ML predictions of organoid response from L1 + L2 + public atlases.
                Per Spec v1.1 §3 + §10, Stage 1 wired now (tissue selectivity + transporter flags);
                Stages 2–6 are honest stubs awaiting build.
              </p>
            </div>
          </div>

          {/* Idle state */}
          {!results.s1 && (
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center">
              <Microscope className="w-10 h-10 text-amber-400/50 mx-auto mb-3" />
              <p className="text-[13px] text-slate-300 mb-1">Ready to run L3 pipeline</p>
              <p className="text-[11px] text-slate-500">
                Adjust parameters at left, then click <span className="text-amber-300 font-semibold">Run Stage 1</span> or
                <span className="text-amber-300 font-semibold"> Run Full L3 Pipeline</span>. No vendor required for T0.
              </p>
            </div>
          )}

          {/* Stage 1 — Running */}
          {results.s1?.status === "running" && (
            <ResultShell stage={1} name="Tissue selectivity + transporter flags" icon={FlaskConical} status="running">
              <div className="flex items-center gap-2 text-[11px] text-slate-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                Computing L2 dose projection + PBPK + GTEx fetch…
              </div>
            </ResultShell>
          )}

          {/* Stage 1 — Error */}
          {results.s1?.status === "error" && (
            <ResultShell stage={1} name="Tissue selectivity + transporter flags" icon={AlertTriangle} status="error" reason={results.s1.reason}>
              <p className="text-[10px] text-rose-200/60">
                No silent fallback per honesty policy — failure is surfaced and Stage 1 cards are not rendered.
              </p>
            </ResultShell>
          )}

          {/* Stage 1 — Complete */}
          {results.s1?.status === "complete" && (
            <>
              <ResultShell stage={1} name="Tissue selectivity (54 GTEx tissues)" icon={FlaskConical} status="complete">
                <CascadeBlock matrix={results.s1.result.matrix} />
                <TissueMatrixBlock matrix={results.s1.result.matrix} />
              </ResultShell>
              <ResultShell stage={1} name="Transporter substrate / inhibitor flags (9 channels)" icon={Activity} status="complete">
                <TransporterFlagsBlock flags={results.s1.result.transporters} floor={params.transporterConfidenceFloor} />
              </ResultShell>
            </>
          )}

          {/* Stages 2–6 — honest stubs */}
          {([2, 3, 4, 5, 6] as const).map(n => {
            const key = (`s${n}` as keyof PipelineResults);
            const r = results[key];
            if (!r) return null;
            const def = L3_STAGES.find(s => s.n === n)!;
            return (
              <ResultShell
                key={n} stage={n} name={def.name}
                icon={n === 2 ? Beaker : n === 3 ? Atom : n === 4 ? FlaskConical : n === 5 ? Activity : ServerCrash}
                status="out-of-scope-yet"
                reason={def.pendingReason}
              >
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  This stage is intentionally absent rather than fabricated. When wired, it will surface here as a result
                  card with computation method, training-cohort hash (where ML), applicability-domain score, and a
                  measured fold-error band. Until then, downstream cascade integration treats this readout as
                  <span className="text-amber-300"> kind: "not_applicable"</span> per the discriminated <span className="font-mono">CascadeFlagState</span> union.
                </p>
              </ResultShell>
            );
          })}

          {/* L2 → L3 input contract */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-cyan-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 → L3 Input Contract (consumed by Stage 1)</h3>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                "L1 IC50 (nM, primary target)",
                "L1 plasma fu (fraction)",
                "L1 Caco-2 Papp → bioavailability F",
                "L1 ADMET descriptors (logP, MW, TPSA, HBD/HBA)",
                "L2 PBPK Cmax (predicted, mg/L → µM)",
                "L2 dose projection (mg/day for occupancy target)",
                "GTEx v8 median tissue expression (gene-resolved)",
                "Cascade state propagation (CascadeFlagState union)",
              ].map(field => (
                <div key={field} className="flex items-center gap-2 border-b border-white/5 py-1">
                  <Database className="w-3 h-3 text-slate-600 shrink-0" />
                  <span className="text-slate-300">{field}</span>
                </div>
              ))}
            </div>
          </div>

          {/* L3 → L4 graduation dossier */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-emerald-400" />
              <h3 className="text-[13px] font-semibold text-white">L3 → L4 Envelope (per-readout `tier` field)</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Per Spec v1.1 §2.3: each readout carries its own tier badge ("t0" / "t1" / "t2" / "t3"),
              fold-error band, and applicability-domain score. Mixed-tier envelopes are normal.
              Amber Curator at L4 refuses to sign load-bearing claims that rest only on T0 — compile-time
              guaranteed via the discriminated <span className="font-mono">CascadeFlagState</span> union.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                "Per-readout tier badge",
                "Per-readout CascadeFlagState",
                "Computation method + provenance hash",
                "Applicability-domain score + rationale",
                "Fold-error band (cohortN=0 until calibrated)",
                "GTEx / Tabula Sapiens / DILIrank snapshots",
                "L1 + L2 evidence carried forward",
                "Tier-aware downstream weighting",
              ].map(field => (
                <div key={field} className="flex items-center gap-2 border-b border-white/5 py-1">
                  <Shield className="w-3 h-3 text-slate-600 shrink-0" />
                  <span className="text-slate-300">{field}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 flex items-start gap-2.5">
            <FileText className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-300 leading-relaxed">
              <span className="font-semibold text-amber-300">Build status:</span> Stage 1 of 6 wired
              (tissue selectivity + transporter flags). Stages 2–6 (dili-ml, cellTypeAggregator,
              patientLineProjection, biomarker proxy, cascade integration tests) per Spec v1.1
              Appendix B remain to ship.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onContinue}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[12px] font-semibold transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              Continue to L4 Animal Cohort
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}
