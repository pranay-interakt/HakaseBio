# hakase.bio — the Hakase BioSim website

A static, multi-page site for BioSim. It has 50 crawlable pages plus a 404, with no framework, cookies or third-party requests. It is a light site with deep-navy opening bands on the main section pages (home, product, science, modalities, security, investors).

```
docs/      the built website, served by GitHub Pages
build/     the generator (Python): page templates, copy, and data pulled from the product repo
src/       static assets: stylesheet, script, self-hosted fonts, the Hakase logo, the hero image, icons
```

## Hosting

GitHub Pages serves the `docs/` folder of the `master` branch of pranay-interakt/HakaseBio at **https://pranay-interakt.github.io/HakaseBio/**. In the repository go to Settings → Pages, set Source to "Deploy from a branch", branch `master`, folder `/docs`, and save. The site is live a minute later.

To move it to **hakase.bio** later: add the domain under Settings → Pages → Custom domain (GitHub writes a `CNAME` file into `docs/`), point the domain's DNS at GitHub Pages, then rebuild with `SITE_URL=https://hakase.bio SITE_BASE=/` so canonical links and the sitemap use the new address.

## Rebuild after a change

Requirements: Python 3.12+, plus the backend's own dependencies for derive_sets.py and extract.py. For share images you also need Playwright with Chromium.

```
cd build
python3 derive_sets.py /path/to/hakase_operating_system/backend   # re-runs the regulatory engine for the nine reference programmes
python3 extract.py     /path/to/hakase_operating_system           # methods, validation, glossary and drivers from docs/ and backend/
SITE_URL=https://pranay-interakt.github.io SITE_BASE=/HakaseBio/ python3 build.py --og   # writes ../docs, with one share image per page
```

`SITE_URL` and `SITE_BASE` set the address used in canonical links, the sitemap and share images. Leave them out to build for hakase.bio at the root.

- **Copy** lives in `build/content_core.py` (home, product, science, modalities) and `build/content_more.py` (investors, contact, security, glossary).
- **Layout, header, footer and SEO tags** live in `build/lib.py`.
- **Study plans** on the home and modality pages are real engine output. Re-run `derive_sets.py` whenever a rule set changes, so the site never shows a plan the engine no longer derives.
- **Methods and validation pages** are generated from `docs/18a_method_reference.md` and `docs/validation/`.

## SEO included

Each page has a unique title and description, a canonical URL, Open Graph and X card tags with its own 1200×630 share image, and breadcrumbs. Structured data is included where it applies: Organization, WebSite, SoftwareApplication, BreadcrumbList, FAQPage, Person, DefinedTermSet and TechArticle. The site also ships `sitemap.xml`, `robots.txt` (search and AI crawlers allowed) and `llms.txt`.

Lighthouse scores for the home and investors pages: 98–99 performance, 100 accessibility, 100 best practices and 100 SEO. Every page passes html-validate.

## Before going live

- **Submit the sitemap.** Add `https://pranay-interakt.github.io/HakaseBio/sitemap.xml` (or the hakase.bio one once the domain is attached) in Google Search Console and Bing Webmaster Tools.
- **Forms.** The demo form (`/contact/`) and the investor form (`/investors/#request`) prepare an email to info@hakase.ai in the visitor's own mail app, so nothing is stored. To collect submissions directly, point them at Formspree, Netlify Forms or your own endpoint.
- **Legal pages.** Privacy and terms link to hakase.ai/privacy/ and hakase.ai/terms/. Check that those pages exist and cover this site.
- **Hero image.** `build/hero_image.py` makes `src/assets/img/hero-protein*.webp` from `build/assets/hero-protein-source.webp`; rerun it after changing either.
- **Branding.** The header and footer use the Hakase logo (`src/assets/img/hakase-ai-logo*.png/webp`). BioSim is named as the product on the homepage. The favicon is the Hakase “h” with its cap.

## Design

The design system is called "On the record". It uses cool clinical paper and deep ink, with the Hakase cyan as the single accent. Typefaces are Newsreader (headings), Schibsted Grotesk (text) and DM Mono (labels). The Figma file has the design system and the page designs: https://www.figma.com/design/2ftHx2Fo9icJy4XfJtYPAj
