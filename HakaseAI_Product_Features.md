# HakaseAI -- BioDigital Twin Platform
## Complete Product Feature Reference (Sales Team Edition)

---

## Executive Summary

HakaseAI is a privacy-first BioDigital Twin platform that simulates the entire drug development pipeline -- from initial molecule discovery through Phase III clinical trial outcomes -- entirely in the browser. It replaces months of fragmented pre-clinical analysis with a unified, cascading simulation pipeline powered by live databases, real-time computation, and AI-driven insights.

**Core Value Proposition:**
- 90% of drug trials fail. HakaseAI helps identify failures before they cost millions.
- 30-50% faster pre-clinical development timelines.
- $5M+ saved per prevented late-stage failure.
- 1-5 years of pipeline compression into hours of simulation.

**Privacy Guarantee:** All molecular structures (SMILES) are processed exclusively in the browser. Zero server-side SMILES transmission. Zero-knowledge architecture.

---

## Platform Documentation: "From Molecule to Trial"

The HakaseAI platform transforms drug development through a unified simulation pipeline that answers four critical questions, one at each layer:

| Question | Layer | Answer |
|----------|-------|--------|
| "Is this molecule safe?" | Layer 1 -- In Vitro | Molecular screening and characterization |
| "How does it behave preclinically?" | Layer 2 -- Animal Cohort | Species PK/tox and human dose projection |
| "Who will it work for?" | Layer 3 -- Patient Cohort | Virtual patient populations and response modeling |
| "Will the trial succeed?" | Layer 4 -- Trial | Monte Carlo trial simulation and design optimization |

### Cascading Layer Architecture

The four layers flow sequentially -- results from each layer cascade forward to inform the next:

| Layer | Name | Color | Stage |
|-------|------|-------|-------|
| 1 | In Vitro Digital Twin | Violet | Early discovery -- compound screening & characterization |
| 2 | Animal Cohort Digital Twin | Amber | Preclinical -- species PK/tox & human dose projection |
| 3 | Patient Cohort Digital Twin | Blue | Clinical pharmacology -- virtual patient populations |
| 4 | Trial Digital Twin | Emerald | Clinical trial -- Monte Carlo trial simulation & design |

### Data Flow

```
Input: SMILES String + Target ID
  |
  v
L1 (In Vitro) --> L2 (Animal) --> L3 (Cohort) --> L4 (Trial)
  |                                                    |
  v                                                    v
Molecular Descriptors,                          GO / NO-GO Verdict
ADMET, Safety Flags                             + Full Technical Report
```

Each layer produces a verdict (GO / WATCH / NO-GO) and feeds forward:
- L1 molecular properties and safety flags inform L2 PBPK parameters
- L2 FIH dose projection auto-populates L3 starting dose
- L3 patient response data feeds L4 trial design parameters
- Safety flags propagate through ALL downstream layers

### Technical Underpinnings by Layer

**Layer 1 -- RDKit.js Engine (C++ compiled to WebAssembly)**
- Real molecular descriptor computation: MW, LogP, TPSA, HBD, HBA, QED, rotatable bonds
- QSAR rules for 5-axis ADMET scoring (0-1 scale per axis)
- Deterministic binding affinity estimation (Kd, Ki, IC50) for target protein classes
- All computation runs in-browser -- zero server dependency for molecular processing

**Layer 2 -- Two-Compartment RK4 ODE Solver**
- Species-specific physiological parameters (Vd, clearance, protein binding)
- Formulation Engine: 6 FDA IIG-compliant options auto-selected from BCS classification (SNEDDS, Nanosuspension, Amorphous Solid Dispersion, etc.)
- FIH dose scaling: Body weight allometric exponents (0.75 for CL, 1.0 for Vd) per ICH M3(R2) guidance
- Human Reference Panel: Cross-species comparison of Cmax, AUC, half-life, and Vd

**Layer 3 -- Population Simulation Engine**
- 100 time points per PK/PD curve with 90% confidence intervals
- Responder rate segmentation: Biomarker-positive subgroups at 1.5-2x overall rate
- Organ-risk flags mapped to CTCAE-graded adverse events
- DLT (Dose-Limiting Toxicity) rate: Aggregated probability based on flag severity (High: 15-25%)

**Layer 4 -- Monte Carlo Statistical Engine**
- Exact normal CDF power formula accounting for dropout and multi-arm designs
- Parametric Kaplan-Meier survival via Weibull distribution
- O'Brien-Fleming spending function for adaptive early stopping
- Final trial verdict: GO / CONDITIONAL / NO-GO based on power (target threshold), molecule status, and DLT (<33%)
- PROCOVA engine: Asymmetric trial design with variance reduction from historical prognostic data

### Ecosystem Integration

The platform connects to the broader Hakase ecosystem:
- **Diagen AI** (The Creator): Generative AI molecule design platform
- **BioDigital Twin** (The Validator): Simulation and safety assessment pipeline
- Molecules flow from Diagen into the Twin via Sync, Batch, or Cascade import modes

---

## Detailed Feature Reference: Four Simulation Layers

---

### Layer 1: In Vitro Digital Twin (Molecular Stage)

**Theme Color:** Violet
**Purpose:** Simulate early-stage in vitro assays to assess compound properties, safety, and viability before any wet-lab work begins.

#### Input Capabilities
- **SMILES Input:** Direct entry of molecular structures
- **Compound Import:** Fetch from PubChem, ChEMBL, or ZINC databases
- **Diagen AI Integration:** Direct import from Diagen generative AI platform (Sync, Batch, and Cascade modes)
- **Project Import:** Pull study data from ClinicalTrials.gov (NCT ID), PubMed (PMID), EHR/Epic, or LIMS systems
- **Protein Target Selection:** UniProt ID entry with automatic protein information retrieval

#### Simulation Modules

**1. Dose-Response Analysis**
- IC50 and EC50 calculation (nM)
- Hill coefficient estimation
- Maximum inhibition percentage
- 15-point dose-response curve generation (0.01 nM to 100,000 nM)
- Potency classification (High / Moderate / Low)

**2. Permeability Assessment**
- Caco-2 apparent permeability (Papp) with classification
- PAMPA permeability (Pe) with classification
- Efflux ratio calculation
- P-glycoprotein substrate prediction

**3. Metabolic Stability**
- Microsomal intrinsic clearance (CLint)
- Hepatocyte intrinsic clearance (CLint)
- Half-life estimation (minutes)
- Stability classification per assay type

**4. CYP Inhibition Panel**
- IC50 values for 5 major CYP enzymes: CYP1A2, CYP2C9, CYP2C19, CYP2D6, CYP3A4
- Risk-level classification per enzyme (Low / Moderate / High)
- Drug-Drug Interaction (DDI) risk flagging

**5. hERG Cardiac Safety**
- hERG IC50 estimation (uM)
- Safety margin calculation
- Risk categorization
- Simulated patch clamp result

**6. Selectivity Profiling**
- Kinase selectivity score
- Off-target hit identification
- Top off-target panel with specific IC50s and selectivity ratios (e.g., PIM1, JAK2, VEGFR2)

**7. Cell Viability**
- CC50 estimation (uM)
- Therapeutic index calculation
- Viability at 10 uM
- Cell line specification (HepG2, HEK293, etc.)

#### ADMET Module
- Individual scores (0-1 scale) for Absorption, Distribution, Metabolism, Excretion, and Toxicity
- Overall composite ADMET score
- Directional ADMET radar chart (collapsible)
- Toxicity alert flags: hERG, Hepatotox, Genotox, CNS, Reactive, Ames, DILI
- Organ-specific risk panel with quantitative scores for: Liver, Heart, Kidney, CNS, GI Tract, Lung

#### Bioactivation & Mechanistic Toxicity Engine
- **10 Adverse Outcome Pathways (AOP)** mapped with step-by-step molecular event chains
- Structural alert identification (e.g., Aniline, Quinone, Furan motifs)
- AOP chain mapping (e.g., AOP-18, AOP-220, AOP-38)
- Reactive intermediate identification (Nitrenium ion, Arene oxide, etc.)
- CYP enzyme responsibility assignment
- Target macromolecule prediction (e.g., DNA guanine N7)
- Detoxification pathway identification
- Metabolic soft spot detection with reactivity risk scoring
- GSH trapping study recommendations
- Recommended follow-up studies list (KCN trapping, Ames test, etc.)

#### Lipinski Analysis & Go/No-Go
- Full Rule of Five assessment (MW, LogP, HBD, HBA)
- Violation count with severity weighting
- GO / WATCH / NO-GO verdict with rationale
- "REVIEW REQUIRED" badge when hERG < 10 uM or structural alert confidence > 70%

#### 3D Molecular Visualization
Three rendering modes:
- **Cinematic Mode:** Publication-quality hero views
- **Scientific Mode:** Structural analysis with bond distances and angles
- **Explorer Mode:** Interactive multi-molecule navigation and protein-ligand docking

---

### Layer 2: Animal Cohort Digital Twin (Preclinical Stage)

**Theme Color:** Amber
**Purpose:** Simulate preclinical animal studies and project First-in-Human dosing using physiologically-based pharmacokinetic (PBPK) modeling.

#### Species Library
7 validated species/strain parameter sets:
- Mouse CD-1
- Mouse C57BL/6
- Rat Sprague Dawley
- Rat Wistar
- Dog Beagle
- Cynomolgus Monkey
- Human Reference (background translation target -- not selectable, shown as Human Translation Panel)

#### Configurable Study Parameters
- Species/strain selection
- Study type (Single Dose, Repeat Dose, etc.)
- Route of administration
- Formulation type (BCS-aware selection)

#### Simulation Modules

**1. Multi-Species PBPK**
- Physiologically-based pharmacokinetic modeling across selected species
- Full PK parameter estimation (Cmax, Tmax, AUC, half-life, clearance, Vd)
- Dual PK profile chart: Animal curve (amber) vs. Projected Human curve (blue)
- Cmax peak annotation on charts

**2. Allometric FIH Dose Scaling**
- BSA/Km-based allometric scaling
- PBPK-refined dose projection
- Maximum Recommended Starting Dose (MRSD) calculation
- FDA-aligned safety factor application

**3. NOAEL/MTD Estimation**
- No Observed Adverse Effect Level determination
- Maximum Tolerated Dose projection
- Safety margin calculations

**4. Formulation Science**
- BCS (Biopharmaceutics Classification System) aware formulation selection
- Bioavailability impact modeling

**5. Study Group Design**
- Group size recommendations
- Dosing regimen design
- ICH guideline-mapped toxicity signal prediction (M3, S2, S7A/B, S4A, E6)

#### Regulatory Output
- IND-enabling study package generation
- FDA SAD/MAD study package requirements
- MRSD calculation documentation

#### Auto-Feed to Layer 3
- FIH dose automatically populates Layer 3 starting dose after simulation

---

### Layer 3: Patient Cohort Digital Twin (Clinical Pharmacology Stage)

**Theme Color:** Blue
**Purpose:** Model drug performance in virtual human populations with real-world biological variability.

#### Configurable Parameters
- Cohort size
- Starting dose (auto-populated from Layer 2)
- Route of administration
- Dosing frequency
- Age range
- Disease severity

#### Simulation Modules

**1. Population PK/PD Engine**
- 2-compartment PBPK ODE solver
- NHANES-derived population variability (age, weight, organ function distributions)
- Emax sigmoidal pharmacodynamic modeling
- Individual patient PK curves

**2. PK/PD Concentration Curve Analysis**
- Population mean and variability bands
- Steady-state predictions
- Therapeutic window overlay

**3. Responder Stratification**
- Emax model-based classification
- Responder vs. non-responder identification
- Dose-response relationship in virtual population

**4. Adverse Event Prediction**
- MedDRA-coded adverse event terms
- CTCAE grading (Grade 1-5)
- Incidence rate estimation
- FAERS-calibrated AE signal detection

**5. Subgroup Sensitivity Analysis**
- Demographic subgroup heatmaps
- Comorbidity impact analysis
- Age, sex, weight, and organ function stratification

#### Regulatory Output
- Breakthrough Therapy designation eligibility assessment
- Fast Track designation eligibility assessment
- FAERS-calibrated adverse event label signals

---

### Layer 4: Trial Digital Twin (Clinical Design Stage)

**Theme Color:** Emerald
**Purpose:** Run Monte Carlo simulations to predict trial success probability, optimize trial design, calculate statistical power, and estimate costs.

#### Configurable Parameters
- Trial phase (I, II, III)
- Primary endpoint name and type (Time-to-Event, Continuous, Binary)
- Clinical difference (effect size)
- Target sample size
- Significance level (alpha)
- Power target (1-beta)
- Dropout rate and pattern (Exponential)
- Number of arms
- Adaptive design toggle

#### Simulation Modules

**1. Monte Carlo Trial Engine**
- Up to 10,000 trial repetitions
- Weibull-based Kaplan-Meier survival modeling
- Schoenfeld/Greenwood power formulas
- Trial success probability gauge

**2. Power Curve Analysis**
- Sample size vs. power visualization
- Dynamic power threshold display
- Sensitivity to effect size changes

**3. Enrollment Trajectory**
- Site-by-site enrollment modeling
- Timeline projections
- Enrollment rate optimization

**4. Synthetic Control Arm**
- Virtual control group generation
- Propensity Score Matching methodology
- Historical data integration (MIMIC-IV compatible)

**5. Site Ranking**
- Clinical site evaluation and ranking
- Historical performance benchmarking
- Enrollment capacity assessment

**6. Cost Breakdown**
- Detailed trial cost estimation (in $M)
- Per-patient cost modeling
- Site costs, monitoring, and operational expenses

**7. Adaptive Design**
- O'Brien-Fleming spending function boundaries
- Bayesian adaptive boundary calculations
- Interim analysis timing configuration
- Futility boundary settings
- Superiority boundary settings
- Sample size re-estimation toggle

#### PROCOVA Module (Prognostic Covariate Adjustment)

A specialized statistical optimization layer within Trial Digital Twin:

**Configuration:**
- Toggle on/off with independent panel expansion
- Automatic variance reduction lookup by therapeutic area and endpoint type
- Manual override slider for custom variance reduction percentage
- Randomization ratio selector (1:1, 2:1, 3:1, 4:1)
- EMA regulatory guidance note

**Variance Reduction Table:**
9 indication-specific entries covering:
- Alzheimer's Disease (Continuous)
- Multiple Sclerosis (Time-to-Event)
- ALS (Continuous)
- Parkinson's Disease (Continuous)
- Oncology (Time-to-Event)
- Oncology (Binary)
- Rare Disease (Continuous)
- General (Continuous)
- General (Time-to-Event)

**Results Panel (6 Tabs):**

1. **Design Comparison:** Side-by-side standard vs. PROCOVA-enhanced trial design metrics
2. **Dual Power Curve:** SVG chart showing standard (1:1) and PROCOVA-enhanced power curves with dynamic threshold line and patient savings annotation
3. **Enrollment Impact:** Enrollment trajectory comparison showing time and patient savings
4. **Cost Savings:** Detailed cost breakdown showing savings from optimized design
5. **Sensitivity Heatmap:** Interactive table showing sample size requirements across variance reduction levels and randomization ratios
6. **Regulatory Guidance:** FDA/EMA guidance on prognostic covariate adjustment acceptability

**Summary Cards:**
- Patients Saved (total reduction)
- Cost Savings ($M and percentage)
- Time Saved (months)
- Placebo Reduction (fewer control arm patients)

#### Regulatory Output
- Adaptive design compliance documentation
- IND-to-NDA timeline generation
- FDA designation strategy (Standard, Breakthrough, Accelerated, Orphan)

---

## Cross-Platform Features

### HAIOps Framework (Healthcare AI Operations)

A comprehensive governance framework ensuring clinical safety and regulatory compliance:

**Five Pillars:**
1. **Clinical Validation:** Continuous validation against clinical benchmarks
2. **Regulatory Audit Trail:** Full audit history of all computations and decisions
3. **Patient Safety Surveillance:** Real-time monitoring via 6-flag safety cascade
4. **Compliance Monitoring:** 21 CFR Part 11 aligned audit trails
5. **Confidence Scoring:** Model confidence and uncertainty quantification

**Safety Cascade (6-Flag System):**
Flags that propagate through ALL downstream layers:
1. **Cardiac Risk** -- hERG-driven cardiac safety flags
2. **Hepatotoxicity** -- Liver toxicity signals
3. **Drug-Drug Interaction (DDI)** -- CYP inhibition-driven interaction risk
4. **Narrow Therapeutic Margin** -- Compounds with tight safety windows
5. **High-Grade Adverse Events** -- Serious AE predictions
6. **Subgroup Disparity** -- Differential efficacy/safety across patient subgroups

**Safety Override Logging:**
- NO-GO verdicts require documented human override
- Override reason and clinician identity are logged
- All downstream outputs annotated with override history
- Full audit trail maintained for regulatory inspection

**Model Governance:**
- 9 governed models classified by risk tier: Foundational, Moderate, High, Critical
- Continuous validation against clinical benchmarks
- Version-controlled model registry

### Provenance Metadata

Every computation carries a full provenance chain:
- Engine version and timestamp
- Database query status (success/degraded/failed)
- Random seeds for reproducibility
- Input source tracking
- Collapsible provenance footer per layer
- Graceful degradation banners when databases are unavailable

### AI-Powered Analysis

- Streaming AI analysis reports synthesizing results across all layers
- GO/NO-GO rationale generation
- Risk flag summarization and mitigation recommendations
- Layer-specific AI insights
- Full narrative report generation

---

## Live Database Integrations (12+ Sources)

### Discovery & Chemistry
| Database | Data Provided |
|----------|--------------|
| **PubChem** | Compound structures (SMILES), molecular weight, properties |
| **ChEMBL** | Molecule details, bioactivity, LogP, clinical phase |
| **ZINC** | Docking-ready structures, LogP, SMILES |
| **UniChem** | Cross-reference resolution (ChEMBL to PubChem) |

### Protein & Structural
| Database | Data Provided |
|----------|--------------|
| **UniProt** | Protein sequences, gene symbols, active/binding site annotations |
| **RCSB PDB** | Experimental 3D structures, resolution, bound ligands |
| **AlphaFold DB** | AI-predicted protein structures (when experimental data unavailable) |
| **STRING DB** | Protein-protein interaction networks, functional partner scores |

### Pharmacology & Bioactivity
| Database | Data Provided |
|----------|--------------|
| **BindingDB** | Curated experimental binding affinities (Ki, Kd, IC50) |
| **Open Targets** | Target-disease associations, drug evidence, tractability scores |
| **PharmGKB** | Pharmacogenomics data, clinical variant annotations, CYP impacts |
| **KEGG** | Pathway enrichment, disease associations, drug target mapping |
| **Reactome** | Biological pathway mappings, reaction counts |

### Safety & Toxicology
| Database | Data Provided |
|----------|--------------|
| **OpenFDA / FAERS** | Adverse event signals, MedDRA terms, boxed warnings, approval history |
| **EPA CompTox / ToxCast** | High-throughput toxicology screening, oral LD50 estimates |
| **ECOTOX** | Environmental toxicity studies, NOAEC values |

### Clinical & Genomic
| Database | Data Provided |
|----------|--------------|
| **ClinicalTrials.gov** | Benchmark studies, trial status, phases, enrollment data |
| **DisGeNET** | Gene-disease association scores, literature support |
| **gnomAD** | Population genomic variants, pLI scores, constraint metrics |
| **NHANES** | Population health distributions (age, weight, organ function) |

---

## Diagen AI Integration

Seamless connection with the Diagen generative AI molecule design platform:

**Three Import Modes:**
1. **Synchronous:** Single-compound real-time fetch with immediate simulation
2. **Batch:** Bulk processing of multiple generated candidates
3. **Cascade:** Automatic handoff -- Diagen generates, BioDigital Twin validates

**Pre-Score Display:**
- ADMET pre-scores visible during import (Absorption, Distribution, Metabolism, Excretion, Toxicity)
- Direct SMILES transfer into the simulation pipeline

---

## Regulatory Compliance & Alignment

### Standards Alignment
- **ICH Guidelines:** M3, S2, S7A/S7B, S4A, E6
- **FDA Clinical Pharmacology:** Full alignment with FDA guidance documents
- **21 CFR Part 11:** Compliant audit trails with electronic signature readiness
- **eCTD Compatibility:** Module 2.6/2.7 compatible reporting

### Regulatory Intelligence Page
- Layer-by-layer regulatory outlook generation
- IND-enabling study checklists
- FDA study package requirements
- Designation strategy assessment (Breakthrough, Fast Track, Accelerated, Orphan Drug)
- Development timeline projections

---

## Platform Pages & Navigation

| Page | Route | Purpose |
|------|-------|---------|
| **Landing** | `/` | Marketing homepage with statistics, pipeline overview, and Diagen integration showcase |
| **Platform Overview** | `/platform` | Detailed technical breakdown of all four simulation layers, ecosystem flow, and engine specifications |
| **Dashboard** | `/dashboard` | Core simulation interface -- all 4 layers with full input controls and results panels |
| **The Story** | `/story` | Dual-mode narrative with toggle: "Simple Story" (business/investor) and "Technical Story" (scientists/engineers) |
| **Regulatory Intelligence** | `/regulatory` | Layer-by-layer regulatory outlook, designation strategy, and IND-to-NDA timeline |
| **Advanced AI Roadmap** | `/advanced-v2` | Future deep learning upgrades: ESM-2 protein embeddings, Transformer-based ADMET, GNN molecular property prediction |
| **APIs & Data Sources** | `/apis` | Complete inventory of all 12+ external API and database integrations with live status |
| **HAIOps Framework** | `/haiopsdna` | Full documentation of 5 governance pillars, 6-flag safety cascade, model registry, and compliance framework |
| **Privacy Policy** | `/privacy` | Zero-knowledge architecture details, data handling policies, and client-side processing guarantees |
| **Login** | `/login` | User authentication |

### Page Highlights

**Landing Page (`/`)**
- Hero: "Your Drug's Digital Twin. Built on Privacy."
- Key statistics: 90% trial failure rate, 30-50% faster development, $5M saved per failure, 1-5 years compressed
- Interactive pipeline visualization showing molecule flow through all 4 layers
- Diagen AI integration showcase with JSON payload example
- Three 3D molecular viewer demos (Cinematic, Scientific, Explorer)

**The Story Page (`/story`)**
- **Simple Version:** Uses a "flight simulator for drug molecules" analogy; frames around three core questions (Is it safe? What happens to patients? Should we run a trial?); compares Standard vs. Premium tiers using navigation software analogy
- **Technical Version:** Explains the circular dependency problem in pre-clinical decision-making; details RDKit.js WASM pipeline, RK4 ODE solvers, and O'Brien-Fleming spending functions; step-by-step computational breakdown per layer

**Platform Overview (`/platform`)**
- Complete technical architecture of all four layers with engine specifications
- Data flow diagram from SMILES input through GO/NO-GO verdict
- Layer-by-layer deep dive: RDKit.js descriptors, PBPK solver parameters, population modeling methodology, Monte Carlo trial mechanics
- Formulation Engine showcase (6 FDA IIG-compliant options)
- Cross-species human reference panel specifications

---

## Technical Architecture

### Browser-Side Computation Engines
- **RDKit.js (WebAssembly):** Real-time molecular descriptor computation
- **ESM-2 Protein Language Model:** Protein-aware binding affinity estimation
- **2-Compartment PBPK ODE Solver:** Pharmacokinetic differential equation modeling
- **Monte Carlo Statistical Engine:** Trial simulation with configurable repetitions
- **PROCOVA Engine:** Asymmetric trial design optimization with variance reduction

### Privacy Architecture
- All molecular structures processed exclusively in-browser
- No SMILES data transmitted to servers
- AI analysis uses structured results only (not raw molecular data)
- Zero-knowledge design -- the platform never sees proprietary chemistry

### Technology Stack
- React + TypeScript + Vite
- Tailwind CSS (utility-first styling)
- RDKit.js via WebAssembly
- Express API server (AI analysis streaming only)
- PostgreSQL + Drizzle ORM

---

## Key Differentiators for Sales Conversations

1. **Privacy-First:** Molecular IP never leaves the browser. Zero-knowledge architecture.
2. **Cascading Validation:** Each layer validates and enriches the next -- failures caught early.
3. **Live Data:** 12+ real-time database integrations, not static models.
4. **HAIOps Governed:** Enterprise-grade safety cascade, audit trails, and override logging.
5. **Cost Prevention:** $5M+ saved per prevented late-stage failure.
6. **Speed:** Months of analysis compressed to hours of simulation.
7. **Regulatory Ready:** ICH-aligned, 21 CFR Part 11 audit trails, eCTD-compatible outputs.
8. **Clinician-in-the-Loop:** AI cannot override safety -- human decisions are required and logged.
9. **PROCOVA Optimization:** Advanced statistical methods reduce trial costs, patient exposure, and timelines.
10. **Diagen Ecosystem:** End-to-end from AI molecule generation to clinical trial simulation.

---

*Document generated from HakaseAI platform codebase -- March 2026*
