# Modality template

Scaffold for a new therapeutic modality (oligonucleotide, PROTAC, ADC, …).

Adding a modality is **additive**: nothing under `platform/` should need editing.
If something does, the shared code belongs in a substrate instead.

```bash
cp -r modalities/_template modalities/<name>
```

Then replace every `MODALITY` placeholder — in directory names, `pyproject.toml`,
`package.json`, `router.py` and `gateway/src/index.ts`.

## The four parts

| Directory | Language | Contents |
| --- | --- | --- |
| `engine/` | Python | The domain core: science, ML, and the `APIRouter` that exposes it. Depends on `hakase_kernel` + substrates. |
| `gateway/` | TypeScript | A declarative `ModalityRouteSpec` — which gateway paths this modality owns and where they forward. Data, not code. |
| `contract/` | YAML | An OpenAPI fragment, `$ref`d from the platform composition root. |
| `narrative/` | TypeScript | Optional: LLM system prompts + output schema, if this modality appears in generated reports. |

A modality may skip parts it does not need — antibody has no workers, peptide has
no datasources. `workers/` is added only when the modality owns a GPU artifact.

Note the split is **engine = Python (including its HTTP router), gateway =
TypeScript edge**. The Express gateway proxies to the FastAPI service; it does
not re-implement it.

## Checklist

- [ ] Rename `engine/src/hakase_MODALITY` → `engine/src/hakase_<name>`
- [ ] `engine/pyproject.toml`: set `name`, wheel `packages`, and substrate deps
- [ ] Add the engine to `[tool.uv.workspace] members` + `[tool.uv.sources]` in the root `pyproject.toml`, then `uv sync`
- [ ] Implement the science in `engine/src/hakase_<name>/`
- [ ] Expose a module-level `router` in `router.py`
- [ ] Add one entry to `_MOUNTS` in `service/src/hakase_service/main.py`
- [ ] Declare the gateway surface in `gateway/src/index.ts`
- [ ] Add the spec to `SPECS` in `platform/gateway/src/routes/ai-service.ts`
- [ ] Add the workspace dep + tsconfig project reference for the gateway
- [ ] Write `contract/openapi.<name>.yaml` and `$ref` it from `platform/contract/openapi.yaml`
- [ ] Write this modality's `README.md` (scope, endpoints, models, validation status)
- [ ] `python scripts/check_boundaries.py && make lint && make test`

## The rules that matter

**Never import another modality.** Depend on `hakase_kernel` and the substrates:
`hakase_chemistry` (SMILES), `hakase_sequence` (amino acids), `hakase_structure`
(3D). A new modality is normally a *recombination* of existing substrates — an
ADC is chemistry + sequence + structure. If you genuinely need new shared
science, add it to a substrate, not to your modality.
`scripts/check_boundaries.py` fails the build otherwise.

**Keep domain logic out of `gateway/`.** It declares paths; it does not score,
rank or validate beyond structural JSON checks.

**Prefer a wildcard mount.** One `wildcards` entry forwards the whole prefix, so
the gateway cannot drift out of sync with the Python router. The per-endpoint
tables exist only for legacy paths that need remapping.

**Never fabricate.** When a model or upstream is unavailable, return a structured
`unavailable` result with a machine-readable reason. A caller must be able to
distinguish "could not compute" from "computed a low score".
