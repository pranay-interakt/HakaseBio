# Driver research note — `dose_range_finding` (tox.dose_range_finding, Wave A6)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A6: ICH M3(R2) sections 1.5 and 4.

Confidence labels: **verified-from-primary** (exact wording read in the primary document this session);
**verified-bibliographic** (citation confirmed via Crossref/PubMed, content not read);
**secondary-reproduction**; **NOT VERIFIED** (not read; nothing filled in from memory).

## Primary document read

| Document | Copy read | Header as printed | SHA-256 |
|---|---|---|---|
| ICH M3(R2) *Guidance on Nonclinical Safety Studies for the Conduct of Human Clinical Trials and Marketing Authorization for Pharmaceuticals* | `https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf` (31 pp.) | "Current Step 4 version dated 11 June 2009" | `da8bc18c11d224d23b2b3c391a32e5aa87fd49fbdc6bf515c9787bb4c41f8552` |

Page numbers below are the printed page numbers of the guideline body.

## Section 1.5 — High dose selection for general toxicity studies

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| MTD as the reference high dose | Effects can be characterised using doses up to the MTD; demonstrating the MTD is not essential in every study | M3(R2) §1.5, p.2 | "Generally, in toxicity studies, effects that are potentially clinically relevant can be adequately characterized using doses up to the maximum tolerated dose (MTD). It is not essential to demonstrate the MTD in every study." | verified-from-primary |
| Equally appropriate limiting doses | Large exposure multiples, saturation of exposure, or maximum feasible dose (MFD) | M3(R2) §1.5, p.2 | "Other equally appropriate limiting doses include those that achieve large exposure multiples or saturation of exposure or use the maximum feasible dose (MFD)." | verified-from-primary |
| Limit dose | 1000 mg/kg/day, rodents and non-rodents (acute, subchronic, chronic), with exceptions below | M3(R2) §1.5, p.2–3 | "Limit doses for acute, subchronic, and chronic toxicity studies of 1000 mg/kg/day for rodents and non-rodents are considered appropriate in all cases except those discussed below." | verified-from-primary |
| Exception: < 10× margin and clinical dose > 1 g/day | Limit by 10-fold exposure margin, 2000 mg/kg/day or MFD, whichever is lower | M3(R2) §1.5, p.3 | "In the few situations where a dose of 1000 mg/kg/day does not result in a mean exposure margin of 10-fold to the clinical exposure and the clinical dose exceeds 1 g per day, then the doses in the toxicity studies should be limited by a 10-fold exposure margin or a dose of 2000 mg/kg/day or the MFD, whichever is lower." | verified-from-primary |
| Exception: 2000 mg/kg/day below clinical exposure | Higher dose up to the MFD can be considered | M3(R2) §1.5, p.3 | "In those rare situations in which the dose of 2000 mg/kg/day results in an exposure that is less than the clinical exposure, a higher dose up to the MFD can be considered." | verified-from-primary |
| 50-fold exposure margin | Acceptable as maximum dose for acute and repeated-dose studies in any species (usually group-mean AUC) | M3(R2) §1.5, p.3 | "Doses providing a 50-fold margin of exposure (usually based on group mean AUC values [see Note 1] of the parent drug or the pharmacologically active molecule of a pro-drug) to the clinical systemic exposure generally are also considered acceptable as the maximum dose for acute and repeated-dose toxicity studies in any species." | verified-from-primary |
| US Phase III condition | Dose-limiting toxicity generally should be identified in ≥1 species when using the 50× limit | M3(R2) §1.5, p.3 | "To support Phase III clinical trials for the United States, dose-limiting toxicity generally should be identified in at least one species when using the 50-fold margin of exposure as the limit dose." | verified-from-primary |
| Genotoxicity endpoints in general tox | Max dose based on MFD, MTD or 1000 mg/kg/day limit | M3(R2) §1.5, p.3 | "If genotoxicity endpoints are to be incorporated into a general toxicity study, then an appropriate maximum dose should be selected based on a MFD, MTD or limit dose of 1000 mg/kg/day." | verified-from-primary |
| Decision flow | Figure 1 "Recommended high dose selection for general toxicity studies" (MTD / exposure saturation / MFD / 50× margin → limit-dose and 10× branches) | M3(R2) Figure 1, p.4 | Figure title: "Recommended high dose selection for general toxicity studies" | verified-from-primary (figure is a flowchart; encode only from the text of §1.5, which it summarises) |
| Meaning of "exposure" | Group-mean AUC; Cmax may be more appropriate for acute CV or CNS effects | M3(R2) Note 1 (Endnotes), p.23 | "In this document "exposure" generally means group mean AUC. In some circumstances (e.g., if the compound or compound class is known to produce acute functional cardiovascular changes or central nervous system-related clinical signs) it might be appropriate to base the exposure margin on group mean Cmax values rather than AUC." | verified-from-primary |

## Section 4 — Acute toxicity studies (dose-escalation / dose-ranging)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Dose-escalation / dose-ranging studies as the source of acute toxicity information | Acute toxicity information can come from dose-escalation or short-duration dose-ranging studies that define an MTD | M3(R2) §4, p.5 (cites Refs 8 and 9) | "However, such information can be obtained from appropriately conducted dose-escalation studies or short-duration dose-ranging studies that define an MTD in the general toxicity test species (Refs. 8 and 9)." | verified-from-primary |
| Separate single-dose studies | Not recommended when acute information is available from any study | M3(R2) §4, p.5 | "When this acute toxicity information is available from any study, separate single-dose studies are not recommended." | verified-from-primary |
| Route and GLP status | Clinical route only; may be non-GLP if GLP repeat-dose studies support clinical dosing | M3(R2) §4, p.5 | "Studies providing acute toxicity information can be limited to the clinical route only and such data can be obtained from non-GLP studies if clinical administration is supported by appropriate GLP repeated-dose toxicity studies." | verified-from-primary |
| Lethality | Not an intended endpoint | M3(R2) §4, p.5 | "Lethality should not be an intended endpoint in studies assessing acute toxicity." | verified-from-primary |
| Exception: microdose trials | Acute/single-dose studies may be primary support; then GLP and different high-dose selection | M3(R2) §4, p.6 | "In some specific situations (e.g., microdose trials; see Section 7) acute toxicity or single-dose studies can be the primary support for studies in humans." | verified-from-primary |
| Timing of acute toxicity information | Should be available to support Phase III (earlier for overdose-risk populations) | M3(R2) §4, p.6 | "Information on the acute toxicity of pharmaceutical agents could be useful to predict the consequences of human overdose situations and should be available to support Phase III." | verified-from-primary |

## What M3(R2) does **not** provide

| Parameter | Status | Note |
|---|---|---|
| Operational definition of the MTD (e.g. a body-weight-loss percentage, clinical-sign criteria) | **NOT in M3(R2).** The guideline uses "MTD" (abbreviation list, §1.5, §4, Figure 1) but never defines the criteria. | The MTD call must be a Study Director determination with the criteria entered as a protocol input and their basis recorded. No numeric MTD criterion has been verified from any source in this session. |
| Group sizes, number of dose levels, duration of a dose-range-finding study | **NOT in M3(R2).** | Must be protocol inputs. |
| Method for deriving "recommended pivotal doses" from DRF data | **NOT in M3(R2).** | The driver can present the evidence (dose-response of findings, exposure, limit-dose rules in §1.5) but the recommendation is a human determination. |

## Cited references in M3(R2) §4

| Ref | Bibliographic status | Content |
|---|---|---|
| Ref 8: NC3Rs. *Challenging Requirements for Acute Toxicity Studies: Workshop Report*; May 2007 | NOT VERIFIED (no DOI; not retrieved) | NOT VERIFIED |
| Ref 9: Robinson S, Delongeas JL, Donald E, et al. *Regul Toxicol Pharmacol* 2008;50:345–352 | verified-bibliographic: Crossref DOI 10.1016/j.yrtph.2007.11.009, vol 50 issue 3, pp. 345–352 (18 authors, last Chapman K); PMID 18295384 | Abstract read: concludes acute toxicity studies "are not needed prior to first clinical trials in humans". Full text not read. |

## Implications for the driver

- The driver re-uses the repeat-dose analysis; the M3(R2)-citable layer is the **high-dose adequacy check**
  (§1.5: MTD / saturation / MFD / 1000 mg/kg/day / 10× and 50× exposure margins, with Note 1's AUC vs Cmax
  choice recorded) and the statement that a DRF that defines an MTD can supply acute toxicity information (§4).
- Exposure-margin computations (10×, 50×) are citable rules; the clinical exposure is a required input.
- "MTD" and "recommended pivotal doses" are **human determinations**; M3(R2) supplies no numeric criterion.

## Citations to register

1. ICH (2009). *M3(R2): Guidance on Nonclinical Safety Studies for the Conduct of Human Clinical Trials and Marketing Authorization for Pharmaceuticals.* Step 4, 11 June 2009. Sections 1.5, 4; Note 1. https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf
2. Robinson S, Delongeas JL, Donald E, Dreher D, Festag M, Kervyn S, Lampo A, Nahas K, Nogues V, Ockert D, Quinn K, Old S, Pickersgill N, Somers K, Stark C, Stei P, Waterson L, Chapman K. A European pharmaceutical company initiative challenging the regulatory requirement for acute toxicity studies in pharmaceutical drug development. *Regul Toxicol Pharmacol.* 2008;50(3):345–352. DOI: 10.1016/j.yrtph.2007.11.009 *(bibliographic + abstract only)*.
