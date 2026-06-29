import { jsPDF } from "jspdf";

// Create document
const doc = new jsPDF({
  orientation: "portrait",
  unit: "mm",
  format: "a4",
});

const pageWidth = doc.internal.pageSize.getWidth();
const pageHeight = doc.internal.pageSize.getHeight();

// ── COLOR PALETTE ──
const colors = {
  navyDark:   [11, 19, 43],      // Primary Dark
  slateDark:  [30, 41, 59],      // Secondary Dark
  slateLight: [241, 245, 249],   // Primary Light
  accentCyan: [6, 182, 212],     // Cyan Accent
  accentPurp: [124, 58, 237],    // Purple Accent
  neutralText:[51, 65, 85],      // Soft body text
  headingText:[15, 23, 42],      // Sharp dark text
  white:      [255, 255, 255],
  borderLight:[226, 232, 240],
};

// ── UTILITIES FOR DRAWING ──
function setFill(rgb: number[]) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }
function setStroke(rgb: number[]) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
function setTextColor(rgb: number[]) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

function drawHeader(title?: string) {
  // Mini top banner
  setFill(colors.navyDark);
  doc.rect(0, 0, pageWidth, 15, "F");
  
  setTextColor(colors.white);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8);
  doc.text("HAKASE BIOTWIN  ·  PRECLINICAL DISCOVERY PLATFORM", 15, 9);
  
  setTextColor(colors.accentCyan);
  doc.text(title || "EXHAUSTIVE PLATFORM SPECIFICATION MANIFEST", pageWidth - 15, 9, { align: "right" });
  
  // Thin accent line under header
  setFill(colors.accentCyan);
  doc.rect(0, 15, pageWidth, 0.8, "F");
}

function drawFooter(pageNum: number, totalPages: number) {
  setFill(colors.borderLight);
  doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);
  
  setTextColor(colors.neutralText);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7);
  doc.text("STRICTLY CONFIDENTIAL  |  PRECLINICAL AUDIT & TECHNICAL MANUAL", 15, pageHeight - 10);
  doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - 15, pageHeight - 10, { align: "right" });
}

function drawSectionHeading(num: string, title: string, y: number, color = colors.accentPurp): number {
  setFill(colors.slateLight);
  doc.rect(15, y, pageWidth - 30, 8, "F");
  
  setFill(color);
  doc.rect(15, y, 2, 8, "F");
  
  setTextColor(colors.headingText);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(`${num}. ${title}`, 20, y + 5.5);
  
  return y + 14;
}

interface TableCol {
  header: string;
  width: number;
}

function drawTable(
  cols: TableCol[],
  rows: string[][],
  startY: number
): number {
  let y = startY;
  
  // Draw headers
  setFill(colors.navyDark);
  doc.rect(15, y, pageWidth - 30, 7, "F");
  
  setTextColor(colors.white);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(7.5);
  
  let x = 17;
  cols.forEach(col => {
    doc.text(col.header, x, y + 5);
    x += col.width;
  });
  
  y += 7;
  
  // Draw rows
  rows.forEach((row, index) => {
    // Alternating row backgrounds
    if (index % 2 === 1) {
      setFill(colors.slateLight);
      doc.rect(15, y, pageWidth - 30, 8, "F");
    }
    
    // Bottom border
    setStroke(colors.borderLight);
    doc.line(15, y + 8, pageWidth - 15, y + 8);
    
    setTextColor(colors.neutralText);
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7);
    
    let rx = 17;
    row.forEach((cell, cellIdx) => {
      // Bold first column
      if (cellIdx === 0) {
        doc.setFont("Helvetica", "bold");
        setTextColor(colors.headingText);
      } else {
        doc.setFont("Helvetica", "normal");
        setTextColor(colors.neutralText);
      }
      
      const splitText = doc.splitTextToSize(cell, cols[cellIdx].width - 4);
      doc.text(splitText, rx, y + 4.5);
      rx += cols[cellIdx].width;
    });
    
    y += 8;
  });
  
  return y + 4;
}

const totalPages = 14;

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 1: COVER PAGE
// ─────────────────────────────────────────────────────────────────────────────
setFill(colors.navyDark);
doc.rect(0, 0, pageWidth, pageHeight, "F");

setStroke([6, 182, 212]);
doc.setLineWidth(0.5);
doc.line(0, pageHeight * 0.7, pageWidth, pageHeight * 0.4);
doc.line(0, pageHeight * 0.75, pageWidth, pageHeight * 0.45);

setFill(colors.accentCyan);
doc.rect(15, 30, 45, 1, "F");

setTextColor(colors.accentCyan);
doc.setFont("Helvetica", "bold");
doc.setFontSize(10);
doc.text("EXHAUSTIVE PLATFORM TECHNICAL REFERENCE MANIFEST", 15, 25);

setTextColor(colors.white);
doc.setFont("Helvetica", "bold");
doc.setFontSize(36);
doc.text("Hakase BioTwin", 15, 55);

setTextColor(colors.accentCyan);
doc.setFontSize(16);
doc.text("Preclinical AI Engine Algorithms & Verified Databases", 15, 68);

setTextColor([160, 174, 192]);
doc.setFont("Helvetica", "normal");
doc.setFontSize(10);
const descLines = doc.splitTextToSize(
  "An exhaustive technical compilation of every computational parameter, biophysical formula, message-passing neural network, predictive model, and curated biochemical database comprising the Hakase BioTwin platform. Covers Small Molecules, Peptides, Antibodies & Recombinant Fragments, Stage-Gate Cascade Overrides, and HAIOps Compliance.",
  pageWidth - 30
);
doc.text(descLines, 15, 80);

// Technical Specs Panel
setFill([20, 27, 45]);
doc.rect(15, 120, pageWidth - 30, 85, "F");
setStroke([45, 55, 72]);
doc.rect(15, 120, pageWidth - 30, 85, "D");

setTextColor(colors.white);
doc.setFont("Helvetica", "bold");
doc.setFontSize(11);
doc.text("HAKASE ENGINE AUDIT SPECIFICATIONS", 20, 128);

setStroke([45, 55, 72]);
doc.line(20, 131, pageWidth - 20, 131);

setTextColor([160, 174, 192]);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);

let specY = 138;
const specs = [
  ["Platform Architecture", "V2.6.4 (May 2026 Commercial Engine Calibration)"],
  ["Modality Coverage", "Organic Small Molecules, Purified Peptides, Recombinant mAbs & Fragments"],
  ["Safety Compliance", "HAIOps Governance Standard §5.7 & Tamper-Evident Signatures"],
  ["Deep Learning Layers", "ADMET-AI (GNN), Binding-ML (Morgan/ESM-2), ESM-2/ANARCI developability"],
  ["Curated Databases", "ChEMBL v33, DrugCentral v2025, OpenFDA/FAERS, RCSB PDB, USP Peptide Codex"],
  ["Document Class", "Level-1 Regulatory Audit Handbook & Engineering Specifications"],
];

specs.forEach(([label, value]) => {
  doc.setFont("Helvetica", "bold");
  doc.text(label, 20, specY);
  doc.setFont("Helvetica", "normal");
  doc.text(value, 65, specY);
  specY += 9;
});

setTextColor([160, 174, 192]);
doc.setFont("Helvetica", "bold");
doc.setFontSize(8.5);
doc.text("CONFIDENTIAL  |  PREPARED FOR CHIEF SCIENTIFIC OFFICER & REGULATORY COMPLIANCE AUDITORS", 15, pageHeight - 20);
doc.setFont("Helvetica", "normal");
doc.setFontSize(7.5);
doc.text("© 2026 Hakase AI Inc. All rights reserved. Sealed evidence chains are mathematically tamper-evident.", 15, pageHeight - 15);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 2: TABLE OF CONTENTS & ARCHITECTURAL SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("TABLE OF CONTENTS");

let currY = 28;
setTextColor(colors.headingText);
doc.setFont("Helvetica", "bold");
doc.setFontSize(16);
doc.text("Technical Manual & Document Outline", 15, currY);
currY += 4;

setStroke(colors.accentCyan);
doc.line(15, currY, 60, currY);
currY += 10;

// TOC Panel
setFill(colors.slateLight);
doc.rect(15, currY, pageWidth - 30, 80, "F");

setTextColor(colors.headingText);
doc.setFont("Helvetica", "bold");
doc.setFontSize(9);
doc.text("DOCUMENT OUTLINE", 20, currY + 6);
doc.line(20, currY + 8, pageWidth - 20, currY + 8);

const longToc = [
  ["1. Platform Core Layers", "Page 3", "Preclinical cascade workflow, L1 developability, L2 structure, L3 PBPK, L4 FIH gates"],
  ["2. Small Molecule Engine I", "Page 4", "RDKit QSPR descriptors, classical ADMET, Lipinski/Veber rules of thumb"],
  ["3. Small Molecule Engine II", "Page 5", "ADMET-AI Graph Neural Networks, NCATS CYP panels, CardioTox-ML, Hansen AMES"],
  ["4. Small Molecule Engine III", "Page 6", "DeepDTA-GBM target suggests, Vina docking, PBPK Obach clear, FDA Orange Book"],
  ["5. Peptide Modality Engine I", "Page 7", "Debye-Hückel ionic shielding, HH charge sums, cystine maps, solubility models"],
  ["6. Peptide Modality Engine II", "Page 8", "PeptideCutter proteolysis cleavages, AGGRESCAN hotspots, synthesis feasibility"],
  ["7. Peptide Modality Engine III", "Page 9", "MIC AMP APD3 match, Boman index, NHS site inventory, human/rat/dog IVIVE clearance"],
  ["8. Antibody Modality Engine I", "Page 10", "ANARCI IMGT numbering, heavy/light CDR localized maps, CDR liability motifs"],
  ["9. Antibody Modality Engine II", "Page 11", "TAP developability flags, AGGRESCAN antibody hot-spots, humanness agretopes"],
  ["10. Antibody Modality Engine III", "Page 12", "Subclass circulatory kinetics, FcRn pH-switch recycling, Cyno/Mouse IVIVE clearance"],
  ["11. Preclinical Governance & HAIOps", "Page 13", "SHA-256 evidence chain compliance, reviewer override trails, consensus rules"],
  ["12. Regulatory Submission Outlook", "Page 14", "FDA ANDA peptide guidelines (2021), ICH S6(R1) mAb tox, FDA TCR panels"],
];

let tocY = currY + 13;
longToc.forEach(([title, page, note], index) => {
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(7.5);
  setTextColor(colors.accentPurp);
  doc.text(title, 20, tocY);
  
  doc.setFont("Helvetica", "bold");
  setTextColor(colors.headingText);
  doc.text(page, pageWidth - 20, tocY, { align: "right" });
  
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7);
  setTextColor(colors.neutralText);
  doc.text(note, 65, tocY);
  
  tocY += 5.5;
});

currY += 92;

currY = drawSectionHeading("System Core", "The Four Preclinical Layers Summary", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const summaryDesc = doc.splitTextToSize(
  "Hakase BioTwin orchestrates preclinical drug discovery by segmenting computational predictions, wet-lab assay overlays, and multi-species kinetic scaling into four decoupled verification gates. This structure prevents premature in vivo modeling on compounds with fatal developability liabilities, saving millions in pre-clinical CRO expenditures.",
  pageWidth - 30
);
doc.text(summaryDesc, 15, currY);

drawFooter(2, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 3: PLATFORM CORE LAYERS DETAILED
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("PLATFORM ARCHITECTURE");

currY = 28;
currY = drawSectionHeading("1.0", "Decoupled Verification Layer Architecture", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const ldesc = doc.splitTextToSize(
  "The commercial preclinical discovery paradigm enforces a strict go/no-go gating cascade at each computational scale. This manifest outlines the exact equations, databases, and algorithms integrated into each layer.",
  pageWidth - 30
);
doc.text(ldesc, 15, currY);
currY += 14;

const CoreLayersCols = [
  { header: "Discovery Layer", width: 35 },
  { header: "Primary Mechanism & Algorithms", width: 85 },
  { header: "Verification Standard", width: 60 }
];

const CoreLayersRows = [
  [
    "Layer 1: In Vitro Twin",
    "RDKit molecular mass, LogP, TPSA, Debye-Hückel shielded electrostatics, ANARCI CDR IMGT numbering alignment, and ADMET-AI Graph Neural Networks.",
    "Developability & Physicochemical parms"
  ],
  [
    "Layer 2: Confirmation",
    "AutoDock Vina local grid docking, AlphaFold-DB 3D structure alignments, ESM-2 biological representation, and opt-in RunPod Free Energy Perturbation.",
    "Sealed ConfirmationBlock v2.0.0"
  ],
  [
    "Layer 3: Animal Cohort",
    "Multi-species Physiologically Based Pharmacokinetics (rat, dog, Cynomolgus monkey). Obach microsomal binding corrections. Allometry (ICH M3(R2)).",
    "Cross-Validated vs ToxCast & FAERS"
  ],
  [
    "Layer 4: FIH Readiness",
    "MABEL-biased starting doses, GLP toxicology protocols, FDA tissue cross-reactivity panels, anti-drug antibody assay development.",
    "Sealed PreClinicalPackage v2.0.0"
  ]
];

currY = drawTable(CoreLayersCols, CoreLayersRows, currY);

currY = drawSectionHeading("1.1", "Algorithmic Source Quality Tiers", currY);
setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const tierDesc = doc.splitTextToSize(
  "Every data point displayed in Hakase BioTwin carries an explicit, honest source quality tier, preventing the fabrication of preclinical parameters. Empty cells render blank; estimates are never silently replaced.",
  pageWidth - 30
);
doc.text(tierDesc, 15, currY);
currY += 12;

const tierCols = [
  { header: "Quality Tier", width: 35 },
  { header: "Score", width: 25 },
  { header: "Computational Provenance & Mathematical Defensibility", width: 120 }
];

const tierRows = [
  ["Experimental", "1.0", "Measured in vitro or in vivo data imported directly from peer-reviewed databases or tenant bench assays (FDA DAPs, ChEMBL, in-house)."],
  ["Enriched", "0.85", "Extrapolated using nearest-neighbor similarity matching (Tanimoto coefficient >= 0.4) against validated reference databases."],
  ["Machine Learning", "0.7", "Trained models leveraging Graph Neural Networks (ADMET-AI) or deep sequence representation (ESM-2, Binding-ML) with explicit R2/AUC stats."],
  ["Structural / Rule", "0.6", "Deterministic rule-based models or SMARTS substructure match scans (Brenk, PAINS, Lipinski, PeptideCutter cleavage)."],
  ["Heuristic", "0.4", "Directional estimates or empirical correlations (e.g. GRAVY-based PPB, Boman-index membrane binding). Required for early-stage screening only."]
];

currY = drawTable(tierCols, tierRows, currY);

drawFooter(3, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 4: SMALL MOLECULE I — PHYSICOCHEMICAL & CLASSICAL ADMET
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("SMALL MOLECULE ENGINE — QSPR & CLASSICAL");

currY = 28;
currY = drawSectionHeading("2.0", "Molecular Descriptors & Substructure Rules", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const sm1Desc = doc.splitTextToSize(
  "The small molecule QSPR engine operates on raw SMILES input using RDKit to calculate deterministic physicochemical properties. These properties drive classical filtration rules (Lipinski Rule of 5, Veber rules) to predict first-pass oral developability.",
  pageWidth - 30
);
doc.text(sm1Desc, 15, currY);
currY += 14;

const sm1Cols = [
  { header: "Parameter", width: 45 },
  { header: "Background Logic / Mathematical Algorithm", width: 90 },
  { header: "Database / Reference Sourced", width: 45 }
];

const sm1Rows = [
  ["Molecular Weight (MW)", "Exact atomic mass summing formula: MW = sum(atomic_mass_i * count_i). Used to evaluate glomerular filtration.", "IUPAC Atomic Weights 2016"],
  ["LogP (Octanol-Water)", "Wildman-Crippen group contribution method. SlogP = sum(contribution_i * count_i) based on atomic environments.", "Wildman & Crippen 1999 (J. Chem. Inf.)"],
  ["TPSA", "Topological Polar Surface Area based on sum of 2D polar fragment contributions (N, O, S and polar H).", "Ertl et al. 2000 (J. Med. Chem.)"],
  ["HBD & HBA counts", "Counts standard hydrogen bond donors (OH/NH) and hydrogen bond acceptors (N/O atoms with lone pairs).", "Lipinski 1997 Rule of 5 (Adv. Drug Deliv)"],
  ["Rotatable Bonds count", "Counts non-terminal, single non-ring bonds between non-hydrogen atoms. Governs conformational flexibility.", "Veber 2002 Oral Permeability Rules"],
  ["Fraction Csp3 (Fsp3)", "Ratio of sp3-hybridised carbon atoms to total carbon atoms. Correlates with solubility and structural complexity.", "Yan & Gasteiger 2003 (J. Chem. Inf.)"],
  ["Quantitative Drug-likeness (QED)", "Weighted composite score (0-1) combining MW, LogP, TPSA, rotatable bonds, and structural alert penalties.", "Bickerton et al. 2012 (Nature Chem.)"],
  ["Aqueous Solubility (LogS)", "Heuristic QSPR solubility model calculated from topological and electrostatic fragment descriptors.", "AqSolDB (Sorkun et al. 2019)"],
];

currY = drawTable(sm1Cols, sm1Rows, currY);

drawFooter(4, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 5: SMALL MOLECULE II — DEEP LEARNING & GNN ENGINES
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("SMALL MOLECULE ENGINE — MACHINE LEARNING");

currY = 28;
currY = drawSectionHeading("3.0", "Graph Neural Network & Consensus ADMET-AI Models", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const sm2Desc = doc.splitTextToSize(
  "Advanced ADMET endpoints are computed using Graph Neural Networks (GNNs) and Gradient Boosted Decision Trees. High-severity flags are evaluated using deep sequence models (ESM-2, Morgan fingerprint alignments), bypassing classical rule-of-thumb limits.",
  pageWidth - 30
);
doc.text(sm2Desc, 15, currY);
currY += 14;

const sm2Cols = [
  { header: "ML Endpoint", width: 45 },
  { header: "Deep Learning Architecture & Feature Representation", width: 95 },
  { header: "Training Corpus & Stats", width: 40 }
];

const sm2Rows = [
  ["Caco2_Wang Cell Perm.", "D-MPNN message-passing over molec. graphs + 200 descriptors. Mapped to Caco-2 log cm/s permeability.", "TDC ADMET / Wang et al."],
  ["PPBR_AZ (PPB %)", "Ridge Regression + Multi-Layer Perceptron trained on Morgan and RDKit molecular fingerprints.", "AstraZeneca PPBR set (8,500 drugs)"],
  ["CYP Isoforms (Veith)", "Consensus Multi-Task Deep Neural Network classifying 1A2/2C9/2C19/2D6/3A4 inhibition.", "NCATS PubChem (17,000 compounds)"],
  ["hERG Cardiac QT risk", "Random Forest + SVM ensemble classifying CardioTox-ML hERG blocker probability.", "FDA CardioTox-ML (Karim 2016)"],
  ["DILI (Liver Injury)", "Gradient Boosted Decision Trees trained on FDA DILIrank annotations.", "FDA DILIrank (1,030 approved drugs)"],
  ["AMES Mutagenicity", "Message-passing neural network classifying AMES mutagenic risk.", "TDC AMES set (6,500 compounds)"],
  ["LD50_Zhu Acute Tox", "Chemprop D-MPNN predicting acute toxicity LD50 in log mol/kg.", "TDC Acute Toxicity (Zhu et al.)"],
  ["Carcinogens_Lagunin", "Multi-task GNN predicting carcinogenicity probability.", "Lagunin et al. database"]
];

currY = drawTable(sm2Cols, sm2Rows, currY);

drawFooter(5, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 6: SMALL MOLECULE III — BINDING-ML, PBPK, & FDAPSG LOOKUPS
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("SMALL MOLECULE — TARGETS, PBPK & FDA COMPLIANCE");

currY = 28;
currY = drawSectionHeading("4.0", "Neural Binding ML & Dose-Response Simulations", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const sm3Desc = doc.splitTextToSize(
  "Ligand-target binding affinities are predicted using ESM-2 sequence embeddings aligned with Morgan fingerprints, enabling high-confidence off-target screening and simulated concentration-response scaling.",
  pageWidth - 30
);
doc.text(sm3Desc, 15, currY);
currY += 14;

const sm3Cols = [
  { header: "Feature Module", width: 45 },
  { header: "Underlying Mathematical Model & Algorithmic Logic", width: 90 },
  { header: "Source Database / Reference", width: 45 }
];

const sm3Rows = [
  ["ChEMBL Target Suggestions", "Calculates target suggestions using Tanimoto similarity matching of Morgan fingerprints.", "ChEMBL v33 exact & similar"],
  ["Binding-ML Affinity", "DeepDTA-GBM sequence-structure matching using ESM-2 sequence embeddings and Morgan fingerprints.", "BindingDB & ChEMBL v33 Kd/Ki"],
  ["Dose-Response curve", "Calculates hill equation: Response = 100 / (1 + (IC50 / concentration)^Hill_slope).", "Hill 1910 (J. Physiol.)"],
  ["Bioactivation Alerts", "SMARTS substructure matching scanning for PAINS and NIH-MLSMR reactive metabolites.", "PAINS / NIH-MLSMR (Brenk 2008)"],
  ["FAERS AE Label Signals", "Post-market Adverse Event reporting rates aligned against FAERS database counts.", "FDA openFDA FAERS database"],
  ["FDA Bioequivalence PSG Lookups", "FDA Product-Specific Guidance query extracting TE code, RLD status, and BE study recommendations.", "FDA Orange Book & Dissolution methods"]
];

currY = drawTable(sm3Cols, sm3Rows, currY);

currY = drawSectionHeading("4.1", "Hepatic Well-Stirred PBPK & HED Allometry", currY);
setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const smPbpkDesc = doc.splitTextToSize(
  "Human clearance is extrapolated from in vitro intrinsic clearance (CL_int) using the Obach microsomal binding correction and allometrically scaled across species to calculate human equivalent dose margins.",
  pageWidth - 30
);
doc.text(smPbpkDesc, 15, currY);
currY += 12;

const smPbpkCols = [
  { header: "PBPK parameter", width: 40 },
  { header: "Extrapolation Formula & Mathematical Equations", width: 95 },
  { header: "Reference Sourced", width: 45 }
];

const smPbpkRows = [
  ["Obach 1999 fu_mic correction", "CL_int_corrected = CL_int_measured / fu_mic, where fu_mic corrects for microsomal protein binding.", "Obach 1999 (Drug Metab. Dispos.)"],
  ["Well-Stirred Liver Clearance", "CL_h = Q_h * f_up * CL_int_corrected / (Q_h + f_up * CL_int_corrected), where Q_h is blood flow.", "Well-Stirred Model (Wilkinson 1973)"],
  ["Blood-to-Plasma conversion", "CL_blood = CL_plasma / (B/P ratio). Adjusts extraction ratios.", "Lombardo 2018 / Smith 2010"],
  ["Allometric HED Scaling", "HED = Animal Dose * (Animal Weight / Human Weight)^(1 - b), where b = 0.75 scaling coefficient.", "FDA Guidance 2005 / ICH M3(R2)"]
];

currY = drawTable(smPbpkCols, smPbpkRows, currY);

drawFooter(6, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 7: PEPTIDE I — ELECTROSTATICS & ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("PEPTIDE MODALITY — ENVIRONMENT & SHIELDING");

currY = 28;
currY = drawSectionHeading("5.0", "Debye-Hückel Shielding & Henderson-Hasselbalch Electrostatics", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const pep1Desc = doc.splitTextToSize(
  "The peptide formulation engine runs explicit electrostatic calculations under physiological or custom buffer conditions, summing amino acid side chain charge states and calculating Debye-Hückel charge shielding factors to project solubility.",
  pageWidth - 30
);
doc.text(pep1Desc, 15, currY);
currY += 14;

const pep1Cols = [
  { header: "Biophysical Metric", width: 45 },
  { header: "Mathematical Formula / Algorithmic Equation", width: 95 },
  { header: "Source Database / Reference", width: 40 }
];

const pep1Rows = [
  ["Net Charge vs pH", "Charge = sum_i(1 / (1 + 10^(pH - pKa_i))) for acidic; sum_j(1 / (1 + 10^(pKa_j - pH))) for basic residues.", "Bjellqvist 1993 pKa amino acid values"],
  ["Debye-Hückel Shielding", "salt_shielding = exp(-kappa * Debye_length), where kappa = 0.329 * sqrt(Ionic Strength). Shields ionic aggregation.", "Debye & Hückel 1923 (Physik Z.)"],
  ["Disulfide Bridges Map", "Validates sequence coordinates, subtracts matched cystines from free thiols, modifies coupling difficulty.", "Standard Cystine Thiol Chemistry rules"],
  ["Free Cysteine Liabilities", "Flags unpaired thiols vulnerable to oxidation, disulfide scrambling, or dimerisation.", "USP / FDA Impurity Guidances"],
  ["Aqueous Solubility (LogS)", "Solubility(pH) = Solubility_neutral * (1 + 10^(|pH - pI| * Debye_shielding_factor)).", "Eisenberg Hydrophobicity scales"],
];

currY = drawTable(pep1Cols, pep1Rows, currY);

currY = drawSectionHeading("5.1", "Physicochemical Properties", currY);
const pepPhysCols = [
  { header: "Parameter", width: 45 },
  { header: "Background Logic / Computational Model", width: 95 },
  { header: "Reference", width: 40 }
];

const pepPhysRows = [
  ["Instability Index", "Instability Index = (10/L) * sum_i(DI_i,i+1), evaluating local dipeptide stability scores.", "Guruprasad 1990 (Protein Eng.)"],
  ["Isoelectric Point (pI)", "Calculated via binary search resolving pH where the Net Charge = 0.", "Bjellqvist 1993 pKa amino acid values"],
  ["GRAVY score", "Grand Average of Hydropathy: sum of Kyte-Doolittle hydropathy values divided by residue length.", "Kyte & Doolittle 1982 (J. Mol. Biol.)"],
  ["Aliphatic Index", "Aliphatic Index = X_Ala + a * X_Val + b * (X_Ile + X_Leu), where a=2.9, b=3.9.", "Ikai 1980 (J. Biochem.)"],
  ["Boman Index", "Sum of net free energy of transfer from cyclohexane to water of all residues.", "Boman 2003 (Bioinformatics)"],
  ["Hydrophobic Moment", "Evaluates amphipathicity: hydrophobic_moment = sqrt(sum(H_i * cos(i*theta))^2 + sum(H_i * sin(i*theta))^2).", "Eisenberg 1984 (J. Mol. Biol.)"],
  ["Pace 1995 Extinction", "Oxidised: e = 5560*N_Trp + 1200*N_Tyr + 125*N_Cystine; Reduced: e = 5560*N_Trp + 1200*N_Tyr + 62*N_Cys.", "Pace 1995 (Protein Sci.)"]
];

currY = drawTable(pepPhysCols, pepPhysRows, currY);

drawFooter(7, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 8: PEPTIDE II — PROTEOLYSIS & AGGRESCAN
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("PEPTIDE MODALITY — PROTEOLYSIS & AGGREGATION");

currY = 28;
currY = drawSectionHeading("6.0", "Protease Cleavage & Proteolytic Stability mapping", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const pep2Desc = doc.splitTextToSize(
  "Peptides are vulnerable to rapid enzymic hydrolysis by digestive and serum proteases. The proteolytic stability engine maps sequence positions against 9 distinct enzymes, highlighting cleavage points and calculating stability classes.",
  pageWidth - 30
);
doc.text(pep2Desc, 15, currY);
currY += 14;

const pep2Cols = [
  { header: "Protease Evaluated", width: 45 },
  { header: "Cleavage Motif & Amino Acid Subsite specificity", width: 95 },
  { header: "Source Database / Reference", width: 40 }
];

const pep2Rows = [
  ["Trypsin", "Cleaves C-terminal to Lys (K) or Arg (R) unless followed by Pro (P).", "ExPASy PeptideCutter rules"],
  ["Chymotrypsin (high specificity)", "Cleaves C-terminal to Phe (F), Tyr (Y), or Trp (W) unless followed by Pro (P).", "ExPASy PeptideCutter rules"],
  ["Pepsin (pH > 1.3)", "Cleaves C-terminal to Phe (F), Leu (L), or Glu (E) unless followed by Pro (P).", "ExPASy PeptideCutter rules"],
  ["Elastase", "Cleaves C-terminal to Ala (A), Val (V), Gly (G), or Ser (S) unless followed by Pro (P).", "ExPASy PeptideCutter rules"],
  ["Thermolysin", "Cleaves N-terminal to hydrophobic residues (I, L, M, F, W, V).", "ExPASy PeptideCutter rules"],
  ["Proteinase K", "Cleaves C-terminal to aliphatic and aromatic amino acids.", "ExPASy PeptideCutter rules"],
  ["Clostripain", "Cleaves C-terminal to Arg (R) residues.", "ExPASy PeptideCutter rules"],
  ["Thrombin", "Cleaves C-terminal to Arg (R) residues in highly specific motifs (e.g. GRG).", "ExPASy PeptideCutter rules"],
  ["Bromelain", "Cleaves Lys (K), Arg (R), Ala (A), or Tyr (Y) in diverse hydrophobic settings.", "ExPASy PeptideCutter rules"]
];

currY = drawTable(pep2Cols, pep2Rows, currY);

currY = drawSectionHeading("6.1", "AGGRESCAN & Synthesis Feasibility", currY);
const pepAggCols = [
  { header: "Feature Module", width: 45 },
  { header: "Computational Logic / Mathematical Model", width: 95 },
  { header: "Reference", width: 40 }
];

const pepAggRows = [
  ["AGGRESCAN Hotspots", "Sequence-based aggregation propensity sum using sliding windows to calculate peak A4V values.", "Conchillo-Sole 2007 (AGGRESCAN)"],
  ["SPPS Difficulty", "Solid-Phase Peptide Synthesis difficulty scoring, penalizing beta-branched density, steric hindrance, and length.", "SPPS chemistry rules"],
  ["Membrane Permeability", "Heuristic score (0-100) mapped from hydrophobic moment and molecular volume calculations.", "Chou-Fasman / Eisenberg rules"],
  ["CPP (Cell-penetrating)", "Evaluates arginine/lysine density and hydrophobic moment to identify Cell-Penetrating Peptides.", "Wang 2016 APD3 antimicrobial database"]
];

currY = drawTable(pepAggCols, pepAggRows, currY);

drawFooter(8, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 9: PEPTIDE III — MIC, BOMAN, & SPECIES Clearance
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("PEPTIDE MODALITY — PK & IVIVE");

currY = 28;
currY = drawSectionHeading("7.0", "In Vitro PK-Relevant Properties & MIC Estimations", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const pep3Desc = doc.splitTextToSize(
  "Peptide pharmacokinetics is modeled using in vitro surrogates for distribution and clearance, and mapped against named databases to estimate antimicrobial minimum inhibitory concentrations (MIC).",
  pageWidth - 30
);
doc.text(pep3Desc, 15, currY);
currY += 14;

const pep3Cols = [
  { header: "PK parameter", width: 45 },
  { header: "Underlying Mathematical Model & Algorithmic Logic", width: 95 },
  { header: "Reference Database", width: 40 }
];

const pep3Rows = [
  ["MIC Range Estimate", "Empirical regression matching net charge and hydrophobic moment to AMP classes to estimate MIC.", "APD3 (Antimicrobial Peptide DB)"],
  ["Projected PPB", "Fraction bound modeled from GRAVY and molecular weight: PPB_est = 50 + (GRAVY * 15) + (MW > 1000 ? 10 : 0).", "Krauss & Müller 2007 (J. Pharm. Sci)"],
  ["Caco-2 Papp cm/s", "Projected permeability: Papp = (Permeability_score >= 60 ? 15 : Permeability_score >= 35 ? 5 : 1) * 1e-6 cm/s.", "Empirical permeability mapping"],
  ["Volume of Dist. (Vd)", "Modeled from net charge at pH 7.4: positive charge wide Vd (>1.0 L/kg), negative charge low Vd (<0.2 L/kg).", "Lombardo 2018 (J. Pharm. Sci.)"],
  ["Bioconjugation sites", "Sequence search mapping Lysines (NHS-ester), free Cysteines (Maleimide), and Aspartates (EDC/sulfo-NHS).", "NHS/Maleimide conjugation rules"]
];

currY = drawTable(pep3Cols, pep3Rows, currY);

currY = drawSectionHeading("7.1", "GFR Renal + Liver Well-Stirred IVIVE", currY);
const pepPbpkCols = [
  { header: "IVIVE Component", width: 45 },
  { header: "Extrapolation Formula & Mathematical Equations", width: 95 },
  { header: "Preclinical Species Flow", width: 40 }
];

const pepPbpkRows = [
  ["GFR Filtration CL", "CL_gfr = GFR_species * fu_p, evaluating renal filtration limits for peptides below 30 kDa.", "GFR: Human 1.8, Rat 5.2, Dog 2.0"],
  ["Hepatic extraction well-stirred", "CL_h = Q_h_species * fu_p * (CL_int / fu_mic) / (Q_h_species + fu_p * (CL_int / fu_mic)).", "Q_h: Human 20.7, Rat 55.2, Dog 30.9"],
  ["Peptidase degradation CL", "CL_prot = 0.05 * cleavage_sites * Instability_Index, modeling serum peptidase clearance.", "Peptidase rates scaled across species"],
  ["Net Species Clearance", "CL_total = CL_gfr + CL_h + CL_prot. Scales projected circulatory clearance.", "Total body clearance sum"],
  ["Projected Half-life (t1/2)", "t1/2 = ln(2) * Vd / (CL_total * 0.060), yielding projected parent half-life in hours.", "t1/2: Human, Rat, Dog scaling"]
];

currY = drawTable(pepPbpkCols, pepPbpkRows, currY);

drawFooter(9, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 10: ANTIBODY I — CDR ANNOTATIONS & LIABILITIES
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("ANTIBODY MODALITY — CDR & LIABILITIES");

currY = 28;
currY = drawSectionHeading("8.0", "ANARCI IMGT Localization & CDR Numbering", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const ab1Desc = doc.splitTextToSize(
  "The antibody engine triages large construct IgGs and fragments (VHH, scFv, Fab). Sequence CDR loops are localized using alignment tools following IMGT numbering conventions.",
  pageWidth - 30
);
doc.text(ab1Desc, 15, currY);
currY += 14;

const ab1Cols = [
  { header: "Feature", width: 45 },
  { header: "Localization Algorithm & Motifs Evaluated", width: 95 },
  { header: "Verification Standards", width: 40 }
];

const ab1Rows = [
  ["ANARCI CDR Localization", "IMGT canonical numbering alignment mapping CDR1, CDR2, CDR3 coordinates per heavy & light chain.", "ANARCI (IMGT Numbering schema)"],
  ["Deamidation Hotspots", "Identifies exposed asparagine residues followed by glycine/serine (NG, NS motifs) within CDR loops.", "TAP developability guidelines"],
  ["Isomerisation Hotspots", "Identifies aspartic acid residues followed by glycine (DG motifs) susceptible to isomerization.", "TAP developability guidelines"],
  ["Oxidation Hotspots", "Identifies methionine/tryptophan residues exposed within CDR loops susceptible to ROS.", "TAP developability guidelines"],
  ["N-Glycosylation Triages", "Identifies consensus NXS/T motifs; evaluates glycosylation based on bioprocess host machinery.", "Host cell line Glycosylation databases"],
];

currY = drawTable(ab1Cols, ab1Rows, currY);

currY = drawSectionHeading("8.1", "Chain Physicochemistry Properties", currY);
const abPhysCols = [
  { header: "Parameter", width: 45 },
  { header: "Computational Logic / Mathematical Model", width: 95 },
  { header: "Reference", width: 40 }
];

const abPhysRows = [
  ["Net Charge at custom pH", "Henderson-Hasselbalch sum of ionisable side chain pKa values at pH 7.4.", "Bjellqvist 1993 pKa amino acid values"],
  ["Isoelectric Point (pI)", "Binary search resolving pH where the Net Charge of the heavy/light chain = 0.", "Bjellqvist 1993 pKa amino acid values"],
  ["GRAVY score", "Grand Average of Hydropathy: sum of Kyte-Doolittle hydropathy values divided by residue length.", "Kyte & Doolittle 1982 (J. Mol. Biol.)"],
  ["Instability Index", "Evaluates local dipeptide stability scores. IgGs typically stable in framework, labilities in CDRs.", "Guruprasad 1990 (Protein Eng.)"],
  ["Extinction Coefficient", "Oxidised: e = 5560*N_Trp + 1200*N_Tyr + 125*N_Cystine; Reduced: e = 5560*N_Trp + 1200*N_Tyr + 62*N_Cys.", "Pace 1995 (Protein Sci.)"]
];

currY = drawTable(abPhysCols, abPhysRows, currY);

drawFooter(10, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 11: ANTIBODY II — TAP FLAGS & AGGRESCAN
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("ANTIBODY MODALITY — DEVELOPABILITY & TAP");

currY = 28;
currY = drawSectionHeading("9.0", "TAP Developability & Aggaggregation Hotspots", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const ab2Desc = doc.splitTextToSize(
  "Developability flags screen sequence-level developability risks based on historical therapeutic antibody profiles, grading candidates across 5 key parameters.",
  pageWidth - 30
);
doc.text(ab2Desc, 15, currY);
currY += 14;

const ab2Cols = [
  { header: "TAP Metric", width: 45 },
  { header: "Computational Flag & Range Tally", width: 95 },
  { header: "TAP Reference", width: 40 }
];

const ab2Rows = [
  ["Total CDR Length", "Sum of heavy and light chain CDR1, CDR2, CDR3 loop lengths. Long CDRs flagged for aggregation.", "TAP Developability rules 2019"],
  ["Severe CDR Liabilities", "Flags high-severity deamidation, isomerisation, and oxidation hot-spots within CDR loops.", "TAP Developability rules 2019"],
  ["Developability Tier", "Grades sequence into Green (low risk), Amber (medium risk), or Red (high risk) developability bands.", "TAP Developability rules 2019"],
  ["AGGRESCAN CDR Hotspots", "Sequence-based AGGRESCAN aggregate propensity score calculated specifically for CDR regions.", "Conchillo-Sole 2007 (AGGRESCAN)"],
  ["Coarse Immunogenicity", "Scans sequence for potential T-cell agretope windows fitting MHC II binding clefts.", "IEDB (Immune Epitope DB) consensus"],
  ["Glomerular Size-Filtration", "Renal filtration clearance cutoff modeled at 60 kDa; IgGs size-retained, fragments cleared.", "Glomerular Filtration Rate criteria"]
];

currY = drawTable(ab2Cols, ab2Rows, currY);

drawFooter(11, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 12: ANTIBODY III — FcRn RECYCLING & CIRCULATION Clearance
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("ANTIBODY MODALITY — PK & CIRCULATION");

currY = 28;
currY = drawSectionHeading("10.0", "Subclass Circulatory Kinetics & FcRn pH-Switch Recycling", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const ab3Desc = doc.splitTextToSize(
  "Antibody circulatory clearance is subclass and format dependent. Full construct IgGs undergo FcRn-mediated recycling, while smaller fragments (scFv, VHH, Fab) clear rapidly via kidneys.",
  pageWidth - 30
);
doc.text(ab3Desc, 15, currY);
currY += 14;

const ab3Cols = [
  { header: "PK Parameter", width: 45 },
  { header: "Extrapolation Formula & Mathematical Equations", width: 95 },
  { header: "Subclass active recycling vs fragments", width: 40 }
];

const ab3Rows = [
  ["Projected Human Clearance", "IgG1, IgG2, IgG4 exhibit active FcRn recycling; clearance is low (~0.08 mL/h/kg).", "FcRn pH-switch comparison pH 6.0/7.4"],
  ["Projected Cyno Clearance", "Cynomolgus monkey clearance is scaled allometrically: CL_cyno = CL_human * (Weight_ratio)^-0.25.", "Cyno PK scale: IgG 0.15 mL/h/kg"],
  ["Projected Mouse Clearance", "Mouse clearance scaled allometrically: CL_mouse = CL_human * (Weight_ratio)^-0.25.", "Mouse PK scale: IgG 0.40 mL/h/kg"],
  ["Glomerular Renal GFR", "mAbs under 60 kDa (Fab, scFv, VHH) clear rapidly via kidneys; IgGs are size-retained.", "Glomerular Filtration Rate criteria"],
  ["FcRn-Mediated Recycling", "IgG1, IgG2, IgG4 exhibit active FcRn pH-switch recycling; IgG3 is compromised (7d); fragments are excluded.", "H435 FcRn binding polymorphism"],
  ["Construct MW modeling", "Computes molecular weight based on antibody format (VHH ~15 kDa, scFv ~27 kDa, Fab ~50 kDa, IgG ~150 kDa).", "Construct sequence maps"]
];

currY = drawTable(ab3Cols, ab3Rows, currY);

drawFooter(12, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 13: PRECLINICAL GOVERNANCE & HAIOPS
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("PRECLINICAL GOVERNANCE & HAIOPS");

currY = 28;
currY = drawSectionHeading("11.0", "HAIOps Preclinical Governance & Compliance", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const gov1Desc = doc.splitTextToSize(
  "Every pre-clinical simulation generates a tamper-evident audit signature mapped to standard HAIOps compliance criteria. The platform ensures that all computational predictions, custom env parameters, and overrides are logged, citable, and mapped directly to global IND-enabling regulatory requirements.",
  pageWidth - 30
);
doc.text(gov1Desc, 15, currY);
currY += 14;

const gov1Cols = [
  { header: "Governance Feature", width: 45 },
  { header: "Underlying Compliance Logic & Implementation", width: 95 },
  { header: "HAIOps Standard / Rule", width: 40 }
];

const gov1Rows = [
  ["SHA-256 Evidence Chain", "Generates cryptographic hashes of the input sequence, parameters, and results, preventing post-hoc data tampering.", "HAIOps Preclinical Standard §5.7"],
  ["Reviewer Override Log", "Requires formal CSO / Regulatory Affairs justification when overriding blocked stage-gates. Saves audit trail.", "HAIOps Preclinical Standard §5.7"],
  ["Provenanc e Attributions", "Categorizes every displayed result into four distinct tiers: exact formula, calculated, rule-based, or heuristic.", "Provenance Tracking standard §2.1"],
  ["Consensus Verification", "Compares independent model predictions (e.g. biophysical calculations vs GNN models) to calculate a validation score.", "Algorithmic Consensus standard §3.4"],
  ["Data Isolation", "Strict tenant-isolated data residency ensuring in-house bench data never leaks or trains global foundation models.", "Tenant Data Security standard §1.2"]
];

currY = drawTable(gov1Cols, gov1Rows, currY);

drawFooter(13, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 14: REGULATORY Submission OUTLOOK
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader("REGULATORY SUBMISSION OUTLOOK");

currY = 28;
currY = drawSectionHeading("12.0", "Regulatory Submission Standards & ICH Guidelines", currY);

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const gov2Desc = doc.splitTextToSize(
  "Preclinical developability profiles are mapped directly to global regulatory submission checklists, establishing clear go/no-go safety gates aligned with FDA, ICH, and USP standards.",
  pageWidth - 30
);
doc.text(gov2Desc, 15, currY);
currY += 14;

const gov2Cols = [
  { header: "Regulatory Milestone", width: 45 },
  { header: "Required Preclinical Studies & Target Guidelines", width: 95 },
  { header: "Relevant Authority", width: 40 }
];

const gov2Rows = [
  ["FDA Peptide ANDA (2021)", "Demonstrate equivalent primary sequence, secondary structure, aggregate profile, and immunogenicity to the Reference Listed Drug.", "FDA Center for Drug Evaluation"],
  ["ICH S6(R1) Biologics", "Mandates preclinical safety evaluation in one relevant species (typically Cynomolgus monkey) for Monoclonal Antibodies.", "International Council for Harmonisation"],
  ["FDA TCR Panels (2007)", "Mandates Tissue Cross-Reactivity (TCR) testing on 38 human tissue panels to identify off-target monoclonal antibody binding.", "FDA Center for Biologics"],
  ["USP Chapter <121.1>", "Defines standardized physicochemical analytical procedures for recombinant and synthetic peptide therapeutics.", "United States Pharmacopeia"],
  ["ICH Q6B Specifications", "Defines specifications, purity metrics, and biophysical characterization standards for biotechnological/biological products.", "International Council for Harmonisation"]
];

currY = drawTable(gov2Cols, gov2Rows, currY);

drawFooter(14, totalPages);

// ─────────────────────────────────────────────────────────────────────────────
// SAVE TO FILESYSTEM
// ─────────────────────────────────────────────────────────────────────────────
doc.save("/Users/pranaydinavahi/Downloads/Hakase_BioTwin_Platform_Manifest.pdf");
console.log("PDF Generation Complete!");
