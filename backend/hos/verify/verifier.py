"""Offline verification of a Module 4 export (``hos-verify``).

Checks, in order:

1. **Files.** Every file's SHA-256 matches ``m4/MANIFEST.json``; no file is missing or extra.
2. **Ledger.** The exported chain recomputes entry by entry (sequence, previous-hash links,
   entry hashes) to the recorded head; every exported programme entry's payload hashes to
   the value its chain entry committed to.
3. **Driver-run studies.** With the installed driver of the same id and version, re-run
   design, ingest of the raw file, analysis and report, and require each content hash to
   equal the recorded protocol / data / analysis / report hash. Signatures must bind the
   report hash and include the roles approval requires; each expert determination's
   signature must bind its recorded content.
4. **Imported studies.** Report and dataset files hash to the recorded SHA-256; the import
   hash recomputes; signatures bind it and include the required roles. Imported values are
   attested from report and are not recomputed.

No database and no network are used.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from dataclasses import dataclass, field
from typing import Any

from hos.core.descriptors import compute_profile
from hos.core.regulatory import ProgramContext
from hos.db.repository import content_hash
from hos.drivers.base import CompoundInfo, DataOrigin, canonical_hash
from hos.drivers.registry import default_registry
from hos.kernel.imports import compute_import_hash
from hos.kernel.inputs import input_quantity
from hos.kernel.ledger import GENESIS_HASH, LedgerEntry, canonical_json
from hos.verify.bundle import BUNDLE_FORMAT, software_versions

__all__ = ["Check", "VerificationReport", "verify_bundle"]


@dataclass(frozen=True, slots=True)
class Check:
    subject: str
    check: str
    status: str  # pass | fail | warn
    detail: str = ""

    def to_dict(self) -> dict[str, str]:
        return {"subject": self.subject, "check": self.check, "status": self.status,
                "detail": self.detail}


@dataclass
class VerificationReport:
    checks: list[Check] = field(default_factory=list)
    manifest: dict[str, Any] = field(default_factory=dict)

    def add(self, subject: str, check: str, ok: bool, detail: str = "", warn: bool = False) -> None:
        self.checks.append(Check(subject, check, "pass" if ok else ("warn" if warn else "fail"),
                                 detail))

    @property
    def passed(self) -> bool:
        return not any(c.status == "fail" for c in self.checks)

    def to_dict(self) -> dict[str, Any]:
        counts = {s: sum(c.status == s for c in self.checks) for s in ("pass", "warn", "fail")}
        return {"passed": self.passed, "counts": counts,
                "checks": [c.to_dict() for c in self.checks],
                "bundle": {k: self.manifest.get(k) for k in ("format", "software", "ledger")}}

    def summary(self) -> str:
        lines = [f"[{c.status.upper():4}] {c.subject}: {c.check}" + (f" — {c.detail}" if c.detail
                                                                       else "")
                 for c in self.checks]
        d = self.to_dict()["counts"]
        lines.append(f"\n{'VERIFIED' if self.passed else 'VERIFICATION FAILED'}: "
                     f"{d['pass']} passed, {d['warn']} warnings, {d['fail']} failed")
        return "\n".join(lines)


def _approval_roles_ok(sigs: list[dict[str, Any]], glp: bool) -> tuple[bool, str]:
    def has(roles: set[str], meaning: str) -> bool:
        return any(s["role"] in roles and s["meaning"] == meaning for s in sigs)
    if glp:
        ok = has({"study_director"}, "approval") and has({"quality_assurance"},
                                                         "qa_compliance_statement")
        return ok, "GLP: study_director approval + quality_assurance statement"
    ok = has({"responsible_scientist", "study_director"}, "approval")
    return ok, "responsible_scientist or study_director approval"


def verify_bundle(content: bytes) -> VerificationReport:
    rep = VerificationReport()
    try:
        z = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        rep.add("bundle", "readable zip", False, str(exc))
        return rep
    names = set(z.namelist())

    # 1. files ---------------------------------------------------------------------------
    if "m4/MANIFEST.json" not in names:
        rep.add("bundle", "file manifest present", False, "m4/MANIFEST.json missing")
        return rep
    manifest_files: dict[str, str] = json.loads(z.read("m4/MANIFEST.json"))
    bad = [n for n, sha in manifest_files.items()
           if n not in names or hashlib.sha256(z.read(n)).hexdigest() != sha]
    extra = sorted(names - set(manifest_files) - {"m4/MANIFEST.json"})
    rep.add("bundle", f"{len(manifest_files)} file hashes match the manifest", not bad and not extra,
            f"mismatched: {bad[:5]} extra: {extra[:5]}" if bad or extra else "")
    if "verification/manifest.json" not in names:
        rep.add("bundle", "verification section present", False,
                "not a verification bundle (no verification/manifest.json)")
        return rep
    vm = json.loads(z.read("verification/manifest.json"))
    rep.manifest = vm
    rep.add("bundle", f"format {BUNDLE_FORMAT}", vm.get("format") == BUNDLE_FORMAT,
            str(vm.get("format")))
    here = software_versions()
    diffs = {k: (v, here.get(k)) for k, v in vm.get("software", {}).items() if here.get(k) != v}
    rep.add("environment", "software versions match the bundle", not diffs,
            "; ".join(f"{k}: bundle {a}, here {b}" for k, (a, b) in diffs.items()), warn=True)

    # 2. ledger ----------------------------------------------------------------------------
    chain = [json.loads(line) for line in z.read("verification/ledger/chain.jsonl").splitlines()
             if line.strip()]
    prev, seq_ok, link_ok, hash_ok = GENESIS_HASH, True, True, True
    by_seq: dict[int, dict[str, Any]] = {}
    for i, c in enumerate(chain, start=1):
        body = {k: v for k, v in c.items() if k != "entry_hash"}
        seq_ok &= c["seq"] == i
        link_ok &= c["prev_hash"] == prev
        hash_ok &= LedgerEntry.compute_hash(body) == c["entry_hash"]
        prev = c["entry_hash"]
        by_seq[c["seq"]] = c
    head = vm.get("ledger", {}).get("head")
    rep.add("ledger", f"chain of {len(chain)} entries recomputes to the recorded head",
            seq_ok and link_ok and hash_ok and prev == head,
            "" if prev == head else f"computed head {prev[:12]} vs recorded {str(head)[:12]}")
    entries = [json.loads(line) for line in
               z.read("verification/ledger/entries.jsonl").splitlines() if line.strip()]
    payload_ok = all(
        hashlib.sha256(canonical_json(e["payload"]).encode()).hexdigest() == e["payload_sha256"]
        and by_seq.get(e["seq"], {}).get("entry_hash") == e["entry_hash"] for e in entries)
    rep.add("ledger", f"{len(entries)} programme entries match the chain", payload_ok)

    ctx = ProgramContext.from_dict(vm["program"]["context"])
    registry = default_registry()

    # 3. driver-run studies --------------------------------------------------------------------
    for sid in vm.get("studies", []):
        s = json.loads(z.read(f"verification/studies/{sid}.json"))
        exp = s["expected"]
        if s["driver_id"] not in registry:
            rep.add(sid, "driver available", False, f"{s['driver_id']} is not installed")
            continue
        driver = registry.get(s["driver_id"])
        if driver.version != s["driver_version"]:
            rep.add(sid, "driver version", False,
                    f"bundle needs {s['driver_id']}@{s['driver_version']}, "
                    f"installed {driver.version}")
            continue
        try:
            params = driver.validate_parameters(s["parameters"])
            prof = compute_profile(s["compound"]["smiles"])
            compound = CompoundInfo(id=s["compound"]["id"], name=s["compound"]["name"],
                                    smiles=s["compound"]["smiles"],
                                    inchikey=s["compound"]["inchikey"],
                                    molecular_weight=prof.molecular_weight, clogp=prof.clogp)
            protocol = driver.design(compound, params, ctx, s["hypothesis"])
            rep.add(sid, "protocol re-derives to the recorded hash",
                    protocol.content_hash == exp["protocol_hash"])
            df = s["data_file"]
            raw = z.read(f"verification/raw/{df['sha256']}")
            rep.add(sid, "raw data file hash", hashlib.sha256(raw).hexdigest() == df["sha256"])
            data = driver.ingest(raw, params, filename=df["filename"],
                                 claimed_origin=DataOrigin(df["origin"]), study_reference=sid)
            rep.add(sid, "raw file re-ingests to the recorded data",
                    content_hash(data.to_dict()) == exp["data_hash"])
            rep.add(sid, "data are not simulated", not data.is_simulated)
            inputs = {k: input_quantity(k, v) for k, v in s["analysis_inputs"].items()}
            res = driver.analyze(data, params, compound, inputs)
            rep.add(sid, "analysis recomputes to the recorded hash",
                    canonical_hash(res.to_dict()) == exp["analysis_hash"])
            interp = driver.interpret(res, params, ctx)
            report = driver.report(protocol, data, res, interp, s["determinations"])
            rep.add(sid, "report regenerates to the recorded hash",
                    report.content_hash == exp["report_hash"])
        except Exception as exc:  # noqa: BLE001 - any failure to recompute is a failed check
            rep.add(sid, "recomputation", False, f"{type(exc).__name__}: {exc}")
            continue
        on_report = [g for g in s["signatures"] if g["subject_hash"] == exp["report_hash"]]
        ok, need = _approval_roles_ok(on_report, s["glp"])
        rep.add(sid, f"signatures bind the report ({need})", ok)
        for d in s["determinations"]:
            q = d.get("quantity")
            subject = {"study_id": sid, "key": d["key"],
                       "value": q["value"] if q and q.get("available") else None,
                       "unit": q["unit"] if q else None,
                       "rationale": d["rationale"], "analysis_hash": d["analysis_hash"]}
            if d.get("category") is not None:
                subject["category"] = d["category"]
            rep.add(sid, f"determination '{d['key']}' signature binds its content",
                    d["signature"]["subject_hash"] == content_hash(subject)
                    and d["signature"]["role"] == d["role"])

    # 4. imported studies ------------------------------------------------------------------------
    for sid in vm.get("imports", []):
        s = json.loads(z.read(f"verification/imports/{sid}.json"))
        rec = s["import_record"]
        files_ok = all(
            hashlib.sha256(z.read(f"verification/raw/{f['sha256']}")).hexdigest() == f["sha256"]
            for f in [rec["report"], *rec.get("datasets", [])])
        rep.add(sid, "imported report and dataset hashes", files_ok)
        h = compute_import_hash(rec)
        rep.add(sid, "import content hash recomputes", h == s["import_hash"])
        values = [v for v in rec.get("values", []) if not v.get("withdrawn")]
        rep.add(sid, "every transcribed value cites a report page",
                all(v.get("page") for v in values) and bool(values))
        on = [g for g in s["signatures"] if g["subject_hash"] == h]
        ok, need = _approval_roles_ok(on, s["glp"])
        rep.add(sid, f"signatures bind the import ({need})", ok)
        rep.add(sid, "values attested from report (not recomputed)", True,
                f"{len(values)} values", warn=False)
    return rep
