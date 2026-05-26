# HakaseAI — BioDigital Twin Platform
## User Manual · Version 1.0 · March 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Navigation & Layout](#2-navigation--layout)
3. [Project Management](#3-project-management)
4. [Layer 1 — Molecular Digital Twin](#4-layer-1--molecular-digital-twin)
5. [Layer 2 — Patient Cohort Twin](#5-layer-2--patient-cohort-twin)
6. [Layer 3 — Trial Digital Twin](#6-layer-3--trial-digital-twin)
7. [Diagen AI Integration](#7-diagen-ai-integration)
8. [3D Molecular Viewer](#8-3d-molecular-viewer)
9. [Exporting Results](#9-exporting-results)
10. [Quick Reference](#10-quick-reference)

---

## 1. Overview

HakaseAI is a **BioDigital Twin Platform** — a simulation engine that models the full drug development journey. You start with a candidate molecule and the platform predicts what will happen at every stage:

| Layer | Question Answered | Runtime |
|---|---|---|
| **Layer 1 — Molecular Twin** | Is this molecule safe and drug-like? | 5–30 seconds |
| **Layer 2 — Cohort Twin** | Which patients will respond, and at what dose? | 2–7 minutes |
| **Layer 3 — Trial Twin** | Will the clinical trial succeed? | 15–30 minutes |

Each layer builds on the previous one. Layer 1 outputs automatically populate Layer 2 inputs. Layer 2 outputs automatically populate Layer 3 inputs. You can run layers individually or as a full cascade.

---

## 2. Navigation & Layout

The interface is divided into four persistent zones:

```
┌─────────────────────────────────────────────────────────────┐
│  LOGO    [1] Molecular  >  [2] Cohort  >  [3] Trial   🔔 ⚙️ │  ← Top Bar
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│ PROJECTS │           MAIN CONTENT AREA                      │
│ SIDEBAR  │    (inputs on left, results on right)            │
│          │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

### Layer Stepper
The three-step pipeline at the top of every page. Click any step to jump to that layer:
- Active layer is highlighted in color (violet for Layer 1, blue for Layer 2, emerald for Layer 3)
- Completed layers show a checkmark
- Layers with a running simulation show a spinner

### Simulation Status Bar
When a simulation is running, a progress bar appears below the Layer Stepper showing:
- Which simulation is running (e.g., *Molecular Digital Twin*)
- Current substage (e.g., *ADMET prediction → Binding analysis → Toxicity screening*)
- Progress percentage
- A **Cancel** button

When complete, a success banner appears with a **Continue to [Next Layer] Simulation** button.

---

## 3. Project Management

### Projects Sidebar
The collapsible left panel manages all your work. Click the **‹** arrow to collapse it to icon-only mode.

**Current Project** (top section) shows:
- Molecule name (auto-filled from SMILES)
- Target UniProt ID
- Indication
- Layer progress bar (three segments: one per layer)

**Saved Projects** (below) lists all past projects. Click any project to load it into the workspace.

**+ New Project** at the bottom starts a fresh blank project.

### Importing a Project via API
Click **Import via API** in the sidebar to pull in an existing study or publication. Choose a source, enter the ID, and click **Fetch**:

| Source | What to enter | Example |
|---|---|---|
| ClinicalTrials.gov | NCT number | `NCT04292899` |
| EHR / Epic | Study or patient record ID | `PAT-001` |
| LIMS | LIMS record ID | `LIMS-2024-001` |
| PubMed | PMID | `36150754` |

A result card shows the project name, indication, phase, and sponsor. Click **Add** to save it to your project list.

---

## 4. Layer 1 — Molecular Digital Twin

> Answers: *Is this molecule safe and drug-like?*

### 4.1 Primary Molecular Input

This is where you define the molecule to simulate. You have four ways to provide it:

**Option A — Type a SMILES string**
Paste or type a valid SMILES string into the *SMILES String* field. The field validates in real-time using RDKit. Once valid, a green badge appears showing the molecular weight. A 2D structure preview renders below.

- Accepted range: molecular weight 100–1,500 Da
- Click **View 3D** to open the 3D Molecular Viewer

**Option B — Set a Molecule Name**
Optionally enter a human-readable label (e.g., `Compound-XYZ-001`). If left blank, a name is auto-generated from the SMILES.

**Option C — Upload a file**
- *SDF / MOL2 Upload:* drag and drop an `.sdf`, `.mol2`, or `.mol` file (max 10 MB). SMILES and 3D coordinates are extracted automatically.
- *Batch CSV:* upload a CSV with a `smiles` column header (max 500 rows) to process multiple molecules at once.

**Option D — Import from a compound database**
See [Section 4.2](#42-importing-from-compound-databases) below.

---

### 4.2 Importing from Compound Databases

Click **Import via API** (the globe icon panel) and pick one of five chemical databases:

| Database | ID format | Example |
|---|---|---|
| ChEMBL | CHEMBL + number | `CHEMBL521` (Ibuprofen) |
| PubChem | CID number | `3672` (Ibuprofen) |
| DrugBank | DB + number | `DB00530` (Erlotinib) |
| UniChem | UCI + number | `UCI2` |
| ZINC | ZINC + number | `ZINC000003594435` |

Click **Fetch**. A result card shows the compound name, SMILES, and molecular weight. Click **Use** to populate the main SMILES field.

---

### 4.3 Target Protein Configuration

To run binding simulation, specify a target protein:

| Field | What to enter | Example |
|---|---|---|
| **Target UniProt ID** | UniProt accession number | `P00533` (EGFR) |
| **PDB Structure ID** | Optional 4-char PDB code to override auto-selection | `4HJO` |
| **Therapeutic Area Preset** | Shortcut that pre-fills common targets | Oncology, CNS, Cardiovascular… |

If no UniProt ID is set, binding simulation is skipped and only ADMET + toxicity run.

---

### 4.4 Simulation Options

| Option | Default | Description |
|---|---|---|
| **ADMET Prediction** | Always ON (locked) | Core prediction. Cannot be disabled. |
| **Binding Simulation** | ON | ESM-2 + AutoDock docking. Requires UniProt ID. |
| **Toxicity Signal Detection** | ON | Cross-references FDA FAERS database for structural alerts. |
| **Behavioral Fingerprinting** | OFF | Simulates the molecule across multiple tissue environments. Adds ~10 seconds. |

When **Behavioral Fingerprinting** is enabled, a tissue selector appears. Choose at least one: Liver, Kidney, CNS, Cardiac, GI, Lung.

**Confidence Threshold** (slider, 0.50–0.95): controls how strict the system is when flagging potential risks. Lower = more flags; higher = only high-confidence risks flagged.

---

### 4.5 Batch Configuration *(collapsible)*

Only relevant when processing a Batch CSV upload:

| Field | Description |
|---|---|
| **Ranking Criteria** | How results are sorted: QED Score, Toxicity Risk, Binding Affinity, or Composite (weighted blend) |
| **Composite Weights** | Relative weight for QED, Toxicity, Binding, SA. Must sum to 1.0. |
| **Top-N Filter** | Show only the top N molecules (1–500) |

---

### 4.6 Running the Simulation

Click **Run Molecular Simulation**. Runtime: 5–30 seconds.

---

### 4.7 Reading the Results

After simulation, results appear in four tabs plus a summary card.

#### Go/No-Go Summary Card
The headline result. Displays one of three verdicts:
- **GO** (green) — advance to cohort simulation
- **CAUTION** (yellow) — review before proceeding
- **NO-GO** (red) — molecule does not meet criteria

Accompanied by:
- **Confidence Score** (e.g., 87.3%)
- **QED Score** (0–1): higher = more drug-like
- **Toxicity Risk**: Low / Medium / High
- **Binding Affinity** (nM): <50 nM = strong, 50–500 nM = moderate, >500 nM = weak
- **SA Score** (1–10): lower = easier to synthesize; scores below 4 are favorable
- **Similar approved drugs** (e.g., Erlotinib, Gefitinib, Osimertinib)

#### Tab 1 — ADMET Radar
A five-axis radar chart scored 0.0–1.0 for: Absorption, Distribution, Metabolism, Excretion, Toxicity. Higher scores are better on all axes.

Below the chart: **Lipinski Rule of Five** compliance panel (MW, LogP, HBD, HBA).

#### Tab 2 — Binding Affinity Heatmap
A matrix showing binding metrics (Kd, Ki, IC50, Selectivity) across the target and related off-targets. Color-coded: green = strong, yellow = moderate, red = weak. Click any cell to open the docking pose in the 3D Viewer.

#### Tab 3 — Toxicity Signal Panel
Organ cards for: Liver, Heart (hERG), Kidney, CNS, GI Tract, Lung. Each shows a risk score and any structural alerts. Cards with no risks display "No structural alerts" in green.

#### Tab 4 — Batch Comparison Table *(batch mode only)*
Sortable table: Rank, Name, QED, Toxicity, Binding, SA Score, Composite. Pareto-optimal rows are highlighted. Export as CSV.

---

## 5. Layer 2 — Patient Cohort Twin

> Answers: *Which patients will respond, and at what dose?*

### 5.1 Indication & Disease

| Field | Description |
|---|---|
| **Primary Indication (ICD-10)** | The target disease. Search by name or ICD-10 code (e.g., `C34.1` for NSCLC). Required. |
| **Disease Severity** | Filter the virtual cohort: Mild / Moderate / Severe / Critical |
| **Comorbid Conditions** | Additional conditions (up to 10). Enter as ICD-10 codes with autocomplete. |

---

### 5.2 Cohort Demographics

| Field | Range | Description |
|---|---|---|
| **Cohort Size** | 500–10,000 | Number of virtual patients. Larger = more robust results, slower runtime. |
| **Age Range** | 0–100 yrs | Dual-handle slider. Set minimum and maximum patient age. |
| **Sex Distribution** | Must sum to 100% | Set Male % and Female %. A warning appears if they don't sum to 100. |
| **Body Weight Range** | kg | Affects volume of distribution calculations. |

---

### 5.3 Organ Function Parameters

Organ function affects how virtual patients process and clear the drug.

| Field | Description |
|---|---|
| **eGFR Range** | Renal function (mL/min/1.73m²). Slider shows the corresponding CKD stage. |
| **ALT Range** | Liver enzyme (U/L). Higher values indicate hepatic impairment. |
| **LVEF Range** | Cardiac function (%). Relevant for drugs with hERG risk. |

---

### 5.4 Pharmacogenomics

Toggle which CYP450 enzyme variants to model in the virtual population:

| Toggle | What it models |
|---|---|
| **CYP2D6** | Metabolizer variation. Important for CNS drugs, beta-blockers, opioids. |
| **CYP3A4** | Metabolizes ~50% of all drugs. |
| **CYP2C19** | Important for PPIs and some antidepressants. |

---

### 5.5 PK/PD Parameters

The ADMET Source selector determines where these values come from:
- **From Layer 1 (recommended):** auto-populated from your Molecular Twin results. Values are editable if you need to override.
- **Manual Entry:** enter your own values from external lab assays.

| Parameter | Unit | Description |
|---|---|---|
| Absorption Probability | 0.0–1.0 | Fraction of drug absorbed in the GI tract. |
| Distribution Volume | L/kg | How widely the drug distributes into tissues. |
| Metabolic Half-Life | hours | Time for plasma concentration to halve. Drives dosing frequency. |
| Renal Clearance | mL/min | Rate of kidney-based elimination. |
| Toxicity Risk Vector | 0.0–1.0 each | hERG, Hepatotox, Genotox scores (read-only when auto-populated). |

---

### 5.6 Dose & Administration

| Field | Options | Description |
|---|---|---|
| **Starting Dose** | mg / mcg / mg/kg | First dose level (0.001–10,000). |
| **Escalation Scheme** | Linear, Modified Fibonacci, BOIN, 3+3 | How dose levels increase. |
| **Dose Levels** | 2–8 | Number of dose levels to simulate. |
| **Route of Administration** | Oral, IV Bolus, IV Infusion, Subcutaneous, Intramuscular, Transdermal | Affects absorption modeling. |
| **Dosing Frequency** | QD, BID, TID, QW, Q2W, Q4W, Single Dose | How often the dose is given. |

Click **Run Cohort Simulation**. Runtime: 2–7 minutes.

---

### 5.7 Reading the Results

#### Summary Header Cards
- **Responder Rate**: % of virtual cohort that responded (e.g., 58.4% at 200 mg QD)
- **Cmax Mean**: peak plasma concentration ± SD (e.g., 2,847 ± 412 ng/mL)
- **AUC₀₋₂₄**: total drug exposure over 24 hours
- **Grade ≥3 AEs**: projected serious adverse event incidence (e.g., 12.3%)

#### Tab 1 — PK/PD Curves
Multi-line concentration vs. time chart for each dose level. A shaded **Therapeutic Window** band shows the safe and effective concentration range. Hover to see Cmax, Tmax, and AUC at any point.

#### Tab 2 — Responders
Donut chart: Responder / Partial / Non-responder breakdown. Plus a waterfall plot of individual patient responses sorted highest to lowest.

#### Tab 3 — Adverse Events
Sortable table of predicted adverse events (MedDRA terms): Adverse Event, Incidence %, severity split (Mild / Moderate / Severe), and Onset (days).

#### Tab 4 — Subgroup Analysis
Heatmap pivoting subgroup rows (age, sex, ethnicity, organ function) against metric columns (Response Rate, AE Rate, Cmax, AUC, PFS). Click any cell to drill into that subgroup.

#### Tab 5 — Dose-Response Curve
Response rate (%) vs. dose level with 95% CI bands. Two key markers:
- **RP2D** — Recommended Phase 2 Dose
- **MTD** — Maximum Tolerated Dose

#### Export
- **CSV** — raw data
- **PDF Report** — full formatted results
- **Export I/E Criteria to Layer 3** — passes responder-derived eligibility criteria directly to the Trial Twin

---

## 6. Layer 3 — Trial Digital Twin

> Answers: *Will the clinical trial succeed?*

This layer simulates an entire clinical trial before a single real patient is enrolled. It can prevent multi-million-dollar failures by identifying design flaws early.

### 6.1 Trial Design Parameters

| Field | Options | Description |
|---|---|---|
| **Trial Phase** | Phase I / I-II / II / II-III / III | Determines default parameter ranges. |
| **Study Type** | Randomized Controlled, Single-Arm + Synthetic Control, Open-Label, Crossover | Selecting *Single-Arm + Synthetic Control* unlocks the Synthetic Control Arm panel. |
| **Number of Arms** | 1–4 | 1 = single-arm, 2 = standard two-arm, 3–4 = multi-arm. |
| **Randomization Ratio** | e.g., 1:1 or 2:1 | Allocation between arms. |
| **Blinding** | Open-Label, Single-Blind, Double-Blind, Triple-Blind | Affects dropout and bias modeling. |
| **Primary Endpoint Type** | Time-to-Event, Continuous, Binary, Composite, Count | Determines the statistical model used in simulation. |

---

### 6.2 Endpoint Configuration

**Primary Endpoint** — the main outcome the trial is designed to detect:

| Field | Example |
|---|---|
| Endpoint Name | Progression-Free Survival |
| Measurement Type | Months |
| Assessment Timepoint | 12 months |
| Effect Size (Δ) | Hazard ratio, mean difference, or absolute risk difference |

**Secondary Endpoints** — add up to 5 via the **+** button (remove with **–**).

**Safety Endpoints** — auto-populated from Layer 2 adverse event predictions. Shown as editable chips.

---

### 6.3 Population & Enrollment

| Field | Description |
|---|---|
| **Target Sample Size** | Set to *Auto* to let the optimizer calculate, or enter manually (10–10,000). |
| **Number of Sites** | How many clinical sites to include. Affects enrollment speed and cost. |
| **Geographic Regions** | North America, Europe, Asia-Pacific, Latin America, Middle East. |

---

### 6.4 Eligibility Criteria Builder

Build inclusion and exclusion criteria row by row. Each row has:
- **Type**: Inclusion or Exclusion
- **Category**: Demographics, Labs, Medical History, Concomitant Medications
- **Operator**: range, greater than, less than, equals, excludes
- **Value**: free text (e.g., `18–75 years`, `eGFR ≥ 30 mL/min`)

Use **+ Add Criterion** and the trash icon to manage rows.

---

### 6.5 Adaptive Design Rules *(collapsible)*

Enable the **Adaptive Design** toggle to unlock:

| Field | Options |
|---|---|
| Interim Analysis Timing | At 25% / 50% / 75% enrollment, Calendar-based, Information fraction-based |
| Futility Boundary | O'Brien-Fleming (conservative), Pocock (aggressive), Lan-DeMets |
| Superiority Boundary | O'Brien-Fleming, Pocock, Lan-DeMets |
| Sample Size Re-estimation | Toggle (allows mid-trial adjustment) |
| Response-Adaptive Randomization | Toggle (shifts allocation to better-performing arm) |

---

### 6.6 Synthetic Control Arm *(collapsible — only with Single-Arm study type)*

Builds a virtual placebo group from real-world patient data to replace a physical control arm.

| Field | Options / Description |
|---|---|
| **Matching Method** | Propensity Score Matching, Inverse Probability Weighting, Exact Matching, CEM |
| **Matching Variables** | Age, Sex, BMI, Disease Stage, Comorbidity Index, Baseline Labs, Prior Treatments, eGFR, LVEF |
| **Balance Threshold (SMD)** | 0.01–0.25. Values below 0.10 indicate good balance. |
| **Data Sources** | MIMIC-IV (~47K pts), HCUP (~8M pts), All of Us (~312K pts) |

---

### 6.7 Simulation Parameters

| Field | Range | Description |
|---|---|---|
| **Monte Carlo Replications** | 100–10,000 | More replications = more precise but slower. 1,000 is a good default. |
| **Significance Level (α)** | e.g., 0.05 | Standard 95% confidence = 0.05. |
| **Power Target (1-β)** | e.g., 0.80 | 80% probability of detecting a true effect = 0.80. |
| **Annual Dropout Rate** | 0–50% | Only visible when Dropout Modeling is ON. |
| **Dropout Pattern** | Uniform, Front-loaded, Back-loaded, Exponential | How dropouts distribute over time. |

Click **Run Trial Simulation**. Runtime: 15–30 minutes.

---

### 6.8 Reading the Results

#### Summary Header Cards
| Card | Example |
|---|---|
| **Trial Success Probability** | 72.4% (95% CI: 64.1–80.7%) |
| **Optimal Sample Size** | 248 (for 80% power at α=0.05) |
| **Projected Duration** | 34 months (enrollment + follow-up) |
| **Estimated Cost** | $24.7M ± $3.2M |

#### Tab 1 — Success Probability Gauge
Semicircular gauge with three color zones: red (<50%), yellow (50–70%), green (>70%). Below the gauge: **Key Risk Factors** (Statistical Power, Enrollment Feasibility, Dropout Risk, Site Quality, Regulatory Pathway).

#### Tab 2 — Enrollment Trajectory
Projected cumulative enrollment over time with a 95% CI band and a target line.

#### Tab 3 — Power Curve
Power (y-axis) vs. sample size (x-axis). An 80% target line is drawn. The current design point (e.g., n=248) is marked.

#### Tab 4 — Balance Report
Covariate balance between treatment and synthetic control groups. Columns: Variable, Treatment, Control, SMD, Status. SMD values above 0.10 are flagged. Use **Re-run Matching with Adjusted Parameters** to iterate.

#### Tab 5 — Site Ranking
Top clinical sites ranked by composite score (enrollment rate, quality score). Shows region and per-site metrics.

#### Tab 6 — Cost Summary
Total cost breakdown by category (Site Operations, Drug Supply, Clinical Monitoring, Lab & Biomarker). Shows cost per patient and cost per site. Toggle between USD / EUR / JPY.

---

## 7. Diagen AI Integration

Diagen AI is Hakase's companion molecule *generation* platform. HakaseAI is the *simulation* platform. Together they form the complete pipeline:

```
DIAGEN (Generate) → LAYER 1 (Simulate Molecule) → LAYER 2 (Simulate Patients) → LAYER 3 (Simulate Trial)
```

### Importing a Molecule from Diagen

In Layer 1, click the **Import from Diagen AI** panel (violet border, "Hakase Ecosystem" badge).

**Step 1 — Choose an Integration Mode:**

| Mode | Use when | Speed |
|---|---|---|
| **Synchronous** | Importing a single molecule immediately | <30 seconds |
| **Async Batch** | Importing results from a Diagen batch run via webhook | ~2 minutes |
| **Cascade** | Running the full L1 → L2 → L3 pipeline automatically | Full simulation time |

> Cascade mode triggers all three simulation layers in sequence automatically. Results propagate without manual intervention.

**Step 2 — Enter a Molecule ID or Job ID:**
- For Synchronous or Cascade: enter a Diagen Molecule ID (e.g., `DGN-MOL-0047`)
- For Async Batch: enter a Diagen Batch Job ID (e.g., `DGN-BATCH-2024-Q1`)

**Step 3 — Click Fetch**

The result card shows everything Diagen passes over:
- Molecule name and SMILES string
- Molecular weight
- Target protein (UniProt ID + name)
- **QED Score**, **SA Score**, **Estimated Binding Affinity** (pre-calculated by Diagen)
- **ADMET Pre-scores** — five mini progress bars for Absorption, Distribution, Metabolism, Excretion, Toxicity

**Step 4 — Import**

Two options:
- **Import All Fields** — populates SMILES, Molecule Name, and Target UniProt ID in one click
- **SMILES only** — populates only the structure field, leaving the rest for manual entry

### Demo Molecule IDs to try:
| ID | Molecule | Target |
|---|---|---|
| `DGN-MOL-0047` | HAK-EGFR-047 | EGFR (P00533) |
| `DGN-MOL-0112` | HAK-KRAS-112 | KRAS (P01116) |
| `DGN-MOL-0231` | HAK-CDK4-231 | CDK4 (P11802) |
| `DGN-BATCH-2024-Q1` | HAK-BTK-Batch-Top1 | BTK (Q06187) |

---

## 8. 3D Molecular Viewer

Access the 3D viewer by clicking **View 3D** on a validated SMILES, or by clicking one of the three viewer mode buttons in the right panel of Layer 1:

| Mode | Icon | Description |
|---|---|---|
| **Cinematic** | 🎬 | Immersive, presentation-quality rendering with dramatic lighting |
| **Scientific** | 🔬 | Split-panel view for detailed structural analysis |
| **Explorer** | 🧬 | Multi-molecule comparison mode |

The viewer shows the molecule name, SMILES preview, and a **Live Preview** badge. Close via the **×** button.

---

## 9. Exporting Results

Each layer offers export options after simulation:

| Layer | Export options |
|---|---|
| **Layer 1** | PNG (charts), PDF Report, JSON (raw data), CSV (batch table) |
| **Layer 2** | CSV (raw data), PDF Report, Export I/E Criteria to Layer 3 |
| **Layer 3** | Export CSV, Generate Full Report |

---

## 10. Quick Reference

### Simulation Runtimes
| Layer | Minimum | Typical | Maximum |
|---|---|---|---|
| Molecular Twin | 5 seconds | 15 seconds | 30 seconds |
| Cohort Twin | 2 minutes | 4 minutes | 7 minutes |
| Trial Twin | 15 minutes | 20 minutes | 30 minutes |

### Key Thresholds
| Metric | Threshold |
|---|---|
| QED Score (drug-likeness) | >0.6 = favorable |
| SA Score (synthesizability) | <4.0 = favorable |
| Binding Affinity | <50 nM = strong; 50–500 nM = moderate; >500 nM = weak |
| SMD (covariate balance) | <0.10 = good balance |
| Trial Success Probability | >70% = high confidence |
| MW (Lipinski) | ≤500 Da |
| LogP (Lipinski) | ≤5 |

### Common Workflows

**Single molecule screen**
1. Layer 1 → paste SMILES → Run → review Go/No-Go

**Full pipeline from scratch**
1. Layer 1 → enter SMILES + UniProt ID → Run
2. Layer 2 → confirm ADMET auto-populated → set dose + cohort → Run
3. Layer 3 → confirm I/E criteria auto-populated → set trial design → Run

**Diagen-to-BioTwin pipeline**
1. Layer 1 → Import from Diagen AI → enter Molecule ID → Import All Fields → Run
2. Continue through Layer 2 and Layer 3 as above

**Batch compound screening**
1. Layer 1 → upload Batch CSV → configure Ranking Criteria → Run
2. Review Batch Comparison Table → filter Pareto-optimal compounds → export CSV

**Single-arm trial with synthetic control**
1. Layer 3 → Study Type: Single-Arm + Synthetic Control → configure Synthetic Control Arm panel → Run

---

*HakaseAI v1.0 · Hakase AI · March 2026 · Confidential*
