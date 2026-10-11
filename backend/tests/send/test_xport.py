"""SAS XPORT v5 writer and reader against SAS TS-140 (October 2021)."""

import io
from datetime import datetime

import pandas as pd
import pytest

from hos.send.xport import (
    MISSING,
    XportError,
    XportVariable,
    from_ibm_double,
    ibm_double,
    read_xport,
    write_xport,
)

WHEN = datetime(2026, 10, 11, 9, 30, 0)
# TS-140 testieee.c, xpt_testvals and missingvals.
TS140 = {
    1.0: "4110000000000000",
    -1.0: "c110000000000000",
    0.0: "0000000000000000",
    2.0: "4120000000000000",
}


def _file(rows, variables=None):
    variables = variables or [
        XportVariable("USUBJID", "Unique Subject Identifier", False, 12),
        XportVariable("BWSTRESN", "Numeric Result/Finding in Std Units", True, 8),
    ]
    return write_xport("BW", "Body Weights", variables, rows, created=WHEN, software="HOS0.1")


@pytest.mark.parametrize(("value", "hexed"), TS140.items())
def test_ibm_double_matches_ts140_vectors(value, hexed):
    assert ibm_double(value).hex() == hexed
    assert from_ibm_double(bytes.fromhex(hexed)) == value


def test_missing_values_per_ts140():
    assert bytes([0x2E]) + bytes(7) == MISSING
    for first in (0x2E, 0x5F, 0x41, 0x5A):  # ".", "._", ".A", ".Z"
        assert from_ibm_double(bytes([first]) + bytes(7)) is None
    assert ibm_double(None) == MISSING


@pytest.mark.parametrize("value", [0.1, 1 / 3, 123456.789, -2.5e-12, 7.2e75, 5.4e-79, 287.97])
def test_ibm_double_is_exact_for_ieee_doubles(value):
    # IBM doubles carry 56 fraction bits against IEEE's 53, so the round trip is exact.
    assert from_ibm_double(ibm_double(value)) == value


def test_out_of_range_and_non_finite_values_are_refused():
    for bad in (float("nan"), float("inf"), 1e300, 1e-300):
        with pytest.raises(XportError):
            ibm_double(bad)


def test_record_layout():
    data = _file([["S-1", 287.5]])
    assert len(data) % 80 == 0
    recs = [data[i : i + 80] for i in range(0, len(data), 80)]
    assert recs[0] == b"HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!" + b"0" * 30 + b"  "
    assert recs[1].startswith(b"SAS     SAS     SASLIB  HOS0.1  ")
    assert recs[1][64:80] == b"11OCT26:09:30:00"
    assert recs[3][48:78] == b"000000000000000001600000000140"
    assert recs[5][8:16] == b"BW      "
    assert recs[6][32:72] == b"Body Weights".ljust(40)
    assert recs[7][54:58] == b"0002"  # variable count
    namestr = data[8 * 80 : 8 * 80 + 140]
    assert namestr[:8] == b"\x00\x02\x00\x00\x00\x0c\x00\x01"  # char, length 12, varnum 1
    assert namestr[8:16] == b"USUBJID "
    assert recs[12].startswith(b"HEADER RECORD*******OBS     HEADER RECORD")  # 2 x 140 -> 4 records


def test_output_is_byte_reproducible():
    rows = [["S-1", 287.5], ["S-2", None]]
    assert _file(rows) == _file(rows)


def test_reader_round_trip_including_zero_and_missing():
    rows = [["S-1", 0.0], ["S-2", None], ["S-3", 312.25], ["", -1.0]]
    ds = read_xport(_file(rows))
    assert ds.name == "BW" and ds.label == "Body Weights"
    assert [v.name for v in ds.variables] == ["USUBJID", "BWSTRESN"]
    assert [list(r) for r in ds.rows] == rows


def test_pandas_reads_the_file_independently():
    variables = [
        XportVariable("USUBJID", "Unique Subject Identifier", False, 8),
        XportVariable("BWSTRESN", "Numeric Result/Finding in Std Units", True, 8),
    ]
    rows = [["SUBJ-001", 287.5], ["SUBJ-002", None], ["SUBJ-003", 312.25]]
    df = pd.read_sas(io.BytesIO(_file(rows, variables)), format="xport", encoding="ascii")
    assert list(df["USUBJID"]) == ["SUBJ-001", "SUBJ-002", "SUBJ-003"]
    assert df["BWSTRESN"][0] == 287.5 and pd.isna(df["BWSTRESN"][1])
    assert df["BWSTRESN"][2] == 312.25


def test_pandas_undercounts_observations():
    """Documented reader defect, not a file defect: pandas' _record_count treats every blank
    8-byte word in the last 80-byte record as padding, wherever it falls. Here S-2's padded
    identifier holds such a word, so pandas drops S-3; TS-140 readers do not."""
    data = _file([["S-1", 287.5], ["S-2", None], ["S-3", 312.25]])
    assert len(pd.read_sas(io.BytesIO(data), format="xport", encoding="ascii")) == 2
    assert [r[0] for r in read_xport(data).rows] == ["S-1", "S-2", "S-3"]


def test_pandas_misreads_ibm_zero():
    """Documented reader defect, not a file defect: pandas' _parse_float_vec turns the all-zero
    IBM double (TS-140's 0) into 2**-260. The file holds the TS-140 bytes."""
    data = _file([["S-1", 0.0]])
    df = pd.read_sas(io.BytesIO(data), format="xport", encoding="ascii")
    assert df["BWSTRESN"][0] == 2.0**-260
    assert read_xport(data).rows[0][1] == 0.0


def test_limits():
    with pytest.raises(XportError):
        XportVariable("TOOLONGNAME", "x", False, 8)
    with pytest.raises(XportError):
        XportVariable("X", "y" * 41, False, 8)
    with pytest.raises(XportError):
        XportVariable("X", "y", False, 201)
    with pytest.raises(XportError):
        XportVariable("X", "y", True, 4)
    with pytest.raises(XportError):
        _file([["S-1-TOO-LONG-ID", 1.0]])
    with pytest.raises(XportError):
        _file([["Sé", 1.0]])
    with pytest.raises(XportError):
        _file([["S-1", "heavy"]])
    with pytest.raises(XportError):
        write_xport("BW", "x" * 41, [], [], created=WHEN, software="HOS0.1")
