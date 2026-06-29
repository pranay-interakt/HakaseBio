import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Play, Pause, Zap } from "lucide-react";

type Layer = 1 | 2 | 3 | 4;
type SimStatus = "idle" | "running" | "complete" | "error";

export interface DemoRunnerProps {
  onClose: () => void;
  setSmiles: (s: string) => void;
  setMolName: (s: string) => void;
  setUniprotId: (s: string) => void;
  setActiveLayer: (l: Layer) => void;
  runSimulation: () => void;
  simStatus: Record<Layer, SimStatus>;
  activeLayer: Layer;
}

interface DemoStep {
  id: string;
  title: string;
  body: string;
  targetId?: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
  onEnter?: () => void;
  autoSecs?: number;
  awaitLayer?: Layer;
  layerColor?: "violet" | "amber" | "blue" | "emerald";
  icon?: string;
}

const DEMO_SMILES = "CCc1nn(C)c2c(=O)[nH]c(-c3cc(S(=O)(=O)N4CCN(C)CC4)ccc3OCC)nc12";
const DEMO_MOL_NAME = "HAK-DEMO-001";
const DEMO_UNIPROT = "P00533";

const COLOR_MAP = {
  violet: { ring: "rgba(139,92,246,0.7)", glow: "rgba(139,92,246,0.15)", text: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/30" },
  amber:  { ring: "rgba(245,158,11,0.7)",  glow: "rgba(245,158,11,0.15)",  text: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/30"  },
  blue:   { ring: "rgba(59,130,246,0.7)",  glow: "rgba(59,130,246,0.15)",  text: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/30"    },
  emerald:{ ring: "rgba(16,185,129,0.7)",  glow: "rgba(16,185,129,0.15)",  text: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/30" },
};

export function DemoRunner({
  onClose, setSmiles, setMolName, setUniprotId,
  setActiveLayer, runSimulation, simStatus, activeLayer,
}: DemoRunnerProps) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [spotRect, setSpotRect] = useState<DOMRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enteredRef = useRef<Set<string>>(new Set());
  const awaitFiredRef = useRef(false);

  const steps = useMemo<DemoStep[]>(() => [
    {
      id: "welcome",
      title: "Welcome to HakaseAI Demo",
      body: "This guided tour runs through all 4 simulation layers automatically — from a raw SMILES string to a full clinical trial verdict. Sit back and watch, or click Next to advance manually.",
      position: "center",
      autoSecs: 6,
      icon: "🧬",
      layerColor: "violet",
    },
    {
      id: "load-molecule",
      title: "Input · SMILES String",
      body: "Every simulation starts here. Paste any SMILES string and RDKit.js validates it in real-time — computing molecular weight, LogP, TPSA, HBD, and HBA on the fly. We've loaded HAK-DEMO-001, an EGFR-targeting kinase inhibitor.",
      targetId: "demo-smiles-input",
      position: "right",
      onEnter: () => { setSmiles(DEMO_SMILES); setMolName(DEMO_MOL_NAME); setUniprotId(DEMO_UNIPROT); setActiveLayer(1); },
      autoSecs: 6,
      icon: "⚗️",
      layerColor: "violet",
    },
    {
      id: "target-protein",
      title: "Input · Target Protein Configuration",
      body: "Enter a UniProt accession (e.g. P00533 = EGFR) and click Fetch to pull live protein data — gene name, organism, function, binding sites, and known crystal structures. The PDB Structure field auto-populates with the best resolved structure for molecular docking.",
      targetId: "demo-target-protein",
      position: "right",
      autoSecs: 7,
      icon: "🧬",
      layerColor: "violet",
    },
    {
      id: "sim-options",
      title: "Input · Simulation Options",
      body: "Toggle which engines to run. ADMET Prediction is always on — it scores Absorption, Distribution, Metabolism, Excretion, and Toxicity. Binding Simulation runs QSAR-based docking against your target protein. Toxicity Signal Detection cross-references FAERS adverse event reports. The Confidence Threshold controls how strict the GO/NO-GO gate is.",
      targetId: "demo-sim-options",
      position: "right",
      autoSecs: 8,
      icon: "⚙️",
      layerColor: "violet",
    },
    {
      id: "l1-run",
      title: "Layer 1 · Running In Vitro Simulation",
      body: "Launching the full Layer 1 pipeline: in vitro assay simulation (IC50 dose-response, Caco-2 permeability, metabolic clearance, hERG safety, selectivity panel) plus directional ADMET scoring and GO / WATCH / NO-GO decision tree.",
      targetId: "demo-run-l1",
      position: "top",
      onEnter: () => { setTimeout(() => runSimulation(), 400); },
      awaitLayer: 1,
      icon: "🔬",
      layerColor: "violet",
    },
    {
      id: "results-explained",
      title: "Results · What You're Seeing",
      body: "The right panel now shows: GO/NO-GO verdict, in vitro score, IC50 dose-response curve, Caco-2 permeability, metabolic clearance with CYP panel, hERG channel safety, selectivity profile, and a collapsible directional ADMET radar. Every metric derives from the molecular structure.",
      targetId: "demo-results",
      position: "center",
      autoSecs: 8,
      icon: "📋",
      layerColor: "violet",
    },
    {
      id: "l1-complete",
      title: "Layer 1 Complete · GO Verdict",
      body: "The molecule passed in vitro safety screening. IC50 in the nanomolar range for EGFR, good Caco-2 permeability, acceptable hERG margin, and a favourable selectivity profile. The In Vitro Digital Twin gives a GO verdict — safe to advance to preclinical species studies.",
      targetId: "demo-layer-nav",
      position: "bottom",
      autoSecs: 6,
      icon: "✅",
      layerColor: "violet",
    },
    {
      id: "l2-start",
      title: "Layer 2 · Animal Cohort Twin",
      body: "Layer 1 results cascade automatically into the Animal Cohort engine. We'll simulate rat, dog, and monkey PBPK — then use allometric scaling to derive a safe first-in-human starting dose.",
      targetId: "demo-layer-nav",
      position: "bottom",
      onEnter: () => { setActiveLayer(2); },
      autoSecs: 4,
      icon: "🐀",
      layerColor: "amber",
    },
    {
      id: "l2-run",
      title: "Layer 2 · PBPK + Formulation Engine Running",
      body: "Simulating multi-species pharmacokinetics. The BCS classification engine selected SNEDDS formulation for optimal oral bioavailability. Two-compartment RK4 ODE solver running across all species.",
      targetId: "demo-run-l2",
      position: "top",
      onEnter: () => { setTimeout(() => runSimulation(), 400); },
      awaitLayer: 2,
      icon: "🧪",
      layerColor: "amber",
    },
    {
      id: "l2-complete",
      title: "Layer 2 Complete · FIH Dose Scaled",
      body: "NOAEL in rat: ~100 mg/kg. Using allometric body-weight scaling (exponent 0.75 for clearance) per ICH M3(R2) guidance, the recommended first-in-human starting dose is ~1.2 mg/kg. Advancing to Patient Cohort.",
      targetId: "demo-layer-nav",
      position: "bottom",
      autoSecs: 6,
      icon: "📊",
      layerColor: "amber",
    },
    {
      id: "l3-start",
      title: "Layer 3 · Patient Cohort Twin",
      body: "The FIH dose from Layer 2 auto-seeds the cohort simulation. We'll generate 500 virtual patients with demographic variance, pharmacogenomics, and comorbidities — then run population PK/PD in-browser.",
      targetId: "demo-layer-nav",
      position: "bottom",
      onEnter: () => { setActiveLayer(3); },
      autoSecs: 4,
      icon: "👥",
      layerColor: "blue",
    },
    {
      id: "l3-run",
      title: "Layer 3 · Cohort Simulation Running",
      body: "Building 500 virtual patients. Sigmoidal Emax dose-response model computing responder rates. Organ-risk flags from Layer 1 mapping to CTCAE-graded adverse events. FAERS signals being matched.",
      targetId: "demo-run-l3",
      position: "top",
      onEnter: () => { setTimeout(() => runSimulation(), 400); },
      awaitLayer: 3,
      icon: "📈",
      layerColor: "blue",
    },
    {
      id: "l3-complete",
      title: "Layer 3 Complete · 78% Responder Rate",
      body: "PK/PD curves show the drug stays within the therapeutic window for 78% of simulated patients. Biomarker-positive subgroup achieves 91% response. DLT rate is 8.2% — well below the 33% threshold. Advancing to Trial.",
      targetId: "demo-layer-nav",
      position: "bottom",
      autoSecs: 6,
      icon: "💊",
      layerColor: "blue",
    },
    {
      id: "l4-start",
      title: "Layer 4 · Trial Digital Twin",
      body: "All prior simulation outputs cascade into the trial engine. We'll model a Phase II adaptive design — calculating statistical power, enrollment trajectories, interim analysis boundaries, site rankings, and total cost.",
      targetId: "demo-layer-nav",
      position: "bottom",
      onEnter: () => { setActiveLayer(4); },
      autoSecs: 4,
      icon: "🏥",
      layerColor: "emerald",
    },
    {
      id: "l4-run",
      title: "Layer 4 · Trial Simulation Running",
      body: "Calculating sample size via exact normal CDF power formula. Weibull parametric survival for Kaplan-Meier curves. O'Brien-Fleming spending function for adaptive interim analyses. Enrollment modeled by site.",
      targetId: "demo-run-l4",
      position: "top",
      onEnter: () => { setTimeout(() => runSimulation(), 400); },
      awaitLayer: 4,
      icon: "⚡",
      layerColor: "emerald",
    },
    {
      id: "l4-complete",
      title: "Trial Simulation Complete · GO Verdict",
      body: "Trial success probability: 82% (95% CI: 74–89%). Optimal sample size: 240 patients across 12 sites. Projected 26-month timeline. Estimated cost: $4.2M. The full pipeline says: this drug program is GO.",
      targetId: "demo-layer-nav",
      position: "bottom",
      autoSecs: 7,
      icon: "🏆",
      layerColor: "emerald",
    },
    {
      id: "full-ai-report",
      title: "Full AI Report · Cross-Layer Intelligence",
      body: "Click \"Full AI Report\" to generate a comprehensive Claude-powered analysis synthesizing all 4 layers — in vitro assay data, preclinical findings, patient cohort outcomes, and trial projections — into a single structured report with GO/NO-GO rationale, risk flags, and recommended next steps. Available after any layer completes.",
      targetId: "demo-full-ai-report",
      position: "bottom",
      autoSecs: 9,
      icon: "✨",
      layerColor: "violet",
    },
    {
      id: "end",
      title: "Demo Complete · All 4 Layers",
      body: "You just ran a complete drug development simulation — from SMILES string to trial verdict — entirely in the browser with no server-side computation. This is HakaseAI: BioDigital Twin for drug discovery.",
      position: "center",
      icon: "🚀",
      layerColor: "violet",
    },
  ], [setSmiles, setMolName, setUniprotId, setActiveLayer, runSimulation]);

  const currentStep = steps[step];
  const color = COLOR_MAP[currentStep.layerColor ?? "violet"];
  const isLastStep = step === steps.length - 1;
  const isFirstStep = step === 0;

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const advanceStep = useCallback(() => {
    setStep(s => Math.min(s + 1, steps.length - 1));
    awaitFiredRef.current = false;
  }, [steps.length]);

  const goBack = useCallback(() => {
    setStep(s => Math.max(s - 1, 0));
    awaitFiredRef.current = false;
    clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    const s = steps[step];

    if (!enteredRef.current.has(s.id)) {
      enteredRef.current.add(s.id);
      if (s.onEnter) s.onEnter();
    }

    const el = s.targetId ? document.getElementById(s.targetId) : null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      setTimeout(() => setSpotRect(el.getBoundingClientRect()), 300);
    } else {
      setSpotRect(null);
    }

    clearTimer();
    if (playing && s.autoSecs && !s.awaitLayer) {
      timerRef.current = setTimeout(advanceStep, s.autoSecs * 1000);
    }
    return clearTimer;
  }, [step, playing, steps, clearTimer, advanceStep]);

  useEffect(() => {
    const s = steps[step];
    if (!s.awaitLayer) return;
    if (simStatus[s.awaitLayer] === "complete" && !awaitFiredRef.current) {
      awaitFiredRef.current = true;
      clearTimer();
      timerRef.current = setTimeout(advanceStep, 1800);
    }
  }, [simStatus, step, steps, clearTimer, advanceStep]);

  useEffect(() => {
    const el = currentStep.targetId ? document.getElementById(currentStep.targetId) : null;
    if (!el) return;
    const onResize = () => setSpotRect(el.getBoundingClientRect());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [currentStep.targetId]);

  const calloutStyle = useMemo(() => {
    if (!spotRect || currentStep.position === "center" || !currentStep.targetId) return {};
    const PAD = 16;
    const CARD_W = 420;
    const pos = currentStep.position ?? "bottom";

    if (pos === "bottom") {
      return { top: spotRect.bottom + PAD, left: Math.max(8, Math.min(spotRect.left, window.innerWidth - CARD_W - 8)) };
    }
    if (pos === "top") {
      return { bottom: window.innerHeight - spotRect.top + PAD, left: Math.max(8, Math.min(spotRect.left, window.innerWidth - CARD_W - 8)) };
    }
    if (pos === "right") {
      return { top: Math.max(8, spotRect.top), left: spotRect.right + PAD };
    }
    if (pos === "left") {
      return { top: Math.max(8, spotRect.top), right: window.innerWidth - spotRect.left + PAD };
    }
    return {};
  }, [spotRect, currentStep]);

  const isCentered = currentStep.position === "center" || !currentStep.targetId;
  const awaitingSimulation = !!currentStep.awaitLayer && simStatus[currentStep.awaitLayer] === "running";

  return createPortal(
    <>
      {/* Dark overlay — cuts out the spotlight using box-shadow */}
      {spotRect ? (
        <div
          className="fixed inset-0 z-[998] pointer-events-none"
          style={{
            background: "rgba(0,0,0,0.0)",
          }}
        >
          <div
            className="absolute rounded-xl pointer-events-none"
            style={{
              top: spotRect.top - 8,
              left: spotRect.left - 8,
              width: spotRect.width + 16,
              height: spotRect.height + 16,
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.72), 0 0 0 2px ${color.ring}, 0 0 24px ${color.glow}`,
              zIndex: 998,
            }}
          />
        </div>
      ) : (
        <div className="fixed inset-0 z-[998] pointer-events-none bg-black/65" />
      )}

      {/* Callout card */}
      <div
        className={`fixed z-[999] w-[420px] rounded-2xl border bg-[#0d0f17]/98 backdrop-blur-xl shadow-2xl shadow-black/80 ${
          isCentered ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" : ""
        }`}
        style={isCentered ? {} : { ...calloutStyle, position: "fixed" }}
      >
        {/* Top color stripe */}
        <div className={`h-1 w-full rounded-t-2xl ${
          currentStep.layerColor === "amber" ? "bg-gradient-to-r from-amber-500 to-amber-400" :
          currentStep.layerColor === "blue" ? "bg-gradient-to-r from-blue-500 to-blue-400" :
          currentStep.layerColor === "emerald" ? "bg-gradient-to-r from-emerald-500 to-emerald-400" :
          "bg-gradient-to-r from-violet-500 to-violet-400"
        }`} />

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              {currentStep.icon && (
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[16px] shrink-0 ${color.bg}`}>
                  {currentStep.icon}
                </div>
              )}
              <div>
                <div className={`text-[9px] uppercase tracking-widest font-semibold mb-0.5 ${color.text}`}>
                  Step {step + 1} of {steps.length}
                </div>
                <h3 className="text-[14px] font-bold text-white leading-tight">{currentStep.title}</h3>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-colors shrink-0 mt-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-[12px] text-slate-400 leading-relaxed mb-4">{currentStep.body}</p>

          {/* Simulation awaiting indicator */}
          {awaitingSimulation && (
            <div className={`mb-4 rounded-lg border p-2.5 flex items-center gap-2 ${color.bg}`}>
              <div className={`w-2 h-2 rounded-full animate-pulse ${
                currentStep.layerColor === "amber" ? "bg-amber-400" :
                currentStep.layerColor === "blue" ? "bg-blue-400" :
                currentStep.layerColor === "emerald" ? "bg-emerald-400" :
                "bg-violet-400"
              }`} />
              <span className={`text-[11px] font-medium ${color.text}`}>
                Simulation running — auto-advancing when complete…
              </span>
            </div>
          )}

          {/* Progress bar */}
          {(currentStep.autoSecs && playing && !currentStep.awaitLayer) && (
            <div className="mb-4">
              <div className="h-0.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    currentStep.layerColor === "amber" ? "bg-amber-500" :
                    currentStep.layerColor === "blue" ? "bg-blue-500" :
                    currentStep.layerColor === "emerald" ? "bg-emerald-500" :
                    "bg-violet-500"
                  }`}
                  style={{
                    animation: `demo-progress ${currentStep.autoSecs}s linear forwards`,
                  }}
                  key={`${step}-${playing}`}
                />
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={goBack}
                disabled={isFirstStep}
                className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPlaying(p => !p)}
                disabled={awaitingSimulation}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button
                onClick={advanceStep}
                disabled={isLastStep}
                className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Step dots */}
            <div className="flex items-center gap-1">
              {steps.map((_, i) => (
                <div
                  key={i}
                  onClick={() => { clearTimer(); setStep(i); awaitFiredRef.current = false; }}
                  className={`rounded-full cursor-pointer transition-all duration-200 ${
                    i === step ? `w-4 h-1.5 ${
                      currentStep.layerColor === "amber" ? "bg-amber-400" :
                      currentStep.layerColor === "blue" ? "bg-blue-400" :
                      currentStep.layerColor === "emerald" ? "bg-emerald-400" :
                      "bg-violet-400"
                    }` : "w-1.5 h-1.5 bg-white/20 hover:bg-white/40"
                  }`}
                />
              ))}
            </div>

            {isLastStep ? (
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[12px] font-semibold transition-colors flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" /> Get Started
              </button>
            ) : (
              <button
                onClick={advanceStep}
                className={`px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold transition-colors ${
                  currentStep.layerColor === "amber" ? "bg-amber-600 hover:bg-amber-500" :
                  currentStep.layerColor === "blue" ? "bg-blue-600 hover:bg-blue-500" :
                  currentStep.layerColor === "emerald" ? "bg-emerald-600 hover:bg-emerald-500" :
                  "bg-violet-600 hover:bg-violet-500"
                }`}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes demo-progress {
          from { width: 0% }
          to   { width: 100% }
        }
      `}</style>
    </>,
    document.body
  );
}
