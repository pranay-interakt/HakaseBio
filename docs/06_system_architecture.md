# 06 — System Architecture

## 6.1 Technology choices (and why)

- **Backend language: Python 3.11+.** Non-negotiable because the scientific stack lives here: RDKit
  (cheminformatics), SciPy/NumPy (fitting, regression), pandas (tabular), `pint` (units). The
  scientific core must be where the trustworthy libraries are.
- **Web framework: FastAPI** (async, Pydantic-native, OpenAPI out of the box).
- **Validation/typing: Pydantic v2** for all boundary objects; `mypy --strict` on the scientific core.
- **Persistence: PostgreSQL** via **SQLAlchemy 2.x**, migrations via **Alembic**. JSONB for flexible
  provenance payloads; proper columns for queryable fields. Object storage (S3-compatible) for large
  raw files (instrument data, PDFs, images) — DB holds references + checksums.
- **Jobs: a task queue** (Celery or RQ/Arq) for long-running work (large parses, IVIVE batches, PDF
  extraction, report/SEND generation). The API never blocks on science.
- **Frontend: TypeScript + React (Vite).** Component library (Radix/shadcn-style). **No scientific
  computation in the frontend** — it renders backend results and the provenance badges.
- **Agents: M17 runtime** — agents call the *same* internal API as the UI, under the same permissions
  and audit trail. No privileged back door.

## 6.2 Layered architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend (React/TS): intake → design → plan → run → results → IND │
│   renders values + provenance badges; never computes science      │
├──────────────────────────────────────────────────────────────┤
│ API layer (FastAPI): auth, permissions, request/response (Pydantic)│
│   thin; delegates to services; emits OpenAPI                        │
├──────────────────────────────────────────────────────────────┤
│ Kernel services: lifecycle state machine · entity graph ·          │
│   provenance ledger · attestation · execution dispatcher           │
├──────────────────────────────────────────────────────────────┤
│ Drivers: StudyDriver implementations (metab stability, hERG, …)    │
│   use the scientific core; register with the kernel                 │
├──────────────────────────────────────────────────────────────┤
│ Scientific core (pure, deterministic, unit-tested):                │
│   descriptors (RDKit) · ADME/IVIVE · pharm fits · dose projection · │
│   regulatory rule engine · reference_parameters registry           │
├──────────────────────────────────────────────────────────────┤
│ Data-source clients: ChEMBL/PubChem/UniProt/OpenTargets/openFDA/…   │
│   common protocol; caching; honest UNAVAILABLE                      │
├──────────────────────────────────────────────────────────────┤
│ Persistence: PostgreSQL (SQLAlchemy/Alembic) + object store         │
└──────────────────────────────────────────────────────────────┘
```

**Dependency rule:** the scientific core depends on nothing above it and never imports web/DB code.
It takes `Quantity` inputs and returns `Quantity`/typed results. This is what makes it testable in
isolation and reusable by every driver.

## 6.3 Repository layout (monorepo)

```
hakase_operating_system/
├── README.md
├── CLAUDE.md
├── docs/                      # this specification set
├── backend/
│   ├── pyproject.toml         # deps, ruff/black/mypy config
│   ├── hos/
│   │   ├── core/              # scientific core (PURE)
│   │   │   ├── quantity.py        # Quantity, Provenance, Unit (the integrity type)
│   │   │   ├── reference_params/  # cited physiological constants (data + loader)
│   │   │   ├── descriptors.py     # RDKit wrappers (descr.*)
│   │   │   ├── adme.py            # clint, IVIVE, well-stirred (adme.*)
│   │   │   ├── pharmacology.py    # Hill/4PL fits (pharm.*)
│   │   │   ├── dose.py            # HED/MRSD/MABEL (dose.*)
│   │   │   └── regulatory/        # ICH/FDA rule engine (reg.*)
│   │   ├── kernel/
│   │   │   ├── lifecycle.py       # study state machine
│   │   │   ├── entities.py        # entity graph models
│   │   │   ├── provenance.py      # append-only ledger
│   │   │   ├── attestation.py     # the four signatures
│   │   │   └── execution/         # ExecutionTarget: CRO / Simulated / (robot,human later)
│   │   ├── drivers/
│   │   │   ├── base.py            # StudyDriver interface
│   │   │   ├── metabolic_stability/
│   │   │   ├── herg/
│   │   │   └── registry.py        # driver discovery/registration
│   │   ├── data_sources/          # chembl/ pubchem/ uniprot/ opentargets/ openfda/ fda_reviews/
│   │   ├── api/                   # FastAPI routers
│   │   ├── db/                    # SQLAlchemy models, Alembic migrations
│   │   └── jobs/                  # workers
│   └── tests/
│       ├── core/                  # known-value scientific tests
│       ├── drivers/
│       ├── data_sources/          # fixture + live contract tests
│       └── fixtures/              # dated, real captured responses
├── frontend/
│   ├── package.json
│   └── src/ (intake, design, plan, run, results, ind, components/ProvenanceBadge, …)
├── infra/                     # docker-compose (postgres, minio, worker), CI config
└── scripts/                   # data ingestion (FDA review pipeline, ontology load)
```

## 6.4 Determinism, versioning, reproducibility

- Every result row records: method id + version, `reference_parameters` version, RDKit/SciPy versions,
  input ids/hashes, actor, timestamp (see `docs/07`).
- Scientific functions are pure and deterministic. Same inputs + versions ⇒ same output, always.
- Library versions pinned in `pyproject.toml`; a result computed under old versions is never silently
  recomputed — recomputation creates a new, linked version.

## 6.5 Security, deployment, environments

- Secrets via environment/secret manager; never committed.
- Local dev via `docker-compose` (Postgres, object store, worker). Cloud deploy later; the GxP plane
  needs a validated-deployment story (see `docs/10`).
- RBAC in the API; agents inherit a principal and are fully audited.
- The authoring sandbox blocks external science hosts; **run data-dependent features on a network with
  outbound HTTPS to the hosts in `docs/05`.** Clients fail honestly when blocked.

## 6.6 Observability

- Structured logging, request tracing, job status surfaced in the UI (M5/M11 "where is my sample").
- A dedicated **provenance/audit view** (M15) that reconstructs any number's full derivation.
