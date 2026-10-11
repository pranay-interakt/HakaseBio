"""Kernel error types."""


class KernelError(Exception):
    """Base class for kernel errors."""


class IllegalTransition(KernelError):
    """A lifecycle transition was attempted that the state machine does not allow."""


class AttestationRequired(KernelError):
    """An operation needs a signature from a role that has not signed."""


class PermissionDenied(KernelError):
    """The principal lacks the authority for the requested operation."""


class LedgerIntegrityError(KernelError):
    """The provenance ledger failed verification (tampering or corruption)."""


class NotFound(KernelError):
    """A referenced entity does not exist."""


class EvidenceInadmissible(KernelError):
    """Simulated or unavailable data was offered where evidence is required."""


class DriverError(KernelError):
    """A driver could not perform the requested step."""
