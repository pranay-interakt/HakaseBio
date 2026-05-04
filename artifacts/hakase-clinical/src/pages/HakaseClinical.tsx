import { useState } from "react";
import {
  isPreClinicalPackage,
  type PreClinicalPackage,
} from "@workspace/preclinical-handoff";
import Phase1Planner from "@/components/Phase1Planner";

type PhaseId = "p1" | "p2" | "p3" | "p4";

interface PhaseDef {
  id: PhaseId;
  label: string;
  status: "wired" | "stub";
  oneLiner: string;
  accent: string;
}

const PHASES: PhaseDef[] = [
  {
    id: "p1",
    label: "Phase 1 — FIH / SAD-MAD",
    status: "wired",
    oneLiner:
      "FIH dose · MABEL · DDI module · Special-Pop branching from §6.1 panel",
    accent: "violet",
  },
  {
    id: "p2",
    label: "Phase 2 — Proof-of-Concept",
    status: "stub",
    oneLiner:
      "Adaptive dose-finding · biomarker panel · interim analysis (planned)",
    accent: "cyan",
  },
  {
    id: "p3",
    label: "Phase 3 — Pivotal",
    status: "stub",
    oneLiner:
      "Pivotal trial design · sample-size · subgroup planning (planned)",
    accent: "amber",
  },
  {
    id: "p4",
    label: "Phase 4 — Post-Market",
    status: "stub",
    oneLiner:
      "FAERS / openEBGM signal monitoring · RWE pulls (planned)",
    accent: "emerald",
  },
];

const ACCENT_RING: Record<string, string> = {
  violet: "ring-violet-500/40 text-violet-300",
  cyan: "ring-cyan-500/40 text-cyan-300",
  amber: "ring-amber-500/40 text-amber-300",
  emerald: "ring-emerald-500/40 text-emerald-300",
};

export default function HakaseClinical() {
  const [activePhase, setActivePhase] = useState<PhaseId>("p1");
  const [pkg, setPkg] = useState<PreClinicalPackage | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function handleImport(jsonText: string) {
    setImportError(null);
    if (!jsonText.trim()) {
      setPkg(null);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      setImportError(
        `Not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
      setPkg(null);
      return;
    }
    if (!isPreClinicalPackage(parsed)) {
      setImportError(
        "Parsed JSON does not match PreClinicalPackage v1.0.0 shape. " +
          "Expected schemaVersion === \"1.0.0\" and required top-level fields " +
          "(compound, inVitro, inSilico, animalCohort, provenance).",
      );
      setPkg(null);
      return;
    }
    setPkg(parsed);
  }

  return (
    <div className="min-h-screen w-full bg-[#07080c] text-slate-200 font-sans">
      <header className="border-b border-slate-800/80 bg-[#0a0c12]">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight text-white">
              Hakase Clinical
            </h1>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Phase 1–4 planner · consumes the §8 PreClinicalPackage handoff
              from Hakase BioDigital Twin · open-source-only stack
            </p>
          </div>
          <div className="text-[11px] text-slate-500 tabular-nums">
            schema v1.0.0
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 grid grid-cols-12 gap-6">
        {/* Phase rail */}
        <nav className="col-span-12 lg:col-span-3 space-y-2">
          {PHASES.map((p) => {
            const active = p.id === activePhase;
            const ring = ACCENT_RING[p.accent] ?? "";
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePhase(p.id)}
                className={
                  "w-full text-left rounded-md border px-4 py-3 transition " +
                  (active
                    ? `bg-[#0e1118] border-slate-700 ring-1 ${ring}`
                    : "bg-[#0a0c12] border-slate-800/80 text-slate-400 hover:border-slate-700 hover:text-slate-200")
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium">{p.label}</span>
                  <span
                    className={
                      "text-[10px] uppercase tracking-wide " +
                      (p.status === "wired"
                        ? "text-emerald-400"
                        : "text-slate-500")
                    }
                  >
                    {p.status}
                  </span>
                </div>
                <p className="text-[11px] mt-1 leading-snug text-slate-500">
                  {p.oneLiner}
                </p>
              </button>
            );
          })}
        </nav>

        {/* Active phase pane */}
        <section className="col-span-12 lg:col-span-9 space-y-6">
          {activePhase === "p1" && (
            <Phase1Planner
              pkg={pkg}
              importError={importError}
              onImport={handleImport}
            />
          )}
          {activePhase !== "p1" && (
            <PhasePlaceholder phase={PHASES.find((p) => p.id === activePhase)!} />
          )}
        </section>
      </main>

      <footer className="border-t border-slate-800/80 bg-[#0a0c12] mt-12">
        <div className="mx-auto max-w-7xl px-6 py-4 text-[11px] text-slate-500">
          Open-source stack only — no commercial gating. Data sources:
          OpenFDA · ClinicalTrials.gov v2 + AACT · PK-DB · ChEMBL · DailyMed ·
          OpenTargets · gnomAD · ClinVar · PubMed/EuropePMC.
          Models: PK-Sim/MoBi (BSD) · mrgsolve (R) · DeepDDI (Apache 2.0) ·
          openEBGM/BCPNN · MedSpaCy/GatorTron · TrialGPT · Criteria2Query.
        </div>
      </footer>
    </div>
  );
}

function PhasePlaceholder({ phase }: { phase: PhaseDef }) {
  const ring = ACCENT_RING[phase.accent] ?? "";
  return (
    <div
      className={
        "rounded-lg border border-slate-800/80 bg-[#0a0c12] p-8 ring-1 " + ring
      }
    >
      <h2 className="text-[15px] font-semibold text-white">{phase.label}</h2>
      <p className="text-[12px] text-slate-400 mt-1">{phase.oneLiner}</p>
      <div className="mt-6 rounded-md border border-dashed border-slate-700 bg-[#07080c] p-6 text-[12px] text-slate-500">
        Planner not yet wired. Phase 1 is the first deliverable; Phases 2–4
        will follow once the open-source data gateways and models for each
        phase are integrated. The shape of this card mirrors the eventual
        planner so the navigation contract is stable.
      </div>
    </div>
  );
}
