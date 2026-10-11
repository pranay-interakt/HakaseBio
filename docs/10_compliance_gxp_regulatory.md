# 10 — Compliance: GxP, 21 CFR Part 11, ALCOA+

> Status: lists controls that are implemented, and the gaps that remain before HOS could be used
> as a validated GxP system. HOS is **not** a validated system today.

## 10.1 Two planes

- **Discovery plane.** Exploratory work: simulation, design iteration, agent drafting. It is fast
  and not regulated.
- **GxP plane.** Records that support a regulatory submission. These are deterministic,
  versioned and attributable, and every legal attestation is human.

Implemented separation:
- **Simulated data cannot cross into the GxP plane.** This is enforced by provenance kind, taint,
  the file-hash registry, the approval gate and the Module 4 scan.
- **Agents act through the same API and permissions as people.** They cannot sign or hold an
  attestation role.

## 10.2 21 CFR Part 11 mapping

| Requirement | Implementation | Gap |
|---|---|---|
| §11.10(a) validation | Automated test suite (189 tests), conformance kit, known-value tests | No IQ/OQ/PQ package; no formal validation plan |
| §11.10(b) accurate and complete copies | Every artefact versioned in `artifacts`; reports in Markdown and JSON; bundles as zips with manifests | No PDF/A rendering |
| §11.10(c) record protection | Content-addressed file store, re-hashed on read; append-only artefacts | No backup or retention policy |
| §11.10(d) limited system access | Authenticated API; role checks on every kernel operation | In-memory sessions; no account lockout; no password rotation |
| §11.10(e) audit trail | Hash-chained ledger: actor, UTC time, action, payload hash, reason; failed logins and rejected uploads recorded | Ledger is in the same database as the data; external anchoring of the head hash is not built |
| §11.10(f) operational checks | Lifecycle state machine enforces sequence; GLP approval gate | — |
| §11.10(g) authority checks | Role-held checks; human-only signing; attestation roles cannot be granted to agents | — |
| §11.50 signature manifestation | Signer name, role, meaning, UTC time, statement and subject hash recorded and shown with the report | — |
| §11.70 signature/record linking | Signature binds the SHA-256 of the exact report or determination; a regenerated report invalidates prior signatures for approval | — |
| §11.100 unique signatures | Unique principal ids | No identity verification procedure |
| §11.200 two components, re-authentication | Password re-verified at every determination, signature and approval | Single component (id + password); no second factor |
| §11.300 password controls | scrypt hashing; minimum length 12 | No expiry, history or lockout |

## 10.3 ALCOA+

| Principle | How HOS addresses it |
|---|---|
| Attributable | Ledger actor on every change; return files must name laboratory and analyst; inputs record who entered them |
| Legible | Structured JSON plus rendered Markdown reports |
| Contemporaneous | Server-set UTC timestamps |
| Original | Raw files stored by SHA-256; the ledger is the original record of every state change |
| Accurate | Strict ingest; unit algebra; known-value-tested methods |
| Complete | Rejected uploads and refused approvals are recorded; corrections are new versions that name a reason |
| Consistent | Single lifecycle; determinism checks |
| Enduring / Available | Database plus content store (single node today) |

## 10.4 GLP (21 CFR Part 58) attestation

- **Study Director** (§58.33, "overall responsibility for ... the interpretation, analysis,
  documentation and reporting of results"). Owns the NOAEL determination and the approval
  signature.
- **Quality Assurance** (§58.35). Its compliance statement is required on the report for GLP
  approval.
- **Attending Veterinarian and Qualified Person.** Modelled as roles; no workflow uses them yet.

## 10.5 Regulatory standards emitted

- **CTD Module 4 skeleton.** Built per ICH M4S(R2) section 4 from approved studies.
- **Not yet implemented: CDISC SEND.** SEND is required by CDER for repeat-dose, CV/respiratory
  safety pharmacology, EFD and in vivo genotoxicity studies. FDA's March 2026 Technical
  Conformance Guide Appendix I emphasises traceability to raw data and the study report, which
  the provenance ledger is designed to supply (`docs/research/preclinical_lab_os.md` §5.2).

## 10.6 Before any GxP use

Required before HOS could hold a GxP record:
- a validation package (IQ/OQ/PQ);
- PostgreSQL with Alembic migrations;
- backups and retention;
- a shared session store with lockout and MFA;
- external anchoring of the ledger head;
- PDF/A report rendering;
- SOPs for account management and change control;
- a supplier audit of the deployment environment.

FDA's January 2025 draft guidance on AI to support regulatory decision-making applies to AI that
produces nonclinical safety data. Any future predictive model would need its credibility
assessment documented (`docs/research/preclinical_lab_os.md` §5.6).
