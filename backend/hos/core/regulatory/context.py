"""Programme context: the facts about a candidate that determine its study set."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

__all__ = ["Modality", "Indication", "Route", "ClinicalPopulation", "ProgramContext"]


class Modality(str, Enum):
    SMALL_MOLECULE = "small_molecule"
    PEPTIDE = "peptide"
    OLIGONUCLEOTIDE = "oligonucleotide"
    MONOCLONAL_ANTIBODY = "monoclonal_antibody"
    RECOMBINANT_PROTEIN = "recombinant_protein"
    ANTIBODY_DRUG_CONJUGATE = "antibody_drug_conjugate"
    CELL_THERAPY = "cell_therapy"
    GENE_THERAPY = "gene_therapy"
    VACCINE = "vaccine"

    @property
    def is_biotechnology_derived(self) -> bool:
        """Falls under ICH S6(R1) rather than the small-molecule default."""
        return self in (
            Modality.MONOCLONAL_ANTIBODY,
            Modality.RECOMBINANT_PROTEIN,
            Modality.ANTIBODY_DRUG_CONJUGATE,
        )

    @property
    def is_advanced_therapy(self) -> bool:
        """Cell and gene therapies: governed by CBER/EMA ATMP guidance, not M3(R2)."""
        return self in (Modality.CELL_THERAPY, Modality.GENE_THERAPY)


class Indication(str, Enum):
    ADVANCED_CANCER = "advanced_cancer"            # ICH S9 applies
    ONCOLOGY_NON_ADVANCED = "oncology_non_advanced"  # S9 does NOT apply (e.g. adjuvant, prevention)
    CHRONIC_NON_ONCOLOGY = "chronic_non_oncology"
    ACUTE_NON_ONCOLOGY = "acute_non_oncology"
    LIFE_THREATENING_NON_ONCOLOGY = "life_threatening_non_oncology"
    RARE_GENETIC = "rare_genetic"


class Route(str, Enum):
    ORAL = "oral"
    INTRAVENOUS = "intravenous"
    SUBCUTANEOUS = "subcutaneous"
    INTRAMUSCULAR = "intramuscular"
    TOPICAL_DERMAL = "topical_dermal"
    INHALATION = "inhalation"
    INTRATHECAL = "intrathecal"
    INTRAVITREAL = "intravitreal"
    OTHER_PARENTERAL = "other_parenteral"

    @property
    def is_non_systemic_or_local(self) -> bool:
        return self in (Route.TOPICAL_DERMAL, Route.INHALATION, Route.INTRAVITREAL,
                        Route.INTRATHECAL)


class ClinicalPopulation(str, Enum):
    HEALTHY_VOLUNTEERS = "healthy_volunteers"
    PATIENTS = "patients"
    WOMEN_OF_CHILDBEARING_POTENTIAL = "women_of_childbearing_potential"
    PREGNANT_WOMEN = "pregnant_women"
    PEDIATRIC = "pediatric"


@dataclass(frozen=True, slots=True)
class ProgramContext:
    """Everything the rules engine needs to know about a programme.

    Fields that are unknown are left ``None`` and the engine records the
    requirement as *conditional, pending that fact* rather than guessing.
    """

    modality: Modality
    indication: Indication
    route: Route
    intended_clinical_duration_days: int
    """Duration of treatment in the intended clinical use (drives marketing-support tox)."""
    max_trial_duration_days: int
    """Longest dosing duration planned in the clinical trial being supported."""
    populations: tuple[ClinicalPopulation, ...] = (ClinicalPopulation.HEALTHY_VOLUNTEERS,)
    supports_marketing: bool = False
    """True when the study set must also support a marketing application (M3(R2) Table 2)."""
    molar_extinction_coefficient_ge_1000: Optional[bool] = None
    """ICH S10 trigger: absorbs light 290-700 nm with MEC >= 1000 L mol^-1 cm^-1."""
    pharmacologically_relevant_species: tuple[str, ...] = ()
    """For biologics: species in which the product is pharmacologically active (S6(R1))."""
    is_immunomodulatory_agonist: bool = False
    """Immune agonists/T-cell engagers: cytokine release and MABEL requirements."""
    is_integrating_vector: Optional[bool] = None
    """Gene therapy: integrating vectors require insertional-mutagenesis assessment."""
    intended_pediatric_use: bool = False
    notes: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.intended_clinical_duration_days <= 0:
            raise ValueError("intended_clinical_duration_days must be positive")
        if self.max_trial_duration_days <= 0:
            raise ValueError("max_trial_duration_days must be positive")
        if self.modality.is_biotechnology_derived and not self.pharmacologically_relevant_species:
            # not an error: the engine will record the species-relevance assessment as required
            pass

    @property
    def is_oncology_s9(self) -> bool:
        return self.indication is Indication.ADVANCED_CANCER

    @property
    def includes_wocbp(self) -> bool:
        return ClinicalPopulation.WOMEN_OF_CHILDBEARING_POTENTIAL in self.populations

    @property
    def includes_pregnant(self) -> bool:
        return ClinicalPopulation.PREGNANT_WOMEN in self.populations

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ProgramContext":
        return cls(
            modality=Modality(d["modality"]),
            indication=Indication(d["indication"]),
            route=Route(d["route"]),
            intended_clinical_duration_days=int(d["intended_clinical_duration_days"]),
            max_trial_duration_days=int(d["max_trial_duration_days"]),
            populations=tuple(ClinicalPopulation(p) for p in d.get(
                "populations", [ClinicalPopulation.HEALTHY_VOLUNTEERS.value])),
            supports_marketing=bool(d.get("supports_marketing", False)),
            molar_extinction_coefficient_ge_1000=d.get("molar_extinction_coefficient_ge_1000"),
            pharmacologically_relevant_species=tuple(d.get("pharmacologically_relevant_species", ())),
            is_immunomodulatory_agonist=bool(d.get("is_immunomodulatory_agonist", False)),
            is_integrating_vector=d.get("is_integrating_vector"),
            intended_pediatric_use=bool(d.get("intended_pediatric_use", False)),
            notes=dict(d.get("notes", {})),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "modality": self.modality.value,
            "indication": self.indication.value,
            "route": self.route.value,
            "intended_clinical_duration_days": self.intended_clinical_duration_days,
            "max_trial_duration_days": self.max_trial_duration_days,
            "populations": [p.value for p in self.populations],
            "supports_marketing": self.supports_marketing,
            "molar_extinction_coefficient_ge_1000": self.molar_extinction_coefficient_ge_1000,
            "pharmacologically_relevant_species": list(self.pharmacologically_relevant_species),
            "is_immunomodulatory_agonist": self.is_immunomodulatory_agonist,
            "is_integrating_vector": self.is_integrating_vector,
            "intended_pediatric_use": self.intended_pediatric_use,
            "notes": dict(self.notes),
        }
