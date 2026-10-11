# SEND export (build plan item P5): primary-source verification

Checked on 2026-10-11. No repository file other than this note was edited.

Scope: what FDA currently requires for SEND, how datasets must be formatted, what the Technical Rejection
Criteria (TRC) check, and the SENDIG domain specifications for the 12 domains named in P5
(TS, TX, DM, EX, DS, BW, FW, CL, LB, MA, MI, OM).

Status words used below:
- **VERIFIED**: I read the primary source text and the value or quote matches.
- **VERIFIED (secondary access path)**: the content is CDISC's own, but I read it from a machine-readable copy
  rather than the CDISC PDF. Details in section 3.
- **NOT VERIFIED**: I could not read the primary source. The reason is given.

Downloaded copies are in the session scratchpad (not committed). SHA-256 values are recorded so a later
reviewer can confirm they read the same bytes.

---

## 0. Summary for the implementer

1. **Which SENDIG to target.** For CDER commercial INDs, SENDIG v3.1.1 has a requirement date of
   March 15, 2023. SENDIG v3.1 has no support-end date in the catalog. SENDIG v3.0 support ended for studies
   started after 03/15/2020 for INDs. The latest catalog is **v11.0 (March 2025)** and it was still current
   when I checked on 2026-10-11. **Recommendation: target SENDIG v3.1.1 (SDTM v1.5), Define-XML v2.1, and
   SAS XPORT v5.** For the 12 P5 domains, v3.1 and v3.1.1 are identical (section 3.2), so 3.1.1 costs nothing
   extra.
2. **Study start date (STSTDTC) decides the requirement.** For nonclinical studies, FDA defines the study
   start date as the date the Study Director signs the protocol. This is a GLP attestation fact. It must come
   from the signed protocol record, never be inferred.
3. **What the TRC check at the gateway** (eCTD v3.2.2 error codes): 1734 (ts.xpt with study start date
   present), 1735 (correct STF file tags), 1736 (SEND DM dataset and define.xml present), and 1789 (STF
   present). All four are severity **High**, which means the submission is "considered not received". 1737 and
   1738 (Study ID matches STUDYID or SPREFID in ts.xpt) are Medium.
4. **Package.** One study per package containing the datasets, nsdrg.pdf and define.xml, in
   `m4\datasets\[study]\tabulations\send`. Every row of every dataset carries the same STUDYID. One dataset per
   `.xpt` file, named by the lower-case domain code. Files must not be compressed.
5. **nSDRG.** The PHUSE nSDRG template **v1.2 (8 April 2022)** is the current published version. v2.0 is a
   circulated draft (PHUSE Q3 2026 report). FDA "prefers but does not require" the template. I could not
   download the v1.2 package (HTTP 403), so its section headings are NOT VERIFIED (section 5).

---

## 1. FDA Data Standards Catalog: SEND and Define-XML rows

Source: FDA Data Standards Catalog **v11.0**. The guidance page reads "Data Standards Catalog March 2025",
"Final Level 2 Guidance", "Content current as of: 03/24/2025". It was read via WebFetch on 2026-10-11 at
https://www.fda.gov/regulatory-information/search-fda-guidance-documents/data-standards-catalog. The
download link is `/media/185927/download`. The workbook was retrieved by WebFetch (fda.gov blocks plain curl
with an "abuse-detection" redirect). SHA-256 `591ff69a…9c6`. It was parsed with openpyxl.

The Change History sheet's latest row is `2025-03-20 || 11.0`. The Study Data Standards Resources page
(content current as of 09/18/2026) still links to this catalog. A web search found no newer catalog version.

Column headers (sheet "Submission Data Standards", verbatim):
`Use | Standard | FDA Center(s) | Exchange Format | SDO | Property | Related Properties | Date Support Begins [8] | Date Support Ends | Date Requirement Begins [10] [11] | Date Requirement Ends | …`

### 1.1 Catalog rows, verbatim

Some cells are stored as Excel dates. openpyxl renders them as `YYYY-MM-DD 00:00:00`, and I show them as
`YYYY-MM-DD`. Other cells are text in MM/DD/YYYY form and are shown as written.

| Property | Center | Support begins | Support ends | Requirement begins | Requirement ends | Confidence |
|---|---|---|---|---|---|---|
| SENDIGv3.0 (SEND, XPT, CDISC) | CDER | 2011-06-13 | 03/15/2019 [1] [12] 03/15/2020 [2] [12] | 12/17/2016 [1] 12/17/2017 [2] | 03/15/2019 [1] [12] 03/15/2020 [2][12] | VERIFIED, high |
| SDTMv1.5 (model for SEND) | CDER | 2017-08-21 | (empty) | 03/15/2019 [1] 03/15/2020 [2] | (empty) | VERIFIED, high |
| SDTMv1.5 (model for SEND) | CBER | (empty) | (empty) | (empty) | (empty) | VERIFIED, high (the row is blank) |
| SENDIGv3.1 | CDER | 2017-08-21 | (empty) | 03/15/2019 [1] 03/15/2020 [2] | (empty) | VERIFIED, high |
| SENDIGv3.1 | CBER | 2020-07-14 | (empty) | 2023-03-15 | (empty) | VERIFIED, high |
| SENDIGv3.1.1 | CBER, CDER | 2022-02-15 | (empty) | 2023-03-15 | (empty) | VERIFIED, high |
| SENDIG-Genetox-v1.0 | CBER, CDER | 12/13/2023 [12] | (empty) | 2025-03-15 | (empty) | VERIFIED, high |
| SDTMv1.6 (model for DART) | CDER | 2021-03-05 | (empty) | 03/15/2023 [1] 03/15/2024 [2] | (empty) | VERIFIED, high |
| SENDIG-DARTv1.1 | CDER | 2021-03-05 | (empty) | 03/15/2023 [1] 03/15/2024 [2] | (empty) | VERIFIED, high |
| SDTMv1.8 (Nonclinical, SDTM) | CDER | 2020-03-15 | (empty) | 03/15/2022 [1] 03/15/2023 [2] | (empty) | VERIFIED, high |
| SENDIG-ARv1.0 | CBER | 2024-03-26 | (empty) | 03/15/2027 [1], [2] | (empty) | VERIFIED, high |
| SENDIG-ARv1.0 | CDER | 2020-03-11 | (empty) | 03/15/2022 [1] 03/15/2023 [2] | (empty) | VERIFIED, high |
| Define.xml-v1.0 (Study data definition, XML) | CBER, CDER | Ongoing | 03/15/2018 [12] | 12/17/2016 [1] 12/17/2017 [2] | 03/15/2018 [12] | VERIFIED, high |
| Define.xml-v2.0 | CBER, CDER | 2013-08-07 | (empty) | 12/17/2016 [1] 12/17/2017 [2] | (empty) | VERIFIED, high |
| Define.xml-v2.1 | CBER, CDER | 2020-07-07 | (empty) | 03/15/2022 [1] 03/15/2023 [2] | (empty) | VERIFIED, high |
| SAS Transport File Format (XPORT) v5 (Related property: "SAS Technical Support TS-140") | CBER, CDER | Ongoing | (empty) | 12/17/2016 [1] 12/17/2017 [2] | (empty) | VERIFIED, high |

The terminology sheet has this nonclinical row (verbatim):
`Nonclinical Study Data || Nonclinical study datasets || CBER, CDER || CDISC || NCI-EVS || 06/10/2011 or later || 2011-06-13 || || 12/17/2016 [1] 12/17/2017 [2] || || Standardized Study Data || || Index of CDISC SEND Terminology`

### 1.2 Catalog footnotes, verbatim

| Note | Verbatim text | Confidence |
|---|---|---|
| [1] | "For NDAs, ANDAs, and certain BLAs.  See section II.A of the Providing Regulatory Submissions In Electronic Format — Standardized Study Data guidance document" | VERIFIED |
| [2] | "For certain INDs. See section II.A of the Providing Regulatory Submissions In Electronic Format - Standardized Study Data" | VERIFIED |
| [9] | "The simplified TS.xpt is a specific implementation of the CDISC SDTM standard being utilized by FDA (CDER and CBER) to establish the study start date or indicate that the study is exempted for evaluation by the Specifications for eCTD Validation Criteria. …" | VERIFIED |
| [12] | "If a study started before the support ends date, the study can continue to use this specified version of the standard. If a study starts after the support ends date, the study can NO longer use this specified version of the standard. Sponsors cannot use this version of the standard or terminology after this date. Generally, a waiver process may be available." | VERIFIED |
| Instructions | "Where the Catalog expresses support for more than one standard or terminology for a specific use, the sponsor or applicant may select one to use or can discuss, as appropriate, with their review division." | VERIFIED |
| Column description, Date Support Ends | "An empty field in this column means that a "Date Support Ends" date has not yet been established." | VERIFIED |

**My interpretation, not FDA text:** SENDIG v3.1 and v3.1.1 are both supported, with no support-end date. By the
instruction above, a sponsor may choose either. The Study Data TCG (section 2) lists v3.1.1 as the
requirement for studies started after March 15, 2023.

---

## 2. FDA Study Data Technical Conformance Guide (TCG) and Technical Rejection Criteria

Source: *Study Data Technical Conformance Guide – Technical Specifications Document*, **October 2026, version 6.3**.
The guidance page reads "October 2026", "Final", "Content current as of: 10/08/2026", with download link
`/media/153632/download`. The PDF has 110 pages and PDF metadata CreationDate 2026-10-08. It was retrieved by
WebFetch. SHA-256 `36a08686…893a`. The revision history row reads "October 2026 6.3 Section 4.1.2.11 (ADLB
and ADLC) – Language updated Section 7.1.4 (Electronic File Directory) – Language updated in Table 2 on
subject narratives". Page numbers below are the document's own "Page N of 97".

### 2.1 SEND requirement dates (TCG §4.1.3.2, pp. 20-21)

The TCG reproduces the catalog dates and says (p. 20): "always refer to the FDA Data Standards Catalog for the
most up to date information on data standards requirements."

| Fact | Verbatim (TCG v6.3) | Confidence |
|---|---|---|
| CDER, single-dose, repeat-dose and carcinogenicity studies | "SENDIG v3.0 December 17, 2016 December 17, 2017 / SENDIG v3.1 March 15, 2019 March 15, 2020 / SENDIG v3.1.1 March 15, 2023 March 15, 2023". Columns are "NDAs/BLAs" and "Commercial INDs"; the heading reads "Studies started after the following dates require SEND datasets". | VERIFIED, high |
| CDER, CV and respiratory safety pharmacology | "SENDIG v3.1 March 15, 2019 March 15, 2020 / SENDIG v3.1.1 March 15, 2023 March 15, 2023" | VERIFIED, high |
| CDER, EFD | "SENDIG-DART v1.1 March 15, 2023 March 15, 2024" | VERIFIED, high |
| CDER, in vivo micronucleus and comet | "SENDIG- GeneTox v1.0 March 15, 2025 March 15, 2025" | VERIFIED, high |
| CBER, single, repeat-dose and carcinogenicity | "SENDIG v3.1 SENDIG v3.1.1 March 15, 2023" | VERIFIED, high |

### 2.2 SEND general considerations (TCG §4.1.3)

| Topic | Verbatim (TCG v6.3) | Page | Confidence |
|---|---|---|---|
| Study start date | "For nonclinical studies, study start date (TSPARMCD= STSTDTC) is the date on which the study protocol or plan is approved (signed) by the Study Director, also known as the study initiation date." | 27 | VERIFIED, high |
| Traceability | "It is important that the results presented in the study report and in the accompanying SEND datasets be traceable back to the original data collected and that the results in the SEND datasets can be summarized for meaningful group comparison aligned with the study report." | 19-20 | VERIFIED |
| define.xml for every dataset | "Each submitted SEND dataset should have its contents described with complete metadata in the define.xml file (See section 4.1.4.5) and within the nSDRG as appropriate" | 20 | VERIFIED |
| STUDYID | "All records in all SEND datasets submitted for a study should have the same STUDYID value." | 21 | VERIFIED |
| define.xml StudyName | "For nonclinical studies, the define.xml StudyName element value should contain the sponsor's study identifier, consistent with: • the study identifier [study-id] used in the eCTD study tagging file (STF)…" | 21 | VERIFIED |
| CRO study ID | "the alternate study identifier assigned to the study by the testing facility, which is typically included in the STUDYID field of the SEND datasets, should be included in the ProtocolName element value in define.xml." | 21 | VERIFIED |
| Draft report | "SEND datasets are required when submitting a draft study report" | 22 | VERIFIED |
| Multiple studies in one report | "each study should be submitted with its own SEND package (datasets, nSDRG and define.xml)" | 22 | VERIFIED |
| Timing variables | "Sponsor should use the VISITDY or --NOMDY variable appropriate to the selected SENDIG version to group observations for summary analysis." | 23 | VERIFIED |
| Required variables | "Variables designated as Required in the SENDIG version used for the study submission should be filled for all records." | 24 | VERIFIED |
| Length limit | "Values for variables that do not have a defined maximum length in the SENDIG should not exceed 200 characters." | 24 | VERIFIED |
| LB categorical results | "Categorical, noncontinuous results reported as incidence counts … should be placed in LBSTRESC, and even if the categories are numbers, LBSTRESN should be null." | 25 | VERIFIED |
| LB below LOQ | "the value used for calculation should be submitted using the supplemental qualifier variable LBCALCN." | 25 | VERIFIED |
| LBTESTCD form | "It cannot be longer than eight characters, it cannot start with a number and it cannot contain characters other than letters, numbers and underscores." | 25 | VERIFIED |
| PC below LLOQ | "'BLQ' should be in PCSTRESC … PCSTRESN should be blank … PCLLOQ should be populated with the lower limit of quantitation for the analyte." | 26 | VERIFIED |
| Trial design | "All TDM datasets should be included in SEND submissions as a way to describe the planned conduct of a nonclinical study." | 26 | VERIFIED |
| TX parameters | "Every set in the TX domain should have only one record with each of the following TXPARMCD values: SPGRPCD …, GRPLBL …, PLANMSUB …, and PLANFSUB" | 27 | VERIFIED |
| Recovery and TK sets | "Recovery and/or toxicokinetic animals should be presented in separate Trial Sets from the main animals." | 27 | VERIFIED |
| Missing TS parameter, v3.1 | "it can be included with TSVAL blank and TSVALNF filled for datasets modeled in SENDIGv3.1." | 27 | VERIFIED |
| DOSDUR | "The DOSDUR parameter in TS should be used to indicate the longest planned duration of time between the first day of dosing and the terminal sacrifice … DOSDUR should not include the recovery phase" | 27 | VERIFIED |
| BG | "It is not necessary to include a BG domain in submissions." | 28 | VERIFIED |
| Scope, GLP | "The requirement for SEND is not limited to GLP studies." | 30 | VERIFIED |
| Scope, report status | "The study report status or the finalization of the study report (i.e., draft, interim or final) does not impact whether the SEND requirement applies." | 30 | VERIFIED |
| Versions | "When submitting clinical or nonclinical data, sponsors should not mix versions within a study." | 37 | VERIFIED |
| Dates | "Dates in SDTM and SEND domains should conform to the ISO 8601 format." | 37 | VERIFIED |
| Define-XML | "The Catalog lists the currently supported version(s) of Define-XML. It should be noted that Define-XML version 2.0 or later is strongly preferred." | 38 | VERIFIED |
| Separate define per package | "a separate data definition file for the SEND datasets of a given nonclinical study" | 37 | VERIFIED |
| define.xml tags | "valid file-tags for define.xml are 'data-tabulation-data-definition' for SEND or SDTM datasets" (eCTD v3.2.2) | 38 | VERIFIED |
| Style sheet | "Sponsors should include a reference to the style sheet as defined in the specification … and place the corresponding style sheet in the same submission folder as the define.xml file." | 38 | VERIFIED |
| CDISC "Required" | "CDISC uses the word "required" to describe variables in their data models (SEND, SDTM, ADaM). This use does not indicate a requirement by the Agency." | 36 | VERIFIED |
| What to submit | "all CDISC required, expected, and permissible variables that were collected, plus any variables that are used to compute derivations, should be submitted." | 36 | VERIFIED |
| SENDIG scope (FDA quoting CDISC SENDIG v3.1 §1.1) | "SENDIG is designed to support data typically found in single-dose general toxicology, repeat-dose general toxicology, and carcinogenicity studies, as well as respiratory and cardiovascular testing done during safety pharmacology studies." | 28 | VERIFIED (as quoted by FDA) |

TCG Appendix D (p. 82) lists "CDISC SENDIG-DARTv1.2" among properties that FDA does **not** consider aligned with
its current business needs. Target DART v1.1.

### 2.3 Nonclinical TS parameters FDA wants (TCG Appendix C, pp. 79-81)

Verbatim definition: "The term 'Conditional' means a parameter might not be relevant to a trial or study
design. If the TS Parameter is relevant to the study design and is listed as 'Conditional' in the table below,
it should be included in the SEND dataset submitted to the FDA."

| FDA desired | TSPARMCD values (as listed) | Confidence |
|---|---|---|
| Y | AGEU, DOSDUR, DOSENDTC, DOSSTDTC, EXPENDTC, EXPSTDTC, GLPFL, GLPTYP, PCLASS, PPTCNAM, PPTEGID, PPTEGSYM, PPTMDA, ROUTE, SDESIGN, SEXPOP, SNDCTVER, SNDIGVER, SPECIES, SPLANSUB, SPLRNAM, SPREFID, SSPONSOR, SSTYP, STCAT, STDIR, STITLE, STRAIN, STRPSTAT, STSTDTC, TFCNTRY, TRMSAC, TRT, TRTCAS, TRTUNII, TRTV, TSTFLOC, TSTFNAM | VERIFIED |
| Conditional | ASOCSTDY, INTSAC, PDOSFRQ, RECSAC, SBSTRAIN, STENDTC | VERIFIED |
| See Notes | AGE or AGETXT. "Either AGE or AGETXT should be populated (not both)." | VERIFIED |

Cross-check (my computation): all 46 codes above appear in codelist C90009 (STSPRMCD) of SEND CT 2026-09-25
(section 3.3).

### 2.4 Technical Rejection Criteria

There is no current standalone "Technical Rejection Criteria for Study Data" PDF on the FDA study-data pages
I read. The TRC text now sits in **TCG Appendix F** (added in TCG v4.9, March 2022, per the revision history).
The machine checks are in FDA's *Specifications for eCTD Validation Criteria*.

**Specifications for eCTD Validation Criteria, version 4.6** (revision row "2026-08-17 … 4.6"). The eCTD
submission-standards page lists support beginning 8/28/2026 and content current as of 08/27/2026. Link:
`/media/87056/download`. SHA-256 `e5cc369a…46b6`.

Severity definition (p. 3), verbatim: "High The error is a serious technical error which prevents the
processing of the submission and will require resubmission. The submission is considered not received by FDA."

| Code | Verbatim description | Severity | Effective | Confidence |
|---|---|---|---|---|
| 1734 | "A dataset named ts.xpt with information on study start date must be present for each study in Module 4, sections 4.2.3.1, 4.2.3.2, 4.2.3.4, and in Module 5, sections …" | High | "9/15/2021 (CBER module 4 sections, 03/16/2023)" | VERIFIED |
| 1735 | "The correct STF file-tags must be used for all standardized datasets and corresponding define.xml files in Module 4, sections 4.2.3.1, 4.2.3.2, 4.2.3.4 …". Valid tags: "data-tabulation-dataset-send" (XPT) and "data-tabulation-data-definition" (define.xml). | High | same | VERIFIED |
| 1736 | "For Standard for Exchange of Nonclinical Data (SEND) data, a Demographic (DM) dataset and define.xml must be submitted in Module 4, sections 4.2.3.1, 4.2.3.2, 4.2.3.4" | High | same | VERIFIED |
| 1737 | "For each study referenced by an STF file in Module 4 and Module 5, no more than one dataset of the same file name and leaf title should be submitted using the lifecycle operator "new."" | Medium | 3/16/2023 | VERIFIED |
| 1738 | "STF Study ID should match STUDYID or SPREFID listed in the referenced Trial Summary (ts.xpt) file." | Medium | 3/16/2023 | VERIFIED |
| 1789 | "A file has been submitted in a study section without providing an STF file." | High | 9/15/2021 | VERIFIED |

For eCTD v4.0, the equivalents are US-eCTD4-516 (TS), -517 (document type keyword) and -518 (required dataset
files), per TCG §8.1.2 p. 65. These are VERIFIED from the TCG text. I did not read the v4.0 validation
specification itself.

TCG Appendix F (pp. 85-87), verbatim:

- "If a nonclinical study submitted to CDER started after December 17, 2016, the files for NDAs, BLAs, and ANDAs (or December 17, 2017, for commercial INDs) must comply with CDISC standards as specified in the guidance Providing Regulatory Submissions in Electronic Format—Standardized Study Data."
- "The ts.xpt needs to contain either a study ID (STUDYID) or Sponsor Reference ID (SPREFID) value that matches with the STF study ID."
- TRC "WILL APPLY" to "4.2 Study Reports". It "WILL NOT APPLY" to, among others, "4.2.1 Pharmacology", "4.2.2 Pharmacokinetics", "4.2.3.3 Genotoxicity", "4.2.3.5 Reproductive and Developmental Toxicity", "4.2.3.6 Local Tolerance" and "4.2.3.7 Other Toxicity Studies".
- Table 6, nonclinical modules 4.2.3.1, 4.2.3.2 and 4.2.3.4, CDER Commercial IND: "On/Prior to December 17, 2017 Submit simplified ts.xpt*" and "After December 17, 2017 Comply with CDISC standards". The footnote reads: "*Rejection criteria will be applied if a study report with a 'pre clinical study report', 'legacy clinical study report', or 'study report body' designation is included, and/or an xpt file (other than the ts.xpt) is submitted."

The simplified ts.xpt (TCG §8.1.2 and Appendix G, p. 88) is: "Sponsors should submit a dataset named 'ts.xpt' with
four variables (STUDYID, TSPARMCD, TSVAL, and TSVALNF) and one row of information." The row is `STSTDTC`, with TSVAL
`yyyy-mm-dd`, or with TSVAL blank and TSVALNF `NA` when no valid start date applies. Also (p. 67): "A simplified
ts.xpt file should not be used when submitting SEND datasets for a study. Doing so will prevent loading of these
datasets resulting in a need for TS correction and resubmission."

**Implementation consequence:** a pre-export TRC gate can check deterministically for: ts.xpt present with an
STSTDTC row in ISO 8601 (at least YYYY-MM-DD, TCG footnote 82); dm.xpt present; define.xml present; STUDYID equal
across all rows and equal to the study ID used for the STF; and a full TS (not simplified) whenever SEND
datasets are present. The STF and file-tag checks belong to eCTD publishing, which is outside the dataset
export.

### 2.5 Pre-submission verification FDA expects (TCG Appendix I, pp. 92-95)

| Check | Verbatim | Confidence |
|---|---|---|
| Folder | "All SEND Study Datasets and their supportive files (nSDRG.pdf and define.xml) should be present in the submission folder m4\datasets\[study]\tabulations\send." | VERIFIED |
| File names | "All SEND Study Dataset files should be correctly named with the domain abbreviation and file extension only (e.g., bw.xpt)." | VERIFIED |
| define.xml consistency | "The list of SEND dataset files in the submission folder should be consistent with the list of files in define.xml." | VERIFIED |
| No empty files | "There should be no files that are 0 kb in size." | VERIFIED |
| Common conformance failures | "violation of record uniqueness constraints (e.g., two findings records with the same USUBJID and –SEQ value), empty required variables (e.g., empty DSDECOD), variable values exceeding the maximum allowable lengths (e.g., LBTESTCD values > 8 characters), variable data types that are inconsistent with the SENDIG (e.g., PPSTRESN as a character field), and invalid references between files (e.g., POOLID values in a findings domain that are not in POOLDEF)" | VERIFIED |
| Group checks | "N is not greater than the number of animals in the group/sex"; "No animal has more than one value in the grouping" | VERIFIED |
| Business Rules | "verify that the SEND dataset files comply with the current version of the FDA Business Rules". The Study Data Standards Resources page lists "Business Rules v1.5 (May 2019)" and "Validator Rules v1.6 (December 2022)". I did not open the rule files. | VERIFIED (versions from the page) |

---

## 3. SENDIG domain specifications (TS, TX, DM, EX, DS, BW, FW, CL, LB, MA, MI, OM)

### 3.1 Source and access path

- The CDISC SENDIG v3.1.1 page (https://www.cdisc.org/standards/foundational/send/sendig-v3-1-1) shows
  "Published Date: 30 March 2021" and "Please Sign in or Sign up to access the file(s) for this standard." **I did
  not read the SENDIG PDF**, because it is behind a login.
- **What I read instead: CDISC Library content as cached by CDISC's own open-source CDISC Rules Engine.** The file
  is `resources/cache/standards_details.pkl` in https://github.com/cdisc-org/cdisc-rules-engine at commit
  `9ffb1c611081b655c11fc0ac77ed6cc809828126` (committed 2026-10-08). SHA-256 `979f7300…5e404`. The repository's
  workflow `.github/workflows/prerelease-update-cache.yml` populates it from the CDISC Library API
  (`CDISC_LIBRARY_API_KEY`, `python core.py update-cache`). The pickle was opened with a class-blocking
  unpickler; `pickletools` showed only dict, list and str opcodes, and no GLOBAL or REDUCE.
- Record identity in the cache: `name "SENDIG v3.1.1"`, `effectiveDate "2021-03-31"`, `registrationStatus "Final"`,
  `_links.model "Study Data Tabulation Model Version 1.5"`. For v3.1: `effectiveDate "2016-06-27"`, model SDTM v1.5.
- This is CDISC-published content through a secondary access path. Before GxP use, re-confirm against the
  SENDIG PDF or the CDISC Library API with a CDISC account. **Confidence: high, but not equal to reading the IG PDF.**
- Codelist names come from **NCI EVS SEND Terminology 2026-09-25**
  (`https://evs.nci.nih.gov/ftp1/CDISC/SEND/SEND%20Terminology.txt`; ODM header `FileOID="CDISC_CT.SEND.2026-09-25"`;
  Last-Modified Fri, 25 Sep 2026; SHA-256 `3a6708ca…6b1`). CDISC CT is published by NCI EVS, so this is primary.
- Independent cross-check: the PHUSE R package sendigR (`data-raw/send_columns.xls`, secondary). Labels agree for
  294 of 298 variables. The 4 differences are VISITDY, which sendigR labels "Planned Study Day". sendigR's
  `REQUIRED` column is a package-internal flag, not CDISC Core, so it cannot be used to check Core.
- The SENDIG tables do not carry a variable length. Length is set by the sponsor (see TCG §3.1.3 and the
  200-character rule in section 2.2).

### 3.2 v3.1 versus v3.1.1 for the P5 domains

I compared label, core, simpleDatatype, codelistSubmissionValues, role and describedValueDomain for every variable
of the 12 domains. **There are no differences between SENDIG v3.1 and v3.1.1** in this cache. CDISC's page
says v3.1.1 "introduces revisions to the Pharmacokinetic Concentrations (PC) Domain" (and PP). This is VERIFIED
by my computation over the cache.

### 3.3 Tables (SENDIG v3.1.1, identical to v3.1)

Req and Exp variables are tabulated in full. Perm variables are listed by name. Types are CDISC Library
`simpleDatatype`. A codelist is shown as `(submission value) NCI codelist name, C-code, extensible`.

#### TS: Trial Summary (Trial Design class)

Structure: "One record per Trial Summary parameter value"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: TS |
| TSSEQ | Sequence Number | Num | Req |  |
| TSGRPID | Group Identifier | Char | Exp |  |
| TSPARMCD | Trial Summary Parameter Short Name | Char | Req | (STSPRMCD) SEND Trial Summary Parameter Test Code, C90009, extensible=Yes |
| TSPARM | Trial Summary Parameter | Char | Req | (STSPRM) SEND Trial Summary Parameter Test Name, C90007, extensible=Yes |
| TSVAL | Parameter Value | Char | Exp |  |

Perm variables (1): TSVALNF (format "ISO 21090 NullFlavor enumeration")

#### TX: Trial Sets (Trial Design class)

Structure: "One record per Trial Set parameter per Trial Set"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: TX |
| SETCD | Set Code | Char | Req |  |
| SET | Set Description | Char | Req |  |
| TXSEQ | Sequence Number | Num | Req |  |
| TXPARMCD | Trial Set Parameter Short Name | Char | Req | (STSPRMCD) SEND Trial Summary Parameter Test Code, C90009, extensible=Yes |
| TXPARM | Trial Set Parameter | Char | Req | (STSPRM) SEND Trial Summary Parameter Test Name, C90007, extensible=Yes |
| TXVAL | Trial Set Parameter Value | Char | Req |  |

Perm variables (0): none

#### DM: Demographics (Special-Purpose class)

Structure: "One record per subject"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: DM |
| USUBJID | Unique Subject Identifier | Char | Req |  |
| SUBJID | Subject Identifier for the Study | Char | Req |  |
| RFSTDTC | Subject Reference Start Date/Time | Char | Req | ISO 8601 |
| RFENDTC | Subject Reference End Date/Time | Char | Exp | ISO 8601 |
| AGEU | Age Unit | Char | Exp | (AGEU) Age Unit, C66781, extensible=No |
| SEX | Sex | Char | Req | (SEX) Sex, C66731, extensible=No |
| ARMCD | Planned Arm Code | Char | Exp |  |
| SETCD | Set Code | Char | Req |  |

Perm variables (10): RFXSTDTC, RFXENDTC, SITEID, BRTHDTC, AGE, AGETXT (format "number-number"), SPECIES (SPECIES, C77808), STRAIN (STRAIN, C77530), SBSTRAIN, ARM

#### EX: Exposure (Interventions class)

Structure: "One record per constant dosing interval per treatment per subject or pool"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: EX |
| USUBJID | Unique Subject Identifier | Char | Exp |  |
| EXSEQ | Sequence Number | Num | Req |  |
| EXTRT | Name of Actual Treatment | Char | Req |  |
| EXDOSE | Dose per Administration | Num | Exp |  |
| EXDOSU | Dose Units | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| EXDOSFRM | Dose Form | Char | Exp | (FRM) Dosage Form, C66726, extensible=Yes |
| EXDOSFRQ | Dosing Frequency Per Interval | Char | Req | (FREQ) Frequency, C71113, extensible=Yes |
| EXROUTE | Route of Administration | Char | Req | (ROUTE) Route of Administration Response, C66729, extensible=Yes |
| EXLOT | Lot Number | Char | Exp |  |
| EXTRTV | Treatment Vehicle | Char | Exp |  |
| EXSTDTC | Start Date/Time of Treatment | Char | Exp | ISO 8601 |

Perm variables (17): POOLID, FOCID, EXDOSTXT, EXLOC, EXMETHOD, EXVAMT, EXVAMTU (UNIT), EXADJ, EXENDTC, EXSTDY, EXENDY, EXDUR, EXTPT, EXTPTNUM, EXELTM, EXTPTREF, EXRFTDTC

#### DS: Disposition (Events class)

Structure: "One record per subject"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: DS |
| USUBJID | Unique Subject Identifier | Char | Req |  |
| DSSEQ | Sequence Number | Num | Req |  |
| DSTERM | Reported Term for the Disposition Event | Char | Req |  |
| DSDECOD | Standardized Disposition Term | Char | Req | (DSDECOD) Standardized Disposition Term, C89968, extensible=No |
| DSUSCHFL | Unscheduled Flag | Char | Exp | (NY) No Yes Response, C66742, extensible=No |
| DSSTDTC | Date/Time of Disposition | Char | Req | ISO 8601 |
| DSNOMDY | Nominal Study Day for Tabulations | Num | Exp |  |

Perm variables (3): VISITDY, DSSTDY, DSNOMLBL

#### BW: Body Weight (Findings class)

Structure: "One record per test per observation time per subject"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: BW |
| USUBJID | Unique Subject Identifier | Char | Req |  |
| BWSEQ | Sequence Number | Num | Req |  |
| BWTESTCD | Test Short Name | Char | Req | (BWTESTCD) Body Weight Test Code, C89962, extensible=Yes |
| BWTEST | Test Name | Char | Req | (BWTEST) Body Weight Test Name, C89961, extensible=Yes |
| BWORRES | Result or Findings as Collected | Char | Exp |  |
| BWORRESU | Unit of the Original Result | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| BWSTRESC | Standardized Result in Character Format | Char | Exp |  |
| BWSTRESN | Standardized Result in Numeric Format | Num | Exp |  |
| BWSTRESU | Unit of the Standardized Result | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| BWBLFL | Baseline Flag | Char | Exp | (NY) No Yes Response, C66742, extensible=No |
| BWDTC | Date/Time Animal Weighed | Char | Exp | ISO 8601 |
| BWNOMDY | Nominal Study Day for Tabulations | Num | Exp |  |

Perm variables (9): BWSTAT (ND), BWREASND, BWFAST (NY), BWEXCLFL (NY), BWREASEX, BWUSCHFL (NY), VISITDY, BWDY, BWNOMLBL

#### FW: Food and Water Consumption (Findings class)

Structure: "One record per test per interval per subject or pool"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: FW |
| USUBJID | Unique Subject Identifier | Char | Exp |  |
| FWSEQ | Sequence Number | Num | Req |  |
| FWTESTCD | Food/Water Consumption Short Name | Char | Req | (FWTESTCD) Food and Water Consumption Test Code, C89970, extensible=Yes |
| FWTEST | Food/Water Consumption Name | Char | Req | (FWTEST) Food and Water Consumption Test Name, C89969, extensible=Yes |
| FWORRES | Result or Findings as Collected | Char | Exp |  |
| FWORRESU | Unit of the Original Result | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| FWSTRESC | Standardized Result in Character Format | Char | Exp |  |
| FWSTRESN | Standardized Result in Numeric Format | Num | Exp |  |
| FWSTRESU | Unit of the Standardized Result | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| FWDTC | Start Date/Time of Observation | Char | Exp | ISO 8601 |
| FWENDTC | End Date/Time of Observation | Char | Exp | ISO 8601 |

Perm variables (8): POOLID, FWGRPID, FWSTAT (ND), FWREASND, FWEXCLFL (NY), FWREASEX, FWDY, FWENDY

#### CL: Clinical Observations (Findings class)

Structure: "One record per finding per observation time per subject or pool"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: CL |
| USUBJID | Unique Subject Identifier | Char | Exp |  |
| CLSEQ | Sequence Number | Num | Req |  |
| CLTESTCD | Test Short Name | Char | Req |  |
| CLTEST | Test Name | Char | Req |  |
| CLCAT | Category for Clinical Observations | Char | Req | (CLCAT) Category for Clinical Observation, C89963, extensible=Yes |
| CLORRES | Result or Findings as Collected | Char | Exp |  |
| CLSTRESC | Standardized Result in Character Format | Char | Exp |  |
| CLLOC | Location of a Finding | Char | Exp |  |
| CLDTC | Date/Time of Observation | Char | Exp | ISO 8601 |
| CLNOMDY | Nominal Study Day for Tabulations | Num | Exp |  |

Perm variables (24): POOLID, FOCID, CLGRPID, CLSPID, CLSCAT, CLBODSYS (BODSYS), CLRESCAT, CLSTAT (ND), CLREASND, CLEVAL, CLSEV, CLEXCLFL (NY), CLREASEX, CLUSCHFL (NY), VISITDY, CLENDTC, CLDY, CLENDY, CLNOMLBL, CLTPT, CLTPTNUM, CLELTM, CLTPTREF, CLRFTDTC

CLTESTCD and CLTEST have no codelist in the Library record.

#### LB: Laboratory Test Results (Findings class)

Structure: "One record per test per specimen per observation time per subject or pool"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: LB |
| USUBJID | Unique Subject Identifier | Char | Exp |  |
| LBSEQ | Sequence Number | Num | Req |  |
| LBTESTCD | Lab Test or Examination Short Name | Char | Req | (LBTESTCD) Laboratory Test Code, C65047, extensible=Yes |
| LBTEST | Lab Test or Examination Name | Char | Req | (LBTEST) Laboratory Test Name, C67154, extensible=Yes |
| LBCAT | Category for Lab Test | Char | Exp |  |
| LBORRES | Result or Findings as Collected | Char | Exp |  |
| LBORRESU | Unit of the Original Result | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| LBSTRESC | Standardized Result in Character Format | Char | Exp |  |
| LBSTRESN | Standardized Result in Numeric Format | Num | Exp |  |
| LBSTRESU | Unit of the Standardized Result | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| LBSPEC | Specimen Material Type | Char | Exp | (SPEC) Specimen, C77529, extensible=Yes |
| LBMETHOD | Method of Test or Examination | Char | Exp |  |
| LBBLFL | Baseline Flag | Char | Exp | (NY) No Yes Response, C66742, extensible=No |
| LBUSCHFL | Unscheduled Flag | Char | Exp | (NY) No Yes Response, C66742, extensible=No |
| LBDTC | Date/Time of Specimen Collection | Char | Exp | ISO 8601 |
| LBNOMDY | Nominal Study Day for Tabulations | Num | Exp |  |

Perm variables (37): POOLID, LBGRPID, LBREFID, LBSPID, LBSCAT, LBORNRLO, LBORNRHI, LBSTNRLO, LBSTNRHI, LBSTNRC, LBNRIND, LBSTAT (ND), LBREASND, LBNAM, LBANTREG, LBSPCCND, LBSPCUFL (NY), LBLOC, LBLAT (LAT), LBDIR (DIR), LBPORTOT (PORTOT), LBFAST (NY), LBDRVFL (NY), LBTOX, LBTOXGR, LBEXCLFL (NY), LBREASEX, VISITDY, LBENDTC, LBDY, LBENDY, LBNOMLBL, LBTPT, LBTPTNUM, LBELTM, LBTPTREF, LBRFTDTC

#### MA: Macroscopic Findings (Findings class)

Structure: "One record per finding per specimen per subject"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: MA |
| USUBJID | Unique Subject Identifier | Char | Req |  |
| MASEQ | Sequence Number | Num | Req |  |
| MATESTCD | Macroscopic Examination Short Name | Char | Req | (MATESTCD) Macroscopic Findings Test Code, C89972, extensible=Yes |
| MATEST | Macroscopic Examination Name | Char | Req | (MATEST) Macroscopic Findings Test Name, C89971, extensible=Yes |
| MAORRES | Result or Findings as Collected | Char | Exp |  |
| MASTRESC | Standardized Result in Character Format | Char | Exp |  |
| MASPEC | Specimen Material Type | Char | Exp | (SPEC) Specimen, C77529, extensible=Yes |

Perm variables (19): FOCID, MAGRPID, MAREFID, MASPID, MABODSYS (BODSYS), MASTAT (ND), MAREASND, MANAM, MAANTREG, MASPCCND, MASPCUFL (NY), MALAT (LAT), MADIR (DIR), MAPORTOT (PORTOT), MAEVAL, MASEV (SEV), MADTHREL (NY), MADTC, MADY

#### MI: Microscopic Findings (Findings class)

Structure: "One record per finding per specimen per subject"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: MI |
| USUBJID | Unique Subject Identifier | Char | Req |  |
| MISEQ | Sequence Number | Num | Req |  |
| MITESTCD | Microscopic Examination Short Name | Char | Req | (MITESTCD) SEND Microscopic Findings Test Code, C89974, extensible=Yes |
| MITEST | Microscopic Examination Name | Char | Req | (MITEST) SEND Microscopic Findings Test Name, C89973, extensible=Yes |
| MIORRES | Result or Findings as Collected | Char | Exp |  |
| MISTRESC | Standardized Result in Character Format | Char | Exp | (NONNEO) Non-Neoplastic Finding Type, C120531, extensible=Yes; (NEOPLASM) Neoplasm Type, C88025, extensible=Yes |
| MICHRON | Chronicity of Finding | Char | Exp | (CHRNCTY) Chronicity, C120529, extensible=Yes |
| MIDISTR | Distribution Pattern of Finding | Char | Exp | (DSTRBN) Distribution, C120530, extensible=Yes |
| MISPEC | Specimen Material Type | Char | Req | (SPEC) Specimen, C77529, extensible=Yes |
| MISPCCND | Specimen Condition | Char | Exp |  |
| MISPCUFL | Specimen Usability for the Test | Char | Exp | (NY) No Yes Response, C66742, extensible=No |
| MISEV | Severity | Char | Exp | (SEV) SEND Severity, C90000, extensible=No |

Perm variables (17): FOCID, MIGRPID, MIREFID, MISPID, MIBODSYS (BODSYS), MIRESCAT (MIRESCAT), MISTAT (ND), MIREASND, MINAM, MIANTREG, MILAT (LAT), MIDIR (DIR), MIMETHOD, MIEVAL, MIDTHREL (NY), MIDTC, MIDY

FDA adds this for MISEV (TCG p. 24): with a CDISC CT version dated before 2018, severity may be represented as
"'1 OF 4' '2 OF 4' or '1 OF 3'". The non-extensible codelist is then extended and the extension explained in the
nSDRG.

#### OM: Organ Measurements (Findings class)

Structure: "One record per test per specimen per subject"

| Variable | Label | Type | Core | Controlled terms, codelist or format |
|---|---|---|---|---|
| STUDYID | Study Identifier | Char | Req |  |
| DOMAIN | Domain Abbreviation | Char | Req | value: OM |
| USUBJID | Unique Subject Identifier | Char | Req |  |
| OMSEQ | Sequence Number | Num | Req |  |
| OMTESTCD | Test Short Name | Char | Req | (OMTESTCD) Organ Measurement Test Code, C89977, extensible=Yes |
| OMTEST | Test Name | Char | Req | (OMTEST) Organ Measurement Test Name, C89976, extensible=Yes |
| OMORRES | Result or Findings as Collected | Char | Exp |  |
| OMORRESU | Unit of the Original Result | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| OMSTRESC | Standardized Result in Character Format | Char | Exp |  |
| OMSTRESN | Standardized Result in Numeric Format | Num | Exp |  |
| OMSTRESU | Unit of the Standardized Result | Char | Exp | (UNIT) Unit, C71620, extensible=Yes |
| OMSPEC | Specimen Material Type | Char | Req | (SPEC) Specimen, C77529, extensible=Yes |
| OMDTC | Date/Time Organ Measured | Char | Exp | ISO 8601 |
| OMNOMDY | Nominal Study Day for Tabulations | Num | Exp |  |

Perm variables (12): OMSTAT (ND), OMREASND, OMANTREG, OMSPCCND, OMSPCUFL (NY), OMLAT (LAT), OMDIR (DIR), OMPORTOT (PORTOT), OMEXCLFL (NY), OMREASEX, OMDY, OMNOMLBL

Also NOT VERIFIED from the IG: the SENDIG section-4 assumptions text for each domain (for example, when USUBJID
may be null because POOLID is used). The cache holds only the variable tables. Where FDA restates an assumption,
it is quoted in section 2.2.

---

## 4. Dataset format: SAS XPORT v5

| Requirement | Source | Verbatim quote | Confidence |
|---|---|---|---|
| XPORT v5 for all datasets | FDA TCG v6.3 §3.1.1, p. 7 | "The Transport Format (XPORT) Version 5 is the file format for the submission of all electronic datasets." | VERIFIED |
| One dataset per file, same name | same | "There should be one dataset per transport file, and the dataset in the transport file should be named the same as the transport file (e.g., 'ae' and ae.xpt, …)." | VERIFIED |
| No CPORT, no compression, no custom formats | same | "SAS Transport files processed by the SAS CPORT cannot be reviewed, processed, or archived by FDA." "All SAS XPORT transport files should use .xpt as the file extension, and the files should not be compressed." "SAS custom formats should NOT be used in submissions to the FDA." | VERIFIED |
| Record layout reference | same | "Sponsors can find the record layout for SAS XPORT transport files through SAS technical document TS-140." | VERIFIED |
| Size | §3.1.2 | "Datasets greater than 5 gigabytes (GB) in size should be split into smaller datasets no larger than 5 GB." | VERIFIED |
| Column length | §3.1.3 | "The allotted length for each column containing character (text) data should be set to the maximum length of the variable used across all datasets in the study except for suppqual datasets." | VERIFIED |
| Name and label limits | §3.1.4, Table 1 | "Variable Name 8 / Variable Descriptive Label 40 / Dataset Label 40" | VERIFIED |
| Character set | §3.1.5 | "Variable names, as well as variable and dataset labels should include American Standard Code for Information Interchange (ASCII) text codes only." | VERIFIED |
| VALIDVARNAME | §3.1.6 | "Use V7 as the valid variable name option (VALIDVARNAME) and extend for the valid member name option (VALIDMEMNAME)." | VERIFIED |
| Forbidden label characters | §3.1.7 | "1. Unbalanced apostrophe … 2. Unbalanced single and double quotation marks 3. Unbalanced parentheses, braces or brackets" | VERIFIED |
| 200-character value limit (FDA) | §4.1.3.2, p. 24 | "Values for variables that do not have a defined maximum length in the SENDIG should not exceed 200 characters." | VERIFIED |
| V5 format limits (SAS) | SAS KB0041592, "New SAS® transport format and tools available" (formerly Usage Note 46944), read 2026-10-11 | "The previously released transport file format only allows up to 8 characters." (names) "…only allows lengths up to 200 bytes." (character variables) "…only allows 40-character labels." | VERIFIED (vendor primary) |
| FDA still expects V5 | same SAS KB | "The availability of these new macros does not change the expectation that the FDA should receive clinical trial data in SAS V5 transport files." | VERIFIED |
| Record layout | SAS, "Record Layout of a SAS® Version 5 or 6 Data Set in SAS® Transport (Xport) Format", last update October 2021 (TS-140; https://support.sas.com/techsup/technote/ts140.pdf redirects to sas.com; SHA-256 `c7c82e66…8ac3`) | "All transport data set records are 80 bytes in length." "all floating-point numbers are stored using the IBM-style double". NAMESTR fields include "char8 nname; /* NAME OF VARIABLE */" and "char40 nlabel; /* LABEL OF VARIABLE */". "only the first 40 characters are stored in the second header record" (data set label). | VERIFIED |
| Define-XML version | Catalog rows (section 1.1) and TCG p. 38 | v2.0 and v2.1 both supported with no end date. "Define-XML version 2.0 or later is strongly preferred." | VERIFIED |
| Dataset-JSON | FDA Study Data Standards Resources page (WebFetch summary) | It reports preliminary testing with "Initial results indicate potential use as a replacement for XPT v5." Not in the catalog, so not a target. | VERIFIED (page wording via fetch summary) |

**Implementation note.** A writer that is not SAS (for example, Python) must emit IBM-370 floating point and 80-byte
records exactly per TS-140. The known-value test should be a byte-level golden file, as CLAUDE.md §7 requires.

---

## 5. Nonclinical Study Data Reviewer's Guide (nSDRG)

| Fact | Source | Verbatim | Confidence |
|---|---|---|---|
| Name and placement | TCG v6.3 §2.1.2, p. 5 | "An SDRG for nonclinical data should be named nsdrg … and the document should be named 'nsdrg' and provided as a PDF file upon submission (nsdrg.pdf)." eCTD v3.2.2 file tag 'study-data-reviewers-guide'. | VERIFIED |
| Template status | TCG footnote 13, p. 5 | "A specific template for a Study Data Reviewer's Guide for nonclinical studies is not specified. However, an example can be found at https://phuse.global/Deliverables. … FDA prefers but does not require its use." | VERIFIED |
| Current published PHUSE version | PHUSE Advance Hub, "Nonclinical Study Data Reviewer's Guide" project page (read 2026-10-11 in browser; "Updated Oct 08") | "nSDRG v1.2 … Version 1.2, 8 April 2022" | VERIFIED |
| v2.0 status | PHUSE "NC Q3 Reports" 2026 (https://phuse.s3.eu-central-1.amazonaws.com/Advance/WG+Reports+2026/Q3+Reports/NC+Q3+Reports; SHA-256 `2a14b67c…bd8`) | "Version 2.0 draft completed and circulated." The next quarter's targets include "Finalise publication package and implementation guidance." | VERIFIED |
| v1.2 package contents and section headings | https://phuse.s3.eu-central-1.amazonaws.com/Deliverables/Nonclinical+Topics/nSDRG+v1.2.zip | **NOT VERIFIED.** S3 returned HTTP 403 `AccessDenied`, and the package does not appear in the phuse.global Deliverables search. | — |
| Section headings in a PHUSE-hosted completed example (SECONDARY) | `phuse-scripts/data/send/CBER-POC-Pilot-Study5/nsdrg.pdf` (PDF created 2020-02-18; SHA-256 `b5440fc8…21b2`) | 1. nSDRG Introduction (1.1 Study Protocol Title, Number and Report Version; 1.2 Summary of SEND Dataset Creation Process; 1.3 SEND Dataset Verification). 2. Study Design (2.1 Study Design Summary; 2.2 Trial Design Domain Overview). 3. Standards, Formats, and Terminologies and their Versions (3.1 Standards Used; 3.2 Rationale for Standards Selection; 3.3 Nonstandard Terminology). 4. Description of Study Datasets (4.1 Dataset Summary; 4.2 Dataset Explanation; 4.3 Use of Supplemental Qualifiers). 5. Data Standards Validation Rules, Versions, and Conformance Issues (5.1 Validation Outcome Summary; 5.2 FDA SEND Validation Rules Version; 5.3 Errors; 5.4 Warnings). 6. Sponsor Decisions Related to Data Standards Implementations (6.1 Sponsor Defined Standardization Descriptions; 6.2 Differences between SEND Datasets and Study Report; 6.3 Nonstandard Electronic Data Submitted; 6.4 Legacy Data Conversion). Appendix 1: Scoring Scales. | Secondary, medium. This is a 2020 example that predates v1.2. Use it only as a skeleton until the v1.2 template is read. |
| FDA content expectations for the nSDRG (primary) | TCG Appendix I, p. 93 | "It should be possible to understand the multi-step process of how SEND Study Data were created, using information provided in the nSDRG. This information should include the identification of the organization that created the SEND Study Data …, what system(s) were used during creation, and an overview of the process." "Use of boilerplate language is not recommended." | VERIFIED |
| Federal Register notice for the nonclinical template | 81 FR 11575, March 4, 2016, Docket FDA-2016-N-0701, "Intent to Review a Nonclinical Study Data Reviewer's Guide Template" (govinfo PDF read) | "a PhUSE working group developed the PhUSE Nonclinical SRDG template" | VERIFIED |

**Discrepancy in TCG v6.3.** Footnote 13 (nSDRG) links to the 2015 notice
(`.../2015/07/23/2015-18027/intent-to-review-a-study-data-reviewers-guide-template`). Footnote 14 (cSDRG) links to
the 2016 nonclinical notice (`.../2016/03/04/2016-04791/intent-to-review-a-nonclinical-study-data-reviewers-guide-template`).
The two links appear swapped. The 2016 notice (FR Doc. 2016-04791) is the nonclinical one.

---

## 6. Related facts found while checking (relevant to the GxP plane)

| Fact | Source | Verbatim | Confidence |
|---|---|---|---|
| FDA direct final rule on terminology amends 21 CFR 314.3 | Federal Register API, doc 2026-19350, 91 FR 59988, published 2026-09-22, effective 2027-02-04 | "substitutes references to "animal" tests or studies with "nonclinical" tests or studies, adds a definition of the terms "nonclinical test" and "nonclinical study,"" | VERIFIED (FR abstract). The rule text itself was not read. |

---

## 7. NOT VERIFIED items (P5)

1. **SENDIG v3.1 and v3.1.1 PDF text.** It requires a CDISC login. Variable metadata was verified through the
   CDISC Library cache (section 3.1). Domain assumptions text was not read.
2. **PHUSE nSDRG v1.2 template and completion guide.** The download returned 403. Headings come only from a
   secondary 2020 example.
3. **FDA Business Rules v1.5 and Validator Rules v1.6.** I did not open them. Only the versions are recorded.
4. **eCTD v4.0 validation specification** (US-eCTD4-516/517/518). Known only through the TCG.
5. **A standalone "Technical Rejection Criteria for Study Data" document.** None was found on the current FDA
   pages. The content is in TCG Appendix F.

---

## Citations to register

| id (proposed) | Citation | Accessed | Notes |
|---|---|---|---|
| fda.data_standards_catalog.v11_0 | U.S. FDA. *FDA Data Standards Catalog v11.0* (Excel). March 2025 (change history 2025-03-20). https://www.fda.gov/regulatory-information/search-fda-guidance-documents/data-standards-catalog (file /media/185927/download) | 2026-10-11 | SHA-256 591ff69ac3efc84e128fd9fd9e4ff231c4bf3793fee4a9f9ca0a9396ca9de9c6 |
| fda.sdtcg.v6_3 | U.S. FDA (CDER/CBER). *Study Data Technical Conformance Guide – Technical Specifications Document*, v6.3, October 2026. https://www.fda.gov/media/153632/download | 2026-10-11 | SHA-256 36a086860de808e296eff9f4de81561b64f147d0b8fbb2bd11156373c0b6893a |
| fda.ectd_validation_criteria.v4_6 | U.S. FDA. *Specifications for eCTD Validation Criteria*, v4.6 (2026-08-17). https://www.fda.gov/media/87056/download | 2026-10-11 | Codes 1734, 1735, 1736, 1737, 1738, 1789. SHA-256 e5cc369a03840164ef97371d92504124ba013517f69e54487c7dfe9e5f3c46b6 |
| fda.guidance.standardized_study_data | U.S. FDA. *Providing Regulatory Submissions in Electronic Format — Standardized Study Data*, guidance for industry (June 2021 version cited by the TCG). | not opened | Cited by catalog footnotes [1] and [2]. Read it before relying on the "certain INDs" scope. |
| cdisc.sendig.3_1_1 | CDISC SEND Team. *Standard for Exchange of Nonclinical Data Implementation Guide: Nonclinical Studies Version 3.1.1 (Final)*. CDISC; published 30 March 2021 (Library effectiveDate 2021-03-31). Model SDTM v1.5. | metadata via CDISC Library cache, 2026-10-11 | PDF not read (login) |
| cdisc.sendig.3_1 | CDISC SEND Team. *SENDIG Version 3.1 (Final)*. CDISC; effectiveDate 2016-06-27. Model SDTM v1.5. | as above | |
| cdisc.library.cache.cre | CDISC. cdisc-rules-engine `resources/cache/standards_details.pkl`, commit 9ffb1c611081b655c11fc0ac77ed6cc809828126 (2026-10-08). https://github.com/cdisc-org/cdisc-rules-engine | 2026-10-11 | SHA-256 979f73003bd26907a878aa49af1c38bc1e88d93e58b959fedaec16bc22e5e404. Access path, not the authority. |
| nci_evs.send_ct.2026_09_25 | CDISC / NCI EVS. *CDISC SEND Controlled Terminology*, 2026-09-25. https://evs.nci.nih.gov/ftp1/CDISC/SEND/SEND%20Terminology.txt | 2026-10-11 | SHA-256 3a6708ca06543d31254188b1e60bd8f6350e22983a504a970d9dad77c33966b1. Record the CT version in TS SNDCTVER. |
| sas.ts140.2021 | SAS Institute. *Record Layout of a SAS® Version 5 or 6 Data Set in SAS® Transport (XPORT) Format* (TS-140), last update October 2021. | 2026-10-11 | SHA-256 c7c82e664651fdf7c74134b3536af2ba1c5c2834ca91ea427e886eea0b118ac3 |
| sas.kb0041592 | SAS Institute. "New SAS® transport format and tools available", KB0041592 (formerly Usage Note 46944). https://sas.service-now.com/csm?id=kb_article_view&sysparm_article=KB0041592 | 2026-10-11 | V5 limits: 8-character names, 200-byte character values, 40-character labels |
| phuse.nsdrg.v1_2 | PHUSE Nonclinical Topics WG. *Nonclinical Study Data Reviewer's Guide (nSDRG) package*, Version 1.2, 8 April 2022. | page read 2026-10-11 | Package itself NOT VERIFIED (403) |
| fr.2016_04791 | FDA. "Intent to Review a Nonclinical Study Data Reviewer's Guide Template." *Fed Regist.* 2016;81(43):11575. Docket FDA-2016-N-0701. | 2026-10-11 | |
