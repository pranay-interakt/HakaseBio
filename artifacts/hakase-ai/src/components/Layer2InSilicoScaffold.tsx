import { useState } from "react";
import { Cpu, ArrowRight, Database, Microscope, Atom, Sparkles, AlertCircle, AlertTriangle, CircleDot, Play, Activity, Shield, Beaker, CheckCircle2 } from "lucide-react";
import type { SimResults } from "@/lib/admet";
import type { InVitroResults } from "@/lib/inVitroSim";
import { computeL2DoseProjection, type L2DoseProjection, type MarginTier } from "@/lib/l2DoseProjection";

interface Layer2InSilicoScaffoldProps {
  layer1Ready: boolean;
  simResults: SimResults | null;
  inVitroResults: InVitroResults | null;
  onContinue: () => void;
  onComplete?: () => void;
}

function ScaffoldSectionHeader({ icon: Icon, label, badge }: { icon: any; label: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</span>
      {badge && (
        <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/8 text-amber-400/80">
          {badge}
        </span>
      )}
    </div>
  );
}

/**
 * Stage definitions mirror §4.3 ("Suggested L2 pipeline") of
 * `attached_assets/HakaseBio_4Layer_Architecture_Research_*.docx`. Stage
 * names + detail text are paraphrased from the doc; engine lists and the
 * compute / virtual-subject numbers carried in `detail` come straight from
 * the doc. No engine is wired in this product — every stage is tagged
 * "Not wired" and the engines below each stage are reference candidates,
 * not user choices.
 */
const L2_STAGES = [
  {
    n: 0,
    name: "Ingest L1 outputs",
    detail: "Normalise units; persist to a Parquet store keyed on InChIKey. Pull target sequence (UniProt), structure (PDB > AlphaFold with pLDDT ≥ 70), and off-target panel (ChEMBL + IUPHAR).",
    engines: [
      { name: "L1 Parquet writer",   note: "no-op — direct in-memory hand-off today" },
      { name: "ChEMBL / IUPHAR",     note: "L1 already queries ChEMBL via internal proxy" },
      { name: "UniProt / PDB / AlphaFold", note: "L1 already fetches these" },
    ],
  },
  {
    n: 1,
    name: "Structure prep",
    detail: "Holo-PDB if available, else AlphaFold. Run PDBFixer for missing residues + protonation. Pocket detection via fpocket or P2Rank.",
    engines: [
      { name: "PDBFixer",  note: "BSD — protonation + missing residues" },
      { name: "fpocket",   note: "GPL — pocket detection" },
      { name: "P2Rank",    note: "Apache 2.0 — ML pocket detection" },
    ],
  },
  {
    n: 2,
    name: "Docking",
    detail: "Parallel tracks of Vina / Smina / GNINA classical docking and Boltz-1 (or Boltz-2) co-folding. Merge poses, run PoseBusters as hard filter, rescore survivors with GNINA CNN. Top-3 physically-valid poses per compound.",
    engines: [
      { name: "AutoDock Vina / Smina", note: "Apache 2.0 — classical docking" },
      { name: "GNINA",                  note: "GPL-2 — CNN-rescored" },
      { name: "DiffDock / DiffDock-L",  note: "MIT — diffusion blind docking; PoseBusters mandatory" },
      { name: "Boltz-1 / Boltz-2",      note: "MIT — AF3-equivalent co-folding" },
      { name: "Chai-1",                 note: "Research licence — commercial inquiry needed" },
      { name: "PoseBusters",            note: "BSD-3 — physical-validity QC, mandatory" },
    ],
  },
  {
    n: 3,
    name: "ML affinity + ADMET refinement",
    detail: "DeepPurpose or fine-tuned Uni-Mol for orthogonal affinity. Compare to L1 measured Ki — flag >1-log disagreements. MoLFormer-XL or ChemBERTa-2 fine-tuned for ADMET to triangulate L1.",
    engines: [
      { name: "DeepPurpose / GraphDTA", note: "BSD-3 — DTI architectures" },
      { name: "Uni-Mol / Uni-Mol2",     note: "MIT — 3D-aware affinity" },
      { name: "MoLFormer-XL",           note: "Apache 2.0 — IBM foundation embedding" },
      { name: "ChemBERTa-2",            note: "MIT — SMILES transformer" },
    ],
  },
  {
    n: 4,
    name: "Selectivity",
    detail: "Dock or run ML affinity across ChEMBL / IUPHAR off-target panel for the target family. Compute selectivity indices. Flag hERG (already from L1), CYP3A4, known liabilities.",
    engines: [
      { name: "ChEMBL / IUPHAR off-target panel", note: "L1 already has access" },
      { name: "(reuses Stage 3 ML affinity stack)", note: "" },
    ],
  },
  {
    n: 5,
    name: "Selective free-energy refinement",
    detail: "Only top ~30–50 compounds. OpenMM with OpenFF Sage; perturbation network anchored to a reference compound. ~24 GPU-h per compound on A100; ~3–5 GPU-days for the cohort (per doc).",
    engines: [
      { name: "OpenMM",            note: "MIT — Python-first, GPU-accelerated MD" },
      { name: "OpenFF Toolkit (Sage / Parsley)", note: "MIT — modern force fields with auto-parameterisation" },
      { name: "TIES",              note: "open relative-binding-FEP framework on NAMD/OpenMM" },
      { name: "GROMACS",           note: "LGPL-2.1 — alternative MD engine" },
      { name: "AMBER (AmberTools)", note: "academic-friendly; pmemd.cuda commercial" },
    ],
  },
  {
    n: 6,
    name: "PBPK projection",
    detail: "Build PK-Sim model parameterised from L1 ADMET (microsomal CL → hepatic CL via well-stirred; logP, pKa, fu_p, MW). Simulate human PK across a dose range — Cmax, AUC, t½, fraction-bound at target.",
    engines: [
      { name: "PK-Sim / MoBi",          note: "GPL-2 — OSS PBPK reference" },
      { name: "Pumas.jl",               note: "free academic / paid commercial — NLME" },
      { name: "mrgsolve",               note: "GPL-2 — ODE PK at scale" },
      { name: "BioGears",               note: "Apache 2.0 — whole-body physiology" },
      { name: "OpenCOR",                note: "GPL — CellML organ-level PD" },
      { name: "GastroPlus / Simcyp",    note: "Commercial benchmark only — not core to OSS pipeline (per §4.2.1)" },
    ],
  },
  {
    n: 7,
    name: "QSP / PD coupling",
    detail: "For targets with curated BioModels QSP, couple PK profile via Tellurium / libRoadRunner — simulate target engagement vs time and downstream pathway markers. For novel targets, build a minimal target-occupancy model (Hill equation around L1 Ki).",
    engines: [
      { name: "Tellurium / libRoadRunner", note: "Apache 2.0 — Python-native SBML" },
      { name: "COPASI",                    note: "Artistic 2.0 — SBML simulator with sensitivity analysis" },
      { name: "BioModels repository",      note: "starter QSP models" },
    ],
  },
  {
    n: 8,
    name: "Therapeutic-index ranking",
    wired: true,
    detail: "Efficacy margin = predicted Cmax,unbound / Ki; safety margin = hERG IC50 / Cmax,unbound (and CYP, off-target). Wired in this build via lib/l2DoseProjection.ts — runs on live L1 outputs. Click 'Run' below.",
    engines: [
      { name: "lib/l2DoseProjection.ts", note: "in-house — receptor occupancy + well-stirred liver model + Caco-2 → F bins + logP-binned Vd proxy" },
      { name: "PKNCA / ospsuite-r", note: "GPL — allometric scaling helpers (referenced; not used by current in-house implementation)" },
    ],
  },
  {
    n: 9,
    name: "Output — ranked shortlist",
    detail: "Per-compound predicted human dose range, predicted unbound Cmax/AUC at each dose, pose files (PDB), free-energy estimates, liability flags, confidence + uncertainty. Doc-suggested shortlist size: 20–50 compounds.",
    engines: [
      { name: "(downstream contract — handed to L3 Ex-Vivo)", note: "see right pane for the L2→L3 contract" },
    ],
  },
] as const;

function StageCard({ stage }: { stage: (typeof L2_STAGES)[number] }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-semibold flex items-center justify-center shrink-0">
          {stage.n}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[12px] font-semibold text-white">Stage {stage.n} — {stage.name}</div>
            {(stage as any).wired ? (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">Wired</span>
            ) : (
              <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/8 text-rose-300">Not wired</span>
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
    </div>
  );
}

function fmt(n: number, digits: number, suffix = ""): string {
  if (!isFinite(n)) return "—";
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

function MarginBar({ row }: { row: { label: string; ratio: number | null; tier: MarginTier; numerator: string; denominator: string; assumption: string } }) {
  const display = row.ratio === null || !isFinite(row.ratio)
    ? "—"
    : row.ratio >= 1000 ? `${(row.ratio / 1000).toFixed(1)}k×`
    : row.ratio >= 100  ? `${row.ratio.toFixed(0)}×`
    : `${row.ratio.toFixed(1)}×`;
  // Bar fill: log-scaled, capped at margin=1000.
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

/**
 * L2 In-Silico — scaffold panel introduced by the April 2026 4-layer redesign.
 * Renders with the same two-pane layout as L1 / L4. The left pane is an
 * HONEST status panel — top half shows the actual L1 outputs this product
 * produces (read from `simResults`); bottom half shows the L2 pipeline
 * stages from the architecture doc with each stage tagged "Not wired" and
 * its candidate engines listed read-only.
 *
 * No fabricated numbers (no costs, no wall-clock estimates, no composite
 * weights) — only what's either in `simResults` (live) or in the doc (cited).
 */
export function Layer2InSilicoScaffold({ layer1Ready, simResults, inVitroResults, onContinue, onComplete }: Layer2InSilicoScaffoldProps) {
  const hasL1 = !!simResults && !!inVitroResults;
  const [projection, setProjection] = useState<L2DoseProjection | null>(null);
  const [running, setRunning]       = useState(false);

  const handleRun = () => {
    if (!simResults || !inVitroResults) return;
    setRunning(true);
    // Synchronous; small delay just so the spinner is visible.
    setTimeout(() => {
      const p = computeL2DoseProjection(simResults, inVitroResults);
      setProjection(p);
      setRunning(false);
      onComplete?.();
    }, 250);
  };

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT STATUS / INPUTS PANEL ─────────────────────────────────────── */}
      <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h2 className="text-[15px] font-semibold text-white">Layer 2 — In Silico</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
              Stage 8 wired
            </span>
          </div>
          <p className="text-[12px] text-slate-500">Stage 8 (therapeutic-index ranking) runs on live L1 outputs. Other stages remain reference-only.</p>
        </div>

        <div className="flex-1 p-5 space-y-6">

          {/* Honest banner — scoped to what is / isn't wired */}
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-amber-300">Partial wiring — Stage 8 only</div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                Stages 0–7 and 9 in the architecture doc (docking, free-energy, full PBPK, QSP/PD coupling)
                do not execute in this build. Stage 8 (therapeutic-index ranking + first-pass human dose
                projection) is wired as <span className="font-mono text-slate-300">lib/l2DoseProjection.ts</span>
                — uses receptor-occupancy theory, well-stirred liver model, and Yee 1997 Caco-2 → F bins
                on top of live L1 outputs.
              </p>
            </div>
          </div>

          {/* L1 readiness */}
          <div className={`rounded-xl border p-3 flex items-start gap-2.5 ${
            layer1Ready
              ? "border-emerald-500/25 bg-emerald-500/5"
              : "border-amber-500/25 bg-amber-500/5"
          }`}>
            {layer1Ready ? (
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <div className={`text-[11px] font-semibold ${layer1Ready ? "text-emerald-300" : "text-amber-300"}`}>
                {layer1Ready ? "L1 simulation complete" : "Awaiting L1 In Vitro completion"}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                {layer1Ready
                  ? "L1 produced the in-vitro digital twin below. These are the actual fields L2 would ingest."
                  : "Run L1 In Vitro first to see what fields L2 would receive."}
              </p>
            </div>
          </div>

          {/* LIVE L1 INPUTS */}
          <section>
            <ScaffoldSectionHeader icon={Database} label="L1 Inputs (live from this product)" badge={hasL1 ? "Live" : "Pending"} />
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
              <L1OutputRow
                label="Compound"
                source="L1 / chemistry.ts (RDKit)"
                value={simResults ? simResults.molName : "—"}
              />
              <L1OutputRow
                label="SMILES"
                source="user input · RDKit-validated"
                value={simResults ? (simResults.smiles.length > 22 ? simResults.smiles.slice(0, 22) + "…" : simResults.smiles) : "—"}
              />
              <L1OutputRow
                label="UniProt target"
                source="L1 / UniProt KB API"
                value={simResults ? simResults.uniprotId : "—"}
              />
              <L1OutputRow
                label="MW · LogP · TPSA"
                source="RDKit descriptors"
                value={simResults ? `${simResults.lipinski.mw.toFixed(0)} · ${simResults.lipinski.logP.toFixed(2)} · ${simResults.lipinski.tpsa.toFixed(0)}` : "—"}
              />
              <L1OutputRow
                label="Predicted Kd · Ki · IC50 (nM)"
                source="ai-service / DeepDTA-style GBM"
                value={simResults
                  ? `${simResults.binding.primaryKd.toFixed(1)} · ${simResults.binding.primaryKi.toFixed(1)} · ${simResults.binding.primaryIC50.toFixed(1)}`
                  : "—"}
              />
              <L1OutputRow
                label="Off-target hits"
                source="ai-service + ChEMBL"
                value={simResults ? `${simResults.binding.offTargets.length}` : "—"}
              />
              <L1OutputRow
                label="ADMET (abs · met · tox)"
                source="ai-service / Chemprop GNN"
                value={simResults ? `${(simResults.admet.absorption * 100).toFixed(0)}% · ${(simResults.admet.metabolism * 100).toFixed(0)}% · ${(simResults.admet.toxicity * 100).toFixed(0)}%` : "—"}
              />
              <L1OutputRow
                label="Tox alerts (SMARTS + ML)"
                source="bioactivationEngine + cardiotox RF"
                value={simResults ? `${simResults.toxAlerts.length}` : "—"}
              />
              <L1OutputRow
                label="QED · SA-score · Confidence"
                source="RDKit + heuristic"
                value={simResults ? `${simResults.qed.toFixed(2)} · ${simResults.saScore.toFixed(2)} · ${simResults.confidence.toFixed(2)}` : "—"}
              />
              <L1OutputRow
                label="Go / No-Go"
                source="L1 cascade gate"
                value={simResults ? simResults.goNogo : "—"}
              />
            </div>
            {hasL1 && (
              <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
                These are real values from <span className="text-slate-400 font-medium">simResults</span> — see <span className="text-slate-400 font-mono">artifacts/hakase-ai/src/lib/admet.ts</span> for field definitions.
              </p>
            )}
          </section>

          {/* L2 PIPELINE STAGES (mostly status only; Stage 8 wired) */}
          <section>
            <ScaffoldSectionHeader icon={Atom} label="L2 Pipeline (per architecture doc §4.3)" badge="Stage 8 wired" />
            <div className="space-y-2">
              {L2_STAGES.map(s => <StageCard key={s.n} stage={s} />)}
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed mt-3">
              Engine candidates and stage descriptions are taken from <span className="text-slate-400 font-mono">HakaseBio_4Layer_Architecture_Research</span> §4.2 and §4.3 (paraphrased, with cited compute / virtual-subject numbers preserved as-stated). Stage 8 executes via <span className="font-mono text-slate-400">lib/l2DoseProjection.ts</span>; other stages remain reference-only.
            </p>
          </section>

          {/* RUN BUTTON — wired to Stage 8 (therapeutic-index ranking) */}
          <button
            type="button"
            disabled={!hasL1 || running}
            onClick={handleRun}
            className={`w-full font-semibold h-10 rounded-lg gap-2 text-[13px] flex items-center justify-center transition-colors ${
              hasL1 && !running
                ? "bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer"
                : "bg-slate-700/40 border border-slate-600/40 text-slate-500 cursor-not-allowed"
            }`}
            title={hasL1 ? "Run Stage 8 — therapeutic-index ranking on live L1 outputs" : "Awaiting L1 In Vitro completion"}
          >
            {running ? (
              <>
                <Activity className="w-4 h-4 animate-pulse" />
                Computing therapeutic-index margins…
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                {hasL1 ? "Run Stage 8 — Therapeutic-Index Ranking" : "Run Stage 8 — awaiting L1"}
              </>
            )}
          </button>

        </div>
      </div>

      {/* ── RIGHT OUTPUT / DOCUMENTATION PANE ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Cpu className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-[18px] font-semibold text-white">L2 — In Silico Contract</h2>
              <p className="text-[12px] text-slate-400 leading-relaxed mt-0.5">
                Computational triage between L1 wet-style assays and L3 ex-vivo tissue work.
                Source: Architecture Research §4 · Stage 8 wired; other stages reference-only.
              </p>
            </div>
          </div>

          {/* ── Stage 8 RESULTS (only after Run) ────────────────────────────── */}
          {projection && (
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-4 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-300" />
                <h3 className="text-[13px] font-semibold text-white">Stage 8 — Therapeutic-Index Ranking · live result</h3>
                <span className={`ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${verdictColor(projection.verdict)}`}>
                  {projection.verdict}
                </span>
              </div>

              {/* Receptor-occupancy target */}
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <div className="text-[11px] font-semibold text-slate-200">Receptor-occupancy target</div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="text-slate-500">Target occupancy</div>
                  <div className="text-cyan-300 font-mono text-right">{fmt(projection.targetOccupancy * 100, 0, "%")}</div>
                  <div className="text-slate-500">L1 Ki</div>
                  <div className="text-cyan-300 font-mono text-right">{fmt(projection.ki_nM, 2, " nM")}</div>
                  <div className="text-slate-500">Required Cmax,unbound</div>
                  <div className="text-cyan-300 font-mono text-right">{fmt(projection.targetCmaxUnbound_nM, 2, " nM")}</div>
                  <div className="text-slate-500">Plasma fu (L1)</div>
                  <div className="text-cyan-300 font-mono text-right">{fmt(projection.fu_fraction * 100, 2, "%")}</div>
                  <div className="text-slate-500">Required Cmax,total</div>
                  <div className="text-cyan-300 font-mono text-right">{fmt(projection.targetCmaxTotal_nM, 2, " nM")}</div>
                </div>
                <div className="text-[9px] text-slate-600 italic mt-2">
                  Hill slope 1: Cmax,u = {(projection.targetOccupancy / (1 - projection.targetOccupancy)).toFixed(1)}× Ki for {(projection.targetOccupancy * 100).toFixed(0)}% occupancy.
                </div>
              </div>

              {/* Therapeutic-index margins */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-3.5 h-3.5 text-cyan-400" />
                  <div className="text-[11px] font-semibold text-slate-200">Therapeutic-index margins</div>
                  <span className="text-[9px] text-slate-600 ml-auto">SAFE ≥30× · CAUTION 10–30× · RISK &lt;10×</span>
                </div>
                <div className="space-y-2">
                  {projection.margins.map(m => <MarginBar key={m.label} row={m} />)}
                </div>
              </div>

              {/* First-pass dose projection */}
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <Beaker className="w-3.5 h-3.5 text-cyan-400" />
                  <div className="text-[11px] font-semibold text-slate-200">First-pass human dose projection</div>
                  <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/8 text-amber-300">
                    Confidence: low
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="text-slate-500">Estimated Vd</div>
                  <div className="text-cyan-300 font-mono text-right">{fmt(projection.Vd_L_per_kg, 2, " L/kg")}</div>
                  <div className="text-slate-500">Estimated F (oral)</div>
                  <div className="text-cyan-300 font-mono text-right">{fmt(projection.F_oral * 100, 0, "%")}</div>
                  <div className="text-slate-500">Estimated hepatic CL</div>
                  <div className="text-cyan-300 font-mono text-right">{projection.hepaticCL_mL_min_kg !== null ? fmt(projection.hepaticCL_mL_min_kg, 1, " mL/min/kg") : "—"}</div>
                  <div className="text-slate-500">Predicted dose (mg/kg)</div>
                  <div className="text-cyan-300 font-mono text-right">{fmt(projection.predictedDose_mg_per_kg, 3)}</div>
                  <div className="text-slate-300 font-semibold">Predicted dose (mg/day, 70 kg)</div>
                  <div className="text-cyan-200 font-mono text-right font-semibold">{fmt(projection.predictedDose_mg_per_day, 1)}</div>
                </div>
                <details className="text-[9px] text-slate-500 leading-relaxed mt-1">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-300">Assumptions used</summary>
                  <ul className="list-disc list-inside mt-1 space-y-0.5 italic">
                    <li>{projection.Vd_assumption}</li>
                    <li>{projection.F_assumption}</li>
                    <li>{projection.CL_assumption}</li>
                    <li>{projection.doseAssumption}</li>
                  </ul>
                </details>
              </div>

              {/* Verdict + warnings */}
              <div className={`rounded-lg border p-3 ${verdictColor(projection.verdict)}`}>
                <div className="text-[11px] font-semibold mb-1.5">Verdict — {projection.verdict}</div>
                <ul className="text-[10px] list-disc list-inside space-y-0.5 leading-relaxed">
                  {projection.rationale.map((r, i) => <li key={`r${i}`}>{r}</li>)}
                </ul>
                {projection.warnings.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <div className="text-[10px] font-semibold mb-1">L1 carry-forward warnings</div>
                    <ul className="text-[10px] list-disc list-inside space-y-0.5 leading-relaxed">
                      {projection.warnings.map((w, i) => <li key={`w${i}`}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              <div className="text-[9px] text-slate-600 italic leading-relaxed">
                {projection.confidenceNote} Generated {new Date(projection.generatedAt).toLocaleTimeString()} from L1 stamp {new Date(projection.l1Stamp).toLocaleTimeString()}.
              </div>
            </div>
          )}

          {/* L1 → L2 input contract — sourced from the doc */}
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

          {/* L2 → L3 output contract — sourced from the doc */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-amber-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 → L3 Output Contract</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              When wired, L2 would hand L3 a ranked shortlist (architecture doc §4 — no specific shortlist size or cost estimate is asserted by this product), each carrying:
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
              Reviewed L2 contract — continue to L3 Ex Vivo
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}

