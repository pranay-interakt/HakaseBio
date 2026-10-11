"""Kernel-side SEND export: gathers the study record, runs the export and records the result.

Only a repeat-dose toxicity study with laboratory-returned (not simulated) data can be exported,
optionally with its toxicokinetic study (same programme and compound). The package is stored by
its SHA-256, recorded as an artefact of the study and on the ledger; a refused export is recorded
with its errors too.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from hos.drivers.base import IngestedData
from hos.kernel.attestation import Principal
from hos.kernel.errors import EvidenceInadmissible, KernelError
from hos.send.domains import TEST_CODELISTS
from hos.send.export import assemble
from hos.send.reference import CT_VERSION, SENDIG_VERSION, ct
from hos.send.spec import (
    TS_CODELISTS,
    TS_DERIVED,
    TS_FDA_CONDITIONAL,
    TS_FDA_DESIRED,
    SendExportSpec,
)

__all__ = ["send_export", "send_export_context", "send_terms"]


def _simulated(row: Any) -> bool:
    return any(f.get("origin") == "simulated" for f in row.raw_files or [])


def _source(kernel: Any, row: Any, driver_id: str) -> dict[str, Any]:
    if row.driver_id != driver_id:
        raise KernelError(f"study {row.id} is not a {driver_id} study")
    if not row.data:
        raise KernelError(f"study {row.id} has no data")
    if _simulated(row):
        raise EvidenceInadmissible(f"study {row.id} contains simulated data; SEND datasets are "
                                   "regulatory submissions and are never made from it")
    driver = kernel.registry.get(row.driver_id)
    data = IngestedData.from_dict(row.data)
    return {"params": driver.validate_parameters(row.parameters), "records": data.records,
            "provenance": {"study_id": row.id, "driver": f"{row.driver_id}@{row.driver_version}",
                           "state": row.state, "data_file_sha256": data.file_sha256,
                           "analysis_hash": (row.results or {}).get("analysis_hash"),
                           "protocol_hash": row.protocol_hash}}


def send_export(kernel: Any, actor: Principal, study_id: str, spec: SendExportSpec,
                exported_at: datetime | None = None) -> dict[str, Any]:
    """One unit of work: the package file record, the export artefact and the ledger event
    commit together (docs/15 P0.1)."""
    with kernel.db.transaction():
        return _send_export(kernel, actor, study_id, spec, exported_at)


def _send_export(kernel: Any, actor: Principal, study_id: str, spec: SendExportSpec,
                 exported_at: datetime | None) -> dict[str, Any]:
    kernel._require_worker(actor)
    row = kernel.repo.study(study_id)
    tox = _source(kernel, row, "repeat_dose_toxicity")
    tk = None
    if spec.pk is not None:
        trow = kernel.repo.study(spec.pk.tk_study_id)
        if trow.program_id != row.program_id or trow.compound_id != row.compound_id:
            raise KernelError("the toxicokinetic study belongs to another programme or compound")
        tk = _source(kernel, trow, "toxicokinetics")
        table = next((t for t in (trow.results or {}).get("tables", [])
                      if t["title"] == "Individual exposure"), None)
        if table is None:
            raise KernelError("the toxicokinetic study has not been analysed")
        tk["individual"] = table
    sigs = kernel.protocol_signatures(row)
    start = str(sigs[0]["signed_at"])[:10] if sigs else None
    director = str(sigs[0]["signer_name"]) if sigs else None
    when = exported_at or datetime.now(UTC).replace(microsecond=0)
    pkg = assemble(spec, tox=tox, tk=tk, study_start=start, study_director=director,
                   glp=bool(row.glp), exported_at=when)
    record: dict[str, Any] = {"ok": pkg.ok, "errors": pkg.errors, "warnings": pkg.warnings,
                              "checks": [c.to_dict() for c in pkg.checks],
                              "manifest": pkg.manifest, "package_sha256": None,
                              "spec": spec.model_dump(mode="json")}
    if pkg.content is not None:
        sha = kernel.repo.store_file(pkg.content, program_id=row.program_id,
                                     filename=f"{spec.facts.studyid}_send.zip",
                                     media_type="application/zip", actor=actor.id)
        record["package_sha256"] = sha
    kernel.repo.add_artifact(study_id, "send_export", record, actor=actor.id)
    kernel._record(actor, "study.send_exported" if pkg.ok else "study.send_export_refused",
                   "study", study_id, {"package_sha256": record["package_sha256"],
                                       "errors": pkg.errors[:20],
                                       "tk_study_id": spec.pk.tk_study_id if spec.pk else None})
    return record


#: Export-form fields bound to a SEND CT codelist (the codes StudyFacts, AnimalRecord,
#: EndpointMap and PKMap check against).
FIELD_CODELISTS = {
    "species": "C77808", "strain": "C77530", "route": "C66729", "age_unit": "C66781",
    "test_facility_country": "C66786", "study_type": "C90003", "study_category": "C90002",
    "design": "C89967", "report_status": "C158125", "dose_form": "C66726",
    "dosing_frequency": "C71113", "glp_type": "C225357", "disposition": "C89968",
    "specimen": "C77529", "lb_category": "C225371", "unit": "C71620", "pk_unit": "C85494"}


def send_terms() -> dict[str, Any]:
    """SEND CT terms for the export form: suggestions on extensible codelists, the only
    choices on non-extensible ones."""
    cl = ct()["codelists"]
    fields = {f: {"code": c, "name": cl[c]["name"], "extensible": cl[c]["extensible"],
                  "terms": sorted(cl[c]["terms"])} for f, c in FIELD_CODELISTS.items()}
    tests = {}
    for dom, (codes, names) in TEST_CODELISTS.items():
        by_concept = {v: k for k, v in cl[names]["terms"].items()}
        tests[dom] = sorted([cd, by_concept.get(concept, "")]
                            for cd, concept in cl[codes]["terms"].items())
    return {"ct_version": CT_VERSION, "fields": fields, "tests": tests}


def _subjects(row: Any) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for r in IngestedData.from_dict(row.data).records:
        seen.setdefault(str(r["subject_id"]), {
            "subject_id": str(r["subject_id"]), "sex": r.get("sex"),
            "dose": r.get("dose"), "phase": r.get("phase", "tk")})
    return sorted(seen.values(), key=lambda a: a["subject_id"])


def send_export_context(kernel: Any, study_id: str) -> dict[str, Any]:
    """What the export form needs from the study record: the subjects, endpoints and
    timepoints to map, the protocol signature that fixes the study start date, candidate
    toxicokinetic studies, earlier exports, and the spec's JSON schema. Nothing is
    pre-filled that the record does not hold."""
    row = kernel.repo.study(study_id)
    if row.driver_id != "repeat_dose_toxicity":
        raise KernelError("SEND export is available for repeat-dose toxicity studies")
    params = kernel.registry.get(row.driver_id).validate_parameters(row.parameters)
    tk = [{"id": s.id, "title": s.title, "state": s.state,
           "simulated": _simulated(s),
           "analysed": any(t["title"] == "Individual exposure"
                           for t in (s.results or {}).get("tables", [])),
           "subjects": _subjects(s) if s.data else []}
          for s in kernel.repo.studies(row.program_id)
          if s.driver_id == "toxicokinetics" and s.compound_id == row.compound_id]
    sigs = kernel.protocol_signatures(row)
    return {
        "study_id": study_id, "state": row.state, "glp": bool(row.glp),
        "has_data": bool(row.data), "simulated": _simulated(row) if row.data else False,
        "subjects": _subjects(row) if row.data else [],
        "endpoints": [{"name": e.name, "unit": e.unit, "category": e.category}
                      for e in params.endpoints],
        "timepoints": list(params.timepoints), "recovery": bool(params.recovery),
        "study_start": str(sigs[0]["signed_at"])[:10] if sigs else None,
        "study_director": str(sigs[0]["signer_name"]) if sigs else None,
        "tk_studies": tk,
        "exports": [{"version": a.version, "created_at": a.created_at.isoformat(),
                     "created_by": a.created_by, **a.content}
                    for a in kernel.repo.artifacts(study_id, "send_export")],
        "standards": {"SENDIG": SENDIG_VERSION, "SEND CT": CT_VERSION, "Define-XML": "2.1.0"},
        "ts_fda_desired": list(TS_FDA_DESIRED), "ts_fda_conditional": list(TS_FDA_CONDITIONAL),
        "ts_to_enter": [c for c in (*TS_FDA_DESIRED, *TS_FDA_CONDITIONAL)
                        if c not in TS_DERIVED],
        "ts_codelists": TS_CODELISTS, "spec_schema": SendExportSpec.model_json_schema(),
    }
