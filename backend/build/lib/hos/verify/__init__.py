"""Verification bundle and offline verifier (docs/14 P9).

The Module 4 export carries everything needed to recompute every driver-run figure from the
raw files, without the database or network: raw data, driver identity and version, design
parameters, analysis inputs, the compound structure, the programme context, the recorded
protocol / analysis / report hashes, signatures and the ledger chain. ``hos-verify`` re-runs
the drivers and checks every hash; imported studies are checked for report hash and
signatures only (their values are attested from report, not recomputable).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from hos.verify.bundle import BUNDLE_FORMAT, verification_files

if TYPE_CHECKING:
    from hos.verify.verifier import VerificationReport, verify_bundle

__all__ = ["BUNDLE_FORMAT", "VerificationReport", "verification_files", "verify_bundle"]


def __getattr__(name: str) -> Any:
    # the verifier imports the kernel, which (via Module 4 assembly) imports this package;
    # loading it on first use keeps the import graph acyclic
    if name in ("VerificationReport", "verify_bundle"):
        from hos.verify import verifier
        return getattr(verifier, name)
    raise AttributeError(name)
