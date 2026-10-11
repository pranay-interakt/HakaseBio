# 11 — Build Plan & SDLC

> Status column is updated at the end of every step. "Done" means the exit criteria below were
> met, tests were green, and the step was committed.

## 11.1 Process

Each build step follows the same cycle:

1. **Research.** Any scientific value, protocol parameter, threshold or API contract the step needs
   is traced to a primary source first (guideline PDF, DOI-resolved paper, official API docs). What
   cannot be sourced is either left out or represented as `UNAVAILABLE` / `requires_verification`.
   Findings are recorded in `docs/09` §9.4 or the step's own doc.
2. **Design.** The interface is written into the relevant doc (`07`, `08`, `10`) before code.
3. **Build.** Small, pure functions in the scientific core; integration at the edges.
4. **Verify.** Known-value tests (values from the source, not from the code), negative tests for
   every integrity rule the step touches, and the full suite green.
5. **Commit.** One commit per step (or per coherent sub-step), message explains *why*.
6. **Report.** What was built, test count, and anything flagged.

No step starts on a red suite.

## 11.2 Steps, exit criteria, status

| # | Step | Exit criteria | Status |
|---|---|---|---|
| 0 | Baseline | venv installs `.[api,db,dev]`; core suite green | Done (61 tests) |
| 1 | Docs 07–13 | each doc describes implemented behaviour; planned items labelled | In progress |
| 2 | Citation & reference-parameter verification | every citation checked against Crossref/official PDF; every reference parameter either verified (with table/page) or flagged `requires_verification` | Citations done; parameters in progress |
| 3 | Driver interface + registry | `StudyDriver` ABC, strict CSV ingest with SHA-256, simulate with `SIMULATED` provenance, registry with requirement matching, conformance kit | Planned |
| 4 | Execution targets | external lab (dispatch bundle + awaited return), in-house, simulation | Planned |
| 5 | Kernel facade + repository | full study flow through lifecycle and ledger; GLP approval gate; simulated never approvable | Planned |
| 6 | Drivers: metabolic stability, hERG, repeat-dose tox | each passes the conformance kit and known-value tests; repeat-dose never decides NOAEL | Planned |
| 7 | Data sources: ChEMBL, PubChem | real API clients, cache, honest UNAVAILABLE; fixtures captured from live API, dated; live tests marked | Planned |
| 8 | IND assembler | Module 4 skeleton from completed studies; readiness report; refuses simulated data | Planned |
| 9 | FastAPI | REST for the full flow; OpenAPI; signatures require re-authentication | Planned |
| 10 | Frontend | React/TS flow; provenance badge on every number; no science in the browser | Planned |
| 11 | Demo + run instructions | end-to-end script; demo data real or labelled SIMULATED | Planned |

## 11.3 Definition of done (every scientific feature)

From `CLAUDE.md`: pure function returning `Quantity`/typed result with provenance; primary citation
in docstring and in `docs/04`; known-value unit test; applicability limits documented and enforced;
wired through the ledger; rendered with its provenance badge; reviewed against the contract.

## 11.4 Test strategy

| layer | what is tested | how |
|---|---|---|
| scientific core | every public method | known values from the cited source (e.g. FDA Table 1 HED factors, analytical IVIVE limits, Crossref-verified citation metadata) |
| integrity rules | every provenance invariant | negative tests: the forbidden object cannot be constructed |
| drivers | every driver | the shared conformance kit (step 3) plus driver-specific known-value tests |
| kernel | lifecycle, ledger, attestation | state-machine and tamper tests; GLP and simulation gates |
| data sources | clients | recorded real responses under `tests/fixtures/` (capture date and URL recorded); `@pytest.mark.live` contract tests run on demand |
| API | endpoints | FastAPI `TestClient` against a temporary database |
| frontend | rendering of provenance | component tests (step 10) |

Commands: `pytest` (offline suite), `pytest -m live` (network contract tests).

## 11.5 Risks carried in the plan

- **Unverifiable constants.** Some physiological scalars have no accessible primary source; they
  stay flagged and visibly propagate a QC flag rather than being silently trusted.
- **QC acceptance thresholds.** Several default thresholds in the core (§9.5) are not yet traced
  to a source; drivers pass thresholds explicitly from the protocol so the basis is recorded.
- **Regulatory interpretation.** The study-set engine encodes guideline text; it is not a substitute
  for regulatory-affairs review, and the readiness report says so.
- **Single workstation persistence.** SQLite and `create_all()` are adequate for one user; Alembic
  migrations and PostgreSQL are required before a shared or validated deployment.
