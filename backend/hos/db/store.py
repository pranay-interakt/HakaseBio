"""Database engine, content-addressed file store, and the SQL ledger backend."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from hos.db.models import Base, LedgerRow
from hos.kernel.ledger import LedgerEntry

__all__ = ["Database", "FileStore", "SqlLedgerBackend", "default_data_dir"]


def default_data_dir() -> Path:
    d = Path(os.environ.get("HOS_DATA_DIR", Path.home() / ".hakase_os"))
    d.mkdir(parents=True, exist_ok=True)
    return d


class Database:
    """Owns the SQLAlchemy engine and session factory."""

    def __init__(self, url: str | None = None) -> None:
        self.url = url or os.environ.get(
            "HOS_DATABASE_URL", f"sqlite:///{default_data_dir() / 'hos.sqlite3'}"
        )
        kwargs = {}
        if self.url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        self.engine: Engine = create_engine(self.url, future=True, **kwargs)
        if self.url.startswith("sqlite"):
            @event.listens_for(self.engine, "connect")
            def _pragmas(dbapi_conn: Any, _: Any) -> None:  # pragma: no cover - driver hook
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA foreign_keys=ON")
                cur.execute("PRAGMA journal_mode=WAL")
                cur.close()
        self._factory = sessionmaker(self.engine, expire_on_commit=False, future=True)

    def create_all(self) -> None:
        Base.metadata.create_all(self.engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()


class FileStore:
    """Content-addressed storage for raw data files (instrument exports, CRO returns).

    Files are stored under their SHA-256, so a file is immutable once received and
    any later claim about "the raw data" can be checked against the hash recorded
    in the ledger.
    """

    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or default_data_dir() / "objects")
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, sha: str) -> Path:
        return self.root / sha[:2] / sha

    def put(self, content: bytes) -> str:
        sha = hashlib.sha256(content).hexdigest()
        p = self._path(sha)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_bytes(content)
            tmp.replace(p)
        return sha

    def get(self, sha: str) -> bytes:
        p = self._path(sha)
        data = p.read_bytes()
        if hashlib.sha256(data).hexdigest() != sha:
            raise OSError(f"stored object {sha} failed integrity check")
        return data

    def exists(self, sha: str) -> bool:
        return self._path(sha).exists()


class SqlLedgerBackend:
    """Durable ledger backend; the hash chain is verified by :class:`~hos.kernel.ledger.Ledger`."""

    def __init__(self, db: Database) -> None:
        self.db = db

    @staticmethod
    def _to_entry(r: LedgerRow) -> LedgerEntry:
        return LedgerEntry(
            seq=r.seq, recorded_at=r.recorded_at, actor_id=r.actor_id, actor_kind=r.actor_kind,
            action=r.action, subject_type=r.subject_type, subject_id=r.subject_id,
            payload=r.payload, payload_sha256=r.payload_sha256, prev_hash=r.prev_hash,
            entry_hash=r.entry_hash, reason=r.reason,
        )

    def append(self, entry: LedgerEntry) -> None:
        with self.db.session() as s:
            s.add(LedgerRow(
                seq=entry.seq, recorded_at=entry.recorded_at, actor_id=entry.actor_id,
                actor_kind=entry.actor_kind, action=entry.action,
                subject_type=entry.subject_type, subject_id=entry.subject_id,
                payload=entry.payload, payload_sha256=entry.payload_sha256,
                prev_hash=entry.prev_hash, entry_hash=entry.entry_hash, reason=entry.reason,
            ))

    def last(self) -> LedgerEntry | None:
        with self.db.session() as s:
            r = s.execute(select(LedgerRow).order_by(LedgerRow.seq.desc()).limit(1)).scalar_one_or_none()
            return self._to_entry(r) if r else None

    def iter_all(self) -> Iterator[LedgerEntry]:
        with self.db.session() as s:
            rows = s.execute(select(LedgerRow).order_by(LedgerRow.seq)).scalars().all()
            return iter([self._to_entry(r) for r in rows])

    def for_subject(self, subject_id: str) -> list[LedgerEntry]:
        with self.db.session() as s:
            rows = s.execute(
                select(LedgerRow).where(LedgerRow.subject_id == subject_id).order_by(LedgerRow.seq)
            ).scalars().all()
            return [self._to_entry(r) for r in rows]
