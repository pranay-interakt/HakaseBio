#!/usr/bin/env python3
"""REMOVED — superseded by the live multi-source resolver.

An offline prebuilt index was the wrong architecture for this product: known
drugs are resolved LIVE at simulation-load time from ChEMBL + PubChem + openFDA
in `models/drug_lookup.py`, with no offline cache and no fallback file. This
tombstone is kept only because the sandbox mount is write-but-not-delete.
"""

raise SystemExit("Deprecated: known-drug resolution is live-only (models/drug_lookup.py).")
