"""Writer lock: one row every unit of work updates first (docs/15 P2.6).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    table = op.create_table(
        "writer_lock",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("writes", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.bulk_insert(table, [{"id": 1, "writes": 0}])


def downgrade() -> None:
    op.drop_table("writer_lock")
