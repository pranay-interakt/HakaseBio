"""Versioned registry of cited physiological and regulatory reference parameters.

Physiological constants (hepatic blood flow, microsomal protein per gram liver,
body-surface-area K_m factors, ...) are **data with provenance**, not literals
buried in code. A computation pulls them by id and records the registry version
it used, so that changing a constant creates a new registry version and never
silently alters a result that was already produced.

Entries flagged ``requires_verification`` are values in common industry use that
this project has not yet traced to a primary source it can quote verbatim. They
are usable for exploratory work but are surfaced with a warning and MUST be
confirmed against the primary literature before supporting a regulatory claim.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Iterator, Optional

from hos.core.citations import cite
from hos.core.quantity import Quantity

__all__ = [
    "ReferenceParameter",
    "ReferenceParameterSet",
    "REFERENCE_PARAMETERS",
    "REGISTRY_VERSION",
    "get_parameter",
    "get_quantity",
]

REGISTRY_VERSION: Final[str] = "2026.10.1"


@dataclass(frozen=True, slots=True)
class ReferenceParameter:
    """A single cited constant."""

    id: str
    value: float
    unit: str
    description: str
    citation_key: str
    species: Optional[str] = None
    requires_verification: bool = False
    note: Optional[str] = None

    def as_quantity(self, registry_version: str = REGISTRY_VERSION) -> Quantity:
        flags: list[str] = []
        if self.requires_verification:
            flags.append("reference_value_requires_verification")
        q = Quantity.guideline(
            self.value,
            self.unit,
            citation=cite(self.citation_key),
            source_record_id=self.id,
            parameter_set_version=registry_version,
            label=self.description,
            notes=self.note,
        )
        return q.with_flags(*flags) if flags else q


def _p(
    id: str,
    value: float,
    unit: str,
    description: str,
    citation_key: str,
    species: Optional[str] = None,
    requires_verification: bool = False,
    note: Optional[str] = None,
) -> tuple[str, ReferenceParameter]:
    return id, ReferenceParameter(
        id=id,
        value=value,
        unit=unit,
        description=description,
        citation_key=citation_key,
        species=species,
        requires_verification=requires_verification,
        note=note,
    )


# --------------------------------------------------------------------------
# Hepatic blood flow (Davies & Morris 1993, Table I)
# --------------------------------------------------------------------------
_HEPATIC_BLOOD_FLOW = [
    _p("qh.human", 20.7, "mL/min/kg", "Hepatic blood flow (human)", "davies1993", "human"),
    _p("qh.rat", 55.2, "mL/min/kg", "Hepatic blood flow (rat)", "davies1993", "rat"),
    _p("qh.mouse", 131.0, "mL/min/kg", "Hepatic blood flow (mouse)", "davies1993", "mouse"),
    _p("qh.dog", 30.9, "mL/min/kg", "Hepatic blood flow (dog)", "davies1993", "dog"),
    _p("qh.monkey", 43.6, "mL/min/kg", "Hepatic blood flow (rhesus monkey)",
       "davies1993", "monkey"),
    _p("qh.rabbit", 177.0, "mL/min/kg", "Hepatic blood flow (rabbit)", "davies1993", "rabbit"),
]

# --------------------------------------------------------------------------
# Liver weight per kg body weight
# --------------------------------------------------------------------------
_LIVER_WEIGHT = [
    _p("liver_weight.human", 21.4, "g/kg", "Liver weight per kg body weight (human)",
       "barter2007", "human",
       note="Consensus IVIVE scaling value from Barter 2007. Davies & Morris 1993 reports "
            "~25.7 g/kg from gross anatomy; the Barter value is the one recommended for "
            "in vitro-in vivo extrapolation."),
    _p("liver_weight.human.anatomical", 25.7, "g/kg",
       "Liver weight per kg body weight (human, anatomical)", "davies1993", "human"),
    _p("liver_weight.rat", 36.6, "g/kg", "Liver weight per kg body weight (rat)",
       "davies1993", "rat"),
    _p("liver_weight.mouse", 55.0, "g/kg", "Liver weight per kg body weight (mouse)",
       "davies1993", "mouse"),
    _p("liver_weight.dog", 32.0, "g/kg", "Liver weight per kg body weight (dog)",
       "davies1993", "dog"),
    _p("liver_weight.monkey", 30.0, "g/kg", "Liver weight per kg body weight (monkey)",
       "davies1993", "monkey"),
]

# --------------------------------------------------------------------------
# Microsomal protein per gram liver (MPPGL)
# --------------------------------------------------------------------------
_MPPGL = [
    _p("mppgl.human", 40.0, "mg/g", "Microsomal protein per gram liver (human)",
       "barter2007", "human",
       note="Weighted mean recommended by the Barter 2007 consensus analysis."),
    _p("mppgl.rat", 45.0, "mg/g", "Microsomal protein per gram liver (rat)",
       "houston1994", "rat"),
    _p("mppgl.mouse", 45.0, "mg/g", "Microsomal protein per gram liver (mouse)",
       "houston1994", "mouse", requires_verification=True,
       note="Commonly used industry value; confirm against a primary mouse determination "
            "before use in a regulatory submission."),
    _p("mppgl.dog", 45.0, "mg/g", "Microsomal protein per gram liver (dog)",
       "houston1994", "dog", requires_verification=True,
       note="Commonly used industry value; confirm against a primary dog determination."),
    _p("mppgl.monkey", 45.0, "mg/g", "Microsomal protein per gram liver (monkey)",
       "houston1994", "monkey", requires_verification=True,
       note="Commonly used industry value; confirm against a primary NHP determination."),
]

# --------------------------------------------------------------------------
# FDA body-surface-area conversion factors K_m  (FDA 2005 MRSD guidance, Table 1)
# K_m = body weight (kg) / body surface area (m^2)
# --------------------------------------------------------------------------
_KM_FACTORS = [
    _p("km.human", 37.0, "dimensionless", "BSA conversion factor Km (human, 60 kg)",
       "fda_mrsd_2005", "human"),
    _p("km.mouse", 3.0, "dimensionless", "BSA conversion factor Km (mouse)",
       "fda_mrsd_2005", "mouse"),
    _p("km.hamster", 5.0, "dimensionless", "BSA conversion factor Km (hamster)",
       "fda_mrsd_2005", "hamster"),
    _p("km.rat", 6.0, "dimensionless", "BSA conversion factor Km (rat)",
       "fda_mrsd_2005", "rat"),
    _p("km.ferret", 7.0, "dimensionless", "BSA conversion factor Km (ferret)",
       "fda_mrsd_2005", "ferret"),
    _p("km.guinea_pig", 8.0, "dimensionless", "BSA conversion factor Km (guinea pig)",
       "fda_mrsd_2005", "guinea_pig"),
    _p("km.rabbit", 12.0, "dimensionless", "BSA conversion factor Km (rabbit)",
       "fda_mrsd_2005", "rabbit"),
    _p("km.dog", 20.0, "dimensionless", "BSA conversion factor Km (dog)",
       "fda_mrsd_2005", "dog"),
    _p("km.monkey", 12.0, "dimensionless", "BSA conversion factor Km (monkey)",
       "fda_mrsd_2005", "monkey"),
    _p("km.marmoset", 6.0, "dimensionless", "BSA conversion factor Km (marmoset)",
       "fda_mrsd_2005", "marmoset"),
    _p("km.baboon", 20.0, "dimensionless", "BSA conversion factor Km (baboon)",
       "fda_mrsd_2005", "baboon"),
    _p("km.micropig", 27.0, "dimensionless", "BSA conversion factor Km (micropig)",
       "fda_mrsd_2005", "micropig"),
    _p("km.minipig", 35.0, "dimensionless", "BSA conversion factor Km (minipig)",
       "fda_mrsd_2005", "minipig"),
]

# --------------------------------------------------------------------------
# Reference body weights used by the FDA MRSD guidance
# --------------------------------------------------------------------------
_BODY_WEIGHTS = [
    _p("bw.human", 60.0, "kg", "Reference body weight (human, FDA MRSD)",
       "fda_mrsd_2005", "human"),
    _p("bw.mouse", 0.020, "kg", "Reference body weight (mouse)", "fda_mrsd_2005", "mouse"),
    _p("bw.rat", 0.150, "kg", "Reference body weight (rat)", "fda_mrsd_2005", "rat"),
    _p("bw.rabbit", 1.8, "kg", "Reference body weight (rabbit)", "fda_mrsd_2005", "rabbit"),
    _p("bw.dog", 10.0, "kg", "Reference body weight (dog)", "fda_mrsd_2005", "dog"),
    _p("bw.monkey", 3.0, "kg", "Reference body weight (monkey)", "fda_mrsd_2005", "monkey"),
    _p("bw.minipig", 20.0, "kg", "Reference body weight (minipig)", "fda_mrsd_2005", "minipig"),
]

# --------------------------------------------------------------------------
# Default MRSD safety factor (FDA 2005)
# --------------------------------------------------------------------------
_SAFETY = [
    _p("mrsd.default_safety_factor", 10.0, "dimensionless",
       "Default safety factor applied to the HED to obtain the MRSD",
       "fda_mrsd_2005",
       note="FDA 2005 section 5: a factor of 10 is the default; it is increased when "
            "the dose-response is steep, toxicity is irreversible or unmonitorable, the "
            "target is novel, or PK is non-linear."),
]


REFERENCE_PARAMETERS: Final[dict[str, ReferenceParameter]] = dict(
    _HEPATIC_BLOOD_FLOW + _LIVER_WEIGHT + _MPPGL + _KM_FACTORS + _BODY_WEIGHTS + _SAFETY
)


@dataclass(frozen=True, slots=True)
class ReferenceParameterSet:
    """An immutable, versioned view over the registry."""

    version: str = REGISTRY_VERSION

    def get(self, param_id: str) -> ReferenceParameter:
        try:
            return REFERENCE_PARAMETERS[param_id]
        except KeyError:
            raise KeyError(
                f"unknown reference parameter {param_id!r}. Add it to "
                "hos/core/reference_params/__init__.py with its primary citation."
            ) from None

    def quantity(self, param_id: str) -> Quantity:
        return self.get(param_id).as_quantity(self.version)

    def for_species(self, prefix: str, species: str) -> Quantity:
        """Fetch e.g. ``for_species('qh', 'rat')`` -> hepatic blood flow in rat."""
        return self.quantity(f"{prefix}.{species.lower()}")

    def __iter__(self) -> Iterator[ReferenceParameter]:
        return iter(REFERENCE_PARAMETERS.values())

    def __len__(self) -> int:
        return len(REFERENCE_PARAMETERS)


_DEFAULT_SET = ReferenceParameterSet()


def get_parameter(param_id: str) -> ReferenceParameter:
    return _DEFAULT_SET.get(param_id)


def get_quantity(param_id: str) -> Quantity:
    return _DEFAULT_SET.quantity(param_id)
