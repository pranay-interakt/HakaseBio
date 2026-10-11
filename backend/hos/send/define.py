"""Define-XML 2.1 for a SEND package, validated against CDISC's Define-XML 2.1 schema.

The schema files are CDISC's own (hos/send/schemas, from cdisc-org/data-definition-engine; the
CDISC package page needs a login). One ItemGroupDef per dataset with its SENDIG structure,
class, key variables and leaf (the .xpt file); one ItemDef per variable with its SAS name,
length and origin; one CodeList per SEND CT codelist used, listing the values present with
their NCI C-codes (sponsor values in an extensible codelist are marked ExtendedValue). The
FDA wants StudyName to be the sponsor's study identifier and ProtocolName the test facility's
study identifier (TCG v6.3 4.1.3), and define2-1.xsl placed next to define.xml (TCG 4.1.4.5).
"""

from __future__ import annotations

from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape, quoteattr

import xmlschema

from hos.send.domains import Domain
from hos.send.reference import CT_VERSION, SENDIG_VERSION, ct

__all__ = ["CLASS_NAMES", "build_define", "validate_define"]

SCHEMA = Path(__file__).parent / "schemas" / "define" / "2.1" / "define2-1-0.xsd"
CLASS_NAMES = {
    "Findings": "FINDINGS",
    "Special-Purpose": "SPECIAL PURPOSE",
    "Trial Design": "TRIAL DESIGN",
    "Interventions": "INTERVENTIONS",
    "Events": "EVENTS",
}
_ASSIGNED = ("STUDYID", "DOMAIN", "USUBJID", "SUBJID", "SETCD", "SET", "ARMCD")
_KEYS = {
    "TS": ("STUDYID", "TSPARMCD", "TSSEQ"),
    "TX": ("STUDYID", "SETCD", "TXPARMCD"),
    "DM": ("STUDYID", "USUBJID"),
}


@lru_cache(maxsize=1)
def _schema() -> xmlschema.XMLSchema:
    return xmlschema.XMLSchema(str(SCHEMA))


def _origin(domain: str, var: str, overrides: dict[str, str]) -> tuple[str, str | None]:
    if (
        var in _ASSIGNED
        or var.endswith(("SEQ", "TESTCD", "PARMCD", "PARM"))
        or var.endswith("TEST")
        or var == f"{domain}CAT"
    ):
        return "Assigned", "Sponsor"
    if domain in ("TS", "TX", "EX"):
        return "Protocol", None
    if domain == "PP" or var.endswith(("STRESC", "STRESN", "STRESU")):
        return "Derived", None
    return "Collected", "Vendor"


def _datatype(var: Any, values: list[Any]) -> str:
    present = [v for v in values if v is not None]
    if var.type == "Num":
        return "integer" if present and all(float(v).is_integer() for v in present) else "float"
    if var.format == "ISO 8601" and present and all(len(str(v)) == 10 for v in present):
        return "date"
    return "text"


def build_define(
    domains: dict[str, Domain],
    lengths: dict[str, int],
    *,
    studyid: str,
    protocol_name: str,
    description: str,
    created: str,
    origins: dict[str, str],
) -> str:
    """The define.xml text. ``lengths`` are the character lengths written to the .xpt files."""
    codelists: dict[str, set[str]] = defaultdict(set)
    cl_of: dict[str, str] = {}
    out: list[str] = []
    w = out.append
    w('<?xml version="1.0" encoding="UTF-8"?>')
    w('<?xml-stylesheet type="text/xsl" href="define2-1.xsl"?>')
    w(
        f'<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'xmlns:def="http://www.cdisc.org/ns/def/v2.1" ODMVersion="1.3.2" FileType="Snapshot" '
        f'FileOID={quoteattr("DEF." + studyid)} CreationDateTime="{created}" '
        f'Originator="Hakase OS" SourceSystem="hos" SourceSystemVersion="0.1" '
        f'def:Context="Submission">'
    )
    w(
        f"<Study OID={quoteattr('ST.' + studyid)}><GlobalVariables>"
        f"<StudyName>{escape(studyid)}</StudyName>"
        f"<StudyDescription>{escape(description)}</StudyDescription>"
        f"<ProtocolName>{escape(protocol_name)}</ProtocolName></GlobalVariables>"
    )
    w(
        f'<MetaDataVersion OID={quoteattr("MDV." + studyid)} Name="SEND data definitions" '
        f'def:DefineVersion="2.1.0">'
    )
    w(
        "<def:Standards>"
        f'<def:Standard OID="STD.SENDIG" Name="SENDIG" Type="IG" Version="{SENDIG_VERSION}" '
        'Status="Final"/>'
        f'<def:Standard OID="STD.SENDCT" Name="CDISC/NCI" Type="CT" PublishingSet="SEND" '
        f'Version="{CT_VERSION}" Status="Final"/></def:Standards>'
    )
    items: list[str] = []
    for name, d in domains.items():
        keys = _KEYS.get(name) or (
            ("STUDYID", "USUBJID", f"{name}TESTCD", f"{name}SEQ")
            if d.klass == "Findings"
            else ("STUDYID", "USUBJID", f"{name}SEQ")
        )
        w(
            f'<ItemGroupDef OID="IG.{name}" Name="{name}" Domain="{name}" '
            f'SASDatasetName="{name}" Repeating="{"No" if name == "DM" else "Yes"}" '
            f'IsReferenceData="{"Yes" if name in ("TS", "TX") else "No"}" Purpose="Tabulation" '
            f'def:Structure={quoteattr(d.structure)} def:StandardOID="STD.SENDIG" '
            f'def:ArchiveLocationID="LF.{name}">'
            f'<Description><TranslatedText xml:lang="en">{escape(d.label)}</TranslatedText>'
            "</Description>"
        )
        for order, v in enumerate(d.variables, start=1):
            ks = f' KeySequence="{keys.index(v.name) + 1}"' if v.name in keys else ""
            role = f" Role={quoteattr(v.role)}" if v.role else ""
            w(
                f'<ItemRef ItemOID="IT.{name}.{v.name}" Mandatory="{"Yes" if v.core == "Req" else "No"}"'
                f' OrderNumber="{order}"{ks}{role}/>'
            )
            values = [r[v.name] for r in d.rows]
            dt = _datatype(v, values)
            length = (
                f' Length="{lengths[v.name]}"'
                if dt == "text"
                else ' Length="8"'
                if dt in ("integer", "float")
                else ""
            )
            sig = ' SignificantDigits="10"' if dt == "float" else ""
            otype, source = _origin(name, v.name, origins)
            if f"{name}.{v.name}" in origins:
                otype, source = origins[f"{name}.{v.name}"], None
            src = f' Source="{source}"' if source else ""
            clref = ""
            if v.codelists and any(x is not None for x in values):
                code = v.codelists[0]
                sub = ct()["codelists"][code]["submission_value"]
                cl_of[sub] = code
                codelists[sub] |= {str(x) for x in values if x is not None}
                clref = f'<CodeListRef CodeListOID="CL.{sub}"/>'
            items.append(
                f'<ItemDef OID="IT.{name}.{v.name}" Name="{v.name}" DataType="{dt}"{length}{sig} '
                f'SASFieldName="{v.name}"><Description><TranslatedText xml:lang="en">'
                f"{escape(v.label)}</TranslatedText></Description>{clref}"
                f'<def:Origin Type="{otype}"{src}/></ItemDef>'
            )
        w(
            f'<def:Class Name="{CLASS_NAMES[d.klass]}"/>'
            f'<def:leaf ID="LF.{name}" xlink:href="{name.lower()}.xpt">'
            f"<def:title>{name.lower()}.xpt</def:title></def:leaf></ItemGroupDef>"
        )
    out.extend(items)
    for sub in sorted(codelists):
        code = cl_of[sub]
        cl = ct()["codelists"][code]
        w(
            f'<CodeList OID="CL.{sub}" Name={quoteattr(cl["name"])} DataType="text" '
            f'def:StandardOID="STD.SENDCT">'
        )
        for val in sorted(codelists[sub]):
            term = cl["terms"].get(val)
            ext = "" if term else ' def:ExtendedValue="Yes"'
            w(
                f"<EnumeratedItem CodedValue={quoteattr(val)}{ext}>"
                + (f'<Alias Context="nci:ExtCodeID" Name="{term}"/>' if term else "")
                + "</EnumeratedItem>"
            )
        w(f'<Alias Context="nci:ExtCodeID" Name="{code}"/></CodeList>')
    w("</MetaDataVersion></Study></ODM>")
    return "\n".join(out) + "\n"


def validate_define(text: str) -> list[str]:
    """Schema errors (empty when valid)."""
    return [str(e.reason or e) for e in _schema().iter_errors(text)][:50]
