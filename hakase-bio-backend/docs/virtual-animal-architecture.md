# Virtual Animal — Scientific Feasibility & Architecture Evaluation

**Status:** Planning only. No implementation.
**Scope:** Redesign the animal-testing prediction layer into a modular, multi-organ, multi-modality *in silico* animal that predicts real animal-study endpoints (per `Variables_AnimalLayer.odt`).
**Governing goal:** A **quantitatively validated** system that can *reduce, prioritise, or partially replace specific* animal experiments — not a visually impressive "digital animal."

---

## 0. TL;DR verdict

- **The concept is sound, but the "organ-on-chip" framing is the wrong metaphor and will mislead the architecture.** What you are actually describing already exists as a research field: it is **whole-body PBPK coupled to QSP (quantitative systems pharmacology) organ modules, anchored on Adverse Outcome Pathways (AOPs), with a hybrid mechanistic + ML implementation.** Adopt that vocabulary and that literature.
- **A "middle-out" physiological model is the correct backbone**, not a set of independent organ neural nets. The circulatory PBPK layer is what makes organ predictions *coupled* rather than independent. This is exactly the property you said you want ("integrated through a physiologically meaningful framework").
- **Feasibility is highly heterogeneous across your endpoint list.** Roughly: exposure/PK/TK and a handful of well-studied organ toxicities (liver, cardiac electrophysiology) are **feasible today** with honest uncertainty; quantitative multi-organ histopathology/clinical-pathology across arbitrary compounds is **research-grade**; full-modality (mAb/nucleic-acid) organ tox and de-novo efficacy/immunogenicity are **currently speculative**.
- **The single largest scientific constraint is not compute or ML architecture — it is data and causal identifiability.** Tissue-level, mechanism-resolved, cross-species training data are sparse and mostly observational. This caps what can be learned, and it is why mechanistic priors (PBPK/QSP/AOP) are non-negotiable: they supply the causal structure the data cannot.
- **Recommended posture:** Do not attempt the whole animal at once. Build a **validated small-molecule PBPK exposure engine + AOP-anchored hazard layer with calibrated uncertainty** first (this alone is a large upgrade over the current toy), then add organ QSP modules one at a time where a defensible dataset exists (liver → heart → kidney), then expand modalities.

---

## 1. Reframing: why "organ-on-chip" is the wrong metaphor

Organ-on-chip / microphysiological systems (MPS) are *physical* devices whose computational models are built to **interpret a specific chip experiment** (flow rates, membrane areas, cell counts of that device). Copying that structure into a pure-simulation "virtual animal" imports the chip's artifacts (non-physiological scaling, device geometry) without its one advantage (real cells). The useful part of the MPS analogy — *modular organs connected by a circulating medium* — is already the definition of **PBPK**. So take the modularity idea and drop the chip.

The correct conceptual stack, in increasing biological ambition:

| Layer | What it is | Maturity |
|---|---|---|
| **PBPK** | Whole-body ODE model: organs as compartments, coupled by blood flow; predicts concentration-vs-time in each tissue | Mature, regulatory-accepted for specific uses |
| **PK/PD + TMDD** | Links tissue exposure to receptor occupancy / effect | Mature for defined targets |
| **QSP** | Mechanistic ODE models of a pathway/organ's biology (e.g. DILIsym liver) | Mature for a *few* organs, bespoke |
| **AOP-anchored toxicology** | Causal chain: molecular initiating event → key events → organ adverse outcome | Framework mature; quantitative instances partial |
| **Virtual populations / digital twin** | Parameter distributions → simulated cohorts, individualised | Emerging; credible for PK, hype-prone for tox |

Your proposed data flow — *therapeutic → modality-specific disposition → circulation → organ exposure → organ response → integrated readout* — is **correct** and maps cleanly onto this stack. Keep it. Just implement each arrow with the mature machinery above rather than free-standing per-organ NNs.

---

## 2. Closest existing fields & state of the art

**PBPK engines (exposure/distribution).**
- Commercial: **Simcyp** (Certara), **GastroPlus** (Simulations Plus) — the regulatory workhorses.
- Open source: **PK-Sim / MoBi** (Open Systems Pharmacology suite) — full whole-body PBPK, extensible, the natural reference implementation to study/borrow structure from. **httk** (EPA R package; Pearce, Wambaugh et al.) — high-throughput toxicokinetics + IVIVE, open, validated across hundreds of chemicals; the best open starting point for small-molecule TK at scale.

**QSP organ/tox models (response).**
- **DILIsym** (DILI-sim Initiative / Simulations Plus; Watkins et al.) — multiscale mechanistic liver injury model (mitochondrial dysfunction, bile-acid transport, hepatocyte life-cycle). The canonical proof that quantitative organ tox modelling *can* work, and the canonical proof of how much bespoke effort it takes. Sister models: **RENAsym** (kidney), **NAFLDsym**, cardiac QSP.
- **Cardiac electrophysiology / CiPA:** ion-channel block (hERG + others) → **O'Hara-Rudy** ventricular action-potential model → proarrhythmia risk. The FDA-endorsed CiPA initiative is the best example of a mechanistic organ model accepted for regulatory decision-making.

**Computational toxicology / hazard.**
- **AOP framework** (Ankley et al. 2010; OECD; AOP-Wiki) — the causal scaffolding for tox.
- **ToxCast / Tox21** (EPA/NIH) — thousands of chemicals × hundreds of in-vitro assays; the substrate for in-vitro-to-in-vivo tox.
- QSAR/ML hazard classifiers: DILI, hERG, Ames, carcinogenicity — mature as *flags*, not as quantitative severity.

**Toxicogenomics (the bridge to histopath/clin-path).**
- **Open TG-GATEs** (Igarashi et al. 2015) — ~170 compounds, rat (and human hepatocyte) liver/kidney, multiple doses/times, with **gene expression + clinical chemistry + histopathology**. This is *the* dataset that makes quantitative organ-tox learning even thinkable.
- **DrugMatrix** (US NTP) — similar toxicogenomics + pathology.
- **eTOX / eTRANSAFE** (IMI) — pooled legacy pharma preclinical tox reports; the largest structured repository of exactly the endpoints in your reference doc, though access is restricted.

**Biologics & new modalities.**
- mAb PBPK: **Shah & Betts (2012)** platform model; FcRn recycling; **two-pore theory** for extravasation; **TMDD** (Mager & Jusko 2001).
- Nucleic acids: GalNAc-siRNA hepatocyte-targeted PK/PD models; ASO tissue-accumulation models — early, mostly liver-centric, sparse.

**Virtual populations / uncertainty.**
- Allen, Rieger, Musante (2016, *CPT:PSP*) — plausible-patient / virtual-population generation for QSP. The accepted method for turning a single model into a calibrated cohort with uncertainty.

**Bottom line on SOTA:** every *component* you need exists and is published. Nobody has assembled a *validated, general, multi-modality* whole-animal predictor of the full GLP endpoint set — because the data to validate it at that breadth do not exist. That gap is the honest boundary of the project.

---

## 3. Feasibility triage (A / B / C) mapped to your endpoint doc

Using the sections of `Variables_AnimalLayer.odt`:

### A — Feasible today with reasonable validation
- **§8 Toxicokinetics** (Cmax, Tmax, AUC, plasma conc–time, CL, Vd, T½) for **small molecules** via whole-body PBPK + IVIVE. Typical accuracy: within ~2–3× of observed for well-behaved compounds; better with any calibration data. This is the strongest, most defensible deliverable.
- **§4/§6 dosing→exposure** relationships: dose linearity, accumulation on repeat dosing, route effects (with an absorption model per route).
- **Cardiac proarrhythmia flag** (subset of §11 heart / §7 relevant): ion-channel → AP model, reasonably validated.
- **Hazard flags** for liver (DILI), mutagenicity (Ames), hERG — as **calibrated probabilities**, mapping to §12 target-organ toxicity *qualitatively*.
- **Allometric HED / FIH dose** and NOAEL-margin arithmetic (your current system's job) — but now with uncertainty.

### B — Possible but requires substantial research/data
- **Quantitative liver injury** (ALT/AST fold-elevation in §7C, hepatic histopath severity in §11) via DILIsym-style QSP — achievable for compounds resembling the calibration set; expensive per-compound.
- **§7 clinical pathology panels** (hematology, clin chem, urinalysis) as *directional/semi-quantitative* shifts for a few well-modelled toxicities.
- **§9 organ weights** changes for organs with a mechanistic driver (liver hypertrophy from enzyme induction; thymus/adrenal from stress/steroid signalling).
- **Biologics disposition** (mAb PBPK + TMDD + FcRn) — models exist; per-target calibration is the bottleneck.
- **Target-mediated PD / on-target organ efficacy** for well-characterised pathways with known tissue target expression.
- **Cross-organ interactions** where a mechanism is known (hepatic reactive metabolite → systemic exposure → secondary organ).

### C — Currently speculative or scientifically unjustified
- A **single model predicting the full §11 histopathology set** (24 organs × finding-type × severity grade) for arbitrary compounds. No dataset supports this breadth; most organ-finding combinations have near-zero training instances.
- **Idiosyncratic / immune-mediated toxicity**, DILI of the unpredictable class, **immunogenicity / anti-drug antibodies** for biologics.
- **De novo efficacy** without a disease-specific QSP model.
- **Nucleic-acid organ toxicity and innate-immune activation** end-to-end.
- **Metabolite-driven toxicity** where the toxic metabolite is not predicted from the parent structure.
- Any claim to **replace a GLP study for regulatory submission**. Realistic near-term value is *reduce/prioritise/refine* (the 3Rs), not *replace*.
- Inferring **causal physiology purely from observational study data** without mechanistic priors (see §9, §10) — this is a formal identifiability problem, not a data-volume problem.

The practical implication: **the reference doc is the eventual target schema, but the MVP should populate only the §8 (TK) block quantitatively, §12/§13 as calibrated risk with uncertainty, and explicitly return "not predicted / out of scope" for the rest.** Honest nulls are a feature; fabricated histopath is a liability.

---

## 4. Proposed architecture

A **middle-out hybrid**: mechanistic PBPK/QSP backbone providing causal structure, ML filling parameter-prediction and data-rich response gaps, Bayesian layer providing uncertainty. Ten components, matching your request:

### 4.1 Therapeutic representation (modality-plug front-end)
A modality-specific encoder whose **only contract** is to emit a standardised **disposition parameter vector** consumed by the PBPK core. Decoupling here is what makes the system modality-agnostic.
- Required outputs of the contract (per modality, by whatever means): fraction unbound `fu`, blood:plasma ratio, tissue partition coefficients `Kp` (or the inputs to predict them), intrinsic clearance / catabolism route, permeability, target identity + affinity, and (for large molecules) charge/size for extravasation.
- Small molecule: SMILES/graph → RDKit descriptors + GNN embeddings → physchem → `Kp`/`fu`/`CLint` predictors (Poulin-Theil / Rodgers-Rowland for `Kp`).
- Biologics/NA: sequence + chemistry descriptors → different predictors (below, §5).

### 4.2 Species & strain representation
A **physiological parameter database** keyed by (species, strain, sex, age, body weight), holding organ volumes, blood flows, GFR, plasma protein levels, and **enzyme/transporter abundances** and **target-ortholog expression** per organ. Built on published reference physiologies (mouse/rat/dog/monkey/human) with allometric priors to fill gaps. Strain/sex/age/disease enter as *modifiers* on these parameters, not as new hard-coded templates. This replaces the current 6 hard-coded species dicts with a parameterised, extensible ontology.

### 4.3 Physiological / PBPK layer (the coupling backbone)
Whole-body ODE model: each organ a perfusion- or permeability-limited compartment, coupled by arterial/venous blood flow — the shared circulation is what makes organ outputs *dependent*. This is the single most important, most defensible layer. Emits the tissue exposure profiles that feed every organ module. Absorption sub-models per route (oral: dissolution/BCS/gut; IV; SC; inhalation). Repeat-dose scheduling → accumulation.

### 4.4 Organ-specific response modules (pluggable)
Each organ = **exposure node (from PBPK) + response model**, behind a uniform interface `(local exposure(t), target expression, physiology, species, experimental context) → organ endpoints + uncertainty`. Implementation is *chosen per organ by data availability* (see §7):
- Liver → mechanistic QSP (DILIsym-class) where justified.
- Heart → ion-channel + AP electrophysiology model.
- Kidney → hybrid QSP + IVIVE for transporter-mediated tox.
- Data-poor organs → AOP-anchored ML hazard/severity, explicitly flagged lower-confidence.

### 4.5 PK/PD modelling
Target engagement via receptor occupancy (small molecule) or TMDD (biologics); effect via mechanistic or indirect-response (Dayneka/Jusko) models; efficacy only where a disease/pathway QSP exists. Separates **exposure** (well-predicted) from **effect** (target- and disease-dependent, weaker).

### 4.6 Toxicity modelling (AOP-anchored)
Structure the tox layer as explicit AOPs: **molecular initiating event** (structural alert, in-vitro assay hit, off-target affinity) → **key events** (mitochondrial dysfunction, oxidative stress, covalent binding, transporter inhibition) → **organ adverse outcome** (necrosis, ALT rise, weight change). Combine QSP (quantitative, few organs) + ML classifiers (broad, qualitative). Map outputs onto the reference doc's ordinal severity (None→Severe) as a **calibrated ordinal prediction with confidence**, never a bare grade.

### 4.7 Target & pathway knowledge layer
A knowledge graph: target → tissue expression (species-specific expression atlases: Human Protein Atlas, Bgee, Tabula Muris/rat atlases) → pathway (Reactome/KEGG) → AOP-Wiki links. Feeds both organ efficacy (is the target even expressed there?) and on-target organ tox.

### 4.8 Cross-organ interactions
Two coupling mechanisms, kept distinct: (a) **exposure coupling** — automatic, via the PBPK circulation (metabolite formed in liver reaches kidney); (b) **biological coupling** — explicit QSP edges for known cross-talk (hepato-renal, cytokine cascades, hormonal axes). Represent as a directed graph over organ modules; only add edges with mechanistic support — do not learn spurious organ–organ correlations from small observational datasets.

### 4.9 Uncertainty estimation (first-class, not an afterthought)
- **Parameter uncertainty:** physiological priors → Bayesian calibration → posterior.
- **Structural/model discrepancy:** explicit discrepancy term where validated.
- **Propagation:** Monte-Carlo / virtual-population sampling → predictive intervals, not point estimates.
- **Separate aleatoric** (real biological variability across animals) **from epistemic** (model ignorance).
- **Applicability domain / OOD detection** on the therapeutic representation — refuse or down-weight out-of-domain compounds.
- **Calibration metrics** reported: interval coverage, reliability diagrams. A prediction without a calibrated interval is not a deliverable.

### 4.10 Experimental-condition representation
Dose, route, frequency, duration, recovery, formulation, fasting/diet, housing — as **explicit typed inputs to the equations** (formulation → dissolution → absorption input; schedule → dosing function; not free-text). This is what lets the same model answer "what if we change the route/schedule/formulation," which is the actual value proposition for study design.

---

## 5. How the architecture differs by modality

The PBPK backbone, uncertainty layer, and organ-response interface are shared. The **disposition front-end and the dominant tox mechanisms differ fundamentally.**

| Aspect | Small molecule | Peptide / protein | Monoclonal antibody | Nucleic acid (ASO/siRNA/mRNA) |
|---|---|---|---|---|
| Representation | SMILES / graph | Sequence + structure + physchem | Sequence, isotype, pI/charge, glycosylation, FcRn/target affinity | Sequence, backbone/2′-chemistry, length, delivery (GalNAc, LNP) |
| Distribution | Perfusion-limited, lipophilicity-driven `Kp` | Size/charge-limited; interstitial | **Two-pore** extravasation; vascular/interstitial; slow | Delivery-dominated; LNP → liver/spleen; GalNAc → hepatocyte |
| Clearance | CYP/UGT metabolism, renal, biliary | Proteolysis, renal (small peptides) | **FcRn-recycled**; catabolism to peptides; **TMDD** | Nuclease degradation; endosomal; renal (small) |
| Target engagement | Reversible occupancy | Receptor binding | High-affinity, **TMDD/target sink** | RNA hybridisation (antisense) / RISC (siRNA) / translation (mRNA) |
| Dominant tox | Off-target, reactive metabolites, hERG, DILI | Immunogenicity, on-target exaggerated pharmacology | **Immunogenicity/ADA, CRS, on-target**, FcγR effector | Innate immune (TLR), hepatotox, complement, on/off-target hybridisation |
| Modelling maturity | High (PBPK mature) | Moderate | Moderate (platform PBPK exists; TMDD calibration hard) | Low (liver-centric, sparse) |
| Feasibility tier | A (exposure), B (tox) | B / C | B (PK), C (immunogenicity) | C mostly |

**Design consequence:** the modality front-ends are *not* interchangeable models with a swapped input encoder — they carry **different physics** (two-pore vs perfusion; FcRn recycling; nuclease catabolism). Build them as separate disposition models that satisfy the common parameter contract, exactly as you intuited. A single universal molecular representation across all four is **not** scientifically justified.

---

## 6. Datasets: what's needed and whether it exists

| Component | Datasets | Public sufficiency |
|---|---|---|
| Small-molecule PK/TK | ChEMBL, PK-DB, httk data, OSP library, literature PBPK models | **Adequate** for calibration/validation of exposure |
| IVIVE parameters (fu, CLint, Kp) | httk, in-vitro hepatocyte/microsome data, literature | **Adequate** for small molecules |
| Liver tox (quantitative) | **Open TG-GATEs**, DrugMatrix, DILIrank | **Marginal** — enough for a liver module, not general tox |
| Broad hazard flags | ToxCast/Tox21, ToxRefDB, ToxValDB | **Adequate** for qualitative flags |
| Full GLP endpoints (histopath/clin-path, your doc) | eTOX/eTRANSAFE (restricted), internal pharma | **Insufficient/inaccessible** publicly |
| Cardiac | hERG datasets, CiPA ion-channel panels | **Adequate** for proarrhythmia |
| Tissue target expression | Human Protein Atlas, Bgee, Tabula Muris/rat atlases | **Adequate**, species gaps |
| mAb / biologics PK | Sparse public; some literature platform data | **Insufficient** — mostly proprietary |
| Nucleic-acid PK/tox | Very sparse, scattered literature | **Insufficient** |
| Cross-species mapping | Ortholog DBs, comparative physiology literature | **Partial** |

**Honest read:** public data are sufficient to build and validate a **small-molecule exposure engine + liver/cardiac tox + hazard flags with uncertainty.** They are *not* sufficient to train a general multi-organ histopathology predictor, nor biologics/nucleic-acid tox, without proprietary data (eTRANSAFE-class) or generating your own. Plan the roadmap around this data reality, not around the ideal endpoint list.

---

## 7. Representing animal variables

Represent each variable as a **typed modifier on physiological parameters or on the dosing/PD functions**, never as free text and never as an opaque one-hot into a black box:

- **Species / strain:** selects the base physiological parameter set + enzyme/transporter abundances + target ortholog. Strain = modifier (e.g., known metabolic polymorphisms).
- **Sex:** modifiers on enzyme expression, body composition, hormonal axes, organ weights.
- **Age:** scales organ maturation, enzyme ontogeny, GFR, body composition.
- **Body weight:** drives allometric scaling of volumes/flows/clearance; sampled per-animal for virtual cohorts.
- **Disease state:** a QSP/physiology *perturbation* (e.g., hepatic impairment ↓CLint; inflammation ↑cytokines, ↓CYP; tumour as a target sink) — this is where efficacy models plug in.
- **Dose / route / schedule:** explicit inputs to absorption and dosing functions; schedule → accumulation via the ODE forcing term.
- **Formulation:** → dissolution/BCS model → absorption-rate input (extends the existing BCS logic, done properly).

The key principle: variables act **through the mechanism**, so the model can extrapolate to unseen combinations. A one-hot-into-NN approach cannot, and will silently fail out-of-distribution.

---

## 8. Model type per organ: mechanistic vs ML vs hybrid vs PBPK/QSP/graph

**Decision rule = data availability × mechanistic knowledge:**

- **Exposure everywhere → PBPK compartments** (mechanistic ODE). Non-negotiable backbone.
- **Well-understood, data-supported organ tox → QSP** (liver, cardiac electrophysiology). Mechanistic, extrapolates, expensive to build.
- **Data-rich but mechanism-partial → hybrid mechanistic-ML** (ML predicts QSP parameters or a residual/discrepancy term on top of the mechanistic core). This is the sweet spot for most organs.
- **Data-poor → AOP-anchored ML hazard/severity classifier**, explicitly lower-confidence, qualitative.
- **Cross-organ structure → directed graph over modules**, edges = PBPK flows (automatic) + curated mechanistic couplings (manual). **Not** a learned graph neural net over organs — insufficient data, and it would learn confounded correlations, not causation.

**Explicitly reject:** independent per-organ neural nets with no physiological coupling (your instinct here is right — they'd be mutually inconsistent, uncalibrated, and non-extrapolating). The value is in the coupling, and coupling is mechanistic.

---

## 9. Validation strategy

The difference between a credible tool and a demo is entirely in validation rigour.

- **Splitting:** never random-split by row. Split by **compound/scaffold** (cluster-based), and additionally do **leave-target-class-out** and **temporal/prospective** splits. Analogues in train+test = leakage.
- **Leakage controls:** dedupe compounds across splits including near-duplicates/salts/analogues; ensure the *same study* isn't split across train/test; watch for **target leakage** (same target → same tox); hold out whole **compound series**.
- **External validation:** validate on compounds/species *not* used in any calibration, ideally from an independent source (e.g., calibrate on TG-GATEs, test on DrugMatrix).
- **Endpoint-level validation** against actual study data: predicted vs observed Cmax/AUC (fold-error distribution, % within 2×/3×); ALT/histopath severity as ordinal agreement (weighted κ), not accuracy.
- **Uncertainty calibration:** predictive-interval **coverage** (does the 90% interval contain truth 90% of the time?), reliability diagrams, sharpness. An overconfident model is worse than a humble one here.
- **Prospective validation:** the gold standard — commit predictions *before* an experiment is run, then compare. Design a small prospective loop early; it's the only evidence that survives scrutiny.
- **Negative/positive controls:** known-safe and known-toxic reference compounds; permutation tests (shuffle labels → performance should collapse) to prove the model isn't exploiting artifacts.
- **Species-transfer validation:** predict rat→dog or rat→monkey to test whether the physiological layer genuinely transfers.

Report everything with confidence intervals and per-endpoint, per-modality breakdowns. A single headline accuracy across pooled endpoints is a red flag.

---

## 10. Largest scientific failure modes

1. **Causal inference from observational data.** Study datasets are observational; you cannot in general recover causal organ physiology from them without mechanistic priors. This is *the* foundational limit and the reason the architecture is mechanism-first. ML that ignores it will learn dataset confounders (dose-selection bias, compound-class artifacts).
2. **Out-of-distribution compounds/modalities.** Novel chemotypes and any non-small-molecule modality fall outside the training domain; naive models extrapolate confidently and wrongly. Mitigate with hard applicability-domain gating and honest OOD refusal.
3. **Insufficient tissue-level data.** Most organ×finding×severity cells are empty. Prevents general histopath prediction; forces per-organ scoping.
4. **Species-specific biology.** CYP isoform differences, target-ortholog pharmacology, immune-system divergence — cross-species transfer is exactly where preclinical→human translation *already* fails; a model can encode but not eliminate this.
5. **Nonlinear / saturable PK.** TMDD, enzyme/transporter saturation, autoinduction — linear/allometric shortcuts break at the doses that matter for tox.
6. **Immune responses & immunogenicity.** ADA against biologics, cytokine release, innate immune activation by nucleic acids — poorly predictable from structure, high-consequence.
7. **Reactive metabolites.** Toxicity often driven by a metabolite not obvious from the parent; requires metabolite prediction + downstream tox, compounding uncertainty.
8. **Formulation & food effects.** Large, real effects on exposure; often missing from training data.
9. **Idiosyncratic toxicity.** By definition not predictable from average pharmacology.
10. **Overfitting to the endpoint list.** The reference doc is a *reporting* schema; treating every field as a prediction target invites fabricating unlearnable outputs. Discipline: predict what's supported, null the rest.

---

## 11. Development roadmap (MVP → platform)

**Phase 0 — Honest MVP (small-molecule exposure + calibrated hazard).**
Replace the current toy with a proper whole-body small-molecule **PBPK exposure engine** (borrow structure from PK-Sim/httk), IVIVE parameterisation, allometric species scaling, virtual cohorts, and **calibrated uncertainty**. Add **AOP-anchored hazard flags** (DILI/hERG/Ames) as probabilities. Output: reference-doc **§8 TK quantitatively**, **§12/§13 as calibrated risk**, explicit nulls elsewhere. Validate exposure on ChEMBL/PK-DB with scaffold splits + coverage. *This alone is a defensible, shippable upgrade.*

**Phase 1 — First mechanistic organ modules.**
Add **liver** (DILIsym-class QSP or hybrid, validated on TG-GATEs) and **cardiac** (ion-channel→AP). Now predict quantitative liver clin-chem shifts (§7C) and proarrhythmia. Establish the pluggable organ-module interface and the prospective-validation loop.

**Phase 2 — Modality expansion + virtual populations + cross-organ.**
Add **mAb** disposition (platform PBPK + TMDD + FcRn) and peptides. Add kidney module. Add curated cross-organ edges. Full virtual-population uncertainty. Biologics tox stays qualitative.

**Phase 3 — Research frontier.**
Nucleic-acid modality, disease-model efficacy (QSP), broader histopathology where data permit, immunogenicity as explicit research modules with loud uncertainty. Continuous prospective validation feeding recalibration.

Gate each phase on **validation evidence**, not feature completeness. Never advertise a capability past its validated tier.

---

## 12. Concrete recommendation for Hakase

1. **Adopt the PBPK/QSP/AOP framing and vocabulary** in code and docs; retire "organ-on-chip" as an architectural metaphor (fine as a UX narrative only).
2. **Rebuild the small-molecule exposure engine properly first** — it's the highest-value, most-defensible piece and the current one is both primitive and orphaned (frontend runs a separate TS reimplementation; the Python engine is unused).
3. **Make uncertainty and applicability-domain first-class from day one.** For a tool meant to influence whether animals are used, a calibrated "we don't know" is the core product, not a caveat.
4. **Treat the reference-doc endpoint list as the eventual schema but predict into it incrementally**, returning explicit "not predicted" for unlearnable fields. This protects credibility with the science team.
5. **Design one prospective validation experiment early** — it is the only evidence that will convince a toxicologist or a regulator.
6. **Scope modalities honestly:** small molecule now, mAb/peptide as research, nucleic acid as frontier. Build the modality-plug interface now so the architecture doesn't have to be rewritten later.

**Final judgment:** Feasible as a *decision-support and prioritisation* tool that reduces and refines animal use for small molecules within the next development cycles, with liver/cardiac organ tox as credible extensions. Not feasible, and not honestly claimable, as a general full-endpoint animal replacement across all modalities. Build toward the former; market only what each phase has validated.
