# Scientific Service Specification — Safety Service

---

# 1. Purpose and Scope

## 1.1 Purpose

The Safety Service is the fifth and final Scientific Service in the Version 3 evidence-generation pipeline. Its purpose is to predict computationally identifiable biological liabilities associated with peptide therapeutics — immune recognition, toxicity, and off-target interaction — while explicitly communicating the uncertainty and applicability of every such prediction.

This specification expands Section 5.8 of the Architecture Specification into a complete scientific design. It defines the biological rationale, computational methods, mathematical foundations, and evidentiary outputs of the service, remaining technology-independent except where the Recommended Engineering Stack has already designated specific tools (NetMHCpan, IEDB Tools, ToxinPred2, HemoPI, AllerTOP).

## 1.2 Scope

In scope:

- Scientific responsibilities of the Safety Service.
- The internal computational pipeline, expressed as capabilities rather than code.
- The algorithms and mathematical models underlying immunogenicity, toxicity, hemolysis, allergenicity, and off-target risk prediction.
- The biological rationale for every analysis.
- Construction of the Safety Evidence Object.
- Confidence estimation, failure handling, and performance characteristics specific to this service.

Out of scope (defined elsewhere, per the Architecture Specification):

- Intrinsic physicochemical descriptor computation (Physicochemical Service, an upstream input consumed here as context).
- Tertiary structure and complex prediction (Structural Biology Service, an upstream input consumed here as context).
- Biological activity and target engagement prediction (Functional Analysis Service, an upstream input consumed here as context).
- Manufacturability, formulation, and stability assessment (Developability Service).
- Evidence integration and GO / Conditional GO / NO-GO logic (Decision & Validation Framework, Chapter 6).
- API contracts, database schemas, and deployment topology (Platform Infrastructure Layer, Chapter 4).
- **Experimental safety confirmation of any kind.** As stated explicitly in the Architecture Specification (Section 5.8, Implementation Notes), safety predictions represent computational hypotheses and must always be interpreted alongside experimental validation; this service never substitutes for that validation.

## 1.3 Position in the Platform

```text
Peptide Object   Structural Evidence   Functional Evidence
       │                 │                     │
       └─────────────────┼─────────────────────┘
                          ▼
             ──────────────────────────────
                   Safety Service
             ──────────────────────────────
                          │
                          ▼
                Safety Evidence Object
                          │
                          ▼
             Decision & Validation Framework
```

The Safety Service is the last Scientific Service to execute before evidence integration, and consumes the Peptide Object directly (for sequence-level epitope and toxicity scanning) alongside Structural Evidence (for solvent-exposure-aware epitope and off-target analysis) and Functional Evidence (for context on the intended target and mechanism, which shapes what counts as "off-target"). Because the Decision Layer weighs safety liabilities heavily in its GO / Conditional GO / NO-GO determination, this service carries a particular obligation — stated explicitly in the Architecture Specification — to communicate uncertainty and applicability rather than present predictions as settled fact.

---

# 2. Scientific Responsibilities

| Responsibility | Description |
|---|---|
| Immunogenicity Assessment | Predict immune recognition, including MHC binding and T-cell epitope potential. |
| Toxicity Assessment | Estimate peptide toxicity, including membrane-disruptive (hemolytic) and general cytotoxic liability. |
| Off-Target Analysis | Identify potential unintended interactions beyond the intended biological target. |
| Allergenicity Assessment | Estimate the likelihood of IgE-mediated allergic response. |
| Risk Quantification | Estimate the confidence and applicability of every safety prediction. |
| Evidence Generation | Publish the Safety Evidence Object. |

The service explicitly does **not**:

- Recompute physicochemical descriptors, structural models, or functional predictions; it consumes them as context.
- Assess manufacturability, formulation, or stability (Developability Service).
- Make any therapeutic risk/benefit judgment. It reports what liabilities the evidence supports, never whether those liabilities are acceptable given the peptide's potential benefit — that weighing is the responsibility of the Decision Layer.

This mirrors the Architecture Specification's explicit statement that safety predictions represent computational hypotheses to be interpreted alongside experimental validation (Section 5.8), and preserves the platform-wide separation between scientific computation and scientific decision making (Sections 1.4, 1.5).

---

# 3. Inputs and Outputs

## 3.1 Inputs

| Input | Description | Origin |
|---|---|---|
| Peptide Object | The standardized, canonicalized peptide representation (sequence, modification graph) | Physicochemical Service |
| Structural Evidence | Predicted tertiary structure and per-residue confidence, used for solvent-exposure-aware epitope and interaction analysis | Structural Biology Service |
| Functional Evidence | Declared modality, intended target, and predicted target engagement, used to define the scope of "off-target" analysis | Functional Analysis Service |

## 3.2 Outputs

| Output | Description |
|---|---|
| Safety metrics | Quantitative and categorical estimates of immunogenicity, toxicity, hemolysis, allergenicity, and off-target risk |
| Risk estimates | Confidence- and applicability-annotated risk levels for each assessed liability |
| Safety Evidence Object | The standardized evidence artifact defined in Section 14, published to the Evidence Bus |

The service accepts one peptide's combined upstream evidence per invocation and produces exactly one Evidence Object; evaluation across multiple candidate HLA allele panels or multiple off-target reference sets is a Job Scheduler and Workflow Orchestrator concern, not a scientific one.

---

# 4. Internal Computational Pipeline

```text
Peptide Object + Structural Evidence + Functional Evidence
            │
            ▼
   ┌───────────────────────────┐
   │  Immunogenicity Prediction │  → MHC binding, T-cell epitope potential
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Toxicity Prediction       │  → general toxicity, hemolysis, allergenicity
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Off-Target Assessment     │  → cross-reactivity, unintended interaction potential
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Safety Validation         │  → confidence and applicability assessment
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Evidence Generator        │  → Safety Evidence Object
   └───────────────────────────┘
            │
            ▼
        Evidence Bus
```

Immunogenicity Prediction and Toxicity Prediction depend primarily on sequence (and, for solvent-exposure-aware epitope refinement, structural evidence) and may execute concurrently, since they assess scientifically distinct liability classes (adaptive immune recognition vs. direct cytotoxic/membrane-disruptive effect) via largely independent computational methods. Off-Target Assessment depends additionally on Functional Evidence (to establish what constitutes "on-target" so that off-target interactions can be meaningfully distinguished) and therefore is scheduled after the intended-target context is available. Safety Validation requires the completed outputs of all three preceding modules, since applicability and confidence are assessed jointly across the full liability profile rather than independently per module.

---

# 5. Individual Computational Modules

## 5.1 Immunogenicity Prediction Module

Predicts MHC class I and/or class II binding potential across peptide sub-sequences (per the Recommended Engineering Stack: NetMHCpan) and identifies candidate T-cell epitopes using curated epitope-prediction resources (IEDB Tools), refining raw sequence-based epitope calls with structural solvent-exposure information where a peptide structure is available, since epitope presentation requires processing and surface accessibility considerations that pure sequence scanning cannot capture alone.

## 5.2 Toxicity Prediction Module

Estimates general cytotoxic liability using a trained toxicity classifier (per the Recommended Engineering Stack: ToxinPred2), estimates membrane-disruptive (hemolytic) potential using a dedicated hemolysis predictor (HemoPI), and estimates the likelihood of IgE-mediated allergenic response using an allergenicity classifier (AllerTOP). These three toxicity-adjacent liabilities are scientifically distinct mechanisms (direct cytotoxicity, red-blood-cell membrane lysis, and adaptive humoral immune sensitization, respectively) and are computed as independent sub-analyses rather than blended into a single toxicity score.

## 5.3 Off-Target Assessment Module

Given the Functional Evidence Object's declared intended target and predicted engagement mode, screens the peptide's sequence and structural features against known families of unintended interaction partners (e.g., structurally or sequence-similar receptors, common promiscuous binding motifs, known cross-reactive epitope classes) to flag plausible off-target liabilities, distinguishing them explicitly from the intended, on-target engagement already characterized upstream by the Functional Analysis Service.

## 5.4 Safety Validation Module

Aggregates the confidence and applicability characteristics of the outputs of Sections 5.1–5.3 into a structured risk-quantification report, explicitly assessing whether each prediction falls within the applicability domain of its underlying model (Section 10) and surfacing any liability classes for which no computational prediction could be confidently made, rather than allowing silent gaps in coverage.

## 5.5 Evidence Generator Module

Aggregates the outputs of Sections 5.1–5.4, together with provenance and confidence metadata, into the Safety Evidence Object and publishes it to the Evidence Bus. This module performs no scientific computation of its own.

---

# 6. Algorithms and Mathematical Foundations

## 6.1 MHC Binding Prediction

**Definition.** For a candidate peptide fragment of fixed length (typically 8–11 residues for MHC class I, 13–25 for MHC class II) and a specific HLA allele $a$, MHC binding predictors (per the Recommended Engineering Stack: NetMHCpan) estimate a binding affinity or percentile rank:

$$\hat{A}(p, a) = f_\theta(p, a)$$

where $f_\theta$ is a neural network trained on experimentally measured peptide–MHC binding affinities across many HLA alleles, allowing prediction even for alleles with sparse direct experimental data via learned allele-sequence similarity (the "pan" in NetMHCpan). Lower predicted percentile rank or higher predicted affinity indicates stronger binding.

**Biological rationale.** Peptide presentation on MHC molecules is the necessary first step for T-cell-mediated immune recognition; a peptide fragment that binds MHC strongly across common HLA alleles is more likely to be presented to the immune system and trigger an adaptive immune response — a central concern for peptide therapeutics, which, unlike small molecules, are directly susceptible to this presentation pathway.

## 6.2 T-Cell Epitope Identification

**Definition.** Candidate epitopes are identified by combining MHC binding predictions (Section 6.1) across a sliding window of sub-sequences with curated epitope-prediction heuristics and reference data (IEDB Tools), which additionally account for proteasomal cleavage propensity and TAP (transporter associated with antigen processing) transport efficiency — the biological steps preceding MHC loading:

$$\text{EpitopeScore}(p) = w_1 \cdot \hat{A}(p, a) + w_2 \cdot \text{Cleavage}(p) + w_3 \cdot \text{TAP}(p)$$

for empirically weighted contributions $w_1, w_2, w_3$.

**Biological rationale.** MHC binding affinity alone is necessary but not sufficient for immunogenicity; a peptide fragment must also survive the antigen-processing pathway intact and be efficiently transported to the site of MHC loading, so incorporating these additional biological steps produces a more mechanistically grounded epitope prediction than binding affinity in isolation.

## 6.3 Solvent-Exposure-Weighted Epitope Refinement

**Definition.** Where structural evidence is available, raw sequence-based epitope scores are re-weighted by the corresponding residues' predicted solvent accessibility (from the Structural Biology Service's structural evidence):

$$\text{EpitopeScore}_{\text{refined}}(p) = \text{EpitopeScore}(p) \times \overline{\text{SASA}}_{\text{normalized}}(p)$$

where $\overline{\text{SASA}}_{\text{normalized}}(p)$ is the mean normalized solvent-accessible surface area of the residues comprising fragment $p$.

**Biological rationale.** Antigen processing typically requires proteolytic degradation of the intact molecule before MHC loading, meaning that a peptide's native structural context can influence the practical presentation of embedded epitopes; buried epitopes are more dependent on unfolding/processing dynamics, while highly exposed segments are more readily accessible, providing an additional biologically motivated refinement beyond sequence alone. This refinement is applied as a contextual adjustment, not a replacement for the sequence-based score, since intact peptide therapeutics are frequently processed extracellularly or intracellularly by pathways not fully captured by structural solvent exposure alone.

## 6.4 General Toxicity Classification

**Definition.** A trained classifier (per the Recommended Engineering Stack: ToxinPred2) maps sequence-derived features (composition, physicochemical descriptors from the Physicochemical Evidence Object, motif patterns) to a predicted toxicity probability:

$$P(\text{toxic} \mid \text{sequence}) = g_\phi(\mathbf{x})$$

for learned parameters $\phi$ and feature vector $\mathbf{x}$, trained on curated datasets of peptides with experimentally characterized toxic and non-toxic status.

**Biological rationale.** General cytotoxicity can arise through multiple, only partially overlapping mechanisms (membrane disruption, interference with intracellular processes, off-target receptor activation); a dedicated general-toxicity classifier trained broadly across known toxic peptides captures patterns not necessarily reducible to any single mechanistic sub-analysis such as hemolysis alone.

## 6.5 Hemolysis Prediction

**Definition.** A dedicated classifier or regression model (per the Recommended Engineering Stack: HemoPI) estimates red blood cell lysis potential from sequence-derived features, typically emphasizing the amphipathic and cationic character established upstream in the Physicochemical Evidence Object (hydrophobic moment, net charge):

$$P(\text{hemolytic}) = h_\psi(\text{hydrophobic moment}, \text{net charge}, \text{composition}, \dots)$$

**Biological rationale.** Hemolysis is mechanistically a specific instance of membrane disruption — cationic, amphipathic peptides capable of inserting into and destabilizing lipid bilayers (a property already characterized structurally and physicochemically upstream) are predisposed to lyse red blood cells; this analysis therefore closes the loop between the amphipathicity evidence generated in the Physicochemical Service and its direct safety consequence.

## 6.6 Allergenicity Classification

**Definition.** A trained classifier (per the Recommended Engineering Stack: AllerTOP) estimates the probability that a sequence would provoke an IgE-mediated allergic response, typically using auto-cross-covariance (ACC) transformation of physicochemical property sequences into a fixed-length feature vector suitable for classification:

$$\mathbf{ACC}(S) = \{ \text{cross-covariance terms of property-encoded sequence } S \}, \quad P(\text{allergen}) = k_\omega(\mathbf{ACC}(S))$$

**Biological rationale.** Allergenicity is a distinct adaptive immune phenomenon from T-cell-mediated immunogenicity (Section 6.1–6.3) — it involves IgE sensitization and mast cell/basophil degranulation rather than direct T-cell recognition — and is associated with sequence and physicochemical patterns learned from known allergen datasets, justifying its treatment as an independent sub-analysis rather than a byproduct of immunogenicity scoring.

## 6.7 Off-Target Interaction Screening

**Definition.** Given the intended target (from Functional Evidence), off-target risk is screened by comparing the peptide's sequence and structural features against curated families of structurally or functionally related molecules using the same similarity methodologies established upstream (embedding similarity and sequence alignment, per the Functional Analysis Service Specification, Sections 6.2–6.3), but applied here specifically to identify matches to *unintended* interaction partners:

$$\text{OffTargetRisk} = \max_{t \in \text{non-intended targets}} \text{sim}(\text{peptide features}, \text{features}_t)$$

**Biological rationale.** Peptides capable of engaging their intended target through amphipathic, electrostatic, or structural motifs may share those same motifs with unrelated but structurally similar molecules (e.g., related receptor family members, off-target ion channels, or structurally analogous endogenous peptides), making off-target risk assessment a natural extension of the similarity-based methodology already validated for on-target functional prediction, redirected toward the complementary question of unintended engagement.

## 6.8 Applicability Domain and Confidence Scoring

**Definition.** For each of the preceding predictors, an applicability domain check compares the input's feature distribution against the model's training data distribution (e.g., via a distance or density measure in feature space), flagging inputs that fall outside the region where the model's historical performance benchmarks are known to hold:

$$\text{InDomain}(\mathbf{x}) = \mathbb{1}\big[\, d(\mathbf{x}, \mathcal{D}_{\text{train}}) < \tau \,\big]$$

for a domain-membership distance $d$ and threshold $\tau$.

**Biological rationale.** Safety-relevant predictors are typically trained on datasets of historically characterized peptides, which may not represent the full diversity of therapeutic peptide chemistries under consideration; explicitly flagging out-of-domain inputs is essential for a service whose stated objective (per the Architecture Specification, Section 5.8) is to communicate uncertainty and applicability, not merely to produce a numeric score.

---

# 7. Biological Rationale Summary

| Analysis | Biological Question Answered |
|---|---|
| MHC binding prediction | Is this peptide fragment likely to be presented on MHC molecules to the adaptive immune system? |
| T-cell epitope identification | Accounting for antigen processing and transport, is this fragment likely to function as a genuine T-cell epitope? |
| Solvent-exposure-weighted epitope refinement | Does the peptide's native structural context make embedded epitopes more or less accessible to processing? |
| General toxicity classification | Does the sequence exhibit patterns broadly associated with cytotoxicity across known mechanisms? |
| Hemolysis prediction | Is the peptide's amphipathic/cationic character sufficient to disrupt red blood cell membranes? |
| Allergenicity classification | Does the sequence exhibit patterns associated with IgE-mediated allergic sensitization? |
| Off-target interaction screening | Beyond the intended target, does the peptide share features with unintended interaction partners? |
| Applicability domain / confidence scoring | Is this specific peptide within the region where the underlying model's predictions are known to be reliable? |

Each analysis answers a specific, falsifiable question about a computationally identifiable safety liability — never a risk/benefit judgment about whether that liability is acceptable, which remains the responsibility of the Decision Layer.

---

# 8. Required External Databases

| Resource | Purpose within this Service |
|---|---|
| IEDB (Immune Epitope Database) | Reference epitope data and prediction resources underlying T-cell epitope identification (Section 6.2). |
| UniProt | Resolving sequence identity and annotation for known off-target family members and reference immunogenic/allergenic proteins. |
| PDB / AlphaFold Database | Structural reference data supporting benchmark validation of solvent-exposure-weighted epitope refinement and structurally informed off-target screening. |
| ChEMBL | Reference bioactivity data supporting off-target interaction screening against known pharmacologically characterized targets. |

As with the preceding services, all access to these resources is routed exclusively through the Resource Manager (Architecture Specification, Section 4.6); the Safety Service never communicates with external databases directly.

---

# 9. Required Computational Models

| Capability | Model Category | Determinism |
|---|---|---|
| MHC binding prediction | Trained neural network (NetMHCpan) | Learned; deterministic at inference given fixed model weights |
| T-cell epitope identification | Combined learned model and curated reference-data heuristics (IEDB Tools) | Learned/heuristic hybrid |
| Solvent-exposure-weighted epitope refinement | Deterministic re-weighting using upstream structural evidence | Deterministic |
| General toxicity classification | Trained classifier (ToxinPred2) | Learned; deterministic at inference given fixed model weights |
| Hemolysis prediction | Trained classifier/regression model (HemoPI) | Learned; deterministic at inference given fixed model weights |
| Allergenicity classification | Trained classifier (AllerTOP) | Learned; deterministic at inference given fixed model weights |
| Off-target interaction screening | Similarity-based methodology (embedding and alignment search, per Functional Analysis Service) | Deterministic given fixed indices/databases |
| Applicability domain / confidence scoring | Deterministic distributional distance computation | Deterministic |

Per the Architecture Specification's AI Usage Philosophy (Section 1.6), the majority of primary liability predictions in this service fall within the "Scientific Prediction Models" category, reflecting the fact that immunogenicity, toxicity, hemolysis, and allergenicity are complex biological phenomena not reducible to closed-form physical laws; applicability-domain checking and structural re-weighting, by contrast, fall within the "Deterministic Algorithms" category and exist specifically to keep the learned predictions honest about their own limits.

---

# 10. Confidence Estimation Strategy

Consistent with the confidence-reporting precedent established in the preceding four Service Specifications, safety confidence is reported per liability class rather than as a single blended score — a requirement made explicit in the Architecture Specification's description of this service's objective (Section 5.8: "quantify potential safety risks while explicitly communicating uncertainty and applicability").

## 10.1 Model-Derived Confidence Per Liability

Each of Immunogenicity, Toxicity, Hemolysis, and Allergenicity prediction carries its own independent confidence, reflecting the specific underlying model's predictive uncertainty (e.g., predicted probability distance from the decision threshold) and known benchmark performance tracked via the Model Registry (Architecture Specification, Section 4.5). These are never merged into one "safety score," since the four liability classes reflect biologically distinct mechanisms whose individual risk levels the Decision Layer needs to weigh separately.

## 10.2 Applicability Domain Confidence

Independent of raw model output confidence, every prediction is annotated with an applicability domain flag (Section 6.8): in-domain, borderline, or out-of-domain. A numerically confident prediction for an out-of-domain input is explicitly flagged as such rather than reported at face value, directly implementing the Architecture Specification's stated requirement to communicate applicability, not only risk magnitude.

## 10.3 Structural-Dependency Confidence

Where solvent-exposure-weighted epitope refinement (Section 6.3) or structurally informed off-target screening is used, confidence is capped by the confidence of the underlying Structural Evidence, following the same principle established in the Developability Service Specification (Section 10.1): a structurally low-confidence region cannot yield a high-confidence refined epitope call.

## 10.4 Off-Target Confidence

Off-target risk confidence scales with the degree of similarity to the matched unintended partner and the quality/provenance of that partner's reference annotation, analogous to the similarity-derived confidence treatment in the Functional Analysis Service Specification (Section 10.1), reused here for the complementary off-target question.

## 10.5 Aggregate Confidence Field

A summary confidence descriptor accompanies the Evidence Object as a convenience roll-up for the Decision Layer's evidence integration stage; it never substitutes for the per-liability, per-domain confidence breakdown of Sections 10.1–10.4, consistent with the platform-wide transparency requirement (Architecture Specification, Section 1.5, Principle 3) and this service's own explicit mandate to communicate uncertainty and applicability.

---

# 11. Limitations

- **No experimental validation within this service.** As stated explicitly in the Architecture Specification (Section 5.8), all safety predictions are computational hypotheses; none are confirmed against in vitro immunogenicity assays, hemolysis assays, toxicology studies, or clinical observation within this service's boundary.
- **HLA allele coverage is incomplete.** MHC binding prediction (Section 6.1) is most reliable for well-characterized, common HLA alleles; predictions for rare or under-represented alleles carry higher uncertainty, and population-level immunogenicity risk depends on HLA allele frequency distributions that are only partially represented in any fixed reference panel.
- **Epitope prediction does not guarantee actual immune response.** MHC binding and predicted epitope status are necessary but not sufficient conditions for a clinically observed immune response, which additionally depends on T-cell repertoire, regulatory tolerance mechanisms, dosing, and route of administration — factors outside this service's scope.
- **Toxicity, hemolysis, and allergenicity classifiers are trained on finite, historically characterized datasets.** Peptides with novel chemistries, unusual modifications, or mechanisms not represented in training data may receive predictions of nominal confidence that do not reflect true reliability, underscoring the importance of the applicability-domain check (Section 10.2).
- **Off-target screening is necessarily incomplete.** It can only flag similarity to *known, curated* families of unintended interaction partners; truly novel or uncatalogued off-target interactions cannot be detected by a similarity-based approach.
- **Dependence on upstream evidence quality.** Structurally informed epitope refinement and off-target screening inherit the limitations of the Structural Biology Service (Section 11 of the Structural Biology Service Specification), and off-target screening's very definition of "off-target" depends on the accuracy of the Functional Analysis Service's declared intended-target and engagement evidence.
- **Independent liability predictions do not capture combinatorial or systemic risk.** Because each liability class is assessed independently, this service does not model potential interactions between liabilities (e.g., a peptide with borderline hemolytic and borderline immunogenic signals considered jointly), which remains an integration task for the Decision Layer.

These limitations are recorded explicitly in the Evidence Object (Section 14) so that the Decision Layer can weigh safety evidence appropriately rather than treat it as a definitive safety determination.

---

# 12. Failure Handling

| Failure Mode | Detection | Handling |
|---|---|---|
| MHC binding model unavailable or times out | Immunogenicity Prediction module receives no response from the model-serving component | Publish the Evidence Object with the immunogenicity field marked unavailable and an explicit reason code; do not fail the entire service if other liability assessments completed successfully |
| Toxicity / hemolysis / allergenicity classifier input falls far outside training distribution | Applicability domain check (Section 6.8) flags an out-of-domain input | Report the prediction with an explicit out-of-domain caveat rather than suppressing it or reporting it at face-value confidence |
| Intended target information missing or malformed | Off-Target Assessment module cannot establish an on-target baseline from Functional Evidence | Proceed with a generic off-target screen against broad curated liability families, explicitly noting that on-target exclusion could not be applied; do not fail the entire service |
| Structural Evidence absent or low-confidence | Solvent-exposure-weighted epitope refinement or structurally informed off-target screening detects missing or low-confidence upstream Structural Evidence | Fall back to sequence-only epitope and off-target scoring; explicitly flag the reduced confidence and the fallback method used |
| Reference database (IEDB, UniProt, ChEMBL) unreachable via Resource Manager | Relevant module detects a failed external resource call | Proceed using cached or previously validated reference data where available (an Infrastructure Layer caching concern); otherwise mark the affected sub-analysis as unavailable with an explicit reason code |
| Conflicting liability signals (e.g., strong hemolysis signal but low general toxicity signal) | Safety Validation module detects apparent inconsistency across liability classes | Report both signals explicitly with their independent confidence rather than resolving the apparent inconsistency; the two liabilities reflect genuinely distinct mechanisms and are not expected to always agree |

As with the preceding services, the guiding principle is **graceful degradation with explicit annotation**: a partially complete, clearly annotated Safety Evidence Object is always preferable to a fully populated but misleadingly confident one, which is especially critical for a service whose outputs weigh heavily in the Decision Layer's risk determination.

---

# 13. Performance Considerations

- **MHC binding prediction cost scales with the number of candidate sub-sequence fragments and the number of HLA alleles screened**, since predictions are typically computed per (fragment, allele) pair; broad allele-panel coverage increases cost roughly linearly with panel size.
- **Toxicity, hemolysis, and allergenicity classification are computationally inexpensive** relative to MHC binding prediction, typically operating over compact sequence-derived feature vectors and executing without GPU acceleration.
- **Off-target screening cost scales with the size of the curated unintended-partner reference set**, analogous to the Functional Analysis Service's similarity search cost characteristics, and benefits from the same indexing strategies (approximate nearest-neighbor search) where applicable.
- **Structural re-weighting steps add negligible cost** beyond the already-computed Structural Evidence Object, since they reuse existing per-residue solvent-exposure data rather than requiring new structural computation.
- **Parallelizable module structure.** Immunogenicity Prediction and Toxicity Prediction (encompassing general toxicity, hemolysis, and allergenicity) draw on largely independent computational methods and may execute concurrently; Off-Target Assessment depends on Functional Evidence being available and is scheduled accordingly, per Section 4.
- **Caching potential.** MHC binding predictions for a given (fragment, allele) pair, and toxicity/hemolysis/allergenicity predictions for a given sequence, are deterministic functions of a fixed model version and are strong candidates for caching at the Infrastructure Layer, particularly given that many candidate peptides in a discovery campaign may share overlapping sub-sequence fragments.

---

# 14. Evidence Generated by the Service

The Safety Service publishes a single **Safety Evidence Object** per peptide, conforming to the platform-wide Evidence Object contract described in the Architecture Specification (Sections 3.6 and 6.4). Its structure, expressed schematically:

```text
Safety Evidence Object
├── peptide_object_reference
├── immunogenicity_assessment
│   ├── mhc_binding_profile                { per-fragment, per-allele binding predictions, confidence }
│   ├── predicted_epitopes                 { list of candidate epitopes, scores, confidence }
│   └── structural_refinement_applied      { boolean, structural confidence used if applicable }
├── toxicity_assessment
│   ├── general_toxicity                   { value, confidence }
│   ├── hemolysis_risk                     { value, confidence }
│   └── allergenicity_risk                 { value, confidence }
├── off_target_assessment
│   ├── on_target_baseline_reference        { reference to Functional Evidence used }
│   ├── flagged_off_target_matches          { list, similarity scores, confidence }
│   └── on_target_exclusion_applied         { boolean }
├── safety_validation
│   ├── applicability_domain_flags          { per-liability: in_domain | borderline | out_of_domain }
│   └── coverage_gaps                       [ liability classes for which no confident prediction could be made ]
├── provenance
│   ├── originating_modules                 [ immunogenicity_prediction, toxicity_prediction,
│   │                                          off_target_assessment, safety_validation,
│   │                                          evidence_generator ]
│   ├── model_identifier_and_version        [ e.g., NetMHCpan version, ToxinPred2 version,
│   │                                          HemoPI version, AllerTOP version ]
│   └── reference_databases_used            [ IEDB, UniProt, ChEMBL identifiers, as applicable ]
├── validation_status                       { complete | partially_complete | failed }
├── known_limitations                       [ Section 11 items applicable to this peptide ]
└── confidence_summary                      { immunogenicity_tier, toxicity_tier,
                                               off_target_tier, aggregate_note }
```

As with the preceding Evidence Objects, every field records not only its value but the model/algorithm identifier and version and, where applicable, the reference dataset used to produce it, consistent with the platform-wide reproducibility requirement (Architecture Specification, Section 1.5, Principle 4). As the final Scientific Service in the pipeline, this Evidence Object completes the set of five inputs to the Platform Evidence Object (Architecture Specification, Section 6.4), and is consumed directly by the Decision & Validation Framework's GO / Conditional GO / NO-GO logic, where safety findings frequently carry decisive weight.

---

# 15. Future Extensibility

Consistent with the Architecture Specification's extensibility principle (Section 1.5, Principle 5; Section 7.3–7.4), the Safety Service is designed so that new liability classes and prediction methods can be introduced without altering the surrounding architecture:

- **New or upgraded immunogenicity, toxicity, hemolysis, or allergenicity models** can replace the current module implementations; because the Evidence Object records model identifier and version, the Model Registry can track the transition without ambiguity, following the same replaceability pattern illustrated in Architecture Specification Section 7.4.
- **Expanded HLA allele panels** can be incorporated into Immunogenicity Prediction as additional entries in the `mhc_binding_profile` field, without requiring changes to the Evidence Object schema beyond additional per-allele entries.
- **Additional liability classes** (e.g., a future dedicated predictor for a specific mechanism not currently covered, such as complement activation or specific off-target ion-channel liability) can be added as new sub-fields within `toxicity_assessment` or as an entirely new top-level liability category, without disrupting existing consumers relying on current fields.
- **Broader off-target reference coverage** can be incorporated into the Off-Target Assessment module's curated reference set, reported as additional matched-partner entries without disrupting the existing schema.
- **Support for additional therapeutic modalities** (antibody fragments, cyclic peptides, peptide-drug conjugates, and other future modalities listed in Architecture Specification Section 7.3) is expected to primarily extend the epitope-processing assumptions in Immunogenicity Prediction and the liability catalogs in Toxicity Prediction and Off-Target Assessment, rather than requiring a new service — preserving the platform's capability-driven rather than modality-driven organization (Architecture Specification, Section 1.4).
- **Combinatorial or systemic liability modeling**, should it become computationally tractable and scientifically validated, could be added as an additional Safety Validation sub-analysis synthesizing across the independently computed liability classes, without requiring the individual liability modules themselves to be redesigned.

These extension points ensure that the Safety Service can absorb scientific advances in immunogenicity, toxicity, and off-target prediction without requiring redesign of the Infrastructure Layer, the Evidence Bus, or the Decision & Validation Framework — preserving the technology-independent architecture that Version 3 was designed to establish, and completing the five-service Scientific Layer defined by that architecture.
