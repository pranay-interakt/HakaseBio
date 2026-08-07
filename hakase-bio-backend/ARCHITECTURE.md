# Architecture

The backend is **two tiers**: `platform/` holds modality-agnostic code, and
`modalities/` holds the therapeutic verticals. One rule keeps that split real:

> **Nothing under `platform/` may import from `modalities/`, and no modality may
> import another.**

`scripts/check_boundaries.py` enforces this in CI and in pre-commit. A directory
layout is a convention; an enforced import rule is an architecture.

---

## The tiers

```
platform/          modality-agnostic — may never import a modality
  gateway/         Express: auth, security, health, modality mounting
  datasources/     third-party scientific DB proxies (ChEMBL, PubChem, …)
  narrative/       LLM plumbing; prompts are modality-owned
  db/              Drizzle schema: auth · conversations · messages
  integrations/    Anthropic client + batch API
  contract/        OpenAPI composition root + generated Zod types
  kernel/          decision · uncertainty · translational · runtime
  chemistry/       SUBSTRATE — SMILES / RDKit
  sequence/        SUBSTRATE — amino acids, ESM embeddings
  structure/       SUBSTRATE — 3D, co-folding, docking (+ boltz worker)

modalities/        the verticals
  small-molecule/  engine · gateway · contract · validation · data · workers
  peptide/         engine · gateway · contract · docs
  antibody/        engine · gateway · contract
  _template/       scaffold for oligonucleotide · PROTAC · ADC

service/           FastAPI composition root — mounts every modality router
deploy/            PM2 · nginx · systemd (unchanged by the restructure)
```

## Why substrates are named after inputs

`chemistry` / `sequence` / `structure` correspond to SMILES / amino acids / 3D
coordinates — **what goes in**, not what science is done to it.

That is what makes the layer stable: a new modality is a *recombination* of
existing substrates rather than new substrate. An ADC is chemistry + sequence +
structure. A PROTAC is chemistry twice with a linker. An oligonucleotide adds one
substrate (`nucleotide`) and reuses `structure`.

Had the substrates been organised by discipline instead — "physchem", "ML",
"simulation" — every new modality would cut across all of them and the
partitioning would need revisiting each time.

## Why a modality owns its full vertical

Each modality owns four things: **engine** (Python science), **gateway**
(TypeScript route declaration), **contract** (OpenAPI fragment), and optionally
**workers** (GPU deployment artifacts).

An engine that cannot expose itself is a library someone must remember to wire
up. That "remembering" used to be a 40-entry hand-maintained string table in the
gateway — and it failed: the antibody route drifted to a non-standard URL and
started bypassing the gateway entirely. Peptide never drifted, because ownership
was structural rather than conventional.

## The composition-root pattern

The same shape appears in four places. Platform owns the *mechanism*; each
modality contributes a *fragment*.

| Instance | Platform side | Modality side |
| --- | --- | --- |
| HTTP routes | `gateway/src/modality-mount.ts` | `modalities/*/gateway/src/index.ts` |
| API contract | `platform/contract/openapi.yaml` | `modalities/*/contract/openapi.*.yaml` |
| Provenance registry | `kernel/runtime/registry.py` | per-modality registry entries |
| Report narrative | `platform/narrative/` | modality prompts + output schemas |

A modality declares **data**, not routers — that is what keeps the dependency
arrow pointing one way with no cycle.

## Modality is a code boundary, not a deployment boundary

The service still runs as **exactly two processes**. Modalities are packages
mounted into the gateway and the engine, not independent services. Six
deployables would mean six PM2 entries, six health checks and network calls where
function calls exist today, for no benefit at current scale.

## Paths

Never compute a cache path relative to `__file__`. Before the split every module
did, and once the code moved into separate packages each resolved to a different
directory holding nothing. Use `hakase_kernel.runtime.paths`:

| Function | Contents | Tracked? |
| --- | --- | --- |
| `cache_dir()` | regenerable — model pickles, embeddings (`var/cache/`) | no |
| `calibration_dir()` | versioned build artifacts (`assets/calibration/`) | yes |
| `pdb_fixtures_dir()` | reference structures (`platform/structure/fixtures/pdb/`) | yes |
| `resolve_artifact(name)` | prefers tracked calibration, falls back to cache | — |

All honour environment overrides so deployments can mount a volume.

## Fixed-width scientific formats

`.pdb` and `.tab` are **column-position-sensitive**. Whitespace-stripping tooling
silently corrupted all six docking fixtures once already: 80-column records
became ragged 75–79, losing the formal-charge columns. They are excluded in
`.pre-commit-config.yaml` and marked `-text` in `.gitattributes`. Treat any
hook-authored change to a data file as a defect, not a cleanup.

## Adding a modality

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: copy `modalities/_template/`,
implement the engine, declare the gateway routes, register the mount. No file
under `platform/` should need editing — if one does, that is a signal the shared
code belongs in a substrate.
