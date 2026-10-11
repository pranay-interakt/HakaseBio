# Verification of `hos/core/reference_params` (registry 2026.10.1)

Checked on 2026-10-11 against primary sources wherever they could be read.
No repository file was edited.

What each status means:
- **VERIFIED**: I read the primary source text, or a scan of the original typeset table, and the value matches.
- **WRONG**: the primary source gives a different value.
- **UNVERIFIED**: I could not see the primary source text. The reason is given in the row.

"Derived" means the source tables give an absolute amount (mL/min or g) for a stated reference body weight, and I divided by that weight. I could not find a per-kg column in Tables I, II, III or V of Davies & Morris. In the registry, per-kg values therefore need provenance `COMPUTED`, with the inputs being the `LITERATURE` table values.

---

## 1. Discrepancies at a glance

| # | param id | registry | primary source says | severity |
|---|---|---|---|---|
| 1 | `qh.mouse` | 131.0 mL/min/kg | 1.8 mL/min for a 0.02 kg mouse, giving **90.0 mL/min/kg** (D&M Table III) | WRONG value |
| 2 | `qh.rabbit` | 177.0 mL/min/kg | 177 is the **absolute** flow in mL/min for a 2.5 kg rabbit, giving **70.8 mL/min/kg** (D&M Table III) | WRONG unit/normalisation (2.5x too high) |
| 3 | `liver_weight.rat` | 36.6 g/kg | 10.0 g for a 0.25 kg rat, giving **40.0 g/kg** (D&M Table I) | WRONG value |
| 4 | `liver_weight.mouse` | 55.0 g/kg | 1.75 g for a 0.02 kg mouse, giving **87.5 g/kg** (D&M Table I) | WRONG value |
| 5 | `mppgl.human` | 40.0 mg/g, described as the Barter 2007 "weighted mean" | Barter 2007 weighted geometric mean is **32 mg/g (95% CI 29-34)**. 40 mg/g is Barter's age-model estimate **for a 30-year-old**. The primary measurement of 40 mg/g is **Hakooz et al. 2006** (n = 38, CV 31%). | WRONG citation/description. 40 is defensible only if relabelled. |
| 6 | `liver_weight.human` | 21.4 g/kg, cited to Barter 2007 | The Barter 2007 abstract reports only MPPGL and HPGL, with no liver weight. I found no primary source for 21.4 g/kg. It equals 1500 g / 70 kg. It is often misattributed to Davies & Morris, whose Table I gives 1800 g / 70 kg = 25.7 g/kg. | WRONG citation; value UNVERIFIED |
| 7 | `mppgl.rat` | 45 mg/g (Houston 1994) | Houston 1994 primary text not accessible. Barter 2008 (a US-government work) states that Houston's 45 mg/g is a composite of rat data from several sources. **Direct rat measurements: 60 mg/g** (Carlile 1997, untreated) and **61 mg/g, 95% CI 47-75** (Smith 2008, Wistar). | UNVERIFIED (primary); measured values differ |
| 8 | `mppgl.dog` | 45 mg/g (Houston 1994, flagged) | Houston 1994 is a rat value. Dog primary determinations: **55 mg/g, 95% CI 48-62** (Smith 2008, beagle); **41.1 mg/g with P450 marker, 63.6 mg/g with G6Pase marker, n = 17** (Scotcher 2017). | WRONG citation; 45 has no dog primary support |
| 9 | `mppgl.mouse` | 45 mg/g (flagged) | No primary mouse MPPGL determination found | UNVERIFIED. Should be `UNAVAILABLE` or carry an explicit "rat value applied to mouse" assumption. |
| 10 | `mppgl.monkey` | 45 mg/g (flagged) | No primary NHP MPPGL determination found | UNVERIFIED. Same treatment as mouse. |
| 11 | `bw.minipig` | 20 kg | FDA 2005 **Table 3** (p. 19): **Mini-pig 40 kg** (working range 25-64). 20 kg is the **Micro-pig**. | WRONG value |
| 12 | `bw.*` (all) | citation "FDA 2005 Table 1" | Reference body weights are **not** in Table 1. They are in **Table 3 (Appendix B, p. 19)**. | WRONG table reference |
| 13 | `km.*` (all) | unit "dimensionless" | FDA 2005 Appendix D, p. 25: the km factor "has units of kg/m2" | WRONG unit |
| 14 | `mrsd.default_safety_factor` note | "FDA 2005 section 5" | The default of 10 is in **Section VII (Step 4), p. 10**. Increases are in **VII.A (pp. 10-11)**, decreases in **VII.B (pp. 11-12)**, and the PAD comparison in **Section VIII (Step 5), p. 12**. Section V is HED calculation. | WRONG section reference (value 10 correct) |
| 15 | Qh block comment | "Davies & Morris 1993, Table I" | Blood flows are in **Table III (p. 1094)**. Organ weights are in Table I (p. 1093). | WRONG table reference |
| 16 | `qh.monkey` description | "rhesus monkey" | Table III header says only "Monkey (5 kg)". "Rhesus monkey" appears only in the Table I header. | Minor labelling issue |

Values that check out: `qh.human` 20.7, `qh.rat` 55.2, `qh.dog` 30.9 and `qh.monkey` 43.6 (all derived from Table III). `liver_weight.human.anatomical` 25.7, `liver_weight.dog` 32.0 and `liver_weight.monkey` 30.0 (all derived from Table I). All 13 km values. The body weights for human, mouse, rat, rabbit, dog and monkey. The default safety factor of 10.

The registry leaves out two FDA Table 1 rows, so these are omissions rather than errors: Child (20 kg) with km 25, given "for reference only", and Squirrel monkey with km 7.

---

## 2. Full parameter-by-parameter table

### 2a. Hepatic blood flow (Davies & Morris 1993)

Full citation: Davies B, Morris T. Physiological parameters in laboratory animals and humans. *Pharm Res.* 1993;10(7):1093-1095. doi:10.1023/A:1018943613122. PMID 8378254.

Source viewed: a scanned image of the original typeset **Table III**, *"Flow of Blood, Through the Major Organs, and Other Fluids in the Mouse, Rat, Rabbit, Monkey, Dog, and Human"*. It is hosted by BioNumbers as BNID 115528 (https://bionumbers.hms.harvard.edu/bionumber.aspx?id=115528), which cites "p.1094 table III". I did not access the article's running text, which is behind the Springer paywall.

Table III, "Blood flows (mL/min)", **Liver** row, transcribed from the scan, with column headers giving the reference body weight:
`Mouse (0.02 kg) 1.8 | Rat (0.25 kg) 13.8^k | Rabbit (2.5 kg) 177 | Monkey (5 kg) 218 | Dog (10 kg) 309 | Human (70 kg) 1450`.
Footnote k reads: P. D. Richardson and P. G. Withrington, *Gastroenterology* 81:159-173 (1981).

| param id | current | verified | unit | primary source | evidence |
|---|---|---|---|---|---|
| qh.human | 20.7 | **20.7** (1450/70 = 20.71, derived) | mL/min/kg | D&M 1993, Table III, p. 1094 | Liver row "1450" under "Human (70 kg)". VERIFIED (derived). |
| qh.rat | 55.2 | **55.2** (13.8/0.25, derived) | mL/min/kg | D&M 1993, Table III, p. 1094 | Liver row "13.8^k" under "Rat (0.25 kg)". VERIFIED (derived). In the same table, hepatic artery 2.0 plus portal vein 9.8 gives 11.8, which does not equal 13.8, because the liver value comes from a different source (footnote k). |
| qh.mouse | 131.0 | **90.0** (1.8/0.02, derived) | mL/min/kg | D&M 1993, Table III, p. 1094 | Liver row "1.8" under "Mouse (0.02 kg)". **WRONG.** 131 does not appear in D&M. |
| qh.dog | 30.9 | **30.9** (309/10, derived) | mL/min/kg | D&M 1993, Table III, p. 1094 | Liver row "309" under "Dog (10 kg)". VERIFIED (derived). |
| qh.monkey | 43.6 | **43.6** (218/5, derived) | mL/min/kg | D&M 1993, Table III, p. 1094 | Liver row "218" under "Monkey (5 kg)". VERIFIED (derived). The table does not name the species. |
| qh.rabbit | 177.0 | **70.8** (177/2.5, derived) | mL/min/kg | D&M 1993, Table III, p. 1094 | Liver row "177" under "Rabbit (2.5 kg)", and the row units are **mL/min**. **WRONG**: the registry stores the absolute flow as a per-kg value. |

### 2b. Liver weight

Source viewed: a scan of the original **Table I**, *"Weights of Various Organs in the Mouse, Rat, Rabbit, Monkey, Dog, and Human"*. It is BioNumbers BNID 115526 (https://bionumbers.hms.harvard.edu/bionumber.aspx?id=115526), cited as "p.1093 table I".

Table I, "Organ weights (g)", **Liver** row:
`Mouse (0.02 kg) 1.75 | Rat (0.25 kg) 10.0 | Rabbit (2.5 kg) 77 | Rhesus monkey (5 kg) 150 | Dog (10 kg) 320 | Human (70 kg) 1800`.
The human column cites the ICRP Reference Man report (ICRP No. 23, 1975).

For cross-checking only, Table II (BNID 115527, p. 1094), "Organ volumes (mL)", Liver row: `Mouse 1.3 | Rat 19.6 | Rabbit 100 | Monkey 135 | Dog 480 | Human 1,690`. Use Table I (weights), not Table II (volumes), for g/kg values. Table II's rat value of 19.6 mL is internally inconsistent with Table I's 10.0 g.

| param id | current | verified | unit | primary source | evidence |
|---|---|---|---|---|---|
| liver_weight.human | 21.4 | **UNVERIFIED** | g/kg | Registry cites Barter 2007 (doi:10.2174/138920007779315053), but its abstract covers only MPPGL and HPGL. | UNVERIFIED: no primary source found. The earliest uses I found have no citation for it: Brown HS, Griffin M, Houston JB. *Drug Metab Dispos* 2007;35(2):293-301, doi:10.1124/dmd.106.011569, Methods, which uses "a human liver weight of 21.4 g liver kg-1 bodyweight". Riley 2005 (doi:10.1124/dmd.105.004259) says human liver weights cited in the literature span "(1500 –1800 g liver/70 kg)", which is 21.4 to 25.7 g/kg. Some papers attribute 21.4 to Davies & Morris 1993, but D&M Table I gives 1800 g / 70 kg = 25.7. |
| liver_weight.human.anatomical | 25.7 | **25.7** (1800/70 = 25.71, derived) | g/kg | D&M 1993, Table I, p. 1093 | Liver "1800" under "Human (70 kg)". VERIFIED (derived). |
| liver_weight.rat | 36.6 | **40.0** (10.0/0.25, derived) | g/kg | D&M 1993, Table I, p. 1093 | Liver "10.0" under "Rat (0.25 kg)". **WRONG** as a D&M citation. I could not identify where 36.6 came from. |
| liver_weight.mouse | 55.0 | **87.5** (1.75/0.02, derived) | g/kg | D&M 1993, Table I, p. 1093 | Liver "1.75" under "Mouse (0.02 kg)". **WRONG** as a D&M citation. I could not identify where 55.0 came from. |
| liver_weight.dog | 32.0 | **32.0** (320/10, derived) | g/kg | D&M 1993, Table I, p. 1093 | Liver "320" under "Dog (10 kg)". VERIFIED (derived). |
| liver_weight.monkey | 30.0 | **30.0** (150/5, derived) | g/kg | D&M 1993, Table I, p. 1093 | Liver "150" under "Rhesus monkey (5 kg)". VERIFIED (derived). |
| (not in registry) liver_weight.rabbit | none | 30.8 (77/2.5, derived) | g/kg | D&M 1993, Table I, p. 1093 | Liver "77" under "Rabbit (2.5 kg)". |

#### Davies & Morris 1993: consolidated extraction

| species (Table I/III header) | body weight (kg) | liver weight (g), Table I | liver g/kg (derived) | liver blood flow (mL/min), Table III | Qh mL/min/kg (derived) |
|---|---|---|---|---|---|
| Mouse | 0.02 | 1.75 | 87.5 | 1.8 | 90.0 |
| Rat | 0.25 | 10.0 | 40.0 | 13.8 (footnote k) | 55.2 |
| Rabbit | 2.5 | 77 | 30.8 | 177 | 70.8 |
| Monkey (Table I: "Rhesus monkey") | 5 | 150 | 30.0 | 218 | 43.6 |
| Dog | 10 | 320 | 32.0 | 309 | 30.9 |
| Human | 70 | 1800 | 25.7 | 1450 | 20.7 |

The tables state body weight only in the column headers and give absolute amounts. I did not see per-kg normalised values in Tables I, II, III or V. I did not view the article's prose or Table IV, which BioNumbers lists as gastrointestinal transit, pH and enzyme data. I therefore cannot rule out that per-kg values appear in the article's text.

### 2c. Microsomal protein per gram liver (MPPGL)

| param id | current | verified | unit | primary source | evidence |
|---|---|---|---|---|---|
| mppgl.human | 40.0, "weighted mean recommended by the Barter 2007 consensus" | **32** (95% CI 29-34) is the Barter weighted geometric mean. **40** is either (a) the Hakooz 2006 measured mean or (b) the Barter age-model value at about 28-30 years. | mg/g | (1) Barter ZE, Bayliss MK, Beaune PH, et al. *Curr Drug Metab.* 2007;8(1):33-45, doi:10.2174/138920007779315053, PMID 17266522, abstract. (2) Hakooz N, Ito K, Rawden H, et al. *Pharm Res.* 2006;23(3):533-539, doi:10.1007/s11095-006-9531-2, PMID 16505976, abstract. (3) Barter ZE, Chowdry JE, Harlow JR, et al. *Drug Metab Dispos.* 2008;36(12):2405-2409, doi:10.1124/dmd.108.021311, abstract and Results. | **WRONG description.** Barter 2007 abstract: MPPGL weighted mean_geo "32 mg g-1 (95% Confidence Interval (CI); 29-34 mg.g-1)". It estimates 40 mg/g "for a 30 year old individual" and 31 mg/g at 60. Hakooz 2006 abstract: 38 livers averaged 40 mg/g with a CV of 31%. Barter 2008 (US-government work, verbatim): "MPPGL values increase from birth to a maximum of 40 mg g-1 [95% confidence interval for the geometric mean (95% CI meangeo): 37–43 mg g-1] at approximately 28 years followed by a gradual decrease in older age (mean of 29 mg g-1 at 65 years; 95% CI meangeo: 27–32 mg g-1)." Barter 2008 equation (Results, p. 2407): MPPGL (mg g-1) = 10^(1.407 + 0.0158×age − 0.00038×age² + 0.0000024×age³). The Fig. 1E legend prints C3 = 0.000024, which looks like a typo, because only 0.0000024 reproduces about 40 mg/g at 28 years. |
| mppgl.rat | 45.0 (Houston 1994) | **UNVERIFIED** at primary level. Measured rat values are 60 and 61 mg/g. | mg/g | Houston JB. *Biochem Pharmacol.* 1994;47(9):1469-1479, doi:10.1016/0006-2952(94)90520-7, PMID 8185657 (commentary, no abstract). | UNVERIFIED: Houston 1994 is behind the Elsevier paywall and I could not read it. Secondary evidence, Barter 2008 Introduction (US-government work, verbatim): "The most commonly used value of MPPGL in human IVIVE is 45 mg g-1 (Obach, 1997; Soars et al., 2002; Andersson et al., 2004; Uchaipichat et al., 2006) reported in a review by Houston (1994). However, this value is not obtained from human livers; instead it is a combination of data generated using rat tissue from a number of sources (Joly et al., 1975; Lin et al., 1978; Baarnhielm et al., 1986; Chiba et al., 1990)." Primary rat determinations: Carlile DJ, Zomorodi K, Houston JB. *Drug Metab Dispos.* 1997;25(8):903-911, PMID 9280396, reports 60 mg/g in untreated rats and 47 mg/g after phenobarbital or dexamethasone induction. Smith R, Jones RDO, Ballard PG, Griffiths HH. *Xenobiotica.* 2008;38(11):1386-1398, doi:10.1080/00498250802491662, reports Wistar rat mean_geo 61 mg/g (95% CI 47-75). |
| mppgl.dog | 45.0 (Houston 1994, flagged) | **55** (95% CI 48-62), Smith 2008. Alternatively **41.1** (P450 marker) or **63.6** (G6Pase marker), Scotcher 2017. | mg/g | Smith R et al. *Xenobiotica.* 2008;38(11):1386-1398, doi:10.1080/00498250802491662, abstract. Scotcher D, Billington S, Brown J, et al. *Drug Metab Dispos.* 2017;45(5):556-568, doi:10.1124/dmd.117.075242, PMC5399648, abstract. | **WRONG citation.** Houston 1994 is a rat-derived value (see above). Smith 2008 abstract: beagle dog mean_geo 55 mg/g liver (95% CI 48-62). Scotcher 2017 abstract: dog liver 41.1 and 63.6 mg/g with the P450 and G6Pase markers respectively (n = 17). The value depends on the recovery marker, so the registry must record which marker it uses. |
| mppgl.mouse | 45.0 (flagged) | **UNVERIFIED** | mg/g | none found | UNVERIFIED: Europe PMC and web searches found no primary determination of mouse MPPGL. The 45 mg/g figure is a rat value applied to mouse. The review Zimmer AA, Collier AC, *Drug Metab Rev* 2025;57(2):91-114, doi:10.1080/03602532.2025.2462527, says mouse MPPGL is "well-defined", but I did not access its full text to find the primary references. It is the next place to look. |
| mppgl.monkey | 45.0 (flagged) | **UNVERIFIED** | mg/g | none found | UNVERIFIED: no primary cynomolgus or rhesus MPPGL determination found. The Zimmer & Collier 2025 abstract names only mouse, rat and dog as well characterised. |

Supporting context: Obach RS. *Drug Metab Dispos.* 1999;27(11):1350-1359 (PMID 10534321), Methods, scales human intrinsic clearance using "45 mg microsomes" per g liver and "20 gm liver" per kg body weight, citing Obach et al. 1997, with human Q = 21 mL/min/kg (Table 4 footnote). So **neither 40 mg/g nor 21.4 g/kg comes from Obach 1999.**

### 2d. FDA 2005 MRSD guidance: km factors (Table 1, p. 7)

Full citation: U.S. FDA, CDER. *Guidance for Industry: Estimating the Maximum Safe Starting Dose in Initial Clinical Trials for Therapeutics in Adult Healthy Volunteers.* July 2005. https://www.fda.gov/media/72309/download

fda.gov blocked automated download (Akamai). The PDF was retrieved from the Wayback snapshot https://web.archive.org/web/20250107030713id_/https://www.fda.gov/media/72309/download: 30 pages, created 2005-07-06, SHA-256 `133b827046cd3b99157d15afb483a638c4ab3b0c319898e2bc089129670916b8`.

Table 1, verbatim from the PDF text layer. The title is "Table 1: Conversion of Animal Doses to Human Equivalent Doses Based on Body Surface Area". The columns are "To Convert Animal Dose in mg/kg to Dose in mg/m², Multiply by km", then "To Convert Animal Dose in mg/kg to HED^a in mg/kg, Either: Divide Animal Dose By", then "Multiply Animal Dose By".

```
Human                 37    ---    ---
   Child (20 kg)b     25    ---    ---
Mouse                  3   12.3   0.08
Hamster                5    7.4   0.13
Rat                    6    6.2   0.16
Ferret                 7    5.3   0.19
Guinea pig             8    4.6   0.22
Rabbit                12    3.1   0.32
Dog                   20    1.8   0.54
Primates:
   Monkeysc           12    3.1   0.32
   Marmoset            6    6.2   0.16
   Squirrel monkey     7    5.3   0.19
   Baboon             20    1.8   0.54
Micro-pig             27    1.4   0.73
Mini-pig              35    1.1   0.95
a Assumes 60 kg human. For species not listed or for weights outside the standard ranges, HED can be calculated from the following formula: HED = animal dose in mg/kg x (animal weight in kg/human weight in kg)0.33.
b This km value is provided for reference only since healthy children will rarely be volunteers for phase 1 trials.
c For example, cynomolgus, rhesus, and stumptail.
```

Units, from Appendix D, p. 25, verbatim: "The km factor has units of kg/m2; it is equal to the body weight in kg divided by the surface area in m2."

| param id | current | verified | unit (per FDA) | source | evidence |
|---|---|---|---|---|---|
| km.human | 37 | 37 | kg/m² | FDA 2005 Table 1, p. 7, and Table 3, p. 19 | "Human 37". VERIFIED. The registry unit "dimensionless" is wrong. |
| km.mouse | 3 | 3 | kg/m² | same | "Mouse 3 12.3 0.08". VERIFIED. |
| km.hamster | 5 | 5 | kg/m² | same | "Hamster 5 7.4 0.13". VERIFIED. |
| km.rat | 6 | 6 | kg/m² | same | "Rat 6 6.2 0.16". VERIFIED. |
| km.ferret | 7 | 7 | kg/m² | same | "Ferret 7 5.3 0.19". VERIFIED. |
| km.guinea_pig | 8 | 8 | kg/m² | same | "Guinea pig 8 4.6 0.22". VERIFIED. |
| km.rabbit | 12 | 12 | kg/m² | same | "Rabbit 12 3.1 0.32". VERIFIED. |
| km.dog | 20 | 20 | kg/m² | same | "Dog 20 1.8 0.54". VERIFIED. |
| km.monkey | 12 | 12 | kg/m² | same | "Monkeys^c 12 3.1 0.32", where footnote c reads "For example, cynomolgus, rhesus, and stumptail." VERIFIED. |
| km.marmoset | 6 | 6 | kg/m² | same | "Marmoset 6 6.2 0.16". VERIFIED. |
| km.baboon | 20 | 20 | kg/m² | same | "Baboon 20 1.8 0.54". VERIFIED. |
| km.micropig | 27 | 27 | kg/m² | same | "Micro-pig 27 1.4 0.73". VERIFIED. |
| km.minipig | 35 | 35 | kg/m² | same | "Mini-pig 35 1.1 0.95". VERIFIED. |
| (missing) km.squirrel_monkey | none | 7 | kg/m² | same | "Squirrel monkey 7 5.3 0.19" |
| (missing) km.child | none | 25 | kg/m² | same | "Child (20 kg) 25", given "for reference only" |

### 2e. FDA 2005: reference body weights (Table 3, Appendix B, p. 19, not Table 1)

Table 3, verbatim. The title is "Table 3: Conversion of Animal Doses to Human Equivalent Doses Based on Body Surface Area". The columns are Reference Body Weight (kg), Working Weight Range^a (kg), Body Surface Area (m²), "To Convert Dose in mg/kg to Dose in mg/m² Multiply by km", and the HED^b Divide and Multiply columns.

```
Human               60      ---           1.62   37    ---    ---
   Childc           20      ---           0.80   25    ---    ---
Mouse             0.020  0.011-0.034      0.007   3   12.3   0.081
Hamster           0.080  0.047-0.157      0.016   5    7.4   0.135
Rat               0.150  0.080-0.270      0.025   6    6.2   0.162
Ferret            0.300  0.160-0.540      0.043   7    5.3   0.189
Guinea pig        0.400  0.208-0.700      0.05    8    4.6   0.216
Rabbit              1.8    0.9-3.0        0.15   12    3.1   0.324
Dog                  10    5-17           0.50   20    1.8   0.541
Primates:
   Monkeysd           3    1.4-4.9        0.25   12    3.1   0.324
   Marmoset       0.350  0.140-0.720      0.06    6    6.2   0.162
   Squirrel monkey 0.600 0.290-0.970      0.09    7    5.3   0.189
   Baboon            12    7-23           0.60   20    1.8   0.541
Micro-pig            20    10-33          0.74   27    1.4   0.730
Mini-pig             40    25-64          1.14   35    1.1   0.946
a For animal weights within the specified ranges, the HED for a 60 kg human calculated using the standard km value will not vary more than ±20 percent from the HED calculated using a km value based on the exact animal weight.
```

| param id | current | verified | unit | source | evidence |
|---|---|---|---|---|---|
| bw.human | 60 | 60 | kg | FDA 2005 Table 3, p. 19 (and Table 1 footnote a, "Assumes 60 kg human") | "Human 60 --- 1.62 37". VERIFIED. The citation should name Table 3. |
| bw.mouse | 0.020 | 0.020 (range 0.011-0.034) | kg | Table 3, p. 19 | "Mouse 0.020 0.011-0.034 0.007 3". VERIFIED. |
| bw.rat | 0.150 | 0.150 (range 0.080-0.270) | kg | Table 3, p. 19 | "Rat 0.150 0.080-0.270 0.025 6". VERIFIED. |
| bw.rabbit | 1.8 | 1.8 (range 0.9-3.0) | kg | Table 3, p. 19 | "Rabbit 1.8 0.9-3.0 0.15 12". VERIFIED. |
| bw.dog | 10 | 10 (range 5-17) | kg | Table 3, p. 19 | "Dog 10 5-17 0.50 20". VERIFIED. |
| bw.monkey | 3 | 3 (range 1.4-4.9) | kg | Table 3, p. 19 | "Monkeys^d 3 1.4-4.9 0.25 12". VERIFIED. |
| bw.minipig | 20 | **40** (range 25-64) | kg | Table 3, p. 19 | "Mini-pig 40 25-64 1.14 35". **WRONG.** 20 kg belongs to "Micro-pig 20 10-33 0.74 27". |

### 2f. Default MRSD safety factor

| param id | current | verified | unit | source | evidence |
|---|---|---|---|---|---|
| mrsd.default_safety_factor | 10 | 10 | dimensionless | FDA 2005 **Section VII "STEP 4: APPLICATION OF SAFETY FACTOR"**, starting p. 9, with the sentence on p. 10 | Verbatim: "In practice, the MRSD for the clinical trial should be determined by dividing the HED derived from the animal NOAEL by the safety factor. The default safety factor that should normally be used is 10. This is a historically accepted value, but, as described below, should be evaluated based on available information." VERIFIED value. The registry note's "section 5" is **WRONG**: Section V is "STEP 2: HUMAN EQUIVALENT DOSE CALCULATION". |

More verbatim text from FDA 2005, all on pp. 10-12:
- Section VII, p. 10: "A safety factor of 10 may not be appropriate for all cases. The safety factor should be raised when there is reason for increased concern, and lowered when concern is reduced because of available data that provide added assurance of safety. [...] It is incumbent on the evaluator to clearly explain the reasoning behind the applied safety factor when it differs from the default value of 10, particularly if it is less than 10."
- **Section VII.A "Increasing the Safety Factor"** (pp. 10-11): "The following considerations indicate a safety concern that might warrant increasing the safety factor. In these circumstances, the MRSD would be calculated by dividing the HED by a safety factor that is greater than 10. [...] If multiple concerns are identified, the safety factor should be increased accordingly." The bulleted criteria are: Steep dose response curve; Severe toxicities; Nonmonitorable toxicity; Toxicities without premonitory signs; Variable bioavailability; Irreversible toxicity; Unexplained mortality; Large variability in doses or plasma drug levels eliciting effect; Nonlinear pharmacokinetics; Inadequate dose-response data; Novel therapeutic targets; Animal models with limited utility.
- **Section VII.B "Decreasing the Safety Factor"** (pp. 11-12): "Safety factors of less than 10 may be appropriate under some conditions. The toxicologic testing in these cases should be of the highest caliber in both conduct and design." It continues on p. 12: "A safety factor smaller than 10 could be justified when the NOAEL was determined based on toxicity studies of longer duration compared to the proposed clinical schedule in healthy volunteers."
- **Section VIII "STEP 5: CONSIDERATION OF THE PHARMACOLOGICALLY ACTIVE DOSE"** (p. 12): "However, once the MRSD has been determined, it may be of value to compare it to the PAD derived from appropriate pharmacodynamic models. If the PAD is from an in vivo study, an HED can be derived from a PAD estimate by using a BSA-CF. This HED value should be compared directly to the MRSD. If this pharmacologic HED is lower than the MRSD, it may be appropriate to decrease the clinical starting dose for pragmatic or scientific reasons."

The registry note paraphrases the increase criteria accurately in substance: steep dose-response, irreversible or non-monitorable toxicity, novel target, non-linear PK. It omits the other eight criteria.

---

## 3. Items that remain UNVERIFIED and why

1. **`liver_weight.human` = 21.4 g/kg**: no primary source found. It is not in the Barter 2007 abstract, Davies & Morris 1993 (25.7), or Obach 1999 (20 g/kg). It is used without citation by Brown, Griffin & Houston 2007. Options are to cite a primary human liver-weight dataset or to use the D&M/ICRP value of 25.7 g/kg.
2. **`mppgl.rat` = 45 mg/g, Houston 1994**: the primary paper could not be accessed (Elsevier paywall, no abstract in PubMed or Europe PMC). Barter 2008 attests that Houston reported 45 mg/g compiled from rat literature. I could not read the table or page in Houston 1994.
3. **`mppgl.mouse` and `mppgl.monkey`**: no primary determinations found. Recommend `Quantity.unavailable(...)` or an explicit cross-species assumption flag until a primary value is found. Zimmer & Collier 2025 is the next place to look.
4. **Davies & Morris article text**: I verified only scans of the original Tables I, II, III and V hosted by BioNumbers, not the article's prose pages. The numbers came from images of the typeset tables, not from a retyped secondary source.
5. **Barter 2007 full text**: I read only the abstract (Europe PMC); the full text is behind the Bentham paywall. The abstract prints the HPGL CI as "74-131 mg.g-1", which is evidently meant to be ×10^6 cells/g.

## 4. Source artefacts captured (scratchpad `research/refparams_dl/`)

| file | origin URL | SHA-256 |
|---|---|---|
| fda_wb.pdf | https://web.archive.org/web/20250107030713id_/https://www.fda.gov/media/72309/download | 133b827046cd3b99157d15afb483a638c4ab3b0c319898e2bc089129670916b8 |
| bn115526.pdf (D&M Table I scan) | https://bionumbers.hms.harvard.edu/bionumber.aspx?id=115526 (linked PDF) | be1b1648a3c4af26dba4b9ba510882747fd4debe7cec6af5a254a109274e626c |
| bn115527.pdf (D&M Table II scan) | https://bionumbers.hms.harvard.edu/bionumber.aspx?id=115527 | f7e37a0c9e8aa5b7930289f996f1a4d62804cc5df52b28f9bf4a8d076144fa91 |
| bn115528.pdf (D&M Table III scan) | https://bionumbers.hms.harvard.edu/bionumber.aspx?id=115528 | e6fa9467f4998afb6e2736397e69bf2647b0966930ac1e65bebfaf78dc35b385 |
| bn115531.pdf (D&M Table V scan) | https://bionumbers.hms.harvard.edu/bionumber.aspx?id=115531 | 529d28a193afeacb3e56e86a01af673ca25f1168b72e77df8bd8ce6d7c86ac71 |
| obach1999.pdf | https://web.archive.org/web/20170817060253id_/http://dmd.aspetjournals.org/content/dmd/27/11/1350.full.pdf | 0b965de6955242b5fb71392c34406f9501f5b2c9e4f919a6fc621cea44a295a5 |
| barter2008.pdf | https://web.archive.org/web/20180719111926id_/http://dmd.aspetjournals.org/content/dmd/36/12/2405.full.pdf | 02854c9ec83bfb94c979e1c3e9e59ca2d188be2367c9bcd257151ec9afcdfd80 |
| dmd106011569.pdf (Brown 2007 accepted ms.) | https://web.archive.org/web/20240517115547id_/https://dmd.aspetjournals.org/content/dmd/early/2006/11/28/dmd.106.011569.full.pdf | c909fe26abd2c1ce5c35fed8c5a8ef3781c77ed4b98d554b8f2ed96ca7b53638 |
| riley2005.pdf | https://web.archive.org/web/20180719081033id_/http://dmd.aspetjournals.org/content/dmd/33/9/1304.full.pdf | a7767fb5ce23411af4581d4bb9e55b9d9bcefc9e19d2da9fc910f340e4bf590e |

The abstracts for Barter 2007, Hakooz 2006, Smith 2008, Carlile 1997 and Scotcher 2017 came from the Europe PMC REST API (`/webservices/rest/search?resultType=core`).
