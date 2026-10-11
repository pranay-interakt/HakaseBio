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
  recorded and a QC flag if R² below threshold or if depletion < ~20% (poorly estimable).
- **Assumptions/limits:** first-order (substrate ≪ Km), no significant non-specific binding unless
  corrected (see fu,mic below), linear region only.
- **Citation:** Obach RS. *Drug Metab Dispos* 1999;27(11):1350 (the canonical IVIVE depletion method);
  Di L, Obach RS et al. for assay practice.

## 4.3 Microsomal binding correction  [`adme.fu_mic`]

- **Purpose:** free fraction in the microsomal incubation (`fu,mic`) corrects CLint for non-specific
  binding to microsomal lipid. Can be measured (equilibrium dialysis) or predicted from LogP/D.
- **Predicted model (labeled `PREDICTED`):** Hallifax & Houston 2006 relationship
  `fu,mic = 1 / (1 + C·10^(a·logP/D + b))` with published coefficients and microsomal concentration C;
  applicability-domain check on LogP range required.
- **Citation:** Hallifax D, Houston JB. *Drug Metab Dispos* 2006;34:724.

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

- **Equation (4-parameter logistic / Hill):**
  `response = bottom + (top − bottom) / (1 + (IC50 / C)^hillslope)` (inhibition form),
  fit by non-linear least squares (SciPy `curve_fit`) with bounds; report IC50/EC50, Hill slope,
  top/bottom, and the fit covariance → **confidence interval** on IC50.
- **Inputs:** concentration–response pairs (`MEASURED`). **Output:** `IC50` as `Quantity(µM)` with CI,
  provenance `COMPUTED`; fit R²/convergence recorded; QC flag if curve does not plateau or fit fails.
- **Limits:** requires an adequate concentration range bracketing the inflection; flags extrapolated
  IC50 when the top/bottom asymptote is not reached.
- **Citation:** standard 4PL pharmacology (e.g. DeLean, Munson & Rodbard. *Am J Physiol* 1978;235:E97).

## 4.6 hERG cardiac safety margin  [`safety.herg_margin`]

- **Equation:** `safety margin = IC50(hERG, free) / Cmax(free, therapeutic)`.
- **Interpretation thresholds** are encoded as **cited guideline/heuristic bands with the citation**
  (e.g. the ~30× margin discussion in Redfern et al. 2003), and are always shown *with* the raw margin
  and the source — never as an unattributed verdict.
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
  cited condition). Compare against the **pharmacologically active dose (PAD)**; if PAD-derived is lower,
  use it (flagged for biologics, vasodilators, anticoagulants, growth factors).
- **Biologics / immune agonists:** MABEL approach (receptor occupancy / EC20 in human target cells),
  take the **lowest** of NOAEL-HED, PAD, MABEL. **Advanced cancer:** ICH S9 — 1/10 rodent STD10 or
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
| `qh.human` | 20.7 | mL/min/kg | human | Davies & Morris, *Pharm Res* 1993;10:1093 |
| `mppgl.human` | 40 | mg/g liver | human | Barter ZE et al., *Curr Drug Metab* 2007;8:33 |
| `liverwt.human` | 21.4 | g/kg BW | human | Barter 2007 / Davies & Morris 1993 |
| `km.human` | 37 | kg/m² (BSA factor) | human | FDA 2005 MRSD guidance |
| `km.rat` | 6 | — | rat | FDA 2005 |
| `km.dog` | 20 | — | dog | FDA 2005 |
| … | … | | | (full table maintained in the registry; this is an excerpt) |

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

## 4.11 Methods deliberately out of scope initially (added later, each with citations when built)

PBPK (whole-body), QSP, population variability/Monte-Carlo, allometric interspecies PK scaling beyond
HED, formulation/solid-state prediction, image/omics pipelines. Each will be added to this document
with primary citations before implementation — same rule as everything else.
