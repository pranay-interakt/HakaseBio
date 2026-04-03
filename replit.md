# HakaseAI — BioDigital Twin Platform

## Four-Layer Simulation Pipeline
- **Layer 1 (Violet)**: In Vitro — SMILES input, in vitro assay simulation (IC50, Caco-2, CYP panel, hERG, selectivity), directional ADMET, 3D viewer; **Therapeutic Area** dropdown (Oncology, CNS, Cardiovascular, Metabolic, Rare Disease, Infectious Disease, Immunology) actively modulates potency expectations, toxicity profile weighting, off-target panel composition, cell line selection, and ADMET scoring
- **Layer 2 (Amber)**: Animal Cohort — in-silico PBPK, 7 species/strain sets, NOAEL/MTD, FIH dose projection, Human Translation Panel
- **Layer 3 (Blue)**: Patient Cohort — virtual patients, PK/PD, FAERS, responder analysis
- **Layer 4 (Emerald)**: Trial Digital Twin — Monte Carlo, adaptive design, regulatory outputs, PROCOVA (Prognostic Covariate Adjustment) module

## Key Files
- `artifacts/hakase-ai/src/pages/HakaseAI.tsx` — main 5900+ line dashboard (all 4 layers)
- `artifacts/hakase-ai/src/lib/animalSim.ts` — Layer 2 engine (allometric scaling, PBPK, NOAEL/MTD, FIH)
- `artifacts/hakase-ai/src/lib/admet.ts` — ADMET simulation (directional, secondary to in vitro)
- `artifacts/hakase-ai/src/lib/inVitroSim.ts` — In Vitro assay simulation engine (IC50, permeability, clearance, hERG, selectivity)
- `artifacts/hakase-ai/src/lib/bioactivationEngine.ts` — Mechanistic toxicity (10 AOP pathways) & metabolic bioactivation assessment
- `artifacts/hakase-ai/src/lib/cohortSim.ts` — Layer 3 patient cohort
- `artifacts/hakase-ai/src/lib/trialSim.ts` — Layer 4 trial (realistic cost model, PROCOVA engine)
- `artifacts/hakase-ai/src/lib/chemblActivity.ts` — ChEMBL multi-target bioactivity fetcher (compound polypharmacology)
- `artifacts/api-server/src/routes/bio-analysis/` — Claude streaming AI analysis
- `artifacts/api-server/src/routes/bio-chat/` — Claude chat
- `artifacts/api-server/src/routes/chembl.ts` — ChEMBL proxy (compound lookup + activities)

## Animal Cohort (Layer 2) Species Library
7 validated parameter sets: Mouse CD-1, Mouse C57BL/6, Rat Sprague Dawley, Rat Wistar, Dog Beagle, Cynomolgus Monkey. Human reference is a **background translation target only** — not selectable in the species picker; appears as the Human Translation Panel in results.

## Critical Rules
- Tailwind: NEVER dynamic class interpolation — use explicit lookup maps or ternary chains
- `estimatedCost` in trialSim.ts stored in millions — do NOT divide by 1e6 at display
- Routing: wouter — routes: `/`, `/login`, `/story`, `/platform`, `/regulatory`, `/apis`, `/privacy`, `/advanced-v2`, `/haiopsdna`, `/dashboard`
- Layer 2 (Animal) auto-populates Layer 3 starting dose with the FIH dose after simulation

## HAIOps Framework (Healthcare AI Operations)
- `artifacts/hakase-ai/src/lib/safetyFlags.ts` — Safety Flag Cascade engine (6 flags: cardiac, hepatotoxicity, DDI, narrow-margin, high-grade-ae, subgroup-disparity)
- `artifacts/hakase-ai/src/pages/HAIOps.tsx` — HAIOps page at `/haiopsdna` (5 pillars, safety cascade, model governance, lifecycle, compliance)
- Safety flags propagate through all downstream layers; computed from simulation results at L1/L2/L3
- Override logging: advancing past NO-GO logs the override and annotates all downstream outputs
- Provenance metadata: engine version, timestamp, database query status displayed in collapsible footers per layer
- "REVIEW REQUIRED" badge on GO/NO-GO card when hERG < 10 µM or structural alert confidence > 70%

---

# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.

---

## HakaseAI — BioDigital Twin Platform

React + Vite SPA at `artifacts/hakase-ai/`. Routes: `/` (Landing), `/login`, `/dashboard`.

### Simulation Architecture (fully browser-side, no backend needed)

Three layered engines in `src/lib/`:
- `admet.ts` — `runAdmetSimulation(molProps, smiles, molName, uniprotId) → SimResults`. Rule-based ADMET scores, organ risk, binding affinity heatmap, toxicity alerts, QED, Go/No-Go.
- `cohortSim.ts` — `runCohortSimulation(simResults, cohortSize, dose, route, freq, ageRange, severity, pdParams?, faersResult?) → CohortResults`. Two-compartment PBPK (via pbpk.ts), NHANES population variability (via nhanes.ts), ChEMBL Emax PD (via pdModel.ts), FAERS AE calibration (via faersApi.ts).
- `trialSim.ts` — `runTrialSimulation(simResults, cohortResults, phase, endpoint, ...) → TrialResults`. Statistical power, Weibull survival, interim analyses, site rankings, cost.

### VPSE: Layer 2 Real-Data Engines (all browser-side)

- `lib/pbpk.ts` — Two-compartment PBPK ODE solver (RK4, 1-min steps). Central + peripheral compartments, allometric scaling (BW^0.75), albumin binding correction, renal clearance adjustment. PK-Sim OSP physiological reference values.
- `lib/nhanes.ts` — NHANES 2017–2020 population distributions. Samples virtual patients with realistic weight, age, eGFR, ALT, albumin distributions. `summariseCohort()` returns mean/SD + renal impairment fraction used to calibrate PK variability and subgroups.
- `lib/pdModel.ts` — `fetchPDParameters(similarDrugs, mw, seed)` queries ChEMBL bioactivity API (IC50/Ki) for reference drugs. Geometric mean potency → Emax/Hill model EC50. `emaxEffect(c, pdParams)` computes E(C) = Emax × C^n / (EC50^n + C^n).
- `lib/faersApi.ts` — `fetchFAERSSignals(drugName)` queries openFDA FAERS API for top MedDRA adverse event terms + counts for a reference drug name. Maps to display-ready labels + colours. Falls back gracefully if API unavailable.
- `lib/openFDA.ts` — Three live openFDA integrations used by `RegulatoryInsightCard`: (1) `fetchFAERSReactions(drugName)` — FAERS adverse event counts + normalized reporting rate for L2 Regulatory card; (2) `fetchDrugsAtFDA(drugs[])` — NDA/BLA application number, Priority vs Standard review, and approval year for L3 Regulatory card; (3) `fetchDrugLabels(drugs[])` — boxed warning detection from drug label SPL for L1 Regulatory card. All use `https://api.fda.gov` (no API key, browser CORS supported, graceful fallback).

### Key Types

- `SimResults` — `admet`, `organs`, `toxAlerts`, `binding`, `qed`, `goNogo`, `confidence`, `recommendation`, `similarDrugs`, `smiles`, `molName`, `uniprotId`, `lipinski`
- `CohortResults` — `cohortSize`, `responderRate`, `partialRate`, `nonResponderRate`, `pkCurve`, `cmax`, `cmaxSD`, `auc`, `halfLifeHr`, `doseGroups`, `adverseEvents`, `subgroupBreakdown`, `grade3AERate`, `nhanesStats`, `dataSources: { pbpk, pd, ae, population }`
- `TrialResults` — `power`, `pValue`, `sampleSize`, `successProbability`, `survivalCurve`, `powerCurve`, `interimAnalyses`, `estimatedDuration`, `estimatedCost`, `siteRecommendations`, `goNogo`

### RDKit.js (MinimalLib) key descriptor names
`amw` (MW), `CrippenClogP` (logP), `lipinskiHBD`, `lipinskiHBA`, `tpsa`, `NumRotatableBonds`

### Claude AI Analysis (claude-sonnet-4-6)

Integrated via Replit Anthropic integration (`@workspace/integrations-anthropic-ai`).

- **API route**: `POST /api/bio-analysis` — in `artifacts/api-server/src/routes/bio-analysis/index.ts`
- **Accepts**: `{ molName, smiles, indication, layer1: SimResults, layer2?: CohortResults, layer3?: TrialResults }`
- **Returns**: SSE stream of `{ chunk }` events, followed by `{ done: true, full: "<JSON>" }` event
- **Claude prompt**: Detailed pharma system prompt requesting 10-key JSON report: `molecularOverview`, `safetyNarrative`, `pkAnalysis`, `targetEngagement`, `cohortInsights`, `trialDesignRationale`, `competitiveContext`, `riskMitigations[]`, `goNogoRationale`, `nextSteps[]`
- **UI**: "Claude AI Analysis" panel in the Layer 1 results output column (HakaseAI.tsx). Appears after any simulation completes. Streams real-time, parses JSON on completion, renders section-by-section.
- **State**: `aiReport`, `aiLoading`, `aiError`, `aiStream` + `runAiAnalysis` callback in HakaseAI.tsx

### Design tokens
Dark: `bg-[#07080c]` · Violet = Layer 1 · Blue = Layer 2 · Emerald = Layer 3 · Inter font · Logo: `@assets/image_1773504202272.png`
