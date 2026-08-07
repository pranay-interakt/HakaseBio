# Peptide

Linear and cyclic peptides (2–100 AA). The reference implementation for the
modality pattern — it was already a clean layered vertical before the
restructure, and the rest were generalised from it.

## Layout

```
engine/    hakase_peptide
             domain/          peptide · evidence · target · modifications · schemas/
             services/        physicochemical · structural · functional
                              developability · safety · compute
             decision/        engine · policy · scoring · variables · record
             structure/       conformation · prediction
             properties/      properties · ml · esm_ml
             infrastructure/  orchestrator · evidence_bus · audit · model_registry
             api/router.py    APIRouter(prefix="/v3/peptide")
gateway/   route spec — a single wildcard mount
contract/  OpenAPI fragment
docs/      30 architecture + scientific-service specifications
```

## Substrates used

`hakase_kernel` · `hakase_chemistry` (cyclisation/linker chemistry) ·
`hakase_sequence` (AA descriptors, ESM) · `hakase_structure` (co-folding).

## Notes

**Wildcard mount.** The gateway forwards `/v3/peptide/*` wholesale rather than
listing endpoints, so it cannot drift out of sync with the Python router. New
modalities should copy this.

**Evidence schemas** live in `domain/schemas/`. They were previously in
`docs/Evidence Object Schemas/` — a Python package with spaces in its path, which
could not be imported by a normal module path.

**Generic AA science is not here.** Hydrophobicity scales, CamSol, charge/pI,
instability index, Aggrescan and the rest live in `hakase_sequence` so antibody
can use them without importing this package. `properties/properties.py`
re-exports them for convenience.
