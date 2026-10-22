"""Build the Hakase BioSim site.

    python3 build.py                 -> ../docs        (production: clean URLs; GitHub Pages serves docs/)
    python3 build.py --preview DIR   -> DIR            (explicit index.html links, for preview hosts and file://)
    python3 build.py --og            -> also render share images (needs Playwright + Chromium)

Data comes from ./data (see derive_sets.py and extract.py). Static assets come from ../src.
"""
from __future__ import annotations
import datetime, json, pathlib, shutil, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from lib import Ctx, SITE, BASE, og_name
import content_core as cc
import content_more as cm

HERE = pathlib.Path(__file__).parent
SRC = HERE.parent / "src"

def routes():
    r = [("/", lambda c: cc.home(c)), ("/product/", cc.product), ("/product/inside/", cc.product_inside), ("/product/plan/", cc.product_plan),
         ("/product/prioritise/", cc.product_prioritise), ("/product/run/", cc.product_run), ("/product/submit/", cc.product_submit),
         ("/science/", cc.science), ("/science/validation/", cc.validation), ("/science/methods/", cc.methods_index)]
    for a in cc.METHODS["areas"]:
        r.append((f"/science/methods/{a['slug']}/", (lambda a: lambda c: cc.methods_area(c, a))(a)))
    r.append(("/modalities/", cc.modalities_index))
    for slug in cc.MOD_ORDER:
        r.append((f"/modalities/{slug}/", (lambda s: lambda c: cc.modality(c, s))(slug)))
    r += [("/investors/", cm.investors), ("/company/", cm.company), ("/contact/", cm.contact), ("/security/", cm.security), ("/glossary/", cm.glossary)]
    return r

PRIORITY = {"/": "1.0", "/product/": "0.9", "/investors/": "0.9", "/contact/": "0.8", "/modalities/": "0.8", "/science/": "0.8"}

def build(out: pathlib.Path, mode: str, preview_root_home=False):
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(SRC, out)
    pages = []
    for path, fn in routes():
        c = Ctx(path, mode)
        html = cc.home(c, preview_root=True) if (path == "/" and preview_root_home) else fn(c)
        dest = out / path.lstrip("/") / "index.html"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(html)
        pages.append(path)
    # 404 lives at the root and must work from any depth, so its links are root-absolute
    nf = cm.not_found(Ctx("/404.html", "absolute" if mode == "clean" else mode))
    (out / "404.html").write_text(nf)
    today = datetime.date.today().isoformat()
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for p in pages:
        sm.append(f"  <url><loc>{SITE}{BASE.rstrip('/')}{p}</loc><lastmod>{today}</lastmod><priority>{PRIORITY.get(p, '0.6' if p.count('/') <= 3 else '0.5')}</priority></url>")
    sm.append("</urlset>")
    (out / "sitemap.xml").write_text("\n".join(sm) + "\n")
    (out / "robots.txt").write_text(
        "# hakase.bio — all crawlers welcome, including AI answer engines\n"
        "User-agent: *\nAllow: /\n\n"
        "User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\n"
        f"Sitemap: {SITE}{BASE.rstrip('/')}/sitemap.xml\n")
    (out / "site.webmanifest").write_text(json.dumps({
        "name": "Hakase BioSim", "short_name": "BioSim", "start_url": BASE, "display": "browser",
        "background_color": "#F4F6F9", "theme_color": "#0E1A33",
        "icons": [{"src": BASE.rstrip("/") + "/assets/img/icon-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": BASE.rstrip("/") + "/assets/img/icon-512.png", "sizes": "512x512", "type": "image/png"}]}, indent=1))
    (out / ".nojekyll").write_text("")
    (out / "llms.txt").write_text(llms(pages))
    return pages

def llms(pages):
    SITE_ = SITE + BASE.rstrip("/")
    lines = ["# Hakase BioSim", "",
             "> BioSim is preclinical development software from Hakase AI. It plans the nonclinical studies a drug candidate needs from ICH, FDA and WHO guidance, orders them so the studies most likely to stop a programme run first, runs them with any contract lab, and assembles the nonclinical part of the IND (CTD Module 4 and SEND). Every value records its source; people sign every decision.", "",
             "## Product", f"- [How BioSim works]({SITE_}/product/)", f"- [Inside BioSim: the engines and HAIOps]({SITE_}/product/inside/)", f"- [Plan]({SITE_}/product/plan/)", f"- [Prioritise]({SITE_}/product/prioritise/)",
             f"- [Run]({SITE_}/product/run/)", f"- [Submit]({SITE_}/product/submit/)", "",
             "## Science", f"- [Our approach to provenance]({SITE_}/science/)", f"- [Validation on approved drugs]({SITE_}/science/validation/)",
             f"- [Methods registry]({SITE_}/science/methods/)", f"- [Glossary]({SITE_}/glossary/)", "",
             "## Study plans by modality"] + [f"- [{cc.SETS[s]['label']}]({SITE_}/modalities/{s}/)" for s in cc.MOD_ORDER] + [
             "", "## Company", f"- [Investors]({SITE_}/investors/)", f"- [Company and team]({SITE_}/company/)", f"- [Security and compliance]({SITE_}/security/)",
             f"- [Contact]({SITE_}/contact/)", "", "Contact: info@hakase.ai", ""]
    return "\n".join(lines)

OG_TITLES = {}

def render_og(out: pathlib.Path, pages):
    from playwright.sync_api import sync_playwright
    import html as H, re

    import base64
    LOGO64 = base64.b64encode((SRC / "assets/img/hakase-logo@2x.png").read_bytes()).decode()
    logo = f'<img src="data:image/png;base64,{LOGO64}" alt="" style="height:44px;width:auto">'
    f64 = lambda n: base64.b64encode((SRC / "assets/fonts" / n).read_bytes()).decode()
    NEWS, MONO, SANS = f64("newsreader.woff2"), f64("dm-mono-500.woff2"), f64("schibsted-grotesk-var.woff2")
    (out / "assets/og").mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1200, "height": 630})
        for path in pages:
            doc = (out / path.lstrip("/") / "index.html").read_text()
            h1 = re.search(r"<h1[^>]*>(.*?)</h1>", doc, re.S)
            title = H.unescape(re.sub("<[^>]+>", "", h1.group(1))).strip() if h1 else "Hakase BioSim"
            kicker = re.search(r'<p class="kicker">(.*?)</p>', doc)
            kicker = H.unescape(re.sub("<[^>]+>", "", kicker.group(1))) if kicker else ""
            url = (SITE + BASE.rstrip("/")).replace("https://", "") + path
            page_html = f'''<html><head><style>
@font-face{{font-family:N;src:url(data:font/woff2;base64,{NEWS}) format("woff2")}}
@font-face{{font-family:M;src:url(data:font/woff2;base64,{MONO}) format("woff2")}}
body{{margin:0;width:1200px;height:630px;background:#F4F6F9;font-family:N;display:flex;flex-direction:column;justify-content:space-between;padding:64px 72px;box-sizing:border-box;color:#0E1A33}}
.top{{display:flex;align-items:center;gap:20px}} .k{{font:500 18px M;letter-spacing:.12em;text-transform:uppercase;color:#5F6B80}}
h1{{font:400 {'76' if len(title) < 40 else '64'}px/1.06 N;letter-spacing:-.025em;margin:0;max-width:1000px}} .u{{font:500 18px M;color:#0A6E93;letter-spacing:.04em}}
.bar{{position:absolute;left:0;bottom:0;height:10px;width:100%;background:#0E1A33}} .bar i{{display:block;height:10px;width:120px;background:#36C5F4}}
</style></head><body><div class="top">{logo}</div><div><p class="k">{H.escape(kicker)}</p><h1>{H.escape(title)}</h1></div><div class="u">{url}</div><div class="bar"><i></i></div></body></html>'''
            pg.set_content(page_html); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(80)
            pg.screenshot(path=str(out / "assets/og" / f"{og_name(path)}.png"))
        b.close()

if __name__ == "__main__":
    args = sys.argv[1:]
    if "--preview" in args:
        out = pathlib.Path(args[args.index("--preview") + 1]).resolve()
        pages = build(out, "explicit", preview_root_home=True)
        # a standalone, full-document copy of the home page as well, for file:// viewing
        (out / "home.html").write_text(cc.home(Ctx("/", "explicit")))
    else:
        out = (HERE.parent / "docs").resolve()
        pages = build(out, "clean")
    if "--og" in args:
        render_og(out, pages)
    print(f"built {len(pages)} pages + 404 into {out}")
