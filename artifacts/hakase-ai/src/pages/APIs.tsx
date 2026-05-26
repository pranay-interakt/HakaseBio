import { NavBar } from "@/components/NavBar";
import { useLocation } from "wouter";

type APIStatus = "live" | "beta" | "reference";

interface APIEntry {
  name: string;
  provider: string;
  endpoint: string;
  status: APIStatus;
  category: string;
  color: "violet" | "blue" | "emerald" | "amber" | "rose" | "slate";
  description: string;
  usedFor: string[];
  docsUrl: string;
  rateLimit?: string;
  auth: string;
}

interface DBEntry {
  name: string;
  provider: string;
  type: string;
  color: "violet" | "blue" | "emerald" | "amber" | "rose" | "slate";
  description: string;
  dataPoints: string;
  usedFor: string[];
  url: string;
  license: string;
  updateFreq: string;
}

interface EngineEntry {
  name: string;
  color: "violet" | "blue" | "emerald" | "amber";
  description: string;
  capabilities: string[];
  layer: string;
}

const APIS: APIEntry[] = [
  {
    name: "ChEMBL REST API",
    provider: "European Bioinformatics Institute (EBI)",
    endpoint: "https://www.ebi.ac.uk/chembl/api/data/",
    status: "live",
    category: "Cheminformatics",
    color: "violet",
    description: "The world's largest manually curated database of bioactive drug-like molecules with ADMET properties, binding affinities, and clinical data.",
    usedFor: ["Compound lookup by ChEMBL ID or name", "Bioactivity data (IC50, Ki, EC50, Kd)", "Molecular property retrieval (MW, LogP, TPSA, HBD, HBA)", "Cross-reference to clinical trial status"],
    docsUrl: "https://www.ebi.ac.uk/chembl/api/data/docs",
    rateLimit: "Unlimited (fair use)",
    auth: "None — Public API",
  },
  {
    name: "PubChem PUG REST API",
    provider: "National Center for Biotechnology Information (NCBI/NIH)",
    endpoint: "https://pubchem.ncbi.nlm.nih.gov/rest/pug/",
    status: "live",
    category: "Cheminformatics",
    color: "blue",
    description: "NIH's open chemistry database covering over 100 million compounds with computed molecular descriptors, synonyms, and biological activities.",
    usedFor: ["Compound name to CID resolution", "Molecular descriptor retrieval (LogP, TPSA, MolFormula, MolWeight)", "Fallback source when ChEMBL is unavailable", "CAS / SMILES / InChI cross-reference"],
    docsUrl: "https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest",
    rateLimit: "5 requests/sec",
    auth: "None — Public API",
  },
  {
    name: "UniChem Cross-Reference API",
    provider: "European Bioinformatics Institute (EBI)",
    endpoint: "https://www.ebi.ac.uk/unichem/rest/",
    status: "live",
    category: "Cheminformatics",
    color: "violet",
    description: "Unified chemical identifier mapping service linking compound IDs across ChEMBL, PubChem, DrugBank, ZINC, and 40+ other databases.",
    usedFor: ["ChEMBL ID → PubChem CID bridging", "Cross-database identifier resolution", "Compound lookup when only one database ID is known"],
    docsUrl: "https://www.ebi.ac.uk/unichem/rest/",
    rateLimit: "Unlimited (fair use)",
    auth: "None — Public API",
  },
  {
    name: "ZINC22 REST API",
    provider: "Irwin & Shoichet Laboratories, UCSF",
    endpoint: "https://cartblanche22.docking.org/",
    status: "live",
    category: "Cheminformatics",
    color: "emerald",
    description: "Curated database of commercially available compounds for virtual screening and docking, with purchasability and 3D structure data.",
    usedFor: ["ZINC ID compound lookup", "Purchasability and vendor information", "3D conformer and SMILES retrieval for docking workflows"],
    docsUrl: "https://cartblanche22.docking.org/",
    rateLimit: "Unlimited (fair use)",
    auth: "None — Public API",
  },
  {
    name: "UniProt REST API",
    provider: "Universal Protein Resource (EBI / ExPASy / PIR)",
    endpoint: "https://rest.uniprot.org/uniprotkb/",
    status: "live",
    category: "Proteomics",
    color: "blue",
    description: "The world's most comprehensive, high-quality protein sequence and functional information resource, with over 220 million entries.",
    usedFor: ["Target protein lookup by UniProt accession", "Gene name, organism, and function metadata", "Associated PDB structure IDs", "Subcellular localisation and tissue expression data"],
    docsUrl: "https://www.uniprot.org/help/api",
    rateLimit: "Unlimited (fair use)",
    auth: "None — Public API",
  },
  {
    name: "RCSB Protein Data Bank API",
    provider: "Research Collaboratory for Structural Bioinformatics (RCSB)",
    endpoint: "https://data.rcsb.org/rest/v1/core/",
    status: "live",
    category: "Structural Biology",
    color: "amber",
    description: "The primary repository for experimentally determined 3D macromolecular structure data, including crystal structures, cryo-EM, and NMR data.",
    usedFor: ["PDB entry metadata (resolution, method, deposited ligands)", "Bound ligand and co-crystal structure information", "Experimental validation data", "Cross-reference to UniProt targets"],
    docsUrl: "https://data.rcsb.org/",
    rateLimit: "Unlimited (fair use)",
    auth: "None — Public API",
  },
  {
    name: "AlphaFold Protein Structure API",
    provider: "DeepMind / EMBL-EBI",
    endpoint: "https://alphafold.ebi.ac.uk/api/prediction/",
    status: "live",
    category: "Structural Biology",
    color: "violet",
    description: "AI-predicted protein structures for over 200 million proteins covering the entire UniProt reference proteome, with per-residue confidence scores (pLDDT).",
    usedFor: ["Predicted 3D structure retrieval when no crystal structure exists", "Per-residue confidence (pLDDT) scoring", ".pdb and .cif file download for visualization", "Target druggability assessment"],
    docsUrl: "https://alphafold.ebi.ac.uk/api-docs",
    rateLimit: "Unlimited (fair use)",
    auth: "None — Public API",
  },
  {
    name: "openFDA FAERS Event API",
    provider: "U.S. Food and Drug Administration (FDA)",
    endpoint: "https://api.fda.gov/drug/event.json",
    status: "live",
    category: "Pharmacovigilance",
    color: "rose",
    description: "FDA Adverse Event Reporting System (FAERS) containing over 20 million adverse event reports submitted by healthcare professionals and patients.",
    usedFor: ["Real adverse event signal frequencies by drug name", "Reaction term counts (MedDRA terms)", "Proportional Reporting Ratio (PRR) calibration", "Comparator adverse event profiling for similar approved drugs"],
    docsUrl: "https://open.fda.gov/apis/drug/event/",
    rateLimit: "240 requests/min (no API key)",
    auth: "None — Public API (API key optional for higher limits)",
  },
  {
    name: "openFDA Drugs@FDA API",
    provider: "U.S. Food and Drug Administration (FDA)",
    endpoint: "https://api.fda.gov/drug/drugsfda.json",
    status: "live",
    category: "Regulatory",
    color: "rose",
    description: "Searchable catalog of FDA-approved drug products including NDA/BLA/ANDA submissions, approval dates, and application type history.",
    usedFor: ["NDA / BLA / ANDA approval status lookup", "Approval date and sponsor information", "Application type (505(b)(1), 505(b)(2)) classification", "Reference listed drug identification"],
    docsUrl: "https://open.fda.gov/apis/drug/drugsfda/",
    rateLimit: "240 requests/min",
    auth: "None — Public API",
  },
  {
    name: "openFDA Drug Label API",
    provider: "U.S. Food and Drug Administration (FDA)",
    endpoint: "https://api.fda.gov/drug/label.json",
    status: "live",
    category: "Regulatory",
    color: "rose",
    description: "Structured product labelling (SPL) data for FDA-approved drugs, including full prescribing information, warnings, contraindications, and dosing.",
    usedFor: ["Official prescribing information retrieval", "Black box warning text", "Indicated population and dosing regimen", "Contraindication and drug interaction sections"],
    docsUrl: "https://open.fda.gov/apis/drug/label/",
    rateLimit: "240 requests/min",
    auth: "None — Public API",
  },
];

const DATABASES: DBEntry[] = [
  {
    name: "NHANES Population Statistics",
    provider: "Centers for Disease Control and Prevention (CDC)",
    type: "Clinical / Epidemiological",
    color: "blue",
    description: "Published summary statistics from the National Health and Nutrition Examination Survey 2017–2020 Pre-Pandemic cycle. Used as a human reference distribution for L3 → L4 allometric scaling and FIH dose bracketing — not for cohort fabrication.",
    dataPoints: "~15,000 U.S. participants, 2017–2020",
    usedFor: ["Human reference physiology for allometric scaling (BW, eGFR, ALT, albumin)", "PBPK parameter scaling from animal species → human-equivalent dose", "Reference renal/hepatic function distribution for FIH dose bracketing", "Subgroup descriptors (sex, BMI, age) for IND clinical-pharmacology package"],
    url: "https://wwwn.cdc.gov/nchs/nhanes/",
    license: "Public domain — U.S. Government data",
    updateFreq: "Biennial survey cycles",
  },
  {
    name: "ChEMBL Bioactivity Database",
    provider: "European Bioinformatics Institute (EBI)",
    type: "Cheminformatics / Pharmacology",
    color: "violet",
    description: "The manually curated, open-access database of bioactive drug-like molecules with binding affinities, ADMET data, and drug mechanism information — referenced as a local parameter set for PD modeling.",
    dataPoints: "2.4M+ compounds, 19M+ bioactivity datapoints",
    usedFor: ["Pharmacodynamic parameter initialisation (Emax, EC50, Hill coefficient)", "Similar drug identification for adverse event comparators", "Target selectivity ratio estimation (CDK4 vs CDK6 vs CDK2)", "Resistance mechanism parameter lookup"],
    url: "https://www.ebi.ac.uk/chembl/",
    license: "Creative Commons Attribution-ShareAlike 3.0",
    updateFreq: "Major release 2–3× per year",
  },
  {
    name: "FDA FAERS Database",
    provider: "U.S. Food and Drug Administration (FDA)",
    type: "Pharmacovigilance",
    color: "rose",
    description: "The complete FAERS post-market adverse event surveillance dataset, queried live via openFDA to calibrate simulated adverse event signal rates against real-world reporting frequencies.",
    dataPoints: "20M+ adverse event reports (1968–present)",
    usedFor: ["Adverse event signal calibration for candidate drugs", "Comparator drug toxicity benchmarking (palbociclib, ribociclib)", "MedDRA reaction term frequency tables", "Grade 3+ adverse event rate estimation"],
    url: "https://www.fda.gov/drugs/questions-and-answers-fdas-adverse-event-reporting-system-faers",
    license: "Public domain — U.S. Government data",
    updateFreq: "Quarterly",
  },
  {
    name: "Protein Data Bank (RCSB PDB)",
    provider: "RCSB / wwPDB Consortium",
    type: "Structural Biology",
    color: "amber",
    description: "The global archive for experimentally determined three-dimensional structures of biological macromolecules, used as the reference source for target protein structure metadata.",
    dataPoints: "220,000+ deposited structures",
    usedFor: ["Target crystal structure resolution and method metadata", "Co-crystallised inhibitor binding mode information", "Structure quality indicators (R-factor, resolution)", "Comparison to AlphaFold predicted structures"],
    url: "https://www.rcsb.org/",
    license: "CC0 — Public Domain",
    updateFreq: "Weekly (Wednesday releases)",
  },
  {
    name: "UniProt Knowledge Base (UniProtKB/Swiss-Prot)",
    provider: "UniProt Consortium (EBI / SIB / PIR)",
    type: "Proteomics",
    color: "blue",
    description: "The gold-standard, manually curated protein sequence and functional information database. Swiss-Prot entries are reviewed by expert curators with functional annotation, disease association, and structure links.",
    dataPoints: "570,000+ Swiss-Prot reviewed entries; 220M+ TrEMBL total",
    usedFor: ["Target gene name and full name resolution", "Associated disease annotations (e.g. cancer, kinase family)", "Known PDB structure accession list per target", "Sequence length and domain topology metadata"],
    url: "https://www.uniprot.org/",
    license: "Creative Commons Attribution 4.0",
    updateFreq: "8 major releases per year",
  },
  {
    name: "AlphaFold Protein Structure Database",
    provider: "DeepMind / EMBL-EBI",
    type: "AI-Predicted Structural Biology",
    color: "violet",
    description: "The landmark AI-generated protein structure resource covering the complete human proteome and key model organisms, making structural data available for targets lacking experimental structures.",
    dataPoints: "200M+ predicted structures (full UniProt coverage)",
    usedFor: ["Predicted structure files (.pdb, .mmCIF) for undrugged targets", "Per-residue confidence (pLDDT) score as druggability proxy", "Active site geometry estimation for targets without experimental structures", "Comparison with RCSB experimental structures"],
    url: "https://alphafold.ebi.ac.uk/",
    license: "Creative Commons Attribution 4.0",
    updateFreq: "Periodic (major version updates)",
  },
];

const ENGINES: EngineEntry[] = [
  {
    name: "ADMET Prediction Engine",
    color: "violet",
    layer: "Layer 1 — In Vitro Twin",
    description: "Browser-side cheminformatics + ML-augmented ADMET. RDKit.js descriptors with QSAR cross-checks; ML predictions tagged with source-quality tier and surfaced with confidence intervals. SMILES never leaves the browser.",
    capabilities: ["Lipinski Rule-of-5 (MW, LogP, HBD, HBA violations)", "Veber oral bioavailability filters (TPSA, RotBonds)", "QED (Quantitative Estimate of Drug-likeness, 0–1)", "Synthetic Accessibility Score (1–10 scale)", "ML-augmented A·D·M·E·T composite with confidence intervals", "Ames mutagenicity and hERG cardiotoxicity risk scoring"],
  },
  {
    name: "Confirmation Pipeline (10-Stage In-Silico)",
    color: "blue",
    layer: "Layer 2 — Confirmation Layer",
    description: "Server-side 10-stage in-silico confirmation pipeline. Ingests the L1 EvidencePointer (frozen at Stage 0) and walks it through structural confirmation, opt-in physics-grounded refinement, and pharmacology projection — sealed into a v2.0.0 ConfirmationBlock.",
    capabilities: ["ESM2 protein druggability + pocket detection", "AutoDock Vina 1.2.7 docking with OpenBabel + RDKit prep", "ML affinity + ADMET cross-check vs L1", "Selectivity panel + cardiotox cross-check", "Opt-in alchemical FEP refinement on RunPod GPU", "PBPK projection → QSP/PD coupling → TI ranking", "Sealed ConfirmationEvidenceBlock v2.0.0"],
  },
  {
    name: "Ex-Vivo Evidence Ingestion",
    color: "blue",
    layer: "Layer 2 — Confirmation Layer (Ex-Vivo Sub-Track)",
    description: "Structured ingestion of substrate-side evidence — literature values (DOI / PMID for this compound or a Tanimoto ≥ 0.4 congener) and in-house values (bench / CRO measurement with assay method + lab + date). Promotes the row tier to LITERATURE or IN-HOUSE — both satisfy the IVIVE cross-species rule and trump downstream ML tiers in the cascade gate. Every entry is HAIOps-traceable with operator and provenance.",
    capabilities: ["Literature substrate ingestion (CVCL accession + DOI/PMID)", "In-house substrate ingestion (CVCL + bench/CRO IC50 + assay method)", "fu_p, fu_mic, B/P substrate cells across 5 species", "Class-median fallback (Lombardo 2018 / Smith 2010) with explicit CLASS-MEDIAN tagging", "Source-quality tier promotion (ML/structural → literature or in-house)"],
  },
  {
    name: "Animal Cohort PBPK Engine",
    color: "amber",
    layer: "Layer 3 — Animal Cohort",
    description: "Multi-species two-compartment PBPK with RK4 integration across rat, dog, and monkey. BCS-aware FDA-IIG formulation engine and allometric scaling per ICH M3(R2) — including 1/10 NOAEL safety factor and bootstrap CIs on the human-equivalent dose.",
    capabilities: ["Species-specific Vd, CL, protein binding (PK-Sim physiology)", "Six FDA-IIG-compliant formulation classes (BCS-aware)", "Allometric scaling: BW^0.75 for CL, BW^1.0 for Vd", "ICH M3(R2) safety factor (1/10 NOAEL) for HED", "External cross-validation (ToxCast · ToxRefDB · ECOTOX)", "ChEMBL animal-PK range checks"],
  },
  {
    name: "Phase 1 Planner & IND Gate",
    color: "emerald",
    layer: "Layer 4 — First-In-Human Readiness",
    description: "Derives a defensible MABEL-biased FIH starting dose, evaluates the IND-enabling gate (GLP tox · CMC · IB · Pre-IND), and seals every upstream piece of evidence into a regulator-ingestible PreClinicalPackage v2.0.0. Not a clinical-trial simulator.",
    capabilities: ["MABEL-biased starting dose (FDA 2005 / EMA 2017)", "evaluateINDGate — GLP tox · CMC · IB · Pre-IND check", "derivePhase1Defaults — cohort sizing, escalation, stopping", "Designation eligibility (Fast Track, Orphan, Breakthrough)", "Sealed PreClinicalPackage v2.0.0 with HAIOps provenance", "Tamper-evident regulator-ingestible bundle"],
  },
];

const STATUS_STYLE: Record<APIStatus, { label: string; cls: string }> = {
  live:      { label: "LIVE",      cls: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" },
  beta:      { label: "BETA",      cls: "bg-amber-500/15 text-amber-400 border border-amber-500/30" },
  reference: { label: "REFERENCE", cls: "bg-slate-500/15 text-slate-400 border border-slate-500/30" },
};

const COLOR_ACCENT: Record<string, string> = {
  violet:  "text-violet-400",
  blue:    "text-blue-400",
  emerald: "text-emerald-400",
  amber:   "text-amber-400",
  rose:    "text-rose-400",
  slate:   "text-slate-400",
};

const COLOR_BORDER: Record<string, string> = {
  violet:  "border-violet-500/20",
  blue:    "border-blue-500/20",
  emerald: "border-emerald-500/20",
  amber:   "border-amber-500/20",
  rose:    "border-rose-500/20",
  slate:   "border-slate-500/20",
};

const COLOR_DOT: Record<string, string> = {
  violet:  "bg-violet-500",
  blue:    "bg-blue-500",
  emerald: "bg-emerald-500",
  amber:   "bg-amber-500",
  rose:    "bg-rose-500",
  slate:   "bg-slate-500",
};

const COLOR_BADGE: Record<string, string> = {
  violet:  "bg-violet-500/10 text-violet-300",
  blue:    "bg-blue-500/10 text-blue-300",
  emerald: "bg-emerald-500/10 text-emerald-300",
  amber:   "bg-amber-500/10 text-amber-300",
  rose:    "bg-rose-500/10 text-rose-300",
  slate:   "bg-slate-500/10 text-slate-300",
};

export function APIs() {
  const [, navigate] = useLocation();

  const categories = [...new Set(APIS.map(a => a.category))];

  return (
    <div className="min-h-screen bg-[#07080c] text-white font-['Inter',sans-serif]">
      <NavBar />

      {/* Hero */}
      <div className="relative border-b border-white/5 overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-violet-600/6 rounded-full blur-[100px]" />
        </div>
        <div className="relative z-10 max-w-5xl mx-auto px-6 md:px-8 pt-20 pb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[12px] text-slate-400 font-medium">All APIs live — real-time data</span>
          </div>
          <h1 className="text-[42px] md:text-[52px] font-black tracking-tight leading-tight mb-4">
            APIs & Data Sources
          </h1>
          <p className="text-[16px] text-slate-400 max-w-2xl leading-relaxed mb-8">
            HakaseAI integrates directly with the world's leading open biomedical databases and regulatory repositories. Every simulation is grounded in real experimental data — no synthetic datasets, no black-box estimates.
          </p>

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { val: String(APIS.length), label: "Live APIs" },
              { val: String(DATABASES.length), label: "Reference Databases" },
              { val: String(ENGINES.length), label: "Simulation Engines" },
              { val: "100%", label: "Open Access" },
            ].map(({ val, label }) => (
              <div key={label} className="border border-white/8 rounded-xl px-4 py-3 bg-white/[0.02]">
                <div className="text-[26px] font-black text-white">{val}</div>
                <div className="text-[12px] text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 md:px-8 py-14 space-y-20">

        {/* ── Section 1: APIs ── */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1 h-6 rounded-full bg-violet-500" />
            <h2 className="text-[22px] font-bold text-white">Live External APIs</h2>
          </div>
          <p className="text-[14px] text-slate-500 mb-8 pl-5">Real-time network calls made during simulation — all data is fetched fresh each session.</p>

          {categories.map(cat => {
            const catApis = APIS.filter(a => a.category === cat);
            return (
              <div key={cat} className="mb-10">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-4">{cat}</div>
                <div className="space-y-4">
                  {catApis.map(api => (
                    <div key={api.name} className={`border ${COLOR_BORDER[api.color]} rounded-xl overflow-hidden bg-white/[0.015]`}>
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/5">
                        <div>
                          <div className="flex items-center gap-2.5 mb-1">
                            <div className={`w-2 h-2 rounded-full ${COLOR_DOT[api.color]}`} />
                            <span className={`text-[15px] font-bold ${COLOR_ACCENT[api.color]}`}>{api.name}</span>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[api.status].cls}`}>
                              {STATUS_STYLE[api.status].label}
                            </span>
                          </div>
                          <div className="text-[12px] text-slate-500 pl-[18px]">{api.provider}</div>
                        </div>
                        <a
                          href={api.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`shrink-0 text-[11px] font-medium px-3 py-1 rounded-lg border ${COLOR_BORDER[api.color]} ${COLOR_ACCENT[api.color]} hover:bg-white/5 transition-colors`}
                        >
                          Docs ↗
                        </a>
                      </div>

                      {/* Body */}
                      <div className="px-5 py-4 grid md:grid-cols-[1fr_auto] gap-6">
                        <div>
                          <p className="text-[13px] text-slate-300 leading-relaxed mb-4">{api.description}</p>
                          <div className="mb-4">
                            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-2">Used In HakaseAI For</div>
                            <ul className="space-y-1">
                              {api.usedFor.map((u, i) => (
                                <li key={i} className="flex items-start gap-2.5">
                                  <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${COLOR_DOT[api.color]}`} />
                                  <span className="text-[12px] text-slate-400">{u}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        {/* Meta panel */}
                        <div className="space-y-3 min-w-[200px]">
                          <div className="border border-white/6 rounded-lg p-3 bg-white/[0.02] space-y-2.5">
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-0.5">Endpoint</div>
                              <code className="text-[10px] text-slate-400 font-mono break-all">{api.endpoint}</code>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-0.5">Authentication</div>
                              <div className="text-[11px] text-emerald-400">{api.auth}</div>
                            </div>
                            {api.rateLimit && (
                              <div>
                                <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600 mb-0.5">Rate Limit</div>
                                <div className="text-[11px] text-slate-400">{api.rateLimit}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {/* ── Section 2: Databases ── */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1 h-6 rounded-full bg-blue-500" />
            <h2 className="text-[22px] font-bold text-white">Reference Databases</h2>
          </div>
          <p className="text-[14px] text-slate-500 mb-8 pl-5">Scientific databases whose published statistics and curated records directly inform HakaseAI's simulation parameters and calibration.</p>

          <div className="grid md:grid-cols-2 gap-5">
            {DATABASES.map(db => (
              <div key={db.name} className={`border ${COLOR_BORDER[db.color]} rounded-xl overflow-hidden bg-white/[0.015] flex flex-col`}>
                <div className="px-5 pt-5 pb-4 border-b border-white/5 flex-1">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full ${COLOR_DOT[db.color]}`} />
                        <span className={`text-[14px] font-bold ${COLOR_ACCENT[db.color]}`}>{db.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 pl-[18px]">{db.provider}</div>
                    </div>
                    <span className={`shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-full ${COLOR_BADGE[db.color]}`}>{db.type}</span>
                  </div>
                  <p className="text-[12px] text-slate-400 leading-relaxed mb-3">{db.description}</p>
                  <div className="space-y-1">
                    {db.usedFor.map((u, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${COLOR_DOT[db.color]}`} />
                        <span className="text-[11px] text-slate-500">{u}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-5 py-3 bg-white/[0.01] grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[9px] text-slate-600 font-bold uppercase tracking-wide mb-0.5">Scale</div>
                    <div className="text-[10px] text-slate-400">{db.dataPoints}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-600 font-bold uppercase tracking-wide mb-0.5">License</div>
                    <div className="text-[10px] text-slate-400">{db.license}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-600 font-bold uppercase tracking-wide mb-0.5">Updates</div>
                    <div className="text-[10px] text-slate-400">{db.updateFreq}</div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-white/5">
                  <a href={db.url} target="_blank" rel="noopener noreferrer" className={`text-[11px] font-medium ${COLOR_ACCENT[db.color]} hover:opacity-80 transition-opacity`}>
                    Visit database ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Section 3: Computation Engines ── */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1 h-6 rounded-full bg-emerald-500" />
            <h2 className="text-[22px] font-bold text-white">Computation Engines</h2>
          </div>
          <p className="text-[14px] text-slate-500 mb-8 pl-5">L1 runs in your browser on RDKit.js (WASM). L2 / L3 / L4 run server-side on fingerprints and structured evidence — SMILES never leaves the browser, and the AI Service only ever sees fingerprint hashes.</p>

          <div className="space-y-4">
            {ENGINES.map(eng => {
              const isClient = eng.layer.startsWith("Layer 1");
              const runtime = isClient
                ? { label: "Browser · SMILES never transmitted", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" }
                : { label: "Server-side · Fingerprints + evidence only", cls: "bg-blue-500/10 text-blue-300 border-blue-500/20" };
              return (
              <div key={eng.name} className={`border ${COLOR_BORDER[eng.color]} rounded-xl overflow-hidden bg-white/[0.015]`}>
                <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2 h-2 rounded-full ${COLOR_DOT[eng.color]}`} />
                      <span className={`text-[14px] font-bold ${COLOR_ACCENT[eng.color]}`}>{eng.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-600 pl-[18px]">{eng.layer}</div>
                  </div>
                  <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${runtime.cls}`}>{runtime.label}</span>
                </div>
                <div className="px-5 py-4 grid md:grid-cols-[1fr_1fr] gap-6">
                  <p className="text-[13px] text-slate-300 leading-relaxed">{eng.description}</p>
                  <ul className="space-y-1.5">
                    {eng.capabilities.map((c, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${COLOR_DOT[eng.color]}`} />
                        <span className="text-[12px] text-slate-400">{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              );
            })}
          </div>
        </section>

        {/* ── Data Flow Diagram ── */}
        <section>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-1 h-6 rounded-full bg-amber-500" />
            <h2 className="text-[22px] font-bold text-white">Data Flow Overview</h2>
          </div>
          <div className="border border-white/8 rounded-2xl p-6 bg-white/[0.015]">
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  step: "01",
                  label: "Compound Input",
                  color: "violet",
                  items: ["User enters compound ID or name", "ChEMBL / PubChem lookup", "UniChem ID bridging", "ZINC catalog check"],
                },
                {
                  step: "02",
                  label: "Structural & Target Data",
                  color: "blue",
                  items: ["UniProt target metadata", "RCSB PDB structure fetch", "AlphaFold fallback structure", "ChEMBL bioactivity pull"],
                },
                {
                  step: "03",
                  label: "Confirmation, Animal Cohort & FIH Readiness",
                  color: "emerald",
                  items: ["L1 ADMET (browser, RDKit.js + ML)", "L2 Confirmation pipeline (server, ESM2 → Vina → opt-in FEP)", "L3 Animal Cohort PBPK + allometric (ICH M3(R2))", "L4 Phase 1 Planner — MABEL · IND gate · sealed PreClinicalPackage v2.0.0"],
                },
              ].map(({ step, label, color, items }) => (
                <div key={step}>
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-black ${COLOR_BADGE[color]}`}>{step}</div>
                    <span className={`text-[13px] font-semibold ${COLOR_ACCENT[color]}`}>{label}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((item, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-[12px] text-slate-400">
                        <div className={`w-1 h-1 rounded-full ${COLOR_DOT[color]}`} />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="border border-white/8 rounded-2xl p-8 bg-white/[0.015] text-center">
          <h3 className="text-[20px] font-bold text-white mb-2">See it in action</h3>
          <p className="text-[14px] text-slate-500 mb-6 max-w-lg mx-auto">Run a full simulation to watch all APIs and engines work together — from molecule lookup to a sealed, IND-ready PreClinicalPackage in minutes.</p>
          <button
            onClick={() => navigate("/login")}
            className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[14px] transition-colors"
          >
            Launch Platform →
          </button>
        </div>
      </div>
    </div>
  );
}
