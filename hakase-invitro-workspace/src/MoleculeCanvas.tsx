import { useEffect, useRef } from "react";

/**
 * Zero-dependency rotating ball-and-stick molecule.
 *
 * Real 3D: atoms carry x/y/z, are rotated by composed Y/X rotation matrices,
 * projected with a perspective divide, then painter-sorted by depth so nearer
 * atoms occlude further ones. Bonds are drawn at the midpoint depth of their
 * two atoms so they interleave correctly with the spheres.
 *
 * The geometry is a stylised caffeine-like fused bicyclic scaffold — chosen
 * because it reads as "small molecule" at a glance. It is decorative, not a
 * chemically accurate structure, and is never presented as data.
 */

type Atom = { x: number; y: number; z: number; r: number; c: [number, number, number] };
type Bond = [number, number];

const C: [number, number, number] = [148, 163, 184];
const N: [number, number, number] = [56, 152, 236];
const O: [number, number, number] = [239, 108, 108];

// Fused six/five-membered ring scaffold with substituents. Units are arbitrary.
const ATOMS: Atom[] = [
  { x: 0.00, y: 0.62, z: 0.05, r: 15, c: N },
  { x: 0.58, y: 0.30, z: -0.10, r: 14, c: C },
  { x: 0.60, y: -0.34, z: 0.08, r: 15, c: N },
  { x: 0.02, y: -0.70, z: 0.02, r: 14, c: C },
  { x: -0.57, y: -0.36, z: -0.12, r: 14, c: C },
  { x: -0.58, y: 0.28, z: 0.10, r: 14, c: C },
  { x: -1.14, y: -0.72, z: 0.24, r: 15, c: N },
  { x: -1.50, y: -0.20, z: 0.52, r: 14, c: C },
  { x: -1.18, y: 0.38, z: 0.44, r: 15, c: N },
  { x: 1.12, y: 0.61, z: -0.34, r: 16, c: O },
  { x: 0.05, y: -1.32, z: 0.12, r: 16, c: O },
  { x: 1.18, y: -0.70, z: 0.24, r: 12, c: C },
  { x: 0.02, y: 1.26, z: 0.12, r: 12, c: C },
  { x: -1.34, y: 1.02, z: 0.62, r: 12, c: C },
];

const BONDS: Bond[] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
  [4, 6], [6, 7], [7, 8], [8, 5],
  [1, 9], [3, 10], [2, 11], [0, 12], [8, 13],
];

function rgba(c: [number, number, number], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export function MoleculeCanvas({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const draw = (t: number) => {
      const ay = reduced ? 0.6 : t * 0.00034;
      const ax = reduced ? -0.32 : Math.sin(t * 0.00019) * 0.42 - 0.1;

      const cy = Math.cos(ay), sy = Math.sin(ay);
      const cx = Math.cos(ax), sx = Math.sin(ax);
      const scale = Math.min(width, height) * 0.29;
      const ox = width / 2;
      const oy = height / 2;

      const pts = ATOMS.map((a) => {
        // Rotate about Y, then about X.
        const x1 = a.x * cy + a.z * sy;
        const z1 = -a.x * sy + a.z * cy;
        const y2 = a.y * cx - z1 * sx;
        const z2 = a.y * sx + z1 * cx;
        const persp = 3.4 / (3.4 + z2);
        return {
          sx: ox + x1 * scale * persp,
          sy: oy - y2 * scale * persp,
          z: z2,
          r: a.r * persp * (Math.min(width, height) / 320),
          c: a.c,
          persp,
        };
      });

      ctx.clearRect(0, 0, width, height);

      type Item = { z: number; kind: "bond" | "atom"; i: number; j?: number };
      const items: Item[] = [];
      pts.forEach((p, i) => items.push({ z: p.z, kind: "atom", i }));
      BONDS.forEach(([i, j]) => items.push({ z: (pts[i].z + pts[j].z) / 2 - 0.001, kind: "bond", i, j }));
      // Painter's algorithm: far (large z) first.
      items.sort((a, b) => b.z - a.z);

      for (const item of items) {
        if (item.kind === "bond" && item.j !== undefined) {
          const a = pts[item.i], b = pts[item.j];
          const depth = (a.persp + b.persp) / 2;
          ctx.strokeStyle = `rgba(100,116,139,${0.16 + depth * 0.3})`;
          ctx.lineWidth = 2.1 * depth;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        } else {
          const p = pts[item.i];
          const alpha = 0.42 + p.persp * 0.5;
          const g = ctx.createRadialGradient(
            p.sx - p.r * 0.34, p.sy - p.r * 0.34, p.r * 0.12,
            p.sx, p.sy, p.r,
          );
          g.addColorStop(0, rgba(p.c.map((v) => Math.min(255, v + 62)) as [number, number, number], alpha));
          g.addColorStop(1, rgba(p.c, alpha * 0.86));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, p.r, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = rgba(p.c, alpha * 0.34);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    if (reduced) draw(0);
    else raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={`molecule-canvas ${className}`} aria-hidden />;
}
