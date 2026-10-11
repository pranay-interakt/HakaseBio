"""REST API over the kernel.

Authentication: humans log in with id + password and receive a bearer token; agents use a
token issued by an administrator. Every electronic-signature action (expert determination,
report signature, approval) requires the human's password again at the moment of signing
(21 CFR 11.200), verified by the kernel before the signature is created.

Run: ``uvicorn hos.api.app:app`` (``HOS_DATA_DIR`` / ``HOS_DATABASE_URL`` configure storage).
"""

from __future__ import annotations

import os
import secrets
import threading
from datetime import datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

from hos import __version__
from hos.core.citations import CITATIONS
from hos.core.descriptors import InvalidStructureError
from hos.core.methods import METHODS
from hos.core.provenance import utc_now
from hos.core.reference_params import REFERENCE_PARAMETERS, REGISTRY_VERSION
from hos.core.regulatory import ProgramContext, Timing
from hos.drivers.base import IngestError
from hos.kernel.attestation import Principal, PrincipalKind, Role, SignatureMeaning
from hos.kernel.errors import (
    AttestationRequired,
    DriverError,
    EvidenceInadmissible,
    IllegalTransition,
    KernelError,
    LedgerIntegrityError,
    NotFound,
    PermissionDenied,
)
from hos.kernel.kernel import Kernel

__all__ = ["app", "create_app"]

SESSION_TTL = timedelta(hours=8)


class Sessions:
    """In-process bearer-token store (single API process)."""

    def __init__(self) -> None:
        self._tokens: dict[str, tuple[str, datetime]] = {}
        self._lock = threading.Lock()

    def issue(self, principal_id: str, ttl: timedelta = SESSION_TTL) -> str:
        tok = secrets.token_urlsafe(32)
        with self._lock:
            self._tokens[tok] = (principal_id, utc_now() + ttl)
        return tok

    def resolve(self, token: str) -> str | None:
        with self._lock:
            entry = self._tokens.get(token)
            if entry is None:
                return None
            if entry[1] < utc_now():
                del self._tokens[token]
                return None
            return entry[0]

    def revoke(self, token: str) -> None:
        with self._lock:
            self._tokens.pop(token, None)


# ---- request bodies ---------------------------------------------------------------


class SetupBody(BaseModel):
    principal_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    password: str


class LoginBody(BaseModel):
    principal_id: str
    password: str


class PrincipalBody(BaseModel):
    principal_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    kind: PrincipalKind
    roles: list[Role]
    password: str | None = None
    organisation: str | None = None


class ProgramBody(BaseModel):
    name: str
    sponsor: str | None = None
    context: dict[str, Any]


class ContextChangeBody(BaseModel):
    changes: dict[str, Any]
    reason: str


class CompoundBody(BaseModel):
    name: str
    smiles: str


class StudyBody(BaseModel):
    program_id: str
    compound_id: str
    requirement_id: str | None = None
    driver_id: str | None = None
    hypothesis: str | None = None


class DesignBody(BaseModel):
    parameters: dict[str, Any]
    reason: str | None = None


class DispatchBody(BaseModel):
    target: dict[str, Any]


class InputsBody(BaseModel):
    inputs: dict[str, dict[str, Any]]


class ReasonBody(BaseModel):
    reason: str | None = None


class DeterminationBody(BaseModel):
    key: str
    value: float | None
    unit: str | None = None
    rationale: str
    password: str
    reason: str | None = None


class SignBody(BaseModel):
    role: Role
    meaning: SignatureMeaning
    statement: str
    password: str


class ApproveBody(BaseModel):
    password: str


class ImportValueBody(BaseModel):
    key: str
    page: str
    value: float | None = None
    unit: str | None = None
    category: str | None = None
    label: str | None = None
    table: str | None = None
    species: str | None = None
    sex: str | None = None
    kind: str = "measured"
    citation_text: str | None = None
    note: str | None = None


class ImportProposalBody(BaseModel):
    key: str
    page: str
    value: float | None = None
    unit: str | None = None
    category: str | None = None
    label: str | None = None
    table: str | None = None
    species: str | None = None
    sex: str | None = None
    excerpt: str | None = None


class ConfirmProposalBody(BaseModel):
    page: str | None = None


class ReasonRequiredBody(BaseModel):
    reason: str


class SupersedeBody(BaseModel):
    by_study_id: str
    reason: str


class WhatIfBody(BaseModel):
    changes: dict[str, Any]


class DiffBody(BaseModel):
    a: dict[str, Any]
    b: dict[str, Any]


class RehearsalBody(BaseModel):
    plan: dict[str, dict[str, Any]] = Field(default_factory=dict)
    milestone: Timing = Timing.BEFORE_FIRST_IN_HUMAN
    compound_id: str | None = None


class CancelBody(BaseModel):
    reason: str


# ---- app -----------------------------------------------------------------------------


def create_app(kernel: Kernel | None = None) -> FastAPI:
    app = FastAPI(title="Hakase Operating System API", version=__version__,
                  description="Preclinical study kernel: programmes, study sets, drivers, "
                              "execution, analysis, attestation and IND assembly. Every "
                              "scientific value carries provenance.")
    origins = [o for o in os.environ.get("HOS_CORS_ORIGINS",
                                         "http://localhost:5173,http://127.0.0.1:5173").split(",")
               if o]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"],
                       allow_headers=["*"])
    state: dict[str, Any] = {"kernel": kernel, "sessions": Sessions()}

    def get_kernel() -> Kernel:
        if state["kernel"] is None:
            state["kernel"] = Kernel()
        k: Kernel = state["kernel"]
        return k

    def current(authorization: str | None = Header(default=None),
                k: Kernel = Depends(get_kernel)) -> Principal:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "missing bearer token")
        pid = state["sessions"].resolve(authorization.split(" ", 1)[1])
        if pid is None:
            raise HTTPException(401, "invalid or expired token")
        return k.get_principal(pid)

    def reauth(k: Kernel, actor: Principal, password: str) -> Principal:
        """21 CFR 11.200: verify the signer's credentials at the moment of signing."""
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("only humans can sign")
        return k.authenticate(actor.id, password)

    # -- error mapping -----------------------------------------------------------------
    def _err(code: int, exc: Exception, **extra: Any) -> JSONResponse:
        return JSONResponse(status_code=code, content={"error": type(exc).__name__,
                                                       "detail": str(exc), **extra})

    app.add_exception_handler(NotFound, lambda r, e: _err(404, e))
    app.add_exception_handler(PermissionDenied, lambda r, e: _err(403, e))
    exc_t: type[Exception]
    for exc_t in (AttestationRequired, EvidenceInadmissible, IllegalTransition):
        app.add_exception_handler(exc_t, lambda r, e: _err(409, e))
    app.add_exception_handler(IngestError, lambda r, e: _err(422, e, errors=list(e.errors)))
    app.add_exception_handler(LedgerIntegrityError, lambda r, e: _err(500, e))
    for exc_t in (DriverError, KernelError, InvalidStructureError, ValueError):
        app.add_exception_handler(exc_t, lambda r, e: _err(400, e))

    # -- system -------------------------------------------------------------------------
    @app.get("/api/health")
    def health(k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return {"status": "ok", "version": __version__,
                "initialised": bool(k.repo.principals()),
                "drivers": k.registry.ids(), "reference_parameters": REGISTRY_VERSION}

    @app.post("/api/setup")
    def setup(body: SetupBody, k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        if k.repo.principals():
            raise PermissionDenied("system already initialised")
        p = k.register_principal(None, principal_id=body.principal_id, name=body.name,
                                 kind=PrincipalKind.HUMAN, roles=[Role.ADMIN],
                                 password=body.password)
        return p.to_dict()

    @app.post("/api/auth/login")
    def login(body: LoginBody, k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        p = k.authenticate(body.principal_id, body.password)
        return {"token": state["sessions"].issue(p.id), "principal": p.to_dict()}

    @app.post("/api/auth/logout")
    def logout(authorization: str | None = Header(default=None)) -> dict[str, str]:
        if authorization and authorization.lower().startswith("bearer "):
            state["sessions"].revoke(authorization.split(" ", 1)[1])
        return {"status": "logged out"}

    @app.get("/api/me")
    def me(actor: Principal = Depends(current)) -> dict[str, Any]:
        return actor.to_dict()

    @app.get("/api/principals")
    def principals(actor: Principal = Depends(current),
                   k: Kernel = Depends(get_kernel)) -> list[dict[str, Any]]:
        return [k.get_principal(r.id).to_dict() for r in k.repo.principals()]

    @app.post("/api/principals")
    def add_principal(body: PrincipalBody, actor: Principal = Depends(current),
                      k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.register_principal(actor, principal_id=body.principal_id, name=body.name,
                                    kind=body.kind, roles=body.roles, password=body.password,
                                    organisation=body.organisation).to_dict()

    @app.post("/api/principals/{principal_id}/agent-token")
    def agent_token(principal_id: str, actor: Principal = Depends(current),
                    k: Kernel = Depends(get_kernel)) -> dict[str, str]:
        if Role.ADMIN not in actor.roles:
            raise PermissionDenied("only an administrator can issue agent tokens")
        target = k.get_principal(principal_id)
        if target.kind is not PrincipalKind.AGENT:
            raise PermissionDenied("tokens are issued to agents; humans log in")
        k.record_event(actor, "principal.agent_token_issued", "principal", principal_id, {})
        return {"token": state["sessions"].issue(principal_id)}

    # -- reference data -------------------------------------------------------------------
    @app.get("/api/reference/citations")
    def citations() -> dict[str, Any]:
        return {k: c.to_dict() for k, c in CITATIONS.items()}

    @app.get("/api/reference/methods")
    def methods() -> dict[str, Any]:
        return {k: m.to_dict() for k, m in METHODS.items()}

    @app.get("/api/reference/parameters")
    def parameters() -> dict[str, Any]:
        return {"version": REGISTRY_VERSION,
                "parameters": {k: p.as_quantity().to_dict() for k, p in REFERENCE_PARAMETERS.items()}}

    @app.get("/api/drivers")
    def drivers(k: Kernel = Depends(get_kernel)) -> list[dict[str, Any]]:
        return [d.describe() for d in k.registry]

    @app.get("/api/drivers/{driver_id}")
    def driver(driver_id: str, k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.registry.get(driver_id).describe()

    # -- programmes and compounds ---------------------------------------------------------
    @app.get("/api/programs")
    def programs(actor: Principal = Depends(current),
                 k: Kernel = Depends(get_kernel)) -> list[dict[str, Any]]:
        return k.programs()

    @app.post("/api/programs")
    def create_program(body: ProgramBody, actor: Principal = Depends(current),
                       k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        try:
            ctx = ProgramContext.from_dict(body.context)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"invalid programme context: {exc}") from None
        return k.create_program(actor, name=body.name, context=ctx, sponsor=body.sponsor)

    @app.get("/api/programs/{program_id}")
    def program(program_id: str, actor: Principal = Depends(current),
                k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.program_view(program_id)

    @app.patch("/api/programs/{program_id}/context")
    def change_context(program_id: str, body: ContextChangeBody,
                       actor: Principal = Depends(current),
                       k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.update_program_context(actor, program_id, body.changes, reason=body.reason)

    @app.get("/api/programs/{program_id}/readiness")
    def readiness(program_id: str, milestone: Timing = Query(Timing.BEFORE_FIRST_IN_HUMAN),
                  actor: Principal = Depends(current),
                  k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        from hos.ind import readiness_report
        return readiness_report(k, program_id, milestone)

    @app.post("/api/programs/{program_id}/module4")
    def module4(program_id: str, actor: Principal = Depends(current),
                k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        from hos.ind import assemble_module4
        return assemble_module4(k, actor, program_id)

    @app.post("/api/programs/{program_id}/compounds")
    def add_compound(program_id: str, body: CompoundBody, actor: Principal = Depends(current),
                     k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.register_compound(actor, program_id, name=body.name, smiles=body.smiles)

    @app.get("/api/compounds/{compound_id}")
    def compound(compound_id: str, actor: Principal = Depends(current),
                 k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.compound_view(compound_id)

    @app.post("/api/compounds/{compound_id}/enrich")
    def enrich(compound_id: str, actor: Principal = Depends(current),
               k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        from hos.data_sources import ChEMBLClient, PubChemClient
        from hos.data_sources.enrich import enrich_compound
        from hos.data_sources.http import CachedHttp
        from hos.db.store import default_data_dir
        http = state.get("http") or CachedHttp(cache_dir=default_data_dir() / "source_cache")
        state["http"] = http
        return enrich_compound(k, actor, compound_id, pubchem=PubChemClient(http),
                               chembl=ChEMBLClient(http))

    # -- studies --------------------------------------------------------------------------
    @app.get("/api/studies")
    def studies(program_id: str | None = None, actor: Principal = Depends(current),
                k: Kernel = Depends(get_kernel)) -> list[dict[str, Any]]:
        return k.studies(program_id)

    @app.post("/api/studies")
    def create_study(body: StudyBody, actor: Principal = Depends(current),
                     k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.create_study(actor, program_id=body.program_id, compound_id=body.compound_id,
                              requirement_id=body.requirement_id, driver_id=body.driver_id,
                              hypothesis=body.hypothesis)

    @app.get("/api/studies/{study_id}")
    def study(study_id: str, actor: Principal = Depends(current),
              k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.study_view(study_id)

    @app.post("/api/studies/{study_id}/design")
    def design(study_id: str, body: DesignBody, actor: Principal = Depends(current),
               k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.design_study(actor, study_id, body.parameters, reason=body.reason)

    @app.post("/api/studies/{study_id}/plan")
    def plan(study_id: str, actor: Principal = Depends(current),
             k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.plan_study(actor, study_id)

    @app.post("/api/studies/{study_id}/dispatch")
    def dispatch(study_id: str, body: DispatchBody, actor: Principal = Depends(current),
                 k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.dispatch_study(actor, study_id, body.target)

    @app.get("/api/studies/{study_id}/bundle")
    def bundle(study_id: str, actor: Principal = Depends(current),
               k: Kernel = Depends(get_kernel)) -> Response:
        return Response(k.dispatch_bundle(study_id), media_type="application/zip",
                        headers={"Content-Disposition":
                                 f'attachment; filename="{study_id}_dispatch.zip"'})

    @app.get("/api/studies/{study_id}/template")
    def template(study_id: str, actor: Principal = Depends(current),
                 k: Kernel = Depends(get_kernel)) -> PlainTextResponse:
        row = k.repo.study(study_id)
        d = k.registry.get(row.driver_id)
        t = d.data_template(d.validate_parameters(row.parameters))
        return PlainTextResponse(t.blank_csv(study_id), media_type="text/csv")

    @app.post("/api/studies/{study_id}/data")
    async def upload(study_id: str, request: Request, filename: str = Query("upload.csv"),
                     reason: str | None = Query(None), actor: Principal = Depends(current),
                     k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        content = await request.body()
        return k.receive_data(actor, study_id, content, filename=filename, reason=reason)

    @app.post("/api/studies/{study_id}/data/simulated")
    def receive_simulated(study_id: str, body: ReasonBody, actor: Principal = Depends(current),
                          k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.receive_data(actor, study_id, None, reason=body.reason)

    @app.put("/api/studies/{study_id}/inputs")
    def inputs(study_id: str, body: InputsBody, actor: Principal = Depends(current),
               k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.set_analysis_inputs(actor, study_id, body.inputs)

    @app.post("/api/studies/{study_id}/analyze")
    def analyze(study_id: str, body: ReasonBody, actor: Principal = Depends(current),
                k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.analyze_study(actor, study_id, reason=body.reason)

    @app.post("/api/studies/{study_id}/determinations")
    def determination(study_id: str, body: DeterminationBody,
                      actor: Principal = Depends(current),
                      k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        signer = reauth(k, actor, body.password)
        return k.record_determination(signer, study_id, key=body.key, value=body.value,
                                      unit=body.unit, rationale=body.rationale,
                                      reason=body.reason)

    @app.post("/api/studies/{study_id}/report")
    def report(study_id: str, actor: Principal = Depends(current),
               k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.report_study(actor, study_id)

    @app.get("/api/studies/{study_id}/report.md")
    def report_md(study_id: str, actor: Principal = Depends(current),
                  k: Kernel = Depends(get_kernel)) -> PlainTextResponse:
        row = k.repo.study(study_id)
        if not row.report:
            raise NotFound("no report")
        return PlainTextResponse(row.report["markdown"], media_type="text/markdown")

    @app.post("/api/studies/{study_id}/sign")
    def sign_study(study_id: str, body: SignBody, actor: Principal = Depends(current),
                   k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        signer = reauth(k, actor, body.password)
        return k.sign_study(signer, study_id, role=body.role, meaning=body.meaning,
                            statement=body.statement)

    @app.post("/api/studies/{study_id}/approve")
    def approve(study_id: str, body: ApproveBody, actor: Principal = Depends(current),
                k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.approve_study(reauth(k, actor, body.password), study_id)

    @app.post("/api/studies/{study_id}/cancel")
    def cancel(study_id: str, body: CancelBody, actor: Principal = Depends(current),
               k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.cancel_study(actor, study_id, reason=body.reason)

    @app.get("/api/studies/{study_id}/artifacts")
    def artifacts(study_id: str, kind: str | None = None, actor: Principal = Depends(current),
                  k: Kernel = Depends(get_kernel)) -> list[dict[str, Any]]:
        return k.artifacts(study_id, kind)

    @app.get("/api/files/{sha}")
    def file(sha: str, actor: Principal = Depends(current),
             k: Kernel = Depends(get_kernel)) -> Response:
        meta = k.repo.file_meta(sha)
        return Response(k.files.get(sha), media_type=meta.media_type,
                        headers={"Content-Disposition": f'attachment; filename="{meta.filename}"'})

    # -- audit ----------------------------------------------------------------------------
    # -- study import (docs/14 P1) ---------------------------------------------------------
    @app.post("/api/programs/{program_id}/imports")
    async def create_import(program_id: str, request: Request, compound_id: str = Query(...),
                            requirement_id: str = Query(...), filename: str = Query(...),
                            title: str = Query(...), laboratory: str = Query(...),
                            report_date: str = Query(...), glp: bool = Query(...),
                            lab_study_number: str | None = Query(None),
                            ctd_section: str | None = Query(None),
                            actor: Principal = Depends(current),
                            k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        report = await request.body()
        return k.imports.import_study(
            actor, program_id=program_id, compound_id=compound_id,
            requirement_id=requirement_id, report=report, filename=filename, title=title,
            laboratory=laboratory, report_date=report_date, glp=glp,
            lab_study_number=lab_study_number, ctd_section=ctd_section)

    @app.post("/api/studies/{study_id}/import/datasets")
    async def import_dataset(study_id: str, request: Request, filename: str = Query(...),
                             description: str = Query(""), actor: Principal = Depends(current),
                             k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.imports.add_import_dataset(actor, study_id, await request.body(),
                                            filename=filename, description=description)

    @app.post("/api/studies/{study_id}/import/values")
    def import_value(study_id: str, body: ImportValueBody, actor: Principal = Depends(current),
                     k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.imports.add_import_value(actor, study_id, **body.model_dump())

    @app.post("/api/studies/{study_id}/import/values/{value_id}/withdraw")
    def withdraw_value(study_id: str, value_id: str, body: ReasonRequiredBody,
                       actor: Principal = Depends(current),
                       k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.imports.withdraw_import_value(actor, study_id, value_id, reason=body.reason)

    @app.post("/api/studies/{study_id}/import/proposals")
    def propose_value(study_id: str, body: ImportProposalBody,
                      actor: Principal = Depends(current),
                      k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.imports.propose_import_value(actor, study_id, **body.model_dump())

    @app.post("/api/studies/{study_id}/import/proposals/{proposal_id}/confirm")
    def confirm_proposal(study_id: str, proposal_id: str, body: ConfirmProposalBody,
                         actor: Principal = Depends(current),
                         k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.imports.confirm_import_proposal(actor, study_id, proposal_id, page=body.page)

    @app.post("/api/studies/{study_id}/import/proposals/{proposal_id}/reject")
    def reject_proposal(study_id: str, proposal_id: str, body: ReasonRequiredBody,
                        actor: Principal = Depends(current),
                        k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.imports.reject_import_proposal(actor, study_id, proposal_id,
                                                reason=body.reason)

    @app.post("/api/studies/{study_id}/import/sign")
    def sign_import(study_id: str, body: SignBody, actor: Principal = Depends(current),
                    k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        signer = reauth(k, actor, body.password)
        return k.imports.sign_import(signer, study_id, role=body.role, meaning=body.meaning,
                                     statement=body.statement)

    @app.post("/api/studies/{study_id}/import/complete")
    def complete_import(study_id: str, body: ApproveBody, actor: Principal = Depends(current),
                        k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.imports.complete_import(reauth(k, actor, body.password), study_id)

    @app.post("/api/studies/{study_id}/import/supersede")
    def supersede_import(study_id: str, body: SupersedeBody, actor: Principal = Depends(current),
                         k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return k.imports.supersede_import(actor, study_id, by_study_id=body.by_study_id,
                                          reason=body.reason)

    @app.get("/api/studies/{study_id}/import/report")
    def import_report(study_id: str, actor: Principal = Depends(current),
                      k: Kernel = Depends(get_kernel)) -> Response:
        content, filename, media = k.imports.import_report_file(study_id)
        return Response(content, media_type=media,
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @app.get("/api/requirements/{requirement_id}/import-fields")
    def import_fields_for(requirement_id: str) -> list[dict[str, Any]]:
        from hos.kernel.import_specs import import_fields
        return [f.to_dict() for f in import_fields(requirement_id)]

    # -- regulatory compiler diff and rehearsal (docs/14 P10) --------------------------------
    @app.post("/api/regulatory/diff")
    def regulatory_diff(body: DiffBody) -> dict[str, Any]:
        from hos.core.regulatory.diff import diff_contexts
        try:
            a, b = ProgramContext.from_dict(body.a), ProgramContext.from_dict(body.b)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"invalid programme context: {exc}") from None
        return diff_contexts(a, b).to_dict()

    @app.post("/api/programs/{program_id}/what-if")
    def what_if(program_id: str, body: WhatIfBody, actor: Principal = Depends(current),
                k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        from hos.core.regulatory.diff import diff_contexts
        cur = k.repo.program(program_id).context
        try:
            a = ProgramContext.from_dict(cur)
            b = ProgramContext.from_dict({**cur, **body.changes})
        except (KeyError, ValueError) as exc:
            raise ValueError(f"invalid programme context: {exc}") from None
        return diff_contexts(a, b).to_dict()

    @app.post("/api/programs/{program_id}/rehearsal")
    def rehearsal(program_id: str, body: RehearsalBody, actor: Principal = Depends(current),
                  k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        from hos.ind.rehearsal import rehearse
        return rehearse(k, actor, program_id, body.plan, body.milestone, body.compound_id)

    # -- verification bundle (docs/14 P9) ----------------------------------------------------
    @app.post("/api/verify")
    async def verify_upload(request: Request, actor: Principal = Depends(current)
                            ) -> dict[str, Any]:
        from hos.verify import verify_bundle
        return verify_bundle(await request.body()).to_dict()

    @app.get("/api/files/{sha}/verify")
    def verify_stored(sha: str, actor: Principal = Depends(current),
                      k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        from hos.verify import verify_bundle
        return verify_bundle(k.files.get(sha)).to_dict()

    @app.get("/api/ledger/verify")
    def verify(actor: Principal = Depends(current),
               k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return {"valid": True, "entries": k.verify_ledger(), "head": k.ledger.head}

    @app.get("/api/ledger/{subject_id}")
    def ledger(subject_id: str, actor: Principal = Depends(current),
               k: Kernel = Depends(get_kernel)) -> list[dict[str, Any]]:
        return k.history(subject_id)

    return app


app = create_app()
