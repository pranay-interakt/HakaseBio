# Hakase safety verdict — scientific reasoning system

This documents the reasoning-and-verdict layer that makes every small-molecule safety
verdict Hakase produces **explainable with mathematics, code, real measured numbers, and
references**. It explains the implementation; the code is the source of truth.

- Verdict (unchanged): `models/safety_triage.py` → `POST /predict/safety-triage`
- **Reasoning envelope (new): `models/scientific_verdict.py` → `POST /predict/safety-triage/reasoning`**
- Provenance registry: `models/verdict_provenance.py`
- Data-derived applicability domain: `models/ad_threshold.py`
- Trust-layer algorithms: `models/reasoning/` (vendored from repo-root `reasoning-engine/`, 40 tests)
- Tests: `tests/test_scientific_verdict.py` (10) + reference suite `reasoning-engine/` (40)
- **Frontend surface (new):** `Hakase-Bio-Frontend/apps/hakase-ai/src/components/ScientificReasoningPanel.tsx`
  (a "Scientific basis" expander on the Safety tab of `MlAdmetCard.tsx`) + `predictSafetyTriageReasoning`
  in `lib/aiService.ts`. It shows the REAL measured reasoning per endpoint — calibration ECE(raw→cal) +
  AUROC, data-derived AD cutoff, per-compound shift p-value, explicit abstention, assumptions, and the
  count of heuristics still flagged. Honest by construction: renders "not available/abstains" rather than
  a fabricated number. Validated by the project `check` gate (tsc `--noEmit` 0 errors + terminology lint)
  and by confirming the endpoint payload survives the API `sanitize()` + JSON contract the panel consumes.

The reasoning endpoint is **additive** — it wraps the validated verdict without changing it,
and for the verdict plus every endpoint that fed it, answers the twelve questions below.

---

## 1. The twelve questions, and how each is answered (from the real pipeline)

`explain_verdict(smiles)` returns a `reasoning` block:

| Q | Question | Source (real, not fabricated) |
|---|---|---|
| 1 | Why this prediction? | triage tier + headline + per-endpoint signal |
| 2 | What evidence contributed? | SHAP drivers (`explain.py`), signals, consensus |
| 3 | Which models contributed? | per-endpoint method + dataset + version |
| 4 | How were conflicts reconciled? | deterministic tier rules + third-opinion agree/dissent + DILI fusion |
| 5 | What uncertainty exists? | **measured** held-out ECE / Brier / AUROC per endpoint bundle |
| 6 | What assumptions were made? | exchangeability, AD metric, cell-autonomy limit |
| 7 | What calibration supports the confidence? | calibration method + raw→calibrated ECE (from the bundle) |
| 8 | Within applicability domain? | data-derived Tanimoto cutoff (not the legacy 0.4) |
| 9 | Distribution shift present? | per-compound conformal p-value of nearest-training dissimilarity |
| 10 | Should Hakase abstain? | explicit abstain flag + reasons (AD / shift) |
| 11 | What experiment would reduce uncertainty? | the endpoint's confirmatory wet-lab assay |
| 12 | Justification for every internal number? | the provenance registry (definition + source + citation) |

Every number a user sees resolves, via `verdict_provenance.REGISTRY`, to a mathematical
definition, a source type, and a citation. **Nothing shown is a bare constant.**

---

## 2. Audit of the verdict pipeline — component by component

Each component evaluated against: (a) scientifically accepted? (b) published support?
(c) industry-standard / research / heuristic? (d) validatable? (e) stronger alternative?
(f) keep / improve / replace / remove. The machine-readable form is
`verdict_provenance.py`; `audit()` fails if any entry is unexplained.

| Component | Method | Accepted? | Literature | Kind | Validatable | Verdict |
|---|---|---|---|---|---|---|
| Conformal veto (hard ALERT) | (1-α) split-conformal quantile of approved-drug scores; α=0.05 | yes | Vovk 2005; Lei 2018 | industry+research | yes (FPR on approved hold-out) | **keep** |
| Sensitivity screen (WATCH) | Youden-J on ChEMBL approved/withdrawn | yes | Youden 1950 | industry | yes | **keep** |
| Probability calibration | isotonic / cross-fitted sigmoid; ECE/Brier stored | yes | Zadrozny-Elkan 2002; Guo 2017 | industry+research | yes (held-out ECE) | **keep** |
| Applicability domain | Tanimoto-to-training ≥ **0.4** | partially | Sahigara 2012 | **heuristic (fixed 0.4)** | yes | **replace → data-derived cutoff** |
| Tox21 escalation | require ≥2 in-domain flags of 12 | yes | FWER / Dunn 1961 | research | yes | **justified** |
| DILI mechanism fusion | QSAR (AD-gated) + reactive-metabolite alerts; corroborate ≥0.50 | yes | structural alerts; calibrated-prob boundary | research | yes | **justified** |
| Per-prediction "confidence" (in-vitro panel) | `1 − std/0.35`, `1 − (std/|mean|)/0.5` | **no** | none | **heuristic** | yes (audited: ECE 0.39–0.61) | **replace → calibrated reliability / abstain** |
| Scaffold split (all metrics) | Bemis-Murcko disjoint | yes | Bemis-Murcko 1996 | industry | yes | **keep** |
| Verdict reconciliation | deterministic worst-of tier, no composite score | yes | conservative decision rule | industry | yes (monotonicity tests) | **keep** |

**Headline findings.**
1. The **core safety verdict is scientifically sound** — properly calibrated probabilities
   (measured ECE), FPR-controlled conformal gates, AD gating, family-wise error control,
   honest OOD demotion, no fabricated composite score.
2. Three genuine heuristics remained, now identified and handled:
   - `AD_THRESHOLD = 0.4` (fixed Tanimoto) → **replaced** by a per-endpoint cutoff derived
     from the training set's own kNN-similarity distribution (`ad_threshold.py`, Sahigara
     2012). For hERG the derived cutoff is 0.388 — close to 0.4, so 0.4 was *roughly* right,
     but it is now **derived and reported with provenance** instead of asserted.
   - The two in-vitro-panel confidence maps → flagged `replace`; the reasoning layer uses a
     calibrated reliability or reports "not estimable". (Audit: `reasoning-engine/RESULTS.md`.)
3. A real **numerical bug** was fixed: `_ml_base.compute_ad` emitted spurious NumPy
   float32-matmul FPU warnings (`divide by zero / overflow / invalid`) on *every* verdict
   (numpy/numpy#24913). Wrapped in `np.errstate`; results unchanged, logs clean, so a
   genuine warning is never masked.

Nothing mock or fabricated was found in the verdict path: every "fallback" is the platform's
honest `ml_available=False` + explicit-error envelope, never invented numbers.

---

## 3. Scientific layers & algorithms (in `models/reasoning/`)

Pure-NumPy, no silent fallbacks; each carries its references in-source.

- **calibration.py** — reliability curve, ECE (equal-width + equal-mass), MCE, Brier +
  Murphy decomposition, isotonic (PAV), temperature. *Brier 1950; Murphy 1973; Naeini 2015;
  Guo 2017; Nixon 2019; Kumar 2019.* The instrument that measures whether a confidence is real.
- **reliability.py** — `CalibratedReliability`: isotonic map from an uncertainty signal to
  P(correct); **abstains** when unfit. *Zadrozny-Elkan 2002; Platt 1999.* Replaces the
  magic-constant confidence maps.
- **selective.py** — risk–coverage, AURC, Chow's rule, and a distribution-free **guaranteed**
  selective-risk threshold. *Chow 1970; El-Yaniv-Wiener 2010; Geifman-El-Yaniv 2017;
  Hoeffding 1963.* The rigorous "when to abstain".
- **ood.py** — PSI, effect-sized KS, conformal p-values → shift detection. *Vovk 2005;
  Tibshirani 2019; Gama 2014; Rabanser 2019.* Guards the exchangeability every guarantee needs.
- **evidence.py** — `EvidenceRecord` + abstain policy; composes the above into the
  twelve-question record.

---

## 4. Data used

All public, vendored under `hakase_smallmol/data/` (TDC tables) and trained bundles under
`cache/`:

- **hERG_Karim** (TDC) — hERG blocker classification (IC50 < 10 µM). Bundle: isotonic
  calibration, ECE_raw 0.091 → ECE_cal **0.025**, test AUROC **0.907**.
- **TDC DILI / DILIrank** — hepatotoxicity. Sigmoid-calibrated, ECE 0.167 → **0.105**,
  AUROC **0.906**. Fused with reactive-metabolite structural alerts.
- **Ames** (TDC) — bacterial mutagenicity. Isotonic, ECE 0.102 → **0.025**, AUROC **0.896**.
- **Tox21** 12-assay panel — nuclear-receptor + stress-response mechanistic signals.
- Applicability-domain and thresholds are learned from these same training sets; splits are
  Bemis-Murcko scaffold (leakage-free).

The confidence-audit harness (`reasoning-engine/experiments/audit_confidence.py`) trains on
Ames / Tox21 NR-ER under a scaffold split and measures everything on held-out novel scaffolds.

---

## 5. Validation (real, reproducible, honest)

- **Calibration is measured, not asserted.** Isotonic/sigmoid calibration reduces held-out
  ECE on all three core endpoints (e.g. hERG 0.091 → 0.025). These are the actual stored
  bundle diagnostics, surfaced in the reasoning trace.
- **The verdict behaves correctly on known compounds.** Astemizole (withdrawn hERG blocker)
  → **HIGH_RISK** (hERG in-domain, calibrated, p≈1.0) and the Ames call **abstains** because
  astemizole is out of the Ames applicability domain. Acetaminophen → **MONITOR** (reactive-
  metabolite DILI liability via mechanism fusion).
- **The audited heuristic confidence is provably miscalibrated** (ECE 0.39–0.61 on real
  Ames/Tox21) and the calibrated replacement cuts it ~10× (`reasoning-engine/RESULTS.md`);
  the distribution-free selective-risk certificate holds out-of-sample on Ames.
- **Structural audit passes:** `verdict_provenance.audit()` confirms every registered
  constant carries a definition, source, citation, status, limitation, and lists the three
  remaining heuristics (all flagged for replacement).
- Tests: `tests/test_scientific_verdict.py` (10) + `reasoning-engine/` reference suite (40),
  all green.

---

## 6. Limitations (stated up front)

- **Cellular, not clinical.** These endpoints predict molecular/cellular liabilities, not a
  patient outcome; the PK / inter-organ bridge is out of scope. The verdict is decision
  support, not a regulatory or clinical determination.
- **Immune-mediated idiosyncratic DILI (HLA-restricted) is out of reach** of any single-
  structure model — QSAR or DSM. Stated as an explicit assumption on every DILI record.
- **Calibration and conformal guarantees are marginal and assume exchangeability.** Under
  covariate shift they degrade; the per-compound shift signal flags this but does not repair
  it (weighted conformal, Tibshirani 2019, is future work — and its reweighting is itself
  hard to validate on high-dimensional fingerprints).
- **ECE is a biased, binning-dependent estimator** (Kumar 2019); reported alongside Brier.
- **The in-vitro-panel confidence replacement is designed, not yet wired into that endpoint**
  — it needs a per-endpoint held-out (dispersion, correctness) sample provisioned in the
  bundle. Until then the honest output is "not estimable". Same gated ethos as the rest of
  the stack.
- **Two pre-existing tests in `tests/test_verdict_consolidation.py`** (`test_status_declares
  _no_disk_state`, `test_threshold_fallback_is_honest`) fail due to `live_calibration`
  test/environment drift unrelated to this work (fitted artifacts present; `status()` schema
  changed). Not introduced here; flagged, not silently touched.

---

## 7. What is deliberately NOT claimed

- No novel algorithm is claimed; every method is standard and cited.
- DSM is **not** part of this verdict (shelved; see `research/` and `dsm-engine/`). It was
  not preserved out of attachment — the evidence pointed to calibration/abstention as the
  higher-value, validatable-now work.
- Integration of the reasoning envelope into the frontend and the swap of the in-vitro-panel
  confidence are **gated** on review + provisioning, matching how MC-DC and DSM are gated.
