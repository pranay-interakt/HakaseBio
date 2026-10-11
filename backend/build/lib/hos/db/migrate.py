"""Schema migrations (docs/15 P2.1).

The schema is defined by the models (:mod:`hos.db.models`) and changed only by Alembic
revisions in ``hos/db/migrations/versions``. Revision 0001 is the schema as it stood when
migrations were adopted. A test (and ``hos-db check``) proves that upgrading an empty
database to head yields exactly the models, so a model change without its revision fails CI.

* An empty database is upgraded from nothing.
* A database created before migrations existed (tables, no ``alembic_version``) is first
  brought to the baseline by adding what it lacks, then stamped 0001 and upgraded.
* On PostgreSQL the upgrade holds an advisory lock, so two workers starting together do not
  both migrate.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import MetaData, inspect, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.sql.schema import ScalarElementColumnDefault

from hos.db.models import Base

__all__ = ["BASELINE", "add_missing_columns", "current_revision", "head_revision",
           "schema_drift", "upgrade"]

BASELINE = "0001"
_SCRIPTS = Path(__file__).with_name("migrations")
#: pg_advisory_xact_lock key for migrations ("HOSMIGR" as a number)
_LOCK = 0x484F534D494752


def _config(connection: Connection | None = None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(_SCRIPTS))
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def head_revision() -> str:
    head = ScriptDirectory.from_config(_config()).get_current_head()
    assert head is not None
    return head


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def add_missing_columns(engine: Engine, metadata: MetaData) -> list[str]:
    """Add the columns of ``metadata`` that a database lacks, when they are nullable or carry
    a scalar default. Anything else (renames, type changes, new constraints) is refused."""
    added: list[str] = []
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            present = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in present:
                    continue
                default = (col.default.arg if isinstance(col.default, ScalarElementColumnDefault)
                           else None)
                if not col.nullable and default is None:
                    raise RuntimeError(f"database is older than the schema: {table.name}."
                                       f"{col.name} cannot be added automatically")
                col_type = col.type.compile(dialect=engine.dialect)
                ddl = f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type}"
                if default is not None:
                    lit = (("1" if default else "0") if isinstance(default, bool)
                           else repr(default) if isinstance(default, (int, float))
                           else "'" + str(default).replace("'", "''") + "'")
                    ddl += f" DEFAULT {lit}"
                conn.execute(text(ddl))
                added.append(f"{table.name}.{col.name}")
    return added


def _adopt_unversioned(engine: Engine) -> bool:
    """Bring a database from before migrations to the baseline and stamp it. False when the
    database is empty or already versioned."""
    from hos.db.migrations.baseline import METADATA as baseline

    tables = set(inspect(engine).get_table_names())
    if "alembic_version" in tables or not tables & set(baseline.tables):
        return False
    baseline.create_all(engine)              # tables added since the database was created
    add_missing_columns(engine, baseline)
    with engine.begin() as conn:
        command.stamp(_config(conn), BASELINE)
    return True


def upgrade(engine: Engine) -> tuple[str | None, str]:
    """Upgrade to head. Returns (revision before, revision after); before is None for a
    database that was empty."""
    _adopt_unversioned(engine)
    with engine.begin() as conn:
        if conn.dialect.name == "postgresql":
            conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _LOCK})
        before = MigrationContext.configure(conn).get_current_revision()
        if before != head_revision():
            command.upgrade(_config(conn), "head")
    return before, head_revision()


def schema_drift(engine: Engine) -> list[Any]:
    """Differences between the database and the models; empty when they agree."""
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        return list(compare_metadata(ctx, Base.metadata))
