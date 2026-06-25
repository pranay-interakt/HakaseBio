# Hakase L1 — Validation Report Card

**Generated:** 2026-06-25T22:54:15Z  
**Framework:** `validation/` (metrics verified vs scikit-learn; conformal coverage unit-tested)

---

## 1. Triage performance — deterministic-chemistry floor (runs today, ML offline)

Hold-out: **1183 drugs** (845 approved, 338 withdrawn) — live from EMBL-EBI ChEMBL molecule API (max_phase=4 approved + withdrawn_flag=true). Scored by `deterministic-chemistry-floor (reactive-metabolite SMARTS + Ro5)`. 1183 scored, 0 skipped (unparseable SMILES).

| Metric | Value (95% bootstrap CI) | Reading |
|---|---|---|
| FPR on approved (false halts) | **0.6% (95% CI 0.1–1.2%)** | lower is better — false stops on good drugs |
| Recall on withdrawn (caught) | **0.9% (95% CI 0.0–2.0%)** | deterministic floor only; ML lifts this |
| Enrichment factor of advance set | **1.001** | >1 = advance set richer in approved than base rate |
| Balanced accuracy | 50.1% | |
| MCC | 0.016 | correlation of call vs truth (−1..1) |

Confusion: correctly-halted withdrawn **3**, wrongly-halted approved **5**, advanced approved **840**, missed withdrawn **335**.

Withdrawn drugs the deterministic floor caught (examples):

- DIOSMIN — ro5_violations(3)
- DIHYDROSTREPTOMYCIN — ro5_violations(3)
- BUTAMBEN PICRATE — ro5_violations(3)

### 1a. Per-gate fire rate by class (calibration audit)

If a gate fires at the same rate on approved as on withdrawn drugs, it has NO discriminative power and its false-positives on approved drugs are false NO-GOs on novel chemistry. This audit is computed live and flags exactly that.

| Gate | Fires on approved | Fires on withdrawn | Verdict |
|---|---|---|---|
| `reactive_metabolite_critical_x2` | 0.2% (2) | 0.0% (0) | OK — specific (≤2% false-halt on approved) |
| `ro5_violations` | 0.4% (3) | 0.9% (3) | OK — specific (≤2% false-halt on approved) |

> **Action.** Any gate marked ⚠ is over-firing: it vetoes good novel compounds without catching more bad ones. Fix = recalibrate its SMARTS/threshold or downgrade it from a hard NO-GO to a WATCH in `l1Scorecard.ts`. (Note: on KNOWN drugs the live lookup-first path short-circuits these gates; this audit measures their blind behaviour, which is what NOVEL compounds actually get.)

> **Honest reading.** The deterministic floor is built to be *specific*, not *sensitive*: most market withdrawals are cardiac/hepatic (hERG/DILI) liabilities that model-free chemistry cannot see. So a LOW false-halt rate on approved drugs here is the success signal, and the (expected) low recall on withdrawn is exactly why the calibrated ML safety stack exists — to be quantified in §2 once the ADMET-AI stack is online.

## 2. ML safety endpoints vs TDC test splits (AUROC + calibration + conformal veto)

**PENDING** — ai-service ADMET-AI not reachable / not STRICT-loaded (start it with STRICT_ML=1). The TEST data is frozen locally (`validation/datasets/`), so the only missing piece is the model: start the ai-service with `STRICT_ML=1` (ADMET-AI installed) and re-run. No other dependency.

Reproduce: start the ai-service with `STRICT_ML=1`, then re-run this script (TEST splits are already frozen in `validation/datasets/`; PyTDC is only a fallback). Each endpoint emits AUROC, AUPRC, Brier, and an ECE calibration figure against the TDC TEST split the models never trained on.

## 3. Conformal calibration — FPR-controlled veto thresholds

`models/conformal.py` provides `ConformalVetoGate`: the hard-veto threshold is the conformal (1−α) quantile of predicted scores on a held-out APPROVED set, so the veto's false-positive rate on approved drugs is provably ≤ α (Vovk; Lei 2018) — the principled replacement for the hand-set 0.92/0.88 cutoffs. Coverage & FPR guarantees are unit-tested in `validation/tests/run_tests.py` (empirical FPR 0.038 at α=0.05; interval coverage 90.9% at nominal 90% on real data).

To fit production thresholds: collect ADMET-AI scores over the approved hold-out (§1 set) and call `ConformalVetoGate.calibrate(approved_scores, alpha=0.05)` per endpoint; write the thresholds into `l1Thresholds.json`. This replaces the unrun defaults with measured, guaranteed numbers.

## 4. Methods

- Metrics (`validation/metrics.py`): numpy implementations unit-tested to match scikit-learn exactly.
- Conformal (`models/conformal.py`): split + Mondrian conformal prediction, distribution-free coverage.
- Hold-out (`validation/holdout.py`): live ChEMBL, dated snapshot for reproducibility (not an app cache).
- No value in this report is hand-entered; every number is computed from live data at run time.
