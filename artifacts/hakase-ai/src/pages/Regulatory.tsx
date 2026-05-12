import { NavBar } from "@/components/NavBar";
import { useEffect } from "react";
import { useLocation } from "wouter";
import screenshotL1 from "@assets/Screenshot_2026-03-17_at_0.16.53_1773692331159.png";
import screenshotL2 from "@assets/Screenshot_2026-03-17_at_0.17.18_1773692331160.png";
import screenshotL3 from "@assets/Screenshot_2026-03-17_at_0.17.40_1773692331161.png";

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

export function Regulatory() {
  const [, navigate] = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-[Inter,sans-serif]">
      <NavBar sticky />

      {/* ── Hero ── */}
      <div className="relative z-10 overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-600/6 rounded-full blur-[120px]" />
          <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-violet-600/5 rounded-full blur-[100px]" />
          <div className="absolute top-1/4 right-1/4 w-[400px] h-[400px] bg-emerald-600/5 rounded-full blur-[100px]" />
        </div>
        <div className="relative px-6 pt-24 pb-20 text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 text-[11px] font-semibold tracking-wide uppercase mb-6">
            <ShieldIcon className="w-3.5 h-3.5" />
            Platform · Regulatory Intelligence
          </div>
          <h1 className="text-[52px] md:text-[64px] font-black tracking-tighter leading-none mb-6">
            <span className="text-white">Regulatory clarity</span>
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
              before you file.
            </span>
          </h1>
          <p className="text-[17px] text-slate-400 max-w-2xl mx-auto leading-relaxed mb-10">
            Every simulation layer generates a live Regulatory Outlook — covering IND-enabling studies, FDA clinical pharmacology packages, designation eligibility, and full development timelines. No regulatory consultant required.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              onClick={() => navigate("/login")}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[14px] transition-all shadow-lg shadow-blue-500/25"
            >
              Run a Simulation →
            </button>
            <button
              onClick={() => navigate("/platform")}
              className="px-6 py-3 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:border-white/25 font-medium text-[14px] transition-all"
            >
              View the Platform
            </button>
          </div>
        </div>
      </div>

      {/* ── What it covers ── */}
      <section className="max-w-5xl mx-auto px-6 py-20 border-b border-white/5">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Coverage</div>
        <h2 className="text-[32px] font-black tracking-tight text-white mb-3">Four layers. One complete regulatory picture.</h2>
        <p className="text-[14px] text-slate-400 mb-10 max-w-2xl">
          The Regulatory Outlook updates automatically at each pre-clinical layer — cascading In Vitro flags through structural & ex-vivo confirmation, multi-species PBPK, and FIH readiness into a sealed PreClinicalPackage v2.0.0.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            {
              layer: "L1",
              color: "violet",
              title: "In Vitro Twin",
              items: ["hERG / Cardiac QT flags", "Mutagenicity / Genotox alerts", "Required IND-enabling studies", "Physicochemical vs FDA guidance", "Source-quality tier per output"],
            },
            {
              layer: "L2",
              color: "blue",
              title: "Confirmation Layer",
              items: ["Structural confirmation (ESM2 + Vina)", "Selectivity & cardiotox cross-check", "Opt-in FEP refinement (RunPod)", "Ex-vivo evidence (organoid / hERG / hepatocyte)", "Sealed ConfirmationBlock v2.0.0"],
            },
            {
              layer: "L3",
              color: "amber",
              title: "Animal Cohort",
              items: ["Multi-species PBPK (rat · dog · monkey)", "FDA-IIG-compliant formulation engine", "Allometric scaling per ICH M3(R2)", "NOAEL → HED with bootstrap CIs", "Cross-validated vs ToxCast / ToxRefDB"],
            },
            {
              layer: "L4",
              color: "emerald",
              title: "FIH Readiness",
              items: ["MABEL-biased starting dose (FDA 2005 / EMA 2017)", "IND-enabling gate · GLP tox · CMC · IB", "Pre-IND meeting prerequisites", "Designation eligibility · Fast Track · Orphan", "Sealed PreClinicalPackage v2.0.0 handoff"],
            },
          ].map(({ layer, color, title, items }) => {
            const styles = {
              violet:  { border: "border-violet-500/20 bg-violet-500/4",   badgeBorder: "border-violet-500/40 bg-violet-500/10 text-violet-400",    titleText: "text-violet-300",  check: "text-violet-400" },
              blue:    { border: "border-blue-500/20 bg-blue-500/4",       badgeBorder: "border-blue-500/40 bg-blue-500/10 text-blue-400",          titleText: "text-blue-300",    check: "text-blue-400" },
              amber:   { border: "border-amber-500/20 bg-amber-500/4",     badgeBorder: "border-amber-500/40 bg-amber-500/10 text-amber-400",       titleText: "text-amber-300",   check: "text-amber-400" },
              emerald: { border: "border-emerald-500/20 bg-emerald-500/4", badgeBorder: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400", titleText: "text-emerald-300", check: "text-emerald-400" },
            }[color] ?? { border: "", badgeBorder: "", titleText: "", check: "" };
            return (
              <div key={layer} className={`rounded-2xl border p-6 ${styles.border}`}>
                <div className={`w-10 h-10 rounded-full border flex items-center justify-center text-[11px] font-black mb-4 ${styles.badgeBorder}`}>{layer}</div>
                <div className={`text-[12px] font-bold mb-3 ${styles.titleText}`}>{title}</div>
                <ul className="space-y-2">
                  {items.map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${styles.check}`} />
                      <span className="text-[12px] text-slate-400">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── L1: In Vitro & Preclinical ── */}
      <section id="preclinical" className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-violet-500/40 bg-violet-500/10 flex items-center justify-center text-[12px] font-black text-violet-400 shrink-0">L1</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-violet-500 font-semibold">Layer 1 — Regulatory Outlook</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">In Vitro & Preclinical Regulatory Flags</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-4">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              The moment Layer 1 simulation completes, your compound's ADMET profile is translated into a preclinical regulatory checklist — directly linked to IND submission requirements.
            </p>
            <div className="space-y-3">
              {[
                ["Preclinical Safety Flags", "hERG/Cardiac QT, Mutagenicity/Genotox, and CYP/Reactive Metabolite flags — each mapped to mandatory ICH study requirements."],
                ["IND-Enabling Package", "Six required study types auto-generated with urgency weighting (Urgent → Required → Waivable) based on your compound's flags."],
                ["Physicochemical Thresholds", "LogP, MW, and absorption compared directly against FDA guidance limits (RO5, BCS Class I/II) with pass/fail indicators."],
                ["Precedent Drug Context", "Approved drugs in the same structural class surface automatically — providing regulatory precedent for your IND narrative."],
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
                alt="Layer 1 Regulatory Outlook — Preclinical safety flags, IND-enabling study checklist, and FDA physicochemical thresholds"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-3 text-center">L1 Regulatory Outlook · Preclinical flags · IND-enabling package · FDA guidance thresholds</p>
          </div>
        </div>
      </section>

      {/* ── L3: Animal Cohort → Clinical Pharmacology Package ── */}
      <section id="clinical-pk" className="max-w-6xl mx-auto px-6 py-20 border-b border-white/5 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-amber-500/40 bg-amber-500/10 flex items-center justify-center text-[12px] font-black text-amber-400 shrink-0">L3</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-amber-500 font-semibold">Layer 3 — Regulatory Outlook</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">Animal Cohort PBPK → Clinical Pharmacology Package</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-3 order-2 lg:order-1">
            <div className="rounded-2xl border border-white/10 overflow-hidden shadow-2xl shadow-black/60">
              <img
                src={screenshotL2}
                alt="Layer 3 Regulatory Outlook — Animal Cohort PBPK driving the Phase I clinical pharmacology package, PK variability, and FAERS AE signals"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-3 text-center">L3 Regulatory Outlook · Multi-species PBPK · Phase I clinical pharmacology package · FAERS AE label signals</p>
          </div>
          <div className="lg:col-span-2 order-1 lg:order-2 space-y-4">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              Multi-species PBPK and allometric scaling outputs (per ICH M3(R2)) feed directly into the Phase I clinical-pharmacology package — bracketing dose, exposure, and PK variability before any human exposure.
            </p>
            <div className="space-y-3">
              {[
                ["Allometric Dose Bracketing", "1/10 NOAEL safety factor with bootstrap CIs on the human-equivalent dose. The MABEL-biased starting dose (L4) is preferred whenever target engagement is binding."],
                ["FDA Study Package", "Full SAD, MAD, Food Effect, Renal/Hepatic Impairment, QT/QTc (TQT), DDI, and PopPK study requirements — each tagged Required or Recommended."],
                ["PK Variability Assessment", "Cmax CV% drives TDM guidance: high variability (>50%) triggers mandatory exposure-response labelling per FDA guidance."],
                ["FAERS AE Label Signals", "Adverse event rates calibrated against FAERS post-market data — pre-populating the WARNINGS AND PRECAUTIONS label section."],
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

      {/* ── L4: First-In-Human Readiness ── */}
      <section id="pathway" className="max-w-6xl mx-auto px-6 py-20 scroll-mt-20">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center text-[12px] font-black text-emerald-400 shrink-0">L4</div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-500 font-semibold">Layer 4 — Regulatory Outlook</div>
            <h2 className="text-[28px] font-black tracking-tight text-white">First-In-Human Readiness & IND Handoff</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-start">
          <div className="lg:col-span-2 space-y-4">
            <p className="text-[14px] text-slate-400 leading-relaxed">
              The Phase 1 Planner derives a defensible MABEL-biased starting dose, evaluates the IND-enabling gate, and seals every upstream piece of evidence into a regulator-ingestible PreClinicalPackage v2.0.0. The outcome is a single artefact a CRO, regulator, or licensing partner can ingest as-is.
            </p>
            <div className="space-y-3">
              {[
                ["MABEL-Biased FIH Dose", "Per FDA 2005 / EMA 2017 guidance — minimum anticipated biological effect level. Preferred over NOAEL/HED whenever target engagement is the binding constraint. Calculation derived from upstream evidence; never authored."],
                ["IND-Enabling Gate", "Automated check of GLP toxicology coverage, CMC readiness, Investigator's Brochure outline, and Pre-IND meeting prerequisites. Every gap surfaces as a HAIOps flag with a remediation path — never a silent waiver."],
                ["Designation Eligibility", "Breakthrough Therapy, Fast Track, Accelerated Approval, and Orphan Drug eligibility computed from L1–L3 evidence quality, indication, and target population."],
                ["Sealed PreClinicalPackage", "v2.0.0 bundles L1 verdict + L2 ConfirmationBlock + L3 NOAEL/HED + L4 IND-gate result with full HAIOps provenance. Tamper-evident. Regulator-ingestible."],
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
                alt="Layer 4 Regulatory Outlook — MABEL-biased FIH dose, IND-enabling gate, and sealed PreClinicalPackage handoff"
                className="w-full h-auto block"
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-3 text-center">L4 Regulatory Outlook · MABEL FIH dose · IND-enabling gate · Sealed PreClinicalPackage v2.0.0</p>
          </div>
        </div>
      </section>

      {/* ── Why it matters ── */}
      <section className="border-t border-white/5 bg-white/1">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Why it matters</div>
          <h2 className="text-[32px] font-black tracking-tight text-white mb-10">The regulatory gap in early drug development</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                stat: "~40%",
                label: "of Phase I trials fail due to safety/PK issues",
                detail: "Issues that could have been identified and mitigated with early preclinical regulatory flag analysis.",
                color: "red",
              },
              {
                stat: "$2.4B",
                label: "average cost to bring a drug to market",
                detail: "Regulatory intelligence at the discovery stage can redirect resources before costly Phase II/III commitments.",
                color: "amber",
              },
              {
                stat: "12–18mo",
                label: "average time from IND submission to Phase I start",
                detail: "Understanding the required IND package in simulation — not after — compresses the preparation timeline significantly.",
                color: "blue",
              },
            ].map(({ stat, label, detail, color }) => (
              <div key={stat} className="space-y-2">
                <div className={`text-[40px] font-black tracking-tight ${
                  color === "red" ? "text-red-400" : color === "amber" ? "text-amber-400" : "text-blue-400"
                }`}>{stat}</div>
                <div className="text-[13px] font-semibold text-white">{label}</div>
                <div className="text-[12px] text-slate-500 leading-relaxed">{detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it's generated ── */}
      <section className="border-t border-white/5 max-w-5xl mx-auto px-6 py-20">
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-semibold mb-3">Methodology</div>
        <h2 className="text-[32px] font-black tracking-tight text-white mb-8">How the Regulatory Outlook is generated</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            {
              title: "Deterministic Rules Engine",
              desc: "Regulatory flags are computed from simulation outputs using codified FDA/ICH guidance — hERG → Cardiac QT study, mutagenicity → Ames + MN battery, CYP → full DDI panel. No AI hallucination risk for critical compliance items.",
              icon: "⚙️",
            },
            {
              title: "ICH Guideline Mapping",
              desc: "Study requirements are mapped to ICH S7A/B (safety pharmacology), ICH E14 (QT/QTc), ICH M3(R2) (non-clinical studies), and FDA clinical pharmacology guidance documents for NDA/BLA submissions.",
              icon: "📋",
            },
            {
              title: "PBPK-Driven Dosing",
              desc: "Phase I dose strategy (MRSD, interval, DLT risk) is computed directly from PBPK simulation outputs — not static estimates. The 1/10 × Cmax approach follows FDA Phase I dose escalation guidance.",
              icon: "💊",
            },
            {
              title: "FAERS Signal Integration",
              desc: "Adverse event rates are calibrated against FDA's Adverse Event Reporting System to provide realistic label-informing incidence estimates for the Warnings and Precautions section.",
              icon: "📊",
            },
            {
              title: "MABEL-Biased Starting Dose",
              desc: "FIH starting-dose calculation per FDA 2005 / EMA 2017 — MABEL is preferred over NOAEL/HED whenever target engagement is the binding constraint. Calculation derived from L1–L3 evidence; never authored, never silently overridden.",
              icon: "🏛️",
            },
            {
              title: "Sealed Handoff (PreClinicalPackage v2.0.0)",
              desc: "Every upstream evidence object (L1 verdict, L2 ConfirmationBlock, L3 NOAEL/HED, L4 IND-gate result) is sealed into a tamper-evident, regulator-ingestible bundle with full HAIOps provenance — the artefact a CRO, regulator, or licensing partner can ingest as-is.",
              icon: "📦",
            },
          ].map(({ title, desc, icon }) => (
            <div key={title} className="rounded-xl border border-white/8 bg-white/2 p-5">
              <div className="text-[20px] mb-3">{icon}</div>
              <div className="text-[13px] font-semibold text-white mb-2">{title}</div>
              <div className="text-[12px] text-slate-400 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <div className="border-t border-white/5 py-20 px-6 text-center bg-gradient-to-b from-transparent to-blue-950/10">
        <div className="inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 text-[11px] font-semibold">
          <ShieldIcon className="w-3.5 h-3.5" />
          Available in every simulation run
        </div>
        <h2 className="text-[36px] font-black tracking-tight text-white mb-3">Your IND package starts here.</h2>
        <p className="text-[14px] text-slate-400 max-w-xl mx-auto mb-8">
          Every simulation generates a complete Regulatory Outlook — no configuration required. Run a simulation, get your regulatory picture.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <button
            onClick={() => navigate("/platform")}
            className="px-6 py-2.5 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:border-white/20 transition-colors text-[14px] font-medium"
          >
            View the Platform →
          </button>
          <button
            onClick={() => navigate("/login")}
            className="px-8 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors text-white font-semibold text-[14px] shadow-lg shadow-blue-500/20"
          >
            Launch BioDigital Twin →
          </button>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="border-t border-white/5 py-8 px-6 flex items-center justify-between text-[11px] text-slate-600">
        <span>HakaseAI · Regulatory Intelligence · v1.0</span>
        <div className="flex gap-6">
          <button onClick={() => navigate("/platform")} className="hover:text-slate-400 transition-colors">Platform</button>
          <button onClick={() => navigate("/story")} className="hover:text-slate-400 transition-colors">The Story</button>
          <button onClick={() => navigate("/login")} className="hover:text-slate-400 transition-colors">Get Started</button>
        </div>
      </div>
    </div>
  );
}
