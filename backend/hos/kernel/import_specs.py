"""What must be transcribed from a report when a study is imported (docs/14 P1).

Each requirement of the derived study set names the key results an imported report must
supply before the import can be signed. These are transcription fields, not scientific
values: the numbers themselves come from the report, each with a page or table reference.
Requirements without a specific schema accept any transcribed result but need at least one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

__all__ = ["GENERIC_FIELD", "ImportField", "import_fields"]


@dataclass(frozen=True, slots=True)
class ImportField:
    key: str
    label: str
    value_type: str  # "quantity" | "categorical"
    unit: str | None = None
    choices: tuple[str, ...] = ()
    required: bool = True
    needs_species: bool = False
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "label": self.label, "value_type": self.value_type,
                "unit": self.unit, "choices": list(self.choices), "required": self.required,
                "needs_species": self.needs_species, "note": self.note}


_NOAEL = ImportField(
    "noael", "NOAEL", "quantity", unit="mg/kg/day", needs_species=True,
    note="as concluded in the report (FDA 2005 glossary definition); record one per species, "
         "and per sex if the report gives sex-specific NOAELs")
_GENOTOX = ImportField(
    "overall_call", "Overall result", "categorical",
    choices=("positive", "negative", "equivocal"),
    note="the report's conclusion for the assay")
_CONCLUSION = ImportField(
    "overall_conclusion", "Overall conclusion", "categorical",
    choices=("no_effect_identified", "effect_identified"),
    note="the report's conclusion; transcribe the dose-level detail as further results")

#: Accepted for any requirement: any transcribed quantity or categorical result.
GENERIC_FIELD = ImportField("result", "Transcribed result", "quantity", required=False,
                            note="any additional result, with its own key and label")

_SPECS: dict[str, tuple[ImportField, ...]] = {
    "tox.repeat_dose_rodent": (_NOAEL,),
    "tox.repeat_dose_nonrodent": (_NOAEL,),
    "tox.repeat_dose": (_NOAEL,),
    "tox.repeat_dose_marketing": (_NOAEL,),
    "tox.juvenile": (_NOAEL,),
    "tox.dose_range_finding": (
        ImportField("mtd", "Maximum tolerated dose", "quantity", unit="mg/kg/day",
                    needs_species=True, note="as concluded in the report"),),
    "safety.herg": (
        ImportField("herg_ic50", "hERG IC50", "quantity", unit="uM",
                    note="as reported; record the units used in the report"),),
    "safety.core_battery": (_CONCLUSION,),
    "safety.in_vivo_qt": (_CONCLUSION,),
    "genotox.ames": (_GENOTOX,),
    "genotox.chromosomal": (_GENOTOX,),
    "genotox.full_battery": (_GENOTOX,),
    "genotox.battery": (_GENOTOX,),
    "carc.bioassay": (
        ImportField("carcinogenic_potential", "Carcinogenicity conclusion", "categorical",
                    choices=("positive", "negative", "equivocal")),),
    "dart.efd": (_NOAEL,),
    "dart.fertility": (_NOAEL,),
    "dart.ppnd": (_NOAEL,),
    "dart.biologic": (_NOAEL,),
}


def import_fields(requirement_id: str) -> tuple[ImportField, ...]:
    """Required transcription fields for a requirement (empty: at least one result)."""
    return _SPECS.get(requirement_id, ())
