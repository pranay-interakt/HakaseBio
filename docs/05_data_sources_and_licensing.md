# 05 — Data Sources & Licensing

Real databases only. Each client is written against the source's **documented API contract**, with
caching, rate-limit handling, and an honest `UNAVAILABLE` path. No source is faked in application code.
Licensing must be checked by counsel before commercial launch; the posture below is the engineering
team's working understanding, not legal advice.

## 5.1 Primary sources (build clients for these)

**Implemented (2026-10-11):** ChEMBL (molecule by InChIKey, activities incl. hERG CHEMBL240) and
PubChem PUG-REST (properties by InChIKey) in `hos/data_sources/`, with caching, rate limiting,
explicit status, censored-value preservation and fixtures recorded from the live APIs. The other
sources below are planned.

| Source | Access | What we use it for | Licensing posture (verify) |
|--------|--------|--------------------|-----------------------------|
| **ChEMBL** | REST API + bulk download (EBI) | Measured bioactivities, assays, mechanism, known hERG/ADME data for reference & benchmarking | **CC BY-SA 3.0** — share-alike; implications for commercial derivatives — **review carefully** |
| **PubChem** | PUG-REST / PUG-View (NCBI) | Structures, identifiers, properties, bioassay cross-refs | **Public domain** (works of US gov / open) |
| **UniProt** | REST | Target sequences, function, cross-refs | CC BY 4.0 |
| **Open Targets** | GraphQL API + downloads | Target–disease evidence, genetics, tractability | CC0 / open |
| **openFDA** | REST | Labels, adverse events, recalls | Public domain |
| **Drugs@FDA + FDA review PDFs** | Web / bulk | **Nonclinical review packages of approved drugs** — precedent for study design & gap analysis | Public domain (US gov) |
| **EMA EPARs** | Web | European assessment reports — nonclinical precedent | Open (EMA terms) |
| **Therapeutics Data Commons (TDC)** | Python package / downloads | Curated, ML-ready ADMET & tox datasets for model training/benchmark | Mixed per dataset — **check each** |
| **Tox21 / ToxCast (EPA)** | Downloads / API | High-throughput tox baselines | Public domain |
| **DepMap** | Downloads | Target essentiality (CRISPR) for target validation | CC BY 4.0 (verify) |
| **PDB / AlphaFold DB** | REST / downloads | Experimental & predicted structures | CC0 / CC BY 4.0 |
| **Ontologies**: ChEBI, Uberon, Cell Ontology, NCIt, UBERON, UO (units) | OLS / downloads | Annotation at capture (the open gap) | Open |
| **Lombardo human PK dataset** | Supplement / compiled | Human clearance/Vd/t½ benchmarks for IVIVE validation | Published dataset (cite) |

> **Flagged for legal review before commercial use:** ChEMBL's **share-alike** term, DrugBank (needs a
> commercial license — only include if licensed), and any TDC sub-dataset with a restrictive license.

## 5.2 The high-value, under-exploited source: FDA/EMA nonclinical reviews

When a drug is approved, FDA (and EMA) publish the reviewers' write-up of the nonclinical package —
studies run, species, NOAEL, findings, how the first human dose was chosen. Thousands of **worked
examples of exactly what HOS helps users produce**, sitting as PDFs. Structuring this corpus powers:
- precedent-based study design ("what did comparable approvals actually run?"),
- gap analysis ("what will FDA likely ask?"),
- benchmarking a candidate's parameters against approved drugs.

Engineering: a pipeline that fetches the review PDFs, extracts structured facts (study type, species,
doses, NOAEL, findings) with a parser + LLM-assisted extraction **whose outputs are provenance-tagged
to the exact source PDF + page**, and stores them queryable. Extraction confidence is recorded; nothing
becomes an authoritative claim without the source link.

## 5.3 Client design rules

- Each source gets a module `data_sources/<source>/client.py` implementing a common
  `DataSourceClient` protocol: `fetch(...) -> SourceResult` where `SourceResult` carries the raw
  response, the parsed `Quantity`/record **with provenance = `LITERATURE`/`MEASURED` + source URL +
  retrieval timestamp**, and a status (`OK`/`NOT_FOUND`/`RATE_LIMITED`/`UNREACHABLE`).
- **Caching:** local cache (Postgres + object store) keyed by query, with TTL and an explicit
  "refresh" path. Cached values keep their original retrieval timestamp in provenance.
- **Offline/blocked:** if the source is unreachable, return `UNAVAILABLE` with reason — never a guess.
  (Note: the authoring sandbox blocks these hosts; they are reachable from a normal network / the
  user's machine. Clients must therefore be environment-agnostic and fail honestly.)
- **Contract tests:** fixtures captured from real responses (dated, source URL recorded) under
  `tests/fixtures/`; a scheduled live contract test detects schema drift.
- **Attribution:** store and, where required (CC BY / BY-SA), display source attribution.

## 5.4 Identifiers & ontologies (interoperability)

- Chemical identity: **InChIKey** (dedup hash), SMILES, plus UNII where available.
- Biologics: **HELM** for sequence/biopolymer identity (later modalities).
- Annotate entities with ontology terms (ChEBI compound class, Cell Ontology, Uberon tissue, NCIt) —
  **at capture**, via an annotation agent, reviewable, never blocking. This is the "largest open gap"
  from the market analysis and a cheap differentiator.
- Units: encode with a units ontology (UO) / `pint`-style unit checking so unit errors are impossible.

## 5.5 Standards we emit (not just consume)

- **CDISC SEND** for nonclinical tox (the one preclinical standard with regulatory teeth) —
  generated **continuously** as studies run, validated against the Technical Rejection Criteria before
  submission. Target SENDIG versions per the live FDA Study Data Standards Catalog (verify at build).
- **CTD Module 4** structure for the nonclinical overview/summaries.
