
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
  qed: number;
  heavyAtoms: number;
  lipinskiMW: boolean;
  lipinskiLogP: boolean;
  lipinskiHBD: boolean;
  lipinskiHBA: boolean;
  lipinskiPass: boolean;
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

export function getMolecularProperties(smiles: string): MolecularProperties | null {
  if (!rdkit || !smiles.trim()) return null;

  let mol: any = null;
  try {
    mol = rdkit.get_mol(smiles.trim());
    if (!mol || !mol.is_valid()) {
      return {
        isValid: false,
        mw: 0, logP: 0, hbd: 0, hba: 0, tpsa: 0, rotBonds: 0,
        qed: 0, heavyAtoms: 0,
        lipinskiMW: false, lipinskiLogP: false, lipinskiHBD: false,
        lipinskiHBA: false, lipinskiPass: false,
      };
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

    // QED: not provided by MinimalLib — compute a Lipinski-based approximation
    const qed = (() => {
      if (mw === 0) return 0;
      const mwScore  = mw  <= 300 ? 1 : mw  <= 400 ? 0.9 : mw  <= 500 ? 0.75 : mw  <= 600 ? 0.5 : 0.2;
      const logPScore = logP >= 0 && logP <= 3 ? 1 : logP <= 5 ? 0.8 : 0.3;
      const hbdScore = hbd <= 1 ? 1 : hbd <= 3 ? 0.8 : hbd <= 5 ? 0.5 : 0.2;
      const hbaScore = hba <= 5 ? 1 : hba <= 8 ? 0.8 : hba <= 10 ? 0.5 : 0.2;
      const tpsaScore = tpsa <= 60 ? 1 : tpsa <= 90 ? 0.85 : tpsa <= 120 ? 0.6 : 0.3;
      return parseFloat(((mwScore + logPScore + hbdScore + hbaScore + tpsaScore) / 5).toFixed(3));
    })();

    const lipinskiMW   = mw   <= 500;
    const lipinskiLogP = logP <= 5;
    const lipinskiHBD  = hbd  <= 5;
    const lipinskiHBA  = hba  <= 10;

    return {
      isValid: true,
      mw:       parseFloat(mw.toFixed(1)),
      logP:     parseFloat(logP.toFixed(2)),
      hbd,
      hba,
      tpsa:     parseFloat(tpsa.toFixed(1)),
      rotBonds,
      qed:      parseFloat(qed.toFixed(3)),
      heavyAtoms,
      lipinskiMW,
      lipinskiLogP,
      lipinskiHBD,
      lipinskiHBA,
      lipinskiPass: lipinskiMW && lipinskiLogP && lipinskiHBD && lipinskiHBA,
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
