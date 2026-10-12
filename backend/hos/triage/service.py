"""Running and recording in silico triage, as ``kernel.triage`` (docs/04 section 4.26).

A run screens one compound and stores the result as a new version, with its content hash
written to the ledger in the same unit of work (docs/15 P0.1), so what was known when a
study was commissioned can be seen afterwards. Earlier versions are never rewritten:
re-running adds a version.

The boundary this module keeps: a triage report is **decision support**. Nothing here is
written into a study, counted towards IND readiness, or carried into a submission. The
report lives in its own table and is read only by the triage views.

A screen that needs a network source (:mod:`hos.triage.herg`) either answers or returns
NOT_PREDICTABLE with the reason; a source being down never fails the run or, worse,
produces a number.
"""

from __future__ import annotations

from typing import Any

from hos.core.provenance import utc_now
from hos.data_sources.chembl import ChEMBLClient
from hos.db.models import TriageReportRow
from hos.db.repository import content_hash
from hos.kernel.attestation import Principal
from hos.kernel.errors import NotFound
from hos.kernel.uow import atomic
from hos.triage.alerts import screen_alerts
from hos.triage.herg import screen_herg
from hos.triage.reference import load_reference
from hos.triage.types import Signal, TriageReport

__all__ = ["ACTION", "TriageService"]

#: The ledger action a run records.
ACTION = "compound.triaged"


class TriageService:
    def __init__(self, kernel: Any) -> None:
        self.k = kernel
        #: reference sets live beside the file store, under the same data directory the
        #: anchors use, so a kernel built on a temporary directory is self-contained
        self.data_dir = kernel.files.root.parent

    # -- reading -------------------------------------------------------------------------------

    def _versions(self, compound_id: str) -> list[TriageReportRow]:
        self.k.repo.compound(compound_id)  # NotFound for an unknown compound
        rows: list[TriageReportRow] = self.k.repo.triage_reports(compound_id)
        return rows

    @staticmethod
    def _view(row: TriageReportRow) -> dict[str, Any]:
        return {
            "compound_id": row.compound_id,
            "program_id": row.program_id,
            "version": row.version,
            "content_hash": row.content_hash,
            "created_by": row.created_by,
            "created_at": row.created_at.isoformat(),
            **row.content,
        }

    def view(self, compound_id: str, version: int | None = None) -> dict[str, Any] | None:
        """One version (the latest by default), or None if the compound has never been run."""
        rows = self._versions(compound_id)
        if not rows:
            return None
        if version is None:
            return self._view(rows[-1])
        for r in rows:
            if r.version == version:
                return self._view(r)
        raise NotFound(f"no triage version {version} for {compound_id}")

    def versions(self, compound_id: str) -> list[dict[str, Any]]:
        return [
            {
                "version": r.version,
                "content_hash": r.content_hash,
                "created_by": r.created_by,
                "created_at": r.created_at.isoformat(),
            }
            for r in self._versions(compound_id)
        ]

    def program_latest(self, program_id: str) -> dict[str, dict[str, Any]]:
        """The latest report per compound in a programme, for the programme's triage view."""
        latest: dict[str, TriageReportRow] = {}
        for r in self.k.repo.program_triage_reports(program_id):
            current = latest.get(r.compound_id)
            if current is None or r.version > current.version:
                latest[r.compound_id] = r
        return {cid: self._view(row) for cid, row in latest.items()}

    # -- running -------------------------------------------------------------------------------

    def _screens(self, row: Any, chembl: ChEMBLClient | None) -> tuple[Signal, ...]:
        smiles = row.smiles or ""
        signals: list[Signal] = list(screen_alerts(smiles))
        # the installed reference set, when there is one, is what the endpoint screens read
        # across; without it they fall back to searching the source live
        reference = load_reference("herg_ic50", self.data_dir)
        # always ask: with neither a set nor a client the screen answers NOT_PREDICTABLE
        # with the reason, which is a result. Omitting the signal would instead leave the
        # report silently one entry short.
        signals.append(
            screen_herg(smiles, chembl, inchikey=row.inchikey or "", reference=reference)
        )
        return tuple(signals)

    @atomic
    def run(
        self,
        actor: Principal,
        compound_id: str,
        *,
        chembl: ChEMBLClient | None = None,
    ) -> dict[str, Any]:
        """Screen a compound and store the result as a new version.

        ``chembl`` is injected so the caller owns the HTTP client (and the tests a recorded
        one); without it only the screens that need no source are run.
        """
        self.k._require_worker(actor)
        row = self.k.repo.compound(compound_id)
        report = TriageReport(
            compound_id=compound_id,
            program_id=row.program_id,
            canonical_smiles=row.smiles or "",
            signals=self._screens(row, chembl),
        )
        content = report.to_dict()
        h = content_hash(content)
        rows = self.k.repo.triage_reports(compound_id)
        stored = TriageReportRow(
            compound_id=compound_id,
            program_id=row.program_id,
            version=(rows[-1].version + 1) if rows else 1,
            content=content,
            content_hash=h,
            created_by=actor.id,
            created_at=utc_now(),
        )
        self.k.repo.add(stored)
        self.k._record(
            actor,
            ACTION,
            "compound",
            compound_id,
            {
                "program_id": row.program_id,
                "version": stored.version,
                "content_hash": h,
                "outcomes": {s.id: s.outcome.value for s in report.signals},
            },
        )
        return self._view(stored)
