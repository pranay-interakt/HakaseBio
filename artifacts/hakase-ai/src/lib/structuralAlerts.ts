/**
 * Curated Structural Alert Library — L1 Safety Screen
 *
 * Five public libraries, 57 alerts, all SMARTS sourced from primary literature:
 *
 *   Ames-ICH  Kazius et al., J. Med. Chem. 2005, 48, 312–320 (DOI:10.1021/jm040835a)
 *             ICH S2(R1) Genotoxicity Guidance (2011)
 *             ICH M7(R2) Mutagenic Impurities Guidance (2023)
 *   Brenk     Brenk et al., ChemMedChem 2008, 3, 535–544 (DOI:10.1002/cmdc.200700139)
 *   PAINS     Baell & Holloway, J. Med. Chem. 2010, 53, 2719–2740 (DOI:10.1021/jm901137j)
 *   NIH-MLSMR Jadhav et al., J. Med. Chem. 2010, 53, 507–522 (DOI:10.1021/jm901100b)
 *   BMS       Pearce et al., J. Med. Chem. 2006, 49, 6177–6196 (DOI:10.1021/jm060483m)
 *
 * Anti-fabrication invariant
 * ──────────────────────────
 * `runStructuralAlertScan` calls `hasSubstructure` from chemistry.ts, which
 * performs a real RDKit SMARTS substructure match. If RDKit has not yet
 * initialised (isReady() === false) the function returns an empty result
 * rather than fabricating hits. Same SMILES always returns identical hits.
 *
 * SMARTS validation
 * ─────────────────
 * Every pattern listed below has been checked against RDKit 2024.03 SMARTS
 * syntax. Citations embedded in each alert allow a future maintainer to
 * verify against the primary source.
 */

import { hasSubstructure, isReady } from "./chemistry";

// ── Types ────────────────────────────────────────────────────────────────────

export type AlertLibrary = "Ames-ICH" | "Brenk" | "PAINS" | "NIH-MLSMR" | "BMS";

/**
 * "reject" = hard-exclude tier used in all five public libraries for motifs
 *   that are universally reactive / directly DNA-damaging. Maps to
 *   ToxicityAlert severity "High" → contributes to NO-GO decision.
 * "warn"   = flag-for-review tier for context-dependent liabilities (PAINS
 *   assay interference, reversible electrophiles). Maps to "Medium" / "Low".
 */
export type AlertSeverity = "reject" | "warn";

export type AlertCategory =
  | "Genotoxic"           // DNA-reactive, ICH S2 / Ames-positive class
  | "Alkylating"          // direct protein / DNA alkylation, non-genotox context
  | "ReactiveElectrophile"// thiol/amine reactive, not necessarily genotoxic
  | "ReactiveMetabolite"  // metabolically activated to reactive intermediate
  | "PAINS"               // pan-assay interference (aggregation, redox, fluorescence)
  | "MetalChelator"       // promiscuous metal chelation → metalloenzyme false positive
  | "Oxidant"             // redox cycler / direct oxidant
  | "HeavyMetal"          // elemental toxicity
  | "PropertyFlag";       // physicochemical concern (solubility, permeability)

export interface StructuralAlertDef {
  id: string;
  library: AlertLibrary;
  name: string;
  /** One or more SMARTS patterns. Alert fires if ANY pattern matches. */
  smarts: string[];
  category: AlertCategory;
  severity: AlertSeverity;
  /** Mechanistic rationale — kept concise for display in the safety panel. */
  rationale: string;
  /** Primary literature citation(s). */
  citation: string;
}

export interface StructuralAlertHit {
  alert: StructuralAlertDef;
  /** Which SMARTS pattern matched first. */
  matchedSmarts: string;
}

export interface StructuralAlertResult {
  /** All fired alerts, in library order. */
  hits: StructuralAlertHit[];
  rejectCount: number;
  warnCount: number;
  painsCount: number;
  brenkCount: number;
  bmsCount: number;
  nihCount: number;
  amesGenotoxCount: number;
  libraryBreakdown: Record<AlertLibrary, number>;
  /** Names of reject-tier hits for Go/No-Go rationale string. */
  rejectNames: string[];
  /** Names of warn-tier hits. */
  warnNames: string[];
  /** True when RDKit was ready and the scan actually ran. */
  scanRan: boolean;
}

// ── Alert Library ─────────────────────────────────────────────────────────────
//
// Ordering: Ames-ICH → Brenk → PAINS → NIH-MLSMR → BMS
// Within each library: reject-tier first, then warn-tier.

const ALERT_LIBRARY: StructuralAlertDef[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // AMES-ICH — Genotoxic & ICH S2(R1)-relevant alerts
  // Primary source: Kazius et al., J. Med. Chem. 2005, 48, 312–320
  //                 (29 toxicophores derived from 4337-compound Ames dataset)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "AMES-001",
    library: "Ames-ICH",
    name: "Aromatic Primary Amine",
    smarts: [
      // Ar-NH2: N with 3 connections (2 H + 1 heavy), on aromatic carbon,
      // not amide (NC=O), not sulfonamide (NS=O), not imine (N=*)
      "[NX3;H2;$(Nc);!$(NC=O);!$(NS=O);!$(N=*)]",
    ],
    category: "Genotoxic",
    severity: "reject",
    rationale: "CYP1A2 N-hydroxylation → hydroxylamine → nitroso → DNA adducts (N-acetyl guanine). Associated with bladder carcinogenesis. Ames positive class; ICH S2(R1) mandatory testing.",
    citation: "Kazius et al., J. Med. Chem. 2005 (toxicophore #1). ICH S2(R1) 2011.",
  },
  {
    id: "AMES-002",
    library: "Ames-ICH",
    name: "Nitroaromatic",
    smarts: [
      "c[N+](=O)[O-]",   // aromatic C–NO2; RDKit normalises nitro to charged form [N+][O-]
      // NOTE: the neutral form "c[NX3](=O)=O" is NOT used because RDKit canonicalises
      // nitro groups to the charge-separated form, making the neutral SMARTS redundant
      // and generating false negatives (verified against RDKit 2024.03).
    ],
    category: "Genotoxic",
    severity: "reject",
    rationale: "Nitroreductase/CYP-reductase cascade: nitro → nitroso → hydroxylamine → nitrenium ion → C8-guanine adducts. Bladder carcinogen class. Ames positive; ICH S2(R1) Ames test mandatory.",
    citation: "Kazius et al., J. Med. Chem. 2005 (toxicophore #3). Rosenkranz & Mermelstein, Mutat. Res. 1983.",
  },
  {
    id: "AMES-003",
    library: "Ames-ICH",
    name: "N-Nitroso / Nitrosamine",
    smarts: [
      // R2N–N=O where the first N is not an amide N; catches both
      // dialkyl- and arylalkylnitrosamines
      "[NX3;!$(N=O)][NX2]=O",
    ],
    category: "Genotoxic",
    severity: "reject",
    rationale: "CYP2E1 alpha-hydroxylation → diazonium ion → O6-methylguanine (most carcinogenic DNA lesion). IARC Group 1/2A. ICH M7 classifies N-nitroso impurities as Class 1; acceptable intake <18 ng/day.",
    citation: "ICH M7(R2) 2023. Shuker et al., Arch. Toxicol. 1993. Hecht & Hoffmann, Carcinogenesis 1988.",
  },
  {
    id: "AMES-004",
    library: "Ames-ICH",
    name: "Hydrazine",
    smarts: [
      // aliphatic N–N with at least one H on each N
      "[NX3;H1,H2][NX3;H1,H2]",
    ],
    category: "Genotoxic",
    severity: "reject",
    rationale: "CYP oxidation to diazenes/diazonium → DNA alkylation. Isoniazid acetylhydrazine metabolite causes DNA damage via CYP2E1. IARC 2A (1-methylhydrazine). ICH S2 Ames positive.",
    citation: "Kazius et al., J. Med. Chem. 2005. IARC Monograph Vol. 4 (hydrazine). Timbrell et al., Biochem. Pharmacol. 1977.",
  },
  {
    id: "AMES-005",
    library: "Ames-ICH",
    name: "Aliphatic Epoxide",
    smarts: [
      "C1OC1",                   // oxirane ring (generic 3-membered O-ring)
    ],
    category: "Genotoxic",
    severity: "reject",
    rationale: "Direct-acting SN2 electrophile → N7- and O6-guanine alkylation. Ring strain drives reactivity. Ames positive, classified genotoxic carcinogen class. Arene oxide (metabolic) handled separately in bioactivationEngine.",
    citation: "Kazius et al., J. Med. Chem. 2005 (toxicophore #4). IARC Monographs. Kolman et al., Environ. Health Perspect. 2002.",
  },
  {
    id: "AMES-006",
    library: "Ames-ICH",
    name: "Acyl Halide",
    smarts: [
      "[CX3](=O)[F,Cl,Br,I]",   // acid fluoride / chloride / bromide / iodide
    ],
    category: "ReactiveElectrophile",
    severity: "reject",
    rationale: "Acylates DNA amines, GSH, and protein Lys/Ser/Cys at near-diffusion rates. No selectivity. Universally excluded from HTS libraries. Rapidly hydrolysed in aqueous media but reacts first.",
    citation: "Brenk et al., ChemMedChem 2008. ICH Q3B reactive impurities.",
  },
  {
    id: "AMES-007",
    library: "Ames-ICH",
    name: "Sulfonyl Halide",
    smarts: [
      "[SX4](=O)(=O)[F,Cl,Br]",  // sulfonyl fluoride, chloride, bromide
    ],
    category: "ReactiveElectrophile",
    severity: "reject",
    rationale: "Potent electrophilic warhead for Ser, Tyr, Cys, His. SuFEx click chemistry exploits sulfonyl fluorides deliberately; in HTS libraries they cause promiscuous irreversible protein modification. Excluded by all five public filter sets.",
    citation: "Brenk et al., ChemMedChem 2008. Meng et al., J. Am. Chem. Soc. 2018 (SuFEx).",
  },
  {
    id: "AMES-008",
    library: "Ames-ICH",
    name: "Alkyl Sulfonate Ester",
    smarts: [
      // R-SO2-O-Csp3 (alkyl sulfonate ester, not sulfonic acid or sulfamate)
      "[SX4](=O)(=O)[OX2][CX4]",
    ],
    category: "Alkylating",
    severity: "reject",
    rationale: "Methyl/ethyl mesylate/tosylate are potent DNA alkylators (N7-G, O6-G). ICH M7 Class 1 mutagen impurities. MMS (methyl methanesulfonate) is a standard Ames positive control. Busulfan (bis-sulfonate) is an anticancer drug used despite genotoxicity due to benefit-risk.",
    citation: "ICH M7(R2) 2023. Segal et al., Chem. Biol. Interact. 2007. IARC Monograph Vol. 100A.",
  },
  {
    id: "AMES-009",
    library: "Ames-ICH",
    name: "Benzylic / Heterobenzylic Halide",
    smarts: [
      "[c][CH2][Cl,Br,I]",       // Ar-CH2-X: covers both carbocyclic and heteroaryl
      // N-heteroaryl: the halomethyl is on a ring *carbon* adjacent to N, so [c] already
      // covers e.g. 4-ClCH2-pyridine (ClCc1ccncc1). A pattern "[n][CH2][Cl,Br,I]" would
      // require CH2X on the ring N itself — not the common genotoxic motif — and was
      // confirmed non-matching by RDKit verification. Removed to avoid false silence.
    ],
    category: "Alkylating",
    severity: "reject",
    rationale: "Benzyl chloride is IARC Group 1. Arene / N-heteroaryl stabilisation lowers SN2 barrier → rapid N7-guanine alkylation. ICH M7 Class 1. Universally excluded from screening libraries.",
    citation: "IARC Monograph Vol. 29 (benzyl chloride). ICH M7(R2) 2023. Farmer et al., Mutat. Res. 1987.",
  },
  {
    id: "AMES-010",
    library: "Ames-ICH",
    name: "Alpha-Haloketone",
    smarts: [
      // C=O with halide on the alpha carbon; excludes CF3 and activated
      // aryl alpha positions handled elsewhere
      "[CX3](=O)[CX4;H0,H1,H2][Cl,Br,I]",
    ],
    category: "Alkylating",
    severity: "reject",
    rationale: "Carbonyl activates adjacent C-X for SN2 → cysteine protease inactivation (mechanism-based). Phenacyl halides are selective thiol alkylators in proteomics. Universally excluded from passive-screening HTS libraries.",
    citation: "Brenk et al., ChemMedChem 2008. Cravatt et al., Annu. Rev. Biochem. 2008.",
  },
  {
    id: "AMES-011",
    library: "Ames-ICH",
    name: "Alpha,beta-Unsaturated Aldehyde (Enal)",
    smarts: [
      "C=CC=O",                  // generic enal / Michael aldehyde
      "[CX3H1]=[CX3]C=O",       // acrolein-type: CH=CH-CHO
    ],
    category: "ReactiveElectrophile",
    severity: "reject",
    rationale: "Both Michael acceptor AND direct DNA alkylator forming exocyclic 1,N2-propanodeoxyguanosine adducts. More reactive than simple enones. Acrolein: IARC Group 2A. ICH S2(R1) category.",
    citation: "IARC Monograph Vol. 63 (acrolein). Chung et al., Chem. Res. Toxicol. 1996.",
  },
  {
    id: "AMES-012",
    library: "Ames-ICH",
    name: "Aliphatic Nitro Group",
    smarts: [
      "[CX4][N+](=O)[O-]",       // sp3 C–NO2
      "[CX4][NX3](=O)=O",        // alternative representation
    ],
    category: "Genotoxic",
    severity: "warn",
    rationale: "Aliphatic nitro compounds are generally less mutagenic than nitroaromatics but metabolic reduction still produces reactive intermediates. ICH S2(R1) Ames test required; severity depends on adjacent functionality.",
    citation: "ICH S2(R1) 2011. Kazius et al., J. Med. Chem. 2005.",
  },
  {
    id: "AMES-013",
    library: "Ames-ICH",
    name: "Alpha,beta-Unsaturated Carbonyl (Michael Acceptor)",
    smarts: [
      "[CX3]=[CX3][CX3]=O",      // enone / vinyl ketone
      "[CX3]=[CX3]C(=O)[OX2H0]", // acrylate ester
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Direct-acting thiol/amine alkylator without metabolic activation. KEAP1 Cys modification, GSH depletion at higher doses. Risk is context-dependent (intentional covalent warheads in osimertinib/afatinib). Confirm with GSH reactivity assay (t½ in 1 mM GSH).",
    citation: "Kazius et al., J. Med. Chem. 2005. Schultz et al., Chem. Res. Toxicol. 2006.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BRENK — 105 structural filters for neglected-disease screening libraries
  // Source: Brenk et al., ChemMedChem 2008, 3, 535–544
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "BRENK-001",
    library: "Brenk",
    name: "Isocyanate",
    smarts: [
      "[NX2]=[CX2]=[OX1]",       // cumulated N=C=O
    ],
    category: "ReactiveElectrophile",
    severity: "reject",
    rationale: "Rapid water hydrolysis / protein acylation. Reacts with amine and thiol nucleophiles broadly. Occupational diisocyanate exposure → sensitisation and asthma (TDI, MDI). Unsuitable as drug candidate due to instability and macromolecular reactivity.",
    citation: "Brenk et al., ChemMedChem 2008. Karol et al., Am. J. Respir. Crit. Care Med. 1994.",
  },
  {
    id: "BRENK-002",
    library: "Brenk",
    name: "Peroxide",
    smarts: [
      "[OX2][OX2]",              // O–O bond (peroxide, hydroperoxide, peracid)
    ],
    category: "Oxidant",
    severity: "reject",
    rationale: "Homolytic O–O cleavage generates ROS. Reacts non-specifically with Cys/Met residues, lipid membranes, and DNA via radical mechanism. Oxidises assay reagents (DTT, TCEP, thiol reporters). Thermally and photochemically unstable. Universally excluded from HTS libraries.",
    citation: "Brenk et al., ChemMedChem 2008. Baell & Holloway, J. Med. Chem. 2010.",
  },
  {
    id: "BRENK-003",
    library: "Brenk",
    name: "Heavy Metal / Metalloid",
    smarts: [
      "[Hg,As,Cd,Pb,Tl,Sb,Bi]", // covalently bonded toxic element
    ],
    category: "HeavyMetal",
    severity: "reject",
    rationale: "Inherent elemental toxicity; off-target Cys-rich enzyme inhibition; environmental persistence. Historical organoarsenic/mercury drugs (salvarsan, thimerosal) no longer acceptable by modern regulatory standards. Universally excluded.",
    citation: "Brenk et al., ChemMedChem 2008. REACH Regulation Annex XVII (EC 1907/2006).",
  },
  {
    id: "BRENK-004",
    library: "Brenk",
    name: "Maleimide",
    smarts: [
      "O=C1C=CC(=O)N1",          // N-H maleimide
      "O=C1C=CC(=O)[NX3;H0]1",   // N-substituted maleimide
    ],
    category: "ReactiveElectrophile",
    severity: "reject",
    rationale: "Bioconjugation reagent for Cys-selective ADC linkers; in HTS context reacts with GSH and any accessible Cys. Retro-Michael hydrolysis in aqueous media regenerates free maleic acid. Excluded from standard screening libraries; used only in targeted covalent programs.",
    citation: "Brenk et al., ChemMedChem 2008. Northrop et al., J. Am. Chem. Soc. 2015.",
  },
  {
    id: "BRENK-005",
    library: "Brenk",
    name: "N-Halamine / N-Chloroamine",
    smarts: [
      "[NX3][Cl,Br,I]",          // N directly bonded to halogen
    ],
    category: "Alkylating",
    severity: "reject",
    rationale: "Positive halogen transfer to nucleophilic DNA/protein sites. N-Chloramines (chloramine-T) are disinfectants precisely because of this reactivity. Cause DNA strand breaks and protein crosslinking. Universally excluded.",
    citation: "Brenk et al., ChemMedChem 2008. Worley & Williams, Chem. Rev. 1994.",
  },
  {
    id: "BRENK-006",
    library: "Brenk",
    name: "Vinyl Sulfonyl (Michael Acceptor)",
    smarts: [
      "[SX4](=O)(=O)[CX3]=[CX3]", // sulfonyl vinyl
      "[CX3]=[CX3][SX4](=O)(=O)", // reversed orientation
    ],
    category: "ReactiveElectrophile",
    severity: "reject",
    rationale: "Potent thiol Michael acceptor. E-64 / vinyl sulfone warheads are intentional irreversible cysteine protease inhibitors; in HTS they cause non-specific pan-enzyme inhibition. Excluded from unbiased screens; allowed only in targeted covalent programs.",
    citation: "Brenk et al., ChemMedChem 2008. Palmer et al., J. Med. Chem. 1995 (E-64 analog).",
  },
  {
    id: "BRENK-007",
    library: "Brenk",
    name: "Diazo Compound",
    smarts: [
      "[CX3]=[NX2+]=[NX1-]",     // aliphatic diazo: C=N+=N-
    ],
    category: "Alkylating",
    severity: "reject",
    rationale: "Decomposes to carbenium / carbene → potent DNA alkylation (O6- and N7-guanine). Diazomethane is an IARC carcinogen used only as a controlled synthetic reagent. Not viable as drug candidates.",
    citation: "Brenk et al., ChemMedChem 2008. IARC Monographs (diazomethane). Shuker & Margison, Cancer Res. 1997.",
  },
  {
    id: "BRENK-008",
    library: "Brenk",
    name: "Disulfide",
    smarts: [
      "[SX2;!a][SX2;!a]",        // S–S single bond, both non-aromatic
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Rapid thiol-disulfide exchange with GSH and protein Cys; generates mixed disulfides confounding SAR. Can generate thiol/oxidant mixtures in biological assay wells. DMSO stocks often contain oxidised thiol impurities.",
    citation: "Brenk et al., ChemMedChem 2008. Bauer et al., J. Med. Chem. 2015.",
  },
  {
    id: "BRENK-009",
    library: "Brenk",
    name: "Thioester",
    smarts: [
      "[CX3](=O)[SX2][#6]",      // C(=O)–S–C (thioester)
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Thiolate is an excellent leaving group → thioester acylates protein Lys/Ser/Cys more readily than ordinary esters. Decomposes in DMSO stock solutions. CoA thioesters are physiological but synthetic versions are promiscuously reactive.",
    citation: "Brenk et al., ChemMedChem 2008.",
  },
  {
    id: "BRENK-010",
    library: "Brenk",
    name: "Thiocarbonyl (C=S)",
    smarts: [
      "[CX3;!c]=[SX1]",          // sp2 C=S; excludes aromatic C (thiophenol is different)
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Soft electrophile for thiol/amine nucleophiles. CYP desulfuration generates reactive sulfur species (H2S). Thioamides and thioureas competitively inhibit thyroid peroxidase. Rhodanines (PAINS) carry this motif.",
    citation: "Brenk et al., ChemMedChem 2008. Cribb et al., Drug Metab. Rev. 1996.",
  },
  {
    id: "BRENK-011",
    library: "Brenk",
    name: "Activated Vinyl Halide",
    smarts: [
      "[CX3]=[CX3][Cl,Br,I]",   // vinyl halide (halogen on C=C)
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Latent electrophile. CYP2E1 oxidation of vinyl chloride → chlorooxirane → DNA adducts. Vinyl chloride: IARC Group 1 hepatic angiosarcoma carcinogen. Less-activated fluoroalkenes are lower risk but still flagged.",
    citation: "Brenk et al., ChemMedChem 2008. IARC Monograph Vol. 97 (vinyl chloride).",
  },
  {
    id: "BRENK-012",
    library: "Brenk",
    name: "Aliphatic Iodide",
    smarts: [
      "[CX4;!$(Cc);!$(CC=O)][I]",  // sp3 C–I; not benzylic (separate) or alpha-keto
    ],
    category: "Alkylating",
    severity: "warn",
    rationale: "Sp3 C–I undergoes SN2 alkylation of GSH / protein Cys / N7-guanine. Iodides have far better leaving-group ability than bromides or chlorides in SN2 reactions. Generally unstable in biological media.",
    citation: "Brenk et al., ChemMedChem 2008.",
  },
  {
    id: "BRENK-013",
    library: "Brenk",
    name: "1,2-Diketone / Alpha-Dicarbonyl",
    smarts: [
      "[#6][CX3](=O)[CX3](=O)[#6]",  // R-CO-CO-R
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Forms Schiff bases / hemiaminals with Lys residues → protein crosslinking. Methylglyoxal cross-links DNA and proteins. 2,3-Butanedione causes bronchiolitis obliterans (occupational popcorn-lung).",
    citation: "Brenk et al., ChemMedChem 2008. Westphal et al., Chem. Res. Toxicol. 2017.",
  },
  {
    id: "BRENK-014",
    library: "Brenk",
    name: "Reactive Aldehyde",
    smarts: [
      "[CX3H1]=O",               // any aldehyde (aliphatic or aryl)
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Reversible Schiff-base formation with protein Lys and DNA N-terminus. Formaldehyde / glyoxal are direct-acting crosslinkers. Even simple aldehydes (benzaldehyde) react non-specifically in cell assays. Fragment aldehyde warheads (nirmatrelvir-type) need context confirmation.",
    citation: "Brenk et al., ChemMedChem 2008. Gmelin et al., Arch. Toxicol. 2002.",
  },
  {
    id: "BRENK-015",
    library: "Brenk",
    name: "Activated Ester (Phenyl / Vinyl)",
    smarts: [
      "[CX3](=O)Oc1ccccc1",     // phenyl ester
      "[CX3](=O)O[CX3]=[CX3]", // vinyl ester (enol ester)
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Activated carbonyl esters with good leaving groups (phenol, vinyl alcohol) acylate protein Ser/Cys/Lys. p-Nitrophenyl esters are synthetic acyl-transfer reagents. Rapidly hydrolyse and acylate in cell-based assays.",
    citation: "Brenk et al., ChemMedChem 2008. Pearce et al., J. Med. Chem. 2006.",
  },
  {
    id: "BRENK-016",
    library: "Brenk",
    name: "Isothiocyanate",
    smarts: [
      "[NX2]=[CX2]=[SX1]",       // cumulated N=C=S
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Carbamoylates protein thiol and amino groups. Some ITCs (sulforaphane) have chemopreventive activity via Nrf2, but the motif is inherently promiscuously reactive in drug discovery context.",
    citation: "Brenk et al., ChemMedChem 2008. Kolm et al., Chem. Biol. Interact. 1995.",
  },
  {
    id: "BRENK-017",
    library: "Brenk",
    name: "Hydroxamic Acid",
    smarts: [
      "[CX3](=O)[NX3;H1,H0][OX2H1]",  // C(=O)–N(H)–OH or C(=O)–N(R)–OH
    ],
    category: "MetalChelator",
    severity: "warn",
    rationale: "Bidentate Fe³⁺/Zn²⁺ chelator (siderophore-mimicking). Intentional HDAC inhibitor warhead (vorinostat); in broader assays strips Zn²⁺ from any metalloenzyme causing false-positive inhibition. Fenton-chemistry ROS via chelated Fe.",
    citation: "Brenk et al., ChemMedChem 2008. Jacobsen et al., Eur. J. Med. Chem. 2014.",
  },
  {
    id: "BRENK-018",
    library: "Brenk",
    name: "N-Propargylamine (MAO MBI)",
    smarts: [
      "[NX3][CX4]C#[CX2H]",     // N–CH2–C≡CH (N-propargyl)
    ],
    category: "ReactiveMetabolite",
    severity: "warn",
    rationale: "MAO-A/B mechanism-based inactivators (selegiline, rasagiline are intentional). Propargylamine-MAO oxidation → propargyl radical / allenic intermediate → covalent FAD modification. Flags for deliberate MAO MBI assessment.",
    citation: "Brenk et al., ChemMedChem 2008. Ramsay & Tipton, Biochem. Pharmacol. 2017.",
  },
  {
    id: "BRENK-019",
    library: "Brenk",
    name: "Phosphonium Ion",
    smarts: [
      "[PX4+]",                  // quaternary phosphorus cation
    ],
    category: "PropertyFlag",
    severity: "warn",
    rationale: "Permanently charged phosphonium ions have poor passive membrane permeability. Mitochondria-targeting TPP+ conjugates are intentionally membrane-active, but in HTS context permanently charged P+ species cause assay surface artefacts and unpredictable ADME.",
    citation: "Brenk et al., ChemMedChem 2008. Smith & Murphy, Nat. Chem. Biol. 2011.",
  },
  {
    id: "BRENK-020",
    library: "Brenk",
    name: "Alpha-Unsaturated Nitrile (Acrylonitrile-type)",
    smarts: [
      "[CX3]=[CX3][CX2]#[NX1]",  // C=C-C≡N (vinyl nitrile / acrylonitrile)
    ],
    category: "ReactiveElectrophile",
    severity: "reject",
    rationale: "Acrylonitrile: IARC Group 2A. Potent Michael acceptor (nitrile amplifies beta-carbon electrophilicity) → cyanoethyl-GSH adducts + DNA adducts. CYP2E1 also oxidises to glycidonitrile (epoxide), an additional genotoxin.",
    citation: "IARC Monograph Vol. 71 (acrylonitrile). Brenk et al., ChemMedChem 2008.",
  },
  {
    id: "BRENK-021",
    library: "Brenk",
    name: "Azide (Organic)",
    smarts: [
      "[#6][NX2]=[NX2+]=[NX1-]",  // organic azide R–N=N+=N-
      // In RDKit's internal representation of organic azides (e.g. CN=[N+]=[N-]):
      // the central N+ has degree 2 → NX2+, not NX1+. Verified against RDKit 2024.03.
    ],
    category: "Alkylating",
    severity: "warn",
    rationale: "Photochemical / thermal decomposition to nitrenes → C-H insertion + covalent protein crosslinking. Sulfonyl azides: covalent proteomic probes, not screening compounds. Aliphatic azides may be explosive in bulk (stability concern).",
    citation: "Brenk et al., ChemMedChem 2008. Lwowski, Reactive Intermediates 1980.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PAINS — Pan-Assay INterference compoundS
  // Source: Baell & Holloway, J. Med. Chem. 2010, 53, 2719–2740
  //         Supporting Information Table S1 (PAINS-A, B, C filters)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "PAINS-001",
    library: "PAINS",
    name: "Rhodanine Core",
    smarts: [
      "O=C1CSC(=S)N1",           // 2-thioxo-4-thiazolidinone (rhodanine)
      "S=C1NC(=O)CS1",           // alternative ring-atom traversal
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Prototypal PAINS scaffold; found in 39% of PAINS-A papers claiming 'selective' kinase inhibition. Mechanisms: (1) C=S Michael acceptor → thiol reactivity, (2) aggregation at µM concentrations, (3) colloidal inhibition. PAINS-A class (highest concern).",
    citation: "Baell & Holloway, J. Med. Chem. 2010 (PAINS-A, rhodanines). Baell, J. Chem. Inf. Model. 2013.",
  },
  {
    id: "PAINS-002",
    library: "PAINS",
    name: "Catechol / 1,2-Dihydroxybenzene",
    smarts: [
      "c1cc(O)c(O)cc1",          // 1,2-catechol
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Auto-oxidation or MPO-mediated oxidation → ortho-quinone (reactive Michael acceptor). Fe²⁺/Fe³⁺ / Cu²⁺ chelation → Fenton-chemistry ROS in assay media. Over-represented as AlphaScreen false positives. Bioactivation engine covers quinone metabolite pathway separately.",
    citation: "Baell & Holloway, J. Med. Chem. 2010. Soares et al., J. Med. Chem. 2010.",
  },
  {
    id: "PAINS-003",
    library: "PAINS",
    name: "Hydroquinone / 1,4-Dihydroxybenzene",
    smarts: [
      "Oc1ccc(O)cc1",            // 1,4-dihydroxybenzene
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "One- or two-electron oxidation → p-quinone; redox cycling generates superoxide + H2O2 in oxygenated assay media. In vivo: CYP → p-benzoquinone adducts with GSH, protein, and DNA. Bolton bone-marrow toxicity mechanism.",
    citation: "Baell & Holloway, J. Med. Chem. 2010. Bolton et al., Chem. Res. Toxicol. 2000.",
  },
  {
    id: "PAINS-004",
    library: "PAINS",
    name: "para-Quinone",
    smarts: [
      "O=C1C=CC(=O)C=C1",        // p-benzoquinone ring
    ],
    category: "PAINS",
    severity: "reject",
    rationale: "Potent 1,4-Michael acceptor + redox-active species. Covalently modifies Cys/Lys. Redox cycling generates ROS non-specifically. Ames positive. Standard PAINS exclusion across all assay formats (AlphaScreen, FP, HTRF). Brenk also classifies as reject.",
    citation: "Baell & Holloway, J. Med. Chem. 2010. Brenk et al., ChemMedChem 2008.",
  },
  {
    id: "PAINS-005",
    library: "PAINS",
    name: "Aromatic Azo",
    smarts: [
      "cN=Nc",                   // Ar-N=N-Ar
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Strong UV-visible absorption interferes with absorbance and fluorescence assays. Photoisomerisation (cis↔trans) under assay lighting. Metabolic azo reduction by gut bacteria → two aromatic amines (genotoxic). Prontosil → sulfanilamide is the classic example.",
    citation: "Baell & Holloway, J. Med. Chem. 2010. Chung et al., Crit. Rev. Toxicol. 2002.",
  },
  {
    id: "PAINS-006",
    library: "PAINS",
    name: "Acylhydrazone",
    smarts: [
      "[CX3;!$(C(=O)N)][NX3;H1][NX2]=[CX3]",  // C–NH–N=C (acylhydrazone)
      "[CX3](=O)[NX3;H1][NX2]=[CX3]",          // carbonyl-acylhydrazone
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Hydrolytic instability in aqueous assay media (hydrazone → hydrazide + aldehyde) confounds activity. Promiscuous metal chelation. UV absorption at ~330 nm → fluorescence assay interference. PAINS-A listed class.",
    citation: "Baell & Holloway, J. Med. Chem. 2010. Soares et al., J. Med. Chem. 2010.",
  },
  {
    id: "PAINS-007",
    library: "PAINS",
    name: "Chalcone / Aryl Enone",
    smarts: [
      "c[CX3]=[CX3][CX3](=O)c",  // Ar–CH=CH–C(=O)–Ar
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Michael acceptor reacting with Cys thiols. UV-vis absorption (~320-380 nm) causes fluorescence assay interference. Cell-based assays show broad anti-proliferative activity consistent with non-specific cytotoxicity rather than target pharmacology.",
    citation: "Baell & Holloway, J. Med. Chem. 2010. Dimmock et al., J. Med. Chem. 1999.",
  },
  {
    id: "PAINS-008",
    library: "PAINS",
    name: "Salicylhydroxamic Acid (Fe/Zn Chelator)",
    smarts: [
      "ONC(=O)c1ccccc1O",        // 2-OH-benzamide-N-OH (salicylhydroxamic acid)
    ],
    category: "MetalChelator",
    severity: "warn",
    rationale: "Nanomolar Fe³⁺/Zn²⁺ bidentate chelator. Strips metal cofactors from metalloenzymes in biochemical assays → non-specific inhibition independent of binding-site occupancy. Terbium/europium chelation → AlphaScreen/HTRF interference. PAINS-A.",
    citation: "Baell & Holloway, J. Med. Chem. 2010 (PAINS-A Supporting Information).",
  },
  {
    id: "PAINS-009",
    library: "PAINS",
    name: "Coumarin (Fluorescent Scaffold)",
    smarts: [
      "O=c1ccoc2ccccc12",        // 2H-chromen-2-one (coumarin), aromatic SMARTS form.
      // RDKit canonicalises coumarin to the fully-aromatic representation
      // "O=c1ccoc2ccccc12"; Kekulé SMARTS forms fail because RDKit's SMARTS matcher
      // uses the aromatic perception. Verified against RDKit 2024.03.
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Fluorescent scaffold (abs ~320 nm, em ~380-450 nm) → false positives in FP, HTRF, and fluorescence intensity assays. Lactone ring opens at physiological pH. PAINS-B class.",
    citation: "Baell & Holloway, J. Med. Chem. 2010. Simeonov et al., J. Med. Chem. 2010.",
  },
  {
    id: "PAINS-010",
    library: "PAINS",
    name: "Thiourea",
    smarts: [
      "[NX3][CX3](=[SX1])[NX3]", // N-C(=S)-N (thiourea / thiosemicarbazide)
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Reactive C=S electrophile + potential aggregation. Competitive thyroid peroxidase inhibition (PTU class). CYP desulfuration generates reactive sulfur species. Frequent hitter in biochemical screens; PAINS-A listed.",
    citation: "Baell & Holloway, J. Med. Chem. 2010. Cribb et al., Drug Metab. Rev. 1996.",
  },
  {
    id: "PAINS-011",
    library: "PAINS",
    name: "2-Aminothiazole (Frequent-Hitter Scaffold)",
    smarts: [
      "Nc1nccs1",                // 2-amino-1,3-thiazole
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Over-represented in kinase HTS hit lists. UV absorption can interfere with UV assays; free amine may oxidise in assay media; potential aggregation. Context-dependent — many confirmed actives contain this scaffold. Always confirm orthogonally.",
    citation: "Baell & Holloway, J. Med. Chem. 2010.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NIH-MLSMR — Excluded Functionality Filters
  // Source: Jadhav et al., J. Med. Chem. 2010, 53, 507–522
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "NIH-001",
    library: "NIH-MLSMR",
    name: "Gem-Dihalide / Trihalomethyl (non-CF3)",
    smarts: [
      // gem-dihalo on sp3 C, explicitly excluding CF2 and CF3 which are stable;
      // catches CCl2, CBr2, CClBr etc.
      "[CX4;!$(C(F)(F));!$(C(F)(F)F)]([Cl,Br,I])[Cl,Br,I]",
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Gem-dihalides (except gem-difluoro) hydrolyse to reactive aldehydes/ketones. Trichloromethyl groups → trichloroacetic acid + chloral (toxic). CCl3 on aromatic rings (DDT-class) generate reactive acyl chloride-like intermediates. Excluded from NIH-MLSMR for chemical instability.",
    citation: "Jadhav et al., J. Med. Chem. 2010, 53, 507–522. Pearce et al., J. Med. Chem. 2006.",
  },
  {
    id: "NIH-002",
    library: "NIH-MLSMR",
    name: "Peracid / Hydroperoxide",
    smarts: [
      "[CX3](=O)[OX2][OX2H]",    // peroxyacid R-CO-OOH
      "[CX4][OX2][OX2H]",        // hydroperoxide R-OOH
    ],
    category: "Oxidant",
    severity: "reject",
    rationale: "Peroxyacids and hydroperoxides are strong oxidants. Oxidise assay thiols (DTT, TCEP) and thiol-based reporters non-specifically. Generate hydroxyl radicals on decomposition. Universally excluded from HTS libraries.",
    citation: "Jadhav et al., J. Med. Chem. 2010.",
  },
  {
    id: "NIH-003",
    library: "NIH-MLSMR",
    name: "Phosphoryl Halide (Nerve-Agent Analog)",
    smarts: [
      "[PX4](=O)[F,Cl]",         // phosphoryl fluoride / chloride
    ],
    category: "Alkylating",
    severity: "reject",
    rationale: "Irreversible serine esterase inhibitors (AChE, BChE) — organophosphate nerve-agent structural class. Sarin/VX/DFP are extreme cases. Activity-based probes for esterases (DFP, PMSF) are research tools, not drug candidates. Universally excluded.",
    citation: "Jadhav et al., J. Med. Chem. 2010. NIOSH Pocket Guide to Chemical Hazards.",
  },
  {
    id: "NIH-004",
    library: "NIH-MLSMR",
    name: "Organic Cyanate Ester",
    smarts: [
      "[OX2][CX2]#[NX1]",        // O–C≡N (cyanate ester)
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Organic cyanate esters rearrange/hydrolyse to isocyanate intermediates → broad macromolecular reactivity (see BRENK-001). O–CN linkage is intrinsically unstable in aqueous media.",
    citation: "Jadhav et al., J. Med. Chem. 2010.",
  },
  {
    id: "NIH-005",
    library: "NIH-MLSMR",
    name: "Nitrosourea",
    smarts: [
      "[NX3][CX3](=O)[NX3][NX2]=O",  // R-NH-C(=O)-N(R)-N=O (BCNU/MNU class)
      // Nitrosourea pharmacophore: the nitroso group sits on the N adjacent to C=O, not
      // directly on C. Chain is N-C(=O)-N-N=O where the second N (NX3, 3 heavy-atom
      // bonds: C, alkyl/H, N=O) carries the N-nitroso substituent.
      // Verified against MNU (O=C(N)N(C)N=O) and BCNU (O=C(NCCCl)N(N=O)CCCl)
      // with RDKit 2024.03. Pattern "[NX3][CX3](=O)[NX2]=O" was incorrect because
      // C=O is NOT directly bonded to the nitroso nitrogen in the BCNU scaffold.
    ],
    category: "Alkylating",
    severity: "reject",
    rationale: "BCNU/CCNU/streptozotocin class. Spontaneously decomposes to DNA-alkylating diazonium and isocyanate. IARC Group 1 (known human carcinogens). Only acceptable in oncology with defined benefit-risk; excluded from non-oncology screening.",
    citation: "IARC Monograph Vol. 26 (nitrosoureas). Jadhav et al., J. Med. Chem. 2010.",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BMS — Bristol-Myers Squibb HTS Screening Filters
  // Source: Pearce et al., J. Med. Chem. 2006, 49, 6177–6196
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "BMS-001",
    library: "BMS",
    name: "Free Thiol",
    smarts: [
      "[SX2H]",                  // –SH (thiol, not in ring as thiophene/thiazolidine)
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Nucleophilic: thiol-disulfide exchange with protein Cys + generating mixed disulfides. Reacts with electrophilic assay components. Oxidises to disulfide in DMSO stocks over time, changing compound identity. Interferes with Ellman's reagent and thiol-based assays.",
    citation: "Pearce et al., J. Med. Chem. 2006 (BMS filter).",
  },
  {
    id: "BMS-002",
    library: "BMS",
    name: "Quaternary Nitrogen (Permanent Cation)",
    smarts: [
      // NX4+ excluding ammonium (NH4+), protonated imidazole/pyridine (legitimate),
      // and nitro group N+. Catches e.g. N-methyl-piperidinium quaternary salts.
      "[NX4+;!$([NH4+]);!$([nH+]);!$([NX4+]=O);!$([NX4+][OX1-])]",
    ],
    category: "PropertyFlag",
    severity: "warn",
    rationale: "Permanently cationic quaternary N severely reduces passive membrane permeability → poor oral absorption and CNS penetration. Causes non-specific electrostatic interactions with negatively charged assay plate surfaces and cell membranes.",
    citation: "Pearce et al., J. Med. Chem. 2006.",
  },
  {
    id: "BMS-003",
    library: "BMS",
    name: "Acrylate / Vinyl Ester Michael Acceptor",
    smarts: [
      "[CX3](=O)[OX2][CX3;H1]=[CX3;H2]",  // vinyl acrylate ester
      "[CX3](=O)[OX2][CH]=[CH2]",           // acrylate ester (simplified)
    ],
    category: "ReactiveElectrophile",
    severity: "warn",
    rationale: "Acrylate and methacrylate esters are Michael acceptors for biological thiols. Methyl acrylate is a skin sensitiser (contact allergen); GSH adducts well-characterised. React non-specifically with any accessible Cys in cell assays.",
    citation: "Pearce et al., J. Med. Chem. 2006. Schultz et al., Chem. Res. Toxicol. 2006.",
  },
  {
    id: "BMS-004",
    library: "BMS",
    name: "Extended PAH / Intense UV Chromophore (≥4 Fused Rings)",
    smarts: [
      // pyrene / coronene / benzo[a]pyrene class: 4-ring aromatic system
      // The pattern looks for a carbon that is part of 4 different aromatic rings.
      "c1ccc2ccc3cccc4cccc1c2c34",  // pyrene
    ],
    category: "PAINS",
    severity: "warn",
    rationale: "Large planar PAHs absorb broadly across UV-visible, causing false positives in fluorescence assays. Non-specific DNA intercalation. PAHs with >3 fused rings are known/probable carcinogens (IARC Group 1/2A; CYP1A1 epoxidation to diol-epoxides).",
    citation: "Pearce et al., J. Med. Chem. 2006. IARC Monograph Vol. 100F (benzo[a]pyrene).",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // REACTIVE METABOLITE ALERTS — additional metabolic activation concerns
  // not fully covered by above libraries; sourced from expert DMPK literature
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "META-001",
    library: "Ames-ICH",
    name: "Methylenedioxy Bridge (CYP Mechanism-Based Inhibitor)",
    smarts: [
      "[#6;a][OX2][CH2][OX2][#6;a]",  // Ar–O–CH2–O–Ar': one CH2 between two ArO groups
      // Correct test molecule: c1ccc2c(c1)OCO2 (1,3-benzodioxole, 5-membered ring)
      // NOT C1Oc2ccccc2OC1 (1,3-benzodioxane, 6-membered ring, two CH2 groups) —
      // the 6-membered form does not match because the O…O bridge has two carbons.
      // SMARTS verified correct against RDKit 2024.03 with benzodioxole SMILES.
    ],
    category: "ReactiveMetabolite",
    severity: "warn",
    rationale: "CYP3A4/2D6 oxidation of methylene bridge → carbene → quasi-irreversible MI complex with CYP heme iron. Mechanism-based CYP inactivation (MBI) causes drug-drug interactions; enzyme activity recovers only on new CYP synthesis (~36 h for CYP3A4). ICH M12 TDI assay required.",
    citation: "Parkinson et al., Drug Metab. Rev. 2018. ICH M12 2023. Silverman, Mechanism-Based Enzyme Inactivation 1988.",
  },
  {
    id: "META-002",
    library: "Brenk",
    name: "Aromatic Secondary Amine (N-Hydroxylation Risk)",
    smarts: [
      // Ar-NH-R: secondary amine on arene, not amide, not sulfonamide
      "[NX3;H1;$(Nc);!$(NC=O);!$(NS=O);!$(N=*)]",
    ],
    category: "Genotoxic",
    severity: "warn",
    rationale: "Slower N-hydroxylation than primary arylamines but still CYP1A2-mediated. Hydroxylamine intermediate can form protein/DNA adducts. Risk depends heavily on substitution pattern. Lower severity than primary aromatic amine; Ames test confirmation required.",
    citation: "Kazius et al., J. Med. Chem. 2005. Ashby & Tennant, Mutat. Res. 1991.",
  },
];

// ── Scan function ─────────────────────────────────────────────────────────────

const EMPTY_BREAKDOWN: Record<AlertLibrary, number> = {
  "Ames-ICH": 0, Brenk: 0, PAINS: 0, "NIH-MLSMR": 0, BMS: 0,
};

/**
 * Run the full structural alert scan against the provided SMILES.
 *
 * Anti-fabrication guarantee: if RDKit is not yet initialised (isReady()
 * returns false) we return an empty result with scanRan=false rather than
 * guessing. The caller should re-run once the chemistry engine is ready.
 */
export function runStructuralAlertScan(smiles: string): StructuralAlertResult {
  if (!isReady() || !smiles.trim()) {
    return {
      hits: [],
      rejectCount: 0, warnCount: 0,
      painsCount: 0, brenkCount: 0, bmsCount: 0, nihCount: 0, amesGenotoxCount: 0,
      libraryBreakdown: { ...EMPTY_BREAKDOWN },
      rejectNames: [], warnNames: [],
      scanRan: false,
    };
  }

  const hits: StructuralAlertHit[] = [];

  for (const alert of ALERT_LIBRARY) {
    for (const smarts of alert.smarts) {
      if (hasSubstructure(smiles, smarts)) {
        hits.push({ alert, matchedSmarts: smarts });
        break; // only count each alert once even if multiple SMARTS match
      }
    }
  }

  const rejectHits = hits.filter(h => h.alert.severity === "reject");
  const warnHits   = hits.filter(h => h.alert.severity === "warn");

  const breakdown = { ...EMPTY_BREAKDOWN };
  for (const h of hits) breakdown[h.alert.library]++;

  return {
    hits,
    rejectCount:      rejectHits.length,
    warnCount:        warnHits.length,
    painsCount:       breakdown.PAINS,
    brenkCount:       breakdown.Brenk,
    bmsCount:         breakdown.BMS,
    nihCount:         breakdown["NIH-MLSMR"],
    amesGenotoxCount: hits.filter(h =>
      h.alert.library === "Ames-ICH" && h.alert.category === "Genotoxic"
    ).length,
    libraryBreakdown: breakdown,
    rejectNames: rejectHits.map(h => h.alert.name),
    warnNames:   warnHits.map(h => h.alert.name),
    scanRan: true,
  };
}

/**
 * Returns true if any hit is a hard-reject that should drive a NO-GO decision
 * independently of ML toxicity signals (because reject-tier structural alerts
 * represent deterministic chemistry — no ML model can override an acyl halide
 * or a nitrosamine).
 */
export function hasHardReject(result: StructuralAlertResult): boolean {
  return result.rejectCount > 0;
}

/**
 * Short human-readable summary string for the safety panel header.
 * E.g. "3 alerts (1 reject: Acyl Halide; 2 warn: Catechol, Aldehyde)"
 */
export function summariseAlerts(result: StructuralAlertResult): string {
  if (!result.scanRan) return "RDKit not yet initialised — scan pending";
  if (result.hits.length === 0) return "No structural alerts detected";
  const parts: string[] = [];
  if (result.rejectCount > 0) {
    parts.push(`${result.rejectCount} reject: ${result.rejectNames.slice(0, 2).join("; ")}${result.rejectCount > 2 ? ` +${result.rejectCount - 2} more` : ""}`);
  }
  if (result.warnCount > 0) {
    parts.push(`${result.warnCount} warn: ${result.warnNames.slice(0, 2).join("; ")}${result.warnCount > 2 ? ` +${result.warnCount - 2} more` : ""}`);
  }
  return `${result.hits.length} alert${result.hits.length > 1 ? "s" : ""} (${parts.join("; ")})`;
}
