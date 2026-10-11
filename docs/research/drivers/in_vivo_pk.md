# Driver research note — `in_vivo_pk` (adme.in_vivo_pk, Wave A3)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A3: ICH M3(R2) section 3; NCA
(Cmax, Tmax, AUC0-t by linear-up/log-down, λz, t½, AUCinf, CL, Vss, F) per Gabrielsson & Weiner
*(verify edition)*. This note also supplies the NCA equations used by `toxicokinetics` (A2).

Confidence labels: **verified-from-primary** (exact wording read in the primary document this session);
**verified-bibliographic** (catalogue/publisher record confirmed, content not read);
**secondary-reproduction** (wording read in a source that is not the originating document — here mostly
the Certara Phoenix WinNonlin user documentation and open-access papers); **NOT VERIFIED**.

For copyrighted non-regulatory sources only short fragments are quoted; equations are reproduced as
facts. ICH, FDA (US Government work), EMA (reproduction authorised with acknowledgement) and NCI
Thesaurus/CDISC text are quoted in full sentences.

## Documents read

| Document | Copy read | Header / version | SHA-256 of the PDF read |
|---|---|---|---|
| ICH M3(R2) | `https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf` | "Current Step 4 version dated 11 June 2009" | `da8bc18c11d224d23b2b3c391a32e5aa87fd49fbdc6bf515c9787bb4c41f8552` |
| FDA *Bioavailability Studies Submitted in NDAs or INDs — General Considerations*, Guidance for Industry (CDER, April 2022, final; docket FDA-2018-D-4367) | `https://www.fda.gov/media/121311/download` (FDA's server blocks curl; the PDF was obtained through the WebFetch tool and text-extracted locally) | "April 2022 Clinical Pharmacology" | `2ccb9c8a484d79434f57be176aa76c11786e2322c12f33afddfdae626230e3d3` |
| EMA *Guideline on the Investigation of Bioequivalence*, CPMP/EWP/QWP/1401/98 Rev. 1/Corr ** | `https://www.ema.europa.eu/en/documents/scientific-guideline/guideline-investigation-bioequivalence-rev1_en.pdf` | "London, 20 January 2010"; Rev. 1 into effect 1 August 2010 | `331a6948620dc246c4ae12cfe2a782a42e17bc82d5f9ed6ed743df82d1266d33` |
| ICH M13A *Bioequivalence for Immediate-Release Solid Oral Dosage Forms* | `https://database.ich.org/sites/default/files/ICH_M13A_Step4_Final_Guideline_2024_0723.pdf` | "Final version Adopted on 23 July 2024" | `97504546d6d4fc8c9626ae9f606d26ba6466c2e131fd4f3aa010a5222f084ec8` |
| Gabrielsson & Weiner, 5th ed. — publisher's front matter + table of contents | `https://www.apotekarsocieteten.se/app/uploads/2024/01/PKPD_ed5_TOC.pdf` (16 pp.) | "©2016 Johan Gabrielsson and Apotekarsocieteten" | `5780e419b8f534e97d841fa1cd68a1ffa6216db0096e0841b97b5d79b6756faf` |
| Library catalogue records | Libris (Swedish national union catalogue) MARC records 7756516, 7756531, 7756553, 10438078, 19192234; Library of Congress records 19198530 (G&W 5th ed.) and LCCN 82004608 (Gibaldi & Perrier 2nd ed.) | — | — |
| Certara Phoenix 8.3 online help (NCA) | `https://onlinehelp.certara.com/phoenix/8.3/topics/` pages `NCA_parameter_formulas.htm`, `Partial_area_calculation.htm`, `Options_tab1.htm`, `Lambda_Z_or_Slope_Estimation_settings.htm` (equation images viewed) | "© 2020 Certara USA, Inc."; "Last modified date: 7/9/20" | — (HTML) |
| NCI Thesaurus / CDISC SDTM PK parameter terms | EVS REST API, NCIt **26.09d** (2026-09-28) | — | — |
| Benet LZ 2012 commentary, *AAPS J* 14(2):164–167 | PMC HTML `https://pmc.ncbi.nlm.nih.gov/articles/PMC3326156/` | — | — |

## 1. Regulatory basis — what M3(R2) section 3 actually requires

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Before first-in-human | In vitro metabolic + PPB data (animals and humans) and **systemic exposure (S3A)** in repeat-dose tox species | M3(R2) §3, printed p.5 | "In vitro metabolic and plasma protein binding data for animals and humans and systemic exposure data (ICH S3A, Ref. 7) in the species used for repeated-dose toxicity studies generally should be evaluated before initiating human clinical trials." | verified-from-primary |
| In vivo ADME PK in test species | Before large numbers of subjects / long duration, generally **before Phase III** | M3(R2) §3, printed p.5 | "Further information on pharmacokinetics (PK) (e.g., absorption, distribution, metabolism and excretion), in test species and in vitro biochemical information relevant to potential drug interactions should be available before exposing large numbers of human subjects or treating for long duration (generally before Phase III)." | verified-from-primary |

> **Finding for the regulatory engine:** M3(R2) §3 does **not** list standalone in vivo PK (ADME) in test
> species as a pre-FIH item; it lists TK systemic exposure (S3A) plus in vitro metabolism and PPB, and
> places further in vivo PK "generally before Phase III". If `adme.in_vivo_pk` is currently modelled as a
> FIH-gating requirement, that timing is not supported by the M3(R2) §3 text and should be reviewed.

## 2. Gabrielsson & Weiner — editions (the build plan's "verify edition")

| Edition | Year | Publisher (as catalogued) | ISBN | Extent | Source | Confidence |
|---|---|---|---|---|---|---|
| [1st] (no edition statement in record) | 1994 | Stockholm: Swedish Pharmaceutical Press [Svensk farmaceutisk tidskrift]: Apotekarsocieteten | 91-86274-54-6 | ii, 654 s. | Libris 7756516 | verified-bibliographic |
| 2nd, rev. and expanded | 1997 | Stockholm: Swedish Pharmaceutical Society (Apotekarsocieteten): Swedish Pharmaceutical Press | 91-86274-69-4 | 770 s. + 1 diskette | Libris 7756531; LoC LCCN 98204433 | verified-bibliographic |
| 3rd, rev. and expanded | 2000 | Stockholm: Swedish Pharmaceutical Society (Apotekarsocieteten) | 91-86274-92-9 | 924 s. | Libris 7756553 | verified-bibliographic |
| 4th, rev. and expanded ("4. ed., rev. and expanded") | **2006** | Stockholm: **Swedish Academy of Pharmaceutical Sciences** | 91-976510-0-1 / 978-91-976510-0-4 | xiv, 1254 s. + 1 CD-ROM | Libris 10438078 (title "Pharmacokinetic & pharmacodynamic data analysis: concepts and applications") | verified-bibliographic |
| **5th, revised and expanded** | **2016** | Stockholm: **Apotekarsocieteten** (Swedish Pharmaceutical Society); printed by Printografen AB | **978-91-982991-0-6** (= 9789198299106) | xvi, 1040 pages + USB flash drive | LoC record 19198530 ("5th edition, revised and expanded."); Libris 19192234; publisher front matter p.IV | verified-from-primary (publisher front matter) |

| Parameter | Value | Source | Verbatim quote | Confidence |
|---|---|---|---|---|
| 5th-ed. imprint | Title, edition, authors, copyright, ISBN | Publisher PDF, p.IV | "Pharmacokinetic and Pharmacodynamic Data Analysis: Concepts and Applications, 5th edition, revised and expanded by Johan Gabrielsson and Dan Weiner" / "ISBN: 978-91-982991-0-6" | verified-from-primary |
| 5th-ed. NCA section | §2.8 Non-Compartmental Analysis, pp.141–157: 2.8.2 linear trapezoidal rule (p.142); 2.8.3 log-linear trapezoidal rule (p.144); 2.8.4 strategies for estimation of λz (p.146); 2.8.5 pertinent PK estimates (p.148); 2.8.6 steady state (p.152) | Publisher TOC, p.X | TOC entries "2.8 Non-Compartmental Analysis ... 141" and "2.8.4 Strategies for estimation of lz ... 146" | verified-from-primary (TOC only) |
| Edition-chronology conflict | The 5th-ed. Foreword dates earlier editions 1994, 1997, 2000 and **2010**; Libris catalogues the 4th edition as **2006** | Publisher PDF Foreword p.V vs Libris 10438078 | Foreword: "The current book is an evolution of the original text, which appeared in 1994, 1997, 2000 and 2010." | verified-from-primary (both read; conflict unresolved — prefer the catalogue record for the 4th ed. and cite the 5th ed. 2016) |
| Current copyright holder / access | Certara states it is now sole copyright owner and offers access with a Certara account | Certara help article 8043744 (`https://help.certara.net/en/articles/8043744-book-pk-pd-data-analysis-concepts-and-applications`) | Paraphrased (read via WebFetch). | secondary-reproduction |
| Misattributed edition label | Some retailer listings (Routledge, Open Library/Amazon import) label ISBN 9789198299106 "Second Edition" — contradicted by LoC, Libris and the publisher | Open Library edition OL28014643M | — | noted |
| **Book content (equations, worked examples)** | — | — | — | **NOT VERIFIED** — no copy of the text was accessible (Internet Archive copy of the 3rd ed. is lending-restricted; search-inside returned "Item not available"). |

**Recommendation:** cite *Gabrielsson J, Weiner D. Pharmacokinetic and Pharmacodynamic Data Analysis:
Concepts and Applications. 5th ed., revised and expanded. Stockholm: Apotekarsocieteten; 2016.
ISBN 978-91-982991-0-6, §2.8* — but **only as a bibliographic pointer** until someone with the book
transcribes the §2.8 equations. Every equation below is backed by a source actually read.

## 3. NCA definitions and equations — sources actually read

### 3.1 Regulatory statements (verified-from-primary)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Cmax | Observed directly, no interpolation | FDA 2022 BA guidance §III.A.9.a, p.9 | "The sponsor should determine the peak exposure of the drug by measuring the Cmax obtained directly from the systemic drug concentration data without interpolation." | verified-from-primary |
| AUC0-t | To t = last time point with measurable concentration | FDA 2022 §III.A.9.b, p.9 | "The area under the concentration-time curve from time zero to time t (AUC0-t) from an appropriate biological matrix, where t is the last time point with a measurable concentration." | verified-from-primary |
| **AUC0-∞ = AUC0-t + Ct/λz** | Extrapolation from last measurable concentration | FDA 2022 §III.A.9.b, p.9 | "The area under the concentration time curve from time zero to time infinity (AUC0-INF) from an appropriate biological matrix, where AUC0-INF = AUC0-t + Ct/λz. Ct is the last measurable drug concentration, and λz is the terminal elimination rate constant calculated by an appropriate method." | verified-from-primary |
| λz by linear regression on ≥ 3 terminal points | ≥ 3 samples in terminal log-linear phase; regression | FDA 2022 Appendix A §B, p.26 | "The sponsor should collect three or more samples during the terminal log-linear phase to obtain an accurate estimate of λz from linear regression." | verified-from-primary |
| λz points (M13A) | ≥ 3 points in terminal log-linear phase | ICH M13A §2.1.8, p.8 | "To reduce these inaccuracies, it is recommended that three or more data points in the terminal log-linear phase of the concentration-time curve be used to estimate kel." | verified-from-primary |
| λz points (EMA) | 3–4 samples in terminal log-linear phase | EMA BE guideline §4.1.4 "Sampling times", p.9 | "At least three to four samples are needed during the terminal log-linear phase in order to reliably estimate the terminal rate constant (which is needed for a reliable estimate of AUC(0-∞))." | verified-from-primary |
| Sampling duration | ≥ 3 terminal half-lives | FDA 2022 Appendix A §B, p.26 | "This sampling should continue for at least three terminal elimination half-lives." | verified-from-primary |
| Extrapolated fraction (BE context) | AUC0-t should cover ≥ 80% of AUC0-∞ | ICH M13A §2.2.2.2, p.11 | "For single-dose studies, AUC(0-t) should cover at least 80% of AUC(0-inf). If the AUC(0-t)/AUC(0-inf) percentage is less than 80% in more than 20% of the observations, then the validity of the study may need to be discussed in the submission." | verified-from-primary |
| Residual area definition | (AUC0-∞ − AUC0-t)/AUC0-∞ | EMA BE guideline, Definitions, p.19 | "residual area Extrapolated area (AUC(0-∞) - AUC(0-t))/ AUC(0-∞);" | verified-from-primary |
| AUC method must be stated | e.g. linear trapezoidal, and number of λz points | ICH M13A §2.2.2.2, p.11 | "The non-compartmental methods used to derive the PK parameters from the raw data should be reported, e.g., linear trapezoidal method for AUC and the number of data points of the terminal log-linear phase used to estimate kel." | verified-from-primary |
| Actual sampling times | Use actual, not nominal, times | ICH M13A §2.2.2.2, p.11 | "Each PK parameter should be calculated using the actual time of sampling for each concentration data point." | verified-from-primary |
| NCA vs compartmental (BE) | Non-compartmental required in BE | EMA BE guideline §4.1.5, p.10 | "Non-compartmental methods should be used for determination of pharmacokinetic parameters in bioequivalence studies. The use of compartmental methods for the estimation of parameters is not acceptable." | verified-from-primary |
| Parameters to report (single dose) | AUC0-t, AUC0-INF, Cmax, Tmax, λz, t½, apparent clearance, volume of distribution | FDA 2022 Appendix A §F, p.27 | "PK parameters for single-dose studies: AUC0-t, AUC0-INF, truncated or partial AUC and tlag, if applicable, Cmax, Tmax, λz, t1/2, apparent clearance, and volume of distribution" | verified-from-primary |
| t½ / kel definitions | "apparent terminal elimination half-life"; "apparent terminal elimination rate constant" (no formula) | ICH M13A §5 Glossary, pp.20–21 | "t1/2: The apparent terminal elimination half-life" / "kel: The apparent terminal elimination rate constant" | verified-from-primary (definition; **no formula** in M13A) |

Context caveat: FDA 2022, EMA Rev. 1 and M13A are **clinical BA/BE** guidances. Their NCA definitions are
the most authoritative open statements available, but their numeric conventions (≥ 80% coverage, ≥ 3
terminal points, ≥ 3 half-lives) are not preclinical requirements; the driver should apply them only as
declared, cited parameters.

### 3.2 CDISC SDTM PK parameter terms (verified-from-primary, NCIt 26.09d)

| Term (PPTESTCD) | NCIt code | CDISC definition (verbatim) |
|---|---|---|
| CMAX | C70918 | "The maximum concentration occurring at Tmax." |
| TMAX | C70919 | "The time of maximum observed concentration sampled during a dosing interval." |
| AUCLST | C85565 | "The area under the curve (AUC) from the time of dosing to the last measurable concentration." |
| AUCIFO | C85761 | "The area under the curve (AUC) extrapolated to infinity, calculated using the observed value of the last non-zero concentration." |
| LAMZ | C85652 | "The first order rate constant associated with the terminal (log-linear) portion of the curve." |
| LAMZHL | C85818 | "Terminal half-life." |
| LAMZNPT | C85816 | "The number of time points used in computing Lambda z." |
| R2ADJ | C85553 | "The goodness of fit statistic for the terminal elimination phase, adjusted for the number of time points used in the estimation of Lambda z." |
| CLO | C85773 | "The total body clearance for intravascular administration, calculated using the AUCINF based on the observed value of the last non-zero concentration." |
| CLFO | C85772 | "The total body clearance for extravascular administration divided by the fraction of dose absorbed, calculated using the AUCINF based on the observed value of the last non-zero concentration." |
| VSSO | C85770 | "The volume of distribution at steady state based on the observed CLST for a substance administered by intravascular dosing." |
| FABS | C154838 | "The fraction of the treatment dose that reaches the systemic circulation; this is the ratio of the amount of drug in the system (area under the curve) after extravascular administration of a test formulation divided by the drug in the system (area under the curve) after IV administration." |

These fix **names and meanings** (and the SEND/SDTM PP-domain codes the driver should emit) but give no
formulas, except that CLO/CLFO are "calculated using the AUCINF".

### 3.3 Equations — open sources read (secondary-reproduction unless stated)

| Quantity | Equation | Source | Quote / evidence | Confidence |
|---|---|---|---|---|
| Linear trapezoid (segment) | AUC(t1→t2) = δt × (C1 + C2)/2, δt = t2 − t1 | Certara Phoenix 8.3 help, "Partial area calculation" (equation image ncacomprules00474 viewed) | equation image | secondary-reproduction |
| Log trapezoid (segment) | AUC(t1→t2) = δt × (C2 − C1)/ln(C2/C1) | same page (image ncacomprules00478 viewed) | Falls back to linear if C1 ≤ 0, C2 ≤ 0 or C1 = C2 (stated on the page) | secondary-reproduction |
| **Linear-up/log-down rule** | Linear trapezoid while concentrations rise (or are equal), log trapezoid while they fall | Certara Phoenix 8.3 help, "Options tab" | Fragment: "the logarithmic trapezoidal rule is used any time that the concentration data is decreasing" | secondary-reproduction |
| λz | Negative slope of linear regression of ln(C) on t over the selected terminal points | Certara "NCA parameter formulas"; "Lambda Z or Slope Estimation settings" | Fragment: "Estimated by linear regression of time vs. log concentration." | secondary-reproduction (FDA 2022 confirms "linear regression", §3.1) |
| Adjusted R² | 1 − (1 − R²)(n − 1)/(n − 2) | Certara "Lambda Z..." page (image ncacomprules00466 viewed) | equation image | secondary-reproduction |
| Automatic point selection (vendor "Best Fit") | Regress last 3, 4, 5 … points after Cmax; choose max adjusted R² (ties within 0.0001 → more points); ≥ 3 points; slope must be negative | Certara "Lambda Z or Slope Estimation settings" | Paraphrased; the page itself says the user must judge appropriateness | secondary-reproduction (**vendor convention, not a regulatory rule**) |
| **t½ = ln 2 / λz** | — | Certara "NCA parameter formulas" (HL_Lambda_z) | "Terminal half-life: = ln(2)/λz" (page text; λ is set in a symbol font) | secondary-reproduction; no regulatory text read gives the formula |
| AUCinf | AUClast + Clast/λz | FDA 2022 §III.A.9.b (regulatory, §3.1) and Certara (AUCINF_obs) | see §3.1 | **verified-from-primary** (FDA) |
| %AUC extrapolated | 100 × (AUCinf − AUClast)/AUCinf | Certara (AUC_%Extrap); EMA "residual area" (§3.1) | see §3.1 | verified-from-primary (EMA definition) |
| **CL = Dose/AUCinf** (IV); CL/F = Dose/AUCinf (extravascular) | — | Certara "NCA parameter formulas" ("= Dose/AUCINF"; footnote: extravascular values are CL/F, V/F); CDISC CLO/CLFO (§3.2); Benet 2012 commentary (author of the classical clearance work) | Benet 2012: "clearance could be simply calculated as the ratio of dose to the measured area under the curve" | secondary-reproduction (Certara); Benet 2012 read in PMC (primary author's retrospective) |
| Vz | Dose/(λz × AUCinf) | Certara "NCA parameter formulas" | equation in text | secondary-reproduction |
| AUMCinf | AUMClast + tlast·Clast/λz + Clast/λz² | Certara (image ncaparamformulas00500 viewed) | equation image | secondary-reproduction |
| MRTinf | AUMCinf/AUCinf (non-infusion); minus Tinf/2 for infusion | Certara "NCA parameter formulas" | equation in text | secondary-reproduction |
| **Vss = CL × MRTinf (IV only)** | Not computed for extravascular dosing because MRT then includes mean input time | Certara "NCA parameter formulas" (Vss_obs: "= (MRTINF)(CL)"; "Computed for IV Bolus and Infusion dosing only") | — | secondary-reproduction |
| CL–Vss–MRT relation (origin) | CL = Vss/MRT, for linear disposition with elimination from the sampled (central) compartment | Benet LZ. *AAPS J* 2012;14(2):164–167 (commentary on Benet & Galeazzi 1979) | Fragment: "the product of the inverse of MRT and the steady-state volume of distribution, Vss, yields clearance" | verified-from-primary (commentary by the originating author; the 1979 paper itself NOT read) |
| **F (absolute)** = (AUCpo × Dose_iv)/(AUCiv × Dose_po) | Dose-normalised AUC ratio | Shang et al. *J Pharm Anal* 2022 (PMC9091740, CC BY-NC-ND), Methods | "The oral absolute bioavailability (F %) of RA in rats was determined as (AUC oral (0–24) × Dose i.v.)/(AUC i.v. (0–24) × Dose oral) × 100%." | secondary-reproduction (note: that paper used AUC0–24, not AUCinf) |
| F (concept) | AUC ratio extravascular / IV | CDISC FABS (§3.2) | — | verified-from-primary (definition; **does not state dose normalisation**) |

### 3.4 Classical primary method papers — status

| Paper | What it is cited for | Status |
|---|---|---|
| Yeh KC, Kwan KC. *J Pharmacokinet Biopharm* 1978;6(1):79–98. DOI 10.1007/BF01066064 | Comparison of trapezoidal / log-trapezoidal / Lagrange / spline AUC algorithms | verified-bibliographic (Europe PMC: no abstract; OpenAlex closed). **Content NOT VERIFIED.** |
| Purves RD. *J Pharmacokinet Biopharm* 1992;20(3):211–226. DOI 10.1007/BF01062525 | AUC/AUMC integration methods | verified-from-primary (abstract): of 11 AUC methods tested on simulated data, Lagrange and spline methods were judged unacceptable and a log-trapezoidal-based scheme performed well. Full text NOT VERIFIED. |
| Yamaoka K, Nakagawa T, Uno T. *J Pharmacokinet Biopharm* 1978;6(6):547–558. DOI 10.1007/BF01062109 | Statistical moments (AUC, MRT) | verified-from-primary (abstract — concept only, no formulas in abstract). |
| Benet LZ, Galeazzi RL. *J Pharm Sci* 1979;68(8):1071–1074. DOI 10.1002/jps.2600680845 | Noncompartmental Vss | verified-bibliographic (no abstract; closed). Content via 2012 commentary only. |
| Gibaldi M, Perrier D. *Pharmacokinetics*. 2nd ed., rev. and expanded. New York: M. Dekker; 1982. (Drugs and the Pharmaceutical Sciences, v. 15). viii, 494 p. ISBN 0-8247-1042-8 | Textbook NCA equations | verified-bibliographic (LoC LCCN 82004608). Internet Archive copies are lending-restricted. **Content NOT VERIFIED.** |

## Implications for the driver (no scientific defaults)

- **AUC method is a required input** (linear, linear-up/log-down, …): M13A requires the method to be
  reported but does not mandate one. Linear-up/log-down is citable today only to vendor documentation.
- **AUCinf = AUClast + Clast/λz** and the residual-area definition are citable to FDA/EMA directly.
- **λz point selection is a human determination** (build plan already says so). Regulators require only
  ≥ 3 terminal log-linear points; the vendor "best adjusted R²" search may be offered as a *suggestion*,
  labelled as a vendor convention. Minimum R²adj and maximum %AUCextrap are **not** regulatory for
  preclinical PK — if used, they are declared inputs with stated basis (M13A's 80% is a BE criterion).
- Use Clast observed (AUCIFO) vs predicted (AUCIFP) as an explicit choice; CDISC has codes for both.
- Vss only for IV; extravascular clearance/volume must be labelled CL/F and Vz/F.
- F requires both routes; dose normalisation assumes dose-linear PK over the two doses — flag when the
  IV and PO doses differ and dose proportionality has not been shown (cross-reference A2).
- Units: all equations are unit-consistent only if dose and concentration units are converted explicitly;
  the driver must carry units (CLAUDE.md §1).

## Items NOT VERIFIED

1. Gabrielsson & Weiner text (any edition) — equations and worked examples in §2.8; only the 5th-ed.
   front matter and TOC were read.
2. Gibaldi & Perrier 1982 text.
3. Yeh & Kwan 1978 and Benet & Galeazzi 1979 full texts (the original sources of the log-trapezoid and the
   noncompartmental Vss).
4. A regulatory (FDA/EMA/ICH) statement of t½ = ln2/λz, CL = Dose/AUC, Vss = CL·MRT, MRT = AUMC/AUC,
   AUMC extrapolation, or the dose-normalised F formula — none found in the guidances read; these rest on
   vendor documentation and open-access papers (secondary).
5. Edition chronology conflict for the 4th edition (catalogue 2006 vs 5th-ed. foreword "2010").

## Citations to register

1. ICH. *M3(R2): Guidance on Nonclinical Safety Studies for the Conduct of Human Clinical Trials and Marketing Authorization for Pharmaceuticals.* Step 4, 11 June 2009. Section 3. https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf
2. U.S. FDA, CDER. *Bioavailability Studies Submitted in NDAs or INDs — General Considerations. Guidance for Industry.* April 2022 (final). Sections III.A.9.a–b; Appendix A §§B, F. https://www.fda.gov/media/121311/download
3. EMA, CHMP. *Guideline on the Investigation of Bioequivalence.* CPMP/EWP/QWP/1401/98 Rev. 1/Corr **, 20 January 2010. Sections 4.1.4, 4.1.5; Definitions. https://www.ema.europa.eu/en/documents/scientific-guideline/guideline-investigation-bioequivalence-rev1_en.pdf
4. ICH. *M13A: Bioequivalence for Immediate-Release Solid Oral Dosage Forms.* Final, adopted 23 July 2024. Sections 2.1.8, 2.2.2.2, 5. https://database.ich.org/sites/default/files/ICH_M13A_Step4_Final_Guideline_2024_0723.pdf
5. Gabrielsson J, Weiner D. *Pharmacokinetic and Pharmacodynamic Data Analysis: Concepts and Applications.* 5th ed., revised and expanded. Stockholm: Apotekarsocieteten; 2016. ISBN 978-91-982991-0-6. Section 2.8 (pp. 141–157). Publisher front matter: https://www.apotekarsocieteten.se/app/uploads/2024/01/PKPD_ed5_TOC.pdf; LoC record 19198530; Libris 19192234. *(bibliographic only — content not read)*
6. CDISC SDTM PK Parameters controlled terminology via NCI Thesaurus 26.09d (2026-09-28): C70918, C70919, C85565, C85761, C85652, C85818, C85816, C85553, C85773, C85772, C85770, C154838. https://evsexplore.semantics.cancer.gov/evsexplore/concept/ncit/C85761 (and corresponding codes)
7. Certara USA, Inc. *Phoenix 8.3 User Documentation — NCA parameter formulas; Partial area calculation; Options tab; Lambda Z or Slope Estimation settings.* © 2020. https://onlinehelp.certara.com/phoenix/8.3/topics/NCA_parameter_formulas.htm *(vendor documentation — secondary)*
8. Benet LZ. Benet LZ and Galeazzi RL: noncompartmental determination of the steady-state volume of distribution, J Pharm Sci 68, 1071–1074, 1979 — the backstory. *AAPS J.* 2012;14(2):164–167. DOI: 10.1208/s12248-012-9326-9. PMC3326156.
9. Shang H, Dai X, Li M, Kai Y, Liu Z, Wang M, Li Q, Gu Y, Liu C, Si D. Absolute bioavailability, dose proportionality, and tissue distribution of rotundic acid in rats based on validated LC-QqQ-MS/MS method. *J Pharm Anal.* 2022;12(2):278–286. DOI: 10.1016/j.jpha.2021.03.008. PMC9091740. *(secondary — F formula)*
10. Purves RD. Optimum numerical integration methods for estimation of area-under-the-curve (AUC) and area-under-the-moment-curve (AUMC). *J Pharmacokinet Biopharm.* 1992;20(3):211–226. DOI: 10.1007/BF01062525. PMID 1522479. *(abstract only)*
11. Yamaoka K, Nakagawa T, Uno T. Statistical moments in pharmacokinetics. *J Pharmacokinet Biopharm.* 1978;6(6):547–558. DOI: 10.1007/BF01062109. PMID 731417. *(abstract only)*
