# Hakase BioTwin Backend — Modality-Oriented Restructure

**Status:** Proposal / not yet executed
**Date:** 2026-07-21
**Scope:** `hakase-bio-backend` only (frontend restructure is a separate document)
**Baseline:** branch `dev` @ `16cf3a0`, 412 tracked files

---

## Table of contents

1. [Purpose](#1-purpose)
2. [Executive summary](#2-executive-summary)
3. [Current-state assessment](#3-current-state-assessment)
4. [Design principles](#4-design-principles)
5. [The composition-root pattern](#5-the-composition-root-pattern)
6. [Target repository tree](#6-target-repository-tree)
7. [Rationale, layer by layer](#7-rationale-layer-by-layer)
8. [Migration map](#8-migration-map)
9. [Deletions](#9-deletions)
10. [Root configuration files](#10-root-configuration-files)
11. [Enforcement](#11-enforcement)
12. [Migration sequence](#12-migration-sequence)
13. [Non-goals and risks](#13-non-goals-and-risks)
14. [Appendix — evidence](#14-appendix--evidence)

---

## 1. Purpose

The platform supports multiple therapeutic modalities — small molecule, peptide,
antibody today; oligonucleotide, PROTAC and ADC on the roadmap. The frontend
already models this explicitly (`MODALITY_REGISTRY` in
`apps/hakase-ai/src/lib/modalityRouter.ts`). The backend does not.

This document specifies a restructure so that:

- each modality has one obvious, self-contained home;
- shared science lives in a layer that modalities depend on, never the reverse;
- adding a new modality is an **additive** operation against a template, not a
  cross-cutting edit of a dozen shared files;
- the boundary is **machine-checkable**, so it cannot silently decay.

No code is changed by this document. It is the plan that a subsequent migration
executes.

---

## 2. Executive summary

**The restructure is viable and is mostly a re-arrangement, not a rewrite.**
Roughly 400 of the current 412 tracked files move without content changes. Real
authoring is confined to three places: Python packaging metadata, the
decomposition of `main.py`, and the new enforcement script.

The repository becomes two tiers:

```
platform/     modality-agnostic — gateway, kernel, three substrates, contracts
modalities/   the verticals — small-molecule, peptide, antibody, _template
```

governed by one rule that CI enforces:

> **Nothing under `platform/` may import from `modalities/`.**

Two findings from the investigation materially shaped the design and are worth
stating up front:

1. **Peptide already works this way.** It is mounted at the gateway by a
   three-line wildcard proxy and served by a prefixed, lazily-loaded
   `APIRouter`. Every other modality is hand-wired into a 40-entry string table.
   The pattern is not hypothetical — it is being generalised from a working
   example.

2. **The antibody→peptide coupling is shallow and mislabelled.** Antibody
   imports three *private* helpers from the peptide ML module. They are generic
   amino-acid science, not peptide science. Promoting them to a shared
   `sequence` substrate dissolves the only structural obstacle to treating the
   modalities as siblings.

---

## 3. Current-state assessment

### 3.1 Where modality is a real axis

Measured across the seven top-level areas of the repo:

| Area | Modality a real axis? | Evidence |
| --- | --- | --- |
| `apps/ai-service` | **Yes — strongly** | The whole scientific core; ~60 modules in one flat namespace |
| `runpod_worker*` | **Yes** | `boltz*` serves biologics; `ties`/`dock` serve small molecule |
| `apps/api-server` | **Partially** | Proxy seam + narrative routes are modality-aware; auth/health/security are not |
| `lib/api-spec` | **Should be, isn't** | 36 lines, one path (`/healthz`), against a service exposing 55 |
| `lib/db` | No | auth · conversations · messages |
| `lib/integrations-anthropic-ai` | No | Generic Claude client |
| `deploy/` | No | Two PM2 processes, nginx, systemd |

**Consequence:** forcing modality onto all seven areas would produce empty
shells. The two-tier design confines modality to where it is genuinely load-bearing.

### 3.2 Structural defects found

These are stated as findings, with the evidence that established them. Each one
is addressed by a specific element of the target design.

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | **CI does not run.** `deploy/ops/github-actions.yml` is a reference file; there is no `.github/` directory. Typecheck, preflight and all tests are advisory. | `ls .github` → not found |
| F2 | **Two conflicting Python dependency sources.** `pyproject.toml` (uv) and `apps/ai-service/requirements.txt` disagree: `torch>=2.11.0` vs `>=2.8.0`; `chemprop>=1.7.0` vs `>=2.2.2`. CI installs the latter via pip; production resolves the former via uv. | Both files; CI job step |
| F3 | **`ai-service` is not an importable package.** `main.py` uses `from models.x import y`, which resolves only when cwd is `apps/ai-service`. No pytest config; tests live in three unrelated trees. | `main.py:47+` |
| F4 | **`main.py` is a 1,436-line composition root** with ~80 eager top-level imports of torch/chemprop/sklearn/DeepPurpose and 55 route decorators. Only the peptide vertical uses an `APIRouter`. | `main.py` |
| F5 | **`models/` is a 60-module flat namespace** spanning eight concerns. Subpackages (`mcdc/`, `dsm/`, `reasoning/`) already exist, proving the pattern is wanted. | `models/` |
| F6 | **Antibody imports peptide privates.** `from models.peptide_esm_ml import _features, _camsol_score, _clean`. | `main.py:1142` |
| F7 | **`/api/ai/antibody-ml` bypasses the gateway.** It is the only Python route with an `/api/ai/` prefix (all others are `/predict/*`), and the frontend calls it directly at `${API_ROOT}/api/ai/antibody-ml`, skipping the proxy table. | `main.py:1124`; `antibodyL1Plus.ts:380` |
| F8 | **`workers/` is dead code.** `workers/boltz-worker` and `workers/fep-worker` were both added in a single commit on 2026-05-26 and never touched again. The live workers are `runpod_worker/` and `runpod_worker_boltz/`, both updated 2026-06-30 in `chore: production restructure`. | `git log --diff-filter=A` per directory |
| F9 | **Nine Python files live in a docs folder with spaces in its path.** `hakase_peptide/docs/Evidence Object Schemas/` contains `__init__.py` and eight schema modules — a package that cannot be imported by a normal module path. | Directory listing |
| F10 | **Committed fixtures inside a cache directory.** Six PDB files and nine calibration JSONs are tracked under `apps/ai-service/cache/`, whose `.gitignore` only excludes `*.pkl` and `*.npz`. The directory is 1 GB on disk. | `git ls-files apps/ai-service/cache` |
| F11 | **Orphaned duplicate package.** `lib/integrations/anthropic_ai_integrations/` has no `package.json`, two tracked files, and is superseded by `lib/integrations-anthropic-ai/`. `pnpm-workspace.yaml` still globs it. | Both directories |
| F12 | **The API contract is vestigial.** `lib/api-spec/openapi.yaml` is 36 lines describing `/healthz` only; `lib/api-zod` is generated from it. | `openapi.yaml` |
| F13 | **Pre-commit corrupted the PDB docking fixtures** (branch `mlops`, commit `376c355`). The `trailing-whitespace` hook stripped padding from fixed-width PDB records: all six files went from uniformly 80-column lines to ragged 75–79, losing columns 79–80 (formal charge). `file(1)` no longer identifies them as Protein Data Bank data. | See §3.5 |
| F14 | **Large binaries are raw in git, not LFS.** `.gitattributes` contains a single LFS rule, for a parquet file not present in the tree. ~17 MB of model weights and data corpora are stored directly. | `git ls-files` + size scan |

### 3.3 Coupling analysis

Every internal import edge in `models/` was traced. The graph is **sparse** —
most edges are intra-subpackage (`mcdc/`, `dsm/`, `reasoning/`) or a single
fan-out (`safety_triage` → five tox models, all small molecule).

There are exactly **four** cross-modality edges:

| Edge | Nature | Resolution in target |
| --- | --- | --- |
| `antibody_properties` → `peptide_properties` | Legitimate — antibodies are sequences | Both sit on `platform/sequence/` |
| `peptide_properties` → `cheminformatics` | Legitimate — cyclisation/linker chemistry is RDKit work | Peptide depends on `platform/chemistry/` |
| `hakase_peptide/services/compute` → `models.peptide_ml`, `models.peptide_properties` | Incomplete migration — the new package importing the old | Both move into `modalities/peptide/engine/`; edge becomes internal |
| `hakase_peptide/structure/conformation` → `models.cofolding` | Shared service — co-folding serves peptide *and* antibody | Moves to `platform/structure/` |

The first two are real biology. **This is why three flat sibling modality
folders will not work** — it would force either duplicated science or
modality-to-modality imports. The two-tier design is the direct consequence.

### 3.4 Peptide route surface — no conflict

An earlier assumption that legacy `/predict/peptide-*` routes overlapped the v3
router was **wrong**. There are no peptide routes in `main.py`. Peptide is
served exclusively by `/v3/peptide/*`, and the frontend calls three of them
(`/analyze`, `/policies`, `/models`, all in `lib/aiService.ts:2448+`).

The legacy `models/peptide_*` modules have exactly three consumers: a warmup
thread, the antibody route (F6), and `hakase_peptide` itself. **There is no
route surface to retire**, which makes peptide the cheapest vertical to migrate
and confirms it as the correct starting point.

### 3.5 The `mlops` branch — tooling, and one regression

Branch `mlops` (10 commits ahead of `dev`) adds `Makefile`,
`.pre-commit-config.yaml`, and ruff/black configuration in `pyproject.toml`. The
configuration itself is sound: `line-length = 100` is matched across both tools,
`E203`/`E501` are correctly ignored for black compatibility, and the rule
selection (`E,F,I,UP,B`) is reasonable.

Two issues must be resolved before it merges.

**Regression (F13) — the whitespace hook damaged scientific data files.**
Commit `376c355` modified all six `.pdb` docking fixtures. PDB is a
**fixed-width, column-position-sensitive** format; `trailing-whitespace`
stripped the padding that holds records at 80 columns:

```
before:  ATOM      1  N   PRO A   1     -12.735  38.918  31.287  1.00 39.83           N  |
after:   ATOM      1  N   PRO A   1     -12.735  38.918  31.287  1.00 39.83           N|

before.pdb: Protein Data Bank data, ID Code 1HVR, 14-FEB-94   (2351 lines, all exactly 80 cols)
after.pdb:  ASCII text                                        (2351 lines, ragged 75–79 cols)
```

Columns 79–80 (formal charge) are gone from every record. These are the fixtures
behind `docking_vina.py`. Tolerant parsers will cope; strict column-slicing ones
will not.

*Remedy:* restore the six files from `376c355^`, and add an `exclude` pattern to
the whitespace and end-of-file hooks covering scientific formats:

```yaml
exclude: '\.(pdb|tab|sdf|mol2?|fasta|csv)$'
```

The `.tab` corpora escaped this time only because those commits did not touch
them. The exclusion is preventative, not merely corrective.

**Blocker — `check-added-large-files` will reject the migration.** The hook is
set to `--maxkb=1024`, and twelve tracked files exceed 1 MB (F14). Because
`git mv` stages a rename as delete + add, pre-commit sees every moved large file
as newly added and fails the commit. See §12 Phase 0.5.

**Scale note.** `mlops` reformats roughly 50,000 lines of Python. Combining that
with a 400-file relocation in one step produces an unreviewable diff and severe
conflicts. The two must be sequenced, not merged.

---

## 4. Design principles

Every placement decision in this document derives from one of these four. A
decision that does not trace to a principle is arbitrary and should be
challenged.

### P1 — Dependency direction is the only thing that makes modularity real

Directory names are decoration. An enforced import rule is architecture.
Everything is arranged so that a single check — `platform/` must never import
`modalities/` — can fail the build. Modularity that cannot be tested is
modularity that decays; F7 is what that decay looks like after a year.

### P2 — Substrates mirror input types, not modalities and not disciplines

Three shared scientific layers, named after what goes *in*:

| Substrate | Input | Contents |
| --- | --- | --- |
| `platform/chemistry/` | SMILES | RDKit, cheminformatics, molecular properties, ML base |
| `platform/sequence/` | Amino acids | Descriptors, hydrophobicity, CamSol, ESM embeddings |
| `platform/structure/` | 3D coordinates | Co-folding, docking, PDB tooling, protein ML |

This is what makes the layer stable: **a new modality is a recombination of
existing substrates**, not new substrate. An ADC is chemistry + sequence + structure.
A PROTAC is chemistry twice with a linker. An oligonucleotide adds one substrate
(`nucleotide`) and reuses `structure`.

Had substrates been organised by *discipline* instead — "physchem", "ML",
"simulation" — every new modality would cut across all of them, and the
partitioning would need revisiting each time.

### P3 — A modality owns its full vertical, or it is not modular

Each modality owns four things: **engine** (Python science), **gateway**
(TypeScript route mount), **contract** (OpenAPI fragment), and optionally
**workers** (GPU deployment artefacts).

An engine that cannot expose itself is a library someone must remember to wire
up. That "remembering" is currently a 40-entry hand-maintained string table in
`apps/api-server/src/routes/ai-service.ts` — and F7 is the proof that it fails:
the antibody route drifted to a different URL shape and now bypasses the gateway
entirely. Peptide did not drift, because it owns its prefix and mounts by
wildcard. There was never a table to forget.

### P4 — Modality is a code boundary, not a deployment boundary

The service continues to run as **exactly two PM2 processes**. Modalities are
packages mounted into the gateway and the engine, not independent services.

Six modalities as separate deployables would mean six PM2 entries, six health
checks, six nginx blocks, and network calls where function calls exist today —
for no benefit at current scale. This principle is what keeps the restructure
from becoming a rewrite, and `deploy/` is therefore untouched.

---

## 5. The composition-root pattern

The investigation found the same shape in **four independent places**. Naming it
once makes the rest of the design follow mechanically.

> **Platform owns the composition mechanism. Each modality contributes a fragment.**

| Instance | Platform side | Modality side | Today |
| --- | --- | --- | --- |
| **HTTP routes** | `gateway/modality-mount.ts` | `modalities/*/gateway/routes.ts` | 40-entry string table; peptide already escaped it |
| **API contract** | `platform/contract/openapi.yaml` (`$ref`s fragments) | `modalities/*/contract/openapi.*.yaml` | Vestigial — 36 lines, one path (F12) |
| **Provenance registry** | `kernel/runtime/registry.py` | `modalities/*/registry.py` | **Already modality-keyed**: `get_open_source_registry(modality)`, `"peptide_l1"` key, served at `/registry/open-source?modality=` |
| **Report narrative** | `platform/narrative/` (Claude client, streaming, error handling) | `modalities/*/narrative/` (prompts + output schemas) | Hardcoded `PEPTIDE_SYSTEM_PROMPT` / `ANTIBODY_SYSTEM_PROMPT` and an `if/else` modality dispatch |

The registry case is the strongest signal: it is *already written this way*,
keyed by modality, with a modality query parameter on its route. The codebase
has been reaching for this structure without a place to put it.

The narrative case is the most valuable to fix. Today, adding a fourth modality
means editing shared prompt files and extending an `if/else` chain in
`report-narrative/index.ts` and `bio-analysis/index.ts`. Under the pattern, the
new modality ships its own prompt fragment and the platform never changes.

---

## 6. Target repository tree

```
hakase-bio-backend/
│
├── README.md                          # rewritten: platform/modality model
├── ARCHITECTURE.md                    # NEW: layer rules + rationale (CI enforces these)
├── SETUP.md                           # updated for uv workspace
├── CONTRIBUTING.md                    # NEW: "how to add a modality"
├── RESTRUCTURE.md                     # this document
│
├── Makefile                           ← from mlops; targets repointed  [§3.5]
├── .pre-commit-config.yaml            ← from mlops; + data-format exclude [F13]
│
├── .gitignore                         # rewritten — see §10
├── .gitattributes                     # LFS rules extended to model weights [F14]
├── .npmrc  .env.example
├── package.json                       # workspace scripts, same shape
├── pnpm-workspace.yaml                # globs → platform/*, modalities/*/gateway
├── pnpm-lock.yaml
├── pyproject.toml                     # NOW a uv workspace root (was "repl-nix-workspace")
├── uv.lock
├── tsconfig.base.json                 # unchanged
├── tsconfig.json                      # project references updated
├── ecosystem.config.js                # kept — re-exports deploy/config
│
├── .github/workflows/
│   ├── backend-deploy.yml             ← deploy/ops/github-actions.yml   [fixes F1]
│   └── boundaries.yml                 # NEW: import-direction check      [P1]
│
├── platform/                          ═══════ MODALITY-AGNOSTIC ═══════
│   │
│   ├── gateway/                                        ← apps/api-server
│   │   ├── package.json  tsconfig.json  build.ts  README.md
│   │   └── src/
│   │       ├── app.ts  index.ts
│   │       ├── modality-mount.ts       # NEW ← generalises proxyV3Peptide   [P3]
│   │       ├── lib/          auth/service.ts · cookies · crypto · email
│   │       │                 env · errors · ipnet · jwt
│   │       ├── middlewares/  auth.ts · security.ts
│   │       ├── routes/       auth.ts · health.ts · index.ts
│   │       │                 preclinical.ts · validation.ts
│   │       └── tests/smoke/  auth.smoke.mjs      ← root _auth_smoke.mjs
│   │                         service.smoke.mjs   ← root .smoke.mjs
│   │
│   ├── datasources/                                    ← api-server/src/routes/*
│   │   ├── package.json  README.md
│   │   └── src/  chembl.ts · pubchem.ts · uniprot.ts · rcsb-pdb.ts
│   │             alphafold-db.ts · bindingdb.ts · opentargets.ts
│   │             ccte.ts · fda-psg.ts
│   │
│   ├── narrative/                     # LLM plumbing only — prompts live in modalities
│   │   ├── package.json  README.md
│   │   └── src/  engine.ts        # Claude client, streaming, retry, error mapping
│   │              compose.ts      # assembles modality prompt fragments   [§5]
│   │              bio-chat.ts     # modality-agnostic (0 modality references)
│   │
│   ├── db/                                             ← lib/db
│   │   ├── package.json  tsconfig.json  drizzle.config.ts
│   │   └── src/  index.ts · schema/{auth,conversations,messages,index}.ts
│   │
│   ├── integrations/                                   ← lib/integrations-anthropic-ai
│   │   ├── package.json  tsconfig.json
│   │   └── src/  client.ts · index.ts · batch/{index,utils}.ts
│   │
│   ├── contract/                                       ← lib/api-spec + lib/api-zod
│   │   ├── package.json  orval.config.ts
│   │   ├── openapi.yaml               # composition root — $refs modality fragments
│   │   └── src/  index.ts · generated/…
│   │
│   ├── kernel/                        ═══ PYTHON · knows no modality ═══
│   │   ├── pyproject.toml  README.md  py.typed
│   │   └── src/hakase_kernel/
│   │       ├── contracts.py           # NEW: ModalityEngine protocol
│   │       ├── decision/    mcdc/{engine,graph,evidence,decision,verdict,
│   │       │                      crc,voi,interval,interfaces,reliability}.py
│   │       │                dsm/{estimator,early_warning,simulate}.py
│   │       │                reasoning/{calibration,evidence,ood,
│   │       │                          reliability,selective}.py
│   │       │                scientific_verdict.py · verdict_provenance.py
│   │       ├── uncertainty/ conformal.py · ad_threshold.py · applicability.py
│   │       │                applicability_domain.py · uncertainty.py
│   │       │                live_calibration.py · explain.py
│   │       ├── translational/ celltype_aggregation.py · patient_line.py
│   │       │                  lab_reference.py
│   │       ├── runtime/     gpu_dispatch.py · remote_data.py · privacy.py
│   │       │                registry.py   ← open_source_registry.py (mechanism only)
│   │       └── tests/       test_scientific_verdict.py  ← apps/ai-service/tests/
│   │
│   ├── chemistry/                     ═══ SUBSTRATE: SMILES ═══           [P2]
│   │   ├── pyproject.toml  README.md
│   │   └── src/hakase_chemistry/
│   │       ├── cheminformatics.py · molecular_properties.py
│   │       ├── ml_base.py             ← models/_ml_base.py
│   │       ├── units.py · descriptors.py  ← apps/ai-service/utils/
│   │       └── tests/
│   │
│   ├── sequence/                      ═══ SUBSTRATE: amino acids ═══  ★ NEW  [P2, fixes F6]
│   │   ├── pyproject.toml  README.md
│   │   └── src/hakase_sequence/
│   │       ├── descriptors.py         ← peptide_esm_ml._features      (was private)
│   │       ├── camsol.py              ← peptide_esm_ml._camsol_score  (was private)
│   │       ├── clean.py               ← peptide_esm_ml._clean         (was private)
│   │       ├── esm/  base.py · esm2_nvidia.py · resolve.py · storage.py
│   │       │                          ← hakase_peptide/embeddings/
│   │       └── tests/
│   │
│   └── structure/                     ═══ SUBSTRATE: 3D ═══               [P2]
│       ├── pyproject.toml  README.md
│       ├── src/hakase_structure/
│       │   ├── cofolding.py           ← models/cofolding.py  (peptide AND antibody)
│       │   ├── docking.py             ← models/docking_vina.py
│       │   ├── protein.py · protein_ml.py · protein_ml_data.py
│       │   ├── pdb_tools.py · providers.py  ← hakase_peptide/structure/
│       │   └── tests/  test_esmatlas_bounded_failure.py
│       ├── fixtures/pdb/  1HVR · 1M17 · 2W96 · 5AER · 5B8D · 5IKR .pdb
│       │                              ← apps/ai-service/cache/docking/   [fixes F10]
│       └── workers/boltz/             ← runpod_worker_boltz/  (the LIVE one)
│           Dockerfile · .dockerignore · handler.py
│           boltz_runner.py · requirements.txt · README.md
│
├── modalities/                        ═══════ THE VERTICALS ═══════
│   │
│   ├── README.md                      # registry + how to add one
│   │
│   ├── small-molecule/
│   │   ├── README.md                  # scope · endpoints · models · validation status
│   │   ├── engine/
│   │   │   ├── pyproject.toml
│   │   │   └── src/hakase_small_molecule/
│   │   │       ├── router.py                      ← extracted from main.py  [F4]
│   │   │       ├── registry.py                    # provenance fragment     [§5]
│   │   │       ├── admet/   admet.py · admet_ml.py · admetlab.py
│   │   │       │            ersilia_hub.py · drug_lookup.py
│   │   │       ├── tox/     tox21_ml.py · dili_ml.py · cardiotox.py
│   │   │       │            ames_ml.py · bsep.py · reactive_metabolites.py
│   │   │       │            safety_triage.py · invitro_panel.py
│   │   │       ├── pk/      pk_ivive.py · animal_sim.py · pkdb_anchor.py
│   │   │       │            vdss_ml.py · half_life_ml.py · caco2_ml.py
│   │   │       │            bbb_ml.py · cyp_inhibition_ml.py
│   │   │       │            solubility_ml.py · solubility_ml_data.py
│   │   │       ├── binding/ binding_ml.py · binding_ml_data.py
│   │   │       │            binding_dta_adapter.py · drug_target.py
│   │   │       ├── vendor/hakase_admet/           ← vendored, unchanged
│   │   │       │            LICENSE.txt · py.typed · admet_model.py
│   │   │       │            admet_predict.py · admet_info.py · constants.py
│   │   │       │            drugbank.py · physchem.py · plot.py · utils.py
│   │   │       │            resources/{models,data}/      (Git LFS)
│   │   │       └── tests/
│   │   ├── gateway/     package.json · src/routes.ts  → /api/ai/v1/small-molecule/*
│   │   ├── contract/    openapi.small-molecule.yaml
│   │   ├── narrative/   prompts.ts · schema.ts        # fragment            [§5]
│   │   ├── validation/                                ← apps/ai-service/validation/
│   │   │   ├── run_validation.py · endpoint_validation.py
│   │   │   ├── holdout.py · metrics.py · predictors.py
│   │   │   ├── datasets/   21 × tdc_*_test.csv
│   │   │   ├── reports/    L1_validation_report_2026-06-{25,29}.md
│   │   │   ├── snapshots/  verdict_holdout_2026{0625,0629,0630}.json
│   │   │   └── tests/      test_endpoint_harness.py   (run_tests.py → pytest)
│   │   ├── data/        21 × TDC .tab · known_drug_index.json · known_drugs.py
│   │   └── workers/fep-ties/                          ← runpod_worker/  (LIVE)
│   │       Dockerfile · .dockerignore · handler.py · ties_runner.py
│   │       dock_runner.py · environment.yml · requirements.txt
│   │       README.md · DEPLOYMENT_HANDOFF.md
│   │
│   ├── peptide/
│   │   ├── README.md
│   │   ├── engine/
│   │   │   ├── pyproject.toml
│   │   │   └── src/hakase_peptide/               ← moves largely INTACT
│   │   │       ├── api/router.py · __init__.py
│   │   │       ├── config.py · pipeline.py · jsonsafe.py
│   │   │       ├── registry.py                   # provenance fragment  [§5]
│   │   │       ├── domain/    peptide.py · evidence.py · target.py · ids.py
│   │   │       │              modifications.py · platform_evidence.py
│   │   │       │              schemas/  physicochemical.py
│   │   │       │                        common.py · developability.py    ★ RESCUED
│   │   │       │                        functional.py · safety.py        from
│   │   │       │                        structural.py                    "docs/Evidence
│   │   │       │                        platform_evidence.py             Object Schemas/"
│   │   │       │                                                         [fixes F9]
│   │   │       ├── services/  base.py · compute.py · physicochemical.py
│   │   │       │              developability.py · functional.py
│   │   │       │              safety.py · structural.py
│   │   │       ├── decision/  engine.py · policy.py · record.py
│   │   │       │              scoring.py · variables.py
│   │   │       ├── structure/ conformation.py · prediction.py
│   │   │       ├── properties/ properties.py  ← models/peptide_properties.py
│   │   │       │               ml.py          ← models/peptide_ml.py
│   │   │       │               esm_ml.py      ← models/peptide_esm_ml.py (publics)
│   │   │       ├── infrastructure/  audit.py · evidence_bus.py · faults.py
│   │   │       │                    model_registry.py · orchestrator.py
│   │   │       │                    resource_manager.py
│   │   │       └── tests/     9 existing files, unchanged
│   │   ├── gateway/     → /api/ai/v1/peptide/*   (+ /v3/peptide alias retained)
│   │   ├── contract/    openapi.peptide.yaml
│   │   ├── narrative/   prompts.ts · schema.ts   ← PEPTIDE_SYSTEM_PROMPT   [§5]
│   │   └── docs/                                 ← hakase_peptide/docs/ (30 specs)
│   │       ├── 01-architecture/         6 specs + README
│   │       ├── 02-scientific-services/  5 specs + README
│   │       ├── 03-engineering/          5 specs + README
│   │       └── implementation/          M1-M8 notes · roadmap · session log
│   │
│   ├── antibody/
│   │   ├── README.md
│   │   ├── engine/
│   │   │   ├── pyproject.toml
│   │   │   └── src/hakase_antibody/
│   │   │       ├── router.py          # NEW — owns what was /api/ai/antibody-ml [F7]
│   │   │       ├── properties.py      ← models/antibody_properties.py
│   │   │       ├── numbering.py       ← models/antibody_numbering.py
│   │   │       ├── registry.py        # provenance fragment
│   │   │       └── tests/
│   │   ├── gateway/     → /api/ai/v1/antibody/*
│   │   ├── contract/    openapi.antibody.yaml
│   │   └── narrative/   prompts.ts · schema.ts  ← ANTIBODY_SYSTEM_PROMPT
│   │
│   └── _template/                     ═══ scaffold: oligo · protac · adc ═══
│       ├── README.md                  # step-by-step fill-in guide
│       ├── engine/pyproject.toml · src/hakase_MODALITY/router.py · registry.py · tests/
│       ├── gateway/package.json · src/routes.ts
│       ├── contract/openapi.MODALITY.yaml
│       └── narrative/prompts.ts · schema.ts
│
├── service/                           ═══ Python composition root ═══
│   ├── pyproject.toml
│   └── src/hakase_service/
│       ├── main.py                    # ~60 lines: app factory + modality mounts
│       │                              # (was 1,436 lines, ~80 eager imports)  [F4]
│       ├── registry.py                # the modality registry
│       └── warmup.py                  # extracted startup logic
│
├── deploy/                            ═══ UNCHANGED ═══                    [P4]
│   ├── README.md  package.json  .env.example
│   ├── config/ecosystem.config.cjs
│   ├── scripts/  orchestrator.mjs · preflight.mjs · healthcheck.mjs
│   │              install.mjs · build.mjs · start.mjs · run-ai-service.mjs
│   │              enforce-pnpm.mjs · install-system-deps.sh
│   ├── nginx/hakase-backend.conf
│   ├── systemd/hakase-backend.service
│   ├── docker/   Dockerfile · docker-compose.yml · docker-compose.ersilia.yml
│   │              ADMETLAB_SETUP.md · ERSILIA_SETUP.md
│   └── ops/      deploy.sh · reload.sh · post-merge-hook.sh
│
└── scripts/
    ├── audit_model_portfolio.py
    ├── ci_l1.sh                       # paths updated
    ├── post-merge.sh
    ├── check_boundaries.py            # NEW: the import-direction enforcer  [P1]
    └── start-backend.mts
```

---

## 7. Rationale, layer by layer

### 7.1 Why two tiers instead of six sibling modality folders

Two of the four cross-modality edges (§3.3) are **legitimate biology**.
Antibodies genuinely reuse peptide physicochemistry; peptides genuinely need
RDKit. Flat siblings would force either duplicated science or
modality-to-modality imports — and once modalities import each other, the
structure provides nothing that the current flat namespace does not.

The two-tier split makes the rule expressible in one greppable line (P1), which
is the difference between an architecture and a naming convention.

### 7.2 Why `platform/sequence/` is the highest-value single change

It resolves F6. Today antibody reaches into peptide's private API:

```python
from models.peptide_esm_ml import _features, _camsol_score, _clean
```

Three underscore-prefixed functions, imported across a modality boundary. But
hydrophobicity descriptors, CamSol aggregation scoring and sequence cleaning are
**generic amino-acid science** — they were never peptide-specific; they simply
had nowhere else to live.

Promoting them to a public substrate achieves three things at once:

1. Peptide and antibody become siblings rather than parent/child.
2. The private-import violation disappears.
3. The precedent is set for `platform/nucleotide/` when oligonucleotides land.

### 7.3 Why `service/` is separate from the modality engines

`main.py` currently eagerly imports torch, chemprop, sklearn and DeepPurpose at
module scope (F4). All of it loads at startup regardless of what any request
touches — which is why the orchestrator needs a distinct warm phase.

Separating the composition root from the engines lets each modality's heavy
imports move inside its own lazily-mounted package. `hakase_peptide` already
demonstrates the payoff: it is mounted in a `try`/`except`, so a broken peptide
install degrades one modality instead of failing the service. Generalised, a
torch failure can no longer take down ADMET.

### 7.4 Why each modality owns `gateway/`, `contract/` and `narrative/`

Per P3 and §5. The concrete argument is F7: the antibody route drifted to a
non-standard URL and now bypasses the gateway proxy, because no single owner was
responsible for its surface. Peptide did not drift, because ownership was
structural rather than conventional.

`contract/` applies the same logic in machine-checkable form: `platform/contract/openapi.yaml`
becomes a composition root that `$ref`s each modality fragment, so the published
API surface is *derived from* the modality structure rather than maintained
alongside it. F12 — a 36-line spec against a 55-endpoint service — is what
"maintained alongside" looks like after a year.

### 7.5 Why `deploy/` is untouched

Per P4. Modalities are libraries, not services. Preserving the two-process model
is what bounds the blast radius of this work, and it means the restructure can
land without any change to PM2 configuration, nginx, systemd, `.env`, or the
deployment runbook.

### 7.6 Why fixtures leave `cache/`

Per F10. A cache is by definition disposable; anything committed to git is a
fixture. Six PDB files are currently tracked *inside a directory named `cache/`*
alongside 1 GB of regenerable data, guarded by a `.gitignore` that excludes only
two file extensions. Separating them lets `cache/` be ignored wholesale, so no
one has to reason about which cached files are load-bearing.

---

## 8. Migration map

### 8.1 TypeScript

| From | To |
| --- | --- |
| `apps/api-server/src/{app,index}.ts` | `platform/gateway/src/` |
| `apps/api-server/src/lib/**` | `platform/gateway/src/lib/` |
| `apps/api-server/src/middlewares/**` | `platform/gateway/src/middlewares/` |
| `apps/api-server/src/routes/{auth,health,index,preclinical,validation}.ts` | `platform/gateway/src/routes/` |
| `apps/api-server/src/routes/{chembl,pubchem,uniprot,rcsb-pdb,alphafold-db,bindingdb,opentargets,ccte,fda-psg}.ts` | `platform/datasources/src/` |
| `apps/api-server/src/routes/bio-chat/index.ts` | `platform/narrative/src/bio-chat.ts` |
| `apps/api-server/src/routes/{bio-analysis,report-narrative}/index.ts` | **split**: plumbing → `platform/narrative/src/`; prompts + schemas → `modalities/*/narrative/` |
| `apps/api-server/src/routes/ai-service.ts` | **dissolved**: proxy core → `platform/gateway/src/modality-mount.ts`; route entries → per-modality `gateway/routes.ts` |
| `lib/db/**` | `platform/db/` |
| `lib/integrations-anthropic-ai/**` | `platform/integrations/` |
| `lib/api-spec/**`, `lib/api-zod/**` | `platform/contract/` |

### 8.2 Python — to `platform/`

| From (`apps/ai-service/models/`) | To |
| --- | --- |
| `mcdc/`, `dsm/`, `reasoning/`, `scientific_verdict.py`, `verdict_provenance.py` | `platform/kernel/src/hakase_kernel/decision/` |
| `conformal.py`, `ad_threshold.py`, `applicability.py`, `applicability_domain.py`, `uncertainty.py`, `live_calibration.py`, `explain.py` | `platform/kernel/src/hakase_kernel/uncertainty/` |
| `celltype_aggregation.py`, `patient_line.py`, `lab_reference.py` | `platform/kernel/src/hakase_kernel/translational/` |
| `gpu_dispatch.py`, `remote_data.py`, `privacy.py` | `platform/kernel/src/hakase_kernel/runtime/` |
| `open_source_registry.py` | **split**: mechanism → `kernel/runtime/registry.py`; per-modality entries → `modalities/*/registry.py` |
| `cheminformatics.py`, `molecular_properties.py`, `_ml_base.py` | `platform/chemistry/` |
| `apps/ai-service/utils/{admet_units,descriptors}.py` | `platform/chemistry/src/hakase_chemistry/` |
| `cofolding.py`, `docking_vina.py`, `protein.py`, `protein_ml.py`, `protein_ml_data.py` | `platform/structure/` |
| `hakase_peptide/structure/{pdb_tools,providers}.py` | `platform/structure/src/hakase_structure/` |
| `hakase_peptide/embeddings/**` | `platform/sequence/src/hakase_sequence/esm/` |
| `peptide_esm_ml.py` privates (`_features`, `_camsol_score`, `_clean`) | `platform/sequence/` as public API |

### 8.3 Python — to `modalities/`

| From | To |
| --- | --- |
| 28 small-molecule modules (see tree §6) | `modalities/small-molecule/engine/src/hakase_small_molecule/{admet,tox,pk,binding}/` |
| `hakase_admet/**` | `modalities/small-molecule/engine/src/hakase_small_molecule/vendor/hakase_admet/` |
| `apps/ai-service/{validation,data}/**` | `modalities/small-molecule/{validation,data}/` |
| `hakase_peptide/**` | `modalities/peptide/engine/src/hakase_peptide/` |
| `hakase_peptide/docs/Evidence Object Schemas/*.py` | `modalities/peptide/engine/src/hakase_peptide/domain/schemas/` |
| `hakase_peptide/docs/**` (markdown) | `modalities/peptide/docs/` |
| `peptide_properties.py`, `peptide_ml.py`, `peptide_esm_ml.py` | `modalities/peptide/engine/src/hakase_peptide/properties/` |
| `antibody_properties.py`, `antibody_numbering.py` | `modalities/antibody/engine/src/hakase_antibody/` |
| `main.py` route bodies | split across the three `router.py` files |
| `main.py` app assembly | `service/src/hakase_service/main.py` |

### 8.4 Workers

| From | To | Note |
| --- | --- | --- |
| `runpod_worker/` | `modalities/small-molecule/workers/fep-ties/` | TIES/FEP + docking — small-molecule-owned |
| `runpod_worker_boltz/` | `platform/structure/workers/boltz/` | Co-folding serves peptide **and** antibody — platform-owned |

---

## 9. Deletions

| Path | Files | Reason |
| --- | --- | --- |
| `workers/` | 7 | Dead code — F8 |
| `lib/integrations/anthropic_ai_integrations/` | 2 | Orphaned duplicate — F11 |
| `apps/ai-service/requirements.txt` | 1 | Second dependency source — F2 |
| `apps/api-server/.replit-artifact/` | 1 | Replit leftover |
| `.smoke.mjs`, `_auth_smoke.mjs` | 2 | Relocated to `platform/gateway/src/tests/smoke/` |
| `scripts/start-frontend.mts` | 1 | Wrong repository |
| `scripts/src/hello.ts` | 1 | Placeholder cruft |
| `validation/tests/run_tests.py` | 1 | Hand-rolled runner replaced by pytest |
| Tracked files under `apps/ai-service/cache/` | 15 | 6 → `fixtures/`; 9 calibration JSONs → co-located with owning models |

**Net: 412 → approximately 400 tracked files.** The restructure is deliberately
close to a pure re-arrangement.

---

## 10. Root configuration files

| File | Action | Reason |
| --- | --- | --- |
| `README.md` | Rewrite | Documents `apps/api-server` and `apps/ai-service`; both paths disappear |
| `ARCHITECTURE.md` | New | The layer rules need a canonical home; CI enforces them, this explains them |
| `CONTRIBUTING.md` | New | "How to add a modality" — makes `_template/` usable by someone not present for this design |
| `SETUP.md` | Update | Python setup moves from pip + `requirements.txt` to uv workspace |
| `.gitignore` | Rewrite | Currently ignores `data/` then re-includes three paths by exception — fragile and will break under the new layout. Also needs `cache/` ignored wholesale once fixtures move out |
| `.gitattributes` | **Extend + update paths** | Currently holds one LFS rule, for a parquet file absent from the tree (F14). Must cover `*.pt` model weights and the large CSV corpora, and follow the vendor move |
| `Makefile` | Adopt from `mlops` | Becomes the documented entry point (`make setup`, `make lint`, `make start`). Targets repointed to the new layout |
| `.pre-commit-config.yaml` | Adopt from `mlops`, **with fix** | Add `exclude: '\.(pdb\|tab\|sdf\|mol2?\|fasta\|csv)$'` to whitespace/EOF hooks (F13). Reconcile `check-added-large-files` with the migration (§12 Phase 0.5) |
| `pyproject.toml` | Rewrite | Becomes a uv workspace root listing `platform/*`, `modalities/*/engine` and `service` as members. Currently named `repl-nix-workspace` and is one of the two conflicting dependency sources (F2) |
| `pnpm-workspace.yaml` | Edit globs | `apps/*`, `lib/*`, `lib/integrations/*` → `platform/*`, `modalities/*/gateway`, `deploy`, `scripts`. Drops the dead `lib/integrations/*` glob (F11) |
| `tsconfig.json` | Edit | Project references follow the moves |
| `tsconfig.base.json` | Keep | Unaffected |
| `.npmrc`, `.env.example`, `ecosystem.config.js`, lockfiles | Keep | Unaffected |

The two workspace manifests coexist deliberately: `pyproject.toml` globs the
Python members, `pnpm-workspace.yaml` globs the TypeScript ones. A modality
directory contains both, and each tool sees only its own half.

---

## 11. Enforcement

Structure that is not enforced reverts. Three checks, all in CI (`.github/workflows/boundaries.yml`):

**1. Import direction (P1).** `scripts/check_boundaries.py` fails the build if
any file under `platform/` imports from `modalities/`. This single rule is what
makes the two-tier split real rather than cosmetic.

**2. No cross-modality imports.** No file under `modalities/<a>/` may import
from `modalities/<b>/`. Shared code must be promoted to a substrate. This is the
check that would have caught F6 the day it was written.

**3. Contract completeness.** Every modality with a `gateway/` must have a
`contract/` fragment referenced from `platform/contract/openapi.yaml`. Prevents
recurrence of F12.

Additionally, wiring up `.github/workflows/backend-deploy.yml` (F1) makes the
existing typecheck, preflight and `scripts/ci_l1.sh` gates actually run — which
they currently do not.

---

## 12. Migration sequence

Ordered so the service remains bootable at every step. Each phase is
independently revertible.

### Phase 0 — Prerequisites (no restructuring)

1. Wire up `.github/workflows/` (F1). Everything after this is verified by CI.
2. Collapse Python dependencies onto uv; delete `requirements.txt` (F2).
3. Make `ai-service` an installable package with a `src/` layout and pytest
   config (F3).
4. Delete dead code: `workers/`, orphaned integrations lib, Replit artefacts,
   root smoke files (F8, F11).

**Rationale:** F3 is a hard blocker — root-level Python packages are impossible
while `main.py` relies on `cwd`-relative imports. F1 and F2 are independently
valuable and de-risk everything downstream.

### Phase 0.5 — Land the `mlops` tooling (before any file moves)

Merged **first**, as a small reviewable change, so the quality gates exist before
400 files move and so the two large diffs never overlap (§3.5).

1. **Restore the six PDB fixtures** from `376c355^` (F13).
2. **Add the data-format exclude** to the whitespace and end-of-file hooks:
   `exclude: '\.(pdb|tab|sdf|mol2?|fasta|csv)$'`.
3. **Move large binaries to Git LFS** (F14) — the 10 ADMET `.pt` weights
   (~12.8 MB), `drugbank_approved.csv` (2.0 MB), `5IKR.pdb` (2.3 MB). This both
   satisfies the large-file standard and clears the `check-added-large-files`
   blocker, since LFS pointers are a few hundred bytes.
4. **Repoint `[tool.ruff] src`** — currently `["apps/ai-service"]`, a path that
   ceases to exist. After the restructure it becomes the `platform/*` and
   `modalities/*/engine` source roots.
5. Merge `mlops` → `dev`. Verify: `make lint`, `make ci`, and a docking smoke
   run against the restored fixtures.

**On DVC.** Deferred, not rejected. Git LFS is sufficient for the current
~17 MB of vendored, effectively immutable weights, and is one `.gitattributes`
line. DVC earns its cost when training inputs are versioned alongside
experiments — worth revisiting when the retraining pipeline lands. The
LFS → DVC migration is straightforward and does not constrain this restructure.

**Ordering rule for everything after this point:** relocations use `git mv`
exclusively, and content changes go in separate commits from moves, so reviewers
see renames rather than rewrites.

### Phase 1 — Peptide vertical

Chosen first because: it is the only modality with a working end-to-end slice;
it is currently in the worst state (two implementations live, the new one
importing the old); antibody structurally depends on it; and §3.4 established
there is **no route surface to retire**, making it the cheapest migration.

1. Complete the internal migration — fold `peptide_properties`, `peptide_ml`,
   `peptide_esm_ml` into `hakase_peptide/properties/`.
2. Rescue the schema package from `docs/Evidence Object Schemas/` (F9).
3. Extract `platform/sequence/` from the peptide privates (F6).
4. Extract `platform/structure/` (co-folding, PDB tooling).
5. Move to `modalities/peptide/`; add `gateway/`, `contract/`, `narrative/`.
6. Keep `/v3/peptide` as an alias alongside `/api/ai/v1/peptide`.

### Phase 2 — Freeze the template

Distil Phase 1 into `modalities/_template/` plus `CONTRIBUTING.md`. **This is
the actual deliverable** — "a clear structure for future implementations" is a
template and an enforced rule, not a directory naming convention.

### Phase 3 — Antibody vertical

Small (two modules), so it is cheap. Its real purpose is proving the template
fits a *second* consumer — which is what prevents the platform layer from being
silently peptide-shaped. Also fixes the URL inconsistency and gateway bypass (F7).

### Phase 4 — Small-molecule vertical

Largest (28 modules, most of the route table), performed last against a boundary
validated twice. Mostly mechanical.

### Phase 5 — Composition roots

Collapse `main.py` to an app factory (F4); compose the OpenAPI root (F12);
compose the provenance registry and narrative prompts (§5).

---

## 13. Non-goals and risks

### Non-goals

- **Splitting into multiple repositories.** Everything here is one repo. If
  modalities eventually need independent versioning, that is a separate and much
  heavier decision — not to be taken until the in-repo boundary has proven itself.
- **Separate deployables per modality.** Explicitly rejected under P4.
- **Rewriting scientific code.** This is a re-arrangement. Model logic, numerical
  behaviour and validation snapshots are unchanged. Any behavioural difference
  observed during migration is a bug in the migration.
- **Changing the public API.** Existing endpoints keep working; new paths are
  added as aliases so the frontend can migrate independently.

### Risks

| Risk | Mitigation |
| --- | --- |
| Validation snapshots drift during the move | `modalities/small-molecule/validation/snapshots/` is version-controlled; run `run_validation.py` before and after each phase and diff |
| Git history becomes hard to follow | Use `git mv` exclusively for relocations; keep content changes in separate commits from moves |
| Git LFS pointers break when `hakase_admet/resources/` moves | Update `.gitattributes` in the same commit as the move; verify with `git lfs ls-files` |
| Frontend breaks on endpoint changes | Old paths retained as aliases throughout; no lockstep release required |
| Phase 4 is large enough to stall | It is last by design — if it stalls, Phases 0–3 have already delivered the template, the enforced boundary and two clean verticals |
| Substrate boundary guessed wrong | Phase 3 exists specifically to test it against a second consumer before the bulk migration |
| `check-added-large-files` blocks migration commits (`git mv` stages renames as adds) | Phase 0.5 moves large binaries to LFS first, reducing them to sub-kilobyte pointers |
| Hygiene hooks silently damage other scientific formats | Data-format exclude added in Phase 0.5; treat any hook-authored change to a non-source file as a defect, not a cleanup |
| `mlops` reformat and the relocation collide | Strictly sequenced — Phase 0.5 lands and merges before any file moves |

---

## 14. Appendix — evidence

Commands used to establish the findings, for independent verification.

```bash
# F1 — CI does not exist
ls .github

# F2 — conflicting dependency sources
grep -E "torch|chemprop" pyproject.toml apps/ai-service/requirements.txt

# F4 — main.py size and eager imports
wc -l apps/ai-service/main.py
grep -c "^from models\." apps/ai-service/main.py
grep -c "@app\." apps/ai-service/main.py

# F6 — antibody importing peptide privates
grep -n "_features\|_camsol_score\|_clean" apps/ai-service/main.py

# F7 — the gateway bypass
grep -rn "api/ai/antibody-ml" ../hakase-bio-frontend/apps/hakase-ai/src

# F8 — workers are dead
for d in workers/boltz-worker workers/fep-worker runpod_worker runpod_worker_boltz; do
  git log --diff-filter=A --format="added %ad" --date=short -- "$d" | tail -1
  git log -1 --format="last  %ad" --date=short -- "$d"
done

# F9 — Python package inside docs, with spaces in path
ls "apps/ai-service/hakase_peptide/docs/Evidence Object Schemas/"

# F10 — committed fixtures inside cache/
git ls-files apps/ai-service/cache

# F12 — vestigial contract
wc -l lib/api-spec/openapi.yaml
grep -c "@app\." apps/ai-service/main.py   # 55 routes vs 1 documented path

# §3.3 — the coupling graph
grep -rn "^\s*from models\.\|^\s*from \." apps/ai-service/models/*.py apps/ai-service/models/*/*.py

# §5 — the registry is already modality-keyed
grep -n "modality" apps/ai-service/models/open_source_registry.py apps/ai-service/main.py
```

---

## Open items

Both previously-open questions are now resolved and incorporated:

- **`platform/narrative/` scope** — resolved. `report-narrative` and
  `bio-analysis` contain hardcoded per-modality system prompts and an `if/else`
  modality dispatch. Split: LLM plumbing stays in platform; prompts and output
  schemas become modality fragments (§5).
- **`open_source_registry.py` placement** — resolved. It is already keyed by
  modality and served with a `?modality=` parameter. The mechanism goes to
  `kernel/runtime/registry.py`; the entries become per-modality fragments (§5).

Remaining decisions for the implementer:

1. Whether `/v3/peptide` aliases are retired after the frontend migrates, or kept
   permanently for external API consumers.
2. Whether `modalities/small-molecule/data/` (TDC `.tab` corpora, ~7.7 MB) should
   move to Git LFS alongside the model weights.
3. Naming: `service/` as the Python composition root — alternatives considered
   were `app/` and `runtime/`; `service/` was chosen to avoid collision with the
   existing `apps/` convention being retired.
