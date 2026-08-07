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
Every number that drives an output is a REAL input — either an Hakase ADMET ML
prediction (provenance "ml") or a user-supplied measured value (provenance
"measured"). There is NO heuristic substitution: if the inputs required for a
block are missing, that block is returned with ``available = False`` and a
``missing`` list — it is NEVER computed from a guessed value. Physiological
SYSTEM parameters (hepatic blood flow, hepatocellularity, liver weight) are
literature reference constants, not per-molecule guesses; they are named,
cited, and overridable, and flagged with provenance "reference"/"assumed".

The two inputs the hepatic-clearance block strictly requires are:
  • hepatocyte intrinsic clearance CLint  (Hakase ADMET ``Clearance_Hepatocyte_AZ``)
  • fraction unbound in plasma fu          (from Hakase ADMET ``PPBR_AZ``)
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
HEPATIC_BLOOD_FLOW_ML_MIN_KG = 20.7  # Q_h, mL/min/kg  (Davies & Morris 1993)
HEPATOCELLULARITY_1E6_PER_G = 99.0  # HPGL, 10⁶ hepatocytes / g liver  (Barter 2007)
LIVER_WEIGHT_G_PER_KG = 25.7  # LW, g liver / kg body weight  (Davies & Morris 1993)
DEFAULT_BODY_WEIGHT_KG = 70.0  # reference adult
DEFAULT_BLOOD_PLASMA_RATIO = 1.0  # R_bp — ASSUMED 1.0 unless supplied (flagged "assumed")

LN2 = math.log(2.0)

# Below this fraction-unbound the PPB model can't resolve fu and the well-stirred
# CL becomes numerically unstable — we flag rather than fabricate a value.
FU_RESOLUTION_FLOOR = 1e-4


@dataclass
class PkInput:
    """A single PK-driving input with its real source. value is None when the
    upstream model did not produce a real number (NEVER defaulted)."""

    value: float | None
    provenance: str  # "ml" | "measured" | "reference" | "assumed"
    source: str  # human-readable origin
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
        # 6) Independent cross-check vs Hakase ADMET Half_Life_Obach (both real signals).
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
        auc_iv = dose_mg / cl_plasma_l_h  # mg·h/L = µg/mL·h
        block: dict[str, Any] = {
            "route": "iv",
            "dose_mg": round(dose_mg, 4),
            "auc_inf_mg_h_per_l": round(auc_iv, 4),
        }
        if out.get("vss_l"):
            vss_l = out["vss_l"]
            c0 = dose_mg / vss_l  # mg/L = µg/mL (bolus)
            ke = cl_plasma_l_h / vss_l  # 1/h
            block["c0_mg_per_l"] = round(c0, 5)
            block["ke_per_h"] = round(ke, 5)
            # IV-bolus concentration–time curve over ~5 half-lives.
            t_end = min(5.0 * LN2 / ke, 168.0) if ke > 0 else 24.0
            n = 40
            block["curve"] = [
                {
                    "t_h": round(i * t_end / n, 3),
                    "c_mg_per_l": round(c0 * math.exp(-ke * i * t_end / n), 6),
                }
                for i in range(n + 1)
            ]
            block["curve_note"] = (
                "IV-bolus, one-compartment (assumption-free: determined by CL and Vss). Oral curve requires a measured/declared ka and Fa·Fg and is omitted rather than assumed."
            )
        out["exposure"] = block

    return out


# ─────────────────────────────────────────────────────────────────────────────
# SPECIES SYSTEM PARAMETERS — sourced from the kernel physiology store (S1-T2),
# keyed by species, replacing the hard-coded human literals in the wrapper.
# compute_ivive is UNTOUCHED; these feed its overridable system-parameter args.
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class SystemParameters:
    """Species system physiology for IVIVE, resolved from the kernel store.

    Per-kg rates at the species reference (``q_h``, ``gfr``) and the scale-up
    constants (``hpgl``, ``liver_g_per_kg``, ``body_weight_kg``). ``hpgl`` is
    species-specific (human 99e6/g, rat 120e6/g); when the store carries a value
    the provenance is "reference", and only when it does not is human assumed and
    flagged (``hpgl_provenance`` = "assumed") — the least-reliable term for
    cross-species metabolism.
    """

    species: str
    strain: str
    body_weight_kg: float
    q_h_ml_min_kg: float
    hpgl_1e6_per_g: float
    liver_g_per_kg: float
    gfr_ml_min_kg: float
    hpgl_provenance: str  # "reference" | "assumed"
    warnings: list[str]


def resolve_system_parameters(
    species: str = "human",
    strain: str | None = None,
    body_weight_kg: float | None = None,
) -> SystemParameters:
    """Resolve IVIVE system physiology for a species from the kernel store.

    For ``human`` this reproduces the historical constants exactly (Q_h 20.7,
    HPGL 99e6/g, liver 25.7 g/kg, BW 70). Unknown species raise ``ValueError``.
    """
    from hakase_kernel.pbpk.physiology import store as _store

    sp = species.strip().lower()
    st = (strain or _store.DEFAULT_STRAIN.get(sp) or "").strip().lower()
    base = _store.SPECIES_PHYSIOLOGY.get((sp, st))
    if base is None:
        raise ValueError(
            f"no calibrated physiology for (species={species!r}, strain={strain!r}); "
            f"known: {sorted(_store.SPECIES_PHYSIOLOGY)}"
        )

    warnings: list[str] = []
    hpgl = base.hepatocellularity_1e6_per_g
    hpgl_provenance = "reference"
    if hpgl is None:
        hpgl = HEPATOCELLULARITY_1E6_PER_G
        hpgl_provenance = "assumed"
        warnings.append(
            f"hepatocellularity not established for {sp!r}; assumed human "
            f"{HEPATOCELLULARITY_1E6_PER_G:g}e6/g (metabolic CL is the least reliable term)"
        )

    liver_fraction = base.organ_volume_fraction["liver"]
    return SystemParameters(
        species=base.species,
        strain=base.strain,
        body_weight_kg=(
            base.reference_body_weight_kg if body_weight_kg is None else body_weight_kg
        ),
        q_h_ml_min_kg=base.hepatic_blood_flow_ml_min_kg,
        hpgl_1e6_per_g=hpgl,
        liver_g_per_kg=liver_fraction * 1000.0,  # fraction of BW -> g/kg (density ~1)
        gfr_ml_min_kg=base.gfr_ml_min_kg,
        hpgl_provenance=hpgl_provenance,
        warnings=warnings,
    )


def compute_renal_clearance(gfr_ml_min_kg: float, fu_plasma: float) -> float:
    """Renal clearance by glomerular filtration only: ``CL_renal = fu · GFR``.

    Filtration is the only mechanism modelled — tubular secretion and
    reabsorption are not — so this is a lower bound for actively secreted drugs
    and an upper bound for reabsorbed ones. Units: mL/min/kg (matching GFR).
    """
    if gfr_ml_min_kg < 0:
        raise ValueError("gfr must be >= 0")
    if not (0.0 < fu_plasma <= 1.0):
        raise ValueError("fu_plasma must be in (0, 1]")
    return fu_plasma * gfr_ml_min_kg


# ─────────────────────────────────────────────────────────────────────────────
# MONTE-CARLO WRAPPER — samples each ML input from its residual distribution
# (S1-T4) and reports median + 90% intervals. It CALLS compute_ivive per draw;
# it does NOT modify the pure core. The deterministic path is unaffected.
# ─────────────────────────────────────────────────────────────────────────────
# Provisional per-endpoint lognormal error budgets (ASSUMED, not yet fitted from
# ADMET validation residuals — open decision #2 in docs/pbpk-layer.md §4.5). They
# are overridable by passing fitted `residuals.LogNormalError`s. A "measured"
# input carries no model error (sigma 0). GSD = exp(sigma).
_DEFAULT_RESIDUAL_SIGMA = {
    "clint_hep_ul_min_1e6": math.log(2.0),  # ~2-fold (hepatocyte IVIVE)
    "fu_plasma": 0.30,  # ~1.35-fold (plasma protein binding)
    "vdss_l_per_kg": 0.45,  # ~1.57-fold (VDss_Lombardo)
}
_MC_METRICS = (
    "cl_hepatic_plasma_ml_min_kg",
    "cl_renal_plasma_ml_min_kg",
    "cl_total_plasma_ml_min_kg",
    "extraction_ratio_eh",
    "hepatic_first_pass_availability_fh",
    "half_life_h",
)


def _default_residual_model(key: str):
    from hakase_kernel.uncertainty.residuals import LogNormalError

    return LogNormalError(mu=0.0, sigma=_DEFAULT_RESIDUAL_SIGMA[key], n=1)


def montecarlo_ivive(
    *,
    clint_hep_ul_min_1e6: float,
    fu_plasma: float,
    system: SystemParameters,
    vdss_l_per_kg: float | None = None,
    half_life_obach_h: float | None = None,
    blood_plasma_ratio: float = DEFAULT_BLOOD_PLASMA_RATIO,
    provenance: dict[str, str] | None = None,
    residual_models: dict[str, Any] | None = None,
    n_samples: int = 2000,
    seed: int = 12345,
    coverage: float = 0.90,
) -> dict[str, Any]:
    """Monte-Carlo propagation of ML-input uncertainty through compute_ivive.

    Each ML-sourced input is drawn from its lognormal residual model; a
    ``measured`` input (per ``provenance``) is held fixed (no model error).
    Returns the median and central ``coverage`` interval (default 90% -> 5th/95th
    percentiles) for each PK metric, plus the residual models actually used.
    Seed-reproducible.
    """
    import numpy as np

    if not (0.0 < coverage < 1.0):
        raise ValueError("coverage must be in (0, 1)")
    if n_samples < 1:
        raise ValueError("n_samples must be >= 1")

    provenance = provenance or {}
    residual_models = residual_models or {}
    rng = np.random.default_rng(seed)

    point_values = {
        "clint_hep_ul_min_1e6": clint_hep_ul_min_1e6,
        "fu_plasma": fu_plasma,
        "vdss_l_per_kg": vdss_l_per_kg,
    }

    def _draw(key: str) -> tuple[np.ndarray | None, dict[str, Any]]:
        point = point_values[key]
        if point is None or not (point > 0):
            return None, {"provenance": "absent"}
        # A measured input has no model error; an ML input uses its residual model.
        if provenance.get(key) == "measured":
            return np.full(n_samples, float(point)), {"provenance": "measured", "sigma": 0.0}
        model = residual_models.get(key) or _default_residual_model(key)
        meta = {
            "provenance": provenance.get(key, "ml"),
            "sigma": model.sigma,
            "geometric_sd": model.geometric_sd,
            "fitted_n": model.n,
        }
        return model.sample(float(point), n_samples, rng), meta

    clint_s, clint_meta = _draw("clint_hep_ul_min_1e6")
    fu_s, fu_meta = _draw("fu_plasma")
    vdss_s, vdss_meta = _draw("vdss_l_per_kg")
    if clint_s is None or fu_s is None:
        raise ValueError("montecarlo_ivive requires positive clint and fu point estimates")

    collected: dict[str, list[float]] = {m: [] for m in _MC_METRICS}
    for i in range(n_samples):
        clint_i = float(clint_s[i])
        fu_i = min(max(float(fu_s[i]), FU_RESOLUTION_FLOOR), 1.0)  # keep in the physical range
        vdss_i = float(vdss_s[i]) if vdss_s is not None else None
        p = compute_ivive(
            clint_hep_ul_min_1e6=clint_i,
            fu_plasma=fu_i,
            vdss_l_per_kg=vdss_i,
            body_weight_kg=system.body_weight_kg,
            blood_plasma_ratio=blood_plasma_ratio,
            q_h_ml_min_kg=system.q_h_ml_min_kg,
            hpgl_1e6_per_g=system.hpgl_1e6_per_g,
            liver_g_per_kg=system.liver_g_per_kg,
            dose_mg=None,  # scalar PK only; no per-draw exposure curve
        )
        renal_i = compute_renal_clearance(system.gfr_ml_min_kg, fu_i)
        total_i = p["cl_hepatic_plasma_ml_min_kg"] + renal_i
        p["cl_renal_plasma_ml_min_kg"] = renal_i
        p["cl_total_plasma_ml_min_kg"] = total_i
        for m in _MC_METRICS:
            v = p.get(m)
            if v is not None:
                collected[m].append(float(v))

    lo_pct = 100.0 * (1.0 - coverage) / 2.0
    hi_pct = 100.0 * (1.0 + coverage) / 2.0
    distributions: dict[str, Any] = {}
    for m, vals in collected.items():
        if not vals:
            continue
        a = np.asarray(vals, dtype=float)
        distributions[m] = {
            "median": round(float(np.median(a)), 4),
            "ci_low": round(float(np.percentile(a, lo_pct)), 4),
            "ci_high": round(float(np.percentile(a, hi_pct)), 4),
            "n": int(a.size),
        }

    return {
        "engine": "Monte-Carlo residual propagation through compute_ivive",
        "n_samples": n_samples,
        "seed": seed,
        "coverage": coverage,
        "distributions": distributions,
        "residual_models": {
            "clint_hep_ul_min_1e6": clint_meta,
            "fu_plasma": fu_meta,
            "vdss_l_per_kg": vdss_meta,
        },
        "note": (
            "Intervals reflect ML-input uncertainty only (residual models), propagated "
            "through the deterministic well-stirred core. Default residual sigmas are "
            "assumed order-of-magnitude budgets until per-endpoint validation residuals are "
            "wired; measured inputs contribute no width."
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# WRAPPER — sources REAL inputs from Hakase ADMET (or measured overrides) and
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


# Validation provenance for the cross-species low-confidence signal below.
_CROSS_SPECIES_HANDOFF_REF = (
    "docs/pbpk-s2t5-validation-handoff.md §3.4 "
    "(human hepatocyte CLint vs. rat CL: Spearman 0.21, p=0.48)"
)


def _cross_species_confidence(species: str, inputs: dict[str, PkInput]) -> dict[str, Any]:
    """Confidence descriptor for a resolved IVIVE readout.

    The hepatic-clearance-driving inputs (CLint, fu) behind provenance ``"ml"`` are
    the human-trained Hakase ADMET models. Validation proved those are NOT predictive
    of rat (and, by extension, other non-human) clearance. So a NON-human readout
    whose CLint OR fu ends up "ml" — i.e. neither a measured override nor the curated
    measured reference supplied it — is flagged ``level == "low"`` with a rationale
    that names the concrete limitation. Human, or any species with a measured CLint
    and fu, is ``"nominal"`` (no flag).
    """
    ml_driven = [k for k in ("clint_hep_ul_min_1e6", "fu_plasma") if inputs[k].provenance == "ml"]
    if species.strip().lower() == "human" or not ml_driven:
        return {"level": "nominal", "flags": [], "rationale": None}

    rationale = (
        f"Low confidence for species={species!r}: the hepatic-clearance input(s) "
        f"{ml_driven} come from the human-trained Hakase ADMET model. Human-trained "
        f"hepatocyte CLint is NOT predictive of {species} clearance "
        f"({_CROSS_SPECIES_HANDOFF_REF}), so this readout's clearance/half-life/exposure "
        f"should be treated as unreliable. Supply a measured or {species}-calibrated "
        f"CLint/fu (via `overrides`, or the curated measured reference) before trusting it."
    )
    return {
        "level": "low",
        "flags": ["cross_species_ml_clint_unreliable"],
        "rationale": rationale,
        "ml_driven_inputs": ml_driven,
        "reference": _CROSS_SPECIES_HANDOFF_REF,
    }


def predict_pk_ivive(
    smiles: str,
    *,
    overrides: dict[str, Any] | None = None,
    ml_inputs: dict[str, Any] | None = None,
    species: str = "human",
    strain: str | None = None,
    body_weight_kg: float | None = None,
    blood_plasma_ratio: float | None = None,
    dose_mg: float | None = None,
    montecarlo: bool = False,
    residual_models: dict[str, Any] | None = None,
    mc_samples: int = 2000,
    mc_seed: int = 12345,
    mc_coverage: float = 0.90,
) -> dict[str, Any]:
    """End-to-end L1 PK readout for a SMILES.

    Input precedence per quantity (keys: clint_hep_ul_min_1e6, fu_plasma,
    vdss_l_per_kg, half_life_obach_h):
      1. ``overrides``  — a MEASURED value supplied by the caller → provenance "measured".
      2. curated measured reference — a species-matched, primary-source-cited rat
         hepatocyte CLint / fu / blood:plasma value from
         ``resources/measured_clint_reference.csv`` (Naritomi 2003, Ito 2004) →
         provenance "measured", source e.g. "measured (Naritomi 2003, PMID:12695346)".
         This exists because the human-trained ML CLint is uninformative for rat;
         where we have real rat data, production uses it before the ML fallback.
      3. ``ml_inputs``  — an Hakase ADMET value the caller ALREADY fetched (e.g. the L1
         overlay) → provenance "ml". Lets the pipeline reuse its single Hakase ADMET
         inference instead of paying a second one here. These must be genuine ML
         outputs; they are tagged "ml", never "measured".
      4. server Hakase ADMET — fetched here via ``predict_admet_ml`` only for the
         quantities not already supplied → provenance "ml".
    Anything still absent yields the no-fallback "insufficient-input" envelope.

    The curated reference is species-aware: its rat records are consulted only when
    ``species`` resolves to rat, so a human prediction is never served rat data.

    ``source`` is one of:
      • "ivive"              — computed from real inputs
      • "insufficient-input" — a required real input was absent (NO fallback)
      • "input-error"        — invalid SMILES / structurally bad input
    """
    if not smiles or not smiles.strip():
        return {"source": "input-error", "available": False, "reason": "smiles is required"}

    # System physiology from the kernel store, keyed by species (replaces the
    # hard-coded human literals). Human reproduces the historical constants.
    try:
        system = resolve_system_parameters(species, strain, body_weight_kg)
    except ValueError as e:
        return {"source": "input-error", "available": False, "reason": str(e)}

    overrides = overrides or {}
    ml_inputs = ml_inputs or {}
    inputs: dict[str, PkInput] = {}

    # Curated, cited measured-input reference (rat hepatocyte CLint/fu/BPR from
    # Naritomi 2003 & Ito 2004). Consulted BELOW a caller override but ABOVE any
    # ML value, so production benefits from real rat data where we have it while a
    # caller can still override and unknown compounds fall through to ML. Empty for
    # non-rat species (species-aware) and for compounds not in the reference.
    from hakase_smallmol.pk_ivive.measured_reference import lookup_measured_reference

    measured_ref = lookup_measured_reference(smiles, system.species) or {}

    def _ref_input(key: str) -> dict[str, Any] | None:
        r = measured_ref.get(key)
        return r if isinstance(r, dict) and _num(r.get("value")) is not None else None

    # ---- Acquire inputs: measured override > curated reference > caller ml > server ml.
    def take(key: str, server_ml_value: float | None, units: str, ml_source: str) -> PkInput:
        ov = _num(overrides.get(key))
        if ov is not None:
            return PkInput(ov, "measured", "user-supplied measured value", units)
        ref = _ref_input(key)
        if ref is not None:
            return PkInput(_num(ref["value"]), "measured", ref["provenance"], units)
        cli = _num(ml_inputs.get(key))
        if cli is not None:
            return PkInput(cli, "ml", f"{ml_source} (caller-supplied L1 overlay)", units)
        return PkInput(_num(server_ml_value), "ml", ml_source, units)

    # Only call the ML model for quantities supplied by NONE of overrides, the
    # curated reference, or ml_inputs.
    need_ml = any(
        _num(overrides.get(k)) is None and _ref_input(k) is None and _num(ml_inputs.get(k)) is None
        for k in ("clint_hep_ul_min_1e6", "fu_plasma", "vdss_l_per_kg", "half_life_obach_h")
    )
    admet_meta: dict[str, Any] = {}
    flat: dict[str, Any] = {}
    if need_ml:
        try:
            from hakase_smallmol.admet.admet_ml import predict_admet_ml
        except Exception:
            from admet_ml import predict_admet_ml  # type: ignore
        res = predict_admet_ml(smiles)
        admet_meta = {
            "ml_available": res.get("ml_available"),
            "source": res.get("source"),
            "engine": (res.get("model_info") or {}).get("engine"),
        }
        if res.get("ml_available"):
            flat = res.get("endpoints") or {}

    ppb_bound_pct = _num(flat.get("PPBR_AZ"))
    fu_from_ml = (
        max(0.0, min(1.0, 1.0 - ppb_bound_pct / 100.0)) if ppb_bound_pct is not None else None
    )

    inputs["clint_hep_ul_min_1e6"] = take(
        "clint_hep_ul_min_1e6",
        _num(flat.get("Clearance_Hepatocyte_AZ")),
        "µL/min/10⁶ cells",
        "Hakase ADMET Clearance_Hepatocyte_AZ",
    )
    inputs["fu_plasma"] = take("fu_plasma", fu_from_ml, "fraction", "Hakase ADMET PPBR_AZ → fu")
    inputs["vdss_l_per_kg"] = take(
        "vdss_l_per_kg", _num(flat.get("VDss_Lombardo")), "L/kg", "Hakase ADMET VDss_Lombardo"
    )
    inputs["half_life_obach_h"] = take(
        "half_life_obach_h", _num(flat.get("Half_Life_Obach")), "h", "Hakase ADMET Half_Life_Obach"
    )

    # blood:plasma ratio: explicit arg > caller override > curated reference > assumed 1.0.
    ref_bpr = _ref_input("blood_plasma_ratio")
    ref_bpr_val = _num(ref_bpr["value"]) if ref_bpr is not None else None
    caller_bpr = _num(blood_plasma_ratio) or _num(overrides.get("blood_plasma_ratio"))
    r_bp = caller_bpr or ref_bpr_val or DEFAULT_BLOOD_PLASMA_RATIO
    r_bp_prov = "measured" if (caller_bpr or ref_bpr_val) else "assumed"
    r_bp_source = "R_bp"
    if not caller_bpr and ref_bpr_val is not None:
        r_bp_source = ref_bpr["provenance"]

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
            "remediation": "Bring the Hakase ADMET ML stack online (STRICT_ML=1) or supply measured CLint/fu via `overrides`.",
        }

    fu_val = inputs["fu_plasma"].value
    if fu_val is not None and fu_val <= 0:
        # Distinguish the two ways fu can reach zero. PPBR_AZ is an unbounded
        # regression on percent-bound, so for an extreme binder it can predict
        # above 100% — a physically impossible value, not a measurement that the
        # compound is exactly 100% bound. Saying which one happened is the
        # difference between "the model saturated" and "this drug never clears".
        out_of_range = ppb_bound_pct is not None and ppb_bound_pct >= 100.0
        if out_of_range:
            reason = (
                f"The plasma-protein-binding model returned {ppb_bound_pct:.1f}% bound, which is "
                "outside the physically possible 0–100% range, so the derived unbound fraction "
                "clamps to zero. The compound is an extreme binder the model cannot resolve — "
                "fu is unidentified, not zero."
            )
        else:
            reason = (
                "fu resolved to 0 (≈100% protein bound); hepatic clearance is indeterminate "
                "without a measured fu."
            )
        return {
            "source": "insufficient-input",
            "available": False,
            "reason": reason
            + " Hepatic clearance scales with fu, so a zero would make clearance zero and "
            "exposure infinite; the projection is refused rather than reported.",
            "missing": ["fu_plasma (nonzero)"],
            "predicted_ppb_percent": ppb_bound_pct,
            "remediation": (
                "Supply a measured unbound fraction as the `fu_plasma` override. A measured value "
                "takes precedence over the model everywhere downstream, and the result is stamped "
                "'measured (user-supplied)' rather than predicted."
            ),
            "inputs": {k: vars(v) for k, v in inputs.items()},
        }

    try:
        params = compute_ivive(
            clint_hep_ul_min_1e6=inputs["clint_hep_ul_min_1e6"].value,  # type: ignore[arg-type]
            fu_plasma=fu_val,  # type: ignore[arg-type]
            vdss_l_per_kg=inputs["vdss_l_per_kg"].value,
            half_life_obach_h=inputs["half_life_obach_h"].value,
            body_weight_kg=system.body_weight_kg,
            blood_plasma_ratio=r_bp,
            q_h_ml_min_kg=system.q_h_ml_min_kg,
            hpgl_1e6_per_g=system.hpgl_1e6_per_g,
            liver_g_per_kg=system.liver_g_per_kg,
            dose_mg=dose_mg,
        )
    except ValueError as e:
        return {
            "source": "input-error",
            "available": False,
            "reason": str(e),
            "inputs": {k: vars(v) for k, v in inputs.items()},
        }

    # Renal clearance (glomerular filtration only, GFR·fu) and total CL. Added in
    # the wrapper so the pure compute_ivive core is untouched.
    cl_renal_ml_min_kg = compute_renal_clearance(system.gfr_ml_min_kg, fu_val)  # type: ignore[arg-type]
    cl_total_ml_min_kg = params["cl_hepatic_plasma_ml_min_kg"] + cl_renal_ml_min_kg
    params["cl_renal_plasma_ml_min_kg"] = round(cl_renal_ml_min_kg, 4)
    params["cl_total_plasma_ml_min_kg"] = round(cl_total_ml_min_kg, 4)
    params["cl_total_plasma_l_h"] = round(
        cl_total_ml_min_kg * system.body_weight_kg * 60.0 / 1000.0, 4
    )
    params["renal_clearance_note"] = (
        "Renal = glomerular filtration only (CL_renal = fu·GFR); tubular secretion and "
        "reabsorption are not modelled, so this is a lower bound for actively secreted drugs. "
        "Total CL = hepatic (metabolic) + renal (filtration)."
    )

    result: dict[str, Any] = {
        "source": "ivive",
        "available": True,
        "smiles": smiles,
        "species": system.species,
        "strain": system.strain,
        "mw_g_per_mol": _mw_from_smiles(smiles),
        "parameters": params,
        "inputs": {k: vars(v) for k, v in inputs.items()},
        "system_parameters": {
            "species": system.species,
            "strain": system.strain,
            "body_weight_kg": {
                "value": system.body_weight_kg,
                "provenance": "reference",
                "source": f"physiology store ({system.species})",
            },
            "blood_plasma_ratio": {"value": r_bp, "provenance": r_bp_prov, "source": r_bp_source},
            "hepatic_blood_flow_ml_min_kg": {
                "value": system.q_h_ml_min_kg,
                "provenance": "reference",
                "source": f"physiology store ({system.species}); Davies & Morris 1993 / Brown 1997",
            },
            "hepatocellularity_1e6_per_g": {
                "value": system.hpgl_1e6_per_g,
                "provenance": system.hpgl_provenance,
                "source": (
                    "Barter 2007"
                    if system.hpgl_provenance == "reference"
                    else "assumed human (not established for this species)"
                ),
            },
            "liver_weight_g_per_kg": {
                "value": round(system.liver_g_per_kg, 4),
                "provenance": "reference",
                "source": f"physiology store ({system.species}); Brown 1997 / Davies & Morris 1993",
            },
            "gfr_ml_min_kg": {
                "value": system.gfr_ml_min_kg,
                "provenance": "reference",
                "source": f"physiology store ({system.species}); Davies & Morris 1993",
            },
        },
        "admet_ml": admet_meta,
        "model_info": {
            "engine": "Hakase IVIVE (well-stirred liver, Rowland/Wilkinson; Houston scale-up)",
            "method": "Deterministic IVIVE from real Hakase ADMET inputs; no heuristic fallback",
            "references": [
                "Wilkinson & Shand 1975 Clin Pharmacol Ther 18:377",
                "Houston 1994 Biochem Pharmacol 47:1469",
                "Obach 1999 Drug Metab Dispos 27:1350",
                "Davies & Morris 1993 Pharm Res 10:1093",
                "Barter 2007 Curr Drug Metab 8:33",
            ],
        },
    }

    if system.warnings:
        result["system_warnings"] = list(system.warnings)

    # ── Cross-species applicability: human-trained ML CLint/fu are not predictive
    #    outside human. The hepatocyte CLint / PPB models behind provenance "ml"
    #    are human-trained (TDC Clearance_Hepatocyte_AZ, PPBR_AZ). Validation proved
    #    that human-trained hepatocyte CLint is statistically uncorrelated with RAT
    #    clearance (Spearman 0.21, p=0.48; docs/pbpk-s2t5-validation-handoff.md §3.4).
    #    So when a NON-human species is driven by that ML value — i.e. neither a
    #    measured override nor the curated measured reference (Naritomi 2003 / Ito
    #    2004) supplied CLint or fu — attach an explicit low-confidence signal.
    #    Non-breaking: callers that ignore ``confidence`` are unaffected; the same
    #    rationale is also folded into the ``system_warnings`` the result carries.
    result["confidence"] = _cross_species_confidence(system.species, inputs)
    if result["confidence"]["level"] == "low":
        result.setdefault("system_warnings", []).append(result["confidence"]["rationale"])

    # ── Metabolic-clearance applicability guard: the well-stirred IVIVE core is a
    #    HEPATIC METABOLIC model, out of domain for transporter-mediated (OATP
    #    uptake / biliary) clearance. This is a mechanism-specific limitation the
    #    general structural ADMET AD cannot see, so a known transporter substrate
    #    (rosuvastatin, bosentan, troglitazone, …) can look in-domain structurally
    #    yet be out of domain for the metabolic clearance number we compute. When
    #    flagged we surface an explicit out-of-domain-for-metabolic-CL verdict +
    #    rationale rather than returning a confident clearance silently.
    from hakase_smallmol.pk_ivive.metabolic_domain import assess_metabolic_clearance_domain

    metabolic_domain = assess_metabolic_clearance_domain(smiles)
    result["metabolic_clearance_domain"] = metabolic_domain.as_dict()
    if not metabolic_domain.in_domain:
        result.setdefault("system_warnings", []).append(metabolic_domain.rationale)
        conf = result["confidence"]
        conf["level"] = "low"
        conf.setdefault("flags", []).append("out_of_domain_for_metabolic_cl")
        conf["metabolic_clearance_out_of_domain"] = True
        # Preserve any cross-species rationale; append the metabolic one.
        conf["rationale"] = (
            f"{conf['rationale']} {metabolic_domain.rationale}"
            if conf.get("rationale")
            else metabolic_domain.rationale
        )

    # Optional Monte-Carlo uncertainty: sample each ML input from its residual
    # model and report median + interval. The deterministic result above is the
    # point estimate; this only annotates it.
    if montecarlo:
        result["uncertainty"] = montecarlo_ivive(
            clint_hep_ul_min_1e6=inputs["clint_hep_ul_min_1e6"].value,  # type: ignore[arg-type]
            fu_plasma=fu_val,  # type: ignore[arg-type]
            system=system,
            vdss_l_per_kg=inputs["vdss_l_per_kg"].value,
            half_life_obach_h=inputs["half_life_obach_h"].value,
            blood_plasma_ratio=r_bp,
            provenance={k: v.provenance for k, v in inputs.items()},
            residual_models=residual_models,
            n_samples=mc_samples,
            seed=mc_seed,
            coverage=mc_coverage,
        )

    return result


def is_ready() -> dict[str, Any]:
    """IVIVE is pure arithmetic — always ready; its INPUTS depend on Hakase ADMET."""
    return {
        "loaded": True,
        "engine": "Hakase IVIVE",
        "depends_on": "Hakase ADMET (Clearance_Hepatocyte_AZ, PPBR_AZ, VDss_Lombardo)",
    }
