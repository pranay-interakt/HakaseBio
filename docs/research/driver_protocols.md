# Driver protocol research — citable design parameters

Compiled 2026-10-11. Scope: (A) liver microsomal metabolic stability, (B) hERG patch clamp,
(C) repeat-dose toxicity group design.

Confidence labels used throughout:
- **verified-from-primary** — I read the exact wording in the primary document/record (PDF of the
  guideline, publisher/PubMed/Crossref record, or open-access full text) during this session.
- **secondary-reproduction** — value taken from a source that is not the originating document for
  that parameter (e.g. another lab's published method, a review, an illustrative example).
- **not-found** — could not be verified; the source is paywalled or inaccessible. **No value has
  been filled in from general knowledge.** Where a number is widely used but I could not trace it
  to a citable source, it is labelled *industry convention — no citable primary source found*.

Local copies of the primary PDFs used are in `../research/proto_dl/`, extracted text in
`../research/proto_txt/`.

---

## A. Liver microsomal metabolic stability (substrate depletion → CLint → IVIVE)

### A.1 Obach 1999 — identity and DOI

| Item | Detail |
|---|---|
| Value | Obach RS. "Prediction of Human Clearance of Twenty-Nine Drugs from Hepatic Microsomal Intrinsic Clearance Data: An Examination of In Vitro Half-Life Approach and Nonspecific Binding to Microsomes." *Drug Metab Dispos.* 1999;27(11):1350–1359. |
| Source | DOI **10.1016/S0090-9556(24)14938-0** (Crossref record: volume 27, pages 1350-1359, issued 1999-11); PMID **10534321** (PubMed record, retrieved via NCBI E-utilities). |
| Quote | PubMed record: "Drug Metab Dispos. 1999 Nov;27(11):1350-9." |
| Confidence | verified-from-primary (bibliographic record) |

> **Correction to the brief:** the paper is **twenty-nine** drugs, not twenty-five. Any test fixture
> or docstring in the codebase should say 29.

### A.2 Obach 1999 — incubation conditions, half-life equation, scaling factors

| Item | Detail |
|---|---|
| Value | **NOT OBTAINED.** Substrate concentration, microsomal protein concentration, NADPH vs regenerating system, buffer/pH, temperature, timepoints, termination, analytical method, the t½ → CLint equation and the scaling factors used in this paper could not be read. |
| Source | Full text is closed access: `https://dmd.aspetjournals.org/content/27/11/1350.full.pdf` returns HTTP 403 (Cloudflare); ScienceDirect mirror `S0090955624149380` returns 403; OpenAlex (`oa_status: closed`) and Semantic Scholar (`openAccessPdf: CLOSED`) confirm no open copy. |
| Quote | OpenAlex record: `{'is_oa': False, 'oa_status': 'closed', 'oa_url': None}` |
| Confidence | not-found |

**Implication for the driver:** do not encode "Obach 1999 conditions" as a cited constant until
someone with journal access transcribes the Methods section. The parameters below (A.6–A.9) are
what *is* citable today.

### A.3 Obach 1999 — facts that are verifiable from the abstract

| Item | Detail |
|---|---|
| Value | 29 drugs; scaled CLint range < 0.5 to 189 mL/min/kg; fu,mic range 0.11–1.0; best clearance prediction when both blood and microsomal binding are included. |
| Source | Obach 1999, abstract (PubMed PMID 10534321, retrieved via NCBI E-utilities efetch). |
| Quote | "The compounds examined demonstrated a wide range of microsomal metabolic labilities with scaled intrinsic clearance values ranging from less than 0.5 ml/min/kg to 189 ml/min/kg." |
| Confidence | verified-from-primary (abstract only) |

### A.4 Obach 1999 — per-compound table of human liver microsomal t½ / CLint

| Item | Detail |
|---|---|
| Value | **NOT OBTAINED** — the per-drug table is behind the same paywall as A.2. No individual compound values (e.g. for a known-value unit test) could be quoted. |
| Source | as A.2 |
| Quote | — |
| Confidence | not-found |

*Alternative known-value anchors that are citable today are given in A.9 and A.10.*

### A.5 Companion Obach papers (relevant to binding and scaling)

| Item | Detail |
|---|---|
| Value | Obach RS. "Nonspecific binding to microsomes: impact on scale-up of in vitro intrinsic clearance to hepatic clearance…" *Drug Metab Dispos.* 1997;25(12):1359–1369. PMID 9394025. At 1.0 mg/mL microsomal protein and 10 µM warfarin, fu,mic = 0.85; propranolol 0.41; imipramine 0.16. |
| Source | PubMed abstract (PMID 9394025), retrieved via E-utilities. |
| Quote | "At a microsomal protein concentration of 1.0 mg/ml and a warfarin concentration of 10 microM, the free fraction (fu(mic)) was 0.85." |
| Confidence | verified-from-primary (abstract) |

| Item | Detail |
|---|---|
| Value | Obach RS, Baxter JG, Liston TE, et al. "The prediction of human pharmacokinetic parameters from preclinical and in vitro metabolism data." *J Pharmacol Exp Ther.* 1997;283(1):46–58. PMID 9336307. This is the paper later authors cite for the in vitro t½ → CLint equations. |
| Source | PubMed abstract (PMID 9336307); the equation attribution is from Shah et al. 2016 (see A.6). |
| Quote | Shah et al. 2016 (DMD 44:1653): half-life and CLint "Eqs. 1 and 2, citing Obach et al., 1997". |
| Confidence | verified-from-primary (citation chain); the equations themselves were rendered as images in the PMC copy and could not be transcribed. |

### A.6 Substrate-depletion half-life → CLint equation

| Item | Detail |
|---|---|
| Value | CLint (µL/min/mg protein) = ln(2) / (t½ × [microsomal protein]) — i.e. 0.693/t½ normalised to the protein concentration in the incubation. |
| Source | Volynets GP et al. *Future Microbiol.* 2020;15(10):869–879, DOI 10.2217/fmb-2019-0085, PMCID PMC8097507 — Table 7 footnote (assay performed by a commercial provider). |
| Quote | "Microsomal intrinsic clearance = ln(2)/(T1/2[microsomal protein])" |
| Confidence | secondary-reproduction (this is a user of the method, not its originating publication; the originating citation is Obach et al. 1997 / Obach 1999, neither of which I could open). |

### A.7 IVIVE scaling factor — microsomal protein per gram of liver (MPPGL)

| Item | Detail |
|---|---|
| Value | Human MPPGL weighted geometric mean **32 mg/g liver (95% CI 29–34)**; age-dependent: ~40 mg/g at 30 y, ~31 mg/g at 60 y. Hepatocellularity 99 × 10⁶ cells/g (95% CI 74–131). |
| Source | Barter ZE, Bayliss MK, Beaune PH, et al. "Scaling factors for the extrapolation of in vivo metabolic drug clearance from in vitro data: reaching a consensus on values of human microsomal protein and hepatocellularity per gram of liver." *Curr Drug Metab.* 2007;8(1):33–45. DOI 10.2174/138920007779315053, PMID 17266522 (abstract). |
| Quote | "We have collated and analysed data from a number of sources, to provide weighted meangeo values of human MPPGL and HPGL of 32 mg g-1 (95% Confidence Interval (CI); 29-34 mg.g-1) and 99x10(6) cells.g-1…" |
| Confidence | verified-from-primary (abstract) |

| Item | Detail |
|---|---|
| Value | The commonly quoted **45 mg microsomal protein/g liver** and **~20–26 g liver/kg body weight** scaling factors. |
| Source | **No citable source verified in this session.** PMC full-text search for the phrase "45 mg microsomal protein per gram liver" returned 0 hits; the Obach papers that are usually cited for it are paywalled (A.2, A.5). |
| Quote | — |
| Confidence | not-found — *treat as industry convention until a primary citation is transcribed; do not hard-code.* |

### A.8 Di & Kerns — "typical" conditions (1 µM substrate, 0.5 mg/mL protein, 1 mM NADPH, 37 °C)

| Item | Detail |
|---|---|
| Value | Book exists and is citable: Kerns EH, Di L. *Drug-Like Properties: Concepts, Structure Design and Methods from ADME to Toxicity Optimization*, 2nd ed., Academic Press/Elsevier, 2016. **Its statement of the typical conditions could not be read in this session** (no accessible copy). |
| Source | — |
| Quote | — |
| Confidence | not-found (for the parameter values; the book citation itself is standard but the specific page/chapter wording is unverified) |

| Item | Detail |
|---|---|
| Value | Primary candidate paper for the optimised higher-throughput conditions: Di L, Kerns EH, Hong Y, Kleintop TA, McConnell OJ, Huryn DM. "Optimization of a higher throughput microsomal stability screening assay for profiling drug discovery candidates." *J Biomol Screen.* 2003;8(4):453–462. DOI **10.1177/1087057103255988**, PMID 14567798. |
| Source | Crossref + PubMed records (verified). The abstract does **not** state substrate or protein concentration, NADPH concentration, buffer or temperature; the Methods are paywalled (SAGE). |
| Quote | Abstract: "The authors describe optimization of a simple, robust, high-throughput microsomal stability assay developed in a 96-well format." |
| Confidence | citation verified-from-primary; **conditions not-found** |

### A.9 A fully citable, published set of HLM substrate-depletion conditions

Use this if the driver needs a protocol it can cite *today* (it is one laboratory's published
protocol, not a consensus standard — label it as such in the UI):

| Parameter | Value |
|---|---|
| Substrate concentration | 1 µM |
| Microsomal protein | 0.3 mg/mL (pooled human liver microsomes) |
| Cofactor | 2 mM NADPH + 3 mM MgCl₂ |
| Buffer / pH | 100 mM potassium phosphate, pH 7.4 |
| Temperature | 37 °C, duplicate incubations |
| Timepoints | 0, 5, 15, 30, 45 min |
| Termination | ice-cold methanol containing propranolol as internal standard |
| Negative control | parallel incubation in buffer **without NADPH** |

| Item | Detail |
|---|---|
| Source | Volynets GP, Tukalo MA, Bdzhola VG, et al. "Novel isoniazid derivative as promising antituberculosis agent." *Future Microbiol.* 2020;15(10):869–879. DOI 10.2217/fmb-2019-0085, PMCID PMC8097507 — Methods, "In vitro microsomal stability assay", and Table 7. |
| Quote | Methods: "0.3 mg/ml human microsomal protein", "2 mM NADPH", "100 mM potassium phosphate, pH 7.4", 37 °C, sampled at "0, 5, 15, 30, and 45 min". |
| Confidence | verified-from-primary for *this paper*; secondary-reproduction as a statement of "standard" conditions. |

### A.10 Positive / reference controls and published reference values

| Item | Detail |
|---|---|
| Value | Human liver microsomes, 1 µM substrate, NADPH-dependent: **verapamil CLint 135 µL/min/mg, t½ 17.1 min**; **dextromethorphan CLint 24.2 µL/min/mg, t½ 95.3 min**. NADPH-free controls for both: CLint < 12.8 µL/min/mg, t½ > 180 min. |
| Source | Volynets et al. 2020 (as A.9), Table 7 ("Microsomal stability for compound 1"), control rows. |
| Quote | Table 7: "Verapamil 135 / 17.1 / <12.8 / >180"; "Dextromethorphan 24.2 / 95.3 / <12.8 / >180". |
| Confidence | secondary-reproduction (values are condition-specific). A near-identical control table (verapamil ~123 µL/min/mg, t½ ~18.7 min; dextromethorphan ~24.3 µL/min/mg, t½ ~94.9 min) appears in another paper using the same assay provider (PMC7421780), suggesting a ~10% run-to-run spread — **that second table was seen only in a search-result snippet and is itself unverified.** |

| Item | Detail |
|---|---|
| Value | Control compound half-lives in an automated metabolic-stability assay (human **CYP3A4 supersomes**, 1 µM substrate, 100 mM KPi pH 7.4, 37 °C, NADPH-regenerating system, samples at 5/10/15/30/60 min, quenched into chilled acetonitrile + internal standard): buspirone 2.5 ± 0.45 min; loperamide 3.5 ± 0.59 min; ketoconazole 21 ± 3.6 min; antipyrine and carbamazepine > 30 min. |
| Source | Shah P, Kerns E, Nguyen DT, Obach RS, Wang AQ, Zakharov A, McKew J, Simeonov A, Hop CECA, Xu X. *Drug Metab Dispos.* 2016;44(10):1653–1661. DOI 10.1124/dmd.116.072017, PMCID PMC5034701 — Methods and Table 1. |
| Quote | Methods: "The final concentration of the test compound was 1 μM"; "Supersomes and NADPH solution A/B were diluted in 100 mM potassium phosphate buffer (pH 7.4)." |
| Confidence | verified-from-primary (open-access full text) — **but note this is a recombinant CYP3A4 system, not liver microsomes.** |

| Item | Detail |
|---|---|
| Value | Standard HLM/RLM positive controls named in the brief (verapamil, testosterone, dextromethorphan, midazolam) **as a defined control panel with published reference CLint ranges**. |
| Source | **No primary or consensus source found.** Searches surfaced only vendor/CRO material and individual papers' method sections; verapamil + dextromethorphan appear repeatedly (A.10 above), testosterone and midazolam appear as CYP3A marker substrates in CYP-phenotyping contexts, not as stability QC compounds with published ranges. |
| Quote | — |
| Confidence | not-found — *industry convention; no citable primary source. Reference ranges must come from the performing laboratory's own historical control data.* |

### A.11 Acceptance criteria (positive control within historical range; minus-NADPH control)

| Item | Detail |
|---|---|
| Value | No regulatory guideline or consensus publication was found that states numeric acceptance criteria for a microsomal stability run. |
| Source | Searched: FDA guidance set, OECD, ICH, peer-reviewed method papers. What *is* citable: (i) minus-NADPH (cofactor-free) parallel controls are standard in published methods — Volynets et al. 2020 (A.9); (ii) OECD TG 408 ¶52 establishes the general principle of comparison to laboratory historical control data (for in vivo studies, see C.2). |
| Quote | OECD TG 408 (2018) ¶52: "For quality control it is proposed that control data are compared to historical control values originating from the same laboratory, species, strain, and collected under similar conditions." |
| Confidence | not-found for assay-specific numeric criteria — *industry convention; encode as laboratory-defined with the historical range as an input, never as a hard-coded threshold.* |

---

## B. hERG — ICH S7B and ICH E14/S7B Q&As (Step 4, 21 Feb 2022)

Primary documents used (downloaded, text-extracted):
- ICH S7B Guideline (adopted May 2005) — `https://database.ich.org/sites/default/files/S7B_Guideline.pdf`
- ICH E14/S7B Implementation Working Group Questions and Answers, **adopted 21 February 2022** —
  `https://database.ich.org/sites/default/files/E14-S7B_QAs_Step4_2022_0221.pdf`
- ICH E14/S7B Q&As Training Material + "Training Material Examples Supplemental File" (hosted by
  PMDA: `https://www.pmda.go.jp/files/000246889.pdf`, `https://www.pmda.go.jp/files/000246890.pdf`)

### B.1 ICH S7B — the in vitro IKr assay (Section 2.3.1)

| Item | Detail |
|---|---|
| Value | S7B defines the in vitro IKr assay as an evaluation of ionic current through native or expressed IKr channel protein (e.g. hERG). |
| Source | ICH S7B, Section **2.3.1 "In Vitro IKr Assay"** (p. 4 of the guideline PDF). |
| Quote | "An in vitro IKr assay evaluates the effects on the ionic current through a native or expressed IKr channel protein, such as that encoded by hERG (see section 3.1.2)." |
| Confidence | verified-from-primary |

*Note:* the brief asked for "S7B section 3.1". In the guideline, **3.1 is "Considerations for Test
Systems"**, with 3.1.1 positive controls, 3.1.2 in vitro electrophysiology, 3.1.3 in vivo, 3.1.4
simulated pathological conditions. The in vitro IKr assay itself is described in **2.3.1**.

### B.2 ICH S7B §3.1.1 — positive controls in every in vitro study

| Item | Detail |
|---|---|
| Value | A sub-maximally effective concentration of a positive control must be included in **every** in vitro study; for in vivo studies the positive control validates the system but need not be in every study. |
| Source | ICH S7B, Section **3.1.1 "Use of Positive Control Substances and Reference Compounds"**. |
| Quote | "A sub-maximally effective concentration of a positive control substance should be used to demonstrate the responsiveness of in vitro preparations for ion channel and action potential duration assays and should be included in every study." |
| Confidence | verified-from-primary |

### B.3 ICH E14/S7B Q&A 2.1 — "best practice" for ion-channel patch clamp assays

Q&A 2.1 ("What are some 'best practice' considerations when evaluating drug potency on affecting
cardiac ionic currents using patch clamp method and overexpression cell lines?") lists seven
numbered items. Verbatim extracts (all **verified-from-primary**, E14/S7B Q&As pp. 31–35):

| # | Parameter | Verbatim quote (≤2 sentences) |
|---|---|---|
| 1 | **Recording temperature 35–37 °C** | "Thus, patch clamp experiments on cells overexpressing cardiac ion channels, including hERG, CaV1.2, and NaV1.5, should be performed at near physiological temperature (35–37 °C)." |
| 2 | **Stimulation frequency** | "For hERG, a stimulation frequency of 0.2 – 1 Hz is recommended. For CaV1.2 and NaV1.5 currents, a stimulation frequency of 0.2 Hz is recommended." |
| 2 | **Voltage protocol shape / cell-health monitoring** | "The voltage protocols used to evoke ionic currents should approximate the appropriate elements of a ventricular action potential and be repeated at frequencies that are sufficient to minimize the possibility of missing the effects of a test drug at physiologically relevant heart rates." |
| 2 | **Selective blocker at end of experiment** | "After application of the test drug and if recording quality remains acceptable, a saturating concentration of a selective blocker should be applied to cells to determine residual background current in individual cells." |
| 3 | **Seal / series resistance** | "Seal resistance should be high enough so that the leak conductance at all voltages specified by the voltage protocol and series resistance do not compromise voltage control." |
| 3 | **Baseline stability and steady state** | "The time course of drug effects should be monitored until steady state effect is obtained, and each cell can be exposed to one or more drug concentrations as long as cell health and recording quality remain stable." |
| 4 | **Primary endpoints** | "The primary derived endpoints are inhibitory concentration such as the IC50 value (reported in both micromolar and ng/mL units) and Hill coefficient." |
| 5 | **Data summary** | "Inhibition at each drug concentration for each cell should be provided, along with the mean values of IC50 and Hill coefficient (and appropriate measures of data variability)." |
| 6 | **Concentration verification** | "The concentration of test compound to which the cells were exposed should be verified by applying a validated analytical method to the solution collected from the cell chamber. Both nominal and measured concentrations should be reported." |
| 7 | **Positive control design** | "The positive control drug should be tested using sufficient replicates and two or more concentrations achieving 20-80% block, to demonstrate consistency and reproducibility with the reference drug data." |
| 7 | **Failure criterion** | "If positive control data fall outside the range of expected values, then the study is inconclusive, and it would not be recommended that the data be used to support the purposes outlined in ICH E14 Q&As 5.1 and 6.1." |
| 7 | **Vehicle control** | "Vehicle (negative) controls should be included in the experiments." |

**Number of cells per concentration:** the Q&A does **not** specify a minimum n. It requires
"sufficient replicates" for the positive control (item 7) and per-cell reporting (item 5).
Confidence: verified-from-primary (absence confirmed by reading the full Q&A 2.1 text).

### B.4 ICH E14/S7B Q&A 1.2 — how the hERG safety margin is computed

| Item | Detail |
|---|---|
| Value | Margin = hERG IC50 normalised to free (unbound) clinical exposure; fu floored at 1%; denominator for E14 Q&A 5.1/6.1 decisions = **high clinical exposure** (mean Cmax,ss under the worst intrinsic/extrinsic factor). |
| Source | ICH E14/S7B Q&As, **S7B Q&A 1.2** (pp. 29–31). |
| Quote | "Because of uncertainties in the protein binding measurements, the unbound (free) fraction in plasma should be set to 1% if experimentally determined to be < 1%." |
| Quote 2 | "…it is generally recommended to use the high clinical exposure as defined in ICH E14 Q&A 5.1 (i.e., mean steady state maximum concentration [Cmax,ss] when the maximum therapeutic dose is administered in the presence of the intrinsic or extrinsic factor that has the largest effect on increasing Cmax,ss)." |
| Confidence | verified-from-primary |

| Item | Detail |
|---|---|
| Value | There is **no fixed numeric "low risk" margin** in the Q&A. The threshold must be derived from reference drugs run under the *same* protocol, with uncertainty quantified. |
| Source | ICH E14/S7B Q&As, S7B Q&A 1.2. |
| Quote | "To assess whether the hERG block poses a risk of delaying ventricular repolarization or TdP, the resulting safety margin should be compared to the range of safety margins computed under the same experimental protocol for a series of reference drugs that have known clinical TdP risk and cover diverse electrophysiological properties." |
| Quote 2 | "Appropriate statistical methods should be applied to quantify experimental IC50 variability and calculate uncertainty of the safety margin as confidence/credible intervals." |
| Confidence | verified-from-primary |

| Item | Detail |
|---|---|
| Value | Low-TdP-risk definition (two conditions). |
| Source | ICH E14/S7B Q&As, **S7B Q&A 1.1** (p. 28). |
| Quote | "A drug with low TdP risk would be expected to have (1) a hERG safety margin higher than a threshold defined based on the safety margins computed under the same experimental protocol for a series of drugs known to cause TdP…; and (2) no QTc prolongation in an in vivo assay of sufficient sensitivity…" |
| Confidence | verified-from-primary |

| Item | Detail |
|---|---|
| Value | E14 exposure definitions used as the margin denominator. |
| Source | ICH E14/S7B Q&As, **E14 Q&A 5.1**, "Dose and exposure definitions" (p. 16). |
| Quote | "Clinical exposure: mean steady state maximum concentration (Cmax,ss) associated with the maximum therapeutic dose." |
| Confidence | verified-from-primary |

### B.5 Worked threshold example from the ICH training material (illustrative only)

| Reference drug | Protocol | Critical conc. (ng/mL) | Protein binding % | MW | IC50 distribution (µM) | Safety margin |
|---|---|---|---|---|---|---|
| Moxifloxacin | Protocol-001 | 1866 (1591, 2188) | 40 (37, 43) | 401 | 62 (38, 104); N = 10 | 23x (13, 39) |
| Ondansetron | Protocol-001 | 249 (152, 412) | 73 (71, 76) | 293 | 1.4 (0.8, 2.6); N = 4 | 10x (4, 27) |
| Dofetilide | Protocol-001 | 0.37 (0.24, 0.55) | 64 (62, 66) | 442 | 0.01 (<0.01, 0.02); N = 4 | 44x (16, 117) |
| **Pooled** | | | | | | **22x (9, 51)** |
| **Threshold** | | | | | | **>51x** |

| Item | Detail |
|---|---|
| Source | "ICH E14/S7B Q&As Training Material Examples Supplemental File", Example 1, Table 1-B/1-C (copy hosted by PMDA: `https://www.pmda.go.jp/files/000246890.pdf`; companion deck `https://www.pmda.go.jp/files/000246889.pdf`). |
| Quote | "This example shows a data package for a hypothetical drug… The data shown are for illustration purposes only." |
| Quote 2 | Footnote: "A random effects meta-analysis was used to derive the pooled safety margin across trials and drugs". |
| Confidence | verified-from-primary (the document is primary ICH training material) — **but the numbers are explicitly illustrative; they are not an ICH-endorsed threshold.** The three reference drugs (moxifloxacin, ondansetron, dofetilide) and the "pool reference margins → upper bound = threshold" method are the transferable parts. |

Conditions for reusing a pre-established threshold (same document, Table 1-C):
"Investigational drug and reference drugs are evaluated under the same experimental protocol";
"Concurrent positive control is 1 of the reference drugs used to derive the threshold". — verified-from-primary.

### B.6 Published reference hERG IC50 values

**(a) Manual patch clamp at near-physiological temperature, action-potential waveform**

| Drug | hERG IC50 (µM), Crumb 2016 | (Kramer 2013, same table) |
|---|---|---|
| Dofetilide | 0.002 | 0.03 |
| Cisapride | 0.01 | 0.02 |
| Sertindole | 0.01 | 0.03 |
| Terfenadine | 0.02 | 0.05 |
| Nilotinib | 0.1 | 1.0 |
| Bepridil | 0.2 | 0.2 |
| Quinidine | 0.3 | 0.7 |
| Mibefradil | 0.3 | 1.7 |
| Verapamil | 0.7 | 0.3 |
| Flecainide | 0.7 | 1.5 |
| Amiodarone | 0.9 | 0.9 |
| Chlorpromazine | 1.1 | 1.5 |
| Saquinavir | 3.4 | 16.9 |
| Diltiazem | 6.6 | 53.2 |
| Sotalol | 86.3 | 111.4 |
| Moxifloxacin | 92.7 | 86.2 |

| Item | Detail |
|---|---|
| Source | Crumb WJ Jr, Vicente J, Johannesen L, Strauss DG. "An evaluation of 30 clinical drugs against the comprehensive in vitro proarrhythmia assay (CiPA) proposed ion channel panel." *J Pharmacol Toxicol Methods.* 2016;81:251–262. DOI **10.1016/j.vascn.2016.03.009** (Crossref verified). Table 2 "Comparison of IC50 values"; Methods §2.1–2.3. |
| Conditions quoted | "Experiments (n = 3–6) were performed at 36 ± 1 °C with the exception of Kv4.3 which was performed at 22 ± 1 °C."; "A ventricular action potential waveform was used to elicit hERG, Cav1.2, and KvLQT1/mink". External solution (mM): NaCl 137, KCl 4, MgCl₂ 1, CaCl₂ 1.8, HEPES 10, dextrose 11, pH 7.4; internal (mM): KCl 130, MgCl₂ 1, NaCl 7, HEPES 5, EGTA 5, pH 7.2; voltage protocol applied every 10 s (0.1 Hz), some drugs also at 1 Hz; series resistance compensated 60–80%; cells with >20% rundown discarded. |
| Confidence | verified-from-primary (author-proof PDF hosted by the CiPA project, cipaproject.org) |

> Caveat for the driver: Crumb's standard pulse interval (0.1 Hz) is **below** the ICH Q&A 2.1
> recommendation of 0.2–1 Hz for hERG; these IC50s are a reference dataset, not a best-practice-compliant run.

**(b) Multi-site automated patch clamp, CiPA step-ramp protocol (room temperature)**

| Drug | hERG IC50, Bayesian hierarchical estimate (nM, 95% CrI) |
|---|---|
| Dofetilide | 75 (50–117) |
| Ibutilide | 11 (6.5–17) |
| Quinidine | 971 (791–1200) |
| Vandetanib | 394 (330–472) |
| Bepridil | 144 (120–172) |
| Cisapride | 56 (44–72) |
| Terfenadine | 129 (103–159) |
| Ondansetron | 1200 (930–1600) |
| Verapamil | 452 (343–599) |
| Sotalol | 290000 (210000–400000) |

| Item | Detail |
|---|---|
| Source | Ridder BJ, Leishman DJ, Bridgland-Taylor M, …, Li Z. "A systematic strategy for estimating hERG block potency and its implications in a new cardiac safety paradigm." *Toxicol Appl Pharmacol.* 2020;394:114961. DOI **10.1016/j.taap.2020.114961**, PMCID PMC7166077 (open access; full text retrieved via NCBI efetch). Table 1. |
| Protocol quote | "The CiPA step-ramp protocol was used as the standard protocol across sites. It involves a pulse pattern, repeated every 5 s, consisting of a depolarization to 40 mV amplitude for a 500 ms duration, followed by a ramp (1.2 V/s) to −80 mV for 100 ms." |
| Quality criterion quote | "A quality criterium was applied to select only those cells with less than 20% background current, where the background current was measured by applying 0.5 μM E-4031 to the cell at the end of each experiment." |
| Threshold quote | "The relationship between safety margin thresholds and torsadogenic risk predictivity suggests the threshold should be tailored to each specific context of use…" |
| Confidence | verified-from-primary |

> Caveat: these multi-site data are **room temperature** ("we decided to focus on room temperature
> data in this project to maximize the coverage of participating sites"), i.e. outside the ICH Q&A
> 2.1 35–37 °C recommendation. Use them as protocol-specific anchors, not as best-practice values.

### B.7 CiPA dynamic-protocol reference (Milnes protocol)

| Item | Detail |
|---|---|
| Value | Li Z, Dutta S, Sheng J, Tran PN, Wu W, Chang K, Mdluli T, Strauss DG, Colatsky T. "Improving the In Silico Assessment of Proarrhythmia Risk by Combining hERG Channel-Drug Binding Kinetics and Multichannel Pharmacology." *Circ Arrhythm Electrophysiol.* 2017;10(2):e004628. DOI **10.1161/CIRCEP.116.004628**, PMID 28202629. The drug–hERG kinetic parameters in this model are fitted to data from a modified Milnes protocol (Milnes JT et al., 2010). |
| Source | Crossref record (verified); the Milnes attribution is quoted from Ridder 2020 (open access). |
| Quote | Ridder 2020: "The drug-specific kinetic parameters were estimated by fitting to time-dependent fractional block data from a modified Milnes protocol (Milnes et al., 2010)." |
| Confidence | citation verified-from-primary; the Milnes voltage-step details themselves were **not** retrieved (Li 2017 and Milnes 2010 full texts are paywalled) → **not-found** for the exact step voltages/durations. |

### B.8 Positive controls named by ICH

| Item | Detail |
|---|---|
| Value | The positive control must be one of the reference drugs used to derive the margin threshold; in the ICH training example those are **moxifloxacin, ondansetron, dofetilide**. E-4031 appears in the literature as the *selective blocker* used for background-current subtraction (Ridder 2020), not as the margin reference drug. |
| Source | ICH E14/S7B Q&As, Q&A 2.1 item 7 + training material example (B.5). |
| Quote | Q&A 2.1: "The positive control drug should be one of the 'reference drugs' referred to in Q&A 1.2." |
| Confidence | verified-from-primary |

---

## C. Repeat-dose toxicity group design

### C.1 OECD TG 407 (adopted 3 October 2008) — 28-day oral, rodents

DOI **10.1787/9789264070684-en** (Crossref verified). Text verified from the OECD PDF mirrored by
US NTP/ICCVAM: `https://ntp.niehs.nih.gov/iccvam/suppdocs/feddocs/oecd/oecdtg407-2008.pdf`
(header: "OECD/OCDE 407, Adopted: 3 October 2008"). All quotes below **verified-from-primary**.

| Parameter | Value | Paragraph | Verbatim quote |
|---|---|---|---|
| Animals/sex/group | 10 (5 M + 5 F) | ¶17 | "At least 10 animals (five female and five male) should be used at each dose level." |
| Satellite/recovery | 10 (5/sex) in control + top dose, ≥14 days post-treatment | ¶17 | "Consideration should be given to an additional satellite group of ten animals (five per sex) in the control and in the top dose group for observation of reversibility, persistence, or delayed occurrence of toxic effects, for at least 14 days post treatment." |
| Dose groups | ≥3 test groups + concurrent control | ¶18 | "Generally, at least three test groups and a control group should be used, but if from assessment of other data, no effects would be expected at a dose of 1000mg/kg bw/d, a limit test may be performed." |
| Dose spacing / NOAEL intent | 2–4 fold intervals; lowest dose a NOAEL | ¶19 | "Two to four fold intervals are frequently optimal for setting the descending dose levels and addition of a fourth test group is often preferable to using very large intervals (e.g. more than a factor of 10) between dosages." |
| Limit dose | 1000 mg/kg bw/day | ¶21 | "If a test at one dose level of at least 1000 mg/kg body weight/day … produces no observable toxic effects and if toxicity would not be expected based upon data from structurally related compounds, then a full study using three dose levels may not be considered necessary." |
| Dosing | daily, 7 days/week, 28 days | ¶22 / ¶24 | "The observation period should be 28 days." |
| Clinical observations | ≥1×/day general, ≥2×/day morbidity/mortality; detailed weekly in a standard arena | ¶25–26 | "At least twice daily, all animals are observed for morbidity and mortality." |
| Body weight / food | weekly | ¶31 | "All animals should be weighed at least once a week. Measurements of food consumption should be made at least weekly." |
| Haematology | haematocrit, haemoglobin, erythrocytes, reticulocytes, total + differential leucocytes, platelets, clotting time/potential (+ methaemoglobin/Heinz bodies if oxidising) | ¶32 | "…haematocrit, haemoglobin concentrations, erythrocyte count, reticulocytes, total and differential leucocyte count, platelet count and a measure of blood clotting time/potential." |
| Clinical chemistry | Na, K, glucose, total cholesterol, urea, creatinine, total protein, albumin, ≥2 hepatocellular enzymes, bile acids | ¶34 | "Investigations of plasma or serum shall include sodium, potassium, glucose, total cholesterol, urea, creatinine, total protein and albumin, at least two enzymes indicative of hepatocellular effects … and bile acids." |
| Urinalysis | optional, last week, timed collection | ¶35 | "Optionally, the following urinalysis determinations could be performed during the last week of the study using timed urine volume collection; appearance, volume, osmolality or specific gravity, pH, protein, glucose and blood/blood cells." |
| Organ weights | liver, kidneys, adrenals, testes, epididymides, prostate + seminal vesicles with coagulating glands, thymus, spleen, brain, heart | ¶40 | "The liver, kidneys, adrenals, testes, epididymides, prostate + seminal vesicles with coagulating glands as a whole, thymus, spleen, brain and heart of all animals … should be trimmed of any adherent tissue … and their wet weight taken…" |
| Histopathology list | all gross lesions, brain (cerebrum, cerebellum, pons), spinal cord, eye, stomach, small+large intestine (with Peyer's patches), liver, kidneys, adrenals, spleen, heart, thymus, thyroid, trachea+lungs, gonads, accessory sex organs, vagina, urinary bladder, lymph nodes, peripheral nerve, skeletal muscle, bone with marrow | ¶43 | "The following tissues should be preserved in the most appropriate fixation medium for both the type of tissue and the intended subsequent histopathological examination…" |
| Statistics | appropriate method, chosen at design; no multiple t-tests | ¶51 | "Comparisons of the effect along a dose range should avoid the use of multiple t-tests. The statistical methods should be selected during the design of the study." |

### C.2 OECD TG 408 (adopted 25 June 2018) — 90-day oral, rodents

DOI **10.1787/9789264070707-en** (Crossref verified; note the Crossref "issued" date reflects the
latest OECD reprint, not the adoption date). Text verified from a copy carrying the official header
"OECD/OCDE 408, Adopted: 25 June 2018, © OECD 2018" and the C(2018)49 amendment note
(`https://www.utu.fi/sites/default/files/media/408%20Repeated%20dose%2090-day%20oral%20toxicity%20study%20in%20rodents.pdf`);
group-size wording cross-checked against a second OECD-hosted copy. All quotes **verified-from-primary**.

| Parameter | Value | Paragraph | Verbatim quote |
|---|---|---|---|
| Animals/sex/group | 20 (10 M + 10 F) | ¶15 | "At least 20 animals (ten female and ten male) should be used at each dose level." |
| Satellite/recovery | ≥10 (5/sex) in control + top dose | ¶15 | "…consideration should be given to including an additional satellite group of at least ten animals (five per sex) in the control and in the top dose group for observation after the treatment period, for the potential reversibility or persistence of any toxic effects." |
| Dose groups | ≥3 dose levels + concurrent control | ¶16 | "At least three dose levels and a concurrent control shall be used, except where a limit test is conducted (see paragraph 18)." |
| Dose spacing | 2–4 fold; 4th group preferred over >6–10× gaps; lowest dose a NOAEL | ¶16 | "Two- to four-fold intervals are frequently optimal for setting the descending dose levels and addition of a fourth test group is often preferable to using very large intervals (e.g., more than a factor of about 6-10) between dosages." |
| Control group | untreated or vehicle; vehicle at highest volume used | ¶17 | "The control group shall be an untreated group or a vehicle-control group if a vehicle is used for administering the test chemical." |
| Limit dose | 1000 mg/kg bw/day | ¶19 | "Using the methods described for this study, if a test at one dose level equivalent to at least 1000 mg/kg body weight/day produces no observed adverse effects … then a full study using three dose levels may not be considered necessary." |
| Dosing | daily, 7 days/week, ≥90 days; gavage volume ≤1 mL/100 g (aqueous ≤2 mL/100 g) | ¶20 | "The animals are dosed with the test chemical daily seven days each week for at least 90 days." |
| Observation period | ≥90 days | ¶22 | "The observation period should be at least 90 days." |
| Clinical observations | ≥1×/day; detailed weekly; ophthalmology pre-dose and at termination (¶25); functional observations not earlier than week 11 (¶26) | ¶23 | "General clinical observations should be made at least once a day, preferably at the same time(s) each day, taking into consideration the peak period of…" |
| Body weight / food / water | weekly | ¶29 | "All animals should be weighed at least once a week. Measurements of food consumption should be made at least weekly." |
| Haematology | haematocrit, haemoglobin, erythrocytes, reticulocytes, total + differential leukocytes, platelets, clotting time/potential | ¶31 | "…haematocrit, haemoglobin concentration, erythrocyte count, reticulocyte count, total and differential leukocyte count, platelet count and a measure of blood clotting time/potential." |
| Clinical chemistry | Na, K, glucose, total cholesterol, HDL, LDL, urea, BUN, creatinine, total protein, albumin, >2 hepatocellular enzymes | ¶32 | "Determinations in plasma or serum should include sodium, potassium, glucose, total cholesterol, HDL, LDL, urea, blood urea nitrogen, creatinine, total protein and albumin, and more than two enzymes indicative of hepatocellular effects…" |
| Thyroid hormones | total T4, T3, TSH | ¶34 | "Serum total T4, T3 and TSH should be measured on samples obtained from…" |
| Urinalysis | optional, last week, timed collection | ¶37 | "Optionally, the following urinalysis determinations may be performed during the last week of the study using timed urine volume collection: appearance, volume, osmolality or specific gravity, pH, protein, glucose and blood/blood cells." |
| Organ weights | liver, kidneys, adrenals, testes, epididymides, prostate + seminal vesicles with coagulating glands, uterus, ovaries, thymus, spleen, brain, heart (+ pituitary; thyroid weighed with care, preferably post-fixation ¶44) | ¶43 | "The liver, kidneys, adrenals, testes, epididymides, prostate + seminal vesicles with coagulating glands as a whole …, uterus, ovaries, thymus, spleen, brain, and heart of all animals … [should] have their wet weight taken as soon as possible after dissection…" |
| Histopathology list | all gross lesions, brain (cerebrum/cerebellum/medulla-pons), spinal cord (3 levels), pituitary, thyroid, parathyroid, thymus, oesophagus, salivary glands, stomach, small+large intestine (Peyer's patches), liver, pancreas, kidneys, adrenals, spleen, heart, trachea+lungs, aorta, ovaries, uterus, cervix, vagina, testes, epididymides, prostate, seminal vesicles, coagulation glands, mammary gland (M+F), urinary bladder, gall bladder (mouse), lymph nodes, peripheral nerve, skeletal muscle, bone with marrow, skin, eyes | ¶45 | "The following tissues should be preserved in the most appropriate fixation medium for both the type of tissue and the intended subsequent histopathological examination…" |
| Statistics | appropriate method, selected at design | ¶51 | "When applicable, numerical results should be evaluated by an appropriate and generally acceptable statistical method. The statistical methods and the data to be analysed should be selected during the design of the study." |
| Historical controls | compare to same-lab historical control data | ¶52 | "For quality control it is proposed that control data are compared to historical control values originating from the same laboratory, species, strain, and collected under similar conditions." |

### C.3 OECD TG 409 (adopted 21 September 1998) — 90-day oral, non-rodents

DOI **10.1787/9789264070721-en** (Crossref verified: issued 1998-09-21). Text verified from a PDF
carrying the official header "OECD/OCDE 409, Adopted: 21st September 1998" (third-party mirror —
re-verify against the OECD original before shipping). All quotes **verified-from-primary** (of that copy).

| Parameter | Value | Paragraph | Verbatim quote |
|---|---|---|---|
| Species | dog commonly used | ¶7 | "The commonly used non-rodent species is the dog, which should be of a defined breed…" |
| Animals/sex/group | 8 (4 M + 4 F) | ¶12 | "At least 8 animals (four female and four male) should be used at each dose level." |
| Satellite/recovery | 8 (4/sex) in control + top dose | ¶12 | "…consideration should be given to including an additional satellite group of 8 animals (four per sex) in control and in top dose group for observation after the treatment period of reversibility or persistence of any toxic effects." |
| Dose groups | ≥3 dose levels + concurrent control | ¶13 | "At least three dose levels and a concurrent control shall be used, except where a limit test is conducted (see paragraph 16)." |
| Dose spacing | 2–4 fold; NOAEL at lowest dose | ¶13 | "Two to four fold intervals are frequently optimal for setting the descending dose levels and addition of a fourth test group is often preferable to using very large intervals (e.g., more than a factor of about 6 - 10) between dosages." |
| Duration | 90 days, daily oral | ¶6 | "The test substance is orally administered daily in graduated doses to several groups of experimental animals, one dose level per group for a period of 90 days." |
| Clinical observations | detailed weekly in standard arena | ¶21 | "At least once prior to the first exposure …, and once a week thereafter, detailed clinical observations should be made in all animals." |
| Ophthalmology | pre-dose and at termination | ¶22 | "Ophthalmological examination … should be made prior to the administration of the test substance and at the termination of the study, preferably in all animals but at least in the high dose and control groups." |
| Body weight / food | weekly | ¶23 | "All animals should be weighed at least once a week. Measurements of food consumption should be made at least weekly." |
| Haematology | start, monthly or midway, end | ¶25 | "Haematology, including haematocrit, haemoglobin concentration, erythrocyte count, total and differential leukocyte count, platelet count and a measure of clotting potential such as clotting time, prothrombin time, or thromboplastin time should be investigated at the start of the study, then either at monthly intervals or midway through the test period and finally at the end of the test period." |
| Clinical chemistry | start, monthly/midway, end | ¶26 | "Suggested determinations include calcium, phosphorus, chloride, sodium, potassium, fasting glucose, alanine aminotransferase, aspartate aminotransferase, ornithine decarboxylase, gamma glutamyl transpeptidase, urea nitrogen, albumin, blood creatinine, total bilirubin and total serum protein measurements." |
| Urinalysis | start, midway, end (mandatory, unlike TG 407/408) | ¶27 | "Urinalysis determinations should be performed at least at the start, then midway and finally at the end of the study using timed urine volume collection." |
| Organ weights | liver with gall bladder, kidneys, adrenals, testes, epididymides, ovaries, uterus, thyroid (with parathyroids), thymus, spleen, brain, heart | ¶30 | "The liver with gall bladder, kidneys, adrenals, testes, epididymides, ovaries, uterus, thyroid (with parathyroids), thymus, spleen, brain and heart of all animals … [wet weight taken]…" |
| Histopathology | full list incl. gall bladder, pituitary, eyes, aorta, lymph nodes, peripheral nerve | ¶31 | "The following tissues should be preserved in the most appropriate fixation medium for both the type of tissue and the intended subsequent histopathological examination…" |
| Statistics | appropriate method, selected at design | ¶36 | "When applicable, numerical results should be evaluated by an appropriate and generally acceptable statistical method. The statistical methods and the data to be analysed should be selected during the design of the study." |

### C.4 ICH M3(R2) — high dose selection and number of species

Source document: ICH M3(R2), "Guidance on Nonclinical Safety Studies for the Conduct of Human
Clinical Trials and Marketing Authorization for Pharmaceuticals" (Step 4, 11 June 2009),
`https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf`. All **verified-from-primary**.

| Parameter | Section | Verbatim quote |
|---|---|---|
| MTD / other limiting doses | §1.5 | "Generally, in toxicity studies, effects that are potentially clinically relevant can be adequately characterized using doses up to the maximum tolerated dose (MTD). It is not essential to demonstrate the MTD in every study." |
| Limit dose 1000 mg/kg/day | §1.5 | "Limit doses for acute, subchronic, and chronic toxicity studies of 1000 mg/kg/day for rodents and non-rodents are considered appropriate in all cases except those discussed below." |
| 2000 mg/kg/day exception | §1.5 | "In the few situations where a dose of 1000 mg/kg/day does not result in a mean exposure margin of 10-fold to the clinical exposure and the clinical dose exceeds 1 g per day, then the doses in the toxicity studies should be limited by a 10-fold exposure margin or a dose of 2000 mg/kg/day or the MFD, whichever is lower." |
| 50-fold exposure margin | §1.5 | "Doses providing a 50-fold margin of exposure (usually based on group mean AUC values … of the parent drug or the pharmacologically active molecule of a pro-drug) to the clinical systemic exposure generally are also considered acceptable as the maximum dose for acute and repeated-dose toxicity studies in any species." |
| US Phase III caveat | §1.5 | "To support Phase III clinical trials for the United States, dose-limiting toxicity generally should be identified in at least one species when using the 50-fold margin of exposure as the limit dose." |
| Genotoxicity endpoints in a general tox study | §1.5 | "If genotoxicity endpoints are to be incorporated into a general toxicity study, then an appropriate maximum dose should be selected based on a MFD, MTD or limit dose of 1000 mg/kg/day." |
| Two species, one non-rodent | §5 | "In principle, the duration of the animal toxicity studies conducted in two mammalian species (one non-rodent) should be equal to or exceed the duration of the human clinical trials up to the maximum recommended duration of the repeated-dose toxicity studies (Table 1)." |
| Minimum 2 weeks; 6/9-month chronic | §5.1 | "Repeated-dose toxicity studies in two species (one non-rodent) for a minimum duration of 2 weeks (Table 1) would generally support any clinical development trial up to 2 weeks in duration."; "Six month rodent and 9 month non-rodent studies generally support dosing for longer than 6 months in clinical trials (for exceptions see Table 1 footnotes)." |

Abbreviations list (p. 2 of the PDF) defines MFD = Maximum Feasible Dose, MTD = Maximum Tolerated
Dose, NOAEL = No Observed Adverse Effect Level — **M3(R2) does not give a prose definition of NOAEL**
(verified by searching the full text). Use the FDA MRSD definition (C.7).

### C.5 Statistics — Dunnett's test

| Item | Detail |
|---|---|
| Value | Dunnett CW. "A Multiple Comparison Procedure for Comparing Several Treatments with a Control." *Journal of the American Statistical Association* 1955;50(272):1096–1121. DOI **10.1080/01621459.1955.10501294**. |
| Source | Crossref record (verified: volume 50, pages 1096-1121, issued 1955-12). |
| Quote | Crossref title record: "A Multiple Comparison Procedure for Comparing Several Treatments with a Control". |
| Confidence | verified-from-primary (bibliographic record) |

| Item | Detail |
|---|---|
| Value | Dunnett **and Williams** as the recommended parametric procedures for repeat-dose toxicity evaluation (NTP practice); Dunnett two-sided where either direction matters, Dunnett + Williams where only one direction is toxicologically relevant. |
| Source | Jaki T, Hothorn LA. "Statistical evaluation of toxicological assays: Dunnett or Williams test—take both." *Arch Toxicol.* 2013;87(11):1901–1910. DOI 10.1007/s00204-013-1065-x, PMID 23652543 (abstract). |
| Quote | "The US National Toxicology Program recommends the use of the parametric multiple comparison procedures of Dunnett and Williams for the evaluation of repeated toxicity studies." |
| Confidence | verified-from-primary (abstract) — this is a *journal* statement of NTP practice, not an NTP or OECD document. |

| Item | Detail |
|---|---|
| Value | **OECD Guidance Document 116** (ENV/JM/MONO(2011)47, 2nd ed. 2012; ISBN-DOI 10.1787/9789264221475-en) statistical-analysis chapter — whether it names Dunnett/Williams/decision trees. |
| Source | `https://one.oecd.org/document/ENV/JM/MONO(2011)47/en/pdf` returned HTTP 403 to both curl and WebFetch; the OECD iLibrary copy is paywalled. |
| Quote | — |
| Confidence | **not-found** — do not assert a GD 116 recommendation until the PDF is obtained. The citable statistical requirements that *are* verified are OECD TG 407 ¶51 ("avoid the use of multiple t-tests") and TG 408 ¶51 / TG 409 ¶36. |

### C.6 NOAEL — definition and who determines it

| Item | Detail |
|---|---|
| Value | NOAEL = highest dose tested that does not produce a significant increase in adverse effects vs. control; biological (not just statistical) significance counts. |
| Source | FDA, *Guidance for Industry: Estimating the Maximum Safe Starting Dose in Initial Clinical Trials for Therapeutics in Adult Healthy Volunteers* (CDER, July 2005), **Appendix: Glossary** (and Section IV, "Step 1: No Observed Adverse Effect Level Determination"). Retrieved from `https://www.fda.gov/media/72309/download`. |
| Quote (glossary) | "No observed adverse effect level (NOAEL): The highest dose tested in an animal species that does not produce a significant increase in adverse effects in comparison to the control group. Adverse effects that are biologically significant, even if not statistically significant, should be considered in determining an NOAEL." |
| Quote (§IV) | "Several definitions of NOAEL exist, but for selecting a starting dose, the following is used: the highest dose level that does not produce a significant increase in adverse effects in comparison to the control group." |
| Confidence | verified-from-primary |

| Item | Detail |
|---|---|
| Value | NOAEL ≠ NOEL. "No observed effect level (NOEL): The highest dose tested in an animal species with no detected effects." |
| Source | Same guidance, Glossary. |
| Quote | "The NOAEL is not the same as the no observed effect level (NOEL), which refers to any effect, not just an adverse one, although in some cases the two might be identical." |
| Confidence | verified-from-primary |

| Item | Detail |
|---|---|
| Value | Three categories of findings used to set the NOAEL; expert judgement is expected and disagreement acknowledged. |
| Source | Same guidance, Section IV. |
| Quote | "There are essentially three types of findings in nonclinical toxicology studies that can be used to determine the NOAEL: (1) overt toxicity …; (2) surrogate markers of toxicity …; and (3) exaggerated pharmacodynamic effects." |
| Quote 2 | "…it is anticipated that in many instances, experts will disagree on the characterization of effects as being adverse or not…" |
| Confidence | verified-from-primary |

| Item | Detail |
|---|---|
| Value | Default safety factor applied to the HED of the NOAEL = 10. |
| Source | Same guidance, Section VII ("Step 4: Application of Safety Factor"). |
| Quote | "In practice, the MRSD for the clinical trial should be determined by dividing the HED derived from the animal NOAEL by the safety factor. The default safety factor that should normally be used is 10." |
| Confidence | verified-from-primary |

| Item | Detail |
|---|---|
| Value | **Who determines it:** the FDA guidance does not name a role. The legally attributable role for interpreting study data in a GLP study is the **Study Director**. |
| Source | 21 CFR 58.33 (Study director), current text retrieved from the eCFR API (title 21, part 58, §58.33; source note "[43 FR 60013, Dec. 22, 1978; 44 FR 17657, Mar. 23, 1979]"). |
| Quote | "The study director has overall responsibility for the technical conduct of the study, as well as for the interpretation, analysis, documentation and reporting of results, and represents the single point of study control." |
| Confidence | verified-from-primary (for the Study Director's responsibility). That the Study Director (with the toxicologist/pathologist) sets the NOAEL is an inference from this regulation plus the FDA guidance's "experts will disagree" language — **no source states "the NOAEL is determined by the study director" verbatim** → treat that specific sentence as industry convention. |

---

## Summary of what could NOT be verified

1. **Obach 1999 Methods** — incubation conditions, half-life/CLint equations as written in that paper,
   and the per-compound table (paywalled; 403 from ASPET and ScienceDirect; confirmed closed access
   by OpenAlex and Semantic Scholar).
2. **The 45 mg microsomal protein/g liver and ~20 g liver/kg scaling factors** — no citable source
   located (Barter 2007's 32 mg/g is the verified consensus value).
3. **Di & Kerns (2016) chapter text** and **Di et al. 2003 Methods** — the "1 µM / 0.5 mg/mL / 1 mM
   NADPH / 37 °C" condition set could not be traced to an accessible primary statement.
4. **Metabolic-stability positive-control panel and numeric acceptance criteria** — industry
   convention; no primary or consensus source.
5. **Milnes (2010) voltage-step details** and **Li et al. 2017 Methods** — paywalled; only the
   citation chain is verified.
6. **OECD Guidance Document 116 statistics chapter** — 403/paywalled, so no Dunnett/Williams quote
   from OECD itself.
7. **OECD TG 409 copy provenance** — the PDF carries the official 1998 OECD header but was obtained
   from a third-party mirror; re-verify against the OECD original before encoding.
