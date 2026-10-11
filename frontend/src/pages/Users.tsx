// User administration (21 CFR 11.300; docs/15 P1.2). Every change carries a reason and is
// recorded; an organisation's administrator sees and manages that organisation only.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { ErrorBox, Section, roleLabel } from "../components/common";
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

interface UserRow extends Principal {
  active: boolean;
  locked: boolean;
  must_change_password: boolean;
  created_at: string;
}

export function Users({ me }: { me: Principal }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => api.get<UserRow[]>("/principals").then(setUsers).catch(setErr), []);
  useEffect(() => {
    load();
  }, [load]);
  async function act(fn: () => Promise<unknown>, done?: string) {
    setErr(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
      load();
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <div className="page">
      <h2>Users</h2>
      <p className="muted small">
        {me.organisation ? `Users of ${me.organisation}.` : "All users (platform administrator)."} Changes need a reason
        and are recorded in the audit trail. A deactivated user can neither sign in nor sign; their earlier signatures
        stay valid.
      </p>
      <ErrorBox error={err} />
      {note && <div className="note small">{note}</div>}
      <NewUser me={me} act={act} />
      {users.map((u) => (
        <UserCard key={u.id} u={u} me={me} act={act} />
      ))}
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<void>;

function NewUser({ me, act }: { me: Principal; act: Act }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("human");
  const [roles, setRoles] = useState<string[]>(["scientist"]);
  const [org, setOrg] = useState("");
  const [pw, setPw] = useState("");
  return (
    <Section title="Add a user or agent">
      <div className="grid2">
        <input placeholder="user id *" value={id} onChange={(e) => setId(e.target.value)} />
        <input placeholder="full name *" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="human">person</option>
          <option value="agent">agent (software)</option>
        </select>
        {me.organisation === null || me.organisation === undefined ? (
          <input placeholder="organisation (blank: default)" value={org} onChange={(e) => setOrg(e.target.value)} />
        ) : (
          <span className="small muted">organisation: {me.organisation}</span>
        )}
        {kind === "human" && (
          <input
            type="password"
            placeholder="initial password (12+ characters) *"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        )}
      </div>
      <RolePicker roles={roles} setRoles={setRoles} human={kind === "human"} />
      <button
        className="primary"
        disabled={!id.trim() || !name.trim() || (kind === "human" && pw.length < 12)}
        onClick={() =>
          act(
            () =>
              api.post("/principals", {
                principal_id: id,
                name,
                kind,
                roles,
                password: kind === "human" ? pw : null,
                organisation: org.trim() || null,
              }),
            `${id} added`,
          ).then(() => {
            setId("");
            setName("");
            setPw("");
          })
        }
      >
        Add
      </button>
    </Section>
  );
}

function RolePicker({ roles, setRoles, human }: { roles: string[]; setRoles: (r: string[]) => void; human: boolean }) {
  const attestor = ["study_director", "quality_assurance", "attending_veterinarian", "qualified_person"];
  return (
    <div className="checks">
      {ROLES.filter((r) => human || !attestor.includes(r)).map((r) => (
        <label key={r}>
          <input
            type="checkbox"
            checked={roles.includes(r)}
            onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))}
          />{" "}
          {roleLabel(r)}
        </label>
      ))}
    </div>
  );
}

function UserCard({ u, me, act }: { u: UserRow; me: Principal; act: Act }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [roles, setRoles] = useState<string[]>(u.roles);
  const [temp, setTemp] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const status = [
    !u.active && "deactivated",
    u.locked && "locked",
    u.must_change_password && "must change password",
  ].filter(Boolean);
  const r = { reason };
  return (
    <Section
      title={`${u.name} (${u.id})`}
      right={
        <span className="row">
          {status.map((s) => (
            <span key={String(s)} className="tag tag-warn">
              {s}
            </span>
          ))}
          <button onClick={() => setOpen(!open)}>{open ? "Close" : "Manage"}</button>
        </span>
      }
    >
      <div className="small">
        {u.kind === "agent" ? "agent" : "person"} · {u.organisation ?? "default organisation"} · {u.roles.map(roleLabel).join(", ")}
      </div>
      {open && (
        <>
          <input placeholder="reason for the change *" value={reason} onChange={(e) => setReason(e.target.value)} />
          <h4>Roles</h4>
          <RolePicker roles={roles} setRoles={setRoles} human={u.kind === "human"} />
          <div className="row">
            <button disabled={!reason.trim()} onClick={() => act(() => api.post(`/principals/${u.id}/roles`, { roles, reason }), "roles changed")}>
              Save roles
            </button>
            {u.active ? (
              <button disabled={!reason.trim() || u.id === me.id} onClick={() => act(() => api.post(`/principals/${u.id}/deactivate`, r), `${u.id} deactivated`)}>
                Deactivate
              </button>
            ) : (
              <button disabled={!reason.trim()} onClick={() => act(() => api.post(`/principals/${u.id}/reactivate`, r), `${u.id} reactivated`)}>
                Reactivate
              </button>
            )}
            {u.locked && (
              <button disabled={!reason.trim()} onClick={() => act(() => api.post(`/principals/${u.id}/unlock`, r), `${u.id} unlocked`)}>
                Unlock
              </button>
            )}
          </div>
          {u.kind === "human" ? (
            <div className="row" style={{ marginTop: 6 }}>
              <input
                type="password"
                placeholder="temporary password (12+), changed at next sign-in"
                value={temp}
                onChange={(e) => setTemp(e.target.value)}
                autoComplete="new-password"
              />
              <button
                disabled={!reason.trim() || temp.length < 12}
                onClick={() => act(() => api.post(`/principals/${u.id}/reset-password`, { new_password: temp, reason }), "temporary password set").then(() => setTemp(""))}
              >
                Reset password
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 6 }}>
              <button
                disabled={!u.active}
                onClick={() =>
                  act(async () => {
                    const r2 = await api.post<{ token: string }>(`/principals/${u.id}/agent-token`);
                    setKey(r2.token);
                  })
                }
              >
                Issue agent key
              </button>
              {key && (
                <div className="note small">
                  Shown once; store it in the agent's secret manager: <code>{key}</code>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Section>
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
      onDone();
    } catch (e) {
      setErr(e);
    }
  }
  return (
    <Section title="Change password">
      {forced && <p className="small">Your password was reset by an administrator. Choose a new one to continue.</p>}
      <div className="grid2">
        <input type="password" placeholder="current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <input type="password" placeholder="new password (12+ characters)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <input type="password" placeholder="new password again" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
      </div>
      {next && again && next !== again && <div className="qc-warn small">The new passwords differ.</div>}
      <button className="primary" disabled={!current || next.length < 12 || next !== again} onClick={save}>
        Change password
      </button>
      <ErrorBox error={err} />
    </Section>
  );
}
