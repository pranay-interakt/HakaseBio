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

### P5. SEND export

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
| A3 | in_vivo_pk | adme.in_vivo_pk | M3(R2) section 3 | NCA: Cmax, Tmax, AUC0-t (linear-up/log-down trapezoid), lambda_z, t1/2, AUCinf, CL, Vss, F (Gabrielsson & Weiner, *Pharmacokinetic and Pharmacodynamic Data Analysis* *(verify edition)*) | Terminal-phase point selection |
| A4 | plasma_protein_binding | adme.plasma_protein_binding | Equilibrium dialysis (Waters et al. 2008 J Pharm Sci *(verify)*) | fu = buffer/plasma; recovery and stability QC | — |
| A5 | ames | genotox.ames | OECD TG 471 | Revertants per plate by strain and S9; fold increase over concurrent negative control; dose-response; historical control ranges as a required input | Positive / negative / equivocal (Study Director) |
| A6 | dose_range_finding | tox.dose_range_finding | M3(R2) sections 1.5, 4 | Short repeat-dose analysis reusing the tox driver | MTD and recommended pivotal doses |
| A7 | in_vitro_potency | pharm.primary | M3(R2) section 2 | 4PL potency, selectivity ratios against off-targets | — |
| A8 | safety_pharm_cns | safety.core_battery (CNS) | ICH S7A | Irwin / functional observational battery incidence by dose and time | Adverse CNS effect (Study Director) |
| A9 | safety_pharm_respiratory | safety.core_battery (resp.) | ICH S7A | Plethysmography: rate, tidal and minute volume vs vehicle, time-matched | Adverse effect (Study Director) |
| A10 | in_vivo_qt_telemetry | safety.in_vivo_qt | ICH S7B; E14/S7B Q&A 2022 | Individual-animal QT/RR correction; time-matched change from baseline vs vehicle; exposure-response | QT liability call (Study Director) |

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
| P-1 | **Regulatory routing fix** (engine, not a driver) | FDA definition of a peptide in 21 CFR 314.3: 40 or fewer amino acids *(verify current text)* | Add `amino_acid_count` to `ProgramContext`. Peptides of 40 or fewer amino acids follow M3(R2) small-molecule rules; longer chains follow S6(R1) biologics rules. If the count is unknown, the routing is `CONDITIONAL` with the missing fact named. Today every peptide gets small-molecule rules, which is wrong for long peptides | — |
| P-2 | peptide_stability | Di & Kerns 2016 | Plasma and serum stability across species, and protease panels where designed; reuses the first-order depletion fit with the matrix and enzyme recorded | — |
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
anti-drug antibody assay guidance; Shankar et al. 2008 (ADA cut points); 21 CFR 314.3 peptide
definition; Reed and Muench 1938; Kaplan and Meier 1958; CLSI M07; a primary reference for the 1:1
Langmuir binding model and for tumour incidence statistics. Any that cannot be verified are not
used; the method waits until a verifiable source is found.
