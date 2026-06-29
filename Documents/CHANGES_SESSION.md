# Hakase BioTwin — Session Changes Log
Date: 2026-06-13

---

## 1. Wired ML Scorecards into Display Panels

**PeptideAnalysisPanel.tsx**
- Added `l1Scorecard?: PeptideScorecard | null` prop
- Verdict, score, confidence, and flags now prefer the ML scorecard when available; fall back to heuristic with "ML loading…" text
- Hemolysis risk prefers HemoPI-2 ML probability when available
- Fixed flag access: `.label` / `.rationale` (not `.message`)
- Fixed confidence label: `"Moderate"` (not `"Medium"`)

**AntibodyAnalysisPanel.tsx**
- Added `l1Scorecard?: AntibodyScorecard | null` prop
- Verdict display shows ML L1 score, confidence chip, and flag label when scorecard is available
- Fixed `AntibodyFlag.label` (not `.message`)

**HakaseAI.tsx**
- Passed `l1Scorecard={peptideScorecard}` and `l1Scorecard={antibodyScorecard}` to respective panels
- Added `setPeptideScorecard(null)` / `setAntibodyScorecard(null)` in onClear handlers

---

## 2. Fixed Double Verdict Banner (Small Molecule)

**HakaseAI.tsx**
- Replaced the two stacked verdict blocks (heuristic card + separate `{l1Scorecard && ...}` block) with a single merged card
- Single card: shows ML data when scorecard is present; shows heuristic score with "ML loading…" when not
- Fixed `confidenceLabel === "Medium"` → `confidenceLabel === "Moderate"` (type mismatch)

---

## 3. Fixed peptideL1Scorecard.ts — Wrong Field Names

**peptideL1Scorecard.ts**
- `dimAggregation`: parameter renamed to `agg`, uses `agg.risk` (not `biophys.aggregation_risk`)
- `dimSolubility`: parameter renamed to `sol`, uses `sol.solubility_class` (not `aqueous_solubility`)
- `dimDevelopability`: replaced `dev/chem` params with correct `chem: PeptideResult["chemical_liabilities"]` and `syn: PeptideResult["synthesis"]`; synthesis feasibility now checks `syn.difficulty_class`; chemical liabilities severity uses `chem.liabilities[].severity`
- `dimHalfLife`: replaced non-existent `hl.plasma_half_life_min` with string parsing from `hl.plasma_h` (e.g., "2.5 h" → 150 min)
- Fixed `immuno?.candidate_agretope_windows` → `immuno?.candidate_epitope_windows`
- `buildFlags()` and `computePeptideL1Scorecard()` updated to use all corrected field names

---

## 4. Fixed antibodyL1Scorecard.ts — Operator Precedence Bug

**antibodyL1Scorecard.ts**
- Line 353: fixed `chains[0] && (chains[0] as any).immunogenicity?.band ?? ""` → `((chains[0] as any)?.immunogenicity?.band) ?? ""`
- The `&&` / `??` precedence was causing the regex test to always receive `""` regardless of actual chain data

---

## 5. Fixed SMILES Non-Determinism — Different SMILES → Different Verdict

**dili_ml.py**
- Added `_canonicalize(smiles)` function using RDKit `MolToSmiles(canonical=True)`
- `_featurize()` now re-parses mol from canonical SMILES before computing Morgan fingerprints
- `predict_dili_ml()` canonicalizes SMILES at entry point
- `_train()` sorts training rows by canonical SMILES before fitting (eliminates TDC data-order non-determinism)
- Changed `n_jobs=-1` → `n_jobs=1` (parallel RF thread scheduling is non-deterministic even with `random_state=42`)
- Bumped `MODEL_VERSION = "1.2.0"` to force cache invalidation and retrain with deterministic settings

**cardiotox.py**
- Same pattern: `_canonicalize()`, canonicalize in `_featurize()` and `predict_cardiotox()`, sort training data, `n_jobs=1`, `MODEL_VERSION = "1.2.0"`

**admet_ml.py**
- Added RDKit canonicalization block at top of `predict_admet_ml()` before passing to Chemprop

---

## 6. Fixed Caco-2 Unit Conversion Bug

**mlOverlay.ts**
- **Bug**: ADMET-AI's `Caco2_Wang` returns log₁₀(Papp cm/s) (e.g., −4.7 for a permeable drug). The overlay was storing this raw log value in `caco2_Papp_1e6_cm_s` (expected in 10⁻⁶ cm/s). The simulation clamped −4.7 to the minimum of 0.05, displaying as 0.1 ×10⁻⁶ cm/s instead of the correct ~20 ×10⁻⁶.
- **Fix**: `caco2_Papp_1e6_cm_s = Math.pow(10, caco2Log + 6)` — converts log₁₀(cm/s) → linear 10⁻⁶ cm/s, matching the conversion the heuristic (`l1Calibration.ts`) already applied
- Updated field JSDoc to reflect correct units and conversion

---

## Summary of Why These Fixes Matter

- **SMILES canonicalization**: two valid SMILES for the same molecule (e.g., acetaminophen as `CC(=O)Nc1ccc(O)cc1` and `Oc1ccc(NC(C)=O)cc1`) now produce identical ML predictions and identical L1 verdicts
- **Training non-determinism**: same molecule now gives the same verdict on every run, not just every other run
- **Caco-2 unit fix**: ML-enriched Caco-2 values now show physiologically realistic values (5–50 ×10⁻⁶ cm/s for drug-like molecules) instead of always clamping to 0.05
- **Panel wiring**: ML scorecard data now actually appears in the UI verdict cards for peptides and antibodies

All changes compile with zero TypeScript errors (`tsc --noEmit` exit 0). Python syntax verified via `ast.parse()`.
