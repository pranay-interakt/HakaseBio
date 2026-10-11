"""The study lifecycle state machine.

A study is the kernel's unit of managed work - the analogue of a process in a
conventional operating system. Every study moves through one explicit state
machine, every transition is recorded in the ledger, and transitions that carry
legal weight require signatures (see :mod:`hos.kernel.attestation`).

```
PROPOSED -> DESIGNED -> PLANNED -> DISPATCHED -> DATA_RECEIVED -> ANALYZED -> REPORTED -> APPROVED
                ^           |           |              |              |            |
                +-- amend --+-----------+              +-- new data --+            |
   any non-terminal state ------------------------------------------------> CANCELLED
   DISPATCHED / DATA_RECEIVED / ANALYZED ---------------------------------> FAILED
```
"""

from __future__ import annotations

from enum import Enum
from typing import Final

from hos.kernel.errors import IllegalTransition

__all__ = ["TRANSITIONS", "StudyState", "assert_transition", "is_terminal"]


class StudyState(str, Enum):
    PROPOSED = "proposed"
    DESIGNED = "designed"
    PLANNED = "planned"
    DISPATCHED = "dispatched"
    DATA_RECEIVED = "data_received"
    ANALYZED = "analyzed"
    REPORTED = "reported"
    APPROVED = "approved"
    CANCELLED = "cancelled"
    FAILED = "failed"


S = StudyState
TRANSITIONS: Final[dict[StudyState, frozenset[StudyState]]] = {
    S.PROPOSED: frozenset({S.DESIGNED, S.CANCELLED}),
    S.DESIGNED: frozenset({S.PLANNED, S.DESIGNED, S.CANCELLED}),
    S.PLANNED: frozenset({S.DISPATCHED, S.DESIGNED, S.CANCELLED}),
    S.DISPATCHED: frozenset({S.DATA_RECEIVED, S.DESIGNED, S.FAILED, S.CANCELLED}),
    S.DATA_RECEIVED: frozenset({S.ANALYZED, S.DATA_RECEIVED, S.FAILED, S.CANCELLED}),
    S.ANALYZED: frozenset({S.REPORTED, S.ANALYZED, S.DATA_RECEIVED, S.FAILED, S.CANCELLED}),
    S.REPORTED: frozenset({S.APPROVED, S.ANALYZED, S.CANCELLED}),
    S.APPROVED: frozenset(),
    S.CANCELLED: frozenset(),
    S.FAILED: frozenset(),
}


def is_terminal(state: StudyState) -> bool:
    return not TRANSITIONS[state]


def assert_transition(current: StudyState, target: StudyState) -> None:
    allowed = TRANSITIONS[current]
    if target not in allowed:
        raise IllegalTransition(
            f"cannot move a study from {current.value!r} to {target.value!r}; "
            f"allowed: {sorted(s.value for s in allowed) or 'none (terminal state)'}"
        )
