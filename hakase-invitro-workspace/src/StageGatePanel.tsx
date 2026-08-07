import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BadgeCheck, LoaderCircle, PenLine, ShieldAlert, ShieldCheck } from "lucide-react";

const API_ROOT = import.meta.env.VITE_API_ROOT ?? "";

export type GateCondition = {
  code: string;
  severity: "block" | "warn";
  title: string;
  detail: string;
  acknowledgeable?: boolean;
  endpoints?: string[];
  verdict?: string;
  species?: string;
  applicability_domain?: string;
  l1_review_recorded?: boolean;
};

export type Signoff = {
  signoff_id?: string;
  name?: string;
  role?: string;
  justification?: string | null;
  acknowledged_codes?: string[];
  signed_at?: string;
  note?: string;
};

export type Gate = {
  analysis_id?: string;
  species?: string;
  blocks?: GateCondition[];
  warnings?: GateCondition[];
  counts?: { block?: number; warn?: number; acknowledged?: number };
  outstanding_warning_codes?: string[];
  signoff?: Signoff | null;
  clear_to_proceed?: boolean;
  policy?: { note?: string };
};

type Props = {
  analysisId: string;
  species: string;
  onCleared: (gate: Gate) => void;
  onContinue: () => void;
};

function formatSignedAt(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function StageGatePanel({ analysisId, species, onCleared, onContinue }: Props) {
  const [gate, setGate] = useState<Gate | null>(null);
  const [loading, setLoading] = useState(true);
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l3/gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_id: analysisId, species }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail;
        throw new Error(typeof detail === "string" ? detail : "The stage gate could not be evaluated.");
      }
      setGate(payload as Gate);
      const existing = (payload as Gate).signoff?.acknowledged_codes ?? [];
      if (existing.length) {
        setAcked(Object.fromEntries(existing.map((code) => [code, true])));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The stage gate could not be evaluated.");
    } finally {
      setLoading(false);
    }
  }, [analysisId, species]);

  useEffect(() => { void loadGate(); }, [loadGate]);

  const blocks = gate?.blocks ?? [];
  const warnings = gate?.warnings ?? [];
  const signoff = gate?.signoff ?? null;
  const sealed = Boolean(gate?.clear_to_proceed && signoff);

  const allAcked = useMemo(
    () => warnings.every((w) => acked[w.code]),
    [warnings, acked],
  );
  const ackCount = warnings.filter((w) => acked[w.code]).length;
  const canSign = !blocks.length && allAcked && name.trim().length > 0 && role.trim().length > 0;

  useEffect(() => { if (sealed && gate) onCleared(gate); }, [sealed, gate, onCleared]);

  async function submitSignoff() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${API_ROOT}/api/ai/l3/signoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis_id: analysisId,
          species,
          name: name.trim(),
          role: role.trim(),
          justification: justification.trim() || null,
          acknowledged_codes: warnings.filter((w) => acked[w.code]).map((w) => w.code),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.detail;
        throw new Error(typeof detail === "string" ? detail : "The sign-off was not accepted.");
      }
      setGate(payload.gate as Gate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sign-off was not accepted.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="gate-panel">
        <div className="gate-loading"><LoaderCircle size={20} className="spin" /> Evaluating the Layer 2 → Layer 3 stage gate…</div>
      </section>
    );
  }

  return (
    <section className="gate-panel">
      <header className="gate-head">
        <div className="gate-head-title">
          <ShieldCheck size={19} />
          <div>
            <b>Stage gate review — Layer 2 → Layer 3</b>
            <span>Accumulated in-vitro, confirmation and exposure evidence, checked before an animal study may be designed.</span>
          </div>
        </div>
        <div className="gate-head-counts">
          <span className={blocks.length ? "gate-chip gate-chip-block" : "gate-chip gate-chip-ok"}>
            {blocks.length} block{blocks.length === 1 ? "" : "s"}
          </span>
          <span className={warnings.length ? "gate-chip gate-chip-warn" : "gate-chip gate-chip-ok"}>
            {warnings.length} warn
          </span>
        </div>
      </header>

      {error && <div className="gate-error"><AlertTriangle size={17} /><span>{error}</span></div>}

      {!blocks.length && !warnings.length && (
        <div className="gate-clean"><BadgeCheck size={18} /><span>No blocks or warnings. The accumulated evidence supports progressing to the animal cohort layer.</span></div>
      )}

      <div className="gate-conditions">
        {blocks.map((condition) => (
          <article key={condition.code} className="gate-condition gate-condition-block">
            <div className="gate-condition-head">
              <ShieldAlert size={17} />
              <span className="gate-sev gate-sev-block">BLOCK</span>
              <b>{condition.title}</b>
            </div>
            <p>{condition.detail}</p>
            {condition.endpoints?.length ? (
              <div className="gate-endpoints">{condition.endpoints.map((e) => <code key={e}>{e}</code>)}</div>
            ) : null}
            <div className="gate-condition-foot gate-not-overridable">
              This cannot be signed away. The underlying evidence has to change.
            </div>
          </article>
        ))}

        {warnings.map((condition) => (
          <article key={condition.code} className={`gate-condition gate-condition-warn ${acked[condition.code] ? "is-acked" : ""}`}>
            <div className="gate-condition-head">
              <AlertTriangle size={17} />
              <span className="gate-sev gate-sev-warn">WARN</span>
              <b>{condition.title}</b>
            </div>
            <p>{condition.detail}</p>
            {condition.endpoints?.length ? (
              <div className="gate-endpoints">{condition.endpoints.map((e) => <code key={e}>{e}</code>)}</div>
            ) : null}
            <label className="gate-ack">
              <input
                type="checkbox"
                disabled={sealed}
                checked={Boolean(acked[condition.code])}
                onChange={(event) => setAcked((prev) => ({ ...prev, [condition.code]: event.target.checked }))}
              />
              <span>Acknowledge — proceed despite this warning.</span>
            </label>
          </article>
        ))}
      </div>

      {sealed && signoff ? (
        <div className="gate-sealed">
          <div className="gate-sealed-mark"><BadgeCheck size={22} /></div>
          <div className="gate-sealed-body">
            <b>Stage gate sealed</b>
            <p>
              Signed by <strong>{signoff.name}</strong>{signoff.role ? ` · ${signoff.role}` : ""}
              {signoff.signed_at ? ` · ${formatSignedAt(signoff.signed_at)}` : ""}
            </p>
            {signoff.justification && <blockquote>{signoff.justification}</blockquote>}
            <small>{signoff.acknowledged_codes?.length ?? 0} warning{(signoff.acknowledged_codes?.length ?? 0) === 1 ? "" : "s"} acknowledged. This signature records accepted residual risk; it does not alter any model output.</small>
          </div>
        </div>
      ) : (
        <div className="gate-signature">
          <div className="gate-signature-head"><PenLine size={17} /><b>Reviewer sign-off</b></div>
          <div className="gate-signature-grid">
            <label>
              Name <i>*</i>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dr. Sarah Lin" disabled={Boolean(blocks.length)} />
            </label>
            <label>
              Role <i>*</i>
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Head of DMPK / Sponsor PI" disabled={Boolean(blocks.length)} />
            </label>
          </div>
          <label className="gate-justification">
            Justification <small>(recommended when warnings are acknowledged)</small>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Rationale for sign-off given the above evidence…"
              disabled={Boolean(blocks.length)}
            />
          </label>

          <ul className="gate-checklist">
            <li className={blocks.length ? "bad" : "good"}>
              {blocks.length ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
              Hard blocks: {blocks.length ? `${blocks.length} unresolved` : "none"}
            </li>
            <li className={allAcked ? "good" : "warn"}>
              <AlertTriangle size={14} />
              Soft warnings: {ackCount}/{warnings.length} acknowledged
            </li>
            <li className={name.trim() && role.trim() ? "good" : "warn"}>
              <PenLine size={14} />
              Sign-off: name + role required
            </li>
          </ul>

          <button className="gate-sign-button" onClick={submitSignoff} disabled={!canSign || submitting}>
            {submitting ? <LoaderCircle size={16} className="spin" /> : <PenLine size={16} />}
            {submitting ? "Recording sign-off…" : "Sign and seal the stage gate"}
          </button>
        </div>
      )}

      <div className="gate-continue">
        <div>
          <b>Continue to Animal Cohort</b>
          <span>
            {sealed
              ? "The sealed dossier — in-vitro evidence, confirmation, exposure projection and this signature — carries forward to the animal cohort layer."
              : "Seal the stage gate to carry the in-vitro, confirmation and exposure evidence into the animal cohort layer."}
          </span>
        </div>
        <button className="gate-continue-button" onClick={onContinue} disabled={!sealed}>
          Continue to Animal Cohort <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}
