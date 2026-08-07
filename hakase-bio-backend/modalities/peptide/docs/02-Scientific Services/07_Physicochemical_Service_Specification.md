# Scientific Service Specification — Physicochemical Service

# 1. Purpose and Scope

## 1.1 Purpose

The Physicochemical Service is the first Scientific Service invoked in the Version 3 evidence-generation pipeline. Its purpose is to transform a validated peptide sequence into a standardized, quantitative molecular representation — a set of intrinsic physicochemical descriptors and machine-derived embeddings that describe the peptide as a molecule, independent of any biological target, therapeutic modality, or downstream decision.

This specification expands Section 5.4 of the Architecture Specification into a complete scientific design. It defines the biological and chemical rationale, computational methods, mathematical foundations, and evidentiary outputs of the service, without prescribing an implementation beyond the tools already designated in the Recommended Engineering Stack (Biopython, ProtParam, RDKit, ESM-2/ProtT5, NumPy, Pandas).

## 1.2 Scope

In scope:

- Scientific responsibilities of the Physicochemical Service.
- The computational pipeline internal to the service, expressed as capabilities rather than code.
- The algorithms and mathematical models underlying each descriptor.
- The biological interpretation of each analysis and its relevance to peptide therapeutic development.
- The construction of the Physicochemical Evidence Object.
- Confidence estimation, failure handling, and performance characteristics specific to this service.

Out of scope (defined elsewhere, per the Architecture Specification):

- Workflow orchestration, job scheduling, and resource access mechanics (Platform Infrastructure Layer, Chapter 4).
- Structural, functional, developability, and safety computation (their respective Scientific Services).
- Evidence integration and GO / Conditional GO / NO-GO logic (Decision & Validation Framework, Chapter 6).
- API contracts, database schemas, and deployment topology.

## 1.3 Position in the Platform

```text
Validated Peptide Sequence
            │
            ▼
──────────────────────────────
   Physicochemical Service
──────────────────────────────
            │
            ▼
Physicochemical Evidence Object
            │
            ▼
Structural Biology · Functional Analysis ·
Developability · Safety Services
            │
            ▼
Decision & Validation Framework
```

Because every downstream service consumes physicochemical descriptors or embeddings either directly (as features) or indirectly (as context for interpreting their own predictions), the Physicochemical Service occupies a foundational position: errors or omissions here propagate through the entire evidence chain. It is deliberately the most deterministic service in the platform, minimizing the propagation of predictive uncertainty at the earliest possible stage.

---

# 2. Scientific Responsibilities

| Responsibility | Description |
|---|---|
| Molecular Representation | Construct the standardized Peptide Object — a canonical, disambiguated representation of the sequence, composition, and any non-standard residues or modifications. |
| Sequence-Level Characterization | Compute intrinsic properties derived purely from primary sequence: length, composition, charge, polarity distribution. |
| Physicochemical Descriptor Calculation | Compute molecular descriptors — mass, isoelectric point, hydrophobicity, instability, aromaticity, amphipathicity — that characterize the peptide as a chemical entity. |
| Modified and Non-Canonical Residue Handling | Represent chemically modified peptides (cyclization, D-amino acids, non-natural side chains, PEGylation, lipidation) in a form compatible with descriptor calculation. |
| Feature and Embedding Generation | Produce dense numerical representations (protein language model embeddings) for consumption by downstream machine learning models. |
| Evidence Generation | Package all computed properties, embeddings, provenance, and confidence into the standardized Physicochemical Evidence Object and publish it to the Evidence Bus. |

The service explicitly does **not**:

- Predict three-dimensional structure (Structural Biology Service).
- Predict biological activity, binding, or function (Functional Analysis Service).
- Assess manufacturability, solubility in formulation, or degradation half-life (Developability Service).
- Assess immunogenicity or toxicity (Safety Service).
- Make any therapeutic judgment. It reports what the molecule *is*, never whether it is *good*.

This mirrors the Architecture Specification's separation between scientific computation and scientific decision making (Sections 1.4, 1.5).

---

# 3. Inputs and Outputs

## 3.1 Inputs

| Input | Description | Origin |
|---|---|---|
| Validated peptide sequence | A syntactically and biochemically validated amino-acid sequence (standard IUPAC one-letter codes, possibly annotated with non-standard residues) | Input Validation stage, upstream of the Infrastructure Layer |
| Modification annotations | User- or pipeline-supplied metadata describing cyclization, disulfide bridges, N-/C-terminal capping, D-amino acid substitutions, PEGylation, lipidation, or other chemical modifications | User input, passed through the Resource Manager |
| Reference metadata (optional) | Identifiers linking the sequence to external records (e.g., UniProt accession, PeptideAtlas entry) for provenance and cross-validation | Resource Manager |

## 3.2 Outputs

| Output | Description |
|---|---|
| Standardized Peptide Object | Canonical internal representation of the peptide (sequence, composition, modification graph) consumed by all downstream services |
| Physicochemical descriptor set | The numerical and categorical properties described in Section 5 |
| Sequence embeddings | Fixed- or variable-length vector representations from a protein language model |
| Physicochemical Evidence Object | The standardized evidence artifact defined in Section 14, published to the Evidence Bus |

The service accepts exactly one Peptide Object per invocation and produces exactly one Evidence Object; batch invocation is a Job Scheduler concern, not a scientific concern.

---

# 4. Internal Computational Pipeline

The service pipeline consists of four sequential stages, each corresponding to one of the four Core Computational Modules identified in the Architecture Specification (Section 5.4).

```text
Validated Peptide Sequence
            │
            ▼
   ┌─────────────────────┐
   │ Sequence Validation │  → canonicalization, modification parsing
   └─────────────────────┘
            │
            ▼
   ┌─────────────────────┐
   │ Descriptor Calculator│ → deterministic physicochemical properties
   └─────────────────────┘
            │
            ▼
   ┌─────────────────────┐
   │  Feature Generator  │  → embeddings for ML consumption
   └─────────────────────┘
            │
            ▼
   ┌─────────────────────┐
   │  Evidence Generator │  → Physicochemical Evidence Object
   └─────────────────────┘
            │
            ▼
       Evidence Bus
```

Stages 2 and 3 are independent of one another and may execute concurrently once Stage 1 completes; the Workflow Orchestrator (Infrastructure Layer) is responsible for that scheduling decision, not the service itself. Stage 4 requires the completed outputs of both.

---

# 5. Individual Computational Modules

## 5.1 Sequence Validation and Canonicalization Module

Responsible for producing the Standardized Peptide Object. Its scientific functions:

- Parsing the raw sequence into a residue graph, resolving ambiguity codes and non-standard residues.
- Normalizing modification annotations (cyclic backbone, disulfide connectivity, terminal capping, D-stereochemistry, lipidation, PEGylation) into a structured representation that later modules can consume without re-parsing free text.
- Flagging sequences that cannot be canonicalized (e.g., unresolvable ambiguity, conflicting modification annotations) for the Failure Handling procedure in Section 12.

This module performs no predictive computation; it is a deterministic parsing and normalization step, consistent with the "Deterministic Algorithms" category defined in the Architecture Specification's AI Usage Philosophy (Section 1.6).

## 5.2 Descriptor Calculator Module

Computes the full set of intrinsic physicochemical descriptors described in Section 6. All descriptors in this module are computed by closed-form formulas or lookup-table-based sums over the canonicalized sequence — no statistical or machine-learned model is involved, and results are exactly reproducible given an identical sequence and modification state.

## 5.3 Feature Generator Module

Produces dense vector embeddings using a pretrained protein language model. Unlike the Descriptor Calculator, this module is a learned computational model rather than a deterministic algorithm, and is treated accordingly in the confidence and provenance framework (Sections 10 and 14).

## 5.4 Evidence Generator Module

Aggregates the outputs of 5.2 and 5.3, together with provenance and confidence metadata, into the Physicochemical Evidence Object and hands it to the Evidence Bus. This module contains no scientific computation of its own; it is a packaging responsibility.

---

# 6. Algorithms and Mathematical Foundations

Each descriptor below is presented with its mathematical definition and biological rationale together, since in this service the two are inseparable — every formula exists because it captures a specific biophysical property relevant to peptide behavior.

## 6.1 Molecular Weight (MW)

**Definition.** For a peptide of residues $r_1, r_2, \dots, r_n$:

$$MW = \sum_{i=1}^{n} m(r_i) - (n-1)\cdot m(H_2O)$$

where $m(r_i)$ is the average or monoisotopic residue mass and $m(H_2O)$ (≈18.015 Da) is subtracted once per peptide bond formed, accounting for the condensation reaction. Terminal modifications (acetylation, amidation) and side-chain modifications (PEGylation, lipidation) add or subtract known mass increments to this base value.

**Biological rationale.** Molecular weight determines renal clearance behavior, membrane permeability, and the applicability range of downstream tools (e.g., many docking and MD engines have practical size limits). It is the single most load-bearing descriptor for dose calculations and formulation planning performed later by the Developability Service.

## 6.2 Isoelectric Point (pI) and Net Charge

**Definition.** The net charge of the peptide at pH $p$ is modeled by the Henderson–Hasselbalch treatment of all ionizable groups:

$$Q(p) = \sum_{\text{basic } i} \frac{1}{1 + 10^{(p - pK_{a,i})}} \; - \sum_{\text{acidic } j} \frac{1}{1 + 10^{(pK_{a,j} - p)}}$$

summed over ionizable side chains (Asp, Glu, His, Cys, Tyr, Lys, Arg) and the free N-/C-termini when not capped. The isoelectric point pI is the value of $p$ at which $Q(p) = 0$, typically located by bisection.

**Biological rationale.** Net charge at physiological pH (~7.4) governs solubility, aggregation propensity, membrane interaction, and — critically for antimicrobial and cell-penetrating peptides — electrostatic attraction to anionic microbial membranes or glycosaminoglycans. pI additionally predicts behavior during purification (isoelectric precipitation, ion-exchange chromatography) that is directly relevant to manufacturability, later consumed by the Developability Service.

## 6.3 Hydrophobicity and GRAVY

**Definition.** Using a residue hydrophobicity scale $h(r_i)$ (e.g., Kyte–Doolittle):

$$GRAVY = \frac{1}{n}\sum_{i=1}^{n} h(r_i)$$

Local hydrophobicity is additionally examined with a sliding window of width $w$ (typically 5–9 residues):

$$H_{\text{window}}(k) = \frac{1}{w}\sum_{i=k}^{k+w-1} h(r_i)$$

**Biological rationale.** Mean hydrophobicity correlates with membrane partitioning and aggregation propensity. Windowed hydrophobicity profiles reveal amphipathic segments — a hallmark of membrane-active and antimicrobial peptides — that a single averaged value would obscure. This profile is passed forward as a feature to the Functional Analysis and Safety Services (e.g., hemolysis and membrane-disruption prediction rely on amphipathic segment detection).

## 6.4 Amphipathicity — Hydrophobic Moment

**Definition.** For peptides expected to adopt an α-helical or β-strand conformation, the hydrophobic moment quantifies the asymmetry of hydrophobicity around the structural axis:

$$\mu_H = \left[ \left(\sum_{i=1}^{n} h(r_i)\sin(i\delta)\right)^2 + \left(\sum_{i=1}^{n} h(r_i)\cos(i\delta)\right)^2 \right]^{1/2}$$

where $\delta$ is the mean residue-to-residue turn angle (100° for an α-helix, 160°–180° for a β-strand).

**Biological rationale.** The hydrophobic moment (Eisenberg formalism) is a key predictor of a peptide's ability to insert into and disrupt lipid bilayers, and is one of the strongest sequence-derived correlates of antimicrobial and hemolytic activity. It is computed here, at the physicochemical stage, because it depends only on primary sequence and an assumed secondary-structure periodicity — not on an actual 3D structure, which is the province of the Structural Biology Service.

## 6.5 Net Charge Density and Charge Distribution

Beyond total net charge, the spatial distribution of charged residues along the sequence is characterized (e.g., clustering of cationic residues at a terminus vs. even distribution). This is computed as a positional variance of charge sign, analogous to the windowed hydrophobicity calculation in 6.3.

**Biological rationale.** Charge clustering (rather than magnitude alone) influences membrane-binding kinetics and protease accessibility, both relevant to downstream functional and developability predictions.

## 6.6 Instability Index

**Definition (Guruprasad et al. method).** Computed from a lookup table of dipeptide instability weight values $DIWV(r_i, r_{i+1})$:

$$II = \frac{10}{n} \sum_{i=1}^{n-1} DIWV(r_i, r_{i+1})$$

A peptide with $II > 40$ is classified as predicted unstable in a test-tube (in vitro) context.

**Biological rationale.** The instability index estimates in vitro degradation propensity from dipeptide composition statistics derived from observed protein stability data. It provides an early, sequence-only signal that is later refined and contextualized by the Developability Service's dedicated stability and protease-cleavage models (FoldX, PROSPERous), which incorporate structural and enzymatic context this service does not have access to.

## 6.7 Aliphatic Index

**Definition:**

$$AI = X(Ala) + a\cdot X(Val) + b\cdot\big(X(Ile) + X(Leu)\big)$$

where $X$ denotes mole percent composition and $a = 2.9$, $b = 3.9$ are empirically derived relative volume coefficients for aliphatic side chains.

**Biological rationale.** The aliphatic index correlates with thermal stability across a wide range of globular proteins and, for peptides, provides a coarse proxy for packing density and resistance to thermal denaturation — informative context for formulation temperature ranges assessed downstream.

## 6.8 Aromaticity

**Definition.** The fraction of aromatic residues (Phe, Trp, Tyr) in the sequence:

$$Ar = \frac{X(Phe) + X(Trp) + X(Tyr)}{n}$$

**Biological rationale.** Aromaticity relates to UV absorbance (relevant for later analytical quantification), π-stacking-mediated aggregation risk, and membrane-anchoring behavior (aromatic residues preferentially localize at the membrane interface, the "aromatic belt" phenomenon).

## 6.9 Boman Index (Protein-Binding Potential)

**Definition.** The negative mean of side-chain solvation free energies:

$$Boman = -\frac{1}{n}\sum_{i=1}^{n} \Delta G_{\text{solv}}(r_i)$$

**Biological rationale.** Empirically, higher Boman index values correlate with a greater propensity for protein–protein interaction, a coarse but useful early signal feeding into the Functional Analysis Service's assessment of receptor engagement potential.

## 6.10 Sequence-Level Statistics

Standard compositional statistics — amino-acid frequency vector, dipeptide frequency vector, count and position of cysteines (disulfide-bonding potential), proline content (backbone rigidity and protease resistance), and glycine content (backbone flexibility) — are computed as a byproduct of the Descriptor Calculator and retained as auxiliary features for downstream machine learning models.

## 6.11 Sequence Embeddings

**Definition.** A pretrained protein language model (e.g., ESM-2 or ProtT5) maps the sequence to a contextual embedding matrix $E \in \mathbb{R}^{n \times d}$, where $d$ is the model's hidden dimension. A pooled, fixed-length representation is typically obtained by mean-pooling across positions:

$$\bar{e} = \frac{1}{n}\sum_{i=1}^{n} E_i$$

Both the per-residue matrix and the pooled vector are retained; the former supports position-resolved downstream analyses (e.g., epitope or interface prediction), the latter supports whole-peptide similarity search and classification.

**Biological rationale.** These embeddings encode statistical regularities learned from evolutionary sequence data — implicit information about structural propensity, functional motifs, and evolutionary conservation that is not captured by any closed-form physicochemical formula. They are the principal mechanism by which the Physicochemical Service contributes machine-learning-ready features to the Functional Analysis Service's similarity search and classification modules.

---

# 7. Biological Rationale Summary

| Analysis | Biological Question Answered |
|---|---|
| Molecular weight | How large is the molecule, and what does that imply for clearance and handling? |
| pI / net charge | Is the peptide charged at physiological pH, and how will it behave electrostatically? |
| GRAVY / windowed hydrophobicity | Is the peptide broadly hydrophilic or hydrophobic, and where are hydrophobic patches located? |
| Hydrophobic moment | Does the sequence have the amphipathic character associated with membrane activity? |
| Charge distribution | Are charges clustered in a way that suggests membrane or nucleic-acid interaction? |
| Instability index | Is the sequence composition associated with rapid in vitro degradation? |
| Aliphatic index | Is the packing density consistent with thermal robustness? |
| Aromaticity | Is there a risk of aggregation via aromatic stacking, or membrane-anchoring behavior? |
| Boman index | Does the sequence suggest a general propensity for protein–protein interaction? |
| Compositional statistics | Are there structural or proteolytic liabilities implied by residue composition (Cys, Pro, Gly content)? |
| Embeddings | What do learned evolutionary and structural statistics imply about this sequence, beyond hand-crafted descriptors? |

Each analysis exists to answer a specific, falsifiable biophysical question about the isolated molecule — never to speculate about therapeutic suitability, which remains the responsibility of the Decision Layer.

---

# 8. Required External Databases

The Physicochemical Service itself is largely self-contained, since its core descriptors derive purely from primary sequence. External database access — routed exclusively through the Resource Manager, per Architecture Specification Section 4.6 — is used for:

| Resource | Purpose within this Service |
|---|---|
| UniProt | Cross-referencing input sequences against known natural peptides/proteins for provenance annotation and identity confirmation. |
| PeptideAtlas | Confirming whether a computed descriptor profile is consistent with experimentally observed peptides of similar composition. |
| ChEMBL / PubChem | Resolving chemical structures of non-standard residues or small-molecule modifications (e.g., PEG linkers, lipid tails) for descriptor calculation via molecular descriptor tools. |

No external database call is required to compute the core deterministic descriptors (Section 6.1–6.10); these depend only on the sequence and its declared modifications.

---

# 9. Required Computational Models

| Capability | Model Category | Determinism |
|---|---|---|
| Sequence parsing and canonicalization | Rule-based algorithm | Deterministic |
| Descriptor calculation (MW, pI, GRAVY, hydrophobic moment, instability, aliphatic index, aromaticity, Boman index) | Closed-form / lookup-table algorithms | Deterministic |
| Molecular descriptor generation for chemically modified peptides (non-standard residues, linkers) | Cheminformatics descriptor engine | Deterministic |
| Sequence embedding generation | Pretrained protein language model | Stochastic-free at inference (deterministic given fixed model weights and input), but the model itself is a learned statistical artifact |

Per the Architecture Specification's AI Usage Philosophy (Section 1.6), the descriptor-calculation capability belongs to the "Deterministic Algorithms" category, while the embedding-generation capability belongs to the "Scientific Prediction Models" category. This distinction directly informs the confidence framework in Section 10: deterministic outputs carry categorically higher and qualitatively different confidence than model-derived embeddings.

---

# 10. Confidence Estimation Strategy

Confidence within this service is assigned per descriptor group rather than as a single blended score, consistent with the platform-wide principle of transparent, traceable confidence (Architecture Specification, Section 1.5, Principle 3).

## 10.1 Deterministic Descriptors

Deterministic descriptors (Section 6.1–6.10) are assigned a **fixed high-confidence tier** reflecting exact mathematical computation, conditioned only on:

- Completeness of the input sequence (no unresolved ambiguity codes).
- Availability of parameters for any non-standard residues present (a residue lacking a defined mass, pKa, or hydrophobicity value reduces confidence for the affected descriptor only, not the whole evidence object).

Confidence for these descriptors is therefore reported as **exact / reduced / unavailable** rather than a continuous probability, since there is no statistical uncertainty in a correctly computed closed-form value — only uncertainty about whether the necessary reference constants exist for a given residue or modification.

## 10.2 Embedding-Derived Features

Embeddings originate from a pretrained model and therefore carry model-level uncertainty. Confidence here is estimated using:

- **Sequence length appropriateness**: language models trained predominantly on natural proteins may produce less reliable embeddings for very short peptides or heavily modified sequences that fall outside the training distribution.
- **Out-of-distribution flags**: large deviations of the input's compositional statistics from the training distribution of the embedding model (e.g., unusual residue frequency) are flagged as reduced confidence.
- **Model provenance**: the specific model identifier and version are recorded (see Section 14), enabling the Decision Layer to weight embedding-derived downstream evidence consistently with known model benchmarks recorded in the Model Registry.

## 10.3 Aggregate Confidence Field

A summary confidence descriptor accompanies the Evidence Object, but — in accordance with platform-wide transparency requirements — this summary never replaces the descriptor-level confidence breakdown; it is a convenience roll-up for the Decision Layer's evidence integration stage, not a substitute for traceability.

---

# 11. Limitations

- **No structural context.** All descriptors are computed from primary sequence (and declared modifications) alone. Properties that depend on tertiary fold — solvent accessibility of specific residues, buried vs. exposed charge, actual (as opposed to idealized) amphipathic presentation — are not assessed here and are deferred to the Structural Biology Service.
- **Idealized secondary-structure assumptions.** The hydrophobic moment calculation (Section 6.4) assumes a specific periodicity (α-helical or β-strand); if the peptide does not adopt that conformation, the resulting amphipathicity estimate does not reflect the true 3D presentation.
- **Empirical scale dependence.** Hydrophobicity, instability, and Boman index calculations depend on the particular empirical scale or reference dataset chosen; different scales can yield different absolute values, though relative comparisons across candidates remain informative.
- **Coverage of non-standard chemistry.** Non-natural amino acids, exotic linkers, and unusual post-translational modifications may lack established parameters, reducing descriptor completeness (Section 10.1).
- **Embedding domain shift.** Protein language models are trained predominantly on natural, full-length proteins; short peptides, cyclic peptides, or heavily modified sequences represent a domain shift that can degrade embedding quality in ways that are difficult to detect a priori.
- **No experimental validation within this service.** All outputs are computational estimates; none are confirmed against wet-lab measurement within this service's boundary.

These limitations are recorded explicitly in the Evidence Object (Section 14) so that the Decision Layer and downstream services can account for them rather than treating physicochemical evidence as ground truth.

---

# 12. Failure Handling

| Failure Mode | Detection | Handling |
|---|---|---|
| Unparseable or ambiguous sequence | Sequence Validation module cannot canonicalize input | Reject at Stage 1; return a validation failure to the Workflow Orchestrator rather than a partial Evidence Object |
| Unknown / unsupported residue or modification | Descriptor Calculator encounters a residue lacking reference parameters | Compute all unaffected descriptors normally; mark the specific affected descriptor(s) as unavailable with an explicit reason code; do not fail the entire service |
| Embedding model unavailable or times out | Feature Generator receives no response from the model-serving component | Publish the Evidence Object with deterministic descriptors complete and the embedding field explicitly marked unavailable; flag reduced completeness for the Decision Layer |
| Conflicting modification annotations | Sequence Validation detects mutually inconsistent metadata (e.g., a residue marked both cyclized and having a free terminus at the same position) | Reject at Stage 1 with a descriptive validation error; require correction upstream rather than guessing intent |
| Extreme sequence length (very short or unusually long for a "peptide") | Length check during canonicalization | Proceed with computation but attach a confidence caveat, since several descriptors (e.g., instability index, hydrophobic moment) are less reliable at extreme lengths |

The guiding principle, consistent with the Architecture Specification's emphasis on explainability (Section 1.5, Principle 3), is **graceful degradation with explicit annotation** rather than silent approximation: a partially complete, clearly annotated Evidence Object is always preferable to a fully populated but misleadingly confident one.

---

# 13. Performance Considerations

- **Deterministic descriptors are computationally trivial.** Sequence-length-linear algorithms (summations, lookups) execute in well under a second even for unusually long peptides, and impose negligible load on the Job Scheduler.
- **Embedding generation is the dominant cost.** Protein language model inference is the only computationally significant step in this service and may benefit from GPU acceleration; its cost scales with sequence length and model size rather than with the number of descriptors computed.
- **Batch efficiency.** Because embedding models amortize well over batched inputs, the Job Scheduler may elect to batch multiple concurrent peptide evaluations at the Feature Generator stage — a scheduling optimization, not a scientific one, and therefore outside this service's own responsibilities.
- **Caching potential.** Because descriptors and embeddings are deterministic functions of the canonicalized Peptide Object (for a fixed embedding model version), identical inputs against an identical Model Registry state may be cached; this is an infrastructure-layer opportunity rather than a scientific requirement.
- **No external network dependency on the critical path.** Since core descriptors require no database lookups, the service can complete its principal function even under external resource unavailability, degrading gracefully per Section 12 rather than blocking.

---

# 14. Evidence Generated by the Service

The Physicochemical Service publishes a single **Physicochemical Evidence Object** per peptide, conforming to the platform-wide Evidence Object contract described in the Architecture Specification (Sections 3.6 and 6.4). Its structure, expressed schematically:

```text
Physicochemical Evidence Object
├── peptide_object_reference
├── descriptors
│   ├── molecular_weight            { value, confidence: exact|reduced|unavailable }
│   ├── isoelectric_point           { value, confidence }
│   ├── net_charge_by_ph            { profile, confidence }
│   ├── gravy_score                 { value, confidence }
│   ├── hydrophobicity_profile      { windowed_values, window_size, confidence }
│   ├── hydrophobic_moment          { value, assumed_periodicity, confidence }
│   ├── charge_distribution         { profile, confidence }
│   ├── instability_index           { value, classification, confidence }
│   ├── aliphatic_index             { value, confidence }
│   ├── aromaticity                 { value, confidence }
│   ├── boman_index                 { value, confidence }
│   └── compositional_statistics    { aa_frequencies, dipeptide_frequencies, cys_count,
│                                      pro_content, gly_content, confidence }
├── embeddings
│   ├── pooled_vector                { dimension, confidence }
│   └── per_residue_matrix           { dimension, confidence }
├── provenance
│   ├── originating_modules          [ sequence_validation, descriptor_calculator,
│   │                                   feature_generator, evidence_generator ]
│   ├── model_identifier_and_version [ e.g., ESM-2 checkpoint version ]
│   └── reference_parameter_sets     [ hydrophobicity scale, pKa set, mass table versions ]
├── validation_status                { complete | partially_complete | failed }
├── known_limitations                [ Section 11 items applicable to this peptide ]
└── confidence_summary                { deterministic_tier, embedding_tier, aggregate_note }
```

Consistent with the platform-wide requirement that every prediction record sufficient metadata for reproduction (Architecture Specification, Section 1.5, Principle 4), every field records not only its value but the model/algorithm version and parameter set that produced it, enabling exact reproduction given an identical Peptide Object and Model Registry state.

This Evidence Object becomes one of the five inputs to the Platform Evidence Object described in Architecture Specification Section 6.4, and is consumed as feature input by the Structural Biology, Functional Analysis, Developability, and Safety Services.

---

# 15. Future Extensibility

Consistent with the Architecture Specification's extensibility principle (Section 1.5, Principle 5; Section 7.3–7.4), the Physicochemical Service is designed so that new descriptors or embedding models can be introduced without altering the surrounding architecture:

- **New descriptors** (e.g., additional empirical scales, charge-patterning metrics, or descriptors specific to emerging modalities such as stapled or macrocyclic peptides) can be added to the Descriptor Calculator module as new fields within the existing Evidence Object schema, without requiring changes to the service contract, the Evidence Bus, or downstream consumers.
- **New or upgraded embedding models** can replace the current Feature Generator implementation; because the Evidence Object records model identifier and version, downstream services and the Model Registry can track the transition without ambiguity, consistent with the "Current Implementation" replaceability pattern illustrated in Architecture Specification Section 7.4.
- **Support for additional therapeutic modalities** (antibody fragments, cyclic peptides, peptide-drug conjugates, and other future modalities listed in Architecture Specification Section 7.3) is expected to primarily extend the Sequence Validation module's modification-handling vocabulary and the Descriptor Calculator's parameter tables, rather than requiring a new service — preserving the platform's capability-driven rather than modality-driven organization (Architecture Specification, Section 1.4).
- **Multi-scale or ensemble embeddings**: the Feature Generator module may in the future incorporate multiple embedding models (e.g., structure-aware protein language models) and report them as parallel, independently versioned entries within the `embeddings` field, without disrupting existing consumers that rely on the current fields.

These extension points ensure that the Physicochemical Service can absorb scientific advances in sequence-based prediction and cheminformatics without requiring redesign of the Infrastructure Layer, the Evidence Bus, or the Decision & Validation Framework — preserving the technology-independent architecture that Version 3 was designed to establish.
