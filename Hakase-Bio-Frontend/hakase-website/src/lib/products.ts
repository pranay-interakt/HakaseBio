export type Product = {
  slug: string;
  name: string;
  short: string;          // 2-3 word category
  market: string;
  oneLiner: string;       // ≤14 words
  description: string;    // 2 sentences max
  capabilities: { title: string; body: string }[];
  metrics: { value: string; label: string; sub?: string }[];
  layers?: { code: string; name: string; body: string }[];
  customers?: string[];
};

export const PRODUCTS: Product[] = [
  {
    slug: "bio",
    name: "Hakase Bio",
    short: "Pre-clinical · BioDigital Twin",
    market: "Biotech & Pharma R&D · Discovery → IND",
    oneLiner: "A zero-lab cascade from target to organism.",
    description:
      "Hakase Bio fuses cellular simulation, structural prediction, and whole-body PBPK into a single BioDigital Twin. Hypotheses are screened, ranked, and paired with a falsifier before a single well is plated.",
    capabilities: [
      { title: "Cellular AI Simulation",     body: "Single-cell foundation models with scVI-integrated references, mechanistic perturbation cascades, and pathway-aware priors." },
      { title: "Structural × Tissue Gate",   body: "Proteina / Boltz structures gated by tissue-level expression and proteomics — predictions only progress where biology supports them." },
      { title: "Organism PBPK",              body: "Whole-body PK/PD with IVIVE translation, first-in-human dose priors and species-bridging." },
      { title: "Predict-then-confirm",       body: "Every prediction ships with a falsifier and a confirmation slot. Wet-lab readouts close the loop automatically." }
    ],
    metrics: [
      { value: "10×",  label: "Hypotheses screened",  sub: "per FTE / week" },
      { value: "−65%", label: "Wet-lab cycles to lead" },
      { value: "92%",  label: "Cross-assay accuracy",  sub: "vs. held-out CROs" }
    ],
    layers: [
      { code: "L1", name: "Cellular",   body: "Single-cell foundation models and pathway-aware perturbation simulation." },
      { code: "L2", name: "Structural", body: "Proteina-Complexa structures, binder design, ESM-3 retrieval, tissue gating." },
      { code: "L3", name: "Organism",   body: "PBPK + IVIVE translation engines for first-in-human dosing and species bridging." }
    ]
  },
  {
    slug: "clinical",
    name: "Hakase Clinical",
    short: "Phase 2 → Phase 4 operations",
    market: "Clinical Trial Sponsors · CROs",
    oneLiner: "Trial operations on a falsifier-first control plane.",
    description:
      "Hakase Clinical runs protocol intelligence, site and cohort optimization, and continuous safety signal detection over 400K+ CT.gov records and 20M+ FAERS reports. Every output is gated, auditable, and tied to a confirmation.",
    capabilities: [
      { title: "Protocol Intelligence",  body: "Compare 400,000+ CT.gov protocols by endpoint, dose, eligibility, and adaptive design — with completion-rate benchmarks." },
      { title: "Monte Carlo Enrollment", body: "1,000-iteration stochastic simulation delivering P10 / P50 / P90 enrollment timelines from real completed-trial data." },
      { title: "Site Intelligence",      body: "Global investigator and site ranking by enrollment velocity, startup history, and therapeutic-area experience." },
      { title: "PRR / ROR Safety Signals", body: "Pharmacovigilance-grade detection from 20M+ FAERS reports using the Evans 2001 WHO methodology, automatically." },
      { title: "Evidence Library",       body: "Full-text PubMed search across 36M+ articles with RCT classification, author-level KOL ranking, and abstract summaries." },
      { title: "ML Outcome Prediction",  body: "Gradient-boosted ensemble trained on the full CTGov corpus — GO / NO-GO recommendation with calibrated confidence." }
    ],
    metrics: [
      { value: "40%",     label: "Faster trial cycles", sub: "median across sponsors" },
      { value: "$2.1M",   label: "Annual cost savings", sub: "per Phase 2/3 program" },
      { value: "400K+",   label: "CT.gov protocols",    sub: "indexed and gated" }
    ]
  },
  {
    slug: "commz",
    name: "Hakase Commz",
    short: "Commercial intelligence",
    market: "Launch & market access teams",
    oneLiner: "Launch-to-uptake intelligence, refreshed weekly.",
    description:
      "Account-level scoring across payers, IDNs and KOL networks. Behavioral models for prescriber adoption and access friction, with next-best-action playbooks per territory.",
    capabilities: [
      { title: "Launch Readiness",        body: "Account-level scoring across payers, IDNs, GPOs and KOL networks. Refreshed weekly, not yearly." },
      { title: "HCP & Payer Modeling",    body: "Behavioral models for prescriber adoption and access friction, calibrated against open Medicare and commercial claims." },
      { title: "Field-Force Orchestration", body: "Next-best-action playbooks per territory, with explanations rep teams will actually read." },
      { title: "Evidence Activation",     body: "Auto-generated payer dossiers and KOL talking points from real-world data — every claim traced to source." }
    ],
    metrics: [
      { value: "3×",   label: "Faster account prioritization" },
      { value: "+18%", label: "Year-1 uptake vs. consensus" },
      { value: "60d",  label: "Data lake to field-ready" }
    ]
  },
  {
    slug: "care",
    name: "Hakase Care",
    short: "Care delivery platform",
    market: "Hospitals · Health systems · Payers",
    oneLiner: "From bedside care to evidence packs, without a translation tax.",
    description:
      "Hakase Care closes the loop between care delivery and the evidence regulators and payers need. Quality, outcomes, pathway analytics, and federated real-world evidence — tenant-isolated by default.",
    capabilities: [
      { title: "Quality & Outcomes",          body: "Disease-area dashboards aligned to CMS, HEDIS and NHS QOF frameworks." },
      { title: "Cohort & Pathway Analytics",  body: "Care-pathway mining over MIMIC, HCUP, NHS Digital and tenant EHRs with cohort-builder semantics." },
      { title: "Real-World Evidence",         body: "Federated cohort matching for label expansion, HEOR, and post-marketing commitments." },
      { title: "Patient Retention",           body: "Risk stratification with confirmation-tracked interventions and outcome attribution." }
    ],
    metrics: [
      { value: "85%",     label: "Patient retention",     sub: "avg. across deployments" },
      { value: "12+",     label: "Disease areas",         sub: "pre-modeled" },
      { value: "HIPAA·GDPR", label: "Tenant-isolated",    sub: "privacy-first defaults" }
    ]
  },
  {
    slug: "regdoks",
    name: "Hakase Regdoks",
    short: "Regulatory submissions",
    market: "Regulatory affairs · GCC · FDA · EMA · PMDA",
    oneLiner: "Submission-ready dossiers, composed from the same falsifier registry.",
    description:
      "Module-aware CTD/eCTD assembly across four agencies. V&V40 and MID3 evidence packs auto-composed, with cross-link traceability between models, data and conclusions.",
    capabilities: [
      { title: "Dossier Assembly",      body: "Module-aware CTD/eCTD assembly with cross-link traceability between every model, dataset and conclusion." },
      { title: "V&V40 / MID3 Evidence", body: "Credibility evidence packs auto-generated for model-informed submissions — context of use, ROU, V&V plan." },
      { title: "Multi-Agency Mapping",  body: "A single source of truth mapped to GCC, FDA, EMA and PMDA expectations, with diff views per agency." },
      { title: "Signed Audit Trail",    body: "Every prediction → confirmation pairing is signed, versioned, and exportable for regulator review." }
    ],
    metrics: [
      { value: "9 mo → 9 wk", label: "Dossier assembly cycle" },
      { value: "100%",        label: "Predictions tied to falsifier" },
      { value: "4",           label: "Agencies pre-mapped", sub: "GCC · FDA · EMA · PMDA" }
    ]
  }
];

export const getProduct = (slug: string) => PRODUCTS.find((p) => p.slug === slug);
