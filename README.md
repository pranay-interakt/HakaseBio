# Hakase Operating System (HOS)

**An AI-native operating system for preclinical drug development.**

A drug candidate goes in. A scientifically defensible, IND-enabling data package comes out.
The wet-lab biology is executed by real labs and CROs; the *operating system* designs every
study, orchestrates its execution, ingests and analyzes the data with published pharmacology
methods, and assembles the regulatory package — with full provenance on every single number.

---

## What this repository is (right now)

This is the **specification and build contract**, not yet the code. It is the complete, documented
vision — product, science, architecture, data model, driver design, build plan, compliance posture,
and go-to-market — written to a standard precise enough to hand directly to an engineering team
(human or Claude Code) and have them build the real thing without inventing anything.

Read the documents in `docs/` in order. Read `CLAUDE.md` **first** if you are an AI or engineer
about to write code: it contains the non-negotiable engineering contract (the rules that protect
scientific integrity).

## The one rule that governs everything

> **No number exists in this system without provenance.**
> Every quantity is either *measured*, *from the literature*, *computed by a cited method*,
> *predicted by a named model* (and labeled as such), or *derived from a regulatory guideline*.
> If a value is not available, the system returns `Unavailable` with a reason. It is structurally
> impossible for the system to silently invent, guess, or hard-code a scientific value.

Everything else in these documents serves that rule.

## Document map

| # | Document | What it covers |
|---|----------|----------------|
| 00 | `docs/00_INDEX.md` | How to read this set; status; glossary pointer |
| 01 | `docs/01_vision_and_thesis.md` | The problem, the thesis, why now, what we are building |
| 02 | `docs/02_market_and_competition.md` | Market, buyers, competitors, the open gap |
| 03 | `docs/03_product_architecture_os.md` | The OS concept: kernel + study drivers; module map |
| 04 | `docs/04_scientific_foundations.md` | Every equation and method, with primary citations |
| 05 | `docs/05_data_sources_and_licensing.md` | Real databases, API contracts, licensing posture |
| 06 | `docs/06_system_architecture.md` | Backend, frontend, services, deployment, repo layout |
| 07 | `docs/07_data_model_and_provenance.md` | The provenance-typed data model (the integrity core) |
| 08 | `docs/08_driver_spec_and_catalog.md` | The driver interface + the first drivers in full detail |
| 09 | `docs/09_scientific_integrity_and_validation.md` | Integrity rules, validation gates, test strategy |
| 10 | `docs/10_compliance_gxp_regulatory.md` | GxP, 21 CFR Part 11, ALCOA+, audit trail, two-plane design |
| 11 | `docs/11_build_plan_sdlc.md` | The SDLC: phases, milestones, deliverables, exit criteria |
| 12 | `docs/12_go_to_market_and_business.md` | Wedge, pricing, ladder, funding posture |
| 13 | `docs/13_glossary.md` | Domain and system terms |

## Environment facts (verified 2026-10-11)

- Build target: **Python 3.11+ backend** (RDKit, SciPy stack) + **TypeScript/React frontend**.
- RDKit installs cleanly and returns correct reference descriptor values.
- Public science APIs require normal internet (blocked in the sandbox used to author this spec);
  all external-data code must run on a machine with outbound HTTPS to the listed hosts.
- No code in this repo yet. The build plan (doc 11) defines the order of implementation.

