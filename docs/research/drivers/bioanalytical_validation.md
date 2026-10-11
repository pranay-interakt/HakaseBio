# Driver research note — `bioanalytical_validation` (bioanalytical.validation, Wave A1)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A1: ICH M10. Scope of this note:
**chromatographic methods only (M10 section 3)**, plus the cross-cutting sections the driver needs
(section 1.3 scope, section 5 ISR, section 7.3 recovery, section 9 glossary) and the M10 Q&A.
Ligand-binding assays (M10 section 4) are out of scope and were not transcribed.

Confidence labels: **verified-from-primary** (exact wording read in the primary document this session);
**verified-bibliographic** (citation confirmed, content not read); **secondary-reproduction**;
**NOT VERIFIED** (not read; nothing filled in from memory).

## Primary documents read

| Document | Copy read | Header as printed | SHA-256 of the PDF read |
|---|---|---|---|
| ICH M10 *Bioanalytical Method Validation and Study Sample Analysis* | `https://database.ich.org/sites/default/files/M10_Guideline_Step4_2022_0524.pdf` (59 pp.) | "Final version Adopted on 24 May 2022" | `e306f3b6dc367eb2913ce242093a8f6c9dcd095a139a9fdb6d6f5e25201fa6af` |
| ICH M10 Questions and Answers (EMA copy, EMA/CHMP/ICH/660315/2022, dated 16 January 2023) | `https://www.ema.europa.eu/system/files/documents/scientific-guideline/ich_guideline_m10_on_bioanalytical_method_validation_and_study_sample_analysis_qas-en.pdf` (5 pp.) | "M10 Q&As Adoption by the ICH Assembly under Step 4. 16 November 2022" | `aee7dbc8d0fe21e1f328da084d8827a3a87908f709c4b407415eec9b1559e874` |

M10's printed page numbers coincide with the PDF page numbers; they are used below. The ISR equation on
p.34 was checked against a rendered image of the page (the text layer loses the fraction bar).
The ICH copy of the Q&A (`ICH_M10_Q%26A_Step4_2022_1116.pdf`) returned HTTP 404; the EMA reproduction
was read instead. A later EMA update of the Q&A (reported in trade press for 2025) was **not** read.

M10 legal notice (p.2) permits reproduction with acknowledgement of ICH copyright.

## 1. Scope and applicability

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Studies in scope | Nonclinical GLP TK studies, nonclinical PK studies used as surrogates for clinical studies, all clinical phases | M10 §1.3, p.6 | "The guideline is applicable to the bioanalytical methods used to measure concentrations of chemical and biological drug(s) and their metabolite(s) in biological samples (e.g., blood, plasma, serum, other body fluids or tissues) obtained in nonclinical toxicokinetic (TK) studies conducted according to the principles of GLP, nonclinical pharmacokinetic (PK) studies conducted as surrogates for clinical studies, and all phases of clinical trials, including comparative bioavailability/bioequivalence (BA/BE) studies, in regulatory submissions." | verified-from-primary |
| Out-of-scope (exploratory) studies | Applicant decides the level of qualification | M10 §1.3, p.7 | "For studies that are not submitted for regulatory approval or not considered for regulatory decisions regarding safety, efficacy or labelling (e.g., exploratory investigations), applicants may decide on the level of qualification that supports their own internal decision making." | verified-from-primary |
| Biomarkers, immunogenicity | Not in scope | M10 §1.3, p.7 | "The bioanalysis of biomarkers and bioanalytical methods used for the assessment of immunogenicity are not within the scope of this guideline." | verified-from-primary |
| Full-validation elements (chromatography) | Selectivity, specificity, matrix effect, calibration curve, range, accuracy, precision, carry-over, dilution integrity, stability, reinjection reproducibility | M10 §2.2.1, p.8 | "For chromatographic methods a full validation should include the following elements, unless otherwise justified: selectivity, specificity, matrix effect, calibration curve (response function), range (lower limit of quantification (LLOQ) to upper limit of quantification (ULOQ)), accuracy, precision, carry-over, dilution integrity, stability and reinjection reproducibility." | verified-from-primary |
| Matrix | Same as study samples incl. anticoagulant | M10 §2.2.1, p.8 | "The matrix used for bioanalytical method validation should be the same as the matrix of the study samples, including anticoagulants and additives." | verified-from-primary |
| Deviation from recommendations | Acceptable with scientific justification | M10 §1.1, p.6 | "Changes from the recommendations in this guideline may be acceptable if appropriate scientific justification is provided." | verified-from-primary |

## 2. Reference standards and internal standard (M10 §3.1)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Separate stocks for calibrators and QCs | Required unless stock accuracy/stability verified | M10 §3.1, p.9 | "Calibration standards and QCs should be prepared from separate stock solutions. However, calibration standards and QCs may be prepared from the same stock solution provided the accurate preparation and stability of the stock solution should have been verified." | verified-from-primary |
| Stock verification criterion | Two independent stocks, measured responses within 5% | M10 Q&A (section 3), p.4 | "By comparing two independently prepared stock solutions and demonstrating that the difference of their measured responses is within 5%." | verified-from-primary |
| Internal standard | Should be added to all calibrators, QCs and samples; absence justified | M10 §3.1, p.9 | "A suitable internal standard (IS) should be added to all calibration standards, QCs and study samples during sample processing. The absence of an IS should be justified." | verified-from-primary |
| SIL-IS with MS detection | Recommended whenever possible | M10 §3.1, p.10 | "When MS detection is used, the use of the stable isotope-labelled analyte as the IS is recommended whenever possible." | verified-from-primary |

## 3. Selectivity and specificity (M10 §3.2.1–3.2.2)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Number of blank sources/lots | ≥ 6 individual sources/lots (non-haemolysed, non-lipaemic); fewer allowed for rare matrices | M10 §3.2.1, p.10 | "Selectivity should be evaluated using blank samples (matrix samples processed without addition of an analyte or IS) obtained from at least 6 individual sources/lots (non-haemolysed and non-lipaemic). Use of fewer sources may be acceptable in the case of rare matrices." | verified-from-primary |
| Interference thresholds | ≤ 20% of analyte response at LLOQ; ≤ 5% of IS response in the LLOQ sample, for each matrix | M10 §3.2.1, p.10 | "Responses attributable to interfering components should not be more than 20% of the analyte response at the LLOQ and not more than 5% of the IS response in the LLOQ sample for each matrix." | verified-from-primary |
| Lipaemic matrix | ≥ 1 source; not necessary for nonclinical studies unless drug affects lipid metabolism or strain is hyperlipidaemic | M10 §3.2.1, p.10 | "This evaluation is not necessary for nonclinical studies unless the drug impacts lipid metabolism or is administered in a particular animal strain that is hyperlipidaemic." | verified-from-primary |
| Haemolysed matrix | ≥ 1 source; spike with haemolysed whole blood at ≥ 2% V/V | M10 §3.2.1, p.11 | "Haemolysed matrices should be obtained by spiking matrix with haemolysed whole blood (at least 2% V/V) to generate a visibly detectable haemolysed sample." | verified-from-primary |
| Specificity thresholds (related substances) | Same 20% LLOQ / 5% IS limits | M10 §3.2.2, p.11 | "Responses detected and attributable to interfering components should not be more than 20% of the analyte response at the LLOQ and not more than 5% of the IS response in the LLOQ sample." | verified-from-primary |
| Back-conversion | Evaluate when relevant; report extent and impact | M10 §3.2.2, p.11 | "The extent of back-conversion, if any, should be established and the impact on the study results should be discussed in the Bioanalytical Report." | verified-from-primary |

## 4. Matrix effect (M10 §3.2.3)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Design | ≥ 3 replicates of low and high QC, each in matrix from ≥ 6 sources/lots | M10 §3.2.3, p.11 | "The matrix effect should be evaluated by analysing at least 3 replicates of low and high QCs, each prepared using matrix from at least 6 different sources/lots." | verified-from-primary |
| Acceptance (per lot) | Accuracy within ±15% of nominal; precision %CV ≤ 15% | M10 §3.2.3, p.11–12 | "For each individual matrix sources/lots evaluated, the accuracy should be within ±15% of the nominal concentration and the precision (per cent coefficient of variation (%CV)) should not be greater than 15%." | verified-from-primary |
| Rare matrices | Fewer lots acceptable | M10 §3.2.3, p.12 | "Use of fewer sources/lots may be acceptable in the case of rare matrices." | verified-from-primary |

Note: M10 frames matrix effect as an **accuracy/precision test of QCs in individual lots**. It does
**not** define an IS-normalised matrix factor or a matrix-factor CV; any such calculation would need a
different citation.

## 5. Calibration curve and regression (M10 §3.2.4)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Composition | Blank + zero sample + ≥ 6 concentration levels incl. LLOQ and ULOQ | M10 §3.2.4, p.12 | "A calibration curve should be generated with a blank sample, a zero sample (blank sample spiked with IS), and at least 6 concentration levels of calibration standards, including the LLOQ and the ULOQ." | verified-from-primary |
| Range definition | LLOQ = lowest standard, ULOQ = highest standard | M10 §3.2.4, p.12 | "The calibration range is defined by the LLOQ, which is the lowest calibration standard, and the ULOQ, which is the highest calibration standard." | verified-from-primary |
| **Regression model and weighting** | **M10 does NOT prescribe a model or a weighting scheme.** A "simple" model that adequately describes the data; model, weighting and transformation are fixed during validation under written procedures | M10 §3.2.4, p.12 | "A simple regression model that adequately describes the concentration-response relationship should be used. The selection of the regression model should be directed by written procedures." | verified-from-primary |
| Weighting is a validation decision | Model, weighting scheme and transformation determined during validation | M10 §3.2.4, p.12 | "The regression model, weighting scheme and transformation should be determined during the method validation." | verified-from-primary |
| Blank/zero in regression | Excluded | M10 §3.2.4, p.12 | "Blank and zero samples should not be included in the determination of the regression equation for the calibration curve." | verified-from-primary |
| Replicate standards | All acceptable replicates used in regression | M10 §3.2.4, p.12 | "Each calibration standard may be analysed in replicate, in which case data from all acceptable replicates should be used in the regression analysis." | verified-from-primary |
| Validation runs reported | All acceptable curves from ≥ 3 independent runs over several days | M10 §3.2.4, p.12 | "All acceptable curves obtained during validation, based on a minimum of 3 independent runs over several days, should be reported." | verified-from-primary |
| Back-calculated accuracy | Within ±20% at LLOQ; within ±15% at all other levels | M10 §3.2.4, p.12–13 | "The accuracy of the back-calculated concentrations of each calibration standard should be within ±20% of the nominal concentration at the LLOQ and within ±15% at all the other levels." | verified-from-primary |
| Fraction of standards passing | ≥ 75% of standards, with a minimum of 6 levels | M10 §3.2.4, p.13 | "At least 75% of the calibration standards with a minimum of 6 calibration standard levels should meet the above criteria." | verified-from-primary |
| With replicates | ≥ 50% of standards per level must pass | M10 §3.2.4, p.13 | "In the case that replicates are used, the criteria (within ±15% or ±20% for LLOQ) should also be fulfilled for at least 50% of the calibration standards tested per concentration level." | verified-from-primary |
| Failing standard | Reject it and re-fit the regression without it | M10 §3.2.4, p.13 | "In the case that a calibration standard does not comply with these criteria, this calibration standard sample should be rejected, and the calibration curve without this calibration standard should be re-evaluated, including regression analysis." | verified-from-primary |
| A&P run: all LLOQ or all ULOQ replicates rejected | Run rejected | M10 §3.2.4, p.13 | "For accuracy and precision runs, if all replicates of the LLOQ or the ULOQ calibration standard in a run are rejected, then the run should be rejected, the possible source of the failure should be determined and the method revised, if necessary." | verified-from-primary |
| Fresh calibrators | Freshly spiked in ≥ 1 assessment | M10 §3.2.4, p.13 | "The calibration curve should be prepared using freshly spiked calibration standards in at least one assessment." | verified-from-primary |
| Reported curve parameters | e.g. slope and intercept | M10 §3.2.4, p.12 | "The calibration curve parameters should be reported (e.g., slope and intercept in the case of a linear model)." | verified-from-primary |

## 6. Accuracy and precision (M10 §3.2.5)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| QC levels in A&P runs | ≥ 4: LLOQ; low QC within 3× LLOQ; medium QC at ~30–50% of range; high QC ≥ 75% of ULOQ | M10 §3.2.5.1, p.13 | "During method validation the QCs for accuracy and precision runs should be prepared at a minimum of 4 concentration levels within the calibration curve range: the LLOQ, within three times of the LLOQ (low QC), around 30 - 50% of the calibration curve range (medium QC) and at least 75% of the ULOQ (high QC)." | verified-from-primary |
| Within-run replicates | ≥ 5 per QC level per run | M10 §3.2.5.2, p.14 | "Within-run accuracy and precision should be evaluated by analysing at least 5 replicates at each QC concentration level in each analytical run." | verified-from-primary |
| Between-run | Each level in ≥ 3 runs over ≥ 2 days | M10 §3.2.5.2, p.14 | "Between-run accuracy and precision should be evaluated by analysing each QC concentration level in at least 3 analytical runs over at least two days." | verified-from-primary |
| Data inclusion | All results incl. QCs outside criteria, except obvious documented errors | M10 §3.2.5.2, p.14 | "Reported method validation data and the determination of accuracy and precision should include all results obtained, including individual QCs outside of the acceptance criteria, except those cases where errors are obvious and documented." | verified-from-primary |
| Between-run calculation | Combine data from all runs | M10 §3.2.5.2, p.14 | "Between-run (intermediate) precision and accuracy should be calculated by combining the data from all runs." | verified-from-primary |
| Accuracy acceptance | ±15% of nominal; ±20% at LLOQ | M10 §3.2.5.2, p.14 | "The accuracy at each concentration level should be within ±15% of the nominal concentration, except at the LLOQ, where it should be within ±20%." | verified-from-primary |
| Precision acceptance | %CV ≤ 15%; ≤ 20% at LLOQ | M10 §3.2.5.2, p.14 | "The precision (%CV) of the concentrations determined at each level should not exceed 15%, except at the LLOQ, where it should not exceed 20%." | verified-from-primary |
| Non-A&P validation runs | Low/mid/high QC may be in duplicate; ≥ 2/3 of QCs and ≥ 50% per level within ±15% | M10 §3.2.5.1 p.13; §3.2.5.2 p.14 | "For non-accuracy and precision validation runs, at least 2/3 of the total QCs and at least 50% at each concentration level should be within ±15% of the nominal values." | verified-from-primary |
| Accuracy definition | Accuracy (%) = (Measured / Nominal) × 100 | M10 §9 Glossary, p.53 | "Accuracy (%) = (Measured Value/Nominal Value) × 100" | verified-from-primary |
| Precision definition | %CV = (SD / Mean) × 100 | M10 §9 Glossary, p.57 | "%CV = (Standard Deviation/Mean) x 100" | verified-from-primary |

Note on the arithmetic: M10 expresses accuracy as % of nominal and the criterion as "within ±15% of the
nominal"; the driver should compute relative error = (measured − nominal)/nominal and compare |RE| to
0.15 (0.20 at LLOQ). Neither the variance estimator for %CV (n−1 vs n) nor a method for pooling
within-run CV (e.g. ANOVA) is specified in M10 — these are **implementation choices to record**, not
M10 requirements.

## 7. Carry-over, dilution integrity, reinjection (M10 §3.2.6, 3.2.7, 3.2.9)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Carry-over design | Blank(s) after the ULOQ calibrator | M10 §3.2.6, p.14 | "During validation carry-over should be assessed by analysing blank samples after the calibration standard at the ULOQ." | verified-from-primary |
| Carry-over acceptance | ≤ 20% of LLOQ analyte response; ≤ 5% of IS response | M10 §3.2.6, p.14 | "Carry-over in the blank samples following the highest calibration standard should not be greater than 20% of the analyte response at the LLOQ and 5% of the response for the IS." | verified-from-primary |
| Dilution integrity design | ≥ 5 replicates per dilution factor in one run; QCs above ULOQ diluted with blank matrix | M10 §3.2.7, p.15 | "At least 5 replicates per dilution factor should be tested in one run to determine if concentrations are accurately and precisely measured within the calibration range." | verified-from-primary |
| Dilution integrity acceptance | Mean accuracy ±15%; %CV ≤ 15% | M10 §3.2.7, p.15 | "The mean accuracy of the dilution QCs should be within ±15% of the nominal concentration and the precision (%CV) should not exceed 15%." | verified-from-primary |
| Dilution range validated | Study dilution factors must lie within validated range | M10 §3.2.7, p.15 | "The dilution factor(s) and concentrations applied during study sample analysis should be within the range of the dilution factors and concentrations evaluated during validation." | verified-from-primary |
| Reinjection reproducibility | Reinject a run with calibrators and ≥ 5 replicates of low, middle, high QCs after storage | M10 §3.2.9, p.18 | "Reinjection reproducibility is assessed by reinjecting a run that is comprised of calibration standards and a minimum of 5 replicates of the low, middle and high QCs after storage." | verified-from-primary |
| Reinjection acceptance | **Not given numerically in §3.2.9** ("precision and accuracy of the reinjected QCs establish the viability") | M10 §3.2.9, p.18 | "The precision and accuracy of the reinjected QCs establish the viability of the processed samples." | verified-from-primary (absence of a numeric criterion noted) |

## 8. Stability (M10 §3.2.8)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| QC levels | Low and high QC | M10 §3.2.8, p.15 | "Stability of the analyte in the matrix is evaluated using low and high concentration QCs." | verified-from-primary |
| Replication | One bulk QC per level, divided into ≥ 3 aliquots | M10 §3.2.8, p.15 | "One bulk QC should be prepared at each concentration level. For each concentration tested, the bulk sample should be divided into a minimum of 3 aliquots that will be stored, stressed and analysed." | verified-from-primary |
| Acceptance | Mean concentration at each level within ±15% of nominal | M10 §3.2.8, p.16 | "The mean concentration at each QC level should be within ±15% of the nominal concentration." | verified-from-primary |
| Storage period coverage | Stored ≥ study-sample storage period | M10 §3.2.8, p.15 | "Validation of storage periods should be performed on QCs that have been stored for a time that is equal to or longer than the study sample storage periods." | verified-from-primary |
| Literature data | Not sufficient | M10 §3.2.8, p.15 | "Reference to data published in the literature is not considered sufficient." | verified-from-primary |
| Freeze–thaw | ≥ 3 cycles (≥ number experienced by samples); ≥ 12 h frozen between thaws | M10 §3.2.8(1), p.16 | "QCs should be kept frozen for at least 12 hours between the thawing cycles." / "The number of freeze-thaw cycles validated should equal or exceed that of the freeze-thaw cycles undergone by the study samples, but a minimum of three cycles should be conducted." | verified-from-primary |
| Bench-top | Same temperature, ≥ same duration; times not additive | M10 §3.2.8(1), p.16 | "The total time on the bench top should be concurrent; it is not acceptable to use additive exposure to bench top conditions (i.e., time from each freeze-thaw evaluation should not be added up)." | verified-from-primary |
| Long-term | Same storage conditions, ≥ same duration; chemical drugs: −20 °C may be extrapolated to lower temperatures | M10 §3.2.8(1), p.17 | "For chemical drugs, the stability at one temperature (e.g., -20°C) to can be extrapolated to lower temperatures (e.g., -70/-80°C)." (sic) | verified-from-primary |
| Processed-sample stability | Incl. autosampler time; storage times not additive | M10 §3.2.8(2), p.17 | "The total time that a processed sample is stored must be concurrent (i.e., autosampler and other storage times cannot be added together)." | verified-from-primary |
| Stock/working solutions | Lowest and highest concentrations; assessed by detector response | M10 §3.2.8(3), p.17 | "The stability of the stock and working solutions of the analyte and IS should be determined under the storage conditions used during the analysis of study samples by using the lowest and the highest concentrations of these solutions." | verified-from-primary |
| Stock/working acceptance | **No numeric criterion stated in §3.2.8(3)** | M10 §3.2.8(3), p.17 | — | verified-from-primary (absence noted) |
| Whole-blood stability (if plasma) | Evaluate in development or validation | M10 §3.2.8(4), p.18 | "If the matrix used is plasma, the stability of the analyte in blood should be evaluated during method development (e.g., using an exploratory method in blood) or during method validation." | verified-from-primary |
| Long-term failed time point (Q&A) | Later time points may still be evaluated; investigate failure | M10 Q&A (section 3), p.4 | "Additional time-points can be evaluated. Any failure should be investigated to identify the root cause and the impact on the stability assessment." | verified-from-primary |

## 9. Study-sample analysis — run composition and acceptance (M10 §3.3)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Run composition | Blank, zero, ≥ 6 calibrator levels, ≥ 3 QC levels in duplicate or ≥ 5% of study samples (whichever higher) | M10 §3.3.1, p.19 | "An analytical run consists of a blank sample (processed matrix sample without analyte and without IS), a zero sample (processed matrix with IS), calibration standards at a minimum of 6 concentration levels, at least 3 levels of QCs (low, medium and high) in duplicate (or at least 5% of the number of study samples, whichever is higher) and the study samples to be analysed." | verified-from-primary |
| QC bracketing | Study samples always bracketed by QCs | M10 §3.3.1, p.19 | "Study samples should always be bracketed by QCs." | verified-from-primary |
| Calibrator acceptance in a run | ±15% (±20% LLOQ); ≥ 75% passing incl. ≥ 6 levels | M10 §3.3.2, p.20 | "The back-calculated concentrations of the calibration standards should be within ±15% of the nominal value, except for the LLOQ for which it should be within ±20%. At least 75% of the calibration standard concentrations, which should include a minimum of six concentration levels, should fulfil these criteria." | verified-from-primary |
| Rejected LLOQ standard | Next lowest acceptable standard becomes the run LLOQ and keeps ±15% | M10 §3.3.2, p.20 | "If the rejected calibration standard is the LLOQ, the new lower limit for this analytical run is the next lowest acceptable calibration standard of the calibration curve. This new lower limit calibration standard will retain its original acceptance criteria (i.e., ±15%)." | verified-from-primary |
| Revised range | Must still cover low, medium and high QC | M10 §3.3.2, p.20 | "The revised calibration range should cover at least 3 QC concentration levels (low, medium and high)." | verified-from-primary |
| QC acceptance in a run | ≥ 2/3 of all QCs and ≥ 50% per level within ±15% | M10 §3.3.2, p.20 | "At least 2/3 of the total QCs and at least 50% at each concentration level should be within ±15% of the nominal values. If these criteria are not fulfilled the analytical run should be rejected." | verified-from-primary |
| Dilution QCs in study runs | Affect only the diluted samples, not run acceptance | M10 §3.3.2, p.20 | "The within-run acceptance criteria of the dilution QC(s) will only affect the acceptance of the diluted study samples and not the outcome of the analytical run." | verified-from-primary |
| Overall QC performance | Investigate if overall mean accuracy/precision fails 15% | M10 §3.3.2, p.21 | "If the overall mean accuracy and/or precision fails the 15% criterion, an investigation to determine the cause of the deviation should be conducted." | verified-from-primary |
| QCs vs observed concentrations | ≥ 2 QC levels within the range of study-sample concentrations | M10 §3.3.3, p.21 | "At least 2 QC levels should fall within the range of concentrations measured in study samples." | verified-from-primary |
| Reinjection without cause | Not acceptable | M10 §3.3.5, p.23 | "Reinjection of a full analytical run or of individual calibration standards or QCs simply because the calibration standards or QCs failed, without any identified analytical cause, is not acceptable." | verified-from-primary |

## 10. Incurred sample reanalysis (M10 §5)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| When (nonclinical) | In general at least once per species | M10 §5, p.33 | "For nonclinical studies within the scope of this guideline, ISR should, in general, be performed at least once per species." | verified-from-primary |
| How | Separate runs, different days, same method | M10 §5, p.34 | "ISR is conducted by repeating the analysis of a subset of samples from a given study in separate (i.e., different to the original) runs on different days using the same bioanalytical method." | verified-from-primary |
| Minimum number of ISR samples | ≤ 1000 samples: 10%; > 1000: 100 + 5% of samples above 1000 | M10 §5, p.34 | "However, as a minimum, if the total number of study samples is less than or equal to 1000, then 10% of the samples should be reanalysed; if the total number of samples is greater than 1000, then 10% of the first 1000 samples (100) plus 5% of the number of samples that exceed 1000 samples should be assessed." | verified-from-primary |
| Sample selection | Pre-defined objective criteria; around Cmax and in elimination phase; no pooling | M10 §5, p.34 | "Therefore, it is recommended that the samples for ISR be chosen around the maximum concentration (Cmax) and some in the elimination phase." / "Samples should not be pooled, as pooling may limit anomalous findings." | verified-from-primary |
| Timing | Within the stability window, not same day as original | M10 §5, p.34 | "ISR should be performed within the stability window of the analyte, but not on the same day as the original analysis." | verified-from-primary |
| % difference formula | % difference = (repeat value − initial value) / mean value × 100, where mean = mean of initial and repeat | M10 §5, p.34 (equation checked on rendered page) | "The percent difference between the initial concentration and the concentration measured during the repeat analysis should be calculated in relation to their mean value using the following equation:" | verified-from-primary |
| Acceptance (chromatography) | Within ±20% for ≥ 2/3 of repeats | M10 §5, p.34 | "For chromatographic methods, the percent difference should be within ±20% for at least 2/3 of the repeats." | verified-from-primary |
| Failure | Investigation under an SOP | M10 §5, p.34 | "If the overall ISR results fail the acceptance criteria, an investigation should be conducted and the causes remediated." | verified-from-primary |
| Trends of concern | e.g. all ISR samples from one subject or one run fail | M10 §5, p.35 | "Examples of trends that are of concern may include: • All ISR samples from one subject fail • All ISR samples from one run fail" | verified-from-primary |
| Flyers | Individual large differences (e.g. > 50%) do not trigger reanalysis; ISR data never replace originals | M10 §5, p.35 | "Individual samples that are quite different from the original value (e.g., > 50%, "flyers") should not trigger reanalysis of the original sample and do not need to be investigated. ISR sample data should not replace the original study sample data." | verified-from-primary |
| ISR investigation (Q&A) | SOP-driven, whole process | M10 Q&A (section 5), p.5 | "The investigation should be driven by an SOP and should take into account the entire process, including sample handling, processing and analysis." | verified-from-primary |

## 11. Recovery (M10 §7.3) — chromatographic methods with extraction

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Definition | Response of spiked-then-extracted vs extracted-then-spiked blank | M10 §7.3, p.42 | "Recovery is determined by comparing the analyte response in a biological sample that is spiked with the analyte and processed, with the response in a biological blank sample that is processed and then spiked with the analyte." | verified-from-primary |
| Acceptance | **No numeric criterion**: need not be 100%, must be consistent (analyte and IS) | M10 §7.3, p.42 | "Recovery of the analyte does not need to be 100%, but the extent of recovery of an analyte and of the IS (if used) should be consistent." | verified-from-primary |
| Levels | Typically low, medium, high | M10 §7.3, p.42 | "Recovery experiments are recommended to be performed by comparing the analytical results for extracted samples at multiple concentrations, typically three concentrations (low, medium and high)." | verified-from-primary |

## 12. Partial and cross validation (pointer only)

M10 §6.1 (p.35) lists changes that call for partial validation (site transfer, platform change, sample
processing, sample volume, calibration range, anticoagulant, matrix or species within a matrix, storage
conditions) and states "The parameters of the partial validations should meet the full validation
criteria." (p.36). Cross-validation (§6.2, p.36–37) was not transcribed further — **not needed for
the first driver version; NOT VERIFIED beyond these two sentences.**

## Implications for the driver (no scientific defaults)

- Every numeric criterion in §§3–10 above is citable to M10 with section and page; they can be encoded as
  a versioned, cited rule table (CLAUDE.md §4). Each criterion should carry the M10 section id.
- **Weighting is not an M10 requirement.** The build plan's "weighted calibration regression" must be
  restated: the regression model, weighting (e.g. 1, 1/x, 1/x²) and transformation are **required
  inputs fixed in the validation plan/SOP** (M10 §3.2.4). The driver fits what the plan declares; it must
  not pick a weighting. Any statistical method for *choosing* a weighting would need its own citation.
- M10 gives **no numeric criterion** for: reinjection reproducibility, stock/working-solution stability,
  recovery. The driver should report these and route acceptance to the bioanalytical PI as a declared
  determination, not invent a threshold.
- Applicability: GLP TK and surrogate PK studies are in scope; exploratory (non-submission) work is not,
  so the driver should record which regime a validation is claimed under.
- Human determination: "Method validated" (bioanalytical PI) — M10 contains no signatory role; the role
  assignment is a HOS design decision, not an M10 statement.

## Items NOT VERIFIED

1. Ligand-binding assay criteria (M10 §4) — out of scope, not transcribed.
2. Any EMA update to the M10 Q&A after 16 January 2023 — not read.
3. Cross-validation statistics (M10 §6.2) — not transcribed.
4. Statistical conventions not stated in M10: %CV denominator, pooled within-run precision method,
   IS-normalised matrix factor — no source verified.

## Citations to register

1. International Council for Harmonisation (ICH). *M10: Bioanalytical Method Validation and Study Sample Analysis.* Final version, adopted 24 May 2022 (Step 4). Sections 1.3, 2.2.1, 3.1, 3.2.1–3.2.9, 3.3.1–3.3.5, 5, 7.3, 9. https://database.ich.org/sites/default/files/M10_Guideline_Step4_2022_0524.pdf
2. ICH. *M10 Bioanalytical Method Validation and Study Sample Analysis — Questions and Answers.* Adopted by the ICH Assembly under Step 4, 16 November 2022; EMA reproduction EMA/CHMP/ICH/660315/2022, dated 16 January 2023. https://www.ema.europa.eu/system/files/documents/scientific-guideline/ich_guideline_m10_on_bioanalytical_method_validation_and_study_sample_analysis_qas-en.pdf
