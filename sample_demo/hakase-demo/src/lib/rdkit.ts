/**
 * Small browser-side adapter around the official RDKit.js WebAssembly build.
 *
 * The module is deliberately loaded only when a structure is screened: the
 * initial landing/dashboard route should not pay for a chemistry runtime it
 * does not need. Vite serves the two package assets through its local build
 * plugin; no structure or descriptor is sent to a third party.
 */
import type { Descriptors } from "./chem";

type RdkitDescriptorMap = Record<string, number>;

export type RdkitReadout = {
  engine: string;
  canonicalSmiles: string;
  inchiKey: string;
  svg: string;
  descriptorPatch: Pick<Descriptors,
    "molecular_weight_da" | "exact_molecular_weight_da" | "logp" | "tpsa_a2" |
    "h_bond_acceptors" | "h_bond_donors" | "rotatable_bonds" | "ring_count" |
    "aromatic_ring_count" | "aliphatic_ring_count" | "fraction_csp3" |
    "heavy_atom_count" | "hetero_atom_count" | "molar_refractivity" | "stereo_centers"
  >;
};

type RDKitMol = {
  delete(): void;
  get_smiles(): string;
  get_inchi(): string;
  get_svg(width?: number, height?: number): string;
  get_descriptors(): string;
};

type RDKitModule = {
  version(): string;
  get_mol(input: string): RDKitMol | null;
  get_inchikey_for_inchi(inchi: string): string;
};

declare global {
  interface Window {
    initRDKitModule?: (options?: { locateFile?: (file: string) => string }) => Promise<RDKitModule>;
  }
}

let modulePromise: Promise<RDKitModule> | null = null;

function publicAsset(path: string) {
  return `${import.meta.env.BASE_URL}rdkit/${path}`;
}

async function loadModule(): Promise<RDKitModule> {
  if (window.initRDKitModule) {
    return window.initRDKitModule({ locateFile: (file) => publicAsset(file) });
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-rdkit-runtime="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("The RDKit runtime could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = publicAsset("RDKit_minimal.js");
    script.async = true;
    script.dataset.rdkitRuntime = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("The RDKit runtime could not be loaded."));
    document.head.appendChild(script);
  });

  const loader = (window as unknown as {
    initRDKitModule?: (options?: { locateFile?: (file: string) => string }) => Promise<RDKitModule>;
  }).initRDKitModule;
  if (!loader) throw new Error("RDKit did not expose its WebAssembly loader.");
  return loader({ locateFile: (file: string) => publicAsset(file) });
}

async function getModule() {
  modulePromise ??= loadModule();
  return modulePromise;
}

const r2 = (value: number) => Math.round(value * 100) / 100;
const r3 = (value: number) => Math.round(value * 1000) / 1000;
const r4 = (value: number) => Math.round(value * 10000) / 10000;
const value = (descriptors: RdkitDescriptorMap, key: string) => Number(descriptors[key] ?? 0);

/** Runs genuine RDKit structure parsing, depiction and descriptor calculation. */
export async function readWithRDKit(smiles: string): Promise<RdkitReadout> {
  const rdkit = await getModule();
  const molecule = rdkit.get_mol(smiles);
  if (!molecule) throw new Error("RDKit could not parse this structure.");

  try {
    const descriptors = JSON.parse(molecule.get_descriptors()) as RdkitDescriptorMap;
    const inchi = molecule.get_inchi();
    return {
      engine: `RDKit.js ${rdkit.version()} (WebAssembly)`,
      canonicalSmiles: molecule.get_smiles(),
      inchiKey: rdkit.get_inchikey_for_inchi(inchi),
      svg: molecule.get_svg(680, 360),
      descriptorPatch: {
        molecular_weight_da: r2(value(descriptors, "amw")),
        exact_molecular_weight_da: r4(value(descriptors, "exactmw")),
        logp: r3(value(descriptors, "CrippenClogP")),
        tpsa_a2: r2(value(descriptors, "tpsa")),
        h_bond_acceptors: Math.round(value(descriptors, "NumHBA")),
        h_bond_donors: Math.round(value(descriptors, "NumHBD")),
        rotatable_bonds: Math.round(value(descriptors, "NumRotatableBonds")),
        ring_count: Math.round(value(descriptors, "NumRings")),
        aromatic_ring_count: Math.round(value(descriptors, "NumAromaticRings")),
        aliphatic_ring_count: Math.round(value(descriptors, "NumAliphaticRings")),
        fraction_csp3: r3(value(descriptors, "FractionCSP3")),
        heavy_atom_count: Math.round(value(descriptors, "NumHeavyAtoms")),
        hetero_atom_count: Math.round(value(descriptors, "NumHeteroatoms")),
        molar_refractivity: r2(value(descriptors, "CrippenMR")),
        stereo_centers: Math.round(value(descriptors, "NumAtomStereoCenters")),
      },
    };
  } finally {
    molecule.delete();
  }
}
