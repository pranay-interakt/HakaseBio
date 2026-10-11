# Driver research note — `ames` (genotox.ames, Wave A5)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A5: OECD TG 471.

Confidence labels (same scheme as `docs/research/driver_protocols.md`):
- **verified-from-primary** — exact wording read in the primary document during this session.
- **verified-bibliographic** — the citation (authors, title, journal, volume, pages, DOI) was confirmed
  against Crossref and/or PubMed/Europe PMC; the content was not read.
- **secondary-reproduction** — taken from a document that is not the originating source.
- **NOT VERIFIED** — could not be read; nothing filled in from memory.

## Primary documents read

| Document | Copy actually read | Header / version as printed | SHA-256 of the PDF read |
|---|---|---|---|
| OECD Test Guideline No. 471, *Bacterial Reverse Mutation Test* | OECD-produced PDF hosted by Institut Pasteur de Lille: `https://pasteur-lille.fr/wp-content/uploads/2026/03/OECD-471.pdf` (oecd.org and the DOI landing page returned HTTP 403 to every fetch attempt). PDF metadata: Keywords `ENV/JM/WRPR(2020)13`, created 2020-06-29; every page footer "©OECD 2020". 12 pages. | Cover: "Section 4 Health effects / Test Guideline No. 471 / Bacterial Reverse Mutation Test / 26 June 2020 / OECD Guidelines for the Testing of Chemicals". Page 1: "Adopted: 21 July 1997 / Corrected 26 June 2020 (CAS RN parag.24)". | `aa31b27650f0eecc8665ca221e16e0c4b47da9298189407f303740fa8227cc50` |
| ICH S2(R1) *Guidance on Genotoxicity Testing and Data Interpretation for Pharmaceuticals Intended for Human Use* (supporting; pharma-specific overlay) | `https://database.ich.org/sites/default/files/S2%28R1%29%20Guideline.pdf` | "Current Step 4 version dated 9 November 2011" | `4c68a5591c6ddea96d6b84ac1ebf65d6c68b70f9ffa1e3d4174f903b39618ac8` |

### Which version of TG 471 is current

| Parameter | Value | Source | Verbatim quote | Confidence |
|---|---|---|---|---|
| Current version | **Adopted 21 July 1997; corrected 26 June 2020.** The 2020 change is a correction of a CAS registry number in ¶24, not a substantive revision. | TG 471 PDF p.1 header block; Crossref record for DOI 10.1787/9789264071247-en (issued 2020-06-29, publisher OECD, type monograph). Corroborated by Arch Toxicol 2025 supplementary table (Springer ESM for DOI 10.1007/s00204-025-04277-9), which lists TG 471 as "1983 / 1997 (and in 2020 only the CAS number of one…" | "Adopted: 21 July 1997 Corrected 26 June 2020 (CAS RN parag.24)" | verified-from-primary (PDF) + verified-bibliographic (Crossref). **Caveat:** oecd.org itself could not be fetched (HTTP 403), so a revision published after the hosted copy cannot be excluded with certainty; re-check the OECD Test Guidelines page before release. |

## Design parameters (TG 471)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Number of strains | At least five | TG 471 ¶13, p.3 | "At least five strains of bacteria should be used." | verified-from-primary |
| Required strain set | (1) *S. typhimurium* TA1535; (2) TA1537 **or** TA97 **or** TA97a; (3) TA98; (4) TA100; (5) *E. coli* WP2 uvrA **or** WP2 uvrA (pKM101) **or** *S. typhimurium* TA102 | TG 471 ¶13, p.3 | "Therefore the recommended combination of strains is: 1. S. typhimurium TA1535, and 2. S. typhimurium TA1537 or TA97 or TA97a, and 3. S. typhimurium TA98, and 4. S. typhimurium TA100, and 5. E. coli WP2 uvrA, or E. coli WP2 uvrA (pKM101), or S. typhimurium TA102." | verified-from-primary |
| Cross-linking mutagens | TA102 or a DNA-repair-proficient *E. coli* (WP2 or WP2 pKM101) may be preferable | TG 471 ¶13, p.3 | "In order to detect cross-linking mutagens it may be preferable to include TA102 or to add a DNA repair-proficient strain of E.coli [e.g. E.coli WP2 or E.coli WP2 (pKM101).]" | verified-from-primary |
| Strain QC: spontaneous revertants | Within the laboratory's historical range (preferably within literature range) | TG 471 ¶14, p.3 | "The strains should also yield spontaneous revertant colony plate counts within the frequency ranges expected from the laboratory's historical control data and preferably within the range reported in the literature." | verified-from-primary |
| Culture density | Late-exponential / early-stationary, approx. 10⁹ cells/mL | TG 471 ¶11, p.3 | "Fresh cultures of bacteria should be grown up to the late exponential or early stationary phase of growth (approximately 10^9 cells per ml)." (superscript lost in extraction) | verified-from-primary |
| Culture temperature | 37 °C (recommended) | TG 471 ¶12, p.3 | "The recommended culture temperature is 37°C." | verified-from-primary |
| Metabolic activation | Both with and without S9; S9 usually 5–30 % v/v in the S9-mix | TG 471 ¶16, p.4 | "Bacteria should be exposed to the test substance both in the presence and absence of an appropriate metabolic activation system." / "The post-mitochondrial fraction is usually used at concentrations in the range from 5 to 30% v/v in the S9-mix." | verified-from-primary |
| Top dose (soluble, non-cytotoxic) | **5 mg/plate or 5 µL/plate** | TG 471 ¶19, p.4 | "The recommended maximum test concentration for soluble non-cytotoxic substances is 5 mg/plate or 5 µl/plate." | verified-from-primary |
| Top dose (insoluble) | One or more concentrations tested should be insoluble in the final mixture | TG 471 ¶19, p.4 | "For non-cytotoxic substances that are not soluble at 5 mg/plate or 5 µl/plate, one or more concentrations tested should be insoluble in the final treatment mixture." | verified-from-primary |
| Top dose (cytotoxic) | Up to a cytotoxic concentration | TG 471 ¶19, p.4 | "Test substances that are cytotoxic already below 5 mg/plate or 5 µl/plate should be tested up to a cytotoxic concentration." | verified-from-primary |
| Cytotoxicity indicators | Reduced revertants, clearing/diminution of background lawn, survival | TG 471 ¶19, p.4 | "Cytotoxicity may be detected by a reduction in the number of revertant colonies, a clearing or diminution of the background lawn, or the degree of survival of treated cultures." | verified-from-primary |
| Above 5 mg/plate | May be considered for substances with substantial mutagenic impurities | TG 471 ¶21, p.4 | "Testing above the concentration of 5 mg/plate or 5 µl/plate may be considered when evaluating substances containing substantial amounts of potentially mutagenic impurities." | verified-from-primary |
| Number of dose levels | **At least five analysable concentrations**, ~half-log (√10) spacing in the initial experiment | TG 471 ¶20, p.4 | "At least five different analysable concentrations of the test substance should be used with approximately half log (i.e. √10) intervals between test points for an initial experiment." | verified-from-primary |
| Plates per dose | **Triplicate**; duplicate acceptable if scientifically justified | TG 471 ¶29, p.6 | "For an adequate estimate of variation, triplicate plating should be used at each dose level. The use of duplicate plating is acceptable when scientifically justified." | verified-from-primary |
| Concurrent controls | Strain-specific positive and negative (solvent/vehicle) controls, ± S9, in each assay | TG 471 ¶22, p.5 | "Concurrent strain-specific positive and negative (solvent or vehicle) controls, both with and without metabolic activation, should be included in each assay." | verified-from-primary |
| Untreated controls | Required unless historical data show the solvent has no deleterious/mutagenic effect | TG 471 ¶26, p.6 | "In addition, untreated controls should also be used unless there are historical control data demonstrating that no deleterious or mutagenic effects are induced by the chosen solvent." | verified-from-primary |
| Positive controls with S9 (examples) | 9,10-dimethylanthracene (781-43-1); 7,12-dimethylbenzanthracene (57-97-6); Congo Red (573-58-0, reductive method); benzo(a)pyrene (50-32-8); cyclophosphamide (50-18-0; monohydrate 6055-19-2); 2-aminoanthracene (613-13-8) | TG 471 ¶23, p.5 | "2-Aminoanthracene should not be used as the sole indicator of the efficacy of the S9-mix." | verified-from-primary (list transcribed from ¶23) |
| Positive controls without S9 (examples, by strain) | Sodium azide (26628-22-8) — TA1535, TA100; 2-nitrofluorene (607-57-8) — TA98; 9-aminoacridine (90-45-9) or ICR191 (17070-45-0) — TA1537, TA97, TA97a; cumene hydroperoxide (80-15-9) — TA102; mitomycin C (50-07-7) — WP2 uvrA, TA102; ENNG (4245-77-6) or MNNG (70-25-7) or 4-NQO (56-57-5) — WP2, WP2 uvrA, WP2 uvrA (pKM101); AF-2 (3688-53-7) — plasmid-containing strains | TG 471 ¶24, p.5 (the paragraph corrected in 2020) | "For assays performed without metabolic activation system, examples of strain-specific positive controls are:" | verified-from-primary (table transcribed) |
| Other positive controls | Allowed | TG 471 ¶25, p.5 | "Other appropriate positive control reference substances may be used." | verified-from-primary |
| Methods | Plate incorporation or preincubation (≥20 min at 30–37 °C), both acceptable ± S9 | TG 471 ¶10, p.2; ¶28, p.6 | "Either of them is acceptable for conducting experiments both with and without metabolic activation." | verified-from-primary |
| Incubation | 37 °C for 48–72 h | TG 471 ¶31, p.6 | "All plates in a given assay should be incubated at 37°C for 48-72 hours." | verified-from-primary |
| Data unit | Revertant colonies per plate | TG 471 ¶32, p.6 | "Data should be presented as the number of revertant colonies per plate." | verified-from-primary |
| Required summary | Individual plate counts, mean per plate, SD — test article and all controls | TG 471 ¶33, p.6 | "Individual plate counts, the mean number of revertant colonies per plate and the standard deviation should be presented for the test substance and positive and negative (untreated and/or solvent) controls." | verified-from-primary |

## Evaluation and interpretation (TG 471 ¶34–38)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Criteria for a positive result | Concentration-related increase over the range tested **and/or** a reproducible increase at ≥1 concentration in revertants/plate, in ≥1 strain, ± S9 | TG 471 ¶35, p.7 (cites ref. 23, Claxton et al. 1987) | "There are several criteria for determining a positive result, such as a concentration-related increase over the range tested and/or a reproducible increase at one or more concentrations in the number of revertant colonies per plate in at least one strain with or without metabolic activation system (23). Biological relevance of the results should be considered first." | verified-from-primary |
| Role of statistics | An aid only; significance alone is not determinative | TG 471 ¶35, p.7 (cites ref. 24, Mahon et al. 1989) | "Statistical methods may be used as an aid in evaluating the test results (24). However, statistical significance should not be the only determining factor for a positive response." | verified-from-primary |
| Negative call | Results not meeting ¶35 criteria → non-mutagenic in this test | TG 471 ¶36, p.7 | "A test substance for which the results do not meet the above criteria is considered non- mutagenic in this test" (sic — no full stop, hyphen-space as printed) | verified-from-primary |
| Equivocal | Can remain equivocal regardless of repeats | TG 471 ¶37, p.7 | "Results may remain equivocal or questionable regardless of the number of times the experiment is repeated." | verified-from-primary |
| Confirmation | Clear positives need no verification; equivocal → further testing; negatives confirmed case-by-case (with justification if not) | TG 471 ¶34, p.6–7 | "There is no requirement for verification of a clear positive response. Equivocal results should be clarified by further testing preferably using a modification of experimental conditions." | verified-from-primary |
| **Fold-increase rule (2-fold / 3-fold)** | **NOT PRESENT IN TG 471.** The text was searched for "fold", "twice", "double", "two times", "three times", "2x", "3x": zero matches. TG 471 gives only the qualitative criteria above. ICH S2(R1) also contains no fold rule for the Ames test (its only "fold" occurrences concern in vivo / mammalian dose spacing). | TG 471 full text; S2(R1) full text | — | verified-from-primary (absence) |
| Historical control data | (a) strain QC against lab historical ranges (¶14); (b) untreated-control waiver (¶26); (c) **report must include historical negative and positive control data with ranges, means, SDs** (¶39) | TG 471 ¶39 "Results", p.8 | "historical negative (solvent/vehicle) and positive control data, with e.g. ranges, means and standard deviations." | verified-from-primary |
| Report: concurrent controls | Concurrent negative and positive control data with ranges, means and SDs | TG 471 ¶39, p.8 | "concurrent negative (solvent/vehicle) and positive control data, with ranges, means and standard deviations;" | verified-from-primary |

## ICH S2(R1) overlay for pharmaceuticals (supporting)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Top dose | 5000 µg/plate (5 µL/plate liquids) unless limited by solubility or cytotoxicity | S2(R1) §3.2.1, p.5 | "The maximum dose level recommended is 5000 µg/plate (or 5 µL/plate for liquid test substance) when not limited by solubility or cytotoxicity." | verified-from-primary |
| Toxicity at top dose | Doses scored should show significant toxicity without exceeding 5000 µg/plate | S2(R1) §3.2.1, p.5 | "In the Ames test, the doses scored should show evidence of significant toxicity, but without exceeding a top dose of 5000 µg/plate." | verified-from-primary |
| Single test sufficient | One Ames test suffices if clearly negative/positive and fully adequate (differs from OECD/IWGT) | S2(R1) §3.2.2, p.6 | "One difference from the OECD and IWGT recommendations is that, based on experience with testing pharmaceuticals, a single bacterial mutation (Ames) test is considered sufficient when it is clearly negative or positive, and carried out with a fully adequate protocol including all strains with and without metabolic activation, a suitable dose range that fulfills criteria for top dose selection, and appropriate positive and negative controls." | verified-from-primary |
| Use of historical control CI | Small statistically significant increases inside the facility's historical-control confidence intervals are not biologically meaningful | S2(R1) §5.1 item i, p.11 | "Small increases that are statistically significant compared with the negative or solvent control values but are within the confidence intervals of the appropriate historical control values for the testing facility." | verified-from-primary |
| Peptides | Ames not suitable for a peptide likely to degrade (amino-acid contamination) | S2(R1) §5.2.1, p.12 | "These can occur due to contamination with amino acids (i.e., providing histidine for Salmonella typhimurium strains or tryptophan for Escherichia coli strains), so that the bacterial reversion assay is not suitable for testing a peptide that is likely to degrade." | verified-from-primary |

## Referenced sources in TG 471 that the driver might want to cite

| Item | Bibliographic status | Content status |
|---|---|---|
| Claxton LD et al. 1987 (TG 471 ref. 23 — the cited basis for the positive-result criteria) | verified-bibliographic: Mutat Res 189(2):83–91, DOI 10.1016/0165-1218(87)90014-0, PMID 3309640 | Abstract read; it does **not** state numerical criteria. Full text NOT VERIFIED (closed). |
| Mahon GAT et al. 1989 (TG 471 ref. 24 — statistics) | Book chapter (UKEMS, Cambridge University Press, pp. 28–65); no DOI; not checked | NOT VERIFIED |
| Gatehouse D et al. 1994 (TG 471 ref. 3; IWGT) | verified-bibliographic: Mutat Res 312(3):217–233, DOI 10.1016/0165-1161(94)90037-x, PMID 7514736. **Discrepancy:** Crossref/PubMed list 11 authors including Ohta T; TG 471's reference list omits Ohta. | Abstract read (truncated at 400 words by PubMed); readable portion gives 5 doses and majority agreement for 3 plates/dose, no fold rule. Full text NOT VERIFIED. |
| Maron DM, Ames BN 1983 (TG 471 ref. 2) | verified-bibliographic: Mutat Res 113(3–4):173–215, DOI 10.1016/0165-1161(83)90010-9, PMID 6341825 | Abstract read only |

## Implications for the driver

- Strain set, ±S9, ≥5 analysable concentrations, triplicate plating (duplicate only with a recorded
  justification), concurrent strain-specific positive and solvent controls are all citable to TG 471 ¶13,
  ¶16, ¶20, ¶22, ¶29 and can be enforced as protocol-conformance checks.
- Top dose 5 mg/plate (5 µL/plate) is citable (TG 471 ¶19; S2(R1) §3.2.1) as a *conformance check*, not a
  default — the actual top dose is a required input with its stated basis (cytotoxicity / solubility / limit).
- "Fold increase over concurrent negative control" may be **computed and displayed** (it is a ratio of
  measured means), but **any fold threshold (2× / 3×) used as a decision rule has no basis in TG 471 or S2(R1)**
  and must not be encoded as a cited criterion. The positive / negative / equivocal call is the Study
  Director's, using the ¶35 qualitative criteria (dose-relationship, reproducibility, biological relevance)
  and historical control ranges, which must be a required input (¶14, ¶39; S2(R1) §5.1).

## NOT VERIFIED

- oecd.org official download of TG 471 (HTTP 403); a post-2020 revision cannot be fully excluded.
- Any 2-fold / 3-fold decision rule — no primary source read in this session states one.
- Content of Claxton 1987, Mahon 1989, Gatehouse 1994 beyond abstracts.

## Citations to register

1. OECD (2020). *Test No. 471: Bacterial Reverse Mutation Test.* OECD Guidelines for the Testing of Chemicals, Section 4. OECD Publishing, Paris. Adopted 21 July 1997; corrected 26 June 2020. DOI: 10.1787/9789264071247-en.
2. ICH (2011). *S2(R1): Guidance on Genotoxicity Testing and Data Interpretation for Pharmaceuticals Intended for Human Use.* Step 4, 9 November 2011. https://database.ich.org/sites/default/files/S2%28R1%29%20Guideline.pdf
3. Claxton LD, Allen J, Auletta A, Mortelmans K, Nestmann E, Zeiger E. Guide for the Salmonella typhimurium/mammalian microsome tests for bacterial mutagenicity. *Mutat Res.* 1987;189(2):83–91. DOI: 10.1016/0165-1218(87)90014-0 *(bibliographic only — cite as "cited by TG 471 ¶35", not for any specific value)*.
4. Gatehouse D, Haworth S, Cebula T, Gocke E, Kier L, Matsushima T, Melcion C, Nohmi T, Ohta T, Venitt S, Zeiger E. Recommendations for the performance of bacterial mutation assays. *Mutat Res.* 1994;312(3):217–233. DOI: 10.1016/0165-1161(94)90037-x *(bibliographic only)*.

## Implementation record (driver `ames` v1.0.0, 2026-10-11)

- **TG 471 re-checked.** The text was re-read from the same PDF (SHA-256 `aa31b276…cc50`):
  - ¶19, top dose and insolubility;
  - ¶20, "At least five different analysable concentrations";
  - ¶27–28, plate incorporation; preincubation "usually for 20 min. or more at 30°-37°C";
  - ¶29, triplicate plating;
  - ¶31, "37°C for 48-72 hours";
  - ¶32–33, data presentation;
  - ¶34–35, confirmation and evaluation.
- **TG 471 DOI.** 10.1787/9789264071247-en was confirmed on Crossref (OECD monograph, issued
  2020-06-29).
- **Decisions.**
  - **Errors vs notes.** Paragraphs with a "should" and a number (¶13, 20, 29, 31) are
    validation errors. Paragraphs with "usually" (¶16 S9 5–30% v/v; ¶28 preincubation) are
    design notes.
  - **Fold over vehicle.** Computed and shown, but never used as a criterion.
  - **Statistics.** No statistical test is applied. TG 471 ¶35 allows statistics only as an aid,
    and its cited method (Mahon et al. 1989) is NOT VERIFIED.
  - **Historical ranges.** Negative ranges are required per strain × S9; positive ranges are
    optional. The range type (e.g. 95% control limits) is stated by the laboratory.
