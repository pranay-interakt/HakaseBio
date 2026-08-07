import argparse
import json
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "platform", "kernel", "src")
    ),
)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from hakase_kernel.pbpk.absorption import IVBolus
from hakase_kernel.pbpk.cohort import run_virtual_cohort
from hakase_kernel.pbpk.contract import ApplicabilityDomain
from hakase_kernel.pbpk.model import clearance_law, transport_law
from hakase_kernel.pbpk.physiology.store import get_physiology
from hakase_kernel.uncertainty.conformal import empirical_coverage
from hakase_smallmol.pk_ivive.disposition import assemble_disposition
from hakase_smallmol.pk_ivive.kp import compute_kp
from hakase_smallmol.pk_ivive.logp_resolver import neutral_logp_for_smiles
from hakase_smallmol.pk_ivive.pk_ivive import predict_pk_ivive
from hakase_smallmol.pk_ivive.pka import predict_pka
from pbpk_holdout import load_pbpk_holdout
from pbpk_metrics import calculate_pbpk_metrics, calculate_permutation_control
from rdkit import Chem
from rdkit.Chem import Descriptors

REPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")

# Per-compound measured in-vitro inputs the benchmark may carry. These are read
# from the CSV row (measured provenance) and passed as `overrides` so each
# compound drives the pipeline with ITS OWN disposition. Anything absent falls
# back to the ML ADMET path; if a hard-required input (CLint, fu) is still
# missing the compound is SKIPPED — never back-filled with a shared constant.
INVITRO_INPUT_COLS = (
    "fu_plasma",
    "clint_hep_ul_min_1e6",
    "vdss_l_per_kg",
    "blood_plasma_ratio",
)

# Unit reconciliation. The cohort ODE works in mg, litres and minutes; the
# benchmark is in clinical PK units. Convert PREDICTIONS into benchmark units
# before scoring so like is compared with like.
#   concentration: mg/L  ->  ng/mL   (1 mg/L = 1000 ng/mL)
MG_PER_L_TO_NG_PER_ML = 1000.0
#   AUC:           mg·min/L -> ng·h/mL   (×1000 for conc, ÷60 for min->h)
MG_MIN_PER_L_TO_NG_H_PER_ML = 1000.0 / 60.0
#   clearance:     L/min (whole animal) -> mL/min/kg  (×1000, ÷ body weight)


def _row_overrides(row) -> dict[str, float]:
    """Collect the measured in-vitro inputs present (and finite) for this row."""
    overrides: dict[str, float] = {}
    for col in INVITRO_INPUT_COLS:
        if col in row and row[col] is not None:
            val = row[col]
            if isinstance(val, (int, float)) and math.isfinite(val):
                overrides[col] = float(val)
    return overrides


def run_pbpk_pipeline(row, species: str):
    """Run the PBPK pipeline for one benchmark compound.

    Returns the cohort result dict, or ``None`` if the compound lacks the
    measured inputs required to compute without guessing.
    """
    smiles = row["smiles"]
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    overrides = _row_overrides(row)
    bpr_override = overrides.get("blood_plasma_ratio")

    ivive_res = predict_pk_ivive(smiles, species=species, overrides=overrides)
    if not ivive_res or ivive_res.get("source") != "ivive":
        # insufficient-input / input-error → refuse to compute on a guess.
        return None

    pka_res = predict_pka(smiles, allow_heuristic=True)
    # Neutral logP for the Kp path. Crippen over-estimates for lipophilic
    # fused-azole bases (adipose P·fNL amplifies it); the resolver caps those
    # onto a logD-anchored value where it is reliable, and leaves everything
    # else — including every Vss-gate compound — on Crippen. See logp_resolver.
    crippen_logp = Descriptors.MolLogP(mol)
    logp = neutral_logp_for_smiles(smiles, pka_res, crippen_logp=crippen_logp).logp

    fu_plasma = ivive_res.get("inputs", {}).get("fu_plasma", {}).get("value")
    if fu_plasma is None:
        return None

    bpr = bpr_override
    if bpr is None:
        bpr = ivive_res.get("inputs", {}).get("blood_plasma_ratio", {}).get("value") or 1.0

    kp_res = compute_kp(logp, pka_res, fu_plasma=fu_plasma, blood_plasma_ratio=bpr)

    ad = ApplicabilityDomain(verdict="in")
    disp = assemble_disposition(ivive_res, kp_res, applicability_domain=ad)

    phys_base = get_physiology(species)
    dose_mg = row["dose_mg_kg"] * phys_base.body_weight_kg
    # Dense sampling over the first 2 h so trapezoidal AUC resolves the fast IV
    # distribution phase — a coarse uniform grid over-estimates AUC on the bolus
    # spike and under-estimates CL for high-clearance drugs (propranolol read
    # ~19 instead of ~35 mL/min/kg on a 500-point uniform grid).
    t_eval = np.unique(
        np.concatenate(
            [
                np.linspace(0, 120, 600),
                np.linspace(120, 24 * 60, 500),
            ]
        )
    )

    cohort_res = run_virtual_cohort(
        n_animals=50,
        seed=42,
        disp_base=disp,
        phys_base=phys_base,
        transport_law=transport_law,
        clearance_law=clearance_law,
        forcing_model_factory=lambda p: IVBolus(dose_mg),
        time_eval=t_eval,
    )
    return cohort_res, phys_base.body_weight_kg


def _endpoint_in_benchmark_units(ep: dict, body_weight_kg: float) -> dict:
    """Convert one cohort plasma endpoint block into benchmark units."""
    cmax = ep["c_max"]
    auc = ep["auc"]
    cl = ep["cl"]
    vss = ep["vss"]
    cl_to_ml_min_kg = MG_PER_L_TO_NG_PER_ML / body_weight_kg  # L/min -> mL/min/kg
    return {
        "cmax": {
            "median": cmax["median"] * MG_PER_L_TO_NG_PER_ML,
            "low": cmax["p05"] * MG_PER_L_TO_NG_PER_ML,
            "high": cmax["p95"] * MG_PER_L_TO_NG_PER_ML,
        },
        "auc": {
            "median": auc["median"] * MG_MIN_PER_L_TO_NG_H_PER_ML,
            "low": auc["p05"] * MG_MIN_PER_L_TO_NG_H_PER_ML,
            "high": auc["p95"] * MG_MIN_PER_L_TO_NG_H_PER_ML,
        },
        "cl": {
            "median": cl["median"] * cl_to_ml_min_kg,
            "low": cl["p05"] * cl_to_ml_min_kg,
            "high": cl["p95"] * cl_to_ml_min_kg,
        },
        # Vss is emitted by the cohort already in L/kg (plasma-referenced), so it
        # needs no unit conversion — pass it straight through for scoring against
        # observed steady-state Vd.
        "vss": {
            "median": vss["median"],
            "low": vss["p05"],
            "high": vss["p95"],
        },
    }


def _calibrated_predictive_coverage(true_vals, pred_vals, alpha: float = 0.1):
    """Leave-one-out lognormal predictive interval (PK error is multiplicative).

    The cohort Monte-Carlo p05–p95 reflects only inter-animal physiology — it is
    NOT a predictive interval for the point estimate, which is why raw coverage is
    ~0. Here, for each drug, the log-residual mean/SD of the OTHER drugs define a
    (1-α) interval  pred · exp(μ ± z·σ)  (μ corrects bias, σ the spread); we check
    whether the held-out observation falls inside. Coverage is a genuine
    out-of-sample estimate; the honest model-quality signal is the WIDTH, reported
    as a fold factor ("CL known to within ×N at 90% confidence").

    Distribution-free split-conformal (``ConformalRegressor``) is the target once
    the set is larger — it needs > 1/α calibration points (≈19 for 90%), more than
    this rat set holds, so it cannot yet certify 90% and we use the lognormal
    calibration instead. Returns None below 4 points.
    """
    from scipy.stats import t as t_dist

    t = np.asarray(true_vals, dtype=float)
    p = np.asarray(pred_vals, dtype=float)
    ok = (t > 0) & (p > 0) & np.isfinite(t) & np.isfinite(p)
    t, p = t[ok], p[ok]
    n = t.size
    if n < 4:
        return None
    resid = np.log(t) - np.log(p)  # per-drug log-residual (multiplicative error)
    lows = np.empty(n)
    highs = np.empty(n)
    for i in range(n):
        others = np.delete(resid, i)
        m = others.size
        mu, sd = float(others.mean()), float(others.std(ddof=1))
        # Proper small-sample PREDICTION interval for a new observation: the
        # t-quantile with sqrt(1 + 1/m) inflates for both the estimated mean/SD
        # and the new draw. Using a plain normal z here under-covers at small n.
        mult = float(t_dist.ppf(1.0 - alpha / 2.0, df=m - 1)) * np.sqrt(1.0 + 1.0 / m)
        lows[i] = np.log(p[i]) + mu - mult * sd
        highs[i] = np.log(p[i]) + mu + mult * sd
    return {
        "coverage": float(empirical_coverage(lows, highs, np.log(t))),
        "nominal": round(1.0 - alpha, 3),
        "median_halfwidth_fold": float(np.exp(np.median((highs - lows) / 2.0))),
        "n": int(n),
        "method": "lognormal-LOO",
    }


def run_validation(species: str, benchmark_file: str | None = None, test_fraction: float = 0.5):
    print(f"Loading PK data for {species}...")
    try:
        train_df, test_df = load_pbpk_holdout(
            species=species,
            test_fraction=test_fraction,
            seed=42,
            benchmark_file=benchmark_file,
        )
    except (FileNotFoundError, ValueError) as e:
        print(f"\nCannot run the gate:\n{e}")
        return
    print(f"Scaffold split: {len(train_df)} train, {len(test_df)} test.")

    results = []
    skipped = []

    print("Running PBPK simulations on the test set...")
    for _idx, row in test_df.iterrows():
        try:
            out = run_pbpk_pipeline(row, species)
            if out is None:
                skipped.append(row["compound_name"])
                continue
            cohort_res, body_weight_kg = out

            ep = cohort_res["endpoints"]["plasma"]
            pred = _endpoint_in_benchmark_units(ep, body_weight_kg)

            results.append(
                {
                    "name": row["compound_name"],
                    "smiles": row["smiles"],
                    "true_cmax": row["cmax_ng_ml"],
                    "pred_cmax": pred["cmax"]["median"],
                    "pred_cmax_low": pred["cmax"]["low"],
                    "pred_cmax_high": pred["cmax"]["high"],
                    "true_auc": row["auc_ng_h_ml"],
                    "pred_auc": pred["auc"]["median"],
                    "pred_auc_low": pred["auc"]["low"],
                    "pred_auc_high": pred["auc"]["high"],
                    "true_cl": row["cl_ml_min_kg"],
                    "pred_cl": pred["cl"]["median"],
                    "pred_cl_low": pred["cl"]["low"],
                    "pred_cl_high": pred["cl"]["high"],
                    "true_vss": row["vdss_l_per_kg"] if "vdss_l_per_kg" in row else float("nan"),
                    "pred_vss": pred["vss"]["median"],
                    "pred_vss_low": pred["vss"]["low"],
                    "pred_vss_high": pred["vss"]["high"],
                }
            )
        except Exception as e:
            print(f"Failed on {row['compound_name']}: {e}")
            skipped.append(row["compound_name"])

    if skipped:
        print(f"Skipped {len(skipped)} compound(s) lacking required inputs: {skipped}")

    if not results:
        print(
            "No successful simulations — every test compound lacked the measured "
            "CLint/fu required to compute without guessing. Populate the benchmark's "
            "in-vitro input columns (or bring ML ADMET online) and re-run."
        )
        return

    def col(key):
        return np.array([r[key] for r in results], dtype=float)

    metrics = {}
    control = {}
    n_scored = {}
    calibrated = {}
    for label, base in (("Cmax", "cmax"), ("AUC", "auc"), ("Clearance", "cl"), ("Vss", "vss")):
        t = col(f"true_{base}")
        p = col(f"pred_{base}")
        lo = col(f"pred_{base}_low")
        hi = col(f"pred_{base}_high")
        # Score only compounds with an observed value for THIS endpoint — a drug
        # with a published CL but no reported Cmax still contributes to CL.
        obs = np.isfinite(t)
        n_scored[label] = int(obs.sum())
        metrics[label] = calculate_pbpk_metrics(t[obs], p[obs], lo[obs], hi[obs])
        control[label] = calculate_permutation_control(t[obs], p[obs], lo[obs], hi[obs])
        calibrated[label] = _calibrated_predictive_coverage(t[obs], p[obs])

    report = {
        "species": species,
        "n_test": len(results),
        "n_scored_per_endpoint": n_scored,
        "n_skipped": len(skipped),
        "skipped": skipped,
        "metrics": metrics,
        "permutation_control": control,
        "calibrated_coverage": calibrated,
        "raw_results": results,
    }

    os.makedirs(REPORT_DIR, exist_ok=True)
    report_path = os.path.join(
        REPORT_DIR, f"pbpk_validation_{species}_{time.strftime('%Y%m%d_%H%M%S')}.json"
    )
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\nReport written to {report_path}")
    print(f"\n--- PBPK Validation Metrics ({species}, n={len(results)}) ---")
    for ep in ["Cmax", "AUC", "Clearance", "Vss"]:
        m = metrics[ep]
        c = control[ep]
        print(f"\n{ep} (n={n_scored[ep]}):")
        print(f"  Within 2x: {m['within_2x']:.1%} (Control: {c['within_2x']:.1%})")
        print(f"  Within 3x: {m['within_3x']:.1%} (Control: {c['within_3x']:.1%})")
        print(f"  Med. Fold: {m['median_fold_error']:.2f}")
        print(f"  Raw MC coverage: {m['coverage']:.1%} (physiology spread only)")
        cal = calibrated[ep]
        if cal:
            print(
                f"  Calibrated 90% coverage: {cal['coverage']:.1%} "
                f"(nominal {cal['nominal']:.0%}) at ±{cal['median_halfwidth_fold']:.2f}-fold"
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--species", default="rat")
    parser.add_argument(
        "--benchmark",
        default=None,
        help="Path to a benchmark CSV (defaults to datasets/<species>_pk_benchmark.csv). "
        "Species still selects the physiology, so a subset file runs against rat physiology.",
    )
    parser.add_argument(
        "--test-fraction",
        type=float,
        default=0.5,
        help="Fraction of scaffolds held out for scoring (1.0 scores every row).",
    )
    args = parser.parse_args()

    run_validation(args.species, benchmark_file=args.benchmark, test_fraction=args.test_fraction)
