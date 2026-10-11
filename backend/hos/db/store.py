"""Database engine, content-addressed file store, and the SQL ledger backend."""

from __future__ import annotations

import hashlib
import os
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from hos.db.models import LedgerRow
from hos.kernel.ledger import LedgerEntry

__all__ = ["CommitThenRaise", "Database", "FileStore", "SqlLedgerBackend", "default_data_dir"]


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
        #: how long a unit of work waits for another writer before giving up
        self.write_wait_seconds = float(os.environ.get("HOS_WRITE_WAIT_SECONDS", "30"))
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
                # wait this long for another writer (process) to finish
                cur.execute(f"PRAGMA busy_timeout={int(self.write_wait_seconds * 1000)}")
                cur.close()
        self._factory = sessionmaker(self.engine, expire_on_commit=False, future=True)
        self._uow: ContextVar[Session | None] = ContextVar(f"hos_uow_{id(self)}", default=None)
        self._write_lock = threading.RLock()

    def upgrade(self) -> tuple[str | None, str]:
        """Bring the schema to this release's head revision (docs/15 P2.1); returns the
        revisions before and after."""
        from hos.db.migrate import upgrade

        with self._write_lock:
            return upgrade(self.engine)

    def require_current(self) -> str:
        """Refuse a database whose schema is not this release's (``HOS_DB_AUTO_UPGRADE=0``,
        where an operator runs ``hos-db upgrade`` as a deliberate, recorded step)."""
        from hos.db.migrate import current_revision, head_revision

        current, head = current_revision(self.engine), head_revision()
        if current != head:
            raise RuntimeError(f"the database schema is at {current or 'nothing'}, this release "
                               f"needs {head}: run `hos-db upgrade`")
        return head

    @contextmanager
    def session(self) -> Iterator[Session]:
        """A session. Inside :meth:`transaction` it is the unit of work's own session, which
        only the unit of work commits; otherwise a short session committed on exit."""
        uow = self._uow.get()
        if uow is not None:
            yield uow
            return
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    def in_transaction(self) -> bool:
        return self._uow.get() is not None

    @contextmanager
    def transaction(self) -> Iterator[Session]:
        """One unit of work (docs/15 P0.1). A state change, its artefacts and its ledger entry
        commit together or not at all: every :meth:`session` opened inside joins this one,
        nested calls join too, and only the outermost commits. Writers are serialised within
        the process, so ledger sequence numbers are allocated one writer at a time; across
        processes and hosts the first statement of every unit of work updates the single
        ``writer_lock`` row, and that row lock is held until commit (docs/15 P2.6). Every read
        a unit of work makes therefore sees all earlier commits: no lost updates, no ledger
        sequence number allocated twice. A writer that waits longer than
        ``HOS_WRITE_WAIT_SECONDS`` (default 30) gives up and changes nothing.

        Raising :class:`CommitThenRaise` commits what was recorded (a refused login, a
        rejected upload) and then raises the wrapped error."""
        if self._uow.get() is not None:
            yield self._uow.get()  # type: ignore[misc]
            return
        with self._write_lock:
            s = self._factory()
            token = self._uow.set(s)
            try:
                self._take_writer_lock(s)
                yield s
                s.commit()
            except CommitThenRaise as ctr:
                s.commit()
                raise ctr.error from None
            except BaseException:
                s.rollback()
                raise
            finally:
                self._uow.reset(token)
                s.close()

    def _take_writer_lock(self, s: Session) -> None:
        if self.engine.dialect.name == "postgresql":
            s.execute(text(f"SET LOCAL lock_timeout = '{int(self.write_wait_seconds * 1000)}ms'"))
        done = s.execute(text("UPDATE writer_lock SET writes = writes + 1 WHERE id = 1"))
        if getattr(done, "rowcount", 0) != 1:
            raise RuntimeError("the writer_lock row is missing: the database was changed "
                               "outside its migrations")


class CommitThenRaise(Exception):
    """Inside :meth:`Database.transaction`: keep what was recorded, then raise ``error``."""

    def __init__(self, error: Exception) -> None:
        super().__init__(str(error))
        self.error = error


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
            entry_hash=r.entry_hash, reason=r.reason, scheme=r.scheme or 1,
        )

    def append(self, entry: LedgerEntry) -> None:
        if not self.db.in_transaction():
            # outside a unit of work the sequence number could be taken twice (docs/15 P2.6)
            raise RuntimeError("ledger entries are written only inside Database.transaction()")
        with self.db.session() as s:
            s.add(LedgerRow(
                seq=entry.seq, recorded_at=entry.recorded_at, actor_id=entry.actor_id,
                actor_kind=entry.actor_kind, action=entry.action,
                subject_type=entry.subject_type, subject_id=entry.subject_id,
                payload=entry.payload, payload_sha256=entry.payload_sha256,
                prev_hash=entry.prev_hash, entry_hash=entry.entry_hash, reason=entry.reason,
                scheme=entry.scheme,
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
