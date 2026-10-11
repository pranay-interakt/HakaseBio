import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import {
  Citations,
  DataTable,
  ErrorBox,
  Lifecycle,
  Markdown,
  roleLabel,
  Section,
  StateTag,
} from "../components/common";
import { AuditTrail } from "../components/AuditTrail";
import { ImportWorkspace } from "../components/ImportWorkspace";
import { TriagePanel } from "../components/Triage";
import { QuantityView } from "../components/QuantityView";
import { prune, SchemaFields, SchemaForm } from "../components/SchemaForm";
import { SendExport } from "../components/SendExport";
import {
  Collapsible,
  Facts,
  Loading,
  PageHeader,
  Pill,
  Tabs,
  toast,
  useBreadcrumbs,
  ValueView,
  type TabItem,
} from "../components/ui";
import {
  fmtDateTime,
  humanize,
  meaningLabel,
  MEANINGS,
  sentence,
  shortHash,
  statusLabel,
  targetLabel,
} from "../lib/format";
import { href } from "../lib/router";
import type { Citation, Driver, Principal, Study as StudyT, StudySummary } from "../types";

const DESIGNABLE = ["proposed", "designed", "planned", "dispatched"];
const RECEIVABLE = ["dispatched", "data_received", "analyzed"];

type Run = <T>(fn: () => Promise<T>, done?: string) => Promise<void>;

type StudyTab = "overview" | "design" | "execution" | "results" | "report" | "send" | "audit";

/** Where each piece of work lives: the overview's next step sends you to its tab. */
function tabFor(target: string): StudyTab {
  if (["sec-design", "sec-protocol", "sec-plan"].includes(target)) return "design";
  if (["sec-dispatch", "sec-execution"].includes(target)) return "execution";
  if (["sec-inputs", "sec-analyse", "sec-results", "sec-determinations"].includes(target)) return "results";
  if (target === "sec-report") return "report";
  return "overview";
}

/** Open a study tab and bring the given section into view. */
function goTo(studyId: string, target: string) {
  window.location.hash = href.study(studyId, tabFor(target));
  window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}

export function Study({ id, tab, me }: { id: string; tab: string | null; me: Principal }) {
  const [s, setS] = useState<StudyT | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [siblings, setSiblings] = useState<StudySummary[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const st = await api.get<StudyT>(`/studies/${id}`);
      setS(st);
      if (st.origin === "import") setSiblings(await api.getAll<StudySummary>(`/studies?program_id=${st.program_id}`));
      else setDriver(await api.get<Driver>(`/drivers/${st.driver_id}`));
    } catch (e) {
      setErr(e);
    }
  }, [id]);
  useEffect(() => {
    setS(null);
    setDriver(null);
    load();
  }, [load]);

  const run: Run = async (fn, done) => {
    setBusy(true);
    setErr(null);
    try {
      const out = await fn();
      if (out && typeof out === "object" && "state" in (out as object)) setS(out as unknown as StudyT);
      else await load();
      if (done) toast(done);
    } catch (e) {
      setErr(e);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  };

  const tabs: TabItem[] = [];
  if (s && driver) {
    const st = s.state;
    const later = (states: string[]) => states.includes(st);
    tabs.push({ id: "overview", label: "Overview" });
    tabs.push({ id: "design", label: "Design & protocol" });
    if (s.execution || st === "planned") tabs.push({ id: "execution", label: "Execution & data" });
    if (s.results || later(["data_received", "analyzed"])) tabs.push({ id: "results", label: "Results" });
    if (s.report || st === "analyzed") tabs.push({ id: "report", label: "Report & signatures" });
    if (driver.id === "repeat_dose_toxicity" && s.data) tabs.push({ id: "send", label: "SEND export" });
    tabs.push({ id: "audit", label: "Audit trail" });
  }
  const active = (tabs.some((t) => t.id === tab) ? tab : "overview") as StudyTab;
  const tabLabel = tabs.find((t) => t.id === active)?.label;
  useBreadcrumbs([
    { label: "Programmes", href: href.programs() },
    ...(s
      ? [
          { label: s.program_name ?? "Programme", href: href.program(s.program_id) },
          { label: "Studies", href: href.program(s.program_id, "studies") },
          { label: s.title, href: href.study(s.id) },
        ]
      : [{ label: "Study" }]),
    ...(s && active !== "overview" && tabLabel ? [{ label: tabLabel }] : []),
  ]);

  if (!s) return err ? <ErrorBox error={err} /> : <Loading />;
  const facts: [ReactNode, ReactNode][] = [
    ["Programme", <a href={href.program(s.program_id)}>{s.program_name ?? s.program_id}</a>],
    ["Compound", s.compound_name ?? s.compound_id],
    ["Requirement", s.requirement_name ?? s.requirement_id],
  ];

  if (s.origin === "import") {
    return (
      <div className="page">
        <PageHeader eyebrow="Imported study" title={s.title} meta={<StateTag state={s.state} />}>
          <Lifecycle state={s.state} />
        </PageHeader>
        <section className="card">
          <Facts items={facts} />
        </section>
        <ErrorBox error={err} onDismiss={() => setErr(null)} />
        <ImportWorkspace s={s} me={me} siblings={siblings} busy={busy} run={run} />
        <AuditTrail id={id} key={s.state + s.updated_at} />
        {s.state === "import_draft" && <CancelSection id={id} run={run} />}
      </div>
    );
  }
  if (!driver) return err ? <ErrorBox error={err} /> : <Loading />;

  const amending = s.state !== "proposed";
  return (
    <div className="page">
      <PageHeader
        eyebrow="Study"
        title={s.title}
        meta={
          <>
            <StateTag state={s.state} simulated={s.simulated} />
            <span>{s.glp ? "GLP" : "Non-GLP"}</span>
            <span>CTD {driver.ctd_section}</span>
            <span>{driver.name}</span>
          </>
        }
      >
        <Lifecycle state={s.state} />
      </PageHeader>
      <Tabs items={tabs} active={active} hrefFor={(t) => href.study(s.id, t === "overview" ? undefined : t)} />
      <ErrorBox error={err} onDismiss={() => setErr(null)} />
      {s.simulated && active !== "overview" && (
        <div className="banner-sim">SIMULATED data: for demonstration only; never approved or included in an IND.</div>
      )}

      {active === "overview" && (
        <>
          <Overview s={s} driver={driver} facts={facts} />
          {!["approved", "cancelled", "failed"].includes(s.state) && <CancelSection id={id} run={run} />}
        </>
      )}

      {active === "design" && (
        <>
          {/* what is already known about the compound, while the design can still change */}
          {DESIGNABLE.includes(s.state) && <TriagePanel compoundId={s.compound_id} collapsible />}
          {DESIGNABLE.includes(s.state) && (
            <DesignSection s={s} driver={driver} amending={amending} busy={busy} run={run} />
          )}
          {s.protocol && (
            <ProtocolView protocol={s.protocol} hash={s.protocol_hash} version={s.protocol_version}>
              <ProtocolApproval s={s} me={me} busy={busy} run={run} />
            </ProtocolView>
          )}
          {s.state === "designed" && (
            <Section
              id="sec-plan"
              title="Plan"
              subtitle="Works out duration, sample size and dependencies from the protocol."
            >
              <button
                className="primary"
                disabled={busy}
                onClick={() => run(() => api.post(`/studies/${id}/plan`), "Study planned")}
              >
                Plan study
              </button>
            </Section>
          )}
          {s.plan && <PlanView plan={s.plan} />}
        </>
      )}

      {active === "execution" && (
        <>
          {s.state === "planned" && <DispatchSection s={s} driver={driver} busy={busy} run={run} />}
          {s.execution && <ExecutionView s={s} busy={busy} run={run} />}
        </>
      )}

      {active === "results" && (
        <>
          {s.expected_inputs &&
            Object.keys(s.expected_inputs).length > 0 &&
            !["reported", "approved", "cancelled", "failed"].includes(s.state) && (
              <InputsSection s={s} busy={busy} run={run} />
            )}
          {["data_received", "analyzed", "reported"].includes(s.state) && (
            <AnalyzeSection s={s} busy={busy} run={run} />
          )}
          {s.results && <ResultsView s={s} />}
          {s.expert_determinations && s.expert_determinations.length > 0 && s.results && (
            <DeterminationsSection s={s} me={me} busy={busy} run={run} />
          )}
        </>
      )}

      {active === "report" && (
        <>
          {s.state === "analyzed" && (
            <Section
              id="sec-report"
              title="Report"
              subtitle="Renders the protocol, data, results and interpretation, with every value's provenance."
            >
              <button
                className="primary"
                disabled={busy}
                onClick={() => run(() => api.post(`/studies/${id}/report`), "Report generated")}
              >
                Generate report
              </button>
            </Section>
          )}
          {s.report && <ReportSection s={s} me={me} busy={busy} run={run} />}
        </>
      )}

      {active === "send" && <SendExport studyId={id} key={s.updated_at} />}

      {active === "audit" && <AuditTrail id={id} key={s.state + s.updated_at} open />}
    </div>
  );
}

// ---- overview -------------------------------------------------------------------------------

function Overview({ s, driver, facts }: { s: StudyT; driver: Driver; facts: [ReactNode, ReactNode][] }) {
  const current = s.determinations.filter((d) => s.results && d.analysis_hash === s.results.analysis_hash);
  const specs = s.expert_determinations ?? [];
  const reportSigs = s.report_hash ? s.signatures.filter((g) => g.subject_hash === s.report_hash) : [];
  const protocolApproved = s.signatures.some(
    (g) =>
      g.role === "study_director" &&
      (g.subject_id ?? "").startsWith(`${s.id}/protocol/`) &&
      g.subject_hash === s.protocol_hash,
  );
  return (
    <>
      <NextStep s={s} />
      {/* once analysed, the next-step callout carries this message with its action */}
      {s.simulated && !simulatedEnd(s) && (
        <div className="banner-sim">
          This study contains SIMULATED data. It can be analysed and reported for demonstration but can never be
          approved or included in an IND.
        </div>
      )}
      <Section title="About this study">
        <Facts
          items={[
            ...facts,
            ["Method", `${driver.name} (v${s.driver_version})`],
            ["Created", fmtDateTime(s.created_at)],
            ["Last change", fmtDateTime(s.updated_at)],
          ]}
        />
        {s.hypothesis && <p className="small">Hypothesis: {s.hypothesis}</p>}
      </Section>
      <Section title="At a glance">
        <div className="glance">
          <Glance
            label="Protocol"
            value={s.protocol ? `Version ${s.protocol_version}` : "Not designed"}
            sub={
              s.protocol
                ? s.glp
                  ? protocolApproved
                    ? "Approved by the Study Director"
                    : "Awaiting Study Director approval"
                  : "Designed"
                : undefined
            }
            tone={s.protocol ? (s.glp && !protocolApproved ? "warn" : "ok") : "neutral"}
            target={() => goTo(s.id, "sec-protocol")}
          />
          <Glance
            label="Data"
            value={
              s.raw_files.length > 0 ? `${s.raw_files.length} file${s.raw_files.length === 1 ? "" : "s"}` : "None yet"
            }
            sub={
              s.raw_files.length > 0
                ? `last ${fmtDateTime(s.raw_files[s.raw_files.length - 1].received_at)}`
                : undefined
            }
            tone={s.raw_files.length > 0 ? (s.simulated ? "bad" : "ok") : "neutral"}
            target={() => goTo(s.id, "sec-execution")}
          />
          <Glance
            label="Analysis"
            value={s.results ? `QC ${statusLabel(s.results.qc.status).toLowerCase()}` : "Not run"}
            sub={
              s.results
                ? `${s.results.qc.findings.length} QC finding${s.results.qc.findings.length === 1 ? "" : "s"}`
                : undefined
            }
            tone={
              s.results
                ? s.results.qc.status === "fail"
                  ? "bad"
                  : s.results.qc.status === "warn"
                    ? "warn"
                    : "ok"
                : "neutral"
            }
            target={() => goTo(s.id, "sec-results")}
          />
          <Glance
            label="Determinations"
            value={specs.length === 0 ? "None needed" : `${current.length} of ${specs.length} signed`}
            tone={
              specs.length === 0
                ? "neutral"
                : current.length >= specs.filter((d) => d.required_for_approval).length
                  ? "ok"
                  : "warn"
            }
            target={() => goTo(s.id, "sec-determinations")}
          />
          <Glance
            label="Report"
            value={s.report ? `${reportSigs.length} signature${reportSigs.length === 1 ? "" : "s"}` : "Not generated"}
            sub={
              s.state === "approved"
                ? "Approved"
                : s.approval_missing && s.approval_missing.length > 0
                  ? `still needed: ${s.approval_missing.join(", ")}`
                  : undefined
            }
            tone={s.state === "approved" ? "ok" : s.report ? "warn" : "neutral"}
            target={() => goTo(s.id, "sec-report")}
          />
        </div>
      </Section>
    </>
  );
}

function Glance({
  label,
  value,
  sub,
  tone,
  target,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: string;
  target: () => void;
}) {
  return (
    <button className={`glance-item tone-${tone}`} onClick={target}>
      <span className="glance-label">{label}</span>
      <span className="glance-value">{value}</span>
      {sub && <span className="glance-sub">{sub}</span>}
    </button>
  );
}

// ---- what to do next ------------------------------------------------------------------------

/** A simulated study that has gone as far as simulated data can take it. */
const simulatedEnd = (s: StudyT) => s.simulated && ["analyzed", "reported"].includes(s.state);

function NextStep({ s }: { s: StudyT }) {
  const protocolApproved = s.signatures.some(
    (g) =>
      g.role === "study_director" &&
      (g.subject_id ?? "").startsWith(`${s.id}/protocol/`) &&
      g.subject_hash === s.protocol_hash,
  );
  const current = s.determinations.filter((d) => s.results && d.analysis_hash === s.results.analysis_hash);
  const pendingDets = (s.expert_determinations ?? []).filter(
    (d) => d.required_for_approval && !current.some((x) => x.key === d.key),
  );
  let text: ReactNode = null;
  let target: string | null = null;
  let tone = "";
  if (simulatedEnd(s))
    return (
      <div className="callout warn">
        <div>
          <div className="callout-label">Simulated</div>
          <div className="callout-text">
            This study runs on SIMULATED data: it can be reported for demonstration but never approved or included in an
            IND.{" "}
            {s.state === "analyzed"
              ? "Replace the data with measured data to take it further."
              : "To take the requirement further, start a new study with measured data."}
          </div>
        </div>
        {s.state === "analyzed" ? (
          <button className="small" onClick={() => goTo(s.id, "sec-execution")}>
            Go to the data
          </button>
        ) : (
          <a className="btn small" href={href.program(s.program_id, "studyset")}>
            Open the study set
          </a>
        )}
      </div>
    );
  switch (s.state) {
    case "proposed":
      [text, target] = ["Design the protocol: state the design values and their basis.", "sec-design"];
      break;
    case "designed":
      if (s.glp && !protocolApproved)
        [text, target] = ["The Study Director approves the protocol (GLP), then the study is planned.", "sec-protocol"];
      else [text, target] = ["Plan the study.", "sec-plan"];
      break;
    case "planned":
      [text, target] = ["Dispatch it to a laboratory.", "sec-dispatch"];
      break;
    case "dispatched":
      [text, target] = ["Upload the data the laboratory returns.", "sec-execution"];
      break;
    case "data_received":
      [text, target] = ["Record any analysis inputs, then run the analysis.", "sec-analyse"];
      break;
    case "analyzed":
      if (pendingDets.length > 0)
        [text, target] = [
          `Signed determinations needed: ${pendingDets.map((d) => `${d.label} (${roleLabel(d.role)})`).join(", ")}.`,
          "sec-determinations",
        ];
      else [text, target] = ["Generate the report.", "sec-report"];
      break;
    case "reported":
      if (s.approval_missing && s.approval_missing.length > 0)
        [text, target] = [`Signatures still needed: ${s.approval_missing.join(", ")}.`, "sec-report"];
      else [text, target] = ["Every signature is in: approve the study.", "sec-report"];
      break;
    case "approved":
      [text, tone] = ["Approved. The study is included when Module 4 is assembled.", "ok"];
      break;
    case "cancelled":
    case "failed":
      [text, tone] = [`This study was ${s.state}. Its record is kept unchanged.`, "bad"];
      break;
    default:
      return null;
  }
  return (
    <div className={`callout ${tone}`}>
      <div>
        <div className="callout-label">{tone === "ok" ? "Done" : tone === "bad" ? "Closed" : "Next step"}</div>
        <div className="callout-text">{text}</div>
      </div>
      {target && (
        <button className="primary small" onClick={() => goTo(s.id, target!)}>
          Go there
        </button>
      )}
    </div>
  );
}

// ---- design & protocol ----------------------------------------------------------------------

function DesignSection({
  s,
  driver,
  amending,
  busy,
  run,
}: {
  s: StudyT;
  driver: Driver;
  amending: boolean;
  busy: boolean;
  run: Run;
}) {
  const [reason, setReason] = useState("");
  return (
    <Section
      id="sec-design"
      title={amending ? "Amend design" : "Design"}
      subtitle="Scientific design values and acceptance criteria have no defaults: state them and their basis. Values already filled in come from the regulatory requirement."
    >
      {amending && (
        <label className="field" style={{ maxWidth: 520, marginBottom: 12 }}>
          <span className="field-label">Reason for the amendment *</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <SchemaForm
        key={s.protocol_hash ?? "new"}
        schema={driver.parameters_schema}
        initial={s.parameters}
        busy={busy}
        submitLabel={amending ? "Amend protocol" : "Design protocol"}
        onSubmit={(parameters) =>
          run(
            () => api.post(`/studies/${s.id}/design`, { parameters, reason: amending ? reason : null }),
            amending ? "Protocol amended" : "Protocol designed",
          )
        }
      />
    </Section>
  );
}

/** Study Director approval of the protocol. Its date is the study start date (STSTDTC; FDA TCG
 * v6.3 4.1.3); the server re-authenticates the signer. */
function ProtocolApproval({ s, me, busy, run }: { s: StudyT; me: Principal; busy: boolean; run: Run }) {
  const [statement, setStatement] = useState("");
  const [pw, setPw] = useState("");
  const approvals = s.signatures.filter(
    (g) => g.role === "study_director" && (g.subject_id ?? "").startsWith(`${s.id}/protocol/`),
  );
  const signedCurrent = approvals.some((g) => g.subject_hash === s.protocol_hash);
  return (
    <div style={{ marginTop: 10 }}>
      {approvals.length === 0 ? (
        <div className="muted small">
          {s.glp
            ? "Not yet approved by the Study Director."
            : "Non-GLP study: the protocol does not wait for Study Director approval."}
        </div>
      ) : (
        approvals.map((g, i) => (
          <div key={i} className="signed small">
            Approved by {g.signer_name} (Study Director), {fmtDateTime(g.signed_at)}
            {g.subject_hash !== s.protocol_hash && " — an earlier protocol version"}: “{g.statement}”
          </div>
        ))
      )}
      {!signedCurrent && me.kind === "human" && me.roles.includes("study_director") && (
        <div className="grid3" style={{ marginTop: 8, alignItems: "end" }}>
          <label className="field" style={{ gridColumn: "span 2" }}>
            <span className="field-label">Statement of approval *</span>
            <input
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="I approve this protocol."
            />
          </label>
          <label className="field">
            <span className="field-label">Your password *</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </label>
          <div className="field">
            <button
              className="primary"
              disabled={busy || !statement || !pw}
              onClick={() =>
                run(() => api.post(`/studies/${s.id}/protocol/sign`, { statement, password: pw }), "Protocol approved")
              }
            >
              Approve protocol
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProtocolView({
  protocol,
  hash,
  version,
  children,
}: {
  protocol: Record<string, unknown>;
  hash: string | null;
  version: number;
  children?: ReactNode;
}) {
  const p = protocol as {
    title: string;
    objective: string;
    design: Record<string, unknown>;
    steps: { number: number; title: string; instruction: string }[];
    acceptance_criteria: { code: string; description: string; basis: string }[];
    references: Citation[];
    regulatory_basis: string[];
  };
  const [open, setOpen] = useState(false);
  return (
    <Section
      id="sec-protocol"
      title={`Protocol, version ${version}`}
      subtitle={
        <>
          {p.title} · fingerprint <span className="mono">{shortHash(hash, 16)}</span>
        </>
      }
      right={
        <button className="small" onClick={() => setOpen(!open)}>
          {open ? "Hide protocol" : "Show protocol"}
        </button>
      }
    >
      {children}
      {open && (
        <div style={{ marginTop: 12 }}>
          <h4>Objective</h4>
          <p>{p.objective}</p>
          <h4>Design</h4>
          <ValueView value={p.design} />
          <h4>Procedure</h4>
          <ol>
            {p.steps.map((st) => (
              <li key={st.number}>
                <strong>{st.title}.</strong> {st.instruction}
              </li>
            ))}
          </ol>
          <h4>Acceptance criteria</h4>
          <ul>
            {p.acceptance_criteria.map((a) => (
              <li key={a.code}>
                {a.description} <span className="muted small">(basis: {a.basis})</span>
              </li>
            ))}
          </ul>
          <h4>Regulatory basis</h4>
          <ul className="small">
            {p.regulatory_basis.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <h4>References</h4>
          <Citations list={p.references} />
        </div>
      )}
    </Section>
  );
}

function PlanView({ plan }: { plan: Record<string, unknown> }) {
  return (
    <Section id="sec-plan" title="Plan">
      <Facts
        items={[
          [
            "Duration",
            plan.execution_duration_days === null
              ? "Set by the laboratory"
              : `${String(plan.execution_duration_days)} days`,
          ],
          ["Duration basis", sentence(String(plan.duration_basis ?? "—"))],
          ["Samples / animals", String(plan.sample_count ?? "—")],
          ["Sample basis", sentence(String(plan.sample_count_basis ?? "—"))],
          ["Cost", sentence(String(plan.cost_note ?? "—"))],
          ["Depends on", sentence(((plan.dependencies as string[] | undefined) ?? []).join("; ")) || "Nothing"],
        ]}
      />
    </Section>
  );
}

// ---- dispatch & execution -------------------------------------------------------------------

function DispatchSection({ s, driver, busy, run }: { s: StudyT; driver: Driver; busy: boolean; run: Run }) {
  const [kind, setKind] = useState("external_lab");
  const [lab, setLab] = useState("");
  const [contact, setContact] = useState("");
  const [quote, setQuote] = useState("");
  const [glp, setGlp] = useState(false);
  const [scientist, setScientist] = useState("");
  const [sim, setSim] = useState<Record<string, unknown>>({});
  const [seed, setSeed] = useState("");
  function dispatch() {
    let target: Record<string, unknown>;
    if (kind === "external_lab")
      target = { kind, laboratory: lab, contact: contact || null, quote_reference: quote || null, glp_certified: glp };
    else if (kind === "in_house") target = { kind, laboratory: lab, responsible_scientist: scientist };
    else target = { kind, simulation_parameters: prune(sim) ?? {}, seed: seed.trim() === "" ? null : Number(seed) };
    run(
      () => api.post(`/studies/${s.id}/dispatch`, { target }),
      kind === "simulation" ? "Simulation set up" : `Dispatched to ${lab}`,
    );
  }
  const kinds = ["external_lab", "in_house", ...(driver.can_simulate ? ["simulation"] : [])];
  return (
    <Section
      id="sec-dispatch"
      title="Dispatch"
      subtitle="Where the study is run. The dispatch bundle (protocol, sample manifest, data template) is produced for the laboratory."
    >
      <div className="checks">
        {kinds.map((k) => (
          <label key={k}>
            <input type="radio" checked={kind === k} onChange={() => setKind(k)} /> {targetLabel(k)}
          </label>
        ))}
      </div>
      {kind !== "simulation" && (
        <div className="grid2">
          <label className="field">
            <span className="field-label">Laboratory *</span>
            <input value={lab} onChange={(e) => setLab(e.target.value)} />
          </label>
          {kind === "external_lab" ? (
            <>
              <label className="field">
                <span className="field-label">Contact</span>
                <input value={contact} onChange={(e) => setContact(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Laboratory quote reference</span>
                <input value={quote} onChange={(e) => setQuote(e.target.value)} />
              </label>
              <label className="checks">
                <span>
                  <input type="checkbox" checked={glp} onChange={(e) => setGlp(e.target.checked)} /> GLP-certified
                  facility
                </span>
              </label>
            </>
          ) : (
            <label className="field">
              <span className="field-label">Responsible scientist *</span>
              <input value={scientist} onChange={(e) => setScientist(e.target.value)} />
            </label>
          )}
        </div>
      )}
      {kind === "simulation" && (
        <div className="stack">
          <div className="banner-sim">
            Simulation generates data from a model you state. It is labelled SIMULATED everywhere and can never be
            approved or used as evidence.
          </div>
          {driver.simulation_parameters_schema && (
            <div className="sf-group">
              <div className="sf-group-head">
                <span className="sf-group-title">Simulated truth</span>
              </div>
              <SchemaFields schema={driver.simulation_parameters_schema} value={sim} onChange={setSim} />
            </div>
          )}
          <label className="field" style={{ maxWidth: 200 }}>
            <span className="field-label">Seed *</span>
            <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </label>
        </div>
      )}
      <div className="row-end">
        <button className="primary" disabled={busy} onClick={dispatch}>
          Dispatch
        </button>
      </div>
    </Section>
  );
}

function ExecutionView({ s, busy, run }: { s: StudyT; busy: boolean; run: Run }) {
  const ex = s.execution as {
    target: Record<string, unknown>;
    target_kind: string;
    bundle_sha256: string;
    dispatched_at: string;
    notes: string[];
  };
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const replacing = s.state !== "dispatched";
  return (
    <Section
      id="sec-execution"
      title="Execution & data"
      right={
        <>
          <button className="small" onClick={() => api.download(`/studies/${s.id}/bundle`, `${s.id}_dispatch.zip`)}>
            Download dispatch bundle
          </button>
          <button className="small" onClick={() => api.download(`/studies/${s.id}/template`, `${s.id}_template.csv`)}>
            Download data template
          </button>
        </>
      }
    >
      <Facts
        items={[
          [
            "Run by",
            `${targetLabel(ex.target_kind)}${ex.target.laboratory ? `: ${String(ex.target.laboratory)}` : ""}`,
          ],
          ["Dispatched", fmtDateTime(ex.dispatched_at)],
          ["Bundle", <span className="mono">{shortHash(ex.bundle_sha256, 16)}</span>],
        ]}
      />
      {ex.notes.map((n) => (
        <div key={n} className="muted small">
          {sentence(n)}
        </div>
      ))}
      {RECEIVABLE.includes(s.state) && (
        <div className="sf-group" style={{ marginTop: 12 }}>
          <div className="sf-group-head">
            <span className="sf-group-title">{replacing ? "Replace the data" : "Receive the data"}</span>
          </div>
          <div className="upload">
            {replacing && (
              <input
                style={{ maxWidth: 360 }}
                placeholder="Reason for replacing the data *"
                aria-label="Reason for replacing the data"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            {ex.target_kind === "simulation" ? (
              <button
                className="primary"
                disabled={busy || (replacing && !reason.trim())}
                onClick={() =>
                  run(
                    () => api.post(`/studies/${s.id}/data/simulated`, { reason: replacing ? reason : null }),
                    "Simulated data loaded",
                  )
                }
              >
                Load simulated data
              </button>
            ) : (
              <>
                <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <button
                  className="primary"
                  disabled={busy || !file || (replacing && !reason.trim())}
                  onClick={() =>
                    file &&
                    run(
                      () =>
                        api.upload(
                          `/studies/${s.id}/data?filename=${encodeURIComponent(file.name)}${replacing ? `&reason=${encodeURIComponent(reason)}` : ""}`,
                          file,
                        ),
                      `${file.name} received and validated`,
                    )
                  }
                >
                  Upload returned data
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {s.raw_files.length > 0 && (
        <>
          <h4>Files received</h4>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Origin</th>
                  <th>SHA-256</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {s.raw_files.map((f) => (
                  <tr key={f.sha256 + f.received_at}>
                    <td>{f.filename}</td>
                    <td>
                      <span className={`badge badge-${f.origin}`}>{f.origin}</span>
                    </td>
                    <td className="mono">{shortHash(f.sha256, 16)}</td>
                    <td>{fmtDateTime(f.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

// ---- inputs & analysis ----------------------------------------------------------------------

function InputsSection({ s, busy, run }: { s: StudyT; busy: boolean; run: Run }) {
  const expected = s.expected_inputs ?? {};
  const selections = new Set(s.selection_inputs ?? []);
  const names = Object.keys(expected).filter((n) => !selections.has(n));
  const selNames = Object.keys(expected).filter((n) => selections.has(n));
  const init = (n: string): Record<string, string> => {
    const cur = s.analysis_inputs[n] ?? {};
    return {
      value: cur.value === undefined ? "" : String(cur.value),
      unit: String(cur.unit ?? expected[n]),
      kind: selections.has(n) ? "user_supplied" : String(cur.kind ?? "measured"),
      source: String(cur.source ?? cur.note ?? ""),
    };
  };
  // the form keeps only what the user edited; anything else is read from the study
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const val = (n: string) => edits[n] ?? init(n);
  function save() {
    const inputs: Record<string, Record<string, unknown>> = {};
    for (const n of [...names, ...selNames]) {
      const v = val(n);
      if (v.value.trim() === "" || !(n in edits)) continue;
      inputs[n] = selections.has(n)
        ? { value: Number(v.value), unit: v.unit, kind: "user_supplied", note: v.source || null }
        : { value: Number(v.value), unit: v.unit, kind: v.kind, source: v.source || null };
    }
    if (Object.keys(inputs).length === 0) return;
    run(() => api.put(`/studies/${s.id}/inputs`, { inputs }), "Analysis inputs recorded");
    setEdits({});
  }
  const upd = (n: string, k: string, v: string) => setEdits((o) => ({ ...o, [n]: { ...val(n), [k]: v } }));
  const recorded = (n: string) => s.analysis_inputs[n]?.value !== undefined;
  return (
    <Section
      id="sec-inputs"
      title="Analysis inputs"
      subtitle="Values the analysis needs that this study does not measure, each with its provenance and source. A missing input leaves the results that depend on it unavailable, never assumed."
    >
      {names.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="sf-table">
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Provenance</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {names.map((n) => (
                  <tr key={n}>
                    <td title={n}>
                      {humanize(n)}
                      {recorded(n) && (
                        <span className="recorded" title="Recorded on the study">
                          ✓ recorded
                        </span>
                      )}
                    </td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={val(n).value}
                        onChange={(e) => upd(n, "value", e.target.value)}
                      />
                    </td>
                    <td>
                      <input value={val(n).unit} onChange={(e) => upd(n, "unit", e.target.value)} />
                    </td>
                    <td>
                      <select value={val(n).kind} onChange={(e) => upd(n, "kind", e.target.value)}>
                        <option value="measured">Measured</option>
                        <option value="literature">Literature</option>
                        <option value="user_supplied">User supplied</option>
                      </select>
                    </td>
                    <td>
                      <input value={val(n).source} onChange={(e) => upd(n, "source", e.target.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {selNames.length > 0 && (
        <>
          <p className="muted small">
            Selections only you can make after seeing the data (for example the start of each profile&apos;s terminal
            phase; see the candidate table in the results). Each is recorded as user-supplied under your name, and the
            next analysis uses it.
          </p>
          <div className="table-wrap">
            <table className="sf-table">
              <thead>
                <tr>
                  <th>Selection</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {selNames.map((n) => (
                  <tr key={n}>
                    <td title={n}>{humanize(n)}</td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={val(n).value}
                        onChange={(e) => upd(n, "value", e.target.value)}
                      />
                    </td>
                    <td>
                      <input value={val(n).unit} onChange={(e) => upd(n, "unit", e.target.value)} />
                    </td>
                    <td>
                      <input value={val(n).source} onChange={(e) => upd(n, "source", e.target.value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="row-end">
        <button disabled={busy || Object.keys(edits).length === 0} onClick={save}>
          Save inputs
        </button>
      </div>
    </Section>
  );
}

function AnalyzeSection({ s, busy, run }: { s: StudyT; busy: boolean; run: Run }) {
  const [reason, setReason] = useState("");
  const re = s.state !== "data_received";
  return (
    <Section
      id="sec-analyse"
      title={re ? "Re-analyse" : "Analyse"}
      subtitle={re ? "A new analysis is a new version; the earlier one stays on the record." : undefined}
    >
      <div className="row">
        {re && (
          <input
            style={{ maxWidth: 420 }}
            placeholder="Reason for re-analysis *"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
        <button
          className="primary"
          disabled={busy || (re && !reason.trim())}
          onClick={() =>
            run(() => api.post(`/studies/${s.id}/analyze`, { reason: re ? reason : null }), "Analysis complete")
          }
        >
          {re ? "Re-analyse" : "Run analysis"}
        </button>
      </div>
    </Section>
  );
}

function ResultsView({ s }: { s: StudyT }) {
  const r = s.results!;
  const interp = s.interpretation;
  return (
    <>
      <Section
        id="sec-results"
        title="Results"
        subtitle={
          <>
            Click any value for its derivation. Analysis fingerprint{" "}
            <span className="mono">{shortHash(r.analysis_hash, 16)}</span>
          </>
        }
        right={<span className={`tag tag-${r.qc.status}`}>QC {statusLabel(r.qc.status)}</span>}
      >
        {!r.evidence_admissible && <div className="banner-sim">Not admissible as evidence (simulated data).</div>}
        {r.qc.findings.length > 0 && (
          <ul className="small">
            {r.qc.findings.map((f, i) => (
              <li key={i} className={`qc-${f.status}`}>
                <span className={`tag tag-${f.status}`}>{statusLabel(f.status)}</span> {f.message}
              </li>
            ))}
          </ul>
        )}
        {r.tables.map((t) => (
          <DataTable key={t.title} t={t} />
        ))}
        {r.notes.length > 0 && (
          <ul className="notes">
            {r.notes.map((n, i) => (
              <li key={i}>{sentence(n)}</li>
            ))}
          </ul>
        )}
      </Section>
      {interp && (
        <Section
          title="Interpretation"
          subtitle="Statements come from cited rules only; judgements are left to the accountable expert."
        >
          {interp.statements.map((st, i) => (
            <div key={i} className={`statement sev-${st.severity}`}>
              <div>{st.statement}</div>
              {st.citations.length > 0 ? (
                <details className="basis">
                  <summary>Basis: {st.basis}</summary>
                  <Citations list={st.citations} />
                </details>
              ) : (
                <div className="muted small">Basis: {st.basis}</div>
              )}
            </div>
          ))}
          {interp.requires_expert_judgement.length > 0 && (
            <>
              <h4>Requires expert judgement (not decided by the system)</h4>
              <ul>
                {interp.requires_expert_judgement.map((j) => (
                  <li key={j}>{j}</li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}
    </>
  );
}

function DeterminationsSection({ s, me, busy, run }: { s: StudyT; me: Principal; busy: boolean; run: Run }) {
  const specs = s.expert_determinations ?? [];
  const current = s.determinations.filter((d) => s.results && d.analysis_hash === s.results.analysis_hash);
  const [form, setForm] = useState<
    Record<string, { value: string; notEstablished: boolean; rationale: string; password: string; reason: string }>
  >({});
  const f = (k: string) => form[k] ?? { value: "", notEstablished: false, rationale: "", password: "", reason: "" };
  const upd = (k: string, patch: Partial<ReturnType<typeof f>>) =>
    setForm((o) => ({ ...o, [k]: { ...f(k), ...patch } }));
  return (
    <Section
      id="sec-determinations"
      title="Expert determinations"
      subtitle="Each is signed by the accountable person; the system never decides these."
    >
      {specs.map((d) => {
        const rec = current.find((x) => x.key === d.key);
        const canSign = me.kind === "human" && me.roles.includes(d.role);
        return (
          <div key={d.key} className="determination">
            <div className="row">
              <strong>{d.label}</strong>
              {d.required_for_approval && <Pill tone={rec ? "ok" : "warn"}>{rec ? "signed" : "required"}</Pill>}
              <span className="muted small">signed by the {roleLabel(d.role)}</span>
            </div>
            <div className="muted small">{d.guidance}</div>
            {rec && (
              <div className="signed small">
                {rec.quantity ? <QuantityView q={rec.quantity} /> : <span className="tag">{rec.category}</span>} —{" "}
                {rec.signer_name} ({roleLabel(rec.role)}), {fmtDateTime(rec.signed_at)}. Rationale: {rec.rationale}
              </div>
            )}
            {s.state === "analyzed" && canSign && (
              <div className="grid2" style={{ marginTop: 8 }}>
                {d.categorical ? (
                  <label className="field">
                    <span className="field-label">Determination *</span>
                    <select value={f(d.key).value} onChange={(e) => upd(d.key, { value: e.target.value })}>
                      <option value="">Choose…</option>
                      {d.choices.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="field">
                    <span className="field-label">Value{d.unit ? ` (${d.unit})` : ""} *</span>
                    <input
                      inputMode="decimal"
                      disabled={f(d.key).notEstablished}
                      value={f(d.key).value}
                      onChange={(e) => upd(d.key, { value: e.target.value })}
                    />
                    <span className="checks small" style={{ margin: 0 }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={f(d.key).notEstablished}
                          onChange={(e) => upd(d.key, { notEstablished: e.target.checked })}
                        />{" "}
                        Not established
                      </label>
                    </span>
                  </label>
                )}
                <label className="field">
                  <span className="field-label">Rationale *</span>
                  <textarea
                    className="prose"
                    rows={2}
                    value={f(d.key).rationale}
                    onChange={(e) => upd(d.key, { rationale: e.target.value })}
                  />
                </label>
                {rec && (
                  <label className="field">
                    <span className="field-label">Reason for revision *</span>
                    <input value={f(d.key).reason} onChange={(e) => upd(d.key, { reason: e.target.value })} />
                  </label>
                )}
                <label className="field">
                  <span className="field-label">Your password *</span>
                  <input
                    type="password"
                    value={f(d.key).password}
                    onChange={(e) => upd(d.key, { password: e.target.value })}
                    autoComplete="current-password"
                  />
                </label>
                <div className="field" style={{ justifyContent: "flex-end" }}>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          api.post(`/studies/${s.id}/determinations`, {
                            key: d.key,
                            value: d.categorical || f(d.key).notEstablished ? null : Number(f(d.key).value),
                            category: d.categorical ? f(d.key).value : null,
                            unit: d.unit,
                            rationale: f(d.key).rationale,
                            password: f(d.key).password,
                            reason: f(d.key).reason || null,
                          }),
                        `${d.label} signed`,
                      )
                    }
                  >
                    Sign determination
                  </button>
                </div>
              </div>
            )}
            {s.state === "analyzed" && !canSign && !rec && (
              <div className="muted small">Awaiting the {roleLabel(d.role)}.</div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ---- report, signatures, approval -----------------------------------------------------------

function ReportSection({ s, me, busy, run }: { s: StudyT; me: Principal; busy: boolean; run: Run }) {
  const [role, setRole] = useState(me.roles[0] ?? "");
  const [meaning, setMeaning] = useState("approval");
  const [statement, setStatement] = useState("");
  const [pw, setPw] = useState("");
  const [apw, setApw] = useState("");
  const current = s.signatures.filter((g) => g.subject_hash === s.report_hash);
  return (
    <Section
      id="sec-report"
      title="Report"
      right={
        <button className="small" onClick={() => api.download(`/studies/${s.id}/report.md`, `${s.id}_report.md`)}>
          Download
        </button>
      }
    >
      <div className="report-box">
        <Markdown text={s.report!.markdown} />
      </div>
      <h4>Signatures on this report</h4>
      {current.length === 0 && <p className="muted small">None yet.</p>}
      {current.map((g, i) => (
        <div key={i} className="signed small">
          <strong>{g.signer_name}</strong> — {roleLabel(g.role)} ({meaningLabel(g.meaning).toLowerCase()}),{" "}
          {fmtDateTime(g.signed_at)}: “{g.statement}”
        </div>
      ))}
      {s.state === "reported" && me.kind === "human" && (
        <>
          <h4>Sign</h4>
          <div className="grid2">
            <label className="field">
              <span className="field-label">Signing as *</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {me.roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Meaning of the signature *</span>
              <select value={meaning} onChange={(e) => setMeaning(e.target.value)}>
                {Object.keys(MEANINGS).map((m) => (
                  <option key={m} value={m}>
                    {meaningLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Statement *</span>
              <input
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="I approve this report as an accurate account."
              />
            </label>
            <label className="field">
              <span className="field-label">Your password *</span>
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          </div>
          <div className="row-end">
            <button
              disabled={busy || !statement || !pw}
              onClick={() =>
                run(
                  () => api.post(`/studies/${s.id}/sign`, { role, meaning, statement, password: pw }),
                  "Report signed",
                )
              }
            >
              Sign report
            </button>
          </div>
          <h4>Approve</h4>
          {s.simulated ? (
            <p className="small muted">Simulated data cannot be approved.</p>
          ) : s.approval_missing && s.approval_missing.length > 0 ? (
            <p className="small">Still required before approval: {s.approval_missing.join(", ")}</p>
          ) : (
            <div className="row">
              <input
                style={{ maxWidth: 260 }}
                type="password"
                placeholder="Your password *"
                value={apw}
                onChange={(e) => setApw(e.target.value)}
              />
              <button
                className="primary"
                disabled={busy || !apw}
                onClick={() => run(() => api.post(`/studies/${s.id}/approve`, { password: apw }), "Study approved")}
              >
                Approve study
              </button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ---- audit trail & cancel -------------------------------------------------------------------

function CancelSection({ id, run }: { id: string; run: Run }) {
  const [reason, setReason] = useState("");
  return (
    <Collapsible title="Cancel this study" defaultOpen={false}>
      <p className="muted small">Cancelling ends the study. Everything recorded so far is kept unchanged.</p>
      <div className="row">
        <input
          style={{ maxWidth: 420 }}
          placeholder="Reason *"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          className="danger"
          disabled={!reason.trim()}
          onClick={() => run(() => api.post(`/studies/${id}/cancel`, { reason }), "Study cancelled")}
        >
          Cancel study
        </button>
      </div>
    </Collapsible>
  );
}
