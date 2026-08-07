import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Atom,
  BadgeCheck,
  BookOpen,
  Boxes,
  Braces,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Clock,
  Code2,
  Cpu,
  Database,
  FileCheck2,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers,
  Lock,
  Microscope,
  Minus,
  Network,
  Play,
  Rabbit,
  Ruler,
  ScanSearch,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  TestTubes,
  TrendingDown,
  Webhook,
  Zap,
} from "lucide-react";
import hakaseLogo from "./assets/hakase-logo.png";
import { MoleculeCanvas } from "./MoleculeCanvas";
import type { Route } from "./useHashRoute";

/* ────────────────────────────────────────────────────────────────────────────
   Landing page · HakaseAI — the pre-clinical BioDigital Twin
   Pure presentation. Every scientific claim mirrors what the layers below the
   fold actually compute; nothing here is a live calculation.
   ──────────────────────────────────────────────────────────────────────────*/

/* Scroll-in reveal — a tiny IntersectionObserver hook, no animation library. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((entry) => { if (entry.isIntersecting) { setShown(true); io.disconnect(); } }),
      { threshold: 0.12, rootMargin: "-40px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`lp-reveal ${shown ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const layerStyle = (l: 1 | 2 | 3 | 4) =>
  ({ ["--lc" as string]: `var(--lp-l${l})`, ["--lsoft" as string]: `var(--lp-l${l}-soft)`, ["--lline" as string]: `var(--lp-l${l}-line)` }) as CSSProperties;

/* ── Data ─────────────────────────────────────────────────────────────────*/
const STATS = [
  { val: "~90%", label: "of drugs entering the clinic still fail" },
  { val: "$2–5M", label: "of spend to reach a single IND filing" },
  { val: "12–18 mo", label: "of pre-clinical work before a go / no-go" },
  { val: "$1–2B", label: "fully-loaded cost per approved drug" },
];

const PILLARS = [
  {
    l: 1 as const,
    icon: <Zap size={18} />,
    label: "Triage faster",
    headline: "A defensible go / no-go in days, not quarters.",
    desc: "Front-load months of pre-clinical triage into one orchestrated read, so wet-lab assays and animal cohorts only ever go to molecules that have already earned the spend.",
    metric: "Days",
    metricLabel: "to a first go / no-go read",
  },
  {
    l: 2 as const,
    icon: <ShieldCheck size={18} />,
    label: "Defensible by design",
    headline: "Regulator-aligned reasoning at every gate.",
    desc: "Conservative dosing rationale, allometric scaling aligned to published guidance, and a full provenance trail on every value — built to survive scientific and regulatory scrutiny.",
    metric: "ICH · FDA · EMA",
    metricLabel: "frameworks referenced",
  },
  {
    l: 4 as const,
    icon: <Lock size={18} />,
    label: "Private by construction",
    headline: "Structural IP never leaves your machine.",
    desc: "Molecular structures are handled client-side. The platform only ever receives one-way derived signals — there is no path back to your candidate from anything we store.",
    metric: "0 bytes",
    metricLabel: "of structural IP transmitted",
  },
];

const LAYERS = [
  {
    l: 1 as const,
    icon: <FlaskConical size={20} />,
    tag: "Layer 1",
    name: "In Vitro Twin",
    question: "Is this molecule even worth the bench?",
    body: "Canonicalises the structure, computes physicochemistry and drug-likeness, resolves a biological target, screens ADMET and safety liabilities, and returns a GO / WATCH / NO-GO verdict with the checks that drove it.",
    points: ["Physicochemical & drug-likeness descriptors", "Target resolution + off-target selectivity", "ADMET-AI endpoint ensemble", "PAINS / Brenk structural alerts", "Regulatory record match (Drugs@FDA)"],
  },
  {
    l: 2 as const,
    icon: <ScanSearch size={20} />,
    tag: "Layer 2",
    name: "Confirmation",
    question: "How hard should we trust the binding story?",
    body: "Takes candidates that clear Layer 1 into orthogonal confirmation — deeper binding evidence, virtual assays and read-across from structurally related compounds — so a single soft signal never carries a program.",
    points: ["Orthogonal binding confirmation", "Analogue read-across from measured data", "Virtual assay panel", "Confidence tiering on every result"],
  },
  {
    l: 3 as const,
    icon: <Rabbit size={20} />,
    tag: "Layer 3",
    name: "Animal Cohort & Exposure",
    question: "What will the body actually do with it?",
    body: "A multi-species PBPK engine projects whole-body concentration–time behaviour and orchestrates a virtual preclinical study — dose groups, target coverage, safety margins and a stage-gate recommendation over the disposition evidence.",
    points: ["Multi-species PBPK exposure (Cmax, AUC, t½, CL)", "Virtual dose-group study design", "Target coverage & safety margins", "Public animal evidence (ChEMBL, EPA, PubChem)"],
  },
  {
    l: 4 as const,
    icon: <Activity size={20} />,
    tag: "Layer 4",
    name: "First-in-Human Readiness",
    question: "What is a defensible starting dose?",
    body: "Derives a human-equivalent dose from NOAEL with explicit safety factors and propagated uncertainty, calibrated against real-world pharmacovigilance signal for the nearest reference class — a range, never a bare point estimate.",
    points: ["NOAEL → HED allometric scaling", "Explicit safety factors + uncertainty", "Real-world AE calibration", "Regulator-aligned dose rationale"],
  },
];



const DATA_SOURCES = [
  { icon: <Database size={16} />, name: "ChEMBL", role: "Curated bioactivity, potency & analogue read-across" },
  { icon: <GitBranch size={16} />, name: "UniProt", role: "Canonical protein target identity & accessions" },
  { icon: <Boxes size={16} />, name: "PDB", role: "Experimental 3-D structures for docking & context" },
  { icon: <Cpu size={16} />, name: "ADMET-AI", role: "Ensemble ADMET endpoint predictions" },
  { icon: <FileCheck2 size={16} />, name: "Drugs@FDA & labels", role: "Exact-structure regulatory record matching" },
  { icon: <Activity size={16} />, name: "Pharmacovigilance", role: "Real-world adverse-event calibration signal" },
  { icon: <TestTubes size={16} />, name: "EPA · PubChem", role: "Public animal & assay evidence for Layer 3" },
];

const TIERS = [
  { key: "measured", label: "Measured", cls: "badge-measured", desc: "A real experimental value from curated primary data. The highest-trust tier — used directly, never inferred." },
  { key: "ml", label: "ML-predicted", cls: "badge-ml", desc: "A model prediction carried with its applicability flag, so out-of-domain chemistry is visible rather than hidden." },
  { key: "assumed", label: "Assumed", cls: "badge-assumed", desc: "A documented default or heuristic, clearly labelled — never dressed up as a measurement or a prediction." },
];



const COMPARE: { feature: string; hakase: boolean | string; cro: boolean | string; generic: boolean | string }[] = [
  { feature: "Time to first go / no-go", hakase: "Days", cro: "Months", generic: "Hours" },
  { feature: "Cross-species PBPK exposure", hakase: true, cro: true, generic: false },
  { feature: "First-in-human dose rationale", hakase: true, cro: true, generic: false },
  { feature: "Provenance & audit trail on every value", hakase: true, cro: "Partial", generic: false },
  { feature: "Structural IP stays on your machine", hakase: true, cro: false, generic: "Varies" },
  { feature: "Regulator-aligned reasoning", hakase: true, cro: true, generic: false },
  { feature: "Confidence tiering (never over-claims)", hakase: true, cro: "Partial", generic: false },
  { feature: "Cost per candidate screened", hakase: "Low", cro: "Very high", generic: "Low" },
];

function CompareCell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="lp-cmp-yes"><CircleCheck size={16} /></span>;
  if (value === false) return <span className="lp-cmp-no"><Minus size={16} /></span>;
  return <span className="lp-cmp-txt">{value}</span>;
}

/** In-page anchors stay as scroll targets; the three detail sections are now pages. */
const NAV_LINKS: [string, string][] = [
  ["layers", "Platform"],
  ["compare", "Why Hakase"],
];

const NAV_PAGES: [Route, string][] = [
  ["science", "The science"],
  ["cases", "Case studies"],
  ["developers", "Developers"],
];

export function Landing({ onEnter, onNavigate }: { onEnter: () => void; onNavigate: (route: Route) => void }) {
  const [expanded, setExpanded] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);
  const [openScience, setOpenScience] = useState<number | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="lp">
      <div className="lp-ambient" aria-hidden>
        <div className="lp-grid" />
        <div className="lp-orb o1" /><div className="lp-orb o2" /><div className="lp-orb o3" />
      </div>

      {/* ── Nav ── */}
      <header className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
        <div className="lp-nav-inner">
          <button className="lp-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="HakaseAI home">
            <img src={hakaseLogo} alt="HakaseAI" />
          </button>
          <nav className="lp-nav-links">
            {NAV_LINKS.map(([id, label]) => <button key={id} onClick={() => go(id)}>{label}</button>)}
            {NAV_PAGES.map(([id, label]) => <button key={id} onClick={() => onNavigate(id)}>{label}</button>)}
          </nav>
          <button className="lp-btn lp-btn-primary lp-nav-cta" onClick={onEnter}>
            <Play size={14} fill="currentColor" /> Launch workspace
          </button>
        </div>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="lp-hero">
          <div className="lp-hero-inner">
            <Reveal className="lp-hero-badge-wrap">
              <span className="lp-badge"><Sparkles size={13} /> The pre-clinical BioDigital Twin</span>
            </Reveal>
            <h1 className="lp-hero-title">
              <span className="lp-fade-1">See what your pre-clinical</span><br />
              <span className="lp-fade-2">program will show — <span className="lp-em">before</span></span><br />
              <span className="lp-fade-3">you fund it.</span>
            </h1>
            <p className="lp-hero-sub lp-fade-3">
              One in-silico cascade carries a candidate through four pre-clinical layers — property, confirmation,
              cross-species exposure and first-in-human dosing — and returns a decision-grade read on whether it's
              worth the bench, the animals and the months.
            </p>
            <div className="lp-hero-cta lp-fade-4">
              <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={onEnter}>
                <Play size={16} fill="currentColor" /> Run a candidate
              </button>
              <button className="lp-btn lp-btn-ghost lp-btn-lg" onClick={() => go("layers")}>
                How it works <ArrowRight size={16} />
              </button>
            </div>
            {/* Chips rather than divider-separated text — they wrap cleanly at
                any width instead of stranding a separator at the line break. */}
            <div className="lp-trust lp-fade-4">
              <span><Lock size={14} /> Structural IP stays local</span>
              <span><ShieldCheck size={14} /> Governed & audit-trailed</span>
              <span><Layers size={14} /> Source-quality tiered</span>
            </div>
          </div>

          {/* Hero visual — rotating molecule */}
          <Reveal className="lp-hero-visual" delay={120}>
            <div className="lp-molecule-stage">
              <div className="lp-molecule-glow" aria-hidden />
              <MoleculeCanvas />
              <div className="lp-molecule-ring" aria-hidden />
            </div>
          </Reveal>
        </section>

        {/* ── Stats ── */}
        <section className="lp-section lp-stats-section">
          <Reveal className="lp-stats">
            {STATS.map(({ val, label }) => (
              <div key={label} className="lp-stat">
                <div className="lp-stat-val">{val}</div>
                <div className="lp-stat-label">{label}</div>
              </div>
            ))}
          </Reveal>
          <Reveal className="lp-stats-note" delay={80}>
            <p>Pre-clinical is where most of the risk — and most of the wasted spend — actually lives. Hakase is built to spend that risk in software first.</p>
          </Reveal>
        </section>

        {/* ── Value pillars ── */}
        <section className="lp-section">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow">Why teams run it</span>
            <h2>A pre-clinical edge, end to end</h2>
            <p>Three things every pre-clinical program needs, and one platform that delivers them together.</p>
          </Reveal>
          <div className="lp-pillars">
            {PILLARS.map((p, i) => (
              <Reveal key={p.label} delay={i * 90}>
                <article className="lp-pillar" style={layerStyle(p.l)}>
                  <span className="lp-pillar-icon">{p.icon}</span>
                  <span className="lp-pillar-label">{p.label}</span>
                  <h3>{p.headline}</h3>
                  <p>{p.desc}</p>
                  <div className="lp-pillar-metric">
                    <b>{p.metric}</b>
                    <small>{p.metricLabel}</small>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── The wet lab's twin (feature) ── */}
        <section className="lp-section">
          <div className="lp-feature">
            <Reveal className="lp-feature-visual">
              <div className="lp-twin-card">
                <div className="lp-twin-badge"><Microscope size={14} /> Wet lab</div>
                <div className="lp-twin-vs">↔</div>
                <div className="lp-twin-badge alt"><Cpu size={14} /> In-silico twin</div>
                <div className="lp-twin-rows">
                  {[["Absorption", 1], ["Binding", 2], ["Exposure", 3], ["Safe dose", 4]].map(([q, l]) => (
                    <div key={q as string} className="lp-twin-row" style={layerStyle(l as 1 | 2 | 3 | 4)}>
                      <span className="lp-twin-q">{q}</span>
                      <span className="lp-twin-bar"><i /></span>
                      <CircleCheck size={15} className="lp-twin-check" />
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal delay={90}>
              <div className="lp-feature-copy">
                <span className="lp-eyebrow">The twin, before the bench</span>
                <h2>Every question a candidate must answer — modelled in software first.</h2>
                <p>
                  Absorption, binding, safety, dosing — each one simulated before you commit a plate, a cohort or a
                  quarter. Bring a molecule and a target; get back a defensible read on whether it's worth the assays,
                  the animals and the months.
                </p>
                <p className="lp-feature-strong">
                  Hakase doesn't replace your IND-enabling studies. It tells you which are worth running, flags the
                  liabilities before they cost you a cohort, and keeps your structural IP on your own machine while it
                  does.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Four-layer cascade ── */}
        <section id="layers" className="lp-section">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow">The platform</span>
            <h2>From candidate to IND-ready, in four layers</h2>
            <p>Each layer answers exactly one question, seals its evidence, and hands it forward. Open a layer to see what it computes.</p>
          </Reveal>
          <div className="lp-layers">
            {LAYERS.map((layer, i) => {
              const open = expanded === i;
              return (
                <Reveal key={layer.l} delay={i * 70}>
                  <article className={`lp-layer ${open ? "open" : ""}`} style={layerStyle(layer.l)}>
                    <button className="lp-layer-head" onClick={() => setExpanded(open ? null : i)} aria-expanded={open}>
                      <span className="lp-layer-icon">{layer.icon}</span>
                      <div className="lp-layer-heading">
                        <span className="lp-layer-tag">{layer.tag}</span>
                        <b>{layer.name}</b>
                        <small>{layer.question}</small>
                      </div>
                      <ChevronDown size={18} className="lp-layer-chev" />
                    </button>
                    <div className="lp-layer-body">
                      <div className="lp-layer-body-inner">
                        <p>{layer.body}</p>
                        <ul>
                          {layer.points.map((pt) => <li key={pt}><CircleCheck size={14} /> {pt}</li>)}
                        </ul>
                      </div>
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* ── Explore: the three detail pages ── */}
        <section id="explore" className="lp-section lp-explore-section">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow">Go deeper</span>
            <h2>The detail, on its own terms</h2>
            <p>Method, evidence and integration each get a full page rather than a paragraph.</p>
          </Reveal>
          <div className="lp-explore-grid">
            <Reveal className="lp-explore-card" delay={0}>
              <span className="lp-explore-icon"><Microscope size={20} /></span>
              <b>The science</b>
              <p>Eight named methods across four layers — what each computes, why that method, and exactly where it stops being trustworthy.</p>
              <button onClick={() => onNavigate("science")}>Read the methodology <ArrowRight size={15} /></button>
            </Reveal>
            <Reveal className="lp-explore-card" delay={70}>
              <span className="lp-explore-icon"><ScanSearch size={20} /></span>
              <b>Case studies</b>
              <p>Three scenarios covering the outcomes that matter — stop, investigate, proceed — with the reasoning behind each verdict.</p>
              <button onClick={() => onNavigate("cases")}>See the scenarios <ArrowRight size={15} /></button>
            </Reveal>
            <Reveal className="lp-explore-card" delay={140}>
              <span className="lp-explore-icon"><Code2 size={20} /></span>
              <b>Developers</b>
              <p>Typed, versioned JSON with provenance inside the payload. Access modes, contract guarantees and integration patterns.</p>
              <button onClick={() => onNavigate("developers")}>Read the API contract <ArrowRight size={15} /></button>
            </Reveal>
          </div>
        </section>


        {/* ── FOCUS 3 · Data-driven content ── */}
        <section id="data" className="lp-section">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow"><Database size={13} /> Data & provenance</span>
            <h2>Every output is graded for how much to trust it</h2>
            <p>
              The read is only as good as what it's built on. Hakase draws on curated public science, grades each value
              by source quality, and carries full provenance — so a heuristic is never dressed up as a measurement.
            </p>
          </Reveal>

          <div className="lp-data-grid">
            <Reveal className="lp-data-sources">
              <div className="lp-panel-title"><Database size={16} /> Curated data sources</div>
              <div className="lp-source-list">
                {DATA_SOURCES.map((s) => (
                  <div key={s.name} className="lp-source">
                    <span className="lp-source-icon">{s.icon}</span>
                    <div><b>{s.name}</b><small>{s.role}</small></div>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal className="lp-data-tiers" delay={80}>
              <div className="lp-panel-title"><Layers size={16} /> Source-quality tiers</div>
              <p className="lp-tiers-lead">Every value the cascade returns is tagged with exactly one tier, in the payload and in the UI.</p>
              <div className="lp-tier-list">
                {TIERS.map((t) => (
                  <div key={t.key} className="lp-tier">
                    <span className={`prov-badge ${t.cls}`}>{t.label}</span>
                    <p>{t.desc}</p>
                  </div>
                ))}
              </div>
              <div className="lp-tier-foot">
                <Gauge size={15} />
                <span>Predictions that fall outside a model's trained chemistry are flagged, not hidden. Low confidence is a first-class output.</span>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── FOCUS 5 · Competitive positioning ── */}
        <section id="compare" className="lp-section lp-compare-section">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow"><Gauge size={13} /> Competitive positioning</span>
            <h2>Where Hakase sits</h2>
            <p>
              Not a CRO, and not a single-endpoint predictor. Hakase is the connective pre-clinical layer between the
              engine that makes your molecules and the bench that confirms them.
            </p>
          </Reveal>
          <Reveal className="lp-compare-wrap">
            <table className="lp-compare">
              <thead>
                <tr>
                  <th className="lp-cmp-feature">Capability</th>
                  <th className="lp-cmp-us"><Sparkles size={14} /> Hakase Twin</th>
                  <th>Traditional CRO</th>
                  <th>Generic ADMET tool</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((row) => (
                  <tr key={row.feature}>
                    <td className="lp-cmp-feature">{row.feature}</td>
                    <td className="lp-cmp-us"><CompareCell value={row.hakase} /></td>
                    <td><CompareCell value={row.cro} /></td>
                    <td><CompareCell value={row.generic} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>
          <div className="lp-position-cards">
            {[
              { icon: <Clock size={17} />, title: "vs. wet-lab first", body: "Months and a cohort of spend collapse into a software read you run before ordering a single plate." },
              { icon: <CircleDashed size={17} />, title: "vs. a single predictor", body: "One ADMET number is a data point. Four sealed layers with dosing and exposure is a decision." },
              { icon: <Lock size={17} />, title: "vs. sending IP out", body: "Your structure never leaves your machine — no CRO handoff, no third-party structural exposure." },
            ].map((c) => (
              <Reveal key={c.title} delay={40}>
                <div className="lp-position">
                  <span className="lp-position-icon">{c.icon}</span>
                  <b>{c.title}</b>
                  <p>{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Privacy ── */}
        <section id="privacy" className="lp-section">
          <Reveal className="lp-section-head">
            <span className="lp-eyebrow"><Lock size={13} /> Privacy architecture</span>
            <h2>Your structure never leaves your machine</h2>
            <p>A hard boundary, not a policy promise — enforced by where the computation actually runs.</p>
          </Reveal>
          <div className="lp-privacy">
            <Reveal>
              <div className="lp-priv-card" style={layerStyle(4)}>
                <div className="lp-priv-head"><span className="lp-priv-dot" /> Your device · client-side</div>
                {["Molecular structure & 3-D data", "In-browser cheminformatics", "One-way derived signals computed locally", "Encrypted local storage"].map((t) => (
                  <div key={t} className="lp-priv-row"><CircleCheck size={15} /> {t}</div>
                ))}
              </div>
            </Reveal>
            <div className="lp-priv-arrow"><ArrowRight size={20} /><small>derived signals only</small></div>
            <Reveal delay={90}>
              <div className="lp-priv-card" style={layerStyle(1)}>
                <div className="lp-priv-head"><span className="lp-priv-dot" /> Platform API · server-side</div>
                {["Derived signals only — never structure", "Inference on abstract descriptors", "No path back to your candidate", "Full provenance & audit trail"].map((t) => (
                  <div key={t} className="lp-priv-row"><CircleCheck size={15} /> {t}</div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="lp-section">
          <Reveal className="lp-cta">
            <span className="lp-badge lp-cta-badge"><Sparkles size={13} /> Ready when you are</span>
            <h2>See what your program will show — <span className="lp-em">before</span> you fund it.</h2>
            <p>Bring a candidate and a target. Get back a decision-grade pre-clinical read — and the evidence behind it — in minutes.</p>
            <div className="lp-hero-cta lp-cta-buttons">
              <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={onEnter}>
                <Play size={16} fill="currentColor" /> Launch the workspace
              </button>
              <button className="lp-btn lp-btn-ghost lp-btn-lg" onClick={() => go("layers")}>Explore the layers</button>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <img src={hakaseLogo} alt="HakaseAI" />
            <span>The pre-clinical BioDigital Twin.</span>
          </div>
          <div className="lp-footer-links">
            {NAV_LINKS.map(([id, label]) => <button key={id} onClick={() => go(id)}>{label}</button>)}
            <span className="lp-footer-ver">v1.1 · 2026</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
