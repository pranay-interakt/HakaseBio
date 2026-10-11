# 01 — Vision & Thesis

## 1.1 The problem

Bringing a drug from a validated hit to a first-in-human trial — the **preclinical / IND-enabling
stage** — takes roughly 12–18 months for a small molecule (15–24 for a biologic), costs $5–10M, and
is where **~40% of candidate failures occur** (nonclinical toxicology being the single largest cause;
Waring et al., *Nat Rev Drug Discov* 2015, 605-candidate dataset). Pre-human work is ~43% of the
capitalized cost of an approved drug (DiMasi/Tufts) yet is run almost entirely on spreadsheets,
Word protocols exchanged by email, and PDF reports returned by CROs.

The lab bench itself is increasingly commoditized — thousands of CROs with idle capacity. What is
*not* solved, and what nobody sells as a product, is the **execution and reasoning layer** around the
bench: designing each study correctly, orchestrating who runs it, ingesting and analyzing the data
with correct pharmacology, carrying provenance, and assembling the regulatory package.

The companies that built this layer (Recursion, Lila, Ginkgo, Danaher at Abcam) built it **privately,
for themselves**, because they could not buy it. The incumbents that touch adjacent slices
(Benchling = record-keeping; Schrödinger = design; TetraScience = data plumbing; Instem = GLP tox
study conduct) each own one slice, and the slices do not compose.

## 1.2 The thesis

> **Build the operating system for preclinical drug development. A molecule goes in; an IND-ready,
> fully-provenanced data package comes out. The wet-lab biology is executed by other people's labs;
> the OS runs everything around it.**

Three layers:

1. **What we sell — preclinical as an outcome.** A biotech hands us a candidate; they get back the
   designed studies, the analyzed results, and the IND-enabling package. They talk to one system
   instead of managing eight CROs through email.
2. **How we do it — an AI OS with study drivers.** A small **kernel** (study lifecycle, entity graph,
   provenance ledger, attestation boundaries) plus a growing library of **study drivers**. Each
   driver packages one study type completely: protocol template, data parsers, analysis (published
   equations), QC rules, report, and the regulatory slot it fills.
3. **Why it compounds — we own no labs.** We buy lab capacity wholesale and sell outcomes retail.
   Every study run makes its driver better and our data asset deeper. Our cost curve falls; a CRO's
   never does. Over time we hold normalized preclinical data across many programs and many CROs —
   something even big pharma does not have.

## 1.3 Why this is an *operating system*, not a LIMS or an ELN

An ELN records what a scientist says happened, after the fact. A LIMS tracks samples. Neither
*executes* anything. The defining primitive of HOS is the **execution abstraction**: a study step
executes on a **human**, a **robot**, or a **CRO**, behind one interface — and the system designs,
dispatches, ingests, analyzes, and files it. That single abstraction is what makes it an OS:
the "kernel" schedules work onto heterogeneous "devices" (people, instruments, CROs) and the
"drivers" know how to talk to each kind of study. See `docs/03`.

## 1.4 The integrity stance (what makes it fundable *and* real)

The product is only worth anything if its outputs are defensible. Therefore the central engineering
commitment — enforced in the type system, not just in policy — is that **every number carries its
provenance** and the system **cannot fabricate a value**. This is both the scientific stance and the
commercial moat: a system that a toxicologist trusts is worth paying for; one that might be guessing
is worth nothing. See `CLAUDE.md` and `docs/09`.

## 1.5 What we are building first (scope of the initial system)

The initial buildable system (see build plan, `docs/11`) delivers, for **small molecules**:

- **Compound intake & characterization** — real RDKit descriptors + real database enrichment
  (ChEMBL/PubChem) with provenance.
- **Study design** — the OS composes an IND-enabling study plan from encoded ICH/FDA rules,
  parameterized by the molecule and the intended clinical plan.
- **Driver #1: in-vitro metabolic stability (microsomal)** — end to end: protocol → (simulated or
  real) data ingest → IVIVE analysis (Obach well-stirred) → hepatic clearance & extraction ratio →
  report, all provenanced.
- **Driver #2: hERG / cardiac ion-channel safety** — concentration-response (Hill) → IC50 → safety
  margin vs. free Cmax.
- **Dose projection** — HED / MRSD per FDA 2005 with full derivation shown.
- **IND package assembler (Module 4 skeleton)** — pulls each completed study into the nonclinical
  CTD structure with every figure traceable.

Each is a real, correct implementation — not a mock. Later drivers (ADME cascade, GLP tox,
in vivo PK/efficacy, biologics modalities) extend the same kernel and interface (`docs/08`).

## 1.6 North-star metric

**Percentage of a program's required studies that run end-to-end inside the system** — starts near
zero, climbs as the driver library grows. It is reportable to a board, a customer, and ourselves,
and it forces honesty about what is and isn't yet automated.

## 1.7 What we explicitly do NOT build

- We do not run wet labs or own instruments (we orchestrate the customer's/CRO's).
- We do not build generative design models (we integrate the best; design is commoditizing).
- We do not build a chromatography data system, an eCTD publisher, or clinical-trial management.
- We do not replace the four legal human attestations.

See `docs/02` for the market framing of these choices.
