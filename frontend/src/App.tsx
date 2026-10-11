import { useCallback, useEffect, useState } from "react";
import { ApiError, UNAUTHORIZED_EVENT, api, getToken, setToken } from "./api";
import { Logo, roleLabel } from "./components/common";
import { Breadcrumbs, CrumbProvider, Menu, NavArrows, Toaster, type Crumb } from "./components/ui";
import { href, useRoute, type Route } from "./lib/router";
import { ImportNew } from "./pages/ImportNew";
import { Login } from "./pages/Login";
import { NewProgram } from "./pages/NewProgram";
import { Program } from "./pages/Program";
import { Programs } from "./pages/Programs";
import { Study } from "./pages/Study";
import { ChangePassword, Users } from "./pages/Users";
import type { Principal } from "./types";

/** Breadcrumbs shown until the page names its own place (e.g. while it loads). */
function defaultCrumbs(r: Route): Crumb[] {
  const home = { label: "Programmes", href: href.programs() };
  switch (r.name) {
    case "new-program":
      return [home, { label: "New programme" }];
    case "program":
      return [home, { label: "Programme" }];
    case "study":
      return [home, { label: "Study" }];
    case "import":
      return [home, { label: "Import a report" }];
    case "users":
      return [{ label: "Users" }];
    case "password":
      return [{ label: "Change password" }];
    default:
      return [{ label: "Programmes" }];
  }
}

export function App() {
  const { route, hash, canBack, canForward } = useRoute();
  const [me, setMe] = useState<Principal | null>(null);
  const [checked, setChecked] = useState(false);
  const [crumbs, setCrumbs] = useState<{ hash: string; crumbs: Crumb[] } | null>(null);
  // "failed" only when the server reports a broken hash chain; any other error is "unavailable"
  const [ledger, setLedger] = useState<{ status: "verified" | "failed" | "unavailable"; entries: number } | null>(null);
  const setPageCrumbs = useCallback((c: { hash: string; crumbs: Crumb[] }) => setCrumbs(c), []);

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

  // a new page starts at the top
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.name, route.name === "program" || route.name === "study" ? route.id : null]);

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

  let page;
  switch (route.name) {
    case "new-program":
      page = <NewProgram />;
      break;
    case "program":
      page = <Program id={route.id} tab={route.tab} me={me} />;
      break;
    case "study":
      page = <Study id={route.id} me={me} />;
      break;
    case "import":
      page = <ImportNew programId={route.programId} requirementId={route.requirementId} />;
      break;
    case "users":
      page = me.roles.includes("admin") ? <Users me={me} /> : <Programs />;
      break;
    case "password":
      page = (
        <div className="page">
          <ChangePassword forced={false} onDone={() => window.history.back()} />
        </div>
      );
      break;
    default:
      page = <Programs />;
  }
  const shown = crumbs && crumbs.hash === (window.location.hash || "#/") ? crumbs.crumbs : defaultCrumbs(route);

  return (
    <CrumbProvider set={setPageCrumbs}>
      <header className="topbar">
        <a href={href.programs()} className="brand" aria-label="Hakase AI home">
          <Logo height={24} />
        </a>
        <NavArrows canBack={canBack} canForward={canForward} />
        <Breadcrumbs crumbs={shown} />
        {ledger && (
          <span
            className={
              ledger.status === "verified" ? "ledger ok" : ledger.status === "failed" ? "ledger bad" : "ledger"
            }
            title="Every change is recorded in a hash-chained audit trail, checked against the stored records"
          >
            {ledger.status === "verified"
              ? `Audit trail verified · ${ledger.entries.toLocaleString()} entries`
              : ledger.status === "failed"
                ? "AUDIT TRAIL INTEGRITY FAILURE"
                : "Audit trail check unavailable"}
          </span>
        )}
        <Menu label={<span className="hide-narrow">{me.name}</span>}>
          <div className="menu-head">
            <div className="who">{me.name}</div>
            <div className="muted small">{me.roles.map(roleLabel).join(", ")}</div>
            {me.organisation && <div className="muted small">{me.organisation}</div>}
          </div>
          {me.roles.includes("admin") && <a href={href.users()}>Users</a>}
          <a href={href.password()}>Change password</a>
          <button onClick={signOut}>Sign out</button>
        </Menu>
      </header>
      <main>{page}</main>
      <Toaster />
    </CrumbProvider>
  );
}
