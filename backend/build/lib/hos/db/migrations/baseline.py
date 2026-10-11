"""The schema as it stood when migrations were adopted (docs/15 P2.1). Frozen: never edit.

Revision 0001 creates exactly these tables. A database created before migrations existed is
brought to this baseline by adding what it lacks (tables, and columns that are nullable or
carry the scalar default given here), then stamped 0001 and upgraded like any other.
"""

import sqlalchemy as sa

METADATA = sa.MetaData()

sa.Table(
    "files", METADATA,
    sa.Column("sha256", sa.String(length=64), nullable=False),
    sa.Column("filename", sa.String(length=512), nullable=False),
    sa.Column("media_type", sa.String(length=128), nullable=False),
    sa.Column("size_bytes", sa.BigInteger(), nullable=False),
    sa.Column("uploaded_by", sa.String(length=64), nullable=False),
    sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint("sha256")
)
sa.Table(
    "ledger", METADATA,
    sa.Column("seq", sa.BigInteger(), autoincrement=False, nullable=False),
    sa.Column("recorded_at", sa.String(length=64), nullable=False),
    sa.Column("actor_id", sa.String(length=64), nullable=False),
    sa.Column("actor_kind", sa.String(length=16), nullable=False),
    sa.Column("action", sa.String(length=128), nullable=False),
    sa.Column("subject_type", sa.String(length=64), nullable=False),
    sa.Column("subject_id", sa.String(length=64), nullable=False),
    sa.Column("payload", sa.JSON(), nullable=False),
    sa.Column("payload_sha256", sa.String(length=64), nullable=False),
    sa.Column("prev_hash", sa.String(length=64), nullable=False),
    sa.Column("entry_hash", sa.String(length=64), nullable=False),
    sa.Column("reason", sa.Text(), nullable=True),
    sa.Column("scheme", sa.Integer(), nullable=False, default=1),
    sa.PrimaryKeyConstraint("seq"),
    sa.UniqueConstraint("entry_hash")
)
sa.Index("ix_ledger_subject", METADATA.tables["ledger"].c.subject_id)
sa.Table(
    "principals", METADATA,
    sa.Column("id", sa.String(length=64), nullable=False),
    sa.Column("name", sa.String(length=256), nullable=False),
    sa.Column("kind", sa.String(length=16), nullable=False),
    sa.Column("roles", sa.JSON(), nullable=False),
    sa.Column("organisation", sa.String(length=256), nullable=True),
    sa.Column("signing_secret_hash", sa.String(length=256), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("active", sa.Boolean(), nullable=False, default=True),
    sa.Column("failed_attempts", sa.Integer(), nullable=False, default=0),
    sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("must_change_password", sa.Boolean(), nullable=False, default=False),
    sa.PrimaryKeyConstraint("id")
)
sa.Table(
    "programs", METADATA,
    sa.Column("id", sa.String(length=64), nullable=False),
    sa.Column("name", sa.String(length=256), nullable=False),
    sa.Column("sponsor", sa.String(length=256), nullable=True),
    sa.Column("organisation", sa.String(length=256), nullable=True),
    sa.Column("context", sa.JSON(), nullable=False),
    sa.Column("study_set", sa.JSON(), nullable=True),
    sa.Column("created_by", sa.String(length=64), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint("id")
)
sa.Table(
    "simulated_files", METADATA,
    sa.Column("sha256", sa.String(length=64), nullable=False),
    sa.Column("study_id", sa.String(length=64), nullable=False),
    sa.Column("method_id", sa.String(length=64), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint("sha256")
)
sa.Table(
    "compounds", METADATA,
    sa.Column("id", sa.String(length=64), nullable=False),
    sa.Column("program_id", sa.String(length=64), nullable=False),
    sa.Column("name", sa.String(length=256), nullable=False),
    sa.Column("smiles", sa.Text(), nullable=False),
    sa.Column("inchikey", sa.String(length=32), nullable=True),
    sa.Column("profile", sa.JSON(), nullable=False),
    sa.Column("external", sa.JSON(), nullable=False),
    sa.Column("kind", sa.String(length=32), nullable=False, default="small_molecule"),
    sa.Column("entity", sa.JSON(), nullable=True),
    sa.Column("created_by", sa.String(length=64), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(["program_id"], ["programs.id"], ),
    sa.PrimaryKeyConstraint("id")
)
sa.Index("ix_compounds_inchikey", METADATA.tables["compounds"].c.inchikey)
sa.Index("ix_compounds_program_id", METADATA.tables["compounds"].c.program_id)
sa.Table(
    "file_links", METADATA,
    sa.Column("sha256", sa.String(length=64), nullable=False),
    sa.Column("program_id", sa.String(length=64), nullable=False),
    sa.ForeignKeyConstraint(["program_id"], ["programs.id"], ),
    sa.ForeignKeyConstraint(["sha256"], ["files.sha256"], ),
    sa.PrimaryKeyConstraint("sha256", "program_id")
)
sa.Table(
    "program_members", METADATA,
    sa.Column("program_id", sa.String(length=64), nullable=False),
    sa.Column("principal_id", sa.String(length=64), nullable=False),
    sa.Column("added_by", sa.String(length=64), nullable=False),
    sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(["principal_id"], ["principals.id"], ),
    sa.ForeignKeyConstraint(["program_id"], ["programs.id"], ),
    sa.PrimaryKeyConstraint("program_id", "principal_id")
)
sa.Table(
    "sessions", METADATA,
    sa.Column("token_hash", sa.String(length=64), nullable=False),
    sa.Column("principal_id", sa.String(length=64), nullable=False),
    sa.Column("kind", sa.String(length=16), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(["principal_id"], ["principals.id"], ),
    sa.PrimaryKeyConstraint("token_hash")
)
sa.Index("ix_sessions_principal_id", METADATA.tables["sessions"].c.principal_id)
sa.Table(
    "studies", METADATA,
    sa.Column("id", sa.String(length=64), nullable=False),
    sa.Column("program_id", sa.String(length=64), nullable=False),
    sa.Column("compound_id", sa.String(length=64), nullable=False),
    sa.Column("requirement_id", sa.String(length=128), nullable=True),
    sa.Column("driver_id", sa.String(length=64), nullable=False),
    sa.Column("driver_version", sa.String(length=32), nullable=False),
    sa.Column("title", sa.String(length=512), nullable=False),
    sa.Column("state", sa.String(length=32), nullable=False),
    sa.Column("hypothesis", sa.Text(), nullable=True),
    sa.Column("parameters", sa.JSON(), nullable=False),
    sa.Column("protocol", sa.JSON(), nullable=True),
    sa.Column("protocol_version", sa.Integer(), nullable=False, default=0),
    sa.Column("plan", sa.JSON(), nullable=True),
    sa.Column("execution", sa.JSON(), nullable=True),
    sa.Column("raw_files", sa.JSON(), nullable=False),
    sa.Column("data", sa.JSON(), nullable=True),
    sa.Column("results", sa.JSON(), nullable=True),
    sa.Column("interpretation", sa.JSON(), nullable=True),
    sa.Column("report", sa.JSON(), nullable=True),
    sa.Column("signatures", sa.JSON(), nullable=False),
    sa.Column("determinations", sa.JSON(), nullable=False),
    sa.Column("analysis_inputs", sa.JSON(), nullable=False),
    sa.Column("protocol_hash", sa.String(length=64), nullable=True),
    sa.Column("report_hash", sa.String(length=64), nullable=True),
    sa.Column("glp", sa.Boolean(), nullable=False, default=False),
    sa.Column("origin", sa.String(length=16), nullable=False, default="driver"),
    sa.Column("import_record", sa.JSON(), nullable=True),
    sa.Column("evidence_admissible", sa.Boolean(), nullable=False, default=True),
    sa.Column("created_by", sa.String(length=64), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(["compound_id"], ["compounds.id"], ),
    sa.ForeignKeyConstraint(["program_id"], ["programs.id"], ),
    sa.PrimaryKeyConstraint("id")
)
sa.Index("ix_studies_compound_id", METADATA.tables["studies"].c.compound_id)
sa.Index("ix_studies_driver_id", METADATA.tables["studies"].c.driver_id)
sa.Index("ix_studies_program_id", METADATA.tables["studies"].c.program_id)
sa.Index("ix_studies_state", METADATA.tables["studies"].c.state)
sa.Table(
    "artifacts", METADATA,
    sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
    sa.Column("study_id", sa.String(length=64), nullable=False),
    sa.Column("kind", sa.String(length=32), nullable=False),
    sa.Column("version", sa.Integer(), nullable=False),
    sa.Column("content", sa.JSON(), nullable=False),
    sa.Column("content_hash", sa.String(length=64), nullable=False),
    sa.Column("supersedes", sa.Integer(), nullable=True),
    sa.Column("reason", sa.Text(), nullable=True),
    sa.Column("created_by", sa.String(length=64), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(["study_id"], ["studies.id"], ),
    sa.PrimaryKeyConstraint("id")
)
sa.Index("ix_artifact_study_kind", METADATA.tables["artifacts"].c.study_id, METADATA.tables["artifacts"].c.kind, METADATA.tables["artifacts"].c.version, unique=True)
sa.Index("ix_artifacts_study_id", METADATA.tables["artifacts"].c.study_id)
