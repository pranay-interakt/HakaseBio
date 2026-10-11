import os
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

#: Run the whole suite on PostgreSQL (docs/15 P2.2): every database a test opens, which is a
#: SQLite file by default, becomes a fresh schema in this database instead.
POSTGRES = os.environ.get("HOS_TEST_DATABASE_URL")


@pytest.fixture(autouse=True)
def _postgres_instead_of_sqlite(monkeypatch):
    if not POSTGRES:
        yield
        return
    from sqlalchemy import create_engine, text

    from hos.db.store import Database

    original = Database.__init__
    schemas: dict[str, str] = {}
    opened: list[Database] = []

    def init(self: Database, url: str | None = None) -> None:
        url = url or os.environ.get("HOS_DATABASE_URL", "sqlite:///default")
        if url.startswith("sqlite"):
            if url not in schemas:
                schemas[url] = f"t_{uuid.uuid4().hex[:16]}"
                with create_engine(POSTGRES).begin() as c:
                    c.execute(text(f'CREATE SCHEMA "{schemas[url]}"'))
            sep = "&" if "?" in POSTGRES else "?"
            url = f"{POSTGRES}{sep}options=-csearch_path%3D{schemas[url]}"
        original(self, url)
        opened.append(self)

    monkeypatch.setattr(Database, "__init__", init)
    yield
    for db in opened:
        db.engine.dispose()
    if schemas:
        admin = create_engine(POSTGRES)
        with admin.begin() as c:
            for name in schemas.values():
                c.execute(text(f'DROP SCHEMA "{name}" CASCADE'))
        admin.dispose()
