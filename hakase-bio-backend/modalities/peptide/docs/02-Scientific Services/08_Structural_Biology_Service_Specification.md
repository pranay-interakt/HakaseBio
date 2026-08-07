# Scientific Service Specification — Structural Biology Service

# 1. Purpose and Scope

## 1.1 Purpose

The Structural Biology Service is the second Scientific Service in the Version 3 evidence-generation pipeline. Its purpose is to generate three-dimensional structural evidence describing how a peptide is expected to fold, and — where a biological target is specified — how it is expected to dock, bind, and interface with that target.

This specification expands Section 5.5 of the Architecture Specification into a complete scientific design. It defines the biological rationale, computational methods, mathematical foundations, and evidentiary outputs of the service, remaining technology-independent except where the Recommended Engineering Stack has already designated specific tools (Boltz-2, Biopython PDB, MDTraj/MDAnalysis, Mol\*/py3Dmol, AutoDock Vina/DiffDock).

## 1.2 Scope

In scope:

- Scientific responsibilities of the Structural Biology Service.
- The internal computational pipeline, expressed as capabilities rather than code.
- The algorithms and mathematical models underlying structure prediction, complex modeling, interface analysis, and confidence assessment.
- The biological interpretation of each analysis and its relevance to peptide therapeutic development.
- Construction of the Structural Evidence Object.
- Confidence estimation, failure handling, and performance characteristics specific to this service.

Out of scope (defined elsewhere, per the Architecture Specification):

- Intrinsic sequence-level physicochemical computation (Physicochemical Service, which supplies this service's principal upstream input).
- Biological activity or functional classification (Functional Analysis Service).
- Manufacturability, formulation stability, and degradation kinetics (Developability Service), even though several of those assessments depend on structures produced here.
- Immunogenicity, toxicity, and other safety liabilities (Safety Service).
- Evidence integration and GO / Conditional GO / NO-GO logic (Decision & Validation Framework, Chapter 6).
- API contracts, database schemas, GPU provisioning, and deployment topology (Platform Infrastructure Layer, Chapter 4).

## 1.3 Position in the Platform

```text
Physicochemical Evidence Object
            │
            ▼
──────────────────────────────
    Structural Biology Service
──────────────────────────────
            │
            ▼
    Structural Evidence Object
            │
            ▼
Functional Analysis · Developability · Safety Services
            │
            ▼
Decision & Validation Framework
```

The Structural Biology Service consumes the Physicochemical Evidence Object (sequence, composition, modification graph, embeddings) as context and, where applicable, target information supplied at input validation. Because several downstream services (functional binding assessment, aggregation and stability prediction, epitope prediction) depend on a physically plausible 3D representation, this service is the platform's principal source of structural ground truth, and consequently carries the most heterogeneous confidence profile of any Scientific Service — its outputs range from near-experimental reliability for well-behaved sequences to highly uncertain for disordered or unusual peptides.

---

# 2. Scientific Responsibilities

| Responsibility | Description |
|---|---|
| Structure Prediction | Predict the peptide's tertiary (and, where relevant, secondary) structure in isolation. |
| Complex Prediction | Model the three-dimensional complex formed between the peptide and a specified biological target. |
| Interface Analysis | Characterize the residues, contacts, and interaction geometry at the peptide–target interface. |
| Structural Confidence Assessment | Quantify the reliability of each generated structure and complex. |
| Conformational Ensemble Characterization | Where the peptide is not expected to adopt a single rigid fold (short, flexible, or intrinsically disordered peptides), represent the plausible conformational landscape rather than a single static structure. |
| Evidence Generation | Publish the Structural Evidence Object. |

The service explicitly does **not**:

- Compute intrinsic sequence-level descriptors (already produced upstream by the Physicochemical Service and consumed here as context, not recomputed).
- Predict biological activity or mechanism of action from the structure (Functional Analysis Service).
- Judge whether a predicted structure is developable, stable in formulation, or safe (Developability and Safety Services).
- Make any therapeutic recommendation. It reports how the molecule is shaped and how it fits, never whether that shape is desirable.

This mirrors the Architecture Specification's separation between scientific computation and scientific decision making (Sections 1.4, 1.5) and its explicit statement that the Structural Biology Service's objective is to generate structural evidence, not judgments (Section 5.5).

---

# 3. Inputs and Outputs

## 3.1 Inputs

| Input | Description | Origin |
|---|---|---|
| Peptide Object | The standardized, canonicalized peptide representation (sequence, modification graph) | Physicochemical Service |
| Physicochemical Evidence | Descriptors and embeddings relevant to structural propensity (hydrophobic moment, hydrophobicity profile, compositional statistics) | Physicochemical Service |
| Target information | Structure or sequence of the intended biological target (receptor, enzyme, membrane model), where the discovery objective involves target engagement | User input / Resource Manager |
| Reference structures (optional) | Known experimental or predicted structures of homologous peptides or the target, used to inform or validate modeling | Resource Manager |

## 3.2 Outputs

| Output | Description |
|---|---|
| Predicted peptide structure | One or more 3D coordinate sets representing the peptide's tertiary structure or conformational ensemble |
| Predicted peptide–target complex | 3D coordinate set(s) representing the docked or co-folded assembly, when target information is supplied |
| Interface characterization | Enumerated contact residues, interaction types, and interface geometry descriptors |
| Structural confidence metrics | Per-residue and global reliability scores for all predicted structures and complexes |
| Structural Evidence Object | The standardized evidence artifact defined in Section 14, published to the Evidence Bus |

The service accepts one Peptide Object (and, optionally, one target specification) per invocation and produces exactly one Evidence Object; parallel evaluation of multiple targets or multiple candidate poses is a Job Scheduler and Workflow Orchestrator concern, not a scientific one.

---

# 4. Internal Computational Pipeline

```text
Peptide Object + Physicochemical Evidence (+ Target Information)
            │
            ▼
   ┌───────────────────────────┐
   │ Structural Feasibility     │  → assess suitability for rigid-fold prediction
   │ Triage                    │     vs. ensemble/disordered treatment
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │ Structure Prediction Engine│ → tertiary structure / conformational ensemble
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Complex Modeling          │  → peptide–target docking / co-folding
   │  (only if target supplied)│
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Interface Analysis        │  → contact residues, geometry, interaction typing
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Confidence Assessment     │  → per-residue and global reliability metrics
   └───────────────────────────┘
            │
            ▼
   ┌───────────────────────────┐
   │  Evidence Generator        │  → Structural Evidence Object
   └───────────────────────────┘
            │
            ▼
        Evidence Bus
```

The Structural Feasibility Triage stage is introduced here as a scientific refinement of the Architecture Specification's module list (Section 5.5): before committing computational resources to rigid tertiary structure prediction, the pipeline uses the physicochemical evidence (hydrophobic moment, compositional statistics, sequence length) to determine whether the peptide is more appropriately represented as a single dominant fold or as a conformational ensemble. This triage does not alter the module list defined in the Architecture Specification; it governs how the Structure Prediction Engine module is parameterized.

Complex Modeling and its downstream Interface Analysis execute only when target information is supplied; in target-agnostic discovery contexts, the pipeline terminates after Structure Prediction and Confidence Assessment, and the Evidence Object records complex-related fields as not applicable rather than absent due to failure.

---

# 5. Individual Computational Modules

## 5.1 Structural Feasibility Triage Module

Uses upstream physicochemical evidence to classify the peptide along a structural-determinacy spectrum: rigid/globular, constrained (cyclic, stapled, disulfide-bonded), or flexible/disordered. This classification determines whether the Structure Prediction Engine is run in single-structure mode or ensemble mode, and is recorded in the Evidence Object so the Decision Layer can interpret the resulting confidence appropriately.

## 5.2 Structure Prediction Engine Module

Generates the 3D tertiary structure of the isolated peptide, either as a single best-estimate coordinate set or as a representative conformational ensemble, using a deep-learning structure prediction model per the Recommended Engineering Stack (Boltz-2). This module is the platform's principal source of peptide-only structural evidence and produces the per-residue confidence metrics consumed in Section 5.5.

## 5.3 Complex Modeling Module

Predicts the three-dimensional assembly formed between the peptide and a specified target, using either co-folding (joint structure prediction of peptide and target) or docking (positioning a peptide of known or predicted structure onto a target of known or predicted structure), depending on the information available and the biological context (per the Recommended Engineering Stack: Boltz-2 for co-folding; AutoDock Vina / DiffDock for docking-based approaches). This module executes only when target information is present in the input.

## 5.4 Interface Analysis Module

Given a predicted complex, computes the set of interacting residues, classifies interaction types (hydrogen bonding, hydrophobic packing, electrostatic, aromatic stacking), and derives interface geometry descriptors (buried surface area, interface shape complementarity, contact density). This module operates on static coordinates but may draw on trajectory-based analysis tools (MDTraj / MDAnalysis, per the Recommended Engineering Stack) when a conformational ensemble or short simulation is available rather than a single static pose.

## 5.5 Confidence Assessment Module

Aggregates per-residue and global reliability metrics from the Structure Prediction Engine and Complex Modeling modules (Section 10) into a structured confidence report, distinguishing structural confidence (how reliable is the fold itself) from interface confidence (how reliable is the predicted binding mode), since these can diverge substantially — a peptide's own fold may be predicted with high confidence while its docked pose against a target remains uncertain, or vice versa.

## 5.6 Evidence Generator Module

Aggregates the outputs of Sections 5.2–5.5, together with provenance and confidence metadata, into the Structural Evidence Object and publishes it to the Evidence Bus. This module performs no scientific computation of its own; it is a packaging responsibility, consistent with the Evidence Generator module described for other services in the Architecture Specification.

---

# 6. Algorithms and Mathematical Foundations

## 6.1 Structure Prediction

**Definition.** Modern peptide structure prediction is formulated as a conditional generative problem: given a sequence $S = (r_1, \dots, r_n)$, predict a set of atomic coordinates $X \in \mathbb{R}^{n \times 3}$ (or a distribution over such coordinate sets) that minimizes a learned energy or maximizes a learned likelihood conditioned on evolutionary and structural priors encoded in the model's training data. Deep-learning structure predictors (e.g., diffusion-based or attention-based architectures such as Boltz-2) approximate:

$$P(X \mid S) \approx f_\theta(S)$$

where $f_\theta$ is a neural network with learned parameters $\theta$, typically trained to minimize a coordinate-based loss such as a frame-aligned point error (FAPE) or a distance-based loss over predicted pairwise residue distances.

**Ensemble representation.** For flexible or disordered peptides (per Section 5.1 triage), a single coordinate set is a poor representation of the true physical state. The pipeline instead samples $k$ structures $\{X_1, \dots, X_k\}$ from the model's predictive distribution (where the underlying model supports stochastic sampling) to approximate the conformational ensemble, and reports summary statistics (e.g., per-residue coordinate variance) alongside the pooled structural evidence.

**Biological rationale.** Peptide tertiary structure — or, for flexible peptides, the accessible conformational landscape — is the physical substrate on which every subsequent structural and functional judgment depends. Binding, membrane insertion, protease accessibility, and aggregation all depend on the three-dimensional arrangement of atoms, not on sequence alone.

## 6.2 Complex Prediction — Co-Folding

**Definition.** Given a peptide sequence $S_p$ and a target sequence or structure $T$, co-folding models jointly predict the assembled complex coordinates:

$$P(X_{\text{complex}} \mid S_p, T) \approx f_\theta(S_p, T)$$

using the same class of learned structure-prediction architecture as isolated structure prediction, but conditioned jointly on both molecular partners so that interface-relevant conformational adjustments (induced fit) can, in principle, be captured.

**Biological rationale.** Co-folding captures the possibility that a peptide's bound conformation differs from its unbound (apo) conformation — a common phenomenon for short, flexible peptides that fold upon binding. This is scientifically distinct from rigid-body docking (Section 6.3), which assumes minimal conformational change upon binding.

## 6.3 Complex Prediction — Docking

**Definition.** Rigid or semi-flexible docking searches over relative poses of a (typically pre-folded) peptide against a target structure, scoring each candidate pose $X_{\text{pose}}$ with an energy function of the general form:

$$E(X_{\text{pose}}) = E_{\text{vdW}} + E_{\text{elec}} + E_{\text{H-bond}} + E_{\text{desolv}} + E_{\text{torsional}}$$

combining van der Waals, electrostatic, hydrogen-bonding, desolvation, and internal torsional-strain terms (the general form implemented by tools such as AutoDock Vina). Learned pose-scoring approaches (e.g., DiffDock) replace the explicit energy function with a model trained to directly predict favorable poses, but the underlying scientific objective — identifying the lowest-energy, most physically plausible relative orientation — is unchanged.

**Biological rationale.** Docking is appropriate when the peptide is expected to retain a stable, pre-organized structure (e.g., disulfide-constrained or cyclic peptides) whose binding does not require substantial conformational rearrangement, making a search over rigid or near-rigid poses a scientifically valid simplification.

## 6.4 Interface Characterization

**Definition.** Given complex coordinates, contact residues are identified using a distance threshold criterion:

$$\text{contact}(i, j) = \mathbb{1}\left[\, \lVert x_i - x_j \rVert < d_{\text{cutoff}} \,\right]$$

typically applied to heavy-atom or side-chain centroid distances with $d_{\text{cutoff}}$ on the order of 4–5 Å. Buried surface area is computed as the difference between solvent-accessible surface area (SASA) of the isolated components and the complex:

$$\Delta SASA = SASA(peptide) + SASA(target) - SASA(complex)$$

Shape complementarity and interaction-type classification (hydrogen bond geometry, electrostatic complementarity, hydrophobic packing) apply established structural-biology geometric criteria to the identified contacts.

**Biological rationale.** The identity, chemistry, and geometry of interface contacts determine binding specificity and affinity, and directly inform whether a predicted interaction is biologically and pharmacologically plausible — information the Functional Analysis Service depends on when assessing target engagement.

## 6.5 Structural Confidence Metrics

**Definition.** Per-residue confidence is reported using the standard convention adopted by modern structure predictors — a per-residue predicted confidence score (analogous to pLDDT, on a 0–100 scale) reflecting the model's estimated agreement between predicted and true local structure, together with a predicted alignment error (PAE) matrix estimating expected positional error between residue pairs, which is particularly informative for the relative positioning of peptide and target in a complex.

**Biological rationale.** Because structure prediction models are more reliable for some sequences and regions than others (well-ordered, evolutionarily well-represented sequences predict more reliably than disordered or novel sequences), per-residue and pairwise confidence metrics allow downstream services and the Decision Layer to distinguish a structurally well-supported peptide from a plausible-looking but low-confidence guess — directly implementing the platform's transparency principle (Architecture Specification, Section 1.5, Principle 3).

## 6.6 Conformational Flexibility Metrics

**Definition.** For ensemble representations (Section 6.1), per-residue positional variance across the sampled ensemble,

$$\sigma_i^2 = \frac{1}{k}\sum_{j=1}^{k} \lVert x_{i,j} - \bar{x}_i \rVert^2$$

quantifies local flexibility, complementing the single-structure confidence metrics of Section 6.5 with an explicit measure of conformational heterogeneity rather than prediction uncertainty alone (a peptide can be confidently predicted to be flexible, which is scientifically different from an unreliable prediction of a single rigid structure).

**Biological rationale.** Flexibility metrics distinguish "the model is uncertain about the structure" from "the peptide is genuinely disordered" — a distinction with direct consequences for interpreting downstream developability (aggregation, protease susceptibility) and functional (induced-fit binding) evidence.

---

# 7. Biological Rationale Summary

| Analysis | Biological Question Answered |
|---|---|
| Structure prediction (isolated) | What three-dimensional shape, or range of shapes, does the peptide adopt on its own? |
| Ensemble sampling | Is the peptide rigid, or does it explore a meaningful conformational landscape? |
| Co-folding | Does the peptide undergo a conformational change upon binding its target? |
| Docking | Assuming the peptide retains a stable fold, what is its most favorable binding orientation against the target? |
| Interface contact analysis | Which residues, and what chemistry, mediate the peptide–target interaction? |
| Buried surface area / shape complementarity | How extensive and how geometrically favorable is the predicted interface? |
| Per-residue / pairwise confidence (pLDDT-like, PAE-like) | How much should this specific structural region, or this specific relative positioning, be trusted? |
| Conformational flexibility metrics | Is structural uncertainty due to genuine biological disorder or to model unreliability? |

Each analysis answers a specific, falsifiable structural question about the isolated peptide or the peptide–target assembly — never a judgment about therapeutic desirability, which remains the responsibility of the Decision Layer.

---

# 8. Required External Databases

| Resource | Purpose within this Service |
|---|---|
| Protein Data Bank (PDB) | Source of experimentally determined structures used as templates, benchmarks, or target structures for complex modeling. |
| AlphaFold Database | Source of precomputed predicted structures for targets or homologous peptides/proteins, reducing redundant computation when a suitable prediction already exists. |
| UniProt | Resolving target sequence and functional/domain annotation needed to contextualize predicted interfaces. |
| ChEMBL | Where the target is associated with known ligands or binding data, providing context for evaluating the plausibility of predicted binding modes. |

As with the Physicochemical Service, all access to these resources is routed exclusively through the Resource Manager (Architecture Specification, Section 4.6); the Structural Biology Service never communicates with external databases directly.

---

# 9. Required Computational Models

| Capability | Model Category | Determinism |
|---|---|---|
| Structural feasibility triage | Rule-based classification over upstream physicochemical evidence | Deterministic |
| Isolated peptide structure prediction | Deep-learning structure prediction model (Boltz-2) | Learned; deterministic given fixed weights and, where sampling is used, a fixed random seed |
| Complex co-folding | Deep-learning joint structure prediction model (Boltz-2) | Learned; same determinism profile as above |
| Rigid/semi-flexible docking | Physics-based scoring engine (AutoDock Vina) or learned pose-generation model (DiffDock) | Vina: deterministic given a fixed search protocol; DiffDock: learned, sampling-based |
| Interface geometry and SASA calculation | Deterministic geometric algorithms (Biopython PDB, MDTraj/MDAnalysis) | Deterministic |
| Structural and interface confidence scoring | Model-intrinsic confidence heads (pLDDT-like, PAE-like outputs) | Learned, reported alongside the structure itself |

Per the Architecture Specification's AI Usage Philosophy (Section 1.6), structure and complex prediction fall squarely within the "Scientific Prediction Models" category; interface geometry calculations (contact identification, SASA, shape complementarity) fall within "Deterministic Algorithms" once coordinates exist. This distinction is preserved throughout the confidence framework below.

---

# 10. Confidence Estimation Strategy

Consistent with the Physicochemical Service's precedent of reporting confidence per component rather than as a single blended score, structural confidence is reported across three independent axes:

## 10.1 Structural Confidence (Fold Reliability)

Derived directly from the Structure Prediction Engine's per-residue confidence output (Section 6.5) and, where an ensemble is generated, cross-checked against the conformational flexibility metric (Section 6.6). A region with both low per-residue confidence and low ensemble variance suggests a genuinely unreliable single-structure prediction; a region with low per-residue confidence but high ensemble variance suggests the model has (appropriately) expressed disorder rather than committed to an unreliable single guess.

For isolated peptide structure prediction, per-residue pLDDT is exposed as normalized 0-100 values in input sequence order. Each record contains the 1-based position, one-letter residue, pLDDT value, and deterministic category:

| Category | Rule |
|---|---|
| very_high | pLDDT >= 90 |
| confident | 70 <= pLDDT < 90 |
| low | 50 <= pLDDT < 70 |
| very_low | pLDDT < 50 |

Low-confidence regions are contiguous 1-based inclusive ranges where pLDDT < 70. Region severity is assigned from the minimum pLDDT in that region: `very_low` if any residue is below 50, otherwise `low`. If the number of pLDDT values does not match the input sequence length, the service must not assign residue-level scores; it reports per-residue confidence as unavailable with an explicit warning while preserving valid structure and geometry outputs.

## 10.2 Complex / Interface Confidence

Derived from the pairwise (PAE-like) confidence output of the Complex Modeling module, together with the physical plausibility of the interface geometry (Section 6.4). An interface with strong pairwise confidence but poor geometric complementarity, or vice versa, is flagged for reduced aggregate confidence, since both signals are individually necessary but not individually sufficient for a trustworthy binding-mode prediction.

## 10.3 Model Provenance and Benchmark Context

Every structural or complex prediction records the specific model identifier and version used, consistent with the Model Registry's role (Architecture Specification, Section 4.5) in tracking validation status and benchmark metadata for every computational model. Confidence reported by this service is always interpreted in the context of that model's known benchmark performance, rather than treated as an absolute, model-independent probability.

## 10.4 Aggregate Confidence Field

A summary confidence descriptor accompanies the Evidence Object as a convenience roll-up for the Decision Layer's evidence integration stage; it never substitutes for the per-axis, per-region confidence breakdown of Sections 10.1–10.3, preserving the platform-wide transparency requirement (Architecture Specification, Section 1.5, Principle 3).

---

# 11. Limitations

- **No experimental validation within this service.** All structures and complexes are computational predictions; none are confirmed against crystallographic, NMR, or cryo-EM data within this service's boundary.
- **Reduced reliability for short, flexible, and evolutionarily novel peptides.** Structure prediction models trained predominantly on natural, evolutionarily well-represented proteins are inherently less reliable for very short peptides, heavily modified sequences, or peptides with no close evolutionary relatives — a domain-shift limitation directly analogous to the one identified for sequence embeddings in the Physicochemical Service specification.
- **Idealized or incomplete representation of chemical modifications.** Certain modifications relevant to peptide therapeutics (specific cyclization chemistries, non-natural side chains, stapling) may not be fully or accurately represented by structure prediction models trained primarily on canonical amino acids.
- **Docking and co-folding assume a single relevant binding mode.** In reality, some peptide–target interactions may involve multiple, near-degenerate binding modes; the pipeline reports its top-ranked prediction(s) with confidence, but does not guarantee exhaustive enumeration of all biologically relevant poses.
- **Rigid-docking assumptions may not hold.** Where docking (rather than co-folding) is used, the assumption of minimal conformational change upon binding may not be valid for peptides that in reality undergo substantial induced-fit rearrangement.
- **Confidence metrics are model-intrinsic estimates, not physical measurements.** Per-residue and pairwise confidence scores reflect the model's own estimate of its reliability, which is itself an imperfect prediction and can be systematically miscalibrated for certain sequence classes.
- **No dynamics beyond the sampled ensemble.** Where trajectory-based tools (MDTraj/MDAnalysis) are used for interface or flexibility analysis, the timescales and sampling are necessarily limited relative to true biological motion, and should not be interpreted as a complete dynamic characterization.

These limitations are recorded explicitly in the Evidence Object (Section 14) so that downstream services and the Decision Layer can account for them rather than treating structural evidence as ground truth.

---

# 12. Failure Handling

| Failure Mode | Detection | Handling |
|---|---|---|
| Structure prediction model fails to converge or times out | Structure Prediction Engine returns no valid coordinate set within the allotted execution window | Publish an Evidence Object with structure fields marked unavailable and an explicit reason code; do not fail the entire service if physicochemical context is still usable downstream |
| Target structure or sequence unresolvable | Complex Modeling module cannot obtain a usable target representation via the Resource Manager | Skip Complex Modeling and Interface Analysis; mark complex-related fields as not applicable; proceed with isolated structure prediction only |
| Peptide falls far outside model training distribution (e.g., extreme length, exotic chemistry) | Structural Feasibility Triage or Structure Prediction Engine flags low-confidence or anomalous output | Proceed with computation but attach an explicit out-of-distribution caveat; do not silently suppress the low-confidence result |
| Per-residue pLDDT count does not match input sequence length | Confidence Assessment detects a mismatch before residue assignment | Do not fabricate or align residue scores; report per-residue confidence and low-confidence regions as unavailable with a reason code, while preserving valid structure and geometry results |
| Docking search yields no energetically or geometrically plausible pose | Complex Modeling module's scoring stage returns no pose above a minimum plausibility threshold | Report the absence of a plausible binding mode as a substantive negative finding, not as a service failure; record best-attempted poses with clearly marked low confidence if available |
| Conflicting or malformed target input | Complex Modeling module detects inconsistent target metadata | Reject complex-related computation at input with a descriptive validation error; isolated structure prediction may still proceed if the peptide input itself is valid |
| GPU or compute-resource unavailability | Job Scheduler reports resource exhaustion or unavailability for structure prediction workloads | Not a scientific failure mode; handled entirely by the Infrastructure Layer's retry and scheduling mechanisms (Architecture Specification, Section 4.4, 4.7) |

As with the Physicochemical Service, the guiding principle is **graceful degradation with explicit annotation**: a partially complete, clearly annotated Structural Evidence Object (e.g., isolated structure present, complex absent) is always preferable to withholding all evidence, and a low-confidence but clearly flagged result is always preferable to a silently discarded one.

---

# 13. Performance Considerations

- **Structure and complex prediction are the dominant computational cost** in this service, typically requiring GPU acceleration; runtime scales with sequence length, target size, and (for ensemble or docking-based approaches) the number of samples or poses generated.
- **Isolated structure prediction is substantially less expensive than complex prediction**, since the latter must reason jointly over a larger combined system (peptide plus target); the pipeline therefore only invokes Complex Modeling when target information is actually supplied (Section 4).
- **Docking-based approaches (AutoDock Vina) are generally less computationally expensive than co-folding**, since they search over a pre-folded peptide's pose space rather than jointly predicting both partners' structures, making the choice between docking and co-folding (Section 6.2 vs. 6.3) a scientifically motivated tradeoff with direct performance consequences.
- **Ensemble sampling multiplies cost roughly linearly with the number of samples**, and is invoked selectively — only for peptides triaged as flexible or disordered (Section 5.1) — rather than universally, to avoid unnecessary computational expense for well-ordered peptides.
- **Interface and geometry analysis (contact detection, SASA, shape complementarity) is computationally inexpensive** relative to structure prediction itself, scaling with the number of atoms rather than requiring model inference.
- **Caching potential**: predicted structures for a given Peptide Object, and predicted complexes for a given (Peptide Object, target) pair, are deterministic functions of a fixed model version and are therefore candidates for caching at the Infrastructure Layer — an opportunity outside this service's own scientific responsibility.
- **Scheduling and GPU allocation** are Job Scheduler responsibilities (Architecture Specification, Section 4.7); this service specifies computational cost characteristics but does not manage resource allocation itself.

---

# 14. Evidence Generated by the Service

The Structural Biology Service publishes a single **Structural Evidence Object** per peptide (and, where applicable, per peptide–target pair), conforming to the platform-wide Evidence Object contract described in the Architecture Specification (Sections 3.6 and 6.4). Its structure, expressed schematically:

```text
Structural Evidence Object
├── peptide_object_reference
├── target_reference                     { present | not_applicable }
├── structural_classification
│   └── triage_result                    { rigid | constrained | flexible/disordered, confidence }
├── isolated_structure
│   ├── status                           { available | unavailable | partial | error }
│   ├── reason_code                      { machine-readable reason when partial/unavailable/error }
│   ├── prediction                       { provider, model_id, model_version, n_residues,
│   │                                      mean_plddt, plddt_scale="0-100",
│   │                                      raw_plddt_scale }
│   ├── geometry                         { n_residues, mean_plddt, minimum_plddt,
│   │                                      maximum_plddt, confident_residue_fraction,
│   │                                      radius_of_gyration_angstrom,
│   │                                      end_to_end_distance_angstrom,
│   │                                      compactness_ratio, disulfide_geometry }
│   ├── confidence
│   │   ├── per_residue                  [ { position, residue, plddt, confidence_category } ]
│   │   ├── low_confidence_regions       [ { start, end, length, mean_plddt,
│   │   │                                  minimum_plddt, residues, severity } ]
│   │   └── summary                      { category counts/fractions, low-confidence counts,
│   │                                      mean/min/max pLDDT, plddt_scale="0-100" }
│   ├── pdb                              { status, format="pdb", content,
│   │                                      content_encoding, n_residues,
│   │                                      provider, model_id, model_version }
│   ├── provenance                       { provider, model_id, model_version,
│   │                                      plddt_scale="0-100", raw_plddt_scale }
│   └── limitations                      [ { code, description } ]
├── complex_prediction                    { present | not_applicable }
│   ├── coordinate_set                    { predicted complex structure }
│   ├── modeling_approach                 { co-folding | docking }
│   ├── pairwise_confidence                { PAE-like matrix, confidence }
│   └── modeling_method                    { model / engine and version }
├── interface_analysis                    { present | not_applicable }
│   ├── contact_residues                   { list, per-partner }
│   ├── interaction_types                  { hydrogen bond | electrostatic | hydrophobic | aromatic stacking }
│   ├── buried_surface_area                 { value }
│   └── shape_complementarity               { value }
├── provenance
│   ├── originating_modules                [ triage, structure_prediction, complex_modeling,
│   │                                         interface_analysis, confidence_assessment,
│   │                                         evidence_generator ]
│   ├── model_identifier_and_version       [ e.g., Boltz-2 checkpoint version, docking engine version ]
│   └── reference_structures_used          [ PDB / AlphaFold Database identifiers, if any ]
├── validation_status                      { complete | partially_complete | failed }
├── known_limitations                      [ Section 11 items applicable to this peptide/complex ]
└── confidence_summary                     { structural_tier, interface_tier, aggregate_note }
```

The Phase 1 runtime API also preserves the historical top-level structural fields for backward compatibility:

```text
structure
geometry
per_residue_confidence
low_confidence_regions
confidence_summary
pdb_output
warnings
```

These fields are compatibility aliases for the same isolated peptide prediction, geometry, and Task 6 confidence data nested under `isolated_structure`. New consumers should prefer `isolated_structure`; existing consumers may continue reading the top-level fields. pLDDT values are normalized to the 0-100 scale throughout the public response, residue positions are 1-based, Angstrom-valued geometry fields are suffixed with `_angstrom`, and fractions such as `confident_residue_fraction` are reported on the 0-1 scale.

PDB output behavior is controlled by the request field `include_pdb`:

- `include_pdb=false`: full coordinate text is not returned. The response includes lightweight status objects:

```json
{
  "pdb_output": {
    "status": "not_requested",
    "format": "pdb",
    "content": null
  },
  "isolated_structure": {
    "pdb": {
      "status": "not_requested",
      "format": "pdb",
      "content": null
    }
  }
}
```

- `include_pdb=true`: the service reuses the PDB text already returned by the selected structure provider and does not run another prediction. When validation succeeds, the same PDB object is exposed at both `pdb_output` and `isolated_structure.pdb`:

```json
{
  "status": "available",
  "format": "pdb",
  "content_encoding": "plain_text",
  "content": "ATOM ...",
  "n_residues": 9,
  "byte_length": 8421,
  "provider": "esmfold_esmatlas",
  "model_id": "esmfold_v1",
  "model_version": "1.0.0"
}
```

The PDB content is inline standard PDB text in Phase 1. It is marked `available` only when the content is a non-empty string, contains coordinate records (`ATOM` or `HETATM`), and has a parsed residue count consistent with the existing structure, geometry, and confidence residue counts. If requested content is missing or invalid, the object is:

```json
{
  "status": "unavailable",
  "format": "pdb",
  "content": null,
  "reason_code": "pdb_content_unavailable"
}
```

No temporary file paths, cache paths, local server paths, or provider-internal URLs are returned. Phase 1 does not create a separate download reference; secure file serving can be added later as an additive field if the platform defines that mechanism.

Status behavior:

- `available`: prediction, geometry, and Task 6 confidence are all present.
- `partial`: prediction and geometry are present, but a derived isolated-structure section is unavailable. For example, a pLDDT/sequence length mismatch produces `reason_code="plddt_sequence_length_mismatch"` and does not fabricate per-residue confidence. When `include_pdb=true` and PDB output is unavailable, `isolated_structure.status` is also `partial`; when `include_pdb=false`, `isolated_structure.status` remains governed by prediction, geometry, and confidence availability.
- `unavailable`: no isolated structure result exists because the structure provider could not produce a usable prediction.
- `error`: reserved for recoverable failure states only where the implementation distinguishes error from unavailable output.

The Phase 1 isolated structure limitations are intentionally narrow: isolated peptide prediction only, no target-bound complex prediction in this object, model-derived confidence rather than experimental validation, uncertain conformations for short or flexible peptides, and no molecular dynamics validation in Phase 1.

As with the Physicochemical Evidence Object, every field records not only its value but the model/algorithm identifier and version that produced it, consistent with the platform-wide reproducibility requirement (Architecture Specification, Section 1.5, Principle 4). This Evidence Object becomes one of the five inputs to the Platform Evidence Object (Architecture Specification, Section 6.4), and is consumed directly by the Functional Analysis Service (binding and mechanism assessment), the Developability Service (structural stability and aggregation context), and the Safety Service (structural context for epitope and interaction prediction).

---

# 15. Future Extensibility

Consistent with the Architecture Specification's extensibility principle (Section 1.5, Principle 5; Section 7.3–7.4), the Structural Biology Service is designed so that new structural capabilities can be introduced without altering the surrounding architecture:

- **New or upgraded structure prediction models** can replace the current Structure Prediction Engine or Complex Modeling implementation; because the Evidence Object records model identifier and version, downstream services and the Model Registry can track the transition without ambiguity, following the same "Current Implementation" replaceability pattern illustrated in Architecture Specification Section 7.4 for this exact service.
- **Additional docking or co-folding engines** can be incorporated as alternative Complex Modeling strategies, selected per peptide/target characteristics by the Structural Feasibility Triage logic, without changing the Evidence Object schema beyond recording the additional engine identifier.
- **Expanded conformational ensemble methods** (e.g., incorporating short molecular dynamics simulations rather than model-based sampling alone) can extend the Conformational Flexibility Metrics of Section 6.6 as an additional evidence field, without disrupting existing consumers relying on the current per-residue confidence and variance fields.
- **Support for additional therapeutic modalities** (antibody fragments, cyclic peptides, gene-editing-associated peptide components, and other future modalities listed in Architecture Specification Section 7.3) is expected to primarily extend the Structural Feasibility Triage module's classification logic and the modeling methods available to the Structure Prediction and Complex Modeling modules, rather than requiring a new service — preserving the platform's capability-driven rather than modality-driven organization (Architecture Specification, Section 1.4).
- **Multi-target or multi-pose evidence**: the Complex Modeling and Interface Analysis modules may in the future report evidence for multiple candidate targets or multiple plausible binding poses per target as parallel, independently versioned entries, without disrupting existing consumers that rely on the current single-complex fields.

These extension points ensure that the Structural Biology Service can absorb scientific advances in structure prediction and molecular modeling without requiring redesign of the Infrastructure Layer, the Evidence Bus, or the Decision & Validation Framework — preserving the technology-independent architecture that Version 3 was designed to establish.
