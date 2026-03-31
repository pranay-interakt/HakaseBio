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
- See **Appendix A: The Story of a Molecule** below for the full narrative

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

## Appendix A: The Story of a Molecule

*How HakaseAI Simulates an Entire Drug's Journey -- A Plain-Language Guide to the BioDigital Twin Platform*

### Prologue: The Problem Worth Solving

Imagine you've just designed a molecule that you believe could cure a devastating disease. It looks perfect on paper. But between that molecule and a patient's medicine cabinet lies a gauntlet that takes 10-15 years, costs over $2 billion, and fails 90% of the time.

Most of those failures don't happen because the science was wrong. They happen because nobody could see the failure coming. The molecule turned out to be toxic to the heart. Or it was metabolised too quickly by the liver. Or the clinical trial was designed for 200 patients when it needed 400.

Each of these failures could have been predicted -- if someone had run the right simulation early enough.

That's what HakaseAI does. It builds a digital twin of the entire drug development journey -- from molecule to clinical trial -- and lets you see what will happen before you spend a single dollar in the lab.

> **Digital Twin:** A virtual replica of something real. An aircraft manufacturer might build a digital twin of a jet engine to simulate wear before building the physical engine. HakaseAI builds a digital twin of a drug's journey through the human body and through clinical trials.

The platform is organised into four stages, each one simulating a different phase of drug development. Think of them as four rooms in a laboratory, each one asking a different question about your molecule.

---

### Chapter 1: Meeting the Molecule (Layer 1 -- In Vitro Digital Twin)

A scientist types a string of characters into HakaseAI: `CC(=O)OC1=CC=CC=C1C(=O)O`

To a human, it looks like gibberish. To the platform, it's a complete blueprint of Aspirin. Within seconds, the screen fills with charts, scores, and a verdict: **GO**.

Every drug starts as a molecule, and every molecule can be described as a text string called SMILES.

> **SMILES (Simplified Molecular Input Line Entry System):** A way to write a chemical structure as text, like a molecular barcode. Water is just "O". Ethanol is "CCO". Aspirin is "CC(=O)OC1=CC=CC=C1C(=O)O". Computers can read this barcode and reconstruct the entire 3D shape of the molecule.

When you enter a SMILES string into HakaseAI, the platform's first layer -- the In Vitro Digital Twin -- springs to life. "In vitro" is Latin for "in glass" -- it refers to experiments done in test tubes and petri dishes, outside a living organism.

> **In Vitro:** Experiments performed in controlled laboratory environments (test tubes, cell cultures, assay plates) rather than in a living animal or human. The In Vitro Digital Twin simulates these experiments digitally, without any actual lab work.

This first layer runs your molecule through a comprehensive panel of simulated laboratory tests -- the same experiments a medicinal chemistry team would spend weeks and hundreds of thousands of dollars performing in a physical lab.

#### What You Tell the Platform

Before the simulation runs, the platform needs a few pieces of information from you. Think of it as filling out a lab request form -- except instead of sending it to a technician, you're handing it to a simulation engine that returns results in seconds.

**The molecule itself:** You enter a SMILES string -- the text barcode of your compound. You can type it directly, paste it from your design software, upload a structure file (SDF or MOL2), or import it from a public database like ChEMBL or PubChem by searching for a compound name or ID. If your team uses Diagen AI to generate candidate molecules, you can pull them in directly with a single click.

**The target protein:** Which protein is this drug supposed to hit? You enter a UniProt ID -- a standardised code for proteins. For example, P00533 is EGFR (a common cancer target). The platform looks up the protein's structure, finds the best available crystal structure from the Protein Data Bank, and prepares it for binding simulation.

> **UniProt ID:** A unique identifier for a protein in the Universal Protein database. Think of it like a social security number for proteins. P00533 is the epidermal growth factor receptor (EGFR), a target in many cancer drugs. Q06187 is Bruton's tyrosine kinase (BTK), the target of ibrutinib for blood cancers.

**The therapeutic area:** A dropdown that tells the platform the disease context -- Oncology, CNS, Cardiovascular, Metabolic, Rare Disease, Infectious Disease, or Immunology. This isn't just a label. It adjusts the expected potency ranges, the toxicity profiles to watch for, and the relevant off-target panels.

**Simulation options:** A set of toggles that control which tests to run. The core in vitro assay panel always runs. Binding simulation requires a target protein. Toxicity signal detection cross-references your molecule against 20 million adverse event reports in the FDA's FAERS database.

**Confidence threshold:** A slider (0.50 to 0.95) that controls how sensitive the platform is to potential problems. Set it low (0.50) and the platform flags everything that looks even slightly suspicious. Set it high (0.95) and it only flags issues where the evidence is very strong.

**For batch screening:** If you're screening multiple molecules at once (up to 500 via CSV upload), you can choose how to rank the results -- by drug-likeness (QED score), by toxicity risk (safest first), by binding affinity (strongest first), or by a composite blend of all three.

#### The Seven Tests Your Molecule Faces

**Test 1 -- Dose-Response: How potent is this molecule?**
The platform generates a curve showing how much drug you need to shut down the target. The key number is the IC50 -- the concentration at which the molecule inhibits half of the target's activity. A lower IC50 means a more potent drug.

> **IC50 (Half-Maximal Inhibitory Concentration):** The amount of drug needed to block 50% of the target's activity. Measured in nanomolar (nM) -- billionths of a mole per litre. A good IC50 for a kinase inhibitor is typically below 100 nM.

**Test 2 -- Permeability: Can this molecule actually get through cell membranes?**
If you swallow a pill, the drug needs to cross the wall of your intestine to reach your bloodstream. The platform simulates two standard permeability assays -- Caco-2 and PAMPA -- to predict whether the molecule can make that crossing, and whether cellular pumps might push it back out.

> **Permeability (Caco-2 / PAMPA):** Caco-2 cells are human intestinal cells grown in a lab dish. PAMPA is an artificial membrane. Both are used to test whether a molecule can cross biological barriers. High permeability = the drug gets absorbed well.

**Test 3 -- Metabolic Stability: How quickly will the liver destroy this molecule?**
Your liver is a chemical processing plant that breaks down foreign substances using enzymes called CYPs. If a drug is metabolised too quickly, it disappears from the bloodstream before it can work. The platform predicts the intrinsic clearance rate -- how fast liver enzymes chew through the molecule.

> **CYP450 Enzymes (Cytochrome P450):** A family of enzymes in the liver that metabolise (break down) most drugs. CYP3A4 alone handles about 50% of all drugs on the market.

**Test 4 -- CYP Inhibition Panel: Will this molecule interfere with other drugs?**
If your molecule blocks CYP3A4, then every other drug metabolised by that enzyme will build up in the patient's body to potentially dangerous levels. The platform screens against five major CYP enzymes and flags drug-drug interaction risk.

> **Drug-Drug Interaction (DDI):** When one drug changes how another drug works in the body. Most DDIs happen because Drug A inhibits a CYP enzyme that Drug B needs for metabolism. This is why grapefruit juice (which inhibits CYP3A4) comes with warnings on so many medications.

**Test 5 -- hERG Cardiac Safety: Could this molecule stop a heart?**
This is the single most important safety screen in drug development. The hERG channel is a potassium gate in heart cells that keeps your heartbeat regular. If a drug blocks it, the heart rhythm goes haywire. hERG toxicity is the number one reason approved drugs get pulled from the market.

> **hERG (Human Ether-a-go-go-Related Gene):** A potassium channel in heart muscle cells. When drugs accidentally block hERG, the heart's electrical rhythm is disrupted, causing QT prolongation. In severe cases, this leads to a fatal arrhythmia called Torsades de Pointes. The hERG safety test has killed more drug programmes than any other single assay.

**Test 6 -- Selectivity Profiling: Does this molecule hit only its intended target, or does it hit everything?**
A drug designed to block one specific kinase might accidentally block dozens of related kinases, causing unexpected side effects. The platform calculates a selectivity score -- how precisely the molecule binds its target versus the broader family.

**Test 7 -- Cell Viability: Is this molecule just a poison?**
Some molecules kill target cells beautifully but also kill healthy cells at similar concentrations. The platform predicts the CC50 (the concentration that kills half the cells) and calculates a therapeutic index -- the gap between the dose that works and the dose that kills.

> **Therapeutic Index:** The ratio between the toxic dose and the therapeutic dose. A drug with a therapeutic index of 100 means you'd need to give 100 times the effective dose before it becomes dangerous. A therapeutic index below 10 is a red flag.

#### The Directional Compass: ADMET

Alongside these seven detailed assays, the platform also generates an ADMET score -- a quick directional compass that shows whether the molecule's overall drug-like properties are headed in the right direction.

> **ADMET (Absorption, Distribution, Metabolism, Excretion, Toxicity):** The five fundamental questions about any drug molecule. Think of ADMET like a weather forecast. It tells you "expect rain" or "looks sunny." The seven in vitro assays are the actual weather stations. The forecast is useful for planning; the measurements are what you base critical decisions on.

#### The Verdict

After running all these simulations, the platform delivers a verdict:

- **GO** -- The molecule passes. Advance to the next stage.
- **WATCH** -- There are concerns, but they might be fixable. Proceed with caution.
- **NO-GO** -- The molecule has fundamental problems. Don't invest further.

A NO-GO here saves the company from spending $50,000-$200,000 on wet-lab experiments that would have reached the same conclusion weeks later.

---

### Chapter 2: From Test Tube to Living System (Layer 2 -- Animal Cohort Digital Twin)

The molecule passed its in vitro tests. But a test tube is not a living body.

Before this molecule can ever touch a human, regulatory agencies require proof that it's safe in animals. The Animal Cohort Digital Twin simulates those studies.

In real drug development, this is where things get expensive and slow. A single rodent PK study costs $50,000-$150,000 and takes 6-10 weeks. A full GLP toxicology package across two species can run $500,000+ and take 6 months.

The second layer simulates preclinical animal studies using PBPK modelling across seven different species, from mice to monkeys.

#### Setting Up the Animal Study

**Species and strain:** You pick from seven validated options: Mouse (CD-1 or C57BL/6), Rat (Sprague Dawley or Wistar), Dog (Beagle), or Cynomolgus Monkey. Each species comes with pre-loaded physiological parameters -- organ volumes, blood flow rates, enzyme activity levels -- that drive the PBPK model. A projected Human Translation Panel runs automatically in the background for comparison.

**Study type:** Single Dose (a one-time dose to see basic PK), Repeat Dose (multiple doses over days or weeks to assess accumulation), or other standard designs.

**Route of administration:** How the drug enters the animal -- oral (by mouth), intravenous (IV, directly into the bloodstream), subcutaneous (under the skin), or others. The route fundamentally changes the PK curve.

**Formulation type:** The physical form of the drug. The platform is BCS-aware, meaning it knows that some molecules dissolve poorly in water and adjusts the absorption prediction accordingly.

> **BCS (Biopharmaceutics Classification System):** A framework that classifies drugs into four groups based on their solubility (does it dissolve?) and permeability (can it cross membranes?). Class I drugs dissolve easily and cross membranes well. Class IV drugs have poor solubility AND poor permeability.

> **PBPK (Physiologically-Based Pharmacokinetic) Modelling:** A mathematical model that simulates how a drug moves through the body by treating each organ as a separate compartment with its own blood flow, enzyme activity, and tissue binding. Instead of treating the body as one big container, PBPK models the actual physiology for much more realistic predictions.

#### The Key Question: What Should the First-in-Human Dose Be?

The platform answers this through allometric scaling -- a technique that translates animal doses to human-equivalent doses based on body surface area. If a drug is safe at 10 mg/kg in a rat, what's the equivalent safe starting dose in a 70 kg human? The platform calculates this, applies FDA-required safety factors, and outputs a Maximum Recommended Starting Dose.

> **NOAEL (No Observed Adverse Effect Level):** The highest dose tested in an animal study where no harmful effects were seen. This is the starting point for calculating the human dose. Regulators require you to divide the NOAEL by safety factors (typically 10x or more) to get a cautious human starting dose.

> **First-in-Human (FIH) Dose:** The very first dose given to a human volunteer in a Phase 1 clinical trial. Getting this number right is critical -- too low and you waste months on subtherapeutic dosing, too high and you risk harming the first patients.

Once computed, the FIH dose automatically flows into the next layer. The molecule has graduated from the test tube, survived the animal studies, and is ready to meet virtual patients.

---

### Chapter 3: A Thousand Virtual Patients (Layer 3 -- Patient Cohort Digital Twin)

The platform generates 5,000 virtual patients. Each one has a unique age, weight, kidney function, liver enzyme activity, and genetic profile. Some metabolise drugs quickly. Some slowly. The molecule enters their virtual bloodstreams, and we watch what happens.

The third layer answers the questions that keep clinical pharmacologists up at night. What dose range is safe? Which patients will respond? What adverse events should we expect? And in which patient subgroups will the drug work best -- or worst?

#### Defining Your Virtual Population

**The disease:** You enter the target indication as an ICD-10 code -- the global standard for classifying diseases. You also set the disease severity: Mild, Moderate, Severe, or Critical.

> **ICD-10 (International Classification of Diseases, 10th Revision):** A coding system used worldwide to categorise every known disease and condition. C34.1 is non-small cell lung cancer. E11 is type 2 diabetes. G30 is Alzheimer's disease.

**Cohort size:** How many virtual patients to generate -- from 500 to 10,000. 5,000 is a good default for most analyses.

**Demographics:** Age range, sex distribution, and body weight range. These aren't just labels -- age affects kidney function and drug clearance, body weight changes the volume of distribution, and sex influences CYP enzyme activity.

**Organ function:** You set ranges for kidney function (eGFR), liver enzymes (ALT), and cardiac function (LVEF).

> **eGFR (Estimated Glomerular Filtration Rate):** A measure of how well the kidneys are filtering blood. Above 90 is normal. Below 15 is kidney failure. For drugs cleared by the kidneys, eGFR is the single biggest driver of dose adjustment.

**Dose and administration:** The starting dose (auto-populated from Layer 2's FIH calculation, or entered manually), the route, and the dosing frequency -- QD (once daily), BID (twice daily), QW (once weekly).

**Pharmacogenomics toggles:** CYP2D6, CYP3A4, and CYP2C19 metaboliser variation. When enabled, the virtual cohort includes a realistic mix of poor metabolisers, normal metabolisers, and ultra-rapid metabolisers. This is precision medicine in simulation form.

**Comorbidities:** You can add up to 10 additional conditions -- hypertension, type 2 diabetes, chronic kidney disease, etc. -- that are common in your target population.

The platform builds its virtual patients using real-world population data from NHANES -- a massive US government survey that tracks the health and nutritional status of Americans.

> **NHANES (National Health and Nutrition Examination Survey):** A programme run by the US Centers for Disease Control (CDC) that examines about 5,000 Americans each year. It measures everything from blood pressure to kidney function to body fat percentage. HakaseAI uses this data to ensure its virtual patients look like real patients -- not idealised textbook averages.

#### What the Body Does to the Drug

For each virtual patient, the platform solves a set of differential equations that track the drug's concentration in the blood over time. The result is a PK curve.

> **PK Curve (Pharmacokinetic Curve):** A graph showing drug concentration in the blood over time. The peak is called Cmax (maximum concentration). The time to reach the peak is Tmax. The total area under the curve (AUC) represents total drug exposure. And the half-life (t1/2) tells you how long it takes for the concentration to drop by half.

Because each virtual patient has different physiology, each one gets a slightly different PK curve. The platform overlays all 5,000 curves and shows you the population mean with confidence intervals.

#### What the Drug Does to the Body

The PK curve tells you how much drug is in the blood. The PD model tells you what that drug concentration actually does. The platform uses an Emax model.

> **Emax Model:** A pharmacodynamic model shaped like an S-curve. At low drug concentrations, there's little effect. As concentration increases, the effect climbs steeply. Eventually it plateaus -- adding more drug doesn't increase the effect further. The concentration at the midpoint of the S-curve is called the EC50.

The model classifies each virtual patient as a Responder (meaningful clinical improvement), Partial Responder, or Non-Responder. It also predicts adverse events -- side effects graded on the CTCAE scale from mild (Grade 1) to fatal (Grade 5) -- calibrated against real-world safety data from the FDA's FAERS database.

> **FAERS (FDA Adverse Event Reporting System):** A database containing over 20 million reports of adverse reactions to drugs, submitted by doctors, patients, and pharmaceutical companies to the US FDA.

> **CTCAE (Common Terminology Criteria for Adverse Events):** The universal grading scale for drug side effects. Grade 1 = mild. Grade 2 = moderate. Grade 3 = severe (requires medical intervention). Grade 4 = life-threatening. Grade 5 = death. Clinical trials track Grade 3+ events very carefully.

---

### Chapter 4: Running the Trial Before Running the Trial (Layer 4 -- Trial Digital Twin)

A clinical trial is one of the most expensive experiments a company will ever run. A Phase III oncology trial can cost $100 million and take 5 years. What if you could simulate it first -- in an afternoon?

The fourth and final layer simulates an entire clinical trial using Monte Carlo methods. It creates virtual treatment and control groups, models enrolment across clinical sites worldwide, simulates dropout, runs the statistical analysis, and tells you the probability that your trial will succeed.

#### Designing the Trial

This layer has the most configuration of any layer -- because clinical trial design is where billions of dollars of decisions are made.

**Trial phase:** Phase I (first-in-human, safety focus), Phase I/II (safety + early efficacy), Phase II (does it work?), Phase II/III (bridge to registration), or Phase III (large-scale proof for regulatory approval).

**Study type:** Randomised Controlled (the gold standard), Single-Arm + Synthetic Control (all patients get the drug, with a virtual control group), Open-Label, or Crossover.

**Number of arms and randomisation:** A 2-arm trial (treatment vs control) is standard. Multi-arm trials test multiple doses or drugs simultaneously. The randomisation ratio (e.g., 2:1) determines how many patients go to treatment vs control.

**Primary endpoint:** The main outcome measure the trial is powered to detect. The endpoint type (Time-to-Event, Continuous, Binary, Composite, Count) determines which statistical model the Monte Carlo engine uses.

> **Endpoint:** The measurable outcome that determines whether a drug works. Choosing the right endpoint is one of the most consequential decisions in trial design -- the wrong endpoint can doom a trial even if the drug works.

**Effect size:** The clinically meaningful difference you're trying to detect. A hazard ratio of 0.7 means you expect the drug to reduce the risk of death by 30%.

**Significance and power targets:** Alpha (default 0.05) and power (default 80%) are the two statistical cornerstones. Together they determine the sample size.

**Dropout modelling:** Patients leave trials. You set the annual dropout rate (default 15%) and the dropout pattern: Uniform, Front-loaded, Back-loaded, or Exponential. Every dropout inflates the sample size you need.

**Adaptive design rules:** When to peek at the data (at 25%, 50%, or 75% enrolment), which spending function to use for futility and superiority boundaries (O'Brien-Fleming is conservative, Pocock is more aggressive), and whether to allow mid-trial sample size re-estimation.

**Synthetic control arm:** For single-arm trials -- the matching method (Propensity Score Matching, Inverse Probability Weighting), which covariates to match on, the balance threshold (SMD < 0.10 is good), and which real-world databases to draw from -- MIMIC-IV (~47K patients), HCUP (~8M patients), or All of Us (~312K patients).

> **Propensity Score Matching:** A statistical technique for creating a fair comparison group from historical data. It calculates the probability of each historical patient being "like" a treatment patient, then matches them based on that probability.

**Monte Carlo replications:** How many virtual trials to run -- from 100 (quick estimate) to 10,000 (publication-grade precision).

> **Monte Carlo Simulation:** A technique that runs thousands of randomised "what-if" scenarios to estimate probabilities. Named after the famous casino, because it uses random sampling -- like rolling dice thousands of times to figure out the odds.

#### The Key Number: Statistical Power

The most important output of a clinical trial design is its statistical power. Power answers the question: if this drug truly works, what's the probability that our trial will detect it?

> **Statistical Power:** The probability that a trial will find a real treatment effect if one exists. Industry standard is 80% power -- meaning there's a 20% chance of missing a real effect (a false negative).

> **Significance Level (Alpha):** The probability of a false positive -- declaring the drug works when it actually doesn't. The standard threshold is 0.05 (5%). This is why you see "p < 0.05" in medical journals.

The platform calculates the exact sample size needed to achieve the target power, then models whether that many patients can actually be enrolled given the available clinical sites, geographic regions, and disease prevalence.

#### Survival Curves and Hazard Ratios

For time-to-event endpoints, the platform generates Kaplan-Meier curves -- step-function graphs that show what percentage of patients are still alive (or event-free) at each time point.

> **Kaplan-Meier Curve:** A staircase-shaped graph used in clinical trials to show how many patients survive (or remain event-free) over time. If the treatment works, its curve stays higher.

> **Hazard Ratio (HR):** A single number that summarises how much the treatment reduces (or increases) the risk of an event. HR = 0.5 means the treatment cuts the risk in half. HR = 1.0 means no difference. In oncology, a hazard ratio below 0.7 is generally considered clinically meaningful.

#### Adaptive Design: Peeking at the Data

Some trials are designed to "peek" at the results before the trial is finished. But peeking introduces a statistical problem: the more times you look, the more likely you are to see a false positive by chance. The platform uses O'Brien-Fleming boundaries to solve this.

> **O'Brien-Fleming Spending Function:** A method for controlling false positive rates in adaptive trials. At the first interim look, the threshold is extremely strict -- the evidence needs to be overwhelming to stop. At later looks, the threshold relaxes. This ensures the overall false positive rate stays at 5%.

#### The Trial Verdict

- **TRIAL GO** -- The trial is well-powered, feasible, and the molecule is safe enough. Proceed to IND filing.
- **CONDITIONAL GO** -- The trial might work but has risks. Consider adaptive design, biomarker enrichment, or dose adjustment.
- **TRIAL NO-GO** -- The trial is underpowered, infeasible, or the molecule is too risky. Go back and redesign.

> **IND (Investigational New Drug Application):** The formal application submitted to the FDA requesting permission to begin testing a new drug in humans. An IND approval is the gateway from the laboratory to the clinic.

---

### Chapter 5: The Safety Net That Never Sleeps (HAIOps)

Running through all four layers is a safety system called HAIOps -- Healthcare AI Operations. It works like a chain of circuit breakers in an electrical system.

If Layer 1 detects a hERG cardiac safety flag, that flag doesn't just appear in Layer 1's results. It propagates through every downstream layer: Layer 2 increases cardiac monitoring in the animal study design, Layer 3 adds QT prolongation to the adverse event watch list, and Layer 4 factors the cardiac risk into the trial's safety endpoints.

There are six flags in the safety cascade: Cardiac Risk, Hepatotoxicity (liver damage), Drug-Drug Interaction, Narrow Therapeutic Margin, High-Grade Adverse Events, and Subgroup Disparity. Each one, once triggered, follows the molecule through its entire simulated journey.

And here's the critical rule: the AI can never override a safety flag. If the platform issues a NO-GO verdict and a human scientist decides to proceed anyway, they must document their reasoning. Their name, their rationale, and their decision are logged in an audit trail that regulators can inspect. The human is always in the loop. The AI is the advisor, never the authority.

---

### Chapter 6: Your Molecule Never Leaves the Room (Privacy)

A drug molecule's chemical structure is the most valuable intellectual property a biotech company owns. If a competitor learned the structure of your lead compound, years of research would be compromised.

HakaseAI is built on a zero-knowledge architecture. Every simulation runs entirely in the user's web browser. The SMILES string -- the molecular blueprint -- is never transmitted to any server. The chemistry engine (RDKit, compiled to WebAssembly) runs locally. The ADMET scoring runs locally. The PK models run locally.

Even when AI-powered models are added in the future, the architecture is designed so that only a molecular fingerprint -- a one-way mathematical hash that cannot be reversed -- is ever sent to a server. The server never sees the actual molecule. Not even HakaseAI itself can reconstruct what the user entered.

> **Zero-Knowledge Architecture:** A system design where the platform can process your data and return useful results without ever learning what your data actually is. It's like asking a calculator to add two numbers while the calculator is blindfolded -- it gives you the right answer, but it never saw the numbers.

---

### Epilogue: What This All Means

Without HakaseAI, a biotech company might spend $750,000 screening 50 compounds in the wet lab, only to find that 40 of them fail basic safety tests. They might invest $300,000 in biostatistics consulting to design a trial, only to discover at the interim analysis that it was underpowered from the start.

With HakaseAI, the same company screens all 50 compounds digitally in an afternoon, eliminates 35-40 obvious failures, sends only the top 10 to the lab, and designs a trial that has been stress-tested across 10,000 Monte Carlo simulations before the first patient is enrolled.

**The result: $1M-$4M+ saved, 6-12 months compressed, and a dramatically higher probability of success.**

The platform doesn't replace scientists. It gives them superpowers. It lets a medicinal chemist test a hypothesis in seconds instead of weeks. It lets a biostatistician explore 50 trial designs in an hour instead of one design in a month. It lets a CEO make a go/no-go decision with data instead of gut feeling.

That's the story of a molecule's journey through HakaseAI. Four layers. Four questions. One answer: **should we bet on this drug?**

---

*Document generated from HakaseAI platform codebase -- March 2026*
