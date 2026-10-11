"""Every timestamp read back from the database carries its timezone.

Timestamps are written in UTC. SQLite has no timezone type and returns a naive datetime,
which a reader would take for local time: a record made at 17:47 UTC would be shown as
17:47 in the reader's own zone, and "3 hours ago" would be hours out. The column type
labels it on the way out, so a recorded time means the same thing everywhere.
"""

from datetime import UTC, datetime, timedelta

from hos.core.provenance import utc_now
from hos.db.models import PrincipalRow
from hos.db.store import Database, FileStore
from hos.kernel.attestation import PrincipalKind, Role
from hos.kernel.kernel import Kernel

PW = "correct horse battery staple"


def _kernel(tmp_path):
    return Kernel(
        db=Database(f"sqlite:///{tmp_path / 'ts.sqlite3'}"), files=FileStore(tmp_path / "objects")
    )


def test_a_stored_timestamp_comes_back_aware(tmp_path):
    k = _kernel(tmp_path)
    k.register_principal(
        None,
        principal_id="admin",
        name="Ada Admin",
        kind=PrincipalKind.HUMAN,
        roles=[Role.ADMIN],
        password=PW,
    )
    row = k.repo.principal("admin")
    assert isinstance(row.created_at, datetime)
    assert row.created_at.tzinfo is not None
    assert row.created_at.utcoffset() == timedelta(0)
    # and it serialises unambiguously, which is what a reader parses
    assert row.created_at.isoformat().endswith("+00:00")
    assert abs((utc_now() - row.created_at).total_seconds()) < 60


def test_an_aware_timestamp_is_not_shifted(tmp_path):
    """A value written with an explicit zone keeps the instant it named."""
    k = _kernel(tmp_path)
    written = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
    k.repo.add(
        PrincipalRow(
            id="t1",
            name="T",
            kind="human",
            roles=[],
            organisation=None,
            signing_secret_hash=None,
            created_at=written,
            active=True,
        )
    )
    assert k.repo.principal("t1").created_at == written


def test_the_api_serialises_timestamps_with_their_zone(tmp_path):
    """The view layer must not hand a reader a time it has to guess the zone for."""
    k = _kernel(tmp_path)
    admin = k.register_principal(
        None,
        principal_id="admin",
        name="Ada Admin",
        kind=PrincipalKind.HUMAN,
        roles=[Role.ADMIN, Role.SCIENTIST, Role.RESPONSIBLE_SCIENTIST],
        password=PW,
    )
    from hos.core.regulatory import Indication, Modality, ProgramContext, Route

    ctx = ProgramContext(
        modality=Modality.SMALL_MOLECULE,
        indication=Indication.CHRONIC_NON_ONCOLOGY,
        route=Route.ORAL,
        intended_clinical_duration_days=365,
        max_trial_duration_days=28,
    )
    prog = k.create_program(admin, name="TS-1", context=ctx)
    cmp_ = k.register_compound(admin, prog["id"], name="aspirin", smiles="CC(=O)Oc1ccccc1C(=O)O")
    for value in (prog["created_at"], cmp_["created_at"]):
        assert value.endswith("+00:00"), value
