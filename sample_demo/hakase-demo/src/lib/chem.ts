/**
 * In-browser cheminformatics.
 *
 * The production platform computes every descriptor server-side with RDKit.
 * This demonstration build reimplements the deterministic part of that readout
 * in TypeScript so the workspace responds to a real structure rather than
 * replaying a fixture: a SMILES parser, a molecular graph, the RDKit-equivalent
 * descriptor set, a Bickerton QED, an Ertl-style TPSA, a Wildman–Crippen-style
 * logP estimate, a circular fingerprint for Tanimoto applicability, a structural
 * alert screen, and 2D coordinates for the depiction.
 *
 * These are approximations of the published methods, not the vendored models.
 * Everywhere a number here is displayed the interface says which it is.
 */

/* ── atomic data ─────────────────────────────────────────────────────────── */

const ATOMIC_MASS: Record<string, number> = {
  H: 1.008, B: 10.811, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Na: 22.990,
  Mg: 24.305, Al: 26.982, Si: 28.086, P: 30.974, S: 32.06, Cl: 35.45, K: 39.098,
  Ca: 40.078, Fe: 55.845, Cu: 63.546, Zn: 65.38, As: 74.922, Se: 78.971,
  Br: 79.904, I: 126.904, Li: 6.94, Pt: 195.084,
};

const EXACT_MASS: Record<string, number> = {
  H: 1.00783, B: 11.00931, C: 12.0, N: 14.00307, O: 15.99491, F: 18.99840,
  Na: 22.98977, Mg: 23.98504, Al: 26.98154, Si: 27.97693, P: 30.97376,
  S: 31.97207, Cl: 34.96885, K: 38.96371, Ca: 39.96259, Fe: 55.93494,
  Cu: 62.92960, Zn: 63.92914, As: 74.92160, Se: 79.91652, Br: 78.91834,
  I: 126.90447, Li: 7.01600, Pt: 194.96479,
};

const DEFAULT_VALENCE: Record<string, number> = {
  B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, F: 1, Cl: 1, Br: 1, I: 1, Si: 4, Se: 2, As: 3,
};

/** Element colours for the depiction — the conventional Jmol/CPK assignment. */
export const ELEMENT_COLOR: Record<string, string> = {
  C: "#2f3742", N: "#2563eb", O: "#dc2626", S: "#ca8a04", P: "#ea580c",
  F: "#059669", Cl: "#16a34a", Br: "#a16207", I: "#7c3aed", B: "#f472b6",
  Si: "#94a3b8", Se: "#b45309", Na: "#8b5cf6", K: "#8b5cf6", H: "#64748b",
};

const ORGANIC_SUBSET = ["Cl", "Br", "B", "C", "N", "O", "P", "S", "F", "I", "b", "c", "n", "o", "p", "s"];

/* ── molecular graph ─────────────────────────────────────────────────────── */

export type Atom = {
  index: number;
  element: string;
  aromatic: boolean;
  charge: number;
  isotope: number | null;
  explicitH: number | null;
  implicitH: number;
  bonds: number[];         // bond indices
  neighbours: number[];    // atom indices
  ringMembership: number[];// ring indices
  inRing: boolean;
  x: number;
  y: number;
};

export type Bond = {
  index: number;
  a: number;
  b: number;
  order: number;      // 1, 2, 3
  aromatic: boolean;
  inRing: boolean;
  stereo: "" | "/" | "\\";
};

export type Molecule = {
  smiles: string;
  canonicalSmiles: string;
  atoms: Atom[];
  bonds: Bond[];
  rings: number[][];
  valid: boolean;
  error?: string;
  components: number;
  /** The largest disconnected fragment, i.e. the parent species after salt strip. */
  parentSmilesFragment: string;
  strippedFragments: string[];
};

class ParseError extends Error {}

/**
 * Parse a SMILES string into a molecular graph.
 *
 * Supports the organic subset, bracket atoms with isotope/charge/explicit H,
 * aromatic lowercase atoms, branches, ring-bond closures (including %nn),
 * bond symbols and directional bonds. Stereocentre parity is recorded but not
 * used for descriptors — the workspace never claims a stereo-dependent value.
 */
export function parseSmiles(input: string): Molecule {
  const smiles = input.trim();
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const empty = (): Molecule => ({
    smiles, canonicalSmiles: smiles, atoms: [], bonds: [], rings: [], valid: false,
    components: 0, parentSmilesFragment: smiles, strippedFragments: [],
  });
  if (!smiles) return { ...empty(), error: "No structure supplied." };

  const componentStrings = smiles.split(".").filter(Boolean);
  const parentFragment = componentStrings.reduce((longest, item) => (item.length > longest.length ? item : longest), "");
  const stripped = componentStrings.filter((item) => item !== parentFragment);

  function addAtom(element: string, aromatic: boolean, charge: number, isotope: number | null, explicitH: number | null): number {
    atoms.push({
      index: atoms.length, element, aromatic, charge, isotope, explicitH,
      implicitH: 0, bonds: [], neighbours: [], ringMembership: [], inRing: false, x: 0, y: 0,
    });
    return atoms.length - 1;
  }

  function addBond(a: number, b: number, order: number, aromatic: boolean, stereo: "" | "/" | "\\") {
    if (a === b) return;
    if (atoms[a].neighbours.includes(b)) return;
    const bond: Bond = { index: bonds.length, a, b, order, aromatic, inRing: false, stereo };
    bonds.push(bond);
    atoms[a].bonds.push(bond.index); atoms[b].bonds.push(bond.index);
    atoms[a].neighbours.push(b); atoms[b].neighbours.push(a);
  }

  try {
    let position = 0;
    let previous: number | null = null;
    let pendingOrder = 0;                       // 0 = default single/aromatic
    let pendingStereo: "" | "/" | "\\" = "";
    const branchStack: (number | null)[] = [];
    const ringOpen = new Map<number, { atom: number; order: number; stereo: "" | "/" | "\\" }>();

    while (position < smiles.length) {
      const character = smiles[position];

      if (character === "." ) { previous = null; position += 1; continue; }
      if (character === "(") { branchStack.push(previous); position += 1; continue; }
      if (character === ")") { previous = branchStack.pop() ?? null; position += 1; continue; }
      if (character === "-") { pendingOrder = 1; position += 1; continue; }
      if (character === "=") { pendingOrder = 2; position += 1; continue; }
      if (character === "#") { pendingOrder = 3; position += 1; continue; }
      if (character === ":") { pendingOrder = 4; position += 1; continue; }
      if (character === "/") { pendingStereo = "/"; position += 1; continue; }
      if (character === "\\") { pendingStereo = "\\"; position += 1; continue; }
      if (character === "@") { position += smiles[position + 1] === "@" ? 2 : 1; continue; }
      if (character === "~") { pendingOrder = 1; position += 1; continue; }

      // Ring-closure digits
      if (/[0-9]/.test(character) || character === "%") {
        let label: number;
        if (character === "%") {
          label = Number(smiles.slice(position + 1, position + 3));
          position += 3;
        } else {
          label = Number(character);
          position += 1;
        }
        if (previous === null) throw new ParseError("Ring closure before any atom.");
        const open = ringOpen.get(label);
        if (open) {
          const order = pendingOrder || open.order || 0;
          const bothAromatic = atoms[open.atom].aromatic && atoms[previous].aromatic;
          addBond(open.atom, previous, order === 4 ? 1 : order || 1, order === 4 || (order === 0 && bothAromatic), open.stereo || pendingStereo);
          ringOpen.delete(label);
        } else {
          ringOpen.set(label, { atom: previous, order: pendingOrder, stereo: pendingStereo });
        }
        pendingOrder = 0; pendingStereo = "";
        continue;
      }

      // Bracket atom
      if (character === "[") {
        const close = smiles.indexOf("]", position);
        if (close < 0) throw new ParseError("Unclosed bracket atom.");
        const body = smiles.slice(position + 1, close);
        const match = /^(\d+)?([A-Za-z][a-z]?|\*)(@{0,2})((?:H\d*)?)((?:[+-]\d*|\++|-+)?)/.exec(body);
        if (!match) throw new ParseError(`Unreadable bracket atom "[${body}]".`);
        const isotope = match[1] ? Number(match[1]) : null;
        const rawElement = match[2];
        const aromatic = rawElement === rawElement.toLowerCase() && rawElement !== "*";
        const element = rawElement === "*" ? "C" : rawElement.charAt(0).toUpperCase() + rawElement.slice(1);
        const hydrogenToken = match[4];
        const explicitH = hydrogenToken ? (hydrogenToken.length > 1 ? Number(hydrogenToken.slice(1)) : 1) : 0;
        const chargeToken = match[5] ?? "";
        let charge = 0;
        if (chargeToken) {
          if (/^[+-]\d+$/.test(chargeToken)) charge = Number(chargeToken);
          else charge = (chargeToken[0] === "+" ? 1 : -1) * chargeToken.length;
        }
        const created = addAtom(element, aromatic, charge, isotope, explicitH);
        if (previous !== null) {
          const order = pendingOrder === 4 ? 1 : pendingOrder || 1;
          const bothAromatic = atoms[previous].aromatic && aromatic;
          addBond(previous, created, order, pendingOrder === 4 || (pendingOrder === 0 && bothAromatic), pendingStereo);
        }
        previous = created; pendingOrder = 0; pendingStereo = "";
        position = close + 1;
        continue;
      }

      // Organic-subset atom
      const twoLetter = smiles.slice(position, position + 2);
      const symbol = ORGANIC_SUBSET.includes(twoLetter) ? twoLetter : character;
      if (!ORGANIC_SUBSET.includes(symbol)) throw new ParseError(`Unrecognised token "${character}" at position ${position}.`);
      const aromatic = symbol === symbol.toLowerCase() && symbol.length === 1 && "bcnops".includes(symbol);
      const element = symbol.charAt(0).toUpperCase() + symbol.slice(1);
      const created = addAtom(element, aromatic, 0, null, null);
      if (previous !== null) {
        const order = pendingOrder === 4 ? 1 : pendingOrder || 1;
        const bothAromatic = atoms[previous].aromatic && aromatic;
        addBond(previous, created, order, pendingOrder === 4 || (pendingOrder === 0 && bothAromatic), pendingStereo);
      }
      previous = created; pendingOrder = 0; pendingStereo = "";
      position += symbol.length;
    }

    if (ringOpen.size) throw new ParseError("Unclosed ring bond.");
    if (!atoms.length) throw new ParseError("No atoms were read from the structure.");
  } catch (reason) {
    return { ...empty(), error: reason instanceof Error ? reason.message : "The structure could not be parsed." };
  }

  const rings = findRings(atoms, bonds);
  rings.forEach((ring, ringIndex) => {
    ring.forEach((atomIndex) => {
      atoms[atomIndex].inRing = true;
      atoms[atomIndex].ringMembership.push(ringIndex);
    });
  });
  // A bond lies in a ring exactly when it is not a bridge (a cut edge) of the
  // molecular graph. Deriving it that way rather than from the SSSR keeps the
  // flag correct for bridged and spiro systems, whose SSSR does not contain
  // every ring bond.
  const bridges = findBridges(atoms, bonds);
  for (const bond of bonds) bond.inRing = !bridges.has(bond.index);
  assignImplicitHydrogens(atoms, bonds);
  layout2d(atoms, bonds, rings);

  return {
    smiles,
    canonicalSmiles: canonicalise(smiles),
    atoms, bonds, rings,
    valid: true,
    components: countComponents(atoms),
    parentSmilesFragment: parentFragment,
    strippedFragments: stripped,
  };
}

function countComponents(atoms: Atom[]): number {
  const seen = new Set<number>();
  let components = 0;
  for (const atom of atoms) {
    if (seen.has(atom.index)) continue;
    components += 1;
    const stack = [atom.index];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      atoms[current].neighbours.forEach((neighbour) => { if (!seen.has(neighbour)) stack.push(neighbour); });
    }
  }
  return components;
}

/** Smallest-set-of-smallest-rings, found by BFS from each ring-closure bond. */
function findRings(atoms: Atom[], bonds: Bond[]): number[][] {
  const adjacency = atoms.map((atom) => atom.neighbours.slice());
  const rings: number[][] = [];
  const seen = new Set<string>();
  const spanningParent = new Map<number, number>();
  const visited = new Set<number>();
  const ringClosures: Array<[number, number]> = [];

  for (const atom of atoms) {
    if (visited.has(atom.index)) continue;
    const queue = [atom.index];
    visited.add(atom.index);
    spanningParent.set(atom.index, -1);
    while (queue.length) {
      const current = queue.shift()!;
      for (const neighbour of adjacency[current]) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          spanningParent.set(neighbour, current);
          queue.push(neighbour);
        } else if (spanningParent.get(current) !== neighbour) {
          const key = [current, neighbour].sort((a, b) => a - b).join("-");
          if (!seen.has(key)) { seen.add(key); ringClosures.push([current, neighbour]); }
        }
      }
    }
  }

  for (const [start, end] of ringClosures) {
    // The ring is the shortest path between the two ends of the closure bond
    // *without* using that bond — otherwise the answer is trivially the bond
    // itself and every ring comes back with two atoms.
    const path = shortestPathExcludingEdge(adjacency, start, end);
    if (path && path.length >= 3 && path.length <= 12) {
      const signature = [...path].sort((a, b) => a - b).join("-");
      if (!rings.some((ring) => [...ring].sort((a, b) => a - b).join("-") === signature)) rings.push(path);
    }
  }
  void bonds;
  // Smallest first, so a fused system yields its individual rings rather than
  // the perimeter macrocycle.
  return rings.sort((a, b) => a.length - b.length);
}

/** Cut edges of the molecular graph, by iterative Tarjan bridge-finding. */
function findBridges(atoms: Atom[], bonds: Bond[]): Set<number> {
  const bridges = new Set<number>();
  const discovery = new Array<number>(atoms.length).fill(-1);
  const low = new Array<number>(atoms.length).fill(0);
  let timer = 0;

  for (const root of atoms) {
    if (discovery[root.index] !== -1) continue;
    // Explicit stack: [atom, parent bond index, index of the next bond to visit]
    const stack: Array<[number, number, number]> = [[root.index, -1, 0]];
    discovery[root.index] = low[root.index] = timer++;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const [current, parentBond, cursor] = frame;
      if (cursor < atoms[current].bonds.length) {
        frame[2] += 1;
        const bondIndex = atoms[current].bonds[cursor];
        if (bondIndex === parentBond) continue;
        const bond = bonds[bondIndex];
        const next = bond.a === current ? bond.b : bond.a;
        if (discovery[next] === -1) {
          discovery[next] = low[next] = timer++;
          stack.push([next, bondIndex, 0]);
        } else {
          low[current] = Math.min(low[current], discovery[next]);
        }
      } else {
        stack.pop();
        if (stack.length) {
          const parent = stack[stack.length - 1][0];
          low[parent] = Math.min(low[parent], low[current]);
          if (low[current] > discovery[parent]) bridges.add(parentBond);
        }
      }
    }
  }
  return bridges;
}

function shortestPathExcludingEdge(adjacency: number[][], start: number, end: number): number[] | null {
  const parent = new Map<number, number>([[start, -1]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === end) break;
    for (const neighbour of adjacency[current]) {
      if (current === start && neighbour === end) continue;   // the closure bond
      if (parent.has(neighbour)) continue;
      parent.set(neighbour, current);
      queue.push(neighbour);
    }
  }
  if (!parent.has(end)) return null;
  const path: number[] = [];
  let cursor: number | undefined = end;
  while (cursor !== undefined && cursor !== -1) { path.push(cursor); cursor = parent.get(cursor); }
  return path;
}

function assignImplicitHydrogens(atoms: Atom[], bonds: Bond[]) {
  for (const atom of atoms) {
    if (atom.explicitH !== null) { atom.implicitH = atom.explicitH; continue; }
    const target = DEFAULT_VALENCE[atom.element];
    if (target === undefined) { atom.implicitH = 0; continue; }
    let used = 0;
    for (const bondIndex of atom.bonds) {
      const bond = bonds[bondIndex];
      used += bond.aromatic ? 1.5 : bond.order;
    }
    // Hypervalent sulfur and phosphorus: raise the valence when the bonding
    // demands it rather than reporting a negative hydrogen count.
    let adjusted = target + atom.charge;
    if (atom.element === "S" && used > 2) adjusted = used <= 4 ? 4 : 6;
    if (atom.element === "P" && used > 3) adjusted = 5;
    if (atom.element === "N" && used > 3 && atom.charge === 0) adjusted = Math.ceil(used);
    atom.implicitH = Math.max(0, Math.round(adjusted - Math.ceil(used - 1e-9)));
  }
}

/** Order-stable canonicalisation: not a true Morgan canonical SMILES, but a
 *  deterministic normalisation good enough to key the demo's caches on. */
function canonicalise(smiles: string): string {
  return smiles.replace(/\s+/g, "");
}

/* ── descriptors ─────────────────────────────────────────────────────────── */

export type Descriptors = {
  molecular_weight_da: number;
  exact_molecular_weight_da: number;
  logp: number;
  tpsa_a2: number;
  h_bond_acceptors: number;
  h_bond_donors: number;
  rotatable_bonds: number;
  ring_count: number;
  aromatic_ring_count: number;
  aliphatic_ring_count: number;
  fraction_csp3: number;
  heavy_atom_count: number;
  hetero_atom_count: number;
  formal_charge: number;
  qed: number;
  molar_refractivity: number;
  stereo_centers: number;
  n_o_count: number;
  halogen_count: number;
  lipinski_rule_of_five_pass: boolean;
  lipinski_violations: number;
  lipinski_failure_reasons: string[];
  veber_pass: boolean;
  veber_failure_reasons: string[];
  ghose_pass: boolean;
  egan_pass: boolean;
  muegge_pass: boolean;
  bbb_score: number;
  molecular_formula: string;
  source: string;
};

export function computeDescriptors(molecule: Molecule): Descriptors {
  const { atoms, bonds, rings } = molecule;
  let mass = 0;
  let exact = 0;
  let hetero = 0;
  let halogen = 0;
  let nO = 0;
  let sp3 = 0;
  let carbons = 0;
  let charge = 0;
  let hbd = 0;
  let hba = 0;
  let stereo = 0;
  const formulaCounts: Record<string, number> = {};

  for (const atom of atoms) {
    const element = atom.element;
    mass += (ATOMIC_MASS[element] ?? 12) + atom.implicitH * ATOMIC_MASS.H;
    exact += (EXACT_MASS[element] ?? 12) + atom.implicitH * EXACT_MASS.H;
    charge += atom.charge;
    formulaCounts[element] = (formulaCounts[element] ?? 0) + 1;
    formulaCounts.H = (formulaCounts.H ?? 0) + atom.implicitH;
    if (element !== "C" && element !== "H") hetero += 1;
    if (["F", "Cl", "Br", "I"].includes(element)) halogen += 1;
    if (element === "N" || element === "O") {
      nO += 1;
      // Acceptors: N and O, minus pyrrole-type N and amide N, per the Lipinski
      // convention of "N or O count" with the common refinement.
      const amide = element === "N" && atom.neighbours.some((n) =>
        atoms[n].element === "C" && atoms[n].bonds.some((b) => bonds[b].order === 2 && (atoms[bonds[b].a].element === "O" || atoms[bonds[b].b].element === "O")));
      if (!(atom.aromatic && atom.implicitH > 0) && !amide) hba += 1;
      if (atom.implicitH > 0) hbd += atom.implicitH;
    }
    if (element === "C") {
      carbons += 1;
      const maxOrder = Math.max(1, ...atom.bonds.map((b) => (bonds[b].aromatic ? 2 : bonds[b].order)));
      if (maxOrder === 1 && !atom.aromatic) sp3 += 1;
      const heavyDegree = atom.neighbours.length;
      if (heavyDegree === 4) {
        const labels = new Set(atom.neighbours.map((n) => `${atoms[n].element}${atoms[n].neighbours.length}`));
        if (labels.size === 4) stereo += 1;
      }
    }
  }

  const rotatable = bonds.filter((bond) => {
    if (bond.order !== 1 || bond.aromatic || bond.inRing) return false;
    const a = atoms[bond.a]; const b = atoms[bond.b];
    if (a.neighbours.length < 2 || b.neighbours.length < 2) return false;
    // Amide C–N bonds are not freely rotatable.
    const amide = (x: Atom, y: Atom) => x.element === "C" && y.element === "N"
      && x.bonds.some((i) => bonds[i].order === 2 && (atoms[bonds[i].a].element === "O" || atoms[bonds[i].b].element === "O"));
    if (amide(a, b) || amide(b, a)) return false;
    return true;
  }).length;

  const aromaticRings = rings.filter((ring) => ring.every((index) => atoms[index].aromatic)).length;
  const logp = crippenLogP(molecule);
  const tpsa = ertlTpsa(molecule);
  const mr = crippenMolarRefractivity(molecule);
  const heavy = atoms.length;

  const lipinskiFailures: string[] = [];
  if (mass > 500) lipinskiFailures.push("molecular weight > 500 Da");
  if (logp > 5) lipinskiFailures.push("logP > 5");
  if (hba > 10) lipinskiFailures.push("H-bond acceptors > 10");
  if (hbd > 5) lipinskiFailures.push("H-bond donors > 5");

  const veberFailures: string[] = [];
  if (tpsa > 140) veberFailures.push("topological polar surface area > 140 Å²");
  if (rotatable > 10) veberFailures.push("rotatable bonds > 10");

  const formula = ["C", "H", "N", "O", "S", "P", "F", "Cl", "Br", "I"]
    .concat(Object.keys(formulaCounts).filter((k) => !["C", "H", "N", "O", "S", "P", "F", "Cl", "Br", "I"].includes(k)))
    .filter((element) => formulaCounts[element])
    .map((element) => `${element}${formulaCounts[element] > 1 ? formulaCounts[element] : ""}`)
    .join("");

  const descriptors: Descriptors = {
    molecular_weight_da: r2(mass),
    exact_molecular_weight_da: r4(exact),
    logp: r3(logp),
    tpsa_a2: r2(tpsa),
    h_bond_acceptors: hba,
    h_bond_donors: hbd,
    rotatable_bonds: rotatable,
    ring_count: rings.length,
    aromatic_ring_count: aromaticRings,
    aliphatic_ring_count: rings.length - aromaticRings,
    fraction_csp3: carbons ? r3(sp3 / carbons) : 0,
    heavy_atom_count: heavy,
    hetero_atom_count: hetero,
    formal_charge: charge,
    qed: 0,
    molar_refractivity: r2(mr),
    stereo_centers: stereo,
    n_o_count: nO,
    halogen_count: halogen,
    lipinski_rule_of_five_pass: lipinskiFailures.length === 0,
    lipinski_violations: lipinskiFailures.length,
    lipinski_failure_reasons: lipinskiFailures,
    veber_pass: veberFailures.length === 0,
    veber_failure_reasons: veberFailures,
    ghose_pass: mass >= 160 && mass <= 480 && logp >= -0.4 && logp <= 5.6 && heavy >= 20 && heavy <= 70 && mr >= 40 && mr <= 130,
    egan_pass: tpsa <= 131.6 && logp <= 5.88,
    muegge_pass: mass >= 200 && mass <= 600 && logp >= -2 && logp <= 5 && tpsa <= 150 && rings.length <= 7 && hbd <= 5 && hba <= 10 && rotatable <= 15,
    bbb_score: r2(bbbScore(mass, logp, tpsa, hbd, charge)),
    molecular_formula: formula,
    source: "In-browser SMILES parser (demonstration substitute for the server RDKit readout)",
  };
  descriptors.qed = r3(bickertonQed(descriptors, countStructuralAlerts(molecule)));
  return descriptors;
}

function r2(value: number) { return Math.round(value * 100) / 100; }
function r3(value: number) { return Math.round(value * 1000) / 1000; }
function r4(value: number) { return Math.round(value * 10000) / 10000; }

/** Ertl-style topological polar surface area from N/O/S/P atom environments. */
function ertlTpsa(molecule: Molecule): number {
  const { atoms, bonds } = molecule;
  let total = 0;
  for (const atom of atoms) {
    if (!["N", "O", "S", "P"].includes(atom.element)) continue;
    const orders = atom.bonds.map((index) => (bonds[index].aromatic ? 1.5 : bonds[index].order));
    const single = orders.filter((order) => order === 1).length;
    const double = orders.filter((order) => order === 2).length;
    const triple = orders.filter((order) => order === 3).length;
    const hydrogens = atom.implicitH;
    const degree = atom.neighbours.length;

    if (atom.element === "N") {
      if (atom.charge > 0) { total += degree >= 4 ? 0.0 : 4.44; continue; }
      if (atom.aromatic) { total += hydrogens > 0 ? 15.79 : degree >= 3 ? 4.41 : 12.89; continue; }
      if (triple) { total += 23.79; continue; }
      if (double) { total += hydrogens > 0 ? 23.85 : 12.36; continue; }
      if (hydrogens === 2) { total += 26.02; continue; }
      if (hydrogens === 1) { total += 12.03; continue; }
      total += single >= 3 ? 3.24 : 12.03;
      continue;
    }
    if (atom.element === "O") {
      if (atom.charge < 0) { total += 23.06; continue; }
      if (atom.aromatic) { total += 13.14; continue; }
      if (double) { total += 17.07; continue; }
      total += hydrogens > 0 ? 20.23 : 9.23;
      continue;
    }
    if (atom.element === "S") {
      if (atom.aromatic) { total += 28.24; continue; }
      if (double >= 2) { total += 8.38; continue; }
      if (double === 1) { total += 32.09; continue; }
      total += hydrogens > 0 ? 38.80 : 25.30;
      continue;
    }
    if (atom.element === "P") {
      total += double ? 9.81 : 13.59;
    }
  }
  return total;
}

/** Wildman–Crippen-style additive logP. Atom contributions are the published
 *  class averages; this is an estimate, and is labelled as one wherever shown. */
function crippenLogP(molecule: Molecule): number {
  const { atoms, bonds } = molecule;
  let total = 0;
  for (const atom of atoms) {
    const neighbours = atom.neighbours.map((index) => atoms[index]);
    const heteroNeighbours = neighbours.filter((item) => item.element !== "C" && item.element !== "H").length;
    switch (atom.element) {
      case "C": {
        if (atom.aromatic) total += heteroNeighbours ? 0.1360 : 0.1551;
        else {
          const doubleBonded = atom.bonds.some((index) => bonds[index].order >= 2);
          if (doubleBonded) total += heteroNeighbours ? -0.0516 : 0.2955;
          else total += heteroNeighbours ? 0.0 : 0.1441;
        }
        total += atom.implicitH * (heteroNeighbours ? 0.1230 : 0.1230);
        break;
      }
      case "N": {
        const oxygenNeighbours = neighbours.filter((item) => item.element === "O").length;
        // A nitro nitrogen is not an amine: it is formally positive and
        // contributes nothing like an amine's desolvation penalty.
        const isNitro = oxygenNeighbours >= 2 && atom.bonds.some((index) => bonds[index].order === 2);
        // Amidine and guanidine nitrogens are delocalised across a C=N and
        // behave far less polar than an isolated aliphatic amine.
        const isAmidine = neighbours.some((carbon) => carbon.element === "C"
          && carbon.bonds.some((index) => bonds[index].order === 2
            && [bonds[index].a, bonds[index].b].some((side) => atoms[side].element === "N")));
        if (isNitro) total += -0.1;
        else if (atom.charge > 0) total += -1.950;
        else if (atom.aromatic) total += -0.3187;
        else if (atom.bonds.some((index) => bonds[index].order === 3)) total += -0.3239;
        else if (isAmidine) total += -0.3187;
        else if (atom.bonds.some((index) => bonds[index].order === 2)) total += -0.3810;
        else if (atom.implicitH === 2) total += -1.019;
        else if (atom.implicitH === 1) total += -0.7096;
        else total += -1.027;
        total += atom.implicitH * (isAmidine || atom.aromatic ? -0.1188 : -0.2677);
        break;
      }
      case "O": {
        if (atom.charge < 0) total += -1.326;
        else if (atom.aromatic) total += 0.1552;
        else if (atom.bonds.some((index) => bonds[index].order === 2)) total += -0.1526;
        else if (atom.implicitH > 0) total += -0.2893;
        else total += 0.1129;
        total += atom.implicitH * -0.2677;
        break;
      }
      case "S": total += atom.aromatic ? 0.6237 : 0.6482; break;
      case "P": total += 0.8612; break;
      case "F": total += 0.4202; break;
      case "Cl": total += 0.6895; break;
      case "Br": total += 0.8456; break;
      case "I": total += 0.8857; break;
      case "Se": total += 0.6607; break;
      case "B": total += -0.3080; break;
      case "Si": total += -0.0967; break;
      default: total += 0.0; break;
    }
  }
  return total;
}

function crippenMolarRefractivity(molecule: Molecule): number {
  const { atoms } = molecule;
  let total = 0;
  for (const atom of atoms) {
    const base: Record<string, number> = { C: 2.503, N: 2.262, O: 1.080, S: 7.591, P: 6.920, F: 1.108, Cl: 5.853, Br: 8.927, I: 14.02, B: 3.220, Si: 6.00, Se: 9.00 };
    total += base[atom.element] ?? 2.5;
    total += atom.implicitH * 1.057;
  }
  return total;
}

/** Bickerton (2012) quantitative estimate of drug-likeness, weighted variant. */
function bickertonQed(d: Descriptors, alerts: number): number {
  const parameters: Record<string, [number, number, number, number, number, number, number]> = {
    MW:     [2.817, 392.575, 290.749, 2.420, 49.223, 65.371, 104.981],
    ALOGP:  [3.172, 137.862, 2.535, 4.581, 0.823, 0.576, 131.318],
    HBA:    [2.948, 160.461, 3.615, 4.436, 0.290, 1.301, 148.776],
    HBD:    [1.619, 1010.051, 0.985, 0.714, 0.741, 0.109, 258.163],
    PSA:    [1.877, 125.223, 62.908, 87.834, 12.020, 28.514, 104.567],
    ROTB:   [0.010, 272.412, 2.558, 1.565, 1.271, 2.758, 105.442],
    AROM:   [3.217, 957.737, 2.275, 0.000, 1.317, 0.375, 312.033],
    ALERTS: [0.010, 1199.094, -0.09, 0.000, 0.185, 0.875, 417.725],
  };
  const weights: Record<string, number> = { MW: 0.66, ALOGP: 0.46, HBA: 0.05, HBD: 0.61, PSA: 0.06, ROTB: 0.65, AROM: 0.48, ALERTS: 0.95 };
  const values: Record<string, number> = {
    MW: d.molecular_weight_da, ALOGP: d.logp, HBA: d.h_bond_acceptors, HBD: d.h_bond_donors,
    PSA: d.tpsa_a2, ROTB: d.rotatable_bonds, AROM: d.aromatic_ring_count, ALERTS: alerts,
  };
  function ads(x: number, [a, b, c, dd, e, f, dmax]: [number, number, number, number, number, number, number]) {
    const left = 1 / (1 + Math.exp(-(x - c + dd / 2) / e));
    const right = 1 / (1 + Math.exp(-(x - c - dd / 2) / f));
    return (a + b * left * (1 - right)) / dmax;
  }
  let numerator = 0; let denominator = 0;
  for (const key of Object.keys(parameters)) {
    const desirability = Math.min(1, Math.max(1e-6, ads(values[key], parameters[key])));
    numerator += weights[key] * Math.log(desirability);
    denominator += weights[key];
  }
  return Math.exp(numerator / denominator);
}

/** A CNS multiparameter-optimisation-style composite (Wager 2010, simplified). */
function bbbScore(mw: number, logp: number, tpsa: number, hbd: number, charge: number): number {
  const ramp = (value: number, best: number, worst: number) => {
    if (best < worst) return value <= best ? 1 : value >= worst ? 0 : (worst - value) / (worst - best);
    return value >= best ? 1 : value <= worst ? 0 : (value - worst) / (best - worst);
  };
  return (
    ramp(mw, 360, 500) + ramp(logp, 3, 5) + ramp(tpsa, 40, 90) + ramp(hbd, 0.5, 3.5) + (charge === 0 ? 1 : 0.4)
  );
}

/* ── structural alerts (PAINS / Brenk-style graph detectors) ─────────────── */

export type StructuralAlert = {
  set: "PAINS" | "Brenk" | "NIH";
  name: string;
  description: string;
  severity: "high" | "moderate";
};

export function detectStructuralAlerts(molecule: Molecule): StructuralAlert[] {
  const { atoms, bonds, rings } = molecule;
  const alerts: StructuralAlert[] = [];
  const has = (name: string) => alerts.some((alert) => alert.name === name);
  const add = (alert: StructuralAlert) => { if (!has(alert.name)) alerts.push(alert); };

  const isAromaticRing = (ring: number[]) => ring.every((index) => atoms[index].aromatic);
  const neighbourElements = (index: number) => atoms[index].neighbours.map((n) => atoms[n].element);

  // Catechol — two adjacent phenolic hydroxyls on an aromatic ring.
  for (const ring of rings) {
    if (!isAromaticRing(ring)) continue;
    const hydroxylPositions = ring.filter((index) =>
      atoms[index].neighbours.some((n) => atoms[n].element === "O" && atoms[n].implicitH > 0 && !atoms[n].inRing));
    for (let i = 0; i < hydroxylPositions.length; i += 1) {
      for (let j = i + 1; j < hydroxylPositions.length; j += 1) {
        if (atoms[hydroxylPositions[i]].neighbours.includes(hydroxylPositions[j])) {
          add({ set: "PAINS", name: "Catechol A", description: "Ortho-dihydroxybenzene; redox-cycling and metal-chelating frequent hitter.", severity: "high" });
        }
      }
    }
  }

  // Quinone — a fully carbocyclic six-membered ring carrying two exocyclic
  // carbonyls. The carbocycle requirement is what separates a real quinone from
  // a xanthine or a pyrimidinedione, whose carbonyls are amide carbonyls and
  // carry none of the redox reactivity.
  for (const ring of rings) {
    if (ring.length !== 6) continue;
    if (!ring.every((index) => atoms[index].element === "C")) continue;
    const exocyclicCarbonyls = ring.filter((index) =>
      atoms[index].bonds.some((b) => bonds[b].order === 2
        && [bonds[b].a, bonds[b].b].some((side) => atoms[side].element === "O" && !atoms[side].inRing)));
    if (exocyclicCarbonyls.length >= 2) {
      add({ set: "PAINS", name: "Quinone A", description: "Quinone core; redox cycling, covalent reactivity and assay interference.", severity: "high" });
    }
  }

  for (const atom of atoms) {
    const elements = neighbourElements(atom.index);

    // Nitro group
    if (atom.element === "N" && atom.neighbours.filter((n) => atoms[n].element === "O").length >= 2
      && atom.bonds.some((b) => bonds[b].order === 2)) {
      add({ set: "Brenk", name: "Nitro group", description: "Nitro substituent; mutagenicity and reduction-driven toxicity liability.", severity: "high" });
    }
    // Aldehyde
    if (atom.element === "C" && atom.implicitH === 1 && atom.bonds.some((b) => bonds[b].order === 2
      && [bonds[b].a, bonds[b].b].some((side) => atoms[side].element === "O")) && !atom.aromatic) {
      add({ set: "Brenk", name: "Aldehyde", description: "Electrophilic aldehyde; non-specific covalent protein modification.", severity: "moderate" });
    }
    // Michael acceptor: C=C conjugated to C=O
    if (atom.element === "C" && atom.bonds.some((b) => bonds[b].order === 2 && atoms[bonds[b].a].element === "C" && atoms[bonds[b].b].element === "C" && !bonds[b].aromatic)) {
      const conjugated = atom.neighbours.some((n) => atoms[n].element === "C"
        && atoms[n].bonds.some((b) => bonds[b].order === 2 && [bonds[b].a, bonds[b].b].some((side) => atoms[side].element === "O")));
      if (conjugated) add({ set: "Brenk", name: "Michael acceptor", description: "α,β-unsaturated carbonyl; covalent addition of biological nucleophiles.", severity: "high" });
    }
    // Azo
    if (atom.element === "N" && atom.bonds.some((b) => bonds[b].order === 2
      && atoms[bonds[b].a].element === "N" && atoms[bonds[b].b].element === "N")) {
      add({ set: "PAINS", name: "Azo group", description: "Azo linkage; reductive cleavage to aromatic amines and strong absorbance interference.", severity: "high" });
    }
    // Hydrazine / hydrazone
    if (atom.element === "N" && elements.filter((element) => element === "N").length >= 1
      && atom.neighbours.some((n) => atoms[n].element === "N" && atoms[n].implicitH > 0) && atom.implicitH > 0) {
      add({ set: "Brenk", name: "Hydrazine", description: "N–N single bond bearing hydrogens; genotoxicity and metabolic activation risk.", severity: "moderate" });
    }
    // Thiol
    if (atom.element === "S" && atom.implicitH > 0 && atom.neighbours.length === 1) {
      add({ set: "Brenk", name: "Thiol", description: "Free thiol; disulfide scrambling and metal chelation in biochemical assays.", severity: "moderate" });
    }
    // Epoxide / aziridine
    if (atom.inRing && rings.some((ring) => ring.length === 3 && ring.includes(atom.index)
      && ring.some((index) => atoms[index].element === "O" || atoms[index].element === "N"))) {
      add({ set: "Brenk", name: "Three-membered heterocycle", description: "Epoxide or aziridine; strained electrophile with alkylating potential.", severity: "high" });
    }
    // Isocyanate / isothiocyanate
    if (atom.element === "N" && atom.bonds.filter((b) => bonds[b].order === 2).length >= 1
      && atom.neighbours.some((n) => atoms[n].element === "C"
        && atoms[n].bonds.filter((b) => bonds[b].order === 2 && [bonds[b].a, bonds[b].b].some((side) => ["O", "S"].includes(atoms[side].element))).length >= 1
        && atoms[n].neighbours.length === 2)) {
      add({ set: "Brenk", name: "Isocyanate / isothiocyanate", description: "Highly electrophilic heterocumulene; indiscriminate acylation.", severity: "high" });
    }
    // Peroxide
    if (atom.element === "O" && atom.neighbours.some((n) => atoms[n].element === "O")) {
      add({ set: "Brenk", name: "Peroxide", description: "O–O bond; radical generation and chemical instability.", severity: "high" });
    }
    // Aromatic nitrogen–nitrogen–nitrogen (azide/triazine motif)
    if (atom.element === "N" && atom.neighbours.filter((n) => atoms[n].element === "N").length >= 2 && !atom.aromatic) {
      add({ set: "Brenk", name: "Polynitrogen chain", description: "Three contiguous nitrogens; azide-like instability and energetic hazard.", severity: "moderate" });
    }
    // Aniline
    if (atom.element === "N" && atom.implicitH >= 1 && atom.neighbours.some((n) => atoms[n].aromatic) && !atom.aromatic
      && !atom.neighbours.some((n) => atoms[n].element === "C" && atoms[n].bonds.some((b) => bonds[b].order === 2 && [bonds[b].a, bonds[b].b].some((side) => atoms[side].element === "O")))) {
      add({ set: "Brenk", name: "Aniline", description: "Primary/secondary aromatic amine; bioactivation to reactive nitrenium species.", severity: "moderate" });
    }
    // Sulfonyl halide / acyl halide
    if (["Cl", "Br", "F", "I"].includes(atom.element) && atom.neighbours.some((n) =>
      atoms[n].bonds.some((b) => bonds[b].order === 2 && [bonds[b].a, bonds[b].b].some((side) => atoms[side].element === "O")))) {
      add({ set: "Brenk", name: "Acyl / sulfonyl halide", description: "Acylating agent; hydrolytically unstable and non-selectively reactive.", severity: "high" });
    }
  }

  // Polyhalogenated aromatic ring
  for (const ring of rings) {
    if (!isAromaticRing(ring)) continue;
    const halogens = ring.reduce((count, index) =>
      count + atoms[index].neighbours.filter((n) => ["Cl", "Br", "I"].includes(atoms[n].element)).length, 0);
    if (halogens >= 3) {
      add({ set: "Brenk", name: "Polyhalogenated aromatic ring", description: "Three or more heavy halogens on one ring; persistence and non-specific binding.", severity: "moderate" });
    }
  }

  // Rhodanine-like: five-membered ring with S and exocyclic C=S/C=O
  for (const ring of rings) {
    if (ring.length !== 5) continue;
    const hasSulfur = ring.some((index) => atoms[index].element === "S");
    const hasNitrogen = ring.some((index) => atoms[index].element === "N");
    const exocyclicThione = ring.some((index) => atoms[index].bonds.some((b) => bonds[b].order === 2
      && [bonds[b].a, bonds[b].b].some((side) => atoms[side].element === "S" && !atoms[side].inRing)));
    if (hasSulfur && hasNitrogen && exocyclicThione) {
      add({ set: "PAINS", name: "Rhodanine", description: "Rhodanine scaffold; the most frequently reported PAINS class in screening literature.", severity: "high" });
    }
  }

  return alerts;
}

export function countStructuralAlerts(molecule: Molecule): number {
  return detectStructuralAlerts(molecule).length;
}

/* ── circular fingerprint and Tanimoto ───────────────────────────────────── */

/** Morgan-style circular fingerprint, radius 2, folded into 2048 bits. */
export function morganFingerprint(molecule: Molecule, radius = 2, bits = 2048): Set<number> {
  const { atoms, bonds } = molecule;
  let identifiers = atoms.map((atom) => hash(`${atom.element}|${atom.aromatic ? "a" : "A"}|${atom.neighbours.length}|${atom.implicitH}|${atom.charge}`));
  const fingerprint = new Set<number>(identifiers.map((value) => value % bits));
  for (let layer = 0; layer < radius; layer += 1) {
    const next = atoms.map((atom) => {
      const environment = atom.bonds
        .map((bondIndex) => {
          const bond = bonds[bondIndex];
          const other = bond.a === atom.index ? bond.b : bond.a;
          return `${bond.aromatic ? 1.5 : bond.order}:${identifiers[other]}`;
        })
        .sort()
        .join(",");
      return hash(`${identifiers[atom.index]}|${environment}`);
    });
    identifiers = next;
    identifiers.forEach((value) => fingerprint.add(value % bits));
  }
  return fingerprint;
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result >>> 0;
}

export function tanimoto(a: Set<number>, b: Set<number>): number {
  let shared = 0;
  a.forEach((value) => { if (b.has(value)) shared += 1; });
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}

/* ── 2D depiction coordinates ────────────────────────────────────────────── */

/**
 * Force-directed 2D layout with ring templating.
 *
 * Rings are seeded as regular polygons, chains are relaxed against bond-length
 * springs, 1–3 repulsion (which is what preserves sensible bond angles) and a
 * weak global repulsion. It is a depiction aid, not a conformer.
 */
function layout2d(atoms: Atom[], bonds: Bond[], rings: number[][]) {
  if (!atoms.length) return;
  const count = atoms.length;
  const placed = new Set<number>();

  // Seed rings as regular polygons, largest first, sharing placed atoms.
  const orderedRings = [...rings].sort((a, b) => b.length - a.length);
  let ringOffsetX = 0;
  for (const ring of orderedRings) {
    const anchor = ring.find((index) => placed.has(index));
    const radius = 1 / (2 * Math.sin(Math.PI / ring.length));
    let centreX = ringOffsetX; let centreY = 0; let startAngle = 0;
    if (anchor !== undefined) {
      centreX = atoms[anchor].x + radius; centreY = atoms[anchor].y;
      startAngle = Math.PI;
    } else {
      ringOffsetX += radius * 2.6;
    }
    ring.forEach((atomIndex, position) => {
      if (placed.has(atomIndex)) return;
      const angle = startAngle + (2 * Math.PI * position) / ring.length;
      atoms[atomIndex].x = centreX + radius * Math.cos(angle);
      atoms[atomIndex].y = centreY + radius * Math.sin(angle);
      placed.add(atomIndex);
    });
  }

  // Seed remaining atoms by walking outward from a placed neighbour.
  for (let pass = 0; pass < count; pass += 1) {
    for (const atom of atoms) {
      if (placed.has(atom.index)) continue;
      const anchor = atom.neighbours.find((index) => placed.has(index));
      if (anchor === undefined) continue;
      const siblings = atoms[anchor].neighbours.filter((index) => placed.has(index)).length;
      const angle = (siblings * 2.2) + atom.index * 0.9;
      atoms[atom.index].x = atoms[anchor].x + Math.cos(angle);
      atoms[atom.index].y = atoms[anchor].y + Math.sin(angle);
      placed.add(atom.index);
    }
  }
  atoms.forEach((atom, index) => {
    if (placed.has(atom.index)) return;
    atom.x = (index % 6) * 1.2; atom.y = Math.floor(index / 6) * 1.2;
    placed.add(atom.index);
  });

  // Relax.
  const pairs13: Array<[number, number]> = [];
  for (const atom of atoms) {
    for (let i = 0; i < atom.neighbours.length; i += 1) {
      for (let j = i + 1; j < atom.neighbours.length; j += 1) {
        pairs13.push([atom.neighbours[i], atom.neighbours[j]]);
      }
    }
  }

  for (let iteration = 0; iteration < 260; iteration += 1) {
    const cooling = 1 - iteration / 300;
    const forceX = new Array(count).fill(0);
    const forceY = new Array(count).fill(0);

    for (const bond of bonds) {
      const dx = atoms[bond.b].x - atoms[bond.a].x;
      const dy = atoms[bond.b].y - atoms[bond.a].y;
      const distance = Math.hypot(dx, dy) || 1e-6;
      const push = (distance - 1) * 0.42;
      forceX[bond.a] += (dx / distance) * push; forceY[bond.a] += (dy / distance) * push;
      forceX[bond.b] -= (dx / distance) * push; forceY[bond.b] -= (dy / distance) * push;
    }

    for (const [a, b] of pairs13) {
      const dx = atoms[b].x - atoms[a].x;
      const dy = atoms[b].y - atoms[a].y;
      const distance = Math.hypot(dx, dy) || 1e-6;
      const target = 1.68;
      const push = (distance - target) * 0.22;
      forceX[a] += (dx / distance) * push; forceY[a] += (dy / distance) * push;
      forceX[b] -= (dx / distance) * push; forceY[b] -= (dy / distance) * push;
    }

    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        if (atoms[a].neighbours.includes(b)) continue;
        const dx = atoms[b].x - atoms[a].x;
        const dy = atoms[b].y - atoms[a].y;
        const distanceSquared = dx * dx + dy * dy || 1e-6;
        if (distanceSquared > 9) continue;
        const distance = Math.sqrt(distanceSquared);
        const repulsion = 0.32 / distanceSquared;
        forceX[a] -= (dx / distance) * repulsion; forceY[a] -= (dy / distance) * repulsion;
        forceX[b] += (dx / distance) * repulsion; forceY[b] += (dy / distance) * repulsion;
      }
    }

    // Ring atoms are pulled back toward their ring centroid circle so fused
    // systems do not collapse under the repulsion term.
    for (const ring of rings) {
      const centreX = ring.reduce((total, index) => total + atoms[index].x, 0) / ring.length;
      const centreY = ring.reduce((total, index) => total + atoms[index].y, 0) / ring.length;
      const radius = 1 / (2 * Math.sin(Math.PI / ring.length));
      for (const index of ring) {
        const dx = atoms[index].x - centreX;
        const dy = atoms[index].y - centreY;
        const distance = Math.hypot(dx, dy) || 1e-6;
        const push = (radius - distance) * 0.30;
        forceX[index] += (dx / distance) * push; forceY[index] += (dy / distance) * push;
      }
    }

    for (let index = 0; index < count; index += 1) {
      atoms[index].x += Math.max(-0.3, Math.min(0.3, forceX[index])) * cooling;
      atoms[index].y += Math.max(-0.3, Math.min(0.3, forceY[index])) * cooling;
    }
  }
}

/* ── identity helpers ────────────────────────────────────────────────────── */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A stable InChIKey-shaped identifier. It is a demonstration surrogate, not a
 *  real InChIKey, and the interface labels it that way. */
export function pseudoInchiKey(smiles: string): string {
  const seed = hash(smiles);
  const block = (length: number, salt: number) => {
    // The XOR of two 32-bit values is signed in JavaScript; force it back to an
    // unsigned integer or the modulo below indexes the alphabet negatively.
    let value = (hash(`${smiles}:${salt}`) ^ seed) >>> 0;
    let out = "";
    for (let index = 0; index < length; index += 1) {
      out += BASE32[value % 32];
      value = (Math.floor(value / 32) + 0x9e3779b9) >>> 0;
    }
    return out;
  };
  return `${block(14, 1)}-${block(10, 2)}-N`;
}

/** Reference set for the applicability domain — a small approved-drug panel. */
export const REFERENCE_DRUGS: Array<{ name: string; smiles: string }> = [
  { name: "Aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { name: "Ibuprofen", smiles: "CC(C)Cc1ccc(cc1)C(C)C(=O)O" },
  { name: "Paracetamol", smiles: "CC(=O)Nc1ccc(O)cc1" },
  { name: "Imatinib", smiles: "Cc1ccc(cc1Nc1nccc(n1)-c1cccnc1)NC(=O)c1ccc(CN2CCN(C)CC2)cc1" },
  { name: "Atorvastatin", smiles: "CC(C)c1c(C(=O)Nc2ccccc2)c(-c2ccccc2)c(-c2ccc(F)cc2)n1CCC(O)CC(O)CC(=O)O" },
  { name: "Metformin", smiles: "CN(C)C(=N)NC(=N)N" },
  { name: "Warfarin", smiles: "CC(=O)CC(c1ccccc1)c1c(O)c2ccccc2oc1=O" },
  { name: "Diazepam", smiles: "CN1c2ccc(Cl)cc2C(=NCC1=O)c1ccccc1" },
  { name: "Caffeine", smiles: "Cn1cnc2c1c(=O)n(C)c(=O)n2C" },
  { name: "Losartan", smiles: "CCCCc1nc(Cl)c(CO)n1Cc1ccc(cc1)-c1ccccc1-c1nnn[nH]1" },
  { name: "Sildenafil", smiles: "CCCc1nn(C)c2c1nc([nH]c2=O)-c1cc(ccc1OCC)S(=O)(=O)N1CCN(C)CC1" },
  { name: "Gefitinib", smiles: "COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1" },
  { name: "Omeprazole", smiles: "COc1ccc2[nH]c(S(=O)Cc3ncc(C)c(OC)c3C)nc2c1" },
  { name: "Simvastatin", smiles: "CCC(C)(C)C(=O)OC1CC(C)C=C2C=CC(C)C(CCC3CC(O)CC(=O)O3)C12" },
  { name: "Ciprofloxacin", smiles: "OC(=O)c1cn(C2CC2)c2cc(N3CCNCC3)c(F)cc2c1=O" },
  { name: "Morphine", smiles: "CN1CCC23c4c5ccc(O)c4OC2C(O)C=CC3C1C5" },
];
