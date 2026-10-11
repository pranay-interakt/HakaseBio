"""OECD test-guideline design minimums and endpoint checklists, as cited data.

Values transcribed from the adopted guideline texts (record:
``docs/research/driver_protocols.md`` section C). Each entry names its paragraph.
TG 409 was read from a copy carrying the official 1998 OECD header obtained from a
third-party mirror; it is flagged for re-verification against the OECD original.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

__all__ = ["GuidelineDesign", "GUIDELINES", "RODENTS", "NON_RODENTS"]

RODENTS = frozenset({"rat", "mouse"})
NON_RODENTS = frozenset({"dog", "monkey", "minipig", "rabbit"})


@dataclass(frozen=True, slots=True)
class GuidelineDesign:
    key: str
    citation_key: str
    title: str
    species: frozenset[str]
    min_animals_per_sex: int
    animals_paragraph: str
    min_dose_groups: int
    dose_groups_paragraph: str
    duration_days: int
    duration_exact: bool
    duration_paragraph: str
    min_recovery_animals_per_sex: int
    min_recovery_days: Optional[int]
    recovery_paragraph: str
    max_spacing_factor: float
    spacing_paragraph: str
    haematology: tuple[str, ...]
    clinical_chemistry: tuple[str, ...]
    organ_weights: tuple[str, ...]
    endpoints_paragraphs: str
    needs_reverification: bool = False


_HAEM = ("haematocrit", "haemoglobin", "erythrocyte count", "reticulocyte count",
         "total leukocyte count", "differential leukocyte count", "platelet count",
         "clotting time/potential")

GUIDELINES: dict[str, GuidelineDesign] = {
    "oecd_tg407": GuidelineDesign(
        key="oecd_tg407", citation_key="oecd_tg407",
        title="OECD TG 407: Repeated Dose 28-day Oral Toxicity Study in Rodents (2008)",
        species=RODENTS, min_animals_per_sex=5, animals_paragraph="TG 407 para 17",
        min_dose_groups=3, dose_groups_paragraph="TG 407 para 18",
        duration_days=28, duration_exact=True, duration_paragraph="TG 407 paras 22, 24",
        min_recovery_animals_per_sex=5, min_recovery_days=14, recovery_paragraph="TG 407 para 17",
        max_spacing_factor=10.0, spacing_paragraph="TG 407 para 19",
        haematology=_HAEM,
        clinical_chemistry=("sodium", "potassium", "glucose", "total cholesterol", "urea",
                            "creatinine", "total protein", "albumin",
                            "hepatocellular enzyme (at least two)", "bile acids"),
        organ_weights=("liver", "kidneys", "adrenals", "testes", "epididymides",
                       "prostate + seminal vesicles with coagulating glands", "thymus", "spleen",
                       "brain", "heart"),
        endpoints_paragraphs="TG 407 paras 32 (haematology), 34 (clinical chemistry), "
                             "40 (organ weights)",
    ),
    "oecd_tg408": GuidelineDesign(
        key="oecd_tg408", citation_key="oecd_tg408",
        title="OECD TG 408: Repeated Dose 90-Day Oral Toxicity Study in Rodents (2018)",
        species=RODENTS, min_animals_per_sex=10, animals_paragraph="TG 408 para 15",
        min_dose_groups=3, dose_groups_paragraph="TG 408 para 16",
        duration_days=90, duration_exact=False, duration_paragraph="TG 408 paras 20, 22",
        min_recovery_animals_per_sex=5, min_recovery_days=None, recovery_paragraph="TG 408 para 15",
        max_spacing_factor=10.0, spacing_paragraph="TG 408 para 16",
        haematology=_HAEM,
        clinical_chemistry=("sodium", "potassium", "glucose", "total cholesterol", "HDL", "LDL",
                            "urea", "blood urea nitrogen", "creatinine", "total protein",
                            "albumin", "hepatocellular enzyme (more than two)", "total T4", "T3",
                            "TSH"),
        organ_weights=("liver", "kidneys", "adrenals", "testes", "epididymides",
                       "prostate + seminal vesicles with coagulating glands", "uterus", "ovaries",
                       "thymus", "spleen", "brain", "heart"),
        endpoints_paragraphs="TG 408 paras 31 (haematology), 32 (clinical chemistry), "
                             "34 (thyroid hormones), 43 (organ weights)",
    ),
    "oecd_tg409": GuidelineDesign(
        key="oecd_tg409", citation_key="oecd_tg409",
        title="OECD TG 409: Repeated Dose 90-Day Oral Toxicity Study in Non-Rodents (1998)",
        species=NON_RODENTS, min_animals_per_sex=4, animals_paragraph="TG 409 para 12",
        min_dose_groups=3, dose_groups_paragraph="TG 409 para 13",
        duration_days=90, duration_exact=True, duration_paragraph="TG 409 para 6",
        min_recovery_animals_per_sex=4, min_recovery_days=None, recovery_paragraph="TG 409 para 12",
        max_spacing_factor=10.0, spacing_paragraph="TG 409 para 13",
        haematology=("haematocrit", "haemoglobin", "erythrocyte count", "total leukocyte count",
                     "differential leukocyte count", "platelet count", "clotting time/potential"),
        clinical_chemistry=("calcium", "phosphorus", "chloride", "sodium", "potassium",
                            "fasting glucose", "alanine aminotransferase",
                            "aspartate aminotransferase", "ornithine decarboxylase",
                            "gamma glutamyl transpeptidase", "urea nitrogen", "albumin",
                            "creatinine", "total bilirubin", "total protein"),
        organ_weights=("liver with gall bladder", "kidneys", "adrenals", "testes", "epididymides",
                       "ovaries", "uterus", "thyroid (with parathyroids)", "thymus", "spleen",
                       "brain", "heart"),
        endpoints_paragraphs="TG 409 paras 25 (haematology), 26 (clinical chemistry), "
                             "30 (organ weights)",
        needs_reverification=True,
    ),
}

#: ICH M3(R2) section 1.5: "Limit doses ... of 1000 mg/kg/day for rodents and non-rodents are
#: considered appropriate in all cases except those discussed below."
M3R2_LIMIT_DOSE_MG_KG_DAY = 1000.0
