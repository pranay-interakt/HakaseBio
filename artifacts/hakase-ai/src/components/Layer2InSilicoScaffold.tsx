import { useState } from "react";
import { Cpu, ArrowRight, Database, Construction, Beaker, Microscope, Atom, Network, Settings2, Scale, Sparkles, AlertCircle } from "lucide-react";

interface Layer2InSilicoScaffoldProps {
  layer1Ready: boolean;
  onContinue: () => void;
}

function ScaffoldSectionHeader({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</span>
      <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/8 text-amber-400/80">
        Scaffold
      </span>
    </div>
  );
}

function OptionCard({
  title,
  subtitle,
  badge,
  selected,
  onClick,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
        selected
          ? "border-cyan-500/50 bg-cyan-500/8 ring-1 ring-cyan-500/30"
          : "border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-[12px] font-semibold text-white">{title}</div>
        {badge && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 shrink-0">
            {badge}
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-500 leading-relaxed">{subtitle}</div>
    </button>
  );
}

const DOCKING_ENGINES = [
  { id: "vina",   title: "AutoDock Vina",     subtitle: "Open-source standard. Empirical scoring, fastest. Default for high-throughput triage.", badge: "Default" },
  { id: "gnina",  title: "GNINA",             subtitle: "CNN-rescored Vina. Better ranking on PDBbind. Recommended for kinase / GPCR targets." },
  { id: "boltz",  title: "Boltz-1 co-folding", subtitle: "Joint protein-ligand structure prediction. Use when binding pose has high uncertainty or for novel scaffolds.", badge: "Beta" },
] as const;

const ML_AFFINITY_MODELS = [
  { id: "molformer", title: "MoLFormer-XL", subtitle: "IBM transformer trained on 1.1B SMILES. Used as primary ML predictor for Ki / IC50.", badge: "Primary" },
  { id: "unimol",    title: "Uni-Mol2",    subtitle: "3D-aware molecular representation. Used as the cross-check; >1 log unit disagreement vs MoLFormer triggers a flag for human inspection.", badge: "Cross-check" },
] as const;

const PBPK_ENGINES = [
  { id: "pksim",      title: "PK-Sim (Open Systems Pharmacology)", subtitle: "Whole-body PBPK. Outputs predicted human Cmax, AUC, t½, target occupancy. Validated against >100 reference compounds.", badge: "Default" },
  { id: "gastroplus", title: "GastroPlus",                          subtitle: "Commercial alternative. Stronger absorption modeling for BCS Class II/IV compounds. Optional vendor integration." },
] as const;

/**
 * L2 In-Silico — scaffold panel introduced by the April 2026 4-layer redesign.
 * Renders with the same two-pane layout as L1 / L4: a left input-parameters
 * sidebar where engine choices are interactively selectable (state is local
 * — engines themselves aren't wired yet), plus a right output pane that
 * documents the L1→L2 input contract, the five engine stages, and the L2→L3
 * output contract from
 * `attached_assets/HakaseBio_4Layer_Architecture_Research_*.docx` (§2.2).
 *
 * The Run button stays disabled because the engines themselves aren't wired
 * yet — by design.
 */
export function Layer2InSilicoScaffold({ layer1Ready, onContinue }: Layer2InSilicoScaffoldProps) {
  const [docking, setDocking] = useState<string>("vina");
  const [mlAffinity, setMlAffinity] = useState<Set<string>>(new Set(["molformer", "unimol"]));
  const [pbpk, setPbpk] = useState<string>("pksim");

  const toggleMl = (id: string) => {
    setMlAffinity(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT INPUT-PARAMETERS SIDEBAR ──────────────────────────────────── */}
      <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h2 className="text-[15px] font-semibold text-white">Layer 2 — In Silico</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
              Scaffold
            </span>
          </div>
          <p className="text-[12px] text-slate-500">Computational triage — docking · ML affinity / ADMET · PBPK · ranking</p>
        </div>

        <div className="flex-1 p-5 space-y-6">

          {/* Status / readiness banner */}
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
                {layer1Ready ? "L1 ready · contract satisfied" : "Awaiting L1 In Vitro completion"}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                {layer1Ready
                  ? "L1 has produced a Parquet row keyed on InChIKey with potency, ADMET, hERG, selectivity, and Cellosaurus provenance. The L2 engines below would read that row to triage candidates."
                  : "Run L1 In Vitro to populate the SMILES, primary-target Ki/IC50, ADMET panel, and Cellosaurus provenance that L2 engines consume."}
              </p>
            </div>
          </div>

          {/* DOCKING ENGINE — single-select */}
          <section>
            <ScaffoldSectionHeader icon={Atom} label="Docking Engine" />
            <div className="grid grid-cols-1 gap-2">
              {DOCKING_ENGINES.map(eng => (
                <OptionCard
                  key={eng.id}
                  title={eng.title}
                  subtitle={eng.subtitle}
                  badge={"badge" in eng ? eng.badge : undefined}
                  selected={docking === eng.id}
                  onClick={() => setDocking(eng.id)}
                />
              ))}
            </div>
            <div className="mt-2 text-[10px] text-slate-500 leading-relaxed">
              All docking poses pass through <span className="text-slate-400 font-medium">PoseBusters</span> to filter physically impossible geometries before downstream ranking.
            </div>
          </section>

          {/* ML AFFINITY + ADMET CROSS-CHECK — multi-select */}
          <section>
            <ScaffoldSectionHeader icon={Network} label="ML Affinity Model" />
            <div className="grid grid-cols-1 gap-2">
              {ML_AFFINITY_MODELS.map(m => (
                <OptionCard
                  key={m.id}
                  title={m.title}
                  subtitle={m.subtitle}
                  badge={"badge" in m ? m.badge : undefined}
                  selected={mlAffinity.has(m.id)}
                  onClick={() => toggleMl(m.id)}
                />
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-slate-400">Disagreement threshold</span>
                <span className="text-cyan-300 font-mono">&gt; 1.0 log unit</span>
              </div>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                When the two models disagree by more than this, the compound is not auto-graduated to L3 — it is queued for human review.
              </div>
            </div>
          </section>

          {/* PBPK ENGINE — single-select */}
          <section>
            <ScaffoldSectionHeader icon={Beaker} label="PBPK Projection Engine" />
            <div className="grid grid-cols-1 gap-2">
              {PBPK_ENGINES.map(eng => (
                <OptionCard
                  key={eng.id}
                  title={eng.title}
                  subtitle={eng.subtitle}
                  badge={"badge" in eng ? eng.badge : undefined}
                  selected={pbpk === eng.id}
                  onClick={() => setPbpk(eng.id)}
                />
              ))}
            </div>
          </section>

          {/* RANKING WEIGHTS */}
          <section>
            <ScaffoldSectionHeader icon={Scale} label="Composite Ranking Weights" />
            <div className="space-y-2">
              {[
                { name: "Efficacy margin (Cmax / Ki)",         weight: 40, color: "bg-cyan-400"   },
                { name: "Safety margin (hERG IC50 / Cmax)",    weight: 30, color: "bg-emerald-400"},
                { name: "FDA MRSD per Layer-2 workflow",       weight: 20, color: "bg-violet-400" },
                { name: "Off-target liability penalty",        weight: 10, color: "bg-amber-400"  },
              ].map(w => (
                <div key={w.name} className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
                  <div className="flex items-center justify-between text-[10px] mb-1.5">
                    <span className="text-slate-300">{w.name}</span>
                    <span className="text-slate-400 font-mono">{w.weight}%</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full ${w.color} opacity-60`} style={{ width: `${w.weight}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-slate-500 leading-relaxed">
              Composite score determines which compounds enter the 20–50 candidate shortlist handed to L3.
            </div>
          </section>

          {/* OUTPUT TRIAGE */}
          <section>
            <ScaffoldSectionHeader icon={Settings2} label="Triage Output" />
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Target shortlist size</span>
                <span className="text-cyan-300 font-mono">20–50 compounds</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Per-compound model cost</span>
                <span className="text-cyan-300 font-mono">$0.10–$10</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Expected wall-clock</span>
                <span className="text-cyan-300 font-mono">~minutes / cmpd</span>
              </div>
            </div>
          </section>

          {/* RUN BUTTON (disabled — engines not yet wired) */}
          <button
            type="button"
            disabled
            title="Engine integrations (Vina/GNINA/Boltz, MoLFormer/Uni-Mol2, PK-Sim) ship in a follow-on phase"
            className="w-full bg-cyan-600/20 border border-cyan-500/30 text-cyan-400/60 font-semibold h-10 rounded-lg gap-2 text-[13px] flex items-center justify-center cursor-not-allowed"
          >
            <Cpu className="w-4 h-4" />
            Run In Silico Triage (engines pending)
          </button>
          <p className="text-[10px] text-slate-500 text-center -mt-3">
            Selections above are saved locally — engine wiring ships in a follow-on phase.
          </p>

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
                Cheap computational triage between L1 wet assays and L3 Ex Vivo tissue work. Source:
                Architecture Research §2.2 + Story of the Redesign Chapter 3.
              </p>
            </div>
          </div>

          {/* L1 → L2 input contract */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-violet-400" />
              <h3 className="text-[13px] font-semibold text-white">L1 → L2 Input Contract</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Per compound, L1 hands L2 a Parquet row keyed on InChIKey:
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

          {/* The five L2 stages */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Construction className="w-4 h-4 text-amber-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 Stages — Engine Roadmap</h3>
            </div>
            <div className="space-y-2">
              {[
                { n: 1, name: "Structure preparation", detail: "Pull target from PDB or AlphaFold, fix missing residues, locate binding pocket." },
                { n: 2, name: "Docking",                detail: "AutoDock Vina + GNINA + Boltz-1 co-folding. PoseBusters filters impossible poses." },
                { n: 3, name: "ML affinity + ADMET cross-check", detail: "MoLFormer-XL, Uni-Mol2 predicted Ki vs measured L1. >1 log unit disagreement → flag." },
                { n: 4, name: "PBPK projection",         detail: "PK-Sim whole-body simulation. Predicted human Cmax, AUC, t½, target occupancy." },
                { n: 5, name: "Ranking",                 detail: "Composite score: efficacy margin (Cmax/Ki), safety margin (hERG/Cmax), MRSD." },
              ].map(stage => (
                <div key={stage.n} className="flex items-start gap-3 p-2.5 rounded-lg bg-black/20 border border-white/5">
                  <div className="w-6 h-6 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    {stage.n}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-white">{stage.name}</div>
                    <div className="text-[11px] text-slate-400 leading-relaxed mt-0.5">{stage.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* L2 → L3 output contract */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-amber-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 → L3 Output Contract</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              L2 hands L3 a ranked shortlist (typically 20–50 compounds), each carrying:
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
                "Ranking rationale (composite score breakdown)",
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
