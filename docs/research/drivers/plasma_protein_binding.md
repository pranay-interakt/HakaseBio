# Driver research note — `plasma_protein_binding` (adme.plasma_protein_binding, Wave A4)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A4: equilibrium dialysis
(Waters et al. 2008 J Pharm Sci *(verify)*); fu = buffer/plasma; recovery and stability QC.

Confidence labels: **verified-from-primary** (exact wording read in the primary document this session;
"(abstract)" when only the abstract was read); **verified-bibliographic** (citation confirmed, content
not read); **secondary-reproduction** (read in a source that is not the originating document — here the
device manufacturer's instructions and open-access methods sections); **NOT VERIFIED**.

For copyrighted journal abstracts and the manufacturer's guide only short fragments are quoted and the
rest is paraphrased; ICH text is quoted in full sentences; CC BY text is quoted with attribution.

## Documents read

| Document | Copy read | Header / version | SHA-256 of the PDF read |
|---|---|---|---|
| Waters et al. 2008, *J Pharm Sci* 97(10):4586–4595 | Crossref record `https://api.crossref.org/works/10.1002/jps.21317`; abstract from Europe PMC (PMID 18300299). Full text **closed**: ScienceDirect `pii/S0022354916327356` returned HTTP 403; OpenAlex `oa_status: closed`, no repository copy. | — | — |
| ICH M3(R2) | `https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf` | "Current Step 4 version dated 11 June 2009" | `da8bc18c11d224d23b2b3c391a32e5aa87fd49fbdc6bf515c9787bb4c41f8552` |
| ICH M12 *Drug Interaction Studies* | `https://database.ich.org/sites/default/files/ICH_M12_Step4_Guideline_2024_0521.pdf` (74 pp.) | "Final version Adopted on 21 May 2024" | `ff0624ed9f587b1162af6d2e2d55ff4b83541b831834d5532f292951916397ce` |
| Thermo Scientific *Pierce RED Device Inserts User Guide*, Pub. No. MAN0011571 Rev. C.0 (16 June 2023) | `https://assets.thermofisher.com/TFS-Assets/LSG/manuals/MAN0011571_RED_Device_Insert_UG.pdf` | "Catalog Numbers 89809, 89810"; revision history C.0 16 June 2023 | `602fcf0493df85590a26f8647ece2a0585ee948e2ae36724281f55649a58c94a` |
| Di et al. 2012, Di et al. 2017, Ryu et al. 2019 (*J Pharm Sci*) | Europe PMC abstracts | — | — |
| Wernevik et al. 2020, *Assay Drug Dev Technol* 18(4):157–179 (CC BY 4.0) | Europe PMC full text PMC7567642 | — | — |

## 1. Waters et al. 2008 — identity and what the abstract states

| Parameter | Value | Source | Verbatim quote | Confidence |
|---|---|---|---|---|
| Citation | Waters NJ, Jones R, Williams G, Sohal B. Validation of a rapid equilibrium dialysis approach for the measurement of plasma protein binding. *J Pharm Sci.* 2008 Oct;97(10):4586–4595. | Crossref (authors Nigel J. Waters, Rachel Jones, Gareth Williams, Bindi Sohal; vol 97, issue 10, pp. 4586–4595, issued 2008-10; ISSN 0022-3549; current publisher of record Elsevier BV); PMID 18300299 | Crossref title: "Validation of a Rapid Equilibrium Dialysis Approach for the Measurement of Plasma Protein Binding" | verified-bibliographic |
| DOI | **10.1002/jps.21317** | Crossref | — | verified-bibliographic |
| Problem addressed | Conventional ED needs 6–24 h to equilibrate, long preparation, hard to automate | Abstract | "varying between 6 and 24 h" | verified-from-primary (abstract) |
| Device | Commercial RED device (Pierce/Thermo Fisher): Teflon base plate holding up to 48 disposable cells; two side-by-side chambers separated by a vertical cylinder of dialysis membrane with high surface-to-volume ratio | Abstract | Paraphrased. | verified-from-primary (abstract) |
| Validation design | Comparison with standard ED for equilibration time, reproducibility, accuracy and ease of use; **18** commercially available drugs; **human** plasma | Abstract | Paraphrased. | verified-from-primary (abstract) |
| Conclusion | Robust and accurate; shorter preparation and dialysis time; automatable | Abstract | Paraphrased. | verified-from-primary (abstract) |
| fu equation as written by Waters et al. | — | Full text | — | **NOT VERIFIED** (closed) |
| % recovery equation | — | Full text | — | **NOT VERIFIED** |
| Stability assessment and its equation | — | Full text | — | **NOT VERIFIED** |
| Incubation time, temperature, agitation, CO₂, compound concentration, buffer, volumes | — | Full text (abstract gives none of these) | — | **NOT VERIFIED** |
| The 18 drugs and their fu values (candidate known-value test set) | — | Full text | — | **NOT VERIFIED** |

## 2. Regulatory basis and acceptance expectations

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| PPB before first-in-human | In vitro PPB for animals and humans generally before human trials | ICH M3(R2) §3, printed p.5 | "In vitro metabolic and plasma protein binding data for animals and humans and systemic exposure data (ICH S3A, Ref. 7) in the species used for repeated-dose toxicity studies generally should be evaluated before initiating human clinical trials." | verified-from-primary |
| Use of measured fu,p < 1% | Allowed if accuracy and precision of the PPB measurement are demonstrated, incl. positive controls; otherwise use fu,p = 0.01 | ICH M12 §2.1.2.1, printed p.5 | "If the reliability of fu,p measurements <1% cannot be demonstrated, a default value of 1% unbound fraction in plasma (i.e., fu,p= 0.01) should be used (see Section 7.2 for details)." | verified-from-primary |
| Assay qualification | Validation data with positive controls (compounds highly bound to relevant plasma proteins) | ICH M12 §7.2, printed p.38 | "Such a demonstration should include validation data of the protein binding assay qualified with appropriate positive controls (i.e., range of compounds with high binding to relevant plasma proteins)." | verified-from-primary |
| Bioanalytical precision/accuracy | Calibrators and QCs at 15%; LLOQ at 20% | ICH M12 §7.2, printed p.38 | "The bioanalytical methods used in these experiments should have appropriate precision and accuracy at the required sensitivity range (i.e., Calibration standards and Quality Controls at 15%; Lower Limit of Quantification at 20%)." | verified-from-primary |
| New methodologies | Qualify against an established orthogonal method | ICH M12 §7.2, printed p.38 | "When novel and emerging protein binding assay methodologies are being established, the assay method should be qualified against an orthogonal method that is previously established and accepted for a range of highly bound compounds (22)." | verified-from-primary |
| **In-study positive control acceptance** | Positive control fu,p within **3-fold** of the mean value from assay qualification | ICH M12 §7.2, printed p.38 | "Of note, the protein binding experiments for the investigational drug should always include a positive control for which the assay was previously qualified to ensure in-study performance. The positive control should be demonstrated to be within 3-fold of the mean fu,p value that was previously reported with the qualification of the protein binding assay method." | verified-from-primary |
| M12 supporting references | Ref 21: Di L et al. 2017 *J Pharm Sci* 106(12):3442–3452; Ref 22: Ryu S et al. 2019 *J Pharm Sci* 108(11):3745–3749 | ICH M12 §8 References, printed p.66 | — | verified-from-primary (reference list) |

Note: M12 is a **clinical DDI** guideline; its PPB expectations are the only current ICH text on PPB
assay quality found in this session. M3(R2) requires PPB data but says nothing about method or QC.

## 3. Equilibrium-dialysis calculations and conditions — sources actually read

| Parameter | Value | Source | Quote / evidence | Confidence |
|---|---|---|---|---|
| **fu (fraction free)** | % Free = (C_buffer chamber / C_plasma chamber) × 100%; fu = C_buffer/C_plasma | Thermo RED user guide MAN0011571 Rev. C.0, "Analyze samples" step 7, p.3 | Formula as printed: "% Free = (Concentration buffer chamber/Concentration plasma chamber) x 100%" | secondary-reproduction (manufacturer's instructions; Waters' own wording NOT VERIFIED) |
| % Bound | 100% − % Free | Thermo guide, p.3 | "% Bound = 100% – % Free" | secondary-reproduction |
| Matrix matching before LC-MS/MS | Add blank plasma to buffer aliquots and buffer to plasma aliquots (equal volumes) | Thermo guide, "Analyze samples" step 2, p.3 | Paraphrased. | secondary-reproduction |
| Incubation (manufacturer) | 37 °C, ~250 rpm orbital (or ~20 rpm up-and-down); ~4 h generally sufficient but equilibrium time should be determined empirically | Thermo guide, "Perform equilibrium dialysis" step 5, p.2 | Fragment: "perform preliminary tests to empirically determine the time required to reach equilibrium" | secondary-reproduction |
| Over-long incubation | ≥ 18 h can promote instability or plasma volume increase | Thermo guide, step 5 note, p.2 | Paraphrased. | secondary-reproduction |
| Chamber volumes (manufacturer table) | Sample 50–500 µL with paired buffer 300–750 µL (e.g. 200 µL : 400 µL; 300 µL : 550 µL) | Thermo guide, step 4 table, p.2 | Table values transcribed. | secondary-reproduction |
| Replication (manufacturer) | Triplicate recommended | Thermo guide, step 1, p.2 | Paraphrased. | secondary-reproduction |
| Membrane | MWCO approximately 8,000 | Thermo guide, Product description, p.1 | Paraphrased. | secondary-reproduction |
| Example dialysis buffer | PBS: 100 mM sodium phosphate, 150 mM sodium chloride | Thermo guide, Required materials, p.1 | Paraphrased (an example, not a requirement). | secondary-reproduction |
| Recovery (mass balance) and plasma stability as QC (one company's practice) | Stability and recovery samples taken at 0 h and end of incubation (18 h); fu reported only if both recovery and stability > 50% | Wernevik J et al. *Assay Drug Dev Technol* 2020;18(4):157–179, PMC7567642 (CC BY 4.0), PPB method | "The fu values are therefore only reported as aggregated data when both recovery and stability are >50%." | secondary-reproduction (**single-laboratory convention, not a standard**) |
| Role of recovery as an acceptance criterion | When equilibrium is established, low recovery from nonspecific binding did not affect fu; using recovery as an acceptance criterion was judged too restrictive | Di L, Umland JP, Trapa PE, Maurer TS. *J Pharm Sci* 2012;101(3):1327–1335, abstract. DOI 10.1002/jps.23013 | Paraphrased from abstract. | verified-from-primary (abstract) |
| Measurability of fu ≤ 0.01 | Cross-company data: fu ≤ 0.01 can be determined accurately with appropriate methods | Di L et al. *J Pharm Sci* 2017;106(12):3442–3452, abstract (M12 ref 21). DOI 10.1016/j.xphs.2017.09.005 | Paraphrased from abstract. | verified-from-primary (abstract) |
| Orthogonal agreement | Equilibrium dialysis vs ultracentrifugation for 10 highly bound drugs: generally within 2-fold | Ryu S et al. *J Pharm Sci* 2019;108(11):3745–3749, abstract (M12 ref 22). DOI 10.1016/j.xphs.2019.08.004 | Paraphrased from abstract. | verified-from-primary (abstract) |
| **% recovery equation** | Not verified from any primary or consensus source. Wernevik 2020 describes recovery as "mass balance" without giving the formula. One open-access paper read (Lee MS et al., *Sci Rep* 2026, PMC13243497) prints a recovery equation whose volume terms could not be reconciled with the chamber volumes stated in its own Methods — so no published example is adopted here. | — | — | **NOT VERIFIED** |
| **Stability equation** | Not verified from any source read | — | — | **NOT VERIFIED** |

Observed spread of incubation conditions in the sources read (illustrating that these are design inputs,
not constants): Thermo guide ~4 h at 37 °C; Wernevik 2020 18 h at 37 °C, 5% CO₂; an OA rat/human ADME
paper (PMC12151198) 6 h at 37 °C, 5% CO₂.

## Implications for the driver (no scientific defaults)

- **fu = C_buffer / C_plasma** after equilibrium is citable today to the RED manufacturer's instructions
  (secondary). Cite Waters 2008 for the validation of the RED approach (bibliographic + abstract) — not
  for the equation, until the Methods are transcribed.
- Required inputs with stated basis: incubation time (and evidence that equilibrium was reached),
  temperature, agitation, CO₂/pH control, test concentration, plasma and buffer volumes, species/matrix
  and anticoagulant, replicate number.
- **Recovery and stability**: compute only from explicit, volume-aware inputs the user declares; the
  formulas and any acceptance threshold are **unverified** — treat any threshold as a user-declared
  criterion with its basis (e.g. a lab SOP), and report Di 2012's caution that recovery need not gate fu
  when equilibrium is shown.
- **Positive control**: M12 §7.2 gives a citable in-study rule (positive control fu within 3-fold of the
  qualified mean). The qualified mean is a required input from the lab's qualification data.
- **fu < 0.01**: flag; M12 requires demonstrated reliability (qualification with highly bound positive
  controls) before the measured value may be used for DDI predictions, otherwise 0.01. Whether the
  lab's qualification is adequate is a judgement — route it, do not decide it.
- Bioanalysis for buffer and plasma samples: M12 cites 15%/20% precision/accuracy (links to A1).

## Items NOT VERIFIED

1. Waters et al. 2008 full text: fu, recovery and stability equations; incubation time/temperature/
   agitation; compound concentration; volumes; the 18-drug data set (closed access).
2. Any primary or consensus formula for % recovery (mass balance) or % stability in equilibrium dialysis.
3. Any primary or consensus numeric acceptance criterion for recovery or stability (the > 50% rule is a
   single company's practice).
4. Volume-shift correction for equilibrium dialysis — not researched.
5. Full texts of Di 2012, Di 2017, Ryu 2019 (abstracts only).

## Citations to register

1. Waters NJ, Jones R, Williams G, Sohal B. Validation of a rapid equilibrium dialysis approach for the measurement of plasma protein binding. *J Pharm Sci.* 2008;97(10):4586–4595. DOI: 10.1002/jps.21317. PMID 18300299. *(bibliographic + abstract only)*
2. ICH. *M3(R2): Guidance on Nonclinical Safety Studies for the Conduct of Human Clinical Trials and Marketing Authorization for Pharmaceuticals.* Step 4, 11 June 2009. Section 3. https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf
3. ICH. *M12: Drug Interaction Studies.* Final version, adopted 21 May 2024. Sections 2.1.2.1 and 7.2. https://database.ich.org/sites/default/files/ICH_M12_Step4_Guideline_2024_0521.pdf
4. Thermo Fisher Scientific. *Pierce RED Device Inserts User Guide* (Cat. 89809, 89810), Pub. No. MAN0011571, Rev. C.0, 16 June 2023. https://assets.thermofisher.com/TFS-Assets/LSG/manuals/MAN0011571_RED_Device_Insert_UG.pdf *(manufacturer instructions — secondary)*
5. Di L, Umland JP, Trapa PE, Maurer TS. Impact of recovery on fraction unbound using equilibrium dialysis. *J Pharm Sci.* 2012;101(3):1327–1335. DOI: 10.1002/jps.23013. PMID 22161810. *(abstract only)*
6. Di L, Breen C, Chambers R, Eckley ST, Fricke R, Ghosh A, Harradine P, Kalvass JC, Ho S, Lee CA, Marathe P, Perkins EJ, Qian M, Tse S, Yan Z, Zamek-Gliszczynski MJ. Industry perspective on contemporary protein-binding methodologies: considerations for regulatory drug-drug interaction and related guidelines on highly bound drugs. *J Pharm Sci.* 2017;106(12):3442–3452. DOI: 10.1016/j.xphs.2017.09.005. PMID 28927987. *(abstract only; ICH M12 ref 21)*
7. Ryu S, Riccardi K, Patel R, Zueva L, Burchett W, Di L. Applying two orthogonal methods to assess accuracy of plasma protein binding measurements for highly bound compounds. *J Pharm Sci.* 2019;108(11):3745–3749. DOI: 10.1016/j.xphs.2019.08.004. PMID 31419399. *(abstract only; ICH M12 ref 22)*
8. Wernevik J, Bergström F, Novén A, Hulthe J, Fredlund L, Addison D, Holmgren J, Strömstedt PE, Rehnström E, Lundbäck T. A fully integrated assay panel for early drug metabolism and pharmacokinetics profiling. *Assay Drug Dev Technol.* 2020;18(4):157–179. DOI: 10.1089/adt.2020.970. PMC7567642. *(secondary — single-laboratory QC convention)*

## Implementation record (driver `plasma_protein_binding` v1.0.0, 2026-10-11)

- **M12 rules re-checked against the official PDF.** SHA-256
  `ff0624ed…397ce`, matching the hash above.
  - §2.1.2.1: "If the reliability of fu,p measurements <1% cannot be demonstrated, a default value
    of 1% unbound fraction in plasma (i.e., fu,p= 0.01) should be used".
  - §7.2: "The positive control should be demonstrated to be within 3-fold of the mean fu,p value
    that was previously reported with the qualification of the protein binding assay method."
- **Citations verified on Crossref this session.** Waters 2008 (10.1002/jps.21317), Di 2012
  (10.1002/jps.23013), Di 2017 (10.1016/j.xphs.2017.09.005), Ryu 2019 (10.1016/j.xphs.2019.08.004).
- **Decisions.**
  - Recovery and stability are not computed (items 2–3 above remain NOT VERIFIED). The
    laboratory's values are checked only against criteria stated in the protocol with their
    basis.
  - The measured fu < 1% is never replaced by 0.01. It is flagged, and the reliability question
    goes to the responsible scientist.
  - The M12 3-fold rule applies to every species with a declared positive control. M12 itself
    addresses human plasma.
  - There is no volume-shift correction (item 4 remains open).
