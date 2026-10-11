# Hakase Operating System (HOS)

**An operating system for preclinical drug development.** A candidate molecule goes in. The
kernel derives the nonclinical study set the regulations require. A driver for each study type
designs the study, dispatches it to a laboratory, ingests the returned data, analyses it with
cited methods and writes the report. The kernel assembles CTD Module 4 for the IND. Every
number carries its provenance, and only humans sign.

> **The one rule:** no number exists without provenance. Every value is *measured*, from the
> *literature*, *computed* by a cited method, *predicted* by a named model with an
> applicability-domain check, from a *guideline*, *user-supplied* by a named person,
> *simulated* (never evidence), or *unavailable* with a reason. Nothing is defaulted or guessed.

Read [`CLAUDE.md`](CLAUDE.md) before writing code. The plan of record and status are in
[`docs/11_build_plan_sdlc.md`](docs/11_build_plan_sdlc.md).

## What is built

| OS concept | Component | Where |
|---|---|---|
| math library | descriptors (RDKit), IVIVE / well-stirred CLh, 4PL Hill fit, hERG margin, FDA 2005 HED/MRSD, ICH study-set rules, cited reference-parameter registry | `backend/hos/core` |
| kernel | study lifecycle, hash-chained ledger, human-only signatures, append-only versioned artefacts, kernel facade | `backend/hos/kernel` |
| driver model | `StudyDriver` ABI, registry with requirement matching and plug-in discovery, conformance kit, strict CSV ingest | `backend/hos/drivers` |
| drivers | microsomal metabolic stability · hERG patch clamp · repeat-dose toxicity (OECD TG 407/408/409, Dunnett) · bioanalytical validation (ICH M10) · toxicokinetics (ICH S3A) · in vivo PK (NCA) · plasma protein binding · Ames (OECD TG 471) · dose range-finding · in vitro potency · CNS, respiratory and QT/cardiovascular safety pharmacology (ICH S7A/S7B) | `backend/hos/drivers/*` |
| devices | execution targets: external lab (CRO dispatch bundle), in-house lab, simulation | `backend/hos/kernel/execution` |
| external data | ChEMBL and PubChem clients, cached, honest failure | `backend/hos/data_sources` |
| output | IND readiness report, CTD Module 4 (ICH M4S(R2)) assembler, verification bundles | `backend/hos/ind`, `backend/hos/verify` |
| data standards | SEND export: SENDIG v3.1.1, SEND CT, Define-XML 2.1, SAS XPORT v5, FDA pre-export checks | `backend/hos/send` |
| syscalls | REST API (FastAPI, OpenAPI), re-authenticated e-signatures | `backend/hos/api` |
| userland | React + TypeScript app with provenance badges | `frontend` |

Integrity guarantees enforced in code, each covered by tests:

- **Constructor-level provenance rules.** A computed value without a cited method, a prediction
  without an applicability check, or a simulated value without its generator parameters cannot
  be constructed.
- **Simulation taint.** Values derived from simulated data stay inadmissible. A simulated file
  re-uploaded as "measured" is detected by hash and forced to SIMULATED. Simulated studies can
  never be approved or enter Module 4.
- **Determinism.** Before dispatch and before reporting, the kernel re-runs the driver and refuses
  if it no longer reproduces the recorded protocol or analysis hash.
- **Human attestation.** NOAELs and other expert judgements are signed determinations by the role
  that owns them. GLP approval needs Study Director plus QA signatures on the current report.
  Every signature re-verifies the password (21 CFR 11.200).
- **Tamper evidence.** Every state change is a hash-chained ledger entry, and rejected uploads are
  recorded too.

Every citation, guideline section and physiological constant was checked against its primary
source. The records are in [`docs/research/`](docs/research/), and anything that could not be
verified is flagged in the data (`requires_verification`) and propagates as a QC flag.

## Run it

Requirements: Python 3.11+, Node 18+.

### Backend

```bash
cd backend && python3.11 -m venv .venv && .venv/bin/pip install -e ".[api,db,dev]"
```

```bash
cd backend && .venv/bin/pytest
```

The suite runs offline against real responses recorded from ChEMBL and PubChem. To re-run the
contract against the live services:

```bash
cd backend && .venv/bin/pytest -m live
```

### End-to-end demo (no setup, temporary database)

```bash
cd backend && .venv/bin/python scripts/demo.py --out demo-out
```

It runs three studies through their drivers with **SIMULATED** execution and shows the integrity
rules firing (approval refused, readiness `simulated_only`, Module 4 excludes them). Reports and
the Module 4 zip are written to `demo-out/`.

### Verify a Module 4 export offline

Every Module 4 zip is a verification bundle. `hos-verify` re-runs every driver from the raw files,
checks every file hash, the ledger chain and every signature binding, with no database or network:

```bash
cd backend && .venv/bin/hos-verify demo-out/module4.zip
```

### API

```bash
cd backend && HOS_DATA_DIR=./data .venv/bin/uvicorn hos.api.app:app --port 8000
```

OpenAPI docs are served at <http://127.0.0.1:8000/docs>. Storage defaults to SQLite under
`HOS_DATA_DIR` (default `~/.hakase_os`); set `HOS_DATABASE_URL` for PostgreSQL. On first run,
create the administrator from the UI, or seed demo accounts (development only). The seeder
generates a random password per account, prints them once and saves them to
`backend/scripts/dev_principals.local.json`, which is gitignored:

```bash
cd backend && .venv/bin/python scripts/seed_dev.py http://127.0.0.1:8000
```

### Frontend

```bash
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>. `/api` is proxied to port 8000.

### Running a real study

1. Create a programme. Its context drives the ICH-derived study set.
2. Register the compound and, optionally, look it up in PubChem / ChEMBL.
3. Start a study from a requirement, then design it. Scientific values and acceptance criteria are
   required inputs with their stated basis.
4. Plan, then dispatch to an **external lab**. Download the dispatch bundle (protocol, sample
   manifest, data template, return instructions, SHA-256 manifest) and send it to the lab.
5. Upload the lab's CSV. It is validated strictly, and every problem is reported with its line
   number.
6. Supply external inputs (e.g. fu,p) with their provenance. Analyse, record expert
   determinations, report, sign, approve.
7. Check IND readiness and assemble Module 4.

## Repository

```
backend/hos/core        scientific core (pure; no web/DB imports)
backend/hos/kernel      lifecycle, ledger, attestation, execution targets, kernel facade
backend/hos/drivers     driver ABI, registry, conformance kit, three drivers
backend/hos/data_sources ChEMBL, PubChem, enrichment
backend/hos/ind         readiness, Module 4
backend/hos/api         FastAPI app
backend/hos/db          SQLAlchemy models, repository, content-addressed file store
backend/tests           unit, driver, kernel, API, data-source and demo tests; recorded fixtures
backend/scripts         demo, fixture capture, dev seed
frontend/               React + TypeScript (Vite)
docs/                   specification (00-13) and research records
```

## Known limits (tracked, not hidden)

- **Unverified constant.** Human liver weight (21.4 g/kg) for IVIVE has no traced primary source
  and is flagged on every value computed from it. Mouse and monkey MPPGL have no primary
  determination, so IVIVE for those species returns UNAVAILABLE.
- **No metabolic-stability defaults.** No citable consensus exists for the "standard" assay
  conditions, so the driver offers no defaults.
- **Pending re-verification.** The OECD TG 409 parameters were read from a mirrored copy and are
  marked for re-verification.
- **Single-workstation deployment.** Persistence uses SQLite with `create_all()` and API sessions
  are held in memory. Alembic migrations and a shared session store are needed before a
  multi-user deployment.
- **Not yet built.** SEND clinical-observation and pathology domains (CL, MA, MI) and the
  SENDIG-SP/DART domains, peptide and antibody drivers, and histopathology incidence statistics.
  SEND packages are checked by HOS's pre-export checks; the FDA validator is not run.
- **Licensing.** ChEMBL data are CC BY-SA 3.0; review the share-alike implications before
  commercial redistribution.
