import { Cpu, ArrowRight, Database, Microscope, Atom, Sparkles, AlertCircle, AlertTriangle, CircleDot } from "lucide-react";
import type { SimResults } from "@/lib/admet";

interface Layer2InSilicoScaffoldProps {
  layer1Ready: boolean;
  simResults: SimResults | null;
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
    detail: "Efficacy margin = predicted Cmax,unbound / Ki; safety margin = hERG IC50 / Cmax,unbound (and CYP, off-target). MRSD computed from L1 NOAEL via FDA workflow. Composite score with confidence intervals from PBPK population simulation (n = 500 virtual subjects, per doc).",
    engines: [
      { name: "PKNCA / ospsuite-r", note: "GPL — allometric scaling helpers for the NOAEL→HED chain" },
      { name: "(internal scoring utility)", note: "no widely-adopted standalone OSS package — doc recommends a thin in-house implementation" },
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
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/8 text-rose-300">Not wired</span>
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
export function Layer2InSilicoScaffold({ layer1Ready, simResults, onContinue }: Layer2InSilicoScaffoldProps) {
  const hasL1 = !!simResults;

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT STATUS / INPUTS PANEL ─────────────────────────────────────── */}
      <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h2 className="text-[15px] font-semibold text-white">Layer 2 — In Silico</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
              Scaffold
            </span>
          </div>
          <p className="text-[12px] text-slate-500">Computational triage — pipeline reference only; no engine wired in this build</p>
        </div>

        <div className="flex-1 p-5 space-y-6">

          {/* Honest banner */}
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-rose-300">No L2 engine is wired in this build</div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                None of the stages below execute today. The shortlist L4 currently consumes is generated
                by L1 directly via allometric projection, not by L2 docking / PBPK / ML triage.
                This panel exists to show the pipeline shape and the L1 inputs it would consume — not to imply functionality.
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

          {/* L2 PIPELINE STAGES (status only) */}
          <section>
            <ScaffoldSectionHeader icon={Atom} label="L2 Pipeline (per architecture doc §4.3)" badge="Not wired" />
            <div className="space-y-2">
              {L2_STAGES.map(s => <StageCard key={s.n} stage={s} />)}
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed mt-3">
              Engine candidates and stage descriptions are taken from <span className="text-slate-400 font-mono">HakaseBio_4Layer_Architecture_Research</span> §4.2 and §4.3 (paraphrased, with cited compute / virtual-subject numbers preserved as-stated). No selection persists because no engine executes.
            </p>
          </section>

          {/* RUN BUTTON — disabled, honest copy */}
          <button
            type="button"
            disabled
            title="No L2 engine integration ships in this build"
            className="w-full bg-rose-600/15 border border-rose-500/25 text-rose-400/70 font-semibold h-10 rounded-lg gap-2 text-[13px] flex items-center justify-center cursor-not-allowed"
          >
            <Cpu className="w-4 h-4" />
            Run In Silico Triage — no engine wired
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
                Source: Architecture Research §4 · No engine is wired in this build.
              </p>
            </div>
          </div>

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

