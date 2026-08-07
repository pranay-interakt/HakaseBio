# Small molecule

SMILES-based compounds. The largest vertical — most of the service's endpoints
belong to it.

## Layout

```
engine/    hakase_smallmol — admet · tox(safety) · pk_ivive · binding · cardiotox · dili
           vendor/hakase_admet — vendored Chemprop-RDKit ensemble + weights (LFS)
gateway/   route spec (~28 POST + GET paths under /ai/*)
contract/  OpenAPI fragment
validation/ holdout harness, TDC datasets, reports, verdict snapshots
data/      24 vendored TDC .tab training corpora
workers/fep-ties/  RunPod GPU worker — TIES/FEP free energy + Vina docking
```

## Substrates used

`hakase_kernel` · `hakase_chemistry` (RDKit/SMILES) · `hakase_structure`
(docking).

## Notes

**The vendored ADMET engine** (`engine/src/hakase_smallmol/vendor/hakase_admet/`)
ships its own Chemprop v2 weights. It uses relative imports so it stays
self-contained; do not convert them to absolute paths. Weights are Git LFS.

**Validation is version-controlled.** `validation/snapshots/` holds verdict
holdout results. Run `validation/run_validation.py` before and after any change
to model logic and diff the snapshot — numerical drift should be a deliberate,
reviewed change, never a side effect.

**Data files are fixed-width.** The TDC `.tab` corpora must never be touched by
whitespace-stripping tooling; they are excluded in `.pre-commit-config.yaml` and
marked `-text` in `.gitattributes`.
