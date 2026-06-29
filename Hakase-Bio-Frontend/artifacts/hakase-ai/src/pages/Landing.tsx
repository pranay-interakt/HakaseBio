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
    metrics: ["In-browser cheminformatics & drug-likeness", "ADMET profile with confidence intervals", "Target-binding affinity estimate (nM)", "Source-quality tier on every output", "Cascade gate · Go / Watch / No-Go"],
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
    question: "Does the L1 verdict survive in-silico + virtual-tissue confirmation?",
    metrics: ["Multi-stage in-silico confirmation pipeline", "Structure-based pose generation + affinity", "Optional GPU free-energy refinement", "Virtual-tissue safety & selectivity panel", "Sealed Confirmation Block (v2.0.0)"],
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
    metrics: ["Multi-species PBPK modeling", "Regulatory-grade formulation engine", "Allometric FIH dose scaling (ICH M3(R2))", "Species-by-species NOAEL + safety margin", "Cross-validated against regulatory registries"],
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
    metrics: ["MABEL-biased FIH starting dose (FDA/EMA aligned)", "IND-enabling gap analysis (GLP tox · CMC · IB)", "Phase 1 Planner with Pre-IND defaults", "Sealed PreClinicalPackage v2.0.0 handoff", "Full audit trail · every flag, every override"],
  },
];

const STATS = [
  { val: "90%", label: "of drugs fail in clinic" },
  { val: "$2–5M", label: "spent per IND filing" },
  { val: "12–18 mo", label: "to pre-clinical sign-off" },
  { val: "0 bytes", label: "of structural IP transmitted" },
];

function AnimatedGrid() {
  return (
    <div className="hk-animated-grid absolute inset-0 overflow-hidden pointer-events-none">
      <svg width="100%" height="100%" className="opacity-[0.035]">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="white" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="hk-glow-violet absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-violet-600/8 rounded-full blur-[120px]" />
      <div className="hk-glow-blue absolute top-1/3 left-0 w-[400px] h-[400px] bg-blue-600/6 rounded-full blur-[100px]" />
      <div className="hk-glow-emerald absolute top-1/3 right-0 w-[400px] h-[400px] bg-emerald-600/6 rounded-full blur-[100px]" />
    </div>
  );
}

/* ── Release metadata (used in footer / version chip only) ── */
const RELEASE = {
  version: "v1.1",
  date: "May 2026",
};

/* ── Outcome-focused pillars — the value a customer actually buys ── */
const VALUE_PILLARS = [
  {
    color: "violet",
    label: "Cut decision time",
    headline: "From candidate to IND-readiness in days, not quarters.",
    desc: "Compress 12–18 months of pre-clinical work into a single, defensible package — without expanding the wet-lab footprint.",
    metric: "30–50%",
    metricLabel: "faster pre-clinical cycle",
  },
  {
    color: "blue",
    label: "Defensible at every gate",
    headline: "Regulator-aligned outputs at every cascade step.",
    desc: "MABEL-biased FIH dosing, ICH M3(R2) allometric scaling, and a complete provenance trail — built to survive sponsor and regulator scrutiny.",
    metric: "ICH · FDA · EMA",
    metricLabel: "frameworks aligned",
  },
  {
    color: "emerald",
    label: "Privacy by construction",
    headline: "Structural IP never leaves your machine.",
    desc: "Molecular structures stay client-side. The platform only ever sees one-way derived signals — there is no path back to your candidate from anything we receive.",
    metric: "0 bytes",
    metricLabel: "of structural IP transmitted",
  },
];

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
          From candidate molecule to a sealed, IND-ready handoff — a Zero-Lab in-silico cascade across four pre-clinical layers.
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
            Structural IP stays client-side
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
          {/* INPUT node — any discovery source */}
          <div className="relative px-4 py-2.5 rounded-xl border border-slate-500/30 bg-slate-500/8 text-center">
            <div className="text-[11px] font-bold text-slate-300">INPUT</div>
            <div className="text-[10px] text-slate-600 mt-0.5">Manual · API · File</div>
            {/* Any discovery source badge */}
            <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full border border-violet-500/40 bg-violet-500/15 whitespace-nowrap">
              <span className="w-1 h-1 rounded-full bg-violet-400" />
              <span className="text-[8px] font-semibold text-violet-400">Any source</span>
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

      {/* ── Value Pillars — what a customer actually buys ── */}
      <section id="value" className="relative z-10 py-20 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-3">Why teams choose BioDigital Twin</div>
            <h2 className="text-[34px] font-black tracking-tight text-white">A pre-clinical edge, end to end</h2>
            <p className="text-[14px] text-slate-400 mt-3 max-w-2xl mx-auto leading-relaxed">
              Faster decisions, defensible outputs, and structural IP that never leaves your machine — designed for the realities of getting to IND.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {VALUE_PILLARS.map(({ color, label, headline, desc, metric, metricLabel }) => {
              const tone =
                color === "violet"  ? { bd: "border-violet-500/25",  bg: "bg-violet-500/5",  tx: "text-violet-300",  num: "text-violet-300"  } :
                color === "blue"    ? { bd: "border-blue-500/25",    bg: "bg-blue-500/5",    tx: "text-blue-300",    num: "text-blue-300"    } :
                                       { bd: "border-emerald-500/25",bg: "bg-emerald-500/5", tx: "text-emerald-300", num: "text-emerald-300" };
              return (
                <div key={label} className={`hk-lift rounded-2xl border ${tone.bd} ${tone.bg} p-6 flex flex-col`}>
                  <div className={`text-[10px] uppercase tracking-widest font-semibold mb-3 ${tone.tx}`}>{label}</div>
                  <h3 className="text-[18px] font-bold text-white leading-snug mb-3">{headline}</h3>
                  <p className="text-[13px] text-slate-400 leading-relaxed mb-5 flex-1">{desc}</p>
                  <div className="pt-4 border-t border-white/5">
                    <div className={`text-[24px] font-black tracking-tight ${tone.num}`}>{metric}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{metricLabel}</div>
                  </div>
                </div>
              );
            })}
          </div>
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

      {/* ── Integrates with Any Discovery Engine ── */}
      <section id="integrations" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-violet-500 mb-4">Built to Integrate</div>
              <h2 className="text-[38px] font-black tracking-tight text-white leading-tight mb-4">
                Plugs into any drug-<br />discovery engine
              </h2>
              <p className="text-[15px] text-slate-400 leading-relaxed mb-4">
                BioDigital Twin is the pre-clinical confirmation layer for whatever generates your molecules — generative-AI platforms, virtual-screening pipelines, in-house medchem, or licensed assets. Bring the candidate; we take it from a structure to a sealed, IND-ready package.
              </p>
              <p className="text-[12px] text-slate-500 leading-relaxed mb-6">
                Discovery teams across the industry use BioDigital Twin as their pre-clinical confirmation engine. Open contract, vendor-neutral, no lock-in.
              </p>
              <div className="space-y-3">
                {[
                  { mode: "Single Molecule",  desc: "Synchronous run · under 30 seconds end-to-end",        color: "text-violet-400" },
                  { mode: "Batch",            desc: "Async pipeline with webhook callbacks and job IDs",     color: "text-blue-400"   },
                  { mode: "Full Cascade",     desc: "Auto-runs every layer in one orchestrated call",         color: "text-emerald-400"},
                ].map(({ mode, desc, color }) => (
                  <div key={mode} className="flex items-start gap-3">
                    <span className={`text-[12px] font-semibold w-32 shrink-0 pt-0.5 ${color}`}>{mode}</span>
                    <span className="text-[13px] text-slate-500">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Capability diagram — no payload internals, just the flow */}
            <div className="rounded-2xl border border-white/8 bg-white/2 p-7">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-5">Pre-clinical handoff flow</div>
              <div className="space-y-3">
                {[
                  { step: "01", label: "Submit a candidate",         desc: "Through the UI, API, or partner integration." },
                  { step: "02", label: "Run the cascade",            desc: "Layers 1 → 4 execute end-to-end with full provenance." },
                  { step: "03", label: "Receive a sealed package",   desc: "Regulator-ingestible PreClinicalPackage v2.0.0." },
                ].map(({ step, label, desc }) => (
                  <div key={step} className="flex items-start gap-4 rounded-xl border border-white/5 bg-white/2 px-4 py-3">
                    <div className="text-[11px] font-mono text-violet-400 pt-0.5 shrink-0">{step}</div>
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold text-white">{label}</div>
                      <div className="text-[12px] text-slate-500 leading-relaxed">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-white/5 text-[11px] text-slate-500 leading-relaxed">
                Structural inputs stay on the client. The platform receives only one-way derived signals — never the molecule itself.
              </div>
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
            <h2 className="text-[40px] font-black tracking-tight text-white mb-4">From candidate to IND-ready handoff</h2>
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
                Wherever your candidate molecules come from — generative-AI platforms, virtual-screening pipelines, or your medchem team — BioDigital Twin is the pre-clinical confirmation layer that takes them forward. Open contract, vendor-neutral, no lock-in.
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
                    A researcher hands BioDigital Twin a candidate and a target — say, a kinase inhibitor for non-small-cell lung cancer. The molecule can come from anywhere: a generative-AI partner, a virtual-screening pipeline, an in-house medchem series, or a licensed asset. We're source-agnostic; the input contract is what matters.
                  </p>
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5">
                    <div className="text-[9px] uppercase tracking-widest text-violet-500 font-semibold mb-3">What BioDigital Twin accepts</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-6">
                      {[
                        "A candidate molecule (required)",
                        "A target protein (required)",
                        "Optional priors — pre-computed signals or descriptors",
                        "Optional 3D structure data",
                        "Therapeutic area context",
                      ].map(item => (
                        <div key={item} className="flex items-start gap-2 text-[12px] text-slate-400">
                          <span className="text-violet-500 mt-0.5 shrink-0">→</span> {item}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-3 border-t border-white/5 text-[11px] text-slate-600">
                      Three modes:&nbsp;
                      <span className="text-violet-400">Single</span> (one molecule, under 30 seconds) ·&nbsp;
                      <span className="text-blue-400">Batch</span> (async with callbacks) ·&nbsp;
                      <span className="text-emerald-400">Cascade</span> (full layer pipeline in one call). Open contract, vendor-neutral.
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
                    The first gate is a fast in-vitro twin: structural sanity, drug-likeness, ADMET profile with confidence intervals, target-binding estimate, and an organ-tox screen — each output tagged with a source-quality tier. The cascade gate issues a GO / WATCH / NO-GO verdict and seals an EvidencePointer for the next layer to consume.
                  </p>
                  <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/5 divide-y divide-white/5">
                      {[
                        ["ADMET Profile",       "Absorption · distribution · metabolism · excretion · toxicity with confidence intervals."],
                        ["Drug-Likeness",       "Industry-standard medicinal-chemistry rules with rule-by-rule provenance."],
                        ["Target Binding",      "Affinity estimate against the user-specified protein, with a quality tier per output."],
                        ["Cascade Gate",        "GO / WATCH / NO-GO verdict feeding a sealed EvidencePointer into Layer 2."],
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
                  <h4 className="text-[18px] font-bold text-white mb-2">Does the L1 verdict survive confirmation?</h4>
                  <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                    Two parallel sub-tracks, both entirely computational. An <span className="text-blue-300">in-silico track</span> generates poses, projects affinity, runs a safety panel, and — optionally — refines free energy on GPU. A <span className="text-blue-300">virtual-tissue track</span> evaluates selectivity and tissue-level signals against curated human reference data — no physical tissue, no chip vendors. Both seal into a v2.0.0 ConfirmationBlock.
                  </p>
                  <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/5 divide-y divide-white/5">
                      {[
                        ["In-Silico Confirmation",  "Multi-stage pose + affinity + safety pipeline."],
                        ["Free-Energy Refinement",  "Optional GPU refinement when higher-confidence ΔG is required."],
                        ["Virtual-Tissue Panel",    "Selectivity & tissue-level signal against curated human reference data."],
                        ["Sealed Confirmation Block","v2.0.0 evidence package, EvidencePointer chain preserved."],
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
                  <h4 className="text-[18px] font-bold text-white mb-2">How does it behave across species?</h4>
                  <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                    Multi-species PBPK across the standard pre-clinical species, allometric scaling per ICH M3(R2), and a regulatory-grade formulation engine that respects route, dose form, and bioavailability constraints. Outputs species-by-species NOAEL with safety margins and the human-equivalent dose used to seed Layer 4.
                  </p>
                  <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/5 divide-y divide-white/5">
                      {[
                        ["Multi-species PBPK",  "Standard pre-clinical species — Cmax, AUC, t½, Vd, CL."],
                        ["Formulation Engine",  "Route- and dose-form-aware bioavailability."],
                        ["Allometric Scaling",  "ICH M3(R2)-aligned with the standard NOAEL safety factor."],
                        ["Regulatory Validation","Cross-validated against curated pre-clinical reference data."],
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
                  <h4 className="text-[18px] font-bold text-white mb-2">Are we IND-ready?</h4>
                  <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                    The Phase 1 Planner derives a defensible MABEL-biased starting dose (FDA/EMA aligned), evaluates the IND-enabling gate (GLP tox, CMC, Investigator's Brochure), and seals every piece of upstream evidence into a single PreClinicalPackage v2.0.0 — the artefact a CRO, regulator, or licensing partner can ingest as-is. The boundary into the clinic, not a clinical-trial simulator.
                  </p>
                  <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-white/5 divide-y divide-white/5">
                      {[
                        ["MABEL Starting Dose",  "FDA/EMA-aligned minimal anticipated biological effect level."],
                        ["IND-Enabling Gate",    "GLP tox · CMC · Investigator's Brochure · Pre-IND checklist."],
                        ["Phase 1 Planner",      "Cohort sizing · escalation rules · stopping criteria — derived, not authored."],
                        ["Sealed Handoff",       "PreClinicalPackage v2.0.0 with a complete provenance trail."],
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

      {/* ── On the Roadmap ── */}
      <section id="roadmap" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/25 bg-violet-500/8 mb-5">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              <span className="text-[11px] font-semibold text-violet-400 tracking-wide uppercase">On the roadmap</span>
            </div>
            <h2 className="text-[38px] font-black tracking-tight text-white mb-4">
              Continuously sharpening the cascade
            </h2>
            <p className="text-[15px] text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Every layer is governed by a dedicated upgrade roadmap — added depth where it sharpens decisions, with no compromise on the privacy boundary.
              Structural inputs stay client-side; the platform only ever processes one-way derived signals.
            </p>
          </div>

          {/* Roadmap grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">

            {/* Layer 1 roadmap */}
            <div className="rounded-2xl border border-violet-500/15 bg-violet-500/4 p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-full border border-violet-500/40 bg-violet-500/10 flex items-center justify-center text-[10px] font-black text-violet-400">L1</div>
                <span className="text-[11px] font-semibold text-violet-400 uppercase tracking-widest">In Vitro</span>
              </div>
              <div className="space-y-3">
                {[
                  ["Deeper ADMET",         "Higher-fidelity ADMET predictions with calibrated confidence intervals across every axis."],
                  ["Broader Target Coverage", "Affinity coverage expanded across well-characterised and emerging targets."],
                  ["Organ-Specific Safety", "Dedicated cardiac, hepatic, and renal safety predictions with quality-tier provenance."],
                ].map(([label, desc]) => (
                  <div key={label as string} className="border-t border-violet-500/10 pt-3 first:border-0 first:pt-0">
                    <div className="text-[12px] font-semibold text-white mb-1">{label}</div>
                    <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Layer 2 roadmap */}
            <div className="rounded-2xl border border-blue-500/15 bg-blue-500/4 p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-full border border-blue-500/40 bg-blue-500/10 flex items-center justify-center text-[10px] font-black text-blue-400">L2</div>
                <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-widest">Confirmation</span>
              </div>
              <div className="space-y-3">
                {[
                  ["No-Crystal Pose Generation", "Structural prediction for targets without a solved crystal — closing a major gap in modern medchem."],
                  ["Higher-Confidence ΔG",       "Optional refinement pass for cases where higher-confidence binding free-energy is decision-critical."],
                  ["Whole-Body PBPK",            "Richer compartmental physiology when single-organ projections aren't enough."],
                ].map(([label, desc]) => (
                  <div key={label as string} className="border-t border-blue-500/10 pt-3 first:border-0 first:pt-0">
                    <div className="text-[12px] font-semibold text-white mb-1">{label}</div>
                    <div className="text-[11px] text-slate-500 leading-snug">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Layer 3 + 4 roadmap */}
            <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/4 p-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center text-[10px] font-black text-amber-400">L3</div>
                <div className="w-7 h-7 -ml-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-[10px] font-black text-emerald-400">L4</div>
                <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-widest">Animal · FIH</span>
              </div>
              <div className="space-y-3">
                {[
                  ["Allometric Uncertainty",  "Credible intervals on FIH dose, ICH M3(R2)-aligned — replacing point-estimate scaling."],
                  ["IVIVC Bridging",          "In-vitro–in-vivo correlation translated automatically into absorption profiles."],
                  ["Smarter MABEL Selection", "Calibrated guidance on when MABEL — rather than NOAEL — should drive the starting dose."],
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
                Inference servers never receive your molecule's structure. The client derives a one-way signal locally and only that signal travels onward — cryptographically irreversible, so no server (including ours) can reconstruct your candidate.
              </p>
            </div>
            <div className="shrink-0 text-[10px] font-semibold px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/8 text-emerald-400">
              Zero-knowledge
            </div>
          </div>

        </div>
      </section>

      {/* ── Regulatory-Grade Evidence ── */}
      <section id="evidence" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-500/25 bg-blue-500/8 mb-5">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-[11px] font-semibold text-blue-400 tracking-wide uppercase">Now Live</span>
            </div>
            <h2 className="text-[38px] font-black tracking-tight text-white mb-4">
              Regulatory-grade evidence at every layer
            </h2>
            <p className="text-[15px] text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Every output is backed by curated, regulator-recognised reference data — pharmacokinetics, pharmacodynamics, real-world safety, and pre-clinical physiology. No synthetic fallbacks, no opaque fabrications.
            </p>
          </div>

          {/* 4 evidence cards — capability-level, no specific datasets */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">

            {[
              {
                tag: "L3 · Pharmacokinetics",
                title: "Multi-Species PBPK",
                desc: "Pharmacokinetic projections across the standard pre-clinical species — clearance, volume, half-life, and exposure — anchored to curated physiology reference data and ICH M3(R2)-aligned scaling.",
                chips: ["Multi-species", "ICH M3(R2)", "Physiology-anchored"],
                color: "blue",
              },
              {
                tag: "L3 · Allometric Scaling",
                title: "NOAEL → HED with Uncertainty",
                desc: "Resampled allometric scaling translates pre-clinical no-effect doses to a human-equivalent dose with credible intervals, and the standard safety factor is applied before any Layer 4 handoff.",
                chips: ["Credible intervals", "Standard safety factor", "ICH M3(R2)"],
                color: "blue",
              },
              {
                tag: "L2 · Pharmacodynamics",
                title: "Real-Assay PD Coupling",
                desc: "Pharmacodynamic coupling is seeded with curated, real-assay potency data for the nearest validated reference compound — never synthetic, never imputed.",
                chips: ["Curated bioactivity", "Real-assay anchoring", "Therapeutic-index ranking"],
                color: "violet",
              },
              {
                tag: "L4 · Safety Signal",
                title: "Real-World AE Calibration",
                desc: "First-in-human safety inputs are calibrated against real-world pharmacovigilance signal for the nearest validated reference class — backing the Investigator's Brochure with grounded evidence.",
                chips: ["Pharmacovigilance signal", "Regulator-aligned", "Real-world grounded"],
                color: "emerald",
              },
            ].map(({ tag, title, desc, chips, color }) => {
              const tone =
                color === "violet"  ? { bd: "border-violet-500/20",  bg: "bg-violet-500/4",  tx: "text-violet-400",  chip: "border-violet-500/15 text-violet-400/70",  pill: "border-violet-500/30 bg-violet-500/10 text-violet-300"  } :
                color === "emerald" ? { bd: "border-emerald-500/20", bg: "bg-emerald-500/4", tx: "text-emerald-400", chip: "border-emerald-500/15 text-emerald-400/70", pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" } :
                                       { bd: "border-blue-500/20",    bg: "bg-blue-500/4",    tx: "text-blue-400",    chip: "border-blue-500/15 text-blue-400/70",    pill: "border-blue-500/30 bg-blue-500/10 text-blue-300"    };
              return (
                <div key={title} className={`rounded-2xl border ${tone.bd} ${tone.bg} p-6`}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className={`text-[10px] uppercase tracking-widest font-semibold mb-0.5 ${tone.tx}`}>{tag}</div>
                      <div className="text-[14px] font-bold text-white">{title}</div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${tone.pill}`}>Live</span>
                  </div>
                  <p className="text-[12px] text-slate-500 leading-relaxed mb-4">{desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map(t => (
                      <span key={t} className={`text-[10px] px-2 py-0.5 rounded-full border ${tone.chip}`}>{t}</span>
                    ))}
                  </div>
                </div>
              );
            })}

          </div>

          {/* Trust summary bar */}
          <div className="rounded-2xl border border-white/8 bg-white/3 px-6 py-5 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-[12px] font-semibold text-white mb-0.5">Structural inputs stay client-side — the platform only ever processes one-way derived signals</div>
              <div className="text-[11px] text-slate-500">Layer 1 runs in your browser · Layers 2–4 process derived signals server-side · no structural data leaves your environment</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {[
                { label: "Curated PK",       color: "blue"    },
                { label: "Real-World AE",    color: "emerald" },
                { label: "Real-Assay PD",    color: "violet"  },
                { label: "Reg. Physiology",  color: "blue"    },
              ].map(({ label, color }) => (
                <div key={label} className={`text-center px-3 py-2 rounded-xl border ${
                  color === "violet"  ? "border-violet-500/20 bg-violet-500/5"
                  : color === "emerald" ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-blue-500/20 bg-blue-500/5"
                }`}>
                  <div className={`text-[11px] font-bold ${color === "violet" ? "text-violet-300" : color === "emerald" ? "text-emerald-300" : "text-blue-300"}`}>{label}</div>
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

          {/* Split architecture diagram — capability-level only */}
          <div className="grid md:grid-cols-2 gap-px bg-white/5 rounded-2xl overflow-hidden border border-white/8 mb-12">
            {/* Client side */}
            <div className="bg-[#0d0f17] p-8">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" />
                <div className="text-[11px] font-semibold uppercase tracking-widest text-emerald-500">Your Device · Client-side</div>
              </div>
              <div className="space-y-2.5">
                {[
                  "Molecular structure handling",
                  "2D and 3D structure visualisation",
                  "Local property calculation",
                  "One-way signal derivation",
                  "Structure file import and parsing",
                  "Encrypted local project storage",
                  "Export and download generation",
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
                <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-500">Platform API · Server-side</div>
              </div>
              <div className="space-y-2.5">
                {[
                  "Inference over derived signals only",
                  "Confirmation-layer compute",
                  "Pharmacokinetic projections",
                  "Optional accelerated refinement",
                  "Provenance, sealing, audit trail",
                  "Authentication and access control",
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
                  "Never receives molecular structures",
                  "Never stores structural inputs",
                  "Derived signals discarded after inference",
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
                label: "Client-side compute",
                desc: "Industry-standard chemistry primitives run natively on your machine. Structure parsing, validation, property calculation, and one-way signal derivation all happen locally — no structural data needs to travel anywhere.",
              },
              {
                color: "violet",
                border: "border-violet-500/20",
                bg: "bg-violet-500/5",
                label: "Inference on derived signals only",
                desc: "The platform sees a one-way derived signal — mathematically irreversible to the original molecule. Like sending a fingerprint instead of the person: enough to predict, never enough to reconstruct.",
              },
              {
                color: "blue",
                border: "border-blue-500/20",
                bg: "bg-blue-500/5",
                label: "Encrypted local storage",
                desc: "Projects are encrypted at rest on your device. Your saved candidates and history live on your machine — platform servers have zero access. Inspect the network traffic yourself if you'd like to verify it.",
              },
            ].map(({ color, border, bg, label, desc }) => (
              <div key={label} className={`rounded-2xl border ${border} ${bg} p-6`}>
                <div className={`text-[9px] uppercase tracking-widest font-semibold mb-3 ${
                  color === "emerald" ? "text-emerald-500" : color === "violet" ? "text-violet-500" : "text-blue-500"
                }`}>Trust Pillar</div>
                <h3 className="text-[15px] font-bold text-white mb-3">{label}</h3>
                <p className="text-[12px] text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* Proof statement */}
          <div className="mt-10 text-center">
            <p className="text-[13px] text-slate-600 max-w-2xl mx-auto">
              Standard, well-understood primitives run on your device. The platform only ever receives one-way derived signals — and you can verify this architecture by inspecting the network traffic yourself.
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
          <img src={hakaseLogo} alt="HakaseAI" className="hk-logo h-5 w-auto object-contain opacity-70" />
          <span>BioDigital Twin Platform · {RELEASE.version} · {RELEASE.date}</span>
        </div>
        <div>Hakase AI · {RELEASE.date} · Confidential</div>
      </footer>
    </div>
  );
}
