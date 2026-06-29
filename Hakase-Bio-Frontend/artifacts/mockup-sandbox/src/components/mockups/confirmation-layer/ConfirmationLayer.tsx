import { useState } from "react";
import {
  Lock,
  Cpu,
  ShieldAlert,
  Microscope,
  AlertTriangle,
  GitMerge,
  DoorOpen,
  ChevronRight,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Wrench,
  Hash,
  Stamp,
  FileJson,
  ExternalLink,
  Beaker,
  FlaskConical,
  Activity,
  Moon,
  Atom,
  Users,
  Syringe,
  TrendingUp,
  ArrowRight,
  Clock,
} from "lucide-react";

// Visual parity with hakase-clinical: dark slate-200 surface,
// violet-500/600 primary, white-alpha cards, uppercase tracked labels.

type LayerId = "L1" | "L2" | "L3" | "L4";
type PhaseStatus =
  | "passed"
  | "passed-with-override"
  | "passed-with-conditions"
  | "partial"
  | "running"
  | "blocked";
type DomainConfidence = "high" | "moderate" | "low" | "no-prediction";
type JointState =
  | "agreed"
  | "disagreed-ex-vivo-wins"
  | "partial"
  | "falsified"
  | "exempt";

// ── Fixture: Imatinib partial-data ───────────────────────────────────────────

const compound = {
  inn: "Imatinib",
  cas: "152459-95-5",
  klass: "Small molecule (BCR-ABL TKI)",
  programId: "PROG-IMA-2026-04",
  indication: "Chronic myeloid leukemia (CML, chronic phase)",
};

const l1Pointer = {
  id: "sha256:9f4c…a1b2",
  emittedAt: "2026-04-28T14:21:08Z",
  emitter: "hakase-ai/in-silico v1.7.3",
};

const gatePolicy = {
  id: "confirmation-gate-policy",
  version: "1.4.2",
  falsifierRegistry: "hakase-clinical/falsifiers v3.0.0",
  exemptionRegistry: "hakase-clinical/exemptions v1.2.0",
};

type LayerStepDef = {
  id: LayerId;
  n: number;
  label: string;
  oneLiner: string;
  icon: typeof Beaker;
  state: "complete" | "active" | "queued";
};

const LAYERS: LayerStepDef[] = [
  { id: "L1", n: 1, label: "In-Silico", oneLiner: "ML predictions · structural priors · upstream from hakase-ai", icon: Cpu, state: "complete" },
  { id: "L2", n: 2, label: "Confirmation", oneLiner: "7-phase pipeline · in-silico ↔ ex-vivo joint synthesis", icon: FlaskConical, state: "active" },
  { id: "L3", n: 3, label: "Animal Cohort", oneLiner: "Cohort design · GLP toxicology · NOAEL", icon: Microscope, state: "queued" },
  { id: "L4", n: 4, label: "FIH Handover", oneLiner: "Package consumed by Phase 1 sponsor · MABEL · IND gate", icon: Activity, state: "queued" },
];

const PHASES: { n: number; key: string; label: string; icon: typeof Lock; status: PhaseStatus; note: string }[] = [
  { n: 1, key: "ingest", label: "Ingest & Lock", icon: Lock, status: "passed", note: "L1 evidence pointer frozen" },
  { n: 2, key: "insilico", label: "In-Silico Predictions", icon: Cpu, status: "partial", note: "1 directive gap (clearance)" },
  { n: 3, key: "isgate", label: "In-Silico Gate", icon: ShieldAlert, status: "passed-with-override", note: "off-target falsifier accepted" },
  { n: 4, key: "exvivo", label: "Ex-Vivo Runs", icon: Microscope, status: "passed-with-conditions", note: "1 retry (hERG technical)" },
  { n: 5, key: "falsifier", label: "Falsifier Check", icon: AlertTriangle, status: "passed-with-conditions", note: "1 falsifier triggered (off-target)" },
  { n: 6, key: "joint", label: "Joint Synthesis", icon: GitMerge, status: "partial", note: "2/4 domains require attention" },
  { n: 7, key: "exit", label: "Exit Gate → L3", icon: DoorOpen, status: "passed-with-conditions", note: "passed under policy v1.4.2" },
];

const inSilicoPredictions: { domain: string; prediction: string; confidence: DomainConfidence; thresholdMet: boolean }[] = [
  { domain: "CYP-Transporter (CYP3A4 inh.)", prediction: "IC50 4.1–7.2 µM", confidence: "moderate", thresholdMet: true },
  { domain: "Clearance fractions", prediction: "no prediction", confidence: "no-prediction", thresholdMet: false },
  { domain: "Off-target kinome (SRC selectivity)", prediction: "≥20× selective vs SRC", confidence: "moderate", thresholdMet: false },
  { domain: "Dose-response (BCR-ABL)", prediction: "Hill 1.1, EC50 24 nM", confidence: "high", thresholdMet: true },
];

const override = {
  authority: {
    actor: "M. Sato",
    role: "Program Lead — Oncology",
    policy: { registry: "hakase-clinical-overrides", id: "OR-IS-GATE-FALSIFIER-001", version: "1.4.0" },
  },
  reason:
    "Off-target prediction below high-confidence threshold; accepting kinase-selectivity falsifier KIN-SEL-PROFILE for ex-vivo decision. Risk acknowledged for SRC-family activity.",
  falsifierAccepted: { registryId: "hakase-clinical/falsifiers", falsifierId: "KIN-SEL-PROFILE", registryVersion: "3.0.0" },
  l1EvidenceCited: { pointer: l1Pointer.id, fields: ["mlPriors.offTarget.kinomeProfile", "mlPriors.offTarget.srcSelectivity"] },
  appliedAt: "2026-04-29T09:14:02Z",
};

const exVivoRuns: {
  assayId: string; domain: string; measured: string; expected: string;
  rangeStatus: "within-range" | "above-range" | "below-range";
  consumedDirectiveAssayRow: string; failures: number;
}[] = [
  { assayId: "ASSAY-CYP3A4-IC50", domain: "CYP-Transporter", measured: "5.6 µM", expected: "4.1–7.2 µM", rangeStatus: "within-range", consumedDirectiveAssayRow: "directive#assay[0]", failures: 0 },
  { assayId: "ASSAY-HEPATOCYTE-CL", domain: "Clearance (broadened)", measured: "12.4 µL/min/Mcells", expected: "broadened — directive gap", rangeStatus: "within-range", consumedDirectiveAssayRow: "directive#gap[clearance].broadenedAssays[0]", failures: 0 },
  { assayId: "ASSAY-KINOME-PROFILE", domain: "Off-target", measured: "SRC IC50 0.18 µM (8× vs ABL)", expected: "≥20× selective vs SRC", rangeStatus: "below-range", consumedDirectiveAssayRow: "directive#assay[2]", failures: 0 },
  { assayId: "ASSAY-HERG-PATCH", domain: "Tissue toxicity (hERG)", measured: "IC50 12 µM", expected: "IC50 ≥10 µM", rangeStatus: "within-range", consumedDirectiveAssayRow: "directive#assay[3]", failures: 1 },
];

const jointOutputs: {
  domain: string; state: JointState; detail: string;
  inSilico?: string; exVivo?: string; tolerance?: string; falsifier?: string;
  repairPath?: { missingAssayIds: string[]; expectedRange: string; blocks: string[] };
}[] = [
  { domain: "CYP3A4 inhibition (IC50)", state: "agreed", detail: "In-silico and ex-vivo agree within tolerance.", inSilico: "4.1–7.2 µM", exVivo: "5.6 µM", tolerance: "log10 ±0.3" },
  { domain: "Off-target SRC selectivity", state: "disagreed-ex-vivo-wins", detail: "Ex-vivo measured 8× selectivity vs predicted ≥20×. In-silico value is falsified; joint output carries confidenceCaveat.", inSilico: "≥20× vs SRC", exVivo: "8× vs SRC", falsifier: "KIN-SEL-PROFILE" },
  { domain: "Clearance fractions", state: "partial", detail: "In-silico had no prediction (training gap). Ex-vivo emitted hepatocyte CL only. Renal/biliary fractions not measured.", inSilico: "—", exVivo: "hepatocyte CL only", repairPath: { missingAssayIds: ["ASSAY-RENAL-CL", "ASSAY-BILIARY-CL"], expectedRange: "fractional CL by route, sum to 1.0 ± 0.05", blocks: ["Phase1.specialPopArm.renalImpairment", "Phase1.indGate.absorptionDistributionMetabolism"] } },
  { domain: "Dose-response (BCR-ABL)", state: "agreed", detail: "In-silico Hill model and ex-vivo cell-based EC50 within tolerance.", inSilico: "EC50 24 nM", exVivo: "EC50 31 nM", tolerance: "fold ±2" },
];

// ── Tone helpers (match Phase1Planner palette) ──────────────────────────────

function pillToneFor(kind: string): string {
  switch (kind) {
    case "passed":
    case "agreed":
    case "high":
    case "complete":
    case "ready":
      return "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";
    case "passed-with-conditions":
    case "passed-with-override":
    case "overridden":
    case "moderate":
      return "bg-amber-500/15 border-amber-500/40 text-amber-300";
    case "partial":
    case "pending":
      return "bg-sky-500/15 border-sky-500/40 text-sky-300";
    case "running":
    case "active":
      return "bg-violet-500/15 border-violet-500/40 text-violet-300";
    case "blocked":
    case "failed":
    case "falsified":
    case "disagreed-ex-vivo-wins":
    case "low":
      return "bg-rose-500/15 border-rose-500/40 text-rose-300";
    case "no-prediction":
      return "bg-yellow-500/10 border-yellow-500/30 text-yellow-300";
    case "exempt":
    case "stub":
    case "queued":
      return "bg-white/5 border-white/15 text-slate-400";
    default:
      return "bg-white/5 border-white/15 text-slate-400";
  }
}

function Pill({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
        pillToneFor(kind)
      }
    >
      {children}
    </span>
  );
}

function SectionHeader({
  num,
  Icon,
  label,
  status,
  statusLabel,
  note,
}: {
  num: number;
  Icon: typeof Lock;
  label: string;
  status: PhaseStatus;
  statusLabel: string;
  note?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-6 h-6 rounded-md bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
        <Icon className="w-3.5 h-3.5 text-violet-300" />
      </div>
      <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-widest">
        Phase {num}
      </span>
      <span className="text-[12px] font-semibold text-slate-200">{label}</span>
      {note && <span className="text-[10px] text-slate-500 ml-1">· {note}</span>}
      <div className="ml-auto">
        <Pill kind={status}>{statusLabel}</Pill>
      </div>
    </div>
  );
}

// ── Layer stepper (mirrors HakaseClinical pattern, switches on click) ──────

function LayerStepper({
  active,
  onChange,
}: {
  active: LayerId;
  onChange: (id: LayerId) => void;
}) {
  return (
    <div className="flex items-center gap-1 mx-auto">
      {LAYERS.map((l, i) => {
        const Icon = l.icon;
        const isActive = active === l.id;
        const isComplete = l.state === "complete";
        const activeCls = "bg-violet-600/20 border-violet-500/50 text-violet-300";
        const numActiveCls = "border-violet-400 text-violet-400 bg-violet-400/10";
        return (
          <div key={l.id} className="flex items-center">
            <button
              onClick={() => onChange(l.id)}
              className={
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-200 border cursor-pointer " +
                (isActive
                  ? activeCls
                  : "text-slate-400 hover:bg-white/5 border-transparent")
              }
              title={l.oneLiner}
            >
              <div
                className={
                  "w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border " +
                  (isActive
                    ? numActiveCls
                    : isComplete
                    ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                    : "border-slate-600 text-slate-500")
                }
              >
                {l.n}
              </div>
              <Icon className="w-3.5 h-3.5" />
              {l.label}
              {isComplete && !isActive && (
                <CheckCircle2 className="w-3 h-3 text-emerald-400 -ml-0.5" />
              )}
              {l.state === "queued" && !isActive && (
                <span className="text-[8px] uppercase tracking-wider text-slate-600 ml-1">
                  queued
                </span>
              )}
            </button>
            {i < LAYERS.length - 1 && (
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 mx-0.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Layer panels ────────────────────────────────────────────────────────────

function L1InSilicoPanel() {
  return (
    <div className="max-w-[1180px] mx-auto px-6 py-6 space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex items-center gap-2">
          <Pill kind="complete">
            <CheckCircle2 className="w-3 h-3" /> emitted
          </Pill>
          <span className="text-[10px] font-mono text-slate-500">
            InVitroPackage v2.0.0 (upstream from hakase-ai)
          </span>
        </div>
        <h2 className="mt-2 text-[18px] font-semibold tracking-tight text-slate-100">
          Layer 1 — In-Silico
        </h2>
        <p className="mt-1 text-[12px] text-slate-400 max-w-2xl">
          ML predictions and structural priors generated upstream by hakase-ai
          and frozen as the L1 evidence pointer below. Read-only here — the L1
          surface lives in the hakase-ai artifact.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[9px] uppercase tracking-widest text-slate-500">
              ML feature vectors
            </div>
            <div className="mt-1 text-[14px] font-semibold text-slate-100">
              412 features
            </div>
            <div className="text-[10px] text-slate-500">ECFP4 + descriptors</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[9px] uppercase tracking-widest text-slate-500">
              Prediction domains
            </div>
            <div className="mt-1 text-[14px] font-semibold text-slate-100">
              4 emitted
            </div>
            <div className="text-[10px] text-slate-500">1 with no-prediction (training gap)</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[9px] uppercase tracking-widest text-slate-500">
              Frozen pointer
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-200 break-all">
              {l1Pointer.id}
            </div>
            <div className="text-[10px] text-slate-500">{l1Pointer.emittedAt}</div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-md border border-white/10 bg-[#0a0c12] p-3">
          <div className="text-[11px] text-slate-400">
            L1 evidence is consumed by Layer 2 — Confirmation. Nothing is
            mutated here; this layer is read-only in the clinical surface.
          </div>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600/20 border border-violet-500/40 px-3 py-1.5 text-[11px] font-semibold text-violet-200 hover:bg-violet-600/30"
          >
            Open hakase-ai <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function L2ConfirmationPanel() {
  return (
    <div className="max-w-[1180px] mx-auto px-6 py-6 space-y-6">
      {/* Hero — ConfirmationPackage outcome */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="grid grid-cols-[1fr_300px]">
          <div className="p-5">
            <div className="flex items-center gap-2">
              <Pill kind="passed-with-conditions">
                <Stamp className="w-3 h-3" /> passed with conditions
              </Pill>
              <span className="text-[10px] font-mono text-slate-500">
                ConfirmationPackage v2.0.0
              </span>
            </div>
            <h1 className="mt-2 text-[18px] font-semibold tracking-tight text-slate-100">
              Confirmation Layer (L2)
            </h1>
            <p className="mt-1 text-[12px] text-slate-400 leading-relaxed max-w-2xl">
              One typed package handed to L3 Animal Cohort. Internal in-silico
              and ex-vivo sub-tracks reconciled into 4 joint outputs. 1
              in-silico gate override applied. 1 falsifier triggered. 1
              partial joint output requires repair before IND.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[9px] uppercase tracking-widest text-slate-500">
                  Joint Outputs
                </div>
                <div className="mt-1 text-[18px] font-semibold text-slate-100">
                  2<span className="text-slate-500 text-[12px] font-normal"> / 4 agreed</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Pill kind="agreed">2 agreed</Pill>
                  <Pill kind="disagreed-ex-vivo-wins">1 ev wins</Pill>
                  <Pill kind="partial">1 partial</Pill>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[9px] uppercase tracking-widest text-slate-500">
                  Falsifiers Triggered
                </div>
                <div className="mt-1 text-[18px] font-semibold text-slate-100">1</div>
                <div className="mt-1 text-[10px] font-mono text-slate-400">KIN-SEL-PROFILE</div>
                <div className="text-[10px] text-slate-500">off-target domain</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[9px] uppercase tracking-widest text-slate-500">
                  Overrides
                </div>
                <div className="mt-1 text-[18px] font-semibold text-slate-100">1</div>
                <div className="mt-1 text-[10px] text-slate-400">in-silico gate</div>
                <div className="text-[10px] text-slate-500">M. Sato — Program Lead</div>
              </div>
            </div>
          </div>

          {/* Provenance side */}
          <div className="border-l border-white/8 bg-[#0a0c12] p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <Hash className="w-3 h-3 text-slate-500" />
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                L1 Evidence (frozen)
              </span>
            </div>
            <div className="text-[10px] font-mono text-slate-300 break-all">{l1Pointer.id}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">emitted {l1Pointer.emittedAt}</div>
            <div className="text-[10px] text-slate-500">by {l1Pointer.emitter}</div>

            <div className="mt-4 pt-4 border-t border-white/8">
              <div className="flex items-center gap-1.5 mb-2">
                <ShieldAlert className="w-3 h-3 text-slate-500" />
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                  Gate Policy
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-300">
                {gatePolicy.id}@{gatePolicy.version}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                falsifier reg · {gatePolicy.falsifierRegistry}
              </div>
              <div className="text-[10px] text-slate-500">
                exemption reg · {gatePolicy.exemptionRegistry}
              </div>
            </div>
          </div>
        </div>

        {/* 7-phase strip */}
        <div className="border-t border-white/8 bg-[#0a0c12] px-5 py-3">
          <div className="grid grid-cols-7 gap-2">
            {PHASES.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3 h-3 text-slate-500" />
                    <span className="font-mono text-[9px] text-slate-500 uppercase tracking-widest">
                      P{p.n}
                    </span>
                  </div>
                  <div className="text-[11px] font-medium text-slate-300 leading-tight">
                    {p.label}
                  </div>
                  <Pill kind={p.status}>
                    {p.status === "passed" && <CheckCircle2 className="w-2.5 h-2.5" />}
                    {p.status === "partial" && <AlertTriangle className="w-2.5 h-2.5" />}
                    {(p.status === "passed-with-override" ||
                      p.status === "passed-with-conditions") && (
                      <ShieldAlert className="w-2.5 h-2.5" />
                    )}
                    {p.status.replace(/-/g, " ")}
                  </Pill>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Phase 1 — Ingest & Lock */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <SectionHeader num={1} Icon={Lock} label="Ingest & Lock" status="passed" statusLabel="locked" note="every artifact below references the frozen L1 pointer" />
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Schema validated", value: "InVitroPackage v2.0.0" },
            { label: "ML feature vectors", value: "412 features · ECFP4 + descriptors" },
            { label: "Primary assay", value: "BCR-ABL kinase IC50 (n=3)" },
          ].map((c) => (
            <div key={c.label} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[9px] uppercase tracking-widest text-slate-500">{c.label}</div>
              <div className="mt-1 text-[12px] text-slate-200">{c.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Phase 2 — In-Silico predictions */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <SectionHeader num={2} Icon={Cpu} label="In-Silico Predictions (sub-track A)" status="partial" statusLabel="1 directive gap" note="emits PreConfirmationDirective for ex-vivo" />
        <div className="overflow-hidden rounded-md border border-white/10">
          <table className="w-full text-[12px]">
            <thead className="bg-white/[0.04]">
              <tr className="text-[9px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2 text-left font-semibold">Prediction domain</th>
                <th className="px-3 py-2 text-left font-semibold">Predicted</th>
                <th className="px-3 py-2 text-left font-semibold">Confidence</th>
                <th className="px-3 py-2 text-left font-semibold">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {inSilicoPredictions.map((p, i) => (
                <tr key={p.domain} className={i > 0 ? "border-t border-white/8" : ""}>
                  <td className="px-3 py-2 text-slate-200">{p.domain}</td>
                  <td className="px-3 py-2 text-slate-400 font-mono text-[11px]">{p.prediction}</td>
                  <td className="px-3 py-2"><Pill kind={p.confidence}>{p.confidence}</Pill></td>
                  <td className="px-3 py-2">
                    {p.confidence === "no-prediction" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-yellow-400">
                        <AlertTriangle className="w-3 h-3" /> directive gap (training)
                      </span>
                    ) : p.thresholdMet ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" /> met
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                        <ShieldAlert className="w-3 h-3" /> below — falsifier path required
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phase 3 — In-Silico Gate */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <SectionHeader num={3} Icon={ShieldAlert} label="In-Silico Gate (budget gate)" status="passed-with-override" statusLabel="passed with override" note={`under ${gatePolicy.id}@${gatePolicy.version}`} />
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-amber-200">
            <ShieldAlert className="w-3.5 h-3.5" />
            Override — authority chain & evidence citation
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-slate-500">Actor</div>
              <div className="text-[12px] text-slate-200 mt-0.5">{override.authority.actor}</div>
              <div className="text-[10px] text-slate-500">{override.authority.role}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-slate-500">Authority citation</div>
              <div className="text-[11px] font-mono text-slate-300 mt-0.5 break-all">
                {override.authority.policy.registry}/{override.authority.policy.id}@{override.authority.policy.version}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-[9px] uppercase tracking-widest text-slate-500">Reason</div>
              <div className="text-[12px] text-slate-300 mt-0.5">{override.reason}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-slate-500">Falsifier accepted</div>
              <div className="text-[11px] font-mono text-slate-300 mt-0.5 break-all">
                {override.falsifierAccepted.registryId}/{override.falsifierAccepted.falsifierId}@{override.falsifierAccepted.registryVersion}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-slate-500">L1 evidence cited</div>
              <div className="text-[11px] font-mono text-slate-300 mt-0.5 break-all">{override.l1EvidenceCited.pointer}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {override.l1EvidenceCited.fields.map((f) => (
                  <span key={f} className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-amber-500/20 text-[10px] text-slate-500 flex items-center gap-1.5">
            <Stamp className="w-3 h-3" /> applied {override.appliedAt} · propagated to L4 Phase 1 (MABEL-bias evaluation)
          </div>
        </div>
      </section>

      {/* Phase 4 — Ex-Vivo runs */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <SectionHeader num={4} Icon={Microscope} label="Ex-Vivo Runs (sub-track B)" status="passed-with-conditions" statusLabel="directive-driven · 1 retry" note="rows without directive linkage are rejected at write-time" />
        <div className="overflow-hidden rounded-md border border-white/10">
          <table className="w-full text-[12px]">
            <thead className="bg-white/[0.04]">
              <tr className="text-[9px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2 text-left font-semibold">Assay</th>
                <th className="px-3 py-2 text-left font-semibold">Domain</th>
                <th className="px-3 py-2 text-left font-semibold">Measured</th>
                <th className="px-3 py-2 text-left font-semibold">Expected</th>
                <th className="px-3 py-2 text-left font-semibold">Range</th>
                <th className="px-3 py-2 text-left font-semibold">Directive ref</th>
              </tr>
            </thead>
            <tbody>
              {exVivoRuns.map((r, i) => (
                <tr key={r.assayId} className={"align-top " + (i > 0 ? "border-t border-white/8" : "")}>
                  <td className="px-3 py-2">
                    <div className="font-mono text-[10px] text-slate-300">{r.assayId}</div>
                    {r.failures > 0 && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-400">
                        <RotateCcw className="w-3 h-3" /> {r.failures} retry recorded
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{r.domain}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-200">{r.measured}</td>
                  <td className="px-3 py-2 text-slate-500">{r.expected}</td>
                  <td className="px-3 py-2">
                    {r.rangeStatus === "within-range" ? (
                      <Pill kind="agreed"><CheckCircle2 className="w-2.5 h-2.5" /> within</Pill>
                    ) : r.rangeStatus === "below-range" ? (
                      <Pill kind="falsified"><XCircle className="w-2.5 h-2.5" /> below</Pill>
                    ) : (
                      <Pill kind="passed-with-conditions"><AlertTriangle className="w-2.5 h-2.5" /> above</Pill>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{r.consumedDirectiveAssayRow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phase 5 — Falsifier check */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <SectionHeader num={5} Icon={AlertTriangle} label="Falsifier Check" status="passed-with-conditions" statusLabel="1 falsifier triggered" note='"falsified" is a typed state, distinct from "low confidence"' />
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-rose-200">
              <XCircle className="w-3.5 h-3.5" />
              Off-target kinome — FALSIFIED
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              Directive-flagged falsifier <span className="font-mono text-slate-300">KIN-SEL-PROFILE</span> triggered.
              SRC selectivity ratio observed 8× vs predicted ≥20×.
            </div>
            <div className="mt-3 text-[10px] text-rose-300">
              Downstream: in-silico off-target value is <strong>not</strong> averaged with ex-vivo into joint output.
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              CYP-Transporter, dose-response, hERG
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              No directive-flagged falsifier triggered. Joint synthesis proceeds normally for these domains.
            </div>
          </div>
        </div>
      </section>

      {/* Phase 6 — Joint outputs */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <SectionHeader num={6} Icon={GitMerge} label="Joint Output Synthesis" status="partial" statusLabel="2 of 4 agreed" note="each domain emits exactly one typed JointOutputState — no silent fallbacks" />
        <div className="space-y-3">
          {jointOutputs.map((j) => {
            const tone =
              j.state === "agreed"
                ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                : j.state === "disagreed-ex-vivo-wins"
                ? "border-rose-500/30 bg-rose-500/[0.04]"
                : j.state === "partial"
                ? "border-sky-500/30 bg-sky-500/[0.04]"
                : "border-white/10 bg-white/[0.02]";
            return (
              <div key={j.domain} className={"rounded-md border p-4 " + tone}>
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-semibold text-slate-100">{j.domain}</div>
                  <Pill kind={j.state}>
                    {j.state === "agreed" && <CheckCircle2 className="w-2.5 h-2.5" />}
                    {j.state === "disagreed-ex-vivo-wins" && <XCircle className="w-2.5 h-2.5" />}
                    {j.state === "partial" && <Wrench className="w-2.5 h-2.5" />}
                    {j.state.replace(/-/g, " ")}
                  </Pill>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{j.detail}</p>

                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">In-silico</div>
                    <div
                      className={
                        "mt-0.5 font-mono text-[11px] " +
                        (j.state === "disagreed-ex-vivo-wins"
                          ? "text-rose-300 line-through decoration-2"
                          : "text-slate-300")
                      }
                    >
                      {j.inSilico}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">Ex-vivo</div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-300">{j.exVivo}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-slate-500">
                      {j.tolerance ? "Tolerance" : j.falsifier ? "Falsifier" : "Repair path"}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-300">
                      {j.tolerance ?? j.falsifier ?? (j.repairPath ? "see below" : "—")}
                    </div>
                  </div>
                </div>

                {j.repairPath && (
                  <div className="mt-3 rounded border border-sky-500/30 bg-[#0a0c12] p-3">
                    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-sky-300">
                      <Wrench className="w-3 h-3" /> Repair path
                    </div>
                    <div className="mt-2 grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5 text-[11px]">
                      <div className="text-slate-500">missing assays</div>
                      <div className="flex flex-wrap gap-1 font-mono">
                        {j.repairPath.missingAssayIds.map((a) => (
                          <span key={a} className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">{a}</span>
                        ))}
                      </div>
                      <div className="text-slate-500">expected range</div>
                      <div className="text-slate-300">{j.repairPath.expectedRange}</div>
                      <div className="text-slate-500">blocks downstream</div>
                      <div className="flex flex-wrap gap-1">
                        {j.repairPath.blocks.map((b) => (
                          <span key={b} className="rounded bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">{b}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Phase 7 — Exit gate */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <SectionHeader num={7} Icon={DoorOpen} label="Exit Gate → L3 Animal Cohort" status="passed-with-conditions" statusLabel="passed with conditions" note="embedded gatePolicy snapshot makes the package portable across partners" />
        <div className="rounded-md border border-white/10 bg-white/[0.03] p-4">
          <div className="grid grid-cols-[1fr_auto] items-start gap-6">
            <div>
              <div className="text-[12px] text-slate-300">
                This ConfirmationPackage may proceed to L3 Animal Cohort design with two conditions:
              </div>
              <ol className="mt-2 list-decimal pl-5 text-[11px] text-slate-400 space-y-1">
                <li>L3 must reference falsifier <span className="font-mono text-slate-200">KIN-SEL-PROFILE</span> in cardiac-safety arm scoping (off-target falsified).</li>
                <li>Repair path on Clearance fractions must be closed (renal &amp; biliary CL measured) before L4 IND-gate can read <span className="font-mono text-slate-200">Phase1.specialPopArm.renalImpairment</span>.</li>
              </ol>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1"><FileJson className="w-3 h-3" /> JSON</span>
                <span>·</span><span>per-track evidence blocks attached</span>
                <span>·</span><span>L1 pointer carried verbatim</span>
                <span>·</span><span>gatePolicy@{gatePolicy.version} embedded</span>
              </div>
            </div>
            <button
              disabled
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600/30 border border-violet-500/40 px-4 py-2 text-[12px] font-semibold text-violet-200 hover:bg-violet-600/40 disabled:opacity-60"
            >
              Hand off to L3 <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function L3AnimalCohortPanel() {
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-4 p-8">
      <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
        <Microscope className="w-7 h-7 text-slate-500" />
      </div>
      <div className="text-center max-w-md">
        <div className="text-[14px] font-medium text-slate-300">
          Layer 3 — Animal Cohort
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          Cohort design · GLP toxicology · NOAEL · species selection
        </p>
        <div className="mt-6 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-6 text-[11px] text-slate-500 leading-snug">
          Animal Cohort planner not yet wired. Will consume ConfirmationPackage
          (L2) and emit AnimalCohortPackage to L4 — including species selection
          rationale, NOAEL, and propagated falsifier conditions from L2.
        </div>
      </div>
    </div>
  );
}

function L4FihHandoverPanel() {
  // Inputs received from L3 (mocked — derived from L2 fixture for visual continuity)
  const handover = {
    receivedAt: "2026-04-29T15:42:11Z",
    confirmationPkg: { id: "ConfirmationPackage v2.0.0", outcome: "passed-with-conditions" as const },
    animalCohortPkg: { id: "AnimalCohortPackage v1.1.0", noaelMgPerKg: 30, species: "Sprague-Dawley rat" },
    propagatedConditions: [
      "L3 referenced falsifier KIN-SEL-PROFILE in cardiac-safety scoping",
      "Renal/biliary CL repair path still OPEN — Phase 1 specialPopArm.renalImpairment is GATED",
    ],
  };
  const fihDerivations: { label: string; value: string; status: "ready" | "pending" | "blocked"; note?: string }[] = [
    { label: "MABEL starting dose", value: "0.5 mg/kg", status: "ready", note: "min(NOAEL/safety factor 10, MABEL@10% RO)" },
    { label: "Escalation scheme", value: "Modified Fibonacci (3+3, 5 cohorts)", status: "ready" },
    { label: "DDI module", value: "CYP3A4 inhibitor co-admin scenarios scoped", status: "ready", note: "from L2 joint output (agreed)" },
    { label: "Renal impairment arm", value: "BLOCKED — repair path open", status: "blocked", note: "L2.jointOutputs.clearance.repairPath" },
    { label: "Cardiac safety arm", value: "Required — KIN-SEL-PROFILE falsifier propagated", status: "pending", note: "scope ECG monitoring" },
  ];

  return (
    <div className="max-w-[1180px] mx-auto px-6 py-6 space-y-6">
      {/* Hero */}
      <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        <div className="grid grid-cols-[1fr_300px]">
          <div className="p-5">
            <div className="flex items-center gap-2">
              <Pill kind="passed-with-conditions">
                <Stamp className="w-3 h-3" /> handover received with conditions
              </Pill>
              <span className="text-[10px] font-mono text-slate-500">FihHandoverPackage v1.0.0</span>
            </div>
            <h1 className="mt-2 text-[18px] font-semibold tracking-tight text-slate-100">
              Layer 4 — FIH Handover
            </h1>
            <p className="mt-1 text-[12px] text-slate-400 max-w-2xl">
              The Phase 1 sponsor receives ConfirmationPackage (L2) +
              AnimalCohortPackage (L3) here. Derivations below seed Phase 1
              design fields. Open repair paths and propagated falsifiers gate
              the IND submission.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[9px] uppercase tracking-widest text-slate-500">Inputs received</div>
                <div className="mt-1 text-[18px] font-semibold text-slate-100">2 / 2</div>
                <div className="mt-1 text-[10px] text-slate-400">L2 ConfirmationPackage</div>
                <div className="text-[10px] text-slate-400">L3 AnimalCohortPackage</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[9px] uppercase tracking-widest text-slate-500">FIH derivations</div>
                <div className="mt-1 text-[18px] font-semibold text-slate-100">
                  3<span className="text-slate-500 text-[12px] font-normal"> / 5 ready</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Pill kind="ready">3 ready</Pill>
                  <Pill kind="pending">1 pending</Pill>
                  <Pill kind="blocked">1 blocked</Pill>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[9px] uppercase tracking-widest text-slate-500">IND-gate status</div>
                <div className="mt-1 text-[18px] font-semibold text-rose-300">Not ready</div>
                <div className="mt-1 text-[10px] text-slate-500">1 blocked derivation must clear</div>
              </div>
            </div>
          </div>

          {/* Provenance side */}
          <div className="border-l border-white/8 bg-[#0a0c12] p-5">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock className="w-3 h-3 text-slate-500" />
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                Handover received
              </span>
            </div>
            <div className="text-[11px] text-slate-300">{handover.receivedAt}</div>

            <div className="mt-4 pt-4 border-t border-white/8">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
                Upstream packages
              </div>
              <div className="text-[10px] font-mono text-slate-300">{handover.confirmationPkg.id}</div>
              <div className="text-[10px] text-slate-500 mb-2">
                outcome · <span className="text-amber-300">{handover.confirmationPkg.outcome}</span>
              </div>
              <div className="text-[10px] font-mono text-slate-300">{handover.animalCohortPkg.id}</div>
              <div className="text-[10px] text-slate-500">
                NOAEL {handover.animalCohortPkg.noaelMgPerKg} mg/kg · {handover.animalCohortPkg.species}
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-white/8">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
                Compound
              </div>
              <div className="text-[12px] font-semibold text-slate-100">{compound.inn}</div>
              <div className="text-[10px] text-slate-500">{compound.indication}</div>
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">{compound.programId}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Propagated conditions */}
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-4 h-4 text-amber-300" />
          <span className="text-[11px] font-semibold text-amber-200 uppercase tracking-widest">
            Propagated conditions from upstream
          </span>
        </div>
        <ul className="space-y-2">
          {handover.propagatedConditions.map((c) => (
            <li key={c} className="flex items-start gap-2 text-[11px] text-slate-300">
              <ChevronRight className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* FIH derivations */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-6 h-6 rounded-md bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
            <Syringe className="w-3.5 h-3.5 text-violet-300" />
          </div>
          <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-widest">
            FIH derivations
          </span>
          <span className="text-[12px] font-semibold text-slate-200">Phase 1 seeds</span>
          <span className="text-[10px] text-slate-500 ml-1">
            · auto-derived from L2 + L3, editable in Phase 1 planner downstream
          </span>
        </div>
        <div className="overflow-hidden rounded-md border border-white/10">
          <table className="w-full text-[12px]">
            <thead className="bg-white/[0.04]">
              <tr className="text-[9px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2 text-left font-semibold">Field</th>
                <th className="px-3 py-2 text-left font-semibold">Derived value</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Source / note</th>
              </tr>
            </thead>
            <tbody>
              {fihDerivations.map((d, i) => (
                <tr key={d.label} className={i > 0 ? "border-t border-white/8" : ""}>
                  <td className="px-3 py-2 text-slate-200">{d.label}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-300">{d.value}</td>
                  <td className="px-3 py-2">
                    <Pill kind={d.status}>
                      {d.status === "ready" && <CheckCircle2 className="w-2.5 h-2.5" />}
                      {d.status === "pending" && <AlertTriangle className="w-2.5 h-2.5" />}
                      {d.status === "blocked" && <XCircle className="w-2.5 h-2.5" />}
                      {d.status}
                    </Pill>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-slate-500">{d.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* IND gate + open Phase 1 planner */}
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-6 h-6 rounded-md bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
            <DoorOpen className="w-3.5 h-3.5 text-violet-300" />
          </div>
          <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-widest">
            IND gate
          </span>
          <span className="text-[12px] font-semibold text-slate-200">Submission readiness</span>
          <div className="ml-auto"><Pill kind="blocked">not ready</Pill></div>
        </div>
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4">
          <div className="text-[12px] text-slate-300">
            IND submission gated until 1 blocking derivation clears:
          </div>
          <ol className="mt-2 list-decimal pl-5 text-[11px] text-slate-400 space-y-1">
            <li>
              Reopen L2 Phase 4 ex-vivo and run{" "}
              <span className="font-mono text-slate-200">ASSAY-RENAL-CL</span> +{" "}
              <span className="font-mono text-slate-200">ASSAY-BILIARY-CL</span>{" "}
              to close the Clearance repair path. Without these the renal-impairment arm cannot be designed.
            </li>
          </ol>
          <div className="mt-3 flex items-center gap-2">
            <button className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600/20 border border-violet-500/40 px-3 py-1.5 text-[11px] font-semibold text-violet-200 hover:bg-violet-600/30">
              <ArrowRight className="w-3 h-3 rotate-180" /> Send back to L2
            </button>
            <button
              disabled
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600/30 border border-violet-500/40 px-3 py-1.5 text-[11px] font-semibold text-violet-200 hover:bg-violet-600/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Open Phase 1 Planner <ExternalLink className="w-3 h-3" />
            </button>
            <span className="text-[10px] text-slate-500 ml-1">
              (Planner re-design pending — will replace existing Phase1Planner)
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Top-level shell ─────────────────────────────────────────────────────────

export function ConfirmationLayer() {
  const [activeLayer, setActiveLayer] = useState<LayerId>("L2");
  return (
    <div className="min-h-screen w-full flex flex-col bg-[#07080c] text-slate-200 font-sans">
      {/* Header — same shape as HakaseClinical */}
      <header className="h-14 border-b border-white/8 bg-[#0d0f17]/90 backdrop-blur-md flex items-center px-4 gap-4 shrink-0 z-50">
        <div className="flex items-center gap-2 min-w-[220px]">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
            <FlaskConical className="w-4 h-4 text-violet-400" />
            hakase<span className="text-violet-400">AI</span>
          </div>
          <span className="text-[9px] px-1.5 py-0 border border-violet-500/40 text-violet-400 rounded">
            Pipeline · v2.0
          </span>
        </div>

        <LayerStepper active={activeLayer} onChange={setActiveLayer} />

        <div className="flex items-center gap-2 min-w-[200px] justify-end">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 transition-colors text-[11px] font-semibold"
            title="Export the active layer's package as JSON"
          >
            <FileJson className="w-3.5 h-3.5" /> Export Package
          </button>
          <button className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors">
            <Moon className="w-4 h-4" />
          </button>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-[11px] font-bold text-white">
            HC
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 overflow-auto flex flex-col">
        {activeLayer === "L1" && <L1InSilicoPanel />}
        {activeLayer === "L2" && <L2ConfirmationPanel />}
        {activeLayer === "L3" && <L3AnimalCohortPanel />}
        {activeLayer === "L4" && <L4FihHandoverPanel />}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/8 bg-[#0a0c12] shrink-0">
        <div className="px-6 py-2 text-[10px] text-slate-600 truncate">
          Open-source pipeline · no commercial gating · Hakase v2.0.0 ·
          mockup fixture (Imatinib partial · L1 → L4)
        </div>
      </footer>
    </div>
  );
}
