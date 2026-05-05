import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Lock,
  FlaskConical,
  Cpu,
  Microscope,
  GitMerge,
  DoorOpen,
  ChevronRight,
  FileText,
  RotateCcw,
  Ban,
  Wrench,
  ExternalLink,
  Hash,
  Stamp,
} from "lucide-react";

type GateOutcome = "passed" | "failed" | "overridden" | "passed-with-conditions";
type DomainConfidence = "high" | "moderate" | "low" | "no-prediction";

const compound = {
  inn: "Imatinib",
  cas: "152459-95-5",
  class: "Small molecule (BCR-ABL TKI)",
  programId: "PROG-IMA-2026-04",
};

const l1Pointer = {
  id: "sha256:9f4c…a1b2",
  emittedAt: "2026-04-28T14:21:08Z",
  emitter: "hakase-ai/in-silico v1.7.3",
};

const gatePolicy = {
  id: "confirmation-gate-policy",
  version: "1.4.2",
  thresholds: [
    { domain: "cyp-transporter", min: "moderate" },
    { domain: "clearance-fractions", min: "moderate" },
    { domain: "off-target", min: "high" },
    { domain: "dose-response", min: "moderate" },
  ],
  falsifierRegistry: "hakase-clinical/falsifiers v3.0.0",
  exemptionRegistry: "hakase-clinical/exemptions v1.2.0",
};

const phases: Array<{
  n: number;
  key: string;
  label: string;
  icon: typeof Lock;
  status: "passed" | "passed-with-override" | "passed-with-conditions" | "partial" | "running" | "blocked";
  note: string;
}> = [
  { n: 1, key: "ingest", label: "Ingest & Lock", icon: Lock, status: "passed", note: "L1 evidence pointer frozen" },
  { n: 2, key: "insilico", label: "In-Silico Predictions", icon: Cpu, status: "partial", note: "1 directive gap (clearance)" },
  { n: 3, key: "isgate", label: "In-Silico Gate", icon: ShieldAlert, status: "passed-with-override", note: "off-target falsifier accepted" },
  { n: 4, key: "exvivo", label: "Ex-Vivo Runs", icon: Microscope, status: "passed-with-conditions", note: "1 retry (hERG technical)" },
  { n: 5, key: "falsifier", label: "Falsifier Check", icon: AlertTriangle, status: "passed-with-conditions", note: "1 falsifier triggered (off-target)" },
  { n: 6, key: "joint", label: "Joint Synthesis", icon: GitMerge, status: "partial", note: "2 of 4 domains require attention" },
  { n: 7, key: "exit", label: "Exit Gate → L3", icon: DoorOpen, status: "passed-with-conditions", note: "passed under policy v1.4.2" },
];

const inSilicoPredictions: Array<{
  domain: string;
  prediction: string;
  confidence: DomainConfidence;
  thresholdMet: boolean;
}> = [
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
  falsifierAccepted: {
    registryId: "hakase-clinical/falsifiers",
    falsifierId: "KIN-SEL-PROFILE",
    registryVersion: "3.0.0",
  },
  l1EvidenceCited: {
    pointer: l1Pointer.id,
    fields: ["mlPriors.offTarget.kinomeProfile", "mlPriors.offTarget.srcSelectivity"],
  },
  appliedAt: "2026-04-29T09:14:02Z",
};

const exVivoRuns: Array<{
  assayId: string;
  domain: string;
  measured: string;
  expected: string;
  rangeStatus: "within-range" | "above-range" | "below-range";
  consumedDirectiveAssayRow: string;
  failures: number;
}> = [
  {
    assayId: "ASSAY-CYP3A4-IC50",
    domain: "CYP-Transporter",
    measured: "5.6 µM",
    expected: "4.1–7.2 µM",
    rangeStatus: "within-range",
    consumedDirectiveAssayRow: "directive#assay[0]",
    failures: 0,
  },
  {
    assayId: "ASSAY-HEPATOCYTE-CL",
    domain: "Clearance fractions (broadened)",
    measured: "12.4 µL/min/Mcells",
    expected: "broadened panel — directive gap",
    rangeStatus: "within-range",
    consumedDirectiveAssayRow: "directive#gap[clearance].broadenedAssays[0]",
    failures: 0,
  },
  {
    assayId: "ASSAY-KINOME-PROFILE",
    domain: "Off-target",
    measured: "SRC IC50 0.18 µM (8× vs ABL)",
    expected: "≥20× selective vs SRC",
    rangeStatus: "below-range",
    consumedDirectiveAssayRow: "directive#assay[2]",
    failures: 0,
  },
  {
    assayId: "ASSAY-HERG-PATCH",
    domain: "Tissue toxicity (hERG)",
    measured: "IC50 12 µM",
    expected: "IC50 ≥10 µM (safety margin)",
    rangeStatus: "within-range",
    consumedDirectiveAssayRow: "directive#assay[3]",
    failures: 1,
  },
];

const jointOutputs: Array<{
  domain: string;
  state: "agreed" | "disagreed-ex-vivo-wins" | "partial" | "falsified" | "exempt";
  detail: string;
  tolerance?: string;
  inSilico?: string;
  exVivo?: string;
  falsifier?: string;
  repairPath?: { missingAssayIds: string[]; expectedRange: string; blocks: string[] };
}> = [
  {
    domain: "CYP3A4 inhibition (IC50)",
    state: "agreed",
    detail: "In-silico and ex-vivo agree within tolerance.",
    inSilico: "4.1–7.2 µM",
    exVivo: "5.6 µM",
    tolerance: "log10 ±0.3",
  },
  {
    domain: "Off-target SRC selectivity",
    state: "disagreed-ex-vivo-wins",
    detail:
      "Ex-vivo measured 8× selectivity vs predicted ≥20×. In-silico prediction marked falsified; joint output carries confidenceCaveat.",
    inSilico: "≥20× vs SRC",
    exVivo: "8× vs SRC",
    falsifier: "KIN-SEL-PROFILE",
  },
  {
    domain: "Clearance fractions",
    state: "partial",
    detail:
      "In-silico had no prediction (training gap). Ex-vivo broadened panel emitted hepatocyte clearance only. Renal/biliary fractions not measured.",
    inSilico: "—",
    exVivo: "hepatocyte CL only",
    repairPath: {
      missingAssayIds: ["ASSAY-RENAL-CL", "ASSAY-BILIARY-CL"],
      expectedRange: "fractional CL by route, sum to 1.0 ± 0.05",
      blocks: ["Phase1.specialPopArm.renalImpairment", "Phase1.indGate.absorptionDistributionMetabolism"],
    },
  },
  {
    domain: "Dose-response (BCR-ABL)",
    state: "agreed",
    detail: "In-silico Hill model and ex-vivo cell-based EC50 within tolerance.",
    inSilico: "EC50 24 nM",
    exVivo: "EC50 31 nM",
    tolerance: "fold ±2",
  },
];

// ─────────────────────────────────────────────────────────────────────────────

function StatusPill({ kind, children }: { kind: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    passed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
    "passed-with-conditions": "bg-amber-500/10 text-amber-800 dark:text-amber-200 ring-amber-500/30",
    "passed-with-override": "bg-amber-500/10 text-amber-800 dark:text-amber-200 ring-amber-500/30",
    failed: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
    overridden: "bg-amber-500/10 text-amber-800 dark:text-amber-200 ring-amber-500/30",
    partial: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/30",
    running: "bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/30",
    blocked: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
    falsified: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30 line-through decoration-2",
    agreed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
    "disagreed-ex-vivo-wins": "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
    exempt: "bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/30",
    "no-prediction": "bg-yellow-500/10 text-yellow-800 dark:text-yellow-200 ring-yellow-500/30",
    high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
    moderate: "bg-amber-500/10 text-amber-800 dark:text-amber-200 ring-amber-500/30",
    low: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/30",
  };
  const cls = map[kind] ?? "bg-slate-500/10 text-slate-700 ring-slate-500/30";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}
    >
      {children}
    </span>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] text-muted-foreground">{children}</span>
  );
}

function SectionTitle({
  num,
  Icon,
  title,
  status,
  statusLabel,
  note,
}: {
  num: number;
  Icon: typeof Lock;
  title: string;
  status: string;
  statusLabel: string;
  note?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-muted-foreground">PHASE {num}</span>
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
          </div>
          {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        </div>
      </div>
      <StatusPill kind={status}>{statusLabel}</StatusPill>
    </div>
  );
}

function LayerRail() {
  const layers = [
    { n: 1, name: "In-Silico", state: "complete" },
    { n: 2, name: "Confirmation", state: "active" },
    { n: 3, name: "Animal Cohort", state: "queued" },
    { n: 4, name: "FIH (Phase 1)", state: "queued" },
  ];
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card/40 p-1">
      {layers.map((l, i) => (
        <div key={l.n} className="flex items-center">
          <div
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${
              l.state === "active"
                ? "bg-foreground text-background"
                : l.state === "complete"
                ? "text-foreground"
                : "text-muted-foreground"
            }`}
          >
            <span className="font-mono opacity-60">L{l.n}</span>
            <span>{l.name}</span>
            {l.state === "complete" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
          </div>
          {i < layers.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function ConfirmationLayer() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <div className="mx-auto max-w-[1200px] px-8 py-8">
        {/* Top bar: layer rail + identity */}
        <div className="flex items-center justify-between gap-6">
          <LayerRail />
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Compound</div>
            <div className="flex items-center justify-end gap-2 text-sm font-semibold">
              {compound.inn}
              <Mono>· CAS {compound.cas}</Mono>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {compound.class} · <Mono>{compound.programId}</Mono>
            </div>
          </div>
        </div>

        {/* Hero: ConfirmationPackage outcome */}
        <div className="mt-6 overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-background to-background">
          <div className="grid grid-cols-[1fr_320px]">
            <div className="p-6">
              <div className="flex items-center gap-2">
                <StatusPill kind="passed-with-conditions">
                  <Stamp className="h-3 w-3" />
                  Confirmation passed with conditions
                </StatusPill>
                <Mono>ConfirmationPackage v2.0.0</Mono>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight">
                Confirmation Layer (L2)
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                One typed package handed to L3 Animal Cohort. Internal in-silico and ex-vivo
                sub-tracks reconciled into 4 joint outputs. 1 in-silico gate override applied.
                1 falsifier triggered. 1 partial joint output requires repair before IND.
              </p>

              <div className="mt-5 grid grid-cols-3 gap-4">
                <div className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Joint outputs
                  </div>
                  <div className="mt-1 text-lg font-semibold">
                    2<span className="text-muted-foreground">/4 agreed</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <StatusPill kind="agreed">2 agreed</StatusPill>
                    <StatusPill kind="disagreed-ex-vivo-wins">1 ex-vivo wins</StatusPill>
                    <StatusPill kind="partial">1 partial</StatusPill>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Falsifiers triggered
                  </div>
                  <div className="mt-1 text-lg font-semibold">1</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    KIN-SEL-PROFILE (off-target)
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Overrides
                  </div>
                  <div className="mt-1 text-lg font-semibold">1</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    in-silico gate · M. Sato
                  </div>
                </div>
              </div>
            </div>

            {/* Provenance side card */}
            <div className="border-l border-border bg-muted/30 p-6">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Frozen L1 evidence pointer
              </div>
              <div className="mt-1 flex items-center gap-1 font-mono text-xs">
                <Hash className="h-3 w-3" />
                {l1Pointer.id}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                emitted {l1Pointer.emittedAt}
                <br />
                by {l1Pointer.emitter}
              </div>
              <div className="mt-4 text-[11px] uppercase tracking-wide text-muted-foreground">
                Gate policy snapshot
              </div>
              <div className="mt-1 font-mono text-xs">
                {gatePolicy.id}@{gatePolicy.version}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                falsifier registry {gatePolicy.falsifierRegistry}
                <br />
                exemption registry {gatePolicy.exemptionRegistry}
              </div>
            </div>
          </div>

          {/* Phase stepper */}
          <div className="border-t border-border bg-card/30 px-6 py-3">
            <div className="grid grid-cols-7 gap-2">
              {phases.map((p) => {
                const Icon = p.icon;
                return (
                  <div key={p.key} className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        P{p.n}
                      </span>
                    </div>
                    <div className="text-[11px] font-medium leading-tight">{p.label}</div>
                    <StatusPill kind={p.status}>
                      {p.status === "passed" && <CheckCircle2 className="h-3 w-3" />}
                      {p.status === "partial" && <AlertTriangle className="h-3 w-3" />}
                      {(p.status === "passed-with-override" ||
                        p.status === "passed-with-conditions") && (
                        <ShieldAlert className="h-3 w-3" />
                      )}
                      {p.status.replace(/-/g, " ")}
                    </StatusPill>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Phase 1 — Ingest & Lock */}
        <section className="mt-8">
          <SectionTitle
            num={1}
            Icon={Lock}
            title="Ingest & Lock"
            status="passed"
            statusLabel="locked"
            note="Every artifact below references the frozen L1 evidence pointer."
          />
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Schema validated", value: "InVitroPackage v2.0.0" },
              { label: "ML feature vectors", value: "412 features · ECFP4 + descriptors" },
              { label: "Primary assay results", value: "BCR-ABL kinase IC50 (n=3)" },
            ].map((c) => (
              <div key={c.label} className="rounded-md border border-border bg-card/40 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </div>
                <div className="mt-1 text-sm">{c.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Phase 2 — In-Silico predictions */}
        <section className="mt-8">
          <SectionTitle
            num={2}
            Icon={Cpu}
            title="In-Silico Predictions (sub-track A)"
            status="partial"
            statusLabel="1 directive gap"
            note="Per-domain confidence vector. Emits PreConfirmationDirective for ex-vivo sub-track."
          />
          <div className="mt-4 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Prediction domain</th>
                  <th className="px-3 py-2 text-left font-medium">Predicted</th>
                  <th className="px-3 py-2 text-left font-medium">Confidence</th>
                  <th className="px-3 py-2 text-left font-medium">Threshold</th>
                </tr>
              </thead>
              <tbody>
                {inSilicoPredictions.map((p) => (
                  <tr key={p.domain} className="border-t border-border">
                    <td className="px-3 py-2">{p.domain}</td>
                    <td className="px-3 py-2 text-muted-foreground">{p.prediction}</td>
                    <td className="px-3 py-2">
                      <StatusPill kind={p.confidence}>{p.confidence}</StatusPill>
                    </td>
                    <td className="px-3 py-2">
                      {p.confidence === "no-prediction" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-300">
                          <AlertTriangle className="h-3 w-3" />
                          directive gap (training)
                        </span>
                      ) : p.thresholdMet ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          met
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                          <ShieldAlert className="h-3 w-3" />
                          below — falsifier path required
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
        <section className="mt-8">
          <SectionTitle
            num={3}
            Icon={ShieldAlert}
            title="In-Silico Gate (budget gate)"
            status="passed-with-override"
            statusLabel="passed with override"
            note={`Evaluated under ${gatePolicy.id}@${gatePolicy.version}.`}
          />
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
              <ShieldAlert className="h-4 w-4" />
              Gate override — authority chain & evidence citation
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Actor
                </div>
                <div className="mt-0.5">{override.authority.actor}</div>
                <div className="text-[11px] text-muted-foreground">
                  {override.authority.role}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Authority citation
                </div>
                <div className="mt-0.5 font-mono text-[12px]">
                  {override.authority.policy.registry}/{override.authority.policy.id}@
                  {override.authority.policy.version}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Reason
                </div>
                <div className="mt-0.5 text-sm">{override.reason}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Falsifier accepted
                </div>
                <div className="mt-0.5 font-mono text-[12px]">
                  {override.falsifierAccepted.registryId}/{override.falsifierAccepted.falsifierId}@
                  {override.falsifierAccepted.registryVersion}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  L1 evidence cited
                </div>
                <div className="mt-0.5 font-mono text-[12px]">{override.l1EvidenceCited.pointer}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {override.l1EvidenceCited.fields.map((f) => (
                    <span
                      key={f}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-amber-500/20 pt-3 text-[11px] text-muted-foreground">
              <Stamp className="h-3 w-3" />
              applied {override.appliedAt} · this override is propagated to L4 Phase 1 Planner for
              MABEL-bias evaluation
            </div>
          </div>
        </section>

        {/* Phase 4 — Ex-Vivo runs */}
        <section className="mt-8">
          <SectionTitle
            num={4}
            Icon={Microscope}
            title="Ex-Vivo Runs (sub-track B)"
            status="passed-with-conditions"
            statusLabel="directive-driven · 1 retry"
            note="Each row references a directive entry. Runs without directive linkage are rejected at write-time."
          />
          <div className="mt-4 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Assay</th>
                  <th className="px-3 py-2 text-left font-medium">Domain</th>
                  <th className="px-3 py-2 text-left font-medium">Measured</th>
                  <th className="px-3 py-2 text-left font-medium">Expected</th>
                  <th className="px-3 py-2 text-left font-medium">Range</th>
                  <th className="px-3 py-2 text-left font-medium">Directive ref</th>
                </tr>
              </thead>
              <tbody>
                {exVivoRuns.map((r) => (
                  <tr key={r.assayId} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <div className="font-mono text-[11px]">{r.assayId}</div>
                      {r.failures > 0 && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                          <RotateCcw className="h-3 w-3" />
                          {r.failures} retry recorded
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.domain}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.measured}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.expected}</td>
                    <td className="px-3 py-2">
                      {r.rangeStatus === "within-range" ? (
                        <StatusPill kind="agreed">
                          <CheckCircle2 className="h-3 w-3" />
                          within
                        </StatusPill>
                      ) : r.rangeStatus === "below-range" ? (
                        <StatusPill kind="disagreed-ex-vivo-wins">
                          <XCircle className="h-3 w-3" />
                          below
                        </StatusPill>
                      ) : (
                        <StatusPill kind="passed-with-conditions">
                          <AlertTriangle className="h-3 w-3" />
                          above
                        </StatusPill>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {r.consumedDirectiveAssayRow}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Phase 5 — Falsifier check */}
        <section className="mt-8">
          <SectionTitle
            num={5}
            Icon={AlertTriangle}
            title="Falsifier Check"
            status="passed-with-conditions"
            statusLabel="1 falsifier triggered"
            note='"Falsified" is a typed state distinct from "low confidence". Falsified predictions never silently average with ex-vivo into a softer joint number.'
          />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-200">
                <XCircle className="h-4 w-4" />
                Off-target kinome — FALSIFIED
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Directive-flagged falsifier{" "}
                <span className="font-mono">KIN-SEL-PROFILE</span> triggered. SRC selectivity
                ratio observed 8× vs predicted ≥20×.
              </div>
              <div className="mt-3 text-[11px] text-red-700 dark:text-red-300">
                Downstream: in-silico off-target prediction for this domain is{" "}
                <span className="font-semibold">not</span> averaged with ex-vivo.
              </div>
            </div>
            <div className="rounded-md border border-border bg-card/40 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                CYP-Transporter, dose-response, hERG
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                No directive-flagged falsifier triggered. Joint synthesis proceeds normally for
                these domains.
              </div>
            </div>
          </div>
        </section>

        {/* Phase 6 — Joint outputs */}
        <section className="mt-8">
          <SectionTitle
            num={6}
            Icon={GitMerge}
            title="Joint Output Synthesis"
            status="partial"
            statusLabel="2 of 4 agreed"
            note="Each domain emits exactly one typed JointOutputState. No silent fallbacks."
          />
          <div className="mt-4 space-y-3">
            {jointOutputs.map((j) => (
              <div
                key={j.domain}
                className={`rounded-md border p-4 ${
                  j.state === "agreed"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : j.state === "disagreed-ex-vivo-wins"
                    ? "border-red-500/30 bg-red-500/5"
                    : j.state === "partial"
                    ? "border-sky-500/30 bg-sky-500/5"
                    : "border-border bg-card/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{j.domain}</div>
                  <StatusPill kind={j.state}>
                    {j.state === "agreed" && <CheckCircle2 className="h-3 w-3" />}
                    {j.state === "disagreed-ex-vivo-wins" && <XCircle className="h-3 w-3" />}
                    {j.state === "partial" && <Wrench className="h-3 w-3" />}
                    {j.state === "exempt" && <Ban className="h-3 w-3" />}
                    {j.state.replace(/-/g, " ")}
                  </StatusPill>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{j.detail}</p>

                <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      In-silico
                    </div>
                    <div
                      className={`mt-0.5 font-mono ${
                        j.state === "disagreed-ex-vivo-wins"
                          ? "text-red-700 line-through decoration-2 dark:text-red-300"
                          : ""
                      }`}
                    >
                      {j.inSilico}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Ex-vivo
                    </div>
                    <div className="mt-0.5 font-mono">{j.exVivo}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {j.tolerance ? "Tolerance" : j.falsifier ? "Falsifier" : "Repair path"}
                    </div>
                    <div className="mt-0.5 font-mono">
                      {j.tolerance ?? j.falsifier ?? (j.repairPath ? "see below" : "—")}
                    </div>
                  </div>
                </div>

                {j.repairPath && (
                  <div className="mt-3 rounded border border-sky-500/30 bg-background p-3 text-[12px]">
                    <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                      <Wrench className="h-3 w-3" />
                      Repair path
                    </div>
                    <div className="mt-2 grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5">
                      <div className="text-muted-foreground">missing assays</div>
                      <div className="flex flex-wrap gap-1 font-mono">
                        {j.repairPath.missingAssayIds.map((a) => (
                          <span key={a} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                            {a}
                          </span>
                        ))}
                      </div>
                      <div className="text-muted-foreground">expected range</div>
                      <div>{j.repairPath.expectedRange}</div>
                      <div className="text-muted-foreground">blocks downstream</div>
                      <div className="flex flex-wrap gap-1">
                        {j.repairPath.blocks.map((b) => (
                          <span
                            key={b}
                            className="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] text-sky-700 dark:text-sky-300"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Phase 7 — Exit gate */}
        <section className="mt-8">
          <SectionTitle
            num={7}
            Icon={DoorOpen}
            title="Exit Gate → L3 Animal Cohort"
            status="passed-with-conditions"
            statusLabel="passed with conditions"
            note="Embedded gatePolicy snapshot makes the package portable across partners."
          />
          <div className="mt-4 rounded-md border border-border bg-card/40 p-5">
            <div className="grid grid-cols-[1fr_auto] items-start gap-6">
              <div>
                <div className="text-sm">
                  This ConfirmationPackage may proceed to L3 Animal Cohort design with two
                  conditions:
                </div>
                <ol className="mt-2 list-decimal pl-5 text-sm text-muted-foreground">
                  <li>
                    L3 must reference falsifier{" "}
                    <span className="font-mono text-foreground">KIN-SEL-PROFILE</span> in
                    cardiac-safety arm scoping (off-target falsified).
                  </li>
                  <li>
                    Repair path on Clearance fractions must be closed (renal & biliary CL
                    measured) before L4 IND-gate can read{" "}
                    <span className="font-mono text-foreground">Phase1.specialPopArm.renalImpairment</span>.
                  </li>
                </ol>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    JSON
                  </span>
                  <span>·</span>
                  <span>Per-track evidence blocks attached</span>
                  <span>·</span>
                  <span>L1 pointer carried verbatim</span>
                  <span>·</span>
                  <span>gatePolicy@{gatePolicy.version} embedded</span>
                </div>
              </div>
              <button
                disabled
                className="inline-flex items-center gap-2 rounded-md border border-border bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60"
              >
                Hand off to L3
                <ExternalLink className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="mt-10 flex items-center justify-between border-t border-border pt-4 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <FlaskConical className="h-3 w-3" />
            Hakase · Confirmation Layer v2.0.0 · open-source pipeline · no commercial gating
          </div>
          <div>Mockup · static fixture (Imatinib partial)</div>
        </div>
      </div>
    </div>
  );
}
