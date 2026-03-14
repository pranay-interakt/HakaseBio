# HakaseAI — 72 Input Fields Reference

**Platform:** BioDigital Twin  
**Architecture:** 3 cascading simulation layers  
**Total inputs:** 72 across Layer 1 (23), Layer 2 (26), Layer 3 (23)  
**Flow:** Each layer builds on the last — outputs from L1 auto-populate L2, L2 auto-populates L3.

---

## LAYER 1 — Molecular Digital Twin
*Characterises the drug molecule itself. Predicts ADMET properties, binding affinity to a target protein, and toxicity signals.*  
**Estimated runtime:** 5–30 seconds

---

### Section 1 · Primary Molecular Input

| # | Field | Type | Required | Notes / Validation |
|---|-------|------|----------|--------------------|
| 1 | **SMILES String** | Text input | ✅ | RDKit-validated. Accepts canonical SMILES. MW must be 100–1,500 Da. Inline 3D preview button appears on valid entry. |
| 2 | **Molecule Name** | Text input | — | Auto-generated if left blank (e.g. `Compound-001`). |
| 3 | **SDF / MOL2 Upload** | File upload | — | Accepts `.sdf`, `.mol2`, `.mol`. Max 10 MB. Parses first structure if multi-record SDF. |
| 4 | **Batch CSV Upload** | File upload | — | CSV must contain a `smiles` column. Up to 500 rows per batch. |

**Import shortcuts (expand in-panel):**

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 5 | **Diagen Integration Mode** | 3-way toggle | — | `Synchronous` (single molecule, <30 s) / `Async Batch` (webhook-driven, ~2 min) / `Cascade` (auto-runs L1→L2→L3 in one call) |
| 6 | **Diagen Molecule / Job ID** | Text input | — | Accepts `DGN-MOL-XXXX` (single) or `DGN-BATCH-XXXX` (batch). Fetches SMILES, name, UniProt ID, pre-computed ADMET scores directly from Diagen AI. |
| 7 | **API Source Database** | Button selector | — | Choose one: **ChEMBL** / **PubChem** / **DrugBank** / **UniChem** / **ZINC** |
| 8 | **API Compound ID / Name** | Text input | — | Format varies by source: `CHEMBL25`, `3672` (PubChem CID), `DB01050` (DrugBank), `UCI2`, or ZINC ID. |

---

### Section 2 · Target Protein Configuration

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 9 | **Target UniProt ID** | Text input (search) | ✅ for binding | e.g. `P00533` (EGFR). Auto-resolves protein name on valid entry. Required to enable Binding Simulation toggle. |
| 10 | **PDB Structure ID** | Text input | — | 4-char PDB code, e.g. `4HJO`. Overrides the auto-selected co-crystal structure. Leave blank to use best-ranked structure. |
| 11 | **Therapeutic Area Preset** | Dropdown | — | Options: `Oncology` / `CNS` / `Cardiovascular` / `Metabolic` / `Rare Disease` / `Infectious Disease` / `Immunology`. Adjusts default thresholds and scoring weights. |

---

### Section 3 · Simulation Options

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 12 | **ADMET Prediction** | Toggle (locked ON) | ✅ | Core prediction — always runs. Cannot be disabled. Outputs Absorption, Distribution, Metabolism, Excretion, Toxicity scores (0–1 scale). |
| 13 | **Binding Simulation** | Toggle | — | ESM-2 protein language model + molecular docking pipeline. Requires UniProt ID (field 9). Disabled if UniProt ID is empty. |
| 14 | **Toxicity Signal Detection** | Toggle | — | Cross-references FDA Adverse Event Reporting System (FAERS). Flags hERG, hepatotoxicity, genotoxicity signals. |
| 15 | **Behavioral Fingerprinting** | Toggle | — | Multi-tissue pharmacological fingerprint. Adds ~10 seconds to runtime. |
| 16 | **Tissue Types** | Multi-select (6 options) | — | Shown only when Behavioral Fingerprinting is ON. Select any of: `Liver` / `Kidney` / `CNS` / `Cardiac` / `GI` / `Lung` |
| 17 | **Confidence Threshold** | Slider | — | Range 0.50–0.95. Predictions below threshold are flagged as uncertain. Default: 0.70. |

---

### Section 4 · Batch Configuration *(collapsible)*

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 18 | **Ranking Criteria** | Dropdown | — | `QED Score` / `Toxicity Risk (ascending)` / `Binding Affinity` / `Composite (weighted)`. Determines sort order in batch results table. |
| 19 | **Composite Weight — QED** | Slider | — | Shown only when Ranking = Composite. Range 0.0–1.0. Weights the QED drug-likeness score. |
| 20 | **Composite Weight — Toxicity** | Slider | — | Weight for toxicity risk in composite score. |
| 21 | **Composite Weight — Binding** | Slider | — | Weight for predicted binding affinity. |
| 22 | **Composite Weight — SA** | Slider | — | Weight for synthetic accessibility score. |
| 23 | **Top-N Filter** | Number input | — | Return only the top N molecules from batch. Range 1–500. |

---

## LAYER 2 — Patient Cohort Twin
*Simulates how a virtual population of patients responds to the drug. Models PK/PD curves, responder rates, and adverse event incidence.*  
**Estimated runtime:** 2–7 minutes

---

### Section 5 · Indication & Disease

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 24 | **Primary Indication (ICD-10)** | Text input (search) | ✅ | Free-text or ICD-10 code, e.g. `C34.1` (lung cancer). Drives disease-specific PK/PD model selection. |
| 25 | **Disease Severity** | Button group | — | `Mild` / `Moderate` / `Severe` / `Critical`. Adjusts baseline biomarker distributions. |
| 26 | **Comorbid Conditions** | Tag input | — | Add up to 10 ICD-10 conditions. Defaults include `Hypertension`, `T2DM`, `CKD Stage 3`. Affects drug interactions and clearance modelling. |

---

### Section 6 · Cohort Demographics

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 27 | **Cohort Size** | Slider | ✅ | Range: 500–10,000 virtual patients. Larger cohorts increase runtime and statistical power. Default: 2,500. |
| 28 | **Age Range** | Dual-range slider | ✅ | 0–100 years. Defines the age distribution of the simulated population. |
| 29 | **Sex Distribution** | Visual slider (%) | ✅ | Male/Female split. Must sum to 100%. Linked inputs — adjusting one auto-updates the other. |
| 30 | **Body Weight Range** | Dual-range slider | — | 30–200 kg. Used in volume-of-distribution and allometric scaling calculations. |

---

### Section 7 · Organ Function Parameters

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 31 | **eGFR Range** | Range slider | ✅ | 0–150 mL/min/1.73m². Estimated glomerular filtration rate — controls renal drug elimination. Auto-labels CKD stage (e.g. <30 = Stage 3+–5). |
| 32 | **ALT Range (Hepatic)** | Dual-range slider | — | 0–300 U/L (alanine aminotransferase). Indicates hepatic function. Affects hepatic clearance. |
| 33 | **LVEF Range (Cardiac)** | Dual-range slider | ✅ | 10–80%. Left Ventricular Ejection Fraction. Informs cardiac safety modelling and drug distribution. |

---

### Section 8 · Pharmacogenomic Parameters (PGx) *(collapsible)*

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 34 | **CYP2D6 Modelling** | Toggle | — | Models Poor / Intermediate / Extensive / Ultra-rapid metabolizer phenotypes. Affects ~25% of drugs. |
| 35 | **CYP3A4 Modelling** | Toggle | — | Major metabolic pathway. Relevant to ~50% of marketed drugs. |
| 36 | **CYP2C19 Modelling** | Toggle | — | Relevant to PPIs, antidepressants, antiplatelet agents. |
| 37 | **CYP2C9 Modelling** | Toggle | — | Warfarin-type metabolism. Key for anticoagulants and NSAIDs. |

---

### Section 9 · ADMET Profile

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 38 | **ADMET Source** | Radio group | — | `From Layer 1` (auto-populated from L1 outputs) or `Manual Entry` (override all 4 values below). |
| 39 | **Absorption Probability** | Number input | — | Range 0.0–1.0. Fraction of dose absorbed from GI tract. |
| 40 | **Distribution Volume** | Number input | — | Range 0.1–50.0 L/kg. Apparent volume of distribution (Vd). |
| 41 | **Metabolic Half-Life** | Number input | — | Range 0.1–200 hr. Time for plasma concentration to halve (t½). |
| 42 | **Renal Clearance** | Number input | — | Range 0–500 mL/min. Rate of drug elimination via kidneys. |
| 43 | **Toxicity Risk Vector** | Read-only display (editable) | — | Shows predicted risk bars for `hERG` (cardiac), `Hepatotox`, `Genotox` from Layer 1. |

---

### Section 10 · Dose & Administration

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 44 | **Starting Dose** | Number input | ✅ | Range 0.001–10,000. The first dose level in the escalation scheme. |
| 45 | **Dose Unit** | Dropdown | ✅ | `mg` / `mcg` / `mg/kg`. Linked to Starting Dose field. |
| 46 | **Escalation Scheme** | Dropdown | ✅ | `Linear` / `Modified Fibonacci` / `Bayesian Optimal Interval (BOIN)` / `3+3 Design`. Controls how dose increases between levels. |
| 47 | **Number of Dose Levels** | Stepper | ✅ | Range 2–8. Number of distinct dose cohorts to simulate. |
| 48 | **Route of Administration** | Dropdown | ✅ | `Oral` / `IV Bolus` / `IV Infusion` / `Subcutaneous` / `Intramuscular` / `Transdermal`. |
| 49 | **Dosing Frequency** | Dropdown | ✅ | `QD` (once daily) / `BID` / `TID` / `QW` (weekly) / `Q2W` / `Q4W` / `Single Dose`. |

---

## LAYER 3 — Trial Digital Twin
*Simulates a full clinical trial — predicts success probability, optimal sample size, enrollment trajectory, and cost.*  
**Estimated runtime:** 15–30 minutes

---

### Section 11 · Trial Design Parameters

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 50 | **Trial Phase** | Button group | ✅ | `Phase I` / `Phase I/II` / `Phase II` / `Phase II/III` / `Phase III`. Determines regulatory context and default power calculations. |
| 51 | **Study Type** | Dropdown | ✅ | `Randomized Controlled` / `Single-Arm + Synthetic Control` / `Open-Label` / `Crossover`. Single-Arm unlocks the Synthetic Control Arm section. |
| 52 | **Number of Arms** | Stepper | ✅ | Range 1–4. Each arm can represent a dose level, comparator, or placebo. |
| 53 | **Randomization Ratio** | Text input | — | Shown when arms ≥ 2. e.g. `1:1`, `2:1`, `1:1:1`. |
| 54 | **Blinding** | Dropdown | ✅ | `Open-Label` / `Single-Blind` / `Double-Blind` / `Triple-Blind`. Affects bias correction in outcome modelling. |
| 55 | **Primary Endpoint Type** | Dropdown | ✅ | `Time-to-Event` / `Continuous` / `Binary` / `Composite` / `Count`. Determines the statistical model used (e.g. Cox regression for TTE). |

---

### Section 12 · Endpoint Configuration

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 56 | **Primary Endpoint Name** | Text input | ✅ | Free text. e.g. `Overall Survival`, `Progression-Free Survival`, `RECIST Response Rate`. |
| 57 | **Measurement Type** | Dropdown | ✅ | `Months` / `Weeks` / `Days` / `Score` / `Percentage` / `Rate`. Units for the endpoint value. |
| 58 | **Assessment Timepoint** | Number input | ✅ | Time at which primary endpoint is measured (in units from field 57). e.g. `12` months. |
| 59 | **Effect Size (Δ)** | Number input | ✅ | Minimum clinically important difference (MCID). Used in sample size calculations. |
| 60 | **Secondary Endpoints** | Dynamic list (up to 5) | — | Each row has: endpoint name (text) + type (Time-to-Event / Continuous / Binary). Add/remove rows dynamically. |
| 61 | **Safety Endpoints** | Tag display | — | Auto-populated from Layer 2 adverse event predictions. e.g. `Grade ≥3 Neutropenia`, `ALT >3× ULN`, `QTc Prolongation`. Editable. |

---

### Section 13 · Population & Enrollment

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 62 | **Target Sample Size** | Toggle + number input | — | `Auto` (calculated from power, effect size, α): shows calculated value (e.g. ≈248). Or `Manual`: enter a fixed number (10–10,000). |
| 63 | **Number of Trial Sites** | Number input | ✅ | Range 1–200. Affects enrollment rate and site variability in simulation. |
| 64 | **Geographic Regions** | Multi-checkbox | ✅ | Select all that apply: `North America` / `Europe` / `Asia-Pacific` / `Latin America` / `MENA` / `Sub-Saharan Africa`. Each region uses its own enrollment rate priors. |

---

### Section 14 · Inclusion / Exclusion Criteria Builder

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 65 | **Criteria Source** | Radio group | — | `From Layer 2 (auto-generated)` / `Manual` / `Hybrid (L2 + edits)`. |
| 66 | **Criteria Rows** | Dynamic list | — | Each row is tagged `IN` (inclusion) or `EX` (exclusion) with a free-text criterion field. Add/remove rows freely. L2 auto-generates rows based on patient phenotypes. |

---

### Section 15 · Adaptive Design Rules *(collapsible)*

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 67 | **Adaptive Design** | Toggle | — | Master switch. Enables adaptive modification of sample size or randomization mid-trial based on interim results. |
| 68 | **Interim Analysis Timing** | Dropdown | — | `At 25% enrollment` / `At 50% enrollment` / `At 75% enrollment` / `Calendar-based` / `Information fraction-based`. |
| 69 | **Futility Boundary** | Dropdown | — | Statistical boundary to stop for futility: `O'Brien-Fleming` / `Pocock` / `Lan-DeMets`. |
| 70 | **Superiority Boundary** | Dropdown | — | Statistical boundary to stop early for efficacy: `O'Brien-Fleming` / `Pocock` / `Lan-DeMets`. |
| 71 | **Sample Size Re-estimation** | Toggle | — | Allows sample size to be re-calculated at interim based on observed effect size. |
| 72 | **Response-Adaptive Randomization** | Toggle | — | Shifts randomization ratio toward better-performing arms based on accumulating data (e.g. Bayesian adaptive allocation). |

---

### Section 16 · Synthetic Control Arm *(shown only when Study Type = Single-Arm + Synthetic Control)*

> These two fields are conditional — they replace a physical comparator arm with a statistically-matched historical control constructed from real-world data.

| Field | Type | Notes |
|-------|------|-------|
| **Matching Method** | Dropdown | `Propensity Score Matching` / `Inverse Probability Weighting` / `Exact Matching` / `CEM (Coarsened Exact)` |
| **Matching Variables** | Multi-checkbox | `Age` / `Sex` / `BMI` / `Disease Stage` / `Comorbidity Index` / `Baseline Labs` / `Prior Treatments` / `eGFR` / `LVEF` |

*Note: These are conditional sub-fields within field 51 (Study Type) and are not counted separately in the 72-field total.*

---

## Quick Summary by Layer

| Layer | Fields | Sections | Runtime | Key Output |
|-------|--------|----------|---------|------------|
| Layer 1 — Molecular Digital Twin | 23 | 4 | 5–30 sec | ADMET radar, binding affinity (nM), toxicity signals, batch rankings |
| Layer 2 — Patient Cohort Twin | 26 | 6 | 2–7 min | PK/PD curves, responder %, Cmax, AUC, adverse event projection |
| Layer 3 — Trial Digital Twin | 23 | 5 | 15–30 min | Trial success %, optimal sample size, enrollment timeline, cost estimate |
| **Total** | **72** | **15** | **~40 min end-to-end** | **Full BioDigital Twin simulation** |

---

## Input Type Breakdown

| Input Type | Count | Examples |
|------------|-------|---------|
| Text input / number field | 22 | SMILES, UniProt ID, dose, endpoints |
| Dropdown / Select | 16 | Therapeutic area, escalation scheme, blinding, endpoint type |
| Toggle (on/off) | 14 | Simulation modules, PGx enzymes, adaptive design switches |
| Slider (single or range) | 12 | Cohort size, age range, confidence threshold, eGFR, LVEF |
| Button group | 4 | Disease severity, trial phase, sex distribution |
| File upload | 2 | SDF/MOL2, Batch CSV |
| Multi-checkbox | 2 | Geographic regions, tissue types |
| Dynamic list | 2 | Secondary endpoints, I/E criteria rows |
| **Total** | **72** | |

---

## Data Flow Between Layers

```
SMILES / UniProt ID                 Layer 1 outputs cascade down
        │                                   │
        ▼                                   ▼
┌───────────────────┐         ┌─────────────────────────┐
│  Layer 1          │ ──────▶ │  Layer 2                 │
│  Molecular Twin   │         │  Patient Cohort Twin      │
│  5–30 sec         │         │  2–7 min                 │
└───────────────────┘         └─────────────────────────┘
  · ADMET scores                 · Populates ADMET Profile (§9)
  · Binding affinity             · Populates Safety Endpoints (§12)
  · Toxicity vector              · Informs I/E Criteria (§14)
                                         │
                                         ▼
                               ┌─────────────────────────┐
                               │  Layer 3                 │
                               │  Trial Digital Twin       │
                               │  15–30 min               │
                               └─────────────────────────┘
                                 · Trial success probability
                                 · Optimal sample size
                                 · Enrollment trajectory
                                 · Cost estimate ($M)
```

---

*Generated from HakaseAI source code — `artifacts/hakase-ai/src/pages/HakaseAI.tsx`*
