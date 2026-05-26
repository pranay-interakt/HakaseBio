# HakaseAI — Full Term & Vocabulary Reference

> Organized by layer and functional area, in the order they appear in the product.
> Every label, field name, option, output metric, and UI term used across the platform.

---

## Platform & Navigation

**HakaseAI** · BioDigital Twin Platform · v1.0

### Top Navigation
- Layer Stepper
- Layer 1 · Molecular · (icon: Flask)
- Layer 2 · Cohort · (icon: Users)
- Layer 3 · Trial · (icon: Beaker)
- Notifications · Settings · User Avatar (HC)

### Simulation Status Bar
- Layer Simulation Running
- Molecular Digital Twin
- Patient Cohort Twin
- Trial Digital Twin
- Progress %
- Cancel
- Layer simulation complete
- Continue to [Layer] Simulation

---

## Projects Sidebar

### Current Project
- Current Project
- Molecule name (auto-populated)
- UniProt ID
- Indication
- Layer progress bars (3 segments: complete / running / idle)

### Saved Projects
- Saved Projects
- Project Name
- Indication
- Layer progress indicator
- New Project

### Import via API (Project Import)
- Import via API
- Source (section label)
  - ClinicalTrials
  - EHR / Epic
  - LIMS
  - PubMed
- NCT Number (input label when ClinicalTrials selected)
- PMID (input label when PubMed selected)
- Study / Record ID (input label for EHR / LIMS)
- Placeholders: NCT04292899 · 36150754 · PAT-001 · LIMS-2024-001
- Fetch button
- Result card fields: project name · indication · phase · sponsor
- Add (button to add result to Saved Projects)

### Preset project names (mock data)
- Ibuprofen-Analog-001
- CDK4/6 Inhibitor Screen (Breast Cancer)
- EGFR-T790M Mutant (NSCLC)
- KRAS G12C Series (Colorectal)

### Preset project import examples
- Osimertinib NSCLC Study — Phase III — AstraZeneca
- KRAS G12C Inhibitor AMG510 — Phase II — Amgen
- CDK4/6 + Letrozole HR+ BC — Phase III — Novartis
- Pembrolizumab NSCLC — Phase II — Merck
- BTK Inhibitor CLL Trial — Phase III — AbbVie
- EGFR-T790M Cohort Study — Real-World — Internal EHR
- HER2+ Breast Cohort — Real-World — Internal EHR
- GI Toxicity Assessment — Observational — Site LIMS
- Compound Library Screen A — Pre-clinical — Internal R&D
- ADMET Panel Q1-2024 — Pre-clinical — DMPK Dept.
- Erlotinib Resistance Mechanisms — Literature — Dana-Farber
- KRAS G12C Covalent Inhibitors — Literature — UCSF / Nature
- Osimertinib vs Gefitinib — Literature — NEJM

---

## Layer 1 — Molecular Digital Twin

> Configure molecular structure and simulation parameters

### Section: Primary Molecular Input

**Fields**
- SMILES String *(required)* — hint: RDKit validated · MW 100–1500 Da
  - Placeholder: Enter SMILES notation…
  - Valid structure badge: MW ≈ [X] Da · [N] chars
  - View 3D (button)
- Molecule Name — hint: Auto-generated if blank
  - Placeholder: e.g. Compound-XYZ-001

**Upload Options**
- SDF / MOL2 Upload — .sdf, .mol2, .mol · 10MB
- Batch CSV — CSV with 'smiles' col · 500 rows

**Import via API (Molecular)**
- Import via API
- Source Database (section label)
  - ChEMBL — hint: CHEMBL25
  - PubChem — hint: CID 3672
  - DrugBank — hint: DB01050
  - UniChem — hint: UCI2
  - ZINC — hint: ZINC…
- Compound ID / Name (input label)
  - Placeholders: CHEMBL25 · 3672 · DB01050 · UCI2 · ZINC000003594435
- Fetch / Fetching… (button states)
- Result card fields: compound name · SMILES · MW
- Use (button to populate main fields)

**Compound examples in mock database**
- Aspirin (CHEMBL25 / 2244 / DB00945 / UCI1)
- Ibuprofen (CHEMBL521 / 3672 / DB01050 / UCI2 / ZINC000003594435)
- Gefitinib (CHEMBL255863 / 123631 / DB00317)
- Erlotinib (CHEMBL1201328 / 176870 / DB00530 / UCI3 / ZINC000019632618)
- Osimertinib (CHEMBL941)
- Metformin (5291)
- Imatinib (DB00619)

---

### Section: Target Protein Configuration

**Fields**
- Target UniProt ID — hint: Required for binding simulation
  - Placeholder: e.g. P12345
  - Resolved label: EGFR · Epidermal growth factor receptor
- PDB Structure ID — hint: Overrides auto-selected structure
  - Placeholder: e.g. 4HJO
- Therapeutic Area Preset
  - Oncology
  - CNS
  - Cardiovascular
  - Metabolic
  - Rare Disease
  - Infectious Disease
  - Immunology

---

### Section: Simulation Options

**Toggles**
- ADMET Prediction — Always on — core prediction *(locked)*
- Binding Simulation — ESM-2 + docking pipeline
- Toxicity Signal Detection — FAERS cross-reference
- Behavioral Fingerprinting — Multi-tissue · adds ~10s

**Behavioral Fingerprinting — Tissue Types**
- Liver · Kidney · CNS · Cardiac · GI · Lung

**Fields**
- Confidence Threshold: [0.50–0.95] — 0.50 Low / 0.95 High

---

### Collapsible: Batch Configuration

**Fields**
- Ranking Criteria
  - QED Score
  - Toxicity Risk (ascending)
  - Binding Affinity
  - Composite (weighted)
- Composite weights (sliders): QED · Toxicity · Binding · SA
- Top-N Filter (number input, 1–500)

**Run Button**
- Run Molecular Simulation / Simulating…
- Est. runtime: 5–30 seconds

---

### Layer 1 — Output Results

**Go/No-Go Summary Card**
- GO / NO-GO (recommendation)
- Recommendation: Advance to Cohort Simulation
- Confidence Score: 87.3%
- Similar approved drugs: Erlotinib · Gefitinib · Osimertinib
- QED Score: 0.72
- Toxicity Risk: Low
- Binding Affinity: 12.4 nM
- SA Score: 2.8

**Output Tabs**
- ADMET Radar
- Binding
- Toxicity
- Batch Table

**Export options**
- Export PNG · PDF Report · Export JSON

---

#### ADMET Radar Chart

**Axes (scores 0.0–1.0)**
- Absorption: 0.82
- Distribution: 0.68
- Metabolism: 0.74
- Excretion: 0.71
- Toxicity: 0.88

**Drug-likeness (Lipinski Rules)**
- MW ≤ 500: 206 Da
- logP ≤ 5: 3.2
- HBD ≤ 5: 2
- HBA ≤ 10: 4

---

#### Binding Affinity Heatmap

**Target proteins**
- EGFR (P00533)
- HER2 (P04626)
- HER3 (P21860)

**Metrics**
- Kd (nM)
- Ki (nM)
- IC50 (nM)
- Selectivity

**Legend**
- Strong binding · Moderate · Weak

---

#### Toxicity Signal Panel

**Organs / Systems**
- Liver — alert: CYP3A4 substrate
- Heart (hERG) — alert: Minor QT prolongation risk
- Kidney
- CNS — alerts: BBB penetrant · CNS active class
- GI Tract
- Lung

**Alert states**
- No structural alerts
- ⚠ [alert text]

---

#### Batch Comparison Table

**Columns**
- # (rank) · Name · QED · Toxicity · Binding · SA Score · Composite

**Toxicity classifications**
- Low · Medium · High

**Highlights**
- Pareto-optimal highlighted

**Actions**
- CSV (export)

---

## Layer 2 — Patient Cohort Twin

> Configure virtual patient population for PK/PD simulation

### Section: Indication & Disease

**Fields**
- Primary Indication (ICD-10) *(required)*
  - Default: C34.1 – Non-small-cell lung carcinoma
- Disease Severity
  - Mild · Moderate · Severe · Critical
- Comorbid Conditions — hint: Max 10 · ICD-10 codes
  - Example tags: Hypertension · T2DM · CKD Stage 3
  - Add button

---

### Section: Cohort Demographics

**Fields**
- Cohort Size: [500–10,000] patients *(required)*
- Age Range *(required)* — [0–100] yrs
- Sex Distribution *(required)*
  - Male % · Female % — must sum to 100%
- Body Weight Range — [kg]
- eGFR Range — [mL/min/1.73m²]
- ALT Range — [U/L]
- LVEF Range — [%]

---

### Section: Pharmacogenomics

**CYP Enzyme Toggles**
- CYP2D6 (toggle)
- CYP3A4 (toggle)
- CYP2C19 (toggle)

---

### Section: PK/PD Parameters (ADMET Source)

**Fields**
- ADMET Source
  - From Layer 1 (auto-populated)
  - Manual Entry
- Auto-populated from Layer 1 results (status badge)
- Absorption Probability — hint: 0.0–1.0
- Distribution Volume — unit: L/kg, hint: 0.1–50.0
- Metabolic Half-Life — unit: hr, hint: 0.1–200
- Renal Clearance — unit: mL/min, hint: 0–500

**Toxicity Risk Vector** (read-only display)
- hERG: 0.12
- Hepatotox: 0.08
- Genotox: 0.04

---

### Section: Dose & Administration

**Fields**
- Starting Dose *(required)* — hint: 0.001–10,000
  - Units: mg · mcg · mg/kg
- Escalation Scheme *(required)*
  - Linear
  - Modified Fibonacci
  - Bayesian Optimal Interval (BOIN)
  - 3+3 Design
- Dose Levels *(required)* — stepper [2–8]
- Route of Administration *(required)*
  - Oral · IV Bolus · IV Infusion · Subcutaneous · Intramuscular · Transdermal
- Dosing Frequency *(required)*
  - QD · BID · TID · QW · Q2W · Q4W · Single Dose

**Run Button**
- Run Cohort Simulation / Simulating Cohort…
- Est. runtime: 2–7 minutes

---

### Layer 2 — Output Results

**Summary Header Cards**
- Responder Rate: 58.4% — at 200 mg QD
- Cmax Mean: 2,847 ng/mL — ±412 ng/mL SD
- AUC₀₋₂₄: 28,100 ng·h/mL — at therapeutic dose
- Grade ≥3 AEs: 12.3% — projected incidence

**Output Tabs**
- PK/PD Curves
- Responders
- Adverse Events
- Subgroup
- Dose-Response

**Export / Actions**
- CSV · PDF · Export I/E Criteria to Layer 3

---

#### PK/PD Concentration Curves

- PK/PD Concentration Curves (chart title)
- Therapeutic Window (region label)
- Doses: 100 mg QD · 200 mg QD · 400 mg QD · 800 mg QD
- X-axis: time in hours (0h · 1h · 2h · 4h · 6h · 8h · 12h · 24h)
- Y-axis: Conc (ng/mL)

---

#### Responder Classification

- Responder: 58.4%
- Partial: 24.1%
- Non-responder: 17.5%
- Response Rate (donut center label)

---

#### Adverse Event Predictions

**Table columns**
- Adverse Event · Incidence · Mild · Moderate · Severe · Onset (d)

**Adverse events listed**
- Nausea — 28.4% incidence — Day 3 onset
- Fatigue — 22.1% incidence — Day 7 onset
- Neutropenia (Gr ≥3) — 12.3% incidence — Day 21 onset
- ALT Elevation — 8.9% incidence — Day 14 onset
- QTc Prolongation — 4.2% incidence — Day 10 onset

---

#### Subgroup Analysis Heatmap

**Subgroup rows**
- 18–40 yrs · 41–60 yrs · 61–75 yrs
- Male · Female
- White · Hispanic · Asian
- eGFR >90 · eGFR 30–60

**Metric columns**
- Response Rate · AE Rate · Cmax · AUC · PFS

---

#### Dose-Response Curve

- Dose-Response Curve (chart title)
- Doses: 50 mg · 100 mg · 200 mg · 400 mg · 800 mg
- Y-axis: response rate (%)
- RP2D (Recommended Phase 2 Dose marker)
- MTD (Maximum Tolerated Dose marker)
- 95% CI band

---

## Layer 3 — Trial Digital Twin

> Configure clinical trial design, endpoints, and simulation parameters

### Section: Trial Design Parameters

**Fields**
- Trial Phase *(required)*
  - Phase I · Phase I/II · Phase II · Phase II/III · Phase III
- Study Type *(required)*
  - Randomized Controlled
  - Single-Arm + Synthetic Control
  - Open-Label
  - Crossover
- Number of Arms *(required)* — stepper [1–4]
- Randomization Ratio — e.g. 1:1
- Blinding *(required)*
  - Open-Label · Single-Blind · Double-Blind · Triple-Blind
- Primary Endpoint Type *(required)*
  - Time-to-Event · Continuous · Binary · Composite · Count

---

### Section: Endpoint Configuration

**Fields**
- Primary Endpoint Name *(required)* — e.g. Overall Survival
  - Default: Progression-Free Survival
- Measurement Type *(required)*
  - Months · Weeks · Days · Score · Percentage · Rate
- Assessment (timepoint) *(required)*
- Effect Size (Δ) *(required)*

**Secondary Endpoints** (up to 5)
- Endpoint name (text input)
- Type: Time-to-Event · Continuous · Binary
- Add / Remove controls
- Default: Overall Survival — Time-to-Event — 24 months

**Safety Endpoints** — hint: Auto-populated from Layer 2
- Grade ≥3 Neutropenia
- ALT >3× ULN
- QTc Prolongation
- Nausea/Vomiting

---

### Section: Population & Enrollment

**Fields**
- Target Sample Size — Auto toggle / manual input [10–10,000]
- Number of Sites — (text input)
- Geographic Regions (multi-select)
  - North America · Europe · Asia-Pacific · Latin America · Middle East

---

### Section: Eligibility Criteria Builder

**Criteria row fields**
- Type: Inclusion / Exclusion
- Category: Demographics · Labs · Medical History · Concomitant Medications
- Operator: range · greater than · less than · equals · excludes
- Value (free text)
- Add Criterion / Remove row

**Default rows**
- Inclusion · Demographics · range · 18–75 years
- Inclusion · Labs · greater than · eGFR ≥ 30 mL/min
- Exclusion · Medical History · excludes · Active CNS metastases

---

### Collapsible: Adaptive Design Rules

**Fields**
- Adaptive Design (toggle)
- Interim Analysis Timing
  - At 25% enrollment
  - At 50% enrollment
  - At 75% enrollment
  - Calendar-based
  - Information fraction-based
- Futility Boundary
  - O'Brien-Fleming · Pocock · Lan-DeMets
- Superiority Boundary
  - O'Brien-Fleming · Pocock · Lan-DeMets
- Sample Size Re-estimation (toggle)
- Response-Adaptive Randomization (toggle)

---

### Collapsible: Synthetic Control Arm

*(visible when Study Type = Single-Arm + Synthetic Control)*

**Fields**
- Matching Method
  - Propensity Score Matching
  - Inverse Probability Weighting
  - Exact Matching
  - CEM (Coarsened Exact)
- Matching Variables (checkboxes)
  - Age · Sex · BMI · Disease Stage · Comorbidity Index · Baseline Labs · Prior Treatments · eGFR · LVEF
- Balance Threshold (SMD): [0.01–0.25] slider
- Data Sources (checkboxes)
  - MIMIC-IV (~47K pts)
  - HCUP (~8M pts)
  - All of Us (~312K pts)

---

### Section: Simulation Parameters

**Fields**
- Monte Carlo Replications: [100–10,000] *(required)*
  - 100 (fast) / 10,000 (precise)
- Significance Level (α) *(required)*
- Power Target (1-β) *(required)*

**Collapsible: Dropout Modeling**
- Enable Dropout Simulation (toggle)
- Annual Dropout Rate: [0–50%] slider
- Dropout Pattern
  - Uniform · Front-loaded · Back-loaded · Exponential

**Run Button**
- Run Trial Simulation / Simulating Trial…
- Est. runtime: 15–30 minutes

---

### Layer 3 — Output Results

**Summary Header Cards**
- Trial Success Probability: 72.4% — 95% CI: 64.1–80.7%
- Optimal Sample Size: 248 — for 80% power at α=0.05
- Projected Duration: 34 months — enrollment + follow-up
- Estimated Cost: $24.7M — ±$3.2M sensitivity range

**Output Tabs**
- Success Prob.
- Enrollment
- Power Curve
- Balance Report
- Site Ranking
- Cost

**Export / Actions**
- Export CSV · Generate Full Report

---

#### Trial Success Probability (Gauge)

- Trial Success Probability (chart title)
- HIGH CONFIDENCE
- Risk zones: <50% (red) · 50–70% (yellow) · >70% (green)

**Key Risk Factors**
- Statistical Power: 80.2%
- Enrollment Feasibility: High
- Dropout Risk: Medium
- Site Quality: High
- Regulatory Pathway: Standard

---

#### Enrollment Trajectory

- Enrollment Trajectory (chart title)
- Target (dashed line)
- Expected enrollment (solid curve)
- 95% CI band
- X-axis: M0 · M6 · M12 · M18 · M24 (months)
- Y-axis: cumulative patients enrolled

---

#### Power Curve

- Power Curve (chart title)
- X-axis: Sample Size
- Y-axis: Power (1-β)
- 80% target line
- n=248 marker (current design)

---

#### Synthetic Arm Balance Report

- Synthetic Arm Balance Report (chart title)
- SMD threshold: 0.10

**Table columns**
- Variable · Treatment · Control · SMD · Status

**Covariates checked**
- Age (years)
- Sex (% male)
- Disease Stage
- ECOG Score
- BMI
- eGFR
- Prior Lines Tx

**Actions**
- Re-run Matching with Adjusted Parameters

---

#### Site Ranking Table

**Table columns**
- # · Site · Region · Enrollment/mo · Quality Score · Composite

**Example sites**
- Johns Hopkins, Baltimore — North America
- Royal Marsden, London — Europe
- MD Anderson, Houston — North America
- Memorial Sloan Kettering — North America
- Tokyo Medical Univ. — Asia-Pacific

---

#### Cost Estimate Summary

**Total**
- $24.7M total estimated cost · USD
- Sensitivity range: $21.5M–$27.9M

**Cost categories**
- Site Operations: $11.2M (45%)
- Drug Supply: $6.2M (25%)
- Clinical Monitoring: $4.9M (20%)
- Lab & Biomarker: $2.5M (10%)

**Per-unit metrics**
- Cost per Patient: $99,597
- Cost per Site: $1.24M

**Currency selector**
- USD · EUR · JPY

---

## 3D Molecular Viewer

Accessible via **View 3D** button or the Visualize Structure panel.

### Viewer Modes
- 🎬 Cinematic — Immersive
- 🔬 Scientific — Split Panel
- 🧬 Explorer — Multi-Molecule

### Viewer Header
- Molecule name display
- SMILES preview (first 30 chars)
- Live Preview (badge)
- Close (button)

---

## Shared UI Terms & Status Labels

### Simulation States
- idle · running · complete · error
- No simulation results yet
- Running [Layer] Simulation
- ADMET prediction · Binding analysis · Toxicity screening (running state subtext)
- PK/PD modeling · Responder analysis · AE prediction (Layer 2 running subtext)
- Monte Carlo · [N] replications · Power analysis (Layer 3 running subtext)

### Validation & Status Indicators
- Valid structure
- GO · NO-GO
- HIGH CONFIDENCE
- Auto-populated from Layer 1 results
- Must sum to 100% (sex distribution warning)

### Common Actions
- Run [Layer] Simulation
- Cancel
- Export PNG
- PDF Report
- Export JSON
- Export CSV
- Export I/E Criteria to Layer 3
- Generate Full Report
- Add
- Fetch / Fetching…
- Use
- Re-run Matching with Adjusted Parameters

### Field Helpers
- *(required)* — asterisk marker
- hint text (shown right-aligned on label row)
- Auto (toggle label)
- ON / OFF (badge states)
- Pareto-optimal highlighted

### Score / Grade Thresholds
- Strong binding (<50 nM) · Moderate (50–500 nM) · Weak (>500 nM)
- Toxicity: Low · Medium · High
- AE severity: Mild · Moderate · Severe
- Response: Responder · Partial · Non-responder
- Confidence: <50% · 50–70% · >70%
