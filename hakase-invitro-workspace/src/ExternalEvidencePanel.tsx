/**
 * External public-database evidence.
 *
 * The retired workspace fired nine cross-origin requests from the browser and
 * assembled this panel client-side. Here the assembly is a single server call
 * (`POST /api/ai/external/panel`), so source selection, concurrency, timeouts,
 * key handling and every status determination live in the backend.
 *
 * The one thing this component insists on is showing the *negative* states as
 * loudly as the positive ones. A registry that returned nothing, a source that
 * needs an API key, and a source that was skipped for want of an identifier are
 * three different facts, and collapsing them into a blank panel would be a
 * quiet way of implying the evidence does not exist.
 *
 * FDA product-specific guidance comes from `/api/fda-psg/search`, which already
 * existed in `platform/datasources`; it is surfaced here rather than duplicated.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Database, Dna, ExternalLink, FileText, GitBranch,
  Landmark, Leaf, Link2, LoaderCircle, Pill, RefreshCw, Users,
} from "lucide-react";
import { API_ROOT, Card, DataTable, StatusPill, num, pct, text, titleCase } from "./ui";

export type PanelKind = "target" | "hazard" | "clinical";

type SourceBlock = Record<string, any> & { status?: string; reason?: string; remediation?: string; source?: string };
type PanelResult = {
  panel?: string;
  available?: boolean;
  reason?: string;
  identifiers?: Record<string, string | null>;
  catalogue?: Array<{ key: string; name: string; requires: string }>;
  sources?: Record<string, SourceBlock>;
  sources_with_data?: string[];
  sources_empty?: string[];
  sources_skipped?: string[];
  sources_failed?: string[];
  limitations?: string;
};

export type PanelIdentifiers = {
  gene_symbol?: string | null;
  uniprot_id?: string | null;
  inchikey?: string | null;
  compound_name?: string | null;
  casrn?: string | null;
  therapeutic_area?: string | null;
  target_protein?: string | null;
};

const PANEL_TITLE: Record<PanelKind, { title: string; subtitle: string }> = {
  target: {
    title: "Target biology — external databases",
    subtitle: "STRING functional network, KEGG pathway/disease/drug annotation and Reactome reaction membership for the resolved target.",
  },
  hazard: {
    title: "Measured toxicology — external databases",
    subtitle: "EPA ToxRefDB/ToxValDB in-vivo hazard values, ECOTOX environmental endpoints and the ToxCast/Tox21 in-vitro battery.",
  },
  clinical: {
    title: "Clinical & population evidence — external databases",
    subtitle: "ClinicalTrials.gov landscape, PharmGKB pharmacogenomics, DisGeNET gene–disease associations and gnomAD population constraint.",
  },
};

function SourceStatus({ block }: { block: SourceBlock }) {
  const status = block.status ?? "unknown";
  if (status === "live") return <StatusPill status="pass" label="Live" />;
  if (status === "no-data") return <StatusPill status="unknown" label="No record" />;
  if (status === "skipped") return <StatusPill status="unknown" label="Not queried" />;
  if (status === "unavailable") return <StatusPill status="caution" label="Not configured" />;
  return <StatusPill status="fail" label="Unreachable" />;
}

function SourceShell({ icon, name, block, children }: { icon: React.ReactNode; name: string; block: SourceBlock; children?: React.ReactNode }) {
  const live = block.status === "live";
  return <div className={`ext-source ${block.status}`}>
    <div className="ext-source-head">
      <div className="ext-source-title">{icon}<b>{name}</b></div>
      <SourceStatus block={block} />
    </div>
    {live ? children : <div className="ext-source-empty">
      <p>{block.reason ?? "No detail was returned by the backend for this source."}</p>
      {block.remediation && <p className="l3-remediation"><b>To enable it:</b> {block.remediation}</p>}
    </div>}
    {live && block.url && <a className="ext-link" href={block.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {block.source ?? name}</a>}
    {live && block.limitations && <p className="l3-limitation">{block.limitations}</p>}
  </div>;
}

/* ── per-source renderers ────────────────────────────────────────────────── */

function StringSource({ block }: { block: SourceBlock }) {
  return <SourceShell icon={<Link2 size={14} />} name="STRING — functional interaction network" block={block}>
    <p>{block.interpretation}</p>
    <DataTable
      columns={[
        { key: "p", header: "Partner", render: (r: any) => <b>{r.partner}</b> },
        { key: "s", header: "Combined score", align: "right", render: (r: any) => num(r.combined_score, 0) },
        { key: "e", header: "Experimental", align: "right", render: (r: any) => num(r.experimental, 3) },
        { key: "d", header: "Dominant evidence", render: (r: any) => r.dominant_evidence },
      ]}
      rows={(block.interactions ?? []).slice(0, 12)}
    />
  </SourceShell>;
}

function KeggSource({ block }: { block: SourceBlock }) {
  return <SourceShell icon={<GitBranch size={14} />} name="KEGG — pathways, diseases and annotated drugs" block={block}>
    <p>{block.interpretation}</p>
    {/* KEGG flat-file entries can repeat an id across continuation lines, so
        these lists are keyed by position rather than by the returned id. */}
    <div className="ext-chip-groups">
      <div>
        <small>Pathways ({block.n_pathways})</small>
        <div className="ext-chips">{(block.pathways ?? []).map((p: any, i: number) => <span key={`${p.id}-${i}`}>{p.name}</span>)}</div>
      </div>
      {(block.diseases?.length ?? 0) > 0 && <div>
        <small>Diseases ({block.n_diseases})</small>
        <div className="ext-chips">{(block.diseases ?? []).map((d: any, i: number) => <span key={`${d.id}-${i}`}>{d.name}</span>)}</div>
      </div>}
      {(block.drugs?.length ?? 0) > 0 && <div>
        <small>Annotated drugs ({block.n_drugs})</small>
        <div className="ext-chips">{(block.drugs ?? []).map((d: any, i: number) => <span key={`${d.id}-${i}`}>{d.name}</span>)}</div>
      </div>}
    </div>
  </SourceShell>;
}

function ReactomeSource({ block }: { block: SourceBlock }) {
  return <SourceShell icon={<GitBranch size={14} />} name="Reactome — curated reaction membership" block={block}>
    <div className="ext-stat-row">
      <div><small>Pathways</small><b>{text(block.n_pathways_total)}</b></div>
      <div><small>Reactions</small><b>{text(block.n_reactions)}</b></div>
    </div>
    {(block.top_level_processes?.length ?? 0) > 0 && <div className="ext-chips">
      {block.top_level_processes.map((p: string) => <span key={p}>{p}</span>)}
    </div>}
    <DataTable
      columns={[
        { key: "n", header: "Pathway", render: (r: any) => r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.name}</a> : r.name },
        { key: "i", header: "Stable id", render: (r: any) => <code>{r.st_id}</code> },
        { key: "f", header: "Inferred", render: (r: any) => r.is_inferred ? "by orthology" : "curated" },
      ]}
      rows={(block.pathways ?? []).slice(0, 10)}
    />
  </SourceShell>;
}

function ToxRefSource({ block }: { block: SourceBlock }) {
  return <SourceShell icon={<Database size={14} />} name="EPA ToxRefDB / ToxValDB — measured in-vivo hazard" block={block}>
    <div className="ext-stat-row">
      <div><small>Most conservative NOAEL</small><b>{block.most_conservative_noael_mg_kg_day != null ? `${num(block.most_conservative_noael_mg_kg_day)} mg/kg/day` : "—"}</b></div>
      <div><small>Most conservative LOAEL</small><b>{block.most_conservative_loael_mg_kg_day != null ? `${num(block.most_conservative_loael_mg_kg_day)} mg/kg/day` : "—"}</b></div>
      <div><small>Lowest LD50</small><b>{block.lowest_ld50_mg_kg != null ? `${num(block.lowest_ld50_mg_kg)} mg/kg` : "—"}</b></div>
      <div><small>Species</small><b>{(block.species_covered ?? []).join(", ") || "—"}</b></div>
    </div>
    <DataTable
      columns={[
        { key: "s", header: "Species", render: (r: any) => titleCase(String(r.species)) },
        { key: "t", header: "Study", render: (r: any) => r.study_type ?? "—" },
        { key: "v", header: "Type", render: (r: any) => <StatusPill status={r.tox_val_type === "NOAEL" ? "pass" : r.tox_val_type === "LOAEL" ? "caution" : "fail"} label={r.tox_val_type} /> },
        { key: "n", header: "Value", align: "right", render: (r: any) => `${num(r.value_mg_kg_day)} ${r.units ?? ""}` },
        { key: "r", header: "Route", render: (r: any) => r.exposure_route ?? "—" },
        { key: "e", header: "Critical effect", render: (r: any) => r.critical_effect ?? "—" },
      ]}
      rows={(block.records ?? []).slice(0, 12)}
    />
  </SourceShell>;
}

function EcotoxSource({ block }: { block: SourceBlock }) {
  return <SourceShell icon={<Leaf size={14} />} name="EPA ECOTOX — environmental toxicology" block={block}>
    <div className="ext-stat-row">
      <div><small>Lowest NOEC</small><b>{block.lowest_noec != null ? num(block.lowest_noec) : "—"}</b></div>
      <div><small>Lowest LC50/EC50</small><b>{block.lowest_lc50_ec50 != null ? num(block.lowest_lc50_ec50) : "—"}</b></div>
      <div><small>Studies</small><b>{text(block.n_studies)}</b></div>
    </div>
    <DataTable
      columns={[
        { key: "s", header: "Species", render: (r: any) => r.species ?? "—" },
        { key: "e", header: "Endpoint", render: (r: any) => r.endpoint },
        { key: "v", header: "Value", align: "right", render: (r: any) => `${num(r.value)} ${r.units ?? ""}` },
        { key: "d", header: "Duration", render: (r: any) => r.duration ? `${r.duration} ${r.duration_units ?? ""}` : "—" },
        { key: "r", header: "Route", render: (r: any) => r.exposure_route ?? "—" },
      ]}
      rows={(block.studies ?? []).slice(0, 10)}
    />
  </SourceShell>;
}

function ToxcastSource({ block }: { block: SourceBlock }) {
  return <SourceShell icon={<Database size={14} />} name="EPA ToxCast / Tox21 — in-vitro screening battery" block={block}>
    <div className="ext-stat-row">
      <div><small>Assays screened</small><b>{text(block.n_assays_screened)}</b></div>
      <div><small>Active</small><b>{text(block.n_active)}</b></div>
      <div><small>Hit rate</small><b>{block.hit_rate != null ? pct(block.hit_rate, 1) : "—"}</b></div>
      <div><small>Most potent active</small><b>{block.most_potent_active ? `${num(block.most_potent_active.ac50_uM)} µM` : "—"}</b></div>
    </div>
    <DataTable
      columns={[
        { key: "a", header: "Assay", render: (r: any) => r.assay_name },
        { key: "g", header: "Gene", render: (r: any) => r.gene ?? "—" },
        { key: "h", header: "Call", render: (r: any) => r.active == null ? "—" : <StatusPill status={r.active ? "caution" : "pass"} label={r.active ? "Active" : "Inactive"} /> },
        { key: "c", header: "AC50 (µM)", align: "right", render: (r: any) => num(r.ac50_uM) },
        { key: "x", header: "Cytotoxicity flag", render: (r: any) => text(r.cytotoxicity_flag) },
      ]}
      rows={(block.assay_hits ?? []).slice(0, 15)}
    />
  </SourceShell>;
}

function TrialsSource({ block, name }: { block: SourceBlock; name: string }) {
  return <SourceShell icon={<FileText size={14} />} name={name} block={block}>
    <div className="ext-stat-row">
      <div><small>Total matching</small><b>{text(block.total_matching)}</b></div>
      <div><small>Completed</small><b>{text(block.completed)}</b></div>
      <div><small>Terminated / withdrawn</small><b>{text(block.terminated_or_withdrawn)}</b></div>
      <div><small>Median enrolment</small><b>{text(block.median_enrollment)}</b></div>
    </div>
    {block.by_phase && <div className="ext-chips">
      {Object.entries(block.by_phase as Record<string, number>).map(([phase, count]) => <span key={phase}>{phase}: {count}</span>)}
    </div>}
    <DataTable
      columns={[
        { key: "t", header: "Study", render: (r: any) => r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title },
        { key: "p", header: "Phase", render: (r: any) => r.phase },
        { key: "s", header: "Status", render: (r: any) => <>{r.status}{r.why_stopped && <small className="warn-note">{r.why_stopped}</small>}</> },
        { key: "n", header: "Enrolment", align: "right", render: (r: any) => text(r.enrollment) },
        { key: "sp", header: "Sponsor", render: (r: any) => r.sponsor ?? "—" },
      ]}
      rows={(block.trials ?? []).slice(0, 10)}
    />
  </SourceShell>;
}

function PharmGkbSource({ block }: { block: SourceBlock }) {
  return <SourceShell icon={<Pill size={14} />} name="PharmGKB — pharmacogenomics" block={block}>
    <p>{block.interpretation}</p>
    <div className="ext-stat-row">
      <div><small>Clinical annotations</small><b>{text(block.n_variants)}</b></div>
      <div><small>Level 1A/1B (actionable)</small><b>{text(block.n_actionable)}</b></div>
      <div><small>Dosing guidelines</small><b>{text(block.n_guidelines)}</b></div>
      <div><small>Established pharmacogene</small><b>{block.is_established_pharmacogene ? "Yes" : "No"}</b></div>
    </div>
    <DataTable
      columns={[
        { key: "n", header: "Variant / haplotype", render: (r: any) => r.name ?? "—" },
        { key: "l", header: "Level", render: (r: any) => r.level_of_evidence ?? "—" },
        { key: "s", header: "Significance", render: (r: any) => <StatusPill status={r.significance === "Actionable" ? "fail" : r.significance === "Informative" ? "caution" : "unknown"} label={r.significance} /> },
        { key: "p", header: "Phenotype", render: (r: any) => r.phenotype ?? "—" },
        { key: "c", header: "Drugs", render: (r: any) => (r.chemicals ?? []).slice(0, 3).join(", ") || "—" },
      ]}
      rows={block.variants ?? []}
    />
    {(block.guidelines?.length ?? 0) > 0 && <div className="ext-guidelines">
      <small>Dosing guidelines</small>
      {block.guidelines.map((g: any, i: number) => <div key={i}><b>{g.name}</b><span>{g.source}</span></div>)}
    </div>}
  </SourceShell>;
}

function DisgenetSource({ block }: { block: SourceBlock }) {
  return <SourceShell icon={<Users size={14} />} name="DisGeNET — gene–disease associations" block={block}>
    <div className="ext-stat-row">
      <div><small>Associations</small><b>{text(block.n_diseases)}</b></div>
      <div><small>Specificity index (DSI)</small><b>{num(block.disease_specificity_index, 3)}</b></div>
      <div><small>Pleiotropy index (DPI)</small><b>{num(block.disease_pleiotropy_index, 3)}</b></div>
      <div><small>Strongest association</small><b>{block.strongest_association ?? "—"}</b></div>
    </div>
    <DataTable
      columns={[
        { key: "d", header: "Disease", render: (r: any) => r.disease_name },
        { key: "s", header: "Score", align: "right", render: (r: any) => num(r.score, 3) },
        { key: "e", header: "Evidence index", align: "right", render: (r: any) => num(r.evidence_index, 3) },
        { key: "p", header: "Publications", align: "right", render: (r: any) => text(r.n_publications) },
        { key: "t", header: "Type", render: (r: any) => r.disease_type ?? "—" },
      ]}
      rows={(block.diseases ?? []).slice(0, 12)}
    />
  </SourceShell>;
}

function GnomadSource({ block }: { block: SourceBlock }) {
  const constraint = block.constraint ?? {};
  return <SourceShell icon={<Dna size={14} />} name="gnomAD — population constraint and variation" block={block}>
    <div className={`ext-constraint ${constraint.call}`}>
      <StatusPill
        status={constraint.call === "loss_of_function_intolerant" ? "caution" : constraint.call === "loss_of_function_tolerant" ? "pass" : "unknown"}
        label={titleCase(String(constraint.call ?? "not available"))}
      />
      <p>{constraint.note}</p>
    </div>
    <div className="ext-stat-row">
      <div><small>pLI</small><b>{num(constraint.pLI, 3)}</b></div>
      <div><small>LoF o/e</small><b>{num(constraint.oe_lof, 3)}</b></div>
      <div><small>LOEUF</small><b>{num(constraint.loeuf, 3)}</b></div>
      <div><small>Missense Z</small><b>{num(constraint.missense_z, 2)}</b></div>
    </div>
    <div className="ext-stat-row">
      <div><small>Variants returned</small><b>{text(block.n_variants_returned)}</b></div>
      <div><small>High-confidence LoF</small><b>{text(block.n_loss_of_function)}</b></div>
      <div><small>Missense</small><b>{text(block.n_missense)}</b></div>
    </div>
    <DataTable
      columns={[
        { key: "v", header: "Variant", render: (r: any) => <code>{r.variant_id}</code> },
        { key: "r", header: "rsID", render: (r: any) => r.rsid ?? "—" },
        { key: "c", header: "Consequence", render: (r: any) => String(r.consequence ?? "").replaceAll("_", " ") },
        { key: "a", header: "Allele frequency", align: "right", render: (r: any) => r.allele_frequency != null ? `${(r.allele_frequency * 100).toFixed(4)}%` : "—" },
        { key: "l", header: "LoF", render: (r: any) => r.is_loss_of_function ? <StatusPill status="caution" label="HC LoF" /> : "—" },
      ]}
      rows={(block.variants ?? []).slice(0, 12)}
    />
  </SourceShell>;
}

const RENDERERS: Record<string, (block: SourceBlock) => React.ReactNode> = {
  string: (b) => <StringSource block={b} />,
  kegg: (b) => <KeggSource block={b} />,
  reactome: (b) => <ReactomeSource block={b} />,
  toxref: (b) => <ToxRefSource block={b} />,
  ecotox: (b) => <EcotoxSource block={b} />,
  toxcast: (b) => <ToxcastSource block={b} />,
  clinical_trials: (b) => <TrialsSource block={b} name="ClinicalTrials.gov — registered trial landscape" />,
  phase1_trials: (b) => <TrialsSource block={b} name="ClinicalTrials.gov — Phase 1 benchmark" />,
  pharmgkb: (b) => <PharmGkbSource block={b} />,
  disgenet: (b) => <DisgenetSource block={b} />,
  gnomad: (b) => <GnomadSource block={b} />,
};

/* ── the panel ───────────────────────────────────────────────────────────── */

export function ExternalEvidencePanel({ panel, identifiers }: { panel: PanelKind; identifiers: PanelIdentifiers }) {
  const [result, setResult] = useState<PanelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify(identifiers);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/external/panel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panel, ...identifiers }),
        signal: AbortSignal.timeout(90_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "The external evidence panel could not be retrieved.");
      setResult(payload as PanelResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The external evidence panel could not be retrieved.");
    } finally { setBusy(false); }
  }, [panel, key]);

  useEffect(() => { void load(); }, [load]);

  const meta = PANEL_TITLE[panel];
  const sources = result?.sources ?? {};

  return <Card
    icon={<Database size={16} />}
    title={meta.title}
    subtitle={meta.subtitle}
    note={result?.limitations}
    actions={<button className="text-action" onClick={() => void load()} disabled={busy}>
      {busy ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />} Refresh
    </button>}
  >
    {busy && !result && <div className="ext-loading"><LoaderCircle size={18} className="spin" /> Querying public databases…</div>}
    {error && <div className="ivive-error"><AlertTriangle size={16} /><span>{error}</span></div>}

    {result && <>
      <div className="ext-status-strip">
        <span><b>{result.sources_with_data?.length ?? 0}</b> with data</span>
        <span><b>{result.sources_empty?.length ?? 0}</b> no record</span>
        <span><b>{result.sources_skipped?.length ?? 0}</b> not queried</span>
        <span><b>{result.sources_failed?.length ?? 0}</b> unavailable</span>
      </div>
      <div className="ext-identifiers">
        {Object.entries(result.identifiers ?? {}).filter(([, v]) => v).map(([k, v]) => (
          <span key={k}>{titleCase(k)}: <code>{v}</code></span>
        ))}
      </div>
      <div className="ext-sources">
        {(result.catalogue ?? []).map((entry) => {
          const block = sources[entry.key];
          if (!block) return null;
          const render = RENDERERS[entry.key];
          return <div key={entry.key}>{render ? render(block) : <SourceShell icon={<Database size={14} />} name={entry.name} block={block} />}</div>;
        })}
      </div>
    </>}
  </Card>;
}

/* ── FDA product-specific guidance (existing datasource route) ───────────── */

export function FdaPsgPanel({ drugName }: { drugName?: string | null }) {
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!drugName?.trim()) { setResult(null); return; }
    let cancelled = false;
    setBusy(true); setError(null);
    void fetch(`${API_ROOT}/api/fda-psg/search?drug=${encodeURIComponent(drugName.trim())}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "The FDA guidance lookup failed.");
        if (!cancelled) setResult(payload);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [drugName]);

  if (!drugName?.trim()) return null;

  return <Card
    icon={<Landmark size={16} />}
    title="FDA product-specific guidance & bioequivalence context"
    subtitle="Reference-listed drugs, therapeutic-equivalence codes and the bioequivalence window, from Drugs@FDA and the FDA label."
  >
    {busy && <div className="ext-loading"><LoaderCircle size={18} className="spin" /> Querying Drugs@FDA…</div>}
    {error && <p className="l3-hint-muted">{error}</p>}
    {result && <>
      <div className="ext-stat-row">
        <div><small>Applications found</small><b>{text(result.total_apps_found)}</b></div>
        <div><small>Reference-listed products</small><b>{(result.reference_listed_drugs ?? []).length}</b></div>
        <div><small>BCS class</small><b>{result.bcs_class ?? "not stated on the label"}</b></div>
        <div><small>BE window</small><b>{result.be_window_standard}</b></div>
      </div>
      <p className="l3-hint-muted">{result.bcs_note}</p>
      {(result.reference_listed_drugs ?? []).length > 0 && <DataTable
        columns={[
          { key: "b", header: "Brand", render: (r: any) => r.brand_name ?? "—" },
          { key: "a", header: "Application", render: (r: any) => `${r.application_number} · ${r.application_type}` },
          { key: "s", header: "Sponsor", render: (r: any) => r.sponsor ?? "—" },
          { key: "f", header: "Form / route", render: (r: any) => `${r.dosage_form ?? "—"} · ${r.route ?? "—"}` },
          { key: "t", header: "TE code", render: (r: any) => r.te_code ? <span title={r.te_description}>{r.te_code}</span> : "—" },
          { key: "m", header: "Status", render: (r: any) => r.marketing_status ?? "—" },
        ]}
        rows={result.reference_listed_drugs ?? []}
      />}
      {result.clinical_pharmacology_snippet && <div className="psg-snippet">
        <div className="l3-sub-label">Clinical pharmacology (FDA label extract)</div>
        <p>{result.clinical_pharmacology_snippet}</p>
      </div>}
      <div className="ext-links">
        {result.psg_search_url && <a href={result.psg_search_url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> FDA product-specific guidance search</a>}
        {result.dissolution_db_url && <a href={result.dissolution_db_url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> FDA dissolution methods database</a>}
      </div>
      <p className="l3-limitation">
        The FDA publishes product-specific guidance documents as PDFs with no machine-readable index, so this
        panel returns the approval and label record that surrounds them plus a direct search link — it does not
        assert the contents of a guidance document it has not read.
      </p>
    </>}
  </Card>;
}
