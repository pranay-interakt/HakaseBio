# HakaseAI Glossary — Every Term, Acronym, and Why It's Here

A plain-English reference for every scientific term, abbreviation, library, model, and database used anywhere in the HakaseAI pipeline (frontend, backend, AI service). Organized by layer; cross-layer terms at the bottom. Each entry: **what it stands for → what it actually means → where it shows up in our system.**

---

## Cross-cutting (used everywhere)

| Term / abbrev. | Meaning | Where it appears |
|---|---|---|
| **SMILES** | Simplified Molecular-Input Line-Entry System. A short text string that encodes a molecule's atoms and bonds (e.g. `CC(C)Cc1ccc(cc1)C(C)C(=O)O` = ibuprofen). | The single input that drives the entire pipeline. Frontend input box → L1 → L2 → L3 → L4. |
| **UniProt ID** | A stable identifier for a protein in the UniProt database (e.g. `P35372` = µ-opioid receptor). | Specifies *what target* the molecule is supposed to hit. L1 picks it; L2 uses it for docking and embeddings. |
| **PDB ID** | 4-character code for an experimentally solved 3D protein structure in the RCSB Protein Data Bank (e.g. `1ATP`). | L2 Stage 2 picks one to dock against. |
| **HAIOps** | "Healthcare AI Ops." Our internal governance layer — every model call, every threshold, every override is logged and signed. | Banner across the app; backing module is `safetyFlags.ts`. |
| **Provenance** | A trail showing exactly which inputs, models, and versions produced a result. | Every layer attaches one; it's what makes the directives auditable. |
| **EvidencePointer** | A short URL-like reference (e.g. `evt://l1/<sha256>`) that locks a downstream result to the exact upstream evidence it was based on. | Created in L2 Stage 0; carried through L3 and L4. |
| **Falsifier** | A pre-registered, machine-checkable rule that says *"if this happens in a later layer, the earlier prediction is refuted."* Different from "low confidence" — falsified means actively contradicted. **Must be able to fire on real evidence**: deterministic-by-construction predicates (e.g. "L1 RDKit-JS output ≠ L2 RDKit-JS output on the same SMILES") do **not** qualify and are not registered. Integrity of deterministic upstream→downstream handoffs is enforced by `EvidencePointer` cryptographic pinning, not by fake falsifiers. | Stored in `FALSIFIER_REGISTRY`; attached in L2 Stage 9; evaluated in L3. |
| **Directive** | A typed contract object that one layer hands to the next. Layers communicate *only* via directives. | `PreConfirmationDirective` (L2→L3), `PreClinicalPackage` (L3→L4). |
| **GatePolicy / GatePolicySnapshot** | The set of pass/fail thresholds in force when a decision was made, frozen so it can be replayed later. | Used by every Go/No-Go decision. |
| **GAMP 5 / 21 CFR Part 11** | Pharma regulatory standards for "computerized systems" — they require versioned models, signed records, and audit trails. | Why we capture provenance and gate snapshots. |

---

## Layer 1 — In Vitro Digital Twin

Layer 1 turns a SMILES into a fast, browser-only "virtual in vitro" profile. No server round-trip for the core math.

### Cheminformatics building blocks

| Term | Meaning | Used for |
|---|---|---|
| **RDKit / RDKit-JS** | An open-source cheminformatics toolkit. RDKit-JS is the WebAssembly build that runs in the browser. | Computes molecular descriptors, canonicalizes SMILES, generates fingerprints. |
| **WASM (WebAssembly)** | A binary format that lets non-JS languages (here, C++ RDKit) run at near-native speed in the browser. | Enables RDKit to run client-side without a server. |
| **Molecular descriptor** | A number summarizing some property of a molecule (size, polarity, ring count…). | 40+ of them are computed for every input SMILES. |
| **Morgan fingerprint (ECFP4)** | A 2048-bit binary "barcode" of a molecule's substructures. | Used as ML model input in L2 Stages 3/4. |
| **SMARTS** | A pattern language for substructure search (like regex for molecules). | Pharmacophore detection in L1 Step 2. |

### Properties computed

| Term | Meaning | Why it matters |
|---|---|---|
| **MW** | Molecular Weight (Daltons). | Lipinski rule, dosing. |
| **LogP / CrippenClogP** | Octanol/water partition coefficient. How "greasy" the molecule is. | Predicts absorption, blood-brain-barrier crossing. |
| **TPSA** | Topological Polar Surface Area (Å²). | Permeability, BBB. |
| **HBD / HBA** | Hydrogen Bond Donors / Acceptors. | Lipinski rule, permeability. |
| **Rotatable bonds** | Single bonds that can freely rotate. | Oral bioavailability. |
| **FractionCSP3** | Fraction of carbons that are sp3-hybridized (3D-shaped, not flat). | Drug-likeness, selectivity. |
| **QED** | Quantitative Estimate of Drug-likeness (0–1). | One-number summary of "does it look like a drug." |
| **SA score** | Synthetic Accessibility (1–10, lower = easier to make). | Scores how chemically feasible the molecule is. |
| **Lipinski Rule of 5** | Four thresholds (MW, LogP, HBD, HBA) that flag oral-drug-likeness violations. | L1 filter. |
| **Veber rules** | Two more thresholds (rotatable bonds, TPSA). | L1 filter, complementary to Lipinski. |

### Pharmacology terms

| Term | Meaning | Why it matters |
|---|---|---|
| **Pharmacophore** | The 3D pattern of features (e.g. a basic nitrogen + an aromatic ring) needed to bind a target. | L1 Step 2 detects them via SMARTS. |
| **ADMET** | Absorption, Distribution, Metabolism, Excretion, Toxicity — the five pillars of "what the body does to a drug." | L1's main scoring axis; L2 has dedicated ADMET ML. |
| **Kd** | Dissociation constant. Concentration at which half the receptor is bound. Lower = stronger binder. | Drug–target affinity. |
| **Ki** | Inhibition constant. Like Kd but for inhibitors. | Same role for enzymes. |
| **IC50** | Concentration that produces 50% of maximum inhibition. | Standard potency readout. |
| **pKi / pKd / pIC50** | The negative log of the above (so 9 means nM, 6 means µM). | Easier to compare across orders of magnitude. |
| **BBB** | Blood-Brain Barrier — predicts CNS penetration. | ADMET endpoint. |
| **hERG** | Human Ether-à-go-go-Related Gene — a cardiac potassium channel. Blocking it causes lethal arrhythmias. | The #1 cardiac safety filter in pharma. |
| **CYP / CYP3A4 / CYP2D6** | Cytochrome P450 enzymes that metabolize most drugs. | Drug-drug interaction risk. |
| **DILI** | Drug-Induced Liver Injury. | Top cause of post-market drug withdrawals. |
| **Bioactivation / reactive metabolite** | A drug that the liver turns into a chemically reactive (and often toxic) form. | L1 Step 9 flags this. |
| **Ligand efficiency** | Affinity per heavy atom — "potency for your size." | Medicinal chemistry rule of thumb. |

### External databases L1 enriches with

| DB | What it is | Used for |
|---|---|---|
| **ChEMBL** | EBI's curated bioactivity database (~2M assays). | Target suggestion, comparator IC50s. |
| **BindingDB** | Quantitative binding affinity database (~3M records). | Affinity comparators. |
| **STRING** | Protein-protein interaction network. | Pathway context. |
| **KEGG** | Kyoto Encyclopedia of Genes and Genomes — pathway maps. | Pathway context. |
| **Reactome** | Curated biological pathway database. | Pathway context. |
| **Open Targets** | Target-disease association DB (EBI/GSK). | Indication suggestion. |
| **PubChem** | NIH chemical database (>100M compounds). | Identifier resolution. |

---

## Layer 2 — In Silico Confirmation Layer

Layer 2 confirms or falsifies L1 using physics simulations + ML. Mostly server-side via the AI service.

### Engines and toolchains

| Tool | Meaning | Where used |
|---|---|---|
| **AutoDock Vina 1.2.7** | Open-source molecular docking engine — predicts how a small molecule sits inside a protein pocket and how strongly it binds. | L2 Stage 2. |
| **OpenBabel** | Chemistry file-format and protonation tool. | Prepares ligand & protein into PDBQT for Vina. |
| **PDBQT** | A PDB variant that adds atomic charges (Q) and atom types (T) — Vina's required input. | L2 Stage 2. |
| **UFF** | Universal Force Field — a generic energy function for any organic molecule. | 3D coordinate generation pre-docking. |
| **OpenMM 8** | A high-performance GPU molecular dynamics engine. | L2 Stage 5 (FEP). |
| **OpenFF Sage 2.x** | Open Force Field "Sage" — a modern small-molecule force field. | L2 Stage 5 force field. |
| **TIES** | Thermodynamic Integration with Enhanced Sampling — a protocol for relative free-energy calculations. | L2 Stage 5. |
| **RunPod Serverless** | A GPU cloud where we dispatch the very expensive FEP runs. | L2 Stage 5 backend. |

### Physics / pharmacology concepts

| Term | Meaning | Why it matters |
|---|---|---|
| **Docking** | Computationally trying many orientations of a small molecule inside a protein pocket and scoring each. | L2 Stage 2's whole job. |
| **Pose** | One specific 3D arrangement of the docked molecule. | Vina returns the top 9. |
| **RMSD** | Root-Mean-Square Deviation — average distance between two 3D structures. | Measures docking accuracy vs co-crystal ligand. |
| **Co-crystal ligand** | A small molecule whose structure was solved together with the protein (in the PDB). | The "ground truth" pose for our docking. |
| **ΔG (Delta G)** | Change in Gibbs free energy. For binding, in kcal/mol; more negative = stronger binding. | Vina's affinity score. |
| **ΔΔG (Delta-Delta G)** | The *difference* in ΔG between two related ligands. What FEP computes. | L2 Stage 5 output. |
| **FEP** | Free-Energy Perturbation — gold-standard physics method for computing relative binding affinities. | L2 Stage 5. |
| **MD / Molecular Dynamics** | Time-step simulation of every atom under classical mechanics. | The numerical engine FEP runs on top of. |
| **Force field** | The set of equations + parameters that say how atoms attract/repel each other in MD. | OpenFF Sage in our stack. |
| **PBPK** | Physiologically-Based Pharmacokinetics — a multi-compartment ODE model that represents real organs (liver, kidney, etc.) and simulates drug fate over time in a virtual human. | L2 Stage 6. |
| **ODE / RK4** | Ordinary Differential Equation; Runge-Kutta 4th order, a classic ODE integrator. | How we solve the PBPK model. |
| **Allometric scaling** | Mathematically extrapolating drug behavior between species using body-weight power laws. | Rodent → human projection in Stage 6. |
| **Well-stirred liver model** | A simple, widely-used hepatic-clearance equation. | Stage 6 hepatic CL. |
| **Poulin & Theil method** | A formula for predicting volume-of-distribution from logP and protein binding. | Stage 6 Vd. |
| **Cmax / AUC / t½ / Tmax** | Peak concentration / Area Under the Curve / half-life / time to peak — the four canonical PK numbers. | Outputs of Stage 6. |
| **Fu (fraction unbound) / fb (fraction bound)** | Of the drug in plasma, what fraction is *free* (active) vs stuck to plasma proteins. fu + fb = 1. | Stage 6 input; only `fu` reaches the receptor. |
| **PD / Pharmacodynamics** | What the drug does to the body (vs PK = what the body does to the drug). | Stage 7. |
| **QSP** | Quantitative Systems Pharmacology — modeling drug effect at the system/network level. | Stage 7 framing. |
| **Hill equation** | `Effect = C^n / (Ki^n + C^n)` — describes how receptor occupancy rises with concentration. | Stage 7's PD model. |
| **Receptor occupancy** | Fraction of target protein bound by drug at any given time. | Stage 7's primary output. |
| **Therapeutic index / margin** | The ratio between a toxic dose and an effective dose. Higher = safer. | Stage 8. |
| **MABEL** | Minimum Anticipated Biological Effect Level — the lowest dose expected to do *anything* in humans. | Stage 8 / Phase 1 starting-dose anchor. |
| **NOAEL** | No Observed Adverse Effect Level — the highest animal dose with no observed harm. | The other Phase 1 anchor. |
| **Caco-2 / MDCK-MDR1** | Cell lines used to measure intestinal permeability and efflux. | Yee 1997 bins drive bioavailability `F` in Stage 8. |
| **F (bioavailability)** | The fraction of an oral dose that actually reaches systemic circulation. | Stage 8 dose calc. |

### AI / ML models in L2

| Model | What it is | Where in L2 |
|---|---|---|
| **ESM-2** | Meta AI's protein language model. Reads an amino-acid sequence and outputs a learned vector ("embedding") that captures structural/functional properties. | Stage 1 druggability + Stage 3 affinity. |
| **Embedding** | A fixed-length numeric vector that represents a complex object (protein, molecule) in a way ML can use. | ESM-2 output; Morgan FP plays a similar role for molecules. |
| **DeepDTA** | A deep-learning architecture for Drug-Target binding Affinity prediction. | Stage 3 ML pKd. |
| **GBM** | Gradient-Boosted Machine — a tree-based ML regressor. | Stage 3 affinity head. |
| **GNN** | Graph Neural Network — a model that treats molecules as graphs of atoms + bonds. | ADMET-AI / Chemprop, BayeshERG. |
| **Chemprop** | A GNN architecture from MIT, widely used for molecular property prediction. | Stage 3 ADMET-AI uses it. |
| **ADMET-AI** | Pretrained Chemprop bundle covering 41 ADMET endpoints. | Stage 3. |
| **Random Forest** | Ensemble of decision trees; classic, interpretable ML. | Stage 4 hERG classifier. |
| **Druggability** | The probability that a protein has a pocket suitable for a small-molecule drug. | Stage 1 output. |

### Reference papers / datasets

| Reference | What it is | Used for |
|---|---|---|
| **Davies & Morris 1993** | Canonical paper of human/rodent organ weights and blood flows. | Stage 6 PBPK constants. |
| **Obach 2008** | Reference dataset of in vitro → in vivo clearance scaling factors. | Stage 6 / Stage 8. |
| **Yee 1997** | Caco-2 permeability bins → bioavailability. | Stage 8. |
| **Bickerton 2012** | Original QED paper. | L1 Step 6. |
| **Ertl & Schuffenhauer** | Original SA-score paper. | L1 Step 6. |
| **FALSIFIER_REGISTRY** | Our internal pre-registered list of falsifier predicates. | Stage 9. |

---

## Layer 3 — Animal Cohort

Layer 3 simulates an animal study (rodent / non-rodent) using the L2 directive.

| Term | Meaning | Where it shows up |
|---|---|---|
| **Cohort** | A group of animals (or later, patients) treated the same way. | The unit of L3 simulation. |
| **PK study** | Pharmacokinetics study — measure drug concentration vs time after dosing. | L3 core output. |
| **PKPD** | PK + PD coupled — concentration *and* effect. | L3 advanced output. |
| **TK / Toxicokinetics** | PK done at toxicity-relevant high doses. | L3 safety arm. |
| **Allometric body-weight scaling** | Same idea as in L2, applied here to design rodent dosing. | L3 dose builder. |
| **Inter-species variability** | The natural rodent-to-rodent (and species-to-species) spread in PK/PD. | Modeled as draws around L2 means. |
| **PCLS** | Precision-Cut Liver Slices — ex vivo tissue used for hepatic clearance measurement. | Mentioned in handoff doc; L3 ex vivo arm. |
| **Liver chip** | A microfluidic device culturing liver cells under flow. | Same role; modern alternative to PCLS. |
| **NOAEL** *(repeat)* | Highest dose with no adverse findings. | L3 → L4 anchor. |
| **HED (Human Equivalent Dose)** | Animal dose translated to humans by body-surface-area scaling. | L3 → L4 conversion. |

The L3 result feeds L4 as a `PreClinicalPackage` (the contract object the FIH planner now consumes).

---

## Layer 4 — First-In-Human / Phase 1 Planner

Layer 4 plans the first human trial. It now embeds the Phase 1 Planner from `hakase-clinical`.

| Term | Meaning | Where it shows up |
|---|---|---|
| **FIH (First In Human)** | The very first time a drug is given to people. The riskiest dose decision in pharma. | L4's whole job. |
| **Phase 1** | First clinical phase, usually 20–80 healthy volunteers, dose-escalating, primary endpoint = safety. | The trial L4 designs. |
| **MABEL** *(repeat)* | Minimum dose expected to produce *any* biological effect. | Conservative starting-dose anchor. |
| **NOAEL → HED → Starting dose** | The standard chain: animal NOAEL → human equivalent → divide by safety factor (often 10–100×). | L4 dose builder. |
| **SAD / MAD** | Single Ascending Dose / Multiple Ascending Dose — Phase 1 design templates. | L4 escalation builder. |
| **3+3 / accelerated titration / BLRM** | Standard Phase 1 escalation rules. (BLRM = Bayesian Logistic Regression Model.) | L4 escalation policies. |
| **Stopping rules** | Pre-defined criteria that halt escalation (e.g. AE rate, PK exceeds threshold). | Encoded in the planner. |
| **AE / SAE / DLT** | Adverse Event / Serious AE / Dose-Limiting Toxicity. | Phase 1 safety dictionary. |
| **IND** | Investigational New Drug application — the FDA filing that lets you start Phase 1. | The doc the planner is meant to support. |
| **§8** | Section 8 of the IND nonclinical/preclinical package — the upstream import card we explicitly hide in embedded mode. | UI element gated by `embedded` prop. |
| **PreClinicalPackage** | Our v1 contract object that bundles L1–L3 evidence into the input the planner needs. | Built in `preClinicalPackage.ts`; consumed by `Phase1Planner`. |

---

## AI Service (Python backend)

A FastAPI server (`artifacts/ai-service`) that wraps every model that's too heavy for the browser.

| Term | Meaning | Where used |
|---|---|---|
| **FastAPI** | A Python web framework for building API endpoints quickly with type validation. | The whole AI service. |
| **Uvicorn** | The async server that runs FastAPI. | Process started by the workflow. |
| **PyTorch** | Deep-learning framework. | Underpins ESM-2, Chemprop, BayeshERG. |
| **Lightning** | A higher-level wrapper over PyTorch that handles training/prediction loops. | Used by ADMET-AI internally. |
| **scikit-learn** | Classical ML library (RandomForest, GBMs). | Stage 4 hERG model. |
| **HTTP endpoints** | Each model is exposed as a POST endpoint, e.g. `/predict/binding-ml`, `/predict/admet-ml`, `/predict/dili-ml`, `/predict/properties`, `/dock/vina`, `/fep/ties`, `/predict/druggability`. | Frontend calls these from L2 stages. |

### Model zoo currently deployed

| Endpoint | Backed by | Purpose |
|---|---|---|
| `/predict/properties` | RDKit | Server-side descriptors. |
| `/predict/binding` | Heuristic baseline | Quick affinity sanity check. |
| `/predict/binding-ml` | DeepDTA-style GBM | L2 Stage 3 ML pKd. |
| `/predict/admet-ml` | ADMET-AI (Chemprop) | L2 Stage 3 ADMET vector. |
| `/predict/solubility-ml` | ML solubility head | Aqueous solubility. |
| `/predict/dili-ml` | DILI ML model | Hepatotoxicity. |
| `/predict/druggability` | ESM-2 + logistic head | L2 Stage 1. |
| `/dock/vina` | AutoDock Vina + OpenBabel | L2 Stage 2 docking. |
| `/fep/ties` | OpenMM + TIES → RunPod | L2 Stage 5 FEP. |

---

## Frontend stack

| Term | Meaning | Where used |
|---|---|---|
| **React** | UI library. | All frontend artifacts. |
| **TypeScript** | JavaScript with static types. | All frontend code. |
| **Vite** | Frontend dev server + build tool. | Dev workflows. |
| **HMR (Hot Module Replacement)** | Live-reloads only the changed file without full page refresh. | Vite feature; shows up in console as `[vite] hot updated`. |
| **Radix UI** | Headless component library (Dialog, Dropdown, Tabs…). | Underlies our Dialogs in `Phase1Planner`. |
| **Tailwind** | Utility-first CSS framework. | All styling. |
| **shadcn/ui** | Tailwind + Radix component recipes. | Our `components/ui/*`. |
| **Lucide** | Icon set. | All icons. |
| **pnpm workspace** | Monorepo package manager. | The whole `artifacts/*` layout. |
| **Artifact** | Our term for a deployable sub-app inside the monorepo (e.g. `hakase-ai`, `hakase-clinical`, `ai-service`). | Listed in the artifact registry. |

---

## How the pieces connect (one-paragraph version)

A user types a **SMILES**. The browser uses **RDKit-JS** to derive properties → **L1** scores ADMET, picks a target (**UniProt ID**), estimates Ki/Kd → emits an `InVitroPackage`. **L2** ingests that, locks it with an **EvidencePointer**, then calls the **AI service**: ESM-2 for druggability, AutoDock Vina against an RCSB **PDB** for docking, ADMET-AI + a binding GBM for ML cross-checks, a hERG Random Forest for cardiac risk, optionally **TIES FEP** on **RunPod** for refined ΔΔG. The browser then runs **PBPK** (RK4 ODE) and a **Hill** PD model to get Cmax/AUC and **receptor occupancy**, computes **safety margins**, and assembles a `PreConfirmationDirective` with **Falsifiers** drawn from the registry. **L3** consumes that directive to simulate an animal **cohort**, returning **NOAEL**, allometric **HED**, and PK/PD distributions packaged as a `PreClinicalPackage`. **L4** takes the package straight into the embedded **Phase 1 Planner**, which derives **MABEL**/NOAEL-anchored starting doses, an SAD/MAD escalation, and pre-registered **stopping rules** for the **IND**. Every step is **HAIOps**-logged and tied back to its `EvidencePointer`, so any later failure can be traced to the exact upstream prediction that allowed it.
