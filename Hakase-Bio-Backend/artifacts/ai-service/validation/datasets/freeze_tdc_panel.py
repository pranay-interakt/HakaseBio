#!/usr/bin/env python3
"""Freeze the TDC scaffold-split TEST set for every endpoint in the ADMET panel.

Writes validation/datasets/tdc_<name>_test.csv (Drug_ID,Drug,Y) for each PANEL
entry. Idempotent — skips files that already exist. Requires PyTDC at freeze time
only; the validator then reads the committed CSVs with no external dependency.

  python3 validation/datasets/freeze_tdc_panel.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from validation.endpoint_validation import PANEL, _csv_path

from tdc.single_pred import ADME, Tox  # type: ignore

OUT = os.path.dirname(os.path.abspath(__file__))


def main() -> int:
    done, skipped, failed = [], [], []
    for name, cfg in PANEL.items():
        path = _csv_path(name)
        if os.path.exists(path):
            skipped.append(name)
            continue
        try:
            loader = Tox if cfg["cls"] == "Tox" else ADME
            te = loader(name=cfg["tdc"]).get_split()["test"][["Drug_ID", "Drug", "Y"]]
            te.to_csv(path, index=False)
            done.append((name, len(te)))
            print(f"froze {name:16s} ({cfg['tdc']:28s}) {len(te):5d} rows", flush=True)
        except Exception as e:  # noqa: BLE001
            failed.append((name, repr(e)[:90]))
            print(f"FAILED {name}: {repr(e)[:90]}", flush=True)
    print(f"\nfroze {len(done)}, skipped {len(skipped)} existing, failed {len(failed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
