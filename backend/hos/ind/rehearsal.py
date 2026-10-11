"""Programme rehearsal (docs/14 P10).

Runs every runnable requirement of a programme's study set through its driver with
SIMULATED data, in memory, and reports what would stand in the way of running the real
programme: requirements without a driver, designs that cannot yet be completed, missing
external analysis inputs, expert determinations with nobody holding the required role, and
the critical path through known durations and cited prerequisites.

Nothing is invented. Design parameters come from the rehearsal plan the user supplies or
from studies already designed in the programme; simulation parameters and seeds must be
supplied; unknown durations are listed, not estimated. Nothing is persisted except a ledger
event recording that the rehearsal ran and the hash of its result.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from hos.core.regulatory import ProgramContext, Timing, derive_study_set
from hos.core.regulatory.engine import RequirementStatus
from hos.drivers.base import CompoundInfo, canonical_hash
from hos.kernel.attestation import Principal, PrincipalKind
from hos.kernel.inputs import input_quantity
from hos.kernel.lifecycle import StudyState

__all__ = ["REHEARSAL_REFERENCE", "rehearse"]

REHEARSAL_REFERENCE = "REHEARSAL"
_DEAD = {StudyState.CANCELLED.value, StudyState.FAILED.value, StudyState.SUPERSEDED.value}


def _existing_parameters(kernel: Any, program_id: str, requirement_id: str) -> dict[str, Any]:
    for s in kernel.repo.studies(program_id):
        if (s.requirement_id == requirement_id and s.origin != "import" and s.state not in _DEAD
                and s.protocol_hash):
            return dict(s.parameters or {})
    return {}


def _role_holders(kernel: Any) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for row in kernel.repo.principals():
        if row.kind != PrincipalKind.HUMAN.value:
            continue
        for role in row.roles:
            out.setdefault(role, []).append(row.name)
    return out


def rehearse(kernel: Any, actor: Principal, program_id: str,
             plan: Mapping[str, Mapping[str, Any]] | None = None,
             milestone: Timing = Timing.BEFORE_FIRST_IN_HUMAN,
             compound_id: str | None = None) -> dict[str, Any]:
    kernel._require_worker(actor)
    plan = dict(plan or {})
    program = kernel.repo.program(program_id)
    ctx = ProgramContext.from_dict(program.context)
    ss = derive_study_set(ctx)
    compounds = kernel.repo.compounds(program_id)
    compound: CompoundInfo | None = None
    if compound_id or compounds:
        compound = kernel.compound_info(compound_id or compounds[0].id)
    holders = _role_holders(kernel)

    items: list[dict[str, Any]] = []
    durations: dict[str, float | None] = {}
    prereqs: dict[str, list[str]] = {}
    for r in ss.requirements:
        if r.timing.order > milestone.order or r.status is RequirementStatus.NOT_REQUIRED:
            continue
        item: dict[str, Any] = {"requirement_id": r.id, "name": r.name, "section": r.section,
                                "status": r.status.value, "timing": r.timing.value}
        items.append(item)
        if r.status is RequirementStatus.CONDITIONAL:
            item["outcome"] = "conditional"
            item["detail"] = f"pending fact: {r.pending_fact}"
            continue
        matches = kernel.registry.match(r, ctx)
        if not matches:
            item["outcome"] = "no_driver"
            item["detail"] = "no installed driver; run outside HOS and import the report"
            durations[r.id] = None
            continue
        entry = plan.get(r.id, {})
        wanted = entry.get("driver_id")
        driver, support = next(((d, s) for d, s in matches if d.id == wanted), matches[0])
        item["driver"] = f"{driver.id}@{driver.version}"
        raw = {**support.prefill, **_existing_parameters(kernel, program_id, r.id),
               **dict(entry.get("parameters", {}))}
        try:
            params = driver.validate_parameters(raw)
        except ValidationError as exc:
            missing = sorted({".".join(str(x) for x in e["loc"]) for e in exc.errors()})
            item["outcome"] = "needs_design_parameters"
            item["detail"] = f"{len(missing)} design parameter(s) missing or invalid"
            item["missing_parameters"] = missing
            durations[r.id] = None
            continue
        prereqs[r.id] = [p.requirement_id for p in driver.prerequisites(params)]
        item["prerequisites"] = [p.to_dict() for p in driver.prerequisites(params)]
        dets = driver.expert_determinations(params)
        item["determinations"] = [
            {"key": d.key, "label": d.label, "role": d.role.value,
             "required_for_approval": d.required_for_approval,
             "assigned_to": holders.get(d.role.value, [])} for d in dets]
        if compound is None:
            item["outcome"] = "needs_compound"
            item["detail"] = "register a compound first"
            durations[r.id] = None
            continue
        protocol = driver.design(compound, params, ctx, entry.get("hypothesis"))
        study_plan = driver.plan(protocol, params)
        durations[r.id] = study_plan.execution_duration_days
        item["duration_days"] = study_plan.execution_duration_days
        item["duration_basis"] = study_plan.duration_basis
        declared_inputs = dict(driver.analysis_inputs(params))
        given_inputs = {**dict(entry.get("inputs", {}))}
        item["missing_inputs"] = sorted(set(declared_inputs) - set(given_inputs))
        sim_params, seed = entry.get("simulation_parameters"), entry.get("seed")
        if driver.simulation_parameters_model() is None:
            item["outcome"] = "no_simulator"
            item["detail"] = f"{driver.id} declares no simulation generator"
            continue
        if sim_params is None or seed is None:
            item["outcome"] = "needs_simulation_parameters"
            item["detail"] = "state the generator's true parameters and a seed to rehearse"
            continue
        try:
            sim = driver.simulate(params, compound, sim_params, seed=int(seed),
                                  study_reference=REHEARSAL_REFERENCE)
            data = driver.ingest(sim.content, params, study_reference=REHEARSAL_REFERENCE)
            post = set(driver.post_data_inputs(params, data)) - set(given_inputs)
            item["missing_inputs"] = sorted({*item["missing_inputs"], *post})
            inputs = {k: input_quantity(k, {**v, "entered_by": v.get("entered_by", actor.name)})
                      for k, v in given_inputs.items()}
            res = driver.analyze(data, params, compound, inputs)
            interp = driver.interpret(res, params, ctx)
        except Exception as exc:  # noqa: BLE001 - the rehearsal reports, it does not raise
            item["outcome"] = "error"
            item["detail"] = f"{type(exc).__name__}: {exc}"
            continue
        unavailable = [{"label": q.label, "reason": q.provenance.reason}
                       for q in res.all_quantities() if not q.is_available]
        item.update({
            "outcome": "rehearsed", "qc": res.qc.status.value,
            "qc_findings": [f.to_dict() for f in res.qc.findings],
            "unavailable_results": unavailable,
            "requires_expert_judgement": list(interp.requires_expert_judgement),
            "simulated": True,
        })

    # critical path over cited prerequisites and known durations
    finish: dict[str, tuple[float, list[str], list[str]]] = {}

    def walk(rid: str, seen: frozenset[str]) -> tuple[float, list[str], list[str]]:
        if rid in finish:
            return finish[rid]
        best: tuple[float, list[str], list[str]] = (0.0, [], [])
        for pre in prereqs.get(rid, []):
            if pre in seen or pre not in durations:
                continue
            cand = walk(pre, seen | {rid})
            if cand[0] > best[0] or (cand[0] == best[0] and len(cand[1]) > len(best[1])):
                best = cand
        dur = durations.get(rid)
        unknown = [*best[2], rid] if dur is None else list(best[2])
        result = (best[0] + (dur or 0.0), [*best[1], rid], unknown)
        finish[rid] = result
        return result

    paths = [walk(rid, frozenset()) for rid in durations]
    # a path is only meaningful if at least one of its studies has a known duration
    known = [p for p in paths if any(durations.get(r) is not None for r in p[1])]
    crit = max(known, key=lambda p: (p[0], len(p[1])), default=(0.0, [], []))
    unknown_all = sorted(rid for rid, d in durations.items() if d is None)
    summary = {
        "requirements": len(items),
        "by_outcome": {o: sum(i.get("outcome") == o for i in items)
                       for o in sorted({str(i.get("outcome")) for i in items})},
        "missing_drivers": [i["requirement_id"] for i in items if i.get("outcome") == "no_driver"],
        "needs_design_parameters": [i["requirement_id"] for i in items
                                    if i.get("outcome") == "needs_design_parameters"],
        "needs_simulation_parameters": [i["requirement_id"] for i in items
                                        if i.get("outcome") == "needs_simulation_parameters"],
        "missing_inputs": {i["requirement_id"]: i["missing_inputs"] for i in items
                           if i.get("missing_inputs")},
        "unassigned_determinations": [
            {"requirement_id": i["requirement_id"], "determination": d["label"], "role": d["role"]}
            for i in items for d in i.get("determinations", []) if not d["assigned_to"]],
        "critical_path": {
            "requirements": crit[1], "known_duration_days": crit[0],
            "unknown_durations_on_path": crit[2],
            "determined": bool(crit[1]),
            "note": ("durations are the drivers' own protocol durations; studies whose duration "
                     "is set by the laboratory are listed as unknown, not estimated"
                     if crit[1] else "cannot be determined: no runnable study has a known "
                     "duration yet")},
        "unknown_durations": unknown_all,
    }
    result = {"program_id": program_id, "milestone": milestone.value, "simulated": True,
              "items": items, "summary": summary}
    kernel.record_event(actor, "program.rehearsed", "program", program_id,
                        {"milestone": milestone.value, "result_hash": canonical_hash(result),
                         "by_outcome": summary["by_outcome"]})
    return result
