"""Build the SEND reference data shipped in hos/send/reference/ from verified source files.

Sources (checked by SHA-256 before use; see docs/research/send_export.md):

* CDISC Library content as cached by CDISC's open-source CDISC Rules Engine,
  resources/cache/standards_details.pkl at commit 9ffb1c611081b655c11fc0ac77ed6cc809828126
  (MIT licence). Loaded with an unpickler that refuses every class: the file holds only
  dicts, lists and strings.
* NCI EVS SEND Controlled Terminology 2026-09-25 (SEND Terminology.txt).

Usage: python scripts/build_send_reference.py <standards_details.pkl> <SEND Terminology.txt>
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import pickle
import sys
from pathlib import Path
from typing import Any

OUT = Path(__file__).resolve().parents[1] / "hos" / "send" / "reference"
CACHE_SHA = "979f73003bd26907a878aa49af1c38bc1e88d93e58b959fedaec16bc22e5e404"
CT_SHA = "3a6708ca06543d31254188b1e60bd8f6350e22983a504a970d9dad77c33966b1"
CACHE_COMMIT = "9ffb1c611081b655c11fc0ac77ed6cc809828126"
DOMAINS = ("TS", "TX", "DM", "EX", "DS", "BW", "FW", "CL", "LB", "MA", "MI", "OM", "PC", "PP")


class _NoClasses(pickle.Unpickler):
    def find_class(self, module: str, name: str) -> Any:
        raise pickle.UnpicklingError(f"refusing to load {module}.{name}")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sendig(cache: Path) -> dict[str, Any]:
    data = _NoClasses(io.BytesIO(cache.read_bytes())).load()
    ig = data["standards/sendig/3-1-1"]
    out: dict[str, Any] = {
        "standard": ig["name"], "label": ig.get("label"), "effectiveDate": ig["effectiveDate"],
        "registrationStatus": ig.get("registrationStatus"),
        "model": ig["_links"]["model"]["title"],
        "provenance": {
            "access_path": "CDISC Library content cached by cdisc-org/cdisc-rules-engine "
                           "resources/cache/standards_details.pkl",
            "commit": CACHE_COMMIT, "sha256": CACHE_SHA, "licence": "MIT",
            "note": "the SENDIG PDF is behind a CDISC login; re-confirm before GxP use"},
        "datasets": {}}
    for cls in ig["classes"]:
        for ds in cls.get("datasets", []):
            if ds["name"] not in DOMAINS:
                continue
            variables = []
            for v in sorted(ds["datasetVariables"], key=lambda x: int(x["ordinal"])):
                codelists = [link["href"].rsplit("/", 1)[-1]
                             for link in v.get("_links", {}).get("codelist", [])]
                variables.append({
                    "name": v["name"], "label": v["label"], "type": v["simpleDatatype"],
                    "core": v["core"], "role": v.get("role"), "ordinal": int(v["ordinal"]),
                    "codelists": codelists,
                    "codelist_submission_values": v.get("codelistSubmissionValues", []),
                    "value_list": v.get("valueList", []),
                    "format": v.get("describedValueDomain")})
            out["datasets"][ds["name"]] = {
                "label": ds["label"], "class": cls["name"],
                "structure": ds.get("datasetStructure"), "variables": variables}
    missing = [d for d in DOMAINS if d not in out["datasets"]]
    if missing:
        raise SystemExit(f"domains missing from the cache: {missing}")
    return out


def terminology(path: Path) -> dict[str, Any]:
    rows = list(csv.reader(path.read_text(encoding="utf-8").splitlines(), delimiter="\t"))
    header, body = rows[0], rows[1:]
    if header[:5] != ["Code", "Codelist Code", "Codelist Extensible (Yes/No)", "Codelist Name",
                      "CDISC Submission Value"]:
        raise SystemExit(f"unexpected CT header {header}")
    lists: dict[str, Any] = {}
    for r in body:
        if not r[1]:
            lists[r[0]] = {"name": r[3], "submission_value": r[4], "extensible": r[2] == "Yes",
                           "terms": {}}
    for r in body:
        if r[1]:
            lists[r[1]]["terms"][r[4]] = r[0]
    return {"version": "2026-09-25", "file_oid": "CDISC_CT.SEND.2026-09-25",
            "provenance": {"source": "https://evs.nci.nih.gov/ftp1/CDISC/SEND/"
                                     "SEND%20Terminology.txt", "sha256": CT_SHA,
                           "publisher": "CDISC / NCI EVS"},
            "codelists": lists}


def main() -> None:
    cache, ct = Path(sys.argv[1]), Path(sys.argv[2])
    for p, want in ((cache, CACHE_SHA), (ct, CT_SHA)):
        if _sha(p) != want:
            raise SystemExit(f"{p}: SHA-256 {_sha(p)} is not the verified {want}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sendig_3_1_1.json").write_text(json.dumps(sendig(cache), indent=1, sort_keys=True)
                                           + "\n")
    (OUT / "send_ct_2026_09_25.json").write_text(json.dumps(terminology(ct), sort_keys=True,
                                                            separators=(",", ":")) + "\n")
    print("written", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
