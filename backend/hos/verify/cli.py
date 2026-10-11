"""``hos-verify``: verify a Module 4 export offline.

    hos-verify module4.zip [--json]

Exit status 0 when every check passes (warnings allowed), 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from hos.verify.verifier import verify_bundle

__all__ = ["main"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="hos-verify", description=__doc__.splitlines()[0])
    ap.add_argument("bundle", type=Path, help="Module 4 export (.zip)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args(argv)
    report = verify_bundle(args.bundle.read_bytes())
    print(json.dumps(report.to_dict(), indent=2) if args.json else report.summary())
    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())
