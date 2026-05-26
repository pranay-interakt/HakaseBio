import type { MolecularProperties, PharmacophoreProfile } from "./chemistry";
import type { ChEMBLTargetHit } from "./chemblTargetLookup";
import { makeQuality, type SourceQuality } from "./sourceQuality";
import type { MlTargetPrediction } from "./mlPolypharmacology";

export interface TargetSuggestion {
  uniprotId:   string;
  geneName:    string;
  fullName:    string;
  targetClass: string;
  confidence:  number;
  confidenceLabel: "High" | "Medium" | "Low" | "Experimental";
  rationale:   string[];
  area:        string;
  color:       "violet" | "blue" | "emerald" | "amber" | "red" | "cyan";
  source:      "chembl" | "chembl-similar" | "heuristic";
  /** PDB structure IDs available for this target (≤ 10 surfaced). */
  pdbIds?:     string[];
  /** Total PDB structures (may exceed pdbIds.length). */
  pdbCount?:   number;
  /** When source === "chembl-similar": ChEMBL ID of the similar molecule that produced the strongest hit. */
  similarSourceChemblId?: string;
  similarSourceName?: string;
  similarityPct?: number;
  /** Source-quality scoring: tier + score + measurement payload (when v2 ChEMBL succeeded). */
  quality?:    SourceQuality;
}

function inRange(v: number, lo: number, hi: number): boolean { return v >= lo && v <= hi; }

function bbbPermeable(p: MolecularProperties): boolean {
  return p.tpsa < 90 && p.mw < 450 && p.logP > 0.5;
}

function steroidLike(p: MolecularProperties): boolean {
  return p.numRings >= 4 && p.logP > 3;
}

function peptidomimetic(p: MolecularProperties): boolean {
  return p.rotBonds >= 6 && p.hba >= 6;
}

interface TargetEntry {
  uniprotId:   string;
  geneName:    string;
  fullName:    string;
  targetClass: string;
  area:        string;
  color:       TargetSuggestion["color"];
  score:       (p: MolecularProperties, ph: PharmacophoreProfile) => number;
  rationale:   (p: MolecularProperties, ph: PharmacophoreProfile) => string[];
}

const CATALOGUE: TargetEntry[] = [
  {
    uniprotId: "P00533", geneName: "EGFR", fullName: "Epidermal Growth Factor Receptor",
    targetClass: "Tyrosine Kinase", area: "Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 560)) sc += 1.5;
      if (inRange(p.logP, 0.5, 5)) sc += 1;
      if (inRange(p.hbd, 1, 4)) sc += 0.5;
      if (p.numAromaticRings >= 2) sc += 1.5;
      if (ph.aromaticNCount >= 2) sc += 2;
      if (ph.hasQuinazoline || ph.hasPyrimidine) sc += 2.5;
      if (ph.hasAniline) sc += 1.5;
      if (ph.hasAlkoxy) sc += 1;
      if (ph.hasAmide) sc += 0.5;
      if (ph.hasMichaelAcceptor) sc += 1.5;
      if (ph.hasHalogen) sc += 0.5;
      const hasEgfrSpecificFeature = ph.hasQuinazoline || ph.hasPyrimidine || ph.hasMichaelAcceptor;
      if (!hasEgfrSpecificFeature) {
        sc = Math.min(sc, 7.5);
      }
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasQuinazoline || ph.hasPyrimidine) r.push("Quinazoline/pyrimidine scaffold — core pharmacophore of EGFR inhibitors (erlotinib, gefitinib)");
      if (ph.aromaticNCount >= 2) r.push(`${ph.aromaticNCount} aromatic N atoms form hinge-binding pharmacophore with EGFR Met793/Thr790`);
      if (ph.hasAniline) r.push("Aromatic amine (aniline) — characteristic of 4-anilinoquinazoline EGFR pharmacophore");
      if (ph.hasAlkoxy) r.push("Alkoxy group(s) — consistent with erlotinib/gefitinib methoxy/ethoxy substituents");
      if (ph.hasMichaelAcceptor) r.push("Electrophilic warhead detected — consistent with covalent EGFR inhibition (osimertinib targets Cys797)");
      if (inRange(p.mw, 300, 560)) r.push(`MW ${p.mw.toFixed(0)} Da within EGFR inhibitor chemical space (300–560 Da)`);
      if (p.numAromaticRings >= 2) r.push(`${p.numAromaticRings} aromatic rings support anilinoquinazoline/pyrrolopyrimidine scaffold`);
      return r;
    },
  },
  {
    uniprotId: "P11802", geneName: "CDK4", fullName: "Cyclin-Dependent Kinase 4",
    targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 380, 600)) sc += 1.5;
      if (inRange(p.logP, 1.5, 5)) sc += 1;
      if (inRange(p.hbd, 2, 5)) sc += 1;
      if (p.numAromaticRings >= 3) sc += 1.5;
      if (ph.aromaticNCount >= 3) sc += 2;
      if (ph.hasPyrimidine) sc += 1.5;
      if (ph.hasPiperazine || ph.hasPiperidine) sc += 1;
      if (ph.hasAmide) sc += 0.5;
      if (ph.hasAniline) sc += 1;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.aromaticNCount >= 3) r.push(`${ph.aromaticNCount} aromatic N atoms — consistent with pyridopyrimidine CDK4/6 scaffold (palbociclib, ribociclib)`);
      if (ph.hasPyrimidine) r.push("Pyrimidine ring detected — core hinge-binding element in CDK4 inhibitors");
      if (inRange(p.mw, 380, 600)) r.push(`MW ${p.mw.toFixed(0)} Da aligns with CDK4/6 inhibitor range (palbociclib 448 Da)`);
      if (ph.hasPiperazine || ph.hasPiperidine) r.push("Piperazine/piperidine ring — found in palbociclib/ribociclib solubilizing moiety");
      if (p.numAromaticRings >= 3) r.push(`${p.numAromaticRings} fused aromatic rings match CDK4 pyrido/pyrimidine topology`);
      return r;
    },
  },
  {
    uniprotId: "Q06187", geneName: "BTK", fullName: "Tyrosine-Protein Kinase BTK",
    targetClass: "Tyrosine Kinase", area: "Hematology / Autoimmune", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 380, 560)) sc += 1.5;
      if (inRange(p.logP, 1, 4.5)) sc += 1;
      if (ph.aromaticNCount >= 2) sc += 1.5;
      if (ph.hasMichaelAcceptor) sc += 3;
      if (ph.hasPyrimidine) sc += 1;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasAmide) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasMichaelAcceptor) r.push("Acrylamide / Michael acceptor warhead — hallmark of covalent BTK inhibitors (ibrutinib Cys481, acalabrutinib)");
      if (ph.aromaticNCount >= 2) r.push("Heteroaromatic hinge-binding motif matches BTK Glu475/Met477 contacts");
      if (inRange(p.mw, 380, 560)) r.push(`MW ${p.mw.toFixed(0)} Da consistent with approved BTK inhibitors`);
      if (ph.hasPyrimidine) r.push("Pyrimidine/pyrazolopyrimidine scaffold consistent with BTK pharmacophore");
      return r;
    },
  },
  {
    uniprotId: "O15111", geneName: "CHUK", fullName: "Inhibitor of Nuclear Factor κB Kinase α (IKKα)",
    targetClass: "Serine/Threonine Kinase", area: "Inflammation / Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 350, 550)) sc += 1;
      if (inRange(p.logP, 1, 4)) sc += 0.5;
      if (ph.aromaticNCount >= 2) sc += 1.5;
      if (ph.hasSulfonamide) sc += 2.5;
      if (ph.hasPyrimidine) sc += 1;
      if (p.numAromaticRings >= 2) sc += 1;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasSulfonamide) r.push("Sulfonamide group — commonly found in IKK inhibitors for NF-κB pathway targeting");
      if (ph.aromaticNCount >= 2) r.push("Heteroaromatic hinge pharmacophore aligns with ATP-binding pocket of IKKα");
      if (ph.hasPyrimidine) r.push("Pyrimidine core consistent with IKK inhibitor scaffold");
      return r;
    },
  },
  {
    uniprotId: "P35968", geneName: "KDR", fullName: "Vascular Endothelial Growth Factor Receptor 2",
    targetClass: "Tyrosine Kinase (RTK)", area: "Oncology / Angiogenesis", color: "emerald",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 380, 620)) sc += 1.5;
      if (inRange(p.logP, 1, 5)) sc += 0.5;
      if (inRange(p.hbd, 2, 5)) sc += 1;
      if (p.numAromaticRings >= 3) sc += 1;
      if (ph.aromaticNCount >= 2) sc += 1.5;
      if (ph.hasUrea) sc += 2.5;
      if (ph.hasAmide) sc += 1;
      if (ph.hasTrifluoromethyl) sc += 1;
      if (ph.hasAniline) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasUrea) r.push("Urea linker — characteristic of Type II VEGFR2 inhibitors occupying DFG-out pocket (sorafenib, regorafenib)");
      if (ph.hasAmide) r.push("Amide bond provides H-bond donor/acceptor for hinge-region interaction");
      if (p.numAromaticRings >= 3) r.push(`${p.numAromaticRings} aromatic rings consistent with biaryl-urea VEGFR2 chemotype`);
      if (inRange(p.mw, 380, 620)) r.push(`MW ${p.mw.toFixed(0)} Da spans approved VEGFR2 inhibitors (sorafenib 464, axitinib 386)`);
      if (ph.hasTrifluoromethyl) r.push("CF₃ group present — matches pharmacophore of sorafenib/regorafenib");
      return r;
    },
  },
  {
    uniprotId: "P31749", geneName: "AKT1", fullName: "RAC-Alpha Serine/Threonine-Protein Kinase",
    targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 350, 550)) sc += 1;
      if (inRange(p.logP, 1, 4)) sc += 1;
      if (ph.aromaticNCount >= 2) sc += 1.5;
      if (ph.hasPyrimidine) sc += 1.5;
      if (ph.hasPiperidine || ph.hasPiperazine) sc += 1.5;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasHalogen) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasPyrimidine) r.push("Pyrimidine core — found in allosteric and ATP-competitive AKT inhibitors (capivasertib)");
      if (ph.hasPiperidine || ph.hasPiperazine) r.push("Piperidine/piperazine solubilizing group present in AKT inhibitors");
      if (ph.aromaticNCount >= 2) r.push("Aromatic N pattern supports kinase hinge-binding pharmacophore");
      if (inRange(p.mw, 350, 550)) r.push(`MW ${p.mw.toFixed(0)} Da within AKT inhibitor chemical space`);
      return r;
    },
  },
  {
    uniprotId: "P42336", geneName: "PIK3CA", fullName: "PI3-Kinase p110α Catalytic Subunit",
    targetClass: "Lipid Kinase", area: "Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 350, 600)) sc += 1;
      if (ph.aromaticNCount >= 3) sc += 2;
      if (ph.hasPyrimidine) sc += 2;
      if (ph.hasSulfonamide) sc += 1;
      if (p.numAromaticRings >= 2) sc += 1;
      if (inRange(p.logP, 0.5, 4)) sc += 0.5;
      if (ph.hasAmide) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasPyrimidine && ph.aromaticNCount >= 3) r.push("Multi-heteroaromatic scaffold — matches PI3K hinge-binding pharmacophore (alpelisib, idelalisib)");
      if (ph.aromaticNCount >= 3) r.push(`${ph.aromaticNCount} aromatic N atoms consistent with triazine/pyrimidine PI3K inhibitor cores`);
      if (inRange(p.mw, 350, 600)) r.push(`MW ${p.mw.toFixed(0)} Da within PI3K inhibitor range`);
      if (ph.hasSulfonamide) r.push("Sulfonamide present — found in PI3Kα-selective inhibitors");
      return r;
    },
  },
  {
    uniprotId: "P04049", geneName: "RAF1", fullName: "RAF Proto-Oncogene Serine/Threonine-Protein Kinase",
    targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 400, 650)) sc += 1;
      if (p.numAromaticRings >= 3) sc += 1.5;
      if (ph.hasUrea) sc += 2.5;
      if (ph.hasAmide) sc += 1;
      if (ph.aromaticNCount >= 2) sc += 1.5;
      if (ph.hasTrifluoromethyl) sc += 1;
      if (ph.hasHalogen) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasUrea) r.push("Urea pharmacophore — characteristic of Type II RAF inhibitors occupying DFG-out pocket (sorafenib)");
      if (p.numAromaticRings >= 3) r.push("Extended aromatic system consistent with RAF biaryl inhibitor topology");
      if (ph.hasTrifluoromethyl) r.push("CF₃ group matches sorafenib/vemurafenib pharmacophore");
      if (ph.aromaticNCount >= 2) r.push("Heteroaromatic N pattern supports hinge-region binding");
      return r;
    },
  },
  {
    uniprotId: "P00519", geneName: "ABL1", fullName: "Tyrosine-Protein Kinase ABL1",
    targetClass: "Tyrosine Kinase", area: "Oncology (CML)", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 350, 600)) sc += 1;
      if (p.numAromaticRings >= 3) sc += 1.5;
      if (ph.aromaticNCount >= 3) sc += 2;
      if (ph.hasPyrimidine) sc += 2;
      if (ph.hasAmide) sc += 1;
      if (ph.hasPiperazine) sc += 1;
      if (ph.hasAniline) sc += 1;
      if (ph.hasTrifluoromethyl) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasPyrimidine && ph.aromaticNCount >= 3) r.push("Pyrimidine with multiple aromatic N — matches imatinib/dasatinib/nilotinib ABL1 pharmacophore");
      if (ph.hasPiperazine) r.push("Piperazine ring — found in imatinib and other BCR-ABL inhibitors");
      if (ph.hasAmide) r.push("Amide linkage supports DFG-out conformation binding");
      if (p.numAromaticRings >= 3) r.push(`${p.numAromaticRings} aromatic rings consistent with multi-ring ABL kinase inhibitors`);
      return r;
    },
  },
  {
    uniprotId: "P14416", geneName: "DRD2", fullName: "Dopamine Receptor D2",
    targetClass: "Class A GPCR", area: "CNS / Psychiatry", color: "blue",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 200, 430)) sc += 1.5;
      if (inRange(p.logP, 1.5, 5)) sc += 1;
      if (bbbPermeable(p)) sc += 2;
      if (ph.basicAmineCount >= 1) sc += 3;
      if (ph.hasPiperidine || ph.hasPiperazine) sc += 2;
      if (p.numAromaticRings >= 1 && p.numAromaticRings <= 3) sc += 0.5;
      if (!ph.hasSulfonamide && !ph.hasCarboxylicAcid) sc += 0.5;
      if (p.hbd > 3) sc -= 2;
      if (p.tpsa > 90) sc -= 1.5;
      if (ph.basicAmineCount === 0 && !ph.hasPiperidine && !ph.hasPiperazine) sc -= 3;
      if (ph.hasAniline && ph.basicAmineCount === 0) sc -= 1;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.basicAmineCount >= 1) r.push("Basic aliphatic nitrogen — forms critical Asp114³·³² salt bridge in DRD2 orthosteric binding pocket");
      if (bbbPermeable(p)) r.push(`CNS-penetrant profile: TPSA ${p.tpsa.toFixed(0)} Å² < 90, MW ${p.mw.toFixed(0)} Da → BBB permeability predicted`);
      if (ph.hasPiperidine || ph.hasPiperazine) r.push("Piperidine/piperazine ring — characteristic of antipsychotic/dopaminergic ligands (haloperidol, aripiprazole)");
      if (inRange(p.mw, 200, 430)) r.push("MW and logP in typical antipsychotic/dopaminergic ligand space");
      return r;
    },
  },
  {
    uniprotId: "P28223", geneName: "HTR2A", fullName: "5-Hydroxytryptamine Receptor 2A",
    targetClass: "Class A GPCR", area: "CNS / Psychiatry", color: "blue",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 250, 420)) sc += 1;
      if (inRange(p.logP, 1, 4.5)) sc += 1;
      if (bbbPermeable(p)) sc += 1.5;
      if (ph.basicAmineCount >= 1) sc += 2.5;
      if (ph.hasIndole) sc += 3;
      if (ph.hasPiperidine || ph.hasPiperazine) sc += 1;
      if (p.numAromaticRings >= 2) sc += 0.5;
      if (p.hbd > 3) sc -= 1.5;
      if (p.tpsa > 90) sc -= 1;
      if (ph.basicAmineCount === 0 && !ph.hasPiperidine && !ph.hasPiperazine && !ph.hasIndole) sc -= 2;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasIndole) r.push("Indole scaffold detected — serotonergic pharmacophore core (tryptamine mimicry for 5-HT2A binding)");
      if (ph.basicAmineCount >= 1) r.push("Basic aliphatic amine provides Asp155 salt bridge required for 5-HT2A binding");
      if (bbbPermeable(p)) r.push(`CNS-suitable: TPSA ${p.tpsa.toFixed(0)} Å², MW ${p.mw.toFixed(0)} Da`);
      if (ph.hasPiperidine || ph.hasPiperazine) r.push("Aliphatic amine ring consistent with serotonergic ligand scaffold");
      return r;
    },
  },
  {
    uniprotId: "P08172", geneName: "CHRM2", fullName: "Muscarinic Acetylcholine Receptor M2",
    targetClass: "Class A GPCR", area: "CNS / Cardiovascular", color: "blue",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 250, 450)) sc += 1;
      if (bbbPermeable(p)) sc += 1.5;
      if (ph.basicAmineCount >= 1) sc += 2.5;
      if (ph.hasPiperidine) sc += 1.5;
      if (ph.hasEster) sc += 1.5;
      if (p.numAromaticRings >= 1 && p.numAromaticRings <= 2) sc += 0.5;
      if (p.hbd > 3) sc -= 1.5;
      if (ph.basicAmineCount === 0 && !ph.hasPiperidine) sc -= 2.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.basicAmineCount >= 1) r.push("Quaternary/tertiary amine — key for Asp103 salt bridge in mAChR orthosteric site");
      if (ph.hasEster) r.push("Ester group present — characteristic of acetylcholine-like pharmacophore");
      if (bbbPermeable(p)) r.push("CNS-penetrant property profile supports central muscarinic activity");
      if (ph.hasPiperidine) r.push("Piperidine ring found in muscarinic modulators");
      return r;
    },
  },
  {
    uniprotId: "P35372", geneName: "OPRM1", fullName: "Mu-Type Opioid Receptor",
    targetClass: "Class A GPCR", area: "CNS / Pain", color: "blue",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 250, 500)) sc += 1;
      if (bbbPermeable(p)) sc += 2;
      if (ph.basicAmineCount >= 1) sc += 2.5;
      if (ph.hasPiperidine) sc += 2.5;
      if (p.numRings >= 3 && p.logP > 1) sc += 1.5;
      if (p.numAliphaticRings >= 2) sc += 1;
      if (p.hbd > 3) sc -= 1.5;
      if (ph.basicAmineCount === 0 && !ph.hasPiperidine) sc -= 3;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasPiperidine && ph.basicAmineCount >= 1) r.push("Piperidine with basic N — core pharmacophore of opioid ligands (morphine, fentanyl)");
      if (bbbPermeable(p)) r.push("BBB-permeable profile required for central µ-opioid activity");
      if (p.numRings >= 3) r.push(`Multi-ring system (${p.numRings} rings) consistent with morphinan or fentanyl scaffold`);
      return r;
    },
  },
  {
    uniprotId: "P12821", geneName: "ACE", fullName: "Angiotensin-Converting Enzyme",
    targetClass: "Zinc Metalloprotease", area: "Cardiovascular", color: "red",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 280, 560)) sc += 1;
      if (ph.hasCarboxylicAcid) sc += 3;
      if (ph.hasThiol) sc += 2;
      if (peptidomimetic(p)) sc += 2;
      if (inRange(p.hbd, 2, 6)) sc += 1;
      if (ph.hasAmide) sc += 1;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasCarboxylicAcid) r.push("Carboxylic acid — zinc-binding group essential for ACE inhibition (enalapril, lisinopril)");
      if (ph.hasThiol) r.push("Thiol zinc-binding group — captopril-type ACE inhibitor pharmacophore");
      if (peptidomimetic(p)) r.push(`Peptidomimetic signature (${p.rotBonds} rotatable bonds, ${p.hba} HBA) — matches ACE tripeptide binding groove`);
      if (ph.hasAmide) r.push("Amide bond consistent with peptide backbone mimicry");
      if (inRange(p.mw, 280, 560)) r.push(`MW ${p.mw.toFixed(0)} Da within approved ACE inhibitor range`);
      return r;
    },
  },
  {
    uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)",
    targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 200, 500)) sc += 1;
      if (inRange(p.logP, 1, 5)) sc += 0.5;
      if (ph.hasSulfonamide || ph.hasSulfone) sc += 3;
      if (ph.hasCarboxylicAcid) sc += 2;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasTrifluoromethyl) sc += 1;
      if (ph.hasHalogen) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasSulfonamide || ph.hasSulfone) r.push("Sulfonamide/sulfone group — hallmark of selective COX-2 inhibitors (celecoxib Val523 side pocket)");
      if (ph.hasCarboxylicAcid) r.push("Carboxylic acid pharmacophore — matches NSAID class (ibuprofen, naproxen, indomethacin)");
      if (p.numAromaticRings >= 2) r.push("Diaryl scaffold consistent with classical COX-2 inhibitor geometry");
      if (ph.hasTrifluoromethyl) r.push("CF₃ group — present in celecoxib for metabolic stability and COX-2 selectivity");
      return r;
    },
  },
  {
    uniprotId: "P10275", geneName: "AR", fullName: "Androgen Receptor",
    targetClass: "Nuclear Receptor", area: "Oncology (Prostate) / Endocrinology", color: "amber",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 560)) sc += 1;
      if (inRange(p.logP, 2, 6)) sc += 1;
      if (steroidLike(p)) sc += 2.5;
      if (ph.hasAmide) sc += 1.5;
      if (ph.hasTrifluoromethyl) sc += 2;
      if (ph.hasSulfonamide) sc += 1;
      if (ph.hasHalogen) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (steroidLike(p)) r.push(`Steroid-like ring system (${p.numRings} rings, logP ${p.logP.toFixed(1)}) — compatible with AR ligand-binding domain`);
      if (ph.hasTrifluoromethyl) r.push("Trifluoromethyl group — key pharmacophore in enzalutamide/darolutamide for LBD engagement");
      if (ph.hasAmide) r.push("Amide linker bridges A-ring and B-ring equivalents in non-steroidal antiandrogen scaffold");
      if (ph.hasSulfonamide) r.push("Sulfonamide group found in AR-targeting antiandrogens");
      return r;
    },
  },
  {
    uniprotId: "P03372", geneName: "ESR1", fullName: "Estrogen Receptor α",
    targetClass: "Nuclear Receptor", area: "Oncology (Breast) / Endocrinology", color: "red",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 280, 540)) sc += 1;
      if (inRange(p.logP, 2, 6)) sc += 1;
      if (steroidLike(p)) sc += 2.5;
      if (ph.hasPhenol) sc += 3;
      if (p.numRings >= 3) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasPhenol) r.push("Phenolic OH — essential pharmacophore for Glu353/Arg394 hydrogen bond in ERα binding pocket");
      if (steroidLike(p)) r.push(`Steroid-like scaffold (${p.numRings} rings) matches ERα LBD topology`);
      if (inRange(p.mw, 280, 540)) r.push(`MW ${p.mw.toFixed(0)} Da in range of SERMs/SERDs (tamoxifen 371, fulvestrant 606)`);
      return r;
    },
  },
  {
    uniprotId: "P37231", geneName: "PPARG", fullName: "Peroxisome Proliferator-Activated Receptor γ",
    targetClass: "Nuclear Receptor", area: "Metabolic / Diabetes", color: "amber",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 550)) sc += 1;
      if (inRange(p.logP, 2, 5)) sc += 1;
      if (ph.hasCarboxylicAcid) sc += 2;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasAmide) sc += 1;
      if (p.rotBonds >= 5) sc += 0.5;
      if (ph.hasSulfonamide) sc += 1;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasCarboxylicAcid) r.push("Carboxylic acid group — key zinc-binding/H-bond pharmacophore in thiazolidinediones (pioglitazone, rosiglitazone)");
      if (p.numAromaticRings >= 2) r.push("Extended aromatic system supports PPARγ LBD Y-shaped pocket occupation");
      if (ph.hasAmide) r.push("Amide bond consistent with PPARγ modulator chemotype");
      return r;
    },
  },
  {
    uniprotId: "Q92769", geneName: "HDAC2", fullName: "Histone Deacetylase 2",
    targetClass: "Epigenetic Enzyme (HDAC)", area: "Oncology / CNS", color: "cyan",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 280, 500)) sc += 1;
      if (inRange(p.logP, 1, 4)) sc += 0.5;
      if (ph.hasHydroxamicAcid) sc += 4;
      if (ph.hasCarboxylicAcid && !ph.hasHydroxamicAcid) sc += 1;
      if (ph.hasAmide) sc += 1;
      if (p.numAromaticRings >= 1) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasHydroxamicAcid) r.push("Hydroxamic acid zinc-binding group — classic HDAC cap-linker-ZBG pharmacophore (vorinostat, panobinostat)");
      if (ph.hasAmide) r.push("Amide bond in cap/linker region consistent with HDAC inhibitor architecture");
      if (ph.hasCarboxylicAcid && !ph.hasHydroxamicAcid) r.push("Carboxylic acid — weak zinc binder, found in short-chain fatty acid HDAC inhibitors (valproic acid)");
      return r;
    },
  },
  {
    uniprotId: "Q15116", geneName: "PDCD1", fullName: "Programmed Cell Death Protein 1 (PD-1)",
    targetClass: "Immune Checkpoint (PPI)", area: "Immuno-Oncology", color: "emerald",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 400, 700)) sc += 1;
      if (inRange(p.logP, 1, 5)) sc += 0.5;
      if (p.numAromaticRings >= 4) sc += 2;
      if (p.numRings >= 4) sc += 1;
      if (inRange(p.hbd, 2, 6)) sc += 1;
      if (ph.hasTrifluoromethyl) sc += 0.5;
      if (p.mw > 500 && p.numAromaticRings >= 3) sc += 2;
      if (ph.hasHalogen) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (p.numAromaticRings >= 4) r.push(`${p.numAromaticRings} aromatic rings — large planar surface area for PD-1/PD-L1 protein-protein interface burial`);
      if (p.mw > 500) r.push(`MW ${p.mw.toFixed(0)} Da — larger molecules better occupy the shallow PD-L1 groove (BMS-1166 class)`);
      r.push("Immuno-oncology small molecule PPI disruptors share extended, flat aromatic architecture");
      return r;
    },
  },
  {
    uniprotId: "O60885", geneName: "BRD4", fullName: "Bromodomain-Containing Protein 4",
    targetClass: "Epigenetic Reader", area: "Oncology", color: "cyan",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 550)) sc += 1;
      if (p.numAromaticRings >= 2) sc += 1.5;
      if (ph.aromaticNCount >= 2) sc += 1.5;
      if (ph.hasBenzimidazole) sc += 2;
      if (ph.hasPyrimidine) sc += 1;
      if (ph.hasAmide) sc += 0.5;
      if (inRange(p.logP, 1, 4)) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasBenzimidazole) r.push("Benzimidazole scaffold — mimics acetyl-lysine binding in BRD4 bromodomain");
      if (ph.aromaticNCount >= 2) r.push("Aromatic N atoms consistent with BET inhibitor pharmacophore (JQ1, I-BET762)");
      if (ph.hasPyrimidine) r.push("Pyrimidine ring — found in BET bromodomain inhibitors");
      if (p.numAromaticRings >= 2) r.push("Multiple aromatic rings support bromodomain pocket occupation");
      return r;
    },
  },
  {
    uniprotId: "Q07820", geneName: "MCL1", fullName: "Induced Myeloid Leukemia Cell Differentiation Protein Mcl-1",
    targetClass: "Anti-Apoptotic (PPI)", area: "Oncology (Hematology)", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 400, 700)) sc += 1;
      if (p.numAromaticRings >= 3) sc += 1.5;
      if (ph.hasCarboxylicAcid) sc += 2;
      if (ph.hasAmide) sc += 1;
      if (ph.hasHalogen) sc += 0.5;
      if (inRange(p.logP, 2, 6)) sc += 1;
      if (p.rotBonds >= 4) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasCarboxylicAcid) r.push("Carboxylic acid — anchoring interaction in MCL-1 BH3-binding groove (venetoclax-like)");
      if (p.numAromaticRings >= 3) r.push("Extended aromatic system mimics BH3 α-helical interface contacts");
      if (inRange(p.mw, 400, 700)) r.push(`MW ${p.mw.toFixed(0)} Da within PPI inhibitor range for Bcl-2 family`);
      return r;
    },
  },
  {
    uniprotId: "P07900", geneName: "HSP90AA1", fullName: "Heat Shock Protein 90-alpha",
    targetClass: "Chaperone", area: "Oncology", color: "amber",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 550)) sc += 1;
      if (ph.hasPhenol) sc += 2;
      if (ph.hasAmide) sc += 1;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasHalogen) sc += 0.5;
      if (inRange(p.logP, 1, 4)) sc += 0.5;
      if (p.numHeterocycles >= 1) sc += 1;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasPhenol) r.push("Phenol group — mimics Asp93/Thr184 H-bond interactions in HSP90 ATP pocket (geldanamycin, radicicol pharmacophore)");
      if (p.numHeterocycles >= 1) r.push("Heterocyclic ring supports HSP90 N-terminal domain binding");
      if (ph.hasAmide) r.push("Amide H-bond donor/acceptor consistent with HSP90 inhibitor pharmacophore");
      return r;
    },
  },
  {
    uniprotId: "Q9Y263", geneName: "PARP1", fullName: "Poly [ADP-Ribose] Polymerase 1",
    targetClass: "DNA Repair Enzyme", area: "Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 500)) sc += 1;
      if (ph.hasAmide) sc += 2;
      if (ph.hasLactam) sc += 2.5;
      if (ph.aromaticNCount >= 2) sc += 1.5;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasHalogen) sc += 0.5;
      if (inRange(p.logP, 0.5, 3.5)) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasLactam) r.push("Lactam ring — nicotinamide mimetic, core pharmacophore of PARP inhibitors (olaparib, niraparib)");
      if (ph.hasAmide) r.push("Amide group supports NAD+ binding site occupation in PARP catalytic domain");
      if (ph.aromaticNCount >= 2) r.push("Aromatic N atoms consistent with benzimidazole/phthalazinone PARP inhibitor scaffold");
      if (p.numAromaticRings >= 2) r.push("Fused ring system matches PARP1 inhibitor chemical space");
      return r;
    },
  },
  {
    uniprotId: "P24941", geneName: "CDK2", fullName: "Cyclin-Dependent Kinase 2",
    targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 550)) sc += 1;
      if (ph.aromaticNCount >= 2) sc += 2;
      if (ph.hasPyrimidine) sc += 1.5;
      if (ph.hasBenzimidazole) sc += 1.5;
      if (p.numAromaticRings >= 2) sc += 1;
      if (inRange(p.logP, 1, 4)) sc += 0.5;
      if (ph.hasAmide) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.aromaticNCount >= 2) r.push("Multiple aromatic N — supports CDK2 hinge-binding via Leu83 backbone H-bond");
      if (ph.hasPyrimidine) r.push("Pyrimidine scaffold found in CDK2 selective inhibitors");
      if (p.numAromaticRings >= 2) r.push("Aromatic ring system consistent with CDK2 ATP-competitive chemotypes");
      return r;
    },
  },
  {
    uniprotId: "O14757", geneName: "CHEK1", fullName: "Serine/Threonine-Protein Kinase Chk1",
    targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 500)) sc += 1;
      if (ph.aromaticNCount >= 3) sc += 2;
      if (ph.hasPyrimidine) sc += 1.5;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasAmide) sc += 0.5;
      if (inRange(p.logP, 1, 4)) sc += 0.5;
      if (ph.hasHalogen) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.aromaticNCount >= 3) r.push("Multiple aromatic N atoms — consistent with Chk1 pyrazolopyrimidine inhibitor scaffold");
      if (ph.hasPyrimidine) r.push("Pyrimidine hinge-binding motif matches Chk1 inhibitor pharmacophore (prexasertib)");
      if (p.numAromaticRings >= 2) r.push("Multi-ring aromatic system supports Chk1 ATP pocket occupation");
      return r;
    },
  },
  {
    uniprotId: "Q16539", geneName: "MAPK14", fullName: "Mitogen-Activated Protein Kinase 14 (p38α)",
    targetClass: "Serine/Threonine Kinase", area: "Inflammation", color: "amber",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 500)) sc += 1;
      if (ph.aromaticNCount >= 2) sc += 1.5;
      if (ph.hasPyrimidine) sc += 1.5;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasAmide) sc += 1;
      if (ph.hasUrea) sc += 1.5;
      if (ph.hasHalogen) sc += 0.5;
      if (ph.hasTrifluoromethyl) sc += 0.5;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasUrea || ph.hasAmide) r.push("Urea/amide linker — found in DFG-out p38 MAPK inhibitors (BIRB-796 chemotype)");
      if (ph.hasPyrimidine) r.push("Pyrimidine ring consistent with p38α hinge-binding pharmacophore");
      if (ph.aromaticNCount >= 2) r.push("Aromatic N pattern supports ATP-competitive p38 inhibition");
      return r;
    },
  },
  {
    uniprotId: "P0DMS8", geneName: "TRPV1", fullName: "Transient Receptor Potential Cation Channel V1",
    targetClass: "Ion Channel (TRP)", area: "Pain / Inflammation", color: "amber",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 300, 500)) sc += 1;
      if (ph.hasAmide) sc += 2;
      if (ph.hasPiperidine) sc += 1.5;
      if (ph.hasTrifluoromethyl) sc += 1;
      if (inRange(p.logP, 2, 5)) sc += 1;
      if (p.numAromaticRings >= 1) sc += 0.5;
      if (ph.hasUrea) sc += 1;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.hasAmide) r.push("Amide bond — characteristic pharmacophore of TRPV1 antagonists (capsaicin, AMG-517)");
      if (ph.hasPiperidine) r.push("Piperidine ring consistent with TRPV1 antagonist scaffold");
      if (ph.hasTrifluoromethyl) r.push("CF₃ group found in potent TRPV1 antagonists");
      if (inRange(p.logP, 2, 5)) r.push("Lipophilicity range supports membrane-embedded ion channel targeting");
      return r;
    },
  },
  {
    uniprotId: "P51681", geneName: "CCR5", fullName: "C-C Chemokine Receptor Type 5",
    targetClass: "Class A GPCR", area: "Infectious Disease / Immunology", color: "emerald",
    score(p, ph) {
      let sc = 0;
      if (inRange(p.mw, 400, 600)) sc += 1;
      if (ph.basicAmineCount >= 2) sc += 2.5;
      if (ph.hasPiperidine || ph.hasPiperazine) sc += 2;
      if (p.numAromaticRings >= 2) sc += 1;
      if (ph.hasTrifluoromethyl) sc += 1;
      if (ph.hasAmide) sc += 0.5;
      if (ph.basicAmineCount === 0) sc -= 2;
      return sc;
    },
    rationale(p, ph) {
      const r: string[] = [];
      if (ph.basicAmineCount >= 2) r.push("Multiple basic N atoms — maraviroc-like CCR5 pharmacophore requiring dual amine contacts");
      if (ph.hasPiperidine || ph.hasPiperazine) r.push("Cyclic amine ring consistent with CCR5 antagonist scaffold (maraviroc)");
      if (ph.hasTrifluoromethyl) r.push("CF₃ group found in CCR5 antagonists for metabolic stability");
      return r;
    },
  },
];

/**
 * Suggest catalogue targets ranked by physicochemical / pharmacophore match.
 *
 * The number of returned suggestions is **dynamic** — driven by the molecule's
 * actual catalogue overlap rather than a hard top-N cap:
 *   1. Score every catalogue target.
 *   2. Drop targets below `opts.minConfidence` (default 0.35 = Medium label
 *      threshold). A weakly-overlapping molecule may legitimately have ZERO
 *      strong matches.
 *   3. Safety floor: if fewer than `opts.floor` (default 3) survive the filter,
 *      keep the top `floor` regardless so the user always sees something.
 *   4. Hard ceiling: clamp at `opts.maxN` (default 25 — well above the typical
 *      ~12 catalogue targets that score >0.35) just to prevent pathological
 *      cases from flooding the UI.
 */
export function suggestTargets(
  smiles: string,
  props: MolecularProperties,
  pharmacophores: PharmacophoreProfile | null,
  opts: { minConfidence?: number; floor?: number; maxN?: number } = {},
): TargetSuggestion[] {
  if (!smiles || !props.isValid) return [];

  const minConfidence = opts.minConfidence ?? 0.35;
  const floor = opts.floor ?? 3;
  const maxN = opts.maxN ?? 25;

  const ph: PharmacophoreProfile = pharmacophores ?? {
    aromaticNCount: 0, basicAmineCount: 0, aromaticAmineCount: 0,
    acidicGroupCount: 0, amideCount: 0,
    hasCarboxylicAcid: false, hasSulfonamide: false, hasSulfone: false,
    hasPhenol: false, hasMichaelAcceptor: false, hasAmide: false,
    hasUrea: false, hasTrifluoromethyl: false, hasHalogen: false,
    hasHydroxamicAcid: false, hasThiol: false, hasPiperidine: false,
    hasPiperazine: false, hasIndole: false, hasQuinazoline: false,
    hasPyrimidine: false, hasBenzimidazole: false, hasEpoxide: false,
    hasPhosphate: false, hasNitro: false, hasEster: false, hasLactam: false,
    hasAlkoxy: false, hasAniline: false,
  };

  const scored = CATALOGUE.map(t => {
    const rawScore = t.score(props, ph);
    const reasons  = t.rationale(props, ph);
    return { ...t, rawScore, reasons };
  });

  scored.sort((a, b) => b.rawScore - a.rawScore);

  const ABSOLUTE_MAX = 12;

  // Compute confidence for every target, then apply the dynamic filter.
  const scoredWithConf = scored.map(t => ({
    t,
    conf: Math.min(1, Math.max(0, t.rawScore / ABSOLUTE_MAX)),
  }));

  const aboveThreshold = scoredWithConf.filter(x => x.conf >= minConfidence);
  // Apply the safety floor — keep at least `floor` even if all are weak.
  const kept = aboveThreshold.length >= floor ? aboveThreshold : scoredWithConf.slice(0, floor);

  return kept.slice(0, maxN).map(({ t, conf }) => {
    const label: TargetSuggestion["confidenceLabel"] = conf >= 0.65 ? "High" : conf >= 0.35 ? "Medium" : "Low";
    return {
      uniprotId:   t.uniprotId,
      geneName:    t.geneName,
      fullName:    t.fullName,
      targetClass: t.targetClass,
      confidence:  conf,
      confidenceLabel: label,
      rationale:   t.reasons.length > 0 ? t.reasons : ["Physicochemical profile overlaps with known inhibitors of this target class"],
      area:        t.area,
      color:       t.color,
      // `source: "heuristic"` is the TargetSuggestion provenance enum (kept
       // stable for downstream consumers that branch on chembl/chembl-similar/
       // heuristic). The displayed *quality tier*, however, is "structural" —
       // pharmacophore matching is a deterministic SMARTS substructure query,
       // not a heuristic prediction.
      source:      "heuristic" as const,
      quality:     makeQuality("structural", "RDKit pharmacophore catalogue", {
        note: "SMARTS substructure match against curated 29-target catalogue — defensible structural evidence, not measured binding data",
      }),
    };
  });
}

function potencyColor(nM: number): TargetSuggestion["color"] {
  if (nM < 100) return "emerald";
  if (nM < 1000) return "amber";
  if (nM < 10000) return "violet";
  return "blue";
}

function formatNm(nM: number): string {
  if (nM < 1000) return `${nM.toFixed(0)} nM`;
  return `${(nM / 1000).toFixed(1)} µM`;
}

/**
 * Convert all ChEMBL target hits with a UniProt ID into suggestions. There is
 * NO hard cap here — every hit with measured (or similarity-inferred) binding
 * data is real evidence and should surface to the user. The combiner upstream
 * is responsible for any final dedup / display ordering.
 */
export const UNIPROT_ACCESSION_RE = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

export function isValidUniprotAccession(id: string | null | undefined): boolean {
  if (!id) return false;
  return UNIPROT_ACCESSION_RE.test(id.trim().toUpperCase());
}

export function convertChEMBLHitsToSuggestions(hits: ChEMBLTargetHit[], compoundName: string): TargetSuggestion[] {
  const withUniprot = hits.filter(h => isValidUniprotAccession(h.uniprotId));
  if (withUniprot.length === 0) return [];

  const best = withUniprot[0];
  const bestNm = best.bestValue_nM;

  return withUniprot.map((h) => {
    const isSimilarity = h.fromSimilarity === true;
    // Confidence: scale by relative potency, then dampen 30% if from similarity inference
    let conf = Math.min(1, Math.max(0.1, bestNm / Math.max(h.bestValue_nM, 0.01)));
    if (isSimilarity) conf = conf * 0.7;

    const rationale: string[] = [];
    if (isSimilarity) {
      const simPct = h.bestSimilarity != null ? Math.round(h.bestSimilarity) : null;
      const src = h.bestSourceName ?? h.bestSourceChemblId ?? "similar molecule";
      rationale.push(`Inferred from ${simPct ? `${simPct}% similar ` : ""}${src}: ${h.bestActivityType} ${formatNm(h.bestValue_nM)} (ChEMBL measured)`);
    } else {
      rationale.push(`Experimental ${h.bestActivityType}: ${formatNm(h.bestValue_nM)} (ChEMBL measured)`);
    }
    if (h.pChembl != null && !isNaN(h.pChembl)) {
      rationale.push(`pChEMBL ${h.pChembl.toFixed(1)} — ${h.pChembl >= 7 ? "highly potent" : h.pChembl >= 5 ? "moderately potent" : "weak"} activity`);
    }
    if (h.pdbCount && h.pdbCount > 0) {
      rationale.push(`${h.pdbCount} PDB structure${h.pdbCount === 1 ? "" : "s"} available${h.pdbIds && h.pdbIds.length > 0 ? ` (e.g. ${h.pdbIds.slice(0, 3).join(", ")})` : ""}`);
    }
    if (!isSimilarity && compoundName && compoundName !== h.targetChemblId) {
      rationale.push(`Compound: ${compoundName}`);
    }

    const geneName = h.geneName ?? extractGeneName(h.targetName);

    // Quality: prefer the v2 measurement payload from the hit if present;
    // otherwise synthesize a tier from source + similarity provenance.
    const quality: SourceQuality = h.quality ?? makeQuality(
      isSimilarity ? "enriched" : "experimental",
      isSimilarity ? "ChEMBL similarity" : "ChEMBL exact-match",
      {
        note: isSimilarity
          ? "Inferred from structurally similar molecule — no measured data on this exact compound"
          : "Direct measured binding data for this compound",
      },
    );

    return {
      uniprotId: h.uniprotId!,
      geneName,
      fullName: h.targetName,
      targetClass: h.targetType === "SINGLE PROTEIN" ? "Protein" : h.targetType,
      confidence: conf,
      confidenceLabel: "Experimental" as const,
      rationale,
      area: isSimilarity ? "ChEMBL (similarity)" : "ChEMBL",
      color: potencyColor(h.bestValue_nM),
      source: isSimilarity ? ("chembl-similar" as const) : ("chembl" as const),
      pdbIds: h.pdbIds ?? [],
      pdbCount: h.pdbCount ?? 0,
      similarSourceChemblId: h.bestSourceChemblId,
      similarSourceName: h.bestSourceName ?? undefined,
      similarityPct: h.bestSimilarity,
      quality,
    };
  });
}

function extractGeneName(targetName: string): string {
  const match = targetName.match(/\(([A-Z0-9]{2,10})\)\s*$/);
  if (match) return match[1];
  const words = targetName.split(/\s+/);
  if (words.length <= 2) return targetName;
  return words.slice(0, 2).map(w => w[0]).join("").toUpperCase() || targetName.slice(0, 6);
}

/**
 * Convert ML-predicted polypharmacology panel hits to TargetSuggestions.
 * These are real Binding-ML predictions (DeepDTA-GBM, ESM-2 + Morgan FP)
 * against a curated diverse-class DrugCentral shortlist — surfaced when
 * a truly novel molecule has no ChEMBL Tanimoto ≥ 70% neighbour and the
 * kinase-biased pharmacophore catalogue would otherwise be the only path.
 *
 * Each hit carries `source: "chembl-similar"` (so the cascade gate scores
 * it at the ML tier 0.7, not the structural tier 0.6) and `quality.tier =
 * "ml"`.  The confidence is derived from the predicted pKd: pKd ≥ 8 → 0.85,
 * 7–8 → 0.70, 6–7 → 0.55, < 6 → 0.45.  Out-of-domain predictions get a
 * 0.7× confidence dampening so they fall below the High-confidence cutoff.
 */
export function convertMlPanelToSuggestions(panel: MlTargetPrediction[]): TargetSuggestion[] {
  return panel.map(p => {
    let confidence =
      p.pKd_predicted >= 8 ? 0.85 :
      p.pKd_predicted >= 7 ? 0.70 :
      p.pKd_predicted >= 6 ? 0.55 :
      0.45;
    if (!p.adInDomain) confidence *= 0.7;
    const label: TargetSuggestion["confidenceLabel"] =
      confidence >= 0.65 ? "High" : confidence >= 0.35 ? "Medium" : "Low";
    const rationale: string[] = [
      `ML-predicted Kd ${formatNm(p.Kd_nM)} (pKd ${p.pKd_predicted.toFixed(2)}, ${p.affinityClass})`,
      `Binding-ML (DeepDTA-GBM, Morgan FP + ESM-2 target embedding, BindingDB-trained)`,
    ];
    if (p.adTanimoto !== null) {
      rationale.push(p.adInDomain
        ? `Applicability domain: in-distribution (Tanimoto NN=${p.adTanimoto.toFixed(2)})`
        : `Applicability domain: OUT-OF-DOMAIN (Tanimoto NN=${p.adTanimoto.toFixed(2)}) — ML extrapolation, treat predicted Kd cautiously`);
    }
    return {
      uniprotId:        p.uniprotId,
      geneName:         p.geneName,
      fullName:         p.fullName,
      targetClass:      p.targetClass,
      confidence,
      confidenceLabel:  label,
      rationale,
      area:             `${p.targetClass} (DrugCentral)`,
      color:            potencyColor(p.Kd_nM),
      // `chembl-similar` so cascadeGate.ts scores this at the ML tier (0.7);
      // there is no separate "ml" enum on TargetSuggestion.source today, and
      // adding one would force a schema migration across every consumer.
      source:           "chembl-similar" as const,
      quality:          makeQuality("ml", "Binding-ML polypharmacology panel", {
        note: `DeepDTA-GBM predicted pKd ${p.pKd_predicted.toFixed(2)} against DrugCentral target ${p.geneName}; ${p.adInDomain ? "in-domain" : "out-of-domain"} prediction.`,
      }),
    };
  });
}
