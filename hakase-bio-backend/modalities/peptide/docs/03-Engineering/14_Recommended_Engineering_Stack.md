# HakaseAI Peptide Discovery Platform
## Recommended Engineering Stack

## Purpose

This document lists the recommended software stack for implementing the Version 3 architecture of the HakaseAI Peptide Discovery Platform. The selected tools provide a practical starting point for development while keeping the architecture technology-independent and allowing individual scientific models to be replaced in the future.

---

# Layer 1 – Platform Infrastructure

| Component | Recommended Tool | Why it is Needed |
|------------|-----------------|------------------|
| API Server | **FastAPI** | Provides a fast, modern REST API for communication between the frontend and backend. |
| Workflow Orchestrator | **Prefect** | Coordinates the execution order of all scientific services and manages dependencies. |
| Job Scheduler | **Celery + Redis** | Executes long-running scientific jobs asynchronously without blocking user requests. |
| Model Registry | **MLflow** | Tracks model versions, metadata, and reproducibility for all prediction models. |
| Resource Manager | **SQLAlchemy + HTTP Clients** | Provides standardized access to internal databases and external biological resources. |
| Evidence Bus | **RabbitMQ / Redis Streams** | Enables communication between independent scientific services using standardized evidence objects. |
| Logging | **Loguru** | Produces structured logs for debugging and system monitoring. |
| Audit Database | **PostgreSQL** | Stores execution history, prediction metadata, and reproducibility records. |
| Monitoring | **Prometheus + Grafana** | Monitors system health, resource utilization, and service performance. |
| Containerization | **Docker** | Packages every service into isolated and reproducible execution environments. |
| Deployment | **Docker Compose (initial), Kubernetes (future)** | Simplifies deployment today while enabling future scalability. |

---

# Layer 2 – Scientific Services

## 1. Physicochemical Service

| Module                 | Recommended Tool   | Why it is Needed                                                                                |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| Sequence Processing    | **Biopython**      | Parses, validates, and manipulates peptide sequences.                                           |
| Descriptor Calculation | **ProtParam**      | Computes molecular weight, pI, charge, instability index, and other physicochemical properties. |
| Molecular Descriptors  | **RDKit**          | Generates molecular descriptors and supports chemically modified peptides.                      |
| Feature Generation     | **ESM-2 / ProtT5** | Produces protein embeddings for downstream machine learning models.                             |
| Numerical Processing   | **NumPy + Pandas** | Performs efficient numerical computation and feature manipulation.                              |

---

## 2. Structural Biology Service

| Module               | Recommended Tool             | Why it is Needed                                                    |
| -------------------- | ---------------------------- | ------------------------------------------------------------------- |
| Structure Prediction | **Boltz-2**                  | Predicts peptide tertiary structures and peptide–protein complexes. |
| Structure Handling   | **Biopython PDB**            | Reads, writes, and manipulates structural PDB files.                |
| Structural Analysis  | **MDTraj / MDAnalysis**      | Computes structural properties and molecular interactions.          |
| Visualization        | **Mol\*** / **py3Dmol**      | Displays interactive 3D molecular structures.                       |
| Docking (Optional)   | **AutoDock Vina / DiffDock** | Predicts peptide binding poses against biological targets.          |

---

## 3. Functional Analysis Service

| Module                     | Recommended Tool       | Why it is Needed                                                         |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| Protein Embeddings         | **ESM-2**              | Generates deep sequence representations for functional prediction.       |
| Similarity Search          | **FAISS**              | Performs fast nearest-neighbor searches over peptide databases.          |
| Deep Learning              | **PyTorch**            | Implements neural network models for biological activity prediction.     |
| Classical Machine Learning | **XGBoost / LightGBM** | Provides efficient predictive models for structured biological features. |
| Sequence Alignment         | **MMseqs2 / BLAST**    | Identifies homologous peptides and known functional analogues.           |
| Workflow Selection         | **Python Rule Engine** | Chooses the appropriate prediction pipeline based on peptide modality.   |

---

## 4. Developability Service

| Module                       | Recommended Tool         | Why it is Needed                                                     |
| ---------------------------- | ------------------------ | -------------------------------------------------------------------- |
| Aggregation Prediction       | **Aggrescan3D**          | Predicts aggregation propensity affecting formulation and stability. |
| Solubility Prediction        | **Protein-Sol**          | Estimates peptide solubility for pharmaceutical development.         |
| Stability Prediction         | **FoldX**                | Evaluates structural stability where applicable.                     |
| Protease Cleavage Prediction | **PROSPERous**           | Predicts enzymatic degradation sites affecting peptide half-life.    |
| Manufacturability Assessment | **Custom Python Engine** | Evaluates synthesis complexity and engineering feasibility.          |

---

## 5. Safety Service

| Module                    | Recommended Tool | Why it is Needed                                                  |
| ------------------------- | ---------------- | ----------------------------------------------------------------- |
| Immunogenicity Prediction | **NetMHCpan**    | Predicts peptide binding to MHC molecules.                        |
| Epitope Prediction        | **IEDB Tools**   | Identifies potential immune epitopes.                             |
| Toxicity Prediction       | **ToxinPred2**   | Estimates peptide toxicity using trained machine learning models. |
| Hemolysis Prediction      | **HemoPI**       | Predicts red blood cell lysis potential.                          |
| Allergenicity Prediction  | **AllerTOP**     | Estimates the likelihood of allergenic responses.                 |

---

# Layer 3 – Decision & Validation

| Component | Recommended Tool | Why it is Needed |
|------------|-----------------|------------------|
| Evidence Models | **Pydantic** | Defines standardized evidence objects with strict validation. |
| Decision Engine | **Custom Python Rules** | Implements transparent GO / Conditional GO / NO-GO decision logic. |
| Confidence Scoring | **NumPy** | Computes weighted confidence scores across evidence sources. |
| Schema Validation | **JSON Schema** | Ensures all evidence objects follow a standardized format. |

---

# Layer 4 – Presentation & Reporting

| Component           | Recommended Tool        | Why it is Needed                                                                       |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| Frontend            | **React + TypeScript**  | Builds an interactive and scalable user interface.                                     |
| Backend API         | **FastAPI**             | Serves processed results to the frontend.                                              |
| 3D Molecular Viewer | **Mol\***               | Displays interactive peptide and protein structures.                                   |
| Charts              | **Plotly**              | Visualizes prediction scores and evidence summaries.                                   |
| Data Tables         | **AG Grid**             | Efficiently displays structured scientific data.                                       |
| Report Generation   | **Jinja2 + WeasyPrint** | Produces downloadable PDF reports from templates.                                      |
| LLM Integration     | **GPT / Claude**        | Generates human-readable summaries while remaining outside scientific decision making. |

---

# External Scientific Resources

| Database | Purpose |
|----------|---------|
| **UniProt** | Protein sequence and functional annotation. |
| **Protein Data Bank (PDB)** | Experimentally determined protein structures. |
| **AlphaFold Database** | Predicted protein structures. |
| **ChEMBL** | Bioactivity and drug discovery information. |
| **PubChem** | Chemical compound information. |
| **IEDB** | Immune epitope data and prediction resources. |
| **PeptideAtlas** | Experimentally observed peptide datasets. |
| **SATPdb** | Therapeutic peptide database. |
| **DBAASP** | Antimicrobial peptide database. |
| **APD3** | Antimicrobial peptide repository. |

---

# Core Machine Learning Stack

| Tool | Purpose |
|------|---------|
| **PyTorch** | Deep learning framework for scientific prediction models. |
| **XGBoost** | Gradient boosting models for structured biological features. |
| **ESM-2** | Protein language model for sequence embeddings. |
| **FAISS** | High-speed similarity search over peptide embeddings. |
| **MLflow** | Tracks model versions, experiments, and reproducibility. |

---

# Summary Architecture

```
Frontend (React)
        │
        ▼
FastAPI Backend
        │
        ▼
Prefect Workflow Orchestrator
        │
        ▼
Celery Workers
        │
        ▼
Scientific Services
 ├── Physicochemical
 ├── Structural Biology
 ├── Functional Analysis
 ├── Developability
 └── Safety
        │
        ▼
Evidence Objects
        │
        ▼
Decision Engine
        │
        ▼
Presentation & Reporting
```

---

## Engineering Philosophy

- Infrastructure manages execution—not scientific computation.
- Scientific services generate standardized evidence.
- Services communicate only through Evidence Objects.
- Decision logic is deterministic and fully explainable.
- Presentation layers never modify scientific evidence.
- Individual scientific models can be replaced without changing the platform architecture.
- Every prediction is version-controlled, traceable, and reproducible.
