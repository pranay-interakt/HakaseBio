"""In silico triage: decision support before a study is commissioned (docs/04 section 4.26).

Screens a compound and reports what is already known or can be estimated from measured
data — published structural alerts, a measured endpoint value, or a read-across estimate
from measured analogues — so a programme can choose and design studies with more than a
structure in hand.

The boundary is absolute: nothing here is evidence. A triage result is never written into
a study record, never counted towards IND readiness, and never carried into a submission.
Where a screen cannot answer in its applicability domain, it says so with the reason
rather than returning a number.
"""

from hos.triage.alerts import ALERT_SETS, screen_alerts
from hos.triage.herg import screen_herg
from hos.triage.readacross import ReadAcrossParams, read_across
from hos.triage.service import ACTION, TriageService
from hos.triage.types import (
    STANDING_LIMITATION,
    AlertMatch,
    Analogue,
    Outcome,
    Signal,
    TriageReport,
)

__all__ = [
    "ACTION",
    "ALERT_SETS",
    "STANDING_LIMITATION",
    "AlertMatch",
    "Analogue",
    "Outcome",
    "ReadAcrossParams",
    "Signal",
    "TriageReport",
    "TriageService",
    "read_across",
    "screen_alerts",
    "screen_herg",
]
