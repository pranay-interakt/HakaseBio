import { useEffect, useState } from "react";
import { api, setToken } from "../api";
import { ErrorBox } from "../components/common";
import type { Principal } from "../types";

export function Login({ onLogin }: { onLogin: (p: Principal) => void }) {
  const [initialised, setInitialised] = useState<boolean | null>(null);
  const [pid, setPid] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ initialised: boolean }>("/health")
      .then((h) => setInitialised(h.initialised))
      .catch(setErr);
  }, []);

  async function login() {
    try {
      const r = await api.post<{ token: string; principal: Principal }>("/auth/login", {
        principal_id: pid,
        password: pw,
      });
      setToken(r.token);
      onLogin(r.principal);
    } catch (e) {
      setErr(e);
    }
  }

  async function setup() {
    try {
      await api.post("/setup", { principal_id: pid, name, password: pw });
      await login();
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <div className="login">
      <h1>Hakase OS</h1>
      <p className="muted">Preclinical operating system: every number carries its provenance.</p>
      {initialised === false && (
        <p>First run: create the administrator account. Human signatures require a password of 12+ characters.</p>
      )}
      <div className="field">
        <label className="field-label">User id</label>
        <input value={pid} onChange={(e) => setPid(e.target.value)} autoComplete="username" />
      </div>
      {initialised === false && (
        <div className="field">
          <label className="field-label">Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      <div className="field">
        <label className="field-label">Password</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete={initialised === false ? "new-password" : "current-password"}
          onKeyDown={(e) => e.key === "Enter" && (initialised === false ? setup() : login())}
        />
      </div>
      <button className="primary" onClick={initialised === false ? setup : login}>
        {initialised === false ? "Create administrator" : "Sign in"}
      </button>
      <ErrorBox error={err} />
    </div>
  );
}
