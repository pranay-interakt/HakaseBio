"""Shared layout, components and URL handling for the Hakase BioSim site."""
from __future__ import annotations
import html, json, posixpath, re

import os
SITE = os.environ.get("SITE_URL", "https://hakase.bio").rstrip("/")
BASE = os.environ.get("SITE_BASE", "/")  # path under which the site is served, e.g. /biosim/
SITE_NAME = "Hakase BioSim"
EMAIL = "info@hakase.ai"
LINKEDIN = "https://www.linkedin.com/company/hakase-ai/"
X_URL = "https://x.com/HakaseAI_"
PARENT = "https://hakase.ai"

def e(s) -> str:
    return html.escape(str(s), quote=True)

class Ctx:
    """Per-page context: knows where the page lives so every link can be made relative.

    mode 'clean'   -> links like ../science/ (production; the host serves index.html)
    mode 'explicit'-> links like ../science/index.html (preview hosts and file://)
    """
    def __init__(self, path: str, mode: str):
        self.path = path  # e.g. "/product/plan/"
        self.mode = mode

    def _rel(self, target: str) -> str:
        here = self.path if self.path.endswith("/") else posixpath.dirname(self.path) + "/"
        rel = posixpath.relpath(target, here) if target != here else "."
        return rel

    def url(self, target: str) -> str:
        """Link to a page path such as '/science/' or '/science/#x'."""
        frag = ""
        if "#" in target:
            target, frag = target.split("#", 1); frag = "#" + frag
        if target == "":
            return frag
        if self.mode == "absolute":
            return BASE.rstrip("/") + target + frag
        rel = self._rel(target)
        if target.endswith("/"):
            rel = "" if rel == "." else rel + "/"
            if self.mode == "explicit":
                rel = rel + "index.html"
            elif rel == "":
                rel = "./"
        return rel + frag

    def asset(self, p: str) -> str:
        if self.mode == "absolute":
            return BASE.rstrip("/") + "/" + p.lstrip("/")
        return self._rel("/" + p.lstrip("/"))

ARROW = '<svg class="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
ARROW_DOWN = '<svg class="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2.5v10M4.5 9 8 12.5 11.5 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
ARROW_OUT = '<svg class="i" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

def hakase_img(c: Ctx, h=15, alt="Hakase", cls="") -> str:
    w = round(1001 / 294 * h)
    out = []
    for variant, mode in (("hakase-logo", "on-light"), ("hakase-logo-dark", "on-dark")):
        src = c.asset(f"assets/img/{variant}.webp"); src2 = c.asset(f"assets/img/{variant}@2x.webp")
        out.append(f'<img class="{mode} {cls}" src="{src}" srcset="{src} 1x, {src2} 2x" alt="{e(alt)}" width="{w}" height="{h}">')
    return "".join(out)

NAV = [("Product", "/product/"), ("Science", "/science/"), ("Modalities", "/modalities/"), ("Investors", "/investors/"), ("Company", "/company/")]

def header(c: Ctx) -> str:
    links = []
    for label, href in NAV:
        cur = ""
        if c.path == href:
            cur = ' aria-current="page"'
        elif c.path.startswith(href):
            cur = ' class="is-section"'
        links.append(f'<a href="{c.url(href)}"{cur}>{label}</a>')
    return f'''<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="{c.url('/')}">{hakase_img(c, 30, "Hakase, home", "brand-logo")}</a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" class="nav" aria-label="Primary">
      {"".join(links)}
      <a class="btn btn--sm" href="{c.url('/contact/')}">Book a demo {ARROW}</a>
    </nav>
    <button class="theme-btn" type="button" aria-label="Switch to dark theme" data-theme-toggle><svg class="sun" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.2M10 16v2.2M1.8 10H4M16 10h2.2M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6"/></svg><svg class="moon" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9Z"/></svg></button>
  </div>
</header>'''

FOOTER_COLS = [
    ("Product", [("How it works", "/product/"), ("Inside BioSim", "/product/inside/"), ("Plan", "/product/plan/"), ("Prioritise", "/product/prioritise/"), ("Run", "/product/run/"), ("Submit", "/product/submit/")]),
    ("Science", [("Our approach", "/science/"), ("Validation", "/science/validation/"), ("Methods", "/science/methods/"), ("Glossary", "/glossary/")]),
    ("Modalities", [("Small molecules", "/modalities/small-molecule/"), ("Monoclonal antibodies", "/modalities/monoclonal-antibody/"), ("Peptides", "/modalities/peptide/"), ("All nine", "/modalities/")]),
    ("Company", [("About and team", "/company/"), ("Investors", "/investors/"), ("Security", "/security/"), ("Contact", "/contact/")]),
]

def footer(c: Ctx) -> str:
    cols = "".join(
        f'<div class="footer-col"><h2>{h}</h2><ul>' + "".join(f'<li><a href="{c.url(u)}">{e(t)}</a></li>' for t, u in items) + '</ul></div>'
        for h, items in FOOTER_COLS)
    return f'''<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <a href="{c.url('/')}" class="brand">{hakase_img(c, 30, "Hakase, home", "brand-logo")}</a>
        <p class="tag">From drug candidate to IND.</p>
        <p class="maker">BioSim, preclinical development software by <a href="{PARENT}" rel="noopener">Hakase AI</a>.</p>
        <p><a href="mailto:{EMAIL}">{EMAIL}</a></p>
      </div>
      {cols}
    </div>
    <div class="footer-base">
      <p>BioSim supports qualified scientific and regulatory review. Its outputs do not by themselves establish experimental, clinical or regulatory outcomes.</p>
      <p>© 2026 Hakase AI · <a href="{PARENT}/privacy/" rel="noopener">Privacy</a> · <a href="{PARENT}/terms/" rel="noopener">Terms</a> · <a href="{LINKEDIN}" rel="noopener">LinkedIn</a> · <a href="{X_URL}" rel="noopener">X</a></p>
    </div>
  </div>
</footer>'''

def crumbs(c: Ctx, trail) -> str:
    items = [f'<li><a href="{c.url("/")}">Home</a></li>']
    for i, (label, href) in enumerate(trail):
        if i == len(trail) - 1:
            items.append(f'<li aria-current="page">{e(label)}</li>')
        else:
            items.append(f'<li><a href="{c.url(href)}">{e(label)}</a></li>')
    return f'<nav aria-label="Breadcrumb"><ol class="crumbs">{"".join(items)}</ol></nav>'

def intro(c: Ctx, trail, kicker, h1, standfirst, extra="") -> str:
    return f'''<section class="intro"><div class="wrap">
  {crumbs(c, trail)}
  <div class="intro-grid">
    <p class="kicker">{e(kicker)}</p>
    <h1 class="h1 h1--page">{h1}</h1>
    <p class="lead">{standfirst}</p>
    {extra}
  </div>
</div></section>'''

def closing(c: Ctx, title, related, button=("Book a demo", "/contact/")) -> str:
    rel = "".join(f'<a href="{c.url(u)}">{e(t)} {ARROW}</a>' for t, u in related)
    return f'''<section class="closing"><div class="wrap">
  <h2 class="h2" style="max-width:20em">{title}</h2>
  <div class="actions"><a class="btn" href="{c.url(button[1])}">{e(button[0])} {ARROW}</a></div>
  <div class="related"><span class="kicker">Related</span>{rel}</div>
</div></section>'''

def sources(items, title="Sources") -> str:
    lis = []
    for it in items:
        if isinstance(it, tuple):
            text, url = it
            lis.append(f'<li id="src-{len(lis)+1}"><span>{e(text)} <a href="{e(url)}" rel="noopener">{e(re.sub(r"^https?://(www\.)?", "", url).split("/")[0])}</a></span></li>')
        else:
            lis.append(f'<li id="src-{len(lis)+1}"><span>{e(it)}</span></li>')
    return f'<div class="sources"><p class="kicker">{title}</p><ol>{"".join(lis)}</ol></div>'

# ---------- JSON-LD ----------
ORG = {
    "@type": "Organization", "@id": f"{PARENT}/#organization", "name": "Hakase AI", "url": PARENT,
    "logo": f"{SITE}{BASE.rstrip('/')}/assets/img/hakase-logo.png", "email": EMAIL, "sameAs": [LINKEDIN, X_URL],
}
ROOT = SITE + BASE.rstrip("/")
WEBSITE = {"@type": "WebSite", "@id": f"{ROOT}/#website", "url": f"{ROOT}/", "name": SITE_NAME, "publisher": {"@id": f"{PARENT}/#organization"}, "inLanguage": "en-GB"}
APP = {
    "@type": "SoftwareApplication", "@id": f"{ROOT}/#biosim", "name": "BioSim", "alternateName": "Hakase BioSim",
    "applicationCategory": "BusinessApplication", "applicationSubCategory": "Preclinical drug development",
    "operatingSystem": "Web", "url": f"{ROOT}/",
    "description": "Software that plans the preclinical studies a drug candidate needs from ICH and FDA guidance, runs them with any contract lab and assembles the nonclinical part of the IND, with every result traceable to its source.",
    "publisher": {"@id": f"{PARENT}/#organization"}, "image": f"{ROOT}/assets/img/icon-512.png",
}

def breadcrumb_ld(trail):
    items = [{"@type": "ListItem", "position": 1, "name": "Home", "item": f"{ROOT}/"}]
    for i, (label, href) in enumerate(trail):
        items.append({"@type": "ListItem", "position": i + 2, "name": label, "item": ROOT + href})
    return {"@type": "BreadcrumbList", "itemListElement": items}

def faq_ld(qas):
    return {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": re.sub("<[^>]+>", "", a)}} for q, a in qas]}

def faq_html(qas) -> str:
    return '<div class="faq">' + "".join(
        f'<details{" open" if i == 0 else ""}><summary>{e(q)}</summary><div class="answer"><p>{a}</p></div></details>'
        for i, (q, a) in enumerate(qas)) + '</div>'

def page(c: Ctx, *, title, description, body, trail=None, ld=None, og_type="website", preview_root=False, noindex=False) -> str:
    canonical = SITE + (BASE.rstrip("/") if c.path != "/404.html" else "") + c.path
    og_img = f"{SITE}{BASE.rstrip('/')}/assets/og/{'home' if noindex else og_name(c.path)}.png"
    graph = [ORG, WEBSITE]
    if trail:
        graph.append(breadcrumb_ld(trail))
    graph += (ld or [])
    ld_json = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    robots = "noindex,follow" if noindex else "index,follow,max-image-preview:large"
    headbits = f'''<title>{e(title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{canonical}">
<meta name="robots" content="{robots}">
<meta name="theme-color" content="#F4F6F9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0B1324" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="{og_type}">
<meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{og_img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{e(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@HakaseAI_">
<link rel="icon" href="{c.asset('favicon.ico')}" sizes="16x16 32x32 48x48">
<link rel="icon" href="{c.asset('assets/img/favicon-32.png')}" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="{c.asset('assets/img/apple-touch-icon.png')}">
<link rel="manifest" href="{c.asset('site.webmanifest')}">
<link rel="preload" href="{c.asset('assets/fonts/newsreader.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="{c.asset('assets/fonts/schibsted-grotesk-var.woff2')}" as="font" type="font/woff2" crossorigin>
<script>(function(){{var t;try{{t=localStorage.getItem("hakase-theme")}}catch(e){{}}document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light")}})();</script>
<link rel="stylesheet" href="{c.asset('assets/css/site.css')}">
<script defer src="{c.asset('assets/js/site.js')}"></script>
<script type="application/ld+json">{ld_json}</script>'''
    content = f'''{header(c)}
<main id="main">
{body}
</main>
{footer(c)}'''
    if preview_root:
        # The preview host wraps this file in its own document skeleton.
        return f'''<title>{e(title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
{headbits.split(chr(10), 1)[1]}
{content}
'''
    return f'''<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{headbits}
</head>
<body>
{content}
</body>
</html>
'''

def og_name(path: str) -> str:
    return "home" if path == "/" else path.strip("/").replace("/", "--")
