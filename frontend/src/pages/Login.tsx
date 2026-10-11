import { useEffect, useState } from "react";
import { ApiError, api, setToken } from "../api";
import { ErrorBox, Logo } from "../components/common";
import type { Principal } from "../types";

export function Login({ onLogin }: { onLogin: (p: Principal) => void }) {
  const [initialised, setInitialised] = useState<boolean | null>(null);
  const [pid, setPid] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [setupToken, setSetupToken] = useState("");
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
      // one message for every refused sign-in, so the page never hints whether a user id exists
      setErr(e instanceof ApiError && (e.status === 401 || e.status === 403)
        ? new Error("Sign-in failed. Check your user id and password.")
        : e);
    }
  }

  async function setup() {
    try {
      await api.post("/setup", { principal_id: pid, name, password: pw, setup_token: setupToken });
      await login();
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <div className="login">
      <div className="login-logo">
        <Logo height={44} />
      </div>
      <p className="muted">Preclinical development: every number carries its provenance.</p>
      {initialised === false && (
        <p>First run: create the administrator account. Human signatures require a password of 12+ characters.</p>
      )}
      <div className="field">
        <label className="field-label">User id</label>
        <input value={pid} onChange={(e) => setPid(e.target.value)} autoComplete="username" />
      </div>
      {initialised === false && (
        <>
          <div className="field">
            <label className="field-label">Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Setup token</label>
            <input value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" />
            <span className="muted small">Printed in the server log when it first starts, or set as HOS_BOOTSTRAP_TOKEN.</span>
          </div>
        </>
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
