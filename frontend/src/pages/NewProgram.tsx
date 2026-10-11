import { useState } from "react";
import { api } from "../api";
import { ErrorBox, Section } from "../components/common";
import { cleanContext, ContextForm, emptyContext, type Ctx } from "../components/ContextForm";
import { PageHeader, toast, useBreadcrumbs } from "../components/ui";
import { go, href } from "../lib/router";
import type { Program } from "../types";

export function NewProgram() {
  useBreadcrumbs([{ label: "Programmes", href: href.programs() }, { label: "New programme" }]);
  const [name, setName] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [ctx, setCtx] = useState<Ctx>(emptyContext());
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ready = name.trim() && ctx.intended_clinical_duration_days && ctx.max_trial_duration_days;

  async function create() {
    setBusy(true);
    try {
      const p = await api.post<Program>("/programs", { name, sponsor: sponsor || null, context: cleanContext(ctx) });
      toast(`Programme “${p.name}” created; its study set is derived`);
      go(href.program(p.id));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="New programme"
        meta="The programme's facts derive its nonclinical study set from ICH M3(R2), S6(R1), S9 and related guidelines."
      />
      <Section title="Programme">
        <div className="grid2">
          <label className="field">
            <span className="field-label">Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HK-101" autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Sponsor</span>
            <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} />
          </label>
        </div>
      </Section>
      <Section
        title="Clinical facts"
        subtitle="Leave a fact unknown if it is: the requirements it affects are shown as conditional rather than guessed."
      >
        <ContextForm value={ctx} onChange={setCtx} />
      </Section>
      <ErrorBox error={err} onDismiss={() => setErr(null)} />
      <div className="row-end">
        <a className="btn" href={href.programs()}>
          Cancel
        </a>
        <button className="primary" disabled={!ready || busy} onClick={create}>
          {busy ? "Creating…" : "Create programme and derive study set"}
        </button>
      </div>
    </div>
  );
}
