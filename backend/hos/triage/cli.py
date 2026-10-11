"""``hos-triage-reference``: build the measured reference sets triage reads across.

    hos-triage-reference build herg   read ChEMBL's hERG IC50 records and build the set
    hos-triage-reference show herg    what is installed, and where it came from

A build reaches a public scientific API, so it runs where that is allowed — an operator's
machine or a data host, not the cloud build, whose tests run against recorded responses.
The result is written under the data directory (``HOS_DATA_DIR``) and is a build artefact,
not redistributed: a set derived from ChEMBL carries ChEMBL's CC BY-SA 3.0 terms, which the
set records.

Nothing here touches the record: a reference set holds measured values from a public
source, and a triage estimate drawn from one is still decision support, never evidence.
"""

from __future__ import annotations

import argparse
import json
import sys

from hos.triage.reference import (
    build_herg_reference,
    load_reference,
    reference_path,
    save_reference,
)

_ENDPOINTS = {"herg": "herg_ic50"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="hos-triage-reference",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("command", choices=["build", "show"])
    ap.add_argument("endpoint", choices=sorted(_ENDPOINTS))
    ap.add_argument(
        "--max-pages",
        type=int,
        default=40,
        help="stop after this many pages; a build that hits the limit is reported as partial",
    )
    args = ap.parse_args(argv)
    endpoint = _ENDPOINTS[args.endpoint]

    if args.command == "show":
        installed = load_reference(endpoint)
        if installed is None:
            print(f"no {endpoint} reference set installed ({reference_path(endpoint)})")
            return 1
        json.dump(
            {
                "endpoint": installed.endpoint,
                "snapshot_id": installed.snapshot_id,
                "compounds": len(installed.compounds),
                "source": installed.source,
                "source_query": installed.source_query,
                "retrieved_at": installed.retrieved_at,
                "licence": installed.licence,
                "excluded": installed.excluded,
                "path": str(reference_path(endpoint)),
            },
            sys.stdout,
            indent=1,
        )
        sys.stdout.write("\n")
        return 0

    report = build_herg_reference(max_pages=args.max_pages)
    path = save_reference(report.reference)
    json.dump({**report.summary(), "path": str(path)}, sys.stdout, indent=1)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
