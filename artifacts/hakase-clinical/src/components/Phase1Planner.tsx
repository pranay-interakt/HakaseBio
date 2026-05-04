import { useState, useRef, useEffect } from "react";
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

export interface Phase1PlannerHandle {
  applyTemplatePartial: (partial: Partial<ManualPackageInput>, templateId: string) => void;
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

// ── Tiny shared primitives mirroring HakaseAI Layer 1 ───────────────────────

function SectionHeader({
  icon: Icon,
  label,
}: {
  icon: typeof Beaker;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-slate-500" />
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">
        {label}
      </span>
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
        <Label className="text-[11px] text-slate-400 font-medium">
          {label}
        </Label>
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

// ── Main planner ────────────────────────────────────────────────────────────

export default function Phase1Planner({
  pkg,
  importError,
  onPackageReady,
  onImportError,
  registerHandle,
  jumpToApiSignal,
}: Props) {
  // Manual entry state (form is always visible — primary input mode)
  const [manual, setManual] = useState<ManualPackageInput>(EMPTY_MANUAL_INPUT);
  const [manualErrors, setManualErrors] = useState<string[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);

  // Import via API (collapsible card — like Diagen in Layer 1)
  const [apiOpen, setApiOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const apiCardRef = useRef<HTMLDivElement | null>(null);

  const setManualField = <K extends keyof ManualPackageInput>(
    k: K,
    v: ManualPackageInput[K],
  ) => setManual((p) => ({ ...p, [k]: v }));

  // Expose imperative handle to parent (for Projects rail interactions)
  useEffect(() => {
    registerHandle({
      applyTemplatePartial: (partial, templateId) => {
        setManual((p) => ({ ...p, ...partial }));
        setActiveTemplate(templateId);
        setManualErrors([]);
        onImportError(null);
        onPackageReady(null);
        setApiOpen(false);
      },
      reset: () => {
        setManual(EMPTY_MANUAL_INPUT);
        setActiveTemplate(null);
        setManualErrors([]);
        setJsonText("");
        setApiOpen(false);
        onImportError(null);
        onPackageReady(null);
      },
      openApi: () => {
        setApiOpen(true);
        setTimeout(() => {
          apiCardRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 50);
      },
    });
  }, [registerHandle, onImportError, onPackageReady]);

  // External "open API" trigger from Projects rail
  useEffect(() => {
    if (jumpToApiSignal === 0) return;
    setApiOpen(true);
    setTimeout(() => {
      apiCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }, [jumpToApiSignal]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleValidateJson = () => {
    onImportError(null);
    onPackageReady(null);
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
        "JSON does not match PreClinicalPackage v1.0.0 shape. Required " +
          "fields are missing or wrong type. The §6.1 sub-payloads " +
          "(cypTransporterPanel, clearanceFractions) MUST be present as " +
          "either a valid object or null — undefined is rejected.",
      );
      return;
    }
    onPackageReady(parsed);
  };

  const handleBuildManual = () => {
    onImportError(null);
    onPackageReady(null);
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

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex overflow-hidden h-full">
      {/* MIDDLE — Inputs (mirrors Layer 1's center input column) */}
      <div className="w-[460px] border-r border-white/8 overflow-y-auto flex flex-col bg-[#0b0d14] shrink-0">
        <div className="p-5 border-b border-white/8">
          <div className="flex items-center gap-2 mb-1">
            <Beaker className="w-4 h-4 text-violet-400" />
            <h2 className="text-[15px] font-semibold text-white">
              Phase 1 — FIH / SAD-MAD Planner
            </h2>
          </div>
          <p className="text-[11px] text-slate-500">
            Enter inputs manually, load a Starter Template from the left, or
            import via API/JSON
          </p>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {activeTemplate && (
            <div className="flex items-start gap-1.5 text-[10px] text-violet-300 bg-violet-500/5 border border-violet-500/20 rounded p-2">
              <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                Pre-filled from template — identity only. All clinical numbers
                must still be supplied below.
              </span>
            </div>
          )}

          {/* Compound */}
          <section>
            <SectionHeader icon={Atom} label="Compound Identity" />
            <div className="space-y-3">
              <FieldGroup label="SMILES" required>
                <Input
                  value={manual.smiles}
                  onChange={(e) => setManualField("smiles", e.target.value)}
                  placeholder="e.g. CC(C)Cc1ccc(cc1)C(C)C(=O)O"
                  className={INPUT_CLS + " font-mono"}
                />
              </FieldGroup>
              <FieldGroup label="Preferred Name">
                <Input
                  value={manual.preferredName}
                  onChange={(e) =>
                    setManualField("preferredName", e.target.value)
                  }
                  placeholder="e.g. Compound-XYZ-001"
                  className={INPUT_CLS}
                />
              </FieldGroup>
              <div className="grid grid-cols-2 gap-2">
                <FieldGroup label="ChEMBL ID">
                  <Input
                    value={manual.chemblId}
                    onChange={(e) => setManualField("chemblId", e.target.value)}
                    placeholder="CHEMBLxxx"
                    className={INPUT_CLS}
                  />
                </FieldGroup>
                <FieldGroup label="MW (g/mol)">
                  <Input
                    value={manual.molecularWeight}
                    onChange={(e) =>
                      setManualField("molecularWeight", e.target.value)
                    }
                    placeholder="206.28"
                    className={INPUT_CLS}
                  />
                </FieldGroup>
              </div>
              <FieldGroup label="InChIKey">
                <Input
                  value={manual.inchiKey}
                  onChange={(e) => setManualField("inchiKey", e.target.value)}
                  placeholder="HEFNNWSXXWATRW-UHFFFAOYSA-N"
                  className={INPUT_CLS + " font-mono"}
                />
              </FieldGroup>
            </div>
          </section>

          {/* Import via API — collapsible violet card (Diagen pattern) */}
          <div
            ref={apiCardRef}
            className="border border-violet-500/30 rounded-lg overflow-hidden bg-violet-950/20"
          >
            <button
              onClick={() => {
                setApiOpen((v) => !v);
                onImportError(null);
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-violet-500/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shrink-0">
                  <Globe className="w-3 h-3 text-white" />
                </div>
                <div className="text-left">
                  <div className="text-[11px] font-semibold text-violet-200">
                    Import from BioDigital Twin
                  </div>
                  <div className="text-[9px] text-violet-400/70 leading-tight">
                    §8 PreClinicalPackage handoff · v1.0.0
                  </div>
                </div>
                <Badge className="text-[9px] px-1.5 py-0 bg-violet-500/20 text-violet-300 border-violet-500/30 ml-1">
                  Hakase Ecosystem
                </Badge>
              </div>
              {apiOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-violet-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-violet-400" />
              )}
            </button>
            {apiOpen && (
              <div className="px-3 pb-3 pt-3 space-y-2 border-t border-violet-500/15">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">
                  PreClinicalPackage JSON
                </div>
                <Textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    onImportError(null);
                  }}
                  spellCheck={false}
                  rows={8}
                  placeholder={
                    '{\n  "schemaVersion": "1.0.0",\n  "compound": {...},\n  "inVitro": {...},\n  "inSilico": {...},\n  "animalCohort": {...},\n  "cypTransporterPanel": null,\n  "clearanceFractions": null,\n  "provenance": {...}\n}'
                  }
                  className="bg-white/5 border-violet-500/20 text-white text-[11px] font-mono focus:border-violet-500/60 resize-none"
                />
                <Button
                  onClick={handleValidateJson}
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
              </div>
            )}
          </div>

          {/* L1 In Vitro (optional) */}
          <section>
            <SectionHeader icon={TestTube2} label="L1 In Vitro (optional)" />
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <FieldGroup label="hERG IC₅₀ (µM)">
                  <Input
                    value={manual.hergIc50UM}
                    onChange={(e) =>
                      setManualField("hergIc50UM", e.target.value)
                    }
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
            </div>
          </section>

          {/* Target */}
          <section>
            <SectionHeader icon={Dna} label="Primary Target" />
            <div className="grid grid-cols-2 gap-2">
              <FieldGroup label="UniProt">
                <Input
                  value={manual.primaryTargetUniprot}
                  onChange={(e) =>
                    setManualField("primaryTargetUniprot", e.target.value)
                  }
                  placeholder="P23219"
                  className={INPUT_CLS}
                />
              </FieldGroup>
              <FieldGroup label="Gene symbol">
                <Input
                  value={manual.primaryTargetGeneSymbol}
                  onChange={(e) =>
                    setManualField("primaryTargetGeneSymbol", e.target.value)
                  }
                  placeholder="PTGS1"
                  className={INPUT_CLS}
                />
              </FieldGroup>
            </div>
          </section>

          {/* L2 In Silico */}
          <section>
            <SectionHeader
              icon={Sparkles}
              label="L2 In Silico Human Projections (optional)"
            />
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
          </section>

          {/* L4 Animal Cohort — REQUIRED */}
          <section>
            <SectionHeader
              icon={HeartPulse}
              label="L4 Animal Cohort (required)"
            />
            <div className="space-y-3">
              <FieldGroup label="Species (id / display)" required>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={manual.speciesId}
                    onChange={(e) =>
                      setManualField("speciesId", e.target.value)
                    }
                    placeholder="rat"
                    className={INPUT_CLS}
                  />
                  <Input
                    value={manual.speciesDisplayName}
                    onChange={(e) =>
                      setManualField("speciesDisplayName", e.target.value)
                    }
                    placeholder="Sprague-Dawley Rat"
                    className={INPUT_CLS}
                  />
                </div>
              </FieldGroup>
              <FieldGroup label="Study type (id / label)" required>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={manual.studyTypeId}
                    onChange={(e) =>
                      setManualField("studyTypeId", e.target.value)
                    }
                    placeholder="28-day-tox"
                    className={INPUT_CLS}
                  />
                  <Input
                    value={manual.studyTypeLabel}
                    onChange={(e) =>
                      setManualField("studyTypeLabel", e.target.value)
                    }
                    placeholder="28-day repeat-dose toxicology"
                    className={INPUT_CLS}
                  />
                </div>
              </FieldGroup>
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
                    onChange={(e) =>
                      setManualField("noaelMgPerKg", e.target.value)
                    }
                    className={INPUT_CLS}
                  />
                </FieldGroup>
                <FieldGroup label="MTD (mg/kg)" required>
                  <Input
                    value={manual.mtdMgPerKg}
                    onChange={(e) =>
                      setManualField("mtdMgPerKg", e.target.value)
                    }
                    className={INPUT_CLS}
                  />
                </FieldGroup>
                <FieldGroup label="FIH dose (mg)" required>
                  <Input
                    value={manual.fihDoseMg}
                    onChange={(e) =>
                      setManualField("fihDoseMg", e.target.value)
                    }
                    className={INPUT_CLS}
                  />
                </FieldGroup>
                <FieldGroup label="FIH dose (mg/kg)" required>
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
                <div className="grid grid-cols-3 gap-1.5">
                  {(["low", "moderate", "high"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setManualField("overallRisk", r)}
                      className={
                        "py-1.5 px-2 rounded text-[10px] font-semibold uppercase border transition-all " +
                        (manual.overallRisk === r
                          ? r === "low"
                            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                            : r === "moderate"
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                              : "bg-red-500/15 border-red-500/40 text-red-300"
                          : "border-white/10 text-slate-500 hover:border-white/20")
                      }
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </FieldGroup>
            </div>
          </section>

          {/* Manual entry footnote */}
          <div className="flex items-start gap-1.5 text-[9px] text-slate-500 bg-white/[0.02] border border-white/8 rounded p-2 leading-snug">
            <Info className="w-3 h-3 mt-0.5 shrink-0 text-slate-500" />
            <span>
              Manual entry always emits §6.1.a CYP/Transporter panel and §6.1.b
              clearance fractions as <code>null</code>. Phase 1 DDI &
              Special-Pop modules will refuse to run on a manually-built
              package — by design, per the no-fake-data policy.
            </span>
          </div>

          {manualErrors.length > 0 && (
            <div className="text-[10px] text-red-400 bg-red-500/5 border border-red-500/20 rounded p-2 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <XCircle className="w-3 h-3" /> Cannot build package:
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {manualErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {pkg !== null && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded p-2">
              <CheckCircle2 className="w-3 h-3" />
              Package activated — see analysis on the right.
            </div>
          )}
        </div>

        {/* Run button — mirrors Layer 1 "Run In Vitro Simulation" */}
        <div className="p-5 border-t border-white/8 mt-auto">
          <Button
            onClick={handleBuildManual}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold h-10 gap-2 text-[13px]"
          >
            <Play className="w-4 h-4" /> Build & Activate Package
          </Button>
          <p className="text-[10px] text-slate-600 text-center mt-2">
            Required: SMILES + L4 cohort numbers · Identity-only via templates
            on the left
          </p>
        </div>
      </div>

      {/* RIGHT — Output */}
      <div className="flex-1 overflow-y-auto p-6">
        {pkg === null && <Phase1EmptyState />}
        {pkg !== null && <Phase1Output pkg={pkg} />}
      </div>
    </div>
  );
}

// ── Output panel ────────────────────────────────────────────────────────────

function Phase1EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
          <Beaker className="w-7 h-7 text-violet-400/50" />
        </div>
        <div className="text-center">
          <div className="text-[14px] font-medium text-slate-400">
            No PreClinical Package loaded
          </div>
          <div className="text-[11px] text-slate-600 mt-1 max-w-xs">
            Pick a Starter Template from the left, fill the form in the middle,
            or open Import via API to paste a BioDigital Twin §8 handoff.
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

function Phase1Output({ pkg }: { pkg: PreClinicalPackage }) {
  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-2 pb-3 border-b border-white/8">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <h2 className="text-[14px] font-semibold text-white">
          PreClinicalPackage v{pkg.schemaVersion} loaded
        </h2>
        <span className="text-[10px] text-slate-500 ml-auto">
          {pkg.compound.preferredName ?? "(no name)"} ·{" "}
          {pkg.provenance.emitterEngine}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <OutCard title="Compound">
          <Kv k="SMILES" v={pkg.compound.smiles} mono />
          <Kv k="MW (g/mol)" v={fmt(pkg.compound.molecularWeight)} />
          <Kv k="ChEMBL" v={pkg.compound.chemblId} />
          <Kv k="InChIKey" v={pkg.compound.inchiKey} mono />
        </OutCard>

        <OutCard title="L4 Animal Cohort">
          <Kv
            k="Species"
            v={`${pkg.animalCohort.speciesDisplayName} (${pkg.animalCohort.speciesId})`}
          />
          <Kv k="Study" v={pkg.animalCohort.studyTypeLabel} />
          <Kv k="Route" v={pkg.animalCohort.routeOfAdministration} />
          <Kv k="NOAEL (mg/kg)" v={fmt(pkg.animalCohort.noaelMgPerKg)} />
          <Kv k="MTD (mg/kg)" v={fmt(pkg.animalCohort.mtdMgPerKg)} />
          <Kv k="FIH (mg)" v={fmt(pkg.animalCohort.fihDoseMg)} />
          <Kv k="HED-PBPK" v={fmt(pkg.animalCohort.hedPbpkMgPerKg)} />
          <Kv
            k="Safety margin"
            v={fmt(pkg.animalCohort.safetyMarginNoael)}
          />
          <Kv k="Overall risk" v={pkg.animalCohort.overallRisk} />
        </OutCard>

        <OutCard title="L1 In Vitro">
          <Kv k="hERG IC₅₀ (µM)" v={fmt(pkg.inVitro.hergIc50UM)} />
          <Kv k="Caco-2" v={fmt(pkg.inVitro.caco2Permeability)} />
          <Kv
            k="PPB"
            v={fmt(pkg.inVitro.plasmaProteinBindingFraction)}
          />
          <Kv k="Target UniProt" v={pkg.inVitro.primaryTargetUniprot} />
          <Kv k="Target gene" v={pkg.inVitro.primaryTargetGeneSymbol} />
          <Kv
            k="Target IC₅₀ (nM)"
            v={fmt(pkg.inVitro.primaryTargetIc50nM)}
          />
        </OutCard>

        <OutCard title="L2 In Silico">
          <Kv
            k="Cmax (ng/mL)"
            v={fmt(pkg.inSilico.humanProjectedCmaxNgPerMl)}
          />
          <Kv
            k="AUC (ng·h/mL)"
            v={fmt(pkg.inSilico.humanProjectedAucNgHPerMl)}
          />
          <Kv k="t½ (h)" v={fmt(pkg.inSilico.humanProjectedHalfLifeHours)} />
          <Kv
            k="CL (L/h/kg)"
            v={fmt(pkg.inSilico.humanProjectedClearanceLPerHPerKg)}
          />
          <Kv
            k="FEP ΔΔG"
            v={fmt(pkg.inSilico.freeEnergyDdgKcalPerMol)}
          />
        </OutCard>
      </div>

      {/* §6.1.a panel */}
      <OutCard title="§6.1.a — CYP / Transporter Panel">
        {pkg.cypTransporterPanel === null ? (
          <NullCallout
            label="Panel unavailable"
            detail="Phase 1 DDI module requires an in-vitro CYP/transporter panel. Re-emit the package from a BioDigital Twin run that includes ML CYP probes (CYP1A2/2C9/2C19/2D6/3A4_Veith) + Pgp_Broccatelli."
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
              k="CYP2C9 inhib (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp2c9InhibitionProb)}
            />
            <Kv
              k="BCRP inhib (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.bcrpInhibitionProb)}
            />
            <Kv
              k="CYP2C19 inhib (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp2c19InhibitionProb)}
            />
            <Kv
              k="OATP1B1 inhib (P)"
              v={fmt(
                pkg.cypTransporterPanel.transporters.oatp1b1InhibitionProb,
              )}
            />
            <Kv
              k="CYP2D6 inhib (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp2d6InhibitionProb)}
            />
            <Kv
              k="OATP1B3 inhib (P)"
              v={fmt(
                pkg.cypTransporterPanel.transporters.oatp1b3InhibitionProb,
              )}
            />
            <Kv
              k="CYP3A4 inhib (P)"
              v={fmt(pkg.cypTransporterPanel.cyp.cyp3a4InhibitionProb)}
            />
            <Kv
              k="OCT2 inhib (P)"
              v={fmt(pkg.cypTransporterPanel.transporters.oct2InhibitionProb)}
            />
            <Kv
              k="Induction mRNA fold"
              v={fmt(pkg.cypTransporterPanel.cyp.inductionMrnaFoldChange)}
            />
            <Kv
              k="MATE1 inhib (P)"
              v={fmt(
                pkg.cypTransporterPanel.transporters.mate1InhibitionProb,
              )}
            />
          </div>
        )}
      </OutCard>

      {/* §6.1.b panel */}
      <OutCard title="§6.1.b — Renal vs Hepatic Clearance Fractions">
        {pkg.clearanceFractions === null ? (
          <NullCallout
            label="Clearance fractions unavailable"
            detail="Phase 1 Special-Pop module cannot branch renal-impairment vs hepatic-impairment study planning until route-fractional CL is provided. Add an in-vitro hepatocyte clearance assay (Clearance_Hepatocyte_AZ) and re-emit."
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
        <Kv k="L1 engine" v={pkg.provenance.l1EngineVersion} />
        <Kv k="L2 engine" v={pkg.provenance.l2EngineVersion} />
        <Kv k="L4 engine" v={pkg.provenance.l4EngineVersion} />
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
