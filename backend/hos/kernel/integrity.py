"""Integrity beyond the hash chain (docs/15 P0.2).

``Ledger.verify`` proves the chain is internally consistent. It cannot see a database row edited
directly, or a chain rewritten in full by someone with write access to the database. Two checks
close that:

* **Reconcile.** Every stored record must agree with the ledger events that created or last
  changed it. Principals match their registration; programme study sets match the hash of
  their last programme event; programme guests replay from their membership events; compounds
  match their registration; each study's state follows from its last state event; protocol,
  data, analysis and report match the hashes their events recorded and recompute from the
  stored content; every signature and determination appears in its own event; artefacts
  recompute to their stored hashes.
* **Anchor.** After each write, a checkpoint (sequence, head hash, time) is appended to a log
  kept outside the database: by default next to the file store, in production a write-once
  location (``HOS_ANCHOR_DIR``). With ``HOS_ANCHOR_KEY`` set, each checkpoint carries an HMAC.
  A chain that no longer passes through a checkpoint, or is shorter than one, was rewritten.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from hos.core.provenance import utc_now
from hos.db.repository import content_hash
from hos.drivers.base import canonical_hash
from hos.kernel.ledger import Ledger, LedgerEntry

__all__ = ["AnchorLog", "Finding", "reconcile"]

#: The study state each ledger action leaves behind.
STATE_EVENTS = {
    "study.created": "proposed", "study.designed": "designed", "study.planned": "planned",
    "study.dispatched": "dispatched", "data.received": "data_received",
    "study.analyzed": "analyzed", "study.reported": "reported", "study.approved": "approved",
    "study.cancelled": "cancelled", "study.failed": "failed",
    "import.created": "import_draft", "import.completed": "imported",
    "import.superseded": "superseded",
}
_SIGNATURE_EVENTS = ("study.signed", "study.protocol_signed", "import.signed")


@dataclass(frozen=True, slots=True)
class Finding:
    subject: str
    check: str
    detail: str

    def to_dict(self) -> dict[str, str]:
        return {"subject": self.subject, "check": self.check, "detail": self.detail}


def _last(events: list[LedgerEntry], *actions: str) -> LedgerEntry | None:
    found = [e for e in events if e.action in actions]
    return found[-1] if found else None


def reconcile(kernel: Any) -> list[Finding]:
    """Every disagreement between stored state and the ledger; empty when they agree."""
    repo = kernel.repo
    by_subject: dict[str, list[LedgerEntry]] = defaultdict(list)
    for e in kernel.ledger.entries():
        by_subject[e.subject_id].append(e)
    out: list[Finding] = []

    def bad(subject: str, check: str, detail: str) -> None:
        out.append(Finding(subject, check, detail))

    for p in repo.principals():
        events = by_subject[p.id]
        ev = _last(events, "principal.registered")
        if ev is None:
            bad(p.id, "principal has its registration event", "no principal.registered")
            continue
        expected = dict(ev.payload.get("principal") or {})
        active = True
        for e in events:                       # replay the lifecycle after registration
            if e.action == "principal.roles_changed":
                expected["roles"] = e.payload.get("roles")
            elif e.action == "principal.deactivated":
                active = False
            elif e.action == "principal.reactivated":
                active = True
        if expected != kernel.get_principal(p.id).to_dict():
            bad(p.id, "principal matches its registration and role changes", "roles, name, "
                "kind or organisation differ from the recorded history")
        if (p.active is not False) != active:
            bad(p.id, "active state replays from its events", "active flag differs")

    for prog in repo.programs():
        events = by_subject[prog.id]
        ev = _last(events, "program.created", "program.context_updated",
                   "program.determination_recorded")
        if ev is None:
            bad(prog.id, "programme has its creation event", "no program.created")
        elif ev.payload.get("study_set_hash") != content_hash(prog.study_set):
            bad(prog.id, "study set matches its last programme event",
                "the stored study set (and so the context) is not the one recorded")
        if prog.study_set and prog.study_set.get("context") != prog.context:
            bad(prog.id, "context matches the study set derived from it", "context differs")
        created = _last(events, "program.created")
        if created is not None and "organisation" in created.payload and \
                created.payload["organisation"] != prog.organisation:
            bad(prog.id, "owning organisation matches its creation event", "organisation "
                "changed")
        guests: set[str] = set()
        for e in events:
            if e.action == "program.member_added":
                guests.add(e.payload["principal_id"])
            elif e.action == "program.member_removed":
                guests.discard(e.payload["principal_id"])
        if guests != {m.principal_id for m in repo.members(prog.id)}:
            bad(prog.id, "guests replay from their membership events", "guest list differs")

        for c in repo.compounds(prog.id):
            ev = _last(by_subject[c.id], "compound.registered")
            if ev is None:
                bad(c.id, "compound has its registration event", "no compound.registered")
            elif (c.kind or "small_molecule") == "sequence":
                spec = (c.entity or {}).get("spec") or {}
                fp = content_hash({"chains": [(ch["sequence"], ch["copies"])
                                              for ch in spec.get("chains", [])],
                                   "helm": spec.get("helm")})
                if ev.payload.get("fingerprint") != fp or \
                        (c.entity or {}).get("fingerprint") != fp:
                    bad(c.id, "sequence matches its registration", "the stored sequence is "
                        "not the one registered")
            elif (ev.payload.get("inchikey"), ev.payload.get("canonical_smiles")) != \
                    (c.inchikey, c.smiles):
                bad(c.id, "structure matches its registration", "the stored structure is "
                    "not the one registered")

    for s in repo.studies():
        events = by_subject[s.id]
        ev = _last(events, *STATE_EVENTS)
        if ev is None:
            bad(s.id, "study has its creation event", "no study or import creation event")
            continue
        if STATE_EVENTS[ev.action] != s.state:
            bad(s.id, "state follows from its last event",
                f"state {s.state}, last event {ev.action}")
        if s.protocol_hash:
            dev = _last(events, "study.designed")
            if dev is None or dev.payload.get("protocol_hash") != s.protocol_hash or \
                    canonical_hash(s.protocol or {}) != s.protocol_hash:
                bad(s.id, "protocol matches its design event and recomputes", "protocol "
                    "content or hash differs")
        if s.data and s.origin != "import":
            rev = _last(events, "data.received")
            if rev is None or rev.payload.get("file_sha256") != s.data.get("file_sha256"):
                bad(s.id, "data match their receipt event", "data file differs")
        if s.results:
            aev = _last(events, "study.analyzed")
            stored = {k: v for k, v in s.results.items() if k != "analysis_hash"}
            if aev is None or aev.payload.get("analysis_hash") != s.results.get(
                    "analysis_hash") or content_hash(stored) != s.results.get("analysis_hash"):
                bad(s.id, "analysis matches its event and recomputes", "results differ")
        if s.report and s.origin != "import":
            rpt = _last(events, "study.reported")
            content = {k: v for k, v in s.report.items() if k != "markdown"}
            if rpt is None or rpt.payload.get("report_hash") != s.report_hash or \
                    canonical_hash(content) != s.report_hash:
                bad(s.id, "report matches its event and recomputes", "report differs")
            elif "report_record_hash" in rpt.payload:
                # the rendered text people read is covered too
                if content_hash(s.report) != rpt.payload["report_record_hash"]:
                    bad(s.id, "rendered report matches its event", "report text differs")
            else:
                latest = [a.content for a in repo.artifacts(s.id, "report")][-1:]
                if latest != [s.report]:
                    bad(s.id, "rendered report matches its artefact", "report text differs")
        if s.origin == "import" and s.state == "imported":
            cev = _last(events, "import.completed")
            if cev is None or cev.payload.get("import_hash") != s.report_hash or \
                    kernel.imports.import_hash(s) != s.report_hash:
                bad(s.id, "import matches its completion event and recomputes",
                    "import record differs")
        recorded = [e.payload.get("signature") for e in events if e.action in _SIGNATURE_EVENTS]
        if sorted(map(content_hash, s.signatures or [])) != sorted(map(content_hash, recorded)):
            bad(s.id, "signatures are exactly those recorded", "signatures differ")
        dets = [e.payload.get("signature") for e in events
                if e.action == "study.determination_recorded"]
        for d in s.determinations or []:
            if d.get("signature") not in dets:
                bad(s.id, "each determination appears in its event", f"{d.get('key')}")
        for a in repo.artifacts(s.id):
            if content_hash(a.content) != a.content_hash:
                bad(s.id, "artefacts recompute to their stored hashes",
                    f"{a.kind} v{a.version}")
    return out


class AnchorLog:
    """Append-only checkpoints of the ledger head, kept outside the database."""

    def __init__(self, path: Path, key: bytes | None = None) -> None:
        self.path = path
        self.key = key
        self._last: tuple[int, str] | None = None

    @classmethod
    def default(cls, data_dir: Path) -> AnchorLog:
        root = Path(os.environ.get("HOS_ANCHOR_DIR", data_dir / "anchors"))
        key = os.environ.get("HOS_ANCHOR_KEY")
        return cls(root / "anchors.jsonl", key.encode() if key else None)

    def _mac(self, rec: dict[str, Any]) -> str | None:
        if self.key is None:
            return None
        msg = json.dumps({k: rec[k] for k in ("seq", "head", "at")}, sort_keys=True)
        return hmac.new(self.key, msg.encode(), hashlib.sha256).hexdigest()

    def checkpoints(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        return [json.loads(line) for line in self.path.read_text().splitlines() if line.strip()]

    def append(self, ledger: Ledger) -> None:
        last = ledger.last()
        if last is None:
            return
        if self._last is None:
            cps = self.checkpoints()
            self._last = (cps[-1]["seq"], cps[-1]["head"]) if cps else (0, "")
        if self._last == (last.seq, last.entry_hash):
            return
        rec: dict[str, Any] = {"seq": last.seq, "head": last.entry_hash,
                               "at": utc_now().isoformat()}
        if (mac := self._mac(rec)) is not None:
            rec["hmac"] = mac
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as f:
            f.write(json.dumps(rec, sort_keys=True) + "\n")
            f.flush()
            os.fsync(f.fileno())
        self._last = (last.seq, last.entry_hash)

    def verify(self, ledger: Ledger,
               checkpoints: list[dict[str, Any]] | None = None) -> list[Finding]:
        heads = {e.seq: e.entry_hash for e in ledger.entries()}
        out: list[Finding] = []
        for cp in self.checkpoints() if checkpoints is None else checkpoints:
            if self.key is not None and not hmac.compare_digest(str(cp.get("hmac")),
                                                                str(self._mac(cp))):
                out.append(Finding("ledger", "checkpoint is authentic",
                                   f"checkpoint at {cp['seq']} fails its HMAC"))
            elif cp["seq"] not in heads:
                out.append(Finding("ledger", "chain reaches every checkpoint",
                                   f"no entry {cp['seq']}: the chain was truncated"))
            elif heads[cp["seq"]] != cp["head"]:
                out.append(Finding("ledger", "chain passes through every checkpoint",
                                   f"entry {cp['seq']} is not the anchored one: rewritten"))
        return out
