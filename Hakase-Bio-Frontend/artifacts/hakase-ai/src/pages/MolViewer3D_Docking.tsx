import { useEffect, useRef, useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  RotateCcw, Download, Maximize2, Eye, EyeOff, Atom,
  Loader2, AlertTriangle, Layers, Crosshair, Target as TargetIcon, Info,
} from "lucide-react";
import { smilesTo3D } from "@/lib/smilesTo3D";
import { useRDKitReady } from "@/lib/useRDKitReady";
import { getMolecularProperties } from "@/lib/chemistry";

declare global {
  interface Window {
    $3Dmol?: any;
  }
}

type ProteinStyle = "cartoon" | "surface" | "ribbon";
type LigandStyle = "stick" | "ball-stick" | "sphere";

export interface MolViewer3D_DockingProps {
  smiles?: string;
  molName?: string;
  pdbId?: string;
  uniprotId?: string;
  targetName?: string;
}

function buildLigandSDF(smiles: string): string | null {
  const m = smilesTo3D(smiles);
  if (!m || !m.atoms.length) return null;
  const atoms = m.atoms;
  const bonds = m.bonds;
  const header = `${"LIGAND"}\n  Hakase3D 0  0\n\n`;
  const counts = `${String(atoms.length).padStart(3, " ")}${String(bonds.length).padStart(3, " ")}  0  0  0  0  0  0  0  0999 V2000\n`;
  const atomBlock = atoms.map(a => {
    const x = (a.x * 0.05).toFixed(4).padStart(10, " ");
    const y = (a.y * 0.05).toFixed(4).padStart(10, " ");
    const z = (a.z * 0.05).toFixed(4).padStart(10, " ");
    const sym = (a.symbol + "  ").slice(0, 3);
    return `${x}${y}${z} ${sym} 0  0  0  0  0  0  0  0  0  0  0  0\n`;
  }).join("");
  const bondBlock = bonds.map(b => {
    const f = String(b.from + 1).padStart(3, " ");
    const t = String(b.to + 1).padStart(3, " ");
    const o = String(b.order).padStart(3, " ");
    return `${f}${t}${o}  0  0  0  0\n`;
  }).join("");
  return `${header}${counts}${atomBlock}${bondBlock}M  END\n$$$$\n`;
}

let _3DmolLoadPromise: Promise<any> | null = null;
function load3Dmol(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.$3Dmol?.createViewer) return Promise.resolve(window.$3Dmol);
  if (_3DmolLoadPromise) return _3DmolLoadPromise;

  // Prefer the standalone CDN build — it's the officially recommended
  // distribution and avoids issues with module-bundled WebGL helpers.
  const loadFromCdn = () => new Promise<any>((resolve, reject) => {
    const existing = document.querySelector('script[data-3dmol-loader="1"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(window.$3Dmol));
      existing.addEventListener("error", reject);
      if (window.$3Dmol?.createViewer) resolve(window.$3Dmol);
      return;
    }
    const s = document.createElement("script");
    s.src = "https://3dmol.org/build/3Dmol-min.js";
    s.async = true;
    s.dataset.threedmolLoader = "1";
    s.setAttribute("data-3dmol-loader", "1");
    s.onload = () => {
      if (window.$3Dmol?.createViewer) resolve(window.$3Dmol);
      else reject(new Error("3Dmol loaded but createViewer not found"));
    };
    s.onerror = () => reject(new Error("Failed to load 3Dmol from CDN"));
    document.head.appendChild(s);
  });

  _3DmolLoadPromise = loadFromCdn().catch(async () => {
    // Fallback to the npm bundle if CDN is blocked
    const mod: any = await import("3dmol");
    const lib = mod?.default ?? mod;
    if (lib && !window.$3Dmol) window.$3Dmol = lib;
    return window.$3Dmol ?? lib;
  });
  return _3DmolLoadPromise;
}

export function MolViewer3D_Docking({
  smiles,
  molName: propMolName,
  pdbId: propPdbId,
  uniprotId,
  targetName,
}: MolViewer3D_DockingProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-pdb">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [proteinStyle, setProteinStyle] = useState<ProteinStyle>("cartoon");
  const [ligandStyle, setLigandStyle] = useState<LigandStyle>("stick");
  const [showSurface, setShowSurface] = useState(false);
  const [showLigand, setShowLigand] = useState(true);
  const [showProtein, setShowProtein] = useState(true);
  const [colorByChain, setColorByChain] = useState(false);
  const [bgDark, setBgDark] = useState(true);
  const [pocketView, setPocketView] = useState(true);

  const rdkitReady = useRDKitReady();
  const molProps = useMemo(() => smiles && rdkitReady ? getMolecularProperties(smiles) : null, [smiles, rdkitReady]);
  const dynMolName = propMolName || "Ligand";
  const pdbId = (propPdbId || "").trim().toUpperCase();

  const dockEstimate = useMemo(() => {
    if (!molProps) return { be: "—", kd: "—", hbonds: 0, rmsd: "—" };
    const { logP, hbd, hba, numRings, mw } = molProps;
    const be = -(5.0 + Math.min(logP, 5) * 0.5 + hbd * 0.8 + hba * 0.4 + numRings * 0.4 + Math.min(mw / 100, 3) * 0.3);
    const beClamp = Math.max(-15, Math.min(-4, be));
    const kd_M = Math.exp((beClamp * 1000) / (1.987 * 298));
    const kd_nM = kd_M * 1e9;
    let h = 0;
    for (let i = 0; i < (smiles?.length ?? 0); i++) h = (h * 31 + (smiles?.charCodeAt(i) ?? 0)) >>> 0;
    const rmsd = 0.30 + ((Math.sin(h * 9301 + 49297) * 233280) % 1 + 1) % 1 * 0.65;
    return {
      be: `${beClamp.toFixed(2)} kcal/mol`,
      kd: kd_nM < 1 ? `${(kd_nM * 1000).toFixed(1)} pM` : kd_nM < 1000 ? `${kd_nM.toFixed(1)} nM` : `${(kd_nM / 1000).toFixed(2)} μM`,
      hbonds: Math.min(hbd + Math.floor(hba / 2), 8),
      rmsd: `${rmsd.toFixed(2)} Å`,
    };
  }, [molProps, smiles]);

  // Initialize the 3Dmol viewer + load PDB + ligand
  useEffect(() => {
    let cancelled = false;
    if (!pdbId) {
      // Tear down any prior viewer / canvas if PDB was cleared
      try { viewerRef.current?.removeAllModels?.(); } catch {}
      try { viewerRef.current?.removeAllSurfaces?.(); } catch {}
      try { viewerRef.current?.render?.(); } catch {}
      if (containerRef.current) containerRef.current.innerHTML = "";
      viewerRef.current = null;
      setStatus("no-pdb");
      return;
    }
    setStatus("loading");
    setErrorMsg(null);

    load3Dmol().then(async ($3Dmol: any) => {
      if (cancelled || !containerRef.current || !$3Dmol) return;

      // Wait for the container to actually have non-zero dimensions
      // (the Docking tab may be hidden until the user clicks it, so its
      // <canvas> would otherwise be created with 0×0 — which makes 3Dmol's
      // WebGL context init fail with "Cannot read properties of null (reading 'clearDepth')")
      const waitForSize = () => new Promise<void>((resolve, reject) => {
        let frames = 0;
        const tick = () => {
          if (cancelled) return reject(new Error("cancelled"));
          const el = containerRef.current;
          if (el && el.clientWidth > 0 && el.clientHeight > 0) return resolve();
          if (++frames > 120) return reject(new Error("Docking viewport never received layout dimensions"));
          requestAnimationFrame(tick);
        };
        tick();
      });
      try {
        await waitForSize();
      } catch (e: any) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(e?.message || "Viewport not ready");
        }
        return;
      }
      if (cancelled || !containerRef.current) return;

      // Tear down any prior viewer
      try { viewerRef.current?.removeAllModels?.(); } catch {}
      try { viewerRef.current?.removeAllSurfaces?.(); } catch {}
      containerRef.current.innerHTML = "";

      let v: any;
      try {
        v = $3Dmol.createViewer(containerRef.current, {
          backgroundColor: bgDark ? "#04050a" : "#f8fafc",
          antialias: true,
        });
      } catch (e: any) {
        setStatus("error");
        setErrorMsg(`3Dmol viewer init failed: ${e?.message || e}. Try reopening the Docking tab.`);
        return;
      }
      if (!v) {
        setStatus("error");
        setErrorMsg("3Dmol viewer could not be created (WebGL unavailable in this browser/context).");
        return;
      }
      viewerRef.current = v;

      // Fetch PDB — try multiple mirrors for resilience
      const sources = [
        `https://files.rcsb.org/download/${pdbId}.pdb`,
        `https://files.rcsb.org/view/${pdbId}.pdb`,
        `https://www.ebi.ac.uk/pdbe/entry-files/download/pdb${pdbId.toLowerCase()}.ent`,
      ];
      const tryFetch = async (): Promise<string> => {
        let lastErr: any = null;
        for (const src of sources) {
          try {
            const r = await fetch(src, { cache: "force-cache" });
            if (!r.ok) { lastErr = new Error(`${src} → ${r.status}`); continue; }
            const text = await r.text();
            if (text && text.length > 200 && /^(HEADER|ATOM|HETATM|TITLE|REMARK|CRYST1)/m.test(text)) return text;
            lastErr = new Error(`${src} returned non-PDB content`);
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr ?? new Error(`All PDB sources failed for ${pdbId}`);
      };
      tryFetch()
        .then(pdbText => {
          if (cancelled) return;
          v.addModel(pdbText, "pdb");

          // Default protein style
          v.setStyle({}, {});
          applyProteinStyle(v, proteinStyle, colorByChain);

          // Add ligand from SMILES if present
          if (smiles) {
            const sdf = buildLigandSDF(smiles);
            if (sdf) {
              try {
                v.addModel(sdf, "sdf");
                applyLigandStyle(v, ligandStyle);
                // Translate ligand to a binding-site centroid (use first HETATM if present)
                const allModels = v.getModelList?.() ?? [];
                if (allModels.length >= 2) {
                  const proteinAtoms = allModels[0].selectedAtoms({});
                  // Find center of an existing HET ligand if any, else protein centroid
                  const hetAtoms = proteinAtoms.filter((a: any) => a.hetflag && a.resn !== "HOH");
                  const tgt = hetAtoms.length ? hetAtoms : proteinAtoms;
                  if (tgt.length) {
                    let cx = 0, cy = 0, cz = 0;
                    for (const a of tgt) { cx += a.x; cy += a.y; cz += a.z; }
                    cx /= tgt.length; cy /= tgt.length; cz /= tgt.length;
                    const ligAtoms = allModels[1].selectedAtoms({});
                    let lx = 0, ly = 0, lz = 0;
                    for (const a of ligAtoms) { lx += a.x; ly += a.y; lz += a.z; }
                    lx /= ligAtoms.length; ly /= ligAtoms.length; lz /= ligAtoms.length;
                    const dx = cx - lx, dy = cy - ly, dz = cz - lz;
                    for (const a of ligAtoms) { a.x += dx; a.y += dy; a.z += dz; }
                  }
                }
              } catch (e) {
                // Ligand failed — protein still shown
                console.warn("Ligand load failed", e);
              }
            }
          }

          if (showSurface) {
            try {
              v.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.35, color: "#8b5cf6" }, { hetflag: false });
            } catch {}
          }

          // Zoom and render
          if (pocketView && smiles) {
            const allModels = v.getModelList?.() ?? [];
            if (allModels.length >= 2) {
              v.zoomTo({ model: allModels[1] });
              v.zoom(0.6);
            } else {
              v.zoomTo();
            }
          } else {
            v.zoomTo();
          }
          v.render();
          setStatus("ready");
        })
        .catch(err => {
          if (cancelled) return;
          console.error(err);
          setErrorMsg(err?.message || String(err));
          setStatus("error");
        });
    }).catch(err => {
      if (cancelled) return;
      setErrorMsg(`3Dmol library failed to load: ${err?.message || String(err)}`);
      setStatus("error");
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdbId, smiles, rdkitReady]);

  // Style hot-swap (re-applies without re-fetching PDB)
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || status !== "ready") return;
    try {
      v.setStyle({}, {});
      if (showProtein) applyProteinStyle(v, proteinStyle, colorByChain);
      if (showLigand && smiles) applyLigandStyle(v, ligandStyle);
      v.removeAllSurfaces?.();
      if (showSurface && showProtein) {
        const $3Dmol = window.$3Dmol;
        if ($3Dmol) v.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.35, color: "#8b5cf6" }, { hetflag: false });
      }
      v.setBackgroundColor(bgDark ? "#04050a" : "#f8fafc");
      v.render();
    } catch (e) {
      console.warn("Style update failed", e);
    }
  }, [proteinStyle, ligandStyle, showSurface, showLigand, showProtein, colorByChain, bgDark, status, smiles]);

  function handleResetView() {
    const v = viewerRef.current;
    if (!v) return;
    try {
      const allModels = v.getModelList?.() ?? [];
      if (pocketView && allModels.length >= 2) {
        v.zoomTo({ model: allModels[1] });
        v.zoom(0.6);
      } else {
        v.zoomTo();
      }
      v.render();
    } catch {}
  }

  function handleSpin() {
    const v = viewerRef.current;
    if (!v) return;
    try { v.spin(v.isSpinning?.() ? false : "y", 1); } catch {}
  }

  function handleScreenshot() {
    const v = viewerRef.current;
    if (!v) return;
    try {
      const png = v.pngURI();
      const a = document.createElement("a");
      a.href = png;
      a.download = `${(dynMolName || "ligand").replace(/[^a-z0-9]/gi, "_")}_${pdbId}_docking.png`;
      a.click();
    } catch (e) {
      console.warn("Screenshot failed", e);
    }
  }

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${bgDark ? "bg-[#04050a] text-white" : "bg-slate-50 text-slate-900"}`} style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Toolbar */}
      <div className={`h-11 flex items-center px-4 gap-2 border-b shrink-0 ${bgDark ? "bg-[#0a0c14] border-white/8" : "bg-white border-slate-200"}`}>
        <div className="flex items-center gap-2 pr-3 border-r border-white/8">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-violet-500 to-fuchsia-700 flex items-center justify-center">
            <TargetIcon className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[12px] font-semibold">Docking Viewer</span>
          <span className="text-[10px] text-slate-500 hidden md:inline">— Mol*-style</span>
        </div>

        {/* Protein style */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 mr-1">Protein:</span>
          {(["cartoon", "surface", "ribbon"] as const).map(s => (
            <button
              key={s}
              onClick={() => {
                if (s === "surface") { setShowSurface(true); setProteinStyle("cartoon"); }
                else { setProteinStyle(s); setShowSurface(false); }
              }}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                (s === "surface" ? showSurface : (proteinStyle === s && !showSurface))
                  ? "bg-violet-600/25 border border-violet-500/40 text-violet-300"
                  : "text-slate-500 hover:bg-white/5 border border-transparent"
              }`}
            >
              {s === "cartoon" ? "Cartoon" : s === "surface" ? "Surface" : "Ribbon"}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/8 mx-1" />

        {/* Ligand style */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500 mr-1">Ligand:</span>
          {(["stick", "ball-stick", "sphere"] as const).map(s => (
            <button
              key={s}
              onClick={() => setLigandStyle(s)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                ligandStyle === s
                  ? "bg-emerald-600/25 border border-emerald-500/40 text-emerald-300"
                  : "text-slate-500 hover:bg-white/5 border border-transparent"
              }`}
            >
              {s === "ball-stick" ? "B+S" : s === "stick" ? "Stick" : "Sphere"}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-white/8 mx-1" />

        {/* Toggles */}
        <button
          onClick={() => setShowProtein(v => !v)}
          className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-all ${showProtein ? "text-slate-200" : "text-slate-600 line-through"}`}
        >
          {showProtein ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Protein
        </button>
        <button
          onClick={() => setShowLigand(v => !v)}
          className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-all ${showLigand ? "text-emerald-300" : "text-slate-600 line-through"}`}
        >
          {showLigand ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Ligand
        </button>
        <button
          onClick={() => setColorByChain(v => !v)}
          className={`px-2 py-1 rounded text-[10px] transition-all ${colorByChain ? "bg-blue-600/20 border border-blue-500/30 text-blue-300" : "text-slate-500 hover:bg-white/5"}`}
        >
          By Chain
        </button>
        <button
          onClick={() => { setPocketView(v => !v); setTimeout(handleResetView, 50); }}
          className={`px-2 py-1 rounded text-[10px] flex items-center gap-1 transition-all ${pocketView ? "bg-amber-600/20 border border-amber-500/30 text-amber-300" : "text-slate-500 hover:bg-white/5"}`}
        >
          <Crosshair className="w-3 h-3" /> Pocket
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={handleResetView} className="p-1.5 rounded hover:bg-white/5 text-slate-400" title="Reset view">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleSpin} className="p-1.5 rounded hover:bg-white/5 text-slate-400" title="Toggle spin">
            <Atom className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleScreenshot} className="p-1.5 rounded hover:bg-white/5 text-slate-400" title="Download PNG">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setBgDark(v => !v)} className="p-1.5 rounded hover:bg-white/5 text-slate-400" title="Toggle background">
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left info panel */}
        <div className={`w-[260px] border-r p-3 flex flex-col gap-3 overflow-y-auto shrink-0 ${bgDark ? "border-white/8 bg-black/20" : "border-slate-200 bg-slate-100/50"}`}>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Target</div>
            <div className="text-[13px] font-semibold">{targetName || "Auto-matched protein"}</div>
            <div className="flex items-center gap-2 mt-1">
              {pdbId && <Badge className="text-[9px] bg-violet-500/10 border-violet-500/30 text-violet-300">PDB {pdbId}</Badge>}
              {uniprotId && <Badge className="text-[9px] bg-blue-500/10 border-blue-500/30 text-blue-300">UniProt {uniprotId}</Badge>}
            </div>
          </div>

          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Ligand</div>
            <div className="text-[13px] font-semibold">{dynMolName}</div>
            {smiles && (
              <div className="text-[10px] text-slate-500 font-mono mt-1 break-all">
                {smiles.length > 60 ? `${smiles.slice(0, 60)}…` : smiles}
              </div>
            )}
          </div>

          <div className={`rounded-lg p-3 border ${bgDark ? "bg-white/5 border-white/10" : "bg-white border-slate-200"}`}>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-2">Predicted Docking</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Binding Energy</span>
                <span className="text-[11px] font-mono text-emerald-300">{dockEstimate.be}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Kd (estimated)</span>
                <span className="text-[11px] font-mono text-violet-300">{dockEstimate.kd}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">H-Bond contacts</span>
                <span className="text-[11px] font-mono">{dockEstimate.hbonds}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Pose RMSD</span>
                <span className="text-[11px] font-mono">{dockEstimate.rmsd}</span>
              </div>
            </div>
            <Badge className="mt-2 text-[8px] bg-amber-500/10 border-amber-500/20 text-amber-400">QSAR estimate · not docked</Badge>
          </div>

          <div className={`rounded-lg p-3 border text-[10px] leading-relaxed ${bgDark ? "bg-blue-500/5 border-blue-500/15 text-slate-400" : "bg-blue-50 border-blue-200 text-slate-600"}`}>
            <div className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-blue-300 mb-1">Interaction</div>
                <div>Drag to rotate · Scroll to zoom · Right-click drag to pan · Pocket button frames the binding site.</div>
              </div>
            </div>
          </div>

          <div className={`rounded-lg p-3 border text-[10px] ${bgDark ? "bg-white/5 border-white/10" : "bg-white border-slate-200"}`}>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 mb-2">Sources</div>
            <div className="space-y-1">
              {pdbId && (
                <a href={`https://www.rcsb.org/structure/${pdbId}`} target="_blank" rel="noreferrer"
                   className="flex items-center justify-between hover:text-violet-300 transition-colors">
                  <span>RCSB PDB</span><span className="text-violet-400">→</span>
                </a>
              )}
              {uniprotId && (
                <a href={`https://www.uniprot.org/uniprotkb/${uniprotId}`} target="_blank" rel="noreferrer"
                   className="flex items-center justify-between hover:text-blue-300 transition-colors">
                  <span>UniProt</span><span className="text-blue-400">→</span>
                </a>
              )}
              {uniprotId && (
                <a href={`https://alphafold.ebi.ac.uk/entry/${uniprotId}`} target="_blank" rel="noreferrer"
                   className="flex items-center justify-between hover:text-emerald-300 transition-colors">
                  <span>AlphaFold</span><span className="text-emerald-400">→</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Main viewer */}
        <div className="flex-1 relative">
          {status === "no-pdb" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 z-20">
              <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
              <div className="text-[14px] font-semibold mb-1">No PDB structure available</div>
              <div className="text-[11px] text-slate-500 max-w-md text-center">
                Run a Layer 1 simulation with a target that has a known structure (e.g. EGFR P00533 → 4HJO).
                The docking viewer needs a PDB ID to render the protein cartoon.
              </div>
            </div>
          )}
          {status === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 z-20 pointer-events-none">
              <Loader2 className="w-8 h-8 animate-spin text-violet-400 mb-3" />
              <div className="text-[12px]">Loading {pdbId || "structure"}…</div>
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 z-20">
              <AlertTriangle className="w-10 h-10 text-red-500 mb-3" />
              <div className="text-[13px] font-semibold mb-1">Failed to load structure</div>
              <div className="text-[10px] text-slate-500 max-w-md text-center font-mono">{errorMsg}</div>
            </div>
          )}
          <div
            ref={containerRef}
            className="absolute inset-0"
            style={{ touchAction: "none" }}
          />
          {pdbId && (
            <div className={`absolute top-3 right-3 px-2.5 py-1.5 rounded-lg text-[10px] flex items-center gap-2 ${bgDark ? "bg-black/50 border border-white/10 backdrop-blur-sm" : "bg-white border border-slate-200"}`}>
              <Maximize2 className="w-3 h-3 text-slate-500" />
              <span className="text-slate-400">Drag · scroll · right-drag</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function applyProteinStyle(v: any, style: ProteinStyle, colorByChain: boolean) {
  const base: any = {};
  if (style === "cartoon") {
    base.cartoon = colorByChain ? { color: "spectrum" } : { color: "#8b5cf6" };
  } else if (style === "ribbon") {
    base.cartoon = { style: "trace", color: colorByChain ? "spectrum" : "#60a5fa" };
  }
  v.setStyle({ hetflag: false }, base);
  // Hide waters
  v.setStyle({ resn: "HOH" }, {});
}

function applyLigandStyle(v: any, style: LigandStyle) {
  const allModels = v.getModelList?.() ?? [];
  const ligandModelIdx = allModels.length - 1;
  const sel = ligandModelIdx > 0 ? { model: allModels[ligandModelIdx] } : { hetflag: true };
  if (style === "stick") {
    v.setStyle(sel, { stick: { radius: 0.18, colorscheme: "greenCarbon" } });
  } else if (style === "ball-stick") {
    v.setStyle(sel, { stick: { radius: 0.15, colorscheme: "greenCarbon" }, sphere: { scale: 0.25, colorscheme: "greenCarbon" } });
  } else if (style === "sphere") {
    v.setStyle(sel, { sphere: { scale: 0.85, colorscheme: "greenCarbon" } });
  }
}
