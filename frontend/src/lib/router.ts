// Hash routing with back/forward awareness. Every view that matters has its own URL, so the
// browser's history, the arrow buttons and shared links all land on the same place.
import { useEffect, useState } from "react";

export type Route =
  | { name: "programs" }
  | { name: "new-program" }
  | { name: "program"; id: string; tab: string | null }
  | { name: "study"; id: string; tab: string | null }
  | { name: "import"; programId: string; requirementId: string }
  | { name: "users" }
  | { name: "settings" };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "programs" && parts[1] === "new") return { name: "new-program" };
  if (parts[0] === "program" && parts[1]) return { name: "program", id: parts[1], tab: parts[2] ?? null };
  if (parts[0] === "study" && parts[1]) return { name: "study", id: parts[1], tab: parts[2] ?? null };
  if (parts[0] === "import" && parts[1] && parts[2])
    return { name: "import", programId: parts[1], requirementId: parts[2] };
  if (parts[0] === "users") return { name: "users" };
  // #/password is the older address of the password form, now part of Settings
  if (parts[0] === "settings" || parts[0] === "password") return { name: "settings" };
  return { name: "programs" };
}

export const href = {
  programs: () => "#/",
  newProgram: () => "#/programs/new",
  program: (id: string, tab?: string) => `#/program/${encodeURIComponent(id)}${tab ? `/${tab}` : ""}`,
  study: (id: string, tab?: string) => `#/study/${encodeURIComponent(id)}${tab ? `/${tab}` : ""}`,
  importReport: (programId: string, requirementId: string) =>
    `#/import/${encodeURIComponent(programId)}/${encodeURIComponent(requirementId)}`,
  users: () => "#/users",
  settings: () => "#/settings",
};

export function go(hash: string): void {
  window.location.hash = hash;
}

// Position in this tab's history, kept in history.state so it survives reloads: back is
// possible above position 0, forward below the furthest position reached.
const MAX_KEY = "hos.nav.max";
function readMax(): number {
  try {
    return Number(sessionStorage.getItem(MAX_KEY) ?? 0);
  } catch {
    return 0;
  }
}
function writeMax(n: number): void {
  try {
    sessionStorage.setItem(MAX_KEY, String(n));
  } catch {
    /* private mode: forward stays available */
  }
}

let index = 0;
let max = 0;
function initHistory(): void {
  const st = window.history.state as { hosIdx?: number } | null;
  if (st?.hosIdx === undefined) {
    window.history.replaceState({ ...(st ?? {}), hosIdx: 0 }, "");
    index = 0;
    max = 0;
  } else {
    index = st.hosIdx;
    max = Math.max(readMax(), index);
  }
  writeMax(max);
}
function onHashChange(): void {
  const st = window.history.state as { hosIdx?: number } | null;
  if (st?.hosIdx === undefined) {
    // a new entry: anything that was ahead of us is gone
    index += 1;
    max = index;
    window.history.replaceState({ ...(st ?? {}), hosIdx: index }, "");
  } else {
    index = st.hosIdx;
  }
  writeMax(max);
}

let started = false;
export function useRoute(): { route: Route; hash: string; canBack: boolean; canForward: boolean } {
  if (!started) {
    started = true;
    initHistory();
    window.addEventListener("hashchange", onHashChange);
  }
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return { route: parse(hash), hash, canBack: index > 0, canForward: index < max };
}
