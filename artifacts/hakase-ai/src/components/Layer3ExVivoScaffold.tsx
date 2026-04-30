import { useState } from "react";
import { Microscope, ArrowRight, Database, Construction, Beaker, Rabbit, Layers, Users2, FlaskConical, Activity, AlertCircle, Sparkles } from "lucide-react";

interface Layer3ExVivoScaffoldProps {
  layer2Ready: boolean;
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
          ? "border-amber-500/50 bg-amber-500/8 ring-1 ring-amber-500/30"
          : "border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-[12px] font-semibold text-white">{title}</div>
        {badge && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 shrink-0">
            {badge}
          </span>
        )}
      </div>
      <div className="text-[10px] text-slate-500 leading-relaxed">{subtitle}</div>
    </button>
  );
}

function PillCard({
  label,
  detail,
  selected,
  onClick,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border p-2.5 transition-colors cursor-pointer ${
        selected
          ? "border-amber-500/50 bg-amber-500/8 ring-1 ring-amber-500/30"
          : "border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
      }`}
    >
      <div className="text-[11px] font-semibold text-white">{label}</div>
      <div className="text-[9px] text-slate-500 leading-relaxed mt-0.5">{detail}</div>
    </button>
  );
}

const TIERS = [
  { id: "pcls",     title: "Precision-cut tissue slices (PCLS)", subtitle: "Liver, kidney, lung slices. Native architecture preserved 24–96h. Cheapest L3 tier and the calibration anchor for IVIVE.",          badge: "$15k / cmpd" },
  { id: "organoid", title: "Patient-derived organoids",          subtitle: "HCMI + HUB Organoids consortium. 3D self-organising mini-organs from patient tissue. Required across ≥3 donor lines.",                  badge: "$30–80k" },
  { id: "mps",      title: "Microphysiological systems / organ-on-chip", subtitle: "Emulate, CN Bio, Mimetas, TissUse, InSphero. Vendor-locked data is the largest open problem in the L3 stack.",            badge: "$60–180k" },
  { id: "perfused", title: "Isolated perfused organs",           subtitle: "IPL (liver), IPK (kidney). Highest tier. Used selectively for compounds with edge-case clearance / transporter liabilities.",         badge: "$120–250k" },
] as const;

const ORGANS = [
  { id: "liver",  name: "Liver",   detail: "CYP, transporters, hepatotox" },
  { id: "kidney", name: "Kidney",  detail: "OAT/OCT, tubular tox" },
  { id: "lung",   name: "Lung",    detail: "Inhaled / pulmonary safety" },
  { id: "heart",  name: "Heart",   detail: "Contractility, hERG context" },
  { id: "cns",    name: "CNS",     detail: "BBB penetration (K_p,uu)" },
  { id: "gut",    name: "Gut",     detail: "Absorption, gut-on-chip" },
] as const;

const VENDORS = [
  { id: "emulate",  title: "Emulate",  subtitle: "Liver-Chip, Intestine-Chip, Kidney-Chip. Most published validation." },
  { id: "cnbio",    title: "CN Bio",   subtitle: "PhysioMimix multi-organ. Strongest hepatotox dataset." },
  { id: "mimetas",  title: "Mimetas",  subtitle: "OrganoPlate 3-lane kidney + gut. Highest throughput." },
  { id: "tissuse",  title: "TissUse",  subtitle: "HUMIMIC multi-organ chip. Strongest cross-organ PK." },
  { id: "insphero", title: "InSphero", subtitle: "3D InSight liver microtissues. Long-term (28d+) repeat dosing." },
] as const;

const READOUTS = [
  { id: "scrna",     name: "scRNA-seq",     detail: "Cell-type-resolved response" },
  { id: "lcms",      name: "LC-MS",         detail: "Compound + metabolite quant" },
  { id: "imaging",   name: "Imaging",       detail: "High-content confocal" },
  { id: "function",  name: "Functional",    detail: "Albumin, urea, TEER, contraction" },
  { id: "cytokine",  name: "Cytokines",     detail: "Multiplex Luminex panel" },
  { id: "tox",       name: "Tox markers",   detail: "ALT/AST, LDH, mito stress" },
] as const;

/**
 * L3 Ex-Vivo — scaffold panel introduced by the April 2026 4-layer redesign.
 * Renders with the same two-pane layout as L1 / L4: a left input-parameters
 * sidebar where modality / organ / vendor / readout choices are interactively
 * selectable (state is local — modality workflows aren't wired yet), plus a
 * right output pane that documents the L2→L3 input contract and the L3→L4
 * graduation dossier from the Architecture Research doc (§2.2).
 *
 * Real tissue without a live animal: precision-cut tissue slices, isolated
 * perfused organs, patient-derived organoids, microphysiological systems.
 */
export function Layer3ExVivoScaffold({ layer2Ready, onContinue }: Layer3ExVivoScaffoldProps) {
  const [tier,     setTier]     = useState<string>("pcls");
  const [organs,   setOrgans]   = useState<Set<string>>(new Set(["liver"]));
  const [vendor,   setVendor]   = useState<string>("emulate");
  const [readouts, setReadouts] = useState<Set<string>>(new Set(["scrna", "lcms"]));

  const toggleOrgan   = (id: string) => setOrgans(prev   => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleReadout = (id: string) => setReadouts(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const showVendorSection = tier === "mps";

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT INPUT-PARAMETERS SIDEBAR ──────────────────────────────────── */}
      <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Microscope className="w-4 h-4 text-amber-400" />
            <h2 className="text-[15px] font-semibold text-white">Layer 3 — Ex Vivo</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
              Scaffold
            </span>
          </div>
          <p className="text-[12px] text-slate-500">Real tissue without live animal — PCLS · organoids · MPS · perfused organs</p>
        </div>

        <div className="flex-1 p-5 space-y-6">

          {/* Status / readiness banner */}
          <div className={`rounded-xl border p-3 flex items-start gap-2.5 ${
            layer2Ready
              ? "border-emerald-500/25 bg-emerald-500/5"
              : "border-amber-500/25 bg-amber-500/5"
          }`}>
            {layer2Ready ? (
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <div className={`text-[11px] font-semibold ${layer2Ready ? "text-emerald-300" : "text-amber-300"}`}>
                {layer2Ready ? "L2 ready · contract satisfied" : "Awaiting L2 In Silico completion"}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                {layer2Ready
                  ? "L2 has produced a 20–50 compound shortlist with predicted dose ranges, validated docking poses, and uncertainty estimates. The L3 modalities below would consume that shortlist."
                  : "L2 In Silico is currently a scaffold — its triage shortlist is not yet generated. Until then, L3 modality configuration remains illustrative."}
              </p>
            </div>
          </div>

          {/* TISSUE TIER — single-select */}
          <section>
            <ScaffoldSectionHeader icon={Layers} label="Tissue Tier" />
            <div className="grid grid-cols-1 gap-2">
              {TIERS.map(t => (
                <OptionCard
                  key={t.id}
                  title={t.title}
                  subtitle={t.subtitle}
                  badge={t.badge}
                  selected={tier === t.id}
                  onClick={() => setTier(t.id)}
                />
              ))}
            </div>
          </section>

          {/* ORGAN SELECTION — multi-select */}
          <section>
            <ScaffoldSectionHeader icon={Activity} label="Organ Selection" />
            <div className="grid grid-cols-2 gap-2">
              {ORGANS.map(o => (
                <PillCard
                  key={o.id}
                  label={o.name}
                  detail={o.detail}
                  selected={organs.has(o.id)}
                  onClick={() => toggleOrgan(o.id)}
                />
              ))}
            </div>
          </section>

          {/* DONOR LINES — display only */}
          <section>
            <ScaffoldSectionHeader icon={Users2} label="Donor Diversity" />
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Patient-derived donor lines</span>
                <span className="text-amber-300 font-mono">≥ 3 (minimum)</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Replicates per condition</span>
                <span className="text-amber-300 font-mono">3 technical · 3 biological</span>
              </div>
              <div className="text-[10px] text-slate-500 leading-relaxed pt-1 border-t border-white/5">
                HCMI / HUB Organoids consortia provide validated patient-derived lines with full clinical metadata.
              </div>
            </div>
          </section>

          {/* VENDOR — only relevant for MPS tier — single-select */}
          {showVendorSection ? (
            <section>
              <ScaffoldSectionHeader icon={FlaskConical} label="MPS Vendor" />
              <div className="grid grid-cols-1 gap-2">
                {VENDORS.map(v => (
                  <OptionCard
                    key={v.id}
                    title={v.title}
                    subtitle={v.subtitle}
                    selected={vendor === v.id}
                    onClick={() => setVendor(v.id)}
                  />
                ))}
              </div>
              <div className="mt-2 text-[10px] text-amber-400/80 leading-relaxed">
                Vendor partnerships are the largest open problem in the L3 stack — data formats are largely vendor-locked.
              </div>
            </section>
          ) : (
            <section>
              <ScaffoldSectionHeader icon={FlaskConical} label="MPS Vendor" />
              <div className="rounded-lg border border-white/8 bg-white/[0.01] p-3 text-[10px] text-slate-500 leading-relaxed">
                Vendor selection only applies to the <span className="text-slate-400 font-medium">Microphysiological systems / organ-on-chip</span> tier. Switch tiers above to configure a vendor.
              </div>
            </section>
          )}

          {/* READOUTS — multi-select */}
          <section>
            <ScaffoldSectionHeader icon={Database} label="Readouts" />
            <div className="grid grid-cols-2 gap-2">
              {READOUTS.map(r => (
                <PillCard
                  key={r.id}
                  label={r.name}
                  detail={r.detail}
                  selected={readouts.has(r.id)}
                  onClick={() => toggleReadout(r.id)}
                />
              ))}
            </div>
          </section>

          {/* RUN BUTTON (disabled — vendor wiring pending) */}
          <button
            type="button"
            disabled
            title="Modality workflows require vendor partnerships and ship in a follow-on phase"
            className="w-full bg-amber-600/20 border border-amber-500/30 text-amber-400/60 font-semibold h-10 rounded-lg gap-2 text-[13px] flex items-center justify-center cursor-not-allowed"
          >
            <Microscope className="w-4 h-4" />
            Run Ex Vivo Study (vendor wiring pending)
          </button>
          <p className="text-[10px] text-slate-500 text-center -mt-3">
            Selections above are saved locally — modality workflows ship in a follow-on phase.
          </p>

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
              <h2 className="text-[18px] font-semibold text-white">L3 — Ex Vivo Contract</h2>
              <p className="text-[12px] text-slate-400 leading-relaxed mt-0.5">
                Most expensive and most predictive pre-clinical step ($15k–$250k / cmpd). Sits closest to L4.
                Source: Architecture Research §2.2 + Story of the Redesign Chapter 4.
              </p>
            </div>
          </div>

          {/* L3 modalities */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Construction className="w-4 h-4 text-amber-400" />
              <h3 className="text-[13px] font-semibold text-white">L3 Modalities — Tissue Roadmap</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Four ex-vivo modalities, increasing in physiological realism and cost:
            </p>
            <div className="space-y-2">
              {[
                { n: 1, name: "Precision-cut tissue slices (PCLS)", detail: "Liver, kidney, lung slices preserving native architecture for 24–96h. Cheapest L3 tier (~$15k / cmpd) and the calibration anchor for IVIVE." },
                { n: 2, name: "Patient-derived organoids",          detail: "HCMI + HUB Organoids consortium. 3D self-organising mini-organs. Tier: ~$30k–$80k / cmpd across ≥3 donor lines." },
                { n: 3, name: "Microphysiological systems (MPS) / organ-on-chip", detail: "Emulate, CN Bio, Mimetas, TissUse, InSphero. Vendor-locked data is the largest open problem in the L3 stack — partnership required. Tier: ~$60k–$180k / cmpd." },
                { n: 4, name: "Isolated perfused organs",           detail: "IPL (isolated perfused liver), IPK (kidney). Highest tier (~$120k–$250k / cmpd). Used selectively for edge-case clearance / transporter liabilities." },
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
              Per surviving compound, L3 hands L4 a graduation dossier:
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

          {/* Implementation footnote */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <Beaker className="w-5 h-5 text-amber-400/60 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-[12px] font-semibold text-amber-200">Until L3 engines are wired</div>
              <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                L4 Animal Cohort consumes L1 outputs directly via allometric projection — the L3 dossier path is reserved for future graduation logic.
              </p>
            </div>
          </div>

          {/* Continue */}
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

    </div>
  );
}
