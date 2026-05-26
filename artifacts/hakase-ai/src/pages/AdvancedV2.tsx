import { NavBar } from "@/components/NavBar";

const LAYERS = [
  {
    id: "L1",
    name: "In Vitro Twin",
    color: "violet" as const,
    upgrades: [
      {
        label: "Deep ADMET Scoring",
        status: "v2",
        desc: "Transformer model trained on tens of millions of molecules. Goes beyond physicochemical rules to capture scaffold-level ADMET patterns with per-axis confidence intervals.",
      },
      {
        label: "Protein-Aware Binding",
        status: "v2",
        desc: "ESM-2 protein language model embeddings paired with an attention-based affinity predictor. Coverage expands from ~20 common targets to thousands of UniProt entries.",
      },
      {
        label: "Per-Organ Toxicity Models",
        status: "v2",
        desc: "Specialized cardiac, hepatic, renal, and CNS models with individual confidence intervals — replacing the current rule-based organ-risk heatmap.",
      },
      {
        label: "3D Conformer Generation",
        status: "v2",
        desc: "Browser-side ETKDG conformer generation for accurate 3D structure embedding, enabling geometry-aware fingerprints and downstream docking poses.",
      },
    ],
  },
  {
    id: "L2",
    name: "Confirmation Layer",
    color: "blue" as const,
    upgrades: [
      {
        label: "ESM2 Druggability + Pocket Detection",
        status: "v2",
        desc: "ESM2 protein language model embeddings with a druggability head, paired with FPocket-derived binding-site descriptors. Replaces target-class heuristics with structure-aware scoring per UniProt entry.",
      },
      {
        label: "AutoDock Vina Docking Service",
        status: "v2",
        desc: "Server-side AutoDock Vina 1.2.7 with OpenBabel + RDKit pose preparation. Top-N poses with binding energy, contact maps, and a structural source-quality tier.",
      },
      {
        label: "FEP Free-Energy Refinement (RunPod)",
        status: "v2",
        desc: "Opt-in alchemical FEP on RunPod GPU (~24 GPU-h, cost-confirmed before launch). Replaces ML affinity with physics-grounded ΔG when the cascade gate calls for it.",
      },
      {
        label: "Ex-Vivo Evidence Ingestion",
        status: "planned",
        desc: "Structured override path for substrate-side evidence: literature (DOI/PMID for this compound or a Tanimoto ≥ 0.4 congener) and in-house (bench / CRO measurement with assay method + lab + date). Promotes the row tier to LITERATURE or IN-HOUSE — both satisfy the IVIVE cross-species rule and trump downstream ML in the cascade gate.",
      },
    ],
  },
  {
    id: "L3",
    name: "Animal Cohort",
    color: "amber" as const,
    upgrades: [
      {
        label: "Physiologically-Based PK (Full PBPK)",
        status: "v2",
        desc: "18-compartment whole-body PBPK model replacing the current 2-compartment RK4 solver. Species-specific parameters for rat, dog, monkey, and human from PK-Sim databases.",
      },
      {
        label: "Formulation Science Engine v2",
        status: "v2",
        desc: "ML-predicted dissolution profiles for 12 FDA-IIG-compliant formulation classes. BCS-aware solubility enhancement prediction trained on commercial formulation datasets.",
      },
      {
        label: "Allometric Scaling with Uncertainty",
        status: "v2",
        desc: "Bootstrap-resampled allometric scaling with species-specific correction factors. Human-equivalent dose recommendations include 90% credible intervals per ICH M3(R2).",
      },
      {
        label: "In Vitro–In Vivo Correlation (IVIVC)",
        status: "planned",
        desc: "IVIVC Level A/B/C prediction from dissolution data to in-vivo absorption profiles. Bridges formulation bench data to PBPK simulations automatically.",
      },
    ],
  },
  {
    id: "L4",
    name: "First-In-Human Readiness",
    color: "emerald" as const,
    upgrades: [
      {
        label: "MABEL Calculator with Target-Engagement Priors",
        status: "v2",
        desc: "MABEL-biased starting-dose calculator per FDA 2005 / EMA 2017. Integrates QSP/PD target-engagement priors from L2 to bias the dose floor when target engagement is the binding constraint.",
      },
      {
        label: "IND Gate Auto-Evaluator",
        status: "v2",
        desc: "Automated check of GLP toxicology coverage, CMC readiness, Investigator's Brochure outline, and Pre-IND prerequisites. Each gap surfaces as a HAIOps flag with a remediation path — never a silent waiver.",
      },
      {
        label: "Phase 1 Planner — Adaptive Cohorts",
        status: "v2",
        desc: "derivePhase1Defaults extends to BOIN / mTPI-2 escalation rules with per-cohort stopping criteria. Clinician-in-the-loop owns every override; HAIOps logs every change.",
      },
      {
        label: "PreClinicalPackage Regulator Export",
        status: "planned",
        desc: "Export the sealed PreClinicalPackage v2.0.0 as an FDA eCTD-compatible submission bundle. Tamper-evident manifests with full HAIOps provenance for CRO and regulator ingestion.",
      },
    ],
  },
];

const PHASES = [
  {
    phase: "Phase 1",
    label: "Core AI Backbone",
    status: "In Progress",
    color: "violet",
    items: [
      "Deep ADMET transformer model (L1)",
      "ESM2 druggability + pocket detection (L2)",
      "AutoDock Vina docking service (L2)",
      "MABEL calculator with QSP/PD priors (L4)",
    ],
  },
  {
    phase: "Phase 2",
    label: "Advanced Simulation",
    status: "Planned",
    color: "blue",
    items: [
      "FEP free-energy refinement on RunPod (L2)",
      "Full 18-compartment PBPK (L3)",
      "Allometric scaling with bootstrap CIs (L3)",
      "IND gate auto-evaluator (L4)",
    ],
  },
  {
    phase: "Phase 3",
    label: "Ecosystem Integration",
    status: "Roadmap",
    color: "emerald",
    items: [
      "Ex-vivo evidence ingestion (L2)",
      "IVIVC Level A/B/C prediction (L3)",
      "Phase 1 Planner adaptive cohorts (L4)",
      "PreClinicalPackage regulator export (L4)",
    ],
  },
];

const colorMap = {
  violet: {
    badge: "bg-violet-500/10 border-violet-500/25 text-violet-400",
    ring: "border-violet-500/15 bg-violet-500/4",
    label: "text-violet-400",
    dot: "bg-violet-400",
    id: "border-violet-500/40 bg-violet-500/10 text-violet-400",
    bar: "bg-violet-500",
  },
  amber: {
    badge: "bg-amber-500/10 border-amber-500/25 text-amber-400",
    ring: "border-amber-500/15 bg-amber-500/4",
    label: "text-amber-400",
    dot: "bg-amber-400",
    id: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    bar: "bg-amber-500",
  },
  blue: {
    badge: "bg-blue-500/10 border-blue-500/25 text-blue-400",
    ring: "border-blue-500/15 bg-blue-500/4",
    label: "text-blue-400",
    dot: "bg-blue-400",
    id: "border-blue-500/40 bg-blue-500/10 text-blue-400",
    bar: "bg-blue-500",
  },
  emerald: {
    badge: "bg-emerald-500/10 border-emerald-500/25 text-emerald-400",
    ring: "border-emerald-500/15 bg-emerald-500/4",
    label: "text-emerald-400",
    dot: "bg-emerald-400",
    id: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    bar: "bg-emerald-500",
  },
};

const statusStyle: Record<string, string> = {
  v2:      "bg-violet-500/10 border border-violet-500/30 text-violet-400",
  planned: "bg-slate-500/10 border border-slate-500/20 text-slate-500",
};

const phaseStatusStyle: Record<string, string> = {
  "In Progress": "bg-violet-500/10 border border-violet-500/30 text-violet-400",
  "Planned":     "bg-blue-500/10 border border-blue-500/25 text-blue-400",
  "Roadmap":     "bg-slate-500/10 border border-slate-500/20 text-slate-500",
};

export function AdvancedV2() {
  return (
    <div className="min-h-screen bg-[#070a12] text-white">
      <NavBar />

      {/* Hero */}
      <section className="relative z-10 pt-32 pb-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-violet-500/6 blur-[100px]" />
        </div>
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/25 bg-violet-500/8 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-violet-400 tracking-widest uppercase">HakaseAI v2 Roadmap</span>
          </div>
          <h1 className="text-[48px] md:text-[60px] font-black tracking-tight text-white leading-none mb-6">
            Advanced AI Models<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-blue-400 to-emerald-400">
              Across All 4 Layers
            </span>
          </h1>
          <p className="text-[16px] text-slate-400 leading-relaxed max-w-2xl mx-auto">
            Every layer is being upgraded with a dedicated deep-learning or physics-grounded model — from ML-augmented ADMET to ESM2 druggability, AutoDock Vina docking, opt-in FEP refinement, full PBPK, and the MABEL-biased Phase 1 Planner.
            50+ models evaluated. 16 upgrade modules. 3-phase rollout.
            SMILES stays in the browser; the AI Service only ever sees fingerprints.
          </p>
          <div className="mt-8 flex items-center justify-center gap-6 flex-wrap text-[13px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400 inline-block" /> 12 v2 upgrades</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-500 inline-block" /> 4 planned modules</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> 3-phase rollout</span>
          </div>
        </div>
      </section>

      {/* Layer upgrade cards */}
      <section className="relative z-10 py-16 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-[28px] font-black text-white mb-3">Per-Layer AI Upgrades</h2>
            <p className="text-[14px] text-slate-500 max-w-xl mx-auto">Each of the 4 simulation layers gets its own dedicated AI model suite — replacing rule-based engines with trained neural architectures.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {LAYERS.map((layer) => {
              const c = colorMap[layer.color];
              return (
                <div key={layer.id} className={`rounded-2xl border p-6 ${c.ring}`}>
                  <div className="flex items-center gap-3 mb-5">
                    <div className={`w-9 h-9 rounded-full border flex items-center justify-center text-[11px] font-black ${c.id}`}>
                      {layer.id}
                    </div>
                    <div>
                      <div className={`text-[10px] font-semibold uppercase tracking-widest ${c.label}`}>{layer.id}</div>
                      <div className="text-[15px] font-bold text-white">{layer.name}</div>
                    </div>
                    <div className="ml-auto">
                      <div className={`w-2 h-2 rounded-full ${c.dot}`} />
                    </div>
                  </div>

                  <div className="space-y-4">
                    {layer.upgrades.map((u) => (
                      <div key={u.label} className="border-t border-white/6 pt-4 first:border-0 first:pt-0">
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <span className="text-[13px] font-semibold text-white">{u.label}</span>
                          <span className={`shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wide ${statusStyle[u.status]}`}>
                            {u.status === "v2" ? "v2" : "planned"}
                          </span>
                        </div>
                        <p className="text-[12px] text-slate-500 leading-relaxed">{u.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Rollout timeline */}
      <section className="relative z-10 py-16 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-[28px] font-black text-white mb-3">3-Phase Rollout</h2>
            <p className="text-[14px] text-slate-500 max-w-xl mx-auto">AI model upgrades ship in three phases — each building on validated outputs from the previous phase.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PHASES.map((p, i) => {
              const c = colorMap[p.color as keyof typeof colorMap];
              return (
                <div key={p.phase} className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-600 font-semibold uppercase tracking-widest">Phase {i + 1}</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wide ${phaseStatusStyle[p.status]}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="text-[16px] font-bold text-white mb-4">{p.label}</div>
                  <ul className="space-y-2.5">
                    {p.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-[12px] text-slate-400">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${c.dot}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Architecture highlights */}
      <section className="relative z-10 py-16 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-[28px] font-black text-white mb-3">Architecture Highlights</h2>
            <p className="text-[14px] text-slate-500 max-w-xl mx-auto">Technical principles that guide the v2 AI model design.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                icon: "🧠",
                title: "Browser-side Inference",
                desc: "All v2 models run via ONNX Runtime Web — compiled to WebAssembly and WebGPU. No cloud GPU call means sub-100ms inference latency with zero data egress.",
              },
              {
                icon: "🔒",
                title: "Zero-knowledge Privacy",
                desc: "Molecular structures are converted to 2048-bit Morgan fingerprints client-side before any model input. The fingerprint is mathematically irreversible — your SMILES never leaves the browser.",
              },
              {
                icon: "📊",
                title: "Calibrated Uncertainty",
                desc: "Every v2 model outputs a posterior confidence interval alongside point estimates. Monte Carlo dropout at inference time provides per-prediction uncertainty without Bayesian retraining.",
              },
              {
                icon: "🔗",
                title: "Cross-layer Cascade",
                desc: "v2 model outputs are structured tensors that feed downstream layers directly — ADMET embeddings from L1 condition the population PK model in L3, and so on across all 4 layers.",
              },
              {
                icon: "⚡",
                title: "Quantized Model Weights",
                desc: "INT8 post-training quantization reduces model weights by 4× while retaining >99% of prediction accuracy on held-out validation sets. All models under 25 MB for fast browser loading.",
              },
              {
                icon: "🧬",
                title: "Training Data Provenance",
                desc: "All training datasets are public and cited: ChEMBL 33, PubChem BioAssay, FAERS Q4 2025, ClinicalTrials.gov, UniProtKB/Swiss-Prot, PDB mmCIF. No proprietary data used.",
              },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-white/8 bg-white/[0.02] p-5 flex gap-4">
                <div className="text-[22px] shrink-0 mt-0.5">{icon}</div>
                <div>
                  <div className="text-[13px] font-semibold text-white mb-1.5">{title}</div>
                  <p className="text-[12px] text-slate-500 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy guarantee */}
      <section className="relative z-10 py-16 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/4 p-7 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="shrink-0 w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-[22px]">
              🔒
            </div>
            <div className="flex-1">
              <div className="text-[14px] font-bold text-white mb-2">Full Privacy — in v2 as in v1</div>
              <p className="text-[13px] text-slate-400 leading-relaxed">
                The AI inference pipeline never sees your SMILES string. The browser computes a Morgan fingerprint — a 2048-bit one-way hash — and passes only that to the ONNX model.
                Morgan fingerprints are mathematically irreversible: no server, including ours, can reconstruct the original molecular structure.
                This guarantee is architectural, not policy-based.
              </p>
            </div>
            <div className="shrink-0 text-[11px] font-bold px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-center">
              Zero-knowledge<br />by design
            </div>
          </div>
        </div>
      </section>

      {/* Footer spacer */}
      <div className="h-24" />
    </div>
  );
}
