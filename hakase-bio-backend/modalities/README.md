# Modalities

Each directory is one therapeutic modality — a self-contained vertical that
depends on `platform/` and never on a sibling.

| Modality | Status | Engine package | Gateway prefix |
| --- | --- | --- | --- |
| [small-molecule](small-molecule/) | live | `hakase_smallmol` | `/ai/*` |
| [peptide](peptide/) | live | `hakase_peptide` | `/v3/peptide/*` (wildcard) |
| [antibody](antibody/) | live | `hakase_antibody` | `/ai/antibody*` |
| oligonucleotide | roadmap | — | — |
| PROTAC | roadmap | — | — |
| ADC | roadmap | — | — |

The roadmap set matches `MODALITY_REGISTRY` in the frontend
(`apps/hakase-ai/src/lib/modalityRouter.ts`), which is the canonical taxonomy.

## Structure

Every modality follows the same shape — see [`_template/`](_template/):

```
<modality>/
  engine/      Python: the science + its APIRouter
  gateway/     TypeScript: a declarative ModalityRouteSpec
  contract/    OpenAPI fragment
  narrative/   optional: LLM prompts + output schema
  workers/     optional: GPU deployment artifacts
```

Parts a modality does not need are simply absent.

## The rule

`platform/` may never import a modality, and no modality may import another.
Shared science is promoted to a substrate (`hakase_chemistry`,
`hakase_sequence`, `hakase_structure`) instead.

That is not a convention — `scripts/check_boundaries.py` enforces it in CI and
pre-commit. See [ARCHITECTURE.md](../ARCHITECTURE.md).

## Adding one

[CONTRIBUTING.md](../CONTRIBUTING.md) has the full walkthrough; the short version
is `cp -r _template <name>` and work the checklist in `_template/README.md`.
