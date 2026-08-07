"""Numpy-safe JSON sanitisation for API responses.

The scientific engines and embedding providers compute in numpy; a response
that still carries ``np.float32`` / ``np.ndarray`` values is not JSON
serialisable. ``sanitize`` recursively converts numpy scalars and arrays to
their native-Python equivalents so the payload round-trips cleanly through
``json.dumps`` / FastAPI's encoder. It never fabricates or drops data — it only
changes the concrete type of already-computed values.

Kept free of any FastAPI import so it can be reused (and unit-tested) without a
web-server dependency.
"""

from __future__ import annotations

from typing import Any

import numpy as np


def sanitize(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v) for v in obj]
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return sanitize(obj.tolist())
    return obj
