import { useEffect, useState } from "react";
import { ApiError, UNAUTHORIZED_EVENT, api, getToken, setToken } from "./api";
import { Logo, roleLabel } from "./components/common";
import { Login } from "./pages/Login";
import { Program } from "./pages/Program";
import { ImportNew } from "./pages/ImportNew";
import { Programs } from "./pages/Programs";
import { Study } from "./pages/Study";
import { ChangePassword, Users } from "./pages/Users";
import type { Principal } from "./types";

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [me, setMe] = useState<Principal | null>(null);
  const [checked, setChecked] = useState(false);
  // "failed" only when the server reports a broken hash chain; any other error is "unavailable"
  const [ledger, setLedger] = useState<{ status: "verified" | "failed" | "unavailable"; entries: number } | null>(
    null,
  );

  useEffect(() => {
    const signedOut = () => {
      setMe(null);
      setLedger(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, signedOut);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signedOut);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setChecked(true);
      return;
    }
    api
      .get<Principal>("/me")
      .then(setMe)
      .catch(() => setToken(null))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!me) return;
    const verify = () =>
      api
        .get<{ valid: boolean; entries: number }>("/ledger/verify")
        .then((r) => setLedger({ status: r.valid ? "verified" : "failed", entries: r.entries }))
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 401) return;
          const failed = e instanceof ApiError && e.kind === "LedgerIntegrityError";
          setLedger({ status: failed ? "failed" : "unavailable", entries: 0 });
        });
    verify();
    window.addEventListener("hos:changed", verify);
    return () => window.removeEventListener("hos:changed", verify);
  }, [me, hash]);

  const go = (h: string) => {
    window.location.hash = h;
  };

  if (!checked) return null;
  if (!me) return <Login onLogin={setMe} />;
  const signOut = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setToken(null);
    setMe(null);
  };
  if (me.must_change_password)
    return (
      <main className="login">
        <ChangePassword forced onDone={() => setMe({ ...me, must_change_password: false })} />
        <button onClick={signOut}>Sign out</button>
      </main>
    );

  const parts = hash.replace(/^#\/?/, "").split("/");
  let page;
  if (parts[0] === "program" && parts[1]) page = <Program id={parts[1]} go={go} me={me} />;
  else if (parts[0] === "study" && parts[1]) page = <Study id={parts[1]} me={me} />;
  else if (parts[0] === "import" && parts[1] && parts[2]) page = <ImportNew programId={parts[1]} requirementId={parts[2]} go={go} />;
  else if (parts[0] === "users" && me.roles.includes("admin")) page = <Users me={me} />;
  else if (parts[0] === "password") page = <div className="page"><ChangePassword forced={false} onDone={() => go("#/")} /></div>;
  else page = <Programs go={go} />;

  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand" aria-label="Hakase AI home">
          <Logo height={26} />
        </a>
        <span className="spacer" />
        {ledger && (
          <span
            className={ledger.status === "verified" ? "ledger ok" : ledger.status === "failed" ? "ledger bad" : "ledger"}
            title="hash-chained audit ledger"
          >
            ledger{" "}
            {ledger.status === "verified"
              ? `verified · ${ledger.entries} entries`
              : ledger.status === "failed"
                ? "INTEGRITY FAILURE"
                : "verification unavailable"}
          </span>
        )}
        {me.roles.includes("admin") && (
          <a href="#/users" className="small">
            Users
          </a>
        )}
        <a href="#/password" className="small" title="Change password">
          {me.name}
        </a>
        <span className="small muted">({me.roles.map(roleLabel).join(", ")})</span>
        <button onClick={signOut}>Sign out</button>
      </header>
      <main>{page}</main>
    </>
  );
}
