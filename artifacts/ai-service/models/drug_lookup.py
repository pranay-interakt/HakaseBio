"""Lookup-first known-drug resolver.

Architectural role
──────────────────
This is the FIRST thing the L1 pipeline calls. Before any rule-based ADMET
heuristic or ML inference runs, we ask: "do we already have measured data
for this molecule (or a near-identical analogue)?" When the answer is yes
the measured values are returned with provenance="experimental" and the
rest of the pipeline becomes a sanity check, not a prediction.

This eliminates the dominant failure mode the platform had: running 5
independent ML hard-veto gates (hERG / DILI / Ames / ClinTox / Carcinogen)
against approved drugs that, by base-rate math alone, were ~55 % likely
to false-positive on at least one gate. Known FDA drugs now resolve to
their real measured liability profile (which is usually clean) — and when
they DO have a real liability (terfenadine's hERG, cerivastatin's DILI),
the verdict is `KNOWN-LIABILITY-NO-GO`, which the UI renders in a distinct
color so reviewers can tell the difference between "known clinical
liability blocked advancement" and "novel chemistry blocked by the model".

Matching strategy (in order of strictness):
  1. Exact InChIKey match              → "exact"        (confidence 1.00)
  2. First-block InChIKey match        → "stereo-variant" (confidence 0.95)
     (matches when only stereochemistry differs from a known drug)
  3. ECFP4 Tanimoto ≥ 0.95             → "close-analog"  (confidence 0.85)
  4. ECFP4 Tanimoto ≥ 0.85             → "structural-analog" (confidence 0.70)
  5. No match                          → None

Steps 3–4 catch counterion/salt-form differences and the common case where
a research SMILES is a tautomer of the curated canonical SMILES.

Data sources are vendored at build time in `data/known_drugs.py`; running
`scripts/extend-known-drugs.py` extends the table via the ChEMBL MCP.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from rdkit import Chem
from rdkit.Chem import AllChem, DataStructs

from data.known_drugs import KNOWN_DRUGS, KnownDrug

logger = logging.getLogger(__name__)

# ── Lazy index — built once on first lookup ─────────────────────────────────

_INDEX_LOCK = threading.Lock()
_INDEX_READY = False

# canonical SMILES → KnownDrug
_BY_INCHIKEY: dict[str, KnownDrug] = {}
_BY_INCHIKEY_FIRSTBLOCK: dict[str, KnownDrug] = {}

# parallel arrays for Tanimoto NN search
_KD_LIST: list[KnownDrug] = []
_KD_FPS: list[DataStructs.ExplicitBitVect] = []

_MORGAN_RADIUS = 2
_MORGAN_NBITS = 2048

_EXACT_THR = 1.0
_CLOSE_THR = 0.95
_STRUCT_THR = 0.85


def _canon_smiles(smi: str) -> Optional[str]:
    mol = Chem.MolFromSmiles(smi)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, canonical=True)


def _mol_fp(mol) -> Optional[DataStructs.ExplicitBitVect]:
    try:
        return AllChem.GetMorganFingerprintAsBitVect(
            mol, radius=_MORGAN_RADIUS, nBits=_MORGAN_NBITS
        )
    except Exception:
        return None


def _build_index() -> None:
    """One-time index build. Computes InChIKey + ECFP4 for every known drug."""
    global _INDEX_READY
    skipped = 0
    for kd in KNOWN_DRUGS:
        smi = kd.get("smiles", "")
        mol = Chem.MolFromSmiles(smi)
        if mol is None:
            skipped += 1
            logger.warning("drug_lookup: invalid SMILES for %r — skipping", kd.get("name"))
            continue
        # Stamp canonical fields onto the record
        canon = Chem.MolToSmiles(mol, canonical=True)
        ikey = Chem.MolToInchiKey(mol)
        kd["_canon_smiles"] = canon
        kd["_inchikey"] = ikey
        _BY_INCHIKEY[ikey] = kd
        _BY_INCHIKEY_FIRSTBLOCK[ikey.split("-")[0]] = kd
        fp = _mol_fp(mol)
        if fp is not None:
            _KD_LIST.append(kd)
            _KD_FPS.append(fp)
    logger.info(
        "drug_lookup: indexed %d known drugs (%d skipped)", len(_KD_LIST), skipped
    )
    _INDEX_READY = True


def _ensure_index() -> None:
    if _INDEX_READY:
        return
    with _INDEX_LOCK:
        if _INDEX_READY:
            return
        _build_index()


# ── Public API ──────────────────────────────────────────────────────────────


def lookup_drug(smiles: str) -> Optional[dict[str, Any]]:
    """Return measured-data envelope if the query matches a known drug.

    Returns None on no-match so the caller can fall through to ML / heuristic
    paths. Returns a dict with the following shape on a hit:
      {
        "match_type": "exact" | "stereo-variant" | "close-analog" | "structural-analog",
        "match_confidence": float,
        "matched_drug": <KnownDrug record>,
        "tanimoto": float | None,
        "verdict_hint": "KNOWN-LIABILITY-NO-GO" | "GO-KNOWN-CLEAN" | "WATCH-KNOWN",
        "provenance": "experimental",
      }
    """
    if not smiles or not smiles.strip():
        return None

    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        return None

    _ensure_index()

    # ── Tier 1: exact InChIKey ──────────────────────────────────────────────
    ikey = Chem.MolToInchiKey(mol)
    if ikey in _BY_INCHIKEY:
        kd = _BY_INCHIKEY[ikey]
        return _envelope(kd, "exact", 1.0, 1.0)

    # ── Tier 2: first-block InChIKey (stereo-variant) ───────────────────────
    fb = ikey.split("-")[0]
    if fb in _BY_INCHIKEY_FIRSTBLOCK:
        kd = _BY_INCHIKEY_FIRSTBLOCK[fb]
        return _envelope(kd, "stereo-variant", 0.95, None)

    # ── Tier 3–4: Tanimoto NN search ────────────────────────────────────────
    query_fp = _mol_fp(mol)
    if query_fp is None or not _KD_FPS:
        return None
    sims = DataStructs.BulkTanimotoSimilarity(query_fp, _KD_FPS)
    best_i = max(range(len(sims)), key=lambda i: sims[i])
    best_sim = float(sims[best_i])
    if best_sim >= _CLOSE_THR:
        return _envelope(_KD_LIST[best_i], "close-analog", 0.85, best_sim)
    if best_sim >= _STRUCT_THR:
        return _envelope(_KD_LIST[best_i], "structural-analog", 0.70, best_sim)

    return None


def _envelope(
    kd: KnownDrug, match_type: str, confidence: float, tanimoto: Optional[float]
) -> dict[str, Any]:
    veto_liabilities = [
        L for L in kd.get("liabilities", []) if L.get("severity") == "veto"
    ]
    monitor_liabilities = [
        L for L in kd.get("liabilities", []) if L.get("severity") == "monitor"
    ]
    if veto_liabilities or kd.get("status") == "withdrawn":
        verdict_hint = "KNOWN-LIABILITY-NO-GO"
    elif monitor_liabilities:
        verdict_hint = "WATCH-KNOWN"
    else:
        verdict_hint = "GO-KNOWN-CLEAN"
    return {
        "match_type": match_type,
        "match_confidence": confidence,
        "tanimoto": tanimoto,
        "matched_drug": kd,
        "verdict_hint": verdict_hint,
        "veto_liabilities": veto_liabilities,
        "monitor_liabilities": monitor_liabilities,
        "provenance": "experimental",
        "lookup_engine": "HakaseAI DrugLookup v1.0 (InChIKey + ECFP4 Tanimoto)",
    }


def lookup_status() -> dict[str, Any]:
    """For health endpoints — report what's indexed."""
    _ensure_index()
    return {
        "ready": _INDEX_READY,
        "indexed_drugs": len(_KD_LIST),
        "approved": sum(1 for kd in _KD_LIST if kd.get("status") == "approved"),
        "withdrawn": sum(1 for kd in _KD_LIST if kd.get("status") == "withdrawn"),
        "reference": sum(1 for kd in _KD_LIST if kd.get("status") == "reference"),
        "match_thresholds": {
            "exact": _EXACT_THR,
            "close_analog_tanimoto": _CLOSE_THR,
            "structural_analog_tanimoto": _STRUCT_THR,
        },
    }
