# Driver research note — `safety_pharm_respiratory` (safety.core_battery respiratory, Wave A9)

Compiled 2026-10-11. Basis named in `docs/14_master_build_plan.md` row A9: ICH S7A.
Analysis named: plethysmography — rate, tidal and minute volume vs vehicle, time-matched.

Confidence labels: **verified-from-primary** (exact wording read this session); **verified-bibliographic**
(citation confirmed via Crossref/PubMed, content not read); **secondary-reproduction**; **NOT VERIFIED**.

## Documents read

| Document | Copy read | Header as printed | SHA-256 / access route |
|---|---|---|---|
| ICH S7A | `https://database.ich.org/sites/default/files/S7A_Guideline.pdf` | "Current Step 4 version dated 8 November 2000" | `947d857b03e883af54a8c625332df576d181d0f005ffa5d60f7fc42f7d498cea` |
| Lim R et al. 2014, JoVE (unrestrained WBP protocol) | PMC article page PMC4827935 read through the web-fetch tool (Europe PMC XML returned HTTP 500; direct PMC download blocked by a bot check, which was not bypassed) | — | fetched HTML |
| Furdui A et al. 2023, eNeuro (WBP method statement) | Europe PMC full-text XML PMC10312122 | — | XML |
| Hoymann HG 2012, Front Pharmacol (review, context only) | Europe PMC full-text XML PMC3428707 | — | XML |

## Respiratory core battery (S7A §2.7.3) — exact requirement

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Required endpoint | **Respiratory rate** | S7A §2.7.3, p.5 | "Respiratory rate and other measures of respiratory function (e.g., tidal volume (6) or hemoglobin oxygen saturation) should be evaluated." | verified-from-primary |
| Other measures (examples) | **Tidal volume** (citing ref 6, Murphy 1994) **or haemoglobin oxygen saturation** — given as examples ("e.g.") | S7A §2.7.3, p.5 | (same sentence as above) | verified-from-primary |
| Minute volume | **Not named in S7A.** S7A lists respiratory rate and, as examples, tidal volume or haemoglobin O₂ saturation. (A 2021 paper, PMC8705495, paraphrases S7A as requiring "tidal and minute volume" — that paraphrase does not match the guideline text.) | S7A §2.7.3, p.5 | — | verified-from-primary (absence) |
| Quantification required | Clinical observation is not adequate; parameters must be quantified | S7A §2.7.3, p.5 | "Clinical observation of animals is generally not adequate to assess respiratory function, and thus these parameters should be quantified by using appropriate methodologies." | verified-from-primary |
| Named method/technique source | **Only Murphy 1994** (ref 6, attached to "tidal volume"). S7A does **not** name whole-body plethysmography or any specific plethysmograph method. | S7A §2.7.3 and References, p.5, p.9 | "6) Murphy, D.J.: Safety Pharmacology of the Respiratory System: Techniques and Study Design. Drug Dev. Res. 32: 237-246 (1994)." | verified-from-primary |
| Respiratory follow-up (if concern) | Airway resistance, compliance, pulmonary arterial pressure, blood gases, blood pH | S7A §2.8.1.3, p.6 | "Airway resistance, compliance, pulmonary arterial pressure, blood gases, blood pH, etc." | verified-from-primary |

General S7A design requirements (group size, controls, conscious animals, timepoints from PD/PK,
dose-response and time course, dose range, single dose, GLP, pre-FIH timing) are identical to those
tabulated in `safety_pharm_cns.md` (S7A §§2.3.1, 2.3.2, 2.3.3.1, 2.4.1, 2.5, 2.10.1, 2.11) and apply here.
The two most relevant to "vs vehicle, time-matched":

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Controls | Negative (vehicle) control group required; positive control optional in well-characterised systems | S7A §2.3.3.1, p.3 | "Appropriate negative and positive control groups should be included in the experimental design. In well-characterized in vivo test systems, positive controls may not be necessary." | verified-from-primary |
| Timepoints / time course | Timepoints from PD/PK; onset and duration investigated when feasible | S7A §2.3.1, p.3; §2.4.1, p.4 | "The time points for the measurements should be based on pharmacodynamic and pharmacokinetic considerations." | verified-from-primary |
| "Time-matched vehicle comparison" | **No S7A wording uses "time-matched".** The time-matched design is an analysis choice consistent with §2.3.1/§2.4.1, not an S7A-cited requirement. | S7A full text searched | — | verified-from-primary (absence) |

## Minute volume = rate × tidal volume (citable statements)

| Parameter | Value | Source | Verbatim quote (≤2 sentences) | Confidence |
|---|---|---|---|---|
| Minute volume formula | **MV (mL/min) = VT × f**; a body-weight-normalised form (VT × f)/BW is also given | Lim R, Zavou MJ, Milton PL, et al. J Vis Exp 2014;(90):e51755, DOI 10.3791/51755, PMCID PMC4827935 — Protocol step 4.13 | "Minute Volume (ml/min) = VT x f" | secondary-reproduction (a published lab protocol stating the identity; read via the fetch tool, short fragment only) |
| Same identity, second independent statement | Minute ventilation computed as the product of tidal volume and respiratory rate (in that study, relative tidal volume) | Furdui A, da Silveira Scarpellini C, Montandon G. eNeuro 2023;10(6):ENEURO.0035-23.2023, DOI 10.1523/ENEURO.0035-23.2023, PMCID PMC10312122 — Methods, plethysmography paragraph | "calculated as the product of relative tidal volume and respiratory rate" | secondary-reproduction (method user; read directly from Europe PMC XML) |
| Originating source of the identity | **NOT VERIFIED.** Neither paper is the origin of the definition; no physiology standard or safety-pharmacology primary source stating it was readable in this session. Murphy 1994 (the S7A-cited source) is closed access. | — | — | NOT VERIFIED |

## Whole-body plethysmography (WBP) method source

| Parameter | Value | Source | Verbatim quote | Confidence |
|---|---|---|---|---|
| Does S7A name a WBP source? | **No.** S7A cites only Murphy 1994 for tidal volume. | S7A §2.7.3 and refs, p.5, p.9 | — | verified-from-primary (absence) |
| Barometric WBP origin cited by the Lim 2014 protocol | Lim 2014 step 4.12 computes tidal volume using "the equation of Drorbaugh and Fenn" (its ref 8). The equation itself was **not** transcribed. | Lim et al. 2014 (as above), step 4.12 | "the equation of Drorbaugh and Fenn is used" | secondary-reproduction (fragment); **equation NOT VERIFIED** |
| Drorbaugh & Fenn 1955 — bibliographic | Drorbaugh JE, Fenn WO. *A barometric method for measuring ventilation in newborn infants.* Pediatrics 1955;16(1):81–87 | Crossref DOI 10.1542/peds.16.1.81; PMID 14394741 | — | verified-bibliographic (no abstract in record; full text not read) |
| Head-out vs barometric (context only) | A safety-pharmacology review recommends head-out plethysmography for the core battery and cautions against barometric "Penh" without independent airway-resistance assessment | Hoymann HG. Front Pharmacol 2012;3:156, DOI 10.3389/fphar.2012.00156, PMCID PMC3428707 — Discussion/Conclusion | (paraphrased; one author's recommendation, not a guideline) | secondary-reproduction |

## S7A reference 6 (Murphy 1994) — bibliographic verification

| As printed in S7A (p.9) | Crossref record | Content read? |
|---|---|---|
| "Murphy, D.J.: Safety Pharmacology of the Respiratory System: Techniques and Study Design. Drug Dev. Res. 32: 237-246 (1994)." | Murphy DJ. *Safety pharmacology of the respiratory system: Techniques and study design.* Drug Dev Res 1994;32(4):237–246. DOI **10.1002/ddr.430320408**. Not in PubMed/Europe PMC. | **NOT VERIFIED** — OpenAlex: closed access. |

## Implications for the driver

- Encode S7A §2.7.3 exactly: respiratory rate is required; tidal volume and haemoglobin O₂ saturation are
  S7A's examples of "other measures". Minute volume is a **derived** quantity (COMPUTED, MV = f × VT),
  cited to Lim et al. 2014 as a secondary statement, not to S7A.
- Units and any normalisation (per kg body weight) must be explicit inputs; WBP tidal volume depends on
  chamber/body temperature and humidity corrections whose equation (Drorbaugh & Fenn 1955) is NOT VERIFIED —
  the driver should ingest tidal volume as reported by the acquisition system, recording the system and its
  correction method as metadata, rather than computing it.
- Comparison "vs vehicle, time-matched" is a design/analysis choice consistent with S7A §2.3.1, §2.3.3.1 and
  §2.4.1; it is not an S7A-quoted requirement. The statistical test used needs its own verified citation.
- "Adverse effect" is a Study Director determination; S7A sets no numeric threshold.

## NOT VERIFIED

- Murphy 1994 content (closed); Drorbaugh & Fenn barometric equation; an originating primary source for
  MV = f × VT; any statistical method or numeric threshold for respiratory endpoints.

## Citations to register

1. ICH (2000). *S7A: Safety Pharmacology Studies for Human Pharmaceuticals.* Step 4, 8 November 2000. Sections 2.7.3, 2.8.1.3. https://database.ich.org/sites/default/files/S7A_Guideline.pdf
2. Murphy DJ. Safety pharmacology of the respiratory system: techniques and study design. *Drug Dev Res.* 1994;32(4):237–246. DOI: 10.1002/ddr.430320408 *(bibliographic only — cite as the reference S7A attaches to tidal volume)*.
3. Lim R, Zavou MJ, Milton PL, Chan ST, Tan JL, Dickinson H, Murphy SV, Jenkin G, Wallace EM. Measuring respiratory function in mice using unrestrained whole-body plethysmography. *J Vis Exp.* 2014;(90):e51755. DOI: 10.3791/51755 *(secondary statement of MV = VT × f)*.
4. Drorbaugh JE, Fenn WO. A barometric method for measuring ventilation in newborn infants. *Pediatrics.* 1955;16(1):81–87. DOI: 10.1542/peds.16.1.81 *(bibliographic only)*.