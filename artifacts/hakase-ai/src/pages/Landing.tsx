import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { MolViewer3D_Cinematic } from "./MolViewer3D_Cinematic";
import { MolViewer3D_Scientific } from "./MolViewer3D_Scientific";
import { MolViewer3D_Explorer } from "./MolViewer3D_Explorer";

const LAYERS = [
  {
    num: "01",
    name: "Molecular Digital Twin",
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
    question: "Is this molecule safe and drug-like?",
    metrics: ["ADMET Prediction", "Target Binding (nM)", "Toxicity Signals", "Drug-likeness (QED)", "Go / No-Go verdict"],
  },
  {
    num: "02",
    name: "Patient Cohort Twin",
    color: "blue",
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    dot: "bg-blue-500",
    glow: "shadow-blue-500/20",
    badge: "bg-blue-500/15 text-blue-300",
    icon: (
      <svg viewBox="0 0 48 48" className="w-10 h-10" fill="none">
        {[8, 18, 28, 38].map((x, i) => (
          <g key={x}>
            <circle cx={x} cy="18" r="5" stroke="#3b82f6" strokeWidth="1.5" opacity={1 - i * 0.15} />
            <path d={`M${x - 6} 30 Q${x} 22 ${x + 6} 30`} stroke="#3b82f6" strokeWidth="1.5" opacity={1 - i * 0.15} fill="none" />
          </g>
        ))}
        <line x1="4" y1="40" x2="44" y2="40" stroke="#3b82f6" strokeWidth="1" opacity="0.3" />
      </svg>
    ),
    runtime: "2–7 min",
    question: "Which patients respond, and at what dose?",
    metrics: ["PK/PD Concentration Curves", "Responder Classification", "Adverse Event Predictions", "Subgroup Heatmap", "Dose-Response Curve"],
  },
  {
    num: "03",
    name: "Trial Digital Twin",
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
        <path d="M10 38 Q14 28 18 32 Q22 36 26 24 Q30 12 34 20 Q36 24 38 22" stroke="#22c55e" strokeWidth="1.5" fill="none" />
        <circle cx="26" cy="24" r="2.5" fill="#22c55e" />
        <text x="23" y="16" fill="#22c55e" fontSize="5" fontFamily="monospace">72.4%</text>
      </svg>
    ),
    runtime: "15–30 min",
    question: "Will the clinical trial succeed?",
    metrics: ["Trial Success Probability", "Optimal Sample Size", "Enrollment Trajectory", "Synthetic Control Arm", "Cost Estimation"],
  },
];

const STATS = [
  { val: "90%", label: "of drug trials fail" },
  { val: "30–50%", label: "faster pre-clinical" },
  { val: "$50M+", label: "per prevented failure" },
  { val: "10–15 yr", label: "pipeline compressed" },
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
  const [activeViewer, setActiveViewer] = useState<"cinematic" | "scientific" | "explorer">("cinematic");

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-['Inter',sans-serif] overflow-x-hidden">
      <AnimatedGrid />

      {/* ── Nav ── */}
      <nav className="relative z-10 flex items-center justify-between px-8 py-5 border-b border-white/5 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
            </svg>
          </div>
          <span className="text-[15px] font-semibold tracking-tight">HakaseAI</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-slate-400 font-mono">v1.0</span>
        </div>
        <div className="hidden md:flex items-center gap-6 text-[13px] text-slate-400">
          <a href="#platform" className="hover:text-white transition-colors">Platform</a>
          <a href="#layers" className="hover:text-white transition-colors">Simulation Layers</a>
          <a href="#diagen" className="hover:text-white transition-colors">Diagen Integration</a>
          <a href="#why" className="hover:text-white transition-colors">Why Hakase</a>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/login")}
            className="text-[13px] text-slate-400 hover:text-white transition-colors px-3 py-1.5"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate("/login")}
            className="text-[13px] font-semibold px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 transition-colors text-white"
          >
            Get Started →
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section id="platform" className="relative z-10 pt-28 pb-20 px-6 text-center">
        <h1 className="text-[56px] md:text-[72px] font-black tracking-tighter leading-none mb-6 max-w-4xl mx-auto">
          <span className="text-white">From Molecule</span>
          <br />
          <span className="bg-gradient-to-r from-violet-400 via-blue-400 to-emerald-400 bg-clip-text text-transparent">
            to Medicine.
          </span>
        </h1>

        <p className="text-[17px] text-slate-400 max-w-2xl mx-auto leading-relaxed mb-10">
          HakaseAI simulates the full drug development journey — molecular safety, patient cohort response, and clinical trial outcomes — before committing a single dollar to physical trials.
        </p>

        <div className="flex items-center justify-center gap-4 flex-wrap">
          <button
            onClick={() => navigate("/login")}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[14px] transition-all shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40"
          >
            Launch BioDigital Twin
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
          <button
            onClick={() => navigate("/login")}
            className="flex items-center gap-2 px-6 py-3 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:border-white/25 font-medium text-[14px] transition-all"
          >
            View Demo
          </button>
        </div>

        {/* Pipeline visual */}
        <div className="mt-20 flex items-center justify-center gap-0 flex-wrap">
          {[
            { label: "DIAGEN", sub: "Generate", color: "text-violet-400", border: "border-violet-500/30", bg: "bg-violet-500/8" },
            null,
            { label: "LAYER 1", sub: "Molecular Twin", color: "text-violet-300", border: "border-violet-500/20", bg: "bg-violet-500/5" },
            null,
            { label: "LAYER 2", sub: "Cohort Twin", color: "text-blue-300", border: "border-blue-500/20", bg: "bg-blue-500/5" },
            null,
            { label: "LAYER 3", sub: "Trial Twin", color: "text-emerald-300", border: "border-emerald-500/20", bg: "bg-emerald-500/5" },
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
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-3">Three Cascading Layers</div>
            <h2 className="text-[40px] font-black tracking-tight text-white">One end-to-end pipeline</h2>
            <p className="text-[15px] text-slate-500 mt-3 max-w-xl mx-auto">
              Each layer builds on the previous. Outputs cascade automatically — no copy-paste, no data loss.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
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

      {/* ── Diagen Integration ── */}
      <section id="diagen" className="relative z-10 py-24 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-violet-500 mb-4">Hakase Ecosystem</div>
              <h2 className="text-[38px] font-black tracking-tight text-white leading-tight mb-4">
                Seamlessly connected<br />with Diagen AI
              </h2>
              <p className="text-[15px] text-slate-400 leading-relaxed mb-6">
                Diagen AI generates optimized drug candidates. BioDigital Twin validates them. Together they form the only platform that goes from molecular generation to trial simulation without leaving the Hakase ecosystem.
              </p>
              <div className="space-y-3">
                {[
                  { mode: "Synchronous", desc: "Single molecule import in under 30 seconds", color: "text-violet-400" },
                  { mode: "Async Batch", desc: "Webhook-driven batch processing with job IDs", color: "text-blue-400" },
                  { mode: "Cascade", desc: "Auto-runs L1 → L2 → L3 in one pipeline call", color: "text-emerald-400" },
                ].map(({ mode, desc, color }) => (
                  <div key={mode} className="flex items-start gap-3">
                    <span className={`text-[12px] font-semibold w-28 shrink-0 pt-0.5 ${color}`}>{mode}</span>
                    <span className="text-[13px] text-slate-500">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#0d0f17] border border-white/8 rounded-2xl p-5 font-mono text-[12px] space-y-2">
              <div className="text-slate-600 mb-3">{`// Diagen → BioDigital Twin handoff`}</div>
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
              <div className="pt-2 border-t border-white/5 text-slate-600">{`// → Triggers L1 → L2 → L3 automatically`}</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3D Viewer — live embedded ── */}
      <section className="relative z-10 py-20 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-4">3D Molecular Visualization</div>
            <h2 className="text-[36px] font-black tracking-tight text-white mb-3">
              Three ways to see your molecule
            </h2>
            <p className="text-[15px] text-slate-400 max-w-2xl mx-auto">
              Every viewer is fully interactive — rotate, zoom, switch render modes and inspect atom-level properties without leaving the platform.
            </p>
          </div>

          {/* Tab switcher */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex items-center gap-1 bg-[#0d0f17] border border-white/10 rounded-2xl p-1.5">
              {([
                { key: "cinematic", label: "Cinematic", emoji: "🎬", accent: "violet" },
                { key: "scientific", label: "Scientific", emoji: "🔬", accent: "blue" },
                { key: "explorer",  label: "Explorer",  emoji: "🧬", accent: "emerald" },
              ] as const).map(({ key, label, emoji, accent }) => (
                <button
                  key={key}
                  onClick={() => setActiveViewer(key)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 ${
                    activeViewer === key
                      ? accent === "violet"
                        ? "bg-violet-600/25 border border-violet-500/40 text-violet-300 shadow-lg shadow-violet-900/30"
                        : accent === "blue"
                        ? "bg-blue-600/25 border border-blue-500/40 text-blue-300 shadow-lg shadow-blue-900/30"
                        : "bg-emerald-600/25 border border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-900/30"
                      : "text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <span>{emoji}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Viewer description strip */}
          <div className="text-center mb-4 h-8 flex items-center justify-center">
            {activeViewer === "cinematic" && (
              <p className="text-[13px] text-slate-500">
                <span className="text-violet-400 font-medium">Cinematic mode</span> — auto-rotating, presentation-quality rendering with dramatic lighting and molecular surface overlays.
              </p>
            )}
            {activeViewer === "scientific" && (
              <p className="text-[13px] text-slate-500">
                <span className="text-blue-400 font-medium">Scientific mode</span> — split-panel layout with atom tables, bond angles, energy breakdown, and protein–ligand contacts.
              </p>
            )}
            {activeViewer === "explorer" && (
              <p className="text-[13px] text-slate-500">
                <span className="text-emerald-400 font-medium">Explorer mode</span> — multi-molecule library browser with side-by-side 3D comparison and composite scoring.
              </p>
            )}
          </div>

          {/* Live viewer frame */}
          <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/60" style={{ height: "640px" }}>
            {/* Browser chrome bar */}
            <div className="absolute top-0 left-0 right-0 h-9 bg-[#0a0b10]/95 backdrop-blur-sm border-b border-white/8 flex items-center px-4 gap-3 z-20 pointer-events-none">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/50" />
              </div>
              <div className="flex-1 mx-4">
                <div className="mx-auto max-w-xs bg-white/5 border border-white/8 rounded-md px-3 py-1 text-[10px] text-slate-500 font-mono text-center">
                  hakase.ai / molecular-viewer / {activeViewer}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
                  activeViewer === "cinematic" ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : activeViewer === "scientific" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                }`}>
                  ● LIVE
                </div>
              </div>
            </div>

            {/* Viewer content — scrolled down 36px to hide the top bar inside each viewer */}
            <div className="absolute inset-0 top-9 overflow-hidden">
              <div style={{ height: "100vh", marginTop: "-0px", pointerEvents: "all" }}>
                {activeViewer === "cinematic" && <MolViewer3D_Cinematic />}
                {activeViewer === "scientific" && <MolViewer3D_Scientific />}
                {activeViewer === "explorer"  && <MolViewer3D_Explorer />}
              </div>
            </div>

            {/* Bottom fade gradient */}
            <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none z-10"
              style={{ background: "linear-gradient(to top, #07080c 0%, transparent 100%)" }} />
          </div>

          {/* Feature chips below viewer */}
          <div className="flex justify-center gap-3 mt-6 flex-wrap">
            {[
              "Ball & Stick", "VDW Surface", "Wireframe", "Space Fill",
              "Atom Labels", "H-Bond Overlay", "Pharmacophore", "Docking Pose",
            ].map(f => (
              <div key={f} className="text-[11px] px-3 py-1 rounded-full border border-white/10 text-slate-500 bg-white/3">
                {f}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative z-10 py-28 px-6 border-t border-white/5 text-center">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-violet-600/8 rounded-full blur-[100px]" />
        </div>
        <h2 className="relative text-[44px] font-black tracking-tight text-white mb-4">
          Ready to simulate?
        </h2>
        <p className="relative text-[16px] text-slate-400 max-w-xl mx-auto mb-8">
          Join the platform that compresses 10–15 years of drug development into weeks of simulation.
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
          <div className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-violet-700" />
          HakaseAI · BioDigital Twin Platform · v1.0
        </div>
        <div>Hakase AI · March 2026 · Confidential</div>
      </footer>
    </div>
  );
}
