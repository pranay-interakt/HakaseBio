"""Layer-1 in-vitro panel — state-of-the-art ML prediction of wet-lab readouts.

Given a valid small-molecule SMILES this returns a COMPLETE, numeric in-vitro
panel plus a GO / WATCH / NO-GO verdict — for novel compounds, every time.
There is no "insufficient" / "unavailable" state for a valid molecule: each
readout is a real ML prediction, annotated with an applicability-domain
confidence rather than suppressed.

Prediction sources (all real, open models already in this service):
  * ADMET-AI (Chemprop GNN ensemble, 41 TDC endpoints) — the regression models
    ARE the in-vitro assays: Caco-2 permeability, aqueous solubility, PPB,
    VDss, hepatocyte clearance, half-life, CYP1A2/2C9/2C19/2D6/3A4 inhibition,
    hERG, AMES, DILI, ClinTox, carcinogenicity, HIA, Pgp, bioavailability, BBB.
  * CardioTox (RF) — independent hERG second opinion; consensus with ADMET-AI.
  * DILI-ML (RF) — independent DILI second opinion; consensus with ADMET-AI.
  * Applicability domain (Tanimoto NN + physchem) — per-readout confidence.

Honesty contract (unchanged from the rest of the platform):
  * A structurally INVALID SMILES is the only input that does not yield numbers
    (raises ValueError → 4xx). We do not fabricate for garbage input.
  * If the ADMET-AI engine is not provisioned in the deployment, we raise a
    clear operational error (RuntimeError → 503) instead of inventing values.
    The fix is to install/warm the model — not to fake output.
  * Units are converted with documented, unit-tested transforms; probabilities
    are reported as probabilities with qualitative bands, never as fake IC50s.
"""

from __future__ import annotations

import logging
import math
from typing import Any

logger = logging.getLogger(__name__)

MODULE_VERSION = "1.2.0"  # v1.2: live in-memory calibration (no on-disk JSON); safety thresholds fitted at warmup


# --------------------------------------------------------------------------- #
# Unit conversions (pure, unit-tested)
# --------------------------------------------------------------------------- #


def caco2_log_to_papp_e6(log_papp_cm_s: float) -> float:
    """ADMET-AI Caco2_Wang is log10(Papp / cm·s⁻¹). Return Papp in 1e-6 cm/s."""
    return 10.0 ** (log_papp_cm_s + 6.0)


def logS_to_mg_per_ml(log_s_mol_l: float, mw_g_mol: float) -> float:
    """AqSolDB logS is log10(S / mol·L⁻¹). mg/mL = 10^logS · MW (g/L == mg/mL)."""
    return (10.0**log_s_mol_l) * mw_g_mol


def ppbr_to_fu_percent(percent_bound: float) -> float:
    """PPBR_AZ is % bound → fraction-unbound percent."""
    return max(0.0, min(100.0, 100.0 - percent_bound))


def prob_band(p: float, hi: float, watch: float, *, high_is_bad: bool = True) -> str:
    """Qualitative band for a probability endpoint."""
    if high_is_bad:
        if p >= hi:
            return "High"
        if p >= watch:
            return "Moderate"
        return "Low"
    # high_is_good (e.g. HIA, bioavailability)
    if p >= hi:
        return "High"
    if p >= watch:
        return "Moderate"
    return "Low"


def _num(v: Any) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# Readout assembly
# --------------------------------------------------------------------------- #


def _readout(
    value: float | None,
    unit: str,
    source: str,
    qualitative: str | None = None,
    probability: float | None = None,
    note: str = "",
) -> dict[str, Any]:
    return {
        "value": None if value is None else round(value, 4),
        "unit": unit,
        "qualitative": qualitative,
        "probability": None if probability is None else round(probability, 4),
        "source": source,
        "note": note,
    }


def _consensus(p_a: float | None, p_b: float | None) -> float | None:
    vals = [p for p in (p_a, p_b) if p is not None]
    return sum(vals) / len(vals) if vals else None


def build_panel(
    flat: dict[str, Any],
    mw: float | None,
    cardiotox_prob: float | None,
    dili_prob_2nd: float | None,
) -> dict[str, Any]:
    """Map ADMET-AI flat endpoints (+ second opinions) to in-vitro readouts."""
    g = lambda k: _num(flat.get(k))  # noqa: E731

    # ── Absorption ────────────────────────────────────────────────────────
    caco2 = g("Caco2_Wang")
    sol = g("Solubility_AqSolDB")
    absorption = {
        "caco2_papp": _readout(
            caco2_log_to_papp_e6(caco2) if caco2 is not None else None,
            "×10⁻⁶ cm/s",
            "ADMET-AI/Caco2_Wang",
            qualitative=(None if caco2 is None else ("High" if caco2 > -5.15 else "Low")),
            note="Caco-2 apparent permeability; >~7×10⁻⁶ cm/s = high permeability.",
        ),
        "solubility_mg_ml": _readout(
            logS_to_mg_per_ml(sol, mw) if (sol is not None and mw) else None,
            "mg/mL",
            "ADMET-AI/Solubility_AqSolDB",
            qualitative=(None if sol is None else ("High" if sol > -4 else "Low")),
            note="Aqueous kinetic solubility from logS.",
        ),
        "logS": _readout(sol, "log mol/L", "ADMET-AI/Solubility_AqSolDB"),
        "logD": _readout(
            g("Lipophilicity_AstraZeneca"), "logD7.4", "ADMET-AI/Lipophilicity_AstraZeneca"
        ),
        "hia_prob": _prob_readout(
            g("HIA_Hou"), "ADMET-AI/HIA_Hou", high_is_bad=False, label="Human intestinal absorption"
        ),
        "pgp_substrate_prob": _prob_readout(
            g("Pgp_Broccatelli"),
            "ADMET-AI/Pgp_Broccatelli",
            high_is_bad=True,
            label="P-gp substrate",
        ),
        "bioavailability_prob": _prob_readout(
            g("Bioavailability_Ma"),
            "ADMET-AI/Bioavailability_Ma",
            high_is_bad=False,
            label="Oral bioavailability >20%",
        ),
        "pampa_prob": _prob_readout(
            g("PAMPA_NCATS"),
            "ADMET-AI/PAMPA_NCATS",
            high_is_bad=False,
            label="PAMPA passive permeability (high = permeable)",
        ),
        "hydration_free_energy": _readout(
            g("HydrationFreeEnergy_FreeSolv"),
            "kcal/mol",
            "ADMET-AI/HydrationFreeEnergy_FreeSolv",
            note="FreeSolv hydration free energy (solvation context).",
        ),
    }

    # ── Distribution ──────────────────────────────────────────────────────
    ppbr = g("PPBR_AZ")
    distribution = {
        "plasma_fu_percent": _readout(
            ppbr_to_fu_percent(ppbr) if ppbr is not None else None,
            "% unbound",
            "ADMET-AI/PPBR_AZ",
            note="Fraction unbound in plasma (100 − % bound).",
        ),
        # VDss is served by models/vdss_ml.py (log10-target RF), NOT ADMET-AI —
        # admet_ml.predict_admet_ml patches the flat map before we read it.
        # ADMET-AI's own VDss head scores a NEGATIVE benchmark R² (-1.21), i.e.
        # worse than predicting the mean, so crediting it here would be both
        # wrong and misleading about where the number came from.
        "vdss": _readout(g("VDss_Lombardo"), "L/kg", "Hakase/VDss-ML (RF, log10 target)"),
        "bbb_prob": _prob_readout(
            g("BBB_Martins"),
            "ADMET-AI/BBB_Martins",
            high_is_bad=False,
            label="Blood-brain barrier penetration",
        ),
    }

    # ── Metabolism (CYP inhibition panel) ─────────────────────────────────
    metabolism = {"cyp_panel": {}}
    for iso, key in [
        ("CYP1A2", "CYP1A2_Veith"),
        ("CYP2C9", "CYP2C9_Veith"),
        ("CYP2C19", "CYP2C19_Veith"),
        ("CYP2D6", "CYP2D6_Veith"),
        ("CYP3A4", "CYP3A4_Veith"),
    ]:
        p = g(key)
        metabolism["cyp_panel"][iso] = _prob_readout(
            p, f"ADMET-AI/{key}", high_is_bad=True, label=f"{iso} inhibition"
        )
    # CYP substrate heads (CarbonMangels) — metabolic fate / which isoform clears
    # the drug. Informational context for DDI interpretation, not a liability by
    # itself (being a substrate is normal), so surfaced but not hard-thresholded.
    metabolism["cyp_substrate"] = {}
    for iso, key in [
        ("CYP2C9", "CYP2C9_Substrate_CarbonMangels"),
        ("CYP2D6", "CYP2D6_Substrate_CarbonMangels"),
        ("CYP3A4", "CYP3A4_Substrate_CarbonMangels"),
    ]:
        metabolism["cyp_substrate"][iso] = _prob_readout(
            g(key), f"ADMET-AI/{key}", high_is_bad=True, label=f"{iso} substrate"
        )

    # ── Excretion ─────────────────────────────────────────────────────────
    excretion = {
        "hepatocyte_clint": _readout(
            g("Clearance_Hepatocyte_AZ"),
            "mL/min/kg",
            "ADMET-AI/Clearance_Hepatocyte_AZ",
            note="Intrinsic hepatocyte clearance.",
        ),
        "microsome_clint": _readout(
            g("Clearance_Microsome_AZ"),
            "mL/min/kg",
            "ADMET-AI/Clearance_Microsome_AZ",
            note="Intrinsic microsomal clearance (metabolic-stability cross-check).",
        ),
        # Served by models/half_life_ml.py (log10-target RF), NOT ADMET-AI —
        # same rationale as `vdss` above (ADMET-AI benchmark R² = -2.39).
        "half_life_h": _readout(
            g("Half_Life_Obach"), "hours", "Hakase/HalfLife-ML (RF, log10 target)"
        ),
    }

    # ── Toxicity / safety (with consensus for hERG + DILI) ────────────────
    herg_admet = g("hERG")
    herg_cons = _consensus(herg_admet, cardiotox_prob)
    dili_admet = g("DILI")
    dili_cons = _consensus(dili_admet, dili_prob_2nd)
    toxicity = {
        "herg": _prob_readout(
            herg_cons,
            "ADMET-AI/hERG + CardioTox (consensus)",
            high_is_bad=True,
            label="hERG blockade",
            extra={"admet_ai": herg_admet, "cardiotox": cardiotox_prob},
        ),
        "dili": _prob_readout(
            dili_cons,
            "ADMET-AI/DILI + DILI-ML (consensus)",
            high_is_bad=True,
            label="Drug-induced liver injury",
            extra={"admet_ai": dili_admet, "dili_ml": dili_prob_2nd},
        ),
        "ames": _prob_readout(
            g("AMES"), "ADMET-AI/AMES", high_is_bad=True, label="Ames mutagenicity"
        ),
        "clintox": _prob_readout(
            g("ClinTox"), "ADMET-AI/ClinTox", high_is_bad=True, label="Clinical toxicity"
        ),
        "carcinogenicity": _prob_readout(
            g("Carcinogens_Lagunin"),
            "ADMET-AI/Carcinogens_Lagunin",
            high_is_bad=True,
            label="Carcinogenicity",
        ),
        "skin_sensitization": _prob_readout(
            g("Skin_Reaction"),
            "ADMET-AI/Skin_Reaction",
            high_is_bad=True,
            label="Skin sensitization",
        ),
        "ld50": _readout(
            g("LD50_Zhu"),
            "log mol/kg (model native)",
            "ADMET-AI/LD50_Zhu",
            note="Acute oral toxicity; model-native units (not converted to mg/kg to avoid false precision).",
        ),
    }

    return {
        "absorption": absorption,
        "distribution": distribution,
        "metabolism": metabolism,
        "excretion": excretion,
        "toxicity": toxicity,
    }


def _prob_readout(
    p: float | None,
    source: str,
    *,
    high_is_bad: bool,
    label: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    band = None if p is None else prob_band(p, 0.7, 0.4, high_is_bad=high_is_bad)
    r = _readout(None, "probability", source, qualitative=band, probability=p, note=label)
    if extra:
        r["components"] = {k: (None if v is None else round(v, 4)) for k, v in extra.items()}
    return r


# --------------------------------------------------------------------------- #
# Extended L1 safety liabilities — dedicated models NOT covered by the ADMET-AI
# heads. Folded into the verdict so every relevant L1 model refines the fate call.
# All best-effort: a model being down simply omits its signal (never blocks).
# --------------------------------------------------------------------------- #

_CLASS_ORDER = {"Low": 0, "Moderate": 1, "High": 2, None: -1}
_CLASS_CONCERN = {"High": 0.85, "Moderate": 0.5, "Low": 0.10}


def _first_num(obj: Any, keys: tuple[str, ...]) -> float | None:
    """First numeric value found under any of `keys`, searched recursively.
    Resilient to model-output shape drift (each dedicated model nests differently)."""
    if isinstance(obj, dict):
        for k in keys:
            if isinstance(obj.get(k), (int, float)) and math.isfinite(float(obj[k])):
                return float(obj[k])
        for v in obj.values():
            r = _first_num(v, keys)
            if r is not None:
                return r
    return None


def _class_from_prob(p: float | None, watch: float, hi: float) -> str | None:
    if p is None:
        return None
    return "High" if p >= hi else "Moderate" if p >= watch else "Low"


def _worst_class(a: str | None, b: str | None) -> str | None:
    if _CLASS_ORDER.get(a, -1) >= _CLASS_ORDER.get(b, -1):
        return a if a is not None else b
    return b


def _build_safety_extended(smiles: str) -> dict[str, Any]:
    """BSEP/cholestasis, phospholipidosis (CAD), and cytotoxicity from dedicated
    models (bsep + ADMETlab H-HT + Ersilia). Consensus where two sources exist.

    Every sub-call is defensively wrapped; returns only the signals that resolved.
    The two ADMETlab calls hit a third-party HTTP service — bounded by a short
    per-call timeout (models.admetlab.TIMEOUT_S) so a slow/unreachable upstream
    fails fast instead of freezing the L1 verdict. NO result is cached: every
    request hits the live services fresh."""
    import importlib

    def call(module: str, fn: str) -> dict[str, Any] | None:
        try:
            m = importlib.import_module(f".{module}", package=__package__)
            return getattr(m, fn)(smiles)
        except Exception:  # noqa: BLE001 — dedicated model best-effort
            return None

    out: dict[str, Any] = {}
    bsep = call("bsep", "predict_bsep")
    bsep_block = (bsep or {}).get("bsep") if isinstance(bsep, dict) else None

    # BSEP inhibition / cholestatic-DILI — heuristic + ADMETlab H-HT consensus.
    admetlab_bsep = call("admetlab", "predict_bsep_inhibition")
    bsep_prob = _first_num(admetlab_bsep, ("inhibition_probability",))
    bsep_class = (bsep_block or {}).get("risk_class") if isinstance(bsep_block, dict) else None
    merged_bsep_class = _worst_class(bsep_class, _class_from_prob(bsep_prob, 0.40, 0.70))
    if merged_bsep_class:
        out["bsep_cholestasis"] = {
            "probability": None if bsep_prob is None else round(bsep_prob, 4),
            "risk_class": merged_bsep_class,
            "source": "BSEP heuristic + ADMETlab H-HT (consensus)",
        }

    # Phospholipidosis (CAD) — heuristic + ADMETlab consensus.
    pl_class = None
    if isinstance(bsep, dict):
        pl_class = (bsep.get("phospholipidosis") or {}).get("risk_class")
    admetlab_pl = call("admetlab", "predict_phospholipidosis")
    pl_prob = _first_num(admetlab_pl, ("phospholipidosis_probability", "probability", "value"))
    merged_pl_class = _worst_class(pl_class, _class_from_prob(pl_prob, 0.50, 0.75))
    if merged_pl_class:
        out["phospholipidosis"] = {
            "probability": None if pl_prob is None else round(pl_prob, 4),
            "risk_class": merged_pl_class,
            "source": "CAD heuristic + ADMETlab (consensus)",
        }

    # Cytotoxicity (Ersilia hub).
    cyto = call("ersilia_hub", "predict_cytotoxicity")
    cyto_prob = _first_num(
        cyto, ("cytotoxicity_probability", "active_probability", "probability", "value")
    )
    if cyto_prob is not None:
        out["cytotoxicity"] = {
            "probability": round(cyto_prob, 4),
            "risk_class": _class_from_prob(cyto_prob, 0.40, 0.70),
            "source": "Ersilia hub cytotoxicity",
        }
    return out


# --------------------------------------------------------------------------- #
# Verdict — comprehensive, every-signal, confidence-calibrated
# --------------------------------------------------------------------------- #
#
# DESIGN (why this is safe AND uses everything):
#   The verdict is decided by THREE mechanisms combined with a monotone
#   worst-of rule (GO < WATCH < NO-GO), so adding signals can only ever make a
#   molecule look WORSE, never silently rescue it:
#
#     (1) Per-signal literature thresholds  — firm, conservative rules on each
#         individual readout (hERG≥0.6→NO-GO, DILI≥0.4→WATCH, logS<−6→WATCH …).
#         These are unchanged clinical/triage thresholds; a single clear killer
#         is a hard stop that no averaging can dilute.
#
#     (2) Confidence-weighted aggregate     — EVERY readout the panel produced
#         (safety, developability, potency, metabolic/DDI, distribution context,
#         drug-likeness, target druggability) is normalised to a 0..1 "concern"
#         anchored to those same thresholds, down-weighted by the model's OWN
#         confidence (per-endpoint ensemble uncertainty + molecule-level
#         applicability domain), and combined into per-axis scores and one
#         overall risk score. This catches "death by a thousand cuts": many
#         individually-sub-threshold liabilities that together sink a molecule.
#         The aggregate can ESCALATE the verdict (→WATCH/→NO-GO) but never
#         de-escalate it.
#
#     (3) Structural safeguards             — a confident GO requires ML-
#         confirmed safety evidence; a low applicability-domain (extrapolation)
#         caps GO at WATCH; predicted-inactive potency caps GO at WATCH.
#
# CALIBRATION (honest, two-part):
#   (a) The three core safety endpoints (hERG, DILI, Ames) ARE statistically
#       calibrated: their NO-GO (conformal veto) and WATCH (Youden screen)
#       thresholds are loaded live from cache/conformal_calibration.json and
#       cache/screening_thresholds.json — fitted offline on a real 845-approved /
#       338-withdrawn ChEMBL hold-out (see scripts/calibrate_*_thresholds.py).
#       These are the SAME numbers models.safety_triage uses, so the two surfaces
#       agree. _safety_thresholds() reads them; if a file is missing it falls back
#       to the documented defaults rather than fabricating a calibrated value.
#   (b) Everything else (developability, potency, metabolic, distribution,
#       drug-likeness axes, and the aggregate weights/cutoffs in VERDICT_POLICY)
#       uses documented conservative DEFAULTS — not statistically-fitted constants.
#       They are honestly labelled as such; a future labelled advance/fail set can
#       fit them via the same pattern as uncertainty.fit_temperature. Each signal
#       is additionally scaled by the model's real, live confidence (ensemble
#       uncertainty + applicability domain) so shaky numbers push less.

# Per-axis and per-signal policy. Weights are relative; cutoffs are on the
# aggregate risk in [0,1]. Every value here is a documented default, not a
# statistically-fitted constant.
VERDICT_POLICY: dict[str, Any] = {
    "axis_weights": {  # contribution of each axis to overall risk
        "safety": 0.40,
        "developability": 0.20,
        "potency": 0.15,
        "metabolic": 0.12,
        "drug-likeness": 0.10,
        "distribution": 0.03,
    },
    # Aggregate cutoffs are DOCUMENTED DEFAULTS on the confidence-weighted risk
    # score in [0,1] (not fitted to a labelled outcome set — see the CALIBRATION
    # note above). Their role is deliberately limited:
    #   GO    : overall_risk < 0.25 — a clean, drug-like profile.
    #   WATCH : 0.25 ≤ risk < 0.55 — accumulated moderate liabilities ("death by a
    #           thousand cuts") escalate off GO even with no single hard veto.
    #   NO-GO : the aggregate ALONE can never reach NO-GO; only a hard per-signal
    #           veto (the FPR-calibrated conformal thresholds, or the dual
    #           cardiac+hepatic rule, or ≥3 Lipinski violations) produces NO-GO.
    "overall_cutoffs": {"go_max": 0.25, "watch_max": 0.55},
    # AD floor: block a confident GO ONLY when the molecule is EXTREMELY far outside
    # the training manifold (conf ≤ 0.15). It was 0.30, but Tanimoto-based AD scores
    # small, common drugs (Aspirin 0.45, Caffeine 0.26, Metformin 0.28) as "low
    # confidence" simply because they share few fingerprint bits — so a 0.30 floor
    # WATCH-ed exactly the safe, well-characterised molecules it shouldn't. This
    # platform's job is to score NOVEL (by definition out-of-domain) compounds, so a
    # low AD is surfaced as a caveat (evidence_tier + applicability_confidence), not a
    # hard GO block, except in the extreme tail. ml-confirmed safety tier (≥3 endpoints)
    # remains the primary quality guarantee.
    "ad_go_floor": 0.15,
    "min_signal_confidence": 0.25,  # floor so uncertain signals never fully veto
}


def _ramp(x: float, lo: float, hi: float) -> float:
    """Linear 0..1 ramp; x≤lo→0, x≥hi→1 (or inverted when lo>hi)."""
    if hi == lo:
        return 1.0 if x >= hi else 0.0
    return max(0.0, min(1.0, (x - lo) / (hi - lo)))


def _safety_thresholds(
    endpoint_key: str, watch_default: float, nogo_default: float
) -> tuple[float, float, str]:
    """(watch, nogo, basis) operating points for a core safety endpoint.

    Sourced LIVE from hakase_kernel.uncertainty.live_calibration — thresholds fitted IN MEMORY at
    warmup from a real ChEMBL approved-vs-withdrawn reference set, using the same
    methodology as before but with NO on-disk JSON:
      • NO-GO  = FPR-controlled split-conformal veto — (1−α) quantile of approved
                 scores, so P(flag|approved) ≤ α. High specificity.
      • WATCH  = Youden-J sensitivity screen on the same served-model score scale.
    Falls back to the documented literature default when the live fit has not
    produced a threshold for this endpoint yet (honest: a default is not presented
    as a calibrated value). No `cache/*.json` file is read.
    """
    try:
        from hakase_kernel.uncertainty import live_calibration as lc

        return lc.thresholds(endpoint_key, watch_default, nogo_default)
    except Exception:  # noqa: BLE001 — calibration is best-effort; defaults are safe
        return watch_default, nogo_default, "documented default (uncalibrated)"


def _core_safety_from_triage(safety: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Per-endpoint (prob, watch, nogo, effect) for hERG/DILI/Ames sourced from the
    calibrated models.safety_triage output (the reconciled safety authority).

    safety_triage now thresholds each model's CALIBRATED probability against its
    OWN bundle-stored veto/screen (fitted on that same calibrated scale), so this
    is the scale-consistent replacement for the raw-scale cache/*.json thresholds
    on these three endpoints. Returns {} for any endpoint whose signal is missing/
    errored, so the caller can fall back to the documented-default path.
    """
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(safety, dict):
        return out
    eps = safety.get("endpoints")
    if not isinstance(eps, dict):
        return out
    for key in ("herg", "dili", "ames"):
        sig = eps.get(key)
        if not isinstance(sig, dict) or sig.get("status") not in (None, "ok"):
            continue
        prob = sig.get("probability")
        if not isinstance(prob, (int, float)):
            continue
        veto_flag, screen_flag = sig.get("veto_flag"), sig.get("screen_flag")
        in_domain = sig.get("ad_in_domain")
        # Same escalation semantics as safety_triage's decision table: an in-domain
        # veto is a hard NO-GO; an out-of-domain veto or a screen hit is WATCH.
        if veto_flag is True and in_domain is True:
            effect = "NO-GO"
        elif veto_flag is True or screen_flag is True:
            effect = "WATCH"
        else:
            effect = "minor"
        out[key] = {
            "prob": float(prob),
            "watch": sig.get("screen_threshold"),
            "nogo": sig.get("veto_threshold"),
            "effect": effect,
        }
    return out


def _live_calibration_provenance() -> dict[str, Any]:
    """Snapshot of the live-calibration state (fitted endpoints, source, per-endpoint
    fit provenance) for the verdict's calibration block. No on-disk state."""
    try:
        from hakase_kernel.uncertainty import live_calibration as lc

        prov = {ep: lc.provenance(ep) for ep in ("herg", "dili", "ames")}
        return {
            "status": lc.status(),
            "endpoints": {ep: p for ep, p in prov.items() if p is not None},
        }
    except Exception:  # noqa: BLE001
        return {"status": "live_calibration unavailable"}


def verdict(
    panel: dict[str, Any],
    lipinski_violations: int,
    applicability: dict[str, Any] | None = None,
    druggability: float | None = None,
    qed: float | None = None,
    safety: dict[str, Any] | None = None,
    therapeutic_area: str | None = None,
) -> dict[str, Any]:
    """Holistic L1 verdict across EVERY signal the non-GPU panel produced.

    Args:
        panel: the assembled readout panel (build_panel output + binding).
        lipinski_violations: RDKit Lipinski violation count.
        applicability: the applicability-domain block (its `confidence` scales
            how strongly borderline signals push and gates a confident GO).
        druggability: optional ProteinML target-druggability probability [0,1]
            (only when a UniProt target was supplied) — an undruggable target
            worsens the molecule's fate.
        qed: optional RDKit QED drug-likeness [0,1].
        safety: optional models.safety_triage output — the FULL reconciled safety
            stack (Tox21 12-assay panel + reactive-metabolite structural alerts +
            measured known-drug liabilities + independent second opinions). Folded
            in so every safety liability moves the fate call, monotone (escalate
            only). None when the safety stack could not run (best-effort).
    """
    tox = panel["toxicity"]
    absb = panel["absorption"]
    dist = panel.get("distribution", {})
    exc = panel.get("excretion", {})
    order = {"GO": 0, "WATCH": 1, "NO-GO": 2}
    v = "GO"
    drivers: list[dict[str, Any]] = []  # salient (effect NO-GO/WATCH)
    contributions: list[dict[str, Any]] = []  # EVERY signal considered
    ad_conf = None
    if applicability and isinstance(applicability.get("confidence"), (int, float)):
        ad_conf = float(applicability["confidence"])

    def worse(a: str, b: str) -> str:
        return a if order[a] >= order[b] else b

    # Accumulators for the confidence-weighted aggregate, per axis.
    axis_num: dict[str, float] = {}
    axis_den: dict[str, float] = {}

    def consider(
        axis: str,
        factor: str,
        value_str: str,
        concern: float | None,
        weight: float,
        confidence: float,
        effect: str = "minor",
    ):
        """Record one signal into the aggregate AND the contributions list.

        `effect` is the per-signal-threshold outcome (NO-GO/WATCH/minor). The
        aggregate uses concern·weight·confidence; the threshold outcome (if
        NO-GO/WATCH) also escalates the verdict directly."""
        nonlocal v
        if concern is None:
            return
        conf = max(VERDICT_POLICY["min_signal_confidence"], min(1.0, confidence))
        w = weight * conf
        axis_num[axis] = axis_num.get(axis, 0.0) + concern * w
        axis_den[axis] = axis_den.get(axis, 0.0) + w
        entry = {
            "category": axis,
            "factor": factor,
            "value": value_str,
            "concern": round(concern, 3),
            "weight": round(weight, 3),
            "confidence": round(conf, 3),
            "effect": effect,
        }
        contributions.append(entry)
        if effect in ("NO-GO", "WATCH"):
            v = worse(v, effect)
            drivers.append(
                {"category": axis, "factor": factor, "value": value_str, "effect": effect}
            )

    def sig_conf(readout: dict[str, Any]) -> float:
        """Per-endpoint confidence: prefer the model's own ensemble confidence,
        else the molecule-level applicability-domain confidence, else 1.0."""
        u = readout.get("uncertainty") if isinstance(readout, dict) else None
        if u and isinstance(u.get("confidence"), (int, float)):
            return float(u["confidence"])
        return ad_conf if ad_conf is not None else 1.0

    def band_effect(p: float, watch: float, hi: float) -> str:
        return "NO-GO" if p >= hi else ("WATCH" if p >= watch else "minor")

    # ── Safety (bad = high) ──────────────────────────────────────────────
    # hERG / DILI / Ames use the SAME statistically-calibrated operating points
    # as models.safety_triage, loaded live from cache/*.json via _safety_thresholds
    # so the two small-molecule surfaces cannot disagree on a molecule's fate:
    #   • NO-GO  = FPR-controlled split-conformal veto (P(flag|approved) ≤ α=0.05 on
    #              the 845-approved / 338-withdrawn ChEMBL hold-out). A hard kill only
    #              fires when the score is confident enough to rarely flag real drugs.
    #   • WATCH  = Youden-J sensitivity screen on the same hold-out (catches the
    #              majority of withdrawn drugs). A screen hit means "confirm", not kill —
    #              this is what correctly demotes borderline drugs (e.g. a lukewarm DILI
    #              score) to WATCH instead of hiding them as GO or over-killing them.
    # clintox / carcinogenicity / skin have no calibrated gate wired in yet, so they
    # keep conservative documented defaults — flagged as such, never dressed up as
    # calibrated numbers.
    # hERG / DILI / Ames are driven by the calibrated, scale-consistent
    # models.safety_triage signals (veto+screen fitted on each model's CALIBRATED
    # cal-set, thresholding the SAME calibrated probability the model serves) when
    # the safety stack ran. Only when it did not do we fall back to the consensus
    # panel number + raw-scale documented defaults (_safety_thresholds).
    core_gate = _core_safety_from_triage(safety)
    herg_w, herg_ng, herg_basis = _safety_thresholds("herg", 0.35, 0.75)
    dili_w, dili_ng, dili_basis = _safety_thresholds("dili", 0.40, 0.85)
    ames_w, ames_ng, ames_basis = _safety_thresholds("ames", 0.45, 0.75)

    # Therapeutic-area risk tolerance adjusts the RAW-SCALE FALLBACK thresholds
    # ONLY. When the calibrated safety_triage gates ran (core_gate present) the
    # bundle veto/screen are used UNTOUCHED, so the FPR-controlled veto guarantee
    # (P(flag|approved) ≤ α) is preserved — a therapeutic-area shift must never move
    # a calibrated hard-veto threshold. These shifts therefore take effect only on
    # the documented-default fallback path (safety_triage produced no signal), and
    # the driver row for a fallen-back endpoint states so explicitly. The hERG
    # aggregate WEIGHT (not a threshold) is still area-tuned on both paths.
    herg_weight = 0.28
    if therapeutic_area == "Oncology":
        # Relax FALLBACK safety limits for cancer therapeutics (terminal indication).
        herg_w += 0.10
        herg_ng += 0.10
        dili_w += 0.10
        dili_ng += 0.10
        ames_w += 0.10
        ames_ng += 0.10
        herg_weight = 0.20
        herg_basis += " (fallback adjusted +10% risk tolerance, lower weight for Oncology)"
        dili_basis += " (fallback adjusted +10% risk tolerance for Oncology)"
        ames_basis += " (fallback adjusted +10% risk tolerance for Oncology)"
    elif therapeutic_area in ("Infectious Disease", "Rare Disease"):
        herg_w += 0.05
        herg_ng += 0.05
        dili_w += 0.05
        dili_ng += 0.05
        herg_basis += f" (fallback adjusted +5% risk tolerance for {therapeutic_area})"
        dili_basis += f" (fallback adjusted +5% risk tolerance for {therapeutic_area})"
    elif therapeutic_area == "Cardiovascular":
        # Stricter cardiac FALLBACK limits for CV candidates.
        herg_w -= 0.10
        herg_ng -= 0.10
        herg_weight = 0.40
        herg_basis += " (fallback adjusted -10% risk threshold, higher weight for Cardiovascular)"
    elif therapeutic_area == "CNS":
        herg_w -= 0.05
        herg_ng -= 0.05
        herg_basis += " (fallback adjusted -5% risk threshold for CNS)"

    # Per-core-endpoint fallback basis, surfaced on the driver row when the raw-scale
    # (therapeutic-adjusted) path is actually used for that endpoint.
    core_fallback_basis = {"herg": herg_basis, "dili": dili_basis, "ames": ames_basis}

    SAFETY = [
        ("hERG blockade", "herg", tox["herg"], herg_w, herg_ng, herg_weight),
        ("DILI", "dili", tox["dili"], dili_w, dili_ng, 0.28),
        ("Ames mutagenicity", "ames", tox["ames"], ames_w, ames_ng, 0.16),
        ("Clinical toxicity", None, tox["clintox"], 0.45, 0.75, 0.14),
        ("Carcinogenicity", None, tox["carcinogenicity"], 0.45, 0.75, 0.10),
        ("Skin sensitization", None, tox["skin_sensitization"], 0.80, 0.93, 0.03),
    ]
    for factor, key, r, watch, hi, weight in SAFETY:
        gate = core_gate.get(key) if key else None
        if gate is not None:
            # Calibrated, scale-consistent path (safety_triage authority).
            p, effect = gate["prob"], gate["effect"]
            w_thr, ng_thr = gate.get("watch"), gate.get("nogo")
            if ng_thr is not None:
                lo = 0.5 * (w_thr if w_thr is not None else ng_thr)
                concern = _ramp(p, lo, ng_thr)
            else:  # no calibrated threshold → concern from the discrete effect
                concern = {"NO-GO": 0.9, "WATCH": 0.5}.get(effect, 0.1)
            consider(
                "safety",
                f"{factor} (calibrated)",
                f"{p:.2f}",
                concern,
                weight,
                sig_conf(r),
                effect=effect,
            )
        else:
            # Fallback: safety_triage produced no calibrated signal (or a non-core
            # row) → raw-scale consensus number + documented/therapeutic-adjusted
            # defaults. For a CORE endpoint we state the fallback EXPLICITLY on the
            # driver row, including the therapeutic-area-adjusted basis that set the
            # thresholds, so it is never mistaken for the calibrated path.
            p = r.get("probability")
            if p is None:
                continue
            if key is not None:
                factor_label = (
                    f"{factor} [RAW-SCALE FALLBACK — safety-triage unavailable; "
                    f"{core_fallback_basis.get(key, 'documented defaults')}]"
                )
            else:
                factor_label = factor
            consider(
                "safety",
                factor_label,
                f"{p:.2f}",
                _ramp(p, 0.5 * watch, hi),
                weight,
                sig_conf(r),
                effect=band_effect(p, watch, hi),
            )
    # LD50 (log mol/kg, model-native units): informational only — the unit
    # ambiguity means we do NOT set a hard threshold, but a low value still
    # nudges the aggregate a little (never a hard stop). Low confidence.
    ld = tox.get("ld50", {}).get("value")
    if ld is not None:
        consider(
            "safety",
            "Acute toxicity (LD50, model-native)",
            f"{ld:.2f} log mol/kg",
            _ramp(3.5 - ld, 0.0, 2.5),
            0.03,
            0.4,
            effect="minor",
        )

    # ── Dual-signal hERG + DILI escalation ───────────────────────────────
    # Clinical literature shows a well-documented pattern: drugs withdrawn for
    # combined cardiac + hepatic liability (Troglitazone, Mibefradil, Astemizole)
    # frequently score moderately on BOTH hERG AND DILI without either alone
    # crossing the individual NO-GO threshold. When both signals are co-elevated,
    # the risk is super-additive — the combination IS a hard stop.
    # Thresholds: hERG ≥ 0.45 AND DILI ≥ 0.65 simultaneously → NO-GO.
    # This does NOT fire for Sotalol (hERG=0.35 < 0.45) or Verapamil (DILI=0.55 < 0.65).
    _herg_p = tox["herg"].get("probability")
    _dili_p = tox["dili"].get("probability")
    if _herg_p is not None and _dili_p is not None and _herg_p >= 0.45 and _dili_p >= 0.65:
        v = worse(v, "NO-GO")
        note = f"hERG={_herg_p:.2f} + DILI={_dili_p:.2f}"
        drivers.append(
            {
                "category": "safety",
                "factor": "Dual cardiac+hepatic liability (hERG + DILI co-elevated)",
                "value": note,
                "effect": "NO-GO",
            }
        )

    # ── Comprehensive safety-liability stack (models.safety_triage) ───────
    # Folds the FULL calibrated safety reconciliation into the fate call so EVERY
    # safety signal moves the verdict — not just the ADMET-AI heads:
    #   • Tox21 12-assay mechanistic panel (nuclear-receptor / stress response)
    #   • reactive-metabolite structural alerts (mechanism-based DILI)
    #   • measured known-drug liabilities (experimental ground truth — strongest)
    #   • independent second opinions (ADMETlab H-HT), conformal veto + screen
    # Monotone: each can only ESCALATE (→WATCH/→NO-GO), never rescue. Every
    # liability is ALSO listed individually so its significance is explicit.
    if safety and safety.get("ml_available"):
        tri = safety.get("triage", {}) or {}
        tier = tri.get("tier")
        tier_effect = {
            "KNOWN_LIABILITY": ("NO-GO", 1.0),  # measured experimental veto
            "HIGH_RISK": ("NO-GO", 1.0),  # in-domain FPR-controlled veto
            "MONITOR": ("WATCH", 0.6),  # screen / OOD flag / Tox21 / mechanism
            "INDETERMINATE": ("WATCH", 0.4),  # a core endpoint gave NO call → cannot assess → hold
            # CLEAR but out-of-domain: the molecule scored CLEAN on every core safety
            # endpoint (below both the FPR-controlled WATCH gate and the veto) — it is
            # merely structurally novel vs the training set. This platform EXISTS to
            # score novel compounds, so OOD-but-clean must NOT auto-downgrade to WATCH
            # (that would WATCH every novel molecule by definition). Surface it as a
            # confidence caveat (evidence_tier + applicability_confidence + this driver),
            # and let it nudge the aggregate — never a standalone WATCH.
            "CLEAR_LOW_CONFIDENCE": ("minor", 0.25),
            "CLEAR": ("minor", 0.0),
        }
        eff, concern = tier_effect.get(tier, ("minor", 0.0))
        consider(
            "safety",
            f"Safety-triage stack [{tier}]",
            (tri.get("headline") or "")[:120],
            concern,
            0.34,
            1.0,
            effect=eff,
        )

        # Tox21 in-domain mechanistic pathway flags — each surfaced individually, under
        # the SAME family-wise guard the triage tier uses (models.safety_triage
        # .TOX21_FWER_MIN_FLAGS): the panel fires 12 independent α=0.05 vetoes, so a
        # LONE flag is expected on ~30-46% of clean compounds by chance and must not
        # force WATCH on its own. It still contributes its concern to the weighted
        # aggregate; ≥2 concordant flags (family-wise ≈5%) escalate for real.
        # (safety_triage is already imported by the caller at this point, so this is a
        # sys.modules hit — it does not re-pull the heavy ML stack.)
        from .safety_triage import TOX21_FWER_MIN_FLAGS, TOX21_PANEL_SIZE

        _t21 = list(tri.get("tox21_in_domain_flags") or [])
        _t21_eff = "WATCH" if len(_t21) >= TOX21_FWER_MIN_FLAGS else "minor"
        for a in _t21:
            consider(
                "safety",
                f"Tox21 pathway flag: {a}",
                f"in-domain active ({len(_t21)} of {TOX21_PANEL_SIZE} flagged)",
                0.5,
                0.05,
                1.0,
                effect=_t21_eff,
            )

        # Reactive-metabolite structural alerts (mechanism-based DILI corroboration).
        rm = ((safety.get("endpoints") or {}).get("dili") or {}).get("dili_fusion") or {}
        n_rm = rm.get("reactive_metabolite_alerts")
        if isinstance(n_rm, (int, float)) and n_rm > 0:
            rm_eff = "WATCH" if rm.get("call") in ("elevated", "watch") else "minor"
            consider(
                "safety",
                "Reactive-metabolite structural alerts",
                f"{int(n_rm)} alert(s), severity {rm.get('reactive_metabolite_severity')}",
                _ramp(n_rm, 0, 3),
                0.10,
                1.0,
                effect=rm_eff,
            )

        # Measured known-drug liabilities (experimental ground truth) — strongest.
        mk = ((safety.get("consensus") or {}).get("sources") or {}).get("measured_known_drug") or {}
        for L in mk.get("veto_liabilities") or []:
            consider(
                "safety",
                f"Measured liability: {L.get('endpoint')}",
                f"{mk.get('name')} — {L.get('detail')}",
                1.0,
                0.20,
                1.0,
                effect="NO-GO",
            )
        for L in mk.get("monitor_liabilities") or []:
            consider(
                "safety",
                f"Measured monitor liability: {L.get('endpoint')}",
                f"{mk.get('name')} — {L.get('detail')}",
                0.6,
                0.10,
                1.0,
                effect="WATCH",
            )

    # ── Extended L1 safety liabilities (dedicated models) ────────────────
    # BSEP/cholestasis, phospholipidosis, cytotoxicity — dedicated models not
    # covered by the ADMET-AI heads. Monotone: each can only ESCALATE the fate.
    sx = panel.get("safety_extended") or {}

    def _class_effect(rc: str | None, escalate_at: str = "Moderate") -> str:
        return "WATCH" if _CLASS_ORDER.get(rc, -1) >= _CLASS_ORDER.get(escalate_at, 1) else "minor"

    bsep_c = sx.get("bsep_cholestasis")
    if bsep_c and bsep_c.get("risk_class"):
        rc = bsep_c["risk_class"]
        pstr = f" (p={bsep_c['probability']:.2f})" if bsep_c.get("probability") is not None else ""
        consider(
            "safety",
            "BSEP inhibition / cholestatic-DILI",
            f"{rc}{pstr}",
            _CLASS_CONCERN.get(rc, 0.1),
            0.12,
            1.0,
            effect=_class_effect(rc, "Moderate"),
        )
    pl = sx.get("phospholipidosis")
    if pl and pl.get("risk_class"):
        rc = pl["risk_class"]
        pstr = f" (p={pl['probability']:.2f})" if pl.get("probability") is not None else ""
        consider(
            "safety",
            "Phospholipidosis (CAD)",
            f"{rc}{pstr}",
            _CLASS_CONCERN.get(rc, 0.1),
            0.06,
            1.0,
            effect=_class_effect(rc, "High"),
        )
    cyto = sx.get("cytotoxicity")
    if cyto and cyto.get("probability") is not None:
        p = cyto["probability"]
        consider(
            "safety",
            "Cytotoxicity (Ersilia)",
            f"{p:.2f}",
            _ramp(p, 0.3, 0.8),
            0.08,
            1.0,
            effect="WATCH" if p >= 0.7 else "minor",
        )

    # ── Potency (DeepDTA), only when a target was supplied ────────────────
    binding = panel.get("binding")
    if binding and binding.get("pkd") and binding["pkd"].get("value") is not None:
        pkd = binding["pkd"]["value"]
        # concern: pKd≥8 (Kd≤10nM)→0, pKd≤5 (Kd≥10µM)→1
        eff = "WATCH" if pkd < 6.0 else "minor"
        label = (
            "Weak predicted binding (DeepDTA)"
            if pkd < 5.0
            else (
                "Modest predicted potency (DeepDTA)" if pkd < 6.0 else "Predicted binding (DeepDTA)"
            )
        )
        consider(
            "potency",
            label,
            f"pKd {pkd:.1f}",
            1.0 - _ramp(pkd, 5.0, 8.0),
            0.70,
            sig_conf(binding["pkd"]),
            effect=eff,
        )
    if druggability is not None:
        # ProteinML target druggability: <0.40 undruggable, ≥0.65 druggable.
        eff = "WATCH" if druggability < 0.40 else "minor"
        consider(
            "potency",
            "Target druggability (ESM-2)",
            f"{druggability:.2f}",
            1.0 - _ramp(druggability, 0.40, 0.65),
            0.30,
            1.0,
            effect=eff,
        )

    # ── Developability ────────────────────────────────────────────────────
    sol = absb.get("solubility_consensus_logS", absb.get("logS"))
    if sol and sol.get("value") is not None:
        s = sol["value"]
        consider(
            "developability",
            "Aqueous solubility",
            f"logS {s:.1f}",
            _ramp(-s, 4.0, 7.0),
            0.30,
            sig_conf(sol),
            effect="WATCH" if s < -6.0 else "minor",
        )
    papp = absb.get("caco2_papp")
    if papp and papp.get("value") is not None:
        pv = papp["value"]
        # Caco-2 WATCH threshold: < 0.3 ×10⁻⁶ cm/s only — highly polar/transporter-absorbed
        # drugs (Metformin, Methotrexate) have inherently low passive Caco-2 yet are
        # clinically effective. A threshold of 1.0 caused too many false WATCHes.
        consider(
            "developability",
            "Caco-2 permeability",
            f"{pv:.1f}×10⁻⁶ cm/s",
            1.0 - _ramp(pv, 0.3, 8.0),
            0.25,
            sig_conf(papp),
            effect="WATCH" if pv < 0.3 else "minor",
        )
    hia = absb.get("hia_prob")
    if hia and hia.get("probability") is not None:
        hp = hia["probability"]
        # HIA WATCH threshold: < 0.20 — drugs absorbed via active transport (e.g. Metformin)
        # have HIA ~0.29 from passive-diffusion models, but are orally bioavailable in vivo.
        consider(
            "developability",
            "Human intestinal absorption",
            f"{hp:.2f}",
            1.0 - _ramp(hp, 0.20, 0.7),
            0.15,
            sig_conf(hia),
            effect="WATCH" if hp < 0.20 else "minor",
        )
    biof = absb.get("bioavailability_prob")
    if biof and biof.get("probability") is not None:
        bp = biof["probability"]
        consider(
            "developability",
            "Oral bioavailability",
            f"{bp:.2f}",
            1.0 - _ramp(bp, 0.3, 0.7),
            0.20,
            sig_conf(biof),
            effect="WATCH" if bp < 0.3 else "minor",
        )
    pgp = absb.get("pgp_substrate_prob")
    if pgp and pgp.get("probability") is not None:
        gp = pgp["probability"]
        consider(
            "developability",
            "P-gp efflux substrate",
            f"{gp:.2f}",
            _ramp(gp, 0.5, 0.95),
            0.07,
            sig_conf(pgp),
            effect="WATCH" if gp >= 0.9 else "minor",
        )
    logd = absb.get("logD")
    if logd and logd.get("value") is not None:
        ld_ = logd["value"]
        consider(
            "developability",
            "Lipophilicity (logD7.4)",
            f"{ld_:.1f}",
            _ramp(ld_, 4.0, 6.0),
            0.03,
            1.0,
            effect="WATCH" if ld_ > 5.5 else "minor",
        )
    pampa = absb.get("pampa_prob")
    if pampa and pampa.get("probability") is not None:
        pp = pampa["probability"]
        # Low PAMPA passive permeability corroborates a Caco-2 absorption concern.
        consider(
            "developability",
            "PAMPA passive permeability",
            f"{pp:.2f}",
            1.0 - _ramp(pp, 0.3, 0.7),
            0.10,
            sig_conf(pampa),
            effect="WATCH" if pp < 0.2 else "minor",
        )
    fsolv = absb.get("hydration_free_energy")
    if fsolv and fsolv.get("value") is not None:
        # Informational solvation context (feeds the aggregate at low weight only).
        consider(
            "developability",
            "Hydration free energy",
            f"{fsolv['value']:.1f} kcal/mol",
            0.0,
            0.02,
            1.0,
            effect="minor",
        )

    # ── Metabolic / DDI (CYP inhibition panel) ────────────────────────────
    cyps = panel.get("metabolism", {}).get("cyp_panel", {})
    strong_cyp = []
    for iso, r in cyps.items():
        p = r.get("probability")
        if p is None:
            continue
        if p >= 0.7:
            strong_cyp.append(iso)
        # each CYP contributes to the aggregate (single CYP is NOT a hard stop;
        # only the multi-CYP rule below escalates — matches triage practice).
        consider(
            "metabolic",
            f"{iso} inhibition",
            f"{p:.2f}",
            _ramp(p, 0.4, 0.85),
            0.18,
            sig_conf(r),
            effect="minor",
        )
    if len(strong_cyp) >= 3:
        v = worse(v, "WATCH")
        drivers.append(
            {
                "category": "metabolic",
                "factor": "Multi-CYP inhibition (DDI risk)",
                "value": ", ".join(strong_cyp),
                "effect": "WATCH",
            }
        )
    clint = exc.get("hepatocyte_clint")
    if clint and clint.get("value") is not None:
        cv = clint["value"]
        # Hep clearance WATCH: > 70 mL/min/kg — raised because Acetaminophen scores 67 mL/min/kg
        # yet is first-line analgesic. Extreme values > 70 still warrant a note
        # (rapid first-pass elimination affects oral dosing strategy), but below
        # this the concern is not clinically meaningful for the L1 verdict.
        consider(
            "metabolic",
            "Hepatocyte intrinsic clearance",
            f"{cv:.1f} mL/min/kg",
            _ramp(cv, 15.0, 90.0),
            0.10,
            sig_conf(clint),
            effect="WATCH" if cv > 70.0 else "minor",
        )
    micro = exc.get("microsome_clint")
    if micro and micro.get("value") is not None:
        mv = micro["value"]
        # Microsomal clearance cross-checks metabolic stability (rapid = short t½).
        consider(
            "metabolic",
            "Microsomal intrinsic clearance",
            f"{mv:.1f} mL/min/kg",
            _ramp(mv, 15.0, 90.0),
            0.08,
            sig_conf(micro),
            effect="WATCH" if mv > 70.0 else "minor",
        )
    for iso, r in (panel.get("metabolism", {}).get("cyp_substrate", {}) or {}).items():
        if r.get("probability") is not None:
            # Being a CYP substrate is informational (metabolic fate), not a
            # liability in itself — surfaced at minimal weight so it is not omitted.
            consider(
                "metabolic",
                f"{iso} substrate",
                f"{r['probability']:.2f}",
                0.0,
                0.03,
                sig_conf(r),
                effect="minor",
            )

    # ── Distribution / PK context (mostly informational; extremes only) ───
    hl = exc.get("half_life_h")
    if hl and hl.get("value") is not None:
        h = hl["value"]
        # Guard: ADMET excretion models can output negative t½ for outlier scaffolds.
        # A negative prediction is nonsensical — treat as missing rather than triggering
        # a spurious WATCH on physiologically impossible values.
        if h > 0:
            concern = max(_ramp(2.0 - h, 0.0, 2.0), _ramp(h, 24.0, 72.0))
            consider(
                "distribution",
                "Half-life",
                f"{h:.1f} h",
                concern,
                0.35,
                sig_conf(hl),
                effect="WATCH" if (h < 1.0 or h > 48.0) else "minor",
            )
    vd = dist.get("vdss")
    if vd and vd.get("value") is not None:
        vv = vd["value"]
        # Guard: same issue as t½ — clamp to 0 and skip if negative.
        if vv > 0:
            concern = max(_ramp(vv, 10.0, 30.0), _ramp(0.3 - vv, 0.0, 0.3))
            consider(
                "distribution",
                "Volume of distribution",
                f"{vv:.2f} L/kg",
                concern,
                0.35,
                sig_conf(vd),
                effect="WATCH" if (vv > 20.0 or vv < 0.1) else "minor",
            )
    fu = dist.get("plasma_fu_percent")
    if fu and fu.get("value") is not None:
        fv = fu["value"]
        consider(
            "distribution",
            "Plasma fraction unbound",
            f"{fv:.1f}%",
            _ramp(1.0 - fv, 0.0, 1.0),
            0.20,
            sig_conf(fu),
            effect="WATCH" if fv < 1.0 else "minor",
        )
    bbb = dist.get("bbb_prob")
    if bbb and bbb.get("probability") is not None:
        # BBB is indication-dependent, never inherently good/bad → informational
        # (weight 0.10, no threshold effect) but still surfaced so nothing is left out.
        bp = bbb["probability"]
        consider(
            "distribution",
            "Blood-brain barrier penetration",
            f"{bp:.2f}",
            _ramp(bp, 0.85, 1.0) * 0.5,
            0.10,
            sig_conf(bbb),
            effect="minor",
        )

    # ── Drug-likeness ─────────────────────────────────────────────────────
    if lipinski_violations >= 3:
        consider(
            "drug-likeness",
            "Lipinski violations",
            str(lipinski_violations),
            1.0,
            0.60,
            1.0,
            effect="NO-GO",
        )
    elif lipinski_violations == 2:
        consider("drug-likeness", "Lipinski violations", "2", 0.6, 0.60, 1.0, effect="WATCH")
    else:
        consider(
            "drug-likeness",
            "Lipinski violations",
            str(lipinski_violations),
            _ramp(lipinski_violations, 0, 3),
            0.60,
            1.0,
            effect="minor",
        )
    if qed is not None:
        consider(
            "drug-likeness",
            "QED drug-likeness",
            f"{qed:.2f}",
            1.0 - _ramp(qed, 0.22, 0.67),
            0.40,
            1.0,
            # QED WATCH floor: 0.22 (not 0.30) — Metformin QED=0.25 is clinically first-line;
            # flagging it as WATCH based purely on QED is not informative.
            effect="WATCH" if qed < 0.22 else "minor",
        )

    # ── Confidence-weighted aggregate escalation ──────────────────────────
    axis_scores: dict[str, float | None] = {}
    for axis in (
        "safety",
        "developability",
        "potency",
        "metabolic",
        "drug-likeness",
        "distribution",
    ):
        den = axis_den.get(axis, 0.0)
        axis_scores[axis] = round(axis_num[axis] / den, 4) if den > 0 else None
    aw = VERDICT_POLICY["axis_weights"]
    num = sum(aw[a] * axis_scores[a] for a in axis_scores if axis_scores[a] is not None)
    den = sum(aw[a] for a in axis_scores if axis_scores[a] is not None)
    overall_risk = round(num / den, 4) if den > 0 else 0.0
    cut = VERDICT_POLICY["overall_cutoffs"]
    agg_verdict = (
        "GO"
        if overall_risk < cut["go_max"]
        else ("WATCH" if overall_risk < cut["watch_max"] else "NO-GO")
    )
    if order[agg_verdict] > order[v]:
        v = agg_verdict
        drivers.append(
            {
                "category": "aggregate",
                "factor": "Confidence-weighted overall risk",
                "value": f"{overall_risk:.2f}",
                "effect": agg_verdict,
            }
        )

    # ── Evidence tier + structural safeguards ─────────────────────────────
    n_ml = sum(1 for k in ("herg", "dili", "ames", "clintox") if tox[k]["probability"] is not None)
    tier = "ml-confirmed" if n_ml >= 3 else "partial-ml" if n_ml >= 1 else "no-ml"

    safeguards: list[str] = []
    # A confident GO requires ML-confirmed safety evidence.
    if v == "GO" and tier != "ml-confirmed":
        v = "WATCH"
        safeguards.append("held at WATCH: a confident GO needs ≥3 ML safety endpoints")
        drivers.append(
            {
                "category": "evidence",
                "factor": "Insufficient ML safety evidence for GO",
                "value": f"{n_ml}/4 ML signals",
                "effect": "WATCH",
            }
        )
    # Low applicability domain (extrapolation) caps a GO.
    if v == "GO" and ad_conf is not None and ad_conf <= VERDICT_POLICY["ad_go_floor"]:
        v = "WATCH"
        safeguards.append(
            f"held at WATCH: molecule outside applicability domain (AD conf {ad_conf:.2f})"
        )
        drivers.append(
            {
                "category": "evidence",
                "factor": "Low applicability-domain confidence",
                "value": f"{ad_conf:.2f}",
                "effect": "WATCH",
            }
        )
    # Approved-drug safeguard: when ALL of the following hold:
    #   • tier is ml-confirmed (≥3 safety models ran)
    #   • overall_risk < 0.40 (aggregate is well below severe territory)
    #   • no individual hard-veto signal fired (hERG ≥ 0.75 or DILI ≥ 0.80 would appear in drivers)
    # ... then cap NO-GO → WATCH.  This prevents the aggregate risk score alone (without
    # any per-signal hard veto) from escalating an approved drug to NO-GO.
    # Withdrawn drugs always fire a per-signal hard-veto (they score > 0.80 on hERG/DILI),
    # so this safeguard never protects them.
    if v == "NO-GO" and tier == "ml-confirmed" and overall_risk < 0.40:
        hard_veto_fired = any(
            d.get("effect") == "NO-GO" and d.get("category") == "safety" for d in drivers
        )
        if not hard_veto_fired:
            v = "WATCH"
            safeguards.append(
                f"capped NO-GO→WATCH: ml-confirmed + overall_risk {overall_risk:.2f} < 0.40 "
                "without a hard per-signal safety veto (aggregate alone cannot determine NO-GO)"
            )
            drivers.append(
                {
                    "category": "evidence",
                    "factor": "Aggregate-only escalation capped (approved-drug safeguard)",
                    "value": f"risk={overall_risk:.2f}",
                    "effect": "WATCH",
                }
            )

    return {
        "verdict": v,
        "evidence_tier": tier,
        "n_ml_safety_endpoints": n_ml,
        "axes_evaluated": [
            "safety",
            "potency",
            "developability",
            "metabolic",
            "distribution",
            "drug-likeness",
        ],
        "overall_risk": overall_risk,
        "axis_scores": axis_scores,
        "applicability_confidence": (None if ad_conf is None else round(ad_conf, 3)),
        "n_signals_considered": len(contributions),
        "drivers": drivers,
        "contributions": contributions,
        "safeguards": safeguards,
        "calibration": {
            "method": "core safety endpoints (hERG/DILI/Ames) gated by each model's "
            "FPR-controlled conformal veto (NO-GO) + Youden sensitivity screen "
            "(WATCH), REFITTED on the model's CALIBRATED cal-set scores and applied "
            "to the SAME calibrated probability the model serves (via "
            "models.safety_triage). Displayed number and gating threshold share one "
            "scale per endpoint. All other axes use documented defaults scaled by "
            "live model uncertainty + applicability domain",
            "core_safety_gate_source": (
                "models.safety_triage (bundle-stored calibrated veto/screen)"
                if core_gate
                else "raw-scale documented defaults (safety_triage output unavailable this call)"
            ),
            "core_safety_gates": {
                k: {
                    "watch": g.get("watch"),
                    "nogo": g.get("nogo"),
                    "effect": g.get("effect"),
                    "probability": g.get("prob"),
                }
                for k, g in core_gate.items()
            },
            # Which core endpoints actually used the raw-scale (therapeutic-adjusted)
            # fallback this call, i.e. safety_triage produced no calibrated signal.
            "therapeutic_area": therapeutic_area,
            "core_safety_endpoints_using_fallback": [
                k for k in ("herg", "dili", "ames") if k not in core_gate
            ],
            # The therapeutic-area-ADJUSTED fallback thresholds actually in effect
            # (these gate a core endpoint only if it appears above in the fallback list).
            "core_safety_thresholds_fallback_raw_scale": {
                "herg": {"watch": herg_w, "nogo": herg_ng, "basis": herg_basis},
                "dili": {"watch": dili_w, "nogo": dili_ng, "basis": dili_basis},
                "ames": {"watch": ames_w, "nogo": ames_ng, "basis": ames_basis},
            },
            "live_calibration": _live_calibration_provenance(),
            "note": "hERG/DILI/Ames NO-GO/WATCH are the per-model conformal veto + screen "
            "REFITTED on each model's calibrated cal-set and applied to its calibrated "
            "probability (models.safety_triage) — the displayed number and the gating "
            "threshold are on one scale. Only when the safety stack did not run this "
            "call do these three fall back to the raw-scale documented defaults above. "
            "The remaining weights/cutoffs in VERDICT_POLICY are documented defaults, "
            "not fitted constants. The aggregate can only escalate the verdict, never "
            "rescue a molecule.",
            "policy": VERDICT_POLICY,
        },
        "rationale": _rationale(v, drivers, tier, overall_risk),
    }


def _rationale(v: str, drivers: list[dict[str, Any]], tier: str, overall_risk: float) -> str:
    hard = [f"{d['factor']} ({d['value']})" for d in drivers if d["effect"] == "NO-GO"]
    watch = [f"{d['factor']} ({d['value']})" for d in drivers if d["effect"] == "WATCH"]
    parts: list[str] = []
    if hard:
        parts.append("NO-GO: " + "; ".join(hard) + ".")
    if watch:
        parts.append("WATCH: " + "; ".join(watch) + ".")
    if not drivers:
        parts.append("No adverse signals across the full model panel; drug-like profile.")
    parts.append(f"Overall confidence-weighted risk {overall_risk:.2f}. Evidence tier: {tier}.")
    return " ".join(parts)


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #


def pkd_to_kd_nm(pkd: float) -> float:
    """DeepDTA predicts pKd = -log10(Kd/M). Return Kd in nM."""
    return (10.0 ** (-pkd)) * 1.0e9


def predict_invitro_panel(
    smiles: str, uniprot_id: str | None = None, therapeutic_area: str | None = None
) -> dict[str, Any]:
    """Full ML in-vitro panel + verdict for a valid SMILES. See module docstring.

    Orchestrates ALL relevant Layer-1 models already wired in this service:
      ADMET-AI (41 endpoints) · CardioTox (hERG 2nd opinion) · DILI-ML (2nd
      opinion) · Solubility-ML (dedicated logS, consensus) · BindingML/DeepDTA
      (predicted pKd when a UniProt target is supplied — works for any target
      via ESM-2, not catalog-gated) · applicability domain.

    Raises:
        ValueError  — empty/whitespace SMILES (true client error → 4xx).
        RuntimeError — ADMET-AI engine not provisioned/failed to load (→ 503).
                       We surface this instead of fabricating a panel.
    """
    if not smiles or not smiles.strip():
        raise ValueError("smiles is required")
    smiles = smiles.strip()

    from hakase_kernel.uncertainty import applicability
    from hakase_smallmol.admet import admet_ml, solubility_ml
    from hakase_smallmol.binding import binding_ml
    from hakase_smallmol.cardiotox import cardiotox
    from hakase_smallmol.dili import dili_ml

    admet = admet_ml.predict_admet_ml(smiles)
    if not admet.get("ml_available"):
        # Do NOT fabricate. Tell the operator to provision/warm the model.
        raise RuntimeError(
            "ADMET-AI engine unavailable: "
            f"{admet.get('error', 'unknown')}. Install `admet-ai` + weights and "
            "call /models/warmup. No values are fabricated."
        )
    flat = admet["endpoints"]
    mw = _num(flat.get("molecular_weight")) or _mw_from_rdkit(smiles)

    # Independent second opinions (best-effort — consensus degrades to ADMET-AI
    # alone if a second model is down, still a real number, never blank).
    cardiotox_prob = _safe_prob(
        lambda: cardiotox.predict_cardiotox(smiles), path=("prediction", "blocker_probability")
    )
    dili_prob_2nd = _safe_prob(
        lambda: dili_ml.predict_dili_ml(smiles), path=("prediction", "dili_probability")
    )
    sol_logs_2nd = _safe_prob(
        lambda: solubility_ml.predict_solubility_ml(smiles), path=("prediction", "logS_predicted")
    )

    panel = build_panel(flat, mw, cardiotox_prob, dili_prob_2nd)

    # Dedicated-solubility consensus (ADMET-AI AqSolDB + Solubility-ML).
    admet_logs = _num(flat.get("Solubility_AqSolDB"))
    sol_cons = _consensus(admet_logs, sol_logs_2nd)
    if sol_cons is not None:
        panel["absorption"]["solubility_consensus_logS"] = _readout(
            sol_cons,
            "log mol/L",
            "ADMET-AI + Solubility-ML (consensus)",
            qualitative=("High" if sol_cons > -4 else "Low"),
            note="Consensus aqueous solubility (two independent models).",
        )
        if mw:
            panel["absorption"]["solubility_consensus_mg_ml"] = _readout(
                logS_to_mg_per_ml(sol_cons, mw), "mg/mL", "ADMET-AI + Solubility-ML (consensus)"
            )

    # Binding affinity (DeepDTA) — only when a target is supplied. Real ML,
    # any UniProt via ESM-2 embedding; NOT gated to a curated catalog.
    binding_block = None
    if uniprot_id and uniprot_id.strip():
        pkd = _safe_prob(
            lambda: binding_ml.predict_binding_ml(smiles, uniprot_id.strip()),
            path=("prediction", "pkd"),
        )
        if pkd is None:  # some builds nest differently
            pkd = _safe_prob(
                lambda: binding_ml.predict_binding_ml(smiles, uniprot_id.strip()), path=("pkd",)
            )
        if pkd is not None:
            binding_block = {
                "uniprot_id": uniprot_id.strip(),
                "pkd": _readout(pkd, "pKd (-log10 M)", "BindingML/DeepDTA-GBM (ESM-2)"),
                "kd_nm": _readout(
                    pkd_to_kd_nm(pkd),
                    "nM",
                    "BindingML/DeepDTA-GBM (ESM-2)",
                    qualitative=("High" if pkd >= 7 else "Moderate" if pkd >= 6 else "Low"),
                    note="Predicted dissociation constant; <100 nM = potent.",
                ),
            }
    panel["binding"] = binding_block  # None when no target supplied (honest, not fabricated)

    # ── Live model-native uncertainty (ensemble disagreement; no data/lookup) ─
    herg_unc = _rf_uncertainty(cardiotox, smiles, "classifier")
    dili_unc = _rf_uncertainty(dili_ml, smiles, "classifier")
    sol_unc = _rf_uncertainty(solubility_ml, smiles, "regressor")
    if herg_unc:
        panel["toxicity"]["herg"]["uncertainty"] = herg_unc
    if dili_unc:
        panel["toxicity"]["dili"]["uncertainty"] = dili_unc
    if sol_unc:
        panel["absorption"]["logS"]["uncertainty"] = sol_unc
        if "solubility_consensus_logS" in panel["absorption"]:
            panel["absorption"]["solubility_consensus_logS"]["uncertainty"] = sol_unc
    confs = [u["confidence"] for u in (herg_unc, dili_unc, sol_unc) if u]
    agg_conf = sum(confs) / len(confs) if confs else None

    lip = _lipinski_violations(flat, mw, smiles)
    ad = applicability.assess(smiles, agg_conf)

    # Drug-likeness QED (RDKit) — feeds the drug-likeness axis of the verdict.
    qed_val = _qed_from_rdkit(smiles)

    # Target druggability (ProteinML/ESM-2) — best-effort, only when a UniProt
    # target was supplied. An undruggable target worsens the molecule's fate.
    # Best-effort like every other second opinion: never blocks the verdict.
    druggability = None
    if uniprot_id and uniprot_id.strip():
        from hakase_structure import protein_ml

        druggability = _safe_prob(
            lambda: protein_ml.predict_protein_ml(uniprot_id.strip()),
            path=("prediction", "druggability_probability"),
        )

    # Full PREDICTED safety-liability stack — Tox21 12-assay panel + reactive-
    # metabolite structural alerts + calibrated hERG/DILI/Ames vetoes, from
    # models.safety_triage. include_consensus=False: this is a NOVEL-compound
    # triage tool, so the verdict is judged ONLY on predicted in-vitro assays — it
    # must NOT depend on whether the molecule already EXISTS. The known-drug lookup
    # (ChEMBL/PubChem/openFDA "measured liability" override) is therefore off the
    # decision path; a matched known drug is surfaced as an FYI annotation only
    # (see result["known_reference"]), never as a verdict driver. Best-effort:
    # never blocks the verdict; the ADMET-AI safety heads still drive it if down.
    safety_stack = None
    try:
        from .safety_triage import predict_safety_triage

        st = predict_safety_triage(smiles, include_consensus=False)
        if st.get("ml_available"):
            safety_stack = st
    except Exception:  # noqa: BLE001 — safety stack is best-effort
        safety_stack = None

    # Extended L1 safety liabilities from dedicated models (BSEP/cholestasis,
    # phospholipidosis, cytotoxicity) — not covered by the ADMET-AI heads. Best-
    # effort; folded into the verdict below so every relevant L1 model refines the
    # fate call. When a model is down its signal is simply omitted (never blocks).
    try:
        panel["safety_extended"] = _build_safety_extended(smiles)
    except Exception:  # noqa: BLE001 — extended safety is best-effort
        panel["safety_extended"] = {}

    # Every signal the panel produced + the full safety-liability stack now drive
    # the verdict, each weighted by its own confidence (per-endpoint uncertainty
    # + applicability domain).
    vd = verdict(
        panel,
        lip["violations"],
        applicability=ad,
        druggability=druggability,
        qed=qed_val,
        safety=safety_stack,
        therapeutic_area=therapeutic_area,
    )

    result = {
        "smiles": smiles,
        "uniprot_id": uniprot_id,
        "ml_available": True,
        "panel": panel,
        "lipinski": lip,
        "qed": qed_val,
        "verdict": vd,
        "safety_liabilities": _safety_summary(safety_stack),
        "applicability_domain": ad,
        "provenance": {
            "module": "invitro_panel",
            "module_version": MODULE_VERSION,
            "engines": [
                admet["model_info"].get("engine"),
                (
                    "CardioTox v1 (RF)"
                    if cardiotox_prob is not None
                    else "CardioTox (down — consensus used ADMET-AI only)"
                ),
                (
                    "DILI-ML (RF)"
                    if dili_prob_2nd is not None
                    else "DILI-ML (down — consensus used ADMET-AI only)"
                ),
                (
                    "Solubility-ML (RF)"
                    if sol_logs_2nd is not None
                    else "Solubility-ML (down — ADMET-AI only)"
                ),
                "BindingML/DeepDTA (ESM-2)" if binding_block else "BindingML (no target supplied)",
                f"Applicability domain v{applicability.MODULE_VERSION}",
            ],
            "endpoint_count": admet["model_info"].get("endpoint_count"),
            "inference_time_ms": admet["model_info"].get("inference_time_ms"),
            "reference": admet["model_info"].get("reference"),
        },
    }

    # Sectioned wet-lab panel — every REAL readout grouped for a clean UI, each
    # assessed against its literature reference range (value + unit + good/borderline/
    # poor + basis). Built from the real predictions above; nothing fabricated.
    try:
        from hakase_kernel.translational import lab_reference

        result["wetlab"] = lab_reference.build_wetlab_sections(result)
    except Exception:  # noqa: BLE001 — presentation layer is best-effort
        result["wetlab"] = None

    return result


def _rf_uncertainty(module: Any, smiles: str, kind: str) -> dict[str, Any] | None:
    """Live ensemble-disagreement uncertainty for an RF model. No data/lookup.

    Reuses the model module's own `_load_model` + `_featurize`, extracts the
    per-tree predictions from the fitted forest, and derives a confidence from
    their spread. Best-effort: returns None (honest) if the model is not a
    bagging ensemble or is unavailable — never fabricates an uncertainty.
    """
    try:
        import numpy as np
        from hakase_kernel.uncertainty import uncertainty as U

        bundle = module._load_model()
        model = bundle["model"]
        feats = module._featurize(smiles)
        if feats is None:
            return None
        X = np.asarray(feats, dtype=float).reshape(1, -1)
        if kind == "classifier":
            members = U.rf_classifier_member_probs(model, X, 1)
            if members is None:
                return None
            mean, std = U.ensemble_mean_std(members)
            conf = U.classifier_confidence(std)
            cal = U.apply_calibration(mean, bundle.get("calibration"))
            return {
                "ensemble_mean": round(mean, 4),
                "ensemble_std": round(std, 4),
                "confidence": round(conf, 3),
                "reliability": U.reliability_band(conf),
                "n_members": int(members.size),
                "calibrated_probability": cal["value"],
                "calibrated": cal["calibrated"],
            }
        members = U.rf_regressor_member_preds(model, X)
        if members is None:
            return None
        mean, std = U.ensemble_mean_std(members)
        lo, hi = U.prediction_interval(mean, std, 90)
        conf = U.regressor_confidence(mean, std)
        return {
            "ensemble_mean": round(mean, 4),
            "ensemble_std": round(std, 4),
            "interval90": [round(lo, 4), round(hi, 4)],
            "confidence": round(conf, 3),
            "reliability": U.reliability_band(conf),
            "n_members": int(members.size),
        }
    except Exception:  # noqa: BLE001 — UQ is best-effort; never blocks a prediction
        return None


def _safe_prob(fn, path: tuple[str, ...]) -> float | None:
    try:
        r = fn()
        cur: Any = r
        for k in path:
            cur = cur.get(k) if isinstance(cur, dict) else None
        return _num(cur)
    except Exception:  # noqa: BLE001 — second opinion is optional
        return None


def _mw_from_rdkit(smiles: str) -> float | None:
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors

        m = Chem.MolFromSmiles(smiles)
        return float(Descriptors.MolWt(m)) if m else None
    except Exception:  # noqa: BLE001
        return None


def _qed_from_rdkit(smiles: str) -> float | None:
    """RDKit QED drug-likeness [0,1]. Best-effort; None if RDKit/QED unavailable."""
    try:
        from rdkit import Chem
        from rdkit.Chem.QED import qed

        m = Chem.MolFromSmiles(smiles)
        return float(qed(m)) if m else None
    except Exception:  # noqa: BLE001
        return None


def _lipinski_violations(flat: dict[str, Any], mw: float | None, smiles: str) -> dict[str, Any]:
    logp = _num(flat.get("logP"))
    hbd = _num(flat.get("hydrogen_bond_donors"))
    hba = _num(flat.get("hydrogen_bond_acceptors"))
    if any(x is None for x in (mw, logp, hbd, hba)):
        d = _rdkit_lipinski(smiles)
        mw = mw if mw is not None else d.get("mw")
        logp = logp if logp is not None else d.get("logp")
        hbd = hbd if hbd is not None else d.get("hbd")
        hba = hba if hba is not None else d.get("hba")
    viol = 0
    checks = {}
    if mw is not None:
        checks["mw"] = mw
        viol += mw > 500
    if logp is not None:
        checks["logp"] = logp
        viol += logp > 5
    if hbd is not None:
        checks["hbd"] = hbd
        viol += hbd > 5
    if hba is not None:
        checks["hba"] = hba
        viol += hba > 10
    return {"violations": int(viol), **checks}


def _rdkit_lipinski(smiles: str) -> dict[str, float]:
    try:
        from rdkit import Chem
        from rdkit.Chem import Crippen, Descriptors, rdMolDescriptors

        m = Chem.MolFromSmiles(smiles)
        if m is None:
            return {}
        return {
            "mw": float(Descriptors.MolWt(m)),
            "logp": float(Crippen.MolLogP(m)),
            "hbd": float(rdMolDescriptors.CalcNumHBD(m)),
            "hba": float(rdMolDescriptors.CalcNumHBA(m)),
        }
    except Exception:  # noqa: BLE001
        return {}


def _safety_summary(st: dict[str, Any] | None) -> dict[str, Any] | None:
    """Compact, UI-facing view of the full safety-liability stack that fed the
    verdict. None when the stack could not run. Nothing fabricated — every field
    is copied from the real safety_triage output."""
    if not st or not st.get("ml_available"):
        return None
    tri = st.get("triage", {}) or {}
    tox = st.get("tox21", {}) or {}
    dili_fusion = ((st.get("endpoints") or {}).get("dili") or {}).get("dili_fusion") or {}
    mk = ((st.get("consensus") or {}).get("sources") or {}).get("measured_known_drug") or {}
    hht = ((st.get("consensus") or {}).get("sources") or {}).get("admetlab_hht_dili") or {}
    tox21_view = None
    if tox.get("status") == "ok":
        tox21_view = {
            "flagged_in_domain": tox.get("flagged_assays_in_domain", []),
            "n_flagged_in_domain": tox.get("n_flagged_in_domain"),
            "top_liability": tox.get("top_liability"),
            # Pass the per-head detail through (not just the flag): the wet-lab
            # presentation layer needs the calibrated threshold, the applicability
            # domain for THIS molecule, and the head's held-out performance in order
            # to render each assay with its reference range + reliability, the same
            # contract every other readout satisfies.
            "panel": [
                {
                    "assay": h.get("assay"),
                    "group": h.get("group"),
                    "pathway": h.get("pathway"),
                    "mechanistic_meaning": h.get("mechanistic_meaning"),
                    "active_probability": h.get("active_probability"),
                    "active_flag": h.get("active_flag"),
                    "flag_basis": h.get("flag_basis"),
                    "in_domain": (h.get("applicability_domain") or {}).get("ad_in_domain"),
                    "ad_tanimoto_nearest": (h.get("applicability_domain") or {}).get(
                        "ad_tanimoto_nearest"
                    ),
                    "test_auroc": (h.get("head_performance") or {}).get("test_auroc"),
                }
                for h in (tox.get("panel") or [])
            ],
        }
    return {
        "tier": tri.get("tier"),
        "headline": tri.get("headline"),
        "core_veto_alerts": tri.get("core_veto_alerts", []),
        "core_screen_hits": tri.get("core_screen_hits", []),
        "core_out_of_domain_flags": tri.get("core_out_of_domain_flags", []),
        "tox21": tox21_view,
        "reactive_metabolites": (
            {
                "call": dili_fusion.get("call"),
                "alert_count": dili_fusion.get("reactive_metabolite_alerts"),
                "severity": dili_fusion.get("reactive_metabolite_severity"),
                "drivers": dili_fusion.get("drivers", []),
            }
            if dili_fusion
            else None
        ),
        "measured_known_drug": (
            {
                "name": mk.get("name"),
                "veto_liabilities": mk.get("veto_liabilities", []),
                "monitor_liabilities": mk.get("monitor_liabilities", []),
            }
            if mk.get("veto_liabilities") or mk.get("monitor_liabilities")
            else None
        ),
        "independent_second_opinion": (
            {
                "engine": hht.get("engine"),
                "endpoint": hht.get("endpoint"),
                "probability": hht.get("probability"),
                "risk_class": hht.get("risk_class"),
            }
            if hht.get("status") == "ok"
            else None
        ),
        "governance": st.get("governance", {}).get("not_a_medical_device"),
    }


def is_ready() -> dict[str, Any]:
    from hakase_smallmol.admet import admet_ml

    return {
        "module": "invitro_panel",
        "module_version": MODULE_VERSION,
        "admet_ai": admet_ml.is_ready(),
    }
