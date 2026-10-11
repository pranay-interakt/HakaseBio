// In silico triage for one compound: what is already known before a study is commissioned.
// Decision support, never evidence — the panel says so, and says plainly where a screen
// could not answer rather than showing a number.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { fmtAgo, fmtDateTime } from "../lib/format";
import { href } from "../lib/router";
import type { Compound, Quantity } from "../types";
import { ErrorBox, Section } from "./common";
import { QuantityView } from "./QuantityView";
import { Collapsible, Empty, Loading, Pill, toast } from "./ui";

interface AlertMatch {
  alert: string;
  alert_set: string;
  scope: string;
  reference: string;
  atom_indices: number[];
}

interface Analogue {
  identifier: string;
  name: string | null;
  smiles: string;
  similarity: number;
  value: Quantity;
  n_measurements: number;
  source_url: string | null;
}

interface Signal {
  id: string;
  title: string;
  outcome: "alerting" | "no_alert" | "measured" | "predicted" | "not_predictable";
  summary: string;
  quantity: Quantity | null;
  alerts: AlertMatch[];
  analogues: Analogue[];
  limits: string[];
  citations: { key: string; text: string; doi?: string | null; url?: string | null }[];
  reason: string | null;
}

interface Report {
  compound_id: string;
  version: number;
  created_at: string;
  created_by: string;
  created_by_name?: string | null;
  canonical_smiles: string;
  signals: Signal[];
  limitation: string;
}

const TONE: Record<Signal["outcome"], string> = {
  alerting: "warn",
  no_alert: "ok",
  measured: "info",
  predicted: "accent",
  not_predictable: "neutral",
};

const LABEL: Record<Signal["outcome"], string> = {
  alerting: "Alert matched",
  no_alert: "No alert",
  measured: "Already measured",
  predicted: "Estimated",
  not_predictable: "Not predictable",
};

/** One screen's result: the headline, then its evidence, then what it does not establish. */
function SignalCard({ s }: { s: Signal }) {
  return (
    <div className={`signal signal-${s.outcome}`}>
      <div className="signal-head">
        <div className="signal-title">{s.title}</div>
        <Pill tone={TONE[s.outcome]}>{LABEL[s.outcome]}</Pill>
      </div>
      <div className="signal-summary">{s.summary}</div>
      {/* a screen that produced a scientific value shows it with its provenance; an alert
          count is already carried by the summary and the table of matches below */}
      {s.quantity && s.quantity.value !== null && (s.outcome === "measured" || s.outcome === "predicted") && (
        <div className="signal-value">
          <QuantityView q={s.quantity} />
        </div>
      )}

      {s.alerts.length > 0 && (
        <table className="compact signal-table">
          <thead>
            <tr>
              <th>Alert</th>
              <th>What the set covers</th>
              <th className="num">Atoms</th>
            </tr>
          </thead>
          <tbody>
            {s.alerts.map((a) => (
              <tr key={a.alert}>
                <td>{a.alert.replace(/_/g, " ")}</td>
                <td className="small muted">{a.scope}</td>
                <td className="num small">{a.atom_indices.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {s.analogues.length > 0 && (
        <>
          <div className="signal-sub">Measured compounds this was read across from</div>
          <table className="compact signal-table">
            <thead>
              <tr>
                <th>Compound</th>
                <th className="num">Similarity</th>
                <th className="num">Measurements</th>
                <th>Measured value</th>
              </tr>
            </thead>
            <tbody>
              {s.analogues.map((a) => (
                <tr key={a.identifier}>
                  <td>
                    {a.source_url ? (
                      <a href={a.source_url} target="_blank" rel="noreferrer noopener">
                        {a.name ?? a.identifier}
                      </a>
                    ) : (
                      (a.name ?? a.identifier)
                    )}
                  </td>
                  <td className="num">{a.similarity.toFixed(2)}</td>
                  <td className="num">{a.n_measurements}</td>
                  <td>
                    <QuantityView q={a.value} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {s.limits.length > 0 && (
        <details className="more-options signal-limits">
          <summary>What this does not establish ({s.limits.length})</summary>
          <ul className="small">
            {s.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {s.citations.length > 0 && (
            <ul className="small cites">
              {s.citations.map((c) => (
                <li key={c.key}>
                  {c.text}
                  {c.doi && (
                    <>
                      {" "}
                      <a href={`https://doi.org/${c.doi}`} target="_blank" rel="noreferrer noopener">
                        doi:{c.doi}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}

export function TriagePanel({
  compoundId,
  title = "In silico triage",
  collapsible = false,
}: {
  compoundId: string;
  title?: string;
  collapsible?: boolean;
}) {
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api
      .get<Report | null>(`/compounds/${compoundId}/triage`)
      .then(setReport)
      .catch((e) => {
        setReport(null);
        setErr(e);
      });
  }, [compoundId]);
  useEffect(load, [load]);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      setReport(await api.post<Report>(`/compounds/${compoundId}/triage`));
      toast("Triage run recorded");
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const action = (
    <button className="primary" onClick={run} disabled={busy}>
      {busy ? "Screening…" : report ? "Run again" : "Run triage"}
    </button>
  );

  const body = (
    <>
      <ErrorBox error={err} onDismiss={() => setErr(null)} />
      {report === undefined ? (
        <Loading />
      ) : report === null ? (
        <Empty title="Not screened yet">
          Screens the structure and looks up what has already been measured for it, to help choose and design studies.
          Nothing it finds becomes part of a study record.
        </Empty>
      ) : (
        <>
          <div className="muted small">
            Version {report.version} · {fmtDateTime(report.created_at)} by {report.created_by_name ?? report.created_by}
          </div>
          <div className="signals">
            {report.signals.map((s) => (
              <SignalCard key={s.id} s={s} />
            ))}
          </div>
          <div className="note small triage-limitation">{report.limitation}</div>
        </>
      )}
    </>
  );

  if (collapsible) {
    return (
      <Collapsible title={title} defaultOpen={false} right={action}>
        {body}
      </Collapsible>
    );
  }
  return (
    <Section title={title} right={action}>
      {body}
    </Section>
  );
}

// ---- across a programme's compounds ---------------------------------------------------------

// On a narrow screen the two artefact columns give way: what decides a study is the
// reactive-group alert and the hERG value.
const ALERT_COLUMNS = [
  { id: "alerts.brenk", short: "Reactive groups", narrow: true },
  { id: "alerts.pains", short: "Assay interference", narrow: false },
  { id: "alerts.nih", short: "Screening artefacts", narrow: false },
];

function AlertCell({ signal }: { signal: Signal | undefined }) {
  if (!signal) return <span className="muted">—</span>;
  if (signal.outcome === "not_predictable")
    return (
      <span className="muted" title={signal.reason ?? undefined}>
        Not screened
      </span>
    );
  const n = signal.alerts.length;
  if (n === 0) return <Pill tone="ok">None</Pill>;
  return (
    <Pill tone="warn" title={signal.alerts.map((a) => a.alert.replace(/_/g, " ")).join(", ")}>
      {n} alert{n === 1 ? "" : "s"}
    </Pill>
  );
}

function HergCell({ signal }: { signal: Signal | undefined }) {
  if (!signal) return <span className="muted">—</span>;
  if (signal.outcome === "not_predictable")
    return (
      <span className="muted" title={signal.reason ?? undefined}>
        Not predictable
      </span>
    );
  return (
    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      {signal.quantity && <QuantityView q={signal.quantity} compact />}
      {signal.outcome === "measured" && <span className="muted small nowrap">measured</span>}
      {signal.outcome === "predicted" && (
        <span className="muted small nowrap">from {signal.analogues.length} analogues</span>
      )}
    </span>
  );
}

/** Every compound in a programme side by side, so candidates can be compared at a glance. */
export function ProgramTriage({ programId, compounds }: { programId: string; compounds: Compound[] }) {
  const [reports, setReports] = useState<Record<string, Report> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    api
      .get<Record<string, Report>>(`/programs/${programId}/triage`)
      .then(setReports)
      .catch((e) => {
        setReports({});
        setErr(e);
      });
  }, [programId]);
  useEffect(load, [load]);

  const structures = compounds.filter((c) => c.kind !== "sequence");
  const unscreened = structures.filter((c) => !(reports ?? {})[c.id]);

  async function screen(ids: string[]) {
    setErr(null);
    for (const id of ids) {
      setBusy(id);
      try {
        await api.post(`/compounds/${id}/triage`);
      } catch (e) {
        setErr(e);
        break;
      }
    }
    setBusy("");
    load();
    toast("Triage recorded");
  }

  const signal = (id: string, sid: string) => (reports ?? {})[id]?.signals.find((s) => s.id === sid);

  return (
    <Section
      title="In silico triage"
      subtitle="What is already known about each compound, before studies are commissioned. Decision support: nothing here is part of a study record or a submission."
      right={
        unscreened.length > 0 ? (
          <button className="primary" disabled={!!busy} onClick={() => screen(unscreened.map((c) => c.id))}>
            {busy ? "Screening…" : `Screen ${unscreened.length} compound${unscreened.length === 1 ? "" : "s"}`}
          </button>
        ) : undefined
      }
    >
      <ErrorBox error={err} onDismiss={() => setErr(null)} />
      {reports === null ? (
        <Loading />
      ) : structures.length === 0 ? (
        <Empty title="No structures to screen">Triage screens registered small-molecule structures.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Compound</th>
                {ALERT_COLUMNS.map((c) => (
                  <th key={c.id} className={c.narrow ? undefined : "hide-narrow"}>
                    {c.short}
                  </th>
                ))}
                <th>hERG IC50</th>
                <th>Screened</th>
              </tr>
            </thead>
            <tbody>
              {structures.map((c) => {
                const report = (reports ?? {})[c.id];
                return (
                  <tr key={c.id}>
                    <td>
                      <a href={href.program(programId, "compounds")}>{c.name}</a>
                    </td>
                    {ALERT_COLUMNS.map((col) => (
                      <td key={col.id} className={col.narrow ? "nowrap" : "nowrap hide-narrow"}>
                        <AlertCell signal={signal(c.id, col.id)} />
                      </td>
                    ))}
                    <td className="nowrap">
                      <HergCell signal={signal(c.id, "herg.read_across")} />
                    </td>
                    <td className="muted small nowrap">
                      {report ? (
                        <span title={fmtDateTime(report.created_at)}>{fmtAgo(report.created_at)}</span>
                      ) : (
                        <button className="small" disabled={!!busy} onClick={() => screen([c.id])}>
                          Screen
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="note small triage-limitation">
        An alert is a published substructure matched in the structure, not a finding. A hERG value is either a published
        measurement for that compound or an estimate read across measured analogues; where neither is possible the
        screen says so rather than offering a number. No accuracy is claimed for any signal until a pre-registered,
        held-out validation is published.
      </div>
    </Section>
  );
}
