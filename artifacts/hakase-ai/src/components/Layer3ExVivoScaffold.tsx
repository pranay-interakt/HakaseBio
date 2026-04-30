import { Microscope, ArrowRight, Database, Shield, Sparkles, AlertCircle, AlertTriangle, CircleDot, FileText } from "lucide-react";
import type { SimResults } from "@/lib/admet";

interface Layer3ExVivoScaffoldProps {
  layer2Ready: boolean;
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
 * L3 modality reference list — content taken from §5 of
 * `attached_assets/HakaseBio_4Layer_Architecture_Research_*.docx`
 * (paraphrased; cited numbers and the Ewart-2022 sensitivity figure
 * are preserved as-stated by the doc).
 *
 * No L3 wet vendor or computational engine is wired in this product.
 * Every modality below is a *reference candidate* with the doc's own
 * provenance / licence note attached, NOT a user choice.
 *
 * Cost figures are intentionally not asserted because the doc only
 * cites a single concrete number (ATCC organoid lines $2–6k / line)
 * — fabricating the rest would violate the no-assumptions policy.
 */
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
    summary: "Multi-tissue chips with media flow + mechanical cues. All vendor data is walled-garden — public footprint is qualification papers.",
    sources: [
      { name: "Emulate (Liver-/Brain-/Intestine-/Lung-Chip S1)", note: "Liver-Chip qualification, Ewart 2022: 87% sensitivity vs Tox21 — best published hepatotox MPS to date" },
      { name: "CN Bio (PhysioMimix OOC, Liver-Chip)",            note: "strong on liver clearance + first-pass metabolism" },
      { name: "Mimetas (OrganoPlate 3-lane / Graft)",            note: "higher throughput (96-well), tubule + BBB models" },
      { name: "TissUse (HUMIMIC Chip2 / Chip4 / ChipX)",         note: "multi-organ co-culture, ADME-T focused" },
      { name: "InSphero (Akura Flow / 96-well 3D)",              note: "scaffold-free spheroids, high-throughput hepatotox" },
      { name: "MPS-Database (FDA / U. Pittsburgh DILI consortium)", note: "only public MPS dataset of meaningful size, primarily liver + kidney chips" },
      { name: "IQ-MPS (IQ Consortium MPS Affiliate)",            note: "pharma-curated qualification datasets — partnership target" },
    ],
  },
] as const;

const L3_COMPUTE = [
  { name: "httk (R, EPA CompTox)",          license: "GPL-3", note: "Default open IVIVE engine — Caco-2 / PPB / Clint → human plasma C_ss, AUC, equivalent doses" },
  { name: "Tabula Sapiens v2 (CZ Biohub)",  license: "CC-BY 4.0", note: "Deconvolution reference for organoid / PCLS samples; tissue-selectivity scoring" },
  { name: "Human Cell Atlas / CELLxGENE",   license: "open API", note: "Identifies which cell types are actually present in a given organoid system — most lack immune / vascular compartments" },
  { name: "GTEx v10",                       license: "open metadata · dbGaP genotypes", note: "IVIVE scaling and target-tissue expression priors" },
] as const;

function ModalityCard({ modality }: { modality: (typeof L3_MODALITIES)[number] }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-start gap-2 mb-1.5">
        <Microscope className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-[12px] font-semibold text-white">{modality.name}</div>
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/8 text-rose-300">No vendor wired</span>
          </div>
          <div className="text-[10px] text-slate-500 leading-relaxed mt-0.5">{modality.summary}</div>
        </div>
      </div>
      <div className="pl-5 space-y-1 mt-2">
        {modality.sources.map(s => (
          <div key={s.name} className="flex items-baseline gap-2 text-[10px]">
            <CircleDot className="w-2 h-2 text-slate-600 shrink-0 translate-y-0.5" />
            <span className="text-slate-300 font-medium">{s.name}</span>
            <span className="text-slate-500">— {s.note}</span>
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
      <span className={value === "—" ? "text-slate-600 text-[11px] font-mono" : "text-amber-300 text-[11px] font-mono"}>{value}</span>
    </div>
  );
}

/**
 * L3 Ex-Vivo — scaffold panel introduced by the April 2026 4-layer redesign.
 * Same two-pane layout as L1 / L2 / L4. Honest status panel: no L3 wet vendor
 * is wired and L2 isn't either, so the upstream values shown are L1 outputs
 * (which is what L4 also currently consumes via direct cascade).
 */
export function Layer3ExVivoScaffold({ layer2Ready, simResults, onContinue }: Layer3ExVivoScaffoldProps) {
  const hasL1 = !!simResults;

  return (
    <div className="flex-1 flex overflow-hidden">

      {/* ── LEFT STATUS / INPUTS PANEL ─────────────────────────────────────── */}
      <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Microscope className="w-4 h-4 text-amber-400" />
            <h2 className="text-[15px] font-semibold text-white">Layer 3 — Ex Vivo</h2>
            <span className="ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
              Scaffold
            </span>
          </div>
          <p className="text-[12px] text-slate-500">PCLS · perfused organs · organoids · MPS / organ-on-chip — modality reference; no wet vendor wired</p>
        </div>

        <div className="flex-1 p-5 space-y-6">

          {/* Honest banner */}
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-[11px] font-semibold text-rose-300">No L3 wet vendor or compute engine is wired in this build</div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                L2 is not wired either, so the upstream record shown below is what L1 actually produced —
                this is the same record L4 currently consumes via direct cascade. Modalities and reference
                resources below are sourced verbatim from §5 of the architecture doc.
              </p>
            </div>
          </div>

          {/* L2 readiness */}
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
                {layer2Ready ? "L2 contract acknowledged" : "L2 contract not yet reviewed"}
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed mt-1">
                L2 produces no record today. Upstream evidence below is the live L1 output.
              </p>
            </div>
          </div>

          {/* LIVE UPSTREAM (L1) INPUTS */}
          <section>
            <ScaffoldSectionHeader icon={Database} label="Upstream evidence (live from L1)" badge={hasL1 ? "Live" : "Pending"} />
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
              <L1OutputRow
                label="Compound"
                source="L1 / chemistry.ts"
                value={simResults ? simResults.molName : "—"}
              />
              <L1OutputRow
                label="UniProt target"
                source="L1 / UniProt KB"
                value={simResults ? simResults.uniprotId : "—"}
              />
              <L1OutputRow
                label="Predicted pKd"
                source="ai-service / DeepDTA-style"
                value={simResults ? `${simResults.binding.primaryKd.toFixed(1)} nM` : "—"}
              />
              <L1OutputRow
                label="Hepato-tox alerts"
                source="bioactivationEngine SMARTS"
                value={simResults ? `${simResults.toxAlerts.filter(t => t.category === "Hepatotox" || t.category === "DILI").length}` : "—"}
              />
              <L1OutputRow
                label="hERG / cardiac alerts"
                source="cardiotox RF + heuristic"
                value={simResults ? `${simResults.toxAlerts.filter(t => t.category === "hERG").length}` : "—"}
              />
              <L1OutputRow
                label="Organ-risk fingerprint"
                source="L1 / admet.ts"
                value={simResults ? `${simResults.organs.length} organs scored` : "—"}
              />
              <L1OutputRow
                label="Go / No-Go"
                source="L1 cascade gate"
                value={simResults ? simResults.goNogo : "—"}
              />
            </div>
            {!hasL1 && (
              <p className="text-[10px] text-slate-500 leading-relaxed mt-2">Run L1 to populate upstream evidence.</p>
            )}
          </section>

          {/* MODALITIES */}
          <section>
            <ScaffoldSectionHeader icon={Microscope} label="L3 Modalities (architecture doc §5.1)" badge="Reference" />
            <div className="space-y-2">
              {L3_MODALITIES.map(m => <ModalityCard key={m.name} modality={m} />)}
            </div>
          </section>

          {/* COMPUTE FRAMEWORKS */}
          <section>
            <ScaffoldSectionHeader icon={FileText} label="L3 Compute Frameworks (§5.2)" badge="Not wired" />
            <div className="space-y-1.5">
              {L3_COMPUTE.map(c => (
                <div key={c.name} className="rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold text-white">{c.name}</span>
                    <span className="text-[9px] uppercase tracking-wider text-slate-500">{c.license}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 leading-relaxed mt-0.5">{c.note}</div>
                </div>
              ))}
            </div>
          </section>

          {/* RUN BUTTON — disabled */}
          <button
            type="button"
            disabled
            title="No L3 wet vendor or compute engine integration ships in this build"
            className="w-full bg-rose-600/15 border border-rose-500/25 text-rose-400/70 font-semibold h-10 rounded-lg gap-2 text-[13px] flex items-center justify-center cursor-not-allowed"
          >
            <Microscope className="w-4 h-4" />
            Run L3 Ex-Vivo Study — no vendor wired
          </button>

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
                Real human / animal tissue, no live animals. Most predictive and most data-poor pre-clinical layer.
                Source: Architecture Research §5 · No vendor or engine is wired in this build.
              </p>
            </div>
          </div>

          {/* L2 → L3 input contract — sourced from the doc */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-violet-400" />
              <h3 className="text-[13px] font-semibold text-white">L2 → L3 Input Contract</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              When L2 is wired, each shortlisted compound would arrive with the bundle described in the doc:
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                "Predicted human dose range",
                "Predicted unbound Cmax + AUC at each candidate dose",
                "PoseBusters-cleared docking poses",
                "Off-target liability flags",
                "Predicted IVIVE-derived clearance",
                "Confidence + uncertainty per prediction",
                "Selection rationale",
                "L1 wet-assay provenance carried forward",
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
              <h3 className="text-[13px] font-semibold text-white">L3 → L4 Graduation Dossier</h3>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              When wired, L3 would hand L4 a per-compound dossier with the items listed in the doc — no sample counts, costs, or pass-thresholds are asserted by this product:
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
              {[
                "Tissue-source provenance + Cellosaurus CVCL accession",
                "Donor / patient demographic strata",
                "Concentration–response in matched human + rodent tissue",
                "Tissue-selectivity index (efficacious vs background)",
                "Mechanistic biomarkers (transcriptomic / proteomic where run)",
                "Predicted human-equivalent dose (IVIVE-scaled)",
                "Confidence + replicate metadata",
                "Tox / clearance flags carried into L4 dose-finding",
              ].map(field => (
                <div key={field} className="flex items-center gap-2 border-b border-white/5 py-1">
                  <Shield className="w-3 h-3 text-slate-600 shrink-0" />
                  <span className="text-slate-300">{field}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Honest bottom-line note */}
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-300 leading-relaxed">
              <span className="font-semibold text-amber-300">Bottom line on vendor data (doc §5.1.4):</span> all L3 wet vendors run walled-garden datasets — public footprint is qualification papers. No live vendor integration ships in this build.
            </p>
          </div>

          {/* Continue */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={onContinue}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[12px] font-semibold transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              Reviewed L3 contract — continue to L4 Animal Cohort
            </button>
          </div>

        </div>
      </div>

    </div>
  );
}
