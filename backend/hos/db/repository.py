"""Repository: typed data access over the SQL schema. No business rules live here;
the kernel facade (``hos.kernel.kernel``) owns every state change."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import func, select

from hos.core.provenance import utc_now
from hos.db.models import (
    ArtifactRow,
    CompoundRow,
    FileRow,
    PrincipalRow,
    ProgramRow,
    SimulatedFileRow,
    StudyRow,
)
from hos.db.store import Database, FileStore
from hos.kernel.errors import NotFound

__all__ = ["Repository", "content_hash"]


def content_hash(obj: Any) -> str:
    """Content hash excluding wall-clock timestamps (see ``hos.drivers.base.canonical_hash``)."""
    from hos.drivers.base import canonical_hash
    return canonical_hash(obj)


def _now() -> datetime:
    return utc_now()


class Repository:
    def __init__(self, db: Database, files: FileStore) -> None:
        self.db = db
        self.files = files

    # -- principals --------------------------------------------------------------

    def add_principal(self, row: PrincipalRow) -> None:
        with self.db.session() as s:
            s.add(row)

    def principal(self, principal_id: str) -> PrincipalRow:
        with self.db.session() as s:
            r = s.get(PrincipalRow, principal_id)
            if r is None:
                raise NotFound(f"no principal {principal_id!r}")
            return r

    def principals(self) -> list[PrincipalRow]:
        with self.db.session() as s:
            return list(s.execute(select(PrincipalRow).order_by(PrincipalRow.id)).scalars())

    # -- programs / compounds ----------------------------------------------------

    def add(self, row: Any) -> None:
        with self.db.session() as s:
            s.add(row)

    def program(self, program_id: str) -> ProgramRow:
        with self.db.session() as s:
            r = s.get(ProgramRow, program_id)
            if r is None:
                raise NotFound(f"no programme {program_id!r}")
            return r

    def programs(self) -> list[ProgramRow]:
        with self.db.session() as s:
            return list(s.execute(select(ProgramRow).order_by(ProgramRow.created_at)).scalars())

    def update_program(self, program_id: str, **fields: Any) -> ProgramRow:
        with self.db.session() as s:
            r = s.get(ProgramRow, program_id)
            if r is None:
                raise NotFound(f"no programme {program_id!r}")
            for k, v in fields.items():
                setattr(r, k, v)
            r.updated_at = _now()
            return r

    def compound(self, compound_id: str) -> CompoundRow:
        with self.db.session() as s:
            r = s.get(CompoundRow, compound_id)
            if r is None:
                raise NotFound(f"no compound {compound_id!r}")
            return r

    def compounds(self, program_id: str) -> list[CompoundRow]:
        with self.db.session() as s:
            return list(s.execute(select(CompoundRow).where(CompoundRow.program_id == program_id)
                                  .order_by(CompoundRow.created_at)).scalars())

    def update_compound(self, compound_id: str, **fields: Any) -> CompoundRow:
        with self.db.session() as s:
            r = s.get(CompoundRow, compound_id)
            if r is None:
                raise NotFound(f"no compound {compound_id!r}")
            for k, v in fields.items():
                setattr(r, k, v)
            return r

    # -- studies -------------------------------------------------------------------

    def study(self, study_id: str) -> StudyRow:
        with self.db.session() as s:
            r = s.get(StudyRow, study_id)
            if r is None:
                raise NotFound(f"no study {study_id!r}")
            return r

    def studies(self, program_id: Optional[str] = None) -> list[StudyRow]:
        with self.db.session() as s:
            q = select(StudyRow).order_by(StudyRow.created_at)
            if program_id:
                q = q.where(StudyRow.program_id == program_id)
            return list(s.execute(q).scalars())

    def update_study(self, study_id: str, **fields: Any) -> StudyRow:
        with self.db.session() as s:
            r = s.get(StudyRow, study_id)
            if r is None:
                raise NotFound(f"no study {study_id!r}")
            for k, v in fields.items():
                setattr(r, k, v)
            r.updated_at = _now()
            return r

    # -- append-only artefacts -------------------------------------------------------

    def add_artifact(self, study_id: str, kind: str, content: dict[str, Any], *, actor: str,
                     reason: Optional[str] = None) -> ArtifactRow:
        with self.db.session() as s:
            prev = s.execute(select(ArtifactRow).where(ArtifactRow.study_id == study_id,
                                                       ArtifactRow.kind == kind)
                             .order_by(ArtifactRow.version.desc()).limit(1)).scalar_one_or_none()
            row = ArtifactRow(study_id=study_id, kind=kind,
                              version=(prev.version + 1) if prev else 1, content=content,
                              content_hash=content_hash(content),
                              supersedes=prev.id if prev else None, reason=reason,
                              created_by=actor, created_at=_now())
            s.add(row)
            s.flush()
            return row

    def artifacts(self, study_id: str, kind: Optional[str] = None) -> list[ArtifactRow]:
        with self.db.session() as s:
            q = select(ArtifactRow).where(ArtifactRow.study_id == study_id)
            if kind:
                q = q.where(ArtifactRow.kind == kind)
            return list(s.execute(q.order_by(ArtifactRow.id)).scalars())

    # -- files ---------------------------------------------------------------------------

    def store_file(self, content: bytes, *, filename: str, media_type: str, actor: str) -> str:
        sha = self.files.put(content)
        with self.db.session() as s:
            if s.get(FileRow, sha) is None:
                s.add(FileRow(sha256=sha, filename=filename, media_type=media_type,
                              size_bytes=len(content), uploaded_by=actor, uploaded_at=_now()))
        return sha

    def file_meta(self, sha: str) -> FileRow:
        with self.db.session() as s:
            r = s.get(FileRow, sha)
            if r is None:
                raise NotFound(f"no file {sha}")
            return r

    def register_simulated(self, sha: str, study_id: str, method_id: str) -> None:
        with self.db.session() as s:
            if s.get(SimulatedFileRow, sha) is None:
                s.add(SimulatedFileRow(sha256=sha, study_id=study_id, method_id=method_id,
                                       created_at=_now()))

    def is_simulated_file(self, sha: str) -> bool:
        with self.db.session() as s:
            return s.get(SimulatedFileRow, sha) is not None

    def count(self, model: Any) -> int:
        with self.db.session() as s:
            return int(s.execute(select(func.count()).select_from(model)).scalar_one())
