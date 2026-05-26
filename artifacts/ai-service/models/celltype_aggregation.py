"""Layer 3 Stage 3 — Cell-type aggregation (Drug2cell pattern + Tabula Sapiens v2).

PROVISIONING MODEL (Hybrid Phase 2 / 3):
  The expression atlas (Tabula Sapiens v2 aggregated to (cell_type, tissue, gene_symbol))
  is preprocessed OFF-PLATFORM in Google Colab via
  `colab_notebooks/prepare_tabula_sapiens.ipynb`, then the resulting Parquet artifact
  is uploaded to `artifacts/ai-service/cache/tabula_sapiens_aggregated.parquet`.

  Until that artifact is uploaded the endpoint refuses to fabricate a result and instead
  returns an explicit `data-not-provisioned` payload so callers can surface the gap
  honestly. This mirrors the project-wide policy: NO fake data, NO assumptions,
  NO silent fallbacks.

ALGORITHM (when atlas is present):
  Drug2cell-style scoring (Kanemaru et al. 2023, Teichmann lab):
    For a drug with one or more targets {gene_i} (each carrying an optional
    affinity weight w_i derived from L1 pKi, defaulting to uniform 1.0):
      score(cell_type, tissue) = Σ_i  w_i · mean_log1p_expression(gene_i, cell_type, tissue)
    Rows are returned ranked by score; an aggregate organ-level score is also produced
    via mean over the cell-types within each organ.

  Targets that do NOT appear in the Tabula Sapiens v2 expression matrix are reported
  back to the caller in a `targets_out_of_domain` list — they are NOT silently
  dropped and they are NOT given a synthetic baseline expression value.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

# ─── Module location & atlas path ──────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_CACHE_DIR = os.path.normpath(os.path.join(_HERE, "..", "cache"))
ATLAS_PATH = os.path.join(_CACHE_DIR, "tabula_sapiens_aggregated.parquet")
ATLAS_README_PATH = os.path.join(_CACHE_DIR, "tabula_sapiens_aggregated.README.md")

# Required columns the prepared Parquet must carry. Documented in the Colab notebook.
REQUIRED_COLUMNS = (
    "gene_symbol",     # str — HUGO gene symbol (uppercase)
    "cell_type",       # str — cell_ontology_class label
    "tissue",          # str — tissue_in_publication / tissue label
    "organ",           # str — organ-level grouping (mapped from tissue, see Colab notebook)
    "mean_expression", # float — mean of log1p(normalized counts) across cells of that group
    "n_cells",         # int   — number of cells contributing to the group
    "pct_expressing",  # float — fraction of cells in the group with expression > 0 (0..1)
)

# Atlas provenance fields the Parquet carries via pyarrow metadata so we can echo them
# back honestly (dataset SHA, build date, gene + cell-type + organ counts).
PROVENANCE_KEYS = (
    "atlas_name",       # e.g. "Tabula Sapiens v2"
    "atlas_sha",        # CELLxGENE Census collection SHA / dataset version
    "preparation_date", # ISO timestamp from the notebook
    "n_genes",          # str int
    "n_cell_types",     # str int
    "n_organs",         # str int
    "notebook_version", # version tag from the notebook
)


@dataclass
class _AtlasState:
    """Singleton state for the lazily-loaded atlas."""
    df: pd.DataFrame | None = None
    by_gene: dict[str, pd.DataFrame] = field(default_factory=dict)  # cached per-gene slices
    provenance: dict[str, str] = field(default_factory=dict)
    load_error: str | None = None
    loaded_at: str | None = None


_state = _AtlasState()
_state_lock = threading.Lock()


def _load_atlas() -> _AtlasState:
    """Load the prepared Parquet on first access. Idempotent; thread-safe."""
    if _state.df is not None or _state.load_error is not None:
        return _state
    with _state_lock:
        if _state.df is not None or _state.load_error is not None:
            return _state
        if not os.path.exists(ATLAS_PATH):
            _state.load_error = (
                f"Tabula Sapiens v2 aggregation Parquet not present at {ATLAS_PATH}. "
                "Run colab_notebooks/prepare_tabula_sapiens.ipynb on Colab and upload "
                "the resulting artifact. NO synthetic fallback is provided."
            )
            return _state
        try:
            import pyarrow.parquet as pq
            tbl = pq.read_table(ATLAS_PATH)
            df = tbl.to_pandas()
            missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
            if missing:
                _state.load_error = (
                    f"Atlas Parquet at {ATLAS_PATH} is missing required columns: {missing}. "
                    "Re-run the Colab notebook and re-upload."
                )
                return _state
            df["gene_symbol"] = df["gene_symbol"].astype(str).str.upper()
            _state.df = df
            # Pyarrow file metadata may carry provenance the notebook attached
            try:
                meta = tbl.schema.metadata or {}
                prov = {}
                for k in PROVENANCE_KEYS:
                    bk = k.encode() if isinstance(k, str) else k
                    if bk in meta:
                        prov[k] = meta[bk].decode()
                _state.provenance = prov
            except Exception:
                _state.provenance = {}
            from datetime import datetime, timezone
            _state.loaded_at = datetime.now(timezone.utc).isoformat()
        except Exception as e:
            _state.load_error = f"Failed to load atlas Parquet: {type(e).__name__}: {e}"
        return _state


def is_ready() -> dict[str, Any]:
    """Status hook — used by /models/status. Does NOT trigger a load."""
    if _state.df is not None:
        return {
            "loaded": True,
            "atlas_path": ATLAS_PATH,
            "rows": int(len(_state.df)),
            "loaded_at": _state.loaded_at,
            "provenance": _state.provenance,
        }
    return {
        "loaded": False,
        "atlas_path": ATLAS_PATH,
        "exists_on_disk": os.path.exists(ATLAS_PATH),
        "load_error": _state.load_error,
    }


def warmup() -> dict[str, Any]:
    """Force-load the atlas (used at boot + by /models/warmup)."""
    _load_atlas()
    return is_ready()


@dataclass
class TargetSpec:
    """A drug target as supplied by the caller."""
    gene_symbol: str
    affinity_pKi: float | None = None  # if provided, used as weight (max-min normalized across targets)


def _normalize_weights(targets: list[TargetSpec]) -> tuple[list[tuple[str, float]], str]:
    """Return [(gene, weight), ...] plus the weighting-mode string used."""
    pkis = [t.affinity_pKi for t in targets if t.affinity_pKi is not None]
    if pkis and len(pkis) == len(targets):
        # Min-max normalize across the supplied targets so the highest-affinity gets weight 1.0
        # and the lowest gets a small floor (0.1 — not zero, so a weak target still contributes).
        lo, hi = min(pkis), max(pkis)
        if hi - lo < 1e-6:
            return [(t.gene_symbol.upper(), 1.0) for t in targets], "uniform-equal-pKi"
        floor = 0.1
        weights = [
            (t.gene_symbol.upper(), floor + (1.0 - floor) * (t.affinity_pKi - lo) / (hi - lo))
            for t in targets
        ]
        return weights, "pKi-min-max-normalized"
    if pkis:
        # Partial — refuse to silently mix uniform + pKi
        return [(t.gene_symbol.upper(), 1.0) for t in targets], "uniform-partial-pKi-rejected"
    return [(t.gene_symbol.upper(), 1.0) for t in targets], "uniform"


def predict_celltype_aggregation(
    targets: list[dict[str, Any]],
    top_n: int = 25,
) -> dict[str, Any]:
    """Score each (cell_type, tissue) by Drug2cell-style weighted gene expression.

    Args:
      targets: list of {gene_symbol: str, affinity_pKi?: float}
      top_n:   how many top rows to return (clipped to [1, 500])

    Returns the canonical envelope:
      success → {source: "ml", ml_available: True, prediction: {...}, model_info: {...}}
      atlas missing → HTTP 503 raised by main.py based on `source == "data-not-provisioned"`
    """
    if not targets:
        return {
            "source": "input-error",
            "ml_available": False,
            "error": "At least one target {gene_symbol} required.",
        }

    # Validate target shape early — refuse silent coercion
    parsed: list[TargetSpec] = []
    for i, t in enumerate(targets):
        if not isinstance(t, dict) or "gene_symbol" not in t or not str(t["gene_symbol"]).strip():
            return {
                "source": "input-error",
                "ml_available": False,
                "error": f"targets[{i}] is missing a non-empty gene_symbol.",
            }
        affinity = t.get("affinity_pKi")
        if affinity is not None:
            try:
                affinity = float(affinity)
                if not (0.0 < affinity < 20.0):
                    return {
                        "source": "input-error",
                        "ml_available": False,
                        "error": f"targets[{i}].affinity_pKi must be in (0, 20).",
                    }
            except (TypeError, ValueError):
                return {
                    "source": "input-error",
                    "ml_available": False,
                    "error": f"targets[{i}].affinity_pKi must be a number if provided.",
                }
        parsed.append(TargetSpec(gene_symbol=str(t["gene_symbol"]).strip().upper(), affinity_pKi=affinity))

    top_n = max(1, min(int(top_n), 500))

    state = _load_atlas()
    if state.df is None:
        return {
            "source": "data-not-provisioned",
            "ml_available": False,
            "error": state.load_error,
            "atlas_path": ATLAS_PATH,
            "remediation": (
                "Run colab_notebooks/prepare_tabula_sapiens.ipynb on Colab "
                "(GPU/high-RAM runtime), then upload the resulting Parquet to "
                "artifacts/ai-service/cache/tabula_sapiens_aggregated.parquet."
            ),
        }

    df = state.df
    weights, weighting_mode = _normalize_weights(parsed)

    # Per-gene slices: filter atlas rows to only the target genes
    target_genes = [g for g, _ in weights]
    in_domain_genes = [g for g in target_genes if (df["gene_symbol"] == g).any()]
    out_of_domain = [g for g in target_genes if g not in in_domain_genes]

    if not in_domain_genes:
        return {
            "source": "out-of-domain",
            "ml_available": True,
            "error": "None of the supplied targets are present in the Tabula Sapiens v2 expression matrix.",
            "targets_out_of_domain": out_of_domain,
            "model_info": {
                "engine": "celltype-aggregation v1",
                "atlas": state.provenance.get("atlas_name", "Tabula Sapiens v2"),
            },
        }

    # Build a working DataFrame restricted to in-domain target genes
    sub = df[df["gene_symbol"].isin(in_domain_genes)].copy()
    weight_map = {g: w for g, w in weights if g in in_domain_genes}
    sub["weighted_expression"] = sub["mean_expression"] * sub["gene_symbol"].map(weight_map)

    # Per (cell_type, tissue, organ) aggregate score
    per_celltype = (
        sub.groupby(["cell_type", "tissue", "organ"], dropna=False, observed=True)
        .agg(
            score=("weighted_expression", "sum"),
            mean_expression_unweighted=("mean_expression", "sum"),
            n_cells=("n_cells", "min"),  # lower-bound cell count among the contributing genes
            pct_expressing_mean=("pct_expressing", "mean"),
            n_target_genes_present=("gene_symbol", "nunique"),
        )
        .reset_index()
        .sort_values("score", ascending=False)
    )

    # Per organ aggregate (mean of per-cell-type score within each organ)
    per_organ = (
        per_celltype.groupby("organ", dropna=False, observed=True)
        .agg(
            organ_score=("score", "mean"),
            n_cell_types=("cell_type", "nunique"),
            top_cell_type=("cell_type", "first"),  # because sorted by score desc
        )
        .reset_index()
        .sort_values("organ_score", ascending=False)
    )

    # Tail rows (ascending — useful for a "tissues with lowest off-target expression" view
    # that the L3 surrogate uses when reasoning about therapeutic-window tissues).
    bottom_celltype = per_celltype.sort_values("score", ascending=True).head(top_n)

    def _row(r: pd.Series) -> dict[str, Any]:
        return {
            "cell_type": str(r["cell_type"]),
            "tissue": str(r["tissue"]),
            "organ": str(r["organ"]),
            "score": float(r["score"]),
            "mean_expression_unweighted": float(r["mean_expression_unweighted"]),
            "n_cells": int(r["n_cells"]) if pd.notna(r["n_cells"]) else 0,
            "pct_expressing_mean": float(r["pct_expressing_mean"]),
            "n_target_genes_present": int(r["n_target_genes_present"]),
        }

    top_rows = [_row(r) for _, r in per_celltype.head(top_n).iterrows()]
    bottom_rows = [_row(r) for _, r in bottom_celltype.iterrows()]
    organs = [
        {
            "organ": str(r["organ"]),
            "organ_score": float(r["organ_score"]),
            "n_cell_types": int(r["n_cell_types"]),
            "top_cell_type": str(r["top_cell_type"]),
        }
        for _, r in per_organ.iterrows()
    ]

    return {
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "top_cell_types": top_rows,
            "bottom_cell_types": bottom_rows,
            "per_organ": organs,
            "targets_in_domain": in_domain_genes,
            "targets_out_of_domain": out_of_domain,
            "weights": [{"gene_symbol": g, "weight": w} for g, w in weights],
            "weighting_mode": weighting_mode,
        },
        "model_info": {
            "engine": "celltype-aggregation v1 (Drug2cell pattern)",
            "method": (
                "score(cell_type, tissue) = Σ_i w_i · mean_log1p_expression(gene_i, cell_type, tissue) "
                "where w_i is the min-max normalized pKi of target_i (or uniform 1.0 if pKi absent)."
            ),
            "scope_caveat": (
                "Aggregates pre-computed expression × affinity. Does NOT predict tissue-specific "
                "drug exposure (that comes from L2 PBPK / L3 Stage 1 tissue selectivity), nor "
                "phenotypic organoid response (T2 wet-data territory)."
            ),
            "atlas": {
                "name": state.provenance.get("atlas_name", "Tabula Sapiens v2"),
                "sha": state.provenance.get("atlas_sha"),
                "preparation_date": state.provenance.get("preparation_date"),
                "n_genes": state.provenance.get("n_genes"),
                "n_cell_types": state.provenance.get("n_cell_types"),
                "n_organs": state.provenance.get("n_organs"),
                "notebook_version": state.provenance.get("notebook_version"),
                "loaded_at": state.loaded_at,
            },
            "license": "Drug2cell (MIT, Teichmann lab); Tabula Sapiens v2 (CC-BY 4.0).",
        },
    }
