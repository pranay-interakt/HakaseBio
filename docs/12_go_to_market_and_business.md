# 12 — Go-to-Market & Business

> Evidence: `docs/research/preclinical_lab_os.md` (researched 2026-10-11, 100 sources).
> Grades used there: P = primary (filing, regulator, peer-reviewed), S = secondary, SOFT = weak.
> Items marked **opinion** are reasoning from that evidence, not findings.

## 12.1 The market as evidenced

- **Demand.** CDER received **1,210 commercial INDs** in 2025 (1,139 in 2024; 2019–2025 high
  1,259) [P].
- **Services dwarf software.** The services budget is where the money sits: Charles River
  Discovery & Safety Assessment made **$2.40B** in 2025 [P], and Charles River estimates regulated
  safety assessment is **"60% outsourced or more"** [P, company estimate]. Software is far
  smaller: Certara software $183M, Schrödinger software $200M, Simulations Plus $79M total [P].
  Price against services and headcount, not informatics seats.
- **SEND is a hard mandate.** It applies to repeat-dose, CV/respiratory safety pharmacology, EFD
  and in vivo genotoxicity studies [P]. In March 2026 FDA listed reasons submitted SEND packages
  are "unusable" and required traceability to raw data and to the study report [P].
- **NAMs.** Reduced animal testing currently applies to monoclonal antibodies. FDA states that
  validated alternatives do not yet exist for chronic or developmental toxicity of new chemical
  entities [P].
- **Buyer pain** is documented mainly by a vendor-sponsored 2021 survey: 50% call multiple CRO
  contract negotiations a significant problem [S]. **Customer interviews are required before
  pricing.**

Earlier market figures in `docs/02` (e.g. "AI in drug discovery ~$3.1B") could not be matched
to a current primary source and should not be quoted (research §7.4).

## 12.2 Where HOS fits (opinion)

No company found sells the whole loop: ICH-derived study plan → multi-CRO dispatch → ingestion
and verification → Module 4. The pieces are owned by single-CRO portals (Charles River Apollo),
SEND tooling (Certara Pinnacle 21; Instem, which now owns Pristima), marketplaces (Scientist.com)
and IND writing (Weave Bio).

HOS's defensible difference is that every number is traceable to raw data and a cited method.
That is the property FDA's 2026 SEND guidance now asks for.

## 12.3 Wedge and sequence (opinion, from research §7.2–7.3)

1. **Repeat-dose general toxicology with TK, CRO-neutral.** This is very likely the largest spend
   line. It is in every multi-dose small-molecule IND and is SEND-mandated. HOS today designs
   these studies against OECD TG minimums, validates returned animal data, runs Dunnett
   comparisons and records the Study Director's NOAEL. *Next to build:* TK/NCA analysis and SEND
   generation and verification.
2. **An entry product that needs no CRO cooperation: SEND traceability verification** for studies
   already run, sold per study against an existing services line.
3. **Safety pharmacology** (hERG is built; CV telemetry and respiratory are next).
4. **In vitro ADME, IVIVE and FIH dose.** Built; this is a credibility feature more than a revenue
   line, because ADME services are falling in price.

## 12.4 Buyer and pricing (opinion)

- **Buyer.** A seed-to-Series-B small-molecule biotech, 12–24 months from IND, outsourcing all GLP
  work, on the non-oncology M3(R2) path.
- **Pricing.** Per study or per IND programme, benchmarked against the CRO and SEND-services spend
  it displaces. To be validated in interviews.

## 12.5 Risks (from evidence)

- **CRO data access.** Proprietary portals such as Apollo control it.
- **Part 11 and GLP validation burden** for any system of record (`docs/10` §10.6).
- **AI credibility documentation** for any predicted value used in safety conclusions (FDA
  January 2025 draft).
- **NAMs eventually shifting spend** away from animal toxicology for NCEs.
- **A cash-constrained buyer.** Early-stage share of biopharma venture funding fell in 2025 [S].
- **Licensing.** ChEMBL data are CC BY-SA 3.0.
