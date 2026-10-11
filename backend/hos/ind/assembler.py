"""IND readiness and CTD Module 4 assembly.

``readiness_report`` measures a programme against its derived study set for a clinical
milestone (default: first-in-human). Each requirement is classified:

* ``done``            an approved study with admissible (non-simulated) data and no QC failure
* ``imported``        no driver-run approval, but a completed import of an outside study
                      report (values attested from report, not recomputed); never ``done``
* ``done_qc_failed``  approved, but the analysis recorded a QC failure (e.g. positive control
                      out of range); not counted as done
* ``in_progress``     a study exists and is moving through the lifecycle (state shown)
* ``simulated_only``  only simulated studies exist; these never count
* ``missing``         no study; ``driver_available`` says whether HOS can run it
* ``conditional``     the requirement depends on a fact not yet known (named)
* ``not_required``    waived by the cited rule (kept visible for audit)

The headline figure is the share of required studies that are done, and separately the
share run end-to-end inside HOS (the north-star metric of docs/01).

``assemble_module4`` builds the Module 4 skeleton (ICH M4S(R2) section 4) from approved
driver-run studies and completed imports (the original report file plus the transcribed
values, marked attested from report). It re-checks every value in every included report for simulated provenance
and refuses the whole assembly if any is found. Where Study Director NOAELs exist, the
FDA (2005) MRSD derivation is attached, computed from those attested values.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from typing import Any

from hos.core import units as U
from hos.core.dose import project_starting_dose
from hos.core.provenance import utc_now
from hos.core.quantity import SIMULATION_TAINT, Quantity
from hos.core.reference_params import REFERENCE_PARAMETERS
from hos.core.regulatory import ProgramContext, Timing, derive_study_set
from hos.core.regulatory.engine import RequirementStatus
from hos.drivers.base import canonical_hash
from hos.ind.ctd import MODULE4, ctd_sort_key, ctd_title
from hos.kernel.attestation import Principal
from hos.kernel.errors import EvidenceInadmissible
from hos.kernel.lifecycle import StudyState
from hos.verify.bundle import verification_files

__all__ = ["assemble_module4", "readiness_report"]

_ACTIVE = {StudyState.PROPOSED, StudyState.DESIGNED, StudyState.PLANNED, StudyState.DISPATCHED,
           StudyState.DATA_RECEIVED, StudyState.ANALYZED, StudyState.REPORTED,
           StudyState.IMPORT_DRAFT}


def _imported(study: Any) -> bool:
    return bool(study.origin == "import" and study.state == StudyState.IMPORTED.value)


def _qc_failed(study: Any) -> bool:
    return bool(study.results and study.results.get("qc", {}).get("status") == "fail")


def _simulated(study: Any) -> bool:
    return any(f["origin"] == "simulated" for f in study.raw_files or [])


def readiness_report(kernel: Any, program_id: str,
                     milestone: Timing = Timing.BEFORE_FIRST_IN_HUMAN) -> dict[str, Any]:
    program = kernel.repo.program(program_id)
    ss = derive_study_set(ProgramContext.from_dict(program.context))
    studies = kernel.repo.studies(program_id)
    by_req: dict[str, list[Any]] = {}
    for s in studies:
        if s.requirement_id:
            by_req.setdefault(s.requirement_id, []).append(s)
    items = []
    for r in ss.requirements:
        due = r.timing.order <= milestone.order
        mine = by_req.get(r.id, [])
        real = [s for s in mine if not _simulated(s)]
        approved = [s for s in real if s.state == StudyState.APPROVED.value and s.evidence_admissible]
        imported = [s for s in real if _imported(s)]
        drivers = [d.id for d, _ in kernel.registry.match(r, ss.context)]
        if r.status is RequirementStatus.NOT_REQUIRED:
            status = "not_required"
        elif r.status is RequirementStatus.CONDITIONAL:
            status = "conditional"
        elif any(not _qc_failed(s) for s in approved):
            status = "done"
        elif imported:
            status = "imported"
        elif approved:
            status = "done_qc_failed"
        elif any(StudyState(s.state) in _ACTIVE for s in real):
            status = "in_progress"
        elif mine and not real:
            status = "simulated_only"
        else:
            status = "missing"
        items.append({
            "requirement_id": r.id, "name": r.name, "category": r.category.value,
            "timing": r.timing.value, "due_for_milestone": due, "status": status,
            "glp": r.glp, "species": list(r.species), "duration_weeks": r.duration_weeks,
            "ctd_section": r.ctd_section, "citation": r.citation.to_dict(),
            "section": r.section, "rationale": r.rationale, "pending_fact": r.pending_fact,
            "driver_available": bool(drivers), "drivers": drivers,
            "studies": [{"id": s.id, "state": s.state, "origin": s.origin or "driver",
                         "simulated": _simulated(s), "qc_failed": _qc_failed(s)} for s in mine],
        })
    due_required = [i for i in items if i["due_for_milestone"] and
                    i["status"] not in ("not_required", "conditional")]
    done = [i for i in due_required if i["status"] == "done"]
    imported_items = [i for i in due_required if i["status"] == "imported"]
    in_hos = [i for i in due_required if i["driver_available"]]
    counts: dict[str, int] = {}
    for i in items:
        if i["due_for_milestone"]:
            status = str(i["status"])
            counts[status] = counts.get(status, 0) + 1
    return {
        "program_id": program_id, "program": program.name, "milestone": milestone.value,
        "generated_at": utc_now().isoformat(),
        "study_set_hash": canonical_hash(ss.to_dict()),
        "summary": {
            "required_for_milestone": len(due_required),
            "done": len(done),
            "percent_done": round(100.0 * len(done) / len(due_required), 1) if due_required else None,
            "imported": len(imported_items),
            "covered": len(done) + len(imported_items),
            "percent_covered": (round(100.0 * (len(done) + len(imported_items)) / len(due_required), 1)
                                if due_required else None),
            "runnable_in_hos": len(in_hos),
            "percent_runnable_in_hos": (round(100.0 * len(in_hos) / len(due_required), 1)
                                        if due_required else None),
            "by_status": counts,
            "conditional_pending_facts": [i["pending_fact"] for i in items
                                          if i["status"] == "conditional" and i["pending_fact"]],
        },
        "items": items,
        "governing_guidelines": [c.to_dict() for c in ss.governing_guidelines],
        "notes": list(ss.notes) + [
            "This report encodes the cited guideline rules; it does not replace review by "
            "regulatory affairs or a pre-IND meeting with the agency."],
    }


def _check_no_simulation(obj: Any, path: str = "") -> None:
    """Defence in depth: refuse any report content carrying simulated provenance."""
    if isinstance(obj, dict):
        prov = obj.get("provenance")
        if isinstance(prov, dict) and prov.get("kind") == "simulated":
            raise EvidenceInadmissible(f"simulated value found at {path or 'root'}")
        flags = obj.get("qc_flags")
        if isinstance(flags, list) and SIMULATION_TAINT in flags:
            raise EvidenceInadmissible(f"value derived from simulation at {path or 'root'}")
        if obj.get("disclaimer") and "SIMULATED" in str(obj.get("disclaimer")):
            raise EvidenceInadmissible(f"report marked simulated at {path or 'root'}")
        for k, v in obj.items():
            _check_no_simulation(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _check_no_simulation(v, f"{path}[{i}]")


_KM_SPECIES = {p.split(".", 1)[1] for p in REFERENCE_PARAMETERS if p.startswith("km.")} - {"human"}


def Quantity_value_in(q: dict[str, Any], unit: str) -> float:
    """Magnitude of a serialised quantity in ``unit`` (dimensional conversion via pint)."""
    return U.convert(float(q["value"]), q["unit"], unit)


def _dose_projection(kernel: Any, studies: list[Any]) -> dict[str, Any] | None:
    noaels: dict[str, Quantity] = {}
    sources = []

    def keep(species: str, val: Quantity) -> None:
        # keep the most sensitive (lowest) NOAEL per species
        if species not in noaels or val.require() < noaels[species].require():
            noaels[species] = val

    for s in studies:
        if s.origin == "import":
            for v in (s.import_record or {}).get("values", []):
                q = v.get("quantity")
                if v.get("withdrawn") or v["key"] != "noael" or not q or not v.get("species"):
                    continue
                if v.get("sex") not in (None, "combined"):
                    continue
                val = Quantity.user_supplied(
                    Quantity_value_in(q, "mg/kg/day"), "mg/kg", actor=v["entered_by_name"],
                    label=f"NOAEL {v['species']} (imported study {s.id})",
                    notes=f"transcribed from report sha256:{s.import_record['report']['sha256']} "
                          f"page {v['page']}; attested from report")
                keep(str(v["species"]).lower(), val)
                sources.append({"study_id": s.id, "species": v["species"], "noael": q["value"],
                                "unit": q["unit"], "signer": "import (see study signatures)",
                                "imported": True, "page": v["page"]})
            continue
        if s.driver_id != "repeat_dose_toxicity":
            continue
        species = (s.parameters or {}).get("species")
        det = next((d for d in s.determinations or [] if d["key"] == "noael"), None)
        if not species or det is None or not (det.get("quantity") or {}).get("available"):
            continue
        q = det["quantity"]
        val = Quantity.user_supplied(
            float(q["value"]), "mg/kg", actor=det["signer_name"],
            label=f"NOAEL {species} (study {s.id})",
            notes=f"Study Director determination signed {det['signed_at']}; {q['unit']}")
        keep(str(species).lower(), val)
        sources.append({"study_id": s.id, "species": species, "noael": q["value"],
                        "unit": q["unit"], "signer": det["signer_name"]})
    if not noaels:
        return None
    known = {sp: q for sp, q in noaels.items() if sp in _KM_SPECIES}
    if not known:
        return {"basis": "FDA 2005 MRSD guidance", "sources": sources, "projection": None,
                "unavailable_reason": "no NOAEL for a species with an FDA 2005 Km factor"}
    proj = project_starting_dose(known)
    return {"basis": "FDA 2005 MRSD guidance; NOAELs as attested by the Study Director",
            "unit_note": "daily NOAELs (mg/kg/day) are treated as mg/kg single daily doses",
            "sources": sources, "projection": proj.to_dict()}


def assemble_module4(kernel: Any, actor: Principal, program_id: str) -> dict[str, Any]:
    program = kernel.repo.program(program_id)
    studies = kernel.repo.studies(program_id)
    included, refused, imports = [], [], []
    for s in studies:
        if _imported(s):
            _check_no_simulation(s.import_record, f"import {s.id}")
            imports.append(s)
            continue
        if s.state != StudyState.APPROVED.value:
            continue
        if _simulated(s) or not s.evidence_admissible:
            refused.append({"study_id": s.id, "reason": "simulated data"})
            continue
        _check_no_simulation(s.report, f"study {s.id}")
        included.append(s)
    sections: dict[str, list[dict[str, Any]]] = {}
    files: dict[str, bytes] = {}
    refs: dict[str, dict[str, Any]] = {}
    for s in sorted(included, key=lambda x: (ctd_sort_key(x.report["ctd_section"]), x.id)):
        sec = s.report["ctd_section"]
        ctd_title(sec)  # must be a valid M4S section
        path = f"m4/{sec}/{s.id}.md"
        md = s.report["markdown"]
        files[path] = md.encode()
        sections.setdefault(sec, []).append({
            "study_id": s.id, "title": s.report["title"], "report_hash": s.report_hash,
            "glp": s.glp, "file": path,
            "signatures": [{"role": g["role"], "meaning": g["meaning"], "signer": g["signer_name"],
                            "signed_at": g["signed_at"]} for g in s.signatures or []
                           if g["subject_hash"] == s.report_hash],
            "raw_data_sha256": [f["sha256"] for f in s.raw_files or []],
        })
        for ref in (s.protocol or {}).get("references", []):
            refs[ref["key"]] = ref
    for s in sorted(imports, key=lambda x: (ctd_sort_key(x.import_record["ctd_section"]), x.id)):
        rec = s.import_record
        sec = rec["ctd_section"]
        ctd_title(sec)
        rep = rec["report"]
        report_path = f"m4/{sec}/{s.id}/{rep['filename']}"
        files[report_path] = kernel.files.get(rep["sha256"])
        values = [v for v in rec.get("values", []) if not v.get("withdrawn")]
        files[f"m4/{sec}/{s.id}/transcribed_values.md"] = _import_markdown(s, values).encode()
        sections.setdefault(sec, []).append({
            "study_id": s.id, "title": rep["title"], "imported": True,
            "report_hash": s.report_hash, "report_file": report_path,
            "report_sha256": rep["sha256"], "laboratory": rep["laboratory"],
            "report_date": rep["report_date"], "glp": s.glp,
            "file": f"m4/{sec}/{s.id}/transcribed_values.md",
            "values": [{"key": v["key"], "label": v["label"], "species": v.get("species"),
                        "sex": v.get("sex"), "page": v["page"], "table": v.get("table"),
                        "value": (v.get("quantity") or {}).get("value"),
                        "unit": (v.get("quantity") or {}).get("unit"),
                        "category": v.get("category"),
                        "status": "attested from report, not recomputed"} for v in values],
            "signatures": [{"role": g["role"], "meaning": g["meaning"], "signer": g["signer_name"],
                            "signed_at": g["signed_at"]} for g in s.signatures or []
                           if g["subject_hash"] == s.report_hash],
            "raw_data_sha256": [d["sha256"] for d in rec.get("datasets", [])],
        })
    readiness = readiness_report(kernel, program_id)
    dose = _dose_projection(kernel, included + imports)
    toc = []
    for num, title in MODULE4:
        depth = num.count(".")
        entries = sections.get(num, [])
        toc.append({"section": num, "title": title, "depth": depth,
                    "reports": entries})
    package = {
        "program_id": program_id, "program": program.name, "generated_at": utc_now().isoformat(),
        "standard": "ICH M4S(R2) Module 4", "toc": toc, "included_studies": len(included),
        "imported_studies": len(imports),
        "refused_studies": refused,
        "literature_references": sorted(refs.values(), key=lambda r: r["key"]),
        "readiness": readiness["summary"], "dose_projection": dose,
    }
    vfiles, vmanifest = verification_files(kernel, program, included, imports)
    files.update(vfiles)
    package["verification"] = {"format": vmanifest["format"], "ledger_head": vmanifest["ledger"]["head"],
                               "software": vmanifest["software"],
                               "how_to_verify": "hos-verify <this zip> (offline)"}
    package["package_hash"] = canonical_hash({k: v for k, v in package.items()
                                              if k != "generated_at"})
    files["m4/index.md"] = _index_markdown(package).encode()
    files["m4/index.json"] = json.dumps(package, indent=2, sort_keys=True, default=str).encode()
    files["m4/readiness.json"] = json.dumps(readiness, indent=2, sort_keys=True,
                                            default=str).encode()
    bundle = _zip(files)
    sha = kernel.repo.store_file(bundle, filename=f"{program_id}_module4.zip",
                                 media_type="application/zip", actor=actor.id)
    kernel.record_event(actor, "ind.module4_assembled", "program", program_id,
                        {"package_hash": package["package_hash"], "bundle_sha256": sha,
                         "included": [s.id for s in included],
                         "imported": [s.id for s in imports], "refused": refused})
    package["bundle_sha256"] = sha
    return package


def _index_markdown(pkg: dict[str, Any]) -> str:
    out = [f"# Module 4: Nonclinical Study Reports — {pkg['program']}", "",
           f"*Structure:* {pkg['standard']}  ", f"*Package hash:* `{pkg['package_hash']}`  ",
           f"*Readiness (first-in-human):* {pkg['readiness']['done']} of "
           f"{pkg['readiness']['required_for_milestone']} required studies done, "
           f"{pkg['readiness']['imported']} imported", ""]
    for t in pkg["toc"]:
        indent = "  " * max(t["depth"] - 1, 0)
        line = f"{indent}- **{t['section']}** {t['title']}"
        if t["reports"]:
            line += "".join(f"\n{indent}  - [{r['title']}]({r['file'].split('/', 1)[1]}) "
                            f"(report `{(r['report_hash'] or '')[:12]}`)"
                            + (" — IMPORTED, values attested from report" if r.get("imported")
                               else "")
                            for r in t["reports"])
        out.append(line)
    if pkg["refused_studies"]:
        out += ["", "## Refused (not admissible as evidence)"]
        out += [f"- {r['study_id']}: {r['reason']}" for r in pkg["refused_studies"]]
    if pkg["dose_projection"] and pkg["dose_projection"].get("projection"):
        out += ["", "## First-in-human dose projection (FDA 2005)"]
        out += [f"- {s}" for s in pkg["dose_projection"]["projection"]["derivation"]]
    out += ["", "## 4.3 Literature references"]
    out += [f"- [{r['key']}] {r['text']}" for r in pkg["literature_references"]]
    return "\n".join(out) + "\n"


def _import_markdown(s: Any, values: list[dict[str, Any]]) -> str:
    rep = s.import_record["report"]
    out = [f"# {rep['title']} (imported study)", "",
           f"*Laboratory:* {rep['laboratory']}  ", f"*Report date:* {rep['report_date']}  ",
           f"*Report file:* `{rep['filename']}` (SHA-256 `{rep['sha256']}`)  ",
           f"*GLP:* {'yes' if s.glp else 'no'}", "",
           "Values below were transcribed from the report at the cited page/table and attested "
           "by the signatories. They are **attested from report, not recomputed** by HOS.", "",
           "| result | species | sex | value | where in report | entered by |",
           "|---|---|---|---|---|---|"]
    for v in values:
        q = v.get("quantity")
        val = f"{q['value']:g} {q['unit']}" if q else str(v.get("category"))
        where = f"p. {v['page']}" + (f", table {v['table']}" if v.get("table") else "")
        out.append(f"| {v['label']} | {v.get('species') or ''} | {v.get('sex') or ''} | {val} | "
                   f"{where} | {v['entered_by_name']} |")
    out += ["", "## Signatures"]
    out += [f"- {g['signer_name']} — {g['role']} ({g['meaning']}), {g['signed_at']}: {g['statement']}"
            for g in s.signatures or [] if g["subject_hash"] == s.report_hash]
    return "\n".join(out) + "\n"


def _zip(files: dict[str, bytes]) -> bytes:
    manifest = {n: hashlib.sha256(b).hexdigest() for n, b in sorted(files.items())}
    files = dict(files)
    files["m4/MANIFEST.json"] = json.dumps(manifest, indent=2, sort_keys=True).encode()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n in sorted(files):
            info = zipfile.ZipInfo(n, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, files[n])
    return buf.getvalue()
