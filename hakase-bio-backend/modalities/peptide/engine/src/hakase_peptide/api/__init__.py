"""Layer 4 — Presentation. FastAPI router exposing the V3 peptide platform.

The Presentation Layer only communicates results; it never modifies evidence or
decisions (doc 01 §3.7).
"""

from .router import get_router

__all__ = ["get_router"]
