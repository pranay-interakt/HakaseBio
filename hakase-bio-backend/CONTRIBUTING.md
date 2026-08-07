# Contributing

Read [ARCHITECTURE.md](ARCHITECTURE.md) first — one rule governs everything:
`platform/` may never import `modalities/`, and no modality may import another.

## Setup

```bash
make setup        # JS workspace + Python venv + .env
pre-commit install
```

Python packages are uv workspace members, installed editable. After adding a new
package, re-run `uv sync` so it lands on the path.

## Everyday commands

```bash
make lint         # ruff + black --check
make format       # ruff --fix + black
make test         # pytest
make backend      # run both processes via the orchestrator
python scripts/check_boundaries.py
```

## Adding a modality

This is designed to be **additive**. Nothing under `platform/` should need
editing; if something does, the shared code belongs in a substrate instead.

### 1. Scaffold

```bash
cp -r modalities/_template modalities/<name>
```

Rename `src/hakase_MODALITY` to `src/hakase_<name>` and update `pyproject.toml`
(`name`, `[tool.hatch.build.targets.wheel] packages`) plus `package.json`.

### 2. Register the Python package

Add the engine to `[tool.uv.workspace] members` and `[tool.uv.sources]` in the
root `pyproject.toml`, then `uv sync`.

### 3. Write the engine

Put the science in `engine/src/hakase_<name>/`, and expose a module-level
`router` (an `APIRouter`) in `router.py`.

Depend on `hakase_kernel` and whichever substrates you need — `hakase_chemistry`
(SMILES), `hakase_sequence` (amino acids), `hakase_structure` (3D). **Never
import another modality.** If you need something another modality has, promote it
to a substrate; that is what `platform/sequence/` exists for.

### 4. Mount it

Add one entry to `_MOUNTS` in `service/src/hakase_service/main.py`. Mounting is
defensive — a modality with a missing optional dependency logs and is skipped
rather than taking down the service.

### 5. Declare the gateway surface

In `gateway/src/index.ts`, export a `ModalityRouteSpec`. Prefer a `wildcards`
entry over a per-endpoint table: one mount forwards every sub-path and cannot
drift out of sync with the Python router.

```ts
export const myModalityRoutes: ModalityRouteSpec = {
  id: "my-modality",
  wildcards: [{ mountAt: ["/ai/v1/my-modality"], upstreamPrefix: "/v1/my-modality" }],
};
```

Then add it to `SPECS` in `platform/gateway/src/routes/ai-service.ts`, add the
workspace dep, and add the tsconfig project reference.

### 6. Add the contract fragment

Write `contract/openapi.<name>.yaml` and `$ref` it from
`platform/contract/openapi.yaml`.

### 7. Verify

```bash
python scripts/check_boundaries.py && make lint && make test
```

## Conventions

**Paths.** Never compute cache paths from `__file__`. Use
`hakase_kernel.runtime.paths` — `cache_dir()` for regenerable artifacts,
`calibration_dir()` for tracked build artifacts, `resolve_artifact()` when you
don't care which tier it lives in.

**Large files.** Anything over ~1 MB goes to Git LFS via `.gitattributes`. The
`check-added-large-files` pre-commit hook blocks accidental commits.

**Fixed-width data.** Never let formatters touch `.pdb` or `.tab`. They are
excluded from the whitespace hooks and marked `-text`; a hook-authored change to
one is a bug.

**Commits.** Keep relocations (`git mv`) in separate commits from content
changes so reviewers see renames rather than rewrites.
