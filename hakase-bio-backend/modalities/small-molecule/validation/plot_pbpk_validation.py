"""Render the standard IVIVE predicted-vs-observed clearance plot from a gate
report (log-log, unity line, 2x / 3x fold bands). Purely a reporting aid — it
reads a report JSON produced by run_pbpk_validation.py and writes a PNG next to
it.

Usage:
    python plot_pbpk_validation.py <report.json> [out.png]
"""

import glob
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

REPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")


def _latest_report() -> str:
    reports = sorted(glob.glob(os.path.join(REPORT_DIR, "pbpk_validation_*.json")))
    if not reports:
        raise SystemExit("No report found. Run run_pbpk_validation.py first.")
    return reports[-1]


def plot(report_path: str, out_path: str | None = None) -> str:
    with open(report_path) as f:
        rep = json.load(f)
    rows = [r for r in rep["raw_results"] if r["true_cl"] and r["pred_cl"]]
    obs = np.array([r["true_cl"] for r in rows], dtype=float)
    pred = np.array([r["pred_cl"] for r in rows], dtype=float)
    lo = np.array([r["pred_cl_low"] for r in rows], dtype=float)
    hi = np.array([r["pred_cl_high"] for r in rows], dtype=float)

    m = rep["metrics"]["Clearance"]
    fig, ax = plt.subplots(figsize=(7.2, 7.0))

    axis_lo = min(obs.min(), pred.min(), lo.min()) * 0.6
    axis_hi = max(obs.max(), pred.max(), hi.max()) * 1.6
    grid = np.array([axis_lo, axis_hi])

    # Fold bands: 3x (light), 2x (darker), unity line.
    ax.fill_between(grid, grid / 3, grid * 3, color="0.85", label="within 3×")
    ax.fill_between(grid, grid / 2, grid * 2, color="0.72", label="within 2×")
    ax.plot(grid, grid, "k-", lw=1, label="unity")

    # 90% predicted intervals as vertical bars.
    ax.vlines(obs, lo, hi, color="steelblue", alpha=0.35, lw=1)
    ax.scatter(obs, pred, s=42, color="steelblue", edgecolor="k", linewidth=0.5, zorder=5)

    for r, x, y in zip(rows, obs, pred):
        fold = max(y / x, x / y)
        if fold >= 3:  # annotate only the notable misses to avoid clutter
            ax.annotate(
                r["name"],
                (x, y),
                fontsize=7.5,
                xytext=(4, 4),
                textcoords="offset points",
                color="firebrick",
            )

    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlim(axis_lo, axis_hi)
    ax.set_ylim(axis_lo, axis_hi)
    ax.set_xlabel("Observed CL (mL/min/kg)")
    ax.set_ylabel("Predicted CL (mL/min/kg)")
    n = rep["n_scored_per_endpoint"]["Clearance"]
    ctrl = rep["permutation_control"]["Clearance"]
    cal = rep.get("calibrated_coverage", {}).get("Clearance")
    cov_str = (
        f"calibrated coverage {cal['coverage']:.0%} (nominal {cal['nominal']:.0%}, "
        f"±{cal['median_halfwidth_fold']:.1f}×)"
        if cal
        else f"coverage {m['coverage']:.0%}"
    )
    ax.set_title(
        f"Rat PBPK exposure gate — clearance (n={n})\n"
        f"median fold {m['median_fold_error']:.2f}× · "
        f"within 3× {m['within_3x']:.0%} (chance {ctrl['within_3x']:.0%}) · "
        f"{cov_str}",
        fontsize=9.5,
    )
    ax.legend(loc="lower right", fontsize=8, framealpha=0.9)
    ax.set_aspect("equal")
    fig.tight_layout()

    if out_path is None:
        out_path = report_path.rsplit(".", 1)[0] + ".png"
    fig.savefig(out_path, dpi=150)
    print(f"Wrote {out_path}")
    return out_path


if __name__ == "__main__":
    report = sys.argv[1] if len(sys.argv) > 1 else _latest_report()
    out = sys.argv[2] if len(sys.argv) > 2 else None
    plot(report, out)
