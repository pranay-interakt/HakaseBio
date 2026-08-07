
# Scientific Service Specification — Developability Service

# 1. Purpose and Scope

## 1.1 Purpose

The Developability Service is the fourth Scientific Service in the Version 3 evidence-generation pipeline. Its purpose is to evaluate whether a peptide possesses the pharmaceutical characteristics required for successful development, manufacturing, formulation, and long-term stability — that is, to answer "can this molecule, as chemically and structurally characterized so far, actually be made, handled, and kept stable?" independent of whether it is biologically active or safe.

This specification expands Section 5.7 of the Architecture Specification into a complete scientific design. It defines the biological and pharmaceutical rationale, computational methods, mathematical foundations, and evidentiary outputs of the service, remaining technology-independent except where the Recommended Engineering Stack has already designated specific tools (Aggrescan3D, Protein-Sol, FoldX, PROSPERous, and a custom manufacturability engine).

## 1.2 Scope

In scope:

- Scientific responsibilities of the Developability Service.
- The internal computational pipeline, expressed as capabilities rather than code.
- The algorithms and mathematical models underlying stability, aggregation, manufacturability, and formulation assessment.
- The biological and pharmaceutical rationale for every analysis.
- Construction of the Developability Evidence Object.
- Confidence estimation, failure handling, and performance characteristics specific to this service.

Out of scope (defined elsewhere, per the Architecture Specification):

- Intrinsic physicochemical descriptor computation (Physicochemical Service, an upstream input to this service).
- Tertiary structure and complex prediction (Structural Biology Service, an upstream input to this service).
- Biological activity and target engagement prediction (Functional Analysis Service, an upstream input used here as context, not recomputed).
- Immunogenicity, toxicity, and other safety liabilities (Safety Service).
- Evidence integration and GO / Conditional GO / NO-GO logic (Decision & Validation Framework, Chapter 6).
- API contracts, database schemas, and deployment topology (Platform Infrastructure Layer, Chapter 4).

## 1.3 Position in the Platform

```text
Physicochemical Evidence   Structural Evidence   Functional Evidence
            │                     │                      │
            └─────────────────────┼──────────────────────┘
                                   ▼
                    ──────────────────────────────
                        Developability Service
                    ──────────────────────────────
                                   │
                                   ▼
                    Developability Evidence Object
                                   │
                                   ▼
                             Safety Service
                                   │
                                   ▼
                  Decision & Validation Framework
```

The Developability Service is the first service in the pipeline whose central question is purely pharmaceutical-engineering rather than biological: it does not ask what the peptide does, but whether it can be reliably manufactured, formulated, and kept intact long enough to be useful. It draws on physicochemical descriptors (composition, charge, hydrophobicity), structural evidence (fold, exposed surface, structural rigidity), and, contextually, functional evidence (e.g., whether a predicted binding mode requires a conformation that is itself unstable), making it — like the Functional Analysis Service — a consumer of multiple upstream Evidence Objects at once.

---

# 2. Scientific Responsibilities

| Responsibility | Description |
|---|---|
| Stability Assessment | Predict chemical and structural stability, including susceptibility to unfolding and degradation. |
| Aggregation Analysis | Estimate aggregation propensity and solubility risk under physiologically and pharmaceutically relevant conditions. |
| Manufacturability | Evaluate synthetic feasibility, including sequence- and modification-driven synthesis complexity. |
| Formulation Assessment | Estimate pharmaceutical compatibility — behavior under formulation-relevant conditions such as concentration, pH, and storage. |
| Evidence Generation | Publish the Developability Evidence Object. |

The service explicitly does **not**:

- Recompute physicochemical descriptors, structural models, or functional predictions; it consumes them as evidence.
- Predict biological activity or target engagement (Functional Analysis Service).
- Assess immunogenicity, toxicity, hemolysis, or allergenicity (Safety Service).
- Make any therapeutic judgment. It reports whether the molecule is pharmaceutically tractable, never whether it should be pursued.

This mirrors the Architecture Specification's framing of the Developability Service as an evaluator of pharmaceutical characteristics rather than biological ones (Section 5.7), and preserves the platform-wide separation between scientific computation and scientific decision making (Sections 1.4, 1.5).

---

# 3. Inputs and Outputs

## 3.1 Inputs

| Input | Description | Origin |
|---|---|---|
| Physicochemical Evidence | Descriptors relevant to stability and solubility (charge, hydrophobicity, instability index, aliphatic index, compositional statistics) | Physicochemical Service |
| Structural Evidence | Predicted tertiary structure, per-residue confidence, and conformational flexibility, relevant to aggregation and structural stability | Structural Biology Service |
| Functional Evidence (contextual) | Information about whether a predicted active conformation or binding mode imposes additional structural constraints | Functional Analysis Service |
| Sequence information | The canonicalized Peptide Object, including modification annotations relevant to synthesis complexity | Physicochemical Service |

## 3.2 Outputs

| Output | Description |
|---|---|
| Developability metrics | Quantitative and categorical estimates of stability, aggregation propensity, solubility, and manufacturability |
| Engineering recommendations | Structured, descriptive flags identifying specific liabilities (e.g., a specific aggregation-prone segment, a specific protease-susceptible bond) for potential sequence engineering |
| Developability Evidence Object | The standardized evidence artifact defined in Section 14, published to the Evidence Bus |

The service accepts one peptide's combined upstream evidence per invocation and produces exactly one Evidence Object; evaluation across candidate sequence variants (e.g., in an engineering-optimization loop) is a Job Scheduler and Workflow Orchestrator concern, not a scientific one.

---

# 4. Internal Computational Pipeline

```text
Physicochemical Evidence + Structural Evidence + Functional Evidence (context) + Sequence
            │
            ▼
   ┌───────────────────────────┐
   │  Stability Analysis        │  → chemical and structural stability liabilities
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Aggregation Prediction     │  → aggregation-prone regions, solubility estimate
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Manufacturability          │  → synthesis complexity, sequence liabilities
   │  Assessment                 │
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Formulation Analysis       │  → pharmaceutical compatibility estimate
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Evidence Generator         │  → Developability Evidence Object
   └───────────────────────────┘
            │
            ▼
        Evidence Bus
```

Stability Analysis and Aggregation Prediction both draw primarily on physicochemical and structural evidence and may execute concurrently; Manufacturability Assessment depends principally on sequence and modification information and can likewise execute independently of the first two. Formulation Analysis is downstream of all three, since pharmaceutical compatibility is assessed as an integration of stability, aggregation, and manufacturability findings rather than as an independent computation. The Workflow Orchestrator determines the actual concurrency schedule; this pipeline describes scientific, not execution, dependency.

---

# 5. Individual Computational Modules

## 5.1 Stability Analysis Module

Evaluates chemical and structural degradation liabilities: susceptibility to unfolding (where a defined structure exists), oxidation-prone residues, deamidation-prone motifs, and general sequence-composition-driven instability signals, extending the Physicochemical Service's instability index (a sequence-only, dipeptide-composition-based estimate) with structural context — a peptide predicted to be structurally rigid may resist degradation better than its sequence composition alone would suggest, and vice versa.

## 5.2 Aggregation Prediction Module

Identifies aggregation-prone segments and estimates overall aggregation propensity and solubility, using per-residue and windowed physicochemical properties (hydrophobicity, hydrophobic moment, charge) together with structural evidence (solvent-exposed vs. buried hydrophobic surface, per the Structural Biology Service's structure and, where applicable, complex predictions), per the Recommended Engineering Stack (Aggrescan3D for structure-aware aggregation prediction, Protein-Sol for solubility estimation).

## 5.3 Manufacturability Assessment Module

Evaluates synthetic feasibility from sequence and modification information: difficult-to-synthesize motifs (e.g., repetitive hydrophobic stretches prone to on-resin aggregation during solid-phase peptide synthesis, sequences prone to racemization or diketopiperazine formation, chemistries required for non-standard modifications), per the Recommended Engineering Stack's custom manufacturability engine, which encodes accumulated synthetic-chemistry heuristics as an explicit rule-based system rather than a learned statistical model.

## 5.4 Formulation Analysis Module

Integrates the outputs of Stability Analysis, Aggregation Prediction, and Manufacturability Assessment, together with relevant physicochemical descriptors (pI, net charge as a function of pH), to estimate pharmaceutical compatibility — behavior under storage-relevant conditions (pH range, concentration, temperature) — as a synthesis of the preceding modules' findings rather than an independent primary computation.

## 5.5 Evidence Generator Module

Aggregates the outputs of Sections 5.1–5.4, together with provenance and confidence metadata, into the Developability Evidence Object and publishes it to the Evidence Bus. This module performs no scientific computation of its own.

---

# 6. Algorithms and Mathematical Foundations

## 6.1 Structural Stability Estimation

**Definition.** Where a peptide structure is available, structural stability is estimated via a free-energy-based approach (per the Recommended Engineering Stack: FoldX), which decomposes the free energy of folding into additive empirical terms:

$$\Delta G_{\text{fold}} = \Delta G_{\text{vdW}} + \Delta G_{\text{solvation}} + \Delta G_{\text{H-bond}} + \Delta G_{\text{electrostatic}} + \Delta G_{\text{entropy}} + \dots$$

Each term is parameterized from empirical structural data. A more negative $\Delta G_{\text{fold}}$ indicates a more thermodynamically stable folded state relative to the unfolded state.

**Biological rationale.** A peptide's thermodynamic stability determines its resistance to unfolding-driven degradation, aggregation, and proteolysis; peptides with only marginal folding free energy are more susceptible to environmental perturbation (temperature, pH, concentration) during manufacturing, formulation, and storage.

## 6.2 Sequence-Composition-Driven Stability (Contextualized Instability Index)

**Definition.** The Physicochemical Service's instability index (Guruprasad et al. dipeptide-weight method, Section 6.6 of the Physicochemical Service Specification) is re-contextualized here using structural evidence: a high instability index co-occurring with high structural confidence and rigidity is interpreted differently than the same instability index co-occurring with a flexible or disordered structure, since the latter compounds sequence-level instability with conformational accessibility to degradation machinery.

**Biological rationale.** Sequence composition alone is an incomplete predictor of real-world stability; a nominally "unstable" composition embedded in a rigid, well-packed fold may be considerably more resistant to degradation in practice than the same composition in a flexible, solvent-exposed context.

## 6.3 Oxidation and Deamidation Liability Detection

**Definition.** A deterministic scan identifies residues and local motifs associated with known chemical degradation pathways: methionine and cysteine residues (oxidation-prone), and asparagine/glutamine residues in motifs known to be deamidation-prone (e.g., Asn-Gly), flagged by position and, where structural evidence is available, annotated with solvent exposure.

**Biological rationale.** Oxidation and deamidation are among the most common chemical degradation pathways for peptide therapeutics, occurring independently of proteolytic (enzymatic) degradation, and are strongly influenced by both local sequence context and solvent accessibility — a buried, structurally protected methionine is less oxidation-prone than a solvent-exposed one.

## 6.4 Aggregation Propensity Prediction

**Definition.** Structure-aware aggregation prediction (per the Recommended Engineering Stack: Aggrescan3D) estimates per-residue aggregation propensity by combining an intrinsic sequence-based aggregation scale (analogous to hydrophobicity but specifically parameterized against known amyloidogenic and aggregation behavior) with structural accessibility:

$$A_i = a_i^{\text{intrinsic}} \times \text{SASA}_i^{\text{normalized}}$$

where $a_i^{\text{intrinsic}}$ is the residue's intrinsic aggregation propensity and $\text{SASA}_i^{\text{normalized}}$ is its structurally derived solvent exposure, so that intrinsically aggregation-prone residues buried within a folded structure contribute less to overall predicted aggregation risk than solvent-exposed ones.

**Biological rationale.** Aggregation is fundamentally a surface phenomenon — it is solvent-exposed hydrophobic or amyloidogenic patches, not buried ones, that mediate inter-molecular self-association; combining sequence-intrinsic propensity with structural exposure produces a substantially more accurate risk estimate than sequence composition alone, which is why this module depends on Structural Evidence rather than physicochemical evidence in isolation.

## 6.5 Solubility Estimation

**Definition.** Solubility is estimated (per the Recommended Engineering Stack: Protein-Sol) from a combination of sequence-derived features — net charge, hydrophobicity, compositional propensities empirically associated with solubility in reference datasets — via a model of the general form:

$$\hat{S} = w_0 + \sum_k w_k \cdot x_k$$

where $x_k$ are solubility-associated sequence features and $w_k$ are empirically fitted coefficients (or, in more recent implementations, a learned nonlinear model over the same feature space).

**Biological rationale.** Aqueous solubility is a distinct, though related, property from aggregation propensity: a peptide can be aggregation-resistant (no self-association) yet still poorly soluble (unfavorable solvation), or vice versa; both properties are independently relevant to formulation, since low solubility constrains achievable dose concentration even absent any aggregation risk.

## 6.6 Manufacturability Scoring

**Definition.** A rule-based scoring system evaluates the sequence and its declared modifications against a catalog of known synthesis liabilities — for example, runs of consecutive hydrophobic or β-sheet-prone residues (associated with on-resin aggregation during solid-phase peptide synthesis), C-terminal or internal Asp-Pro / Asp-Gly motifs (associated with aspartimide formation), and the presence of modifications requiring non-standard coupling chemistries — producing a composite manufacturability score:

$$M = M_0 - \sum_j p_j \cdot \mathbb{1}[\text{liability}_j \text{ present}]$$

where $M_0$ is a baseline score and $p_j$ is an empirically or expert-derived penalty for liability $j$.

**Biological rationale.** Manufacturability liabilities arise from well-characterized organic chemistry phenomena specific to peptide synthesis chemistry (rather than from biological mechanisms), making a transparent, rule-based scoring approach — rather than a opaque learned model — the scientifically appropriate choice; this is reflected in the Recommended Engineering Stack's selection of a "Custom Python Engine" for this module rather than a machine learning model.

## 6.7 Formulation Compatibility Estimation

**Definition.** Pharmaceutical compatibility is estimated as an integration of the preceding modules' outputs evaluated across a relevant range of formulation-relevant conditions — principally pH (via the Physicochemical Service's charge-versus-pH profile, Section 6.2 of the Physicochemical Service Specification) and concentration — identifying, for example, the pH range in which net charge is sufficiently distant from the isoelectric point to disfavor aggregation-driving self-association:

$$\text{compatibility}(p) = f\big(\, |Q(p)|,\ \text{aggregation risk},\ \text{solubility},\ \text{stability} \,\big)$$

**Biological rationale.** Pharmaceutical formulation behavior emerges from the interaction of charge state, aggregation propensity, solubility, and stability considered jointly across a condition range, rather than from any single descriptor evaluated at a single condition; this module exists specifically to synthesize the outputs of Sections 6.1–6.6 across that range rather than duplicate their underlying computation.

---

# 7. Biological Rationale Summary

| Analysis | Biological / Pharmaceutical Question Answered |
|---|---|
| Structural stability estimation (folding free energy) | Is the folded state thermodynamically favorable enough to resist environmental perturbation? |
| Contextualized instability index | Does sequence-level instability translate into real degradation risk once structural context is considered? |
| Oxidation / deamidation liability detection | Are there specific residues or motifs prone to known chemical degradation pathways, and are they solvent-exposed? |
| Structure-aware aggregation prediction | Are there solvent-exposed, aggregation-prone surface patches likely to drive self-association? |
| Solubility estimation | Will the peptide remain adequately dissolved at pharmaceutically relevant concentrations? |
| Manufacturability scoring | Does the sequence or its modifications present known synthesis-chemistry liabilities? |
| Formulation compatibility estimation | Across relevant pH, concentration, and storage conditions, is the peptide likely to remain stable, soluble, and non-aggregating? |

Each analysis answers a specific, falsifiable pharmaceutical-engineering question about the molecule as characterized so far — never a judgment about whether the molecule is worth developing, which remains the responsibility of the Decision Layer.

---

# 8. Required External Databases

The Developability Service relies more heavily on parameterized computational models than on external biological databases, since its core questions are pharmaceutical-chemical rather than biological-annotation-driven. External database access — routed exclusively through the Resource Manager (Architecture Specification, Section 4.6) — is used for:

| Resource | Purpose within this Service |
|---|---|
| Protein Data Bank (PDB) | Reference structures supporting benchmark validation of structural stability and aggregation predictions against experimentally characterized peptides/proteins. |
| PeptideAtlas | Cross-referencing predicted stability and solubility behavior against experimentally observed peptide datasets, where available. |
| ChEMBL / PubChem | Resolving physicochemical reference data for non-standard modifications (e.g., known solubility or stability effects of specific linker or lipid chemistries) relevant to manufacturability and formulation scoring. |

No external database call is required for the core rule-based manufacturability scoring (Section 6.6), which depends only on the sequence, its declared modifications, and an internally maintained liability catalog.

---

# 9. Required Computational Models

| Capability | Model Category | Determinism |
|---|---|---|
| Structural stability estimation (folding free energy) | Empirical energy-function model (FoldX) | Deterministic given fixed structure and parameter set |
| Contextualized instability assessment | Deterministic re-weighting of upstream deterministic descriptors using structural context | Deterministic |
| Oxidation / deamidation liability detection | Rule-based sequence/structure scan | Deterministic |
| Structure-aware aggregation prediction | Empirical propensity model combined with structural solvent accessibility (Aggrescan3D) | Deterministic given fixed structure and parameter set |
| Solubility estimation | Empirically fitted or learned regression model (Protein-Sol) | Learned; deterministic at inference given fixed model/coefficients |
| Manufacturability scoring | Rule-based scoring engine (custom Python engine) | Deterministic |
| Formulation compatibility estimation | Deterministic integration function over preceding module outputs | Deterministic |

Per the Architecture Specification's AI Usage Philosophy (Section 1.6), the majority of this service's capabilities fall within the "Deterministic Algorithms" category — a direct consequence of the pharmaceutical-chemistry basis of most developability questions, which are governed by well-characterized physical and chemical rules rather than requiring statistical inference. Solubility estimation is the principal exception, falling within the "Scientific Prediction Models" category, and is treated accordingly in the confidence framework below.

---

# 10. Confidence Estimation Strategy

Consistent with the confidence-reporting precedent established in the preceding three Service Specifications, developability confidence is reported per component rather than as a single blended score.

## 10.1 Structure-Dependent Confidence

Because Stability Analysis (Section 6.1) and Aggregation Prediction (Section 6.4) both depend directly on structural evidence, their confidence is explicitly capped by the confidence of the underlying Structural Evidence Object (per-residue confidence and, where relevant, conformational flexibility metrics from the Structural Biology Service Specification, Section 10.1). A structurally low-confidence region cannot yield a high-confidence aggregation or stability assessment for that region, regardless of how confidently the empirical energy function or aggregation model scores the (uncertain) structure it is given.

## 10.2 Sequence-Only Confidence

Manufacturability scoring (Section 6.6) and oxidation/deamidation liability detection (Section 6.3, in its sequence-only aspect) depend only on sequence and modification information and are reported with the same **exact / reduced / unavailable** confidence convention established for deterministic descriptors in the Physicochemical Service Specification (Section 10.1): exact where all relevant reference parameters are available, reduced where non-standard residues or modifications lack catalog entries.

## 10.3 Model-Derived Confidence

Solubility estimation (Section 6.5) carries model-level confidence reflecting the fitted model's known performance characteristics and applicability domain, tracked via the Model Registry (Architecture Specification, Section 4.5), analogous to the treatment of learned models in the Physicochemical and Functional Analysis Service Specifications.

## 10.4 Integrated Confidence for Formulation Compatibility

Because Formulation Analysis (Section 6.7) synthesizes the outputs of the preceding modules rather than computing an independent primary signal, its confidence is derived as a function of the confidence of its constituent inputs, and is never reported as higher-confidence than its least reliable contributing component — preserving the platform-wide principle that aggregation of evidence must not manufacture false certainty.

## 10.5 Aggregate Confidence Field

A summary confidence descriptor accompanies the Evidence Object as a convenience roll-up for the Decision Layer's evidence integration stage; it never substitutes for the per-component confidence breakdown of Sections 10.1–10.4, consistent with the platform-wide transparency requirement (Architecture Specification, Section 1.5, Principle 3).

---

# 11. Limitations

- **No experimental validation within this service.** All stability, aggregation, solubility, and manufacturability estimates are computational predictions; none are confirmed against accelerated stability studies, analytical ultracentrifugation, solubility assays, or actual synthesis runs within this service's boundary.
- **Dependence on upstream structural quality.** Because Stability Analysis and Aggregation Prediction depend directly on Structural Evidence, any limitation of the Structural Biology Service (reduced reliability for short, flexible, or evolutionarily novel peptides; idealized representation of chemical modifications) propagates directly into this service's outputs.
- **Empirical energy functions are approximations.** Folding free-energy estimates (Section 6.1) rely on additive empirical terms parameterized from historical structural data, and are known to be less reliable for peptide-scale molecules than for larger, well-folded globular proteins, particularly for peptides that are only marginally structured.
- **Aggregation and solubility models are trained on finite reference data.** Predictions for peptides with compositions or modifications far outside the training distribution of Aggrescan3D or Protein-Sol carry reduced reliability that may not be fully reflected in the models' own reported confidence.
- **Manufacturability scoring reflects known liability classes only.** The rule-based liability catalog (Section 6.6) reflects currently understood synthesis chemistry; genuinely novel modification chemistries or coupling strategies not yet cataloged will not be flagged, even if they present real synthesis challenges.
- **Formulation compatibility is evaluated over a representative, not exhaustive, condition range.** Real formulation development explores a much broader and more granular space of excipients, concentrations, and storage conditions than this service can practically represent; its output should be read as an early screening signal, not a formulation-development substitute.

These limitations are recorded explicitly in the Evidence Object (Section 14) so that the Decision Layer and downstream services can account for them rather than treating developability evidence as ground truth.

---

# 12. Failure Handling

| Failure Mode | Detection | Handling |
|---|---|---|
| Structural Evidence absent or low-confidence | Stability Analysis or Aggregation Prediction module detects missing or low-confidence upstream Structural Evidence | Proceed using sequence-only fallback estimates where scientifically defensible (e.g., sequence-based instability index, intrinsic aggregation propensity without structural weighting); explicitly flag the reduced confidence and the fallback method used, rather than silently substituting a structure-dependent method's output |
| Non-standard residue or modification lacks reference parameters | Manufacturability Assessment or Aggregation Prediction encounters a residue/modification outside its parameter catalog | Compute all unaffected metrics normally; mark the specific affected metric(s) as unavailable with an explicit reason code; do not fail the entire service |
| Empirical energy function fails to converge or produces an unphysical result | Stability Analysis module's underlying computation returns no valid or an out-of-range free-energy estimate | Mark the structural stability field as unavailable with an explicit reason code; proceed with sequence-composition-based stability context alone |
| Solubility model input falls far outside training distribution | Solubility Estimation module flags an out-of-distribution input | Report the solubility estimate with an explicit out-of-distribution caveat rather than suppressing it, consistent with the platform's preference for annotated uncertainty over silent omission |
| Conflicting signals between sequence-based and structure-based stability assessments | Formulation Analysis module detects that Sections 6.1 and 6.2 disagree substantially | Report both signals explicitly with their independent confidence, rather than resolving the disagreement by averaging |

As with the preceding services, the guiding principle is **graceful degradation with explicit annotation**: a partially complete, clearly annotated Developability Evidence Object is always preferable to a fully populated but misleadingly confident one.

---

# 13. Performance Considerations

- **Rule-based modules (manufacturability scoring, oxidation/deamidation liability scanning) are computationally trivial**, executing in well under a second regardless of sequence length.
- **Empirical energy-function-based stability estimation (FoldX) and structure-aware aggregation prediction (Aggrescan3D) are more computationally demanding** than the purely sequence-based modules, since they operate over full atomic or residue-level structural coordinates, but remain substantially less expensive than the deep-learning structure prediction performed upstream by the Structural Biology Service.
- **Solubility estimation (Protein-Sol) is computationally inexpensive**, typically operating over a compact sequence-derived feature vector rather than full structural coordinates.
- **Formulation Analysis is a lightweight integration step**, executing after the other three modules complete and imposing negligible additional computational cost.
- **Parallelizable module structure.** Stability Analysis, Aggregation Prediction, and Manufacturability Assessment draw on largely independent inputs (structural evidence for the first two, sequence/modification information for the third) and may execute concurrently; the Workflow Orchestrator determines the actual scheduling.
- **Caching potential.** All modules in this service are deterministic functions of a fixed upstream Evidence state and fixed model/parameter versions (with the partial exception of the learned solubility model, which is deterministic at inference given fixed weights), making this service's outputs strong candidates for caching at the Infrastructure Layer.

---

# 14. Evidence Generated by the Service

The Developability Service publishes a single **Developability Evidence Object** per peptide, conforming to the platform-wide Evidence Object contract described in the Architecture Specification (Sections 3.6 and 6.4). Its structure, expressed schematically:

```text
Developability Evidence Object
├── peptide_object_reference
├── stability_assessment
│   ├── folding_free_energy               { value, confidence }
│   ├── contextualized_instability         { value, structural_context_used, confidence }
│   └── oxidation_deamidation_liabilities  { list of flagged residues/motifs, solvent exposure, confidence }
├── aggregation_analysis
│   ├── per_residue_aggregation_profile    { profile, confidence }
│   ├── aggregation_prone_segments         { list of flagged segments }
│   └── overall_aggregation_risk           { value, confidence }
├── solubility_estimate                    { value, confidence }
├── manufacturability_assessment
│   ├── manufacturability_score            { value, confidence }
│   └── flagged_liabilities                { list of specific synthesis-chemistry concerns }
├── formulation_compatibility
│   ├── compatible_ph_range                { range, confidence }
│   └── integrated_compatibility_note      { synthesis of stability/aggregation/solubility, confidence }
├── engineering_recommendations             [ structured, descriptive flags for potential sequence engineering ]
├── provenance
│   ├── originating_modules                [ stability_analysis, aggregation_prediction,
│   │                                         manufacturability_assessment, formulation_analysis,
│   │                                         evidence_generator ]
│   ├── model_identifier_and_version       [ e.g., FoldX version, Aggrescan3D version, Protein-Sol version ]
│   └── upstream_evidence_references        [ Physicochemical, Structural, and Functional Evidence Object references used ]
├── validation_status                      { complete | partially_complete | failed }
├── known_limitations                      [ Section 11 items applicable to this peptide ]
└── confidence_summary                     { structure_dependent_tier, sequence_only_tier,
                                              model_derived_tier, aggregate_note }
```

As with the preceding Evidence Objects, every field records not only its value but the model/algorithm identifier and version, and, where applicable, the upstream Evidence Object it draws on, consistent with the platform-wide reproducibility requirement (Architecture Specification, Section 1.5, Principle 4). This Evidence Object becomes one of the five inputs to the Platform Evidence Object (Architecture Specification, Section 6.4), and is consumed by the Safety Service (as pharmaceutical context for interpreting predicted toxicity and immunogenicity liabilities) and by the Decision & Validation Framework directly, since manufacturability and stability findings frequently carry direct weight in GO / Conditional GO / NO-GO determinations.

---

# 15. Future Extensibility

Consistent with the Architecture Specification's extensibility principle (Section 1.5, Principle 5; Section 7.3–7.4), the Developability Service is designed so that new pharmaceutical-engineering capabilities can be introduced without altering the surrounding architecture:

- **New or upgraded stability, aggregation, and solubility models** can replace the current Stability Analysis, Aggregation Prediction, or Solubility Estimation implementations; because the Evidence Object records model identifier and version, the Model Registry can track the transition without ambiguity, following the same replaceability pattern illustrated in Architecture Specification Section 7.4.
- **Expansion of the manufacturability liability catalog** to reflect newly characterized synthesis chemistries (novel linker chemistries, new coupling strategies, emerging modification classes) can be incorporated as additional rule entries in the Manufacturability Assessment module, without requiring changes to the Evidence Object schema beyond additional flagged-liability entries.
- **Broader formulation condition modeling** (e.g., explicit excipient compatibility, lyophilization behavior, or multi-variable condition surfaces rather than a single pH range) can extend the `formulation_compatibility` evidence field with additional sub-fields, without disrupting existing consumers relying on the current fields.
- **Support for additional therapeutic modalities** (antibody fragments, cyclic peptides, peptide-drug conjugates, and other future modalities listed in Architecture Specification Section 7.3) is expected to primarily extend the Manufacturability Assessment module's liability catalog and the Formulation Analysis module's condition-range logic, rather than requiring a new service — preserving the platform's capability-driven rather than modality-driven organization (Architecture Specification, Section 1.4).
- **Deeper integration with Functional Evidence** (e.g., explicitly modeling whether a functionally required conformation is itself a stability liability) can be added as an additional cross-reference within the Stability Assessment and Formulation Compatibility fields, building on the contextual Functional Evidence input already defined in Section 3.1, without requiring a new upstream dependency to be introduced.

These extension points ensure that the Developability Service can absorb scientific and pharmaceutical-engineering advances without requiring redesign of the Infrastructure Layer, the Evidence Bus, or the Decision & Validation Framework — preserving the technology-independent architecture that Version 3 was designed to establish.
