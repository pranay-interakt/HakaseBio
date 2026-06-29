"""Layer 3 Stage 4 — Patient-line projection (DepMap PRISM 24Q2, oncology only).

PROVISIONING MODEL (mirrors Stage 3 / celltype_aggregation.py exactly):
  The DepMap PRISM 24Q2 cell-line metadata table (per-cell-line target essentiality
  + expression for every cancer-related target gene) is preprocessed OFF-PLATFORM
  in Google Colab via `colab_notebooks/prepare_depmap_prism.ipynb`, then the
  resulting Parquet artifact is uploaded to
  `artifacts/ai-service/cache/depmap_prism_aggregated.parquet`.

  Until that artifact is uploaded the endpoint refuses to fabricate a result and
  instead returns an explicit `data-not-provisioned` payload so callers can
  surface the gap honestly. This mirrors the project-wide policy: NO fake data,
  NO assumptions, NO silent fallbacks.

ALGORITHM (when snapshot is present):
  This is NOT a Chemprop-style trained GBM (the user-facing copy used to claim
  that and was downgraded to honesty in the v2 spec pass). It is an in-house
  deterministic projection of the L1 IC50 across the DepMap PRISM oncology cell
  panel, conditioned on per-cell-line target essentiality and expression:

    for each cell_line C carrying the query gene:
      essentiality = chronos_score(query_gene, C)   # < 0 → essential
      expression   = log2_tpm(query_gene, C)         # >= 0

      if expression < EXPRESSION_FLOOR (no target → drug can't act):
        mark resistant_no_target, predicted_IC50 = NaN, modifier = NaN
      else:
        modifier = 2 ** (alpha * essentiality)        # essential → modifier < 1 → more sensitive
        predicted_IC50_uM = L1_IC50_uM * modifier

  Default alpha = 1.0 (one essentiality-unit ≈ 2× shift in predicted IC50).
  Cell lines are returned ranked sensitive → resistant. Optional `indication_keyword`
  (case-insensitive substring match against `primary_disease` and `lineage`) narrows
  the panel.

OUT-OF-DOMAIN CONTRACT:
  The caller must declare `oncology=True`. If False the endpoint returns
  `source = "out-of-domain"` with HTTP 400 — this readout is for oncology
  programs only by design (HCMI + DepMap are oncology resources). Non-oncology
  compounds should mark Stage 4 as `not_applicable` via the Manual Entry path,
  NOT via this ML endpoint.
"""

from __future__ import annotations

import math
import os
import threading
from dataclasses import dataclass, field
from typing import Any

import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
_CACHE_DIR = os.path.normpath(os.path.join(_HERE, "..", "cache"))
SNAPSHOT_PATH = os.path.join(_CACHE_DIR, "depmap_prism_aggregated.parquet")
SNAPSHOT_README_PATH = os.path.join(_CACHE_DIR, "depmap_prism_aggregated.README.md")

REQUIRED_COLUMNS = (
    "depmap_id",                  # str — ACH-NNNNNN
    "cell_line_name",             # str — stripped name (CCLE_Name without lineage suffix)
    "primary_disease",            # str — e.g. "Acute Myeloid Leukemia"
    "lineage",                    # str — e.g. "myeloid"
    "target_gene_symbol",         # str — HUGO uppercase
    "target_essentiality_chronos",# float — DepMap CRISPR Chronos gene effect (<0 essential, ~0 neutral, >0 anti)
    "target_expression_log2_tpm", # float — CCLE expression in log2(TPM+1)
)

PROVENANCE_KEYS = (
    "snapshot_name",      # e.g. "DepMap PRISM 24Q2"
    "snapshot_release",   # release tag (e.g. "24Q2")
    "preparation_date",   # ISO timestamp from the notebook
    "n_cell_lines",       # str int
    "n_target_genes",     # str int
    "n_oncology_lineages",# str int
    "notebook_version",   # version tag from the notebook
)

# --- Algorithm tuning -------------------------------------------------------
EXPRESSION_FLOOR_LOG2_TPM = 1.0   # expression < this → no target → resistant_no_target
DEFAULT_ALPHA = 1.0               # one essentiality unit ≈ 2× shift in predicted IC50
MIN_ALPHA, MAX_ALPHA = 0.1, 5.0   # caller-tunable bounds


@dataclass
class _SnapshotState:
    df: pd.DataFrame | None = None
    by_gene: dict[str, pd.DataFrame] = field(default_factory=dict)
    provenance: dict[str, str] = field(default_factory=dict)
    load_error: str | None = None
    loaded_at: str | None = None


_state = _SnapshotState()
_state_lock = threading.Lock()


def _load_snapshot() -> _SnapshotState:
    """Load the prepared Parquet on first access. Idempotent; thread-safe."""
    if _state.df is not None or _state.load_error is not None:
        return _state
    with _state_lock:
        if _state.df is not None or _state.load_error is not None:
            return _state
        if not os.path.exists(SNAPSHOT_PATH):
            _state.load_error = (
                f"DepMap PRISM 24Q2 snapshot Parquet not present at {SNAPSHOT_PATH}. "
                "Run colab_notebooks/prepare_depmap_prism.ipynb on Colab and upload "
                "the resulting artifact. NO synthetic fallback is provided."
            )
            return _state
        try:
            import pyarrow.parquet as pq
            tbl = pq.read_table(SNAPSHOT_PATH)
            df = tbl.to_pandas()
            missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
            if missing:
                _state.load_error = (
                    f"Snapshot Parquet at {SNAPSHOT_PATH} is missing required columns: {missing}. "
                    "Re-run the Colab notebook and re-upload."
                )
                return _state
            df["target_gene_symbol"] = df["target_gene_symbol"].astype(str).str.upper()
            df["depmap_id"] = df["depmap_id"].astype(str).str.upper()
            _state.df = df
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
            _state.load_error = f"Failed to load snapshot Parquet: {type(e).__name__}: {e}"
        return _state


def is_ready() -> dict[str, Any]:
    """Status hook — used by /models/status. Does NOT trigger a load."""
    if _state.df is not None:
        return {
            "loaded": True,
            "snapshot_path": SNAPSHOT_PATH,
            "rows": int(len(_state.df)),
            "loaded_at": _state.loaded_at,
            "provenance": _state.provenance,
        }
    return {
        "loaded": False,
        "snapshot_path": SNAPSHOT_PATH,
        "exists_on_disk": os.path.exists(SNAPSHOT_PATH),
        "load_error": _state.load_error,
    }


def warmup() -> dict[str, Any]:
    """Force-load the snapshot (used at boot + by /models/warmup)."""
    _load_snapshot()
    return is_ready()


def predict_patient_line(
    target_gene_symbol: str,
    l1_ic50_nM: float,
    oncology: bool,
    indication_keyword: str | None = None,
    alpha: float = DEFAULT_ALPHA,
    top_n: int = 25,
) -> dict[str, Any]:
    """Project the L1 IC50 across the DepMap PRISM oncology cell panel.

    Returns the canonical envelope:
      success           → {source: "ml", ml_available: True, prediction: {...}, model_info: {...}}
      snapshot missing  → HTTP 503 raised by main.py based on `source == "data-not-provisioned"`
      non-oncology call → HTTP 400 raised by main.py based on `source == "out-of-domain"`
      input bad         → HTTP 400 raised by main.py based on `source == "input-error"`
    """
    # ---- input validation (refuse silent coercion) ----
    gene = (target_gene_symbol or "").strip().upper()
    if not gene:
        return {
            "source": "input-error",
            "ml_available": False,
            "error": "target_gene_symbol is required (HUGO symbol).",
        }
    try:
        ic50 = float(l1_ic50_nM)
    except (TypeError, ValueError):
        return {
            "source": "input-error",
            "ml_available": False,
            "error": "l1_ic50_nM must be a number (nanomolar).",
        }
    if not (math.isfinite(ic50) and ic50 > 0):
        return {
            "source": "input-error",
            "ml_available": False,
            "error": f"l1_ic50_nM must be a positive finite number; got {l1_ic50_nM}.",
        }
    if not oncology:
        return {
            "source": "out-of-domain",
            "ml_available": False,
            "error": (
                "Patient-line projection is oncology-only by design (HCMI + DepMap PRISM "
                "are oncology resources). Mark this readout as not_applicable via the "
                "Stage 4 Manual Entry path for non-oncology compounds."
            ),
        }
    try:
        alpha_f = float(alpha)
    except (TypeError, ValueError):
        alpha_f = DEFAULT_ALPHA
    alpha_f = max(MIN_ALPHA, min(alpha_f, MAX_ALPHA))
    top_n = max(1, min(int(top_n), 500))

    # ---- snapshot load ----
    state = _load_snapshot()
    if state.df is None:
        return {
            "source": "data-not-provisioned",
            "ml_available": False,
            "error": state.load_error,
            "snapshot_path": SNAPSHOT_PATH,
            "remediation": (
                "Run colab_notebooks/prepare_depmap_prism.ipynb on Colab "
                "(high-RAM runtime), then upload the resulting Parquet to "
                "artifacts/ai-service/cache/depmap_prism_aggregated.parquet."
            ),
        }

    df = state.df

    # ---- gene-in-domain check ----
    sub = df[df["target_gene_symbol"] == gene]
    if len(sub) == 0:
        return {
            "source": "out-of-domain",
            "ml_available": True,
            "error": (
                f"Target gene {gene} is not present in the DepMap PRISM 24Q2 snapshot's "
                "per-cell-line essentiality + expression matrix. Either the gene is "
                "outside the prepared target set or it is not assayed in DepMap CRISPR."
            ),
            "targets_out_of_domain": [gene],
            "model_info": {
                "engine": "patient-line-projection v1",
                "snapshot": state.provenance.get("snapshot_name", "DepMap PRISM 24Q2"),
            },
        }

    # ---- optional indication keyword filter ----
    indication_kw = (indication_keyword or "").strip().lower()
    panel = sub.copy()
    if indication_kw:
        mask = (
            panel["primary_disease"].astype(str).str.lower().str.contains(indication_kw, na=False)
            | panel["lineage"].astype(str).str.lower().str.contains(indication_kw, na=False)
        )
        panel = panel[mask]
        if len(panel) == 0:
            return {
                "source": "out-of-domain",
                "ml_available": True,
                "error": (
                    f"No DepMap PRISM cell lines match indication_keyword='{indication_keyword}' "
                    f"for target {gene}. Drop the filter or pick a broader lineage label."
                ),
                "targets_out_of_domain": [],
                "model_info": {
                    "engine": "patient-line-projection v1",
                    "snapshot": state.provenance.get("snapshot_name", "DepMap PRISM 24Q2"),
                },
            }

    # ---- per-cell-line projection ----
    ic50_uM = ic50 / 1000.0
    rows: list[dict[str, Any]] = []
    n_resistant_no_target = 0
    for _, r in panel.iterrows():
        try:
            essentiality = float(r["target_essentiality_chronos"])
            expression = float(r["target_expression_log2_tpm"])
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(essentiality) and math.isfinite(expression)):
            continue

        if expression < EXPRESSION_FLOOR_LOG2_TPM:
            n_resistant_no_target += 1
            rows.append({
                "depmap_id": str(r["depmap_id"]),
                "cell_line_name": str(r["cell_line_name"]),
                "primary_disease": str(r["primary_disease"]),
                "lineage": str(r["lineage"]),
                "essentiality_chronos": essentiality,
                "expression_log2_tpm": expression,
                "modifier": None,
                "predicted_IC50_uM": None,
                "category": "resistant_no_target",
            })
            continue

        modifier = float(2.0 ** (alpha_f * essentiality))
        predicted = ic50_uM * modifier
        # Sensitivity bands (relative to L1 IC50)
        if modifier < 0.5:
            band = "highly_sensitive"
        elif modifier < 0.85:
            band = "sensitive"
        elif modifier <= 1.2:
            band = "near_baseline"
        else:
            band = "resistant"
        rows.append({
            "depmap_id": str(r["depmap_id"]),
            "cell_line_name": str(r["cell_line_name"]),
            "primary_disease": str(r["primary_disease"]),
            "lineage": str(r["lineage"]),
            "essentiality_chronos": essentiality,
            "expression_log2_tpm": expression,
            "modifier": modifier,
            "predicted_IC50_uM": predicted,
            "category": band,
        })

    # ---- ranking (sensitive → resistant; resistant_no_target sinks to bottom) ----
    def _sort_key(r: dict[str, Any]) -> tuple[int, float]:
        if r["predicted_IC50_uM"] is None:
            return (1, math.inf)
        return (0, float(r["predicted_IC50_uM"]))
    rows.sort(key=_sort_key)

    top_rows = rows[:top_n]
    bottom_rows = [r for r in rows if r["predicted_IC50_uM"] is not None][-top_n:][::-1]

    # ---- distribution summary ----
    finite_ic50s = [r["predicted_IC50_uM"] for r in rows if r["predicted_IC50_uM"] is not None]
    if finite_ic50s:
        finite_ic50s_sorted = sorted(finite_ic50s)

        def _pct(p: float) -> float:
            idx = max(0, min(len(finite_ic50s_sorted) - 1, int(round(p * (len(finite_ic50s_sorted) - 1)))))
            return float(finite_ic50s_sorted[idx])

        distribution = {
            "n": len(finite_ic50s),
            "median_uM": _pct(0.5),
            "p10_uM": _pct(0.1),
            "p90_uM": _pct(0.9),
            "min_uM": float(min(finite_ic50s)),
            "max_uM": float(max(finite_ic50s)),
        }
    else:
        distribution = {
            "n": 0, "median_uM": None, "p10_uM": None, "p90_uM": None,
            "min_uM": None, "max_uM": None,
        }

    # ---- per-lineage rollup ----
    lineage_rollup: list[dict[str, Any]] = []
    grouped = (
        pd.DataFrame([r for r in rows if r["predicted_IC50_uM"] is not None])
        .groupby("lineage", dropna=False, observed=True)
        if any(r["predicted_IC50_uM"] is not None for r in rows)
        else None
    )
    if grouped is not None:
        for lineage_name, g in grouped:
            lineage_rollup.append({
                "lineage": str(lineage_name),
                "n_cell_lines": int(len(g)),
                "median_predicted_IC50_uM": float(g["predicted_IC50_uM"].median()),
                "n_highly_sensitive": int((g["category"] == "highly_sensitive").sum()),
                "n_sensitive": int((g["category"] == "sensitive").sum()),
                "n_near_baseline": int((g["category"] == "near_baseline").sum()),
                "n_resistant": int((g["category"] == "resistant").sum()),
            })
        lineage_rollup.sort(key=lambda r: r["median_predicted_IC50_uM"])

    return {
        "source": "ml",
        "ml_available": True,
        "prediction": {
            "query_gene_symbol": gene,
            "l1_ic50_nM": ic50,
            "alpha": alpha_f,
            "indication_keyword": indication_keyword or None,
            "n_cell_lines_total": int(len(panel)),
            "n_resistant_no_target": n_resistant_no_target,
            "distribution": distribution,
            "top_sensitive_lines": top_rows,
            "bottom_resistant_lines": bottom_rows,
            "per_lineage": lineage_rollup,
        },
        "model_info": {
            "engine": "patient-line-projection v1",
            "method": (
                "predicted_IC50_uM(C) = L1_IC50_uM × 2^(alpha · chronos_essentiality(C, gene)); "
                "expression < 1.0 log2(TPM+1) → marked resistant_no_target. "
                "In-house deterministic projection — NOT a trained Chemprop GBM."
            ),
            "scope_caveat": (
                "Cascade flag: prediction_only. Projection of the L1 surrogate IC50 across "
                "the PRISM oncology panel conditioned on per-cell-line target essentiality + "
                "expression. Wet PRISM measurement (T2/T3) required for IND-supporting claims. "
                "Out-of-domain for non-oncology compounds — caller must declare oncology=True."
            ),
            "snapshot": {
                "name": state.provenance.get("snapshot_name", "DepMap PRISM 24Q2"),
                "release": state.provenance.get("snapshot_release"),
                "preparation_date": state.provenance.get("preparation_date"),
                "n_cell_lines": state.provenance.get("n_cell_lines"),
                "n_target_genes": state.provenance.get("n_target_genes"),
                "n_oncology_lineages": state.provenance.get("n_oncology_lineages"),
                "notebook_version": state.provenance.get("notebook_version"),
                "loaded_at": state.loaded_at,
            },
            "license": (
                "DepMap PRISM 24Q2 (Broad Institute, CC-BY 4.0). "
                "HCMI metadata via NCI / ATCC (CC-BY 4.0)."
            ),
        },
    }
