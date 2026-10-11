# 02 — Market & Competition

> **Superseded for figures:** the sourced, graded research is `docs/research/preclinical_lab_os.md`
> (2026-10-11). Several numbers below come from secondary aggregation and could not be matched to a
> current primary source (e.g. the ~$3.1B AI-in-drug-discovery figure); do not quote them. The
> evidenced picture is summarised in `docs/12`.

## 2.1 Where the money is

- **Preclinical CRO services**: ~$6.8B, growing ~6–9%/yr (toxicology ~half, bioanalysis/DMPK ~a third).
- **Bioanalytical testing services**: ~$4.6B, ~8%/yr.
- **Lab informatics** (ELN+LIMS+SDMS+CDS): ~$4.1B but only ~4.9%/yr — a slow market.
- **AI in drug discovery**: ~$3.1B, ~30%/yr, no incumbent above ~mid-single-digit share.

**Pricing implication:** price against **services and headcount** (the $6.8B+ pool), not against the
~5% informatics-license pool. The unit of value is a *study delivered cheaper and faster than the
CRO it replaces*, billed against a line item the customer already has.

## 2.2 The buyer

The ideal first customer: a **Series B biotech, ~60–200 people, 2–4 preclinical programs, one
modality, 50–70% of work outsourced.** Enough internal science to have real data pain; not enough to
have a validated-systems committee; one informatics person; 12–24 months from an IND with a CSO
losing sleep over assembling Module 4.

Disqualifiers: a company mid-way through a Benchling validation; a pure in-silico shop with no wet
work; large pharma as a *first* customer (procurement will outlast a startup's runway).

Underrated second buyer: **CROs themselves** — the fastest-growing informatics end-user — on the
other side of the study object.

## 2.3 Competitive map and the open gap

| Player | Slice they own | What they do **not** do |
|--------|----------------|--------------------------|
| Benchling | ELN / registry / inventory | No execution, no CRO orchestration, no GLP tox, no SEND, weak LIMS |
| Dotmatics (Siemens) | Design/analysis roll-up | No wet-lab execution; "digital thread" largely roadmap |
| Schrödinger | In-silico design (LiveDesign) | Stops at the design decision; no bench, no record, no reality check |
| TetraScience | Instrument data harmonization | Explicitly not an ELN; owns no user-facing workflow |
| Instem / Xybion | GLP tox study conduct → SEND | Narrow, legacy; nothing before the tox study; untouched by AI |
| Veeva | Clinical/regulatory (Vault) | **No meaningful preclinical bench offering** |
| Recursion / Lila / Ginkgo | Closed-loop labs | Built for **themselves**; not sold as a product |

**The open gap:** the closed-loop *execution layer* sold as a product; inventory/sample state as a
live constraint; protocol translation + provenance under GxP; the preclinical-to-IND data bridge;
in vivo/vivarium data; and a supported migration path off incumbents. HOS targets this gap.

## 2.4 How we stand out (said plainly)

- **vs. Benchling/Dotmatics:** they sell a filing cabinet to a cash-poor company; we sell a *result*
  against an existing budget line.
- **vs. Schrödinger/AI-discovery:** they stop at the prediction; we own where reality answers back —
  which is also where the proprietary data accrues.
- **vs. CROs:** they sell one study and have no incentive to make the handoff better; we sell the
  program and own the data across CROs.
- **vs. marketplaces (Scientist.com):** they introduce a vendor and leave; we never leave — we run
  the study, hold the data, write the report.

**The durable moat** is not the models (commoditizing) but (1) the **parser/ontology corpus** learned
from every deployment, (2) the **hypothesis→result provenance graph** per customer, (3) **GxP
validation lineage**, and (4) eventually a **cross-program, cross-CRO normalized dataset** no single
pharma can assemble.

## 2.5 Risks (carry these into the plan)

- The preclinical buyer is structurally cash-poor right now; price per-program with a low entry.
- Wet-lab-as-a-service has a graveyard (Strateos, Emerald, Ginkgo's decline) — **we orchestrate, we
  do not run labs.**
- The two most likely acquirers (Siemens, Danaher) are already building adjacent — be fast and own
  the CRO network + parser corpus they cannot easily replicate.
- CRO cooperation for a *shared* study object is unproven — the first wedge (data ingestion) does not
  depend on it (see `docs/11`).
