"""In silico triage reports, versioned per compound (docs/04 section 4.26).

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "triage_reports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("compound_id", sa.String(length=64), nullable=False),
        sa.Column("program_id", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["compound_id"], ["compounds.id"]),
        sa.ForeignKeyConstraint(["program_id"], ["programs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_triage_version", "triage_reports", ["compound_id", "version"], unique=True)
    op.create_index("ix_triage_reports_compound_id", "triage_reports", ["compound_id"])
    op.create_index("ix_triage_reports_program_id", "triage_reports", ["program_id"])


def downgrade() -> None:
    op.drop_index("ix_triage_reports_program_id", table_name="triage_reports")
    op.drop_index("ix_triage_reports_compound_id", table_name="triage_reports")
    op.drop_index("ix_triage_version", table_name="triage_reports")
    op.drop_table("triage_reports")
