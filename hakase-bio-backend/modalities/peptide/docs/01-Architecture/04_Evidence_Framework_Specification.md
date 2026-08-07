

# Evidence Framework Specification

## 1. Purpose

The Evidence Framework is the canonical contract governing how every Scientific Service publishes, exchanges, stores, validates, and consumes computational evidence. Every service SHALL communicate exclusively through standardized Evidence Objects. The framework separates scientific computation from scientific interpretation, enabling modularity, reproducibility, auditability, and transparent decision making.

This specification is the single source of truth for evidence representation across the Physicochemical, Structural Biology, Functional Analysis, Developability, Safety, and Decision & Validation layers.

---

# 2. Philosophy of Evidence-Driven Computation

The platform is founded on the principle that scientific services produce evidence—not conclusions.

Every computational output must:

- represent an objectively computed observation;
- preserve uncertainty rather than hide it;
- record complete computational provenance;
- remain independently interpretable;
- be reproducible without hidden state;
- never contain therapeutic recommendations.

The Decision Layer alone integrates evidence into GO / Conditional GO / NO-GO decisions.

---

# 3. Evidence Object Architecture

Every Scientific Service publishes one immutable Evidence Object.

```
Evidence Object
├── Header
├── Scientific Payload
├── Confidence
├── Uncertainty
├── Applicability Domain
├── Validation
├── Provenance
├── Metadata
└── Audit Information
```

---
## Platform Evidence Object

The Decision & Validation Framework does not operate directly on
individual Evidence Objects.

Instead, it aggregates all validated Evidence Objects into a
Platform Evidence Object.

The Platform Evidence Object represents the complete computational
state of a peptide candidate.

It contains:

• Physicochemical Evidence
• Structural Evidence
• Functional Evidence
• Developability Evidence
• Safety Evidence
• Aggregated Confidence
• Aggregated Uncertainty
• Consistency Assessment
• Conflict Summary

The Platform Evidence Object is immutable and becomes the sole input
to the Decision Engine.

---

# 4. Mandatory Fields

Every Evidence Object SHALL contain:

- evidence_id (UUID)
- evidence_type
- producing_service
- subject_id
- execution_id
- schema_version
- timestamp
- scientific_payload
- confidence
- uncertainty
- applicability_domain
- validation_status
- provenance
- metadata
- Limitations
- warnings

Objects missing mandatory fields are invalid.

---

# 5. Metadata

Metadata records execution context rather than scientific findings.

Includes:

- platform version
- service version
- model version(s)
- software versions
- configuration hash
- execution environment
- runtime
- hardware
- input identifiers
- output checksum

---

# 6. Provenance

Every prediction must record:

- originating service
- upstream evidence IDs
- algorithms
- model checkpoints
- parameters
- external databases
- execution timestamps

This creates a directed acyclic graph (DAG) of evidence lineage.

---

# 7. Confidence Representation

Confidence is reported separately from predictions.

Fields:

- numerical confidence [0,1]
- calibration method
- confidence category
- supporting evidence count
- confidence rationale

Confidence must never overwrite raw predictions.

---

# 8. Uncertainty Propagation

Each service propagates inherited uncertainty.

For every derived quantity:

U_output = f(U_inputs, U_model)

Inherited uncertainty

+

Model uncertainty

+

Numerical uncertainty

↓

Output uncertainty

Inherited uncertainty must remain visible instead of collapsing into a single score.

Sources include:

- measurement uncertainty
- model uncertainty
- structural uncertainty
- missing information
- ensemble variance

---

# 9. Applicability Domain

Every prediction records whether the input lies within the validated domain.

Includes:

- supported peptide length
- residue types
- modification support
- modality support
- similarity to training distribution
- extrapolation flag

Predictions outside the applicability domain are retained but explicitly flagged.

---

# 10. Validation Status

Every evidence object records:

- Not Validated
- Internally Validated
- Cross-Service Consistent
- Experimentally Supported
- Deprecated

Validation never modifies scientific payloads.

---

# 11. Schema Versioning

Semantic versioning:

MAJOR.MINOR.PATCH

Major:
breaking schema changes

Minor:
backward-compatible additions

Patch:
documentation or metadata corrections

Evidence generated under different schema versions remains traceable.

---

# 12. Serialization Format

Canonical serialization:

- JSON
- JSON Schema validation
- UTF-8
- ISO-8601 timestamps
- UUID identifiers

Scientific payloads may embed:

- arrays
- matrices
- embeddings
- coordinate files by reference
- binary assets via object storage

---

# 13. Evidence Lifecycle

Generate
→ Validate
→ Publish
→ Store
→ Consume
→ Aggregate
→ Archive
→ Deprecate (optional)

Evidence Objects are immutable.

Corrections generate new Evidence Objects linked through provenance.

---

# 14. Evidence Storage Strategy

Operational Store
- latest evidence

Audit Store
- immutable historical evidence

Object Storage
- large scientific assets

Metadata Index
- searchable metadata

No evidence is overwritten.

---

# 15. Communication Between Services

Services communicate exclusively through the Evidence Bus.

Rules:

- no direct model coupling
- no hidden intermediate state
- immutable Evidence Objects
- asynchronous publication
- explicit schema validation before acceptance

Consumers depend only on evidence schemas, never implementation details.

---

# 16. Evidence Aggregation

Aggregation belongs exclusively to the Decision & Validation Layer.

Aggregation consists of:

- dependency resolution
- consistency checking
- confidence aggregation
- uncertainty propagation
- conflict detection
- decision support

Scientific Services never aggregate across domains.

---

# 17. Evidence Traceability

Every final recommendation must support complete backward traversal:

Decision
→ Safety Evidence
→ Developability Evidence
→ Functional Evidence
→ Structural Evidence
→ Physicochemical Evidence
→ Input Sequence

Every numerical result must identify its originating computation.

---

# 18. Auditability

The framework records:

- execution history
- software versions
- model versions
- configuration
- evidence lineage
- timestamps
- user/job identifiers
- validation history

An independent auditor must be able to reconstruct every prediction.

---

# 19. Reproducibility

Exact reproduction requires:

- identical inputs
- identical Evidence Objects
- identical model versions
- identical software versions
- identical configuration
- identical execution environment
- deterministic algorithms where applicable
- recorded random seeds for stochastic models

Any deviation produces a new execution lineage.

---

# 20. Platform Governance

This specification governs every Scientific Service.

No service may:
- emit undocumented outputs;
- bypass the Evidence Bus;
- alter upstream evidence;
- remove uncertainty;
- overwrite evidence.

All services SHALL publish Evidence Objects conforming to this specification before downstream computation begins.

This document is the authoritative evidence contract for the HakaseAI platform.
