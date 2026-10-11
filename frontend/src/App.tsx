import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import { Login } from "./pages/Login";
import { Program } from "./pages/Program";
import { ImportNew } from "./pages/ImportNew";
import { Programs } from "./pages/Programs";
import { Study } from "./pages/Study";
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
  const [ledger, setLedger] = useState<{ valid: boolean; entries: number } | null>(null);

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
        .then(setLedger)
        .catch(() => setLedger({ valid: false, entries: 0 }));
    verify();
    window.addEventListener("hos:changed", verify);
    return () => window.removeEventListener("hos:changed", verify);
  }, [me, hash]);

  const go = (h: string) => {
    window.location.hash = h;
  };

  if (!checked) return null;
  if (!me) return <Login onLogin={setMe} />;

  const parts = hash.replace(/^#\/?/, "").split("/");
  let page;
  if (parts[0] === "program" && parts[1]) page = <Program id={parts[1]} go={go} />;
  else if (parts[0] === "study" && parts[1]) page = <Study id={parts[1]} me={me} />;
  else if (parts[0] === "import" && parts[1] && parts[2]) page = <ImportNew programId={parts[1]} requirementId={parts[2]} go={go} />;
  else page = <Programs go={go} />;

  return (
    <>
      <header className="topbar">
        <a href="#/" className="brand">
          Hakase OS
        </a>
        <span className="muted small">preclinical operating system</span>
        <span className="spacer" />
        {ledger && (
          <span className={ledger.valid ? "ledger ok" : "ledger bad"} title="hash-chained audit ledger">
            ledger {ledger.valid ? `verified · ${ledger.entries} entries` : "INTEGRITY FAILURE"}
          </span>
        )}
        <span className="small">
          {me.name} ({me.roles.join(", ")})
        </span>
        <button
          onClick={async () => {
            await api.post("/auth/logout").catch(() => undefined);
            setToken(null);
            setMe(null);
          }}
        >
          Sign out
        </button>
      </header>
      <main>{page}</main>
    </>
  );
}
