# 14 — Master Build Plan: small molecules, peptides and antibodies, end to end

**Status:** plan. Nothing in this document is built unless it says so.
**Audience:** whoever builds next (Claude Code or engineers). Read `CLAUDE.md` first; every rule
there applies to every item here.
**Basis:** `docs/research/preclinical_lab_os.md` (modality-by-modality lab work, therapeutic areas,
regulatory detail, market) and the current codebase.

## 0. Where we are and what "done" means

Built: kernel, ledger, attestation, ICH study-set compiler, IND readiness and Module 4 assembly,
and four of the thirteen studies needed before first-in-human (metabolic stability, hERG,
repeat-dose toxicity in rodent and non-rodent).

**Definition of "end to end" for a customer:** a biotech can run its entire nonclinical programme
for its modality inside HOS. Each required study is either *run* through a driver or *imported*
from an outside report (clearly labelled), and HOS assembles a Module 4 in which every figure is
traceable. Coverage grows by replacing imported studies with driver-run ones.

**Scope of this plan: small molecules, synthetic peptides and monoclonal antibodies.** Other
modalities (ADCs, oligonucleotides, cell and gene therapy, mRNA/LNP, vaccines, radioligands,
degraders, live biotherapeutics) are deferred; section 4 records what they will need so the
platform work here does not close doors. The order is chosen so that end-to-end becomes true
for small molecules first, then peptides, then antibodies. Each wave is independently shippable.

---

## 1. Platform work that comes before more drivers

These are kernel and product features that several drivers need. **P1 is the single most
important item in this plan**, because it makes end-to-end use possible before the driver library
is complete.

### P1. Study import (external and legacy studies) — **built**

*Implemented in `hos/kernel/imports.py` (`kernel.imports`), `hos/kernel/import_specs.py` (what each requirement must transcribe), readiness/Module 4 in `hos/ind/assembler.py`, API `/api/programs/{id}/imports` and `/api/studies/{id}/import/*`, frontend Import page and import workspace. Tests: `tests/kernel/test_imports.py`.*

A study run outside HOS (at a CRO, before the customer adopted HOS, or of a type with no driver yet)
enters the system as an **imported study**.

- The user creates the study against a requirement from the derived study set, uploads the final
  report (stored by SHA-256 in the FileStore) and any datasets, and enters the key results the
  requirement needs (for example the NOAEL, an IC50, a positive/negative genotoxicity call).
- Each entered value is a `Quantity` with provenance `MEASURED` (or `LITERATURE` for published work),
  `source_name` = the report, `source_record_id` = report SHA-256, and a **mandatory page/table
  reference**. No page reference, no value.
- An agent MAY propose values extracted from the report; a human MUST confirm each one. Unconfirmed
  extractions never become quantities.
- The responsible human signs the import (Study Director and QA for a GLP study). The signature
  statement records that the values were transcribed from the cited report.
- Readiness counts the requirement as `imported` (distinct from `done`); Module 4 includes the report
  reference and the entered values; the verification bundle marks these values as
  *attested from report*, not *recomputed*.
- Imported studies can later be superseded by a driver-run study; history is kept in the ledger.

### P2. Pending results and conditional release (deferred: needed for cell and gene therapy)

Some results arrive long after a decision must be taken (sterility 14 days, replication-competent
virus 4–6 weeks). Add a result slot with an expected-by date and a state machine:
`pending -> received -> pass | fail`, and a **conditional release** state for a lot that is
released before a slow test completes, with mandatory notification and recorded disposition if the
test later fails. Required for cell and gene therapy (Wave F).

### P3. Time-dependent quantities (deferred: needed for radioligands)

Radioactive activity decays: `A(t) = A0 * exp(-lambda * t)`, `lambda = ln(2) / t_half`. Add a
`DecayingQuantity` whose value is defined at a reference time and which converts to any other time
with the conversion recorded. Required for radioligands (Wave G).

### P4. Modality-native entities

- **Biologic sequence** (protein/antibody; FASTA, and HELM for non-natural chemistry) with format,
  isotype, and engineered mutations.
- **Composite substance** for ADCs (antibody + linker-payload + drug-to-antibody ratio
  *distribution*, not a single number) and LNPs (nucleic acid + lipid components with ratios).
- **Vector** (capsid/serotype, genome, integrating yes/no) and **cell product** (autologous or
  allogeneic, donor/patient identifier, chain of custody).
- **Surrogate molecule** linked to its clinical candidate (oligonucleotides and species-specific
  biologics run tox on a surrogate).

### P5. SEND export — **built** (repeat-dose toxicity with its toxicokinetic study)

*Implemented in `hos/send/` (XPORT v5 writer and reader, SENDIG v3.1.1 metadata and SEND CT 2026-09-25 as
packaged reference data, domain builder, Define-XML 2.1 with schema validation, pre-export checks, package
assembly, kernel service). The Study Director's protocol signature fixes STSTDTC (`kernel.sign_protocol`). API:
`POST /api/studies/{id}/protocol/sign`, `GET|POST /api/studies/{id}/send-export`, `GET /api/send/terms`. The
frontend has a SEND export panel and protocol approval on the study page. Tests: `tests/send/`. Built: TS, TX,
DM, EX, DS, BW, FW, LB, OM, PC and PP, define.xml, and an nSDRG draft (Markdown; the PHUSE v1.2 template could
not be retrieved). Not built: CL, MA and MI, because no driver holds clinical-observation or pathology data
yet; and safety-pharmacology SEND, which needs the SENDIG-SP domains. The FDA validator is not run. Details:
`docs/04` §4.22 and `docs/research/send_export.md`.*

FDA requires SEND datasets for nonclinical toxicology. Generate them from the repeat-dose and
safety studies: TS, TX, DM, EX, DS, BW, FW, CL, LB, MA, MI, OM (and others as drivers add
endpoints), plus define.xml and the Nonclinical Study Data Reviewer's Guide. Target the SENDIG
version FDA's Study Data Standards Catalog requires at build time, and validate against FDA's
Technical Rejection Criteria before export. Verify the current required versions from the FDA
catalog; do not assume.

### P6. Nonclinical summaries

Draft CTD Module 2.6 tabulated summaries and a 2.4 overview from approved and imported studies.
Every number links to its source; the agent drafts; a named human signs.

### P7. Hostable application

The owner will handle infrastructure. The application must support it:
Alembic migrations (no `create_all` in production), PostgreSQL, an S3-compatible FileStore backend,
organisation tenancy with per-organisation roles, CRO guest accounts scoped to specific studies,
OIDC single sign-on hook, audit-trail export, and backup/restore that re-verifies the ledger chain
after restore.

### P8. Validation package

Generate per release: requirements-to-test traceability matrix from the test suite, IQ/OQ scripts
with expected results, release notes, and known-issues list. This reduces, not removes, a customer's
GxP validation effort.

### P9. Verification bundle and verifier — **built**

*Every Module 4 zip carries `verification/` (raw files, driver ids and versions, parameters, inputs, compound structure, programme context, recorded protocol/data/analysis/report hashes, determinations, signatures, the full ledger chain and the programme's entries). `hos-verify <zip>` (`hos/verify/`) re-runs every driver offline and checks every hash, the ledger chain and signature bindings; imports are checked on report hash and signatures. Also `GET /api/files/{sha}/verify`, the Module 4 'Verify bundle' button, and CI.*

(Strategy innovation 1.) Module 4 export with a manifest of hashes, methods, versions, signatures
and ledger head; a standalone `hos-verify` that recomputes every driver-run figure from raw files
offline and checks every hash. Imported values are checked for report hash and signature only.

### P10. Regulatory compiler diff and programme rehearsal — **built**

*`hos/core/regulatory/diff.py` (added/removed/lengthened/shortened/re-timed/status/species/GLP, each with its section); `hos/ind/rehearsal.py` (simulated, in memory, parameters only from the user's plan or designed studies; reports missing drivers, design and simulation parameters, inputs, unassigned determinations and the critical path over cited driver prerequisites with unknown durations listed). API `/api/regulatory/diff`, `/api/programs/{id}/what-if`, `/api/programs/{id}/rehearsal`; What-if and Rehearsal tabs.*

(Strategy innovations 2 and 3.) Compare two programme contexts and list added, removed, lengthened
and re-timed studies with guideline sections; run every runnable requirement simulated and report
the critical path, missing drivers, missing inputs and unassigned determinations.

---

## 2. Driver waves

Columns: **Serves** = requirement id(s) in the regulatory engine. **Analysis** = the computation the
driver performs (every method must be cited in `docs/04` and `hos/core/methods.py` before
implementation). **Human determination** = the judgement the driver declares and routes to a role;
the system never makes it. References marked *(verify)* are candidates that must be checked against
the primary source before use, exactly as the existing citations were.

Existing drivers are marked **built**.

### Wave A — complete the small-molecule first-in-human package

When Wave A is done, a small-molecule biotech can run every study it owes before first-in-human
through HOS. This is the first point at which "end to end" is true without imports.

| # | Driver | Serves | Basis | Analysis | Human determination |
|---|---|---|---|---|---|
| A0 | metabolic_stability **built** | adme.metabolic_stability | Obach 1999; Di & Kerns 2016 | Depletion fit, CLint, IVIVE, well-stirred CLh | Positive-control acceptance |
| A0 | herg_patch_clamp **built** | safety.herg | ICH S7B; E14/S7B Q&A | 4PL fit, IC50, free-Cmax margin | — |
| A0 | repeat_dose_toxicity **built** | tox.repeat_dose_* | ICH M3(R2); OECD TG 407/408/409 | Dunnett vs control per endpoint | NOAEL (Study Director) |
| A1 | bioanalytical_validation **built** | bioanalytical.validation | ICH M10 | Weighted calibration regression; accuracy within ±15% (±20% at LLOQ) and precision CV ≤15% (≤20% at LLOQ); selectivity, matrix effect, stability, ISR | Method validated (bioanalytical PI) |
| A2 | toxicokinetics **built** | tox.toxicokinetics | ICH S3A; ICH M10 section 5 | Non-compartmental Cmax, Tmax, AUC(0-t), AUC(0-tau) per animal and day, summarised by dose/sex/day; dose proportionality (power model, Smith et al. 2000 Pharm Res — verified bibliographically and from the abstract; the beta1 interval form checked against the published values in Braeckman 2022 and Shang 2022); observed exposure ratio between days (accumulation ratio only if steady state is determined); ISR | Exposure adequacy for the tox study; steady state (Study Director) |
| A3 | in_vivo_pk **built** | adme.in_vivo_pk | M3(R2) section 3 (due before Phase III) | NCA: Cmax, Tmax, C0 (IV bolus), AUC0-t (stated trapezoidal rule), lambda_z from the scientist-selected terminal phase, t1/2, AUCinf, %extrapolated, MRT, CL (CL/F), Vz, Vss (IV only), F. Definitions from FDA 2022 BA guidance, ICH M13A and EMA BE guideline; equations from Certara Phoenix documentation (secondary) and Benet 2012. Gabrielsson & Weiner 5th ed. (2016) verified bibliographically only, so not cited for content | Terminal-phase selection (entered per profile, signed by the responsible scientist) |
| A4 | plasma_protein_binding **built** | adme.plasma_protein_binding | Equilibrium dialysis (Waters et al. 2008 J Pharm Sci — verified bibliographically and from the abstract; fu equation from the RED device instructions); ICH M12 2.1.2.1 and 7.2 | fu = buffer/plasma per cell, replicate mean (SD), % bound; positive control within 3-fold of its qualified mean (M12 7.2); fu < 1% flagged (M12 2.1.2.1); recovery and stability as reported by the laboratory against criteria stated with their basis (no verified formula or consensus criterion exists) | Reliability of fu < 1% (optional, responsible scientist) |
| A5 | ames **built** | genotox.ames | OECD TG 471 (1997, corrected 2020); ICH S2(R1) | Design checked against TG 471 paragraphs 13, 16, 19-22, 26, 29, 31; revertants per plate (mean, SD) by strain, S9 and concentration; fold over concurrent vehicle shown for information only (no fold threshold exists in TG 471 or S2(R1)); comparison with historical control ranges (a required input); top-dose evidence (cytotoxicity / precipitate); peptide caveat (S2(R1) 5.2.1) | Positive / negative / equivocal (Study Director) |
| A6 | dose_range_finding **built** | tox.dose_range_finding | M3(R2) sections 1.5, 4, Note 1; OECD TG 407 paragraph 50 (incidence format) | Group comparison shared with the repeat-dose driver (descriptive, or Dunnett when stated); per-group incidence of unscheduled deaths and clinical signs; M3(R2) 1.5 facts: limit dose, 50-fold margin, 10-fold / 1 g/day exception from supplied exposures and clinical dose | MTD (against the protocol's stated criteria; M3(R2) defines none), high-dose basis, recommended pivotal doses (Study Director) |
| A7 | in_vitro_potency **built** | pharm.primary | M3(R2) section 2; S7A Note 2 | 4PL potency per assay (Ritz 2015 Eq 2; DeLean 1978) with 95% CI, reference-compound acceptance stated with its basis; relative potency off-target / primary at the 50% level with delta-method CI (Ritz 2015) — no selectivity threshold exists in M3(R2), S7A or S7B | — |
| A8 | safety_pharm_cns **built** | safety.core_battery (part: cns) | ICH S7A 2.3-2.5, 2.7.1 (FOB per Mattsson 1996, modified Irwin 1968 — bibliographic only) | Protocol must cover the five S7A 2.7.1 domains with its own observation list and scoring (the batteries' item lists could not be read); incidence of findings by dose, sex and time; continuous measures (body temperature, motor activity) vs vehicle, descriptive or Dunnett when stated; no incidence statistic (none verified) | Adverse CNS effect; optional no-effect dose (Study Director) |
| A9 | safety_pharm_respiratory **built** | safety.core_battery (part: respiratory) | ICH S7A 2.7.3 (Murphy 1994 bibliographic); minute volume per Lim et al. 2014 (secondary) | Respiratory rate plus tidal volume and/or SpO2 (S7A 2.7.3 requires rate and another measure); tidal volume as reported by the acquisition system; minute volume derived per animal; each dose vs vehicle at each timepoint (descriptive or Dunnett when stated) | Adverse respiratory effect; optional no-effect dose (Study Director) |
| A10 | in_vivo_qt_telemetry **built** | safety.in_vivo_qt; safety.core_battery (part: cardiovascular, when BP is measured) | ICH S7B 2.3.2, 3.1.1, 3.1.3; E14/S7B Q&A 1.1, 3.1-3.5; S7A 2.7.2 | Latin-square crossover; QT correction by a justified choice: individual animal (Q&A 3.3 preference; RR-linear as Chui 2021 / Engwall 2023, reference RR an input), Fridericia, Bazett (formula from Vandenberk 2016 with the attribution caveat), Van de Water (abstract); QTc-RR independence with pairs, slope CI, r, p; change from baseline (time-matched or pre-dose) and from vehicle within animal with 95% CI and p (Student 1908); exposure coverage vs high clinical Cmax; no ms threshold (Q&A 3.4 figures are hypothetical); concentration-QTc modelling not built | QTc conclusion; cardiovascular conclusion when BP is measured (Study Director) |

### Wave B — small molecules through Phase 3 and marketing

| # | Driver | Serves | Basis | Analysis | Human determination |
|---|---|---|---|---|---|
| B1 | in_vitro_micronucleus | genotox.chromosomal | OECD TG 487; ICH S2(R1) | Micronucleated-cell frequency vs concurrent and historical controls; cytotoxicity limits | Positive / negative / equivocal |
| B2 | in_vivo_micronucleus | genotox.full_battery | OECD TG 474 | Micronucleated erythrocyte frequency; exposure confirmation | Positive / negative |
| B3 | cyp_inhibition | DDI package | ICH M12 (2024) *(verify)* | IC50 per isoform (4PL); time-dependent IC50 shift; Ki where designed | — |
| B4 | cyp_induction | DDI package | ICH M12 *(verify)* | Fold-change mRNA vs vehicle and positive control; EC50/Emax | — |
| B5 | transporter_inhibition | DDI package | ICH M12 *(verify)* | IC50 per transporter | — |
| B6 | permeability | absorption | Hubatsch et al. 2007 Nat Protoc *(verify)* | Papp = (dQ/dt)/(A x C0); efflux ratio; monolayer integrity QC | — |
| B7 | solubility | developability | Di & Kerns 2016 | Kinetic and thermodynamic solubility with pH and medium recorded | — |
| B8 | hepatocyte_stability | adme.metabolic_stability (alt.) | Obach 1999; Barter 2007 (hepatocellularity) | Depletion fit; scaling by hepatocellularity per gram liver | Positive-control acceptance |
| B9 | metabolite_profiling | adme.metabolite_profiling | FDA *Safety Testing of Drug Metabolites* *(verify revision)* | Human vs animal exposure comparison against the 10% threshold | Disproportionate metabolite call |
| B10 | embryo_fetal_development | dart.efd | ICH S5(R3) | Litter-based statistics (litter as the unit) for fetal endpoints; maternal endpoints | Developmental NOAEL |
| B11 | fertility | dart.fertility | ICH S5(R3) | Mating, fertility and early embryonic indices | NOAEL |
| B12 | pre_postnatal_development | dart.ppnd | ICH S5(R3) | F1 survival, growth, development, reproduction | NOAEL |
| B13 | carcinogenicity | carc.bioassay | ICH S1B(R1) | Tumour incidence by site with trend and pairwise tests (method to select and cite) ; supports the weight-of-evidence assessment | Carcinogenic potential |
| B14 | phototoxicity_3t3_nru | photo.assessment | ICH S10; OECD TG 432 | Photo-irritation factor and mean photo effect from paired ±UVA curves | — |
| B15 | tdar_immunotoxicity | immunotox | ICH S8 | Antigen-specific antibody response vs control | Immunotoxic signal |
| B16 | juvenile_toxicity | tox.juvenile | ICH S11 | Repeat-dose analysis with developmental endpoints | NOAEL |
| B17 | local_tolerance | tox.local_tolerance | M3(R2) section 6 | Graded local reaction scores by site and time | Tolerability |

### Wave C — biologics (ICH S6(R1))

The regulatory engine already derives the biologics study set; these drivers run it.
Requires P4 (sequence entities).

| # | Driver | Serves | Basis | Analysis | Human determination |
|---|---|---|---|---|---|
| C1 | binding_kinetics_spr | pharm.primary; bio.species_relevance | 1:1 Langmuir binding model *(cite)* | Global fit of ka, kd, KD; residual QC | — |
| C2 | species_cross_reactivity | bio.species_relevance | ICH S6(R1) section 3.3 | KD and functional EC50 ratios across species | Pharmacologically relevant species (responsible toxicologist) |
| C3 | tissue_cross_reactivity | bio.tissue_cross_reactivity | ICH S6(R1) | Structured staining record by tissue, intensity and cell type | Interpretation (pathologist) |
| C4 | anti_drug_antibody | bio.immunogenicity | FDA 2019 ADA assay guidance *(verify)*; Shankar et al. 2008 *(verify)* | Screening cut point, confirmatory, titre, neutralising tiers | ADA impact on exposure and findings |
| C5 | cytokine_release | bio.cytokine_release | EMA FIH guideline 2017 | Per-donor fold change vs negative and positive controls | Cytokine release risk |
| C6 | fc_receptor_binding | pharmacology | *(cite)* | Affinity per Fc-gamma receptor and FcRn at the stated pH | — |
| C7 | mabel_starting_dose | FIH dose | EMA FIH guideline 2017 | Receptor occupancy RO = C/(C + KD) and exposure-response route to MABEL; lowest of NOAEL-HED, PAD, MABEL governs | Starting dose (medical/clinical lead) |
| C8 | nhp_repeat_dose | tox.repeat_dose | ICH S6(R1) | Repeat-dose analysis for small groups: individual-animal review and descriptive statistics where n is too small for Dunnett | NOAEL |
| C9 | enhanced_ppnd | dart.biologic | ICH S6(R1) section 3.8 | NHP pregnancy outcome and infant endpoints | NOAEL |

### Wave P — synthetic peptides

Peptides reuse the small-molecule drivers (Wave A). They add one driver and one regulatory fix.

| # | Item | Basis | What it does | Human determination |
|---|---|---|---|---|
| P-1 **built** | **Regulatory routing fix** (engine, not a driver) | 21 CFR 600.3(h)(6) and 85 FR 10057 (protein: greater than 40 amino acids, summed over chains associated as in nature); ICH S6(R1) section 1.3 and M3(R2) section 1.3 (scope by biotechnology origin). The originally named source, 21 CFR 314.3, holds no peptide definition | Two separate facts. (1) US classification from amino acids per chain: protein (a biological product) or not; pending when the count or the chain association is unknown. (2) ICH routing by manufacturing origin, not length (no ICH text draws a 40-amino-acid line): recombinant peptides take the S6(R1) set; chemically synthesised peptides take M3(R2), with the S6(R1) species-relevance and ADA items conditional until a signed determination; an unknown origin makes the set conditional on it | Whether S6(R1) principles apply to a chemically synthesised peptide (responsible scientist, signed) |
| P-2 **built** | peptide_stability | Böttger et al. 2017; Cavaco et al. 2021; Nguyen et al. 2010; Di 2015; FDA draft peptide guidance 2023; GraphPad one-phase decay (equation). Di & Kerns 2016 could not be read, so it is not cited | Intact peptide in stated blood, serum or plasma conditions (every matrix fact required); first-order or one-phase decay fit, declared by the protocol, with 95% CIs; plateau check; censoring beyond the last sample; species compared only for conditions matched in everything else. Protease panels are not built: no source defines one | — |
| P-3 | Immunogenicity, when warranted | ICH S6(R1) for long peptides; case by case otherwise | Reuses the anti-drug antibody driver (C4) | Whether ADA assessment is warranted |

Peptide CMC attributes (purity, counterion, related substances) belong in Module 3, which is out of
scope here.

### When each claim becomes true

| After | A customer can | Honest demo claim |
|---|---|---|
| P1 import + existing drivers | Track every required study in HOS; run 4, import the rest | "Your whole IND lives here; four studies run natively today" |
| Wave A + P5 SEND | Run every small-molecule first-in-human study in HOS, with SEND for tox | "End to end for small molecules before first-in-human" |
| Wave P | Same for synthetic peptides, with correct routing for long peptides | "End to end for small molecules and peptides" |
| P4 + Wave C | Run every antibody first-in-human study, with MABEL dosing | "End to end for small molecules, peptides and antibodies" |
| Wave B | Carry small molecules and peptides through to marketing | "From candidate to marketing package" |

---

## 3. Build order for this scope

1. **P1 study import.** Makes the system usable end to end immediately.
2. **P9 verification bundle** and **P10 compiler diff and rehearsal.** The strategic differentiators.
3. **Wave A** in table order (A1 bioanalytical validation first: toxicokinetics depends on it).
4. **P5 SEND export**, once A2 toxicokinetics exists alongside repeat-dose toxicity.
5. **Wave P.**
6. **P4 sequence entities**, then **Wave C** (C1 and C2 first: species relevance gates every other antibody study).
7. **P6 nonclinical summaries.**
8. **P7 hostable application** and **P8 validation package**, in parallel with the above as the
   owner's infrastructure work requires.
9. **Wave B.**

---

## 4. Deferred modalities: what they will need

Recorded so that platform choices made now do not block them later.

| Modality | Platform needs | Driver families |
|---|---|---|
| Antibody-drug conjugates | P4 composite substance with a DAR distribution | DAR by HIC (area-weighted average DAR), free payload, three-analyte bioanalysis, linker plasma stability, bystander cytotoxicity; payload genotox via Wave A/B drivers |
| Oligonucleotides | P4 surrogate molecules | Knockdown potency, complement activation in NHP, tissue PK |
| Cell and gene therapy | P2 pending results and conditional release; P4 vectors and cell products with chain of custody | Biodistribution (copies per microgram gDNA), vector copy number, shedding, tumorigenicity, integration site analysis, potency, release panel, full/empty ratio, replication-competent virus |
| mRNA/LNP | P4 composite (nucleic acid + lipids) | Encapsulation efficiency, particle size and dispersity, integrity, in vitro expression |
| Vaccines | — | Binding and neutralising titres (4PL ID50; Reed and Muench 1938 for TCID50 *(verify)*) |
| Radioligands | P3 decaying quantities | Radiochemical purity, decay-corrected activity, dosimetry import |
| Degraders | — | DC50/Dmax with hook effect (model to select and cite before building) |
| Therapeutic-area efficacy models | — | Tumour growth inhibition, survival (Kaplan and Meier 1958 *(verify)*; log-rank), diet-induced obesity body composition, CNS behaviour, brain Kp,uu, antimicrobial MIC (CLSI M07 *(verify)*) |

---

## 5. Definition of done for every driver

Copied from what the four existing drivers already meet:

1. Protocol research note in `docs/research/drivers/<driver_id>.md` citing the guideline and the
   method sources, with every citation verified against the primary source.
2. Parameters model with **no scientific defaults**: values with a scientific meaning are required
   inputs with their stated basis.
3. Data template with units in the header; ingest validates strictly and records the raw file hash.
4. Analysis implemented as pure functions in the scientific core where reusable, each with a
   **known-value test** (a published worked example where one exists, otherwise an exact synthetic
   case with an analytical solution).
5. Expert determinations declared and routed; interpretation contains only cited, rule-based
   statements; anything requiring judgement is listed, never decided.
6. Simulation generator (SIMULATED provenance, seeded, parameters recorded).
7. Passes the conformance kit; mapped to its requirement ids so readiness counts it.
8. Renders in the frontend with provenance badges.

---

## 6. Citations named in this plan that must be verified before use

Smith et al. 2000 (dose proportionality); Gabrielsson & Weiner (NCA reference, edition); Waters et
al. 2008 (rapid equilibrium dialysis); ICH M12 (drug interaction studies, 2024); Hubatsch et al.
2007 (Caco-2 permeability); FDA *Safety Testing of Drug Metabolites* (current revision); FDA 2019
anti-drug antibody assay guidance; Shankar et al. 2008 (ADA cut points); the 40-amino-acid line
(verified: it is 21 CFR 600.3(h)(6), the definition of protein, not 21 CFR 314.3); Reed and Muench 1938; Kaplan and Meier 1958; CLSI M07; a primary reference for the 1:1
Langmuir binding model and for tumour incidence statistics. Any that cannot be verified are not
used; the method waits until a verifiable source is found.
