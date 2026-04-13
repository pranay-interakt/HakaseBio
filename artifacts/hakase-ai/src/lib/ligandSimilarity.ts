import { generateFingerprint, computeTanimotoSimilarity } from "./chemistry";

export interface ReferenceCompound {
  smiles: string;
  name: string;
  uniprotId: string;
  geneName: string;
  fullName: string;
  targetClass: string;
  area: string;
  color: "violet" | "blue" | "emerald" | "amber" | "red" | "cyan";
  activityNM?: number;
}

export interface SimilarityHit {
  ref: ReferenceCompound;
  tanimoto: number;
}

export interface LigandSimilarityResult {
  uniprotId: string;
  geneName: string;
  fullName: string;
  targetClass: string;
  area: string;
  color: "violet" | "blue" | "emerald" | "amber" | "red" | "cyan";
  bestSimilarity: number;
  avgSimilarity: number;
  hits: { name: string; tanimoto: number; activityNM?: number }[];
}

const REFERENCE_LIBRARY: ReferenceCompound[] = [
  { smiles: "C(=O)(Nc1ccc(F)cc1)Nc2cc3c(Nc4ccc(Cl)c(C(F)(F)F)c4)ncnc3cc2OC", name: "Gefitinib", uniprotId: "P00533", geneName: "EGFR", fullName: "Epidermal Growth Factor Receptor", targetClass: "Tyrosine Kinase", area: "Oncology", color: "violet", activityNM: 33 },
  { smiles: "C#Cc1cccc(Nc2ncnc3cc(OCCOC)c(OCCOC)cc23)c1", name: "Erlotinib", uniprotId: "P00533", geneName: "EGFR", fullName: "Epidermal Growth Factor Receptor", targetClass: "Tyrosine Kinase", area: "Oncology", color: "violet", activityNM: 2 },
  { smiles: "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1", name: "Lapatinib", uniprotId: "P00533", geneName: "EGFR", fullName: "Epidermal Growth Factor Receptor", targetClass: "Tyrosine Kinase", area: "Oncology", color: "violet", activityNM: 10.8 },
  { smiles: "C=CC(=O)Nc1cc(Nc2nccc(-c3cn(C)c4ccccc34)n2)c(OC)cc1N(C)CCN(C)C", name: "Osimertinib", uniprotId: "P00533", geneName: "EGFR", fullName: "Epidermal Growth Factor Receptor", targetClass: "Tyrosine Kinase", area: "Oncology", color: "violet", activityNM: 12.9 },

  { smiles: "CC1=C(C(=O)Nc2ccc(CN3CCN(C)CC3)cc2)C(c2ccc(Cl)cc2)=N/C1=C\\c1ccc(F)cc1", name: "Imatinib-analog", uniprotId: "P00519", geneName: "ABL1", fullName: "Tyrosine-protein kinase ABL1", targetClass: "Tyrosine Kinase", area: "Oncology (CML)", color: "violet", activityNM: 25 },
  { smiles: "Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1", name: "Imatinib", uniprotId: "P00519", geneName: "ABL1", fullName: "Tyrosine-protein kinase ABL1", targetClass: "Tyrosine Kinase", area: "Oncology (CML)", color: "violet", activityNM: 25 },
  { smiles: "CC(C)c1ccc(-c2nn3c(C)cc(NC(=O)Nc4cc(C(C)(C)C(F)(F)F)on4)c3n2)cc1", name: "Dasatinib-core", uniprotId: "P00519", geneName: "ABL1", fullName: "Tyrosine-protein kinase ABL1", targetClass: "Tyrosine Kinase", area: "Oncology (CML)", color: "violet", activityNM: 0.6 },

  { smiles: "CC1(C)CCC(CN2CCN(c3ccc(C(=O)NS(=O)(=O)c4ccc(NCC5CCOCC5)c([N+](=O)[O-])c4)c(Oc4cnc5[nH]ccc5c4)c3)CC2)=C(c2ccc(Cl)cc2)C1", name: "Venetoclax", uniprotId: "Q07820", geneName: "MCL1", fullName: "Induced Myeloid Leukemia Cell Differentiation Protein Mcl-1", targetClass: "Anti-Apoptotic (PPI)", area: "Oncology (Hematology)", color: "amber", activityNM: 3 },

  { smiles: "CC(=O)Oc1ccccc1C(=O)O", name: "Aspirin", uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)", targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber", activityNM: 100000 },
  { smiles: "CC(C)Cc1ccc(C(C)C(=O)O)cc1", name: "Ibuprofen", uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)", targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber", activityNM: 72000 },
  { smiles: "Cc1ccc(-c2cc(C(F)(F)F)nn2-c2ccc(S(N)(=O)=O)cc2)cc1", name: "Celecoxib", uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)", targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber", activityNM: 40 },
  { smiles: "CS(=O)(=O)c1ccc(-c2c(F)c(-c3ccc(F)cc3F)c(C=O)n2CC(O)CO)cc1", name: "Etoricoxib-analog", uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)", targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber", activityNM: 25 },

  { smiles: "CC12CCC3c4ccc(O)cc4CCC3C1CCC2O", name: "Estradiol", uniprotId: "P03372", geneName: "ESR1", fullName: "Estrogen Receptor Alpha", targetClass: "Nuclear Receptor", area: "Oncology (Breast)", color: "blue", activityNM: 0.1 },
  { smiles: "OC(c1ccc(Cl)cc1)(c1ccc(OCCN2CCCCC2)cc1)c1ccccc1", name: "Tamoxifen-analog", uniprotId: "P03372", geneName: "ESR1", fullName: "Estrogen Receptor Alpha", targetClass: "Nuclear Receptor", area: "Oncology (Breast)", color: "blue", activityNM: 7 },

  { smiles: "CC(CS)C(=O)N1CCCC1C(=O)O", name: "Captopril", uniprotId: "P12821", geneName: "ACE", fullName: "Angiotensin-Converting Enzyme", targetClass: "Metalloprotease", area: "Cardiovascular", color: "blue", activityNM: 8 },
  { smiles: "CCOC(=O)C(CCc1ccccc1)NC(C)C(=O)N1CC2(CC1C(=O)[O-])CCCC2", name: "Enalapril-analog", uniprotId: "P12821", geneName: "ACE", fullName: "Angiotensin-Converting Enzyme", targetClass: "Metalloprotease", area: "Cardiovascular", color: "blue", activityNM: 6 },

  { smiles: "CC(=O)Nc1ccc(O)cc1", name: "Acetaminophen", uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)", targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber", activityNM: 20000 },

  { smiles: "OC(=O)c1ccccc1O", name: "Salicylic acid", uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)", targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber", activityNM: 50000 },

  { smiles: "O=C1NC(=O)/C(=C/c2ccc(-c3ccccc3)o2)N1", name: "Palbociclib-core", uniprotId: "P11802", geneName: "CDK4", fullName: "Cyclin-Dependent Kinase 4", targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet", activityNM: 11 },
  { smiles: "CC(=O)c1c(C)c2cnc(Nc3ccc(N4CCNCC4)cn3)nc2n(C2CCCC2)c1=O", name: "Palbociclib", uniprotId: "P11802", geneName: "CDK4", fullName: "Cyclin-Dependent Kinase 4", targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet", activityNM: 11 },
  { smiles: "Cn1c(=O)c(-c2c(Cl)ccc(Cl)c2Cl)cc2cnc(Nc3ccc(N4CCNCC4)cn3)nc21", name: "Ribociclib-analog", uniprotId: "P11802", geneName: "CDK4", fullName: "Cyclin-Dependent Kinase 4", targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet", activityNM: 10 },

  { smiles: "CNC(=O)c1cc(Oc2ccc(NC(=O)Nc3ccc(Cl)c(C(F)(F)F)c3)cc2)ccn1", name: "Sorafenib", uniprotId: "P04049", geneName: "RAF1", fullName: "RAF Proto-Oncogene Serine/Threonine Kinase", targetClass: "Serine/Threonine Kinase", area: "Oncology", color: "violet", activityNM: 6 },

  { smiles: "CCN(CC)CCCC(C)Nc1ccnc2cc(Cl)ccc12", name: "Chloroquine", uniprotId: "P00439", geneName: "PAH", fullName: "Phenylalanine-4-Hydroxylase", targetClass: "Enzyme", area: "Infectious Disease", color: "cyan", activityNM: 300 },

  { smiles: "O=c1[nH]cnc2[nH]ncc12", name: "Allopurinol", uniprotId: "P47989", geneName: "XDH", fullName: "Xanthine Dehydrogenase/Oxidase", targetClass: "Oxidoreductase", area: "Metabolic / Diabetes", color: "emerald", activityNM: 7600 },

  { smiles: "CC(C)NCC(O)c1ccc(O)c(O)c1", name: "Isoproterenol", uniprotId: "P07550", geneName: "ADRB2", fullName: "Beta-2 Adrenergic Receptor", targetClass: "GPCR", area: "Respiratory", color: "cyan", activityNM: 90 },
  { smiles: "CC(C)(C)NCC(O)c1ccc(O)c(CO)c1", name: "Salbutamol", uniprotId: "P07550", geneName: "ADRB2", fullName: "Beta-2 Adrenergic Receptor", targetClass: "GPCR", area: "Respiratory", color: "cyan", activityNM: 200 },

  { smiles: "Fc1ccc(C2CCNCC2COc3ccc4[nH]c(=O)[nH]c4c3)cc1", name: "5-HT2A ligand", uniprotId: "P28223", geneName: "HTR2A", fullName: "5-Hydroxytryptamine Receptor 2A", targetClass: "GPCR", area: "CNS / Psychiatry", color: "cyan", activityNM: 50 },
  { smiles: "Clc1ccc2[nH]c3c(c2c1)CCN(C3)C1CCN(CCc2c[nH]c3ccccc23)CC1", name: "Risperidone-core", uniprotId: "P28223", geneName: "HTR2A", fullName: "5-Hydroxytryptamine Receptor 2A", targetClass: "GPCR", area: "CNS / Psychiatry", color: "cyan", activityNM: 0.2 },

  { smiles: "CN1c2ccccc2C(=NCC(=O)O)c3cc(Cl)ccc31", name: "Diazepam-analog", uniprotId: "P14867", geneName: "GABRA1", fullName: "GABA-A Receptor Alpha-1", targetClass: "Ion Channel", area: "CNS / Psychiatry", color: "cyan", activityNM: 17 },

  { smiles: "O=C(O)CCCCCCC(=O)Nc1ccccc1", name: "Vorinostat-core", uniprotId: "Q13547", geneName: "HDAC1", fullName: "Histone Deacetylase 1", targetClass: "Epigenetic Enzyme", area: "Oncology (Epigenetic)", color: "violet", activityNM: 10 },
  { smiles: "O=C(CCCCCCC(=O)Nc1ccccc1)NO", name: "Vorinostat", uniprotId: "Q13547", geneName: "HDAC1", fullName: "Histone Deacetylase 1", targetClass: "Epigenetic Enzyme", area: "Oncology (Epigenetic)", color: "violet", activityNM: 10 },

  { smiles: "O=C(NS(=O)(=O)c1ccc(F)cc1)c1cc2ccccc2[nH]1", name: "Vemurafenib-core", uniprotId: "P15056", geneName: "BRAF", fullName: "Serine/Threonine-Protein Kinase B-Raf", targetClass: "Serine/Threonine Kinase", area: "Oncology (Melanoma)", color: "violet", activityNM: 31 },

  { smiles: "CC(C)Oc1ccc(CC2SC(=O)N(CC(=O)O)C2=O)cc1", name: "Pioglitazone-analog", uniprotId: "P37231", geneName: "PPARG", fullName: "Peroxisome Proliferator-Activated Receptor Gamma", targetClass: "Nuclear Receptor", area: "Metabolic / Diabetes", color: "emerald", activityNM: 30 },
  { smiles: "O=C1NC(=O)C(Cc2ccc(OCCCCCC3C(=O)NC(=O)S3)cc2)S1", name: "Pioglitazone", uniprotId: "P37231", geneName: "PPARG", fullName: "Peroxisome Proliferator-Activated Receptor Gamma", targetClass: "Nuclear Receptor", area: "Metabolic / Diabetes", color: "emerald", activityNM: 490 },

  { smiles: "NC(=O)c1ccc(Nc2nc(-c3ccc(F)cc3)c3cc(F)c(F)cc3n2)cc1", name: "Crizotinib-core", uniprotId: "Q9UM73", geneName: "ALK", fullName: "ALK Tyrosine Kinase Receptor", targetClass: "Tyrosine Kinase", area: "Oncology (NSCLC)", color: "violet", activityNM: 24 },

  { smiles: "CCOc1cc2ncc(C#N)c(Nc3ccc(OCc4ccccn4)c(Cl)c3)c2cc1NC(=O)/C=C/CN(C)C", name: "Neratinib", uniprotId: "P04626", geneName: "ERBB2", fullName: "Receptor Tyrosine-Protein Kinase erbB-2", targetClass: "Tyrosine Kinase", area: "Oncology (Breast)", color: "violet", activityNM: 59 },

  { smiles: "CS(=O)(=O)CCNCc1ccc(-c2ccc3c(c2)C(=O)N(c2cnc4ccccc4n2)C3)o1", name: "Olaparib-analog", uniprotId: "P09874", geneName: "PARP1", fullName: "Poly [ADP-ribose] Polymerase 1", targetClass: "DNA Repair Enzyme", area: "Oncology (BRCA)", color: "violet", activityNM: 5 },

  { smiles: "O=C(c1cc(=O)[nH]c2ccccc12)N1CCC(=O)NC1=O", name: "Lenalidomide", uniprotId: "Q96SW2", geneName: "CRBN", fullName: "Cereblon", targetClass: "E3 Ubiquitin Ligase", area: "Oncology (Myeloma)", color: "violet", activityNM: 178 },

  { smiles: "CC1=NN(c2ccccc2)C(=O)C1/N=N/c1ccc(S(=O)(=O)O)cc1", name: "Sulfasalazine", uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)", targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber", activityNM: 5000 },

  { smiles: "CS(=O)(=O)c1ccc(C2=C(c3ccccc3)C(=O)OC2)cc1", name: "Rofecoxib", uniprotId: "P35354", geneName: "PTGS2", fullName: "Prostaglandin G/H Synthase 2 (COX-2)", targetClass: "Cyclooxygenase", area: "Inflammation / Pain", color: "amber", activityNM: 18 },

  { smiles: "Clc1ccc(C(c2ccc(Cl)cc2)n2ccnc2)cc1", name: "Clotrimazole", uniprotId: "P10635", geneName: "CYP17A1", fullName: "Steroid 17-alpha-hydroxylase/17,20-lyase", targetClass: "Cytochrome P450", area: "Infectious Disease", color: "cyan", activityNM: 25 },

  { smiles: "OC(Cn1cncn1)(c1ccc(F)cc1)c1ccc(F)cc1", name: "Fluconazole", uniprotId: "P10635", geneName: "CYP17A1", fullName: "Steroid 17-alpha-hydroxylase/17,20-lyase", targetClass: "Cytochrome P450", area: "Infectious Disease", color: "cyan", activityNM: 44 },

  { smiles: "CC(C)c1nc(N(C)S(=O)(=O)c2ccc(N)cc2)nc(-c2ccc(F)cc2)c1/C=C/[C@@H](O)C[C@@H](O)CC(=O)O", name: "Rosuvastatin", uniprotId: "P04035", geneName: "HMGCR", fullName: "HMG-CoA Reductase", targetClass: "Oxidoreductase", area: "Cardiovascular", color: "blue", activityNM: 5 },
  { smiles: "CCC(C)C(=O)Oc1ccc2C(CC(O)C3CCCc4c(C)c(O)c(C)c(O)c43)C(C)=Cc2c1", name: "Lovastatin-analog", uniprotId: "P04035", geneName: "HMGCR", fullName: "HMG-CoA Reductase", targetClass: "Oxidoreductase", area: "Cardiovascular", color: "blue", activityNM: 10 },

  { smiles: "O=c1nc(N2CCCC2)c2cc(F)c(-c3cc(F)ccc3F)cc2o1", name: "Trametinib-core", uniprotId: "Q02750", geneName: "MAP2K1", fullName: "Dual Specificity Mitogen-Activated Protein Kinase Kinase 1", targetClass: "Serine/Threonine Kinase", area: "Oncology (Melanoma)", color: "violet", activityNM: 0.7 },

  { smiles: "CN1CCC(=C2c3ccccc3COc3ccccc32)CC1", name: "Doxepin-analog", uniprotId: "P28223", geneName: "HTR2A", fullName: "5-Hydroxytryptamine Receptor 2A", targetClass: "GPCR", area: "CNS / Psychiatry", color: "cyan", activityNM: 4 },

  { smiles: "CN(C)CCCN1c2ccccc2Sc3ccc(Cl)cc31", name: "Chlorpromazine", uniprotId: "P14416", geneName: "DRD2", fullName: "Dopamine D2 Receptor", targetClass: "GPCR", area: "CNS / Psychiatry", color: "cyan", activityNM: 3 },
  { smiles: "Oc1ccc2c(c1)[nH]c1ccc(O)cc12", name: "Serotonin-scaffold", uniprotId: "P28223", geneName: "HTR2A", fullName: "5-Hydroxytryptamine Receptor 2A", targetClass: "GPCR", area: "CNS / Psychiatry", color: "cyan", activityNM: 100 },

  { smiles: "OC(=O)CCc1ccc(N(CCCl)CCCl)cc1", name: "Chlorambucil", uniprotId: "P11473", geneName: "NR3C1", fullName: "Glucocorticoid Receptor", targetClass: "DNA Alkylator", area: "Oncology (Hematology)", color: "violet", activityNM: 1000 },

  { smiles: "NC1=NC(=O)N(C2OC(CO)C(O)C2O)C=C1", name: "Cytarabine", uniprotId: "P15169", geneName: "CPN1", fullName: "Carboxypeptidase N", targetClass: "Antimetabolite", area: "Oncology (Hematology)", color: "violet", activityNM: 200 },

  { smiles: "CC(=O)OC1C(OC(C)=O)C2C(OC1OC(=O)c1ccccc1)(OC(=O)c1ccccc1)C1(C)CC(O)C3(C)C(=CC(=O)C3(C)C1=O)C2C", name: "Paclitaxel-frag", uniprotId: "P68371", geneName: "TUBB4B", fullName: "Tubulin Beta-4B Chain", targetClass: "Structural Protein", area: "Oncology", color: "violet", activityNM: 4 },

  { smiles: "NS(=O)(=O)c1cc2c(cc1Cl)NC(NS2(=O)=O)NS2(=O)=O", name: "Hydrochlorothiazide", uniprotId: "P23975", geneName: "SLC12A3", fullName: "Solute Carrier Family 12 Member 3", targetClass: "Transporter", area: "Cardiovascular", color: "blue", activityNM: 500 },

  { smiles: "COc1ccc2[C@@H]3CC4=CC(=O)CCC4(C)[C@H]3CC[C@@]2(C)c1O", name: "Mestranol-core", uniprotId: "P03372", geneName: "ESR1", fullName: "Estrogen Receptor Alpha", targetClass: "Nuclear Receptor", area: "Oncology (Breast)", color: "blue", activityNM: 1 },
];

interface CachedRef {
  ref: ReferenceCompound;
  fp: string;
}

let cachedFingerprints: CachedRef[] | null = null;

function ensureCache(): CachedRef[] {
  if (cachedFingerprints && cachedFingerprints.length > 0) return cachedFingerprints;

  const result: CachedRef[] = [];
  for (const ref of REFERENCE_LIBRARY) {
    const fpInfo = generateFingerprint(ref.smiles);
    if (fpInfo) {
      result.push({ ref, fp: fpInfo.bitString });
    }
  }

  if (result.length > 0) {
    cachedFingerprints = result;
  }

  return result;
}

export function ligandSimilaritySearch(
  querySmiles: string,
  topK = 10,
  minSimilarity = 0.15,
): SimilarityHit[] {
  const queryFp = generateFingerprint(querySmiles);
  if (!queryFp) return [];

  const cache = ensureCache();
  if (cache.length === 0) return [];

  const scored: SimilarityHit[] = [];
  for (const entry of cache) {
    const tc = computeTanimotoSimilarity(queryFp.bitString, entry.fp);
    if (tc >= minSimilarity) {
      scored.push({ ref: entry.ref, tanimoto: tc });
    }
  }

  scored.sort((a, b) => b.tanimoto - a.tanimoto);
  return scored.slice(0, topK);
}

export function aggregateSimilarityByTarget(
  hits: SimilarityHit[],
): LigandSimilarityResult[] {
  const byTarget = new Map<string, { refs: SimilarityHit[]; meta: ReferenceCompound }>();

  for (const hit of hits) {
    const key = hit.ref.uniprotId;
    if (!byTarget.has(key)) {
      byTarget.set(key, { refs: [], meta: hit.ref });
    }
    byTarget.get(key)!.refs.push(hit);
  }

  const results: LigandSimilarityResult[] = [];
  for (const [uniprotId, data] of byTarget) {
    const sims = data.refs.map(r => r.tanimoto);
    const bestSimilarity = Math.max(...sims);
    const avgSimilarity = sims.reduce((a, b) => a + b, 0) / sims.length;

    results.push({
      uniprotId,
      geneName: data.meta.geneName,
      fullName: data.meta.fullName,
      targetClass: data.meta.targetClass,
      area: data.meta.area,
      color: data.meta.color,
      bestSimilarity,
      avgSimilarity,
      hits: data.refs.map(r => ({
        name: r.ref.name,
        tanimoto: r.tanimoto,
        activityNM: r.ref.activityNM,
      })),
    });
  }

  results.sort((a, b) => b.bestSimilarity - a.bestSimilarity);
  return results;
}
