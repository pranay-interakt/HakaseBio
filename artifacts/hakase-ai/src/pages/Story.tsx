import { useState } from "react";
import { NavBar } from "@/components/NavBar";

export function Story() {
  const [version, setVersion] = useState<"simple" | "technical">("simple");

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-[Inter,sans-serif]">

      {/* ── Nav ── */}
      <NavBar sticky />

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
              Three questions that decide whether a molecule reaches the clinic
            </h2>
            <p className="text-[15px] text-slate-400 leading-relaxed mb-6">
              Before a small biotech can dose a single human, it has to answer three pre-clinical questions — and answer them defensibly enough that an IND filing holds up:
            </p>
            <div className="space-y-4">
              {[
                ["1", "Is this molecule worth confirming?", "Is it absorbable, drug-like, and free of obvious organ-tox liabilities — based on real chemistry, not estimates?", "violet"],
                ["2", "Does the verdict survive deeper confirmation?", "Does in-silico docking + free-energy refinement agree with virtual-tissue (GTEx + Tabula Sapiens) projections of the in-vitro screen — entirely Zero-Lab?", "blue"],
                ["3", "Are we IND-ready, and what is a defensible First-In-Human starting dose?", "Have we covered multi-species animal PK, NOAEL, GLP tox, CMC, and the Investigator's Brochure — and can we justify a MABEL-biased starting dose?", "emerald"],
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
                Answering these three questions today costs <span className="text-white font-semibold">$2M–$5M</span> and takes <span className="text-white font-semibold">12–18 months</span> of lab experiments, animal studies, and biostatistics consulting. And 90% of drugs that enter clinical trials still fail — most for reasons that could have been predicted earlier in pre-clinical: poor absorption, unexpected toxicity, weak target engagement, or a starting dose that was wrong from day one. By the time the problem surfaces in a real lab, you've already spent millions.
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
              Our platform does the same for the pre-clinical journey. A scientist types in a molecule and a target, and four cascading layers walk it from in-vitro screen through to a sealed, IND-ready handoff — every output tagged with how it was produced (heuristic, structural, ML, literature, in-house, or class-median anchor), every override logged.
            </p>

            <div className="space-y-4">
              {[
                {
                  step: "Step 1 · Layer 1", label: "Is it worth confirming?",
                  desc: "Real RDKit cheminformatics, ML-augmented ADMET, validated-target binding, and an organ-tox cascade. Returns a HAIOps-traceable verdict in seconds.",
                  verdict: "GO / WATCH / NO-GO", color: "violet",
                },
                {
                  step: "Step 2 · Layer 2", label: "Does it survive confirmation?",
                  desc: "Two parallel sub-tracks, both 100% computational — a 10-stage in-silico pipeline (docking → FEP → PBPK → QSP/PD) and a virtual-tissue (ex-vivo) track that maps L1+L2 outputs against GTEx and Tabula Sapiens v2. Both seal into a single ConfirmationBlock v2.0.0.",
                  verdict: "Sealed Confirmation Block", color: "blue",
                },
                {
                  step: "Step 3 · Layer 3", label: "How does it behave across species?",
                  desc: "Multi-species PBPK across rat, dog, and monkey with BCS-aware formulation and allometric scaling per ICH M3(R2). Outputs species-by-species NOAEL and a human-equivalent dose.",
                  verdict: "NOAEL + HED per species", color: "amber",
                },
                {
                  step: "Step 4 · Layer 4", label: "Are we IND-ready?",
                  desc: "Phase 1 Planner derives a defensible MABEL-biased starting dose, evaluates the IND-enabling gate, and seals everything upstream into a regulator-ingestible PreClinicalPackage v2.0.0.",
                  verdict: "MABEL FIH dose + IND PASS", color: "emerald",
                },
              ].map(({ step, label, desc, verdict, color }) => (
                <div key={step} className={`rounded-xl border p-6 ${
                  color === "violet" ? "border-violet-500/20 bg-[#0d0f17]"
                  : color === "blue" ? "border-blue-500/20 bg-[#0d0f17]"
                  : color === "amber" ? "border-amber-500/20 bg-[#0d0f17]"
                  : "border-emerald-500/20 bg-[#0d0f17]"
                }`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${
                        color === "violet" ? "text-violet-500" : color === "blue" ? "text-blue-500" : color === "amber" ? "text-amber-500" : "text-emerald-500"
                      }`}>{step}</div>
                      <div className="text-[16px] font-bold text-white mb-2">{label}</div>
                      <div className="text-[13px] text-slate-400 leading-relaxed">{desc}</div>
                    </div>
                    <div className={`shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-lg border ${
                      color === "violet" ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                      : color === "blue" ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                      : color === "amber" ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
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
              You're a medicinal chemist at a 12-person biotech. You've designed 40 candidate molecules against a validated target. To file an IND, you need to:
            </p>
            <div className="space-y-3 mb-8">
              {[
                ["Screen all 40 for ADMET liabilities", "In-vitro Caco-2, microsomal stability, and hERG patch-clamp assays cost $15K–$50K per compound. That's $600K–$2M for Layer 1 data alone on a typical $800K budget."],
                ["Confirm the top 3–5 with docking, FEP, and ex-vivo evidence", "Computational chemistry CRO time, GPU-hours for FEP, organoid panels, primary hepatocyte CLint — another $200K–$500K. But you won't know which 3–5 to pick until you have the L1 data you can't afford."],
                ["Run multi-species animal PK and IND-enabling tox", "Rat / dog / monkey PK plus GLP tox: $400K–$1.2M and 6–12 months. The allometric FIH calculation depends on per-species NOAEL estimates that don't exist yet."],
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
              Four cascading pre-clinical layers. RDKit.js (WASM) for cheminformatics in the browser; an isolated AI Service for ML inference (fingerprints only, never SMILES); RunPod GPU for opt-in FEP. Every output tagged with a source-quality tier — computed-side (heuristic / structural / ML) or substrate-side (literature / in-house / class-median). HAIOps governs the cascade gate; the clinician-in-the-loop owns every override.
            </p>

            {/* Layer 1 */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full border border-violet-500/40 bg-violet-500/10 flex items-center justify-center text-[11px] font-black text-violet-400">L1</div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold">Layer 1</div>
                  <div className="text-[18px] font-bold text-white">In Vitro Twin</div>
                </div>
              </div>
              <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                Input: SMILES + UniProt target ID. Output: a sealed L1 EvidencePointer with verdict and source-quality tiers.
              </p>
              <div className="space-y-3">
                {[
                  ["Step 1 — RDKit.js Descriptor Computation", "MW, LogP, TPSA, HBD, HBA, rotatable bonds, QED, ring counts. Real cheminformatics — the same RDKit C++ library used at Pfizer and Novartis, compiled to WASM. Computed locally."],
                  ["Step 2 — ML-Augmented ADMET", "Per-axis A·D·M·E·T with confidence intervals. ML predictions cross-checked against published QSAR rules (Lipinski 1997, Veber 2002, hERG SAR). Disagreement surfaces as a HAIOps flag."],
                  ["Step 3 — Validated-Target Binding", "Affinity estimate (Kd, Ki, IC50) only when the target has curated ChEMBL / BindingDB / PDBbind evidence. Unknown targets are flagged 'no validated evidence' — never silently coerced."],
                  ["Step 4 — Cascade Gate", "Deterministic: high-severity organ-tox flag OR ≥3 Lipinski violations = NO-GO. ADMET < 0.65 = WATCH. Otherwise GO. Source-quality tier of each input is part of the gate input."],
                  ["Step 5 — L1 EvidencePointer", "Verdict, descriptors, ADMET, binding, organ-tox, source-quality tiers, and HAIOps provenance trail are sealed into an L1 EvidencePointer that L2 freezes at Stage 0."],
                ].map(([title, desc]) => (
                  <div key={title as string} className="rounded-lg border border-violet-500/10 bg-violet-500/4 p-4">
                    <div className="text-[12px] font-semibold text-violet-300 mb-1">{title}</div>
                    <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-white/8 bg-white/2 p-4">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Source-Quality Tiers</div>
                <div className="text-[12px] text-slate-400 leading-relaxed">
                  Descriptors: <span className="text-emerald-400 font-medium">structural</span> (RDKit). ADMET: <span className="text-blue-400 font-medium">ML</span> with QSAR cross-check. Binding: <span className="text-blue-400 font-medium">ML</span> when validated, <span className="text-amber-400 font-medium">heuristic</span> with explicit flag when not. Substrate overrides — <span className="text-emerald-400 font-medium">literature</span> (DOI/PMID + CVCL) or <span className="text-emerald-400 font-medium">in-house</span> (bench/CRO with assay method) — promote the row tier and trump downstream ML.
                </div>
              </div>
            </div>

            {/* Layer 2 */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full border border-blue-500/40 bg-blue-500/10 flex items-center justify-center text-[11px] font-black text-blue-400">L2</div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold">Layer 2</div>
                  <div className="text-[18px] font-bold text-white">Confirmation Layer (In-Silico + Ex-Vivo)</div>
                </div>
              </div>
              <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                Takes the L1 EvidencePointer (frozen at Stage 0) and runs two parallel sub-tracks. The output is a single sealed ConfirmationBlock v2.0.0 that L3 must consume.
              </p>
              <div className="space-y-3">
                {[
                  ["In-Silico · Stage 1 — ESM2 Druggability", "ESM2 protein language model embeddings + a druggability head produce a target-druggability score with confidence. AI Service inference; only fingerprints + UniProt go server-side."],
                  ["In-Silico · Stage 2 — AutoDock Vina Docking", "AutoDock Vina 1.2.7 with OpenBabel 3.1.1 + RDKit pose preparation. Top-N poses with binding energy and contact map. Source-quality tier: structural."],
                  ["In-Silico · Stage 3-4 — ML Cross-Check + Selectivity", "ML affinity + ADMET cross-check against L1; selectivity panel against off-targets; cardiotox cross-check (hERG, NaV1.5). Disagreements surface as HAIOps flags, never silent overrides."],
                  ["In-Silico · Stage 5 — FEP Free-Energy Refinement (opt-in)", "Alchemical FEP on RunPod GPU (~24 GPU-h, cost-confirmed before launch). Replaces ML affinity with physics-grounded ΔG when the gate calls for it. Tier: physics."],
                  ["In-Silico · Stage 6-8 — Pharmacology Projection", "PBPK projection (compartmental ODE) → QSP/PD coupling → therapeutic-index ranking. The PBPK output seeds L3, the TI ranking seeds the L4 dose conversation."],
                  ["In-Silico · Stage 9 — Sealed Block", "ConfirmationLayerPanel seals a v2.0.0 ConfirmationEvidenceBlock with the L1 EvidencePointer baked in. Re-runs require explicit unseal — no silent recomputation."],
                  ["Virtual-Tissue (Ex-Vivo) Sub-Track", "Computational multi-cellular tissue simulation: GTEx tissue-expression baselines + Tabula Sapiens v2 cell-type atlas (480 cell types × 28 organs) + DepMap PRISM 24Q2. No physical tissue, no organ-on-chip vendor dependency. Substrate overrides — literature (CVCL + DOI/PMID) or in-house (bench/CRO with assay method) — promote the row tier and trump downstream ML in the cascade gate."],
                ].map(([title, desc]) => (
                  <div key={title as string} className="rounded-lg border border-blue-500/10 bg-blue-500/4 p-4">
                    <div className="text-[12px] font-semibold text-blue-300 mb-1">{title}</div>
                    <div className="text-[12px] text-slate-400 leading-relaxed font-mono">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Layer 3 */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center text-[11px] font-black text-amber-400">L3</div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-amber-500 font-semibold">Layer 3</div>
                  <div className="text-[18px] font-bold text-white">Animal Cohort</div>
                </div>
              </div>
              <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                Takes L2's PBPK projection + species selection + formulation choice. Output: per-species PK, NOAEL with safety factor, and the human-equivalent dose used to seed L4 MABEL.
              </p>
              <div className="space-y-3">
                {[
                  ["Multi-Species PBPK", "Two-compartment RK4 ODE solver across rat / dog / monkey. Species-specific Vd, CL, protein binding from PK-Sim physiology atlas. Bound checks per stage; binding-precondition guards reject malformed inputs explicitly."],
                  ["Formulation Engine", "Six FDA-IIG-compliant classes (plain tablet · micronized · spray-dried · NLC · SNEDDS · nanosuspension). BCS classification picks the highest-defensible bioavailability boost — no fictional excipients."],
                  ["Allometric Scaling — ICH M3(R2)", "BW^0.75 for clearance, BW^1.0 for Vd. 1/10 NOAEL safety factor applied per ICH M3(R2). Bootstrap CIs on the human-equivalent dose."],
                  ["External Cross-Validation", "ToxCast · ToxRefDB · ECOTOX organ-tox; UniProt + AlphaFold target context; ChEMBL animal-PK ranges. Mismatches surface as HAIOps flags."],
                ].map(([title, desc]) => (
                  <div key={title as string} className="rounded-lg border border-amber-500/10 bg-amber-500/4 p-4">
                    <div className="text-[12px] font-semibold text-amber-300 mb-1">{title}</div>
                    <div className="text-[12px] text-slate-400 leading-relaxed font-mono">{desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Layer 4 */}
            <div>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-[11px] font-black text-emerald-400">L4</div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">Layer 4</div>
                  <div className="text-[18px] font-bold text-white">First-In-Human Readiness</div>
                </div>
              </div>
              <p className="text-[14px] text-slate-400 leading-relaxed mb-5">
                Takes L1 verdict + L2 ConfirmationBlock + L3 NOAEL/HED. Output: a sealed PreClinicalPackage v2.0.0 — the artefact a CRO, regulator, or licensing partner can ingest. This layer is the boundary into the clinic, not a clinical-trial simulator.
              </p>
              <div className="space-y-3">
                {[
                  ["MABEL-Biased FIH Dose", "Per FDA 2005 / EMA 2017 — minimal anticipated biological effect level. The Phase 1 Planner prefers MABEL over NOAEL/HED whenever target engagement is the binding constraint. Calculation derived from upstream evidence; never authored."],
                  ["IND-Enabling Gate (evaluateINDGate)", "Checks GLP toxicology coverage, CMC readiness, Investigator's Brochure outline, and Pre-IND meeting prerequisites. Every gap reports as a HAIOps flag with a remediation path — never silently waived."],
                  ["Phase 1 Planner Defaults (derivePhase1Defaults)", "Cohort sizing, escalation rules, and stopping criteria are derived from L1–L3 evidence. The clinician-in-the-loop owns every override; HAIOps logs every change."],
                  ["Sealed PreClinicalPackage v2.0.0", "Bundles L1 verdict + L2 ConfirmationBlock + L3 NOAEL/HED + L4 IND-gate result with full HAIOps provenance. Tamper-evident. Regulator-ingestible."],
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
            <h2 className="text-[32px] font-black tracking-tight text-white mb-6">Fingerprint-only inference</h2>
            <div className="space-y-4">
              <div className="rounded-xl border border-white/8 bg-white/2 p-5">
                <div className="text-[13px] font-semibold text-white mb-2">Browser side</div>
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  RDKit.js (WASM) computes descriptors, ADMET QSAR cross-checks, and organ-tox heuristics entirely in your browser. SMILES strings, structures, and molecular IP never leave the browser sandbox — the AI Service for L2/L3/L4 only ever sees Morgan fingerprint hashes.
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/2 p-5">
                <div className="text-[13px] font-semibold text-white mb-2">AI Service (server side)</div>
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  ML ADMET, ESM2 druggability, AutoDock Vina docking, ML affinity, and FEP refinement run on an isolated AI Service. The browser sends only <span className="text-white font-medium">Morgan fingerprints</span> (2048-bit one-way hashes) and target identifiers — mathematically irreversible. The server cannot reconstruct your structure.
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
                ["Drug-drug interactions", "Not included", "1.37M+ DDI warnings (DrugBank, FAERS, openFDA)"],
                ["Drug-protein interactions", "Target-class lookup", "28,000+ curated records (ChEMBL, BindingDB, PDBbind)"],
                ["Animal-PK cross-validation", "Allometric scaling only", "ToxCast · ToxRefDB · ECOTOX · ChEMBL animal-PK"],
              ].map(([label, std, prem]) => (
                <div key={label} className="grid grid-cols-3 divide-x divide-white/5 border-t border-white/5">
                  <div className="p-4 text-[12px] text-slate-300 font-medium">{label}</div>
                  <div className="p-4 text-[12px] text-slate-500">{std}</div>
                  <div className="p-4 text-[12px] text-slate-300">{prem}</div>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-slate-500 mt-5 leading-relaxed">
              For pre-clinical decisions at the $5M+ level — IND-enabling study design, FIH starting dose, partner/CRO handoff — Premium replaces educated estimates with predictions grounded in the same curated data used by pharmaceutical companies and regulatory agencies.
            </p>
          </section>

        </div>
      )}

      {/* ── Footer CTA ── */}
      <div className="border-t border-white/5 py-16 px-6 text-center">
        <p className="text-[14px] text-slate-500 mb-6">Ready to run a simulation?</p>
        <button
          onClick={() => { window.location.href = "/login"; }}
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
