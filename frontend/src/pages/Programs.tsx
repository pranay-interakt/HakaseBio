import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ErrorBox } from "../components/common";
import { Empty, Loading, PageHeader, useBreadcrumbs } from "../components/ui";
import { fmtAgo, fmtDateTime, indicationLabel, modalityLabel, routeLabel } from "../lib/format";
import { go, href } from "../lib/router";

interface ProgramRow {
  id: string;
  name: string;
  sponsor: string | null;
  modality: string | null;
  indication: string | null;
  route: string | null;
  compounds: number;
  studies: number;
  created_at: string;
  updated_at: string;
}

export function Programs() {
  useBreadcrumbs([{ label: "Programmes" }]);
  const [list, setList] = useState<ProgramRow[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.getAll<ProgramRow>("/programs").then(setList).catch(setErr);
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = [...(list ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (!needle) return rows;
    return rows.filter((p) =>
      [p.name, p.sponsor, modalityLabel(p.modality), indicationLabel(p.indication)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [list, q]);

  return (
    <div className="page">
      <PageHeader
        title="Programmes"
        meta={list ? `${list.length} programme${list.length === 1 ? "" : "s"}` : undefined}
        actions={
          <a className="btn primary" href={href.newProgram()}>
            New programme
          </a>
        }
      />
      <ErrorBox error={err} />
      {list === null && !err && <Loading />}
      {list && list.length === 0 && (
        <Empty title="No programmes yet">
          Create one: its facts (modality, indication, trial length) derive the nonclinical study set from ICH
          guidelines.
          <div style={{ marginTop: 10 }}>
            <a className="btn primary" href={href.newProgram()}>
              New programme
            </a>
          </div>
        </Empty>
      )}
      {list && list.length > 0 && (
        <section className="card">
          <div className="card-head">
            <input
              style={{ maxWidth: 320 }}
              placeholder="Search programmes"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search programmes"
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Programme</th>
                  <th>Modality</th>
                  <th>Indication</th>
                  <th className="hide-narrow">Route</th>
                  <th className="num hide-narrow">Compounds</th>
                  <th className="num">Studies</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => go(href.program(p.id))}>
                    <td>
                      <a href={href.program(p.id)} onClick={(e) => e.stopPropagation()}>
                        <strong>{p.name}</strong>
                      </a>
                      {p.sponsor && <div className="muted small">{p.sponsor}</div>}
                    </td>
                    <td>{modalityLabel(p.modality)}</td>
                    <td>{indicationLabel(p.indication)}</td>
                    <td className="hide-narrow">{routeLabel(p.route)}</td>
                    <td className="num hide-narrow">{p.compounds}</td>
                    <td className="num">{p.studies}</td>
                    <td className="muted nowrap" title={fmtDateTime(p.updated_at)}>
                      {fmtAgo(p.updated_at)}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No programme matches “{q}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
