"""Live public-database clients owned by the backend.

These are the trusted-source lookups the retired browser workspace performed
client-side. Moving them here makes them part of the server contract: the
browser asks for an evidence panel and renders exactly what comes back.

Design contract (identical to L1–L4):
  • Every client returns a typed envelope with an explicit ``status``
    (``live`` / ``no-data`` / ``unavailable`` / ``error``) and never a
    fabricated value. A silent source is reported as silent.
  • No client raises on a network failure; the failure is data.
  • Nothing here is a model. These modules retrieve published measurements and
    annotations and shape them; they do not derive scientific conclusions.
"""

from __future__ import annotations

SCHEMA_VERSION = "hakase.small-molecule.external.v1"

__all__ = ["SCHEMA_VERSION"]
