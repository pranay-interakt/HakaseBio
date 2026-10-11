"""What a SEND export needs beyond the study record.

The study record supplies the design, the individual results, the Study Director's protocol
signature (study start date) and the toxicokinetic results. Everything else a SEND package
carries is stated here by the person exporting: sponsor and test-facility facts, controlled
terms for species, route and the like, the subject-level dates and dispositions, and the mapping
of each HOS endpoint to its SEND test code. No value is defaulted: an FDA-desired Trial Summary
parameter that cannot be given is entered with an ISO 21090 null flavor and a reason (TCG v6.3
4.1.3: TSVAL blank and TSVALNF filled).
"""

from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from hos.send.reference import term_check

__all__ = [
    "TS_CODELISTS",
    "TS_DERIVED",
    "TS_FDA_CONDITIONAL",
    "TS_FDA_DESIRED",
    "AnimalRecord",
    "EndpointMap",
    "NullValue",
    "PKMap",
    "SendExportSpec",
    "StudyFacts",
]

#: FDA Study Data Technical Conformance Guide v6.3, Appendix C: nonclinical TS parameters
#: marked "Y" (FDA desired) and "Conditional" (include when relevant to the design).
TS_FDA_DESIRED = (
    "AGEU",
    "DOSDUR",
    "DOSENDTC",
    "DOSSTDTC",
    "EXPENDTC",
    "EXPSTDTC",
    "GLPFL",
    "GLPTYP",
    "PCLASS",
    "PPTCNAM",
    "PPTEGID",
    "PPTEGSYM",
    "PPTMDA",
    "ROUTE",
    "SDESIGN",
    "SEXPOP",
    "SNDCTVER",
    "SNDIGVER",
    "SPECIES",
    "SPLANSUB",
    "SPLRNAM",
    "SPREFID",
    "SSPONSOR",
    "SSTYP",
    "STCAT",
    "STDIR",
    "STITLE",
    "STRAIN",
    "STRPSTAT",
    "STSTDTC",
    "TFCNTRY",
    "TRMSAC",
    "TRT",
    "TRTCAS",
    "TRTUNII",
    "TRTV",
    "TSTFLOC",
    "TSTFNAM",
)
TS_FDA_CONDITIONAL = ("ASOCSTDY", "INTSAC", "PDOSFRQ", "RECSAC", "SBSTRAIN", "STENDTC")

#: TS parameters HOS fills from the study record (STSTDTC and STDIR from the Study Director's
#: protocol signature, GLPFL, SEXPOP and SPLANSUB from the design, the standards versions) and
#: from the export facts below. They cannot be entered again as free ``values``.
TS_DERIVED = (
    "AGE",
    "AGETXT",
    "AGEU",
    "DOSDUR",
    "DOSENDTC",
    "DOSSTDTC",
    "EXPENDTC",
    "EXPSTDTC",
    "GLPFL",
    "GLPTYP",
    "PDOSFRQ",
    "RECSAC",
    "ROUTE",
    "SDESIGN",
    "SEXPOP",
    "SNDCTVER",
    "SNDIGVER",
    "SPECIES",
    "SPLANSUB",
    "SPREFID",
    "SSPONSOR",
    "SSTYP",
    "STCAT",
    "STDIR",
    "STITLE",
    "STRAIN",
    "STRPSTAT",
    "STSTDTC",
    "TFCNTRY",
    "TRMSAC",
    "TRT",
    "TRTV",
    "TSTFLOC",
    "TSTFNAM",
)

#: TS parameters whose values HOS checks against a SEND CT codelist. The pairing is HOS's: the
#: codelist's name is the parameter's subject (the SENDIG appendix that pairs them is behind a
#: CDISC login). A miss on an extensible list is a warning; on a non-extensible one, an error.
TS_CODELISTS = {
    "SPECIES": "C77808",
    "STRAIN": "C77530",
    "ROUTE": "C66729",
    "AGEU": "C66781",
    "SEXPOP": "C66732",
    "GLPFL": "C66742",
    "GLPTYP": "C225357",
    "SSTYP": "C90003",
    "SDESIGN": "C89967",
    "STRPSTAT": "C158125",
    "SNDIGVER": "C89982",
    "TFCNTRY": "C66786",
    "STCAT": "C90002",
    "PDOSFRQ": "C71113",
}

#: ISO 21090 null flavors (TSVALNF uses the "ISO 21090 NullFlavor enumeration").
NULL_FLAVORS = ("NI", "INV", "OTH", "UNK", "ASKU", "NAV", "NASK", "MSK", "NA", "NP")

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_DURATION = re.compile(r"^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$")


def _date(v: str) -> str:
    if not _ISO_DATE.match(v):
        raise ValueError(f"{v!r} is not an ISO 8601 date (YYYY-MM-DD)")
    date.fromisoformat(v)
    return v


class NullValue(BaseModel):
    flavor: Literal["NI", "INV", "OTH", "UNK", "ASKU", "NAV", "NASK", "MSK", "NA", "NP"]
    reason: str = Field(min_length=1)


class StudyFacts(BaseModel):
    """Trial Summary facts not held in the study record."""

    studyid: str = Field(
        pattern=r"^[A-Za-z0-9_\-]{1,40}$",
        description="sponsor study identifier (the eCTD STF study-id)",
    )
    test_facility_study_id: str = Field(
        min_length=1, description="SPREFID; define.xml ProtocolName (TCG 4.1.3)"
    )
    study_title: str = Field(min_length=1)
    sponsor: str = Field(min_length=1)
    test_facility: str = Field(min_length=1)
    test_facility_location: str = Field(min_length=1)
    test_facility_country: str = Field(description="COUNTRY codelist (ISO 3166 alpha-3)")
    study_type: str = Field(description="SSTYP codelist, e.g. REPEAT DOSE TOXICITY")
    study_category: str = Field(description="STCAT codelist")
    design: str = Field(description="DESIGN codelist, e.g. PARALLEL")
    report_status: str = Field(description="STRPSTAT codelist")
    glp_type: str | None = Field(default=None, description="GLPTYP codelist; for GLP studies")
    species: str = Field(description="SPECIES codelist, e.g. RAT")
    strain: str = Field(description="STRAIN codelist, e.g. SPRAGUE-DAWLEY")
    age: float | None = Field(default=None, gt=0)
    age_text: str | None = Field(default=None, description="range form 'n-n'")
    age_unit: str = Field(description="AGEU codelist")
    route: str = Field(description="ROUTE codelist")
    dose_form: str = Field(description="FRM codelist")
    dosing_frequency: str = Field(description="FREQ codelist, e.g. QD")
    test_article: str = Field(min_length=1, description="TRT")
    vehicle: str = Field(min_length=1, description="TRTV")
    test_article_lot: str = Field(min_length=1)
    dosing_start: str
    dosing_end: str
    experimental_start: str
    experimental_end: str
    dosing_duration: str = Field(description="DOSDUR, ISO 8601 duration; excludes recovery")
    terminal_sacrifice: str = Field(description="TRMSAC, ISO 8601 duration")
    recovery_sacrifice: str | None = Field(default=None, description="RECSAC, if recovery")
    values: dict[str, str] = Field(
        default_factory=dict,
        description="other TS parameters (e.g. TRTCAS, TRTUNII, PCLASS, PPTCNAM, SPLRNAM)",
    )
    null_values: dict[str, NullValue] = Field(default_factory=dict)

    @field_validator("dosing_start", "dosing_end", "experimental_start", "experimental_end")
    @classmethod
    def _iso(cls, v: str) -> str:
        return _date(v)

    @field_validator("dosing_duration", "terminal_sacrifice", "recovery_sacrifice")
    @classmethod
    def _dur(cls, v: str | None) -> str | None:
        if v is not None and not _ISO_DURATION.match(v):
            raise ValueError(f"{v!r} is not an ISO 8601 duration (e.g. P28D)")
        return v

    @model_validator(mode="after")
    def _check(self) -> StudyFacts:
        errs = []
        if (self.age is None) == (self.age_text is None):
            errs.append("give AGE or AGETXT, not both (TCG v6.3 Appendix C)")
        for field, code in (
            ("species", "C77808"),
            ("strain", "C77530"),
            ("route", "C66729"),
            ("age_unit", "C66781"),
            ("test_facility_country", "C66786"),
            ("study_type", "C90003"),
            ("study_category", "C90002"),
            ("design", "C89967"),
            ("report_status", "C158125"),
            ("dose_form", "C66726"),
            ("dosing_frequency", "C71113"),
        ):
            msg = term_check(code, getattr(self, field))
            if msg and "non-extensible" in msg:
                errs.append(f"{field}: {msg}")
        if (
            self.glp_type is not None
            and (m := term_check("C225357", self.glp_type))
            and "non-extensible" in m
        ):
            errs.append(f"glp_type: {m}")
        derived = sorted(set(self.values) & set(TS_DERIVED))
        if derived:
            errs.append(f"TS parameters {derived} come from the study record or these facts")
        both = set(self.values) & set(self.null_values)
        if both:
            errs.append(f"TS parameters both valued and null: {sorted(both)}")
        if errs:
            raise ValueError("; ".join(errs))
        return self


class AnimalRecord(BaseModel):
    subject_id: str = Field(min_length=1)
    first_dose_date: str = Field(description="RFSTDTC / EXSTDTC")
    last_dose_date: str = Field(description="EXENDTC")
    end_date: str = Field(description="RFENDTC")
    disposition: str = Field(description="DSDECOD (non-extensible codelist)")
    disposition_term: str = Field(min_length=1, description="DSTERM as recorded")
    disposition_date: str = Field(description="DSSTDTC")
    disposition_nominal_day: int | None = None
    unscheduled: bool

    @field_validator("first_dose_date", "last_dose_date", "end_date", "disposition_date")
    @classmethod
    def _iso(cls, v: str) -> str:
        return _date(v)

    @field_validator("disposition")
    @classmethod
    def _ds(cls, v: str) -> str:
        if msg := term_check("C89968", v):
            raise ValueError(msg)
        return v


class EndpointMap(BaseModel):
    domain: Literal["BW", "FW", "LB", "OM"]
    testcd: str = Field(
        pattern=r"^[A-Z][A-Z0-9_]{0,7}$",
        description="TCG 4.1.3: at most 8 characters, not starting with a "
        "number, letters, digits and underscores",
    )
    test: str = Field(min_length=1, max_length=40)
    unit: str = Field(description="UNIT codelist term for the reported unit")
    category: str | None = Field(default=None, description="LBCAT (SEND Laboratory Test Category)")
    specimen: str | None = Field(default=None, description="SPEC codelist; LB and OM")

    @model_validator(mode="after")
    def _check(self) -> EndpointMap:
        if self.domain in ("LB", "OM") and not self.specimen:
            raise ValueError(f"{self.domain} needs the specimen")
        if self.domain == "LB" and not self.category:
            raise ValueError("LB needs its category")
        return self


class PKMap(BaseModel):
    """Toxicokinetic study to include as PC/PP, with its SEND terms."""

    tk_study_id: str
    analyte_testcd: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,7}$")
    analyte_test: str = Field(min_length=1, max_length=40)
    specimen: str = Field(description="SPEC codelist")
    concentration_unit: str = Field(description="PK units codelist (C85494)")
    auc_unit: str = Field(description="PK units codelist (C85494), e.g. h*ng/mL")
    time_unit: str = Field(description="PK units codelist (C85494), e.g. h")
    animals: list[AnimalRecord] = Field(min_length=1)


class SendExportSpec(BaseModel):
    facts: StudyFacts
    animals: list[AnimalRecord] = Field(min_length=1)
    endpoints: dict[str, EndpointMap] = Field(min_length=1)
    timepoints: dict[str, int] = Field(
        min_length=1, description="timepoint label -> nominal study day, dosing-phase records"
    )
    recovery_timepoints: dict[str, int] = Field(
        default_factory=dict,
        description="timepoint label -> nominal study day for "
        "recovery-phase records (the protocol labels are shared by both phases; a recovery "
        "animal's terminal measurement falls at the end of recovery)",
    )
    baseline_timepoint: str | None = None
    pk: PKMap | None = None

    @model_validator(mode="after")
    def _check(self) -> SendExportSpec:
        if self.baseline_timepoint and self.baseline_timepoint not in self.timepoints:
            raise ValueError("the baseline timepoint must be one of the timepoints")
        ids = [a.subject_id for a in self.animals]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate subject ids")
        return self
