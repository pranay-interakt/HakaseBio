// A subject's audit trail (study, programme, compound), newest first. Each entry is shown as
// recorded; the actor's name is looked up when the trail is read.
//
// A failed read is never shown as an empty trail. This is the screen a reviewer opens to
// check that a record is attributable, so "no entries" has to mean the record has none —
// not that the request did not arrive.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { actionLabel, fmtDateTime, shortHash } from "../lib/format";
import type { LedgerEntry } from "../types";
import { ErrorBox } from "./common";
import { Collapsible, Loading } from "./ui";

export function AuditTrail({
  id,
  open = false,
  title = "Audit trail",
}: {
  id: string;
  open?: boolean;
  title?: string;
}) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => {
    setErr(null);
    setEntries(null);
    api
      .getAll<LedgerEntry>(`/ledger/${id}`)
      .then(setEntries)
      .catch((e) => setErr(e));
  }, [id]);
  useEffect(load, [load]);

  const count = entries ? ` (${entries.length})` : "";
  return (
    <Collapsible id="sec-audit" title={`${title}${err ? "" : count}`} defaultOpen={open}>
      {err ? (
        <>
          <ErrorBox error={err} />
          <div className="muted small">
            The audit trail could not be read, so it is not shown. This is not a statement that the record has no
            history.{" "}
            <button className="ghost small" onClick={load}>
              Try again
            </button>
          </div>
        </>
      ) : entries === null ? (
        <Loading />
      ) : entries.length === 0 ? (
        <div className="muted small">No entries.</div>
      ) : (
        <ol className="timeline">
          {[...entries].reverse().map((e) => (
            <li key={e.seq}>
              <span className="when">{fmtDateTime(e.recorded_at)}</span>
              <span>
                <span className="what">{actionLabel(e.action)}</span>{" "}
                <span className="who" title={e.actor_id}>
                  by {e.actor_name ?? e.actor_id}
                </span>
                {e.reason && <div className="small">Reason: {e.reason}</div>}
              </span>
              <span className="hash mono" title={`entry #${e.seq}, hash ${e.entry_hash}`}>
                #{e.seq} · {shortHash(e.entry_hash, 10)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Collapsible>
  );
}
