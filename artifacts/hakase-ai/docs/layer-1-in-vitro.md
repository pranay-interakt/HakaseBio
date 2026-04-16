# Layer 1 — In Vitro Digital Twin

## Overview

Layer 1 is the foundational simulation layer in HakaseAI's 4-layer BioDigital Twin pipeline. It takes a single molecule (as a SMILES string) and performs a comprehensive in vitro characterization: molecular property analysis, ADMET profiling, target binding prediction, dose-response modeling, toxicity assessment, and a Go/No-Go decision. All results cascade forward into Layer 2 (Animal Cohort), Layer 3 (Patient Cohort), and Layer 4 (Trial).

Layer 1 runs entirely in the browser using RDKit.js for molecular descriptor computation. No server round-trip is required for the core simulation — only external database enrichment uses network calls.

---

## Pipeline Steps (in execution order)

When the user clicks **"Run"**, the simulation executes in this order:

```
1. Molecular Property Extraction (RDKit.js)
2. Pharmacophore Profile Detection (SMARTS patterns)
3. Target Suggestion (29-target catalog + ChEMBL)
4. ADMET Scoring (Absorption, Distribution, Metabolism, Excretion, Toxicity)
5. Lipinski Rule-of-5 Analysis
6. QED (Quantitative Drug-likeness) + SA Score (Synthetic Accessibility)
7. Binding Affinity Estimation (Kd, Ki, IC50)
8. In Vitro Simulation (Dose-Response, Permeability, Metabolic Stability)
9. Bioactivation Assessment (Reactive Metabolites)
10. Toxicity Alerts & Organ Risk Scoring
11. Safety Flag Computation (ICH/FDA guidelines)
12. Go/No-Go Decision
13. External Database Enrichment (BindingDB, ChEMBL, STRING, KEGG, Reactome, Open Targets)
14. Provenance Metadata & HAIOps Governance Recording
```

---

## Step 1: Molecular Property Extraction

**Source**: `chemistry.ts` using RDKit.js (WebAssembly)

When a SMILES string is entered, RDKit.js computes 40+ molecular descriptors:

| Property | Description | Used For |
|---|---|---|
| MW (Molecular Weight) | Daltons | Lipinski check, ADMET, target matching |
| LogP (CrippenClogP) | Partition coefficient | Absorption, distribution, BBB permeability |
| TPSA | Topological Polar Surface Area (Å²) | Absorption prediction, BBB permeability |
| HBD / HBA | Hydrogen Bond Donors / Acceptors | Lipinski check, permeability |
| Rotatable Bonds | Molecular flexibility | Metabolism, oral bioavailability |
| Aromatic Rings | Ring aromaticity count | Target class matching |
| FractionCSP3 | sp3 carbon fraction | Drug-likeness, selectivity |
| NumHeavyAtoms | Non-hydrogen atom count | Ligand efficiency calculation |
| labute ASA | Accessible Surface Area | Distribution modeling |

All descriptors are computed client-side with no server dependency.

---

## Step 2: Pharmacophore Profile Detection

**Source**: `chemistry.ts` → `detectPharmacophores()`

The system runs 27+ SMARTS pattern matches against the molecule to build a pharmacophore profile:

| Feature | SMARTS Detection | Relevance |
|---|---|---|
| Aromatic N count | N atoms in aromatic rings | Kinase hinge-binding (EGFR, CDK4) |
| Basic amine count | Primary/secondary/tertiary amines | CNS drugs, GPCRs |
| Michael acceptor | α,β-unsaturated carbonyls | Covalent inhibitors (osimertinib) |
| Quinazoline / Pyrimidine | Fused N-heterocycles | EGFR pharmacophore |
| Sulfonamide / Sulfone | -SO2NH- / -SO2- | COX-2, kinase inhibitors |
| Hydroxamic acid | -CONHOH | HDAC inhibitors |
| Carboxylic acid | -COOH | ACE inhibitors, NSAIDs |
| Indole | Fused bicyclic aromatic | Serotonin receptor ligands |
| Benzimidazole | Fused N-heterocycle | Kinase inhibitors |
| Piperidine / Piperazine | Saturated N-heterocycles | CNS drugs, CCR5 antagonists |
| Urea linkage | -NHCONH- | BRAF inhibitors |
| Trifluoromethyl (CF₃) | -CF3 | Metabolic stability |
| Halogen atoms | F, Cl, Br, I | Selectivity tuning |
| Aniline | Aromatic -NH2 | EGFR anilinoquinazolines |
| Alkoxy groups | -OCH3, -OEt | Erlotinib/gefitinib substituents |
| Thiol | -SH | Cysteine-targeting warheads |
| Phosphate / Nitro / Ester / Lactam / Epoxide | Various | Structural liability flags |

This profile feeds directly into target suggestion scoring and in vitro simulation parameter adjustment.

---

## Step 3: Target Protein Suggestion

**Source**: `targetSuggestion.ts` + `chemblTargetLookup.ts`

### Tier 1: Pharmacophore-Based Heuristic Matching

The molecular properties and pharmacophore profile are scored against a **catalog of 29 drug targets** spanning 11 therapeutic areas:

| Therapeutic Area | Targets |
|---|---|
| Oncology | EGFR, CDK4, CDK2, KDR (VEGFR2), AKT1, PIK3CA, RAF1, ABL1, CHEK1, BRD4, MCL1 |
| CNS / Psychiatry | DRD2, HTR2A, CHRM2 |
| Pain | OPRM1, TRPV1 |
| Cardiovascular | ACE |
| Inflammation | PTGS2 (COX-2), MAPK14 (p38α) |
| Immunology | BTK, CHUK (IKKα), PDCD1 (PD-1), CCR5 |
| Endocrinology | AR, ESR1 |
| Metabolic | PPARγ |
| Epigenetics | HDAC2, PARP1 |
| Chaperone | HSP90 |

Each target has a custom scoring function awarding points for matching features. For example, EGFR scores for quinazoline scaffolds (+2.5), aromatic nitrogens (+2), aniline groups (+1.5), MW 300–560 Da (+1.5), and Michael acceptors (+1.5 for covalent binding).

**Confidence scoring**: Raw score / 12 (absolute maximum). Labels:
- **High** (≥65%): Strong multi-feature match
- **Medium** (35–64%): Partial match
- **Low** (<35%): Weak resemblance

### Tier 2: ChEMBL Experimental Data

In parallel, the SMILES is sent to ChEMBL to look up known bioactivity data. If the compound is found, real IC50/Ki/EC50 values are retrieved and labeled **"Experimental"** — the highest confidence tier.

**Experimental always takes priority.** The final list merges ChEMBL results first, then fills remaining slots with heuristic suggestions (up to 5 total).

### Auto-Configuration

The top-ranked target automatically:
- Sets the **UniProt ID** field
- Triggers **UniProt API** fetch for protein metadata
- Triggers **AlphaFold** structure prediction fetch
- Sets the **PDB Structure ID** from known crystal structures
- Sets the **Therapeutic Area Preset** via area mapping (e.g., "Oncology (CML)" → "Oncology", "CNS / Pain" → "CNS")

Users can override any of these by manual selection.

---

## Step 4: ADMET Scoring

**Source**: `admet.ts` → `runAdmetSimulation()`

Five ADMET dimensions are scored on a 0–1 scale using molecular descriptors:

| Dimension | Key Inputs | Scoring Logic |
|---|---|---|
| **Absorption** | TPSA, Lipinski pass/fail | TPSA < 60 → high (~0.85+); TPSA 60–140 → moderate; TPSA > 140 → low |
| **Distribution** | LogP, MW | Optimal LogP 1–4 → high; extreme LogP → low |
| **Metabolism** | Rotatable bonds, HBD | Low flexibility → stable; high flexibility → rapid metabolism |
| **Excretion** | MW, LogP | Moderate MW/LogP → balanced clearance |
| **Toxicity** | MW, LogP, structural alerts | Lower is better; high LogP/MW + structural alerts increase risk |

The **overall ADMET score** is a weighted average of all five dimensions.

---

## Step 5: Lipinski Rule-of-5 Analysis

**Source**: `admet.ts`

Checks four classical drug-likeness rules:

| Rule | Threshold | Pass/Fail |
|---|---|---|
| MW | ≤ 500 Da | Pass if ≤ 500 |
| LogP | ≤ 5 | Pass if ≤ 5 |
| HBD | ≤ 5 | Pass if ≤ 5 |
| HBA | ≤ 10 | Pass if ≤ 10 |

Additional assessments:
- **Lead-Like**: MW ≤ 350, LogP ≤ 3.5 (stricter criteria for lead compounds)
- **Violation count**: 0 = excellent, 1 = acceptable, 2+ = concern, 3+ = potential NO-GO

---

## Step 6: QED & SA Score

**Source**: `chemistry.ts`

### QED (Quantitative Estimate of Drug-likeness)
A weighted score (0–1) combining MW, LogP, HBD, HBA, TPSA, and ring count desirability functions. QED > 0.5 is considered drug-like; QED > 0.7 is excellent.

### SA Score (Synthetic Accessibility)
Ranges from 1 (easy to synthesize) to 10 (very difficult). Derived from MW, rotatable bonds, ring complexity, and heteroatom count. SA ≤ 4 is straightforward; SA > 6 may require specialized chemistry.

---

## Step 7: Binding Affinity Estimation

**Source**: `admet.ts` (binding section)

For the selected UniProt target, the system estimates:

| Parameter | Description |
|---|---|
| **Kd** (nM) | Dissociation constant — how tightly the molecule binds |
| **Ki** (nM) | Inhibition constant — competitive binding strength |
| **IC50** (nM) | Half-maximal inhibitory concentration |
| **Selectivity** | Ratio of primary target IC50 to off-target IC50 values |

Each target in the internal database has a `potencyRange` (e.g., EGFR: 1–200 nM). The estimate is adjusted by the molecule's drug-likeness (QED) and molecular similarity to known inhibitors.

**Off-target panel**: For each primary target, known cross-reactive targets are evaluated (e.g., EGFR → HER2, HER3). The selectivity score indicates how specific the compound is.

---

## Step 8: In Vitro Simulation Engine

**Source**: `inVitroSim.ts` → `runInVitroSimulation()`

This is the most detailed simulation step, producing results that mimic actual laboratory assays:

### 8.1 Dose-Response Modeling

**Baseline pIC50 Calculation**:
- Starts at 5.2
- Adjusts for LogP (parabolic optimum around 2.5)
- Adjusts for MW (optimal 300–500 Da)
- Penalizes high TPSA (>140) and high HBD count
- Adds ligand efficiency bonus if LE > 0.4
- Clamped between 4.0 and 9.0

**Pharmacophore Bonus** (up to +1.5 pIC50 units):
- Therapeutic area-specific boosts
- E.g., in Oncology: Michael acceptors (+0.35), aromatic N (+0.4)

**Final IC50**: `10^(9 - finalPIC50)` nM, clamped between 0.3 nM and 50,000 nM

**Hill Coefficient** (dose-response steepness):
- Baseline: 1.0
- +0.15 for ≥2 aromatic rings
- +0.1 for high FSP3 (>0.4)
- +0.3 for Michael acceptors (covalent binding)
- -0.1 for high flexibility (RotBonds > 8)
- Clamped between 0.7 and 3.0

**Maximum Inhibition (Emax)**:
- Baseline: 90%
- +5% for high potency (pIC50 > 7)
- +3% for Michael acceptors
- -5% for high lipophilicity (LogP > 5)
- Clamped between 60% and 100%

**Dose-Response Curve**: 15-point dataset generated using the Hill equation with seeded noise:
```
Response = Emax / (1 + (IC50 / Concentration)^HillCoeff)
```

### 8.2 Permeability Assessment

| Assay | Method | Output |
|---|---|---|
| **Caco-2** | Predicted from LogP and TPSA | Papp (×10⁻⁶ cm/s), classified as High/Moderate/Low |
| **PAMPA** | Parallel Artificial Membrane Permeability | Complementary to Caco-2 |

### 8.3 Metabolic Stability

| Assay | Output |
|---|---|
| **Microsomal CLint** | Intrinsic clearance (µL/min/mg), classified as Stable/Moderate/Unstable |
| **Hepatocyte CLint** | Whole-cell clearance estimate |

### 8.4 Selectivity Panel

Compares primary target affinity against a panel of off-targets:
- **Kinase Selectivity Score**: Fraction of tested kinases inhibited < 100× primary IC50
- Classification: "Selective" / "Moderately Selective" / "Non-Selective"

---

## Step 9: Bioactivation Assessment

**Source**: `bioactivationEngine.ts` → `runBioactivationAssessment()`

Scans for structural motifs that can form reactive metabolites (which cause idiosyncratic toxicity):

| Alert | Structure | Risk |
|---|---|---|
| Thiophene S-oxidation | Thiophene rings | Hepatotoxicity (reactive sulfoxide) |
| Quinone formation | Para-substituted phenols | Oxidative stress, DNA adducts |
| Epoxide intermediates | Strained alkenes near aromatics | Genotoxicity |
| Aniline oxidation | Aromatic amines | Methemoglobinemia, hepatotoxicity |
| Acyl glucuronide | Carboxylic acids | Protein adducts |
| Nitro reduction | Aromatic nitro groups | Mutagenicity |

Each alert is linked to an **Adverse Outcome Pathway (AOP)** and ICH reference guideline.

---

## Step 10: Toxicity Alerts & Organ Risk

**Source**: `admet.ts`

### Toxicity Alerts

| Alert | Trigger | ICH Reference |
|---|---|---|
| **hERG Cardiac** | Predicted hERG IC50 < 10 µM | ICH S7B |
| **Hepatotoxicity** | Structural alerts + LogP > 3 + MW > 400 | ICH M3(R2) |
| **Genotoxicity (Ames)** | Nitro groups, epoxides, alkylating groups | ICH S2(R1) |
| **CNS Penetration** | BBB-permeable (TPSA < 90, MW < 450, LogP > 0.5) | ICH S7A |

### Organ Risk Scoring

Risk percentage (0–1) for five organ systems:

| Organ | Key Drivers |
|---|---|
| **Liver** | Hepatotoxicity alerts, CYP inhibition, reactive metabolites |
| **Heart** | hERG risk, QT prolongation potential |
| **Kidney** | High LogP, renal clearance issues |
| **CNS** | BBB permeability (risk for non-CNS drugs), off-target neuro activity |
| **GI Tract** | Low absorption, enteric irritation potential |

Color coding: Green (<15%), Yellow (15–30%), Red (>30%).

---

## Step 11: Safety Flag Computation

**Source**: `safetyFlags.ts` → `computeLayer1Flags()`

Safety flags are generated based on ICH/FDA guidelines and persist through all downstream layers:

| Flag | Severity | Trigger | ICH Reference |
|---|---|---|---|
| **Cardiac Safety** | Critical/Major | hERG IC50 < 10 µM | ICH S7B |
| **Hepatotoxicity** | Critical/Major | Structural alerts with >70% confidence | ICH M3(R2) |
| **Drug-Drug Interaction** | Major | CYP inhibition IC50 < 5 µM | FDA DDI Guidance |

All flags are:
- **Review Required**: Must be acknowledged by the user before proceeding
- **Non-droppable**: Persist through L2→L3→L4; cannot be silently ignored
- **Linked to ICH guidelines**: Each flag cites the specific regulatory standard

---

## Step 12: Go/No-Go Decision

**Source**: `admet.ts`

The final verdict synthesizes all L1 data:

| Decision | Criteria |
|---|---|
| **GO** | Favorable ADMET, ≤1 Lipinski violation, no critical safety flags |
| **WATCH** | Borderline profile — 2 Lipinski violations, or multiple low-level tox alerts |
| **NO-GO** | Critical toxicity flags, ≥3 Lipinski violations, or overall ADMET score too low |

The decision directly influences Layer 2 auto-configuration:
- **GO** → Standard 28-day sub-chronic study, oral route, plain formulation
- **WATCH** → 14-day sub-acute study with enhanced monitoring, satellite groups
- **NO-GO** → Single-dose study only (minimize animal use)

---

## Step 13: External Database Enrichment

After the core simulation completes, Layer 1 queries 7+ live databases in parallel:

| Database | API | Purpose |
|---|---|---|
| **ChEMBL** | REST | Known bioactivity data, compound identification, multi-target profiling |
| **BindingDB** | REST | Experimental binding affinities (Kd/Ki/IC50) for the target protein |
| **STRING** | REST | Protein-protein interaction network for the target (hub scores) |
| **KEGG** | REST | Metabolic pathways, disease associations, existing drug networks |
| **Reactome** | REST | Biological process enrichment, signaling pathway mapping |
| **Open Targets** | GraphQL | Target tractability, genetic associations, safety liabilities |
| **UniProt** | REST | Protein metadata, gene symbol, PDB cross-references |
| **AlphaFold** | REST | AI-predicted protein structure |
| **RCSB PDB** | REST | Crystal structure resolution, method, chains |

All queries run via `Promise.allSettled` — if any database is unavailable, the others still return. Failures are recorded in provenance metadata and trigger "graceful degradation" warnings in the UI.

---

## Step 14: Provenance & HAIOps Governance

### Provenance Metadata

Every L1 simulation produces a `ProvenanceRecord` tracking:
- **Engine version**: Which simulation engine produced the results
- **Source file**: e.g., `inVitroSim.ts`, `admet.ts`
- **Timestamp**: When the simulation ran
- **Input SMILES**: The exact molecule analyzed
- **Database queries**: Status of each external API call (success/failed/cached)
- **Staleness warnings**: If cached data is older than threshold

### HAIOps Governance

The HAIOps (Healthcare AI Operations) framework classifies L1 engines as **Critical Risk** because they directly influence safety decisions:

- **Safety Flag Cascade**: L1 flags propagate to L2, L3, L4 with full traceability
- **Clinician-in-the-Loop**: "Review Required" flags cannot be auto-dismissed
- **Audit Trail**: Every decision point is logged with regulatory references
- **Graceful Degradation**: When databases are unavailable, the UI warns the user and notes which data sources are missing

---

## L1 Recommendations

Based on all simulation outputs, Layer 1 generates dynamic recommendations displayed in the results panel:

| Condition | Recommendation | Level |
|---|---|---|
| Toxicity > 60% | Structural optimization to reduce hERG/CYP3A4 liability before animal studies | Warning |
| LogP > 5 | Exceeds Lipinski limit — oral bioavailability may be low | Warning |
| MW > 500 Da | Consider lead optimization to improve membrane permeability | Warning |
| Absorption < 45% | Review TPSA and HBD count; bioisostere substitutions may improve F% | Warning |
| GO decision | Advance to L2 Animal Cohort to project FIH dose and system exposure | OK |
| WATCH decision | Proceed with caution, monitor flagged liabilities in L2 | Info |

All recommendations include the actual computed values (e.g., "Toxicity = 72%", "LogP = 5.23") rather than generic text.

---

## L1 → L2 Cascade

When the user moves to Layer 2 (Animal Cohort), L1 results automatically configure:

| L1 Data Point | L2 Auto-Configuration |
|---|---|
| Toxicity > 60% | Species → Beagle Dog (higher metabolic tolerance) |
| Therapeutic Area = CNS | Species → Cynomolgus Monkey (NHP standard) |
| Go/No-Go = NO-GO | Study → Single Dose (minimize animal use) |
| Go/No-Go = WATCH | Study → Sub-Acute 14-Day |
| Absorption < 35% or LogP < 0 | Route → IV |
| Absorption 35–45% | Route → Subcutaneous |
| LogP > 5 | Formulation → Lipid-Based Nano-Emulsion |
| MW > 500 + LogP > 3 | Formulation → Amorphous Solid Dispersion |

Users can manually override any auto-configured setting — the "L1 Auto" badge disappears for that section.

---

## Key Source Files

| File | Role |
|---|---|
| `src/lib/chemistry.ts` | RDKit molecular properties + pharmacophore detection |
| `src/lib/targetSuggestion.ts` | 29-target pharmacophore catalog + scoring |
| `src/lib/chemblTargetLookup.ts` | ChEMBL compound → target lookup |
| `src/lib/admet.ts` | ADMET scoring, Lipinski, binding estimation, Go/No-Go |
| `src/lib/inVitroSim.ts` | Dose-response, permeability, metabolic stability |
| `src/lib/bioactivationEngine.ts` | Reactive metabolite structural alerts |
| `src/lib/safetyFlags.ts` | ICH-referenced safety flag computation |
| `src/lib/pdModel.ts` | Emax pharmacodynamic model, ChEMBL parameter refinement |
| `src/pages/HakaseAI.tsx` | UI orchestration, external DB enrichment, provenance |

---

## Design Principles

1. **Browser-first**: Core simulation runs client-side via RDKit.js — no server dependency for the primary pipeline. This enables offline-capable molecular analysis.

2. **Deterministic + reproducible**: Given the same SMILES and target, the simulation produces identical results every time (seeded RNG for stochastic components).

3. **Absolute confidence scoring**: Target suggestions use fixed normalization (score/12) rather than relative ranking. If nothing matches well, all suggestions show low confidence — an honest signal.

4. **Experimental data always wins**: ChEMBL-verified bioactivity overrides computational predictions. Labeled "Experimental" to clearly distinguish measured vs. predicted data.

5. **Safety-first cascade**: Safety flags generated in L1 propagate through every downstream layer and cannot be silently dismissed. This ensures no critical finding is lost as the simulation progresses.

6. **Graceful degradation**: When external databases are unavailable, the simulation still runs with browser-only data. Missing data sources are explicitly flagged so the user knows which enrichment is absent.
