// User administration (21 CFR 11.300; docs/15 P1.2). Every change carries a reason and is
// recorded; an organisation's administrator sees and manages that organisation only.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ErrorBox, roleLabel, Section } from "../components/common";
import { Collapsible, Loading, PageHeader, Pill, toast, useBreadcrumbs } from "../components/ui";
import { fmtDate, fmtDateTime } from "../lib/format";
import type { Principal } from "../types";

const ROLES = [
  "scientist",
  "responsible_scientist",
  "study_director",
  "quality_assurance",
  "attending_veterinarian",
  "qualified_person",
  "program_lead",
  "admin",
];
const ATTESTORS = ["study_director", "quality_assurance", "attending_veterinarian", "qualified_person"];

interface UserRow extends Principal {
  active: boolean;
  locked: boolean;
  must_change_password: boolean;
  created_at: string;
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;

export function Users({ me }: { me: Principal }) {
  useBreadcrumbs([{ label: "Users" }]);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const load = useCallback(() => api.get<UserRow[]>("/principals").then(setUsers).catch(setErr), []);
  useEffect(() => {
    load();
  }, [load]);
  const act: Act = async (fn, done) => {
    setErr(null);
    try {
      await fn();
      if (done) toast(done);
      load();
      return true;
    } catch (e) {
      setErr(e);
      return false;
    }
  };
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (users ?? []).filter(
      (u) => !n || `${u.name} ${u.id} ${u.organisation ?? ""} ${u.roles.join(" ")}`.toLowerCase().includes(n),
    );
  }, [users, q]);
  return (
    <div className="page">
      <PageHeader
        title="Users"
        meta={
          me.organisation
            ? `People and agents of ${me.organisation}. Every change needs a reason and is recorded.`
            : "All users (platform administrator). Every change needs a reason and is recorded."
        }
      />
      <ErrorBox error={err} onDismiss={() => setErr(null)} />
      <NewUser me={me} act={act} />
      <section className="card">
        <div className="card-head">
          <input
            style={{ maxWidth: 320 }}
            placeholder="Search users"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search users"
          />
          <span className="muted small">
            A deactivated user can neither sign in nor sign; their earlier signatures stay valid.
          </span>
        </div>
        {users === null && !err ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Kind</th>
                  <th>Organisation</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <Fragment key={u.id}>
                    <tr>
                      <td>
                        <strong>{u.name}</strong>
                        <div className="muted small mono">{u.id}</div>
                      </td>
                      <td>{u.kind === "agent" ? "Agent" : "Person"}</td>
                      <td>{u.organisation ?? <span className="muted">default</span>}</td>
                      <td className="small">{u.roles.map(roleLabel).join(", ")}</td>
                      <td>
                        <span className="tag-group">
                          {!u.active ? (
                            <Pill tone="bad">Deactivated</Pill>
                          ) : u.locked ? (
                            <Pill tone="warn">Locked</Pill>
                          ) : (
                            <Pill tone="ok">Active</Pill>
                          )}
                          {u.must_change_password && <Pill tone="warn">Must change password</Pill>}
                        </span>
                      </td>
                      <td>
                        <button className="small" onClick={() => setOpen(open === u.id ? null : u.id)}>
                          {open === u.id ? "Close" : "Manage"}
                        </button>
                      </td>
                    </tr>
                    {open === u.id && (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--panel-2)" }}>
                          <ManageUser u={u} me={me} act={act} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function RolePicker({ roles, setRoles, human }: { roles: string[]; setRoles: (r: string[]) => void; human: boolean }) {
  return (
    <div className="checks">
      {ROLES.filter((r) => human || !ATTESTORS.includes(r)).map((r) => (
        <label key={r}>
          <input
            type="checkbox"
            checked={roles.includes(r)}
            onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))}
          />
          {roleLabel(r)}
        </label>
      ))}
    </div>
  );
}

function NewUser({ me, act }: { me: Principal; act: Act }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("human");
  const [roles, setRoles] = useState<string[]>(["scientist"]);
  const [org, setOrg] = useState("");
  const [pw, setPw] = useState("");
  const platform = me.organisation === null || me.organisation === undefined;
  async function add() {
    const ok = await act(
      () =>
        api.post("/principals", {
          principal_id: id,
          name,
          kind,
          roles,
          password: kind === "human" ? pw : null,
          organisation: org.trim() || null,
        }),
      `${name} added`,
    );
    if (ok) {
      setId("");
      setName("");
      setPw("");
    }
  }
  return (
    <Collapsible title="Add a person or agent" defaultOpen={false}>
      <div className="grid3">
        <label className="field">
          <span className="field-label">User id *</span>
          <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          <span className="field-label">Full name *</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="human">Person</option>
            <option value="agent">Agent (software)</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Organisation</span>
          {platform ? (
            <input placeholder="blank: default" value={org} onChange={(e) => setOrg(e.target.value)} />
          ) : (
            <input value={me.organisation ?? ""} disabled />
          )}
        </label>
        {kind === "human" && (
          <label className="field">
            <span className="field-label">Initial password (12+ characters) *</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </label>
        )}
      </div>
      <div className="field-label" style={{ marginTop: 8 }}>
        Roles
      </div>
      <RolePicker roles={roles} setRoles={setRoles} human={kind === "human"} />
      {kind !== "human" && (
        <div className="muted small">
          Signature roles (Study Director, QA, Attending Veterinarian, QP) can only be held by people.
        </div>
      )}
      <div className="row-end">
        <button
          className="primary"
          disabled={!id.trim() || !name.trim() || (kind === "human" && pw.length < 12)}
          onClick={add}
        >
          Add
        </button>
      </div>
    </Collapsible>
  );
}

function ManageUser({ u, me, act }: { u: UserRow; me: Principal; act: Act }) {
  const [reason, setReason] = useState("");
  const [roles, setRoles] = useState<string[]>(u.roles);
  const [temp, setTemp] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const r = { reason };
  const self = u.id === me.id;
  return (
    <div className="stack" style={{ padding: "6px 4px" }}>
      <div className="muted small">
        Added {fmtDate(u.created_at)} · created {fmtDateTime(u.created_at)}
      </div>
      <label className="field" style={{ maxWidth: 520 }}>
        <span className="field-label">Reason for the change *</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div>
        <div className="field-label">Roles</div>
        <RolePicker roles={roles} setRoles={setRoles} human={u.kind === "human"} />
      </div>
      <div className="row">
        <button
          disabled={!reason.trim()}
          onClick={() => act(() => api.post(`/principals/${u.id}/roles`, { roles, reason }), "Roles changed")}
        >
          Save roles
        </button>
        {u.active ? (
          <button
            className="danger"
            disabled={!reason.trim() || self}
            title={self ? "You cannot deactivate yourself" : ""}
            onClick={() => act(() => api.post(`/principals/${u.id}/deactivate`, r), `${u.name} deactivated`)}
          >
            Deactivate
          </button>
        ) : (
          <button
            disabled={!reason.trim()}
            onClick={() => act(() => api.post(`/principals/${u.id}/reactivate`, r), `${u.name} reactivated`)}
          >
            Reactivate
          </button>
        )}
        {u.locked && (
          <button
            disabled={!reason.trim()}
            onClick={() => act(() => api.post(`/principals/${u.id}/unlock`, r), `${u.name} unlocked`)}
          >
            Unlock
          </button>
        )}
      </div>
      {u.kind === "human" ? (
        <div className="row">
          <input
            style={{ maxWidth: 320 }}
            type="password"
            placeholder="Temporary password (12+ characters)"
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
            autoComplete="new-password"
          />
          <button
            disabled={!reason.trim() || temp.length < 12}
            onClick={() =>
              act(
                () => api.post(`/principals/${u.id}/reset-password`, { new_password: temp, reason }),
                "Temporary password set; it must be changed at next sign-in",
              ).then((ok) => ok && setTemp(""))
            }
          >
            Reset password
          </button>
        </div>
      ) : (
        <div>
          <button
            disabled={!u.active}
            onClick={() =>
              act(async () => {
                const r2 = await api.post<{ token: string }>(`/principals/${u.id}/agent-token`);
                setKey(r2.token);
              }, "Agent key issued")
            }
          >
            Issue agent key
          </button>
          {key && (
            <div className="note small" style={{ marginTop: 6 }}>
              Shown once; store it in the agent&apos;s secret manager: <code>{key}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Change one's own password; also the forced change after an administrator's reset. */
export function ChangePassword({ forced, onDone }: { forced: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState<unknown>(null);
  async function save() {
    try {
      await api.post("/auth/password", { current_password: current, new_password: next });
      toast("Password changed");
      setCurrent("");
      setNext("");
      setAgain("");
      setErr(null);
      onDone();
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <Section
      title="Change password"
      subtitle={forced ? "Your password was reset by an administrator. Choose a new one to continue." : undefined}
    >
      <div className="stack" style={{ maxWidth: 420 }}>
        <label className="field">
          <span className="field-label">Current password</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className="field">
          <span className="field-label">New password (12+ characters)</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="field">
          <span className="field-label">New password again</span>
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
        </label>
        {next && again && next !== again && <div className="qc-warn small">The new passwords differ.</div>}
        <ErrorBox error={err} onDismiss={() => setErr(null)} />
        <div>
          <button className="primary" disabled={!current || next.length < 12 || next !== again} onClick={save}>
            Change password
          </button>
        </div>
      </div>
    </Section>
  );
}
