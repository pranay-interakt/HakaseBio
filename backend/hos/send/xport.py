"""SAS transport (XPORT) version 5 writer, per SAS technical paper TS-140 ("Record Layout of a
SAS Version 5 or 6 Data Set in SAS Transport (Xport) Format", last update October 2021).

FDA requires XPORT v5 for all submitted datasets, one dataset per file, named like the file
(Study Data Technical Conformance Guide v6.3, 3.1.1); names are limited to 8 characters, labels
to 40 and character values to 200 bytes (TCG 3.1.4; SAS KB0041592), in ASCII (TCG 3.1.5).

Layout (TS-140): every record is 80 bytes, blank padded. Library header, two real header
records, then per member: member and descriptor headers, two member header records, the
NAMESTR header (variable count at offset 54), the 140-byte NAMESTR records streamed in 80-byte
pieces, the observation header, and the observations streamed in 80-byte pieces. Numbers are
IBM System/360 doubles (sign, excess-64 base-16 exponent, 56-bit fraction); a missing value is
the byte 0x2E followed by zeros. Integers in the NAMESTR are big-endian.
"""

from __future__ import annotations

import math
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

__all__ = ["XportDataset", "XportError", "XportVariable", "from_ibm_double", "ibm_double",
           "read_xport", "write_xport"]

RECORD = 80
MISSING = b"\x2e" + b"\x00" * 7
_MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


class XportError(ValueError):
    pass


def ibm_double(x: float | None) -> bytes:
    """IEEE double -> 8-byte IBM System/360 double (exact: 53 bits fit in 56). ``None`` is the
    standard missing value."""
    if x is None:
        return MISSING
    if not math.isfinite(x):
        raise XportError(f"cannot store non-finite value {x!r}")
    if x == 0:
        return b"\x00" * 8
    sign = 0x80 if x < 0 else 0
    m, p = math.frexp(abs(x))          # |x| = m * 2**p, 0.5 <= m < 1
    e = -((-p) // 4)                   # ceil(p / 4): |x| = f * 16**e, 1/16 <= f < 1
    shift = 3 + p - 4 * e              # 0..3
    mantissa = int(m * (1 << 53)) << shift
    exponent = e + 64
    if not 0 <= exponent <= 127:
        raise XportError(f"{x!r} is outside the IBM double range")
    return bytes([sign | exponent]) + mantissa.to_bytes(7, "big")


def from_ibm_double(b: bytes) -> float | None:
    """8-byte IBM System/360 double -> float; the missing values (``.``, ``._`` and ``.A`` to
    ``.Z``: the first byte followed by seven zero bytes) -> ``None``."""
    if len(b) != 8:
        raise XportError("an IBM double is 8 bytes")
    if b[1:] == b"\x00" * 7 and (b[0] in (0x2E, 0x5F) or 0x41 <= b[0] <= 0x5A):
        return None
    fraction = int.from_bytes(b[1:], "big")
    value = math.ldexp(fraction, 4 * ((b[0] & 0x7F) - 64) - 56)
    return -value if b[0] & 0x80 else value


@dataclass(frozen=True, slots=True)
class XportVariable:
    name: str
    label: str
    numeric: bool
    length: int  # 8 for numerics; bytes for characters

    def __post_init__(self) -> None:
        if not (1 <= len(self.name) <= 8 and self.name.isascii() and self.name.isidentifier()):
            raise XportError(f"variable name {self.name!r}: 1-8 ASCII characters")
        if len(self.label) > 40 or not self.label.isascii():
            raise XportError(f"{self.name}: label longer than 40 characters or not ASCII")
        if self.numeric and self.length != 8:
            raise XportError(f"{self.name}: numeric variables are 8 bytes")
        if not self.numeric and not 1 <= self.length <= 200:
            raise XportError(f"{self.name}: character length must be 1-200")


def _pad(s: str, n: int) -> bytes:
    b = s.encode("ascii")
    if len(b) > n:
        raise XportError(f"{s!r} longer than {n} bytes")
    return b + b" " * (n - len(b))


def _stamp(dt: datetime) -> str:
    return f"{dt.day:02d}{_MONTHS[dt.month - 1]}{dt.year % 100:02d}:{dt:%H:%M:%S}"


def _records(data: bytes) -> bytes:
    rem = len(data) % RECORD
    return data + (b" " * (RECORD - rem) if rem else b"")


def _header(kind: str, digits: str) -> bytes:
    if len(digits) != 30:
        raise XportError("header digit field must be 30 characters")
    return _pad(f"HEADER RECORD*******{kind:<8}HEADER RECORD!!!!!!!{digits}", RECORD)


def write_xport(name: str, label: str, variables: Sequence[XportVariable],
                rows: Sequence[Sequence[str | float | None]], *, created: datetime,
                software: str) -> bytes:
    """One dataset in one XPORT v5 file. ``created`` fixes every header timestamp so the bytes
    are reproducible; ``software`` (<= 8 characters) fills the version field honestly rather
    than claiming a SAS release."""
    if not (1 <= len(name) <= 8 and name.isascii() and name.isidentifier()):
        raise XportError(f"dataset name {name!r}: 1-8 ASCII characters")
    if len(label) > 40 or not label.isascii():
        raise XportError("dataset label: at most 40 ASCII characters")
    if len({v.name for v in variables}) != len(variables):
        raise XportError("duplicate variable names")
    stamp = _stamp(created)
    out = bytearray()
    out += _header("LIBRARY", "0" * 30)
    out += _pad("SAS".ljust(8) + "SAS".ljust(8) + "SASLIB".ljust(8) + software.ljust(8)
                + "HOS".ljust(8) + " " * 24 + stamp, RECORD)
    out += _pad(stamp, RECORD)
    out += _header("MEMBER", "0" * 17 + "160" + "0" * 7 + "140")
    out += _header("DSCRPTR", "0" * 30)
    out += _pad("SAS".ljust(8) + name.upper().ljust(8) + "SASDATA".ljust(8) + software.ljust(8)
                + "HOS".ljust(8) + " " * 24 + stamp, RECORD)
    out += _pad(stamp + " " * 16 + label.ljust(40) + "".ljust(8), RECORD)
    out += _header("NAMESTR", f"000000{len(variables):04d}" + "0" * 20)
    namestr = bytearray()
    pos = 0
    for i, v in enumerate(variables, start=1):
        namestr += struct.pack(">hhhh", 1 if v.numeric else 2, 0, v.length, i)
        namestr += _pad(v.name.upper(), 8) + _pad(v.label, 40) + _pad("", 8)
        namestr += struct.pack(">hhh", 0, 0, 0) + b"\x00\x00"
        namestr += _pad("", 8) + struct.pack(">hhi", 0, 0, pos) + b"\x00" * 52
        pos += v.length
    out += _records(bytes(namestr))
    out += _header("OBS", "0" * 30)
    obs = bytearray()
    for r, row in enumerate(rows, start=1):
        if len(row) != len(variables):
            raise XportError(f"row {r}: {len(row)} values for {len(variables)} variables")
        for v, val in zip(variables, row, strict=True):
            if v.numeric:
                if val is not None and not isinstance(val, (int, float)):
                    raise XportError(f"row {r} {v.name}: {val!r} is not numeric")
                obs += ibm_double(None if val is None else float(val))
            else:
                s = "" if val is None else str(val)
                try:
                    obs += _pad(s, v.length)
                except UnicodeEncodeError:
                    raise XportError(f"row {r} {v.name}: non-ASCII value {s!r}") from None
    out += _records(bytes(obs))
    return bytes(out)


@dataclass(frozen=True, slots=True)
class XportDataset:
    name: str
    label: str
    variables: tuple[XportVariable, ...]
    rows: tuple[tuple[str | float | None, ...], ...]


def read_xport(data: bytes) -> XportDataset:
    """Read a one-member XPORT v5 file (the layout ``write_xport`` produces). Character values
    are returned with trailing blanks removed. TS-140 records no observation count: a trailing
    observation made only of blanks that fits inside the final record's padding cannot be told
    from that padding and is dropped, as SAS readers do."""
    if len(data) % RECORD or not data.startswith(b"HEADER RECORD*******LIBRARY HEADER RECORD"):
        raise XportError("not a SAS XPORT v5 library")
    recs = [data[i:i + RECORD] for i in range(0, len(data), RECORD)]
    if not recs[3].startswith(b"HEADER RECORD*******MEMBER  HEADER RECORD") or \
            not recs[4].startswith(b"HEADER RECORD*******DSCRPTR HEADER RECORD"):
        raise XportError("member header missing")
    if recs[3][75:78] != b"140":
        raise XportError("only 140-byte NAMESTR records are supported")
    name = recs[5][8:16].decode("ascii").rstrip()
    label = recs[6][32:72].decode("ascii").rstrip()
    if not recs[7].startswith(b"HEADER RECORD*******NAMESTR HEADER RECORD"):
        raise XportError("NAMESTR header missing")
    count = int(recs[7][54:58])
    start = 8 * RECORD
    end = start + -(-count * 140 // RECORD) * RECORD
    variables: list[tuple[XportVariable, int]] = []
    for i in range(count):
        ns = data[start + 140 * i:start + 140 * (i + 1)]
        ntype, _, length, _ = struct.unpack(">hhhh", ns[:8])
        position = struct.unpack(">i", ns[84:88])[0]
        variables.append((XportVariable(ns[8:16].decode("ascii").rstrip(),
                                        ns[16:56].decode("ascii").rstrip(), ntype == 1, length),
                          position))
    if not data[end:end + RECORD].startswith(b"HEADER RECORD*******OBS     HEADER RECORD"):
        raise XportError("OBS header missing")
    obs = data[end + RECORD:]
    width = sum(v.length for v, _ in variables)
    rows: list[tuple[str | float | None, ...]] = []
    for off in range(0, len(obs) - width + 1 if width else 0, width):
        chunk = obs[off:off + width]
        if len(obs) - off < RECORD and chunk == b" " * width:
            break
        rows.append(tuple(from_ibm_double(chunk[p:p + v.length]) if v.numeric
                          else chunk[p:p + v.length].decode("ascii").rstrip()
                          for v, p in variables))
    return XportDataset(name, label, tuple(v for v, _ in variables), tuple(rows))
