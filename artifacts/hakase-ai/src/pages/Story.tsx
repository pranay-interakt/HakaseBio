import { useState } from "react";
import { useLocation } from "wouter";
import hakaseLogo from "@assets/image_1773504202272.png";

export function Story() {
  const [, navigate] = useLocation();
  const [version, setVersion] = useState<"simple" | "technical">("simple");

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-[Inter,sans-serif]">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-30 flex items-center justify-between px-8 py-5 border-b border-white/5 bg-[#07080c]/95 backdrop-blur-sm">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <img src={hakaseLogo} alt="HakaseAI" className="h-9 w-auto object-contain" />
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-slate-400 font-mono">v1.0</span>
        </button>
        <div className="hidden md:flex items-center gap-6 text-[13px] text-slate-400">
          <button onClick={() => navigate("/")} className="hover:text-white transition-colors">Platform</button>
          <span className="text-white font-medium">The Story</span>
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
      <div className="relative z-10 px-6 pt-20 pb-10 text-center border-b border-white/5">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-600 mb-4">Hakase AI · March 2026</div>
        <h1 className="text-[52px] font-black tracking-tight text-white leading-tight mb-4">
          The BioDigital Twin<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-blue-400">Platform Story</span>
        </h1>
        <p className="text-[16px] text-slate-400 max-w-xl mx-auto mb-10">
          Two ways to understand what we build and why it matters.
        </p>

        {/* Version toggle */}
        <div className="inline-flex items-center gap-1 bg-[#0d0f17] border border-white/10 rounded-2xl p-1.5">
          <button
            onClick={() => setVersion("simple")}
            className={`px-6 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 ${
              version === "simple"
                ? "bg-violet-600/25 border border-violet-500/40 text-violet-300 shadow-lg shadow-violet-900/30"
                : "text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent"
            }`}
          >
            Simple Story
          </button>
          <button
            onClick={() => setVersion("technical")}
            className={`px-6 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 ${
              version === "technical"
                ? "bg-blue-600/25 border border-blue-500/40 text-blue-300 shadow-lg shadow-blue-900/30"
                : "text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent"
            }`}
          >
            Technical Story
          </button>
        </div>
      </div>

      {/* ── SIMPLE STORY ── */}
      {version === "simple" && (
        <div className="max-w-3xl mx-auto px-6 py-20 space-y-20">

          {/* The Problem */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold mb-3">The Problem</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-6">
              Three questions that can make or break a biotech company
            </h2>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-6">
              Small biotech companies face three fundamental questions before they can test a drug molecule in humans:
            </p>
            <div className="space-y-4">
              {[
                ["1", "Is this molecule safe and viable?", "Will the human body absorb it, move it to the right place, and clear it without harm?", "violet"],
                ["2", "What happens when real patients take it?", "How effective is it? What side effects will they experience? Who responds and who doesn't?", "blue"],
                ["3", "Should we run a clinical trial?", "How many patients do we need? How long will it take? How much will it cost? Is it worth the investment?", "emerald"],
              ].map(([num, q, detail, color]) => (
                <div key={num} className={`rounded-xl border p-5 flex gap-5 items-start ${
                  color === "violet" ? "border-violet-500/20 bg-violet-500/5"
                  : color === "blue" ? "border-blue-500/20 bg-blue-500/5"
                  : "border-emerald-500/20 bg-emerald-500/5"
                }`}>
                  <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-black border ${
                    color === "violet" ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                    : color === "blue" ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  }`}>{num}</div>
                  <div>
                    <div className="text-[15px] font-bold text-white mb-1">{q}</div>
                    <div className="text-[13px] text-slate-400">{detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-xl border border-red-500/20 bg-red-500/5 p-5">
              <div className="text-[10px] uppercase tracking-widest text-red-400 font-semibold mb-2">The Hard Truth</div>
              <p className="text-[14px] text-slate-300 leading-relaxed">
                Answering these three questions today costs <span className="text-white font-semibold">$2M–$5M</span> and takes <span className="text-white font-semibold">12–18 months</span> of lab experiments, animal studies, and biostatistics consulting. And 90% of drugs that enter clinical trials still fail — most for reasons that could have been predicted earlier: poor absorption, unexpected toxicity, or an underpowered trial design. By the time you discover the problem in a real lab, you've spent millions.
              </p>
            </div>
          </section>

          {/* What we built */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold mb-3">What We Built</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-4">
              A flight simulator for drug molecules
            </h2>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-8">
              Before a pilot flies a real plane, they spend hundreds of hours in a flight simulator. The simulator doesn't replace real flying — but it tells you whether this pilot, in this plane, on this route, is likely to succeed. And it does it without risking a single life or a dollar on jet fuel.
            </p>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-10">
              Our platform does the same for drug molecules. A scientist types in a molecule — think of it as the drug's unique code — and in under 10 seconds the platform answers all three questions above.
            </p>

            <div className="space-y-4">
              {[
                {
                  step: "Step 1", label: "Is it safe & viable?",
                  desc: "Checks if the molecule can be absorbed, reach its target, and be cleared safely. Flags cardiac, liver, or brain risks.",
                  verdict: "GO / WATCH / NO-GO", color: "violet",
                },
                {
                  step: "Step 2", label: "What happens to patients?",
                  desc: "Simulates what happens when 100 or 1,000 patients take this drug at a given dose. Shows how the drug moves through the body, how many patients respond, and what side effects to expect.",
                  verdict: "Responder Rate + AE Profile", color: "blue",
                },
                {
                  step: "Step 3", label: "Should we run a trial?",
                  desc: "Designs a complete virtual clinical trial. Calculates how many patients are needed, how long it takes, how much it costs, and whether the trial is statistically likely to succeed.",
                  verdict: "TRIAL GO / NO-GO", color: "emerald",
                },
              ].map(({ step, label, desc, verdict, color }) => (
                <div key={step} className={`rounded-xl border p-6 ${
                  color === "violet" ? "border-violet-500/20 bg-[#0d0f17]"
                  : color === "blue" ? "border-blue-500/20 bg-[#0d0f17]"
                  : "border-emerald-500/20 bg-[#0d0f17]"
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${
                        color === "violet" ? "text-violet-500" : color === "blue" ? "text-blue-500" : "text-emerald-500"
                      }`}>{step}</div>
                      <div className="text-[16px] font-bold text-white mb-2">{label}</div>
                      <div className="text-[13px] text-slate-400 leading-relaxed">{desc}</div>
                    </div>
                    <div className={`shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-lg border ${
                      color === "violet" ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                      : color === "blue" ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    }`}>{verdict}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Why it matters */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold mb-3">Why It Matters</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-6">
              Every dollar spent on the right molecule
            </h2>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-6">
              A small biotech company typically raises $5M–$15M in seed or Series A funding. That money has to cover everything — team, lab work, regulatory prep, and one shot at a clinical trial.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
                <div className="text-[11px] font-bold text-red-400 mb-2">Without BioDigital Twin</div>
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  A company spends $2M on lab experiments, only to discover at month 14 that their molecule has a fatal heart safety issue. Game over. Money gone.
                </p>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                <div className="text-[11px] font-bold text-emerald-400 mb-2">With BioDigital Twin</div>
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  That heart safety flag surfaces in 3 seconds, on day one. Test 100 molecules before lunch. Spend real lab money only on the ones that pass all three checks.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/2 p-6 text-center">
              <p className="text-[18px] font-bold text-white leading-snug">
                "We don't replace scientists or labs. We make sure every dollar a small biotech spends on real experiments is spent on the right molecule."
              </p>
              <div className="text-[12px] text-slate-600 mt-3">— Hakase AI</div>
            </div>
          </section>

          {/* Privacy */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold mb-3">Privacy</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-4">Your molecule never leaves your browser</h2>
            <p className="text-[15px] text-slate-400 leading-relaxed">
              All simulations run entirely inside your browser. Nothing is uploaded to a server. Your molecule — your most valuable IP — stays on your computer. It's like having a $2M lab inside your laptop, with the confidentiality of a sealed notebook.
            </p>
          </section>

          {/* Standard vs Premium */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold mb-3">Tiers</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-6">Standard vs Premium</h2>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-8">
              Think of it like navigation software. The standard version uses published road rules — speed limits, one-way streets, general traffic patterns. It gets you there most of the time.
              The premium version adds live data: every known accident, road closure, and shortcut, logged across decades of real journeys. Same interface, dramatically better answers.
            </p>
            <div className="rounded-xl border border-white/8 bg-[#0d0f17] overflow-hidden">
              <div className="grid grid-cols-3 divide-x divide-white/5">
                <div className="p-4 bg-white/2">
                  <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold">What</div>
                </div>
                <div className="p-4">
                  <div className="text-[11px] font-bold text-violet-300">Standard</div>
                </div>
                <div className="p-4">
                  <div className="text-[11px] font-bold text-amber-300">Premium</div>
                </div>
              </div>
              {[
                ["ADMET Prediction", "Published QSAR rules (Lipinski, Veber)", "Real-world drug data from curated databases"],
                ["Binding Affinity", "Target-class range estimate", "Literature-validated parameters"],
                ["Adverse Events", "Structural flag estimates", "140K+ real adverse effects with incidence rates"],
                ["Drug Interactions", "Not included", "1.37M+ interaction warnings"],
                ["PK Parameters", "ADMET-score proxies", "Real t½, clearance, volume of distribution"],
              ].map(([label, std, prem]) => (
                <div key={label} className="grid grid-cols-3 divide-x divide-white/5 border-t border-white/5">
                  <div className="p-4 bg-white/2">
                    <div className="text-[12px] text-slate-300 font-medium">{label}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-[12px] text-slate-400">{std}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-[12px] text-slate-300">{prem}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-slate-500 mt-5 leading-relaxed">
              Standard gets you a smart, grounded prediction. Premium gets you a prediction backed by the same data pharmaceutical companies, the FDA, and 30,000+ research papers rely on. If you're making a $5M trial decision, Premium is the difference between an educated guess and an informed decision.
            </p>
          </section>

        </div>
      )}

      {/* ── TECHNICAL STORY ── */}
      {version === "technical" && (
        <div className="max-w-4xl mx-auto px-6 py-20 space-y-20">

          {/* The Gap */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold mb-3">The Gap</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-6">
              The circular dependency in pre-clinical decision-making
            </h2>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-6">
              You're a medicinal chemist at a 12-person biotech. You've designed 40 candidate molecules against a validated target. To get to IND filing, you need to:
            </p>
            <div className="space-y-3 mb-8">
              {[
                ["Screen all 40 for ADMET liabilities", "In vitro Caco-2, microsomal stability, and hERG patch-clamp assays cost $15K–$50K per compound. That's $600K–$2M for Layer 1 data alone on a typical $800K budget."],
                ["Run PK studies for your top 3–5 candidates", "Another $50K–$150K each. But you won't know which 3–5 to pick until you have the ADMET data you can't afford."],
                ["Engage a biostatistics CRO for Phase 1 protocol design", "$150K–$400K and 2–4 months. The power calculation depends on effect size estimates that don't exist yet because the PK study hasn't run."],
              ].map(([title, desc], i) => (
                <div key={i} className="flex gap-4 rounded-xl border border-white/8 bg-white/2 p-5">
                  <div className="shrink-0 w-7 h-7 rounded-full border border-blue-500/40 bg-blue-500/10 flex items-center justify-center text-[11px] font-black text-blue-400 mt-0.5">{i + 1}</div>
                  <div>
                    <div className="text-[14px] font-semibold text-white mb-1">{title}</div>
                    <div className="text-[13px] text-slate-400">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
              <div className="text-[10px] uppercase tracking-widest text-red-400 font-semibold mb-2">Industry Data</div>
              <p className="text-[13px] text-slate-300 leading-relaxed">
                Average cost from discovery to Phase 1 IND filing: <strong className="text-white">$2M–$5M</strong>. Of drugs entering Phase 1, ~90% never reach approval. The largest waste isn't failed trials — it's months and millions spent on molecules that should never have entered the pipeline.
              </p>
            </div>
          </section>

          {/* What the platform computes */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold mb-3">Architecture</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-4">
              What the BioDigital Twin actually computes
            </h2>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-10">
              A three-layer cascading simulation running entirely in the browser via WebAssembly (RDKit.js) and standard biostatistical formulas. Zero server calls during simulation. Zero data egress.
            </p>

            {/* Layer 1 */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full border border-violet-500/40 bg-violet-500/10 flex items-center justify-center text-[11px] font-black text-violet-400">L1</div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold">Layer 1</div>
                  <div className="text-[18px] font-bold text-white">Molecular Digital Twin</div>
                </div>
              </div>
              <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                Input: SMILES string + UniProt target ID. Five computation steps in ~3 seconds.
              </p>
              <div className="space-y-3">
                {[
                  ["Step 1 — RDKit.js Descriptor Computation", "MW, LogP, TPSA, HBD, HBA, rotatable bonds, QED, ring counts. Real cheminformatics — the same RDKit C++ library used at Pfizer and Novartis, compiled to WASM."],
                  ["Step 2 — ADMET Scoring", "Five scores (Absorption, Distribution, Metabolism, Excretion, Toxicity) via QSAR rules grounded in Lipinski (1997), Veber (2002), and hERG SAR literature. Each score 0–1 with transparent thresholds."],
                  ["Step 3 — Binding Affinity Estimation", "Target-map lookup places the molecule within the expected IC50 range for its target class (e.g. 1–100 nM for EGFR RTK inhibitors), adjusted by Lipinski compliance and QED. QSAR-based, not docking."],
                  ["Step 4 — Go/No-Go Decision Tree", "High-severity toxicity flag OR ≥3 Lipinski violations = NO-GO. ADMET < 0.65 = WATCH. Otherwise = GO."],
                  ["Step 5 — Results Caching", "The complete SimResults object (descriptors, ADMET, binding, toxicity, verdict) is cached in-memory and passed to Layer 2. Zero network calls."],
                ].map(([title, desc]) => (
                  <div key={title as string} className="rounded-lg border border-violet-500/10 bg-violet-500/4 p-4">
                    <div className="text-[12px] font-semibold text-violet-300 mb-1">{title}</div>
                    <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-white/8 bg-white/2 p-4">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Real vs Estimated</div>
                <div className="text-[12px] text-slate-400 leading-relaxed">
                  Molecular descriptors: <span className="text-emerald-400 font-medium">100% real cheminformatics</span>, identical to wet-lab computed properties. ADMET scores: published QSAR rules — scientifically grounded, not ML-trained. Binding affinity: range placement, not a docking calculation.
                  <span className="text-slate-500"> Upgrade path: ChemBERTa for ADMET · ESM-2 + AQAffinity for binding.</span>
                </div>
              </div>
            </div>

            {/* Layer 2 */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full border border-blue-500/40 bg-blue-500/10 flex items-center justify-center text-[11px] font-black text-blue-400">L2</div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold">Layer 2</div>
                  <div className="text-[18px] font-bold text-white">Patient Cohort Simulation</div>
                </div>
              </div>
              <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                Takes L1 SimResults + cohort parameters (dose, route, size, age range, disease severity). Produces population-level PK/PD outcomes in ~1–2 seconds.
              </p>
              <div className="space-y-3">
                {[
                  ["PK Time-Course", "One-compartment model: C(t) = (F × Dose / Vd) × (ka / (ka − ke)) × (e^(−ke×t) − e^(−ka×t)). Parameters (F, Vd, ka, ke) derived from ADMET scores. 100 time points with 90% CI from inter-individual variability simulation."],
                  ["Responder Rate", "Sigmoidal Emax model driven by binding affinity (stronger binding → higher response) and disease severity. Biomarker-positive subgroup gets 1.5–2× the overall rate."],
                  ["AE Profiling", "Each organ-risk flag from L1 maps to CTCAE-graded adverse events: hERG → QT prolongation (Grade 1–2: 10–20%, Grade 3+: 5–15%), hepatotox → ALT elevation, BBB → CNS effects."],
                  ["DLT Rate", "Dose-limiting toxicity probability: High severity = 15–25% per flag, Medium = 5–15%, Low = 1–5%. Aggregated for total DLT rate."],
                ].map(([title, desc]) => (
                  <div key={title as string} className="rounded-lg border border-blue-500/10 bg-blue-500/4 p-4">
                    <div className="text-[12px] font-semibold text-blue-300 mb-1">{title}</div>
                    <div className="text-[12px] text-slate-400 leading-relaxed font-mono">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Layer 3 */}
            <div>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-[11px] font-black text-emerald-400">L3</div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">Layer 3</div>
                  <div className="text-[18px] font-bold text-white">Clinical Trial Digital Twin</div>
                </div>
              </div>
              <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                Takes L1+L2 outputs + trial design parameters (phase, arms, blinding, α, power, dropout). Produces a complete virtual trial simulation in ~1–2 seconds.
              </p>
              <div className="space-y-3">
                {[
                  ["Power Calculation", "Exact normal CDF formula (not approximation): n = ((Z_α/2 + Z_β)² × 2σ²) / δ², adjusted for dropout and multi-arm designs. Same math as nQuery/PASS."],
                  ["Kaplan-Meier Curves", "Parametric survival using Weibull distribution. Treatment vs control arms with hazard ratio and log-rank p-value. Greenwood's formula for confidence intervals."],
                  ["Adaptive Design", "O'Brien-Fleming spending function: Z_boundary(k) = Z_α_final / √t_k. Computes early stopping boundaries for efficacy and futility at each interim look."],
                  ["Site Allocation", "Enrollment rate model by region (NA: 1–2/site/month at $50K–$100K/patient · APAC: 3–5/site/month at $10K–$25K/patient). Cost and timeline projections."],
                  ["Trial Verdict", "GO (power ≥80%, molecule GO, DLT <33%) / CONDITIONAL / NO-GO. Actionable recommendation with modification suggestions."],
                ].map(([title, desc]) => (
                  <div key={title as string} className="rounded-lg border border-emerald-500/10 bg-emerald-500/4 p-4">
                    <div className="text-[12px] font-semibold text-emerald-300 mb-1">{title}</div>
                    <div className="text-[12px] text-slate-400 leading-relaxed font-mono">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Privacy */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold mb-3">Privacy Architecture</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-6">Client-side by design</h2>
            <div className="space-y-4">
              <div className="rounded-xl border border-white/8 bg-white/2 p-5">
                <div className="text-[13px] font-semibold text-white mb-2">Current (v1)</div>
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  The entire simulation runs client-side in the browser. The SMILES string — your proprietary molecular IP — never leaves the browser. RDKit.js is a C++ engine compiled to WebAssembly that executes locally. All QSAR rules, PK models, and power calculations run in JavaScript. Zero network calls during simulation.
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/2 p-5">
                <div className="text-[13px] font-semibold text-white mb-2">v2 AI Upgrade Path</div>
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  When we add ML models, the architecture sends only <span className="text-white font-medium">Morgan fingerprints</span> (2048-bit one-way hashes) to the inference server. Morgan fingerprints are mathematically irreversible — the server cannot reconstruct the original molecule. Even Hakase cannot see your structures.
                </p>
              </div>
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                <p className="text-[13px] text-slate-300 leading-relaxed">
                  For small biotechs whose entire valuation rests on 2–3 proprietary molecules, this is not a feature. It's a requirement.
                </p>
              </div>
            </div>
          </section>

          {/* Premium */}
          <section>
            <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold mb-3">Premium Tier</div>
            <h2 className="text-[32px] font-black tracking-tight text-white mb-4">From rule-based to data-driven</h2>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-8">
              The Standard tier uses QSAR rules — Lipinski, Veber, hERG SAR — that are scientifically grounded but inherently limited to molecular descriptors. The Premium tier integrates curated drug databases to replace rule-based estimates with real data.
            </p>
            <div className="rounded-xl border border-white/8 bg-[#0d0f17] overflow-hidden">
              <div className="grid grid-cols-3 divide-x divide-white/5 bg-white/2">
                <div className="p-4 text-[10px] uppercase tracking-widest text-slate-600 font-semibold">What You Get</div>
                <div className="p-4 text-[10px] uppercase tracking-widest text-slate-600 font-semibold">Standard</div>
                <div className="p-4 text-[10px] uppercase tracking-widest text-amber-600 font-semibold">Premium</div>
              </div>
              {[
                ["Real PK parameters (t½, CL, Vd, F)", "ADMET-score proxies", "Literature-validated values from 100,000+ references"],
                ["Adverse effects", "Structural flag estimates", "140K+ known adverse effects with real-world incidence rates (MedDRA/ICD-10 coded)"],
                ["Drug-drug interactions", "Not included", "1.37M+ interaction warnings"],
                ["Drug-protein interactions", "Target-class lookup", "28,000+ curated drug-protein interaction records"],
                ["Clinical trial data", "Not included", "Real-world trial outcomes for approved drugs"],
              ].map(([label, std, prem]) => (
                <div key={label} className="grid grid-cols-3 divide-x divide-white/5 border-t border-white/5">
                  <div className="p-4 text-[12px] text-slate-300 font-medium">{label}</div>
                  <div className="p-4 text-[12px] text-slate-500">{std}</div>
                  <div className="p-4 text-[12px] text-slate-300">{prem}</div>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-slate-500 mt-5 leading-relaxed">
              For trial decisions at the $5M+ level, Premium replaces educated estimates with predictions grounded in the same curated data used by pharmaceutical companies and regulatory agencies.
            </p>
          </section>

        </div>
      )}

      {/* ── Footer CTA ── */}
      <div className="border-t border-white/5 py-16 px-6 text-center">
        <p className="text-[14px] text-slate-500 mb-6">Ready to run a simulation?</p>
        <button
          onClick={() => navigate("/login")}
          className="px-8 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 transition-colors text-white font-semibold text-[15px]"
        >
          Get Started →
        </button>
        <div className="mt-8 text-[12px] text-slate-700">
          Hakase AI · Confidential · March 2026
        </div>
      </div>

    </div>
  );
}
