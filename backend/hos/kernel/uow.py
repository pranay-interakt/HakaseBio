"""Units of work for kernel operations (docs/15 P0.1)."""

from __future__ import annotations

import functools
from collections.abc import Callable
from typing import Any, TypeVar, cast

__all__ = ["atomic"]

_F = TypeVar("_F", bound=Callable[..., Any])


def atomic(fn: _F) -> _F:
    """Run a kernel operation as one unit of work (``Database.transaction``): the state change,
    its artefacts and its ledger entry commit together or not at all. Works on the kernel
    (``self.db``) and on services holding it (``self.k.db``)."""
    @functools.wraps(fn)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        db = self.db if hasattr(self, "db") else self.k.db
        with db.transaction():
            return fn(self, *args, **kwargs)
    return cast(_F, wrapper)
