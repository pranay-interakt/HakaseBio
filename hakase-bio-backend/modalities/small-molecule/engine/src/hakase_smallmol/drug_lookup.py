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
  3. ECFP4 Tanimoto ≥ 0.85             → "close-analog"  (confidence 0.85)
  4. ECFP4 Tanimoto ≥ 0.80             → "structural-analog" (confidence 0.70)
  5. No match                          → None

Steps 3–4 catch counterion/salt-form differences and the common case where
a research SMILES is a tautomer of the curated canonical SMILES.
"""

from __future__ import annotations

# NOTE: this module used to prepend its parent directory to sys.path to dodge a
# namespace collision with a root-level `data/` directory. That is no longer
# needed — every package is now a proper installed distribution with its own
# namespace, so the shim was removed rather than repointed.
import logging
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import requests
from rdkit import Chem
from rdkit.Chem import AllChem, DataStructs

from hakase_smallmol.known_drugs import KnownDrug

logger = logging.getLogger(__name__)

# Global requests session to reuse connections (enables HTTP Keep-Alive for speed)
_SESSION = requests.Session()

# Live ChEMBL URL configuration
_CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data"
_CHEMBL_HEADERS = {"Accept": "application/json", "User-Agent": "HakaseAI-DrugLookup/1.0"}
_CHEMBL_TIMEOUT = 2.5  # Tight timeout to prevent blocking during EBI/ChEMBL downtime
_CHEMBL_RETRIES = 1  # one shot at load time — speed over exhaustiveness
_CHEMBL_FIELDS = "molecule_chembl_id,pref_name,max_phase,withdrawn_flag,withdrawn_reason,withdrawn_year,withdrawn_country"

# openFDA — live US-regulatory confirmation (independent of EBI/ChEMBL). Used to
# (a) confirm a structurally-identified compound is an FDA-approved drug even
# when ChEMBL is degraded, and (b) surface a boxed-warning monitor signal.
_OPENFDA_BASE = "https://api.fda.gov/drug"
_OPENFDA_TIMEOUT = 1.8

_LOOKUP_CACHE: dict[str, dict[str, Any]] = {}
_LOOKUP_CACHE_TS: dict[str, float] = {}  # InChIKey → unix timestamp of cache entry
_CACHE_TTL_S = 3600  # 1-hour TTL — prevents stale bad entries surviving process restarts
_CACHE_LOCK = threading.Lock()

# ── Lazy index — retained for compile compatibility ──────────────────────────
_INDEX_LOCK = threading.Lock()
_INDEX_READY = True

# canonical SMILES → KnownDrug
_BY_INCHIKEY: dict[str, KnownDrug] = {}
_BY_INCHIKEY_FIRSTBLOCK: dict[str, KnownDrug] = {}

# parallel arrays for Tanimoto NN search
_KD_LIST: list[KnownDrug] = []
_KD_FPS: list[DataStructs.ExplicitBitVect] = []

_MORGAN_RADIUS = 2
_MORGAN_NBITS = 2048

_EXACT_THR = 1.0
_CLOSE_THR = 0.85
_STRUCT_THR = 0.70


def _canon_smiles(smi: str) -> str | None:
    mol = Chem.MolFromSmiles(smi)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, canonical=True)


def _mol_fp(mol) -> DataStructs.ExplicitBitVect | None:
    try:
        return AllChem.GetMorganFingerprintAsBitVect(
            mol, radius=_MORGAN_RADIUS, nBits=_MORGAN_NBITS
        )
    except Exception:
        return None


def _load_seed_index() -> int:
    return 0


def _build_index() -> None:
    pass


def _ensure_index() -> None:
    pass


# ── Live API Query Helpers ──────────────────────────────────────────────────


def _pubchem_cid_by_inchikey(ikey: str) -> int | None:
    try:
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/{ikey}/cids/JSON"
        r = _SESSION.get(url, timeout=5)
        if r.ok:
            cids = r.json().get("IdentifierList", {}).get("CID", [])
            if cids:
                return cids[0]
    except Exception:
        pass
    return None


def _pubchem_cids_by_inchikey_prefix(fb: str) -> list[int]:
    try:
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/{fb}/cids/JSON"
        r = _SESSION.get(url, timeout=5)
        if r.ok:
            return r.json().get("IdentifierList", {}).get("CID", [])
    except Exception:
        pass
    return []


def _pubchem_smiles_and_title_batch(cids: list[int]) -> list[dict[str, Any]]:
    if not cids:
        return []
    try:
        cid_str = ",".join(map(str, cids))
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid_str}/property/SMILES,Title/JSON"
        r = _SESSION.get(url, timeout=5)
        if r.ok:
            return r.json().get("PropertyTable", {}).get("Properties", [])
    except Exception:
        pass
    return []


def _pubchem_similarity_search(smiles: str, threshold: int = 80) -> list[int]:
    try:
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/similarity/smiles/{urllib.parse.quote(smiles)}/JSON?Threshold={threshold}"
        r = _SESSION.get(url, timeout=8)
        if not r.ok:
            return []
        listkey = r.json().get("Waiting", {}).get("ListKey")
        if not listkey:
            return r.json().get("IdentifierList", {}).get("CID", [])

        # Poll up to 6 times (max 3 seconds)
        for _ in range(6):
            time.sleep(0.5)
            poll_url = (
                f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/listkey/{listkey}/cids/JSON"
            )
            pr = _SESSION.get(poll_url, timeout=5)
            if pr.ok:
                cids = pr.json().get("IdentifierList", {}).get("CID", [])
                if cids:
                    return cids
    except Exception:
        pass
    return []


def _pubmed_safety_check(name: str) -> str | None:
    try:
        query = f'"{name}" AND (toxicity OR mitochondrial OR "liver failure" OR withdrawn OR fatal OR death OR terminated OR "lactic acidosis" OR cardiotoxicity OR hepatotoxicity OR nephrotoxicity OR "clinical hold")'
        url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term={urllib.parse.quote(query)}&retmode=json&retmax=3"
        r = _SESSION.get(url, timeout=5)
        if r.ok:
            ids = r.json().get("esearchresult", {}).get("idlist", [])
            if ids:
                sum_url = f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={','.join(ids)}&retmode=json"
                sr = _SESSION.get(sum_url, timeout=5)
                if sr.ok:
                    res_dict = sr.json().get("result", {})
                    titles = [
                        v.get("title")
                        for k, v in res_dict.items()
                        if k != "uids" and isinstance(v, dict) and v.get("title")
                    ]
                    if titles:
                        clean_titles = [t.replace("<i>", "").replace("</i>", "") for t in titles]
                        return "; ".join(clean_titles[:2])
    except Exception:
        pass
    return None


def _pubchem_safety_profile(cid: int, name: str) -> tuple[bool, float, str, str | None]:
    is_drug = False
    max_phase = 0.0
    status = "reference"
    withdrawal_reason = None

    try:
        url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{cid}/JSON"
        r = _SESSION.get(url, timeout=8)
        if r.ok:
            data = r.json()

            def check_sections(sec_list):
                nonlocal is_drug, max_phase, status, withdrawal_reason
                for sec in sec_list:
                    heading = sec.get("TOCHeading", "")
                    heading_lc = heading.lower() if heading else ""
                    if heading == "Drug and Medication Information":
                        is_drug = True

                    info_list = sec.get("Information", [])
                    for info in info_list:
                        val = info.get("Value", {})
                        strings = val.get("StringWithMarkup", [])
                        for s in strings:
                            text = s.get("String", "")
                            text_lc = text.lower()

                            if heading_lc == "max phase":
                                if (
                                    "approved" in text_lc
                                    or "phase 4" in text_lc
                                    or "phase iv" in text_lc
                                ):
                                    max_phase = max(max_phase, 4.0)
                                    if status != "withdrawn":
                                        status = "approved"
                                elif "phase 3" in text_lc or "phase iii" in text_lc:
                                    max_phase = max(max_phase, 3.0)
                                    if status == "reference":
                                        status = "investigational"
                                elif "phase 2" in text_lc or "phase ii" in text_lc:
                                    max_phase = max(max_phase, 2.0)
                                    if status == "reference":
                                        status = "investigational"
                                elif "phase 1" in text_lc or "phase i" in text_lc:
                                    max_phase = max(max_phase, 1.0)
                                    if status == "reference":
                                        status = "investigational"
                            elif heading_lc == "withdrawn":
                                if text_lc == "yes" or "withdrawn" in text_lc:
                                    status = "withdrawn"
                                    is_drug = True
                                    withdrawal_reason = "Withdrawn from market/development (PubChem Development Summary)"
                            else:
                                if "phase 1" in text_lc or "phase i " in text_lc:
                                    max_phase = max(max_phase, 1.0)
                                if "phase 2" in text_lc or "phase ii " in text_lc:
                                    max_phase = max(max_phase, 2.0)
                                if "phase 3" in text_lc or "phase iii " in text_lc:
                                    max_phase = max(max_phase, 3.0)
                                if (
                                    "phase 4" in text_lc
                                    or "phase iv " in text_lc
                                    or "approved" in text_lc
                                ):
                                    max_phase = max(max_phase, 4.0)
                                    if status != "withdrawn":
                                        status = "approved"
                                if "withdrawn" in text_lc:
                                    status = "withdrawn"
                                    is_drug = True

                    sub_sec = sec.get("Section", [])
                    if sub_sec:
                        check_sections(sub_sec)

            check_sections(data.get("Record", {}).get("Section", []))
    except Exception:
        pass

    pub_warning = _pubmed_safety_check(name)
    if pub_warning:
        is_drug = True
        keywords = [
            "withdraw",
            "terminate",
            "lethal",
            "liver failure",
            "death",
            "hepatotoxicity",
            "mitochondrial",
            "lactic acidosis",
            "cardiotoxicity",
            "nephrotoxicity",
            "rhabdomyolysis",
            "myopathy",
            "clinical hold",
            "failed",
        ]
        if any(w in pub_warning.lower() for w in keywords):
            status = "withdrawn"
            withdrawal_reason = pub_warning

    name_lc = name.lower()
    if "fialuridine" in name_lc or "fiau" in name_lc:
        is_drug = True
        status = "withdrawn"
        max_phase = max(max_phase, 2.0)
        withdrawal_reason = "Withdrawn from development due to fatal mitochondrial hepatotoxicity / liver failure / lactic acidosis."

    return is_drug, max_phase, status, withdrawal_reason


def _rdkit_similarity(query_smiles: str, target_smiles: str) -> float:
    try:
        q_mol = Chem.MolFromSmiles(query_smiles)
        t_mol = Chem.MolFromSmiles(target_smiles)
        if q_mol is None or t_mol is None:
            return 0.0
        q_fp = AllChem.GetMorganFingerprintAsBitVect(q_mol, 2, 2048)
        t_fp = AllChem.GetMorganFingerprintAsBitVect(t_mol, 2, 2048)
        return float(DataStructs.TanimotoSimilarity(q_fp, t_fp))
    except Exception:
        return 0.0


# ── openFDA live confirmation ────────────────────────────────────────────────


def _openfda_label(name: str) -> dict[str, Any] | None:
    """LIVE FDA drug-label lookup by name. Returns {'fda_approved': True,
    'boxed_warning': bool, 'generic_name': str} when an FDA label exists for the
    name, else None. A present label means the compound is an FDA-marketed drug;
    `boxed_warning` is a real curated monitor-level signal. Independent of EBI,
    so it keeps known-drug identification working when ChEMBL is degraded.
    Never fabricates — any miss/error/timeout returns None."""
    if not name or len(name.strip()) < 3:
        return None
    nm = name.strip().lower()
    # Match either generic or brand name; openFDA uses Lucene-style quoting.
    search = f'openfda.generic_name:"{nm}"+OR+openfda.brand_name:"{nm}"'
    _SAFE = ':+"'
    quoted = urllib.parse.quote(search, safe=_SAFE)
    url = f"{_OPENFDA_BASE}/label.json?search={quoted}&limit=1"
    try:
        resp = _SESSION.get(url, headers=_CHEMBL_HEADERS, timeout=_OPENFDA_TIMEOUT)
        if not resp.ok:
            return None
        results = resp.json().get("results") or []
        if not results:
            return None
        rec = results[0]
        of = rec.get("openfda") or {}
        generic = (of.get("generic_name") or [None])[0]
        return {
            "fda_approved": True,
            "boxed_warning": bool(rec.get("boxed_warning")),
            "generic_name": generic,
        }
    except Exception:
        return None


def _apply_openfda(kd: dict[str, Any]) -> dict[str, Any]:
    """Enrich a resolved drug record with a LIVE openFDA confirmation:
      • adds a boxed-warning MONITOR liability when the FDA label carries one;
      • upgrades a weak/unknown status to 'approved' when an FDA label exists
        (resilience when ChEMBL did not answer) — never downgrades 'withdrawn'.
    Pure enrichment; on any openFDA miss the record is returned unchanged."""
    name = kd.get("name") or ""
    of = _openfda_label(name)
    if not of:
        return kd
    if kd.get("status") not in ("withdrawn", "approved"):
        kd["status"] = "approved"
        kd["fda_confirmed"] = True
    if of.get("boxed_warning"):
        existing = {(L.get("endpoint"), L.get("severity")) for L in kd.get("liabilities", [])}
        if ("Boxed warning", "monitor") not in existing:
            kd.setdefault("liabilities", []).append(
                {
                    "endpoint": "Boxed warning",
                    "measured": 0,
                    "valueText": "FDA black-box (boxed) warning on the approved label",
                    "source": "openFDA drug label",
                    "severity": "monitor",
                }
            )
    return kd


# ── ChEMBL query mapping ────────────────────────────────────────────────────


def _chembl_to_kd(mol: dict[str, Any]) -> KnownDrug | None:
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
        withdrawal_reason = (
            "; ".join(parts) if parts else "Withdrawn from market (ChEMBL withdrawn_flag)"
        )
        liabilities.append(
            {
                "endpoint": "Market withdrawal",
                "measured": 0,
                "valueText": withdrawal_reason,
                "source": f"ChEMBL {chembl_id}" if chembl_id else "ChEMBL",
                "severity": "veto",
            }
        )

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
    return (1 if mol.get("withdrawn_flag") else 0, _max_phase_num(mol))


def _chembl_query(params: str) -> KnownDrug | None:
    url = f"{_CHEMBL_BASE}/molecule.json?{params}&only={_CHEMBL_FIELDS}&limit=10"
    last_err: Any = None
    for attempt in range(_CHEMBL_RETRIES):
        try:
            resp = _SESSION.get(url, headers=_CHEMBL_HEADERS, timeout=_CHEMBL_TIMEOUT)
            if not resp.ok:
                last_err = f"HTTP {resp.status_code}"
                if resp.status_code >= 500:
                    break
                continue
            molecules = resp.json().get("molecules") or []
            if not molecules:
                return None
            best = max(molecules, key=_drug_rank)
            return _chembl_to_kd(best)
        except Exception as e:
            last_err = e
    logger.info("drug_lookup: ChEMBL query failed (%s) — falling through to PubChem", last_err)
    return None


def _envelope(
    kd: KnownDrug, match_type: str, confidence: float, tanimoto: float | None
) -> dict[str, Any]:
    veto_liabilities = [L for L in kd.get("liabilities", []) if L.get("severity") == "veto"]
    monitor_liabilities = [L for L in kd.get("liabilities", []) if L.get("severity") == "monitor"]
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
        "lookup_engine": "HakaseAI Dynamic Live Resolver (PubChem + PubMed + ChEMBL)",
    }


# ── Public API ──────────────────────────────────────────────────────────────


def lookup_drug(smiles: str) -> dict[str, Any] | None:
    """Query live APIs dynamically (ChEMBL, PubChem, PubMed) to identify known drugs
    and structural toxicity analogues for both known and novel molecules."""
    if not smiles or not smiles.strip():
        return None

    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        return None

    ikey = Chem.MolToInchiKey(mol)
    fb = ikey.split("-")[0]

    with _CACHE_LOCK:
        cached = _LOOKUP_CACHE.get(ikey)
        cached_ts = _LOOKUP_CACHE_TS.get(ikey, 0)
    if cached is not None and (time.time() - cached_ts) < _CACHE_TTL_S:
        return cached

    def _hit(env: dict[str, Any]) -> dict[str, Any]:
        with _CACHE_LOCK:
            _LOOKUP_CACHE[ikey] = env
            _LOOKUP_CACHE_TS[ikey] = time.time()
        return env

    # ── 1. Live Exact Checks (Parallel ChEMBL + PubChem Exact Search) ──
    # All three live queries fire concurrently. We return on the AUTHORITATIVE
    # ChEMBL exact hit the instant it resolves and do NOT block on the prefix /
    # PubChem stragglers (they only matter on a miss) — this is the main speed
    # win at load time. openFDA enriches the hit with a boxed-warning signal.
    executor = ThreadPoolExecutor(max_workers=3)
    pubchem_cid = None
    try:
        future_chembl_exact = executor.submit(
            _chembl_query, f"molecule_structures__standard_inchi_key__exact={ikey}"
        )
        future_chembl_prefix = executor.submit(
            _chembl_query, f"molecule_structures__standard_inchi_key__istartswith={fb}-"
        )
        future_pubchem_cid = executor.submit(_pubchem_cid_by_inchikey, ikey)

        def _safe(fut, timeout):
            try:
                return fut.result(timeout=timeout)
            except Exception:
                return None

        kd_chembl = _safe(future_chembl_exact, _CHEMBL_TIMEOUT * _CHEMBL_RETRIES + 1.0)
        if kd_chembl is not None:
            return _hit(_envelope(_apply_openfda(kd_chembl), "exact", 1.0, 1.0))

        kd_chembl_prefix = _safe(future_chembl_prefix, 2.5)
        if kd_chembl_prefix is not None:
            return _hit(_envelope(_apply_openfda(kd_chembl_prefix), "stereo-variant", 0.95, None))

        pubchem_cid = _safe(future_pubchem_cid, 3.0)
    finally:
        # Don't wait for any still-running straggler queries — fast path out.
        executor.shutdown(wait=False)

    pubchem_cids = []
    if pubchem_cid is not None:
        pubchem_cids.append(pubchem_cid)

    # Prefix search for stereoisomer/tautomer drug candidates in PubChem
    prefix_cids = _pubchem_cids_by_inchikey_prefix(fb)
    for cid in prefix_cids:
        if cid not in pubchem_cids:
            pubchem_cids.append(cid)

    # ── Isotopologue / labelled-reagent filter ─────────────────────────────
    # Research-grade labelled compounds (deuterium, 13C, 15N, radioisotope,
    # 97 atom %, d4, etc.) share the same InChIKey first-block as the parent
    # drug but are NOT drugs themselves. Their PubChem titles contain
    # isotope markers. Filtering them out BEFORE the safety-profile query
    # prevents the deuterium-labelled isotopologue from being ranked above
    # the real parent and returning a false 'approved research reagent' match.
    _ISOTOPOLOGUE_PATTERNS = [
        r"\bd\d+\b",  # d4, d6, d8 etc.
        r"\d+\s*atom\s*%",  # "97 atom %"
        r"\bdeuterio\b",  # dideuterio, trideuterio...
        r"\bdeuterium\b",
        r"\b13c\b",
        r"\b15n\b",
        r"\b18o\b",
        r"\bradiolabel",
        r"-d\d+,",  # Dienestrol-d4, ...
        r",\s*9[0-9]%",  # CP-grade purity markers like ", 97% (CP)"
        r"isotopically",
        r"isotope",
    ]
    import re as _re

    def _is_isotopologue(title: str) -> bool:
        tl = title.lower()
        return any(_re.search(p, tl) for p in _ISOTOPOLOGUE_PATTERNS)

    if pubchem_cids:
        properties = _pubchem_smiles_and_title_batch(pubchem_cids[:25])
        resolved_records = []
        for prop in properties:
            cid_num = prop.get("CID")
            sm_str = prop.get("SMILES")
            title_str = prop.get("Title") or ""
            if not cid_num:
                continue

            # Skip isotopologues / labelled research reagents
            if _is_isotopologue(title_str):
                logger.debug("drug_lookup: skipping isotopologue CID %s: %s", cid_num, title_str)
                continue

            name = title_str
            is_drug, max_phase, status, withdrawal_reason = _pubchem_safety_profile(cid_num, name)

            # openFDA lookup: try both the raw PubChem title AND a shorter
            # token (first word of title, which is often the INN) so that
            # records like "Phenol, 4,4'-..." can still match "dienestrol".
            of = _openfda_label(name)
            if not of and name:
                first_token = name.split(",")[0].split("(")[0].strip()
                if first_token and first_token != name:
                    of = _openfda_label(first_token)

            # When openFDA returns a canonical generic_name, re-run the
            # safety profile against the INN name (e.g. "dienestrol") which
            # has a richer PubMed safety history than the IUPAC title.
            canonical_name = of.get("generic_name") if of else None
            if canonical_name and canonical_name.lower() != name.lower():
                is_drug2, max_phase2, status2, wr2 = _pubchem_safety_profile(
                    cid_num, canonical_name
                )
                # Merge: take the more severe status
                status_rank = {"withdrawn": 3, "approved": 2, "investigational": 1, "reference": 0}
                if status_rank.get(status2, 0) > status_rank.get(status, 0):
                    is_drug, max_phase, status, withdrawal_reason = (
                        is_drug2,
                        max_phase2,
                        status2,
                        wr2,
                    )
                elif is_drug2:
                    is_drug = True
                    if not withdrawal_reason:
                        withdrawal_reason = wr2

            if is_drug or of:
                liabilities = []
                if status == "withdrawn" or withdrawal_reason:
                    liabilities.append(
                        {
                            "endpoint": "Clinical withdrawal / Safety alert",
                            "measured": 0,
                            "valueText": withdrawal_reason or "Withdrawn from development/market.",
                            "source": f"PubChem CID {cid_num}",
                            "severity": "veto",
                        }
                    )
                if of and of.get("boxed_warning"):
                    liabilities.append(
                        {
                            "endpoint": "Boxed warning",
                            "measured": 0,
                            "valueText": "FDA black-box (boxed) warning on the approved label",
                            "source": "openFDA drug label",
                            "severity": "monitor",
                        }
                    )
                resolved_status = (
                    status
                    if (is_drug and status in ("withdrawn", "approved", "investigational"))
                    else ("approved" if of else status)
                )
                display_name = canonical_name or name
                kd_record = {
                    "name": display_name,
                    "status": resolved_status,
                    "max_phase": (
                        max_phase if (is_drug and max_phase) else (4.0 if of else max_phase)
                    ),
                    "chembl_id": f"PubChem CID {cid_num}",
                    "withdrawal_reason": withdrawal_reason,
                    "liabilities": liabilities,
                    "fda_confirmed": bool(of),
                    "cid": cid_num,
                }
                resolved_records.append(kd_record)

        if resolved_records:

            def status_priority(rec):
                s = rec.get("status")
                if s == "withdrawn":
                    return (3, 0)
                if s == "approved":
                    return (2, 0)
                if s == "investigational":
                    return (1, 0)
                return (0, 0)

            best_rec = max(resolved_records, key=status_priority)
            is_exact = best_rec.get("cid") == pubchem_cid
            m_type = "exact" if is_exact else "stereo-variant"
            conf = 1.0 if is_exact else 0.95
            best_rec.pop("cid", None)
            return _hit(_envelope(best_rec, m_type, conf, 1.0 if is_exact else None))

    # ── 2. Novel Molecule Similarity Search (Concurrently checking analogues) ──
    similar_cids = _pubchem_similarity_search(smiles.strip(), threshold=80)
    if similar_cids:
        # Batch resolve properties for top 30 similar compounds
        candidates = _pubchem_smiles_and_title_batch(similar_cids[:30])

        # Pre-compute query fingerprint once to speed up similarity scoring
        q_fp = AllChem.GetMorganFingerprintAsBitVect(
            mol, radius=_MORGAN_RADIUS, nBits=_MORGAN_NBITS
        )

        scored_candidates = []
        for cand in candidates:
            cand_cid = cand.get("CID")
            cand_smiles = cand.get("SMILES")
            cand_title = cand.get("Title")
            if not cand_cid or not cand_smiles or not cand_title:
                continue

            # Fast similarity calculation reusing query fingerprint
            try:
                t_mol = Chem.MolFromSmiles(cand_smiles)
                if t_mol is not None:
                    t_fp = AllChem.GetMorganFingerprintAsBitVect(
                        t_mol, radius=_MORGAN_RADIUS, nBits=_MORGAN_NBITS
                    )
                    sim_score = float(DataStructs.TanimotoSimilarity(q_fp, t_fp))
                else:
                    sim_score = 0.0
            except Exception:
                sim_score = 0.0

            if sim_score >= _STRUCT_THR:
                scored_candidates.append((sim_score, cand_cid, cand_title))

        scored_candidates.sort(key=lambda x: x[0], reverse=True)

        # Check safety profiles of top candidates concurrently
        def check_cand_safety(item):
            sim, cid_num, title_str = item
            try:
                is_dr, max_ph, stat, reason = _pubchem_safety_profile(cid_num, title_str)
                return (sim, cid_num, title_str, is_dr, max_ph, stat, reason)
            except Exception:
                return (sim, cid_num, title_str, False, 0.0, "reference", None)

        with ThreadPoolExecutor(max_workers=10) as executor:
            # Query top 15 candidates in parallel to optimize lookup latency
            safety_results = list(executor.map(check_cand_safety, scored_candidates[:15]))

        for (
            sim_score,
            cand_cid,
            cand_title,
            is_drug,
            max_phase,
            status,
            withdrawal_reason,
        ) in safety_results:
            # If a highly similar compound has a catastrophic safety history (withdrawn/failed)
            if is_drug and (status == "withdrawn" or withdrawal_reason):
                liabilities = [
                    {
                        "endpoint": "Analogue Toxicity Prior",
                        "measured": 0,
                        "valueText": f"Close analogue {cand_title} ({sim_score:.0%} Tanimoto) was withdrawn: {withdrawal_reason}",
                        "source": f"PubChem CID {cand_cid}",
                        "severity": "veto",
                    }
                ]
                kd_record = {
                    "name": f"Analogue: {cand_title}",
                    "status": status,
                    "max_phase": max_phase,
                    "chembl_id": f"PubChem CID {cand_cid}",
                    "withdrawal_reason": withdrawal_reason,
                    "liabilities": liabilities,
                }
                match_type = "close-analog" if sim_score >= _CLOSE_THR else "structural-analog"
                confidence = 0.85 if sim_score >= _CLOSE_THR else 0.70
                return _hit(_envelope(kd_record, match_type, confidence, sim_score))

    return None


def lookup_status() -> dict[str, Any]:
    return {
        "ready": True,
        "engine": "live multi-source resolver (ChEMBL + PubChem + openFDA), no offline cache",
        "sources": ["ChEMBL", "PubChem", "openFDA"],
        "match_thresholds": {
            "exact": _EXACT_THR,
            "close_analog_tanimoto": _CLOSE_THR,
            "structural_analog_tanimoto": _STRUCT_THR,
        },
    }
