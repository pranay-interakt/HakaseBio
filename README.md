# Hakase BioTwin Preclinical Digital Twin Platform

Hakase BioTwin is a state-of-the-art, full-stack preclinical digital twin simulation platform. It integrates advanced physical chemistry analysis, structural mutagenicity scans, 3D molecular visualization, ex vivo safety assays, and high-fidelity Machine Learning model predictions (Graph Neural Networks and Random Forests) to profile drug candidates and evaluate regulatory IND readiness.

---

## 🏗️ Platform Architecture

The system is organized as a multi-tier microservice architecture:

```mermaid
graph TD
    A[React Client / Vite] -- API requests --> B[Express API Gateway]
    B -- /api/ai/* --> C[Python AI/ML Service]
    C -- Real ML Predictions --> D[(Morgan FP / Chemprop GNN)]
    C -- RDKit Descriptors --> E[Physchem Engine]
```

### 1. **Frontend: React Application (`/artifacts/hakase-ai`)**
*   Built with React, Vite, TypeScript, and TailwindCSS.
*   Uses a dark-mode glassmorphic design system for a premium scientific look.
*   Integrates `3Dmol.js` for real-time 3D structural protein-ligand viewer interaction.
*   Communicates with the API gateway using relative endpoints (e.g. `/api/auth/*`, `/api/ai/*`), fully proxied in development mode.

### 2. **API Gateway & Auth: Express Server (`/artifacts/api-server`)**
*   Built with Express, TypeScript, and Drizzle ORM (PostgreSQL).
*   Implements a production-grade security suite:
    *   **Double-Submit CSRF Protection:** Powered by `csrf-csrf` bound to the signed session identifier (refresh token / IP) to prevent cross-site request forgery without session state bloat.
    *   **JWT Authentication Cycle:** Sliding-session token verification with access tokens in memory and signed HTTP-only refresh cookies.
    *   **Lockout and Protection:** Account lockouts on successive failed attempts, security notification emails on new device logins, and CIDR-based IP allowlists.

### 3. **AI/ML Engine: Python Service (`/artifacts/ai-service`)**
*   Powered by FastAPI, RDKit, SciPy, and Scikit-Learn.
*   Performs structural pharmacophore scans (Ames mutagens, DILI risks, hERG block indicators).
*   Consists of three primary production-ready machine learning engines:
    *   **DILI-ML:** A Random Forest classifier trained on the FDA DILIrank dataset ($n=475$ compounds) utilizing Morgan fingerprints and RDKit descriptors.
    *   **CardioTox ML (DeepHIT):** A Random Forest model trained on ChEMBL ($n=655$ assays) to predict hERG channel blocking probabilities.
    *   **ADMET-AI:** A pre-trained deep Graph Neural Network (**Chemprop GNN ensemble**) predicting 41 endpoints directly from molecular structure.

---

## 🛠️ Developer Guide & Startup Instructions

Follow these instructions to clone, configure, migrate, and run the Hakase BioTwin platform locally.

### 1. **Prerequisites**
Ensure you have the following software installed on your machine:
*   **Node.js** (v20 or higher)
*   **pnpm** (v10+; Workspace package manager; do not use `npm` or `yarn`)
*   **Python** (v3.11 or higher)
*   **uv** (Fast Python package installer and resolver)
*   **PostgreSQL** (Local or remote running instance)
*   **Git & Git LFS** (Required for storing model weights and large datasets)

Initialize Git LFS and pull model weights after cloning:
```bash
git lfs install
git lfs pull
```

---

### 2. **Environment & Security Configuration**

#### Step A: Configure the Repository Root `.env`
1. Copy the reference configuration template:
   ```bash
   cp .env.example .env
   ```
2. Open the `.env` file and configure your Postgres database credentials:
   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/hakase_bio
   ```
3. Generate secure secrets using `openssl rand -base64 48` and populate:
   *   `JWT_ACCESS_SECRET`
   *   `JWT_REFRESH_SECRET`
   *   `COOKIE_SECRET`
   *   `CSRF_SECRET`

#### Step B: Dev Mode vs. Production Security Policies
*   **Rate Limits:**
    *   **Production:** Strict limits are enforced per IP (10 auth requests/min, 120 API requests/min).
    *   **Development:** Automatically relaxed (1000 auth requests/min, 2000 API requests/min) to prevent developer blocks during hot-reloads and UI iterations.
*   **Email Deliverability:**
    *   **Production:** Expects a valid `RESEND_API_KEY` to send verification links.
    *   **Development:** Bypasses email-sending failures gracefully. It prints the verification URLs directly to the terminal console (`>>> DEVELOPMENT LINK: ... <<<`), allowing you to complete verification without an active email gateway.

---

### 3. **Installation & Virtual Environment Setup**

#### Step A: Install Node.js Workspace Dependencies
From the repository root, install all monorepo dependencies:
```bash
pnpm install
```

#### Step B: Initialize the Python Virtual Environment
Sync dependencies using `uv` to align Python packages cleanly:
```bash
# Create the virtual environment
uv venv .venv

# Sync dependencies based on requirements
uv sync
```
*(If you do not use `uv`, run `.venv/bin/pip install -r pyproject.toml`)*

---

### 4. **Database Setup & Schema Sync**

1. Create the PostgreSQL database:
   ```bash
   createdb hakase_bio
   # Or via psql: psql -c "CREATE DATABASE hakase_bio;"
   ```
2. Apply the Drizzle migrations to push schemas:
   ```bash
   pnpm --filter @workspace/db run push
   ```
3. Compile the TS declarations for the database package:
   ```bash
   pnpm typecheck:libs
   ```

#### 💡 Bypass Email Verification & Force Admin (Optional Dev Shortcut)
If you register a user locally and want to make them verified and an administrator instantly without using verification links:
```bash
psql postgresql://username:password@localhost:5432/hakase_bio -c "UPDATE users SET status = 'active', role = 'admin', email_verified_at = NOW() WHERE email = 'your-email@domain.com';"
```

---

### 5. **Starting the Services (Local Dev)**

Run **two processes** concurrently. We recommend using separate terminal windows.

#### 🖲️ Terminal 1: Backend Orchestrator
From the repository root, start the single-command backend supervisor. If you are running **Ersilia (local mode)**, prepend your virtual environment's binary directory to the `PATH`:

*   **Linux / macOS**:
    ```bash
    PATH=".venv/bin:$PATH" pnpm run backend:dev
    ```
*   **Windows (Command Prompt)**:
    ```cmd
    set PATH=.venv\Scripts;%PATH% && pnpm run backend:dev
    ```
*   **Windows (PowerShell)**:
    ```powershell
    $env:PATH=".venv\Scripts;$env:PATH"; pnpm run backend:dev
    ```

The orchestrator manages:
*   **Express API Gateway:** listening on `http://localhost:3000`
*   **FastAPI AI/ML Service:** listening on `http://localhost:8090`
*   **Model Warm-Up & Hot-Reloads:** Automatically pre-warms DILI, hERG, Ames, and Binding-ML models.

#### 🎨 Terminal 2: Vite React Frontend
From the repository root, start the frontend developer server:
```bash
pnpm run frontend:dev
```
*   **Vite Dev Server URL:** `http://localhost:5173`
*   Vite config automatically proxies all requests targeting `/api/*` to the gateway on port `3000`.

---

### 6. **Running in Production Mode (Single-Port Hosting)**

For hosting the app in production (e.g. Docker, VM, AWS, or Render):
1.  **Build and Start:** Run the build/start command to compile frontend and backend assets:
    ```bash
    PATH=".venv/bin:$PATH" pnpm start
    ```
2.  **Access App:** The Express API server on port `3000` serves the React UI statically. Access the application directly at **`http://localhost:3000`** (only expose port `3000` to the internet).

---

## 🧪 Health Checks & Troubleshooting

Verify service connectivity using these health endpoints:

1.  **AI/ML Service Health check:**
    ```bash
    curl -s http://localhost:8090/health
    # Expect: {"status":"ok","service":"HakaseAI AI Service","version":"1.0.0"}
    ```
2.  **API Server Gateway Health check:**
    ```bash
    curl -s http://localhost:3000/api/health
    # Expect: {"status":"ok"}
    ```
3.  **Vite Dev Proxy Health check:**
    ```bash
    curl -s http://localhost:5173/api/ai/health
    # Expect: {"status":"ok","service":"HakaseAI AI Service","version":"1.0.0"}
    ```
