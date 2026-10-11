"""Principals, roles and electronic signatures.

Four roles carry legal signature authority in preclinical development: the GLP
Study Director (21 CFR 58.33), the Quality Assurance Unit (21 CFR 58.35), the
Attending Veterinarian / IACUC, and, under EU GMP, the Qualified Person. The
kernel models these as first-class roles and enforces three things:

1. only a **human** principal can sign - agents and system processes cannot,
   however capable they are;
2. a principal can only sign in a role they actually hold;
3. a signature binds the signer's name, the date/time, the meaning of the
   signature and a hash of the exact record signed (21 CFR 11.50 and 11.70).

Re-authentication at the moment of signing (21 CFR 11.200) is enforced by the
API layer before :func:`sign` is called.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from hos.core.provenance import utc_now
from hos.kernel.errors import PermissionDenied

__all__ = [
    "SYSTEM",
    "Principal",
    "PrincipalKind",
    "Role",
    "Signature",
    "SignatureMeaning",
    "sign",
]


class PrincipalKind(str, Enum):
    HUMAN = "human"
    AGENT = "agent"
    SYSTEM = "system"


class Role(str, Enum):
    STUDY_DIRECTOR = "study_director"
    QUALITY_ASSURANCE = "quality_assurance"
    ATTENDING_VETERINARIAN = "attending_veterinarian"
    QUALIFIED_PERSON = "qualified_person"
    RESPONSIBLE_SCIENTIST = "responsible_scientist"
    SCIENTIST = "scientist"
    PROGRAM_LEAD = "program_lead"
    ADMIN = "admin"

    @property
    def is_legal_attestor(self) -> bool:
        return self in (
            Role.STUDY_DIRECTOR,
            Role.QUALITY_ASSURANCE,
            Role.ATTENDING_VETERINARIAN,
            Role.QUALIFIED_PERSON,
        )


class SignatureMeaning(str, Enum):
    AUTHORSHIP = "authorship"
    REVIEW = "review"
    APPROVAL = "approval"
    RESPONSIBILITY = "responsibility"
    QA_COMPLIANCE = "qa_compliance_statement"


@dataclass(frozen=True, slots=True)
class Principal:
    id: str
    name: str
    kind: PrincipalKind
    roles: frozenset[Role] = field(default_factory=frozenset)
    organisation: str | None = None

    def holds(self, role: Role) -> bool:
        return role in self.roles

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind.value,
            "roles": sorted(r.value for r in self.roles),
            "organisation": self.organisation,
        }


SYSTEM = Principal(id="system", name="Hakase OS kernel", kind=PrincipalKind.SYSTEM)


@dataclass(frozen=True, slots=True)
class Signature:
    signer_id: str
    signer_name: str
    role: Role
    meaning: SignatureMeaning
    subject_id: str
    subject_hash: str
    signed_at: str
    statement: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "signer_id": self.signer_id,
            "signer_name": self.signer_name,
            "role": self.role.value,
            "meaning": self.meaning.value,
            "subject_id": self.subject_id,
            "subject_hash": self.subject_hash,
            "signed_at": self.signed_at,
            "statement": self.statement,
        }


def sign(
    principal: Principal,
    *,
    role: Role,
    meaning: SignatureMeaning,
    subject_id: str,
    subject_hash: str,
    statement: str,
) -> Signature:
    """Create a signature, enforcing the human-only and role-held rules."""
    if principal.kind is not PrincipalKind.HUMAN:
        raise PermissionDenied(
            f"{principal.kind.value} principal {principal.id!r} cannot sign. Electronic "
            "signatures are reserved for humans; agents may draft, never attest."
        )
    if not principal.holds(role):
        raise PermissionDenied(f"{principal.name} does not hold the {role.value} role")
    if not statement.strip():
        raise PermissionDenied("a signature must carry an explicit statement of meaning")
    return Signature(
        signer_id=principal.id,
        signer_name=principal.name,
        role=role,
        meaning=meaning,
        subject_id=subject_id,
        subject_hash=subject_hash,
        signed_at=utc_now().isoformat(),
        statement=statement.strip(),
    )
