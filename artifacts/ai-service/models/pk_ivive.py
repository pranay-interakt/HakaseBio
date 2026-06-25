"""Layer 1 — Quantitative human PK by IVIVE (in-vitro → in-vivo extrapolation).

WHAT THIS IS
────────────
A deterministic, mechanistic projection of human pharmacokinetic parameters
(hepatic clearance, half-life, oral first-pass availability, exposure for a
given dose) from REAL predicted/measured in-vitro inputs. This is the same
IVIVE + well-stirred-liver methodology that underpins Simcyp/GastroPlus first-
in-human work — implemented over open inputs.

It is the L1 "PK readout": a directional, calibrated-under-uncertainty estimate
that turns ADMET endpoints into a concentration story. It is NOT a substitute
for a measured human PK study, and it does not claim to be.

PROVENANCE / NO-FALLBACK CONTRACT (project-wide policy)
──────────────────────────────────────────────────────
Every number that drives an output is a REAL input — either an ADMET-AI ML
prediction (provenance "ml") or a user-supplied measured value (provenance
"measured"). There is NO heuristic substitution: if the inputs required for a
block are missing, that block is returned with ``available = False`` and a
``missing`` list — it is NEVER computed from a guessed value. Physiological
SYSTEM parameters (hepatic blood flow, hepatocellularity, liver weight) are
literature reference constants, not per-molecule guesses; they are named,
cited, and overridable, and flagged with provenance "reference"/"assumed".

The two inputs the hepatic-clearance block strictly requires are:
  • hepatocyte intrinsic clearance CLint  (ADMET-AI ``Clearance_Hepatocyte_AZ``)
  • fraction unbound in plasma fu          (from ADMET-AI ``PPBR_AZ``)
Steady-state volume VDss (``VDss_Lombardo``) is required for the half-life and
concentration-time blocks; when it is absent, clearance is still returned but
the t½ / curve blocks are flagged unavailable — never faked.

MODEL (well-stirred liver, Rowland/Wilkinson; Houston IVIVE)
────────────────────────────────────────────────────────────
  CLint,in-vivo = CLint,hep · HPGL · LW                 (scale up µL/min/10⁶ → mL/min/kg)
  fu,blood      = fu,plasma / R_bp
  CL_hepatic    = Q_h · fu,b · CLint,in-vivo / (Q_h + fu,b · CLint,in-vivo)   (blood)
  E_h           = CL_hepatic / Q_h            (hepatic extraction ratio)
  F_h           = 1 − E_h                     (hepatic first-pass availability)
  CL_plasma     = CL_blood · R_bp
  t½            = ln2 · Vss / CL_plasma

References
──────────
  • Rowland M., Benet L.Z., Graham G.G. (1973) Clearance concepts. J. Pharmacokinet. Biopharm. 1:123.
  • Wilkinson G.R., Shand D.G. (1975) A physiological approach to hepatic drug clearance. Clin. Pharmacol. Ther. 18:377.
  • Houston J.B. (1994) Utility of in vitro drug metabolism data in predicting in vivo metabolic clearance. Biochem. Pharmacol. 47:1469.
  • Obach R.S. (1999) Prediction of human clearance of 29 drugs from in vitro data. Drug Metab. Dispos. 27:1350.
  • Davies B., Morris T. (1993) Physiological parameters in laboratory animals and humans. Pharm. Res. 10:1093.   (Q_h, liver weight)
  • Barter Z.E. et al. (2007) Scaling factors for the extrapolation of in vivo metabolic drug clearance from in vitro data. Curr. Drug Metab. 8:33.   (hepatocellularity HPGL = 99×10⁶ cells/g)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

# ── Human SYSTEM physiology — literature reference constants (NOT per-molecule) ──
# These are named, cited, and overridable. They describe the average human body,
# the same way every PBPK/IVIVE platform parameterises its reference individual.
HEPATIC_BLOOD_FLOW_ML_MIN_KG = 20.7   # Q_h, mL/min/kg  (Davies & Morris 1993)
HEPATOCELLULARITY_1E6_PER_G = 99.0    # HPGL, 10⁶ hepatocytes / g liver  (Barter 2007)
LIVER_WEIGHT_G_PER_KG = 25.7          # LW, g liver / kg body weight  (Davies & Morris 1993)
DEFAULT_BODY_WEIGHT_KG = 70.0         # reference adult
DEFAULT_BLOOD_PLASMA_RATIO = 1.0      # R_bp — ASSUMED 1.0 unless supplied (flagged "assumed")

LN2 = math.log(2.0)

# Below this fraction-unbound the PPB model can't resolve fu and the well-stirred
# CL becomes numerically unstable — we flag rather than fabricate a value.
FU_RESOLUTION_FLOOR = 1e-4


@dataclass
class PkInput:
    """A single PK-driving input with its real source. value is None when the
    upstream model did not produce a real number (NEVER defaulted)."""
    value: float | None
    provenance: str          # "ml" | "measured" | "reference" | "assumed"
    source: str              # human-readable origin
    units: str


def _num(x: Any) -> float | None:
    """Accept only a real finite number; reject None/str/NaN/Inf (no coercion)."""
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)) and math.isfinite(float(x)):
        return float(x)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# PURE CORE — independently unit-testable against literature (no ML, no network).
# ─────────────────────────────────────────────────────────────────────────────
def compute_ivive(
    *,
    clint_hep_ul_min_1e6: float,
    fu_plasma: float,
    vdss_l_per_kg: float | None = None,
    half_life_obach_h: float | None = None,
    body_weight_kg: float = DEFAULT_BODY_WEIGHT_KG,
    blood_plasma_ratio: float = DEFAULT_BLOOD_PLASMA_RATIO,
    q_h_ml_min_kg: float = HEPATIC_BLOOD_FLOW_ML_MIN_KG,
    hpgl_1e6_per_g: float = HEPATOCELLULARITY_1E6_PER_G,
    liver_g_per_kg: float = LIVER_WEIGHT_G_PER_KG,
    dose_mg: float | None = None,
) -> dict[str, Any]:
    """Well-stirred IVIVE from REAL numeric inputs. Pure: same inputs → same out.

    Raises ValueError only on structurally invalid inputs (≤0 CLint, fu out of
    (0,1]); the caller is responsible for the no-fallback "insufficient-input"
    envelope when an upstream value is simply absent.
    """
    if not (clint_hep_ul_min_1e6 > 0):
        raise ValueError("clint_hep must be > 0")
    if not (0.0 < fu_plasma <= 1.0):
        raise ValueError("fu_plasma must be in (0, 1]")

    warnings: list[str] = []

    # 1) Scale hepatocyte CLint → whole-liver in-vivo intrinsic clearance.
    #    (µL/min/10⁶cells)·(10⁶cells/g)·(g/kg) = µL/min/kg ; /1000 → mL/min/kg
    clint_invivo_ml_min_kg = clint_hep_ul_min_1e6 * hpgl_1e6_per_g * liver_g_per_kg / 1000.0

    # 2) Well-stirred liver — blood clearance.
    fu_blood = fu_plasma / blood_plasma_ratio
    if fu_blood > 1.0:
        fu_blood = 1.0  # blood:plasma <1 can push fu_b >1; cap at physical max
        warnings.append("fu,blood capped at 1.0 (blood:plasma ratio < 1)")
    if fu_plasma < FU_RESOLUTION_FLOOR:
        warnings.append(
            f"fu below model resolution ({fu_plasma:.1e}); hepatic CL is an order-of-magnitude estimate"
        )
    cl_blood_ml_min_kg = (q_h_ml_min_kg * fu_blood * clint_invivo_ml_min_kg) / (
        q_h_ml_min_kg + fu_blood * clint_invivo_ml_min_kg
    )

    # 3) Extraction ratio & hepatic first-pass availability.
    e_h = cl_blood_ml_min_kg / q_h_ml_min_kg
    f_h = 1.0 - e_h
    extraction_class = "high" if e_h >= 0.7 else "intermediate" if e_h >= 0.3 else "low"

    # 4) Plasma clearance (Vd/t½ are plasma-referenced).
    cl_plasma_ml_min_kg = cl_blood_ml_min_kg * blood_plasma_ratio
    cl_plasma_l_h = cl_plasma_ml_min_kg * body_weight_kg * 60.0 / 1000.0  # mL/min/kg → L/h

    out: dict[str, Any] = {
        "clint_invivo_ml_min_kg": round(clint_invivo_ml_min_kg, 4),
        "fu_blood": round(fu_blood, 6),
        "cl_hepatic_blood_ml_min_kg": round(cl_blood_ml_min_kg, 4),
        "cl_hepatic_plasma_ml_min_kg": round(cl_plasma_ml_min_kg, 4),
        "cl_hepatic_plasma_l_h": round(cl_plasma_l_h, 4),
        "extraction_ratio_eh": round(e_h, 4),
        "extraction_class": extraction_class,
        "hepatic_first_pass_availability_fh": round(f_h, 4),
        # Total clearance ≥ hepatic (renal/biliary not predicted) — disclosed, not faked.
        "clearance_note": "Hepatic (metabolic) clearance only; renal/biliary routes are not predicted, so total CL ≥ this value and true t½ ≤ the value below.",
        "warnings": warnings,
    }

    # 5) Vd & t½ — require a real VDss.
    if _num(vdss_l_per_kg) is not None and vdss_l_per_kg > 0:
        vss_l = vdss_l_per_kg * body_weight_kg
        half_life_h = LN2 * vss_l / cl_plasma_l_h if cl_plasma_l_h > 0 else None
        out["vss_l"] = round(vss_l, 3)
        out["vdss_l_per_kg"] = round(vdss_l_per_kg, 4)
        out["half_life_h"] = round(half_life_h, 3) if half_life_h is not None else None
        out["half_life_available"] = half_life_h is not None
        # 6) Independent cross-check vs ADMET-AI Half_Life_Obach (both real signals).
        obach = _num(half_life_obach_h)
        if obach is not None and obach > 0 and half_life_h is not None:
            ratio = half_life_h / obach
            out["half_life_obach_h"] = round(obach, 3)
            out["half_life_crosscheck_ratio"] = round(ratio, 3)
            out["half_life_crosscheck_agree"] = 0.33 <= ratio <= 3.0  # within 3-fold
    else:
        out["half_life_available"] = False
        out["half_life_missing"] = ["vdss_l_per_kg"]

    # 7) Exposure for an IV dose (assumption-free: needs only CL & Vss).
    if _num(dose_mg) is not None and dose_mg > 0 and cl_plasma_l_h > 0:
        auc_iv = dose_mg / cl_plasma_l_h                      # mg·h/L = µg/mL·h
        block: dict[str, Any] = {
            "route": "iv",
            "dose_mg": round(dose_mg, 4),
            "auc_inf_mg_h_per_l": round(auc_iv, 4),
        }
        if out.get("vss_l"):
            vss_l = out["vss_l"]
            c0 = dose_mg / vss_l                              # mg/L = µg/mL (bolus)
            ke = cl_plasma_l_h / vss_l                        # 1/h
            block["c0_mg_per_l"] = round(c0, 5)
            block["ke_per_h"] = round(ke, 5)
            # IV-bolus concentration–time curve over ~5 half-lives.
            t_end = min(5.0 * LN2 / ke, 168.0) if ke > 0 else 24.0
            n = 40
            block["curve"] = [
                {"t_h": round(i * t_end / n, 3), "c_mg_per_l": round(c0 * math.exp(-ke * i * t_end / n), 6)}
                for i in range(n + 1)
            ]
            block["curve_note"] = "IV-bolus, one-compartment (assumption-free: determined by CL and Vss). Oral curve requires a measured/declared ka and Fa·Fg and is omitted rather than assumed."
        out["exposure"] = block

    return out


# ─────────────────────────────────────────────────────────────────────────────
# WRAPPER — sources REAL inputs from ADMET-AI (or measured overrides) and
# enforces the no-fallback "insufficient-input" contract.
# ─────────────────────────────────────────────────────────────────────────────
def _mw_from_smiles(smiles: str) -> float | None:
    try:
        from rdkit import Chem
        from rdkit.Chem import Descriptors
        mol = Chem.MolFromSmiles(smiles)
        return float(Descriptors.MolWt(mol)) if mol is not None else None
    except Exception:
        return None


def predict_pk_ivive(
    smiles: str,
    *,
    overrides: dict[str, Any] | None = None,
    ml_inputs: dict[str, Any] | None = None,
    body_weight_kg: float = DEFAULT_BODY_WEIGHT_KG,
    blood_plasma_ratio: float | None = None,
    dose_mg: float | None = None,
) -> dict[str, Any]:
    """End-to-end L1 PK readout for a SMILES.

    Input precedence per quantity (keys: clint_hep_ul_min_1e6, fu_plasma,
    vdss_l_per_kg, half_life_obach_h):
      1. ``overrides``  — a MEASURED value supplied by the caller → provenance "measured".
      2. ``ml_inputs``  — an ADMET-AI value the caller ALREADY fetched (e.g. the L1
         overlay) → provenance "ml". Lets the pipeline reuse its single ADMET-AI
         inference instead of paying a second one here. These must be genuine ML
         outputs; they are tagged "ml", never "measured".
      3. server ADMET-AI — fetched here via ``predict_admet_ml`` only for the
         quantities not already supplied → provenance "ml".
    Anything still absent yields the no-fallback "insufficient-input" envelope.

    ``source`` is one of:
      • "ivive"              — computed from real inputs
      • "insufficient-input" — a required real input was absent (NO fallback)
      • "input-error"        — invalid SMILES / structurally bad input
    """
    if not smiles or not smiles.strip():
        return {"source": "input-error", "available": False, "reason": "smiles is required"}

    overrides = overrides or {}
    ml_inputs = ml_inputs or {}
    inputs: dict[str, PkInput] = {}

    # ---- Acquire inputs: measured override > caller-supplied ml > server ml > None.
    def take(key: str, server_ml_value: float | None, units: str, ml_source: str) -> PkInput:
        ov = _num(overrides.get(key))
        if ov is not None:
            return PkInput(ov, "measured", "user-supplied measured value", units)
        cli = _num(ml_inputs.get(key))
        if cli is not None:
            return PkInput(cli, "ml", f"{ml_source} (caller-supplied L1 overlay)", units)
        return PkInput(_num(server_ml_value), "ml", ml_source, units)

    # Only call the ML model for quantities supplied by NEITHER overrides nor ml_inputs.
    need_ml = any(
        _num(overrides.get(k)) is None and _num(ml_inputs.get(k)) is None
        for k in ("clint_hep_ul_min_1e6", "fu_plasma", "vdss_l_per_kg", "half_life_obach_h")
    )
    admet_meta: dict[str, Any] = {}
    flat: dict[str, Any] = {}
    if need_ml:
        try:
            from models.admet_ml import predict_admet_ml
        except Exception:
            from admet_ml import predict_admet_ml  # type: ignore
        res = predict_admet_ml(smiles)
        admet_meta = {"ml_available": res.get("ml_available"), "source": res.get("source"),
                      "engine": (res.get("model_info") or {}).get("engine")}
        if res.get("ml_available"):
            flat = res.get("endpoints") or {}

    ppb_bound_pct = _num(flat.get("PPBR_AZ"))
    fu_from_ml = (max(0.0, min(1.0, 1.0 - ppb_bound_pct / 100.0)) if ppb_bound_pct is not None else None)

    inputs["clint_hep_ul_min_1e6"] = take("clint_hep_ul_min_1e6", _num(flat.get("Clearance_Hepatocyte_AZ")),
                                          "µL/min/10⁶ cells", "ADMET-AI Clearance_Hepatocyte_AZ")
    inputs["fu_plasma"] = take("fu_plasma", fu_from_ml, "fraction", "ADMET-AI PPBR_AZ → fu")
    inputs["vdss_l_per_kg"] = take("vdss_l_per_kg", _num(flat.get("VDss_Lombardo")),
                                   "L/kg", "ADMET-AI VDss_Lombardo")
    inputs["half_life_obach_h"] = take("half_life_obach_h", _num(flat.get("Half_Life_Obach")),
                                       "h", "ADMET-AI Half_Life_Obach")

    r_bp = _num(blood_plasma_ratio) or _num(overrides.get("blood_plasma_ratio")) or DEFAULT_BLOOD_PLASMA_RATIO
    r_bp_prov = "measured" if (_num(blood_plasma_ratio) or _num(overrides.get("blood_plasma_ratio"))) else "assumed"

    # ---- No-fallback gate: the two hard requirements for any CL output.
    missing = [k for k in ("clint_hep_ul_min_1e6", "fu_plasma") if inputs[k].value is None]
    if missing:
        return {
            "source": "insufficient-input",
            "available": False,
            "reason": "Required real PK input(s) unavailable — refusing to compute on a guessed value.",
            "missing": missing,
            "inputs": {k: vars(v) for k, v in inputs.items()},
            "admet_ml": admet_meta,
            "remediation": "Bring the ADMET-AI ML stack online (STRICT_ML=1) or supply measured CLint/fu via `overrides`.",
        }

    fu_val = inputs["fu_plasma"].value
    if fu_val is not None and fu_val <= 0:
        return {
            "source": "insufficient-input", "available": False,
            "reason": "fu resolved to 0 (≈100% protein bound); hepatic clearance is indeterminate without a measured fu.",
            "missing": ["fu_plasma (nonzero)"],
            "inputs": {k: vars(v) for k, v in inputs.items()},
        }

    try:
        params = compute_ivive(
            clint_hep_ul_min_1e6=inputs["clint_hep_ul_min_1e6"].value,  # type: ignore[arg-type]
            fu_plasma=fu_val,                                            # type: ignore[arg-type]
            vdss_l_per_kg=inputs["vdss_l_per_kg"].value,
            half_life_obach_h=inputs["half_life_obach_h"].value,
            body_weight_kg=body_weight_kg,
            blood_plasma_ratio=r_bp,
            dose_mg=dose_mg,
        )
    except ValueError as e:
        return {"source": "input-error", "available": False, "reason": str(e),
                "inputs": {k: vars(v) for k, v in inputs.items()}}

    return {
        "source": "ivive",
        "available": True,
        "smiles": smiles,
        "mw_g_per_mol": _mw_from_smiles(smiles),
        "parameters": params,
        "inputs": {k: vars(v) for k, v in inputs.items()},
        "system_parameters": {
            "body_weight_kg": {"value": body_weight_kg, "provenance": "assumed", "source": "reference adult"},
            "blood_plasma_ratio": {"value": r_bp, "provenance": r_bp_prov, "source": "R_bp"},
            "hepatic_blood_flow_ml_min_kg": {"value": HEPATIC_BLOOD_FLOW_ML_MIN_KG, "provenance": "reference", "source": "Davies & Morris 1993"},
            "hepatocellularity_1e6_per_g": {"value": HEPATOCELLULARITY_1E6_PER_G, "provenance": "reference", "source": "Barter 2007"},
            "liver_weight_g_per_kg": {"value": LIVER_WEIGHT_G_PER_KG, "provenance": "reference", "source": "Davies & Morris 1993"},
        },
        "admet_ml": admet_meta,
        "model_info": {
            "engine": "Hakase IVIVE (well-stirred liver, Rowland/Wilkinson; Houston scale-up)",
            "method": "Deterministic IVIVE from real ADMET-AI inputs; no heuristic fallback",
            "references": [
                "Wilkinson & Shand 1975 Clin Pharmacol Ther 18:377",
                "Houston 1994 Biochem Pharmacol 47:1469",
                "Obach 1999 Drug Metab Dispos 27:1350",
                "Davies & Morris 1993 Pharm Res 10:1093",
                "Barter 2007 Curr Drug Metab 8:33",
            ],
        },
    }


def is_ready() -> dict[str, Any]:
    """IVIVE is pure arithmetic — always ready; its INPUTS depend on ADMET-AI."""
    return {"loaded": True, "engine": "Hakase IVIVE", "depends_on": "ADMET-AI (Clearance_Hepatocyte_AZ, PPBR_AZ, VDss_Lombardo)"}
