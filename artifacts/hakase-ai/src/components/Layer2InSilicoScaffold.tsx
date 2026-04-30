import { Cpu, ArrowRight, Database, Layers, Construction, Beaker, Microscope } from "lucide-react";

interface Layer2InSilicoScaffoldProps {
  layer1Ready: boolean;
  onContinue: () => void;
}

/**
 * L2 In-Silico — scaffold panel introduced by the April 2026 4-layer redesign.
 * Documents the L1 → L2 input contract and the L2 → L3 output contract from
 * `attached_assets/HakaseBio_4Layer_Architecture_Research_*.docx` (§2.2).
 *
 * The five canonical L2 stages (structure prep → docking → ML affinity / ADMET
 * cross-check → PBPK projection → ranking) are surfaced as a roadmap so that
 * an implementer can see what wet engines need to land here in the follow-on
 * phase. No simulation runner is wired yet — by design.
 */
export function Layer2InSilicoScaffold({ layer1Ready, onContinue }: Layer2InSilicoScaffoldProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Cpu className="w-6 h-6 text-cyan-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[20px] font-semibold text-white">Layer 2 — In Silico</h2>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
                Scaffold · Pending implementation
              </span>
            </div>
            <p className="text-[13px] text-slate-400 leading-relaxed mt-1.5">
              Cheap computational triage that consumes L1 In Vitro outputs to project human PK/PD,
              refine docking, and decide which compounds graduate to wet-tissue work in L3 Ex Vivo.
              <span className="text-cyan-300 font-medium"> ~$0.10–$10 per compound per model.</span>
            </p>
          </div>
        </div>

        {/* Why L2 sits here — cost-curve rationale */}
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-4 h-4 text-cyan-300" />
            <h3 className="text-[12px] font-semibold text-cyan-200 uppercase tracking-wider">Why L2 sits between L1 and L3</h3>
          </div>
          <p className="text-[12px] text-slate-300 leading-relaxed">
            The cost curve drives the design. L2 is the cheapest filter we have, and placing it
            immediately downstream of L1 (the cheapest data source) means hundreds of L1 hits can be
            culled before we spend any L3 ($15k–$250k / cmpd) or L4 (hundreds of thousands per study)
            money. The previous architecture ran computational work after animal studies, inverting
            the cost / value curve — the new ordering puts work where it compounds rather than
            overlaps. (Source: Architecture Research §1.2.)
          </p>
        </div>

        {/* L1 → L2 input contract */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-violet-400" />
              <h3 className="text-[13px] font-semibold text-white">L1 → L2 Input Contract</h3>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
              layer1Ready
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-slate-600 bg-slate-800/50 text-slate-500"
            }`}>
              {layer1Ready ? "L1 ready · contract satisfied" : "Awaiting L1 In Vitro completion"}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
            Per compound, L1 must hand L2 a Parquet row keyed on InChIKey with the following fields
            (Architecture Research §2.2, L1 → L2 contract):
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

        {/* The five L2 stages — roadmap */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Construction className="w-4 h-4 text-amber-400" />
            <h3 className="text-[13px] font-semibold text-white">L2 Stages — Engine Roadmap</h3>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
            Five things happen at L2 in order (Story of the Redesign, Chapter 3). Each is a separate
            engine slot that will be wired in a follow-on phase.
          </p>
          <div className="space-y-2">
            {[
              { n: 1, name: "Structure preparation", detail: "Pull target from PDB or AlphaFold, fix missing residues, locate binding pocket." },
              { n: 2, name: "Docking",                detail: "AutoDock Vina + GNINA + Boltz-1 co-folding. PoseBusters filters physically impossible poses." },
              { n: 3, name: "ML affinity + ADMET cross-check", detail: "MoLFormer-XL, Uni-Mol2 predicted Ki vs measured L1. >1 log unit disagreement → flag for inspection." },
              { n: 4, name: "PBPK projection",         detail: "PK-Sim whole-body simulation. Outputs predicted human Cmax, AUC, t½, target occupancy." },
              { n: 5, name: "Ranking",                 detail: "Composite score: efficacy margin (Cmax/Ki), safety margin (hERG/Cmax), MRSD per FDA workflow." },
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
            L2 must hand L3 a ranked shortlist (typically 20–50 compounds from a starting set in the
            hundreds), each carrying the fields below as a CSV plus per-compound JSON keyed on
            Cellosaurus CVCL where relevant.
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

        {/* Footer status */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
          <Construction className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[12px] font-semibold text-amber-200">Implementation status</div>
            <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
              This panel surfaces the L2 contract from the architecture document so downstream layers
              can be designed against a stable interface. The five engine slots above will be wired
              in a follow-on phase. Until then, L1 In Vitro feeds directly into L4 Animal Cohort via
              the existing cascade gate — L2 / L3 are visible but inert.
            </p>
          </div>
          <Beaker className="w-5 h-5 text-amber-400/60 shrink-0 mt-0.5" />
        </div>

        {/* Continue affordance — scaffold has no simulation runner, so the
             top-bar Continue strip never fires for this layer. This button
             advances to L3 Ex Vivo without marking L2 "complete" (since no
             simulation actually ran). */}
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
  );
}
