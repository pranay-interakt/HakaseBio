# Chapter 1 — Introduction & Design Philosophy

---

# 1.1 Introduction

The discovery of peptide therapeutics has become increasingly dependent on computational methods capable of integrating molecular modeling, structural biology, machine learning, and bioinformatics into a unified decision-support workflow. While numerous computational tools exist for individual prediction tasks, most operate as isolated applications that require extensive manual interpretation and workflow integration.

The objective of the **HakaseAI Peptide Discovery Platform** is to provide a unified computational framework that standardizes peptide analysis, integrates heterogeneous scientific predictions, and produces transparent evidence-driven recommendations for peptide therapeutic development.

Rather than replacing experimental research, the platform is designed to accelerate early-stage discovery by identifying promising candidates, prioritizing experimental validation, and reducing the cost of iterative optimization.

This document defines the software architecture supporting that objective.

It describes the organization of the platform, the responsibilities of each computational component, the interaction between scientific services, and the principles governing future platform development.

It is intended to serve as the architectural reference for scientists, software engineers, machine learning engineers, and technical stakeholders involved in the implementation and maintenance of the HakaseAI peptide discovery platform.

---

# 1.2 Scope

This document defines the architecture of the computational peptide discovery platform.

The scope includes:

- overall platform architecture,

- infrastructure organization,

- scientific service architecture,

- evidence generation,

- decision framework,

- validation strategy,

- extensibility mechanisms.


The document intentionally focuses on architectural design rather than implementation details.

Items outside the scope of this document include:

- backend technology selection,

- programming languages,

- deployment infrastructure,

- API implementation,

- database schema,

- user interface design,

- model training procedures.


These implementation details are defined separately within the Engineering & Implementation Specification.

---

# 1.3 Design Objectives

The Version 3 architecture was developed around six primary objectives.

|Objective|Description|
|---|---|
|Scientific Integrity|Ensure that every computational result is supported by transparent scientific evidence.|
|Modularity|Separate computational responsibilities into independently maintainable services.|
|Reproducibility|Guarantee that every prediction can be reproduced using identical inputs and model versions.|
|Scalability|Enable future therapeutic modalities without architectural redesign.|
|Explainability|Ensure every recommendation can be traced back to supporting computational evidence.|
|Maintainability|Minimize coupling between scientific computation, infrastructure, and decision logic.|

These objectives guide every architectural decision described throughout this document.

---

# 1.4 Design Philosophy

Version 3 adopts a service-oriented architecture organized around **scientific capabilities rather than therapeutic modalities**.

Previous computational workflows often duplicated scientific analyses for each application area, resulting in redundant computation, inconsistent validation strategies, and increased maintenance complexity.

Version 3 instead separates the platform into independent computational services, each responsible for a single scientific domain.

For example:

- Physicochemical characterization

- Structural biology

- Functional analysis

- Developability assessment

- Safety assessment


Each service generates standardized scientific evidence without making therapeutic decisions.

This evidence is subsequently integrated by a centralized Decision Layer that evaluates the collective evidence and produces a transparent GO / Conditional GO / NO-GO recommendation.

This separation between **scientific computation** and **scientific decision making** represents the central architectural principle of the platform.

---

# 1.5 Architectural Principles

The architecture is governed by the following principles.

### 1. Single Responsibility

Each service performs one well-defined scientific or computational responsibility.

Scientific computation, workflow orchestration, decision making, and presentation remain independent components.

---

### 2. Evidence-Driven Computation

Every computational prediction generates standardized evidence.

No component is permitted to generate unexplained recommendations.

---

### 3. Transparency

Every recommendation must be traceable to its originating computational evidence, confidence estimates, and computational models.

No decision should rely on opaque intermediate reasoning.

---

### 4. Reproducibility

Every computational result must record sufficient metadata—including model version, software version, configuration, and execution environment—to enable complete reproduction.

---

### 5. Extensibility

Scientific capabilities should be added by introducing new services rather than modifying existing architectural components.

Future therapeutic modalities should reuse existing infrastructure wherever possible.

---

### 6. Technology Independence

The architecture specifies computational capabilities rather than specific software implementations.

Individual prediction models may therefore evolve without requiring architectural redesign.

---

# 1.6 AI Usage Philosophy

Artificial intelligence plays an important role within the HakaseAI platform; however, its responsibilities are intentionally constrained.

The platform distinguishes between three categories of computation:

|Category|Purpose|
|---|---|
|Deterministic Algorithms|Exact calculations such as molecular weight, charge, physicochemical descriptors, and sequence statistics.|
|Scientific Prediction Models|Machine learning and computational biology models used for structure prediction, functional prediction, developability analysis, and safety assessment.|
|Large Language Models|Report generation, evidence summarization, documentation, and user interaction.|

Large Language Models are **not** used to generate scientific evidence or therapeutic recommendations.

Instead, all scientific predictions originate from deterministic algorithms or benchmarked computational models.

LLMs operate exclusively as communication tools that explain evidence generated elsewhere within the platform.

This separation minimizes hallucination risk while preserving scientific transparency.

---

# 1.7 Intended Audience

This document is intended for:

- Computational biologists

- Bioinformaticians

- Machine learning engineers

- Backend software engineers

- Platform architects

- Technical project managers

- Research scientists


The document assumes familiarity with computational drug discovery and focuses on architectural design rather than introductory biological concepts.

---

# 1.8 Document Organization

The remainder of this document is organized as follows.

| Chapter   | Contents                                                                           |
| --------- | ---------------------------------------------------------------------------------- |
| Chapter 2 | Assessment of the previous computational architecture and motivation for redesign. |
| Chapter 3 | High-level Version 3 architecture and system organization.                         |
| Chapter 4 | Platform Infrastructure Layer.                                                     |
| Chapter 5 | Core Scientific Services.                                                          |
| Chapter 6 | Decision & Validation Framework.                                                   |
| Chapter 7 | Platform Extensibility and Architecture Summary.                                   |

Each chapter progressively refines the architecture from high-level design principles to individual computational responsibilities.

---



# Chapter 2 — Current Architecture Assessment

---

# 2.1 Overview

Before designing Version 3, the existing peptide discovery workflow was evaluated to determine whether its architecture could support long-term platform development.

Although the original pipeline successfully integrated several computational prediction tools into a functional workflow, the overall architecture had evolved around individual therapeutic workflows rather than reusable scientific capabilities.

As the platform expanded, this design introduced increasing complexity, duplicated computation, inconsistent validation strategies, and limited extensibility.

The objective of this assessment is not to evaluate the scientific validity of the individual prediction models, but rather the architectural organization of the platform that coordinates them.

---

# 2.2 Current Architecture

The previous implementation organized computation as a collection of modality-specific pipelines.

A simplified representation of the workflow is shown below.

```text
User Input
     │
     ▼
Modality-Specific Pipeline
     │
     ├── Physicochemical Analysis
     ├── Structural Prediction
     ├── Functional Prediction
     ├── Safety Assessment
     ├── Developability Assessment
     ▼
GO / NO-GO Recommendation
```

Each therapeutic modality maintained its own computational workflow, despite performing many identical scientific analyses.

As additional peptide applications were introduced, the number of independent pipelines increased proportionally.

---

# 2.3 Architectural Strengths

Despite its limitations, the existing architecture established several valuable foundations that are preserved in Version 3.

### Functional End-to-End Workflow

The platform successfully connected user inputs, computational analyses, and final recommendations into a complete discovery pipeline.

---

### Modular Prediction Models

Individual computational models remained largely independent, allowing them to be replaced or improved without affecting neighboring prediction components.

---

### Automated Candidate Evaluation

The platform reduced manual interpretation by integrating multiple computational analyses into a unified workflow.

---

### Practical Research Utility

The architecture demonstrated that computational evidence could effectively prioritize peptide candidates before experimental validation.

These strengths remain core objectives of Version 3.

---

# 2.4 Architectural Limitations

While scientifically functional, the original architecture exhibited several structural limitations that became increasingly significant as the platform expanded.

---

## Pipeline Duplication

Many therapeutic modalities repeated identical scientific computations.

For example,

```text
GLP-1 Pipeline

↓

Physicochemical Analysis

↓

Structure Prediction

↓

Safety Analysis
```

and

```text
Antimicrobial Pipeline

↓

Physicochemical Analysis

↓

Structure Prediction

↓

Safety Analysis
```

performed nearly identical computations using separate implementations.

This duplication increased maintenance effort and introduced unnecessary software complexity.

---

## Tight Coupling Between Components

Scientific computation, workflow execution, decision logic, and presentation were closely interconnected.

As a result,

modifying one component frequently required changes elsewhere in the pipeline.

This reduced maintainability and slowed platform evolution.

---

## Modality-Centric Design

The architecture was organized around therapeutic applications rather than reusable scientific capabilities.

Consequently,

adding a new peptide modality often required constructing an additional computational pipeline rather than reusing existing scientific analyses.

This approach does not scale efficiently as the number of supported therapeutic classes increases.

---

## Inconsistent Validation

Validation procedures were embedded within individual workflows.

Different pipelines therefore evaluated computational confidence using different strategies.

This reduced consistency across the platform and complicated future benchmarking.

---

## Limited Explainability

Although prediction models generated useful outputs, the relationship between individual predictions and the final GO / NO-GO recommendation was not always explicit.

Users could observe the final recommendation but had limited visibility into how different pieces of evidence influenced that decision.

---

## Infrastructure Embedded Within Scientific Workflows

Workflow execution, model coordination, logging, and computational management were mixed directly with scientific computation.

This blurred the distinction between software infrastructure and biological analysis, making both more difficult to maintain.

---

# 2.5 Root Causes

The limitations identified above originate from three fundamental architectural decisions.

---

## Pipeline-Oriented Design

The architecture was organized around complete therapeutic workflows.

While appropriate for early development, this resulted in repeated implementation of common scientific analyses.

The platform expanded by creating new pipelines rather than extending existing scientific capabilities.

---

## Absence of Standardized Evidence

Prediction models communicated directly with downstream components using model-specific outputs.

Without a standardized evidence representation, integrating multiple prediction models became increasingly difficult.

The final recommendation therefore depended heavily on workflow-specific implementation rather than a common evidence framework.

---

## Lack of Layer Separation

Scientific computation, infrastructure, decision making, and reporting were implemented within the same execution pipeline.

This violated separation of concerns and limited the independent evolution of individual platform components.

---

# 2.6 Design Requirements for Version 3

The architectural assessment directly defines the requirements for the redesigned platform.

Version 3 must therefore:

- eliminate duplicated scientific computation,

- organize computation around reusable scientific services,

- separate infrastructure from scientific analysis,

- standardize evidence generation,

- centralize decision making,

- propagate confidence transparently,

- support future therapeutic modalities without architectural redesign,

- maintain complete computational traceability.


These requirements form the design constraints for all subsequent architectural decisions.

---

# 2.7 Transition to Version 3

The objective of Version 3 is not to replace the scientific models already used within the platform.

Instead, Version 3 reorganizes those capabilities into a modular, layered architecture that separates computational infrastructure, scientific computation, evidence generation, decision making, and presentation.

The scientific capabilities remain largely unchanged.

The architecture governing their interaction changes fundamentally.

The following chapter introduces this redesigned architecture and describes how these design requirements are implemented within the HakaseAI Peptide Discovery Platform.

# Chapter 3 — Version 3 Architecture & System Organization

---

# 3.1 Overview

Version 3 reorganizes the HakaseAI Peptide Discovery Platform into a layered, service-oriented architecture that separates computational infrastructure, scientific computation, decision making, and presentation.

Unlike the previous pipeline-oriented implementation, Version 3 treats each scientific capability as an independent, reusable service. Rather than constructing separate computational pipelines for individual therapeutic modalities, the platform executes a common set of scientific services whose outputs are integrated through a centralized decision framework.

This organization minimizes duplicated computation while improving modularity, maintainability, and long-term scalability.

---

# 3.2 Architectural Overview

The platform consists of four primary architectural layers.

```text
                         USER
                           │
                           ▼
                  Input Validation
                           │
                           ▼
═══════════════════════════════════════════════
          Layer 1 – Platform Infrastructure
═══════════════════════════════════════════════
                           │
                           ▼
═══════════════════════════════════════════════
         Layer 2 – Scientific Services
═══════════════════════════════════════════════
                           │
                           ▼
═══════════════════════════════════════════════
      Layer 3 – Decision & Validation
═══════════════════════════════════════════════
                           │
                           ▼
═══════════════════════════════════════════════
      Layer 4 – Presentation & Reporting
═══════════════════════════════════════════════
```

Each layer performs a distinct responsibility and communicates only through standardized interfaces. This separation reduces software coupling while allowing scientific capabilities, infrastructure, and presentation components to evolve independently.

---

# 3.3 Layer Responsibilities

|Layer|Primary Responsibility|
|---|---|
|**Platform Infrastructure**|Coordinates workflow execution, resource management, logging, communication, and fault handling.|
|**Scientific Services**|Generate standardized scientific evidence describing peptide properties and predicted behavior.|
|**Decision & Validation**|Integrate evidence, evaluate confidence, validate consistency, and generate GO / Conditional GO / NO-GO recommendations.|
|**Presentation & Reporting**|Present computational results through reports, dashboards, and user interfaces without modifying scientific evidence.|

This layered organization enforces a clear separation between computation, reasoning, and communication.

---

# 3.4 High-Level Workflow

Every peptide analysis follows the same execution pathway.

```text
User Request
      │
      ▼
Input Validation
      │
      ▼
Platform Infrastructure
      │
      ▼
Scientific Services
      │
      ▼
Evidence Objects
      │
      ▼
Decision & Validation
      │
      ▼
GO / Conditional GO / NO-GO
      │
      ▼
Presentation Layer
```

Although individual therapeutic modalities may require different scientific models, every analysis follows this common architectural workflow.

---

# 3.5 Scientific Services

Version 3 organizes scientific computation into five reusable services.

|Service|Primary Responsibility|
|---|---|
|Physicochemical Service|Characterize intrinsic molecular and sequence properties.|
|Structural Biology Service|Predict peptide structure, peptide–target complexes, and structural interactions.|
|Functional Analysis Service|Predict modality-specific biological activity using computational models.|
|Developability Service|Evaluate pharmaceutical feasibility, stability, manufacturability, and formulation characteristics.|
|Safety Service|Assess computationally predictable safety liabilities, including immunogenicity and toxicity.|

Each service operates independently and generates a standardized Evidence Object for downstream interpretation.

Detailed descriptions of these services are provided in Chapter 5.

---

# 3.6 Evidence-Driven Architecture

Version 3 replaces direct communication between computational models with standardized evidence generation.

Rather than passing model-specific outputs between services, each Scientific Service produces a structured Evidence Object containing:

- prediction results,

- confidence estimates,

- originating model,

- model version,

- validation status,

- known limitations.


These evidence objects become the exclusive inputs to the Decision Layer.

This architecture improves traceability, simplifies integration, and enables independent validation of every scientific capability.

---

# 3.7 Separation of Responsibilities

One of the defining characteristics of Version 3 is the strict separation of computational responsibilities.

```text
Infrastructure
        │
        ├── Executes workflows
        ├── Manages computation
        └── Coordinates services

Scientific Services
        │
        ├── Generate evidence
        └── Never make decisions

Decision Layer
        │
        ├── Integrates evidence
        ├── Assigns confidence
        └── Generates GO / NO-GO

Presentation Layer
        │
        ├── Explains results
        └── Never modifies evidence
```

Each layer performs a single architectural role, minimizing dependencies between unrelated platform components.

---

# 3.8 Architectural Advantages

Compared with the previous pipeline-oriented implementation, Version 3 introduces several improvements.

### Scientific Advantages

- Reusable computational analyses.

- Standardized evidence generation.

- Independent benchmarking of scientific services.

- Transparent confidence propagation.


---

### Engineering Advantages

- Reduced code duplication.

- Independent service development.

- Simplified maintenance.

- Scalable workflow execution.

- Clear software boundaries.


---

### Platform Advantages

- Rapid addition of new therapeutic modalities.

- Consistent decision logic across applications.

- Improved computational traceability.

- Technology-independent architecture.


---

# 3.9 Relationship Between Layers

The interaction between architectural layers follows a strictly unidirectional flow.

```text
Platform Infrastructure
          │
          ▼
Scientific Services
          │
          ▼
Evidence Generation
          │
          ▼
Decision & Validation
          │
          ▼
Presentation
```

No downstream layer modifies computations performed by upstream layers.

Similarly, Scientific Services never communicate directly with Presentation components, and the Presentation Layer never alters computational evidence or decision outcomes.

This unidirectional architecture improves reproducibility and simplifies system validation.

---

# 3.10 Transition to Detailed Architecture

This chapter introduced the overall organization of the HakaseAI Peptide Discovery Platform and established the relationships between its major architectural layers.

The following chapters examine each layer in greater detail, beginning with the Platform Infrastructure Layer that coordinates workflow execution before progressing through the Scientific Services and finally the Decision & Validation Framework that transforms scientific evidence into transparent therapeutic recommendations.

# Chapter 4 — Platform Infrastructure Layer

---

# 4.1 Overview

The Platform Infrastructure Layer provides the computational foundation upon which every scientific analysis within the HakaseAI Peptide Discovery Platform is executed.

Unlike the Scientific Services, the Infrastructure Layer performs **no biological computation**. Its responsibility is to coordinate execution, manage computational resources, standardize communication between services, and ensure that every analysis remains reproducible, scalable, and fault tolerant.

By separating infrastructure from scientific computation, Version 3 allows scientific models to evolve independently of the software systems responsible for executing them.

---

# 4.2 Infrastructure Architecture

The Infrastructure Layer consists of six core subsystems.

```text
                    User Request
                         │
                         ▼
              Workflow Orchestrator
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   Model Registry   Resource Manager   Job Scheduler
         │               │               │
         └───────────────┼───────────────┘
                         ▼
                 Scientific Services
                         │
                         ▼
                  Evidence Bus
                         │
                         ▼
              Logging & Audit System
```

Each subsystem performs a distinct operational responsibility while remaining independent of scientific logic.

---

# 4.3 Core Infrastructure Components

| Component              | Responsibility                                                                 |
| ---------------------- | ------------------------------------------------------------------------------ |
| Workflow Orchestrator  | Coordinates execution of the complete computational workflow.                  |
| Model Registry         | Maintains versions and metadata for all computational models.                  |
| Resource Manager       | Provides standardized access to external scientific databases.                 |
| Job Scheduler          | Allocates computational resources and manages concurrent execution.            |
| Evidence Bus           | Standardizes communication between Scientific Services and the Decision Layer. |
| Logging & Audit System | Maintains complete computational traceability and reproducibility.             |

Together these components provide the operational backbone of the platform.

---

# 4.4 Workflow Orchestrator

The Workflow Orchestrator coordinates the execution of every computational analysis.

Its responsibilities include:

- validating execution order,

- resolving service dependencies,

- scheduling independent analyses,

- monitoring execution status,

- retrying recoverable failures,

- coordinating parallel computation.


The orchestrator contains **no scientific logic**.

Its only responsibility is ensuring that scientific services execute in the correct order while maximizing computational efficiency.

---

# 4.5 Model Registry

Every computational model used by the platform is registered centrally.

Each entry contains:

- Model identifier

- Version

- Supported capabilities

- Validation status

- Benchmark metadata

- Implementation details


Separating model management from scientific services allows prediction models to be upgraded without modifying the surrounding architecture.

---

# 4.6 Resource Manager

Many scientific analyses require access to external biological databases.

Rather than allowing each service to communicate directly with external resources, Version 3 centralizes database access through the Resource Manager.

Typical resources include:

- UniProt

- Protein Data Bank (PDB)

- AlphaFold Database

- ChEMBL

- IEDB

- PubChem


This abstraction simplifies future database integration while improving maintainability.

---

# 4.7 Job Scheduler

Scientific analyses vary considerably in computational cost.

Sequence-based calculations may execute within milliseconds, whereas structural prediction may require GPU acceleration and substantially longer runtimes.

The Job Scheduler optimizes resource utilization by:

- managing execution queues,

- allocating CPU and GPU resources,

- scheduling concurrent analyses,

- prioritizing computational workloads,

- monitoring execution status.


This separation ensures efficient utilization of computational resources without affecting scientific workflows.

---

# 4.8 Evidence Bus

Version 3 adopts an evidence-driven communication model.

Scientific Services do not exchange intermediate outputs directly.

Instead, each service publishes a standardized Evidence Object to the Evidence Bus.

```text
Scientific Service

↓

Evidence Object

↓

Evidence Bus

↓

Decision Layer
```

This approach provides several advantages:

- standardized interfaces,

- loose coupling,

- independent service replacement,

- simplified testing,

- scalable distributed execution.


The Evidence Bus represents the primary communication mechanism within the platform.

---

# 4.9 Logging & Audit System

Every computational operation performed by the platform is recorded.

The audit record includes:

- timestamp,

- executed service,

- model version,

- execution duration,

- input identifier,

- output identifier,

- execution status,

- generated warnings.


Complete audit trails enable:

- reproducibility,

- debugging,

- performance monitoring,

- regulatory documentation,

- scientific validation.


No prediction should exist without an associated audit record.

---

# 4.10 Fault Tolerance

Computational failures should not terminate the entire workflow whenever partial analysis remains possible.

Version 3 therefore distinguishes between three categories of failures.

|Failure Type|Platform Response|
|---|---|
|Recoverable|Retry automatically and continue execution.|
|Partial|Continue remaining analyses while marking missing evidence.|
|Critical|Terminate execution and return a diagnostic report.|

This strategy maximizes platform robustness while preserving transparency regarding incomplete analyses.

---

# 4.11 Infrastructure Design Principles

Every infrastructure component follows the same operational principles.

- Infrastructure performs no scientific prediction.

- Scientific Services never communicate directly.

- All communication occurs through standardized interfaces.

- Every computation is version controlled.

- Every execution is reproducible.

- Failures are isolated whenever possible.

- Infrastructure remains independent of scientific implementation.


These principles ensure that software infrastructure and scientific computation evolve independently.

---

# Chapter 5 — Core Scientific Services

---

# 5.1 Overview

The Core Scientific Services represent the scientific computation layer of the HakaseAI Peptide Discovery Platform.

Each service performs a single, well-defined scientific responsibility and generates standardized evidence describing one aspect of a peptide candidate.

Unlike previous pipeline-oriented architectures, these services are reusable across multiple therapeutic modalities.

Scientific Services **never** perform workflow orchestration, therapeutic decision making, or report generation. Their sole responsibility is to transform computational inputs into validated scientific evidence.

Collectively, the services produce the complete evidence required by the Decision & Validation Framework.

---

# 5.2 Scientific Service Architecture

```text
                     Validated Input
                           │
                           ▼
──────────────────────────────────────────────
      1. Physicochemical Service
──────────────────────────────────────────────
                           │
                           ▼
──────────────────────────────────────────────
      2. Structural Biology Service
──────────────────────────────────────────────
                           │
                           ▼
──────────────────────────────────────────────
      3. Functional Analysis Service
──────────────────────────────────────────────
                           │
                           ▼
──────────────────────────────────────────────
      4. Developability Service
──────────────────────────────────────────────
                           │
                           ▼
──────────────────────────────────────────────
           5. Safety Service
──────────────────────────────────────────────
                           │
                           ▼
              Platform Evidence Objects
                           │
                           ▼
            Decision & Validation Framework
```

Each service consumes standardized inputs, performs domain-specific computation, and publishes a standardized Evidence Object.

---

# 5.3 Common Service Contract

Every Scientific Service follows the same architectural contract.

|Component|Description|
|---|---|
|**Purpose**|Defines the scientific responsibility of the service.|
|**Inputs**|Receives standardized data from the Infrastructure Layer or upstream services.|
|**Computation**|Executes deterministic algorithms and validated computational models.|
|**Outputs**|Produces a standardized Evidence Object.|
|**Validation**|Reports confidence, model provenance, and execution status.|

This common interface allows new services to be added without changing the surrounding architecture.

---

# 5.4 Physicochemical Service

## Overview

The Physicochemical Service converts validated peptide sequences into standardized molecular representations by calculating intrinsic physicochemical properties that describe the peptide independently of any biological target.

These properties provide the foundation for all downstream scientific analyses.

### Responsibilities

|Responsibility|Description|
|---|---|
|Molecular Representation|Generate the standardized peptide object.|
|Sequence Characterization|Compute intrinsic sequence properties.|
|Physicochemical Descriptors|Calculate molecular descriptors used by downstream services.|
|Feature Generation|Produce standardized numerical representations for machine learning models.|
|Evidence Generation|Publish the Physicochemical Evidence Object.|

### Core Computational Modules

|Module|Function|
|---|---|
|Sequence Validation|Verify peptide integrity.|
|Descriptor Calculator|Compute MW, pI, charge, hydrophobicity, instability, etc.|
|Feature Generator|Generate numerical descriptors and embeddings.|
|Evidence Generator|Create standardized Physicochemical Evidence Object.|

### Inputs & Outputs

|Inputs|Outputs|
|---|---|
|Validated peptide sequence|Standardized Peptide Object|
|User-defined modifications|Physicochemical Evidence Object|

### Implementation Notes

This service relies primarily on deterministic algorithms and sequence-based calculations. Its outputs serve as foundational inputs for all downstream Scientific Services.

---

# 5.5 Structural Biology Service

## Overview

The Structural Biology Service predicts three-dimensional peptide structures, peptide–target complexes, and molecular interaction interfaces.

Its objective is to generate structural evidence describing how a peptide is expected to fold and interact with its intended biological target.

### Responsibilities

|Responsibility|Description|
|---|---|
|Structure Prediction|Predict peptide tertiary structure.|
|Complex Prediction|Model peptide–target complexes.|
|Interface Analysis|Characterize molecular interactions.|
|Structural Confidence|Quantify prediction reliability.|
|Evidence Generation|Publish the Structural Evidence Object.|

### Core Computational Modules

|Module|Function|
|---|---|
|Structure Prediction Engine|Generate peptide structures.|
|Complex Modeling|Predict peptide–target complexes.|
|Interface Analysis|Identify interaction residues and contacts.|
|Confidence Assessment|Evaluate prediction reliability.|
|Evidence Generator|Produce standardized structural evidence.|

### Inputs & Outputs

|Inputs|Outputs|
|---|---|
|Peptide Object|Predicted peptide structure|
|Target information|Predicted complex|
|Physicochemical Evidence|Structural Evidence Object|

### Implementation Notes

The architecture specifies structural prediction capability rather than specific software implementations. Prediction models may evolve without requiring architectural redesign.

---

# 5.6 Functional Analysis Service

## Overview

The Functional Analysis Service estimates the biological activities supported by the available molecular and structural evidence.

Unlike the Decision Layer, it does not determine whether those activities are therapeutically desirable. Its responsibility is to execute modality-specific computational models and generate standardized Functional Evidence.

### Responsibilities

|Responsibility|Description|
|---|---|
|Functional Prediction|Execute modality-specific prediction models.|
|Similarity Analysis|Compare against experimentally validated peptides.|
|Target Engagement|Estimate receptor or target interaction.|
|Confidence Assessment|Quantify prediction reliability.|
|Evidence Generation|Publish the Functional Evidence Object.|

### Core Computational Modules

|Module|Function|
|---|---|
|Workflow Selector|Select analyses based on therapeutic modality.|
|Functional Predictors|Execute validated computational models.|
|Similarity Engine|Compare with known peptide datasets.|
|Consistency Validator|Detect conflicting predictions.|
|Evidence Generator|Produce standardized functional evidence.|

### Inputs & Outputs

|Inputs|Outputs|
|---|---|
|Physicochemical Evidence|Functional scores|
|Structural Evidence|Target engagement metrics|
|Therapeutic modality|Functional Evidence Object|

### Implementation Notes

The Functional Analysis Service performs computational prediction only. Therapeutic interpretation remains the responsibility of the Decision Layer.

---

# 5.7 Developability Service

## Overview

The Developability Service evaluates whether a peptide possesses the pharmaceutical characteristics required for successful development, manufacturing, formulation, and long-term stability.

### Responsibilities

|Responsibility|Description|
|---|---|
|Stability Assessment|Predict chemical and biological stability.|
|Aggregation Analysis|Estimate aggregation and solubility risks.|
|Manufacturability|Evaluate synthetic feasibility.|
|Formulation Assessment|Estimate pharmaceutical compatibility.|
|Evidence Generation|Publish the Developability Evidence Object.|

### Core Computational Modules

|Module|Function|
|---|---|
|Stability Analysis|Evaluate degradation liabilities.|
|Aggregation Prediction|Estimate aggregation propensity.|
|Manufacturability Assessment|Predict synthesis complexity.|
|Formulation Analysis|Evaluate pharmaceutical compatibility.|
|Evidence Generator|Produce standardized engineering evidence.|

### Inputs & Outputs

|Inputs|Outputs|
|---|---|
|Physicochemical Evidence|Developability metrics|
|Structural Evidence|Engineering recommendations|
|Sequence information|Developability Evidence Object|

### Implementation Notes

This service evaluates engineering feasibility rather than therapeutic efficacy.

---

# 5.8 Safety Service

## Overview

The Safety Service predicts computationally identifiable biological liabilities associated with peptide therapeutics.

Its objective is to quantify potential safety risks while explicitly communicating uncertainty and applicability.

### Responsibilities

|Responsibility|Description|
|---|---|
|Immunogenicity Assessment|Predict immune recognition.|
|Toxicity Assessment|Estimate peptide toxicity.|
|Off-Target Analysis|Identify potential unintended interactions.|
|Risk Quantification|Estimate confidence and applicability.|
|Evidence Generation|Publish the Safety Evidence Object.|

### Core Computational Modules

|Module|Function|
|---|---|
|Immunogenicity Prediction|Estimate MHC binding and epitope potential.|
|Toxicity Prediction|Evaluate toxicity-related properties.|
|Off-Target Assessment|Predict cross-reactivity.|
|Safety Validation|Assess confidence and applicability.|
|Evidence Generator|Produce standardized safety evidence.|

### Inputs & Outputs

|Inputs|Outputs|
|---|---|
|Peptide Object|Safety metrics|
|Structural Evidence|Risk estimates|
|Functional Evidence|Safety Evidence Object|

### Implementation Notes

Safety predictions represent computational hypotheses and should always be interpreted alongside experimental validation.

---

# 5.9 Scientific Service Principles

All Scientific Services follow the same architectural principles.

- Each service performs a single scientific responsibility.

- Scientific Services remain independent of workflow execution.

- Services communicate only through standardized Evidence Objects.

- Every prediction records confidence and model provenance.

- Services never perform GO / NO-GO decision making.

- Services remain replaceable without affecting surrounding components.


These principles ensure that the Scientific Layer remains modular, reusable, and extensible across future therapeutic modalities.

---

# Chapter 6 — Decision & Validation Framework

---

# 6.1 Overview

The Scientific Services collectively generate independent evidence describing the physicochemical, structural, functional, pharmaceutical, and safety characteristics of a peptide candidate.

However, these services intentionally avoid making therapeutic recommendations.

The responsibility of the **Decision & Validation Framework** is to integrate this evidence, evaluate its consistency and confidence, and produce a transparent **GO / Conditional GO / NO-GO** recommendation.

Unlike conventional AI workflows that rely on a single prediction model, Version 3 separates **scientific prediction** from **scientific decision making**, ensuring that every recommendation is supported by explicit computational evidence.

---

# 6.2 Decision Framework

The overall decision workflow is illustrated below.

```text
Scientific Services
        │
        ▼
Evidence Objects
        │
        ▼
Evidence Integration
        │
        ▼
Confidence Assessment
        │
        ▼
Decision Engine
        │
        ▼
GO / Conditional GO / NO-GO
        │
        ▼
Recommendation Report
```

Each stage performs a single responsibility and maintains complete computational traceability.

---

# 6.3 Evidence Framework

Each Scientific Service generates a standardized Evidence Object.

These objects represent the only inputs accepted by the Decision Layer.

|Scientific Service|Evidence Produced|
|---|---|
|Physicochemical Service|Physicochemical Evidence|
|Structural Biology Service|Structural Evidence|
|Functional Analysis Service|Functional Evidence|
|Developability Service|Developability Evidence|
|Safety Service|Safety Evidence|

The Decision Layer never communicates directly with computational models.

Instead, all reasoning is performed using these standardized evidence objects.

This abstraction allows individual prediction models to evolve without affecting downstream decision logic.

Infrastructure components are completely modality-independent and therefore shared across every therapeutic workflow supported by HakaseAI.

---

# 6.4 Platform Evidence Object

The Decision Layer combines all Evidence Objects into a unified **Platform Evidence Object**.

```text
Physicochemical Evidence
            +
Structural Evidence
            +
Functional Evidence
            +
Developability Evidence
            +
Safety Evidence
            │
            ▼
Platform Evidence Object
```

Each evidence element records:

- Prediction value

- Confidence

- Evidence tier

- Originating model

- Model version

- Validation status

- Known limitations


The Platform Evidence Object becomes the complete scientific representation of a peptide candidate.

---

# 6.5 Evidence Integration & Confidence Assessment

Before any recommendation is generated, the Decision Layer evaluates the completeness and consistency of all available evidence.

The framework performs four validation tasks:

|Validation|Purpose|
|---|---|
|Completeness|Verify all required evidence is available.|
|Consistency|Detect conflicting scientific predictions.|
|Confidence|Evaluate overall reliability of the evidence.|
|Applicability|Confirm predictions remain within validated model domains.|

Rather than discarding uncertain predictions, Version 3 propagates uncertainty throughout the decision process.

Consequently, low-confidence evidence contributes proportionally less to the final recommendation while remaining fully visible to the user.

---

# 6.6 Decision Engine

The Decision Engine applies predefined decision policies to the validated Platform Evidence Object.

Its responsibilities include:

- evidence aggregation,

- confidence weighting,

- conflict resolution,

- decision policy evaluation,

- recommendation generation.


Importantly, the Decision Engine performs **no scientific prediction**.

It only interprets evidence produced elsewhere in the platform.

Possible outcomes include:

|Recommendation|Description|
|---|---|
|**GO**|Computational evidence supports progression to the next development stage.|
|**Conditional GO**|Candidate is promising but requires additional validation before progression.|
|**NO-GO**|Current computational evidence does not support continued development.|

Every recommendation is accompanied by supporting evidence and confidence estimates.

---

# 6.7 Recommendation Generation

The final recommendation includes not only a decision but also guidance for experimental validation.

Typical recommendations include:

- receptor binding assays,

- structural validation,

- antimicrobial activity testing,

- protease stability studies,

- immunogenicity assessment,

- toxicity evaluation,

- pharmacokinetic characterization.


By connecting computational predictions with experimental priorities, the platform supports evidence-driven research planning rather than replacing laboratory validation.

---

# 6.8 AI Usage Policy

Version 3 explicitly restricts the role of Large Language Models within the scientific workflow.

LLMs may be used for:

- report generation,

- evidence summarization,

- documentation,

- user interaction.


LLMs are **never** responsible for:

- generating scientific predictions,

- assigning confidence,

- modifying evidence,

- producing GO / NO-GO decisions.


Scientific evidence originates exclusively from deterministic algorithms and validated computational models.

This separation minimizes hallucination risk while maintaining explainability and reproducibility.

---

# 6.9 Decision Layer Principles

The Decision & Validation Framework follows several guiding principles.

- Scientific prediction is separated from scientific decision making.

- Every recommendation is evidence driven.

- Every decision is accompanied by confidence estimates.

- All recommendations remain fully traceable.

- Decision logic remains independent of individual prediction models.

- Computational evidence is never modified by the Presentation Layer.


These principles ensure that platform recommendations remain transparent, reproducible, and scientifically interpretable.

---

# Chapter 7 — Platform Extensibility & Architecture Summary

---

# 7.1 Overview

Version 3 was designed to establish a long-term architectural foundation for computational therapeutic discovery rather than a workflow dedicated exclusively to peptide therapeutics.

Previous platform iterations expanded by creating new computational pipelines for each therapeutic modality. While suitable during early development, this approach inevitably increased software complexity, duplicated scientific computation, and reduced maintainability.

Version 3 instead adopts a capability-driven architecture in which reusable scientific services, standardized evidence generation, centralized decision making, and independent infrastructure form the foundation of every computational workflow.

This chapter summarizes the architectural philosophy of Version 3 and describes how the platform can evolve without requiring structural redesign.

---

# 7.2 Architectural Evolution

The transition from the previous architecture to Version 3 represents a shift in both software organization and scientific workflow.

|Previous Architecture|Version 3 Architecture|
|---|---|
|Modality-specific pipelines|Reusable scientific services|
|Direct model communication|Standardized Evidence Objects|
|Embedded decision logic|Centralized Decision Layer|
|Mixed scientific and infrastructure responsibilities|Layered separation of concerns|
|Workflow-specific implementations|Platform-wide computational capabilities|

Rather than redesigning the platform for each therapeutic application, Version 3 allows new capabilities to be incorporated through modular scientific services and standardized decision logic.

---

# 7.3 Platform Extensibility

A primary objective of Version 3 is long-term extensibility.

The architecture has been intentionally designed so that future therapeutic domains can be supported without modifying the existing platform structure.

Typical future extensions include:

- Antibody therapeutics

- Protein therapeutics

- RNA therapeutics

- Gene-editing systems

- Viral vector engineering

- Targeted protein degradation

- Digital twin applications


Supporting these modalities generally requires:

1. Additional Scientific Services or prediction models.

2. New Evidence Object definitions where necessary.

3. Extension of modality-specific decision policies.


The Infrastructure Layer, communication interfaces, and overall architecture remain unchanged.

---

# 7.4 Technology Evolution

Computational biology and artificial intelligence continue to evolve rapidly.

Accordingly, Version 3 deliberately separates **architectural capabilities** from **software implementations**.

For example:

```text
Structural Biology Service

↓

Structure Prediction Capability

↓

Current Implementation

Boltz
```

If a more accurate prediction model becomes available, the implementation can be replaced without modifying:

- service interfaces,

- evidence schemas,

- decision framework,

- infrastructure architecture.


This technology-independent design protects the platform from software obsolescence while encouraging continuous scientific improvement.

---

# 7.5 Architectural Design Principles

The long-term evolution of the HakaseAI platform should preserve the following architectural principles.

|Principle|Description|
|---|---|
|**Scientific Services generate evidence**|Services perform scientific computation only and never therapeutic decision making.|
|**Infrastructure manages execution**|Workflow orchestration, scheduling, and communication remain independent of scientific computation.|
|**Decision Layer performs reasoning**|Recommendations are generated exclusively from validated Evidence Objects.|
|**Presentation communicates results**|Reports and dashboards never modify computational evidence or decisions.|
|**Evidence is standardized**|Every computational result is represented using a common evidence framework.|
|**Every prediction is traceable**|Model versions, confidence, and computational provenance accompany all outputs.|
|**Every component is replaceable**|Scientific models may evolve without architectural redesign.|

These principles define the long-term architectural identity of the platform and should guide future development.

---

# 7.6 Complete System Architecture

The complete Version 3 architecture is summarized below.

```text
                         USER
                           │
                           ▼
                  Input Validation
                           │
                           ▼
═══════════════════════════════════════════════
         Platform Infrastructure Layer
═══════════════════════════════════════════════
                           │
                           ▼
═══════════════════════════════════════════════
          Core Scientific Services
═══════════════════════════════════════════════
  • Physicochemical Service
  • Structural Biology Service
  • Functional Analysis Service
  • Developability Service
  • Safety Service
                           │
                           ▼
                Platform Evidence
                           │
                           ▼
═══════════════════════════════════════════════
        Decision & Validation Framework
═══════════════════════════════════════════════
                           │
                           ▼
              GO / Conditional GO / NO-GO
                           │
                           ▼
═══════════════════════════════════════════════
        Presentation & Reporting Layer
═══════════════════════════════════════════════
```

This layered organization separates infrastructure, scientific computation, evidence generation, decision making, and presentation into independent architectural components while preserving standardized communication between them.

---

# 7.7 Benefits of Version 3

The redesigned architecture provides measurable advantages across scientific, engineering, and platform domains.

### Scientific Benefits

- Reusable computational analyses.

- Standardized evidence generation.

- Transparent confidence reporting.

- Independent benchmarking of scientific services.


---

### Engineering Benefits

- Reduced software duplication.

- Clear separation of responsibilities.

- Simplified maintenance.

- Independent service development.

- Improved scalability.


---

### Platform Benefits

- Rapid support for new therapeutic modalities.

- Consistent user experience across applications.

- Technology-independent architecture.

- Long-term maintainability.

- Improved computational reproducibility.


---

# 7.8 Final Remarks

The HakaseAI Peptide Discovery Platform Version 3 represents a transition from a collection of computational prediction pipelines to a unified scientific computing platform.

By organizing computation around reusable scientific capabilities rather than therapeutic workflows, the architecture establishes a scalable foundation capable of supporting future advances in peptide therapeutics, computational biology, and artificial intelligence.

Most importantly, Version 3 preserves the distinction between **scientific prediction** and **scientific decision making**.

Scientific Services generate objective computational evidence.

The Decision Layer integrates that evidence into transparent GO / Conditional GO / NO-GO recommendations.

The Presentation Layer communicates those recommendations without altering the underlying scientific results.

This separation ensures that the platform remains scientifically rigorous, computationally reproducible, and extensible as both computational methods and therapeutic modalities continue to evolve.

Version 3 therefore serves not only as the architectural foundation for peptide therapeutic discovery, but also as a general framework upon which future computational drug discovery platforms can be constructed.
