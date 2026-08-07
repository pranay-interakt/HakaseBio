"""Rodgers & Rowland tissue:plasma partition coefficients (Kp) per organ — S1-T3.

Mechanistic Kp from the kernel tissue-composition tables (S1-T2) and the pKa /
ionisation output of :mod:`pka` (S1-T3a). This replaces the ``pk_ivive`` logP
heuristic Kp with the Rodgers & Rowland mechanistic model.

Method (Rodgers, Leahy & Rowland 2005 J Pharm Sci 94:1259 for moderate-to-strong
bases; Rodgers & Rowland 2006 J Pharm Sci 95:1238 for acids / neutrals / weak
bases / zwitterions). Predicts the tissue-to-**unbound**-plasma-water partition
coefficient ``Kpu``; the reported ``Kp`` (tissue:plasma, total) is ``Kpu·fu``.

For every tissue, contributions to ``Kpu`` are (only the *neutral* species
crosses membranes and partitions into lipid; the ionised species is confined by
pH and, for bases, binds acidic phospholipids electrostatically):

  Kpu = fEW
      + (Riw / Rp) · fIW                              (water, pH-partitioned)
      + (P·fNL + (0.3P+0.7)·fNP) / Rp                 (neutral lipid + phospholipid)
      + { base:    Ka·[AP]·(Riw − 1) / Rp             (acidic-phospholipid binding)
        { acid/neu:(1/fu − 1 − Plasma_lipid/Rp)·Rpr   (albumin or lipoprotein binding)

where ``R(pH) = Π_sites (1 + 10^(±(pKa − pH)))`` is the total:neutral ratio
(``+`` for a base site, ``−`` for an acid site), ``P = 10^logP`` (octanol:water;
vegetable-oil:water for adipose), ``Rp``/``Riw`` are ``R`` at plasma pH 7.4 and
tissue intracellular pH, and ``Ka·[AP]`` is the acidic-phospholipid association,
back-calculated from the measured blood:plasma ratio via the red-blood-cell
equation. ``Rpr`` is the tissue:plasma albumin ratio (acids/zwitterions) or
lipoprotein ratio (neutrals/weak bases).

Units: all fractions dimensionless; ``[AP]`` in mg/g (blood-cell and tissue
values share units so ``Ka`` cancels consistently); ``P``, ``R``, ``Kpu`` and
``Kp`` dimensionless.

Modality file — RDKit-derived logP and the pKa module are allowed here; nothing
kernel-forbidden is imported.
"""

from __future__ import annotations

from dataclasses import dataclass

from hakase_kernel.pbpk.physiology.tissue_composition import (
    PLASMA_F_NEUTRAL_LIPID,
    PLASMA_F_NEUTRAL_PHOSPHOLIPID,
    PLASMA_PH,
    RED_CELL_INTRACELLULAR_PH,
    TISSUE_COMPOSITION,
    TissueComposition,
    get_tissue_composition,
)
from hakase_smallmol.pk_ivive.pka import PkaResult, SiteType

# --------------------------------------------------------------------------- #
# Red-blood-cell composition (Rodgers, Leahy & Rowland 2005) — used to
# back-calculate the acidic-phospholipid association constant Ka from the
# measured blood:plasma ratio. [AP] shares units (mg/g) with the tissue tables.
# --------------------------------------------------------------------------- #
RBC_F_INTRACELLULAR_WATER = 0.603  # blood-cell water fraction (R&R 2005)
RBC_F_NEUTRAL_LIPID = 0.0017  # (R&R 2005)
RBC_F_NEUTRAL_PHOSPHOLIPID = 0.0029  # (R&R 2005)
RBC_ACIDIC_PHOSPHOLIPID_MG_G = 0.5  # [AP] of blood cells, mg/g (R&R 2005)
DEFAULT_HEMATOCRIT = 0.45  # rat/human reference (R&R 2005; Brown 1997)

# A basic pKa at or above this uses the base (acidic-phospholipid) equation; an
# acidic pKa at or below it is treated as an albumin-binding acid. This is the
# Rodgers & Rowland base-pKa ~7 cutoff.
BASE_PKA_CUTOFF = 7.0
ACID_PKA_CUTOFF = 7.0


class KpError(ValueError):
    """Invalid input to the Kp calculation."""


def _phospholipid_partition(p: float) -> float:
    """Neutral-phospholipid:water partition from octanol:water P (R&R: 0.3P+0.7)."""
    return 0.3 * p + 0.7


def _adipose_partition(logp: float) -> float:
    """Vegetable-oil:water partition for adipose (R&R: log Pvow = 1.115·logP − 1.35)."""
    return 10.0 ** (1.115 * logp - 1.35)


def total_to_neutral_ratio(result: PkaResult, ph: float) -> float:
    """``R(pH) = Π_sites (1 + 10^(±(pKa − pH)))`` — total:neutral concentration ratio.

    Independent-site product (exact for mono/polyprotic when sites are treated
    independently). ``+`` exponent for a base site, ``−`` for an acid site.
    """
    r = 1.0
    for s in result.sites:
        if s.site_type is SiteType.BASE:
            r *= 1.0 + 10.0 ** (s.pka - ph)
        else:
            r *= 1.0 + 10.0 ** (ph - s.pka)
    return r


@dataclass(frozen=True)
class Regime:
    """Which R&R sub-model applies, and the plasma-protein it binds."""

    kind: str  # "base" | "acid" | "neutral"
    protein: str  # "acidic_phospholipid" | "albumin" | "lipoprotein"


def classify_regime(result: PkaResult) -> Regime:
    """Pick the R&R sub-model from the ionisation sites (base-pKa ~7 cutoff)."""
    strong_base = any(
        s.site_type is SiteType.BASE and s.pka >= BASE_PKA_CUTOFF for s in result.sites
    )
    if strong_base:
        return Regime("base", "acidic_phospholipid")
    ionised_acid = any(
        s.site_type is SiteType.ACID and s.pka <= ACID_PKA_CUTOFF for s in result.sites
    )
    if ionised_acid:
        return Regime("acid", "albumin")
    return Regime("neutral", "lipoprotein")


@dataclass(frozen=True)
class KpResult:
    """Per-organ Kp (tissue:plasma, total) and Kpu (tissue:unbound-plasma-water)."""

    kp: dict[str, float]
    kpu: dict[str, float]
    regime: Regime
    ka_acidic_phospholipid: float | None  # only for the base regime
    logp: float
    fu_plasma: float
    blood_plasma_ratio: float

    def as_dict(self) -> dict[str, float]:
        """Convenience: the primary output, Kp per organ."""
        return dict(self.kp)


def _fit_ka_acidic_phospholipid(
    p_oct: float,
    result: PkaResult,
    fu_plasma: float,
    blood_plasma_ratio: float,
    hematocrit: float,
) -> float:
    """Back-calculate the acidic-phospholipid association ``Ka`` from blood:plasma.

    Rearranges the red-blood-cell R&R equation for the (positively charged) drug:
        Kpu_BC = (Rbc/Rp)·fIW_BC + (P·fNL_BC + (0.3P+0.7)·fNP_BC)/Rp
                 + Ka·[AP]_BC·(Rbc − 1)/Rp
    with the blood-cell:unbound-plasma-water partition obtained from the data as
        Kpu_BC = (BP − (1 − Hct)) / (Hct · fu).
    """
    rp = total_to_neutral_ratio(result, PLASMA_PH)
    rbc = total_to_neutral_ratio(result, RED_CELL_INTRACELLULAR_PH)
    if rbc <= 1.0:
        return 0.0  # no ionised (cationic) species in the cell -> no AP binding
    kpu_bc = (blood_plasma_ratio - (1.0 - hematocrit)) / (hematocrit * fu_plasma)
    lipid_bc = (
        p_oct * RBC_F_NEUTRAL_LIPID + _phospholipid_partition(p_oct) * RBC_F_NEUTRAL_PHOSPHOLIPID
    )
    ka_ap_bc = (kpu_bc * rp - rbc * RBC_F_INTRACELLULAR_WATER - lipid_bc) / (rbc - 1.0)
    ka = ka_ap_bc / RBC_ACIDIC_PHOSPHOLIPID_MG_G
    return max(ka, 0.0)  # a negative fit means no measurable AP binding


def _kpu_base(comp: TissueComposition, p: float, rp: float, riw: float, ka: float) -> float:
    lipid = p * comp.f_neutral_lipid + _phospholipid_partition(p) * comp.f_neutral_phospholipid
    ap = ka * comp.acidic_phospholipid_mg_g * (riw - 1.0)
    return comp.f_extracellular_water + (riw / rp) * comp.f_intracellular_water + (lipid + ap) / rp


def _kpu_protein(
    comp: TissueComposition, p: float, rp: float, riw: float, fu_plasma: float, protein_ratio: float
) -> float:
    lipid = p * comp.f_neutral_lipid + _phospholipid_partition(p) * comp.f_neutral_phospholipid
    plasma_lipid = (
        p * PLASMA_F_NEUTRAL_LIPID + _phospholipid_partition(p) * PLASMA_F_NEUTRAL_PHOSPHOLIPID
    )
    protein_term = (1.0 / fu_plasma - 1.0 - plasma_lipid / rp) * protein_ratio
    return (
        comp.f_extracellular_water
        + (riw / rp) * comp.f_intracellular_water
        + lipid / rp
        + protein_term
    )


def compute_kp(
    logp: float,
    pka_result: PkaResult,
    fu_plasma: float,
    blood_plasma_ratio: float,
    *,
    organs: list[str] | None = None,
    hematocrit: float = DEFAULT_HEMATOCRIT,
    adipose_vegetable_oil: bool = True,
) -> KpResult:
    """Rodgers & Rowland Kp per organ for the full compartment set.

    ``pka_result`` is the :class:`pka.PkaResult` (per-site pKa + ionisation
    class); ``logp`` is the octanol:water logP (RDKit); ``fu_plasma`` the
    fraction unbound in plasma; ``blood_plasma_ratio`` the whole-blood:plasma
    ratio. ``organs`` defaults to every tissue in the kernel composition table.
    """
    if not (0.0 < fu_plasma <= 1.0):
        raise KpError(f"fu_plasma must be in (0, 1], got {fu_plasma}")
    if blood_plasma_ratio <= 0.0:
        raise KpError(f"blood_plasma_ratio must be > 0, got {blood_plasma_ratio}")
    if not (0.0 < hematocrit < 1.0):
        raise KpError(f"hematocrit must be in (0, 1), got {hematocrit}")

    p_oct = 10.0**logp
    regime = classify_regime(pka_result)
    rp = total_to_neutral_ratio(pka_result, PLASMA_PH)

    ka: float | None = None
    if regime.kind == "base":
        ka = _fit_ka_acidic_phospholipid(
            p_oct, pka_result, fu_plasma, blood_plasma_ratio, hematocrit
        )

    organ_names = organs if organs is not None else list(TISSUE_COMPOSITION)
    kpu: dict[str, float] = {}
    for organ in organ_names:
        comp = get_tissue_composition(organ)
        p = _adipose_partition(logp) if (organ == "adipose" and adipose_vegetable_oil) else p_oct
        riw = total_to_neutral_ratio(pka_result, comp.ph_intracellular)
        if regime.kind == "base":
            value = _kpu_base(comp, p, rp, riw, ka or 0.0)
        else:
            ratio = comp.albumin_ratio if regime.protein == "albumin" else comp.lipoprotein_ratio
            value = _kpu_protein(comp, p, rp, riw, fu_plasma, ratio)
        kpu[organ] = value

    kp = {organ: value * fu_plasma for organ, value in kpu.items()}
    return KpResult(
        kp=kp,
        kpu=kpu,
        regime=regime,
        ka_acidic_phospholipid=ka,
        logp=logp,
        fu_plasma=fu_plasma,
        blood_plasma_ratio=blood_plasma_ratio,
    )


__all__ = [
    "KpError",
    "KpResult",
    "Regime",
    "classify_regime",
    "total_to_neutral_ratio",
    "compute_kp",
    "RBC_F_INTRACELLULAR_WATER",
    "RBC_F_NEUTRAL_LIPID",
    "RBC_F_NEUTRAL_PHOSPHOLIPID",
    "RBC_ACIDIC_PHOSPHOLIPID_MG_G",
    "DEFAULT_HEMATOCRIT",
    "BASE_PKA_CUTOFF",
    "ACID_PKA_CUTOFF",
]
