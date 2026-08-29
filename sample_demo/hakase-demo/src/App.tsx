/**
 * Application shell.
 *
 * Owns the route, the project, the active layer and the handoff between layers.
 * Each layer owns its own inputs and renders its setup controls into the shared
 * rail through a portal, exactly as the production workspace does.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Beaker, ChevronRight, Home, Microscope, Rabbit, Save, Syringe } from "lucide-react";
import logoLight from "./assets/hakase-logo-light.png";
import { buildProfileWithRDKit, type CompoundProfile } from "./engine/profile";
import { buildL1Record, predictTargets, type L1Record, type TargetHit } from "./engine/l1";
import { Landing } from "./layers/Landing";
import { Dashboard, DEMO_PROJECTS, MODE_LABEL, type Project } from "./layers/Dashboard";
import { L1InVitro, type L1State } from "./layers/L1InVitro";
import { emptyL2State, L2Confirmation, type L2State } from "./layers/L2Confirmation";
import { emptyIviveState, L3Ivive, type L3IviveState } from "./layers/L3Ivive";
import { emptyAnimalState, L3Animal, type L3AnimalState } from "./layers/L3Animal";
import { emptyL4State, L4Fih, type L4State } from "./layers/L4Fih";
import type { MeasuredOverrides } from "./engine/l3ivive";
import { t } from "./i18n";
import { LanguageSwitch } from "./i18n/LanguageSwitch";
import { useLocale } from "./i18n/useLocale";
import { useRenderedLocale } from "./i18n/rendered";

const STAGES = [
  { key: "in-vitro", label: "In Vitro", layer: 1, icon: <Beaker size={13} /> },
  { key: "confirmation", label: "Confirmation", layer: 2, icon: <Microscope size={13} /> },
  { key: "ivive", label: "IVIVE", layer: 3, icon: <Beaker size={13} /> },
  { key: "animal-cohort", label: "Animal Cohort", layer: 3, icon: <Rabbit size={13} /> },
  { key: "first-in-human", label: "First in Human", layer: 4, icon: <Syringe size={13} /> },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

function stagesFor(mode: Project["mode"]) {
  if (mode === "in_vitro") return STAGES.filter((stage) => stage.key === "in-vitro" || stage.key === "confirmation");
  if (mode === "ivive_only") return STAGES.filter((stage) => stage.key === "ivive");
  if (mode === "animal_only") return STAGES.filter((stage) => stage.key === "animal-cohort");
  if (mode === "first_in_human_only") return STAGES.filter((stage) => stage.key === "first-in-human");
  return STAGES;
}

export default function App() {
  const [route, setRoute] = useState<"landing" | "dashboard" | "workspace">("landing");
  const [project, setProject] = useState<Project | null>(null);
  const [stage, setStage] = useState<StageKey>("in-vitro");
  const [railHost, setRailHost] = useState<HTMLDivElement | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("saved");
  const [running, setRunning] = useState(false);
  const { locale, setLocale } = useLocale();
  useRenderedLocale(locale);

  const [l1, setL1] = useState<L1State>({
    modality: "small_molecule", sequence: "", smiles: "", partners: [], mechanism: "undeclared",
    areaCode: "", routeCode: "", targets: [], selectedTargetId: null,
    targetProtein: "", uniprotId: "", pdbId: "",
    simulationOptions: { admet_profiling: true, binding_simulation: true, toxicity_signal_detection: true, behavioral_fingerprinting: false, confidence_threshold: 0.7 },
    record: null, profile: null, override: null,
  });
  const [l2, setL2] = useState<L2State>(emptyL2State);
  const [ivive, setIvive] = useState<L3IviveState>(emptyIviveState);
  const [animal, setAnimal] = useState<L3AnimalState>(emptyAnimalState);
  const [fih, setFih] = useState<L4State>(emptyL4State);

  /* A project change seeds the Layer 1 rail and clears every downstream layer. */
  function openProject(next: Project) {
    setProject(next);
    setRoute("workspace");
    setStage(stagesFor(next.mode)[0].key);
    const { targets } = predictTargets({ smiles: next.smiles, affinity: { kdNm: 50 } } as any);
    setL1({
      modality: "small_molecule", sequence: "", smiles: next.smiles, partners: [], mechanism: "undeclared",
      areaCode: next.areaCode, routeCode: next.routeCode,
      targets, selectedTargetId: targets[0]?.targetChemblId ?? null,
      targetProtein: targets[0]?.targetName ?? "", uniprotId: targets[0]?.uniprotId ?? "",
      pdbId: targets[0]?.pdbIds[0] ?? "",
      simulationOptions: { admet_profiling: true, binding_simulation: true, toxicity_signal_detection: true, behavioral_fingerprinting: false, confidence_threshold: 0.7 },
      record: null, profile: null, override: null,
    });
    setL2(emptyL2State);
    setIvive(emptyIviveState);
    setAnimal(emptyAnimalState);
    setFih(emptyL4State);
  }

  async function buildL1From(state: L1State): Promise<{ profile: CompoundProfile; record: L1Record }> {
    const profile = await buildProfileWithRDKit(state.smiles.trim());
    const target = state.targets.find((entry) => entry.targetChemblId === state.selectedTargetId) ?? null;
    const record = buildL1Record(profile, {
      routeCode: state.routeCode, areaCode: state.areaCode, target, allTargets: state.targets,
      simulationOptions: state.simulationOptions,
    });
    return { profile, record };
  }

  /* `overrideSmiles` is how the structure workbench applies an edit. Setting
     the SMILES through `setL1` and then calling this with no argument reads the
     pre-update state from the closure, so the screen re-ran on the structure
     the user had just replaced. */
  function runL1(overrideSmiles?: string) {
    setRunning(true);
    const source = overrideSmiles ? { ...l1, smiles: overrideSmiles } : l1;
    window.setTimeout(async () => {
      const { profile, record } = await buildL1From(source);
      setL1((current) => ({ ...current, smiles: source.smiles, profile, record, override: null }));
      setL2(emptyL2State);
      setIvive(emptyIviveState);
      setAnimal(emptyAnimalState);
      setFih(emptyL4State);
      setRunning(false);
      setSaveState("saving");
      window.setTimeout(() => setSaveState("saved"), 700);
    }, 2400);
  }

  /* The engines write their prose in the active locale as they compose it —
     most of it is interpolated and cannot be looked up after the fact — so a
     record is bound to the locale it was built under.
     Layer 1 is rebuilt in place because this component owns its inputs and the
     rebuild is instant. The layers below are deliberately left alone: they hold
     their own inputs, sign-offs and study records, and throwing those away on a
     language change destroys real work — someone who has run the whole cascade
     and switches to Japanese to show it to a colleague should not lose it. Their
     chrome re-renders in the new locale; sentences their engines already composed
     stay as written until that layer is re-run. */
  const firstLocale = useRef(true);
  useEffect(() => {
    if (firstLocale.current) { firstLocale.current = false; return; }
    if (!l1.record) return;
    void buildL1From(l1).then(({ profile, record }) => {
      setL1((current) => ({ ...current, profile, record }));
    });
  }, [locale]);

  const overrides: MeasuredOverrides = useMemo(() => {
    const out: MeasuredOverrides = {};
    for (const [key, raw] of Object.entries(ivive.measured)) {
      const value = Number(raw);
      if (raw?.trim() && Number.isFinite(value) && value > 0) (out as any)[key] = value;
    }
    return out;
  }, [ivive.measured]);

  const inheritedHalfLife = ivive.exposure?.available ? ivive.exposure.endpoints.plasma.t_half.median : undefined;
  const visibleStages = project ? stagesFor(project.mode) : STAGES;
  const canConfirm = Boolean(l1.record) && (l1.record!.verdict.verdict === "GO" || Boolean(l1.override));

  /* The main column scrolls internally, so a stage change resets that element
     rather than the document. */
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [stage]);

  if (route === "landing") return <Landing onEnter={() => setRoute("dashboard")} />;
  if (route === "dashboard" || !project) {
    return <Dashboard projects={DEMO_PROJECTS} onOpen={openProject} onHome={() => setRoute("landing")} />;
  }

  const currentStage = STAGES.find((entry) => entry.key === stage) ?? STAGES[0];
  const verdictTone = l1.record
    ? l1.record.verdict.verdict === "GO" ? "good" : l1.record.verdict.verdict === "WATCH" ? "warn" : "bad"
    : "";

  return <div className="shell">
    <aside className="rail">
      <div className="rail-brand">
        <button onClick={() => setRoute("dashboard")} aria-label="Back to projects"><img src={logoLight} alt="HakaseAI" /></button>
        <span className="brand-tag">Demo</span>
      </div>
      <div ref={setRailHost} style={{ display: "contents" }} />
    </aside>

    <div className="main" ref={mainRef}>
      <div className="topbar-wrap">
        <header className="topbar">
          <div className="crumbs">
            <button className="crumb-link" onClick={() => setRoute("dashboard")}><Home size={14} /> {t("Projects")}</button>
            <ChevronRight className="crumb-sep" size={14} />
            <span className="crumb-current">
              <b>{project.name}</b>
              <span>{t(MODE_LABEL[project.mode])} · {t(currentStage.label)}</span>
            </span>
          </div>
          <div className="topbar-right">
            {l1.record && <span className={`topbar-chip ${verdictTone}`}>
              <span className={`dot ${verdictTone}`} />
              {l1.record.verdict.verdict}
            </span>}
            <span className="topbar-div" />
            <span className={`save-state ${saveState}`}>{saveState === "saving" ? t("Saving…") : t("All changes saved")}</span>
            <button className="btn sm" onClick={() => { setSaveState("saving"); window.setTimeout(() => setSaveState("saved"), 600); }}>
              <Save size={14} /> {t("Save")}
            </button>
            <LanguageSwitch />
            <div className="avatar">S</div>
          </div>
        </header>
        <nav className="pipeline-bar" aria-label="Pre-clinical pipeline">
          <div className="pipeline">
            {visibleStages.map((entry, index) => {
              const locked = project.mode === "full_cascade" && (
                (entry.key === "confirmation" && !canConfirm) ||
                (entry.key === "ivive" && !canConfirm) ||
                (entry.key === "animal-cohort" && !ivive.signoff) ||
                (entry.key === "first-in-human" && !animal.record)
              );
              const done = visibleStages.findIndex((item) => item.key === stage) > index;
              return <span key={entry.key} style={{ display: "contents" }}>
                {index > 0 && <i className={`stage-link ${done ? "done" : ""}`} />}
                <button className={`stage-step ${stage === entry.key ? "active" : ""} ${done ? "done" : ""}`}
                  data-layer={entry.layer} disabled={locked} onClick={() => setStage(entry.key)}
                  title={locked ? t("Complete the previous layer first — this layer consumes its record.") : undefined}>
                  <span className="num">{index + 1}</span>
                  <span>{t(entry.label)}</span>
                </button>
              </span>;
            })}
          </div>
        </nav>
      </div>

      <main className="content">
        {stage === "in-vitro" && (
          <L1InVitro state={l1} setState={setL1} railHost={railHost} onRun={runL1} running={running}
            onContinue={() => setStage("confirmation")} />
        )}

        {stage === "confirmation" && l1.record && l1.profile && (
          <L2Confirmation profile={l1.profile} l1={l1.record}
            executionProfile={project.mode === "in_vitro" ? "in_vitro" : "full_cascade"}
            state={l2} setState={setL2} railHost={railHost}
            onBack={() => setStage("in-vitro")}
            onContinue={project.mode === "in_vitro" ? undefined : () => setStage("ivive")} />
        )}

        {stage === "ivive" && l1.record && l1.profile && (
          <L3Ivive profile={l1.profile} l1={l1.record} hasReview={Boolean(l1.override)}
            state={ivive} setState={setIvive} railHost={railHost}
            onBack={() => setStage("confirmation")} onContinue={() => setStage("animal-cohort")} />
        )}

        {stage === "animal-cohort" && l1.record && l1.profile && (
          <L3Animal profile={l1.profile} l1={l1.record} overrides={overrides} areaCode={l1.areaCode}
            components={l1.partners.length ? [
              { id: "primary", label: "Component 1", smiles: l1.smiles, role: "active" as const, fraction: 1 },
              ...l1.partners,
            ] : []}
            signoff={ivive.signoff} inheritedHalfLifeH={inheritedHalfLife}
            state={animal} setState={setAnimal} railHost={railHost}
            onBack={() => setStage("ivive")} onContinue={() => setStage("first-in-human")} />
        )}

        {stage === "first-in-human" && l1.profile && animal.record && (
          <L4Fih profile={l1.profile} study={animal.record} overrides={overrides} areaCode={l1.areaCode}
            state={fih} setState={setFih} railHost={railHost} onBack={() => setStage("animal-cohort")} />
        )}

        {stage === "first-in-human" && !animal.record && (
          <div className="panel empty">
            <div className="orb"><Syringe size={26} /></div>
            <h2>{t("Run a virtual animal study first")}</h2>
            <p>{t("The first-in-human layer translates a completed animal study's point of departure. Without one, there is nothing to scale.")}</p>
          </div>
        )}
      </main>
    </div>
  </div>;
}
