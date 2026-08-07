"""Species/strain physiology store for the PBPK layer (kernel, S1-T2).

A lookup keyed by ``(species, strain, sex, age, body_weight)`` that returns the
system physiology a PBPK model needs: organ volumes, organ blood flows, cardiac
output, GFR and plasma protein — plus a reference to the mammalian tissue-
composition table in :mod:`tissue_composition`.

The store holds one **base row per (species, strain)**. Sex, age and body weight
are *typed modifiers* applied on top of a base row (never new rows):
  * body weight  -> allometric scaling (the dominant, fully-implemented effect);
  * sex / age    -> typed multiplicative modifiers, identity by default until
                    cited, validated factors are attached (documented below).

Human system constants are copied verbatim from the IVIVE engine
(``pk_ivive.py``) so the two agree by construction — this task does **not**
modify ``pk_ivive.py``; it mirrors its constants into the ``human`` row.

Kernel policy: modality-agnostic, pure stdlib — no RDKit, no SMILES, no numpy.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from enum import Enum

from hakase_kernel.pbpk.physiology.reliability import (
    ParameterUncertainty,
    calibrated_uncertainty,
    extrapolated_uncertainty,
)
from hakase_kernel.pbpk.physiology.tissue_composition import (
    TISSUE_COMPOSITION,
    TissueComposition,
)

# Kleiber/West allometric exponent: metabolic/flow quantities scale as BW**0.75,
# so a per-kg flow scales as BW**-0.25 (the exponent used in animal_sim.py).
# Reference: Boxenbaum H. (1982) J Pharmacokinet Biopharm 10:201; West et al.
# (1997) Science 276:122.
ALLOMETRIC_FLOW_EXPONENT = 0.75


class Sex(str, Enum):
    MALE = "male"
    FEMALE = "female"


class AgeClass(str, Enum):
    JUVENILE = "juvenile"
    ADULT = "adult"
    AGED = "aged"


@dataclass(frozen=True)
class PhysiologyModifier:
    """A typed, multiplicative adjustment layered on a base physiology row.

    Every factor defaults to ``1.0`` (no change). ``organ_volume_factors`` is a
    per-organ override. Sex/age biology (e.g. higher body-fat fraction in
    females, immature GFR in juveniles) is real but species- and value-specific;
    those factors are populated from literature as they are validated, so the
    defaults are deliberately identity rather than invented numbers.
    """

    cardiac_output_factor: float = 1.0
    gfr_factor: float = 1.0
    hepatic_blood_flow_factor: float = 1.0
    plasma_albumin_factor: float = 1.0
    organ_volume_factors: Mapping[str, float] = field(default_factory=dict)


# Default modifier tables — identity until cited factors are attached (see the
# PhysiologyModifier docstring). The mechanism is live; the values are honest.
SEX_MODIFIERS: dict[Sex, PhysiologyModifier] = {
    Sex.MALE: PhysiologyModifier(),
    Sex.FEMALE: PhysiologyModifier(),
}
AGE_MODIFIERS: dict[AgeClass, PhysiologyModifier] = {
    AgeClass.JUVENILE: PhysiologyModifier(),
    AgeClass.ADULT: PhysiologyModifier(),
    AgeClass.AGED: PhysiologyModifier(),
}


@dataclass(frozen=True)
class SpeciesPhysiology:
    """Base (reference-body-weight) physiology for one species/strain.

    Organ volumes are fractions of body weight (``L/kg`` with tissue density
    ~1 kg/L); organ blood flows are fractions of cardiac output; cardiac output,
    hepatic blood flow and GFR are per-kg rates at the reference body weight.
    All values carry an inline literature citation.
    """

    species: str
    strain: str
    reference_body_weight_kg: float
    cardiac_output_ml_min_kg: float
    hepatic_blood_flow_ml_min_kg: float
    gfr_ml_min_kg: float
    plasma_albumin_g_l: float
    blood_volume_fraction: float
    hematocrit: float
    organ_volume_fraction: Mapping[str, float]  # fraction of body weight
    organ_blood_flow_fraction: Mapping[str, float]  # fraction of cardiac output
    # Hepatocellularity (HPGL) drives the IVIVE hepatocyte-CLint → whole-liver
    # scale-up. It is species-specific: human 99e6/g (Barter 2007), rat 120e6/g
    # (Houston & Carlile 1997). Populated per-species as IVIVE is validated for
    # that species; None means "not established" and the IVIVE layer falls back
    # to the human value with a low-reliability flag.
    hepatocellularity_1e6_per_g: float | None = None
    # Every species uses the one mammalian-reference composition table (see the
    # cross-species note in tissue_composition.py).
    tissue_composition: Mapping[str, TissueComposition] = field(
        default_factory=lambda: TISSUE_COMPOSITION
    )
    # Free-text citation for data-file-loaded rows; None for the in-code rows,
    # whose sources are the inline comments below.
    source: str | None = None


@dataclass(frozen=True)
class ScaledPhysiology:
    """Physiology resolved for a concrete ``(species, strain, sex, age, bw)``.

    Rates and volumes are **absolute** at the requested body weight: volumes in
    litres, flows and clearances in mL/min.
    """

    species: str
    strain: str
    sex: Sex
    age: AgeClass
    body_weight_kg: float
    cardiac_output_ml_min: float
    hepatic_blood_flow_ml_min: float
    gfr_ml_min: float
    plasma_albumin_g_l: float
    blood_volume_l: float
    plasma_volume_l: float
    organ_volume_l: Mapping[str, float]
    organ_blood_flow_ml_min: Mapping[str, float]
    tissue_composition: Mapping[str, TissueComposition]
    # True when the row was not a calibrated species but built by allometric
    # extrapolation of the generic-mammal anchor (S1-T2b). Calibrated rows: False.
    allometric_extrapolation: bool = False
    # Per-parameter-group assumed uncertainty budget (see reliability.py). Wider
    # for extrapolated rows; metabolic clearance is the least reliable there.
    uncertainty: Mapping[str, ParameterUncertainty] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Species/strain base rows.
#
# Organ volume fractions, blood-flow fractions, cardiac output, hepatic blood
# flow and GFR are the project's accepted physiology, sourced to:
#   Brown R.P. et al. (1997) Toxicol Ind Health 13:407  (organ volumes/flows, CO)
#   Davies B. & Morris T. (1993) Pharm Res 10:1093       (Q_h, GFR, liver weight)
# Blood-volume fractions and hematocrit are Brown 1997 species values. Plasma
# albumin concentrations are Davies & Morris 1993 / ICRP reference ranges.
# Human system constants (Q_h, HPGL, liver weight, BW) are copied verbatim from
# pk_ivive.py (Davies & Morris 1993; Barter Z.E. et al. (2007) Curr Drug Metab
# 8:33 for human HPGL = 99e6 cells/g). Rat HPGL is species-specific — 120e6
# cells/g (Houston J.B. & Carlile D.J. (1997) Drug Metab Rev 29:891), the value
# the rat hepatocyte-CLint benchmark (Naritomi 2003, Ito & Houston 2004) is
# scaled with — so the rat rows carry it rather than borrowing the human value.
# --------------------------------------------------------------------------- #
_SPECIES_ROWS: tuple[SpeciesPhysiology, ...] = (
    SpeciesPhysiology(
        species="human",
        strain="reference",
        reference_body_weight_kg=70.0,  # pk_ivive DEFAULT_BODY_WEIGHT_KG (Davies & Morris 1993)
        cardiac_output_ml_min_kg=71.4,  # ~5.0 L/min / 70 kg          (Davies & Morris 1993 / ICRP)
        hepatic_blood_flow_ml_min_kg=20.7,  # Q_h, pk_ivive constant  (Davies & Morris 1993)
        gfr_ml_min_kg=1.8,  # ~125 mL/min / 70 kg                     (Davies & Morris 1993)
        plasma_albumin_g_l=45.0,  # reference adult plasma albumin    (ICRP / Davies & Morris 1993)
        blood_volume_fraction=0.079,  # fraction of BW                (Brown 1997)
        hematocrit=0.45,  # (Brown 1997)
        # Full Brown R.P. et al. (1997) Toxicol Ind Health 13:407 reference-man
        # organ set. The lung, gut and the peripheral tissues are NOT optional:
        # the lung receives the entire cardiac output, and an oral dose is
        # deposited into the gut compartment, so a row missing either volume
        # traps the dose and returns a null plasma profile. muscle+skin+adipose
        # carry the volume of distribution.
        organ_volume_fraction={
            "liver": 0.0257,  # 25.7 g/kg, pk_ivive LIVER_WEIGHT_G_PER_KG (Davies & Morris 1993)
            "kidney": 0.0044,  # (Brown 1997)
            "heart": 0.0047,  # (Brown 1997)
            "lung": 0.0076,  # (Brown 1997)
            "brain": 0.0200,  # (Brown 1997)
            "muscle": 0.4000,  # (Brown 1997)
            "adipose": 0.2142,  # (Brown 1997 reference man)
            "skin": 0.0371,  # (Brown 1997)
            "gut": 0.0171,  # GI tract tissue (Brown 1997)
            "spleen": 0.0026,  # (Brown 1997)
        },
        organ_blood_flow_fraction={
            "liver": 0.227,  # total hepatic (arterial + portal) fraction of CO (Brown 1997)
            "kidney": 0.190,  # (Brown 1997)
            "heart": 0.040,  # (Brown 1997)
            "brain": 0.114,  # (Brown 1997)
            "muscle": 0.170,  # (Brown 1997)
            "adipose": 0.050,  # (Brown 1997)
            "skin": 0.050,  # (Brown 1997)
            # gut + spleen are the portal inflow and are subtracted from the
            # total hepatic flow to give the hepatic artery: 0.227 − 0.162 =
            # 0.065, which is Brown's reported human hepatic-artery fraction.
            "gut": 0.146,  # portal drainage to liver (Brown 1997)
            "spleen": 0.016,  # portal drainage to liver (Brown 1997)
        },
        hepatocellularity_1e6_per_g=99.0,  # HPGL, pk_ivive HEPATOCELLULARITY (Barter 2007)
    ),
    SpeciesPhysiology(
        species="rat",
        strain="sprague_dawley",
        reference_body_weight_kg=0.300,  # (Davies & Morris 1993)
        cardiac_output_ml_min_kg=360.0,  # (Brown 1997)
        hepatic_blood_flow_ml_min_kg=70.0,  # (Davies & Morris 1993)
        gfr_ml_min_kg=5.5,  # (Davies & Morris 1993)
        plasma_albumin_g_l=34.0,  # rat plasma albumin (Davies & Morris 1993)
        blood_volume_fraction=0.074,  # (Brown 1997)
        hematocrit=0.46,  # (Brown 1997)
        # Organ fractions from Brown R.P. et al. (1997) Toxicol Ind Health 13:407,
        # "Physiological Parameter Values for PBPK Models" — rat reference tables.
        # muscle+skin dominate the volume of distribution; without them the
        # 13-compartment model collapses to liver/kidney/heart + "rest" and cannot
        # reproduce observed Vss. gut & spleen drain to the liver (portal).
        organ_volume_fraction={
            "liver": 0.0366,  # (Brown 1997)
            "kidney": 0.0073,  # (Brown 1997)
            "heart": 0.0033,  # (Brown 1997)
            "lung": 0.0050,  # (Brown 1997)
            "brain": 0.0057,  # (Brown 1997)
            "muscle": 0.4040,  # (Brown 1997)
            "adipose": 0.0700,  # (Brown 1997)
            "skin": 0.1900,  # (Brown 1997)
            "gut": 0.0270,  # GI tract tissue (Brown 1997)
            "spleen": 0.0020,  # (Brown 1997)
        },
        organ_blood_flow_fraction={
            "liver": 0.174,  # total hepatic = arterial + portal (Brown 1997)
            "kidney": 0.141,  # (Brown 1997)
            "heart": 0.060,  # (Brown 1997)
            "brain": 0.020,  # (Brown 1997)
            "muscle": 0.278,  # (Brown 1997)
            "adipose": 0.070,  # (Brown 1997)
            "skin": 0.058,  # (Brown 1997)
            "gut": 0.131,  # portal drainage to liver (Brown 1997)
            "spleen": 0.020,  # portal drainage to liver (Brown 1997)
        },
        # Rat HPGL 120e6 cells/g liver — the standard rat hepatocellularity
        # (Houston & Carlile 1997, Drug Metab Rev 29:891), used by the rat
        # hepatocyte-CLint sources this layer is validated against (Naritomi 2003
        # PMID 12695346; Ito & Houston 2004 PMID 15180335). Established for rat, so
        # the IVIVE scale-up no longer borrows the human 99e6/g. With the Brown
        # 1997 rat liver weight (36.6 g/kg) the combined scale-up factor is
        # 120·36.6/1000 = 4.39 mL·min⁻¹·kg⁻¹ per µL·min⁻¹·(10⁶ cells)⁻¹, matching
        # the ~4.8 the Naritomi benchmark deconvolves with (120e6/g × 40 g/kg;
        # the residual is the liver-weight source difference, Brown 36.6 vs
        # Davies & Morris 40). See docs/pbpk-s2t5-validation-handoff.md.
        hepatocellularity_1e6_per_g=120.0,  # rat HPGL (Houston & Carlile 1997)
    ),
    SpeciesPhysiology(
        species="rat",
        strain="wistar",
        reference_body_weight_kg=0.280,  # (Davies & Morris 1993)
        cardiac_output_ml_min_kg=350.0,  # (Brown 1997)
        hepatic_blood_flow_ml_min_kg=68.0,  # (Davies & Morris 1993)
        gfr_ml_min_kg=5.3,  # (Davies & Morris 1993)
        plasma_albumin_g_l=34.0,  # (Davies & Morris 1993)
        blood_volume_fraction=0.074,  # (Brown 1997)
        hematocrit=0.46,  # (Brown 1997)
        # Same Brown 1997 rat reference tables as the Sprague-Dawley row — Brown
        # publishes one rat organ set, and the strain difference is carried by
        # the body weight and the per-kg rates above, not by organ fractions.
        organ_volume_fraction={
            "liver": 0.0366,  # (Brown 1997)
            "kidney": 0.0073,  # (Brown 1997)
            "heart": 0.0033,  # (Brown 1997)
            "lung": 0.0050,  # (Brown 1997)
            "brain": 0.0057,  # (Brown 1997)
            "muscle": 0.4040,  # (Brown 1997)
            "adipose": 0.0700,  # (Brown 1997)
            "skin": 0.1900,  # (Brown 1997)
            "gut": 0.0270,  # GI tract tissue (Brown 1997)
            "spleen": 0.0020,  # (Brown 1997)
        },
        organ_blood_flow_fraction={
            "liver": 0.174,  # total hepatic = arterial + portal (Brown 1997)
            "kidney": 0.141,  # (Brown 1997)
            "heart": 0.060,  # (Brown 1997)
            "brain": 0.020,  # (Brown 1997)
            "muscle": 0.278,  # (Brown 1997)
            "adipose": 0.070,  # (Brown 1997)
            "skin": 0.058,  # (Brown 1997)
            "gut": 0.131,  # portal drainage to liver (Brown 1997)
            "spleen": 0.020,  # portal drainage to liver (Brown 1997)
        },
        hepatocellularity_1e6_per_g=120.0,  # rat HPGL (Houston & Carlile 1997); see sprague_dawley
    ),
    SpeciesPhysiology(
        species="mouse",
        strain="cd1",
        reference_body_weight_kg=0.025,  # (Davies & Morris 1993)
        cardiac_output_ml_min_kg=500.0,  # (Brown 1997)
        hepatic_blood_flow_ml_min_kg=90.0,  # (Brown 1997)
        gfr_ml_min_kg=5.2,  # (Davies & Morris 1993)
        plasma_albumin_g_l=30.0,  # mouse plasma albumin (Davies & Morris 1993)
        blood_volume_fraction=0.049,  # (Brown 1997)
        hematocrit=0.45,  # (Brown 1997)
        # Full Brown 1997 mouse organ set. The total-hepatic flow fraction is
        # raised from the hepatic-artery-only value to Brown's total (0.161),
        # because the portal inflow (gut + spleen) is now modelled explicitly
        # and the ODE derives the hepatic artery as total minus portal.
        organ_volume_fraction={
            "liver": 0.0550,  # (Brown 1997)
            "kidney": 0.0167,  # (Brown 1997)
            "heart": 0.0050,  # (Brown 1997)
            "lung": 0.0073,  # (Brown 1997)
            "brain": 0.0165,  # (Brown 1997)
            "muscle": 0.3840,  # (Brown 1997)
            "adipose": 0.0700,  # (Brown 1997)
            "skin": 0.1653,  # (Brown 1997)
            "gut": 0.0422,  # GI tract tissue (Brown 1997)
            "spleen": 0.0035,  # (Brown 1997)
        },
        organ_blood_flow_fraction={
            "liver": 0.161,  # total hepatic = arterial + portal (Brown 1997)
            "kidney": 0.091,  # (Brown 1997)
            "heart": 0.066,  # (Brown 1997)
            "brain": 0.033,  # (Brown 1997)
            "muscle": 0.159,  # (Brown 1997)
            "adipose": 0.070,  # (Brown 1997)
            "skin": 0.058,  # (Brown 1997)
            "gut": 0.130,  # portal drainage to liver (Brown 1997)
            "spleen": 0.011,  # portal drainage to liver (Brown 1997)
        },
    ),
    SpeciesPhysiology(
        species="mouse",
        strain="c57bl6",
        reference_body_weight_kg=0.022,  # (Davies & Morris 1993)
        cardiac_output_ml_min_kg=480.0,  # (Brown 1997)
        hepatic_blood_flow_ml_min_kg=85.0,  # (Brown 1997)
        gfr_ml_min_kg=5.0,  # (Davies & Morris 1993)
        plasma_albumin_g_l=30.0,  # (Davies & Morris 1993)
        blood_volume_fraction=0.049,  # (Brown 1997)
        hematocrit=0.45,  # (Brown 1997)
        # Full Brown 1997 mouse organ set. The total-hepatic flow fraction is
        # raised from the hepatic-artery-only value to Brown's total (0.161),
        # because the portal inflow (gut + spleen) is now modelled explicitly
        # and the ODE derives the hepatic artery as total minus portal.
        organ_volume_fraction={
            "liver": 0.0550,  # (Brown 1997)
            "kidney": 0.0167,  # (Brown 1997)
            "heart": 0.0050,  # (Brown 1997)
            "lung": 0.0073,  # (Brown 1997)
            "brain": 0.0165,  # (Brown 1997)
            "muscle": 0.3840,  # (Brown 1997)
            "adipose": 0.0700,  # (Brown 1997)
            "skin": 0.1653,  # (Brown 1997)
            "gut": 0.0422,  # GI tract tissue (Brown 1997)
            "spleen": 0.0035,  # (Brown 1997)
        },
        organ_blood_flow_fraction={
            "liver": 0.161,  # total hepatic = arterial + portal (Brown 1997)
            "kidney": 0.091,  # (Brown 1997)
            "heart": 0.066,  # (Brown 1997)
            "brain": 0.033,  # (Brown 1997)
            "muscle": 0.159,  # (Brown 1997)
            "adipose": 0.070,  # (Brown 1997)
            "skin": 0.058,  # (Brown 1997)
            "gut": 0.130,  # portal drainage to liver (Brown 1997)
            "spleen": 0.011,  # portal drainage to liver (Brown 1997)
        },
    ),
    SpeciesPhysiology(
        species="dog",
        strain="beagle",
        reference_body_weight_kg=10.0,  # (Davies & Morris 1993)
        cardiac_output_ml_min_kg=118.0,  # (Brown 1997)
        hepatic_blood_flow_ml_min_kg=31.0,  # (Davies & Morris 1993)
        gfr_ml_min_kg=3.2,  # (Davies & Morris 1993)
        plasma_albumin_g_l=30.0,  # dog plasma albumin (Davies & Morris 1993)
        blood_volume_fraction=0.085,  # (Brown 1997)
        hematocrit=0.45,  # (Brown 1997)
        # Full Brown 1997 beagle organ set. Portal inflow (gut + spleen = 0.262)
        # sits inside the total hepatic flow, leaving a 0.046 hepatic-artery
        # fraction, which is Brown's reported dog value.
        organ_volume_fraction={
            "liver": 0.0328,  # (Brown 1997)
            "kidney": 0.0041,  # (Brown 1997)
            "heart": 0.0080,  # (Brown 1997)
            "lung": 0.0090,  # (Brown 1997)
            "brain": 0.0080,  # (Brown 1997)
            "muscle": 0.5404,  # (Brown 1997)
            "adipose": 0.1500,  # (Brown 1997)
            "skin": 0.0900,  # (Brown 1997)
            "gut": 0.0370,  # GI tract tissue (Brown 1997)
            "spleen": 0.0030,  # (Brown 1997)
        },
        organ_blood_flow_fraction={
            "liver": 0.308,  # total hepatic = arterial + portal (Brown 1997)
            "kidney": 0.173,  # (Brown 1997)
            "heart": 0.050,  # (Brown 1997)
            "brain": 0.020,  # (Brown 1997)
            "muscle": 0.216,  # (Brown 1997)
            "adipose": 0.035,  # (Brown 1997)
            "skin": 0.060,  # (Brown 1997)
            "gut": 0.216,  # portal drainage to liver (Brown 1997)
            "spleen": 0.046,  # portal drainage to liver (Brown 1997)
        },
    ),
    SpeciesPhysiology(
        species="monkey",
        strain="cynomolgus",
        reference_body_weight_kg=4.0,  # (Davies & Morris 1993)
        cardiac_output_ml_min_kg=145.0,  # (Brown 1997)
        hepatic_blood_flow_ml_min_kg=44.0,  # (Davies & Morris 1993)
        gfr_ml_min_kg=2.8,  # (Davies & Morris 1993)
        plasma_albumin_g_l=40.0,  # cynomolgus plasma albumin (Davies & Morris 1993)
        blood_volume_fraction=0.055,  # (Brown 1997)
        hematocrit=0.42,  # (Brown 1997)
        # Full Brown 1997 cynomolgus organ set; portal inflow (gut + spleen)
        # sits inside the total hepatic flow.
        organ_volume_fraction={
            "liver": 0.0300,  # (Brown 1997)
            "kidney": 0.0040,  # (Brown 1997)
            "heart": 0.0050,  # (Brown 1997)
            "lung": 0.0080,  # (Brown 1997)
            "brain": 0.0100,  # (Brown 1997)
            "muscle": 0.4500,  # (Brown 1997)
            "adipose": 0.0500,  # (Brown 1997)
            "skin": 0.1000,  # (Brown 1997)
            "gut": 0.0500,  # GI tract tissue (Brown 1997)
            "spleen": 0.0025,  # (Brown 1997)
        },
        organ_blood_flow_fraction={
            "liver": 0.184,  # total hepatic = arterial + portal (Brown 1997)
            "kidney": 0.097,  # (Brown 1997)
            "heart": 0.050,  # (Brown 1997)
            "brain": 0.120,  # (Brown 1997)
            "muscle": 0.180,  # (Brown 1997)
            "adipose": 0.030,  # (Brown 1997)
            "skin": 0.060,  # (Brown 1997)
            "gut": 0.150,  # portal drainage to liver (Brown 1997)
            "spleen": 0.020,  # portal drainage to liver (Brown 1997)
        },
    ),
)

# Registry keyed by (species, strain), both lower-case.
SPECIES_PHYSIOLOGY: dict[tuple[str, str], SpeciesPhysiology] = {
    (row.species, row.strain): row for row in _SPECIES_ROWS
}

# The strain returned when a caller names a species but no strain.
DEFAULT_STRAIN: dict[str, str] = {
    "human": "reference",
    "rat": "sprague_dawley",
    "mouse": "cd1",
    "dog": "beagle",
    "monkey": "cynomolgus",
}


# --------------------------------------------------------------------------- #
# Generic-mammal anchor for allometric extrapolation (S1-T2b).
#
# Used ONLY for species with no calibrated row and no data-file entry. It is a
# 1-kg mammalian consensus: the per-kg cardiac output / hepatic blood flow / GFR
# are the calibrated set normalised to 1 kg via BW**0.75 allometry (e.g. the rat
# and human rows both scale to ~250 mL/min/kg CO, ~55 mL/min/kg Q_h and
# ~4-5 mL/min/kg GFR at 1 kg), and the organ volume / blood-flow fractions are
# conserved mammalian consensus values within the Brown 1997 across-species
# ranges. A row built from this anchor is ALWAYS flagged
# allometric_extrapolation=True and carries the inflated uncertainty budget.
# --------------------------------------------------------------------------- #
GENERIC_MAMMAL: SpeciesPhysiology = SpeciesPhysiology(
    species="generic_mammal",
    strain="generic",
    reference_body_weight_kg=1.0,  # anchor weight for the per-kg rates below
    cardiac_output_ml_min_kg=250.0,  # calibrated set scaled to 1 kg (Brown 1997 allometry)
    hepatic_blood_flow_ml_min_kg=55.0,  # calibrated set scaled to 1 kg
    gfr_ml_min_kg=4.5,  # calibrated set scaled to 1 kg
    plasma_albumin_g_l=35.0,  # mammalian consensus (Davies & Morris 1993 range)
    blood_volume_fraction=0.070,  # mammalian consensus (Brown 1997 range)
    hematocrit=0.44,  # mammalian consensus (Brown 1997 range)
    organ_volume_fraction={
        "liver": 0.026,  # conserved mammalian fraction (Brown 1997 range)
        "kidney": 0.007,  # conserved mammalian fraction (Brown 1997 range)
        "heart": 0.005,  # conserved mammalian fraction (Brown 1997 range)
        "lung": 0.008,  # conserved mammalian fraction (Brown 1997 range)
        "brain": 0.008,  # conserved mammalian fraction (Brown 1997 range)
        "muscle": 0.400,  # conserved mammalian fraction (Brown 1997 range)
        "adipose": 0.100,  # conserved mammalian fraction (Brown 1997 range)
        "skin": 0.100,  # conserved mammalian fraction (Brown 1997 range)
        "gut": 0.030,  # conserved mammalian fraction (Brown 1997 range)
        "spleen": 0.003,  # conserved mammalian fraction (Brown 1997 range)
    },
    organ_blood_flow_fraction={
        "liver": 0.25,  # total hepatic, conserved mammalian fraction (Brown 1997 range)
        "kidney": 0.15,  # conserved mammalian fraction of CO (Brown 1997 range)
        "heart": 0.05,  # conserved mammalian fraction of CO (Brown 1997 range)
        "brain": 0.05,  # conserved mammalian fraction of CO (Brown 1997 range)
        "muscle": 0.20,  # conserved mammalian fraction of CO (Brown 1997 range)
        "adipose": 0.05,  # conserved mammalian fraction of CO (Brown 1997 range)
        "skin": 0.055,  # conserved mammalian fraction of CO (Brown 1997 range)
        "gut": 0.150,  # portal drainage to liver (Brown 1997 range)
        "spleen": 0.020,  # portal drainage to liver (Brown 1997 range)
    },
    hepatocellularity_1e6_per_g=None,  # unknown for an uncalibrated species
)


def _combine(
    base: SpeciesPhysiology, *mods: PhysiologyModifier
) -> tuple[float, float, float, float, dict[str, float]]:
    """Compose the multiplicative sex/age modifiers onto the base per-kg rates."""
    co = base.cardiac_output_ml_min_kg
    hbf = base.hepatic_blood_flow_ml_min_kg
    gfr = base.gfr_ml_min_kg
    alb = base.plasma_albumin_g_l
    vol_factor: dict[str, float] = {organ: 1.0 for organ in base.organ_volume_fraction}
    for mod in mods:
        co *= mod.cardiac_output_factor
        hbf *= mod.hepatic_blood_flow_factor
        gfr *= mod.gfr_factor
        alb *= mod.plasma_albumin_factor
        for organ, f in mod.organ_volume_factors.items():
            vol_factor[organ] = vol_factor.get(organ, 1.0) * f
    return co, hbf, gfr, alb, vol_factor


def _scale(
    base: SpeciesPhysiology,
    sex: Sex,
    age: AgeClass,
    body_weight_kg: float | None,
    *,
    allometric_extrapolation: bool,
    uncertainty: Mapping[str, ParameterUncertainty],
) -> ScaledPhysiology:
    """Scale a base row to a concrete body weight, applying sex/age modifiers.

    Pure arithmetic shared by the calibrated and extrapolated paths — identical
    to the S1-T2 scaling so calibrated species are numerically unchanged.
    """
    bw = base.reference_body_weight_kg if body_weight_kg is None else float(body_weight_kg)
    if not (bw > 0):
        raise ValueError(f"body_weight_kg must be > 0, got {bw}")

    co_kg, hbf_kg, gfr_kg, alb, vol_factor = _combine(base, SEX_MODIFIERS[sex], AGE_MODIFIERS[age])

    # Allometric scaling: absolute flow at BW = (per-kg rate at ref) * BW_ref *
    # (BW / BW_ref)**0.75. Volumes scale linearly with BW.
    bw_ref = base.reference_body_weight_kg
    flow_scale = bw_ref * (bw / bw_ref) ** ALLOMETRIC_FLOW_EXPONENT  # kg-equivalent for flows
    cardiac_output = co_kg * flow_scale
    hepatic_blood_flow = hbf_kg * flow_scale
    gfr = gfr_kg * flow_scale

    organ_volume_l = {
        organ: frac * bw * vol_factor.get(organ, 1.0)
        for organ, frac in base.organ_volume_fraction.items()
    }
    organ_blood_flow = {
        organ: frac * cardiac_output for organ, frac in base.organ_blood_flow_fraction.items()
    }
    blood_volume_l = base.blood_volume_fraction * bw
    plasma_volume_l = blood_volume_l * (1.0 - base.hematocrit)

    return ScaledPhysiology(
        species=base.species,
        strain=base.strain,
        sex=sex,
        age=age,
        body_weight_kg=bw,
        cardiac_output_ml_min=cardiac_output,
        hepatic_blood_flow_ml_min=hepatic_blood_flow,
        gfr_ml_min=gfr,
        plasma_albumin_g_l=alb,
        blood_volume_l=blood_volume_l,
        plasma_volume_l=plasma_volume_l,
        organ_volume_l=organ_volume_l,
        organ_blood_flow_ml_min=organ_blood_flow,
        tissue_composition=base.tissue_composition,
        allometric_extrapolation=allometric_extrapolation,
        uncertainty=uncertainty,
    )


def get_physiology(
    species: str,
    strain: str | None = None,
    sex: Sex = Sex.MALE,
    age: AgeClass = AgeClass.ADULT,
    body_weight_kg: float | None = None,
) -> ScaledPhysiology:
    """Resolve physiology for ``(species, strain, sex, age, body_weight)``.

    Resolution order:
      1. **Calibrated / data-file row** — an exact ``(species, strain)`` match in
         :data:`SPECIES_PHYSIOLOGY`. Behaves exactly as in S1-T2:
         ``allometric_extrapolation=False`` and the baseline uncertainty budget.
      2. **Allometric extrapolation** — an *unknown species* with a supplied
         ``body_weight_kg`` is built from :data:`GENERIC_MAMMAL`, flagged
         ``allometric_extrapolation=True`` and given the inflated uncertainty
         budget (metabolic clearance least reliable). Requires a body weight —
         there is no reference weight to fall back on.

    A known species with an *unknown strain* raises ``KeyError`` (a likely typo,
    not an extrapolation target). An unknown species with no ``body_weight_kg``
    raises ``ValueError``. No silent fallback.
    """
    sp = species.strip().lower()
    st = (strain or DEFAULT_STRAIN.get(sp) or "").strip().lower()

    base = SPECIES_PHYSIOLOGY.get((sp, st))
    if base is not None:
        return _scale(
            base,
            sex,
            age,
            body_weight_kg,
            allometric_extrapolation=False,
            uncertainty=calibrated_uncertainty(is_human=base.species == "human"),
        )

    # No exact match. If the *species* is known, the strain is the problem.
    if sp in DEFAULT_STRAIN:
        raise KeyError(
            f"unknown strain {strain!r} for known species {species!r}; "
            f"known: {sorted(k for k in SPECIES_PHYSIOLOGY if k[0] == sp)}"
        )

    # Unknown species -> allometric extrapolation, which needs a body weight.
    if body_weight_kg is None:
        raise ValueError(
            f"unknown species {species!r}: pass body_weight_kg to allometrically "
            f"extrapolate a generic-mammal row (calibrated species: "
            f"{sorted(DEFAULT_STRAIN)})"
        )
    anchor = replace(GENERIC_MAMMAL, species=sp, strain=(st or "generic"))
    return _scale(
        anchor,
        sex,
        age,
        body_weight_kg,
        allometric_extrapolation=True,
        uncertainty=extrapolated_uncertainty(),
    )


__all__ = [
    "ALLOMETRIC_FLOW_EXPONENT",
    "Sex",
    "AgeClass",
    "PhysiologyModifier",
    "SEX_MODIFIERS",
    "AGE_MODIFIERS",
    "SpeciesPhysiology",
    "ScaledPhysiology",
    "SPECIES_PHYSIOLOGY",
    "DEFAULT_STRAIN",
    "GENERIC_MAMMAL",
    "get_physiology",
]
