"""SEND export end to end: a GLP repeat-dose study with its TK study -> SENDIG v3.1.1 package."""

import io
import json
import zipfile
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from hos.kernel.errors import EvidenceInadmissible
from hos.send.define import validate_define
from hos.send.service import send_export
from hos.send.spec import SendExportSpec
from hos.send.xport import read_xport
from tests.drivers.test_repeat_dose_tox import PARAMS as RD
from tests.drivers.test_toxicokinetics import PARAMS as TK_PARAMS
from tests.drivers.test_toxicokinetics import _file as tk_file
from tests.kernel.test_glp_flow import _lab_file
from tests.kernel.test_kernel import CTX, k  # noqa: F401 - fixture

FACTS = dict(
    studyid="HOS-RD-001", test_facility_study_id="CRO-1234", study_title="28-day oral toxicity "
    "study in rats", sponsor="Example Bio", test_facility="Example CRO",
    test_facility_location="Cambridge", test_facility_country="GBR",
    study_type="REPEAT DOSE GENERAL TOXICITY", study_category="P", design="PARALLEL",
    report_status="FINAL", glp_type="OECD", species="RAT", strain="SPRAGUE-DAWLEY", age=8,
    age_unit="WEEKS", route="ORAL GAVAGE", dose_form="SUSPENSION", dosing_frequency="QD",
    test_article="paracetamol", vehicle="0.5% methylcellulose", test_article_lot="L-001",
    dosing_start="2026-07-01", dosing_end="2026-07-28", experimental_start="2026-06-24",
    experimental_end="2026-08-12", dosing_duration="P28D", terminal_sacrifice="P29D",
    recovery_sacrifice="P14D",
    values={"TRTCAS": "103-90-2", "SPLRNAM": "Example Breeders"},
    null_values={p: {"flavor": "NI", "reason": "not established for this programme"}
                 for p in ("PCLASS", "PPTCNAM", "PPTEGID", "PPTEGSYM", "PPTMDA", "TRTUNII")})
ENDPOINTS = {"body weight": dict(domain="BW", testcd="BW", test="Body Weight", unit="g"),
             "ALT": dict(domain="LB", testcd="ALT", test="Alanine Aminotransferase", unit="U/L",
                         category="CLINICAL CHEMISTRY", specimen="SERUM"),
             "liver weight": dict(domain="OM", testcd="WEIGHT", test="Weight", unit="g",
                                  specimen="LIVER")}


BASE = "m4/datasets/HOS-RD-001/tabulations/send/"


def _animals(ids, recovery=()):
    """Scheduled sacrifice the day after the last dose, or after 14 days of recovery."""
    return [dict(subject_id=s, first_dose_date="2026-07-01", last_dose_date="2026-07-28",
                 end_date="2026-08-12" if s in recovery else "2026-07-29",
                 disposition="RECOVERY SACRIFICE" if s in recovery else "TERMINAL SACRIFICE",
                 disposition_term="scheduled sacrifice",
                 disposition_date="2026-08-12" if s in recovery else "2026-07-29",
                 disposition_nominal_day=43 if s in recovery else 29, unscheduled=False)
            for s in ids]


def _xpt(k, rec, domain):  # noqa: F811
    z = zipfile.ZipFile(io.BytesIO(k.repo.files.get(rec["package_sha256"])))
    ds = read_xport(z.read(f"{BASE}{domain}.xpt"))
    names = [v.name for v in ds.variables]
    return [dict(zip(names, r, strict=True)) for r in ds.rows]


def _studies(k):  # noqa: F811
    sci, sd = k.get_principal("sci"), k.get_principal("sd")
    prog = k.create_program(sci, name="SEND-1", context=CTX)
    cid = k.register_compound(sci, prog["id"], name="paracetamol", smiles="CC(=O)Nc1ccc(O)cc1")["id"]
    rd = k.create_study(sci, program_id=prog["id"], compound_id=cid,
                        requirement_id="tox.repeat_dose_rodent")["id"]
    k.design_study(sci, rd, RD)
    k.sign_protocol(sd, rd, statement="I approve this protocol as Study Director.")
    k.plan_study(sci, rd)
    k.dispatch_study(sci, rd, {"kind": "external_lab", "laboratory": "Example CRO"})
    k.receive_data(sci, rd, _lab_file(rd))
    k.analyze_study(sci, rd)
    tk = k.create_study(sci, program_id=prog["id"], compound_id=cid,
                        requirement_id="tox.toxicokinetics")["id"]
    k.design_study(sci, tk, TK_PARAMS)
    k.plan_study(sci, tk)
    k.dispatch_study(sci, tk, {"kind": "external_lab", "laboratory": "Example CRO"})
    k.receive_data(sci, tk, tk_file(ref=tk))
    k.analyze_study(sci, tk)
    return sci, rd, tk


def _spec(k, rd, tk):  # noqa: F811
    data = k.study_view(rd)["data"]["records"]
    ids = sorted({r["subject_id"] for r in data})
    rec = sorted({r["subject_id"] for r in data if r["phase"] == "recovery"})
    tk_ids = sorted({r["subject_id"] for r in k.study_view(tk)["data"]["records"]})
    return SendExportSpec.model_validate(dict(
        facts=FACTS, animals=_animals(ids, rec), endpoints=ENDPOINTS,
        timepoints={t: 29 for t in RD["timepoints"]},
        recovery_timepoints={t: 43 for t in RD["timepoints"]},
        pk=dict(tk_study_id=tk, analyte_testcd="PARACET", analyte_test="Paracetamol",
                specimen="PLASMA", concentration_unit="ng/mL", auc_unit="h*ng/mL",
                time_unit="h", animals=_animals(tk_ids))))


def test_full_package_passes_every_check(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    rec = send_export(k, sci, rd, _spec(k, rd, tk))
    assert rec["ok"], rec["errors"]
    assert rec["warnings"] == []
    z = zipfile.ZipFile(io.BytesIO(k.repo.files.get(rec["package_sha256"])))
    base = BASE
    names = set(z.namelist())
    for d in ("ts", "tx", "dm", "ex", "ds", "bw", "lb", "om", "pc", "pp"):
        assert f"{base}{d}.xpt" in names
    assert {f"{base}define.xml", f"{base}define2-1.xsl", "nsdrg_draft.md",
            "send_export_manifest.json"} <= names
    assert validate_define(z.read(f"{base}define.xml").decode()) == []
    ts = _xpt(k, rec, "ts")
    val = {r["TSPARMCD"]: r["TSVAL"] for r in ts}
    assert val["STDIR"] == "Dana Director" and len(val["STSTDTC"]) == 10
    assert val["SNDIGVER"] == "SEND IMPLEMENTATION GUIDE VERSION 3.1.1"
    nf = {r["TSPARMCD"]: r["TSVALNF"] for r in ts}
    assert nf["PCLASS"] == "NI" and val["PCLASS"] == ""
    dm = _xpt(k, rec, "dm")
    assert {r["SETCD"] for r in dm} == {"1", "2", "3", "4", "1R", "4R", "TK1", "TK2", "TK3",
                                        "TK4"}
    assert len({r["USUBJID"] for r in dm}) == len(dm) == 84
    ds = {r["USUBJID"]: r for r in _xpt(k, rec, "ds")}
    assert {r["DSDECOD"] for r in ds.values()} == {"TERMINAL SACRIFICE", "RECOVERY SACRIFICE"}
    manifest = json.loads(z.read("send_export_manifest.json"))
    assert all(c["passed"] for c in manifest["checks"])
    assert manifest["standards"]["SEND CT"] == "2026-09-25"
    assert {c["key"] for c in manifest["citations"]} >= {"cdisc_sendig_3_1_1", "sas_ts140",
                                                         "fda_sdtcg_v6_3"}
    assert any(e["action"] == "study.send_exported" for e in k.history(rd))


def test_lab_values_survive_the_round_trip(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    rec = send_export(k, sci, rd, _spec(k, rd, tk))
    src = {f"HOS-RD-001-{r['subject_id']}": r for r in k.study_view(rd)["data"]["records"]
           if r["endpoint"] == "ALT"}
    lb = _xpt(k, rec, "lb")
    assert len(lb) == len(src)
    for row in lb:
        assert row["LBSTRESN"] == src[row["USUBJID"]]["value"]          # exact, bit for bit
        assert row["LBNOMDY"] == (43 if src[row["USUBJID"]]["phase"] == "recovery" else 29)
    ex = _xpt(k, rec, "ex")
    assert {r["EXDOSE"] for r in ex} == {0.0, 10.0, 30.0, 100.0}
    tx = _xpt(k, rec, "tx")
    assert {r["TXVAL"] for r in tx if r["TXPARMCD"] == "TRTDOS"} == {"0", "10", "30", "100"}
    pc = _xpt(k, rec, "pc")
    assert len(pc) == len(k.study_view(tk)["data"]["records"])
    blq = [r for r in pc if r["PCSTRESC"] == "BLQ"]
    assert blq and all(r["PCSTRESN"] is None for r in blq)   # TCG 4.1.3: BLQ in PCSTRESC
    pp = _xpt(k, rec, "pp")
    table = next(t for t in k.study_view(tk)["results"]["tables"]
                 if t["title"] == "Individual exposure")
    col = table["columns"].index
    want = {(f"HOS-RD-001-{r[col('animal')]}", r[col("day")]): r[col("Cmax")]["value"]
            for r in table["rows"]}
    got = {(r["USUBJID"], r["PPNOMDY"]): r["PPSTRESN"] for r in pp if r["PPTESTCD"] == "CMAX"}
    assert got == want                                  # every animal-day, exact
    nd = [r for r in pp if r["PPSTAT"] == "NOT DONE"]
    assert nd and all("all samples BLQ" in r["PPREASND"] and r["PPSTRESC"] == "" for r in nd)


def test_export_is_refused_without_the_study_director_protocol_signature(k):  # noqa: F811
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="SEND-2", context=CTX)
    cid = k.register_compound(sci, prog["id"], name="p", smiles="CC(=O)Nc1ccc(O)cc1")["id"]
    rd = k.create_study(sci, program_id=prog["id"], compound_id=cid,
                        requirement_id="tox.repeat_dose_rodent")["id"]
    k.design_study(sci, rd, RD)
    k.plan_study(sci, rd)
    k.dispatch_study(sci, rd, {"kind": "external_lab", "laboratory": "CRO"})
    k.receive_data(sci, rd, _lab_file(rd))
    k.analyze_study(sci, rd)
    data = k.study_view(rd)["data"]["records"]
    ids = sorted({r["subject_id"] for r in data})
    rec_ids = sorted({r["subject_id"] for r in data if r["phase"] == "recovery"})
    spec = SendExportSpec.model_validate(dict(facts=FACTS, animals=_animals(ids, rec_ids),
                                              endpoints=ENDPOINTS,
                                              timepoints={t: 29 for t in RD["timepoints"]}))
    rec = send_export(k, sci, rd, spec)
    assert not rec["ok"] and rec["package_sha256"] is None
    assert any("STSTDTC is the date the Study Director signs" in e for e in rec["errors"])
    assert any(e["action"] == "study.send_export_refused" for e in k.history(rd))


def test_simulated_data_never_becomes_send(k):  # noqa: F811
    from tests.drivers.test_repeat_dose_tox import SIM
    sci, sd = k.get_principal("sci"), k.get_principal("sd")
    prog = k.create_program(sci, name="SEND-3", context=CTX)
    cid = k.register_compound(sci, prog["id"], name="p", smiles="CC(=O)Nc1ccc(O)cc1")["id"]
    rd = k.create_study(sci, program_id=prog["id"], compound_id=cid,
                        requirement_id="tox.repeat_dose_rodent")["id"]
    k.design_study(sci, rd, RD)
    k.sign_protocol(sd, rd, statement="approve")
    k.plan_study(sci, rd)
    k.dispatch_study(sci, rd, {"kind": "simulation", "simulation_parameters": SIM, "seed": 1})
    k.receive_data(sci, rd, None)
    k.analyze_study(sci, rd)
    with pytest.raises(EvidenceInadmissible):
        send_export(k, sci, rd, SendExportSpec.model_validate(dict(
            facts=FACTS, animals=_animals(["x"]), endpoints=ENDPOINTS, timepoints={"day 29": 29})))


def test_missing_fda_desired_ts_parameters_are_errors(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    spec = _spec(k, rd, tk)
    spec.facts.null_values.pop("PCLASS")
    rec = send_export(k, sci, rd, spec)
    assert not rec["ok"]
    assert any("PCLASS" in e and "Appendix C" in e for e in rec["errors"])


def test_only_the_study_director_signs_the_protocol(k):  # noqa: F811
    from hos.kernel.errors import PermissionDenied
    sci = k.get_principal("sci")
    prog = k.create_program(sci, name="SEND-4", context=CTX)
    cid = k.register_compound(sci, prog["id"], name="p", smiles="CC(=O)Nc1ccc(O)cc1")["id"]
    rd = k.create_study(sci, program_id=prog["id"], compound_id=cid,
                        requirement_id="tox.repeat_dose_rodent")["id"]
    k.design_study(sci, rd, RD)
    with pytest.raises(PermissionDenied):
        k.sign_protocol(sci, rd, statement="approve")


def test_recovery_records_need_their_own_nominal_days(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    spec = _spec(k, rd, tk)
    spec.recovery_timepoints = {}
    rec = send_export(k, sci, rd, spec)
    assert not rec["ok"]
    assert "recovery-phase timepoint 'day 29' has no nominal study day" in rec["errors"]


def test_terms_outside_codelists(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    spec = _spec(k, rd, tk)
    spec.facts.study_type = "REPEAT DOSE TOXICITY"          # extensible SSTYP: a warning
    rec = send_export(k, sci, rd, spec)
    assert rec["ok"]
    assert any("SSTYP" in w and "nSDRG" in w for w in rec["warnings"])
    bad = _animals(["x"])[0] | {"disposition": "SACRIFICED"}
    with pytest.raises(ValidationError, match="non-extensible"):  # DSDECOD: refused
        SendExportSpec.model_validate(dict(facts=FACTS, endpoints=ENDPOINTS,
                                           timepoints={"day 29": 29}, animals=[bad]))


def test_test_names_follow_their_ct_codes(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    spec = _spec(k, rd, tk)
    spec.endpoints["ALT"] = spec.endpoints["ALT"].model_copy(update={"test": "ALT activity"})
    rec = send_export(k, sci, rd, spec)
    want = ("ALT: LBTEST for LBTESTCD ALT is 'Alanine Aminotransferase' in SEND CT 2026-09-25, "
            "not 'ALT activity'")
    assert want in rec["errors"]


def test_a_unit_term_that_is_not_the_protocol_unit_is_refused(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    spec = _spec(k, rd, tk)
    spec.endpoints["body weight"] = spec.endpoints["body weight"].model_copy(update={"unit": "kg"})
    rec = send_export(k, sci, rd, spec)
    assert not rec["ok"]
    assert any("body weight: unit term 'kg' is not the protocol unit 'g'" in e
               for e in rec["errors"])


def test_package_is_byte_reproducible(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    when = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)
    a = send_export(k, sci, rd, _spec(k, rd, tk), exported_at=when)
    b = send_export(k, sci, rd, _spec(k, rd, tk), exported_at=when)
    assert a["ok"] and a["package_sha256"] == b["package_sha256"]
    assert a["manifest"]["files"] == b["manifest"]["files"]


def test_a_glp_study_needs_its_glp_type(k):  # noqa: F811
    sci, rd, tk = _studies(k)
    spec = _spec(k, rd, tk)
    spec.facts.glp_type = None
    rec = send_export(k, sci, rd, spec)
    assert any("Appendix C" in e and "'GLPTYP'" in e for e in rec["errors"])


def test_the_study_start_date_cannot_be_typed_in():
    """STSTDTC comes only from the Study Director's protocol signature in the record."""
    with pytest.raises(ValidationError, match="come from the study record"):
        SendExportSpec.model_validate(dict(
            facts=FACTS | {"values": {"STSTDTC": "2026-01-01"}}, endpoints=ENDPOINTS,
            timepoints={"day 29": 29}, animals=_animals(["x"])))


def test_every_ts_row_is_derived_or_entered(k):  # noqa: F811
    from hos.send.spec import TS_DERIVED
    sci, rd, tk = _studies(k)
    spec = _spec(k, rd, tk)
    rec = send_export(k, sci, rd, spec)
    codes = {r["TSPARMCD"] for r in _xpt(k, rec, "ts")}
    assert codes <= set(TS_DERIVED) | set(spec.facts.values) | set(spec.facts.null_values)
    assert rec["spec"] == spec.model_dump(mode="json")
    z = zipfile.ZipFile(io.BytesIO(k.repo.files.get(rec["package_sha256"])))
    assert "TS PCLASS not given (TSVALNF NI): not established" in z.read("nsdrg_draft.md").decode()
