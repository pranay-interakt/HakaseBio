import { NavBar } from "@/components/NavBar";
import { useEffect } from "react";
import { useLocation } from "wouter";
import screenshotL1 from "@assets/Screenshot_2026-03-15_at_2.21.01_1773526937474.png";
import screenshotL2 from "@assets/Screenshot_2026-03-15_at_2.21.26_1773526937475.png";
import screenshotL3 from "@assets/Screenshot_2026-03-15_at_2.21.44_1773526937476.png";

export function Platform() {
  const [location] = useLocation();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      setTimeout(() => {
        const el = document.querySelector(hash);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [location]);

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-[Inter,sans-serif]">
      <NavBar sticky />

      {/* ── Hero ── */}
      <div className="relative z-10 px-6 pt-20 pb-16 text-center border-b border-white/5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-4">BioDigital Twin · Platform</div>
        <h1 className="text-[52px] font-black tracking-tight text-white leading-tight mb-5">
          From molecule to trial
        </h1>
        <p className="text-[16px] text-slate-400 max-w-2xl mx-auto">
          Four simulation layers that cascade — molecular safety, preclinical species, patient cohort, and clinical trial — each building on the last to answer the questions that determine whether a drug program succeeds or fails.
        </p>
      </div>

      {/* ── Overview ── */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Overview</div>
        <h2 className="text-[32px] font-black tracking-tight text-white mb-8">How the platform works</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
          {[
            { num: "L1", label: "In Vitro Digital Twin",   q: "Is this molecule safe?",          color: "violet", desc: "Takes a SMILES string, computes real molecular descriptors via RDKit.js, scores ADMET profiles, estimates binding affinity, and returns a GO / WATCH / NO-GO verdict in ~3 seconds." },
            { num: "L2", label: "Animal Cohort Twin",     q: "How does it behave preclinically?", color: "amber",  desc: "Multi-species PBPK across rat, dog, and monkey with BCS-aware formulation modeling, allometric FIH dose scaling, and regulatory NOAEL estimation." },
            { num: "L3", label: "Patient Cohort Twin",    q: "Who will it work for?",           color: "blue",   desc: "Takes L1+L2 results and dose parameters, simulates PK/PD concentration curves, responder rates, adverse event profiles, and dose-limiting toxicity across a virtual patient cohort." },
            { num: "L4", label: "Trial Digital Twin",     q: "Will the trial succeed?",         color: "emerald", desc: "Takes L1–L3 outputs and trial design parameters, calculates statistical power, models enrollment trajectories, adaptive interim analyses, site rankings, and budget projections." },
          ].map(({ num, label, q, color, desc }) => (
            <div key={num} className={`rounded-2xl border p-6 ${
              color === "violet" ? "border-violet-500/20 bg-violet-500/5"
              : color === "amber" ? "border-amber-500/20 bg-amber-500/5"
              : color === "blue" ? "border-blue-500/20 bg-blue-500/5"
              : "border-emerald-500/20 bg-emerald-500/5"
            }`}>
              <div className={`w-10 h-10 rounded-full border flex items-center justify-center text-[11px] font-black mb-4 ${
                color === "violet" ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                : color === "amber" ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : color === "blue" ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              }`}>{num}</div>
              <div className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${
                color === "violet" ? "text-violet-500" : color === "amber" ? "text-amber-500" : color === "blue" ? "text-blue-500" : "text-emerald-500"
              }`}>{label}</div>
              <div className="text-[17px] font-bold text-white mb-3">{q}</div>
              <div className="text-[13px] text-slate-400 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>

        {/* Flow arrows */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {[
            { label: "SMILES + Target ID", color: "slate" },
            { arrow: true },
            { label: "L1 · In Vitro", color: "violet" },
            { arrow: true },
            { label: "L2 · Animal", color: "amber" },
            { arrow: true },
            { label: "L3 · Cohort", color: "blue" },
            { arrow: true },
            { label: "L4 · Trial", color: "emerald" },
            { arrow: true },
            { label: "GO / NO-GO + Full Report", color: "slate" },
          ].map((item, i) =>
            "arrow" in item ? (
              <svg key={i} className="w-5 h-5 text-slate-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <div key={i} className={`text-[11px] px-3 py-1.5 rounded-lg border font-medium ${
                item.color === "violet" ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                : item.color === "amber" ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : item.color === "blue" ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                : item.color === "emerald" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-slate-400"
              }`}>{item.label}</div>
            )
          )}
        </div>
      </section>

      {/* ── Layer 1 ── */}
      <section id="layer1" className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-violet-500/40 bg-violet-500/10 flex items-center justify-center text-[12px] font-black text-violet-400 shrink-0">L1</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold">Layer 1</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">In Vitro Digital Twin</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-5">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              Type in a SMILES string and a protein target. The molecular engine runs in your browser using RDKit.js — the same C++ cheminformatics library used at Pfizer and Novartis, compiled to WebAssembly.
            </p>
            <div className="space-y-3">
              {[
                ["Descriptors", "MW, LogP, TPSA, HBD, HBA, QED, rotatable bonds — real cheminformatics, not estimates."],
                ["ADMET Scoring", "Five-axis radar (Absorption, Distribution, Metabolism, Excretion, Toxicity) scored 0–1 via QSAR rules grounded in Lipinski and Veber."],
                ["Binding Affinity", "QSAR-estimated Kd, Ki, IC50 for the selected target class. Adjusted by Lipinski compliance and QED."],
                ["Go/No-Go Verdict", "Deterministic decision tree: toxicity flags, Lipinski violations, and ADMET threshold produce a clear GO / WATCH / NO-GO."],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-xl border border-violet-500/10 bg-violet-500/4 p-4">
                  <div className="text-[11px] font-semibold text-violet-300 mb-1">{title}</div>
                  <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl shadow-black/60">
              <img
                src={screenshotL1}
                alt="Layer 1 — In Vitro Digital Twin interface showing ADMET radar, binding scores, and Go/No-Go verdict"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-3 text-center">Layer 1 — In Vitro simulation complete · ADMET radar · Binding affinity · Go verdict</p>
          </div>
        </div>
      </section>

      {/* ── Layer 2 — Animal Cohort ── */}
      <section id="layer2" className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center text-[12px] font-black text-amber-400 shrink-0">L2</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-amber-500 font-semibold">Layer 2</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">Animal Cohort Twin</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-5">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              Layer 1 ADMET results flow into a multi-species PBPK engine. Choose species (rat, dog, monkey) and study type, select an FDA IIG-validated formulation, and run allometric scaling to generate a safe first-in-human dose estimate — the same methodology required for IND filings.
            </p>
            <div className="space-y-3">
              {[
                ["Multi-species PBPK", "Two-compartment RK4 ODE solver for rat, dog, and monkey. Species-specific physiological parameters — volume of distribution, clearance, protein binding — allometrically scaled."],
                ["Formulation Engine", "Six FDA IIG-compliant formulations (plain tablet, micronized, SD, NLC, SNEDDS, nanosuspension). BCS classification automatically selects the highest-boost option for the molecule."],
                ["FIH Dose Scaling", "Body weight exponent (0.75 for CL, 1.0 for Vd). Safety factor 1/10 of NOAEL applied per ICH M3(R2) guidance."],
                ["Human Reference Panel", "Read-only translation of animal PK to predicted human Cmax, AUC, t½ and Vd for cross-species comparison."],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-xl border border-amber-500/10 bg-amber-500/4 p-4">
                  <div className="text-[11px] font-semibold text-amber-300 mb-1">{title}</div>
                  <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 flex flex-col gap-4">
              <div className="text-[10px] uppercase tracking-widest text-amber-500 font-semibold">Layer 2 Outputs</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Rat Cmax",       val: "2.8 µg/mL",    col: "text-amber-300" },
                  { label: "Dog AUC",        val: "18.4 µg·h/mL", col: "text-amber-300" },
                  { label: "Monkey t½",      val: "6.2 h",         col: "text-amber-300" },
                  { label: "FIH Start Dose", val: "1.2 mg/kg",    col: "text-amber-200" },
                  { label: "NOAEL (rat)",    val: "100 mg/kg",     col: "text-green-400" },
                  { label: "Formulation",    val: "SNEDDS (BCS II)", col: "text-amber-300" },
                ].map(({ label, val, col }) => (
                  <div key={label} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
                    <div className={`text-[15px] font-bold ${col}`}>{val}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 text-center mt-2">Layer 2 — Animal cohort · PBPK modeling · Allometric FIH scaling · FDA IIG formulation</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Layer 3 — Patient Cohort ── */}
      <section id="layer3" className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-blue-500/40 bg-blue-500/10 flex items-center justify-center text-[12px] font-black text-blue-400 shrink-0">L3</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold">Layer 3</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">Patient Cohort Twin</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-3 order-2 lg:order-1">
            <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl shadow-black/60">
              <img
                src={screenshotL2}
                alt="Layer 3 — Patient Cohort Twin interface showing PK/PD concentration curves, responder rates, and adverse events"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-3 text-center">Layer 3 — Cohort simulation · PK/PD curves · 80% responder rate · Dose-response</p>
          </div>
          <div className="lg:col-span-2 order-1 lg:order-2 space-y-5">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              Layer 2's FIH dose estimate auto-seeds the starting dose here. Configure cohort size, age range, and disease severity — the simulation builds a virtual patient population and runs PK/PD for the full cohort.
            </p>
            <div className="space-y-3">
              {[
                ["PK/PD Curves", "One-compartment model with 90% confidence intervals. Parameters derived from ADMET scores. 100 time points per curve."],
                ["Responder Rate", "Sigmoidal Emax model. Biomarker-positive subgroups automatically segmented at 1.5–2× the overall rate."],
                ["Adverse Events", "Organ-risk flags from L1 map to CTCAE-graded events with estimated incidence rates."],
                ["DLT Rate", "Dose-limiting toxicity probability aggregated from per-flag severity (High: 15–25%, Medium: 5–15%, Low: 1–5%)."],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-xl border border-blue-500/10 bg-blue-500/4 p-4">
                  <div className="text-[11px] font-semibold text-blue-300 mb-1">{title}</div>
                  <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Layer 4 — Trial ── */}
      <section id="layer4" className="max-w-6xl mx-auto px-6 py-20 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-[12px] font-black text-emerald-400 shrink-0">L4</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">Layer 4</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">Trial Digital Twin</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-5">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              The final layer takes everything from L1–L3, adds your trial design parameters, and produces a complete virtual clinical trial — power calculations, enrollment modeling, adaptive design boundaries, site rankings, and a cost breakdown.
            </p>
            <div className="space-y-3">
              {[
                ["Statistical Power", "Exact normal CDF formula: n = ((Z_α/2 + Z_β)² × 2σ²) / δ². Adjusted for dropout and multi-arm designs. Same math as nQuery/PASS."],
                ["Kaplan-Meier Curves", "Parametric survival via Weibull distribution. Treatment vs control with hazard ratio and log-rank p-value."],
                ["Adaptive Design", "O'Brien-Fleming spending function. Early stopping boundaries for efficacy and futility at each interim look."],
                ["Trial Verdict", "GO (power ≥80%, molecule GO, DLT <33%) / CONDITIONAL / NO-GO with actionable modification suggestions."],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-xl border border-emerald-500/10 bg-emerald-500/4 p-4">
                  <div className="text-[11px] font-semibold text-emerald-300 mb-1">{title}</div>
                  <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl shadow-black/60">
              <img
                src={screenshotL3}
                alt="Layer 4 — Trial Digital Twin interface showing 99.2% trial success probability, enrollment modeling, and risk factors"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-3 text-center">Layer 4 — Trial simulation · 99.2% success probability · 240 patients · 26-month timeline</p>
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <div className="border-t border-white/5 py-16 px-6 text-center">
        <p className="text-[14px] text-slate-500 mb-6">Ready to run a simulation?</p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <a href="/story" className="px-6 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:border-white/20 transition-colors text-[14px] font-medium">
            Read the Story →
          </a>
          <a href="/login" className="px-8 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 transition-colors text-white font-semibold text-[14px]">
            Get Started →
          </a>
        </div>
      </div>
    </div>
  );
}
