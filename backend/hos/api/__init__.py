"""HTTP API (FastAPI). Thin: every operation delegates to the kernel facade."""

from hos.api.app import create_app

__all__ = ["create_app"]
