import { hasSubstructure } from "./chemistry";

export interface MechanisticToxicity {
  organ: string;
  risk: "High" | "Moderate" | "Low";
  structuralAlert: string;
  aopId: string;
  aopChain: string[];
  mechanism: string;
  mitigationStrategy: string;
  confidence: number;
}

export interface BioactivationPathway {
  alertName: string;
  structuralMotif: string;
  cypEnzyme: string;
  reactiveIntermediate: string;
  targetMacromolecule: string;
  detoxPathway: string;
  riskLevel: "High" | "Moderate" | "Low";
  clinicalRelevance: string;
}

export interface BioactivationAssessment {
  overallBioactivationRisk: "High" | "Moderate" | "Low";
  totalAlertsDetected: number;
  mechanisticToxicities: MechanisticToxicity[];
  bioactivationPathways: BioactivationPathway[];
  gshTrappingRecommended: boolean;
  recommendedStudies: string[];
  metabolicSoftSpots: MetabolicSoftSpot[];
}

export interface MetabolicSoftSpot {
  position: string;
  moiety: string;
  primaryCyp: string;
  metaboliteType: string;
  reactivityRisk: "Reactive" | "Stable";
}

interface MolInput {
  smiles: string;
  molecularWeight: number;
  logP: number;
  tpsa: number;
  hbdCount: number;
  hbaCount: number;
  rotatableBonds: number;
}

interface InVitroInput {
  hergRisk: "High" | "Moderate" | "Low";
  microsomalCLint: number;
  cypInhibition: { [key: string]: { ic50_uM: number; risk: string } };
  fuPercent: number;
  caco2Papp: number;
  ic50_nM: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface StructuralAlertDef {
  name: string;
  motifDescription: string;
  /**
   * SMARTS patterns that identify the structural motif. The alert fires only
   * when the molecule actually contains at least one of these substructures
   * (real RDKit substruct match — never stochastic). This is the anti-
   * fabrication invariant: an alert with no motif present must NEVER fire.
   */
  motifSmarts: string[];
  /**
   * Literature-prior confidence (0–1) for this AOP, anchored on published
   * clinical evidence (e.g. NAPQI/acetaminophen ≈ 0.95; arene oxide ≈ 0.60
   * because most aromatic rings are not appreciably epoxidized in vivo).
   * Modulated at runtime by logP / CL_int / hERG signal — never randomized.
   */
  literatureConfidence: number;
  organ: string;
  aopId: string;
  aopChain: string[];
  mechanism: string;
  mitigation: string;
  bioactivation: {
    cypEnzyme: string;
    reactiveIntermediate: string;
    targetMacromolecule: string;
    detoxPathway: string;
    clinicalRelevance: string;
  };
  softSpot: {
    moiety: string;
    metaboliteType: string;
  };
}

const STRUCTURAL_ALERTS: StructuralAlertDef[] = [
  {
    name: "Aniline / Aromatic Amine",
    motifDescription: "Ar-NH₂ or Ar-NHR",
    motifSmarts: ["[NX3;H1,H2;$(Nc);!$(NC=O)]"],
    literatureConfidence: 0.75,
    organ: "Liver",
    aopId: "AOP-18",
    aopChain: [
      "CYP1A2 N-oxidation of aromatic amine",
      "Hydroxylamine intermediate formation",
      "Nitroso metabolite generation",
      "Covalent binding to hepatic proteins (CYP, GST)",
      "Mitochondrial dysfunction & oxidative stress",
      "Hepatocyte necrosis / immune-mediated DILI"
    ],
    mechanism: "Aromatic amines undergo CYP1A2-mediated N-hydroxylation to form hydroxylamine intermediates. These are further oxidized to reactive nitroso species that covalently bind to hepatic proteins, triggering mitochondrial dysfunction, oxidative stress, and either direct hepatocyte necrosis or immune-mediated drug-induced liver injury (DILI). The haptenization of liver proteins can also trigger idiosyncratic immune responses via HLA-mediated pathways.",
    mitigation: "Consider N-methylation or N-acetylation to block N-oxidation. GSH trapping assay recommended to quantify reactive metabolite formation. Monitor ALT/AST in early clinical studies.",
    bioactivation: {
      cypEnzyme: "CYP1A2 (primary), CYP3A4 (secondary)",
      reactiveIntermediate: "Hydroxylamine → Nitroso metabolite",
      targetMacromolecule: "Hepatic proteins (CYP450, glutathione S-transferase)",
      detoxPathway: "NAT2 acetylation, UGT glucuronidation of hydroxylamine",
      clinicalRelevance: "Associated with idiosyncratic DILI; incidence 1:1,000–1:10,000. Risk increased in slow NAT2 acetylators."
    },
    softSpot: { moiety: "Aromatic amine (Ar-NH₂)", metaboliteType: "N-hydroxylamine" }
  },
  {
    name: "Quinone / Hydroquinone",
    motifDescription: "1,4-dihydroxybenzene or catechol",
    motifSmarts: ["c1cc(O)c(O)cc1", "Oc1ccc(O)cc1", "c1cc(O)ccc1O"],
    literatureConfidence: 0.85,
    organ: "Liver / Bone Marrow",
    aopId: "AOP-220",
    aopChain: [
      "CYP-mediated or auto-oxidation to quinone",
      "Michael addition with protein cysteine thiols",
      "NRF2/KEAP1 pathway disruption",
      "Glutathione depletion & oxidative stress cascade",
      "Mitochondrial permeability transition",
      "Apoptosis / necroptosis in hepatocytes or hematopoietic cells"
    ],
    mechanism: "Catechol and hydroquinone moieties undergo two-electron oxidation (CYP-mediated or autoxidation) to form electrophilic quinones. These undergo Michael addition with nucleophilic cysteine residues on KEAP1, disrupting the NRF2 antioxidant response. Concurrent GSH depletion amplifies oxidative stress, leading to mitochondrial permeability transition and cell death. In bone marrow, myeloperoxidase-driven quinone formation causes hematopoietic toxicity.",
    mitigation: "O-methylation of catechol to block quinone formation. Evaluate with GSH trapping and cyanide trapping assays. Consider replacing phenol with bioisostere (pyridine N-oxide).",
    bioactivation: {
      cypEnzyme: "CYP3A4 / CYP1A2 (oxidation), Myeloperoxidase (bone marrow)",
      reactiveIntermediate: "para-Quinone or ortho-Quinone",
      targetMacromolecule: "KEAP1 cysteine residues, GSH, topoisomerase II",
      detoxPathway: "NQO1 (quinone reductase) two-electron reduction, GSH conjugation via GSTP1",
      clinicalRelevance: "Benzene-derived quinones linked to aplastic anemia. Catechol drugs (entacapone) require GSH monitoring."
    },
    softSpot: { moiety: "Catechol / Hydroquinone", metaboliteType: "Quinone" }
  },
  {
    name: "Thiophene S-Oxidation",
    motifDescription: "Thiophene ring system",
    motifSmarts: ["c1ccsc1", "s1cccc1"],
    literatureConfidence: 0.80,
    organ: "Liver",
    aopId: "AOP-34",
    aopChain: [
      "CYP2C9/CYP3A4 S-oxidation of thiophene",
      "Thiophene S-oxide (epoxide equivalent) formation",
      "Ring-opening to reactive thioaldehyde",
      "Covalent protein adduct formation",
      "Immune-mediated hepatotoxicity (hapten hypothesis)",
      "Cholestatic or mixed hepatocellular injury"
    ],
    mechanism: "Thiophene rings are oxidized by CYP2C9 or CYP3A4 to form thiophene S-oxides — electrophilic intermediates equivalent to epoxides. These can ring-open to generate reactive thioaldehyde species that form covalent adducts with liver proteins. The resulting neo-antigens trigger adaptive immune responses, leading to delayed-onset (2–12 weeks) immune-mediated hepatotoxicity with a cholestatic or mixed pattern.",
    mitigation: "Replace thiophene with oxazole, pyridine, or thiazole bioisostere. If thiophene is essential for activity, block the 2,5-positions to prevent epoxidation. Perform radiolabeled ADME to quantify covalent binding.",
    bioactivation: {
      cypEnzyme: "CYP2C9 (primary), CYP3A4 (secondary)",
      reactiveIntermediate: "Thiophene S-oxide → Thioaldehyde",
      targetMacromolecule: "Hepatic proteins (covalent adducts trigger immune response)",
      detoxPathway: "GSH conjugation of S-oxide intermediate, epoxide hydrolase",
      clinicalRelevance: "Tienilic acid withdrawn due to thiophene bioactivation → autoimmune hepatitis. Ticlopidine carries black-box warning."
    },
    softSpot: { moiety: "Thiophene ring (C2-C5 bond)", metaboliteType: "S-oxide / thioaldehyde" }
  },
  {
    name: "Acyl Glucuronide Reactivity",
    motifDescription: "Carboxylic acid (forms reactive acyl glucuronide)",
    motifSmarts: ["[CX3](=O)[OX2H1]"],
    literatureConfidence: 0.70,
    organ: "Liver / GI Tract",
    aopId: "AOP-150",
    aopChain: [
      "UGT-catalyzed glucuronidation of carboxylic acid",
      "Acyl migration (1→2, 1→3, 1→4 positional isomers)",
      "Ring-opened aldehyde intermediate exposure",
      "Schiff base formation with protein lysine residues",
      "Protein-drug adduct (neo-antigen) formation",
      "Delayed hypersensitivity / GI ulceration"
    ],
    mechanism: "Carboxylic acid drugs are conjugated by UGT enzymes to form 1-O-acyl glucuronides. These undergo spontaneous acyl migration producing positional isomers with exposed aldehyde groups. The aldehyde intermediates form Schiff bases with lysine residues on albumin and tissue proteins, creating drug-protein adducts. These neo-antigens can trigger delayed-type hypersensitivity reactions. In the GI tract, local acyl glucuronide hydrolysis regenerates the parent acid, causing mucosal irritation.",
    mitigation: "Assess acyl glucuronide stability (t½ in pH 7.4 buffer). If t½ < 2 hours, consider prodrug strategy or ester bioisostere. Measure covalent binding to human serum albumin in vitro.",
    bioactivation: {
      cypEnzyme: "UGT1A1, UGT1A3, UGT2B7 (phase II — not CYP-mediated)",
      reactiveIntermediate: "Acyl glucuronide → Aldehyde (via acyl migration / ring opening)",
      targetMacromolecule: "Albumin lysine residues, tissue proteins",
      detoxPathway: "Direct renal excretion of stable glucuronide, esterase hydrolysis back to parent",
      clinicalRelevance: "Diclofenac acyl glucuronide linked to rare hepatotoxicity. Zomepirac and benoxaprofen withdrawn. FDA guidance recommends acyl glucuronide stability testing."
    },
    softSpot: { moiety: "Carboxylic acid (-COOH)", metaboliteType: "Acyl glucuronide" }
  },
  {
    name: "Epoxide Formation (Arene Oxide)",
    motifDescription: "Unsubstituted aromatic ring susceptible to CYP epoxidation",
    // Phenyl ring with at least 3 unsubstituted aromatic carbons — broad
    // benzene/naphthalene-style ring susceptible to CYP arene-oxide formation.
    // Excludes already-substituted electron-poor systems by requiring [cH].
    motifSmarts: ["[cH]1[cH][cH][cH]cc1", "c1ccc2ccccc2c1"],
    literatureConfidence: 0.60,
    organ: "Liver / Skin",
    aopId: "AOP-107",
    aopChain: [
      "CYP3A4/CYP1A2 epoxidation of aromatic ring",
      "Arene oxide (epoxide) intermediate formation",
      "Covalent binding to DNA (guanine N7) and proteins",
      "DNA adduct → mutagenesis / carcinogenesis pathway",
      "Protein adduct → immune-mediated skin reactions (SJS/TEN)",
      "Hepatocellular damage or cutaneous hypersensitivity"
    ],
    mechanism: "Unsubstituted aromatic rings undergo CYP-mediated epoxidation to form arene oxides (epoxide intermediates). If not detoxified by epoxide hydrolase (mEH) or GSH conjugation, these electrophiles alkylate DNA at guanine N7 positions, initiating mutagenic cascades. Protein adduct formation on keratinocyte and hepatocyte surfaces can trigger severe immune-mediated reactions. The balance between bioactivation (CYP) and detoxification (mEH, GST) determines individual susceptibility.",
    mitigation: "Fluorine substitution at the metabolically vulnerable position blocks epoxidation. Evaluate Ames test and in vitro micronucleus assay. GSH trapping with LC-MS/MS to detect epoxide intermediates.",
    bioactivation: {
      cypEnzyme: "CYP3A4 (primary), CYP1A2, CYP2E1",
      reactiveIntermediate: "Arene oxide (epoxide)",
      targetMacromolecule: "DNA (guanine N7), hepatic and keratinocyte proteins",
      detoxPathway: "Microsomal epoxide hydrolase (mEH) → dihydrodiol, GST-mediated GSH conjugation",
      clinicalRelevance: "Carbamazepine arene oxide linked to SJS/TEN (HLA-B*15:02). Phenytoin epoxide causes fetal hydantoin syndrome."
    },
    softSpot: { moiety: "Unsubstituted aromatic ring", metaboliteType: "Arene oxide (epoxide)" }
  },
  {
    name: "Nitroaromatic Reduction",
    motifDescription: "Ar-NO₂ (nitro group on aromatic ring)",
    motifSmarts: ["c[NX3](=O)=O", "c[N+](=O)[O-]"],
    literatureConfidence: 0.90,
    organ: "Liver / Bladder",
    aopId: "AOP-262",
    aopChain: [
      "Nitroreductase / CYP-mediated nitro reduction",
      "Nitroso intermediate → Hydroxylamine formation",
      "N-O heterolytic cleavage → Nitrenium ion",
      "DNA adduct formation (guanine C8)",
      "Mutagenesis → Bladder carcinogenesis",
      "Methemoglobin formation (blood toxicity)"
    ],
    mechanism: "Nitroaromatic groups are reduced by intestinal nitroreductases and hepatic CYP reductase through a cascade: nitro → nitroso → hydroxylamine → amine. The hydroxylamine intermediate undergoes O-acetylation (NAT1/NAT2) followed by heterolytic cleavage to generate a highly reactive nitrenium ion. This electrophile forms C8-guanine DNA adducts, particularly concentrated in bladder epithelium due to urinary pH-dependent activation, driving bladder carcinogenesis.",
    mitigation: "Replace nitro group with cyano, sulfonamide, or trifluoromethyl. If nitro is pharmacologically essential (e.g., nitazoxanide), ensure rapid clearance to minimize systemic exposure. Ames test mandatory.",
    bioactivation: {
      cypEnzyme: "CYP reductase, intestinal nitroreductases, NAT1/NAT2 (O-acetylation)",
      reactiveIntermediate: "Hydroxylamine → Nitrenium ion",
      targetMacromolecule: "DNA (guanine C8 adducts), hemoglobin (methemoglobin)",
      detoxPathway: "N-acetylation to stable N-acetyl amine, UGT glucuronidation",
      clinicalRelevance: "2-Naphthylamine and benzidine (bladder carcinogens). Chloramphenicol aplastic anemia linked to nitroso metabolite."
    },
    softSpot: { moiety: "Nitro group (Ar-NO₂)", metaboliteType: "Hydroxylamine / Nitrenium ion" }
  },
  {
    name: "α,β-Unsaturated Carbonyl (Michael Acceptor)",
    motifDescription: "Conjugated enone or enal system",
    motifSmarts: ["[CX3]=[CX3][CX3]=O", "C=CC(=O)"],
    literatureConfidence: 0.85,
    organ: "Liver / Kidney",
    aopId: "AOP-131",
    aopChain: [
      "Direct Michael addition (no CYP activation required)",
      "Thiol alkylation of KEAP1 cysteine sensors",
      "NRF2 pathway activation / eventual overwhelm",
      "GSH depletion below critical threshold",
      "Oxidative stress cascade in proximal tubule / hepatocytes",
      "Renal tubular necrosis or centrilobular hepatic necrosis"
    ],
    mechanism: "α,β-Unsaturated carbonyls are intrinsically electrophilic — they undergo direct Michael addition with biological nucleophiles (cysteine, lysine, histidine) without metabolic activation. At low concentrations, this activates protective NRF2 signaling via KEAP1 cysteine modification. At higher exposures, GSH depletion overwhelms antioxidant defenses, triggering oxidative stress-mediated necrosis. Kidney proximal tubules and hepatic centrilobular zones are particularly vulnerable due to high metabolic activity.",
    mitigation: "Reduce electrophilicity by adding steric bulk adjacent to the Michael acceptor, or replace with non-reactive bioisostere. GSH reactivity assay (t½ in 1 mM GSH) should show t½ > 180 min. Consider reversible covalent design if target engagement requires Michael chemistry.",
    bioactivation: {
      cypEnzyme: "None required — intrinsic electrophile (direct-acting)",
      reactiveIntermediate: "Parent compound is the reactive species",
      targetMacromolecule: "KEAP1 Cys151/273/288, GSH, protein thiols globally",
      detoxPathway: "GSH conjugation via GSTP1/GSTM1, aldehyde reductase reduction",
      clinicalRelevance: "Acrolein (combustion product) causes pulmonary and hepatic injury. Many covalent kinase inhibitors (afatinib, osimertinib) use controlled Michael acceptors."
    },
    softSpot: { moiety: "α,β-Unsaturated carbonyl", metaboliteType: "Direct thiol adduct (no metabolic activation)" }
  },
  {
    name: "Furan Ring Oxidation",
    motifDescription: "Furan heterocycle",
    motifSmarts: ["c1ccoc1", "o1cccc1"],
    literatureConfidence: 0.85,
    organ: "Liver",
    aopId: "AOP-38",
    aopChain: [
      "CYP3A4/CYP2D6 oxidation of furan ring",
      "cis-Enedial (butenedial) intermediate formation",
      "Bifunctional crosslinking of protein lysine pairs",
      "Protein aggregation and unfolded protein response (UPR)",
      "ER stress → CHOP-mediated apoptosis",
      "Dose-dependent hepatocellular necrosis"
    ],
    mechanism: "Furan rings undergo CYP-mediated oxidation to form a highly reactive cis-enedial (butenedial) intermediate. This bifunctional electrophile crosslinks proteins by reacting with two lysine residues simultaneously, causing protein aggregation. The accumulation of misfolded proteins triggers endoplasmic reticulum stress via the PERK/ATF4/CHOP pathway, ultimately inducing apoptosis in hepatocytes. Unlike many bioactivation pathways, furan toxicity is dose-dependent rather than idiosyncratic.",
    mitigation: "Replace furan with isoxazole, oxazole, or thiazole. If furan is required, deuterium substitution at the oxidation-susceptible position can slow CYP metabolism (kinetic isotope effect). Perform daily dose assessment — risk increases significantly above 10 mg/day.",
    bioactivation: {
      cypEnzyme: "CYP3A4 (primary), CYP2D6",
      reactiveIntermediate: "cis-Enedial (butenedial)",
      targetMacromolecule: "Protein lysine pairs (bifunctional crosslinking), GSH",
      detoxPathway: "GSH conjugation (mono-GSH and bis-GSH adducts), aldo-keto reductase reduction",
      clinicalRelevance: "Furosemide ototoxicity linked to furan metabolite. Teucrium chamaedrys (germander) hepatitis caused by furan-containing neoclerodanes."
    },
    softSpot: { moiety: "Furan ring (C2-C3 position)", metaboliteType: "cis-Enedial" }
  },
  {
    name: "Methylene Dioxy (MDP) Metabolic Inhibition",
    motifDescription: "Methylenedioxy bridge (-OCH₂O-)",
    // Methylenedioxy (benzodioxole) — fused 5-ring -O-CH2-O- on aromatic ring
    motifSmarts: ["c1ccc2OCOc2c1", "[#6;a][OX2][CH2][OX2][#6;a]"],
    literatureConfidence: 0.85,
    organ: "Liver (CYP Inhibition)",
    aopId: "AOP-445",
    aopChain: [
      "CYP3A4/CYP2D6 oxidation of methylene bridge",
      "Carbene intermediate formation",
      "Quasi-irreversible coordination to CYP heme iron (MI complex)",
      "Mechanism-based CYP inactivation (time-dependent)",
      "Reduced hepatic drug clearance → DDI precipitation",
      "Systemic accumulation of co-administered drugs"
    ],
    mechanism: "The methylenedioxy (MDP) group is oxidized by CYP enzymes to form a reactive carbene intermediate that coordinates quasi-irreversibly with the heme iron of the CYP active site, forming a metabolite-inhibitor (MI) complex. This mechanism-based inactivation (MBI) permanently disables the CYP enzyme until new protein is synthesized (t½ ~36 hours for CYP3A4). The resulting loss of CYP activity causes clinically significant drug-drug interactions by impairing clearance of co-administered CYP substrates.",
    mitigation: "Replace MDP with gem-difluoromethylenedioxy or cyclopentyloxy bioisostere. Conduct time-dependent CYP inhibition assay (pre-incubation shift). Calculate inactivation kinetics (KI, kinact) — report to regulatory agencies.",
    bioactivation: {
      cypEnzyme: "CYP3A4, CYP2D6, CYP1A2",
      reactiveIntermediate: "Carbene → MI (metabolite-inhibitor) complex",
      targetMacromolecule: "CYP heme iron (quasi-irreversible coordination)",
      detoxPathway: "Catechol formation (alternative demethylenation pathway), followed by COMT methylation",
      clinicalRelevance: "Paroxetine (MDP-containing SSRI) — potent CYP2D6 MBI causing drug interactions. MDMA (ecstasy) autoinhibits own CYP2D6 metabolism."
    },
    softSpot: { moiety: "Methylene bridge (-OCH₂O-)", metaboliteType: "Carbene → MI complex" }
  },
  {
    name: "Phenol Oxidation to Quinone-Imine",
    motifDescription: "para-Aminophenol or hydroxylamine adjacent to ring",
    // para-Aminophenol motif (NAPQI precursor — acetaminophen archetype)
    motifSmarts: ["Nc1ccc(O)cc1", "Oc1ccc(N)cc1", "[NX3;H1,H2]c1ccc([OX2H])cc1"],
    literatureConfidence: 0.95,
    organ: "Liver / Skin / Blood",
    aopId: "AOP-96",
    aopChain: [
      "CYP2E1/CYP3A4 oxidation of aminophenol",
      "N-acetyl-p-benzoquinone imine (NAPQI-type) formation",
      "Rapid GSH conjugation (detoxification at therapeutic doses)",
      "GSH depletion at supratherapeutic exposure",
      "Covalent modification of mitochondrial proteins",
      "Mitochondrial permeability transition → hepatocyte necrosis"
    ],
    mechanism: "para-Aminophenol structures undergo two-electron CYP oxidation to form quinone-imine intermediates (analogous to NAPQI from acetaminophen). At therapeutic doses, GSH conjugation efficiently detoxifies these electrophiles. At supratherapeutic exposures, GSH depletion allows quinone-imines to covalently modify mitochondrial proteins (particularly in centrilobular hepatocytes where CYP2E1 is concentrated), triggering the mitochondrial permeability transition, JNK activation, and necrotic cell death.",
    mitigation: "N-acetylcysteine (NAC) rescue protocol if overdose is possible. Block the para-position with fluorine or methyl to prevent oxidation. Therapeutic index assessment critical — ensure safe margin between efficacy dose and GSH depletion threshold.",
    bioactivation: {
      cypEnzyme: "CYP2E1 (primary), CYP3A4 (high-dose pathway)",
      reactiveIntermediate: "Quinone-imine (NAPQI analog)",
      targetMacromolecule: "Mitochondrial proteins (ATP synthase, ANT), GSH",
      detoxPathway: "GSH conjugation → mercapturic acid excretion, sulfation (low-dose pathway)",
      clinicalRelevance: "Acetaminophen (paracetamol) hepatotoxicity — leading cause of acute liver failure in US/UK. NAC antidote restores GSH levels."
    },
    softSpot: { moiety: "para-Aminophenol", metaboliteType: "Quinone-imine (NAPQI-type)" }
  }
];

export function runBioactivationAssessment(
  mol: MolInput,
  ivData: InVitroInput
): BioactivationAssessment {
  // Anti-fabrication invariant: alerts must reflect real substructure
  // matches against the SMILES, never a stochastic seed. If RDKit hasn't
  // loaded (rare — only on cold start before initChemistry resolves), we
  // return an empty assessment instead of fabricating alerts.
  const triggered: StructuralAlertDef[] = [];
  for (const alert of STRUCTURAL_ALERTS) {
    const present = alert.motifSmarts.some(s => hasSubstructure(mol.smiles, s));
    if (present) triggered.push(alert);
  }

  const mechanisticToxicities: MechanisticToxicity[] = triggered.map(a => {
    // Confidence is the literature prior for the AOP, gently modulated by
    // metabolic-load signals (high microsomal CL_int and high logP both
    // increase the chance the motif is actually bioactivated in vivo).
    // No randomness — same SMILES → same confidence, every run.
    const clintBoost = ivData.microsomalCLint > 30 ? 0.05 : 0;
    const logPBoost = mol.logP > 4 ? 0.03 : 0;
    const confidence = clamp(a.literatureConfidence + clintBoost + logPBoost, 0.3, 0.97);

    return {
      organ: a.organ,
      risk: confidence > 0.75 ? "High" as const : confidence > 0.55 ? "Moderate" as const : "Low" as const,
      structuralAlert: a.motifDescription,
      aopId: a.aopId,
      aopChain: a.aopChain,
      mechanism: a.mechanism,
      mitigationStrategy: a.mitigation,
      confidence,
    };
  });

  const bioactivationPathways: BioactivationPathway[] = triggered.map(a => ({
    alertName: a.name,
    structuralMotif: a.motifDescription,
    cypEnzyme: a.bioactivation.cypEnzyme,
    reactiveIntermediate: a.bioactivation.reactiveIntermediate,
    targetMacromolecule: a.bioactivation.targetMacromolecule,
    detoxPathway: a.bioactivation.detoxPathway,
    riskLevel: mol.logP > 3 && ivData.microsomalCLint > 20 ? "High" as const
             : mol.logP > 2 || ivData.microsomalCLint > 15 ? "Moderate" as const
             : "Low" as const,
    clinicalRelevance: a.bioactivation.clinicalRelevance,
  }));

  const metabolicSoftSpots: MetabolicSoftSpot[] = triggered.map((a, idx) => ({
    position: `Site ${idx + 1}`,
    moiety: a.softSpot.moiety,
    primaryCyp: a.bioactivation.cypEnzyme.split(" (")[0].split(",")[0],
    metaboliteType: a.softSpot.metaboliteType,
    reactivityRisk: mol.logP > 2.5 && ivData.microsomalCLint > 20 ? "Reactive" as const : "Stable" as const,
  }));

  const highCount = mechanisticToxicities.filter(m => m.risk === "High").length;
  const overallBioactivationRisk: BioactivationAssessment["overallBioactivationRisk"] =
    highCount >= 2 ? "High" : highCount >= 1 || triggered.length >= 3 ? "Moderate" : triggered.length > 0 ? "Low" : "Low";

  const gshTrappingRecommended = triggered.length > 0 && (mol.logP > 2 || ivData.microsomalCLint > 15);

  const recommendedStudies: string[] = [];
  if (triggered.length > 0) {
    recommendedStudies.push("GSH trapping assay (LC-MS/MS) to quantify reactive metabolite formation");
  }
  if (triggered.some(a => a.name.includes("Quinone") || a.name.includes("Epoxide") || a.name.includes("Furan"))) {
    recommendedStudies.push("KCN trapping for aldehyde/iminium intermediates");
  }
  if (triggered.some(a => a.name.includes("Nitro") || a.name.includes("Aniline"))) {
    recommendedStudies.push("Ames test (ICH S2(R1) battery) for genotoxicity assessment");
  }
  if (triggered.some(a => a.name.includes("Acyl"))) {
    recommendedStudies.push("Acyl glucuronide stability assay (pH 7.4, 37°C)");
  }
  if (triggered.some(a => a.name.includes("MDP") || a.name.includes("Methylene"))) {
    recommendedStudies.push("Time-dependent CYP inhibition (TDI) assay with pre-incubation shift");
  }
  if (gshTrappingRecommended) {
    recommendedStudies.push("Radiolabeled ADME study (¹⁴C) to quantify covalent binding in hepatocytes");
  }
  if (ivData.hergRisk !== "Low") {
    recommendedStudies.push("hERG patch-clamp confirmation and in vivo QTc telemetry (ICH S7B)");
  }
  if (triggered.length >= 2) {
    recommendedStudies.push("Mechanistic toxicology panel: mitochondrial membrane potential (JC-1), ROS generation, caspase-3/7 activation");
  }

  return {
    overallBioactivationRisk,
    totalAlertsDetected: triggered.length,
    mechanisticToxicities,
    bioactivationPathways,
    gshTrappingRecommended,
    recommendedStudies,
    metabolicSoftSpots,
  };
}
