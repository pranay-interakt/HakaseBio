"""Baseline: the schema when migrations were adopted (docs/15 P2.1).

Revision ID: 0001
Revises:
Create Date: 2026-10-11
"""

from alembic import op

from hos.db.migrations.baseline import METADATA

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    METADATA.create_all(op.get_bind())


def downgrade() -> None:
    METADATA.drop_all(op.get_bind())
