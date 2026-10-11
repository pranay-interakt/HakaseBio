# 09 — Scientific Integrity & Validation

> Status: describes enforced behaviour and the verification performed on 2026-10-11.

## 9.1 Integrity rules and where each is enforced

| Rule | Enforcement point | Test |
|---|---|---|
| No value without provenance | `Quantity` constructors; `Provenance.__post_init__` | `tests/core/test_quantity.py` |
| Computed values cite a method; methods cite a source | `Provenance`, `Method.__post_init__` | same; `test_citations.py` |
| Predictions carry an applicability check; out-of-domain is flagged | `Provenance.predicted`, `Quantity.predicted` | `test_adme.py` (fu,mic domain) |
| Gaps are UNAVAILABLE with a reason, never defaulted | constructors; every core function; IVIVE for species without verified scalars | `test_adme.py`, driver tests |
| Constants are cited data with a version | `reference_params` registry; `parameter_set_version` on results | `test_pharmacology_dose.py` (FDA, Davies & Morris values) |
| Unverified constants are visible | `requires_verification` → QC flag on every derived value | `test_adme.py` |
| Simulated data never become evidence | `ProvenanceKind.admissible_as_evidence`; `SIMULATION_TAINT`; base-driver taint; kernel hash registry; approval gate; Module 4 scan | conformance kit, `test_kernel.py`, `test_ind.py` |
| Interpretation is cited and never decides judgement calls | `StudyDriver.interpret` check; `ExpertDetermination` | conformance kit; `test_repeat_dose_tox.py` |
| Determinism | content hashes exclude wall-clock time; the kernel re-runs drivers before dispatch and report; Dunnett QMC seed | `test_kernel.py`, `test_repeat_dose_tox.py` |
| Raw data are original and tamper-evident | SHA-256 per file, content-addressed store re-hashed on read, hash-chained ledger | `test_kernel.py` (tamper) |
| Data contracts are strict | `parse_return_file` and driver `validate_records` | `tests/drivers/test_ingest.py` and driver tests |
| QC thresholds are stated with a basis, not defaulted | `fit_depletion` / `fit_hill` take thresholds as required arguments; drivers take them from the protocol along with their basis | driver tests |

## 9.2 Validation approach

- **Known values come from the source, not the code.** Examples:
  - FDA 2005 Table 1/3 Km factors and reference weights;
  - Davies & Morris 1993 Table I/III per-kg values;
  - Barter 2007 and Smith 2008 MPPGL;
  - the analytical limits of the well-stirred model (flow-limited and capacity-limited);
  - exact half-life and IC50 recovery from noise-free first-order and 4PL data;
  - Dunnett's 1955 worked example;
  - RDKit descriptors for aspirin, caffeine, metformin and atorvastatin.
- **Negative tests for every integrity rule.** A forbidden object must fail to construct, and a
  forbidden transition must raise.
- **Drivers.** Each must pass the shared conformance kit (`docs/08` §8.2) and have its own
  known-value tests.
- **External data.** Clients are tested against responses recorded from the live APIs, with
  capture time and body hash in each fixture; `pytest -m live` re-checks the contract.
- **The whole system.** The kernel, API and demo smoke tests exercise the full flow.

Test count at the end of build step 11: **189 offline tests + 1 live contract test**, all passing.

## 9.3 What the system will not do

- It does not set a NOAEL, call a change adverse, or declare a hERG margin "safe" without a
  user-supplied, reference-drug-based threshold.
- It does not fill a missing input (fu,p, B:P, free Cmax, MPPGL for a species) with a typical
  value.
- It does not estimate study cost.
- It does not treat a database value with a censoring relation (`>`, `<`) as a point estimate.

## 9.4 Primary-source verification record (2026-10-11)

Full records: `docs/research/reference_params_verification.md`,
`docs/research/driver_protocols.md`.

**Citations.**
- All 15+ journal entries were checked against Crossref by DOI. One error was found: Obach 1999
  covers *twenty-nine* drugs, not twenty-five.
- All ICH entries were checked against the official PDFs, and their Step 4 dates and URLs are
  recorded.

**Guideline sections.** 25 section references in the study-set engine were wrong and have been
corrected. Examples:
- genotoxicity is M3(R2) §9, not §7;
- in vitro IKr is S7B §§2.3.1/3.1.2, not §3.1;
- S9 safety pharmacology is §2.2;
- S6(R1) numbering now distinguishes the parent text from the 2011 addendum.

The six-month carcinogenicity trigger is ICH S1A §4.1, not S1B(R1). Every CTD section the engine
or a driver can emit was validated against ICH M4S(R2).

**Reference parameters (registry 2026.10.2).**
- *Wrong values corrected:*
  - mouse Qh 131 → 90 mL/min/kg;
  - rabbit Qh 177 (absolute mL/min) → 70.8 mL/min/kg;
  - rat liver weight 36.6 → 40 g/kg;
  - mouse liver weight 55 → 87.5 g/kg;
  - mini-pig reference weight 20 → 40 kg.
- *Re-sourced:*
  - human MPPGL is now the Barter 2007 consensus of 32 mg/g (40 mg/g is kept as the Hakooz 2006
    alternative);
  - rat MPPGL 61 and dog MPPGL 55 mg/g from Smith 2008.
- *Units corrected:* Km factors now carry kg/m².
- *Removed:* mouse and monkey MPPGL, which have no primary determination.
- *Still flagged:* human liver weight 21.4 g/kg.

**Model domain.** The fu,mic applicability domain was an unsourced "−2 to 7"; it is now the
Gertz 2008 evaluation (logP/D 0–3, or < 5 at ≤ 0.1 mg/mL protein).

**FDA 2005 Step 5.** The PAD-derived HED is compared with the MRSD and flagged when lower
(§VIII says lowering "may be appropriate"). It is no longer applied automatically.

## 9.5 Open verification items

- **Human liver weight (21.4 g/kg).** No primary source has been traced.
- **Extraction-ratio bands (0.3 / 0.7).** Attributed to Wilkinson & Shand 1975 via secondary
  sources; the primary text has not been inspected.
- **Hallifax & Houston 2006.** The coefficients were confirmed via a published reproduction; the
  commentary itself is paywalled.
- **OECD TG 409.** The parameters were read from a mirrored copy carrying the official header.
- **Paywalled sources.** Obach 1999 Methods, Di & Kerns 2016, Milnes 2010 and OECD GD 116 have
  not been read.
