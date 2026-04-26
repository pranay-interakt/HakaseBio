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

#### Source-Quality Scoring & Cascade Gate (context-independent foundation)
Every L1 output is tagged with a `Quality` record (`artifacts/hakase-ai/src/lib/sourceQuality.ts`) carrying a tier — `experimental` (1.0) / `enriched` (0.7) / `heuristic` (0.3) / `inferred` (0.1) — plus optional ChEMBL measurement payload (n, distinctCompounds, range_nM, geometricMean_nM, species, assayTypes, assayFormats, derived confidence). The API route `GET /api/chembl/similar-targets/v2` (`artifacts/api-server/src/routes/chembl.ts`) aggregates the full payload per target; v1 is preserved for back-compat. The frontend client `chemblTargetLookup.ts` calls v2 first and falls back to v1. Each `TargetSuggestion` (`targetSuggestion.ts`) carries a `quality` field, and the L1 target-suggestion cards render n / range / dominant assay type / species and gray-out the card with "Insufficient data — exploratory" when `shouldSuppressEstimate` returns true. The cascade gate (`artifacts/hakase-ai/src/lib/cascadeGate.ts`) enforces three rules before L1→L2 auto-cascade is permitted: (a) compound is not NO-GO, (b) every safety-critical output (hERG, hepatotoxicity, bioactivation, CYP panel) meets minimum quality ≥ 0.6, and (c) average non-safety quality ≥ 0.6. The `evaluateCascadeGate` memo in `HakaseAI.tsx` drives a Stage-Gate banner inside the L1→L2 Cascade Preview section that either confirms auto-cascade, or shows blocked outputs and exposes an "Override & advance to L2" button which logs to the HAIOps provenance trail via `recordCascadeOverride` + `addOverride`. **Constraint**: `safetyFlags.ts` and `HAIOps.tsx` are not modified by this feature — gate logic is layered on top through provenance overrides only.

#### Enhanced AI Analysis Panel (`LayerAiPanel`)
Each layer (L1/L2/L3) has an AI Analysis panel with:
- **Pre-analysis data summaries**: L1 shows ADMET radar chart + target auto-match explanation + key metrics (IC50, Caco-2, hERG). L2 shows PK curve preview + clinical PK bars (Cmax, t½, responder %). L3 shows success probability gauge + trial metrics (power, p-value).
- **Safety Flag Gate**: Expandable `AiSafetyGate` component showing all safety flags (critical/major/warning severity) with ICH references and review acknowledgment button. Shows "clear to proceed" when no flags exist.
- **AI Report**: Claude-powered deep interpretation streamed via `/api/bio-analysis` endpoint with structured sections (overview, safety, target engagement, competitive context, etc.).

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
-   **Drug-Target Interaction** (`POST /api/ai/binding`): Three-path predictor — (1) curated pharmacophore QSAR for known reference targets EGFR/BRAF/BCL2/COX2/HDAC when target_id matches; (2) **real ChEMBL similarity-based prediction** with measured pIC50, UniProt accession, gene name, and PDB structure IDs (via `/api/chembl/similar-targets` route which aggregates activities from compounds ≥70% Tanimoto-similar, filters to protein targets via target-detail metadata, enriches via UniProt cross-references); (3) explicit empty result with status metadata when ChEMBL is unreachable — never fabricates predictions from a hardcoded list.
-   **Protein Analysis** (`POST /api/ai/protein`): UniProt + AlphaFold integration, amino acid composition, secondary structure prediction, druggability assessment.
-   **Full Pipeline** (`POST /api/ai/full-pipeline`): Runs all four modules in one call.
-   Frontend client library: `artifacts/hakase-ai/src/lib/aiService.ts`
-   Uses: Python 3.11, FastAPI, RDKit (full), scikit-learn, numpy, pandas

#### ML-Enhanced Predictions (Pre-Trained Models)
First wave of pre-trained ML models from the `HakaseAI Pre-Trained Model Integration Roadmap`. These run alongside the existing QSPR/heuristic engines and follow the graceful-degradation principle: if the ML model fails to load, the heuristic remains the primary signal.
-   **ADMET-AI** (`POST /api/ai/admet-ml`): Open-source Chemprop-RDKit GNN ensemble (MIT license, github.com/swansonk14/admet_ai) trained on the TDC ADMET benchmark. Returns 100+ endpoints (41 ADMET + ~60 physchem) including Caco2_Wang, HIA_Hou, Pgp_Broccatelli, BBB_Martins, PPBR_AZ, VDss_Lombardo, all 5 major CYP inhibitions (1A2/2C9/2C19/2D6/3A4), Clearance_Hepatocyte_AZ, Half_Life_Obach, hERG, AMES, DILI, LD50_Zhu, Carcinogens_Lagunin, ClinTox, Skin_Reaction. Response includes a flat `endpoints` map plus a curated `structured` view grouped into absorption/distribution/metabolism/excretion/toxicity buckets.
-   **Lazy loading**: Model weights load on first request (~30s cold start, ~200ms warm inference). Service starts instantly; the load is amortized across the session.
-   **Status & warmup endpoints**: `GET /api/ai/models/status` reports which ML models are loaded; `POST /api/ai/models/warmup` force-loads them (use after deploy).
-   **Frontend integration**: `predictAdmetMl(smiles)`, `getModelStatus()`, `warmupModels()`, and `mlBadgeFromSource()` helpers in `aiService.ts`. The result envelope includes `source: "ml" | "fallback"` so UI can show an "ML-Enhanced" vs "Heuristic Only" badge.
-   **Implementation**: `artifacts/ai-service/models/admet_ml.py` (singleton, thread-safe), surfaced through `main.py` and proxied through `api-server/routes/ai-service.ts`.
-   **L1 UI integration**: New `MlAdmetCard` component (`artifacts/hakase-ai/src/components/MlAdmetCard.tsx`) is wired as the **default tab** ("ML-Enhanced") inside `Layer1Results` in `HakaseAI.tsx`. It auto-fires `predictAdmetMl(smiles)` on SMILES change, renders a 5-axis ML-vs-Heuristic comparison (with Δ deltas), highlights critical safety endpoints (hERG/AMES/DILI/ClinTox/Carcinogens/Skin) with Low/Moderate/High risk tones, and lists every ML endpoint grouped by ADMET bucket. The card surfaces an "ML-Enhanced" badge on success, an "ML inference unavailable" amber banner on fallback, and a red "ML service unavailable" banner on transport errors — heuristic ADMET in the existing tabs (Dose-Response/Permeability/Clearance/Safety/Mechanism/Bioactivation) is unchanged and remains accessible.
-   **Deferred for follow-up tasks**: CardioTox (P1, dedicated hERG model), DeepDTA (P1, structure-aware binding affinity using UniProt sequences), PIDGINv4 (P1, expand target prediction from 29 → 2,700+), ChemBERTa-2 (P0 foundation embeddings), RAscore (P3, retrosynthesis accessibility).

## External Dependencies

-   **ChEMBL**: Used for compound identification, multi-target bioactivity fetching, target lookups, and PD parameter retrieval. Accessed via `@workspace/api-server/src/routes/chembl.ts` proxy.
-   **BindingDB**: Accessed via `@workspace/api-server/src/routes/bindingdb.ts` CORS proxy.
-   **openFDA (FAERS, Drugs@FDA, Drug Labels)**: Integrations with `https://api.fda.gov` for adverse event reporting, drug approval information, and boxed warning detection. Used by `RegulatoryInsightCard` and `lib/faersApi.ts`.
-   **Anthropic (Claude AI)**: Integrated via Replit Anthropic integration (`@workspace/integrations-anthropic-ai`) for AI-driven bio-analysis reports, accessed via `POST /api/bio-analysis`.