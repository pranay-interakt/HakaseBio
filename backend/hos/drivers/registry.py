"""Driver registry: registration, ABI checking, discovery and requirement matching.

Built-in drivers register themselves here. Third-party drivers are discovered from the
``hos.drivers`` entry-point group, so a laboratory, CRO or partner can ship a study
type as an ordinary Python package::

    [project.entry-points."hos.drivers"]
    my_assay = "my_package.driver:MyAssayDriver"

A driver built for a different ABI major version is refused rather than loaded.
"""

from __future__ import annotations

import importlib
import logging
from collections.abc import Iterator
from importlib.metadata import entry_points

from hos.core.regulatory.context import ProgramContext
from hos.core.regulatory.engine import StudyRequirement
from hos.drivers.base import DRIVER_ABI, StudyDriver, Support
from hos.kernel.errors import DriverError, NotFound

__all__ = ["BUILTIN_DRIVERS", "DriverRegistry", "default_registry"]

log = logging.getLogger(__name__)

#: Import paths of the drivers shipped with HOS.
BUILTIN_DRIVERS: tuple[str, ...] = (
    "hos.drivers.metabolic_stability:MetabolicStabilityDriver",
    "hos.drivers.herg:HergPatchClampDriver",
    "hos.drivers.repeat_dose_tox:RepeatDoseToxicityDriver",
    "hos.drivers.bioanalytical_validation:BioanalyticalValidationDriver",
    "hos.drivers.toxicokinetics:ToxicokineticsDriver",
    "hos.drivers.in_vivo_pk:InVivoPKDriver",
    "hos.drivers.plasma_protein_binding:PlasmaProteinBindingDriver",
    "hos.drivers.ames:AmesDriver",
    "hos.drivers.dose_range_finding:DoseRangeFindingDriver",
    "hos.drivers.in_vitro_potency:InVitroPotencyDriver",
    "hos.drivers.safety_pharm_cns:SafetyPharmCNSDriver",
    "hos.drivers.safety_pharm_respiratory:SafetyPharmRespiratoryDriver",
    "hos.drivers.in_vivo_qt_telemetry:InVivoQTTelemetryDriver",
    "hos.drivers.peptide_stability:PeptideStabilityDriver",
)

_REQUIRED_ATTRS = ("id", "name", "version", "requirement_ids", "modalities", "ctd_section")


def _abi_major(v: str) -> str:
    return v.split(".", 1)[0]


class DriverRegistry:
    def __init__(self) -> None:
        self._drivers: dict[str, StudyDriver] = {}

    def register(self, driver_cls: type[StudyDriver]) -> StudyDriver:
        if not (isinstance(driver_cls, type) and issubclass(driver_cls, StudyDriver)):
            raise DriverError(f"{driver_cls!r} is not a StudyDriver subclass")
        for a in _REQUIRED_ATTRS:
            if not getattr(driver_cls, a, None):
                raise DriverError(f"driver {driver_cls.__name__} is missing class attribute {a!r}")
        if _abi_major(driver_cls.abi) != _abi_major(DRIVER_ABI):
            raise DriverError(
                f"driver {driver_cls.id} targets ABI {driver_cls.abi}; kernel provides {DRIVER_ABI}"
            )
        existing = self._drivers.get(driver_cls.id)
        if existing is not None and type(existing) is not driver_cls:
            raise DriverError(
                f"driver id {driver_cls.id!r} is already registered by "
                f"{type(existing).__module__}.{type(existing).__name__}"
            )
        inst = driver_cls()
        self._drivers[driver_cls.id] = inst
        return inst

    def load(self, path: str) -> StudyDriver:
        module, _, attr = path.partition(":")
        cls = getattr(importlib.import_module(module), attr)
        return self.register(cls)

    def discover(self) -> list[str]:
        """Load drivers advertised by installed packages; returns the ids loaded."""
        loaded: list[str] = []
        for ep in entry_points(group="hos.drivers"):
            try:
                loaded.append(self.register(ep.load()).id)
            except Exception as exc:  # noqa: BLE001 - a broken plug-in must not take the kernel down
                log.error("failed to load driver entry point %s: %s", ep.name, exc)
        return loaded

    def get(self, driver_id: str) -> StudyDriver:
        try:
            return self._drivers[driver_id]
        except KeyError:
            raise NotFound(f"no driver registered with id {driver_id!r}") from None

    def __iter__(self) -> Iterator[StudyDriver]:
        return iter(sorted(self._drivers.values(), key=lambda d: d.id))

    def __contains__(self, driver_id: str) -> bool:
        return driver_id in self._drivers

    def ids(self) -> list[str]:
        return sorted(self._drivers)

    def match(
        self, requirement: StudyRequirement, context: ProgramContext | None = None
    ) -> list[tuple[StudyDriver, Support]]:
        """Every registered driver that supports ``requirement``, with its probe result."""
        out = []
        for d in self:
            s = d.probe(requirement, context)
            if s.supported:
                out.append((d, s))
        return out


_DEFAULT: DriverRegistry | None = None


def default_registry() -> DriverRegistry:
    """The process-wide registry with built-in and installed drivers loaded."""
    global _DEFAULT
    if _DEFAULT is None:
        reg = DriverRegistry()
        for path in BUILTIN_DRIVERS:
            reg.load(path)
        reg.discover()
        _DEFAULT = reg
    return _DEFAULT
