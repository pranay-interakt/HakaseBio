# 11 — Build Plan & SDLC (plan of record)

> Updated at the end of every step. "Done" = exit criteria met, full suite green, committed.

## 11.1 Vision in one paragraph

A candidate molecule goes in. The kernel derives the required nonclinical study set from ICH
rules; a driver per study type designs the study, dispatches it to a laboratory, ingests the data
it returns, analyses it with cited methods and writes the report; the kernel assembles CTD
Module 4 for the IND. Every number carries provenance. Only humans sign.

## 11.2 Architecture: the OS mapping

| OS concept | HOS component | module |
|---|---|---|
| libc / math library | scientific core: descriptors, IVIVE, Hill fit, HED/MRSD, ICH rule engine | `hos/core` |
| kernel primitives | lifecycle state machine, hash-chained ledger, human-only signatures | `hos/kernel` |
| driver model | `StudyDriver` ABI, registry (match table, entry-point discovery), conformance kit, strict ingest | `hos/drivers/base.py`, `registry.py`, `conformance.py` |
| device drivers | metabolic stability, hERG patch clamp, repeat-dose toxicity | `hos/drivers/*/` |
| devices | execution targets: external lab (CRO), in-house lab, simulator | `hos/kernel/execution/` |
| scheduler / kernel facade | runs each study through lifecycle + ledger + attestation | `hos/kernel/kernel.py`, `hos/db/repository.py` |
| external data drivers | ChEMBL, PubChem clients | `hos/data_sources/` |
| output subsystem | IND Module 4 assembler + readiness report | `hos/ind/` |
| syscalls | REST API; signatures need re-authentication (21 CFR 11.200) | `hos/api/` |
| userland | React/TS app; provenance badge on every number | `frontend/` |

Dependency rule: `core` imports nothing above it; `drivers` import `core` + kernel primitives;
the kernel facade imports drivers through the registry only; API imports the facade only.

## 11.3 Steps, exit criteria, status

| # | Deliverable | Exit criteria | Status |
|---|---|---|---|
| 0 | Baseline | venv, git, core suite green | Done (61 tests) |
| 2 | Primary-source verification | citations vs Crossref/official PDFs; guideline sections vs ICH text; every constant verified or flagged | Done: 25 section refs, 6 constants, 1 invented model domain, FDA Step 5 logic corrected |
| 3 | Driver framework + reference driver | ABI, registry, conformance kit, strict ingest; **metabolic stability driver passes conformance** + known-value tests | Done (15/15 conformance checks) |
| 4 | Execution targets | external lab bundle + awaited return; in-house; simulation (SIMULATED only) | Done |
| 5 | Kernel facade + repository | programme → study set → compound → study → design/plan/dispatch → ingest → analyse → report → sign/approve, all through lifecycle + ledger; GLP needs SD + QA; simulated never approvable | Done |
| 6 | hERG + repeat-dose tox drivers | conformance + known-value tests; Dunnett per endpoint; NOAEL only by signed human determination | Done |
| 7 | ChEMBL / PubChem clients | documented APIs, cache, honest UNAVAILABLE; dated real fixtures; `@pytest.mark.live` | Planned |
| 8 | IND assembler | Module 4 skeleton from completed studies; readiness (done/in progress/missing/conditional); refuses simulated | Planned |
| 9 | FastAPI | full flow, OpenAPI, re-auth signatures | Planned |
| 10 | Frontend | full flow; provenance badges; no science in browser | Planned |
| 11 | Demo + README run instructions | end-to-end script; demo data real or labelled SIMULATED | Planned |
| 1 | Docs 07–13 | each describes implemented behaviour; updated as steps land | 07, 11, 13 done |

## 11.4 Process per step

Research (primary sources for any value the step needs) → design (interface in code docstrings
and the relevant doc) → build → verify (known-value and negative tests; full suite green) →
commit (why, not what) → report (built, test count, flagged).

## 11.5 Definition of done (scientific features)

From `CLAUDE.md`: pure function returning `Quantity` with provenance; primary citation in
docstring and `docs/04`; known-value test; applicability limits enforced; wired through the
ledger; rendered with its provenance badge.

## 11.6 Test strategy

| layer | how |
|---|---|
| scientific core | known values from the cited source |
| integrity rules | negative tests: forbidden objects cannot be constructed |
| drivers | shared conformance kit + driver known-value tests |
| kernel | lifecycle, ledger tamper, GLP/simulation gates |
| data sources | recorded real responses in `tests/fixtures/` (dated, URL); live contract tests on demand |
| API | FastAPI TestClient on a temp database |

## 11.7 Risks carried

- Constants without an accessible primary source stay flagged and propagate a QC flag.
- QC acceptance thresholds are protocol parameters with a recorded basis, not code defaults.
- The study-set engine encodes guideline text; it does not replace regulatory-affairs review.
- SQLite + `create_all()` is single-workstation only; Alembic + PostgreSQL before shared use.
