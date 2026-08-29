/**
 * Project dashboard — the workspace's entry point.
 *
 * A project pins a molecule, a therapeutic area, a clinical route and a
 * workflow mode. The mode decides which layers the cascade exposes.
 */
import { ArrowRight, Beaker, FlaskConical, Home, Plus, Rabbit, Syringe } from "lucide-react";
import logo from "../assets/hakase-logo.png";
import { THERAPEUTIC_AREAS } from "../lib/catalogs";
import { StatusPill } from "../components/ui";
import { t } from "../i18n";
import { LanguageSwitch } from "../i18n/LanguageSwitch";

export type WorkflowMode = "full_cascade" | "in_vitro" | "ivive_only" | "animal_only" | "first_in_human_only";

export type Project = {
  id: string;
  name: string;
  smiles: string;
  areaCode: string;
  routeCode: string;
  mode: WorkflowMode;
  note: string;
  updatedAt: string;
};

export const MODE_LABEL: Record<WorkflowMode, string> = {
  full_cascade: "Full cascade · L1 → L4",
  in_vitro: "In-vitro only · L1 → L2",
  ivive_only: "IVIVE module",
  animal_only: "Animal cohort module",
  first_in_human_only: "First-in-human module",
};

export const DEMO_PROJECTS: Project[] = [
  {
    id: "prj-kinase-01", name: "HKS-1042 — kinase programme",
    smiles: "Cc1ccc(cc1Nc1nccc(n1)-c1cccnc1)NC(=O)c1ccc(CN2CCN(C)CC2)cc1",
    areaCode: "ONCOLOGY", routeCode: "ORAL", mode: "full_cascade",
    note: "Type II kinase inhibitor chemotype. Oral, once daily, advanced solid tumours.",
    updatedAt: "2026-08-28 08:41",
  },
  {
    id: "prj-cox-02", name: "HKS-2210 — COX-2 series",
    smiles: "Cc1ccc(cc1)-c1cc(nn1-c1ccc(cc1)S(N)(=O)=O)C(F)(F)F",
    areaCode: "IMMUNOLOGY", routeCode: "ORAL", mode: "full_cascade",
    note: "Diaryl heterocycle with an approved-class precedent that carries a boxed warning.",
    updatedAt: "2026-08-27 17:12",
  },
  {
    id: "prj-cns-03", name: "HKS-3390 — CNS penetrant",
    smiles: "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1",
    areaCode: "CNS", routeCode: "ORAL", mode: "full_cascade",
    note: "Quinazoline scaffold being assessed for central penetration against a peripheral comparator.",
    updatedAt: "2026-08-26 11:03",
  },
  {
    id: "prj-screen-04", name: "HKS-4501 — hit triage",
    smiles: "O=c1c(O)c(-c2ccc(O)c(O)c2)oc2cc(O)cc(O)c12",
    areaCode: "METABOLIC", routeCode: "ORAL", mode: "in_vitro",
    note: "Natural-product hit from a phenotypic screen. Structural triage before any resource is committed.",
    updatedAt: "2026-08-25 15:47",
  },
  {
    id: "prj-abx-05", name: "HKS-5120 — anti-infective",
    smiles: "OC(=O)c1cn(C2CC2)c2cc(N3CCNCC3)c(F)cc2c1=O",
    areaCode: "INFECTIOUS_DISEASE", routeCode: "IV", mode: "full_cascade",
    note: "Fluoroquinolone-class agent; intravenous for a hospital-acquired indication.",
    updatedAt: "2026-08-24 09:22",
  },
  {
    id: "prj-cv-06", name: "HKS-6008 — cardiovascular",
    smiles: "CCCc1nn(C)c2c1nc([nH]c2=O)-c1cc(ccc1OCC)S(=O)(=O)N1CCN(C)CC1",
    areaCode: "CARDIOVASCULAR", routeCode: "ORAL", mode: "full_cascade",
    note: "PDE5 chemotype under evaluation for pulmonary arterial hypertension.",
    updatedAt: "2026-08-22 14:05",
  },
];

const MODE_ICON: Record<WorkflowMode, React.ReactNode> = {
  full_cascade: <FlaskConical size={14} />,
  in_vitro: <Beaker size={14} />,
  ivive_only: <Beaker size={14} />,
  animal_only: <Rabbit size={14} />,
  first_in_human_only: <Syringe size={14} />,
};

export function Dashboard({ projects, onOpen, onHome }: {
  projects: Project[]; onOpen: (project: Project) => void; onHome: () => void;
}) {
  return <div className="landing">
    <nav className="lp-nav">
      <button className="row" style={{ gap: 10 }} onClick={onHome}><img src={logo} alt="HakaseAI" /></button>
      <span className="pill">{t("Demonstration workspace")}</span>
      <div className="links">
        <button className="text-action" onClick={onHome}><Home size={14} /> {t("Overview")}</button>
        <LanguageSwitch />
        <div className="avatar">S</div>
      </div>
    </nav>

    <div className="dash">
      <header className="dash-head">
        <div>
          <h1>{t("Projects")}</h1>
          <p>{t("Each project pins a structure, a therapeutic area, a clinical route and the layers the cascade exposes.")}</p>
        </div>
        <button className="btn"><Plus size={15} /> {t("New project")}</button>
      </header>

      <div className="project-grid">
        {projects.map((project) => {
          const area = THERAPEUTIC_AREAS.find((entry) => entry.code === project.areaCode);
          return <button className="project-card" key={project.id} onClick={() => onOpen(project)}>
            <div className="pc-head">
              <h3>{project.name}</h3>
              <span className="pc-mode">{MODE_ICON[project.mode]} {t(MODE_LABEL[project.mode].split(" · ")[0])}</span>
            </div>
            <code title={project.smiles}>{project.smiles}</code>
            <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>{t(project.note)}</p>
            <div className="row" style={{ gap: 6 }}>
              {area && <StatusPill status="pass" label={t(area.label)} />}
              <span className="pill">{t(project.routeCode)}</span>
            </div>
            <div className="pc-foot">
              <span>{t("Updated {when}", { when: project.updatedAt })}</span>
              <ArrowRight size={14} style={{ marginLeft: "auto", color: "var(--brand)" }} />
            </div>
          </button>;
        })}
      </div>
    </div>
  </div>;
}
