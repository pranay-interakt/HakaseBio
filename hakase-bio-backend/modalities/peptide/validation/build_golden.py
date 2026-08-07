"""Freeze the curated golden-peptide reference sheet to a local CSV (run once).

The reference set is maintained by the team as a Google Sheet: ~25 well-studied
peptides, each with an experimental structural reference (PDB) and computed
physicochemical reference values (MW / pI / charge, evidence level "C"), plus
functional / developability / safety ground truth for the other services.

This script downloads that sheet and writes ``datasets/golden_peptides.csv`` with
the physicochemical numbers parsed into their own columns. The frozen CSV — not
the live sheet — is what the validation reads, so tests stay reproducible.

Run:  .venv/bin/python modalities/peptide/validation/build_golden.py
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import os
import re
import urllib.request

_HERE = os.path.dirname(__file__)
_OUT = os.path.join(_HERE, "datasets", "golden_peptides.csv")

SHEET_ID = "1jf2WaSJLgBkrPlHo2GqzxsgGTVEwuQ0G3f8wjcKHVxU"
SHEET_GID = "2125746229"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}"

_NUM = r"[-+]?\d+(?:\.\d+)?"


def _num_after(label: str, text: str) -> float | None:
    m = re.search(rf"{label}:\s*({_NUM})", text)
    return float(m.group(1)) if m else None


def build() -> int:
    with urllib.request.urlopen(SHEET_URL, timeout=60) as resp:  # noqa: S310 — team sheet
        raw = resp.read().decode("utf-8")

    reader = csv.reader(io.StringIO(raw))
    rows = [r for r in reader if any(c.strip() for c in r)]
    # Find the header row (the one naming the columns) and map by name.
    header_idx = next(i for i, r in enumerate(rows) if "Sequence" in r)
    header = [c.strip() for c in rows[header_idx]]
    col = {name: header.index(name) for name in header if name}

    def cell(r: list[str], name: str) -> str:
        i = col.get(name)
        return r[i].strip() if i is not None and i < len(r) else ""

    out_rows = []
    for r in rows[header_idx + 1 :]:
        seq = cell(r, "Sequence")
        if not re.fullmatch(r"[A-Za-z]+", seq or ""):
            continue  # skip blanks / non-sequence rows
        phys = cell(r, "Physicochemical Reference")
        out_rows.append(
            {
                "id": cell(r, "ID"),
                "name": cell(r, "Peptide Name"),
                "sequence": seq.upper(),
                "modifications": cell(r, "Modifications"),
                "ref_mw": _num_after("MW", phys),
                "ref_pi": _num_after("pI", phys),
                "ref_charge": _num_after("Charge", phys),
                "functional_ref": cell(r, "Functional Reference"),
                "safety_ref": cell(r, "Safety Reference"),
                "purpose": cell(r, "Primary Validation Purpose"),
            }
        )

    os.makedirs(os.path.dirname(_OUT), exist_ok=True)
    fields = [
        "id",
        "name",
        "sequence",
        "modifications",
        "ref_mw",
        "ref_pi",
        "ref_charge",
        "functional_ref",
        "safety_ref",
        "purpose",
    ]
    with open(_OUT, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(out_rows)
    return len(out_rows)


if __name__ == "__main__":
    n = build()
    print(f"Wrote {_OUT} with {n} peptides (source sheet accessed {dt.date.today().isoformat()}).")
