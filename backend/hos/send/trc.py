"""Pre-export checks for a SEND package, each tied to the FDA text that states it.

Technical Rejection Criteria (Specifications for eCTD Validation Criteria v4.6; TCG v6.3
Appendix F): 1734 ts.xpt with the study start date; 1736 dm.xpt and define.xml. The STF file
tags (1735, 1789) and STF study id (1738) belong to eCTD publishing and are outside the
dataset package; the package uses STUDYID as the STF study id.

Conformance (TCG v6.3): STUDYID identical in every record (4.1.3); Required variables filled
for all records (4.1.3); --TESTCD at most 8 characters, not starting with a number, letters,
digits and underscores (4.1.3); character values at most 200 characters (4.1.3); a full TS,
not the simplified one, when SEND datasets are submitted (8.1.2); every trial set has exactly
one SPGRPCD, GRPLBL, PLANMSUB and PLANFSUB (4.1.3); file names are the lower-case domain code,
the define.xml lists exactly the dataset files, no empty file, no duplicate USUBJID/--SEQ
(Appendix I).
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from hos.send.domains import Domain

__all__ = ["Check", "run_checks"]

_TESTCD = re.compile(r"^[A-Z_][A-Z0-9_]{0,7}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


@dataclass(frozen=True, slots=True)
class Check:
    rule: str
    source: str
    passed: bool
    detail: str = ""

    def to_dict(self) -> dict[str, object]:
        return {"rule": self.rule, "source": self.source, "passed": self.passed,
                "detail": self.detail}


def run_checks(domains: dict[str, Domain], files: dict[str, bytes], define_text: str,
               studyid: str) -> list[Check]:
    out: list[Check] = []

    def add(rule: str, source: str, ok: bool, detail: str = "") -> None:
        out.append(Check(rule, source, ok, "" if ok else detail))

    ts = domains.get("TS")
    ststdtc = [r["TSVAL"] for r in (ts.rows if ts else []) if r["TSPARMCD"] == "STSTDTC"]
    add("ts.xpt present with the study start date (STSTDTC, ISO 8601)",
        "eCTD validation 1734 (High); TCG v6.3 Appendix G", "ts.xpt" in files and bool(
            ststdtc) and bool(ststdtc[0]) and bool(_DATE.match(str(ststdtc[0]))),
        f"STSTDTC = {ststdtc[:1]}")
    add("dm.xpt and define.xml present", "eCTD validation 1736 (High)",
        "dm.xpt" in files and bool(define_text), "missing dm.xpt or define.xml")
    add("full Trial Summary, not the simplified ts.xpt", "TCG v6.3 8.1.2",
        ts is not None and len(ts.rows) > 1, "TS holds only the study start date")
    bad_id = sorted({str(r.get("STUDYID")) for d in domains.values() for r in d.rows} -
                    {studyid})
    add("STUDYID identical in every record", "TCG v6.3 4.1.3", not bad_id,
        f"other values {bad_id}")
    empty_req = sorted({f"{d.name}.{v.name}" for d in domains.values() for v in d.variables
                        if v.core == "Req" for r in d.rows if r.get(v.name) in (None, "")})
    add("Required variables filled for every record", "TCG v6.3 4.1.3", not empty_req,
        f"empty: {empty_req[:10]}")
    bad_cd = sorted({str(r[v.name]) for d in domains.values() for v in d.variables
                     if v.name.endswith("TESTCD") for r in d.rows
                     if r.get(v.name) and not _TESTCD.match(str(r[v.name]))})
    add("--TESTCD at most 8 characters, letters/digits/underscores, not starting with a "
        "digit", "TCG v6.3 4.1.3", not bad_cd, f"invalid: {bad_cd[:10]}")
    long_vals = sorted({f"{d.name}.{k}" for d in domains.values() for r in d.rows
                        for k, v in r.items() if isinstance(v, str) and len(v) > 200})
    add("character values at most 200 characters", "TCG v6.3 4.1.3", not long_vals,
        f"too long: {long_vals[:10]}")
    tx = domains.get("TX")
    tx_bad = []
    if tx is not None:
        per = Counter((r["SETCD"], r["TXPARMCD"]) for r in tx.rows)
        for setcd in {r["SETCD"] for r in tx.rows}:
            for code in ("SPGRPCD", "GRPLBL", "PLANMSUB", "PLANFSUB"):
                if per[(setcd, code)] != 1:
                    tx_bad.append(f"{setcd}.{code}={per[(setcd, code)]}")
    add("each trial set has one SPGRPCD, GRPLBL, PLANMSUB and PLANFSUB", "TCG v6.3 4.1.3",
        tx is not None and not tx_bad, f"{tx_bad[:10]}")
    sets = {r["SETCD"] for r in (tx.rows if tx else [])}
    dm = domains.get("DM")
    orphan = sorted({str(r["SETCD"]) for r in (dm.rows if dm else [])} - sets)
    add("every DM SETCD is a trial set in TX", "TCG v6.3 Appendix I (invalid references "
        "between files)", not orphan, f"{orphan}")
    names_ok = all(re.fullmatch(r"[a-z]{2}\.xpt", n) for n in files)
    add("dataset files named by the lower-case domain code", "TCG v6.3 Appendix I", names_ok,
        f"{sorted(files)}")
    listed = set(re.findall(r'xlink:href="([^"]+\.xpt)"', define_text))
    add("define.xml lists exactly the dataset files", "TCG v6.3 Appendix I",
        listed == set(files), f"define {sorted(listed)} vs files {sorted(files)}")
    add("no empty (0 kb) files", "TCG v6.3 Appendix I", all(len(b) > 0 for b in files.values()),
        "an empty file")
    dup = []
    for d in domains.values():
        seqv = f"{d.name}SEQ"
        if any(v.name == seqv for v in d.variables) and any(v.name == "USUBJID"
                                                            for v in d.variables):
            c = Counter((r.get("USUBJID"), r.get(seqv)) for r in d.rows)
            dup += [f"{d.name}:{k}" for k, n in c.items() if n > 1]
    add("USUBJID and --SEQ unique within each domain", "TCG v6.3 Appendix I", not dup,
        f"{dup[:10]}")
    for one in ("DM", "DS"):
        dom = domains.get(one)
        if dom is not None:
            c = Counter(r["USUBJID"] for r in dom.rows)
            many = [k for k, n in c.items() if n > 1]
            add(f"{one}: one record per subject", f"SENDIG v3.1.1 {one} structure",
                not many, f"{many[:10]}")
    return out
