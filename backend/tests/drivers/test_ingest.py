"""Strict return-file parsing: every malformed input is rejected with line-numbered errors."""

import hashlib

import pytest

from hos.drivers.base import (
    DataColumn, DataOrigin, DataTemplate, IngestError, Table, parse_return_file,
)
from hos.kernel.errors import DriverError

T = DataTemplate(
    template_id="test/1.0",
    description="test",
    columns=(
        DataColumn("sample_id", "sample", kind="text"),
        DataColumn("time", "time", unit="min", minimum=0),
        DataColumn("conc", "concentration", unit="uM", minimum=0),
        DataColumn("matrix", "matrix", kind="text", choices=("HLM", "RLM")),
        DataColumn("replicate", "replicate", kind="integer", required=False),
    ),
)

META = ("# laboratory: Lab A\n# analyst: A. Person\n# run_date: 2026-09-30\n"
        "# study_reference: S-1\n")


def _csv(body: str, meta: str = META) -> bytes:
    return (meta + body).encode()


def test_valid_file_parses_and_is_hashed():
    raw = _csv("sample_id,time [min],conc [uM],matrix,replicate\nA,0,1.0,HLM,1\nA,5,0.8,HLM,\n")
    d = parse_return_file(raw, T)
    assert d.file_sha256 == hashlib.sha256(raw).hexdigest()
    assert d.origin is DataOrigin.MEASURED
    assert d.records[0] == {"sample_id": "A", "time": 0.0, "conc": 1.0, "matrix": "HLM", "replicate": 1}
    assert d.records[1]["replicate"] is None


def test_units_in_header_are_converted_and_recorded():
    d = parse_return_file(_csv("sample_id,time [s],conc [nM],matrix\nA,60,500,HLM\n"), T)
    assert d.records[0]["time"] == pytest.approx(1.0)
    assert d.records[0]["conc"] == pytest.approx(0.5)
    assert len(d.conversions) == 2


@pytest.mark.parametrize("body,needle", [
    ("sample_id,time [min],matrix\nA,0,HLM\n", "missing required column 'conc'"),
    ("sample_id,time [min],conc [uM],matrix,extra\nA,0,1,HLM,x\n", "unexpected column"),
    ("sample_id,time [min],conc [kg],matrix\nA,0,1,HLM\n", "not dimensionally compatible"),
    ("sample_id,time [min],conc [uM],matrix\nA,0,abc,HLM\n", "is not a number"),
    ("sample_id,time [min],conc [uM],matrix\nA,0,nan,HLM\n", "not finite"),
    ("sample_id,time [min],conc [uM],matrix\nA,0,-1,HLM\n", "below physical minimum"),
    ("sample_id,time [min],conc [uM],matrix\nA,0,1,MLM\n", "not one of"),
    ("sample_id,time [min],conc [uM],matrix\nA,0,1\n", "expected 4 fields"),
    ("sample_id,time [min],conc [uM],matrix\n,0,1,HLM\n", "required but empty"),
    ("sample_id,time [min],conc [uM],matrix\n", "no data rows"),
    ("sample_id,sample_id,time [min],conc [uM],matrix\nA,A,0,1,HLM\n", "duplicate column"),
])
def test_malformed_files_rejected(body, needle):
    with pytest.raises(IngestError) as e:
        parse_return_file(_csv(body), T)
    assert any(needle in err for err in e.value.errors), e.value.errors


def test_all_errors_reported_with_line_numbers():
    body = "sample_id,time [min],conc [uM],matrix\nA,0,x,HLM\nB,-1,1,HLM\n"
    with pytest.raises(IngestError) as e:
        parse_return_file(_csv(body), T)
    assert len(e.value.errors) == 2
    assert any(err.startswith("line 6") for err in e.value.errors)
    assert any(err.startswith("line 7") for err in e.value.errors)


def test_missing_metadata_rejected():
    with pytest.raises(IngestError) as e:
        parse_return_file(b"# laboratory: L\nsample_id,time,conc,matrix\nA,0,1,HLM\n", T)
    assert any("analyst" in x for x in e.value.errors)


def test_bad_run_date_rejected():
    meta = META.replace("2026-09-30", "30/09/2026")
    with pytest.raises(IngestError):
        parse_return_file(_csv("sample_id,time,conc,matrix\nA,0,1,HLM\n", meta), T)


def test_wrong_template_rejected():
    with pytest.raises(IngestError):
        parse_return_file(_csv("sample_id,time,conc,matrix\nA,0,1,HLM\n",
                               "# hos-template: other/1.0\n" + META), T)


def test_simulation_marker_overrides_measured_claim():
    meta = META + "# hos-simulated: true\n# hos-simulation-method: sim.first_order_depletion\n"
    d = parse_return_file(_csv("sample_id,time,conc,matrix\nA,0,1,HLM\n", meta), T,
                          claimed_origin=DataOrigin.MEASURED)
    assert d.origin is DataOrigin.SIMULATED


def test_simulation_instrument_forces_simulated():
    meta = META + "# instrument: simulation:x\n# hos-simulation-method: sim.first_order_depletion\n"
    assert parse_return_file(_csv("sample_id,time,conc,matrix\nA,0,1,HLM\n", meta), T).is_simulated


def test_simulated_without_generator_rejected():
    with pytest.raises(IngestError):
        parse_return_file(_csv("sample_id,time,conc,matrix\nA,0,1,HLM\n"), T,
                          claimed_origin=DataOrigin.SIMULATED)


def test_tables_refuse_bare_floats():
    with pytest.raises(DriverError):
        Table(title="t", columns=("a",), rows=((1.5,),))


def test_numeric_column_must_declare_unit():
    with pytest.raises(DriverError):
        DataColumn("x", "x", kind="number")


def test_per_row_unit_column_is_validated():
    t = DataTemplate(template_id="u/1", description="d", columns=(
        DataColumn("endpoint", "e", kind="text"),
        DataColumn("unit", "u", kind="text"),
        DataColumn("value", "v", unit_column="unit"),
    ))
    ok = parse_return_file(_csv("endpoint,unit,value\nALT,U/L,30\nliver,g,10.2\n"), t)
    assert ok.records[0]["value"] == 30.0
    with pytest.raises(IngestError) as e:
        parse_return_file(_csv("endpoint,unit,value\nALT,bananas,30\n"), t)
    assert any("not a recognised unit" in x for x in e.value.errors)
