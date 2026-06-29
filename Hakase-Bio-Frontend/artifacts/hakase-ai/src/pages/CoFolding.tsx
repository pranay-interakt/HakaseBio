/**
 * Biologics Co-Folding — L2 Stage 2b
 * ─────────────────────────────────────────────────────────────────────────
 * AlphaFold3-class biomolecular structure + binding-affinity prediction.
 *
 * Engine: Boltz-2 (MIT license — usable commercially, unlike AlphaFold 3's own
 * weights). Co-folds an arbitrary complex of proteins, peptides, DNA, RNA,
 * small-molecule ligands, ions, modified residues and covalent bonds, and
 * predicts a binding affinity for a ligand binder.
 *
 * This page lets a client design a complex, validate it for free (no GPU),
 * preview the generated Boltz YAML + a cost estimate, then dispatch the job
 * to the Boltz-2 RunPod GPU endpoint and explore the predicted structure,
 * per-residue / interface confidence, PAE and affinity.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { NavBar } from "@/components/NavBar";
import {
  getCofoldConfig,
  validateCofold,
  runCofoldToCompletion,
  plddtBand,
  type CoFoldEntityType,
  type CoFoldEntityInput,
  type CoFoldBond,
  type CoFoldPocket,
  type CoFoldRequest,
  type CoFoldResult,
  type CoFoldConfigStatus,
  type CoFoldValidateResult,
  type CoFoldJobStatus,
} from "@/lib/aiService";

declare global {
  interface Window {
    $3Dmol?: any;
  }
}

// ── 3Dmol loader (shared pattern with the docking viewer) ───────────────────
let _3DmolLoadPromise: Promise<any> | null = null;
function load3Dmol(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.$3Dmol?.createViewer) return Promise.resolve(window.$3Dmol);
  if (_3DmolLoadPromise) return _3DmolLoadPromise;
  _3DmolLoadPromise = new Promise<any>((resolve, reject) => {
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
    s.onload = () => {
      if (window.$3Dmol?.createViewer) resolve(window.$3Dmol);
      else reject(new Error("3Dmol loaded but createViewer not found"));
    };
    s.onerror = () => reject(new Error("Failed to load 3Dmol from CDN"));
    document.head.appendChild(s);
  });
  return _3DmolLoadPromise;
}

// ── Local entity model (adds a stable React key) ────────────────────────────
interface LocalMod {
  position: number | "";
  ccd: string;
}
interface LocalEntity {
  _key: string;
  type: CoFoldEntityType;
  id: string;
  sequence: string;
  ligandMode: "smiles" | "ccd";
  smiles: string;
  ccd: string;
  copies: number;
  use_msa: boolean;
  cyclic: boolean;
  modifications: LocalMod[];
}

interface LocalBond {
  _key: string;
  a1chain: string;
  a1res: number | "";
  a1atom: string;
  a2chain: string;
  a2res: number | "";
  a2atom: string;
}

interface LocalContact {
  _key: string;
  chain: string;
  residue: number | "";
}

const CHAIN_COLORS = [
  "#8b5cf6", "#22d3ee", "#34d399", "#fbbf24",
  "#f472b6", "#60a5fa", "#f87171", "#a3e635",
];

const ENTITY_META: Record<CoFoldEntityType, { label: string; accent: string; hint: string }> = {
  protein: { label: "Protein", accent: "text-violet-300", hint: "Receptor / antibody / protein biologic — one-letter amino-acid sequence" },
  peptide: { label: "Peptide", accent: "text-cyan-300", hint: "Therapeutic peptide (2–150 aa) — defaults to single-sequence MSA" },
  dna: { label: "DNA", accent: "text-emerald-300", hint: "DNA strand — A / C / G / T" },
  rna: { label: "RNA", accent: "text-emerald-300", hint: "RNA strand (siRNA / ASO / aptamer) — A / C / G / U" },
  ligand: { label: "Ligand", accent: "text-amber-300", hint: "Small molecule — SMILES or a 3-letter CCD code" },
  ion: { label: "Ion", accent: "text-slate-300", hint: "Metal ion / cofactor — CCD code (MG, ZN, NA, CA, MN, FE…)" },
};

let _keyCounter = 0;
const newKey = () => `k${++_keyCounter}_${Date.now().toString(36)}`;

function nextChainId(entities: LocalEntity[]): string {
  const used = new Set(entities.map((e) => e.id.toUpperCase()));
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(c)) return c;
  return `Z${entities.length}`;
}

function blankEntity(type: CoFoldEntityType, entities: LocalEntity[]): LocalEntity {
  return {
    _key: newKey(),
    type,
    id: nextChainId(entities),
    sequence: "",
    ligandMode: "smiles",
    smiles: "",
    ccd: "",
    copies: 1,
    use_msa: type === "protein",
    cyclic: false,
    modifications: [],
  };
}

// ── Example designs (instant, client-ready starting points) ─────────────────
type ExampleKey = "peptide_target" | "protein_ligand_affinity" | "nucleic_protein";

function buildExample(key: ExampleKey): { name: string; entities: LocalEntity[]; affinityBinder: string } {
  if (key === "peptide_target") {
    return {
      name: "GLP-1 peptide vs receptor ECD",
      affinityBinder: "",
      entities: [
        {
          ...blankEntity("protein", []), id: "A",
          sequence:
            "RPQGATVSLWETVQKWREYRRQCQRSLTEDPPPATDLFCNRTFDEYACWPDGEPGSFVNVSCPWYLPWASSVPQGHVYRFCTAEGLWLQKDNSSLPWRDLSECEES",
          use_msa: true,
        },
        {
          ...blankEntity("peptide", []), id: "P",
          sequence: "HAEGTFTSDVSSYLEGQAAKEFIAWLVKGR",
        },
      ],
    };
  }
  if (key === "protein_ligand_affinity") {
    return {
      name: "Kinase + inhibitor (affinity)",
      affinityBinder: "L",
      entities: [
        {
          ...blankEntity("protein", []), id: "A",
          sequence:
            "GSHMSLQDPKHTVSVSPESTPVKPATSLLNTNMSGAAAPVTNGSMSEDDFNRTSALNTSSGRTSEMSGSEMSSPLPSSPGSPATPSPRAAAGSAASTRPSPALSSGSPSSSGSGTPSPS",
          use_msa: true,
        },
        {
          ...blankEntity("ligand", []), id: "L",
          ligandMode: "smiles",
          smiles: "Cc1ccc(cc1Nc2nccc(n2)c3cccnc3)NC(=O)c4ccc(cc4)CN5CCN(CC5)C",
        },
      ],
    };
  }
  // nucleic_protein
  return {
    name: "Transcription factor + dsDNA",
    affinityBinder: "",
    entities: [
      {
        ...blankEntity("protein", []), id: "A",
        sequence:
          "MKQLNSKLLLNRTLPGRELSLDQVANEMGISKSYLSKIERGLSTPSIQSLEKLANALDVPISYFFCESNQPVLISDLHPHA",
        use_msa: true,
      },
      { ...blankEntity("dna", []), id: "D", sequence: "GCGTGGGCGTGGC" },
      { ...blankEntity("dna", []), id: "E", sequence: "GCCACGCCCACGC" },
    ],
  };
}

// ── small helpers ───────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  return n.toFixed(digits);
}
function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ===========================================================================
// 3D structure viewer
// ===========================================================================
function StructureViewer({
  structure,
  format,
  chainIds,
  colorMode,
}: {
  structure: string;
  format: "mmcif" | "pdb";
  chainIds: string[];
  colorMode: "plddt" | "chain";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let viewer: any = null;
    setLoading(true);
    setError(null);
    load3Dmol()
      .then(($3Dmol: any) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        try {
          viewer = $3Dmol.createViewer(containerRef.current, { backgroundColor: "#0a0b10" });
        } catch (e: any) {
          setError(`3Dmol viewer init failed: ${e?.message || e}`);
          setLoading(false);
          return;
        }
        if (!viewer) {
          setError("WebGL is unavailable in this browser/context.");
          setLoading(false);
          return;
        }
        try {
          viewer.addModel(structure, format === "mmcif" ? "cif" : "pdb");
        } catch (e: any) {
          setError(`Could not parse the predicted structure: ${e?.message || e}`);
          setLoading(false);
          return;
        }

        const plddtColor = (atom: any): number => {
          const b = typeof atom?.b === "number" ? atom.b : 0;
          if (b >= 90) return 0x2563eb;
          if (b >= 70) return 0x22d3ee;
          if (b >= 50) return 0xfacc15;
          return 0xf97316;
        };

        if (colorMode === "plddt") {
          viewer.setStyle({}, { cartoon: { colorfunc: plddtColor } });
        } else {
          viewer.setStyle({}, { cartoon: { color: "#3b4252" } });
          chainIds.forEach((ch, i) => {
            viewer.setStyle({ chain: ch }, { cartoon: { color: CHAIN_COLORS[i % CHAIN_COLORS.length] } });
          });
        }
        // Ligands + ions (HETATM) — always shown as sticks + spheres.
        viewer.addStyle({ hetflag: true }, { stick: { radius: 0.18, colorscheme: "default" } });
        viewer.addStyle({ hetflag: true }, { sphere: { scale: 0.32, colorscheme: "default" } });

        viewer.zoomTo();
        viewer.render();
        viewer.zoom(1.15, 600);
        setLoading(false);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(`3Dmol failed to load: ${e?.message || e}`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      try {
        viewer?.clear?.();
      } catch {
        /* noop */
      }
    };
  }, [structure, format, colorMode, chainIds.join(",")]);

  return (
    <div className="relative w-full h-[420px] rounded-xl overflow-hidden border border-white/10 bg-[#0a0b10]">
      <div ref={containerRef} className="absolute inset-0" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-400">
          Rendering predicted complex…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[12px] text-rose-300">
          {error}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Per-residue pLDDT track
// ===========================================================================
function PlddtTrack({ plddt }: { plddt: number[] }) {
  const W = 640;
  const H = 90;
  const P = 8;
  if (!plddt.length) return null;
  const n = plddt.length;
  const sx = (i: number) => P + (i / Math.max(1, n - 1)) * (W - 2 * P);
  const sy = (v: number) => H - P - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * P);
  const path = plddt.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ");
  const mean = plddt.reduce((a, b) => a + b, 0) / n;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {[50, 70, 90].map((band) => (
          <line
            key={band}
            x1={P}
            x2={W - P}
            y1={sy(band)}
            y2={sy(band)}
            stroke={plddtBand(band).color}
            strokeWidth={0.5}
            strokeDasharray="3 3"
            opacity={0.45}
          />
        ))}
        <path d={`${path} L ${sx(n - 1)} ${H - P} L ${sx(0)} ${H - P} Z`} fill="#22d3ee" opacity={0.12} />
        <path d={path} fill="none" stroke="#22d3ee" strokeWidth={1.3} />
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1">
        <span>residue 1</span>
        <span>mean pLDDT {fmt(mean, 1)}</span>
        <span>residue {n}</span>
      </div>
    </div>
  );
}

// ===========================================================================
// PAE heatmap (canvas — handles up to a few hundred residues efficiently)
// ===========================================================================
function PaeHeatmap({ pae }: { pae: number[][] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !pae.length) return;
    const n = pae.length;
    cv.width = n;
    cv.height = n;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let maxV = 0;
    for (const row of pae) for (const v of row) if (v > maxV) maxV = v;
    maxV = Math.max(maxV, 1);
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const t = Math.min(1, (pae[i][j] ?? maxV) / maxV); // 0 good → 1 bad
        // teal (low error) → near-black (high error)
        const r = Math.round(20 + t * 30);
        const g = Math.round(200 - t * 175);
        const b = Math.round(190 - t * 150);
        const idx = (i * n + j) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [pae]);
  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-white/10"
        style={{ imageRendering: "pixelated", aspectRatio: "1 / 1" }}
      />
      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1.5">
        <span>Predicted aligned error</span>
        <span className="ml-auto flex items-center gap-1">
          low
          <span className="inline-block w-16 h-2 rounded" style={{ background: "linear-gradient(90deg,#14c8be,#142819)" }} />
          high
        </span>
      </div>
    </div>
  );
}

// ===========================================================================
// Confidence metric tile
// ===========================================================================
function MetricTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-[18px] font-semibold mt-0.5" style={{ color: tone || "#e2e8f0" }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ===========================================================================
// Main page
// ===========================================================================
export function CoFolding() {
  const [config, setConfig] = useState<CoFoldConfigStatus | null>(null);
  const [name, setName] = useState("My biologics complex");
  const [entities, setEntities] = useState<LocalEntity[]>(() => {
    const ex = buildExample("peptide_target");
    return ex.entities;
  });
  const [bonds, setBonds] = useState<LocalBond[]>([]);
  const [pocketEnabled, setPocketEnabled] = useState(false);
  const [pocketBinder, setPocketBinder] = useState("");
  const [pocketContacts, setPocketContacts] = useState<LocalContact[]>([]);
  const [pocketMaxDist, setPocketMaxDist] = useState(6);
  const [affinityBinder, setAffinityBinder] = useState("");

  const [diffusionSamples, setDiffusionSamples] = useState(1);
  const [recyclingSteps, setRecyclingSteps] = useState(3);
  const [usePotentials, setUsePotentials] = useState(false);
  const [noKernels, setNoKernels] = useState(false);

  const [validation, setValidation] = useState<CoFoldValidateResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<CoFoldResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [colorMode, setColorMode] = useState<"plddt" | "chain">("plddt");
  const [modelIdx, setModelIdx] = useState(0);
  const [showYaml, setShowYaml] = useState(false);

  useEffect(() => {
    getCofoldConfig().then(setConfig);
  }, []);

  const ligandEntities = useMemo(() => entities.filter((e) => e.type === "ligand"), [entities]);

  // ── build the request from local UI state ────────────────────────────────
  function buildRequest(): CoFoldRequest {
    const reqEntities: CoFoldEntityInput[] = entities.map((e) => {
      const base: CoFoldEntityInput = { type: e.type, id: e.id.toUpperCase(), copies: e.copies };
      if (e.type === "protein" || e.type === "peptide") {
        base.sequence = e.sequence;
        base.use_msa = e.use_msa;
        base.cyclic = e.cyclic;
        const mods = e.modifications
          .filter((m) => m.position !== "" && m.ccd.trim())
          .map((m) => ({ position: Number(m.position), ccd: m.ccd.trim().toUpperCase() }));
        if (mods.length) base.modifications = mods;
      } else if (e.type === "dna" || e.type === "rna") {
        base.sequence = e.sequence;
        base.cyclic = e.cyclic;
      } else if (e.type === "ligand") {
        if (e.ligandMode === "smiles") base.smiles = e.smiles.trim();
        else base.ccd = e.ccd.trim().toUpperCase();
      } else {
        base.ccd = e.ccd.trim().toUpperCase();
      }
      return base;
    });

    const reqBonds: CoFoldBond[] = bonds
      .filter((b) => b.a1chain && b.a1res !== "" && b.a1atom && b.a2chain && b.a2res !== "" && b.a2atom)
      .map((b) => ({
        atom1: { chain: b.a1chain.toUpperCase(), residue: Number(b.a1res), atom: b.a1atom.toUpperCase() },
        atom2: { chain: b.a2chain.toUpperCase(), residue: Number(b.a2res), atom: b.a2atom.toUpperCase() },
      }));

    let pocket: CoFoldPocket | null = null;
    if (pocketEnabled && pocketBinder) {
      const contacts = pocketContacts
        .filter((c) => c.chain && c.residue !== "")
        .map((c) => ({ chain: c.chain.toUpperCase(), residue: Number(c.residue) }));
      if (contacts.length) pocket = { binder: pocketBinder.toUpperCase(), contacts, max_distance: pocketMaxDist };
    }

    return {
      name,
      entities: reqEntities,
      bonds: reqBonds.length ? reqBonds : undefined,
      pocket,
      affinity_binder: affinityBinder || null,
      options: {
        diffusion_samples: diffusionSamples,
        recycling_steps: recyclingSteps,
        use_msa_server: true,
        use_potentials: usePotentials,
        no_kernels: noKernels,
        affinity_mw_correction: false,
        output_format: "mmcif",
      },
    };
  }

  async function handleValidate() {
    setValidating(true);
    setValidationError(null);
    setValidation(null);
    try {
      const v = await validateCofold(buildRequest());
      setValidation(v);
    } catch (e: any) {
      setValidationError(e?.message || "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setRunError(null);
    setResult(null);
    setProgress("Submitting job…");
    try {
      const final: CoFoldJobStatus = await runCofoldToCompletion(buildRequest(), {
        onProgress: (s) => setProgress(s.progress || s.status),
      });
      if (final.status === "done" && final.result) {
        setResult(final.result);
        setModelIdx(0);
      } else {
        setRunError(final.error || "Co-folding job failed without a specific error.");
      }
    } catch (e: any) {
      setRunError(e?.message || "Co-folding run failed");
    } finally {
      setRunning(false);
    }
  }

  function loadExample(key: ExampleKey) {
    const ex = buildExample(key);
    setName(ex.name);
    setEntities(ex.entities.map((e) => ({ ...e, _key: newKey() })));
    setBonds([]);
    setPocketEnabled(false);
    setPocketContacts([]);
    setPocketBinder("");
    setAffinityBinder(ex.affinityBinder);
    setValidation(null);
    setValidationError(null);
    setResult(null);
    setRunError(null);
  }

  // ── entity mutation helpers ───────────────────────────────────────────────
  const updateEntity = (key: string, patch: Partial<LocalEntity>) =>
    setEntities((es) => es.map((e) => (e._key === key ? { ...e, ...patch } : e)));
  const removeEntity = (key: string) => setEntities((es) => es.filter((e) => e._key !== key));
  const addEntity = (type: CoFoldEntityType) =>
    setEntities((es) => [...es, blankEntity(type, es)]);

  const gpuReady = config?.configured === true;
  const activeModel =
    result && result.models && result.models.length > modelIdx ? result.models[modelIdx] : null;
  const viewerStructure = activeModel?.structure || result?.structure || "";
  const viewerFormat = (activeModel?.structure_format || result?.structure_format || "mmcif") as
    | "mmcif"
    | "pdb";
  const viewerPlddt = activeModel?.per_residue_plddt || result?.per_residue_plddt || [];
  const viewerConfidence = activeModel?.confidence || result?.confidence || null;
  const chainIdList = useMemo(() => {
    const ids: string[] = [];
    entities.forEach((e) => {
      const base = e.id.toUpperCase();
      ids.push(base);
      for (let c = 2; c <= e.copies; c++) ids.push(`${base}${c}`);
    });
    return ids;
  }, [entities]);

  return (
    <div className="min-h-screen bg-[#07080c] text-slate-200">
      <NavBar sticky />

      <div className="max-w-[1280px] mx-auto px-5 md:px-8 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-4 mb-6">
          <div className="flex-1 min-w-[280px]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-violet-400">
                L2 · Stage 2b
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
                Co-Folding · MIT
              </span>
            </div>
            <h1 className="text-[26px] font-bold text-white leading-tight">Biologics Co-Folding</h1>
            <p className="text-[13px] text-slate-400 mt-1.5 max-w-2xl">
              Deep-learning structure prediction for any complex — proteins, peptides, antibodies,
              DNA/RNA, ligands and ions — plus a binding-affinity head. Extends the platform beyond
              small molecules to peptide and biologic modalities.
            </p>
          </div>
          {/* GPU backend status */}
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-[11px] min-w-[230px] ${
              gpuReady
                ? "border-emerald-500/30 bg-emerald-500/10"
                : "border-amber-500/30 bg-amber-500/10"
            }`}
          >
            <div className="font-semibold flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${gpuReady ? "bg-emerald-400" : "bg-amber-400"}`}
              />
              {gpuReady ? "GPU backend online" : "GPU backend not configured"}
            </div>
            <div className="text-slate-400 mt-1 leading-relaxed">
              {gpuReady
                ? "Co-folding GPU endpoint is reachable. Designs can be run."
                : config?.reason ||
                  "Design building + validation work now; running requires the RunPod GPU endpoint."}
            </div>
          </div>
        </div>

        {/* AF3 licensing note */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 mb-6 text-[11.5px] text-slate-400 leading-relaxed">
          <span className="text-slate-300 font-semibold">Licensing</span>{" "}
          The co-folding engine is powered by an open, MIT-licensed deep-learning model
          that predicts complex structure for all supported molecule types and additionally
          provides a binding-affinity head. Model identity and version are recorded in the
          sealed evidence block for each run.
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-6">
          {/* ───────────────── LEFT: design builder ───────────────── */}
          <div className="space-y-4">
            {/* Examples */}
            <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
              <div className="text-[12px] font-semibold text-white mb-2">Start from an example</div>
              <div className="flex flex-wrap gap-2">
                {[
                  { k: "peptide_target" as const, label: "Peptide ↔ receptor" },
                  { k: "protein_ligand_affinity" as const, label: "Protein + ligand (affinity)" },
                  { k: "nucleic_protein" as const, label: "TF + dsDNA" },
                ].map((ex) => (
                  <button
                    key={ex.k}
                    onClick={() => loadExample(ex.k)}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 transition-colors"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Job name */}
            <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
              <label className="text-[11px] text-slate-400">Design name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/10 text-[12px] text-white outline-none focus:border-violet-500/50"
              />
            </div>

            {/* Entities */}
            <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[12px] font-semibold text-white">
                  Molecular entities{" "}
                  <span className="text-slate-500 font-normal">({entities.length})</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(Object.keys(ENTITY_META) as CoFoldEntityType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => addEntity(t)}
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-violet-500/15 hover:border-violet-500/40 text-slate-300 transition-colors"
                  >
                    + {ENTITY_META[t].label}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {entities.map((e) => (
                  <EntityCard
                    key={e._key}
                    entity={e}
                    onChange={(patch) => updateEntity(e._key, patch)}
                    onRemove={() => removeEntity(e._key)}
                    canRemove={entities.length > 1}
                  />
                ))}
                {entities.length === 0 && (
                  <div className="text-[11px] text-slate-500 italic py-3 text-center">
                    Add at least one entity to begin.
                  </div>
                )}
              </div>
            </div>

            {/* Affinity */}
            <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
              <div className="text-[12px] font-semibold text-white mb-1">Binding affinity</div>
              <p className="text-[10.5px] text-slate-500 mb-2 leading-relaxed">
                The co-folding engine predicts an IC50-like affinity + binder probability for one
                ligand against the protein receptor. Requires a ligand entity and at least one protein/peptide.
              </p>
              <select
                value={affinityBinder}
                onChange={(e) => setAffinityBinder(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-black/30 border border-white/10 text-[12px] text-white outline-none focus:border-violet-500/50"
              >
                <option value="">No affinity prediction</option>
                {ligandEntities.map((e) => (
                  <option key={e._key} value={e.id.toUpperCase()}>
                    Predict affinity for ligand {e.id.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Constraints */}
            <ConstraintsEditor
              bonds={bonds}
              setBonds={setBonds}
              pocketEnabled={pocketEnabled}
              setPocketEnabled={setPocketEnabled}
              pocketBinder={pocketBinder}
              setPocketBinder={setPocketBinder}
              pocketContacts={pocketContacts}
              setPocketContacts={setPocketContacts}
              pocketMaxDist={pocketMaxDist}
              setPocketMaxDist={setPocketMaxDist}
              entityIds={entities.map((e) => e.id.toUpperCase())}
            />

            {/* Options */}
            <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
              <div className="text-[12px] font-semibold text-white mb-3">Prediction options</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10.5px] text-slate-400">Diffusion samples</label>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={diffusionSamples}
                    onChange={(e) =>
                      setDiffusionSamples(Math.max(1, Math.min(25, Number(e.target.value) || 1)))
                    }
                    className="w-full mt-1 px-2 py-1 rounded-lg bg-black/30 border border-white/10 text-[12px] text-white outline-none focus:border-violet-500/50"
                  />
                </div>
                <div>
                  <label className="text-[10.5px] text-slate-400">Recycling steps</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={recyclingSteps}
                    onChange={(e) =>
                      setRecyclingSteps(Math.max(1, Math.min(10, Number(e.target.value) || 3)))
                    }
                    className="w-full mt-1 px-2 py-1 rounded-lg bg-black/30 border border-white/10 text-[12px] text-white outline-none focus:border-violet-500/50"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 mt-3 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={usePotentials}
                  onChange={(e) => setUsePotentials(e.target.checked)}
                  className="accent-violet-500"
                />
                Inference-time potentials (steric / clash refinement)
              </label>
              <label className="flex items-center gap-2 mt-2 text-[11px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={noKernels}
                  onChange={(e) => setNoKernels(e.target.checked)}
                  className="accent-violet-500"
                />
                Disable fast kernels (needed on older GPUs, e.g. V100)
              </label>
            </div>

            {/* Actions */}
            <div className="flex gap-2.5">
              <button
                onClick={handleValidate}
                disabled={validating || running || entities.length === 0}
                className="flex-1 py-2.5 rounded-xl border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-[12px] font-semibold text-slate-200 disabled:opacity-40 transition-colors"
              >
                {validating ? "Validating…" : "Validate design (free)"}
              </button>
              <button
                onClick={handleRun}
                disabled={running || validating || !gpuReady || entities.length === 0}
                title={gpuReady ? "Run on the co-folding GPU endpoint" : config?.reason || "GPU backend not configured"}
                className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-[12px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {running ? "Running…" : "Run co-folding"}
              </button>
            </div>
            {!gpuReady && (
              <p className="text-[10.5px] text-amber-300/80 -mt-1.5">
                Running is disabled until the co-folding GPU endpoint is configured. Validation
                still works and produces the design YAML + cost estimate.
              </p>
            )}
          </div>

          {/* ───────────────── RIGHT: results ───────────────── */}
          <div className="space-y-4">
            {/* Validation / error / progress */}
            {validationError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-[12px] text-rose-200">
                <div className="font-semibold mb-1">Design is not valid</div>
                {validationError}
              </div>
            )}

            {validation && !result && (
              <ValidationPanel
                validation={validation}
                showYaml={showYaml}
                setShowYaml={setShowYaml}
              />
            )}

            {running && (
              <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-4">
                <div className="text-[12px] font-semibold text-white mb-1.5">
                  Co-folding in progress…
                </div>
                <div className="text-[11px] text-slate-300">{progress}</div>
                <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full w-1/3 bg-violet-400 animate-pulse" />
                </div>
              </div>
            )}

            {runError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-[12px] text-rose-200">
                <div className="font-semibold mb-1">Co-folding failed</div>
                <div className="whitespace-pre-wrap break-words font-mono text-[10.5px]">
                  {runError}
                </div>
              </div>
            )}

            {!validation && !result && !running && !validationError && !runError && (
              <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-8 text-center">
                <div className="text-[13px] text-slate-300 font-semibold mb-1">
                  Build a complex, then validate or run
                </div>
                <div className="text-[11.5px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Validation is free and produces the design YAML plus a runtime / cost
                  estimate. Running dispatches the job to the GPU and returns the predicted 3D
                  structure, confidence, PAE and affinity.
                </div>
              </div>
            )}

            {/* Result */}
            {result && (
              <ResultPanel
                result={result}
                activeModelConfidence={viewerConfidence}
                viewerStructure={viewerStructure}
                viewerFormat={viewerFormat}
                viewerPlddt={viewerPlddt}
                chainIds={chainIdList}
                colorMode={colorMode}
                setColorMode={setColorMode}
                modelIdx={modelIdx}
                setModelIdx={setModelIdx}
                showYaml={showYaml}
                setShowYaml={setShowYaml}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Entity card
// ===========================================================================
function EntityCard({
  entity,
  onChange,
  onRemove,
  canRemove,
}: {
  entity: LocalEntity;
  onChange: (patch: Partial<LocalEntity>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const meta = ENTITY_META[entity.type];
  const isProteinLike = entity.type === "protein" || entity.type === "peptide";
  const isNucleic = entity.type === "dna" || entity.type === "rna";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[11px] font-semibold ${meta.accent}`}>{meta.label}</span>
        <input
          value={entity.id}
          onChange={(e) => onChange({ id: e.target.value.toUpperCase().slice(0, 4) })}
          className="w-14 px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-[11px] text-white text-center outline-none focus:border-violet-500/50"
          title="Chain id"
        />
        <span className="text-[10px] text-slate-500 flex-1 truncate">{meta.hint}</span>
        {canRemove && (
          <button
            onClick={onRemove}
            className="text-[11px] text-slate-500 hover:text-rose-300 px-1"
            title="Remove entity"
          >
            ✕
          </button>
        )}
      </div>

      {(isProteinLike || isNucleic) && (
        <textarea
          value={entity.sequence}
          onChange={(e) =>
            onChange({ sequence: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })
          }
          placeholder={
            entity.type === "dna"
              ? "ATGC…"
              : entity.type === "rna"
              ? "AUGC…"
              : "One-letter amino-acid sequence…"
          }
          rows={3}
          className="w-full px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-[11px] font-mono text-slate-200 outline-none focus:border-violet-500/50 resize-y"
        />
      )}

      {entity.type === "ligand" && (
        <div>
          <div className="flex gap-1.5 mb-1.5">
            {(["smiles", "ccd"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onChange({ ligandMode: m })}
                className={`text-[10px] px-2 py-0.5 rounded ${
                  entity.ligandMode === m
                    ? "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                    : "bg-white/[0.03] text-slate-400 border border-white/10"
                }`}
              >
                {m === "smiles" ? "SMILES" : "CCD code"}
              </button>
            ))}
          </div>
          {entity.ligandMode === "smiles" ? (
            <input
              value={entity.smiles}
              onChange={(e) => onChange({ smiles: e.target.value })}
              placeholder="e.g. CC(=O)Oc1ccccc1C(=O)O"
              className="w-full px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-[11px] font-mono text-slate-200 outline-none focus:border-violet-500/50"
            />
          ) : (
            <input
              value={entity.ccd}
              onChange={(e) => onChange({ ccd: e.target.value.toUpperCase().slice(0, 5) })}
              placeholder="e.g. ATP, HEM, STI"
              className="w-full px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-[11px] font-mono text-slate-200 outline-none focus:border-violet-500/50"
            />
          )}
        </div>
      )}

      {entity.type === "ion" && (
        <input
          value={entity.ccd}
          onChange={(e) => onChange({ ccd: e.target.value.toUpperCase().slice(0, 5) })}
          placeholder="Ion CCD code — MG, ZN, NA, CA, MN, FE…"
          className="w-full px-2 py-1.5 rounded-lg bg-black/30 border border-white/10 text-[11px] font-mono text-slate-200 outline-none focus:border-violet-500/50"
        />
      )}

      {/* Per-entity options */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
        {entity.type !== "ion" && (
          <label className="flex items-center gap-1 text-[10.5px] text-slate-400">
            copies
            <input
              type="number"
              min={1}
              max={12}
              value={entity.copies}
              onChange={(e) =>
                onChange({ copies: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })
              }
              className="w-12 px-1 py-0.5 rounded bg-black/30 border border-white/10 text-[10.5px] text-white text-center outline-none"
            />
          </label>
        )}
        {isProteinLike && (
          <label className="flex items-center gap-1 text-[10.5px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={entity.use_msa}
              onChange={(e) => onChange({ use_msa: e.target.checked })}
              className="accent-violet-500"
            />
            server MSA
          </label>
        )}
        {(isProteinLike || isNucleic) && (
          <label className="flex items-center gap-1 text-[10.5px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={entity.cyclic}
              onChange={(e) => onChange({ cyclic: e.target.checked })}
              className="accent-violet-500"
            />
            cyclic
          </label>
        )}
        {(isProteinLike || isNucleic) && entity.sequence && (
          <span className="text-[10px] text-slate-500">{entity.sequence.length} residues</span>
        )}
      </div>

      {/* Modifications (PTMs) */}
      {isProteinLike && (
        <div className="mt-2 pt-2 border-t border-white/5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-500">
              Modified residues / PTMs ({entity.modifications.length})
            </span>
            <button
              onClick={() =>
                onChange({ modifications: [...entity.modifications, { position: "", ccd: "" }] })
              }
              className="text-[10px] text-violet-300 hover:text-violet-200"
            >
              + add
            </button>
          </div>
          {entity.modifications.map((m, i) => (
            <div key={i} className="flex items-center gap-1.5 mb-1">
              <input
                type="number"
                min={1}
                value={m.position}
                placeholder="pos"
                onChange={(e) => {
                  const mods = [...entity.modifications];
                  mods[i] = { ...m, position: e.target.value === "" ? "" : Number(e.target.value) };
                  onChange({ modifications: mods });
                }}
                className="w-14 px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-[10.5px] text-white text-center outline-none"
              />
              <input
                value={m.ccd}
                placeholder="CCD (SEP, TPO, PTR…)"
                onChange={(e) => {
                  const mods = [...entity.modifications];
                  mods[i] = { ...m, ccd: e.target.value.toUpperCase().slice(0, 5) };
                  onChange({ modifications: mods });
                }}
                className="flex-1 px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-[10.5px] font-mono text-white outline-none"
              />
              <button
                onClick={() =>
                  onChange({ modifications: entity.modifications.filter((_, j) => j !== i) })
                }
                className="text-[10px] text-slate-500 hover:text-rose-300 px-1"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Constraints editor (bonds + pocket)
// ===========================================================================
function ConstraintsEditor({
  bonds,
  setBonds,
  pocketEnabled,
  setPocketEnabled,
  pocketBinder,
  setPocketBinder,
  pocketContacts,
  setPocketContacts,
  pocketMaxDist,
  setPocketMaxDist,
  entityIds,
}: {
  bonds: LocalBond[];
  setBonds: (b: LocalBond[]) => void;
  pocketEnabled: boolean;
  setPocketEnabled: (v: boolean) => void;
  pocketBinder: string;
  setPocketBinder: (v: string) => void;
  pocketContacts: LocalContact[];
  setPocketContacts: (c: LocalContact[]) => void;
  pocketMaxDist: number;
  setPocketMaxDist: (v: number) => void;
  entityIds: string[];
}) {
  const inp =
    "px-1.5 py-0.5 rounded bg-black/30 border border-white/10 text-[10.5px] text-white outline-none focus:border-violet-500/50";
  return (
    <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
      <div className="text-[12px] font-semibold text-white mb-1">Constraints (optional)</div>
      <p className="text-[10.5px] text-slate-500 mb-2.5 leading-relaxed">
        Covalent bonds model disulfides, side-chain cyclisation or covalent ligands. Pocket
        conditioning steers a binder toward known contact residues.
      </p>

      {/* Bonds */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-slate-300 font-medium">Covalent bonds</span>
        <button
          onClick={() =>
            setBonds([
              ...bonds,
              {
                _key: newKey(),
                a1chain: "",
                a1res: "",
                a1atom: "",
                a2chain: "",
                a2res: "",
                a2atom: "",
              },
            ])
          }
          className="text-[10px] text-violet-300 hover:text-violet-200"
        >
          + add bond
        </button>
      </div>
      {bonds.map((b) => (
        <div key={b._key} className="flex items-center gap-1 mb-1.5 flex-wrap">
          <input placeholder="chain" value={b.a1chain} onChange={(e) => setBonds(bonds.map((x) => (x._key === b._key ? { ...x, a1chain: e.target.value.toUpperCase() } : x)))} className={`${inp} w-12`} />
          <input placeholder="res" type="number" value={b.a1res} onChange={(e) => setBonds(bonds.map((x) => (x._key === b._key ? { ...x, a1res: e.target.value === "" ? "" : Number(e.target.value) } : x)))} className={`${inp} w-12`} />
          <input placeholder="atom" value={b.a1atom} onChange={(e) => setBonds(bonds.map((x) => (x._key === b._key ? { ...x, a1atom: e.target.value.toUpperCase() } : x)))} className={`${inp} w-14`} />
          <span className="text-slate-600 text-[11px]">↔</span>
          <input placeholder="chain" value={b.a2chain} onChange={(e) => setBonds(bonds.map((x) => (x._key === b._key ? { ...x, a2chain: e.target.value.toUpperCase() } : x)))} className={`${inp} w-12`} />
          <input placeholder="res" type="number" value={b.a2res} onChange={(e) => setBonds(bonds.map((x) => (x._key === b._key ? { ...x, a2res: e.target.value === "" ? "" : Number(e.target.value) } : x)))} className={`${inp} w-12`} />
          <input placeholder="atom" value={b.a2atom} onChange={(e) => setBonds(bonds.map((x) => (x._key === b._key ? { ...x, a2atom: e.target.value.toUpperCase() } : x)))} className={`${inp} w-14`} />
          <button onClick={() => setBonds(bonds.filter((x) => x._key !== b._key))} className="text-[10px] text-slate-500 hover:text-rose-300 px-1">✕</button>
        </div>
      ))}

      {/* Pocket */}
      <label className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5 text-[11px] text-slate-300 cursor-pointer">
        <input
          type="checkbox"
          checked={pocketEnabled}
          onChange={(e) => setPocketEnabled(e.target.checked)}
          className="accent-violet-500"
        />
        Pocket conditioning
      </label>
      {pocketEnabled && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10.5px] text-slate-400 w-16">binder</span>
            <select value={pocketBinder} onChange={(e) => setPocketBinder(e.target.value)} className={`${inp} flex-1`}>
              <option value="">— select entity —</option>
              {entityIds.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <span className="text-[10.5px] text-slate-400">max Å</span>
            <input type="number" min={2} max={20} step={0.5} value={pocketMaxDist} onChange={(e) => setPocketMaxDist(Number(e.target.value) || 6)} className={`${inp} w-14`} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] text-slate-500">Contact residues</span>
            <button
              onClick={() => setPocketContacts([...pocketContacts, { _key: newKey(), chain: "", residue: "" }])}
              className="text-[10px] text-violet-300 hover:text-violet-200"
            >
              + add contact
            </button>
          </div>
          {pocketContacts.map((c) => (
            <div key={c._key} className="flex items-center gap-1.5">
              <input placeholder="chain" value={c.chain} onChange={(e) => setPocketContacts(pocketContacts.map((x) => (x._key === c._key ? { ...x, chain: e.target.value.toUpperCase() } : x)))} className={`${inp} w-16`} />
              <input placeholder="residue #" type="number" value={c.residue} onChange={(e) => setPocketContacts(pocketContacts.map((x) => (x._key === c._key ? { ...x, residue: e.target.value === "" ? "" : Number(e.target.value) } : x)))} className={`${inp} flex-1`} />
              <button onClick={() => setPocketContacts(pocketContacts.filter((x) => x._key !== c._key))} className="text-[10px] text-slate-500 hover:text-rose-300 px-1">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Validation panel (pre-run — free)
// ===========================================================================
function ValidationPanel({
  validation,
  showYaml,
  setShowYaml,
}: {
  validation: CoFoldValidateResult;
  showYaml: boolean;
  setShowYaml: (v: boolean) => void;
}) {
  const s = validation.summary;
  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span className="text-[12px] font-semibold text-white">Design validated</span>
        <span className="text-[10px] text-slate-400 ml-auto">{validation.engine}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
        <MetricTile label="Entities" value={String(s.n_entities)} sub={`${s.n_chains} chains`} />
        <MetricTile label="Est. tokens" value={String(s.estimated_tokens)} />
        <MetricTile
          label="Est. runtime"
          value={`~${s.estimated_runtime_minutes}m`}
          tone="#22d3ee"
        />
        <MetricTile
          label="Est. GPU cost"
          value={`$${s.estimated_cost_usd_range[0]}–${s.estimated_cost_usd_range[1]}`}
          tone="#fbbf24"
        />
      </div>
      <div className="flex flex-wrap gap-1.5 text-[10px] mb-2">
        {s.affinity_requested && (
          <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200">
            affinity prediction
          </span>
        )}
        {s.uses_msa_server && (
          <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-200">ColabFold MSA</span>
        )}
        {s.has_covalent_bonds && (
          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200">covalent bonds</span>
        )}
        {s.has_pocket_conditioning && (
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-200">
            pocket conditioning
          </span>
        )}
        {Object.entries(s.entity_breakdown).map(([k, v]) => (
          <span key={k} className="px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300">
            {v}× {k}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 italic mb-2">{s.estimate_caveat}</p>
      <button
        onClick={() => setShowYaml(!showYaml)}
        className="text-[11px] text-violet-300 hover:text-violet-200"
      >
        {showYaml ? "▾ Hide" : "▸ Show"} generated design YAML
      </button>
      {showYaml && (
        <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-white/10 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-72 overflow-y-auto">
          {validation.boltz_yaml}
        </pre>
      )}
    </div>
  );
}

// ===========================================================================
// Result panel (post-run)
// ===========================================================================
function ResultPanel({
  result,
  activeModelConfidence,
  viewerStructure,
  viewerFormat,
  viewerPlddt,
  chainIds,
  colorMode,
  setColorMode,
  modelIdx,
  setModelIdx,
  showYaml,
  setShowYaml,
}: {
  result: CoFoldResult;
  activeModelConfidence: CoFoldResult["confidence"] | null;
  viewerStructure: string;
  viewerFormat: "mmcif" | "pdb";
  viewerPlddt: number[];
  chainIds: string[];
  colorMode: "plddt" | "chain";
  setColorMode: (m: "plddt" | "chain") => void;
  modelIdx: number;
  setModelIdx: (i: number) => void;
  showYaml: boolean;
  setShowYaml: (v: boolean) => void;
}) {
  const conf = activeModelConfidence;
  const aff = result.affinity;
  const plddtMean =
    viewerPlddt.length > 0 ? viewerPlddt.reduce((a, b) => a + b, 0) / viewerPlddt.length : null;
  const band = plddtBand(plddtMean);

  return (
    <div className="space-y-4">
      {/* 3D structure */}
      <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
        <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
          <div className="text-[12px] font-semibold text-white">Predicted complex</div>
          <div className="flex items-center gap-1.5">
            {result.models && result.models.length > 1 && (
              <select
                value={modelIdx}
                onChange={(e) => setModelIdx(Number(e.target.value))}
                className="text-[10.5px] px-1.5 py-1 rounded bg-black/30 border border-white/10 text-white outline-none"
              >
                {result.models.map((m, i) => (
                  <option key={m.rank} value={i}>
                    Model rank {m.rank}
                  </option>
                ))}
              </select>
            )}
            {(["plddt", "chain"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setColorMode(m)}
                className={`text-[10.5px] px-2 py-1 rounded ${
                  colorMode === m
                    ? "bg-violet-500/20 text-violet-200 border border-violet-500/40"
                    : "bg-white/[0.03] text-slate-400 border border-white/10"
                }`}
              >
                {m === "plddt" ? "Colour: pLDDT" : "Colour: chain"}
              </button>
            ))}
          </div>
        </div>
        {viewerStructure ? (
          <StructureViewer
            structure={viewerStructure}
            format={viewerFormat}
            chainIds={chainIds}
            colorMode={colorMode}
          />
        ) : (
          <div className="h-[420px] flex items-center justify-center text-[12px] text-slate-500">
            No structure returned.
          </div>
        )}
        {colorMode === "plddt" && (
          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
            {[
              { l: "Very high ≥90", c: "#2563eb" },
              { l: "Confident 70–90", c: "#22d3ee" },
              { l: "Low 50–70", c: "#facc15" },
              { l: "Very low <50", c: "#f97316" },
            ].map((x) => (
              <span key={x.l} className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: x.c }} />
                {x.l}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() =>
              downloadText(
                `cofold_model.${
                  viewerFormat === "mmcif" ? "cif" : "pdb"
                }`,
                viewerStructure,
                "chemical/x-cif",
              )
            }
            className="text-[11px] px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200"
          >
            ↓ Structure ({viewerFormat === "mmcif" ? "mmCIF" : "PDB"})
          </button>
          <button
            onClick={() => downloadText("cofold.yaml", result.boltz_yaml, "text/yaml")}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-slate-200"
          >
            ↓ Design YAML
          </button>
        </div>
      </div>

      {/* Confidence */}
      <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
        <div className="text-[12px] font-semibold text-white mb-3">Confidence</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <MetricTile
            label="Mean pLDDT"
            value={fmt(plddtMean, 1)}
            sub={band.label}
            tone={band.color}
          />
          <MetricTile
            label="pTM"
            value={fmt(conf?.ptm ?? null, 3)}
            sub="global fold"
          />
          <MetricTile
            label="ipTM"
            value={fmt(conf?.iptm ?? null, 3)}
            sub="interface"
            tone={
              conf?.iptm != null ? (conf.iptm >= 0.8 ? "#34d399" : conf.iptm >= 0.6 ? "#fbbf24" : "#f87171") : undefined
            }
          />
          <MetricTile
            label="Confidence score"
            value={fmt(conf?.confidence_score ?? null, 3)}
            sub="Aggregate score"
          />
        </div>
        {(conf?.ligand_iptm != null || conf?.complex_plddt != null) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2.5">
            {conf?.ligand_iptm != null && (
              <MetricTile label="Ligand ipTM" value={fmt(conf.ligand_iptm, 3)} sub="ligand interface" />
            )}
            {conf?.protein_iptm != null && (
              <MetricTile label="Protein ipTM" value={fmt(conf.protein_iptm, 3)} />
            )}
            {conf?.complex_plddt != null && (
              <MetricTile label="Complex pLDDT" value={fmt(conf.complex_plddt, 3)} />
            )}
            {conf?.complex_pde != null && (
              <MetricTile label="Complex PDE" value={fmt(conf.complex_pde, 3)} sub="distance error" />
            )}
          </div>
        )}
        {conf?.chains_ptm && Object.keys(conf.chains_ptm).length > 0 && (
          <div className="mt-2.5 text-[10.5px] text-slate-400">
            <span className="text-slate-500">Per-chain pTM: </span>
            {Object.entries(conf.chains_ptm).map(([k, v]) => (
              <span key={k} className="mr-2.5">
                chain {k}: <span className="text-slate-200">{fmt(v as number, 3)}</span>
              </span>
            ))}
          </div>
        )}
        {viewerPlddt.length > 0 && (
          <div className="mt-3">
            <div className="text-[10.5px] text-slate-500 mb-1">Per-residue pLDDT</div>
            <PlddtTrack plddt={viewerPlddt} />
          </div>
        )}
      </div>

      {/* Affinity */}
      {aff && (
        <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-4">
          <div className="text-[12px] font-semibold text-white mb-3">
            Binding affinity (co-folding affinity head)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <MetricTile
              label="Predicted IC50"
              value={aff.ic50_uM != null ? `${fmt(aff.ic50_uM, 3)} µM` : "—"}
              tone="#c4b5fd"
            />
            <MetricTile
              label="Binding ΔG-like"
              value={aff.binding_dg_kcal_mol != null ? `${fmt(aff.binding_dg_kcal_mol, 2)}` : "—"}
              sub="kcal/mol"
            />
            <MetricTile
              label="Binder probability"
              value={
                aff.affinity_probability_binary != null
                  ? `${(aff.affinity_probability_binary * 100).toFixed(0)}%`
                  : "—"
              }
              tone={
                aff.affinity_probability_binary != null
                  ? aff.affinity_probability_binary >= 0.5
                    ? "#34d399"
                    : "#f87171"
                  : undefined
              }
            />
            <MetricTile
              label="log10(IC50/µM)"
              value={fmt(aff.affinity_pred_value ?? null, 3)}
              sub="raw model value"
            />
          </div>
          <p className="text-[10px] text-slate-500 italic mt-2.5 leading-relaxed">
            {aff.units_note}
          </p>
        </div>
      )}

      {/* PAE */}
      {result.pae_matrix && result.pae_matrix.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
          <div className="text-[12px] font-semibold text-white mb-2">
            Predicted aligned error (PAE)
          </div>
          <PaeHeatmap pae={result.pae_matrix} />
        </div>
      )}

      {/* Run metadata + warnings */}
      <div className="rounded-xl border border-white/10 bg-[#0d0f17] p-4">
        <div className="text-[12px] font-semibold text-white mb-2">Run details</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10.5px] text-slate-400">
          <span>Engine</span>
          <span className="text-slate-200 text-right">{result.engine}</span>
          <span>GPU</span>
          <span className="text-slate-200 text-right">{result.gpu_name}</span>
          <span>Chains modelled</span>
          <span className="text-slate-200 text-right">{result.n_chains}</span>
          <span>Residues modelled</span>
          <span className="text-slate-200 text-right">{result.n_residues_modeled}</span>
          <span>Diffusion models</span>
          <span className="text-slate-200 text-right">{result.n_models}</span>
          <span>MSA source</span>
          <span className="text-slate-200 text-right">{result.msa_source}</span>
          <span>Wall-clock</span>
          <span className="text-slate-200 text-right">
            {fmt(result.wallclock_seconds, 0)} s
          </span>
          <span>RunPod job</span>
          <span className="text-slate-200 text-right font-mono">{result.runpod_job_id}</span>
        </div>
        {result.warnings && result.warnings.length > 0 && (
          <div className="mt-3 pt-2 border-t border-white/5">
            <div className="text-[10.5px] text-amber-300 font-medium mb-1">Warnings</div>
            <ul className="space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="text-[10px] text-amber-200/80 leading-relaxed">
                  • {w}
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          onClick={() => setShowYaml(!showYaml)}
          className="text-[11px] text-violet-300 hover:text-violet-200 mt-3"
        >
          {showYaml ? "▾ Hide" : "▸ Show"} Design YAML
        </button>
        {showYaml && (
          <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-white/10 text-[10px] font-mono text-slate-300 overflow-x-auto max-h-72 overflow-y-auto">
            {result.boltz_yaml}
          </pre>
        )}
      </div>
    </div>
  );
}

export default CoFolding;
