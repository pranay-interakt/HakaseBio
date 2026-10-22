"""Home, product, science and modality pages."""
from __future__ import annotations
import collections, json, pathlib, re
from lib import (Ctx, e, ARROW, ARROW_DOWN, ARROW_OUT, intro, closing, sources, faq_html, faq_ld, APP, SITE, page, EMAIL)

DATA = pathlib.Path(__file__).parent / "data"
SETS = json.load(open(DATA / "study_sets.json"))["sets"]
METHODS = json.load(open(DATA / "methods.json"))
DRIVERS = json.load(open(DATA / "drivers.json"))

MOD_ORDER = ["small-molecule", "monoclonal-antibody", "peptide", "oligonucleotide", "recombinant-protein",
             "antibody-drug-conjugate", "cell-therapy", "gene-therapy", "vaccine"]
MOD_PLURAL = {"small-molecule": "small molecules", "monoclonal-antibody": "monoclonal antibodies", "peptide": "peptides",
              "oligonucleotide": "oligonucleotides", "recombinant-protein": "recombinant proteins",
              "antibody-drug-conjugate": "antibody–drug conjugates", "cell-therapy": "cell therapies",
              "gene-therapy": "gene therapies", "vaccine": "vaccines"}
TIMING = [("before_first_in_human", "Before first-in-human"), ("before_multiple_dose_trials", "Before multiple-dose trials"),
          ("before_inclusion_of_wocbp", "Before including women of childbearing potential"), ("before_phase_2", "Before phase 2"),
          ("before_phase_3", "Before phase 3"), ("marketing_application", "Before the marketing application")]
GUIDE_SHORT = {"ich_m3r2": "ICH M3(R2)", "ich_s6r1": "ICH S6(R1)", "ich_m10": "ICH M10", "ich_s3a": "ICH S3A", "ich_s7a": "ICH S7A",
               "ich_s7b": "ICH S7B", "ich_s2r1": "ICH S2(R1)", "ich_s8": "ICH S8", "ich_s10": "ICH S10", "ich_s1a": "ICH S1A",
               "ich_s5r3": "ICH S5(R3)", "fda_cber_cgt_2013": "FDA CBER cell and gene therapy guidance, 2013",
               "who_vaccine_2005": "WHO TRS 927, Annex 1", "who_adjuvant_2013": "WHO adjuvant guidelines, 2013",
               "fda_vaccine_devtox_2006": "FDA vaccine developmental toxicity guidance, 2006", "frazier_2015": "Frazier 2015",
               "lindow_2012": "Lindow et al. 2012", "oswg_dart_2014": "Cavagnaro et al. 2014", "oswg_genotox_2016": "OSWG genotoxicity recommendations, 2016", "ich_s9": "ICH S9"}

def ref_text(q):
    """Human-readable guideline reference for a requirement."""
    sec = q["section"].strip()
    key = q["citation"]["key"]
    if key.startswith("ich_") and not sec.upper().startswith(("ICH", "FDA", "WHO")):
        sec = "ICH " + sec
    return sec

def short_ref(q):
    return re.sub(r"\s+sections?\s+", " §", ref_text(q)).replace(", Table", ", Table")

def before_fih(slug):
    return [q for q in SETS[slug]["requirements"] if q["timing"] == "before_first_in_human" and q["status"] != "not_required"]

NUM_WORDS = {n: w for n, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve".split())}

# Clinical milestones for the home-page pipeline. Each timing in the engine output lands in exactly one.
PIPE_STAGES = [("First human dose", ("before_first_in_human",)),
               ("Wider trials", ("before_multiple_dose_trials", "before_inclusion_of_wocbp")),
               ("Phase 2", ("before_phase_2",)),
               ("Phase 3", ("before_phase_3",)),
               ("Marketing", ("marketing_application",))]

def pipeline(c: Ctx) -> str:
    """Per drug type: the studies the engine derives as due before each clinical milestone."""
    head = "".join(f'<span>{e(name)}</span>' for name, _ in PIPE_STAGES)
    rows = []
    for slug in MOD_ORDER:
        s = SETS[slug]
        live = [q for q in s["requirements"] if q["status"] != "not_required"]
        counts = [sum(q["timing"] in keys for q in live) for _, keys in PIPE_STAGES]
        assert sum(counts) == len(live), f"{slug}: a requirement timing is missing from PIPE_STAGES"
        last = max(i for i, n in enumerate(counts) if n)
        cells = []
        for i, ((name, _), n) in enumerate(zip(PIPE_STAGES, counts)):
            value = f'{n}<span class="sr"> {"study" if n == 1 else "studies"}</span>' if n else '–<span class="sr"> none</span>'
            cells.append(f'<div class="pipe-cell{" is-after" if i > last else ""}"><dt>{e(name)}</dt><dd>{value}</dd></div>')
        cells = "".join(cells)
        cited = collections.Counter(q["citation"]["key"] for q in live).most_common(1)  # the guideline the plan leans on most
        guide = GUIDE_SHORT.get(cited[0][0], "") if cited else ""
        rows.append(f'''<li class="pipe-row">
  <div class="pipe-name"><h3><a href="{c.url(f"/modalities/{slug}/")}">{e(s["label"])}</a></h3><p>{e(" · ".join(s["facts"][:2]))}</p></div>
  <p class="pipe-guide">{e(guide)}</p>
  <div class="pipe-track reach-{last + 1}"><span class="pipe-bar" aria-hidden="true"></span><dl>{cells}</dl></div>
</li>''')
    return f'''<div class="pipe">
  <div class="pipe-head" aria-hidden="true"><span>Drug type</span><span>Main guidance</span><span class="pipe-stages">{head}</span></div>
  <ol class="pipe-rows">{"".join(rows)}</ol>
  <p class="pipe-note">Numbers are new studies due before each stage for the typical programme shown; the bar runs to the last stage with a new requirement. Wider trials means before multiple-dose trials or before including women who could become pregnant.</p>
</div>'''

# ---------------------------------------------------------------- INSIDE BIOSIM
ENGINES = [
    ("Regulatory engine", "The study plan, derived and cited",
     "Reads a programme’s facts and derives every study the ICH, FDA and WHO guidelines require, for nine drug types, each line cited to its section. An unknown fact leaves a study conditional, never assumed.",
     "/product/plan/"),
    ("KESTREL", "Kill-early study sequencing",
     "Orders the study battery so a programme-ending finding surfaces at the lowest expected spend: each study’s chance of a decisive result, from cited detection rates, against its cost and time, inside the order the guidelines set.",
     "/product/prioritise/"),
    ("SEXTANT", "The value of an experiment",
     "Prices each candidate study by how much it could change the go or no-go decision, using the programme’s own costs of a wrong go and a wrong stop. Experiments are ranked by value, and by value per unit cost.",
     "/product/prioritise/"),
    ("Digital study engine", "In silico answers, graded for credibility",
     "Answers each required study with the most qualified computational method available and grades the credibility of that answer for its context of use under ASME V&V 40. A prediction informs a decision; it never replaces a signed study.",
     "/product/inside/#digital-study-engine"),
    ("Study drivers", "One study type, end to end",
     "Fourteen study types, from microsomal stability to GLP repeat-dose toxicology, each packaged with its protocol, data checks, cited analysis and report, so every lab is held to the same standard.",
     "/product/run/"),
    ("Provenance ledger", "Every value with its origin",
     "Eight ways a number can exist, none of them guessed. An append-only, hash-chained record of every change, with signatures only people can give, and simulated data that can never become evidence.",
     "/science/"),
    ("Offline verifier", "The package checks itself",
     "Every Module 4 export carries what is needed to re-run each analysis from the raw files and check every fingerprint, ledger entry and signature, without BioSim, a database or a network.",
     "/product/submit/"),
    ("HAIOps", "Hakase’s discipline for regulated AI",
     "Six requirements every workflow is built to: traceability, quantified confidence, human authority over safety decisions, applicability monitoring, model governance and integrity of evidence.",
     "/product/inside/#haiops"),
]

# The same eight parts in plain words, for the grids on the home, product and investor pages.
# The Inside BioSim page keeps the full technical description above.
ENGINES_PLAIN = {
    "Regulatory engine": ("Study plan", "Every study your drug needs",
        "Lists the studies the ICH, FDA and WHO guidelines require for your drug, each linked to the section that asks for it. A missing fact marks a study as conditional; it is never assumed."),
    "KESTREL": ("Study order", "Find the deal-breakers early",
        "Puts the studies most likely to stop the programme first, weighing each one’s cost and time, within the order the guidelines allow."),
    "SEXTANT": ("Study value", "Know which experiments are worth it",
        "Ranks studies by how much their result could change your go or no-go decision, and by what each one costs."),
    "Digital study engine": ("Virtual lab", "Run every study in silico first",
        "Predicts the outcome of each required study with computer models and says how far each prediction can be trusted. Predictions guide the programme; signed studies make the submission."),
    "Study drivers": ("Lab studies", "The same standard at every lab",
        f"{len(DRIVERS)} study types, each with its protocol, data checks, analysis and report built in, so every contract lab is held to the same standard."),
    "Provenance ledger": ("Audit trail", "Every number shows where it came from",
        "Each value is labelled as measured, from the literature, calculated or predicted. Nothing is guessed, and every change is logged."),
    "Offline verifier": ("Package check", "Reviewers can check it without us",
        "Every exported package can re-run its own analyses from the raw files and confirm nothing was changed, without BioSim or an internet connection."),
    "HAIOps": ("Rules for AI", "AI that stays accountable",
        "Hakase’s six rules for AI in regulated work: every answer traceable, its confidence stated, and people make every safety decision."),
}

def engines_grid(c: Ctx, items=None, dark=False) -> str:
    items = items or ENGINES
    cards = []
    for name, title, desc, href in items:
        label, title, desc = ENGINES_PLAIN.get(name, (name, title, desc))
        cards.append(f'''<li class="engine"><a href="{c.url(href)}">
  <span class="engine-name">{e(label)}</span>
  <strong>{e(title)}</strong>
  <p>{e(desc)}</p>
  <span class="more">More {ARROW}</span>
</a></li>''')
    return f'<ul class="engines{" engines--dark" if dark else ""}">{"".join(cards)}</ul>'

HAIOPS = [
    ("Traceability and audit readiness", "An append-only ledger records inputs by fingerprint, method and version, reference-parameter version, software versions, actor and time. Corrections create a linked new version with a reason."),
    ("Quantified confidence", "Every in silico answer is graded under ASME V&V 40 against the risk of its context of use, and uncertainty travels with the value."),
    ("Human authority over safety decisions", "The signature boundaries of nonclinical development are first-class: a named person attests, and the system records exactly what was signed."),
    ("Applicability monitoring", "Each predicted value carries its applicability-domain check; each read-across names its analogues, their values and their similarity."),
    ("Lifecycle and model governance", "A checksum-locked method registry. Every stored result names the method version that produced it, and a method change is a versioned event."),
    ("Integrity of evidence", "Predicted and simulated values are kept out of the evidence path by design. A study run on simulated data can be rehearsed and reported, and never approved."),
]

def product_inside(c: Ctx):
    blocks = []
    for name, title, desc, href in ENGINES[:-1]:
        blocks.append(f'''<div class="block" id="{re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")}">
  <div><p class="engine-name">{e(name)}</p><h2 class="h2">{e(title)}.</h2></div>
  <div class="prose"><p>{e(desc)}</p><p><a class="textlink" href="{c.url(href)}">Where it works in BioSim {ARROW}</a></p></div>
</div>''')
    rows = "".join(f'<tr><td><strong>{e(a)}</strong></td><td>{e(b)}</td></tr>' for a, b in HAIOPS)
    body = intro(c, [("Product", "/product/"), ("Inside BioSim", "/product/inside/")], "Product · Inside", "Inside BioSim.",
                 "Seven capabilities we built in-house, and the discipline they are built to. Together they are what makes a BioSim package traceable, defensible and fast to produce.", dark=True) + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  {"".join(blocks)}
  <div id="haiops">
    <div class="head"><p class="engine-name">HAIOps</p><h2 class="h2">Healthcare AI Operations: the discipline BioSim is built to.</h2><p class="lead">Machine-learning operations was built for systems where a wrong answer costs a click. HAIOps is Hakase’s operating discipline for systems where a wrong answer reaches a patient. Six requirements, and how BioSim meets each.</p></div>
    <div class="table-wrap"><table class="data"><thead><tr><th scope="col">Requirement</th><th scope="col">In BioSim</th></tr></thead><tbody>{rows}</tbody></table></div>
  </div>
</div></section>''' + closing(c, "See every one of these on a real candidate.", [("How it works", "/product/"), ("Methods", "/science/methods/"), ("Security", "/security/")])
    return page(c, title="Inside BioSim: the engines · Hakase BioSim",
                description="The regulatory engine, KESTREL, SEXTANT, the digital study engine, study drivers, the provenance ledger, the offline verifier and HAIOps: what BioSim is made of.",
                body=body, trail=[("Product", "/product/"), ("Inside BioSim", "/product/inside/")], ld=[APP])

# ---------------------------------------------------------------- HOME
# Line icons for the home page (24-unit grid, drawn with the current text colour).
def icon(name: str) -> str:
    paths = {
        "screen": '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
        "lab": '<path d="M4 21V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15"/><path d="M14 10h5a1 1 0 0 1 1 1v10"/><path d="M3 21h18M7.5 9h3M7.5 13h3M7.5 17h3"/>',
        "trace": '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="12" r="2.4"/><circle cx="6" cy="18" r="2.4"/><path d="m8.2 7.1 7.6 3.8M8.2 16.9l7.6-3.8"/>',
        "file": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 14 2 2 4-4"/>',
        "plan": '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
        "order": '<path d="M4 6h16M4 12h11M4 18h6"/>',
        "flask": '<path d="M9 3h6M10 3v6.5L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9.5V3"/><path d="M7.5 15h9"/>',
        "send": '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
    }
    return f'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{paths[name]}</svg>'


def home(c: Ctx, preview_root=False):
    cards = [
        ("screen", "A virtual lab", "Every required study run in silico first, with how far each answer can be trusted."),
        ("lab", "Your contract labs", "Protocols out, results back, checked line by line and analysed with published methods."),
        ("trace", "Traceable evidence", "Every value linked to its source, its method and the person who approved it."),
        ("file", "IND-ready output", "Module 4 and SEND datasets, ready for your team to review and sign."),
    ]
    cards_html = "".join(f'<li class="hero-card"><span class="ico">{icon(i)}</span><strong>{e(t)}</strong><p>{e(d)}</p></li>' for i, t, d in cards)
    steps = [
        ("plan", "Plan", "Enter your drug and clinical plan. BioSim lists every study the ICH and FDA guidelines require, with the reason for each.", "/product/plan/", "How planning works"),
        ("order", "Prioritise", "The studies most likely to stop a programme run first, before the long and expensive ones.", "/product/prioritise/", "How prioritising works"),
        ("flask", "Run", "Test each study in the virtual lab, then send protocols to any contract lab. Results come back checked and analysed.", "/product/run/", "How studies run"),
        ("send", "Submit", "BioSim assembles the nonclinical part of the IND, CTD Module 4 and SEND datasets, ready to review and sign.", "/product/submit/", "What you submit"),
    ]
    steps_html = "".join(f'<li class="flow-step"><span class="flow-n">{i + 1:02d}</span><span class="flow-ico">{icon(ic)}</span><h3>{e(t)}</h3><p>{e(d)}</p><a href="{c.url(u)}">{e(l)}</a></li>'
                         for i, (ic, t, d, u, l) in enumerate(steps))
    img, img_sm = c.asset("assets/img/hero-protein.webp"), c.asset("assets/img/hero-protein-960.webp")
    body = f'''
<section class="hero hero--band hero--photo">
  <div class="hero-art"><img src="{img}" srcset="{img_sm} 960w, {img} 1672w" sizes="(max-width: 899px) 100vw, 64vw" alt="" width="1672" height="941" fetchpriority="high"></div>
  <div class="wrap wrap--wide hero-main">
    <div class="hero-copy">
      <p class="eyebrow">BioSim <span>/</span> Preclinical development</p>
      <h1 class="h1">From drug candidate <em>to IND.</em></h1>
      <p class="lead">BioSim is preclinical development software. It works out the studies your drug needs, tests them in a virtual lab, runs them with your contract labs and assembles the IND package. Every result traces back to its source.</p>
      <div class="actions"><a class="btn btn--on-band" href="{c.url('/contact/')}">Book a demo {ARROW}</a><a class="textlink" href="#how">See how it works {ARROW_DOWN}</a></div>
    </div>
  </div>
  <ul class="hero-notes">
    <li class="note-1"><span>Physicochemistry</span>Solubility, lipophilicity and polar surface area</li>
    <li class="note-2"><span>Exposure</span>PBPK across rat, dog and human</li>
    <li class="note-3"><span>Safety signals</span>hERG and DNA-reactivity alerts</li>
  </ul>
  <div class="wrap wrap--wide"><ul class="hero-cards">{cards_html}</ul></div>
</section>


<section class="section" id="how"><div class="wrap flow">
  <div class="head">
    <h2 class="h2">Four steps, one record.</h2>
    <p class="lead">You stay in charge of every scientific decision. BioSim does the planning, the paperwork and the checking.</p>
  </div>
  <ol class="flow-steps">{steps_html}</ol>
</div></section>

<section class="section section--card" id="pipeline"><div class="wrap">
  <div class="head head--split">
    <h2 class="h2">What each drug type needs, and when.</h2>
    <div>
      <p class="lead">For {NUM_WORDS.get(len(MOD_ORDER), len(MOD_ORDER))} types of drug, the studies the ICH, FDA and WHO guidelines require before each stage of clinical development, as BioSim derives them for a typical programme.</p>
      <a class="textlink" href="{c.url('/modalities/')}">See every plan in full {ARROW}</a>
    </div>
  </div>
  {pipeline(c)}
</div></section>

<section class="section" id="inside"><div class="wrap">
  <div class="head">
    <h2 class="h2">What’s inside BioSim.</h2>
    <p class="lead">Eight parts, all built by Hakase. Each one is working software today.</p>
  </div>
  {engines_grid(c)}
</div></section>

<section class="section band"><div class="wrap">
  <div class="head">
    <h2 class="h2">Scientists stay in charge.</h2>
  </div>
  <ul class="points">
    <li><h3 class="h3">People sign</h3><p>Study directors, quality assurance and veterinarians approve every decision. BioSim never signs for them.</p></li>
    <li><h3 class="h3">Nothing is guessed</h3><p>If a value is missing, BioSim says so and why. It never fills the gap with a default.</p></li>
    <li><h3 class="h3">A record you can check</h3><p>Every change is logged with who, when and why, and any rewrite is detected. Signatures follow 21 CFR Part 11.</p></li>
  </ul>
  <p class="band-more"><a class="textlink" href="{c.url('/product/inside/#haiops')}">How BioSim keeps its AI accountable {ARROW}</a></p>
</div></section>

<section class="section"><div class="wrap">
  <div class="head">
    <h2 class="h2">Start with the work you already have.</h2>
  </div>
  <ul class="options">
    <li class="option"><h3 class="h3">Readiness review</h3><p>Send the study reports you already have. Get back a gap list for your IND, with each report’s values traced to its page and table.</p></li>
    <li class="option"><h3 class="h3">Full programme</h3><p>Send a candidate and its clinical plan. Get the study plan, lab-ready protocols and, as results return, the IND package.</p></li>
    <li class="option"><h3 class="h3">Demo</h3><p>Forty minutes on a real candidate: its study plan, its order and any result traced to its source.</p></li>
  </ul>
  <a class="btn" href="{c.url('/contact/')}">Book a demo {ARROW}</a>
</div></section>

<section class="cta-band"><div class="wrap">
  <p>Investing in the infrastructure of drug development?</p>
  <a class="textlink" href="{c.url('/investors/')}">Investor overview {ARROW}</a>
</div></section>
'''
    return page(c, title="Hakase BioSim · From drug candidate to IND",
                description="BioSim plans the preclinical studies your drug needs, tests them in its virtual lab, runs them with the labs you choose and assembles the IND package for FDA, with every result traceable.",
                body=body, ld=[APP], preview_root=preview_root)

# ---------------------------------------------------------------- PRODUCT
def product(c: Ctx):
    steps = [
        ("1", "Plan", "/product/plan/", "Your drug’s type, route, indication, trial length and population.", "The full study plan, each study cited to the guideline section that requires it.", "Your toxicologist reviews the plan."),
        ("2", "Prioritise", "/product/prioritise/", "What is already known about the molecule and your lab quotes.", "An order that runs the studies most likely to stop the programme first.", "Your team decides what to commission."),
        ("3", "Run", "/product/run/", "Protocols approved by your team, sent to the lab you choose.", "Returned data checked line by line, analysed with published methods, reported.", "The Study Director and QA sign."),
        ("4", "Submit", "/product/submit/", "The signed studies on the record.", "IND readiness, Module 2 summaries, Module 4 and SEND datasets.", "Your regulatory lead signs off."),
    ]
    rows = "".join(f'''<li class="block" style="padding-top:28px;border-top:1px solid var(--rule-strong)">
  <div><span class="step-n">{n}</span><h2 class="h2">{t}</h2><a class="textlink" href="{c.url(u)}">More on {t.lower()} {ARROW}</a></div>
  <ul class="defs defs--3">
    <li><span class="kicker">You provide</span><span>{e(a)}</span></li>
    <li><span class="kicker">BioSim produces</span><span>{e(b)}</span></li>
    <li><span class="kicker">Who signs</span><span>{e(s)}</span></li>
  </ul>
</li>''' for n, t, u, a, b, s in steps)
    body = intro(c, [("Product", "/product/")], "Product", "From candidate to IND, in four steps.",
                 "BioSim is the software your team uses to plan, run and document the preclinical studies that come before a first human trial. It keeps one record from the first plan to the IND.", dark=True) + f'''
<section class="section" style="padding-top:0"><div class="wrap">
  <ol class="stack" style="list-style:none">{rows}</ol>
</div></section>
<section class="section"><div class="wrap">
  <div class="head"><p class="kicker">Inside BioSim</p><h2 class="h2">What it is made of.</h2></div>
  {engines_grid(c)}
</div></section>
<section class="section section--card"><div class="wrap">
  <div class="head"><p class="kicker">What BioSim is not</p><h2 class="h2">Clear lines, so you know what you are buying.</h2></div>
  <ul class="values">
    <li class="value"><h3 class="h3">Not a wet lab</h3><p>BioSim runs no animal or bench work. Its virtual lab predicts results; the studies that count run at the contract labs and in-house teams you already use.</p></li>
    <li class="value"><h3 class="h3">Not a notebook</h3><p>An electronic notebook records what happened. BioSim plans the work, checks what comes back and builds the submission from it.</p></li>
    <li class="value"><h3 class="h3">Not a replacement for your experts</h3><p>Toxicologists, study directors and regulatory leads make and sign the decisions. BioSim gives them everything they need to do it.</p></li>
  </ul>
</div></section>
''' + closing(c, "See BioSim on one of your own candidates.", [("Inside BioSim", "/product/inside/"), ("Plan", "/product/plan/"), ("Security", "/security/")])
    return page(c, title="How BioSim works · Hakase BioSim",
                description="Plan, prioritise, run and submit: how BioSim takes a drug candidate to an IND-ready nonclinical package, and who signs at each step.",
                body=body, trail=[("Product", "/product/")], ld=[APP])

def guideline_table():
    seen = {}
    for slug in MOD_ORDER:
        for q in SETS[slug]["requirements"]:
            k = q["citation"]["key"]
            if k not in seen:
                seen[k] = (q["citation"], set())
            seen[k][1].add(SETS[slug]["label"])
    rows = []
    for k, (cit, mods) in sorted(seen.items(), key=lambda kv: (not kv[0].startswith("ich"), kv[0])):
        if not cit.get("url"):
            continue
        title = re.sub(r"\.\s*Step 4.*$", "", cit["text"]).strip()
        rows.append(f'<tr><td class="ref">{e(GUIDE_SHORT.get(k, k))}</td><td><a href="{e(cit["url"])}" rel="noopener">{e(title)}</a></td></tr>')
    return f'<div class="table-wrap"><table class="data"><caption>Guidance the engine cites across the nine reference programmes, with links to the official texts.</caption><thead><tr><th scope="col">Short name</th><th scope="col">Document</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>'

def plan_table(slug, show_why=True):
    s = SETS[slug]
    out = []
    for tkey, tlabel in TIMING:
        qs = [q for q in s["requirements"] if q["timing"] == tkey]
        if not qs:
            continue
        rows = []
        for q in qs:
            st = {"required": ("Required", "status--required"), "conditional": ("Conditional", "status--conditional"), "not_required": ("Not required", "status--not")}[q["status"]]
            extra = []
            if q.get("species"):
                extra.append("Species: " + ", ".join(q["species"]))
            if q.get("duration_weeks"):
                extra.append(f'{q["duration_weeks"]:g} weeks')
            if q.get("pending_fact"):
                extra.append("Waiting on: " + q["pending_fact"])
            note = f'<span class="note">{e(" · ".join(extra))}</span>' if extra else ""
            why = f'<details class="why"><summary>Why</summary><p>{e(q["rationale"])}</p></details>' if show_why and q.get("rationale") else ""
            rows.append(f'<tr><td>{e(q["name"])}{note}{why}</td><td class="ref">{e(ref_text(q))}</td><td>{"GLP" if q["glp"] else ""}</td><td><span class="status {st[1]}">{st[0]}</span></td></tr>')
        out.append(f'<h3 class="h4" style="margin:32px 0 12px">{tlabel}</h3><div class="table-wrap"><table class="data"><thead><tr><th scope="col">Study</th><th scope="col">Guideline</th><th scope="col">GLP</th><th scope="col">Status</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>')
    return "".join(out)

def product_plan(c: Ctx):
    body = intro(c, [("Product", "/product/"), ("Plan", "/product/plan/")], "Product · Step 1", "Plan: the studies your drug needs.",
                 "BioSim reads your programme’s facts and derives the nonclinical study plan the guidelines require. Every study names the guideline section that creates it.") + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  <div class="block">
    <div><p class="kicker">How it works</p><h2 class="h2">Facts in, cited plan out.</h2></div>
    <div class="prose">
      <p>You describe the programme: drug type, route, indication, how long the trial doses, how long patients will be treated, and who will take part. BioSim applies rules encoded from the guideline text, such as ICH M3(R2) for most small molecules, ICH S6(R1) for biologics and FDA CBER guidance for cell and gene therapies.</p>
      <p>Each rule carries its guideline, section and conditions. Change a fact, for example a longer trial or a new patient population, and the plan is derived again. You can compare the two plans before saving the change.</p>
    </div>
  </div>
  <div class="block">
    <div><p class="kicker">When a fact is unknown</p><h2 class="h2">Gaps stay visible.</h2></div>
    <div class="prose">
      <p>If the plan depends on something you have not decided yet, the affected study is marked <strong>conditional</strong> and names the missing fact. BioSim does not assume an answer for you.</p>
      <p class="callout">Example: for a chemically synthesised peptide, whether ICH S6(R1) principles apply is your scientist’s signed decision. Until it is recorded, the studies it affects stay conditional.</p>
    </div>
  </div>
  <div>
    <div class="head"><p class="kicker">Example</p><h2 class="h2">The full plan for an oral small molecule.</h2><p class="lead">Reference programme: {e(" · ".join(SETS["small-molecule"]["facts"]))}. Open “Why” on any line to read the engine’s reason.</p></div>
    {plan_table("small-molecule")}
  </div>
  <div>
    <div class="head"><p class="kicker">Coverage</p><h2 class="h2">Guidance encoded in the engine.</h2></div>
    {guideline_table()}
  </div>
</div></section>''' + closing(c, "See the plan for your own candidate.", [("Prioritise", "/product/prioritise/"), ("All modalities", "/modalities/"), ("Methods", "/science/methods/")])
    return page(c, title="Plan your IND-enabling studies · Hakase BioSim",
                description="BioSim derives the nonclinical study plan your drug needs from ICH and FDA guidance, with each study cited to the section that requires it.",
                body=body, trail=[("Product", "/product/"), ("Plan", "/product/plan/")], ld=[APP])

def product_prioritise(c: Ctx):
    ex = [("hERG patch clamp", "2 weeks", "0.41"), ("14-day dose range-finding, rat and dog", "12 weeks", "0.90"),
          ("28-day GLP repeat-dose toxicity", "18 weeks", "0.92"), ("Dog cardiovascular telemetry", "12 weeks", "0.36"),
          ("Ames and in vitro micronucleus", "7 weeks", "0.03")]
    rows = "".join(f'<li><span>{e(a)}</span><span class="num">{e(b)}</span><span class="num">{e(p)}</span></li>' for a, b, p in ex)
    body = intro(c, [("Product", "/product/"), ("Prioritise", "/product/prioritise/")], "Product · Step 2", "Prioritise: run the deciding studies first.",
                 "BioSim suggests an order for your studies that surfaces a programme-ending problem as early, and as cheaply, as possible.") + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  <div class="block">
    <div><p class="kicker">The idea</p><h2 class="h2">Find the deal-breaker before the expensive work.</h2></div>
    <div class="prose">
      <p>A programme moves forward only if every study passes. So the studies most likely to stop it, for the time they take, should run first. This is a well-studied problem in sequential testing, with a known best answer.<sup class="fn"><a href="#src-1">1</a></sup></p>
      <p>BioSim estimates, for your molecule, which liabilities are most likely: from what approved drugs in the same class showed in animals, from the molecule’s chemistry and from hERG data on close analogues. It then orders the studies by time divided by their score for finding a programme-ending problem, always inside the order the guidelines require. A dose range-finding study still comes before the pivotal study it informs.</p>
    </div>
  </div>
  <div class="block">
    <div><p class="kicker">Worked example</p><h2 class="h3">An oral kinase inhibitor.</h2><p class="small muted">Illustrative inputs. The kill score ranks studies; it is not a calibrated probability. In BioSim it comes from the molecule’s own triage, and durations come from your lab quotes.</p></div>
    <ol class="order">
      <li class="order-head"><span>Study, in suggested order</span><span>Duration</span><span>Kill score</span></li>
      {rows}
    </ol>
  </div>
  <div class="block">
    <div><p class="kicker">Limits</p><h2 class="h3">Decision support, stated as such.</h2></div>
    <div class="prose">
      <p>The suggested order never adds, removes or waives a required study, and it never enters a submission. Without your lab quotes, BioSim uses a flagged default duration and marks the order provisional.</p>
    </div>
  </div>
  {sources(["Mitten LG. An analytic solution to the least cost testing sequence problem. Journal of Industrial Engineering 1960;11(1):17.", "Sidney JB. Decomposition algorithms for single-machine sequencing with precedence relations and deferral costs. Operations Research 1975;23(2):283–298."])}
</div></section>''' + closing(c, "See the order for your own molecule.", [("Run", "/product/run/"), ("Methods", "/science/methods/"), ("Plan", "/product/plan/")])
    return page(c, title="Prioritise preclinical studies · Hakase BioSim",
                description="BioSim orders your preclinical studies so the ones most likely to stop a programme run first, inside the sequence the guidelines require.",
                body=body, trail=[("Product", "/product/"), ("Prioritise", "/product/prioritise/")], ld=[APP])

def product_run(c: Ctx):
    drv = "".join(f'<tr><td>{e(d["name"])}</td><td>{e(d["description"])}</td></tr>' for d in sorted(DRIVERS, key=lambda d: d["name"]))
    body = intro(c, [("Product", "/product/"), ("Run", "/product/run/")], "Product · Step 3", "Run: any lab, one standard.",
                 "BioSim sends each study to the lab you choose, checks what comes back and analyses it with published methods. The Study Director and QA sign the result.") + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  <div class="block">
    <div><p class="kicker">Dispatch</p><h2 class="h2">A complete package for the lab.</h2></div>
    <div class="prose">
      <p>For each study, BioSim prepares a dispatch package: the protocol your team approved, the sample manifest, a data template, return instructions and a checksum manifest so nothing changes in transit. It works with an external contract lab, your own lab, or both.</p>
    </div>
  </div>
  <div class="block">
    <div><p class="kicker">Intake</p><h2 class="h2">Returned data is checked before anything is computed.</h2></div>
    <div class="prose">
      <p>Results are validated against the protocol line by line. Every problem is reported with its line number, and rejected uploads are recorded too. A file that was simulated cannot be re-uploaded as measured.</p>
    </div>
  </div>
  <div>
    <div class="head"><p class="kicker">Analysis</p><h2 class="h2">Study types BioSim runs end to end.</h2><p class="lead">Each study type is a driver: protocol, data checks, analysis with cited methods, and report. Expert judgements such as a NOAEL are recorded as the Study Director’s signed decision.</p></div>
    <div class="table-wrap"><table class="data"><thead><tr><th scope="col">Study type</th><th scope="col">What the analysis does</th></tr></thead><tbody>{drv}</tbody></table></div>
  </div>
  <div class="block">
    <div><p class="kicker">Studies run elsewhere</p><h2 class="h3">Import a finished report.</h2></div>
    <div class="prose"><p>A study run before BioSim, or of a type without a driver, can be imported. The report is stored with its fingerprint, every transcribed value cites its page and table, and the import is signed by the responsible people. It is always shown as imported, never as run in BioSim.</p></div>
  </div>
</div></section>''' + closing(c, "Bring a study you are about to place.", [("Submit", "/product/submit/"), ("Security", "/security/"), ("Methods", "/science/methods/")])
    return page(c, title="Run preclinical studies with any lab · Hakase BioSim",
                description="Dispatch studies to any contract lab, check returned data line by line and analyse it with published methods, with study director and QA signatures.",
                body=body, trail=[("Product", "/product/"), ("Run", "/product/run/")], ld=[APP])

def product_submit(c: Ctx):
    items = [
        ("IND readiness", "A live view of which required studies are covered, in progress or missing, against the plan for your clinical protocol."),
        ("Module 2 summaries", "Drafts of the nonclinical overview (2.4) and summaries (2.6). Every number in the text is sourced, and a named author signs."),
        ("Module 4", "The nonclinical study reports assembled in the structure ICH M4S(R2) sets out."),
        ("SEND datasets", "Export for repeat-dose toxicity and toxicokinetic studies to SENDIG v3.1.1 with controlled terminology, Define-XML 2.1 and SAS XPORT v5, with checks run before export."),
        ("Offline verification", "Every Module 4 export can be re-checked without BioSim: each analysis is re-run from the raw files, and every file fingerprint, ledger entry and signature is verified."),
    ]
    lis = "".join(f'<li><strong>{e(t)}</strong><p>{e(d)}</p></li>' for t, d in items)
    body = intro(c, [("Product", "/product/"), ("Submit", "/product/submit/")], "Product · Step 4", "Submit: the nonclinical IND package, traced to raw data.",
                 "BioSim assembles the nonclinical part of your IND from the signed record, so every figure in it can be traced to the raw data behind it.") + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  <div class="block">
    <div><p class="kicker">What you get</p><h2 class="h2">Built from the record, not retyped.</h2></div>
    <ul class="list-plain">{lis}</ul>
  </div>
</div></section>''' + closing(c, "Start with a readiness review of the studies you have.", [("Security", "/security/"), ("Modalities", "/modalities/"), ("Plan", "/product/plan/")])
    return page(c, title="Assemble your IND, Module 4 and SEND · Hakase BioSim",
                description="BioSim assembles IND readiness, Module 2 summaries, CTD Module 4 and SEND datasets from a signed record that can be verified offline.",
                body=body, trail=[("Product", "/product/"), ("Submit", "/product/submit/")], ld=[APP])

# ---------------------------------------------------------------- SCIENCE
KINDS = [("Measured", "From a study you ran, linked to its raw file."), ("Literature", "From a cited publication or database, with the record it came from."),
         ("Computed", "Calculated by a named, versioned and cited method."), ("Predicted", "From a named, versioned model, only inside its stated applicability domain."),
         ("Guideline", "Taken from a regulation or guidance, with the section."), ("User-supplied", "Entered and attested by a named person."),
         ("Simulated", "Generated for rehearsal. Never evidence, never approvable."), ("Unavailable", "Not known, with the reason. Never replaced by a default.")]

def science(c: Ctx):
    kinds = "".join(f'<li><strong>{e(k)}</strong><span>{e(d)}</span></li>' for k, d in KINDS)
    body = intro(c, [("Science", "/science/")], "Science", "Every result can be checked.",
                 "A number in a submission is only as good as its origin. BioSim records where every value came from, and refuses to produce one it cannot support.", dark=True) + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  <div class="block">
    <div><p class="kicker">Where values come from</p><h2 class="h2">Every value carries its origin.</h2><p class="small muted">There are eight. A guess is not one of them.</p></div>
    <ul class="defs">{kinds}</ul>
  </div>
  <div class="block">
    <div><p class="kicker">Principles</p><h2 class="h2">How the record stays reliable.</h2></div>
    <ul class="list-plain">
      <li><strong>Nothing is guessed</strong><p>If a value cannot be obtained, BioSim returns it as unavailable with the reason: a database that did not answer, a study not yet run, a fact not yet decided.</p></li>
      <li><strong>Simulated stays simulated</strong><p>Results derived from simulated data stay marked as simulated, cannot be approved and never enter Module 4.</p></li>
      <li><strong>Same inputs, same answer</strong><p>Before dispatch and before reporting, BioSim re-runs the analysis and refuses to continue if it no longer reproduces the recorded result.</p></li>
      <li><strong>People decide</strong><p>A NOAEL, a call on an Ames test, a choice of species: these are signed determinations by the person who owns them, never outputs of the software.</p></li>
      <li><strong>Methods are published</strong><p>Every calculation names its method, version, assumptions, limits and references. The registry is open below.</p></li>
    </ul>
  </div>
  <div>
    <div class="head"><p class="kicker">Go deeper</p><h2 class="h2">The evidence, in full.</h2></div>
    <ul class="cards">
      <li><a class="card-link" href="{c.url('/science/methods/')}"><strong>Methods registry</strong><span>{sum(len(a["methods"]) for a in METHODS["areas"])} methods across {len(METHODS["areas"])} areas, each with assumptions, limits and references.</span><span class="more">Browse the methods</span></a></li>
      <li><a class="card-link" href="{c.url('/glossary/')}"><strong>Glossary</strong><span>The terms used across BioSim and IND-enabling work.</span><span class="more">Open the glossary</span></a></li>
    </ul>
  </div>
</div></section>''' + closing(c, "Trace any number in a live demo.", [("Methods", "/science/methods/"), ("Security", "/security/"), ("Product", "/product/")])
    return page(c, title="How BioSim keeps results trustworthy · Hakase BioSim",
                description="Every value in BioSim records where it came from. Nothing is guessed, simulated data stays simulated, and people sign every decision.",
                body=body, trail=[("Science", "/science/")], ld=[{"@type": "TechArticle", "headline": "Every result can be checked", "about": "Data provenance in preclinical drug development", "author": {"@id": "https://hakase.ai/#organization"}}])

def methods_index(c: Ctx):
    cards = "".join(f'<li><a class="card-link" href="{c.url(f"/science/methods/{a["slug"]}/")}"><strong>{e(a["name"])}</strong><span>{len(a["methods"])} method{"s" if len(a["methods"]) != 1 else ""}: {e(", ".join(m["title"] for m in a["methods"][:2]))}{"…" if len(a["methods"]) > 2 else ""}</span><span class="more">Open</span></a></li>' for a in METHODS["areas"])
    total = sum(len(a["methods"]) for a in METHODS["areas"])
    body = intro(c, [("Science", "/science/"), ("Methods", "/science/methods/")], "Science · Methods", "Methods registry.",
                 f"Every calculation in BioSim uses a published method, recorded with its version, assumptions, limits and references. {total} methods across {len(METHODS['areas'])} areas, generated from the registry itself.") + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  <ul class="cards">{cards}</ul>
</div></section>''' + closing(c, "Want a method we don’t list? Ask us.", [("Product", "/product/"), ("Glossary", "/glossary/"), ("Our approach", "/science/")])
    return page(c, title="Methods registry · Hakase BioSim",
                description=f"The {total} published methods BioSim uses, from IVIVE and NCA to dose projection and safety statistics, each with assumptions, limits and references.",
                body=body, trail=[("Science", "/science/"), ("Methods", "/science/methods/")])

def methods_area(c: Ctx, a):
    def lst(items):
        return "<ul>" + "".join(f"<li>{e(x)}</li>" for x in items) + "</ul>" if items else '<p class="small muted">None stated.</p>'
    ms = []
    for m in a["methods"]:
        refs = "".join(f'<li>{e(r["text"])} {f"<a href={chr(34)}{e(r["url"])}{chr(34)} rel={chr(34)}noopener{chr(34)}>{e(r["url"].replace("https://", ""))}</a>" if r["url"] else ""}</li>' for r in m["references"])
        ms.append(f'''<article class="method" id="{e((m["id"] or "").replace(".", "-"))}">
  <p class="method-id">{e(m["id"] or "")} · version {e(m["version"] or "")}</p>
  <h2>{e(m["title"])}</h2>
  <div class="method-cols"><div><h3>Assumptions</h3>{lst(m["assumptions"])}</div><div><h3>Limits</h3>{lst(m["limits"])}</div></div>
  <div><h3>References</h3><ul class="refs">{refs}</ul></div>
</article>''')
    trail = [("Science", "/science/"), ("Methods", "/science/methods/"), (a["name"], f"/science/methods/{a['slug']}/")]
    body = intro(c, trail, "Methods registry", f"{e(a['name'])} methods.",
                 f"{len(a['methods'])} method{'s' if len(a['methods']) != 1 else ''} in this area. Each lists the assumptions it makes and the limits outside which its result is not valid.") + f'''
<section class="section" style="padding-top:0"><div class="wrap"><div style="max-width:72rem">{"".join(ms)}</div></div></section>''' + closing(c, "See these methods at work on your data.", [("All methods", "/science/methods/"), ("Glossary", "/glossary/"), ("Product", "/product/")])
    first = ", ".join(m["title"] for m in a["methods"][:2])
    desc = f"{a['name']} methods in BioSim: {first}. Versions, assumptions, limits and primary references."
    return page(c, title=f"{a['name']} methods · Hakase BioSim", description=desc[:158], body=body, trail=trail,
                ld=[{"@type": "TechArticle", "headline": f"{a['name']} methods", "author": {"@id": "https://hakase.ai/#organization"},
                     "citation": [r["text"] for m in a["methods"] for r in m["references"]][:30]}])

# ---------------------------------------------------------------- MODALITIES
def modalities_index(c: Ctx):
    rows = []
    for slug in MOD_ORDER:
        s = SETS[slug]
        gov = ", ".join(GUIDE_SHORT.get(g["key"], g["key"]) for g in s["governing_guidelines"]) or "—"
        rows.append(f'<tr><td><a href="{c.url(f"/modalities/{slug}/")}">{e(s["label"])}</a></td><td>{e(gov)}</td><td>{e(", ".join(s["facts"][:3]))}</td></tr>')
    body = intro(c, [("Modalities", "/modalities/")], "Modalities", "Study plans by drug type.",
                 "Different drug types follow different guidance. Each page below shows the plan BioSim derives for a typical programme of that type, with the reason for every study.", dark=True) + f'''
<section class="section" style="padding-top:0"><div class="wrap">
  <div class="table-wrap"><table class="data"><thead><tr><th scope="col">Drug type</th><th scope="col">Governing guidance</th><th scope="col">Reference programme</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>
</div></section>''' + closing(c, "Bring a programme. Leave with its plan.", [("Plan", "/product/plan/"), ("Science", "/science/"), ("Product", "/product/")])
    return page(c, title="IND-enabling study plans by modality · Hakase BioSim",
                description="Nonclinical study plans for small molecules, antibodies, peptides, oligonucleotides, proteins, ADCs, cell and gene therapies and vaccines.",
                body=body, trail=[("Modalities", "/modalities/")])

def modality(c: Ctx, slug):
    s = SETS[slug]
    trail = [("Modalities", "/modalities/"), (s["label"], f"/modalities/{slug}/")]
    gov = "".join(f'<li><a href="{e(g["url"])}" rel="noopener">{e(re.sub(r"[.]\s*Step 4.*$", "", g["text"]))}</a></li>' for g in s["governing_guidelines"] if g.get("url"))
    notes = "".join(f"<p>{e(n)}</p>" for n in s.get("notes", []))
    facts = "".join(f'<span class="chip">{e(f)}</span>' for f in s["facts"])
    body = intro(c, trail, "Modality", f"IND-enabling studies for {e(MOD_PLURAL[slug])}.",
                 f"The nonclinical plan BioSim derives for a typical {e(s['label'].lower())} programme. Change any fact and the plan is derived again.",
                 extra=f'<div class="plan-facts" style="background:none;border:0;padding:0">{facts}</div>') + f'''
<section class="section" style="padding-top:0"><div class="wrap stack">
  {f'<div class="note-box"><p class="kicker">Engine notes</p>{notes}</div>' if notes else ""}
  <div>{plan_table(slug)}</div>
  {f'<div class="block"><div><p class="kicker">Governing guidance</p><h2 class="h3">Official texts.</h2></div><ul class="list-plain">{gov}</ul></div>' if gov else ""}
  <p class="small muted">Engine output for the stated reference programme. Your plan depends on your programme’s own facts, and your toxicologist reviews it.</p>
</div></section>''' + closing(c, f"Bring a {e(s['label'].lower())} programme. Leave with its plan.", [("All modalities", "/modalities/"), ("Plan", "/product/plan/"), ("Prioritise", "/product/prioritise/")])
    return page(c, title=f"{s['label']} IND-enabling studies · Hakase BioSim",
                description=f"The preclinical study plan for {MOD_PLURAL[slug]}: each IND-enabling study, its timing and the guideline section that requires it.",
                body=body, trail=trail)
