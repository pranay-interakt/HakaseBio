#!/usr/bin/env python3
"""Build the DepMap patient-line snapshot Parquet from the REAL public release.

The Confirmation-layer "virtual tissue" patient-line projection
(``platform/kernel/.../translational/patient_line.py``) consumes a prepared
Parquet at ``var/cache/depmap_prism_aggregated.parquet``. Per project policy
there is **no synthetic fallback** — the readout stays "unavailable" until this
real artifact exists. This script provisions it from the canonical public
DepMap release hosted on figshare, so nothing is fabricated.

Schema produced (exactly what the loader requires):

    depmap_id, cell_line_name, primary_disease, lineage,
    target_gene_symbol, target_essentiality_chronos, target_expression_log2_tpm

Sources (DepMap Public 24Q2, Broad Institute, CC-BY 4.0):
    Model.csv                                     cell-line metadata
    CRISPRGeneEffect.csv                          Chronos gene effect
    OmicsExpressionProteinCodingGenesTPMLogp1.csv log2(TPM+1) expression

USAGE
-----
    uv run python scripts/build_depmap_prism_snapshot.py            # all assayed genes
    uv run python scripts/build_depmap_prism_snapshot.py --genes EGFR,KRAS,BRAF

Downloads are cached under ``var/cache/depmap_raw/`` and re-used.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import sys
import urllib.request

import numpy as np
import pyarrow as pa
import pyarrow.csv as pacsv
import pyarrow.parquet as pq

RELEASE = "24Q2"
FIGSHARE_ARTICLE = "25880521"
FILES = {
    "Model.csv": "46489732",
    "CRISPRGeneEffect.csv": "46489063",
    "OmicsExpressionProteinCodingGenesTPMLogp1.csv": "46490878",
}
NOTEBOOK_VERSION = "build_depmap_prism_snapshot.py v1"
# Written in blocks so peak memory stays bounded regardless of gene-universe size.
GENE_BLOCK = 512


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _download(raw_dir: str, name: str, file_id: str) -> str:
    path = os.path.join(raw_dir, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    url = f"https://ndownloader.figshare.com/files/{file_id}"
    print(f"  downloading {name} …", flush=True)
    urllib.request.urlretrieve(url, path)  # noqa: S310 - fixed https figshare host
    return path


def _strip_gene(col: str) -> str:
    """``"EGFR (1956)"`` → ``"EGFR"``. DepMap wide-matrix column convention."""
    return col.split(" (", 1)[0].strip().upper()


def _read_matrix(path: str) -> tuple[list[str], list[str], np.ndarray]:
    """Read a DepMap wide matrix CSV → (row_ids, gene_symbols, values[float32])."""
    table = pacsv.read_csv(path)
    names = table.column_names
    row_ids = [str(v) for v in table.column(names[0]).to_pylist()]
    genes = [_strip_gene(c) for c in names[1:]]
    values = np.empty((len(row_ids), len(genes)), dtype=np.float32)
    for j, col in enumerate(names[1:]):
        values[:, j] = table.column(col).to_numpy(zero_copy_only=False).astype(np.float32)
    return row_ids, genes, values


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=None, help="output Parquet path")
    ap.add_argument(
        "--genes",
        default=None,
        help="comma-separated gene symbols to restrict the snapshot to (default: all assayed)",
    )
    args = ap.parse_args()

    root = _repo_root()
    cache = os.environ.get("HAKASE_CACHE_DIR") or os.path.join(root, "var", "cache")
    raw_dir = os.path.join(cache, "depmap_raw")
    os.makedirs(raw_dir, exist_ok=True)
    out = args.out or os.path.join(cache, "depmap_prism_aggregated.parquet")

    print(f"DepMap Public {RELEASE} (figshare article {FIGSHARE_ARTICLE})")
    paths = {name: _download(raw_dir, name, fid) for name, fid in FILES.items()}

    # ---- cell-line metadata -------------------------------------------------
    meta = pacsv.read_csv(paths["Model.csv"]).to_pydict()
    name_col = "CellLineName" if "CellLineName" in meta else "StrippedCellLineName"
    disease_col = "OncotreePrimaryDisease" if "OncotreePrimaryDisease" in meta else "primary_disease"
    lineage_col = "OncotreeLineage" if "OncotreeLineage" in meta else "lineage"
    model_meta: dict[str, tuple[str, str, str]] = {}
    for mid, nm, dz, ln in zip(
        meta["ModelID"], meta[name_col], meta[disease_col], meta[lineage_col], strict=False
    ):
        model_meta[str(mid).upper()] = (
            str(nm or mid),
            str(dz or "Unknown"),
            str(ln or "Unknown"),
        )
    print(f"  cell-line metadata: {len(model_meta)} models")

    # ---- Chronos essentiality ----------------------------------------------
    print("  reading CRISPR gene effect …", flush=True)
    crispr_ids, crispr_genes, crispr = _read_matrix(paths["CRISPRGeneEffect.csv"])
    print(f"    {len(crispr_ids)} lines × {len(crispr_genes)} genes")

    # ---- expression ---------------------------------------------------------
    print("  reading expression …", flush=True)
    expr_ids, expr_genes, expr = _read_matrix(paths["OmicsExpressionProteinCodingGenesTPMLogp1.csv"])
    print(f"    {len(expr_ids)} lines × {len(expr_genes)} genes")

    # ---- intersect ----------------------------------------------------------
    expr_row = {mid.upper(): i for i, mid in enumerate(expr_ids)}
    expr_col = {g: j for j, g in enumerate(expr_genes)}
    crispr_col: dict[str, int] = {}
    for j, g in enumerate(crispr_genes):
        crispr_col.setdefault(g, j)

    wanted = None
    if args.genes:
        wanted = {g.strip().upper() for g in args.genes.split(",") if g.strip()}
    genes = sorted(g for g in crispr_col if g in expr_col and (wanted is None or g in wanted))
    lines = [
        (i, expr_row[mid.upper()], mid.upper())
        for i, mid in enumerate(crispr_ids)
        if mid.upper() in expr_row and mid.upper() in model_meta
    ]
    if not genes or not lines:
        print("ERROR: no overlapping genes/cell lines — refusing to write a partial snapshot.")
        return 1
    print(f"  intersection: {len(lines)} cell lines × {len(genes)} genes")

    ci = np.array([a for a, _, _ in lines], dtype=np.int64)
    ei = np.array([b for _, b, _ in lines], dtype=np.int64)
    ids = [c for _, _, c in lines]
    names = [model_meta[c][0] for c in ids]
    diseases = [model_meta[c][1] for c in ids]
    lineages = [model_meta[c][2] for c in ids]

    schema = pa.schema(
        [
            ("depmap_id", pa.dictionary(pa.int32(), pa.string())),
            ("cell_line_name", pa.dictionary(pa.int32(), pa.string())),
            ("primary_disease", pa.dictionary(pa.int32(), pa.string())),
            ("lineage", pa.dictionary(pa.int32(), pa.string())),
            ("target_gene_symbol", pa.dictionary(pa.int32(), pa.string())),
            ("target_essentiality_chronos", pa.float32()),
            ("target_expression_log2_tpm", pa.float32()),
        ],
        metadata={
            "snapshot_name": f"DepMap Public {RELEASE} (CRISPR Chronos + CCLE expression)",
            "snapshot_release": RELEASE,
            "preparation_date": _dt.datetime.now(_dt.UTC).isoformat(),
            "n_cell_lines": str(len(ids)),
            "n_target_genes": str(len(genes)),
            "n_oncology_lineages": str(len(set(lineages))),
            "notebook_version": NOTEBOOK_VERSION,
        },
    )

    n_lines = len(ids)
    id_arr = pa.array(ids).dictionary_encode()
    name_arr = pa.array(names).dictionary_encode()
    disease_arr = pa.array(diseases).dictionary_encode()
    lineage_arr = pa.array(lineages).dictionary_encode()

    written = 0
    tmp = out + ".tmp"
    with pq.ParquetWriter(tmp, schema, compression="zstd") as writer:
        for start in range(0, len(genes), GENE_BLOCK):
            block = genes[start : start + GENE_BLOCK]
            cj = np.array([crispr_col[g] for g in block], dtype=np.int64)
            ej = np.array([expr_col[g] for g in block], dtype=np.int64)
            ess = crispr[np.ix_(ci, cj)]  # (n_lines, n_block)
            exp = expr[np.ix_(ei, ej)]
            keep = np.isfinite(ess) & np.isfinite(exp)
            if not keep.any():
                continue
            gene_idx = np.repeat(np.arange(len(block)), n_lines).reshape(len(block), n_lines).T
            line_idx = np.tile(np.arange(n_lines), (len(block), 1)).T
            gsel = gene_idx[keep]
            lsel = line_idx[keep]
            batch = pa.table(
                {
                    "depmap_id": id_arr.take(pa.array(lsel)),
                    "cell_line_name": name_arr.take(pa.array(lsel)),
                    "primary_disease": disease_arr.take(pa.array(lsel)),
                    "lineage": lineage_arr.take(pa.array(lsel)),
                    "target_gene_symbol": pa.array([block[i] for i in gsel]).dictionary_encode(),
                    "target_essentiality_chronos": pa.array(ess[keep], type=pa.float32()),
                    "target_expression_log2_tpm": pa.array(exp[keep], type=pa.float32()),
                },
                schema=schema,
            )
            writer.write_table(batch)
            written += batch.num_rows
            print(f"    …{start + len(block)}/{len(genes)} genes, {written:,} rows", flush=True)

    os.replace(tmp, out)
    size_mb = os.path.getsize(out) / 1e6
    print(f"\nWrote {out} — {written:,} rows, {size_mb:.1f} MB")
    print("Restart the AI service to pick it up (the loader caches on first access).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
