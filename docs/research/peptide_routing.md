# Peptide regulatory routing (build plan Wave P, item P-1): primary-source verification

Checked on 2026-10-11. No repository file other than this note was edited.

Status words: **VERIFIED** means the primary text was read and quoted. **NOT VERIFIED** gives the reason.
**WRONG** means the primary source contradicts what the plan states.

---

## 0. Headline findings

1. **The plan's citation is WRONG.** Build plan P-1 says "FDA definition of a peptide in 21 CFR 314.3: 40 or fewer
   amino acids". The current 21 CFR 314.3 contains **no definition of "peptide"**, and no occurrence of
   "peptide", "amino acid" or "protein" at all. eCFR full-text search of Title 21 for "peptide means" returns
   **0** results. The 40-amino-acid line is in **21 CFR 600.3(h)(6)**. That provision defines **"protein"** (greater
   than 40 amino acids) for the purposes of the term "biological product". It does not define "peptide".
2. **Where "peptide = 40 or fewer amino acids" appears in FDA text:**
   - **21 CFR 601.2(a)**, as a product category: "Therapeutic synthetic peptide products of 40 or fewer amino
     acids". This is regulation, but a category label in the BLA-filing procedures, not a definition.
   - **FDA draft guidance**, *Clinical Pharmacology Considerations for Peptide Drug Products* (December 2023,
     draft, "Not for implementation"): "The term peptide, for purposes of this guidance, refers to any polymer
     composed of 40 or fewer amino acids." This is a guidance-scoped definition from a draft, so it is non-binding.
3. **How to count amino acids is regulatory text** (600.3(h)(6)). When chains are "associated with each other in
   a manner that occurs in nature", the count is the **total** across chains. FDA's worked example is insulin:
   21 + 30 = 51 amino acids, so insulin is a protein. `amino_acid_count` in `ProgramContext` therefore needs the
   chain structure, not just the longest chain.
4. **ICH does not use a 40-amino-acid line.** ICH S6(R1) §1.3 scopes by *biotechnology origin* (products from
   characterised cells and expression systems). Its active substances "include proteins and peptides". It says
   its principles "may also be applicable to … chemically synthesised peptides". ICH M3(R2) never uses the word
   "peptide". It defers biotechnology-derived products to S6 for study design and keeps only the timing of
   nonclinical studies. So "40 or fewer goes to M3(R2), more than 40 goes to S6(R1)" is **not an ICH rule**. It
   combines a US legal classification (drug vs biological product) with an ICH scope decision. See section 4 for
   how to encode this honestly.

---

## 1. 21 CFR 314.3 (current text)

Source: eCFR Versioner API.
`https://www.ecfr.gov/api/versioner/v1/full/2026-10-06/title-21.xml?part=314&section=314.3`
The API requires `Accept-Encoding` compression. Title 21 status per the API: `latest_amended_on 2026-10-06`,
`up_to_date_as_of 2026-10-07`. SHA-256 of the response: `47630e23…11c7`.

Content versions of §314.3 listed by the API: `2016-12-23` and `2026-09-22`. I read both the 2026-09-21 text
(which is the 2016-12-23 version) and the current text. The only difference is one inserted line:
"Link to an amendment published at 91 FR 60003, Sept. 22, 2026."

| Claim | Source | Verbatim / result | Confidence |
|---|---|---|---|
| §314.3 defines "peptide" | 21 CFR 314.3 (current and the 2016-12-23 version) | **No match.** A case-insensitive search of the full section text for "eptide", "amino acid" and "rotein" returns zero hits. | VERIFIED absent. The plan citation is **WRONG**. |
| eCFR Title 21 contains the phrase "peptide means" | eCFR Search API, `query="peptide means"`, `hierarchy[title]=21` | `total_count 0` | VERIFIED |
| §314.3 scope | 21 CFR 314.3(b) | "The following definitions of terms apply to this part and part 320 of this chapter" | VERIFIED |
| Pending amendment to §314.3 | Federal Register API: doc 2026-19350, "Nonclinical Testing Terminology", direct final rule, 91 FR 59988 (pp. 59988-60004), published 2026-09-22, **effective 2027-02-04** | Abstract: it "substitutes references to "animal" tests or studies with "nonclinical" tests or studies, adds a definition of the terms "nonclinical test" and "nonclinical study,"". A companion proposed rule is doc 2026-19349. | VERIFIED (abstract only). I did not read the amendatory text. The abstract does not mention peptides. |

---

## 2. Definition of "protein": 21 CFR 600.3(h)(6)

Source: eCFR Versioner API, `.../full/2026-10-06/title-21.xml?part=600&section=600.3`. SHA-256 `3f7f265e…6dd4`.
Content versions: 2016-11-29, 2020-02-21, 2020-03-24.

| Item | Verbatim (current eCFR) | Confidence |
|---|---|---|
| 600.3(h) | "Biological product means a virus, therapeutic serum, toxin, antitoxin, vaccine, blood, blood component or derivative, allergenic product, protein, or analogous product, or arsphenamine or derivative of arsphenamine (or any other trivalent organic arsenic compound), applicable to the prevention, treatment, or cure of a disease or condition of human beings." | VERIFIED |
| 600.3(h)(6) | "A protein is any alpha amino acid polymer with a specific, defined sequence that is greater than 40 amino acids in size. When two or more amino acid chains in an amino acid polymer are associated with each other in a manner that occurs in nature, the size of the amino acid polymer for purposes of this paragraph (h)(6) will be based on the total number of amino acids in those chains, and will not be limited to the number of amino acids in a contiguous sequence." | VERIFIED |
| 600.3 applicability | "As used in this subchapter:" (subchapter F, Biologics) | VERIFIED |

## 3. 21 CFR 601.2(a): the "40 or fewer" product category

Source: eCFR, `.../full/2026-10-06/title-21.xml?part=601&section=601.2`. SHA-256 `36695d82…3ede`. Versions:
2016-11-29, 2024-02-12, 2024-03-13.

| Item | Verbatim | Confidence |
|---|---|---|
| 601.2(a) | "An application for any of the following specified categories of biological products subject to licensure shall be handled as set forth in paragraph (c) of this section: (1) Therapeutic DNA plasmid products; (2) Therapeutic synthetic peptide products of 40 or fewer amino acids; (3) Monoclonal antibody products for in vivo use; and (4) Therapeutic recombinant DNA-derived products." | VERIFIED |

This is a filing-procedure category for products "subject to licensure". It is not a statement that every
peptide of 40 or fewer amino acids is a drug.

---

## 4. FDA final rule "Definition of the Term 'Biological Product'" (Feb 2020)

Source: *Fed Regist.* 2020;85(35):10057-10063. FR Doc. 2020-03505. Docket FDA-2018-N-2732. RIN 0910-AH57.
Published 2020-02-21, effective 2020-03-23. Govinfo PDF:
https://www.govinfo.gov/content/pkg/FR-2020-02-21/pdf/2020-03505.pdf (SHA-256 `d3942a61…1a52a70`).
It is a US Government work, so verbatim reproduction is permitted.

| Point | Verbatim | Confidence |
|---|---|---|
| What the rule does | "Under this final rule, the term protein means any alpha amino acid polymer with a specific, defined sequence that is greater than 40 amino acids in size." | VERIFIED |
| Statutory history | The BPCI Act defined biological product to include "a ''protein (except any chemically synthesized polypeptide).''" Then "section 605 of the FCA Act further amended the definition of ''biological product'' in section 351(i) of the PHS Act to remove the parenthetical ''(except any chemically synthesized polypeptide)'' from the statutory category of ''protein.''" | VERIFIED |
| Peptide is excluded from protein | "Finally, the term ''protein'' is distinct from and excludes the term ''peptide'' (i.e., amino acid chains that are generally shorter and simpler than a protein)." | VERIFIED |
| Why 40 (bright line) | "In deciding where to draw this bright-line rule, one of the factors that FDA considered is the number of amino acids understood to be generally necessary for an amino acid polymer to exhibit characteristics that are generally associated with ''proteins,'' lending a higher level of complexity to these products." | VERIFIED |
| Scientific support claimed | "there is scientific support for the fact that amino acid polymers greater than 40 amino acids in size exhibit at least some of the characteristics that are generally associated with proteins (83 FR 63817 at 63820)." | VERIFIED. The underlying textbook citations are in the proposed rule (83 FR 63817), which I did not read. |
| No scientific consensus conceded | "While we agree that there may not be clear scientific consensus for a particular number of amino acids to use when distinguishing between the terms ''protein'' and ''peptide,'' there is strong support in scientific literature for distinguishing between types of amino acid polymers based on the number of amino acids they contain." | VERIFIED |
| Manufacturing method irrelevant | "we are focusing on the number of amino acids in the amino acid polymer (irrespective of the method of manufacture)." | VERIFIED |
| Insulin worked example (known-value test) | "insulin is an alpha amino acid polymer with a specific, defined sequence consisting of 2 amino acid chain subunits with 21 amino acids and 30 amino acids, respectively. … we conclude that insulin is an alpha amino acid polymer with a specific, defined sequence of 51 amino acids. Therefore, according to the interpretation we are finalizing, insulin is a protein" | VERIFIED |
| Proposed but not finalized | The proposed rule would have interpreted "chemically synthesized polypeptide" as "greater than 40 amino acids but less than 100 amino acids in size". The final rule says "We are not finalizing our interpretation of ''chemically synthesized polypeptide'' as it is no longer necessary". | VERIFIED |
| Purpose | "the rule clarifies the criteria for whether certain products will be regulated as drugs or biological products." | VERIFIED |

### 4.1 FDA draft guidance on peptide drug products (December 2023)

Source: FDA. *Clinical Pharmacology Considerations for Peptide Drug Products; Draft Guidance for Industry*.
CDER, December 2023. Guidance page: "Draft Level 2 Guidance", "Not for implementation", content current as of
12/13/2023 (read 2026-10-11, so still a draft). PDF `/media/171901/download`, SHA-256 `c02c7b4d…8807`.

| Point | Verbatim | Confidence |
|---|---|---|
| Peptide definition (guidance-scoped) | "The term peptide, for purposes of this guidance, refers to any polymer composed of 40 or fewer amino acids." The footnote cites "FDA Final Rule "Definition of the Term 'Biological Product'" (85 FR 10057 …)". | VERIFIED (draft, non-binding) |
| Regulated as a drug | "In general, if a peptide meets the definition of a drug and does not otherwise meet the statutory definition of a "biological product" or a "device," it would be regulated as a drug under the FD&C Act and be subject to all the "drug" requirements under the FD&C Act and FDA's regulations, including the requirement that new drugs must be approved under section 505(c) of the FD&C Act" | VERIFIED |
| Mixed small and large molecule character | "peptide drug products can exhibit distinct combinations of characteristics of both small and large molecules regarding their chemistry, pharmacology, pharmacokinetic disposition, and pharmacodynamics (PD)." | VERIFIED |
| Metabolism (relevant to P-2) | "Peptides are generally metabolized by endopeptidases, then further degraded to amino acids by exopeptidases." | VERIFIED |
| Immunogenicity (relevant to P-3) | "In general, peptide drug products that are less than eight amino acids are not expected to be immunogenic unless there is an immunogenicity risk due to product impurities or aggregates." | VERIFIED (draft) |

---

## 5. ICH scope text

### 5.1 ICH S6(R1)

Source: ICH Harmonised Tripartite Guideline *Preclinical Safety Evaluation of Biotechnology-Derived
Pharmaceuticals S6(R1)*. "Parent Guideline dated 16 July 1997 … Addendum dated 12 June 2011 incorporated at the
end of June 2011". PDF https://database.ich.org/sites/default/files/S6_R1_Guideline_0.pdf (SHA-256 `05c41d25…2e22`).
The quotes below have line-break artifacts from PDF extraction removed (for example "pe ptides" became "peptides").

Section numbering: the **parent guideline's §1.3 "Scope"** (p. 1) carries the scope text. The **Addendum's §1.3
"Scope of the Guideline"** (p. 10) says only that it does not change the scope.

| Item | Verbatim | Confidence |
|---|---|---|
| Parent §1.3, framework | "This guidance is intended primarily to recommend a basic framework for the preclinical safety evaluation of biotechnology-derived pharmaceuticals. It applies to products derived from characterised cells through the use of a variety of expression systems including bacteria, yeast, insect, plant, and mammalian cells." | VERIFIED |
| Parent §1.3, active substances | "The active substances include proteins and peptides, their derivatives and products of which they are components; they could be derived from cell cultures or produced using recombinant DNA technology including production by transgenic plants and animals." | VERIFIED |
| Parent §1.3, may also apply | "The principles outlined in this guidance may also be applicable to recombinant DNA protein vaccines, chemically synthesised peptides, plasma derived products, endogenous proteins extracted from human tissue, and oligonucleotide drugs." | VERIFIED |
| Parent §1.3, exclusions | "This document does not cover antibiotics, allergenic extracts, heparin, vitamins, cellular blood components, conventional bacterial or viral vaccines, DNA vaccines, or cellular and gene therapies." | VERIFIED |
| Addendum §1.3 | "This addendum does not alter the scope of the original ICH S6 Guideline. For biotechnology-derived products intended to be used in oncology the Guidance on Nonclinical Evaluation for Anticancer Pharmaceuticals (ICH S9 Guideline) should be consulted." | VERIFIED |
| Amino-acid-count threshold in S6(R1) | Not present. I searched the extracted text for "40" and "amino acid" in a scope context and found none. S6(R1) mentions amino acids only in the ADME and degradation discussion. | VERIFIED absent |

### 5.2 ICH M3(R2)

Source: ICH *Guidance on Nonclinical Safety Studies for the Conduct of Human Clinical Trials and Marketing
Authorization for Pharmaceuticals M3(R2)*, "Current Step 4 version dated 11 June 2009". PDF
https://database.ich.org/sites/default/files/M3_R2__Guideline.pdf (SHA-256 `da8bc18c…8552`).

| Item | Verbatim | Confidence |
|---|---|---|
| §1.3, biotechnology products | "For biotechnology-derived products (as defined in Ref. 1), appropriate nonclinical safety studies should be determined in accordance with ICH S6. For these products, ICH M3(R2) only provides guidance with regard to timing of nonclinical studies relative to clinical development." | VERIFIED |
| Ref. 1 | "ICH S6 Guideline: Preclinical Safety Evaluation for Biotechnological-Derived Pharmaceuticals; July 1997." | VERIFIED |
| §1.3, new modalities | "In these cases and for products using innovative therapeutic modalities (e.g., siRNA), as well as vaccine adjuvants, particular studies can be abbreviated, deferred, omitted, or added." | VERIFIED |
| The word "peptide" in M3(R2) | Not present anywhere in the extracted text. | VERIFIED absent |
| M3(R2) Q&A (2012) on peptides | **NOT VERIFIED.** https://database.ich.org/sites/default/files/M3_R2__Q%26As_Guideline.pdf returned 404, and I did not locate the current URL. | — |

---

## 6. What this means for the P-1 routing rule (implementation guidance; these are design statements, not source facts)

- Store two separate facts, each with provenance:
  1. **US classification** (`LITERATURE`/`GUIDELINE`, cite 21 CFR 600.3(h)(6)). The program is a "protein" if the
     total amino-acid count, summed across naturally associated chains, is greater than 40. Otherwise it is not a
     protein (a peptide in FDA's draft-guidance usage). If the count or chain association is unknown, the result
     is `UNAVAILABLE`/`CONDITIONAL` with the missing fact named.
  2. **ICH nonclinical guideline applicability.** S6(R1) applies by **biotechnology origin** (characterised
     cells or recombinant production), whatever the length. For **chemically synthesised peptides**, S6(R1)
     principles "may also be applicable". This is a case-by-case judgement, so it should be an **expert
     determination** routed to the responsible toxicologist, not decided by the engine.
- The build plan's sentence "Peptides of 40 or fewer amino acids follow M3(R2) small-molecule rules; longer chains
  follow S6(R1) biologics rules" is **not supported verbatim by any source read here**. Two corrections follow.
  A recombinant peptide of 40 or fewer amino acids is within S6(R1)'s stated scope. A synthetic peptide of more
  than 40 amino acids is a US biological product (since 2020-03-23) but is only "may also be applicable" under
  S6(R1). The defensible encoding is: classification from 600.3(h)(6), and ICH routing from manufacturing origin
  plus a declared expert determination for synthetic peptides.
- Known-value tests from primary text: insulin (21 + 30 = 51 amino acids, naturally associated) gives **protein**.
  A single chain of exactly 40 amino acids gives **not protein**. A chain of 41 gives **protein**.
- Fix the citation in `docs/14_master_build_plan.md` (Wave P, P-1) and in §6 "Citations named in this plan":
  replace "21 CFR 314.3 peptide definition" with 21 CFR 600.3(h)(6) and 85 FR 10057. I have not edited that file.

---

## NOT VERIFIED

1. ICH M3(R2) Q&A (2012): the PDF URL returned 404.
2. Text of the 2026 "Nonclinical Testing Terminology" direct final rule amending §314.3: only the FR abstract was read.
3. The proposed rule 83 FR 63817 (Dec 12, 2018) and its textbook citations: not read.
4. Any final version of the December 2023 peptide clinical-pharmacology guidance: none exists as of 2026-10-11
   (the guidance page still says Draft).

## Citations to register

| id (proposed) | Citation | Accessed | Notes |
|---|---|---|---|
| cfr.21.600.3.h.6 | 21 CFR 600.3(h)(6), "Definitions: protein". eCFR, current as of 2026-10-07 (versions 2020-02-21, 2020-03-24). https://www.ecfr.gov/current/title-21/chapter-I/subchapter-F/part-600/subpart-A/section-600.3 | 2026-10-11 | The 40-amino-acid line. Replaces the plan's "21 CFR 314.3". |
| cfr.21.601.2.a | 21 CFR 601.2(a), "Applications for biologics licenses; procedures for filing." eCFR current. | 2026-10-11 | "Therapeutic synthetic peptide products of 40 or fewer amino acids" (category) |
| cfr.21.314.3 | 21 CFR 314.3, "Definitions." eCFR current (versions 2016-12-23, 2026-09-22). | 2026-10-11 | Contains **no** peptide definition. Register it only to record that negative finding. |
| fr.2020_03505 | FDA. Definition of the Term "Biological Product." Final rule. *Fed Regist.* 2020;85(35):10057-10063. FR Doc. 2020-03505; Docket FDA-2018-N-2732; effective 2020-03-23. | 2026-10-11 | SHA-256 d3942a61d4842ba0c87862e1acbf7b0279f50b0d193297a7fd2473de1af52a70 |
| fda.guidance.peptide_clinpharm.draft_2023 | FDA CDER. *Clinical Pharmacology Considerations for Peptide Drug Products*, Draft Guidance for Industry, December 2023. https://www.fda.gov/media/171901/download | 2026-10-11 | Draft, not for implementation |
| ich.s6r1 | ICH. *S6(R1) Preclinical Safety Evaluation of Biotechnology-Derived Pharmaceuticals.* Parent 16 July 1997; Addendum 12 June 2011. | 2026-10-11 | Scope: parent §1.3 |
| ich.m3r2 | ICH. *M3(R2) Guidance on Nonclinical Safety Studies for the Conduct of Human Clinical Trials and Marketing Authorization for Pharmaceuticals.* Step 4, 11 June 2009. | 2026-10-11 | §1.3 |
| fr.2026_19350 | FDA. Nonclinical Testing Terminology. Direct final rule. *Fed Regist.* 2026;91:59988-60004. FR Doc. 2026-19350; effective 2027-02-04. | 2026-10-11 | Amends 314.3 (adds "nonclinical test/study"). Abstract only. |

---

## Implementation record (P-1, 2026-10-11)

- **Classification.** `hos/core/regulatory/classification.py` implements `us_protein_classification(chains,
  naturally_associated)` per section 2 of this note.
  - Known-value tests come from the primary texts: insulin 21 + 30 gives 51, a protein; 40 is not a protein;
    41 is.
  - Multi-chain cases decide wherever the text decides: a contiguous chain over 40 is a protein, and a total of
    40 or fewer is not.
  - The rest stays pending, with the missing fact named. That includes chains not associated as in nature,
    since the rule is silent on them.
- **Routing.** It follows section 6 of this note.
  - `ProgramContext` gains `peptide_origin`, `amino_acid_chains`, `chains_naturally_associated` and
    `s6_determination`.
  - The engine routes a recombinant peptide to the S6(R1) set.
  - A chemically synthesised peptide gets the M3(R2) set, plus S6(R1) species relevance and ADA. Those two
    items stay conditional until the responsible scientist signs `s6_principles_apply`. The signature is
    re-authenticated over the API and recorded as ledger event `program.determination_recorded`.
  - An unknown origin turns every required item into a conditional pending the origin.
  - The determination cannot be written through a plain context change or supplied at creation. A context
    change that makes it inapplicable withdraws it, and the withdrawal is recorded on the ledger.
- **Plan corrected.** `docs/14` P-1 and its section 6 now cite 21 CFR 600.3(h)(6) and 85 FR 10057 instead of
  21 CFR 314.3.
- **Citations registered.** `cfr21_600_3`, `cfr21_601_2`, `fda_biological_product_rule_2020` and
  `fda_peptide_clinpharm_draft_2023`. `ich_s6r1` and `ich_m3r2` were already registered.
- **Not encoded.**
  - The 2026 "Nonclinical Testing Terminology" amendment to 314.3: only its abstract was read.
  - The M3(R2) Q&A (2012): its PDF was not found.
- **Tests.** `tests/core/test_peptide_routing.py` (22) and `tests/kernel/test_program_determination.py` (6).
