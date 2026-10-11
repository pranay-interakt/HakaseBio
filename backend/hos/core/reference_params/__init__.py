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

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Final

from hos.core.citations import cite
from hos.core.quantity import Quantity

__all__ = [
    "REFERENCE_PARAMETERS",
    "REGISTRY_VERSION",
    "RESIDUE_MASSES",
    "RESIDUE_MASS_TABLE",
    "RESIDUE_MASS_TABLE_VERSION",
    "ReferenceParameter",
    "ReferenceParameterSet",
    "ReferenceTable",
    "get_parameter",
    "get_quantity",
]

REGISTRY_VERSION: Final[str] = "2026.10.2"


@dataclass(frozen=True, slots=True)
class ReferenceParameter:
    """A single cited constant."""

    id: str
    value: float
    unit: str
    description: str
    citation_key: str
    species: str | None = None
    requires_verification: bool = False
    note: str | None = None

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
    species: str | None = None,
    requires_verification: bool = False,
    note: str | None = None,
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
# Hepatic blood flow. Davies & Morris 1993 Table III (p. 1094) gives liver blood flow in
# mL/min for a stated reference animal; the per-kg values are that flow divided by the
# reference body weight in the column heading.
# --------------------------------------------------------------------------
_HEPATIC_BLOOD_FLOW = [
    _p(
        "qh.human",
        20.7,
        "mL/min/kg",
        "Hepatic blood flow (human)",
        "davies1993",
        "human",
        note="Table III: 1450 mL/min / 70 kg",
    ),
    _p(
        "qh.rat",
        55.2,
        "mL/min/kg",
        "Hepatic blood flow (rat)",
        "davies1993",
        "rat",
        note="Table III: 13.8 mL/min / 0.25 kg",
    ),
    _p(
        "qh.mouse",
        90.0,
        "mL/min/kg",
        "Hepatic blood flow (mouse)",
        "davies1993",
        "mouse",
        note="Table III: 1.8 mL/min / 0.02 kg",
    ),
    _p(
        "qh.dog",
        30.9,
        "mL/min/kg",
        "Hepatic blood flow (dog)",
        "davies1993",
        "dog",
        note="Table III: 309 mL/min / 10 kg",
    ),
    _p(
        "qh.monkey",
        43.6,
        "mL/min/kg",
        "Hepatic blood flow (monkey)",
        "davies1993",
        "monkey",
        note="Table III: 218 mL/min / 5 kg (column headed 'Monkey', species not stated)",
    ),
    _p(
        "qh.rabbit",
        70.8,
        "mL/min/kg",
        "Hepatic blood flow (rabbit)",
        "davies1993",
        "rabbit",
        note="Table III: 177 mL/min / 2.5 kg",
    ),
]

# --------------------------------------------------------------------------
# Liver weight per kg body weight. Davies & Morris 1993 Table I (p. 1093), organ weight in g
# divided by the reference body weight of the column.
# --------------------------------------------------------------------------
_LIVER_WEIGHT = [
    _p(
        "liver_weight.human",
        21.4,
        "g/kg",
        "Liver weight per kg body weight (human, IVIVE)",
        "riley2005",
        "human",
        requires_verification=True,
        note="21.4 g/kg (1500 g / 70 kg) is the value conventionally used in IVIVE (e.g. Brown, "
        "Griffin & Houston 2007) but no primary determination has been traced. Riley 2005 "
        "states literature human liver weights span 1500-1800 g per 70 kg. The anatomical "
        "reference value is liver_weight.human.anatomical (Davies & Morris 1993).",
    ),
    _p(
        "liver_weight.human.anatomical",
        25.7,
        "g/kg",
        "Liver weight per kg body weight (human, anatomical)",
        "davies1993",
        "human",
        note="Table I: 1800 g / 70 kg",
    ),
    _p(
        "liver_weight.rat",
        40.0,
        "g/kg",
        "Liver weight per kg body weight (rat)",
        "davies1993",
        "rat",
        note="Table I: 10.0 g / 0.25 kg",
    ),
    _p(
        "liver_weight.mouse",
        87.5,
        "g/kg",
        "Liver weight per kg body weight (mouse)",
        "davies1993",
        "mouse",
        note="Table I: 1.75 g / 0.02 kg",
    ),
    _p(
        "liver_weight.rabbit",
        30.8,
        "g/kg",
        "Liver weight per kg body weight (rabbit)",
        "davies1993",
        "rabbit",
        note="Table I: 77 g / 2.5 kg",
    ),
    _p(
        "liver_weight.dog",
        32.0,
        "g/kg",
        "Liver weight per kg body weight (dog)",
        "davies1993",
        "dog",
        note="Table I: 320 g / 10 kg",
    ),
    _p(
        "liver_weight.monkey",
        30.0,
        "g/kg",
        "Liver weight per kg body weight (monkey)",
        "davies1993",
        "monkey",
        note="Table I: 150 g / 5 kg (rhesus)",
    ),
]

# --------------------------------------------------------------------------
# Microsomal protein per gram liver (MPPGL). Only species with a primary determination are
# registered; for any other species the IVIVE chain returns UNAVAILABLE rather than borrowing
# another species' value.
# --------------------------------------------------------------------------
_MPPGL = [
    _p(
        "mppgl.human",
        32.0,
        "mg/g",
        "Microsomal protein per gram liver (human)",
        "barter2007",
        "human",
        note="Barter 2007 consensus weighted geometric mean, 95% CI 29-34 mg/g. MPPGL is "
        "age-dependent (Barter 2008: maximum about 40 mg/g near 28 years, 29 mg/g at 65).",
    ),
    _p(
        "mppgl.human.hakooz2006",
        40.0,
        "mg/g",
        "Microsomal protein per gram liver (human, Hakooz 2006 mean)",
        "hakooz2006",
        "human",
        note="Mean of 38 human livers, CV 31%.",
    ),
    _p(
        "mppgl.rat",
        61.0,
        "mg/g",
        "Microsomal protein per gram liver (rat)",
        "smith2008",
        "rat",
        note="Wistar rat geometric mean, 95% CI 47-75 mg/g. The widely used 45 mg/g (Houston "
        "1994) is a composite of several rat literature sources (Barter 2008).",
    ),
    _p(
        "mppgl.dog",
        55.0,
        "mg/g",
        "Microsomal protein per gram liver (dog)",
        "smith2008",
        "dog",
        note="Beagle geometric mean, 95% CI 48-62 mg/g.",
    ),
]

# --------------------------------------------------------------------------
# FDA body-surface-area conversion factors K_m (FDA 2005 MRSD guidance, Table 1 p. 7 and
# Table 3 p. 19). Appendix D: "The km factor has units of kg/m2".
# --------------------------------------------------------------------------
_KM = "kg/m**2"
_KM_FACTORS = [
    _p("km.human", 37.0, _KM, "BSA conversion factor Km (human, 60 kg)", "fda_mrsd_2005", "human"),
    _p("km.mouse", 3.0, _KM, "BSA conversion factor Km (mouse)", "fda_mrsd_2005", "mouse"),
    _p("km.hamster", 5.0, _KM, "BSA conversion factor Km (hamster)", "fda_mrsd_2005", "hamster"),
    _p("km.rat", 6.0, _KM, "BSA conversion factor Km (rat)", "fda_mrsd_2005", "rat"),
    _p("km.ferret", 7.0, _KM, "BSA conversion factor Km (ferret)", "fda_mrsd_2005", "ferret"),
    _p(
        "km.guinea_pig",
        8.0,
        _KM,
        "BSA conversion factor Km (guinea pig)",
        "fda_mrsd_2005",
        "guinea_pig",
    ),
    _p("km.rabbit", 12.0, _KM, "BSA conversion factor Km (rabbit)", "fda_mrsd_2005", "rabbit"),
    _p("km.dog", 20.0, _KM, "BSA conversion factor Km (dog)", "fda_mrsd_2005", "dog"),
    _p(
        "km.monkey",
        12.0,
        _KM,
        "BSA conversion factor Km (monkeys: rhesus, cynomolgus)",
        "fda_mrsd_2005",
        "monkey",
    ),
    _p("km.marmoset", 6.0, _KM, "BSA conversion factor Km (marmoset)", "fda_mrsd_2005", "marmoset"),
    _p(
        "km.squirrel_monkey",
        7.0,
        _KM,
        "BSA conversion factor Km (squirrel monkey)",
        "fda_mrsd_2005",
        "squirrel_monkey",
    ),
    _p("km.baboon", 20.0, _KM, "BSA conversion factor Km (baboon)", "fda_mrsd_2005", "baboon"),
    _p(
        "km.micropig",
        27.0,
        _KM,
        "BSA conversion factor Km (micro-pig)",
        "fda_mrsd_2005",
        "micropig",
    ),
    _p("km.minipig", 35.0, _KM, "BSA conversion factor Km (mini-pig)", "fda_mrsd_2005", "minipig"),
]

# --------------------------------------------------------------------------
# Reference body weights (FDA 2005, Table 3, Appendix B, p. 19)
# --------------------------------------------------------------------------
_BW_NOTE = "FDA 2005 Table 3 (Appendix B, p. 19)"
_BODY_WEIGHTS = [
    _p(
        "bw.human",
        60.0,
        "kg",
        "Reference body weight (human, FDA MRSD)",
        "fda_mrsd_2005",
        "human",
        note=_BW_NOTE,
    ),
    _p(
        "bw.mouse",
        0.020,
        "kg",
        "Reference body weight (mouse)",
        "fda_mrsd_2005",
        "mouse",
        note=_BW_NOTE + "; working range 0.011-0.034 kg",
    ),
    _p(
        "bw.rat",
        0.150,
        "kg",
        "Reference body weight (rat)",
        "fda_mrsd_2005",
        "rat",
        note=_BW_NOTE + "; working range 0.080-0.270 kg",
    ),
    _p(
        "bw.rabbit",
        1.8,
        "kg",
        "Reference body weight (rabbit)",
        "fda_mrsd_2005",
        "rabbit",
        note=_BW_NOTE + "; working range 0.9-3.0 kg",
    ),
    _p(
        "bw.dog",
        10.0,
        "kg",
        "Reference body weight (dog)",
        "fda_mrsd_2005",
        "dog",
        note=_BW_NOTE + "; working range 5-17 kg",
    ),
    _p(
        "bw.monkey",
        3.0,
        "kg",
        "Reference body weight (monkey)",
        "fda_mrsd_2005",
        "monkey",
        note=_BW_NOTE + "; working range 1.4-4.9 kg",
    ),
    _p(
        "bw.micropig",
        20.0,
        "kg",
        "Reference body weight (micro-pig)",
        "fda_mrsd_2005",
        "micropig",
        note=_BW_NOTE + "; working range 10-33 kg",
    ),
    _p(
        "bw.minipig",
        40.0,
        "kg",
        "Reference body weight (mini-pig)",
        "fda_mrsd_2005",
        "minipig",
        note=_BW_NOTE + "; working range 25-64 kg",
    ),
]

# --------------------------------------------------------------------------
# Default MRSD safety factor (FDA 2005, Section VII, p. 10)
# --------------------------------------------------------------------------
_SAFETY = [
    _p(
        "mrsd.default_safety_factor",
        10.0,
        "dimensionless",
        "Default safety factor applied to the HED to obtain the MRSD",
        "fda_mrsd_2005",
        note="FDA 2005 Section VII (Step 4), p. 10: 'The default safety factor that should "
        "normally be used is 10.' Increases: Section VII.A (pp. 10-11); decreases: "
        "Section VII.B (pp. 11-12).",
    ),
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

    def has(self, param_id: str) -> bool:
        return param_id in REFERENCE_PARAMETERS

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


# --------------------------------------------------------------------------
# Average amino-acid residue masses and water, transcribed by script from the ExPASy FindMod
# "Mass values used" page (read 2026-10-11, SHA-256 1bcb8504aea37ac7826c882195318585989503743a
# 042c6d1470ac0f8e99357b), the table the ExPASy Compute pI/Mw method links to. Residue mass is
# the free amino acid minus water; the page gives daltons, numerically equal to g/mol.
#
# A separate table with its own version: the physiological registry's version is embedded in
# results already signed, so new, unrelated constants do not bump it.
# --------------------------------------------------------------------------
RESIDUE_MASS_TABLE_VERSION: Final[str] = "expasy-findmod.2026-10-11"
_RM = "expasy_findmod_masses"
_RESIDUE_AVERAGE = {
    "A": ("alanine", 71.0788),
    "R": ("arginine", 156.1875),
    "N": ("asparagine", 114.1038),
    "D": ("aspartic acid", 115.0886),
    "C": ("cysteine", 103.1388),
    "E": ("glutamic acid", 129.1155),
    "Q": ("glutamine", 128.1307),
    "G": ("glycine", 57.0519),
    "H": ("histidine", 137.1411),
    "I": ("isoleucine", 113.1594),
    "L": ("leucine", 113.1594),
    "K": ("lysine", 128.1741),
    "M": ("methionine", 131.1926),
    "F": ("phenylalanine", 147.1766),
    "P": ("proline", 97.1167),
    "S": ("serine", 87.0782),
    "T": ("threonine", 101.1051),
    "W": ("tryptophan", 186.2132),
    "Y": ("tyrosine", 163.1760),
    "V": ("valine", 99.1326),
    "U": ("selenocysteine", 150.0388),
    "O": ("pyrrolysine", 237.3018),
}
_SEC_NOTE = (
    "listed under non-standard amino acids; the average is consistent with selenium "
    "78.96, about 0.011 Da below a value from the 2024 standard atomic weight 78.971"
)
RESIDUE_MASSES: Final[dict[str, ReferenceParameter]] = dict(
    [
        _p(
            f"residue_mass.average.{code}",
            mass,
            "g/mol",
            f"Average residue mass, {name} ({code})",
            _RM,
            note=_SEC_NOTE
            if code == "U"
            else "listed under non-standard amino acids"
            if code == "O"
            else None,
        )
        for code, (name, mass) in _RESIDUE_AVERAGE.items()
    ]
    + [_p("water_mass.average", 18.01524, "g/mol", "Average mass of water (H2O)", _RM)]
)


@dataclass(frozen=True, slots=True)
class ReferenceTable:
    """A cited table versioned on its own, outside the physiological registry."""

    version: str
    entries: Mapping[str, ReferenceParameter]

    def get(self, param_id: str) -> ReferenceParameter:
        try:
            return self.entries[param_id]
        except KeyError:
            raise KeyError(f"unknown entry {param_id!r} in table {self.version}") from None

    def quantity(self, param_id: str) -> Quantity:
        return self.get(param_id).as_quantity(self.version)

    def has(self, param_id: str) -> bool:
        return param_id in self.entries


RESIDUE_MASS_TABLE: Final[ReferenceTable] = ReferenceTable(
    RESIDUE_MASS_TABLE_VERSION, RESIDUE_MASSES
)
