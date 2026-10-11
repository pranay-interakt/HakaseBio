# Preclinical Lab OS: Market, Demand, Competition and Regulatory Research Brief

- **Prepared for:** Hakase OS (IND-enabling nonclinical orchestration; does not run labs)
- **Research date:** 2026-10-11 (all sources accessed 2026-10-11)
- **Scope:** small-molecule IND-enabling nonclinical work first; other modalities noted where relevant
- **Status:** research input to `docs/02_market_and_competition.md`. This brief does not change product docs.

---

## 0. How to read this document

### 0.1 Quality grades (applied to every figure)

| Grade | Meaning |
|---|---|
| **P** | Primary. Regulator or legislature (FDA, Congress, ICH, eCFR), company statutory filing or earnings release (SEC 8-K/10-K/10-Q, HKEX), or peer-reviewed paper. |
| **P-co** | Company's own announcement or product page about its own product. Primary for *what it sells*; any performance or adoption claim in it is unverified. |
| **S** | Secondary. Market-research press releases, trade press, news, law-firm or advocacy summaries, data aggregators, vendor blogs about the market. |
| **SOFT** | Added to any grade where sources conflict, the method is unknown, the number comes from a third-party estimate (not disclosed by the company), or I could only read it through a search-engine excerpt rather than the document itself. |

Inline references look like `[12]` and map to the numbered source list in Section 8 (publisher, date, URL).

### 0.2 Method and limitations

- Web search plus direct reading of primary documents. FDA PDFs (IND receipts 2016 to 2025, ICH M3(R2), the October 2026 Study Data Technical Conformance Guide, the January 2025 AI draft guidance, the April 2026 Year One NAMs report) and Paul et al. 2010 were read as extracted text, not from summaries.
- Several investor-relations pages returned HTTP 403 (Labcorp IR, eCFR). For those, figures come from search-engine excerpts of the primary document and are tagged **SOFT**.
- Market-research figures are summarized from press releases only. Full reports are paywalled and their methods are not visible. Treat them as order-of-magnitude at best.
- "Not found" means I searched and could not find a credible source. It does not mean the number does not exist.

---

## 1. Executive summary (decision-relevant)

1. **Demand is real and recovering, not booming.** CDER received **1,210 commercial** drug and non-biosimilar biologic INDs in calendar 2025, up from 1,139 in 2024 and 777 in 2016. The peak was 1,259 in 2021 (**P** [58]). Charles River's DSA segment fell 2.0% in 2025 (organic -2.6%) to $2.40B (**P** [1]). By Q2 2026 it was organically flat (+0.2%) and posting its "highest net book-to-bill in nearly four years" (**P** [2]).
2. **The money is in regulated safety assessment, and it is already outsourced.** Charles River's own filing says the regulated safety assessment market "is 60% outsourced or more" (**P**, company estimate [3]). Charles River DSA alone is about $2.4B. Secondary "preclinical CRO market" estimates cluster around $6.8B for 2025 (**S/SOFT** [91]).
3. **Software pools are small compared with services.** Certara's FY2025 software revenue was $183M (**P** [17]), Simulations Plus's FY2025 total was $79M (**P** [24]) and Schrödinger's software revenue was $200M (**P** [27]). Dotmatics was expected to exceed $300M in revenue (**P** [29]). Benchling's ~$210M ARR is a third-party estimate (**SOFT** [38]). This supports pricing against services budgets, not informatics budgets.
4. **SEND is a hard, expanding mandate and FDA says submitted packages are often unusable.** CDER requires SEND for single-dose, repeat-dose and carcinogenicity studies (commercial INDs, studies starting after 2017-12-17), cardiovascular and respiratory safety pharmacology (2020-03-15), embryo-fetal development (2024-03-15) and in vivo micronucleus/comet genetox (2025-03-15) (**P** [80]). In March 2026 FDA added Appendix I to the Technical Conformance Guide. It lists common reasons SEND arrives "unusable" and requires traceability to raw data and to the study report (**P** [80]). This lines up directly with a provenance-first product.
5. **The NAMs policy shift is real but has not yet reached small molecules.** FDA's April 2025 roadmap, the December 2025 mAb draft guidance, the March 2026 general NAMs draft guidance and the April 2026 Year One report are all **P** [72]–[77]. Reduced-testing rules so far apply to monoclonal antibodies. FDA says it "will extend" them to new chemical entities, and it states that validated alternatives do not yet exist for chronic or developmental toxicity (**P** [77]). FDA Modernization Act 3.0 passed the Senate in December 2025 and the House in July 2026. It was **not enacted** as of the latest status I found (**P/S** [79]).
6. **FDA's AI draft guidance (January 2025) is still a draft.** It covers AI that produces nonclinical data for safety decisions. It explicitly excludes drug discovery and "operational efficiencies" such as drafting a submission, *unless* they affect the reliability of nonclinical results (**P** [83]). Hakase's analysis layer is in scope. Its drafting layer is out of scope only if it cannot change results.
7. **No company found sells the full loop** (ICH-derived study plan, then multi-CRO dispatch, then ingestion and SEND verification, then Module 4). Each piece has an owner: CROs and their single-CRO portals (Charles River Apollo), SEND tools and services (Certara Pinnacle 21, Instem, which now owns Xybion Pristima), procurement marketplaces (Scientist.com, now owned by GHO Capital), and IND writing (Weave Bio AutoIND, $36M raised). Most AI-native entrants work upstream on ADMET prediction or toxicity models (Inductive, Axiom, Schrödinger predictive tox) or build their own labs (Lila, Medra) (**P-co/S** Section 3).
8. **The best-documented cost anchor for preclinical development is old.** Paul et al. 2010 (peer-reviewed) gives the preclinical phase (candidate to first-in-human) as **$5M per asset, 1.0 year, 69% success** in large-pharma benchmark data (**P** [65]). Current per-study price points ($300–500K for a 28-day rat study, $500–900K for a 28-day dog study, $2–7M per small-molecule package, 12–18 months) come only from non-peer-reviewed web guides (**SOFT** [68]). FDA puts non-human primate cost at **~$50,000 per animal** and says a typical mAb program uses more than 100 NHPs (**P** [74]).
9. **Buyer pain is documented but thinly.** The best survey is vendor-sponsored (Altasciences/Biopharma Dive, October 2021, n=143). In it, 50% of executives called multiple contract negotiations a significant problem, 45% named tight deadlines, 36% technology transfer and 25% inadequate capacity (**S** [87]). No credible public figure exists for the number of CROs used per IND program (**not found**).
10. **Inference (opinion):** the strongest first driver is **repeat-dose general toxicology (rodent + non-rodent) with toxicokinetics (TK), SEND verification and traceability**. It is in every multi-dose small-molecule first-in-human IND (ICH M3(R2)), carries the largest share of spend, is SEND-mandated, and is where FDA's 2026 traceability expectations land. In vitro ADME/DMPK is scientifically essential but is commoditizing on price (Ginkgo, Inductive) (Section 6).

---

## 2. Market sizing

### 2.1 Bottom-up anchors from company filings (preferred)

| Company / segment | Period | Revenue | Change | Grade | Src |
|---|---|---|---|---|---|
| **Charles River, DSA (Discovery & Safety Assessment)** | FY2025 | **$2,402.9M** | -2.0% reported; -2.6% organic | P | [1] |
| Charles River, total | FY2025 | $4,015.4M | -0.9% | P | [1] |
| Charles River, DSA | Q2 2026 (rel. 2026-08-05) | $606.5M | -1.9% reported; +0.2% organic, "driven primarily by higher study volume for regulated safety assessment services" | P | [2] |
| Charles River, DSA backlog | 2025-12-27 vs 2024-12-28 | ~$1.9B vs ~$2.0B | down | P | [3] |
| Charles River, DSA Q2 2026 net book-to-bill / backlog | Q2 2026 | 1.19x; $1.97B | "highest net book-to-bill in nearly four years" (8-K gives no number) | S/SOFT (number); P (qualitative) | [4], [2] |
| Charles River, 2026 guidance (updated Aug 2026) | FY2026 | organic 0.0% to +1.0%; reported -3.5% to -2.5% | raised from (1.5)% to (0.5)% organic | P | [2] |
| Charles River, NAMs-related revenue | ~2025 | "approximately $200 million in annual DSA revenues" | n/a | S/SOFT (analyst report, not a company disclosure) | [6] |
| Charles River, AMAP (alternatives to animal testing) investment | announced Apr 2024 | $500M total ($200M spent over prior 4 years + $300M over next 5) | n/a | P-co | [5] |
| **Inotiv, DSA** | FY2025 (FYE 2025-09-30) | **$187.9M** | +4.3% | P | [9] |
| Inotiv, RMS (research models) | FY2025 | $325.1M | +4.7% | P | [9] |
| Inotiv, DSA backlog | 2025-09-30 | $138.2M (vs $129.9M) | up | P | [9] |
| **Labcorp, Biopharma Laboratory Services** (Central Labs + Early Development) | FY2025 | ~$3.10B | +6.0% | S/SOFT (trade press reading of release) | [12] |
| Labcorp, **Early Development** (its preclinical business) | FY2025 | **not separately disclosed (not found)**. Q4 2025 Early Development revenue "down 13.5%". Labcorp is divesting or restructuring ~$50M of annual Early Development revenue | n/a | P/SOFT (via excerpt) | [11], [13] |
| Fortrea | n/a | Clinical CRO only. Spun out of Labcorp 2023-06-30; preclinical stayed with Labcorp | n/a | P-co | [14] |
| **WuXi AppTec, WuXi Testing** | FY2025 | RMB 4,041.7M | +4.7%; "drug safety evaluation services revenue grew 4.6%" | P | [15] |
| Pharmaron, group | FY2025 | RMB 14,095.1M | +14.8% | P | [16] |
| Pharmaron, laboratory services | 9M 2025 | RMB 6,003.75M | +15.04% | S (summary of filing) | [16] |
| **Certara**, total / software / services | FY2025 | $418.8M / $183.3M / $235.6M | +9% / +18% / +3% | P | [17] |
| Certara, continuing ops guidance after divesting regulatory and medical writing (closed 2026-05-08) | FY2026 | $367–382M | 0–4% comparable | P | [18] |
| **Simulations Plus**, total / software / services | FY2025 (FYE 2025-08-31) | $79.2M / $45.8M / $33.4M | +13% total; $77.2M non-cash impairment | P | [24] |
| Simulations Plus | 9M FY2026 | $64.6M | +5% (software -2%) | P | [25] |
| **Schrödinger**, total / software / drug discovery | FY2025 | $255.9M / $199.5M / $56.4M | +23.3% / +10.6% / ~2x | P | [27] |
| **Dotmatics** (Siemens) | FY2025 expected | ">$300m", adj. EBITDA margin >40%; EV $5.1B; closed 2025-07-01 | n/a | P-co (acquirer statement, pre-close projection) | [29] |
| Benchling | May 2024 | ~$210M ARR (estimate) | +27% vs 2022 (est.) | SOFT (Sacra estimate, not disclosed) | [38] |
| Instem (private since Nov 2023, ARCHIMED, £203M) | latest | **not found** (no post-take-private financials) | n/a | S | [31] |

**Reading (evidence):** the US-listed preclinical services anchors (Charles River DSA plus Inotiv DSA) total about $2.6B. Charles River DSA includes non-regulated discovery services, so it is not pure IND-enabling spend. Labcorp does not disclose Early Development revenue. China-based providers report in RMB and bundle preclinical with other lab testing.

### 2.2 Market-research estimates (secondary; definitions inconsistent)

| Market | 2025 estimate(s) | Forecast CAGR | Publisher(s) | Grade | Src |
|---|---|---|---|---|---|
| Preclinical CRO | $6.76B; $6.80B; $6.94B; outlier $10.11B | 8.7–8.8% (outlier 13.9%) | Coherent MI; Precedence/Towards Healthcare; Market Research Future; Fortune BI (via third party) | S/SOFT | [91] |
| Bioanalytical testing services | $5.3B; $4.6B; $4.54B | ~8–10% | Grand View Research; Global Market Insights; Towards Healthcare | S | [92] |
| ADME-tox testing | $4.5B (in vitro only) up to $13.05B; cluster $6.6–7.9B | 3.9–12% | Roots Analysis; SNS Insider; Expert MR; IMARC ($11.5B); SkyQuest ($13.05B) | S/SOFT | [93] |
| "Toxicology testing services" | $46.3B (Value Market Research); in vitro tox $12.69B (2026, MarketsandMarkets) | 5.8%; 10.6% | as listed | **S/SOFT. Not usable.** $46B is ~19x Charles River's whole DSA segment and evidently includes non-pharma and clinical/forensic testing | [94] |
| Lab informatics (LIMS+ELN+related) | $4.12B; $4.07B; IMARC $3.8B (2024) | ~4–5% (Towards Healthcare implies ~5% to 2035) | Towards Healthcare; GII listing; IMARC | S | [95] |
| LIMS only | $1.44B–$2.88B | 5.6–12.5% | Reanin; Fortune BI; MarketsandMarkets | S/SOFT | [95] |
| ELN only | ~$0.67–0.86B | ~7% | SNS Insider; MarketsandMarkets; Towards Healthcare; Global Info Research | S | [95] |
| AI in drug discovery | $2.2B (IMARC) to $19.89B (Towards Healthcare); Precedence $6.93B | 10–26% | as listed | **S/SOFT. A ~9x spread across publishers, so this figure is not decision-grade** | [96] |

**Note on our existing doc:** `docs/02_market_and_competition.md` gives "AI in drug discovery ~$3.1B". I could not match that figure to any 2025 publisher in this pass. The published range is $2.2B–$19.9B. Its preclinical CRO ($6.8B), bioanalytical ($4.6B) and lab-informatics ($4.1B) figures match Precedence/Towards Healthcare, GMI and Towards Healthcare respectively. All are **S**.

### 2.3 Sanity check (analysis, not a sourced figure)

- Charles River DSA ($2.40B, P) is about 35% of the secondary "$6.8B preclinical CRO" estimate. That is consistent with Charles River's position as the largest Western provider and with WuXi, Labcorp, Inotiv, Pharmaron and many private CROs (Altasciences, Frontage, Syngene, etc.) making up the rest. The secondary total is **plausible as an order of magnitude but cannot be validated** from public filings.
- The software and informatics pool that is specific to preclinical is small. Certara's SEND-relevant products (Pinnacle 21, SEND Explorer) sit inside a $183M software line that is mostly clinical (P [17], [19]).

---

## 3. Volume and demand

### 3.1 FDA IND receipts (CDER, calendar year)

FDA publishes CDER IND receipts **by calendar year**, split into Commercial and Research. Counts exclude biosimilar, expanded-access and "unknown" INDs (**P** [58]; IND Receipts page "content current as of 08/20/2026").

| Calendar year | Commercial | Research | Total | Src |
|---|---|---|---|---|
| 2016 | 777 | 892 | 1,669 | P [58] |
| 2019 | 928 | 750 | 1,678 | P [58] |
| 2020 | 1,253 | 929 | 2,182 | P [58] |
| 2021 | 1,259 | 809 | 2,068 | P [58] |
| 2022 | 1,124 | 741 | 1,865 | P [58] |
| 2023 | 1,062 | 662 | 1,724 | P [58] |
| 2024 | 1,139 | 716 | 1,855 | P [58] |
| **2025** | **1,210** | **750** | **1,960** | P [58] |

- CDER biosimilar IND receipts, 2025: 6 commercial, 1 research (**P** [58]).
- **CBER IND receipts (cell and gene therapy, vaccines) for recent years: not found.** FDA's public IND receipts reports cover CDER only.
- Caveat (analysis): a "commercial IND" is not the same as a new molecule. One molecule can have several INDs (different divisions or indications), and follow-on and 505(b)(2) programs are counted. So these counts are an **upper bound** on new molecules entering the clinic through CDER.
- Example of weak secondary sourcing: a Certara blog (2024-03-29) says FDA received "777 IND submissions" in FY2021 and estimates ">1,000" SEND datasets a year from that (S [23]). FDA's own data give 1,259 commercial INDs in CY2021. 777 is the CY2016 commercial figure. Do not reuse the Certara number.

### 3.2 Pipeline composition and new-company formation

| Indicator | Figure | Grade | Src |
|---|---|---|---|
| Small molecules as share of global Phase I trial starts | 62% in 2025 (60% in 2023) | S (IQVIA Institute, reputable analyst) | [59] |
| New active substances launched globally | 79 in 2025; 53 in the US | S | [59] |
| Emerging biopharma (R&D <$200M, revenue <$500M) share of pipeline molecules | 65% (2021 data; <50% in 2016) | S (dated) | [60] |
| Global drugs in development, start of 2026 | 22,940 (-3.9% YoY, first decline since mid-1990s; Citeline warns 2025 methodology changes may make this anomalous) | S/SOFT | [61] |
| Oncology share of programmes | 38.6% | S | [61] |
| Biopharma VC, 2025 | $33.8B; early-stage share fell to 32%; PitchBook cites "a meaningful reduction in the number of new company formations and first financings" | S | [62] |
| First financings, Q2 2025 | $0.9B (from $2.6B in Q1 2025) | S | [63] |
| Series A count, 2025 | "flat vs 2024" after four years of decline (exact count not retrieved) | S/SOFT | [64] |
| **Number of new biotech companies reaching IND per year** | **not found** | n/a | n/a |

**Relevance (analysis):** oncology is about 39% of programmes. Advanced-cancer programs follow ICH S9, not M3(R2), and use a lighter, different IND-enabling package. Any driver catalog must branch on S9 vs M3(R2) early.

### 3.3 IND-enabling cost and duration

| Item | Figure | Grade | Src |
|---|---|---|---|
| **Preclinical phase** (candidate selection to first human dose), large-pharma benchmark | p(TS) **69%**; **$5M** out-of-pocket per asset; **1.0 year** cycle time. Sensitivity ranges used: $2.5–7.5M; 0.5–1.5 yr; 60–80% | **P** (Paul et al., *Nat Rev Drug Discov* 2010; Lilly + Pharmaceutical Benchmarking Forum data; 2010 USD) | [65] |
| Preclinical share of cost per NME launch in the same model | $62M of $873M out-of-pocket (7%); $150M of $1,778M capitalized | P | [65] |
| Whole-drug R&D cost context | $2,558M capitalized pre-approval per approved compound (2013 USD), quoted as "up to $2.6 billion" in Charles River's 10-K | P | [66], [3] |
| NHP cost / usage (mAb programs) | "more than 100 non-human primates" per typical mAb nonclinical program; "approximately $50,000 per animal" | **P** (FDA) | [74] |
| NHP prices, China 2026 | ~RMB 200,000 per cynomolgus monkey; supply pre-booked | S | [97] |
| Small-molecule IND-enabling package | $2–7M; 12–18 months | **SOFT** (non-peer-reviewed web guides; no stated method) | [68] |
| Line items | 28-day GLP rat $300–500K; 28-day GLP dog $500–900K; genotox battery $75–135K | **SOFT** | [68] |
| Consultant estimate, IND-enabling tox core (2-species DRF + 4-week GLP + genotox + safety pharm) | $1.5M | SOFT (undated slide) | [69] |
| Single-company asks (NCI SBIR showcase) | $3.5M and $6M to complete IND-enabling work (one including CMC/GMP) | S (individual cases) | [70] |
| Vendor case study timeline | IND-enabling tox "in just 9 months" | P-co (vendor marketing) | [71] |
| FDA review clock after IND submission | IND goes into effect 30 days after FDA receipt unless placed on clinical hold (21 CFR 312.40(b)) | P | [98] |
| SEND conversion turnaround | Instem average 4 weeks vs "consensus" 8 weeks at an industry meeting | P-co/SOFT (undated vendor page) | [34] |
| Peer-reviewed current-dollar cost breakdown of a small-molecule IND package | **not found** | n/a | n/a |

---

## 4. Competitors and adjacent players

"What they sell" is taken from filings and product pages (P/P-co). Performance and adoption claims are the vendors' own and are unverified.

### 4.1 CROs and CRO-side portals

| Player | What they sell today (verified) | Hakase relevance | Pricing model | Src |
|---|---|---|---|---|
| **Charles River (DSA)** | Regulated (GLP) and non-regulated safety assessment and discovery. **Apollo** (launched 2023-03-13): cloud client platform with study status, data insights, document download and a **self-service quoting tool**, later adding real-time preliminary bioanalysis/biomarker data for in vivo general tox and DMPK. 2026: joined Lilly's TuneLab AI/ML platform as nonclinical testing expert; "AI-enabled, end-to-end workflow" in digital pathology. Nov 2025: invest in bioanalysis and NAMs, divest about 7% of revenue | Largest likely CRO counterpart. Apollo shows the CRO sees real-time data access as a gap. It is a **single-CRO** portal | Per-study quotes; no public price list | P-co [7], [8]; P [2], [3]; S [100] |
| **Labcorp Early Development** | Nonclinical toxicology, bioanalysis, SEND services. Restructuring ~$50M of revenue (2025–26) | Major CRO counterpart; under pressure | Per-study quotes | P/SOFT [11], [13] |
| **Inotiv** | DSA (discovery + safety assessment) and RMS (research models, including NHPs); sales to >2,200 companies in FY2025 | Mid-size US CRO; a likely partner for a startup | Per-study quotes | P [9], [10] |
| **WuXi AppTec (WuXi Testing)** | Drug safety evaluation, lab testing, DMPK. An online order portal (WOS: place orders, track status) exists, but its scope and date are unclear (it may be device/lab testing). A 2013 Instem "Provantis Portal" let tox clients view data remotely | Constrained by **BIOSECURE Act** (enacted 2025-12-18 in FY2026 NDAA). DoD added WuXi AppTec to the 1260H list on 2026-06-08 per Arnold & Porter, but designation as a "biotechnology company of concern" depends on further process | Per-study quotes | P [15]; P-co/SOFT [15]; S [86] |
| **Pharmaron** | Laboratory services (discovery, DMPK, safety), CMC, clinical | China-based alternative; same BIOSECURE exposure question (not resolved in sources) | Per-study quotes | P [16] |
| **Altasciences** | Integrated preclinical + Phase I CRO/CDMO (sponsor of the buyer survey in Section 5) | Mid-size integrated competitor for "one-stop" demand | Per-study | S [87] |

### 4.2 Preclinical study management, SEND and PK software

| Player | What they sell today | Hakase relevance | Pricing | Src |
|---|---|---|---|---|
| **Instem** (ARCHIMED-owned) | **Provantis** (GLP preclinical study management); **submit** / SEND solutions and SEND services (Deliver = conversion, Comply = verification, Warehouse = legacy conversion); **Centrus** (translational safety data review); **Climb** (cloud in vivo capture); in silico services (Predict, KnowledgeScan, Advance for S1B weight-of-evidence). **Acquired Xybion Digital on 2025-07-31**: **Pristima** (GLP study management SaaS), Autoscribe LIMS, Xybion QMS | The SEND incumbent at the CRO data-capture layer. Owns both legacy GLP study systems (Provantis and Pristima). A third-party commentary says Provantis and submit are "not directly integrated" (S/SOFT) | Not public (enterprise/services) | P-co [32], [33]; S [31] |
| **Certara** | **Pinnacle 21 Enterprise** (SDTM/ADaM/SEND validation, FDA/PMDA Data Fitness scorecards, define.xml); **P21 Community** (free desktop validator); **SEND Explorer** (nonclinical data viewer); **SEND dataset services**; **Phoenix WinNonlin** (NCA/PK/PD/TK; Certara says it is used by 11 regulators including FDA). Claims P21E is "adopted by the FDA and PMDA" and 24 of the top 25 biopharma. P21 revenue tracks study counts, not seats (CFO, Mar 2026). Divested regulatory and medical writing to Veristat (closed 2026-05-08). D360 (scientific informatics) **not verified in this pass** | Pinnacle 21 is the de facto conformance gate a Hakase SEND package must pass. WinNonlin is the de facto TK/NCA reference that Hakase TK outputs will be compared against | Subscription (Enterprise), free (Community); prices not public | P [17], [18]; P-co [20], [21]; S [19], [22] |
| **Simulations Plus** | GastroPlus (PBPK), ADMET Predictor (ML ADMET), DILIsym (liver tox QST), MonolixSuite, Pro-ficiency (acquired Jun 2024, $100M) | Supplier of predictive models Hakase may cite. Not an orchestrator | Software licenses + services | P [24], [25]; P-co [26] |
| **Veeva** | Vault clinical, regulatory, quality and safety apps; **Veeva Basics** pre-validated bundle for emerging biotechs (Nov 2025); **LIMS Basics** (QC/CMO oversight, batch release) early 2026. **No preclinical/toxicology study management product found** | Owns the biotech's regulatory and quality system of record. Hakase's Module 4 output will need to land in Vault RIM/Submissions | Not public | P-co [40] |

### 4.3 R&D informatics platforms

| Player | What they sell today | Hakase relevance | Pricing | Src |
|---|---|---|---|---|
| **Benchling** | ELN/registry/inventory; **In Vivo** (randomization, colony/cage management, dosing and observation capture, body-weight alerts, audit logs; efficacy/tolerability/survival studies); **Benchling AI** (2025-10-07: Deep Research, Compose, Data Entry agents); **One-Click Ordering** with Twist, Adaptyv and Ginkgo (May 2026) | Ordering external services from inside the platform is adjacent to dispatch. In Vivo targets in-house discovery studies, not GLP CRO studies | Not public. ~$15–20K/yr "professional" tier per third party (**SOFT**) | P-co [35], [37]; S [36]; SOFT [38] |
| **Dotmatics (Siemens)** | Luma scientific intelligence platform, ELN, GraphPad Prism, Geneious, SnapGene, Vortex, OMIQ/FCS Express, Protein Metrics. Siemens closed the acquisition 2025-07-01 ($5.1B EV) | Analysis/ELN incumbent with a deep-pocketed owner and possible acquirer | Not public | P-co [29], [30] |
| **Schrödinger** | Physics-based modeling and LiveDesign (moving to hosted, ratable licensing); **predictive toxicology** initiative (Gates Foundation $10M + $9.5M) structurally enabling >50 off-targets including hERG, CYP3A4/2D6/2C9, PXR; beta to select customers announced for 2025; "Predictive Toxicology Solutions" webinar Dec 2025 | Upstream in silico safety. Could feed Hakase as a cited PREDICTED source | License/hosted subscription; not public | P [27]; P-co [28] |
| **TetraScience** | "Scientific Data and AI Cloud" (instrument and partner data harmonization). Small 2026 round (~$15M) per aggregators | Data-plumbing competitor for "ingest CRO data" if it moves into nonclinical | Not public | S/SOFT [39] |

### 4.4 Marketplaces and cloud/robotic labs

| Player | Status / what they sell | Relevance | Pricing | Src |
|---|---|---|---|---|
| **Scientist.com** | R&D procurement marketplace ("AI-enabled R&D Orchestration Platform"); >5,000–6,000 suppliers; acquired by **GHO Capital** (announced 2025-09-16, closed Nov 2025); plans automated contracting, vendor management and predictive modeling | The closest analog to multi-CRO *sourcing*. Does not design studies, ingest data or assemble Module 4 | Supplier-side transaction fee, reported as ~5% (2018) (**SOFT**), plus client private marketplaces | P-co [41]; S/SOFT [41] |
| **Emerald Cloud Lab** | Operating remote-controlled lab (Austin, ~230 instruments per 2024 coverage); Carnegie Mellon cloud lab (2024). No major 2025–26 news found | Runs labs (Hakase does not); discovery-scale, not GLP tox | Not public | S [42] |
| **Strateos** | April 2023: pivoted from hosted remote cloud lab to on-site cloud-lab deployments. Lilly sold its Strateos-run San Diego lab to Arctoris. **Full shutdown not confirmed** in sources found | Evidence that remote-lab-as-a-service struggled | n/a | P-co [43]; S [43] |
| **Ginkgo Datapoints** | High-throughput ADME profiling (2025-07-17), with a promise to match or beat quotes from Chinese or other international vendors; **ADME-One** (2026-05-26) with Inductive Bio and Tangible Scientific: Tier 1 ADME panel (microsomal stability, permeability, kinetic solubility, CYP inhibition, PPB) + AI human PK projection, priced "below offshore CROs", pitched to BIOSECURE reshoring | Commoditizes in vitro ADME. A possible *dispatch target* for a Hakase in vitro DMPK driver | Price-match / single SKU; numbers not public | P-co [44] |
| **Arctoris** | Robotic, AI-enabled discovery CRO (Oxford; Singapore hub); bought Lilly's former Strateos lab | Discovery assays, not GLP | Online assay ordering; prices not public | S [43], [57] |
| **Medra** | Autonomous lab robots ("physical AI scientists"); $52M Series A (Dec 2025); partners reportedly include Genentech | Lab automation, not orchestration of external GLP CROs | n/a | S [51] |

### 4.5 AI-first companies (existence verified; what they actually do)

| Company | Exists? | What it does (as of latest source) | Funding (latest found) | Competes with Hakase? | Src |
|---|---|---|---|---|---|
| **Weave Bio** | Yes | **AutoIND** and the ReALM platform: AI drafting, review and submission of IND (expanding to clinical and approval-stage) documents; Parexel as CRO design partner (Sep 2025) | $20M Series A (2025-10-16); $36M total | **Yes, at the Module 2/4 writing layer.** Does not design or dispatch studies (not found) | S [53] |
| **Inductive Bio** | Yes | **Compass** ADMET prediction (Beacon-1 models) trained on a pre-competitive data consortium; "chemist-in-the-loop" service; states an intent to launch an "AI-native CRO"; partner in ADME-One | $25M Series A (May 2025) | Adjacent (discovery ADMET); possible future CRO competitor | P-co [49]; [44] |
| **Axiom Bio** | Yes | AI prediction of human liver toxicity (DILI) from a large primary human hepatocyte dataset; public dataset of >130,000 compounds; claims $100–450/compound vs $3,000–15,000 physical (**SOFT**, Dealroom) | $15M seed (announced Apr 2025) | Adjacent (in silico tox source) | S [48] |
| **Tamarind Bio** | Yes (YC W24) | No-code cloud access to 200–250+ computational biology models (protein design, docking, structure prediction) | $13.6M Series A (Feb 2026) | No (design compute) | S [50] |
| **Potato** | Yes | "AI scientist" research assistant (hypotheses, protocol optimization, literature); working with Ginkgo Automation toward closed-loop experiments | $4.5M seed (Apr 2025) | No (research assistant) | S [52] |
| **Lila Sciences** (Flagship) | Yes | "AI Science Factories" (AI + robotics autonomous labs across life sciences, chemistry, materials); intends to sell platform access | ~$550M raised in 2025; >$1.3B valuation (Oct 2025); reported talks at ~$8.5B pre-money (Jun 2026, **SOFT**) | Not today (builds its own data/labs) | S [46] |
| **Periodic Labs** | Yes | AI scientists + autonomous labs for **materials/physical sciences** (superconductors etc.) | $300M seed (late Sep / early Oct 2025) | **No** (not drug development) | S [47] |
| **Recursion** | Yes | Internal pipeline + partnerships (Roche/Genentech, Sanofi); does not sell its platform. Q2 2026 revenue $7.7M (-60% YoY) | Public company | No | S [45] |
| **Vivodyne** | Yes | Lab-grown human tissue testing with robotics/AI as an alternative to animal preclinical models; 23,000 sq ft robotic lab | $40M Series A (May 2025) | Adjacent NAM *supplier* (a future dispatch target) | P-co [54] |
| **Tremont AI** | Yes (out of stealth 2026-09-29) | Toxicology foundation models on pathology images (TRACE, ToxScribe, Tremont Studio); tech licensed from Mass General Brigham | Not disclosed | Adjacent (tox pathology analysis) | P-co [55] |
| **Quris-AI** | Yes | "Patient-on-a-chip" + AI clinical-prediction platform; Merck deal | $28M seed (Jan 2022; another report says $37M; **SOFT**) | Adjacent NAM | S [56] |
| "AI CRO" that designs, dispatches and assembles IND-enabling packages end to end | **Not found** | Closest partials: Weave (writing), Inductive (stated AI-native CRO plan), Scientist.com (procurement), CRO portals | n/a | n/a | n/a |

---

## 5. Regulatory tailwinds and constraints

### 5.1 ICH M3(R2) sets the small-molecule IND package (what must exist before first-in-human)

All **P**, FDA-adopted ICH M3(R2), January 2010 [85]:
- **Safety pharmacology core battery** (cardiovascular, CNS, respiratory) "should generally be conducted before human exposure" per S7A/S7B.
- **TK/PK:** "in vitro metabolic and plasma protein binding data for animals and humans and systemic exposure data" in the repeat-dose tox species "generally should be evaluated before initiating human clinical trials".
- **Repeat-dose toxicity in two mammalian species (one nonrodent)**, with duration ≥ clinical duration. Table 1: up to 2 weeks clinical needs 2-week studies; 2 weeks to 6 months needs the same duration as the trial; >6 months needs 6-month rodent and 9-month nonrodent.
- **Genotoxicity:** a gene mutation assay supports single-dose trials. Multiple-dose trials need an additional chromosomal-damage assessment in a mammalian system. The complete battery is due before Phase 2.
- IND content: 21 CFR 312.23(a)(8) requires pharmacology/toxicology data adequate to conclude the trial is "reasonably safe", and a GLP compliance statement (or reasons for non-compliance) for each Part 58 study (**P** [98]).

### 5.2 SEND (Standard for Exchange of Nonclinical Data): what is mandated

FDA Study Data Technical Conformance Guide, **October 2026 (v6.3)**, final, docket FDA-2014-D-0092 (**P** [80]). CDER requirement table, for studies *started* after:

| Study type | SENDIG | CDER NDA/BLA | CDER **commercial IND** |
|---|---|---|---|
| Single-dose, repeat-dose, carcinogenicity | v3.0 / v3.1 / v3.1.1 | 2016-12-17 / 2019-03-15 / 2023-03-15 | **2017-12-17** / 2020-03-15 / 2023-03-15 |
| Cardiovascular and respiratory safety pharmacology | v3.1 / v3.1.1 | 2019-03-15 / 2023-03-15 | **2020-03-15** / 2023-03-15 |
| Embryo-fetal development | SENDIG-DART v1.1 | 2023-03-15 | **2024-03-15** |
| Genetox in vivo micronucleus and comet | SENDIG-GeneTox v1.0 | 2025-03-15 | **2025-03-15** |
| Animal Rule (natural history and efficacy) | SENDIG-AR v1.0 | 2022-03-15 | 2023-03-15 |

- CBER: single/repeat-dose/carcinogenicity and CV/respiratory safety pharmacology from **2023-03-15**; genetox in vivo from 2025-03-15; Animal Rule from **2027-03-15** (**P** [80]).
- SEND datasets are required **with the draft study report**, not only the final (**P** [80]).
- For outsourced studies, the testing facility's study ID goes in define.xml ProtocolName. MTD + 7-day studies in one report still need separate SEND packages (**P** [80]).
- **Appendix I (added March 2026), "SEND Data Review Prior to Submission".** FDA states that "when SEND study data packages are submitted with certain errors, SEND may be unusable." It lists three categories of common issues (submission, SENDIG conformance, study-design representation). It sets expectations including **traceability to raw data and the study report**, analyses that match the report, and nSDRG disclosure of which organization created and verified the data and with what systems (**P** [80]).
- Not mandated in SEND: in vitro genetox (Ames, in vitro micronucleus), in vitro ADME, hERG patch-clamp. These are submitted as reports (**P** by omission from the table [80]).

### 5.3 FDA Modernization Act 2.0 and 3.0

- **2.0 (enacted):** Section 3209 of the Consolidated Appropriations Act, 2023 (Pub. L. 117-328), December 2022. It amended FD&C Act §505(i) to replace "preclinical tests (including tests on animals)" with "nonclinical tests" and defined nonclinical tests to include cell-based assays, microphysiological systems and computer models. It **did not ban animal testing** and did not amend FDA's IND regulations (**P** bill text [78]; **S** summary [78]).
- **3.0 (pending):** S.355 passed the Senate by unanimous consent on 2025-12-16. H.R.2821 passed the House on 2026-07-20 (voice vote, suspension) and was received in the Senate on 2026-07-21. A tracker updated 2026-09-02 still shows Senate action pending, and **no enactment found** (**P/S** [79]). If enacted, it would require FDA to issue an interim final rule within one year replacing "animal" with "nonclinical" in IND/NDA/BLA regulations (**P** bill text [79]).

### 5.4 FDA animal-testing roadmap and follow-ons (all P unless noted)

| Date | Action | Key content | Src |
|---|---|---|---|
| 2025-04-10 | Roadmap + press release | Begins with mAbs, then other biologics, **new chemical entities** and medical countermeasures; encourages NAM data in INDs "immediately"; uses foreign human safety data | [72], [73] |
| 2025-12-02 | Draft guidance "Monoclonal Antibodies: Streamlined Nonclinical Safety Studies" | 6-month NHP studies not needed when 3-month studies plus weight-of-evidence are used; sometimes no NHP study at all; ">100 NHPs" per typical program; "~$50,000 per animal" | [74], [77] |
| 2025-12-08 | First AI drug development tool qualified (AIM-NASH, MASH biopsy scoring) | A clinical-trial tool, not nonclinical | [77] |
| 2026-03-18 | Draft guidance "General Considerations for the Use of New Approach Methodologies in Drug Development" (CDER) | Four validation principles: context of use, human biological relevance, technical characterization, fit-for-purpose | [75] |
| 2026-04 | "Reducing Animal Testing in Nonclinical Studies: Year One Progress" | ISTAND program permanent (16+ submissions); NAMs acceptability database; FDA "will extend weight-of-evidence approaches and reduced duration testing to ... new chemical entities"; validated alternatives exist for skin sensitization and mutagenic impurities **but not developmental toxicity or chronic toxicity** | [76], [77] |

**Interpretation (opinion):** for small molecules in 2026–2028, NAMs change **study design inputs** (weight of evidence, in silico/in vitro supplements) faster than they remove the core two-species GLP tox package. A product that tracks a cited, versioned rule table can absorb these changes. A product that hard-codes today's package cannot.

### 5.5 GLP (21 CFR Part 58) and electronic records (21 CFR Part 11)

- **Part 58 scope:** "good laboratory practices for conducting nonclinical laboratory studies" that support FDA research or marketing applications (**P** [81]). §58.185 lists the final report contents and says it "shall be signed and dated by the study director" (**P** [81]). This is a hard human attestation boundary, consistent with CLAUDE.md §9.
- FDA's 2016 proposed "GLP Quality System" rule (proposed 2016-08-24) would modernize Part 58 for multisite studies and a full quality system. **Finalization not found** (**S** [82]).
- **Part 11 scope:** it applies to records in electronic form that are "created, modified, maintained, archived, retrieved, or transmitted" under FDA record requirements or submitted to FDA. Its aim is records and signatures that are "trustworthy, reliable, and generally equivalent to paper records" (**P** [81]). Any Hakase component that holds GLP raw data, study reports or signatures for submission is in scope.

### 5.6 AI guidance

- **FDA draft guidance (January 2025)**, "Considerations for the Use of Artificial Intelligence to Support Regulatory Decision-Making for Drug and Biological Products", docket FDA-2024-D-4689. **Still listed as draft**; the FDA page shows "content current as of 01/06/2025"; finalization **not found** (**P** [83]).
  - Scope (quoted): it covers AI "to produce information or data to support regulatory decision-making regarding safety, effectiveness, or quality". It "does not address the use of AI models (1) in drug discovery or (2) when used for operational efficiencies (e.g., internal workflows, resource allocation, drafting/writing a regulatory submission) that do not impact patient safety, drug quality, or the reliability of results from a nonclinical or clinical study" (**P** [83]).
  - Framework: a risk-based credibility assessment tied to context of use (7 steps per secondary summaries) (**S** [83]).
- **FDA–EMA "Guiding Principles of Good AI Practice in Drug Development"** (10 principles, 2026-01-14): human-centric, risk-based, adherence to standards (including GxP), clear context of use, data governance, life-cycle management. Non-binding (**P** [84]).
- **Implication (opinion):** Hakase's PREDICTED values that feed safety conclusions in a Module 4 summary are **in scope** and need a context-of-use credibility plan. LLM drafting of narrative is out of scope only while a human-attested, deterministic pipeline guarantees it cannot change results. That matches CLAUDE.md §8.

### 5.7 BIOSECURE Act (supply-side constraint)

- Enacted 2025-12-18 as part of the FY2026 NDAA. It bars federal procurement, contracts and grants involving "biotechnology companies of concern", with a 5-year safe harbor for existing contracts. The enacted text names no companies (**S** law-firm summaries [86]). WuXi AppTec was added to DoD's 1260H list on 2026-06-08 per Arnold & Porter (**S** [86]). Ginkgo markets ADME-One as part of "reshoring" (**P-co** [44]).
- **Implication (opinion):** CRO-neutral dispatch that can re-route work between US, EU and Asia CROs has new value for US biotechs with federal grants or contracts.

---

## 6. Buyer evidence

### 6.1 How much is outsourced

| Evidence | Figure | Grade | Src |
|---|---|---|---|
| Regulated safety assessment outsourcing penetration | "60% outsourced or more"; discovery "believed to be less outsourced" | P (company estimate in 10-K) | [3] |
| Toxicology vs discovery outsourcing; emerging biotech | ~70% tox; ~18% discovery; emerging biotechs "up to 90%" of activities | SOFT (2022 CRO-authored market report, no method) | [89] |
| Client concentration at the largest CRO | no client >4% of Charles River revenue; >8% of any segment | P | [3] |
| Inotiv customer breadth | sales to >2,200 companies (FY2025) | P | [10] |
| Who drove the 2025–26 recovery | Charles River management: biotech clients were "the primary driver" of the 2H25 rise in DSA book-to-bill | S (earnings-call summary) | [4] |
| **Number of CROs used per IND program** | **not found** (ISR Reports data paywalled) | n/a | n/a |

### 6.2 Documented pain points

| Pain | Evidence | Grade | Src |
|---|---|---|---|
| Multi-CRO contracting and coordination | 50% of 143 biopharma executives: "multiple contract negotiations present a significant problem" (preclinical + Phase I). Quote: "When trying to source to multiple CROs, we have had difficulty coordinating between them for complete pricing and timing" | S (vendor-sponsored: Altasciences/Biopharma Dive Pulse Survey, fielded by John Gilfether & Associates, Oct 2021) | [87] |
| Timelines and capacity | 45% tight deadlines; 38% finding quality CROs; 36% technology transfers; 29% project-management miscommunication; 25% inadequate capacity | S (same survey) | [87] |
| Preference for integration | 71% prefer a one-stop solution for preclinical + Phase I | S (same survey; sponsor sells one-stop, so bias likely) | [87] |
| Multi-CRO data management | C&EN BrandLab/Dotmatics survey: biotechs "increasingly turning to multiple CROs" incl. DMPK and tox; both sides cite "a need for data-management solutions" (no numbers published) | S (vendor-commissioned) | [88] |
| SEND quality | FDA says some SEND packages are "unusable" on receipt; 3 categories of recurring errors | **P** | [80] |
| SEND variability across CROs | For identically designed tox studies, nSDRG length "can differ by a factor of three across CROs" (Japan); 13 of 16 Japanese pharma companies created SEND jointly with a solution provider (2018) | P (peer-reviewed, *J Toxicol Pathol* 2019) | [90] |
| SEND capacity | Waitlists for SEND dataset services; smaller and non-US facilities more likely to lack SEND capability | P-co/S (Certara blog, 2024) | [23] |
| Real-time data access | Charles River framed Apollo against the status quo, in which "data sharing ... relies on a study director to proactively provide program updates" | P-co | [7] |
| NHP supply/cost | FDA ~$50K per NHP; China ~RMB 200K in 2026 with pre-booked supply | P [74]; S [97] | |
| Buyer cash constraints | PitchBook: early-stage share of biopharma VC fell to 32% in 2025; fewer new companies | S | [62] |

**Gaps:** I found no independent (non-vendor) survey since 2021 that quantifies IND-enabling outsourcing pain, the number of CROs per program, or the internal FTE time spent on CRO data reconciliation and Module 4 assembly. **Primary customer interviews are required** before pricing.

---

## 7. Implications for Hakase OS

### 7.1 Evidence base for driver prioritization

"Required" is per ICH M3(R2) for a multi-dose small-molecule first-in-human trial outside ICH S9. "SEND" is per the CDER commercial IND column.

| Study type | Required for FIH? | SEND-mandated? | Cost evidence | Frequency evidence |
|---|---|---|---|---|
| **Repeat-dose general tox, rodent** (GLP, ≥ clinical duration; plus non-GLP DRF) | **Yes** (P [85]) | **Yes** since 2017-12-17 (P [80]) | 28-day rat $300–500K (**SOFT** [68]) | Every M3(R2) multi-dose IND |
| **Repeat-dose general tox, non-rodent** (dog/minipig/NHP) | **Yes** (P [85]) | **Yes** (P [80]) | 28-day dog $500–900K (**SOFT** [68]); NHP ~$50K/animal (**P** [74]) | Every M3(R2) multi-dose IND |
| TK / bioanalysis inside tox studies (S3A; ICH M10 method validation) | **Yes** (P [85]) | PC/PP domains within the tox SEND package (P [80]) | not found separately | Every IND with tox studies |
| Safety pharmacology core battery (CV telemetry, respiratory, CNS; hERG in vitro per S7B) | **Yes**, before human exposure (P [85]) | CV and respiratory in vivo: **yes** since 2020-03-15 (P [80]) | not found | Every M3(R2) IND (S9 allows integration into tox) |
| Genotox: gene mutation (Ames) ± chromosomal damage (in vitro MN or in vivo MN/comet) | Ames for single dose; + chromosomal damage for multi-dose (P [85]) | In vivo MN/comet only, since 2025-03-15 (P [80]) | Battery $75–135K (**SOFT** [68]) | Every M3(R2) IND |
| In vitro ADME (metabolism, PPB) + species PK | **Yes** (P [85]) | No | Being commoditized: Ginkgo price-match and "below offshore" ADME-One (P-co [44]) | Every IND; also used heavily pre-candidate |
| Embryo-fetal development (DART) | Usually later (US may defer to pre-Phase 3 with precautions) (P [85]) | Yes since 2024-03-15 (P [80]) | not found | Not in most first INDs |
| Carcinogenicity | Post-IND (marketing) (P [85]) | Yes (P [80]) | not found | Not in first INDs |

### 7.2 Which drivers carry the most commercial value (OPINION, reasoned from 7.1)

1. **General toxicology (rodent + non-rodent) with TK.** This is very likely the largest spend line in a small-molecule IND package: two GLP species, DRFs, histopathology, bioanalysis. If anything, NHP economics push it higher. It is in 100% of M3(R2) multi-dose INDs, it is where the CRO's study director, the sponsor's toxicologist and FDA's SEND reviewers meet, and FDA's Appendix I traceability expectations apply to it directly. *Caveat:* there is no peer-reviewed current-dollar spend share. The "largest line" claim rests on soft line-item prices and FDA's NHP figure.
2. **SEND verification and traceability as a CRO-agnostic layer.** This needs no CRO cooperation, has new regulatory pull (Appendix I, March 2026), and requires submission at the draft-report stage. Incumbents (Pinnacle 21 conformance validation; Instem/Certara conversion services) check *format conformance*. FDA now also asks for *traceability to raw data and the study report*. Hakase's provenance ledger is built for exactly that. Demand order of magnitude (derived, not sourced): ~1,100–1,260 commercial CDER INDs per year (P [58]) × roughly 3–5 SEND-mandated studies per new small-molecule IND (two repeat-dose studies, CV and respiratory safety pharmacology, sometimes in vivo genetox) gives **low thousands of SEND packages per year**. This is an upper bound because many commercial INDs are not new molecules. Validate with CRO and FDA data before using.
3. **Safety pharmacology (hERG + CV telemetry + respiratory/CNS).** Mandatory, SEND-mandated since 2020, and often run at the same CRO as general tox. A natural second driver.
4. **In vitro ADME/DMPK + IVIVE + FIH dose (MRSD).** Scientifically central (and it showcases Hakase's cited-equation rigor), but price is falling. Better as a credibility feature and a cheap dispatch target (e.g., Ginkgo ADME-One) than as the revenue wedge.
5. **Genotox battery.** Standardized OECD assays, cheap, easy to orchestrate. Low value per study but completes the package.
6. **Defer:** DART, carcinogenicity (post-first-IND), and biologics NHP programs (FDA mAb policy is changing fastest there, which lowers near-term value of animal-study orchestration and raises value of weight-of-evidence assembly. Revisit when expanding modalities).

### 7.3 What a credible wedge looks like (OPINION)

- **Who:** a seed-to-Series-B small-molecule biotech (non-oncology first, to stay on the M3(R2) path), 12–24 months from IND, outsourcing all GLP work. Supported by: ≥60% of regulated safety assessment is outsourced (P [3]); biotech drove the 2025–26 bookings recovery (S [4]); early-stage capital is scarce (S [62]), so the offer must reduce cash burn, not add a platform fee.
- **What:** "IND-enabling general-tox program, end to end, CRO-neutral". This covers (a) an ICH M3(R2)-derived study plan with cited rules; (b) protocol/design packet for the CRO, quote comparison and dispatch to 2+ CROs; (c) ingestion of SEND + report + raw TK data, with Hakase verifying traceability per TCG Appendix I and running Pinnacle 21-equivalent checks; (d) TK/NCA analysis with cited methods; (e) a draft Module 2.4/2.6.6/4.2.3 for human attestation.
- **Entry product that needs no CRO cooperation:** SEND traceability verification and nSDRG preparation for studies already run. It is sold per study against an existing line item (outsourced SEND verification and conversion services already exist, so the budget line exists, though public pricing was **not found**).
- **Pricing (opinion):** per IND program or per study, benchmarked against the CRO and SEND-services spend it displaces, not against ELN seats. Software-only pools are about one tenth the size of services pools (Section 2.1).
- **Where incumbents will push back:** Instem (now with Pristima) and Certara (Pinnacle 21) own the SEND toolchain. Charles River's Apollo shows CROs will build portals to keep clients inside one CRO. Weave Bio will compete for the document layer. Scientist.com (GHO-backed) could add study design.
- **Main risks (evidence-linked):** (1) CRO data access. Apollo-style portals are proprietary (P-co [7]). (2) Part 11 and GLP validation burden for any system of record (P [81]). (3) AI credibility documentation for predicted values used in safety conclusions (P [83]). (4) NAMs could shift spend away from animal tox for NCEs, but FDA says validated replacements for chronic and developmental toxicity do not exist yet (P [77]). (5) A thin cash-constrained buyer (S [62]).

### 7.4 Weakest-sourced claims in this document (do not quote without re-verification)

1. All market-research totals (Section 2.2), especially AI in drug discovery ($2.2B–$19.9B) and "toxicology testing services" ($46.3B).
2. IND-enabling package cost ($2–7M) and per-study line items ($300–500K rat, $500–900K dog, $75–135K genotox): non-peer-reviewed web guides [68].
3. Benchling ARR (~$210M) and pricing (~$15–20K/yr tier): third-party estimates [38].
4. Charles River NAMs revenue (~$200M): analyst report [6]. Charles River Q2 2026 book-to-bill (1.19x) and backlog ($1.97B): third-party summaries [4].
5. Outsourcing shares of ~70% tox, ~18% discovery and up to 90% for emerging biotechs: CRO-authored 2022 report [89].
6. Buyer pain percentages: a single vendor-sponsored 2021 survey [87].
7. Scientist.com ~5% supplier fee (2018) [41]; Axiom per-compound cost [48]; Lila $8.5B talks [46].
8. Labcorp BLS FY2025 $3.10B (trade press) [12]; Labcorp Early Development full-year revenue (not disclosed).

### 7.5 Not found (open research items)

- Peer-reviewed, current-dollar cost breakdown of a small-molecule IND-enabling package by study type.
- Number of CROs used per IND program; share of IND-enabling spend by study type.
- CBER IND receipts for 2023–2025.
- Count of new biotech companies or first-time sponsors reaching IND per year.
- Public pricing for SEND conversion or verification services and for Pinnacle 21 Enterprise.
- Instem revenue since the November 2023 take-private.
- Confirmation that Strateos fully shut down (only a 2023 pivot found).
- Any company selling end-to-end ICH-derived study design + multi-CRO dispatch + Module 4 assembly.

---

## 8. Sources (all accessed 2026-10-11)

1. Charles River Laboratories, "Fourth-Quarter and Full-Year 2025 Results and 2026 Guidance", Form 8-K exhibit, 2026-02-18. https://www.sec.gov/Archives/edgar/data/1100682/000110068226000020/crl4q25earningsrelease.htm (P)
2. Charles River Laboratories, "Second-Quarter 2026 Results", Form 8-K exhibit, 2026-08-05. https://www.sec.gov/Archives/edgar/data/0001100682/000110068226000115/crl2q26earningsrelease.htm (P)
3. Charles River Laboratories, Form 10-K for fiscal year ended 2025-12-27, filed 2026. https://www.sec.gov/Archives/edgar/data/1100682/000110068226000022/crl-20251227.htm (P)
4. Vectorshift, "Charles River Q2 2026 summary", 2026-08; Barchart/StockStory, "CRL Q4 deep dive", 2026-02. https://vectorshift.ai/research/companies/charles-river-laboratories-international/earnings/2026-q2-summary ; https://www.barchart.com/story/news/307497/crl-q4-deep-dive-flat-sales-and-margin-pressures-as-biotech-demand-recovers (S)
5. Charles River Laboratories, "Launches Alternative Methods Advancement Project", press release, April 2024. https://ir.criver.com/news-releases/news-release-details/charles-river-laboratories-launches-alternative-methods (P-co)
6. Zacks Investment Research, CRL research report, 2025-12-22. https://advisortools.zacks.com/proxy/ResearchReport/CRL/report?d=20251222 (S/SOFT)
7. Charles River Laboratories, "Charles River Launches Apollo", press release, 2023-03-13. https://ir.criver.com/news-releases/news-release-details/charles-river-launches-apollotm-industry-leading-secure-cloud (P-co)
8. Charles River, "Real-time bioanalysis, biomarker and DMPK data" (Apollo), undated web page. https://www.criver.com/insights/real-time-bioanalysis-biomarker-and-dmpk-data (P-co)
9. Inotiv, "Fourth Quarter and Full Year Fiscal 2025 Results", 2025-12-03. https://s205.q4cdn.com/769953234/files/doc_news/Inotiv-Reports-Fourth-Quarter-and-Full-Year-Financial-Results-for-Fiscal-2025-and-Provides-Business-Update-2025.pdf (P)
10. Inotiv, Form 10-K for fiscal year ended 2025-09-30. https://www.sec.gov/Archives/edgar/data/720154/000162828025055483/notv-20250930.htm (P)
11. Labcorp, "2025 Fourth Quarter and Full Year Results", 2026-02-17 (page returned HTTP 403; content read via search excerpts). https://ir.labcorp.com/news-releases/news-release-details/labcorp-announces-2025-fourth-quarter-and-full-year-results (P/SOFT)
12. 360Dx and CLP Magazine coverage of Labcorp FY2025 results, 2026-02. https://www.360dx.com/node/109751 ; https://clpmag.com/?p=87341 (S/SOFT)
13. Labcorp, "2025 Third Quarter Results" (Early Development ~$50M restructuring), 2025-10 (Barchart repost). https://www.barchart.com/story/news/35722855/labcorp-announces-2025-third-quarter-results (P via repost)
14. Labcorp, "Labcorp Completes Spin-off of Fortrea", 2023-07. https://www.labcorp.com/labcorp-completes-spin-fortrea (P-co)
15. WuXi AppTec, 2025 annual results announcement, HKEX, 2026-03-23; WuXi AppTec news release; WOS client training PDF (undated). https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0323/2026032300516.pdf ; https://wuxiapptec.com/news/wuxi-news/ukp6jpdhyncifp8ovk4kv1z6 ; https://wos.wuxiapptec.com/media/WOS%20-%20Client%20Training%20-%20WOS%20Order%20Creation%20(Version%201)%20-%20Read-Only.pdf (P; P-co/SOFT for WOS)
16. Pharmaron, 2025 annual results announcement, HKEX, 2026-03-30; Tiger Brokers summary of Q3 2025 results. https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0330/2026033003596.pdf ; https://www.itiger.com/news/1135335946 (P; S)
17. Certara, "Fourth Quarter 2025 Financial Results; 2026 Guidance", 2026-02; Form 10-K FY2025. https://www.certara.com/pressrelease/certara-reports-fourth-quarter-2025-financial-results-provides-full-year-2026-guidance/ ; https://www.sec.gov/Archives/edgar/data/1827090/000182709026000011/cert-20251231.htm (P)
18. Certara, Q2 2026 earnings release (8-K) and Form 10-Q for quarter ended 2026-06-30. https://www.sec.gov/Archives/edgar/data/0001827090/000182709026000026/q22026earningsreleaseex99.htm ; https://www.sec.gov/Archives/edgar/data/0001827090/000182709026000028/cert-20260630.htm (P)
19. MarketBeat, "Certara conference: 2025 revenue hits guidance... Q4 software bookings slip", 2026-03-13. https://www.marketbeat.com/instant-alerts/certara-conference-2025-revenue-hits-guidance-ebitda-margin-tops-range-as-q4-software-bookings-slip-2026-03-13/ (S)
20. Certara, Pinnacle 21 fact sheet, 2025-03-24; P21 Enterprise validation page. https://www.certara.com/wp-content/uploads/2025/04/2025-03-24-P21-Fact-Sheet_Digital.pdf ; https://www.certara.com/pinnacle-21-enterprise-software/validation/ (P-co)
21. Certara, Phoenix WinNonlin product page. https://www.certara.com/software/pkpd-modeling-and-simulation-2/phoenix-winnonlin-2 (P-co)
22. Certara, "FDA Requirements for SEND" blog, updated 2025-03-19. https://www.certara.com/blog/fda-requirements-send/ (S)
23. Certara, "What's driving the increased demand for SEND dataset services", 2024-03-29. https://www.certara.com/blog/whats-driving-the-increased-demand-for-send-dataset-services/ (P-co/S; contains an IND-count error, see Section 3.1)
24. Simulations Plus, Q4 and fiscal 2025 results, Form 8-K exhibit, 2025-12-01. https://www.sec.gov/Archives/edgar/data/1023459/000102345925000059/slp-2025831xexx991x254.htm (P)
25. Simulations Plus, "Third Quarter Fiscal 2026 Financial Results", 2026-07-09. https://www.businesswire.com/news/home/20260709321948/en (P)
26. Simulations Plus, "Acquisition of Pro-ficiency" investor deck, 2024-06-12. https://www.simulations-plus.com/wp-content/uploads/Acquisition-of-Pro-ficiency.pdf (P-co)
27. Schrödinger, "Fourth Quarter and Full-Year 2025 Financial Results", 2026-02-25. https://s203.q4cdn.com/609444515/files/doc_news/Schrdinger-Reports-Fourth-Quarter-and-Full-Year-2025-Financial-Results-2026.pdf (P)
28. Schrödinger, "Broadens and Accelerates Predictive Toxicology Initiative", 2024-11-18; Corporate Overview Deck, May 2025. https://www.businesswire.com/news/home/20241118396407/en/ ; https://s203.q4cdn.com/609444515/files/doc_presentations/2025/May/07/Corporate-Overview-Deck-May-2025-v3.pdf (P-co)
29. Siemens, "Siemens completes acquisition of Dotmatics", 2025-07-01. https://news.siemens.com/da-dk/dotmatics-closing/ (P-co)
30. Dotmatics, "Introducing the new Dotmatics" (product portfolio), undated. https://www.dotmatics.com/blog/introducing-the-new-dotmatics (P-co)
31. Instem/Business Wire, "Instem now part of ARCHIMED", 2023-11-27; YesPress Instem profile (take-private value £203M). https://www.businesswire.com/news/home/20231127890042/en ; https://yespress.io/instem (P-co; S)
32. Instem/Business Wire, "Instem acquires all shares of Xybion", 2025-07-31. https://www.businesswire.com/news/home/20250731315741/en (P-co)
33. Instem, SEND solutions, SEND Advantage services and EUROTOX 2026 pages. https://www.instem.com/solutions/submit/send-solutions.php ; https://instem.com/?p=247743 ; https://www.instem.com/events/60th-congress-of-the-european-societies-of-toxicology-eurotox-2/ (P-co)
34. Instem, "The SEND Traffic Jam", undated. https://www.instem.com/the-send-traffic-jam (P-co/SOFT)
35. Benchling, "Introducing Benchling AI", 2025-10-07. https://www.benchling.com/news/introducing-benchling-ai (P-co)
36. SynBioBeta, "Benchling launches three products during SynBioBeta 2026", 2026-05. https://www.synbiobeta.com/read/benchling-launches-three-products-during-synbiobeta-2026-%E2%80%94-and-its-head-of-ai-hints-at-what-comes-next (S)
37. Benchling, In Vivo product page. https://www.benchling.com/in-vivo (P-co)
38. Sacra, "Benchling: the $210M/year GitHub of biotech" (estimate). https://sacra.com/research/benchling-github-of-biotech (SOFT)
39. CB Insights, TetraScience financials (aggregator). https://www.cbinsights.com/company/tetrascience/financials (SOFT)
40. Veeva Systems, "Veeva Basics adopted by more than 100 emerging biotechs", 2025-11-04. https://tools.prnewswire.com/en-us/live/20813/release/20251104EN14296 (P-co)
41. Scientist.com/Business Wire, GHO acquisition closing, 2025-11-20; Digital Commerce 360, 2025-11-06; Inc., 2018 (supplier fee). https://www.businesswire.com/news/home/20251120289047/en ; https://www.digitalcommerce360.com/2025/11/06/scientist-com-acquisition-ai-driven-rd-procurement/ ; https://www.inc.com/michelle-cheng/2018-inc5000-scientist-drug-research.html (P-co; S; SOFT)
42. Fast Company, "Emerald Cloud Lab: Most Innovative Companies 2024", 2024. https://www.fastcompany.com/91035186/emerald-cloud-lab-most-innovative-companies-2024 (S)
43. Strateos/Business Wire, "Strategic shift to on-site cloud labs", 2023-04-18; Fierce Biotech, "Eli Lilly sells science studio lab to Arctoris". https://www.businesswire.com/news/home/20230418006219/en/Strateos-Announces-Strategic-Shift-to-Focus-on-Customer-Demand-for-On-Site-Cloud-Labs ; https://www.fiercebiotech.com/cro/eli-lilly-sells-science-studio-lab-arctoris-moving-automation-platform-san-diego-oxford (P-co; S)
44. Ginkgo Bioworks, "Launches ADME profiling service" (repost), 2025-07-17; Ginkgo Datapoints / Tangible / Inductive "ADME-One" press release, 2026-05-26. https://www.stocktitan.net/news/DNA/ginkgo-bioworks-launches-adme-profiling-service-using-lab-automation-cbexbi3e54ux.html ; https://s28.q4cdn.com/823357996/files/doc_news/2026/May/26/ADME-One-Press-Release-2026-05-26.pdf (P-co)
45. Tiger Brokers, "Recursion Q2 2026 earnings", 2026-08. https://www.itiger.com/news/2657413541 (S)
46. Reuters via Yahoo Finance, "AI lab Lila Sciences tops $1.3 billion valuation", 2025-10; Bloomberg Law, "Lila Sciences said in talks... $8.5 billion valuation", 2026-06. https://finance.yahoo.com/news/exclusive-ai-lab-lila-sciences-101645837.html ; https://news.bloomberglaw.com/private-equity/lila-sciences-said-in-talks-for-funds-at-8-5-billion-valuation (S; SOFT for Series B)
47. Maginative, "Periodic Labs launches with $300M", 2025-09/10. https://www.maginative.com/periodic-labs-launches-with-300m-to-build-an-ai-scientist (S)
48. Amplify Partners, Axiom investment post; BiopharmaTrend (seed; liver tox dataset); Dealroom (per-compound cost). https://amplifypartners.com/blog-posts/eliminating-drug-toxicity-with-ai-our-investment-in-axiom ; https://www.biopharmatrend.com/news/axiom-bio-seed-funding-ai-drug-toxicity-1219/ ; https://www.biopharmatrend.com/news/axiom-bio-releases-human-liver-toxicity-dataset-with-130000-compounds-to-advance-ai-based-toxicity-prediction-1299/ ; https://app.dealroom.co/companies/axiom_bio (S; SOFT for cost)
49. Inductive Bio, "Raises $25M Series A", 2025-05. https://www.inductive.bio/news/inductive-bio-raises-25m-series-a (P-co)
50. BiopharmaTrend, "Tamarind Bio raises $13.6M", 2026-02. https://www.biopharmatrend.com/news/tamarind-bio-raises-136m-to-run-200-ai-and-simulation-models-in-a-no-code-platform-for-bench-scientists-1505/ (S)
51. SiliconANGLE, "Medra raises $52M", 2025-12-11. https://siliconangle.com/2025/12/11/medra-developer-ai-powered-lab-robots-scientists-advance-drug-discovery-raises-52m/ (S)
52. GeekWire, "Potato lands $4.5M", 2025-04; Draper Associates newsroom. https://geekwire.com/2025/startup-aiming-to-revolutionize-research-with-fully-automated-science-experimentation-lands-4-5m/ ; https://www.draper.vc/newsroom/draper-associates-leads-potato-seed (S; P-co)
53. VCA Online, "Weave Bio secures $20M Series A", 2025-10-16; Parexel newsroom, "AI partnership with Weave Bio", 2025-09. https://www.vcaonline.com/news/2025101603/weave-bio-secures-20m-series-a-funding-to-enhance-its-ai-native-regulatory-platform/ ; https://newsroom.parexel.com/news-releases/news-release-details/parexel-announces-ai-partnership-weave-bio-accelerate-regulatory (S; P-co)
54. Vivodyne/Business Wire, Series A, 2025-05-28. https://www.businesswire.com/news/home/20250528498236/en (P-co)
55. Tremont AI/Business Wire, "Emerges from stealth", 2026-09-29. https://www.financialcontent.com/article/bizwire-2026-9-29-tremont-ai-emerges-from-stealth-to-bring-multimodal-ai-to-preclinical-drug-safety (P-co)
56. Fierce Biotech, "Quris completes $28 million seed", 2022-01. https://www.fiercebiotech.com/cro/ai-discovery-tech-firm-quris-completes-28-million-seed-funding-round (S)
57. BioSpace, "Arctoris secures £3.2M seed", 2019-09. https://www.biospace.com/arctoris-ltd-secures-seed-funding-of-3-2-million-to-advance-novel-drug-discovery-platform-powered-by-robotics (S)
58. U.S. FDA, "IND Receipts" (content current as of 2026-08-20) and CDER Drug and Non-Biosimilar Biologic IND Receipts PDFs: CY2025 https://www.fda.gov/media/191373/download ; CY2024 https://www.fda.gov/media/185466/download ; CY2023 https://www.fda.gov/media/176488/download ; CY2022 https://www.fda.gov/media/164995/download ; CY2021 https://www.fda.gov/media/158147/download ; CY2020 https://www.fda.gov/media/147396/download ; CY2019 https://www.fda.gov/media/135165/download ; CY2016 https://www.fda.gov/media/103032/download ; Biosimilar CY2025 https://www.fda.gov/media/194373/download ; index https://www.fda.gov/drugs/ind-activity/ind-receipts (P)
59. IQVIA Institute, "Global Trends in R&D 2026", 2026-03-25. https://www.iqvia.com/insights/the-iqvia-institute/reports-and-publications/reports/global-r-and-d-trends-2026 (S)
60. IQVIA, press release on 2021 pipeline (emerging biopharma 65%), 2022-02-10. https://iqvia.com/newsroom/2022/02/pharma-rd-pipeline-and-new-product-launches-reach-record-levels-in-2021-according-to-new-iqvia-insti (S)
61. GxP News, "Pharma R&D pipeline hits plateau... Citeline report finds", 2026-04; Citeline Pharma R&D Annual Review 2026 page. https://gxpnews.net/en/2026/04/pharma-rd-pipeline-hits-plateau-after-decades-of-growth-citeline-report-finds/?amp=1 ; https://www.citeline.com/en/rd26-cog (S)
62. BioSpace, "Early-stage biotechs suffer in 2025 as VC shuns risk: PitchBook", 2026. https://www.biospace.com/business/early-stage-biotechs-suffer-in-2025-as-vc-shuns-risk-pitchbook (S)
63. BioPharma Dive, "Biotech venture funding H1 2025 (HSBC)", 2025-07. https://www.biopharmadive.com/news/biotech-venture-capital-funding-h1-2025-hsbc/753283/ (S)
64. BioCentury, Series A 2025 review. https://www.biocentury.com/article/658218 (S/SOFT, paywalled excerpt)
65. Paul SM, Mytelka DS, Dunwiddie CT, et al. "How to improve R&D productivity: the pharmaceutical industry's grand challenge." *Nat Rev Drug Discov* 2010;9:203–214. doi:10.1038/nrd3078. https://www.nature.com/articles/nrd3078 (P, peer-reviewed; Figure 2 and Figure 3 read from full text)
66. DiMasi JA, Grabowski HG, Hansen RW. "Innovation in the pharmaceutical industry: New estimates of R&D costs." *J Health Econ* 2016;47:20–33. doi:10.1016/j.jhealeco.2016.01.012. https://ideas.repec.org/a/eee/jhecon/v47y2016icp20-33.html (P, peer-reviewed; headline figures only)
67. Sertkaya A, et al. "Costs of drug development and research and development intensity in the US, 2000–2018." *JAMA Netw Open* 2024;7(6):e2415445 (headline via HealthDay). https://www.healthday.com/healthpro-news/general-health/mean-cost-of-bringing-new-drug-to-us-market-is-8793-million (P via S; nonclinical-phase detail not found)
68. Non-peer-reviewed IND-enabling cost guides: Regfo, "IND-Enabling Studies: Timeline, Cost..."; BioMarkets.io guide; Assyro guide (Oct 2026). https://regfo.com/blog/ind-enabling-studies-timeline-cost-guide ; https://biomarkets.io/learn/ind-enabling-studies-guide ; https://www.assyro.com/blog/ind-enabling-studies (SOFT)
69. Larson J, "In Vitro and In Vivo Toxicology" slides, Gulf Coast Consortia (uploaded 2023-10). https://www.gulfcoastconsortia.org/wp-content/uploads/2023/10/Jeff-Larson-In-Vitro-and-In-Vivo-Toxicology.pdf (SOFT)
70. NCI SBIR, 2021–22 Investor Initiatives Showcase companies. https://sbir.cancer.gov/commercialization/business/investor-initiatives/21-22-showcase-companies (S)
71. Syngene, "IND-enabling safety tox studies for FDA submission in just 9 months" (case study). https://www.syngeneintl.com/resources/case-study/ind-enabling-safety-tox-studies-for-fda-submission-in-just-9-months/ (P-co)
72. U.S. FDA, "FDA Announces Plan to Phase Out Animal Testing Requirement for Monoclonal Antibodies and Other Drugs", 2025-04-10. https://www.fda.gov/news-events/press-announcements/fda-announces-plan-phase-out-animal-testing-requirement-monoclonal-antibodies-and-other-drugs (P)
73. U.S. FDA, "Roadmap to Reducing Animal Testing in Preclinical Safety Studies", 2025-04. https://www.fda.gov/files/newsroom/published/roadmap_to_reducing_animal_testing_in_preclinical_safety_studies.pdf (P)
74. U.S. FDA, "FDA Releases Draft Guidance on Reducing Testing on Non-Human Primates for Monoclonal Antibodies", 2025-12-02. https://www.fda.gov/news-events/press-announcements/fda-releases-draft-guidance-reducing-testing-non-human-primates-monoclonal-antibodies (P)
75. U.S. FDA, "FDA Releases Draft Guidance on Alternatives to Animal Testing in Drug Development", 2026-03-18. https://www.fda.gov/news-events/press-announcements/fda-releases-draft-guidance-alternatives-animal-testing-drug-development (P)
76. U.S. FDA, "FDA Achieves Year 1 Goals in Reducing Animal Testing in Drug Development", 2026-04-20. https://www.fda.gov/news-events/press-announcements/fda-achieves-year-1-goals-reducing-animal-testing-drug-development (P)
77. U.S. FDA, "Reducing Animal Testing in Nonclinical Studies: Year One Progress and the Path Forward", April 2026. https://www.fda.gov/media/191986/download (P)
78. S.5002 (117th Congress), FDA Modernization Act 2.0, bill text (enacted as §3209, Pub. L. 117-328); CASRAI explainer. https://www.congress.gov/117/bills/s5002/BILLS-117s5002cps.htm ; https://www.casrai.org/guides/fda-modernization-act-2-0-animal-testing (P; S)
79. Congress.gov, S.355 and H.R.2821 (119th Congress), FDA Modernization Act 3.0; engrossed House text; GovTrack; Floridian Press (House passage), 2026-07. https://www.congress.gov/bill/119th-congress/senate-bill/355 ; https://www.congress.gov/bill/119th-congress/house-bill/2821 ; https://www.govinfo.gov/content/pkg/BILLS-119hr2821eh/html/BILLS-119hr2821eh.htm ; https://www.govtrack.us/congress/bills/119/s355 ; https://floridianpress.com/2026/07/rep-buchanan-celebrates-passing-of-bill-cracking-down-on-animal-testing/ (P; S)
80. U.S. FDA, "Study Data Technical Conformance Guide – Technical Specifications Document", October 2026 (v6.3), final; page content current as of 2026-10-08. https://www.fda.gov/regulatory-information/search-fda-guidance-documents/study-data-technical-conformance-guide-technical-specifications-document ; PDF https://www.fda.gov/media/153632/download (P)
81. 21 CFR 58.1, 58.185 and 11.1 (eCFR returned a redirect; read via Cornell LII mirror). https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-58 ; https://www.law.cornell.edu/cfr/text/21/58.1 ; https://www.law.cornell.edu/cfr/text/21/58.185 ; https://www.law.cornell.edu/cfr/text/21/11.1 (P)
82. Arnold & Porter, "FDA Proposes Important Revisions to Good Laboratory Practice Regulations", 2016-08. https://www.arnoldporter.com/en/perspectives/advisories/2016/08/fda-proposes-important-revisions-to-good (S)
83. U.S. FDA, draft guidance "Considerations for the Use of Artificial Intelligence to Support Regulatory Decision-Making for Drug and Biological Products", January 2025, docket FDA-2024-D-4689; guidance page; PDF; Federal Register notice 2025-01-07. https://www.fda.gov/regulatory-information/search-fda-guidance-documents/considerations-use-artificial-intelligence-support-regulatory-decision-making-drug-and-biological ; https://www.fda.gov/media/184830/download ; https://govinfo.gov/content/pkg/FR-2025-01-07/html/2024-31542.htm (P)
84. U.S. FDA, "Guiding Principles of Good AI Practice in Drug Development" (with EMA), January 2026; EMA news release. https://www.fda.gov/about-fda/artificial-intelligence-drug-development/guiding-principles-good-ai-practice-drug-development ; https://www.ema.europa.eu/es/news/ema-fda-set-common-principles-ai-medicine-development-0 (P)
85. U.S. FDA / ICH, "M3(R2) Nonclinical Safety Studies for the Conduct of Human Clinical Trials and Marketing Authorization for Pharmaceuticals", January 2010. https://www.fda.gov/media/71542/download (P)
86. Latham & Watkins, "BIOSECURE Act Becomes Law...", 2025-12; Arnold & Porter, "National Security Controls and the Life Sciences Sector", 2026-06-16. https://www.lw.com/admin/upload/SiteAttachments/BIOSECURE-Act-Becomes-Law-Limiting-Grants-With-Biotechnology-Companies-of-Concern.pdf ; https://www.arnoldporter.com/en/perspectives/advisories/2026/06/national-security-controls-and-the-life-sciences-sector (S)
87. Altasciences / Biopharma Dive (studioID), "One integrated solution" playbook reporting the Altasciences/Biopharma Dive Pulse Survey (John Gilfether & Associates, October 2021; n>143), published 2022-04. https://canada.altasciences.com/sites/default/files/2022-04/Biopharma-Dive-Playbook_One-integrated-solution_web.pdf (S, vendor-sponsored)
88. Dotmatics / C&EN BrandLab, "CRO outsourcing in early small-molecule drug discovery" survey page (undated). https://dotmatics.com/whitepapers/cro-outsourcing-early-small-molecule-drug-discovery (S, vendor-commissioned)
89. Veeda Lifesciences, "Clinical Research Organization (CRO) Market Report", January 2022. https://veedalifesciences.com/wp-content/uploads/2024/12/CLINICAL-RESEARCH-ORGANIZATION-CRO-MARKET-REPORT.pdf (SOFT)
90. Anzai T, et al. "Establishment of the Global SEND Alliance (G-SEND) in Japan and efficient creation of electronic SEND datasets between CROs." *J Toxicol Pathol* 2019;32(2):119–126. https://pmc.ncbi.nlm.nih.gov/articles/PMC6511540 (P, peer-reviewed)
91. Preclinical CRO market estimates: Towards Healthcare/Precedence via GlobeNewswire, 2025-07-16; Coherent Market Insights via Barchart; Market Research Future. https://www.globenewswire.com/news-release/2025/07/16/3116561/0/en/Preclinical-CRO-Market-Size-at-USD-6-8-Billion-in-2025-Forecasted-to-Grow-at-8-73-CAGR-Through-2034.html ; https://www.barchart.com/story/news/32831764/preclinical-cro-market-to-hit-usd-1221-billion-by-2032-with-882-cagr ; https://www.marketresearchfuture.com/fr/reports/preclinical-cro-market-7274 (S)
92. Bioanalytical testing services: Grand View Research; Global Market Insights; Towards Healthcare. https://grandviewresearch.com/industry-analysis/bioanalytical-testing-services-market ; https://www.gminsights.com/industry-analysis/bioanalytical-testing-services-market ; https://www.towardshealthcare.com/insights/bioanalytical-testing-services-market-sizing (S)
93. ADME-tox testing: Roots Analysis; SNS Insider; IMARC; Expert Market Research. https://www.rootsanalysis.com/reports/adme-toxicology-testing-market/239.html ; https://www.snsinsider.com/press-release/global-adme-toxicology-testing-market ; https://www.imarcgroup.com/global-adme-toxicology-testing-market ; https://www.expertmarketresearch.com/es/reports/adme-toxicology-testing-market (S)
94. Toxicology testing: Value Market Research via GII Korea; MarketsandMarkets in vitro toxicology. https://giikorea.co.kr/report/vmr1977873-global-toxicology-testing-services-market-size.html ; https://www.marketsandmarkets.com/PressReleases/in-vitro-toxicology-testing.asp (S/SOFT)
95. Lab informatics, LIMS, ELN: Towards Healthcare; IMARC; MarketsandMarkets LIMS; MarketsandMarkets ELN; SNS Insider ELN. https://www.towardshealthcare.com/insights/laboratory-informatics-market-sizing ; https://www.imarcgroup.com/laboratory-informatics-market ; https://www.marketsandmarkets.com/Market-Reports/laboratory-information-management-systems-market-250610373.html ; https://www.marketsandmarkets.com/PressReleases/electronic-lab-notebook.asp ; https://www.snsinsider.com/press-release/global-electronic-lab-notebook-market (S)
96. AI in drug discovery: Precedence Research via BioSpace; IMARC; Towards Healthcare. https://www.biospace.com/press-releases/ai-in-drug-discovery-market-size-to-worth-usd-16-52-bn-by-2034 ; https://www.imarcgroup.com/report/en/ai-in-drug-discovery-market ; https://www.towardshealthcare.com/insights/artificial-intelligence-in-drug-discovery (S/SOFT)
97. South China Morning Post, "China's lab monkey prices hit Covid-era highs", 2026. https://www.scmp.com/news/china/science/article/3360770/chinas-lab-monkey-prices-hit-covid-era-highs-new-drug-rd-demand (S)
98. 21 CFR 312.40(b) and 312.23(a)(8) (Cornell LII). https://www.law.cornell.edu/cfr/text/21/312.40 ; https://www.law.cornell.edu/cfr/text/21/312.23 (P)
99. (reserved; Lilly TuneLab participation is cited from [2])
100. Fierce Biotech, "Charles River announces cost cutting and strategic shift as revenue slide continues", 2025-11. https://www.fiercebiotech.com/cro/charles-river-announces-cost-cutting-and-strategic-shift-revenue-slide-continues (S)
