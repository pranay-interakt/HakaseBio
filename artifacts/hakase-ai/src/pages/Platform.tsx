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
          From SMILES to IND-ready handoff
        </h1>
        <p className="text-[16px] text-slate-400 max-w-2xl mx-auto">
          Four cascading pre-clinical layers — In Vitro screening, in-silico + ex-vivo Confirmation, multi-species Animal Cohort, and First-In-Human Readiness. Each layer's evidence is sealed and cascaded forward by HAIOps. Source-quality tiered per output. No fake data, no synthetic fallbacks.
        </p>
      </div>

      {/* ── Overview ── */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Overview</div>
        <h2 className="text-[32px] font-black tracking-tight text-white mb-8">How the platform works</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
          {[
            { num: "L1", label: "In Vitro Twin",                q: "Is this molecule worth confirming?",                       color: "violet",  desc: "RDKit.js cheminformatics in the browser, ML-augmented ADMET, validated-target binding estimate, organ-tox cascade, and a HAIOps cascade gate that returns GO / WATCH / NO-GO with source-quality tier per output." },
            { num: "L2", label: "Confirmation Layer",            q: "Does the L1 verdict survive confirmation?",                color: "blue",    desc: "Two parallel sub-tracks. In-silico: a 10-stage pipeline (ESM2 druggability → AutoDock Vina docking → ML cross-check → selectivity / cardiotox → optional FEP on RunPod GPU → PBPK → QSP/PD → TI ranking → handoff). Ex-vivo: ingestion of wet-lab confirmation evidence. Sealed into a v2.0.0 ConfirmationBlock." },
            { num: "L3", label: "Animal Cohort",                 q: "How does it behave across species?",                       color: "amber",   desc: "Multi-species PBPK across rat, dog, and monkey with BCS-aware FDA-IIG formulation modeling, allometric scaling per ICH M3(R2), and species-by-species NOAEL — cross-validated against ToxCast, ToxRefDB, and ECOTOX." },
            { num: "L4", label: "First-In-Human Readiness",      q: "Are we IND-ready?",                                        color: "emerald", desc: "Phase 1 Planner derives a defensible MABEL-biased starting dose (FDA 2005 / EMA 2017), evaluates the IND-enabling gate (GLP tox · CMC · IB · Pre-IND), and seals the entire upstream evidence trail into a regulator-ingestible PreClinicalPackage v2.0.0." },
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
            { label: "SMILES + Target UniProt", color: "slate" },
            { arrow: true },
            { label: "L1 · In Vitro", color: "violet" },
            { arrow: true },
            { label: "L2 · Confirmation", color: "blue" },
            { arrow: true },
            { label: "L3 · Animal", color: "amber" },
            { arrow: true },
            { label: "L4 · FIH Readiness", color: "emerald" },
            { arrow: true },
            { label: "Sealed PreClinicalPackage v2.0.0", color: "slate" },
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
            <h2 className="text-[28px] font-black tracking-tight text-white">In Vitro Twin</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-5">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              Type a SMILES string and a UniProt target. RDKit.js (WebAssembly) runs the cheminformatics in your browser. ML-augmented ADMET, validated-target binding, organ-tox cascade, and a HAIOps cascade gate produce a verdict in seconds — every output tagged with its source-quality tier (heuristic / structural / ML / measured).
            </p>
            <div className="space-y-3">
              {[
                ["Real Cheminformatics", "MW, LogP, TPSA, HBD, HBA, QED, rotatable bonds via RDKit.js — the same C++ engine used at Pfizer and Novartis, compiled to WASM. Computed locally."],
                ["ML-Augmented ADMET", "Per-axis Absorption, Distribution, Metabolism, Excretion, Toxicity scores with confidence intervals. ML predictions cross-checked against Lipinski / Veber rules."],
                ["Validated-Target Binding", "Affinity estimate (Kd, Ki, IC50) only against targets with curated ChEMBL / BindingDB / PDBbind evidence. Unknown targets are flagged, never silently coerced."],
                ["Cascade Gate · GO / WATCH / NO-GO", "Deterministic gate: organ-tox flags, Lipinski violations, source-quality tier, and ADMET threshold all enter the verdict. Every flag is HAIOps-traceable, every override is logged."],
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
                alt="Layer 1 — In Vitro Twin interface showing ADMET radar, binding scores, and cascade gate verdict"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-3 text-center">Layer 1 — In Vitro Twin · ADMET radar · Validated-target binding · Cascade gate verdict</p>
          </div>
        </div>
      </section>

      {/* ── Layer 2 — Confirmation Layer ── */}
      <section id="layer2" className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-blue-500/40 bg-blue-500/10 flex items-center justify-center text-[12px] font-black text-blue-400 shrink-0">L2</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold">Layer 2</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">Confirmation Layer</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-5">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              Two parallel sub-tracks confirm the L1 verdict. The <span className="text-blue-300 font-semibold">in-silico track</span> runs a 10-stage pipeline that ingests the L1 EvidencePointer (frozen at Stage 0) and walks it through structural confirmation, physics-grounded refinement, and pharmacology projection. The <span className="text-blue-300 font-semibold">ex-vivo track</span> ingests wet-lab confirmation evidence. Both tracks seal into a single v2.0.0 ConfirmationBlock that L3 must consume.
            </p>
            <div className="space-y-3">
              {[
                ["Stages 0–4 · Structural Confirmation", "Ingest L1 → ESM2 protein druggability → AutoDock Vina docking (with OpenBabel + RDKit prep) → ML affinity cross-check → selectivity / cardiotox panel. Each stage emits a pass/watch/fail and a source-quality tier."],
                ["Stage 5 · FEP Free-Energy Refinement", "Optional alchemical free-energy perturbation on RunPod GPU (~24 GPU-h, cost-confirmed before launch). Replaces ML affinity with physics-grounded ΔG when the gate calls for it."],
                ["Stages 6–8 · Pharmacology Projection", "PBPK projection → QSP/PD coupling → therapeutic-index ranking. The PBPK projection seeds L3, the TI ranking seeds the L4 dose conversation."],
                ["Stage 9 · Sealed Confirmation Block", "ConfirmationLayerPanel seals a v2.0.0 ConfirmationEvidenceBlock with the L1 EvidencePointer baked in. Re-runs require explicit unseal — no silent recomputation."],
                ["Ex-Vivo Sub-Track", "Wet-lab evidence ingestion: organoid panels, primary hepatocyte CLint, hERG patch-clamp, microsomal stability. Tier promotion ('measured') trumps ML and structural tiers in the cascade gate."],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-xl border border-blue-500/10 bg-blue-500/4 p-4">
                  <div className="text-[11px] font-semibold text-blue-300 mb-1">{title}</div>
                  <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-8 flex flex-col gap-4">
              <div className="text-[10px] uppercase tracking-widest text-blue-500 font-semibold">In-Silico Pipeline · 10 Stages</div>
              <div className="space-y-1.5 font-mono text-[11px]">
                {[
                  ["0", "Ingest L1 EvidencePointer", "frozen", "text-slate-400"],
                  ["1", "ESM2 target druggability",  "ML",      "text-blue-300"],
                  ["2", "AutoDock Vina docking",     "structural", "text-blue-300"],
                  ["3", "ML affinity + ADMET cross-check", "ML", "text-blue-300"],
                  ["4", "Selectivity + cardiotox panel",   "ML", "text-blue-300"],
                  ["5", "FEP free-energy refinement (GPU)", "physics", "text-emerald-300"],
                  ["6", "PBPK projection",            "structural", "text-blue-300"],
                  ["7", "QSP/PD coupling",            "structural", "text-blue-300"],
                  ["8", "Therapeutic-index ranking",  "derived",    "text-blue-300"],
                  ["9", "Sealed Confirmation Block (v2.0.0)", "sealed", "text-amber-300"],
                ].map(([stage, name, tier, color]) => (
                  <div key={stage} className="flex items-center gap-3 rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
                    <div className="w-5 text-[10px] text-slate-500">{stage}</div>
                    <div className={`flex-1 ${color}`}>{name}</div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500">{tier}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 text-center mt-2">Layer 2 · In-silico (10 stages) + Ex-vivo · ConfirmationBlock v2.0.0 sealed</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Layer 3 — Animal Cohort ── */}
      <section id="layer3" className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center text-[12px] font-black text-amber-400 shrink-0">L3</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-amber-500 font-semibold">Layer 3</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">Animal Cohort</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-3 order-2 lg:order-1">
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 flex flex-col gap-4">
              <div className="text-[10px] uppercase tracking-widest text-amber-500 font-semibold">Layer 3 Outputs · Multi-Species PBPK</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Rat Cmax",         val: "2.8 µg/mL",       col: "text-amber-300" },
                  { label: "Dog AUC",          val: "18.4 µg·h/mL",    col: "text-amber-300" },
                  { label: "Monkey t½",        val: "6.2 h",            col: "text-amber-300" },
                  { label: "Rat NOAEL",        val: "100 mg/kg",       col: "text-green-400" },
                  { label: "Allometric HED",   val: "16 mg/kg",        col: "text-amber-200" },
                  { label: "Formulation",      val: "SNEDDS · BCS II", col: "text-amber-300" },
                ].map(({ label, val, col }) => (
                  <div key={label} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
                    <div className={`text-[15px] font-bold ${col}`}>{val}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 text-center mt-2">Layer 3 — Multi-species PBPK · BCS-aware formulation · Allometric HED · NOAEL by species</p>
            </div>
          </div>
          <div className="lg:col-span-2 order-1 lg:order-2 space-y-5">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              The L2 PBPK projection seeds species-specific parameters here. Pick rat, dog, or monkey, choose an FDA-IIG formulation, and the engine runs allometric scaling per ICH M3(R2) — outputting species-by-species NOAEL with a 1/10 safety factor and the human-equivalent dose that L4 will use as one input to its MABEL calculation.
            </p>
            <div className="space-y-3">
              {[
                ["Multi-Species PBPK", "Two-compartment RK4 ODE solver across rat / dog / monkey. Species-specific Vd, CL, protein binding from PK-Sim physiology. Animal-PK records cross-validated against ChEMBL."],
                ["Formulation Engine", "Six FDA-IIG-compliant classes (plain tablet · micronized · spray-dried · NLC · SNEDDS · nanosuspension). BCS classification picks the highest-defensible bioavailability boost — never a fictional excipient."],
                ["Allometric Scaling", "BW^0.75 for clearance, BW^1.0 for Vd. ICH M3(R2) safety factor of 1/10 of NOAEL. Bootstrap CIs on the human-equivalent dose."],
                ["External Cross-Validation", "ToxCast · ToxRefDB · ECOTOX organ-tox; UniProt + AlphaFold target context; ChEMBL animal-PK ranges. Mismatches surface as HAIOps flags rather than silent overrides."],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-xl border border-amber-500/10 bg-amber-500/4 p-4">
                  <div className="text-[11px] font-semibold text-amber-300 mb-1">{title}</div>
                  <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Layer 4 — First-In-Human Readiness ── */}
      <section id="layer4" className="max-w-6xl mx-auto px-6 py-20 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-[12px] font-black text-emerald-400 shrink-0">L4</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">Layer 4</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">First-In-Human Readiness</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-5">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              L4 is the boundary into the clinic — not a clinical-trial simulator. The Phase 1 Planner derives a defensible MABEL-biased starting dose, evaluates the IND-enabling gate, and seals every piece of upstream evidence into a single PreClinicalPackage v2.0.0. The output is an artefact a CRO, regulator, or licensing partner can ingest as-is.
            </p>
            <div className="space-y-3">
              {[
                ["MABEL-Biased FIH Dose", "Per FDA 2005 / EMA 2017 — minimal anticipated biological effect level. The gate prefers MABEL over NOAEL/HED whenever target engagement is the binding constraint. Calculation is derived from upstream evidence, not authored."],
                ["IND-Enabling Gate", "Checks GLP toxicology coverage, CMC readiness, Investigator's Brochure outline, and Pre-IND meeting prerequisites. Every gap is reported as a HAIOps flag with a remediation path — never silently waived."],
                ["Phase 1 Planner Defaults", "derivePhase1Defaults produces cohort sizing, escalation rules, and stopping criteria from L1–L3 evidence. The clinician-in-the-loop owns every override."],
                ["Sealed Handoff", "PreClinicalPackage v2.0.0 bundles L1 verdict + L2 ConfirmationBlock + L3 NOAEL/HED + L4 IND-gate result with full HAIOps provenance. Tamper-evident, regulator-ingestible."],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-xl border border-emerald-500/10 bg-emerald-500/4 p-4">
                  <div className="text-[11px] font-semibold text-emerald-300 mb-1">{title}</div>
                  <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 flex flex-col gap-4">
              <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">Sealed PreClinicalPackage v2.0.0</div>
              <div className="space-y-2 font-mono text-[11px]">
                {[
                  ["package",         "PreClinicalPackage v2.0.0",                  "text-emerald-300"],
                  ["l1.verdict",      "GO · ADMET 0.78 · cascade-gate cleared",     "text-violet-300"],
                  ["l2.confirmation", "ConfirmationBlock v2.0.0 · sealed",          "text-blue-300"],
                  ["l3.noael.rat",    "100 mg/kg · 1/10 safety factor applied",     "text-amber-300"],
                  ["l3.hed",          "16 mg/kg (allometric, BW^0.75)",             "text-amber-300"],
                  ["l4.fih.starting_dose", "0.4 mg/kg · MABEL-biased",              "text-emerald-200"],
                  ["l4.ind_gate",     "PASS — GLP tox, CMC, IB, Pre-IND OK",        "text-green-400"],
                  ["haiops.provenance", "342 events · 0 silent overrides",          "text-slate-400"],
                ].map(([key, val, color]) => (
                  <div key={key} className="flex items-center gap-3 rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
                    <div className="w-44 text-slate-500">{key}</div>
                    <div className={`flex-1 ${color}`}>{val}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 text-center mt-2">Layer 4 — Sealed handoff · MABEL-biased FIH · IND-enabling gate · Full provenance</p>
            </div>
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
