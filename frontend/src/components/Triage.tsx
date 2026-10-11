// In silico triage for one compound: what is already known before a study is commissioned.
// Decision support, never evidence — the panel says so, and says plainly where a screen
// could not answer rather than showing a number.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { fmtDateTime } from "../lib/format";
import type { Quantity } from "../types";
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
