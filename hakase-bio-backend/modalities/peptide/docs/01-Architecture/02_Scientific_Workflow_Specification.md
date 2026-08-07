# Scientific Workflow Specification


# 1. Purpose

The Scientific Workflow Specification defines the complete execution lifecycle of peptide analysis within the HakaseAI Peptide Discovery Platform.

While the Architecture Specification defines the organization of the platform, the Scientific Service Specifications define scientific computation, the Evidence Framework defines evidence exchange, and the Decision & Reasoning Framework defines scientific interpretation, this specification defines **how these components execute together as a coordinated computational workflow**.

The workflow is responsible for:

- orchestrating scientific services;

- enforcing execution dependencies;

- scheduling parallel computation;

- coordinating Evidence Object publication;

- managing retries and failures;

- supporting resumable and partial execution;

- coordinating external resource access;

- managing computational caches;

- invoking prediction models;

- generating audit records;

- producing the final scientific report.


Scientific computation remains the responsibility of the individual Scientific Services. The workflow coordinates execution but never performs scientific prediction or scientific reasoning.

---

# 2. Workflow Design Principles

The HakaseAI workflow is governed by the following principles.

- Deterministic workflow orchestration.

- Evidence-driven execution.

- Dependency-aware scheduling.

- Maximum safe parallelization.

- Immutable Evidence Objects.

- Complete computational reproducibility.

- Fault isolation between services.

- Resumable execution.

- Transparent auditability.

- Separation of orchestration from scientific computation.


---

# 3. Workflow Overview

A complete peptide analysis progresses through a fixed sequence of scientific stages.

```text
User Request
      │
      ▼
Input Validation
      │
      ▼
Workflow Initialization
      │
      ▼
Physicochemical Service
      │
      ├──────────────┐
      ▼              ▼
Structural      Functional
      │              │
      └──────┬───────┘
             ▼
     Developability
             │
             ▼
         Safety
             │
             ▼
Platform Evidence Object
             │
             ▼
Decision Framework
             │
             ▼
Scientific Report
```

Each stage produces immutable computational evidence that becomes the input for subsequent stages.

---

# 4. Workflow Stages

## Stage 1 — Request Initialization

The workflow begins immediately after receiving a validated analysis request.

Responsibilities include:

- validating request syntax;

- canonicalizing peptide input;

- assigning a unique Execution ID;

- creating the workflow context;

- initializing audit records;

- allocating computational resources.

Output:

- Execution Context

---

## Stage 2 — Physicochemical Analysis

The Physicochemical Service is always executed first because every downstream Scientific Service depends upon the standardized molecular representation produced during this stage.

Outputs:

- Standardized Peptide Object

- Physicochemical Evidence Object


Successful completion of this stage is mandatory before any downstream computation begins.

---

## Stage 3 — Structural and Functional Analysis

Following publication of the Physicochemical Evidence Object, the workflow expands into independent computational branches.

```text
                 Physicochemical
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
Structural Biology          Functional Analysis
```

Structural Biology predicts:

- peptide structure;

- structural confidence;

- peptide-target complexes;

- interaction interfaces.


Functional Analysis predicts:

- biological activity;

- functional similarity;

- target engagement;

- functional consistency.


Both services publish independent Evidence Objects.

---

## Stage 4 — Developability Analysis

The Developability Service evaluates pharmaceutical suitability.

Required inputs:

- Physicochemical Evidence

- Structural Evidence


Optional contextual input:

- Functional Evidence


Outputs:

- Developability Evidence Object


---

## Stage 5 — Safety Analysis

The Safety Service performs computational risk assessment.

Required inputs:

- Peptide Object

- Structural Evidence


Optional contextual inputs:

- Functional Evidence

- Developability Evidence


Outputs:

- Safety Evidence Object


---

## Stage 6 — Evidence Aggregation

Once all enabled Scientific Services complete successfully, the workflow constructs the immutable Platform Evidence Object.

The Platform Evidence Object contains:

- Physicochemical Evidence;

- Structural Evidence;

- Functional Evidence;

- Developability Evidence;

- Safety Evidence;

- aggregated confidence;

- propagated uncertainty;

- consistency assessment;

- conflict summary.


No scientific interpretation occurs during aggregation.

---

## Stage 7 — Decision Framework

The Decision & Reasoning Framework consumes the Platform Evidence Object.

Outputs:

- GO

- Conditional GO

- NO-GO


The workflow never modifies Evidence Objects during this stage.

---

## Stage 8 — Scientific Report Generation

The final stage produces a human-readable scientific report summarizing the complete computational workflow.

Outputs include:

- workflow summary;

- scientific evidence;

- confidence assessment;

- uncertainty analysis;

- identified conflicts;

- engineering recommendations;

- final recommendation;

- computational provenance.


---

# 5. Workflow Dependency Graph

```text
User Input
      │
      ▼
Physicochemical
      │
      ├──────────────┐
      ▼              ▼
Structural      Functional
      │              │
      └──────┬───────┘
             ▼
     Developability
             │
             ▼
          Safety
             │
             ▼
 Platform Evidence
             │
             ▼
 Decision Framework
             │
             ▼
 Scientific Report
```

The dependency graph forms a Directed Acyclic Graph (DAG). Cyclic execution dependencies are prohibited.

---

# 6. Execution Order

The workflow SHALL execute Scientific Services in the following order.

|Stage|Component|
|---|---|
|1|Input Validation|
|2|Workflow Initialization|
|3|Physicochemical Service|
|4|Structural Biology Service|
|5|Functional Analysis Service|
|6|Developability Service|
|7|Safety Service|
|8|Platform Evidence Aggregation|
|9|Decision Framework|
|10|Scientific Report Generation|

Execution order represents dependency constraints rather than mandatory serialization.

---

# 7. Parallel Execution

Independent computational tasks SHALL execute concurrently whenever dependencies permit.

Examples include:

|Parallel Tasks|
|---|
|Descriptor calculation + embedding generation|
|Structural prediction + similarity search|
|Structure confidence analysis + docking preparation|
|Aggregation prediction + manufacturability assessment|
|Immunogenicity prediction + toxicity prediction|
|Report formatting + visualization generation|

Synchronization barriers occur only before:

- Developability Service;

- Safety Service;

- Evidence Aggregation;

- Decision Framework.


---

# 8. Workflow Orchestration

The Workflow Orchestrator is responsible for coordinating every execution.

Responsibilities include:

- constructing the execution DAG;

- satisfying dependency constraints;

- scheduling computational tasks;

- maximizing safe concurrency;

- invoking Scientific Services;

- monitoring execution status;

- coordinating retries;

- checkpointing workflow progress;

- publishing execution events;

- coordinating communication through the Evidence Bus.


The Workflow Orchestrator performs no scientific prediction.

---

# 9. Model Invocation

Each Scientific Service invokes one or more computational models during execution.

```text
Workflow Task
      │
      ▼
Model Registry
      │
      ▼
Load Approved Model
      │
      ▼
Execute Prediction
      │
      ▼
Generate Evidence
      │
      ▼
Publish Evidence Object
```

Every model invocation records:

- model identifier;

- model version;

- checkpoint identifier;

- configuration hash;

- execution environment;

- runtime;

- hardware configuration.


---

# 10. External Database Access

Scientific Services access biological resources exclusively through the Resource Manager.

Examples include:

- UniProt

- Protein Data Bank

- AlphaFold Database

- IEDB

- PubChem

- ChEMBL

- PeptideAtlas


External databases remain read-only.

Retrieved resources are versioned and recorded within computational provenance.

---

# 11. Caching Strategy

Workflow execution avoids redundant computation through hierarchical caching.

```text
Memory Cache
      │
      ▼
Distributed Cache
      │
      ▼
Persistent Evidence Store
```

Reusable artifacts include:

- canonical peptide objects;

- physicochemical descriptors;

- embeddings;

- predicted structures;

- downloaded reference datasets;

- validated Evidence Objects.


Cached results may only be reused when:

- peptide sequence is identical;

- modification annotations are identical;

- model versions are identical;

- configuration hashes match;

- upstream evidence remains valid.


---

# 12. Retry Strategy

Workflow failures are classified into three categories.

## Transient Failures

Examples:

- temporary network interruption;

- unavailable GPU;

- timeout during external database access.


Handling:

- exponential backoff;

- configurable retry count.


---

## Recoverable Failures

Examples:

- interrupted workflow execution;

- temporary orchestration failure.


Handling:

- resume from the latest completed checkpoint.


---

## Permanent Failures

Examples:

- invalid peptide sequence;

- unsupported modification;

- applicability domain violation.


Handling:

- terminate affected task;

- publish failure metadata;

- continue independent downstream execution where scientifically valid.


---

# 13. Failure Handling

Failure of one Scientific Service does not invalidate previously published evidence.

Each workflow task returns one of four execution states.

|State|Meaning|
|---|---|
|Success|Task completed normally|
|Partial Success|Results generated with limitations|
|Failed|Task terminated|
|Skipped|Execution intentionally omitted|

Failure metadata is included within audit records and Evidence Objects.

Missing evidence is interpreted by the Decision Framework rather than the Workflow Orchestrator.

---

# 14. Partial Execution

The workflow supports execution of individual Scientific Services without requiring complete platform execution.

Supported examples include:

- Physicochemical analysis only;

- Structural prediction only;

- Functional re-analysis;

- Safety reassessment;

- Decision re-execution using existing Evidence Objects.


Previously validated Evidence Objects may be reused when provenance remains valid.

---

# 15. Evidence Publication Workflow

Every Scientific Service publishes evidence using the standardized publication pipeline.

```text
Scientific Service
        │
        ▼
Validate Evidence
        │
        ▼
Attach Metadata
        │
        ▼
Attach Provenance
        │
        ▼
Publish Evidence Object
        │
        ▼
Evidence Bus
        │
        ▼
Evidence Store
```

Evidence Objects become immutable immediately following publication.

---

# 16. Audit Logging

Every workflow stage SHALL generate structured audit records.

Audit information includes:

- execution identifier;

- workflow stage;

- timestamps;

- service identifier;

- model version;

- software version;

- hardware information;

- runtime;

- input evidence;

- output evidence;

- retry count;

- failure information;

- execution status.


Audit records never contain scientific interpretation.

---

# 17. Complete Workflow Sequence

```text
User
 │
 ▼
Input Validation
 │
 ▼
Workflow Orchestrator
 │
 ▼
Physicochemical Service
 │
 ├───────────────────────────┐
 ▼                           ▼
Structural Biology     Functional Analysis
 │                           │
 └──────────────┬────────────┘
                ▼
      Developability Service
                │
                ▼
         Safety Service
                │
                ▼
 Platform Evidence Object
                │
                ▼
Decision & Reasoning Framework
                │
                ▼
Scientific Report Generator
                │
                ▼
 Final Scientific Report
```

---

# 18. Scientific Report Generation

The final report is generated after completion of the Decision Framework.

The report contains:

- peptide metadata;

- workflow summary;

- execution metadata;

- scientific evidence summary;

- confidence propagation summary;

- uncertainty analysis;

- contradiction summary;

- engineering recommendations;

- GO / Conditional GO / NO-GO recommendation;

- complete computational provenance;

- audit reference identifiers.


The report represents the final product of the scientific workflow and serves as the primary interface between computational evidence and experimental decision making.

---

# 19. Workflow Summary

The Scientific Workflow Specification establishes the execution contract governing every peptide analysis performed by the HakaseAI Peptide Discovery Platform.

It defines the lifecycle of computational execution from validated user input through evidence generation, workflow orchestration, decision support, and scientific report generation while preserving the platform's core architectural principles of modularity, reproducibility, transparency, and evidence-driven computation.

The workflow never performs scientific prediction or scientific reasoning. Its sole responsibility is the reliable orchestration of independent Scientific Services into a coherent, reproducible, and auditable computational analysis pipeline.
