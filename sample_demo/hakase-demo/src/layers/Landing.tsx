/** Platform brief / landing page for the standalone demonstration. */
import {
  ArrowRight, Atom, BadgeCheck, BookOpenCheck, Boxes, FileCheck2, FlaskConical,
  GitBranch, Microscope, Network, ShieldCheck,
} from "lucide-react";
import logo from "../assets/hakase-logo.png";
import { t } from "../i18n";
import { LanguageSwitch } from "../i18n/LanguageSwitch";

const WORKFLOW = [
  { step: "01", title: "Structure & evidence triage", tag: "Layer 1", icon: <Atom size={17} />, body: "Standardise the submitted chemical entity; calculate structure-derived descriptors; assess ADMET, safety, structural alerts, target evidence and public regulatory precedent.", output: "Evidence-graded stage-gate record" },
  { step: "02", title: "Orthogonal confirmation", tag: "Layer 2", icon: <Microscope size={17} />, body: "Make physical and computational jobs explicit. Docking, free-energy refinement and contextual evidence retain readiness, inputs, limitations and run status.", output: "Confirmation plan and executed-job roll-up" },
  { step: "03", title: "Exposure & virtual study design", tag: "Layer 3", icon: <Boxes size={17} />, body: "Connect disposition inputs to a whole-body PBPK projection and a virtual animal study, with protocol conformance, welfare accounting and organ-level exposure context.", output: "Study record, TK and target-organ assessment" },
  { step: "04", title: "Human translation", tag: "Layer 4", icon: <FileCheck2 size={17} />, body: "Bring points of departure, exposure margins, MABEL and HED into one constrained first-in-human planning record without treating a simulation as a completed study.", output: "Starting-dose rationale and filing-readiness view" },
];

const SOURCE_GROUPS = [
  { category: "Chemical identity & structure", sources: ["RDKit.js", "PubChem", "ChEMBL", "UniProt", "RCSB PDB", "AlphaFold DB"], use: "Identity, structure normalisation, descriptors, biological activity, protein and pocket context." },
  { category: "Mechanistic & biological evidence", sources: ["STRING", "KEGG", "Reactome", "ToxCast / Tox21", "PharmGKB", "DisGeNET", "gnomAD"], use: "Networks, pathways, assay context, pharmacogenomics, gene–disease and population constraint." },
  { category: "Nonclinical & exposure evidence", sources: ["EPA ToxRefDB", "EPA ToxValDB", "ECOTOX", "PK-DB", "ICH", "OECD", "ARRIVE 2.0"], use: "Hazard anchors, observed PK context, study design, reporting and welfare standards." },
  { category: "Regulatory & clinical landscape", sources: ["openFDA / Drugs@FDA", "ClinicalTrials.gov", "FDA guidance", "EMA guidance", "EU Directive 2010/63"], use: "Approval precedent, labels, registered studies, human-translation and animal-welfare context." },
];

const METHODS = [
  { icon: <Atom size={18} />, title: "Structure-derived chemistry", body: "Browser-side RDKit parsing, canonicalisation, depictions and core physicochemical descriptors. No molecular structure is sent to a third party by this demonstration." },
  { icon: <Network size={18} />, title: "Evidence graph", body: "Identifiers, source status, provenance and limitations remain attached to their originating block. No blank panel is interpreted as a negative finding." },
  { icon: <FlaskConical size={18} />, title: "Model-informed exposure", body: "A 13-compartment, perfusion-limited PBPK workflow connects disposition assumptions to cohort and tissue exposure rather than showing isolated hazard scores." },
  { icon: <ShieldCheck size={18} />, title: "Decision controls", body: "Applicability domains, gate roles, measured overrides and stated limitations are visible at the point of use. A manual sign-off does not rewrite a result." },
];

const BOUNDARIES = [
  { title: "Hakase product layer", body: "The cascading record architecture, workflow orchestration, decision presentation, evidence handoffs and review controls are the proprietary product layer being demonstrated." },
  { title: "Public and licensed sources", body: "Public-source records retain their own terms, update cadence and limitations. Hakase reports source state and provenance; it does not claim ownership of source data." },
  { title: "Scientific boundary", body: "This demonstration calculates structure-derived properties locally and uses illustrative local heuristics for pharmacology, ADMET and study outputs. It is not a validated model suite or a substitute for GLP studies." },
];

export function Landing({ onEnter }: { onEnter: () => void }) {
  return <div className="landing platform-brief">
    <nav className="bp-nav">
      <a className="bp-brand" href="#top" aria-label={t("HakaseAI platform brief")}><img src={logo} alt="HakaseAI" /><span>{t("Platform brief")}</span></a>
      <div className="bp-nav-links">
        <a href="#workflow">{t("Workflow")}</a>
        <a href="#evidence">{t("Evidence & tools")}</a>
        <a href="#governance">{t("Governance")}</a>
      </div>
      <div className="bp-nav-actions"><LanguageSwitch /><button className="btn primary" onClick={onEnter}>{t("Open the workspace")} <ArrowRight size={15} /></button></div>
    </nav>

    <main id="top">
      <section className="bp-hero">
        <div className="bp-hero-copy">
          <p className="bp-eyebrow">{t("Preclinical decision infrastructure")}</p>
          <h1>{t("One evidence record,")}<br />{t("from structure to ")}<em>{t("first-in-human planning.")}</em></h1>
          <p className="bp-intro">{t("HakaseAI is a structured preclinical workspace for bringing chemistry, biology, exposure, safety and study-design context into a reviewable decision record. It makes model limits, evidence gaps and source provenance visible alongside every result.")}</p>
          <div className="bp-actions">
            <button className="btn primary lg" onClick={onEnter}>{t("Open the workspace")} <ArrowRight size={16} /></button>
            <a className="bp-text-link" href="#workflow">{t("Review the workflow")} <ArrowRight size={14} /></a>
          </div>
        </div>
        <aside className="bp-record" aria-label={t("Hakase evidence record summary")}>
          <div className="bp-record-head"><span>{t("Current record model")}</span><code>hakase.smallmol.v2</code></div>
          <div className="bp-record-title"><GitBranch size={18} /><div><b>{t("Controlled cascade")}</b><small>{t("Each layer inherits the signed source record.")}</small></div></div>
          <ol>
            <li><span>01</span><div><b>{t("Input identity")}</b><small>{t("SMILES, parent species, target and intended route")}</small></div><i>{t("Captured")}</i></li>
            <li><span>02</span><div><b>{t("Evidence & models")}</b><small>{t("Descriptor, assay, source and applicability context")}</small></div><i>{t("Attributed")}</i></li>
            <li><span>03</span><div><b>{t("Decision gates")}</b><small>{t("Gate-driving checks, gaps and required follow-up")}</small></div><i>{t("Constrained")}</i></li>
            <li><span>04</span><div><b>{t("Review handoff")}</b><small>{t("Complete record carried forward without re-derivation")}</small></div><i>{t("Traceable")}</i></li>
          </ol>
          <div className="bp-record-foot"><BadgeCheck size={15} /> {t("Provenance, units and limitations are part of the record—not a separate report.")}</div>
        </aside>
      </section>

      <section className="bp-band">
        <div><b>45</b><span>{t("ADMET endpoints with bands, units and applicability context")}</span></div>
        <div><b>13</b><span>{t("PBPK compartments per virtual subject")}</span></div>
        <div><b>15</b><span>{t("Mechanistic toxicology domains joined to organ exposure")}</span></div>
        <div><b>4</b><span>{t("Connected layers with an inherited review record")}</span></div>
      </section>

      <section className="bp-section bp-purpose" id="purpose">
        <div className="bp-section-intro"><p className="bp-eyebrow">{t("Purpose")}</p><h2>{t("Make preclinical reasoning inspectable.")}</h2></div>
        <div className="bp-purpose-copy"><p>{t("Drug-development teams do not need another unqualified score. They need a coherent record of what was calculated, what was measured, what a source returned, what a model can reasonably say, and what must be resolved before the next commitment.")}</p><div className="bp-purpose-grid"><div><small>{t("For teams")}</small><b>{t("Medicinal chemistry, DMPK, toxicology, translational pharmacology and programme leadership.")}</b></div><div><small>{t("For decisions")}</small><b>{t("Portfolio triage, experiment selection, virtual-study planning and first-in-human preparation.")}</b></div><div><small>{t("For review")}</small><b>{t("Named inputs, source state, evidence grade, assumption, limitation and downstream consequence.")}</b></div></div></div>
      </section>

      <section className="bp-section" id="workflow">
        <div className="bp-section-intro"><p className="bp-eyebrow">{t("Operating workflow")}</p><h2>{t("A record that becomes more specific—not less accountable—as it moves forward.")}</h2><p>{t("The next layer receives the actual result from the prior layer, including its uncertainty and provenance. Measured replacements travel forward; downstream layers do not silently recreate their own version.")}</p></div>
        <div className="bp-workflow">
          {WORKFLOW.map((item) => <article className="bp-flow-card" key={item.step}><div className="bp-flow-head"><span>{item.step}</span>{item.icon}<small>{t(item.tag)}</small></div><h3>{t(item.title)}</h3><p>{t(item.body)}</p><footer><small>{t("Primary output")}</small><b>{t(item.output)}</b></footer></article>)}
        </div>
      </section>

      <section className="bp-section bp-methods" id="methods">
        <div className="bp-section-intro"><p className="bp-eyebrow">{t("Method architecture")}</p><h2>{t("Computation is useful only when its operating conditions are visible.")}</h2></div>
        <div className="bp-method-grid">{METHODS.map((method) => <article key={method.title}><span>{method.icon}</span><h3>{t(method.title)}</h3><p>{t(method.body)}</p></article>)}</div>
      </section>

      <section className="bp-section" id="evidence">
        <div className="bp-section-intro"><p className="bp-eyebrow">{t("Evidence & tools")}</p><h2>{t("Connected to the sources a preclinical review actually needs.")}</h2><p>{t("Source blocks distinguish live, no-data, skipped and unavailable states. A source that returned no record is never presented as a statement of safety or efficacy.")}</p></div>
        <div className="bp-source-table" role="table" aria-label={t("Data sources and purpose")}>
          <div className="bp-source-row bp-source-header" role="row"><span role="columnheader">{t("Evidence domain")}</span><span role="columnheader">{t("Sources and tools")}</span><span role="columnheader">{t("How the workspace uses them")}</span></div>
          {SOURCE_GROUPS.map((group) => <div className="bp-source-row" role="row" key={group.category}><b role="cell">{t(group.category)}</b><div role="cell" className="bp-source-tags">{group.sources.map((source) => <span key={source}>{source}</span>)}</div><p role="cell">{t(group.use)}</p></div>)}
        </div>
      </section>

      <section className="bp-section bp-governance" id="governance">
        <div className="bp-section-intro"><p className="bp-eyebrow">{t("Product, IP & governance")}</p><h2>{t("Clear ownership. Clear boundaries. Clear records.")}</h2><p>{t("The platform separates Hakase’s workflow and evidence-management layer from external source data and from the experimental evidence a real programme must still generate.")}</p></div>
        <div className="bp-boundaries">{BOUNDARIES.map((boundary) => <article key={boundary.title}><BookOpenCheck size={17} /><h3>{t(boundary.title)}</h3><p>{t(boundary.body)}</p></article>)}</div>
      </section>

      <section className="bp-cta"><div><p className="bp-eyebrow">{t("Demonstration workspace")}</p><h2>{t("Review the full cascade with a live, computed example.")}</h2><p>{t("Use the workspace to inspect the record model, run a structure through the stages, edit a working structure and download the complete Layer 1 and Animal Cohort dossiers.")}</p></div><button className="btn primary lg" onClick={onEnter}>{t("Open the workspace")} <ArrowRight size={16} /></button></section>
    </main>
    <footer className="bp-footer"><span>{t("HakaseAI · standalone demonstration workspace")}</span><span>{t("Structure-derived values are calculated locally with RDKit. Pharmacology, ADMET and study outputs are illustrative local heuristics—not production models or decision-grade evidence.")}</span></footer>
  </div>;
}
