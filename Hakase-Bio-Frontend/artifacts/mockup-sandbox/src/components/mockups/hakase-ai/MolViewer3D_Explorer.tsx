import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Search, Filter, Download, Maximize2, Grid2x2, LayoutList,
  ChevronDown, Plus, X, ArrowUpDown, Eye, Layers, Star,
  BarChart2, Zap, GitCompare, ChevronRight, Atom, Dna,
  FlaskConical, Activity, SlidersHorizontal, RotateCcw, ZoomIn, ZoomOut
} from "lucide-react";

const ATOM_COLORS: Record<string, string> = {
  C: "#94a3b8", N: "#60a5fa", O: "#f87171",
  H: "#e2e8f0", S: "#facc15", F: "#34d399",
};

function rot(x: number, y: number, z: number, rx: number, ry: number) {
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  return { x: x1, y: y * cx - z1 * sx, z: y * sx + z1 * cx };
}

const BASE_ATOMS = [
  { id: 0, symbol: "C", x: 0, y: 0, z: 0 },
  { id: 1, symbol: "C", x: 40, y: -25, z: 7 },
  { id: 2, symbol: "C", x: 80, y: 0, z: 4 },
  { id: 3, symbol: "C", x: 80, y: 40, z: -4 },
  { id: 4, symbol: "C", x: 40, y: 65, z: -7 },
  { id: 5, symbol: "C", x: 0, y: 40, z: -4 },
  { id: 6, symbol: "C", x: 125, y: -20, z: 14 },
  { id: 7, symbol: "O", x: 165, y: -5, z: 10 },
  { id: 8, symbol: "O", x: 125, y: 30, z: 5 },
  { id: 9, symbol: "C", x: -45, y: -20, z: 10 },
  { id: 10, symbol: "C", x: -45, y: 60, z: -10 },
];

const BASE_BONDS = [
  { from: 0, to: 1, order: 2 }, { from: 1, to: 2, order: 1 },
  { from: 2, to: 3, order: 2 }, { from: 3, to: 4, order: 1 },
  { from: 4, to: 5, order: 2 }, { from: 5, to: 0, order: 1 },
  { from: 2, to: 6, order: 1 }, { from: 6, to: 7, order: 2 }, { from: 6, to: 8, order: 1 },
  { from: 0, to: 9, order: 1 }, { from: 5, to: 10, order: 1 }, { from: 9, to: 10, order: 1 },
];

interface MoleculeCard {
  id: string;
  name: string;
  formula: string;
  mw: number;
  qed: number;
  tox: "Low" | "Medium" | "High";
  binding: string;
  sa: number;
  composite: number;
  tag?: string;
  starred?: boolean;
  rxOffset: number;
  ryOffset: number;
  accentColor: string;
}

const MOLECULES: MoleculeCard[] = [
  { id: "m1", name: "IBU-001", formula: "C₁₃H₁₈O₂", mw: 206.3, qed: 0.81, tox: "Low", binding: "12.4 nM", sa: 2.8, composite: 0.81, tag: "Lead", starred: true, rxOffset: 0.1, ryOffset: 0.3, accentColor: "#8b5cf6" },
  { id: "m2", name: "IBU-007", formula: "C₁₄H₂₀O₂", mw: 220.1, qed: 0.76, tox: "Low", binding: "18.2 nM", sa: 3.1, composite: 0.76, tag: "Active", starred: false, rxOffset: -0.2, ryOffset: 0.8, accentColor: "#3b82f6" },
  { id: "m3", name: "IBU-012", formula: "C₁₂H₁₆O₃", mw: 208.3, qed: 0.67, tox: "Medium", binding: "24.7 nM", sa: 2.4, composite: 0.67, starred: false, rxOffset: 0.3, ryOffset: 1.2, accentColor: "#06b6d4" },
  { id: "m4", name: "IBU-003", formula: "C₁₃H₁₈O₂", mw: 206.3, qed: 0.63, tox: "Low", binding: "31.0 nM", sa: 3.8, composite: 0.63, starred: false, rxOffset: -0.1, ryOffset: 0.5, accentColor: "#22c55e" },
  { id: "m5", name: "CDK-004", formula: "C₂₄H₃₀N₆O", mw: 447.5, qed: 0.58, tox: "High", binding: "9.8 nM", sa: 2.2, composite: 0.58, tag: "Toxic", starred: false, rxOffset: 0.4, ryOffset: -0.2, accentColor: "#ef4444" },
  { id: "m6", name: "EGFR-018", formula: "C₁₈H₂₁N₃O₃", mw: 331.4, qed: 0.71, tox: "Low", binding: "7.3 nM", sa: 3.5, composite: 0.74, tag: "Potent", starred: true, rxOffset: 0.0, ryOffset: 1.0, accentColor: "#f59e0b" },
];

function MiniMol({ rx, ry, color }: { rx: number; ry: number; color: string }) {
  const cx = 55, cy = 45;
  const atoms = BASE_ATOMS.slice(0, 8).map(a => {
    const r = rot(a.x - 40, a.y - 20, a.z, rx, ry);
    return { ...a, px: cx + r.x * 0.55, py: cy + r.y * 0.55, pz: r.z };
  }).sort((a, b) => a.pz - b.pz);
  const pm = Object.fromEntries(atoms.map(a => [a.id, a]));

  return (
    <svg width="110" height="90">
      {BASE_BONDS.slice(0, 9).map((b, i) => {
        const f = pm[b.from], t = pm[b.to];
        if (!f || !t) return null;
        return <line key={i} x1={f.px} y1={f.py} x2={t.px} y2={t.py} stroke={`${color}60`} strokeWidth="1.5" />;
      })}
      {atoms.map(a => (
        <circle key={a.id} cx={a.px} cy={a.py}
          r={a.symbol === "O" ? 5 : a.symbol === "N" ? 5 : 4}
          fill={ATOM_COLORS[a.symbol] || "#94a3b8"}
          opacity={0.8 + a.pz / 400}
        />
      ))}
    </svg>
  );
}

function BigMol({ rx, ry, zoom, color }: { rx: number; ry: number; zoom: number; color: string }) {
  const cx = 200, cy = 160;
  const atoms = BASE_ATOMS.map(a => {
    const r = rot(a.x - 60, a.y - 20, a.z, rx, ry);
    const s = zoom * (1 + r.z * 0.001);
    return { ...a, px: cx + r.x * zoom, py: cy + r.y * zoom, pz: r.z, s };
  }).sort((a, b) => a.pz - b.pz);
  const pm = Object.fromEntries(atoms.map(a => [a.id, a]));

  return (
    <svg width="400" height="320">
      <defs>
        {Object.entries(ATOM_COLORS).map(([sym, col]) => (
          <radialGradient key={sym} id={`bg-${sym}`} cx="35%" cy="30%">
            <stop offset="0%" stopColor="white" stopOpacity="0.45" />
            <stop offset="45%" stopColor={col} />
            <stop offset="100%" stopColor={col} stopOpacity="0.55" />
          </radialGradient>
        ))}
        <filter id="bs"><feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#000" floodOpacity="0.5" /></filter>
      </defs>

      {BASE_BONDS.map((b, i) => {
        const f = pm[b.from], t = pm[b.to];
        if (!f || !t) return null;
        const d = (f.pz + t.pz) / 2;
        const al = 0.35 + Math.max(0, Math.min(0.5, d / 160));
        const dx = t.px - f.px, dy = t.py - f.py, len = Math.sqrt(dx * dx + dy * dy);
        if (b.order === 2 && len > 0) {
          const nx = -dy / len * 3, ny = dx / len * 3;
          return (
            <g key={i}>
              <line x1={f.px + nx} y1={f.py + ny} x2={t.px + nx} y2={t.py + ny} stroke={`rgba(200,210,230,${al})`} strokeWidth="2" />
              <line x1={f.px - nx} y1={f.py - ny} x2={t.px - nx} y2={t.py - ny} stroke={`rgba(200,210,230,${al})`} strokeWidth="2" />
            </g>
          );
        }
        return <line key={i} x1={f.px} y1={f.py} x2={t.px} y2={t.py} stroke={`rgba(200,210,230,${al})`} strokeWidth="2.5" />;
      })}

      {atoms.map(a => {
        const r = ({ C: 13, N: 12, O: 12, H: 7, S: 15 } as Record<string, number>)[a.symbol] || 11;
        return (
          <g key={a.id}>
            <circle cx={a.px} cy={a.py} r={r * a.s + 1.5} fill="black" opacity="0.2" />
            <circle cx={a.px} cy={a.py} r={r * a.s} fill={`url(#bg-${a.symbol})`} filter="url(#bs)"
              stroke={ATOM_COLORS[a.symbol]} strokeWidth="0.4" strokeOpacity="0.4" />
            <text x={a.px} y={a.py + 3} fill="white" fontSize={7 * a.s}
              textAnchor="middle" dominantBaseline="central" fontWeight="700"
              style={{ userSelect: "none", pointerEvents: "none" }}>
              {a.symbol}
            </text>
          </g>
        );
      })}

      {/* Accent glow */}
      <circle cx={cx} cy={cy} r="120" fill={`${color}08`} />
    </svg>
  );
}

export function MolViewer3D_Explorer() {
  const [selected, setSelected] = useState<string[]>(["m1"]);
  const [primary, setPrimary] = useState("m1");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("composite");
  const [compareMode, setCompareMode] = useState(false);
  const [rx, setRx] = useState(-0.1);
  const [ry, setRy] = useState(0.6);
  const [zoom, setZoom] = useState(1.0);
  const [filterTox, setFilterTox] = useState<string[]>([]);

  const primaryMol = MOLECULES.find(m => m.id === primary)!;

  const filtered = MOLECULES
    .filter(m => {
      if (searchQuery && !m.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterTox.length && !filterTox.includes(m.tox)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "composite") return b.composite - a.composite;
      if (sortBy === "binding") return parseFloat(a.binding) - parseFloat(b.binding);
      if (sortBy === "qed") return b.qed - a.qed;
      return b.mw - a.mw;
    });

  const toggleSelect = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div className="h-screen bg-[#080a10] text-white flex flex-col overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Top bar */}
      <div className="h-12 border-b border-white/8 bg-[#0c0e18] flex items-center px-4 gap-3 shrink-0">
        <div className="flex items-center gap-2 pr-3 border-r border-white/8">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center">
            <Dna className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[13px] font-bold">MolExplorer</span>
          <span className="text-[9px] text-slate-600 ml-0.5">Variant C · Multi-Molecule</span>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 bg-white/5 border-white/10 text-white text-[12px] h-7 focus:border-emerald-500/40"
            placeholder="Search molecules, formulas, properties…"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1">
          {["Low","Medium","High"].map(t => (
            <button
              key={t}
              onClick={() => setFilterTox(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                filterTox.includes(t)
                  ? t === "Low" ? "bg-emerald-600/20 border border-emerald-500/40 text-emerald-400"
                    : t === "Medium" ? "bg-yellow-600/20 border border-yellow-500/40 text-yellow-400"
                    : "bg-red-600/20 border border-red-500/40 text-red-400"
                  : "text-slate-500 hover:bg-white/5"
              }`}
            >
              Tox: {t}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/8" />

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="w-3 h-3 text-slate-600" />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-transparent border-none text-[11px] text-slate-400 outline-none cursor-pointer"
          >
            <option value="composite">Composite Score</option>
            <option value="binding">Binding Affinity</option>
            <option value="qed">QED Score</option>
            <option value="mw">MW</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setCompareMode(!compareMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium transition-all ${
              compareMode ? "bg-emerald-600/20 border border-emerald-500/40 text-emerald-400" : "border border-white/10 text-slate-400 hover:border-white/20"
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            Compare {selected.length > 0 && `(${selected.length})`}
          </button>

          <div className="flex rounded overflow-hidden border border-white/10">
            {[
              { mode: "grid" as const, icon: Grid2x2 },
              { mode: "list" as const, icon: LayoutList },
            ].map(({ mode, icon: Icon }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`p-1.5 ${viewMode === mode ? "bg-white/10" : "hover:bg-white/5"}`}
              >
                <Icon className="w-3.5 h-3.5 text-slate-400" />
              </button>
            ))}
          </div>

          <button className="p-1.5 rounded hover:bg-white/5 text-slate-500">
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Molecule Grid */}
        <div className="w-[340px] border-r border-white/8 flex flex-col shrink-0 bg-[#0a0c14]">
          <div className="px-3 py-2 border-b border-white/6 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{filtered.length} molecules</span>
            <button className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Import
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-2">
                {filtered.map(mol => (
                  <button
                    key={mol.id}
                    onClick={() => { setPrimary(mol.id); toggleSelect(mol.id); }}
                    className={`relative rounded-xl border text-left transition-all overflow-hidden ${
                      primary === mol.id
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : compareMode && selected.includes(mol.id)
                        ? "border-blue-500/40 bg-blue-500/5"
                        : "border-white/8 hover:border-white/15 bg-white/3"
                    }`}
                  >
                    {/* 3D preview */}
                    <div className="bg-black/30 flex items-center justify-center pt-2 pb-1 overflow-hidden">
                      <MiniMol rx={mol.rxOffset} ry={mol.ryOffset + ry * 0.3} color={mol.accentColor} />
                    </div>

                    <div className="px-2 pb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-slate-200">{mol.name}</span>
                        {mol.starred && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                      </div>
                      <div className="text-[9px] text-slate-500 font-mono mb-1.5">{mol.formula}</div>

                      {mol.tag && (
                        <Badge className={`text-[8px] px-1.5 py-0 mb-1 ${
                          mol.tag === "Lead" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : mol.tag === "Toxic" ? "bg-red-500/10 text-red-400 border-red-500/20"
                          : mol.tag === "Potent" ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                          : "bg-white/5 text-slate-500"
                        }`}>
                          {mol.tag}
                        </Badge>
                      )}

                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1 bg-white/8 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${mol.composite * 100}%`, backgroundColor: mol.accentColor + "cc" }} />
                        </div>
                        <span className="text-[9px] font-semibold" style={{ color: mol.accentColor }}>{mol.composite.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Selection indicator */}
                    {compareMode && selected.includes(mol.id) && (
                      <div className="absolute top-1.5 left-1.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-white">{selected.indexOf(mol.id) + 1}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map(mol => (
                  <button
                    key={mol.id}
                    onClick={() => { setPrimary(mol.id); toggleSelect(mol.id); }}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all ${
                      primary === mol.id ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/6 hover:border-white/12 bg-white/2"
                    }`}
                  >
                    <div className="w-14 h-10 bg-black/30 rounded-lg shrink-0 flex items-center justify-center overflow-hidden">
                      <MiniMol rx={mol.rxOffset} ry={mol.ryOffset} color={mol.accentColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-200">{mol.name}</span>
                        {mol.tag && <Badge className="text-[8px] px-1 py-0 bg-white/5 text-slate-500">{mol.tag}</Badge>}
                      </div>
                      <div className="text-[9px] text-slate-500 font-mono">{mol.formula} · {mol.mw} Da</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-bold" style={{ color: mol.accentColor }}>{mol.composite.toFixed(2)}</div>
                      <div className={`text-[9px] ${mol.tox === "Low" ? "text-emerald-400" : mol.tox === "Medium" ? "text-yellow-400" : "text-red-400"}`}>{mol.tox} tox</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center: Primary 3D Viewer */}
        <div className="flex-1 flex flex-col relative bg-[#070810]">
          {/* Ambient */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full blur-[100px]"
              style={{ backgroundColor: primaryMol.accentColor + "15" }} />
          </div>

          {/* Grid */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
            backgroundSize: "35px 35px",
          }} />

          {/* Molecule info overlay */}
          <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: primaryMol.accentColor }} />
            <span className="text-[13px] font-semibold text-white">{primaryMol.name}</span>
            <span className="text-[11px] text-slate-500 font-mono">{primaryMol.formula}</span>
            {primaryMol.tag && (
              <Badge className="text-[9px] px-2 py-0" style={{ color: primaryMol.accentColor, backgroundColor: primaryMol.accentColor + "20", borderColor: primaryMol.accentColor + "40" }}>
                {primaryMol.tag}
              </Badge>
            )}
          </div>

          {/* Molecule render */}
          <div className="flex-1 flex items-center justify-center relative z-10">
            <div style={{ transform: `scale(${zoom})`, cursor: "grab" }}>
              <BigMol rx={rx} ry={ry} zoom={1} color={primaryMol.accentColor} />
            </div>
          </div>

          {/* Controls overlay */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 bg-black/50 backdrop-blur-md border border-white/8 rounded-full px-5 py-2.5">
            <button onClick={() => { setRx(0); setRy(0.6); }} className="text-slate-500 hover:text-slate-300">
              <RotateCcw className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-white/10" />
            <button onClick={() => setZoom(z => Math.max(0.4, z - 0.15))} className="text-slate-500 hover:text-slate-300"><ZoomOut className="w-4 h-4" /></button>
            <Slider value={[zoom]} onValueChange={([v]) => setZoom(v)} min={0.4} max={2.2} step={0.05}
              className="w-20 [&_[role=slider]]:bg-emerald-500 [&_[role=slider]]:border-0 [&_[role=slider]]:w-3 [&_[role=slider]]:h-3" />
            <button onClick={() => setZoom(z => Math.min(2.2, z + 0.15))} className="text-slate-500 hover:text-slate-300"><ZoomIn className="w-4 h-4" /></button>
            <div className="w-px h-4 bg-white/10" />
            <button onClick={() => setRy(r => r + 0.25)} className="text-slate-500 hover:text-slate-300 text-[11px]">↻ Y</button>
            <button onClick={() => setRx(r => r + 0.25)} className="text-slate-500 hover:text-slate-300 text-[11px]">↻ X</button>
          </div>

          {/* Property chips at top right */}
          <div className="absolute top-4 right-4 z-10 flex gap-1.5 flex-wrap justify-end max-w-[200px]">
            {[
              { label: `QED ${primaryMol.qed}`, color: "emerald" },
              { label: primaryMol.binding, color: "blue" },
              { label: `SA ${primaryMol.sa}`, color: "violet" },
            ].map(({ label, color }) => (
              <div key={label} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                color === "emerald" ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/8"
                : color === "blue" ? "border-blue-500/30 text-blue-400 bg-blue-500/8"
                : "border-violet-500/30 text-violet-400 bg-violet-500/8"
              }`}>
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Comparison / Properties Panel */}
        <div className="w-[280px] border-l border-white/8 bg-[#0c0e18] flex flex-col shrink-0">
          {compareMode && selected.length > 1 ? (
            <div className="flex flex-col h-full">
              <div className="p-3 border-b border-white/8">
                <div className="text-[11px] font-semibold text-slate-300 mb-1">Property Comparison</div>
                <div className="text-[10px] text-slate-600">{selected.length} molecules selected</div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {["QED Score","Binding Affinity","Tox Risk","MW","SA Score","Composite"].map(prop => (
                  <div key={prop}>
                    <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">{prop}</div>
                    {selected.map(sid => {
                      const mol = MOLECULES.find(m => m.id === sid)!;
                      const vals: Record<string, number> = {
                        "QED Score": mol.qed,
                        "Binding Affinity": 1 - parseFloat(mol.binding) / 50,
                        "Tox Risk": mol.tox === "Low" ? 0.9 : mol.tox === "Medium" ? 0.5 : 0.15,
                        "MW": mol.mw / 500,
                        "SA Score": 1 - mol.sa / 6,
                        "Composite": mol.composite,
                      };
                      const val = vals[prop] ?? 0;
                      return (
                        <div key={sid} className="flex items-center gap-2 mb-1">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: mol.accentColor }} />
                          <span className="text-[9px] text-slate-500 w-12 shrink-0">{mol.name}</span>
                          <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${val * 100}%`, backgroundColor: mol.accentColor + "cc" }} />
                          </div>
                          <span className="text-[9px] font-medium text-slate-300 w-10 text-right">{(val * 100).toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Radar overlay preview */}
                <div>
                  <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Profile Overlay</div>
                  <div className="bg-black/30 rounded-xl p-4 flex items-center justify-center">
                    <svg width="140" height="130">
                      {(() => {
                        const axes = ["QED","Bind","Tox","MW","SA"];
                        const cx = 70, cy = 60, r = 50;
                        const toPoint = (angle: number, dist: number) => {
                          const rad = (angle * Math.PI) / 180;
                          return { x: cx + dist * Math.cos(rad), y: cy + dist * Math.sin(rad) };
                        };
                        const outerPts = axes.map((_, i) => toPoint(-90 + i * 72, r));
                        const paths = selected.slice(0, 3).map(sid => {
                          const mol = MOLECULES.find(m => m.id === sid)!;
                          const vals = [mol.qed, 1 - parseFloat(mol.binding) / 50, mol.tox === "Low" ? 0.9 : 0.4, mol.mw / 500, 1 - mol.sa / 6];
                          const pts = vals.map((v, i) => toPoint(-90 + i * 72, r * v));
                          return { mol, pts };
                        });

                        return (
                          <>
                            {outerPts.map((p, i) => (
                              <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                            ))}
                            {[0.25, 0.5, 0.75, 1].map(f => (
                              <polygon key={f}
                                points={outerPts.map(p => {
                                  const dx = p.x - cx, dy = p.y - cy;
                                  return `${cx + dx * f},${cy + dy * f}`;
                                }).join(" ")}
                                fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1"
                              />
                            ))}
                            {paths.map(({ mol, pts }, i) => (
                              <path key={i}
                                d={pts.map((p, j) => `${j === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + "Z"}
                                fill={mol.accentColor + "22"} stroke={mol.accentColor} strokeWidth="1.5"
                              />
                            ))}
                            {axes.map((ax, i) => {
                              const p = toPoint(-90 + i * 72, r + 14);
                              return <text key={ax} x={p.x} y={p.y} fill="#64748b" fontSize="8" textAnchor="middle" dominantBaseline="central">{ax}</text>;
                            })}
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                </div>

                <Button className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/25 text-emerald-300 text-[11px] h-7 gap-1.5">
                  <Download className="w-3 h-3" /> Export Comparison
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="p-3 border-b border-white/8">
                <div className="text-[11px] font-semibold text-slate-300 mb-0.5">Molecule Details</div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: primaryMol.accentColor }} />
                  <span className="text-[10px] text-slate-500">{primaryMol.name} · {primaryMol.formula}</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {/* Score breakdown */}
                <div>
                  <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Score Breakdown</div>
                  {[
                    { label: "QED Score", val: primaryMol.qed, max: 1, color: "emerald" },
                    { label: "Binding (inv)", val: 1 - parseFloat(primaryMol.binding) / 50, max: 1, color: "blue" },
                    { label: "Tox Safety", val: primaryMol.tox === "Low" ? 0.92 : primaryMol.tox === "Medium" ? 0.55 : 0.2, max: 1, color: primaryMol.tox === "Low" ? "emerald" : primaryMol.tox === "Medium" ? "yellow" : "red" },
                    { label: "Composite", val: primaryMol.composite, max: 1, color: "violet" },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="mb-2">
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-slate-400">{label}</span>
                        <span className={`font-semibold text-${color}-400`}>{(val * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full bg-${color}-500`} style={{ width: `${val * 100}%`, opacity: 0.75 }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-white/8 pt-3">
                  <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Properties</div>
                  <div className="space-y-1.5">
                    {[
                      { k: "Molecular Weight", v: `${primaryMol.mw} Da` },
                      { k: "Binding Affinity", v: primaryMol.binding },
                      { k: "Toxicity Risk", v: primaryMol.tox },
                      { k: "Synthetic Accessibility", v: `${primaryMol.sa}/10` },
                      { k: "H-Bond Donors", v: "1" },
                      { k: "H-Bond Acceptors", v: "2" },
                      { k: "Rotatable Bonds", v: "4" },
                      { k: "logP", v: "3.18" },
                    ].map(({ k, v }) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-[10px] text-slate-500">{k}</span>
                        <span className="text-[10px] text-slate-300 font-medium">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/8 pt-3">
                  <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Structural Alerts</div>
                  {primaryMol.tox === "Low" ? (
                    <div className="text-[10px] text-emerald-400 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      No structural alerts detected
                    </div>
                  ) : (
                    <div className="text-[10px] text-yellow-400 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                      1 alert: reactive electrophile
                    </div>
                  )}
                </div>

                <Button className="w-full" style={{ backgroundColor: primaryMol.accentColor + "30", borderColor: primaryMol.accentColor + "50", color: primaryMol.accentColor }}>
                  <Zap className="w-3 h-3 mr-1.5" /> Run Full Analysis
                </Button>

                <Button variant="outline" className="w-full border-white/10 text-slate-400 hover:text-white text-[11px] gap-1.5">
                  <ChevronRight className="w-3 h-3" /> Open in HakaseAI Platform
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
