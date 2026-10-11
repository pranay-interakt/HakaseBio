# CTD Module 2.4 and 2.6 nonclinical summaries (docs/14 P6)

## Source

ICH M4S(R2), *The Common Technical Document for the Registration of Pharmaceuticals for Human
Use: Safety — Nonclinical Overview and Nonclinical Summaries of Module 2, Organisation of Module
4*, Step 4 version of 20 December 2002. Retrieved 2026-10-11 from
<https://database.ich.org/sites/default/files/M4S_R2_Guideline.pdf> (57 pages; citation key
`ich_m4s_r2`). The following were transcribed from that text into `hos/ind/summaries.py`:

- **2.4 Nonclinical Overview**, "Content and Structural Format": overview of the nonclinical
  testing strategy; pharmacology; pharmacokinetics; toxicology; integrated overview and
  conclusions; list of literature references. These parts carry no numbers in M4S(R2).
- **2.6 Nonclinical Written and Tabulated Summaries**: 2.6.1 and the numbered subsections of
  2.6.2, 2.6.4 and 2.6.6, with the headings as written in the guideline's table of contents.
- **Appendix B**, "The Nonclinical Tabulated Summaries — Templates": table numbers 2.6.3.1–2.6.3.5,
  2.6.5.1–2.6.5.16 and 2.6.7.1–2.6.7.17 with their titles, and the columns of the tables built
  here (2.6.3.1, 2.6.3.4, 2.6.5.1, 2.6.7.1, 2.6.7.2, 2.6.7.6, and the 2.6.7.7 header).
- The citation format "(Table X.X, Study/Report Number)" (2.4 and 2.6 "Use of Tables and
  Figures"), and the definition of pivotal repeat-dose studies as "the definitive GLP studies
  specified by ICH Guideline M3" (2.6.6.3).

## What is drafted, and what is the author's

- **Tabulated summaries.** Descriptive cells come from each driver's validated parameters
  (`summary_facts`, the parameters as entered). Numeric cells reference the stored result
  quantities by key (`summary_tables`), so every number keeps its provenance and links to its
  study; nothing is recomputed or restated. Signed determinations (NOAEL and others) appear as
  signed. Imported studies contribute their transcribed values with the report page.
- **Written summaries and overview.** Sentences stating facts from the studies (test system,
  route, doses, GLP status, signed determinations, statements a driver flagged as notable or of
  concern), each citing its table and study. The sections M4S(R2) reserves for assessment
  (brief summaries, discussion and conclusions, every part of 2.4 except the reference list)
  are marked as needing the author's text; a version cannot be signed while one is empty.
- **Who signs.** A person holding the Responsible Scientist or Programme Lead role, after
  re-authentication; agents may draft and revise but never sign.

## Departures from the templates (M4S(R2) lets applicants adapt the format)

- 2.6.3.1 and 2.6.5.1: a GLP column instead of a footnote.
- 2.6.7.1: a "NOAEL (signed)" column instead of underlining the highest NOAEL among the doses.
- 2.6.5.6: the measured fraction unbound instead of % bound, so no value is derived.
- 2.6.5.10: parent depletion (t1/2, CLint) rather than metabolite profiles, which these drivers
  do not measure.
- 2.6.7.6 and 2.6.7.7: noteworthy findings laid out by finding (the dose groups the protocol's
  Dunnett test flagged, with the driver's own % vs control and p), not one column per dose.
- 2.6.5.3: feeding condition is not recorded by the in vivo PK study type and is omitted.

## Not built

Tables for study types without a driver (single-dose toxicity, carcinogenicity, reproductive
and developmental toxicity, local tolerance, organ distribution, excretion) are produced only
from imported reports, as transcribed values. Appendix A text tables and figures, and 2.6.7.4
(drug substance batches, which belongs with the quality data), are not generated.
