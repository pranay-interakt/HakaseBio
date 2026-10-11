"""CTD Module 2.4 nonclinical overview and 2.6 nonclinical written and tabulated summaries,
drafted from a programme's approved and imported studies (docs/14 P6).

Structure: ICH M4S(R2), Step 4, 20 December 2002 (citation ``ich_m4s_r2``). The section
sequence of 2.4 and 2.6 and the Appendix B table numbers and titles below are transcribed from
the official guideline.

What the system drafts, and what it leaves to a person:

* **Tabulated summaries** (2.6.3, 2.6.5, 2.6.7) are filled from the studies. Descriptive cells
  come from each driver's validated parameters (``StudyDriver.summary_facts``); numeric cells
  reference the study's stored result quantities (``StudyDriver.summary_tables``); signed expert
  determinations appear as signed. Every number carries its source: the study and quantity key
  for a driver-run study, the report page for an imported one.
* **Written summaries** (2.6.1, 2.6.2, 2.6.4, 2.6.6) and the **overview** (2.4) follow the
  guideline's order. The system drafts factual sentences only, each citing its table and study
  in the form M4S(R2) asks for, "(Table X.X, Study/Report Number)". Interpretation, discussion
  and conclusions belong to the author: those sections stay empty until a person writes them,
  and a version cannot be signed while one is empty.

Only approved studies with admissible (non-simulated) data and completed imports are used;
other studies are listed as excluded, with the reason.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from hos.core.citations import CITATIONS
from hos.core.regulatory import ProgramContext
from hos.drivers.base import SummaryFacts, ValueRef
from hos.ind.ctd import ctd_sort_key, ctd_title
from hos.kernel.lifecycle import StudyState

__all__ = ["SECTIONS", "TABLES", "build_summaries", "render_markdown"]

#: Appendix B tables (M4S(R2) Appendix B, "The Nonclinical Tabulated Summaries - Templates").
TABLES: dict[str, str] = {
    "2.6.3.1": "Pharmacology: Overview",
    "2.6.3.2": "Primary Pharmacodynamics",
    "2.6.3.3": "Secondary Pharmacodynamics",
    "2.6.3.4": "Safety Pharmacology",
    "2.6.3.5": "Pharmacodynamic Drug Interactions",
    "2.6.5.1": "Pharmacokinetics: Overview",
    "2.6.5.2": "Analytical Methods and Validation Reports",
    "2.6.5.3": "Pharmacokinetics: Absorption after a Single Dose",
    "2.6.5.4": "Pharmacokinetics: Absorption after Repeated Doses",
    "2.6.5.5": "Pharmacokinetics: Organ Distribution",
    "2.6.5.6": "Pharmacokinetics: Plasma Protein Binding",
    "2.6.5.7": "Pharmacokinetics: Study in Pregnant or Nursing Animals",
    "2.6.5.8": "Pharmacokinetics: Other Distribution Study",
    "2.6.5.9": "Pharmacokinetics: Metabolism In Vivo",
    "2.6.5.10": "Pharmacokinetics: Metabolism In Vitro",
    "2.6.5.11": "Pharmacokinetics: Possible Metabolic Pathways",
    "2.6.5.12": "Pharmacokinetics: Induction/Inhibition of Drug-Metabolizing Enzymes",
    "2.6.5.13": "Pharmacokinetics: Excretion",
    "2.6.5.14": "Pharmacokinetics: Excretion into Bile",
    "2.6.5.15": "Pharmacokinetics: Drug-Drug Interactions",
    "2.6.5.16": "Pharmacokinetics: Other",
    "2.6.7.1": "Toxicology: Overview",
    "2.6.7.2": "Toxicokinetics: Overview of Toxicokinetics Studies",
    "2.6.7.3": "Toxicokinetics: Overview of Toxicokinetics Data",
    "2.6.7.4": "Toxicology: Drug Substance",
    "2.6.7.5": "Single-Dose Toxicity",
    "2.6.7.6": "Repeat-Dose Toxicity: Non-Pivotal Studies",
    "2.6.7.7": "Repeat-Dose Toxicity: Pivotal Studies",
    "2.6.7.8": "Genotoxicity: In Vitro",
    "2.6.7.9": "Genotoxicity: In Vivo",
    "2.6.7.10": "Carcinogenicity",
    "2.6.7.11": "Reproductive and Developmental Toxicity: Non-Pivotal Studies",
    "2.6.7.12": "Reproductive and Developmental Toxicity – Fertility and Early Embryonic "  # noqa: RUF001 (the guideline's dash)
    "Development to Implantation (Pivotal)",
    "2.6.7.13": "Reproductive and Developmental Toxicity – Effects on Embryo-Fetal Development "  # noqa: RUF001 (the guideline's dash)
    "(Pivotal)",
    "2.6.7.14": "Reproductive and Developmental Toxicity – Effects on Pre- and Postnatal "  # noqa: RUF001 (the guideline's dash)
    "Development, Including Maternal Function (Pivotal)",
    "2.6.7.15": "Studies in Juvenile Animals",
    "2.6.7.16": "Local Tolerance",
    "2.6.7.17": "Other Toxicity Studies",
}

#: (id, title, author writes it) in the guideline's order. 2.4's parts are its "Content and
#: Structural Format" sequence; they carry no numbers in M4S(R2), so their ids are named.
SECTIONS: tuple[tuple[str, str, bool], ...] = (
    ("2.4.strategy", "Overview of the nonclinical testing strategy", True),
    ("2.4.pharmacology", "Pharmacology", True),
    ("2.4.pharmacokinetics", "Pharmacokinetics", True),
    ("2.4.toxicology", "Toxicology", True),
    ("2.4.integrated", "Integrated overview and conclusions", True),
    ("2.4.references", "List of literature references", False),
    ("2.6.1", "Introduction", False),
    ("2.6.2.1", "Brief Summary", True),
    ("2.6.2.2", "Primary Pharmacodynamics", False),
    ("2.6.2.3", "Secondary Pharmacodynamics", False),
    ("2.6.2.4", "Safety Pharmacology", False),
    ("2.6.2.5", "Pharmacodynamic Drug Interactions", False),
    ("2.6.2.6", "Discussion and Conclusions", True),
    ("2.6.2.7", "Tables and Figures", False),
    ("2.6.4.1", "Brief Summary", True),
    ("2.6.4.2", "Methods of Analysis", False),
    ("2.6.4.3", "Absorption", False),
    ("2.6.4.4", "Distribution", False),
    ("2.6.4.5", "Metabolism (interspecies comparison)", False),
    ("2.6.4.6", "Excretion", False),
    ("2.6.4.7", "Pharmacokinetic Drug Interactions", False),
    ("2.6.4.8", "Other Pharmacokinetic Studies", False),
    ("2.6.4.9", "Discussion and Conclusions", True),
    ("2.6.4.10", "Tables and Figures", False),
    ("2.6.6.1", "Brief Summary", True),
    ("2.6.6.2", "Single-Dose Toxicity", False),
    ("2.6.6.3", "Repeat-Dose Toxicity (including supportive toxicokinetics evaluation)", False),
    ("2.6.6.4", "Genotoxicity", False),
    ("2.6.6.5", "Carcinogenicity (including supportive toxicokinetics evaluations)", False),
    (
        "2.6.6.6",
        "Reproductive and Developmental Toxicity (including range-finding studies and "
        "supportive toxicokinetics evaluations)",
        False,
    ),
    ("2.6.6.7", "Local Tolerance", False),
    ("2.6.6.8", "Other Toxicity Studies (if available)", False),
    ("2.6.6.9", "Discussion and Conclusions", True),
    ("2.6.6.10", "Tables and Figures", False),
)

#: Module 4 section -> the written-summary section that summarises it (M4S(R2) 2.6.2-2.6.6).
_WRITTEN_FOR = (
    ("4.2.1.1", "2.6.2.2"),
    ("4.2.1.2", "2.6.2.3"),
    ("4.2.1.3", "2.6.2.4"),
    ("4.2.1.4", "2.6.2.5"),
    ("4.2.2.1", "2.6.4.2"),
    ("4.2.2.2", "2.6.4.3"),
    ("4.2.2.3", "2.6.4.4"),
    ("4.2.2.4", "2.6.4.5"),
    ("4.2.2.5", "2.6.4.6"),
    ("4.2.2.6", "2.6.4.7"),
    ("4.2.2.7", "2.6.4.8"),
    ("4.2.3.1", "2.6.6.2"),
    ("4.2.3.2", "2.6.6.3"),
    ("4.2.3.3", "2.6.6.4"),
    ("4.2.3.4", "2.6.6.5"),
    ("4.2.3.5", "2.6.6.6"),
    ("4.2.3.6", "2.6.6.7"),
    ("4.2.3.7", "2.6.6.8"),
)

#: What each table's empty state says, and the written sections that say "none" when empty.
_NONE_WRITTEN = {
    "2.6.2.3": "No secondary pharmacodynamic studies are included.",
    "2.6.2.5": "No pharmacodynamic drug-interaction studies are included.",
    "2.6.4.6": "No excretion studies are included.",
    "2.6.4.7": "No nonclinical pharmacokinetic drug-interaction studies are included.",
    "2.6.4.8": "No other pharmacokinetic studies are included.",
    "2.6.6.2": "No single-dose toxicity studies are included.",
    "2.6.6.5": "No carcinogenicity studies are included.",
    "2.6.6.6": "No reproductive or developmental toxicity studies are included.",
    "2.6.6.7": "No local tolerance studies are included.",
    "2.6.6.8": "No other toxicity studies are included.",
}


def _written_for(section: str) -> str | None:
    for prefix, written in _WRITTEN_FOR:
        if section == prefix or section.startswith(prefix + "."):
            return written
    return None


#: Module 4 section -> the Appendix B content table that holds a study of that type, where
#: the section determines it (others fall back to the overview table of their part).
_CONTENT_FOR = (
    ("4.2.1.1", "2.6.3.2"),
    ("4.2.1.2", "2.6.3.3"),
    ("4.2.1.3", "2.6.3.4"),
    ("4.2.1.4", "2.6.3.5"),
    ("4.2.2.1", "2.6.5.2"),
    ("4.2.2.5", "2.6.5.13"),
    ("4.2.2.6", "2.6.5.15"),
    ("4.2.2.7", "2.6.5.16"),
    ("4.2.3.1", "2.6.7.5"),
    ("4.2.3.3.1", "2.6.7.8"),
    ("4.2.3.3.2", "2.6.7.9"),
    ("4.2.3.4", "2.6.7.10"),
    ("4.2.3.6", "2.6.7.16"),
    ("4.2.3.7", "2.6.7.17"),
)


def _content_for(section: str, glp: bool) -> str:
    if section == "4.2.3.2":
        return "2.6.7.7" if glp else "2.6.7.6"
    for prefix, table in _CONTENT_FOR:
        if section == prefix or section.startswith(prefix + "."):
            return table
    return _overview_for(section)


def _study_type(section: str) -> str:
    """The Module 4 heading as a type of study: "Genotoxicity: In vitro" for 4.2.3.3.1."""
    if section.count(".") >= 4:
        return f"{ctd_title(section.rsplit('.', 1)[0])}: {ctd_title(section)}"
    return ctd_title(section)


def _short_cite(key: str) -> str:
    """A guideline's citation key as people write it: ich_m3r2 -> ICH M3(R2)."""
    m = re.fullmatch(r"ich_([a-z]+\d+[a-z]?)_?(r\d+)?", key)
    if m is None:
        return CITATIONS[key].text.split(":")[0] if key in CITATIONS else key
    return f"ICH {m.group(1).upper()}" + (f"({m.group(2).upper()})" if m.group(2) else "")


def _overview_for(section: str) -> str:
    return {"4.2.1": "2.6.3.1", "4.2.2": "2.6.5.1", "4.2.3": "2.6.7.1"}[section[:5]]


# ---- the studies a summary may use ---------------------------------------------------------


class _Source:
    """One included study, with everything the tables and sentences draw on."""

    def __init__(self, kernel: Any, row: Any) -> None:
        self.row = row
        self.id: str = row.id
        self.imported = row.origin == "import"
        rec = row.import_record or {}
        if self.imported:
            rep = rec["report"]
            self.section = rec["ctd_section"]
            self.title = rep["title"]
            self.facility = rep["laboratory"]
            self.number = rep.get("lab_study_number") or row.id
            self.facts: SummaryFacts | None = None
            self.tables: tuple[Any, ...] = ()
            self.references: list[dict[str, Any]] = []
        else:
            self.section = row.report["ctd_section"]
            self.title = row.report["title"]
            target = (row.execution or {}).get("target", {})
            self.facility = target.get("laboratory") or "—"
            self.number = row.id
            driver = kernel.registry.get(row.driver_id)
            params = driver.validate_parameters(row.parameters)
            self.facts = driver.summary_facts(params)
            self.tables = driver.summary_tables(params, row.results or {})
            self.references = list((row.protocol or {}).get("references", []))
        self.glp: bool = bool(row.glp)
        self.quantities: dict[str, Any] = (row.results or {}).get("quantities", {})
        analysis = (row.results or {}).get("analysis_hash")
        self.determinations = [
            d for d in row.determinations or [] if d.get("analysis_hash") == analysis
        ]
        self.statements = [
            s
            for s in (row.interpretation or {}).get("statements", [])
            if s.get("severity") in ("notable", "concern")
        ]
        self.values = [v for v in rec.get("values", []) if not v.get("withdrawn")]

    def listed_in(self) -> tuple[str, ...]:
        if self.facts is not None and self.facts.listed_in:
            return self.facts.listed_in
        tables = [_overview_for(self.section)]
        if self.section == "4.2.1.3":
            tables.append("2.6.3.4")
        return tuple(tables)

    def cite(self, table: str) -> str:
        """M4S(R2): "(Table X.X, Study/Report Number)"."""
        return f"(Table {table}, Study {self.number})"

    def study_cell(self) -> dict[str, Any]:
        return {"study": self.id, "text": self.number}

    def ref(self, key: str) -> dict[str, Any]:
        return {"quantity": self.quantities[key], "source": {"study_id": self.id, "key": key}}

    def fact(self, name: str) -> str | None:
        return None if self.facts is None else getattr(self.facts, name)


def _sources(kernel: Any, program_id: str) -> tuple[list[_Source], list[dict[str, str]]]:
    included: list[_Source] = []
    excluded: list[dict[str, str]] = []
    for s in kernel.repo.studies(program_id):
        if s.origin == "import":
            if s.state == StudyState.IMPORTED.value:
                included.append(_Source(kernel, s))
            elif s.state == StudyState.IMPORT_DRAFT.value:
                excluded.append(
                    {"study_id": s.id, "title": s.title, "reason": "import not completed"}
                )
            continue
        if s.state != StudyState.APPROVED.value:
            if s.state not in (StudyState.CANCELLED.value, StudyState.FAILED.value):
                excluded.append({"study_id": s.id, "title": s.title, "reason": "not approved"})
            continue
        if not s.evidence_admissible:
            excluded.append({"study_id": s.id, "title": s.title, "reason": "simulated data"})
            continue
        included.append(_Source(kernel, s))
    included.sort(key=lambda x: (ctd_sort_key(x.section), x.id))
    return included, excluded


# ---- tabulated summaries ---------------------------------------------------------------------


def _determination_cells(src: _Source, keys: Iterable[str] | None = None) -> list[Any]:
    want = set(keys) if keys is not None else None
    return [
        {
            "determination": {
                "key": d["key"],
                "label": d["label"],
                "quantity": d.get("quantity"),
                "category": d.get("category"),
                "signer": d["signer_name"],
                "role": d["role"],
                "signed_at": d["signed_at"],
            },
            "source": {"study_id": src.id, "key": d["key"]},
        }
        for d in src.determinations
        if want is None or d["key"] in want
    ]


def _findings(src: _Source) -> dict[str, Any]:
    """Noteworthy findings: the signed determinations and the cited rule statements flagged
    notable or of concern, as the study recorded them."""
    return {
        "findings": {
            "determinations": _determination_cells(src),
            "statements": [
                {"text": s["statement"], "basis": s["basis"], "severity": s["severity"]}
                for s in src.statements
            ],
        },
        "source": {"study_id": src.id},
    }


def _glp(src: _Source) -> str:
    return "Yes" if src.glp else "No"


def _overview_row(src: _Source, table: str) -> list[Any]:
    loc = src.section
    if table in ("2.6.3.1", "2.6.5.1"):
        return [
            _study_type(src.section),
            src.fact("test_system") or "as in the report",
            src.fact("method_of_administration") or "—",
            _glp(src),
            src.facility,
            src.study_cell(),
            loc,
        ]
    if table == "2.6.7.1":
        noael = _determination_cells(src, ("noael", "noael_male", "noael_female"))
        return [
            _study_type(src.section),
            src.fact("test_system") or "as in the report",
            src.fact("method_of_administration") or "—",
            src.fact("duration_of_dosing") or "—",
            src.fact("doses") or "—",
            {"cells": noael} if noael else "—",
            _glp(src),
            src.facility,
            src.study_cell(),
            loc,
        ]
    if table == "2.6.7.2":
        return [
            src.title,
            src.fact("test_system") or "as in the report",
            src.fact("method_of_administration") or "—",
            src.fact("doses") or "—",
            _glp(src),
            src.study_cell(),
            loc,
        ]
    if table == "2.6.3.4":
        return [
            src.fact("organ_systems") or _study_type(src.section),
            src.fact("test_system") or "as in the report",
            src.fact("method_of_administration") or "—",
            src.fact("doses") or "—",
            src.fact("gender_and_number") or "—",
            _findings(src),
            _glp(src),
            src.study_cell(),
        ]
    if table in ("2.6.7.6", "2.6.7.5", "2.6.7.16", "2.6.7.17"):
        noael = _determination_cells(src, ("noael", "noael_male", "noael_female", "mtd"))
        return [
            src.fact("test_system") or "as in the report",
            src.fact("method_of_administration") or "—",
            src.fact("duration_of_dosing") or "—",
            src.fact("doses") or "—",
            src.fact("gender_and_number") or "—",
            {"cells": noael} if noael else "—",
            _findings(src),
            src.study_cell(),
        ]
    raise KeyError(table)


_COLUMNS: dict[str, list[str]] = {
    "2.6.3.1": [
        "Type of Study",
        "Test System",
        "Method of Administration",
        "GLP",
        "Testing Facility",
        "Study Number",
        "Location (CTD section)",
    ],
    "2.6.5.1": [
        "Type of Study",
        "Test System",
        "Method of Administration",
        "GLP",
        "Testing Facility",
        "Study Number",
        "Location (CTD section)",
    ],
    "2.6.7.1": [
        "Type of Study",
        "Species and Strain",
        "Method of Administration",
        "Duration of Dosing",
        "Doses",
        "NOAEL (signed)",
        "GLP Compliance",
        "Testing Facility",
        "Study Number",
        "Location (CTD section)",
    ],
    "2.6.7.2": [
        "Type of Study",
        "Test System",
        "Method of Administration",
        "Doses",
        "GLP Compliance",
        "Study Number",
        "Location (CTD section)",
    ],
    "2.6.3.4": [
        "Organ Systems Evaluated",
        "Species/Strain",
        "Method of Admin.",
        "Doses",
        "Gender and No. per Group",
        "Noteworthy Findings",
        "GLP Compliance",
        "Study Number",
    ],
    "2.6.7.6": [
        "Species/Strain",
        "Method of Administration (Vehicle/Formulation)",
        "Duration of Dosing",
        "Doses",
        "Gender and No. per Group",
        "NOAEL / MTD (signed)",
        "Noteworthy Findings",
        "Study Number",
    ],
}

_NOTES: dict[str, list[str]] = {
    "2.6.3.1": ["A GLP column replaces the template's GLP footnote."],
    "2.6.5.1": ["A GLP column replaces the template's GLP footnote."],
    "2.6.7.1": [
        "The NOAEL column shows each repeat-dose study's NOAEL as the Study Director "
        "signed it, in place of underlining the highest NOAEL in the doses."
    ],
    "2.6.3.4": [
        "Noteworthy findings are the study's signed determinations and the cited rule "
        "statements it flagged as notable or of concern."
    ],
    "2.6.7.6": [
        "Noteworthy findings are the study's signed determinations and the cited rule "
        "statements it flagged as notable or of concern."
    ],
}


def _noael(src: _Source) -> dict[str, Any] | None:
    cells = _determination_cells(src, ("noael", "noael_male", "noael_female"))
    return {"cells": cells} if cells else None


def _pivotal_header(src: _Source) -> dict[str, Any]:
    """The header block of a pivotal repeat-dose table (template 2.6.7.7)."""
    return {
        "number": "2.6.7.7",
        "title": f"Repeat-Dose Toxicity: {src.title}",
        "columns": ["Item", "Entry"],
        "rows": [
            ["Species/Strain", src.fact("test_system") or "—"],
            ["Duration of Dosing", src.fact("duration_of_dosing") or "—"],
            [
                "Method of Administration (Vehicle/Formulation)",
                src.fact("method_of_administration") or "—",
            ],
            ["Doses", src.fact("doses") or "—"],
            ["Gender and No. per Group", src.fact("gender_and_number") or "—"],
            ["GLP Compliance", _glp(src)],
            ["No Observed Adverse-Effect Level", _noael(src) or "not determined"],
            ["Study No.", src.study_cell()],
            ["Location in CTD", src.section],
        ],
        "notes": [],
        "source": src.id,
    }


def _import_table(src: _Source) -> dict[str, Any]:
    return {
        "number": _content_for(src.section, src.glp),
        "title": f"Imported report: {src.title}",
        "columns": ["Result", "Species", "Sex", "Value", "Where in the report"],
        "rows": [
            [
                v["label"],
                v.get("species") or "—",
                v.get("sex") or "—",
                {
                    "imported": {"quantity": v.get("quantity"), "category": v.get("category")},
                    "source": {"study_id": src.id, "page": v["page"], "table": v.get("table")},
                },
                f"p. {v['page']}" + (f", table {v['table']}" if v.get("table") else ""),
            ]
            for v in src.values
        ],
        "notes": ["Transcribed from the report and attested; not recomputed."],
        "source": src.id,
    }


def _tables(sources: list[_Source]) -> list[dict[str, Any]]:
    generic: dict[str, list[list[Any]]] = defaultdict(list)
    for src in sources:
        for t in src.listed_in():
            if t == "2.6.7.7":
                continue
            generic[t].append(_overview_row(src, t))
    out: list[dict[str, Any]] = [
        {
            "number": t,
            "title": TABLES[t],
            "columns": _COLUMNS[t],
            "rows": rows,
            "notes": _NOTES.get(t, []),
            "source": None,
        }
        for t, rows in generic.items()
    ]
    for src in sources:
        if "2.6.7.7" in src.listed_in():
            out.append(_pivotal_header(src))
        for t in src.tables:
            out.append(
                {
                    "number": t.template,
                    "title": t.title,
                    "columns": list(t.columns),
                    "rows": [
                        [src.ref(c.key) if isinstance(c, ValueRef) else c for c in r]
                        for r in t.rows
                    ],
                    "notes": list(t.notes),
                    "source": src.id,
                }
            )
        if src.imported and src.values:
            out.append(_import_table(src))
    out.sort(key=lambda t: ctd_sort_key(t["number"]))
    return out


# ---- written summaries and overview -----------------------------------------------------------


def _para(*segments: Any, sources: Iterable[str] = ()) -> dict[str, Any]:
    """A drafted paragraph: text segments and value cells, with the studies it rests on."""
    return {"segments": [s for s in segments if s not in (None, "")], "sources": list(sources)}


def _study_sentence(src: _Source) -> dict[str, Any]:
    table = next((t for t in src.listed_in() if t != "2.6.7.1"), src.listed_in()[0])
    if src.imported:
        segs: list[Any] = [
            f"{src.title} ({src.facility}; {'GLP' if src.glp else 'non-GLP'}; imported report). "
        ]
        for v in src.values:
            segs += [
                f"{v['label']}"
                + (
                    f" ({v['species']}{', ' + v['sex'] if v.get('sex') else ''})"
                    if v.get("species")
                    else ""
                )
                + ": ",
                {
                    "imported": {"quantity": v.get("quantity"), "category": v.get("category")},
                    "source": {"study_id": src.id, "page": v["page"], "table": v.get("table")},
                },
                f" (report p. {v['page']}). ",
            ]
        segs.append(src.cite(table))
        return _para(*segs, sources=[src.id])
    parts = [
        p
        for p in (
            src.fact("test_system"),
            src.fact("method_of_administration"),
            src.fact("duration_of_dosing"),
            f"doses {src.fact('doses')}" if src.fact("doses") else None,
            src.fact("gender_and_number"),
        )
        if p
    ]
    segs = [f"{src.title}: " + "; ".join(parts) + f"; {'GLP' if src.glp else 'non-GLP'}. "]
    for d in _determination_cells(src):
        det = d["determination"]
        segs += [f"{det['label']}: ", d, f" (signed by {det['signer']}). "]
    for s in src.statements:
        segs.append(f"{s['statement']} ")
    segs.append(src.cite(table))
    return _para(*segs, sources=[src.id])


def _written(
    sources: list[_Source],
    ctx: ProgramContext,
    compounds: list[str],
    program: Any,
    readiness: dict[str, Any] | None,
) -> dict[str, list[dict[str, Any]]]:
    drafted: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_section: dict[str, list[_Source]] = defaultdict(list)
    for src in sources:
        w = _written_for(src.section)
        if w is not None:
            by_section[w].append(src)
    for section, srcs in by_section.items():
        drafted[section] = [_study_sentence(s) for s in srcs]
    for section, text in _NONE_WRITTEN.items():
        if not by_section.get(section):
            drafted[section] = [_para(text)]
    tox = [s for s in sources if s.section.startswith("4.2.3")]
    pharm = [s for s in sources if s.section.startswith("4.2.1")]
    pk = [s for s in sources if s.section.startswith("4.2.2")]

    drafted["2.6.1"] = [
        _para(
            f"Test article: {', '.join(compounds) or 'not registered'} "
            f"({ctx.modality.value.replace('_', ' ')}). Proposed clinical use: "
            f"{ctx.indication.value.replace('_', ' ')}, {ctx.route.value.replace('_', ' ')} route, "
            f"intended treatment duration {ctx.intended_clinical_duration_days} days; the longest "
            f"planned trial doses for {ctx.max_trial_duration_days} days (programme facts)."
        )
    ]
    for section, group, table in (
        ("2.6.2.1", pharm, "2.6.3.1"),
        ("2.6.4.1", pk, "2.6.5.1"),
        ("2.6.6.1", tox, "2.6.7.1"),
    ):
        drafted[section] = [
            _para(
                f"The package comprises {len(group)} stud{'y' if len(group) == 1 else 'ies'} "
                f"(Table {table})"
                + (": " + "; ".join(f"{s.title} {s.cite(table)}" for s in group) if group else "")
                + "."
            )
        ]
    if tox:
        glp = sum(1 for s in tox if s.glp)
        drafted["2.6.6.1"].append(
            _para(f"{glp} of the {len(tox)} toxicology studies were conducted under GLP.")
        )
    for section, table in (("2.6.2.7", "2.6.3"), ("2.6.4.10", "2.6.5"), ("2.6.6.10", "2.6.7")):
        drafted[section] = [_para(f"Tables are in the tabulated summary, section {table}.")]

    # 2.4: the facts the author's integrated assessment rests on
    guidelines = sorted(
        {_short_cite(c["key"]) for c in (program.study_set or {}).get("governing_guidelines", [])}
    )
    strategy = [
        _para(
            f"The programme's study set is derived from the programme facts under the governing "
            f"guidelines ({', '.join(guidelines) or 'none recorded'})."
        )
    ]
    if readiness is not None:
        s = readiness["summary"]
        strategy.append(
            _para(
                f"Of the {s['required_for_milestone']} studies required before first-in-human, "
                f"{s['covered']} are covered by approved or imported studies."
            )
        )
    if tox:
        strategy.append(
            _para(
                f"GLP status: {sum(1 for x in tox if x.glp)} of {len(tox)} toxicology studies "
                "were conducted under GLP."
            )
        )
    drafted["2.4.strategy"] = strategy
    for section, group, written in (
        ("2.4.pharmacology", pharm, "2.6.2"),
        ("2.4.pharmacokinetics", pk, "2.6.4"),
        ("2.4.toxicology", tox, "2.6.6"),
    ):
        paras = [_para(f"The studies are summarised in section {written}.")]
        for src in group:
            dets = _determination_cells(src)
            if dets:
                segs: list[Any] = [f"{src.title}: "]
                for d in dets:
                    segs += [f"{d['determination']['label']} ", d, "; "]
                segs.append(src.cite(src.listed_in()[0]))
                paras.append(_para(*segs, sources=[src.id]))
        drafted[section] = paras
    refs: dict[str, dict[str, Any]] = {}
    for src in sources:
        for r in src.references:
            refs[r["key"]] = r
    refs.setdefault("ich_m4s_r2", CITATIONS["ich_m4s_r2"].to_dict())
    drafted["2.4.references"] = [_para(r["text"]) for _, r in sorted(refs.items())]
    return drafted


def build_summaries(kernel: Any, program_id: str) -> dict[str, Any]:
    """The draft content of one version: tables, sections (drafted parts) and the studies
    used. Author text is merged in by the document service."""
    from hos.ind.assembler import readiness_report

    program = kernel.repo.program(program_id)
    ctx = ProgramContext.from_dict(program.context)
    sources, excluded = _sources(kernel, program_id)
    used = {s.row.compound_id for s in sources}
    compounds = [c.name for c in kernel.repo.compounds(program_id) if c.id in used]
    readiness = readiness_report(kernel, program_id)
    drafted = _written(sources, ctx, compounds, program, readiness)
    return {
        "standard": "ICH M4S(R2) Module 2.4 and 2.6",
        "program": {"id": program.id, "name": program.name},
        "test_article": compounds,
        "studies": [
            {
                "study_id": s.id,
                "title": s.title,
                "number": s.number,
                "section": s.section,
                "glp": s.glp,
                "imported": s.imported,
                "record_hash": s.row.report_hash,
            }
            for s in sources
        ],
        "excluded": excluded,
        "tables": _tables(sources),
        "sections": [
            {"id": sid, "title": title, "author_required": author, "drafted": drafted.get(sid, [])}
            for sid, title, author in SECTIONS
        ],
    }


# ---- markdown ---------------------------------------------------------------------------------


def _fmt_quantity(q: dict[str, Any] | None) -> str:
    if not q:
        return "—"
    if not q.get("available", True) or q.get("value") is None:
        return "unavailable"
    v = float(q["value"])
    shown = f"{v:.4g}"
    unit = q.get("unit", "")
    return shown if unit in ("", "dimensionless") else f"{shown} {unit}"


def _cell_md(c: Any) -> str:
    if c is None:
        return "—"
    if isinstance(c, dict):
        if "quantity" in c and "source" in c:
            return f"{_fmt_quantity(c['quantity'])} [{c['source']['study_id']}]"
        if "study" in c:
            return str(c["text"])
        if "determination" in c:
            d = c["determination"]
            val = _fmt_quantity(d["quantity"]) if d.get("quantity") else (d.get("category") or "—")
            return f"{val} (signed, {d['signer']})"
        if "imported" in c:
            i = c["imported"]
            val = _fmt_quantity(i["quantity"]) if i.get("quantity") else (i.get("category") or "—")
            return f"{val} [report p. {c['source']['page']}]"
        if "cells" in c:
            return "; ".join(_cell_md(x) for x in c["cells"]) or "—"
        if "findings" in c:
            f = c["findings"]
            parts = [_cell_md(d) for d in f["determinations"]]
            parts += [s["text"] for s in f["statements"]]
            return "; ".join(parts) or "none noted"
    return str(c).replace("|", "/")


def render_markdown(doc: dict[str, Any]) -> str:
    """One Markdown file: the 2.4 overview, then 2.6 in the guideline's order."""
    c = doc["content"]
    lines = [
        f"# Nonclinical overview and summaries: {c['program']['name']}",
        "",
        f"Version {doc['version']} · {doc['status']} · {c['standard']}",
        "",
    ]
    if doc.get("signatures"):
        for s in doc["signatures"]:
            lines.append(
                f"Signed by {s['signer_name']} ({s['role']}, {s['meaning']}) on "
                f"{s['signed_at']}: {s['statement']}"
            )
        lines.append("")
    heads = {
        "2.4": "2.4 Nonclinical Overview",
        "2.6.2": "2.6.2 Pharmacology Written Summary",
        "2.6.4": "2.6.4 Pharmacokinetics Written Summary",
        "2.6.6": "2.6.6 Toxicology Written Summary",
    }
    shown_heads: set[str] = set()
    for s in c["sections"]:
        group = "2.4" if s["id"].startswith("2.4") else ".".join(s["id"].split(".")[:3])
        if group in heads and group not in shown_heads:
            lines += [f"## {heads[group]}", ""]
            shown_heads.add(group)
        number = "" if s["id"].startswith("2.4.") else s["id"] + " "
        lines += [f"### {number}{s['title']}", ""]
        for p in s["drafted"]:
            lines.append(
                "".join(_cell_md(x) if isinstance(x, dict) else str(x) for x in p["segments"])
            )
            lines.append("")
        if s.get("author_text"):
            lines += [s["author_text"], ""]
        elif s["author_required"]:
            lines += ["*Author's text not yet written.*", ""]
        nxt = {"2.6.2.7": "2.6.3", "2.6.4.10": "2.6.5", "2.6.6.10": "2.6.7"}.get(s["id"])
        if nxt:
            title = {"2.6.3": "Pharmacology", "2.6.5": "Pharmacokinetics", "2.6.7": "Toxicology"}[
                nxt
            ]
            lines += [f"## {nxt} {title} Tabulated Summary", ""]
            for t in [t for t in c["tables"] if t["number"].startswith(nxt + ".")]:
                lines += [f"#### Table {t['number']} {t['title']}", ""]
                lines.append("| " + " | ".join(col or " " for col in t["columns"]) + " |")
                lines.append("|" + "---|" * len(t["columns"]))
                for r in t["rows"]:
                    lines.append("| " + " | ".join(_cell_md(x) for x in r) + " |")
                lines.append("")
                for n in t["notes"]:
                    lines += [f"*{n}*", ""]
    if c["excluded"]:
        lines += ["## Studies not used", ""]
        for e in c["excluded"]:
            lines.append(f"- {e['title']} ({e['study_id']}): {e['reason']}")
        lines.append("")
    return "\n".join(lines)
