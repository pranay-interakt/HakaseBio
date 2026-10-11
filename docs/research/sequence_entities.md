# Sequence entities (build plan item P4): primary-source verification

Checked on 2026-10-11. No repository file other than this note was edited.

Scope: the notations and reference data needed for P4's "Biologic sequence (protein/antibody; FASTA, and HELM
for non-natural chemistry)": the HELM paper and specification, FASTA, the IUPAC-IUB one-letter amino-acid codes,
and a citable table of average residue masses for molecular weight.

Status words: **VERIFIED** means I read the primary source. **NOT VERIFIED** gives the reason. Quotations are
kept short; numeric tables are facts and are reproduced with their source.

---

## 0. Summary

1. **HELM paper**: DOI, authors, journal, volume, issue and pages all VERIFIED through Crossref; abstract read.
2. **The current HELM notation specification is version 2.04, dated 1 November 2018** (document ID
   `HELM_STDSPEC-2.01`), published as a PDF attachment on the Pistoia Alliance Confluence "HELM Notation" page.
   This is newer than "HELM 2" as usually cited. The 2016 "HELM 2.0" document on the same page is explicitly
   labelled a design document and not the definitive specification. The specification carries a perpetual,
   worldwide, royalty-free implementation licence, which matters for shipping a HELM parser.
3. **FASTA**: Pearson & Lipman 1988 is VERIFIED as a citation (DOI, journal, volume, pages, abstract), but the
   paper's own text is **NOT VERIFIED** (PMC PDF behind a reCAPTCHA gate, PNAS 403). The paper is the right
   citation for the FASTA *programs*; for the *file format* and the accepted residue codes, cite NCBI's
   BLAST documentation, which I did read.
4. **IUPAC-IUB one-letter codes**: VERIFIED from the IUPAC-maintained web edition of the 1983 recommendations,
   section 3AA-21.2, Table 5. Note that **U (Sec) and the X caveat come from later addenda**, not the 1984
   publication, and **O (pyrrolysine) and J are not in this table at all**. Any `AminoAcidCode` enum must say
   which authority each symbol comes from.
5. **Average residue masses**: VERIFIED from the ExPASy FindMod "Mass values used" table, with the ExPASy
   Compute pI/Mw documentation stating the method (sum of average isotopic residue masses plus one water).
   ExPASy does not cite an atomic-weight source for that table, so the table itself is the citable artefact.
   If the project needs an element-level derivation instead, the citable base is CIAAW/IUPAC standard atomic
   weights, several of which are **intervals, not single numbers**. See section 5.3 for the consequence.

---

## 1. HELM

### 1.1 The paper (S-HELM-1)

| Field | Value | Confidence |
|---|---|---|
| Citation | Zhang T, Li H, Xi H, Stanton RV, Rotstein SH. HELM: A Hierarchical Notation Language for Complex Biomolecule Structure Representation. *J Chem Inf Model.* 2012;52(10):2796-2806. doi:10.1021/ci3001925 | VERIFIED via Crossref: title, all five authors (Zhang Tianhong, Li Hongli, Xi Hualin, Stanton Robert V., Rotstein Sergio H.), container "Journal of Chemical Information and Modeling", volume 52, issue 10, pages 2796-2806, publisher ACS, issued 2012-09-26. PMID 22947017. Matches the build plan exactly. |
| Abstract content | The abstract describes representing therapeutic macromolecules that carry non-natural chemical modifications, where atom-level representation is impractical and sequence alone is insufficient, and names antisense oligonucleotides, siRNAs, peptides, proteins and antibody-drug conjugates as the structure classes HELM covers. | VERIFIED (Europe PMC abstract record, `isOpenAccess: N`) |
| Full text | **NOT VERIFIED.** ACS paywall; Europe PMC reports no PMCID. | — |

The HELM specification itself points at this paper as the account of HELM's origin.

### 1.2 The specification (S-HELM-2)

| Field | Value | Confidence |
|---|---|---|
| Title / version | "HELM Standards Specification: Version 2.04", Document-ID "HELM_STDSPEC-2.01", "Last Revision Date 1st November 2018", 35 pages | VERIFIED |
| Where | Pistoia Alliance Confluence, space PUB, page "HELM Notation" (page id 13795362), attachment "HELM Specification 2_04.pdf". Direct download used: `https://pistoiaalliance.atlassian.net/wiki/rest/api/content/13795362/child/attachment/att936902708/download`. The page also hosts superseded 2_03, 2_01 and the 2_0 .doc. | VERIFIED |
| File identity | SHA-256 `13e734ba3b057da2f861281f278d0eeacffb97ca965bfa5305adc76517e5656d`; PDF CreationDate 2018-10-31 | VERIFIED |
| Canonical home named in the document | `http://www.OpenHELM.org` ("Future updates to this specification will be published on www.OpenHELM.org"). That host did not serve a valid certificate on 2026-10-11 (certificate covers pistoiaalliance.org only), so the Confluence page is the working source. | VERIFIED (text); the URL failure is my observation |
| Version history in the document | 1 (20 Sept 2013), 1.1 (15 May 2014, in-line and exchangeable HELM), 2.0 (4 April 2016, ambiguity notation), 2.01 (24 May 2016), 2.02 (1 Jan 2016 [sic, as printed], case insensitivity), 2.03 (29 Aug 2017), 2.04 (1 Nov 2018) | VERIFIED. The 2.02 date is printed as 1-Jan-2016, which is out of sequence; transcribed as printed. |
| Licence | Section 2.1 grants, without charge, a perpetual, non-exclusive, worldwide right to use the specification to develop, make, use, market and distribute conforming products. It excludes the right to sublicense, modify or create derivative works of the specification, and states that products implementing it are not derivative works. Section 2.2 is an as-is disclaimer. | VERIFIED |
| Status of the document | Section 3 states it is "the formal definition of the notation" and will be used to verify conformance of HELM implementations in software. Section 3.2 says it is "the authoritative definition". | VERIFIED |

#### Notation facts that constrain a P4 implementation (all from S-HELM-2)

| Fact | Statement | Section |
|---|---|---|
| Hierarchy | four levels: Complex Polymer, Simple Polymer, Monomer, Atom | 4 |
| Case | the notation is a line notation and is case insensitive; no whitespace between notation elements, though names and annotations may contain it | 4.1 |
| Decimal separator | "." within float values | 4.1 |
| Monomer required properties | structure, name, ID, attachment points (primary and optional), natural analog, polymer type, monomer type | 5.1 |
| Monomer structure formats | SMILES with atom mapping, CXSMILES, or Molfile; the atom-bond representation is not part of the HELM string | 5.1, 5.1.1 |
| Monomer ID | one or more characters, unique within a polymer type, no whitespace; the character set is not fixed by the specification | 5.1.2 |
| Natural analog | used to generate the single-letter sequence equivalent; the example given is selenocysteine with ID "Sec" and natural analog "C" | 5.1.5 |
| Polymer types | PEPTIDE, RNA (includes DNA), CHEM; others such as saccharide "could be added in the future" | 5.1.6 |
| Monomer types | backbone, branch, undefined. Backbone monomers generally carry R1 and R2; a branch monomer connects through R1 to a backbone R3 | 5.1.7 |
| Simple polymer syntax | multi-character monomer IDs in square brackets; "." between monomer units; branch monomer IDs in parentheses | 5.2.4 |
| Monomer lists | parentheses group a list; "+" means AND (a mixture), "," means XOR (exactly one present); a ratio or probability may follow a colon; if absent, it is unknown (2.03 removed the assumption that unspecified ratios are 1:1) | 5.2.4.1, version history |
| Repeating units | repeat count in single quotes after a monomer or a bracketed group; a range uses "-"; CHEM monomers may not terminate a repeat group | 5.2.4.2 |
| Complex polymer | four sections, each terminated by "$": ListOfSimplePolymers$ListOfConnections$ListOfPolymerGroups$ExtendedAnnotation$ | 5.3 |
| Polymer IDs | polymer type plus an integer suffix, for example PEPTIDE1, PEPTIDE2; simple polymer notation in curly brackets; a vertical pipe separates simple polymers | 5.3.1 |
| Change from HELM 1.x | section 3 was the hydrogen-pairing list in HELM 1 and 1.1; hydrogen bonds now live in the connection section, being treated as a special connection | 5.3 |
| Version marker | a HELM string using HELM 2 functionality carries "V2.0" immediately after the fourth "$"; a HELM 1 or 1.1 string has nothing after it | 5.4 |
| Reserved characters | dollar sign, curly brackets, vertical pipe, period, comma, dash, colon, square brackets and parentheses, each with a stated role; they must not appear in monomer IDs | 5.5 |
| Monomer sets | the specification makes no recommendation about monomer-set content; the open-source sets and JSON schema are at https://github.com/PistoiaHELM/HELMMonomerSets and adoption is optional | 5.1 |
| Exchange between organisations | exchangeable HELM (xHELM) should be used when information is transferred between organisations | 5.1, 6.2 |

A short quotation (within the licence's as-is terms): the specification says a HELM string that uses HELM 2
functionality "should include the string "V2.0" immediately after the fourth $".

**Implication for P4.** HELM alone does not define a molecule. A stored HELM string is meaningless without the
monomer set that resolves its IDs. The entity model must version and hash the monomer library alongside the
string, or store xHELM, which bundles the monomer definitions. Otherwise determinism (CLAUDE.md rule 5) fails.

### 1.3 Reference implementation (context, not a specification)

| Item | Value | Confidence |
|---|---|---|
| HELM2NotationToolkit | https://github.com/PistoiaHELM/HELM2NotationToolkit, MIT licence, "Copyright (c) 2017 The Pistoia Alliance". Release history in the repo lists v1.0.0 (2016-12-21) and v1.1.0 (2017-01-18). | VERIFIED |
| Project split | per the repo's `HELM2_overview.docx`: HELMNotationParser (parses HELM1/HELM2 into a HELM2Notation object and validates the input format), HELM2NotationToolkit (manipulation, molecular properties, images), ChemistryToolkit (chemistry plug-in API; CDK is the default, Marvin also implemented), HELM2WebService (REST) | VERIFIED |
| Related repos | HELMMonomerSets, HELMNotationParser, HELMWebEditor, HELMMonomerService under https://github.com/PistoiaHELM | VERIFIED (GitHub API listing) |

---

## 2. FASTA

### 2.1 The Pearson & Lipman citation (S-FASTA-1)

| Field | Value | Confidence |
|---|---|---|
| Citation | Pearson WR, Lipman DJ. Improved tools for biological sequence comparison. *Proc Natl Acad Sci U S A.* 1988;85(8):2444-2448. doi:10.1073/pnas.85.8.2444. PMID 3162770, PMC280013 | VERIFIED via Crossref (title "Improved tools for biological sequence comparison.", authors Pearson W R and Lipman D J, PNAS, volume 85, issue 8, pages 2444-2448, issued April 1988). The build plan's "PNAS 85:2444" is correct. |
| Abstract | Describes three programs: FASTA (a more sensitive derivative of FASTP, searching protein or DNA databases, able to compare a protein sequence against a translated DNA database, adding a step that joins multiple regions of similarity), RDF2 (significance of similarity scores by composition-preserving shuffling) and LFASTA (display of all local similarity regions). | VERIFIED (PMC abstract) |
| Full text | **NOT VERIFIED.** The PMC PDF is behind a reCAPTCHA interstitial, and pnas.org returned 403. I therefore cannot confirm from the paper itself whether it defines the ">" definition-line format. | — |

**Consequence.** Cite Pearson & Lipman 1988 for the FASTA *programs*. Do not cite it for the file format or the
residue alphabet unless someone reads the paper. For those, cite NCBI (section 2.2).

### 2.2 The format and residue alphabet (S-FASTA-2, NCBI)

Source: NCBI BLAST documentation, "Query Input and database selection", section "Accepted Input Formats", read
2026-10-11 at https://blast.ncbi.nlm.nih.gov/doc/blast-topics/.

| Fact | Statement | Confidence |
|---|---|---|
| Structure | a sequence in FASTA format begins with a single-line description, followed by lines of sequence data | VERIFIED |
| Defline marker | the description line is distinguished from the sequence data by a ">" symbol at the beginning | VERIFIED |
| Line length | NCBI recommends all lines of text be shorter than 80 characters | VERIFIED |
| Amino-acid codes accepted by BLASTP and TBLASTN | A alanine, B aspartate/asparagine, C cystine, D aspartate, E glutamate, F phenylalanine, G glycine, H histidine, I isoleucine, K lysine, L leucine, M methionine, N asparagine, P proline, Q glutamine, R arginine, S serine, T threonine, U selenocysteine, V valine, W tryptophan, Y tyrosine, Z glutamate/glutamine, X any, `*` translation stop, `-` gap of indeterminate length | VERIFIED. Note: this table does not include O (pyrrolysine) or J. |
| Nucleic-acid codes | A, C, G, T, U, plus N, K, S, Y, M, W, R, B, D, H, V and `-` for a gap of indeterminate length | VERIFIED |

A second NCBI page (GenBank "FASTA Format for Nucleotide Sequences", last updated 2025-06-18) covers nucleotides
only: the defline must begin with ">" followed by a unique SeqID, must be on a single line, sequence lines may
contain returns, and 80 characters per line is recommended. It contains no amino-acid table.

**Implication for P4.** An ingest that accepts FASTA must decide, explicitly and with provenance, what to do with
B, Z, X, U, `*` and `-`. B and Z are ambiguity codes and X is unknown, so none of them yields a defined residue
mass. A sequence containing them cannot produce a `COMPUTED` molecular weight; it must return
`Quantity.unavailable(reason=...)`.

---

## 3. IUPAC-IUB one-letter amino-acid codes

Source: *Nomenclature and Symbolism for Amino Acids and Peptides (Recommendations 1983)*, IUPAC-maintained web
edition at https://iupac.qmul.ac.uk/AminoAcid/, section "3AA-20 to 3AA-21" (file `A2021.html`, SHA-256
`c4581fc03f46b7d1403c611d5e58a4b4e3411a7617f3bf8be5a3f58b8f3a1472`).

### 3.1 The citation

The web edition's own front matter lists the publication venues: *Biochem J.* 1984;219:345-373; *Eur J Biochem.*
1984;138:9-37 (with 1985;152:1 and 1993;213:2); *Int J Pept Protein Res.* 1984;24 (following p. 84);
*J Biol Chem.* 1985;260:14-42; *Pure Appl Chem.* 1984;56:595-624; *Amino Acids and Peptides* 1985;16:387-410;
and *Biochemical Nomenclature and Related Documents*, 2nd ed., Portland Press, 1992, pp. 39-69.

Crossref confirms two of these independently:
- doi:10.1351/pac198456050595, "Nomenclature and symbolism for amino acids and peptides (Recommendations 1983)",
  *Pure and Applied Chemistry* 56(5):595-624, 1984. **VERIFIED.**
- doi:10.1111/j.1432-1033.1984.tb07877.x, "Nomenclature and Symbolism for Amino Acids and Peptides",
  *European Journal of Biochemistry* 138(1):9-37, 1984. **VERIFIED.**

Neither Crossref record lists authors, consistent with a commission document. The web edition attributes it to
the IUPAC-IUB Joint Commission on Biochemical Nomenclature (JCBN).

The one-letter system itself predates 1983. The web edition's reference 11 is: IUPAC-IUB Commission on
Biochemical Nomenclature (CBN), *A One-Letter Notation for Amino Acid Sequences*, 1968, published in
*Arch Biochem Biophys.* 1968;125(3):i-v; *Biochem J.* 1969;113:1-4; *Biochemistry* 1968;7:2703-2705;
*Biochim Biophys Acta* 1968;168:6-10; *Eur J Biochem.* 1968;5:151-153, among others. Section 3AA-20.1 states that
those 1968 recommendations are given in the 1983 document "with no substantial change". **VERIFIED.**

### 3.2 Table 5, the one-letter symbols (3AA-21.2)

| One-letter | Three-letter | Amino acid |
|---|---|---|
| A | Ala | alanine |
| B | Asx | aspartic acid or asparagine |
| C | Cys | cysteine |
| D | Asp | aspartic acid |
| E | Glu | glutamic acid |
| F | Phe | phenylalanine |
| G | Gly | glycine |
| H | His | histidine |
| I | Ile | isoleucine |
| K | Lys | lysine |
| L | Leu | leucine |
| M | Met | methionine |
| N | Asn | asparagine |
| P | Pro | proline |
| Q | Gln | glutamine |
| R | Arg | arginine |
| S | Ser | serine |
| T | Thr | threonine |
| U (*) | Sec | selenocysteine |
| V | Val | valine |
| W | Trp | tryptophan |
| X (**) | Xaa | unknown or 'other' amino acid |
| Y | Tyr | tyrosine |
| Z | Glx | glutamic acid or glutamine (or substances such as 4-carboxyglutamic acid and 5-oxoproline that yield glutamic acid on acid hydrolysis of peptides) |

Footnotes as printed: (*) "See JCBN/NC-IUBMB Newsletter 1999 for recommendations on selenocysteine";
(**) "See the Addendum for an alternative use of X." **VERIFIED.**

### 3.3 Points that affect the enum design

| Point | Statement | Confidence |
|---|---|---|
| U is a later addition | The 1986 addendum (JCBN/NC-IUB Newsletter 1986) notes that Sec and X had been used as the three- and one-letter codes for selenocysteine, calls that a useful addition, and cautions that this use of X is more specific than X for an unknown residue. The current U assignment is carried by the 1999 newsletter cited in the table footnote. | VERIFIED (addenda page); the 1999 newsletter itself NOT VERIFIED |
| O and J are absent | Neither pyrrolysine (O) nor J appears in Table 5. The "Note on the Choice of Symbols" explains that U and O were avoided (U confusable with V in handwriting, O with G, Q, C, D and zero) and J was avoided because it is absent from several languages. | VERIFIED |
| Reading direction | the left-hand letter is the residue carrying the free amino group and the right-hand letter the residue carrying the free carboxyl group; a fragmentary sequence is preceded or followed by a slash when that end is not the end of the molecule | VERIFIED (3AA-21.1) |
| Parentheses | regions of known composition but undetermined sequence, or a tentative single-residue identification | VERIFIED (3AA-21.5) |
| Scope caution | the system is recommended for long-sequence comparisons in tables and lists and where brevity matters, and is not recommended for simple text or for reporting experimental details of sequence determination | VERIFIED (3AA-20.2) |

**Conflict to encode explicitly.** NCBI's BLAST alphabet (section 2.2) and IUPAC Table 5 agree on the 20 standard
residues, B, Z, X and U, but NCBI adds `*` and `-`, which are file-format conventions rather than IUPAC amino-acid
symbols. Pyrrolysine (O) is in neither, yet ExPASy's mass table carries it (section 4). A single `AminoAcidCode`
enum must therefore record, per symbol, which authority defines it.

---

## 4. Average residue masses for molecular weight

### 4.1 The method (ExPASy Compute pI/Mw documentation)

Source: https://web.expasy.org/compute_pi/pi_tool-doc.html (SHA-256
`dd4ccf8c284b57767a00a853cf771d8c9fc9f02cfea0eb86fc3d4479a02c21e8`). The page states it is an excerpt from
Gasteiger E, Hoogland C, Gattiker A, Duvaud S, Wilkins MR, Appel RD, Bairoch A. "Protein Identification and
Analysis Tools on the ExPASy Server." In: Walker JM, ed. *The Proteomics Protocols Handbook*. Humana Press; 2005:571-607.

Method, quoted short: protein Mw is computed "by the addition of average isotopic masses of amino acids in the
protein and the average isotopic mass of one water molecule", with values in daltons. The page also states that
the program does not account for post-translational modifications. **VERIFIED.**

The ProtParam documentation (https://web.expasy.org/protparam/protparam-doc.html, SHA-256
`126dbeb7707a039d97dd6e448f56815f8683c119db41fc1b31babea40e7c40f4`) says Mw and theoretical pI "are calculated as
in Compute pI/Mw", so the two tools share this method. **VERIFIED.**

### 4.2 The table (ExPASy FindMod, "Protein Identification Tools - Mass values used")

Source: https://web.expasy.org/findmod/findmod_masses.html, section "2. Amino acids" (SHA-256
`1bcb8504aea37ac7826c882195318585989503743a042c6d1470ac0f8e99357b`). This is the page that the Compute pI/Mw
documentation links to for "average isotopic masses of amino acids". Values are residue masses (the free amino
acid minus water), in daltons.

| Residue | Monoisotopic | Average |
|---|---|---|
| Alanine (A) | 71.03711 | 71.0788 |
| Arginine (R) | 156.10111 | 156.1875 |
| Asparagine (N) | 114.04293 | 114.1038 |
| Aspartic acid (D) | 115.02694 | 115.0886 |
| Cysteine (C) | 103.00919 | 103.1388 |
| Glutamic acid (E) | 129.04259 | 129.1155 |
| Glutamine (Q) | 128.05858 | 128.1307 |
| Glycine (G) | 57.02146 | 57.0519 |
| Histidine (H) | 137.05891 | 137.1411 |
| Isoleucine (I) | 113.08406 | 113.1594 |
| Leucine (L) | 113.08406 | 113.1594 |
| Lysine (K) | 128.09496 | 128.1741 |
| Methionine (M) | 131.04049 | 131.1926 |
| Phenylalanine (F) | 147.06841 | 147.1766 |
| Proline (P) | 97.05276 | 97.1167 |
| Serine (S) | 87.03203 | 87.0782 |
| Threonine (T) | 101.04768 | 101.1051 |
| Tryptophan (W) | 186.07931 | 186.2132 |
| Tyrosine (Y) | 163.06333 | 163.1760 |
| Valine (V) | 99.06841 | 99.1326 |
| Selenocysteine (U), listed under "Non-standard amino acids" | 150.953636 | 150.0388 |
| Pyrrolysine (O), listed under "Non-standard amino acids" | 237.147727 | 237.3018 |

Water, from the same page, section "3. Other mass values": monoisotopic 18.01056, average 18.01524. Also listed:
H 1.00783 / 1.00794 and H+ 1.00728 / 1.00739. **VERIFIED.**

**The selenocysteine row looks wrong but is not.** Its average value (150.0388) is *lower* than its
monoisotopic value (150.953636), the reverse of every other residue. That is correct for selenium, and I
checked it rather than assume: NIST (Atomic Weights and Isotopic Compositions for Selenium, retrieved
2026-10-11, SHA-256 `fbcf3df8…f49c`) gives Se-80 as the most abundant isotope (composition 0.4961) with
relative atomic mass 79.9165218, while the standard atomic weight of selenium is 78.971(8). The most abundant
isotope is therefore heavier than the element's average, so a selenium-containing residue has a monoisotopic
mass above its average mass.

Recomputing the Sec residue (C3H5NOSe) confirms both ExPASy figures:
- monoisotopic with Se-80: 150.953636, which matches the table exactly;
- average with Se = 78.96 (the older IUPAC standard atomic weight): 150.039, matching the table's 150.0388;
- average with the current Se = 78.971: 150.050.

So the ExPASy average for Sec carries an **older selenium atomic weight and is about 0.011 Da low** against the
2024 CIAAW value. That matters only for selenoproteins, and only at the 0.01 Da level per Sec residue. Record it
as a known offset if Sec is ever supported. The 20 standard residues are unaffected.

Cross-check performed: for a sequence of only standard residues, Mw = sum(average residue masses) + 18.01524.
That matches the stated method. I did not have an independent worked example with a published Mw to test against,
so the known-value test for P4 still needs one (for example, a UniProt entry's stated sequence length and mass).

### 4.3 If an element-level derivation is preferred instead

Source: CIAAW (IUPAC Commission on Isotopic Abundances and Atomic Weights), "Standard Atomic Weights 2024" and
"Abridged Standard Atomic Weights 2024", https://www.ciaaw.org/atomic-weights.htm and
`/abridged-atomic-weights.htm` (SHA-256 `b4828259…95cf` and `f9e95544…907d`). The page states the table is based
on the "Atomic Weights 2021" report, with gadolinium, lutetium and zirconium revised in 2024.

| Element | Standard atomic weight 2024 | Abridged 2024 |
|---|---|---|
| H | [1.007 84, 1.008 11] | 1.0080 ± 0.0002 |
| C | [12.0096, 12.0116] | 12.011 ± 0.002 |
| N | [14.006 43, 14.007 28] | 14.007 ± 0.001 |
| O | [15.999 03, 15.999 77] | 15.999 ± 0.001 |
| S | [32.059, 32.076] | 32.06 ± 0.02 |
| Se | 78.971(8) | 78.971 ± 0.008 |

**VERIFIED.** The underlying report is Prohaska T, Irrgeher J, Benefield J, Böhlke JK, et al. "Standard atomic
weights of the elements 2021 (IUPAC Technical Report)." *Pure Appl Chem.* 2022;94(5):573-600.
doi:10.1515/pac-2019-0603 — **VERIFIED via Crossref** (title, first four authors, journal, volume, issue, pages,
2022-05-01). I did not read the report itself.

**Consequence for the provenance model.** H, C, N, O and S all have *interval* standard atomic weights, not
single values. A protein molecular weight derived from them is therefore an interval or a value with an
uncertainty, not a bare number. Two defensible options:
1. Use the ExPASy average-residue table as a `LITERATURE` value with the ExPASy page as the source, and state
   that the computed Mw inherits whatever convention ExPASy used. This is what most tools report, so results are
   comparable with the field.
2. Derive from CIAAW abridged weights, carry the stated uncertainty through the sum, and report Mw with an
   uncertainty. More rigorous, but results will differ in the last digits from every other tool.
Whichever is chosen, it is a `reference_parameters` entry with a version, per CLAUDE.md rule 3, not a constant
in code.

---

## 5. NOT VERIFIED

1. **Pearson & Lipman 1988 full text.** PMC PDF gated by reCAPTCHA; PNAS returned 403. Citation and abstract only.
2. **HELM paper full text.** ACS paywall, no PMCID.
3. **The JCBN/NC-IUBMB 1999 newsletter** that the IUPAC table cites for selenocysteine recommendations.
4. **openhelm.org**, the canonical home named in the HELM specification: TLS certificate mismatch on 2026-10-11.
5. **Prohaska et al. 2022** (CIAAW report) full text: citation verified via Crossref, text not read.
6. **The specific selenium atomic weight ExPASy used** for its Sec average mass. Back-calculation points to
   78.96 (section 4.2), but the page does not state a source.
7. **A worked known-value example for protein Mw** (a published sequence with a published mass) to serve as the
   P4 unit test.

## Citations to register

| id (proposed) | Citation | Accessed | Notes |
|---|---|---|---|
| zhang.2012.helm | Zhang T, Li H, Xi H, Stanton RV, Rotstein SH. HELM: A Hierarchical Notation Language for Complex Biomolecule Structure Representation. *J Chem Inf Model.* 2012;52(10):2796-2806. doi:10.1021/ci3001925 | 2026-10-11 | Crossref-verified. Full text not read. |
| pistoia.helm_spec.2_04 | Pistoia Alliance HELM project. *HELM Standards Specification, Version 2.04*, Document-ID HELM_STDSPEC-2.01, 1 November 2018. Pistoia Alliance Confluence, space PUB, page "HELM Notation" | 2026-10-11 | SHA-256 13e734ba3b057da2f861281f278d0eeacffb97ca965bfa5305adc76517e5656d. Perpetual royalty-free implementation licence, §2.1. |
| pistoia.helm2_toolkit | Pistoia Alliance. HELM2NotationToolkit (MIT). https://github.com/PistoiaHELM/HELM2NotationToolkit | 2026-10-11 | Reference implementation, not a specification. |
| pearson.1988.fasta | Pearson WR, Lipman DJ. Improved tools for biological sequence comparison. *Proc Natl Acad Sci U S A.* 1988;85(8):2444-2448. doi:10.1073/pnas.85.8.2444 | 2026-10-11 | Cite for the programs, not the file format. Full text not read. |
| ncbi.blast.fasta_format | NCBI. BLAST documentation, "Query Input and database selection", Accepted Input Formats. https://blast.ncbi.nlm.nih.gov/doc/blast-topics/ | 2026-10-11 | Defline, 80-character recommendation, amino-acid and nucleic-acid code tables. |
| iupac_iub.1984.aa_nomenclature | IUPAC-IUB Joint Commission on Biochemical Nomenclature. Nomenclature and symbolism for amino acids and peptides (Recommendations 1983). *Pure Appl Chem.* 1984;56(5):595-624, doi:10.1351/pac198456050595; also *Eur J Biochem.* 1984;138(1):9-37, doi:10.1111/j.1432-1033.1984.tb07877.x | 2026-10-11 | One-letter table at 3AA-21.2 of the IUPAC web edition. |
| iupac_iub.1968.one_letter | IUPAC-IUB Commission on Biochemical Nomenclature. *A One-Letter Notation for Amino Acid Sequences*, 1968. *Eur J Biochem.* 1968;5:151-153 (and parallel publications) | citation only, 2026-10-11 | Origin of the one-letter system; carried into the 1983 text without substantial change. |
| expasy.findmod.mass_values | ExPASy (SIB). "Protein Identification Tools - Mass values used" (FindMod). https://web.expasy.org/findmod/findmod_masses.html | 2026-10-11 | Average and monoisotopic residue masses; water. SHA-256 1bcb8504aea37ac7826c882195318585989503743a042c6d1470ac0f8e99357b |
| gasteiger.2005.expasy_tools | Gasteiger E, Hoogland C, Gattiker A, Duvaud S, Wilkins MR, Appel RD, Bairoch A. Protein Identification and Analysis Tools on the ExPASy Server. In: Walker JM, ed. *The Proteomics Protocols Handbook.* Humana Press; 2005:571-607. doi:10.1385/1-59259-890-0:571 | 2026-10-11 | Crossref-verified. The method statement is quoted from the ExPASy documentation excerpt, not the book. |
| ciaaw.2024.standard_atomic_weights | CIAAW. Standard Atomic Weights 2024 and Abridged Standard Atomic Weights 2024. https://www.ciaaw.org/atomic-weights.htm | 2026-10-11 | H, C, N, O, S are intervals. |
| prohaska.2022.atomic_weights_2021 | Prohaska T, Irrgeher J, Benefield J, Böhlke JK, et al. Standard atomic weights of the elements 2021 (IUPAC Technical Report). *Pure Appl Chem.* 2022;94(5):573-600. doi:10.1515/pac-2019-0603 | citation only, 2026-10-11 | Underlying report for the CIAAW table. |

---

## Implementation record (P4, 2026-10-11)

- **Residue masses.** The values (22 residues and water) were transcribed by script from the cached FindMod
  page (SHA-256 `1bcb8504…357b`). They live in `RESIDUE_MASS_TABLE`, version `expasy-findmod.2026-10-11`,
  which is separate from the physiological registry so that results already signed keep their hashes. This is
  option 1 of section 4.3.
- **Known-value test (NOT VERIFIED item 7, now closed).** UniProt REST, captured 2026-10-11 and stored as
  fixtures with URL and SHA-256 in `backend/tests/fixtures/uniprot/`:
  - P01308 (insulin precursor, 110 residues, 11981 Da): computed 11980.91;
  - P01275 (proglucagon, 180 residues, 20909 Da): computed 20909.21.

  Both reproduce UniProt's stated mass to the dalton.
- **HELM.** I re-read the cached specification text (sections 4.1 and 5.2–5.5; PDF SHA-256 `13e734ba…656d`)
  to write the parser.
  - The specification's own example `CHEM1{SS3}` shows that a CHEM polymer's single monomer is written without
    brackets, and the parser accepts it.
  - Unicode hyphens copied from the PDF are refused, not rewritten: the specification defines "-".
  - Monomer-library resolution and HELM-derived masses are not built.
- **FASTA.** Lower-case codes are refused (the IUPAC table is upper case; NCBI's handling of lower case was not
  read). Whitespace inside sequence lines is ignored.
- **Citations registered.** `expasy_findmod_masses`, `gasteiger2005`, `iupac_iub_1984_amino_acids`,
  `ncbi_blast_input_formats`, `zhang2012_helm` and `pistoia_helm_spec_2_04`. Pearson & Lipman 1988 is not
  cited: no FASTA program is used. CIAAW is not cited: option 2 was not chosen.
- **Tests.** `tests/core/test_sequence.py` (34) and `tests/kernel/test_entities.py` (5). The latter includes an
  approved study on a sequence-registered peptide that verifies offline.
