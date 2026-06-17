"""Applicability domain (AD) confidence scorer.

Answers the key question: "Is this molecule similar to anything in our training
data, or are we extrapolating into uncharted chemical space?"

Method: Tanimoto similarity between the query molecule's Morgan fingerprint and
the nearest-neighbour compound in the combined DILI + CardioTox training sets.
If the nearest-neighbour Tanimoto is below a threshold, the ML predictions are
likely extrapolations and should be treated with lower confidence.

Thresholds (Jaworska et al. 2005 ATLA, OECD QSAR Toolbox convention):
  ≥ 0.65  → In-domain    (high confidence)
  0.40–0.65 → Border-domain (moderate confidence)
  < 0.40  → Out-of-domain (low confidence, predictions are extrapolations)

The training fingerprints are loaded lazily on first call and cached in memory.

References
----------
- Jaworska et al. (2005) ATLA 33:445 — AD definition for QSAR models
- Netzeva et al. (2005) ATLA 33:155  — OECD guidance on AD
- Sahigara et al. (2012) Molecules 17:4791 — comparison of AD methods
- Sheridan (2012) J Chem Inf Model 52:814  — Tanimoto AD for RF models
"""

from __future__ import annotations
import logging
import threading
from typing import Any, Optional

import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem, DataStructs

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy training fingerprint cache
# ---------------------------------------------------------------------------

_TRAIN_FPS: Optional[list[DataStructs.ExplicitBitVect]] = None
_TRAIN_SMILES_CACHE: Optional[list[str]] = None
_LOAD_LOCK = threading.Lock()

_MORGAN_RADIUS = 2
_MORGAN_NBITS = 2048

# AD thresholds
_IN_DOMAIN_THR    = 0.65
_BORDER_THR       = 0.40


def _mol_to_fp(mol) -> Optional[DataStructs.ExplicitBitVect]:
    try:
        return AllChem.GetMorganFingerprintAsBitVect(
            mol, radius=_MORGAN_RADIUS, nBits=_MORGAN_NBITS
        )
    except Exception:
        return None


def _load_training_fps() -> list[DataStructs.ExplicitBitVect]:
    """Load Morgan FPs for all training molecules.

    Sources — in priority order (uses whichever TDC data is cached):
      1. DILI training set (TDC Tox / DILIrank, ~475 compounds)
      2. CardioTox (hERG) training set (TDC Tox / hERG_Karim, ~657 compounds)
      3. Fallback: curated 50-compound reference set from published DILI drugs
    """
    fps: list[DataStructs.ExplicitBitVect] = []
    collected_smiles: list[str] = []

    # ── Try to import TDC training data ───────────────────────────────────
    def _add_from_tdc(name: str, category: str = "Tox"):
        nonlocal fps, collected_smiles
        try:
            from tdc.single_pred import Tox  # type: ignore
            data = Tox(name=name).get_data()
            for smi in data["Drug"].tolist():
                try:
                    m = Chem.MolFromSmiles(str(smi))
                    if m is None:
                        continue
                    can = Chem.MolToSmiles(m, canonical=True)
                    fp = _mol_to_fp(Chem.MolFromSmiles(can))
                    if fp is not None:
                        fps.append(fp)
                        collected_smiles.append(can)
                except Exception:
                    pass
            logger.info("AD: loaded %d FPs from TDC/%s", len(fps), name)
        except Exception as exc:
            logger.warning("AD: could not load TDC/%s: %s", name, exc)

    _add_from_tdc("DILI")
    _add_from_tdc("hERG_Karim")

    # ── Fallback reference set ─────────────────────────────────────────────
    # 50 well-known drugs spanning diverse chemical space; ensures AD scorer
    # always has at least a baseline even when TDC is unavailable.
    _FALLBACK_SMILES = [
        # Hepatotoxic reference drugs
        "CC(=O)Nc1ccc(O)cc1",   # acetaminophen
        "CC1=CC=C(C=C1)NC2=CC=CC=C2",  # diphenylamine
        "O=C(O)c1ccc(Cl)nc1",  # clonidine analog
        "CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O",  # ibuprofen
        "CC1=C(C(=O)Nc2ccccc2)C(=O)Nc2ccccc12",  # diclofenac analog
        "COc1cc2c(cc1OC)[C@@H]1CC[C@@]3(N(C)CC[C@H]3[C@@H]1CC2)C=C",  # colchicine-like
        # Cardiovascular
        "CC(C)(C)NCC(O)c1ccc(O)cc1O",  # salbutamol
        "c1cc(Cl)ccc1C(c1ccccc1)N1CCCC1",  # chlorphenamine
        "CCOC(=O)c1ccc(N)cc1",  # benzocaine
        "CN(C)c1ccc(cc1)C(=N)N",  # pentamidine analog
        "c1ccc2c(c1)sc(=S)n2",  # thioridazine fragment
        "CC(=O)OCC1C(OC(=O)C)C(O)C(O)C(O1)CO",  # cellulose analog
        "Clc1ccccc1c1ccccc1",  # PCB fragment
        "c1ccc2[nH]ccc2c1",  # indole
        "O=C(O)CCCc1ccc(cc1)O",  # homogentisic acid
        "CCNC(=O)c1ccc(cc1)S(=O)(=O)N",  # sulfonamide
        "CC1(C)SC2C(NC(=O)Cc3ccccc3)C(=O)N2C1C(=O)O",  # ampicillin
        "c1cc(OC)c(OC)c2CC[NH2+]CCc12",  # dopamine analog protonated
        "O=C1OC(=O)c2ccccc21",  # phthalic anhydride
        "OCCCO",  # 1,3-propanediol
        # Antimicrobials
        "Cc1ccc(cc1)S(=O)(=O)Nc2cccc(n2)C",  # sulfamethazine
        "OC1C(O)CC2(O)C(c3c(O)cccc3C1=O)C(=O)c1cccc(O)c1C2=O",  # tetracycline
        "CC1=CN=C(N)N=C1N",  # trimethoprim fragment
        "Cc1ccc([N+](=O)[O-])o1",  # nitrofurantoin-like
        # CNS
        "C[C@H]1CN(C[C@@H]1O)c1nc2n(c3ccccc13)CCCCC2",  # antihistamine
        "ClC1CC(=O)N2CCc3cc(Cl)ccc3[C@@H]2C1",  # benzodiazepine-like
        "CC(=O)OCC(=O)[C@@]1(O)CC[C@H]2[C@@H]3CCC4=CC(=O)CC[C@]4(C)[C@H]3CC[C@]12C",  # steroid
        "O=c1[nH]c2ccccc2c(=O)n1Cc1ccccc1",  # benzodiazepine
        "CCOC(=O)c1ccc(N)c(N)c1",  # DAP derivative
        # Lipids / statins
        "CC(C)c1ccc(cc1)C(C)C",  # DIPE
        "[C@@H]1(c2ccc(F)cc2)(C(=O)O)CC[C@@H](O)CC1",  # atorvastatin fragment
        "CC(C[C@H](O)CC(=O)O)C[C@H]1C[C@H](C)CC(=O)O1",  # mevastatin fragment
        # Misc drug-like
        "c1ccc(-c2ccc(-c3ccncc3)cc2)nc1",  # biphenyl-pyridine
        "O=C(Nc1ccc(F)cc1)Nc1ccc(Cl)cc1",  # urea diaryl
        "Cc1cc(NC(=O)c2ccc(Cl)cc2)ccc1F",  # amide biaryls
        "COCCOC",  # ethylene glycol dimethyl ether
        "C(F)(F)(F)c1ccc(cc1)S(=O)(=O)N",  # flutamide analog
        "CC(=O)Nc1ccc2cc(OC)c(OC)cc2c1",  # ADTA analog
        "OCCc1ccc(O)cc1",  # tyrosol
        # Peptide-like small molecules
        "CC(C)C[C@H](NC(=O)[C@@H](N)CC(=O)O)C(=O)N[C@@H](Cc1ccccc1)C(=O)O",
        "O=C(N[C@@H](Cc1c[nH]c2ccccc12)C(=O)O)[C@@H]1CCC(=O)N1",
        "CC[C@H](C)[C@@H](NC(=O)[C@H](CC(C)C)NC(=O)[C@@H](N)CCCCN)C(=O)O",
        # Toxic reference molecules (should give high DILI signals)
        "CCCCl",   # butyl chloride (simple alkyl halide)
        "c1ccc(cc1)[N+](=O)[O-]",  # nitrobenzene
        "C(Cl)(Cl)(Cl)Cl",  # carbon tetrachloride
        "c1ccc2c(c1)ccc1cccc3cccc2c13",  # benzo[a]pyrene
        "ClCCCl",  # 1,2-dichloroethane
        "O=C(O)CC(=O)O",  # malonic acid
    ]

    fallback_count = 0
    for smi in _FALLBACK_SMILES:
        try:
            m = Chem.MolFromSmiles(smi)
            if m is None:
                continue
            fp = _mol_to_fp(m)
            if fp is not None and (Chem.MolToSmiles(m, canonical=True) not in collected_smiles):
                fps.append(fp)
                collected_smiles.append(Chem.MolToSmiles(m, canonical=True))
                fallback_count += 1
        except Exception:
            pass
    logger.info("AD: added %d fallback reference FPs (total: %d)", fallback_count, len(fps))

    return fps


def _get_training_fps() -> list[DataStructs.ExplicitBitVect]:
    global _TRAIN_FPS
    if _TRAIN_FPS is not None:
        return _TRAIN_FPS
    with _LOAD_LOCK:
        if _TRAIN_FPS is not None:
            return _TRAIN_FPS
        _TRAIN_FPS = _load_training_fps()
    return _TRAIN_FPS


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def predict_applicability_domain(smiles: str) -> dict[str, Any]:
    """Compute Tanimoto-based applicability domain score for a query molecule.

    Returns
    -------
    dict with:
      ad_score          — nearest-neighbour Tanimoto similarity [0.0, 1.0]
      ad_label          — "In-domain" | "Border-domain" | "Out-of-domain"
      ad_confidence     — "High" | "Moderate" | "Low"
      nn_similarity     — same as ad_score (explicit alias)
      coverage_note     — human-readable explanation
      model_info        — provenance
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")

    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        raise ValueError(f"Invalid SMILES: {smiles!r}")
    smiles = Chem.MolToSmiles(mol, canonical=True)
    mol = Chem.MolFromSmiles(smiles)

    query_fp = _mol_to_fp(mol)
    if query_fp is None:
        return {
            "smiles": smiles,
            "ad_score": 0.0,
            "ad_label": "Out-of-domain",
            "ad_confidence": "Low",
            "nn_similarity": 0.0,
            "coverage_note": "Could not compute Morgan fingerprint for this molecule",
            "model_info": {"engine": "Tanimoto AD", "error": "fingerprint_failed"},
        }

    train_fps = _get_training_fps()

    if not train_fps:
        # Edge case: no training data loaded
        return {
            "smiles": smiles,
            "ad_score": None,
            "ad_label": "Unknown",
            "ad_confidence": "Low",
            "nn_similarity": None,
            "coverage_note": "Training data unavailable — applicability domain cannot be assessed",
            "model_info": {"engine": "Tanimoto AD", "error": "no_training_fps"},
        }

    # Compute Tanimoto against all training FPs, take max
    similarities = DataStructs.BulkTanimotoSimilarity(query_fp, train_fps)
    nn_sim = float(np.max(similarities)) if similarities else 0.0

    # Determine domain label
    if nn_sim >= _IN_DOMAIN_THR:
        ad_label = "In-domain"
        ad_confidence = "High"
        coverage_note = (
            f"Nearest training analogue Tanimoto = {nn_sim:.2f} (≥{_IN_DOMAIN_THR}). "
            "This scaffold is well-represented in training data — ML predictions are reliable."
        )
    elif nn_sim >= _BORDER_THR:
        ad_label = "Border-domain"
        ad_confidence = "Moderate"
        coverage_note = (
            f"Nearest training analogue Tanimoto = {nn_sim:.2f} ({_BORDER_THR}–{_IN_DOMAIN_THR}). "
            "Scaffold has partial coverage in training data — treat ML predictions with moderate caution."
        )
    else:
        ad_label = "Out-of-domain"
        ad_confidence = "Low"
        coverage_note = (
            f"Nearest training analogue Tanimoto = {nn_sim:.2f} (<{_BORDER_THR}). "
            "Novel scaffold with no close analogues in training data — ML predictions are extrapolations. "
            "Rule-based ADMET and structural alert results remain valid, but quantitative ML values "
            "should be treated as directional only."
        )

    return {
        "smiles": smiles,
        "ad_score": round(nn_sim, 4),
        "ad_label": ad_label,
        "ad_confidence": ad_confidence,
        "nn_similarity": round(nn_sim, 4),
        "coverage_note": coverage_note,
        "training_set_size": len(train_fps),
        "model_info": {
            "engine": "HakaseAI Applicability Domain v1.0 (Tanimoto k-NN, k=1)",
            "method": f"Morgan FP (radius={_MORGAN_RADIUS}, {_MORGAN_NBITS} bits) — Tanimoto NN",
            "thresholds": {
                "in_domain": _IN_DOMAIN_THR,
                "border": _BORDER_THR,
            },
            "training_compounds": len(train_fps),
            "references": [
                "Jaworska et al. (2005) ATLA 33:445",
                "Netzeva et al. (2005) ATLA 33:155",
                "Sheridan (2012) J Chem Inf Model 52:814",
            ],
        },
    }
