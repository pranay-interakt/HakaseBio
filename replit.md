# HakaseAI — BioDigital Twin Platform

## Overview
HakaseAI is a BioDigital Twin Platform designed to simulate drug discovery and development across four layers: In Vitro, Animal Cohort, Patient Cohort, and Trial Digital Twin. The platform aims to accelerate drug development by providing comprehensive in-silico predictions and analyses. It integrates advanced computational chemistry, pharmacokinetic/pharmacodynamic modeling, and AI-driven insights to guide decision-making from compound identification to clinical trial design. The platform's vision is to reduce the time and cost associated with bringing new therapies to market by offering a robust, predictive, and data-driven approach to drug development.

## User Preferences
I prefer detailed explanations and for you to ask before making major changes. Do not make changes to the `artifacts/hakase-ai/src/pages/HAIOps.tsx` file. Do not make changes to the folder `artifacts/hakase-ai/src/lib/safetyFlags.ts`.

## System Architecture

### UI/UX Decisions
The platform features a dashboard (`HakaseAI.tsx`) with a dark color scheme (`bg-[#07080c]`) and uses the Inter font. Each simulation layer is color-coded: Violet for Layer 1 (In Vitro), Amber for Layer 2 (Animal Cohort), Blue for Layer 3 (Patient Cohort), and Emerald for Layer 4 (Trial Digital Twin). The logo is located at `@assets/image_1773504202272.png`. Routing is handled by `wouter`, with key routes including `/`, `/login`, `/dashboard`, and `/haiopsdna`.

### Technical Implementations
The project is a pnpm monorepo using TypeScript (v5.9) and Node.js (v24). The backend API server uses Express 5, PostgreSQL with Drizzle ORM, and Zod for validation. API codegen is handled by Orval from an OpenAPI specification. Frontend is a React + Vite SPA.

### Feature Specifications

#### Four-Layer Simulation Pipeline
1.  **In Vitro (Layer 1)**: Handles SMILES input, RDKit-based 2D SVG preview, auto ChEMBL compound identification, in vitro assay simulation (IC50, Caco-2, CYP panel, hERG, selectivity), directional ADMET, and 3D molecular viewing. Therapeutic Area selection dynamically influences simulation parameters.
2.  **Animal Cohort (Layer 2)**: Conducts in-silico PBPK modeling across 7 species/strain sets, predicts NOAEL/MTD, and projects First-In-Human (FIH) doses. The FIH dose from Layer 2 automatically populates the starting dose for Layer 3.
3.  **Patient Cohort (Layer 3)**: Simulates virtual patient populations, models PK/PD, incorporates FAERS data, and performs responder analysis.
4.  **Trial Digital Twin (Layer 4)**: Executes Monte Carlo simulations, supports adaptive trial designs, generates regulatory outputs, and includes a PROCOVA module for prognostic covariate adjustment.

#### HAIOps Framework
The HAIOps framework (`Healthcare AI Operations`) integrates safety and governance. It includes a Safety Flag Cascade engine (cardiac, hepatotoxicity, DDI, narrow-margin, high-grade-ae, subgroup-disparity) that propagates across all simulation layers. Overrides are logged, and provenance metadata (engine version, timestamp) is displayed.

#### Simulation Architecture
All simulation engines are browser-side. Key engines include:
-   `admet.ts`: Rule-based ADMET scoring, organ risk, toxicity alerts.
-   `cohortSim.ts`: Two-compartment PBPK, NHANES population variability, ChEMBL Emax PD, FAERS AE calibration.
-   `trialSim.ts`: Statistical power, Weibull survival, interim analyses, cost estimation.
-   `pbpk.ts`: RK4 ODE solver for two-compartment PBPK with allometric scaling.
-   `nhanes.ts`: Samples virtual patients based on NHANES 2017–2020 population distributions.
-   `pdModel.ts`: Fetches PD parameters from ChEMBL and computes Emax effects.

### System Design Choices
-   **Monorepo Structure**: `artifacts` for deployable apps, `lib` for shared libraries, `scripts` for utilities.
-   **TypeScript**: Extensive use with composite projects for improved type-checking and dependency management.
-   **Database**: PostgreSQL with Drizzle ORM for schema definition and interaction.
-   **API Design**: Express server with Zod for robust request/response validation.
-   **RDKit.js (MinimalLib)**: Used for molecular property calculations (`amw`, `CrippenClogP`, `lipinskiHBD`, `lipinskiHBA`, `tpsa`, `NumRotatableBonds`), pharmacophore detection, fingerprint generation, and similarity computation.
-   **Target Suggestion**: Two-tier approach using ChEMBL experimental data and RDKit SMARTS pharmacophore-based fallback.

### Python AI Service (`artifacts/ai-service/`)
A FastAPI-based Python backend service running on port 8090, proxied through the Node.js API server at `/api/ai/*`. Provides:
-   **ADMET Prediction** (`POST /api/ai/admet`): Full ADMET profiling — absorption (Caco-2, HIA, P-gp), distribution (BBB, PPB, Vd), metabolism (CYP inhibition, hepatic clearance), excretion (half-life), toxicity (LD50, hERG, Ames, DILI), and druglikeness (Lipinski, Veber, QED).
-   **Molecular Properties** (`POST /api/ai/properties`): Solubility, bioavailability, ionization, complexity, synthetic accessibility, lead/fragment-likeness assessment.
-   **Drug-Target Interaction** (`POST /api/ai/binding`): Pharmacophore matching + Tanimoto fingerprint similarity against 5 target profiles (EGFR, BRAF, BCL2, COX2, HDAC) with pIC50/IC50 estimates.
-   **Protein Analysis** (`POST /api/ai/protein`): UniProt + AlphaFold integration, amino acid composition, secondary structure prediction, druggability assessment.
-   **Full Pipeline** (`POST /api/ai/full-pipeline`): Runs all four modules in one call.
-   Frontend client library: `artifacts/hakase-ai/src/lib/aiService.ts`
-   Uses: Python 3.11, FastAPI, RDKit (full), scikit-learn, numpy, pandas

## External Dependencies

-   **ChEMBL**: Used for compound identification, multi-target bioactivity fetching, target lookups, and PD parameter retrieval. Accessed via `@workspace/api-server/src/routes/chembl.ts` proxy.
-   **BindingDB**: Accessed via `@workspace/api-server/src/routes/bindingdb.ts` CORS proxy.
-   **openFDA (FAERS, Drugs@FDA, Drug Labels)**: Integrations with `https://api.fda.gov` for adverse event reporting, drug approval information, and boxed warning detection. Used by `RegulatoryInsightCard` and `lib/faersApi.ts`.
-   **Anthropic (Claude AI)**: Integrated via Replit Anthropic integration (`@workspace/integrations-anthropic-ai`) for AI-driven bio-analysis reports, accessed via `POST /api/bio-analysis`.