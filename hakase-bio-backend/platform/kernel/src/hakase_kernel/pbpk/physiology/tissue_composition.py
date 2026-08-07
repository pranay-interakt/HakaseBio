"""Per-organ tissue-composition tables for the Rodgers & Rowland Kp model.

These are the tissue-side inputs the mechanistic Rodgers & Rowland partition-
coefficient equations (small-molecule modality, S1-T3) consume: for each organ,
the fractional volumes of extracellular water, intracellular water, neutral
lipid and neutral phospholipid, the acidic-phospholipid content, the
intracellular pH, and the tissue:plasma albumin / lipoprotein ratios.

Provenance of the numbers
-------------------------
* Fractional water / neutral-lipid / neutral-phospholipid volumes and the
  albumin / lipoprotein ratios are the *standardised* Rodgers & Rowland rat
  tissue composition as tabulated by Utsey et al. (the widely reused
  "standardised tissue composition" set), which consolidates:
    - Rodgers, Leahy & Rowland (2005) J Pharm Sci 94:1259  (moderate-to-strong bases)
    - Rodgers & Rowland      (2006) J Pharm Sci 95:1238  (acids, weak bases, neutrals, zwitterions)
    - Utsey K. et al.        (2020) Drug Metab Dispos 48:903  (standardised composition)
* Acidic-phospholipid concentrations ``[AP]`` (mg per g tissue) and the
  intracellular pH are the canonical Rodgers, Leahy & Rowland (2005) rat values.
* Plasma reference constants (plasma pH, red-cell intracellular pH, plasma
  neutral-lipid / neutral-phospholipid fractions) are from the same R&R papers.

Cross-species note (honest scope): tissue *composition* (water / lipid /
phospholipid fractions, [AP], pH) is treated as conserved across mammals — the
standard Rodgers & Rowland practice, since species-specific composition tables
do not exist for mouse / dog / monkey. What differs between species and *is*
species-resolved lives in ``store.py`` (organ volumes, blood flows, cardiac
output, GFR, plasma protein). Every species therefore references this one
mammalian-reference composition table; only the volumes/flows are per-species.

Kernel policy: modality-agnostic, pure stdlib — no RDKit, no SMILES.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TissueComposition:
    """Rodgers & Rowland composition of one organ.

    Fractions are volume fractions of the whole tissue (dimensionless, in
    ``[0, 1]``); ``acidic_phospholipid_mg_g`` is a concentration (mg per g
    tissue); ``ph_intracellular`` is the intracellular-water pH.
    """

    tissue: str
    f_extracellular_water: float  # fEW
    f_intracellular_water: float  # fIW
    f_neutral_lipid: float  # fNL
    f_neutral_phospholipid: float  # fNP
    acidic_phospholipid_mg_g: float  # [AP], mg / g tissue
    ph_intracellular: float  # pH_IW
    albumin_ratio: float  # tissue:plasma albumin ratio  (R&R, acids)
    lipoprotein_ratio: float  # tissue:plasma lipoprotein ratio  (R&R)

    def __post_init__(self) -> None:
        for name in (
            "f_extracellular_water",
            "f_intracellular_water",
            "f_neutral_lipid",
            "f_neutral_phospholipid",
        ):
            v = getattr(self, name)
            if not (0.0 <= v <= 1.0):
                raise ValueError(f"{self.tissue}.{name} must be a fraction in [0, 1], got {v}")
        if self.acidic_phospholipid_mg_g < 0.0:
            raise ValueError(f"{self.tissue}.acidic_phospholipid_mg_g must be >= 0")
        if not (6.0 <= self.ph_intracellular <= 8.0):
            raise ValueError(
                f"{self.tissue}.ph_intracellular {self.ph_intracellular} not physiological"
            )


# --------------------------------------------------------------------------- #
# Plasma / blood reference constants (Rodgers & Rowland 2005/2006).
# --------------------------------------------------------------------------- #
PLASMA_PH = 7.4  # pH_p — plasma water pH                    (R&R 2005/2006)
RED_CELL_INTRACELLULAR_PH = 7.22  # pH of red-blood-cell water        (R&R 2005/2006)
PLASMA_F_NEUTRAL_LIPID = 0.0023  # fNL,p — plasma neutral-lipid fraction     (R&R 2005/2006)
PLASMA_F_NEUTRAL_PHOSPHOLIPID = 0.0013  # fNP,p — plasma neutral-phospholipid frac  (R&R 2005/2006)


# --------------------------------------------------------------------------- #
# Mammalian-reference organ composition (standardised R&R rat set).
# Column values, per organ:
#   fEW, fIW, fNL, fNP  — Utsey 2020 standardised R&R composition (Table III).
#   [AP] mg/g, pH_IW    — Rodgers, Leahy & Rowland 2005 rat values; pH_IW = 7.0.
#   albumin / lipoprotein ratios — Utsey 2020 standardised R&R composition.
# Adipose fNL is the neutral-lipid value (0.853); the tiny 0.0016 is fNP (the
# two lipid columns are transposed in some reproductions — verified here by the
# fractions summing to ~1 only when fNL dominates).
# --------------------------------------------------------------------------- #
_PH_IW = 7.0  # intracellular-water pH, all tissues (R&R 2005)

TISSUE_COMPOSITION: dict[str, TissueComposition] = {
    #                          fEW,    fIW,    fNL,    fNP,    [AP],  pH,     alb,   lipo
    "adipose": TissueComposition(
        "adipose", 0.135, 0.017, 0.853, 0.0016, 0.40, _PH_IW, 0.049, 0.068
    ),
    "bone": TissueComposition("bone", 0.100, 0.346, 0.0174, 0.0016, 0.67, _PH_IW, 0.100, 0.050),
    "brain": TissueComposition("brain", 0.162, 0.620, 0.0391, 0.0015, 0.40, _PH_IW, 0.048, 0.041),
    "gut": TissueComposition("gut", 0.282, 0.475, 0.0375, 0.0124, 2.41, _PH_IW, 0.158, 0.141),
    "heart": TissueComposition("heart", 0.320, 0.456, 0.0135, 0.0106, 2.25, _PH_IW, 0.157, 0.160),
    "kidney": TissueComposition("kidney", 0.273, 0.483, 0.0121, 0.0240, 5.03, _PH_IW, 0.130, 0.137),
    "liver": TissueComposition("liver", 0.161, 0.573, 0.0135, 0.0238, 4.56, _PH_IW, 0.086, 0.161),
    "lung": TissueComposition("lung", 0.336, 0.446, 0.0215, 0.0123, 3.91, _PH_IW, 0.212, 0.168),
    "muscle": TissueComposition("muscle", 0.118, 0.630, 0.0100, 0.0072, 1.53, _PH_IW, 0.064, 0.059),
    "pancreas": TissueComposition(
        "pancreas", 0.120, 0.664, 0.0403, 0.0090, 1.67, _PH_IW, 0.060, 0.060
    ),
    "skin": TissueComposition("skin", 0.382, 0.291, 0.0603, 0.0044, 1.32, _PH_IW, 0.277, 0.096),
    "spleen": TissueComposition("spleen", 0.207, 0.579, 0.0071, 0.0107, 3.18, _PH_IW, 0.097, 0.207),
}


def get_tissue_composition(organ: str) -> TissueComposition:
    """Return the mammalian-reference composition for ``organ`` (case-insensitive).

    Raises ``KeyError`` with the list of known organs rather than guessing — the
    project-wide no-fallback policy.
    """
    key = organ.strip().lower()
    try:
        return TISSUE_COMPOSITION[key]
    except KeyError:
        raise KeyError(
            f"no tissue composition for organ {organ!r}; known organs: "
            f"{sorted(TISSUE_COMPOSITION)}"
        ) from None


__all__ = [
    "TissueComposition",
    "TISSUE_COMPOSITION",
    "get_tissue_composition",
    "PLASMA_PH",
    "RED_CELL_INTRACELLULAR_PH",
    "PLASMA_F_NEUTRAL_LIPID",
    "PLASMA_F_NEUTRAL_PHOSPHOLIPID",
]
