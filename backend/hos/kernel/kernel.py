"""The kernel facade: the single entry point through which every study moves.

    create_program -> derive study set -> register_compound -> create_study (driver
    matched from the requirement) -> design -> plan -> dispatch (execution target)
    -> receive_data (strict ingest) -> analyze -> record_determination (human, signed)
    -> report -> sign -> approve

Every operation checks the actor's authority, asserts the lifecycle transition, writes
an append-only artefact version, and records a hash-chained ledger entry. Nothing in
the kernel is specific to a study type; that lives in drivers, reached only through
the registry.

Two runtime integrity checks follow from the determinism rule (CLAUDE.md 5): before a
protocol is dispatched, and before a report is generated, the kernel re-runs the
driver and requires the content hash to match what was recorded. If a driver or
reference-parameter change would alter a recorded result, the kernel refuses rather
than silently producing a different document.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, ValidationError

from hos.core import units as U
from hos.core.descriptors import compute_profile
from hos.core.provenance import utc_now
from hos.core.quantity import Quantity
from hos.core.regulatory import Modality, PeptideOrigin, ProgramContext, derive_study_set
from hos.core.regulatory.context import AMINO_ACID_MODALITIES
from hos.core.regulatory.engine import RequirementStatus, StudyRequirement
from hos.db.models import CompoundRow, PrincipalRow, ProgramMemberRow, ProgramRow, StudyRow
from hos.db.repository import Repository, content_hash
from hos.db.store import CommitThenRaise, Database, FileStore, SqlLedgerBackend
from hos.drivers.base import (
    CompoundInfo,
    DataOrigin,
    ExpertDetermination,
    IngestedData,
    IngestError,
    ProtocolDocument,
    StudyDriver,
)
from hos.drivers.registry import DriverRegistry, default_registry
from hos.kernel.attestation import (
    Principal,
    PrincipalKind,
    Role,
    SignatureMeaning,
    sign,
)
from hos.kernel.entities import SequenceEntity, biologic_compound_info
from hos.kernel.entities import derive as derive_entity
from hos.kernel.errors import (
    AttestationRequired,
    DriverError,
    EvidenceInadmissible,
    KernelError,
    NotFound,
    PermissionDenied,
)
from hos.kernel.execution import TargetKind, target_from_spec
from hos.kernel.imports import ImportService
from hos.kernel.inputs import input_quantity
from hos.kernel.integrity import AnchorLog, reconcile
from hos.kernel.ledger import Ledger
from hos.kernel.lifecycle import TRANSITIONS, StudyState, assert_transition
from hos.kernel.uow import atomic

__all__ = ["WORK_ROLES", "Kernel"]

#: Roles allowed to create, design, dispatch and analyse studies.
WORK_ROLES = frozenset({Role.SCIENTIST, Role.RESPONSIBLE_SCIENTIST, Role.STUDY_DIRECTOR,
                        Role.PROGRAM_LEAD, Role.ADMIN})

_MIN_PASSWORD = 12
_SCRYPT = dict(n=2**14, r=8, p=1)



def _require_record(value: dict[str, Any] | None, what: str, study_id: str) -> dict[str, Any]:
    """Return a stored study record section, or fail with a kernel error if it is absent.

    The lifecycle guarantees these sections exist in the states that read them; this makes
    the guarantee explicit so a violated invariant surfaces as a clear error, not a crash.
    """
    if value is None:
        raise KernelError(f"study {study_id} has no {what}; the lifecycle invariant was violated")
    return value

def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${dk.hex()}"


def _check_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
    except ValueError:
        return False
    calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), dklen=32,
                          n=int(n), r=int(r), p=int(p))
    return hmac.compare_digest(calc.hex(), dk)


#: Signed programme determinations -> the ProgramContext field each one records.
PROGRAM_DETERMINATIONS = {"s6_principles_apply": "s6_determination"}



#: A hash of a random secret, checked when a principal has none, so a refusal costs the same
#: time whether or not the id exists (no user enumeration by timing).
_DUMMY_HASH = _hash_password(secrets.token_hex(16))


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Kernel:
    def __init__(self, db: Database | None = None, files: FileStore | None = None,
                 registry: DriverRegistry | None = None) -> None:
        self.db = db or Database()
        self.db.create_all()
        self.files = files or FileStore()
        self.repo = Repository(self.db, self.files)
        self.registry = registry or default_registry()
        self.ledger = Ledger(SqlLedgerBackend(self.db))
        self.imports = ImportService(self)
        # checkpoints of the ledger head outside the database (docs/15 P0.2)
        self.anchors = AnchorLog.default(self.files.root.parent)

    # ======================================================================
    # principals
    # ======================================================================

    @staticmethod
    def _principal(row: PrincipalRow) -> Principal:
        return Principal(id=row.id, name=row.name, kind=PrincipalKind(row.kind),
                         roles=frozenset(Role(r) for r in row.roles),
                         organisation=row.organisation)

    @atomic
    def register_principal(self, actor: Principal | None, *, principal_id: str, name: str,
                           kind: PrincipalKind, roles: Sequence[Role],
                           password: str | None = None,
                           organisation: str | None = None) -> Principal:
        """Create a user or agent. The first principal bootstraps the system and must be a
        human administrator; afterwards only administrators may add principals."""
        existing = self.repo.principals()
        if existing:
            if actor is None or Role.ADMIN not in actor.roles:
                raise PermissionDenied("only an administrator can register principals")
        elif kind is not PrincipalKind.HUMAN or Role.ADMIN not in roles:
            raise PermissionDenied("the first principal must be a human administrator")
        if any(p.id == principal_id for p in existing):
            raise KernelError(f"principal {principal_id!r} already exists")
        if actor is not None and actor.organisation is not None:
            # an organisation's administrator works inside that organisation only
            if organisation not in (None, actor.organisation):
                raise PermissionDenied("an organisation's administrator registers principals "
                                       "in that organisation only")
            organisation = actor.organisation
        if kind is PrincipalKind.HUMAN and (not password or len(password) < _MIN_PASSWORD):
            raise PermissionDenied(f"human principals need a password of at least "
                                   f"{_MIN_PASSWORD} characters")
        if kind is not PrincipalKind.HUMAN and any(r.is_legal_attestor for r in roles):
            raise PermissionDenied("legal attestation roles can only be held by humans")
        row = PrincipalRow(id=principal_id, name=name, kind=kind.value,
                           roles=sorted(r.value for r in roles), organisation=organisation,
                           signing_secret_hash=_hash_password(password) if password else None,
                           created_at=utc_now())
        self.repo.add_principal(row)
        p = self._principal(row)
        self._record(actor or p, "principal.registered", "principal", principal_id,
                     {"principal": p.to_dict()})
        return p

    def get_principal(self, principal_id: str) -> Principal:
        return self._principal(self.repo.principal(principal_id))

    @atomic
    def authenticate(self, principal_id: str, password: str) -> Principal:
        """Verify a human's credentials. Used at login and again at every signature
        (21 CFR 11.200 re-authentication)."""
        try:
            row = self.repo.principal(principal_id)
        except NotFound:
            # spend the same scrypt work as a real check, so timing does not reveal which ids
            # exist
            _check_password(password, _DUMMY_HASH)
            raise PermissionDenied("invalid credentials") from None
        stored = row.signing_secret_hash if row.kind == PrincipalKind.HUMAN.value else None
        if not _check_password(password, stored or _DUMMY_HASH) or not stored:
            self.ledger.record(actor_id=principal_id, actor_kind="unknown",
                               action="auth.failed", subject_type="principal",
                               subject_id=principal_id)
            # the failed attempt stays on the record although the call fails
            raise CommitThenRaise(PermissionDenied("invalid credentials"))
        return self._principal(row)

    # ======================================================================
    # access (docs/15 P0.3)
    # ======================================================================

    def can_access(self, actor: Principal, program_id: str) -> bool:
        """A programme is visible to its organisation (None is the default organisation)
        and to principals added to it from elsewhere, such as a CRO."""
        program = self.repo.program(program_id)
        return actor.organisation == program.organisation or \
            program_id in self.repo.member_programs(actor.id)

    def accessible_programs(self, actor: Principal) -> set[str]:
        guest = self.repo.member_programs(actor.id)
        return {p.id for p in self.repo.programs()
                if p.organisation == actor.organisation or p.id in guest}

    def program_members(self, program_id: str) -> dict[str, Any]:
        row = self.repo.program(program_id)
        return {"organisation": row.organisation, "members": [
            {"principal_id": m.principal_id, "name": self.repo.principal(m.principal_id).name,
             "organisation": self.repo.principal(m.principal_id).organisation,
             "added_by": m.added_by, "added_at": m.added_at.isoformat()}
            for m in self.repo.members(program_id)]}

    @atomic
    def add_program_member(self, actor: Principal, program_id: str, principal_id: str, *,
                           reason: str) -> dict[str, Any]:
        """Give a principal from another organisation access to one programme. Only a human
        of the owning organisation can do it, with a reason; it is on the record."""
        program = self.repo.program(program_id)
        if actor.kind is not PrincipalKind.HUMAN or actor.organisation != program.organisation:
            raise PermissionDenied("only a person of the owning organisation can give access")
        if not reason.strip():
            raise KernelError("a reason is required to give access")
        target = self.get_principal(principal_id)
        if target.organisation == program.organisation:
            raise KernelError(f"{principal_id} already has access through its organisation")
        if principal_id in {m.principal_id for m in self.repo.members(program_id)}:
            raise KernelError(f"{principal_id} is already a member")
        self.repo.add(ProgramMemberRow(program_id=program_id, principal_id=principal_id,
                                       added_by=actor.id, added_at=utc_now()))
        self._record(actor, "program.member_added", "program", program_id,
                     {"principal_id": principal_id, "organisation": target.organisation},
                     reason=reason)
        return self.program_members(program_id)

    @atomic
    def remove_program_member(self, actor: Principal, program_id: str, principal_id: str, *,
                              reason: str) -> dict[str, Any]:
        program = self.repo.program(program_id)
        if actor.kind is not PrincipalKind.HUMAN or actor.organisation != program.organisation:
            raise PermissionDenied("only a person of the owning organisation can remove access")
        if not reason.strip():
            raise KernelError("a reason is required to remove access")
        self.repo.remove_member(program_id, principal_id)
        self._record(actor, "program.member_removed", "program", program_id,
                     {"principal_id": principal_id}, reason=reason)
        return self.program_members(program_id)

    # ======================================================================
    # programmes and compounds
    # ======================================================================

    @atomic
    def create_program(self, actor: Principal, *, name: str, context: ProgramContext,
                       sponsor: str | None = None) -> dict[str, Any]:
        self._require_worker(actor)
        if not name.strip():
            raise KernelError("programme name is required")
        if context.s6_determination is not None:
            raise KernelError("an S6(R1) determination is recorded by its signer after the "
                              "programme exists, not supplied with it")
        ss = derive_study_set(context)
        pid = _new_id("prg")
        now = utc_now()
        self.repo.add(ProgramRow(id=pid, name=name.strip(), sponsor=sponsor,
                                 organisation=actor.organisation,
                                 context=context.to_dict(), study_set=ss.to_dict(),
                                 created_by=actor.id, created_at=now, updated_at=now))
        self._record(actor, "program.created", "program", pid,
                     {"name": name, "context": context.to_dict(),
                      "organisation": actor.organisation,
                      "study_set_hash": content_hash(ss.to_dict())})
        return self.program_view(pid)

    @atomic
    def update_program_context(self, actor: Principal, program_id: str,
                               changes: Mapping[str, Any], *, reason: str) -> dict[str, Any]:
        """Change programme facts (e.g. resolve a pending fact) and re-derive the study set."""
        self._require_worker(actor)
        if not reason.strip():
            raise KernelError("a reason is required to change programme context")
        signed = sorted(set(changes) & set(PROGRAM_DETERMINATIONS.values()))
        if signed:
            raise KernelError(f"{signed} can only be recorded as a signed determination")
        row = self.repo.program(program_id)
        merged = {**row.context, **dict(changes)}
        withdrawn = []
        if merged.get("s6_determination") and (
                merged.get("modality") != Modality.PEPTIDE.value
                or merged.get("peptide_origin") != PeptideOrigin.CHEMICAL_SYNTHESIS.value):
            # the signed judgement was about a chemically synthesised peptide; it stays in the
            # ledger but no longer governs this programme
            merged["s6_determination"] = None
            withdrawn.append("s6_principles_apply")
        ctx = ProgramContext.from_dict(merged)
        ss = derive_study_set(ctx)
        self.repo.update_program(program_id, context=ctx.to_dict(), study_set=ss.to_dict())
        self._record(actor, "program.context_updated", "program", program_id,
                     {"changes": dict(changes), "withdrawn_determinations": withdrawn,
                      "study_set_hash": content_hash(ss.to_dict())},
                     reason=reason)
        return self.program_view(program_id)

    @atomic
    def record_program_determination(self, actor: Principal, program_id: str, *, key: str,
                                     applies: bool, rationale: str) -> dict[str, Any]:
        """A signed programme-level judgement that changes the study set. Today one exists:
        ``s6_principles_apply``, whether ICH S6(R1) principles apply to a chemically
        synthesised peptide (S6(R1) section 1.3: they "may also be applicable"). The
        responsible scientist signs it; the API re-authenticates first."""
        if key not in PROGRAM_DETERMINATIONS:
            raise KernelError(f"unknown programme determination {key!r}")
        if not rationale.strip():
            raise KernelError("a determination needs its rationale")
        row = self.repo.program(program_id)
        ctx = ProgramContext.from_dict(row.context)
        if ctx.modality is not Modality.PEPTIDE or \
                ctx.peptide_origin is not PeptideOrigin.CHEMICAL_SYNTHESIS:
            raise KernelError("this determination is for chemically synthesised peptides; "
                              "record the peptide origin first")
        subject = {"program_id": program_id, "key": key, "applies": applies,
                   "rationale": rationale.strip(), "context_hash": content_hash(row.context)}
        sig = sign(actor, role=Role.RESPONSIBLE_SCIENTIST, meaning=SignatureMeaning.RESPONSIBILITY,
                   subject_id=f"{program_id}/determination/{key}",
                   subject_hash=content_hash(subject), statement=rationale)
        record = {"applies": applies, "rationale": rationale.strip(),
                  "signature": sig.to_dict()}
        ctx = ProgramContext.from_dict({**row.context, PROGRAM_DETERMINATIONS[key]: record})
        ss = derive_study_set(ctx)
        self.repo.update_program(program_id, context=ctx.to_dict(), study_set=ss.to_dict())
        self._record(actor, "program.determination_recorded", "program", program_id,
                     {"key": key, "determination": record,
                      "study_set_hash": content_hash(ss.to_dict())})
        return self.program_view(program_id)

    @atomic
    def register_compound(self, actor: Principal, program_id: str, *, name: str,
                          smiles: str) -> dict[str, Any]:
        self._require_worker(actor)
        self.repo.program(program_id)
        profile = compute_profile(smiles)
        for c in self.repo.compounds(program_id):
            if c.inchikey and c.inchikey == profile.inchikey:
                raise KernelError(f"structure already registered in this programme as "
                                  f"{c.name} ({c.id})")
        cid = _new_id("cmp")
        self.repo.add(CompoundRow(id=cid, program_id=program_id, name=name.strip(),
                                  smiles=profile.canonical_smiles, inchikey=profile.inchikey,
                                  profile=profile.to_dict(), external={},
                                  created_by=actor.id, created_at=utc_now()))
        self._record(actor, "compound.registered", "compound", cid,
                     {"program_id": program_id, "name": name, "inchikey": profile.inchikey,
                      "canonical_smiles": profile.canonical_smiles,
                      "rdkit": profile.rdkit_version})
        return self.compound_view(cid)

    @atomic
    def attach_external_record(self, actor: Principal, compound_id: str, source: str,
                               record: Mapping[str, Any]) -> dict[str, Any]:
        """Store a data-source result (ChEMBL, PubChem, ...) against a compound."""
        self._require_worker(actor)
        row = self.repo.compound(compound_id)
        ext = dict(row.external or {})
        ext[source] = dict(record)
        self.repo.update_compound(compound_id, external=ext)
        self._record(actor, "compound.external_attached", "compound", compound_id,
                     {"source": source, "record_hash": content_hash(dict(record))})
        return self.compound_view(compound_id)

    @atomic
    def register_biologic(self, actor: Principal, program_id: str, *, name: str,
                          entity: Mapping[str, Any]) -> dict[str, Any]:
        """Register a peptide or antibody by its sequence (or HELM string). The sequence is
        the registered fact; residue counts and masses are derived (hos.kernel.entities)."""
        self._require_worker(actor)
        if not name.strip():
            raise KernelError("a name is required")
        row = self.repo.program(program_id)
        modality = ProgramContext.from_dict(row.context).modality
        if modality not in AMINO_ACID_MODALITIES:
            raise KernelError(f"a {modality.value} programme registers compounds by structure; "
                              "sequence entities are for peptides and antibodies")
        try:
            spec = SequenceEntity.model_validate(dict(entity))
        except ValidationError as exc:
            raise KernelError("; ".join(e["msg"].removeprefix("Value error, ")
                                        for e in exc.errors())) from None
        if modality is not Modality.MONOCLONAL_ANTIBODY and (spec.isotype or
                                                              spec.light_chain_type):
            raise KernelError("isotype and light-chain type apply to antibody programmes")
        existing = self.repo.compounds(program_id)
        if spec.surrogate_for and spec.surrogate_for not in {c.id for c in existing}:
            raise KernelError(f"the clinical candidate {spec.surrogate_for} is not a compound "
                              "of this programme")
        fingerprint = content_hash({"chains": [(c.sequence, c.copies) for c in spec.chains],
                                    "helm": spec.helm})
        for c in existing:
            if c.kind == "sequence" and (c.entity or {}).get("fingerprint") == fingerprint:
                raise KernelError(f"this sequence is already registered as {c.name} ({c.id})")
        cid = _new_id("cmp")
        record = {"spec": spec.model_dump(mode="json"), "fingerprint": fingerprint,
                  "derived": derive_entity(spec)}
        self.repo.add(CompoundRow(id=cid, program_id=program_id, name=name.strip(), smiles="",
                                  inchikey=None, profile={}, external={}, kind="sequence",
                                  entity=record, created_by=actor.id, created_at=utc_now()))
        self._record(actor, "compound.registered", "compound", cid,
                     {"program_id": program_id, "name": name, "kind": "sequence",
                      "format": spec.format, "fingerprint": fingerprint,
                      "surrogate_for": spec.surrogate_for})
        return self.compound_view(cid)

    def compound_info(self, compound_id: str) -> CompoundInfo:
        row = self.repo.compound(compound_id)
        if row.kind == "sequence":
            return biologic_compound_info(row.id, row.name, SequenceEntity.model_validate(
                (row.entity or {})["spec"]))
        prof = compute_profile(row.smiles)
        return CompoundInfo(id=row.id, name=row.name, smiles=row.smiles, inchikey=row.inchikey,
                            molecular_weight=prof.molecular_weight, clogp=prof.clogp)

    # ======================================================================
    # studies
    # ======================================================================

    def _requirement(self, program: ProgramRow, requirement_id: str) -> StudyRequirement:
        ss = derive_study_set(ProgramContext.from_dict(program.context))
        for r in ss.requirements:
            if r.id == requirement_id:
                return r
        raise NotFound(f"requirement {requirement_id!r} is not in the study set of "
                       f"{program.name}")

    @atomic
    def create_study(self, actor: Principal, *, program_id: str, compound_id: str,
                     requirement_id: str | None = None, driver_id: str | None = None,
                     hypothesis: str | None = None) -> dict[str, Any]:
        self._require_worker(actor)
        program = self.repo.program(program_id)
        compound = self.repo.compound(compound_id)
        if compound.program_id != program_id:
            raise KernelError("compound does not belong to this programme")
        ctx = ProgramContext.from_dict(program.context)
        prefill: dict[str, Any] = {}
        if requirement_id is not None:
            req = self._requirement(program, requirement_id)
            if req.status is RequirementStatus.NOT_REQUIRED:
                raise KernelError(f"requirement {requirement_id} is not required for this "
                                  f"programme ({req.section}: {req.rationale})")
            matches = self.registry.match(req, ctx)
            if driver_id is not None:
                chosen = [m for m in matches if m[0].id == driver_id]
                if not chosen:
                    raise DriverError(f"driver {driver_id!r} does not serve {requirement_id}")
            elif len(matches) == 1:
                chosen = matches
            elif not matches:
                raise DriverError(f"no installed driver serves requirement {requirement_id}; "
                                  "the study must be run outside HOS or a driver installed")
            else:
                raise DriverError(f"several drivers serve {requirement_id}: "
                                  f"{[m[0].id for m in matches]}; choose one")
            driver, support = chosen[0]
            prefill = dict(support.prefill)
        else:
            if driver_id is None:
                raise KernelError("give a requirement_id or a driver_id")
            driver = self.registry.get(driver_id)
        sid = _new_id("stu")
        now = utc_now()
        self.repo.add(StudyRow(
            id=sid, program_id=program_id, compound_id=compound_id,
            requirement_id=requirement_id, driver_id=driver.id, driver_version=driver.version,
            title=f"{driver.name}: {compound.name}", state=StudyState.PROPOSED.value,
            hypothesis=hypothesis, parameters=prefill, protocol=None, protocol_version=0,
            raw_files=[], signatures=[], determinations=[], analysis_inputs={},
            created_by=actor.id, created_at=now, updated_at=now))
        self._record(actor, "study.created", "study", sid,
                     {"program_id": program_id, "compound_id": compound_id,
                      "requirement_id": requirement_id, "driver": f"{driver.id}@{driver.version}",
                      "hypothesis": hypothesis})
        return self.study_view(sid)

    @atomic
    def design_study(self, actor: Principal, study_id: str, parameters: Mapping[str, Any],
                     *, reason: str | None = None) -> dict[str, Any]:
        self._require_worker(actor)
        row = self.repo.study(study_id)
        state = StudyState(row.state)
        assert_transition(state, StudyState.DESIGNED)
        if state is not StudyState.PROPOSED and not (reason and reason.strip()):
            raise KernelError("amending a protocol requires a reason")
        driver = self._driver(row)
        params = self._validate(driver, parameters)
        protocol = self._design(row, driver, params)
        self.repo.add_artifact(study_id, "protocol", protocol.to_dict(), actor=actor.id,
                               reason=reason)
        self.repo.update_study(study_id, parameters=params.model_dump(),
                               protocol=protocol.to_dict(),
                               protocol_version=row.protocol_version + 1,
                               protocol_hash=protocol.content_hash, glp=protocol.glp,
                               plan=None, execution=None, state=StudyState.DESIGNED.value)
        self._record(actor, "study.designed", "study", study_id,
                     {"protocol_hash": protocol.content_hash,
                      "protocol_version": row.protocol_version + 1, "glp": protocol.glp,
                      "parameters": params.model_dump()}, reason=reason)
        return self.study_view(study_id)

    @atomic
    def plan_study(self, actor: Principal, study_id: str) -> dict[str, Any]:
        self._require_worker(actor)
        row = self.repo.study(study_id)
        assert_transition(StudyState(row.state), StudyState.PLANNED)
        driver = self._driver(row)
        params = self._validate(driver, row.parameters)
        protocol = self._verified_protocol(row, driver, params)
        plan = driver.plan(protocol, params).to_dict()
        self.repo.add_artifact(study_id, "plan", plan, actor=actor.id)
        self.repo.update_study(study_id, plan=plan, state=StudyState.PLANNED.value)
        self._record(actor, "study.planned", "study", study_id, {"plan": plan})
        return self.study_view(study_id)

    @atomic
    def dispatch_study(self, actor: Principal, study_id: str,
                       target: Mapping[str, Any]) -> dict[str, Any]:
        self._require_worker(actor)
        row = self.repo.study(study_id)
        assert_transition(StudyState(row.state), StudyState.DISPATCHED)
        driver = self._driver(row)
        params = self._validate(driver, row.parameters)
        protocol = self._verified_protocol(row, driver, params)
        compound = self.compound_info(row.compound_id)
        tgt = target_from_spec(target)
        pkg = driver.instruction_package(study_id, protocol, params, compound)
        rec = tgt.dispatch(pkg, driver=driver, params=params, compound=compound)
        bundle_sha = self.repo.store_file(rec.bundle, program_id=row.program_id,
                                          filename=f"{study_id}_dispatch.zip",
                                          media_type="application/zip", actor=actor.id)
        execution = rec.to_dict()
        execution["bundle_file"] = bundle_sha
        if rec.simulated is not None:
            sim_sha = self.repo.store_file(rec.simulated.content, program_id=row.program_id,
                                           filename=f"{study_id}_simulated.csv",
                                           media_type="text/csv", actor=actor.id)
            self.repo.register_simulated(sim_sha, study_id, rec.simulated.method_id)
            execution["simulated_file"] = sim_sha
        self.repo.add_artifact(study_id, "dispatch", execution, actor=actor.id)
        self.repo.update_study(study_id, execution=execution, state=StudyState.DISPATCHED.value)
        self._record(actor, "study.dispatched", "study", study_id,
                     {"target": rec.target, "bundle_sha256": rec.bundle_sha256,
                      "protocol_hash": rec.protocol_hash,
                      "expected_origin": rec.expected_origin.value})
        return self.study_view(study_id)

    def dispatch_bundle(self, study_id: str) -> bytes:
        row = self.repo.study(study_id)
        if not row.execution:
            raise NotFound("study has not been dispatched")
        return self.files.get(row.execution["bundle_file"])

    @atomic
    def receive_data(self, actor: Principal, study_id: str, content: bytes | None = None, *,
                     filename: str = "upload.csv", reason: str | None = None) -> dict[str, Any]:
        """Ingest a returned data file (or, for a simulation target, the generated file)."""
        self._require_worker(actor)
        row = self.repo.study(study_id)
        state = StudyState(row.state)
        assert_transition(state, StudyState.DATA_RECEIVED)
        if state is not StudyState.DISPATCHED and not (reason and reason.strip()):
            raise KernelError("replacing received data requires a reason")
        if not row.execution:
            raise KernelError("study has no dispatch record")
        sim_target = row.execution["target_kind"] == TargetKind.SIMULATION.value
        if content is None:
            if not sim_target:
                raise KernelError("no file supplied")
            content = self.files.get(row.execution["simulated_file"])
            filename = f"{study_id}_simulated.csv"
        claimed = DataOrigin.SIMULATED if sim_target else DataOrigin.MEASURED
        sha = hashlib.sha256(content).hexdigest()
        if claimed is DataOrigin.MEASURED and self.repo.is_simulated_file(sha):
            claimed = DataOrigin.SIMULATED
            self._record(actor, "data.origin_overridden", "study", study_id,
                         {"file_sha256": sha,
                          "reason": "file is byte-identical to data simulated by HOS"})
        driver = self._driver(row)
        params = self._validate(driver, row.parameters)
        stored = self.repo.store_file(content, program_id=row.program_id, filename=filename,
                                      media_type="text/csv",
                                      actor=actor.id)
        try:
            data = driver.ingest(content, params, filename=filename, claimed_origin=claimed,
                                 study_reference=study_id)
        except IngestError as exc:
            self._record(actor, "data.rejected", "study", study_id,
                         {"file_sha256": stored, "filename": filename,
                          "errors": list(exc.errors)})
            raise CommitThenRaise(exc) from None
        d = data.to_dict()
        self.repo.add_artifact(study_id, "data", d, actor=actor.id, reason=reason)
        raw = list(row.raw_files or []) + [{"sha256": stored, "filename": filename,
                                            "origin": data.origin.value,
                                            "received_at": utc_now().isoformat(),
                                            "received_by": actor.id}]
        self.repo.update_study(study_id, data=d, raw_files=raw, results=None,
                               interpretation=None, report=None, report_hash=None,
                               evidence_admissible=not data.is_simulated,
                               state=StudyState.DATA_RECEIVED.value)
        self._record(actor, "data.received", "study", study_id,
                     {"file_sha256": stored, "origin": data.origin.value,
                      "n_records": len(data.records), "warnings": list(data.warnings),
                      "conversions": list(data.conversions)}, reason=reason)
        return self.study_view(study_id)

    @staticmethod
    def _declared_inputs(driver: StudyDriver, params: BaseModel, row: Any) -> dict[str, str]:
        declared = dict(driver.analysis_inputs(params))
        if row.data:
            declared.update(driver.post_data_inputs(params, IngestedData.from_dict(row.data)))
        return declared

    @atomic
    def set_analysis_inputs(self, actor: Principal, study_id: str,
                            inputs: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
        """Supply quantities the analysis needs from outside the return file.

        Each input is ``{"value", "unit", "kind": measured|literature|user_supplied,
        "source", "url"?, "note"?}``; the kind is recorded as the value's provenance."""
        self._require_worker(actor)
        row = self.repo.study(study_id)
        if StudyState(row.state) in (StudyState.REPORTED, StudyState.APPROVED,
                                     StudyState.CANCELLED, StudyState.FAILED):
            raise KernelError(f"inputs cannot change in state {row.state}")
        driver = self._driver(row)
        params = self._validate(driver, row.parameters)
        declared = self._declared_inputs(driver, params, row)
        merged = dict(row.analysis_inputs or {})
        for name, spec in inputs.items():
            if name not in declared:
                raise KernelError(f"{name!r} is not an input of {driver.id}; "
                                  f"expected one of {sorted(declared)}")
            q = self._input_quantity(name, dict(spec), actor)
            if not U.compatible(q.unit, declared[name]):
                raise KernelError(f"{name}: unit {q.unit!r} incompatible with {declared[name]!r}")
            merged[name] = {**dict(spec), "entered_by": actor.id}
        self.repo.add_artifact(study_id, "analysis_inputs", merged, actor=actor.id)
        self.repo.update_study(study_id, analysis_inputs=merged)
        self._record(actor, "study.inputs_set", "study", study_id, {"inputs": merged})
        return self.study_view(study_id)

    @atomic
    def analyze_study(self, actor: Principal, study_id: str, *,
                      reason: str | None = None) -> dict[str, Any]:
        self._require_worker(actor)
        row = self.repo.study(study_id)
        state = StudyState(row.state)
        assert_transition(state, StudyState.ANALYZED)
        if state is not StudyState.DATA_RECEIVED and not (reason and reason.strip()):
            raise KernelError("re-analysis requires a reason")
        driver = self._driver(row)
        params = self._validate(driver, row.parameters)
        res, interp = self._run_analysis(row, driver, params)
        results = res.to_dict()
        analysis_hash = content_hash(results)
        results["analysis_hash"] = analysis_hash
        self.repo.add_artifact(study_id, "analysis", {"results": results,
                                                      "interpretation": interp.to_dict()},
                               actor=actor.id, reason=reason)
        self.repo.update_study(study_id, results=results, interpretation=interp.to_dict(),
                               report=None, report_hash=None,
                               evidence_admissible=bool(res.evidence_admissible),
                               state=StudyState.ANALYZED.value)
        self._record(actor, "study.analyzed", "study", study_id,
                     {"analysis_hash": analysis_hash, "qc": res.qc.to_dict()["status"],
                      "evidence_admissible": res.evidence_admissible}, reason=reason)
        return self.study_view(study_id)

    @atomic
    def record_determination(self, actor: Principal, study_id: str, *, key: str,
                             value: float | None, unit: str | None, rationale: str,
                             reason: str | None = None,
                             category: str | None = None) -> dict[str, Any]:
        """Record an expert determination (e.g. a NOAEL) the driver declared. The actor must
        be a human holding the declared role; the record is signed and bound to the exact
        analysis it interprets. The API layer re-authenticates before calling this."""
        row = self.repo.study(study_id)
        if StudyState(row.state) is not StudyState.ANALYZED:
            raise KernelError("determinations are recorded on an analysed study")
        driver = self._driver(row)
        params = self._validate(driver, row.parameters)
        spec = self._determination_spec(driver, params, key)
        if not rationale.strip():
            raise KernelError("a determination must state its rationale")
        if spec.categorical:
            if value is not None or category not in spec.choices:
                raise KernelError(f"{spec.label} is a categorical determination: choose one of "
                                  f"{list(spec.choices)}")
        elif category is not None:
            raise KernelError(f"{spec.label} is numeric; give a value (or none if not established)")
        unit = unit or spec.unit or "dimensionless"
        if spec.unit and not U.compatible(unit, spec.unit):
            raise KernelError(f"{key}: unit {unit!r} incompatible with {spec.unit!r}")
        existing = [d for d in row.determinations or []
                    if d["key"] == key and d["analysis_hash"] == _require_record(row.results, "analysis results", row.id)["analysis_hash"]]
        if existing and not (reason and reason.strip()):
            raise KernelError(f"{key} is already determined; a revision requires a reason")
        q: Quantity | None
        if spec.categorical:
            q = None
            claim = f"I determine {spec.label}: {category}"
        elif value is None:
            q = Quantity.unavailable(unit, label=spec.label,
                                     reason=f"not established (determination by {actor.name}, "
                                            f"{spec.role.value}): {rationale}")
            claim = f"I determine that {spec.label} is not established"
        else:
            q = Quantity.user_supplied(float(value), unit, actor=actor.name, label=spec.label,
                                       notes=f"expert determination by {actor.name} "
                                             f"({spec.role.value}); rationale: {rationale}")
            claim = f"I determine {spec.label} = {value:g} {unit}"
        subject = {"study_id": study_id, "key": key,
                   "value": None if value is None else float(value),
                   "unit": None if spec.categorical else unit,
                   "rationale": rationale, "analysis_hash": _require_record(row.results, "analysis results", row.id)["analysis_hash"]}
        if spec.categorical:
            subject["category"] = category
        sig = sign(actor, role=spec.role, meaning=SignatureMeaning.RESPONSIBILITY,
                   subject_id=f"{study_id}/determination/{key}",
                   subject_hash=content_hash(subject),
                   statement=f"{claim}. Rationale: {rationale}")
        det = {"key": key, "label": spec.label, "quantity": q.to_dict() if q else None,
               "category": category, "rationale": rationale,
               "role": spec.role.value, "signer_id": actor.id, "signer_name": actor.name,
               "signed_at": sig.signed_at, "analysis_hash": _require_record(row.results, "analysis results", row.id)["analysis_hash"],
               "signature": sig.to_dict()}
        keep = [d for d in row.determinations or [] if d not in existing]
        self.repo.add_artifact(study_id, "determination", det, actor=actor.id, reason=reason)
        self.repo.update_study(study_id, determinations=keep + [det])
        self._record(actor, "study.determination_recorded", "study", study_id,
                     {"key": key, "value": None if value is None else float(value),
                      "unit": None if spec.categorical else unit, "category": category,
                      "signature": sig.to_dict()}, reason=reason)
        return self.study_view(study_id)

    @atomic
    def report_study(self, actor: Principal, study_id: str) -> dict[str, Any]:
        self._require_worker(actor)
        row = self.repo.study(study_id)
        assert_transition(StudyState(row.state), StudyState.REPORTED)
        driver = self._driver(row)
        params = self._validate(driver, row.parameters)
        current = [d for d in row.determinations or []
                   if d["analysis_hash"] == _require_record(row.results, "analysis results", row.id)["analysis_hash"]]
        missing = [s.label for s in driver.expert_determinations(params)
                   if s.required_for_approval and s.key not in {d["key"] for d in current}]
        if missing:
            raise AttestationRequired(f"report needs these expert determinations first: "
                                      f"{missing}")
        protocol = self._verified_protocol(row, driver, params)
        res, interp = self._run_analysis(row, driver, params)
        res_d = res.to_dict()
        if content_hash(res_d) != _require_record(row.results, "analysis results", row.id)["analysis_hash"]:
            raise KernelError("re-running the analysis no longer reproduces the recorded "
                              "result (driver or reference parameters changed); re-analyse "
                              "with a reason before reporting")
        data = IngestedData.from_dict(_require_record(row.data, "ingested data", row.id))
        report = driver.report(protocol, data, res, interp, current)
        rd = report.to_dict()
        rd["markdown"] = report.to_markdown()
        self.repo.add_artifact(study_id, "report", rd, actor=actor.id)
        self.repo.update_study(study_id, report=rd, report_hash=report.content_hash,
                               state=StudyState.REPORTED.value)
        self._record(actor, "study.reported", "study", study_id,
                     {"report_hash": report.content_hash,
                      "report_record_hash": content_hash(rd),       # includes the markdown
                      "evidence_admissible": report.evidence_admissible})
        return self.study_view(study_id)

    @atomic
    def sign_protocol(self, actor: Principal, study_id: str, *, statement: str) -> dict[str, Any]:
        """The Study Director approves (signs) the current protocol. For nonclinical studies
        the date of this signature is the study start date (FDA Study Data Technical
        Conformance Guide v6.3, 4.1.3: STSTDTC "is the date on which the study protocol or plan
        is approved (signed) by the Study Director"). The API re-authenticates first."""
        row = self.repo.study(study_id)
        if not row.protocol_hash:
            raise KernelError("the study has no protocol to sign")
        if any(s.get("subject_hash") == row.protocol_hash and s.get("role") ==
               Role.STUDY_DIRECTOR.value for s in row.signatures or []):
            raise KernelError("the Study Director has already signed this protocol version")
        sig = sign(actor, role=Role.STUDY_DIRECTOR, meaning=SignatureMeaning.APPROVAL,
                   subject_id=f"{study_id}/protocol/v{row.protocol_version}",
                   subject_hash=row.protocol_hash, statement=statement)
        self.repo.add_artifact(study_id, "protocol_signature", sig.to_dict(), actor=actor.id)
        self.repo.update_study(study_id, signatures=list(row.signatures or []) + [sig.to_dict()])
        self._record(actor, "study.protocol_signed", "study", study_id,
                     {"signature": sig.to_dict(), "protocol_version": row.protocol_version})
        return self.study_view(study_id)

    @staticmethod
    def protocol_signatures(row: Any) -> list[dict[str, Any]]:
        """Study Director protocol approvals, every protocol version, oldest first."""
        return sorted((s for s in row.signatures or []
                       if str(s.get("subject_id", "")).startswith(f"{row.id}/protocol/")
                       and s.get("role") == Role.STUDY_DIRECTOR.value),
                      key=lambda s: str(s["signed_at"]))

    @atomic
    def sign_study(self, actor: Principal, study_id: str, *, role: Role,
                   meaning: SignatureMeaning, statement: str) -> dict[str, Any]:
        """Sign the current report. The API layer re-authenticates before calling this."""
        row = self.repo.study(study_id)
        if StudyState(row.state) is not StudyState.REPORTED or not row.report_hash:
            raise KernelError("only a reported study can be signed")
        sig = sign(actor, role=role, meaning=meaning, subject_id=study_id,
                   subject_hash=row.report_hash, statement=statement)
        self.repo.add_artifact(study_id, "signature", sig.to_dict(), actor=actor.id)
        self.repo.update_study(study_id, signatures=list(row.signatures or []) + [sig.to_dict()])
        self._record(actor, "study.signed", "study", study_id, {"signature": sig.to_dict()})
        return self.study_view(study_id)

    def approval_requirements(self, row: StudyRow) -> list[tuple[Role, SignatureMeaning]]:
        if row.glp:
            return [(Role.STUDY_DIRECTOR, SignatureMeaning.APPROVAL),
                    (Role.QUALITY_ASSURANCE, SignatureMeaning.QA_COMPLIANCE)]
        return [(Role.RESPONSIBLE_SCIENTIST, SignatureMeaning.APPROVAL)]

    def _missing_signatures(self, row: StudyRow) -> list[str]:
        sigs = [s for s in row.signatures or [] if s["subject_hash"] == row.report_hash]
        missing = []
        for role, meaning in self.approval_requirements(row):
            ok_roles = {role.value}
            if role is Role.RESPONSIBLE_SCIENTIST:
                ok_roles.add(Role.STUDY_DIRECTOR.value)
            if not any(s["role"] in ok_roles and s["meaning"] == meaning.value for s in sigs):
                missing.append(f"{role.value} ({meaning.value})")
        return missing

    @atomic
    def approve_study(self, actor: Principal, study_id: str) -> dict[str, Any]:
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("only a human can approve a study")
        row = self.repo.study(study_id)
        assert_transition(StudyState(row.state), StudyState.APPROVED)
        origins = {f["origin"] for f in row.raw_files or []}
        if not row.evidence_admissible or DataOrigin.SIMULATED.value in origins:
            self._record(actor, "study.approval_refused", "study", study_id,
                         {"reason": "simulated data"})
            raise CommitThenRaise(EvidenceInadmissible(
                "a study containing simulated data can never be approved as evidence"))
        missing = self._missing_signatures(row)
        if missing:
            raise AttestationRequired(f"approval needs signatures on the current report: "
                                      f"{missing}")
        self.repo.update_study(study_id, state=StudyState.APPROVED.value)
        self._record(actor, "study.approved", "study", study_id,
                     {"report_hash": row.report_hash, "glp": row.glp})
        return self.study_view(study_id)

    @atomic
    def cancel_study(self, actor: Principal, study_id: str, *, reason: str) -> dict[str, Any]:
        return self._terminal(actor, study_id, StudyState.CANCELLED, reason)

    @atomic
    def fail_study(self, actor: Principal, study_id: str, *, reason: str) -> dict[str, Any]:
        return self._terminal(actor, study_id, StudyState.FAILED, reason)

    def _terminal(self, actor: Principal, study_id: str, target: StudyState,
                  reason: str) -> dict[str, Any]:
        self._require_worker(actor)
        if not reason.strip():
            raise KernelError("a reason is required")
        row = self.repo.study(study_id)
        assert_transition(StudyState(row.state), target)
        self.repo.update_study(study_id, state=target.value)
        self._record(actor, f"study.{target.value}", "study", study_id, {}, reason=reason)
        return self.study_view(study_id)

    # ======================================================================
    # views
    # ======================================================================

    def program_view(self, program_id: str) -> dict[str, Any]:
        row = self.repo.program(program_id)
        # the live derivation from the current engine (readiness uses the same); the set
        # recorded when the programme was created stays in the ledger
        ss = derive_study_set(ProgramContext.from_dict(row.context))
        drivers = {r.id: [{"id": d.id, "name": d.name,
                           "components": list(d.components_for(r.id))}
                          for d, _ in self.registry.match(r, ss.context)]
                   for r in ss.requirements}
        return {"id": row.id, "name": row.name, "sponsor": row.sponsor, "context": row.context,
                "study_set": ss.to_dict(), "drivers": drivers, "created_by": row.created_by,
                "created_at": row.created_at.isoformat(),
                "compounds": [self.compound_view(c.id) for c in self.repo.compounds(program_id)],
                "studies": [self._study_summary(s) for s in self.repo.studies(program_id)]}

    def programs(self) -> list[dict[str, Any]]:
        return [{"id": r.id, "name": r.name, "sponsor": r.sponsor,
                 "created_at": r.created_at.isoformat()} for r in self.repo.programs()]

    def compound_view(self, compound_id: str) -> dict[str, Any]:
        r = self.repo.compound(compound_id)
        return {"id": r.id, "program_id": r.program_id, "name": r.name,
                "kind": r.kind or "small_molecule", "smiles": r.smiles or None,
                "inchikey": r.inchikey, "profile": r.profile, "external": r.external or {},
                "entity": r.entity, "created_at": r.created_at.isoformat()}

    def _study_summary(self, s: StudyRow) -> dict[str, Any]:
        return {"id": s.id, "title": s.title, "state": s.state, "driver_id": s.driver_id,
                "origin": s.origin or "driver",
                "requirement_id": s.requirement_id, "compound_id": s.compound_id,
                "glp": s.glp, "evidence_admissible": s.evidence_admissible,
                "simulated": any(f["origin"] == "simulated" for f in s.raw_files or []),
                "updated_at": s.updated_at.isoformat()}

    def study_view(self, study_id: str) -> dict[str, Any]:
        s = self.repo.study(study_id)
        driver = self.registry.get(s.driver_id) if s.driver_id in self.registry else None
        params = None
        if driver is not None:
            try:
                params = driver.validate_parameters(s.parameters)
            except ValidationError:
                params = None
        view = {
            **self._study_summary(s),
            "program_id": s.program_id, "driver_version": s.driver_version,
            "hypothesis": s.hypothesis, "parameters": s.parameters,
            "protocol": s.protocol, "protocol_version": s.protocol_version,
            "protocol_hash": s.protocol_hash, "plan": s.plan,
            "execution": s.execution, "raw_files": s.raw_files, "data": s.data,
            "analysis_inputs": s.analysis_inputs, "results": s.results,
            "interpretation": s.interpretation, "determinations": s.determinations,
            "report": s.report, "report_hash": s.report_hash, "signatures": s.signatures,
            "allowed_transitions": sorted(t.value for t in TRANSITIONS[StudyState(s.state)]),
            "created_by": s.created_by, "created_at": s.created_at.isoformat(),
        }
        if s.state == StudyState.REPORTED.value:
            view["approval_missing"] = self._missing_signatures(s)
        if s.origin == "import":
            view["import_record"] = s.import_record
            view["import"] = self.imports.import_view(s)
        if driver is not None:
            view["driver"] = {"id": driver.id, "name": driver.name, "version": driver.version,
                              "ctd_section": driver.ctd_section}
            if params is not None:
                view["expected_inputs"] = self._declared_inputs(driver, params, s)
                view["selection_inputs"] = (sorted(driver.post_data_inputs(
                    params, IngestedData.from_dict(s.data))) if s.data else [])
                view["expert_determinations"] = [d.to_dict() for d in
                                                 driver.expert_determinations(params)]
        return view

    def studies(self, program_id: str | None = None) -> list[dict[str, Any]]:
        return [self._study_summary(s) for s in self.repo.studies(program_id)]

    def artifacts(self, study_id: str, kind: str | None = None) -> list[dict[str, Any]]:
        return [{"id": a.id, "kind": a.kind, "version": a.version, "content_hash": a.content_hash,
                 "supersedes": a.supersedes, "reason": a.reason, "created_by": a.created_by,
                 "created_at": a.created_at.isoformat(), "content": a.content}
                for a in self.repo.artifacts(study_id, kind)]

    @atomic
    def record_event(self, actor: Principal, action: str, subject_type: str, subject_id: str,
                     payload: dict[str, Any], *, reason: str | None = None) -> None:
        """Ledger an event raised by a kernel service (e.g. IND assembly)."""
        self._require_worker(actor)
        self._record(actor, action, subject_type, subject_id, payload, reason=reason)

    def history(self, subject_id: str) -> list[dict[str, Any]]:
        return [e.to_dict() for e in self.ledger.history(subject_id)]

    def verify_ledger(self) -> int:
        return self.ledger.verify()

    def checkpoint(self) -> None:
        """Anchor the current ledger head outside the database (after each unit of work)."""
        self.anchors.append(self.ledger)

    def integrity(self) -> dict[str, Any]:
        """The chain, the anchors and the reconciliation of stored state with the ledger
        (docs/15 P0.2). ``valid`` only when all three hold."""
        entries = self.ledger.verify()
        findings = self.anchors.verify(self.ledger) + reconcile(self)
        return {"valid": not findings, "entries": entries, "head": self.ledger.head,
                "anchors": len(self.anchors.checkpoints()),
                "findings": [f.to_dict() for f in findings]}

    # ======================================================================
    # internals
    # ======================================================================

    def _record(self, actor: Principal, action: str, subject_type: str, subject_id: str,
                payload: dict[str, Any], reason: str | None = None) -> None:
        self.ledger.record(actor_id=actor.id, actor_kind=actor.kind.value, action=action,
                           subject_type=subject_type, subject_id=subject_id, payload=payload,
                           reason=reason)

    @staticmethod
    def _require_worker(actor: Principal) -> None:
        if not (actor.roles & WORK_ROLES):
            raise PermissionDenied(f"{actor.name} holds none of the roles that can operate on "
                                   "studies")

    def _driver(self, row: StudyRow) -> StudyDriver:
        d = self.registry.get(row.driver_id)
        if d.version != row.driver_version:
            raise DriverError(f"study was created with {row.driver_id}@{row.driver_version} but "
                              f"{d.version} is installed; results may not be reproducible")
        return d

    @staticmethod
    def _validate(driver: StudyDriver, parameters: Mapping[str, Any]) -> BaseModel:
        try:
            return driver.validate_parameters(parameters)
        except ValidationError as exc:
            msgs = [f"{'.'.join(str(x) for x in e['loc'])}: {e['msg']}" for e in exc.errors()]
            raise DriverError("invalid parameters: " + "; ".join(msgs)) from None

    def _design(self, row: StudyRow, driver: StudyDriver, params: BaseModel) -> ProtocolDocument:
        program = self.repo.program(row.program_id)
        return driver.design(self.compound_info(row.compound_id), params,
                             ProgramContext.from_dict(program.context), row.hypothesis)

    def _verified_protocol(self, row: StudyRow, driver: StudyDriver,
                           params: BaseModel) -> ProtocolDocument:
        protocol = self._design(row, driver, params)
        if protocol.content_hash != row.protocol_hash:
            raise DriverError("the driver no longer reproduces the recorded protocol "
                              f"({row.protocol_hash[:12] if row.protocol_hash else None} vs "
                              f"{protocol.content_hash[:12]}); amend the design")
        return protocol

    def _run_analysis(self, row: StudyRow, driver: StudyDriver, params: BaseModel) -> Any:
        if not row.data:
            raise KernelError("no data received")
        data = IngestedData.from_dict(row.data)
        inputs = {k: self._input_quantity(k, v, None) for k, v in (row.analysis_inputs or {}).items()}
        res = driver.analyze(data, params, self.compound_info(row.compound_id), inputs)
        ctx = ProgramContext.from_dict(self.repo.program(row.program_id).context)
        return res, driver.interpret(res, params, ctx)

    def _input_quantity(self, name: str, spec: Mapping[str, Any],
                        actor: Principal | None) -> Quantity:
        return input_quantity(name, spec, actor.name if actor else None)

    @staticmethod
    def _determination_spec(driver: StudyDriver, params: BaseModel,
                            key: str) -> ExpertDetermination:
        for d in driver.expert_determinations(params):
            if d.key == key:
                return d
        raise KernelError(f"{driver.id} declares no determination {key!r}")
