"""Alembic environment. The application passes its own connection (``hos.db.migrate``); the
``alembic`` command line, used to write new revisions, connects to ``HOS_DATABASE_URL``."""

from __future__ import annotations

import os

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.engine import Connection

from hos.db.models import Base


def _run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        compare_type=True,
        # SQLite cannot ALTER most things in place; batch mode copies the table instead
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    _run(connection)
else:
    url = context.config.get_main_option("sqlalchemy.url") or os.environ.get("HOS_DATABASE_URL")
    if not url:
        raise SystemExit("set HOS_DATABASE_URL to the database to migrate")
    with create_engine(url).begin() as conn:
        _run(conn)
