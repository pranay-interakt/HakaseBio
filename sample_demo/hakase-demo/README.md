# HakaseAI — demonstration workspace

A standalone, backend-free demonstration of the full preclinical cascade: in-vitro
screening → orthogonal confirmation → whole-body exposure projection → virtual animal
study → first-in-human translation.

It exists to answer one question with a client in the room: **what does Hakase actually
show a scientist, and is any of it useful?** So it renders every parameter, endpoint,
band, provenance tag and limitation the production workspace renders — plus several the
production UI does not yet surface — with no server running.

```bash
npm install
npm run dev      # http://localhost:5178
```

---

## What makes this different from a clickable mock

Nothing here is a fixture. The numbers are **computed in the browser from the structure
you type**, by engines that reimplement the shape of the production models:

| Concern | What actually runs |
|---|---|
| Structure | A SMILES parser (organic subset, bracket atoms, aromaticity, ring closures, charges, isotopes), a molecular graph, Tarjan bridge-finding for ring-bond assignment, and a force-directed 2D depiction |
| Descriptors | 20 RDKit-equivalent descriptors: MW, exact mass, Wildman–Crippen-style logP, Ertl TPSA, HBD/HBA, rotatable bonds (amide-aware), ring and aromatic-ring counts, Fsp³, molar refractivity, formal charge, Bickerton **QED** with the published ADS parameters, and five rule filters (Lipinski, Veber, Ghose, Egan, Muegge) |
| Similarity | Morgan radius-2 circular fingerprints folded to 2048 bits, Tanimoto against an approved-drug panel — this is what drives the applicability domain |
| Structural alerts | 14 graph-level PAINS/Brenk detectors (catechol, quinone, nitro, Michael acceptor, azo, rhodanine, epoxide, acyl halide, …) written as real substructure logic, not string matching |
| ADMET | 45 endpoints projected through documented, directionally correct structure–property relationships plus a small deterministic perturbation keyed to the molecule |
| Pharmacokinetics | A **13-compartment perfusion-limited PBPK**: Poulin & Theil tissue partitioning from logP and fu, well-stirred hepatic clearance, glomerular-filtration renal clearance, oral/IV/SC input, repeat dosing, and a log-normally sampled virtual cohort with 5th–95th percentile bands |
| Integration | An exponential (semi-implicit) integrator. Blood and lung have time constants of a second or two against a step measured in minutes; an explicit scheme is unconditionally unstable on that ratio and diverges |
| Translation | FDA (2005) body-surface-area Km conversion, MRSD, receptor-occupancy MABEL, modified-Fibonacci and three other escalation schemes, and a 2,000-trial **3+3 Monte Carlo** for the operating characteristics |

Because the engines are deterministic and seeded from the structure, the same molecule
always produces the same profile and a different molecule produces a genuinely different
one, in the direction a medicinal chemist would expect.

### Verified against reference compounds

| Compound | MW | TPSA | HBD/HBA | Rings | Formula | Alert |
|---|---|---|---|---|---|---|
| Aspirin | 180.16 | 63.6 | 1 / 4 | 1 (1 ar) | C9H8O4 | — |
| Imatinib | 493.62 | 86.28 | 2 / 7 | 5 (4 ar) | C29H31N7O | Aniline |
| Caffeine | 194.19 | 60.26 | 0 / 4 | 2 (2 ar) | C8H10N4O2 | — |
| Quercetin | 302.24 | 131.36 | 5 / 7 | 3 (3 ar) | C15H10O7 | Catechol A |
| Metformin | 129.17 | 88.99 | 5 / 5 | 0 | C4H11N5 | — |
| Nitrofurantoin | 238.16 | 119.48 | 1 / 7 | 2 (1 ar) | C8H6N4O5 | Nitro group |

PBPK sanity checks that hold in the engine:

- Tissue:plasma AUC ratios reproduce the input Kp values to within a few percent, which
  is the textbook result for perfusion-limited distribution at pseudo-equilibrium.
- An IV bolus and a 2-hour infusion of the same dose give the same AUC.
- A 28-day once-daily oral regimen returns an AUC within 4% of `Dose · F / CL`.
- Cardiac output balances: the tabulated flow fractions are normalised so no drug leaks.

---

## What the workspace shows, layer by layer

**Layer 1 · In Vitro** — stage-gate verdict with evidence-graded checks (each tagged
gate-driver / supporting / context, with its evidence type and applicability domain);
2D depiction; 20 descriptors and 5 rule filters; indication and route reading contexts;
45 ADMET endpoints each with unit provenance, screening band, conformal interval,
approved-drug percentile, model performance and per-endpoint domain; a 20-assay extended
bench across 5 groups; target resolution with retrieval-quality payload; read-across
selectivity grouped by activity type; docking with poses and box definition; safety
models; PAINS/Brenk/NIH screen; synthetic feasibility; regulatory precedent from
OpenFDA/PubChem; STRING/KEGG/Reactome; FDA product-specific guidance; manual review.

**Layer 2 · Confirmation** — the ten-stage roster with per-stage readiness and reason,
grouped into handoff / model checks / physical jobs / decision. Druggability, binding and
ADME cross-check, safety triage and Tox21, IVIVE clearance, target engagement, therapeutic
index, and a Stage-9 rollup that counts only what actually ran. Docking and TIES free-energy
refinement are dispatched explicitly, with a per-λ convergence plot. A tissue-context
sub-track over HPA, GTEx and Tabula Sapiens.

**Layer 3 · IVIVE** — concentration–time profile with the population band, clearance
decomposition, bioavailability decomposition (Fa · Fg · Fh), per-compartment exposure,
measured-input overrides that outrank predictions through the whole cascade, an observed-PK
anchor, and the Layer 2 → Layer 3 stage gate separating hard blocks from acknowledgeable
warnings with a named sign-off.

**Layer 3 · Animal Cohort** — guideline conformance and dose-setting *before* the run,
then fourteen deliverable tabs: decision, TA endpoints, protocol and schedule, design and
conformance, welfare and 3Rs (EU 2010/63 severity, humane endpoints, blood-sampling
limits), ICH S3A toxicokinetics, exposure and biodistribution with a target-organ map,
a 15-domain mechanistic toxicology panel, the ICH S7A/S7B battery, FDA (2020) DDI
assessment, points of departure, public evidence, validation evidence, and provenance.

**Layer 4 · First in Human** — the NOAEL/HED route and MABEL derived independently with
the lower governing and the fold divergence shown; itemised FDA (2005) safety factors;
escalation ladder; exposure margins at every dose level; projected human PK with an
allometric cross-check; safety-pharmacology margins; SAD/MAD design with sampling
schedule and stopping rules; 3+3 operating characteristics; sub-study feasibility;
IND/CTA checklist by region; FDA (2023) benefit-risk; clinical precedent.

---

## The scientific discipline the interface keeps

These are enforced in the engines, not just written in copy:

- **No composite score.** Averaging a permeability against a genotoxicity flag has no
  meaning. One flagged gate-driving check can set a verdict on its own.
- **Absence is not evidence.** An organ with no hazard signal is the absence of a flagged
  model output. A registry that returned nothing says something about the public record.
- **Provenance on every number** — measured, predicted, derived or assumed — and a
  measured value the user supplies outranks the prediction through the whole cascade.
- **Applicability decides admissibility.** Outside the training chemistry a value is an
  extrapolation and is labelled as one, per endpoint.
- **Stated limitations.** Transporter uptake, metabolite exposure, saturable metabolism
  and formulation effects are named as absent rather than quietly omitted.
- **A signature never changes a number.** A reviewer can accept residual risk on the
  record; a block records an evidence gap no signature can close.
- **No NOAEL is claimed.** A NOAEL is an observation from a conducted study. The platform
  reports points of departure with their strength and provenance instead.

---

## Layout

```
src/
  lib/          chem.ts · pk.ts · rng.ts · format.ts · catalogs.ts · admetRegistry.ts
  engine/       profile.ts · l1.ts · l2.ts · l3ivive.ts · l3animal.ts · l4.ts · external.ts
  components/   charts.tsx · ui.tsx · Molecule.tsx · ExternalPanel.tsx
  layers/       Landing · Dashboard · L1InVitro · L2Confirmation · L3Ivive · L3Animal · L4Fih
  App.tsx       shell, routing, layer handoff
  styles.css    design system
```

Dependencies: React, Vite, TypeScript, lucide-react. Every chart is hand-written SVG —
donuts, segmented donuts, bar, ranked-bar, line/area, concentration–time with population
band, error-bar, heatmap, radar and sparkline — so there is no charting library to fight
about theming.

---

## Scope

Values are produced by local heuristic engines that reimplement the *shape* of the
production models. They are not the vendored models, they are not validated, and they
must not be used for a real decision. This build exists to evaluate the interface and the
completeness of the scientific surface.
