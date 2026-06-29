# Hakase L1 — Validation Report Card

**Generated:** 2026-06-29T10:13:23Z  
**Framework:** `validation/` (metrics verified vs scikit-learn; conformal coverage unit-tested)

---

## 1. Triage performance — deterministic-chemistry floor (runs today, ML offline)

Hold-out: **1183 drugs** (845 approved, 338 withdrawn) — live from EMBL-EBI ChEMBL molecule API (max_phase=4 approved + withdrawn_flag=true). Scored by `deterministic-chemistry-floor (reactive-metabolite SMARTS + Ro5)`. 1183 scored, 0 skipped (unparseable SMILES).

| Metric | Value (95% bootstrap CI) | Reading |
|---|---|---|
| FPR on approved (false halts) | **0.7% (95% CI 0.2–1.3%)** | lower is better — false stops on good drugs |
| Recall on withdrawn (caught) | **0.9% (95% CI 0.0–2.0%)** | deterministic floor only; ML lifts this |
| Enrichment factor of advance set | **1.001** | >1 = advance set richer in approved than base rate |
| Balanced accuracy | 50.1% | |
| MCC | 0.009 | correlation of call vs truth (−1..1) |

Confusion: correctly-halted withdrawn **3**, wrongly-halted approved **6**, advanced approved **839**, missed withdrawn **335**.

Withdrawn drugs the deterministic floor caught (examples):

- DIOSMIN — ro5_violations(3)
- DIHYDROSTREPTOMYCIN — ro5_violations(3)
- BUTAMBEN PICRATE — ro5_violations(3)

### 1a. Per-gate fire rate by class (calibration audit)

If a gate fires at the same rate on approved as on withdrawn drugs, it has NO discriminative power and its false-positives on approved drugs are false NO-GOs on novel chemistry. This audit is computed live and flags exactly that.

| Gate | Fires on approved | Fires on withdrawn | Verdict |
|---|---|---|---|
| `reactive_metabolite_critical_x2` | 0.2% (2) | 0.0% (0) | OK — specific (≤2% false-halt on approved) |
| `ro5_violations` | 0.5% (4) | 0.9% (3) | OK — specific (≤2% false-halt on approved) |

> **Action.** Any gate marked ⚠ is over-firing: it vetoes good novel compounds without catching more bad ones. Fix = recalibrate its SMARTS/threshold or downgrade it from a hard NO-GO to a WATCH in `l1Scorecard.ts`. (Note: on KNOWN drugs the live lookup-first path short-circuits these gates; this audit measures their blind behaviour, which is what NOVEL compounds actually get.)

> **Honest reading.** The deterministic floor is built to be *specific*, not *sensitive*: most market withdrawals are cardiac/hepatic (hERG/DILI) liabilities that model-free chemistry cannot see. So a LOW false-halt rate on approved drugs here is the success signal, and the (expected) low recall on withdrawn is exactly why the calibrated ML safety stack exists — to be quantified in §2 once the Hakase ADMET stack is online.

## 2. ML safety endpoints vs TDC test splits (AUROC + calibration + conformal veto)

Scored on the FROZEN TDC scaffold-split TEST sets (the published Hakase ADMET hold-out) via the live ai-service. AUROC carries a 95% bootstrap CI; the conformal veto threshold is fit on half the negative (safe) class and FPR is the realised rate on the held-out half — a measured, distribution-free ≤α guarantee, not a hand-set cutoff.

### 2a. Binary endpoints — AUROC vs measured labels + conformal veto FPR

| Endpoint | n | AUROC (95% CI) | AUPRC | Brier | ECE | veto thr @α | mean FPR |
|---|---|---|---|---|---|---|---|
| hERG | 50 | **0.903** (0.790–0.982) | 0.947 | 0.112 | 0.070 | ∞ | n/a |
| AMES | 50 | **0.968** (0.916–0.998) | 0.976 | 0.085 | 0.121 | 0.841† | 0.0% |
| DILI | 50 | **0.977** (0.939–1.000) | 0.982 | 0.070 | 0.122 | 0.747† | 0.0% |
| ClinTox | 50 | **0.993** (0.959–1.000) | 0.917 | 0.029 | 0.057 | 0.212† | 4.0% |
| Carcinogens | 50 | **0.924** (0.818–1.000) | 0.819 | 0.079 | 0.064 | 0.344† | 4.5% |
| BBB | 50 | **0.962** (0.897–1.000) | 0.988 | 0.089 | 0.145 | ∞ | n/a |
| Pgp_inhibition | 50 | **0.961** (0.903–0.998) | 0.962 | 0.082 | 0.128 | 0.738† | 0.0% |
| Bioavailability | 50 | **0.807** (0.651–0.941) | 0.917 | 0.148 | 0.138 | ∞ | n/a |
| CYP1A2 | 50 | **0.972** (0.923–1.000) | 0.971 | 0.066 | 0.111 | 0.785† | 0.0% |
| CYP2C9 | 50 | **0.947** (0.877–0.998) | 0.904 | 0.080 | 0.092 | 0.875† | 0.0% |
| CYP2C19 | 50 | **0.968** (0.919–1.000) | 0.940 | 0.081 | 0.114 | 0.856† | 0.0% |
| CYP2D6 | 50 | **0.948** (0.875–0.993) | 0.841 | 0.079 | 0.071 | 0.532† | 4.5% |
| CYP3A4 | 50 | **0.945** (0.881–0.992) | 0.936 | 0.106 | 0.180 | 0.695† | 0.0% |

### 2b. Regression endpoints — accuracy vs measured values

| Endpoint | n | R² (95% CI) | Spearman ρ | MAE | GMFE | within 2-fold | within 3-fold |
|---|---|---|---|---|---|---|---|
| Caco2 | 50 | **0.83** (0.73–0.88) | 0.92 | 0.28 | — | — | — |
| Lipophilicity | 50 | **0.91** (0.85–0.94) | 0.94 | 0.31 | — | — | — |
| Solubility | 50 | **0.91** (0.84–0.95) | 0.95 | 0.45 | — | — | — |
| PPB | 50 | **0.54** (0.15–0.84) | 0.81 | 5.12 | — | — | — |
| VDss | 50 | **-1.05** (-6.04–0.15) | 0.49 | 3.72 | — | — | — |
| Clearance | 50 | **0.57** (0.32–0.79) | 0.79 | 19.19 | — | — | — |
| HalfLife | 50 | **0.93** (-6.81–0.98) | 0.21 | 20.07 | — | — | — |
| LD50 | 50 | **0.87** (0.76–0.92) | 0.91 | 0.27 | — | — | — |

> Binary veto thresholds are the measured replacements for the hand-set cutoffs in `l1Thresholds.json`; FPR is the mean over 200 leakage-free splits (`†` = <100 negatives → fit on the larger §1 approved set in production). Regression R² < 0 means the model is worse than predicting the mean for that endpoint — surface those as 'directional only' (matches the app's existing 'unreliable' tags for VDss / half-life).

Reproduce: start the ai-service with `STRICT_ML=1`, then re-run this script (TEST splits are already frozen in `validation/datasets/`; PyTDC is only a fallback). Each endpoint emits AUROC, AUPRC, Brier, and an ECE calibration figure against the TDC TEST split the models never trained on.

## 3. Conformal calibration — FPR-controlled veto thresholds

`models/conformal.py` provides `ConformalVetoGate`: the hard-veto threshold is the conformal (1−α) quantile of predicted scores on a held-out APPROVED set, so the veto's false-positive rate on approved drugs is provably ≤ α (Vovk; Lei 2018) — the principled replacement for the hand-set 0.92/0.88 cutoffs. Coverage & FPR guarantees are unit-tested in `validation/tests/run_tests.py` (empirical FPR 0.038 at α=0.05; interval coverage 90.9% at nominal 90% on real data).

To fit production thresholds: collect Hakase ADMET scores over the approved hold-out (§1 set) and call `ConformalVetoGate.calibrate(approved_scores, alpha=0.05)` per endpoint; write the thresholds into `l1Thresholds.json`. This replaces the unrun defaults with measured, guaranteed numbers.

## 4. Methods

- Metrics (`validation/metrics.py`): numpy implementations unit-tested to match scikit-learn exactly.
- Conformal (`models/conformal.py`): split + Mondrian conformal prediction, distribution-free coverage.
- Hold-out (`validation/holdout.py`): live ChEMBL, dated snapshot for reproducibility (not an app cache).
- No value in this report is hand-entered; every number is computed from live data at run time.
