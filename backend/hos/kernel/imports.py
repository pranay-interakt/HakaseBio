"""Study import: studies run outside HOS, entered from their final report (docs/14 P1).

An imported study is created against a requirement of the derived study set. The final
report is stored by SHA-256; key results are transcribed as provenance-typed values, each
with a mandatory page or table reference. Agents may *propose* values extracted from the
report; only a human can confirm one, and unconfirmed proposals never become quantities.
The responsible humans sign the import (Study Director and QA for a GLP study); the kernel
writes into every signature that the values were transcribed from the cited report.

Lifecycle: ``import_draft -> imported -> superseded``. Readiness counts an imported study as
``imported`` (never ``done``); Module 4 includes the report itself and the transcribed
values, marked as attested from report rather than recomputed.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date
from typing import TYPE_CHECKING, Any

from hos.core import units as U
from hos.core.provenance import Citation, Provenance, utc_now
from hos.core.quantity import Quantity
from hos.core.regulatory.engine import RequirementStatus
from hos.db.models import StudyRow
from hos.db.repository import content_hash
from hos.ind.ctd import ctd_title
from hos.kernel.attestation import Principal, PrincipalKind, Role, SignatureMeaning, sign
from hos.kernel.errors import AttestationRequired, KernelError, NotFound, PermissionDenied
from hos.kernel.import_specs import ImportField, import_fields
from hos.kernel.lifecycle import StudyState, assert_transition
from hos.kernel.uow import atomic

if TYPE_CHECKING:
    from hos.kernel.kernel import Kernel

__all__ = ["ATTESTATION_SENTENCE", "IMPORT_DRIVER_ID", "ImportService", "compute_import_hash"]

IMPORT_DRIVER_ID = "import"
ATTESTATION_SENTENCE = ("I attest that every value recorded in this import was transcribed from "
                        "the report {filename} (SHA-256 {sha}) at the page or table cited for it.")

_REPORT_TYPES = {".pdf": "application/pdf",
                 ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 ".doc": "application/msword", ".txt": "text/plain", ".md": "text/markdown",
                 ".xml": "application/xml", ".zip": "application/zip", ".csv": "text/csv",
                 ".xpt": "application/octet-stream"}


def _media_type(filename: str) -> str:
    dot = filename.rfind(".")
    return _REPORT_TYPES.get(filename[dot:].lower() if dot >= 0 else "", "application/octet-stream")


def _rid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def compute_import_hash(record: dict[str, Any]) -> str:
    """Hash of an import's attested content (shared with the offline verifier). The parts of a
    multi-part requirement the report covers are attested too, when the requirement has
    parts."""
    body: dict[str, Any] = {
        "report": record.get("report"), "datasets": record.get("datasets", []),
        "values": [v for v in record.get("values", []) if not v.get("withdrawn")]}
    if record.get("components"):
        body["components"] = record["components"]
    return content_hash(body)


class ImportService:
    """Import operations; available as ``kernel.imports``. Every operation goes through the
    kernel's authority checks, lifecycle, artefact store and ledger."""

    def __init__(self, kernel: Kernel) -> None:
        self.k = kernel

    # -- creation ----------------------------------------------------------------

    @atomic
    def import_study(self, actor: Principal, *, program_id: str, compound_id: str,
                     requirement_id: str, report: bytes, filename: str, title: str,
                     laboratory: str, report_date: str, glp: bool,
                     lab_study_number: str | None = None,
                     ctd_section: str | None = None,
                     components: list[str] | None = None) -> dict[str, Any]:
        self.k._require_worker(actor)
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("an import is created by a human; agents may propose values")
        program = self.k.repo.program(program_id)
        compound = self.k.repo.compound(compound_id)
        if compound.program_id != program_id:
            raise KernelError("compound does not belong to this programme")
        req = self.k._requirement(program, requirement_id)
        if req.status is RequirementStatus.NOT_REQUIRED:
            raise KernelError(f"requirement {requirement_id} is not required for this programme")
        if not report:
            raise KernelError("the final report file is empty")
        for name, val in (("title", title), ("laboratory", laboratory), ("filename", filename)):
            if not val or not val.strip():
                raise KernelError(f"an imported study needs its report {name}")
        try:
            date.fromisoformat(report_date)
        except ValueError:
            raise KernelError(f"report_date {report_date!r} is not an ISO 8601 date") from None
        parts: list[str] = []
        if req.components:
            parts = [c for c in req.components if c in set(components or [])]
            unknown = sorted(set(components or []) - set(req.components))
            if unknown or not parts:
                raise KernelError(f"{requirement_id} has parts {list(req.components)}: state "
                                  "which of them the report covers"
                                  + (f" (unknown: {unknown})" if unknown else ""))
        elif components:
            raise KernelError(f"{requirement_id} has no parts")
        section = ctd_section or req.ctd_section
        if not section:
            raise KernelError(f"requirement {requirement_id} has no CTD section; state one")
        ctd_title(section)
        sha = self.k.repo.store_file(report, filename=filename, media_type=_media_type(filename),
                                   actor=actor.id)
        sid = f"stu_{uuid.uuid4().hex[:12]}"
        now = utc_now()
        report_meta: dict[str, Any] = {
            "sha256": sha, "filename": filename, "size_bytes": len(report),
            "title": title.strip(), "laboratory": laboratory.strip(),
            "report_date": report_date, "lab_study_number": lab_study_number,
            "media_type": _media_type(filename)}
        record: dict[str, Any] = {
            "report": report_meta,
            "ctd_section": section,
            "requirement": {"id": req.id, "name": req.name, "section": req.section,
                            "citation": req.citation.to_dict()},
            "datasets": [], "values": [], "proposals": [],
        }
        if parts:
            record["components"] = parts
        self.k.repo.add(StudyRow(
            id=sid, program_id=program_id, compound_id=compound_id, requirement_id=requirement_id,
            driver_id=IMPORT_DRIVER_ID, driver_version="1", title=f"{req.name}: {compound.name} "
            f"(imported: {title.strip()})", state=StudyState.IMPORT_DRAFT.value, hypothesis=None,
            parameters={}, protocol=None, protocol_version=0, raw_files=[], signatures=[],
            determinations=[], analysis_inputs={}, glp=glp, origin="import",
            import_record=record, evidence_admissible=True, created_by=actor.id, created_at=now,
            updated_at=now))
        self.k.repo.add_artifact(sid, "import_report", report_meta, actor=actor.id)
        self.k._record(actor, "import.created", "study", sid,
                     {"requirement_id": requirement_id, "report_sha256": sha,
                      "report_filename": filename, "glp": glp, "laboratory": laboratory})
        return self.k.study_view(sid)

    @atomic
    def add_import_dataset(self, actor: Principal, study_id: str, content: bytes, *,
                           filename: str, description: str) -> dict[str, Any]:
        row = self._draft_import(actor, study_id)
        if not content:
            raise KernelError("dataset file is empty")
        sha = self.k.repo.store_file(content, filename=filename, media_type=_media_type(filename),
                                   actor=actor.id)
        rec = dict(row.import_record or {})
        rec["datasets"] = [*rec.get("datasets", []),
                           {"sha256": sha, "filename": filename, "description": description,
                            "size_bytes": len(content), "added_by": actor.id,
                            "added_at": utc_now().isoformat()}]
        self.k.repo.update_study(study_id, import_record=rec)
        self.k._record(actor, "import.dataset_added", "study", study_id,
                     {"sha256": sha, "filename": filename})
        return self.k.study_view(study_id)

    # -- values ------------------------------------------------------------------------

    @atomic
    def add_import_value(self, actor: Principal, study_id: str, *, key: str,
                         page: str, value: float | None = None, unit: str | None = None,
                         category: str | None = None, label: str | None = None,
                         table: str | None = None, species: str | None = None,
                         sex: str | None = None, kind: str = "measured",
                         citation_text: str | None = None,
                         note: str | None = None) -> dict[str, Any]:
        """Transcribe one result from the report. A human only; ``page`` is mandatory."""
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("agents may propose values; a human must confirm them")
        row = self._draft_import(actor, study_id)
        entry = self._import_value_entry(row, actor, key=key, page=page, value=value, unit=unit,
                                         category=category, label=label, table=table,
                                         species=species, sex=sex, kind=kind,
                                         citation_text=citation_text, note=note,
                                         origin="manual")
        rec = dict(row.import_record or {})
        rec["values"] = [*rec.get("values", []), entry]
        self.k.repo.update_study(study_id, import_record=rec)
        self.k._record(actor, "import.value_added", "study", study_id,
                     {"value_id": entry["id"], "key": key, "page": page, "table": table,
                      "value": value, "unit": entry.get("unit"), "category": category})
        return self.k.study_view(study_id)

    @atomic
    def withdraw_import_value(self, actor: Principal, study_id: str, value_id: str, *,
                              reason: str) -> dict[str, Any]:
        if not reason.strip():
            raise KernelError("withdrawing a transcribed value requires a reason")
        row = self._draft_import(actor, study_id)
        rec = dict(row.import_record or {})
        found = False
        vals = []
        for v in rec.get("values", []):
            if v["id"] == value_id and not v.get("withdrawn"):
                v = {**v, "withdrawn": {"by": actor.id, "at": utc_now().isoformat(),
                                        "reason": reason}}
                found = True
            vals.append(v)
        if not found:
            raise NotFound(f"no active value {value_id}")
        rec["values"] = vals
        self.k.repo.update_study(study_id, import_record=rec)
        self.k._record(actor, "import.value_withdrawn", "study", study_id,
                     {"value_id": value_id}, reason=reason)
        return self.k.study_view(study_id)

    @atomic
    def propose_import_value(self, actor: Principal, study_id: str, *, key: str,
                             page: str, value: float | None = None, unit: str | None = None,
                             category: str | None = None, label: str | None = None,
                             table: str | None = None, species: str | None = None,
                             sex: str | None = None, excerpt: str | None = None
                             ) -> dict[str, Any]:
        """An agent (or a person) proposes a value extracted from the report. It is not a
        quantity until a human confirms it."""
        row = self._draft_import(actor, study_id)
        if not page or not page.strip():
            raise KernelError("a proposed value must cite the report page or table")
        self._spec_for(row, key)  # validates the key
        prop = {"id": _rid("prop"), "key": key, "label": label, "value": value, "unit": unit,
                "category": category, "page": page.strip(), "table": table, "species": species,
                "sex": sex, "excerpt": excerpt, "proposed_by": actor.id,
                "proposed_by_kind": actor.kind.value, "proposed_at": utc_now().isoformat(),
                "status": "proposed"}
        rec = dict(row.import_record or {})
        rec["proposals"] = [*rec.get("proposals", []), prop]
        self.k.repo.update_study(study_id, import_record=rec)
        self.k._record(actor, "import.value_proposed", "study", study_id,
                     {"proposal_id": prop["id"], "key": key, "page": page})
        return self.k.study_view(study_id)

    @atomic
    def confirm_import_proposal(self, actor: Principal, study_id: str,
                                proposal_id: str, *, page: str | None = None) -> dict[str, Any]:
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("only a human can confirm an extracted value")
        row = self._draft_import(actor, study_id)
        rec = dict(row.import_record or {})
        prop = next((p for p in rec.get("proposals", []) if p["id"] == proposal_id), None)
        if prop is None or prop["status"] != "proposed":
            raise NotFound(f"no open proposal {proposal_id}")
        entry = self._import_value_entry(
            row, actor, key=prop["key"], page=page or prop["page"], value=prop["value"],
            unit=prop["unit"], category=prop["category"], label=prop["label"],
            table=prop["table"], species=prop["species"], sex=prop["sex"], kind="measured",
            citation_text=None, note=None, origin=f"proposal:{proposal_id}")
        rec["values"] = [*rec.get("values", []), entry]
        rec["proposals"] = [{**p, "status": "confirmed", "confirmed_by": actor.id,
                             "value_id": entry["id"]} if p["id"] == proposal_id else p
                            for p in rec.get("proposals", [])]
        self.k.repo.update_study(study_id, import_record=rec)
        self.k._record(actor, "import.proposal_confirmed", "study", study_id,
                     {"proposal_id": proposal_id, "value_id": entry["id"]})
        return self.k.study_view(study_id)

    @atomic
    def reject_import_proposal(self, actor: Principal, study_id: str, proposal_id: str,
                               *, reason: str) -> dict[str, Any]:
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("only a human can reject an extracted value")
        if not reason.strip():
            raise KernelError("rejecting a proposal requires a reason")
        row = self._draft_import(actor, study_id)
        rec = dict(row.import_record or {})
        if not any(p["id"] == proposal_id and p["status"] == "proposed"
                   for p in rec.get("proposals", [])):
            raise NotFound(f"no open proposal {proposal_id}")
        rec["proposals"] = [{**p, "status": "rejected", "rejected_by": actor.id,
                             "reason": reason} if p["id"] == proposal_id else p
                            for p in rec.get("proposals", [])]
        self.k.repo.update_study(study_id, import_record=rec)
        self.k._record(actor, "import.proposal_rejected", "study", study_id,
                     {"proposal_id": proposal_id}, reason=reason)
        return self.k.study_view(study_id)

    # -- attestation ---------------------------------------------------------------------

    def import_hash(self, row: StudyRow) -> str:
        """Content hash a signature binds to: report, datasets and active values."""
        return compute_import_hash(row.import_record or {})

    def import_missing(self, row: StudyRow) -> list[str]:
        """Required transcriptions not yet present."""
        rec = row.import_record or {}
        active = [v for v in rec.get("values", []) if not v.get("withdrawn")]
        fields = import_fields(row.requirement_id or "")
        missing = [f"{f.label} ({f.key})" for f in fields
                   if f.required and not any(v["key"] == f.key for v in active)]
        if not fields and not active:
            missing.append("at least one transcribed result")
        return missing

    def import_signature_requirements(self, row: StudyRow
                                      ) -> list[tuple[set[str], SignatureMeaning]]:
        if row.glp:
            return [({Role.STUDY_DIRECTOR.value}, SignatureMeaning.APPROVAL),
                     ({Role.QUALITY_ASSURANCE.value}, SignatureMeaning.QA_COMPLIANCE)]
        return [({Role.RESPONSIBLE_SCIENTIST.value, Role.STUDY_DIRECTOR.value},
                 SignatureMeaning.APPROVAL)]

    def import_signatures_missing(self, row: StudyRow) -> list[str]:
        h = self.import_hash(row)
        sigs = [s for s in row.signatures or [] if s["subject_hash"] == h]
        out = []
        for roles, meaning in self.import_signature_requirements(row):
            if not any(s["role"] in roles and s["meaning"] == meaning.value for s in sigs):
                out.append(f"{' or '.join(sorted(roles))} ({meaning.value})")
        return out

    @atomic
    def sign_import(self, actor: Principal, study_id: str, *, role: Role,
                    meaning: SignatureMeaning, statement: str) -> dict[str, Any]:
        """Sign the import as it stands. The API re-authenticates before calling this."""
        row = self._import_row(study_id)
        if StudyState(row.state) is not StudyState.IMPORT_DRAFT:
            raise KernelError("only an import in draft can be signed")
        missing = self.import_missing(row)
        if missing:
            raise AttestationRequired(f"transcribe these results before signing: {missing}")
        rep = (row.import_record or {})["report"]
        full = ATTESTATION_SENTENCE.format(filename=rep["filename"], sha=rep["sha256"])
        if statement.strip():
            full += " " + statement.strip()
        sig = sign(actor, role=role, meaning=meaning, subject_id=f"{study_id}/import",
                   subject_hash=self.import_hash(row), statement=full)
        self.k.repo.add_artifact(study_id, "signature", sig.to_dict(), actor=actor.id)
        self.k.repo.update_study(study_id, signatures=[*(row.signatures or []), sig.to_dict()])
        self.k._record(actor, "import.signed", "study", study_id, {"signature": sig.to_dict()})
        return self.k.study_view(study_id)

    @atomic
    def complete_import(self, actor: Principal, study_id: str) -> dict[str, Any]:
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("only a human can complete an import")
        row = self._import_row(study_id)
        assert_transition(StudyState(row.state), StudyState.IMPORTED)
        missing = self.import_missing(row) + self.import_signatures_missing(row)
        if missing:
            raise AttestationRequired(f"the import still needs: {missing}")
        rec = row.import_record or {}
        self.k.repo.add_artifact(study_id, "import_record", dict(rec), actor=actor.id)
        self.k.repo.update_study(study_id, state=StudyState.IMPORTED.value,
                               report_hash=self.import_hash(row))
        self.k._record(actor, "import.completed", "study", study_id,
                     {"import_hash": self.import_hash(row),
                      "values": len([v for v in rec.get("values", []) if not v.get("withdrawn")])})
        return self.k.study_view(study_id)

    @atomic
    def supersede_import(self, actor: Principal, study_id: str, *, by_study_id: str,
                         reason: str) -> dict[str, Any]:
        """Retire an imported study once a driver-run study for the same requirement is
        approved. History stays on the ledger."""
        self.k._require_worker(actor)
        if not reason.strip():
            raise KernelError("superseding requires a reason")
        row = self._import_row(study_id)
        by = self.k.repo.study(by_study_id)
        if by.origin == "import" or by.state != StudyState.APPROVED.value:
            raise KernelError("an import is superseded only by an approved driver-run study")
        if (by.program_id, by.requirement_id) != (row.program_id, row.requirement_id):
            raise KernelError("the superseding study must serve the same programme requirement")
        assert_transition(StudyState(row.state), StudyState.SUPERSEDED)
        rec = dict(row.import_record or {})
        rec["superseded_by"] = {"study_id": by_study_id, "by": actor.id,
                                "at": utc_now().isoformat(), "reason": reason}
        self.k.repo.update_study(study_id, state=StudyState.SUPERSEDED.value, import_record=rec)
        self.k._record(actor, "import.superseded", "study", study_id,
                     {"by_study_id": by_study_id}, reason=reason)
        return self.k.study_view(study_id)

    def import_report_file(self, study_id: str) -> tuple[bytes, str, str]:
        row = self._import_row(study_id)
        rep = (row.import_record or {})["report"]
        return self.k.files.get(rep["sha256"]), rep["filename"], rep["media_type"]

    def import_view(self, row: StudyRow) -> dict[str, Any]:
        fields = import_fields(row.requirement_id or "")
        return {"fields": [f.to_dict() for f in fields],
                "missing": self.import_missing(row),
                "import_hash": self.import_hash(row),
                "signatures_missing": self.import_signatures_missing(row),
                "attestation_sentence": ATTESTATION_SENTENCE}

    # -- internals ---------------------------------------------------------------------------

    def _import_row(self, study_id: str) -> StudyRow:
        row = self.k.repo.study(study_id)
        if row.origin != "import":
            raise KernelError(f"study {study_id} is not an imported study")
        return row

    def _draft_import(self, actor: Principal, study_id: str) -> StudyRow:
        self.k._require_worker(actor)
        row = self._import_row(study_id)
        if StudyState(row.state) is not StudyState.IMPORT_DRAFT:
            raise KernelError("the import is no longer a draft; values cannot change")
        # signatures bind to import_hash(), so any change after signing makes them stale
        return row

    def _spec_for(self, row: StudyRow, key: str) -> ImportField | None:
        if not key or not key.strip() or not key.replace("_", "").replace(".", "").isalnum():
            raise KernelError("a result key is a short identifier, e.g. 'noael'")
        for f in import_fields(row.requirement_id or ""):
            if f.key == key:
                return f
        return None

    def _import_value_entry(self, row: StudyRow, actor: Principal, *, key: str,
                            page: str, value: float | None, unit: str | None,
                            category: str | None, label: str | None, table: str | None,
                            species: str | None, sex: str | None, kind: str,
                            citation_text: str | None, note: str | None,
                            origin: str) -> dict[str, Any]:
        if not page or not page.strip():
            raise KernelError("every transcribed value needs the report page (and table, if "
                              "any) it was taken from")
        spec = self._spec_for(row, key)
        rep = (row.import_record or {})["report"]
        if spec is not None and spec.needs_species and not (species and species.strip()):
            raise KernelError(f"{spec.label} must name the species it applies to")
        if sex is not None and sex not in ("M", "F", "combined"):
            raise KernelError("sex is M, F or combined")
        vtype = spec.value_type if spec else ("categorical" if category is not None else "quantity")
        entry: dict[str, Any] = {
            "id": _rid("val"), "key": key, "label": label or (spec.label if spec else key),
            "value_type": vtype, "page": page.strip(), "table": table, "species": species,
            "sex": sex, "entered_by": actor.id, "entered_by_name": actor.name,
            "entered_at": utc_now().isoformat(), "origin": origin,
            "attested_from_report": True,
        }
        where = f"page {page.strip()}" + (f", table {table}" if table else "")
        if vtype == "categorical":
            if value is not None:
                raise KernelError(f"{entry['label']} is categorical; give a category, not a number")
            if not category:
                raise KernelError(f"{entry['label']} needs a category")
            if spec is not None and spec.choices and category not in spec.choices:
                raise KernelError(f"{entry['label']} must be one of {list(spec.choices)}")
            entry["category"] = category
            entry["source"] = {"report_sha256": rep["sha256"], "where": where,
                               "transcribed_by": actor.name}
            return entry
        if value is None or unit is None:
            raise KernelError(f"{entry['label']} needs a numeric value and its unit as reported")
        if not U.is_valid_unit(unit):
            raise KernelError(f"unrecognised unit {unit!r}")
        if spec is not None and spec.unit and not U.compatible(unit, spec.unit):
            raise KernelError(f"{spec.label} is expressed in units compatible with {spec.unit!r}")
        notes = (f"transcribed from report {rep['filename']} at {where} by {actor.name}; "
                 "attested from report, not recomputed" + (f"; {note}" if note else ""))
        label_q = entry["label"] + (f" ({species}" + (f", {sex}" if sex else "") + ")"
                                    if species else "")
        if kind == "measured":
            q = Quantity(value=float(value), unit=unit, label=label_q,
                         provenance=Provenance.measured(
                             source_name=f"{rep['laboratory']}: {rep['title']}",
                             actor=actor.name, source_record_id=f"sha256:{rep['sha256']}",
                             notes=notes))
        elif kind == "literature":
            if not citation_text or not citation_text.strip():
                raise KernelError("a value from published work needs the full citation")
            q = Quantity(value=float(value), unit=unit, label=label_q,
                         provenance=Provenance.literature(
                             source_name=rep["title"],
                             citation=Citation(key=f"report:{rep['sha256'][:12]}",
                                               text=citation_text.strip()),
                             source_record_id=f"sha256:{rep['sha256']}", notes=notes))
        else:
            raise KernelError("an imported value is 'measured' (study report) or 'literature'")
        entry["quantity"] = q.to_dict()
        return entry


def active_values(row: Any) -> Sequence[dict[str, Any]]:
    return [v for v in (row.import_record or {}).get("values", []) if not v.get("withdrawn")]
