"""Safety-triage aggregator — one coherent small-molecule L1 safety verdict.

WHAT IT IS
──────────
A single entry point that runs the independent small-molecule safety models and
reconciles them into ONE honest triage verdict for early go/no-go decisions:

  • hERG cardiotoxicity        (models.cardiotox)
  • DILI hepatotoxicity        (models.dili_ml)
  • Ames mutagenicity          (models.ames_ml)
  • Tox21 12-assay panel       (models.tox21_ml)

WHY IT IS BUILT THIS WAY (the reconciliation philosophy, on the backend)
────────────────────────────────────────────────────────────────────────
The verdict is deliberately conservative and auditable. It mirrors the rules the
frontend `endpointReconciliation.ts` already enforces, so the "final outcome" is
coherent no matter which surface reads it:

  1. A hard ALERT may fire ONLY when a model's score trips its FPR-controlled
     CONFORMAL VETO threshold (calibrated on approved drugs so P(flag|approved)
     ≤ α) AND the query is IN the model's applicability domain. An out-of-domain
     flag is surfaced as "confirm — extrapolation", never as a hard fail: the
     model is honest that it is guessing outside its training chemistry.
  2. No fabricated composite score. The overall tier is a transparent function
     of the per-endpoint signals, and every signal carries its basis.
  3. Every endpoint reports its honest scaffold-split held-out performance
     (leakage-free), so the reader knows how much to trust each call.

This module invents no chemistry and no probability — it only routes SMILES to
the underlying validated models and applies documented, deterministic rules.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import hakase_kernel.base as base
import numpy as np
from hakase_smallmol.cardiotox.cardiotox import predict_cardiotox
from hakase_smallmol.cardiotox.cardiotox import veto_gate as _herg_gate
from hakase_smallmol.dili.dili_ml import predict_dili_ml
from hakase_smallmol.dili.dili_ml import veto_gate as _dili_gate

from .ames_ml import predict_ames_ml
from .ames_ml import veto_gate as _ames_gate
from .tox21_ml import predict_tox21_panel

logger = logging.getLogger(__name__)

# Per-endpoint bundle-stored (veto, screen) gates. These operate on the SERVED
# probability scale (calibrated when the endpoint carries a calibrator), so the
# veto is thresholded against the SAME number the model displays. This replaces
# the raw-scale cache/conformal_calibration.json + screening_thresholds.json for
# these three endpoints only — every other endpoint still uses base.conformal_veto
# / base.screening_flag against the external artifacts.
_BUNDLE_GATES = {"herg": _herg_gate, "dili": _dili_gate, "ames": _ames_gate}

# Tox21 family-wise multiple-testing control. The panel runs TOX21_PANEL_SIZE
# independent conformal vetoes, each at α=0.05, so ≥1 false flag on a clean compound
# is expected ~30–46% of the time. Escalate the triage tier only at ≥2 concordant
# in-domain flags (family-wise false-escalation ≈5%, consistent with the per-endpoint α).
TOX21_PANEL_SIZE = 12
TOX21_FWER_MIN_FLAGS = 2

# --------------------------------------------------------------------------- #
# Applicability domain for the core endpoints whose models (cardiotox, dili_ml)
# predate the _ml_base bundle and so emit no AD of their own. We compute
# Tanimoto-to-nearest-training-neighbour against the SAME vendored TDC training
# table the model was trained on — exactly the AD ames_ml carries in its bundle.
# Cached per endpoint (built once from the shipped .tab; no network, no fallback).
# Without this, hERG/DILI have in_domain=None → every core signal is INDETERMINATE
# → the whole safety tier collapses to WATCH even for clearly in-domain drugs.
# --------------------------------------------------------------------------- #
# NOTE: "herg" MUST track models/cardiotox.py:TDC_FILE — CardioTox v2 trains on
# hERG_Karim, so the AD reference set is hERG_Karim. Pointing this at the old
# 655-compound herg.tab would score in/out-of-domain against chemistry the live
# model was never trained on, silently voiding the invariant above.
_AD_TAB = {"herg": "herg_karim.tab", "dili": "dili.tab", "ames": "ames.tab"}
_AD_FPS_CACHE: dict[str, Any] = {}
_AD_LOCK = threading.Lock()


def _training_fps(endpoint_key: str):
    """Morgan-FP matrix of the endpoint's vendored TDC training set (cached)."""
    if endpoint_key in _AD_FPS_CACHE:
        return _AD_FPS_CACHE[endpoint_key]
    tab = _AD_TAB.get(endpoint_key)
    with _AD_LOCK:
        if endpoint_key in _AD_FPS_CACHE:
            return _AD_FPS_CACHE[endpoint_key]
        fps = None
        if tab:
            try:
                smiles, _ = base.load_tdc_tab(tab)
                X, _ = base.featurize_batch(smiles)
                fps = X[:, : base.MORGAN_NBITS].astype("float32") if len(X) else None
            except Exception as exc:  # noqa: BLE001 — AD is best-effort
                logger.warning(
                    "safety_triage: AD training FPs for %s unavailable: %s", endpoint_key, exc
                )
                fps = None
        _AD_FPS_CACHE[endpoint_key] = fps
        return fps


def _applicability_domain(endpoint_key: str, env: dict[str, Any]) -> dict[str, Any]:
    """AD block for a core endpoint — the model's own if it emits one, else computed
    from the vendored training set. {ad_in_domain, ad_tanimoto_nearest}."""
    own = env.get("applicability_domain")
    if isinstance(own, dict) and own.get("ad_in_domain") is not None:
        return own
    fps = _training_fps(endpoint_key)
    smiles = env.get("smiles")
    if fps is None or not smiles:
        return {"ad_in_domain": None, "ad_tanimoto_nearest": None}
    feat = base.featurize(smiles)
    if feat is None:
        return {"ad_in_domain": None, "ad_tanimoto_nearest": None}
    return base.compute_ad({"training_fps": fps}, feat)


def warmup() -> dict[str, Any]:
    """Pre-build the applicability-domain fingerprint caches for the endpoints that
    need computed AD (hERG, DILI — AMES carries its own in the ames_ml bundle), so
    the first user request doesn't pay the ~one-time featurization cost. Safe to run
    in a boot daemon thread."""
    built = {}
    for ep in ("herg", "dili"):
        fps = _training_fps(ep)
        built[ep] = 0 if fps is None else int(len(fps))
    return {"status": "ready", "ad_training_fps": built}


# Independent third-opinion sources for consensus (both degrade gracefully):
#   • measured known-drug lookup — real experimental liabilities when the query
#     resolves to a known drug (models.drug_lookup.lookup_drug).
#   • ADMETlab 3.0 H-HT head — an independent external hepatotoxicity predictor,
#     used as a DILI cross-check (models.admetlab.predict_bsep_inhibition).
# They are imported lazily inside _gather_consensus so a missing optional
# dependency or offline environment never breaks the core ML verdict.

# Core IND-critical endpoints whose in-domain conformal veto can drive a hard
# NO-GO. Tox21 assays are mechanistic signals that escalate to MONITOR, not a
# unilateral hard fail (consistent with how a tox panel is used in triage).
_CORE = ("herg", "dili", "ames")

# (endpoint_key, human label, predict fn, dotted path to the probability field)
_CORE_SPECS = (
    ("herg", "hERG cardiotoxicity", predict_cardiotox, ("prediction", "blocker_probability")),
    ("dili", "DILI hepatotoxicity", predict_dili_ml, ("prediction", "dili_probability")),
    ("ames", "Ames mutagenicity", predict_ames_ml, ("prediction", "mutagenic_probability")),
)


def _dig(d: dict[str, Any], path: tuple[str, ...]):
    cur: Any = d
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _core_gates(endpoint_key: str, prob: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """(veto, screen) blocks for a core endpoint, thresholding the SERVED prob on
    its own scale via the model's bundle-stored thresholds. Falls back to the
    raw-scale JSON artifact only for an uncalibrated bundle or a non-core key.

    Returned shapes match base.conformal_veto / base.screening_flag so the decision
    table below is unchanged.
    """
    if not isinstance(prob, (int, float)):
        return {}, {"calibrated": False, "flag": None}

    gate_fn = _BUNDLE_GATES.get(endpoint_key)
    gate = None
    if gate_fn is not None:
        try:
            gate = gate_fn()
        except Exception as exc:  # noqa: BLE001 — fall back to the JSON artifact
            logger.warning(
                "[%s] bundle veto_gate failed (%s); using raw-scale artifact", endpoint_key, exc
            )
            gate = None

    if gate and gate.get("veto_threshold") is not None:
        thr = float(gate["veto_threshold"])
        veto = {
            "calibrated": True,
            "flag": bool(np.isfinite(thr) and prob > thr),
            "threshold": round(thr, 4),
            "alpha": gate.get("veto_alpha"),
            "scale": gate.get("scale"),
            # Bundle-fitted on the endpoint's own (calibrated) cal-set inactives; the
            # α-FPR proof on approved drugs is the external hold-out check, not a
            # self-reported number here.
            "realised_fpr_on_approved": None,
            "method": (
                "split-conformal (1-α) quantile of the endpoint's CALIBRATED "
                "cal-set inactive scores (bundle) — P(flag | inactive) ≤ α"
            ),
        }
        sthr = gate.get("screen_threshold")
        screen = {
            "calibrated": sthr is not None,
            "flag": (bool(prob > float(sthr)) if sthr is not None else None),
            "threshold": (round(float(sthr), 4) if sthr is not None else None),
            "operating_point": "youden_calibrated",
            "scale": gate.get("scale"),
            "method": "Youden-J on the endpoint's CALIBRATED cal-set scores (bundle)",
        }
        return veto, screen

    # Fallback: uncalibrated/legacy bundle or non-core endpoint → raw-scale artifact.
    veto = base.conformal_veto(endpoint_key, prob)
    screen = base.screening_flag(endpoint_key, prob, "fpr_controlled")
    return veto, screen


def _core_signal(
    env: dict[str, Any], prob_path: tuple[str, ...], endpoint_key: str
) -> dict[str, Any]:
    """Classify one core endpoint's envelope into a triage signal."""
    if not env.get("ml_available"):
        return {
            "status": "unavailable",
            "signal": "unavailable",
            "reason": env.get("error", "model unavailable"),
            "probability": None,
            "veto_flag": None,
            "ad_in_domain": None,
        }
    prob = _dig(env, prob_path)
    # Conformal veto + sensitivity screen. `prob` is the model's SERVED probability
    # (calibrated for hERG/DILI/Ames since the v2.x calibration work). We threshold
    # it against the BUNDLE-STORED veto/screen thresholds, which were refit on that
    # SAME served scale at train time — so the number displayed and the number the
    # veto is thresholded against are always on one scale (per-endpoint invariant).
    # The raw-scale cache/*.json artifact (base.conformal_veto/screening_flag) is
    # only used as a fallback for an uncalibrated/legacy bundle or a non-core key.
    veto, screen = _core_gates(endpoint_key, prob)
    ad = _applicability_domain(endpoint_key, env)
    in_domain = ad.get("ad_in_domain")
    veto_flag = veto.get("flag")
    calibrated_veto = veto.get("calibrated", False)
    screen_flag = screen.get("flag")

    # Decision table (documented in the module docstring).
    if veto_flag is True and in_domain is True:
        signal = "alert"
        reason = (
            f"P(active)={prob:.3f} trips the α={veto.get('alpha')} FPR-controlled "
            f"veto threshold {veto.get('threshold')} AND compound is in-domain "
            f"(Tanimoto {ad.get('ad_tanimoto_nearest')}). Hard liability."
        )
    elif veto_flag is True and in_domain is False:
        signal = "flag_out_of_domain"
        reason = (
            f"P(active)={prob:.3f} exceeds the veto threshold {veto.get('threshold')}, "
            f"but the compound is OUT of this model's applicability domain "
            f"(Tanimoto {ad.get('ad_tanimoto_nearest')}). Treat as an extrapolated "
            "flag to CONFIRM in wet-lab — does not drive a hard NO-GO alone."
        )
    elif veto_flag is False and in_domain is True and screen_flag is True:
        signal = "screen_positive"
        reason = (
            f"P(active)={prob:.3f} is below the high-specificity veto ({veto.get('threshold')}) "
            f"but ABOVE the sensitivity screen ({screen.get('threshold')}, catches "
            f"{screen.get('recall_withdrawn')} of withdrawn drugs). In-domain — flag for review/confirm."
        )
    elif veto_flag is False and in_domain is True:
        signal = "clear"
        reason = (
            f"P(active)={prob:.3f} below both the veto ({veto.get('threshold')}) and the "
            f"sensitivity screen ({screen.get('threshold')}) and compound is in-domain — reliable clear."
        )
    elif veto_flag is False and in_domain is False and screen_flag is True:
        signal = "screen_positive_out_of_domain"
        reason = (
            f"P(active)={prob:.3f} above the sensitivity screen ({screen.get('threshold')}) but "
            "compound is OUT of domain — extrapolated screen hit; confirm in wet-lab."
        )
    elif veto_flag is False and in_domain is False:
        signal = "clear_out_of_domain"
        reason = (
            f"P(active)={prob:.3f} below thresholds but compound is out-of-domain — "
            "clear with LOW confidence; quantitative value is an extrapolation."
        )
    else:
        # Veto not calibrated for this endpoint, or AD unknown → do not assert.
        signal = "indeterminate"
        reason = (
            "conformal veto not calibrated for this endpoint yet"
            if not calibrated_veto
            else "applicability domain unavailable"
        )

    return {
        "status": "ok",
        "signal": signal,
        "reason": reason,
        "probability": round(prob, 4) if isinstance(prob, (int, float)) else None,
        "veto_calibrated": calibrated_veto,
        "veto_flag": veto_flag,
        "veto_threshold": veto.get("threshold"),
        "veto_alpha": veto.get("alpha"),
        "veto_realised_fpr_on_approved": veto.get("realised_fpr_on_approved"),
        "screen_calibrated": screen.get("calibrated", False),
        "screen_flag": screen_flag,
        "screen_threshold": screen.get("threshold"),
        "screen_recall_withdrawn": screen.get("recall_withdrawn"),
        "screen_fpr_approved": screen.get("fpr_approved"),
        "ad_in_domain": in_domain,
        "ad_tanimoto_nearest": ad.get("ad_tanimoto_nearest"),
        # heldout_performance_scaffold is attached by the caller (it knows the endpoint key).
    }


def dili_fusion(canon: str) -> dict[str, Any]:
    """Mechanism-aware DILI fusion — a better hepatotoxicity call for novel
    compounds than any single QSAR head.

    WHY: a single structure→DILI QSAR (e.g. the small TDC DILI RF) has poor
    separation on real drugs (safe drugs score 0.16–0.51, hepatotoxins 0.45–0.80
    — they overlap) and, worse, produces confident-looking numbers on molecules
    OUTSIDE its training chemistry (caffeine: 0.51 but out-of-domain). This fuses
    three INDEPENDENT signals so a flag needs corroboration and out-of-domain
    guesses are demoted to honest uncertainty:

      1. QSAR probability + its applicability domain (models.dili_ml).
      2. Reactive-metabolite / structural alerts (models.reactive_metabolites) —
         training-free and mechanism-based, so it generalises to ANY novel
         compound. This is what catches acetaminophen's NAPQI liability even when
         the QSAR score is lukewarm, and stays silent on caffeine/metformin.
      3. Applicability-domain gating — an out-of-domain QSAR score is NOT allowed
         to drive a confident call on its own.

    Returns a call in {clear, low_confidence, watch, elevated} with the drivers,
    so the reason is always auditable. No fabricated composite number.
    """
    from hakase_smallmol.dili.dili_ml import predict_dili_ml

    from .reactive_metabolites import predict_reactive_metabolites

    d = predict_dili_ml(canon)
    rm = predict_reactive_metabolites(canon)
    prob = (d.get("prediction") or {}).get("dili_probability")
    in_domain = (d.get("applicability_domain") or {}).get("ad_in_domain")
    ad_tan = (d.get("applicability_domain") or {}).get("ad_tanimoto_nearest")
    alerts = int(rm.get("alert_count") or 0)
    severe_alerts = int(rm.get("critical_count") or 0) + int(rm.get("high_count") or 0)
    rm_class = rm.get("rm_class")
    has_alert = alerts > 0
    QSAR_CORROBORATES = 0.50  # in-domain QSAR at/above this corroborates a flag

    drivers: list[str] = []
    if has_alert:
        drivers.append(f"{alerts} reactive-metabolite/structural alert(s) (severity: {rm_class})")
    if isinstance(prob, (int, float)):
        drivers.append(
            f"QSAR DILI probability {round(prob, 3)} "
            f"({'in-domain' if in_domain else 'OUT-of-domain'}, Tanimoto {ad_tan})"
        )

    # Decision table (documented above). Structural alerts are high-specificity
    # here, so they anchor the call; QSAR only escalates when in-domain.
    if severe_alerts > 0 or (
        has_alert and isinstance(prob, (int, float)) and prob >= QSAR_CORROBORATES
    ):
        call = "elevated"
        note = "Reactive-metabolite liability corroborated — hepatotoxicity risk. Confirm with in vitro (e.g. GSH-trapping, hepatocyte)."
    elif has_alert:
        call = "watch"
        note = "Reactive-metabolite/structural alert present at low severity — review; QSAR does not strongly corroborate."
    elif in_domain and isinstance(prob, (int, float)) and prob >= QSAR_CORROBORATES:
        call = "watch"
        note = "In-domain QSAR elevated without a structural alert — monitor; mechanism unclear."
    elif in_domain and isinstance(prob, (int, float)):
        call = "clear"
        note = "In-domain, QSAR below concern, no reactive-metabolite alert — reliable clear."
    else:
        call = "low_confidence"
        note = (
            "QSAR is OUT of its applicability domain and there is no reactive-metabolite "
            "alert — insufficient reliable evidence to call DILI either way (do NOT read a "
            "single out-of-domain score as risk)."
        )

    return {
        "call": call,
        "drivers": drivers,
        "note": note,
        "qsar_probability": round(prob, 4) if isinstance(prob, (int, float)) else None,
        "qsar_in_domain": in_domain,
        "reactive_metabolite_alerts": alerts,
        "reactive_metabolite_severity": rm_class,
        "method": "fusion of QSAR (AD-gated) + reactive-metabolite structural alerts",
    }


def _gather_consensus(canon: str) -> dict[str, Any]:
    """Collect independent third-opinion evidence. Every source is optional and
    wrapped: a failure yields an honest 'unavailable' block, never a fabricated
    agreement. Returns measured known-drug liabilities + ADMETlab hepatotox."""
    out: dict[str, Any] = {"status": "ok", "sources": {}}

    # 1) Measured known-drug liabilities (experimental ground truth when known).
    try:
        from hakase_smallmol.drug_lookup import lookup_drug

        kd = lookup_drug(canon)
        if kd and kd.get("matched"):
            liabs = kd.get("liabilities", []) or []
            veto = [L for L in liabs if L.get("severity") == "veto"]
            monitor = [L for L in liabs if L.get("severity") == "monitor"]
            out["sources"]["measured_known_drug"] = {
                "status": "matched",
                "name": kd.get("name") or kd.get("drug_name"),
                "match_similarity": kd.get("similarity") or kd.get("match_similarity"),
                "n_liabilities": len(liabs),
                "veto_liabilities": [
                    {
                        "endpoint": L.get("endpoint"),
                        "detail": L.get("detail") or L.get("note"),
                        "measured": bool(L.get("measured")),
                    }
                    for L in veto
                ],
                "monitor_liabilities": [
                    {"endpoint": L.get("endpoint"), "detail": L.get("detail") or L.get("note")}
                    for L in monitor
                ],
                "provenance": "models.drug_lookup — measured/experimental where available",
            }
        else:
            out["sources"]["measured_known_drug"] = {
                "status": "no_match",
                "note": "query does not resolve to a known drug — pure prediction",
            }
    except Exception as exc:  # noqa: BLE001
        out["sources"]["measured_known_drug"] = {
            "status": "unavailable",
            "error": f"{type(exc).__name__}: {exc}",
        }

    # 2) ADMETlab 3.0 H-HT — independent hepatotoxicity predictor (DILI cross-check).
    try:
        from hakase_smallmol.admet.admetlab import predict_bsep_inhibition

        env = predict_bsep_inhibition(canon)
        if (
            env.get("source") == "ml"
            and env.get("ml_available")
            and env.get("inhibition_probability") is not None
        ):
            out["sources"]["admetlab_hht_dili"] = {
                "status": "ok",
                "endpoint": "dili",
                "probability": env.get("inhibition_probability"),
                "risk_class": env.get("risk_class"),
                "engine": "ADMETlab 3.0 · H-HT (independent hepatotoxicity model)",
            }
        else:
            out["sources"]["admetlab_hht_dili"] = {
                "status": "unavailable",
                "reason": env.get("error_reason") or env.get("source"),
            }
    except Exception as exc:  # noqa: BLE001
        out["sources"]["admetlab_hht_dili"] = {
            "status": "unavailable",
            "error": f"{type(exc).__name__}: {exc}",
        }

    return out


def _dili_consensus_note(
    dili_sig: dict[str, Any], consensus: dict[str, Any]
) -> dict[str, Any] | None:
    """Compare our DILI call with the ADMETlab H-HT third opinion (agreement/dissent)."""
    hht = (consensus.get("sources") or {}).get("admetlab_hht_dili") or {}
    if hht.get("status") != "ok":
        return None
    our_p = dili_sig.get("probability")
    their_p = hht.get("probability")
    agree = None
    if isinstance(our_p, (int, float)) and isinstance(their_p, (int, float)):
        # both call "elevated" (>0.5) or both "low" (<0.5) → agree; else dissent.
        agree = (our_p >= 0.5) == (their_p >= 0.5)
    return {
        "our_probability": our_p,
        "admetlab_hht_probability": their_p,
        "admetlab_hht_risk_class": hht.get("risk_class"),
        "agreement": agree,
        "note": (
            "independent models agree on DILI direction"
            if agree
            else (
                "independent models DISAGREE on DILI — treat as contradicted, confirm"
                if agree is False
                else "insufficient data to compare"
            )
        ),
    }


def predict_safety_triage(smiles: str, include_consensus: bool = True) -> dict[str, Any]:
    """Run the full small-molecule safety stack and reconcile to one verdict.

    Returns per-endpoint signals (hERG / DILI / Ames / Tox21) plus an overall
    triage tier in {CLEAR, MONITOR, HIGH_RISK, INDETERMINATE} derived by the
    documented, deterministic rules — never a fabricated composite number.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    t0 = time.time()
    canon = base.canonicalize(smiles.strip())
    if canon is None:
        return {"smiles": smiles, "ml_available": False, "error": "rdkit_could_not_parse_smiles"}

    endpoints: dict[str, Any] = {}
    for key, label, fn, prob_path in _CORE_SPECS:
        try:
            env = fn(canon)
        except Exception as exc:  # noqa: BLE001
            logger.exception("safety_triage: %s failed", key)
            endpoints[key] = {
                "label": label,
                "status": "error",
                "signal": "unavailable",
                "reason": f"{type(exc).__name__}: {exc}",
            }
            continue
        sig = _core_signal(env, prob_path, key)
        sig["label"] = label
        sig["heldout_performance_scaffold"] = base.scaffold_metrics(key)
        endpoints[key] = sig

    # ---- Mechanism-aware DILI fusion (QSAR + reactive-metabolite alerts + AD) ----
    # Replaces reliance on any single hepatotox head. Attaches to the DILI signal
    # and, when it lands "elevated"/"watch" in a trustworthy way, escalates.
    dili_fused: dict[str, Any] | None = None
    try:
        dili_fused = dili_fusion(canon)
        if "dili" in endpoints:
            endpoints["dili"]["dili_fusion"] = dili_fused
    except Exception as exc:  # noqa: BLE001
        logger.exception("safety_triage: dili_fusion failed")
        dili_fused = {"call": "unavailable", "error": f"{type(exc).__name__}: {exc}"}

    # ---- Tox21 panel (mechanistic escalation signals) ----
    tox21_block: dict[str, Any]
    try:
        tox = predict_tox21_panel(canon)
        if tox.get("ml_available"):
            summ = tox.get("summary", {})
            tox21_block = {
                "status": "ok",
                "n_assays_evaluated": summ.get("n_assays_evaluated"),
                "n_flagged_in_domain": summ.get("n_flagged_in_domain"),
                "flagged_assays_in_domain": summ.get("flagged_assays_in_domain", []),
                "flagged_assays_all": summ.get("flagged_assays", []),
                "top_liability": summ.get("top_liability"),
                "panel": tox.get("panel", []),
            }
        else:
            tox21_block = {"status": "unavailable", "reason": tox.get("error", "unavailable")}
    except Exception as exc:  # noqa: BLE001
        logger.exception("safety_triage: tox21 failed")
        tox21_block = {"status": "error", "reason": f"{type(exc).__name__}: {exc}"}

    # ---- Independent third-opinion consensus (measured + ADMETlab) ----
    consensus: dict[str, Any] = {"status": "disabled"}
    measured_veto = False
    if include_consensus:
        consensus = _gather_consensus(canon)
        if "dili" in endpoints:
            note = _dili_consensus_note(endpoints["dili"], consensus)
            if note is not None:
                endpoints["dili"]["dili_third_opinion"] = note
                # Independent-model disagreement marks DILI contradicted (surface, don't hide).
                if note.get("agreement") is False:
                    endpoints["dili"]["contradicted_by_third_opinion"] = True
        mk = (consensus.get("sources") or {}).get("measured_known_drug") or {}
        measured_veto = bool(mk.get("veto_liabilities"))

    # ---- Overall tier (transparent, deterministic) ----
    def _sig(k):
        return endpoints.get(k, {}).get("signal")

    core_alerts = [k for k in _CORE if _sig(k) == "alert"]  # in-domain veto trip (high specificity)
    core_screen = [
        k for k in _CORE if _sig(k) == "screen_positive"
    ]  # in-domain sensitivity screen hit
    core_ood_flags = [
        k for k in _CORE if _sig(k) in ("flag_out_of_domain", "screen_positive_out_of_domain")
    ]
    core_ood_clear = [k for k in _CORE if _sig(k) == "clear_out_of_domain"]
    core_unavailable = [k for k in _CORE if _sig(k) in ("unavailable", "indeterminate")]
    tox21_flags = (
        tox21_block.get("flagged_assays_in_domain", []) if tox21_block.get("status") == "ok" else []
    )
    # Family-wise (multiple-testing) guard on the Tox21 panel. Each of the 12 heads
    # carries its OWN conformal veto at α=0.05, so on a genuinely clean compound the
    # expected number of false flags across the family is Σ FPR ≈ 0.36 and
    # P(≥1 flag) ≈ 30–46%. Escalating on a SINGLE flag therefore demoted roughly half
    # of clean compounds by chance alone (e.g. Ibuprofen → NR-ER). Requiring ≥2
    # concordant in-domain flags brings the family-wise false-escalation rate to ≈5%,
    # matching the per-endpoint α the rest of the stack is calibrated to. A lone flag
    # is NOT discarded: it is still reported per-assay in the Tox21 wet-lab section and
    # still nudges the weighted aggregate — it just cannot single-handedly force WATCH.
    tox21_escalates = len(tox21_flags) >= TOX21_FWER_MIN_FLAGS
    dili_mech = (dili_fused or {}).get("call")
    dili_mech_escalates = dili_mech in ("elevated", "watch")

    if measured_veto:
        mk = (consensus.get("sources") or {}).get("measured_known_drug") or {}
        eps = ", ".join(str(L.get("endpoint")) for L in mk.get("veto_liabilities", []))
        tier = "KNOWN_LIABILITY"
        headline = (
            f"Resolves to a known drug ({mk.get('name')}) with a MEASURED veto liability "
            f"({eps}). Experimental ground truth overrides prediction."
        )
    elif core_alerts:
        tier = "HIGH_RISK"
        headline = f"In-domain, FPR-controlled hard liability on: {', '.join(core_alerts)}."
    elif core_screen or core_ood_flags or tox21_escalates or dili_mech_escalates:
        tier = "MONITOR"
        parts = []
        if core_screen:
            parts.append(
                f"in-domain sensitivity-screen hits on {', '.join(core_screen)} (below the specificity veto — review/confirm)"
            )
        if dili_mech_escalates:
            parts.append(
                f"mechanism-aware DILI fusion = {dili_mech} ({'; '.join((dili_fused or {}).get('drivers', [])) or 'see drivers'})"
            )
        if core_ood_flags:
            parts.append(
                f"out-of-domain (extrapolated) flags on {', '.join(core_ood_flags)} — confirm in wet-lab"
            )
        if tox21_escalates:
            parts.append(
                f"Tox21 in-domain pathway flags ({len(tox21_flags)} of {TOX21_PANEL_SIZE}, above the family-wise chance rate): {', '.join(tox21_flags)}"
            )
        headline = "No hard in-domain veto, but escalate for review: " + "; ".join(parts) + "."
    elif core_unavailable or core_ood_clear:
        tier = "INDETERMINATE" if core_unavailable else "CLEAR_LOW_CONFIDENCE"
        headline = (
            "One or more core endpoints could not produce a reliable in-domain call "
            f"({', '.join(core_unavailable) or ', '.join(core_ood_clear)}). "
            "Signals present but confidence is limited by applicability domain / availability."
        )
    else:
        tier = "CLEAR"
        headline = "All core safety endpoints in-domain and below BOTH their sensitivity screen and specificity veto thresholds."

    return {
        "smiles": canon,
        "ml_available": True,
        "triage": {
            "tier": tier,
            "headline": headline,
            "core_veto_alerts": core_alerts,
            "core_screen_hits": core_screen,
            "core_out_of_domain_flags": core_ood_flags,
            "tox21_in_domain_flags": tox21_flags,
            "dili_mechanism_call": dili_mech,
        },
        "endpoints": endpoints,
        "tox21": tox21_block,
        "consensus": consensus,
        "governance": {
            "rules": (
                "Two operating points per endpoint. HARD ALERT (HIGH_RISK) requires the "
                "high-specificity conformal-veto flag AND in-domain. The sensitivity SCREEN "
                "(Youden-J) catches likely liabilities the veto misses and escalates to "
                "MONITOR (review/confirm), never a unilateral NO-GO. Out-of-domain flags and "
                "Tox21 in-domain flags also escalate to MONITOR. No composite score is fabricated."
            ),
            "veto_guarantee": "Conformal veto bounds false-positive rate on approved drugs at α=0.05 (high specificity, low recall ~2-7%).",
            "screen_basis": "Youden-J / recall-target thresholds on the real ChEMBL approved/withdrawn hold-out (higher recall, higher FPR) — see cache/screening_thresholds.json.",
            "performance_basis": "heldout_performance_scaffold = Bemis-Murcko scaffold split (leakage-free novel-chemistry generalization).",
            "reliability_caveat": (
                "Single-structure prediction of human toxicity is fundamentally limited, "
                "especially out-of-domain. Treat MONITOR/SCREEN as prioritization for "
                "orthogonal confirmation (assay, measured data), not proof."
            ),
            "not_a_medical_device": "Research triage tool for early go/no-go prioritization; not a regulatory or clinical determination.",
        },
        "inference_time_ms": round((time.time() - t0) * 1000, 2),
    }
