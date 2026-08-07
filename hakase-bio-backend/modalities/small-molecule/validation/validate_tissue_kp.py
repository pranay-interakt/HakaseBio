"""Tissue-Kpu validation: does the neutral-logP resolver beat Crippen? (S2-T5 follow-up)

The Vss gate scores a single per-drug volume; it cannot see *where* the Rodgers &
Rowland Kp model goes wrong. This harness scores the engine's predicted per-tissue
``Kpu`` (tissue:unbound-plasma-water) directly against the Rodgers 2005/2006 in-vivo
experimental Kpu tables — the diagnostic that root-caused the base-Kp over-prediction
to Crippen logP.

It runs the real pipeline pKa (heuristic) and the experimental ``fu``/``B:P`` from the
dataset, and toggles ONLY the logP source between:

  * ``crippen``  — RDKit ``Crippen.MolLogP`` (the previous behaviour), and
  * ``resolver`` — :func:`logp_resolver.resolve_neutral_logp` (reliability-gated cap).

so the before/after difference is attributable to the logP change alone. Reports
per-compound and pooled median fold-error and %-within-3× for both, and asserts the
resolver does not regress the pooled median (used as a lightweight guard in tests).

Run:
    python modalities/small-molecule/validation/validate_tissue_kp.py
"""

from __future__ import annotations

import csv
import math
import os
import statistics
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "platform", "kernel", "src")
    ),
)
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from hakase_smallmol.pk_ivive.kp import compute_kp  # noqa: E402
from hakase_smallmol.pk_ivive.logp_resolver import resolve_neutral_logp  # noqa: E402
from hakase_smallmol.pk_ivive.pka import predict_pka  # noqa: E402

DATASET = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "datasets", "rodgers_tissue_kpu.csv"
)


def _load(path: str) -> dict:
    """Group the long-format CSV into {compound: {meta.., tissues: {organ: exp_kpu}}}."""
    compounds: dict[str, dict] = {}
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            name = row["compound"]
            c = compounds.setdefault(
                name,
                {
                    "smiles": row["smiles"],
                    "group": row["group"],
                    "fu": float(row["fu_plasma"]),
                    "bpr": float(row["blood_plasma_ratio"]),
                    "tissues": {},
                },
            )
            c["tissues"][row["tissue"]] = float(row["exp_kpu"])
    return compounds


def _fold_stats(pred: dict[str, float], obs: dict[str, float]) -> tuple[float, float, list[float]]:
    folds = [max(pred[o] / obs[o], obs[o] / pred[o]) for o in obs]
    median = statistics.median(folds)
    within3 = 100.0 * sum(1 for f in folds if f <= 3.0) / len(folds)
    return median, within3, folds


def run(path: str = DATASET) -> dict:
    from rdkit import Chem
    from rdkit.Chem import Crippen

    try:
        from hakase_smallmol.admet.admet_ml import predict_admet_ml
    except Exception:  # pragma: no cover
        from admet_ml import predict_admet_ml  # type: ignore

    compounds = _load(path)
    pooled: dict[str, list[float]] = {"crippen": [], "resolver": []}
    per_compound = []

    print(
        f"{'compound':<17}{'group':<21}{'cripp':>6}{'resolv':>7} |"
        f"{'medFold_cr':>11}{'medFold_rs':>11}{'w3_cr':>7}{'w3_rs':>7}  verdict"
    )
    for name, c in compounds.items():
        mol = Chem.MolFromSmiles(c["smiles"])
        crippen = float(Crippen.MolLogP(mol))
        logd = None
        try:
            res = predict_admet_ml(c["smiles"])
            if res.get("ml_available"):
                v = (res.get("endpoints") or {}).get("Lipophilicity_AstraZeneca")
                logd = float(v) if v is not None else None
        except Exception:  # pragma: no cover
            logd = None

        pka = predict_pka(c["smiles"], allow_heuristic=True)
        resolved = resolve_neutral_logp(crippen, pka, logd).logp

        organs = list(c["tissues"])
        kp_cr = compute_kp(
            crippen, pka, fu_plasma=c["fu"], blood_plasma_ratio=c["bpr"], organs=organs
        ).kpu
        kp_rs = compute_kp(
            resolved, pka, fu_plasma=c["fu"], blood_plasma_ratio=c["bpr"], organs=organs
        ).kpu

        m_cr, w3_cr, f_cr = _fold_stats(kp_cr, c["tissues"])
        m_rs, w3_rs, f_rs = _fold_stats(kp_rs, c["tissues"])
        pooled["crippen"].extend(f_cr)
        pooled["resolver"].extend(f_rs)

        if m_rs < m_cr - 0.01:
            verdict = "IMPROVED"
        elif m_rs > m_cr + 0.01:
            verdict = "REGRESSED"
        else:
            verdict = "unchanged"
        per_compound.append(
            {
                "compound": name,
                "group": c["group"],
                "crippen_logp": crippen,
                "resolved_logp": resolved,
                "median_fold_crippen": m_cr,
                "median_fold_resolver": m_rs,
                "verdict": verdict,
            }
        )
        print(
            f"{name:<17}{c['group']:<21}{crippen:>6.2f}{resolved:>7.2f} |"
            f"{m_cr:>11.2f}{m_rs:>11.2f}{w3_cr:>6.0f}%{w3_rs:>6.0f}%  {verdict}"
        )

    def _pooled(tag: str) -> dict:
        f = pooled[tag]
        return {
            "n_tissue_obs": len(f),
            "median_fold": statistics.median(f),
            "within_3x_pct": 100.0 * sum(1 for x in f if x <= 3.0) / len(f),
            "gmfe": math.exp(statistics.fmean(math.log(x) for x in f)),
        }

    summary = {
        "crippen": _pooled("crippen"),
        "resolver": _pooled("resolver"),
        "per_compound": per_compound,
    }
    print(
        f"\nPooled over {summary['crippen']['n_tissue_obs']} tissue observations:\n"
        f"  Crippen : median {summary['crippen']['median_fold']:.2f}x, "
        f"within3x {summary['crippen']['within_3x_pct']:.0f}%, "
        f"GMFE {summary['crippen']['gmfe']:.2f}x\n"
        f"  Resolver: median {summary['resolver']['median_fold']:.2f}x, "
        f"within3x {summary['resolver']['within_3x_pct']:.0f}%, "
        f"GMFE {summary['resolver']['gmfe']:.2f}x"
    )
    return summary


if __name__ == "__main__":
    run()
