/**
 * External public-database evidence.
 *
 * The negative states are shown as loudly as the positive ones: a registry that
 * returned nothing, a source skipped for want of an identifier and a source
 * that is unreachable are three different facts, and collapsing them into a
 * blank panel would quietly imply the evidence does not exist.
 */
import { useMemo, useState } from "react";
import {
  Database, Dna, ExternalLink, FileText, GitBranch, Landmark, Leaf, Link2, LoaderCircle,
  Pill, RefreshCw, Users,
} from "lucide-react";
import { externalPanel, fdaPsg, type PanelKind, type SourceBlock } from "../engine/external";
import { Card, DataTable, StatusPill, num, text, titleCase } from "./ui";

function SourceStatus({ block }: { block: SourceBlock }) {
  if (block.status === "live") return <StatusPill status="pass" label="Live" />;
  if (block.status === "no-data") return <StatusPill status="unknown" label="No record" />;
  if (block.status === "skipped") return <StatusPill status="unknown" label="Not queried" />;
  if (block.status === "unavailable") return <StatusPill status="caution" label="Not configured" />;
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
      <p>{block.reason ?? "No detail is available for this source."}</p>
      {block.remediation && <p className="remediation"><b>To enable it:</b> {block.remediation}</p>}
    </div>}
    {live && block.url && <a className="ext-link" href={block.url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> {block.source ?? name}</a>}
    {live && block.limitations && <p className="limitation">{block.limitations}</p>}
  </div>;
}

function Stats({ entries }: { entries: Array<[string, React.ReactNode]> }) {
  return <div className="ext-stat-row">{entries.map(([label, value], index) => <div key={index}><small>{label}</small><b>{value}</b></div>)}</div>;
}

const RENDERERS: Record<string, (block: SourceBlock) => React.ReactNode> = {
  string: (block) => <SourceShell icon={<Link2 size={14} />} name="STRING — functional interaction network" block={block}>
    <p className="card-sub">{block.interpretation}</p>
    <DataTable
      columns={[
        { key: "p", header: "Partner", render: (row: any) => <b>{row.partner}</b> },
        { key: "s", header: "Combined score", align: "right", render: (row: any) => num(row.combined_score, 0) },
        { key: "e", header: "Experimental", align: "right", render: (row: any) => num(row.experimental, 3) },
        { key: "d", header: "Database", align: "right", render: (row: any) => num(row.database, 3) },
        { key: "c", header: "Co-expression", align: "right", render: (row: any) => num(row.coexpression, 3) },
        { key: "v", header: "Dominant evidence", render: (row: any) => row.dominant_evidence },
      ]}
      rows={(block.interactions ?? []).slice(0, 12)}
    />
  </SourceShell>,

  kegg: (block) => <SourceShell icon={<GitBranch size={14} />} name="KEGG — pathways, diseases and annotated drugs" block={block}>
    <p className="card-sub">{block.interpretation}</p>
    <div className="ext-chip-groups">
      <div><small>Pathways ({block.n_pathways})</small><div className="ext-chips">{(block.pathways ?? []).map((entry: any, index: number) => <span key={`${entry.id}-${index}`}>{entry.name}</span>)}</div></div>
      {(block.diseases?.length ?? 0) > 0 && <div><small>Diseases ({block.n_diseases})</small><div className="ext-chips">{block.diseases.map((entry: any, index: number) => <span key={`${entry.id}-${index}`}>{entry.name}</span>)}</div></div>}
      {(block.drugs?.length ?? 0) > 0 && <div><small>Annotated drugs ({block.n_drugs})</small><div className="ext-chips">{block.drugs.map((entry: any, index: number) => <span key={`${entry.id}-${index}`}>{entry.name}</span>)}</div></div>}
    </div>
  </SourceShell>,

  reactome: (block) => <SourceShell icon={<GitBranch size={14} />} name="Reactome — curated reaction membership" block={block}>
    <Stats entries={[["Pathways", text(block.n_pathways_total)], ["Reactions", text(block.n_reactions)]]} />
    {(block.top_level_processes?.length ?? 0) > 0 && <div className="ext-chips" style={{ marginBottom: 12 }}>{block.top_level_processes.map((entry: string) => <span key={entry}>{entry}</span>)}</div>}
    <DataTable
      columns={[
        { key: "n", header: "Pathway", render: (row: any) => row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.name}</a> : row.name },
        { key: "i", header: "Stable id", render: (row: any) => <code>{row.st_id}</code> },
        { key: "f", header: "Curation", render: (row: any) => row.is_inferred ? "inferred by orthology" : "curated in human" },
      ]}
      rows={(block.pathways ?? []).slice(0, 10)}
    />
  </SourceShell>,

  toxref: (block) => <SourceShell icon={<Database size={14} />} name={block.display_name ?? "EPA ToxRefDB / ToxValDB"} block={block}>
    <Stats entries={[
      ["Most conservative NOAEL", block.most_conservative_noael_mg_kg_day != null ? `${num(block.most_conservative_noael_mg_kg_day)} mg/kg/day` : "—"],
      ["Most conservative LOAEL", block.most_conservative_loael_mg_kg_day != null ? `${num(block.most_conservative_loael_mg_kg_day)} mg/kg/day` : "—"],
      ["Lowest LD50", block.lowest_ld50_mg_kg != null ? `${num(block.lowest_ld50_mg_kg)} mg/kg` : "—"],
      ["Species covered", (block.species_covered ?? []).join(", ") || "—"],
    ]} />
    <DataTable
      columns={[
        { key: "s", header: "Species", render: (row: any) => titleCase(String(row.species)) },
        { key: "t", header: "Study", render: (row: any) => row.study_type ?? "—" },
        { key: "v", header: "Type", render: (row: any) => <StatusPill status={row.tox_val_type === "NOAEL" ? "pass" : row.tox_val_type === "LOAEL" ? "caution" : "fail"} label={row.tox_val_type} /> },
        { key: "n", header: "Value", align: "right", render: (row: any) => `${num(row.value_mg_kg_day)} ${row.units ?? ""}` },
        { key: "r", header: "Route", render: (row: any) => row.exposure_route ?? "—" },
        { key: "e", header: "Critical effect", render: (row: any) => row.critical_effect ?? "—" },
      ]}
      rows={(block.records ?? []).slice(0, 12)}
    />
  </SourceShell>,

  ecotox: (block) => <SourceShell icon={<Leaf size={14} />} name={block.display_name ?? "EPA ECOTOX"} block={block}>
    <Stats entries={[
      ["Lowest NOEC", block.lowest_noec != null ? `${num(block.lowest_noec)} mg/L` : "—"],
      ["Lowest LC50 / EC50", block.lowest_lc50_ec50 != null ? `${num(block.lowest_lc50_ec50)} mg/L` : "—"],
      ["Studies", text(block.n_studies)],
    ]} />
    <DataTable
      columns={[
        { key: "s", header: "Species", render: (row: any) => <i>{row.species ?? "—"}</i> },
        { key: "e", header: "Endpoint", render: (row: any) => row.endpoint },
        { key: "v", header: "Value", align: "right", render: (row: any) => `${num(row.value)} ${row.units ?? ""}` },
        { key: "d", header: "Duration", render: (row: any) => row.duration ? `${row.duration} ${row.duration_units ?? ""}` : "—" },
        { key: "r", header: "Exposure", render: (row: any) => row.exposure_route ?? "—" },
      ]}
      rows={(block.studies ?? []).slice(0, 10)}
    />
  </SourceShell>,

  toxcast: (block) => <SourceShell icon={<Database size={14} />} name={block.display_name ?? "EPA ToxCast / Tox21"} block={block}>
    <Stats entries={[
      ["Assays screened", text(block.n_assays_screened)],
      ["Active", text(block.n_active)],
      ["Hit rate", block.hit_rate != null ? `${(block.hit_rate * 100).toFixed(1)}%` : "—"],
      ["Most potent active", block.most_potent_active ? `${num(block.most_potent_active.ac50_uM)} µM` : "—"],
    ]} />
    <DataTable
      columns={[
        { key: "a", header: "Assay", render: (row: any) => <code>{row.assay_name}</code> },
        { key: "g", header: "Gene", render: (row: any) => row.gene ?? "—" },
        { key: "h", header: "Call", render: (row: any) => row.active == null ? "—" : <StatusPill status={row.active ? "caution" : "pass"} label={row.active ? "Active" : "Inactive"} /> },
        { key: "c", header: "AC50 (µM)", align: "right", render: (row: any) => num(row.ac50_uM) },
        { key: "x", header: "Cytotoxicity flag", render: (row: any) => text(row.cytotoxicity_flag) },
      ]}
      rows={(block.assay_hits ?? []).slice(0, 15)}
    />
  </SourceShell>,

  clinical_trials: (block) => <SourceShell icon={<FileText size={14} />} name="ClinicalTrials.gov — registered trial landscape" block={block}>
    <Stats entries={[
      ["Total matching", text(block.total_matching)],
      ["Completed", text(block.completed)],
      ["Terminated / withdrawn", text(block.terminated_or_withdrawn)],
      ["Median enrolment", text(block.median_enrollment)],
    ]} />
    {block.by_phase && <div className="ext-chips" style={{ marginBottom: 12 }}>
      {Object.entries(block.by_phase as Record<string, number>).map(([phase, count]) => <span key={phase}>{phase}: {count}</span>)}
    </div>}
    <DataTable
      columns={[
        { key: "t", header: "Study", render: (row: any) => <><b>{row.title}</b><small>{row.nct_id}</small></> },
        { key: "p", header: "Phase", render: (row: any) => row.phase },
        { key: "s", header: "Status", render: (row: any) => <>{row.status}{row.why_stopped && <small>{row.why_stopped}</small>}</> },
        { key: "n", header: "Enrolment", align: "right", render: (row: any) => text(row.enrollment) },
        { key: "sp", header: "Sponsor", render: (row: any) => row.sponsor ?? "—" },
      ]}
      rows={(block.trials ?? []).slice(0, 10)}
    />
  </SourceShell>,

  pharmgkb: (block) => <SourceShell icon={<Pill size={14} />} name="PharmGKB — pharmacogenomics" block={block}>
    <p className="card-sub">{block.interpretation}</p>
    <Stats entries={[
      ["Clinical annotations", text(block.n_variants)],
      ["Level 1A/1B (actionable)", text(block.n_actionable)],
      ["Dosing guidelines", text(block.n_guidelines)],
      ["Established pharmacogene", block.is_established_pharmacogene ? "Yes" : "No"],
    ]} />
    <DataTable
      columns={[
        { key: "n", header: "Variant / haplotype", render: (row: any) => <code>{row.name ?? "—"}</code> },
        { key: "l", header: "Level", render: (row: any) => row.level_of_evidence ?? "—" },
        { key: "s", header: "Significance", render: (row: any) => <StatusPill status={row.significance === "Actionable" ? "fail" : row.significance === "Informative" ? "caution" : "unknown"} label={row.significance} /> },
        { key: "p", header: "Phenotype", render: (row: any) => row.phenotype ?? "—" },
        { key: "c", header: "Drugs", render: (row: any) => (row.chemicals ?? []).slice(0, 3).join(", ") || "—" },
      ]}
      rows={block.variants ?? []}
    />
  </SourceShell>,

  disgenet: (block) => <SourceShell icon={<Users size={14} />} name={block.display_name ?? "DisGeNET — gene–disease associations"} block={block}>
    <Stats entries={[
      ["Associations", text(block.n_diseases)],
      ["Specificity index (DSI)", num(block.disease_specificity_index, 3)],
      ["Pleiotropy index (DPI)", num(block.disease_pleiotropy_index, 3)],
      ["Strongest association", block.strongest_association ?? "—"],
    ]} />
    <DataTable
      columns={[
        { key: "d", header: "Disease", render: (row: any) => row.disease_name },
        { key: "s", header: "Score", align: "right", render: (row: any) => num(row.score, 3) },
        { key: "e", header: "Evidence index", align: "right", render: (row: any) => num(row.evidence_index, 3) },
        { key: "p", header: "Publications", align: "right", render: (row: any) => text(row.n_publications) },
        { key: "t", header: "Type", render: (row: any) => row.disease_type ?? "—" },
      ]}
      rows={(block.diseases ?? []).slice(0, 12)}
    />
  </SourceShell>,

  gnomad: (block) => {
    const constraint = block.constraint ?? {};
    return <SourceShell icon={<Dna size={14} />} name="gnomAD — population constraint and variation" block={block}>
      <div className="ext-constraint">
        <StatusPill
          status={constraint.call === "loss_of_function_intolerant" ? "caution" : constraint.call === "loss_of_function_tolerant" ? "pass" : "unknown"}
          label={titleCase(String(constraint.call ?? "not available"))}
        />
        <p>{constraint.note}</p>
      </div>
      <Stats entries={[
        ["pLI", num(constraint.pLI, 3)],
        ["LoF observed/expected", num(constraint.oe_lof, 3)],
        ["LOEUF", num(constraint.loeuf, 3)],
        ["Missense Z", num(constraint.missense_z, 2)],
      ]} />
      <Stats entries={[
        ["Variants returned", text(block.n_variants_returned)],
        ["High-confidence LoF", text(block.n_loss_of_function)],
        ["Missense", text(block.n_missense)],
      ]} />
      <DataTable
        columns={[
          { key: "v", header: "Variant", render: (row: any) => <code>{row.variant_id}</code> },
          { key: "r", header: "rsID", render: (row: any) => row.rsid ?? "—" },
          { key: "c", header: "Consequence", render: (row: any) => String(row.consequence ?? "").replaceAll("_", " ") },
          { key: "a", header: "Allele frequency", align: "right", render: (row: any) => row.allele_frequency != null ? `${(row.allele_frequency * 100).toFixed(4)}%` : "—" },
          { key: "l", header: "LoF", render: (row: any) => row.is_loss_of_function ? <StatusPill status="caution" label="HC LoF" /> : "—" },
        ]}
        rows={(block.variants ?? []).slice(0, 12)}
      />
    </SourceShell>;
  },
};

const PANEL_TITLES: Record<PanelKind, { title: string; subtitle: string }> = {
  target: { title: "Target biology — external databases", subtitle: "STRING functional network, KEGG pathway/disease/drug annotation and Reactome reaction membership for the resolved target." },
  hazard: { title: "Measured toxicology — external databases", subtitle: "EPA ToxRefDB/ToxValDB in-vivo hazard values, ECOTOX environmental endpoints and the ToxCast/Tox21 in-vitro battery." },
  clinical: { title: "Clinical & population evidence — external databases", subtitle: "ClinicalTrials.gov landscape, PharmGKB pharmacogenomics, DisGeNET gene–disease associations and gnomAD population constraint." },
};

export function ExternalEvidencePanel({ panel, identifiers }: { panel: PanelKind; identifiers: Record<string, string | null> }) {
  const [nonce, setNonce] = useState(0);
  const result = useMemo(() => externalPanel(panel, identifiers), [panel, JSON.stringify(identifiers), nonce]);
  const meta = PANEL_TITLES[panel];
  const blocks = result.catalogue.map((entry) => result.sources[entry.key]).filter(Boolean);

  return <Card
    icon={<Database size={16} />} title={meta.title} subtitle={meta.subtitle} note={result.limitations}
    actions={<button className="text-action" onClick={() => setNonce((value) => value + 1)}><RefreshCw size={13} /> Re-query</button>}
  >
    <div className="ext-status-strip">
      <span><b>{blocks.filter((block) => block.status === "live").length}</b> with data</span>
      <span><b>{blocks.filter((block) => block.status === "no-data").length}</b> no record</span>
      <span><b>{blocks.filter((block) => block.status === "skipped").length}</b> not queried</span>
      <span><b>{blocks.filter((block) => ["error", "unavailable"].includes(block.status)).length}</b> unavailable</span>
    </div>
    <div className="ext-identifiers">
      {Object.entries(result.identifiers).filter(([, value]) => value).map(([key, value]) => (
        <span key={key}>{titleCase(key)}: <code>{value}</code></span>
      ))}
      {Object.values(result.identifiers).every((value) => !value) && <span className="hint-muted">No identifier was available for this panel.</span>}
    </div>
    <div>
      {result.catalogue.map((entry) => {
        const block = result.sources[entry.key];
        if (!block) return null;
        const render = RENDERERS[entry.key];
        return <div key={entry.key}>{render ? render(block) : <SourceShell icon={<Database size={14} />} name={entry.name} block={block} />}</div>;
      })}
    </div>
  </Card>;
}

export function FdaPsgPanel({ drugName }: { drugName: string | null }) {
  const result = useMemo(() => fdaPsg(drugName), [drugName]);
  if (!result) return null;
  return <Card
    icon={<Landmark size={16} />}
    title="FDA product-specific guidance & bioequivalence context"
    subtitle="Reference-listed drugs, therapeutic-equivalence codes and the bioequivalence window, from Drugs@FDA and the FDA label."
    note={result.limitation}
  >
    <div className="ext-stat-row">
      <div><small>Applications found</small><b>{text(result.total_apps_found)}</b></div>
      <div><small>Reference-listed products</small><b>{result.reference_listed_drugs.length}</b></div>
      <div><small>BCS class</small><b>{result.bcs_class ?? "not stated on the label"}</b></div>
      <div><small>BE window</small><b style={{ fontSize: 12 }}>{result.be_window_standard}</b></div>
    </div>
    <p className="hint-muted" style={{ marginBottom: 12 }}>{result.bcs_note}</p>
    <DataTable
      columns={[
        { key: "b", header: "Brand", render: (row: any) => <b>{row.brand_name ?? "—"}</b> },
        { key: "a", header: "Application", render: (row: any) => `${row.application_number} · ${row.application_type}` },
        { key: "s", header: "Sponsor", render: (row: any) => row.sponsor ?? "—" },
        { key: "f", header: "Form / route", render: (row: any) => `${row.dosage_form ?? "—"} · ${row.route ?? "—"}` },
        { key: "t", header: "TE code", render: (row: any) => row.te_code ? <span title={row.te_description}>{row.te_code}</span> : "—" },
        { key: "m", header: "Marketing status", render: (row: any) => row.marketing_status ?? "—" },
      ]}
      rows={result.reference_listed_drugs}
    />
    <div className="sub-label">Clinical pharmacology (FDA label extract)</div>
    <p className="hint-muted">{result.clinical_pharmacology_snippet}</p>
    <div className="row" style={{ marginTop: 12 }}>
      <a href={result.psg_search_url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> FDA product-specific guidance search</a>
      <a href={result.dissolution_db_url} target="_blank" rel="noreferrer"><ExternalLink size={12} /> FDA dissolution methods database</a>
    </div>
  </Card>;
}
