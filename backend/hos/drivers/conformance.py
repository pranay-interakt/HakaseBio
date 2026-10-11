"""Driver conformance kit.

Every driver - built-in or third-party - must pass this battery before it is trusted
with a study. It checks the contract the kernel relies on, independently of the
driver's science: deterministic protocols, no cost estimates, strict ingest that
rejects malformed files, deterministic dispatch bundles, seeded reproducible
simulation, simulated data that can never become evidence, and cited interpretation.

Usage (in a driver's test suite)::

    report = check_driver(MyDriver(), compound=..., parameters=..., simulation_parameters=...)
    assert report.passed, report.summary()
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from hos.core.quantity import SIMULATION_TAINT, Quantity
from hos.drivers.base import (
    DRIVER_ABI,
    SIMULATION_DISCLAIMER,
    CompoundInfo,
    DataOrigin,
    IngestError,
    StudyDriver,
    SummaryFacts,
    SummaryTable,
)

__all__ = ["ConformanceCheck", "ConformanceReport", "check_driver"]


@dataclass(frozen=True, slots=True)
class ConformanceCheck:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class ConformanceReport:
    driver_id: str
    checks: list[ConformanceCheck] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks)

    def summary(self) -> str:
        return "\n".join(
            f"[{'PASS' if c.passed else 'FAIL'}] {c.name}: {c.detail}" for c in self.checks
        )


def check_driver(
    driver: StudyDriver,
    *,
    compound: CompoundInfo,
    parameters: Mapping[str, Any],
    simulation_parameters: Mapping[str, Any] | None = None,
    measured_example: bytes | None = None,
    analysis_inputs: Mapping[str, Quantity] | None = None,
    study_reference: str = "HOS-CONFORMANCE-1",
) -> ConformanceReport:
    rep = ConformanceReport(driver_id=getattr(driver, "id", "?"))

    def check(name: str, fn: Callable[[], Any]) -> Any:
        try:
            out = fn()
        except AssertionError as exc:
            rep.checks.append(ConformanceCheck(name, False, str(exc) or "assertion failed"))
            return None
        except Exception as exc:  # noqa: BLE001 - every failure is reported, not raised
            rep.checks.append(ConformanceCheck(name, False, f"{type(exc).__name__}: {exc}"))
            return None
        rep.checks.append(ConformanceCheck(name, True, out if isinstance(out, str) else ""))
        return out if out is not None else True

    def identity() -> str:
        assert driver.abi.split(".")[0] == DRIVER_ABI.split(".")[0], "ABI mismatch"
        json.dumps(driver.describe())
        assert driver.requirement_ids and driver.modalities and driver.ctd_section
        return f"{driver.id} v{driver.version}"

    check("identity and describe()", identity)

    params = check("parameters validate", lambda: driver.validate_parameters(parameters))
    if params is None:
        return rep

    def design() -> Any:
        p1 = driver.design(compound, params, hypothesis="conformance")
        p2 = driver.design(compound, params, hypothesis="conformance")
        assert p1.content_hash == p2.content_hash, "design() is not deterministic"
        assert p1.references, "protocol cites nothing"
        assert p1.driver_id == driver.id
        p1.to_markdown()
        return p1

    protocol = check("design() deterministic and cited", design)
    if protocol is None:
        return rep

    def plan() -> str:
        d = driver.plan(protocol, params).to_dict()
        assert d["cost"] is None, "plan must not estimate cost"
        assert d["duration_basis"], "plan duration must state its basis"
        return f"{d['execution_duration_days']} days; {d['sample_count']} samples"

    check("plan() has no cost and states its basis", plan)

    template = driver.data_template(params)

    def bundle() -> str:
        pkg = driver.instruction_package(study_reference, protocol, params, compound)
        b1, b2 = pkg.to_bundle(), pkg.to_bundle()
        assert b1 == b2, "dispatch bundle is not byte-deterministic"
        with zipfile.ZipFile(io.BytesIO(b1)) as z:
            manifest = json.loads(z.read("MANIFEST.json"))
            for name, sha in manifest["files"].items():
                assert hashlib.sha256(z.read(name)).hexdigest() == sha, f"{name} hash mismatch"
        return f"{len(manifest['files'])} files"

    check("instruction bundle deterministic with valid manifest", bundle)

    def rejects(content: bytes, label: str) -> None:
        try:
            driver.ingest(content, params)
        except IngestError:
            return
        raise AssertionError(f"ingest accepted {label}")

    check("ingest rejects empty file", lambda: rejects(b"", "an empty file"))
    check(
        "ingest rejects header-only template",
        lambda: rejects(template.blank_csv(study_reference).encode(), "a file with no data"),
    )
    check("ingest rejects non-UTF-8", lambda: rejects(b"\xff\xfe\x00bad", "non-UTF-8 bytes"))

    if simulation_parameters is not None:

        def simulate() -> Any:
            a = driver.simulate(
                params, compound, simulation_parameters, seed=7, study_reference=study_reference
            )
            b = driver.simulate(
                params, compound, simulation_parameters, seed=7, study_reference=study_reference
            )
            c = driver.simulate(
                params, compound, simulation_parameters, seed=8, study_reference=study_reference
            )
            assert a.content == b.content, "same seed gave different data"
            assert a.content != c.content, "different seed gave identical data"
            return a

        sim = check("simulate() seeded and reproducible", simulate)
        if sim is not None:

            def sim_cannot_launder() -> Any:
                data = driver.ingest(sim.content, params, claimed_origin=DataOrigin.MEASURED)
                assert data.origin is DataOrigin.SIMULATED, "simulated file ingested as measured"
                return data

            data = check("simulated data cannot be claimed as measured", sim_cannot_launder)

            def malformed_number() -> None:
                text = sim.content.decode()
                lines = text.splitlines()
                hdr = next(i for i, ln in enumerate(lines) if not ln.startswith("#"))
                num_cols = [i for i, c in enumerate(template.columns) if c.kind == "number"]
                assert num_cols, "template has no numeric column"
                cells = lines[hdr + 1].split(",")
                cells[num_cols[0]] = "not-a-number"
                lines[hdr + 1] = ",".join(cells)
                rejects("\n".join(lines).encode(), "a non-numeric value in a numeric column")

            check("ingest rejects non-numeric value", malformed_number)

            if data is not None:

                def sim_analysis() -> Any:
                    res = driver.analyze(data, params, compound, analysis_inputs)
                    assert not res.evidence_admissible, "simulated analysis marked admissible"
                    for q in res.all_quantities():
                        assert SIMULATION_TAINT in q.qc_flags, f"untainted value {q.label}"
                    return res

                res = check("analysis of simulated data is tainted and inadmissible", sim_analysis)
                if res is not None:

                    def summaries() -> str:
                        facts = driver.summary_facts(params)
                        assert facts is None or isinstance(facts, SummaryFacts)
                        stored = json.loads(json.dumps(res.to_dict()))
                        tables = driver.summary_tables(params, stored)
                        keys = set(stored["quantities"])
                        for t in tables:
                            assert isinstance(t, SummaryTable)
                            missing = [k for k in t.refs() if k not in keys]
                            assert not missing, f"{t.title}: no stored quantity {missing[:3]}"
                        return f"{len(tables)} table(s), {sum(len(t.rows) for t in tables)} rows"

                    check("Module 2.6 summaries reference only stored results (ABI 1.2)", summaries)
                    interp = check(
                        "interpret() statements are all cited",
                        lambda: driver.interpret(res, params),
                    )
                    if interp is not None:

                        def sim_report() -> str:
                            r = driver.report(protocol, data, res, interp)
                            assert r.disclaimer == SIMULATION_DISCLAIMER
                            assert not r.evidence_admissible
                            md = r.to_markdown()
                            assert "SIMULATED" in md
                            summary = r.sections[0].body.lower()
                            assert " measured" not in summary.replace("(not measured)", ""), (
                                "simulated report summary describes the data as measured"
                            )
                            json.dumps(r.to_dict())
                            return f"{len(r.sections)} sections"

                        check("report of simulated data carries the disclaimer", sim_report)

    if measured_example is not None:

        def measured() -> str:
            data = driver.ingest(measured_example, params)
            assert data.origin is DataOrigin.MEASURED
            res = driver.analyze(data, params, compound, analysis_inputs)
            assert res.evidence_admissible
            interp = driver.interpret(res, params)
            r = driver.report(protocol, data, res, interp)
            assert r.disclaimer is None and r.evidence_admissible
            return f"{len(data.records)} records"

        check("measured data flows through analysis and report", measured)
    return rep
