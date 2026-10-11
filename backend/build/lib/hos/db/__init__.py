"""Persistence: SQLAlchemy 2.x models, repository and the durable ledger backend.

SQLite is the zero-configuration default for a single workstation; set
``HOS_DATABASE_URL`` to a PostgreSQL URL for a shared deployment. Raw instrument
and CRO files are stored content-addressed (by SHA-256) in an object directory.
"""
