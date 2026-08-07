#!/usr/bin/env python3
"""Build the cell-type expression atlas Parquet from the CZ CELLxGENE public API.

The Confirmation-layer cell-type aggregation model
(``platform/kernel/.../translational/celltype_aggregation.py``) consumes a
prepared Parquet at ``var/cache/tabula_sapiens_aggregated.parquet``. The
existing ``build_tabula_sapiens_atlas.py`` builds it from the CELLxGENE Census
via TileDB-SOMA, which needs the multi-GB ``cellxgene-census`` stack. This
script provisions the *same* aggregation from the same corpus over CZI's public
"Where's My Gene" (WMG) HTTP API — no heavy dependencies, and the returned
statistics are exactly the ones the loader requires:

    me   → mean_expression   (mean log1p-normalised expression in the group)
    n    → n_cells           (cells contributing to the group)
    pc   → pct_expressing    (fraction of the group's cells with expression > 0)

Grouping is (gene, tissue UBERON term, cell-type CL term); ``organ`` is the
documented tissue→organ rollup below.

Because a single gene's genome-wide response is ~1 MB, the atlas is built for a
bounded gene universe and can be grown incrementally with ``--append``.

USAGE
-----
    # seed with the genes the platform is most likely to be asked about
    uv run python scripts/build_celltype_atlas_wmg.py --genes-from-depmap --limit 2000

    # add specific targets later (keeps what is already there)
    uv run python scripts/build_celltype_atlas_wmg.py --genes EGFR,KRAS,BRAF --append

Source: CZ CELLxGENE Discover (chanzuckerberg.com), CC-BY 4.0.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import ssl
import sys
import time
import urllib.request

import pyarrow as pa
import pyarrow.parquet as pq

API = "https://api.cellxgene.cziscience.com/wmg/v2"


def _ssl_context() -> ssl.SSLContext:
    """Trust store for python.org builds, which ship no system CA bundle."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


_SSL = _ssl_context()
HUMAN = "NCBITaxon:9606"
BATCH = 12  # genes per WMG request (responses are ~1 MB/gene)
NOTEBOOK_VERSION = "build_celltype_atlas_wmg.py v1"

# Tissue → organ rollup. Mirrors build_tabula_sapiens_atlas.py so both builders
# produce interchangeable artifacts.
TISSUE_TO_ORGAN: dict[str, str] = {
    "blood": "Immune/Blood",
    "bone marrow": "Immune/Blood",
    "spleen": "Immune/Blood",
    "lymph node": "Immune/Blood",
    "thymus": "Immune/Blood",
    "liver": "Liver",
    "kidney": "Kidney",
    "heart": "Heart",
    "lung": "Lung",
    "brain": "CNS",
    "spinal cord": "CNS",
    "skeletal muscle tissue": "Muscle",
    "muscle": "Muscle",
    "skin of body": "Skin",
    "skin": "Skin",
    "small intestine": "GI",
    "large intestine": "GI",
    "colon": "GI",
    "stomach": "GI",
    "esophagus": "GI",
    "pancreas": "Pancreas",
    "adipose tissue": "Adipose",
    "eye": "Eye",
    "retina": "Eye",
    "tongue": "GI",
    "trachea": "Lung",
    "bladder": "Bladder",
    "urinary bladder": "Bladder",
    "prostate gland": "Reproductive",
    "uterus": "Reproductive",
    "ovary": "Reproductive",
    "testis": "Reproductive",
    "breast": "Reproductive",
    "placenta": "Reproductive",
    "vasculature": "Vasculature",
    "salivary gland": "GI",
    "thyroid gland": "Endocrine",
    "adrenal gland": "Endocrine",
    "pituitary gland": "Endocrine",
    "nose": "Respiratory",
    "respiratory system": "Respiratory",
}

REQUIRED_COLUMNS = (
    "gene_symbol",
    "cell_type",
    "tissue",
    "organ",
    "mean_expression",
    "n_cells",
    "pct_expressing",
)


def _organ_for(tissue: str) -> str:
    t = tissue.strip().lower()
    if t in TISSUE_TO_ORGAN:
        return TISSUE_TO_ORGAN[t]
    for key, organ in TISSUE_TO_ORGAN.items():
        if key in t:
            return organ
    return "Other"


def _post(path: str, payload: dict, timeout: float = 180.0) -> dict:
    req = urllib.request.Request(  # noqa: S310 - fixed https CZI host
        f"{API}/{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=_SSL) as r:  # noqa: S310
        return json.loads(r.read())


def _get(path: str, timeout: float = 180.0) -> dict:
    with urllib.request.urlopen(f"{API}/{path}", timeout=timeout, context=_SSL) as r:  # noqa: S310
        return json.loads(r.read())


def _gene_index() -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """(symbol→ENSG, ENSG→symbol, snapshot_id) from the WMG primary filters."""
    dims = _get("primary_filter_dimensions")
    sym_to_ens: dict[str, str] = {}
    ens_to_sym: dict[str, str] = {}
    for entry in dims["gene_terms"][HUMAN]:
        for ens, sym in entry.items():
            s = str(sym).upper()
            ens_to_sym[ens] = s
            sym_to_ens.setdefault(s, ens)
    return sym_to_ens, ens_to_sym, dims.get("snapshot_id", "")


def _depmap_genes(limit: int) -> list[str]:
    """Rank DepMap-assayed genes by cross-line essentiality variance.

    Genes whose knockout effect *varies* across the cancer panel are the
    pharmacologically interesting ones; this gives a reproducible, documented
    ordering for a bounded atlas rather than an arbitrary alphabetical cut.
    """
    import numpy as np
    import pyarrow.csv as pacsv

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache = os.environ.get("HAKASE_CACHE_DIR") or os.path.join(root, "var", "cache")
    path = os.path.join(cache, "depmap_raw", "CRISPRGeneEffect.csv")
    if not os.path.exists(path):
        raise SystemExit(
            f"{path} not found — run scripts/build_depmap_prism_snapshot.py first, "
            "or pass --genes explicitly."
        )
    table = pacsv.read_csv(path)
    scored: list[tuple[float, str]] = []
    for col in table.column_names[1:]:
        v = table.column(col).to_numpy(zero_copy_only=False).astype("float32")
        v = v[np.isfinite(v)]
        if v.size < 50:
            continue
        scored.append((float(v.std()), col.split(" (", 1)[0].strip().upper()))
    scored.sort(reverse=True)
    seen: set[str] = set()
    out: list[str] = []
    for _, gene in scored:
        if gene not in seen:
            seen.add(gene)
            out.append(gene)
        if len(out) >= limit:
            break
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=None)
    ap.add_argument("--genes", default=None, help="comma-separated HUGO symbols")
    ap.add_argument("--genes-from-depmap", action="store_true")
    ap.add_argument("--limit", type=int, default=2000)
    ap.add_argument("--append", action="store_true", help="merge into an existing atlas")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache = os.environ.get("HAKASE_CACHE_DIR") or os.path.join(root, "var", "cache")
    os.makedirs(cache, exist_ok=True)
    out = args.out or os.path.join(cache, "tabula_sapiens_aggregated.parquet")

    if args.genes:
        wanted = [g.strip().upper() for g in args.genes.split(",") if g.strip()]
    elif args.genes_from_depmap:
        print("Ranking DepMap genes by essentiality variance …", flush=True)
        wanted = _depmap_genes(args.limit)
    else:
        raise SystemExit("Pass --genes or --genes-from-depmap.")

    print("Fetching CELLxGENE gene/tissue dictionaries …", flush=True)
    sym_to_ens, ens_to_sym, snapshot = _gene_index()
    targets = [(g, sym_to_ens[g]) for g in wanted if g in sym_to_ens]
    missing = [g for g in wanted if g not in sym_to_ens]
    print(f"  {len(targets)} genes resolvable, {len(missing)} not in the corpus")

    existing_genes: set[str] = set()
    existing: pa.Table | None = None
    if args.append and os.path.exists(out):
        existing = pq.read_table(out)
        existing_genes = set(existing.column("gene_symbol").to_pylist())
        targets = [(g, e) for g, e in targets if g not in existing_genes]
        print(f"  {len(existing_genes)} genes already in {out}; {len(targets)} to add")

    rows_gene: list[str] = []
    rows_ct: list[str] = []
    rows_tissue: list[str] = []
    rows_organ: list[str] = []
    rows_me: list[float] = []
    rows_n: list[int] = []
    rows_pc: list[float] = []

    for start in range(0, len(targets), BATCH):
        block = targets[start : start + BATCH]
        payload = {
            "filter": {
                "gene_ontology_term_ids": [e for _, e in block],
                "organism_ontology_term_id": HUMAN,
            },
            "is_rollup": True,
        }
        for attempt in range(4):
            try:
                data = _post("query", payload)
                break
            except Exception as exc:  # noqa: BLE001
                if attempt == 3:
                    print(f"  ! giving up on block {start}: {exc}")
                    data = {}
                else:
                    time.sleep(3 * (attempt + 1))
        labels = data.get("term_id_labels") or {}
        tissue_labels = {
            k: v for k, v in (labels.get("tissue_terms") or {}).items()  # type: ignore[union-attr]
        }
        ct_labels = labels.get("cell_types") or {}
        for ens, by_tissue in (data.get("expression_summary") or {}).items():
            gene = ens_to_sym.get(ens, ens)
            for tissue_id, by_ct in by_tissue.items():
                tissue = _label(tissue_labels, tissue_id)
                organ = _organ_for(tissue)
                for ct_id, agg in by_ct.items():
                    stats = (agg or {}).get("aggregated") or {}
                    me = stats.get("me")
                    n = stats.get("n")
                    pc = stats.get("pc")
                    if me is None or n is None or pc is None:
                        continue
                    rows_gene.append(gene)
                    rows_ct.append(_label(ct_labels.get(tissue_id) or ct_labels, ct_id))
                    rows_tissue.append(tissue)
                    rows_organ.append(organ)
                    rows_me.append(float(me))
                    rows_n.append(int(n))
                    rows_pc.append(float(pc))
        print(
            f"  {min(start + BATCH, len(targets))}/{len(targets)} genes, {len(rows_gene):,} rows",
            flush=True,
        )

    if not rows_gene and existing is None:
        print("ERROR: no rows returned — refusing to write an empty atlas.")
        return 1

    table = pa.table(
        {
            "gene_symbol": pa.array(rows_gene).dictionary_encode(),
            "cell_type": pa.array(rows_ct).dictionary_encode(),
            "tissue": pa.array(rows_tissue).dictionary_encode(),
            "organ": pa.array(rows_organ).dictionary_encode(),
            "mean_expression": pa.array(rows_me, type=pa.float32()),
            "n_cells": pa.array(rows_n, type=pa.int32()),
            "pct_expressing": pa.array(rows_pc, type=pa.float32()),
        }
    )
    if existing is not None:
        table = pa.concat_tables([existing.select(list(REQUIRED_COLUMNS)), table], promote_options="permissive")

    genes = set(table.column("gene_symbol").to_pylist())
    cell_types = set(table.column("cell_type").to_pylist())
    organs = set(table.column("organ").to_pylist())
    table = table.replace_schema_metadata(
        {
            "atlas_name": "CZ CELLxGENE Discover (WMG v2) — cross-tissue human cell atlas",
            "atlas_sha": snapshot,
            "preparation_date": _dt.datetime.now(_dt.UTC).isoformat(),
            "n_genes": str(len(genes)),
            "n_cell_types": str(len(cell_types)),
            "n_organs": str(len(organs)),
            "notebook_version": NOTEBOOK_VERSION,
        }
    )
    tmp = out + ".tmp"
    pq.write_table(table, tmp, compression="zstd")
    os.replace(tmp, out)
    print(
        f"\nWrote {out} — {table.num_rows:,} rows, {len(genes)} genes, "
        f"{len(cell_types)} cell types, {os.path.getsize(out) / 1e6:.1f} MB"
    )
    return 0


def _label(mapping: object, term_id: str) -> str:
    """WMG label maps are lists of single-entry dicts or plain dicts."""
    if isinstance(mapping, dict):
        v = mapping.get(term_id)
        if isinstance(v, str):
            return v
        if isinstance(v, dict):
            return str(v.get("name") or term_id)
    if isinstance(mapping, list):
        for entry in mapping:
            if isinstance(entry, dict) and term_id in entry:
                v = entry[term_id]
                return str(v.get("name") if isinstance(v, dict) else v)
    return term_id


if __name__ == "__main__":
    sys.exit(main())
