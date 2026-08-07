"""Scientific verdict — the auditable reasoning layer over the safety triage.

WHAT IT IS
──────────
`explain_verdict(smiles)` runs the validated safety verdict (`predict_safety_triage`) and
wraps it in a scientific reasoning trace so that, for the verdict and every endpoint that
fed it, Hakase can answer — with mathematics, code, real measured numbers, and references —
the twelve questions a pharmacologist / regulatory scientist would ask:

  1 why was this prediction made         7  what calibration supports the confidence
  2 what evidence contributed            8  is it within the applicability domain
  3 which models contributed             9  is distribution shift present
  4 how were conflicts reconciled       10  should Hakase abstain
  5 what uncertainty exists             11  what experiment would reduce uncertainty
  6 what assumptions were made          12  scientific justification for every internal number

DESIGN
──────
* It does NOT re-implement the verdict — it composes the existing, validated pipeline
  (`safety_triage`, per-endpoint bundles, conformal gates) with the calibration / shift /
  abstention tools in `hakase_kernel.decision.reasoning`, and looks up every threshold's
  provenance in `hakase_kernel.decision.verdict_provenance`. Nothing is fabricated: every
  calibration number (ECE / Brier / AUROC) is the REAL value stored in the endpoint's
  trained bundle; where a quantity is unavailable it is reported as such, never invented.
* It replaces the one audited heuristic in the *safety* path — the fixed AD cutoff 0.4 —
  with the data-derived cutoff from `hakase_kernel.uncertainty.ad_threshold`, and reports both.
* It emits an `EvidenceRecord` per endpoint (hakase_kernel.decision.reasoning.evidence) with an explicit,
  reasoned abstain decision, and a machine-readable justification table the UI can render so
  every number shown to a user resolves to a definition, a source, and a citation.

This is additive: the existing `/predict/safety-triage` is unchanged; this is the
explainable envelope on top of it, served at `/predict/safety-triage/reasoning`.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

MODULE_VERSION = "1.0.0"

# endpoint_key -> (bundle loader, served-probability dotted path, human method, confirmatory assay)
_ENDPOINT_META = {
    "herg": {
        "label": "hERG cardiotoxicity",
        "method": "RandomForest QSAR on Morgan-1024 + RDKit descriptors, isotonic-calibrated, "
        "FPR-controlled conformal veto (hERG_Karim / TDC).",
        "assay": "automated patch-clamp hERG IC50 (the orthogonal wet-lab confirmation)",
        "dataset": "hERG_Karim (TDC)",
    },
    "dili": {
        "label": "DILI hepatotoxicity",
        "method": "RandomForest QSAR (TDC DILI) fused with reactive-metabolite structural alerts, "
        "AD-gated, isotonic-calibrated.",
        "assay": "hepatocyte / GSH-trapping reactive-metabolite assay",
        "dataset": "DILIrank / TDC DILI",
    },
    "ames": {
        "label": "Ames mutagenicity",
        "method": "RandomForest QSAR on Morgan-1024 (TDC Ames), isotonic-calibrated, conformal veto.",
        "assay": "bacterial reverse-mutation (Ames) test",
        "dataset": "Ames (TDC)",
    },
}

_AD_CACHE: dict[str, Any] = {}
_AD_LOCK = threading.Lock()


# --------------------------------------------------------------------------- #
# Real, measured calibration evidence pulled from the trained bundle
# --------------------------------------------------------------------------- #


def _bundle(endpoint_key: str):
    # Lazy per-key dispatch: cardiotox/dili expose _load_model(); ames uses the _ml_base
    # ModelSpec loader. (A dict literal of all three would eagerly resolve every attribute
    # and fail if any module names its loader differently.)
    if endpoint_key == "herg":
        from hakase_smallmol.cardiotox import cardiotox

        return cardiotox._load_model()
    if endpoint_key == "dili":
        from hakase_smallmol.dili import dili_ml

        return dili_ml._load_model()
    if endpoint_key == "ames":
        import hakase_kernel.base as base
        from hakase_smallmol.safety import ames_ml

        return base.load(ames_ml.SPEC)
    raise KeyError(endpoint_key)


def _calibration_evidence(endpoint_key: str) -> dict[str, Any]:
    """The endpoint's REAL calibration diagnostics, as stored at train time (never invented)."""
    try:
        b = _bundle(endpoint_key)
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": f"bundle unavailable: {type(exc).__name__}"}
    method = b.get("calibration_method")
    ece = b.get("ece_test")
    ece_raw = b.get("ece_test_raw")
    if method is None and ece is None:
        return {"available": False, "reason": "endpoint bundle stores no calibration diagnostics"}
    return {
        "available": True,
        "method": method or "unknown",
        "ece_calibrated": None if ece is None else round(float(ece), 4),
        "ece_raw": None if ece_raw is None else round(float(ece_raw), 4),
        "brier_calibrated": (
            None if b.get("brier_test") is None else round(float(b["brier_test"]), 4)
        ),
        "brier_raw": (
            None if b.get("brier_test_raw") is None else round(float(b["brier_test_raw"]), 4)
        ),
        "test_auroc": None if b.get("test_auroc") is None else round(float(b["test_auroc"]), 4),
        "test_auprc": None if b.get("test_auprc") is None else round(float(b["test_auprc"]), 4),
        "n_test": b.get("n_test"),
        "basis": (
            "calibration measured on a held-out test split at train time (ECE, Naeini 2015; "
            "Brier 1950); a low calibrated ECE is the evidence the probability is trustworthy."
        ),
    }


# --------------------------------------------------------------------------- #
# Applicability domain (data-derived cutoff) + per-query distribution-shift signal
# --------------------------------------------------------------------------- #


def _training_bits(endpoint_key: str):
    """Morgan-bit training matrix for the endpoint, reusing safety_triage's cached FPs."""
    from hakase_smallmol.safety import safety_triage

    return safety_triage._training_fps(endpoint_key)


def _ad_threshold(endpoint_key: str):
    if endpoint_key in _AD_CACHE:
        return _AD_CACHE[endpoint_key]
    with _AD_LOCK:
        if endpoint_key in _AD_CACHE:
            return _AD_CACHE[endpoint_key]
        from hakase_kernel.uncertainty.ad_threshold import derive_ad_threshold

        fps = _training_bits(endpoint_key)
        result = None
        if fps is not None and len(fps) >= 3:
            try:
                result = derive_ad_threshold(np.asarray(fps))
            except Exception as exc:  # noqa: BLE001
                logger.warning("AD threshold derivation failed for %s: %s", endpoint_key, exc)
        _AD_CACHE[endpoint_key] = result
        return result


def _ad_and_shift(endpoint_key: str, canon: str) -> dict[str, Any]:
    """In-domain decision (data-derived cutoff) + a per-query atypicality p-value.

    The atypicality p-value is the conformal p-value of the query's distance-to-training
    within the training set's own nearest-neighbour distances (Vovk 2005): small p ⇒ the
    query is more isolated than almost all training molecules — a per-compound shift signal.
    """
    import hakase_kernel.base as base
    from hakase_kernel.decision.reasoning.ood import conformal_pvalues
    from hakase_kernel.uncertainty.ad_threshold import tanimoto_nearest

    fps = _training_bits(endpoint_key)
    feat = base.featurize(canon)
    if fps is None or feat is None:
        return {"available": False, "reason": "training fingerprints or featurization unavailable"}
    q_bits = np.asarray(feat[: base.MORGAN_NBITS])
    T = np.asarray(fps)
    nearest = tanimoto_nearest(q_bits, T)

    adt = _ad_threshold(endpoint_key)
    if adt is None:
        thr, thr_block = base.AD_THRESHOLD, {
            "ad_threshold": base.AD_THRESHOLD,
            "method": "legacy fixed 0.4 (derivation unavailable)",
        }
    else:
        thr, thr_block = adt.threshold, adt.as_dict()
    in_domain = bool(nearest >= thr)

    # per-query shift/atypicality: reference = training kNN dissimilarity distribution
    atypical_p = None
    try:
        rng = np.random.default_rng(0)
        idx = rng.choice(T.shape[0], size=min(1500, T.shape[0]), replace=False)
        from hakase_kernel.uncertainty.ad_threshold import _tanimoto_matrix_row

        ref_dissim = np.empty(idx.size)
        for i, gi in enumerate(idx):
            sims = _tanimoto_matrix_row(T[gi], T)
            sims[gi] = -1.0
            ref_dissim[i] = 1.0 - float(sims.max())  # nearest-neighbour dissimilarity
        q_dissim = np.array([1.0 - nearest])
        atypical_p = float(conformal_pvalues(ref_dissim, q_dissim)[0])
    except Exception as exc:  # noqa: BLE001
        logger.warning("atypicality p-value failed for %s: %s", endpoint_key, exc)

    return {
        "available": True,
        "ad_tanimoto_nearest": round(nearest, 4),
        "ad_in_domain": in_domain,
        "ad_threshold_used": round(float(thr), 4),
        "ad_threshold_provenance": thr_block,
        "atypicality_pvalue": None if atypical_p is None else round(atypical_p, 4),
        "shift_flag": (atypical_p is not None and atypical_p < 0.05),
        "shift_basis": (
            "conformal p-value of the query's nearest-training dissimilarity within the "
            "training kNN-dissimilarity distribution; p<0.05 ⇒ more isolated than 95% of "
            "training chemistry (per-compound covariate-shift signal, Vovk 2005)."
        ),
    }


# --------------------------------------------------------------------------- #
# Per-endpoint EvidenceRecord
# --------------------------------------------------------------------------- #


def _endpoint_record(endpoint_key: str, sig: dict[str, Any], canon: str) -> dict[str, Any]:
    from hakase_kernel.decision import verdict_provenance as prov
    from hakase_kernel.decision.reasoning.evidence import AbstainPolicy, build_record
    from hakase_kernel.decision.reasoning.reliability import ReliabilityEstimate

    meta = _ENDPOINT_META[endpoint_key]
    cal = _calibration_evidence(endpoint_key)
    ad = _ad_and_shift(endpoint_key, canon)
    prob = sig.get("probability")

    # Reliability of the SAFETY call = the calibration quality of the probability (real ECE),
    # NOT a heuristic dispersion map. We express it as an estimable reliability only when the
    # bundle actually stored a calibrated ECE; otherwise it is honestly not estimable.
    if cal.get("available") and cal.get("ece_calibrated") is not None:
        # A calibrated probability with measured ECE e supports confidence ~ (1 - e) in the
        # probability being on-scale. This is a transparent, measured quantity, not a constant.
        rel_value = float(max(0.0, min(1.0, 1.0 - cal["ece_calibrated"])))
        reliability = ReliabilityEstimate(
            value=rel_value,
            band=("High" if rel_value >= 0.85 else "Medium" if rel_value >= 0.6 else "Low"),
            estimable=True,
            basis=(
                f"probability is {cal['method']}-calibrated; held-out ECE={cal['ece_calibrated']} "
                f"(raw {cal['ece_raw']}), so 1-ECE≈{rel_value:.2f} of the probability mass is on-scale. "
                f"Test AUROC={cal.get('test_auroc')}."
            ),
            in_calibration_range=True,
        )
    else:
        reliability = ReliabilityEstimate(
            None,
            None,
            False,
            "reliability not estimable: this endpoint's bundle stores no calibrated ECE.",
        )

    # SHAP drivers (real attributions) if available, else honest unavailable
    drivers: list = []
    try:
        from hakase_kernel.uncertainty.explain import explain as shap_explain

        model_key = {"herg": "cardiotox", "dili": "dili", "ames": None}.get(endpoint_key)
        if model_key:
            ex = shap_explain(model_key, canon, top_k=5)
            if ex.get("available"):
                drivers = [
                    {
                        "feature": c["feature"],
                        "direction": c["direction"],
                        "shap_value": c["shap_value"],
                    }
                    for c in ex.get("top_contributions", [])
                ]
            else:
                drivers = [{"note": f"SHAP unavailable: {ex.get('reason')}"}]
    except Exception as exc:  # noqa: BLE001
        drivers = [{"note": f"SHAP error: {type(exc).__name__}"}]

    # provenance for every threshold this endpoint's signal used
    used_keys = [
        "veto_alpha",
        "screen_threshold",
        "AD_THRESHOLD",
        "calibration_method",
        "scaffold_split",
    ]
    justification = {k: prov.get(k).as_dict() for k in used_keys if prov.get(k)}

    applicability = None
    shift = None
    if ad.get("available"):
        applicability = {
            "ad_in_domain": ad["ad_in_domain"],
            "ad_tanimoto_nearest": ad["ad_tanimoto_nearest"],
            "ad_threshold_used": ad["ad_threshold_used"],
            "ad_threshold_provenance": ad["ad_threshold_provenance"],
        }
        shift = {
            "shifted": ad["shift_flag"],
            "atypicality_pvalue": ad["atypicality_pvalue"],
            "basis": ad["shift_basis"],
        }

    rec = build_record(
        endpoint=meta["label"],
        prediction={
            "p_active": prob,
            "signal": sig.get("signal"),
            "veto_flag": sig.get("veto_flag"),
            "veto_threshold": sig.get("veto_threshold"),
        },
        method=meta["method"],
        reliability=reliability,
        applicability=applicability,
        shift=shift,
        drivers=drivers,
        corroborating=[c for c in [sig.get("dili_third_opinion"), sig.get("dili_fusion")] if c],
        provenance={
            "dataset": meta["dataset"],
            "split": "Bemis-Murcko scaffold",
            "scaffold_heldout": sig.get("heldout_performance_scaffold"),
            "calibration": cal,
            "thresholds": justification,
            "module": "scientific_verdict",
            "module_version": MODULE_VERSION,
        },
        assumptions=[
            "conformal veto controls FPR on APPROVED drugs, assuming they are exchangeable with the query",
            "applicability domain uses Morgan-fingerprint Tanimoto similarity as the domain metric",
            "single-structure QSAR cannot capture immune-mediated (HLA-restricted) idiosyncratic toxicity",
        ],
        next_experiment={
            "assay": meta["assay"],
            "why": (
                "resolves the dominant uncertainty for this endpoint (out-of-domain / "
                "near-threshold / conflicting signal)"
            ),
        },
        policy=AbstainPolicy(
            require_estimable_reliability=False, require_in_domain=True, abstain_on_shift=True
        ),
    )
    d = rec.to_dict()
    d["calibration_evidence"] = cal
    d["shift_detail"] = shift
    return d


# --------------------------------------------------------------------------- #
# Top-level: the twelve-question reasoning trace
# --------------------------------------------------------------------------- #


def explain_verdict(smiles: str) -> dict[str, Any]:
    """Run the safety verdict and return it wrapped in a full scientific reasoning trace."""
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    t0 = time.time()
    from hakase_kernel.decision import verdict_provenance as prov
    from hakase_smallmol.safety import safety_triage

    verdict = safety_triage.predict_safety_triage(smiles)
    if not verdict.get("ml_available"):
        return {
            "smiles": smiles,
            "ml_available": False,
            "error": verdict.get("error", "verdict unavailable"),
            "reasoning": {"why": "the query could not be parsed / no model available"},
        }
    canon = verdict["smiles"]

    endpoints = verdict.get("endpoints", {})
    records: dict[str, Any] = {}
    for key in ("herg", "dili", "ames"):
        sig = endpoints.get(key)
        if not sig or sig.get("status") not in ("ok", None) or sig.get("probability") is None:
            records[key] = {
                "available": False,
                "reason": (sig or {}).get("reason", "endpoint unavailable"),
            }
            continue
        try:
            records[key] = _endpoint_record(key, sig, canon)
        except Exception as exc:  # noqa: BLE001
            logger.exception("scientific_verdict: endpoint %s failed", key)
            records[key] = {"available": False, "reason": f"{type(exc).__name__}: {exc}"}

    triage = verdict.get("triage", {})
    contributing = [k for k, r in records.items() if r.get("abstain") is not None]
    abstained = [k for k, r in records.items() if r.get("abstain")]
    consensus = verdict.get("consensus", {})

    # ---- the twelve questions, answered from the real pipeline ----
    reasoning = {
        "q1_why": (f"Overall tier {triage.get('tier')}: {triage.get('headline')}"),
        "q2_evidence": {
            k: {
                "signal": (endpoints.get(k) or {}).get("signal"),
                "drivers": records[k].get("drivers"),
            }
            for k in ("herg", "dili", "ames")
            if records.get(k, {}).get("drivers")
        },
        "q3_models": [
            {
                "endpoint": k,
                "method": _ENDPOINT_META[k]["method"],
                "dataset": _ENDPOINT_META[k]["dataset"],
            }
            for k in records
            if k in _ENDPOINT_META
        ],
        "q4_conflict_reconciliation": {
            "rule": verdict.get("governance", {}).get("rules"),
            "third_opinion": (endpoints.get("dili") or {}).get("dili_third_opinion"),
            "note": "deterministic, auditable tier rules — no fabricated composite score.",
        },
        "q5_uncertainty": {
            k: records[k].get("calibration_evidence")
            for k in records
            if isinstance(records.get(k), dict) and records[k].get("calibration_evidence")
        },
        "q6_assumptions": sorted(
            {
                a
                for r in records.values()
                if isinstance(r, dict)
                for a in (r.get("assumptions") or [])
            }
        ),
        "q7_calibration": {
            k: {
                "method": (records[k].get("calibration_evidence") or {}).get("method"),
                "ece_calibrated": (records[k].get("calibration_evidence") or {}).get(
                    "ece_calibrated"
                ),
                "ece_raw": (records[k].get("calibration_evidence") or {}).get("ece_raw"),
            }
            for k in records
            if isinstance(records.get(k), dict)
            and records[k].get("calibration_evidence", {}).get("available")
        },
        "q8_applicability_domain": {
            k: records[k].get("applicability")
            for k in records
            if isinstance(records.get(k), dict) and records[k].get("applicability")
        },
        "q9_distribution_shift": {
            k: records[k].get("shift")
            for k in records
            if isinstance(records.get(k), dict) and records[k].get("shift")
        },
        "q10_abstain": {
            "any": bool(abstained),
            "endpoints_abstained": abstained,
            "reasons": {k: records[k].get("abstain_reasons") for k in abstained},
        },
        "q11_next_experiment": {
            k: records[k].get("next_experiment")
            for k in records
            if isinstance(records.get(k), dict) and records[k].get("next_experiment")
        },
        "q12_internal_justification": {
            "thresholds": prov.as_table(),
            "audit": prov.audit(),
            "note": "every constant/threshold the verdict uses resolves to a definition, source, and citation.",
        },
    }

    return {
        "smiles": canon,
        "ml_available": True,
        "triage": triage,
        "endpoint_reasoning": records,
        "reasoning": reasoning,
        "consensus": consensus,
        "governance": verdict.get("governance"),
        "provenance_audit": prov.audit(),
        "reasoning_time_ms": round((time.time() - t0) * 1000, 2),
        "module_version": MODULE_VERSION,
    }
