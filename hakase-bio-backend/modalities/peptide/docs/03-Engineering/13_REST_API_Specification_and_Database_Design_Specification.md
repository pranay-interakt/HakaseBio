# HakaseAI REST API Specification

---

# 1. API Design Principles

- RESTful JSON API

- OpenAPI 3.1 Compatible

- Versioned endpoints (`/api/v1`)

- JWT Authentication

- Immutable Evidence Objects

- Asynchronous scientific execution

- Idempotent job submission

- Separation between Infrastructure, Scientific Services, Decision Layer, and Presentation Layer

- Privacy-first (no scientific data exposed without authorization)


The API exposes orchestration capabilities only. Individual Scientific Services are never called directly by end users; they are orchestrated by the Workflow Service.

---

# 2. Authentication

```
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Authorization Header

```
Authorization: Bearer <JWT_TOKEN>
```

JWT Claims

```
sub
tenant_id
role
permissions
exp
iat
```

Roles

- Admin

- Scientist

- Researcher

- Viewer

- API Client


---

# 3. Core Resources

```
Project
Experiment
Peptide
Target
Job
Evidence
Platform Evidence
Prediction
Report
User
```

Each resource owns its UUID and version.

---

# 4. Project API

```
POST   /projects
GET    /projects
GET    /projects/{id}
PATCH  /projects/{id}
DELETE /projects/{id}
```

Request

```json
{
  "name":"PDAC Discovery",
  "description":"Peptide screening"
}
```

Response

```json
{
  "project_id":"uuid",
  "status":"ACTIVE",
  "created_at":"timestamp"
}
```

---

# 5. Peptide API

```
POST   /peptides
GET    /peptides/{id}
PATCH  /peptides/{id}
DELETE /peptides/{id}
```

Request

```json
{
  "sequence":"ACDEFGHIKLMNP",
  "modifications":[]
}
```

Validation

- Valid amino acids

- Modification syntax

- Length limits

- Duplicate detection


---

# 6. Target API

```
POST /targets
GET  /targets/{id}
GET  /targets
```

Request

```json
{
  "name":"EGFR",
  "uniprot":"P00533",
  "pdb":"1M17"
}
```

---

# 7. Workflow & Job API

Create a complete peptide analysis.

```
POST /jobs
```

Request

```json
{
  "project_id":"uuid",
  "peptide_id":"uuid",
  "target_id":"uuid",
  "workflow":"standard"
}
```

Response

```json
{
  "job_id":"uuid",
  "status":"QUEUED"
}
```

Job Status

```
GET /jobs/{id}
```

```json
{
  "job_id":"uuid",
  "status":"RUNNING",
  "progress":62,
  "current_stage":"Structural Biology"
}
```

List Jobs

```
GET /jobs
```

Cancel

```
POST /jobs/{id}/cancel
```

Retry

```
POST /jobs/{id}/retry
```

Supported Status

```
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
```

---

# 8. Scientific Service APIs (Internal)

These endpoints are intended for infrastructure communication.

## Physicochemical

```
POST /internal/physicochemical/run
```

## Structural Biology

```
POST /internal/structural/run
```

## Functional Analysis

```
POST /internal/functional/run
```

## Developability

```
POST /internal/developability/run
```

## Safety

```
POST /internal/safety/run
```

Each returns

```json
{
  "execution_id":"uuid",
  "evidence_id":"uuid",
  "status":"SUCCESS"
}
```

## Scientific Services only publish immutable Evidence Objects and never expose decision logic.

# 9. Evidence API

Get all evidence

```
GET /evidence
```

Evidence by ID

```
GET /evidence/{id}
```

Evidence for Job

```
GET /jobs/{id}/evidence
```

Evidence Schema

```json
{
  "evidence_id":"uuid",
  "service":"Structural",
  "confidence":0.93,
  "uncertainty":0.11,
  "validation":"VALIDATED",
  "scientific_payload":{},
  "provenance":{},
  "metadata":{}
}
```

Evidence Objects are immutable.

---

# 10. Platform Evidence API

```
GET /platform-evidence/{job_id}
```

Returns

```json
{
  "physicochemical":{},
  "structural":{},
  "functional":{},
  "developability":{},
  "safety":{},
  "aggregated_confidence":0.88,
  "aggregated_uncertainty":0.15,
  "conflicts":[]
}
```

---

# 11. Decision API

```
GET /decision/{job_id}
```

Response

```json
{
  "recommendation":"GO",
  "confidence":0.87,
  "uncertainty":0.12,
  "rationale":[]
}
```

Decision endpoints consume Platform Evidence only and never recompute scientific predictions.

---

# 12. Report API

Generate Report

```
POST /reports
```

Retrieve

```
GET /reports/{id}
```

Download

```
GET /reports/{id}/download
```

List

```
GET /projects/{id}/reports
```

Report Metadata

```json
{
  "report_id":"uuid",
  "job_id":"uuid",
  "format":"PDF",
  "status":"READY"
}
```

---

# 13. Model Registry API

```
GET /models
GET /models/{id}
GET /models/{id}/versions
```

Response

```json
{
  "model":"Boltz-2",
  "version":"1.4",
  "status":"ACTIVE"
}
```

---

# 14. Health API

```
GET /health
GET /ready
GET /live
```

Response

```json
{
  "status":"healthy"
}
```

---

# 15. Audit API

```
GET /audit/jobs/{id}
GET /audit/events
```

Response

```json
{
  "execution_id":"uuid",
  "timestamp":"",
  "service":"Safety",
  "event":"Completed"
}
```

---

# 16. Validation Rules

Common validation:

- UUID format

- Required fields

- Peptide syntax

- Supported residue types

- Supported modifications

- Maximum sequence length

- Duplicate submission detection

- Authorization checks

- Tenant isolation

- Request size limits


---

# 17. Standard Error Response

```json
{
  "error":{
    "code":"INVALID_SEQUENCE",
    "message":"Unsupported amino acid.",
    "details":{}
  }
}
```

Common Error Codes

```
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Validation Failed
429 Rate Limited
500 Internal Error
503 Service Unavailable
```

---

# 18. Asynchronous Execution

Workflow

```
POST /jobs
        │
        ▼
QUEUED
        │
        ▼
RUNNING
        │
        ▼
Scientific Services
        │
        ▼
Evidence Objects
        │
        ▼
Platform Evidence
        │
        ▼
Decision
        │
        ▼
Report
```

Polling

```
GET /jobs/{id}
```

Future Enhancement

```
GET /jobs/{id}/events
```

(WebSocket / Server-Sent Events)

---

# 19. OpenAPI Component Schemas

## Peptide

```yaml
Peptide:
  type: object
  required:
    - sequence
  properties:
    sequence:
      type: string
    modifications:
      type: array
```

## Job

```yaml
Job:
  type: object
  properties:
    job_id:
      type: string
      format: uuid
    status:
      type: string
    progress:
      type: integer
```

## Evidence

```yaml
Evidence:
  type: object
  properties:
    evidence_id:
      type: string
    confidence:
      type: number
    uncertainty:
      type: number
    scientific_payload:
      type: object
```

## Decision

```yaml
Decision:
  type: object
  properties:
    recommendation:
      type: string
    confidence:
      type: number
    uncertainty:
      type: number
```

## Report

```yaml
Report:
  type: object
  properties:
    report_id:
      type: string
    format:
      type: string
    status:
      type: string
```

---

# 20. Layer Separation

|Layer|Public API|
|---|---|
|Presentation Layer|Projects, Peptides, Targets, Jobs, Reports|
|Infrastructure Layer|Authentication, Workflow, Health, Audit|
|Scientific Services|Internal execution endpoints only|
|Decision Layer|Platform Evidence, Decision APIs|

No client can directly invoke scientific models or alter Evidence Objects. Scientific Services remain stateless, publish immutable evidence, and the Decision Layer is the only component permitted to interpret evidence into GO / Conditional GO / NO-GO recommendations, preserving the architectural separation defined across the HakaseAI specifications.

# HakaseAI Database Design Specification


---

# 1. Purpose

The Database Design Specification defines how HakaseAI stores, manages, and retrieves operational and scientific data while preserving privacy, reproducibility, scalability, and immutable scientific evidence.

The database stores platform metadata only. Scientific computation remains the responsibility of the Scientific Services. Evidence Objects are immutable and versioned.

---

# 2. Database Architecture

HakaseAI uses a polyglot persistence architecture.

|Database|Purpose|
|---|---|
|PostgreSQL|Operational data, metadata, users, projects, jobs|
|Object Storage (S3/MinIO)|Evidence Objects, reports, structures, large scientific files|
|Redis|Cache, sessions, job queues|
|MLflow Registry|Model versioning|
|Vector Database (Optional)|Embeddings and similarity search|

---

# 3. Core Relational Schema

```text
Users
   │
Projects
   │
Experiments
   │
Jobs
   │
Peptides
   │
Targets
   │
Evidence Metadata
   │
Platform Evidence
   │
Decision
   │
Reports
```

---

# 4. Core Tables

## Users

```text
user_id (PK)
organization_id
name
email
password_hash
role
status
created_at
updated_at
```

---

## Organizations

```text
organization_id (PK)
name
license_type
created_at
```

---

## Projects

```text
project_id (PK)
organization_id (FK)
owner_id (FK)
name
description
status
created_at
updated_at
```

---

## Experiments

```text
experiment_id (PK)
project_id (FK)
name
description
created_at
```

---

## Peptides

```text
peptide_id (PK)
sequence
modifications
checksum
version
created_at
```

---

## Targets

```text
target_id (PK)
name
uniprot_id
pdb_id
species
metadata
```

---

## Jobs

```text
job_id (PK)
project_id (FK)
experiment_id (FK)
peptide_id (FK)
target_id (FK)
workflow
status
progress
execution_id
started_at
completed_at
created_at
```

---

## Evidence Metadata

```text
evidence_id (PK)
job_id (FK)
service
version
confidence
uncertainty
validation_status
object_uri
checksum
created_at
```

The scientific payload itself is stored in Object Storage.

---

## Platform Evidence

```text
platform_evidence_id (PK)
job_id (FK)
aggregated_confidence
aggregated_uncertainty
conflict_summary
created_at
```

---

## Decisions

```text
decision_id (PK)
platform_evidence_id (FK)
recommendation
confidence
uncertainty
rationale_uri
created_at
```

---

## Reports

```text
report_id (PK)
job_id (FK)
format
storage_uri
checksum
created_at
```

---

## Model Registry

```text
model_id (PK)
service
model_name
version
framework
training_dataset
artifact_uri
checksum
created_at
```

---

## Audit Log

```text
audit_id (PK)
user_id
job_id
action
resource
timestamp
ip_address
```

---

# 5. Entity Relationships

```text
Organization
      │
      ▼
Users
      │
      ▼
Projects
      │
      ▼
Experiments
      │
      ▼
Jobs
 ├──────────────┐
 ▼              ▼
Peptides     Targets
      │
      ▼
Evidence Metadata
      │
      ▼
Platform Evidence
      │
      ▼
Decision
      │
      ▼
Reports
```

---

# 6. Evidence Storage

Scientific Evidence Objects are immutable.

Database stores only:

- Evidence ID

- Metadata

- Confidence

- Uncertainty

- Validation status

- Storage URI

- Checksum


Scientific payloads are stored as versioned JSON in Object Storage.

Example

```text
s3://hakase/evidence/{uuid}.json
```

---

# 7. Object Storage Layout

```text
/projects/

/experiments/

/jobs/

/evidence/

/structures/

/embeddings/

/reports/

/audit/
```

Every object is versioned and immutable.

---

# 8. Model Registry

Each computational model records:

```text
model_id
service
version
framework
training dataset
artifact location
hyperparameters
checksum
deployment status
```

Models are never overwritten. New versions create new records.

---

# 9. Job Tracking

Each workflow execution records:

```text
job_id
execution_id
workflow
status
current_stage
progress
retry_count
start_time
end_time
runtime
```

Supported States

```text
QUEUED

RUNNING

COMPLETED

FAILED

CANCELLED
```

---

# 10. Report Storage

Reports are stored outside PostgreSQL.

Database stores only metadata.

```text
report_id
job_id
format
storage_uri
checksum
created_at
```

Supported Formats

- PDF

- HTML

- JSON


---

# 11. Audit Tables

Audit logs capture every critical platform action.

Fields

```text
audit_id
user_id
action
resource
old_value
new_value
timestamp
ip_address
```

Audited Events

- Login

- Job submission

- Report generation

- Model deployment

- Evidence publication

- User management

- Permission changes


Audit records are append-only.

---

# 12. Indexing Strategy

Primary Indexes

- Primary Keys

- Foreign Keys

- UUIDs


Secondary Indexes

```text
Jobs(status)

Jobs(project_id)

Jobs(created_at)

Evidence(job_id)

Evidence(service)

Reports(job_id)

Peptides(sequence checksum)

Models(service, version)
```

Composite Indexes

```text
(project_id, created_at)

(job_id, service)

(service, version)

(user_id, created_at)
```

---

# 13. Caching Strategy

Redis caches:

- Active sessions

- Authentication tokens

- Running jobs

- Frequently requested reports

- Frequently accessed Evidence metadata


Scientific Evidence Objects are never cached permanently.

---

# 14. Migration Strategy

Schema evolution uses versioned migrations.

Rules

- Forward-only migrations

- No destructive updates

- Rollback support

- Version-controlled migration scripts

- Automatic migration during deployment


---

# 15. Scalability Considerations

Database Layer

- Read replicas

- Connection pooling

- Partitioned tables

- Horizontal Object Storage

- Redis distributed cache


Scientific Data

- Store large artifacts outside PostgreSQL

- Stream Evidence Objects

- Lazy loading for reports

- Asynchronous writes


---

# 16. Reproducibility Requirements

Every scientific result must remain reproducible.

Each execution stores:

```text
Execution ID

Workflow version

Model version

Platform version

Configuration hash

Evidence IDs

Software versions

Hardware metadata

Timestamp

Input checksum

Output checksum
```

Evidence Objects are immutable and linked through provenance, allowing complete reconstruction of any workflow execution.

---

# 17. Data Integrity

Integrity constraints include:

- UUID primary keys

- Foreign key enforcement

- Unique sequence checksums

- Immutable Evidence records

- Version-controlled models

- Append-only audit logs

- Transactional job state updates


---

# 18. Database Design Principles

- Normalize operational data (3NF)

- Store scientific payloads outside relational tables

- Immutable scientific evidence

- Version every scientific artifact

- Separate operational and scientific storage

- Privacy-first tenant isolation

- Horizontal scalability

- Complete auditability

- Full workflow reproducibility


This design maintains a strict separation between Infrastructure, Scientific Services, Decision Layer, and Presentation Layer while supporting reproducible scientific workflows, immutable evidence, asynchronous execution, and future horizontal scaling of the HakaseAI platform.
