import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import hakaseLogo from "@assets/image_1773504202272.png";
import { NavBar } from "@/components/NavBar";

const LAYERS = [
  {
    num: "01",
    name: "In Vitro Twin",
    color: "violet",
    border: "border-violet-500/30",
    bg: "bg-violet-500/5",
    dot: "bg-violet-500",
    glow: "shadow-violet-500/20",
    badge: "bg-violet-500/15 text-violet-300",
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <circle cx="24" cy="12" r="5" stroke="#8b5cf6" strokeWidth="1.5" />
        <circle cx="10" cy="36" r="5" stroke="#8b5cf6" strokeWidth="1.5" />
        <circle cx="38" cy="36" r="5" stroke="#8b5cf6" strokeWidth="1.5" />
        <line x1="24" y1="17" x2="10" y2="31" stroke="#8b5cf6" strokeWidth="1.5" opacity="0.5" />
        <line x1="24" y1="17" x2="38" y2="31" stroke="#8b5cf6" strokeWidth="1.5" opacity="0.5" />
        <line x1="15" y1="36" x2="33" y2="36" stroke="#8b5cf6" strokeWidth="1.5" opacity="0.5" />
        <circle cx="17" cy="24.5" r="2" fill="#8b5cf6" opacity="0.6" />
        <circle cx="31" cy="24.5" r="2" fill="#8b5cf6" opacity="0.6" />
      </svg>
    ),
    runtime: "5–30 sec",
    question: "Is this molecule worth confirming?",
    metrics: ["RDKit cheminformatics (WASM)", "ADMET + organ-tox cascade", "Validated-target binding (nM)", "Source-quality tier per output", "Cascade gate · Go / Watch / No-Go"],
  },
  {
    num: "02",
    name: "Confirmation Layer",
    color: "blue",
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    dot: "bg-blue-500",
    glow: "shadow-blue-500/20",
    badge: "bg-blue-500/15 text-blue-300",
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <rect x="8" y="10" width="32" height="28" rx="3" stroke="#3b82f6" strokeWidth="1.5" />
        <line x1="8" y1="18" x2="40" y2="18" stroke="#3b82f6" strokeWidth="1" opacity="0.4" />
        <circle cx="14" cy="14" r="1" fill="#3b82f6" />
        <circle cx="18" cy="14" r="1" fill="#3b82f6" opacity="0.6" />
        <path d="M12 24 L14 28 L18 22 L22 26 L26 23 L30 27 L34 24 L36 26" stroke="#3b82f6" strokeWidth="1.5" fill="none" />
        <circle cx="22" cy="34" r="1.5" fill="#3b82f6" opacity="0.7" />
        <circle cx="28" cy="34" r="1.5" fill="#3b82f6" opacity="0.7" />
      </svg>
    ),
    runtime: "1–10 min · GPU opt-in",
    question: "Does the L1 verdict survive in-silico + ex-vivo confirmation?",
    metrics: ["10-stage in-silico pipeline (docking → FEP → PBPK → QSP/PD)", "AutoDock Vina + ESM2 druggability + ML affinity", "FEP free-energy refinement (RunPod GPU, opt-in)", "Virtual tissue panel (GTEx + Tabula Sapiens v2)", "Sealed Confirmation Block (v2.0.0)"],
  },
  {
    num: "03",
    name: "Animal Cohort",
    color: "amber",
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    dot: "bg-amber-500",
    glow: "shadow-amber-500/20",
    badge: "bg-amber-500/15 text-amber-300",
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <ellipse cx="24" cy="22" rx="12" ry="8" stroke="#f59e0b" strokeWidth="1.5" />
        <circle cx="14" cy="16" r="3.5" stroke="#f59e0b" strokeWidth="1.5" />
        <circle cx="34" cy="16" r="3.5" stroke="#f59e0b" strokeWidth="1.5" />
        <path d="M12 30 Q8 38 14 40" stroke="#f59e0b" strokeWidth="1.5" fill="none" />
        <path d="M36 30 Q40 38 34 40" stroke="#f59e0b" strokeWidth="1.5" fill="none" />
        <path d="M20 30 Q22 38 24 40" stroke="#f59e0b" strokeWidth="1.5" fill="none" />
        <path d="M28 30 Q26 38 24 40" stroke="#f59e0b" strokeWidth="1.5" fill="none" opacity="0.5" />
      </svg>
    ),
    runtime: "10–60 sec",
    question: "How does it behave across preclinical species?",
    metrics: ["Multi-species PBPK (rat / dog / monkey)", "FDA-IIG formulation engine (BCS-aware)", "Allometric FIH dose scaling (BW^0.75)", "Species-by-species NOAEL + safety margin", "ToxCast / ToxRefDB / ECOTOX cross-validation"],
  },
  {
    num: "04",
    name: "First-In-Human Readiness",
    color: "emerald",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    dot: "bg-emerald-500",
    glow: "shadow-emerald-500/20",
    badge: "bg-emerald-500/15 text-emerald-300",
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        <rect x="6" y="8" width="36" height="32" rx="3" stroke="#22c55e" strokeWidth="1.5" />
        <line x1="6" y1="18" x2="42" y2="18" stroke="#22c55e" strokeWidth="1" opacity="0.3" />
        <path d="M12 28 L18 28 M12 32 L24 32 M12 36 L20 36" stroke="#22c55e" strokeWidth="1.5" opacity="0.6" />
        <circle cx="32" cy="32" r="6" stroke="#22c55e" strokeWidth="1.5" />
        <path d="M29 32 L31 34 L35 30" stroke="#22c55e" strokeWidth="1.5" fill="none" />
      </svg>
    ),
    runtime: "instant · ICH M3(R2)",
    question: "Are we IND-ready and what is a defensible MABEL starting dose?",
    metrics: ["MABEL-biased FIH starting dose (per FDA 2005 / EMA 2017)", "IND-enabling gap analysis (GLP tox, CMC, IB)", "Phase 1 Planner with Pre-IND defaults", "Sealed PreClinicalPackage v2.0.0 handoff", "Full HAIOps provenance (every flag, every override)"],
  },
];

const STATS = [
  { val: "90%", label: "of drugs fail in clinic" },
  { val: "$2–5M", label: "spent per IND filing" },
  { val: "12–18 mo", label: "to pre-clinical sign-off" },
  { val: "0 bytes", label: "of SMILES leave the browser" },
];

function AnimatedGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg width="100%" height="100%" className="opacity-[0.035]">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-violet-600/8 rounded-full blur-[120px]" />
      <div className="absolute top-1/3 left-0 w-[400px] h-[400px] bg-blue-600/6 rounded-full blur-[100px]" />
      <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-emerald-600/6 rounded-full blur-[100px]" />
    </div>
  );
}

export function Landing() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-['Inter',sans-serif] overflow-x-hidden">
      <AnimatedGrid />

      {/* ── Nav ── */}
      <NavBar anchorLinks={[
        { href: "#why", label: "Why Hakase" },
      ]} />

      {/* ── Hero ── */}
      <section id="platform" className="relative z-10 pt-28 pb-20 px-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-semibold text-emerald-400 uppercase tracking-widest">Privacy-First</span>
          <span className="px-3 py-1 rounded-full border border-violet-500/30 bg-violet-500/10 text-[10px] font-semibold text-violet-400 uppercase tracking-widest">HAIOps Governed</span>
        </div>

        <h1 className="text-[44px] md:text-[56px] font-black tracking-tighter leading-none mb-4 max-w-5xl mx-auto">
          <span className="text-white">The Pre-Clinical</span>
          <br />
          <span className="bg-gradient-to-r from-violet-400 via-blue-400 to-emerald-400 bg-clip-text text-transparent">
            BioDigital Twin.
          </span>
        </h1>
        <p className="text-[20px] text-slate-500 font-medium tracking-tight mb-4 max-w-3xl mx-auto">
          From SMILES to a sealed, IND-ready handoff — a 100% Zero-Lab In-Silico Cascade across four pre-clinical layers.
        </p>

        <p className="text-[16px] text-slate-300 font-semibold tracking-tight mb-8 max-w-3xl mx-auto leading-snug">
          Predict your IND-enabling package <span className="text-white">before</span> you fund the studies. Runway extension, not lab replacement.
        </p>

        <p className="text-[13px] text-slate-500 max-w-2xl mx-auto leading-relaxed mb-6 italic">
          Zero-lab cycle time. Regulator-credible evidence. Privacy-first by design.
        </p>

        <div className="flex items-center justify-center gap-6 mb-10 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            SMILES stays in the browser
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
            HAIOps-governed cascade gate
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            Sealed PreClinicalPackage v2.0.0 handoff
          </span>
        </div>


        {/* Pipeline visual */}
        <div className="mt-20 flex items-center justify-center gap-0 flex-wrap">
          {/* INPUT node — generic, with Diagen as complementary badge */}
          <div className="relative px-4 py-2.5 rounded-xl border border-slate-500/30 bg-slate-500/8 text-center">
            <div className="text-[11px] font-bold text-slate-300">INPUT</div>
            <div className="text-[10px] text-slate-600 mt-0.5">Manual · API · File</div>
            {/* Diagen badge */}
            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full border border-violet-500/40 bg-violet-500/15 whitespace-nowrap">
              <span className="w-1 h-1 rounded-full bg-violet-400" />
              <span className="text-[8px] font-semibold text-violet-400">Diagen</span>
            </div>
          </div>

          <div className="flex items-center px-1 text-slate-600">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </div>

          {[
            { label: "LAYER 1", sub: "In Vitro Twin",       color: "text-violet-300", border: "border-violet-500/20", bg: "bg-violet-500/5" },
            null,
            { label: "LAYER 2", sub: "Confirmation",        color: "text-blue-300",   border: "border-blue-500/20",   bg: "bg-blue-500/5"   },
            null,
            { label: "LAYER 3", sub: "Animal Cohort",       color: "text-amber-300",  border: "border-amber-500/20",  bg: "bg-amber-500/5"  },
            null,
            { label: "LAYER 4", sub: "FIH Readiness",       color: "text-emerald-300",border: "border-emerald-500/20",bg: "bg-emerald-500/5" },
          ].map((item, i) =>
            item === null ? (
              <div key={i} className="flex items-center px-1 text-slate-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </div>
            ) : (
              <div key={i} className={`px-4 py-2.5 rounded-xl border ${item.border} ${item.bg} text-center`}>
                <div className={`text-[11px] font-bold ${item.color}`}>{item.label}</div>
                <div className="text-[10px] text-slate-600 mt-0.5">{item.sub}</div>
              </div>
            )
          )}
        </div>
      </section>

      {/* ── Stats ── */}
      <section id="why" className="relative z-10 py-16 border-y border-white/5">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
          {STATS.map(({ val, label }) => (
            <div key={label} className="text-center">
              <div className="text-[36px] font-black tracking-tight text-white">{val}</div>
              <div className="text-[13px] text-slate-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Simulation Layers ── */}
      <section id="layers" className="relative z-10 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-3">Four Cascading Layers</div>
            <h2 className="text-[40px] font-black tracking-tight text-white">One pre-clinical pipeline</h2>
            <p className="text-[15px] text-slate-500 mt-3 max-w-xl mx-auto">
              In vitro twin → in-silico + virtual-tissue confirmation → PBPK animal cohort → FIH readiness. Zero-Lab end-to-end: every layer's evidence is computed, sealed, and cascaded forward — no copy-paste, no silent recomputation.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {LAYERS.map((layer) => (
              <div
                key={layer.num}
                className={`relative rounded-2xl border ${layer.border} ${layer.bg} p-6 flex flex-col gap-4 hover:shadow-xl ${layer.glow} transition-shadow duration-300`}
              >
                <div className="flex items-start justify-between">
                  {layer.icon}
                  <span className={`text-[10px] px-2 py-1 rounded-md font-mono font-semibold ${layer.badge}`}>
                    {layer.runtime}
                  </span>
                </div>

                <div>
                  <div className="text-[11px] text-slate-600 font-mono mb-1">Layer {layer.num}</div>
                  <h3 className="text-[18px] font-bold text-white leading-tight">{layer.name}</h3>
                  <p className="text-[13px] text-slate-400 mt-1.5 italic">"{layer.question}"</p>
                </div>

                <div className="space-y-1.5 mt-1">
                  {layer.metrics.map((m) => (
                    <div key={m} className="flex items-center gap-2 text-[12px] text-slate-400">
                      <span className={`w-1 h-1 rounded-full shrink-0 ${layer.dot}`} />
                      {m}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Discovery Partner Integration ── */}
      <section id="diagen" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-violet-500 mb-4">Discovery Partner Integration</div>
              <h2 className="text-[38px] font-black tracking-tight text-white leading-tight mb-4">
                Plugs into any drug-<br />discovery engine
              </h2>
              <p className="text-[15px] text-slate-400 leading-relaxed mb-4">
                BioDigital Twin is the pre-clinical confirmation layer for whatever generates your molecules — generative-AI platforms, virtual-screening pipelines, in-house medchem, or licensed assets. Hand us a SMILES (and optionally fingerprints, ADMET pre-scores, or a target UniProt) and we walk it through L1 → L4 to a sealed, IND-ready PreClinicalPackage.
              </p>
              <p className="text-[12px] text-slate-500 leading-relaxed mb-6">
                <span className="text-violet-300 font-semibold">Diagen AI</span> is our reference partner — the integration shown here — but the same payload contract works with any source. We're actively partnering with discovery teams across the industry.
              </p>
              <div className="space-y-3">
                {[
                  { mode: "Synchronous", desc: "Single molecule import in under 30 seconds", color: "text-violet-400" },
                  { mode: "Async Batch", desc: "Webhook-driven batch processing with job IDs", color: "text-blue-400" },
                  { mode: "Cascade", desc: "Auto-runs L1 → L2 → L3 → L4 in one pipeline call", color: "text-emerald-400" },
                ].map(({ mode, desc, color }) => (
                  <div key={mode} className="flex items-start gap-3">
                    <span className={`text-[12px] font-semibold w-28 shrink-0 pt-0.5 ${color}`}>{mode}</span>
                    <span className="text-[13px] text-slate-500">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#0d0f17] border border-white/8 rounded-2xl p-5 font-mono text-[12px] space-y-2">
              <div className="text-slate-600 mb-3">{`// Discovery partner → BioDigital Twin handoff`}</div>
              <div><span className="text-violet-400">const</span> <span className="text-white">payload</span> <span className="text-slate-500">=</span> <span className="text-slate-400">{"{"}</span></div>
              <div className="pl-4 space-y-1">
                <div><span className="text-blue-400">smiles</span><span className="text-slate-500">:</span> <span className="text-emerald-400">"CC(C)Cc1ccc(cc1)..."</span><span className="text-slate-500">,</span></div>
                <div><span className="text-blue-400">fingerprints</span><span className="text-slate-500">:</span> <span className="text-emerald-400">[0.82, 0.14, ...]</span><span className="text-slate-500">,</span></div>
                <div><span className="text-blue-400">admet_prescores</span><span className="text-slate-500">:</span> <span className="text-slate-400">{"{"}</span></div>
                <div className="pl-4">
                  <div><span className="text-blue-300">absorption</span><span className="text-slate-500">:</span> <span className="text-amber-400">0.84</span><span className="text-slate-500">,</span></div>
                  <div><span className="text-blue-300">toxicity</span><span className="text-slate-500">:</span> <span className="text-amber-400">0.91</span></div>
                </div>
                <div><span className="text-slate-400">{"}"}</span><span className="text-slate-500">,</span></div>
                <div><span className="text-blue-400">target_uniprot</span><span className="text-slate-500">:</span> <span className="text-emerald-400">"P00533"</span><span className="text-slate-500">,</span></div>
                <div><span className="text-blue-400">mode</span><span className="text-slate-500">:</span> <span className="text-emerald-400">"cascade"</span></div>
              </div>
              <div><span className="text-slate-400">{"}"}</span></div>
              <div className="pt-2 border-t border-white/5 text-slate-600">{`// → L1 → L2 confirm → L3 animal → L4 FIH-ready`}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── From In Vitro to Trial — Privacy-First Pipeline ── */}
      <section id="story" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <div className="text-center mb-20">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-3">The Complete Pre-Clinical Pipeline</div>
            <h2 className="text-[40px] font-black tracking-tight text-white mb-4">From SMILES to IND-ready handoff</h2>
            <p className="text-[15px] text-slate-500 max-w-2xl mx-auto leading-relaxed">
              IND-enabling pre-clinical work costs $2–5M and takes 12–18 months — and 90% of the molecules that reach Phase 1 still fail. HakaseAI connects four cascading pre-clinical layers into one HAIOps-governed pipeline. Source-quality tiered per output. No fake data. No silent fallbacks.
            </p>
          </div>

          {/* Two-engine overview */}
          <div className="grid md:grid-cols-2 gap-4 mb-24">
            <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-8">
              <div className="text-[9px] uppercase tracking-widest text-violet-500 font-semibold mb-3">The Creator · any discovery engine</div>
              <h3 className="text-[22px] font-black text-white mb-3">Generative chemistry, virtual screening, or in-house medchem</h3>
              <p className="text-[14px] text-slate-400 leading-relaxed">
                Wherever your candidate molecules come from — generative AI (Diagen, Insilico, Iktos, Chemistry42…), virtual-screening pipelines, or your medchem team — BioDigital Twin is the pre-clinical confirmation layer that takes them forward. <span className="text-violet-300">Diagen is our reference integration; the contract is open.</span>
              </p>
            </div>
            <div className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-8">
              <div className="text-[9px] uppercase tracking-widest text-blue-500 font-semibold mb-3">The Validator</div>
              <h3 className="text-[22px] font-black text-white mb-3">BioDigital Twin</h3>
              <p className="text-[14px] text-slate-400 leading-relaxed">
                Confirms those molecules across four cascading pre-clinical layers — In Vitro, in-silico + virtual-tissue Confirmation, multi-species PBPK Animal Cohort, and First-In-Human Readiness — entirely Zero-Lab, sealing the evidence into a regulator-ingestible PreClinicalPackage v2.0.0.
              </p>
            </div>
          </div>

          {/* Step-by-step flow */}
          <div className="text-center mb-14">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-2">The Flow</div>
            <h3 className="text-[30px] font-black tracking-tight text-white">Step by Step</h3>
          </div>

          <div className="relative">
            {/* Vertical connector */}
            <div className="absolute left-6 top-6 bottom-6 w-px bg-gradient-to-b from-violet-500/40 via-blue-500/30 to-emerald-500/40" />

            <div className="space-y-10">

              {/* Molecule input step — discovery-source agnostic */}
              <div className="flex gap-8">
                <div className="shrink-0 w-12 h-12 rounded-full border border-violet-500/40 bg-violet-500/10 flex items-center justify-center text-[11px] font-black text-violet-400 z-10">M</div>
                <div className="flex-1 pt-1 pb-10 border-b border-white/5">
                  <div className="text-[9px] uppercase tracking-widest text-violet-500 font-semibold mb-1">Molecule Input · any source</div>
                  <h4 className="text-[18px] font-bold text-white mb-2">Bring your candidate molecule</h4>
                  <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                    A researcher hands BioDigital Twin a candidate molecule and a target — say, EGFR for non-small-cell lung cancer. The molecule can come from anywhere: a generative-AI partner (Diagen, Insilico, Iktos, Chemistry42…), a virtual-screening pipeline, an in-house medchem series, a licensed asset, or a manual SMILES paste. Hakase doesn't care where it came from — only that the input contract is met.
                  </p>
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5">
                    <div className="text-[9px] uppercase tracking-widest text-violet-500 font-semibold mb-3">Input contract — what BioDigital Twin needs</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-6">
                      {[
                        "SMILES string (required — molecular structure notation)",
                        "Target protein ID (required — UniProt, e.g. P00533 for EGFR)",
                        "Molecular fingerprints (optional — accelerates L1)",
                        "ADMET pre-scores (optional — fed in as priors)",
                        "3D conformers (optional — used by L2 docking)",
                      ].map(item => (
                        <div key={item} className="flex items-start gap-2 text-[12px] text-slate-400">
                          <span className="text-violet-500 mt-0.5 shrink-0">→</span> {item}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-3 border-t border-white/5 text-[11px] text-slate-600">
                      Three ingestion modes:&nbsp;
                      <span className="text-violet-400">Synchronous</span> (single molecule, &lt;30 s) ·&nbsp;
                      <span className="text-blue-400">Async Batch</span> (webhook callbacks) ·&nbsp;
                      <span className="text-emerald-400">Cascade</span> (auto-runs L1→L2→L3→L4 in one call). Diagen is our reference integration; the same contract is open to any discovery partner.
                    </div>
                  </div>
                </div>
              </div>

              {/* Layer 1 */}
              <div className="flex gap-8">
                <div className="shrink-0 w-12 h-12 rounded-full border border-violet-500/40 bg-violet-500/10 flex items-center justify-center text-[11px] font-black text-violet-400 z-10">L1</div>
                <div className="flex-1 pt-1 pb-10 border-b border-white/5">
                  <div className="text-[9px] uppercase tracking-widest text-violet-500 font-semibold mb-1">Layer 1 · In Vitro Twin</div>
                  <h4 className="text-[18px] font-bold text-white mb-2">Is this molecule worth confirming?</h4>
                  <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                    RDKit.js (WASM) computes descriptors in the browser; ML-augmented ADMET adds confidence intervals; a validated-target binding estimate and organ-tox cascade feed the HAIOps cascade gate. Output: GO / WATCH / NO-GO with a source-quality tier per output (heuristic / structural / ML on the computed side; literature / in-house / class-median on the substrate side), plus an EvidencePointer that L2 freezes at Stage 0.
                  </p>
                  <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/5 divide-y divide-white/5">
                      {[
                        ["ADMET Profiling", "ML-augmented A·D·M·E·T with confidence intervals and source-quality tier per axis"],
                        ["Target Binding", "Validated-target affinity estimate (Kd / Ki / IC50) with structural & ML cross-checks"],
                        ["Drug-likeness", "Lipinski + Veber + QED + SAS — all surfaced with rule provenance"],
                        ["Cascade Gate", "GO / WATCH / NO-GO from HAIOps; sealed EvidencePointer for L2 ingestion"],
                      ].map(([label, desc]) => (
                        <div key={label} className="p-4">
                          <div className="text-[11px] font-semibold text-violet-300 mb-1">{label}</div>
                          <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Layer 2 — Confirmation Layer */}
              <div className="flex gap-8">
                <div className="shrink-0 w-12 h-12 rounded-full border border-blue-500/40 bg-blue-500/10 flex items-center justify-center text-[11px] font-black text-blue-400 z-10">L2</div>
                <div className="flex-1 pt-1 pb-10 border-b border-white/5">
                  <div className="text-[9px] uppercase tracking-widest text-blue-500 font-semibold mb-1">Layer 2 · Confirmation Layer</div>
                  <h4 className="text-[18px] font-bold text-white mb-2">Does the L1 Verdict Survive Confirmation?</h4>
                  <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                    Two parallel sub-tracks — both 100% computational. The <span className="text-blue-300">in-silico track</span> runs a 10-stage pipeline — ESM2 druggability → AutoDock Vina docking → ML affinity + ADMET cross-check → selectivity / cardiotox panel → optional FEP free-energy refinement (RunPod GPU) → PBPK projection → QSP/PD coupling → therapeutic-index ranking → handoff. The <span className="text-blue-300">virtual-tissue (ex-vivo) track</span> simulates a multi-cellular tissue environment by mapping L1 descriptors and L2 docking poses against GTEx tissue baselines and the Tabula Sapiens v2 cell-type atlas — no physical tissue, no chip vendors. Both seal into a v2.0.0 ConfirmationBlock.
                  </p>
                  <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/5 divide-y divide-white/5">
                      {[
                        ["In-Silico Pipeline", "10 stages · AutoDock Vina + OpenBabel + RDKit · ESM2 druggability"],
                        ["Free-Energy Refinement", "FEP on RunPod GPU (opt-in, ~24 GPU-h, cost-confirmed)"],
                        ["Virtual-Tissue Evidence", "GTEx tissue baselines · Tabula Sapiens v2 cell-type atlas · DepMap PRISM — computational, no chips"],
                        ["Sealed Confirmation Block", "v2.0.0 evidence package · L1 EvidencePointer frozen at Stage 0"],
                      ].map(([label, desc]) => (
                        <div key={label} className="p-4">
                          <div className="text-[11px] font-semibold text-blue-300 mb-1">{label}</div>
                          <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Layer 3 — Animal Cohort */}
              <div className="flex gap-8">
                <div className="shrink-0 w-12 h-12 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center text-[11px] font-black text-amber-400 z-10">L3</div>
                <div className="flex-1 pt-1 pb-10 border-b border-white/5">
                  <div className="text-[9px] uppercase tracking-widest text-amber-500 font-semibold mb-1">Layer 3 · Animal Cohort</div>
                  <h4 className="text-[18px] font-bold text-white mb-2">How Does It Behave Across Species?</h4>
                  <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                    Multi-species PBPK across rat, dog, and monkey using allometric scaling (BW^0.75 for clearance, BW^1.0 for Vd) and a BCS-aware FDA-IIG formulation engine. Cross-validated against ToxCast, ToxRefDB, ECOTOX, and ChEMBL animal-PK records. Outputs species-by-species NOAEL with safety margins and the human-equivalent dose used to seed L4 MABEL calculations.
                  </p>
                  <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/5 divide-y divide-white/5">
                      {[
                        ["Multi-species PBPK", "Rat · Dog · Monkey — Cmax, AUC, t½, Vd, CL per species"],
                        ["Formulation Engine", "Six FDA-IIG excipient classes · BCS-aware bioavailability"],
                        ["Allometric Scaling", "ICH M3(R2) — BW^0.75 for CL, BW^1.0 for Vd, 1/10 NOAEL safety factor"],
                        ["External Validation", "ToxCast · ToxRefDB · ECOTOX · ChEMBL animal-PK"],
                      ].map(([label, desc]) => (
                        <div key={label} className="p-4">
                          <div className="text-[11px] font-semibold text-amber-300 mb-1">{label}</div>
                          <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Layer 4 — First-In-Human Readiness */}
              <div className="flex gap-8">
                <div className="shrink-0 w-12 h-12 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-[11px] font-black text-emerald-400 z-10">L4</div>
                <div className="flex-1 pt-1">
                  <div className="text-[9px] uppercase tracking-widest text-emerald-500 font-semibold mb-1">Layer 4 · First-In-Human Readiness</div>
                  <h4 className="text-[18px] font-bold text-white mb-2">Are We IND-Ready?</h4>
                  <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                    The Phase 1 Planner derives a defensible MABEL-biased starting dose (per FDA 2005 / EMA 2017), evaluates the IND-enabling gate (GLP tox, CMC, Investigator's Brochure), and seals every piece of upstream evidence into a single PreClinicalPackage v2.0.0 — the artefact a CRO, regulator, or licensing partner can ingest as-is. This is the boundary into the clinic, not a clinical-trial simulator.
                  </p>
                  <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/5 divide-y divide-white/5">
                      {[
                        ["MABEL Starting Dose", "FDA 2005 / EMA 2017 — minimal anticipated biological effect level"],
                        ["IND Gate", "GLP tox · CMC · Investigator's Brochure · Pre-IND meeting checklist"],
                        ["Phase 1 Planner", "Cohort sizing · escalation rules · stopping criteria — derived, not authored"],
                        ["Sealed Handoff", "PreClinicalPackage v2.0.0 · full HAIOps provenance trail"],
                      ].map(([label, desc]) => (
                        <div key={label} className="p-4">
                          <div className="text-[11px] font-semibold text-emerald-300 mb-1">{label}</div>
                          <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Why This Matters */}
          <div className="mt-24 rounded-2xl border border-white/8 bg-white/2 overflow-hidden">
            <div className="px-8 py-6 border-b border-white/5">
              <h3 className="text-[20px] font-black text-white">Why This Matters</h3>
            </div>
            <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/5">
              <div className="p-8 text-center">
                <div className="text-[9px] uppercase tracking-widest text-slate-600 mb-4">Without Hakase</div>
                <div className="text-[42px] font-black text-slate-400 leading-none mb-2">1–5<span className="text-[20px] ml-1">yrs</span></div>
                <div className="text-[13px] text-slate-600">from molecule to market</div>
              </div>
              <div className="p-8 text-center">
                <div className="text-[9px] uppercase tracking-widest text-violet-600 mb-4">With Hakase</div>
                <div className="text-[42px] font-black text-violet-400 leading-none mb-2">30–50<span className="text-[20px] ml-0.5">%</span></div>
                <div className="text-[13px] text-slate-500">faster pre-clinical cost reduction</div>
              </div>
              <div className="p-8 text-center">
                <div className="text-[9px] uppercase tracking-widest text-emerald-600 mb-4">The Result</div>
                <div className="text-[42px] font-black text-emerald-400 leading-none mb-2">$2–5M</div>
                <div className="text-[13px] text-slate-500">in IND-enabling spend, defensibly justified</div>
              </div>
            </div>
            <div className="px-8 py-5 border-t border-white/5 text-center">
              <p className="text-[13px] text-slate-600 italic">
                You bring the molecule. BioDigital Twin confirms it through to IND.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* ── Advanced AI v2 ── */}
      <section id="ai-v2" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/25 bg-violet-500/8 mb-5">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[11px] font-semibold text-violet-400 tracking-wide uppercase">Coming in v2</span>
            </div>
            <h2 className="text-[38px] font-black tracking-tight text-white mb-4">
              Advanced AI Models
            </h2>
            <p className="text-[15px] text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Every layer is backed by dedicated models — from ML-augmented ADMET to ESM2 druggability, AutoDock Vina docking, opt-in FEP refinement, and the MABEL-biased Phase 1 Planner.
              50+ models evaluated. 8 components. 3-phase rollout.
              SMILES stays in the browser; the AI Service only ever sees fingerprints.
            </p>
          </div>

          {/* Upgrade grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">

            {/* Layer 1 upgrades */}
            <div className="rounded-2xl border border-violet-500/15 bg-violet-500/4 p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-full border border-violet-500/40 bg-violet-500/10 flex items-center justify-center text-[10px] font-black text-violet-400">L1</div>
                <span className="text-[11px] font-semibold text-violet-400 uppercase tracking-widest">In Vitro</span>
              </div>
              <div className="space-y-3">
                {[
                  ["ADMET Scoring",      "Transformer model trained on tens of millions of molecules, delivering depth beyond traditional physicochemical rules."],
                  ["Binding Affinity",   "Protein language model embeddings paired with an attention-based affinity predictor. Coverage spans ~20 well-known targets to thousands."],
                  ["Organ Toxicity",     "Specialized per-organ models (cardiac, hepatic, renal) with confidence intervals — cardiac, hepatic, and renal endpoints covered."],
                ].map(([label, desc]) => (
                  <div key={label as string} className="border-t border-violet-500/10 pt-3 first:border-0 first:pt-0">
                    <div className="text-[12px] font-semibold text-white mb-1">{label}</div>
                    <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Layer 2 upgrades */}
            <div className="rounded-2xl border border-blue-500/15 bg-blue-500/4 p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-full border border-blue-500/40 bg-blue-500/10 flex items-center justify-center text-[10px] font-black text-blue-400">L2</div>
                <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-widest">Confirmation</span>
              </div>
              <div className="space-y-3">
                {[
                  ["Structure-Prediction Co-Folding",  "Deep-learning co-folding with binding-affinity prediction — replaces classical Vina poses for receptors with no crystal structure."],
                  ["FEP+ Refinement",          "Alchemical free-energy perturbation on GPU (RunPod, ~24 GPU-h). Replaces ML affinity prediction with physics-grounded ΔG."],
                  ["Whole-Body PBPK",          "18-compartment PBPK replacing the 2-compartment RK4 solver — species parameters from PK-Sim physiology atlas."],
                ].map(([label, desc]) => (
                  <div key={label as string} className="border-t border-blue-500/10 pt-3 first:border-0 first:pt-0">
                    <div className="text-[12px] font-semibold text-white mb-1">{label}</div>
                    <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Layer 3 + 4 upgrades */}
            <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/4 p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center text-[10px] font-black text-amber-400">L3</div>
                <div className="w-7 h-7 -ml-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-[10px] font-black text-emerald-400">L4</div>
                <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-widest">Animal · FIH</span>
              </div>
              <div className="space-y-3">
                {[
                  ["Allometric Uncertainty",  "Bootstrap-resampled FIH dose with 90% credible intervals per ICH M3(R2) — replacing point-estimate scaling."],
                  ["IVIVC Bridging",          "In-vitro–in-vivo correlation Level A/B/C from dissolution data into PBPK absorption profiles, bench-to-cohort automatically."],
                  ["MABEL ML Calibrator",     "Learned MABEL-vs-NOAEL crossover calibrated on historical FIH dose decisions — flags when MABEL should drive starting dose."],
                ].map(([label, desc]) => (
                  <div key={label as string} className="border-t border-emerald-500/10 pt-3 first:border-0 first:pt-0">
                    <div className="text-[12px] font-semibold text-white mb-1">{label}</div>
                    <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Privacy guarantee row */}
          <div className="rounded-2xl border border-white/8 bg-white/2 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="shrink-0 w-10 h-10 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-white mb-1">Privacy guarantee</div>
              <p className="text-[12px] text-slate-400 leading-relaxed">
                The AI inference server never sees your SMILES. The browser computes a Morgan fingerprint — a 2048-bit one-way hash — and sends only that to the model endpoint. Morgan fingerprints are mathematically irreversible: no server, including ours, can reconstruct the original molecular structure.
              </p>
            </div>
            <div className="shrink-0 text-[10px] font-semibold px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/8 text-emerald-400">
              Zero-knowledge
            </div>
          </div>

        </div>
      </section>

      {/* ── Real-Data Backbone Across L2 / L3 / L4 ── */}
      <section id="vpse" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-500/25 bg-blue-500/8 mb-5">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[11px] font-semibold text-blue-400 tracking-wide uppercase">Now Live · Real-Data Backbone</span>
            </div>
            <h2 className="text-[38px] font-black tracking-tight text-white mb-4">
              Real evidence at every layer
            </h2>
            <p className="text-[15px] text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Four real-world data sources back the cascade — PK-Sim OSP physiology for multi-species PBPK, ChEMBL bioactivity for PD seeding, FAERS for label-grade adverse-event signal, and curated species-physiology reference data for allometric scaling. No synthetic fallbacks, no fake data.
            </p>
          </div>

          {/* 4 upgrade cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">

            {/* 1 — Two-Compartment PBPK */}
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/4 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#3b82f6" strokeWidth="1.5">
                      <path d="M3 12 Q6 6 9 12 Q12 18 15 12 Q18 6 21 12" />
                      <circle cx="9" cy="12" r="1.5" fill="#3b82f6" />
                      <circle cx="15" cy="12" r="1.5" fill="#3b82f6" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[10px] text-blue-400 uppercase tracking-widest font-semibold mb-0.5">L3 · Animal Cohort PBPK</div>
                    <div className="text-[14px] font-bold text-white">Multi-Species Two-Compartment PBPK</div>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 font-semibold">Live</span>
              </div>
              <p className="text-[12px] text-slate-500 leading-relaxed mb-4">
                Two-compartment PBPK solver (central + peripheral) with RK4 numerical integration
                at 1-minute steps, run across rat, dog, and monkey. Parameters from PK-Sim OSP physiology:
                organ volumes, inter-compartmental clearance, and allometric scaling (BW^0.75) per ICH M3(R2).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["RK4 ODE Solver", "Allometric Scaling (ICH M3(R2))", "Multi-Species (rat · dog · monkey)", "PK-Sim Physiology"].map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/15 text-blue-400/70">{t}</span>
                ))}
              </div>
            </div>

            {/* 2 — NHANES Population Generator */}
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/4 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#3b82f6" strokeWidth="1.5">
                      {[4, 10, 16, 22].map((x, i) => (
                        <g key={x}>
                          <circle cx={x} cy="9" r="2.5" opacity={1 - i * 0.2} />
                          <path d={`M${x - 3} 17 Q${x} 13 ${x + 3} 17`} opacity={1 - i * 0.2} fill="none" />
                        </g>
                      ))}
                    </svg>
                  </div>
                  <div>
                    <div className="text-[10px] text-blue-400 uppercase tracking-widest font-semibold mb-0.5">L3 · Allometric Scaling</div>
                    <div className="text-[14px] font-bold text-white">NOAEL → HED with Bootstrap CIs</div>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 font-semibold">Live</span>
              </div>
              <p className="text-[12px] text-slate-500 leading-relaxed mb-4">
                Bootstrap-resampled allometric scaling with species-specific correction factors —
                BW^0.75 for clearance, BW^1.0 for volume — applied to the L3 NOAEL.
                Human-equivalent dose surfaces with 90% credible intervals per ICH M3(R2),
                and the 1/10 NOAEL safety factor is applied before any L4 handoff.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["NOAEL → HED", "Bootstrap 90% CIs", "1/10 Safety Factor", "ICH M3(R2)"].map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/15 text-blue-400/70">{t}</span>
                ))}
              </div>
            </div>

            {/* 3 — ChEMBL PD Model */}
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/4 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#8b5cf6" strokeWidth="1.5">
                      <path d="M4 20 Q8 8 12 14 Q16 20 20 4" />
                      <line x1="4" y1="14" x2="20" y2="14" strokeDasharray="2 2" opacity="0.4" />
                      <text x="14" y="11" fill="#8b5cf6" fontSize="5" fontFamily="monospace">EC₅₀</text>
                    </svg>
                  </div>
                  <div>
                    <div className="text-[10px] text-violet-400 uppercase tracking-widest font-semibold mb-0.5">L2 · QSP/PD Coupling</div>
                    <div className="text-[14px] font-bold text-white">ChEMBL Emax Parameters</div>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 font-semibold">Live</span>
              </div>
              <p className="text-[12px] text-slate-500 leading-relaxed mb-4">
                The L2 Confirmation pipeline queries ChEMBL for IC50 / Ki values of the closest
                validated reference. Geometric mean potency seeds the Emax / Hill model
                (E = Emax × C^n / (EC50^n + C^n)), grounding the QSP/PD coupling and TI ranking
                in real assay data — never in synthetic estimates.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["ChEMBL Bioactivity API", "Emax / Hill Model", "IC50 → EC50 Mapping", "2.4M Compounds"].map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full border border-violet-500/15 text-violet-400/70">{t}</span>
                ))}
              </div>
            </div>

            {/* 4 — FAERS Safety Calibration */}
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/4 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#22c55e" strokeWidth="1.5">
                      <path d="M12 3 L4 7 L4 13 Q4 18 12 21 Q20 18 20 13 L20 7 Z" />
                      <path d="M9 12 L11 14 L15 10" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[10px] text-emerald-400 uppercase tracking-widest font-semibold mb-0.5">L4 · IND Label Signal</div>
                    <div className="text-[14px] font-bold text-white">FAERS AE Calibration</div>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 font-semibold">Live</span>
              </div>
              <p className="text-[12px] text-slate-500 leading-relaxed mb-4">
                The L4 Phase 1 Planner pulls the top adverse-event signals from openFDA FAERS
                (MedDRA preferred terms + real report counts) for the closest validated reference
                class — pre-populating the Investigator's Brochure / WARNINGS AND PRECAUTIONS draft
                with real-world pharmacovigilance evidence rather than fabricated frequencies.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["openFDA FAERS API", "MedDRA Terms", "20M+ AE Reports", "Real-World Signal"].map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/15 text-emerald-400/70">{t}</span>
                ))}
              </div>
            </div>

          </div>

          {/* Data sources summary bar */}
          <div className="rounded-2xl border border-white/8 bg-white/3 px-6 py-4 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-[11px] font-semibold text-white mb-0.5">SMILES stays in the browser; the AI Service only ever sees fingerprints</div>
              <div className="text-[11px] text-slate-500">L1 runs in-browser (RDKit.js) · L2/L3/L4 run server-side on fingerprints + structured evidence · no SMILES, no proprietary IP egress</div>
            </div>
            <div className="flex items-center gap-3">
              {[
                { label: "ChEMBL",   sub: "2.4M compounds", color: "violet" },
                { label: "openFDA",  sub: "20M+ AE reports", color: "emerald" },
                { label: "PK-Sim",   sub: "OSP Physiology",  color: "blue" },
                { label: "ToxCast",  sub: "Animal-PK xref",  color: "blue" },
              ].map(({ label, sub, color }) => (
                <div key={label} className={`text-center px-3 py-2 rounded-xl border ${
                  color === "violet"  ? "border-violet-500/20 bg-violet-500/5"
                  : color === "emerald" ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-blue-500/20 bg-blue-500/5"
                }`}>
                  <div className={`text-[11px] font-bold ${color === "violet" ? "text-violet-300" : color === "emerald" ? "text-emerald-300" : "text-blue-300"}`}>{label}</div>
                  <div className="text-[9px] text-slate-600 mt-0.5">{sub}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </section>

      {/* ── Privacy Architecture ── */}
      <section id="privacy" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">

          <div className="text-center mb-16">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-3">Privacy-First Architecture</div>
            <h2 className="text-[40px] font-black tracking-tight text-white mb-4">
              Your molecules never leave<br />your browser.
            </h2>
            <p className="text-[15px] text-slate-500 max-w-2xl mx-auto leading-relaxed">
              Our servers never see, store, or learn from your proprietary compounds.
              This is a technical guarantee — not just a policy promise.
            </p>
          </div>

          {/* Split architecture diagram */}
          <div className="grid md:grid-cols-2 gap-px bg-white/5 rounded-2xl overflow-hidden border border-white/8 mb-12">
            {/* Client side */}
            <div className="bg-[#0d0f17] p-8">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" />
                <div className="text-[11px] font-semibold uppercase tracking-widest text-emerald-500">Your Browser · Client-side</div>
              </div>
              <div className="space-y-2.5">
                {[
                  "SMILES string (molecule structure)",
                  "2D / 3D structure rendering",
                  "Molecular property calculation (RDKit.js)",
                  "Morgan fingerprint generation",
                  "SDF / MOL2 file parsing",
                  "Project storage (IndexedDB, encrypted)",
                  "Export & download generation",
                ].map(item => (
                  <div key={item} className="flex items-center gap-2 text-[13px] text-slate-300">
                    <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-5 border-t border-white/5 text-[11px] text-slate-600 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-emerald-500/50" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Structural data never leaves this boundary
              </div>
            </div>

            {/* Server side */}
            <div className="bg-[#07080c] p-8">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-2 h-2 rounded-full bg-violet-400" />
                <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-500">Hakase API · Server-side</div>
              </div>
              <div className="space-y-2.5">
                {[
                  "ML ADMET prediction (from fingerprint only)",
                  "ESM2 protein druggability — L2 Stage 1",
                  "AutoDock Vina docking — L2 Stage 2",
                  "ML affinity cross-check — L2 Stage 3",
                  "FEP free-energy refinement (RunPod GPU, opt-in) — L2 Stage 5",
                  "User authentication",
                ].map(item => (
                  <div key={item} className="flex items-center gap-2 text-[13px] text-slate-300">
                    <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-5 border-t border-white/5 space-y-1.5">
                {[
                  "Never receives SMILES",
                  "Never stores molecular structures",
                  "Fingerprints discarded immediately after inference",
                ].map(item => (
                  <div key={item} className="flex items-center gap-2 text-[11px] text-slate-600">
                    <svg className="w-3 h-3 text-red-500/50 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Data residency & federated benchmarking */}
          <div className="mb-12 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-7">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Planned · Opt-in</span>
              <div className="text-[11px] uppercase tracking-widest text-emerald-500 font-semibold">Data residency & federated benchmarking</div>
            </div>
            <h3 className="text-[20px] font-bold text-white mb-3 tracking-tight">Your IN-HOUSE bench data never trains the global engine.</h3>
            <p className="text-[13px] text-slate-400 leading-relaxed mb-4">
              IN-HOUSE rows you enter — Cl_int, Papp, fu, Ki, IC50, NOAEL — stay in your tenant's substrate matrix. They never enter another tenant's substrate, never enter the platform's class-median anchor refit, and never train the global engine. Engine recalibration on your IN-HOUSE data produces a <span className="text-white">tenant-scoped overlay</span> only. Your predict-vs-observed track record is private, bound to your tenant ID, and visible only inside your workspace.
            </p>
            <div className="grid md:grid-cols-2 gap-4 text-[12px]">
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-4">
                <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold mb-2">Strict, today</div>
                <ul className="space-y-1.5 text-slate-400 leading-relaxed">
                  <li>• IN-HOUSE values stay in tenant; never federated</li>
                  <li>• No global training of any kind, ever</li>
                  <li>• No leaderboards, no per-tenant rankings</li>
                  <li>• No federated views of substrate inputs</li>
                </ul>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold mb-2">Planned, opt-in</div>
                <ul className="space-y-1.5 text-slate-400 leading-relaxed">
                  <li>• Aggregate-only fold-error vs. platform corpus</li>
                  <li>• k-anonymous: ≥ 5 contributing tenants per cell</li>
                  <li>• Residuals only — never raw inputs, structures, or targets</li>
                  <li>• 24-hour withdrawal purges your residuals from future aggregates</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Three pillars */}
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                color: "emerald",
                border: "border-emerald-500/20",
                bg: "bg-emerald-500/5",
                label: "RDKit.js WebAssembly",
                desc: "The world's most widely used open-source chemistry toolkit — compiled to WebAssembly and running at near-native speed inside your browser. SMILES validation in <50ms. Property calculation in <100ms. Fingerprint generation in <20ms. Used by Pfizer, Novartis, and most major pharma.",
              },
              {
                color: "violet",
                border: "border-violet-500/20",
                bg: "bg-violet-500/5",
                label: "Fingerprint-only inference",
                desc: "We convert your molecule into a 2048-bit Morgan fingerprint — a mathematical summary that cannot be reverse-engineered back into the original structure (published research: Chemoinformatics, Wiley 2018). Only this fingerprint travels to our server, encrypted via TLS 1.3. Like sending a blurred image: the AI can still make predictions, but can never reconstruct the original.",
              },
              {
                color: "blue",
                border: "border-blue-500/20",
                bg: "bg-blue-500/5",
                label: "IndexedDB local storage",
                desc: "All projects are saved in your browser's built-in database, encrypted at rest using AES-256 via the Web Crypto API. Your saved molecules live on your machine — Hakase servers have zero access. Projects persist across sessions until you choose to delete them.",
              },
            ].map(({ color, border, bg, label, desc }) => (
              <div key={label} className={`rounded-2xl border ${border} ${bg} p-6`}>
                <div className={`text-[9px] uppercase tracking-widest font-semibold mb-3 ${
                  color === "emerald" ? "text-emerald-500" : color === "violet" ? "text-violet-500" : "text-blue-500"
                }`}>Technical Pillar</div>
                <h3 className="text-[15px] font-bold text-white mb-3">{label}</h3>
                <p className="text-[12px] text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* Proof statement */}
          <div className="mt-10 text-center">
            <p className="text-[13px] text-slate-600 max-w-2xl mx-auto">
              Open-source chemistry software (RDKit) runs in your browser, standard browser storage APIs hold your data,
              and you can verify this architecture by inspecting network traffic — you will never see a SMILES string leave your machine.
            </p>
          </div>

        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative z-10 py-28 px-6 border-t border-white/5 text-center">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-violet-600/8 rounded-full blur-[100px]" />
        </div>
        <h2 className="relative text-[44px] font-black tracking-tight text-white mb-4">
          Ready to confirm?
        </h2>
        <p className="relative text-[16px] text-slate-400 max-w-xl mx-auto mb-8">
          Compress 12–18 months of IND-enabling work into a sealed, HAIOps-governed handoff.
        </p>
        <button
          onClick={() => navigate("/login")}
          className="relative inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-white text-[#07080c] font-bold text-[15px] hover:bg-slate-100 transition-colors shadow-2xl"
        >
          Launch BioDigital Twin
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 border-t border-white/5 px-8 py-6 flex items-center justify-between text-[12px] text-slate-600">
        <div className="flex items-center gap-2">
          <img src={hakaseLogo} alt="HakaseAI" className="h-5 w-auto object-contain opacity-70" />
          <span>BioDigital Twin Platform · v1.0</span>
        </div>
        <div>Hakase AI · March 2026 · Confidential</div>
      </footer>
    </div>
  );
}
