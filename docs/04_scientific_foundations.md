# 04 — Scientific Foundations

Every computational method in HOS is listed here with its **primary citation**, its **equation**, the
**units** of inputs/outputs, and its **assumptions/limits**. Code implementing a method MUST cite the
entry here (by method id) in its docstring, and MUST have a known-value unit test. Physiological
constants are **data with provenance** (the `reference_parameters` registry, §4.9), never literals in
code.

Nomenclature: `Quantity` = provenance-typed value (see `docs/07`). "IVIVE" = in-vitro–in-vivo
extrapolation.

---

## 4.1 Molecular descriptors  [method family: `descr.*`]

- **Engine:** RDKit (open source). Algorithms are published and peer-reviewed.
- **Descriptors (ids):** `descr.mw` molecular weight; `descr.clogp` (Crippen LogP,
  Wildman & Crippen 1999); `descr.tpsa` (Ertl 2000); `descr.hbd`/`descr.hba` (Lipinski counts);
  `descr.rotb` rotatable bonds; `descr.aromatic_rings`; `descr.fsp3`; `descr.qed` (Bickerton 2012).
- **Rule flags:** Lipinski Ro5 (Lipinski 2001), Veber (Veber 2002) — encoded as explicit, cited
  threshold rules, not opinions.
- **Provenance:** `COMPUTED`, method id = RDKit function + RDKit version.
- **Known-value tests:** aspirin (`CC(=O)Oc1ccccc1C(=O)O`) → MW 180.159, TPSA 63.6, HBD 1, HBA 3,
  cLogP ≈ 1.31, QED ≈ 0.55 (verified against RDKit 2026.09.1).
- **Citations:** Wildman SA, Crippen GM. *J Chem Inf Comput Sci* 1999;39:868. · Ertl P et al.
  *J Med Chem* 2000;43:3714. · Lipinski CA et al. *Adv Drug Deliv Rev* 2001;46:3. · Veber DF et al.
  *J Med Chem* 2002;45:2615. · Bickerton GR et al. *Nat Chem* 2012;4:90.

## 4.2 In-vitro intrinsic clearance from microsomal depletion  [`adme.clint_invitro`]

- **Design:** substrate incubated with liver microsomes + NADPH; parent remaining measured by LC-MS/MS
  at timepoints (e.g. 0,5,15,30,45,60 min). Log(% remaining) vs t is linear in the first-order region.
- **Equation:** elimination rate constant `k` (min⁻¹) = −slope of `ln(C/C0)` vs time (linear regression).
  Half-life `t½ = ln(2)/k`.
  Apparent intrinsic clearance scaled to microsomal protein:
  `CLint,app (µL/min/mg) = k (min⁻¹) × [1 / (protein concentration, mg/µL)]`
  equivalently `= (0.693 / t½) × (incubation volume µL / microsomal protein mg)`.
- **Inputs:** concentration–time series (`MEASURED`), protein concentration (mg/mL), incubation volume.
- **Output:** `CLint,app` as `Quantity(µL/min/mg)`, provenance `COMPUTED`, with the regression R²
  recorded and QC flags when R² or total depletion fall below the run-acceptance criteria. Those
  criteria have no defaults in code: no consensus source fixes them, so each protocol states them
  and their basis (`docs/09` §9.1).
- **Assumptions/limits:** first-order (substrate ≪ Km), no significant non-specific binding unless
  corrected (see fu,mic below), linear region only.
- **Citation:** Obach RS. Prediction of human clearance of twenty-nine drugs ... *Drug Metab Dispos*
  1999;27(11):1350–1359, doi:10.1016/S0090-9556(24)14938-0. Assay conditions (substrate and protein
  concentration, cofactor) are protocol parameters; no citable consensus set was found
  (`docs/research/driver_protocols.md` A.8).

## 4.3 Microsomal binding correction  [`adme.fu_mic`]

- **Purpose:** free fraction in the microsomal incubation (`fu,mic`) corrects CLint for non-specific
  binding to microsomal lipid. Can be measured (equilibrium dialysis) or predicted from LogP/D.
- **Predicted model (labeled `PREDICTED`):** Hallifax & Houston 2006,
  `fu,mic = 1 / (1 + C·10^(0.072·X² + 0.067·X − 1.126))`, X = logP (bases) or logD7.4, C = protein
  (mg/mL). Coefficients confirmed via a published reproduction (the 2006 commentary is paywalled).
- **Applicability domain:** Gertz et al. 2008 evaluated the equation on 127 measurements and found
  it reliable for logP/D 0–3 (< 5 when C ≤ 0.1 mg/mL); outside that range fu,inc should be measured.
- **Citations:** Hallifax D, Houston JB. *Drug Metab Dispos* 2006;34:724. Gertz M et al. *Drug Metab
  Dispos* 2008;36:535, doi:10.1124/dmd.107.018713.

## 4.4 IVIVE scaling to in-vivo hepatic clearance  [`adme.clint_invivo`, `adme.clh`]

- **Scaling to whole liver:**
  `CLint,in vivo (mL/min/kg) = CLint,app (µL/min/mg) × MPPGL (mg/g liver) × liver weight (g/kg BW) ÷ 1000`
  where MPPGL = microsomal protein per gram liver and liver weight per kg body weight come from the
  `reference_parameters` registry (§4.9), each cited.
- **Well-stirred liver model (hepatic clearance):**
  `CLh = (Q_h · fu_b · CLint,in vivo) / (Q_h + fu_b · CLint,in vivo)`
  where `Q_h` = hepatic blood flow, `fu_b` = unbound fraction in blood (= fu,plasma / blood-plasma
  ratio). Optionally include `fu,mic` correction on CLint.
- **Hepatic extraction ratio:** `E_h = CLh / Q_h`. **Predicted hepatic availability:** `F_h = 1 − E_h`.
- **Outputs:** all `Quantity`; `CLint,in vivo` and `CLh` as `COMPUTED`; the physiological inputs carry
  their own `LITERATURE`/`GUIDELINE` provenance from the registry.
- **Assumptions/limits:** well-stirred (venous-equilibrium) model; hepatic metabolism is the dominant
  clearance route; blood flow and binding values are population means (flag inter-individual variability
  as out of scope for the point estimate). Alternative models (parallel-tube, dispersion) are available
  as selectable methods with their own citations.
- **Citations:** Wilkinson GR, Shand DG. *Clin Pharmacol Ther* 1975;18:377 (well-stirred model);
  Obach RS. *Drug Metab Dispos* 1999;27:1350; Houston JB. *Biochem Pharmacol* 1994;47:1469;
  Riley RJ et al. *Drug Metab Dispos* 2005;33:1304.

## 4.5 Concentration–response (hERG and any potency/inhibition assay)  [`pharm.hill_4pl`]

- **Equation (4-parameter logistic / Hill), as implemented in `hos/core/pharmacology.py`:**
  `response = bottom + (top − bottom) / (1 + (C / IC50)^hillslope)`. Here `top` is the response
  at low concentration and `bottom` the response at high concentration. This is Ritz et al.
  2015 Eq. 2, f = c + (d − c)/(1 + exp(b(ln x − ln e))), with c = bottom, d = top, e = IC50 and
  b = hillslope. A known-value test checks the identity. (An earlier version of this line wrote
  `(IC50 / C)`, which swaps the asymptotes and the slope's sign; the code never used that form.)
  The fit is
  by non-linear least squares (SciPy `curve_fit`) with bounds; report IC50/EC50, Hill slope,
  top/bottom, and the fit covariance → **confidence interval** on IC50.
- **Inputs:** concentration–response pairs (`MEASURED`). **Output:** `IC50` as `Quantity(µM)` with CI,
  provenance `COMPUTED`; fit R²/convergence recorded; QC flag if curve does not plateau or fit fails.
- **Limits:** requires an adequate concentration range bracketing the inflection; flags extrapolated
  IC50 when the top/bottom asymptote is not reached.
- **Citation:** standard 4PL pharmacology (e.g. DeLean, Munson & Rodbard. *Am J Physiol* 1978;235:E97).

## 4.6 hERG cardiac safety margin  [`safety.herg_margin`]

- **Equation:** `safety margin = IC50(hERG, free) / Cmax(free, therapeutic)`.
- **Free exposure (ICH E14/S7B Q&A 1.2):** free Cmax = Cmax,ss (high clinical exposure) × fu,p, with
  fu,p set to 1% when measured below 1%.
- **Thresholds:** the Q&A sets no fixed number; the margin is compared with margins of reference
  drugs run under the same protocol. HOS applies a threshold only when the user supplies one with
  that basis. Redfern et al. 2003 (~30×) is shown as a historical reference point, never as a
  verdict.
- **Citations:** Redfern WS et al. *Cardiovasc Res* 2003;58:32; ICH S7B; ICH E14/S7B Q&A (2022) for the
  integrated nonclinical risk framework.

## 4.7 First-in-human dose projection  [`dose.hed`, `dose.mrsd`]

- **NOAEL → Human Equivalent Dose (body-surface-area scaling), FDA 2005 guidance:**
  `HED (mg/kg) = animal NOAEL (mg/kg) × (animal Km / human Km)`  (equivalently `× (W_animal/W_human)^0.33`).
  Km factors (from the registry, §4.9; FDA 2005 Table 1): human 37, mouse 3, rat 6, rabbit 12, dog 20,
  monkey 12, minipig 35.
- **Most sensitive species:** choose the lowest HED unless justified otherwise (record the justification).
- **Maximum Recommended Starting Dose:** `MRSD = HED / safety factor` (default 10; raise for steep
  dose-response, irreversible/unmonitorable toxicity, novel target, non-linear PK — each as an encoded,
  cited condition). Compare against the **pharmacologically active dose (PAD)**: FDA 2005 §VIII compares an HED derived from the PAD with the MRSD and says
  that if it is lower "it may be appropriate to decrease the clinical starting dose". HOS flags this
  (`pad_below_mrsd`) for the responsible scientist and never applies it automatically.
- **Biologics / immune agonists:** MABEL approach (receptor occupancy / EC20 in human target cells),
  take the **lowest** of NOAEL-HED, PAD, MABEL *(not implemented; verify against EMA FIH Rev. 1 §7.2 before building)*. **Advanced cancer:** ICH S9 — 1/10 rodent STD10 or
  1/6 non-rodent HNSTD; NOAEL not required.
- **Output:** HED and MRSD as `Quantity(mg/kg and total mg for a 60 kg human)` with the **full
  derivation chain** recorded and rendered.
- **Citations:** FDA. *Guidance for Industry: Estimating the Maximum Safe Starting Dose in Initial
  Clinical Trials for Therapeutics in Adult Healthy Volunteers* (2005); EMA FIH guideline
  (EMEA/CHMP/SWP/28367/07 Rev.1, MABEL); ICH S9.

## 4.8 IND-enabling study-set logic  [`reg.study_set`]

- Encodes ICH **M3(R2)** Tables 1–2 (repeat-dose duration vs. intended clinical duration; two species),
  **S2(R1)** genotoxicity battery options, **S7A** safety-pharmacology core battery, **S7B**/E14 cardiac,
  **S5(R3)** DART, **S1B(R1)** carcinogenicity weight-of-evidence, **S6(R1)** biologics, **S9** oncology,
  **S8** immunotoxicity, **S10** phototoxicity, **S11** juvenile, **M10** bioanalytical validation.
- Each rule is a structured object: `{guideline, section, condition, required_studies, citation}`.
  The study-set for a given program is *derived* from these rules + the program's modality/indication/
  clinical plan — not hand-written per program.
- **Citations:** the ICH guidelines named above (official ICH documents) and FDA/EMA adoptions.

## 4.9 Reference-parameter registry  [`reference_parameters`]

Physiological and scaling constants are stored as cited data, versioned, with species and value:

| id | value | units | species | citation |
|----|-------|-------|---------|----------|
| `qh.human` | 20.7 | mL/min/kg | human | Davies & Morris 1993 Table III (1450 mL/min / 70 kg) |
| `qh.mouse` | 90.0 | mL/min/kg | mouse | Davies & Morris 1993 Table III (1.8 / 0.02) |
| `mppgl.human` | 32 | mg/g liver | human | Barter 2007 consensus (95% CI 29–34) |
| `mppgl.rat` / `mppgl.dog` | 61 / 55 | mg/g liver | rat / dog | Smith 2008 |
| `liver_weight.human` | 21.4 | g/kg BW | human | **requires verification** (no primary source traced) |
| `km.human` / `km.rat` / `km.dog` | 37 / 6 / 20 | kg/m² | — | FDA 2005 Table 1 |
| `bw.minipig` | 40 | kg | minipig | FDA 2005 Table 3 |

Registry version **2026.10.2**; the full verified table and per-value sources are in
`docs/research/reference_params_verification.md` and `docs/09` §9.4.

Rules: a computation MUST pull these by id and record the registry **version** used. Changing a value
is a new registry version; it never silently alters past results.

## 4.10 What is predicted vs. measured (the honesty boundary)

- **Measured / literature:** anything from an assay or a database (ChEMBL affinity, measured LogD,
  measured fu). Provenance `MEASURED` or `LITERATURE` + citation.
- **Computed:** deterministic outputs of the equations above. Provenance `COMPUTED` + method id.
- **Predicted:** QSAR/ML estimates (e.g. predicted solubility, predicted fu,mic, predicted hERG from
  structure) — provenance `PREDICTED`, model named + versioned, **applicability-domain check** run and
  its result attached. A prediction outside the domain is surfaced as low-confidence, never hidden.
- The UI renders a distinct **provenance badge** for each kind so a scientist sees at a glance whether
  a number was measured, computed, or predicted.

## 4.11 Repeat-dose statistics  [`stats.dunnett`, `stats.group_summary`]

- Each dose group is compared with the concurrent control by Dunnett's many-to-one test
  (two-sided), per endpoint × sex × phase × timepoint, using `scipy.stats.dunnett` with a fixed
  quasi-Monte-Carlo seed so p-values reproduce. OECD TG 407/408 ¶51 require the method to be chosen
  at design and multiple t-tests to be avoided; NTP practice uses Dunnett and Williams (Jaki &
  Hothorn 2013).
- Assumptions: approximately normal residuals, homogeneous variances; no transformation applied.
- Statistical significance is not adversity. The NOAEL (FDA 2005 glossary definition) is determined
  and signed by the Study Director.
- Citations: Dunnett CW. *J Am Stat Assoc* 1955;50:1096, doi:10.1080/01621459.1955.10501294;
  Jaki T, Hothorn LA. *Arch Toxicol* 2013;87:1901; OECD TG 407 (2008), 408 (2018), 409 (1998).

## 4.13 Bioanalytical method validation  [`bioanalysis.*`]

- Calibration by least squares with the regression model and weighting (none, 1/x, 1/x²) fixed by
  the laboratory's written procedure (ICH M10 §3.2.4 prescribes no weighting); back-calculation by
  inverting the fitted curve.
- Accuracy = measured / nominal × 100; %CV = SD / mean × 100 (M10 glossary); between-run values
  combine the data of all accepted runs (M10 §3.2.5.2).
- Interference = blank response / LLOQ response × 100 for the analyte and the IS (M10 §3.2.1,
  §3.2.6).
- ISR % difference = (repeat − initial) / mean × 100; chromatography passes when ≥ 2/3 are within
  ±20%; minimum sample count 10% of the first 1000 plus 5% of the excess (M10 §5).
- Acceptance criteria are held in `hos/core/bioanalysis.py::M10_CHROMATOGRAPHIC` with the section
  stating each.
- Citation: ICH M10 Bioanalytical Method Validation and Study Sample Analysis, Step 4, 24 May 2022.

## 4.14 Non-compartmental exposure and toxicokinetics  [`nca.*`, `tk.*`]

- Cmax is the maximum observed concentration, taken without interpolation (FDA *Bioavailability
  Studies Submitted in NDAs or INDs*, April 2022, §III.A.9.a). Tmax is its time; a tied maximum
  takes the first occurrence.
- AUC(0-t) runs from time zero to the last measurable concentration (FDA 2022 §III.A.9.b; CDISC
  AUCLST). The trapezoidal rule is a stated input, because ICH M13A §2.2.2.2 requires the method to
  be reported:
  - linear: (t2 − t1)(C1 + C2)/2;
  - linear-up/log-down: on falling segments (t2 − t1)(C1 − C2)/ln(C1/C2), which is exact for a
    mono-exponential decline.

  The equations are from vendor documentation (Certara Phoenix 8.3), a secondary source. Purves
  1992 (abstract) found log-trapezoid-based schemes performed well. Actual sampling times are used
  (M13A §2.2.2.2).
- BLQ handling is one declared rule:
  - BLQ at or before the first quantifiable concentration is set to 0;
  - later BLQ samples are excluded.

  A profile without a time-zero sample has no AUC(0-t). AUC(0-τ) is reported only when the
  end-of-interval sample is quantifiable, because nothing is extrapolated.
- Monitoring designs (1–3 samples per interval, ICH S3A Note 1) report C(time) and Cmax only.
- Group summaries are mean (SD) and median (range) per dose × sex × day (ICH S3A §3.9).
- Dose proportionality uses the power model PK = β0·Dose^β1 (Smith et al. 2000, *Pharm Res*
  17:1278, doi:10.1023/A:1026451721686, abstract read).
  - **Fit.** Least squares of ln PK on ln dose over individual animals, as in Shang et al. 2022 for
    a parallel-group rat design. With one observation per animal, a random subject effect cannot be
    separated from residual error. The interval is a t-interval with n − 2 df.
  - **Criterion.** The confidence interval of β1 must lie inside
    [1 + ln θL/ln r, 1 + ln θH/ln r], with r = highest/lowest dose. This is the exact consequence of
    requiring Rdnm = r^(β1−1) to lie in (θL, θH) (Hummel et al. 2009). It reproduces the published
    values:
    - [0.6781, 1.3219] for r = 2, θ = 0.8/1.25 (Braeckman et al. 2022);
    - [0.500, 1.500] for r = 4, θ = 0.5/2 (Shang et al. 2022).
  - **Inputs.** θL, θH and the confidence level are stated in the protocol; no source fixes them.
  - **Transform.** The ln transform is the model's own form, which is the rationale ICH S3A §3.9
    asks for.
- The observed exposure ratio between profile days is a ratio of group means. It is called an
  accumulation ratio only if the Study Director determines steady state (CDISC ARAUC is defined at
  steady state).
- Exposure multiple = animal group mean / stated human exposure. Human exposure is an input with
  its own provenance.
- ISR follows M10 §5:
  - chromatographic: within ±20% for at least 2/3 of repeats;
  - ligand binding: within ±30% for at least 2/3 of repeats;
  - minimum count: 10% of the first 1000 samples plus 5% of the excess;
  - expected at least once per species for nonclinical studies.
- Quantifiable analyte in control or day-1 pre-dose samples is flagged, because ICH M10 §3.3.4 and
  §4.3.4 list it as a reason for reanalysis.
- Single-dose terminal parameters (`in_vivo_pk`):
  - **λz.** Least squares of ln C on t over the terminal points (FDA 2022 Appendix A §B: "three
    or more samples during the terminal log-linear phase … from linear regression"; ICH M13A
    §2.1.8). The terminal phase is the scientist's selection, entered as a start time per profile.
    Candidate fits over the last 3, 4, … points after Tmax are shown, with the vendor "best fit"
    (largest adjusted R², within 0.0001 preferring more points) marked as a suggestion.
    Adjusted R² = 1 − (1 − R²)(n − 1)/(n − 2).
  - **AUCinf** = AUC(0-t) + Clast/λz (FDA 2022 §III.A.9.b; observed Clast, CDISC AUCIFO).
  - **%extrapolated** = 100(AUCinf − AUC(0-t))/AUCinf (EMA BE guideline, "residual area").
  - **Other parameters:** t½ = ln2/λz; AUMC by the stated trapezoidal rule (linear
    δt(t1C1 + t2C2)/2 or logarithmic δt(t2C2 − t1C1)/ln(C2/C1) − δt²(C2 − C1)/ln(C2/C1)²);
    AUMCinf = AUMC(0-t) + tlast·Clast/λz + Clast/λz²; MRTinf = AUMCinf/AUCinf (minus Tinf/2 for
    an infusion); CL = Dose/AUCinf (CL/F extravascular); Vz = Dose/(λz·AUCinf); Vss = CL·MRTinf
    for intravenous dosing only.

    These come from Certara Phoenix 8.3 documentation, a secondary source; the AUMC images were
    checked against the exact integral of a mono-exponential. The CL–Vss–MRT relation is from
    Benet 2012 (AAPS J 14:164). All are exact for a one-compartment profile, which is the
    known-value test.
  - **IV bolus C0.** The observation at dose time, or log-linear back-extrapolation through the
    first two quantifiable points (Certara "NCA computation rules"). When those points do not
    decline, C0 is unavailable; the vendor's substitution of the first observation is not used.
  - **Concentration at dose time.** For extravascular and infusion dosing it is zero for a
    drug-naive single dose (declared), or a measured pre-dose sample.
  - **F.** F = (mean AUCinf_ev·Dose_iv)/(mean AUCinf_iv·Dose_ev). This assumes linear PK when the
    doses differ, and the report says so.
  - **Limits.** %extrapolated and adjusted-R² limits are optional inputs with a stated basis. The
    80% coverage rule of ICH M13A is a bioequivalence criterion, so it is not applied by default.

## 4.15 Plasma protein binding by equilibrium dialysis  [`ppb.*`]

- fu = C_buffer / C_plasma at the end of dialysis, per cell, with replicate mean and SD; %
  bound = 100(1 − fu). The source is the Pierce RED device user guide (Thermo Fisher, MAN0011571
  Rev. C.0), a secondary source. Waters et al. 2008 (J Pharm Sci 97:4586, abstract) validated the
  RED approach.
- A buffer concentration below the LLOQ bounds fu from above (fu < LLOQ / C_plasma); no value
  is imputed.
- In-study positive controls must be within 3-fold of the mean fu,p from the assay
  qualification (ICH M12 §7.2). M12 states this for human plasma in DDI work; the driver applies
  it to each species for which the protocol declares a positive control.
- A measured fu below 1% is reported, not replaced. It is flagged because ICH M12 §2.1.2.1 sets
  fu,p = 0.01 for DDI predictions unless reliability is demonstrated. Whether reliability is
  demonstrated is an optional responsible-scientist determination.
- Recovery (mass balance) and stability are not computed: no primary formula or consensus
  criterion was verified. Laboratory-reported values are checked against criteria stated with
  their basis. Di et al. 2012 (abstract) found low recovery did not bias fu once equilibrium is
  established.

## 4.16 Bacterial reverse mutation (Ames)  [`genetox.*`]

- The protocol is checked against OECD TG 471 (adopted 1997, corrected 2020); each error cites
  its paragraph:
  - ≥ 5 strains in the recommended combination (¶13), or a stated justification;
  - ± S9 (¶16);
  - ≥ 5 analysable concentrations (¶20);
  - top dose: 5 mg/plate (5 µL/plate) unless cytotoxicity or insolubility limits it (¶19,
    S2(R1) §3.2.1), and above 5 mg/plate only for substantial mutagenic impurities (¶21);
  - triplicate plating, duplicate only with a justification (¶29);
  - concurrent strain-specific positive and vehicle controls (¶22);
  - untreated controls unless waived on historical data (¶26);
  - 37 °C for 48–72 h (¶31).
- Results:
  - revertants per plate, mean and SD (¶32–33);
  - fold over the concurrent vehicle mean, **for information only**: neither TG 471 nor S2(R1)
    contains a fold rule (full-text search);
  - comparison with the facility's historical negative and positive ranges, which are required
    inputs (¶14, ¶39; S2(R1) §5.1).
- The call follows TG 471 ¶35–37: a concentration-related and/or reproducible increase, with
  biological relevance first and statistics only as an aid. It is a Study Director determination.

## 4.17 Dose range-finding and high-dose selection  [`tox.incidence`, `tox.exposure_margin_m3r2`]

- Group comparisons reuse the repeat-dose analysis (§4.11). The statistical test is a protocol
  choice: "none" (descriptive) or Dunnett with a stated α.
- Per-group incidence tables follow OECD TG 407 ¶50: animals at start, unscheduled deaths with
  their time, and animals showing each sign. M3(R2) §4: lethality should not be an intended
  endpoint, so any death is reported as a concern.
- M3(R2) §1.5 facts are stated when they apply:
  - the top dose against the 1000 mg/kg/day limit dose;
  - the exposure margin at the top dose (group-mean AUC, or Cmax per Note 1) against the 50-fold
    statement;
  - the exception (1000 mg/kg/day under a 10-fold margin **and** a clinical dose above 1 g/day →
    limit by 10-fold margin, 2000 mg/kg/day or the MFD).

  Exposures and the clinical dose are inputs with their own provenance.
- M3(R2) does not define the MTD. The protocol states the MTD criteria. The MTD, the high-dose
  basis and the recommended doses are Study Director determinations.

## 4.18 Potency and relative potency  [`pharm.relative_potency`]

- Each assay is fitted with the 4PL of §4.5, optionally with asymptotes fixed at 0 and 100%,
  and reports IC50/EC50 with a 95% CI and the Hill slope. A reference compound must fall in an
  acceptance range the protocol states with its basis. Otherwise the run fails, and no ratio
  is computed from it.
- Relative potency is off-target / primary 50% effective concentration (Ritz et al. 2015,
  "ratio of effective doses"). Its standard error is the first-order delta method for a ratio
  of independent estimates: SE(R) = R·√((SE_off/off)² + (SE_on/on)²).
  - It holds at the 50% effect level. With different Hill slopes it changes with the level, so
    both slopes are shown.
  - An off-target IC50 above the top concentration gives only a lower bound.
  - IC50s from assays under different conditions are not affinities. No Cheng–Prusoff
    conversion is applied; its source is NOT VERIFIED.
- No selectivity threshold is applied. None exists in ICH M3(R2), S7A, S7B or the E14/S7B Q&A.

## 4.19 CNS safety pharmacology and multi-part requirements  [`safety.observation_incidence`]

- **Domains.** ICH S7A §2.7.1 requires motor activity, behavioural changes, coordination,
  sensory/motor reflex responses and body temperature. It names the FOB (Mattsson et al. 1996),
  the modified Irwin's (Irwin 1968) or another test (Haggerty 1991). The itemised batteries
  could not be read, so the protocol lists its observations and scoring scales. Each
  observation maps to a domain, and a protocol that leaves a domain uncovered is refused.
- **Incidence.** Animals whose score differs from the protocol's normal score, per observation ×
  dose × sex × timepoint, giving the dose-response and time course of S7A §2.4.1. No incidence
  statistic is applied, because none is verified for S7A endpoints.
- **Continuous measures** use the group comparison of §4.11 against the vehicle group.
- **Multi-part requirements.** The S7A core battery (`safety.core_battery`) is made of the CNS,
  cardiovascular and respiratory parts (S7A §2.7.1–2.7.3).
  - Readiness reports it as `partial` until every part is covered by an approved driver-run
    study (its driver declares the part) or an import (the importer states the parts, which are
    signed into the import hash).
  - It is runnable in HOS only when the installed drivers cover every part.

## 4.20 Respiratory safety pharmacology  [`safety.minute_volume`]

- **Measures.** ICH S7A §2.7.3 requires respiratory rate and other measures of respiratory
  function, for example tidal volume (Murphy 1994) or haemoglobin oxygen saturation. The
  protocol must include rate and at least one other measure.
- **Tidal volume** is taken as reported by the acquisition system, which is recorded with its
  corrections. The barometric equation (Drorbaugh & Fenn 1955) is NOT VERIFIED and is not
  implemented.
- **Minute volume** = tidal volume × rate, per animal (Lim et al. 2014, J Vis Exp e51755; a
  secondary statement). S7A does not name it.
- **Comparison.** Each dose group is compared with vehicle at the same timepoint, using the
  §4.11 group comparison, descriptively or by Dunnett's test when stated. This time-matched
  design is an analysis choice consistent with S7A §2.3.1 and §2.4.1, not an S7A requirement.

## 4.21 In vivo QT and cardiovascular telemetry  [`cv.*`]

- **Corrections** (QT, RR in ms):
  - Fridericia: QT/RR^(1/3), RR in s (Fridericia 1920; stated in Vandenberk 2016).
  - Bazett: QT/RR^(1/2), RR in s. The formula is as stated in Vandenberk 2016. Bazett 1920 was
    not read, and the corrected form is attributed to Taran & Szilagyi 1947 (Cobos Gil 2008).
  - Van de Water: QT − 0.087(RR − 1000), from the 1989 abstract (anaesthetised dogs).
  - Individual: QT − b_i(RR − RR_ref), with b_i the least-squares slope of each animal's QT on RR
    in its vehicle data. This is the RR-linear form of Chui 2021 and Engwall 2023, and is
    preferred by E14/S7B Q&A 3.3 when the drug affects heart rate. RR_ref is a stated input.
- **Justification.** The choice must be justified with data from the test system (S7B §3.1.3).
  Independence is shown as the regression of QTc on RR (matched pairs, slope with 95% CI, Pearson
  r, p) for all data and for vehicle data (Q&A 3.3).
- **Changes** (Latin-square crossover, within animal):
  - Δ = post-dose − baseline, where the baseline is time-matched (E14 Q&A 4.2 definition) or
    pre-dose.
  - ΔΔ = Δ(treatment) − Δ(vehicle) at the same time.

  Each is reported as mean, 95% CI and two-sided p by Student's t (Student 1908), with no
  multiplicity adjustment. The mean % change from baseline is also reported (Q&A 3.5). The same
  applies to QT, heart rate, PR/QRS and blood pressure.
- **Exposure.** Mean Cmax per dose from samples on the PD day (Q&A 3.2 requires at least one),
  and its multiple of the stated high clinical Cmax. A top dose below the clinical exposure is
  flagged (S7B Q&A 1.1).
- **Thresholds.** No QTc threshold is encoded; the Q&A 3.4 millisecond figures are explicitly
  hypothetical. Assay sensitivity is the protocol's stated minimum detectable difference with its
  basis.
- **Core battery.** When blood pressure is measured, the study also covers the S7A
  cardiovascular part (S7B §2.3.2; S7A §2.7.2).

## 4.12 Methods deliberately out of scope initially (added later, each with citations when built)

PBPK (whole-body), QSP, population variability/Monte-Carlo, allometric interspecies PK scaling beyond
HED, formulation/solid-state prediction, image/omics pipelines. Each will be added to this document
with primary citations before implementation — same rule as everything else.
