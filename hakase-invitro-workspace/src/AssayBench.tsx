/**
 * Layer 1 — extended in-vitro assay bench.
 *
 * The compact Layer-1 contract runs a fixed model set. The bench exposes the
 * focused predictors that sit behind it: permeability and transport,
 * disposition second opinions, metabolism, toxicology, and identity context.
 *
 * The catalogue, the grouping, the engine names, the field labels and every
 * value are supplied by `/api/ai/l1/assay-bench/*`. This component chooses
 * layout and nothing else — it computes no value, derives no status, and never
 * substitutes a placeholder for an assay the backend could not run.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Beaker,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  FlaskConical,
  LoaderCircle,
  Play,
  RotateCcw,
} from "lucide-react";
import { API_ROOT, PresentationGroups, StatusPill, type Group } from "./ui";

type CatalogAssay = {
  id: string;
  name: string;
  engine: string;
  description: string;
  remote?: boolean;
};
type CatalogGroup = { id: string; name: string; description: string; assays: CatalogAssay[] };
type Catalog = { groups: CatalogGroup[]; limitations?: string };

type AssayResult = {
  id: string;
  name: string;
  group: string;
  engine: string;
  remote?: boolean;
  status: "available" | "unavailable" | "error";
  reason?: string | null;
  presentation?: { groups?: Group[] };
};
type BenchRun = {
  assays: AssayResult[];
  summary?: { requested?: number; available?: number; unavailable?: number; errored?: number };
  computed_at?: string;
};

/** Assays pre-selected on first load: the ones that add the most to a Layer-1 read. */
const DEFAULT_SELECTION = new Set([
  "pampa",
  "caco2",
  "pgp_substrate",
  "solubility",
  "cyp_inhibition",
  "reactive_metabolites",
  "tox21",
  "ames",
  "known_drug",
]);

export function AssayBench({ smiles }: { smiles: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_SELECTION));
  const [openGroup, setOpenGroup] = useState<string | null>("permeability");
  const [run, setRun] = useState<BenchRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_ROOT}/api/ai/l1/assay-bench/catalog`, { signal: AbortSignal.timeout(15_000) })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled && data) setCatalog(data as Catalog); })
      .catch(() => { if (!cancelled) setError("The assay catalogue could not be loaded."); });
    return () => { cancelled = true; };
  }, []);

  // A new molecule invalidates the previous bench run; results are never
  // carried across structures.
  useEffect(() => { setRun(null); }, [smiles]);

  const resultsById = useMemo(
    () => new Map((run?.assays ?? []).map((assay) => [assay.id, assay])),
    [run],
  );
  const allAssays = useMemo(
    () => (catalog?.groups ?? []).flatMap((group) => group.assays),
    [catalog],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleGroup(group: CatalogGroup) {
    const ids = group.assays.map((assay) => assay.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function runBench() {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l1/assay-bench/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smiles, assay_ids: [...selected] }),
        signal: AbortSignal.timeout(180_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.detail === "string" ? payload.detail : "The assay bench run failed.");
      }
      setRun(payload as BenchRun);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The assay bench run failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) {
    return <section className="panel bench-panel">
      <div className="section-header">
        <div className="section-icon"><Beaker size={18} /></div>
        <div><p>EXTENDED IN VITRO</p><h2>Assay bench</h2><span>{error ?? "Loading the model catalogue…"}</span></div>
      </div>
    </section>;
  }

  const summary = run?.summary;

  return <section className="panel bench-panel">
    <div className="section-header">
      <div className="section-icon"><Beaker size={18} /></div>
      <div>
        <p>EXTENDED IN VITRO</p>
        <h2>Assay bench</h2>
        <span>Focused models that sit behind the Layer 1 screen. Select what to run; the backend executes them in one job.</span>
      </div>
      <div className="bench-head-actions">
        {summary && <span className="bench-summary-chips">
          <em className="good">{summary.available ?? 0} returned</em>
          {Boolean(summary.unavailable) && <em className="warn">{summary.unavailable} unavailable</em>}
          {Boolean(summary.errored) && <em className="bad">{summary.errored} failed</em>}
        </span>}
        <button className="secondary-button" onClick={runBench} disabled={busy || !selected.size}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} fill="currentColor" />}
          {busy ? "Running bench…" : `Run ${selected.size} assay${selected.size === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>

    {error && <div className="soft-note bench-error"><AlertTriangle size={15} /> {error}</div>}

    <div className="bench-toolbar">
      <button className="text-action" onClick={() => setSelected(new Set(allAssays.map((assay) => assay.id)))}>
        <Check size={14} /> Select all {allAssays.length}
      </button>
      <button className="text-action" onClick={() => setSelected(new Set(DEFAULT_SELECTION))}>
        <RotateCcw size={14} /> Reset to recommended
      </button>
      <button className="text-action" onClick={() => setSelected(new Set())}>Clear</button>
    </div>

    <div className="bench-groups">
      {catalog.groups.map((group) => {
        const open = openGroup === group.id;
        const chosen = group.assays.filter((assay) => selected.has(assay.id)).length;
        const returned = group.assays.filter((assay) => resultsById.get(assay.id)?.status === "available").length;
        return <article className={`bench-group ${open ? "open" : ""}`} key={group.id}>
          <button className="bench-group-head" onClick={() => setOpenGroup(open ? null : group.id)}>
            <span className="bench-group-title">
              <FlaskConical size={16} />
              <span><b>{group.name}</b><small>{group.description}</small></span>
            </span>
            <span className="bench-group-meta">
              {run && <em className="bench-returned">{returned}/{group.assays.length} returned</em>}
              <em>{chosen} selected</em>
              <ChevronDown size={16} className="bench-chevron" />
            </span>
          </button>
          {open && <div className="bench-group-body">
            <button className="text-action bench-group-toggle" onClick={() => toggleGroup(group)}>
              {group.assays.every((assay) => selected.has(assay.id)) ? "Deselect group" : "Select whole group"}
            </button>
            <div className="bench-assay-list">
              {group.assays.map((assay) => {
                const result = resultsById.get(assay.id);
                return <div className={`bench-assay ${selected.has(assay.id) ? "chosen" : ""}`} key={assay.id}>
                  <label className="bench-assay-head">
                    <input type="checkbox" checked={selected.has(assay.id)} onChange={() => toggle(assay.id)} />
                    <span>
                      <b>{assay.name}{assay.remote && <Cloud size={12} aria-label="external provider" />}</b>
                      <small>{assay.engine}</small>
                      <small className="bench-assay-desc">{assay.description}</small>
                    </span>
                    {result && <StatusPill status={result.status} />}
                  </label>
                  {result?.status === "available" && <PresentationGroups groups={result.presentation?.groups} />}
                  {result && result.status !== "available" && <p className="bench-assay-reason">
                    <CircleHelp size={13} /> {result.reason ?? "No result was returned and no reason was given."}
                  </p>}
                </div>;
              })}
            </div>
          </div>}
        </article>;
      })}
    </div>

    <p className="model-note">{catalog.limitations}</p>
  </section>;
}
