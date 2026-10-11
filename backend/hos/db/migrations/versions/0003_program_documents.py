"""Programme documents: versions of the CTD Module 2 nonclinical summaries (docs/14 P6).

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "program_documents",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("program_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("supersedes", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("signatures", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["program_id"], ["programs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_program_document_version",
        "program_documents",
        ["program_id", "kind", "version"],
        unique=True,
    )
    op.create_index("ix_program_documents_program_id", "program_documents", ["program_id"])


def downgrade() -> None:
    op.drop_index("ix_program_documents_program_id", table_name="program_documents")
    op.drop_index("ix_program_document_version", table_name="program_documents")
    op.drop_table("program_documents")
