import { jsPDF } from "jspdf";
import * as fs from "fs";

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
  doc.text("HAKASE BIOTWIN  ·  CORE PRECLINICAL DISCOVERY PLATFORM", 15, 9);
  
  setTextColor(colors.accentCyan);
  doc.text("SYSTEM ARCHITECTURE & FEATURE MANIFEST", pageWidth - 15, 9, { align: "right" });
  
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
  doc.text("STRICTLY CONFIDENTIAL  |  CSO & REGULATORY AFFAIRS HANDBOOK", 15, pageHeight - 10);
  doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - 15, pageHeight - 10, { align: "right" });
}

function drawSectionHeading(num: string, title: string, y: number, color = colors.accentPurp): number {
  setFill(colors.slateLight);
  doc.rect(15, y, pageWidth - 30, 8, "F");
  
  setFill(color);
  doc.rect(15, y, 2, 8, "F");
  
  setTextColor(colors.headingText);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`${num}. ${title}`, 20, y + 5.5);
  
  return y + 14;
}

function drawSubsectionHeading(title: string, y: number): number {
  setTextColor(colors.accentPurp);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(title, 15, y);
  
  setStroke(colors.borderLight);
  doc.line(15, y + 2, pageWidth - 15, y + 2);
  
  return y + 7;
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

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 1: COVER PAGE
// ─────────────────────────────────────────────────────────────────────────────
// Rich dark navy background cover matching premium design rules
setFill(colors.navyDark);
doc.rect(0, 0, pageWidth, pageHeight, "F");

// Diagonal elegant background styling lines in light blue opacity
setStroke([16, 185, 129]);
doc.setLineWidth(0.5);
doc.line(0, pageHeight * 0.7, pageWidth, pageHeight * 0.4);
doc.line(0, pageHeight * 0.75, pageWidth, pageHeight * 0.45);

// Top badge
setFill(colors.accentCyan);
doc.rect(15, 30, 45, 1, "F");

setTextColor(colors.accentCyan);
doc.setFont("Helvetica", "bold");
doc.setFontSize(10);
doc.text("CORE PLATFORM TECHNICAL DOCUMENTATION", 15, 25);

// Title
setTextColor(colors.white);
doc.setFont("Helvetica", "bold");
doc.setFontSize(38);
doc.text("Hakase BioTwin", 15, 55);

setTextColor(colors.accentCyan);
doc.setFontSize(18);
doc.text("Preclinical AI Discovery Engine", 15, 68);

// Subtitle/Brief
setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(11);
setTextColor([160, 174, 192]); // soft silvery text
const descLines = doc.splitTextToSize(
  "A comprehensive modality feature, background logic, computational algorithm, and source database manifest. Documenting Layer 1 in silico & ex vivo developability, Layer 2 structural confirmation, Layer 3 multi-species PBPK scaling, and Layer 4 first-in-human readiness with sealed HAIOps governance standards.",
  pageWidth - 35
);
doc.text(descLines, 15, 82);

// Technical Specs Panel (Glassmorphic border representation)
setFill([20, 27, 45]);
doc.rect(15, 120, pageWidth - 30, 80, "F");
setStroke([45, 55, 72]);
doc.rect(15, 120, pageWidth - 30, 80, "D");

setTextColor(colors.white);
doc.setFont("Helvetica", "bold");
doc.setFontSize(10.5);
doc.text("PLATFORM DEPLOYMENT SPECIFICATIONS", 20, 128);

setStroke([45, 55, 72]);
doc.line(20, 131, pageWidth - 20, 131);

setTextColor([160, 174, 192]);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);

let specY = 138;
const specs = [
  ["Platform Version", "v2.6.4 (Commercial Release - May 2026 Restructure)"],
  ["Scope of Audits", "Small Molecules, Purified Peptides, Monoclonal Antibodies & Fragments"],
  ["HAIOps Standard", "Governance Compliance Standard §5.7 (Sealed Provenance Chains)"],
  ["AI Foundation", "ADMET-AI (GNN), Binding-ML (Morgan/ESM-2), ESM-2/ANARCI developability"],
  ["Verified Databases", "ChEMBL v33, DrugCentral v2025, OpenFDA, PDB/UniProt, FDA Bioequivalence PSG"],
];

specs.forEach(([label, value]) => {
  doc.setFont("Helvetica", "bold");
  doc.text(label, 20, specY);
  doc.setFont("Helvetica", "normal");
  doc.text(value, 60, specY);
  specY += 9;
});

// Footer of Cover Page
setTextColor([160, 174, 192]);
doc.setFont("Helvetica", "bold");
doc.setFontSize(8.5);
doc.text("CONFIDENTIAL  |  FOR CSO, BOARD OF DIRECTORS, & REGULATORY AUDITORS ONLY", 15, pageHeight - 20);
doc.setFont("Helvetica", "normal");
doc.setFontSize(7.5);
doc.text("© 2026 Hakase AI Inc. All rights reserved. Sealed evidence chains are mathematically tamper-evident.", 15, pageHeight - 15);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 2: TABLE OF CONTENTS & SYSTEM CORE ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader();

let currY = 28;
setTextColor(colors.headingText);
doc.setFont("Helvetica", "bold");
doc.setFontSize(18);
doc.text("Table of Contents & Core Architecture", 15, currY);
currY += 4;

setStroke(colors.accentCyan);
doc.line(15, currY, 60, currY);
currY += 10;

// Table of Contents Box
setFill(colors.slateLight);
doc.rect(15, currY, pageWidth - 30, 48, "F");

setTextColor(colors.headingText);
doc.setFont("Helvetica", "bold");
doc.setFontSize(9);
doc.text("DOCUMENT OUTLINE", 20, currY + 6);
doc.line(20, currY + 8, pageWidth - 20, currY + 8);

const toc = [
  ["1. Small Molecule Modality", "Page 3", "RDKit QSPR, ADMET-AI Graph Neural Networks, ChEMBL affinity databases"],
  ["2. Peptide Modality", "Page 4", "Debye-Hückel pH salt screening, Chou-Fasman, Proteolysis cleavage maps, GFR clearance"],
  ["3. Antibody Modality", "Page 5", "ANARCI IMGT localizer, TAP developability flags, subclass FcRn scaling, Cyno/Mouse half-life"],
  ["4. Preclinical Governance & Compliance", "Page 6", "HAIOps §5.7 SHA-256 evidence chain, FDA synthetic peptide / ICH S6(R1) guidelines"],
];

let tocY = currY + 14;
toc.forEach(([title, page, note]) => {
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  setTextColor(colors.accentPurp);
  doc.text(title, 20, tocY);
  
  doc.setFont("Helvetica", "bold");
  setTextColor(colors.headingText);
  doc.text(page, pageWidth - 20, tocY, { align: "right" });
  
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7.5);
  setTextColor(colors.neutralText);
  doc.text(note, 20, tocY + 4);
  
  tocY += 10;
});

currY += 60;

currY = drawSectionHeading("System Core", "The Four Preclinical Layers", currY);

// Narrative on layers
setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8.5);
const layersDesc = doc.splitTextToSize(
  "Hakase BioTwin orchestrates preclinical drug discovery by segmenting computational predictions, wet-lab assay overlays, and multi-species kinetic scaling into four decoupled verification gates. This structure prevents premature in vivo modeling on compounds with fatal developability liabilities, saving millions in pre-clinical CRO expenditures.",
  pageWidth - 30
);
doc.text(layersDesc, 15, currY);
currY += 16;

const layersTableCols = [
  { header: "Layer", width: 35 },
  { header: "Focus", width: 50 },
  { header: "Scoring Engine & Core Mechanism", width: 95 }
];

const layersTableRows = [
  [
    "L1: In Vitro Twin",
    "Intrinsic Developability",
    "RDKit QSPR, Debye-Hückel formulation screening, ANARCI CDR annotations, ADMET-AI Graph Neural Network (GNN) descriptors, ChEMBL target suggestions."
  ],
  [
    "L2: Confirmation",
    "Structural Verification",
    "AlphaFold-DB/PDB structure matching, AutoDock Vina target docking, ESM-2 biological representation, opt-in RunPod FEP binding energy calculations."
  ],
  [
    "L3: Animal Cohort",
    "Allometric scaling & PBPK",
    "Rat, Dog, Cynomolgus multi-species Physiologically Based Pharmacokinetics. Obach fu_mic correction. Human-Equivalent Dose scaling (ICH M3(R2))."
  ],
  [
    "L4: FIH Readiness",
    "IND Submission & Safety",
    "MABEL safety factors, GLP tox checklist, tissue cross-reactivity requirements, anti-drug antibody screening packages. Regulatory submission Dossier."
  ]
];

currY = drawTable(layersTableCols, layersTableRows, currY);

drawFooter(2, 6);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 3: MODALITY 1 — SMALL MOLECULE ARCHITECTURE
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader();

currY = 28;
setTextColor(colors.headingText);
doc.setFont("Helvetica", "bold");
doc.setFontSize(16);
doc.text("Modality 1: Small Molecule Computational Engine", 15, currY);
currY += 4;

setStroke(colors.accentCyan);
doc.line(15, currY, 90, currY);
currY += 8;

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8);
const smIntro = doc.splitTextToSize(
  "The small molecule modality integrates graph-neural networks and classical substructure-based rules to project absorption, distribution, metabolism, excretion, and toxicity. Binding affinities are derived from Morgan-fingerprint alignments validated against historical wet-lab databases.",
  pageWidth - 30
);
doc.text(smIntro, 15, currY);
currY += 12;

currY = drawSectionHeading("1.1", "Physicochemical & Classical ADMET Calculations", currY);

const smPhysCols = [
  { header: "Computational Metric", width: 45 },
  { header: "Algorithm / Core Model", width: 70 },
  { header: "Source Database / Reference", width: 65 }
];

const smPhysRows = [
  ["Molecular Weight (MW)", "Exact atomic mass summing formula based on standard atomic weights.", "IUPAC Atomic Weights 2016"],
  ["Octanol-water partition (LogP)", "Wildman-Crippen group contribution method (SlogP) via RDKit.", "Wildman & Crippen 1999 (J. Chem. Inf.)"],
  ["Polar Surface Area (TPSA)", "Topological Polar Surface Area based on fragment contributions.", "Ertl et al. 2000 (J. Med. Chem.)"],
  ["H-Bond Donors & Acceptors", "Lipinski criteria counting OH/NH groups (donors) and N/O atoms (acceptors).", "Lipinski 1997 Rule of 5 (Adv. Drug Deliv)"],
  ["Rotatable Bonds count", "Counts non-terminal, single non-ring bonds between non-hydrogen atoms.", "Veber 2002 Oral Permeability Rules"],
  ["Aqueous Solubility (LogS)", "Heuristic QSPR model trained on measured thermodynamic solubility.", "AqSolDB (Sorkun et al. 2019)"],
];

currY = drawTable(smPhysCols, smPhysRows, currY);

currY = drawSectionHeading("1.2", "Advanced ML & ADMET-AI Graph Neural Networks", currY);

const smMlCols = [
  { header: "ML Endpoint", width: 45 },
  { header: "Neural Network Architecture & Feature Representation", width: 90 },
  { header: "Training Corpus size & accuracy", width: 45 }
];

const smMlRows = [
  ["Caco2 Cell Permeability", "Chemprop GNN combining message-passing over molec. graphs with 200 classical descriptors.", "Wang et al. (12,000 compound set)"],
  ["PPB (Plasma Protein Binding)", "Ridge Regression trained on Morgan/RDKit molecular fingerprints.", "AstraZeneca PPBR set (8,500 drug set)"],
  ["CYP Inhib. panel (5 isoforms)", "Consensus Multi-Task Deep Neural Network (DNN) classifying 1A2/2C9/2C19/2D6/3A4.", "NCATS Assay BioAssay (17,000 compound set)"],
  ["hERG Cardiac QT risk", "Random Forest + Support Vector Machine classifiers scoring blocker probability.", "FDA CardioTox-ML (Karim 2016)"],
  ["DILI (Drug Induced Liver Injury)", "Gradient Boosted Decision Trees trained on FDA DILIrank annotations.", "FDA DILIrank (1,030 approved drugs)"],
  ["AMES Mutagenicity", "Message-passing neural network classifying mutagenic risk.", "Hansen AMES mutagenicity set (6,500 compounds)"]
];

currY = drawTable(smMlCols, smMlRows, currY);

drawFooter(3, 6);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 4: MODALITY 2 — PEPTIDE BIOPHYSICS & CLEARANCE
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader();

currY = 28;
setTextColor(colors.headingText);
doc.setFont("Helvetica", "bold");
doc.setFontSize(16);
doc.text("Modality 2: Peptide Biophysical & Formulatory Engine", 15, currY);
currY += 4;

setStroke(colors.accentCyan);
doc.line(15, currY, 90, currY);
currY += 8;

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8);
const pepIntro = doc.splitTextToSize(
  "The peptide discovery engine targets synthetic, cyclic, and therapeutic peptides up to 5,000 residues. It calculates Debye-Hückel shielded electrostatics, proteolytic cleavage mapping across nine digestive enzymes, and maps synthesis, aggregation, and MHC immunogenicity profiles.",
  pageWidth - 30
);
doc.text(pepIntro, 15, currY);
currY += 12;

currY = drawSectionHeading("2.1", "Formulation & Preclinical Environment Mechanics", currY);

const pepFormCols = [
  { header: "Biophysical Metric", width: 45 },
  { header: "Mathematical Model & Computational Logic", width: 85 },
  { header: "Ground Truth / References", width: 50 }
];

const pepFormRows = [
  ["Net Charge vs pH Curve", "Henderson-Hasselbalch equations summing ionisable side chain pKa values (D, E, H, C, Y, K, R).", "Bjellqvist 1993, pKa values of amino acids"],
  ["Debye-Hückel Shielding", "Calculates electrostatic screening: kappa = 0.329 * sqrt(Ionic Strength). Modulates aggregate index.", "Debye & Hückel 1923 (Physik Z.)"],
  ["Disulfide Bridges Map", "Validates sequence coordinates, subtracts cystines from free thiols, modifies coupling difficulty.", "Standard Cystine Thiol Chemistry rules"],
  ["Free Cysteine Liabilities", "Flags unpaired thiols vulnerable to oxidation, disulfide scrambling, or dimerisation.", "USP / FDA Impurity Guidances"],
  ["Aqueous Solubility (LogS)", "Debye-Hückel modulated solubility based on distance from pI and hydrophobic fraction.", "Eisenberg Hydrophobicity scales"],
];

currY = drawTable(pepFormCols, pepFormRows, currY);

currY = drawSectionHeading("2.2", "Developability, Proteolysis, & IVIVE Cascades", currY);

const pepDevCols = [
  { header: "Engine Module", width: 40 },
  { header: "Algorithmic Rules, Models, & Cleavage Logic", width: 95 },
  { header: "Target Databases", width: 45 }
];

const pepDevRows = [
  ["Proteolytic Stability", "Scans sequence for cleavage motifs of 9 distinct proteases (Trypsin, Chymotrypsin, Pepsin, Elastase, etc.)", "ExPASy PeptideCutter criteria"],
  ["AGGRESCAN Hotspots", "Translates sequence to a 3D-hydrophobic aggregation propensity score per residue.", "Conchillo-Sole 2007 (AGGRESCAN)"],
  ["Synthesis Feasibility", "Calculates coupling difficulties based on beta-branched density, aggregation, and MW.", "Solid-Phase Peptide Synthesis (SPPS)"],
  ["MHC-Immunogenicity", "Scans sequence for potential T-cell agretope windows fitting MHC II binding clefts.", "IEDB (Immune Epitope DB) consensus"],
  ["GFR + Hepatic IVIVE", "Renal filtration clearance (MW cutoff ~30 kDa) combined with well-stirred liver model obach-corrections.", "Obach 1999, Lombardo 2018"]
];

currY = drawTable(pepDevCols, pepDevRows, currY);

drawFooter(4, 6);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 5: MODALITY 3 — ANTIBODY DEVELOPABILITY & ISOTYPES
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader();

currY = 28;
setTextColor(colors.headingText);
doc.setFont("Helvetica", "bold");
doc.setFontSize(16);
doc.text("Modality 3: Monoclonal Antibody & Fragment Engine", 15, currY);
currY += 4;

setStroke(colors.accentCyan);
doc.line(15, currY, 95, currY);
currY += 8;

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8);
const abIntro = doc.splitTextToSize(
  "The antibody engine triages large construct IgGs and recombinant fragments (VHH, scFv, Fab). It utilizes IMGT-anchored alignment schemes to map complementarity-determining regions and highlights position-specific liabilities, TAP manufacturability flags, and FcRn-recycling pharmacokinetic models.",
  pageWidth - 30
);
doc.text(abIntro, 15, currY);
currY += 12;

currY = drawSectionHeading("3.1", "CDR Localization & Position-Specific Liabilities", currY);

const abCdrCols = [
  { header: "Computational Feature", width: 45 },
  { header: "Localization Algorithm & Motifs Evaluated", width: 85 },
  { header: "Verification Standards", width: 50 }
];

const abCdrRows = [
  ["CDR Localization", "ANARCI alignment assigning IMGT canonical numbering to heavy & light variable domains.", "IMGT numbering (Lefranc et al. 2003)"],
  ["Deamidation Hotspots", "Identifies asparagine residues followed by glycine/serine (NG, NS motifs) within CDR loops.", "TAP (Therapeutic Antibody Profiler) guidelines"],
  ["Isomerisation Hotspots", "Identifies aspartic acid residues followed by glycine (DG motifs) susceptible to isomerization.", "TAP (Therapeutic Antibody Profiler) guidelines"],
  ["Oxidation Hotspots", "Identifies methionine/tryptophan residues exposed within CDR loops susceptible to ROS.", "TAP (Therapeutic Antibody Profiler) guidelines"],
  ["N-Glycosylation Triages", "Identifies consensus NXS/T motifs; evaluates glycosylation based on bioprocess host machinery.", "Host cell line Glycosylation databases"],
];

currY = drawTable(abCdrCols, abCdrRows, currY);

currY = drawSectionHeading("3.2", "TAP Developability, FcRn, & Subclass PK Scaling", currY);

const abTapCols = [
  { header: "Bioprocess Endpoint", width: 45 },
  { header: "Subclass, Isotype, & Construct Clearance Calculations", width: 90 },
  { header: "References / Databases", width: 45 }
];

const abTapRows = [
  ["Construct MW modeling", "Computes molecular weight based on antibody format (VHH ~15 kDa, scFv ~27 kDa, Fab ~50 kDa, IgG ~150 kDa).", "Construct sequence maps"],
  ["Glomerular Renal GFR", "mAbs under 60 kDa (Fab, scFv, VHH) clear rapidly via kidneys; IgGs are retained by size filtration.", "Glomerular Filtration Rate criteria"],
  ["FcRn-Mediated Recycling", "IgG1, IgG2, IgG4 exhibit active FcRn pH-switch recycling; IgG3 is compromised (7d); fragments are excluded.", "H435 FcRn binding polymorphism"],
  ["AGGRESCAN Hotspots", "MAPPED AGGRESCAN algorithm focused specifically on CDR framework hot-spot aggregation.", "Conchillo-Sole 2007 (AGGRESCAN)"],
  ["TAP-Style Flags", "Grades antibody sequence against 5 key developability parameters (TAP benchmarks).", "TAP (Therapeutic Antibody Profiler) 2019"]
];

currY = drawTable(abTapCols, abTapRows, currY);

drawFooter(5, 6);

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 6: HAIOPS PRECLINICAL GOVERNANCE & REGULATORY AFFAIRS
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage();
drawHeader();

currY = 28;
setTextColor(colors.headingText);
doc.setFont("Helvetica", "bold");
doc.setFontSize(16);
doc.text("HAIOps Preclinical Governance & Regulatory Affairs", 15, currY);
currY += 4;

setStroke(colors.accentCyan);
doc.line(15, currY, 110, currY);
currY += 8;

setTextColor(colors.neutralText);
doc.setFont("Helvetica", "normal");
doc.setFontSize(8);
const govIntro = doc.splitTextToSize(
  "Every pre-clinical simulation generates a tamper-evident audit signature mapped to standard HAIOps compliance criteria. The platform ensures that all computational predictions, custom env parameters, and overrides are logged, citable, and mapped directly to global IND-enabling regulatory requirements.",
  pageWidth - 30
);
doc.text(govIntro, 15, currY);
currY += 12;

currY = drawSectionHeading("4.1", "HAIOps Computational Integrity & Evidence Chains", currY);

const govHaiCols = [
  { header: "Governance Feature", width: 45 },
  { header: "Underlying Compliance Logic & Implementation", width: 90 },
  { header: "HAIOps Standard / Rule", width: 45 }
];

const govHaiRows = [
  ["SHA-256 Evidence Chain", "Generates cryptographic hashes of the input sequence, parameters, and results, preventing post-hoc data tampering.", "HAIOps Preclinical Standard §5.7"],
  ["Reviewer Override Log", "Requires formal CSO / Regulatory Affairs justification when overriding blocked stage-gates. Saves audit trail.", "HAIOps Preclinical Standard §5.7"],
  ["Provenanc e Attributions", "Categorizes every displayed result into four distinct tiers: exact formula, calculated, rule-based, or heuristic.", "Provenance Tracking standard §2.1"],
  ["Consensus Verification", "Compares independent model predictions (e.g. biophysical calculations vs GNN models) to calculate a validation score.", "Algorithmic Consensus standard §3.4"],
  ["Data Isolation", "Strict tenant-isolated data residency ensuring in-house bench data never leaks or trains global foundation models.", "Tenant Data Security standard §1.2"]
];

currY = drawTable(govHaiCols, govHaiRows, currY);

currY = drawSectionHeading("4.2", "Regulatory Submission Standards & ICH Guidelines", currY);

const govRegCols = [
  { header: "Regulatory Milestone", width: 45 },
  { header: "Required Preclinical Studies & Target Guidelines", width: 90 },
  { header: "Relevant Authority", width: 45 }
];

const govRegRows = [
  ["FDA Peptide ANDA (2021)", "Demonstrate equivalent primary sequence, secondary structure, aggregate profile, and immunogenicity to the Reference Listed Drug.", "FDA Center for Drug Evaluation"],
  ["ICH S6(R1) Biologics", "Mandates preclinical safety evaluation in one relevant species (typically Cynomolgus monkey) for Monoclonal Antibodies.", "International Council for Harmonisation"],
  ["FDA TCR Panels (2007)", "Mandates Tissue Cross-Reactivity (TCR) testing on 38 human tissue panels to identify off-target monoclonal antibody binding.", "FDA Center for Biologics"],
  ["USP Chapter <121.1>", "Defines standardized physicochemical analytical procedures for recombinant and synthetic peptide therapeutics.", "United States Pharmacopeia"],
  ["ICH Q6B Specifications", "Defines specifications, purity metrics, and biophysical characterization standards for biotechnological/biological products.", "International Council for Harmonisation"]
];

currY = drawTable(govRegCols, govRegRows, currY);

drawFooter(6, 6);

// ─────────────────────────────────────────────────────────────────────────────
// SAVE TO FILESYSTEM
// ─────────────────────────────────────────────────────────────────────────────
doc.save("/Users/pranaydinavahi/Downloads/Hakase_BioTwin_Platform_Manifest.pdf");
console.log("PDF Generation Complete!");
