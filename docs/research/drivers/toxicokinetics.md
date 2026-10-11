# Driver research note — `toxicokinetics` (tox.toxicokinetics, Wave A2)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A2: ICH S3A; NCA per dose/sex/day;
dose proportionality by the power model (Smith et al. 2000, *(verify)*); accumulation ratio.
The NCA equations themselves are verified in `in_vivo_pk.md` (A3) and are not repeated here.

Confidence labels: **verified-from-primary** (exact wording read in the primary document this session;
"(abstract)" when only the abstract was read); **verified-bibliographic** (citation confirmed via
Crossref/PubMed/Europe PMC, content not read); **secondary-reproduction** (wording read in a source
that is not the originating document); **NOT VERIFIED** (not read; nothing filled in from memory).

For copyrighted journal abstracts only a short fragment is quoted and the rest is paraphrased; ICH
guidelines and NCI Thesaurus/CDISC terminology are quoted in full sentences.

## Primary documents read

| Document | Copy read | Header as printed | SHA-256 of the PDF read |
|---|---|---|---|
| ICH S3A *Note for Guidance on Toxicokinetics: The Assessment of Systemic Exposure in Toxicity Studies* | `https://database.ich.org/sites/default/files/S3A_Guideline.pdf` (15 pp.) | "Current Step 4 version dated 27 October 1994" | `f499610710c4206331c58318ec1377729b1c4b6a1fdc9dd4154fb3cdfded9b37` |
| Smith BP et al. 2000, *Pharm Res* 17(10):1278–1283 | Crossref record + Europe PMC abstract (PMID 11145235). Full text **closed** (Springer PDF link returns an HTML login page; OpenAlex `oa_status: closed`). | — | — |
| Hummel J et al. 2009, *Pharm Stat* 8(1):38–49 | Crossref record + Europe PMC abstract (PMID 18386766). Full text not read. | — | — |
| NCI Thesaurus (CDISC SDTM PK parameter terminology) | EVS REST API `https://api-evsrest.nci.nih.gov/api/v1/concept/ncit/<code>`, NCIt version **26.09d (2026-09-28)** | — | — |
| Li L et al. 2013, *Curr Drug Metab* 14(5):605–615 | Crossref record + Europe PMC abstract (PMID 23701162). Full text not read. | — | — |

S3A page numbers below are the **printed** page numbers of the guideline body (printed p.1 = PDF p.5).

## 1. ICH S3A — what toxicokinetics must deliver

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Definition of toxicokinetics | PK data generated within/alongside toxicity studies to assess systemic exposure | S3A §1, p.1 | "In this context, toxicokinetics is defined as the generation of pharmacokinetic data, either as an integral component in the conduct of non-clinical toxicity studies or in specially designed supportive studies, in order to assess systemic exposure." | verified-from-primary |
| Primary objective | Describe systemic exposure and its relation to dose level and time course of the study | S3A §2, p.2 | "The primary objective of toxicokinetics is: - to describe the systemic exposure achieved in animals and its relationship to dose level and the time course of the toxicity study." | verified-from-primary |
| Exposure parameters | AUC, Cmax and C(time) are the most commonly used; unbound concentration may be more appropriate for some compounds | S3A §2, p.2 | "Plasma (or whole blood or serum) AUC, Cmax and C (time) (Note 2) are the most commonly used parameters in assessing exposure in toxicokinetics studies. For some compounds it will be more appropriate to calculate exposure based on the (plasma protein) unbound concentration." | verified-from-primary |
| Definition of exposure | AUC and/or Cmax or C(time); other parameters case by case | S3A Note 1, p.9 | "The area under the matrix level concentration-time curve (AUC) and/or the measurement of matrix concentrations at the expected peak-concentration time Cmax, or at some other selected time C(time), are the most commonly used parameters." | verified-from-primary |
| Symbols | Cmax, C(time), tmax, AUC(0-t) per ACCP 1982 nomenclature manual | S3A Note 2, p.10 | "AUC(0-t) Area under concentration-time curve from zero to time t. It should be noted that AUC(0-infinity) is a special case of AUC(0-t)." | verified-from-primary |
| Other derived parameters | Bioavailability, half-life, fu, volume "may be of value"; selection case by case | S3A Note 2, p.10 | "Other derived parameters, for example bioavailability, half-life, fraction of unbound drug and volume of distribution may be of value in interpreting toxicokinetic data." | verified-from-primary |
| "Monitor" | 1–3 samples per dosing interval (e.g.) to estimate C(time) or Cmax | S3A Note 1, p.9 | "Monitor: to take a small number of matrix samples (e.g. 1-3) during a dosing interval to estimate C(time) or Cmax." | verified-from-primary |
| "Profile" | 4–8 samples per dosing interval (e.g.) to estimate Cmax and/or C(time) and AUC | S3A Note 1, p.9 | "Profile: to take (e.g. 4-8) matrix samples during a dosing interval to make an estimate of Cmax and/or C(time) and area under matrix concentration-time curve (AUC)." | verified-from-primary |
| Sampling time points | As frequent as necessary; number justified as adequate to estimate exposure | S3A §3.3, p.3 | "In each study, the number of time points should be justified on the basis that they are adequate to estimate exposure (see 3.2)." | verified-from-primary |
| Satellite groups | TK animals treated identically but used primarily for TK; often needed in rodents | S3A §3.5, p.4 | "Normally, samples for the generation of toxicokinetic data may be collected from main study animals, where large animals are involved, but satellite groups may be required for the smaller (rodent) species." | verified-from-primary |
| Both sexes | Estimate exposure in both sexes unless justified | S3A §3.5, p.4 | "Where both male and female animals are utilised in the main study it is normal to estimate exposure in animals of both sexes unless some justification can be made for not so doing." | verified-from-primary |
| Control-group samples | Often not assayed; may be collected and assayed if useful | S3A Note 8, p.11 | "It is often considered unnecessary to assay samples from control groups." | verified-from-primary |
| Repeat-dose design | Profile/monitor at the start and towards the end of treatment of the first repeat-dose study | S3A §4.3, p.7 | "It may consist of exposure profiling or monitoring (Note 1) at appropriate dose levels at the start and towards the end of the treatment period of the first repeat dose study (Note 12)." | verified-from-primary |
| First repeat-dose study with TK | Normally ≥ 14 days | S3A Note 12, p.11 | "The first repeat dose study incorporating toxicokinetic data for each species is normally of 14 days duration or longer." | verified-from-primary |
| Low dose exposure | Ideally equal to or just above maximum expected patient exposure | S3A §3.4.1, p.3 | "At the low dose, preferably a no-toxic-effect dose level (Note 5), the exposure in the animals of any toxicity study should ideally equal or just exceed the maximum expected (or known to be attained) in patients." | verified-from-primary |
| Absorption-limited top dose | Lowest dose giving maximum exposure accepted as top dose | S3A §3.4.3, p.4 | "Where toxicokinetic data indicate that absorption of a compound limits exposure to parent compound and/or metabolite(s) (Note 6), the lowest dose level of the substance producing the maximum exposure should be accepted as the top dose level to be used (when no other dose-limiting constraint applies, Note 7)." | verified-from-primary |
| Non-linear kinetics | Interpret with care; does not by itself invalidate findings | S3A §3.4.3, p.4 | "However, non-linear kinetics should not necessarily result in dose limitations in toxicity studies or invalidate the findings; toxicokinetics can be very helpful in assessing the relationship between dose and exposure in this situation." | verified-from-primary |
| Time-dependent exposure | Saturation, long half-life accumulation, auto-induction | S3A Note 3, p.10 | "Increasing exposure may also occur during the course of a study for those compounds which have a particularly long plasma half-life." / "Conversely, unexpectedly low exposure may occur during a study as a result of auto-induction of metabolising enzymes." | verified-from-primary |
| Statistics | Low precision expected; means or medians with variability; individual data may matter more | S3A §3.9, p.5 | "Consideration should be given to the calculation of mean or median values and estimates of variability, but in some cases the data of individual animals may be more important than a refined statistical analysis of group data." | verified-from-primary |
| Log transformation | Rationale required | S3A §3.9, p.5 | "If data transformation (e.g. logarithmic) is performed, a rationale should be provided." | verified-from-primary |
| Analytical method | Specific, adequate accuracy/precision, adequate LOQ | S3A §3.10, p.6 | "The analytical methods to be used in toxicokinetic studies should be specific for the entity to be measured and of an adequate accuracy and precision." | verified-from-primary |
| GLP | Concomitant TK in GLP studies must conform to GLP | S3A §3.1, p.2 | "It should be noted that for those toxicity studies whose performance is subject to Good Laboratory Practice (GLP) the concomitant toxicokinetics must also conform to GLP." | verified-from-primary |
| Reporting | Comprehensive account with evaluation and implications for tox findings | S3A §3.11, p.6 | "A comprehensive account of the toxicokinetic data generated, together with an evaluation of the results and of the implications for the interpretation of the toxicology findings should be given." | verified-from-primary |
| Prescriptiveness | No rigid procedures; case-by-case | S3A §1, p.1 | "As the development of a pharmaceutical product is a dynamic process which involves continuous feed-back between non-clinical and clinical studies, no rigid detailed procedures for the application of toxicokinetics are recommended." | verified-from-primary |

**Not in S3A:** a calculation method for AUC, any dose-proportionality test, any accumulation-ratio
definition, or any numeric "adequate exposure" criterion. S3A addresses dose-exposure non-linearity only
qualitatively (§3.2 "alert the toxicologist to non-linear, dose-related changes in exposure", §3.4.3,
Note 3); a text search of the extracted PDF found no occurrence of "accumul…" or of "proportion…" in
the dose-proportionality sense.

## 2. Dose proportionality — power model (Smith et al. 2000)

| Parameter | Value | Source | Verbatim quote | Confidence |
|---|---|---|---|---|
| Bibliographic identity | Smith BP, Vandenhende FR, DeSante KA, Farid NA, Welch PA, Callaghan JT, Forgue ST. Confidence interval criteria for assessment of dose proportionality. *Pharm Res.* 2000 Oct;17(10):1278–1283. Springer. | Crossref `https://api.crossref.org/works/10.1023/a:1026451721686`; PMID 11145235 | Crossref title: "Confidence Interval Criteria for Assessment of Dose Proportionality" | verified-bibliographic |
| DOI | **10.1023/A:1026451721686** | Crossref | — | verified-bibliographic |
| Power model | PK = β0 · Dose^β1 (fitted in the paper with mixed-effects models); equivalently ln(PK) = ln β0 + β1·ln(Dose) — the log form is algebra on the abstract's model, not a quote | Smith 2000 abstract (Methods) | "power function of the form PK = beta0 x Dose(beta1)" | verified-from-primary (abstract) |
| Decision logic | A (1−α) CI for the ratio of dose-normalised geometric means (Rdnm) must lie wholly inside an acceptance interval set a priori | Smith 2000 abstract (Methods) | Paraphrased: the CI for Rdnm is compared with a pre-specified, clinically relevant acceptance region; proportionality is declared only if the CI lies completely inside it. | verified-from-primary (abstract, paraphrased) |
| Depends only on dose ratio | The proportional region under the power model depends only on the dose ratio; ρ1 (max ratio with CI inside the region) and ρ2 (ratio beyond which CI is wholly outside) can be computed | Smith 2000 abstract (Results) | Paraphrased from abstract Results. | verified-from-primary (abstract, paraphrased) |
| Explicit criterion on β1 | 90% CI of β1 within **[1 + ln(θL)/ln(r), 1 + ln(θH)/ln(r)]**, r = highest/lowest dose | **Not in the abstract.** Read in open-access secondary sources: Braeckman R et al. *J Child Adolesc Psychopharmacol* 2022;32(5):288–295 (DOI 10.1089/cap.2022.0015, PMC9245728, CC BY-NC), Methods, citing Smith 2000; and Shang H et al. *J Pharm Anal* 2022;12(2):278–286 (DOI 10.1016/j.jpha.2021.03.008, PMC9091740, CC BY-NC-ND), §2, citing Hummel 2009 | Braeckman 2022: "Dose proportionality was declared if the calculated 90% CI lay within the acceptance range [1 + log(ΘL)/log(R), 1 + log(ΘH)/log(R)], where ΘL and ΘH are the lower and upper limits of the CI (0.8 and 1.25, respectively) and R is the ratio between the highest and lowest doses in the study (R = 2 in this study)." | secondary-reproduction |
| Algebraic check of that criterion | Under PK = β0·Dose^β1 the dose-normalised ratio between highest and lowest dose is Rdnm = r^(β1−1); requiring θL ≤ Rdnm ≤ θH and taking logs gives the interval above | Derivation from the abstract's model + Hummel's definition of Rdnm (row below) | — (derivation, no quote) | exact analytical consequence of verified definitions; the **paper's own statement is NOT VERIFIED** |
| Rdnm defined at extremes of dose range | Ratio of predicted means at the extremes of the dose range, compared with (θL, θU) | Hummel J, McKendrick S, Brindley C, French R. *Pharm Stat* 2009;8(1):38–49, abstract. DOI 10.1002/pst.326 (Crossref "issued" 2008-04-03 online) | Paraphrased: a criterion comparing the 90% CI of Rdnm, the ratio of predicted means at the extremes of the dose range, with a pre-defined equivalence interval (θL, θU). | verified-from-primary (abstract, paraphrased) |
| θL, θU values | **Not fixed by any source.** BE limits 0.8/1.25 are described as reasonable for doses a doubling apart but impractically strict over a full range; 0.5/2 proposed for exploratory assessment | Hummel 2009 abstract | "A more lenient criterion with values theta(L)=0.5 and theta(U)=2 is proposed" | verified-from-primary (abstract) |
| Smith 2000 own example θ values, α, model variance structure, ρ1/ρ2 formulas | — | Smith 2000 full text | — | **NOT VERIFIED** (full text closed) |

## 3. Accumulation ratio

No FDA, EMA or ICH guidance read in this session defines an accumulation ratio (searched: ICH S3A,
M3(R2), M13A, M12; FDA *Bioavailability Studies Submitted in NDAs or INDs* 2022; EMA
CPMP/EWP/QWP/1401/98 Rev. 1 — no occurrence of "accumulation" with this meaning). The citable
definitions found are the **CDISC SDTM PK-parameter controlled terminology** (published through the NCI
Thesaurus; the terminology FDA requires for SEND/SDTM PP-domain submissions) and one systematic review.

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| ARAUC (Accumulation Ratio AUCTAU) | AUCτ at steady state / AUCτ over the initial dosing interval | NCIt C102356; CDISC codes SDTM-PKPARMCD `ARAUC`, SDTM-PKPARM "Accumulation Ratio AUCTAU"; NCIt 26.09d | CDISC definition: "The area under the curve over the dosing interval at steady state divided by the area under the curve over the initial dosing interval." | verified-from-primary |
| ARCMAX | Cmax at steady state / Cmax in initial dosing interval | NCIt C102357 | "The maximum concentration at steady state divided by the maximum concentration during the initial dosing interval." | verified-from-primary |
| ARAUCLST | AUClast ratio, steady state vs initial interval | NCIt C139129 | "The area under the curve (AUC) from the time of dosing to the last measurable concentration divided by the area under the curve from the time of dosing to the last measurable concentration during the initial dosing interval." | verified-from-primary |
| ARAUCD (dose-normalised) | Each AUCτ divided by its dose before the ratio | NCIt C132435 | "The area under the curve (AUCTAU) at steady state divided by the area under the curve (AUCTAU) over the initial dosing interval, each divided by the associated dose." | verified-from-primary |
| AILAMZ (predicted, from single dose) | Predicted accumulation from single-dose λz | NCIt C114234 | "Predicted accumulation ratio for area under the curve (AUC) calculated using the Lambda z estimated from single dose data." (formula not given) | verified-from-primary (definition only; formula NOT VERIFIED) |
| Most common practice | Rac = AUC(0-τ,ss)/AUC(0-τ,1) used in 72.9% of 122 studies reviewed; eight different methods were in use | Li L, Li X, Xu L, Sheng Y, Huang J, Zheng Q. *Curr Drug Metab* 2013;14(5):605–615, abstract. DOI 10.2174/13892002113149990002 | "R(ac) = AUC(0-τ,ss) / AUC(0-τ,1)" | verified-from-primary (abstract) |
| Severity bands (<1.2, 1.2–2, 2–5, ≥5) | Authors' suggestion only — not a regulatory criterion | Li 2013 abstract | Paraphrased: the authors suggest cut-offs for non-, weak, moderate and strong accumulation. | verified-from-primary (abstract); **do not encode as an interpretive rule** |

**Important for tox studies:** CDISC defines ARAUC against **steady state**. In a toxicity study the
"last day" profile (S3A §4.3 "towards the end of the treatment period") is not automatically at steady
state. A day-N/day-1 AUCτ ratio is an *observed* ratio; it may be labelled ARAUC only if steady state is
established, otherwise CDISC's ARAUCINT/ARAUCLST-style "T1 to T2" terms or a plain "observed ratio
day N / day 1" label should be used. Whether steady state was reached is a judgement, not a computation.

## Implications for the driver (no scientific defaults)

- NCA per dose/sex/day: cite S3A §2/§3.5/§4.3 for *what* to report; cite A3 sources for *how* to compute.
- Monitoring vs profiling (S3A Note 1) determines which parameters are estimable: with 1–3 samples only
  C(time)/Cmax may be reported; AUC requires a profile. The driver should refuse AUC on a "monitor" design
  rather than estimate it.
- Dose proportionality: power model on ln-transformed exposure (S3A §3.9 requires the rationale for log
  transform to be recorded). **θL, θH and the CI level are required inputs with a stated basis** (Hummel
  2009 shows both 0.8/1.25 and 0.5/2 are in use). r = highest/lowest dose is computed from the design.
  The interval formula should be cited as "derived from Smith et al. 2000 (power model) — exact algebraic
  form; criterion as reproduced in Braeckman 2022 / Shang 2022" until the Smith 2000 full text is read.
- Fitting method: Smith 2000 used mixed-effects models (abstract). For tox studies with satellite
  (one-profile-per-animal or sparse) designs, the regression structure is a design choice to record; no
  source for a preclinical-specific variant was verified.
- Accumulation: compute ratios of AUCτ (and Cmax) between declared profile days; label per CDISC; never
  assert steady state automatically.
- "Exposure adequacy for the tox study" (human determination) — S3A §3.4 gives the qualitative principles;
  no numeric criterion exists in S3A.

## Items NOT VERIFIED

1. Smith et al. 2000 full text — the paper's own statement of the β1 interval, its example θ values,
   α, the mixed-model variance structure, and the ρ1/ρ2 formulas (closed access).
2. Hummel et al. 2009 full text (only abstract read).
3. Any FDA/EMA/ICH guidance text defining an accumulation ratio — none found in the guidances read.
4. Formula behind CDISC AILAMZ (predicted accumulation from λz) — definition only.
5. Sparse/destructive-sampling NCA methods (e.g. for rodent satellite groups with one sample per animal)
   — not researched in this session; needed before the driver supports composite profiles.
6. ICH S3A Q&A (microsampling, 2017) — not read.

## Citations to register

1. ICH. *S3A: Note for Guidance on Toxicokinetics: The Assessment of Systemic Exposure in Toxicity Studies.* Step 4, 27 October 1994. Sections 1, 2, 3.1–3.11, 4.3; Notes 1, 2, 3, 8, 12. https://database.ich.org/sites/default/files/S3A_Guideline.pdf
2. Smith BP, Vandenhende FR, DeSante KA, Farid NA, Welch PA, Callaghan JT, Forgue ST. Confidence interval criteria for assessment of dose proportionality. *Pharm Res.* 2000;17(10):1278–1283. DOI: 10.1023/A:1026451721686. PMID 11145235. *(bibliographic + abstract only)*
3. Hummel J, McKendrick S, Brindley C, French R. Exploratory assessment of dose proportionality: review of current approaches and proposal for a practical criterion. *Pharm Stat.* 2009;8(1):38–49. DOI: 10.1002/pst.326. PMID 18386766. *(bibliographic + abstract only)*
4. Braeckman R, Guenther S, Mickle TC, Barrett AC, Smith A, Oh C. Dose proportionality and steady-state pharmacokinetics of serdexmethylphenidate/dexmethylphenidate, a novel prodrug combination to treat attention-deficit/hyperactivity disorder. *J Child Adolesc Psychopharmacol.* 2022;32(5):288–295. DOI: 10.1089/cap.2022.0015. PMC9245728. *(secondary reproduction of the Smith criterion)*
5. Shang H, Dai X, Li M, Kai Y, Liu Z, Wang M, Li Q, Gu Y, Liu C, Si D. Absolute bioavailability, dose proportionality, and tissue distribution of rotundic acid in rats based on validated LC-QqQ-MS/MS method. *J Pharm Anal.* 2022;12(2):278–286. DOI: 10.1016/j.jpha.2021.03.008. PMC9091740. *(secondary reproduction; preclinical use of θ = 0.5/2.0)*
6. CDISC SDTM PK Parameters controlled terminology, via NCI Thesaurus version 26.09d (2026-09-28): C102356 ARAUC, C102357 ARCMAX, C139129 ARAUCLST, C132435 ARAUCD, C114234 AILAMZ. https://api-evsrest.nci.nih.gov/api/v1/concept/ncit/C102356 (and corresponding codes); browser: https://evsexplore.semantics.cancer.gov/evsexplore/concept/ncit/C102356
7. Li L, Li X, Xu L, Sheng Y, Huang J, Zheng Q. Systematic evaluation of dose accumulation studies in clinical pharmacokinetics. *Curr Drug Metab.* 2013;14(5):605–615. DOI: 10.2174/13892002113149990002. PMID 23701162. *(abstract only)*
