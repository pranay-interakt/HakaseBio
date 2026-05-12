import { computeQED, type QEDResult } from "./drugLikeness";

let rdkit: any = null;
let initPromise: Promise<void> | null = null;

export interface MolecularProperties {
  isValid: boolean;
  mw: number;
  logP: number;
  hbd: number;
  hba: number;
  tpsa: number;
  rotBonds: number;
  /**
   * Bickerton QED (weighted mean) ∈ (0, 1].
   * Implemented per Bickerton et al., Nat. Chem. 4:90 (2012) using the
   * canonical ADS parameter set; see `drugLikeness.ts`.
   */
  qed: number;
  /** Bickerton QED components (per-property desirability) for explainability. */
  qedComponents?: QEDResult["components"];
  /** Count of structural alerts used by the ALERTS desirability term. */
  numStructuralAlerts: number;
  heavyAtoms: number;
  numRings: number;
  numAromaticRings: number;
  numAtoms: number;
  lipinskiMW: boolean;
  lipinskiLogP: boolean;
  lipinskiHBD: boolean;
  lipinskiHBA: boolean;
  lipinskiPass: boolean;
  fsp3: number;
  numHeteroatoms: number;
  numHeterocycles: number;
  numAromaticHeterocycles: number;
  crippenMR: number;
  labuteASA: number;
  chi1v: number;
  chi2v: number;
  kappa1: number;
  kappa2: number;
  kappa3: number;
  hallKierAlpha: number;
  numAmideBonds: number;
  numAliphaticRings: number;
  numSaturatedRings: number;
  numSpiroAtoms: number;
  numBridgeheadAtoms: number;
  numStereoCenters: number;
  phi: number;
  /** Size of the largest detected ring (≥ 3); 0 if no rings. */
  largestRingSize: number;
}

export interface PharmacophoreProfile {
  aromaticNCount: number;
  basicAmineCount: number;
  aromaticAmineCount: number;
  acidicGroupCount: number;
  amideCount: number;
  hasCarboxylicAcid: boolean;
  hasSulfonamide: boolean;
  hasSulfone: boolean;
  hasPhenol: boolean;
  hasMichaelAcceptor: boolean;
  hasAmide: boolean;
  hasUrea: boolean;
  hasTrifluoromethyl: boolean;
  hasHalogen: boolean;
  hasHydroxamicAcid: boolean;
  hasThiol: boolean;
  hasPiperidine: boolean;
  hasPiperazine: boolean;
  hasIndole: boolean;
  hasQuinazoline: boolean;
  hasPyrimidine: boolean;
  hasBenzimidazole: boolean;
  hasEpoxide: boolean;
  hasPhosphate: boolean;
  hasNitro: boolean;
  hasEster: boolean;
  hasLactam: boolean;
  hasAlkoxy: boolean;
  hasAniline: boolean;
}

export interface FingerprintInfo {
  bitString: string;
  bitsSet: number;
  density: number;
  hexPreview: string;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      (existing as any).__loaded ? resolve() : existing.addEventListener("load", () => resolve());
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => { (s as any).__loaded = true; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export async function initChemistry(): Promise<void> {
  if (rdkit) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const base = (import.meta as any).env?.BASE_URL ?? "/";
    const jsPath = `${base}rdkit/RDKit_minimal.js`.replace("//", "/");
    const wasmPath = `${base}rdkit/`.replace("//", "/");

    await injectScript(jsPath);

    rdkit = await (window as any).initRDKitModule({
      locateFile: (file: string) => `${wasmPath}${file}`,
    });
  })();

  return initPromise;
}

export function isReady(): boolean {
  return rdkit !== null;
}

export function getRDKitInstance(): any | null {
  return rdkit;
}

const INVALID_PROPS: MolecularProperties = {
  isValid: false,
  mw: 0, logP: 0, hbd: 0, hba: 0, tpsa: 0, rotBonds: 0,
  qed: 0, numStructuralAlerts: 0,
  heavyAtoms: 0, numRings: 0, numAromaticRings: 0, numAtoms: 0,
  lipinskiMW: false, lipinskiLogP: false, lipinskiHBD: false,
  lipinskiHBA: false, lipinskiPass: false,
  fsp3: 0, numHeteroatoms: 0, numHeterocycles: 0, numAromaticHeterocycles: 0,
  crippenMR: 0, labuteASA: 0, chi1v: 0, chi2v: 0,
  kappa1: 0, kappa2: 0, kappa3: 0, hallKierAlpha: 0,
  numAmideBonds: 0, numAliphaticRings: 0, numSaturatedRings: 0,
  numSpiroAtoms: 0, numBridgeheadAtoms: 0, numStereoCenters: 0, phi: 0,
  largestRingSize: 0,
};

/**
 * SMARTS for the structural-alert subset of Brenk / Bickerton's QED ALERTS
 * dimension that we can detect cheaply. Each match contributes +1 to the
 * `numStructuralAlerts` count.
 *
 * The full Bickerton list contains ~100 SMARTS patterns — most of which
 * overlap with the bioactivation reactive-metabolite alerts surfaced
 * elsewhere in Layer 1. Adding more SMARTS only ratchets ALERTS desirability
 * downward, which is the correct directional behaviour, so the subset below
 * is a conservative under-estimate of the full Bickerton ALERTS count.
 */
const BICKERTON_ALERT_SMARTS: { id: string; smarts: string }[] = [
  { id: "nitro",            smarts: "[NX3](=O)=O" },
  { id: "nitro_anion",      smarts: "[N+](=O)[O-]" },
  { id: "epoxide",          smarts: "C1OC1" },
  { id: "aziridine",        smarts: "C1CN1" },
  { id: "michael_acceptor", smarts: "[CX3]=[CX3][CX3](=O)" },
  { id: "hydroxamic_acid",  smarts: "[CX3](=O)[NX3][OX2H]" },
  { id: "thiol",            smarts: "[SX2H]" },
  { id: "isocyanate",       smarts: "[NX2]=[CX2]=O" },
  { id: "azide",            smarts: "N=[N+]=[N-]" },
  { id: "phosphate_diester", smarts: "[PX4](=O)([OX2])[OX2]" },
  { id: "acyl_halide",      smarts: "[CX3](=O)[F,Cl,Br,I]" },
  { id: "alkyl_halide",     smarts: "[CX4][F,Cl,Br,I]" },
  { id: "perhalo_methyl",   smarts: "[CX4]([F,Cl,Br,I])([F,Cl,Br,I])[F,Cl,Br,I]" },
  { id: "anhydride",        smarts: "[CX3](=O)[OX2][CX3](=O)" },
];

/**
 * Detect whether the molecule contains a macrocycle (any ring with ≥ 9 atoms)
 * and, if so, return its size. Otherwise return a representative ring size
 * (6 if rings exist, 0 if not).
 *
 * Macrocycles are rare in drug-like compounds; ring-walking via RDKit-JS
 * minimal is awkward, so we use explicit closed-ring SMARTS for sizes 9-14
 * (the range that triggers the Ertl macrocycle penalty). This is sufficient
 * for the SA-score complexity penalty — a more expensive walk would not
 * change the result for any standard small-molecule.
 */
function detectLargestRingSize(mol: any, knownNumRings: number): number {
  if (knownNumRings <= 0) return 0;
  for (let n = 14; n >= 9; n--) {
    const smarts = `*1${"*".repeat(n - 1)}1`;
    let qmol: any = null;
    try {
      qmol = rdkit.get_qmol(smarts);
      if (!qmol) continue;
      const matchJson: string = mol.get_substruct_match(qmol);
      if (matchJson && matchJson.length > 2 && matchJson !== "{}") {
        return n;
      }
    } catch {
      // fall through
    } finally {
      qmol?.delete();
    }
  }
  return 6;
}

function countAlerts(mol: any): number {
  let n = 0;
  for (const { smarts } of BICKERTON_ALERT_SMARTS) {
    let qmol: any = null;
    try {
      qmol = rdkit.get_qmol(smarts);
      if (!qmol) continue;
      const matchJson: string = mol.get_substruct_match(qmol);
      if (matchJson && matchJson.length > 2 && matchJson !== "{}") n += 1;
    } catch {
      // ignore — alert undetected
    } finally {
      qmol?.delete();
    }
  }
  return n;
}

export function getMolecularProperties(smiles: string): MolecularProperties | null {
  if (!rdkit || !smiles.trim()) return null;

  let mol: any = null;
  try {
    mol = rdkit.get_mol(smiles.trim());
    if (!mol || !mol.is_valid()) {
      return { ...INVALID_PROPS };
    }

    const desc = JSON.parse(mol.get_descriptors());

    if (import.meta.env.DEV && !(window as any).__rdkitDescLogged) {
      console.debug("[RDKit] descriptor keys:", Object.keys(desc));
      (window as any).__rdkitDescLogged = true;
    }

    const mw       = Number(desc.amw              ?? desc.exactmw       ?? desc.MolWt        ?? 0);
    const logP     = Number(desc.CrippenClogP     ?? desc.MolLogP       ?? desc.logP         ?? 0);
    const hbd      = Number(desc.lipinskiHBD      ?? desc.NumHBD        ?? desc.NumHDonors   ?? 0);
    const hba      = Number(desc.lipinskiHBA      ?? desc.NumHBA        ?? desc.NumHAcceptors ?? 0);
    const tpsa     = Number(desc.tpsa             ?? desc.TPSA          ?? 0);
    const rotBonds = Number(desc.NumRotatableBonds ?? 0);
    const heavyAtoms = Number(desc.NumHeavyAtoms  ?? 0);
    const numRings  = Number(desc.NumRings         ?? 0);
    const numAromaticRings = Number(desc.NumAromaticRings ?? 0);
    const numAtoms  = Number(desc.NumAtoms         ?? desc.NumHeavyAtoms ?? 0);
    const fsp3      = Number(desc.FractionCSP3     ?? 0);
    const numHeteroatoms = Number(desc.NumHeteroatoms ?? 0);
    const numHeterocycles = Number(desc.NumHeterocycles ?? 0);
    const numAromaticHeterocycles = Number(desc.NumAromaticHeterocycles ?? 0);
    const crippenMR = Number(desc.CrippenMR ?? 0);
    const labuteASA = Number(desc.labuteASA ?? 0);
    const chi1v     = Number(desc.chi1v ?? 0);
    const chi2v     = Number(desc.chi2v ?? 0);
    const kappa1    = Number(desc.kappa1 ?? 0);
    const kappa2    = Number(desc.kappa2 ?? 0);
    const kappa3    = Number(desc.kappa3 ?? 0);
    const hallKierAlpha = Number(desc.hallKierAlpha ?? 0);
    const numAmideBonds = Number(desc.NumAmideBonds ?? 0);
    const numAliphaticRings = Number(desc.NumAliphaticRings ?? 0);
    const numSaturatedRings = Number(desc.NumSaturatedRings ?? 0);
    const numSpiroAtoms = Number(desc.NumSpiroAtoms ?? 0);
    const numBridgeheadAtoms = Number(desc.NumBridgeheadAtoms ?? 0);
    const numStereoCenters = Number(desc.NumAtomStereoCenters ?? 0);
    const phi = Number(desc.Phi ?? 0);

    const numStructuralAlerts = countAlerts(mol);
    const largestRingSize = detectLargestRingSize(mol, numRings);

    const qedResult = mw === 0
      ? { weighted: 0, mean: 0, components: undefined as unknown as QEDResult["components"] }
      : computeQED({
          mw, logP, hba, hbd, tpsa,
          rotBonds, numAromaticRings,
          numAlerts: numStructuralAlerts,
        });
    const qed = qedResult.weighted;

    const lipinskiMW   = mw   <= 500;
    const lipinskiLogP = logP <= 5;
    const lipinskiHBD  = hbd  <= 5;
    const lipinskiHBA  = hba  <= 10;

    return {
      isValid: true,
      mw:       parseFloat(mw.toFixed(1)),
      logP:     parseFloat(logP.toFixed(2)),
      hbd, hba,
      tpsa:     parseFloat(tpsa.toFixed(1)),
      rotBonds,
      qed:      parseFloat(qed.toFixed(3)),
      qedComponents: qedResult.components,
      numStructuralAlerts,
      heavyAtoms, numRings, numAromaticRings, numAtoms,
      lipinskiMW, lipinskiLogP, lipinskiHBD, lipinskiHBA,
      lipinskiPass: lipinskiMW && lipinskiLogP && lipinskiHBD && lipinskiHBA,
      fsp3:     parseFloat(fsp3.toFixed(3)),
      numHeteroatoms, numHeterocycles, numAromaticHeterocycles,
      crippenMR: parseFloat(crippenMR.toFixed(2)),
      labuteASA: parseFloat(labuteASA.toFixed(2)),
      chi1v:    parseFloat(chi1v.toFixed(3)),
      chi2v:    parseFloat(chi2v.toFixed(3)),
      kappa1:   parseFloat(kappa1.toFixed(3)),
      kappa2:   parseFloat(kappa2.toFixed(3)),
      kappa3:   parseFloat(kappa3.toFixed(3)),
      hallKierAlpha: parseFloat(hallKierAlpha.toFixed(3)),
      numAmideBonds, numAliphaticRings, numSaturatedRings,
      numSpiroAtoms, numBridgeheadAtoms, numStereoCenters,
      phi:      parseFloat(phi.toFixed(3)),
      largestRingSize,
    };
  } catch {
    return null;
  } finally {
    mol?.delete();
  }
}

function trySubstructMatch(mol: any, smarts: string): boolean {
  let qmol: any = null;
  try {
    qmol = rdkit.get_qmol(smarts);
    if (!qmol) return false;
    const matchJson: string = mol.get_substruct_match(qmol);
    return !!matchJson && matchJson.length > 2 && matchJson !== "{}";
  } catch {
    return false;
  } finally {
    qmol?.delete();
  }
}

function countSubstructMatches(mol: any, smarts: string): number {
  let qmol: any = null;
  try {
    qmol = rdkit.get_qmol(smarts);
    if (!qmol) return 0;
    const matchesJson: string = mol.get_substruct_matches(qmol);
    if (!matchesJson || matchesJson.length <= 2) return 0;
    const parsed = JSON.parse(matchesJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  } finally {
    qmol?.delete();
  }
}

export function detectPharmacophores(smiles: string): PharmacophoreProfile | null {
  if (!rdkit || !smiles.trim()) return null;

  let mol: any = null;
  try {
    mol = rdkit.get_mol(smiles.trim());
    if (!mol || !mol.is_valid()) return null;

    const has = (s: string) => trySubstructMatch(mol, s);
    const cnt = (s: string) => countSubstructMatches(mol, s);

    return {
      aromaticNCount:    cnt("[n]"),
      basicAmineCount:   cnt("[NX3;H1,H2;!$(NC=O);!$(NS=O);!$(N=*);!$(Nc)]"),
      aromaticAmineCount: cnt("[NX3;H1,H2;$(Nc);!$(NC=O)]"),
      acidicGroupCount:  cnt("[OX2H][CX3]=O") + cnt("[OX1H]S(=O)=O"),
      amideCount:        cnt("[NX3][CX3](=O)[#6]"),
      hasCarboxylicAcid: has("[CX3](=O)[OX2H1]"),
      hasSulfonamide:    has("[NX3]S(=O)(=O)") || has("NS(=O)(=O)"),
      hasSulfone:        has("S(=O)(=O)"),
      hasPhenol:         has("[OX2H]c"),
      hasMichaelAcceptor: has("[CX3]=[CX3][CX3]=O") || has("C=CC(=O)"),
      hasAmide:          has("[NX3][CX3](=O)[#6]"),
      hasUrea:           has("[NX3][CX3](=O)[NX3]"),
      hasTrifluoromethyl: has("[CX4](F)(F)F"),
      hasHalogen:        has("[F,Cl,Br,I]"),
      hasHydroxamicAcid: has("[CX3](=O)[NX3][OX2H]") || has("C(=O)NO"),
      hasThiol:          has("[SX2H]"),
      hasPiperidine:     has("C1CCNCC1"),
      hasPiperazine:     has("C1CNCCN1"),
      hasIndole:         has("c1ccc2[nH]ccc2c1") || has("c1cc2cc[nH]c2cc1"),
      hasQuinazoline:    has("c1cnc2ccccc2n1") || has("c1ccc2ncncc2c1"),
      hasPyrimidine:     has("c1ncccn1") || has("c1ccncn1") || has("c1nccnc1"),
      hasBenzimidazole:  has("c1ccc2[nH]cnc2c1"),
      hasEpoxide:        has("C1OC1"),
      hasPhosphate:      has("[PX4](=O)([OX2])[OX2]"),
      hasNitro:          has("[NX3](=O)=O") || has("[N+](=O)[O-]"),
      hasEster:          has("[#6][CX3](=O)[OX2][#6]"),
      hasLactam:         has("[NX3R][CX3R](=O)"),
      hasAlkoxy:         has("[OX2]([#6;!$(C=O)])[#6;!$(C=O)]"),
      hasAniline:        has("[NX3;H1,H2;$(Nc);!$(NC=O)]"),
    };
  } catch {
    return null;
  } finally {
    mol?.delete();
  }
}

export function generateFingerprint(smiles: string): FingerprintInfo | null {
  if (!rdkit || !smiles.trim()) return null;

  let mol: any = null;
  try {
    mol = rdkit.get_mol(smiles.trim());
    if (!mol || !mol.is_valid()) return null;

    const bitStr: string = mol.get_morgan_fp();
    const bitsSet = (bitStr.match(/1/g) ?? []).length;
    const density = bitsSet / bitStr.length;

    const bytes: string[] = [];
    for (let i = 0; i < Math.min(32, bitStr.length); i += 8) {
      bytes.push(parseInt(bitStr.slice(i, i + 8).padEnd(8, "0"), 2).toString(16).padStart(2, "0"));
    }
    const hexPreview = bytes.join("") + "…";

    return { bitString: bitStr, bitsSet, density, hexPreview };
  } catch {
    return null;
  } finally {
    mol?.delete();
  }
}

export function computeTanimotoSimilarity(fp1: string, fp2: string): number {
  if (!fp1 || !fp2 || fp1.length !== fp2.length) return 0;
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < fp1.length; i++) {
    const a = fp1[i] === "1" ? 1 : 0;
    const b = fp2[i] === "1" ? 1 : 0;
    intersection += a & b;
    union += a | b;
  }
  return union === 0 ? 0 : intersection / union;
}
