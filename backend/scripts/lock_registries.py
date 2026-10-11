"""Append new citation and method entries to tests/core/registry.lock.json.

Existing entries are never rewritten: provenance embeds each method and its citations, so
their content is part of every analysis hash. Changing an existing entry would make signed
studies fail re-verification. To change one, register a new key (citations) or bump the
method's version, and lock the new entry."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hos.core.citations import CITATIONS
from hos.core.methods import METHODS
from hos.db.repository import content_hash

LOCK = Path(__file__).resolve().parents[1] / "tests" / "core" / "registry.lock.json"


def entries() -> dict[str, dict[str, str]]:
    return {
        "citations": {k: content_hash(c.to_dict()) for k, c in CITATIONS.items()},
        "methods": {k: content_hash(m.to_dict()) for k, m in METHODS.items()},
    }


def main() -> None:
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {"citations": {}, "methods": {}}
    added = 0
    for kind, cur in entries().items():
        for k, h in cur.items():
            if k not in lock[kind]:
                lock[kind][k] = h
                added += 1
    LOCK.write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n")
    print(f"{added} new entries locked")


if __name__ == "__main__":
    main()
