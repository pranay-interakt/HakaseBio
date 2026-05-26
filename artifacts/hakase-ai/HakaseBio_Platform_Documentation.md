# HakaseAI — BioDigital Twin Platform Documentation

## Platform Overview

HakaseAI is a BioDigital Twin platform that simulates the entire drug development pipeline in four sequential layers. Each layer represents a stage of pharmaceutical development, from early-stage in vitro screening through clinical trial design. The platform uses browser-side simulation engines, 12 live database integrations, and Claude-powered AI analysis to generate actionable predictions at each stage.

The four layers flow sequentially — results from each layer cascade forward to inform the next:

| Layer | Name | Color | Stage |
|-------|------|-------|-------|
| 1 | In Vitro Digital Twin | Violet | Early discovery — compound screening & characterization |
| 2 | Animal Cohort Digital Twin | Amber | Preclinical — species PK/tox & human dose projection |
| 3 | Patient Cohort Digital Twin | Blue | Clinical pharmacology — virtual patient populations |
| 4 | Trial Digital Twin | Emerald | Clinical trial — Monte Carlo trial simulation & design |

---

## Layer 1 — In Vitro Digital Twin

### Purpose
Layer 1 takes a molecular structure (SMILES notation) and runs a comprehensive in vitro assay simulation to assess whether the compound has the right properties to advance to animal studies. It answers: *"Is this molecule worth testing in a living system?"*

### Inputs

#### Primary Molecular Input
- **SMILES String**: The molecular structure in SMILES notation (MW 100–1,500 Da). Validated in real-time by RDKit.js, which computes molecular weight, LogP, TPSA, hydrogen bond donors (HBD), and hydrogen bond acceptors (HBA) on the fly.
- **Molecule Name**: User-defined or auto-generated compound identifier.
- **SDF / MOL2 Upload**: Upload molecular structure files directly (.sdf, .mol2, .mol — up to 10 MB).
- **Batch CSV Upload**: Upload a CSV with a `smiles` column for batch screening of up to 500 compounds.

#### Target Protein Configuration
- **UniProt ID**: UniProt accession (e.g., P00533 for EGFR). Fetches gene name, organism, function, binding sites, and known crystal structures via the UniProt API.
- **PDB Structure ID**: 4-letter PDB accession for molecular docking. Auto-populates from UniProt crystal structure lists.
- **Target Suggestion Engine**: AI-assisted target recommendation based on the molecular structure and therapeutic area.

#### Therapeutic Configuration
- **Therapeutic Area Preset**: Oncology, CNS, Cardiovascular, Metabolic, Rare Disease, Infectious Disease, or Immunology. Adjusts simulation parameters and database queries accordingly.

#### Import Options
- **Import from Diagen AI**: Integration with the Diagen Ecosystem for AI-generated molecules. Supports Synchronous (single molecule, <30s), Async Batch (webhook-based, ~2 min), and Cascade (automatic L1→L2→L3 propagation) modes.
- **Import via API**: Pull molecular data from ChEMBL, PubChem, UniChem, or ZINC databases.

### Simulation Toggles
- **ADMET Prediction**: Always on. Runs the 5-axis ADMET scoring engine.
- **Binding Simulation**: ESM-2 + docking pipeline. Requires a UniProt ID to be specified.
- **Toxicity Signal Detection**: Cross-references FAERS (FDA Adverse Event Reporting System) for known safety signals.
- **Behavioral Fingerprinting**: Multi-tissue simulation across Liver, Kidney, CNS, Cardiac, GI, and Lung tissues. Adds ~10 seconds.

### Batch Configuration
- **Top-N Filter**: Limits how many top results to display in batch mode.
- **Ranking Criteria**: Sort batch results by QED Score, Toxicity Risk, Binding Affinity, or Weighted Composite.
- **Composite Weights**: Adjustable sliders for QED, Toxicity, Binding, and Synthetic Accessibility (SA) when using composite ranking.
- **Confidence Threshold**: Slider (50%–95%). Results below this threshold trigger an amber warning banner.

### Results Panel

#### Go/No-Go Summary Card
The top of the results panel shows a decision card:
- **Verdict**: GO (green), WATCH (amber), or NO-GO (red) based on overall in vitro risk.
- **In Vitro Score**: Composite score (0–100%) derived from all assay results.
- **Confidence Score**: Statistical confidence of the simulation.
- **Key Metrics Strip**: IC50, Caco-2 permeability class, CLint, fu%, hERG IC50, and Therapeutic Index at a glance.

#### Tab 1: Dose-Response
Simulates the compound's potency against the target.
- **Dose-Response Curve**: SVG chart plotting % inhibition vs. concentration (nM, log scale) with the IC50 marked.
- **IC50**: Half-maximal inhibitory concentration in nM. Classified as High (<50 nM), Moderate (50–500 nM), or Low (>500 nM) potency.
- **EC50**: Half-maximal effective concentration.
- **Hill Coefficient**: Steepness of the dose-response curve (cooperativity). Values between 0.7 and 3.0.
- **Max Inhibition**: Maximum achievable inhibition at saturating concentrations.
- **Cell Viability Panel**: CC50 (cytotoxicity concentration), Therapeutic Index (CC50/IC50 ratio — higher is safer), and Viability at 10 µM in the tested cell line (HepG2, HEK293, A549, MCF-7, or HeLa).

#### Tab 2: Permeability
Assesses whether the compound can cross biological membranes to reach its target.
- **Caco-2 Papp**: Apparent permeability coefficient (×10⁻⁶ cm/s) using the Caco-2 cell monolayer model. Classified as High (>20), Moderate (5–20), or Low (<5).
- **PAMPA Pe**: Parallel Artificial Membrane Permeability Assay result. Classified as High (>10), Moderate (2–10), or Low (<2).
- **Efflux Ratio**: Ratio of basolateral-to-apical vs. apical-to-basolateral transport. Values >2.5 suggest P-glycoprotein (P-gp) efflux is limiting absorption.
- **P-gp Substrate**: Yes/No flag indicating whether the compound is a P-gp substrate.
- **Plasma Protein Binding**: Visual bar showing bound vs. free fraction (fu%). Classified as Highly Bound (<5% free), Moderately Bound (5–20%), or Weakly Bound (>20%). The free fraction determines how much drug is pharmacologically active.

#### Tab 3: Clearance
Evaluates how quickly the body would metabolize the compound.
- **Microsomal CLint**: Intrinsic clearance measured in human liver microsomes (µL/min/mg). Classified as Stable (<15), Moderate (15–50), or Unstable (>50).
- **Hepatocyte CLint**: Intrinsic clearance measured in primary human hepatocytes (µL/min/10⁶ cells). Provides a more physiologically relevant clearance estimate.
- **Half-Life (t½)**: Predicted microsomal half-life in minutes. Longer half-lives suggest more stable compounds.
- **CYP Inhibition Panel**: IC50 values for five major cytochrome P450 enzymes:
  - **CYP1A2**: Metabolizes caffeine, theophylline. Inhibition risk: drug-drug interactions (DDI) with these substrates.
  - **CYP2C9**: Metabolizes warfarin, phenytoin. High inhibition risk can cause bleeding events.
  - **CYP2C19**: Metabolizes clopidogrel, omeprazole. Relevant for cardiovascular DDI.
  - **CYP2D6**: Metabolizes codeine, tamoxifen, many antidepressants. Non-inducible — inhibition is permanent.
  - **CYP3A4**: Metabolizes ~50% of all drugs. The most critical DDI enzyme.
  - Each enzyme shows IC50 (µM), a visual bar, and a risk classification (Low >20 µM, Moderate 5–20 µM, High <5 µM).

#### Tab 4: Safety
Evaluates cardiac and off-target safety risks.
- **hERG Channel Inhibition**:
  - **IC50 (µM)**: Concentration causing 50% inhibition of the hERG potassium channel. Low values indicate cardiac risk.
  - **Risk Category**: Low (>10 µM), Moderate (1–10 µM), or High (<1 µM).
  - **Patch-Clamp Result**: Predicted electrophysiology finding (e.g., "No significant block at 30 µM").
  - **Safety Margin**: Ratio of hERG IC50 to therapeutic IC50. Values >30× are generally acceptable.
- **Selectivity Profile**:
  - **Kinase Selectivity Score**: Percentage of targets with no significant off-target activity.
  - **Off-Target Hits**: Number of kinases showing activity out of the total panel tested.
  - **Selectivity Classification**: Selective (>80%), Moderately Selective (50–80%), or Non-Selective (<50%).
  - **Top Off-Target Hits Table**: Lists the most potent off-target kinases with their IC50 values and selectivity ratios.

#### Tab 5: Mechanism
Provides mechanistic explanations for predicted toxicity findings using Adverse Outcome Pathways (AOPs).
- **Structural Alert Detection**: Screens the molecular structure for 10 known bioactivation-prone motifs:
  1. Aniline / Aromatic Amine (Ar-NH₂)
  2. Quinone / Hydroquinone (catechol)
  3. Thiophene S-Oxidation
  4. Acyl Glucuronide Reactivity (carboxylic acid)
  5. Epoxide Formation (unsubstituted aromatic ring)
  6. Nitroaromatic Reduction (Ar-NO₂)
  7. α,β-Unsaturated Carbonyl (Michael acceptor)
  8. Furan Ring Oxidation
  9. Methylenedioxy (MDP) Metabolic Inhibition
  10. Phenol Oxidation to Quinone-Imine
- **For each detected alert**:
  - **Organ at Risk**: Which organ system is primarily affected (Liver, Heart, Kidney, Skin, Bone Marrow, Bladder).
  - **AOP ID**: Reference to the OECD Adverse Outcome Pathway database.
  - **AOP Chain**: Step-by-step molecular cascade from the initial chemical event to the final adverse outcome. Displayed as a visual pathway with connected nodes (e.g., "CYP1A2 N-oxidation → Hydroxylamine intermediate → Nitroso metabolite → Covalent protein binding → Mitochondrial dysfunction → Hepatocyte necrosis").
  - **Mechanistic Explanation**: Detailed scientific narrative explaining *why* this structural feature causes toxicity and through what biological mechanism.
  - **Confidence Score**: Probability estimate (30–95%) based on molecular properties and metabolic data.
  - **Mitigation Strategy**: Actionable recommendations (e.g., "Consider N-methylation to block N-oxidation. GSH trapping assay recommended.").
- **Recommended Follow-Up Studies**: A prioritized list of experimental studies to confirm or rule out the predicted risks (e.g., GSH trapping assay, Ames test, radiolabeled ADME study).
- **Clean State**: If no structural alerts are detected, displays "No Structural Alerts Detected" with a recommendation for standard safety pharmacology.

#### Tab 6: Bioactivation
Maps how the body's metabolic enzymes could convert the compound into toxic reactive intermediates.
- **For each bioactivation pathway**:
  - **Alert Name**: The type of structural vulnerability (e.g., "Thiophene S-Oxidation").
  - **Structural Motif**: The specific chemical group at risk (e.g., "Thiophene ring system").
  - **CYP Enzyme(s)**: Which cytochrome P450 enzyme(s) perform the bioactivation (e.g., "CYP2C9 (primary), CYP3A4 (secondary)").
  - **Reactive Intermediate**: The toxic metabolite formed (e.g., "Thiophene S-oxide → Thioaldehyde").
  - **Target Macromolecule**: What the reactive intermediate attacks (e.g., "Hepatic proteins — covalent adducts trigger immune response").
  - **Detoxification Pathway**: How the body tries to neutralize the reactive species (e.g., "GSH conjugation of S-oxide intermediate, epoxide hydrolase").
  - **Risk Level**: High, Moderate, or Low based on LogP and metabolic clearance data.
  - **Clinical Relevance**: Real-world examples of drugs that were withdrawn or carry warnings due to this pathway (e.g., "Tienilic acid withdrawn due to thiophene bioactivation → autoimmune hepatitis").
- **Metabolic Soft Spots**: Lists the specific molecular positions vulnerable to CYP oxidation, the primary CYP enzyme responsible, the type of metabolite formed, and whether it's predicted to be Reactive or Stable.
- **Bioactivation Flow Diagram**: Visual summary showing the cascade: Parent Compound → CYP Oxidation → Reactive Intermediate → Macromolecule Adduct → Cellular Stress → Organ Toxicity.
- **GSH Trapping Recommendation**: Flags when a glutathione trapping assay should be performed to quantify reactive metabolite formation.

#### Collapsible: Directional ADMET Indicators
- **ADMET Radar Chart**: 5-axis radar visualization showing Absorption, Distribution, Metabolism, Excretion, and Toxicity scores (0–1 scale). Labeled as "Computational" to indicate these are directional estimates, secondary to the primary in vitro assay data.

### External Database Integrations (Layer 1)
- **BindingDB**: Experimental binding affinities (IC50, Ki, Kd) for the compound against known targets.
- **STRING**: Protein-protein interaction networks for the target protein.
- **KEGG**: Biological pathway enrichment analysis.
- **Reactome**: Detailed biological pathway mapping.
- **Open Targets**: Target-disease association evidence and approved drug information.

### AI Analysis
- **Layer 1 AI Panel**: Claude-powered analysis synthesizing all in vitro results into a structured narrative with risk assessment and recommendations.

### Export Options
- Export PNG (chart images)
- PDF Report (formatted results document)
- Export JSON (raw simulation data)

---

## Layer 2 — Animal Cohort Digital Twin

### Purpose
Layer 2 simulates preclinical animal studies using physiologically-based pharmacokinetic (PBPK) modeling. It takes the compound characterized in Layer 1 and predicts how it will behave in animal species, projects a safe first-in-human (FIH) dose, and identifies organ-specific toxicity risks. It answers: *"What dose can we safely give to a human for the first time?"*

### Inputs
- **Species & Strain**: 7 validated parameter sets — Mouse CD-1, Mouse C57BL/6, Rat Sprague Dawley, Rat Wistar, Dog Beagle, Cynomolgus Monkey. Human is a background translation target only (not selectable).
- **Study Type**: Single Dose, 14-Day Repeat, 28-Day Sub-Chronic, 90-Day Chronic, or Carcinogenicity.
- **Route of Administration**: Oral (PO), Intravenous (IV), Subcutaneous (SC), Intramuscular (IM), or Intraperitoneal (IP).
- **Dose Levels**: Configurable low, mid, and high dose levels in mg/kg.
- **Formulation**: BCS-aware formulation modeling with a library of 20 excipients.
- **Cascade from Layer 1**: MW, LogP, TPSA, absorption, and toxicity scores automatically carry forward. Caco-2 permeability maps to bioavailability, microsomal CLint maps to clearance, and fu% maps to volume of distribution adjustments.

### Results Panel

#### Summary Header
- **Overall Risk Level**: LOW, MODERATE, or HIGH based on aggregated toxicity signals.
- **Study Identity**: Species, strain, study type, and route.
- **Study Scale**: Total number of animals and estimated study cost (USD).

#### Core PBPK Metrics
- **NOAEL (No Observed Adverse Effect Level)**: The highest dose showing no adverse effects (mg/kg), with lower and upper bounds.
- **MTD (Maximum Tolerated Dose)**: The highest dose animals can tolerate without unacceptable toxicity (mg/kg).
- **t½ (Animal Half-Life)**: Elimination half-life in the selected species, including Cmax at the therapeutic dose.

#### PK Profiles Chart
- **Animal PK Curve**: Solid amber line showing predicted plasma concentration over time in the animal species.
- **Projected Human PK Curve**: Dashed blue line showing the allometrically-scaled human projection.

#### Study Groups Table
Detailed experimental design with:
- **Control**: Vehicle-only arm.
- **Low, Mid, High (NOAEL) Dose Arms**: Dose in mg/kg/day, dose multiple vs. projected human therapeutic dose, and number of animals per sex.
- **Recovery Group**: High-dose animals with a washout period to assess reversibility.
- **Satellite TK Group**: Toxicokinetics sampling group for exposure assessment.
- **Summary**: Total animal count and study duration in weeks.

#### Predicted Toxicity Signals
Organ-specific toxicity predictions:
- **Cardiovascular**: QT prolongation risk from hERG inhibition (ICH S7B).
- **Hepatic**: ALT/AST elevation, DILI structural alert assessment (ICH M3(R2)).
- **Genotoxicity**: Ames test prediction, ICH S2(R1) battery requirements.
- **Tissue Accumulation**: Repeat-dose tissue accumulation risk.
- **General Systemic**: Overall systemic toxicity assessment.
Each finding includes the risk level (High/Moderate/Low), the relevant ICH guideline reference, the specific predicted finding, and the structural/pharmacological basis.

#### Human Translation Panel
The core output of Layer 2 — projecting animal data to humans:
- **HED (BSA/Km Method)**: Human Equivalent Dose calculated using the FDA 2005 body surface area allometric scaling method.
- **HED (PBPK-Refined)**: A refined HED using clearance-corrected allometric scaling for greater accuracy.
- **Proposed FIH Dose**: Absolute starting dose in mg for a 70 kg human (typically 1/10th of the conservative HED), also expressed in mg/kg.
- **Safety Margin**: NOAEL-to-HED ratio. Classified as Excellent (>10×), Acceptable (3–10×), or Narrow (<3×).
- **Projected Human PK at FIH Dose**: Predicted human Cmax, AUC, and half-life at the proposed starting dose.
- **Species Justification**: AI-generated explanation of why the selected species is appropriate for this molecule.
- **Layer 3 Integration Note**: Confirms the FIH dose has been auto-populated as the starting dose for Layer 3.

#### IND-Enabling Regulatory Checklist
- **Status Badge**: IND-READY or GAPS DETECTED.
- **Checklist Items**: Regulatory requirements based on ICH/OECD guidelines:
  - ICH M3(R2) — Rodent toxicology
  - ICH S4A — Non-rodent toxicology
  - ICH S2(R1) — Genotoxicity battery
  - ICH S3A — Pharmacokinetics
  - ICH S7A/S7B — Safety pharmacology (cardiovascular, CNS, respiratory)
  - ICH S6(R1) — Biotechnology-derived products (if applicable)
- Each item shows Pass/Warn status based on the current study design.

### External Database Integrations (Layer 2)
- **PharmGKB**: Pharmacogenomics data — how genetic variants affect drug response.
- **DisGeNET**: Gene-disease associations for the target.
- **GnomAD**: Population genetic variant frequencies.
- **STRING**: Protein interaction networks (carried from Layer 1).
- **KEGG/Reactome**: Pathway data (carried from Layer 1).

### AI Analysis
- **Layer 2 AI Panel**: Claude-powered synthesis of PBPK results, toxicity findings, and FIH dose rationale.

---

## Layer 3 — Patient Cohort Digital Twin

### Purpose
Layer 3 simulates a virtual patient population to predict clinical pharmacology outcomes. It takes the FIH dose from Layer 2 and models how the drug will perform across a diverse patient population with real-world variability. It answers: *"How will this drug perform in real patients with different ages, weights, organ function, and genetics?"*

### Inputs
- **Starting Dose**: Auto-populated from Layer 2's FIH dose projection (editable).
- **Cohort Size**: Number of virtual patients to simulate (typically 50–500).
- **Age Range**: Minimum and maximum patient age for the cohort.
- **Indication**: Disease context for efficacy modeling.
- **Dose Levels**: Multiple dose arms for dose-response analysis.
- **Cascade from Layer 2**: FIH dose, animal PK parameters, and safety margin data.

### Results Panel

#### Summary Statistics
Four headline metrics at the top:
- **Responder Rate**: Percentage of patients meeting the primary efficacy endpoint.
- **Cmax Mean ± SD**: Maximum plasma concentration with population variability.
- **AUC₀₋₄₈**: Total drug exposure over 48 hours.
- **Grade ≥3 AEs**: Projected incidence of severe (CTCAE Grade 3+) adverse events.

#### Tab 1: PK/PD Curves
- **Concentration-Time Profile**: Population PK curve using a 2-compartment PBPK model with 95% confidence intervals.
- **Therapeutic Window**: Visual markers showing the efficacy threshold and toxicity ceiling.
- **Population Variability**: Shaded regions representing inter-individual PK variability derived from NHANES population data.

#### Tab 2: Responders
- **Donut Chart**: Visual breakdown of the cohort into three categories:
  - **Responders**: Patients achieving the primary endpoint.
  - **Partial Responders**: Patients with sub-threshold but measurable response.
  - **Non-Responders**: Patients with no meaningful response.
- Response rates are adjusted for dose, indication severity, and population demographics.

#### Tab 3: Adverse Events
Real-time safety signal enrichment from FDA databases:
- **AE Table**: Predicted adverse events (e.g., Nausea, Neutropenia, Hepatotoxicity, QT Prolongation) with columns for:
  - **Incidence (%)**: Predicted occurrence rate.
  - **Severity Breakdown**: Mild / Moderate / Severe proportions.
  - **Onset**: Projected day of first occurrence.
- **Data Sources**: Enriched with real-time data from FAERS (FDA Adverse Event Reporting System) and SIDER (Side Effect Resource).
- AE profiles are informed by the structural alerts and organ-risk signals identified in Layers 1 and 2.

#### Tab 4: Subgroup Analysis
Heatmap breaking down efficacy and safety across patient subpopulations:
- **Demographics**: Age brackets (18–40, 41–60, 61–75), Sex (Male, Female), Race/Ethnicity.
- **Comorbidities**: Renal function strata (eGFR >90 vs. 30–60 mL/min).
- **Metrics per subgroup**: Response Rate, AE Rate, Cmax, AUC, and Progression-Free Survival (PFS).
- Population parameters derived from NHANES (National Health and Nutrition Examination Survey) data including BMI distributions, organ function, and demographic proportions.

#### Tab 5: Dose-Response
- **Dose-Response Curve**: Plots response percentage across multiple dose levels (e.g., 50 mg to 800 mg).
- **RP2D (Recommended Phase 2 Dose)**: The dose selected for further development, balancing efficacy and tolerability.
- **MTD**: Maximum Tolerated Dose from the dose-escalation analysis.
- Each dose level shows the number of simulated patients and the dose-specific response rate.

#### Cascade to Layer 4
- **Export I/E Criteria**: Generates inclusion/exclusion criteria derived from responder analysis for use in the Layer 4 trial design.
- Responder rate, PK parameters, and safety profile automatically inform trial power calculations.

### External Database Integrations (Layer 3)
- **FAERS**: FDA Adverse Event Reporting System — real-world safety signals.
- **ClinicalTrials.gov**: Active and completed trials for the indication.
- **NHANES**: Population health survey data for realistic patient demographics.
- **ChEMBL**: Pharmacodynamic reference data.
- **Open Targets**: Disease-target association evidence.

### AI Analysis
- **Layer 3 AI Panel**: Claude-powered analysis of population PK/PD, responder stratification, and dose-selection rationale.

---

## Layer 4 — Trial Digital Twin

### Purpose
Layer 4 runs a Monte Carlo simulation of a clinical trial to predict success probability, optimal sample size, enrollment feasibility, and total cost. It takes the dose, responder rate, and safety profile from Layer 3 and simulates thousands of virtual trial executions. It answers: *"If we run this trial, what is the probability it will succeed, and how should we design it?"*

### Inputs
- **Phase**: Phase I, Phase II, or Phase III.
- **Primary Endpoint**: Objective Response Rate (ORR), Progression-Free Survival (PFS), Overall Survival (OS), or custom.
- **Control Arm**: Placebo, Standard of Care, or Active Comparator.
- **Target Power**: Statistical power (typically 80% or 90%).
- **Significance Level (α)**: Usually 0.05 (two-sided).
- **Monte Carlo Repetitions**: Number of simulated trial runs (default 1,000).
- **Enrollment Rate**: Expected patients per site per month.
- **Number of Sites**: Clinical trial sites.
- **Dropout Rate**: Expected patient attrition.
- **Cascade from Layer 3**: Responder rate, dose, PK parameters, AE profile, and subgroup data.

### Results Panel

#### Summary Statistics Banner
Four headline metrics:
- **Trial Success Probability**: Percentage with 95% confidence interval (e.g., "72.4%, 95% CI: 64.1–80.7%") and p-value.
- **Optimal Sample Size**: Total patients required for target power at the specified α level.
- **Projected Duration**: Estimated months for enrollment and follow-up.
- **Estimated Cost**: Total budget in USD with ±12% sensitivity range.

#### Tab 1: Success Probability
- **Circular Gauge**: SVG visualization showing the probability with color-coded confidence zones — Low (<50%, red), Moderate (50–70%, amber), High (>70%, green).
- **Key Risk Factors**: Structured list with pass/warn status for:
  - Statistical Power adequacy
  - Enrollment Feasibility
  - Dropout Risk
  - Site Quality
  - Regulatory Pathway clarity

#### Tab 2: Enrollment
- **Enrollment Trajectory Chart**: Three curves plotted over the trial duration:
  - **Expected**: Mean enrollment trajectory.
  - **95% CI**: Confidence band around the expected trajectory.
  - **Target**: The enrollment target line.
- Helps identify whether the trial can enroll on time or will face delays.

#### Tab 3: Power Curve
- **Statistical Power Graph**: Plots power (1−β) against sample size (n).
- **80% Power Threshold**: Horizontal reference line.
- **Optimal n**: Highlighted point showing the selected sample size.
- Allows sponsors to see the trade-off between enrolling more patients and achieving higher statistical confidence.

#### Tab 4: Balance Report
Verifies that randomization produces balanced treatment arms:
- **Arm Comparison Table**: Treatment vs. Control across key covariates:
  - Age, Sex distribution, Disease Stage, ECOG Performance Score, BMI, eGFR, Prior Lines of Therapy.
- **Standardized Mean Difference (SMD)**: Each covariate shows its SMD with a 0.10 threshold. Values below 0.10 indicate good balance.

#### Tab 5: Site Ranking
- **Global Site List**: Ranks the top clinical trial sites by:
  - **Enrollment per Month**: Expected patient accrual rate.
  - **Quality Score**: Site quality rating (out of 10) based on historical performance.
  - **Composite Score**: Weighted combination of enrollment and quality.
- Sites include major academic medical centers (e.g., Johns Hopkins, Royal Marsden, MD Anderson).

#### Tab 6: Cost Summary
- **Budget Breakdown Chart**: Horizontal bars showing allocation across:
  - Site Operations
  - Drug Supply
  - Clinical Monitoring
  - Lab & Biomarker
- **Unit Costs**: Cost per Patient and Cost per Site.
- **Currency Toggle**: View costs in USD, EUR, or JPY.
- Note: Cost values are stored in millions — displayed directly without additional conversion.

#### Regulatory Outlook
- **Designation Eligibility**: Assessment of eligibility for:
  - Breakthrough Therapy Designation
  - Fast Track Designation
  - Accelerated Approval
  - Orphan Drug Designation
- **Adaptive Design Section**: If interim analyses are configured, shows regulatory notes on Statistical Analysis Plan (SAP) requirements and O'Brien-Fleming alpha-spending boundaries.
- **Development Timeline**: Visual vertical timeline from IND-Enabling Studies through Phase I, II, III to Approval.
- **Approved Precedents**: Live data from Drugs@FDA showing approved drugs in the same therapeutic area with generic name, application number, and review type (Priority/Standard).

### External Database Integrations (Layer 4)
- **ClinicalTrials.gov**: Active and completed trials for competitive landscape analysis.
- **Drugs@FDA**: Approved drug precedents and review timelines.
- **ECOTox**: Environmental toxicology data for safety context.

### AI Analysis
- **Layer 4 AI Panel**: Claude-powered analysis of trial design rationale, competitive context, and go/no-go recommendation.

---

## Cross-Layer Features

### Full AI Report
Available after any layer completes. Generates a comprehensive Claude-powered analysis synthesizing all completed layers — in vitro assay data, preclinical findings, patient cohort outcomes, and trial projections — into a single structured report with:
- GO/NO-GO rationale
- Risk flags and mitigation recommendations
- Cross-layer consistency checks
- Recommended next steps

### Demo Mode
An 18-step guided walkthrough that demonstrates the full platform pipeline:
1. Steps 1–7: Layer 1 — SMILES input, protein target setup, simulation, and in vitro results review.
2. Steps 8–11: Layer 2 — Species selection, PBPK simulation, toxicity review, and FIH dose projection.
3. Steps 12–15: Layer 3 — Patient cohort simulation, responder analysis, and AE profiling.
4. Steps 16–17: Layer 4 — Trial simulation and regulatory outlook.
5. Step 18: Full AI Report generation.

### 3D Molecular Visualization
Three visualization modes available from the Layer 1 input panel:
- **Cinematic**: High-quality rendered visualization with lighting effects.
- **Scientific**: Ball-and-stick model with element coloring.
- **Explorer**: Interactive 3D exploration with rotation and zoom.

### Light/Dark Mode
Toggle between dark mode (default) and light mode via the Sun/Moon icon in the header. Light mode applies comprehensive CSS overrides while preserving accent colors.

### Project Management
- **Saved Projects Sidebar**: Previous simulation runs with GO/WATCH/NO-GO status, key metrics (QED, Binding, Response Rate), and timestamps.
- **New Project**: Reset all inputs and results for a fresh simulation.

---

## Live Database Integrations Summary

| # | Database | Layers | Data Type |
|---|----------|--------|-----------|
| 1 | ChEMBL | 1, 3 | Bioactivity data, compound properties |
| 2 | PubChem | 1 | Chemical structures, properties |
| 3 | UniChem | 1 | Cross-database compound identifiers |
| 4 | ZINC | 1 | Commercially available compounds |
| 5 | BindingDB | 1 | Experimental binding affinities |
| 6 | STRING | 1, 2 | Protein-protein interaction networks |
| 7 | KEGG | 1, 2 | Biological pathway data |
| 8 | Reactome | 1, 2 | Detailed pathway mapping |
| 9 | Open Targets | 1, 3 | Target-disease associations |
| 10 | PharmGKB | 2 | Pharmacogenomics |
| 11 | FAERS | 3 | FDA adverse event reports |
| 12 | ClinicalTrials.gov | 3, 4 | Clinical trial data |

Additional data sources used within simulations:
- **UniProt**: Protein information and crystal structures
- **PDB (RCSB)**: 3D protein structures for docking
- **AlphaFold**: Predicted protein structures with pLDDT confidence
- **NHANES**: US population health survey data
- **Drugs@FDA**: Approved drug database
- **SIDER**: Side effect resource
- **DisGeNET**: Gene-disease associations
- **GnomAD**: Population genetic variants
- **ECOTox**: Environmental toxicology

---

## Simulation Engines

| Engine | File | Layer | Purpose |
|--------|------|-------|---------|
| In Vitro Simulation | `inVitroSim.ts` | 1 | IC50 dose-response, permeability, clearance, hERG, selectivity |
| Bioactivation Engine | `bioactivationEngine.ts` | 1 | Mechanistic toxicity (10 AOPs) & metabolic bioactivation pathways |
| ADMET Simulation | `admet.ts` | 1 | 5-axis ADMET scoring (directional, secondary) |
| Animal PBPK Simulation | `animalSim.ts` | 2 | Allometric scaling, PBPK, NOAEL/MTD, FIH dose projection |
| Cohort Simulation | `cohortSim.ts` | 3 | Virtual patient population, PK/PD, responder analysis |
| Trial Simulation | `trialSim.ts` | 4 | Monte Carlo trial, adaptive design, cost modeling |

---

## Data Flow Between Layers

```
Layer 1 (In Vitro)
  │
  ├── Caco-2 Papp ──────────→ Layer 2: Bioavailability estimate
  ├── Microsomal CLint ──────→ Layer 2: Clearance parameter
  ├── fu% ───────────────────→ Layer 2: Volume of distribution adjustment
  ├── hERG IC50 ─────────────→ Layer 2: Cardiovascular risk flag
  ├── IC50 (target) ─────────→ Layer 2: Therapeutic dose estimation
  └── Overall risk ──────────→ Layer 2: GO/NO-GO gate
       │
Layer 2 (Animal Cohort)
  │
  ├── FIH Dose (mg) ─────────→ Layer 3: Starting dose (auto-populated)
  ├── Animal PK (Cmax, t½) ──→ Layer 3: PK model initialization
  ├── Safety margin ─────────→ Layer 3: Dose-escalation boundaries
  └── Toxicity signals ──────→ Layer 3: AE prediction enrichment
       │
Layer 3 (Patient Cohort)
  │
  ├── Responder rate ─────────→ Layer 4: Effect size for power calculation
  ├── AE profile ─────────────→ Layer 4: Dropout rate estimation
  ├── Optimal dose (RP2D) ────→ Layer 4: Treatment arm dose
  ├── PK variability ─────────→ Layer 4: Population heterogeneity
  └── I/E criteria ───────────→ Layer 4: Enrollment feasibility
       │
Layer 4 (Trial)
  │
  └── Final Output: GO/NO-GO with success probability, sample size,
      cost, timeline, and regulatory pathway recommendation
```
