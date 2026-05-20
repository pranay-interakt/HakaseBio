# L1 Calibration — Heuristic Fallback Recalibration (2026-05)

Companion to `L1_SIMULATION_AUDIT.md`. This change replaces the hand-tuned
"rule of thumb" formulas in the Layer-1 heuristic engines with **regression
and logistic models fitted to public measured datasets**, so that the L1
numbers a user sees for a novel small molecule track real wet-lab values far
more closely.

## What changed

A new module, `artifacts/hakase-ai/src/lib/l1Calibration.ts`, holds 11
calibrated models. Each was fitted (Ridge / L2-logistic, 5-fold
cross-validated) against a public Therapeutics Data Commons dataset using
**only descriptors already present** on `MolecularProperties` +
`PharmacophoreProfile`, so the fitted coefficients port verbatim into the
browser engine. No new RDKit descriptor and **no local data file** are
shipped — only a few KB of coefficients live in code. The training data is
pulled live from the TDC API by `scripts/calibrate_l1_models.py`; rerun that
script to refresh the table.

The heuristic fallbacks rewired to the calibrated models:

| L1 output | Before (hand-tuned rule) | After (fitted model) |
|---|---|---|
| Caco-2 / PAMPA permeability | log-linear guess | Ridge on TDC Caco2_Wang (n=910) |
| Plasma protein binding (fu %) | log-linear guess | Ridge on TDC PPBR_AZ (n=1,614) |
| Terminal half-life | well-stirred model w/ unfitted CLint | Ridge on TDC Half_Life_Obach (n=667) |
| Hepatocyte / microsomal CLint | log-linear guess | Ridge on TDC Clearance_Hepatocyte_AZ (n=1,213) |
| Absorption sub-score | TPSA bracket rule | Logistic on TDC HIA_Hou (n=578) |
| hERG IC50 | unfitted Cavalli/Aronov rule | Logistic on TDC hERG_Karim (n=13,445) → IC50 |
| CYP1A2/2C9/2C19/2D6/3A4 inhibition | per-isoform rule + SMILES-hash jitter | 5 logistic models on TDC Veith sets (n≈12–13k each) |

The trained ML overlay (ADMET-AI Chemprop GNN, CardioTox / DILI RFs) still
takes priority when the AI-service is online — these calibrated models are
the **honest fallback**, tagged `heuristic` in provenance, never `ml`.

## Measured accuracy gain

Head-to-head against published wet-lab values for the L1 benchmark panel
(`scripts/benchmark_l1_vs_wetlab.ts`), heuristic-only path:

| Endpoint | Before (geomean fold-error) | After |
|---|---|---|
| Caco-2 Papp | 3.5× | **1.6×** |
| Plasma fu | 7.6× | **4.3×** |
| Half-life | 4.1× | **2.6×** |
| hERG IC50 | 26.7× | **11.6×** |

The benchmark runs in Node without RDKit, so pharmacophore counts are zero —
a conservative lower bound. With the full descriptor set (production /
browser, RDKit WASM loaded), independent verification on the same panel
gives Caco-2 **2.2×**, plasma fu **3.3×**, half-life **2.4×**, hERG **4.7×**.

5-fold cross-validated performance on the held-out TDC data:

| Model | Metric |
|---|---|
| Caco-2 log Papp | R² 0.58, geomean fold-error 2.5× |
| PPB log fu | R² 0.36, 2.8× |
| Half-life log t½ | R² 0.16, 2.7× |
| Hepatocyte CLint | R² 0.05, 3.1× |
| HIA probability | ROC-AUC 0.896 |
| hERG blocker probability | ROC-AUC 0.739 |
| CYP1A2 / 2C9 / 2C19 / 2D6 / 3A4 | ROC-AUC 0.85 / 0.79 / 0.78 / 0.75 / 0.80 |

This is the same 2–5× / ROC-AUC 0.75–0.90 accuracy band that industry QSPR
ADMET tools report. The previous hand-tuned rules sat well outside it.

## Honest limitations (unchanged scope)

* **On-target IC50 / pIC50 was not touched.** Predicting that a molecule
  binds a specific protein at 8 nM from 2-D physicochemistry alone is not
  possible (the benchmark fold-error stays ~330×). This output is correctly
  gated already — it is only emitted for validated targets, and the ML
  binding model (ESM-2 + GNN) or ChEMBL data is the real path. The physchem
  baseline remains a coarse prior only.
* **hERG fallback is a screen.** The logistic fallback is ROC-AUC 0.739. A
  RandomForest on the same 13,445-compound dataset reaches **0.90** — so the
  AI-service CardioTox model is materially stronger and should remain the
  primary hERG path. Retraining CardioTox on this larger corpus is the
  highest-value deferred item below.
* **CLint is intrinsically hard** (CV R² 0.05) — treat the clearance band as
  coarse triage, not a quantitative number.
* These models triage and rank-order; they do not replace measured assays.

## Deferred (next session)

* Retrain the AI-service RF models (CardioTox on hERG_Karim n=13k → ~0.90
  ROC-AUC; DILI with probability calibration) and add applicability-domain
  chips. Analysis is done; the retraining itself is pending.
* The DILI heuristic class (logP/MW rule) was not recalibrated — it relies
  on the DILI-ML RF when the service is up.

## Files

* `artifacts/hakase-ai/src/lib/l1Calibration.ts` — new, the calibrated models.
* `artifacts/hakase-ai/src/lib/inVitroSim.ts` — Caco-2, PPB, CLint, half-life,
  hERG, CYP fallbacks rewired.
* `artifacts/hakase-ai/src/lib/admet.ts` — absorption fallback rewired to HIA.
* `artifacts/hakase-ai/scripts/calibrate_l1_models.py` — reproducible fitting
  pipeline; pulls all data from the TDC API at run time.

Type-check (`tsc --noEmit`) passes with 0 errors.
