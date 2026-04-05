# HakaseAI — Comprehensive Product Glossary

A complete reference of every term, acronym, metric, and concept used across the HakaseAI BioDigital Twin Platform.

---

## Table of Contents

1. [Project & Platform](#1-project--platform)
2. [Layer 1 — In Vitro Digital Twin (Violet)](#2-layer-1--in-vitro-digital-twin-violet)
3. [Layer 2 — Animal Cohort (Amber)](#3-layer-2--animal-cohort-amber)
4. [Layer 3 — Patient Cohort Twin (Blue)](#4-layer-3--patient-cohort-twin-blue)
5. [Layer 4 — Trial Digital Twin (Emerald)](#5-layer-4--trial-digital-twin-emerald)
6. [ADMET Profiling](#6-admet-profiling)
7. [Bioactivation Engine & Mechanistic Toxicity](#7-bioactivation-engine--mechanistic-toxicity)
8. [External Database Enrichment](#8-external-database-enrichment)
9. [HAIOps Governance & Safety Cascade](#9-haiops-governance--safety-cascade)
10. [Provenance & Audit](#10-provenance--audit)
11. [Molecular Chemistry & Descriptors](#11-molecular-chemistry--descriptors)
12. [Pharmacokinetics (PK)](#12-pharmacokinetics-pk)
13. [Pharmacodynamics (PD)](#13-pharmacodynamics-pd)
14. [Toxicology](#14-toxicology)
15. [Regulatory & Compliance](#15-regulatory--compliance)
16. [Clinical & Statistical Terms](#16-clinical--statistical-terms)
17. [Therapeutic Areas](#17-therapeutic-areas)
18. [Diagen AI Ecosystem Integration](#18-diagen-ai-ecosystem-integration)
19. [UI Components & Navigation](#19-ui-components--navigation)
20. [Off-Target Panels by Therapeutic Area](#20-off-target-panels-by-therapeutic-area)
21. [Cell Lines by Therapeutic Area](#21-cell-lines-by-therapeutic-area)
22. [Predefined Target Proteins (ADMET Target Map)](#22-predefined-target-proteins-admet-target-map)
23. [Demo Molecules](#23-demo-molecules)
24. [Reference Drug Comparators by Therapeutic Area](#24-reference-drug-comparators-by-therapeutic-area)
25. [Species Parameters (Animal Simulation Library)](#25-species-parameters-animal-simulation-library)
26. [Study Designs (Animal Cohort)](#26-study-designs-animal-cohort)
27. [Formulation Options](#27-formulation-options)
28. [Dosing Frequencies & Escalation Schemes](#28-dosing-frequencies--escalation-schemes)
29. [Comorbidities (ICD-10 Codes)](#29-comorbidities-icd-10-codes)
30. [Clinical Trial Sites](#30-clinical-trial-sites)
31. [PROCOVA Variance Reduction Lookup Table](#31-procova-variance-reduction-lookup-table)
32. [Trial Cost Model Parameters](#32-trial-cost-model-parameters)
33. [Adverse Event Types (Cohort Simulation)](#33-adverse-event-types-cohort-simulation)
34. [Assay Thresholds & Classification Criteria](#34-assay-thresholds--classification-criteria)
35. [AOP (Adverse Outcome Pathway) Reference Numbers](#35-aop-adverse-outcome-pathway-reference-numbers)
36. [Geographic Regions (Trial Simulation)](#36-geographic-regions-trial-simulation)
37. [Matching Variables (Adaptive / Stratified Randomization)](#37-matching-variables-adaptive--stratified-randomization)
38. [3D Viewer Modes](#38-3d-viewer-modes)
39. [Simulation Options (Layer 1 Toggles)](#39-simulation-options-layer-1-toggles)
40. [Trial Blinding Options](#40-trial-blinding-options)
41. [Statistical Boundary Methods](#41-statistical-boundary-methods)
42. [Routes of Administration](#42-routes-of-administration)
43. [Ranking Criteria (Batch Mode)](#43-ranking-criteria-batch-mode)
44. [Data Import Sources](#44-data-import-sources)

---

## 1. Project & Platform

| Term | Definition |
|------|-----------|
| **HakaseAI** | The BioDigital Twin platform. A privacy-first drug simulation environment that runs entirely client-side (browser). |
| **BioDigital Twin** | A virtual computational replica of biological and clinical processes used to simulate drug behavior across four layers of increasing complexity. |
| **Project** | A discrete simulation workspace within HakaseAI. Each project centers on a single compound (molecule) and its associated target protein. Projects can be saved, loaded, and carry forward results across all four layers. |
| **Current Project** | The active working session, identified by its molecule name, target protein, and simulation status. |
| **Saved Projects** | Previously completed or in-progress simulations stored locally in the browser for reloading. |
| **Privacy-First** | Core design principle: all SMILES strings and molecular data remain in the browser and are never transmitted to HakaseAI servers. |
| **Client-Side Simulation** | All simulation engines (In Vitro, Animal, Cohort, Trial) execute directly in the user's browser using JavaScript/WebAssembly, rather than on remote servers. |
| **Four-Layer Pipeline** | The cascading simulation architecture: Layer 1 (In Vitro) → Layer 2 (Animal Cohort) → Layer 3 (Patient Cohort) → Layer 4 (Clinical Trial). Results propagate forward through each layer. |
| **Cascade** | The automatic forwarding of results from one layer to the next (e.g., "Layer 1 → Layer 2 Cascade Applied"), where upstream findings inform downstream simulation parameters. |
| **Go / No-Go** | A governance decision point at each layer. **GO** = safe to proceed; **WATCH** = caution, review recommended; **NO-GO** = safety or efficacy concerns block advancement. |
| **Discovery Engine** | The Layer 1 simulation engine that runs in vitro assay predictions, ADMET profiling, and external database enrichment. |

---

## 2. Layer 1 — In Vitro Digital Twin (Violet)

| Term | Definition |
|------|-----------|
| **In Vitro** | Latin for "in glass." Refers to experiments conducted outside a living organism, typically in test tubes, cell cultures, or microplates. Layer 1 simulates these digitally. |
| **SMILES** | Simplified Molecular-Input Line-Entry System. A text notation for describing the structure of chemical molecules (e.g., `CC(=O)Oc1ccccc1C(=O)O` for aspirin). |
| **SMILES String** | The raw text input representing a compound's molecular structure, validated by RDKit. |
| **RDKit** | An open-source cheminformatics toolkit loaded as WebAssembly (RDKit.js) in the browser. Used for SMILES validation, molecular descriptor calculation, fingerprinting, and 2D depiction. |
| **Molecule Name** | User-assigned identifier for the compound under study (e.g., "Ibuprofen", "New-Compound-001"). Auto-generated if left blank. |
| **UniProt ID** | A unique accession number from the UniProt protein database (e.g., P00533 for EGFR). Identifies the biological target protein. |
| **PDB ID** | A four-character identifier from the RCSB Protein Data Bank (e.g., 4HJO). References the 3D crystal structure of the target protein. |
| **AlphaFold** | DeepMind's AI system for predicting 3D protein structures. Referenced for integration when no experimental PDB structure is available. |
| **Target Protein** | The specific protein a drug candidate is designed to interact with (bind to, inhibit, or activate). |
| **IC50** | Inhibitory Concentration 50%. The concentration of a compound required to inhibit 50% of a biological process. Lower values indicate greater potency. Measured in nM (nanomolar) or µM (micromolar). |
| **Caco-2** | A human colon adenocarcinoma cell line used as a model for intestinal drug absorption. |
| **Caco-2 Papp** | Apparent Permeability coefficient measured across Caco-2 cell monolayers. Predicts oral absorption. Expressed in cm/s (×10⁻⁶). |
| **PAMPA** | Parallel Artificial Membrane Permeability Assay. A non-cell-based method to predict passive transcellular permeability. |
| **PAMPA Pe** | Effective permeability measured via PAMPA. Complementary to Caco-2. |
| **Efflux Ratio** | The ratio of basolateral-to-apical versus apical-to-basolateral permeability. Ratios >2 suggest active efflux by transporters like P-gp. |
| **P-gp Substrate** | Whether a compound is a substrate for P-glycoprotein, an efflux transporter that can limit oral bioavailability and brain penetration. |
| **Microsomal CLint** | Intrinsic clearance measured in liver microsomes. Predicts how quickly the liver metabolizes a compound. |
| **Hepatocyte CLint** | Intrinsic clearance measured in whole hepatocyte cells. A more physiologically complete measure than microsomal CLint. |
| **CYP Inhibition Panel** | Assessment of a compound's ability to inhibit cytochrome P450 enzymes — CYP1A2, CYP2C9, CYP2C19, CYP2D6, CYP3A4. Inhibition can cause drug-drug interactions. |
| **hERG** | Human Ether-à-go-go-Related Gene. Encodes a potassium channel critical for cardiac rhythm. hERG inhibition is a major cardiac safety liability. |
| **Patch Clamp** | Electrophysiology technique used to measure hERG channel inhibition. The gold standard for cardiac ion channel safety assessment. |
| **Kinase Selectivity Score** | A measure of how selectively a compound inhibits its intended kinase target versus other kinases. Lower scores indicate broader (less selective) inhibition. |
| **CC50** | Cytotoxic Concentration 50%. The concentration at which 50% of cells die. Used to assess general cytotoxicity. |
| **Off-Target Panel** | A set of proteins/receptors tested beyond the primary target to identify unintended interactions that could cause side effects. |
| **Cell Line** | A specific population of cells used for in vitro testing. Examples: HEK293 (kidney), HepG2 (liver), SH-SY5Y (neuronal), A549 (lung), MCF-7 (breast cancer). |
| **Dose-Response Curve** | A graph showing the relationship between drug concentration and biological effect. Used to derive IC50, EC50, and Hill coefficient. |
| **Molecular Fingerprint (ECFP4)** | Extended Connectivity Fingerprint with diameter 4. A circular fingerprint encoding molecular substructure patterns, used for similarity searches and machine learning. |
| **Morgan Fingerprint** | Synonym for ECFP. Encodes atom neighborhoods at varying radii for structural comparison. |
| **In Vitro Score** | A composite score (0–100%) summarizing the overall in vitro profile of a compound across all assays. |
| **3D Molecular Viewer** | Interactive three-dimensional visualization of the compound and/or target protein structure rendered in the browser. |
| **Run In Vitro Simulation** | The primary action button that triggers Layer 1 computation across all in vitro assay models. |
| **Behavioral Fingerprinting** | An optional simulation mode that applies enhanced surveillance to selected tissue types, amplifying organ risk scores by 1.25x and adding provenance tracking for the enhanced monitoring. |

---

## 3. Layer 2 — Animal Cohort (Amber)

| Term | Definition |
|------|-----------|
| **Animal Cohort** | A group of laboratory animals used in preclinical toxicology and pharmacokinetic studies. Layer 2 simulates these studies digitally. |
| **Species Selection** | The choice of animal model for preclinical testing. |
| **SD Rat (Sprague Dawley)** | An outbred albino rat strain commonly used in toxicology and pharmacology studies. |
| **Wistar Rat** | An outbred albino rat strain, slightly different genetic background from SD. |
| **CD-1 Mouse** | An outbred Swiss-derived mouse strain used in general toxicology. |
| **C57BL/6 Mouse** | An inbred mouse strain widely used in genetics and immunology research. |
| **Beagle Dog** | The standard non-rodent species for preclinical toxicology (regulatory requirement for a second species). |
| **Cynomolgus Monkey (Cyno)** | A non-human primate used when human-relevant biology requires a closer species match. |
| **Human Translation Panel** | A background reference panel that projects animal findings to human-equivalent parameters. Not selectable as a test species — it is the translation target. |
| **PBPK** | Physiologically Based Pharmacokinetic modeling. A mathematical framework that simulates drug distribution through interconnected organ compartments based on blood flows, tissue volumes, and partition coefficients. |
| **2-Compartment Model** | A simplified PK model dividing the body into a central compartment (blood/well-perfused organs) and a peripheral compartment (less-perfused tissues). |
| **Allometric Scaling** | A method of predicting human PK parameters from animal data based on body weight relationships across species. Uses the FDA Km factor. |
| **Allometric Km Factor** | A species-specific correction factor used in allometric scaling to convert animal doses to human equivalent doses. |
| **GFR** | Glomerular Filtration Rate. The volume of fluid filtered by the kidneys per unit time. A measure of renal function. |
| **Hepatic Blood Flow** | Blood flow through the liver, critical for predicting hepatic clearance of drugs. |
| **Cardiac Output** | The total volume of blood pumped by the heart per minute. Used in PBPK models as the driver of organ perfusion. |
| **NOAEL** | No-Observed-Adverse-Effect-Level. The highest dose in an animal study at which no adverse effects are observed. Critical for setting human starting doses. |
| **MTD** | Maximum Tolerated Dose. The highest dose that can be administered without unacceptable toxicity. |
| **FIH Dose** | First-in-Human dose. The starting dose for Phase I clinical trials, derived from animal NOAEL using safety factors and allometric scaling. |
| **HED** | Human Equivalent Dose. The animal dose converted to a human-relevant dose using BSA (Body Surface Area) or allometric Km factors. |
| **BSA** | Body Surface Area. Used in dose conversion between species (FDA guidance). |
| **Study Design** | The structure of an animal study: duration, dose groups, endpoints, and recovery periods. |
| **Acute Single Dose** | A single administration of the drug, with observation over 14 days. |
| **Sub-chronic (28d)** | Repeated daily dosing for 28 days with full toxicology assessment. Standard IND-enabling study. |
| **Chronic (6mo/9mo)** | Long-term repeated dosing studies required for drugs intended for chronic use in humans. |
| **Carcinogenicity** | Two-year rodent studies assessing cancer risk. Required for drugs intended for long-term human use. |
| **Route of Administration** | How the drug is delivered: oral (PO), intravenous (IV), subcutaneous (SC), intraperitoneal (IP), intramuscular (IM). |
| **Formulation / Drug Delivery** | The physical preparation of the drug for administration. |
| **Plain / Aqueous** | A simple water-based drug solution. |
| **Lipid-based (SEDDS)** | Self-Emulsifying Drug Delivery System. Lipid formulations that improve absorption of poorly soluble compounds. |
| **Nanocrystal Suspension** | Drug particles reduced to nanometer scale to increase dissolution rate and bioavailability. |
| **Solid Dispersion** | Drug dispersed in a polymer matrix to maintain amorphous form and enhance solubility. |
| **Cyclodextrin Complex** | Drug encapsulated in cyclodextrin molecules to improve aqueous solubility. |
| **Recovery Group** | Animals that receive the drug during the dosing phase but are then observed drug-free to assess reversibility of any toxic effects. |
| **Satellite TK** | Satellite toxicokinetic group. Additional animals in a toxicology study used solely for blood sampling to measure drug exposure without affecting the main toxicology endpoints. |
| **Study Group Design** | The allocation of animals into dose groups (vehicle control, low, mid, high dose) with sex balance and satellite TK groups. |

---

## 4. Layer 3 — Patient Cohort Twin (Blue)

| Term | Definition |
|------|-----------|
| **Patient Cohort** | A defined group of virtual patients with specific demographic and clinical characteristics used to simulate population-level drug response. |
| **Disease & Indication** | The medical condition the drug is intended to treat. |
| **Primary Indication** | The main disease target for the drug candidate. |
| **ICD-10** | International Classification of Diseases, 10th Revision. A standardized coding system for medical diagnoses (e.g., C34 for lung cancer). |
| **Disease Severity** | Classification of how advanced or serious the patient's condition is (mild, moderate, severe). |
| **Cohort Demographics** | Statistical characteristics of the simulated patient population. |
| **Cohort Size** | The number of virtual patients in the simulation (typically 100–10,000). |
| **Age Range** | The minimum and maximum age of patients included in the cohort. |
| **Sex Distribution** | The ratio of male to female patients in the cohort. |
| **Male Fraction** | The proportion of male patients in the simulated cohort. |
| **eGFR** | Estimated Glomerular Filtration Rate. A measure of kidney function used to stratify patients and adjust doses for renal impairment. |
| **eGFR Range** | The minimum and maximum kidney function values for patient inclusion. |
| **NHANES Statistics** | National Health and Nutrition Examination Survey. US population-level health data used as the statistical foundation for generating realistic virtual patient demographics (mean weight, age, eGFR, etc.). |
| **Patient Comorbidities** | Additional medical conditions a patient has beyond the primary indication (e.g., diabetes, hypertension, hepatic impairment). |
| **Comorbid Conditions** | Co-existing diseases that may affect drug metabolism, efficacy, or safety. |
| **PK/PD Parameters** | Pharmacokinetic and pharmacodynamic parameters that define how the drug behaves in virtual patients. |
| **Pharmacogenomics (PGx)** | The study of how genetic variation affects drug response. |
| **CYP2D6** | Cytochrome P450 2D6. A highly polymorphic liver enzyme responsible for metabolizing ~25% of drugs. Patients can be poor, intermediate, extensive, or ultra-rapid metabolizers. |
| **CYP3A4** | Cytochrome P450 3A4. The most abundant CYP enzyme, metabolizing ~50% of all drugs. |
| **CYP2C19** | Cytochrome P450 2C19. Important for metabolizing proton pump inhibitors, antidepressants, and antiplatelet drugs. |
| **CYP2C9** | Cytochrome P450 2C9. Metabolizes warfarin, NSAIDs, and sulfonylureas. |
| **Starting Dose** | The initial dose administered to virtual patients at the beginning of the cohort simulation. |
| **Dosing Frequency** | How often the drug is administered. |
| **QD** | Once daily (quaque die). |
| **BID** | Twice daily (bis in die). |
| **TID** | Three times daily (ter in die). |
| **QID** | Four times daily (quater in die). |
| **Responder Rate** | The percentage of virtual patients who achieve a clinically meaningful response. |
| **Non-Responder** | A patient who does not achieve the minimum threshold of therapeutic benefit. |
| **Partial Responder** | A patient who achieves some but not complete therapeutic benefit. |
| **SD (Stable Disease)** | A patient whose condition neither improves nor worsens significantly. |
| **DLT** | Dose-Limiting Toxicity. An adverse event severe enough to prevent further dose escalation. |
| **Grade 3+ AE** | An adverse event of Grade 3 or higher severity (severe, life-threatening, or fatal) on the CTCAE scale. |
| **Biomarker Sensitivity** | The ability of a biomarker to correctly identify patients who will respond to treatment. |
| **FAERS** | FDA Adverse Event Reporting System. A database of post-market adverse event reports used to benchmark simulated safety signals. |
| **openFDA** | The FDA's public API providing access to FAERS data, drug labeling, and recall information. |
| **MedDRA** | Medical Dictionary for Regulatory Activities. A standardized medical terminology used for adverse event coding (version 26.0). Uses Preferred Terms (PT). |

---

## 5. Layer 4 — Trial Digital Twin (Emerald)

| Term | Definition |
|------|-----------|
| **Trial Digital Twin** | A virtual simulation of a complete clinical trial, including enrollment, randomization, endpoints, adaptive rules, and regulatory outputs. |
| **Trial Design Schema** | The overall structure of the clinical trial. |
| **Randomized Controlled** | A trial where patients are randomly assigned to treatment or control groups. The gold standard of clinical evidence. |
| **Double-Blind** | Neither the patient nor the investigator knows which treatment is being administered, reducing bias. |
| **Single-Arm + Synthetic Control** | A trial with only a treatment group, using historical or modeled data as the comparator. |
| **Crossover** | A trial where patients receive both treatment and control sequentially, serving as their own controls. |
| **Basket / Umbrella** | Adaptive trial designs. Basket trials test one drug across multiple diseases. Umbrella trials test multiple drugs within one disease based on biomarkers. |
| **Phase I** | First-in-human studies focused on safety, tolerability, and PK. Typically 20–80 healthy volunteers or patients. |
| **Phase II** | Exploratory efficacy studies in patients with the target disease. Typically 100–300 patients. |
| **Phase III** | Confirmatory efficacy and safety studies. Large-scale (300–3,000+ patients), pivotal for regulatory approval. |
| **Phase IV** | Post-marketing surveillance studies conducted after regulatory approval. |
| **Endpoint Configuration** | The definition of what the trial measures to determine success or failure. |
| **Primary Endpoint** | The main outcome measure that determines whether the trial succeeds. |
| **Secondary Endpoint** | Additional outcome measures that provide supporting evidence. |
| **Time-to-Event** | An endpoint measuring the time until a specific event occurs (e.g., disease progression, death). Analyzed using survival analysis. |
| **Continuous** | An endpoint measured on a continuous numerical scale (e.g., blood pressure reduction, tumor shrinkage percentage). |
| **Binary** | An endpoint with two possible outcomes (e.g., response vs. no response). |
| **Composite** | An endpoint combining multiple individual outcomes into a single measure. |
| **Hazard Ratio (HR)** | The ratio of event rates between treatment and control groups. HR < 1 favors treatment. |
| **p-Value** | The probability of observing the trial result (or more extreme) if the treatment has no effect. Typically, p < 0.05 is considered statistically significant. |
| **Significance Level (alpha)** | The threshold below which the p-value must fall to declare statistical significance (commonly 0.05). |
| **Statistical Power** | The probability of correctly detecting a true treatment effect (typically targeted at 80–90%). |
| **Power Target** | The desired statistical power for the trial (e.g., 0.80 = 80%). |
| **Sample Size** | The total number of patients required in the trial to achieve the desired power. |
| **Monte Carlo** | A computational method using repeated random sampling to simulate trial outcomes and estimate probabilities of success. Default: 1,000 replications. |
| **Enrollment Rate** | The number of patients recruited per site per month. |
| **Dropout Rate** | The percentage of enrolled patients who leave the trial before completion. Modeled using exponential decay. |
| **Site Selection** | The choice of clinical trial sites (e.g., MD Anderson, Royal Marsden, Memorial Sloan Kettering). |
| **P(success)** | Probability of trial success. The overall likelihood of achieving statistically significant results. |
| **Median PFS** | Median Progression-Free Survival. The time at which 50% of patients have experienced disease progression. A common oncology endpoint. |
| **Kaplan-Meier Curve** | A step-function survival curve showing the proportion of patients event-free over time. |
| **Weibull Distribution** | A statistical distribution used to model survival times. More flexible than exponential, allowing for increasing or decreasing hazard rates. |
| **Survival Curve** | A graph showing the probability of remaining event-free (alive, progression-free) over time. |
| **Power Curve** | A graph showing how statistical power changes with sample size, effect size, or other parameters. |

### Adaptive Design

| Term | Definition |
|------|-----------|
| **Adaptive Design** | A clinical trial design that allows pre-planned modifications based on accumulating data (e.g., sample size adjustment, arm dropping). |
| **Interim Analysis** | A planned look at trial data before final enrollment. Used to make adaptation decisions. |
| **Interim Analysis Timing** | The fraction of total information (events) at which an interim look occurs (e.g., 50%). |
| **O'Brien-Fleming** | A conservative alpha-spending function for interim analyses that preserves most of the significance level for the final analysis. |
| **Alpha-Spending Boundary** | The adjusted significance thresholds at each interim analysis, controlling the overall Type I error rate. |
| **Futility Boundary** | A statistical threshold below which the trial is unlikely to succeed. Crossing it may trigger early stopping for futility. |
| **Superiority Boundary** | A statistical threshold above which treatment superiority is established. Crossing it may allow early stopping for efficacy. |
| **Sample Size Re-estimation (SSR)** | A mid-trial recalculation of the required sample size based on observed effect size or variability. |
| **Stop for Efficacy** | An interim decision to end the trial early because overwhelming evidence of treatment benefit has been observed. |
| **Stop for Futility** | An interim decision to end the trial early because the treatment is unlikely to demonstrate benefit at final analysis. |
| **DMC / DSMB** | Data Monitoring Committee / Data Safety Monitoring Board. An independent group that reviews interim data and makes recommendations about trial continuation. |

### PROCOVA Module

| Term | Definition |
|------|-----------|
| **PROCOVA** | Prognostic Covariate Adjustment. A statistical methodology that uses pre-specified baseline covariates (e.g., age, disease severity, biomarkers) to reduce unexplained variance in trial endpoints, thereby increasing statistical power without adding patients. |
| **Variance Reduction** | The degree to which PROCOVA reduces the noise in trial endpoints. Expressed as R² (coefficient of determination). Higher R² means more noise removed. |
| **R² (Variance Reduction Factor)** | The proportion of endpoint variance explained by prognostic covariates. Typical values: 10–40%. |
| **Manual Override** | User-specified R² value, overriding the default lookup table for the selected indication. |
| **Power Gain** | The increase in statistical power achieved by applying PROCOVA (e.g., from 80% to 88%). |
| **Sample Size Reduction** | The number of fewer patients needed to achieve the same power when using PROCOVA. |
| **Cost Savings** | The estimated reduction in trial cost from enrolling fewer patients, calculated from per-patient costs and site-level overhead. |
| **Duration Savings** | The estimated reduction in trial duration (months) from needing fewer patients. |
| **Randomization Ratio** | The ratio of treatment to control patients (e.g., 1:1, 2:1, 3:1). |
| **Sensitivity Grid** | A matrix showing PROCOVA results across different R² values and randomization ratios, enabling sponsors to explore scenarios. |
| **Variance Reduction Table** | A built-in lookup table mapping therapeutic indications (Alzheimer's, MS, ALS, Parkinson's, Oncology, Rare Disease) to published or estimated R² values. |

### Trial Cost Modeling

| Term | Definition |
|------|-----------|
| **Per-Patient Cost** | The cost to enroll and manage one patient through the trial. Varies by phase: Phase I (~$28K), Phase II (~$58K), Phase III (~$105K). |
| **Indication Multiplier** | A cost modifier based on disease area complexity: Oncology (1.45x), CNS (1.60x), Rare Disease (1.55x). |
| **Site Startup Cost** | One-time costs per clinical site (~$90K) for regulatory approval, training, and setup. |
| **Site Management Cost** | Ongoing operational costs per site ($320K–$1.8M depending on phase and complexity). |
| **Regulatory Costs** | Fixed costs for regulatory submissions, interactions, and compliance ($1.1M–$5.5M). |
| **Manufacturing Costs** | Fixed costs for clinical supply manufacturing ($1.1M–$7M depending on phase). |
| **Overhead (CRO)** | A 1.33x multiplier covering Contract Research Organization fees, safety monitoring, data management, and medical writing. |

---

## 6. ADMET Profiling

| Term | Definition |
|------|-----------|
| **ADMET** | Absorption, Distribution, Metabolism, Excretion, and Toxicity. The five key pharmacokinetic and safety properties evaluated for every drug candidate. |
| **ADMET Profiling / Directional** | HakaseAI's ADMET module is directional — it supports and contextualizes in vitro simulation results rather than functioning as a standalone predictor. |
| **Absorption** | How a drug enters the bloodstream. Influenced by solubility, permeability, and intestinal transporters. |
| **Distribution** | How a drug spreads through the body to tissues and organs. Influenced by plasma protein binding and tissue affinity. |
| **Metabolism** | How the body chemically transforms the drug, primarily in the liver via CYP enzymes. |
| **Excretion** | How the drug and its metabolites are eliminated from the body (renal, biliary, pulmonary). |
| **Toxicity** | Adverse effects of the drug on organs, cells, or biological processes. |
| **Lipinski Analysis** | Evaluation against Lipinski's Rule of Five for predicting oral bioavailability. |
| **Rule of Five** | Pfizer's guideline: poor absorption is likely when MW > 500, LogP > 5, HBD > 5, HBA > 10. |
| **Lead-likeness** | A stricter set of drug-likeness criteria (MW 200–450, LogP -1 to 4, HBD ≤ 4, HBA ≤ 8, rotatable bonds ≤ 8). |
| **QED** | Quantitative Estimate of Drug-likeness. A composite score (0–1) integrating multiple molecular properties into a single drug-likeness metric. |
| **SA Score** | Synthetic Accessibility Score. Predicts how easy or difficult a compound is to synthesize (1 = easy, 10 = very difficult). |
| **BCS** | Biopharmaceutics Classification System. Classifies drugs into four categories based on solubility and permeability: Class I (high/high), Class II (low/high), Class III (high/low), Class IV (low/low). |
| **Organ Risk** | Predicted toxicity risk to specific organs: Liver, Heart, Kidney, CNS, GI (gastrointestinal), Lung. |
| **Toxicity Alerts** | Flagged safety concerns including hERG inhibition, hepatotoxicity, genotoxicity, CNS toxicity, reactive metabolite formation, Ames positivity, and DILI risk. |

---

## 7. Bioactivation Engine & Mechanistic Toxicity

| Term | Definition |
|------|-----------|
| **Bioactivation** | The metabolic conversion of a drug into chemically reactive intermediates that can damage cellular macromolecules (DNA, proteins). |
| **Reactive Intermediates** | Chemically unstable metabolites formed during bioactivation that can covalently bind to proteins or DNA, causing toxicity. |
| **AOP** | Adverse Outcome Pathway. A conceptual framework linking a molecular initiating event (e.g., protein covalent binding) through key events to an adverse outcome (e.g., liver failure). |
| **Structural Alerts** | Chemical substructures known to be associated with toxicity or bioactivation risk. |
| **Aniline** | An aromatic amine structural alert associated with methemoglobinemia and hepatotoxicity. |
| **Quinone** | A structural alert for redox cycling and oxidative stress. |
| **Thiophene** | A heterocyclic structural alert associated with reactive epoxide formation. |
| **Acyl Glucuronide** | A metabolic conjugate that can rearrange and covalently modify proteins, associated with idiosyncratic toxicity. |
| **Arene Oxide** | A reactive epoxide intermediate formed from aromatic ring metabolism. |
| **Michael Acceptor** | An electrophilic structural motif that can react with nucleophilic amino acids (e.g., cysteine), forming covalent adducts. |
| **Furan** | A heterocyclic structural alert metabolized to reactive cis-enedials. |
| **MDP (Methylenedioxyphenyl)** | A structural alert that forms reactive carbene intermediates, inhibiting CYP enzymes. |
| **Covalent Binding** | The irreversible attachment of a reactive metabolite to cellular proteins or DNA. |
| **GSH Trapping** | Glutathione trapping assay. Detects reactive metabolites by their conjugation with glutathione, a cellular antioxidant. |
| **NRF2/KEAP1 Pathway** | A cellular defense pathway activated by oxidative stress. NRF2 upregulates antioxidant genes. Relevant to assessing oxidative toxicity risk. |
| **NAT2** | N-acetyltransferase 2. A phase II metabolic enzyme. Polymorphisms affect metabolism of aromatic amines and hydrazines. |
| **UGT** | UDP-glucuronosyltransferase. A family of phase II enzymes that conjugate drugs with glucuronic acid for excretion. |

---

## 8. External Database Enrichment

| Term | Definition |
|------|-----------|
| **External DB Enrichment** | Layer 1 automatically queries 12+ public biomedical databases to contextualize simulation results with real-world experimental data. |
| **BindingDB** | A database of experimentally measured binding affinities (IC₅₀, Ki, Kd) between drug-like molecules and protein targets. |
| **ChEMBL** | A large-scale bioactivity database maintained by EMBL-EBI. Contains compound-target activity data from medicinal chemistry literature. |
| **Multi-Target Bioactivity** | A ChEMBL-derived analysis showing all known protein targets a compound interacts with (polypharmacology profiling). |
| **pChEMBL** | A normalized activity score in ChEMBL: -log₁₀(IC₅₀/Ki/Kd/EC₅₀ in M). Values ≥ 5 indicate potent activity. |
| **Compound Report Card** | The ChEMBL summary page for a compound, showing all known activities, targets, and properties. |
| **STRING** | Search Tool for the Retrieval of Interacting Genes/Proteins. A database of known and predicted protein-protein interactions with confidence scores. |
| **Confidence Score (STRING)** | A numerical score (0–1) indicating the reliability of a predicted protein interaction. Scores > 0.7 are high confidence. |
| **KEGG** | Kyoto Encyclopedia of Genes and Genomes. A database of biological pathways, linking genes to metabolic and signaling pathways. |
| **Pathway Enrichment** | Analysis identifying which biological pathways are most affected by a compound's target interactions. |
| **Reactome** | An open-source, curated database of biological pathways and reactions maintained by EMBL-EBI and NYUMC. |
| **PharmGKB** | Pharmacogenomics Knowledge Base. A database linking genetic variants to drug response, including dosing guidelines and clinical annotations. |
| **Variant Significance** | The clinical importance of a genetic variant for drug response (e.g., poor metabolizer alleles). |
| **DisGeNET** | A database of gene-disease associations integrating data from expert-curated repositories and text mining. |
| **Gene-Disease Association Score** | A numerical score from DisGeNET reflecting the strength of evidence linking a gene to a disease. |
| **gnomAD** | Genome Aggregation Database. Contains exome and genome sequencing data from >140,000 individuals, providing population allele frequencies. |
| **pLI Score** | Probability of Loss-of-Function Intolerance. A gnomAD metric indicating how sensitive a gene is to loss-of-function mutations. pLI > 0.9 suggests the gene is essential. |
| **LoF o/e** | Loss-of-Function observed/expected ratio. The ratio of observed to expected loss-of-function variants in gnomAD. Low values indicate constraint (essential genes). |
| **ToxCast (CompTox)** | EPA's Toxicity Forecaster. A high-throughput screening program testing chemicals across hundreds of biological assays. |
| **Assay Hits** | The number of ToxCast assays in which a compound showed biological activity. |
| **LD50** | Lethal Dose 50%. The dose at which 50% of test organisms die. A measure of acute toxicity. |
| **ClinicalTrials.gov** | The US National Library of Medicine's registry of clinical studies. Used to benchmark simulated compounds against real-world trial data. |
| **NCT ID** | National Clinical Trial identifier. A unique number assigned to each study registered on ClinicalTrials.gov (e.g., NCT04012345). |
| **Open Targets** | A platform integrating genomics, transcriptomics, and chemical data to identify and validate drug targets. Provides target-disease evidence scores. |
| **Target-Disease Evidence** | The strength of association between a protein target and a specific disease, scored by Open Targets. |
| **ECOTOX** | EPA's ECOTOXicology Knowledgebase. Environmental toxicology data including NOAEC and species-specific aquatic/terrestrial endpoints. |
| **NOAEC** | No-Observed-Adverse-Effect-Concentration. The environmental equivalent of NOAEL, used for ecotoxicology endpoints. |
| **PubChem** | An NIH database of chemical molecules and their biological activities. Used for compound property lookups and cross-referencing. |
| **UniChem** | A cross-reference service linking chemical identifiers across databases (ChEMBL IDs ↔ PubChem CIDs ↔ DrugBank IDs). |
| **ZINC** | A free database of commercially available compounds for virtual screening. |
| **DrugBank** | A comprehensive database of approved drugs, experimental drugs, and their targets, mechanisms, and interactions. |

---

## 9. HAIOps Governance & Safety Cascade

| Term | Definition |
|------|-----------|
| **HAIOps** | Human-AI Operations. HakaseAI's governance framework ensuring every simulation decision is auditable, safety-checked, and human-reviewable. |
| **HAIOps Framework** | The overarching system combining safety cascades, provenance tracking, override logging, and clinician-in-the-loop review gates. |
| **Safety Cascade** | A multi-flag alert system that propagates safety concerns from upstream layers to downstream layers. A safety flag raised in Layer 1 is visible and considered in Layers 2, 3, and 4. |
| **Safety Flags** | Individual alerts raised when a simulation detects a potential safety issue (e.g., hERG inhibition, hepatotoxicity, narrow therapeutic index). |
| **6-Flag Safety Cascade Engine** | The safety system supports six concurrent safety flag categories that can be raised, acknowledged, and cascaded across layers. |
| **SafetyFlagCascadeBanner** | A UI component that displays upstream safety alerts in the current layer, ensuring the user is aware of inherited concerns. |
| **Review Required** | A governance state indicating that a human must acknowledge and review a safety finding before the simulation can be considered complete. |
| **Acknowledge Review** | The user action of formally reviewing and accepting a safety flag, adding the acknowledgment to the audit trail. |
| **Go/No-Go Recommendation** | The system's automated assessment of whether results support advancement to the next layer. |
| **Confidence Threshold** | The minimum confidence level required for automated decisions. Below this threshold, human review is triggered. |
| **Override** | A deliberate human decision to proceed despite a safety flag or system recommendation, with full logging and justification. |
| **Override Logging** | Every human override is recorded with timestamp, user context, justification, and the original system recommendation. |
| **Clinician-in-the-Loop** | The principle that critical safety and go/no-go decisions require human expert involvement, not fully automated decision-making. |
| **GracefulDegradationBanner** | A UI alert shown when an external database connection is unstable, informing the user that cached or synthetic estimates are being used instead. |

---

## 10. Provenance & Audit

| Term | Definition |
|------|-----------|
| **Provenance** | The complete record of where data came from, how it was processed, what models were used, and what decisions were made. |
| **Provenance Record** | An individual entry in the audit trail documenting a specific data source, computation, or decision. |
| **Audit Trail** | The chronological record of all actions, computations, data sources, and decisions made during a simulation session. |
| **Full Audit Provenance per Layer** | Each of the four simulation layers maintains its own independent, complete provenance record. |
| **ProvenanceFooter** | A UI component displaying the simulation engine version, data sources used, and timestamp for the current results. |
| **Source Attribution** | Explicit documentation of which databases, algorithms, and parameters contributed to each result (e.g., "Source: UniProt, RCSB PDB, ChEMBL, ToxCast"). |
| **Engine Version** | The version identifier of the HAIOps simulation engine (e.g., "HAIOps Engine v2.4"). |

---

## 11. Molecular Chemistry & Descriptors

| Term | Definition |
|------|-----------|
| **Molecular Weight (MW)** | The sum of atomic weights of all atoms in a molecule. Measured in Daltons (Da). Key Lipinski parameter (threshold: 500 Da). |
| **LogP (CrippenClogP)** | The calculated logarithm of the partition coefficient between octanol and water. Measures lipophilicity. Higher values indicate more fat-soluble compounds. |
| **TPSA** | Topological Polar Surface Area. The sum of surfaces of polar atoms (O, N, and attached H). Predicts membrane permeability. TPSA > 140 Å² generally limits oral absorption. |
| **HBD** | Hydrogen Bond Donor count. The number of NH and OH groups. Lipinski threshold: ≤ 5. |
| **HBA** | Hydrogen Bond Acceptor count. The number of O and N atoms. Lipinski threshold: ≤ 10. |
| **Rotatable Bonds** | Bonds that allow free rotation, contributing to molecular flexibility. Too many (>10) can reduce oral bioavailability. |
| **NumAromaticRings** | Count of aromatic ring systems in the molecule. Influences metabolic stability and binding interactions. |
| **FractionCSP3** | Fraction of sp3-hybridized carbons. Higher values indicate more three-dimensionality, which correlates with better clinical success rates. |
| **NumHeavyAtoms** | Count of non-hydrogen atoms in the molecule. |
| **NumHeteroatoms** | Count of non-carbon, non-hydrogen atoms (N, O, S, etc.). |
| **Exact MW** | The precise monoisotopic molecular weight calculated from exact atomic masses. |
| **CrippenMR** | Crippen Molar Refractivity. A calculated physical property related to molecular volume and polarizability. |
| **Chi Values (chi0v–chi4v, chi0n–chi4n)** | Molecular connectivity indices encoding molecular branching and shape at various path lengths. |
| **Hall-Kier Alpha** | A correction factor for atomic size differences used in kappa shape indices. |
| **Kappa Indices (kappa1–3)** | Shape descriptors encoding molecular linearity, branching, and cyclicity. |
| **Phi** | A flexibility index derived from kappa shape indices. |
| **Labute ASA** | Labute's Approximate Surface Area. An estimate of the molecule's solvent-accessible surface area. |
| **NumAmideBonds** | Count of amide bonds (-C(=O)-NH-) in the molecule. |
| **NumSpiroAtoms** | Count of atoms shared between two rings. |
| **NumBridgeheadAtoms** | Count of atoms at the junction of fused ring systems. |
| **NumAtomStereoCenters** | Count of chiral (stereogenic) centers in the molecule. |

---

## 12. Pharmacokinetics (PK)

| Term | Definition |
|------|-----------|
| **Bioavailability (F%)** | The fraction of an administered dose that reaches systemic circulation in active form. 100% for IV; typically lower for oral. |
| **Clearance (CL)** | The volume of blood from which the drug is completely removed per unit time (mL/min or L/hr). |
| **Volume of Distribution (Vd)** | A theoretical volume representing how extensively a drug distributes into tissues. Large Vd indicates extensive tissue distribution. |
| **Half-life (t½)** | The time required for the drug concentration in blood to decrease by 50%. Determines dosing frequency. |
| **Tmax** | Time to maximum concentration. The time after dosing when peak blood levels occur. |
| **Cmax** | Maximum concentration. The highest drug concentration achieved in blood after dosing. |
| **AUC** | Area Under the Curve. The integral of drug concentration over time, representing total drug exposure. |
| **Intrinsic Clearance (CLint)** | The inherent ability of the liver (or other organs) to metabolize a drug, measured without flow or binding limitations. |
| **Plasma Protein Binding** | The fraction of drug bound to plasma proteins (albumin, alpha-1-acid glycoprotein). Only unbound drug is pharmacologically active. |

---

## 13. Pharmacodynamics (PD)

| Term | Definition |
|------|-----------|
| **Emax Model** | A mathematical model describing the maximum achievable drug effect (Emax) and the concentration required for 50% of that effect (EC50). |
| **EC50** | Effective Concentration 50%. The concentration producing 50% of the maximum effect. |
| **Ki** | Inhibition constant. The equilibrium dissociation constant for an inhibitor binding to a target. Lower Ki = higher affinity. |
| **Kd** | Dissociation constant. The equilibrium constant for the reversible binding of a ligand to its receptor. |
| **Hill Coefficient** | A measure of cooperativity in ligand binding. Hill = 1 indicates no cooperativity; >1 indicates positive cooperativity (steeper dose-response curve). |
| **Potency** | The concentration or dose of a drug required to produce a defined effect. More potent drugs require lower concentrations. |
| **Affinity** | The strength of binding between a drug and its target. Quantified by Kd or Ki. |
| **Target Engagement** | The extent to which a drug occupies and modulates its intended biological target at a given dose. |
| **Selectivity** | The degree to which a drug preferentially affects its intended target over other targets. High selectivity reduces off-target side effects. |

---

## 14. Toxicology

| Term | Definition |
|------|-----------|
| **Hepatotoxicity** | Liver toxicity. One of the most common reasons for drug failure and market withdrawal. |
| **DILI** | Drug-Induced Liver Injury. A clinical diagnosis of liver damage caused by a drug. |
| **Genotoxicity** | The ability of a substance to damage DNA, potentially causing mutations or cancer. |
| **Ames Test** | A bacterial mutagenicity assay that detects compounds capable of causing gene mutations. A positive Ames test is a major regulatory concern. |
| **Cardiac Safety** | Assessment of a drug's potential to cause cardiac arrhythmias, particularly via hERG channel inhibition leading to QT prolongation. |
| **QT Prolongation** | An abnormal lengthening of the QT interval on an electrocardiogram, associated with potentially fatal arrhythmias (Torsades de Pointes). |
| **SJS/TEN** | Stevens-Johnson Syndrome / Toxic Epidermal Necrolysis. Severe, life-threatening skin reactions that can be drug-induced. |
| **Idiosyncratic Toxicity** | Unpredictable adverse reactions occurring in a small subset of patients, often immune-mediated and not dose-dependent. |
| **Narrow Therapeutic Index** | A drug where the difference between the effective dose and the toxic dose is small, requiring careful dose management. |
| **CTCAE** | Common Terminology Criteria for Adverse Events. A standardized grading scale (1–5) for adverse event severity. |

---

## 15. Regulatory & Compliance

| Term | Definition |
|------|-----------|
| **ICH** | International Council for Harmonisation of Technical Requirements for Pharmaceuticals for Human Use. Sets global standards for drug development. |
| **ICH M3** | Guidance on nonclinical safety studies for the conduct of human clinical trials. |
| **ICH S4** | Duration of chronic toxicity testing in animals. |
| **ICH S7A** | Safety pharmacology studies (core battery: cardiovascular, respiratory, CNS). |
| **ICH S7B** | Nonclinical evaluation of the potential for delayed ventricular repolarization (QT interval prolongation). |
| **ICH S2** | Genotoxicity testing and data interpretation. |
| **ICH E6** | Good Clinical Practice (GCP). The ethical and scientific quality standard for clinical trials. |
| **ICH E9** | Statistical principles for clinical trials. |
| **FDA** | U.S. Food and Drug Administration. The primary regulatory authority for drug approval in the United States. |
| **IND** | Investigational New Drug application. The regulatory submission that allows a drug to enter clinical trials. |
| **IND-Enabling** | The package of preclinical studies required to support an IND application (GLP tox, genotoxicity, safety pharmacology). |
| **GLP** | Good Laboratory Practice. The regulatory standard for conducting preclinical safety studies. |
| **GLP Toxicology** | Toxicology studies conducted under GLP compliance, required for regulatory submissions. |
| **Breakthrough Therapy** | An FDA designation for drugs showing substantial improvement over existing treatments for serious conditions. Provides intensive FDA guidance and potential rolling review. |
| **Fast Track** | An FDA designation facilitating development and expediting review for drugs treating serious conditions with unmet medical need. |
| **Orphan Drug** | A designation for drugs treating rare diseases (affecting <200,000 people in the US). Provides tax credits, fee waivers, and 7-year market exclusivity. |
| **Accelerated Approval** | An FDA pathway allowing approval based on a surrogate endpoint reasonably likely to predict clinical benefit, with post-marketing confirmatory studies required. |
| **Designation Strategy** | The regulatory strategy identifying which expedited programs (Breakthrough, Fast Track, Orphan, Accelerated) a drug may qualify for. |
| **FDA IIG** | FDA Inactive Ingredient Guide. A database of approved inactive ingredients (excipients) in marketed drug products. |
| **OECD** | Organisation for Economic Co-operation and Development. Publishes standardized test guidelines for chemical safety assessment. |

---

## 16. Clinical & Statistical Terms

| Term | Definition |
|------|-----------|
| **Randomization** | The process of randomly assigning trial participants to treatment or control groups to minimize bias. |
| **Stratification** | Dividing patients into subgroups (strata) based on characteristics (age, disease severity) to ensure balanced randomization. |
| **Inclusion / Exclusion Criteria** | The specific patient characteristics that determine eligibility for trial enrollment. |
| **Informed Consent** | The process of ensuring patients understand the trial's risks, benefits, and procedures before participating. |
| **Intent-to-Treat (ITT)** | An analysis including all randomized patients regardless of protocol adherence. Considered the primary analysis in most trials. |
| **Per-Protocol** | An analysis including only patients who completed the trial as specified in the protocol. |
| **Standard Error (SE)** | A measure of the uncertainty in an estimated statistic. Used in power calculations. |
| **Effect Size** | The magnitude of the treatment difference. Larger effect sizes require fewer patients to detect. |
| **Normal CDF** | The cumulative distribution function of the normal distribution. Used in power and p-value calculations. |
| **Type I Error** | A false positive — concluding the treatment works when it does not (controlled by alpha). |
| **Type II Error** | A false negative — failing to detect a real treatment effect (controlled by power = 1 - beta). |

---

## 17. Therapeutic Areas

| Term | Definition |
|------|-----------|
| **Oncology** | The study and treatment of cancer. Associated with higher trial costs (1.45x multiplier), specialized endpoints (PFS, OS), and unique safety considerations. |
| **CNS (Central Nervous System)** | Disorders of the brain and spinal cord (Alzheimer's, Parkinson's, epilepsy). Associated with the highest trial cost multiplier (1.60x) due to long durations and complex endpoints. |
| **Cardiovascular** | Heart and blood vessel disorders. Includes safety considerations around hERG and QT prolongation. |
| **Metabolic** | Disorders of metabolism (diabetes, obesity, lipid disorders). |
| **Rare Disease** | Conditions affecting small patient populations (<200,000 in US). Eligible for Orphan Drug designation. Trial cost multiplier: 1.55x. |
| **Infectious Disease** | Bacterial, viral, fungal, and parasitic diseases. Includes antimicrobial resistance considerations. |
| **Immunology** | Disorders of the immune system (autoimmune diseases, inflammatory conditions). |

---

## 18. Diagen AI Ecosystem Integration

| Term | Definition |
|------|-----------|
| **Diagen AI** | An external molecule generation platform within the Hakase Ecosystem. Generates novel compound structures that can be imported directly into HakaseAI for simulation. |
| **Hakase Ecosystem** | The broader platform ecosystem connecting HakaseAI with complementary tools like Diagen AI. |
| **Import from Diagen AI** | The action of pulling a Diagen-generated compound (SMILES, name, target) into HakaseAI. |
| **Generate → Simulate Pipeline** | The workflow of generating molecules in Diagen AI and immediately simulating them in HakaseAI. |
| **Synchronous Mode** | A Diagen integration mode where a single molecule is imported and simulated in under 30 seconds. |
| **Async Batch Mode** | A Diagen integration mode using webhooks for batch processing, completing in approximately 2 minutes. |
| **Cascade Mode** | A Diagen integration mode that automatically runs Layer 1 → Layer 2 → Layer 3 simulations sequentially after import. |
| **Import All Fields** | Imports the compound SMILES, molecule name, UniProt target, and PDB structure from Diagen AI in a single action. |

---

## 19. UI Components & Navigation

| Term | Definition |
|------|-----------|
| **Layer Navigation Tabs** | The primary navigation showing the four simulation layers with color-coded status indicators. |
| **Simulation Status** | The current state of each layer's simulation: **Idle** (not yet run), **Running** (in progress), **Complete** (finished). |
| **Progress Bar** | A visual indicator showing simulation completion percentage (0–100%). |
| **Molecule Lab** | The input section where compound SMILES, molecule name, target protein, and PDB structure are configured. |
| **3D Viewer** | The interactive molecular structure viewer rendered in the browser. |
| **External DB Panel** | The collapsible section displaying results from all queried external databases (BindingDB, ChEMBL, STRING, etc.). |
| **Safety Dossier** | A downloadable compilation of all safety findings, flags, and governance decisions across all layers. |
| **Regulatory Insight Card** | A Layer 4 component showing designation eligibility (Breakthrough, Fast Track, Orphan, Accelerated Approval) and IND-enabling requirements. |
| **Tag** | A color-coded label displaying a metric value (e.g., green for potent, amber for moderate, gray for weak). |
| **SectionHead** | A panel header component combining an icon, label, and color theme for each data section. |

---

## 20. Off-Target Panels by Therapeutic Area

Each therapeutic area defines a unique panel of 15 off-target proteins tested during Layer 1 simulation. These represent the most clinically relevant selectivity concerns for each field.

### Oncology Off-Targets

| Target | Full Name |
|--------|-----------|
| **PIM1** | Proto-oncogene serine/threonine-protein kinase Pim-1 |
| **FLT3** | Fms-like tyrosine kinase 3 (mutated in AML) |
| **JAK2** | Janus kinase 2 (myeloproliferative driver) |
| **ALK** | Anaplastic lymphoma kinase |
| **ROS1** | Proto-oncogene tyrosine-protein kinase ROS |
| **MET** | Hepatocyte growth factor receptor |
| **FGFR1** | Fibroblast growth factor receptor 1 |
| **VEGFR2** | Vascular endothelial growth factor receptor 2 |
| **PDGFRα** | Platelet-derived growth factor receptor alpha |
| **AXL** | AXL receptor tyrosine kinase |
| **KIT** | Mast/stem cell growth factor receptor (c-Kit) |
| **RET** | RET proto-oncogene (thyroid/lung cancer) |
| **NTRK1** | Neurotrophic receptor tyrosine kinase 1 |
| **BRAF** | B-Raf proto-oncogene serine/threonine-protein kinase |
| **MEK1** | Dual specificity mitogen-activated protein kinase kinase 1 |

### CNS Off-Targets

| Target | Full Name |
|--------|-----------|
| **5-HT2A** | Serotonin receptor 2A |
| **D2R** | Dopamine receptor D2 |
| **NMDAR** | N-methyl-D-aspartate receptor (glutamate) |
| **GABA-A** | Gamma-aminobutyric acid receptor type A |
| **MAO-B** | Monoamine oxidase B |
| **AChE** | Acetylcholinesterase |
| **SERT** | Serotonin transporter |
| **NET** | Norepinephrine transporter |
| **DAT** | Dopamine transporter |
| **mGluR5** | Metabotropic glutamate receptor 5 |
| **PDE4** | Phosphodiesterase 4 |
| **GSK3β** | Glycogen synthase kinase 3 beta |
| **DYRK1A** | Dual-specificity tyrosine-phosphorylation-regulated kinase 1A |
| **CDK5** | Cyclin-dependent kinase 5 |
| **LRRK2** | Leucine-rich repeat kinase 2 (Parkinson's gene) |

### Cardiovascular Off-Targets

| Target | Full Name |
|--------|-----------|
| **hERG** | Human Ether-à-go-go-Related Gene (cardiac potassium channel) |
| **Nav1.5** | Voltage-gated sodium channel (cardiac) |
| **Cav1.2** | L-type calcium channel (cardiac) |
| **KCNQ1** | Potassium voltage-gated channel subfamily Q member 1 |
| **Kir2.1** | Inward rectifier potassium channel |
| **ACE** | Angiotensin-converting enzyme |
| **AT1R** | Angiotensin II receptor type 1 |
| **PDE3** | Phosphodiesterase 3 (cardiac contractility) |
| **PDE5** | Phosphodiesterase 5 (vascular smooth muscle) |
| **ROCK1** | Rho-associated coiled-coil containing protein kinase 1 |
| **PKCα** | Protein kinase C alpha |
| **eNOS** | Endothelial nitric oxide synthase |
| **SGLT2** | Sodium-glucose co-transporter 2 |
| **PCSK9** | Proprotein convertase subtilisin/kexin type 9 |
| **Endothelin-A** | Endothelin receptor type A |

### Metabolic Off-Targets

| Target | Full Name |
|--------|-----------|
| **PPAR-γ** | Peroxisome proliferator-activated receptor gamma |
| **GLP-1R** | Glucagon-like peptide-1 receptor |
| **DPP-4** | Dipeptidyl peptidase-4 |
| **SGLT2** | Sodium-glucose co-transporter 2 |
| **AMPK** | AMP-activated protein kinase |
| **FXR** | Farnesoid X receptor |
| **LXR** | Liver X receptor |
| **ACC1** | Acetyl-CoA carboxylase 1 |
| **FASN** | Fatty acid synthase |
| **SCD1** | Stearoyl-CoA desaturase 1 |
| **DGAT2** | Diacylglycerol O-acyltransferase 2 |
| **HMGCR** | HMG-CoA reductase (statin target) |
| **CETP** | Cholesteryl ester transfer protein |
| **GPR40** | Free fatty acid receptor 1 |
| **GPR119** | G protein-coupled receptor 119 |

### Rare Disease Off-Targets

| Target | Full Name |
|--------|-----------|
| **SMN2** | Survival motor neuron 2 (spinal muscular atrophy) |
| **CFTR** | Cystic fibrosis transmembrane conductance regulator |
| **GCase** | Glucocerebrosidase (Gaucher disease) |
| **ASM** | Acid sphingomyelinase (Niemann-Pick) |
| **GAA** | Acid alpha-glucosidase (Pompe disease) |
| **IDUA** | Alpha-L-iduronidase (Hurler syndrome) |
| **GLA** | Alpha-galactosidase A (Fabry disease) |
| **CLN3** | Ceroid-lipofuscinosis neuronal protein 3 (Batten disease) |
| **ATP7B** | Copper-transporting ATPase 2 (Wilson disease) |
| **HPRT** | Hypoxanthine-guanine phosphoribosyltransferase (Lesch-Nyhan) |
| **PIM1** | Proto-oncogene serine/threonine-protein kinase Pim-1 |
| **JAK2** | Janus kinase 2 |
| **DYRK1A** | Dual-specificity tyrosine-phosphorylation-regulated kinase 1A |
| **GSK3β** | Glycogen synthase kinase 3 beta |
| **CLK1** | CDC-like kinase 1 |

### Infectious Disease Off-Targets

| Target | Full Name |
|--------|-----------|
| **HIV-PR** | HIV protease |
| **HIV-RT** | HIV reverse transcriptase |
| **HIV-IN** | HIV integrase |
| **HCV-NS5B** | Hepatitis C virus NS5B RNA-dependent RNA polymerase |
| **3CLpro** | 3C-like protease (SARS-CoV-2 main protease) |
| **RdRp** | RNA-dependent RNA polymerase |
| **Neuraminidase** | Influenza neuraminidase |
| **InhA** | Enoyl-ACP reductase (tuberculosis) |
| **GyrA** | DNA gyrase subunit A (antibacterial target) |
| **PBP2a** | Penicillin-binding protein 2a (MRSA) |
| **DHFR** | Dihydrofolate reductase (antifolate target) |
| **Topo-IV** | Topoisomerase IV (antibacterial target) |
| **β-Lactamase** | Beta-lactamase (antibiotic resistance enzyme) |
| **EF-Tu** | Elongation factor Tu (bacterial translation) |
| **MurA** | UDP-N-acetylglucosamine enolpyruvyl transferase (cell wall synthesis) |

### Immunology Off-Targets

| Target | Full Name |
|--------|-----------|
| **JAK1** | Janus kinase 1 |
| **JAK2** | Janus kinase 2 |
| **JAK3** | Janus kinase 3 |
| **TYK2** | Tyrosine kinase 2 |
| **BTK** | Bruton's tyrosine kinase |
| **SYK** | Spleen tyrosine kinase |
| **ITK** | IL-2-inducible T-cell kinase |
| **PI3Kδ** | Phosphoinositide 3-kinase delta |
| **IRAK4** | Interleukin-1 receptor-associated kinase 4 |
| **RORγt** | Retinoic acid receptor-related orphan receptor gamma t |
| **IL-6R** | Interleukin-6 receptor |
| **TNFα** | Tumor necrosis factor alpha |
| **IL-17A** | Interleukin-17A |
| **S1PR1** | Sphingosine-1-phosphate receptor 1 |
| **PDE4** | Phosphodiesterase 4 |

---

## 21. Cell Lines by Therapeutic Area

Each therapeutic area uses a curated set of 5 cell lines for in vitro assay simulation.

| Therapeutic Area | Cell Lines | Description |
|------------------|-----------|-------------|
| **Oncology** | A549 (lung adenocarcinoma), MCF-7 (breast cancer), HCT116 (colorectal cancer), MDA-MB-231 (triple-negative breast cancer), HepG2 (hepatocellular carcinoma) | Tumor-derived lines covering major solid tumor types |
| **CNS** | SH-SY5Y (neuroblastoma), U-87 MG (glioblastoma), HEK293 (embryonic kidney / transfection host), IMR-32 (neuroblastoma), Neuro-2a (mouse neuroblastoma) | Neuronal and glial lines for CNS penetration and neurotoxicity |
| **Cardiovascular** | HEK293 (transfection host), CHO-hERG (hERG-expressing CHO cells), HL-1 (atrial cardiomyocyte), H9c2 (rat cardiac myoblast), iPSC-CM (induced pluripotent stem cell-derived cardiomyocyte) | Cardiac and ion channel lines for cardiotoxicity |
| **Metabolic** | HepG2 (hepatocellular), 3T3-L1 (pre-adipocyte), INS-1 (rat insulinoma), MIN6 (mouse insulinoma), Caco-2 (intestinal epithelial) | Hepatic, adipose, and pancreatic lines for metabolic endpoints |
| **Rare Disease** | HEK293, HepG2, iPSC-derived (patient-specific), Fibroblasts (primary), SH-SY5Y | Patient-relevant lines including iPSC-derived disease models |
| **Infectious Disease** | Vero (African green monkey kidney), A549 (lung), Calu-3 (human airway), MT-4 (T-lymphoblastoid / HIV), HEK293 | Virus-permissive and immune-relevant lines |
| **Immunology** | Jurkat (T-cell leukemia), THP-1 (monocyte), U937 (histiocytic lymphoma), PBMC (peripheral blood mononuclear cells), HEK293 | Immune cell lines for cytokine and inflammatory assays |

---

## 22. Predefined Target Proteins (ADMET Target Map)

The ADMET engine includes a curated map of well-characterized drug targets with their protein classes, known off-target liabilities, and expected potency ranges.

| UniProt ID | Protein | Class | Known Off-Targets | Potency Range (nM) |
|-----------|---------|-------|-------------------|-------------------|
| **P00533** | EGFR | Tyrosine Kinase | HER2, HER3 | 1–200 |
| **P04626** | HER2 | Tyrosine Kinase | EGFR, HER3 | 5–500 |
| **P01116** | KRAS | GTPase | NRAS, HRAS | 50–5,000 |
| **P11802** | CDK4 | Ser/Thr Kinase | CDK6, CDK2 | 1–100 |
| **Q00534** | CDK6 | Ser/Thr Kinase | CDK4, CDK2 | 2–200 |
| **Q06187** | BTK | Tyrosine Kinase | ITK, TEC | 1–150 |
| **P00519** | ABL1 | Tyrosine Kinase | SRC, KIT | 1–100 |
| **P15056** | BRAF | Ser/Thr Kinase | CRAF, MAP2K1 | 1–300 |

---

## 23. Demo Molecules

Pre-loaded example compounds available in the platform for demonstration and testing.

| Molecule | Target | UniProt ID | PDB ID | Description |
|----------|--------|-----------|--------|-------------|
| **Ibuprofen** | EGFR | P00533 | 4HJO | Default starting compound |
| **EGFR Compound** | EGFR | P00533 | 4HJO | Epidermal growth factor receptor inhibitor |
| **KRAS Compound** | KRAS | P01116 | 6GOF | GTPase KRAS oncogene inhibitor |
| **CDK4 Compound** | CDK4 | P11802 | 2W96 | Cyclin-dependent kinase 4 inhibitor |

---

## 24. Reference Drug Comparators by Therapeutic Area

The ADMET engine includes marketed drugs as comparators for benchmarking simulated compounds.

| Therapeutic Area | Reference Drugs |
|------------------|----------------|
| **CNS** | Donepezil, Lecanemab, Levodopa |
| **Cardiovascular** | Atorvastatin, Entresto (sacubitril/valsartan), Empagliflozin |
| **Metabolic** | Semaglutide, Tirzepatide, Metformin |
| **Rare Disease** | Nusinersen, Lumacaftor, Migalastat |
| **Infectious Disease** | Nirmatrelvir (Paxlovid), Remdesivir, Dolutegravir |
| **Immunology** | Tofacitinib, Upadacitinib, Dupilumab |

---

## 25. Species Parameters (Animal Simulation Library)

Detailed physiological parameters used by the PBPK engine for each species.

| Species | Body Weight (kg) | Km Factor | GFR (mL/min/kg) | Hepatic Blood Flow (mL/min/kg) | CL Scale Factor |
|---------|-----------------|-----------|------------------|-------------------------------|----------------|
| Mouse (CD-1) | 0.025 | 3 | 5.2 | 90 | 0.28 |
| Mouse (C57BL/6) | 0.022 | 3 | 5.0 | 85 | 0.27 |
| Rat (Sprague Dawley) | 0.300 | 6 | 5.5 | 70 | 0.40 |
| Rat (Wistar) | 0.280 | 6 | 5.3 | 68 | 0.39 |
| Dog (Beagle) | 10.0 | 20 | 3.2 | 31 | 0.62 |
| Cynomolgus Monkey | 4.0 | 12 | 2.8 | 44 | 0.75 |
| **Human (Reference)** | **70.0** | **37** | **1.8** | **20.7** | **1.00** |

---

## 26. Study Designs (Animal Cohort)

| Study Type | Duration | Rodent N (per group) | Non-Rodent N (per group) | Recovery Group | Satellite TK |
|-----------|----------|---------------------|------------------------|---------------|-------------|
| Single Dose (Acute) | 0.3 weeks | 5 | 3 | No | No |
| Sub-Acute (14-Day) | 2 weeks | 10 | 3 | No | Yes |
| Sub-Chronic (28-Day GLP) | 4 weeks | 10 | 4 | Yes | Yes |
| Chronic (90-Day GLP) | 13 weeks | 15 | 4 | Yes | Yes |

---

## 27. Formulation Options

| Formulation | Description | Use Case |
|-------------|-------------|----------|
| **Plain Tablet / Capsule** | Simple oral solid dosage form | Well-soluble compounds (BCS Class I) |
| **Lipid-Based LBDDS / SMEDDS** | Self-emulsifying drug delivery system | Poorly soluble, lipophilic compounds (BCS Class II) |
| **Amorphous Solid Dispersion (ASD)** | Drug dispersed in polymer matrix | Compounds with poor crystalline solubility |
| **Nanosuspension / Nanoparticle** | Drug milled to nanoparticle size | Enhancing dissolution rate of poorly soluble drugs |
| **Cyclodextrin Inclusion Complex** | Drug encapsulated in cyclodextrin cage | Improving aqueous solubility and stability |
| **Enteric-Coated / pH-Modified** | pH-dependent release coating | Protecting acid-labile drugs or targeting intestinal release |

---

## 28. Dosing Frequencies & Escalation Schemes

### Dosing Frequencies

| Abbreviation | Meaning | Schedule |
|-------------|---------|----------|
| **QD** | Quaque die | Once daily |
| **BID** | Bis in die | Twice daily |
| **TID** | Ter in die | Three times daily |
| **QW** | Quaque week | Once weekly |
| **Q2W** | Every 2 weeks | Biweekly |
| **Q4W** | Every 4 weeks | Monthly |
| **Single Dose** | One-time administration | Phase I / acute studies |

### Dose Escalation Schemes

| Scheme | Description |
|--------|-------------|
| **Linear** | Fixed dose increments (e.g., 25, 50, 75, 100 mg) |
| **Modified Fibonacci** | Decreasing percentage increments (100%, 67%, 50%, 33%) |
| **Bayesian Optimal Interval (BOIN)** | Statistical model-based escalation using target toxicity intervals |
| **3+3 Design** | Classic rule-based design: 3 patients per cohort, expand if 1/3 has DLT |

---

## 29. Comorbidities (ICD-10 Codes)

The patient cohort simulation includes 40+ selectable comorbid conditions. Key entries:

| ICD-10 Code | Condition |
|-------------|-----------|
| **I10** | Essential (primary) hypertension |
| **E11** | Type 2 diabetes mellitus |
| **N18.3** | Chronic kidney disease, stage 3 |
| **N18.4** | Chronic kidney disease, stage 4 |
| **N18.5** | Chronic kidney disease, stage 5 |
| **I50.9** | Heart failure, unspecified |
| **J44.1** | COPD with acute exacerbation |
| **E78.0** | Pure hypercholesterolemia |
| **I25.1** | Atherosclerotic heart disease |
| **E66.0** | Obesity due to excess calories |
| **K76.0** | Fatty liver disease (non-alcoholic) |
| **G30** | Alzheimer's disease |
| **F32** | Major depressive disorder |
| **M06.9** | Rheumatoid arthritis |
| **K21.0** | Gastroesophageal reflux disease |

---

## 30. Clinical Trial Sites

Pre-configured clinical trial sites used in Layer 4 simulation, each with quality and composite scores.

| Site Name | Location | Region | Quality Score | Composite Score |
|-----------|----------|--------|--------------|----------------|
| **Johns Hopkins** | Baltimore, MD | North America | 9.2 | 91 |
| **Royal Marsden** | London, UK | Europe | 9.4 | 88 |
| **MD Anderson** | Houston, TX | North America | 8.9 | 86 |
| **Memorial Sloan Kettering** | New York, NY | North America | 9.1 | 84 |
| **Tokyo Medical University** | Tokyo, Japan | Asia-Pacific | 8.7 | 79 |

---

## 31. PROCOVA Variance Reduction Lookup Table

Published or estimated R² values for prognostic covariate adjustment by indication.

| Indication | Endpoint Type | R² Range | Default R² |
|-----------|--------------|----------|-----------|
| **Alzheimer's Disease** | Continuous | 0.15–0.20 | 0.17 |
| **Multiple Sclerosis** | Continuous | 0.12–0.18 | 0.15 |
| **ALS** | Continuous | 0.14–0.19 | 0.16 |
| **Parkinson's Disease** | Continuous | 0.10–0.16 | 0.13 |
| **Oncology** | Time-to-Event | 0.05–0.10 | 0.07 |
| **Rare Disease** | Continuous | 0.08–0.15 | 0.11 |
| **General (Binary)** | Binary | — | 0.08 |
| **General (Continuous)** | Continuous | — | 0.14 |
| **General (Time-to-Event)** | Time-to-Event | — | 0.07 |

---

## 32. Trial Cost Model Parameters

### Per-Patient Base Costs

| Phase | Cost per Patient |
|-------|-----------------|
| Phase I | $28,000 |
| Phase II | $58,000 |
| Phase III | $105,000 |

### Indication Cost Multipliers

| Therapeutic Area | Multiplier |
|------------------|-----------|
| CNS | 1.60x |
| Rare Disease | 1.55x |
| Oncology | 1.45x |
| Cardiovascular | 1.30x |
| Metabolic | 1.00x |
| Immunology | 1.00x |
| Infectious Disease | 0.90x |

### Fixed Costs by Phase

| Cost Category | Phase I | Phase II | Phase III |
|---------------|---------|----------|-----------|
| Site Startup | $90K/site | $90K/site | $90K/site |
| Site Management | $320K/site | $900K/site | $1.8M/site |
| Regulatory | $1.1M | $2.2M | $5.5M |
| Manufacturing | $1.1M/arm | $2.8M/arm | $7.0M/arm |
| **Adaptive Design Premium** | — | — | $1.4M |
| **Overhead Multiplier (CRO)** | 1.33x | 1.33x | 1.33x |

---

## 33. Adverse Event Types (Cohort Simulation)

Default adverse event profiles used in Layer 3 patient cohort simulation.

| Adverse Event | Base Incidence | Modifiers |
|--------------|---------------|-----------|
| **Fatigue** | 42% | — |
| **Nausea** | 35% | — |
| **Diarrhoea** | 28% | — |
| **ALT Elevation** | Variable | Scaled by Liver organ risk score |
| **Rash** | 22% | — |
| **QTc Prolongation** | Variable | Scaled by Heart organ risk score |

---

## 34. Assay Thresholds & Classification Criteria

### CYP Inhibition Risk

| Risk Level | IC50 Threshold |
|-----------|---------------|
| Low | > 20 µM |
| Moderate | > 5 µM |
| High | ≤ 5 µM |

### Intestinal Permeability (Caco-2 Papp)

| Classification | Papp (×10⁻⁶ cm/s) |
|---------------|-------------------|
| High | > 20 |
| Moderate | > 5 |
| Low | ≤ 5 |

### Metabolic Stability (CLint)

| Classification | CLint (µL/min/mg) |
|---------------|-------------------|
| Stable | < 15 |
| Moderate | < 50 |
| Unstable | ≥ 50 |

### Plasma Protein Binding

| Classification | Free Fraction (fu%) |
|---------------|-------------------|
| Weakly Bound | > 20% |
| Moderately Bound | > 5% |
| Highly Bound | ≤ 5% |

### Organ Risk Color Coding

| Risk Level | Threshold | Display Color |
|-----------|-----------|--------------|
| Low | ≤ 0.15 | Emerald (green) |
| Moderate | ≤ 0.30 | Yellow (amber) |
| High | > 0.30 | Red |

---

## 35. AOP (Adverse Outcome Pathway) Reference Numbers

Bioactivation engine pathways mapped to internationally recognized AOP identifiers.

| AOP ID | Pathway | Structural Alert |
|--------|---------|-----------------|
| **AOP-18** | Aniline/Aromatic Amine → CYP1A2 N-oxidation → Methemoglobinemia | Aniline |
| **AOP-220** | Quinone/Hydroquinone → Keap1/Nrf2 disruption → Oxidative stress | Quinone |
| **AOP-34** | Thiophene S-oxidation → Reactive sulfoxide → Hepatotoxicity | Thiophene |
| **AOP-150** | Acyl Glucuronide reactivity → Protein adducts → Idiosyncratic DILI | Acyl Glucuronide |
| **AOP-107** | Arene Oxide (Epoxide) formation → DNA adducts → Genotoxicity | Arene Oxide |
| **AOP-96** | Phenol oxidation → Quinone-Imine (NAPQI-type) → Hepatonecrosis | Michael Acceptor |

---

## 36. Geographic Regions (Trial Simulation)

| Region | Description |
|--------|-------------|
| **North America** | US, Canada — FDA regulatory framework |
| **European Union** | EU member states — EMA regulatory framework |
| **Japan** | PMDA regulatory framework |
| **China** | NMPA regulatory framework |
| **Rest of World** | All other regions |

---

## 37. Matching Variables (Adaptive / Stratified Randomization)

Variables used to balance patient characteristics across treatment arms.

| Variable | Description |
|----------|-------------|
| **Age** | Patient age at enrollment |
| **Sex** | Biological sex (male/female) |
| **Baseline Severity** | Disease severity score at screening |
| **Biomarker Status** | Positive/negative for a pre-specified biomarker |
| **BMI** | Body mass index |
| **Comorbidities** | Presence of specific co-morbid conditions |

---

## 38. 3D Viewer Modes

| Mode | Description |
|------|-------------|
| **Scientific** | Structural analysis view showing binding pockets, secondary structures, and electron density |
| **Explorer** | Gallery-style view for comparing multiple ligands or viewing different protein conformations |
| **Cinematic** | High-impact, presentation-quality visualization with dramatic lighting and depth of field |

---

## 39. Simulation Options (Layer 1 Toggles)

| Option | Description |
|--------|-------------|
| **ADMET Profiling / Directional** | Directional ADMET assessment that supports and contextualizes in vitro results (not standalone) |
| **Target Binding (Simulation)** | Simulated molecular docking and binding affinity prediction |
| **Toxicity Screening (Deep Learning)** | Computational toxicity prediction using structural alerts and learned patterns |
| **Molecular Fingerprint (ECFP4)** | Generation of extended connectivity fingerprints for similarity analysis |
| **Behavioral Fingerprinting** | Enhanced tissue-specific surveillance with 1.25x organ risk amplification |

---

## 40. Trial Blinding Options

| Blinding Level | Description |
|----------------|-------------|
| **Open-Label** | All parties know the treatment assignment |
| **Single-Blind** | Patients do not know their assignment; investigators do |
| **Double-Blind** | Neither patients nor investigators know the assignment |
| **Triple-Blind** | Patients, investigators, and data analysts are all blinded |

---

## 41. Statistical Boundary Methods

| Method | Description |
|--------|-------------|
| **O'Brien-Fleming** | Conservative spending function — uses very little alpha at early looks, preserving most for the final analysis. Standard for pivotal trials. |
| **Pocock** | Equal alpha spending at each look — more likely to stop early but less power at the final analysis. |

---

## 42. Routes of Administration

| Route | Abbreviation | Description |
|-------|-------------|-------------|
| **Oral** | PO | Administered by mouth (most common) |
| **Intravenous Bolus** | IV | Direct injection into the bloodstream |
| **Intravenous Infusion** | IV inf | Continuous drip into the bloodstream |
| **Subcutaneous** | SC | Injection under the skin |
| **Intramuscular** | IM | Injection into muscle tissue |
| **Intraperitoneal** | IP | Injection into the abdominal cavity (primarily preclinical) |
| **Transdermal** | TD | Absorption through the skin (patches) |

---

## 43. Ranking Criteria (Batch Mode)

When comparing multiple compounds, the platform supports ranking by:

| Criterion | Description |
|-----------|-------------|
| **QED Score** | Overall drug-likeness (higher = more drug-like) |
| **Toxicity Risk** | Composite safety score (lower = safer) |
| **Binding Affinity** | Predicted target binding strength (lower Kd/IC50 = stronger) |
| **Composite (Weighted)** | User-configurable weighted combination of all criteria |

---

## 44. Data Import Sources

| Source | Type | Identifier |
|--------|------|-----------|
| **ClinicalTrials.gov** | Clinical trial registry | NCT ID (e.g., NCT04012345) |
| **PubMed** | Literature database | PMID |
| **EHR / Epic** | Electronic health records | Patient ID |
| **LIMS** | Laboratory information management system | Sample ID |
| **PubChem** | Chemical compound database | CID |
| **ChEMBL** | Bioactivity database | CHEMBL ID |
| **DrugBank** | Drug database | DB ID |
| **ZINC** | Commercial compound database | ZINC ID |

---

*Generated from the HakaseAI BioDigital Twin Platform codebase. All terms reflect the platform as implemented in v1.0.*
