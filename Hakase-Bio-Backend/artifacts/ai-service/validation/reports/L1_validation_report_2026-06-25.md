# Hakase L1 — Validation Report Card

**Generated:** 2026-06-25T23:31:49Z  
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

> **Honest reading.** The deterministic floor is built to be *specific*, not *sensitive*: most market withdrawals are cardiac/hepatic (hERG/DILI) liabilities that model-free chemistry cannot see. So a LOW false-halt rate on approved drugs here is the success signal, and the (expected) low recall on withdrawn is exactly why the calibrated ML safety stack exists — to be quantified in §2 once the ADMET-AI stack is online.

## 2. ML safety endpoints vs TDC test splits (AUROC + calibration + conformal veto)

Scored on the FROZEN TDC scaffold-split TEST sets (the published ADMET-AI hold-out) via the live ai-service. AUROC carries a 95% bootstrap CI; the conformal veto threshold is fit on half the negative (safe) class and FPR is the realised rate on the held-out half — a measured, distribution-free ≤α guarantee, not a hand-set cutoff.

### 2a. Binary endpoints — AUROC vs measured labels + conformal veto FPR

| Endpoint | n | AUROC (95% CI) | AUPRC | Brier | ECE | veto thr @α | mean FPR |
|---|---|---|---|---|---|---|---|
| hERG | 100 | **0.897** (0.816–0.963) | 0.962 | 0.097 | 0.061 | 0.940† | 0.0% |
| AMES | 100 | **0.938** (0.884–0.976) | 0.949 | 0.106 | 0.102 | 0.841† | 3.8% |
| DILI | 95 | **0.961** (0.920–0.989) | 0.966 | 0.084 | 0.110 | 0.693† | 4.1% |
| ClinTox | 100 | **0.989** (0.966–1.000) | 0.897 | 0.035 | 0.068 | 0.199† | 4.6% |
| Carcinogens | 56 | **0.905** (0.794–0.987) | 0.815 | 0.089 | 0.059 | 0.399† | 4.5% |
| BBB | 100 | **0.897** (0.814–0.963) | 0.960 | 0.101 | 0.080 | 0.966† | 0.0% |
| Pgp_inhibition | 100 | **0.942** (0.890–0.983) | 0.943 | 0.091 | 0.061 | 0.892† | 3.8% |
| Bioavailability | 100 | **0.824** (0.728–0.907) | 0.910 | 0.153 | 0.098 | 0.929† | 0.0% |
| CYP1A2 | 100 | **0.963** (0.923–0.995) | 0.945 | 0.072 | 0.082 | 0.785† | 3.7% |
| CYP2C9 | 100 | **0.933** (0.879–0.974) | 0.844 | 0.092 | 0.056 | 0.839† | 2.3% |
| CYP2C19 | 100 | **0.932** (0.876–0.972) | 0.867 | 0.106 | 0.093 | 0.856† | 3.2% |
| CYP2D6 | 100 | **0.935** (0.877–0.978) | 0.838 | 0.084 | 0.070 | 0.532† | 5.5% |
| CYP3A4 | 100 | **0.942** (0.890–0.982) | 0.888 | 0.101 | 0.130 | 0.759† | 3.1% |

### 2b. Regression endpoints — accuracy vs measured values

| Endpoint | n | R² (95% CI) | Spearman ρ | MAE | GMFE | within 2-fold | within 3-fold |
|---|---|---|---|---|---|---|---|
| Caco2 | 100 | **0.80** (0.72–0.85) | 0.89 | 0.27 | — | — | — |
| Lipophilicity | 100 | **0.91** (0.87–0.94) | 0.94 | 0.29 | — | — | — |
| Solubility | 100 | **0.91** (0.86–0.95) | 0.95 | 0.49 | — | — | — |
| PPB | 100 | **0.69** (0.45–0.84) | 0.81 | 5.01 | — | — | — |
| VDss | 100 | **-1.31** (-3.45–-0.23) | 0.57 | 3.91 | — | — | — |
| Clearance | 100 | **0.39** (0.16–0.57) | 0.71 | 26.10 | — | — | — |
| HalfLife | 100 | **0.62** (-0.30–0.94) | 0.35 | 29.14 | — | — | — |
| LD50 | 100 | **0.85** (0.78–0.89) | 0.89 | 0.29 | — | — | — |

> Binary veto thresholds are the measured replacements for the hand-set cutoffs in `l1Thresholds.json`; FPR is the mean over 200 leakage-free splits (`†` = <100 negatives → fit on the larger §1 approved set in production). Regression R² < 0 means the model is worse than predicting the mean for that endpoint — surface those as 'directional only' (matches the app's existing 'unreliable' tags for VDss / half-life).

Reproduce: start the ai-service with `STRICT_ML=1`, then re-run this script (TEST splits are already frozen in `validation/datasets/`; PyTDC is only a fallback). Each endpoint emits AUROC, AUPRC, Brier, and an ECE calibration figure against the TDC TEST split the models never trained on.

## 3. Conformal calibration — FPR-controlled veto thresholds

`models/conformal.py` provides `ConformalVetoGate`: the hard-veto threshold is the conformal (1−α) quantile of predicted scores on a held-out APPROVED set, so the veto's false-positive rate on approved drugs is provably ≤ α (Vovk; Lei 2018) — the principled replacement for the hand-set 0.92/0.88 cutoffs. Coverage & FPR guarantees are unit-tested in `validation/tests/run_tests.py` (empirical FPR 0.038 at α=0.05; interval coverage 90.9% at nominal 90% on real data).

To fit production thresholds: collect ADMET-AI scores over the approved hold-out (§1 set) and call `ConformalVetoGate.calibrate(approved_scores, alpha=0.05)` per endpoint; write the thresholds into `l1Thresholds.json`. This replaces the unrun defaults with measured, guaranteed numbers.

## 4. Methods

- Metrics (`validation/metrics.py`): numpy implementations unit-tested to match scikit-learn exactly.
- Conformal (`models/conformal.py`): split + Mondrian conformal prediction, distribution-free coverage.
- Hold-out (`validation/holdout.py`): live ChEMBL, dated snapshot for reproducibility (not an app cache).
- No value in this report is hand-entered; every number is computed from live data at run time.
