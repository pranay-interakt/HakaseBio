# Scientific Service Specification — Functional Analysis Service

# 1. Purpose and Scope

## 1.1 Purpose

The Functional Analysis Service is the third Scientific Service in the Version 3 evidence-generation pipeline. Its purpose is to estimate the biological activities supported by the molecular and structural evidence already assembled — that is, to answer "what might this peptide *do*, biologically, and with what target?" using modality-appropriate computational models, without judging whether any predicted activity is therapeutically desirable.

This specification expands Section 5.6 of the Architecture Specification into a complete scientific design. It defines the biological rationale, computational methods, mathematical foundations, and evidentiary outputs of the service, remaining technology-independent except where the Recommended Engineering Stack has already designated specific tools (ESM-2, FAISS, PyTorch, XGBoost/LightGBM, MMseqs2/BLAST, and a Python rule engine for workflow selection).

## 1.2 Scope

In scope:

- Scientific responsibilities of the Functional Analysis Service.
- The internal computational pipeline, expressed as capabilities rather than code.
- The algorithms and mathematical models underlying modality selection, functional prediction, similarity analysis, target engagement estimation, and cross-prediction consistency checking.
- The biological interpretation of each analysis.
- Construction of the Functional Evidence Object.
- Confidence estimation, failure handling, and performance characteristics specific to this service.

Out of scope (defined elsewhere, per the Architecture Specification):

- Intrinsic physicochemical descriptor and embedding computation (Physicochemical Service, an upstream input to this service).
- Tertiary structure and complex prediction (Structural Biology Service, an upstream input to this service).
- Manufacturability, formulation stability, and degradation kinetics (Developability Service).
- Immunogenicity, toxicity, and other safety liabilities (Safety Service).
- Evidence integration and GO / Conditional GO / NO-GO logic (Decision & Validation Framework, Chapter 6).
- API contracts, database schemas, and deployment topology (Platform Infrastructure Layer, Chapter 4).

## 1.3 Position in the Platform

```text
Physicochemical Evidence Object   Structural Evidence Object
            │                              │
            └──────────────┬───────────────┘
                            ▼
              ──────────────────────────────
                 Functional Analysis Service
              ──────────────────────────────
                            │
                            ▼
                 Functional Evidence Object
                            │
                            ▼
        Developability Service · Safety Service
                            │
                            ▼
              Decision & Validation Framework
```

The Functional Analysis Service is the first service in the pipeline whose predictions depend on *both* upstream Scientific Services simultaneously — it cannot meaningfully assess target engagement without structural evidence, nor interpret that structural evidence without physicochemical context. It is also the first service whose behavior is explicitly conditioned on therapeutic modality (antimicrobial, cell-penetrating, receptor-binding, enzyme-inhibitory, and other peptide functional classes), since the appropriate predictive models differ substantially across modalities.

---

# 2. Scientific Responsibilities

| Responsibility | Description |
|---|---|
| Functional Prediction | Execute modality-specific computational models to estimate the biological activities consistent with the peptide's evidence. |
| Similarity Analysis | Compare the peptide against databases of experimentally validated peptides to identify functional analogues and homologues. |
| Target Engagement | Estimate the likelihood and character of interaction between the peptide and a specified biological target, building on structural evidence where available. |
| Consistency Validation | Detect and flag conflicts between independent functional predictions (e.g., a classical machine learning model and a similarity-based inference disagreeing substantially). |
| Confidence Assessment | Quantify the reliability of every functional prediction. |
| Evidence Generation | Publish the Functional Evidence Object. |

The service explicitly does **not**:

- Recompute physicochemical descriptors or structural models; it consumes them as evidence.
- Assess developability, manufacturability, or formulation behavior (Developability Service).
- Assess immunogenicity, toxicity, or other safety liabilities (Safety Service).
- Make any therapeutic judgment. It reports what biological activity the evidence supports, never whether that activity constitutes a viable drug candidate.

This mirrors the Architecture Specification's explicit statement that the Functional Analysis Service performs computational prediction only, and that therapeutic interpretation remains the responsibility of the Decision Layer (Section 5.6).

---

# 3. Inputs and Outputs

## 3.1 Inputs

| Input | Description | Origin |
|---|---|---|
| Physicochemical Evidence | Descriptors and embeddings describing the peptide as a molecule | Physicochemical Service |
| Structural Evidence | Predicted tertiary structure, complex, and interface characterization | Structural Biology Service |
| Therapeutic modality | The functional class the peptide is being evaluated against (e.g., antimicrobial, cell-penetrating, receptor agonist/antagonist, enzyme inhibitor) | User input / Resource Manager |
| Target information (where applicable) | Sequence or structural identity of the biological target under consideration | User input, propagated from the Structural Biology Service's target context |

## 3.2 Outputs

| Output | Description |
|---|---|
| Functional scores | Modality-specific quantitative or categorical estimates of biological activity |
| Target engagement metrics | Estimated interaction likelihood and character between peptide and target |
| Similarity analysis results | Nearest known functional analogues and their degree of similarity |
| Consistency assessment | Explicit record of agreement or conflict across independent functional predictions |
| Functional Evidence Object | The standardized evidence artifact defined in Section 14, published to the Evidence Bus |

The service accepts one peptide's combined upstream evidence (plus modality and, where relevant, target information) per invocation and produces exactly one Evidence Object; evaluation across multiple candidate modalities or multiple targets is a Job Scheduler and Workflow Orchestrator concern, not a scientific one.

---

# 4. Internal Computational Pipeline

```text
Physicochemical Evidence + Structural Evidence + Modality (+ Target)
            │
            ▼
   ┌───────────────────────────┐
   │  Workflow Selector         │  → choose modality-appropriate prediction pipeline
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Similarity Engine         │  → nearest-neighbor search against known peptides
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Functional Predictors     │  → modality-specific activity models
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Target Engagement         │  → interaction likelihood, using structural evidence
   │  Estimator                 │     when a target is specified
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Consistency Validator     │  → cross-check independent predictions
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Evidence Generator        │  → Functional Evidence Object
   └───────────────────────────┘
            │
            ▼
        Evidence Bus
```

The Workflow Selector executes first and determines which of the Functional Predictors, Similarity Engine configurations, and Target Engagement Estimator behaviors are activated for a given peptide; it corresponds to the "Workflow Selector" module named explicitly in the Architecture Specification (Section 5.6). The Similarity Engine and the modality-specific Functional Predictors may execute concurrently once the Workflow Selector has run, since they draw on independent computational approaches (similarity search vs. learned classification/regression) over the same upstream evidence; the Target Engagement Estimator executes only when target information and structural complex evidence are both available. The Consistency Validator requires the completed outputs of all preceding modules.

---

# 5. Individual Computational Modules

## 5.1 Workflow Selector Module

A deterministic rule-based module that maps declared or inferred therapeutic modality to the specific set of Functional Predictors, similarity reference datasets, and target engagement procedures appropriate to that modality (per the Recommended Engineering Stack's "Python Rule Engine"). This module performs no predictive computation of its own; it configures the remainder of the pipeline.

## 5.2 Similarity Engine Module

Performs nearest-neighbor search of the peptide's sequence embedding (produced upstream by the Physicochemical Service) against curated databases of experimentally characterized peptides (per the Recommended Engineering Stack: FAISS for embedding-based search; MMseqs2/BLAST for sequence-alignment-based search). Returns the closest known functional analogues, their degree of similarity, and their annotated activities, where available.

## 5.3 Functional Predictors Module

Executes the modality-specific machine learning models selected by the Workflow Selector — classical models (XGBoost/LightGBM) for structured features derived from physicochemical and structural evidence, and deep learning models (PyTorch) operating on sequence embeddings and, where relevant, structural representations — to produce quantitative or categorical estimates of biological activity (e.g., estimated antimicrobial potency class, estimated receptor-binding propensity).

## 5.4 Target Engagement Estimator Module

Where target information and a predicted peptide–target complex are available from the Structural Biology Service, this module derives target engagement metrics from the structural interface evidence (contact residues, buried surface area, interaction types) combined with modality-specific functional predictors, producing an integrated estimate of interaction likelihood and character that neither the structural interface analysis nor the sequence-based functional predictors could provide independently.

## 5.5 Consistency Validator Module

Compares the outputs of the Similarity Engine, the Functional Predictors, and the Target Engagement Estimator for mutual agreement. Because these three modules draw on scientifically independent lines of evidence (empirical analogy, learned statistical prediction, and structural interface geometry, respectively), convergence across them increases confidence, while divergence is flagged explicitly rather than silently averaged away.

## 5.6 Evidence Generator Module

Aggregates the outputs of Sections 5.2–5.5, together with provenance and confidence metadata, into the Functional Evidence Object and publishes it to the Evidence Bus. This module performs no scientific computation of its own.

---

# 6. Algorithms and Mathematical Foundations

## 6.1 Modality Routing (Workflow Selector)

**Definition.** A deterministic classification function maps a declared or inferred modality label $m$ to a configuration tuple:

$$\text{config}(m) = \big(\, \{\text{predictors}\}_m,\ \{\text{reference datasets}\}_m,\ \text{engagement procedure}_m \,\big)$$

implemented as an explicit rule table rather than a learned classifier, consistent with the Architecture Specification's AI Usage Philosophy treatment of workflow/routing logic as a deterministic, fully explainable component (Section 1.6).

**Biological rationale.** Different peptide functional classes are governed by fundamentally different biophysical mechanisms — antimicrobial activity depends heavily on membrane interaction and amphipathicity, receptor engagement depends on precise steric and electrostatic complementarity at a binding interface, enzyme inhibition depends on active-site geometry — so no single predictive model is appropriate across all modalities. Explicit routing ensures each peptide is evaluated with mechanistically appropriate tools rather than a one-size-fits-all model.

## 6.2 Embedding-Based Similarity Search

**Definition.** Given the peptide's pooled sequence embedding $\bar{e}_q$ (from the Physicochemical Evidence Object) and a reference database of embeddings $\{\bar{e}_1, \dots, \bar{e}_N\}$ with known annotated activity, the Similarity Engine retrieves the $k$ nearest neighbors under a distance metric (commonly cosine distance or Euclidean distance in embedding space):

$$\text{sim}(\bar{e}_q, \bar{e}_i) = \frac{\bar{e}_q \cdot \bar{e}_i}{\lVert \bar{e}_q \rVert \, \lVert \bar{e}_i \rVert}$$

using an approximate nearest-neighbor index (FAISS) for tractable search at database scale.

**Biological rationale.** Peptides with similar learned embeddings often share evolutionary, structural, or functional relationships not captured by exact sequence identity alone; retrieving known-active analogues provides an empirical, data-grounded functional signal that complements purely model-based prediction (Section 6.4).

## 6.3 Sequence-Alignment-Based Similarity Search

**Definition.** Complementary to embedding search, direct sequence alignment (MMseqs2 / BLAST) identifies homologues via classical alignment scoring, e.g., a Smith–Waterman or heuristic seed-and-extend local alignment score:

$$S(A, B) = \max_{\text{alignment}} \sum_{i} s(a_i, b_i) - \text{gap penalties}$$

where $s(a_i, b_i)$ is a substitution matrix score (e.g., BLOSUM) for aligned residue pairs.

**Biological rationale.** Sequence alignment captures direct evolutionary homology and motif conservation that embedding similarity may not perfectly reflect (embeddings capture learned statistical regularities, which can diverge from strict evolutionary homology); using both search strategies in parallel provides two scientifically distinct forms of corroborating or conflicting evidence, consumed jointly by the Consistency Validator (Section 6.6).

## 6.4 Modality-Specific Functional Prediction

**Definition.** Two complementary families of learned models are used, matched to the nature of the available features:

- **Classical structured models** (XGBoost / LightGBM): gradient-boosted decision tree ensembles operating on engineered features (physicochemical descriptors, structural summary statistics), producing a prediction

$$\hat{y} = \sum_{t=1}^{T} f_t(\mathbf{x}), \quad f_t \in \mathcal{F}$$

where $\mathcal{F}$ is the space of regression/classification trees and $\mathbf{x}$ is the structured feature vector.

- **Deep learning models** (PyTorch): neural networks operating directly on sequence embeddings and, where relevant, structural representations, producing a prediction $\hat{y} = g_\theta(\mathbf{e})$ for learned parameters $\theta$.

**Biological rationale.** Structured physicochemical and structural features (e.g., hydrophobic moment, net charge, interface buried surface area) encode human-interpretable biophysical hypotheses well-suited to tree-based models, while raw sequence and structural embeddings capture higher-order patterns not reducible to hand-crafted features; using both model families for the same functional endpoint, where feasible, provides a further axis of cross-validation for the Consistency Validator.

## 6.5 Target Engagement Estimation

**Definition.** Where a predicted peptide–target complex exists, target engagement is estimated as a function combining structural interface descriptors (Structural Evidence Object: contact count, buried surface area $\Delta SASA$, interaction-type composition) with a modality-specific learned scoring function:

$$E_{\text{engagement}} = h_\phi\big(\Delta SASA,\ \text{contact composition},\ \text{interface confidence},\ \text{sequence/embedding features}\big)$$

for learned parameters $\phi$, trained on known peptide–target interaction outcomes.

**Biological rationale.** Neither structural interface geometry alone nor sequence-based functional prediction alone fully determines biological engagement; combining a physically grounded interface description with a learned model trained on real interaction outcomes produces a more biologically grounded engagement estimate than either signal in isolation, while still keeping the estimate traceable to identifiable structural and sequence-derived features rather than an opaque combination.

## 6.6 Cross-Prediction Consistency Scoring

**Definition.** Given independent functional estimates from the Similarity Engine ($\hat{y}_{\text{sim}}$), the Functional Predictors ($\hat{y}_{\text{model}}$), and (where applicable) the Target Engagement Estimator ($\hat{y}_{\text{engage}}$), a consistency score quantifies their mutual agreement, e.g., via pairwise normalized agreement or rank correlation across the available estimates:

$$C = \text{agreement}\big(\hat{y}_{\text{sim}},\ \hat{y}_{\text{model}},\ \hat{y}_{\text{engage}}\big)$$

Predictions falling below a defined agreement threshold are flagged as conflicting rather than resolved by averaging.

**Biological rationale.** Because each contributing method encodes a scientifically distinct source of evidence (empirical analogy, learned statistical association, and structural biophysics), convergence across independent methods is a stronger indicator of biological plausibility than any single method's confidence in isolation, while divergence is itself scientifically informative — it may indicate a genuinely novel functional mechanism, an out-of-distribution input, or a limitation in one of the contributing methods, all of which the Decision Layer needs to know about explicitly rather than have obscured by a blended score.

---

# 7. Biological Rationale Summary

| Analysis | Biological Question Answered |
|---|---|
| Workflow / modality routing | Which biological mechanism is relevant to this peptide's intended function, and which tools are mechanistically appropriate? |
| Embedding-based similarity search | Does this peptide resemble, in learned representation space, peptides with known biological activity? |
| Sequence-alignment-based similarity search | Does this peptide share direct evolutionary homology or conserved motifs with known functional peptides? |
| Modality-specific functional prediction (structured models) | What do interpretable physicochemical and structural features imply about biological activity? |
| Modality-specific functional prediction (deep learning models) | What do learned sequence/structural representations imply about biological activity, beyond hand-crafted features? |
| Target engagement estimation | Given the predicted structural interface, how likely and how strong is functional engagement with the specified target? |
| Consistency validation | Do independent lines of evidence agree on the peptide's likely function, or does the evidence conflict in a way that warrants caution? |

Each analysis answers a specific, falsifiable question about biological activity supported by the available evidence — never a judgment about therapeutic desirability, which remains the responsibility of the Decision Layer.

---

# 8. Required External Databases

| Resource | Purpose within this Service |
|---|---|
| DBAASP | Reference dataset of antimicrobial peptides and their experimentally characterized activity, used by the Similarity Engine and as training/reference data for antimicrobial-modality Functional Predictors. |
| APD3 | Complementary antimicrobial peptide repository, broadening similarity-search coverage. |
| SATPdb | Reference dataset of therapeutic peptides spanning multiple functional classes, supporting similarity search and modality-general functional context. |
| PeptideAtlas | Experimentally observed peptide data supporting corroboration of predicted functional plausibility. |
| ChEMBL | Bioactivity data relevant to target engagement estimation where the target is a well-characterized pharmacological target. |
| UniProt | Target sequence and functional/domain annotation supporting interpretation of predicted engagement. |

As with the upstream services, all access to these resources is routed exclusively through the Resource Manager (Architecture Specification, Section 4.6); the Functional Analysis Service never communicates with external databases directly.

---

# 9. Required Computational Models

| Capability | Model Category | Determinism |
|---|---|---|
| Modality / workflow routing | Rule-based classification | Deterministic |
| Embedding-based similarity search | Approximate nearest-neighbor index (FAISS) over learned embeddings | Deterministic given a fixed index and fixed embeddings |
| Sequence-alignment-based similarity search | Alignment algorithm (MMseqs2 / BLAST) | Deterministic given fixed reference databases |
| Structured-feature functional prediction | Gradient-boosted tree ensemble (XGBoost / LightGBM) | Learned; deterministic at inference given fixed model weights |
| Embedding/structure-based functional prediction | Deep neural network (PyTorch) | Learned; deterministic at inference given fixed model weights |
| Target engagement estimation | Learned scoring function combining structural and sequence features | Learned; deterministic at inference given fixed model weights |
| Cross-prediction consistency scoring | Deterministic statistical agreement computation | Deterministic |

Per the Architecture Specification's AI Usage Philosophy (Section 1.6), modality routing and consistency scoring fall within the "Deterministic Algorithms" category, while similarity search and functional/engagement prediction fall within the "Scientific Prediction Models" category. As with the preceding two services, this distinction is preserved throughout the confidence framework below.

---

# 10. Confidence Estimation Strategy

Consistent with the confidence-reporting precedent established in the Physicochemical and Structural Biology Service specifications, functional confidence is reported per component rather than as a single blended score.

## 10.1 Similarity-Derived Confidence

Confidence in similarity-based inferences scales with the degree of similarity to the nearest annotated neighbor(s) and the experimental quality/provenance of the matched reference entry (e.g., a peptide closely matching a well-characterized DBAASP entry carries higher similarity-derived confidence than a distant match to a sparsely annotated entry). Both embedding-based and alignment-based similarity results are reported with independent confidence, since they can diverge (Section 6.6).

## 10.2 Model-Derived Confidence

Confidence in Functional Predictor outputs reflects the specific model's own predictive uncertainty (e.g., ensemble variance for tree-based models, predictive distribution spread for neural models) and, critically, whether the input falls within the model's validated applicability domain — a concept tracked via the Model Registry's benchmark and validation metadata (Architecture Specification, Section 4.5). Predictions for peptides falling outside a model's known applicability domain are flagged as reduced confidence regardless of the model's raw output score.

## 10.3 Target Engagement Confidence

Confidence in target engagement estimates is jointly conditioned on (a) the Structural Biology Service's own interface confidence (Section 10.2 of the Structural Biology Service Specification) and (b) the Target Engagement Estimator's model-derived confidence; an engagement estimate can never be reported with higher confidence than the structural evidence it depends on, since a low-confidence interface renders any downstream engagement score correspondingly uncertain.

## 10.4 Consistency-Adjusted Confidence

The Consistency Validator's agreement score (Section 6.6) is used to adjust, but never silently overwrite, the confidence of individual predictions: strong agreement across independent methods raises aggregate confidence in the shared conclusion, while disagreement is recorded as an explicit conflict flag rather than resolved by averaging or suppression, in keeping with the platform-wide requirement for full traceability of every confidence judgment (Architecture Specification, Section 1.5, Principle 3).

## 10.5 Aggregate Confidence Field

A summary confidence descriptor accompanies the Evidence Object as a convenience roll-up for the Decision Layer's evidence integration stage; it never substitutes for the per-component confidence breakdown of Sections 10.1–10.4.

---

# 11. Limitations

- **No experimental validation within this service.** All functional and engagement estimates are computational predictions; none are confirmed against wet-lab bioassay data within this service's boundary.
- **Reference database bias.** Similarity-based inference is only as good as the coverage and annotation quality of the reference databases used; functionally novel peptides with no close analogues in DBAASP, APD3, SATPdb, or PeptideAtlas will receive weak or absent similarity-derived evidence, independent of their true biological activity.
- **Model applicability domain limits.** Functional Predictors are trained on finite, historically available datasets; peptides with unusual composition, length, or modality characteristics not well represented in training data may receive predictions of nominally high output confidence that do not reflect true reliability, underscoring the importance of the applicability-domain check in Section 10.2.
- **Dependence on upstream evidence quality.** Target engagement estimates inherit the limitations of the Structural Biology Service's structure and complex predictions (Section 11 of the Structural Biology Service Specification); a low-confidence or unavailable structural complex necessarily constrains the reliability of any engagement estimate.
- **Modality misclassification risk.** If the declared or inferred therapeutic modality does not accurately reflect the peptide's true biological behavior, the Workflow Selector may route the peptide to a mechanistically inappropriate set of predictors, an error class this service cannot detect from its own evidence alone.
- **Cross-method agreement is not proof of correctness.** Convergence among similarity search, learned prediction, and engagement estimation increases confidence but does not constitute experimental confirmation; correlated failure modes (e.g., all three methods relying, directly or indirectly, on overlapping training or reference data) can produce artificially concordant but still incorrect conclusions.

These limitations are recorded explicitly in the Evidence Object (Section 14) so that downstream services and the Decision Layer can account for them rather than treating functional evidence as ground truth.

---

# 12. Failure Handling

| Failure Mode | Detection | Handling |
|---|---|---|
| Modality not specified or unrecognized | Workflow Selector cannot map input to a known configuration | Reject at Stage 1 with a descriptive validation error, or proceed with a generic/default predictor set if the platform's input validation stage permits an unspecified modality; record the fallback explicitly in provenance |
| Similarity search returns no meaningful neighbors | Similarity Engine's best match falls below a minimum similarity threshold | Report similarity-derived evidence as absent rather than forcing a low-quality match; proceed with model-based Functional Predictors independently |
| Functional Predictor model unavailable or times out | Functional Predictors module receives no response from the model-serving component | Publish the Evidence Object with the affected functional score marked unavailable and an explicit reason code; do not fail the entire service if other modules completed successfully |
| Structural Evidence absent or low-confidence | Target Engagement Estimator detects missing or low-confidence upstream Structural Evidence | Skip or down-weight Target Engagement Estimation accordingly; mark engagement fields as not applicable or explicitly low-confidence rather than fabricating an estimate from insufficient structural grounding |
| Conflicting functional predictions | Consistency Validator's agreement score falls below threshold | Do not silently average or select a "winning" prediction; publish all conflicting estimates with an explicit conflict flag for Decision Layer review |
| Target information malformed or unresolvable | Target Engagement Estimator cannot obtain a usable target representation via the Resource Manager | Skip Target Engagement Estimation; mark related fields as not applicable; proceed with modality-general functional prediction only |

As with the preceding services, the guiding principle is **graceful degradation with explicit annotation**: a partially complete, clearly annotated Functional Evidence Object is always preferable to a fully populated but misleadingly confident one, and an explicit conflict flag is always preferable to a silently resolved disagreement.

---

# 13. Performance Considerations

- **Similarity search cost scales with reference database size**, not with model complexity; approximate nearest-neighbor indexing (FAISS) is specifically selected in the Recommended Engineering Stack to keep this cost tractable even against large peptide databases, while alignment-based search (MMseqs2/BLAST) trades some speed for exact homology detection.
- **Structured-feature model inference (XGBoost/LightGBM) is computationally inexpensive** relative to deep learning inference, and can typically execute without GPU acceleration.
- **Deep learning functional prediction and target engagement estimation are more computationally demanding**, particularly when operating on per-residue embeddings or structural representations rather than pooled vectors, and may benefit from GPU acceleration similar to the upstream Structural Biology Service.
- **Modality routing and consistency validation are computationally trivial**, executing in negligible time relative to any of the predictive modules.
- **Parallelizable module structure.** Because the Similarity Engine and the Functional Predictors module operate on independent computational pathways over the same upstream evidence, the Workflow Orchestrator may execute them concurrently, a scheduling optimization outside this service's own scientific responsibility.
- **Caching potential.** Similarity search results and model-based functional predictions are deterministic functions of a fixed reference database/model version and the upstream evidence; both are candidates for caching at the Infrastructure Layer when identical peptide evidence recurs.

---

# 14. Evidence Generated by the Service

The Functional Analysis Service publishes a single **Functional Evidence Object** per peptide (and, where applicable, per peptide–target pair), conforming to the platform-wide Evidence Object contract described in the Architecture Specification (Sections 3.6 and 6.4). Its structure, expressed schematically:

```text
Functional Evidence Object
├── peptide_object_reference
├── modality                              { declared/inferred therapeutic modality }
├── target_reference                      { present | not_applicable }
├── similarity_analysis
│   ├── embedding_based_matches            { nearest neighbors, similarity scores, confidence }
│   └── alignment_based_matches            { nearest homologues, alignment scores, confidence }
├── functional_predictions
│   ├── structured_model_scores            { per-endpoint value, model identifier/version, confidence }
│   └── embedding_model_scores             { per-endpoint value, model identifier/version, confidence }
├── target_engagement                     { present | not_applicable }
│   ├── engagement_score                   { value, confidence }
│   └── contributing_structural_evidence   { reference to Structural Evidence Object fields used }
├── consistency_assessment
│   ├── agreement_score                    { value }
│   └── conflict_flags                     [ list of specific conflicting predictions, if any ]
├── provenance
│   ├── originating_modules                [ workflow_selector, similarity_engine,
│   │                                         functional_predictors, target_engagement_estimator,
│   │                                         consistency_validator, evidence_generator ]
│   ├── model_identifier_and_version       [ per predictor and engagement model used ]
│   └── reference_databases_used           [ DBAASP, APD3, SATPdb, PeptideAtlas, ChEMBL identifiers, as applicable ]
├── validation_status                      { complete | partially_complete | failed }
├── known_limitations                      [ Section 11 items applicable to this peptide ]
└── confidence_summary                     { similarity_tier, model_tier, engagement_tier, aggregate_note }
```

As with the Physicochemical and Structural Evidence Objects, every field records not only its value but the model/algorithm identifier and version and, where applicable, the reference dataset used to produce it, consistent with the platform-wide reproducibility requirement (Architecture Specification, Section 1.5, Principle 4). This Evidence Object becomes one of the five inputs to the Platform Evidence Object (Architecture Specification, Section 6.4), and is consumed by the Developability Service (as functional context for manufacturability and formulation reasoning) and the Safety Service (as functional context for interpreting predicted target engagement against potential off-target or immune-relevant interactions).

---

# 15. Future Extensibility

Consistent with the Architecture Specification's extensibility principle (Section 1.5, Principle 5; Section 7.3–7.4), the Functional Analysis Service is designed so that new functional capabilities can be introduced without altering the surrounding architecture:

- **New therapeutic modalities** can be added by extending the Workflow Selector's rule table with a new configuration entry, without requiring changes to the Evidence Object schema beyond recording the new modality label, preserving the platform's capability-driven rather than modality-driven organization (Architecture Specification, Section 1.4).
- **New or upgraded Functional Predictors** can replace or supplement existing structured or embedding-based models; because the Evidence Object records model identifier and version per prediction, the Model Registry can track the transition without ambiguity, following the same replaceability pattern illustrated in Architecture Specification Section 7.4.
- **Expanded reference databases** for similarity search can be incorporated as additional entries in the Similarity Engine's search scope, reported as additional matched-neighbor fields without disrupting the existing schema.
- **Additional independent prediction methods** (e.g., a future physics-based or biophysical simulation approach to functional prediction) can be incorporated as a further input to the Consistency Validator, strengthening the cross-method agreement framework of Section 6.6 without requiring redesign of the consistency-scoring logic itself.
- **Finer-grained target engagement modeling** (e.g., distinguishing agonism from antagonism, or estimating binding kinetics rather than a single engagement score) can extend the `target_engagement` evidence field with additional sub-fields, without disrupting existing consumers relying on the current engagement score.

These extension points ensure that the Functional Analysis Service can absorb scientific advances in functional prediction and similarity search without requiring redesign of the Infrastructure Layer, the Evidence Bus, or the Decision & Validation Framework — preserving the technology-independent architecture that Version 3 was designed to establish.
