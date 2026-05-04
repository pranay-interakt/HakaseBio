import { useState, useRef, useEffect, useMemo } from "react";
import {
  Beaker,
  ChevronDown,
  ChevronUp,
  Globe,
  CheckCircle2,
  XCircle,
  Play,
  Sparkles,
  AlertTriangle,
  Atom,
  Dna,
  HeartPulse,
  TestTube2,
  Info,
  Users,
  Target as TargetIcon,
  TrendingUp,
  Repeat,
  Layers,
  ShieldAlert,
  KeyRound,
} from "lucide-react";
import {
  isPreClinicalPackage,
  type PreClinicalPackage,
} from "@workspace/preclinical-handoff";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  buildManualPackage,
  EMPTY_MANUAL_INPUT,
  type ManualPackageInput,
} from "@/lib/manualPackageBuilder";
import {
  EMPTY_PHASE1_DESIGN,
  type Phase1Design,
  type StartingDoseMethod,
  type EscalationScheme,
  type PopulationBranch,
  type RegulatoryRegion,
  type RiskTolerance,
  computeStartingDose,
  generateEscalation,
  evaluateIndGate,
  gateSubStudies,
  type StartingDoseResult,
  type EscalationResult,
  type IndGateStatus,
} from "@/lib/phase1Plan";

export interface Phase1PlannerHandle {
  applyTemplatePartial: (
    partial: Partial<ManualPackageInput>,
    templateId: string,
  ) => void;
  reset: () => void;
  openApi: () => void;
}

interface Props {
  pkg: PreClinicalPackage | null;
  importError: string | null;
  onPackageReady: (pkg: PreClinicalPackage | null) => void;
  onImportError: (msg: string | null) => void;
  registerHandle: (h: Phase1PlannerHandle) => void;
  jumpToApiSignal: number;
}

// ── Tiny shared primitives ─────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  label,
  rightSlot,
}: {
  icon: typeof Beaker;
  label: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
        {label}
      </span>
      {rightSlot && <div className="ml-auto">{rightSlot}</div>}
    </div>
  );
}

function FieldGroup({
  label,
  children,
  required,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Label className="text-[11px] text-slate-400 font-medium">{label}</Label>
        {required && (
          <span className="text-[9px] text-violet-400 font-bold">*</span>
        )}
        {hint && (
          <span className="text-[9px] text-slate-600 ml-auto">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

const INPUT_CLS =
  "bg-white/5 border-white/10 text-white text-[12px] focus:border-violet-500/60";

function ChoicePills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={
            "py-1.5 px-2 rounded text-[10px] font-semibold uppercase border transition-all " +
            (value === o.value
              ? "bg-violet-500/20 border-violet-500/50 text-violet-200"
              : "bg-white/[0.02] border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Main planner ───────────────────────────────────────────────────────────

export default function Phase1Planner({
  pkg,
  importError,
  onPackageReady,
  onImportError,
  registerHandle,
  jumpToApiSignal,
}: Props) {
  // Upstream §8 package source state
  const [upstreamOpen, setUpstreamOpen] = useState(true);
  const [entryMode, setEntryMode] = useState<"api" | "manual">("api");
  const [manual, setManual] = useState<ManualPackageInput>(EMPTY_MANUAL_INPUT);
  const [manualErrors, setManualErrors] = useState<string[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState("");
  const upstreamCardRef = useRef<HTMLDivElement | null>(null);

  // Phase 1 clinical-side design state
  const [design, setDesign] = useState<Phase1Design>(EMPTY_PHASE1_DESIGN);
  const [planEmitted, setPlanEmitted] = useState(false);

  const setManualField = <K extends keyof ManualPackageInput>(
    k: K,
    v: ManualPackageInput[K],
  ) => setManual((p) => ({ ...p, [k]: v }));

  // Imperative handle for ProjectsRail
  useEffect(() => {
    registerHandle({
      applyTemplatePartial: (partial, templateId) => {
        setManual((p) => ({ ...p, ...partial }));
        setActiveTemplate(templateId);
        setManualErrors([]);
        onImportError(null);
        onPackageReady(null);
        setUpstreamOpen(true);
        setEntryMode("manual");
      },
      reset: () => {
        setManual(EMPTY_MANUAL_INPUT);
        setActiveTemplate(null);
        setManualErrors([]);
        setJsonText("");
        setUpstreamOpen(true);
        setEntryMode("api");
        setDesign(EMPTY_PHASE1_DESIGN);
        setPlanEmitted(false);
        onImportError(null);
        onPackageReady(null);
      },
      openApi: () => {
        setUpstreamOpen(true);
        setEntryMode("api");
        setTimeout(() => {
          upstreamCardRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 50);
      },
    });
  }, [registerHandle, onImportError, onPackageReady]);

  useEffect(() => {
    if (jumpToApiSignal === 0) return;
    setUpstreamOpen(true);
    setEntryMode("api");
    setTimeout(() => {
      upstreamCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }, [jumpToApiSignal]);

  // Auto-collapse upstream card when a package is activated
  useEffect(() => {
    if (pkg !== null) setUpstreamOpen(false);
  }, [pkg]);

  // ── Upstream handlers ──────────────────────────────────────────────────

  const handleValidateJson = () => {
    onImportError(null);
    onPackageReady(null);
    setPlanEmitted(false);
    if (!jsonText.trim()) {
      onImportError("Paste a PreClinicalPackage JSON first.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      onImportError(
        `Not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    if (!isPreClinicalPackage(parsed)) {
      onImportError(
        "JSON does not match PreClinicalPackage v1.0.0 shape. The §6.1 sub-payloads (cypTransporterPanel, clearanceFractions) MUST be present as either a valid object or null — undefined is rejected.",
      );
      return;
    }
    onPackageReady(parsed);
  };

  const handleBuildManual = () => {
    onImportError(null);
    onPackageReady(null);
    setPlanEmitted(false);
    const r = buildManualPackage(manual);
    if (!r.ok || !r.pkg) {
      setManualErrors(r.errors);
      onImportError(
        `Manual entry incomplete: ${r.errors.length} required field(s) missing.`,
      );
      return;
    }
    setManualErrors([]);
    onPackageReady(r.pkg);
  };

  // ── Computed plan ──────────────────────────────────────────────────────

  const dose: StartingDoseResult | null = useMemo(
    () => (pkg ? computeStartingDose(pkg, design.startingDose) : null),
    [pkg, design.startingDose],
  );

  const escalation: EscalationResult | null = useMemo(() => {
    if (!pkg || !dose || !dose.ok || dose.doseMgPerKg === null) return null;
    return generateEscalation(
      dose.doseMgPerKg,
      design.startingDose.bodyWeightKg,
      design.sad.escalationScheme,
      design.sad.maxPlannedDoseMg,
      design.sad.manualDoseLevelsMg,
    );
  }, [pkg, dose, design.sad, design.startingDose.bodyWeightKg]);

  const indGate: IndGateStatus | null = useMemo(
    () => (pkg ? evaluateIndGate(pkg, design.indGateOverride) : null),
    [pkg, design.indGateOverride],
  );

  const subGates = useMemo(
    () => (pkg ? gateSubStudies(pkg) : null),
    [pkg],
  );

  const handleEmitPlan = () => {
    if (!pkg || !indGate || !indGate.pass) return;
    if (!dose || !dose.ok) return;
    setPlanEmitted(true);
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex overflow-hidden h-full">
      {/* MIDDLE — Phase 1 clinical decisions */}
      <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col bg-[#0b0d14] shrink-0">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Beaker className="w-4 h-4 text-violet-400" />
            <h2 className="text-[15px] font-semibold text-white">
              Phase 1 — FIH / SAD-MAD Planner
            </h2>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            Sits downstream of the L4 §8 PreClinicalPackage. Configure the
            clinical-side decisions; the planner refuses to emit unless the
            IND-enabling gate passes.
          </p>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {/* ── 1. Upstream §8 Package source ────────────────────────── */}
          <div
            ref={upstreamCardRef}
            className={
              "border rounded-lg overflow-hidden " +
              (pkg
                ? "border-emerald-500/30 bg-emerald-500/[0.03]"
                : "border-violet-500/30 bg-violet-950/20")
            }
          >
            <button
              onClick={() => setUpstreamOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={
                    "w-5 h-5 rounded flex items-center justify-center shrink-0 " +
                    (pkg
                      ? "bg-gradient-to-br from-emerald-500 to-emerald-700"
                      : "bg-gradient-to-br from-violet-500 to-violet-700")
                  }
                >
                  {pkg ? (
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  ) : (
                    <Globe className="w-3 h-3 text-white" />
                  )}
                </div>
                <div className="text-left min-w-0">
                  <div
                    className={
                      "text-[11px] font-semibold " +
                      (pkg ? "text-emerald-200" : "text-violet-200")
                    }
                  >
                    Upstream §8 Package{pkg ? " · loaded" : ""}
                  </div>
                  <div
                    className={
                      "text-[9px] leading-tight truncate " +
                      (pkg ? "text-emerald-400/70" : "text-violet-400/70")
                    }
                  >
                    {pkg
                      ? `${pkg.compound.preferredName ?? "(unnamed)"} · ${pkg.animalCohort.speciesDisplayName} · NOAEL ${pkg.animalCohort.noaelMgPerKg} mg/kg`
                      : "Required input — Import via API or enter manually"}
                  </div>
                </div>
              </div>
              {upstreamOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>

            {upstreamOpen && (
              <div className="border-t border-white/8 p-3 space-y-3">
                {/* mode tabs */}
                <div className="flex gap-1 p-0.5 bg-black/30 rounded">
                  <button
                    onClick={() => setEntryMode("api")}
                    className={
                      "flex-1 py-1.5 text-[10px] font-semibold uppercase rounded transition " +
                      (entryMode === "api"
                        ? "bg-violet-500/20 text-violet-200"
                        : "text-slate-500 hover:text-slate-300")
                    }
                  >
                    Import via API
                  </button>
                  <button
                    onClick={() => setEntryMode("manual")}
                    className={
                      "flex-1 py-1.5 text-[10px] font-semibold uppercase rounded transition " +
                      (entryMode === "manual"
                        ? "bg-violet-500/20 text-violet-200"
                        : "text-slate-500 hover:text-slate-300")
                    }
                  >
                    Manual upstream entry
                  </button>
                </div>

                {entryMode === "api" && (
                  <ApiImportPane
                    jsonText={jsonText}
                    setJsonText={(v) => {
                      setJsonText(v);
                      onImportError(null);
                    }}
                    importError={importError}
                    onValidate={handleValidateJson}
                  />
                )}

                {entryMode === "manual" && (
                  <ManualEntryPane
                    manual={manual}
                    setManualField={setManualField}
                    activeTemplate={activeTemplate}
                    onBuild={handleBuildManual}
                    errors={manualErrors}
                  />
                )}
              </div>
            )}
          </div>

          {/* ── 2. Population & Scoping ────────────────────────────── */}
          <DesignSection
            icon={Users}
            label="Population & Scoping"
            disabled={!pkg}
          >
            <FieldGroup label="Population branch" required>
              <ChoicePills
                value={design.scoping.population}
                options={[
                  { value: "healthy-volunteers", label: "Healthy" },
                  { value: "patients", label: "Patients" },
                ]}
                onChange={(v) =>
                  setDesign((d) => ({
                    ...d,
                    scoping: { ...d.scoping, population: v },
                  }))
                }
              />
              <p className="text-[9px] text-slate-500 mt-1 leading-snug">
                Patients almost always for oncology, severe disease, or organ-impairment cohorts.
              </p>
            </FieldGroup>
            {design.scoping.population === "patients" && (
              <FieldGroup
                label="Patient-branch rationale"
                required
                hint={`${design.scoping.populationRationale.length} chars`}
              >
                <Textarea
                  value={design.scoping.populationRationale}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      scoping: {
                        ...d.scoping,
                        populationRationale: e.target.value,
                      },
                    }))
                  }
                  rows={2}
                  placeholder="e.g. severe oncology indication; HV exposure unethical given expected toxicity profile"
                  className={INPUT_CLS + " resize-none"}
                />
              </FieldGroup>
            )}
            <div className="grid grid-cols-2 gap-2">
              <FieldGroup label="Indication" required>
                <Input
                  value={design.scoping.indication}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      scoping: { ...d.scoping, indication: e.target.value },
                    }))
                  }
                  placeholder="e.g. CML 2L"
                  className={INPUT_CLS}
                />
              </FieldGroup>
              <FieldGroup label="Region" required>
                <select
                  value={design.scoping.region}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      scoping: {
                        ...d.scoping,
                        region: e.target.value as RegulatoryRegion,
                      },
                    }))
                  }
                  className={
                    INPUT_CLS +
                    " w-full h-8 rounded-md px-2 appearance-none cursor-pointer"
                  }
                >
                  <option value="FDA">FDA (US)</option>
                  <option value="EMA">EMA (EU)</option>
                  <option value="PMDA">PMDA (JP)</option>
                  <option value="CDSCO">CDSCO (IN)</option>
                </select>
              </FieldGroup>
            </div>
            <FieldGroup label="Target product profile">
              <Input
                value={design.scoping.targetProductProfile}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    scoping: {
                      ...d.scoping,
                      targetProductProfile: e.target.value,
                    },
                  }))
                }
                placeholder="e.g. once-daily oral, MR vs imatinib"
                className={INPUT_CLS}
              />
            </FieldGroup>
            <FieldGroup label="Sponsor risk tolerance">
              <ChoicePills
                value={design.scoping.riskTolerance}
                options={[
                  { value: "conservative", label: "Conservative" },
                  { value: "standard", label: "Standard" },
                  { value: "aggressive", label: "Aggressive" },
                ]}
                onChange={(v) =>
                  setDesign((d) => ({
                    ...d,
                    scoping: { ...d.scoping, riskTolerance: v },
                  }))
                }
              />
            </FieldGroup>
            <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={design.scoping.priorHumanExposure}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    scoping: {
                      ...d.scoping,
                      priorHumanExposure: e.target.checked,
                    },
                  }))
                }
                className="accent-violet-500"
              />
              Prior human exposure exists (not true FIH)
            </label>
          </DesignSection>

          {/* ── 3. Starting dose method ─────────────────────────────── */}
          <DesignSection
            icon={TargetIcon}
            label="Starting Dose Method"
            disabled={!pkg}
          >
            <FieldGroup label="Method" required>
              <ChoicePills
                value={design.startingDose.method}
                options={[
                  { value: "Lower-of-both", label: "Lower" },
                  { value: "HED-BSA", label: "HED-BSA" },
                  { value: "HED-PBPK", label: "HED-PBPK" },
                  { value: "MABEL", label: "MABEL" },
                  { value: "Manual", label: "Manual" },
                ]}
                onChange={(v) =>
                  setDesign((d) => ({
                    ...d,
                    startingDose: { ...d.startingDose, method: v },
                  }))
                }
              />
            </FieldGroup>
            <div className="grid grid-cols-2 gap-2">
              <FieldGroup label="Safety factor" required>
                <Input
                  type="number"
                  value={design.startingDose.safetyFactor}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      startingDose: {
                        ...d.startingDose,
                        safetyFactor: Number(e.target.value),
                      },
                    }))
                  }
                  className={INPUT_CLS}
                />
              </FieldGroup>
              <FieldGroup label="Body weight (kg)" required>
                <Input
                  type="number"
                  value={design.startingDose.bodyWeightKg}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      startingDose: {
                        ...d.startingDose,
                        bodyWeightKg: Number(e.target.value),
                      },
                    }))
                  }
                  className={INPUT_CLS}
                />
              </FieldGroup>
            </div>
            {design.startingDose.method === "MABEL" && (
              <FieldGroup label="Target receptor occupancy (0–1)" required>
                <Input
                  type="number"
                  step="0.01"
                  value={design.startingDose.mabelTargetOccupancy}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      startingDose: {
                        ...d.startingDose,
                        mabelTargetOccupancy: Number(e.target.value),
                      },
                    }))
                  }
                  className={INPUT_CLS}
                />
              </FieldGroup>
            )}
            {design.startingDose.method === "Manual" && (
              <FieldGroup label="Manual starting dose (mg/kg)" required>
                <Input
                  type="number"
                  step="0.0001"
                  value={design.startingDose.manualStartingDoseMgPerKg ?? ""}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      startingDose: {
                        ...d.startingDose,
                        manualStartingDoseMgPerKg:
                          e.target.value === ""
                            ? null
                            : Number(e.target.value),
                      },
                    }))
                  }
                  className={INPUT_CLS}
                />
              </FieldGroup>
            )}
          </DesignSection>

          {/* ── 4. SAD design ───────────────────────────────────────── */}
          <DesignSection icon={TrendingUp} label="SAD Design" disabled={!pkg}>
            <FieldGroup label="Escalation scheme" required>
              <select
                value={design.sad.escalationScheme}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    sad: {
                      ...d.sad,
                      escalationScheme: e.target.value as EscalationScheme,
                    },
                  }))
                }
                className={
                  INPUT_CLS + " w-full h-8 rounded-md px-2 cursor-pointer"
                }
              >
                <option value="modified-fibonacci">Modified Fibonacci</option>
                <option value="geometric-2x">Geometric 2×</option>
                <option value="geometric-1.5x">Geometric 1.5×</option>
                <option value="PK-guided">PK-guided (not yet wired)</option>
                <option value="manual">Manual dose levels</option>
              </select>
            </FieldGroup>
            <div className="grid grid-cols-2 gap-2">
              <FieldGroup label="Cohort size" hint="6 + 2 sentinel typical">
                <Input
                  type="number"
                  value={design.sad.cohortSize}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      sad: { ...d.sad, cohortSize: Number(e.target.value) },
                    }))
                  }
                  className={INPUT_CLS}
                />
              </FieldGroup>
              <FieldGroup label="Max planned dose (mg)">
                <Input
                  type="number"
                  value={design.sad.maxPlannedDoseMg ?? ""}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      sad: {
                        ...d.sad,
                        maxPlannedDoseMg:
                          e.target.value === ""
                            ? null
                            : Number(e.target.value),
                      },
                    }))
                  }
                  className={INPUT_CLS}
                />
              </FieldGroup>
            </div>
            {design.sad.escalationScheme === "manual" && (
              <FieldGroup label="Manual dose levels (mg, comma-sep)" required>
                <Input
                  value={design.sad.manualDoseLevelsMg}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      sad: { ...d.sad, manualDoseLevelsMg: e.target.value },
                    }))
                  }
                  placeholder="e.g. 1, 2, 4, 8, 16, 32"
                  className={INPUT_CLS}
                />
              </FieldGroup>
            )}
            <FieldGroup label="Exposure cap (× NOAEL exposure)">
              <Input
                type="number"
                step="0.05"
                value={design.sad.exposureCapMultipleOfNoael}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    sad: {
                      ...d.sad,
                      exposureCapMultipleOfNoael: Number(e.target.value),
                    },
                  }))
                }
                className={INPUT_CLS}
              />
            </FieldGroup>
            <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={design.sad.sentinelDosing}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    sad: { ...d.sad, sentinelDosing: e.target.checked },
                  }))
                }
                className="accent-violet-500"
              />
              Sentinel dosing (1 active + 1 placebo before cohort)
            </label>
          </DesignSection>

          {/* ── 5. MAD design ───────────────────────────────────────── */}
          <DesignSection icon={Repeat} label="MAD Design" disabled={!pkg}>
            <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={design.mad.enabled}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    mad: { ...d.mad, enabled: e.target.checked },
                  }))
                }
                className="accent-violet-500"
              />
              Include MAD arm
            </label>
            {design.mad.enabled && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <FieldGroup label="Duration (days)" hint="7–14 typical">
                    <Input
                      type="number"
                      value={design.mad.durationDays}
                      onChange={(e) =>
                        setDesign((d) => ({
                          ...d,
                          mad: {
                            ...d.mad,
                            durationDays: Number(e.target.value),
                          },
                        }))
                      }
                      className={INPUT_CLS}
                    />
                  </FieldGroup>
                  <FieldGroup label="Cohort size">
                    <Input
                      type="number"
                      value={design.mad.cohortSize}
                      onChange={(e) =>
                        setDesign((d) => ({
                          ...d,
                          mad: { ...d.mad, cohortSize: Number(e.target.value) },
                        }))
                      }
                      className={INPUT_CLS}
                    />
                  </FieldGroup>
                  <FieldGroup label="Accumulation ratio target">
                    <Input
                      type="number"
                      step="0.1"
                      value={design.mad.accumulationRatioTarget}
                      onChange={(e) =>
                        setDesign((d) => ({
                          ...d,
                          mad: {
                            ...d.mad,
                            accumulationRatioTarget: Number(e.target.value),
                          },
                        }))
                      }
                      className={INPUT_CLS}
                    />
                  </FieldGroup>
                  <FieldGroup label="Carry-forward SAD level (idx)">
                    <Input
                      type="number"
                      value={design.mad.carryForwardLowest}
                      onChange={(e) =>
                        setDesign((d) => ({
                          ...d,
                          mad: {
                            ...d.mad,
                            carryForwardLowest: Number(e.target.value),
                          },
                        }))
                      }
                      className={INPUT_CLS}
                    />
                  </FieldGroup>
                </div>
              </>
            )}
          </DesignSection>

          {/* ── 6. Sub-studies ───────────────────────────────────────── */}
          <DesignSection icon={Layers} label="Sub-studies" disabled={!pkg}>
            {(
              [
                ["foodEffect", "Food-effect crossover (mid-SAD)"],
                ["ddiCocktail", "DDI cocktail (CYP/transporter probes)"],
                ["tqtRequired", "TQT / thorough QT"],
                ["renalImpairment", "Renal-impairment arm"],
                ["hepaticImpairment", "Hepatic-impairment arm"],
              ] as const
            ).map(([k, label]) => (
              <label
                key={k}
                className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={design.subStudies[k]}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      subStudies: {
                        ...d.subStudies,
                        [k]: e.target.checked,
                      },
                    }))
                  }
                  className="accent-violet-500"
                />
                {label}
              </label>
            ))}
            <p className="text-[9px] text-slate-500 leading-snug">
              Feasibility & gating shown on the right once a package is loaded.
            </p>
          </DesignSection>

          {/* ── 7. Stopping rules ───────────────────────────────────── */}
          <DesignSection
            icon={ShieldAlert}
            label="Stopping Rules"
            disabled={!pkg}
          >
            <div className="grid grid-cols-2 gap-2">
              <FieldGroup label="Halt on AE grade ≥">
                <select
                  value={design.stoppingRules.haltOnAeGrade}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      stoppingRules: {
                        ...d.stoppingRules,
                        haltOnAeGrade: Number(e.target.value) as 2 | 3 | 4,
                      },
                    }))
                  }
                  className={
                    INPUT_CLS + " w-full h-8 rounded-md px-2 cursor-pointer"
                  }
                >
                  <option value={2}>Grade 2</option>
                  <option value={3}>Grade 3</option>
                  <option value={4}>Grade 4</option>
                </select>
              </FieldGroup>
              <FieldGroup label="DLT rate threshold (0–1)">
                <Input
                  type="number"
                  step="0.01"
                  value={design.stoppingRules.dltRateThreshold}
                  onChange={(e) =>
                    setDesign((d) => ({
                      ...d,
                      stoppingRules: {
                        ...d.stoppingRules,
                        dltRateThreshold: Number(e.target.value),
                      },
                    }))
                  }
                  className={INPUT_CLS}
                />
              </FieldGroup>
            </div>
            <FieldGroup label="Pause if Cmax > X × NOAEL exposure">
              <Input
                type="number"
                step="0.05"
                value={design.stoppingRules.pauseOnExposureMultiple}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    stoppingRules: {
                      ...d.stoppingRules,
                      pauseOnExposureMultiple: Number(e.target.value),
                    },
                  }))
                }
                className={INPUT_CLS}
              />
            </FieldGroup>
            <FieldGroup label="Additional rules (free text)">
              <Textarea
                rows={2}
                value={design.stoppingRules.additionalRules}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    stoppingRules: {
                      ...d.stoppingRules,
                      additionalRules: e.target.value,
                    },
                  }))
                }
                placeholder="e.g. ALT/AST > 5×ULN; QTcF > 500 ms"
                className={INPUT_CLS + " resize-none"}
              />
            </FieldGroup>
          </DesignSection>

          {/* ── 8. IND-enabling gate / Override ────────────────────── */}
          <DesignSection
            icon={KeyRound}
            label="IND-enabling Gate"
            disabled={!pkg}
          >
            {pkg && indGate && (
              <div
                className={
                  "rounded-md border p-2.5 text-[10px] leading-snug " +
                  (indGate.pass
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-200")
                }
              >
                <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                  {indGate.pass ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <AlertTriangle className="w-3 h-3" />
                  )}
                  {indGate.pass ? "Gate OPEN" : "Gate CLOSED"}
                </div>
                {indGate.reason}
              </div>
            )}
            {pkg && !pkg.animalCohort.indEnablingComplete && (
              <>
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={design.indGateOverride.active}
                    onChange={(e) =>
                      setDesign((d) => ({
                        ...d,
                        indGateOverride: {
                          ...d.indGateOverride,
                          active: e.target.checked,
                        },
                      }))
                    }
                    className="accent-violet-500"
                  />
                  Apply override
                </label>
                {design.indGateOverride.active && (
                  <FieldGroup
                    label="Justification (≥ 20 chars)"
                    required
                    hint={`${design.indGateOverride.justification.length}`}
                  >
                    <Textarea
                      rows={2}
                      value={design.indGateOverride.justification}
                      onChange={(e) =>
                        setDesign((d) => ({
                          ...d,
                          indGateOverride: {
                            ...d.indGateOverride,
                            justification: e.target.value,
                          },
                        }))
                      }
                      placeholder="e.g. partial L4 sufficient: chronic-tox 28-day complete; 90-day on-track and reviewed by IRB on 2026-04-12"
                      className={INPUT_CLS + " resize-none"}
                    />
                  </FieldGroup>
                )}
              </>
            )}
          </DesignSection>
        </div>

        {/* Emit button */}
        <div className="p-5 border-t border-white/8 mt-auto">
          <Button
            onClick={handleEmitPlan}
            disabled={
              !pkg ||
              !indGate ||
              !indGate.pass ||
              !dose ||
              !dose.ok
            }
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold h-10 gap-2 text-[13px] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" /> Emit Phase 1 Protocol
          </Button>
          <p className="text-[10px] text-slate-600 text-center mt-2 leading-snug">
            {!pkg
              ? "Load an upstream §8 package first."
              : !indGate?.pass
                ? "IND gate closed — fix or override above."
                : !dose?.ok
                  ? "Starting dose method refused — see right panel."
                  : "Ready. Emits a typed Phase1Plan."}
          </p>
        </div>
      </div>

      {/* RIGHT — Output */}
      <div className="flex-1 overflow-y-auto p-6">
        {pkg === null && <Phase1EmptyState />}
        {pkg !== null && (
          <Phase1PlanOutput
            pkg={pkg}
            dose={dose}
            escalation={escalation}
            indGate={indGate!}
            subGates={subGates!}
            design={design}
            planEmitted={planEmitted}
          />
        )}
      </div>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────

function DesignSection({
  icon,
  label,
  disabled,
  children,
}: {
  icon: typeof Beaker;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={disabled ? "opacity-40 pointer-events-none select-none" : ""}
    >
      <SectionHeader
        icon={icon}
        label={label}
        rightSlot={
          disabled ? (
            <span className="text-[8px] uppercase tracking-wider text-slate-600">
              awaiting §8
            </span>
          ) : null
        }
      />
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ── Upstream entry sub-panes ───────────────────────────────────────────────

function ApiImportPane({
  jsonText,
  setJsonText,
  importError,
  onValidate,
}: {
  jsonText: string;
  setJsonText: (v: string) => void;
  importError: string | null;
  onValidate: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">
        PreClinicalPackage JSON
      </div>
      <Textarea
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        spellCheck={false}
        rows={8}
        placeholder={
          '{\n  "schemaVersion": "1.0.0",\n  "compound": {...},\n  "inVitro": {...},\n  "inSilico": {...},\n  "animalCohort": {...},\n  "cypTransporterPanel": null,\n  "clearanceFractions": null,\n  "provenance": {...}\n}'
        }
        className="bg-white/5 border-violet-500/20 text-white text-[11px] font-mono focus:border-violet-500/60 resize-none"
      />
      <Button
        onClick={onValidate}
        className="w-full h-8 bg-violet-600/30 border border-violet-500/40 text-violet-200 hover:bg-violet-600/40 text-[11px] font-semibold gap-1.5"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        Validate & Activate Package
      </Button>
      {importError && (
        <div className="flex items-start gap-1.5 text-[10px] text-red-400 leading-snug bg-red-500/5 border border-red-500/20 rounded p-2">
          <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{importError}</span>
        </div>
      )}
      <div className="flex items-start gap-1.5 text-[9px] text-slate-500 leading-snug">
        <Badge className="text-[8px] px-1 py-0 bg-violet-500/20 text-violet-300 border-violet-500/30">
          Hakase Ecosystem
        </Badge>
        <span>
          §8 PreClinicalPackage handoff v1.0.0 — emitted by BioDigital Twin Layer 4
        </span>
      </div>
    </div>
  );
}

function ManualEntryPane({
  manual,
  setManualField,
  activeTemplate,
  onBuild,
  errors,
}: {
  manual: ManualPackageInput;
  setManualField: <K extends keyof ManualPackageInput>(
    k: K,
    v: ManualPackageInput[K],
  ) => void;
  activeTemplate: string | null;
  onBuild: () => void;
  errors: string[];
}) {
  return (
    <div className="space-y-4">
      {activeTemplate && (
        <div className="flex items-start gap-1.5 text-[10px] text-violet-300 bg-violet-500/5 border border-violet-500/20 rounded p-2">
          <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Pre-filled from template — identity only. Clinical numbers below
            still required.
          </span>
        </div>
      )}

      <SubSection icon={Atom} label="Compound">
        <FieldGroup label="SMILES" required>
          <Input
            value={manual.smiles}
            onChange={(e) => setManualField("smiles", e.target.value)}
            placeholder="CC(C)Cc1ccc(cc1)C(C)C(=O)O"
            className={INPUT_CLS + " font-mono"}
          />
        </FieldGroup>
        <FieldGroup label="Preferred name">
          <Input
            value={manual.preferredName}
            onChange={(e) => setManualField("preferredName", e.target.value)}
            className={INPUT_CLS}
          />
        </FieldGroup>
        <div className="grid grid-cols-2 gap-2">
          <FieldGroup label="ChEMBL ID">
            <Input
              value={manual.chemblId}
              onChange={(e) => setManualField("chemblId", e.target.value)}
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="MW (g/mol)">
            <Input
              value={manual.molecularWeight}
              onChange={(e) =>
                setManualField("molecularWeight", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
        </div>
        <FieldGroup label="InChIKey">
          <Input
            value={manual.inchiKey}
            onChange={(e) => setManualField("inchiKey", e.target.value)}
            className={INPUT_CLS + " font-mono"}
          />
        </FieldGroup>
      </SubSection>

      <SubSection icon={TestTube2} label="L1 in vitro (optional)">
        <div className="grid grid-cols-2 gap-2">
          <FieldGroup label="hERG IC₅₀ (µM)">
            <Input
              value={manual.hergIc50UM}
              onChange={(e) => setManualField("hergIc50UM", e.target.value)}
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="Caco-2 (10⁻⁶ cm/s)">
            <Input
              value={manual.caco2Permeability}
              onChange={(e) =>
                setManualField("caco2Permeability", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="PPB (fraction)">
            <Input
              value={manual.plasmaProteinBindingFraction}
              onChange={(e) =>
                setManualField(
                  "plasmaProteinBindingFraction",
                  e.target.value,
                )
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="Target IC₅₀ (nM)">
            <Input
              value={manual.primaryTargetIc50nM}
              onChange={(e) =>
                setManualField("primaryTargetIc50nM", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
        </div>
      </SubSection>

      <SubSection icon={Dna} label="Primary target">
        <div className="grid grid-cols-2 gap-2">
          <FieldGroup label="UniProt">
            <Input
              value={manual.primaryTargetUniprot}
              onChange={(e) =>
                setManualField("primaryTargetUniprot", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="Gene symbol">
            <Input
              value={manual.primaryTargetGeneSymbol}
              onChange={(e) =>
                setManualField("primaryTargetGeneSymbol", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
        </div>
      </SubSection>

      <SubSection icon={Sparkles} label="L2 in silico (optional)">
        <div className="grid grid-cols-2 gap-2">
          <FieldGroup label="Cmax (ng/mL)">
            <Input
              value={manual.humanProjectedCmaxNgPerMl}
              onChange={(e) =>
                setManualField("humanProjectedCmaxNgPerMl", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="AUC (ng·h/mL)">
            <Input
              value={manual.humanProjectedAucNgHPerMl}
              onChange={(e) =>
                setManualField("humanProjectedAucNgHPerMl", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="t½ (h)">
            <Input
              value={manual.humanProjectedHalfLifeHours}
              onChange={(e) =>
                setManualField(
                  "humanProjectedHalfLifeHours",
                  e.target.value,
                )
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="CL (L/h/kg)">
            <Input
              value={manual.humanProjectedClearanceLPerHPerKg}
              onChange={(e) =>
                setManualField(
                  "humanProjectedClearanceLPerHPerKg",
                  e.target.value,
                )
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
        </div>
      </SubSection>

      <SubSection icon={HeartPulse} label="L4 animal cohort (required)">
        <div className="grid grid-cols-2 gap-2">
          <FieldGroup label="Species id" required>
            <Input
              value={manual.speciesId}
              onChange={(e) => setManualField("speciesId", e.target.value)}
              placeholder="rat"
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="Species display" required>
            <Input
              value={manual.speciesDisplayName}
              onChange={(e) =>
                setManualField("speciesDisplayName", e.target.value)
              }
              placeholder="Sprague-Dawley Rat"
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="Study type id" required>
            <Input
              value={manual.studyTypeId}
              onChange={(e) => setManualField("studyTypeId", e.target.value)}
              placeholder="28-day-tox"
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="Study type label" required>
            <Input
              value={manual.studyTypeLabel}
              onChange={(e) =>
                setManualField("studyTypeLabel", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
        </div>
        <FieldGroup label="Route of administration" required>
          <Input
            value={manual.routeOfAdministration}
            onChange={(e) =>
              setManualField("routeOfAdministration", e.target.value)
            }
            placeholder="oral"
            className={INPUT_CLS}
          />
        </FieldGroup>
        <div className="grid grid-cols-2 gap-2">
          <FieldGroup label="NOAEL (mg/kg)" required>
            <Input
              value={manual.noaelMgPerKg}
              onChange={(e) => setManualField("noaelMgPerKg", e.target.value)}
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="MTD (mg/kg)" required>
            <Input
              value={manual.mtdMgPerKg}
              onChange={(e) => setManualField("mtdMgPerKg", e.target.value)}
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="FIH dose (mg)" required>
            <Input
              value={manual.fihDoseMg}
              onChange={(e) => setManualField("fihDoseMg", e.target.value)}
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="FIH (mg/kg)" required>
            <Input
              value={manual.fihDoseMgPerKg}
              onChange={(e) =>
                setManualField("fihDoseMgPerKg", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="HED-BSA (mg/kg)" required>
            <Input
              value={manual.hedBsaMgPerKg}
              onChange={(e) =>
                setManualField("hedBsaMgPerKg", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
          <FieldGroup label="HED-PBPK (mg/kg)" required>
            <Input
              value={manual.hedPbpkMgPerKg}
              onChange={(e) =>
                setManualField("hedPbpkMgPerKg", e.target.value)
              }
              className={INPUT_CLS}
            />
          </FieldGroup>
        </div>
        <FieldGroup label="Safety margin (NOAEL ratio)" required>
          <Input
            value={manual.safetyMarginNoael}
            onChange={(e) =>
              setManualField("safetyMarginNoael", e.target.value)
            }
            className={INPUT_CLS}
          />
        </FieldGroup>
        <FieldGroup label="Overall risk" required>
          <ChoicePills
            value={manual.overallRisk}
            options={[
              { value: "low", label: "Low" },
              { value: "moderate", label: "Moderate" },
              { value: "high", label: "High" },
            ]}
            onChange={(v) => setManualField("overallRisk", v)}
          />
        </FieldGroup>
      </SubSection>

      <div className="flex items-start gap-1.5 text-[9px] text-slate-500 bg-white/[0.02] border border-white/8 rounded p-2 leading-snug">
        <Info className="w-3 h-3 mt-0.5 shrink-0 text-slate-500" />
        <span>
          Manual entry always emits §6.1.a CYP/Transporter panel and §6.1.b
          clearance fractions as <code>null</code>. Phase 1 DDI &amp; Special-Pop
          modules will refuse to run on a manually-built package — by design.
        </span>
      </div>

      {errors.length > 0 && (
        <div className="text-[10px] text-red-400 bg-red-500/5 border border-red-500/20 rounded p-2 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <XCircle className="w-3 h-3" /> Cannot build package:
          </div>
          <ul className="list-disc pl-4 space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <Button
        onClick={onBuild}
        className="w-full h-8 bg-violet-600/30 border border-violet-500/40 text-violet-200 hover:bg-violet-600/40 text-[11px] font-semibold gap-1.5"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        Build &amp; Activate Package
      </Button>
    </div>
  );
}

function SubSection({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Beaker;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3 text-slate-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>
      <div className="space-y-2 pl-4 border-l border-white/5">{children}</div>
    </div>
  );
}

// ── Output panel ───────────────────────────────────────────────────────────

function Phase1EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Beaker className="w-7 h-7 text-violet-400/50" />
        </div>
        <div className="text-center">
          <div className="text-[14px] font-medium text-slate-400">
            No PreClinicalPackage loaded
          </div>
          <div className="text-[11px] text-slate-600 mt-1 max-w-xs">
            Load an upstream §8 handoff (Import via API or Manual upstream entry
            in the card on the left) before configuring Phase 1 design.
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 max-w-2xl w-full">
        <ModuleChip
          title="FIH Dose"
          subtitle="MABEL · NOAEL/HED · safety-margin gate"
        />
        <ModuleChip
          title="DDI Module"
          subtitle="Requires §6.1.a CYP/Transporter panel"
        />
        <ModuleChip
          title="Special-Pop"
          subtitle="Requires §6.1.b clearance fractions"
        />
      </div>
    </div>
  );
}

function ModuleChip({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="text-[12px] font-semibold text-violet-300">{title}</div>
      <div className="text-[10px] text-slate-500 mt-1 leading-snug">
        {subtitle}
      </div>
    </div>
  );
}

function Phase1PlanOutput({
  pkg,
  dose,
  escalation,
  indGate,
  subGates,
  design,
  planEmitted,
}: {
  pkg: PreClinicalPackage;
  dose: StartingDoseResult | null;
  escalation: EscalationResult | null;
  indGate: IndGateStatus;
  subGates: ReturnType<typeof gateSubStudies>;
  design: Phase1Design;
  planEmitted: boolean;
}) {
  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b border-white/8">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <h2 className="text-[14px] font-semibold text-white">
          Phase 1 Plan Preview · §8 v{pkg.schemaVersion}
        </h2>
        <span className="text-[10px] text-slate-500 ml-auto">
          {pkg.compound.preferredName ?? "(no name)"} ·{" "}
          {pkg.provenance.emitterEngine}
        </span>
      </div>

      {/* Top row: Starting dose + IND gate */}
      <div className="grid grid-cols-2 gap-3">
        <OutCard title="Starting Dose">
          {dose && dose.ok && dose.doseMg !== null && dose.doseMgPerKg !== null ? (
            <>
              <div className="flex items-baseline gap-2">
                <div className="text-[22px] font-semibold text-violet-200 tabular-nums">
                  {dose.doseMg.toFixed(3)}
                </div>
                <div className="text-[11px] text-slate-500">mg total</div>
              </div>
              <div className="text-[11px] text-slate-400 tabular-nums">
                {dose.doseMgPerKg.toFixed(5)} mg/kg @{" "}
                {design.startingDose.bodyWeightKg} kg
              </div>
              <p className="text-[10px] text-slate-500 mt-2 leading-snug">
                {dose.rationale}
              </p>
              {dose.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-1.5 text-[10px] text-amber-300 mt-2 bg-amber-500/5 border border-amber-500/20 rounded p-2 leading-snug"
                >
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  {w}
                </div>
              ))}
            </>
          ) : (
            <NullCallout
              label="Method refused"
              detail={dose?.refuseReason ?? "Compute pending."}
            />
          )}
        </OutCard>

        <OutCard title="IND-enabling Gate">
          <div
            className={
              "rounded-md border p-3 text-[11px] leading-snug " +
              (indGate.pass
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                : "border-amber-500/30 bg-amber-500/5 text-amber-200")
            }
          >
            <div className="flex items-center gap-1.5 font-semibold mb-1 text-[12px]">
              {indGate.pass ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
              {indGate.pass ? "Gate OPEN" : "Gate CLOSED"}
            </div>
            {indGate.reason}
          </div>
          {planEmitted && indGate.pass && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-300 mt-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Phase 1 protocol emitted (preview).
            </div>
          )}
        </OutCard>
      </div>

      {/* Escalation table */}
      <OutCard title={`SAD Escalation (${design.sad.escalationScheme})`}>
        {escalation && escalation.ok && escalation.levels.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums">
              <thead>
                <tr className="text-slate-500 text-[10px] uppercase tracking-wider">
                  <th className="text-left py-1.5 pr-3">#</th>
                  <th className="text-right py-1.5 pr-3">Dose (mg)</th>
                  <th className="text-right py-1.5 pr-3">mg/kg</th>
                  <th className="text-right py-1.5 pr-3">×Prev</th>
                  <th className="text-right py-1.5">Cohort</th>
                </tr>
              </thead>
              <tbody>
                {escalation.levels.map((l) => (
                  <tr
                    key={l.index}
                    className="border-t border-white/5 text-slate-300"
                  >
                    <td className="py-1.5 pr-3 text-slate-500">L{l.index}</td>
                    <td className="text-right py-1.5 pr-3">
                      {l.doseMg.toFixed(3)}
                    </td>
                    <td className="text-right py-1.5 pr-3 text-slate-400">
                      {l.doseMgPerKg.toFixed(5)}
                    </td>
                    <td className="text-right py-1.5 pr-3 text-slate-500">
                      {l.factorFromPrev === null
                        ? "—"
                        : `${l.factorFromPrev.toFixed(2)}×`}
                    </td>
                    <td className="text-right py-1.5 text-slate-500">
                      {design.sad.cohortSize}
                      {design.sad.sentinelDosing ? " + sentinel" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {escalation.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 text-[10px] text-amber-300 mt-2"
              >
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {w}
              </div>
            ))}
          </div>
        ) : (
          <NullCallout
            label="Escalation pending"
            detail={
              escalation?.refuseReason ??
              "Resolve starting dose first, then set max planned dose (or manual levels)."
            }
          />
        )}
      </OutCard>

      {/* Sub-study gates */}
      <OutCard title="Sub-study Feasibility (gated on §8 inputs)">
        <div className="grid grid-cols-2 gap-2">
          <SubGateRow
            label="Food-effect"
            requested={design.subStudies.foodEffect}
            gate={subGates.foodEffect}
          />
          <SubGateRow
            label="DDI cocktail"
            requested={design.subStudies.ddiCocktail}
            gate={subGates.ddiCocktail}
          />
          <SubGateRow
            label="TQT"
            requested={design.subStudies.tqtRequired}
            gate={subGates.tqtAdvised}
          />
          <SubGateRow
            label="Renal-impairment arm"
            requested={design.subStudies.renalImpairment}
            gate={subGates.renalArm}
          />
          <SubGateRow
            label="Hepatic-impairment arm"
            requested={design.subStudies.hepaticImpairment}
            gate={subGates.hepaticArm}
          />
        </div>
      </OutCard>

      {/* MAD summary */}
      {design.mad.enabled && (
        <OutCard title="MAD Arm">
          <div className="grid grid-cols-4 gap-2 text-[11px]">
            <Stat label="Duration" v={`${design.mad.durationDays} d`} />
            <Stat label="Cohort" v={String(design.mad.cohortSize)} />
            <Stat
              label="Acc. ratio target"
              v={String(design.mad.accumulationRatioTarget)}
            />
            <Stat
              label="Carry-fwd SAD L"
              v={`L${design.mad.carryForwardLowest}`}
            />
          </div>
        </OutCard>
      )}

      {/* Package summary */}
      <div className="grid grid-cols-2 gap-3">
        <OutCard title="Compound">
          <Kv k="SMILES" v={pkg.compound.smiles} mono />
          <Kv k="MW (g/mol)" v={fmt(pkg.compound.molecularWeight)} />
          <Kv k="ChEMBL" v={pkg.compound.chemblId} />
        </OutCard>
        <OutCard title="L4 Cohort">
          <Kv
            k="Species"
            v={`${pkg.animalCohort.speciesDisplayName} (${pkg.animalCohort.speciesId})`}
          />
          <Kv k="NOAEL (mg/kg)" v={fmt(pkg.animalCohort.noaelMgPerKg)} />
          <Kv k="MTD (mg/kg)" v={fmt(pkg.animalCohort.mtdMgPerKg)} />
          <Kv k="HED-BSA" v={fmt(pkg.animalCohort.hedBsaMgPerKg)} />
          <Kv k="HED-PBPK" v={fmt(pkg.animalCohort.hedPbpkMgPerKg)} />
          <Kv
            k="Safety margin"
            v={fmt(pkg.animalCohort.safetyMarginNoael)}
          />
          <Kv k="Overall risk" v={pkg.animalCohort.overallRisk} />
          <Kv
            k="IND-enabling"
            v={pkg.animalCohort.indEnablingComplete ? "complete" : "incomplete"}
          />
        </OutCard>
      </div>

      {/* §6.1.a / §6.1.b */}
      <OutCard title="§6.1.a — CYP / Transporter Panel">
        {pkg.cypTransporterPanel === null ? (
          <NullCallout
            label="Panel unavailable"
            detail="Phase 1 DDI module requires an in-vitro CYP/transporter panel. Re-emit from a BioDigital Twin run with ML CYP probes."
          />
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <Kv
              k="CYP1A2 inhib (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp1a2InhibitionProb)}
            />
            <Kv
              k="P-gp inhib (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.pgpInhibitionProb)}
            />
            <Kv
              k="CYP3A4 inhib (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp3a4InhibitionProb)}
            />
            <Kv
              k="OATP1B1 inhib (P)"
              v={fmt(
                pkg.cypTransporterPanel.transporters.oatp1b1InhibitionProb,
              )}
            />
          </div>
        )}
      </OutCard>

      <OutCard title="§6.1.b — Renal vs Hepatic Clearance Fractions">
        {pkg.clearanceFractions === null ? (
          <NullCallout
            label="Clearance fractions unavailable"
            detail="Special-Pop arm planning blocked until route-fractional CL is provided."
          />
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              <FractionPill
                label="Renal"
                v={pkg.clearanceFractions.renalFraction}
              />
              <FractionPill
                label="Hepatic"
                v={pkg.clearanceFractions.hepaticFraction}
              />
              <FractionPill
                label="Biliary"
                v={pkg.clearanceFractions.biliaryFraction}
              />
              <FractionPill
                label="Other"
                v={pkg.clearanceFractions.otherFraction}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-3 leading-snug">
              {pkg.clearanceFractions.basis}
            </p>
          </>
        )}
      </OutCard>

      {/* Provenance */}
      <OutCard title="Provenance">
        <Kv k="Emitted at" v={pkg.provenance.emittedAt} />
        <Kv
          k="Emitter"
          v={`${pkg.provenance.emitterEngine} v${pkg.provenance.emitterVersion}`}
        />
        {pkg.provenance.warnings.length > 0 && (
          <div className="pt-3 mt-2 border-t border-white/5 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              Warnings ({pkg.provenance.warnings.length})
            </div>
            {pkg.provenance.warnings.map((w, i) => (
              <p
                key={i}
                className="text-[10px] text-amber-300/90 leading-snug"
              >
                · {w}
              </p>
            ))}
          </div>
        )}
      </OutCard>
    </div>
  );
}

function SubGateRow({
  label,
  requested,
  gate,
}: {
  label: string;
  requested: boolean;
  gate: { feasible: boolean; reason: string };
}) {
  const tone = !requested
    ? "border-white/8 text-slate-500"
    : gate.feasible
      ? "border-emerald-500/30 text-emerald-200"
      : "border-red-500/30 text-red-300";
  return (
    <div className={"rounded-md border p-2.5 bg-white/[0.02] " + tone}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold">
        {!requested ? (
          <span className="w-3 h-3 rounded-full border border-current opacity-50" />
        ) : gate.feasible ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : (
          <XCircle className="w-3 h-3" />
        )}
        {label}
        {!requested && (
          <span className="text-[9px] uppercase ml-auto opacity-60">
            not requested
          </span>
        )}
      </div>
      <p className="text-[10px] mt-1 leading-snug opacity-80">{gate.reason}</p>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-[13px] font-semibold text-white tabular-nums mt-0.5">
        {v}
      </div>
    </div>
  );
}

function OutCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-4">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2.5">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Kv({
  k,
  v,
  mono,
}: {
  k: string;
  v: string | number | null;
  mono?: boolean;
}) {
  const empty = v === null || v === undefined || v === "";
  const display = empty ? "—" : String(v);
  return (
    <div className="grid grid-cols-12 gap-2 text-[11px] items-baseline">
      <div className="col-span-5 text-slate-500 truncate">{k}</div>
      <div
        className={
          "col-span-7 truncate " +
          (mono ? "font-mono " : "") +
          (empty ? "text-slate-600 italic" : "text-slate-200")
        }
        title={display}
      >
        {display}
      </div>
    </div>
  );
}

function FractionPill({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-[14px] font-semibold text-white tabular-nums mt-0.5">
        {(v * 100).toFixed(1)}%
      </div>
    </div>
  );
}

function NullCallout({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5" /> {label}
      </div>
      <p className="text-[11px] text-amber-200/80 mt-1 leading-snug">
        {detail}
      </p>
    </div>
  );
}

function fmt(v: number | string | null): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) {
      return v.toExponential(3);
    }
    return v.toFixed(3);
  }
  return v;
}
