/**
 * SMILES serialisation and graph editing.
 *
 * `chem.ts` parses SMILES into a graph but never wrote one back, which meant a
 * structure could be read but not changed. Everything here exists so an edit can
 * round-trip: graph → SMILES → `parseSmiles` → descriptors, with the app's own
 * chemistry module remaining the single source of truth for every number. No
 * external cheminformatics library is involved, and none of these functions
 * computes a property — they only rewrite structure.
 */
import { parseSmiles, type Atom, type Bond, type Molecule } from "./chem";

/** Elements writable without brackets when their valence is the default. */
const ORGANIC = new Set(["B", "C", "N", "O", "P", "S", "F", "Cl", "Br", "I"]);

function atomToken(atom: Atom): string {
  const symbol = atom.aromatic ? atom.element.toLowerCase() : atom.element;
  const bracket =
    atom.isotope !== null || atom.charge !== 0 || atom.explicitH !== null || !ORGANIC.has(atom.element);
  if (!bracket) return symbol;

  let out = "[";
  if (atom.isotope !== null) out += String(atom.isotope);
  out += symbol;
  const hydrogens = atom.explicitH ?? 0;
  if (hydrogens === 1) out += "H";
  else if (hydrogens > 1) out += `H${hydrogens}`;
  if (atom.charge > 0) out += atom.charge === 1 ? "+" : `+${atom.charge}`;
  if (atom.charge < 0) out += atom.charge === -1 ? "-" : `-${Math.abs(atom.charge)}`;
  return `${out}]`;
}

function bondToken(bond: Bond, from: Atom, to: Atom): string {
  if (bond.aromatic) return "";
  if (bond.order === 2) return "=";
  if (bond.order === 3) return "#";
  /* A single bond between two aromatic atoms has to be explicit, or re-parsing
     reads it as part of the ring system. */
  if (from.aromatic && to.aromatic) return "-";
  return "";
}

function ringLabel(digit: number): string {
  return digit < 10 ? String(digit) : `%${digit}`;
}

/**
 * Write a molecular graph as SMILES.
 *
 * A depth-first spanning tree gives the backbone; every non-tree bond becomes a
 * ring closure. Closure digits are drawn from a pool and returned once both ends
 * are written, so a molecule with many rings does not run past the single-digit
 * range unnecessarily.
 */
export function writeSmiles(molecule: Molecule): string {
  const { atoms, bonds } = molecule;
  if (!atoms.length) return "";

  const bondBetween = new Map<string, Bond>();
  for (const bond of bonds) {
    bondBetween.set(`${bond.a}:${bond.b}`, bond);
    bondBetween.set(`${bond.b}:${bond.a}`, bond);
  }
  const edge = (a: number, b: number) => bondBetween.get(`${a}:${b}`);

  const seen = new Array(atoms.length).fill(false);
  const treeBond = new Set<number>();
  const closures: number[] = [];

  /* Pass one splits the bonds into a spanning tree and the ring closures left
     over. An atom is marked the moment it is queued, not when it is dequeued:
     marking on dequeue lets both bonds of a ring be taken as tree edges, and
     then no closure is ever recorded and every ring silently opens. */
  const closureSet = new Set<number>();
  for (let start = 0; start < atoms.length; start += 1) {
    if (seen[start]) continue;
    seen[start] = true;
    const stack: number[] = [start];
    while (stack.length) {
      const atom = stack.pop()!;
      for (const neighbour of atoms[atom].neighbours) {
        const bond = edge(atom, neighbour);
        if (!bond || treeBond.has(bond.index) || closureSet.has(bond.index)) continue;
        if (seen[neighbour]) {
          closureSet.add(bond.index);
          closures.push(bond.index);
        } else {
          seen[neighbour] = true;
          treeBond.add(bond.index);
          stack.push(neighbour);
        }
      }
    }
  }

  const digitOf = new Map<number, number>();
  const openAt = new Map<number, number[]>();
  for (const index of closures) {
    const bond = bonds[index];
    for (const end of [bond.a, bond.b]) {
      if (!openAt.has(end)) openAt.set(end, []);
      openAt.get(end)!.push(index);
    }
  }

  const pool: number[] = [];
  let nextDigit = 1;
  const takeDigit = () => (pool.length ? pool.shift()! : nextDigit++);
  const written = new Set<number>();

  const emitted = new Array(atoms.length).fill(false);
  const fragments: string[] = [];

  /* Pass two writes the string. Recursion depth is bounded by the atom count,
     which for anything this workspace accepts is small. */
  function walk(atom: number, parent: number): string {
    emitted[atom] = true;
    let out = atomToken(atoms[atom]);

    for (const index of openAt.get(atom) ?? []) {
      const bond = bonds[index];
      if (written.has(index)) {
        out += ringLabel(digitOf.get(index)!);
        pool.push(digitOf.get(index)!);
      } else {
        const digit = takeDigit();
        digitOf.set(index, digit);
        written.add(index);
        const other = bond.a === atom ? bond.b : bond.a;
        out += bondToken(bond, atoms[atom], atoms[other]) + ringLabel(digit);
      }
    }

    const children: string[] = [];
    for (const neighbour of atoms[atom].neighbours) {
      if (neighbour === parent || emitted[neighbour]) continue;
      const bond = edge(atom, neighbour);
      if (!bond || !treeBond.has(bond.index)) continue;
      children.push(bondToken(bond, atoms[atom], atoms[neighbour]) + walk(neighbour, atom));
    }

    for (let i = 0; i < children.length; i += 1) {
      out += i === children.length - 1 ? children[i] : `(${children[i]})`;
    }
    return out;
  }

  for (let start = 0; start < atoms.length; start += 1) {
    if (!emitted[start]) fragments.push(walk(start, -1));
  }
  return fragments.join(".");
}

/* ── structural edits ─────────────────────────────────────────────────────
   Each returns a SMILES string rather than a graph, so the result is re-parsed
   by `chem.ts` and every downstream number comes from the same path a typed
   structure would take. An edit that cannot be expressed returns null. */

function clone(molecule: Molecule): Molecule {
  return JSON.parse(JSON.stringify(molecule)) as Molecule;
}

function rebuild(molecule: Molecule): string | null {
  const smiles = writeSmiles(molecule);
  if (!smiles) return null;
  const check = parseSmiles(smiles);
  return check.valid ? smiles : null;
}

/** Change one atom's element, keeping its bonds. */
export function setElement(molecule: Molecule, atomIndex: number, element: string): string | null {
  const next = clone(molecule);
  const atom = next.atoms[atomIndex];
  if (!atom) return null;
  atom.element = element;
  /* An aromatic ring only tolerates the elements that can carry the ring's
     electrons; anything else leaves the ring and is written aliphatic. */
  if (atom.aromatic && !["C", "N", "O", "S", "P"].includes(element)) atom.aromatic = false;
  atom.explicitH = null;
  atom.charge = 0;
  return rebuild(next);
}

/** Cycle a bond between single, double and triple. */
export function setBondOrder(molecule: Molecule, bondIndex: number, order: number): string | null {
  const next = clone(molecule);
  const bond = next.bonds[bondIndex];
  if (!bond || bond.aromatic) return null;
  bond.order = order;
  return rebuild(next);
}

/** Attach a new terminal atom to an existing one. */
export function addAtom(molecule: Molecule, atomIndex: number, element: string): string | null {
  const next = clone(molecule);
  const host = next.atoms[atomIndex];
  if (!host) return null;
  const index = next.atoms.length;
  next.atoms.push({
    index, element, aromatic: false, charge: 0, isotope: null, explicitH: null,
    implicitH: 0, bonds: [], neighbours: [], ringMembership: [], inRing: false,
    x: host.x + 1, y: host.y + 1,
  });
  const bondIndex = next.bonds.length;
  next.bonds.push({ index: bondIndex, a: atomIndex, b: index, order: 1, aromatic: false, inRing: false, stereo: "" });
  host.neighbours.push(index);
  host.bonds.push(bondIndex);
  next.atoms[index].neighbours.push(atomIndex);
  next.atoms[index].bonds.push(bondIndex);
  return rebuild(next);
}

/** Remove a terminal atom. Interior atoms are refused — deleting one would
    fragment the structure into pieces the caller did not ask for. */
export function deleteAtom(molecule: Molecule, atomIndex: number): string | null {
  const atom = molecule.atoms[atomIndex];
  if (!atom || atom.neighbours.length > 1 || molecule.atoms.length < 2) return null;

  const keep = molecule.atoms.filter((entry) => entry.index !== atomIndex);
  const remap = new Map<number, number>();
  keep.forEach((entry, position) => remap.set(entry.index, position));

  const next = clone(molecule);
  next.atoms = keep.map((entry, position) => ({
    ...entry, index: position, bonds: [], neighbours: [], ringMembership: [],
  }));
  next.bonds = [];
  for (const bond of molecule.bonds) {
    if (bond.a === atomIndex || bond.b === atomIndex) continue;
    const a = remap.get(bond.a)!;
    const b = remap.get(bond.b)!;
    const index = next.bonds.length;
    next.bonds.push({ ...bond, index, a, b });
    next.atoms[a].neighbours.push(b);
    next.atoms[b].neighbours.push(a);
    next.atoms[a].bonds.push(index);
    next.atoms[b].bonds.push(index);
  }
  return rebuild(next);
}
