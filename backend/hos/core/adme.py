"""ADME / DMPK computations: in vitro depletion through to hepatic clearance.

The chain implemented here is the standard in vitro-in vivo extrapolation (IVIVE)
route described by Obach (1999), using the well-stirred liver model of Wilkinson
and Shand (1975):

1. fit first-order substrate depletion -> elimination rate constant k, half-life
2. k + microsomal protein concentration -> apparent intrinsic clearance CLint,app
3. optional correction for non-specific microsomal binding (fu,mic)
4. scale by microsomal protein per gram liver and liver weight -> CLint,in vivo
5. well-stirred model with hepatic blood flow and blood unbound fraction -> CLh
6. CLh / Qh -> hepatic extraction ratio, and predicted hepatic availability

Every step returns a provenance-carrying :class:`Quantity`. Physiological scalars
come from the cited reference-parameter registry, never from literals here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional, Sequence

import numpy as np
import scipy
from scipy import stats

from hos.core.methods import method
from hos.core.provenance import ApplicabilityCheck, Uncertainty
from hos.core.qc import QCFinding, QCStatus, QCVerdict
from hos.core.quantity import MeasurementSeries, Quantity, QuantityError
from hos.core.reference_params import ReferenceParameterSet

__all__ = [
    "DepletionFit",
    "IVIVEResult",
    "fit_depletion",
    "clint_in_vitro",
    "fu_mic_hallifax_houston",
    "scale_clint_to_liver",
    "fu_blood_from_plasma",
    "hepatic_clearance_well_stirred",
    "extraction_ratio",
    "classify_extraction",
    "ivive_from_depletion",
]

_SOFTWARE = {"numpy": np.__version__, "scipy": scipy.__version__}

#: Minimum regression quality for a depletion fit to be reported without a warning.
DEFAULT_MIN_R2 = 0.90
#: Minimum total substrate depletion (%) for the rate constant to be well determined.
DEFAULT_MIN_DEPLETION_PCT = 20.0


@dataclass(frozen=True, slots=True)
class DepletionFit:
    """Result of fitting first-order substrate depletion."""

    k: Quantity
    half_life: Quantity
    r_squared: float
    n_points: int
    depletion_percent: float
    intercept_fraction: float
    qc: QCVerdict

    def to_dict(self) -> dict[str, Any]:
        return {
            "k": self.k.to_dict(),
            "half_life": self.half_life.to_dict(),
            "r_squared": self.r_squared,
            "n_points": self.n_points,
            "depletion_percent": self.depletion_percent,
            "intercept_fraction": self.intercept_fraction,
            "qc": self.qc.to_dict(),
        }


def fit_depletion(
    series: MeasurementSeries,
    *,
    min_r2: float = DEFAULT_MIN_R2,
    min_depletion_pct: float = DEFAULT_MIN_DEPLETION_PCT,
) -> DepletionFit:
    """Fit ln(fraction remaining) against time by linear regression.

    ``series.x`` is time, ``series.y`` is the amount of parent remaining, either as
    a percentage (``y_unit='percent'``) or as a fraction (``dimensionless``) or as a
    concentration; only the *relative* decline matters, so any concentration unit is
    accepted and normalised to the first point.

    The elimination rate constant ``k`` is the negative slope; the half-life is
    ``ln(2)/k`` (Obach 1999).
    """
    t = np.asarray(series.x, dtype=float)
    y = np.asarray(series.y, dtype=float)

    if np.any(y <= 0):
        raise QuantityError("depletion series contains non-positive responses; cannot take log")
    order = np.argsort(t)
    t, y = t[order], y[order]

    y_rel = y / y[0]
    ln_y = np.log(y_rel)
    reg = stats.linregress(t, ln_y)
    slope = float(reg.slope)
    r2 = float(reg.rvalue**2)

    findings: list[QCFinding] = []
    if slope >= 0:
        findings.append(
            QCFinding(
                code="no_depletion",
                status=QCStatus.FAIL,
                message="parent did not decline over the incubation; no rate constant estimable",
                observed=slope,
            )
        )
    k_val = -slope
    depletion_pct = float((1.0 - y_rel[-1]) * 100.0)

    if r2 < min_r2:
        findings.append(
            QCFinding(
                code="poor_depletion_fit",
                status=QCStatus.WARN,
                message="ln-linear regression quality below threshold; "
                        "the first-order assumption may not hold over this range",
                observed=round(r2, 4),
                threshold=min_r2,
            )
        )
    if depletion_pct < min_depletion_pct:
        findings.append(
            QCFinding(
                code="insufficient_depletion",
                status=QCStatus.WARN,
                message="total depletion is low, so the rate constant is poorly determined; "
                        "the compound should be reported as below the assay's resolving power",
                observed=round(depletion_pct, 1),
                threshold=min_depletion_pct,
            )
        )
    if series.n < 3:
        findings.append(
            QCFinding(
                code="too_few_timepoints",
                status=QCStatus.WARN,
                message="fewer than three timepoints; slope uncertainty is not meaningful",
                observed=series.n,
                threshold=3,
            )
        )

    qc = QCVerdict.of(findings)
    if not qc.passed:
        unavailable_reason = "; ".join(f.message for f in findings if f.status is QCStatus.FAIL)
        k_q = Quantity.unavailable("1/min", reason=unavailable_reason, label="Elimination rate constant")
        t_half_q = Quantity.unavailable("min", reason=unavailable_reason, label="In vitro half-life")
        return DepletionFit(
            k=k_q, half_life=t_half_q, r_squared=r2, n_points=series.n,
            depletion_percent=depletion_pct, intercept_fraction=float(math.exp(reg.intercept)),
            qc=qc,
        )

    k_se = float(reg.stderr) if reg.stderr is not None else None
    k_q = Quantity.computed(
        k_val, "1/min",
        method=method("adme.depletion_fit"),
        software=_SOFTWARE,
        uncertainty=Uncertainty(kind="sd", sd=k_se, n=series.n) if k_se else None,
        label="Elimination rate constant",
        qc_flags=qc.flags,
        notes=f"ln-linear regression over {series.n} timepoints, R^2={r2:.4f}",
    )
    t_half = math.log(2.0) / k_val
    t_half_q = Quantity.computed(
        t_half, "min",
        method=method("adme.depletion_fit"),
        inputs=[k_q],
        software=_SOFTWARE,
        label="In vitro half-life",
        qc_flags=qc.flags,
    )
    return DepletionFit(
        k=k_q,
        half_life=t_half_q,
        r_squared=r2,
        n_points=series.n,
        depletion_percent=depletion_pct,
        intercept_fraction=float(math.exp(reg.intercept)),
        qc=qc,
    )


def clint_in_vitro(fit: DepletionFit, protein_concentration: Quantity) -> Quantity:
    """Apparent intrinsic clearance per mg microsomal protein.

    ``CLint,app (uL/min/mg) = k (1/min) / C_protein (mg/uL)``

    which is the in-vitro half-life method of Obach (1999); equivalently
    ``(0.693 / t_half) x (incubation volume / mg protein)``.
    """
    if not fit.k.is_available:
        return Quantity.unavailable(
            "uL/min/mg",
            reason=f"no rate constant: {fit.k.provenance.reason}",
            label="CLint,app",
        )
    k = fit.k.magnitude_in("1/min")
    c_prot = protein_concentration.magnitude_in("mg/mL")
    if c_prot <= 0:
        raise QuantityError("microsomal protein concentration must be positive")
    clint = k * 1000.0 / c_prot  # (1/min) / (mg/uL) -> uL/min/mg
    return Quantity.computed(
        clint, "uL/min/mg",
        method=method("adme.clint_invitro"),
        inputs=[fit.k, protein_concentration],
        software=_SOFTWARE,
        label="CLint,app (apparent in vitro intrinsic clearance)",
        qc_flags=fit.qc.flags,
    )


#: Hallifax & Houston (2006) regression coefficients for log((1-fu)/fu) vs logP/D.
_HH_A, _HH_B, _HH_C = 0.072, 0.067, -1.126
#: Lipophilicity range spanned by the Hallifax-Houston training set.
_HH_DOMAIN = (-2.0, 7.0)


def fu_mic_hallifax_houston(
    lipophilicity: Quantity,
    protein_concentration: Quantity,
) -> Quantity:
    """Predicted unbound fraction in a microsomal incubation.

    ``fu,mic = 1 / (1 + C * 10^(0.072*X^2 + 0.067*X - 1.126))``

    where ``X`` is logP (bases) or logD7.4 (acids and neutrals) and ``C`` is the
    microsomal protein concentration in mg/mL (Hallifax & Houston 2006).

    This is a **prediction**, not a measurement: the returned quantity carries
    ``PREDICTED`` provenance and an applicability-domain check against the
    lipophilicity range of the model's training set.
    """
    x = lipophilicity.require()
    c = protein_concentration.magnitude_in("mg/mL")
    if c <= 0:
        raise QuantityError("microsomal protein concentration must be positive")

    lo, hi = _HH_DOMAIN
    in_domain = lo <= x <= hi
    applicability = ApplicabilityCheck(
        in_domain=in_domain,
        descriptor_ranges_checked=("logP/logD",),
        reason=None if in_domain else (
            f"lipophilicity {x:.2f} is outside the model's fitted range "
            f"[{lo}, {hi}]; the predicted binding is an extrapolation"
        ),
        distance_metric="logP distance outside fitted range",
        distance_value=0.0 if in_domain else float(min(abs(x - lo), abs(x - hi))),
    )
    ratio = c * (10.0 ** (_HH_A * x * x + _HH_B * x + _HH_C))
    fu = 1.0 / (1.0 + ratio)
    return Quantity.predicted(
        fu, "dimensionless",
        method=method("adme.fu_mic_predicted"),
        applicability=applicability,
        inputs=[lipophilicity, protein_concentration],
        software=_SOFTWARE,
        label="fu,mic (predicted microsomal unbound fraction)",
    )


def scale_clint_to_liver(
    clint_app: Quantity,
    species: str,
    *,
    params: Optional[ReferenceParameterSet] = None,
    fu_mic: Optional[Quantity] = None,
) -> Quantity:
    """Scale apparent in vitro CLint to whole-liver intrinsic clearance.

    ``CLint,in vivo (mL/min/kg) = CLint,app (uL/min/mg) * MPPGL (mg/g) * liver weight (g/kg) / 1000``

    When ``fu_mic`` is supplied the apparent clearance is first divided by it, as
    only the unbound fraction in the incubation is available to the enzyme
    (Obach 1999).
    """
    params = params or ReferenceParameterSet()
    if not clint_app.is_available:
        return Quantity.unavailable(
            "mL/min/kg", reason=f"no in vitro CLint: {clint_app.provenance.reason}",
            label="CLint,in vivo",
        )
    mppgl = params.for_species("mppgl", species)
    liver_wt = params.for_species("liver_weight", species)

    clint = clint_app.magnitude_in("uL/min/mg")
    inputs = [clint_app, mppgl, liver_wt]
    flags = list(clint_app.qc_flags) + list(mppgl.qc_flags) + list(liver_wt.qc_flags)

    if fu_mic is not None and fu_mic.is_available:
        fu = fu_mic.require()
        if not (0.0 < fu <= 1.0):
            raise QuantityError(f"fu,mic must lie in (0, 1], got {fu}")
        clint = clint / fu
        inputs.append(fu_mic)
        flags.extend(fu_mic.qc_flags)

    scaled = clint * mppgl.magnitude_in("mg/g") * liver_wt.magnitude_in("g/kg") / 1000.0
    return Quantity.computed(
        scaled, "mL/min/kg",
        method=method("adme.clint_invivo"),
        inputs=inputs,
        software=_SOFTWARE,
        parameter_set_version=params.version,
        label=f"CLint,in vivo ({species})",
        qc_flags=dict.fromkeys(flags),
        notes=("corrected for microsomal binding" if fu_mic is not None and fu_mic.is_available
               else "uncorrected for microsomal binding"),
    )


def fu_blood_from_plasma(fu_plasma: Quantity, blood_plasma_ratio: Quantity) -> Quantity:
    """``fu,blood = fu,plasma / (blood:plasma ratio)`` (Obach 1999)."""
    if not fu_plasma.is_available or not blood_plasma_ratio.is_available:
        missing = fu_plasma if not fu_plasma.is_available else blood_plasma_ratio
        return Quantity.unavailable(
            "dimensionless",
            reason=f"cannot derive fu,blood: {missing.provenance.reason}",
            label="fu,blood",
        )
    rb = blood_plasma_ratio.require()
    if rb <= 0:
        raise QuantityError("blood:plasma ratio must be positive")
    fub = fu_plasma.require() / rb
    flags = []
    if fub > 1.0:
        flags.append("fu_blood_exceeds_unity")
    return Quantity.computed(
        fub, "dimensionless",
        method=method("adme.fu_blood"),
        inputs=[fu_plasma, blood_plasma_ratio],
        software=_SOFTWARE,
        label="fu,blood",
        qc_flags=flags,
    )


def hepatic_clearance_well_stirred(
    clint_in_vivo: Quantity,
    fu_blood: Quantity,
    species: str,
    *,
    params: Optional[ReferenceParameterSet] = None,
) -> Quantity:
    """Hepatic blood clearance by the well-stirred model.

    ``CLh = (Qh * fu,b * CLint) / (Qh + fu,b * CLint)``  (Wilkinson & Shand 1975)
    """
    params = params or ReferenceParameterSet()
    if not clint_in_vivo.is_available or not fu_blood.is_available:
        missing = clint_in_vivo if not clint_in_vivo.is_available else fu_blood
        return Quantity.unavailable(
            "mL/min/kg",
            reason=f"cannot compute hepatic clearance: {missing.provenance.reason}",
            label="CLh",
        )
    qh_q = params.for_species("qh", species)
    qh = qh_q.magnitude_in("mL/min/kg")
    clint = clint_in_vivo.magnitude_in("mL/min/kg")
    fub = fu_blood.require()

    clh = (qh * fub * clint) / (qh + fub * clint)
    flags = list(clint_in_vivo.qc_flags) + list(fu_blood.qc_flags) + list(qh_q.qc_flags)
    return Quantity.computed(
        clh, "mL/min/kg",
        method=method("adme.clh_well_stirred"),
        inputs=[clint_in_vivo, fu_blood, qh_q],
        software=_SOFTWARE,
        parameter_set_version=params.version,
        label=f"CLh, predicted hepatic blood clearance ({species})",
        qc_flags=dict.fromkeys(flags),
    )


def extraction_ratio(
    clh: Quantity,
    species: str,
    *,
    params: Optional[ReferenceParameterSet] = None,
) -> Quantity:
    """Hepatic extraction ratio ``E = CLh / Qh`` (Wilkinson & Shand 1975)."""
    params = params or ReferenceParameterSet()
    if not clh.is_available:
        return Quantity.unavailable(
            "dimensionless", reason=f"no hepatic clearance: {clh.provenance.reason}",
            label="Eh",
        )
    qh_q = params.for_species("qh", species)
    e = clh.magnitude_in("mL/min/kg") / qh_q.magnitude_in("mL/min/kg")
    return Quantity.computed(
        e, "dimensionless",
        method=method("adme.extraction_ratio"),
        inputs=[clh, qh_q],
        software=_SOFTWARE,
        parameter_set_version=params.version,
        label=f"Eh, hepatic extraction ratio ({species})",
        qc_flags=clh.qc_flags,
    )


def classify_extraction(e: Quantity) -> str:
    """Conventional low/intermediate/high banding of the extraction ratio.

    The <0.3 / 0.3-0.7 / >0.7 bands are the long-standing convention in hepatic
    clearance analysis (Wilkinson & Shand 1975 and subsequent usage). This is a
    descriptive label, not a regulatory classification.
    """
    if not e.is_available:
        return "undetermined"
    v = e.require()
    if v < 0.3:
        return "low"
    if v <= 0.7:
        return "intermediate"
    return "high"


@dataclass(frozen=True, slots=True)
class IVIVEResult:
    """The complete in vitro to in vivo extrapolation chain for one compound."""

    species: str
    fit: DepletionFit
    clint_app: Quantity
    fu_mic: Optional[Quantity]
    clint_in_vivo: Quantity
    fu_blood: Quantity
    clh: Quantity
    extraction_ratio: Quantity
    extraction_class: str
    hepatic_availability: Quantity
    qc: QCVerdict

    def to_dict(self) -> dict[str, Any]:
        return {
            "species": self.species,
            "fit": self.fit.to_dict(),
            "clint_app": self.clint_app.to_dict(),
            "fu_mic": self.fu_mic.to_dict() if self.fu_mic else None,
            "clint_in_vivo": self.clint_in_vivo.to_dict(),
            "fu_blood": self.fu_blood.to_dict(),
            "clh": self.clh.to_dict(),
            "extraction_ratio": self.extraction_ratio.to_dict(),
            "extraction_class": self.extraction_class,
            "hepatic_availability": self.hepatic_availability.to_dict(),
            "qc": self.qc.to_dict(),
        }


def ivive_from_depletion(
    series: MeasurementSeries,
    *,
    species: str,
    protein_concentration: Quantity,
    fu_plasma: Quantity,
    blood_plasma_ratio: Quantity,
    lipophilicity_for_fu_mic: Optional[Quantity] = None,
    params: Optional[ReferenceParameterSet] = None,
) -> IVIVEResult:
    """Run the full IVIVE chain from a raw depletion series.

    Supplying ``lipophilicity_for_fu_mic`` enables the Hallifax-Houston microsomal
    binding correction; omitting it leaves the clearance uncorrected, which is
    recorded in the provenance notes rather than assumed away.
    """
    params = params or ReferenceParameterSet()
    fit = fit_depletion(series)
    clint_app = clint_in_vitro(fit, protein_concentration)

    fu_mic = None
    if lipophilicity_for_fu_mic is not None:
        fu_mic = fu_mic_hallifax_houston(lipophilicity_for_fu_mic, protein_concentration)

    clint_iv = scale_clint_to_liver(clint_app, species, params=params, fu_mic=fu_mic)
    fub = fu_blood_from_plasma(fu_plasma, blood_plasma_ratio)
    clh = hepatic_clearance_well_stirred(clint_iv, fub, species, params=params)
    e = extraction_ratio(clh, species, params=params)

    if e.is_available:
        fh = Quantity.computed(
            1.0 - e.require(), "dimensionless",
            method=method("adme.extraction_ratio"),
            inputs=[e],
            software=_SOFTWARE,
            parameter_set_version=params.version,
            label="Fh, predicted hepatic availability",
            qc_flags=e.qc_flags,
            notes="hepatic first pass only; gut-wall extraction not included",
        )
    else:
        fh = Quantity.unavailable(
            "dimensionless", reason=e.provenance.reason or "extraction ratio unavailable",
            label="Fh, predicted hepatic availability",
        )

    return IVIVEResult(
        species=species,
        fit=fit,
        clint_app=clint_app,
        fu_mic=fu_mic,
        clint_in_vivo=clint_iv,
        fu_blood=fub,
        clh=clh,
        extraction_ratio=e,
        extraction_class=classify_extraction(e),
        hepatic_availability=fh,
        qc=fit.qc,
    )
