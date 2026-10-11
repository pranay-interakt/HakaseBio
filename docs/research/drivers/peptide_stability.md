# Driver research note: `peptide_stability` (build plan Wave P, item P-2)

Checked on 2026-10-11. No repository file other than this note was edited.

Build plan P-2 says: "Plasma and serum stability across species, and protease panels where designed; reuses the
first-order depletion fit with the matrix and enzyme recorded", with the basis given as **Di & Kerns 2016**.

Status words: **VERIFIED** means I read the source text myself. **NOT VERIFIED** gives the reason.

**A note on quoting.** The sources below are journal articles under publisher or Creative Commons licence. I have
kept quotations very short and stated the experimental parameters as facts with a pointer to the exact section,
rather than reproducing method paragraphs. Every number below was read directly in the cited section; a reviewer
can confirm it at the location given.

---

## 0. Summary

1. **Di & Kerns 2016: citation VERIFIED, text NOT VERIFIED.** Crossref confirms the book and two relevant
   chapters, "Plasma Stability" (pp. 195-206) and "Plasma Stability Methods" (pp. 387-392). ScienceDirect
   returned HTTP 403 to WebFetch and an error page in the browser, so I could read no assay conditions in it.
   **Do not take any parameter value from Di & Kerns 2016 until someone reads the book.** Under CLAUDE.md rule 3
   this means the chapter cannot yet serve as the method citation for a shipped driver.
2. Openly readable primary papers do cover the method, and their DOIs are verified through Crossref:
   - **Böttger, Hoffmann & Knappe 2017** (*PLoS One*, CC BY 4.0): the same peptide degrades at different rates in
     fresh blood, serum, heparin plasma and EDTA plasma. Matrix and anticoagulant are first-class inputs.
   - **Cavaco et al. 2021** (*Clin Transl Sci*): human serum assay, half-life from a one-phase exponential decay fit.
   - **Nguyen et al. 2010** (*PLoS One*, CC BY 4.0): diluted human serum assay with an explicit sampling schedule.
   - **Di 2015** (*AAPS J*, free in PMC): which biological matrices are used for which clearance route, and what
     the assay yields (in vitro intrinsic clearance and half-life, plus degradation-product identity).
   - **Di, Kerns, Hong & Chen 2005** (*Int J Pharm*): a plasma-stability assay developed for small molecules;
     abstract only.
3. **Assay conditions are not standardised across these papers.** Peptide concentration spans 5 micromolar to
   roughly 0.5 millimolar; serum content spans 25 percent to 100 percent; sampling spans 10 minutes to 24 hours.
   Each condition must therefore be a **required parameter with no scientific default**, per build plan §5 item 2.
4. **Fit-model caveat.** The model Cavaco 2021 names (GraphPad "one phase decay") carries a plateau term. The HOS
   first-order depletion fit is the special case with plateau zero. If the existing fit is reused, record the
   model identity and flag incomplete depletion rather than letting a plateau be absorbed silently.
5. **Species.** None of these open papers provides a cross-species panel with matched conditions. Böttger 2017 is
   mouse (plus commercial mouse serum and plasma); Cavaco 2021 and Nguyen 2010 are human serum. A cross-species
   claim cannot be supported from the sources read here.

---

## 1. Source table

| # | Citation | DOI verified via Crossref | Access route | Status |
|---|---|---|---|---|
| S1 | Di L, Kerns EH. *Drug-Like Properties: Concepts, Structure Design and Methods from ADME to Toxicity Optimization.* 2nd ed. Elsevier/Academic Press; 2016. ISBN 9780128010761. Chapter "Plasma Stability", pp. 195-206, doi:10.1016/B978-0-12-801076-1.00012-5; chapter "Plasma Stability Methods", pp. 387-392, doi:10.1016/B978-0-12-801076-1.00030-7 | Yes (book-chapter records; publisher Elsevier; issued 2016) | ScienceDirect blocked (403) | **Citation VERIFIED, text NOT VERIFIED** |
| S2 | Böttger R, Hoffmann R, Knappe D. Differential stability of therapeutic peptides with different proteolytic cleavage sites in blood, plasma and serum. *PLoS One.* 2017;12(6):e0178943. doi:10.1371/journal.pone.0178943. PMID 28575099, PMC5456363. CC BY 4.0 | Yes (issued 2017-06-02) | Europe PMC full-text XML, SHA-256 `94a2adb1c951bce574bbae45b10c765f55b702bbe0d58d60dedc066d5d538a73` | VERIFIED |
| S3 | Cavaco M, Valle J, Flores I, Andreu D, Castanho MARB. Estimating peptide half-life in serum from tunable, sequence-related physicochemical properties. *Clin Transl Sci.* 2021;14(4):1349-1358. doi:10.1111/cts.12985. PMID 33641212, PMC8301568. CC BY-NC-ND 4.0 | Yes | Europe PMC full-text XML, SHA-256 `442a19d8e9de98fc0d7da054e55e78824f5a4137f5dc79195a3683eb152d2fbe` | VERIFIED |
| S4 | Nguyen LT, Chau JK, Perry NA, de Boer L, Zaat SAJ, Vogel HJ. Serum stabilities of short tryptophan- and arginine-rich antimicrobial peptide analogs. *PLoS One.* 2010;5(9):e12684. doi:10.1371/journal.pone.0012684. PMID 20844765, PMC2937036. CC BY 4.0 | Yes (issued 2010-09-10) | Europe PMC full-text XML, SHA-256 `c4b6c6e6c0830e724975602f3034ea02f0ac467d4007154955b9c5ccde80836a` | VERIFIED |
| S5 | Di L. Strategic approaches to optimizing peptide ADME properties. *AAPS J.* 2015;17(1):134-143. doi:10.1208/s12248-014-9687-3. PMID 25366889, PMC4287298 | Yes (online 2014-11-04) | PMC article page, read in browser (Europe PMC XML returned HTTP 500) | VERIFIED |
| S6 | Di L, Kerns EH, Hong Y, Chen H. Development and application of high throughput plasma stability assay for drug discovery. *Int J Pharm.* 2005;297(1-2):110-119. doi:10.1016/j.ijpharm.2005.03.022. PMID 15876500 | Yes | Abstract only (Europe PMC) | Abstract VERIFIED, full text NOT VERIFIED |
| S7 | FDA CDER. *Clinical Pharmacology Considerations for Peptide Drug Products.* Draft guidance for industry, December 2023 | n/a | PDF, SHA-256 `c02c7b4daaafe8f3b9ec92f3f67083c2d016ddc467ed05ee8e9633bd40e48807` | VERIFIED (draft, non-binding) |
| S8 | GraphPad Software. "Equation: One phase decay", Prism 11 Curve Fitting Guide | n/a | WebFetch 2026-10-11 | VERIFIED |

---

## 2. Assay design facts

### 2.1 Which matrix, and why it matters (S2)

| Parameter | Value as reported | Source location | Confidence |
|---|---|---|---|
| Matrices compared | fresh whole blood (peptide drawn into the syringe with the blood), "direct serum", "activated serum" (silica-accelerated separator tube), commercial serum, lithium-heparin plasma, K2-EDTA plasma | S2, Sample collection and Blood sample preparations | VERIFIED |
| Species | CD-1 mice (female, 14-16 weeks, 28-40 g), terminal cardiac puncture | S2, Animals | VERIFIED |
| Peptide concentration | approximately 31.5 micromolar final, in both the blood and the serum/plasma incubations | S2, Stability assay and Sample collection | VERIFIED |
| Temperature and agitation | 37 degrees C; 750 rpm on a thermomixer for the serum/plasma incubation, rotator for whole blood | S2, Stability assay | VERIFIED |
| Sampling times | 0 and 60 min, with 0, 10 and 30 min for the fastest-degrading peptide; blood aliquots at 1 and 60 min (1, 10, 30 min for that peptide) | S2, Stability assay and Sample collection | VERIFIED |
| Quench | trichloroacetic acid to 3 percent w/v, 10 min on ice, centrifuge 12,000 x g for 5 min, neutralise supernatant with 1 mol/L NaOH, store at -20 degrees C | S2, Stability assay | VERIFIED |
| Quantification | RP-HPLC, C18, absorbance at 214 nm, peak area relative to the time-zero peak area; metabolites identified by LC-ESI-ion-trap MS | S2, Stability assay | VERIFIED |
| Replication | at least triplicate | S2, Stability assay | VERIFIED |
| Headline finding | the authors report that peptides generally degraded faster in serum than plasma, and were more stable in fresh blood than in either; the rank order among peptides changed between the six incubation conditions | S2, Abstract and Conclusion | VERIFIED |
| Practical recommendation | because fresh blood is impractical for routine work, they advise testing in both commercial serum and plasma, and interpreting against a protease-cleavage-site database (they name MEROPS) | S2, Conclusion | VERIFIED |

Short quotations from S2 (CC BY 4.0, attribution above): the authors describe their conclusion that proteolytic
degradation of peptide therapeutics "may often be misleading", and they advise interpretation that relies on
"database searches for potential cleavage sites".

**Implication for HOS.** `matrix` cannot be a free-text label. It needs at least: species, matrix type
(blood, serum, plasma), anticoagulant (none, K2-EDTA, lithium heparin), whether the serum was separator-tube
activated, and whether the material was freshly drawn or commercial pooled. A result without those is not
interpretable, so the ingest should reject it rather than default.

### 2.2 Human serum assay with a fitted half-life (S3)

| Parameter | Value as reported | Source location | Confidence |
|---|---|---|---|
| Matrix | human serum (commercial), mixed 1:1 v/v with a 1 mM aqueous peptide solution, giving roughly 0.5 mM peptide in 50 percent serum | S3, Serum stability of peptides | VERIFIED |
| Temperature | 37 degrees C with gentle shaking | same | VERIFIED |
| Sampling | 120 microlitre aliquots at several timepoints (schedule not enumerated in the methods text) | same | VERIFIED |
| Quench | 20 microlitres of 10 percent v/v trichloroacetic acid, 30 min at 4 degrees C, centrifuge 13,000 g for 10 min to remove serum proteins | same | VERIFIED |
| Quantification | analytical RP-HPLC and LC-MS; percent intact peptide by peak integration, expressed relative to time zero | same | VERIFIED |
| Fit | a one-phase exponential decay model (GraphPad Prism v7) to estimate t1/2; the figure legend reports 95 percent confidence intervals, mean of three experiments | S3, Serum stability of peptides and Figure legend | VERIFIED |

### 2.3 Diluted human serum assay with an explicit sampling schedule (S4)

| Parameter | Value as reported | Source location | Confidence |
|---|---|---|---|
| Matrix | 25 percent human male serum, pre-centrifuged at 13,000 rpm for 10 min to remove lipids, pre-incubated at 37 degrees C for at least 15 min | S4, Serum stability assay | VERIFIED |
| Peptide concentration | 5 micromolar final | same | VERIFIED |
| Sampling times | 0, 30, 75, 120, 240, 390 and 540 min (200 microlitre aliquots) | same | VERIFIED |
| Quench | 40 microlitres of 15 percent trichloroacetic acid, at least 15 min at 4 degrees C; for two peptides 5 microlitres of 1 M NaOH was added to the TCA to prevent peptide precipitation | same | VERIFIED |
| Quantification | RP-HPLC, C2/C18, absorbance at 215 nm, integration of the remaining soluble peptide | same | VERIFIED |
| Replication | triplicate | same | VERIFIED |
| Longest incubation | 24 h for the most stable peptides | S4, Stabilities in human serum | VERIFIED |

Note the practical point in S4: the TCA quench can co-precipitate basic peptides, which biases the measured
depletion. The driver's parameters should record the quench composition, and any base added to it.

### 2.4 Which matrices for which clearance route, and what the assay yields (S5)

S5 is a review by one of the Di & Kerns authors and is the closest openly readable substitute for S1. It states
that peptides can be incubated with biological matrices to evaluate stability, and that both kinetic information
and degradation products can be determined. Short quotation: the assay gives "in vitro intrinsic clearance and
half-life".

The matrices it lists, and the question each answers (paraphrased from S5, "Stability Assays"):

| Matrix | Question it answers |
|---|---|
| plasma, serum, whole blood | degradation in systemic circulation |
| simulated gastric and intestinal fluid, intestinal brush border membrane vesicles, intestinal microsomes or S9 | gastrointestinal stability and oral bioavailability |
| liver microsomes, S9, cytosol, hepatocytes | hepatic metabolism |
| kidney BBMV, microsomes or homogenates | renal degradation |
| tissue homogenates | tissue stability |
| assay media and formulation vehicles | whether the compound survives the assay itself |

S5 also states that LC-MS/MS is used to follow parent depletion and to characterise degradation products, and
that for peptides with poor stability, blood and plasma samples need stabilising on removal from the in vivo
system, with protease inhibitors added to collection tubes on wet ice. It notes that more than 550 putative
proteases are distributed through the body, and that cleavage sites are typically identified by LC-MS/MS rather
than assumed.

**Implication for HOS.** The driver should not be named or modelled as "plasma stability" alone. The matrix is a
parameter that selects which clearance route the result speaks to, and the interpretation text must not claim
systemic relevance from a liver or GI matrix.

### 2.5 Assay-variable sensitivity, small molecules (S6, abstract only)

The S6 abstract reports the variables examined (substrate concentration, percent DMSO, plasma concentration,
enzyme activity on incubation, batch variation) and the conditions the authors selected: 1 micromolar substrate,
2.5 percent DMSO, 50 percent dilution of plasma in pH 7.4 buffer. It also reports significant batch-to-batch
variation for rat plasma. **This was developed for small molecules, not peptides**, so it is background for the
parameter list, not a source of peptide assay conditions. The full text is NOT VERIFIED.

### 2.6 Regulatory context (S7, FDA draft guidance)

FDA's December 2023 draft states that peptides are generally metabolised by endopeptidases and then degraded to
amino acids by exopeptidases, that proteolytic degradation of many peptides is rapid and is not confined to the
organs usually associated with drug elimination, and that hepatic metabolism rarely plays a significant role in
peptide clearance. This supports treating plasma or serum depletion, not hepatic intrinsic clearance, as the
primary in vitro stability endpoint for peptides. It is a draft and therefore non-binding.

---

## 3. The depletion fit

| Item | Statement | Source | Confidence |
|---|---|---|---|
| Model named in S3 | one-phase exponential decay, fitted in GraphPad Prism v7 | S3 | VERIFIED |
| That model's equation | Y = (Y0 − Plateau)·exp(−K·X) + Plateau, where Y0 is the value at X = 0, Plateau is the value at infinite time, and K is the rate constant in reciprocal X units | S8 | VERIFIED |
| Half-life from that model | ln(2)/K | S8 | VERIFIED |
| First-order special case | with Plateau = 0 this reduces to C(t) = C0·exp(−k·t), which is the fit HOS already has | derived, not quoted | n/a |
| Normalisation used in S2, S3, S4 | percent of the time-zero peak area, by integration of the parent peak | S2, S3, S4 | VERIFIED |

**Design consequences.**
- Fit on the response normalised to the time-zero measurement, as all three primary papers do. Record the
  normalisation.
- Record which of the two models was used. If the two-parameter model is fitted, report the plateau with its
  confidence interval; a plateau significantly above zero means the peptide is not being fully degraded and a
  reported t1/2 of the whole curve is misleading.
- Report the t1/2 confidence interval (S3 does), not a bare point estimate.
- A half-life longer than the last sampled timepoint is an extrapolation. S2 states that one peptide had more
  than 96 percent remaining at 1 h in several matrices; fitting a half-life to that is not defensible. The driver
  should return a censored result ("greater than the last timepoint") rather than a fitted number.

---

## 4. What is still missing before this driver can be built

1. **A cross-species design.** None of S2 to S6 gives matched conditions across human, rat, dog, monkey and mouse
   plasma. Either find a primary source that does, or make species a declared parameter and state in the
   interpretation that between-species comparison is only valid when the conditions are identical.
2. **A protease panel.** The plan mentions "protease panels where designed". No source read here specifies one.
   S5 points at the MEROPS database for cleavage-site attribution, and S2 uses it for interpretation, but neither
   defines a panel of purified enzymes with concentrations. **NOT VERIFIED; do not build this part yet.**
3. **A known-value test case.** None of the open papers supplies a worked numeric example (raw timepoints plus
   the published t1/2) in its text that I could extract; the values live in figures. Options: digitise from a
   CC BY figure and state that provenance, or use an exact synthetic case with an analytical solution, which
   build plan §5 item 4 explicitly allows.
4. **Di & Kerns 2016 text.** Someone with the book should confirm or replace it as the method basis.

---

## NOT VERIFIED

- Di & Kerns 2016, both chapters: publisher access blocked. Citation only.
- Di 2005 full text: paywalled; abstract only.
- Any cross-species matched-condition peptide stability dataset.
- Any defined protease panel for peptide stability.

## Citations to register

| id (proposed) | Citation | Accessed | Notes |
|---|---|---|---|
| di_kerns.2016.plasma_stability | Di L, Kerns EH. Plasma Stability. In: *Drug-Like Properties*, 2nd ed. Elsevier; 2016:195-206. doi:10.1016/B978-0-12-801076-1.00012-5 | citation only, 2026-10-11 | Text not read. Do not use for values. |
| di_kerns.2016.plasma_stability_methods | Di L, Kerns EH. Plasma Stability Methods. In: *Drug-Like Properties*, 2nd ed. Elsevier; 2016:387-392. doi:10.1016/B978-0-12-801076-1.00030-7 | citation only, 2026-10-11 | Text not read. |
| bottger.2017.peptide_matrix_stability | Böttger R, Hoffmann R, Knappe D. *PLoS One.* 2017;12(6):e0178943. doi:10.1371/journal.pone.0178943 | 2026-10-11 | CC BY 4.0. Matrix and anticoagulant effects. |
| cavaco.2021.serum_half_life | Cavaco M, et al. *Clin Transl Sci.* 2021;14(4):1349-1358. doi:10.1111/cts.12985 | 2026-10-11 | Human serum method; one-phase decay fit. |
| nguyen.2010.serum_stability | Nguyen LT, et al. *PLoS One.* 2010;5(9):e12684. doi:10.1371/journal.pone.0012684 | 2026-10-11 | CC BY 4.0. Sampling schedule. |
| di.2015.peptide_adme | Di L. *AAPS J.* 2015;17(1):134-143. doi:10.1208/s12248-014-9687-3 | 2026-10-11 | Matrix-to-question mapping. |
| di.2005.plasma_stability_assay | Di L, Kerns EH, Hong Y, Chen H. *Int J Pharm.* 2005;297(1-2):110-119. doi:10.1016/j.ijpharm.2005.03.022 | abstract only, 2026-10-11 | Small molecules. |
| fda.guidance.peptide_clinpharm.draft_2023 | FDA CDER. *Clinical Pharmacology Considerations for Peptide Drug Products.* Draft, December 2023 | 2026-10-11 | Also registered in `docs/research/peptide_routing.md`. |
| graphpad.one_phase_decay | GraphPad Software. "Equation: One phase decay", Prism 11 Curve Fitting Guide | 2026-10-11 | Model form and ln(2)/K. Vendor doc, not a scientific primary source. |

---

## Implementation record (driver `peptide_stability` v1.0.0, 2026-10-11)

- **Sources.**
  - Di & Kerns 2016 is not cited for any content. The method basis is the openly read papers
    (S2–S5), the FDA draft (S7), and the GraphPad equation page (S8).
  - I re-read S8 on 2026-10-11 at
    https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_exponential_decay_1phase.htm. It gives
    "Y=(Y0 - Plateau)*exp(-K*X) + Plateau" and half-life "ln(2)/K".
- **Decisions.**
  - **Scope.** Systemic matrices only: whole blood, serum and plasma, the matrices used in S2–S4. GI, hepatic
    and renal matrices (S5's other rows) are not built.
  - **Required facts.** Every matrix fact in section 2.1 is a required parameter.
  - **Fit model.** The model is the protocol's declared choice. Under first order, the one-phase plateau is
    checked, and it is flagged only when a half-life is reported. Censoring follows section 3.
  - **Below the quantitation limit.** Such samples are excluded, never set to zero.
  - **Species comparison.** Stated only for conditions that differ in species alone (section 4, item 1).
  - **Protease panel.** Not built (section 4, item 2).
- **Requirement.** For peptides, `adme.metabolic_stability` is named "proteolysis in blood, serum or plasma"
  and defaults to this driver. The microsomal driver remains for small molecules.
- **Known-value tests.** They use exact synthetic curves with analytical solutions (section 4, item 3), in
  `tests/core/test_peptide_stability.py` (8) and `tests/drivers/test_peptide_stability.py` (9).
