import { useState } from "react";
import {
  Microscope, ArrowRight, Database, Shield, Sparkles, AlertCircle, AlertTriangle,
  CircleDot, FileText, FlaskConical, Activity, Loader2, Copy, Check,
} from "lucide-react";
import type { SimResults } from "@/lib/admet";
import type { InVitroResults } from "@/lib/inVitroSim";
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

/* ─── Small UI helpers ─────────────────────────────────────────────────────── */

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

/* ─── T0 Surrogate · Stage 1 panel ─────────────────────────────────────────── */

interface T0Stage1State {
  status: "idle" | "running" | "complete" | "error";
  matrix: TissueSelectivityMatrix | null;
  transporters: TransporterFlagsResult | null;
  error: string | null;
}

function TissueSelectivityCard({ matrix }: { matrix: TissueSelectivityMatrix }) {
  const [showAll, setShowAll] = useState(false);
  const sortedRows = [...matrix.rows].sort((a, b) => b.onTargetScore - a.onTargetScore);
  const visible = showAll ? sortedRows : sortedRows.slice(0, 12);

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-violet-400" />
          <h4 className="text-[13px] font-semibold text-white">
            Tissue-selectivity matrix · {matrix.rows.length} GTEx tissues
          </h4>
        </div>
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300">
          T0 surrogate
        </span>
      </div>

      <div className="text-[10px] text-slate-400 leading-relaxed space-y-1">
        <div>
          <span className="text-slate-500">Method:</span>{" "}
          L1 IC50 ÷ predicted Cu (fu × L2 PBPK Cmax) per tissue, weighted by GTEx target expression.
        </div>
        <div>
          <span className="text-slate-500">Provenance:</span>{" "}
          gene <span className="text-violet-300">{matrix.geneSymbol}</span> ·{" "}
          dataset <span className="text-violet-300">{matrix.gtexDatasetId}</span> ·{" "}
          IC50 <span className="text-violet-300">{matrix.ic50_uM.toFixed(4)} µM</span> ·{" "}
          Cu_plasma <span className="text-violet-300">{matrix.Cu_plasma_uM.toFixed(4)} µM</span> ·{" "}
          Cmax_total <span className="text-violet-300">{matrix.cmax_total_uM.toFixed(3)} µM</span>
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
              <div className="text-right font-mono text-violet-300">{r.onTargetScore.toFixed(3)}</div>
              <div className="flex justify-center"><ConfidencePill c={r.confidence} /></div>
            </div>
          ))}
        </div>
      </div>

      {sortedRows.length > 12 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="w-full text-center text-[10px] text-slate-400 hover:text-violet-300 py-1"
        >
          {showAll ? "Collapse" : `Show all ${sortedRows.length} tissues`}
        </button>
      )}

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-2">
          <div className="text-violet-300 uppercase tracking-wider font-semibold mb-1">Top on-target tissues</div>
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

function TransporterFlagsCard({ flags }: { flags: TransporterFlagsResult }) {
  const channels = Object.keys(TRANSPORTER_LABELS) as TransporterChannel[];
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h4 className="text-[13px] font-semibold text-white">Transporter substrate / inhibitor flags</h4>
        </div>
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
          QSAR · {flags.qsarVersion}
        </span>
      </div>
      <div className="text-[10px] text-slate-400">
        Rule-based on L1 ADMET descriptors — MW {flags.inputs.mw.toFixed(1)} ·
        logP {flags.inputs.logP.toFixed(2)} · TPSA {flags.inputs.tpsa.toFixed(1)} ·
        HBD {flags.inputs.hbd} · HBA {flags.inputs.hba}.
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {channels.map(ch => {
          const f = flags[ch];
          const meta = TRANSPORTER_LABELS[ch];
          return (
            <div key={ch} className="rounded-md border border-white/8 bg-black/30 p-2" title={f.rationale}>
              <div className="flex items-center justify-between mb-1">
                <div>
                  <div className="text-[11px] font-semibold text-white">{meta.label}</div>
                  <div className="text-[9px] text-slate-500">{meta.site}</div>
                </div>
                <div className="flex gap-1.5">
                  {f.substrate && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">substrate</span>
                  )}
                  {f.inhibitor && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-rose-500/40 bg-rose-500/10 text-rose-300">inhibitor</span>
                  )}
                  {!f.substrate && !f.inhibitor && (
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-white/10 bg-white/[0.02] text-slate-500">no flag</span>
                  )}
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

function CascadeBanner({ matrix }: { matrix: TissueSelectivityMatrix }) {
  const s = matrix.cascadeState;
  if (s.kind !== "prediction_only") return null;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <div className="text-[11px] font-semibold text-amber-300">Cascade flag · prediction_only</div>
      </div>
      <p className="text-[10px] text-slate-300 leading-relaxed">{s.uiBanner}</p>
      <div className="text-[10px] text-slate-400 grid grid-cols-2 gap-x-4 gap-y-1">
        <div><span className="text-slate-500">Method:</span> {s.method}</div>
        <div><span className="text-slate-500">Applicability:</span> {s.applicabilityDomain.inDomain ? "in domain" : "out of domain"} (score {s.applicabilityDomain.score.toFixed(2)})</div>
        <div className="col-span-2"><span className="text-slate-500">Snapshots within cadence:</span> {s.snapshotsWithinCadence ? "yes" : "no"}</div>
        <div className="col-span-2"><span className="text-slate-500">AD rationale:</span> {s.applicabilityDomain.rationale}</div>
        <div className="col-span-2">
          <span className="text-slate-500">Fold-error band:</span>{" "}
          {s.foldError.cohortN > 0
            ? `median ${s.foldError.median.toFixed(2)}× / p90 ${s.foldError.p90.toFixed(2)}× (n=${s.foldError.cohortN})`
            : "not yet measured (no calibration cohort)"}
        </div>
      </div>
    </div>
  );
}

/* ─── Main scaffold ────────────────────────────────────────────────────────── */

export function Layer3ExVivoScaffold({
  layer2Ready,
  simResults,
  inVitroResults,
  onContinue,
}: Layer3ExVivoScaffoldProps) {
  const hasL1 = !!simResults && !!inVitroResults;
  const [t0, setT0] = useState<T0Stage1State>({
    status: "idle", matrix: null, transporters: null, error: null,
  });
  const [copied, setCopied] = useState(false);

  const runT0 = async () => {
    if (!simResults || !inVitroResults) return;
    setT0({ status: "running", matrix: null, transporters: null, error: null });
    try {
      const transporters = predictTransporterFlags(simResults.lipinski);
      const matrix = await computeTissueSelectivityMatrix({ sim: simResults, iv: inVitroResults });
      setT0({ status: "complete", matrix, transporters, error: null });
    } catch (err: any) {
      setT0({ status: "error", matrix: null, transporters: null, error: err?.message ?? String(err) });
    }
  };

  const copyHandoff = async () => {
    if (!t0.matrix || !t0.transporters) return;
    const handoff = {
      schema_version: "L3-T0-stage1-v1",
      tier: "t0",
      compound: { name: simResults?.molName, smiles: simResults?.smiles, uniprot: simResults?.uniprotId },
      tissue_selectivity: {
        gene: t0.matrix.geneSymbol,
        gtex_dataset: t0.matrix.gtexDatasetId,
        gtex_snapshot: t0.matrix.gtexSnapshot,
        ic50_uM: t0.matrix.ic50_uM,
        Cu_plasma_uM: t0.matrix.Cu_plasma_uM,
        cmax_total_uM: t0.matrix.cmax_total_uM,
        rows: t0.matrix.rows,
      },
      transporter_flags: t0.transporters,
      cascade_state: t0.matrix.cascadeState,
      generated_at: t0.matrix.generatedAt,
    };
    await navigator.clipboard.writeText(JSON.stringify(handoff, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT PANEL ──────────────────────────────────────────────────────── */}
      <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Microscope className="w-4 h-4 text-amber-400" />
            <h2 className="text-[15px] font-semibold text-white">Layer 3 — Ex Vivo</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-300">
              T0 · Stage 1
            </span>
          </div>
          <p className="text-[12px] text-slate-500">
            In-silico surrogate (default) · CRO / vendor adapters opt-in (T2 / T3, not yet wired)
          </p>
        </div>

        <div className="flex-1 p-5 space-y-5">

          {/* T0 status banner */}
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-3 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-violet-300">
                T0 In-Silico Surrogate · Stage 1 wired
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                Tissue-selectivity matrix (54 GTEx tissues) + transporter flags (9 channels) compute
                from real L1 + L2 outputs. Stages 2–6 (DILI-ML, cell-type aggregation, patient-line
                projection, biomarker proxy, cascade integration tests) per spec v1.1 not yet wired —
                will surface as additional cards here when shipped.
              </p>
            </div>
          </div>

          {/* L2 readiness */}
          <div className={`rounded-xl border p-3 flex items-start gap-2.5 ${
            layer2Ready
              ? "border-emerald-500/25 bg-emerald-500/5"
              : "border-amber-500/25 bg-amber-500/5"
          }`}>
            {layer2Ready
              ? <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />}
            <div className="flex-1">
              <div className={`text-[11px] font-semibold ${layer2Ready ? "text-emerald-300" : "text-amber-300"}`}>
                {layer2Ready ? "L2 acknowledged — using L2 PBPK + dose projection" : "L2 not run — Stage 1 will compute L2 chain on demand"}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                L3 Stage 1 self-computes the L2 dose projection + PBPK from L1 outputs using L2 default
                params (occupancy 0.75, BW 70 kg, oral, QD). To override, run L2 first and re-enter L3.
              </p>
            </div>
          </div>

          {/* L1 inputs panel */}
          <section>
            <ScaffoldSectionHeader
              icon={Database}
              label="Upstream evidence (L1)"
              badge={hasL1 ? "Live" : "Pending"}
            />
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-1.5 text-[11px]">
              <div className="flex justify-between border-b border-white/5 py-1">
                <span className="text-slate-400">Compound</span>
                <span className="font-mono text-amber-300">{simResults?.molName ?? "—"}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 py-1">
                <span className="text-slate-400">UniProt target</span>
                <span className="font-mono text-amber-300">{simResults?.uniprotId ?? "—"}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 py-1">
                <span className="text-slate-400">Target gene (display)</span>
                <span className="font-mono text-amber-300">{simResults?.binding.targetName ?? "—"}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 py-1">
                <span className="text-slate-400">L1 IC50 (nM)</span>
                <span className="font-mono text-amber-300">{simResults ? simResults.binding.primaryIC50.toFixed(1) : "—"}</span>
              </div>
              <div className="flex justify-between border-b border-white/5 py-1">
                <span className="text-slate-400">L1 plasma fu (%)</span>
                <span className="font-mono text-amber-300">{inVitroResults ? inVitroResults.plasmaProteinBinding.fuPercent.toFixed(2) : "—"}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">L1 Caco-2 Papp (×10⁻⁶)</span>
                <span className="font-mono text-amber-300">{inVitroResults ? inVitroResults.permeability.caco2Papp.toFixed(1) : "—"}</span>
              </div>
            </div>
            {!hasL1 && (
              <p className="text-[10px] text-slate-500 leading-relaxed mt-2">Run L1 (and ideally L2) to enable T0.</p>
            )}
          </section>

          {/* RUN button */}
          <button
            type="button"
            disabled={!hasL1 || t0.status === "running"}
            onClick={runT0}
            title={!hasL1 ? "L1 outputs required" : "Run T0 Stage 1: tissue selectivity + transporter flags"}
            className={`w-full font-semibold h-10 rounded-lg gap-2 text-[13px] flex items-center justify-center transition-colors ${
              !hasL1
                ? "bg-slate-800/40 border border-white/8 text-slate-600 cursor-not-allowed"
                : t0.status === "running"
                  ? "bg-violet-700/30 border border-violet-500/30 text-violet-300 cursor-wait"
                  : "bg-violet-600 hover:bg-violet-500 text-white"
            }`}
          >
            {t0.status === "running"
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Running T0 Stage 1…</>
              : <><Microscope className="w-4 h-4" /> Run T0 Surrogate · Stage 1</>}
          </button>

          {t0.status === "complete" && (
            <button
              type="button"
              onClick={copyHandoff}
              className="w-full h-9 rounded-lg gap-2 text-[12px] flex items-center justify-center border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/15 text-violet-300"
            >
              {copied ? <><Check className="w-4 h-4" /> Copied L3-T0 handoff JSON</> : <><Copy className="w-4 h-4" /> Copy L3-T0 handoff JSON</>}
            </button>
          )}

          {/* MODALITIES (reference) */}
          <section>
            <ScaffoldSectionHeader icon={Microscope} label="L3 modality reference (T2 / T3)" badge="opt-in" />
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

      {/* ── RIGHT PANEL ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-5">

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Microscope className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-[18px] font-semibold text-white">L3 — Ex Vivo · T0 In-Silico Surrogate</h2>
              <p className="text-[12px] text-slate-400 leading-relaxed mt-0.5">
                Heuristic + ML predictions of organoid response from L1 + L2 + public atlases.
                Stage 1 wires tissue-selectivity (54 GTEx tissues) + transporter flags (9 channels).
                Source: HakaseBio_Layer3_InSilico_Surrogate_Spec v1.1 §3 + §10.
              </p>
            </div>
          </div>

          {/* Idle state */}
          {t0.status === "idle" && (
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-6 text-center">
              <Microscope className="w-10 h-10 text-violet-400/50 mx-auto mb-3" />
              <p className="text-[13px] text-slate-300 mb-1">Ready to run T0 Stage 1</p>
              <p className="text-[11px] text-slate-500">
                Click <span className="text-violet-300 font-semibold">Run T0 Surrogate</span> to compute the
                tissue-selectivity matrix and transporter flags. No vendor required.
              </p>
            </div>
          )}

          {/* Error state */}
          {t0.status === "error" && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <h3 className="text-[13px] font-semibold text-rose-200">T0 Stage 1 failed</h3>
              </div>
              <p className="text-[11px] text-rose-100/80 leading-relaxed">{t0.error}</p>
              <p className="text-[10px] text-rose-200/60 mt-2">
                No silent fallback per honesty policy — failure is surfaced and the cards are not rendered.
              </p>
            </div>
          )}

          {/* Result cards */}
          {t0.status === "complete" && t0.matrix && (
            <>
              <CascadeBanner matrix={t0.matrix} />
              <TissueSelectivityCard matrix={t0.matrix} />
              {t0.transporters && <TransporterFlagsCard flags={t0.transporters} />}
            </>
          )}

          {/* L2 → L3 input contract */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-violet-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 → L3 Input Contract (consumed by T0)</h3>
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
              <ArrowRight className="w-4 h-4 text-amber-400" />
              <h3 className="text-[13px] font-semibold text-white">L3 → L4 Envelope (per-readout tier field)</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Per spec v1.1 §2.3: each readout carries its own tier badge ("t0" / "t1" / "t2" / "t3"),
              fold-error band, and applicability-domain score. Mixed-tier envelopes are normal.
              Amber Curator at L4 refuses to sign load-bearing claims that rest only on T0.
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
              (tissue selectivity + transporter flags). Stages 2–6 (dili-ml, cellTypeAggregator, patientLineProjection,
              biomarker proxy, cascade integration tests) per spec v1.1 Appendix B remain to ship.
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
