/**
 * Landing page.
 *
 * Presentation only. Every claim below mirrors what the layers actually
 * compute; nothing here is a live calculation.
 */
import {
  ArrowRight, Atom, BadgeCheck, Beaker, Boxes, CircleCheck, Database, FlaskConical, Gauge,
  Layers, Microscope, Rabbit, ScanSearch, ShieldCheck, Sparkles, Syringe, Target,
} from "lucide-react";
import logo from "../assets/hakase-logo.png";
import { t } from "../i18n";
import { LanguageSwitch } from "../i18n/LanguageSwitch";

const STATS = [
  { value: "45", label: "ADMET endpoints per screen, each with unit provenance, a screening band and an applicability domain" },
  { value: "13", label: "perfusion-limited PBPK compartments integrated per virtual subject" },
  { value: "15", label: "mechanistic toxicology domains joined onto simulated organ exposure" },
  { value: "4", label: "layers from structure to a defensible first-in-human starting dose" },
];

const LAYERS = [
  {
    layer: 1, colour: "var(--l1)", name: "In Vitro", icon: <Beaker size={18} />,
    summary: "A structure enters, and a stage-gate verdict with evidence-graded checks comes out. Every endpoint carries the band it was judged against and the applicability domain that decides whether the model may speak about this chemistry at all.",
    points: ["45 ADMET endpoints across six property families", "20-assay extended bench with focused predictors", "PAINS, Brenk and NIH structural alert screen", "Read-across target and selectivity evidence", "Regulatory precedent from OpenFDA and PubChem"],
  },
  {
    layer: 2, colour: "var(--l2)", name: "Confirmation", icon: <Microscope size={18} />,
    summary: "Ten stages of orthogonal cross-checking. Docking and free-energy refinement are dispatched explicitly because each needs its own inputs and carries a real compute cost — they are never silently batched.",
    points: ["Target druggability and pocket descriptors", "Binding, ADME and disposition cross-check", "Safety triage and the Tox21 panel", "IVIVE clearance, target engagement, therapeutic index", "A rollup over only the stages that actually ran"],
  },
  {
    layer: 3, colour: "var(--l3)", name: "IVIVE & Animal Cohort", icon: <Rabbit size={18} />,
    summary: "A whole-body PBPK exposure projection, then a complete virtual preclinical study: toxicokinetics to ICH S3A, biodistribution, a mechanistic hazard panel joined onto organ exposure, the ICH S7A/S7B battery, and the welfare accounting an ethics committee asks for.",
    points: ["Poulin & Theil tissue partitioning across 13 compartments", "Guideline conformance before the run is paid for", "Target-organ map — hazard and exposure must coincide", "EU 2010/63 prospective severity and 3Rs reduction", "Points of departure with their strength and provenance"],
  },
  {
    layer: 4, colour: "var(--l4)", name: "First in Human", icon: <Syringe size={18} />,
    summary: "The NOAEL/HED route and MABEL derived independently, with the lower governing — and the fold difference between them shown, because a wide divergence is a finding rather than a rounding detail.",
    points: ["FDA (2005) body-surface-area translation with itemised safety factors", "Escalation ladder and 3+3 operating characteristics", "Exposure margins at every planned dose level", "SAD/MAD design, sampling schedule and stopping rules", "IND/CTA checklist and FDA (2023) benefit-risk framing"],
  },
];

const PRINCIPLES = [
  { title: "No composite score", body: "Averaging a permeability against a genotoxicity flag has no scientific meaning, so it is never done. One flagged gate-driving check can set a verdict on its own." },
  { title: "Absence is not evidence", body: "An organ with no hazard signal is the absence of a flagged model output, not a demonstration of organ safety. A registry that returned nothing says something about the public record, not about the compound." },
  { title: "Provenance on every number", body: "Each value carries whether it was measured, predicted, derived or assumed — and a measured value supplied by the user outranks the prediction through the whole cascade." },
  { title: "Applicability decides admissibility", body: "The nearest-neighbour similarity to the training chemistry decides whether a model may speak at all. Outside the domain, a value is an extrapolation and is labelled as one." },
  { title: "Stated limitations, not footnotes", body: "Every block reports what it does not model. Transporter uptake, metabolite exposure, saturable metabolism and formulation effects are named as absent rather than quietly omitted." },
  { title: "A signature never changes a number", body: "A reviewer can accept residual risk on the record. A block records an evidence gap that no signature can close." },
];

export function Landing({ onEnter }: { onEnter: () => void }) {
  return <div className="landing">
    <nav className="lp-nav">
      <img src={logo} alt="HakaseAI" />
      <span className="pill">{t("Demonstration workspace")}</span>
      <div className="links">
        <a href="#layers">{t("Layers")}</a>
        <a href="#principles">{t("Principles")}</a>
        <LanguageSwitch />
        <button className="btn primary" onClick={onEnter}>{t("Open the workspace")} <ArrowRight size={15} /></button>
      </div>
    </nav>

    <header className="lp-hero">
      <div className="lp-badge"><Sparkles size={14} /> {t("Preclinical BioDigital Twin")}</div>
      <h1>{t("From a SMILES string to a defensible")}<br /><em>{t("first-in-human starting dose")}</em></h1>
      <p>
        {t("Four connected layers of preclinical evidence — in-vitro screening, orthogonal confirmation, a whole-body exposure projection and a virtual animal study, then the human translation. Every number carries its unit, its provenance, the band it was judged against and the limits of what it can support.")}
      </p>
      <div className="lp-cta">
        <button className="btn primary lg" onClick={onEnter}>{t("Open the workspace")} <ArrowRight size={16} /></button>
        <a className="btn lg" href="#layers">{t("See what each layer computes")}</a>
      </div>
      <div className="lp-stats">
        {STATS.map((stat) => <div className="lp-stat" key={stat.label}><b>{stat.value}</b><span>{t(stat.label)}</span></div>)}
      </div>
    </header>

    <section className="lp-section" id="layers">
      <h2>{t("The cascade")}</h2>
      <p>{t("Each layer consumes the record the previous one produced, unchanged. Nothing is re-derived downstream, and a value corrected by measurement travels the whole chain.")}</p>
      <div className="lp-layers">
        {LAYERS.map((layer) => (
          <article className="lp-layer" key={layer.layer} style={{ ["--lc" as string]: layer.colour }}>
            <span className="lnum">{layer.icon} {t("Layer {n}", { n: layer.layer })}</span>
            <h3>{t(layer.name)}</h3>
            <p>{t(layer.summary)}</p>
            <ul>{layer.points.map((point) => <li key={point}><CircleCheck size={13} />{t(point)}</li>)}</ul>
          </article>
        ))}
      </div>
    </section>

    <section className="lp-section" id="principles">
      <h2>{t("What the interface refuses to do")}</h2>
      <p>{t("The scientific discipline of this platform is mostly visible in what it declines to show you.")}</p>
      <div className="lp-layers" style={{ marginTop: 36 }}>
        {PRINCIPLES.map((principle) => (
          <article className="lp-layer" key={principle.title} style={{ ["--lc" as string]: "var(--brand)" }}>
            <span className="lnum"><ShieldCheck size={15} /> {t("Principle")}</span>
            <h3>{t(principle.title)}</h3>
            <p>{t(principle.body)}</p>
          </article>
        ))}
      </div>
    </section>

    <section className="lp-section">
      <h2>{t("Everything the workspace computes")}</h2>
      <p>{t("A single run touches every one of these surfaces.")}</p>
      <div className="lp-layers" style={{ marginTop: 36, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {[
          { icon: <Atom size={16} />, title: "Structure & descriptors", body: "RDKit-powered SMILES parsing, 2D depiction and core descriptors, plus five rule-based filters." },
          { icon: <Layers size={16} />, title: "ADMET profile", body: "45 endpoints with bands, conformal intervals, approved-drug percentiles and per-endpoint applicability." },
          { icon: <ScanSearch size={16} />, title: "Structural screening", body: "PAINS, Brenk and NIH substructure detection with recommended orthogonal controls." },
          { icon: <Target size={16} />, title: "Target evidence", body: "Candidate ranking, resolution provenance, read-across potency grouped by activity type." },
          { icon: <FlaskConical size={16} />, title: "Physical jobs", body: "Docking poses and box definition; TIES free-energy refinement with per-λ convergence." },
          { icon: <Beaker size={16} />, title: "Exposure projection", body: "13-compartment PBPK with a sampled virtual cohort and a 90% population band." },
          { icon: <Boxes size={16} />, title: "Biodistribution", body: "Per-organ Cmax, Tmax, AUC, Kp and tissue:plasma ratio across every dose group." },
          { icon: <Microscope size={16} />, title: "Toxicology", body: "15 mechanistic domains, each joined onto simulated organ exposure before an organ is called." },
          { icon: <Rabbit size={16} />, title: "Welfare & 3Rs", body: "Animals an equivalent wet study would consume, EU 2010/63 severity, humane endpoints." },
          { icon: <Gauge size={16} />, title: "Human translation", body: "HED, MRSD, MABEL, escalation ladder, exposure margins and 3+3 operating characteristics." },
          { icon: <Database size={16} />, title: "External evidence", body: "STRING, KEGG, Reactome, ToxRef, ECOTOX, ToxCast, ClinicalTrials.gov, PharmGKB, DisGeNET, gnomAD." },
          { icon: <BadgeCheck size={16} />, title: "Validation & provenance", body: "Held-out fold error, endpoint qualification map, and which model produced which number." },
        ].map((item) => (
          <article className="lp-layer" key={item.title} style={{ ["--lc" as string]: "var(--brand)" }}>
            <span className="lnum">{item.icon}</span>
            <h3 style={{ fontSize: 15 }}>{t(item.title)}</h3>
            <p style={{ fontSize: 12.5 }}>{t(item.body)}</p>
          </article>
        ))}
      </div>
    </section>

    <footer className="lp-footer">
      {t("HakaseAI · demonstration workspace. Structure-derived values are calculated locally with RDKit. All pharmacology, ADMET and study outputs are illustrative local heuristics, not production models or decision-grade evidence.")}
    </footer>
  </div>;
}
