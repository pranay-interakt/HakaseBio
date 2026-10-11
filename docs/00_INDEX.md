# 00 — Index & Reading Guide

## Status

**Phase: Specification complete / pre-implementation.**
No application code has been written yet. This is deliberate: per the project owner's directive,
the system is specified end-to-end — with real science and real data sources — *before* any code,
so that no placeholder heuristics or hard-coded values leak into the build.

## How to read this set

1. **Everyone starts here**, then `01_vision_and_thesis.md`.
2. **Builders** then read `CLAUDE.md` (root) — the engineering contract — followed by
   `06_system_architecture.md`, `07_data_model_and_provenance.md`, `08_driver_spec_and_catalog.md`,
   and `11_build_plan_sdlc.md`.
3. **Scientists / reviewers** read `04_scientific_foundations.md`,
   `09_scientific_integrity_and_validation.md`, and the driver catalog in `08`.
4. **Investors / commercial** read `01`, `02`, and `12`.

## Conventions used throughout

- **MUST / SHOULD / MAY** are used in the RFC-2119 sense.
- Every scientific equation is given with a **primary literature citation**. Where a method has a
  canonical reference (e.g. Obach 1999 for IVIVE), that reference is named inline.
- Code identifiers are written `like_this`. File paths are `relative/to/repo/root`.
- A **driver** is a self-contained package implementing one study type end to end.
- A **Quantity** is the provenance-typed value object defined in `07`. There are no bare floats
  in scientific interfaces.

## What "real" means here (non-negotiable)

- Molecular descriptors come from **RDKit** (open source, peer-reviewed algorithms).
- External facts come from **real databases** (ChEMBL, PubChem, UniProt, Open Targets, openFDA,
  Drugs@FDA/EMA, Therapeutics Data Commons) via their documented APIs — see `05`.
- Regulatory logic encodes the **actual ICH / FDA guideline tables**, each cited — see `04` and `10`.
- Pharmacology computations use **published equations**, each cited — see `04`.
- Where a value must be predicted (e.g. by a QSAR/ML model), the model is **named, versioned, and
  its applicability domain checked**, and the output is **labeled `predicted`** — see `09`.

See `13_glossary.md` for terminology.
