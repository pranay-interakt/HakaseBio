"""``hos-db``: the schema, for operators (docs/15 P2.1).

    hos-db upgrade   bring the database (HOS_DATABASE_URL) to this release's schema
    hos-db current   print the database's revision and this release's head
    hos-db check     exit 1 if the database differs from the models
    hos-db integrity verify the ledger, its anchors and the stored state; exit 1 and alert
                     (HOS_ALERT_WEBHOOK) on any finding. Run it on a schedule (docs/16).
"""

from __future__ import annotations

import argparse
import os
import sys

from hos.db.migrate import current_revision, head_revision, schema_drift
from hos.db.store import Database


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="hos-db", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["upgrade", "current", "check", "integrity"])
    args = ap.parse_args(argv)
    if args.command == "upgrade":
        # through the kernel, so an upgrade of a database holding records is ledgered and
        # anchored
        from hos.kernel.kernel import Kernel

        os.environ["HOS_DB_AUTO_UPGRADE"] = "1"
        db = Database()
        before = current_revision(db.engine)
        k = Kernel(db=db)
        print(f"schema {before or 'empty'} -> {k.schema_revision}")
        return 0
    if args.command == "integrity":
        return _integrity()
    db = Database()
    if args.command == "current":
        print(f"database {current_revision(db.engine) or 'empty'}; release {head_revision()}")
        return 0
    drift = schema_drift(db.engine)
    for d in drift:
        print(d)
    return 1 if drift else 0


def _integrity() -> int:
    from hos.api.observability import alert, configure_logging
    from hos.kernel.errors import LedgerIntegrityError
    from hos.kernel.kernel import Kernel

    configure_logging()
    try:
        report = Kernel().integrity()
    except LedgerIntegrityError as exc:
        alert("ledger_integrity", str(exc), wait=True, source_check="hos-db integrity")
        print(f"FAILED: {exc}")
        return 1
    if not report["valid"]:
        checks = sorted({f["check"] for f in report["findings"]})
        alert("ledger_integrity", "the integrity check found problems", wait=True,
              checks=checks, source_check="hos-db integrity")
        for f in report["findings"]:
            print(f"FINDING {f['subject']}: {f['check']} ({f['detail']})")
        return 1
    print(f"ok: {report['entries']} entries, {report['anchors']} checkpoints, state reconciles")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
