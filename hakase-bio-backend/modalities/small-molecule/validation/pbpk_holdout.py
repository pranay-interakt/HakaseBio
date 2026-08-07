import os

import numpy as np
import pandas as pd
from rdkit import Chem
from rdkit.Chem.MolStandardize import rdMolStandardize
from rdkit.Chem.Scaffolds import MurckoScaffold

_HERE = os.path.dirname(os.path.abspath(__file__))
DATASETS_DIR = os.path.join(_HERE, "datasets")

_LARGEST_FRAGMENT_CHOOSER = rdMolStandardize.LargestFragmentChooser()


def strip_salt(smiles: str) -> str:
    """Return the canonical SMILES of the largest (parent) fragment.

    Salts and counter-ions are separate fragments in a SMILES string
    (dot-separated). Keeping only the largest organic fragment means a drug and
    its salt form (e.g. ``propranolol`` vs ``propranolol.Cl``) collapse to the
    same parent, so they cannot leak across a train/test split.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return smiles
    try:
        parent = _LARGEST_FRAGMENT_CHOOSER.choose(mol)
        if parent is not None and parent.GetNumAtoms() > 0:
            return Chem.MolToSmiles(parent)
    except Exception:
        pass
    return Chem.MolToSmiles(mol)


def compute_scaffold(smiles: str) -> str:
    """Compute the Bemis–Murcko scaffold of a compound's parent fragment.

    Grouping by scaffold (rather than exact structure) is what makes the split a
    *scaffold split*: close analogues that share a ring system land in the same
    split, preventing optimistic leakage between train and test.
    """
    parent = strip_salt(smiles)
    try:
        mol = Chem.MolFromSmiles(parent)
        if mol is None:
            return parent
        core = MurckoScaffold.GetScaffoldForMol(mol)
        scaffold_smi = Chem.MolToSmiles(core)
        # Acyclic molecules have an empty Murcko scaffold; fall back to the
        # parent SMILES so they still group as their own unit.
        if not scaffold_smi:
            return parent
        return scaffold_smi
    except Exception:
        return parent


def load_pbpk_holdout(
    species: str = "rat",
    test_fraction: float = 0.2,
    seed: int = 42,
    benchmark_file: str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load the rat PK benchmark and perform a leakage-controlled scaffold split.

    Two leakage controls are applied before splitting:
      1. Salts/counter-ions are stripped so a drug and its salt collapse to one
         parent.
      2. Exact-parent duplicates are dropped (keeping the first occurrence) so
         the same molecule cannot appear in both train and test.
    The split is then by Bemis–Murcko scaffold: every row sharing a scaffold is
    assigned wholesale to train or test, never split across the two.

    Returns:
        (train_df, test_df)
    """
    file_path = benchmark_file or os.path.join(DATASETS_DIR, f"{species}_pk_benchmark.csv")
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"PK benchmark file not found: {file_path}")

    df = pd.read_csv(file_path)
    if df.empty:
        raise ValueError(
            f"PK benchmark has no data rows: {file_path}\n"
            "Populate it with real, cited rat PK per RAT_PK_BENCHMARK.README.md "
            "(each row needs at minimum a measured rat hepatocyte CLint and fu, "
            "plus an observed in-vivo endpoint). The harness refuses to fabricate."
        )

    # Leakage control 1 + 2: canonical parent, then drop exact-parent duplicates.
    df["parent_smiles"] = df["smiles"].apply(strip_salt)
    n_before = len(df)
    df = df.drop_duplicates(subset="parent_smiles", keep="first").reset_index(drop=True)
    n_dropped = n_before - len(df)
    if n_dropped:
        print(f"Deduplicated {n_dropped} salt/analogue row(s) sharing a parent structure.")

    # Scaffold assignment (computed from the parent, so salts already collapsed).
    df["scaffold"] = df["parent_smiles"].apply(compute_scaffold)

    scaffolds = df["scaffold"].unique()
    rng = np.random.default_rng(seed)
    rng.shuffle(scaffolds)

    n_test = int(len(scaffolds) * test_fraction)
    if n_test == 0 and len(scaffolds) > 1:
        n_test = 1

    test_scaffolds = set(scaffolds[:n_test])
    is_test = df["scaffold"].isin(test_scaffolds)
    train_df = df[~is_test].copy()
    test_df = df[is_test].copy()

    # Leakage guarantee: no scaffold may appear in both splits.
    overlap = set(train_df["scaffold"]) & set(test_df["scaffold"])
    if overlap:
        raise AssertionError(f"Scaffold leakage between train and test: {overlap}")

    return train_df, test_df
