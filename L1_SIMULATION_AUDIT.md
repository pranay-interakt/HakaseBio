# L1 Dashboard — Provenance Audit (heuristic engines + real ML pipeline)

> **Scope correction (2026-05-12).** An earlier revision of this document framed the L1 dashboard as a "two-engine" system and detailed only the heuristic engines (`admet.ts`, `inVitroSim.ts`). That framing was incomplete and misleading: the dashboard *also* runs a **real ML pipeline** of six independently-trained models served from `artifacts/ai-service/` and consumed in L1 (additional ML models exist for L3 — `celltype_aggregation.py`, `patient_line.py` — and are out of scope here). The L1 ML models produce the numbers visible in the "ML-Enhanced ADMET", "All ML Endpoints by Bucket", "hERG paired prediction", and solubility-paired panels. Sections 0 and 0.5 below describe **all three** pipelines; sections §1–§9 audit only the heuristic engines (their original scope) and should be read as such.

**Test molecule for cross-check:** α-tocopherol-fragment (chromanol head)
SMILES: `OC1=C(C)C(CCC(C)(C)O2)=C2C(C)=C1C`
Note: the chromanol fragment of vitamin E. No phytyl tail. Antioxidant pharmacophore — does **not** match any kinase / GPCR / NR / ion-channel target in the in-app catalog.

---

## 0. The three-pipeline reality (read this first)

The L1 panel renders state from **three independent pipelines** that run on a `runSimulation()` click. Most panels show numbers from one pipeline; several panels (notably "ML-Enhanced ADMET", paired hERG, paired solubility, paired DILI) show **two** pipelines' answers side-by-side so the user can see agreement or divergence.

| # | Pipeline | Producer | Source | Nature | What it feeds in the L1 UI |
|---|----|----|----|----|----|
| 1 | Heuristic ADMET | `runAdmetSimulation()` | `lib/admet.ts` | **Rule-based** (RDKit descriptors → hand-tuned brackets + seeded jitter) | "Confidence Score", **rule-based column** of MlAdmetCard, L1→L2 Cascade Preview, Recommendations block, Lipinski badge, target binding Kd/Ki/IC50, organ risks, similar drugs |
| 2 | Heuristic In-Vitro | `runInVitroSimulation()` | `lib/inVitroSim.ts` | **Rule-based** (descriptor regressions + seeded jitter) | Go/No-Go badge, "In Vitro Score", key-metrics strip (IC50, Caco-2, CLint, fu%, hERG IC50, TI), Dose-Response / Permeability / Clearance / Safety / Selectivity tabs, CYP panel, Bioactivation card |
| 3 | **Real ML services** (six L1 models) | FastAPI service on `:8090`, called from `lib/aiService.ts` | `artifacts/ai-service/models/*.py` | **Trained ML models** (Chemprop GNN, Random Forests, Gradient Boosting, ESM-2 + LR) | **ML column** of MlAdmetCard, "All ML Endpoints by Bucket" panel (curated `KEY_ENDPOINTS` subset, not all raw model outputs), paired hERG card (ADMET-AI + CardioTox), paired solubility, ML binding affinity panel, ML-druggability second opinion. DILI-ML feeds the cascade-gate ML override and L3 Stage 2 — there is no L1 paired DILI card. |

The Go/No-Go **badge** ("GO / WATCH / NO-GO") comes from `inVitroResults.overallRisk` (pipeline 2), while the **cascade preview** "Go/No-Go" line and several recommendations come from `simResults.goNogo` (pipeline 1). These can give different verdicts because they use different scoring (see §6). The cascade gate (`lib/cascadeGate.ts`) tags every output with a quality tier — `heuristic` (0.5) for pipelines 1–2, `ml` (0.7) for pipeline 3 — and blocks auto-advance when too many safety-critical signals are heuristic-only.

---

## 0.5. Real ML pipeline — what it is, what it feeds (NOT heuristic)

All six models are trained ML, not rule-based. Each one was deliberately built to be **methodologically independent** of the heuristic engine it second-opinions: different training data, different feature representation, different algorithm class. Every model returns a `source: "ml" | "fallback"` envelope so the UI can never confuse a real prediction with a degraded fallback.

| # | Model (UI label) | File | Training data | Features | Algorithm | Endpoints / output | UI surfaces |
|---|---|---|---|---|---|---|---|
| 1 | **ADMET-AI v2** (Chemprop-RDKit GNN ensemble) | `models/admet_ml.py` | TDC ADMET benchmark (41 endpoints, ~tens of thousands of compounds across HIA_Hou, BBB_Martins, CYP*_Veith, hERG_Karim, AMES, DILI, ClinTox, Carcinogens_Lagunin, Skin_Reaction, Caco2_Wang, Lipophilicity_AstraZeneca, Solubility_AqSolDB, Bioavailability_Ma, Pgp_Broccatelli, PPBR_AZ, VDss_Lombardo, Clearance_Hepatocyte_AZ, Half_Life_Obach, LD50_Zhu, …) | Learned graph embeddings (Chemprop directed-MPNN) + RDKit physchem descriptors | Chemprop-RDKit **GNN ensemble** | 41 endpoints + ~60 physchem ⇒ ~104 numeric values, of which a **curated `KEY_ENDPOINTS` subset** (defined in `admet_ml.py`) is grouped into 5 buckets (absorption / distribution / metabolism / excretion / toxicity) for the UI | "ML-Enhanced ADMET" header label, **ML column** of the 5-axis comparison (numbers derived in `MlAdmetCard.tsx::mlAxisScore`: HIA_Hou for absorption, BBB_Martins for distribution, mean(CYP*_Veith) for metabolism, Clearance_Hepatocyte_AZ for excretion, mean(critical safety probs) for toxicity), Critical Safety Endpoints panel, "All ML Endpoints by Bucket" expandable panel (renders the curated `structured` view, not all raw model outputs), ADMET-AI side of the paired hERG card |
| 2 | **CardioTox v1** (Random Forest on Morgan FP + RDKit) | `models/cardiotox.py` | TDC `hERG` / Wang et al. (n=655, binary IC50<10 µM) — **distinct corpus** from ADMET-AI's hERG_Karim (~13k, different curation) | 1024-bit Morgan circular fingerprint (radius 2) + 7 RDKit scalar descriptors (MolWt, MolLogP, TPSA, HBD, HBA, FractionCSP3, BasicN) | **Random Forest classifier** (sklearn) | hERG blocker probability + qualitative class (Low/Moderate/High) + IC50 band; reports 5-fold CV ROC-AUC mean ± std | CardioTox side of the paired hERG card; consensus badge (Consensus / Aligned / Divergent) computed against ADMET-AI's hERG_Karim |
| 3 | **Solubility-ML** (RF on Morgan FP + 9 RDKit descriptors) | `models/solubility_ml.py` | ~135 curated compounds with measured aqueous logS (Delaney 2004 + DrugBank + standard pharma references) — **no overlap** with closed-form ESOL coefficients | 1024-bit Morgan FP (r=2) + 9 RDKit physchem descriptors | **Random Forest Regressor** | Continuous logS + 4-class label (Highly soluble / Soluble / Slightly soluble / Insoluble) | Paired-view solubility tile (ML side vs ESOL rule-based side) |
| 4 | **DILI-ML** (RF on Morgan FP + 6 RDKit descriptors) | `models/dili_ml.py` | TDC `DILI` / Xu et al. 2015 (n=475, binary DILI-positive/negative from FDA orange-box drug labels, CC-BY 4.0) | 1024-bit Morgan FP (r=2) + 6 RDKit descriptors (MolWt, MolLogP, TPSA, HBD, HBA, FractionCSP3) | **Random Forest classifier** | Binary DILI-risk probability + qualitative class. **Honest scope:** does NOT predict 5-class severity or mechanism flags (mitochondrial / BSEP / ROS / immune) — those require gated DrugBank tables not in this corpus | Cascade-gate ML override (in L1, used by `cascadeGate.ts` to upgrade the heuristic hepatotox signal when ML is available) **and** L3 Stage 2 hepatic surrogate; high probability triggers manual severity/mechanism review. **No L1 paired DILI display card** — DILI-ML's L1 effect is gate-side, not panel-side. |
| 5 | **Binding-ML** (DeepDTA-style GBR on Morgan + ESM-2) | `models/binding_ml.py` | ~125 curated literature drug–target pairs spanning ~60 UniProts and ~65 drugs (kinases, GPCRs, COX, HDAC, BCL-2, opioid, SERT, GABA-A, ACE/ARB, statins, PARP — see `binding_ml_data.py`) — **no overlap** with the ChEMBL similarity index | drug = 1024-bit Morgan FP (r=2) + 8 RDKit descriptors (1032-d); target = 480-d ESM-2 t12 35M mean-pooled embedding; concat = **1512-d** | **GradientBoostingRegressor** on the concatenated drug+target vector | **pKd** prediction (`prediction.pKd_predicted`, with derived `Kd_nM` and qualitative affinity class) for an arbitrary SMILES × UniProt pair, with the protein side carrying learned biophysical / evolutionary signal across the full sequence | ML second-opinion in the L2 binding-affinity panel; sits alongside the ChEMBL-similarity rule-based path in `drug_target.py` |
| 6 | **Protein-ML** (ESM-2 + LR druggability) | `models/protein_ml.py` | ~80 well-known human drug targets (multiple FDA-approved small molecules each) vs ~80 essential housekeeping proteins with no approved small-molecule drug — see `protein_ml_data.py` | 480-d mean-pooled per-residue embedding from `facebook/esm2_t12_35M_UR50D` (self-supervised PLM trained on UniRef50) | **Logistic regression** on top of frozen ESM-2 embedding (5-fold CV) | Druggability probability for an arbitrary UniProt | ML second-opinion to `protein.py`'s heuristic druggability score (binding-site count + active-site count + sequence length) |

**Honesty contract every model honors.**
* Each model returns `source: "ml"` only when the trained model actually ran. If loading or inference fails, it returns `source: "fallback"` with an explicit `error` string and **empty structured outputs** — never silently filled-in numbers. The UI gates every render on `source === "ml"` (see `MlAdmetCard.tsx` L268-279 for the fallback banner pattern; same pattern in solubility-paired and hERG-paired). DILI-ML and Binding-ML respect the same envelope contract, but their consumers are the cascade gate (`cascadeGate.ts` ML-override paths) and the L2 binding panel respectively, not paired L1 display cards.
* Inference time and engine string are surfaced in the UI (`model_info.engine` + `model_info.inference_time_ms`) so the user can verify the model is actually running.
* All training corpora are public / CC-BY 4.0 (TDC, Delaney) or curated literature pairs documented in `*_data.py` files.
* The cascade gate (`lib/cascadeGate.ts`) tags real-ML outputs as tier `ml` (0.7) — strictly higher than `heuristic` (0.5) or `structural` (0.6), strictly lower than `enriched` (0.8) or `experimental` (0.9, ChEMBL exact match).

**Open ML-pipeline gaps (audit-acknowledged, tracked for closure).**
* **Applicability domain is not surfaced.** None of the six models currently emits an `in_distribution_band: high|medium|low` flag next to its prediction. For α-tocopherol-fragment (a vitamin E fragment well outside any of these training corpora) the user still sees a numeric DILI / hERG / solubility score on the same surface as an in-distribution kinase scaffold. Required closure: surface **Tanimoto-to-nearest-training-neighbour** for the four Morgan-FP RFs (CardioTox, Solubility-ML, DILI-ML, Binding-ML drug side) and **ensemble disagreement / softmax entropy** for ADMET-AI's Chemprop ensemble; render as a coloured AD chip beside every value.
* **Sample sizes need to be loud, not buried.** Binding-ML (~125 pairs) and Protein-ML (~80 + ~80) are tiny by ML standards; CardioTox (n=655) and DILI-ML (n=475) are small. Every paired card must surface **held-out test ROC-AUC / RMSE next to the model name**, not just `inference_time_ms`. CardioTox already reports 5-fold CV ROC-AUC mean ± std (`MlAdmetCard.tsx` L491-505) — generalise this contract to the other five.
* **Consensus rule is defined in code but not in docs.** The hERG paired-card "Aligned / Divergent / Consensus" badge is computed in `MlAdmetCard.tsx` L367-394 from an `orderMap` over qualitative classes: same class → **Consensus**, one band apart → **Aligned**, two or more bands apart → **Divergent**. Document this rule in the audit and the UI tooltip; do not let it be local lore.
* **DILI-ML cascade rule needs an explicit invariant.** DILI-ML is binary-only (probability + qualitative class). The cascade gate uses it as an L1 hepatic override and as L3 Stage 2 input. Required invariant (must be enforced by a unit test): **the gate may scale probability from a DILI-ML signal but must NEVER escalate severity, mechanism, or 5-class label.** Severity / mechanism / mitochondrial / BSEP / ROS / immune flags require a manual reviewer gate before animal advancement.
* **`KEY_ENDPOINTS` filtering is undocumented.** ADMET-AI v2 returns ~104 numeric values per molecule; the UI's "All ML Endpoints by Bucket" panel renders only the curated `KEY_ENDPOINTS` subset defined in `models/admet_ml.py`. A researcher asking "what about LD50_Zhu / Half_Life_Obach / Lipophilicity_AstraZeneca?" should find a one-line answer in this audit, not have to grep the Python. Required closure: append the full discarded-endpoint list and the inclusion criterion to §0.5 row 1.

**What sections §1–§9 below audit (and what they don't).** The remaining sections audit only pipelines 1–2 (`admet.ts` and `inVitroSim.ts`) — the heuristic engines. Read them as "here is what the rule-based side does and where its numbers stop being defensible". Do **not** read them as "here is what the dashboard does", because the dashboard also shows the real-ML pipeline above on the same screen, and the rule-based numbers are increasingly displayed *paired* with their ML counterparts (with an honest Δ badge) precisely so the user can see when the heuristic disagrees with the trained model.

---

## 1. Direct user inputs (no inference)

| Field | Read from | Hard-coded? |
|----|----|----|
| `smiles` | text input | no — pure user input |
| `uniprotId` | text input or auto-fill from `targetSuggestions[0]` (gated by `uniprotAutoMode` toggle) | no |
| `molName` | text input | no |
| `therapeuticArea` | dropdown — see TA-preset auto-prediction (§4) | preset list of 7 (`Oncology`, `CNS`, `Cardiovascular`, `Metabolic`, `Rare Disease`, `Infectious Disease`, `Immunology`) — defensible as policy enum |
| `tissueTypes`, `bindingOn`, `fingerprintOn` | toggles | no |

---

## 2. RDKit descriptors — REAL (no fakes here)

Source: `lib/chemistry.ts → getMolecularProperties(smiles)`. Calls `RDKit_minimal.js` WASM (RDKit 2024.03.5) loaded at runtime. Returns `MolecularProperties`.

✅ **Real for every property below** — these are direct RDKit outputs:

`mw` (amw), `logP` (CrippenClogP), `hbd`, `hba`, `tpsa`, `rotBonds`, `heavyAtoms`, `numRings`, `numAromaticRings`, `fsp3` (FractionCSP3), `numHeteroatoms`, `numHeterocycles`, `numAromaticHeterocycles`, `crippenMR`, `labuteASA`, `chi1v`, `chi2v`, `kappa1`, `kappa2`, `kappa3`, `hallKierAlpha`, `numAmideBonds`, `numAliphaticRings`, `numSaturatedRings`, `numSpiroAtoms`, `numBridgeheadAtoms`, `numStereoCenters`, `phi`.

⚠️ **One derived field is rule-based, not from RDKit:**
- `qed` — chemistry.ts L185-193 computes a 5-component approximation (`mwScore + logPScore + hbdScore + hbaScore + tpsaScore` averaged), **not** the standard Bickerton 8-descriptor QED with sigmoidal desirability functions. **This is mis-labelled** — it's called QED in the type but is a custom rule-of-five-style score.

⚠️ **Pharmacophore detection** (`detectPharmacophores`) is real RDKit substructure matching against curated SMARTS. ✅ defensible.

### α-tocopherol-fragment expected RDKit values
*(values approximate — verify in-browser)*
- mw ≈ 192 Da
- logP ≈ 4.5 (highly lipophilic — phenolic + saturated chroman)
- tpsa ≈ 30 Å² (low — only a phenol OH and an ether O)
- hbd = 1, hba = 2, rotBonds = 2
- numAromaticRings = 1, numAromaticHeterocycles = 0 (the O is in a saturated ring)
- numStereoCenters = 1 (the chroman C-2 quaternary)

---

## 3. `runAdmetSimulation()` outputs — `simResults` (admet.ts)

> **Important — what these numbers are NOT.** This whole section audits **only pipeline 1** (the heuristic `admet.ts` engine). Every "rule-based" / "heuristic" verdict below applies to `simResults.admet.*` and feeds the **rule-based column** of the "ML vs Rule-based — 5-axis ADMET" card and the heuristic-only legacy panels. The **ML column** of that same card — and the "ML-Enhanced ADMET" header, the "All ML Endpoints by Bucket" panel, the paired hERG card, etc. — are produced by the **real ADMET-AI v2 Chemprop-RDKit GNN ensemble** documented in §0.5 (pipeline 3). Do not read §3.1 as "the 5-axis ADMET scores in the dashboard are heuristic"; read it as "the rule-based half of the paired 5-axis card is heuristic, and here's exactly how each rule works".

### 3.1 ADMET 5-axis scores (`simResults.admet`) — heuristic only

All five scores in `simResults.admet` (the rule-based column of the paired card) are **deterministic rule-based functions of RDKit descriptors plus a seeded jitter from a SMILES hash**. They are NOT learned model outputs. The corresponding ML column comes from ADMET-AI's HIA_Hou / BBB_Martins / mean(CYP*_Veith) / Clearance_Hepatocyte_AZ / mean(critical safety probs) endpoints — see §0.5 row 1 for the ML pathway, and `MlAdmetCard.tsx::mlAxisScore` for the axis-mapping code.

| Field | Formula (admet.ts) | Inputs | Hard-coded constants | Verdict |
|---|---|---|---|---|
| `absorption` | `tpsa < 60 → 0.88; tpsa < 90 → 0.78; tpsa < 120 → 0.60; else 0.35` then ±0.06–0.12 jitter; subtract 0.12 if logP outside [0,6]; subtract 0.10 if hbd>5; subtract 0.08 if mw>600; +0.05 if Lipinski pass; + TA `absorptionBonus` | tpsa, logP, hbd, mw, lipinski, TA | TPSA brackets {60, 90, 120}, base values {0.88, 0.78, 0.60, 0.35}, all penalty coefficients | 🟡 Heuristic — defensible discovery-stage; the gate marks it `tier: heuristic` (cascadeGate.ts L105) |
| `distribution` | base 0.65 ±0.10; +0.10 if 1<logP<4; -0.08 if logP>5; -0.07 if mw>500; +0.05 if tpsa<90 & mw<450 | logP, mw, tpsa | base 0.65, all bracket cutoffs and deltas | 🟡 Heuristic |
| `metabolism` | base 0.72 ±0.10; -0.08 if logP>3; -0.08 again if logP>5; -0.06 if rotBonds>8; +0.05 if hbd<2; subtract TA `metabolismPenalty` | logP, rotBonds, hbd | base 0.72, all coefficients | 🟡 Heuristic |
| `excretion` | base 0.70 ±0.08; +0.08 if mw<300; -0.10 if mw>500; -0.07 if logP>4 | mw, logP | base 0.70, all coefficients | 🟡 Heuristic |
| `toxicity` | base 0.80 ±0.08; -0.12·`hergSensitivity` if (logP>4 & hbd<2 & mw>300); -0.08·`hepatoSensitivity` if (logP>4.5 or mw>550); -0.05 if mw>600; ×TA `toxicitySensitivity` | logP, hbd, mw, TA | all rule cutoffs and weights, the binary `genoRisk = false` (genotox is **always off** — see §7) | 🟠 Heuristic + literally-disabled-rule (`genoRisk = false`) |
| `overall` | `0.25·abs + 0.20·dist + 0.20·met + 0.15·exc + 0.20·tox` | the five axes | the five weights | 🟡 Hard-coded weighting scheme |

**α-tocopherol-fragment hand-trace:** logP≈4.5, hbd=1, mw≈192, tpsa≈30 →
- absorption: tpsa<60 base 0.88; logP just at boundary; hbd ok; mw ok; lipinski pass +0.05 → **~0.93** (likely too optimistic — antioxidants do absorb, but the rule overshoots).
- toxicity: hergRisk = (logP>4 ✅ & hbd<2 ✅ & mw>300 ❌) → false; hepatoRisk = (logP>4.5 ❌ or mw>550 ❌) → false. So tox stays at ~0.80 (looks safe). **Reasonable for vitamin E.**

### 3.2 Toxicity alerts (`simResults.toxAlerts`)

Each alert is an if-then on the same rules above:
- `hERG Channel Inhibition` — fires only when `hergRisk` (above) is true
- `Hepatotoxicity Risk` — fires only when `hepatoRisk` is true; severity is High if logP>5
- `BBB Penetrant` — fires when tpsa<90 & mw<450 (so α-tocopherol-fragment **will trigger this**)
- `Genotoxicity Alert` — **dead code: `genoRisk` is hardwired to `false` at admet.ts L197.** This alert can never fire under any input. ❌ **RED FLAG** — dishonest (label promises a screen, code never runs one).

### 3.3 Organ risks (`simResults.organs`)

Each organ has a `liverBaseRisk`, `heartBaseRisk`, etc. computed as `jitter(0.07–0.22, 0.04–0.06, seed+N)` then multiplied by TA sensitivity. The "Lung" organ is hardwired to `clamp(jitter(0.04, 0.03, seed+15))` and color `"emerald"` regardless of structure. ❌ **RED FLAG** — Lung risk is structurally meaningless noise; the color is fixed.

### 3.4 Binding (`simResults.binding`) — Kd / Ki / IC50

```ts
const targetInfo = TARGET_MAP[uniprotId] ?? { potencyRange: [10, 1000] };  // hardcoded
const drugLikenessFactor = molProps.lipinskiPass ? 0.4 : 0.7;              // hardcoded
const qedFactor = (1 - qed) * 0.3;                                          // hardcoded
const basePotency = pMin + (pMax - pMin) * (drugLikenessFactor + qedFactor);
const primaryKd = clamp(jitter(basePotency, basePotency*0.3, seed+20), 0.1, pMax*2);
const primaryKi = clamp(primaryKd * jitter(0.85, 0.15, seed+21), 0.1, pMax*2);
```

❌ **RED FLAG** — for **α-tocopherol-fragment with no UniProt** (or any UniProt **not** in `TARGET_MAP` — only 8 kinases listed), the engine falls back to `potencyRange: [10, 1000]` nM and emits a numeric Kd/Ki/IC50 anyway, **labelled "Unknown Target / Unknown class"**. Numbers shown will look like real binding data but are pure jitter from the SMILES hash. The cascade gate flags this as `tier: heuristic` ("Pharmacophore + jitter from hardcoded potency range") so the policy gate at least names it — but the UI displays it without that caveat unless you scroll to the cascade-gate panel.

### 3.5 Lipinski (`simResults.lipinski`)

✅ **Real** — uses RDKit values directly with the canonical Lipinski Rule-of-Five thresholds (500 Da / logP 5 / 5 HBD / 10 HBA). The `leadLike` flag uses lead-like cutoffs (350 / 3.5 / 3 / 7) — also a published convention.

### 3.6 Synthetic Accessibility (`simResults.saScore`)

```ts
saScore = clamp(jitter(2.0 + mw/200 + (rotBonds>6 ? 0.5 : 0) + (hba>6 ? 0.3 : 0), 0.8, seed+40), 1, 10)
```
❌ **RED FLAG** — labelled SA score (a published Ertl-Schuffenhauer fragment-frequency metric) but is a **made-up linear formula**. Should be removed or re-labelled.

### 3.7 Go/No-Go (`simResults.goNogo`)

Rule:
- `NO-GO` if any High-severity tox alert OR ≥3 Lipinski violations
- `WATCH` if ≥2 violations OR `overall<0.65` OR >1 tox alert
- else `GO`

🟡 Heuristic but transparent. **Bug:** the `recommendation` string for WATCH at admet.ts L349 contains an unresolved template literal (`\${violations > 0 ? 'drug-likeness' : 'safety margin'}` — escaped, prints literally). Cosmetic.

### 3.8 Confidence (`simResults.confidence`)

```ts
confidence = overall*0.6 + (1 - violations*0.12)*0.25 + (toxAlerts.length===0 ? 0.15 : len===1 ? 0.10 : 0.05)
```
🟡 Heuristic. The "Confidence Score: X%" shown on the green Go/No-Go header (HakaseAI.tsx L8898) is this number — a weighted combination of other heuristic numbers, **not** an uncertainty estimate from a probabilistic model.

### 3.9 Similar drugs (`simResults.similarDrugs`)

Uses `similarByTarget` lookup keyed on UniProt ID — **only 7 entries**. Falls back to TA `similarDrugsOverride` (3 hand-picked drugs per area) or finally to `["Erlotinib", "Gefitinib", "Imatinib"]` literal. ❌ **RED FLAG for the fallback** — three EGFR inhibitors are returned as "similar" to *any* off-catalog molecule (e.g., α-tocopherol). Should be empty + a "no similar drugs found" badge.

---

## 4. TA-preset auto-prediction (HakaseAI.tsx L616-669)

Just rewritten. ✅ For α-tocopherol: no target catalog match → `taProvenance.kind = "default"` → therapeuticArea stays at whatever the user picked (does NOT silently set to Oncology). The provenance chip next to the dropdown surfaces this.

---

## 5. `runInVitroSimulation()` outputs — `inVitroResults` (inVitroSim.ts)

This engine is more comprehensive than admet.ts and feeds the main Dose-Response / Permeability / Clearance / Safety / Selectivity tabs.

### 5.1 Dose-Response (`inVitroResults.doseResponse`)

| Field | Source | Hard-coded? |
|---|---|---|
| `ic50_nM` | `10^(9 - finalPIC50)` where `finalPIC50 = computeBaselinePIC50(...) + computePharmacophoreBonus(...) + taMult` | 🟠 The baseline pIC50 starts at **5.2** and is adjusted by ~13 hand-tuned bracket rules on RDKit descriptors; pharmacophore bonus is hand-tuned per TA |
| `ec50_nM` | `ic50 × jitter(0.8–1.2)` | jitter range hardcoded |
| `hillCoefficient` | base 1.0 + 0.15 if nArom≥2 + 0.1 if fsp3>0.4 + 0.3 if Michael acceptor − 0.1 if rotBonds>8 ± 0.15 jitter | all coefficients hardcoded |
| `maxInhibition` | base 90 + 5 if pIC50>7 + 3 if Michael − 5 if logP>5 ± 3 jitter | all coefficients hardcoded |
| `curve[]` | logistic from ic50 + hill + maxInhib with ±1% noise | logistic formula is real; noise is jitter |
| `potencyClass` | `<TA.high → High`; `<TA.moderate → Moderate`; else Low | TA-specific cutoffs (e.g., Oncology: 100/1000 nM) — defensible as policy |

❌ **For α-tocopherol-fragment** the engine produces a numeric IC50 even though there's no target — the value is keyed off the SMILES hash and physicochemistry alone, **not** a docking or QSAR model. The "IC50: X nM" badge in the key-metrics strip (HakaseAI.tsx L8906) **lies if no real target is bound**.

### 5.2 Permeability (`inVitroResults.permeability`)

| Field | Source |
|---|---|
| `caco2Papp` | `computeCaco2Permeability(logP, tpsa, mw, hbd)` — log-linear regression with hand-tuned coefficients (`-5.75 + 0.35·logP - 0.012·tpsa - …`) | 🟠 Heuristic but coefficients are roughly aligned with literature regressions (e.g., Hou et al. 2007). Should cite source. |
| `pampaPe` | `caco2Papp · (0.55 + fsp3·0.3)` | 🟠 Made-up scaling |
| `effluxRatio` | `1.0 + (mw>400 ? 0.5) + (tpsa>100 ? 0.8) + (hbd>3 ? 0.5) + logP·0.15` | 🟠 Heuristic |
| `pgpSubstrate` | `effluxRatio > 2.5` | hardcoded threshold |

### 5.3 Metabolic Stability (`inVitroResults.metabolicStability`)

| Field | Source |
|---|---|
| `microsomalCLint` | `computeMicrosomalCLint(logP, mw, nArom, fsp3, rotBonds)` — `10^(0.8 + 0.25·max(0,logP-1) + 0.0015·mw + …)` | 🟠 Heuristic |
| `hepatocyteCLint` | `microCLint × (0.4 + fsp3·0.2)` | 🟠 Heuristic |
| `halfLifeMin` | `0.693 / (CLint/1000) × 0.9` | 🟠 The 0.9 is unexplained |
| `cypInhibition.{1A2,2C9,2C19,2D6,3A4}` | `computeCYPInhibition()` — base IC50 per isoform from logP/MW/pharmacophore + ±15% jitter | 🟠 Hand-tuned base values per CYP (12-22 µM) — no enzyme kinetics |

### 5.4 Plasma protein binding (`inVitroResults.plasmaProteinBinding`)

`computePPB(logP, mw, acidicGroups)` — `log10(fu) = 1.6 - 0.35·max(0,logP) - …`. 🟠 Heuristic.

### 5.5 hERG (`inVitroResults.herg`)

`computeHERGIC50(logP, mw, basicN, tpsa, nArom, pharm)` — `log10(IC50_µM) = 1.8 - 0.22·max(0,logP-2) - 0.35·basicN - …`. 🟠 Heuristic, but uses real published-style descriptor relationships. The `patchClampResult` text strings ("Significant block at 1 µM" etc.) are **hardcoded labels**, not output of any patch-clamp simulation.

### 5.6 Selectivity (`inVitroResults.selectivity`)

```ts
totalTargets = 50 + round(jitter*50 + heavyAtoms);   // makes total tests look ~100
offTargetHits = round(clamp(offTargetBase * (0.6 + fsp3·0.4), 0, 25));
kinaseScore = clamp(1 - (offTargetHits/totalTargets)*10, 0, 1);
topOffTargets = first 5 names from TA.offTargetPanelNames keyed on (seed+i*7) % length
```
❌ **RED FLAG** — `topOffTargets` returns 5 named kinase/GPCR targets from a **hardcoded TA panel** (e.g., for Oncology: PIM1, FLT3, JAK2, ALK, ROS1…) with **fabricated IC50 values**. For α-tocopherol with TA=Oncology this will display "α-tocopherol-fragment hits PIM1 at X nM" which is **clinically false**. The off-target IC50 number is `ic50_nM × offRatio × 0.5` — entirely derived from the (fake) on-target IC50.

### 5.7 Cell viability (`inVitroResults.cellViability`)

| Field | Source |
|---|---|
| `cc50_uM` | `(logP>4 ? 15 : logP>2 ? 40 : 70) + fsp3·20 - (nArom>3 ? 10 : 0)` | ❌ Hand-tuned step function |
| `therapeuticIndex` | `cc50_uM × 1000 / ic50_nM` | derived (but inherits the IC50 fakery) |
| `viabilityAt10uM` | `90 - (logP>4 ? 20) - (mw>500 ? 5) + fsp3·10` | ❌ Hand-tuned |
| `cellLine` | `taProfile.cellLinePreference[seed % length]` | preset list — defensible |

### 5.8 Bioactivation (`inVitroResults.bioactivation`)

Calls `runBioactivationAssessment()` in `lib/bioactivationEngine.ts` which is a **SMARTS reactive-metabolite alert library scan** (substructure matching). ✅ Defensible discovery-stage signal — the cascade gate explicitly flags this as `tier: structural` (score 0.6) at cascadeGate.ts L97-100.

### 5.9 Overall risk and inVitroScore

```ts
riskFactors = [potencyLow, permLow, metUnstable, hergHighOrModerate, selNonSelective, TI<30, cypHighRisk>2]
totalRisk = sum (max ~8)
overallRisk = totalRisk≥4 ? High : totalRisk≥2 ? Moderate : Low
inVitroScore = 1 - totalRisk/8
```
🟡 Hard-coded weighting scheme but transparent. The "In Vitro Score: X%" shown in the green header is this number.

---

## 6. Cascade gate quality tags (cascadeGate.ts) — already honest

✅ This file is the **one place** in L1 that already tells the truth. Each output is tagged with a `QualityTier`:
- `heuristic` (0.5) → blocks auto-cascade if any safety-critical signal is heuristic-only
- `structural` (0.6) → SMARTS substructure
- `ml` (0.7) → real ML prediction loaded from ai-service
- `enriched` (0.8) → similarity-inferred
- `experimental` (0.9) → ChEMBL exact match

Notes column for each output is honest ("LogP rules of thumb; no species differences", "Pharmacophore + jitter from hardcoded potency range", etc.). The Stage-Gate Review banner shows this when the gate blocks. **Recommendation:** mirror these honest notes onto the main L1 panels too, not just the cascade-gate tile.

---

## 7. Hard-coded value inventory (priority for cleanup)

### ❌ RED FLAGS (numbers presented as data but not data)

> **Severity ranking.** RF#1 (off-catalog binding Kd) and RF#2 (similarDrugs EGFR fallback) and RF#3 (totalTargetsTested ~100) and RF#4 (topOffTargets named hits) are **demo-killers**: a regulator or partnered biotech running α-tocopherol-fragment live would see "vitamin E fragment hits PIM1 at 47 nM, tested against 87 targets, similar to Erlotinib" and the conversation ends. RF#5–#9 are visceral but contained. RF#10–#12 are labelling / calibration problems. The §9 cleanup order below uses this ranking, not LOC.

1. **Binding Kd/Ki/IC50 for off-catalog UniProt or no UniProt (admet.ts L309-329)** — falls through to `potencyRange [10,1000]` for any UniProt not in `TARGET_MAP` (8 hardcoded entries) and emits numeric Kd/Ki/IC50 values labelled "Unknown Target". Off-targets inherit the same fabrication via the empty `targetInfo.offTargets` array.
2. **`similarDrugs` literal fallback (admet.ts L373-394)** — when neither the UniProt is in `similarByTarget` (7 hardcoded targets) nor the TA preset has a `similarDrugsOverride`, the function now correctly returns `[]` (recently fixed); but the **TA-override branch itself is a fallback** — picking Oncology surfaces Erlotinib/Gefitinib/Imatinib for any molecule, including α-tocopherol-fragment under "Oncology". Consumer (`RegulatoryInsightCard`) cross-checks each name against openFDA, so a fabricated list either surfaces fake "precedents" or triggers false openFDA lookups against unrelated drugs.
3. **`selectivity.totalTargetsTested = 50 + jitter*50 + heavyAtoms` (inVitroSim.ts L522)** — renders as "tested against ~100 targets" in the Selectivity card. This is a **fabricated experimental claim**, equivalent severity to RF#4. You cannot emit a "tested against N" count when N actual screens were run = 0. Same drum: any "tested against" / "screened in" copy must be gated on a real screen.
4. **`selectivity.topOffTargets` (inVitroSim.ts L535-545)** — returns up to 5 named TA-specific kinase/GPCR targets with fabricated IC50s and selectivity ratios, regardless of whether the molecule actually screens against them. Empty-panel guard is in place for neutral TA but Oncology → "molecule X hits ABL1 at 47 nM" with zero supporting data.
5. **`Lung organ risk = jitter(0.04, 0.03, seed+15)` always emerald (admet.ts L300-305)** — structurally meaningless noise; should be omitted unless inhalation route or pulmonary-toxicity signal exists.
6. **`patchClampResult` hardcoded strings (inVitroSim.ts L519-520)** — "Significant block at 1 µM" / "Mild block at 10 µM" / "No significant block at 30 µM" are three string literals keyed off a heuristic-derived `hergRisk` band. Same severity class as the others: presents as electrophysiology output, is not.
7. **`InVitroResults.doseResponse.ic50_nM` for off-catalog molecules (inVitroSim.ts L485-486 + dose-response synthesis upstream)** — emits an IC50 from physchem alone, with no target and no QSAR/docking. Surfaces as "IC50: X nM" badge in the Dose-Response card.
8. **`saScore` (admet.ts L344)** — labelled "Synthetic Accessibility", is a custom MW-linear formula `2.0 + mw/200 + …`, not the Ertl-Schuffenhauer 2009 fragment-contribution score the label implies.
9. **`qed` (chemistry.ts L185)** — labelled "QED" (Quantitative Estimate of Drug-likeness), is a custom 5-component RoF-style approximation, not the Bickerton 2012 ADS-product implementation the label implies.
10. **`genoRisk = false` (admet.ts L210)** — Genotoxicity alert is hardwired off; the L243-248 alert is dead code that never fires. Either delete (cheapest) or — preferred — wire to a real Ames-style SMARTS panel via the existing `bioactivationEngine.ts` pattern (aromatic amines, nitroso, epoxides, alkylating Michael acceptors). Replacing dead code with a working structural screen is a stronger fix than deletion and is a few hours of work.
11. **`confidence` is calibration-free (admet.ts L368-370)** — rendered as "Confidence Score: 78%". The formula is `overall * 0.6 + (1 − violations·0.12) * 0.25 + alerts-bonus`. This is a weighted heuristic sum with no probabilistic calibration; rendering it as a percentage implies a Brier-/log-loss-validated probability that does not exist. Re-label as "Composite heuristic score (0–100)" or replace with a bootstrap-over-jitter estimate with held-out Brier-score validation.
12. **`potencyClass` ("High / Moderate / Low") under TA = Default (inVitroSim.ts L485-486)** — TA-conditional thresholds via `taProfile.potencyThresholds`, but under the neutral / Default profile (the case α-tocopherol-fragment will hit) the threshold convention is undefined and the "High potency" label is meaningless. Always show the convention next to the label ("High = IC50 < 10 nM under Oncology profile") and refuse to emit the label under the neutral profile, OR fall back to a published universal convention (e.g., Hopkins/Groom 2002).

### 🟡 DEFENSIBLE HEURISTIC (tier should be visible, but rule itself is OK)

- All ADMET 5-axis rule-of-thumb scoring (admet.ts L156-204).
- All inVitroSim regressions for Caco2 / CLint / hERG / PPB — these track published descriptor regressions; they should cite source and surface tier.
- Lipinski Rule-of-Five thresholds (500/5/5/10).
- The 7 therapeutic-area presets (`THERAPEUTIC_AREA_PROFILES`, `ADMET_TA_MODIFIERS`).
- Bioactivation SMARTS alert scan.
- TA-specific potency thresholds and cell-line preferences.

### ✅ REAL DATA

- All RDKit descriptors (mw, logP, tpsa, hbd, hba, rotBonds, fsp3, ring counts, χ/κ topological indices, Crippen MR, Labute ASA).
- Pharmacophore SMARTS substructure detection.
- Lipinski violations count.
- Bioactivation engine (SMARTS scan against curated reactive-metabolite library).
- All six real ML models in pipeline 3 — see §0.5 for specs (ADMET-AI v2 GNN ensemble, CardioTox v1 RF, Solubility-ML RF, DILI-ML RF, Binding-ML GBR on Morgan+ESM-2, Protein-ML LR on ESM-2). Outputs are gated on `source === "ml"` in every consumer; `source === "fallback"` renders an explicit unavailable banner rather than silent substitution.

---

## 8. α-tocopherol-fragment expected behavior (cross-check checklist)

Run this molecule with TA = whatever you previously had selected. The provenance chip should say "Default" (gray). Watch for:

| Panel | Expected (honest) | What you'll likely see today |
|---|---|---|
| TA chip | "Default" | ✅ correct after recent fix |
| RDKit panel | mw≈192, logP≈4.5, tpsa≈30 | ✅ real RDKit |
| Lipinski violations | 0 (passes all) | ✅ real |
| Toxicity alerts | "BBB Penetrant" only (tpsa<90, mw<450) | ✅ correct |
| Genotox alert | should never appear (rule disabled — see RED FLAG #1) | ✅ never appears |
| Lung organ risk | should be "no data" | ❌ shows ~4% emerald |
| Binding Kd/Ki/IC50 | should be "no target — N/A" | ❌ shows numeric values labelled "Unknown Target" |
| Similar drugs | should be "no analogues" | ❌ likely shows TA fallback (e.g., for Oncology: Erlotinib/Gefitinib/Imatinib) |
| Off-target panel (Selectivity tab) | should be "no panel data" | ❌ shows 5 kinase/GPCR targets with fake IC50s |
| Dose-Response IC50 | should be "no target — N/A" | ❌ shows numeric IC50 |
| ML-Enhanced ADMET tile | real ADMET-AI scores (when ai-service up) | ✅ real (newly wired) |
| Cascade-gate "Stage-Gate Review Required" banner | should fire — too many heuristic-only safety signals | ✅ does fire (this is the honest panel) |

---

## 9. Recommended cleanup order (by demo embarrassment, not LOC)

> **Reordering rationale.** The previous version of this section was engineer-friendly (smallest change first). That ordering optimised for blast radius, not for what would actually do the most damage in front of a regulator or partnered biotech. The α-tocopherol-fragment live-demo failure modes are the demo-killers (RF#1–#4); the labelling problems (RF#8–#9, RF#11–#12) and dead code (RF#10) come last. Each step references the RED FLAG it closes.

1. **Gate binding output on `TARGET_MAP[uniprotId]` hit (closes RF#1).** Return `binding: null` (typed as `BindingEstimate | null`) when the UniProt is not in the catalog. Update the `SimResults.binding` type, every consumer in `HakaseAI.tsx`, and surface an honest "no target affinity available — UniProt not in validated catalog" banner. **Highest priority.**
2. **Remove the TA-override branch from `similarDrugs` (closes RF#2).** Keep only the curated UniProt → approved-drug map. Off-catalog UniProt + any TA → `[]` and the consumer hides the precedent panel. Avoids both the demo embarrassment and the spurious openFDA lookups against unrelated drug names.
3. **Gate `selectivity.totalTargetsTested` on a real screen (closes RF#3).** Only emit when an actual off-target panel has been fetched. Otherwise omit the field (or surface as `null` with a "no off-target screen run" tag). Type-level: change `totalTargetsTested: number` to `totalTargetsTested: number | null` so the UI cannot accidentally render `0` as "0 targets tested" instead of "no screen".
4. **Gate `selectivity.topOffTargets` on a real off-target screen (closes RF#4).** Only emit when a kinome/GPCR panel has actually been run. Tighten the existing empty-panel guard to require `realScreenAvailable === true` rather than just non-empty TA panel names.
5. **Drop the Lung organ entirely (closes RF#5)** — or make it conditional on inhalation route + a real pulmonary-toxicity signal (no inhalation route in the current MVP, so deletion is the honest move).
6. **Replace `patchClampResult` hardcoded strings with a "predicted, not measured" tag (closes RF#6).** Surface only the numeric `herg_ic50_uM` plus a `tier: "heuristic"` chip; remove the three string literals.
7. **Gate `doseResponse.ic50_nM` on a target+QSAR signal (closes RF#7).** When neither a `TARGET_MAP` UniProt nor an ML binding prediction is available, omit the IC50 (or null it) and let the dose-response card render its no-data state.
8. **Cheap win: vendor real QED + SA score (closes RF#8 + RF#9 in one stroke).** Port the published reference implementations — Bickerton 2012 ADS-product QED (~150 LOC) and Ertl-Schuffenhauer 2009 fragment-contribution SA score (~150 LOC). Mechanical translations of openly available code; both endpoints already have heuristic placeholders so the consumer surfaces are already wired. Eliminates two red flags without changing any UI contract.
9. **Cheap win: wire `genoRisk` to real Ames-style SMARTS via `bioactivationEngine.ts` (closes RF#10).** Add an Ames-leaning fragment panel (aromatic amines, nitroso, epoxides, alkylating Michael acceptors) to the existing engine; replace `const genoRisk = false` with `const genoRisk = bioactivationEngine.amesAlertCount(smiles) > 0`. Stronger fix than deletion — converts dead code into a working structural screen — and reuses an existing engine pattern.
10. **Re-label `confidence` (closes RF#11).** Rename the rendered field from "Confidence Score" to "Composite Heuristic Score (0–100)" until a Brier-validated probability replaces it. One-line UI change; eliminates the calibration-implication red flag immediately.
11. **Always show the `potencyClass` convention or refuse to emit under neutral TA (closes RF#12).** Either render "High (IC50 < 10 nM, Oncology convention)" or skip the qualitative label under the neutral profile and show only the numeric IC50.
12. **Surface cascade-gate `tier` and `note` on every heuristic value in the main L1 panels** (not only in the gate tile) so the user sees provenance per number, not only at gate-evaluation time. This is the bridge to §10's write-time invariant — the manual version of the typed-envelope contract.

---

## 10. Architectural framing (audit hints, made explicit)

The nine-then-twelve red-flag list is symptomatic. The underlying issue is that L1 has **no write-time invariant against fabrication**. The cascade gate carries the right concept (`tier`, `note`) but it is enforced at *evaluation* time, in one file, against in-memory values that were already produced. The ML pipeline already carries the correct envelope (`source: "ml" | "fallback"`). Three architectural changes promote this to the system level:

### 10.1 Promote anti-fabrication to a write-time invariant

Today: a number is computed in `admet.ts`, lands in `SimResults` as `number`, flows to `HakaseAI.tsx`, renders as a value. Provenance is reconstructed downstream by the cascade gate. This is the same defect class as un-typed null handling — by the time you discover the value is heuristic, it's been rendered.

Required: **every numeric L1 output carries `{ value, source, note?, citation?, ad_band? }` at the type level** — same shape ML pipeline already uses. `source ∈ "experimental" | "ml" | "structural" | "heuristic" | "unavailable"`. The TypeScript compiler refuses to render a bare `number` in any L1 panel; the renderer must consume the envelope. Demote the cascade gate from value-tagger to envelope-aggregator.

This is the v2.0.0 Confirmation contract pattern, applied one layer up. Once in place, every RF in §7 becomes a type error rather than a code-review finding.

### 10.2 Unify the two Go/No-Go authorities

`inVitroResults.overallRisk` (inVitroSim.ts L568-570) and `simResults.goNogo` (admet.ts L354-366) can disagree on the same molecule and the audit currently notes this without resolving it. The user can be shown "GO" by one pipeline and "WATCH" by the other on the same screen.

Required: **the cascade gate is the sole gate.** Demote `inVitroResults.overallRisk` and `simResults.goNogo` to inputs of the cascade gate, not display-rendered authorities. The Go/No-Go badge in the dashboard header reads exclusively from `cascadeGate.evaluate(...)`. Other two values may still appear inside their own panels as component scores, but never as the verdict.

### 10.3 Wire cascade-gate notes into the HAIOps Gate Service

Per the locked-in contract decisions from May 6: the **module owns falsifier definitions, HAIOps owns registry / dispatch / audit**. Today the cascade-gate `note` strings ("Pharmacophore + jitter from hardcoded potency range", "LogP rules of thumb; no species differences", etc.) are de-facto falsifier definitions buried in one file — local lore.

Required: **register every cascade-gate note with HAIOps as a falsifier**, addressable by `(layer, axis, tier)` so they're auditable and dispatchable system-wide. Cross-link from the HAIOps spec when written; the gate-service and L1-provenance docs are sibling artifacts.

---

## 11. Machine-enforce the audit (α-tocopherol-fragment fixture suite)

Stop relying on manual cross-checks. Promote the §8 checklist to a **fixture-based regression suite** under `artifacts/hakase-ai/src/lib/__tests__/l1_provenance_fixtures.test.ts`. The fixture panel is a small set of molecules selected to be *unambiguously off-catalog*:

| Fixture | SMILES (sketch) | Why included |
|---|---|---|
| α-tocopherol-fragment | chromanol head | Real failure mode; vitamin E surrogate |
| Glucose | sugar (hexose) | No protein target; carb scaffold |
| Palmitic acid | C15H31COOH | Fatty acid; no kinase / GPCR relevance |
| Hexafluoroethane | C2F6 | Noble-gas-like inert solvent surrogate |
| Caffeine | trimethylxanthine | In-distribution physchem control (negative) |

For each fixture, the suite asserts (snapshot + invariants):

* `simResults.binding === null` for off-catalog UniProt fixtures (RF#1).
* `simResults.similarDrugs.length === 0` for off-catalog × non-curated TA (RF#2).
* `inVitroResults.selectivity.totalTargetsTested === null` and `topOffTargets.length === 0` (RF#3, RF#4).
* `simResults.organs.find(o => o.name === "Lung")` is undefined (RF#5).
* `inVitroResults.herg.patchClampResult` is undefined (RF#6).
* `inVitroResults.doseResponse.ic50_nM === null` for off-target fixtures (RF#7).
* For caffeine (positive control): values render normally; the suite catches accidental over-suppression.

The suite runs on every PR. The audit then stops being a recurring manual diff and becomes an executable invariant.

---

## 12. L1 → L2 handoff typing (block heuristic propagation)

This audit is L1-only and explicitly says so. Before the L2 (Confirmation) and L3 (Animal Cohort) audits land, **type the L1→L2 handoff** so the L2 consumer can refuse heuristic-only inputs on safety-critical paths.

Without this, every L1 fabrication propagates into the Confirmation layer's animal-advancement decision, and the L1 cascade gate's `tier: "heuristic"` tag buys the safety case nothing downstream. Concretely:

* The L1→L2 boundary type must require `source: "experimental" | "ml" | "structural"` for any input feeding an animal-advancement gate.
* L2 explicitly refuses (compile-time) to consume a `source: "heuristic"` value on safety-critical axes (hERG, hepatotox, genotox, off-target liability).
* The refusal mechanism is the same envelope shape as §10.1 — once §10.1 is in place, this boundary is enforced for free.

---

## 13. Doc hygiene

* **This audit is a versioned artifact.** It lives in the repo under `CODEOWNERS` (recommend: assign to the L1 maintainer + HAIOps owner). Any PR touching `lib/admet.ts`, `lib/inVitroSim.ts`, `lib/cascadeGate.ts`, `services/aiService.ts`, or `artifacts/ai-service/models/*.py` must update this audit's "diff since last audit" section in the same PR.
* **Diff-since-last-audit section.** Add a top-of-doc changelog block. Every change bumps the audit revision (e.g., `Audit revision: 2026-05-12-rev3`) and lists which RFs it closes / opens.
* **Cross-link from sibling specs.** When the HAIOps spec is written, link from its falsifier-registry section back to §10.3 here, and from its safety-input contract back to §12.

---

*Generated 2026-05-12 (revision 2 — incorporates architect review of 2026-05-12: 3 new RFs added (totalTargetsTested, confidence calibration, potencyClass under default), §9 reordered by demo embarrassment, §§10–13 added on write-time invariants / unified gate / HAIOps registration / fixture suite / L1→L2 typing / doc hygiene). Cross-references: `lib/admet.ts`, `lib/inVitroSim.ts`, `lib/chemistry.ts`, `lib/cascadeGate.ts`, `lib/bioactivationEngine.ts`, `components/MlAdmetCard.tsx` (consensus rule, fallback banner pattern), `pages/HakaseAI.tsx` L4215-4266 (cascade preview + recommendations), L8870-8930 (Go/No-Go header + key metrics), `artifacts/ai-service/models/*.py` (six ML models per §0.5).*
