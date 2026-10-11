"""The CTD Module 2 nonclinical overview and summaries as a versioned, signed programme
document (docs/14 P6). Available as ``kernel.summaries``.

* ``draft`` builds a new version from the programme's current approved and imported studies
  (``hos.ind.summaries``). The author's text from the previous version carries over by section.
* ``revise`` writes the author's text for one section, as a new version.
* ``sign`` fixes a version under a named person's re-authenticated signature. A signed version
  is never edited: further work starts a new draft.

People and agents with a working role may draft and revise ("the agent drafts"); only a human
holding the Responsible Scientist or Programme Lead role signs, and only once every section
that needs the author's text has it. Every version is written to the ledger with its content
hash in the same unit of work (docs/15 P0.1), and the integrity check reconciles them.
"""

from __future__ import annotations

import copy
from typing import Any

from hos.core.provenance import utc_now
from hos.db.models import ProgramDocumentRow
from hos.db.repository import content_hash
from hos.ind.summaries import build_summaries, render_markdown
from hos.kernel.attestation import Principal, PrincipalKind, Role, SignatureMeaning, sign
from hos.kernel.errors import KernelError, NotFound, PermissionDenied
from hos.kernel.uow import atomic

__all__ = ["KIND", "SIGNING_ROLES", "SummaryService"]

KIND = "m2_nonclinical"
#: Who may sign the summaries: the people accountable for the nonclinical content.
SIGNING_ROLES = (Role.RESPONSIBLE_SCIENTIST, Role.PROGRAM_LEAD)


def _missing(content: dict[str, Any]) -> list[str]:
    return [
        f"{'2.4' if s['id'].startswith('2.4.') else s['id']} {s['title']}"
        for s in content["sections"]
        if s["author_required"] and not (s.get("author_text") or "").strip()
    ]


class SummaryService:
    def __init__(self, kernel: Any) -> None:
        self.k = kernel

    # -- reading -------------------------------------------------------------------------------

    def _versions(self, program_id: str) -> list[ProgramDocumentRow]:
        self.k.repo.program(program_id)  # NotFound for an unknown programme
        rows: list[ProgramDocumentRow] = self.k.repo.documents(program_id, KIND)
        return rows

    def _view(self, row: ProgramDocumentRow) -> dict[str, Any]:
        return {
            "id": row.id,
            "version": row.version,
            "status": row.status,
            "content": row.content,
            "content_hash": row.content_hash,
            "supersedes": row.supersedes,
            "reason": row.reason,
            "signatures": row.signatures or [],
            "created_by": row.created_by,
            "created_by_name": self.k.principal_name(row.created_by),
            "created_at": row.created_at.isoformat(),
            "missing_author_sections": _missing(row.content),
        }

    def versions(self, program_id: str) -> list[dict[str, Any]]:
        return [
            {
                "version": r.version,
                "status": r.status,
                "content_hash": r.content_hash,
                "created_by": r.created_by,
                "created_by_name": self.k.principal_name(r.created_by),
                "created_at": r.created_at.isoformat(),
                "reason": r.reason,
            }
            for r in self._versions(program_id)
        ]

    def view(self, program_id: str, version: int | None = None) -> dict[str, Any] | None:
        rows = self._versions(program_id)
        if not rows:
            return None
        if version is None:
            return self._view(rows[-1])
        for r in rows:
            if r.version == version:
                return self._view(r)
        raise NotFound(f"no version {version} of the nonclinical summaries")

    def markdown(self, program_id: str, version: int) -> str:
        doc = self.view(program_id, version)
        assert doc is not None
        return render_markdown(doc)

    # -- writing -------------------------------------------------------------------------------

    def _add(
        self,
        actor: Principal,
        program_id: str,
        content: dict[str, Any],
        *,
        previous: ProgramDocumentRow | None,
        reason: str | None,
        action: str,
        extra: dict[str, Any],
    ) -> dict[str, Any]:
        h = content_hash(content)
        row = ProgramDocumentRow(
            program_id=program_id,
            kind=KIND,
            version=(previous.version + 1) if previous else 1,
            status="draft",
            content=content,
            content_hash=h,
            supersedes=previous.version if previous else None,
            reason=reason,
            signatures=[],
            created_by=actor.id,
            created_at=utc_now(),
        )
        self.k.repo.add(row)
        self.k._record(
            actor,
            action,
            "program",
            program_id,
            {
                "kind": KIND,
                "version": row.version,
                "content_hash": h,
                "supersedes": row.supersedes,
                **extra,
            },
            reason=reason,
        )
        return self._view(row)

    @atomic
    def draft(self, actor: Principal, program_id: str, reason: str | None = None) -> dict[str, Any]:
        """A new version from the programme's current studies; the author's text carries over."""
        self.k._require_worker(actor)
        rows = self._versions(program_id)
        previous = rows[-1] if rows else None
        content = build_summaries(self.k, program_id)
        carried = {
            s["id"]: s.get("author_text", "")
            for s in (previous.content["sections"] if previous else [])
        }
        for s in content["sections"]:
            s["author_text"] = carried.get(s["id"], "")
        return self._add(
            actor,
            program_id,
            content,
            previous=previous,
            reason=reason,
            action="program.summary_drafted",
            extra={"studies": [s["study_id"] for s in content["studies"]]},
        )

    @atomic
    def revise(
        self,
        actor: Principal,
        program_id: str,
        version: int,
        section: str,
        text: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """The author's text for one section, as a new version of the latest draft."""
        self.k._require_worker(actor)
        rows = self._versions(program_id)
        if not rows or rows[-1].version != version:
            raise KernelError("only the latest version can be revised; reload it first")
        latest = rows[-1]
        if latest.status != "draft":
            raise KernelError("a signed version is not edited: draft a new version")
        content = copy.deepcopy(latest.content)
        target = next((s for s in content["sections"] if s["id"] == section), None)
        if target is None:
            raise NotFound(f"no section {section!r}")
        target["author_text"] = text
        return self._add(
            actor,
            program_id,
            content,
            previous=latest,
            reason=reason,
            action="program.summary_revised",
            extra={"section": section},
        )

    @atomic
    def sign(
        self,
        actor: Principal,
        program_id: str,
        version: int,
        *,
        role: Role,
        meaning: SignatureMeaning,
        statement: str,
    ) -> dict[str, Any]:
        """Fix a version under the signer's name. The API re-authenticates before this."""
        if role not in SIGNING_ROLES:
            raise PermissionDenied(
                "the nonclinical summaries are signed by a Responsible Scientist or Programme Lead"
            )
        if actor.kind is not PrincipalKind.HUMAN:
            raise PermissionDenied("only a person signs; agents may draft, never attest")
        if not actor.holds(role):
            raise PermissionDenied(f"{actor.name} does not hold the {role.value} role")
        rows = self._versions(program_id)
        if not rows or rows[-1].version != version:
            raise KernelError("only the latest version can be signed")
        latest = rows[-1]
        if latest.status != "draft":
            raise KernelError("this version is already signed")
        missing = _missing(latest.content)
        if missing:
            raise KernelError("the author's text is still missing in: " + "; ".join(missing))
        sig = sign(
            actor,
            role=role,
            meaning=meaning,
            subject_id=f"{program_id}/{KIND}/v{version}",
            subject_hash=latest.content_hash,
            statement=statement,
        )
        row = self.k.repo.sign_document(latest.id, [sig.to_dict()])
        self.k._record(
            actor,
            "program.summary_signed",
            "program",
            program_id,
            {"kind": KIND, "version": version, "signature": sig.to_dict()},
        )
        return self._view(row)
