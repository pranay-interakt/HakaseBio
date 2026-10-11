"""Execution targets: where a study's work physically runs.

The kernel dispatches a study to a target without the driver knowing which kind it is,
in the way an operating system schedules work onto heterogeneous devices:

* :class:`ExternalLabTarget` - a CRO / contract laboratory. Dispatch produces the
  instruction bundle (protocol, sample manifest, data template, return instructions,
  SHA-256 manifest); the study then awaits the laboratory's data return.
* :class:`InHouseTarget` - the sponsor's own laboratory; same bundle, named responsible
  scientist.
* :class:`SimulationTarget` - generates SIMULATED data from the driver's declared,
  cited generator with a recorded seed. Data from this target can never be evidence.

HOS does not transmit anything to a laboratory itself; the bundle is handed to the user.
"""

from hos.kernel.execution.targets import (
    DispatchRecord,
    DispatchStatus,
    ExecutionTarget,
    ExternalLabTarget,
    InHouseTarget,
    SimulationTarget,
    TargetKind,
    target_from_spec,
)

__all__ = [
    "DispatchRecord",
    "DispatchStatus",
    "ExecutionTarget",
    "ExternalLabTarget",
    "InHouseTarget",
    "SimulationTarget",
    "TargetKind",
    "target_from_spec",
]
