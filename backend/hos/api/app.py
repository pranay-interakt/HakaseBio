"""REST API over the kernel.

Authentication: humans log in with id + password and receive a bearer token; agents use a
token issued by an administrator. Every electronic-signature action (expert determination,
report signature, approval) requires the human's password again at the moment of signing
(21 CFR 11.200), verified by the kernel before the signature is created.

Run: ``uvicorn hos.api.app:app`` (``HOS_DATA_DIR`` / ``HOS_DATABASE_URL`` configure storage).
"""

from __future__ import annotations

import hmac
import logging
import os
import re
import secrets
import threading
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import quote

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from hos import __version__
from hos.api.limits import BodyLimit
from hos.api.observability import (
    RequestLog,
    alert,
    configure_logging,
    request_context,
    set_principal,
)
from hos.core.citations import CITATIONS
from hos.core.descriptors import InvalidStructureError
from hos.core.methods import METHODS
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

__all__ = ["app", "attachment", "create_app"]

_log = logging.getLogger(__name__)


class LoginThrottle:
    """At most ``limit`` sign-in attempts per client address per minute (21 CFR 11.300(d)); an
    in-process guard in front of the per-account lockout."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._seen: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, address: str) -> bool:
        now = time.monotonic()
        with self._lock:
            recent = [t for t in self._seen.get(address, []) if now - t < 60.0]
            if len(recent) >= self.limit:
                self._seen[address] = recent
                return False
            self._seen[address] = [*recent, now]
            return True


# ---- request bodies ---------------------------------------------------------------


class SetupBody(BaseModel):
    principal_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    password: str
    setup_token: str = Field(
        description="one-time token printed in the server log at start-up, or HOS_BOOTSTRAP_TOKEN"
    )


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


class PasswordBody(BaseModel):
    current_password: str
    new_password: str


class RolesBody(BaseModel):
    roles: list[Role]
    reason: str


class ResetPasswordBody(BaseModel):
    new_password: str
    reason: str


class MemberBody(BaseModel):
    principal_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ProgramDeterminationBody(BaseModel):
    key: str
    applies: bool
    rationale: str
    password: str


class CompoundBody(BaseModel):
    name: str
    smiles: str


class BiologicBody(BaseModel):
    name: str
    entity: dict[str, Any]


class TextBody(BaseModel):
    text: str


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
    value: float | None = None
    category: str | None = None
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


class ProtocolSignBody(BaseModel):
    statement: str
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


def _validation_errors(errors: list[Any]) -> list[str]:
    """Field errors without the submitted values: FastAPI and pydantic echo the input, which
    for a login or signature request includes the password."""
    return [
        f"{'.'.join(str(x) for x in e.get('loc', ())) or 'request'}: {e.get('msg', '')}"
        for e in errors
    ]


def attachment(filename: str) -> str:
    """``Content-Disposition`` for a user-supplied filename (RFC 6266, docs/15 P3). An ASCII
    ``filename`` with quotes, separators and control characters replaced, for old clients, and
    the exact name UTF-8 percent-encoded in ``filename*`` (RFC 8187)."""
    name = filename.replace("\\", "/").rsplit("/", 1)[-1].strip() or "download"
    fallback = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(" .")[:200] or "download"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"


class Page:
    """``limit`` and ``offset`` for list endpoints (docs/15 P2.5). The body stays a list; the
    total is in ``X-Total-Count``."""

    def __init__(
        self, limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)
    ) -> None:
        self.limit, self.offset = limit, offset

    @staticmethod
    def send(response: Response, items: list[dict[str, Any]], total: int) -> list[dict[str, Any]]:
        response.headers["X-Total-Count"] = str(total)
        return items


def create_app(kernel: Kernel | None = None, *, bootstrap_token: str | None = None) -> FastAPI:
    """``bootstrap_token`` (or HOS_BOOTSTRAP_TOKEN) is required to create the first
    administrator; without either, a one-time token is generated and printed in the server log
    at start-up, so only whoever runs the server can initialise it. The interactive API docs
    are served only when HOS_API_DOCS=1."""
    docs = os.environ.get("HOS_API_DOCS", "").lower() in ("1", "true", "yes")
    setup_token = (
        bootstrap_token or os.environ.get("HOS_BOOTSTRAP_TOKEN") or secrets.token_urlsafe(18)
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if (
            not (bootstrap_token or os.environ.get("HOS_BOOTSTRAP_TOKEN"))
            and not get_kernel().repo.principals()
        ):
            _log.warning("First run: create the administrator with setup token %s", setup_token)
        yield

    app = FastAPI(
        title="Hakase Operating System API",
        version=__version__,
        description="Preclinical study kernel: programmes, study sets, drivers, "
        "execution, analysis, attestation and IND assembly. Every "
        "scientific value carries provenance.",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    origins = [
        o
        for o in os.environ.get(
            "HOS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if o
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Total-Count", "X-Request-ID"],
    )
    app.add_middleware(BodyLimit)  # docs/15 P2.5
    app.add_middleware(RequestLog)  # outermost: docs/15 P2.7
    configure_logging()
    state: dict[str, Any] = {"kernel": kernel}
    throttle = LoginThrottle(int(os.environ.get("HOS_LOGIN_ATTEMPTS_PER_MINUTE", "10")))

    def get_kernel() -> Kernel:
        if state["kernel"] is None:
            state["kernel"] = Kernel()
        k: Kernel = state["kernel"]
        return k

    def current(
        request: Request,
        authorization: str | None = Header(default=None),
        k: Kernel = Depends(get_kernel),
    ) -> Principal:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "missing bearer token")
        p = k.resolve_session(authorization.split(" ", 1)[1])
        if p is None:
            raise HTTPException(401, "invalid or expired token")
        set_principal(p.id)
        if k.repo.principal(p.id).must_change_password and request.url.path not in (
            "/api/me",
            "/api/auth/password",
            "/api/auth/logout",
        ):
            raise PermissionDenied("change your password before continuing")
        return p

    def reauth(k: Kernel, actor: Principal, password: str) -> Principal:
        """21 CFR 11.200: verify the signer's credentials at the moment of signing."""
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("only humans can sign")
        return k.authenticate(actor.id, password)

    # -- access (docs/15 P0.3): every id in a path is checked before the handler runs; out
    # of scope answers like a missing object, so it does not reveal that the object exists --
    def _hidden(kind: str, ident: str) -> NotFound:
        return NotFound(f"no {kind} {ident}")

    def program_access(
        program_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> None:
        try:
            ok = k.can_access(actor, program_id)
        except NotFound:
            ok = False
        if not ok:
            raise _hidden("programme", program_id)

    def study_access(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> None:
        try:
            ok = k.can_access(actor, k.repo.study(study_id).program_id)
        except NotFound:
            ok = False
        if not ok:
            raise _hidden("study", study_id)

    def compound_access(
        compound_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> None:
        try:
            ok = k.can_access(actor, k.repo.compound(compound_id).program_id)
        except NotFound:
            ok = False
        if not ok:
            raise _hidden("compound", compound_id)

    def file_access(
        sha: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> None:
        programs = k.repo.file_programs(sha)
        # a file stored before files were linked to programmes stays with the default
        # organisation
        ok = (
            any(k.can_access(actor, pid) for pid in programs)
            if programs
            else actor.organisation is None
        )
        if not ok:
            raise _hidden("file", sha)

    def ledger_access(
        subject_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> None:
        for getter, check in (
            (k.repo.program, lambda r: k.can_access(actor, r.id)),
            (k.repo.study, lambda r: k.can_access(actor, r.program_id)),
            (k.repo.compound, lambda r: k.can_access(actor, r.program_id)),
        ):
            try:
                row = getter(subject_id)
            except NotFound:
                continue
            if not check(row):
                raise _hidden("record", subject_id)
            return
        if subject_id in {r.id for r in k.repo.principals()}:
            target = k.get_principal(subject_id)
            admin_of = Role.ADMIN in actor.roles and actor.organisation in (
                None,
                target.organisation,
            )
            if subject_id != actor.id and not admin_of:
                raise PermissionDenied(
                    "a user's own history is visible to that user and administrators"
                )
            return
        file_access(subject_id, actor, k)

    # -- error mapping -----------------------------------------------------------------
    def _err(code: int, exc: Exception, **extra: Any) -> JSONResponse:
        return JSONResponse(
            status_code=code,
            content={
                "error": type(exc).__name__,
                "detail": str(exc),
                **extra,
                "request_id": request_context()["request_id"],
            },
        )

    def _http(exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            headers=exc.headers,
            content={"detail": exc.detail, "request_id": request_context()["request_id"]},
        )

    def _ledger_failed(exc: LedgerIntegrityError) -> JSONResponse:
        alert("ledger_integrity", str(exc))
        return JSONResponse(
            status_code=500,
            content={
                "error": "LedgerIntegrityError",
                "detail": "the audit trail failed its integrity "
                "check; this has been reported to the administrators",
                "request_id": request_context()["request_id"],
            },
        )

    app.add_exception_handler(StarletteHTTPException, lambda r, e: _http(e))

    app.add_exception_handler(NotFound, lambda r, e: _err(404, e))
    app.add_exception_handler(PermissionDenied, lambda r, e: _err(403, e))
    exc_t: type[Exception]
    for exc_t in (AttestationRequired, EvidenceInadmissible, IllegalTransition):
        app.add_exception_handler(exc_t, lambda r, e: _err(409, e))
    app.add_exception_handler(IngestError, lambda r, e: _err(422, e, errors=list(e.errors)))
    app.add_exception_handler(LedgerIntegrityError, lambda r, e: _ledger_failed(e))
    # another writer held the lock too long, or the database is down; the unit of work
    # changed nothing. The driver's message (SQL, parameters) is not for clients.
    app.add_exception_handler(
        OperationalError,
        lambda r, e: JSONResponse(
            status_code=503,
            content={
                "error": "Unavailable",
                "detail": "the database is busy "
                "or unavailable; nothing was changed, try again shortly",
                "request_id": request_context()["request_id"],
            },
        ),
    )
    for exc_t in (DriverError, KernelError, InvalidStructureError, ValueError):
        app.add_exception_handler(exc_t, lambda r, e: _err(400, e))

    def _invalid(code: int, exc: Any) -> JSONResponse:
        return JSONResponse(
            status_code=code,
            content={
                "error": "ValidationError",
                "detail": "the request is incomplete or not valid",
                "errors": _validation_errors(exc.errors()),
                "request_id": request_context()["request_id"],
            },
        )

    app.add_exception_handler(RequestValidationError, lambda r, e: _invalid(422, e))
    app.add_exception_handler(ValidationError, lambda r, e: _invalid(400, e))

    # -- system -------------------------------------------------------------------------
    @app.get("/api/health")
    def health() -> dict[str, Any]:
        """Liveness: the process answers. Touches nothing else, so a database outage does
        not get the API restarted."""
        return {"status": "ok"}

    @app.get("/api/ready")
    def ready(k: Kernel = Depends(get_kernel)) -> JSONResponse:
        """Readiness: the database answers at this release's schema and the file store and
        anchor log are writable. Public, so it names checks only, never their errors."""
        checks = k.readiness()
        return JSONResponse(
            status_code=200 if all(checks.values()) else 503,
            content={"ready": all(checks.values()), "checks": checks},
        )

    @app.get("/api/setup")
    def setup_status(k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        """Public: only what the sign-in page needs."""
        return {"initialised": bool(k.repo.principals())}

    @app.get("/api/system")
    def system(
        actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return {
            "version": __version__,
            "drivers": k.registry.ids(),
            "reference_parameters": REGISTRY_VERSION,
        }

    @app.post("/api/setup")
    def setup(body: SetupBody, k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        if k.repo.principals():
            raise PermissionDenied("system already initialised")
        if not hmac.compare_digest(body.setup_token.encode(), setup_token.encode()):
            raise PermissionDenied("the setup token is not valid")
        p = k.register_principal(
            None,
            principal_id=body.principal_id,
            name=body.name,
            kind=PrincipalKind.HUMAN,
            roles=[Role.ADMIN],
            password=body.password,
        )
        return p.to_dict()

    @app.post("/api/auth/login")
    def login(body: LoginBody, request: Request, k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        if not throttle.allow(request.client.host if request.client else "unknown"):
            raise HTTPException(429, "too many sign-in attempts; wait a minute")
        token, p = k.login(body.principal_id, body.password)
        return {
            "token": token,
            "principal": p.to_dict(),
            "must_change_password": bool(k.repo.principal(p.id).must_change_password),
        }

    @app.post("/api/auth/logout")
    def logout(
        authorization: str | None = Header(default=None), k: Kernel = Depends(get_kernel)
    ) -> dict[str, str]:
        if authorization and authorization.lower().startswith("bearer "):
            k.logout(authorization.split(" ", 1)[1])
        return {"status": "logged out"}

    @app.post("/api/auth/password")
    def change_password(
        body: PasswordBody, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, str]:
        k.change_password(
            actor, current_password=body.current_password, new_password=body.new_password
        )
        return {"status": "password changed"}

    @app.get("/api/me")
    def me(actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)) -> dict[str, Any]:
        return {
            **actor.to_dict(),
            "must_change_password": bool(k.repo.principal(actor.id).must_change_password),
        }

    @app.get("/api/principals")
    def principals(
        actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> list[dict[str, Any]]:
        if Role.ADMIN not in actor.roles:
            raise PermissionDenied("only an administrator can list users")
        return [
            k.principal_admin_view(r.id)
            for r in k.repo.principals()
            if actor.organisation is None or r.organisation == actor.organisation
        ]

    @app.post("/api/principals")
    def add_principal(
        body: PrincipalBody, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return k.register_principal(
            actor,
            principal_id=body.principal_id,
            name=body.name,
            kind=body.kind,
            roles=body.roles,
            password=body.password,
            organisation=body.organisation,
        ).to_dict()

    @app.post("/api/principals/{principal_id}/agent-token")
    def agent_token(
        principal_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, str]:
        return {"token": k.issue_agent_key(actor, principal_id)}

    @app.post("/api/principals/{principal_id}/roles")
    def change_roles(
        principal_id: str,
        body: RolesBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.change_roles(actor, principal_id, body.roles, reason=body.reason)

    @app.post("/api/principals/{principal_id}/deactivate")
    def deactivate(
        principal_id: str,
        body: ReasonRequiredBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.set_principal_active(actor, principal_id, active=False, reason=body.reason)

    @app.post("/api/principals/{principal_id}/reactivate")
    def reactivate(
        principal_id: str,
        body: ReasonRequiredBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.set_principal_active(actor, principal_id, active=True, reason=body.reason)

    @app.post("/api/principals/{principal_id}/unlock")
    def unlock(
        principal_id: str,
        body: ReasonRequiredBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.unlock_principal(actor, principal_id, reason=body.reason)

    @app.post("/api/principals/{principal_id}/reset-password")
    def reset_password(
        principal_id: str,
        body: ResetPasswordBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.reset_password(
            actor, principal_id, new_password=body.new_password, reason=body.reason
        )

    # -- reference data -------------------------------------------------------------------
    @app.get("/api/reference/citations")
    def citations(actor: Principal = Depends(current)) -> dict[str, Any]:
        return {k: c.to_dict() for k, c in CITATIONS.items()}

    @app.get("/api/reference/methods")
    def methods(actor: Principal = Depends(current)) -> dict[str, Any]:
        return {k: m.to_dict() for k, m in METHODS.items()}

    @app.get("/api/reference/parameters")
    def parameters(actor: Principal = Depends(current)) -> dict[str, Any]:
        return {
            "version": REGISTRY_VERSION,
            "parameters": {k: p.as_quantity().to_dict() for k, p in REFERENCE_PARAMETERS.items()},
        }

    @app.get("/api/drivers")
    def drivers(
        actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> list[dict[str, Any]]:
        return [d.describe() for d in k.registry]

    @app.get("/api/drivers/{driver_id}")
    def driver(
        driver_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return k.registry.get(driver_id).describe()

    # -- programmes and compounds ---------------------------------------------------------
    @app.get("/api/programs")
    def programs(
        response: Response,
        page: Page = Depends(),
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> list[dict[str, Any]]:
        return page.send(response, *k.programs_page(actor, page.limit, page.offset))

    @app.post("/api/programs")
    def create_program(
        body: ProgramBody, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        try:
            ctx = ProgramContext.from_dict(body.context)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"invalid programme context: {exc}") from None
        return k.create_program(actor, name=body.name, context=ctx, sponsor=body.sponsor)

    @app.get("/api/programs/{program_id}", dependencies=[Depends(program_access)])
    def program(
        program_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return k.program_view(program_id)

    @app.patch("/api/programs/{program_id}/context", dependencies=[Depends(program_access)])
    def change_context(
        program_id: str,
        body: ContextChangeBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.update_program_context(actor, program_id, body.changes, reason=body.reason)

    @app.post("/api/programs/{program_id}/determinations", dependencies=[Depends(program_access)])
    def program_determination(
        program_id: str,
        body: ProgramDeterminationBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.record_program_determination(
            reauth(k, actor, body.password),
            program_id,
            key=body.key,
            applies=body.applies,
            rationale=body.rationale,
        )

    @app.get("/api/programs/{program_id}/members", dependencies=[Depends(program_access)])
    def members(
        program_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return k.program_members(program_id)

    @app.post("/api/programs/{program_id}/members", dependencies=[Depends(program_access)])
    def add_member(
        program_id: str,
        body: MemberBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.add_program_member(actor, program_id, body.principal_id, reason=body.reason)

    @app.post(
        "/api/programs/{program_id}/members/{principal_id}/remove",
        dependencies=[Depends(program_access)],
    )
    def remove_member(
        program_id: str,
        principal_id: str,
        body: ReasonRequiredBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.remove_program_member(actor, program_id, principal_id, reason=body.reason)

    @app.get("/api/programs/{program_id}/readiness", dependencies=[Depends(program_access)])
    def readiness(
        program_id: str,
        milestone: Timing = Query(Timing.BEFORE_FIRST_IN_HUMAN),
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        from hos.ind import readiness_report

        return readiness_report(k, program_id, milestone)

    @app.post("/api/programs/{program_id}/module4", dependencies=[Depends(program_access)])
    def module4(
        program_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        from hos.ind import assemble_module4

        return assemble_module4(k, actor, program_id)

    @app.post("/api/programs/{program_id}/compounds", dependencies=[Depends(program_access)])
    def add_compound(
        program_id: str,
        body: CompoundBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.register_compound(actor, program_id, name=body.name, smiles=body.smiles)

    @app.post("/api/programs/{program_id}/biologics", dependencies=[Depends(program_access)])
    def add_biologic(
        program_id: str,
        body: BiologicBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.register_biologic(actor, program_id, name=body.name, entity=body.entity)

    @app.post("/api/sequence/fasta")
    def parse_fasta(body: TextBody, actor: Principal = Depends(current)) -> dict[str, Any]:
        from hos.core.sequence import parse_fasta

        records, errors = parse_fasta(body.text)
        return {
            "records": [
                {"description": r.description, "sequence": r.sequence, "residues": len(r.sequence)}
                for r in records
            ],
            "errors": errors,
        }

    @app.post("/api/sequence/helm")
    def check_helm(body: TextBody, actor: Principal = Depends(current)) -> dict[str, Any]:
        from hos.core.sequence import HelmError, parse_helm

        try:
            return {"structure": parse_helm(body.text).to_dict(), "errors": []}
        except HelmError as exc:
            return {"structure": None, "errors": exc.errors}

    @app.get("/api/compounds/{compound_id}", dependencies=[Depends(compound_access)])
    def compound(
        compound_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return k.compound_view(compound_id)

    @app.post("/api/compounds/{compound_id}/enrich", dependencies=[Depends(compound_access)])
    def enrich(
        compound_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        from hos.data_sources import ChEMBLClient, PubChemClient
        from hos.data_sources.enrich import enrich_compound
        from hos.data_sources.http import CachedHttp
        from hos.db.store import default_data_dir

        http = state.get("http") or CachedHttp(cache_dir=default_data_dir() / "source_cache")
        state["http"] = http
        return enrich_compound(
            k, actor, compound_id, pubchem=PubChemClient(http), chembl=ChEMBLClient(http)
        )

    # -- studies --------------------------------------------------------------------------
    @app.get("/api/studies")
    def studies(
        response: Response,
        program_id: str | None = None,
        page: Page = Depends(),
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> list[dict[str, Any]]:
        if program_id is not None:
            program_access(program_id, actor, k)
        return page.send(response, *k.studies_page(actor, program_id, page.limit, page.offset))

    @app.post("/api/studies")
    def create_study(
        body: StudyBody, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        program_access(body.program_id, actor, k)
        return k.create_study(
            actor,
            program_id=body.program_id,
            compound_id=body.compound_id,
            requirement_id=body.requirement_id,
            driver_id=body.driver_id,
            hypothesis=body.hypothesis,
        )

    @app.get("/api/studies/{study_id}", dependencies=[Depends(study_access)])
    def study(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return k.study_view(study_id)

    @app.post("/api/studies/{study_id}/design", dependencies=[Depends(study_access)])
    def design(
        study_id: str,
        body: DesignBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.design_study(actor, study_id, body.parameters, reason=body.reason)

    @app.post("/api/studies/{study_id}/plan", dependencies=[Depends(study_access)])
    def plan(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return k.plan_study(actor, study_id)

    @app.post("/api/studies/{study_id}/dispatch", dependencies=[Depends(study_access)])
    def dispatch(
        study_id: str,
        body: DispatchBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.dispatch_study(actor, study_id, body.target)

    @app.get("/api/studies/{study_id}/bundle", dependencies=[Depends(study_access)])
    def bundle(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> Response:
        return Response(
            k.dispatch_bundle(study_id),
            media_type="application/zip",
            headers={"Content-Disposition": attachment(f"{study_id}_dispatch.zip")},
        )

    @app.get("/api/studies/{study_id}/template", dependencies=[Depends(study_access)])
    def template(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> PlainTextResponse:
        row = k.repo.study(study_id)
        d = k.registry.get(row.driver_id)
        t = d.data_template(d.validate_parameters(row.parameters))
        return PlainTextResponse(t.blank_csv(study_id), media_type="text/csv")

    @app.post("/api/studies/{study_id}/data", dependencies=[Depends(study_access)])
    async def upload(
        study_id: str,
        request: Request,
        filename: str = Query("upload.csv"),
        reason: str | None = Query(None),
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        content = await request.body()
        return k.receive_data(actor, study_id, content, filename=filename, reason=reason)

    @app.post("/api/studies/{study_id}/data/simulated", dependencies=[Depends(study_access)])
    def receive_simulated(
        study_id: str,
        body: ReasonBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.receive_data(actor, study_id, None, reason=body.reason)

    @app.put("/api/studies/{study_id}/inputs", dependencies=[Depends(study_access)])
    def inputs(
        study_id: str,
        body: InputsBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.set_analysis_inputs(actor, study_id, body.inputs)

    @app.post("/api/studies/{study_id}/analyze", dependencies=[Depends(study_access)])
    def analyze(
        study_id: str,
        body: ReasonBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.analyze_study(actor, study_id, reason=body.reason)

    @app.post("/api/studies/{study_id}/determinations", dependencies=[Depends(study_access)])
    def determination(
        study_id: str,
        body: DeterminationBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        signer = reauth(k, actor, body.password)
        return k.record_determination(
            signer,
            study_id,
            key=body.key,
            value=body.value,
            unit=body.unit,
            rationale=body.rationale,
            reason=body.reason,
            category=body.category,
        )

    @app.post("/api/studies/{study_id}/report", dependencies=[Depends(study_access)])
    def report(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        return k.report_study(actor, study_id)

    @app.get("/api/studies/{study_id}/report.md", dependencies=[Depends(study_access)])
    def report_md(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> PlainTextResponse:
        row = k.repo.study(study_id)
        if not row.report:
            raise NotFound("no report")
        return PlainTextResponse(row.report["markdown"], media_type="text/markdown")

    @app.post("/api/studies/{study_id}/sign", dependencies=[Depends(study_access)])
    def sign_study(
        study_id: str,
        body: SignBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        signer = reauth(k, actor, body.password)
        return k.sign_study(
            signer, study_id, role=body.role, meaning=body.meaning, statement=body.statement
        )

    @app.post("/api/studies/{study_id}/protocol/sign", dependencies=[Depends(study_access)])
    def sign_protocol(
        study_id: str,
        body: ProtocolSignBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.sign_protocol(reauth(k, actor, body.password), study_id, statement=body.statement)

    # -- SEND export (docs/14 P5) -----------------------------------------------------------
    @app.get("/api/send/terms")
    def send_terms(actor: Principal = Depends(current)) -> dict[str, Any]:
        from hos.send.service import send_terms

        return send_terms()

    @app.get("/api/studies/{study_id}/send-export", dependencies=[Depends(study_access)])
    def send_export_context(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        from hos.send.service import send_export_context

        return send_export_context(k, study_id)

    @app.post(
        "/api/studies/{study_id}/send-export",
        response_model=None,
        dependencies=[Depends(study_access)],
    )
    def send_export(
        study_id: str,
        body: dict[str, Any],
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any] | JSONResponse:
        from pydantic import ValidationError

        from hos.send.service import send_export
        from hos.send.spec import SendExportSpec

        try:
            spec = SendExportSpec.model_validate(body)
        except ValidationError as exc:
            return JSONResponse(
                status_code=422,
                content={
                    "error": "ValidationError",
                    "detail": "the export details are incomplete or not valid SEND terms",
                    "errors": [
                        f"{'.'.join(str(x) for x in e['loc']) or 'spec'}: {e['msg']}"
                        for e in exc.errors()
                    ],
                },
            )
        return send_export(k, actor, study_id, spec)

    @app.post("/api/studies/{study_id}/approve", dependencies=[Depends(study_access)])
    def approve(
        study_id: str,
        body: ApproveBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.approve_study(reauth(k, actor, body.password), study_id)

    @app.post("/api/studies/{study_id}/cancel", dependencies=[Depends(study_access)])
    def cancel(
        study_id: str,
        body: CancelBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.cancel_study(actor, study_id, reason=body.reason)

    @app.get("/api/studies/{study_id}/artifacts", dependencies=[Depends(study_access)])
    def artifacts(
        study_id: str,
        response: Response,
        kind: str | None = None,
        page: Page = Depends(),
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> list[dict[str, Any]]:
        return page.send(response, *k.artifacts_page(study_id, kind, page.limit, page.offset))

    @app.get("/api/files/{sha}", dependencies=[Depends(file_access)])
    def file(
        sha: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> Response:
        meta = k.repo.file_meta(sha)
        return Response(
            k.files.get(sha),
            media_type=meta.media_type,
            headers={"Content-Disposition": attachment(meta.filename)},
        )

    # -- audit ----------------------------------------------------------------------------
    # -- study import (docs/14 P1) ---------------------------------------------------------
    @app.post("/api/programs/{program_id}/imports", dependencies=[Depends(program_access)])
    async def create_import(
        program_id: str,
        request: Request,
        compound_id: str = Query(...),
        requirement_id: str = Query(...),
        filename: str = Query(...),
        title: str = Query(...),
        laboratory: str = Query(...),
        report_date: str = Query(...),
        glp: bool = Query(...),
        lab_study_number: str | None = Query(None),
        ctd_section: str | None = Query(None),
        components: str | None = Query(None, description="comma-separated parts the report covers"),
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        report = await request.body()
        return k.imports.import_study(
            actor,
            program_id=program_id,
            compound_id=compound_id,
            requirement_id=requirement_id,
            report=report,
            filename=filename,
            title=title,
            laboratory=laboratory,
            report_date=report_date,
            glp=glp,
            lab_study_number=lab_study_number,
            ctd_section=ctd_section,
            components=[c.strip() for c in components.split(",") if c.strip()]
            if components
            else None,
        )

    @app.post("/api/studies/{study_id}/import/datasets", dependencies=[Depends(study_access)])
    async def import_dataset(
        study_id: str,
        request: Request,
        filename: str = Query(...),
        description: str = Query(""),
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.imports.add_import_dataset(
            actor, study_id, await request.body(), filename=filename, description=description
        )

    @app.post("/api/studies/{study_id}/import/values", dependencies=[Depends(study_access)])
    def import_value(
        study_id: str,
        body: ImportValueBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.imports.add_import_value(actor, study_id, **body.model_dump())

    @app.post(
        "/api/studies/{study_id}/import/values/{value_id}/withdraw",
        dependencies=[Depends(study_access)],
    )
    def withdraw_value(
        study_id: str,
        value_id: str,
        body: ReasonRequiredBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.imports.withdraw_import_value(actor, study_id, value_id, reason=body.reason)

    @app.post("/api/studies/{study_id}/import/proposals", dependencies=[Depends(study_access)])
    def propose_value(
        study_id: str,
        body: ImportProposalBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.imports.propose_import_value(actor, study_id, **body.model_dump())

    @app.post(
        "/api/studies/{study_id}/import/proposals/{proposal_id}/confirm",
        dependencies=[Depends(study_access)],
    )
    def confirm_proposal(
        study_id: str,
        proposal_id: str,
        body: ConfirmProposalBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.imports.confirm_import_proposal(actor, study_id, proposal_id, page=body.page)

    @app.post(
        "/api/studies/{study_id}/import/proposals/{proposal_id}/reject",
        dependencies=[Depends(study_access)],
    )
    def reject_proposal(
        study_id: str,
        proposal_id: str,
        body: ReasonRequiredBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.imports.reject_import_proposal(actor, study_id, proposal_id, reason=body.reason)

    @app.post("/api/studies/{study_id}/import/sign", dependencies=[Depends(study_access)])
    def sign_import(
        study_id: str,
        body: SignBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        signer = reauth(k, actor, body.password)
        return k.imports.sign_import(
            signer, study_id, role=body.role, meaning=body.meaning, statement=body.statement
        )

    @app.post("/api/studies/{study_id}/import/complete", dependencies=[Depends(study_access)])
    def complete_import(
        study_id: str,
        body: ApproveBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.imports.complete_import(reauth(k, actor, body.password), study_id)

    @app.post("/api/studies/{study_id}/import/supersede", dependencies=[Depends(study_access)])
    def supersede_import(
        study_id: str,
        body: SupersedeBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        return k.imports.supersede_import(
            actor, study_id, by_study_id=body.by_study_id, reason=body.reason
        )

    @app.get("/api/studies/{study_id}/import/report", dependencies=[Depends(study_access)])
    def import_report(
        study_id: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> Response:
        content, filename, media = k.imports.import_report_file(study_id)
        return Response(
            content, media_type=media, headers={"Content-Disposition": attachment(filename)}
        )

    @app.get("/api/requirements/{requirement_id}/import-fields")
    def import_fields_for(
        requirement_id: str, actor: Principal = Depends(current)
    ) -> list[dict[str, Any]]:
        from hos.kernel.import_specs import import_fields

        return [f.to_dict() for f in import_fields(requirement_id)]

    # -- regulatory compiler diff and rehearsal (docs/14 P10) --------------------------------
    @app.post("/api/regulatory/diff")
    def regulatory_diff(body: DiffBody, actor: Principal = Depends(current)) -> dict[str, Any]:
        from hos.core.regulatory.diff import diff_contexts

        try:
            a, b = ProgramContext.from_dict(body.a), ProgramContext.from_dict(body.b)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"invalid programme context: {exc}") from None
        return diff_contexts(a, b).to_dict()

    @app.post("/api/programs/{program_id}/what-if", dependencies=[Depends(program_access)])
    def what_if(
        program_id: str,
        body: WhatIfBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        from hos.core.regulatory.diff import diff_contexts

        cur = k.repo.program(program_id).context
        try:
            a = ProgramContext.from_dict(cur)
            b = ProgramContext.from_dict({**cur, **body.changes})
        except (KeyError, ValueError) as exc:
            raise ValueError(f"invalid programme context: {exc}") from None
        return diff_contexts(a, b).to_dict()

    @app.post("/api/programs/{program_id}/rehearsal", dependencies=[Depends(program_access)])
    def rehearsal(
        program_id: str,
        body: RehearsalBody,
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> dict[str, Any]:
        from hos.ind.rehearsal import rehearse

        return rehearse(k, actor, program_id, body.plan, body.milestone, body.compound_id)

    # -- verification bundle (docs/14 P9) ----------------------------------------------------
    @app.post("/api/verify")
    async def verify_upload(
        request: Request, actor: Principal = Depends(current)
    ) -> dict[str, Any]:
        from hos.verify import verify_bundle

        return verify_bundle(await request.body()).to_dict()

    @app.get("/api/files/{sha}/verify", dependencies=[Depends(file_access)])
    def verify_stored(
        sha: str, actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        from hos.verify import verify_bundle

        return verify_bundle(k.files.get(sha)).to_dict()

    @app.get("/api/ledger/verify")
    def verify(
        actor: Principal = Depends(current), k: Kernel = Depends(get_kernel)
    ) -> dict[str, Any]:
        """Chain, anchors and reconciliation. Findings name subjects across programmes, so
        only administrators see them; everyone sees whether the record is intact."""
        report = k.integrity()
        if not report["valid"]:
            alert(
                "ledger_integrity",
                "the integrity check found problems",
                checks=sorted({f["check"] for f in report["findings"]}),
            )
        if Role.ADMIN not in actor.roles:
            report["findings"] = len(report["findings"])
        return report

    @app.get("/api/ledger/{subject_id}", dependencies=[Depends(ledger_access)])
    def ledger(
        subject_id: str,
        response: Response,
        page: Page = Depends(),
        actor: Principal = Depends(current),
        k: Kernel = Depends(get_kernel),
    ) -> list[dict[str, Any]]:
        return page.send(response, *k.history_page(subject_id, page.limit, page.offset))

    return app


app = create_app()
