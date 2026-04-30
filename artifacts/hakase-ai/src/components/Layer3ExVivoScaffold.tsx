import { Microscope, ArrowRight, Database, Construction, Layers, Beaker, Rabbit } from "lucide-react";

interface Layer3ExVivoScaffoldProps {
  layer2Ready: boolean;
  onContinue: () => void;
}

/**
 * L3 Ex-Vivo — scaffold panel introduced by the April 2026 4-layer redesign.
 * Documents the L2 → L3 input contract and the L3 → L4 graduation-dossier
 * output contract from `attached_assets/HakaseBio_4Layer_Architecture_Research_*.docx`
 * (§2.2). Real tissue without live animal: precision-cut tissue slices,
 * isolated perfused organs, patient-derived organoids, and microphysiological
 * systems / organ-on-chip.
 */
export function Layer3ExVivoScaffold({ layer2Ready, onContinue }: Layer3ExVivoScaffoldProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Microscope className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[20px] font-semibold text-white">Layer 3 — Ex Vivo</h2>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
                Scaffold · Pending implementation
              </span>
            </div>
            <p className="text-[13px] text-slate-400 leading-relaxed mt-1.5">
              Real tissue without a live animal — precision-cut tissue slices (PCLS), isolated
              perfused organs, patient-derived organoids, and microphysiological systems / organ-on-chip.
              <span className="text-amber-300 font-medium"> $15k–$250k per compound</span> depending on tier.
            </p>
          </div>
        </div>

        {/* Why L3 sits here — cost-curve + predictivity */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-4 h-4 text-amber-300" />
            <h3 className="text-[12px] font-semibold text-amber-200 uppercase tracking-wider">Why L3 sits between L2 and L4</h3>
          </div>
          <p className="text-[12px] text-slate-300 leading-relaxed">
            L3 is the most expensive and most predictive pre-clinical step. It sits closest to L4
            because its tissue-selectivity and dose-range readouts directly inform animal study
            design. By the time a compound reaches L3, it has already been culled through L1 wet
            assays and L2 in-silico triage — only ~20–50 compounds typically arrive here from a
            starting set in the hundreds. This is the truth oven for the pipeline.
            (Source: Architecture Research §1.2, Story of the Redesign Chapter 4.)
          </p>
        </div>

        {/* L2 → L3 input contract */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-cyan-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 → L3 Input Contract</h3>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
              layer2Ready
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-slate-600 bg-slate-800/50 text-slate-500"
            }`}>
              {layer2Ready ? "L2 ready · contract satisfied" : "Awaiting L2 In Silico completion"}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
            L2 hands L3 a ranked shortlist with predicted dose ranges, validated docking poses, and
            uncertainty estimates per prediction (see L2 → L3 contract on the L2 panel).
          </p>
        </div>

        {/* L3 modalities — what runs here */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Construction className="w-4 h-4 text-amber-400" />
            <h3 className="text-[13px] font-semibold text-white">L3 Modalities — Tissue Roadmap</h3>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
            Four ex-vivo modalities, increasing in physiological realism and cost. Each is a
            separate workflow / vendor relationship that will be wired in a follow-on phase.
          </p>
          <div className="space-y-2">
            {[
              { n: 1, name: "Precision-cut tissue slices (PCLS)", detail: "Liver, kidney, lung slices preserving native architecture for 24–96h. Cheapest L3 tier (~$15k / cmpd) and the calibration anchor for IVIVE." },
              { n: 2, name: "Patient-derived organoids",          detail: "HCMI + HUB Organoids consortium. 3D self-organising mini-organs from patient tissue. Tier: ~$30k–$80k / cmpd across at least three donor lines." },
              { n: 3, name: "Microphysiological systems (MPS) / organ-on-chip", detail: "Emulate, CN Bio, Mimetas, TissUse, InSphero. Vendor-locked data is the largest open problem in the L3 stack — partnership required. Tier: ~$60k–$180k / cmpd." },
              { n: 4, name: "Isolated perfused organs",           detail: "IPL (isolated perfused liver), IPK (kidney). Highest tier (~$120k–$250k / cmpd). Used selectively for compounds with edge-case clearance / transporter liabilities." },
            ].map(stage => (
              <div key={stage.n} className="flex items-start gap-3 p-2.5 rounded-lg bg-black/20 border border-white/5">
                <div className="w-6 h-6 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
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

        {/* L3 → L4 graduation dossier */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <ArrowRight className="w-4 h-4 text-emerald-400" />
            <h3 className="text-[13px] font-semibold text-white">L3 → L4 Graduation Dossier</h3>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
            Per surviving compound, L3 hands L4 a graduation dossier (Architecture Research §2.2,
            L3 → L4 contract):
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
            {[
              "Tissue-selectivity matrix (54 GTEx tissues × predicted margin)",
              "ADME card (F_oral, V_d, t½, primary clearance route, transporter liabilities)",
              "K_p,uu where CNS-relevant",
              "Tox flag list ranked by mechanism (mito, BSEP, hERG, OAT/OCT, neurite)",
              "Organoid efficacy panel across ≥3 patient-derived lines",
              "Cell-type-resolved scRNA response",
              "Confidence scorecard + IVIVE calibration evidence",
              "Recommended animal study design (species, route, dose range)",
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
              This panel surfaces the L3 contract from the architecture document. The four modality
              workflows above require vendor partnerships (MPS especially) and will be wired in a
              follow-on phase. Until then, L4 Animal Cohort consumes L1 outputs directly via
              allometric projection — the L3 dossier path is reserved for future graduation logic.
            </p>
          </div>
          <Beaker className="w-5 h-5 text-amber-400/60 shrink-0 mt-0.5" />
        </div>

        {/* Continue affordance — scaffold has no simulation runner, so the
             top-bar Continue strip never fires for this layer. This button
             advances to L4 Animal Cohort without marking L3 "complete" (since
             no ex-vivo experiment actually ran). */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onContinue}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-semibold transition-colors"
          >
            <Rabbit className="w-4 h-4" />
            Reviewed L3 contract — continue to L4 Animal Cohort
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

      </div>
    </div>
  );
}
