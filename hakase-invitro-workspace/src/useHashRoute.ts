import { useEffect, useState } from "react";

/**
 * Minimal hash router — no dependency, real shareable URLs.
 *
 * Routes are of the form `#/science`. An empty or unrecognised hash resolves to
 * the landing route (`""`), so a bare domain and a stale link both land somewhere
 * sensible rather than on a blank page.
 */
export type Route = "" | "science" | "developers" | "cases";

const KNOWN: Route[] = ["", "science", "developers", "cases"];

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "").split(/[?#]/)[0].trim().toLowerCase();
  return (KNOWN as string[]).includes(raw) ? (raw as Route) : "";
}

export function useHashRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(() => (typeof window === "undefined" ? "" : parse()));

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (next: Route) => {
    if (next === "") {
      // Clear the hash without adding an empty history entry that traps the back button.
      history.pushState("", document.title, window.location.pathname + window.location.search);
      setRoute("");
    } else {
      window.location.hash = `/${next}`;
    }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  return [route, navigate];
}
