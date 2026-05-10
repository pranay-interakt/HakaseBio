/**
 * ConfirmationLayerPanel — v2.0.0 §4 / §5 orchestrator UI.
 *
 * Sits above the existing in-silico / ex-vivo sub-track scaffolds in slot 2
 * of HakaseAI. Drives the typed Confirmation Layer:
 *   1. Emit PreConfirmationDirective (in-silico → ex-vivo contract).
 *   2. Capture ex-vivo measurements bound to the directive (§6.2).
 *   3. Run falsifier check (§4.5) and surface triggered FalsifierIds.
 *   4. File OverrideRecord with authority chain when accepting a falsifier.
 *   5. Synthesize JointOutput (agree | disagree | partial | mlGap).
 *   6. Emit ConfirmationEvidenceBlock — write-time invariant validated.
 *
 * The panel never modifies the existing sub-track scaffolds; it adds a
 * structured rail above them. The panel always starts blank — the user
 * fills directive → measurements → overrides themselves.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileSignature,
  FlaskConical,
  GitBranch,
  Lock,
  Play,
  Send,
  ShieldCheck,
  Target,
  Workflow,
} from "lucide-react";
import {
  asEvidencePointer,
  type ConfirmationEvidenceBlock,
  type DirectiveId,
  type EvidencePointer,
  type ExVivoEntryMode,
  type FalsifierId,
  type FalsifierTrigger,
  type GatePolicySnapshot,
  type InSilicoEvidenceRecord,
  type JointOutput,
  type OverrideRecord,
  type PreConfirmationDirective,
  type PredictionDomain,
  type Role,
  FALSIFIER_REGISTRY,
  getFalsifierEntry,
} from "@workspace/preclinical-handoff";
import {
  buildConfirmationBlock,
  buildExVivoEvidence,
  buildInSilicoEvidenceFromL1,
  buildOverride,
  checkFalsifiers,
  defaultGatePolicy,
  emitDirective,
  evaluateInSilicoGate,
  freezeL1EvidencePointer,
  l1ConfidenceByClass,
  type ExVivoMeasurement,
} from "@/lib/confirmationEngine";
import type { SimResults } from "@/lib/admet";
import type { InVitroResults } from "@/lib/inVitroSim";

interface Props {
  compoundIdRaw: string;
  l1: SimResults | null;
  inVitro: InVitroResults | null;
  /** Captured by parent; passed back down on emit so L3 can reference it. */
  onConfirmationBlockReady: (block: ConfirmationEvidenceBlock) => void;
  /** Monotonically-increasing counter; each increment force-expands the panel.
   *  Used by the L3 → L2 "block not sealed" call-out so the seal flow is
   *  visible the moment the user lands back on L2. */
  forceExpandSignal?: number;
}

const DEFAULT_MEASUREMENTS: ExVivoMeasurement[] = [
  { assayId: "primary_hepatocyte_clearance", observedValue: null, unit: "mL/min/kg" },
  { assayId: "cyp3a4_inhibition_ic50", observedValue: null, unit: "µM" },
  { assayId: "bsep_inhibition", observedValue: null, unit: "µM" },
  { assayId: "herg_patch_clamp", observedValue: null, unit: "µM" },
  { assayId: "primary_cellular_dose_response", observedValue: null, unit: "fold" },
];

export function ConfirmationLayerPanel({
  compoundIdRaw,
  l1,
  inVitro,
  onConfirmationBlockReady,
  forceExpandSignal,
}: Props) {
  // ── Local state — represents the live drafting workflow ──────────────────
  const [policy] = useState<GatePolicySnapshot>(() => defaultGatePolicy());
  const [directive, setDirective] = useState<PreConfirmationDirective | null>(null);
  const [measurements, setMeasurements] = useState<ExVivoMeasurement[]>(DEFAULT_MEASUREMENTS);
  const [pendingTriggers, setPendingTriggers] = useState<FalsifierTrigger[]>([]);
  const [overrides, setOverrides] = useState<OverrideRecord[]>([]);
  const [block, setBlock] = useState<ConfirmationEvidenceBlock | null>(null);
  const [overrideDraft, setOverrideDraft] = useState<{
    falsifierId: FalsifierId | "";
    reason: string;
    actor: string;
    role: Role;
    authorityCitation: string;
    fields: string;
  }>({
    falsifierId: "",
    reason: "",
    actor: "",
    role: "PreClinicalSafetyReviewer",
    authorityCitation: "AKTHealth-SOP-PCS-007#§3.4",
    fields: "primaryTargetIc50nM,hergIc50UM",
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<"directive" | "exvivo" | "joints" | "overrides" | null>("directive");
  // Collapsed by default — the dashboard uses very little vertical space.
  // Users expand to access the full directive / measurements / seal flow.
  const [expanded, setExpanded] = useState<boolean>(false);

  // External force-expand: any change to `forceExpandSignal` (incl. first
  // non-zero value) opens the orchestrator. Triggered by the L3
  // L2ConfirmationInputsPanel "Open seal flow" button.
  useEffect(() => {
    if (forceExpandSignal != null && forceExpandSignal > 0) {
      setExpanded(true);
      setOpenSection("directive");
    }
  }, [forceExpandSignal]);

  const l1Pointer: EvidencePointer = useMemo(
    () => freezeL1EvidencePointer(compoundIdRaw, new Date().toISOString()),
    [compoundIdRaw],
  );

  const inSilicoEvidence: InSilicoEvidenceRecord[] = useMemo(
    () => (l1 ? buildInSilicoEvidenceFromL1(l1Pointer, null, l1) : []),
    [l1, l1Pointer],
  );

  const inSilicoGate = useMemo(
    () =>
      evaluateInSilicoGate({
        confidenceByClass: l1 ? l1ConfidenceByClass(l1, null) : {},
        policy,
      }),
    [l1, policy],
  );

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleEmitDirective = () => {
    if (!l1) return;
    // Anti-fabrication: predicted central values come from L1 in-silico
    // evidence (which itself is null-when-missing). hERG prefers measured
    // in-vitro IC50 over the ML-derived proxy when available.
    const findPred = (dom: string) =>
      inSilicoEvidence.find((e) => e.predictionDomain === dom)?.predictedValue ?? null;
    const d = emitDirective({
      compoundIdRaw,
      l1Pointer,
      predictedClearanceMlMinKg: findPred("clearance_fractions"),
      predictedCyp3a4Ic50uM: findPred("cyp_transporter"),
      predictedHergIc50uM: inVitro?.herg?.ic50_uM ?? findPred("herg_pbpk"),
      doseRangeMgKg: { min: 0.01, max: 5 },
    });
    setDirective(d);
    setOpenSection("exvivo");
  };

  const handleRunFalsifierCheck = () => {
    if (!directive) return;
    setErrorMsg(null);
    const exVivoRecs = buildExVivoEvidence(measurements, directive.directiveId, l1Pointer);
    const triggers = checkFalsifiers(exVivoRecs, directive);
    setPendingTriggers(triggers);
    setOpenSection(triggers.length > 0 ? "overrides" : "joints");
  };

  const handleFileOverride = () => {
    if (!overrideDraft.falsifierId) {
      setErrorMsg("Select the FalsifierId you are accepting.");
      return;
    }
    if (overrideDraft.reason.trim().length < 20) {
      setErrorMsg("Override reason must be ≥20 characters (mirrors IND-gate policy).");
      return;
    }
    if (!overrideDraft.actor.trim()) {
      setErrorMsg("Actor identity required (name or email).");
      return;
    }
    try {
      const ovr = buildOverride({
        overrideKind: "exVivoGate",
        actor: overrideDraft.actor,
        role: overrideDraft.role,
        authorityCitationPolicy: overrideDraft.authorityCitation,
        reason: overrideDraft.reason,
        falsifierAccepted: overrideDraft.falsifierId as FalsifierId,
        l1Pointer,
        l1FieldsCited: overrideDraft.fields.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setOverrides((arr) => [...arr, ovr]);
      setOverrideDraft((d) => ({ ...d, reason: "" }));
      setOpenSection("joints");
    } catch (e: any) {
      setErrorMsg(String(e?.message ?? e));
    }
  };

  const handleEmitConfirmationBlock = () => {
    if (!directive) {
      setErrorMsg("Emit a directive before sealing the confirmation block.");
      return;
    }
    setErrorMsg(null);
    try {
      const exVivoRecs = buildExVivoEvidence(measurements, directive.directiveId, l1Pointer);
      const triggers = checkFalsifiers(exVivoRecs, directive);
      const entryMode: ExVivoEntryMode = {
        kind: "consumedDirective",
        directiveId: directive.directiveId,
      };
      const built = buildConfirmationBlock({
        l1Pointer,
        inSilicoEvidence,
        inSilicoGateResult: inSilicoGate,
        exVivoEvidence: exVivoRecs,
        exVivoEntryMode: entryMode,
        directive,
        triggers,
        overrides,
        policy,
      });
      setBlock(built);
      setPendingTriggers(triggers);
      onConfirmationBlockReady(built);
    } catch (e: any) {
      setErrorMsg(`Block sealing failed: ${e?.message ?? e}`);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const directiveReady = !!directive;
  const allMeasurementsEntered = measurements.every((m) => m.observedValue != null);
  const acceptedFalsifierSet = new Set(
    overrides.map((o) => o.falsifierAccepted).filter((f): f is FalsifierId => !!f),
  );
  const unhandledTriggers = pendingTriggers.filter(
    (t) => !acceptedFalsifierSet.has(t.falsifierId),
  );
  const sealedStatus =
    block?.gateStatus === "passed"
      ? { label: "PASSED", color: "emerald" }
      : block?.gateStatus === "overridden"
        ? { label: "OVERRIDDEN", color: "amber" }
        : block?.gateStatus === "failed"
          ? { label: "FAILED", color: "rose" }
          : null;

  // ── Compact summary chips (always visible in collapsed mode) ─────────────
  const summary = {
    directive: directive ? "emitted" : "not emitted",
    measurementsFilled: measurements.filter((m) => m.observedValue != null).length,
    measurementsTotal: measurements.length,
    triggers: pendingTriggers.length,
    unhandled: unhandledTriggers.length,
    overrides: overrides.length,
  };

  return (
    <div className="border-b border-white/8 bg-[#0a0d14]">
      {/* Compact one-line header — click to expand the full v2.0.0 workflow */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-2 flex items-center gap-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
          <Workflow className="w-3 h-3 text-cyan-300" />
        </div>
        <span className="text-[10px] font-bold tracking-widest text-cyan-300 px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/25 shrink-0">
          V2.0.0
        </span>
        <span className="text-[12px] font-semibold text-white shrink-0">Confirmation</span>
        {/* Inline status chips */}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 min-w-0 overflow-hidden">
          <span className="text-slate-600">·</span>
          <span>
            Directive <span className={directive ? "text-cyan-300" : "text-slate-500"}>{summary.directive}</span>
          </span>
          <span className="text-slate-600">·</span>
          <span>
            Ex-vivo <span className="text-slate-300 font-mono">{summary.measurementsFilled}/{summary.measurementsTotal}</span>
          </span>
          {summary.triggers > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span className={summary.unhandled > 0 ? "text-amber-300" : "text-emerald-300"}>
                {summary.triggers} falsifier{summary.triggers > 1 ? "s" : ""}
                {summary.unhandled > 0 ? ` (${summary.unhandled} unhandled)` : " accepted"}
              </span>
            </>
          )}
          {summary.overrides > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-violet-300">{summary.overrides} override{summary.overrides > 1 ? "s" : ""}</span>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {sealedStatus && (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border bg-${sealedStatus.color}-500/10 border-${sealedStatus.color}-500/40 text-${sealedStatus.color}-300`}
            >
              {sealedStatus.label}
            </span>
          )}
          <span className="text-[10px] text-slate-500 hidden md:inline">
            {expanded ? "Hide details" : "Open"}
          </span>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          )}
        </div>
      </button>

      {!expanded && null}
      {expanded && (
      <div className="px-5 pb-4 pt-1 space-y-3">
        <p className="text-[10px] text-slate-500">
          Directive-bound ex-vivo · falsifier registry {FALSIFIER_REGISTRY.version} · gate policy{" "}
          <span className="font-mono text-slate-400">{policy.policyId}@{policy.policyVersion}</span>
        </p>

      {/* Step 1 — Directive */}
      <Section
        open={openSection === "directive"}
        onToggle={() => setOpenSection(openSection === "directive" ? null : "directive")}
        icon={<FileSignature className="w-3.5 h-3.5" />}
        label="1. PreConfirmationDirective"
        status={directiveReady ? "complete" : "pending"}
        meta={directive ? `${directive.directiveId}` : "Emits in-silico → ex-vivo contract"}
      >
        <div className="space-y-2 text-[11px]">
          {!l1 ? (
            <p className="text-slate-500">Run Layer 1 first — directive needs L1 evidence pointer.</p>
          ) : !directive ? (
            <button
              onClick={handleEmitDirective}
              className="px-3 py-1.5 rounded-lg bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 font-medium hover:bg-cyan-600/30 flex items-center gap-1.5"
            >
              <Send className="w-3 h-3" /> Emit directive
            </button>
          ) : (
            <div className="rounded-lg bg-black/30 border border-white/8 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">L1 evidence pointer</span>
                <span className="font-mono text-slate-300 truncate ml-3">{directive.l1EvidencePointer}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Detail k="Prioritised assays" v={`${directive.prioritisedAssays.length}`} />
                <Detail k="Falsifier panel" v={`${directive.falsifiers.length}`} />
                <Detail k="Predictions covered" v={directive.predictionsCovered.join(", ")} />
                <Detail k="Recommended dose" v={`${directive.recommendedDoseRanges[0]?.minMgKg}–${directive.recommendedDoseRanges[0]?.maxMgKg} mg/kg ${directive.recommendedDoseRanges[0]?.route}`} />
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Step 2 — Ex-vivo measurements */}
      <Section
        open={openSection === "exvivo"}
        onToggle={() => setOpenSection(openSection === "exvivo" ? null : "exvivo")}
        icon={<FlaskConical className="w-3.5 h-3.5" />}
        label="2. Ex-vivo measurements (directive-bound)"
        status={allMeasurementsEntered ? "complete" : directive ? "active" : "pending"}
        meta={`${measurements.filter((m) => m.observedValue != null).length}/${measurements.length} entered`}
      >
        <div className="space-y-2">
          {measurements.map((m, i) => (
            <div key={m.assayId} className="flex items-center gap-2 text-[11px]">
              <span className="w-56 text-slate-400 truncate">{m.assayId}</span>
              <input
                type="number"
                value={m.observedValue ?? ""}
                disabled={!directive}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setMeasurements((arr) => arr.map((x, j) => (j === i ? { ...x, observedValue: v } : x)));
                }}
                className="w-32 px-2 py-1 rounded bg-black/30 border border-white/10 text-white font-mono disabled:opacity-40"
                placeholder="—"
              />
              <span className="text-slate-500 w-20">{m.unit}</span>
            </div>
          ))}
          <button
            onClick={handleRunFalsifierCheck}
            disabled={!directive || !measurements.some((m) => m.observedValue != null)}
            className="mt-2 px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/40 text-amber-200 text-[11px] font-medium hover:bg-amber-600/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <Target className="w-3 h-3" /> Run falsifier check
          </button>
        </div>
      </Section>

      {/* Step 3 — Falsifier triggers + override authoring */}
      {pendingTriggers.length > 0 && (
        <Section
          open={openSection === "overrides"}
          onToggle={() => setOpenSection(openSection === "overrides" ? null : "overrides")}
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          label={`3. Falsifier triggers (${unhandledTriggers.length} unhandled)`}
          status={unhandledTriggers.length === 0 ? "complete" : "active"}
          meta={pendingTriggers.map((t) => t.falsifierId).join(", ")}
          tone="warn"
        >
          <div className="space-y-2 text-[11px]">
            {pendingTriggers.map((t) => {
              const entry = getFalsifierEntry(t.falsifierId);
              const accepted = acceptedFalsifierSet.has(t.falsifierId);
              return (
                <div
                  key={t.falsifierId}
                  className={`rounded-lg border p-2.5 ${
                    accepted
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-amber-500/30 bg-amber-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-amber-200">{t.falsifierId}</span>
                    <span className="text-slate-500">margin {t.marginObserved}</span>
                  </div>
                  <p className="text-slate-400 mt-1 leading-snug">{entry?.description}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Domain: <span className="font-mono">{t.predictionFalsified}</span>
                    {entry?.mabelBiasRequired && (
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[9px] font-bold">
                        MABEL-BIAS-REQUIRED
                      </span>
                    )}
                  </p>
                  {accepted && (
                    <p className="text-[10px] text-emerald-300 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Accepted via override
                    </p>
                  )}
                </div>
              );
            })}

            {unhandledTriggers.length > 0 && (
              <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2 mt-3">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">File OverrideRecord</p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={overrideDraft.falsifierId}
                    onChange={(e) => setOverrideDraft((d) => ({ ...d, falsifierId: e.target.value as FalsifierId }))}
                    className="px-2 py-1 rounded bg-black/40 border border-white/10 text-white text-[11px]"
                  >
                    <option value="">— Falsifier accepted —</option>
                    {unhandledTriggers.map((t) => (
                      <option key={t.falsifierId} value={t.falsifierId}>{t.falsifierId}</option>
                    ))}
                  </select>
                  <select
                    value={overrideDraft.role}
                    onChange={(e) => setOverrideDraft((d) => ({ ...d, role: e.target.value as Role }))}
                    className="px-2 py-1 rounded bg-black/40 border border-white/10 text-white text-[11px]"
                  >
                    <option value="PreClinicalSafetyReviewer">PreClinicalSafetyReviewer</option>
                    <option value="ProgramLead">ProgramLead</option>
                    <option value="RegulatoryAffairs">RegulatoryAffairs</option>
                    <option value="ChiefScientificOfficer">ChiefScientificOfficer</option>
                  </select>
                  <input
                    placeholder="Actor (name / email)"
                    value={overrideDraft.actor}
                    onChange={(e) => setOverrideDraft((d) => ({ ...d, actor: e.target.value }))}
                    className="px-2 py-1 rounded bg-black/40 border border-white/10 text-white text-[11px]"
                  />
                  <input
                    placeholder="Authority citation (PolicyRef#section)"
                    value={overrideDraft.authorityCitation}
                    onChange={(e) => setOverrideDraft((d) => ({ ...d, authorityCitation: e.target.value }))}
                    className="px-2 py-1 rounded bg-black/40 border border-white/10 text-white text-[11px] font-mono"
                  />
                  <input
                    placeholder="L1 fields cited (comma-separated)"
                    value={overrideDraft.fields}
                    onChange={(e) => setOverrideDraft((d) => ({ ...d, fields: e.target.value }))}
                    className="col-span-2 px-2 py-1 rounded bg-black/40 border border-white/10 text-white text-[11px] font-mono"
                  />
                </div>
                <textarea
                  placeholder="Reason (≥20 chars; explains why the predicted outcome is acceptable in this program context)"
                  value={overrideDraft.reason}
                  onChange={(e) => setOverrideDraft((d) => ({ ...d, reason: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded bg-black/40 border border-white/10 text-white text-[11px] min-h-[60px]"
                />
                <button
                  onClick={handleFileOverride}
                  className="px-3 py-1.5 rounded-lg bg-violet-600/25 border border-violet-500/40 text-violet-200 text-[11px] font-medium hover:bg-violet-600/35 flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3 h-3" /> File override
                </button>
              </div>
            )}

            {overrides.length > 0 && (
              <div className="space-y-1.5 mt-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Audit trail ({overrides.length})</p>
                {overrides.map((o) => (
                  <div key={o.overrideId} className="rounded bg-black/30 border border-white/8 px-2.5 py-1.5 text-[10px]">
                    <div className="flex justify-between">
                      <span className="font-mono text-violet-300">{o.overrideKind}</span>
                      <span className="text-slate-500">{o.role}</span>
                    </div>
                    <div className="text-slate-400 mt-0.5">
                      Accepted {o.falsifierAccepted ?? "—"} · cite {o.authorityCitation}
                    </div>
                    <div className="text-slate-500 mt-0.5 truncate">"{o.reason}"</div>
                    <div className="text-slate-600 mt-0.5 font-mono text-[9px]">{o.signedDigest}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Step 4 — Joint outputs (preview before sealing) */}
      <Section
        open={openSection === "joints"}
        onToggle={() => setOpenSection(openSection === "joints" ? null : "joints")}
        icon={<GitBranch className="w-3.5 h-3.5" />}
        label="4. Joint output synthesis & seal block"
        status={block ? "complete" : "pending"}
        meta={
          block
            ? `Sealed at ${block.emittedAt.slice(11, 19)}Z`
            : "Synthesises agree | disagree | partial | mlGap per domain"
        }
      >
        <div className="space-y-2">
          {block && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              {(
                [
                  ["cyp_transporter", block.jointOutputs.cypTransporter],
                  ["clearance_fractions", block.jointOutputs.clearanceFractions],
                  ["off_target", block.jointOutputs.offTarget],
                  ["dose_response", block.jointOutputs.doseResponse],
                  ["herg_pbpk", block.jointOutputs.hergPbpkProjection],
                ] as Array<[string, JointOutput<PredictionDomain>]>
              ).map(([dom, jo]) => (
                <JointOutputCard key={dom} domain={dom} jo={jo} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleEmitConfirmationBlock}
              disabled={!directive || !measurements.some((m) => m.observedValue != null)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600/25 border border-emerald-500/40 text-emerald-200 text-[11px] font-medium hover:bg-emerald-600/35 disabled:opacity-40 flex items-center gap-1.5"
            >
              <Lock className="w-3 h-3" /> Seal ConfirmationEvidenceBlock
            </button>
            {block && (
              <span className="text-[10px] text-slate-500">
                Block emitted with {block.overrides.length} override(s) · {block.exVivo.evidence.length} ex-vivo records ·
                gate <span className={`font-bold ${block.gateStatus === "passed" ? "text-emerald-300" : block.gateStatus === "overridden" ? "text-amber-300" : "text-rose-300"}`}>{block.gateStatus}</span>
              </span>
            )}
          </div>
          {errorMsg && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-300">
              {errorMsg}
            </div>
          )}
        </div>
      </Section>
      </div>
      )}
    </div>
  );
}

function Section(props: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  status: "pending" | "active" | "complete";
  meta: string;
  tone?: "warn";
  children: React.ReactNode;
}) {
  const dot =
    props.status === "complete" ? (
      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
    ) : props.status === "active" ? (
      <Play className="w-3 h-3 text-cyan-300" />
    ) : (
      <CircleDot className="w-3 h-3 text-slate-500" />
    );
  return (
    <div className={`rounded-lg border ${props.tone === "warn" ? "border-amber-500/25 bg-amber-500/[0.03]" : "border-white/8 bg-white/[0.015]"}`}>
      <button
        onClick={props.onToggle}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
      >
        {dot}
        <span className="text-cyan-300/80">{props.icon}</span>
        <span className="text-[12px] font-semibold text-slate-200">{props.label}</span>
        <span className="ml-auto text-[10px] text-slate-500 truncate max-w-[400px] font-mono">{props.meta}</span>
        {props.open ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
      </button>
      {props.open && <div className="px-3 pb-3 pt-1">{props.children}</div>}
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{k}</span>
      <span className="font-mono text-slate-300 truncate">{v}</span>
    </div>
  );
}

function JointOutputCard({ domain, jo }: { domain: string; jo: JointOutput<PredictionDomain> }) {
  const tone =
    jo.status === "agree"
      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
      : jo.status === "disagree"
        ? "border-rose-500/30 bg-rose-500/5 text-rose-200"
        : jo.status === "partial"
          ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
          : "border-slate-500/30 bg-slate-500/5 text-slate-300";
  return (
    <div className={`rounded-lg border p-2 ${tone}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px]">{domain}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider">{jo.status}</span>
      </div>
      <div className="text-[10px] text-slate-400 mt-1">
        {jo.synthesisedValue != null
          ? `${jo.synthesisedValue} ${jo.unit}`
          : "no synthesised value"}
        {" · "}joint conf {(jo.jointConfidence * 100).toFixed(0)}%
      </div>
      {jo.falsifierTriggered && (
        <div className="text-[10px] text-rose-300 mt-1 font-mono">{jo.falsifierTriggered}</div>
      )}
      {jo.repairPath && (
        <div className="text-[10px] text-amber-300 mt-1">
          Repair: {jo.repairPath.missingAssay.label} · ${jo.repairPath.estimatedCost?.amount} ·{" "}
          {jo.repairPath.estimatedTurnaround?.value} {jo.repairPath.estimatedTurnaround?.unit}s
        </div>
      )}
      {jo.confidenceCaveat && (
        <div className="text-[10px] text-slate-500 mt-1 leading-snug">{jo.confidenceCaveat}</div>
      )}
    </div>
  );
}

