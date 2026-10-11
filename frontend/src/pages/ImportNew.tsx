import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorBox, Section } from "../components/common";
import type { ImportFieldSpec, Program, Study } from "../types";

// Create an imported study: a study run outside HOS, entered from its final report.
export function ImportNew({ programId, requirementId, go }: { programId: string; requirementId: string; go: (h: string) => void }) {
  const [p, setP] = useState<Program | null>(null);
  const [fields, setFields] = useState<ImportFieldSpec[]>([]);
  const [compound, setCompound] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [lab, setLab] = useState("");
  const [date, setDate] = useState("");
  const [glp, setGlp] = useState<"" | "true" | "false">("");
  const [labNo, setLabNo] = useState("");
  const [parts, setParts] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Program>(`/programs/${programId}`).then((prog) => {
      setP(prog);
      setCompound(prog.compounds[0]?.id ?? "");
      const req = prog.study_set.requirements.find((r) => r.id === requirementId);
      if (req) setGlp(req.glp ? "true" : "false");
    }).catch(setErr);
    api.get<ImportFieldSpec[]>(`/requirements/${requirementId}/import-fields`).then(setFields).catch(setErr);
  }, [programId, requirementId]);

  const req = p?.study_set.requirements.find((r) => r.id === requirementId);

  async function create() {
    if (!file) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({
        compound_id: compound,
        requirement_id: requirementId,
        filename: file.name,
        title,
        laboratory: lab,
        report_date: date,
        glp,
      });
      if (labNo) q.set("lab_study_number", labNo);
      if (parts.length) q.set("components", parts.join(","));
      const s = await api.upload<Study>(`/programs/${programId}/imports?${q.toString()}`, file);
      go(`#/study/${s.id}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  if (!p) return <ErrorBox error={err} />;
  return (
    <div className="page">
      <div className="crumbs">
        <a href="#/">Programmes</a> / <a href={`#/program/${p.id}`}>{p.name}</a> / import study
      </div>
      <h2>Import a study from its final report</h2>
      {req && (
        <p className="small">
          Requirement: <strong>{req.name}</strong> ({req.section}) · CTD {req.ctd_section ?? "—"} · {req.glp ? "GLP" : "non-GLP"}
        </p>
      )}
      <div className="note small">
        Use this for a study run outside HOS (at a CRO, before HOS, or of a type without a driver). The report is stored by
        its SHA-256. Every value you transcribe needs the page or table it came from, and the import is signed by the
        responsible people (Study Director and QA for a GLP study). Readiness counts it as <em>imported</em>, never as
        driver-run.
      </div>
      <ErrorBox error={err} />
      <Section title="Report">
        <div className="grid2">
          <div className="field">
            <label className="field-label">Compound *</label>
            <select value={compound} onChange={(e) => setCompound(e.target.value)}>
              {p.compounds.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Final report file *</label>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="field">
            <label className="field-label">Report title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Performing laboratory *</label>
            <input value={lab} onChange={(e) => setLab(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Report date *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Laboratory study number</label>
            <input value={labNo} onChange={(e) => setLabNo(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Conducted under GLP? *</label>
            <select value={glp} onChange={(e) => setGlp(e.target.value as "" | "true" | "false")}>
              <option value="">—</option>
              <option value="true">yes</option>
              <option value="false">no</option>
            </select>
          </div>
        </div>
        {req && req.components.length > 0 && (
          <div className="field">
            <label className="field-label">Parts of the requirement this report covers *</label>
            {req.components.map((c) => (
              <label key={c} className="small" style={{ marginRight: 12 }}>
                <input
                  type="checkbox"
                  checked={parts.includes(c)}
                  onChange={(e) => setParts((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))}
                />{" "}
                {c}
              </label>
            ))}
          </div>
        )}
        {fields.length > 0 && (
          <p className="small">
            You will transcribe: {fields.map((f) => f.label + (f.unit ? ` [${f.unit}]` : "")).join(", ")}.
          </p>
        )}
        <button
          className="primary"
          disabled={busy || !file || !compound || (!!req && req.components.length > 0 && parts.length === 0)}
          onClick={create}
        >
          Upload report and create import
        </button>
      </Section>
    </div>
  );
}
