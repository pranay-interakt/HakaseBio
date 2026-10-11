# Driver research note — `safety_pharm_cns` (safety.core_battery CNS, Wave A8)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A8: ICH S7A.
Analysis named: Irwin / functional observational battery (FOB) incidence by dose and time.

Confidence labels: **verified-from-primary** (exact wording read this session); **verified-bibliographic**
(citation confirmed via Crossref/PubMed, content not read); **secondary-reproduction**; **NOT VERIFIED**.

## Primary document read

| Document | Copy read | Header as printed | SHA-256 |
|---|---|---|---|
| ICH S7A *Safety Pharmacology Studies for Human Pharmaceuticals* | `https://database.ich.org/sites/default/files/S7A_Guideline.pdf` (13 pp.) | "Current Step 4 version dated 8 November 2000" | `947d857b03e883af54a8c625332df576d181d0f005ffa5d60f7fc42f7d498cea` |

Page numbers are the printed page numbers of the guideline body.

## CNS core battery (S7A §2.7.1)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Required CNS endpoints | **Motor activity; behavioural changes; coordination; sensory/motor reflex responses; body temperature** | S7A §2.7.1, p.5 | "Motor activity, behavioral changes, coordination, sensory/motor reflex responses and body temperature should be evaluated." | verified-from-primary |
| Named methods | FOB (ref 3), **modified** Irwin's (ref 4), or other appropriate test (ref 5) | S7A §2.7.1, p.5 | "For example, a functional observation battery (FOB) (3), modified Irwin's (4), or other appropriate test (5) can be used." | verified-from-primary |
| Core battery purpose | Effects on vital functions (CV, respiratory, CNS) | S7A §2.7, p.5 | "The purpose of the safety pharmacology core battery is to investigate the effects of the test substance on vital functions." | verified-from-primary |
| CNS follow-up (if concern) | Behavioural pharmacology, learning and memory, ligand binding, neurochemistry, visual/auditory/electrophysiology | S7A §2.8.1.1, p.6 | "Behavioral pharmacology, learning and memory, ligand-specific binding, neurochemistry, visual, auditory and/or electrophysiology examinations, etc." | verified-from-primary |

## General S7A design requirements that apply to this driver

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Group size | No number given; must suffice to demonstrate or rule out a biologically significant effect | S7A §2.3.3.1, p.3 | "Thus, the number of animals or isolated preparations should be adequate to demonstrate or rule out the presence of a biologically significant effect of the test substance. This should take into consideration the size of the biological effect that is of concern for humans." | verified-from-primary |
| Controls | Negative and positive controls; positive controls may be omitted in well-characterised in vivo systems (justify exclusion) | S7A §2.3.3.1, p.3 | "Appropriate negative and positive control groups should be included in the experimental design. In well-characterized in vivo test systems, positive controls may not be necessary." | verified-from-primary |
| Test system justification and timepoints | Timepoints based on PD/PK; justification required | S7A §2.3.1, p.3 | "The time points for the measurements should be based on pharmacodynamic and pharmacokinetic considerations. Justification should be provided for the selection of the particular animal model or test system." | verified-from-primary |
| Conscious animals preferred | Unanesthetised; conditioned / unrestrained preferred | S7A §2.3.2, p.3 | "In conducting in vivo studies, it is preferable to use unanesthetized animals." | verified-from-primary |
| Route | Expected clinical route when feasible; exposure ≥ human where known | S7A §2.3.3.2, p.3 | "In general, the expected clinical route of administration should be used when feasible." | verified-from-primary |
| Dose–response and time course | Define dose–response; investigate onset and duration when feasible | S7A §2.4.1, p.4 | "Safety pharmacology studies should be designed to define the dose-response relationship of the adverse effect observed. The time course (e.g., onset and duration of response) of the adverse effect should be investigated, when feasible." | verified-from-primary |
| Dose range | Include and exceed primary PD / therapeutic range | S7A §2.4.1, p.4 | "Therefore, doses should include and exceed the primary pharmacodynamic or therapeutic range." | verified-from-primary |
| Top dose when no effect | A dose producing moderate adverse effects in this or similar studies | S7A §2.4.1, p.4 | "In the absence of an adverse effect on the safety pharmacology parameter(s) evaluated in the study, the highest tested dose should be a dose that produces moderate adverse effects in this or in other studies of similar route and duration." | verified-from-primary |
| Single limit-dose group | May suffice if no adverse effect | S7A §2.4.1, p.4 | "Testing of a single group at the limiting dose as described above may be sufficient in the absence of an adverse effect on safety pharmacology endpoints in the test species." | verified-from-primary |
| Duration | Generally single dose | S7A §2.5, p.4 | "Safety pharmacology studies are generally performed by single dose administration." | verified-from-primary |
| Timing | Before first administration in humans | S7A §2.10.1, p.7 | "The effects of a test substance on the functions listed in the safety pharmacology core battery should be investigated prior to first administration in humans." | verified-from-primary |
| GLP | Core battery ordinarily GLP | S7A §2.11, p.7 | "The safety pharmacology core battery should ordinarily be conducted in compliance with GLP." | verified-from-primary |
| Can be embedded in tox | Adequately designed tox studies can reduce/eliminate separate SP studies | S7A §2.10.1, p.7 | "Information from toxicology studies adequately designed and conducted to address safety pharmacology endpoints can result in reduction or elimination of separate safety pharmacology studies." | verified-from-primary |

## The three method references named by S7A §2.7.1 (bibliographic verification)

S7A cites **Mattsson et al. 1996** for the FOB — **not Moser VC**. No Moser reference appears anywhere in
S7A's reference list (refs 1–6, p.9), so no Moser citation is attached to S7A.

| S7A ref | As printed in S7A (p.9) | Crossref / PubMed record | Discrepancies | Content read? |
|---|---|---|---|---|
| (3) FOB | "Mattsson, J. L., Spencer, P. J. and Albee, R. R.: A performance standard for clinical and Functional Observational Battery examinations of rats. J. Am. Coll. Toxicol. 15, 239 (1996)." | Mattsson JL, Spencer PJ, Albee RR. *A Performance Standard for Clinical and Functional Observational Battery Examinations of Rats.* J Am Coll Toxicol 1996;15(3):239–254. DOI **10.3109/10915819609008716** (Crossref). Not indexed in PubMed/Europe PMC. | S7A gives first page only; Crossref adds issue 3, pp. 239–254. | **NOT VERIFIED** — OpenAlex lists a bronze-OA copy at SAGE but SAGE returned HTTP 403; no abstract obtained. |
| (4) Irwin | "Irwin, S.: Comprehensive observational assessment: 1a. A systematic, quantitative procedure for assessing the behavioural and physiologic state of the mouse. Psychopharmacologia (Berl.) 13, 222-257(1968)." | Irwin S. *Comprehensive observational assessment: Ia. A systematic, quantitative procedure for assessing the behavioral and physiologic state of the mouse.* Psychopharmacologia 1968;13(3):222–257. DOI **10.1007/BF00401402** (Crossref); PMID **5679627** (Europe PMC; no abstract in record). | S7A prints "1a" and "behavioural"; publisher record is "Ia" and "behavioral". Volume/pages agree. **DOI 10.1007/BF00401402 confirmed.** | **NOT VERIFIED** — closed access (Springer redirect to login); the observation list and scoring scale were not read. |
| (5) Other test | "Haggerty, G.C.: Strategies for and experience with neurotoxicity testing of new pharmaceuticals. J. Am. Coll. Toxicol. 10:677-687 (1991)." | Haggerty GC. *Strategy for and Experience with Neurotoxicity Testing of New Pharmaceuticals.* J Am Coll Toxicol 1991;10(6):677–688. DOI **10.3109/10915819109078660** (Crossref). | Title "Strategy" (Crossref) vs "Strategies" (S7A); last page 688 (Crossref) vs 687 (S7A). Register the Crossref form. | NOT VERIFIED (not read) |

## Analysis items requested in the brief

| Item | Status |
|---|---|
| Irwin / FOB observation list, scoring scales, observation timepoints | **NOT VERIFIED.** S7A requires only the five functional domains (§2.7.1) and names the methods; the itemised batteries are in Irwin 1968 and Mattsson 1996, neither of which could be read. The driver must take the observation list and scoring scale as protocol inputs, each mapped to one of the five S7A domains. |
| Statistical approach for incidence (categorical) data | **NOT VERIFIED — no source read in this session states one.** S7A gives no statistical method for any core-battery endpoint; it only requires group sizes sufficient to detect a biologically significant effect (§2.3.3.1). No incidence test (e.g. Fisher's exact, Cochran–Armitage) may be encoded as "S7A-cited". If the driver offers one, it needs its own verified primary citation added to `docs/04` first. |
| Body temperature | Explicit S7A §2.7.1 endpoint (continuous); dose-response and time course per §2.4.1. |
| Adverse CNS effect call | Study Director determination; S7A provides no numeric criterion. |

## Citations to register

1. ICH (2000). *S7A: Safety Pharmacology Studies for Human Pharmaceuticals.* Step 4, 8 November 2000. Section 2.7.1 (and 2.3–2.5, 2.10–2.11). https://database.ich.org/sites/default/files/S7A_Guideline.pdf
2. Irwin S. Comprehensive observational assessment: Ia. A systematic, quantitative procedure for assessing the behavioral and physiologic state of the mouse. *Psychopharmacologia.* 1968;13(3):222–257. DOI: 10.1007/BF00401402 *(bibliographic only — cite as the method named by S7A, not for any parameter value)*.
3. Mattsson JL, Spencer PJ, Albee RR. A performance standard for clinical and Functional Observational Battery examinations of rats. *J Am Coll Toxicol.* 1996;15(3):239–254. DOI: 10.3109/10915819609008716 *(bibliographic only)*.
4. Haggerty GC. Strategy for and experience with neurotoxicity testing of new pharmaceuticals. *J Am Coll Toxicol.* 1991;10(6):677–688. DOI: 10.3109/10915819109078660 *(bibliographic only)*.
