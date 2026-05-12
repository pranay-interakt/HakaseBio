/**
 * Lazy loader for RDKit-MinimalLib (WASM build of RDKit, the industry-standard
 * cheminformatics toolkit). Loaded from the official CDN on first use so the
 * mockup-sandbox starts fast and only pays the ~2.4 MB WASM cost when the
 * Layer 1 simulation actually fires.
 *
 * Pinned to a known-good version. Update intentionally, not opportunistically.
 *
 * Reference:
 *   Landrum G. RDKit: Open-source cheminformatics. https://www.rdkit.org
 *   RDKit-JS: https://github.com/rdkit/rdkit-js
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const RDKIT_VERSION = "2024.3.5";
const RDKIT_JS_URL = `https://unpkg.com/@rdkit/rdkit@${RDKIT_VERSION}/dist/RDKit_minimal.js`;

export type RDKitMol = {
  is_valid: () => boolean;
  get_smiles: () => string;
  get_inchi: () => string;
  get_inchikey_for_inchi: (inchi: string) => string;
  get_descriptors: () => string; // JSON
  get_morgan_fp_as_uint8array: (details: string) => Uint8Array;
  get_pattern_fp_as_uint8array: () => Uint8Array;
  get_substruct_match: (query: RDKitMol) => string; // JSON {atoms,bonds}
  get_svg: (w?: number, h?: number) => string;
  get_svg_with_highlights: (details: string) => string;
  get_mol_formula: () => string;
  delete: () => void;
};

export type RDKitModule = {
  version: () => string;
  get_mol: (smiles: string, details?: string) => RDKitMol;
  get_qmol: (smarts: string) => RDKitMol;
  get_inchikey_for_inchi: (inchi: string) => string;
  prefer_coordgen: (val: boolean) => void;
};

let rdkitPromise: Promise<RDKitModule> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("RDKit can only be loaded in a browser environment"));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-rdkit="${src}"]`,
    );
    if (existing) {
      if ((existing as any)._loaded) resolve();
      else existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error(`Failed to load ${src}`)),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.rdkit = src;
    script.addEventListener("load", () => {
      (script as any)._loaded = true;
      resolve();
    });
    script.addEventListener("error", () =>
      reject(new Error(`Failed to load ${src}`)),
    );
    document.head.appendChild(script);
  });
}

export async function getRDKit(): Promise<RDKitModule> {
  if (rdkitPromise) return rdkitPromise;
  rdkitPromise = (async () => {
    const w = window as any;
    if (typeof w.initRDKitModule !== "function") {
      await loadScript(RDKIT_JS_URL);
    }
    if (typeof w.initRDKitModule !== "function") {
      throw new Error(
        "RDKit_minimal.js loaded but initRDKitModule is not defined",
      );
    }
    const mod: RDKitModule = await w.initRDKitModule();
    mod.prefer_coordgen(true);
    return mod;
  })();
  return rdkitPromise;
}

/**
 * Convenience: get a parsed mol or throw with a useful error.
 * Caller is responsible for calling `.delete()` to free WASM memory.
 */
export async function parseMol(smiles: string): Promise<RDKitMol> {
  const rdkit = await getRDKit();
  const mol = rdkit.get_mol(smiles);
  if (!mol || !mol.is_valid()) {
    try {
      mol?.delete?.();
    } catch {
      /* noop */
    }
    throw new Error(`Invalid SMILES: ${smiles}`);
  }
  return mol;
}

/** Run a function with a parsed mol, automatically freeing it afterwards. */
export async function withMol<T>(
  smiles: string,
  fn: (mol: RDKitMol) => T | Promise<T>,
): Promise<T> {
  const mol = await parseMol(smiles);
  try {
    return await fn(mol);
  } finally {
    try {
      mol.delete();
    } catch {
      /* noop */
    }
  }
}
