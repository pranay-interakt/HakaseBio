# HakaseAI Decision & Reasoning Framework Specification


> **Status note on versioning:** This document supersedes the prior Decision & Reasoning Framework Specification (doc 05, v1). That version defined a single universal scoring path; this version replaces it with the policy-based, domain-scored architecture below. Per the Domain Model Specification's versioning principles (doc 03, §3.7), the prior version should be marked `Deprecated` rather than deleted, with this document's provenance recording that supersession explicitly.

---

# Chapter 1 — Purpose & Scope

## Purpose

The Decision & Reasoning Framework is the scientific interpretation layer of the HakaseAI Peptide Discovery Platform. It consumes validated, immutable evidence and produces a transparent, explainable recommendation — it never generates scientific predictions itself, and it never modifies the evidence it reasons over.

Version 3.0 replaces a single universal scoring path with a **policy-based architecture**: different therapeutic modalities (antimicrobial peptides, cell-penetrating peptides, targeted binders, hormone peptides, etc.) care about different evidence in different proportions, and forcing all of them through one scoring function was the primary weakness of v1.

## Relationship to Other Specifications

|Specification|Relationship|
|---|---|
|Evidence Framework (04)|Supplies the Platform Evidence Object — the framework's sole scientific input. This document never redefines evidence structure.|
|Domain Model (03)|Defines the canonical objects (Peptide, Target, Evidence, Report) this framework reasons over and produces.|
|Scientific Workflow (02)|Invokes this framework at Stage 7, after Evidence Aggregation and before Report Generation.|
|Scientific Service Specs (07–11)|Produce the Core Domain evidence this framework integrates (five today — see Chapter 5). This framework never recomputes their predictions.|
|REST API / Database Design (13)|Exposes this framework's output via `GET /decision/{job_id}` and persists it in the `Decisions` table.|
|Recommended Engineering Stack (14)|Positions this framework as "Custom Python Rules" — deterministic, not a black-box model.|

## Scope

This specification defines:

- the philosophy governing scientific decision-making;
- the decision architecture (the pipeline from evidence to recommendation);
- the policy mechanism for modality-specific reasoning, including how a policy is resolved and how composite/multi-target cases are handled;
- the policy validation lifecycle required before a policy may be used in production;
- the domain-scoring model, defined over an extensible set of Core Domains rather than a fixed count;
- the variable taxonomy and conflict-resolution rules;
- confidence propagation;
- the Scientific Readiness Score and its relationship to the final decision;
- the GO / Conditional GO / NO-GO decision categories;
- the experimental recommendation engine;
- explainability requirements;
- the Decision Record as the permanent, structured audit artifact of a decision;
- a forward-compatibility statement for future reasoning approaches, including future adaptive policy adjustment.

This specification intentionally excludes:

- the numeric values of any policy's weights or thresholds (these are configuration, versioned independently — see Chapter 4);
- UI/report rendering (see Scientific Workflow §18, Report Generation);
- evidence generation itself (see Scientific Service Specs 07–11).

## Terminology

|Term|Definition|
|---|---|
|**Core Domain**|One of the platform's standing scientific evidence categories (Physicochemical, Structural, Functional, Developability, Safety today — see Chapter 5). The set is extensible; a Policy declares which Core Domains participate in its scoring.|
|**Policy**|A named, versioned configuration object defining which Core Domains participate, and how domains and variables are weighted, for a specific therapeutic modality or use case.|
|**Composite Policy**|A policy composed of multiple target-specific sub-policies, used for multi-target peptides (Chapter 4.3).|
|**Variable**|A single named quantity drawn from an Evidence Object (e.g. `hemolysis_risk`, `docking_score`).|
|**Hard Constraint**|A variable whose value can, on its own, force a NO-GO regardless of every other score.|
|**Soft Evidence**|A variable that contributes proportionally to a domain score but cannot alone force a decision.|
|**Supporting Evidence**|A variable used only to raise or lower confidence in other evidence, never scored directly.|
|**Domain Score**|A single aggregated score for one Core Domain, produced from that domain's normalized soft-evidence variables.|
|**Platform Score**|The policy-weighted combination of Domain Scores across every Core Domain participating in the active policy.|
|**Scientific Readiness**|A measure of evidence completeness, confidence, and consistency — explicitly independent of peptide quality (Chapter 12).|
|**Decision Confidence**|The confidence attached to the GO / Conditional GO / NO-GO recommendation itself, distinct from any individual domain's confidence.|
|**Decision Record**|The permanent, structured audit artifact of a single decision — distinct from the human-readable Decision Report (Chapter 17).|

---

# Chapter 2 — Philosophy

The Decision Engine exists to answer one question honestly: **given what we currently know, and how well we know it, should this peptide move forward?** It does not exist to predict peptide quality — that is the Scientific Services' job. It exists to _reason about_ the evidence those services already produced.

## Core Principles

- **Evidence-driven reasoning.** Every conclusion traces to specific Evidence Objects. No conclusion may originate from the Decision Engine itself.
- **Scientific transparency.** Every score, weight, and threshold applied is inspectable. Nothing is a hidden coefficient.
- **Explainability.** Every recommendation answers _why_, citing the specific evidence, domain scores, and policy that produced it (Chapter 15).
- **Uncertainty preservation.** Confidence and uncertainty are propagated through every stage, never collapsed early into a single number.
- **No hidden AI reasoning.** Domain scoring and policy application are deterministic rule evaluation, not opaque model inference. (An LLM may format the resulting report in prose — per the Recommended Engineering Stack's "LLM Integration: GPT / Claude" — but it never computes the score.)
- **Deterministic decision logic.** Identical inputs under an identical policy version always produce an identical decision.
- **Human-interpretable recommendations.** Every output is written for a scientist deciding whether to run an experiment, not for a downstream algorithm.

---

# Chapter 3 — Decision Architecture

```text
Evidence Objects
      │
      ▼
Platform Evidence Object
      │
      ▼
Decision Policy Selection
      │
      ▼
Evidence Integration
      │
      ▼
Domain Scoring
      │
      ▼
Conflict Resolution
      │
      ▼
Scientific Readiness Assessment
      │
      ▼
GO / Conditional GO / NO-GO
      │
      ▼
Experimental Recommendations
      │
      ▼
Decision Report
```

Each stage consumes only the output of the stage before it. No stage reaches back to re-derive evidence, and no stage may run out of order.

|Stage|Responsibility|Can trigger early exit?|
|---|---|---|
|Decision Policy Selection|Choose the applicable policy (Chapter 4)|No|
|Evidence Integration|Assess completeness, validation status, applicability (Ch. 5)|No|
|Domain Scoring|Compute one score per domain (Ch. 7)|No|
|Conflict Resolution|Detect and record contradictions (Ch. 10)|No|
|Scientific Readiness Assessment|Score evidence quality, independent of peptide quality (Ch. 12)|No|
|GO / Conditional GO / NO-GO|Apply policy thresholds; hard constraints may force NO-GO here|**Yes — hard constraint violation**|
|Experimental Recommendations|Map evidence gaps to studies (Ch. 14)|No|

The final "Decision Report" output in the diagram above is produced in two forms simultaneously: a human-readable report (governed by the Report & Results Specification) and a structured Decision Record — the permanent audit artifact of the decision (Chapter 17). Both originate from the same pipeline run and share the same evidence references; neither is derived from the other.

---

# Chapter 4 — Decision Policies

A single universal scoring system cannot serve every therapeutic modality — an antimicrobial peptide and a targeted binder are evaluated on almost entirely different evidence. Version 3.0 replaces the universal scorer with **independent, versioned Decision Policies**.

## 4.1 Policy Registry (illustrative, not exhaustive)

|Policy|Primary Modality|
|---|---|
|General Discovery Policy|Default, modality not yet declared|
|AMP Policy|Antimicrobial peptides|
|CPP Policy|Cell-penetrating peptides|
|Target Binding Policy|Structure-guided binders|
|Hormone Peptide Policy|Endocrine/signaling peptides|
|Cancer Targeting Policy|Oncology-directed peptides|
|Immunomodulatory Policy|Immune-modulating peptides|
|Gene Delivery Policy|Nucleic-acid-carrier peptides|
|Custom Enterprise Policy|Customer-defined, per Privacy & Data Governance §Chapter 4 (customer owns its scientific configuration)|

New policies are added by creating a new configuration object, never by editing this specification.

## 4.2 Policy Resolution

_(Addition — Chapter 3 names a "Decision Policy Selection" stage but the original outline never defined how a policy is actually chosen. Without this, the platform cannot answer "which policy did it use, and why?")_

Policy Resolution runs once per job, immediately after the Platform Evidence Object is assembled, and follows a fixed priority order. The first matching source wins; lower-priority sources are never consulted once a match is found.

```text
Priority Order

1. User-selected policy (explicit policy_id on the job request)
      │
      ▼
2. Project default policy (configured on the Project object)
      │
      ▼
3. Therapeutic modality inference (declared or predicted modality
   matched against a policy's applicable_modalities)
      │
      ▼
4. Enterprise policy (tenant-level default, per Privacy & Data
   Governance's tenant isolation model)
      │
      ▼
5. General Discovery Policy (final fallback — always resolves)
```

The resolved `policy_id` (and the priority level at which it was resolved) is recorded verbatim in the Decision Record (Chapter 17) and in the Decision Report's explainability section (Chapter 15) — "which policy, and why it was chosen" is treated as a first-class part of every explanation, not an implementation detail.

## 4.3 Composite Policies (Multi-Target Peptides)

_(Addition — the architecture as drafted implicitly assumed one peptide, one target. Bispecific peptides, dual-receptor agonists, and multi-target CPPs need a defined home even if not implemented immediately.)_

A **Composite Policy** does not introduce new scoring math — it composes existing, ordinary Policy Objects (Chapter 4.5) as sub-policies, one per target, and defines how their outcomes integrate:

```text
Composite Policy
      │
      ▼
Target-Specific Sub-Policies
 (one ordinary Policy Object per target, each independently
  producing its own Platform Score, Readiness, and Decision)
      │
      ▼
Integrated Decision
 (defined per Composite Policy: e.g. "all sub-decisions must be
  GO", "worst sub-decision wins", or a weighted combination —
  the integration rule is itself policy configuration, not new
  specification math)
```

A Composite Policy's `hard_constraints` still apply platform-wide — a hard constraint triggered against _any_ target forces an overall NO-GO, consistent with Chapter 6. This chapter defines the architectural slot; it does not mandate that multi-target support ships immediately.

## 4.4 Policy Validation

_(Addition — necessary the moment a Custom Enterprise Policy or any new modality policy can be authored. Without this, there is no defined answer to "how do we know this policy is scientifically valid?")_

A Policy Object may not be used in production decisions until it has:

- a declared **benchmark dataset** it was evaluated against;
- recorded **validation metrics** from that evaluation;
- an explicit **approval status** (`draft`, `under_review`, `approved`, `deprecated`);
- a named **scientific owner** accountable for its thresholds and weights;
- a **review date**, after which the policy must be re-validated or explicitly re-approved;
- a written **scientific justification** for its domain weights and hard constraints (a short rationale, not a numeric derivation).

This mirrors the same validation-status discipline the platform already applies to evidence itself (Evidence Framework §10) — a policy is, in effect, a piece of scientific configuration, and should not be exempt from the platform's own evidentiary standards just because it lives in config rather than in an Evidence Object.

## 4.5 Policy Object — Formal Schema

This is the structural improvement over the original outline: rather than each modality being described in free-form prose (which does not scale — see Chapter 8), every policy is an instance of one fixed schema.

```yaml
policy_id: string                     # unique, versioned, e.g. "amp-policy-v1.2.0"
display_name: string
applicable_modalities: [string]       # e.g. ["antimicrobial"]
schema_version: string                # semantic version, per Evidence Framework §11
policy_type: "standard" | "composite" # composite -- see Chapter 4.3
sub_policy_ids: [string] | null       # populated only when policy_type == "composite"

participating_domains: [string]       # e.g. ["physicochemical", "structural", "functional",
                                       #       "developability", "safety"] -- an open list,
                                       # not a fixed five; see Chapter 5 (Core Domains)

domain_weights:                       # keyed by domain name; keys MUST be a subset of
                                       # participating_domains; values MUST sum to 1.0
                                       # -- see Chapter 9
  <domain_name>: float

variable_overrides:                   # optional per-variable weight/threshold overrides
  - variable: string
    domain: string
    weight_within_domain: float
    classification: "hard_constraint" | "soft_evidence" | "supporting_evidence"

hard_constraints:                     # policy-specific hard constraint thresholds
  - variable: string
    condition: string                 # e.g. "hemolysis_risk > 0.75"
    action: "force_no_go"

decision_thresholds:
  go_minimum_platform_score: float
  go_minimum_confidence: float
  conditional_go_minimum_platform_score: float
  no_go_maximum_platform_score: float

# --- Governance metadata (Chapter 4.4 -- required before production use) ---
approval_status: "draft" | "under_review" | "approved" | "deprecated"
scientific_owner: string              # named individual or role, accountable for this policy
validation_dataset: string            # reference to the benchmark dataset used
benchmark_results: object             # recorded validation metrics from that benchmark
review_date: date                     # next mandatory re-validation date
last_modified: datetime

owner: string                         # team or customer responsible for sign-off
effective_date: date
superseded_policy_id: string | null
```

Every field above is configuration data, not specification prose. This specification defines the schema; it does not enumerate numeric values.

---

# Chapter 5 — Core Domains

_(Retitled from "Scientific Domains" — the original framing assumed the five domains below are permanent. They are sufficient today, but the platform will plausibly add PK/PD prediction, pharmacokinetics, tissue distribution, cell uptake, biodistribution, AAV tropism, or CRISPR delivery domains later. Renaming this to "Core Domains" and stating the extensibility rule explicitly avoids a future rename of this entire specification.)_

Reasoning happens over a defined set of Core Domains, not hundreds of individual variables. Each Core Domain corresponds to exactly one Scientific Service. **Policies define which Core Domains participate in their scoring** (via `participating_domains`, Chapter 4.5) — a policy is never required to use every Core Domain the platform supports, and the platform is never required to stop at five.

## Core Domains (current)

|Domain|Source Service|
|---|---|
|Physicochemical|Physicochemical Service (07)|
|Structural|Structural Biology Service (08)|
|Functional|Functional Analysis Service (09)|
|Developability|Developability Service (10)|
|Safety|Safety Service (11)|

## Adding a New Core Domain

A new Core Domain is added by: standing up its Scientific Service (per the Domain Model's Scientific Service lifecycle, doc 03 §5.3), defining its Evidence Object (per the Evidence Framework), and adding one row to the table above — existing policies are unaffected until they explicitly add the new domain to their own `participating_domains`. No policy is forced to adopt a new domain, and no existing decision is invalidated by a domain being added elsewhere in the platform.

Every Core Domain produces exactly the same five-part output, regardless of which service or policy is involved:

```text
Domain
 ├── Domain Score          (Chapter 7)
 ├── Domain Confidence      (Chapter 11)
 ├── Domain Uncertainty      (from Evidence Framework §8)
 ├── Applicability            (from Evidence Framework §9)
 └── Domain Limitations        (from the originating Evidence Object)
```

This uniform shape is what allows Chapter 9's weighting math to treat every participating domain identically, even though the underlying science is unrelated — and is exactly what makes the Core Domain set extensible without changing the scoring architecture itself.

---

# Chapter 6 — Variable Taxonomy

Every variable drawn from an Evidence Object is classified into exactly one of three classes. Classification is set **per policy** (a variable may be a hard constraint under one policy and soft evidence under another — see the `variable_overrides` field in Chapter 4.5).

## Hard Constraints

Can, alone, force a NO-GO — regardless of every other score.

Examples: severe hemolysis risk, confirmed high general toxicity, known unsafe chemistry (e.g. a flagged reactive motif).

## Soft Evidence

Contributes proportionally to its domain's score. Cannot alone force a decision.

Examples: docking score, solubility estimate, binding confidence.

## Supporting Evidence

Never scored directly. Used only to raise or lower confidence in other evidence.

Examples: sequence similarity to known actives, embedding-based homology, evolutionary conservation.

## Hard Constraint Override Protocol

_(Addition — the original outline did not specify whether a hard constraint's NO-GO can ever be revisited.)_

A hard-constraint-triggered NO-GO is final **within the automated pipeline**. It may only be revisited through an explicit, audited human override, which:

- must be recorded as its own event (who, when, rationale) in the Audit Log (Database Design Spec §11);
- never modifies the original Evidence Object or the original Decision Report — it produces a new, linked Decision Report, consistent with the platform's immutability principle (Domain Model §3.4);
- does not change the underlying hard constraint threshold for future peptides (that requires a policy version change, per Chapter 4).

This keeps the "computational recommendations guide but never replace experimental validation" principle (original v1 spec, §2) intact even in the presence of hard, automatic vetoes.

---

# Chapter 7 — Domain Scoring

Each domain computes its score from its own soft evidence variables only (hard constraints are evaluated separately, per Chapter 6; supporting evidence only adjusts confidence, per Chapter 11).

```text
Physicochemical Domain
      │
  Charge, Hydrophobicity, pI, Instability  (soft evidence variables)
      │
      ▼
Physicochemical Domain Score

Structural Domain
      │
  Fold confidence, Docking score, Binding interface quality
      │
      ▼
Structural Domain Score

Functional Domain
      │
  Activity prediction, Target engagement, Consistency
      │
      ▼
Functional Domain Score

Developability Domain
      │
  Stability, Aggregation risk, Manufacturability, Solubility
      │
      ▼
Developability Domain Score

Safety Domain
      │
  Immunogenicity, Toxicity, Off-target risk (soft-evidence tier only --
  see Chapter 6 for the hard-constraint tier of these same variables)
      │
      ▼
Safety Domain Score
```

Every Domain Score is accompanied by its own confidence and uncertainty (Chapter 5) and is never blended with another domain's score except through the explicit, policy-defined weighting in Chapter 9.

---

# Chapter 8 — Modality Policies

_(This is the chapter you flagged as a scaling risk. The fix: treat this chapter as a small number of worked examples of the Chapter 4 schema, not as the place where every modality's full configuration lives. The authoritative values live in a policy registry / config store, versioned independently of this document.)_

## Illustrative Policy Priorities

|Modality|High Priority Domains|Medium Priority|Lower Priority|
|---|---|---|---|
|Antimicrobial Peptides|Functional, Safety|Developability|Structural|
|Cell-Penetrating Peptides|Physicochemical (charge, amphipathicity)|Functional|Safety|
|Targeted Binding Peptides|Structural, Functional (docking, interface)|Safety|Physicochemical|
|Hormonal Peptides|Functional, Developability (stability)|Safety|Structural|

Each row above is a _summary_ of an underlying Policy Object (Chapter 4.5) — it is not itself a source of truth. When a new modality is needed, the correct action is: **author a new Policy Object against the Chapter 4.5 schema**, submit it for scientific sign-off through Policy Validation (Chapter 4.4, see the `scientific_owner` field), and add one summary row here. This keeps the specification bounded regardless of how many modalities the platform eventually supports.

---

# Chapter 9 — Domain Normalization & Evidence Weighting

The weighting pipeline stays intentionally abstract, per the original design intent — actual numeric weights are a scientific-policy decision, not a specification decision, and are owned by the `scientific_owner` field of each Policy Object (Chapter 4.5). This chapter deliberately describes **weighted aggregation** as a principle throughout, and deliberately avoids writing down any actual combination equation — real coefficients will change as policies are benchmarked against real datasets (Chapter 4.4), and a specification that hard-codes today's numbers would not survive that recalibration.

## Domain Normalization

_(Addition — a necessary principle the original outline didn't state. A docking score and a charge value are different quantities on different scales; they cannot be weighted together until they're expressed on a common footing.)_

Every variable is normalized onto a common, unitless scale **before** any weighting is applied. No specific normalization formula is mandated here — the appropriate transform differs by variable type (e.g. a bounded biological score vs. an open-ended physicochemical measurement), and choosing one is an implementation detail, not an architectural one. What this specification requires is the principle: **weighting is only ever applied to normalized variables**, never to raw, differently-scaled values. This normalization step is what makes "combining a docking score with a charge value" a coherent operation at all.

## Weighting Pipeline

```text
Variable
   │  (normalized onto a common scale — see above)
   ▼
Normalized Variable
   │  (variable weight, WITHIN its domain)
   ▼
Weighted Variable Score
   │  (aggregated across a domain's soft-evidence variables)
   ▼
Domain Score
   │  (domain weight, from the active Policy's domain_weights)
   ▼
Weighted Domain Score
   │  (aggregated across every participating Core Domain, Chapter 5)
   ▼
Platform Score
```

Every arrow above represents a **weighted aggregation** step. This specification intentionally stops there — it does not, and should not, specify the aggregation function itself (sum, weighted mean, or otherwise). That function is scientific-policy configuration, recorded and versioned inside each Policy Object, never inside this document.

## Normalization & Weighting Rules

- Every variable is normalized before it is weighted (see above).
- Within a single Policy Object, `domain_weights` **must sum to 1.0** across that policy's `participating_domains` (Chapter 4.5, Chapter 5). This is a structural validation rule enforced at policy load time, not a per-decision computation.
- Variable weights are scoped to **one domain only** — a variable's weight never competes directly against a variable in a different domain. Only domain-level weights cross domain boundaries.
- Weights are **policy-scoped, not global** — the same variable may carry a different weight under the AMP Policy than under the Target Binding Policy (Chapter 4.5, `variable_overrides`).
- The combination function itself, once defined for a real policy, must be recorded in that Policy Object's own version history and benchmark results (Chapter 4.4) — never in this specification.

---

# Chapter 10 — Conflict Resolution

Conflicts are detected **between domains**, after Domain Scoring (Chapter 7) and before Scientific Readiness Assessment (Chapter 12).

## Conflict Detection

|Conflict Pattern|Example|
|---|---|
|Structural excellent, Functional poor|High-confidence fold prediction, but no predicted activity|
|Safety excellent, Functional conflicting|No safety liabilities, but functional predictions disagree internally (per Functional Evidence's own `consistency_assessment`)|
|Developability poor, Functional excellent|Strong predicted activity undermined by aggregation risk|
|Any domain flagged `extrapolation_flag=true` (Evidence Framework §9)|Prediction outside the validated applicability domain|

## Conflict Severity

|Severity|Effect|
|---|---|
|Minor|Recorded in the Decision Report; no score penalty|
|Moderate|Applies a confidence penalty to Decision Confidence (Chapter 11)|
|Critical|Prevents a GO recommendation regardless of Platform Score; caps the outcome at Conditional GO or forces NO-GO per the active policy's `decision_thresholds`|

## Escalation Rules

Unresolved **critical** conflicts always escalate to a recommendation for additional experimental validation (Chapter 14) rather than being silently absorbed into the Platform Score. This preserves the v1 principle that "contradictory evidence is reported rather than hidden."

---

# Chapter 11 — Confidence Propagation

Confidence propagates independently of prediction values, through the same domain structure used for scoring (Chapter 5, Chapter 7).

```text
Variable Confidence
      │  (combined across a domain's variables)
      ▼
Domain Confidence
      │  (combined across every participating Core Domain,
      │   policy-weighted the same way as Platform Score)
      ▼
Platform Confidence
      │  (adjusted downward by any Moderate/Critical conflicts, Ch. 10)
      ▼
Decision Confidence
```

Decision Confidence is reported alongside — never merged into — the Platform Score. A high Platform Score with low Decision Confidence is a valid, meaningful state (it typically resolves to Conditional GO; see Chapter 13).

Supporting Evidence (Chapter 6) enters here, and only here: it may raise or lower a Variable Confidence value, but it never contributes to a Domain Score.

---

# Chapter 12 — Scientific Readiness Score

This is the most important conceptual correction in this framework, and the original outline's instinct here was exactly right: **Scientific Readiness does not measure peptide quality.**

Scientific Readiness measures the _evidence itself_:

- Evidence Completeness — how many of the expected Evidence Objects are present (see Decision & Reasoning Framework v1 §8, Missing Evidence Handling, which this framework retains unchanged);
- Confidence Calibration — whether reported confidence values are internally consistent with their stated tiers;
- Applicability — whether predictions fall inside their validated domains;
- Consistency — agreement between independent evidence sources (Ch. 10);
- Coverage — breadth of assays/predictions actually attempted;
- Validation — validation_status distribution across all evidence (Evidence Framework §10).

## Readiness Is Orthogonal to Decision

||High Readiness|Low Readiness|
|---|---|---|
|**Favorable evidence**|GO — evidence is both strong and trustworthy|Conditional GO — evidence looks favorable but isn't complete/trustworthy enough to act on yet|
|**Unfavorable evidence**|NO-GO — evidence is trustworthy and it says no|Conditional GO — evidence looks unfavorable, but too incomplete to be a confident NO-GO|

A peptide can score 98% Readiness and still receive NO-GO — this is not a contradiction, it means the evidence was complete, well-calibrated, consistent, and it clearly did not support advancement. Readiness answers "can we trust what we found?"; the Decision (Chapter 13) answers "what did we find?" These are always reported as two separate numbers, never collapsed into one.

---

# Chapter 13 — GO / Conditional GO / NO-GO

## GO

Requires, per the active policy's `decision_thresholds`:

- Platform Score at or above `go_minimum_platform_score`;
- Decision Confidence at or above `go_minimum_confidence`;
- no unresolved Critical conflicts (Chapter 10);
- no triggered Hard Constraints (Chapter 6).

## Conditional GO

Applies when evidence is scientifically promising but incomplete, or Scientific Readiness is too low to support a confident GO or NO-GO (Chapter 12), or an unresolved Moderate conflict exists.

## NO-GO

Applies when:

- any Hard Constraint is triggered (immediate, regardless of Platform Score — see Chapter 6's Override Protocol for the only path back);
- Platform Score falls at or below `no_go_maximum_platform_score`;
- an unresolved Critical conflict caps the outcome here per policy.

A NO-GO applies only to the current evidence under the current policy version. Sequence optimization, new evidence, or a policy update may result in a different outcome on reassessment — it is never a permanent verdict on the peptide itself.

---

# Chapter 14 — Experimental Recommendation Engine

Recommendations are generated from **specific evidence gaps**, not from a generic checklist. This is formalized as a registry, mirroring the structured, non-prose approach used for Policies (Chapter 4).

## Evidence Gap → Study Registry (illustrative)

|Evidence Gap|Recommended Study|
|---|---|
|Low docking confidence / no complex prediction|SPR (surface plasmon resonance) binding assay|
|Low structural confidence on an isolated fold|Cryo-EM or NMR structural validation|
|Low functional confidence / weak activity prediction|Cell-based functional assay|
|High aggregation risk flagged|Analytical SEC / DLS stability study|
|Elevated hemolysis risk (below hard-constraint threshold)|In vitro hemolysis assay|
|Elevated immunogenicity risk|In vitro T-cell epitope validation|
|Any domain with `extrapolation_flag=true`|Domain-appropriate experimental confirmation, prioritized by that domain's weight in the active policy|

Recommendations are ranked by **expected uncertainty reduction**: gaps contributing most to low Decision Confidence (Chapter 11) or low Scientific Readiness (Chapter 12) are surfaced first.

---

# Chapter 15 — Explainability

Every recommendation must answer, in order:

1. **Why** — which Platform Score / Hard Constraint / Readiness threshold produced this outcome;
2. **What evidence** — the specific Evidence Object IDs consulted;
3. **Which models** — the model identifiers and versions behind that evidence (per each Evidence Object's own provenance, Evidence Framework §6);
4. **Which limitations** — `known_limitations` carried over from the originating Evidence Objects;
5. **What uncertainty** — the Decision Confidence and its contributing Domain Confidences (Chapter 11).

A Decision Report that cannot answer all five is incomplete, regardless of whether it reached a GO, Conditional GO, or NO-GO.

---

# Chapter 16 — Future Learning

Future versions may incorporate:

- Bayesian evidence integration;
- probabilistic graphical models;
- multi-objective optimization across policies;
- reinforcement-learning-driven experiment prioritization;
- expert-system-style rule augmentation.

These extend the architecture in Chapter 3 — they do not replace it. Any future reasoning approach must still: consume the Platform Evidence Object as its sole input, operate through the Policy mechanism (Chapter 4), preserve the Domain/Variable taxonomy (Chapters 5–6), and remain fully explainable (Chapter 15). A future reasoning engine that cannot produce a Chapter-15-compliant explanation is out of scope for this platform, however accurate it may be.

## 16.1 Adaptive Policy Adjustment (Future)

_(Addition — a future chapter, deliberately scoped as configuration, not machine learning.)_

A future capability may allow a Policy's thresholds to adjust based on context, without introducing adaptive/learned behavior into the Decision Engine itself:

```text
Policy
      │
      ▼
Patient Population
      │
      ▼
Organism
      │
      ▼
Target Family
      │
      ▼
Adjusted Thresholds
```

Each step is a **configurable rule lookup** (e.g. "for organism = X, apply threshold override set Y"), authored and version-controlled the same way a Policy Object itself is (Chapter 4.5), and subject to the same Policy Validation lifecycle (Chapter 4.4). This is explicitly not reinforcement learning or online adaptation — the architecture in Chapter 3 does not change, and every adjustment remains as inspectable and explainable (Chapter 15) as a base policy's thresholds.

---

# Chapter 17 — Decision Record

_(Addition — the one missing architectural object. The platform already defines an Evidence Object, a Platform Evidence Object, and a Decision Report; nothing before this chapter defined the permanent, structured audit artifact of the decision itself, as distinct from its human- readable presentation.)_

The **Decision Report** (produced at the end of the pipeline in Chapter 3) is the human-readable presentation of a decision, governed downstream by the Report & Results Specification. The **Decision Record** is its structured counterpart: the permanent audit artifact that makes a decision reconstructible and queryable independent of any report rendering.

## Decision Record — Fields

```text
Decision Record

 decision_id
 policy_id                  (as resolved by Chapter 4.2, with priority level)
 platform_score
 scientific_readiness
 decision                   (GO / Conditional GO / NO-GO)
 decision_thresholds_applied
 hard_constraints_triggered
 conflict_summary           (from Chapter 10)
 confidence_summary         (Decision Confidence, from Chapter 11)
 timestamp
 evidence_references         (every Evidence Object ID consulted)
 report_id                  (the Decision Report this record accompanies)
```

## Properties

- **Immutable.** Like every Evidence Object (Evidence Framework §3), a Decision Record is never edited after creation. A hard-constraint override (Chapter 6) or a re-run under a new policy version produces a new, linked Decision Record — never a modification of the original.
- **Independent of report rendering.** The Decision Record must remain complete and correct even if the Decision Report's presentation format changes (per the Report & Results Specification). Report templates change; Decision Records do not.
- **The unit of reproducibility.** Reproducing a past decision (Evidence Framework §19) means re-deriving the same Decision Record from the same Platform Evidence Object under the same policy version — not re-rendering the same report.
- **Persisted per the Database Design Specification's `Decisions` table** (doc 13), which stores the Decision Record's fields directly; the Decision Report itself is stored as a separate artifact referenced by `report_id`.

---

# Chapter 18 — Relationship to the Prior Version

_(Addition — not in the original outline, but necessary given the repo already contains a v1 of this document.)_

This document (v3.0) replaces the single-policy scoring path of the prior Decision & Reasoning Framework Specification with the policy-based architecture defined above. Specifically:

|v1 Concept|v3.0 Treatment|
|---|---|
|Single universal evidence weighting (v1 §9)|Replaced by per-policy `domain_weights` and `variable_overrides` (Chapter 4, 9)|
|Undifferentiated evidence weighting (v1 §9)|Replaced by the three-class Variable Taxonomy (Chapter 6)|
|Missing Evidence Handling (v1 §8)|Retained unchanged; still governs Evidence Integration (Chapter 3)|
|Decision Policies (v1 §10, GO/Conditional GO/NO-GO definitions)|Retained conceptually, now parameterized per policy (Chapter 13)|
|Explainability (v1 §12)|Retained and extended into the five-question format (Chapter 15)|

The prior document should be marked `Deprecated` (Evidence Framework §10 validation-status vocabulary applies equally well to spec documents themselves) rather than deleted, so that any Decision Report generated under v1 policy logic remains traceable to the specification version that produced it — consistent with the platform's own reproducibility requirements (Evidence Framework §19).
