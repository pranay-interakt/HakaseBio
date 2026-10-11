"""Build SENDIG v3.1.1 domains from a HOS repeat-dose toxicity study (and, optionally, its
toxicokinetic study) plus the exporter's :class:`~hos.send.spec.SendExportSpec`.

Domains: TS, TX, DM, EX, DS (trial design, subjects, exposure, disposition); BW, FW, LB, OM
(the repeat-dose endpoints, each mapped to its SEND test code); PC, PP (toxicokinetics).
Variables follow SENDIG v3.1.1 order. Required and Expected variables are always present
(Expected ones may be null); Permissible ones only when populated (TCG v6.3 4.1.3: "all
CDISC required, expected, and permissible variables that were collected ... should be
submitted"). Recovery and toxicokinetic animals are separate trial sets (TCG 4.1.3).

Results are submitted as collected: --STRES* equal --ORRES* in the endpoint's protocol unit,
which the exporter maps to a SEND unit term; the equivalence is checked numerically where the
term is a parseable unit, and a mismatch is an error.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from hos.core import units as U
from hos.send.reference import CT_VERSION, Variable, ct, dataset, term_check
from hos.send.spec import TS_CODELISTS, TS_FDA_DESIRED, AnimalRecord, SendExportSpec

__all__ = ["TEST_CODELISTS", "Domain", "SendBuild", "build_domains"]


@dataclass
class Domain:
    name: str
    label: str
    klass: str
    structure: str
    variables: list[Variable]
    rows: list[dict[str, Any]]


@dataclass
class SendBuild:
    domains: dict[str, Domain] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    origins: dict[str, str] = field(default_factory=dict)  # "DOMAIN.VAR" -> origin type


def _num(v: float) -> str:
    return repr(float(v)) if float(v) != int(v) else str(int(v))


#: --TESTCD / --TEST codelist pairs per findings domain (SEND CT).
TEST_CODELISTS = {
    "BW": ("C89962", "C89961"),
    "FW": ("C89970", "C89969"),
    "LB": ("C65047", "C67154"),
    "OM": ("C89977", "C89976"),
}


def _paired_name(code_list: str, name_list: str, term: str) -> str | None:
    cl = ct()["codelists"]
    concept = cl[code_list]["terms"].get(term)
    if concept is None:
        return None
    return next((n for n, c in cl[name_list]["terms"].items() if c == concept), None)


def _unit_factor(hos_unit: str, send_term: str) -> float | None:
    """Conversion factor from the HOS unit to the SEND unit term, or None if the term is not a
    parseable unit."""
    try:
        return U.convert(1.0, hos_unit, send_term)
    except Exception:  # noqa: BLE001 - CT unit terms are not all parseable
        return None


def _shape(domain: str, rows: list[dict[str, Any]]) -> Domain:
    label, klass, structure, variables = dataset(domain)
    used = {k for r in rows for k, v in r.items() if v is not None}
    keep = [v for v in variables if v.core in ("Req", "Exp") or v.name in used]
    unknown = sorted({k for r in rows for k in r} - {v.name for v in variables})
    if unknown:
        raise ValueError(f"{domain}: variables not in SENDIG v3.1.1: {unknown}")
    return Domain(
        domain, label, klass, structure, keep, [{v.name: r.get(v.name) for v in keep} for r in rows]
    )


def build_domains(
    *,
    spec: SendExportSpec,
    tox_params: Any,
    tox_records: Sequence[Mapping[str, Any]],
    glp: bool,
    study_start: str | None,
    study_director: str | None,
    tk_params: Any | None = None,
    tk_records: Sequence[Mapping[str, Any]] = (),
    tk_individual: Mapping[str, Any] | None = None,
) -> SendBuild:
    """Assemble every domain. ``tk_individual`` is the toxicokinetic study's stored
    "Individual exposure" table (``columns`` and ``rows``; result cells are quantity dicts),
    read by column name."""
    b = SendBuild()
    f = spec.facts
    sid = f.studyid

    def usubjid(s: str) -> str:
        return f"{sid}-{s}"

    tk_dose_unit = str(tk_params.dose_unit) if tk_params is not None else ""

    # ---- trial sets ---------------------------------------------------------------------
    groups = [0.0] + list(tox_params.dose_levels_mg_per_kg_day)
    rec_doses = [0.0, groups[-1]] if tox_params.recovery else []
    sets: list[dict[str, Any]] = []
    for gi, d in enumerate(groups):
        lab = "Control" if d == 0 else f"{d:g} mg/kg/day"
        sets.append(
            {
                "setcd": f"{gi + 1}",
                "set": lab,
                "dose": d,
                "phase": "main",
                "n": tox_params.animals_per_sex_per_group,
                "tk": False,
                "group": gi + 1,
            }
        )
        if any(abs(d - r) < 1e-9 for r in rec_doses):
            sets.append(
                {
                    "setcd": f"{gi + 1}R",
                    "set": f"{lab} recovery",
                    "dose": d,
                    "phase": "recovery",
                    "n": tox_params.recovery_animals_per_sex,
                    "tk": False,
                    "group": gi + 1,
                }
            )
    if tk_params is not None:
        tk_groups = ([0.0] if tk_params.control_group_assayed else []) + list(tk_params.dose_levels)
        for gi, d in enumerate(tk_groups):
            lab = "TK control" if d == 0 else f"TK {d:g} {tk_params.dose_unit}"
            sets.append(
                {
                    "setcd": f"TK{gi + 1}",
                    "set": lab,
                    "dose": d,
                    "phase": "tk",
                    "n": tk_params.animals_per_sex_per_group,
                    "tk": True,
                    "group": f"TK{gi + 1}",
                    "sexes": tk_params.sexes,
                }
            )
    tx_rows: list[dict[str, Any]] = []
    for s in sets:
        sexes = s.get("sexes", ["M", "F"])
        params: list[tuple[str, str]] = [
            ("SPGRPCD", str(s["group"])),
            ("GRPLBL", s["set"]),
            ("PLANMSUB", str(s["n"] if "M" in sexes else 0)),
            ("PLANFSUB", str(s["n"] if "F" in sexes else 0)),
            ("TRTDOS", _num(s["dose"])),
            ("TRTDOSU", "mg/kg/day" if not s["tk"] else tk_dose_unit),
            ("TKDESC", "TK ONLY" if s["tk"] else "NON-TK"),
        ]
        for n_seq, (code, txval) in enumerate(params, start=1):
            tx_rows.append(
                {
                    "STUDYID": sid,
                    "DOMAIN": "TX",
                    "SETCD": s["setcd"],
                    "SET": s["set"],
                    "TXSEQ": n_seq,
                    "TXPARMCD": code,
                    "TXPARM": _paired_name("C90009", "C90007", code),
                    "TXVAL": txval,
                }
            )
    b.domains["TX"] = _shape("TX", tx_rows)

    # ---- subjects ------------------------------------------------------------------------
    animals = {a.subject_id: a for a in spec.animals}
    subj: dict[str, tuple[str, float, str]] = {}
    for r in tox_records:
        subj.setdefault(str(r["subject_id"]), (str(r["sex"]), float(r["dose"]), str(r["phase"])))
    tk_animals = {a.subject_id: a for a in (spec.pk.animals if spec.pk else [])}
    tk_subj: dict[str, tuple[str, float]] = {}
    for r in tk_records:
        tk_subj.setdefault(str(r["subject_id"]), (str(r["sex"]), float(r["dose"])))
    clash = set(subj) & set(tk_subj)
    if clash:
        b.errors.append(f"subjects in both the toxicity and the TK study: {sorted(clash)}")
    missing = sorted(set(subj) - set(animals)) + sorted(set(tk_subj) - set(tk_animals))
    if missing:
        b.errors.append(f"no subject dates or disposition for {missing}")

    def set_of(sx: str, dose: float, phase: str) -> dict[str, Any] | None:
        return next((s for s in sets if s["phase"] == phase and abs(s["dose"] - dose) < 1e-9), None)

    dm_rows, ex_rows, ds_rows = [], [], []
    everyone: list[tuple[str, str, float, str, AnimalRecord]] = []
    for s_id, (sex, dose, phase) in sorted(subj.items()):
        if s_id in animals:
            everyone.append((s_id, sex, dose, phase, animals[s_id]))
    for s_id, (sex, dose) in sorted(tk_subj.items()):
        if s_id in tk_animals:
            everyone.append((s_id, sex, dose, "tk", tk_animals[s_id]))
    ex_unit = "mg/kg/day"
    for s_id, sex, dose, phase, a in everyone:
        st = set_of(sex, dose, phase)
        if st is None:
            b.errors.append(f"{s_id}: no trial set for dose {dose:g} ({phase})")
            continue
        u = usubjid(s_id)
        dm_rows.append(
            {
                "STUDYID": sid,
                "DOMAIN": "DM",
                "USUBJID": u,
                "SUBJID": s_id,
                "RFSTDTC": a.first_dose_date,
                "RFENDTC": a.end_date,
                "AGEU": None,
                "SEX": sex,
                "ARMCD": str(st["group"]),
                "SETCD": st["setcd"],
            }
        )
        ex_rows.append(
            {
                "STUDYID": sid,
                "DOMAIN": "EX",
                "USUBJID": u,
                "EXSEQ": 1,
                "EXTRT": f.test_article,
                "EXDOSE": dose,
                "EXDOSU": ex_unit if phase != "tk" else tk_dose_unit,
                "EXDOSFRM": f.dose_form,
                "EXDOSFRQ": f.dosing_frequency,
                "EXROUTE": f.route,
                "EXLOT": f.test_article_lot,
                "EXTRTV": f.vehicle,
                "EXSTDTC": a.first_dose_date,
                "EXENDTC": a.last_dose_date,
            }
        )
        ds_rows.append(
            {
                "STUDYID": sid,
                "DOMAIN": "DS",
                "USUBJID": u,
                "DSSEQ": 1,
                "DSTERM": a.disposition_term,
                "DSDECOD": a.disposition,
                "DSUSCHFL": "Y" if a.unscheduled else "N",
                "DSSTDTC": a.disposition_date,
                "DSNOMDY": a.disposition_nominal_day,
            }
        )
    if ex_msg := term_check("C71620", ex_unit):
        b.warnings.append(f"EXDOSU: {ex_msg}")
    b.domains["DM"] = _shape("DM", dm_rows)
    b.domains["EX"] = _shape("EX", ex_rows)
    b.domains["DS"] = _shape("DS", ds_rows)

    # ---- findings from the repeat-dose endpoints -----------------------------------------
    spec_units = {e.name: e.unit for e in tox_params.endpoints}
    found: dict[str, list[dict[str, Any]]] = defaultdict(list)
    fseq: dict[tuple[str, str], int] = defaultdict(int)
    for name, emap in spec.endpoints.items():
        if name not in spec_units:
            b.errors.append(f"endpoint {name!r} is not in the study")
            continue
        checks: list[tuple[str, str, str]] = [("C71620", emap.unit, "unit")]
        if emap.specimen:
            checks.append(("C77529", emap.specimen, "specimen"))
        if emap.category:
            checks.append(("C225371", emap.category, "LB category"))
        for code, term, what in checks:
            if msg := term_check(code, term):
                b.warnings.append(f"{name} {what}: {msg}")
        codes, names = TEST_CODELISTS[emap.domain]
        if msg := term_check(codes, emap.testcd):
            b.warnings.append(f"{name} {emap.domain}TESTCD: {msg}")
        elif (paired := _paired_name(codes, names, emap.testcd)) and paired != emap.test:
            b.errors.append(
                f"{name}: {emap.domain}TEST for {emap.domain}TESTCD "
                f"{emap.testcd} is {paired!r} in SEND CT {CT_VERSION}, not "
                f"{emap.test!r}"
            )
        factor = _unit_factor(spec_units[name], emap.unit)
        if factor is None:
            b.warnings.append(
                f"{name}: unit term {emap.unit!r} is not machine-checkable "
                f"against the protocol unit {spec_units[name]!r}; state its "
                "equivalence in the nSDRG"
            )
        elif abs(factor - 1) > 1e-12:
            b.errors.append(
                f"{name}: unit term {emap.unit!r} is not the protocol unit "
                f"{spec_units[name]!r} (factor {factor:g})"
            )
    unmapped = sorted({str(r["endpoint"]) for r in tox_records} - set(spec.endpoints))
    if unmapped:
        b.errors.append(f"endpoints without a SEND mapping: {unmapped}")
    for r in tox_records:
        m = spec.endpoints.get(str(r["endpoint"]))
        if m is None or str(r["subject_id"]) not in animals:
            continue
        tp = str(r["timepoint"])
        days = spec.recovery_timepoints if r["phase"] == "recovery" else spec.timepoints
        if tp not in days:
            b.errors.append(f"{r['phase']}-phase timepoint {tp!r} has no nominal study day")
            continue
        if str(r["unit"]) != spec_units[str(r["endpoint"])]:
            try:
                v = U.convert(float(r["value"]), str(r["unit"]), spec_units[str(r["endpoint"])])
            except Exception:  # noqa: BLE001
                b.errors.append(f"{r['endpoint']}: unit {r['unit']!r} not convertible")
                continue
        else:
            v = float(r["value"])
        p, u = m.domain, usubjid(str(r["subject_id"]))
        fseq[(p, u)] += 1
        res = _num(v)
        row: dict[str, Any] = {
            "STUDYID": sid,
            "DOMAIN": p,
            "USUBJID": u,
            f"{p}SEQ": fseq[(p, u)],
            f"{p}TESTCD": m.testcd,
            f"{p}TEST": m.test,
            f"{p}ORRES": res,
            f"{p}ORRESU": m.unit,
            f"{p}STRESC": res,
            f"{p}STRESN": v,
            f"{p}STRESU": m.unit,
        }
        if p in ("BW", "LB"):
            row[f"{p}BLFL"] = "Y" if spec.baseline_timepoint == tp else None
        if p == "LB":
            row.update(LBCAT=m.category, LBSPEC=m.specimen)
        if p == "OM":
            row["OMSPEC"] = m.specimen
        if p != "FW":
            row[f"{p}NOMDY"] = days[tp]
        found[p].append(row)
    for p in ("BW", "FW", "LB", "OM"):
        if found.get(p):
            b.domains[p] = _shape(p, found[p])

    # ---- toxicokinetics ------------------------------------------------------------------
    if spec.pk is not None and tk_params is not None:
        pk = spec.pk
        for code, val, what in (
            ("C77529", pk.specimen, "specimen"),
            ("C85494", pk.concentration_unit, "concentration unit"),
            ("C85494", pk.auc_unit, "AUC unit"),
            ("C85494", pk.time_unit, "time unit"),
        ):
            if msg := term_check(code, val):
                b.warnings.append(f"PK {what}: {msg}")
        cu = tk_params.concentration_unit
        for hos_u, term in (
            (cu, pk.concentration_unit),
            (f"{cu}*h", pk.auc_unit),
            ("h", pk.time_unit),
        ):
            fac = _unit_factor(hos_u, term)
            if fac is not None and abs(fac - 1) > 1e-12:
                b.errors.append(f"PK unit term {term!r} is not {hos_u!r} (factor {fac:g})")
        pc_rows: list[dict[str, Any]] = []
        pseq: dict[str, int] = defaultdict(int)
        for r in sorted(
            tk_records,
            key=lambda r: (str(r["subject_id"]), int(r["day"]), float(r["nominal_time"])),
        ):
            u = usubjid(str(r["subject_id"]))
            pseq[u] += 1
            blq = r["blq"] == "yes"
            conc: float | None = None if blq else float(r["concentration"])
            pc_rows.append(
                {
                    "STUDYID": sid,
                    "DOMAIN": "PC",
                    "USUBJID": u,
                    "PCSEQ": pseq[u],
                    "PCTESTCD": pk.analyte_testcd,
                    "PCTEST": pk.analyte_test,
                    "PCORRES": "BLQ" if blq else _num(conc or 0),
                    "PCORRESU": None if blq else pk.concentration_unit,
                    "PCSTRESC": "BLQ" if blq else _num(conc or 0),
                    "PCSTRESN": conc,
                    "PCSTRESU": None if blq else pk.concentration_unit,
                    "PCSPEC": pk.specimen,
                    "PCLLOQ": float(tk_params.lloq),
                    "PCNOMDY": int(r["day"]),
                    "PCELTM": f"PT{float(r['nominal_time']):g}H",
                    "PCTPTREF": f"Day {int(r['day'])} dose",
                    "PCRFTDTC": None,
                }
            )
        b.domains["PC"] = _shape("PC", pc_rows)
        pp_rows: list[dict[str, Any]] = []
        ppseq: dict[str, int] = defaultdict(int)
        header = list((tk_individual or {}).get("columns", []))
        wanted = (
            ("CMAX", "Cmax", pk.concentration_unit),
            ("TMAX", "Tmax", pk.time_unit),
            ("TLST", "Tlast", pk.time_unit),
            ("AUCLST", "AUC(0-t)", pk.auc_unit),
            ("AUCTAU", "AUC(0-tau)", pk.auc_unit),
        )
        absent = [c for c in ("animal", "day", *(w[1] for w in wanted)) if c not in header]
        if absent:
            b.errors.append(f"toxicokinetic individual exposure table lacks columns {absent}")
        cols = [] if absent else [(code, header.index(name), unit) for code, name, unit in wanted]
        for irow in (tk_individual or {}).get("rows", []) if not absent else []:
            animal, day = str(irow[header.index("animal")]), int(irow[header.index("day")])
            if animal not in tk_animals:
                continue
            u = usubjid(animal)
            for code, idx, unit in cols:
                q = irow[idx]
                if not isinstance(q, Mapping):
                    b.errors.append(f"PP {code} {animal} day {day}: not a stored result")
                    continue
                common = {
                    "STUDYID": sid,
                    "DOMAIN": "PP",
                    "USUBJID": u,
                    "PPTESTCD": code,
                    "PPTEST": _paired_name("C85839", "C85493", code),
                    "PPCAT": pk.analyte_test,
                    "PPSPEC": pk.specimen,
                    "PPNOMDY": day,
                    "PPTPTREF": f"Day {day} dose",
                    "PPRFTDTC": None,
                }
                b.origins[f"PP.{code}"] = "Derived"
                if not q.get("available"):
                    # SENDIG v3.1.1 PP: --STAT "NOT DONE" (C66789) with --REASND; the reason
                    # is the one the NCA recorded.
                    why = str((q.get("provenance") or {}).get("reason") or "")
                    if not why or len(why) > 200:
                        b.errors.append(
                            f"PP {code} {animal} day {day}: not estimable, and the "
                            "reason is missing or longer than 200 characters"
                        )
                        continue
                    ppseq[u] += 1
                    pp_rows.append(
                        {
                            **common,
                            "PPSEQ": ppseq[u],
                            "PPORRES": None,
                            "PPORRESU": None,
                            "PPSTRESC": None,
                            "PPSTRESN": None,
                            "PPSTRESU": None,
                            "PPSTAT": "NOT DONE",
                            "PPREASND": why,
                        }
                    )
                    continue
                fac = _unit_factor(str(q.get("unit")), unit)
                if fac is not None and abs(fac - 1) > 1e-12:
                    b.errors.append(
                        f"PP {code} {animal} day {day}: result unit "
                        f"{q.get('unit')!r} is not {unit!r} (factor {fac:g})"
                    )
                    continue
                ppseq[u] += 1
                ppval = float(q["value"])
                pp_rows.append(
                    {
                        **common,
                        "PPSEQ": ppseq[u],
                        "PPORRES": _num(ppval),
                        "PPORRESU": unit,
                        "PPSTRESC": _num(ppval),
                        "PPSTRESN": ppval,
                        "PPSTRESU": unit,
                    }
                )
        b.domains["PP"] = _shape("PP", pp_rows)

    # ---- trial summary (parameters named in TS_DERIVED come from the record and facts) ---
    sexes = sorted({s for s, *_ in subj.values()} | {s for s, _ in tk_subj.values()})
    sexpop = "BOTH" if len(sexes) == 2 else sexes[0] if sexes else None
    planned = sum(s["n"] * (len(s.get("sexes", ["M", "F"]))) for s in sets)
    ts: dict[str, str | None] = {
        "SSPONSOR": f.sponsor,
        "STITLE": f.study_title,
        "SPREFID": f.test_facility_study_id,
        "TSTFNAM": f.test_facility,
        "TSTFLOC": f.test_facility_location,
        "TFCNTRY": f.test_facility_country,
        "SSTYP": f.study_type,
        "STCAT": f.study_category,
        "SDESIGN": f.design,
        "STRPSTAT": f.report_status,
        "GLPFL": "Y" if glp else "N",
        "SPECIES": f.species,
        "STRAIN": f.strain,
        "AGEU": f.age_unit,
        "ROUTE": f.route,
        "TRT": f.test_article,
        "TRTV": f.vehicle,
        "SEXPOP": sexpop,
        "SPLANSUB": str(planned),
        "DOSSTDTC": f.dosing_start,
        "DOSENDTC": f.dosing_end,
        "EXPSTDTC": f.experimental_start,
        "EXPENDTC": f.experimental_end,
        "DOSDUR": f.dosing_duration,
        "TRMSAC": f.terminal_sacrifice,
        "STSTDTC": study_start,
        "STDIR": study_director,
        "SNDIGVER": "SEND IMPLEMENTATION GUIDE VERSION 3.1.1",
        "SNDCTVER": f"SEND Terminology {CT_VERSION}",
        "PDOSFRQ": f.dosing_frequency,
    }
    if glp:
        ts["GLPTYP"] = f.glp_type
    if f.age is not None:
        ts["AGE"] = _num(f.age)
    if f.age_text is not None:
        ts["AGETXT"] = f.age_text
    if f.recovery_sacrifice:
        ts["RECSAC"] = f.recovery_sacrifice
    fixed = sorted(set(f.values) & set(ts))
    if fixed:
        b.errors.append(
            f"TS parameters {fixed} come from the study record and the export "
            "facts; they cannot be entered as free values"
        )
    valued = sorted(c for c in f.null_values if ts.get(c) is not None)
    if valued:
        b.errors.append(
            f"TS parameters {valued} have a value; a null flavor is for a value "
            "that cannot be given"
        )
    ts.update({c: v for c, v in f.values.items() if c not in ts})
    if study_start is None:
        b.errors.append(
            "no Study Director protocol signature: STSTDTC is the date the Study "
            "Director signs the protocol (TCG v6.3 4.1.3)"
        )
    ts_rows = []
    for code in sorted(set(ts) | set(f.null_values)):
        if term_check("C90009", code):
            b.warnings.append(f"TS parameter {code}: not a SEND CT TSPARMCD term")
        tsval = ts.get(code)
        nf = f.null_values.get(code)
        if tsval is None and nf is None:
            continue
        if (
            tsval is not None
            and code in TS_CODELISTS
            and (msg := term_check(TS_CODELISTS[code], tsval))
        ):
            (b.errors if "non-extensible" in msg else b.warnings).append(f"TS {code}: {msg}")
        ts_rows.append(
            {
                "STUDYID": sid,
                "DOMAIN": "TS",
                "TSSEQ": 1,
                "TSGRPID": None,
                "TSPARMCD": code,
                "TSPARM": _paired_name("C90009", "C90007", code) or code,
                "TSVAL": tsval,
                "TSVALNF": nf.flavor if nf and tsval is None else None,
            }
        )
    absent = [c for c in TS_FDA_DESIRED if ts.get(c) is None and c not in f.null_values]
    if absent:
        b.errors.append(
            "FDA-desired TS parameters with neither a value nor a null flavor "
            f"(TCG v6.3 Appendix C): {absent}"
        )
    b.domains = {"TS": _shape("TS", ts_rows), **b.domains}
    return b
