# CLAUDE.md — Engineering Contract for Building the Hakase Operating System

This file is read first by any AI or engineer writing code in this repository.
It encodes the **non-negotiable rules**. If a requested change conflicts with these rules,
stop and raise it rather than violating them. These rules exist to protect scientific integrity,
which is the entire value of this product.

---

## 0. Prime directive

> **Build real science on real data. Never fabricate, guess, or hard-code a scientific value.**

A single invented number destroys the product's credibility with the only buyers who matter
(CSOs, DMPK scientists, toxicologists, regulators). This is not a demo where "close enough" is
acceptable. Every number must be defensible to a skeptical PhD.

## 1. The provenance rule (enforced in the type system)

- There are **no bare floats** in any scientific interface, return value, database column that holds
  a scientific quantity, or API payload. Every scientific value is a `Quantity` object (see
  `docs/07_data_model_and_provenance.md`) carrying: value, unit, provenance kind, source citation,
  method, timestamp, and (where applicable) uncertainty and applicability-domain status.
- Provenance kind is one of: `MEASURED`, `LITERATURE`, `COMPUTED`, `PREDICTED`, `GUIDELINE`,
  `USER_SUPPLIED`, `UNAVAILABLE`.
- `COMPUTED` values MUST reference the exact method/equation id (which maps to a citation).
- `PREDICTED` values MUST name the model, its version, and the result of the applicability-domain
  check. A prediction outside the applicability domain is flagged and surfaced to the user.
- If a value cannot be obtained, return `Quantity.unavailable(reason=...)`. **Never** substitute a
  default, an average, or a plausible-looking number to fill a gap.

## 2. No mocks, no stubs, no placeholders in shipped code

- Do not write functions that return hard-coded example values "for now."
- Do not fake external API responses in application code. (Recorded fixtures are allowed **only**
  inside the test suite, clearly under `tests/fixtures/`, captured from real API responses and
  checksummed — see rule 7.)
- If an external data source is unreachable, the code path returns `UNAVAILABLE` with the reason
  (network, not-found, rate-limited), and the UI shows that honestly. It does not degrade to a guess.
- A feature that cannot yet be done correctly is left unbuilt and tracked in the backlog, not faked.

## 3. Every equation is cited

- Each computational method lives in a module with a docstring containing: the equation, the
  primary literature citation, the units of every input and output, and the assumptions/limits.
- The canonical references are listed in `docs/04_scientific_foundations.md`. Use them. If you need
  a method not covered there, add it to that document **with a real citation** before implementing.
- Physiological constants (hepatic blood flow, microsomal protein per gram liver, body-surface-area
  Km factors, etc.) are **not** magic numbers in code. They live in a versioned, cited
  `reference_parameters` registry (data, with provenance), and are injected — see `07` and `04`.

## 4. Regulatory logic encodes real guidelines

- ICH (M3(R2), S1B(R1), S2(R1), S5(R3), S6(R1), S7A, S7B, S8, S9, S10, S11, M10) and FDA guidance
  (MRSD 2005, etc.) are encoded as structured, cited rule tables — not paraphrased prose and not
  invented thresholds. See `docs/04` and `docs/10`.
- When a rule has conditions ("if clinical duration > 6 months, then 9-month non-rodent study"),
  encode the conditions explicitly and cite the guideline section.

## 5. Architecture discipline

- **Backend**: Python 3.11+. The scientific core is pure, deterministic, and unit-tested in
  isolation from the web layer. Web layer is FastAPI. Persistence is PostgreSQL via SQLAlchemy 2.x
  with Alembic migrations. Long-running jobs run on a worker (see `docs/06`).
- **Frontend**: TypeScript + React (Vite). No business logic or scientific computation in the
  frontend — it renders what the backend computes, including provenance badges on every value.
- **Drivers** implement the abstract `StudyDriver` interface (see `docs/08`). The kernel never
  contains study-type-specific logic; drivers never bypass the kernel's provenance ledger.
- Determinism: given the same inputs and the same `reference_parameters` version and the same
  method versions, a computation MUST produce the same output. Record all three in every result.

## 6. Reproducibility & audit

- Every computed result records: inputs (by id/hash), method id + version, `reference_parameters`
  version, library versions (RDKit, SciPy), timestamp, and the actor (human or agent).
- This record is append-only (the provenance ledger). It is the ALCOA+ "original" (see `docs/10`).
- No in-place mutation of a result. Corrections create a new version linked to the prior one with a
  reason-for-change.

## 7. Testing is part of the definition of done

- Unit tests with **known reference values** are mandatory for every scientific method. Example:
  RDKit descriptor tests assert aspirin MW = 180.159, TPSA = 63.6; IVIVE tests assert published
  clearance predictions for a reference compound set (e.g. from Obach 1999) within stated tolerance.
- External API clients are tested against **recorded real responses** (fixtures captured from the
  live API, stored under `tests/fixtures/`, with the capture date and source URL recorded). A
  nightly/weekly contract test hits the live API to detect schema drift.
- Golden-file tests for generated reports and SEND datasets.
- CI runs the full suite on every change. No merge on red.
- Target: scientific core ≥ 90% line coverage; every public method has at least one
  known-value test.

## 8. Two planes (discovery vs GxP)

- The system has a **non-GxP discovery plane** (fast, where generative/agentic AI is free) and a
  **GxP plane** (regulated, deterministic, versioned, attributable). See `docs/10`.
- Code that can affect a GxP record MUST go through the attestation + audit-trail machinery.
  Generative model output MUST NOT write directly into a GxP record; it drafts, a human attests.

## 9. The four human attestation boundaries are hard

- GLP Study Director, QA, IACUC/Attending Veterinarian, and (EU GMP) Qualified Person are the only
  roles with legal signature authority. The system assembles everything they need and records their
  signature; it **never** auto-signs on their behalf. Encode these as first-class primitives.

## 10. Style & hygiene

- Type-annotate all Python (`mypy --strict` on the scientific core). Strict TypeScript.
- Format with `ruff`/`black` (Python) and `prettier` (TS). Lint clean.
- Small, pure functions for science; integration at the edges.
- Commit messages explain *why*. Attribution lines per the session reminder.
- Secrets (API keys where a source needs one) via environment/secret manager, never committed.

## Definition of done for any scientific feature

1. Method implemented as a pure function returning `Quantity`/typed result with provenance.
2. Primary citation in the docstring and in `docs/04`.
3. Known-value unit test passing.
4. Applicability limits documented and enforced (returns `UNAVAILABLE` / flags out-of-domain).
5. Wired through the kernel's provenance ledger.
6. Rendered in the UI with its provenance badge.
7. Reviewed against this contract.
