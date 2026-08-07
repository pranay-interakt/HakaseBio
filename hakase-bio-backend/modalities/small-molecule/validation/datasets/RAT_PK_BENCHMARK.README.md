# Rat PK benchmark — schema & provenance (S2-T5 validation gate)

`rat_pk_benchmark.csv` is the held-out set the PBPK exposure gate is scored on.
It is currently **header-only**: the gate cannot pass until it is populated with
**real, cited** rat data. The harness refuses to fabricate, so an empty file
makes `run_pbpk_validation.py` stop with an actionable error rather than invent
numbers.

The previous 5-row file was hand-typed and internally inconsistent (its own
`auc_ng_h_ml` ≠ dose / `cl_ml_min_kg`); it is preserved, unused, as
`_UNVERIFIED_synthetic_rat_pk.csv.quarantine`. **Do not** feed it to the gate.

## Columns

| column | units | required | meaning |
|---|---|---|---|
| `compound_name` | — | yes | label only |
| `smiles` | — | yes | canonicalised on load; salts are stripped to parent |
| `route` | — | yes | `iv` (the current pipeline models an IV bolus) |
| `dose_mg_kg` | mg/kg | yes | dose used in the cited in-vivo study |
| `fu_plasma` | fraction (0–1) | **yes\*** | measured rat fraction unbound in plasma |
| `clint_hep_ul_min_1e6` | µL/min/10⁶ hepatocytes | **yes\*** | measured rat hepatocyte intrinsic clearance |
| `blood_plasma_ratio` | ratio | no | measured rat blood:plasma ratio (defaults to model value) |
| `vdss_l_per_kg` | L/kg | no | measured steady-state volume (improves the fit) |
| `cmax_ng_ml` | ng/mL | one-of | observed in-vivo peak plasma conc. |
| `auc_ng_h_ml` | ng·h/mL | one-of | observed in-vivo AUC |
| `cl_ml_min_kg` | mL/min/kg | one-of | observed in-vivo systemic clearance |
| `source` | — | yes | short citation (author, year) |
| `reference_doi` | — | yes | DOI / URL the values were read from |
| `notes` | — | no | caveats (strain, salt form, assay) |

\* `clint_hep_ul_min_1e6` **and** `fu_plasma` are the two hard-required model
inputs. A row missing either is **skipped** (never back-filled with a shared
constant). At least one in-vivo endpoint column must be present for the row to
be scored; endpoints are scored independently, so a drug with a published `CL`
but no `Cmax` still contributes to the `CL` metric.

## Why this is the blocker

The scarce quantity is **rat hepatocyte CLint**: it lives in paywalled IVIVE
tables, not in machine-readable open form, and it is exactly the input the
pipeline cannot run without. Web search returns either CLint for environmental
chemicals (no in-vivo PK) or in-vivo CL/Vss for drugs (no CLint) — rarely the
same compound. Two clean unlocks:

1. **A curated extract** with per-compound rat CLint + fu + an in-vivo endpoint
   (the ChEMBL animal-PK / PK-DB route the spec names). Drop it in with the
   columns above.
2. **Restore ML ADMET** so CLint/fu are predicted per compound
   (`admet_regression/model_4.pt` is currently a git-LFS pointer, so the
   ensemble fails to load and the ML path is dead — `git lfs pull` that one
   file). Then only the in-vivo endpoints need sourcing, and rat CL/Vss are far
   more available.

## Candidate open sources (need extraction / QC before use)

- **EPA CvTdb** — rat in-vivo concentration-time series + NCA parameters, openly
  downloadable. Environmental chemicals, so pair with in-vitro data separately.
  GitHub: USEPA/CompTox-PK-CvTdb · Sayre, Wambaugh & Grulke, *Sci Data* 2020,
  doi:10.1038/s41597-020-0455-1 · Zenodo doi:10.23645/epacomptox.29610452.v1
- **httk** R package — `chem.physical_and_invitro.data` carries rat `Clint` and
  `Funbound.plasma` with per-value references (open, CRAN/GitHub).
- **Sohlenius-Sternbeck et al.**, *Xenobiotica* 2012;42:841-853,
  doi:10.3109/00498254.2012.669080 — rat hepatocyte CLint + in-vivo CL for a
  drug panel (paywalled table; needs licensed access).

## Unit conventions (must match, or the gate is meaningless)

The cohort ODE runs in mg / L / min; the harness converts predictions into the
benchmark units above before scoring (see `run_pbpk_validation.py`:
`_endpoint_in_benchmark_units`). Supply observed values in the table's units
exactly.
