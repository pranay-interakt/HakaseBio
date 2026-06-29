# DrugCentral extracts (local-only)

The raw `drug.target.interaction.tsv[.gz]` is **not committed** — DrugCentral
is licensed CC BY-SA 4.0 and the project ships only the derived allow-list
(`src/lib/drugcentralValidatedTargets.ts`) with attribution.

## Regenerate the allow-list

```sh
curl -fsSL -o artifacts/hakase-ai/data/drugcentral/drug.target.interaction.tsv.gz \
  https://unmtid-dbs.net/download/DrugCentral/2021_09_01/drug.target.interaction.tsv.gz
gunzip -f artifacts/hakase-ai/data/drugcentral/drug.target.interaction.tsv.gz
pnpm --filter @workspace/hakase-ai run build:drugcentral
```

## Filter criteria (matches the wet-lab-verifiability invariant)

- `ORGANISM == "Homo sapiens"`
- Single-accession rows only (no complex/multi-target hits)
- `ACT_TYPE` ∈ {IC50, Ki, Kd, EC50, AC50, pIC50, pKi, pKd, pEC50}
- Numeric `ACT_VALUE`
- ≥5 qualifying rows per UniProt
