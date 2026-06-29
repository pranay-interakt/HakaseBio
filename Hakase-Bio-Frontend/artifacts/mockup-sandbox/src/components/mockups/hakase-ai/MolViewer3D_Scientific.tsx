import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import {
  RotateCcw, ZoomIn, ZoomOut, Download, Settings2, Layers,
  Eye, ChevronDown, X, Maximize2, RefreshCw, Crosshair,
  SlidersHorizontal, Grid3x3, Table, BarChart2, Activity,
  ChevronRight, Plus, Search, Lock, Unlock, Copy, FileText
} from "lucide-react";

const ATOM_COLORS: Record<string, string> = {
  C: "#b0b8c8", N: "#60a5fa", O: "#f87171",
  H: "#e2e8f0", S: "#facc15", P: "#fb923c", F: "#34d399", Cl: "#4ade80",
};

interface AtomData {
  id: number; symbol: string; x: number; y: number; z: number;
  residue?: string; charge?: number;
}

const ATOMS: AtomData[] = [
  { id: 0, symbol: "C", x: 0, y: 0, z: 0, charge: 0 },
  { id: 1, symbol: "C", x: 45, y: -28, z: 8 },
  { id: 2, symbol: "C", x: 90, y: 0, z: 4 },
  { id: 3, symbol: "C", x: 90, y: 45, z: -4 },
  { id: 4, symbol: "C", x: 45, y: 73, z: -8 },
  { id: 5, symbol: "C", x: 0, y: 45, z: -4 },
  { id: 6, symbol: "C", x: 140, y: -22, z: 16 },
  { id: 7, symbol: "C", x: 180, y: 8, z: 8 },
  { id: 8, symbol: "O", x: 222, y: -12, z: 16, charge: -0.5 },
  { id: 9, symbol: "O", x: 180, y: 54, z: 0, charge: -0.5 },
  { id: 10, symbol: "C", x: -50, y: -22, z: 12 },
  { id: 11, symbol: "C", x: -50, y: 67, z: -12 },
  { id: 12, symbol: "C", x: -90, y: 22, z: 4 },
];

const BONDS = [
  { from: 0, to: 1, order: 2 }, { from: 1, to: 2, order: 1 },
  { from: 2, to: 3, order: 2 }, { from: 3, to: 4, order: 1 },
  { from: 4, to: 5, order: 2 }, { from: 5, to: 0, order: 1 },
  { from: 2, to: 6, order: 1 }, { from: 6, to: 7, order: 1 },
  { from: 7, to: 8, order: 2 }, { from: 7, to: 9, order: 1 },
  { from: 0, to: 10, order: 1 }, { from: 5, to: 11, order: 1 },
  { from: 10, to: 12, order: 1 }, { from: 11, to: 12, order: 1 },
];

function rot(x: number, y: number, z: number, rx: number, ry: number) {
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  return { x: x1, y: y * cx - z1 * sx, z: y * sx + z1 * cx };
}

function MolView({ rx, ry, zoom, mode, color }: { rx: number; ry: number; zoom: number; mode: string; color: string }) {
  const cx = 180, cy = 140;
  const projected = ATOMS.map(a => {
    const r = rot(a.x - 60, a.y - 22, a.z, rx, ry);
    const s = zoom * (1 + r.z * 0.0008);
    return { ...a, px: cx + r.x * zoom, py: cy + r.y * zoom, pz: r.z, s };
  }).sort((a, b) => a.pz - b.pz);
  const pm = Object.fromEntries(projected.map(p => [p.id, p]));

  const atomColor = (sym: string) => {
    if (color === "cpk") return ATOM_COLORS[sym] || "#94a3b8";
    if (color === "chain") return "#60a5fa";
    if (color === "bfactor") {
      const heat = ["#3b82f6","#22c55e","#eab308","#f97316","#ef4444"];
      return heat[Math.floor(Math.random() * heat.length)];
    }
    return ATOM_COLORS[sym] || "#94a3b8";
  };

  if (mode === "surface") {
    return (
      <svg width="360" height="280">
        <defs>
          <radialGradient id="sG" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#4f46e5" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#1e1b4b" stopOpacity="0.9" />
          </radialGradient>
          <radialGradient id="sG2" cx="60%" cy="65%">
            <stop offset="0%" stopColor="#f87171" stopOpacity="0.5" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
          <filter id="sf"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <ellipse cx={cx} cy={cy} rx="145" ry="90" fill="url(#sG)" />
        <ellipse cx={cx + 40} cy={cy + 25} rx="40" ry="30" fill="url(#sG2)" />
        <ellipse cx={cx - 30} cy={cy - 15} rx="35" ry="22" fill="rgba(96,165,250,0.15)" />
        <text x={cx} y={cy + 100} fill="#818cf8" fontSize="8" textAnchor="middle" fontFamily="monospace">VDW Surface Electrostatics</text>
      </svg>
    );
  }

  return (
    <svg width="360" height="280">
      <defs>
        {Object.entries(ATOM_COLORS).map(([sym, col]) => (
          <radialGradient key={sym} id={`sg-${sym}`} cx="35%" cy="30%">
            <stop offset="0%" stopColor="white" stopOpacity="0.45" />
            <stop offset="45%" stopColor={col} />
            <stop offset="100%" stopColor={col} stopOpacity="0.55" />
          </radialGradient>
        ))}
        <filter id="ds"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#000" floodOpacity="0.6" /></filter>
      </defs>

      {BONDS.map((b, i) => {
        const f = pm[b.from], t = pm[b.to];
        if (!f || !t) return null;
        const dep = (f.pz + t.pz) / 2;
        const al = 0.35 + Math.max(0, Math.min(0.55, dep / 180));
        const dx = t.px - f.px, dy = t.py - f.py, len = Math.sqrt(dx * dx + dy * dy);
        if (b.order === 2 && len > 0) {
          const nx = -dy / len * 2.5, ny = dx / len * 2.5;
          return (
            <g key={i}>
              <line x1={f.px + nx} y1={f.py + ny} x2={t.px + nx} y2={t.py + ny} stroke={`rgba(200,210,230,${al})`} strokeWidth="2" />
              <line x1={f.px - nx} y1={f.py - ny} x2={t.px - nx} y2={t.py - ny} stroke={`rgba(200,210,230,${al})`} strokeWidth="2" />
            </g>
          );
        }
        return <line key={i} x1={f.px} y1={f.py} x2={t.px} y2={t.py} stroke={`rgba(200,210,230,${al})`} strokeWidth="2.5" />;
      })}

      {projected.map(a => {
        const r = mode === "spacefill" ? (({ C: 17, N: 15, O: 15, H: 10, S: 18 } as Record<string,number>)[a.symbol] || 14) * a.s
          : (({ C: 12, N: 11, O: 11, H: 7, S: 13 } as Record<string,number>)[a.symbol] || 10) * a.s;
        const ac = atomColor(a.symbol);
        return (
          <g key={a.id}>
            <circle cx={a.px} cy={a.py} r={r + 1.5} fill="black" opacity="0.25" />
            <circle cx={a.px} cy={a.py} r={r}
              fill={color === "cpk" ? `url(#sg-${a.symbol})` : ac}
              filter="url(#ds)"
              stroke={ac} strokeWidth="0.4" strokeOpacity="0.4"
            />
            {mode !== "spacefill" && (
              <text x={a.px} y={a.py + 3} fill="white" fontSize={7 * a.s}
                textAnchor="middle" dominantBaseline="central" fontWeight="700"
                style={{ userSelect: "none", pointerEvents: "none" }}>
                {a.symbol}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function MolViewer3D_Scientific() {
  const [rx, setRx] = useState(-0.3);
  const [ry, setRy] = useState(0.5);
  const [zoom, setZoom] = useState(0.95);
  const [mode, setMode] = useState("ball-stick");
  const [colorScheme, setColorScheme] = useState("cpk");
  const [selectedAtom, setSelectedAtom] = useState(2);
  const [measureMode, setMeasureMode] = useState<"none" | "distance" | "angle">("none");
  const [tab, setTab] = useState("atoms");
  const [locked, setLocked] = useState(false);

  const atomRows = ATOMS.map(a => ({
    ...a,
    name: `${a.symbol}${a.id + 1}`,
    x: a.x.toFixed(2), y: a.y.toFixed(2), z: a.z.toFixed(2),
    charge: (a.charge ?? 0).toFixed(2),
  }));

  const bondAngles = [
    { atoms: "C1-C2-C3", angle: "120.4°", type: "aromatic" },
    { atoms: "C2-C7-C8", angle: "111.2°", type: "sp3" },
    { atoms: "C7-C8=O1", angle: "124.8°", type: "carbonyl" },
    { atoms: "C8-O2-H", angle: "109.5°", type: "hydroxyl" },
  ];

  return (
    <div className="h-screen bg-[#0a0c12] text-white flex flex-col overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Top toolbar */}
      <div className="h-11 border-b border-white/8 bg-[#0d0f1a] flex items-center px-4 gap-2 shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-1.5 pr-3 border-r border-white/8">
          <Grid3x3 className="w-4 h-4 text-blue-400" />
          <span className="text-[12px] font-semibold text-slate-300">MolView Pro</span>
          <span className="text-[9px] text-slate-600 ml-1">Variant B · Scientific</span>
        </div>

        {/* File */}
        <div className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer px-2">File</div>
        <div className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer px-2">View</div>
        <div className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer px-2">Tools</div>
        <div className="text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer px-2">Analysis</div>

        <div className="w-px h-5 bg-white/8 mx-1" />

        {/* Render mode buttons */}
        <div className="flex items-center gap-1">
          {[
            { id: "ball-stick", label: "B+S" },
            { id: "spacefill", label: "CPK" },
            { id: "wireframe", label: "Wire" },
            { id: "surface", label: "Surf" },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-2.5 py-1 rounded text-[10px] font-mono font-medium transition-all ${
                mode === m.id ? "bg-blue-600/25 border border-blue-500/40 text-blue-300" : "text-slate-500 hover:bg-white/5"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/8 mx-1" />

        {/* Color scheme */}
        <div className="flex items-center gap-1">
          {["cpk","chain","bfactor"].map(c => (
            <button
              key={c}
              onClick={() => setColorScheme(c)}
              className={`px-2 py-1 rounded text-[10px] transition-all ${colorScheme === c ? "bg-white/10 text-slate-200" : "text-slate-500 hover:bg-white/5"}`}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/8 mx-1" />

        {/* Measurement tools */}
        <button
          onClick={() => setMeasureMode(m => m === "distance" ? "none" : "distance")}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] transition-all ${measureMode === "distance" ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-400" : "text-slate-500 hover:bg-white/5"}`}
        >
          <Crosshair className="w-3 h-3" /> Distance
        </button>
        <button
          onClick={() => setMeasureMode(m => m === "angle" ? "none" : "angle")}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] transition-all ${measureMode === "angle" ? "bg-orange-600/20 border border-orange-500/30 text-orange-400" : "text-slate-500 hover:bg-white/5"}`}
        >
          <SlidersHorizontal className="w-3 h-3" /> Angle
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setLocked(!locked)} className={`p-1.5 rounded hover:bg-white/5 transition-colors ${locked ? "text-amber-400" : "text-slate-500"}`}>
            {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
          <button className="p-1.5 rounded hover:bg-white/5 text-slate-500"><Download className="w-3.5 h-3.5" /></button>
          <button className="p-1.5 rounded hover:bg-white/5 text-slate-500"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 3D viewport — left 60% */}
        <div className="flex-1 relative flex flex-col bg-[#07080e]">
          {/* Status bar inside viewport */}
          <div className="absolute top-0 left-0 right-0 h-7 flex items-center px-3 gap-4 text-[10px] text-slate-600 border-b border-white/4 bg-black/20 z-10">
            <span>Ibuprofen-Analog-001</span>
            <span className="text-slate-700">|</span>
            <span>C₁₃H₁₈O₂</span>
            <span className="text-slate-700">|</span>
            <span>{ATOMS.length} atoms · {BONDS.length} bonds</span>
            {measureMode !== "none" && (
              <span className={`ml-2 ${measureMode === "distance" ? "text-emerald-500" : "text-orange-500"}`}>
                {measureMode === "distance" ? "📏 Click 2 atoms to measure distance" : "📐 Click 3 atoms to measure angle"}
              </span>
            )}
            <span className="ml-auto">Zoom: {(zoom * 100).toFixed(0)}%</span>
          </div>

          {/* Molecule render */}
          <div className="flex-1 flex items-center justify-center" style={{ paddingTop: "28px" }}>
            {/* Grid */}
            <div className="absolute inset-0" style={{
              backgroundImage: `linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)`,
              backgroundSize: "30px 30px",
            }} />

            <div style={{ transform: `scale(${zoom * 1.2})`, cursor: locked ? "not-allowed" : "grab" }}>
              <MolView rx={rx} ry={ry} zoom={1} mode={mode} color={colorScheme} />
            </div>
          </div>

          {/* Bottom controls */}
          <div className="absolute bottom-0 left-0 right-0 h-10 border-t border-white/6 bg-black/40 backdrop-blur-sm flex items-center px-4 gap-4">
            <div className="flex items-center gap-2">
              <button onClick={() => { setRx(prev => prev + 0.1); }} className="text-slate-500 hover:text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-white/8">↑ X</button>
              <button onClick={() => { setRy(prev => prev + 0.15); }} className="text-slate-500 hover:text-slate-300 text-[10px] px-1.5 py-0.5 rounded border border-white/8">→ Y</button>
              <button onClick={() => { setRx(0); setRy(0); }} className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-white/5">
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>

            <div className="flex items-center gap-2 ml-2">
              <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} className="text-slate-500 hover:text-slate-300"><ZoomOut className="w-3.5 h-3.5" /></button>
              <Slider value={[zoom]} onValueChange={([v]) => setZoom(v)} min={0.3} max={2} step={0.05}
                className="w-20 [&_[role=slider]]:bg-blue-500 [&_[role=slider]]:border-0 [&_[role=slider]]:w-3 [&_[role=slider]]:h-3"
              />
              <button onClick={() => setZoom(z => Math.min(2, z + 0.1))} className="text-slate-500 hover:text-slate-300"><ZoomIn className="w-3.5 h-3.5" /></button>
            </div>

            <div className="w-px h-4 bg-white/8" />

            <div className="flex items-center gap-1.5">
              {["Front","Back","Top","Side","ISO"].map(v => (
                <button key={v} className="text-[9px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded border border-white/6 hover:border-white/15">{v}</button>
              ))}
            </div>

            <span className="ml-auto text-[10px] text-slate-600">
              OpenGL ES 3.0 · Ball & Stick · CPK Colors
            </span>
          </div>
        </div>

        {/* Right panel — data 40% */}
        <div className="w-[340px] border-l border-white/8 bg-[#0d0f1a] flex flex-col shrink-0">
          {/* Molecule header */}
          <div className="p-3 border-b border-white/8">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold text-white">Ibuprofen-Analog-001</div>
                <div className="text-[10px] text-slate-500 font-mono mt-0.5">C₁₃H₁₈O₂ · MW 206.28 · CAS 15687-27-1</div>
              </div>
              <div className="flex gap-1">
                <button className="p-1 rounded hover:bg-white/5 text-slate-500"><Copy className="w-3.5 h-3.5" /></button>
                <button className="p-1 rounded hover:bg-white/5 text-slate-500"><FileText className="w-3.5 h-3.5" /></button>
              </div>
            </div>

            {/* Quick metrics */}
            <div className="grid grid-cols-4 gap-1.5 mt-3">
              {[
                { label: "QED", val: "0.72", color: "text-emerald-400" },
                { label: "logP", val: "3.18", color: "text-blue-400" },
                { label: "TPSA", val: "37.3", color: "text-violet-400" },
                { label: "HBD", val: "1", color: "text-amber-400" },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-white/5 rounded p-1.5 text-center">
                  <div className={`text-[12px] font-bold ${color}`}>{val}</div>
                  <div className="text-[8px] text-slate-600 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/8 shrink-0">
            {[
              { id: "atoms", label: "Atoms" },
              { id: "bonds", label: "Bonds" },
              { id: "energy", label: "Energy" },
              { id: "contacts", label: "Contacts" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-2 text-[10px] font-medium border-b-2 transition-all ${
                  tab === t.id ? "border-blue-500 text-blue-300" : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {tab === "atoms" && (
              <div>
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-[#0d0f1a] border-b border-white/8">
                    <tr>
                      {["#","Sym","X","Y","Z","q"].map(h => (
                        <th key={h} className="text-left py-1.5 px-2 text-slate-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {atomRows.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => setSelectedAtom(a.id)}
                        className={`border-b border-white/4 cursor-pointer ${selectedAtom === a.id ? "bg-blue-600/10" : "hover:bg-white/3"}`}
                      >
                        <td className="py-1.5 px-2 text-slate-600">{a.id + 1}</td>
                        <td className="py-1.5 px-2">
                          <span className="font-bold" style={{ color: ATOM_COLORS[a.symbol] || "#94a3b8" }}>{a.symbol}</span>
                        </td>
                        <td className="py-1.5 px-2 font-mono text-slate-400">{a.x}</td>
                        <td className="py-1.5 px-2 font-mono text-slate-400">{a.y}</td>
                        <td className="py-1.5 px-2 font-mono text-slate-400">{a.z}</td>
                        <td className="py-1.5 px-2 text-slate-500">{a.charge}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "bonds" && (
              <div className="p-3 space-y-4">
                <div>
                  <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Bond Angles</div>
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-white/8">
                        <th className="text-left py-1.5 pr-3 text-slate-500 font-medium">Atoms</th>
                        <th className="text-left py-1.5 pr-3 text-slate-500 font-medium">Angle</th>
                        <th className="text-left py-1.5 text-slate-500 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bondAngles.map((b) => (
                        <tr key={b.atoms} className="border-b border-white/4">
                          <td className="py-1.5 pr-3 text-slate-300 font-mono">{b.atoms}</td>
                          <td className="py-1.5 pr-3 text-blue-400 font-semibold">{b.angle}</td>
                          <td className="py-1.5">
                            <Badge className="text-[8px] bg-white/5 text-slate-500">{b.type}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Bond Lengths</div>
                  {[
                    { b: "C1=C2", l: "1.397 Å", t: "aromatic" },
                    { b: "C2–C7", l: "1.503 Å", t: "sp3–sp2" },
                    { b: "C7=O1", l: "1.208 Å", t: "carbonyl" },
                    { b: "C7–O2", l: "1.325 Å", t: "ester" },
                  ].map(({ b, l, t }) => (
                    <div key={b} className="flex justify-between py-1 border-b border-white/4">
                      <span className="text-slate-300 font-mono text-[10px]">{b}</span>
                      <span className="text-emerald-400 text-[10px] font-medium">{l}</span>
                      <Badge className="text-[8px] bg-white/5 text-slate-500">{t}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "energy" && (
              <div className="p-3 space-y-3">
                <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Force Field: MMFF94</div>
                {[
                  { label: "Total Energy", val: "-312.4 kcal/mol", color: "text-blue-400" },
                  { label: "Stretch Energy", val: "8.2 kcal/mol", color: "text-slate-300" },
                  { label: "Bend Energy", val: "3.1 kcal/mol", color: "text-slate-300" },
                  { label: "Torsion Energy", val: "6.8 kcal/mol", color: "text-slate-300" },
                  { label: "VDW Energy", val: "-22.4 kcal/mol", color: "text-emerald-400" },
                  { label: "Electrostatic", val: "-308.1 kcal/mol", color: "text-emerald-400" },
                ].map(({ label, val, color }) => (
                  <div key={label} className="flex justify-between items-center py-1 border-b border-white/4">
                    <span className="text-[10px] text-slate-400">{label}</span>
                    <span className={`text-[10px] font-semibold ${color}`}>{val}</span>
                  </div>
                ))}
                <Button className="w-full mt-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/25 text-blue-300 text-[11px] h-7">
                  Run Energy Minimization
                </Button>
              </div>
            )}

            {tab === "contacts" && (
              <div className="p-3 space-y-2">
                <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Protein–Ligand Contacts (EGFR)</div>
                {[
                  { res: "LYS745", type: "H-bond", dist: "2.84 Å", color: "text-blue-400" },
                  { res: "MET793", type: "H-bond", dist: "3.02 Å", color: "text-blue-400" },
                  { res: "LEU858", type: "Hydrophobic", dist: "3.84 Å", color: "text-amber-400" },
                  { res: "PHE856", type: "π-stacking", dist: "4.12 Å", color: "text-violet-400" },
                  { res: "ALA743", type: "Hydrophobic", dist: "3.91 Å", color: "text-amber-400" },
                  { res: "VAL726", type: "Hydrophobic", dist: "4.05 Å", color: "text-amber-400" },
                ].map(({ res, type, dist, color }) => (
                  <div key={res} className="flex items-center gap-2 py-1.5 border-b border-white/4">
                    <div className="w-1.5 h-1.5 rounded-full bg-current shrink-0" style={{ color: color.replace("text-","") }} />
                    <span className="text-[10px] text-slate-300 font-mono w-14">{res}</span>
                    <Badge className="text-[8px] bg-white/5 text-slate-500 flex-1">{type}</Badge>
                    <span className={`text-[10px] font-medium ${color}`}>{dist}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lipinski panel */}
          <div className="p-3 border-t border-white/8 shrink-0">
            <div className="text-[9px] text-slate-600 uppercase tracking-wider mb-2">Ro5 Drug-likeness</div>
            <div className="space-y-1.5">
              {[
                { rule: "MW ≤ 500 Da", val: "206.3", pass: true },
                { rule: "logP ≤ 5", val: "3.18", pass: true },
                { rule: "HBD ≤ 5", val: "1", pass: true },
                { rule: "HBA ≤ 10", val: "2", pass: true },
              ].map(({ rule, val, pass }) => (
                <div key={rule} className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${pass ? "bg-emerald-400" : "bg-red-400"}`} />
                  <span className="text-[10px] text-slate-400 flex-1">{rule}</span>
                  <span className={`text-[10px] font-medium ${pass ? "text-emerald-400" : "text-red-400"}`}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
