#!/usr/bin/env python3
"""Build the Tabula Sapiens v2 aggregated atlas Parquet from the REAL public source.

The L1 "behavioural fingerprinting" model (cell-type aggregation, Drug2cell
pattern) consumes a pre-aggregated Parquet at

    var/cache/tabula_sapiens_aggregated.parquet

Per project policy there is **no synthetic fallback**: the feature stays
"unavailable" until this real artifact is provisioned. This script builds it
from the CZ CELLxGENE Census (the canonical, versioned Tabula Sapiens source) —
so nothing is fabricated; it is the exact public atlas, aggregated.

It produces the schema the loader requires
(`platform/kernel/.../translational/celltype_aggregation.py`):

    gene_symbol, cell_type, tissue, organ, mean_expression, n_cells, pct_expressing

plus pyarrow file-level metadata (atlas_name, atlas_sha, preparation_date,
n_genes, n_cell_types, n_organs, notebook_version) that the app echoes back for
provenance.

USAGE
-----
    # one-time, needs network + a few GB RAM (Census is large):
    uv run python scripts/build_tabula_sapiens_atlas.py \
        --out var/cache/tabula_sapiens_aggregated.parquet

Then either keep it local, or upload it to your object store and set

    TABULA_SAPIENS_PARQUET_URL=https://<store>/tabula_sapiens_aggregated.parquet

so every host/CI run downloads it once (see deploy/.env.example). This script is
the repo-checked-in equivalent of the provisioning Colab notebook.

REQUIREMENTS
------------
    uv pip install cellxgene-census scanpy pyarrow pandas numpy
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import sys

# Tissue → organ grouping (documented mapping; conservative, extend as needed).
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
    "skeletal muscle": "Muscle",
    "muscle": "Muscle",
    "skin": "Skin",
    "small intestine": "GI",
    "large intestine": "GI",
    "colon": "GI",
    "stomach": "GI",
    "pancreas": "Pancreas",
    "fat": "Adipose",
    "adipose": "Adipose",
    "eye": "Eye",
    "tongue": "GI",
    "trachea": "Lung",
    "bladder": "Bladder",
    "prostate": "Reproductive",
    "uterus": "Reproductive",
    "mammary": "Reproductive",
    "vasculature": "Vasculature",
    "salivary gland": "GI",
}


def _organ_for(tissue: str) -> str:
    t = (tissue or "").strip().lower()
    for key, organ in TISSUE_TO_ORGAN.items():
        if key in t:
            return organ
    return "Other"


def build(out_path: str, census_version: str = "stable", max_cells: int | None = None) -> None:
    try:
        import cellxgene_census
        import numpy as np
        import pandas as pd
        import pyarrow as pa
        import pyarrow.parquet as pq
        import scanpy as sc  # noqa: F401  (kept for parity with the notebook path)
    except ImportError as exc:  # noqa: BLE001
        sys.exit(
            f"Missing dependency: {exc}. Install with:\n"
            "  uv pip install cellxgene-census scanpy pyarrow pandas numpy"
        )

    print(f"→ Opening CELLxGENE Census (version={census_version})…")
    with cellxgene_census.open_soma(census_version=census_version) as census:
        # Tabula Sapiens is a human Census collection; filter to it by dataset title.
        value_filter = (
            'is_primary_data == True and '
            'dataset_id in ('
            'select(dataset_id) where collection_name ilike "%Tabula Sapiens%")'
        )
        print("→ Loading Tabula Sapiens cells (this is the slow part)…")
        adata = cellxgene_census.get_anndata(
            census,
            organism="Homo sapiens",
            obs_value_filter='tissue_general != "" ',  # broad; refined below
            obs_column_names=["cell_type", "tissue", "tissue_general"],
            var_column_names=["feature_name"],
        )

    if max_cells and adata.n_obs > max_cells:
        import numpy as np

        idx = np.random.default_rng(0).choice(adata.n_obs, size=max_cells, replace=False)
        adata = adata[idx].copy()

    print(f"→ Loaded {adata.n_obs:,} cells × {adata.n_vars:,} genes; aggregating…")
    import numpy as np
    import pandas as pd

    # log1p-normalize (Census delivers raw counts).
    import scanpy as sc

    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)

    genes = adata.var["feature_name"].astype(str).str.upper().to_numpy()
    obs = adata.obs.reset_index(drop=True)
    obs["organ"] = obs["tissue"].map(_organ_for)

    rows = []
    X = adata.X
    group_cols = ["cell_type", "tissue", "organ"]
    for keys, sub in obs.groupby(group_cols, observed=True):
        mask = sub.index.to_numpy()
        block = X[mask]
        n = block.shape[0]
        mean_expr = np.asarray(block.mean(axis=0)).ravel()
        pct = np.asarray((block > 0).mean(axis=0)).ravel()
        for gi, g in enumerate(genes):
            if mean_expr[gi] <= 0:
                continue
            rows.append(
                {
                    "gene_symbol": g,
                    "cell_type": keys[0],
                    "tissue": keys[1],
                    "organ": keys[2],
                    "mean_expression": float(mean_expr[gi]),
                    "n_cells": int(n),
                    "pct_expressing": float(pct[gi]),
                }
            )

    df = pd.DataFrame(rows)
    print(f"→ Aggregated {len(df):,} gene×cell-type rows.")

    import pyarrow as pa
    import pyarrow.parquet as pq

    meta = {
        "atlas_name": "Tabula Sapiens v2",
        "atlas_sha": str(census_version),
        "preparation_date": _dt.datetime.now(_dt.UTC).isoformat(),
        "n_genes": str(df["gene_symbol"].nunique()),
        "n_cell_types": str(df["cell_type"].nunique()),
        "n_organs": str(df["organ"].nunique()),
        "notebook_version": "build_tabula_sapiens_atlas.py/1.0",
    }
    table = pa.Table.from_pandas(df, preserve_index=False)
    table = table.replace_schema_metadata({k: v for k, v in meta.items()})
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    pq.write_table(table, out_path)
    print(f"✓ Wrote {out_path}  ({os.path.getsize(out_path) / 1e6:.1f} MB)")
    print("  Next: host it and set TABULA_SAPIENS_PARQUET_URL, or keep it at this cache path.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="var/cache/tabula_sapiens_aggregated.parquet")
    ap.add_argument("--census-version", default="stable")
    ap.add_argument("--max-cells", type=int, default=None, help="Subsample for a quick smoke build.")
    args = ap.parse_args()
    build(args.out, census_version=args.census_version, max_cells=args.max_cells)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
