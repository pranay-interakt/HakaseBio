"""Investors, company, contact, security, glossary and 404."""
from __future__ import annotations
import json, pathlib, re
from lib import (Ctx, e, ARROW, ARROW_DOWN, ARROW_OUT, intro, closing, sources, faq_html, faq_ld, page, EMAIL, LINKEDIN, X_URL, PARENT, SITE, BASE)

DATA = pathlib.Path(__file__).parent / "data"

TEAM = [
    ("Manasa Kondamadugu", "Chief Executive Officer", "manasa-kondamadugu", "https://www.linkedin.com/in/dr-manasa-kondamadugu/"),
    ("Pranay Dinavahi", "Chief Technology Officer", "pranay-dinavahi", "https://www.linkedin.com/in/pranay-dinavahi/"),
    ("Aino Tsukamoto", "Chief Financial Officer", "aino-tsukamoto", "https://www.linkedin.com/in/aino-tsukamoto-720537183/"),
    ("Rashmi Gurnani", "Scientific Advisor", "rashmi-gurnani", "https://www.linkedin.com/in/rashmigurnani/"),
    ("Aditya Tallapragada", "Advisor", "aditya-tallapragada", "https://www.linkedin.com/in/adityakt/"),
    ("Nobuaki Shiotsuki", "Advisor", "nobuaki-shiotsuki", "https://www.linkedin.com/in/nobuaki-shiotsuki/"),
    ("Sai Kumar Gogula", "Biomedical Data Scientist", "sai-kumar-gogula", "https://www.linkedin.com/in/sai-kumar-gogula/"),
]

def _people(c: Ctx, people) -> str:
    return "".join(f'''<li class="person">
  <div class="person-photo"><img src="{c.asset(f"assets/img/team/{slug}.webp")}" alt="Portrait of {e(n)}" width="480" height="480" loading="lazy" decoding="async"></div>
  <strong>{e(n)}</strong><span class="role">{e(r)}</span>
  <a href="{e(li)}" rel="noopener">LinkedIn {ARROW_OUT}</a>
</li>''' for n, r, slug, li in people)

def team_html(c: Ctx) -> str:
    return (f'<div class="team-group"><p class="kicker">Leadership</p><ul class="team team--lead">{_people(c, TEAM[:3])}</ul></div>'
            f'<div class="team-group"><p class="kicker">Advisors and team</p><ul class="team">{_people(c, TEAM[3:])}</ul></div>')

def team_ld():
    return [{"@type": "Person", "name": n, "jobTitle": r, "worksFor": {"@id": f"{PARENT}/#organization"}, "sameAs": [li],
             "image": f"{SITE}{BASE.rstrip(chr(47))}/assets/img/team/{slug}.webp"} for n, r, slug, li in TEAM]

def form_html(form_id, subject, fields, button, help_text):
    out = []
    for f in fields:
        kind, name, label, req = f[0], f[1], f[2], f[3]
        rq = " required" if req else ""
        lab = label + ("" if req else " (optional)")
        fid = f"{form_id}-{name}"
        if kind == "select":
            opts = "".join(f"<option>{e(o)}</option>" for o in f[4])
            ctl = f'<select id="{fid}" name="{name}"{rq}><option value="">Choose one</option>{opts}</select>'
        elif kind == "textarea":
            ctl = f'<textarea id="{fid}" name="{name}"{rq}></textarea>'
        else:
            ac = {"name": "name", "email": "email", "organisation": "organization", "role": "organization-title"}.get(name, "off")
            ctl = f'<input id="{fid}" name="{name}" type="{kind}" autocomplete="{ac}"{rq}>'
        out.append(f'<div class="field"><label for="{fid}">{e(lab)}</label>{ctl}</div>')
    # pair the first four into two rows
    rows = []
    i = 0
    while i < len(out):
        if i + 1 < len(out) and fields[i][0] not in ("textarea",) and fields[i + 1][0] not in ("textarea",):
            rows.append(f'<div class="form-row">{out[i]}{out[i+1]}</div>'); i += 2
        else:
            rows.append(out[i]); i += 1
    return f'''<div>
<form class="form" id="{form_id}" data-compose data-to="{EMAIL}" data-subject="{e(subject)}" novalidate>
  {"".join(rows)}
  <div class="actions"><button class="btn" type="submit">{e(button)} {ARROW}</button><p class="form-help">{help_text}</p></div>
</form>
<div class="form-done" hidden>
  <h3 class="h3" tabindex="-1">Your message is ready.</h3>
  <p>Send it from your email app, or copy it into any email to <strong>{EMAIL}</strong>.</p>
  <pre></pre>
  <div class="actions"><a class="btn mail" href="mailto:{EMAIL}">Open in email {ARROW}</a><button class="btn btn--ghost copy" type="button">Copy message</button><button class="btn btn--ghost edit" type="button">Edit</button></div>
</div>
</div>'''

# ---------------------------------------------------------------- INVESTORS
INVESTOR_FAQ = [
    ("Do you run labs?", "No. BioSim works with contract labs and in-house teams. Owning animal facilities is capital-heavy and slow to scale; orchestrating them is not."),
    ("Does the AI make regulatory decisions?", "No. Models draft, rank and check. A named person makes and signs every scientific decision. Simulated values never enter a submission, and any predicted value is labelled as predicted."),
    ("What is built today?", "The study planning engine across nine drug types, study prioritisation, study drivers from lab assays to GLP toxicology, the signed audit trail, Module 4 assembly and SEND export. Validation against approved drugs is published on our science pages."),
    ("Why can’t a CRO or an incumbent do this?", "A contract lab sells its own capacity, so it cannot credibly route work to competitors. Document tools stop at the paperwork. BioSim is lab-neutral and built around a traceable record from the first plan to the IND."),
    ("How do you make money?", "Per drug programme, priced against the services budget a sponsor already has for preclinical work. A readiness review, the entry point, is priced per study reviewed."),
]

def investors(c: Ctx):
    events = [
        ("Apr 2025", "FDA publishes its roadmap to reduce animal testing in preclinical safety studies.", 1),
        ("Mar 2026", "FDA publishes draft guidance on how new approach methodologies can be validated for use in drug development submissions.", 2),
        ("Sep 2026", "FDA opens an expedited IND pilot for first-in-human trials, noting that US first-in-human studies can take up to two years.", 3),
        ("Sep 2026", "A final rule writes “nonclinical” in place of “animal” across FDA’s regulations.", 4),
    ]
    tl = "".join(f'<li><time>{e(d)}</time><p>{e(t)}<sup class="fn"><a href="#src-{n}">{n}</a></sup></p></li>' for d, t, n in events)
    body = f'''
<section class="hero hero--band"><div class="wrap hero-grid">
  <div class="hero-copy">
    <p class="kicker">Investors</p>
    <h1 class="h1 h1--page">The software layer for preclinical drug development.</h1>
    <p class="lead">Every new drug needs a package of preclinical studies before its first human trial. Today that work is planned in spreadsheets and coordinated by email across contract labs. BioSim plans it, runs it with any lab and assembles the IND, with every result traceable.</p>
    <div class="actions"><a class="btn btn--on-band" href="#request">Request the deck {ARROW}</a><a class="textlink" href="#thesis">Read the thesis {ARROW_DOWN}</a></div>
  </div>
  <div class="glance">
    <p class="glance-head kicker" style="color:var(--band-ink-2)">At a glance</p>
    <dl>
      <div><dt>Company</dt><dd>Hakase AI</dd></div>
      <div><dt>Product</dt><dd>BioSim: from drug candidate to IND</dd></div>
      <div><dt>Customer</dt><dd>Biotechs preparing an IND</dd></div>
      <div><dt>Model</dt><dd>Priced per drug programme</dd></div>
      <div><dt>Status</dt><dd>Product built; end-to-end test on 40 approved drugs published</dd></div>
      <div><dt>Round</dt><dd class="signal">Details and deck on request</dd></div>
    </dl>
  </div>
</div></section>

<section class="section" id="thesis"><div class="wrap">
  <div class="head"><p class="kicker">Thesis</p><h2 class="h2">Sell the outcome. Own no labs. Keep the record.</h2></div>
  <ul class="values">
    <li class="value"><h3 class="h3">What we sell</h3><p>Preclinical development as an outcome. A biotech brings a drug candidate and gets back the planned studies, the analysed results and the nonclinical package for its IND, instead of managing several labs by email.</p></li>
    <li class="value"><h3 class="h3">How we deliver it</h3><p>A core that holds the study lifecycle, the audit trail and the human sign-offs, plus study drivers that each run one study type end to end with published methods.</p></li>
    <li class="value"><h3 class="h3">Why it compounds</h3><p>We coordinate lab capacity and sell the outcome. Every programme adds structured, comparable data across labs to one record, an asset that grows with each programme.</p></li>
  </ul>
</div></section>

<section class="section section--card"><div class="wrap">
  <div class="head"><p class="kicker">The problem</p><h2 class="h2">The path to a first human dose is slow and fragmented.</h2></div>
  <ul class="values">
    <li class="value"><h3 class="h3">Fragmented</h3><p>A single programme runs studies across several contract labs. Each returns its own reports and data formats, and the sponsor stitches them together.</p></li>
    <li class="value"><h3 class="h3">Manual</h3><p>Study plans, protocols and FDA datasets are assembled by hand. Errors often surface late, at submission.</p></li>
    <li class="value"><h3 class="h3">Hard to defend</h3><p>Every figure in a submission has to trace back to the raw data behind it. Spreadsheets and PDFs make that chain hard to show.</p></li>
  </ul>
</div></section>

<section class="section"><div class="wrap">
  <div class="head"><p class="kicker">Why now</p><h2 class="h2">The rules for reaching first-in-human are changing.</h2><p class="lead">Each change rewards a plan that is cited, versioned and right the first time, and a record that can be checked.</p></div>
  <ol class="timeline">{tl}</ol>
</div></section>

<section class="section band"><div class="wrap">
  <div class="head"><p class="kicker">What exists today</p><h2 class="h2">Built before it was funded.</h2></div>
  <ul class="points">
    <li><h3 class="h3">The planning engine</h3><p>Derives the full study plan for nine drug types from ICH, FDA and WHO guidance, each study cited to its section.</p></li>
    <li><h3 class="h3">The study workflow</h3><p>Study drivers from lab assays to GLP toxicology: protocols, data checks, analysis and signed reports.</p></li>
    <li><h3 class="h3">The submission</h3><p>IND readiness, Module 4 and SEND export, with an audit trail and signatures that can be verified offline.</p></li>
  </ul>
  <p style="margin-top:40px"><a class="textlink" href="{c.url('/science/validation/')}">Validation on approved drugs {ARROW}</a></p>
</div></section>

<section class="section"><div class="wrap">
  <div class="head"><p class="kicker">Business model</p><h2 class="h2">Start with studies already run. Expand to the full programme.</h2></div>
  <ul class="model">
    <li><p class="kicker">Start</p><h3 class="h3">Readiness review</h3><p>A review of studies a sponsor has already run, against what its IND needs. No lab cooperation required.</p></li>
    <li class="is-key"><p class="kicker">Expand</p><h3 class="h3">Full programme</h3><p>From candidate to IND: the plan, the order, lab dispatch, data intake and the submission package.</p></li>
    <li><p class="kicker">Compound</p><h3 class="h3">Data across labs</h3><p>Each programme adds structured, comparable data across labs: an asset no single lab or document tool builds.</p></li>
  </ul>
</div></section>

<section class="section section--card"><div class="wrap">
  <div class="head"><p class="kicker">Landscape</p><h2 class="h2">Others cover one part of the path. None covers all of it.</h2></div>
  <div class="table-wrap"><table class="data">
    <thead><tr><th scope="col">Category</th><th scope="col">What it covers</th><th scope="col">What it leaves out</th></tr></thead>
    <tbody>
      <tr><td>Contract lab portals</td><td>The work inside one lab</td><td>Neutral routing across labs</td></tr>
      <tr><td>SEND tools</td><td>Dataset conversion and checks</td><td>Study planning and execution</td></tr>
      <tr><td>Regulatory writing tools</td><td>Documents and submission drafts</td><td>The studies behind the documents</td></tr>
      <tr><td>R&amp;D data platforms</td><td>Notebooks, registries, data plumbing</td><td>A regulatory plan through to Module 4</td></tr>
      <tr><td>Lab marketplaces</td><td>An introduction to a vendor</td><td>Everything after the introduction</td></tr>
      <tr class="is-us"><td>Hakase BioSim</td><td colspan="2">The whole path from candidate to IND, lab-neutral, with every result traceable</td></tr>
    </tbody>
  </table></div>
</div></section>

<section class="section"><div class="wrap">
  <div class="head"><p class="kicker">This round</p><h2 class="h2">The round funds paid design-partner programmes.</h2><p class="lead">It also funds the validation that regulated buyers require. Size, terms, milestones and the data room are shared with the deck.</p></div>
</div></section>

<section class="section section--card" id="team"><div class="wrap">
  <div class="head"><p class="kicker">Team</p><h2 class="h2">The people behind Hakase AI.</h2></div>
  {team_html(c)}
</div></section>

<section class="section section--tint" id="request"><div class="wrap split">
  <div class="split-aside"><p class="kicker">Request</p><h2 class="h2">Request the deck.</h2><p>Tell us about your fund. We will reply with the deck, the round details and a time for a live walkthrough on a real programme.</p><p><a href="mailto:{EMAIL}">{EMAIL}</a></p></div>
  {form_html("investor", "Investor deck request", [("text", "name", "Name", True), ("text", "organisation", "Fund or firm", True), ("email", "email", "Email", True), ("select", "focus", "Stage focus", False, ["Pre-seed and seed", "Series A", "Growth", "Strategic"]), ("textarea", "message", "Note", False)], "Request the deck", "This prepares an email to us. Nothing is sent until you send it.")}
</div></section>

<section class="section"><div class="wrap">
  <div class="head"><p class="kicker">Questions</p><h2 class="h2">Questions investors ask first.</h2></div>
  {faq_html(INVESTOR_FAQ)}
  <div style="margin-top:48px">{sources([
      ("FDA press announcement on year-one progress against its April 2025 Roadmap to Reducing Animal Testing in Preclinical Safety Studies, 20 April 2026.", "https://www.fda.gov/news-events/press-announcements/fda-achieves-year-1-goals-reducing-animal-testing-drug-development"),
      ("Federal Register 91(53), 19 March 2026. Draft guidance: General Considerations for the Use of New Approach Methodologies in Drug Development.", "https://www.govinfo.gov/content/pkg/FR-2026-03-19/pdf/2026-05390.pdf"),
      ("RAPS. FDA to test new approach to expediting Phase 1 trials, 15 September 2026.", "https://www.raps.org/resource/fda-to-test-new-approach-to-expediting-phase-1-trials.html"),
      ("PharmTech. FDA finalizes rule recognizing non-animal testing methods, 22 September 2026.", "https://www.pharmtech.com/view/the-fda-finalizes-rule-recognizing-non-animal-testing-methods-building-on-year-long-reduction-push"),
  ])}</div>
</div></section>
'''
    return page(c, title="Investors · Hakase BioSim",
                description="Hakase BioSim is building the software layer for preclinical drug development: from drug candidate to IND, lab-neutral and traceable. Request the deck.",
                body=body, trail=[("Investors", "/investors/")], ld=[faq_ld(INVESTOR_FAQ)])

# ---------------------------------------------------------------- COMPANY
def company(c: Ctx):
    body = intro(c, [("Company", "/company/")], "Company", "We put our names to the work.",
                 "Hakase AI builds software for drug development where every number may end up in front of a regulator. BioSim is our product for the preclinical stage.") + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  <div class="block">
    <div><p class="kicker">How we work</p><h2 class="h2">Clear purpose, traceable foundations, stated limits.</h2></div>
    <ul class="list-plain">
      <li><strong>Science guides the engineering</strong><p>Each workflow starts from the question it supports and the evidence needed to answer it responsibly.</p></li>
      <li><strong>Disciplines work to one standard</strong><p>Scientific context, system design and day-to-day lab realities are considered together throughout development.</p></li>
      <li><strong>Limits are stated as clearly as capabilities</strong><p>When evidence is incomplete or a task is out of scope, we say so, and keep improving the work.</p></li>
    </ul>
  </div>
  <div id="team">
    <div class="head"><p class="kicker">Team and advisors</p><h2 class="h2">The people behind Hakase AI.</h2></div>
    {team_html(c)}
  </div>
  <div class="block">
    <div><p class="kicker">Hakase AI</p><h2 class="h3">One company, several products.</h2></div>
    <div class="prose"><p>BioSim is one of the products Hakase AI builds across discovery, preclinical, clinical and regulatory work. <a href="{PARENT}" rel="noopener">Visit hakase.ai</a>.</p></div>
  </div>
</div></section>''' + closing(c, "Work with us.", [("Investors", "/investors/"), ("Contact", "/contact/"), ("Science", "/science/")])
    return page(c, title="Company and team · Hakase BioSim",
                description="Hakase AI builds software for regulated drug development. Meet the team and advisors behind Hakase BioSim.",
                body=body, trail=[("Company", "/company/")], ld=team_ld())

# ---------------------------------------------------------------- CONTACT
CONTACT_FAQ = [
    ("What happens in a demo?", "Forty minutes on a candidate you choose. We derive its study plan, show the suggested order and trace any result back to its source."),
    ("Do you need our data before a demo?", "No. A drug type, route, indication and planned trial length are enough to start. Confidential data is only needed for a readiness review or a programme."),
    ("Which labs do you work with?", "Any. BioSim prepares a dispatch package each lab can work from, and checks what comes back."),
    ("How is BioSim priced?", "Per drug programme. A readiness review is priced per study reviewed. We quote after a first conversation."),
]

def contact(c: Ctx):
    body = intro(c, [("Contact", "/contact/")], "Contact", "Book a demo.",
                 "Tell us about your programme. We will come back with a time and show BioSim on a candidate like yours.") + f'''
<section class="section" style="padding-top:0"><div class="wrap split">
  <div class="split-aside">
    <p class="kicker">Other routes</p>
    <ul class="list-plain">
      <li><strong>Labs and partners</strong><p>Contract labs and new-approach-method providers who want to receive and return studies through BioSim: <a href="mailto:{EMAIL}">{EMAIL}</a></p></li>
      <li><strong>Investors</strong><p><a href="{c.url('/investors/#request')}">Request the deck</a></p></li>
      <li><strong>Everything else</strong><p><a href="mailto:{EMAIL}">{EMAIL}</a></p></li>
    </ul>
  </div>
  {form_html("demo", "BioSim demo request", [("text", "name", "Name", True), ("email", "email", "Work email", True), ("text", "organisation", "Company", True), ("text", "role", "Role", False), ("select", "modality", "Drug type", False, ["Small molecule", "Monoclonal antibody", "Peptide", "Oligonucleotide", "Recombinant protein", "Antibody–drug conjugate", "Cell therapy", "Gene therapy", "Vaccine", "Other"]), ("select", "stage", "Where you are", False, ["Selecting a candidate", "Planning IND-enabling studies", "Studies under way", "Preparing the IND"]), ("textarea", "message", "What would you like to see?", False)], "Request a demo", "This prepares an email to us. Nothing is sent until you send it.")}
</div></section>
<section class="section section--card"><div class="wrap">
  <div class="head"><p class="kicker">Ways to start</p><h2 class="h2">Start with the work you already have.</h2></div>
  <ul class="options">
    <li class="option"><h3 class="h3">Readiness review</h3><p>For studies already run.</p><dl><dt>You send</dt><dd>Your study reports.</dd><dt>You get</dt><dd>A gap list for your IND, with each report’s values traced to its page and table.</dd></dl></li>
    <li class="option"><h3 class="h3">Full programme</h3><p>From candidate to IND.</p><dl><dt>You send</dt><dd>The candidate and its clinical plan.</dd><dt>You get</dt><dd>The plan, lab-ready protocols and, as results return, the IND package.</dd></dl></li>
    <li class="option"><h3 class="h3">Demo</h3><p>Forty minutes, no data needed.</p><dl><dt>You send</dt><dd>A drug type and a planned trial.</dd><dt>You get</dt><dd>Its study plan, its order and a traced result.</dd></dl></li>
  </ul>
  <div style="margin-top:24px">{faq_html(CONTACT_FAQ)}</div>
</div></section>'''
    return page(c, title="Book a demo · Hakase BioSim",
                description="Book a demo of Hakase BioSim on a candidate like yours, or start with a readiness review of the preclinical studies you have already run.",
                body=body, trail=[("Contact", "/contact/")], ld=[faq_ld(CONTACT_FAQ)])

# ---------------------------------------------------------------- SECURITY
def security(c: Ctx):
    body = intro(c, [("Security", "/security/")], "Security and compliance", "Built for regulated records.",
                 "BioSim is designed for regulated work: electronic records and signatures that follow 21 CFR Part 11, an audit trail where any rewrite is detected, and access limited to the people on each programme.") + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  <div class="block"><div><p class="kicker">Signatures</p><h2 class="h2">People sign, and sign again.</h2></div>
    <div class="prose"><p>The legal sign-offs in nonclinical work belong to people: the GLP Study Director, quality assurance, the IACUC or attending veterinarian and, for EU GMP release, the qualified person. BioSim assembles what they need and records their signature. It never signs on their behalf.</p><p>Every signature asks for the password again, as 21 CFR 11.200 requires. GLP approval needs both the Study Director and QA signatures on the current version of the report.</p></div></div>
  <div class="block"><div><p class="kicker">Audit trail</p><h2 class="h2">A record where any change shows.</h2></div>
    <div class="prose"><p>Every change is an entry in an append-only, hash-chained ledger, written in the same transaction as the change itself, so any later rewrite breaks the chain and is detected. Rejected uploads are recorded too. Corrections create a new version linked to the old one, with a reason. Ledger checkpoints can be anchored to write-once storage.</p></div></div>
  <div class="block"><div><p class="kicker">Access</p><h2 class="h2">Each programme sees only its own.</h2></div>
    <div class="prose"><p>A programme is visible only to its organisation and to guests added on the record, such as a contract lab. Exported bundles redact other programmes’ entries, and the chain still verifies. Session length, idle timeout and sign-in lockout are set by policy.</p></div></div>
  <div class="block"><div><p class="kicker">Deployment</p><h2 class="h2">Runs where your data needs to be.</h2></div>
    <div class="prose"><p>BioSim ships as containers with PostgreSQL, with dependencies locked by hash and a software bill of materials for each build. Database migrations are versioned and can be run as a separate, controlled step.</p></div></div>
  <div class="block"><div><p class="kicker">Validation</p><h2 class="h2">What stays with you.</h2></div>
    <div class="prose"><p>Computer system validation (IQ, OQ and PQ) and the SOPs for a regulated deployment are the deploying organisation’s step. We provide a clause-by-clause traceability matrix from Part 11, Part 58 and data-integrity expectations to the code and tests that implement them.</p></div></div>
  <div class="block"><div><p class="kicker">This website</p><h2 class="h3">No cookies, no trackers.</h2></div>
    <div class="prose"><p>hakase.bio sets no cookies and loads nothing from third parties. Forms prepare an email in your own email app; nothing is stored by this site.</p></div></div>
</div></section>''' + closing(c, "Bring your QA lead to a demo.", [("Science", "/science/"), ("Submit", "/product/submit/"), ("Contact", "/contact/")])
    return page(c, title="Security, Part 11 and audit trail · Hakase BioSim",
                description="21 CFR Part 11 signatures, a hash-chained audit trail, programme-level access control and container deployment: how BioSim handles regulated records.",
                body=body, trail=[("Security", "/security/")])

# ---------------------------------------------------------------- GLOSSARY
EXTRA_TERMS = [
    ("ICH", "The International Council for Harmonisation of Technical Requirements for Pharmaceuticals for Human Use, whose guidelines (such as M3(R2) and S6(R1)) set the nonclinical studies regulators expect."),
    ("IND-enabling studies", "The nonclinical studies a sponsor completes before the first human dose and submits in its Investigational New Drug application."),
    ("21 CFR Part 11", "The FDA regulation on electronic records and electronic signatures."),
    ("Clinical hold", "An FDA order to delay a proposed clinical investigation or suspend an ongoing one."),
    ("NAMs", "New approach methodologies: in vitro, in silico and other methods that can reduce or replace animal studies."),
    ("Toxicokinetics", "The measurement of systemic exposure in a toxicity study, used to relate findings to exposure."),
    ("Safety pharmacology", "Studies of a drug’s effects on vital functions: the central nervous, cardiovascular and respiratory systems."),
]
SKIP = {"Conformance kit", "Driver", "Execution target", "GxP plane / discovery plane", "Quantity", "Ledger", "Provenance kind", "UNAVAILABLE", "Attestation"}

def glossary(c: Ctx):
    src = json.load(open(DATA / "glossary_src.json"))
    terms = []
    for t in src:
        if t["term"] in SKIP:
            continue
        d = re.sub(r"\s*\(`[^`]*`\)", "", t["definition"])
        d = re.sub(r"`([^`]*)`", r"\1", d).replace("In HOS", "In BioSim").replace("HOS", "BioSim")
        terms.append((t["term"], d))
    terms += [("Audit trail (ledger)", "BioSim’s append-only, hash-chained record of every change, which is the original record under ALCOA+."),
              ("Provenance", "Where a value came from: measured, literature, computed, predicted, guideline, user-supplied, simulated or unavailable.")]
    terms += EXTRA_TERMS
    terms.sort(key=lambda x: x[0].lower())
    items = "".join(f'<li id="term-{re.sub(r"[^a-z0-9]+", "-", k.lower()).strip("-")}"><strong>{e(k)}</strong><span>{e(d)}</span></li>' for k, d in terms)
    ld = {"@type": "DefinedTermSet", "name": "Hakase BioSim glossary", "hasDefinedTerm": [{"@type": "DefinedTerm", "name": k, "description": d} for k, d in terms]}
    body = intro(c, [("Glossary", "/glossary/")], "Glossary", "The language of IND-enabling work.",
                 "Short definitions of the terms used across BioSim and preclinical drug development.") + f'''
<section class="section" style="padding-top:0"><div class="wrap"><ul class="defs">{items}</ul></div></section>''' + closing(c, "Questions about a term in your own plan?", [("Science", "/science/"), ("Methods", "/science/methods/"), ("Product", "/product/")])
    return page(c, title="Glossary of IND-enabling terms · Hakase BioSim",
                description="Definitions of IND, NOAEL, MRSD, HED, SEND, GLP, IVIVE, Module 4 and other terms used in preclinical drug development and in BioSim.",
                body=body, trail=[("Glossary", "/glossary/")], ld=[ld])

def not_found(c: Ctx):
    body = f'''<section class="intro"><div class="wrap"><div class="intro-grid">
  <p class="kicker">404</p><h1 class="h1 h1--page">That page isn’t on the record.</h1>
  <p class="lead">The link may be out of date. These are good places to continue.</p>
  <div class="actions"><a class="btn" href="{c.url('/')}">Home {ARROW}</a><a class="textlink" href="{c.url('/product/')}">How BioSim works</a><a class="textlink" href="{c.url('/contact/')}">Book a demo</a></div>
</div></div></section>'''
    return page(c, title="Page not found · Hakase BioSim", description="The page you asked for is not here.", body=body, noindex=True)
