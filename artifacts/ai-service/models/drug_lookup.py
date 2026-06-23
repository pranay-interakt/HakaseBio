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

import os
import sys

# Ensure parent directory of this model (artifacts/ai-service) is at the front of sys.path
# to prevent namespace package conflicts with the root-level 'data' directory.
_parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)
elif sys.path[0] != _parent_dir:
    sys.path.remove(_parent_dir)
    sys.path.insert(0, _parent_dir)

import logging
import threading
from typing import Any, Optional

import requests
from rdkit import Chem
from rdkit.Chem import AllChem, DataStructs

from data.known_drugs import KNOWN_DRUGS, KnownDrug

logger = logging.getLogger(__name__)

# Live ChEMBL — the vendored KNOWN_DRUGS table is intentionally empty (no
# hardcoded answers), so "is this a known drug?" is resolved against ChEMBL's
# curated molecule registry by InChIKey. A compound only counts as a KNOWN DRUG
# (and is allowed to bypass the ML safety stack) when ChEMBL says it reached the
# clinic — max_phase >= 1 — or was withdrawn. Pure research compounds (max_phase
# 0/null) return None so the normal ML/heuristic path still runs.
_CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data"
_CHEMBL_HEADERS = {"Accept": "application/json", "User-Agent": "HakaseAI-DrugLookup/1.0"}
_CHEMBL_TIMEOUT = 8.0
_CHEMBL_RETRIES = 2
# Only the fields the lookup needs — keeps the ChEMBL payload tiny (~200 B vs a
# multi-KB full record) so the call is fast and does not intermittently time out
# (the large full record is what was flipping a known drug NO-GO ↔ REVIEW between
# runs). NOTE: ChEMBL's `only=` only accepts a subset of fields for this endpoint
# — molecule_chembl_id, pref_name, max_phase, withdrawn_flag are valid; adding
# first_approval / withdrawn_reason etc. returns HTTP 500, so they are omitted
# (the veto is driven by withdrawn_flag, and _chembl_to_kd degrades gracefully).
_CHEMBL_FIELDS = "molecule_chembl_id,pref_name,max_phase,withdrawn_flag"
# In-process cache of POSITIVE matches keyed by InChIKey. Once a structure has
# resolved to a known drug it stays resolved for the life of the process, so a
# later transient ChEMBL hiccup can never silently downgrade the verdict. Misses
# are NOT cached (a transient failure must be retryable, not remembered as "novel").
_LOOKUP_CACHE: dict[str, dict[str, Any]] = {}

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


def _load_seed_index() -> int:
    """Load the vendored known-drug SEED — a snapshot of REAL ChEMBL records
    (InChIKey-keyed) so the classic withdrawn set + common approved drugs resolve
    INSTANTLY and OFFLINE. This is what keeps identification + the NO-GO verdict
    working when EBI's live API is degraded (frequent HTTP 500s). Each entry is a
    verified ChEMBL record (chembl_id + withdrawn_flag), not a fabricated value;
    live ChEMBL remains the fallback for anything not in the seed.
    Indexed directly by the stored InChIKey — no RDKit needed for the seed."""
    import os, json
    path = os.path.join(os.path.dirname(__file__), "..", "data", "known_drug_seed.json")
    try:
        with open(path) as f:
            drugs = (json.load(f) or {}).get("drugs", [])
    except Exception as e:  # noqa: BLE001 — seed is best-effort; live ChEMBL still works
        logger.info("drug_lookup: no seed index loaded (%s)", e)
        return 0
    n = 0
    for kd in drugs:
        ik = kd.get("inchikey")
        if not ik:
            continue
        _BY_INCHIKEY[ik] = kd
        _BY_INCHIKEY_FIRSTBLOCK.setdefault(ik.split("-")[0], kd)
        n += 1
    return n


def _build_index() -> None:
    """One-time index build. Loads the vendored seed (instant, offline) and
    computes InChIKey + ECFP4 for any locally vendored KNOWN_DRUGS records."""
    global _INDEX_READY
    seeded = _load_seed_index()
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
        "drug_lookup: indexed %d seed + %d vendored known drugs (%d skipped)",
        seeded, len(_KD_LIST), skipped,
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


def _chembl_to_kd(mol: dict[str, Any]) -> Optional[KnownDrug]:
    """Map a ChEMBL molecule record → a KnownDrug envelope record.

    Returns None when the molecule is NOT a clinical-stage / approved /
    withdrawn drug (max_phase < 1 and not withdrawn) — i.e. a research-only
    ChEMBL compound, which must still go through the ML safety stack.

    No values are fabricated: status and withdrawal text come straight from
    ChEMBL's curated fields.
    """
    chembl_id = mol.get("molecule_chembl_id")
    withdrawn = bool(mol.get("withdrawn_flag"))
    max_phase = mol.get("max_phase")
    try:
        max_phase_num = float(max_phase) if max_phase is not None else 0.0
    except (TypeError, ValueError):
        max_phase_num = 0.0

    if not withdrawn and max_phase_num < 1:
        return None  # research compound, not a known drug

    if withdrawn:
        status = "withdrawn"
    elif max_phase_num >= 4:
        status = "approved"
    else:
        status = "investigational"

    liabilities: list[dict[str, Any]] = []
    withdrawal_reason = None
    if withdrawn:
        reason = mol.get("withdrawn_reason")
        year = mol.get("withdrawn_year")
        country = mol.get("withdrawn_country")
        parts = [p for p in (reason, country, str(year) if year else None) if p]
        withdrawal_reason = "; ".join(parts) if parts else "Withdrawn from market (ChEMBL withdrawn_flag)"
        liabilities.append({
            "endpoint": "Market withdrawal",
            "measured": 0,
            "valueText": withdrawal_reason,
            "source": f"ChEMBL {chembl_id}" if chembl_id else "ChEMBL",
            "severity": "veto",
        })

    return {
        "name": mol.get("pref_name") or chembl_id,
        "status": status,
        "max_phase": max_phase_num,
        "first_approval": mol.get("first_approval"),
        "chembl_id": chembl_id,
        "withdrawal_reason": withdrawal_reason,
        "liabilities": liabilities,
    }


def _max_phase_num(mol: dict[str, Any]) -> float:
    try:
        mp = mol.get("max_phase")
        return float(mp) if mp is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _drug_rank(mol: dict[str, Any]) -> tuple[int, float]:
    """Ranking key for choosing the most drug-like ChEMBL record among several
    that share an InChIKey connectivity block. A withdrawn or higher-max_phase
    record IS the drug we want to recognise; research-only stereo/tautomer
    entries (max_phase None/0) rank lowest."""
    return (1 if mol.get("withdrawn_flag") else 0, _max_phase_num(mol))


def _chembl_query(params: str) -> Optional[KnownDrug]:
    """Run a ChEMBL molecule.json query and map the BEST drug-like hit to a
    KnownDrug. ChEMBL frequently holds several records for one structure — the
    racemate, each enantiomer, salts, research duplicates — and the exact /
    connectivity-block match can land on a max_phase=0 research entry while the
    actual approved/withdrawn drug sits right beside it (e.g. cisapride: exact →
    CHEMBL560739 max_phase None, while CHEMBL1729 is the withdrawn drug). So we
    fetch several and pick the most drug-like (withdrawn, then highest max_phase).
    Any network/parse failure returns None (→ caller falls through to ML)."""
    # limit=10 is plenty to surface the drug record among stereo/salt variants;
    # combined with only=<fields> the payload stays small and the call is fast.
    url = f"{_CHEMBL_BASE}/molecule.json?{params}&only={_CHEMBL_FIELDS}&limit=10"
    last_err: Any = None
    for attempt in range(_CHEMBL_RETRIES):
        try:
            resp = requests.get(url, headers=_CHEMBL_HEADERS, timeout=_CHEMBL_TIMEOUT)
            if not resp.ok:
                last_err = f"HTTP {resp.status_code}"
                continue
            molecules = resp.json().get("molecules") or []
            if not molecules:
                return None  # genuine miss (query succeeded, no record)
            best = max(molecules, key=_drug_rank)
            return _chembl_to_kd(best)
        except Exception as e:  # noqa: BLE001 — transient; retry then fall through
            last_err = e
    logger.info("drug_lookup: ChEMBL query failed (%s) — falling through to ML", last_err)
    return None


def lookup_drug(smiles: str) -> Optional[dict[str, Any]]:
    """Return measured-data envelope if the query matches a known drug.

    Resolution order:
      0. vendored in-memory index (empty by default; honoured if repopulated)
      1. live ChEMBL exact InChIKey  → match_type "exact"
      2. live ChEMBL InChIKey first-block (stereo/salt variant) → "stereo-variant"
      3. vendored Tanimoto NN (only if the index was populated) → close/structural

    A ChEMBL hit only counts when ChEMBL marks the molecule as clinical-stage
    (max_phase >= 1) or withdrawn — research compounds return None so the ML
    safety stack still runs.

    Returns None on no-match. On a hit returns:
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

    ikey = Chem.MolToInchiKey(mol)
    fb = ikey.split("-")[0]

    # ── Cache: a once-resolved known drug stays resolved (stability) ─────────
    cached = _LOOKUP_CACHE.get(ikey)
    if cached is not None:
        return cached

    # Cache only POSITIVE matches — a transient miss must stay retryable.
    def _hit(env: dict[str, Any]) -> dict[str, Any]:
        _LOOKUP_CACHE[ikey] = env
        return env

    # ── Tier 0: vendored index (empty by default) ───────────────────────────
    _ensure_index()
    if ikey in _BY_INCHIKEY:
        return _hit(_envelope(_BY_INCHIKEY[ikey], "exact", 1.0, 1.0))
    if fb in _BY_INCHIKEY_FIRSTBLOCK:
        return _hit(_envelope(_BY_INCHIKEY_FIRSTBLOCK[fb], "stereo-variant", 0.95, None))

    # ── Tier 1: live ChEMBL exact InChIKey ──────────────────────────────────
    kd = _chembl_query(f"molecule_structures__standard_inchi_key__exact={ikey}")
    if kd is not None:
        return _hit(_envelope(kd, "exact", 1.0, 1.0))

    # ── Tier 2: live ChEMBL stereo-variant (InChIKey connectivity block) ─────
    kd = _chembl_query(f"molecule_structures__standard_inchi_key__istartswith={fb}-")
    if kd is not None:
        return _hit(_envelope(kd, "stereo-variant", 0.95, None))

    # ── Tier 3–4: vendored Tanimoto NN (only if the index was populated) ─────
    if _KD_FPS:
        query_fp = _mol_fp(mol)
        if query_fp is not None:
            sims = DataStructs.BulkTanimotoSimilarity(query_fp, _KD_FPS)
            best_i = max(range(len(sims)), key=lambda i: sims[i])
            best_sim = float(sims[best_i])
            if best_sim >= _CLOSE_THR:
                return _hit(_envelope(_KD_LIST[best_i], "close-analog", 0.85, best_sim))
            if best_sim >= _STRUCT_THR:
                return _hit(_envelope(_KD_LIST[best_i], "structural-analog", 0.70, best_sim))

    return None


# ── Evidence enrichment — WHY a drug is in its state ────────────────────────
# ChEMBL's lighter by-ID endpoints (drug_warning, mechanism) are far more
# reliable than structure search and carry the *reason*: warning_class
# (cardiotoxicity / hepatotoxicity / …), withdrawal description + year, and the
# mechanism of action. Best-effort + cached: identification NEVER depends on it,
# so a known drug is still identified (and vetoed) when these calls fail.
_EVIDENCE_CACHE: dict[str, dict[str, Any]] = {}


def _chembl_evidence(chembl_id: Optional[str]) -> dict[str, Any]:
    if not chembl_id:
        return {}
    if chembl_id in _EVIDENCE_CACHE:
        return _EVIDENCE_CACHE[chembl_id]
    ev: dict[str, Any] = {}
    # drug_warning — the reason for withdrawal / black-box
    try:
        url = f"{_CHEMBL_BASE}/drug_warning.json?molecule_chembl_id={chembl_id}&limit=20"
        resp = requests.get(url, headers=_CHEMBL_HEADERS, timeout=5)
        if resp.ok:
            warns = resp.json().get("drug_warnings") or []
            classed = [w for w in warns if w.get("warning_class")]
            best = classed[0] if classed else (warns[0] if warns else None)
            if best:
                ev["warning_class"] = best.get("warning_class")
                ev["warning_type"] = best.get("warning_type")  # Withdrawn / Black Box Warning
                ev["warning_description"] = best.get("warning_description")
                ev["warning_year"] = best.get("warning_year")
                ev["warning_country"] = best.get("warning_country")
    except Exception:  # noqa: BLE001 — evidence is optional
        pass
    # mechanism — how it works
    try:
        url = f"{_CHEMBL_BASE}/mechanism.json?molecule_chembl_id={chembl_id}&limit=5"
        resp = requests.get(url, headers=_CHEMBL_HEADERS, timeout=5)
        if resp.ok:
            mechs = resp.json().get("mechanisms") or []
            if mechs:
                ev["mechanism_of_action"] = mechs[0].get("mechanism_of_action")
                ev["mechanism_target"] = mechs[0].get("target_chembl_id")
                ev["action_type"] = mechs[0].get("action_type")
    except Exception:  # noqa: BLE001
        pass
    _EVIDENCE_CACHE[chembl_id] = ev
    return ev


def _envelope(
    kd: KnownDrug, match_type: str, confidence: float, tanimoto: Optional[float]
) -> dict[str, Any]:
    # Enrich with the REASON (drug_warning) + mechanism — best-effort, cached.
    evidence = _chembl_evidence(kd.get("chembl_id"))
    if evidence:
        kd = {**kd, **{k: v for k, v in evidence.items() if v is not None}}
        # Promote the curated warning_class into the veto liability so the verdict
        # says *why* (e.g. "Known liability — Cardiotoxicity"), and refine the
        # human-readable withdrawal reason from ChEMBL's description.
        wc = evidence.get("warning_class")
        desc = evidence.get("warning_description")
        for L in kd.get("liabilities", []):
            if L.get("severity") == "veto":
                if wc:
                    L["endpoint"] = wc.title()
                if desc:
                    yr = evidence.get("warning_year")
                    L["valueText"] = desc + (f" (withdrawn {yr})" if yr else "")
        if desc and kd.get("status") == "withdrawn":
            kd["withdrawal_reason"] = desc

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
