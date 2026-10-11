"""Relational schema."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

__all__ = [
    "ArtifactRow",
    "Base",
    "CompoundRow",
    "FileRow",
    "LedgerRow",
    "PrincipalRow",
    "ProgramRow",
    "SimulatedFileRow",
    "StudyRow",
    "WriterLockRow",
]


class Base(DeclarativeBase):
    pass


class PrincipalRow(Base):
    __tablename__ = "principals"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(256))
    kind: Mapped[str] = mapped_column(String(16))
    roles: Mapped[list] = mapped_column(JSON, default=list)
    organisation: Mapped[str | None] = mapped_column(String(256), nullable=True)
    signing_secret_hash: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)


class SessionRow(Base):
    """A sign-in session or an agent key. Only the token's SHA-256 is stored."""

    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    principal_id: Mapped[str] = mapped_column(ForeignKey("principals.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # session | agent_key
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProgramRow(Base):
    __tablename__ = "programs"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(256))
    sponsor: Mapped[str | None] = mapped_column(String(256), nullable=True)
    organisation: Mapped[str | None] = mapped_column(String(256), nullable=True)
    """The owning organisation (the creator's); None is the default organisation."""
    context: Mapped[dict] = mapped_column(JSON)
    study_set: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CompoundRow(Base):
    __tablename__ = "compounds"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    program_id: Mapped[str] = mapped_column(ForeignKey("programs.id"), index=True)
    name: Mapped[str] = mapped_column(String(256))
    smiles: Mapped[str] = mapped_column(Text)
    """Canonical SMILES; empty for a sequence entity."""
    inchikey: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    profile: Mapped[dict] = mapped_column(JSON)
    external: Mapped[dict] = mapped_column(JSON, default=dict)
    kind: Mapped[str] = mapped_column(String(32), default="small_molecule")
    """small_molecule (registered by structure) or sequence (peptide or antibody, docs/14 P4)."""
    entity: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    """The sequence entity as registered (hos.kernel.entities.SequenceEntity)."""
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StudyRow(Base):
    __tablename__ = "studies"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    program_id: Mapped[str] = mapped_column(ForeignKey("programs.id"), index=True)
    compound_id: Mapped[str] = mapped_column(ForeignKey("compounds.id"), index=True)
    requirement_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    driver_id: Mapped[str] = mapped_column(String(64), index=True)
    driver_version: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(512))
    state: Mapped[str] = mapped_column(String(32), index=True)
    hypothesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    protocol: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    protocol_version: Mapped[int] = mapped_column(Integer, default=0)
    plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    execution: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    raw_files: Mapped[list] = mapped_column(JSON, default=list)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    results: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    interpretation: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    report: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    signatures: Mapped[list] = mapped_column(JSON, default=list)
    determinations: Mapped[list] = mapped_column(JSON, default=list)
    analysis_inputs: Mapped[dict] = mapped_column(JSON, default=dict)
    protocol_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    report_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    glp: Mapped[bool] = mapped_column(default=False)
    origin: Mapped[str] = mapped_column(String(16), default="driver")
    import_record: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    evidence_admissible: Mapped[bool] = mapped_column(default=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FileRow(Base):
    __tablename__ = "files"
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    filename: Mapped[str] = mapped_column(String(512))
    media_type: Mapped[str] = mapped_column(String(128))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    uploaded_by: Mapped[str] = mapped_column(String(64))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ProgramMemberRow(Base):
    """A principal from another organisation given access to one programme (e.g. a CRO)."""

    __tablename__ = "program_members"
    program_id: Mapped[str] = mapped_column(ForeignKey("programs.id"), primary_key=True)
    principal_id: Mapped[str] = mapped_column(ForeignKey("principals.id"), primary_key=True)
    added_by: Mapped[str] = mapped_column(String(64))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class FileLinkRow(Base):
    """Which programmes a stored file belongs to; content addressing lets two programmes
    hold the same bytes."""

    __tablename__ = "file_links"
    sha256: Mapped[str] = mapped_column(ForeignKey("files.sha256"), primary_key=True)
    program_id: Mapped[str] = mapped_column(ForeignKey("programs.id"), primary_key=True)


class LedgerRow(Base):
    __tablename__ = "ledger"
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    recorded_at: Mapped[str] = mapped_column(String(64))
    actor_id: Mapped[str] = mapped_column(String(64))
    actor_kind: Mapped[str] = mapped_column(String(16))
    action: Mapped[str] = mapped_column(String(128))
    subject_type: Mapped[str] = mapped_column(String(64))
    subject_id: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    payload_sha256: Mapped[str] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64), unique=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    scheme: Mapped[int] = mapped_column(Integer, default=1)

    __table_args__ = (Index("ix_ledger_subject", "subject_id"),)


class ArtifactRow(Base):
    """Append-only, versioned study artefacts. Rows are never updated: a correction is a new
    version that names the version it supersedes and the reason."""

    __tablename__ = "artifacts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    study_id: Mapped[str] = mapped_column(ForeignKey("studies.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    supersedes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_artifact_study_kind", "study_id", "kind", "version", unique=True),)


class SimulatedFileRow(Base):
    """Hashes of every file the system has simulated, so one can never be re-uploaded as
    a measurement."""

    __tablename__ = "simulated_files"
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    study_id: Mapped[str] = mapped_column(String(64))
    method_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class WriterLockRow(Base):
    """One row, updated first by every unit of work (docs/15 P2.6). The row lock it takes
    serialises writers across processes and hosts, so a read-modify-write (a signature
    appended to a list, the next ledger sequence number) never works from a stale read.
    ``writes`` counts committed units of work."""

    __tablename__ = "writer_lock"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    writes: Mapped[int] = mapped_column(BigInteger)
