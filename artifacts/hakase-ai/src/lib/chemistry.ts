
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
  /** Bickerton QED approximation (8-component ADS; ALERTS component uses pharmacophore proxy, not full ~150 SMARTS). Use as a drug-likeness heuristic only. */
  qed_approx: number;
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
  qed_approx: 0, heavyAtoms: 0, numRings: 0, numAromaticRings: 0, numAtoms: 0,
  lipinskiMW: false, lipinskiLogP: false, lipinskiHBD: false,
  lipinskiHBA: false, lipinskiPass: false,
  fsp3: 0, numHeteroatoms: 0, numHeterocycles: 0, numAromaticHeterocycles: 0,
  crippenMR: 0, labuteASA: 0, chi1v: 0, chi2v: 0,
  kappa1: 0, kappa2: 0, kappa3: 0, hallKierAlpha: 0,
  numAmideBonds: 0, numAliphaticRings: 0, numSaturatedRings: 0,
  numSpiroAtoms: 0, numBridgeheadAtoms: 0, numStereoCenters: 0, phi: 0,
};

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

    // ── QED (Bickerton 2012, Quantitative Estimate of Drug-likeness) ──────
    // Faithful port of the published asymmetric double-sigmoid (ADS) product
    // formulation from Bickerton et al., Nat. Chem. 4, 90–98 (2012),
    // matching the implementation in RDKit Contrib/qed.py. Computes
    // weighted geometric mean of 8 desirability functions over (MW, ALOGP,
    // HBA, HBD, PSA, ROTB, AROM, ALERTS), with the published "max" weight
    // vector. ALERTS (PAINS/Brenk substructure count) is approximated from
    // the pharmacophore reactive-moiety counts available in this layer
    // (Michael acceptor, epoxide, nitro, aromatic amine); the bioactivation
    // engine still runs a fuller alert scan separately. Documented honest
    // approximation — not a re-fit, no jitter.
    const qedApprox = (() => {
      if (mw === 0) return 0;
      const ads = (
        x: number, a: number, b: number, c: number, d: number,
        e: number, f: number, dxMax: number,
      ): number => {
        const left  = b / (1 + Math.exp(-1 * (x - c + d / 2) / e));
        const right = 1 - 1 / (1 + Math.exp(-1 * (x - c - d / 2) / f));
        return Math.max(1e-9, (a + left * right) / dxMax);
      };
      // ADS coefficients from Bickerton 2012 Supplementary Table S2,
      // as transcribed in RDKit Contrib/qed.py.
      const dMW    = ads(mw,   2.817, 392.575, 290.749, 2.420, 49.222, 65.371, 104.981);
      const dALOGP = ads(logP, 3.172690585, 137.8624751, 2.534937431, 4.581497897, 0.822739154, 0.576295591, 131.3186604);
      const dHBA   = ads(hba,  2.948620388, 160.4605972, 3.615294657, 4.435986202, 0.290141953, 1.300669958, 148.7763046);
      const dHBD   = ads(hbd,  1.618662227, 1010.051101, 0.985094388, 0.000000000034, 0.713820843, 0.920922555, 258.1632616);
      const dPSA   = ads(tpsa, 1.876861559, 125.2232657, 62.90773554, 87.83366614, 12.01999824, 28.51324732, 104.5686167);
      const dROTB  = ads(rotBonds, 0.010000000, 272.4121427, 2.558379970, 1.565547684, 1.271567166, 2.758063707, 105.4420403);
      const dAROM  = ads(numAromaticRings, 3.217788970, 957.7374108, 2.274627939, 0.000000000, 1.317690384, 0.375760881, 312.3372610);
      // ALERTS count proxy from pharmacophore-level reactive moieties; the
      // Bickerton paper uses the union of PAINS-A and Brenk filters
      // (~150 SMARTS). We cover the most impactful reactive families here
      // and leave the broader scan to bioactivationEngine; this means QED
      // is an OPTIMISTIC bound when those broader alerts fire.
      let alertsCount = 0;
      try {
        const pharm = detectPharmacophores(smiles);
        if (pharm) {
          alertsCount =
            (pharm.hasMichaelAcceptor ? 1 : 0) +
            (pharm.hasEpoxide          ? 1 : 0) +
            (pharm.hasNitro            ? 1 : 0) +
            (pharm.hasHydroxamicAcid   ? 1 : 0) +
            (pharm.hasThiol            ? 1 : 0) +
            pharm.aromaticAmineCount;
        }
      } catch { /* alerts default to 0 if pharmacophore probe fails */ }
      const dALERTS = ads(alertsCount, 0.010000000, 1199.094025, -0.09002883, 0.000000000, 0.185904477, 0.875193782, 417.7253140);
      // Bickerton "max" weight vector (Supplementary Table S3, w_max).
      const w = { MW: 0.66, ALOGP: 0.46, HBA: 0.05, HBD: 0.61, PSA: 0.06, ROTB: 0.65, AROM: 0.48, ALERTS: 0.95 };
      const wSum = w.MW + w.ALOGP + w.HBA + w.HBD + w.PSA + w.ROTB + w.AROM + w.ALERTS;
      const lnSum =
        w.MW     * Math.log(dMW)     +
        w.ALOGP  * Math.log(dALOGP)  +
        w.HBA    * Math.log(dHBA)    +
        w.HBD    * Math.log(dHBD)    +
        w.PSA    * Math.log(dPSA)    +
        w.ROTB   * Math.log(dROTB)   +
        w.AROM   * Math.log(dAROM)   +
        w.ALERTS * Math.log(dALERTS);
      const qedRaw = Math.exp(lnSum / wSum);
      return parseFloat(Math.max(0, Math.min(1, qedRaw)).toFixed(3));
    })(); // end qedApprox

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
      qed_approx: parseFloat(qedApprox.toFixed(3)),
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
    };
  } catch {
    return null;
  } finally {
    mol?.delete();
  }
}

export function hasSubstructure(smiles: string, smarts: string): boolean {
  if (!rdkit || !smiles.trim()) return false;
  let mol: any = null;
  try {
    mol = rdkit.get_mol(smiles.trim());
    if (!mol || !mol.is_valid()) return false;
    return trySubstructMatch(mol, smarts);
  } catch {
    return false;
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
