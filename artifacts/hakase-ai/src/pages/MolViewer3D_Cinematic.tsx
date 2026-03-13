import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  RotateCcw, ZoomIn, ZoomOut, Download, Settings2, Layers, Eye,
  ChevronDown, ChevronRight, Search, X, Maximize2, Play, Pause,
  FlaskConical, Dna, Atom, Info, Grid3x3, Share2, Film,
  RefreshCw, SlidersHorizontal, Crosshair, Zap
} from "lucide-react";

const ATOM_COLORS: Record<string, string> = {
  C: "#94a3b8", N: "#60a5fa", O: "#f87171",
  H: "#e2e8f0", S: "#facc15", F: "#34d399", Cl: "#4ade80",
};

const ATOM_RADIUS: Record<string, number> = {
  C: 14, N: 13, O: 13, H: 8, S: 16, F: 11, Cl: 15,
};

interface Atom3D {
  id: number; symbol: string;
  x: number; y: number; z: number;
  label?: string;
}

interface Bond3D {
  from: number; to: number; order: number;
}

const MOLECULE_IBUPROFEN: Atom3D[] = [
  { id: 0, symbol: "C", x: 0, y: 0, z: 0, label: "C1" },
  { id: 1, symbol: "C", x: 50, y: -30, z: 10 },
  { id: 2, symbol: "C", x: 100, y: 0, z: 5 },
  { id: 3, symbol: "C", x: 100, y: 50, z: -5 },
  { id: 4, symbol: "C", x: 50, y: 80, z: -10 },
  { id: 5, symbol: "C", x: 0, y: 50, z: -5 },
  { id: 6, symbol: "C", x: 155, y: -25, z: 20 },
  { id: 7, symbol: "C", x: 200, y: 10, z: 10 },
  { id: 8, symbol: "O", x: 245, y: -15, z: 20 },
  { id: 9, symbol: "O", x: 200, y: 60, z: 0 },
  { id: 10, symbol: "C", x: -55, y: -25, z: 15 },
  { id: 11, symbol: "C", x: -55, y: 75, z: -15 },
  { id: 12, symbol: "C", x: -100, y: 25, z: 5 },
  { id: 13, symbol: "H", x: 50, y: -70, z: 20 },
  { id: 14, symbol: "H", x: 50, y: 120, z: -20 },
  { id: 15, symbol: "H", x: 155, y: -65, z: 30 },
];

const BONDS: Bond3D[] = [
  { from: 0, to: 1, order: 2 }, { from: 1, to: 2, order: 1 },
  { from: 2, to: 3, order: 2 }, { from: 3, to: 4, order: 1 },
  { from: 4, to: 5, order: 2 }, { from: 5, to: 0, order: 1 },
  { from: 2, to: 6, order: 1 }, { from: 6, to: 7, order: 1 },
  { from: 7, to: 8, order: 2 }, { from: 7, to: 9, order: 1 },
  { from: 0, to: 10, order: 1 }, { from: 5, to: 11, order: 1 },
  { from: 10, to: 12, order: 1 }, { from: 11, to: 12, order: 1 },
  { from: 1, to: 13, order: 1 }, { from: 4, to: 14, order: 1 },
  { from: 6, to: 15, order: 1 },
];

function rotatePoint(x: number, y: number, z: number, rx: number, ry: number) {
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const y2 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;
  return { x: x1, y: y2, z: z2 };
}

function MoleculeViewer({ rx, ry, zoom, renderMode, showHydrogen, showLabels }: {
  rx: number; ry: number; zoom: number; renderMode: string;
  showHydrogen: boolean; showLabels: boolean;
}) {
  const cx = 200, cy = 160;

  const projected = MOLECULE_IBUPROFEN
    .filter(a => showHydrogen || a.symbol !== "H")
    .map(a => {
      const r = rotatePoint(a.x - 80, a.y - 30, a.z, rx, ry);
      const scale = zoom * (1 + r.z * 0.001);
      return {
        ...a,
        px: cx + r.x * zoom,
        py: cy + r.y * zoom,
        pz: r.z,
        scale,
      };
    }).sort((a, b) => a.pz - b.pz);

  const idToProj = Object.fromEntries(projected.map(p => [p.id, p]));

  if (renderMode === "surface") {
    return (
      <svg width="400" height="320" style={{ overflow: "visible" }}>
        <defs>
          <radialGradient id="surfGrad" cx="40%" cy="35%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#4f46e5" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.9" />
          </radialGradient>
          <filter id="blur1">
            <feGaussianBlur stdDeviation="8" />
          </filter>
          <radialGradient id="glowGrad" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx={cx} cy={cy} rx="155" ry="100" fill="url(#glowGrad)" filter="url(#blur1)" />
        <ellipse cx={cx} cy={cy} rx="140" ry="88" fill="url(#surfGrad)" opacity="0.85" />
        <ellipse cx={cx - 20} cy={cy - 30} rx="55" ry="35" fill="rgba(167,139,250,0.25)" />
        {/* Sub-surface lobes */}
        <ellipse cx={cx + 55} cy={cy + 10} rx="38" ry="25" fill="rgba(96,165,250,0.15)" />
        <ellipse cx={cx - 60} cy={cy + 20} rx="32" ry="22" fill="rgba(244,63,94,0.12)" />
        <text x={cx} y={cy + 120} fill="#a78bfa" fontSize="9" textAnchor="middle" fontFamily="monospace">Molecular Surface (VDW Radius)</text>
      </svg>
    );
  }

  if (renderMode === "wireframe") {
    return (
      <svg width="400" height="320" style={{ overflow: "visible" }}>
        {BONDS.filter(b => {
          const a = MOLECULE_IBUPROFEN.find(x => x.id === b.from);
          const d = MOLECULE_IBUPROFEN.find(x => x.id === b.to);
          if (!showHydrogen && (a?.symbol === "H" || d?.symbol === "H")) return false;
          return idToProj[b.from] && idToProj[b.to];
        }).map((b, i) => {
          const f = idToProj[b.from], t = idToProj[b.to];
          if (!f || !t) return null;
          const depth = (f.pz + t.pz) / 2;
          const alpha = 0.4 + Math.max(0, Math.min(0.6, depth / 200));
          return (
            <line key={i} x1={f.px} y1={f.py} x2={t.px} y2={t.py}
              stroke={`rgba(139,92,246,${alpha})`} strokeWidth={b.order === 2 ? 2 : 1.5} />
          );
        })}
        {projected.map(a => (
          <circle key={a.id} cx={a.px} cy={a.py} r={3}
            fill={ATOM_COLORS[a.symbol] || "#94a3b8"} opacity={0.9} />
        ))}
      </svg>
    );
  }

  return (
    <svg width="400" height="320" style={{ overflow: "visible" }}>
      <defs>
        {Object.entries(ATOM_COLORS).map(([sym, col]) => (
          <radialGradient key={sym} id={`ag-${sym}`} cx="35%" cy="30%">
            <stop offset="0%" stopColor="white" stopOpacity="0.5" />
            <stop offset="40%" stopColor={col} stopOpacity="0.9" />
            <stop offset="100%" stopColor={col} stopOpacity="0.6" />
          </radialGradient>
        ))}
        <filter id="atomShadow">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.5" />
        </filter>
        <filter id="glowFilter">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {BONDS.filter(b => {
        const a = MOLECULE_IBUPROFEN.find(x => x.id === b.from);
        const d = MOLECULE_IBUPROFEN.find(x => x.id === b.to);
        if (!showHydrogen && (a?.symbol === "H" || d?.symbol === "H")) return false;
        return idToProj[b.from] && idToProj[b.to];
      }).map((b, i) => {
        const f = idToProj[b.from], t = idToProj[b.to];
        if (!f || !t) return null;
        const dx = t.px - f.px, dy = t.py - f.py;
        const len = Math.sqrt(dx * dx + dy * dy);
        const depth = (f.pz + t.pz) / 2;
        const alpha = 0.4 + Math.max(0, Math.min(0.5, depth / 150));
        if (b.order === 2) {
          const nx = -dy / len * 3, ny = dx / len * 3;
          return (
            <g key={i}>
              <line x1={f.px + nx} y1={f.py + ny} x2={t.px + nx} y2={t.py + ny}
                stroke={`rgba(180,180,200,${alpha})`} strokeWidth="2" />
              <line x1={f.px - nx} y1={f.py - ny} x2={t.px - nx} y2={t.py - ny}
                stroke={`rgba(180,180,200,${alpha})`} strokeWidth="2" />
            </g>
          );
        }
        return (
          <line key={i} x1={f.px} y1={f.py} x2={t.px} y2={t.py}
            stroke={`rgba(180,180,200,${alpha})`} strokeWidth="3" />
        );
      })}

      {projected.map(a => {
        const r = (ATOM_RADIUS[a.symbol] || 12) * a.scale * 0.85;
        return (
          <g key={a.id} style={{ cursor: "pointer" }}>
            <circle cx={a.px} cy={a.py} r={r + 2} fill="black" opacity="0.3" />
            <circle cx={a.px} cy={a.py} r={r}
              fill={`url(#ag-${a.symbol})`}
              filter="url(#atomShadow)"
              stroke={ATOM_COLORS[a.symbol] || "#94a3b8"}
              strokeWidth="0.5"
              strokeOpacity="0.5"
            />
            {showLabels && (
              <text x={a.px} y={a.py + 3} fill="white" fontSize={8 * a.scale}
                textAnchor="middle" dominantBaseline="central" fontWeight="bold"
                style={{ userSelect: "none", pointerEvents: "none" }}
              >
                {a.symbol}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function MolViewer3D_Cinematic() {
  const [rx, setRx] = useState(0.2);
  const [ry, setRy] = useState(0.4);
  const [zoom, setZoom] = useState(0.9);
  const [isAnimating, setIsAnimating] = useState(true);
  const [renderMode, setRenderMode] = useState<"ball-stick" | "surface" | "wireframe">("ball-stick");
  const [showHydrogen, setShowHydrogen] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [selectedAtom, setSelectedAtom] = useState<string | null>("C1 — Carbon (sp2)");
  const [activeLib, setActiveLib] = useState("Ibuprofen-Analog-001");
  const animRef = useRef<number>(0);
  const ryRef = useRef(ry);

  useEffect(() => {
    if (!isAnimating) { cancelAnimationFrame(animRef.current); return; }
    const tick = () => {
      ryRef.current += 0.008;
      setRy(ryRef.current);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isAnimating]);

  const molecules = [
    { name: "Ibuprofen-Analog-001", mw: 206.3, formula: "C₁₃H₁₈O₂", score: 0.81 },
    { name: "Ibuprofen-Analog-007", mw: 220.1, formula: "C₁₄H₂₀O₂", score: 0.76 },
    { name: "CDK4/6-INH-004", mw: 447.5, formula: "C₂₄H₃₀N₆O", score: 0.68 },
  ];

  return (
    <div className="h-screen bg-[#04050a] text-white flex flex-col relative overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-violet-900/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[200px] bg-blue-900/10 rounded-full blur-[80px]" />
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex items-center h-12 px-5 border-b border-white/6 bg-black/20 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-violet-500 to-violet-800 flex items-center justify-center">
            <Atom className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[13px] font-semibold">3D Molecular Viewer</span>
          <span className="text-[10px] text-slate-600 ml-1">— Variant A: Cinematic</span>
        </div>

        <div className="flex items-center gap-1.5 mx-auto">
          {/* Render modes */}
          {(["ball-stick","surface","wireframe"] as const).map(m => (
            <button
              key={m}
              onClick={() => setRenderMode(m)}
              className={`px-3 py-1 rounded text-[11px] font-medium transition-all ${
                renderMode === m
                  ? "bg-violet-600/30 border border-violet-500/40 text-violet-300"
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
              }`}
            >
              {m === "ball-stick" ? "Ball & Stick" : m === "surface" ? "VDW Surface" : "Wireframe"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHydrogen(!showHydrogen)}
            className={`text-[10px] px-2.5 py-1 rounded border transition-all ${showHydrogen ? "border-blue-500/40 text-blue-400 bg-blue-500/10" : "border-white/10 text-slate-500"}`}
          >H atoms</button>
          <button
            onClick={() => setShowLabels(!showLabels)}
            className={`text-[10px] px-2.5 py-1 rounded border transition-all ${showLabels ? "border-violet-500/40 text-violet-400 bg-violet-500/10" : "border-white/10 text-slate-500"}`}
          >Labels</button>
          <button className="p-1.5 rounded hover:bg-white/5 text-slate-500"><Download className="w-3.5 h-3.5" /></button>
          <button className="p-1.5 rounded hover:bg-white/5 text-slate-500"><Share2 className="w-3.5 h-3.5" /></button>
          <button className="p-1.5 rounded hover:bg-white/5 text-slate-500"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative z-10">
        {/* Left panel — molecule library */}
        <div className="w-[200px] border-r border-white/6 bg-black/10 backdrop-blur-sm flex flex-col shrink-0">
          <div className="p-3 border-b border-white/6">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600" />
              <input
                className="w-full bg-white/5 border border-white/8 rounded text-[11px] pl-6 pr-3 py-1.5 text-slate-400 outline-none focus:border-violet-500/40"
                placeholder="Search molecules…"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {molecules.map(m => (
              <button
                key={m.name}
                onClick={() => setActiveLib(m.name)}
                className={`w-full p-2.5 rounded-lg text-left transition-all ${
                  activeLib === m.name
                    ? "bg-violet-600/15 border border-violet-500/25"
                    : "hover:bg-white/4 border border-transparent"
                }`}
              >
                {/* Mini mol preview */}
                <div className="w-full h-12 bg-black/20 rounded mb-2 flex items-center justify-center border border-white/5 overflow-hidden">
                  <svg width="60" height="44">
                    <defs>
                      <radialGradient id={`mini-${m.name}`} cx="40%" cy="35%">
                        <stop offset="0%" stopColor="white" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.8" />
                      </radialGradient>
                    </defs>
                    {[
                      [30, 22], [20, 14], [40, 14], [48, 22], [40, 30], [20, 30],
                    ].map(([x, y], i) => (
                      <g key={i}>
                        <line x1={30} y1={22} x2={x} y2={y} stroke="rgba(139,92,246,0.4)" strokeWidth="1" />
                        <circle cx={x} cy={y} r={i % 3 === 0 ? 4 : 3} fill={`url(#mini-${m.name})`} />
                      </g>
                    ))}
                    <circle cx={30} cy={22} r={5} fill="url(#mini-${m.name})" />
                  </svg>
                </div>
                <div className="text-[10px] font-medium text-slate-300 leading-tight truncate">{m.name}</div>
                <div className="text-[9px] text-slate-600 mt-0.5">{m.formula} · {m.mw} Da</div>
                <div className="flex items-center gap-1 mt-1">
                  <div className="h-0.5 flex-1 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-500" style={{ width: `${m.score * 100}%` }} />
                  </div>
                  <span className="text-[9px] text-violet-400">{m.score}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="p-2 border-t border-white/6">
            <button className="w-full py-2 text-[10px] text-slate-500 hover:text-slate-300 border border-dashed border-white/8 rounded-lg">
              + Import SDF / PDB
            </button>
          </div>
        </div>

        {/* Central 3D Viewport */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden">
          {/* Grid floor */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `
              linear-gradient(rgba(139,92,246,0.04) 1px, transparent 1px),
              linear-gradient(90deg, rgba(139,92,246,0.04) 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px",
          }} />

          {/* Molecule */}
          <div style={{ transform: "scale(1.4)", cursor: "grab" }}>
            <MoleculeViewer rx={rx} ry={ry} zoom={zoom} renderMode={renderMode} showHydrogen={showHydrogen} showLabels={showLabels} />
          </div>

          {/* Formula overlay */}
          <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-md border border-white/8 rounded-xl px-4 py-3">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Active Molecule</div>
            <div className="text-[14px] font-semibold text-white">{activeLib}</div>
            <div className="text-[11px] text-violet-300 font-mono mt-0.5">C₁₃H₁₈O₂ · MW 206.3 Da</div>
          </div>

          {/* XYZ axis indicator */}
          <div className="absolute bottom-16 left-4">
            <svg width="60" height="60">
              <defs>
                <marker id="arrowR" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#ef4444" />
                </marker>
                <marker id="arrowG" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#22c55e" />
                </marker>
                <marker id="arrowB" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#60a5fa" />
                </marker>
              </defs>
              <line x1="30" y1="30" x2="52" y2="30" stroke="#ef4444" strokeWidth="1.5" markerEnd="url(#arrowR)" />
              <line x1="30" y1="30" x2="30" y2="8" stroke="#22c55e" strokeWidth="1.5" markerEnd="url(#arrowG)" />
              <line x1="30" y1="30" x2="12" y2="48" stroke="#60a5fa" strokeWidth="1.5" markerEnd="url(#arrowB)" opacity="0.7" />
              <text x="55" y="34" fill="#ef4444" fontSize="9">X</text>
              <text x="28" y="6" fill="#22c55e" fontSize="9">Y</text>
              <text x="5" y="52" fill="#60a5fa" fontSize="9">Z</text>
            </svg>
          </div>

          {/* Playback / Rotation controls */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/50 backdrop-blur-md border border-white/8 rounded-full px-5 py-2.5">
            <button
              onClick={() => { setRx(0.2); setRy(0.4); }}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            ><RotateCcw className="w-4 h-4" /></button>

            <div className="w-px h-4 bg-white/10" />

            <button
              onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            ><ZoomOut className="w-4 h-4" /></button>

            <div className="w-20">
              <Slider
                value={[zoom]}
                onValueChange={([v]) => setZoom(v)}
                min={0.3} max={2.0} step={0.05}
                className="[&_[role=slider]]:bg-violet-500 [&_[role=slider]]:border-0 [&_[role=slider]]:w-3 [&_[role=slider]]:h-3"
              />
            </div>

            <button
              onClick={() => setZoom(z => Math.min(2.0, z + 0.1))}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            ><ZoomIn className="w-4 h-4" /></button>

            <div className="w-px h-4 bg-white/10" />

            <button
              onClick={() => setIsAnimating(!isAnimating)}
              className={`text-[11px] font-medium flex items-center gap-1.5 transition-colors ${isAnimating ? "text-violet-400" : "text-slate-400"}`}
            >
              {isAnimating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isAnimating ? "Pause" : "Rotate"}
            </button>

            <div className="w-px h-4 bg-white/10" />

            <button className="text-slate-500 hover:text-slate-300 flex items-center gap-1 text-[11px]">
              <Film className="w-3.5 h-3.5" /> Record
            </button>
          </div>
        </div>

        {/* Right panel — properties */}
        <div className="w-[220px] border-l border-white/6 bg-black/10 backdrop-blur-sm flex flex-col shrink-0">
          {/* Selected atom */}
          <div className="p-3 border-b border-white/6">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Selected</div>
            {selectedAtom ? (
              <div className="bg-violet-600/10 border border-violet-500/20 rounded-lg p-2.5">
                <div className="text-[12px] font-semibold text-violet-300">{selectedAtom}</div>
                <div className="text-[10px] text-slate-500 mt-1">Click an atom to select</div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-600">Click an atom to select</div>
            )}
          </div>

          {/* Molecular properties */}
          <div className="p-3 border-b border-white/6 space-y-2">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Molecular Properties</div>
            {[
              { label: "Formula", val: "C₁₃H₁₈O₂" },
              { label: "MW", val: "206.28 Da" },
              { label: "Atoms", val: "33" },
              { label: "Bonds", val: "34" },
              { label: "Rings", val: "1 (benzene)" },
              { label: "Rotatable bonds", val: "4" },
              { label: "H-bond donors", val: "1" },
              { label: "H-bond acceptors", val: "2" },
              { label: "logP (predicted)", val: "3.18" },
              { label: "TPSA", val: "37.3 Ų" },
            ].map(({ label, val }) => (
              <div key={label} className="flex justify-between items-center">
                <span className="text-[10px] text-slate-500">{label}</span>
                <span className="text-[10px] text-slate-300 font-medium">{val}</span>
              </div>
            ))}
          </div>

          {/* Pharmacophore features */}
          <div className="p-3 border-b border-white/6">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Pharmacophore</div>
            <div className="space-y-1.5">
              {[
                { feat: "Hydrophobic", n: 2, color: "#f59e0b" },
                { feat: "H-Bond Acceptor", n: 2, color: "#60a5fa" },
                { feat: "H-Bond Donor", n: 1, color: "#34d399" },
                { feat: "Aromatic Ring", n: 1, color: "#a78bfa" },
              ].map(({ feat, n, color }) => (
                <div key={feat} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-slate-400 flex-1">{feat}</span>
                  <Badge className="text-[8px] px-1 py-0 bg-white/5 text-slate-500">{n}</Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Docking pose info */}
          <div className="p-3">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Docking (EGFR)</div>
            <div className="space-y-1.5">
              {[
                { label: "Binding Energy", val: "−8.42 kcal/mol", good: true },
                { label: "Kd (predicted)", val: "12.4 nM", good: true },
                { label: "Pose RMSD", val: "0.84 Å", good: true },
                { label: "H-Bond contacts", val: "3", good: true },
              ].map(({ label, val, good }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-[10px] text-slate-500">{label}</span>
                  <span className={`text-[10px] font-medium ${good ? "text-emerald-400" : "text-red-400"}`}>{val}</span>
                </div>
              ))}
            </div>

            <Button className="w-full mt-3 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/25 text-violet-300 text-[11px] h-7 gap-1.5">
              <Zap className="w-3 h-3" /> Run Docking
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
