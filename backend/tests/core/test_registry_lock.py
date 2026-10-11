"""The citation and method registries are append-only.

Every computed Quantity's provenance embeds its method and the method's citations, so their
content is part of every analysis hash. Editing an existing entry would make signed studies
fail re-verification (P9). Register a new citation key, or bump the method's version, and run
``python scripts/lock_registries.py`` to lock new entries."""

import json
from pathlib import Path

from hos.core.citations import CITATIONS
from hos.core.methods import METHODS
from hos.db.repository import content_hash

LOCK = json.loads((Path(__file__).parent / "registry.lock.json").read_text())


def test_locked_citations_are_unchanged():
    changed = [k for k, h in LOCK["citations"].items()
               if k in CITATIONS and content_hash(CITATIONS[k].to_dict()) != h]
    removed = [k for k in LOCK["citations"] if k not in CITATIONS]
    assert not changed and not removed, (
        f"citations changed {changed} or removed {removed}: they are append-only; add a new key")


def test_locked_methods_are_unchanged():
    changed = [k for k, h in LOCK["methods"].items()
               if k in METHODS and content_hash(METHODS[k].to_dict()) != h]
    removed = [k for k in LOCK["methods"] if k not in METHODS]
    assert not changed and not removed, (
        f"methods changed {changed} or removed {removed}: register a new version instead")


def test_every_entry_is_locked():
    new = [k for k in CITATIONS if k not in LOCK["citations"]] + [
        k for k in METHODS if k not in LOCK["methods"]]
    assert not new, f"run scripts/lock_registries.py to lock new entries: {new}"
