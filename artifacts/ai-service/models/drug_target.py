"""Drug-target prediction — API-first, no curated pharmacophore profiles.

This module replaces the previous hybrid that used 5 hand-curated
TARGET_PROFILES (EGFR/BRAF/BCL2/COX2/HDAC) with pharmacophore-QSAR scoring as
Path 1. The curated path was a heuristic — descriptor-box overlap + SMARTS
substructure matching + Tanimoto similarity to one or two reference drugs.
That works for the five molecules it was hand-tuned for and almost nothing
else, so it's been removed.

The single canonical path is now:

  1. ChEMBL similarity search at the chosen Tanimoto threshold (default 70).
  2. For each similar compound, pull measured (IC50 / Ki / Kd / EC50)
     activities and aggregate per ChEMBL target with the SwissTargetPrediction
     pattern: distinct compound hits × similarity-weighted pIC50.
  3. Filter to protein-class targets only (SINGLE PROTEIN / PROTEIN COMPLEX
     / etc.) and resolve UniProt accessions.
  4. Enrich every target with the full UniProt record (protein names, gene
     names, organism, function summary, PDB cross-references, AlphaFold
     entry) so the UI has a complete target dossier without further calls.
  5. Score confidence from three orthogonal signals:
       a. n distinct similar compounds hitting the target
       b. best Tanimoto similarity to the query molecule
       c. best measured potency (pIC50)
     A target with high similarity to many ChEMBL actives that bind potently
     is High confidence; a target supported by a single weak hit is Low.

When the user names a specific UniProt accession (or curated symbol like
"EGFR") but ChEMBL similarity returns no relevant data for THAT target, we
fall back to the trained BindingML regressor (Morgan FP + RDKit descriptors
⊕ ESM-2 t12 35M → Gradient Boosting Regressor) for a learned pKd estimate
rather than fabricating a heuristic score.

Project policy:
  * No fake data, no silent fallbacks.
  * Every prediction carries a `data_source` tag so the consumer always
    knows whether it came from ChEMBL measurements, ML inference, or both.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

API_SERVER_URL = os.environ.get("API_SERVER_URL", "http://localhost:8080")
UNIPROT_BASE = "https://rest.uniprot.org/uniprotkb"
UNIPROT_SEARCH = "https://rest.uniprot.org/uniprotkb/search"

# UniProt accession regex (https://www.uniprot.org/help/accession_numbers).
import re
UNIPROT_ACCESSION_RE = re.compile(
    r"^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$"
)


def _is_uniprot_accession(s: str | None) -> bool:
    if not s:
        return False
    return bool(UNIPROT_ACCESSION_RE.match(s.strip().upper()))


# ───────────────────────────────────────────────────────────────────────────
# Low-level HTTP helpers
# ───────────────────────────────────────────────────────────────────────────

def _http_get_json(url: str, timeout: float = 12.0) -> dict | None:
    """GET ``url`` and parse JSON. Returns None on any failure (network, non-2xx, parse)."""
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        logger.debug("HTTP GET failed for %s (%s)", url, exc)
        return None


def _fetch_chembl_similar_targets(
    smiles: str, threshold: int = 70, limit: int = 25,
) -> dict | None:
    """Hit the api-server proxy `/api/chembl/similar-targets/v2` (preferred) or v1.

    v2 returns full per-target measurement payloads (range, geometric mean,
    species, assay format, derived confidence tier). v1 is the legacy
    'best activity only' shape. We try v2 first and fall back to v1.

    Returns:
        the parsed JSON dict, or ``None`` on hard failure so the caller can
        decide whether to surface "service unreachable" or run the ML fallback.
    """
    qs = urllib.parse.urlencode({"smiles": smiles, "threshold": threshold, "limit": limit})
    for path in (f"/api/chembl/similar-targets/v2?{qs}", f"/api/chembl/similar-targets?{qs}"):
        data = _http_get_json(f"{API_SERVER_URL}{path}", timeout=60.0)
        if data is not None:
            return data
    return None


def _fetch_uniprot_record(accession: str) -> dict | None:
    """Pull the full UniProt JSON for an accession (cached server-side at UniProt)."""
    if not _is_uniprot_accession(accession):
        return None
    return _http_get_json(
        f"{UNIPROT_BASE}/{urllib.parse.quote(accession)}.json"
        "?fields=accession,id,protein_name,gene_names,organism_name,length,cc_function,xref_pdb,xref_alphafolddb",
        timeout=10.0,
    )


def _resolve_symbol_to_uniprot(symbol: str) -> str | None:
    """Resolve a gene symbol (e.g. 'EGFR') to a reviewed human UniProt accession.

    Uses the UniProt search API with a strict filter for reviewed (Swiss-Prot)
    Homo sapiens entries so we get the canonical accession, not a fragment or
    isoform. Returns None if no unambiguous reviewed entry exists.
    """
    if not symbol:
        return None
    sym = symbol.strip()
    if _is_uniprot_accession(sym):
        return sym.upper()
    qs = urllib.parse.urlencode({
        "query": f"gene_exact:{sym} AND organism_id:9606 AND reviewed:true",
        "format": "json",
        "fields": "accession",
        "size": "1",
    })
    data = _http_get_json(f"{UNIPROT_SEARCH}?{qs}", timeout=8.0)
    try:
        results = (data or {}).get("results") or []
        if results:
            acc = results[0].get("primaryAccession")
            return acc.upper() if acc else None
    except Exception:  # noqa: BLE001
        return None
    return None


def _format_uniprot_payload(rec: dict | None) -> dict:
    """Flatten the UniProt JSON record into a UI-friendly dossier."""
    if not rec:
        return {}
    protein_name = None
    try:
        protein_name = (
            rec.get("proteinDescription", {})
               .get("recommendedName", {})
               .get("fullName", {})
               .get("value")
        )
    except Exception:  # noqa: BLE001
        protein_name = None

    gene_names: list[str] = []
    try:
        for g in rec.get("genes") or []:
            primary = (g.get("geneName") or {}).get("value")
            if primary:
                gene_names.append(primary)
            for syn in (g.get("synonyms") or []):
                v = syn.get("value")
                if v:
                    gene_names.append(v)
    except Exception:  # noqa: BLE001
        pass

    organism = None
    try:
        organism = (rec.get("organism") or {}).get("scientificName")
    except Exception:  # noqa: BLE001
        organism = None

    function_text = None
    try:
        for cc in rec.get("comments") or []:
            if cc.get("commentType") == "FUNCTION":
                texts = cc.get("texts") or []
                if texts:
                    function_text = texts[0].get("value")
                    break
    except Exception:  # noqa: BLE001
        pass

    pdb_ids: list[str] = []
    alphafold_id: str | None = None
    try:
        for x in rec.get("uniProtKBCrossReferences") or []:
            db = x.get("database")
            if db == "PDB":
                pid = x.get("id")
                if pid:
                    pdb_ids.append(pid)
            elif db == "AlphaFoldDB":
                alphafold_id = x.get("id") or alphafold_id
    except Exception:  # noqa: BLE001
        pass

    return {
        "accession":   rec.get("primaryAccession"),
        "entryName":   rec.get("uniProtkbId"),
        "proteinName": protein_name,
        "geneNames":   gene_names,
        "organism":    organism,
        "length":      rec.get("sequence", {}).get("length") if isinstance(rec.get("sequence"), dict) else None,
        "function":    function_text,
        "pdbIds":      pdb_ids[:25],
        "pdbCount":    len(pdb_ids),
        "alphafold":   alphafold_id,
    }


# ───────────────────────────────────────────────────────────────────────────
# Confidence scoring
# ───────────────────────────────────────────────────────────────────────────

def _confidence_from_chembl(
    *, similarity_pct: float, hits: int, pic50: float, quality_tier: str | None,
) -> tuple[float, str]:
    """Combine three orthogonal signals into a single 0..1 confidence + label.

    similarity_pct : best Tanimoto % to a ChEMBL active   → ceiling 0.55
    hits           : distinct similar compounds hitting     → ceiling 0.25
    pic50          : best measured potency                  → ceiling 0.20
    quality_tier   : 'high'/'medium'/'low' from v2 endpoint → multiplier
    """
    s = similarity_pct / 100.0
    sim_term = min(0.55, max(0.0, (s - 0.5) * 1.1))  # 50% sim → 0; 100% sim → 0.55
    hits_term = min(0.25, hits / 5 * 0.25)            # 5+ hits → max
    if pic50 >= 8:
        pic50_term = 0.20
    elif pic50 >= 7:
        pic50_term = 0.15
    elif pic50 >= 6:
        pic50_term = 0.10
    elif pic50 >= 5:
        pic50_term = 0.05
    else:
        pic50_term = 0.0
    raw = sim_term + hits_term + pic50_term
    if quality_tier == "high":
        raw = min(0.99, raw * 1.10 + 0.05)
    elif quality_tier == "low":
        raw = raw * 0.85

    raw = max(0.0, min(0.99, raw))
    if raw >= 0.65:
        label = "High"
    elif raw >= 0.35:
        label = "Medium"
    else:
        label = "Low"
    return round(raw, 3), label


# ───────────────────────────────────────────────────────────────────────────
# ML fallback
# ───────────────────────────────────────────────────────────────────────────

def _ml_binding_for_uniprot(smiles: str, uniprot: str) -> dict | None:
    """Run the trained BindingML head against a (SMILES, UniProt) pair.

    Returns the prediction subset {pKd, Kd_nM, affinity_class} or None on any
    failure. Imported lazily so a circular import or missing torch doesn't
    break the rest of this module.
    """
    try:
        from .binding_ml import predict_binding_ml  # local import to avoid cycle
        result = predict_binding_ml(smiles, uniprot)
    except Exception as exc:  # noqa: BLE001
        logger.warning("BindingML fallback failed for %s/%s (%s)", smiles, uniprot, exc)
        return None
    if not result or result.get("source") != "ml":
        return None
    return result.get("prediction") or None


# ───────────────────────────────────────────────────────────────────────────
# Public API
# ───────────────────────────────────────────────────────────────────────────

def predict_binding(smiles: str, target_id: str | None = None) -> dict:
    """Drug-target binding prediction.

    Strategy (single canonical path):
      1. Query ChEMBL similar-targets v2 (with v1 fallback) — every result is
         experimentally measured, weighted by similarity to the input molecule.
      2. If the caller named a specific target (UniProt accession or gene
         symbol that we can resolve to UniProt), filter to that target.
      3. Enrich every surfaced target with its full UniProt dossier
         (protein names, gene symbols, function summary, PDB ids, AlphaFold).
      4. If a UniProt was requested but ChEMBL returned no measured data for
         it, call the trained BindingML regressor (Morgan FP + RDKit
         descriptors ⊕ ESM-2 t12 35M → GBR) as an ML second-opinion. Never
         falls back to fabricated pharmacophore scores.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    smiles = smiles.strip()

    # ── Resolve `target_id` to a canonical UniProt accession if possible.
    requested_uniprot: str | None = None
    if target_id and target_id.strip():
        if _is_uniprot_accession(target_id):
            requested_uniprot = target_id.strip().upper()
        else:
            requested_uniprot = _resolve_symbol_to_uniprot(target_id.strip())

    # ── 1. ChEMBL similarity → activity aggregation → UniProt → PDB
    chembl = _fetch_chembl_similar_targets(smiles, threshold=70, limit=25)

    if chembl is None:
        # Hard network failure. Don't fabricate — surface the failure to the caller.
        return _service_unreachable_envelope(smiles, target_id, requested_uniprot)

    targets_list = chembl.get("targets") or []

    # ── 2. Optional target filter (strict — empty means honest "no measured data")
    if requested_uniprot:
        targets_list = [
            t for t in targets_list
            if (t.get("uniprotId") or "").upper() == requested_uniprot
        ]

    # ── 3. Score every surviving target
    results: list[dict] = []
    for t in targets_list:
        ic50_nm = float(t.get("bestValue_nM") or 0.0)
        if ic50_nm <= 0:
            continue
        pic50 = float(9 - np.log10(ic50_nm))
        sim_pct = float(t.get("bestSimilarity") or 0.0)
        hits = int(t.get("hits") or 1)
        quality = (t.get("quality") or {}).get("payload", {}).get("confidence") if isinstance(t.get("quality"), dict) else None

        prob, conf = _confidence_from_chembl(
            similarity_pct=sim_pct, hits=hits, pic50=pic50, quality_tier=quality,
        )

        evidence: list[str] = [
            f"ChEMBL measured {t.get('bestActivityType', 'IC50')} = {ic50_nm:.1f} nM "
            f"(pIC50 = {pic50:.2f})",
        ]
        if t.get("bestSourceName") or t.get("bestSourceChemblId"):
            src = t.get("bestSourceName") or t.get("bestSourceChemblId")
            evidence.append(
                f"Inferred from {sim_pct:.0f}% similar molecule: {src}"
            )
        if hits:
            evidence.append(
                f"{hits} similar compound{'s' if hits != 1 else ''} in ChEMBL active against this target"
            )
        if t.get("pdbCount"):
            pdb_preview = ", ".join((t.get("pdbIds") or [])[:3])
            evidence.append(
                f"{t.get('pdbCount')} PDB structure(s) available"
                + (f" (e.g. {pdb_preview})" if pdb_preview else "")
            )
        if isinstance(t.get("quality"), dict):
            payload = t["quality"].get("payload") or {}
            n_meas = payload.get("nMeasurements")
            n_dist = payload.get("distinctCompounds")
            if n_meas:
                evidence.append(
                    f"{n_meas} measurement{'s' if n_meas != 1 else ''} across "
                    f"{n_dist or 1} distinct compound{'s' if (n_dist or 1) != 1 else ''}"
                )
            tier = payload.get("confidence")
            if tier:
                evidence.append(f"Source-quality tier: {tier}")

        # UniProt dossier enrichment — best-effort, never blocks the response.
        uniprot_acc = t.get("uniprotId")
        dossier = _format_uniprot_payload(_fetch_uniprot_record(uniprot_acc)) if uniprot_acc else {}

        results.append({
            "target_id":      t.get("targetChemblId") or uniprot_acc or "?",
            "uniprot":        uniprot_acc,
            "target_name":    t.get("targetName"),
            "target_class":   t.get("targetType") or "Protein",
            "gene_name":      t.get("geneName") or (dossier.get("geneNames") or [None])[0],
            "organism":       t.get("organism") or dossier.get("organism"),
            "binding_probability": prob,
            "estimated_pIC50":     round(pic50, 2),
            "estimated_IC50_nM":   round(ic50_nm, 1),
            "confidence":          conf,
            "evidence":            evidence,
            "pdb_ids":             t.get("pdbIds") or dossier.get("pdbIds") or [],
            "pdb_count":           t.get("pdbCount") or dossier.get("pdbCount") or 0,
            "alphafold":           dossier.get("alphafold"),
            "function_summary":    dossier.get("function"),
            "uniprot_dossier":     dossier or None,
            "similarity_pct":      round(sim_pct, 1),
            "data_source":         "ChEMBL similarity (measured activity)",
        })

    results.sort(key=lambda r: r["estimated_pIC50"], reverse=True)

    # ── 4. If the caller asked for a specific UniProt and we have no ChEMBL
    #       evidence for it, run the trained BindingML regressor as an
    #       independent ML second-opinion (NOT a fabricated heuristic).
    if requested_uniprot and not results:
        ml_pred = _ml_binding_for_uniprot(smiles, requested_uniprot)
        dossier = _format_uniprot_payload(_fetch_uniprot_record(requested_uniprot))
        if ml_pred and ml_pred.get("pKd_predicted") is not None:
            pkd = float(ml_pred["pKd_predicted"])
            kd_nM = ml_pred.get("Kd_nM")
            results.append({
                "target_id":      requested_uniprot,
                "uniprot":        requested_uniprot,
                "target_name":    dossier.get("proteinName"),
                "target_class":   "Protein",
                "gene_name":      (dossier.get("geneNames") or [None])[0],
                "organism":       dossier.get("organism"),
                "binding_probability": _confidence_from_pkd(pkd),
                "estimated_pKd":       round(pkd, 2),
                "estimated_Kd_nM":     round(float(kd_nM), 2) if kd_nM is not None else None,
                "estimated_IC50_nM":   round(float(kd_nM), 2) if kd_nM is not None else None,  # approx Kd≈IC50 for the UI
                "estimated_pIC50":     round(pkd, 2),
                "confidence":          ml_pred.get("affinity_class") or "Medium",
                "evidence": [
                    "No ChEMBL similar-compound measurement data for this UniProt — "
                    "predicted by BindingML (Morgan FP + RDKit descriptors ⊕ ESM-2 → GBR).",
                    f"Predicted pKd = {pkd:.2f}  "
                    f"({ml_pred.get('affinity_class') or 'unscored'})",
                ],
                "pdb_ids":          dossier.get("pdbIds") or [],
                "pdb_count":        dossier.get("pdbCount") or 0,
                "alphafold":        dossier.get("alphafold"),
                "function_summary": dossier.get("function"),
                "uniprot_dossier":  dossier or None,
                "data_source":      "BindingML (learned regressor, ESM-2 features)",
            })
            return {
                "smiles": smiles,
                "predictions": results,
                "model_info": {
                    "engine":            "HakaseAI DrugTarget-Predictor v2.0",
                    "method":            "BindingML fallback (no ChEMBL evidence for requested UniProt)",
                    "targets_screened":  1,
                    "requested_target":  target_id,
                    "resolved_uniprot":  requested_uniprot,
                    "status":            "ml_fallback",
                },
            }

        # ML fallback also unavailable → honest empty result, never invent.
        return {
            "smiles": smiles,
            "predictions": [],
            "model_info": {
                "engine":            "HakaseAI DrugTarget-Predictor v2.0",
                "method":            "ChEMBL similarity (target-filtered) → no ML fallback available",
                "targets_screened":  0,
                "requested_target":  target_id,
                "resolved_uniprot":  requested_uniprot,
                "status":            "requested_target_not_found",
                "note":              (
                    "No ChEMBL similar-molecule activity data linking this compound to "
                    f"UniProt {requested_uniprot}, and the BindingML regressor was "
                    "unavailable (model failed to load or sequence fetch failed)."
                ),
            },
        }

    return {
        "smiles": smiles,
        "predictions": results,
        "model_info": {
            "engine":  "HakaseAI DrugTarget-Predictor v2.0",
            "method": (
                "ChEMBL similarity → measured activity aggregation → UniProt dossier "
                "(protein/gene names, function, PDB, AlphaFold) → confidence scoring "
                "from (similarity, distinct-hits, pIC50, source-quality tier)"
            ),
            "targets_screened":         len(results),
            "similar_compounds_queried": chembl.get("similarCount", 0),
            "similarity_threshold_pct":  chembl.get("threshold", 70),
            "version_used":              chembl.get("version", "v1"),
            "requested_target":          target_id,
            "resolved_uniprot":          requested_uniprot,
            "status":                    "found" if results else "no_targets",
        },
    }


def _confidence_from_pkd(pkd: float) -> float:
    """Crude monotonic mapping pKd → 0..1 confidence for the ML fallback path."""
    if pkd >= 9:
        return 0.95
    if pkd >= 8:
        return 0.85
    if pkd >= 7:
        return 0.70
    if pkd >= 6:
        return 0.50
    if pkd >= 5:
        return 0.30
    return 0.15


def _service_unreachable_envelope(
    smiles: str, target_id: str | None, requested_uniprot: str | None,
) -> dict:
    """Surface a hard network failure honestly — no fabricated predictions."""
    return {
        "smiles": smiles,
        "predictions": [],
        "model_info": {
            "engine":            "HakaseAI DrugTarget-Predictor v2.0",
            "method":            "ChEMBL similarity (unavailable)",
            "targets_screened":  0,
            "requested_target":  target_id,
            "resolved_uniprot":  requested_uniprot,
            "status":            "service_unreachable",
            "error": (
                "ChEMBL similarity service is unreachable. No predictions returned. "
                "Per project policy this endpoint will NOT fabricate heuristic scores."
            ),
        },
    }
