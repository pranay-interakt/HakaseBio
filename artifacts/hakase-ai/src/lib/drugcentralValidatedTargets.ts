// AUTO-GENERATED — do not edit by hand.
// Run `node artifacts/hakase-ai/scripts/build-drugcentral-allowlist.mjs` to regenerate.
//
// Source: DrugCentral 2021_09_01 drug.target.interaction.tsv
// License: CC BY-SA 4.0 — Avram, S. et al., Nucleic Acids Res. 2023;51(D1):D1276-D1287.
//          https://drugcentral.org/  https://unmtid-dbs.net/download/
//
// Filter: human, single-accession, ACT_TYPE ∈ {IC50,Ki,Kd + p-forms},
// TARGET_CLASS ∈ {Kinase, Enzyme, Ion channel}, ≥10 datapoints/UniProt.
// Both gates matter: ≥10 quantitative inhibition rows guarantees the target
// has enough literature to cross-check a predicted curve, AND the class
// restriction guarantees the L1 inhibition-style IC50/Hill model is
// mechanistically appropriate. GPCRs / NRs / transporters etc. are
// deliberately excluded until a class-aware (agonist/EC50) model lands.
//
// 179 accessions.

export interface DrugCentralTargetMeta {
  gene: string;
  targetClass: string;
  targetName: string;
  bioactivityCount: number;
}

export const DRUGCENTRAL_VALIDATED_TARGETS: ReadonlySet<string> = new Set([
  "O00329", // PIK3CD [Kinase] n=11
  "O00444", // PLK4 [Kinase] n=13
  "O14965", // AURKA [Kinase] n=15
  "O14976", // GAK [Kinase] n=16
  "O15197", // EPHB6 [Kinase] n=18
  "O43318", // MAP3K7 [Kinase] n=12
  "O43353", // RIPK2 [Kinase] n=16
  "O43570", // CA12 [Enzyme] n=45
  "O60341", // KDM1A [Enzyme] n=14
  "O60674", // JAK2 [Kinase] n=26
  "O75116", // ROCK2 [Kinase] n=13
  "O76074", // PDE5A [Enzyme] n=12
  "O94804", // STK10 [Kinase] n=19
  "O95069", // KCNK2 [Ion channel] n=11
  "O95180", // CACNA1H [Ion channel] n=18
  "O95819", // MAP4K4 [Kinase] n=11
  "P00374", // DHFR [Enzyme] n=17
  "P00519", // ABL1 [Kinase] n=28
  "P00533", // EGFR [Kinase] n=65
  "P00734", // F2 [Enzyme] n=20
  "P00742", // F10 [Enzyme] n=12
  "P00747", // PLG [Enzyme] n=10
  "P00915", // CA1 [Enzyme] n=51
  "P00918", // CA2 [Enzyme] n=65
  "P04035", // HMGCR [Enzyme] n=11
  "P04049", // RAF1 [Kinase] n=10
  "P04626", // ERBB2 [Kinase] n=35
  "P04629", // NTRK1 [Kinase] n=17
  "P05164", // MPO [Enzyme] n=18
  "P05177", // CYP1A2 [Enzyme] n=29
  "P06213", // INSR [Kinase] n=16
  "P06239", // LCK [Kinase] n=47
  "P06241", // FYN [Kinase] n=64
  "P06276", // BCHE [Enzyme] n=15
  "P07333", // CSF1R [Kinase] n=19
  "P07451", // CA3 [Enzyme] n=25
  "P07947", // YES1 [Kinase] n=16
  "P07948", // LYN [Kinase] n=24
  "P07949", // RET [Kinase] n=38
  "P08069", // IGF1R [Kinase] n=11
  "P08253", // MMP2 [Enzyme] n=12
  "P08581", // MET [Kinase] n=23
  "P08631", // HCK [Kinase] n=16
  "P08684", // CYP3A4 [Enzyme] n=71
  "P08922", // ROS1 [Kinase] n=16
  "P09619", // PDGFRB [Kinase] n=23
  "P09769", // FGR [Kinase] n=18
  "P09917", // ALOX5 [Enzyme] n=15
  "P10635", // CYP2D6 [Enzyme] n=77
  "P10721", // KIT [Kinase] n=34
  "P11362", // FGFR1 [Kinase] n=22
  "P11387", // TOP1 [Enzyme] n=10
  "P11511", // CYP19A1 [Enzyme] n=24
  "P11712", // CYP2C9 [Enzyme] n=53
  "P12821", // ACE [Enzyme] n=23
  "P12931", // SRC [Kinase] n=31
  "P14780", // MMP9 [Enzyme] n=18
  "P14902", // IDO1 [Enzyme] n=13
  "P15056", // BRAF [Kinase] n=17
  "P15121", // AKR1B1 [Enzyme] n=14
  "P16234", // PDGFRA [Kinase] n=24
  "P16591", // FER [Kinase] n=10
  "P17948", // FLT1 [Kinase] n=20
  "P21397", // MAOA [Enzyme] n=36
  "P21802", // FGFR2 [Kinase] n=17
  "P22303", // ACHE [Enzyme] n=59
  "P22607", // FGFR3 [Kinase] n=15
  "P22748", // CA4 [Enzyme] n=43
  "P23219", // PTGS1 [Enzyme] n=65
  "P23280", // CA6 [Enzyme] n=34
  "P23458", // JAK1 [Kinase] n=14
  "P24557", // TBXAS1 [Enzyme] n=33
  "P27338", // MAOB [Enzyme] n=26
  "P27361", // MAPK3 [Kinase] n=13
  "P27487", // DPP4 [Enzyme] n=16
  "P27815", // PDE4A [Enzyme] n=13
  "P28482", // MAPK1 [Kinase] n=15
  "P29320", // EPHA3 [Kinase] n=13
  "P29322", // EPHA8 [Kinase] n=10
  "P29376", // LTK [Kinase] n=13
  "P29597", // TYK2 [Kinase] n=19
  "P30530", // AXL [Kinase] n=16
  "P32298", // GRK4 [Kinase] n=10
  "P33261", // CYP2C19 [Enzyme] n=45
  "P33981", // TTK [Kinase] n=10
  "P34913", // EPHX2 [Enzyme] n=13
  "P35218", // CA5A [Enzyme] n=40
  "P35354", // PTGS2 [Enzyme] n=65
  "P35590", // TIE1 [Kinase] n=14
  "P35916", // FLT4 [Kinase] n=18
  "P35968", // KDR [Kinase] n=34
  "P36507", // MAP2K2 [Kinase] n=13
  "P36544", // CHRNA7 [Ion channel] n=14
  "P36888", // FLT3 [Kinase] n=37
  "P41240", // CSK [Kinase] n=13
  "P42330", // AKR1C3 [Enzyme] n=15
  "P42681", // TXK [Kinase] n=15
  "P42684", // ABL2 [Kinase] n=14
  "P42685", // FRK [Kinase] n=17
  "P43166", // CA7 [Enzyme] n=40
  "P43405", // SYK [Kinase] n=13
  "P45984", // MAPK9 [Kinase] n=10
  "P46098", // HTR3A [Ion channel] n=37
  "P49674", // CSNK1E [Kinase] n=10
  "P50613", // CDK7 [Kinase] n=14
  "P51451", // BLK [Kinase] n=18
  "P51617", // IRAK1 [Kinase] n=13
  "P51813", // BMX [Kinase] n=11
  "P52333", // JAK3 [Kinase] n=24
  "P52895", // AKR1C2 [Enzyme] n=10
  "P53779", // MAPK10 [Kinase] n=12
  "P54760", // EPHB4 [Kinase] n=12
  "P54762", // EPHB1 [Kinase] n=14
  "P57059", // SIK1 [Kinase] n=10
  "Q02750", // MAP2K1 [Kinase] n=13
  "Q02763", // TEK [Kinase] n=21
  "Q05397", // PTK2 [Kinase] n=11
  "Q06187", // BTK [Kinase] n=15
  "Q06278", // AOX1 [Enzyme] n=36
  "Q07912", // TNK2 [Kinase] n=13
  "Q08345", // DDR1 [Kinase] n=16
  "Q09013", // DMPK [Kinase] n=10
  "Q12809", // KCNH2 [Ion channel] n=176
  "Q12851", // MAP4K2 [Kinase] n=14
  "Q12866", // MERTK [Kinase] n=14
  "Q13163", // MAP2K5 [Kinase] n=16
  "Q13464", // ROCK1 [Kinase] n=10
  "Q13470", // TNK1 [Kinase] n=10
  "Q13546", // RIPK1 [Kinase] n=12
  "Q13547", // HDAC1 [Enzyme] n=11
  "Q13936", // CACNA1C [Ion channel] n=10
  "Q14524", // SCN5A [Ion channel] n=18
  "Q15125", // EBP [Enzyme] n=11
  "Q15303", // ERBB4 [Kinase] n=15
  "Q15418", // RPS6KA1 [Kinase] n=10
  "Q15746", // MYLK [Kinase] n=10
  "Q15858", // SCN9A [Ion channel] n=10
  "Q16288", // NTRK3 [Kinase] n=15
  "Q16539", // MAPK14 [Kinase] n=21
  "Q16620", // NTRK2 [Kinase] n=16
  "Q16790", // CA9 [Enzyme] n=45
  "Q16816", // PHKG1 [Kinase] n=10
  "Q16832", // DDR2 [Kinase] n=13
  "Q16850", // CYP51A1 [Enzyme] n=11
  "Q2M2I8", // AAK1 [Kinase] n=12
  "Q56UN5", // MAP3K19 [Kinase] n=17
  "Q5S007", // LRRK2 [Kinase] n=10
  "Q6PHR2", // ULK3 [Kinase] n=12
  "Q6XQN6", // NAPRT [Enzyme] n=12
  "Q8IVH8", // MAP4K3 [Kinase] n=12
  "Q8N1Q1", // CA13 [Enzyme] n=21
  "Q8N4C8", // MINK1 [Kinase] n=13
  "Q8NE63", // HIPK4 [Kinase] n=13
  "Q92769", // HDAC2 [Enzyme] n=10
  "Q92918", // MAP4K1 [Kinase] n=14
  "Q96GD4", // AURKB [Kinase] n=12
  "Q96SB4", // SRPK1 [Kinase] n=10
  "Q99759", // MAP3K3 [Kinase] n=13
  "Q9H093", // NUAK2 [Kinase] n=13
  "Q9H0K1", // SIK2 [Kinase] n=12
  "Q9H2G2", // SLK [Kinase] n=18
  "Q9H2K8", // TAOK3 [Kinase] n=11
  "Q9HBH9", // MKNK2 [Kinase] n=12
  "Q9NSY1", // BMP2K [Kinase] n=13
  "Q9NYL2", // ZAK [Kinase] n=10
  "Q9UBN7", // HDAC6 [Enzyme] n=11
  "Q9UEE5", // STK17A [Kinase] n=10
  "Q9UF33", // EPHA6 [Kinase] n=13
  "Q9UHD2", // TBK1 [Kinase] n=10
  "Q9UK32", // RPS6KA6 [Kinase] n=11
  "Q9UKE5", // TNIK [Kinase] n=14
  "Q9ULX7", // CA14 [Enzyme] n=39
  "Q9UM73", // ALK [Kinase] n=21
  "Q9UPE1", // SRPK3 [Kinase] n=10
  "Q9UQB9", // AURKC [Kinase] n=12
  "Q9Y2D0", // CA5B [Enzyme] n=33
  "Q9Y2U5", // MAP3K2 [Kinase] n=13
  "Q9Y3Q4", // HCN4 [Ion channel] n=12
  "Q9Y4K4", // MAP4K5 [Kinase] n=13
]);

export const DRUGCENTRAL_TARGET_META: Readonly<Record<string, DrugCentralTargetMeta>> = {
  "O00329": {
    "gene": "PIK3CD",
    "targetClass": "Kinase",
    "targetName": "Phosphatidylinositol 4,5-bisphosphate 3-kinase catalytic subunit delta isoform",
    "bioactivityCount": 11
  },
  "O00444": {
    "gene": "PLK4",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase PLK4",
    "bioactivityCount": 13
  },
  "O14965": {
    "gene": "AURKA",
    "targetClass": "Kinase",
    "targetName": "Aurora kinase A",
    "bioactivityCount": 15
  },
  "O14976": {
    "gene": "GAK",
    "targetClass": "Kinase",
    "targetName": "Cyclin-G-associated kinase",
    "bioactivityCount": 16
  },
  "O15197": {
    "gene": "EPHB6",
    "targetClass": "Kinase",
    "targetName": "Ephrin type-B receptor 6",
    "bioactivityCount": 18
  },
  "O43318": {
    "gene": "MAP3K7",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase 7",
    "bioactivityCount": 12
  },
  "O43353": {
    "gene": "RIPK2",
    "targetClass": "Kinase",
    "targetName": "Receptor-interacting serine/threonine-protein kinase 2",
    "bioactivityCount": 16
  },
  "O43570": {
    "gene": "CA12",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 12",
    "bioactivityCount": 45
  },
  "O60341": {
    "gene": "KDM1A",
    "targetClass": "Enzyme",
    "targetName": "Lysine-specific histone demethylase 1A",
    "bioactivityCount": 14
  },
  "O60674": {
    "gene": "JAK2",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase JAK2",
    "bioactivityCount": 26
  },
  "O75116": {
    "gene": "ROCK2",
    "targetClass": "Kinase",
    "targetName": "Rho-associated protein kinase 2",
    "bioactivityCount": 13
  },
  "O76074": {
    "gene": "PDE5A",
    "targetClass": "Enzyme",
    "targetName": "cGMP-specific 3',5'-cyclic phosphodiesterase",
    "bioactivityCount": 12
  },
  "O94804": {
    "gene": "STK10",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase 10",
    "bioactivityCount": 19
  },
  "O95069": {
    "gene": "KCNK2",
    "targetClass": "Ion channel",
    "targetName": "Potassium channel subfamily K member 2",
    "bioactivityCount": 11
  },
  "O95180": {
    "gene": "CACNA1H",
    "targetClass": "Ion channel",
    "targetName": "Voltage-dependent T-type calcium channel subunit alpha-1H",
    "bioactivityCount": 18
  },
  "O95819": {
    "gene": "MAP4K4",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase kinase 4",
    "bioactivityCount": 11
  },
  "P00374": {
    "gene": "DHFR",
    "targetClass": "Enzyme",
    "targetName": "Dihydrofolate reductase",
    "bioactivityCount": 17
  },
  "P00519": {
    "gene": "ABL1",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase ABL1",
    "bioactivityCount": 28
  },
  "P00533": {
    "gene": "EGFR",
    "targetClass": "Kinase",
    "targetName": "Epidermal growth factor receptor",
    "bioactivityCount": 65
  },
  "P00734": {
    "gene": "F2",
    "targetClass": "Enzyme",
    "targetName": "Prothrombin",
    "bioactivityCount": 20
  },
  "P00742": {
    "gene": "F10",
    "targetClass": "Enzyme",
    "targetName": "Coagulation factor X",
    "bioactivityCount": 12
  },
  "P00747": {
    "gene": "PLG",
    "targetClass": "Enzyme",
    "targetName": "Plasminogen",
    "bioactivityCount": 10
  },
  "P00915": {
    "gene": "CA1",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 1",
    "bioactivityCount": 51
  },
  "P00918": {
    "gene": "CA2",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 2",
    "bioactivityCount": 65
  },
  "P04035": {
    "gene": "HMGCR",
    "targetClass": "Enzyme",
    "targetName": "3-hydroxy-3-methylglutaryl-coenzyme A reductase",
    "bioactivityCount": 11
  },
  "P04049": {
    "gene": "RAF1",
    "targetClass": "Kinase",
    "targetName": "RAF proto-oncogene serine/threonine-protein kinase",
    "bioactivityCount": 10
  },
  "P04626": {
    "gene": "ERBB2",
    "targetClass": "Kinase",
    "targetName": "Receptor tyrosine-protein kinase erbB-2",
    "bioactivityCount": 35
  },
  "P04629": {
    "gene": "NTRK1",
    "targetClass": "Kinase",
    "targetName": "High affinity nerve growth factor receptor",
    "bioactivityCount": 17
  },
  "P05164": {
    "gene": "MPO",
    "targetClass": "Enzyme",
    "targetName": "Myeloperoxidase",
    "bioactivityCount": 18
  },
  "P05177": {
    "gene": "CYP1A2",
    "targetClass": "Enzyme",
    "targetName": "Cytochrome P450 1A2",
    "bioactivityCount": 29
  },
  "P06213": {
    "gene": "INSR",
    "targetClass": "Kinase",
    "targetName": "Insulin receptor",
    "bioactivityCount": 16
  },
  "P06239": {
    "gene": "LCK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase Lck",
    "bioactivityCount": 47
  },
  "P06241": {
    "gene": "FYN",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase Fyn",
    "bioactivityCount": 64
  },
  "P06276": {
    "gene": "BCHE",
    "targetClass": "Enzyme",
    "targetName": "Cholinesterase",
    "bioactivityCount": 15
  },
  "P07333": {
    "gene": "CSF1R",
    "targetClass": "Kinase",
    "targetName": "Macrophage colony-stimulating factor 1 receptor",
    "bioactivityCount": 19
  },
  "P07451": {
    "gene": "CA3",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 3",
    "bioactivityCount": 25
  },
  "P07947": {
    "gene": "YES1",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase Yes",
    "bioactivityCount": 16
  },
  "P07948": {
    "gene": "LYN",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase Lyn",
    "bioactivityCount": 24
  },
  "P07949": {
    "gene": "RET",
    "targetClass": "Kinase",
    "targetName": "Proto-oncogene tyrosine-protein kinase receptor Ret",
    "bioactivityCount": 38
  },
  "P08069": {
    "gene": "IGF1R",
    "targetClass": "Kinase",
    "targetName": "Insulin-like growth factor 1 receptor",
    "bioactivityCount": 11
  },
  "P08253": {
    "gene": "MMP2",
    "targetClass": "Enzyme",
    "targetName": "72 kDa type IV collagenase",
    "bioactivityCount": 12
  },
  "P08581": {
    "gene": "MET",
    "targetClass": "Kinase",
    "targetName": "Hepatocyte growth factor receptor",
    "bioactivityCount": 23
  },
  "P08631": {
    "gene": "HCK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase HCK",
    "bioactivityCount": 16
  },
  "P08684": {
    "gene": "CYP3A4",
    "targetClass": "Enzyme",
    "targetName": "Cytochrome P450 3A4",
    "bioactivityCount": 71
  },
  "P08922": {
    "gene": "ROS1",
    "targetClass": "Kinase",
    "targetName": "Proto-oncogene tyrosine-protein kinase ROS",
    "bioactivityCount": 16
  },
  "P09619": {
    "gene": "PDGFRB",
    "targetClass": "Kinase",
    "targetName": "Platelet-derived growth factor receptor beta",
    "bioactivityCount": 23
  },
  "P09769": {
    "gene": "FGR",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase Fgr",
    "bioactivityCount": 18
  },
  "P09917": {
    "gene": "ALOX5",
    "targetClass": "Enzyme",
    "targetName": "Arachidonate 5-lipoxygenase",
    "bioactivityCount": 15
  },
  "P10635": {
    "gene": "CYP2D6",
    "targetClass": "Enzyme",
    "targetName": "Cytochrome P450 2D6",
    "bioactivityCount": 77
  },
  "P10721": {
    "gene": "KIT",
    "targetClass": "Kinase",
    "targetName": "Mast/stem cell growth factor receptor Kit",
    "bioactivityCount": 34
  },
  "P11362": {
    "gene": "FGFR1",
    "targetClass": "Kinase",
    "targetName": "Fibroblast growth factor receptor 1",
    "bioactivityCount": 22
  },
  "P11387": {
    "gene": "TOP1",
    "targetClass": "Enzyme",
    "targetName": "DNA topoisomerase 1",
    "bioactivityCount": 10
  },
  "P11511": {
    "gene": "CYP19A1",
    "targetClass": "Enzyme",
    "targetName": "Aromatase",
    "bioactivityCount": 24
  },
  "P11712": {
    "gene": "CYP2C9",
    "targetClass": "Enzyme",
    "targetName": "Cytochrome P450 2C9",
    "bioactivityCount": 53
  },
  "P12821": {
    "gene": "ACE",
    "targetClass": "Enzyme",
    "targetName": "Angiotensin-converting enzyme",
    "bioactivityCount": 23
  },
  "P12931": {
    "gene": "SRC",
    "targetClass": "Kinase",
    "targetName": "Proto-oncogene tyrosine-protein kinase Src",
    "bioactivityCount": 31
  },
  "P14780": {
    "gene": "MMP9",
    "targetClass": "Enzyme",
    "targetName": "Matrix metalloproteinase-9",
    "bioactivityCount": 18
  },
  "P14902": {
    "gene": "IDO1",
    "targetClass": "Enzyme",
    "targetName": "Indoleamine 2,3-dioxygenase 1",
    "bioactivityCount": 13
  },
  "P15056": {
    "gene": "BRAF",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase B-raf",
    "bioactivityCount": 17
  },
  "P15121": {
    "gene": "AKR1B1",
    "targetClass": "Enzyme",
    "targetName": "Aldose reductase",
    "bioactivityCount": 14
  },
  "P16234": {
    "gene": "PDGFRA",
    "targetClass": "Kinase",
    "targetName": "Platelet-derived growth factor receptor alpha",
    "bioactivityCount": 24
  },
  "P16591": {
    "gene": "FER",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase Fer",
    "bioactivityCount": 10
  },
  "P17948": {
    "gene": "FLT1",
    "targetClass": "Kinase",
    "targetName": "Vascular endothelial growth factor receptor 1",
    "bioactivityCount": 20
  },
  "P21397": {
    "gene": "MAOA",
    "targetClass": "Enzyme",
    "targetName": "Amine oxidase [flavin-containing] A",
    "bioactivityCount": 36
  },
  "P21802": {
    "gene": "FGFR2",
    "targetClass": "Kinase",
    "targetName": "Fibroblast growth factor receptor 2",
    "bioactivityCount": 17
  },
  "P22303": {
    "gene": "ACHE",
    "targetClass": "Enzyme",
    "targetName": "Acetylcholinesterase",
    "bioactivityCount": 59
  },
  "P22607": {
    "gene": "FGFR3",
    "targetClass": "Kinase",
    "targetName": "Fibroblast growth factor receptor 3",
    "bioactivityCount": 15
  },
  "P22748": {
    "gene": "CA4",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 4",
    "bioactivityCount": 43
  },
  "P23219": {
    "gene": "PTGS1",
    "targetClass": "Enzyme",
    "targetName": "Prostaglandin G/H synthase 1",
    "bioactivityCount": 65
  },
  "P23280": {
    "gene": "CA6",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 6",
    "bioactivityCount": 34
  },
  "P23458": {
    "gene": "JAK1",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase JAK1",
    "bioactivityCount": 14
  },
  "P24557": {
    "gene": "TBXAS1",
    "targetClass": "Enzyme",
    "targetName": "Thromboxane-A synthase",
    "bioactivityCount": 33
  },
  "P27338": {
    "gene": "MAOB",
    "targetClass": "Enzyme",
    "targetName": "Amine oxidase [flavin-containing] B",
    "bioactivityCount": 26
  },
  "P27361": {
    "gene": "MAPK3",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase 3",
    "bioactivityCount": 13
  },
  "P27487": {
    "gene": "DPP4",
    "targetClass": "Enzyme",
    "targetName": "Dipeptidyl peptidase 4",
    "bioactivityCount": 16
  },
  "P27815": {
    "gene": "PDE4A",
    "targetClass": "Enzyme",
    "targetName": "cAMP-specific 3',5'-cyclic phosphodiesterase 4A",
    "bioactivityCount": 13
  },
  "P28482": {
    "gene": "MAPK1",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase 1",
    "bioactivityCount": 15
  },
  "P29320": {
    "gene": "EPHA3",
    "targetClass": "Kinase",
    "targetName": "Ephrin type-A receptor 3",
    "bioactivityCount": 13
  },
  "P29322": {
    "gene": "EPHA8",
    "targetClass": "Kinase",
    "targetName": "Ephrin type-A receptor 8",
    "bioactivityCount": 10
  },
  "P29376": {
    "gene": "LTK",
    "targetClass": "Kinase",
    "targetName": "Leukocyte tyrosine kinase receptor",
    "bioactivityCount": 13
  },
  "P29597": {
    "gene": "TYK2",
    "targetClass": "Kinase",
    "targetName": "Non-receptor tyrosine-protein kinase TYK2",
    "bioactivityCount": 19
  },
  "P30530": {
    "gene": "AXL",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase receptor UFO",
    "bioactivityCount": 16
  },
  "P32298": {
    "gene": "GRK4",
    "targetClass": "Kinase",
    "targetName": "G protein-coupled receptor kinase 4",
    "bioactivityCount": 10
  },
  "P33261": {
    "gene": "CYP2C19",
    "targetClass": "Enzyme",
    "targetName": "Cytochrome P450 2C19",
    "bioactivityCount": 45
  },
  "P33981": {
    "gene": "TTK",
    "targetClass": "Kinase",
    "targetName": "Dual specificity protein kinase TTK",
    "bioactivityCount": 10
  },
  "P34913": {
    "gene": "EPHX2",
    "targetClass": "Enzyme",
    "targetName": "Bifunctional epoxide hydrolase 2",
    "bioactivityCount": 13
  },
  "P35218": {
    "gene": "CA5A",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 5A, mitochondrial",
    "bioactivityCount": 40
  },
  "P35354": {
    "gene": "PTGS2",
    "targetClass": "Enzyme",
    "targetName": "Prostaglandin G/H synthase 2",
    "bioactivityCount": 65
  },
  "P35590": {
    "gene": "TIE1",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase receptor Tie-1",
    "bioactivityCount": 14
  },
  "P35916": {
    "gene": "FLT4",
    "targetClass": "Kinase",
    "targetName": "Vascular endothelial growth factor receptor 3",
    "bioactivityCount": 18
  },
  "P35968": {
    "gene": "KDR",
    "targetClass": "Kinase",
    "targetName": "Vascular endothelial growth factor receptor 2",
    "bioactivityCount": 34
  },
  "P36507": {
    "gene": "MAP2K2",
    "targetClass": "Kinase",
    "targetName": "Dual specificity mitogen-activated protein kinase kinase 2",
    "bioactivityCount": 13
  },
  "P36544": {
    "gene": "CHRNA7",
    "targetClass": "Ion channel",
    "targetName": "Neuronal acetylcholine receptor subunit alpha-7",
    "bioactivityCount": 14
  },
  "P36888": {
    "gene": "FLT3",
    "targetClass": "Kinase",
    "targetName": "Receptor-type tyrosine-protein kinase FLT3",
    "bioactivityCount": 37
  },
  "P41240": {
    "gene": "CSK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase CSK",
    "bioactivityCount": 13
  },
  "P42330": {
    "gene": "AKR1C3",
    "targetClass": "Enzyme",
    "targetName": "Aldo-keto reductase family 1 member C3",
    "bioactivityCount": 15
  },
  "P42681": {
    "gene": "TXK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase TXK",
    "bioactivityCount": 15
  },
  "P42684": {
    "gene": "ABL2",
    "targetClass": "Kinase",
    "targetName": "Abelson tyrosine-protein kinase 2",
    "bioactivityCount": 14
  },
  "P42685": {
    "gene": "FRK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase FRK",
    "bioactivityCount": 17
  },
  "P43166": {
    "gene": "CA7",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 7",
    "bioactivityCount": 40
  },
  "P43405": {
    "gene": "SYK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase SYK",
    "bioactivityCount": 13
  },
  "P45984": {
    "gene": "MAPK9",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase 9",
    "bioactivityCount": 10
  },
  "P46098": {
    "gene": "HTR3A",
    "targetClass": "Ion channel",
    "targetName": "5-hydroxytryptamine receptor 3A",
    "bioactivityCount": 37
  },
  "P49674": {
    "gene": "CSNK1E",
    "targetClass": "Kinase",
    "targetName": "Casein kinase I isoform epsilon",
    "bioactivityCount": 10
  },
  "P50613": {
    "gene": "CDK7",
    "targetClass": "Kinase",
    "targetName": "Cyclin-dependent kinase 7",
    "bioactivityCount": 14
  },
  "P51451": {
    "gene": "BLK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase Blk",
    "bioactivityCount": 18
  },
  "P51617": {
    "gene": "IRAK1",
    "targetClass": "Kinase",
    "targetName": "Interleukin-1 receptor-associated kinase 1",
    "bioactivityCount": 13
  },
  "P51813": {
    "gene": "BMX",
    "targetClass": "Kinase",
    "targetName": "Cytoplasmic tyrosine-protein kinase BMX",
    "bioactivityCount": 11
  },
  "P52333": {
    "gene": "JAK3",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase JAK3",
    "bioactivityCount": 24
  },
  "P52895": {
    "gene": "AKR1C2",
    "targetClass": "Enzyme",
    "targetName": "Aldo-keto reductase family 1 member C2",
    "bioactivityCount": 10
  },
  "P53779": {
    "gene": "MAPK10",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase 10",
    "bioactivityCount": 12
  },
  "P54760": {
    "gene": "EPHB4",
    "targetClass": "Kinase",
    "targetName": "Ephrin type-B receptor 4",
    "bioactivityCount": 12
  },
  "P54762": {
    "gene": "EPHB1",
    "targetClass": "Kinase",
    "targetName": "Ephrin type-B receptor 1",
    "bioactivityCount": 14
  },
  "P57059": {
    "gene": "SIK1",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase SIK1",
    "bioactivityCount": 10
  },
  "Q02750": {
    "gene": "MAP2K1",
    "targetClass": "Kinase",
    "targetName": "Dual specificity mitogen-activated protein kinase kinase 1",
    "bioactivityCount": 13
  },
  "Q02763": {
    "gene": "TEK",
    "targetClass": "Kinase",
    "targetName": "Angiopoietin-1 receptor",
    "bioactivityCount": 21
  },
  "Q05397": {
    "gene": "PTK2",
    "targetClass": "Kinase",
    "targetName": "Focal adhesion kinase 1",
    "bioactivityCount": 11
  },
  "Q06187": {
    "gene": "BTK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase BTK",
    "bioactivityCount": 15
  },
  "Q06278": {
    "gene": "AOX1",
    "targetClass": "Enzyme",
    "targetName": "Aldehyde oxidase",
    "bioactivityCount": 36
  },
  "Q07912": {
    "gene": "TNK2",
    "targetClass": "Kinase",
    "targetName": "Activated CDC42 kinase 1",
    "bioactivityCount": 13
  },
  "Q08345": {
    "gene": "DDR1",
    "targetClass": "Kinase",
    "targetName": "Epithelial discoidin domain-containing receptor 1",
    "bioactivityCount": 16
  },
  "Q09013": {
    "gene": "DMPK",
    "targetClass": "Kinase",
    "targetName": "Myotonin-protein kinase",
    "bioactivityCount": 10
  },
  "Q12809": {
    "gene": "KCNH2",
    "targetClass": "Ion channel",
    "targetName": "Potassium voltage-gated channel subfamily H member 2",
    "bioactivityCount": 176
  },
  "Q12851": {
    "gene": "MAP4K2",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase kinase 2",
    "bioactivityCount": 14
  },
  "Q12866": {
    "gene": "MERTK",
    "targetClass": "Kinase",
    "targetName": "Tyrosine-protein kinase Mer",
    "bioactivityCount": 14
  },
  "Q13163": {
    "gene": "MAP2K5",
    "targetClass": "Kinase",
    "targetName": "Dual specificity mitogen-activated protein kinase kinase 5",
    "bioactivityCount": 16
  },
  "Q13464": {
    "gene": "ROCK1",
    "targetClass": "Kinase",
    "targetName": "Rho-associated protein kinase 1",
    "bioactivityCount": 10
  },
  "Q13470": {
    "gene": "TNK1",
    "targetClass": "Kinase",
    "targetName": "Non-receptor tyrosine-protein kinase TNK1",
    "bioactivityCount": 10
  },
  "Q13546": {
    "gene": "RIPK1",
    "targetClass": "Kinase",
    "targetName": "Receptor-interacting serine/threonine-protein kinase 1",
    "bioactivityCount": 12
  },
  "Q13547": {
    "gene": "HDAC1",
    "targetClass": "Enzyme",
    "targetName": "Histone deacetylase 1",
    "bioactivityCount": 11
  },
  "Q13936": {
    "gene": "CACNA1C",
    "targetClass": "Ion channel",
    "targetName": "Voltage-dependent L-type calcium channel subunit alpha-1C",
    "bioactivityCount": 10
  },
  "Q14524": {
    "gene": "SCN5A",
    "targetClass": "Ion channel",
    "targetName": "Sodium channel protein type 5 subunit alpha",
    "bioactivityCount": 18
  },
  "Q15125": {
    "gene": "EBP",
    "targetClass": "Enzyme",
    "targetName": "3-beta-hydroxysteroid-Delta(8),Delta(7)-isomerase",
    "bioactivityCount": 11
  },
  "Q15303": {
    "gene": "ERBB4",
    "targetClass": "Kinase",
    "targetName": "Receptor tyrosine-protein kinase erbB-4",
    "bioactivityCount": 15
  },
  "Q15418": {
    "gene": "RPS6KA1",
    "targetClass": "Kinase",
    "targetName": "Ribosomal protein S6 kinase alpha-1",
    "bioactivityCount": 10
  },
  "Q15746": {
    "gene": "MYLK",
    "targetClass": "Kinase",
    "targetName": "Myosin light chain kinase, smooth muscle",
    "bioactivityCount": 10
  },
  "Q15858": {
    "gene": "SCN9A",
    "targetClass": "Ion channel",
    "targetName": "Sodium channel protein type 9 subunit alpha",
    "bioactivityCount": 10
  },
  "Q16288": {
    "gene": "NTRK3",
    "targetClass": "Kinase",
    "targetName": "NT-3 growth factor receptor",
    "bioactivityCount": 15
  },
  "Q16539": {
    "gene": "MAPK14",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase 14",
    "bioactivityCount": 21
  },
  "Q16620": {
    "gene": "NTRK2",
    "targetClass": "Kinase",
    "targetName": "BDNF/NT-3 growth factors receptor",
    "bioactivityCount": 16
  },
  "Q16790": {
    "gene": "CA9",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 9",
    "bioactivityCount": 45
  },
  "Q16816": {
    "gene": "PHKG1",
    "targetClass": "Kinase",
    "targetName": "Phosphorylase b kinase gamma catalytic chain, skeletal muscle/heart isoform",
    "bioactivityCount": 10
  },
  "Q16832": {
    "gene": "DDR2",
    "targetClass": "Kinase",
    "targetName": "Discoidin domain-containing receptor 2",
    "bioactivityCount": 13
  },
  "Q16850": {
    "gene": "CYP51A1",
    "targetClass": "Enzyme",
    "targetName": "Lanosterol 14-alpha demethylase",
    "bioactivityCount": 11
  },
  "Q2M2I8": {
    "gene": "AAK1",
    "targetClass": "Kinase",
    "targetName": "AP2-associated protein kinase 1",
    "bioactivityCount": 12
  },
  "Q56UN5": {
    "gene": "MAP3K19",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase 19",
    "bioactivityCount": 17
  },
  "Q5S007": {
    "gene": "LRRK2",
    "targetClass": "Kinase",
    "targetName": "Leucine-rich repeat serine/threonine-protein kinase 2",
    "bioactivityCount": 10
  },
  "Q6PHR2": {
    "gene": "ULK3",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase ULK3",
    "bioactivityCount": 12
  },
  "Q6XQN6": {
    "gene": "NAPRT",
    "targetClass": "Enzyme",
    "targetName": "Nicotinate phosphoribosyltransferase",
    "bioactivityCount": 12
  },
  "Q8IVH8": {
    "gene": "MAP4K3",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase kinase 3",
    "bioactivityCount": 12
  },
  "Q8N1Q1": {
    "gene": "CA13",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 13",
    "bioactivityCount": 21
  },
  "Q8N4C8": {
    "gene": "MINK1",
    "targetClass": "Kinase",
    "targetName": "Misshapen-like kinase 1",
    "bioactivityCount": 13
  },
  "Q8NE63": {
    "gene": "HIPK4",
    "targetClass": "Kinase",
    "targetName": "Homeodomain-interacting protein kinase 4",
    "bioactivityCount": 13
  },
  "Q92769": {
    "gene": "HDAC2",
    "targetClass": "Enzyme",
    "targetName": "Histone deacetylase 2",
    "bioactivityCount": 10
  },
  "Q92918": {
    "gene": "MAP4K1",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase kinase 1",
    "bioactivityCount": 14
  },
  "Q96GD4": {
    "gene": "AURKB",
    "targetClass": "Kinase",
    "targetName": "Aurora kinase B",
    "bioactivityCount": 12
  },
  "Q96SB4": {
    "gene": "SRPK1",
    "targetClass": "Kinase",
    "targetName": "SRSF protein kinase 1",
    "bioactivityCount": 10
  },
  "Q99759": {
    "gene": "MAP3K3",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase 3",
    "bioactivityCount": 13
  },
  "Q9H093": {
    "gene": "NUAK2",
    "targetClass": "Kinase",
    "targetName": "NUAK family SNF1-like kinase 2",
    "bioactivityCount": 13
  },
  "Q9H0K1": {
    "gene": "SIK2",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase SIK2",
    "bioactivityCount": 12
  },
  "Q9H2G2": {
    "gene": "SLK",
    "targetClass": "Kinase",
    "targetName": "STE20-like serine/threonine-protein kinase",
    "bioactivityCount": 18
  },
  "Q9H2K8": {
    "gene": "TAOK3",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase TAO3",
    "bioactivityCount": 11
  },
  "Q9HBH9": {
    "gene": "MKNK2",
    "targetClass": "Kinase",
    "targetName": "MAP kinase-interacting serine/threonine-protein kinase 2",
    "bioactivityCount": 12
  },
  "Q9NSY1": {
    "gene": "BMP2K",
    "targetClass": "Kinase",
    "targetName": "BMP-2-inducible protein kinase",
    "bioactivityCount": 13
  },
  "Q9NYL2": {
    "gene": "ZAK",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase MLT",
    "bioactivityCount": 10
  },
  "Q9UBN7": {
    "gene": "HDAC6",
    "targetClass": "Enzyme",
    "targetName": "Histone deacetylase 6",
    "bioactivityCount": 11
  },
  "Q9UEE5": {
    "gene": "STK17A",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase 17A",
    "bioactivityCount": 10
  },
  "Q9UF33": {
    "gene": "EPHA6",
    "targetClass": "Kinase",
    "targetName": "Ephrin type-A receptor 6",
    "bioactivityCount": 13
  },
  "Q9UHD2": {
    "gene": "TBK1",
    "targetClass": "Kinase",
    "targetName": "Serine/threonine-protein kinase TBK1",
    "bioactivityCount": 10
  },
  "Q9UK32": {
    "gene": "RPS6KA6",
    "targetClass": "Kinase",
    "targetName": "Ribosomal protein S6 kinase alpha-6",
    "bioactivityCount": 11
  },
  "Q9UKE5": {
    "gene": "TNIK",
    "targetClass": "Kinase",
    "targetName": "TRAF2 and NCK-interacting protein kinase",
    "bioactivityCount": 14
  },
  "Q9ULX7": {
    "gene": "CA14",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 14",
    "bioactivityCount": 39
  },
  "Q9UM73": {
    "gene": "ALK",
    "targetClass": "Kinase",
    "targetName": "ALK tyrosine kinase receptor",
    "bioactivityCount": 21
  },
  "Q9UPE1": {
    "gene": "SRPK3",
    "targetClass": "Kinase",
    "targetName": "SRSF protein kinase 3",
    "bioactivityCount": 10
  },
  "Q9UQB9": {
    "gene": "AURKC",
    "targetClass": "Kinase",
    "targetName": "Aurora kinase C",
    "bioactivityCount": 12
  },
  "Q9Y2D0": {
    "gene": "CA5B",
    "targetClass": "Enzyme",
    "targetName": "Carbonic anhydrase 5B, mitochondrial",
    "bioactivityCount": 33
  },
  "Q9Y2U5": {
    "gene": "MAP3K2",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase 2",
    "bioactivityCount": 13
  },
  "Q9Y3Q4": {
    "gene": "HCN4",
    "targetClass": "Ion channel",
    "targetName": "Potassium/sodium hyperpolarization-activated cyclic nucleotide-gated channel 4",
    "bioactivityCount": 12
  },
  "Q9Y4K4": {
    "gene": "MAP4K5",
    "targetClass": "Kinase",
    "targetName": "Mitogen-activated protein kinase kinase kinase kinase 5",
    "bioactivityCount": 13
  }
} as const;
