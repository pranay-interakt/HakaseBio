import { useEffect, useState, type ReactNode } from "react";
import {
  Activity, ArrowLeft, ArrowRight, Atom, BadgeCheck, Boxes, Braces, ChevronDown,
  Database, FileCheck2, GitBranch, Gauge, Layers, Lock, Microscope, Network,
  Play, Rabbit, Ruler, ScanSearch, Server, ShieldCheck, Target, TestTubes,
  TrendingDown, Webhook, Cpu, FlaskConical, Clock,
} from "lucide-react";
import hakaseLogo from "./assets/hakase-logo.png";
import { MoleculeCanvas } from "./MoleculeCanvas";
import type { Route } from "./useHashRoute";

/* ────────────────────────────────────────────────────────────────────────────
   Client-facing detail pages: The Science · Case Studies · Developers.

   Everything here is public-facing product and methodology description. It
   deliberately contains no internal endpoints beyond the documented public API
   surface, no infrastructure detail, no customer names, no unpublished results,
   and no model weights, thresholds or training-set composition.
   ──────────────────────────────────────────────────────────────────────────*/

type PageProps = { onNavigate: (route: Route) => void; onEnter: () => void };

const NAV: [Route, string][] = [
  ["science", "The science"],
  ["cases", "Case studies"],
  ["developers", "Developers"],
];

function PageShell({
  eyebrow, title, lede, children, onNavigate, onEnter, active,
}: PageProps & { eyebrow: string; title: string; lede: string; children: ReactNode; active: Route }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lp lp-page">
      <div className="lp-ambient" aria-hidden>
        <div className="lp-grid" />
        <div className="lp-orb o1" /><div className="lp-orb o2" />
      </div>

      <header className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="lp-nav-inner">
          <button className="lp-brand" onClick={() => onNavigate("")} aria-label="HakaseAI home">
            <img src={hakaseLogo} alt="HakaseAI" />
          </button>
          <nav className="lp-nav-links">
            {NAV.map(([id, label]) => (
              <button key={id} className={active === id ? "is-active" : ""} onClick={() => onNavigate(id)}>{label}</button>
            ))}
          </nav>
          <button className="lp-btn lp-btn-primary lp-nav-cta" onClick={onEnter}>
            <Play size={14} fill="currentColor" /> Launch workspace
          </button>
        </div>
      </header>

      <main>
        <section className="lp-page-hero">
          <button className="lp-back" onClick={() => onNavigate("")}><ArrowLeft size={15} /> Back to overview</button>
          <span className="lp-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{lede}</p>
        </section>
        {children}
        <section className="lp-page-cta">
          <div className="lp-page-cta-inner">
            <div className="lp-page-cta-viz"><MoleculeCanvas /></div>
            <div>
              <h2>Run a candidate through it</h2>
              <p>Bring a structure and a target. The cascade returns a decision-grade read with every value carrying its source.</p>
              <div className="lp-page-cta-row">
                <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={onEnter}>
                  <Play size={16} fill="currentColor" /> Launch workspace
                </button>
                {NAV.filter(([id]) => id !== active).map(([id, label]) => (
                  <button key={id} className="lp-btn lp-btn-ghost lp-btn-lg" onClick={() => onNavigate(id)}>
                    {label} <ArrowRight size={15} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-page-foot">
        <span>© {new Date().getFullYear()} HakaseAI</span>
        <span className="lp-page-foot-note">
          Screening projections for research decision support. Not a substitute for experimental
          pharmacokinetics, a regulatory submission, or clinical judgement.
        </span>
      </footer>
    </div>
  );
}

/* ══════════════════════════ The Science ══════════════════════════ */

const METHODS = [
  {
    layer: "Layer 1", icon: <Atom size={19} />,
    term: "Physicochemistry & drug-likeness",
    short: "The numbers that decide whether a molecule can behave like a drug at all.",
    long: "Molecular weight, logP, topological polar surface area, hydrogen-bond donors and acceptors, and rotatable-bond count are computed from the structure and evaluated against Lipinski's Rule of Five and Veber's criteria — the empirical thresholds associated with oral absorption and bioavailability.",
    why: "These rules are heuristics, not laws. Plenty of approved drugs violate one. We treat a failure as a flag that a specific downstream liability is more likely, and we name which one — never as a standalone verdict.",
    outputs: ["Descriptor table with each threshold", "Named rule violations", "Absorption-risk narrative"],
  },
  {
    layer: "Layer 1", icon: <Network size={19} />,
    term: "ADMET profiling",
    short: "Absorption, distribution, metabolism, excretion and toxicity, modelled before the assay.",
    long: "An ensemble of endpoint models predicts the pharmacokinetic and safety fingerprint of a structure. Each endpoint is reported with its unit, a plain-language assessment, and an applicability flag indicating whether the compound sits inside the chemistry the model was trained on.",
    why: "A confident number from a model asked about chemistry it has never seen is the most dangerous output in this field. Surfacing the applicability flag alongside every value is what makes the prediction usable rather than merely available.",
    outputs: ["Endpoint predictions with units", "Per-endpoint applicability verdict", "Absorption / distribution / metabolism / excretion / toxicity grouping"],
  },
  {
    layer: "Layer 1", icon: <Target size={19} />,
    term: "Target resolution & selectivity",
    short: "Which protein it hits, how hard, and what else it might touch.",
    long: "A candidate target is resolved to a canonical protein accession and, where one exists, an experimental structure. Measured potency (IC50 / Ki / Kd) is drawn from curated public bioactivity data. Off-target selectivity is assessed by read-across from structurally related compounds carrying independent measurements.",
    why: "When there are too few analogues to support an honest selectivity claim, the layer returns 'insufficient evidence' rather than a number. An absent answer you can act on beats a fabricated one you cannot.",
    outputs: ["Canonical target identity", "Measured potency with citation", "Analogue read-across or an explicit evidence gap"],
  },
  {
    layer: "Layer 2", icon: <ShieldCheck size={19} />,
    term: "Applicability domain & structural alerts",
    short: "Knowing when a model is out of its depth.",
    long: "Structural similarity to the training distribution is measured and predictions falling outside it are flagged. Substructure screens surface fragments associated with assay interference or reactive liabilities.",
    why: "Structural alerts are flags for human review, explicitly not experimental proof of a problem. Several widely used drugs carry them. We show the alert and the reasoning, and leave the judgement with the chemist.",
    outputs: ["Similarity-to-domain score", "Named substructure alerts", "Confidence tier per prediction"],
  },
  {
    layer: "Layer 3", icon: <Gauge size={19} />,
    term: "IVIVE — in-vitro to in-vivo extrapolation",
    short: "Turning bench measurements into whole-body behaviour.",
    long: "Intrinsic clearance measured in hepatocytes or microsomes is scaled to a whole-organ clearance using species-specific physiology — liver weight, hepatocellularity, hepatic blood flow — and corrected for plasma protein binding and blood-to-plasma partitioning.",
    why: "This is the single largest source of error in preclinical PK projection. Where a species-matched measured value exists we use it and cite it; where it does not, the layer states plainly that clearance is model-derived and flags the result as lower confidence.",
    outputs: ["Scaled clearance with provenance", "Tissue partition coefficients", "Explicit measured-vs-modelled labelling"],
  },
  {
    layer: "Layer 3", icon: <Rabbit size={19} />,
    term: "PBPK exposure & the virtual cohort",
    short: "Physiologically-based pharmacokinetics — the body as a connected system of organs.",
    long: "A whole-body model routes compound through real physiology: cardiac output distributed across organs, tissue partitioning, hepatic metabolism and renal filtration, parameterised per species and strain. A virtual cohort samples physiological and parameter variation so the output is a distribution rather than a single deterministic line.",
    why: "Reporting one curve implies a precision the underlying data does not support. The uncertainty ribbon is the honest form of the answer, and the summary metrics are reported as medians with intervals.",
    outputs: ["Concentration–time profile with uncertainty band", "Cmax, AUC, half-life, clearance, volume of distribution", "Per-tissue exposure"],
  },
  {
    layer: "Layer 3", icon: <ScanSearch size={19} />,
    term: "Safety anchors & margins",
    short: "How much room there is between an efficacious dose and a harmful one.",
    long: "Where a measured no-observed-adverse-effect level exists in public in-vivo data it is used directly. Where it does not, a published anchor is scaled across species using body-surface-area allometry, carrying an explicit interspecies uncertainty interval.",
    why: "A quantitative safety threshold is never invented. If no anchor can be located, the layer reports qualitative hazard flags and says so — an absent margin is reported as absent.",
    outputs: ["Measured anchor where available", "Allometrically scaled estimate with its interval", "Per-dose-group margins"],
  },
  {
    layer: "Layer 4", icon: <Ruler size={19} />,
    term: "NOAEL → human-equivalent dose",
    short: "From the highest safe animal dose to a defensible human starting dose.",
    long: "The no-observed-adverse-effect level is converted to a human-equivalent dose using established allometric relationships, then divided by explicit safety factors to reach a maximum recommended starting dose. Uncertainty propagates through every step.",
    why: "The value of this number is entirely in its assumptions being visible. We show the anchor, the scaling basis, each safety factor and the resulting range, aligned to published regulatory guidance — so it can be argued with.",
    outputs: ["Human-equivalent dose range", "Every safety factor, named", "Regulatory-guidance-aligned rationale"],
  },
];

const EVIDENCE_TIERS = [
  { label: "Measured", cls: "badge-measured", desc: "A real experimental value drawn from curated primary literature or a supplied in-house measurement, carrying its citation. Used directly and never inferred." },
  { label: "ML-predicted", cls: "badge-ml", desc: "A model prediction, always accompanied by its applicability verdict so out-of-domain chemistry is visible rather than quietly trusted." },
  { label: "Assumed", cls: "badge-assumed", desc: "A documented default or literature heuristic, labelled as such. Never presented as a measurement or a prediction." },
];

const SOURCES = [
  { icon: <Database size={17} />, name: "ChEMBL", role: "Curated bioactivity, measured potency and analogue read-across" },
  { icon: <GitBranch size={17} />, name: "UniProt", role: "Canonical protein target identity and accessions" },
  { icon: <Boxes size={17} />, name: "Protein Data Bank", role: "Experimental three-dimensional structures for docking and structural context" },
  { icon: <Cpu size={17} />, name: "Open ADMET models", role: "Ensemble endpoint predictions with published benchmarks" },
  { icon: <FileCheck2 size={17} />, name: "Public regulatory records", role: "Exact-structure matching against approved-drug labelling" },
  { icon: <Activity size={17} />, name: "Pharmacovigilance data", role: "Real-world adverse-event signal for calibration" },
  { icon: <Microscope size={17} />, name: "Public expression atlases", role: "Tissue-level context for target and liability reasoning" },
  { icon: <TestTubes size={17} />, name: "Public toxicology & assay data", role: "In-vivo anchors and bioactivity evidence for the animal layer" },
];

export function SciencePage(props: PageProps) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <PageShell
      {...props}
      active="science"
      eyebrow="Methodology"
      title="The science behind every number"
      lede="Each layer is a named, published method with a stated failure mode. This page describes what we compute, why that method, and — just as importantly — where it stops being trustworthy."
    >
      <section className="lp-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Methods</span>
          <h2>What runs, layer by layer</h2>
          <p>Eight methods carry a candidate from a structure to a human dose rationale. Expand any one for the reasoning and its limits.</p>
        </div>
        <div className="lp-method-list">
          {METHODS.map((m, i) => (
            <article key={m.term} className={`lp-method ${open === i ? "is-open" : ""}`}>
              <button className="lp-method-head" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span className="lp-method-icon">{m.icon}</span>
                <div className="lp-method-title">
                  <span className="lp-method-layer">{m.layer}</span>
                  <b>{m.term}</b>
                  <small>{m.short}</small>
                </div>
                <ChevronDown size={18} className="lp-method-chev" />
              </button>
              {open === i && (
                <div className="lp-method-body">
                  <p>{m.long}</p>
                  <div className="lp-method-why">
                    <b>Where it stops being trustworthy</b>
                    <p>{m.why}</p>
                  </div>
                  <div className="lp-method-outputs">
                    <b>What you get back</b>
                    <ul>{m.outputs.map((o) => <li key={o}><BadgeCheck size={13} /> {o}</li>)}</ul>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-tier-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Evidence grading</span>
          <h2>Every value is tiered</h2>
          <p>The tier travels with the number, into the UI and into the API response. A reader can always tell what kind of thing they are looking at.</p>
        </div>
        <div className="lp-tier-grid">
          {EVIDENCE_TIERS.map((t) => (
            <article key={t.label} className="lp-tier-card">
              <span className={`prov-badge ${t.cls}`}>{t.label}</span>
              <p>{t.desc}</p>
            </article>
          ))}
        </div>
        <div className="lp-tier-note">
          <Lock size={16} />
          <p>
            When the evidence to answer a question honestly is not present, the layer returns an explicit
            gap — <em>insufficient evidence</em>, <em>not predicted</em>, <em>no anchor located</em> — rather than
            a plausible-looking value. An absent answer you can act on is worth more than a confident one you cannot verify.
          </p>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Provenance</span>
          <h2>Where the evidence comes from</h2>
          <p>Public, curated, citable sources. Every value traces back to one of them.</p>
        </div>
        <div className="lp-source-grid">
          {SOURCES.map((s) => (
            <div key={s.name} className="lp-source-card">
              <span className="lp-source-icon">{s.icon}</span>
              <div><b>{s.name}</b><small>{s.role}</small></div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-section lp-limits-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Honest limits</span>
          <h2>What this platform does not do</h2>
          <p>Stated plainly, because a tool that overstates its reach costs more than one that under-promises.</p>
        </div>
        <div className="lp-limit-grid">
          <article><b>It does not replace in-vivo study</b><p>Every projection is a screening read intended to prioritise and de-risk experimental work, not to substitute for it. Regulatory submissions require real data.</p></article>
          <article><b>It does not simulate pathology</b><p>Histopathology, clinical chemistry and organ-weight findings are not generated. There is no defensible basis to invent them for a novel compound, so we do not.</p></article>
          <article><b>It does not predict clinical efficacy</b><p>Target engagement is a mechanistic estimate of occupancy from free drug and binding affinity. Occupancy is not efficacy, and the distinction is preserved throughout.</p></article>
          <article><b>It does not hide uncertainty</b><p>Where a model is extrapolating beyond its trained chemistry or across species, the output is flagged as lower confidence and the reason is named.</p></article>
        </div>
      </section>
    </PageShell>
  );
}

/* ══════════════════════════ Case studies ══════════════════════════ */

const CASES = [
  {
    verdict: "NO-GO", tone: "bad" as const, icon: <TrendingDown size={18} />,
    kicker: "Stopped at Layer 1",
    title: "An early hit carrying a hidden cardiac liability",
    context: "A virtual-screening campaign returned a series of hits ranked on predicted potency alone. One scaffold looked clean on every metric the screen had reported and was queued for a full assay panel.",
    what: "Layer 1 resolved the target, computed the physicochemical profile, and ran the ADMET ensemble. It surfaced a strong cardiac ion-channel liability on the scaffold together with a substructure alert associated with assay interference — both on the same core, both before any plate was ordered.",
    outcome: "The team redirected a planned assay cohort away from the scaffold and prioritised a structurally distinct series from the same screen. The alert was carried forward as a documented reason, not a silent deprioritisation.",
    stats: [["Under a minute", "to the flag"], ["One assay cohort", "redirected"]],
    caveat: "A structural alert is a prompt for review, not proof of failure. The value here was in surfacing a question early enough that answering it was cheap.",
  },
  {
    verdict: "WATCH", tone: "warn" as const, icon: <ScanSearch size={18} />,
    kicker: "Escalated to confirmation",
    title: "A kinase inhibitor resting on a single binding measurement",
    context: "The candidate cleared drug-likeness comfortably and had an attractive potency figure. That figure came from one measurement in one assay format, with no orthogonal support.",
    what: "Rather than pass or fail it, Layer 2 pulled analogue read-across from structurally related compounds with independent measurements, checked applicability domain, and tiered the potency claim as moderate-confidence with the evidence gap named explicitly.",
    outcome: "The team ran one targeted confirmatory assay instead of a full panel. The read-across had identified precisely which question remained open, so the experiment was designed to answer that and nothing else.",
    stats: [["Three", "independent lines of evidence"], ["One assay", "instead of a panel"]],
    caveat: "Read-across is inference from neighbours, not measurement. It narrows what you need to test; it does not remove the need to test.",
  },
  {
    verdict: "GO", tone: "good" as const, icon: <BadgeCheck size={18} />,
    kicker: "Carried to first-in-human planning",
    title: "A repurposing candidate with a defensible starting dose",
    context: "A known chemotype was being considered for a new indication. The team needed a dose rationale they could defend in an IND-enabling planning meeting, built from evidence rather than analogy.",
    what: "Layer 1 matched the structure against public regulatory records. Layer 3 projected multi-species exposure and located a measured in-vivo safety anchor. Layer 4 scaled that anchor to a human-equivalent dose with each safety factor stated separately.",
    outcome: "The programme entered planning with a documented dose range, a named anchor behind it, and a provenance trail on every intermediate value — so each assumption could be challenged individually rather than the whole number being taken on trust.",
    stats: [["Four of four", "layers cleared"], ["Every value", "provenance-traced"]],
    caveat: "A dose rationale is a starting point for regulatory discussion, not an approval. The safety factors remain a judgement call the sponsor owns.",
  },
];

export function CaseStudiesPage(props: PageProps) {
  return (
    <PageShell
      {...props}
      active="cases"
      eyebrow="In practice"
      title="Three ways the cascade changes a decision"
      lede="Illustrative scenarios showing how the layers behave on the three outcomes that matter — stop, investigate, proceed. They are composites drawn from typical preclinical workflows, not accounts of identified programmes."
    >
      <section className="lp-section">
        <div className="lp-case-list">
          {CASES.map((c) => (
            <article key={c.title} className={`lp-case lp-case-${c.tone}`}>
              <header>
                <span className="lp-case-icon">{c.icon}</span>
                <div>
                  <span className="lp-case-kicker">{c.kicker}</span>
                  <h3>{c.title}</h3>
                </div>
                <span className={`lp-case-verdict lp-case-verdict-${c.tone}`}>{c.verdict}</span>
              </header>
              <div className="lp-case-body">
                <div className="lp-case-block"><b>The situation</b><p>{c.context}</p></div>
                <div className="lp-case-block"><b>What the platform did</b><p>{c.what}</p></div>
                <div className="lp-case-block"><b>What changed</b><p>{c.outcome}</p></div>
              </div>
              <div className="lp-case-stats">
                {c.stats.map(([v, l]) => <div key={l}><b>{v}</b><small>{l}</small></div>)}
              </div>
              <div className="lp-case-caveat"><ShieldCheck size={14} /><span>{c.caveat}</span></div>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-honest-section">
        <div className="lp-honest">
          <FlaskConical size={22} />
          <div>
            <h2>A note on these examples</h2>
            <p>
              These are composite scenarios written to show the shape of the decision each layer supports.
              They are not case reports of named compounds or customers, they carry no confidential programme
              detail, and the figures describe workflow impact rather than validated predictive performance.
              Method-level validation is described on <button className="lp-inline-link" onClick={() => props.onNavigate("science")}>The science</button>.
            </p>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

/* ══════════════════════════ Developers ══════════════════════════ */

const MODES = [
  { mode: "Single", icon: <Play size={16} />, desc: "One molecule, synchronous. A full Layer 1 read returns in seconds — suitable for interactive use inside an existing tool.", detail: "Send a structure and a target. Get back the complete layer response with every value tiered." },
  { mode: "Batch", icon: <Layers size={16} />, desc: "Asynchronous processing with job identifiers and webhook callbacks, for library-scale triage.", detail: "Submit a set, receive a job handle, get called back on completion. Designed for screening-cascade volumes." },
  { mode: "Cascade", icon: <GitBranch size={16} />, desc: "Every layer runs in one orchestrated call and returns a sealed, provenance-carried package.", detail: "The full preclinical read — in-vitro, confirmation, exposure and dose rationale — as a single artefact." },
];

const DEV_FEATURES = [
  { icon: <Braces size={18} />, title: "Typed, versioned JSON", desc: "Predictable response schemas with a declared version. Every value carries its source, unit, evidence tier and assessment in the same object you already parse." },
  { icon: <Webhook size={18} />, title: "Webhook callbacks", desc: "Fire-and-forget batch and cascade jobs that call you back with a result payload, so you are not holding a connection open across a long run." },
  { icon: <Server size={18} />, title: "Vendor-neutral contract", desc: "Plugs into generative design, virtual screening, or in-house medicinal chemistry. An open contract with no requirement to adopt the rest of the stack." },
  { icon: <FileCheck2 size={18} />, title: "Provenance in the payload", desc: "The audit trail is not a separate export you have to reconcile later — it ships inside the response, attached to the value it describes." },
  { icon: <ShieldCheck size={18} />, title: "Explicit failure modes", desc: "An unavailable result returns a structured reason and the list of missing inputs, never a silent default or a plausible-looking placeholder." },
  { icon: <Lock size={18} />, title: "Structural IP stays local", desc: "Deployment options keep candidate structures inside your own environment. What leaves your machine is a decision you make, not one the platform makes for you." },
];

const INTEGRATION = [
  { icon: <Clock size={17} />, title: "Triage a generative output stream", body: "Score structures as they come off a generative model and keep only what survives the first gate — before any of it reaches a chemist's queue." },
  { icon: <Target size={17} />, title: "Pre-filter a screening library", body: "Run a library through Layer 1 and rank by evidence quality, not just predicted potency, so the assay budget goes to the compounds worth measuring." },
  { icon: <Gauge size={17} />, title: "Attach exposure context to a hit list", body: "Carry hits into cross-species exposure projection so the medchem conversation starts with pharmacokinetics rather than discovering it later." },
  { icon: <FileCheck2 size={17} />, title: "Assemble a dose rationale", body: "Pull the sealed cascade package into an internal report with the provenance trail intact and every assumption individually reviewable." },
];

export function DevelopersPage(props: PageProps) {
  return (
    <PageShell
      {...props}
      active="developers"
      eyebrow="Build with it"
      title="An API designed to be parsed, not screenshotted"
      lede="Every response is typed, versioned and self-describing. The provenance that makes an output defensible travels inside the payload, so whatever you build on top inherits it automatically."
    >
      <section className="lp-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Access modes</span>
          <h2>Three ways to call it</h2>
          <p>Interactive, batch, or the full cascade — same contract, same tiering, different concurrency model.</p>
        </div>
        <div className="lp-mode-grid">
          {MODES.map((m) => (
            <article key={m.mode} className="lp-mode-card">
              <div className="lp-mode-head"><span className="lp-mode-icon">{m.icon}</span><b>{m.mode}</b></div>
              <p>{m.desc}</p>
              <small>{m.detail}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">What you get</span>
          <h2>Contract guarantees</h2>
          <p>The things that stay true across versions, because integrations depend on them.</p>
        </div>
        <div className="lp-devfeat-grid">
          {DEV_FEATURES.map((f) => (
            <article key={f.title} className="lp-devfeat">
              <span className="lp-devfeat-icon">{f.icon}</span>
              <b>{f.title}</b>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-shape-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Response shape</span>
          <h2>What a value looks like</h2>
          <p>Every numeric field carries the same envelope, whichever layer produced it.</p>
        </div>
        <div className="lp-code-card">
          <div className="lp-code-head"><Braces size={14} /> <span>Value envelope</span></div>
          <pre>{`{
  "value":      2.4,
  "units":      "mL/min/kg",
  "provenance": "measured",
  "source":     "curated primary literature, cited",
  "ci_low":     1.8,
  "ci_high":    3.1
}`}</pre>
        </div>
        <p className="lp-code-note">
          <code>provenance</code> is a closed vocabulary — measured, ML-predicted, reference, assumed, or derived —
          so a consumer can branch on evidence quality without parsing prose. A derived value inherits the weakest
          provenance of its inputs. Confidence bounds are present when an interval has been computed and honestly
          absent when it has not, rather than being filled with a fabricated range.
        </p>
      </section>

      <section className="lp-section">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Integration patterns</span>
          <h2>Where teams plug it in</h2>
          <p>The four places it tends to earn its keep first.</p>
        </div>
        <div className="lp-integration-grid">
          {INTEGRATION.map((p) => (
            <article key={p.title} className="lp-integration">
              <span className="lp-integration-icon">{p.icon}</span>
              <div><b>{p.title}</b><p>{p.body}</p></div>
            </article>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
