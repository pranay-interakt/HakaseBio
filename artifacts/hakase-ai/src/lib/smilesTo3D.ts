import { getRDKitInstance } from "./chemistry";

export interface Atom3D {
  id: number;
  symbol: string;
  x: number;
  y: number;
  z: number;
}

export interface Bond3D {
  from: number;
  to: number;
  order: number;
}

export interface Mol3DData {
  atoms: Atom3D[];
  bonds: Bond3D[];
  formula: string;
  heavyAtomCount: number;
}

function parseMolBlock(molblock: string): Mol3DData | null {
  try {
    const lines = molblock.split("\n");
    if (lines.length < 4) return null;

    const countsLine = lines[3];
    const natoms = parseInt(countsLine.substring(0, 3).trim(), 10);
    const nbonds = parseInt(countsLine.substring(3, 6).trim(), 10);
    if (isNaN(natoms) || isNaN(nbonds) || natoms === 0) return null;

    const atoms: Atom3D[] = [];
    for (let i = 0; i < natoms; i++) {
      const line = lines[4 + i] ?? "";
      const x = parseFloat(line.substring(0, 10).trim());
      const y = parseFloat(line.substring(10, 20).trim());
      const sym = line.substring(31, 34).trim() || "C";
      if (isNaN(x) || isNaN(y)) continue;
      atoms.push({ id: i, symbol: sym, x, y, z: 0 });
    }

    const bonds: Bond3D[] = [];
    for (let i = 0; i < nbonds; i++) {
      const line = lines[4 + natoms + i] ?? "";
      const from = parseInt(line.substring(0, 3).trim(), 10) - 1;
      const to   = parseInt(line.substring(3, 6).trim(), 10) - 1;
      const type = parseInt(line.substring(6, 9).trim(), 10);
      const order = type === 4 ? 1 : Math.min(type, 3);
      if (isNaN(from) || isNaN(to) || from < 0 || to < 0) continue;
      bonds.push({ from, to, order });
    }

    if (atoms.length === 0) return null;

    const xs = atoms.map(a => a.x);
    const ys = atoms.map(a => a.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const extentX = maxX - minX || 1;
    const extentY = maxY - minY || 1;
    const extent = Math.max(extentX, extentY);
    const targetSize = 240;
    const scale = targetSize / extent;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const adj: Set<number>[] = atoms.map(() => new Set<number>());
    bonds.forEach(b => { adj[b.from]?.add(b.to); adj[b.to]?.add(b.from); });

    const inRing = new Set<number>();
    const visited = new Array(atoms.length).fill(false);
    const dfs = (v: number, parent: number, path: number[]) => {
      visited[v] = true;
      path.push(v);
      for (const nb of adj[v]) {
        if (nb === parent) continue;
        if (visited[nb]) {
          const ringStart = path.indexOf(nb);
          if (ringStart >= 0) path.slice(ringStart).forEach(n => inRing.add(n));
        } else {
          dfs(nb, v, path);
        }
      }
      path.pop();
    };
    if (atoms.length > 0) dfs(0, -1, []);

    const scaledAtoms: Atom3D[] = atoms.map((a, idx) => {
      const sx = (a.x - cx) * scale;
      const sy = -(a.y - cy) * scale;
      let z = 0;
      if (!inRing.has(idx)) {
        z = Math.sin(idx * 1.618033 * Math.PI) * targetSize * 0.10;
      } else {
        z = Math.sin(idx * 0.5) * targetSize * 0.015;
      }
      return { id: a.id, symbol: a.symbol, x: sx, y: sy, z };
    });

    const heavy = scaledAtoms.filter(a => a.symbol !== "H");
    const elementCounts: Record<string, number> = {};
    heavy.forEach(a => { elementCounts[a.symbol] = (elementCounts[a.symbol] || 0) + 1; });
    const hAtoms = atoms.filter(a => a.symbol === "H").length;
    let formula = "";
    if (elementCounts["C"]) formula += `C${elementCounts["C"] > 1 ? elementCounts["C"] : ""}`;
    const hTotal = (elementCounts["H"] || 0) + hAtoms;
    if (hTotal > 0) formula += `H${hTotal > 1 ? hTotal : ""}`;
    ["N", "O", "S", "P", "F", "Cl", "Br", "I"].forEach(el => {
      if (elementCounts[el]) formula += `${el}${elementCounts[el] > 1 ? elementCounts[el] : ""}`;
    });

    return { atoms: scaledAtoms, bonds, formula, heavyAtomCount: heavy.length };
  } catch {
    return null;
  }
}

export function smilesTo3D(smiles: string): Mol3DData | null {
  const rdkit = getRDKitInstance();
  if (!rdkit || !smiles.trim()) return null;

  let mol: any = null;
  try {
    mol = rdkit.get_mol(smiles.trim());
    if (!mol || !mol.is_valid()) return null;
    try { mol.set_new_coords(); } catch { /* not available in all builds */ }
    const molblock = mol.get_molblock();
    return parseMolBlock(molblock);
  } catch {
    return null;
  } finally {
    try { mol?.delete?.(); } catch { /* ignore */ }
  }
}
