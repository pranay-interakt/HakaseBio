#!/usr/bin/env python3
"""
Layer-1 calibrated QSPR/QSAR model fitting pipeline.
=====================================================

Refits the coefficient table embedded in `src/lib/l1Calibration.ts`.

Design constraints
------------------
* DATA COMES FROM AN API, NOT LOCAL FILES. Every training set is pulled live
  from the Therapeutics Data Commons API (tdcommons.ai) at run time. Nothing
  is vendored into the repo — only the fitted coefficients (a few KB of
  numbers) are committed, inside l1Calibration.ts.
* FEATURES = descriptors that already exist on the browser-side
  `MolecularProperties` + `PharmacophoreProfile`, so the fitted coefficients
  port verbatim to TypeScript with no new RDKit descriptor.
* MODELS = Ridge regression (continuous endpoints) and L2-logistic
  (classifiers) — linear so the coefficients are a plain dot product in TS.

Usage
-----
    pip install "PyTDC==0.4.1" rdkit scikit-learn "numpy<2" pandas
    python scripts/calibrate_l1_models.py

It prints, for every endpoint, the 5-fold cross-validated metric and the
raw-feature coefficient block ready to paste into l1Calibration.ts.

Datasets (all CC-BY 4.0 via TDC): Caco2_Wang, PPBR_AZ, Half_Life_Obach,
Clearance_Hepatocyte_AZ, HIA_Hou, hERG_Karim, CYP{1A2,2C9,2C19,2D6,3A4}_Veith.
"""
from __future__ import annotations
import json
import warnings

import numpy as np

warnings.filterwarnings("ignore")

from rdkit import Chem
from rdkit.Chem import Descriptors, Lipinski, rdMolDescriptors, Crippen
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import KFold, StratifiedKFold, cross_val_predict
from sklearn.metrics import r2_score, roc_auc_score

# --------------------------------------------------------------------------- #
# Feature extraction — must mirror chemistry.ts / l1Calibration.ts CalDescriptors
# --------------------------------------------------------------------------- #
FEATURES = [
    "mw", "logP", "logP2", "tpsa", "hbd", "hba", "rotBonds", "numAromaticRings",
    "fsp3", "crippenMR", "numAromaticHeterocycles", "aromaticNCount",
    "basicAmineCount", "acidicGroupCount",
]
_BASIC_N = Chem.MolFromSmarts("[NX3;H1,H2;!$(NC=O);!$(NS=O);!$(N=*);!$(Nc)]")
_ARO_N = Chem.MolFromSmarts("[n]")
_COOH = Chem.MolFromSmarts("[CX3](=O)[OX2H1]")
_SULFO = Chem.MolFromSmarts("[OX1H]S(=O)=O")


def featurize(smiles: str):
    m = Chem.MolFromSmiles(smiles)
    if m is None:
        return None
    try:
        logp = Crippen.MolLogP(m)
        d = {
            "mw": Descriptors.MolWt(m),
            "logP": logp,
            "logP2": logp * logp,
            "tpsa": rdMolDescriptors.CalcTPSA(m),
            "hbd": float(Lipinski.NumHDonors(m)),
            "hba": float(Lipinski.NumHAcceptors(m)),
            "rotBonds": float(Lipinski.NumRotatableBonds(m)),
            "numAromaticRings": float(rdMolDescriptors.CalcNumAromaticRings(m)),
            "fsp3": rdMolDescriptors.CalcFractionCSP3(m),
            "crippenMR": Crippen.MolMR(m),
            "numAromaticHeterocycles": float(rdMolDescriptors.CalcNumAromaticHeterocycles(m)),
            "aromaticNCount": float(len(m.GetSubstructMatches(_ARO_N))),
            "basicAmineCount": float(len(m.GetSubstructMatches(_BASIC_N))),
            "acidicGroupCount": float(
                len(m.GetSubstructMatches(_COOH)) + len(m.GetSubstructMatches(_SULFO))
            ),
        }
        v = np.array([d[k] for k in FEATURES], dtype=np.float64)
        return v if np.all(np.isfinite(v)) else None
    except Exception:
        return None


def load_tdc(group: str, name: str, label_name: str | None = None):
    """Pull a dataset live from the TDC API and featurize it."""
    from tdc.single_pred import ADME, Tox
    cls = ADME if group == "ADME" else Tox
    df = cls(name=name).get_data() if label_name is None else cls(name=name, label_name=label_name).get_data()
    X, Y = [], []
    for smi, y in zip(df["Drug"], df["Y"]):
        v = featurize(str(smi))
        if v is not None:
            X.append(v)
            Y.append(float(y))
    return np.vstack(X), np.array(Y)


# --------------------------------------------------------------------------- #
# Coefficient extraction — fold the StandardScaler into raw-feature weights
# --------------------------------------------------------------------------- #
def raw_coefficients(pipe, cols):
    sc, lin = pipe.named_steps["sc"], pipe.named_steps["lin"]
    w = np.ravel(lin.coef_)
    intercept = float(np.ravel(lin.intercept_)[0])
    coef = {}
    for j, ci in enumerate(cols):
        coef[FEATURES[ci]] = round(w[j] / sc.scale_[j], 6)
        intercept -= w[j] * sc.mean_[j] / sc.scale_[j]
    return round(intercept, 5), coef


def fit_regression(X, Y, cols, label):
    Xc = X[:, cols]
    mask = np.isfinite(Y) & np.all(np.isfinite(Xc), axis=1)
    Xc, Y = Xc[mask], Y[mask]
    best = None
    for alpha in (1.0, 3.0, 10.0, 30.0, 100.0):
        pipe = Pipeline([("sc", StandardScaler()), ("lin", Ridge(alpha=alpha))])
        pred = cross_val_predict(pipe, Xc, Y, cv=KFold(5, shuffle=True, random_state=42))
        mae = float(np.mean(np.abs(pred - Y)))
        if best is None or mae < best[1]:
            best = (alpha, mae, r2_score(Y, pred))
    alpha, mae, r2 = best
    pipe = Pipeline([("sc", StandardScaler()), ("lin", Ridge(alpha=alpha))]).fit(Xc, Y)
    intercept, coef = raw_coefficients(pipe, cols)
    print(f"\n{label}: n={len(Y)}  R2={r2:.3f}  geomean fold-error={10**mae:.2f}x  (5-fold CV)")
    print(f"  intercept={intercept}\n  coef={json.dumps(coef)}")
    return intercept, coef


def fit_classifier(X, Y, cols, label):
    Xc = X[:, cols]
    y = Y.astype(int)
    mask = np.all(np.isfinite(Xc), axis=1)
    Xc, y = Xc[mask], y[mask]
    best = None
    for C in (0.1, 0.3, 1.0, 3.0):
        pipe = Pipeline([("sc", StandardScaler()),
                         ("lin", LogisticRegression(C=C, max_iter=3000, class_weight="balanced"))])
        proba = cross_val_predict(pipe, Xc, y, cv=StratifiedKFold(5, shuffle=True, random_state=42),
                                  method="predict_proba")[:, 1]
        auc = roc_auc_score(y, proba)
        if best is None or auc > best[1]:
            best = (C, auc)
    C, auc = best
    pipe = Pipeline([("sc", StandardScaler()),
                     ("lin", LogisticRegression(C=C, max_iter=3000, class_weight="balanced"))]).fit(Xc, y)
    intercept, coef = raw_coefficients(pipe, cols)
    print(f"\n{label}: n={len(y)}  ROC-AUC={auc:.3f}  (5-fold CV)")
    print(f"  intercept={intercept}\n  coef={json.dumps(coef)}")
    return intercept, coef


def main():
    idx = {f: i for i, f in enumerate(FEATURES)}
    cols = lambda *names: [idx[n] for n in names]

    print("Pulling datasets from the TDC API and fitting...")

    X, Y = load_tdc("ADME", "Caco2_Wang")
    fit_regression(X, Y, cols("logP", "logP2", "tpsa", "hbd", "hba", "mw", "rotBonds",
                              "numAromaticRings", "aromaticNCount", "acidicGroupCount", "fsp3"),
                   "Caco-2 log10(Papp cm/s)")

    X, Y = load_tdc("ADME", "PPBR_AZ")
    fit_regression(X, np.log10(np.clip((100.0 - Y) / 100.0, 1e-3, 1.0)),
                   cols("logP", "logP2", "tpsa", "hbd", "hba", "mw", "aromaticNCount",
                        "acidicGroupCount", "numAromaticRings", "basicAmineCount"),
                   "PPB log10(fu)")

    X, Y = load_tdc("ADME", "Half_Life_Obach")
    fit_regression(X, np.log10(np.clip(Y, 0.05, 500.0)),
                   cols("logP", "logP2", "tpsa", "mw", "hbd", "rotBonds", "fsp3",
                        "aromaticNCount", "numAromaticRings", "acidicGroupCount", "crippenMR"),
                   "Half-life log10(h)")

    X, Y = load_tdc("ADME", "Clearance_Hepatocyte_AZ")
    fit_regression(X, np.log10(np.clip(Y, 0.5, 5000.0)),
                   cols("logP", "logP2", "tpsa", "mw", "fsp3", "rotBonds", "numAromaticRings",
                        "aromaticNCount", "hbd", "numAromaticHeterocycles"),
                   "Hepatocyte CLint log10")

    X, Y = load_tdc("ADME", "HIA_Hou")
    fit_classifier(X, Y, cols("tpsa", "logP", "logP2", "mw", "hbd", "hba", "rotBonds",
                              "aromaticNCount", "acidicGroupCount", "fsp3"),
                   "HIA probability")

    X, Y = load_tdc("Tox", "hERG_Karim")
    fit_classifier(X, Y, cols("logP", "logP2", "mw", "tpsa", "basicAmineCount", "aromaticNCount",
                              "numAromaticRings", "hbd", "rotBonds", "fsp3", "numAromaticHeterocycles"),
                   "hERG blocker probability")

    cyp_cols = cols("logP", "logP2", "mw", "tpsa", "hbd", "hba", "aromaticNCount",
                    "numAromaticRings", "rotBonds", "crippenMR", "numAromaticHeterocycles")
    for iso in ("CYP1A2", "CYP2C9", "CYP2C19", "CYP2D6", "CYP3A4"):
        X, Y = load_tdc("ADME", f"{iso}_Veith")
        fit_classifier(X, Y, cyp_cols, f"{iso} inhibitor probability")

    print("\nDone. Paste the intercept/coef blocks into src/lib/l1Calibration.ts.")


if __name__ == "__main__":
    main()
