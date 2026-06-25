"""Frozen validation hold-out sets — fetched LIVE from authoritative sources.

This is NOT an app-runtime cache (the resolver is live-only). It is a *validation
dataset*: a dated, reproducible snapshot of measured ground truth, frozen so the
report card is reproducible. Every record is a real curated ChEMBL fact
(approved / withdrawn + structure); nothing is fabricated.

  • build_verdict_holdout() — approved (label=advance) vs withdrawn (label=halt),
    with canonical SMILES + InChIKey. Drives the triage confusion matrix.

Endpoint-level numeric/binary truth (hERG, AMES, DILI, Caco-2, clearance, …) is
sourced from the TDC ADMET benchmark TEST splits at run time by the endpoint
validator; see validation/run_validation.py.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request

CHEMBL_HOST = "https://www.ebi.ac.uk"
CHEMBL_BASE = f"{CHEMBL_HOST}/chembl/api/data"
FIELDS = "molecule_chembl_id,pref_name,max_phase,withdrawn_flag,molecule_structures"
HEADERS = {"Accept": "application/json", "User-Agent": "HakaseAI-Validation/1.0"}

_HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT_DIR = os.path.join(_HERE, "snapshots")


def _fetch(url: str, retries: int = 4, timeout: float = 25.0) -> dict:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"ChEMBL fetch failed: {url} ({last})")


def _crawl(filter_params: str, label: str, max_pages: int | None) -> list[dict]:
    out: list[dict] = []
    url = f"{CHEMBL_BASE}/molecule.json?{filter_params}&only={FIELDS}&limit=1000"
    page = 0
    while url:
        if max_pages is not None and page >= max_pages:
            break
        data = _fetch(url)
        for mol in data.get("molecules") or []:
            s = mol.get("molecule_structures") or {}
            ik = s.get("standard_inchi_key") if isinstance(s, dict) else None
            smi = s.get("canonical_smiles") if isinstance(s, dict) else None
            if not ik or not smi:
                continue
            out.append({
                "name": mol.get("pref_name") or mol.get("molecule_chembl_id"),
                "chembl_id": mol.get("molecule_chembl_id"),
                "inchikey": ik,
                "smiles": smi,
                "status": label,
            })
        page += 1
        nxt = (data.get("page_meta") or {}).get("next")
        url = (CHEMBL_HOST + nxt) if nxt else None
    return out


def build_verdict_holdout(approved_pages: int | None = 1, write: bool = True) -> dict:
    """Approved (label=advance/1) vs withdrawn (label=halt/0) hold-out.

    `approved_pages` caps the approved sample (1 page = up to 1000) so the set is
    reasonably balanced against the ~340 withdrawn drugs; pass None for all
    approved. De-duplicated by InChIKey; a withdrawn record always wins a clash.
    """
    withdrawn = _crawl("withdrawn_flag=true", "withdrawn", None)
    approved = _crawl("max_phase=4", "approved", approved_pages)

    by_key: dict[str, dict] = {}
    for rec in approved:
        by_key[rec["inchikey"]] = rec
    for rec in withdrawn:  # withdrawn overrides
        by_key[rec["inchikey"]] = rec

    records = list(by_key.values())
    for r in records:
        r["label_advance"] = 1 if r["status"] == "approved" else 0

    payload = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "EMBL-EBI ChEMBL molecule API (max_phase=4 approved + withdrawn_flag=true)",
        "n_total": len(records),
        "n_approved": sum(1 for r in records if r["status"] == "approved"),
        "n_withdrawn": sum(1 for r in records if r["status"] == "withdrawn"),
        "label_semantics": "label_advance: 1 = approved (should ADVANCE), 0 = withdrawn (should HALT)",
        "records": records,
    }
    if write:
        os.makedirs(SNAPSHOT_DIR, exist_ok=True)
        path = os.path.join(SNAPSHOT_DIR, f"verdict_holdout_{time.strftime('%Y%m%d', time.gmtime())}.json")
        with open(path, "w") as f:
            json.dump(payload, f)
        payload["snapshot_path"] = path
    return payload


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--approved-pages", type=int, default=1)
    args = ap.parse_args()
    p = build_verdict_holdout(approved_pages=args.approved_pages)
    print(f"verdict hold-out: {p['n_total']} ({p['n_approved']} approved / {p['n_withdrawn']} withdrawn) → {p.get('snapshot_path')}")
