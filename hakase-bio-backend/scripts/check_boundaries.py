#!/usr/bin/env python3
"""Architectural boundary enforcement.

The repository is two-tier: `platform/` holds modality-agnostic code, and
`modalities/` holds the verticals. That split is only real if the dependency
arrows point one way, so this script fails the build on:

  1. platform -> modality      any `platform/` file importing a modality package
  2. modality -> modality      any modality importing a *different* modality
  3. platform -> service       platform or a modality importing the composition root
  4. dangling relative import  `from .x import y` naming a module that isn't there

Rule 4 is the one that catches a half-finished move. When a module is relocated
across packages, the imports left behind still *look* local — `from . import
cardiotox` reads as an intra-package reference, not as a boundary crossing, so
rules 1-3 cannot see it. They are usually deferred inside a function body too,
so nothing fails at import time and the service only breaks when that branch is
first executed. Checking that every relative import resolves on disk catches
them statically.

Run:  python scripts/check_boundaries.py
Exits non-zero and prints every violation with file:line.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Distribution package name -> the tier it belongs to.
PLATFORM_PKGS = {
    "hakase_kernel",
    "hakase_chemistry",
    "hakase_sequence",
    "hakase_structure",
}
MODALITY_PKGS = {
    "hakase_smallmol": "small-molecule",
    "hakase_peptide": "peptide",
    "hakase_antibody": "antibody",
}
SERVICE_PKG = "hakase_service"

# Source trees, mapped to the package that owns them.
TREES: list[tuple[Path, str, str]] = [
    (ROOT / "platform/kernel/src", "hakase_kernel", "platform"),
    (ROOT / "platform/chemistry/src", "hakase_chemistry", "platform"),
    (ROOT / "platform/sequence/src", "hakase_sequence", "platform"),
    (ROOT / "platform/structure/src", "hakase_structure", "platform"),
    (ROOT / "modalities/small-molecule/engine/src", "hakase_smallmol", "modality"),
    (ROOT / "modalities/peptide/engine/src", "hakase_peptide", "modality"),
    (ROOT / "modalities/antibody/engine/src", "hakase_antibody", "modality"),
]


def parse(path: Path) -> ast.AST | None:
    try:
        return ast.parse(path.read_text(), filename=str(path))
    except SyntaxError as exc:
        print(f"  ! cannot parse {path}: {exc}", file=sys.stderr)
        return None


def imported_packages(tree: ast.AST) -> list[tuple[int, str]]:
    """Yield (lineno, top_level_package) for every absolute import in a file."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                found.append((node.lineno, node.module.split(".")[0]))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                found.append((node.lineno, alias.name.split(".")[0]))
    return found


def package_names(pkg_dir: Path) -> set[str]:
    """Top-level names bound in a package's __init__.py.

    `from . import X` is equally valid when X is a submodule and when it is a
    constant re-exported by the package, so both have to be recognised.
    """
    init = pkg_dir / "__init__.py"
    tree = parse(init) if init.exists() else None
    if tree is None:
        return set()

    names: set[str] = set()
    for node in getattr(tree, "body", []):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update(a.asname or a.name.split(".")[0] for a in node.names)
    return names


def dangling_relative_imports(tree: ast.AST, path: Path, tree_root: Path) -> list[tuple[int, str]]:
    """Yield (lineno, target) for relative imports that resolve to nothing on disk.

    Subpackages here are namespace packages, so a target counts as present if it
    is either a module file or a directory.
    """
    pkg = list(path.relative_to(tree_root).parts[:-1])

    def exists(parts: list[str]) -> bool:
        base = tree_root.joinpath(*parts)
        return base.with_suffix(".py").exists() or base.is_dir()

    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or not node.level:
            continue
        # level 1 is the current package, each extra level walks one up.
        up = node.level - 1
        if up > len(pkg):
            found.append((node.lineno, "." * node.level + (node.module or "")))
            continue
        base = pkg[: len(pkg) - up]
        if node.module:
            if not exists(base + node.module.split(".")):
                found.append((node.lineno, "." * node.level + node.module))
        else:
            exported = None
            for alias in node.names:
                if exists(base + [alias.name]):
                    continue
                if exported is None:
                    exported = package_names(tree_root.joinpath(*base))
                if alias.name not in exported:
                    found.append((node.lineno, "." * node.level + alias.name))
    return found


def main() -> int:
    violations: list[str] = []

    for tree_root, own_pkg, tier in TREES:
        if not tree_root.exists():
            continue
        for py in sorted(tree_root.rglob("*.py")):
            if "__pycache__" in py.parts:
                continue
            rel = py.relative_to(ROOT)
            # Tests may legitimately import the composition root to assert wiring.
            is_test = "tests" in py.parts or py.name.startswith("test_")

            tree = parse(py)
            if tree is None:
                continue

            for lineno, target in dangling_relative_imports(tree, py, tree_root):
                violations.append(
                    f"{rel}:{lineno}: relative import '{target}' resolves to nothing — "
                    f"the module has moved; point the import at its new home."
                )

            for lineno, pkg in imported_packages(tree):
                if pkg == own_pkg:
                    continue

                if tier == "platform" and pkg in MODALITY_PKGS:
                    violations.append(
                        f"{rel}:{lineno}: platform package '{own_pkg}' imports "
                        f"modality '{pkg}' — promote the shared code into a "
                        f"platform substrate instead."
                    )
                elif tier == "modality" and pkg in MODALITY_PKGS:
                    violations.append(
                        f"{rel}:{lineno}: modality '{MODALITY_PKGS[own_pkg]}' imports "
                        f"modality '{MODALITY_PKGS[pkg]}' — promote the shared code "
                        f"into a platform substrate instead."
                    )
                elif pkg == SERVICE_PKG and not is_test:
                    violations.append(
                        f"{rel}:{lineno}: '{own_pkg}' imports the composition root "
                        f"'{SERVICE_PKG}' — dependencies must point away from it."
                    )

    if violations:
        print(f"Boundary check FAILED — {len(violations)} violation(s):\n")
        for v in violations:
            print(f"  {v}")
        print(
            "\nRule: platform/ must never import modalities/, no modality may "
            "import another, and every relative import must resolve. See ARCHITECTURE.md."
        )
        return 1

    print("Boundary check passed — dependency direction is clean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
