import { useCallback, useMemo, useRef, useState } from "react";
import {
  Beaker,
  Microscope,
  FlaskConical,
  Activity,
  ChevronRight,
  FileText,
  Moon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type PreClinicalPackage } from "@workspace/preclinical-handoff";
import hakaseLogo from "@assets/image_1773504202272.png";
import Phase1Planner, {
  type Phase1PlannerHandle,
} from "@/components/Phase1Planner";
import ProjectsRail, {
  type CurrentProjectInfo,
} from "@/components/ProjectsRail";
import { type Phase1Template } from "@/lib/phase1Templates";

type PhaseId = "p1" | "p2" | "p3" | "p4";

interface PhaseDef {
  id: PhaseId;
  label: string;
  status: "wired" | "stub";
  oneLiner: string;
  icon: typeof Beaker;
}

const PHASES: PhaseDef[] = [
  {
    id: "p1",
    label: "Phase 1 — FIH / SAD-MAD",
    status: "wired",
    oneLiner: "FIH dose · MABEL · DDI module · Special-Pop branching",
    icon: Beaker,
  },
  {
    id: "p2",
    label: "Phase 2 — Proof-of-Concept",
    status: "stub",
    oneLiner: "Adaptive dose-finding · biomarkers · interim analysis",
    icon: Microscope,
  },
  {
    id: "p3",
    label: "Phase 3 — Pivotal",
    status: "stub",
    oneLiner: "Pivotal trial · sample-size · subgroup planning",
    icon: FlaskConical,
  },
  {
    id: "p4",
    label: "Phase 4 — Post-Market",
    status: "stub",
    oneLiner: "FAERS / openEBGM signal monitoring · RWE pulls",
    icon: Activity,
  },
];

export default function HakaseClinical() {
  const [activePhase, setActivePhase] = useState<PhaseId>("p1");
  const [pkg, setPkg] = useState<PreClinicalPackage | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [projectCode, setProjectCode] = useState("HKC-0001");
  const [projectIndication, setProjectIndication] =
    useState("Indication not set");
  const [jumpToApiSignal, setJumpToApiSignal] = useState(0);

  const plannerHandleRef = useRef<Phase1PlannerHandle | null>(null);

  const registerHandle = useCallback((h: Phase1PlannerHandle) => {
    plannerHandleRef.current = h;
  }, []);

  const handleApplyTemplate = useCallback((t: Phase1Template) => {
    setActiveTemplateId(t.id);
    setProjectName(t.compound.preferredName || t.name);
    setProjectCode(`HKC-${t.id.toUpperCase().slice(0, 8)}`);
    setProjectIndication(t.indication);
    plannerHandleRef.current?.applyTemplatePartial(
      {
        smiles: t.compound.smiles,
        preferredName: t.compound.preferredName,
        chemblId: t.compound.chemblId ?? "",
        inchiKey: t.compound.inchiKey ?? "",
        primaryTargetUniprot: t.primaryTarget.uniprot ?? "",
        primaryTargetGeneSymbol: t.primaryTarget.geneSymbol ?? "",
        speciesId: t.speciesId,
        speciesDisplayName: t.speciesDisplayName,
        studyTypeId: t.studyTypeId,
        studyTypeLabel: t.studyTypeLabel,
        routeOfAdministration: t.routeOfAdministration,
      },
      t.id,
    );
  }, []);

  const handleNewProject = useCallback(() => {
    setActiveTemplateId(null);
    setProjectName("Untitled Project");
    setProjectCode(`HKC-${Math.floor(Math.random() * 9000 + 1000)}`);
    setProjectIndication("Indication not set");
    plannerHandleRef.current?.reset();
  }, []);

  const handleJumpToApi = useCallback(() => {
    setJumpToApiSignal((n) => n + 1);
    plannerHandleRef.current?.openApi();
  }, []);

  const currentProject: CurrentProjectInfo = useMemo(
    () => ({
      name: projectName,
      code: projectCode,
      indication: projectIndication,
      hasPackage: pkg !== null,
    }),
    [projectName, projectCode, projectIndication, pkg],
  );

  return (
    <div className="h-screen w-full flex flex-col bg-[#07080c] text-slate-200 font-sans overflow-hidden">
      {/* Top Navigation Bar — mirrors hakase-ai layer stepper */}
      <header className="h-14 border-b border-white/8 bg-[#0d0f17]/90 backdrop-blur-md flex items-center px-4 gap-4 shrink-0 z-50">
        {/* Logo — same wordmark as hakase-ai, "Clinical" sub-badge */}
        <div className="flex items-center gap-2 min-w-[220px]">
          <img
            src={hakaseLogo}
            alt="hakaseAI"
            className="h-8 w-auto object-contain"
          />
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 border-violet-500/40 text-violet-400"
          >
            Clinical · v1.0
          </Badge>
        </div>

        {/* Phase Stepper (centered pills + chevrons) */}
        <div className="flex items-center gap-1 mx-auto">
          {PHASES.map((p, i) => {
            const active = p.id === activePhase;
            const Icon = p.icon;
            // All phases violet (single-product palette); inactive subdued.
            const activeCls =
              "bg-violet-600/20 border-violet-500/50 text-violet-300";
            const numActiveCls =
              "border-violet-400 text-violet-400 bg-violet-400/10";
            return (
              <div key={p.id} className="flex items-center">
                <button
                  onClick={() => setActivePhase(p.id)}
                  className={
                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-200 border " +
                    (active
                      ? activeCls
                      : "text-slate-400 hover:bg-white/5 border-transparent cursor-pointer")
                  }
                  title={p.oneLiner}
                >
                  <div
                    className={
                      "w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border " +
                      (active ? numActiveCls : "border-slate-600 text-slate-500")
                    }
                  >
                    {i + 1}
                  </div>
                  <Icon className="w-3.5 h-3.5" />
                  {p.label.replace(/^Phase \d+ — /, "")}
                  {p.status === "stub" && (
                    <span className="text-[8px] uppercase tracking-wider text-slate-600 ml-1">
                      stub
                    </span>
                  )}
                </button>
                {i < PHASES.length - 1 && (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600 mx-0.5" />
                )}
              </div>
            );
          })}
        </div>

        {/* Right nav actions */}
        <div className="flex items-center gap-2 min-w-[200px] justify-end">
          <button
            disabled={pkg === null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[11px] font-semibold"
            title="Export the loaded PreClinicalPackage as JSON"
          >
            <FileText className="w-3.5 h-3.5" /> Export §8 JSON
          </button>
          <button
            className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors"
            title="Theme toggle (visual parity only — dark mode permanent)"
          >
            <Moon className="w-4 h-4" />
          </button>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-[11px] font-bold text-white">
            HC
          </div>
        </div>
      </header>

      {/* Body — 3-column layout: Projects rail | Inputs | Output */}
      <main className="flex-1 overflow-hidden flex">
        {activePhase === "p1" ? (
          <>
            <ProjectsRail
              current={currentProject}
              activeTemplateId={activeTemplateId}
              onApplyTemplate={handleApplyTemplate}
              onNewProject={handleNewProject}
              onJumpToApi={handleJumpToApi}
            />
            <Phase1Planner
              pkg={pkg}
              importError={importError}
              onPackageReady={setPkg}
              onImportError={setImportError}
              registerHandle={registerHandle}
              jumpToApiSignal={jumpToApiSignal}
            />
          </>
        ) : (
          <PhasePlaceholder
            phase={PHASES.find((p) => p.id === activePhase)!}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/8 bg-[#0a0c12] shrink-0">
        <div className="px-6 py-2 text-[10px] text-slate-600 truncate">
          Open-source stack only — no commercial gating. Sources: OpenFDA ·
          ClinicalTrials.gov v2 + AACT · PK-DB · ChEMBL · DailyMed · OpenTargets ·
          gnomAD · ClinVar · PubMed/EuropePMC. Models: PK-Sim/MoBi (BSD) ·
          mrgsolve (R) · DeepDDI (Apache 2.0) · openEBGM/BCPNN ·
          MedSpaCy/GatorTron · TrialGPT · Criteria2Query.
        </div>
      </footer>
    </div>
  );
}

function PhasePlaceholder({ phase }: { phase: PhaseDef }) {
  const Icon = phase.icon;
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-4 p-8">
      <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
        <Icon className="w-7 h-7 text-slate-500" />
      </div>
      <div className="text-center max-w-md">
        <div className="text-[14px] font-medium text-slate-300">
          {phase.label}
        </div>
        <p className="text-[11px] text-slate-500 mt-1">{phase.oneLiner}</p>
        <div className="mt-6 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-6 text-[11px] text-slate-500 leading-snug">
          Planner not yet wired. Phase 1 is the first deliverable; Phases 2–4
          will follow once the open-source data gateways and models for each
          phase are integrated.
        </div>
      </div>
    </div>
  );
}
