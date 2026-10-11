# Driver research note — `in_vitro_potency` (pharm.primary, Wave A7)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A7: ICH M3(R2) section 2.
Analysis named: 4PL potency, selectivity ratios against off-targets.

Confidence labels: **verified-from-primary** (exact wording read this session); **verified-bibliographic**
(citation confirmed via Crossref/PubMed, content not read); **secondary-reproduction**; **NOT VERIFIED**.

## Primary documents read

| Document | Copy read | Header as printed | SHA-256 |
|---|---|---|---|
| ICH M3(R2) | `https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf` | "Current Step 4 version dated 11 June 2009" | `da8bc18c11d224d23b2b3c391a32e5aa87fd49fbdc6bf515c9787bb4c41f8552` |
| ICH S7A | `https://database.ich.org/sites/default/files/S7A_Guideline.pdf` | "Current Step 4 version dated 8 November 2000" | `947d857b03e883af54a8c625332df576d181d0f005ffa5d60f7fc42f7d498cea` |
| ICH S7B | `https://database.ich.org/sites/default/files/S7B_Guideline.pdf` | "Current Step 4 version dated 12 May 2005" | `d01c5ae5ec94d9f310e58c6f73a6b85309d6d816265b11332becb6d580a087bb` |
| Ritz C, Baty F, Streibig JC, Gerhard D. *Dose-Response Analysis Using R.* PLoS One 2015 | Europe PMC full-text XML, PMC4696819 (open access) | — | (XML) |

## Regulatory framing (what is primary / secondary pharmacodynamics)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Primary PD — purpose and GLP status | Mode of action / effects at the desired target; discovery phase; generally not GLP; contributes to dose selection | M3(R2) §2, p.5 | "In addition, primary PD studies (in vivo and/or in vitro) are intended to investigate the mode of action and/or effects of a substance in relation to its desired therapeutic target. Such studies are generally conducted during the discovery phase of pharmaceutical development and as such, are not generally conducted in accordance with Good Laboratory Practices (GLP)." | verified-from-primary |
| Primary PD — use | Can contribute to nonclinical and clinical dose selection | M3(R2) §2, p.5 | "These studies can contribute to dose selection for both nonclinical and clinical studies." | verified-from-primary |
| Definitions deferred to S7A | M3(R2) defines safety pharmacology and PD by reference to S7A | M3(R2) §2, p.5 | "Safety pharmacology and pharmacodynamic (PD) studies are defined in ICH S7A (Ref. 5)." | verified-from-primary |
| Primary vs secondary PD definitions | Primary = at the desired target; secondary = not related to the desired target | S7A Note 2, p.8 | "Studies on the mode of action and/or effects of a substance in relation to its desired therapeutic target are primary pharmacodynamic studies. Studies on the mode of action and/or effects of a substance not related to its desired therapeutic target are secondary pharmacodynamic studies (these have sometimes been referred to as part of general pharmacology studies)." | verified-from-primary |
| Off-target binding data as a trigger | Ligand-binding / enzyme data suggesting adverse potential is a factor in selecting safety pharmacology studies | S7A §2.2 item 3, p.2 | "3) Ligand binding or enzyme assay data suggesting a potential for adverse effects;" | verified-from-primary |
| GLP status of secondary PD | Generally non-GLP; GLP if pivotal to the safety evaluation | S7A §2.11, p.7–8 | "Generally, secondary pharmacodynamic studies do not need to be conducted in compliance with GLP." | verified-from-primary |
| Comparison of adverse vs primary-PD doses (closest regulatory statement to a margin/ratio) | Doses eliciting an adverse effect should be compared with doses eliciting the primary PD effect, if feasible | S7A §2.4.1, p.4 | "Generally, the doses eliciting the adverse effect should be compared to the doses eliciting the primary pharmacodynamic effect in the test species or the proposed therapeutic effect in humans, if feasible." | verified-from-primary |
| Same concept in S7B integrated risk assessment | Relationship between exposures affecting repolarisation and those eliciting the primary PD effect | S7B §2.3.6, p.6 | "Relationship between the exposures associated with an effect on repolarization and those eliciting the primary pharmacodynamic effect in the non-clinical test species or the proposed therapeutic effect in humans;" | verified-from-primary |

## Concentration–response (4PL) and potency ratio — method sources

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Four-parameter log-logistic model | f(x,(b,c,d,e)) = c + (d − c) / (1 + exp(b(log(x) − log(e)))) — b slope, c lower and d upper asymptote, e = ED50 | Ritz et al. 2015, PLoS One 10(12):e0146021, DOI 10.1371/journal.pone.0146021, "Model functions" section, Eq (2) (equation read from the MathML of the PMC XML) | "The four-parameter log-logistic model corresponds to the model function:" (parameter meanings paraphrased from the same section) | verified-from-primary (methods paper; open access) |
| Equivalence to the form implemented in `hos/core/pharmacology.py` | `bottom + (top − bottom)/(1 + (C/IC50)^h)` is the same function with c = bottom, d = top, e = IC50 and **b = h**, since exp(b(log x − log e)) = (x/e)^b. **Correction (implementation, 2026-10-11):** this row previously said b = −h, which holds only for the form `(IC50/C)^h` that `docs/04` §4.5 had written; the code uses `(C/IC50)^h`. A known-value test now asserts the identity. | Algebraic identity (no citation needed beyond Ritz Eq 2) | — | derived (exact) |
| DeLean, Munson & Rodbard 1978 (the citation currently in `docs/04` §4.5) | Bibliographic record confirmed; describes simultaneous fitting of sigmoidal families in terms of basal, maximal, ED50 and steepness | Am J Physiol 1978;235(2):E97–E102; DOI 10.1152/ajpendo.1978.235.2.E97; PMID 686171 (abstract via Europe PMC) | "in terms of basal and maximal responses, ED50, and curve shape or steepness" | verified-bibliographic + abstract; **the equation itself was not read from DeLean** (closed access) |
| **Ratio of effective doses / relative potency / "selectivity index"** | ρ(α1, α2) = ED_A(100α1) / ED_B(100α2), 0 < α1, α2 < 1; for α1 = α2 it is the **relative potency**; "selectivity index" is noted as an alternative term | Ritz et al. 2015, "Effective doses" / ED-ratio passage (equation after Eq 10; cites Finney 1971 [11] and Christensen et al. 2003 [48]) | "the ratio is referred to as the relative potency" … "The term selectivity index is also sometimes used" | verified-from-primary — **but** this is a general dose-response statistics source (two curves, same or different substances), not a pharmacology guideline. Applying it to "off-target IC50 / on-target IC50 for one compound" is a reasonable but *derived* use; label it so. |
| Non-parallel curves | Relative potency is constant across α only under parallelism; otherwise it changes with α | Ritz et al. 2015, same passage | paraphrased: under "parallelism" the relative potency is the same at every effect level | verified-from-primary |
| Uncertainty on the ratio | Delta-method SEs by default; Fieller intervals available | Ritz et al. 2015, same section | paraphrased: delta-method standard errors by default; Fieller intervals optional | verified-from-primary |

## Selectivity ratio — answer to the brief

**No regulatory primary source (ICH M3(R2), S7A, S7B, E14/S7B Q&A) defines a "selectivity ratio"
(off-target IC50 / on-target IC50).** Searched all four ICH texts for "selectiv", "off-target", "off target":
the only hits are the S7B Q&A's use of "selective blocker" in hERG assay QC, unrelated to compound selectivity.
The closest regulatory concept is S7A §2.4.1 / S7B §2.3.6 (compare doses/exposures for adverse vs primary-PD
effects).

The only citable *definition* of the ratio found in this session is the ED-ratio / relative-potency
definition in Ritz et al. 2015 (above), which itself notes the term "selectivity index". IUPHAR's
terminology paper (Neubig RR et al. *Pharmacol Rev* 2003;55(4):597–606, DOI 10.1124/pr.55.4.4,
verified-bibliographic) could not be read (closed; publisher 403), so whether it defines selectivity is
**NOT VERIFIED**. The Cheng–Prusoff IC50→Ki relationship (which matters if ratios of IC50s from assays at
different substrate/radioligand concentrations are compared) was **not** read: Cheng Y, Prusoff WH,
*Biochem Pharmacol* 1973, DOI 10.1016/0006-2952(73)90196-2, closed access — NOT VERIFIED.

## Implications for the driver

- Use the 4PL as already specified in `docs/04` §4.5; register Ritz et al. 2015 Eq (2) as the readable,
  open-access statement of the model (keep DeLean 1978 as the historical citation, bibliographic only).
- Compute selectivity as a **ratio of fitted potencies with propagated uncertainty**, labelled
  "relative potency (ratio of IC50s), Ritz et al. 2015", and record the α level (50 %) and both assays'
  conditions. Never apply a pass/fail selectivity threshold — no source sets one.
- Flag non-parallel curves (Hill slopes differ) because the ratio then depends on the effect level.
- Comparing IC50s from assays with different substrate/ligand concentrations is not justified without a
  Ki conversion whose source (Cheng–Prusoff) is NOT VERIFIED here; the driver should refuse or flag.

## Citations to register

1. ICH (2009). *M3(R2): Guidance on Nonclinical Safety Studies for the Conduct of Human Clinical Trials and Marketing Authorization for Pharmaceuticals.* Step 4, 11 June 2009. Section 2. https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf
2. ICH (2000). *S7A: Safety Pharmacology Studies for Human Pharmaceuticals.* Step 4, 8 November 2000. Sections 2.2, 2.4.1, Note 2. https://database.ich.org/sites/default/files/S7A_Guideline.pdf
3. Ritz C, Baty F, Streibig JC, Gerhard D. Dose-Response Analysis Using R. *PLoS One.* 2015;10(12):e0146021. DOI: 10.1371/journal.pone.0146021 (PMCID PMC4696819).
4. DeLean A, Munson PJ, Rodbard D. Simultaneous analysis of families of sigmoidal curves: application to bioassay, radioligand assay, and physiological dose-response curves. *Am J Physiol.* 1978;235(2):E97–E102. DOI: 10.1152/ajpendo.1978.235.2.E97 *(bibliographic + abstract only)*.

## Implementation record (driver `in_vitro_potency` v1.0.0, 2026-10-11)

- **Ritz 2015 verified on Crossref.** "Dose-Response Analysis Using R", PLOS ONE 10(12):e0146021,
  2015-12-30, authors Ritz, Baty, Streibig, Gerhard.
- **Model identity corrected.** See the correction above. The implemented 4PL is Ritz Eq. 2 with
  b = hill, asserted by a known-value test. `docs/04` §4.5 had written the inverse form; it is
  now corrected.
- **Existing hERG method left unchanged.** `pharm.hill_4pl` still cites DeLean 1978 only.
  Adding Ritz 2015 to it would change every hERG analysis hash (see the registry lock).
  Ritz 2015 is cited by the new `pharm.relative_potency`.
- **Not built.**
  - Cheng–Prusoff Ki conversion (NOT VERIFIED).
  - Parallelism tests between curves.
  - Fieller intervals.
