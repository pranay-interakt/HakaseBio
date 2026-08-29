/**
 * 2D structure depiction.
 *
 * Renders the parsed molecular graph with the coordinates the chemistry module
 * generated. Double and triple bonds are drawn as parallel lines, aromatic
 * rings carry an inner circle, and every non-carbon heavy atom is labelled with
 * its element colour and implicit-hydrogen count. It is a depiction, not a
 * conformer, and it is labelled that way wherever it appears.
 */
import { useMemo } from "react";
import { Box } from "lucide-react";
import { ELEMENT_COLOR, type Molecule } from "../lib/chem";

export function MoleculeView({ molecule, height = 300, onPickAtom, selectedAtom, rdkitSvg }: {
  molecule: Molecule;
  height?: number;
  /** Supplied by the workbench; without it the depiction stays a static figure. */
  onPickAtom?: (index: number) => void;
  selectedAtom?: number | null;
  /** Official RDKit depiction for the screened result; editing stays pickable. */
  rdkitSvg?: string | null;
}) {
  const geometry = useMemo(() => {
    if (!molecule.valid || !molecule.atoms.length) return null;
    const xs = molecule.atoms.map((atom) => atom.x);
    const ys = molecule.atoms.map((atom) => atom.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min(560 / spanX, (height - 60) / spanY, 74);
    const offsetX = 300 - ((minX + maxX) / 2) * scale;
    const offsetY = height / 2 - ((minY + maxY) / 2) * scale;
    const project = (atom: { x: number; y: number }) => [atom.x * scale + offsetX, atom.y * scale + offsetY] as const;
    /* The viewBox is cropped to the drawing rather than left at the nominal
       600 × height canvas. A structure that happens to be tall and narrow used
       to sit as a small figure in the middle of a large empty stage; cropping
       to its own bounds lets it fill whatever width the panel gives it. */
    const pad = Math.max(26, scale * 0.55);
    const box = {
      x: minX * scale + offsetX - pad,
      y: minY * scale + offsetY - pad,
      width: spanX * scale + pad * 2,
      height: spanY * scale + pad * 2,
    };
    return { project, scale, box };
  }, [molecule, height]);

  if (!molecule.valid || !geometry) {
    return <div className="mol-stage">
      <div className="mol-empty">
        <Box size={26} />
        <span>{molecule.error ?? "The structure could not be parsed, so no depiction was generated."}</span>
      </div>
    </div>;
  }

  if (rdkitSvg && !onPickAtom) {
    return <div className="mol-stage rdkit-depiction" role="img" aria-label="RDKit two-dimensional depiction of the submitted structure"
      dangerouslySetInnerHTML={{ __html: rdkitSvg }} />;
  }

  const { project, scale, box } = geometry;
  const bondWidth = Math.max(1.6, scale * 0.028);
  const labelSize = Math.max(11, scale * 0.26);

  // Ring centroids, for drawing the aromatic circle inside each aromatic ring.
  const aromaticRings = molecule.rings
    .filter((ring) => ring.every((index) => molecule.atoms[index].aromatic))
    .map((ring) => {
      const points = ring.map((index) => project(molecule.atoms[index]));
      const cx = points.reduce((total, point) => total + point[0], 0) / points.length;
      const cy = points.reduce((total, point) => total + point[1], 0) / points.length;
      const r = Math.min(...points.map((point) => Math.hypot(point[0] - cx, point[1] - cy))) * 0.56;
      return { cx, cy, r };
    });

  const labelled = new Set(
    molecule.atoms.filter((atom) => atom.element !== "C" || atom.charge !== 0).map((atom) => atom.index),
  );

  return <div className="mol-stage">
    <svg viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} role="img"
      className={onPickAtom ? "is-pickable" : undefined}
      aria-label="Two-dimensional depiction of the submitted structure">
      <g>
        {molecule.bonds.map((bond) => {
          const [x1, y1] = project(molecule.atoms[bond.a]);
          const [x2, y2] = project(molecule.atoms[bond.b]);
          const dx = x2 - x1, dy = y2 - y1;
          const length = Math.hypot(dx, dy) || 1;
          // Shorten the bond where an atom label sits at its end, so the line
          // does not run under the letter.
          const trimA = labelled.has(bond.a) ? labelSize * 0.62 : 0;
          const trimB = labelled.has(bond.b) ? labelSize * 0.62 : 0;
          const ax = x1 + (dx / length) * trimA, ay = y1 + (dy / length) * trimA;
          const bx = x2 - (dx / length) * trimB, by = y2 - (dy / length) * trimB;
          const nx = (-dy / length) * (scale * 0.08);
          const ny = (dx / length) * (scale * 0.08);
          const order = bond.aromatic ? 1 : bond.order;

          if (order >= 3) {
            return <g key={bond.index}>
              <line className="mol-bond" x1={ax} y1={ay} x2={bx} y2={by} strokeWidth={bondWidth} />
              <line className="mol-bond" x1={ax + nx * 1.5} y1={ay + ny * 1.5} x2={bx + nx * 1.5} y2={by + ny * 1.5} strokeWidth={bondWidth} />
              <line className="mol-bond" x1={ax - nx * 1.5} y1={ay - ny * 1.5} x2={bx - nx * 1.5} y2={by - ny * 1.5} strokeWidth={bondWidth} />
            </g>;
          }
          if (order === 2) {
            return <g key={bond.index}>
              <line className="mol-bond" x1={ax + nx} y1={ay + ny} x2={bx + nx} y2={by + ny} strokeWidth={bondWidth} />
              <line className="mol-bond" x1={ax - nx} y1={ay - ny} x2={bx - nx} y2={by - ny} strokeWidth={bondWidth} />
            </g>;
          }
          return <line key={bond.index} className="mol-bond" x1={ax} y1={ay} x2={bx} y2={by} strokeWidth={bondWidth} />;
        })}
      </g>
      <g>
        {aromaticRings.map((ring, index) => (
          <circle key={index} cx={ring.cx} cy={ring.cy} r={ring.r} fill="none" stroke="#5c6b7c" strokeWidth={bondWidth * 0.72} opacity="0.5" />
        ))}
      </g>
      <g>
        {molecule.atoms.map((atom) => {
          if (!labelled.has(atom.index)) return null;
          const [x, y] = project(atom);
          const colour = ELEMENT_COLOR[atom.element] ?? "#334155";
          const hydrogens = atom.implicitH;
          const charge = atom.charge > 0 ? "+".repeat(Math.min(atom.charge, 2)) : atom.charge < 0 ? "−".repeat(Math.min(-atom.charge, 2)) : "";
          return <g key={atom.index}>
            <circle cx={x} cy={y} r={labelSize * 0.72} fill="#ffffff" opacity="0.94" />
            <text className="mol-atom-label" x={x} y={y} fill={colour} fontSize={labelSize}>
              {atom.element}
              {hydrogens > 0 && <tspan fontSize={labelSize * 0.72} dy={labelSize * 0.16}>H{hydrogens > 1 ? <tspan fontSize={labelSize * 0.58} dy={labelSize * 0.12}>{hydrogens}</tspan> : null}</tspan>}
              {charge && <tspan fontSize={labelSize * 0.66} dy={-labelSize * 0.38}>{charge}</tspan>}
            </text>
          </g>;
        })}
      </g>

      {/* Hit targets sit above the drawing so a click lands on the atom the
          reader aimed at rather than on whichever stroke happens to be on top.
          Carbons carry no label, so their target is the only thing marking
          them. */}
      {onPickAtom && <g className="mol-picks">
        {molecule.atoms.map((atom) => {
          const [x, y] = project(atom);
          return <circle key={atom.index} cx={x} cy={y} r={labelSize * 0.8}
            className={`mol-pick ${selectedAtom === atom.index ? "is-selected" : ""}`}
            onClick={(event) => { event.stopPropagation(); onPickAtom(atom.index); }}>
            <title>{`${atom.element}${atom.implicitH > 0 ? `H${atom.implicitH}` : ""}`}</title>
          </circle>;
        })}
      </g>}
    </svg>
  </div>;
}
