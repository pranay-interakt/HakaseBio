import { NavBar } from "@/components/NavBar";
import { useState } from "react";

const PILLARS = [
  {
    id: "clinical-validation",
    label: "Clinical Validation",
    icon: "🔬",
    color: "violet" as const,
    summary: "Ensuring predictions match real-world clinical outcomes",
    details: [
      "IC50 benchmarking against experimental BindingDB and ChEMBL affinities",
      "ADMET reference calibration against published profiles for known drug classes",
      "AOP-based structural alerts validated against OECD data and FDA withdrawal records",
      "NOAEL/MTD calibration against ToxRefDB reference ranges per species-route combination",
      "Allometric scaling cross-validation using both BSA/Km and PBPK-refined methods",
      "Responder rates benchmarked against published trial results from ClinicalTrials.gov",
      "Trial success probability contextualized against historical phase-specific success rates",
    ],
  },
  {
    id: "audit-trail",
    label: "Regulatory Audit Trail",
    icon: "📋",
    color: "blue" as const,
    summary: "Traceable records for every computational decision",
    details: [
      "Every GO/NO-GO verdict stores input parameters, model versions, and confidence scores",
      "FIH dose calculations preserve all intermediate values and allometric exponents",
      "ICH guideline mapping for every toxicity and safety assessment (M3, S2, S7A/B, S4A, E6)",
      "21 CFR Part 11-aligned immutable simulation records with user action logging",
      "Complete provenance chain: input → computation → enrichment → decision",
      "Export formats include JSON (machine-readable), PDF (with metadata footer), PNG (with embedded provenance)",
      "Monte Carlo simulation parameters fully recorded for reproducibility",
    ],
  },
  {
    id: "patient-safety",
    label: "Patient Safety Surveillance",
    icon: "🛡️",
    color: "red" as const,
    summary: "Safety-relevant findings flagged before advancement to next stage",
    details: [
      "6-flag Safety Cascade: cardiac, hepatotoxicity, DDI, narrow margin, high-grade AE, subgroup disparity",
      "Safety flags persist and propagate through all downstream layers — never silently dropped",
      "hERG IC50 < 10 µM triggers mandatory cardiac safety flag across all layers",
      "Structural alerts with confidence > 70% generate Review Required annotations",
      "CYP IC50 < 5 µM carries forward as DDI risk warnings into dose calculations",
      "Grade ≥3 AE incidence > 15% triggers DSMB requirement and stopping rules in trial design",
      "User overrides of NO-GO verdicts are logged and annotated in all downstream outputs",
    ],
  },
  {
    id: "compliance",
    label: "Compliance Monitoring",
    icon: "⚖️",
    color: "emerald" as const,
    summary: "Alignment with regulatory standards across jurisdictions",
    details: [
      "21 CFR Part 11: audit trails, data integrity controls, electronic signature-ready export",
      "HIPAA: de-identified population parameters from NHANES; no individual patient data enters the platform",
      "GDPR: cross-border data processing compliance, data minimization in population modeling",
      "ICH E6(R2): trial design outputs align with Good Clinical Practice principles",
      "CDISC SDTM/ADaM: Layer 3/4 outputs structured for regulatory submissions",
      "HL7 FHIR: API architecture supports FHIR resource formatting",
      "eCTD: report exports structured to support Module 2.6 and 2.7 requirements",
    ],
  },
  {
    id: "confidence",
    label: "Confidence Scoring",
    icon: "📊",
    color: "amber" as const,
    summary: "Quantifying statistical basis for each prediction",
    details: [
      "Every metric carries confidence intervals and data provenance annotations",
      "Trial success probability includes 95% CI from Monte Carlo distribution",
      "When compound falls outside training distribution, predictions flagged as extrapolated",
      "Database unavailability triggers staleness warnings with confidence downgrade",
      "Conservative defaults: disagreeing methods default to more conservative estimate",
      "Low confidence automatically downgrades GO → WATCH or WATCH → NO-GO",
      "Risk factors presented as structured pass/warn checklists, not composite scores",
    ],
  },
];

const SAFETY_FLAGS = [
  { flag: "Cardiac Safety", origin: "Layer 1 (hERG)", trigger: "hERG IC50 < 10 µM", cascade: "→ L2 CV tox prediction → L3 QT prolongation AE → L4 safety monitoring protocol", color: "red" as const },
  { flag: "Hepatotoxicity Alert", origin: "Layer 1 (Bioactivation)", trigger: "Liver-targeting structural alert with confidence > 70%", cascade: "→ L2 ALT/AST monitoring → L3 hepatic AE enrichment (FAERS) → L4 DILI monitoring in trial", color: "red" as const },
  { flag: "DDI Risk", origin: "Layer 1 (CYP Panel)", trigger: "CYP IC50 < 5 µM for any major enzyme", cascade: "→ L2 concomitant med restrictions → L3 DDI subgroup analysis → L4 I/E criteria for co-meds", color: "amber" as const },
  { flag: "Narrow Safety Margin", origin: "Layer 2 (PBPK)", trigger: "Safety margin < 3× (NOAEL/HED)", cascade: "→ L3 conservative dose escalation limits → L4 enhanced safety monitoring protocol", color: "amber" as const },
  { flag: "High-Grade AE Risk", origin: "Layer 3 (Cohort)", trigger: "Grade ≥3 AE incidence > 15%", cascade: "→ L4 dropout rate adjustment, DSMB requirement, stopping rules", color: "red" as const },
  { flag: "Subgroup Safety Disparity", origin: "Layer 3 (Subgroup)", trigger: "Any subgroup AE rate > 2× overall cohort", cascade: "→ L4 stratified randomization requirement, subgroup-specific I/E criteria", color: "amber" as const },
];

const MODEL_GOVERNANCE = [
  { model: "In Vitro Engine", risk: "Critical", fn: "IC50, permeability, clearance, hERG, selectivity simulation", governance: "Benchmark against published assay data, sensitivity analysis, mandatory confidence scoring" },
  { model: "Bioactivation Engine", risk: "Critical", fn: "AOP-based structural alert detection, metabolic pathway prediction", governance: "Validation against OECD AOP-Wiki, FDA withdrawal database, expert review of new alerts" },
  { model: "Animal PBPK Engine", risk: "Critical", fn: "Allometric scaling, NOAEL/MTD, FIH dose", governance: "Dual-method cross-validation (BSA vs. PBPK), conservative default enforcement" },
  { model: "Cohort Simulation", risk: "Critical", fn: "Virtual patient PK/PD, responder analysis", governance: "NHANES population parameter provenance, FAERS/SIDER real-world enrichment" },
  { model: "Trial Simulation", risk: "High", fn: "Monte Carlo trial design, power, cost", governance: "ClinicalTrials.gov benchmarking, Drugs@FDA precedent validation, seed logging" },
  { model: "ESM-2 (650M)", risk: "High", fn: "Protein structure prediction, binding affinity estimation", governance: "Clinical validation against PDB experimental structures, pLDDT confidence thresholds" },
  { model: "ADMET Engine", risk: "Moderate", fn: "5-axis pharmacokinetic scoring", governance: "Labeled as directional/computational, calibrated against DrugBank reference values" },
  { model: "Claude Analysis", risk: "Moderate", fn: "Narrative synthesis, GO/NO-GO rationale", governance: "Cannot override safety flags; constrained to synthesizing upstream outputs" },
  { model: "RDKit.js", risk: "Foundational", fn: "Molecular property computation (MW, LogP, TPSA, HBD, HBA)", governance: "Version pinning, deterministic output verification, regression testing" },
];

const RISK_TIERS = [
  { tier: "Foundational", def: "Deterministic computation, no ML inference", governance: "Version pinning, regression tests, input validation", cadence: "Per-release", color: "slate" as const },
  { tier: "Moderate", def: "ML inference with directional/advisory output only", governance: "Calibration benchmarks, confidence scoring, usage disclaimers", cadence: "Quarterly", color: "blue" as const },
  { tier: "High", def: "ML inference influencing quantitative predictions", governance: "Clinical validation sets, bias monitoring, sensitivity analysis, expert review", cadence: "Monthly", color: "amber" as const },
  { tier: "Critical", def: "Direct influence on safety-relevant decisions", governance: "All of the above + dual-method cross-validation, conservative defaults, mandatory safety flags, incident response protocol", cadence: "Continuous", color: "red" as const },
];

const LIFECYCLE_STAGES = [
  { stage: "Development", desc: "Model trained on domain-specific data with documented training data provenance, quality checks, and bias audits." },
  { stage: "Validation", desc: "Evaluated against clinical validation sets — comparisons against published experimental data, not just statistical benchmarks." },
  { stage: "Deployment", desc: "Version pinning, rollback capability, canary monitoring. No model update goes live without passing full validation suite." },
  { stage: "Monitoring", desc: "Continuous performance tracking against clinical benchmarks. Drift detection triggers automatic investigation for Critical-class models." },
  { stage: "Incident Response", desc: "Investigation within 24 hours for contradicting clinical evidence. Temporary fallback to previous validated version." },
  { stage: "Retirement", desc: "Models retired when superseded, when training data becomes stale, or when uncorrectable bias is discovered. Archived for audit." },
];

const colorMap = {
  violet: { bg: "bg-violet-500/10", border: "border-violet-500/25", text: "text-violet-400", dot: "bg-violet-400", glow: "shadow-violet-400/20" },
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/25", text: "text-blue-400", dot: "bg-blue-400", glow: "shadow-blue-400/20" },
  red: { bg: "bg-red-500/10", border: "border-red-500/25", text: "text-red-400", dot: "bg-red-400", glow: "shadow-red-400/20" },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/25", text: "text-emerald-400", dot: "bg-emerald-400", glow: "shadow-emerald-400/20" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/25", text: "text-amber-400", dot: "bg-amber-400", glow: "shadow-amber-400/20" },
  slate: { bg: "bg-slate-500/10", border: "border-slate-500/25", text: "text-slate-400", dot: "bg-slate-400", glow: "shadow-slate-400/20" },
};

export function HAIOps() {
  const [expandedPillar, setExpandedPillar] = useState<string | null>("clinical-validation");

  return (
    <div className="min-h-screen bg-[#060812] text-white">
      <NavBar sticky />

      {/* Hero */}
      <section className="relative pt-28 pb-20 px-6 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 via-transparent to-transparent" />
        <div className="relative max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 mb-6">
            <span className="text-[11px] font-semibold tracking-wider text-violet-400 uppercase">Framework</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-4">
            <span className="bg-gradient-to-r from-violet-400 via-blue-400 to-emerald-400 bg-clip-text text-transparent">HAIOps</span>
          </h1>
          <p className="text-xl md:text-2xl font-semibold text-slate-300 mb-3">Healthcare AI Operations</p>
          <p className="text-[15px] text-slate-400 max-w-3xl mx-auto leading-relaxed mb-8">
            A comprehensive framework extending MLOps for patient safety, regulatory compliance, and clinical efficacy.
            From model accuracy to patient outcomes.
          </p>
          <div className="flex items-center justify-center gap-6 flex-wrap">
            <div className="bg-white/5 border border-white/10 rounded-lg px-5 py-3 text-center">
              <div className="text-[24px] font-bold text-violet-400">5</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Pillars</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg px-5 py-3 text-center">
              <div className="text-[24px] font-bold text-red-400">6</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Safety Flags</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg px-5 py-3 text-center">
              <div className="text-[24px] font-bold text-blue-400">9</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Governed Models</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg px-5 py-3 text-center">
              <div className="text-[24px] font-bold text-emerald-400">4</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Risk Tiers</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Distinction */}
      <section className="px-6 pb-16">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white/3 border border-white/8 rounded-xl p-6">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Standard MLOps</div>
              <p className="text-[20px] font-bold text-slate-300 mb-3">"Is the model accurate?"</p>
              <div className="space-y-2">
                {["Revenue loss, UX degradation", "Hold-out test sets, cross-validation", "Optimized via precision/recall trade-off", "Automation-first philosophy"].map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full bg-slate-500 mt-2 shrink-0" />
                    <span className="text-[12px] text-slate-500">{t}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-violet-500/8 to-emerald-500/5 border border-violet-500/20 rounded-xl p-6">
              <div className="text-[11px] font-semibold text-violet-400 uppercase tracking-wider mb-2">HAIOps</div>
              <p className="text-[20px] font-bold text-white mb-3">"Does the model improve patient outcomes safely?"</p>
              <div className="space-y-2">
                {["Patient harm, regulatory action, legal liability", "Clinical validation against real-world outcomes", "Zero tolerance for safety-critical false negatives", "Clinician-in-the-loop mandatory for safety outputs"].map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className="w-1 h-1 rounded-full bg-violet-400 mt-2 shrink-0" />
                    <span className="text-[12px] text-slate-300">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Five Pillars */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-2">Five Pillars</h2>
          <p className="text-[13px] text-slate-500 mb-8">HAIOps governs every layer of the BioDigital Twin through five operational pillars</p>
          <div className="space-y-3">
            {PILLARS.map(p => {
              const c = colorMap[p.color];
              const open = expandedPillar === p.id;
              return (
                <div key={p.id} className={`${c.bg} border ${c.border} rounded-xl overflow-hidden transition-all`}>
                  <button
                    onClick={() => setExpandedPillar(open ? null : p.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-[20px]">{p.icon}</span>
                    <div className="flex-1">
                      <div className={`text-[14px] font-bold ${c.text}`}>{p.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{p.summary}</div>
                    </div>
                    <svg className={`w-4 h-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {open && (
                    <div className="px-5 pb-4 pt-0 border-t border-white/5">
                      <div className="space-y-2 mt-3">
                        {p.details.map((d, i) => (
                          <div key={i} className="flex items-start gap-2.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${c.dot} mt-1.5 shrink-0`} />
                            <span className="text-[12px] text-slate-300 leading-relaxed">{d}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Safety Flag Cascade */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-2">Safety Flag Cascade</h2>
          <p className="text-[13px] text-slate-500 mb-8">Safety-relevant findings persist and propagate through all downstream layers — never silently dropped</p>
          <div className="space-y-3">
            {SAFETY_FLAGS.map((sf, idx) => {
              const c = colorMap[sf.color];
              return (
                <div key={idx} className={`${c.bg} border ${c.border} rounded-xl p-5`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${c.dot} shadow-[0_0_8px] ${c.glow} mt-1 shrink-0`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1.5">
                        <span className={`text-[13px] font-bold ${c.text}`}>{sf.flag}</span>
                        <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded">{sf.origin}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mb-2">
                        <span className="text-slate-500">Trigger: </span>{sf.trigger}
                      </div>
                      <div className="text-[11px] text-slate-300 bg-white/3 rounded-lg px-3 py-2 font-mono">
                        {sf.cascade}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Model Governance */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-2">AI Model Governance</h2>
          <p className="text-[13px] text-slate-500 mb-6">Every model is classified by its impact on patient safety decisions and governed accordingly</p>

          {/* Risk Tiers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {RISK_TIERS.map(rt => {
              const c = colorMap[rt.color];
              return (
                <div key={rt.tier} className={`${c.bg} border ${c.border} rounded-xl p-4`}>
                  <div className={`text-[12px] font-bold ${c.text} mb-1`}>{rt.tier}</div>
                  <div className="text-[10px] text-slate-400 mb-2 leading-relaxed">{rt.def}</div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">Review: {rt.cadence}</div>
                </div>
              );
            })}
          </div>

          {/* Model Table */}
          <div className="bg-white/3 border border-white/8 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-white/8 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              <div className="col-span-2">Model</div>
              <div className="col-span-1">Risk</div>
              <div className="col-span-4">Function</div>
              <div className="col-span-5">HAIOps Governance</div>
            </div>
            {MODEL_GOVERNANCE.map((m, i) => {
              const riskColor = m.risk === "Critical" ? "text-red-400 bg-red-500/15" : m.risk === "High" ? "text-amber-400 bg-amber-500/15" : m.risk === "Moderate" ? "text-blue-400 bg-blue-500/15" : "text-slate-400 bg-slate-500/15";
              return (
                <div key={i} className={`grid grid-cols-12 gap-3 px-5 py-3 text-[11px] ${i < MODEL_GOVERNANCE.length - 1 ? "border-b border-white/5" : ""}`}>
                  <div className="col-span-2 font-semibold text-white">{m.model}</div>
                  <div className="col-span-1"><span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${riskColor}`}>{m.risk}</span></div>
                  <div className="col-span-4 text-slate-400">{m.fn}</div>
                  <div className="col-span-5 text-slate-300">{m.governance}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Model Lifecycle */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-2">Model Lifecycle</h2>
          <p className="text-[13px] text-slate-500 mb-8">Six-stage lifecycle governing every model component in the BioDigital Twin</p>
          <div className="relative">
            {LIFECYCLE_STAGES.map((s, i) => (
              <div key={i} className="flex gap-4 mb-1">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-violet-400 border-2 border-[#060812] z-10 shadow-[0_0_8px] shadow-violet-400/30" />
                  {i < LIFECYCLE_STAGES.length - 1 && <div className="w-px flex-1 bg-violet-500/20 min-h-[40px]" />}
                </div>
                <div className="pb-6">
                  <div className="text-[13px] font-bold text-white mb-1">{s.stage}</div>
                  <div className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Clinician in the Loop */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-2">Clinician-in-the-Loop Design</h2>
          <p className="text-[13px] text-slate-500 mb-8">Computational predictions are never treated as standalone decisions</p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { label: "Three-Tier Verdicts", desc: "GO / WATCH / NO-GO framework — not binary. WATCH explicitly communicates 'proceed with additional investigation.'" },
              { label: "Confidence on Every Metric", desc: "Users see not just the prediction but how certain the platform is, with confidence intervals and data provenance." },
              { label: "Mandatory Review Annotations", desc: "Safety-relevant findings carry 'Review Required' flags that cannot be dismissed without user acknowledgment." },
              { label: "Conservative Defaults", desc: "When two methods disagree, the platform defaults to the more conservative estimate. Low confidence downgrades verdicts." },
              { label: "AI Cannot Override Safety", desc: "Claude-generated analysis cannot override safety flags from simulation engines. AI reports state which safety concerns remain unresolved." },
              { label: "Override Logging", desc: "If a user advances past a NO-GO verdict, the override is logged and all downstream outputs carry an annotation." },
            ].map((item, i) => (
              <div key={i} className="bg-white/3 border border-white/8 rounded-xl p-4">
                <div className="text-[12px] font-bold text-violet-400 mb-1.5">{item.label}</div>
                <div className="text-[11px] text-slate-400 leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data Governance */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-2">Data Governance & Provenance</h2>
          <p className="text-[13px] text-slate-500 mb-8">Every simulation output carries a provenance chain documenting inputs, computation, enrichment, and decisions</p>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              { label: "Input Provenance", items: ["SMILES source (manual, Diagen, API import)", "UniProt accession and version", "Therapeutic area preset"] },
              { label: "Computation Provenance", items: ["Simulation engine file and version hash", "Model versions for all ML components", "Timestamp and random seed"] },
              { label: "Data Enrichment Provenance", items: ["Database versions queried with timestamps", "Number of results returned per source", "Confidence thresholds applied"] },
              { label: "Decision Provenance", items: ["GO/NO-GO threshold values", "Metrics that drove the verdict", "Override history if any"] },
            ].map((section, i) => (
              <div key={i} className="bg-white/3 border border-white/8 rounded-xl p-4">
                <div className="text-[12px] font-bold text-blue-400 mb-2">{section.label}</div>
                <div className="space-y-1.5">
                  {section.items.map((item, j) => (
                    <div key={j} className="flex items-start gap-2">
                      <div className="w-1 h-1 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <span className="text-[11px] text-slate-400">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Regulatory Compliance */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-white mb-2">Regulatory Compliance</h2>
          <p className="text-[13px] text-slate-500 mb-6">Multi-jurisdictional regulatory framework alignment</p>
          <div className="bg-white/3 border border-white/8 rounded-xl overflow-hidden">
            {[
              { standard: "21 CFR Part 11", scope: "Electronic records & signatures (FDA)", impl: "Audit trail, data integrity controls, access control, e-signature-ready export" },
              { standard: "HIPAA", scope: "Protected health information (US)", impl: "De-identified population parameters from NHANES; no individual patient data" },
              { standard: "GDPR", scope: "Personal data protection (EU)", impl: "Cross-border compliance, right-to-erasure, data minimization" },
              { standard: "ICH E6(R2)", scope: "Good Clinical Practice", impl: "Trial design outputs aligned with GCP principles" },
              { standard: "ICH M3(R2)", scope: "Nonclinical safety studies", impl: "IND-Enabling Checklist maps directly to M3(R2) requirements" },
              { standard: "ICH S7A/S7B", scope: "Safety pharmacology", impl: "hERG assessment (S7B), CV/CNS/respiratory evaluation (S7A)" },
              { standard: "CDISC SDTM/ADaM", scope: "Standardized clinical data", impl: "Layer 3/4 outputs structured for SDTM domains; AE coding MedDRA-compatible" },
              { standard: "HL7 FHIR", scope: "Healthcare data interoperability", impl: "API architecture supports FHIR resource formatting" },
              { standard: "eCTD", scope: "Electronic Common Technical Document", impl: "Report exports support Module 2.6 and 2.7 requirements" },
            ].map((r, i) => (
              <div key={i} className={`grid grid-cols-12 gap-3 px-5 py-3 text-[11px] ${i > 0 ? "border-t border-white/5" : ""}`}>
                <div className="col-span-2 font-semibold text-emerald-400">{r.standard}</div>
                <div className="col-span-4 text-slate-500">{r.scope}</div>
                <div className="col-span-6 text-slate-300">{r.impl}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-10 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-[11px] text-slate-600">HAIOps Framework v1.0 — AKTHealth Inc.</div>
          <div className="text-[11px] text-slate-600">Healthcare AI Operations for the BioDigital Twin Platform</div>
        </div>
      </footer>
    </div>
  );
}
