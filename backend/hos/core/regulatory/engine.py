"""Derivation of the nonclinical study set from ICH/FDA rules.

Each rule below cites the guideline and section that creates the requirement.
The engine does not invent requirements and does not drop them: when the
programme context lacks a fact a rule needs, the requirement is emitted as
``CONDITIONAL`` with the missing fact named, so the gap is visible.

Durations follow toxicology convention of expressing study length in weeks
(2 / 4 / 13 / 26 / 39 weeks = 2 weeks / 1 / 3 / 6 / 9 months), which is how
ICH M3(R2) Tables 1 and 2 are applied in practice.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from hos.core.citations import cite
from hos.core.provenance import Citation
from hos.core.regulatory.context import Modality, ProgramContext

__all__ = [
    "StudyCategory",
    "StudyRequirement",
    "StudySet",
    "Timing",
    "derive_study_set",
    "m3r2_marketing_duration",
    "m3r2_trial_support_duration",
]


class StudyCategory(str, Enum):
    PHARMACOLOGY = "pharmacology"
    SAFETY_PHARMACOLOGY = "safety_pharmacology"
    PHARMACOKINETICS = "pharmacokinetics"
    GENERAL_TOXICOLOGY = "general_toxicology"
    GENOTOXICITY = "genotoxicity"
    REPRODUCTIVE_TOXICOLOGY = "reproductive_toxicology"
    CARCINOGENICITY = "carcinogenicity"
    LOCAL_TOLERANCE = "local_tolerance"
    IMMUNOTOXICITY = "immunotoxicity"
    PHOTOSAFETY = "photosafety"
    JUVENILE_TOXICOLOGY = "juvenile_toxicology"
    BIOANALYTICAL = "bioanalytical"
    BIOLOGICS_SPECIFIC = "biologics_specific"
    ADVANCED_THERAPY_SPECIFIC = "advanced_therapy_specific"


class Timing(str, Enum):
    """The clinical milestone a study must be complete before."""

    BEFORE_FIRST_IN_HUMAN = "before_first_in_human"
    BEFORE_MULTIPLE_DOSE = "before_multiple_dose_trials"
    BEFORE_PHASE_2 = "before_phase_2"
    BEFORE_WOCBP = "before_inclusion_of_wocbp"
    BEFORE_PHASE_3 = "before_phase_3"
    MARKETING = "marketing_application"

    @property
    def order(self) -> int:
        return [
            "before_first_in_human",
            "before_multiple_dose_trials",
            "before_phase_2",
            "before_inclusion_of_wocbp",
            "before_phase_3",
            "marketing_application",
        ].index(self.value)


class RequirementStatus(str, Enum):
    REQUIRED = "required"
    CONDITIONAL = "conditional"          # depends on a fact not yet known or a signal
    NOT_REQUIRED = "not_required"        # recorded explicitly so the waiver is auditable


#: ICH S7A 2.7: the core battery assesses the central nervous (2.7.1), cardiovascular (2.7.2)
#: and respiratory (2.7.3) systems.
CORE_BATTERY_COMPONENTS = ("cns", "cardiovascular", "respiratory")


@dataclass(frozen=True, slots=True)
class StudyRequirement:
    """One study the programme must (or conditionally must) perform."""

    id: str
    name: str
    category: StudyCategory
    status: RequirementStatus
    timing: Timing
    citation: Citation
    section: str
    rationale: str
    glp: bool
    species: tuple[str, ...] = ()
    duration_weeks: float | None = None
    driver_id: str | None = None
    pending_fact: str | None = None
    ctd_section: str | None = None
    components: tuple[str, ...] = ()
    """Parts that must all be covered before the requirement is met (e.g. the S7A core
    battery's CNS, cardiovascular and respiratory assessments)."""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category.value,
            "status": self.status.value,
            "timing": self.timing.value,
            "citation": self.citation.to_dict(),
            "section": self.section,
            "rationale": self.rationale,
            "glp": self.glp,
            "species": list(self.species),
            "duration_weeks": self.duration_weeks,
            "components": list(self.components),
            "driver_id": self.driver_id,
            "pending_fact": self.pending_fact,
            "ctd_section": self.ctd_section,
        }


@dataclass(frozen=True, slots=True)
class StudySet:
    """The complete derived study set for a programme."""

    context: ProgramContext
    requirements: tuple[StudyRequirement, ...]
    governing_guidelines: tuple[Citation, ...]
    notes: tuple[str, ...] = field(default_factory=tuple)

    def required(self) -> list[StudyRequirement]:
        return [r for r in self.requirements if r.status is RequirementStatus.REQUIRED]

    def conditional(self) -> list[StudyRequirement]:
        return [r for r in self.requirements if r.status is RequirementStatus.CONDITIONAL]

    def waived(self) -> list[StudyRequirement]:
        return [r for r in self.requirements if r.status is RequirementStatus.NOT_REQUIRED]

    def due_by(self, timing: Timing) -> list[StudyRequirement]:
        """Required studies that must be complete by the given milestone."""
        return [
            r for r in self.required() if r.timing.order <= timing.order
        ]

    def to_dict(self) -> dict[str, Any]:
        return {
            "context": self.context.to_dict(),
            "requirements": [r.to_dict() for r in self.requirements],
            "governing_guidelines": [c.to_dict() for c in self.governing_guidelines],
            "notes": list(self.notes),
            "summary": {
                "required": len(self.required()),
                "conditional": len(self.conditional()),
                "not_required": len(self.waived()),
            },
        }


# ---------------------------------------------------------------------------
# ICH M3(R2) duration tables
# ---------------------------------------------------------------------------

def m3r2_trial_support_duration(max_trial_days: int) -> tuple[float, float, str]:
    """ICH M3(R2) Table 1: repeated-dose tox duration to support a clinical trial.

    Returns (rodent_weeks, non_rodent_weeks, note).
    """
    if max_trial_days <= 14:
        return 2.0, 2.0, "M3(R2) Table 1: trials up to 2 weeks are supported by 2-week studies"
    if max_trial_days <= 182:
        weeks = max_trial_days / 7.0
        return (
            weeks,
            weeks,
            "M3(R2) Table 1: trials between 2 weeks and 6 months are supported by studies of "
            "at least the same duration as the trial",
        )
    return (
        26.0,
        39.0,
        "M3(R2) Table 1: trials longer than 6 months require a 6-month rodent and a 9-month "
        "non-rodent study (a 6-month non-rodent study is generally acceptable in the EU)",
    )


def m3r2_marketing_duration(treatment_days: int) -> tuple[float, float, str]:
    """ICH M3(R2) Table 2: repeated-dose tox duration to support marketing."""
    if treatment_days <= 14:
        return 4.0, 4.0, "M3(R2) Table 2: treatment up to 2 weeks -> 1-month studies"
    if treatment_days <= 30:
        return 13.0, 13.0, "M3(R2) Table 2: treatment >2 weeks to 1 month -> 3-month studies"
    if treatment_days <= 91:
        return 26.0, 26.0, "M3(R2) Table 2: treatment >1 month to 3 months -> 6-month studies"
    return 26.0, 39.0, "M3(R2) Table 2: treatment >3 months -> 6-month rodent, 9-month non-rodent"


# ---------------------------------------------------------------------------
# Rule groups
# ---------------------------------------------------------------------------

def _req(**kw: Any) -> StudyRequirement:
    return StudyRequirement(**kw)


def _small_molecule_rules(ctx: ProgramContext) -> list[StudyRequirement]:
    m3 = cite("ich_m3r2")
    out: list[StudyRequirement] = []
    s9 = ctx.is_oncology_s9

    # --- primary/secondary pharmacology and in vitro ADME --------------------
    out.append(_req(
        id="pharm.primary", name="Primary pharmacodynamics (in vitro and in vivo)",
        category=StudyCategory.PHARMACOLOGY, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) section 2",
        rationale="Mechanism and pharmacologically active dose are needed to set the starting "
                  "dose and to interpret toxicity",
        glp=False, ctd_section="4.2.1.1", driver_id="in_vitro_potency",
    ))
    out.append(_req(
        id="adme.metabolic_stability", name="In vitro metabolic stability (liver microsomes)",
        category=StudyCategory.PHARMACOKINETICS, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) section 3",
        rationale="In vitro metabolic data across species are expected before human exposure "
                  "to support species selection and human clearance prediction",
        glp=False, species=("human", "rat", "dog"), driver_id="metabolic_stability",
        ctd_section="4.2.2.4",
    ))
    out.append(_req(
        id="adme.plasma_protein_binding", name="Plasma protein binding across species",
        category=StudyCategory.PHARMACOKINETICS, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) section 3",
        rationale="Unbound fractions are needed to compare exposures across species and to "
                  "compute free-drug safety margins",
        glp=False, species=("human", "rat", "dog"), ctd_section="4.2.2.3",
        driver_id="plasma_protein_binding",
    ))
    out.append(_req(
        id="adme.in_vivo_pk", name="In vivo pharmacokinetics (ADME) in test species",
        category=StudyCategory.PHARMACOKINETICS, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_PHASE_3, citation=m3, section="M3(R2) section 3",
        rationale="Further information on pharmacokinetics (absorption, distribution, metabolism "
                  "and excretion) in test species should be available before exposing large "
                  "numbers of human subjects or treating for long duration (generally before "
                  "Phase III); exposure in the tox species before first-in-human is covered by "
                  "toxicokinetics (ICH S3A)",
        glp=False, species=("rat", "dog"), ctd_section="4.2.2.2", driver_id="in_vivo_pk",
    ))
    out.append(_req(
        id="adme.metabolite_profiling", name="Metabolite profiling and human metabolite comparison",
        category=StudyCategory.PHARMACOKINETICS, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_PHASE_3, citation=m3, section="M3(R2) section 3",
        rationale="Human metabolites at >10% of total drug-related exposure that are "
                  "disproportionate to animals require nonclinical characterisation",
        glp=False, ctd_section="4.2.2.4",
    ))

    # --- safety pharmacology -------------------------------------------------
    if s9:
        out.append(_req(
            id="safety.core_battery", name="Stand-alone safety pharmacology core battery",
            category=StudyCategory.SAFETY_PHARMACOLOGY, status=RequirementStatus.NOT_REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=cite("ich_s9"), section="S9 section 2.2",
            rationale="For advanced cancer, safety pharmacology endpoints may be incorporated "
                      "into general toxicology studies; stand-alone studies are not needed "
                      "unless a specific concern exists",
            glp=False,
        ))
    else:
        out.append(_req(
            id="safety.core_battery",
            name="Safety pharmacology core battery: CNS, cardiovascular, respiratory",
            category=StudyCategory.SAFETY_PHARMACOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=cite("ich_s7a"),
            section="S7A sections 2.7, 2.10.1",
            rationale="The core battery must be completed before first administration in "
                      "humans; it covers the central nervous (2.7.1), cardiovascular (2.7.2) "
                      "and respiratory (2.7.3) systems",
            glp=True, species=("rat", "dog"), ctd_section="4.2.1.3",
            components=CORE_BATTERY_COMPONENTS,
        ))
    out.append(_req(
        id="safety.herg", name="In vitro hERG (IKr) assay",
        category=StudyCategory.SAFETY_PHARMACOLOGY,
        status=RequirementStatus.REQUIRED if not s9 else RequirementStatus.CONDITIONAL,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=cite("ich_s7b"), section="S7B sections 2.3.1, 3.1.2",
        rationale="An in vitro IKr assay is part of the S7B integrated risk assessment for "
                  "delayed ventricular repolarisation" + (
                      "; under S9 it is conducted when a cardiac concern exists" if s9 else ""),
        glp=True, driver_id="herg_patch_clamp", ctd_section="4.2.1.3",
        pending_fact="cardiac signal or class concern" if s9 else None,
    ))
    if not s9:
        out.append(_req(
            id="safety.in_vivo_qt", name="In vivo QT assessment in a non-rodent (telemetry)",
            category=StudyCategory.SAFETY_PHARMACOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=cite("ich_s7b"), section="S7B sections 2.3.2, 3.1.3",
            rationale="An in vivo QT assay complements the in vitro IKr result; together they "
                      "form the S7B integrated risk assessment",
            glp=True, species=("dog",), ctd_section="4.2.1.3",
            driver_id="in_vivo_qt_telemetry",
        ))

    # --- general toxicology --------------------------------------------------
    if s9:
        weeks = max(ctx.max_trial_duration_days / 7.0, 4.0)
        out.append(_req(
            id="tox.repeat_dose", name="Repeat-dose toxicity on the clinical schedule",
            category=StudyCategory.GENERAL_TOXICOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=cite("ich_s9"), section="S9 sections 2.4, 3.3",
            rationale="Studies matching the clinical schedule support first-in-human; 3-month "
                      "studies generally support further development and marketing",
            glp=True, species=("rat", "dog"), duration_weeks=round(weeks, 1),
            driver_id="repeat_dose_toxicity", ctd_section="4.2.3.2",
        ))
    else:
        rod_w, non_w, note = m3r2_trial_support_duration(ctx.max_trial_duration_days)
        out.append(_req(
            id="tox.dose_range_finding", name="Dose range-finding / MTD studies",
            category=StudyCategory.GENERAL_TOXICOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) sections 1.5, 4",
            rationale="Dose selection for the pivotal repeat-dose studies",
            glp=False, species=("rat", "dog"), ctd_section="4.2.3.2",
            driver_id="dose_range_finding",
        ))
        out.append(_req(
            id="tox.repeat_dose_rodent", name="Repeat-dose toxicity (rodent)",
            category=StudyCategory.GENERAL_TOXICOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) section 5.1, Table 1",
            rationale=note, glp=True, species=("rat",), duration_weeks=round(rod_w, 1),
            driver_id="repeat_dose_toxicity", ctd_section="4.2.3.2",
        ))
        out.append(_req(
            id="tox.repeat_dose_nonrodent", name="Repeat-dose toxicity (non-rodent)",
            category=StudyCategory.GENERAL_TOXICOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) section 5.1, Table 1",
            rationale=note, glp=True, species=("dog",), duration_weeks=round(non_w, 1),
            driver_id="repeat_dose_toxicity", ctd_section="4.2.3.2",
        ))
        if ctx.supports_marketing:
            mr, mn, mnote = m3r2_marketing_duration(ctx.intended_clinical_duration_days)
            out.append(_req(
                id="tox.repeat_dose_marketing", name="Chronic repeat-dose toxicity for marketing",
                category=StudyCategory.GENERAL_TOXICOLOGY, status=RequirementStatus.REQUIRED,
                timing=Timing.MARKETING, citation=m3, section="M3(R2) section 5.2, Table 2",
                rationale=mnote, glp=True, species=("rat", "dog"), duration_weeks=max(mr, mn),
                driver_id="repeat_dose_toxicity", ctd_section="4.2.3.2",
            ))

    out.append(_req(
        id="tox.toxicokinetics", name="Toxicokinetics within repeat-dose studies",
        category=StudyCategory.PHARMACOKINETICS, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=cite("ich_s3a"), section="S3A",
        rationale="Systemic exposure must be measured in toxicity studies to relate findings "
                  "to exposure; reported with the toxicity study (ICH M4S(R2) 4.2.3.2, "
                  "'including supportive toxicokinetics evaluations')",
        glp=True, ctd_section="4.2.3.2", driver_id="toxicokinetics",
    ))
    out.append(_req(
        id="bioanalytical.validation", name="Validated bioanalytical method for TK samples",
        category=StudyCategory.BIOANALYTICAL, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=cite("ich_m10"), section="M10 section 3",
        rationale="Concentrations supporting regulatory decisions require a validated method",
        glp=True, ctd_section="4.2.2.1", driver_id="bioanalytical_validation",
    ))

    # --- genotoxicity --------------------------------------------------------
    s2 = cite("ich_s2r1")
    if s9:
        out.append(_req(
            id="genotox.battery", name="Genotoxicity battery",
            category=StudyCategory.GENOTOXICITY, status=RequirementStatus.REQUIRED,
            timing=Timing.MARKETING, citation=cite("ich_s9"), section="S9 section 2.6",
            rationale="Genotoxicity studies are not essential to support clinical trials for "
                      "advanced cancer but are needed for marketing",
            glp=True, ctd_section="4.2.3.3",
        ))
    else:
        out.append(_req(
            id="genotox.ames", name="Bacterial reverse mutation assay (Ames)",
            category=StudyCategory.GENOTOXICITY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) section 9",
            rationale="A gene mutation assay is generally considered sufficient to support "
                      "single-dose clinical trials",
            glp=True, ctd_section="4.2.3.3.1", driver_id="ames",
        ))
        out.append(_req(
            id="genotox.chromosomal", name="Chromosomal damage assay (in vitro or in vivo micronucleus)",
            category=StudyCategory.GENOTOXICITY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_MULTIPLE_DOSE, citation=s2, section="M3(R2) section 9; S2(R1) section 2",
            rationale="An assessment of chromosomal damage in mammalian systems is added to "
                      "support multiple-dose trials",
            glp=True, ctd_section="4.2.3.3",
        ))
        out.append(_req(
            id="genotox.full_battery", name="Complete genotoxicity battery (S2(R1) option 1 or 2)",
            category=StudyCategory.GENOTOXICITY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_PHASE_2, citation=s2, section="S2(R1) section 2.2; M3(R2) section 9",
            rationale="The complete standard battery should be finished before Phase 2",
            glp=True, ctd_section="4.2.3.3",
        ))

    # --- reproductive toxicology --------------------------------------------
    s5 = cite("ich_s5r3")
    if s9:
        out.append(_req(
            id="dart.efd", name="Embryo-fetal development study",
            category=StudyCategory.REPRODUCTIVE_TOXICOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.MARKETING, citation=cite("ich_s9"), section="S9 section 2.5",
            rationale="For advanced cancer, embryo-fetal studies are needed for marketing; "
                      "fertility and pre/postnatal studies are generally not needed",
            glp=True, ctd_section="4.2.3.5.2",
        ))
    else:
        out.append(_req(
            id="dart.efd", name="Embryo-fetal development (rat and rabbit)",
            category=StudyCategory.REPRODUCTIVE_TOXICOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_WOCBP if ctx.includes_wocbp else Timing.BEFORE_PHASE_3,
            citation=m3, section="M3(R2) section 11.3; S5(R3)",
            rationale="Embryo-fetal assessment is required before inclusion of women of "
                      "childbearing potential beyond the limited exposure M3(R2) permits "
                      "(regional differences apply: EU and Japan expect it before any WOCBP "
                      "exposure)",
            glp=True, species=("rat", "rabbit"), ctd_section="4.2.3.5.2",
        ))
        out.append(_req(
            id="dart.fertility", name="Fertility and early embryonic development",
            category=StudyCategory.REPRODUCTIVE_TOXICOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_PHASE_3, citation=m3, section="M3(R2) sections 11.1, 11.3",
            rationale="Male reproductive organs are evaluated in repeat-dose studies; a "
                      "dedicated fertility study is expected before large-scale trials",
            glp=True, species=("rat",), ctd_section="4.2.3.5.1",
        ))
        out.append(_req(
            id="dart.ppnd", name="Pre- and postnatal development",
            category=StudyCategory.REPRODUCTIVE_TOXICOLOGY, status=RequirementStatus.REQUIRED,
            timing=Timing.MARKETING, citation=s5, section="M3(R2) section 11.3; S5(R3)",
            rationale="Pre/postnatal development is submitted for marketing approval",
            glp=True, species=("rat",), ctd_section="4.2.3.5.3",
        ))
        if ctx.includes_pregnant:
            out.append(_req(
                id="dart.pregnant_women", name="All reproductive studies plus full genotox before pregnant-women exposure",
                category=StudyCategory.REPRODUCTIVE_TOXICOLOGY, status=RequirementStatus.REQUIRED,
                timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) section 11.4",
                rationale="Inclusion of pregnant women requires completion of all female "
                          "reproductive studies and the standard genotoxicity battery",
                glp=True, ctd_section="4.2.3.5",
            ))

    # --- carcinogenicity ----------------------------------------------------
    if s9:
        out.append(_req(
            id="carc.bioassay", name="Carcinogenicity studies",
            category=StudyCategory.CARCINOGENICITY, status=RequirementStatus.NOT_REQUIRED,
            timing=Timing.MARKETING, citation=cite("ich_s9"), section="S9 section 2.7",
            rationale="Not warranted to support marketing for advanced cancer",
            glp=False,
        ))
    elif ctx.intended_clinical_duration_days >= 182:
        out.append(_req(
            id="carc.bioassay",
            name="Carcinogenicity assessment (2-year rat or S1B(R1) weight of evidence + rasH2 mouse)",
            category=StudyCategory.CARCINOGENICITY, status=RequirementStatus.REQUIRED,
            timing=Timing.MARKETING, citation=cite("ich_s1a"),
            section="S1A section 4.1; M3(R2) section 10; S1B(R1)",
            rationale="S1A: carcinogenicity studies are performed for any pharmaceutical whose "
                      "expected clinical use is continuous for at least 6 months; M3(R2) places "
                      "them before the marketing application; under S1B(R1) a weight-of-evidence "
                      "assessment may replace the 2-year rat study",
            glp=True, ctd_section="4.2.3.4",
        ))
    else:
        out.append(_req(
            id="carc.bioassay", name="Carcinogenicity studies",
            category=StudyCategory.CARCINOGENICITY, status=RequirementStatus.NOT_REQUIRED,
            timing=Timing.MARKETING, citation=cite("ich_s1a"), section="S1A sections 4.1, 4.2",
            rationale="Intended clinical use is shorter than 6 months continuous (S1A section 4.1); "
                      "carcinogenicity studies are not generally expected absent a cause for "
                      "concern (S1A section 4.2)",
            glp=False,
        ))

    # --- other --------------------------------------------------------------
    if ctx.route.is_non_systemic_or_local or ctx.route.value != "oral":
        out.append(_req(
            id="tox.local_tolerance", name="Local tolerance at the clinical route",
            category=StudyCategory.LOCAL_TOLERANCE, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3, section="M3(R2) section 8",
            rationale="Local tolerance is evaluated, preferably within general toxicity studies, "
                      "by the intended clinical route",
            glp=True, ctd_section="4.2.3.6",
        ))
    if ctx.molar_extinction_coefficient_ge_1000 is None:
        out.append(_req(
            id="photo.assessment", name="Photosafety assessment",
            category=StudyCategory.PHOTOSAFETY, status=RequirementStatus.CONDITIONAL,
            timing=Timing.BEFORE_PHASE_3, citation=cite("ich_s10"), section="S10 sections 2, 5.1.1",
            rationale="Triggered if the molecule has a molar extinction coefficient greater than "
                      "1000 L/mol/cm at any wavelength between 290 and 700 nm",
            glp=False, pending_fact="UV-visible absorption spectrum",
            ctd_section="4.2.3.7.7",
        ))
    elif ctx.molar_extinction_coefficient_ge_1000:
        out.append(_req(
            id="photo.assessment", name="Photosafety assessment (in vitro 3T3 NRU first)",
            category=StudyCategory.PHOTOSAFETY, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_PHASE_3, citation=cite("ich_s10"), section="S10 sections 2, 5.1.1",
            rationale="Absorption meets the S10 trigger",
            glp=False, ctd_section="4.2.3.7.7",
        ))
    out.append(_req(
        id="immunotox.weight_of_evidence", name="Immunotoxicity weight-of-evidence review",
        category=StudyCategory.IMMUNOTOXICITY, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_PHASE_3, citation=cite("ich_s8"), section="S8 sections 2.1, 2.2",
        rationale="Standard toxicity data are evaluated for immunotoxic signals; dedicated "
                  "studies such as TDAR are added only if signals are found",
        glp=False, ctd_section="4.2.3.7.2",
    ))
    if ctx.intended_pediatric_use:
        out.append(_req(
            id="tox.juvenile", name="Juvenile animal toxicity assessment",
            category=StudyCategory.JUVENILE_TOXICOLOGY, status=RequirementStatus.CONDITIONAL,
            timing=Timing.BEFORE_PHASE_3, citation=cite("ich_s11"), section="S11",
            rationale="Needed when adult and existing data are insufficient to support "
                      "the paediatric population",
            glp=True, pending_fact="weight-of-evidence assessment of existing data",
            ctd_section="4.2.3.5.4",
        ))
    return out


def _biologic_rules(ctx: ProgramContext) -> list[StudyRequirement]:
    s6 = cite("ich_s6r1")
    out: list[StudyRequirement] = []
    species = ctx.pharmacologically_relevant_species
    out.append(_req(
        id="bio.species_relevance", name="Pharmacologically relevant species selection",
        category=StudyCategory.BIOLOGICS_SPECIFIC, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=s6, section="S6(R1) section 3.3; Addendum section 2",
        rationale="Toxicity studies must use species in which the product is pharmacologically "
                  "active, established by target homology, binding and functional activity",
        glp=False, ctd_section="4.2.1.1",
        pending_fact=None if species else "cross-species binding and functional data",
    ))
    out.append(_req(
        id="bio.tissue_cross_reactivity", name="Human tissue cross-reactivity (IHC panel)",
        category=StudyCategory.BIOLOGICS_SPECIFIC,
        status=RequirementStatus.REQUIRED if ctx.modality in (
            Modality.MONOCLONAL_ANTIBODY, Modality.ANTIBODY_DRUG_CONJUGATE)
        else RequirementStatus.CONDITIONAL,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=s6, section="S6(R1) section 3.3",
        rationale="Recommended for monoclonal antibodies before first human dosing",
        glp=True, ctd_section="4.2.3.7.7",
    ))
    n_species = len(species)
    sp_note = (
        "one relevant species identified: a single-species programme is acceptable"
        if n_species == 1 else
        "two relevant species: short-term studies in both; longer studies may use one if "
        "findings are concordant"
        if n_species >= 2 else
        "relevant species not yet established"
    )
    out.append(_req(
        id="tox.repeat_dose", name="Repeat-dose toxicity in relevant species",
        category=StudyCategory.GENERAL_TOXICOLOGY, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=s6, section="S6(R1) section 4.4; Addendum section 3.2",
        rationale=f"Duration generally 1-3 months; 6 months supports chronic use ({sp_note})",
        glp=True, species=species, duration_weeks=26.0 if ctx.intended_clinical_duration_days > 91 else 13.0,
        driver_id="repeat_dose_toxicity", ctd_section="4.2.3.2",
        pending_fact=None if species else "pharmacologically relevant species",
    ))
    out.append(_req(
        id="bio.immunogenicity", name="Anti-drug antibody assessment in toxicity studies",
        category=StudyCategory.BIOLOGICS_SPECIFIC, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=s6, section="S6(R1) section 3.6; Addendum section 4",
        rationale="ADA must be measured to interpret exposure and findings; animal "
                  "immunogenicity does not predict human immunogenicity",
        glp=True, ctd_section="4.2.3.7.1",
    ))
    out.append(_req(
        id="safety.core_battery", name="Safety pharmacology endpoints (within tox studies)",
        category=StudyCategory.SAFETY_PHARMACOLOGY, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=s6, section="S6(R1) section 4.1",
        rationale="Safety pharmacology endpoints may be incorporated into toxicity studies",
        glp=True, ctd_section="4.2.1.3",
    ))
    out.append(_req(
        id="genotox.battery", name="Standard genotoxicity battery",
        category=StudyCategory.GENOTOXICITY,
        status=(RequirementStatus.CONDITIONAL if ctx.modality is Modality.ANTIBODY_DRUG_CONJUGATE
                else RequirementStatus.NOT_REQUIRED),
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=s6, section="S6(R1) section 4.7",
        rationale=("Not applicable to biotechnology-derived proteins; for ADCs the small-molecule "
                   "linker-payload is assessed for genotoxicity")
        if ctx.modality is Modality.ANTIBODY_DRUG_CONJUGATE else
        "The standard battery is not applicable to biotechnology-derived pharmaceuticals",
        glp=True, ctd_section="4.2.3.3",
        pending_fact="linker-payload genotoxicity data"
        if ctx.modality is Modality.ANTIBODY_DRUG_CONJUGATE else None,
    ))
    out.append(_req(
        id="carc.bioassay", name="Rodent carcinogenicity bioassay",
        category=StudyCategory.CARCINOGENICITY, status=RequirementStatus.NOT_REQUIRED,
        timing=Timing.MARKETING, citation=s6, section="S6(R1) section 4.8; Addendum section 6",
        rationale="Standard bioassays are generally inappropriate; carcinogenic potential is "
                  "addressed by a product-specific weight-of-evidence assessment",
        glp=False,
    ))
    out.append(_req(
        id="dart.biologic", name="Reproductive toxicity in a relevant species (ePPND if NHP-only)",
        category=StudyCategory.REPRODUCTIVE_TOXICOLOGY, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_PHASE_3, citation=s6, section="S6(R1) Addendum section 5",
        rationale="Conducted in a pharmacologically relevant species; where only NHP are "
                  "relevant an enhanced pre/postnatal study can replace separate EFD/PPND",
        glp=True, ctd_section="4.2.3.5",
    ))
    if ctx.is_immunomodulatory_agonist:
        out.append(_req(
            id="bio.cytokine_release", name="In vitro cytokine release assay (human cells)",
            category=StudyCategory.BIOLOGICS_SPECIFIC, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=cite("ema_fih_2017"),
            section="EMA FIH Rev. 1 sections 6.3, 7.2",
            rationale="Immune agonists require human in vitro data to identify cytokine release "
                      "risk and to inform a MABEL-based starting dose",
            glp=False, ctd_section="4.2.1.1",
        ))
    return out


def _advanced_therapy_rules(ctx: ProgramContext) -> list[StudyRequirement]:
    m3 = cite("fda_cber_cgt_2013")  # ATMP requirements derive from the CBER guidance
    out: list[StudyRequirement] = []
    out.append(_req(
        id="atmp.biodistribution", name="Biodistribution including germline tissues",
        category=StudyCategory.ADVANCED_THERAPY_SPECIFIC, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3,
        section="FDA CBER CGT preclinical guidance (2013)",
        rationale="Distribution and persistence in target and non-target tissues, body fluids "
                  "and gonads must be characterised before first human dosing",
        glp=True,
    ))
    out.append(_req(
        id="atmp.tumorigenicity", name="Tumorigenicity assessment with the clinical product",
        category=StudyCategory.ADVANCED_THERAPY_SPECIFIC,
        status=RequirementStatus.REQUIRED if ctx.modality is Modality.CELL_THERAPY
        else RequirementStatus.CONDITIONAL,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3,
        section="FDA CBER CGT preclinical guidance (2013)",
        rationale="Uses the clinical product at the maximum feasible dose by the clinical route",
        glp=True,
    ))
    if ctx.is_integrating_vector is None:
        out.append(_req(
            id="atmp.insertional_mutagenesis", name="Insertional mutagenesis assessment",
            category=StudyCategory.ADVANCED_THERAPY_SPECIFIC, status=RequirementStatus.CONDITIONAL,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3,
            section="FDA CBER CGT preclinical guidance (2013)",
            rationale="Required for integrating vectors",
            glp=True, pending_fact="whether the vector integrates",
        ))
    elif ctx.is_integrating_vector:
        out.append(_req(
            id="atmp.insertional_mutagenesis", name="Insertional mutagenesis assessment",
            category=StudyCategory.ADVANCED_THERAPY_SPECIFIC, status=RequirementStatus.REQUIRED,
            timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3,
            section="FDA CBER CGT preclinical guidance (2013)",
            rationale="Integrating vector",
            glp=True,
        ))
    out.append(_req(
        id="atmp.species_relevance", name="Species-relevance assessment submitted in the IND",
        category=StudyCategory.ADVANCED_THERAPY_SPECIFIC, status=RequirementStatus.REQUIRED,
        timing=Timing.BEFORE_FIRST_IN_HUMAN, citation=m3,
        section="FDA CBER CGT preclinical guidance (2013)",
        rationale="Biologically responsive species and disease models are preferred over "
                  "healthy animals and standard tox species",
        glp=False,
    ))
    return out


def derive_study_set(ctx: ProgramContext) -> StudySet:
    """Derive the full nonclinical study set for a programme."""
    notes: list[str] = []
    governing: list[Citation] = [cite("ich_m3r2")]

    if ctx.modality.is_advanced_therapy:
        reqs = _advanced_therapy_rules(ctx)
        governing = [cite("fda_cber_cgt_2013")]
        notes.append(
            "Cell and gene therapies fall outside ICH M3(R2); requirements follow FDA CBER and "
            "EMA ATMP guidance. A product-specific pre-IND (INTERACT) meeting is strongly advised."
        )
    elif ctx.modality.is_biotechnology_derived:
        reqs = _biologic_rules(ctx)
        governing.append(cite("ich_s6r1"))
        if ctx.modality is Modality.ANTIBODY_DRUG_CONJUGATE:
            notes.append(
                "ADCs: the conjugate is the primary test article; the linker-payload is assessed "
                "for genotoxicity and hERG separately."
            )
    else:
        reqs = _small_molecule_rules(ctx)
        governing.extend([cite("ich_s2r1"), cite("ich_s7a"), cite("ich_s7b")])

    if ctx.is_oncology_s9:
        governing.append(cite("ich_s9"))
        notes.append(
            "ICH S9 applies (advanced cancer): abbreviated package; starting dose from 1/10 "
            "rodent STD10 or 1/6 non-rodent HNSTD rather than the NOAEL."
        )

    reqs = sorted(reqs, key=lambda r: (r.timing.order, r.category.value, r.id))
    seen: set[str] = set()
    uniq: list[Citation] = []
    for c in governing:
        if c.key not in seen:
            seen.add(c.key)
            uniq.append(c)
    return StudySet(context=ctx, requirements=tuple(reqs), governing_guidelines=tuple(uniq),
                    notes=tuple(notes))
