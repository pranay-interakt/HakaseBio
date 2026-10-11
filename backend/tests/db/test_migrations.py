"""Schema migrations (docs/15 P2.1): the revisions build exactly the models, a database from
before migrations is adopted, and a deployment can insist on an explicit upgrade."""

import pytest
import sqlalchemy as sa

from hos.db import cli
from hos.db.migrate import BASELINE, current_revision, head_revision, schema_drift
from hos.db.models import Base
from hos.db.store import Database, FileStore
from hos.kernel.attestation import PrincipalKind, Role
from hos.kernel.kernel import Kernel
from tests.kernel.test_kernel import PW


def _url(tmp_path, name="m.sqlite3"):
    return f"sqlite:///{tmp_path / name}"


def test_upgrading_an_empty_database_yields_exactly_the_models(tmp_path):
    db = Database(_url(tmp_path))
    assert db.upgrade() == (None, head_revision())
    assert schema_drift(db.engine) == []       # a model change without its revision fails
    assert db.upgrade() == (head_revision(), head_revision())          # idempotent


def test_a_model_change_without_a_revision_is_drift(tmp_path):
    db = Database(_url(tmp_path))
    db.upgrade()
    with db.engine.begin() as c:
        c.execute(sa.text("ALTER TABLE studies ADD COLUMN stray VARCHAR(8)"))
    assert any("stray" in str(d) for d in schema_drift(db.engine))


def _old_database(url):
    """The schema as released before study import and sessions existed (created the way
    releases then did, with create_all and no migration history)."""
    eng = sa.create_engine(url)
    Base.metadata.create_all(eng)
    with eng.begin() as c:
        for t in ("sessions", "program_members", "file_links"):
            c.execute(sa.text(f"DROP TABLE {t}"))
        for col in ("origin", "import_record"):
            c.execute(sa.text(f"ALTER TABLE studies DROP COLUMN {col}"))


def test_a_database_from_before_migrations_is_adopted(tmp_path):
    url = _url(tmp_path)
    _old_database(url)
    db = Database(url)
    before, after = db.upgrade()
    assert (before, after) == (BASELINE, head_revision())
    insp = sa.inspect(db.engine)
    assert {"origin", "import_record"} <= {c["name"] for c in insp.get_columns("studies")}
    assert {"sessions", "program_members", "file_links"} <= set(insp.get_table_names())
    assert current_revision(db.engine) == head_revision()


def test_an_unsafe_schema_gap_is_refused(tmp_path):
    url = _url(tmp_path)
    with sa.create_engine(url).begin() as c:
        c.execute(sa.text("CREATE TABLE studies (id VARCHAR(64) PRIMARY KEY)"))
    with pytest.raises(RuntimeError, match="cannot be added automatically"):
        Database(url).upgrade()


def test_an_explicit_upgrade_can_be_required(tmp_path, monkeypatch):
    monkeypatch.setenv("HOS_DB_AUTO_UPGRADE", "0")
    with pytest.raises(RuntimeError, match="run `hos-db upgrade`"):
        Kernel(db=Database(_url(tmp_path)), files=FileStore(tmp_path / "o"))
    Database(_url(tmp_path)).upgrade()
    k = Kernel(db=Database(_url(tmp_path)), files=FileStore(tmp_path / "o"))
    assert k.schema_revision == head_revision()


def test_an_upgrade_of_a_database_holding_records_is_ledgered(tmp_path, monkeypatch):
    url = _url(tmp_path)
    k = Kernel(db=Database(url), files=FileStore(tmp_path / "o"))
    k.register_principal(None, principal_id="admin", name="A", kind=PrincipalKind.HUMAN,
                         roles=[Role.ADMIN], password=PW)
    # pretend the database was one revision behind
    monkeypatch.setattr(Database, "upgrade", lambda self: ("0000", head_revision()))
    k2 = Kernel(db=Database(url), files=FileStore(tmp_path / "o"))
    last = k2.ledger.last()
    assert (last.action, last.actor_id, last.payload) == (
        "system.schema_upgraded", "system", {"from": "0000", "to": head_revision()})
    assert k2.integrity()["valid"]


def test_the_command_line(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("HOS_DATABASE_URL", _url(tmp_path))
    monkeypatch.setenv("HOS_DATA_DIR", str(tmp_path / "data"))
    assert cli.main(["current"]) == 0
    assert "database empty" in capsys.readouterr().out
    assert cli.main(["upgrade"]) == 0
    assert f"empty -> {head_revision()}" in capsys.readouterr().out
    assert cli.main(["check"]) == 0
