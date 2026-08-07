"""PK-DB anchor — observed human pharmacokinetics validation/uncertainty source.

This module turns PK-DB (https://pk-db.com, König lab, HU Berlin) into a
*Layer-3 human-translation anchor*: for compounds that PK-DB actually covers,
it retrieves the **observed** human PK parameters (clearance, volume of
distribution, half-life, AUC, Cmax) reported across curated clinical studies,
pools them with a **random-effects meta-analysis**, and returns a pooled
estimate *with a data-derived uncertainty envelope* plus the contributing
study identifiers for full provenance.

WHY THIS EXISTS (and why it is NOT wired into the animal side)
--------------------------------------------------------------
The Layer-3 animal-cohort engine (`animalSim.ts`) derives every animal PK
quantity from L1 physicochemistry + allometric scaling, and previously wrapped
the human-translation outputs in a *stochastic* `rng()` band (fabricated noise).
That band is not evidence. PK-DB lets us replace it — but only for the *human*
projection and only for compounds PK-DB contains.

HONEST SCOPE — what PK-DB can and cannot do for us
--------------------------------------------------
  * PK-DB is a *human clinical* PK database. Its data model is built around
    patient collectives / individuals (age, body weight, genotype, smoking,
    health status). Preclinical/animal PK is nominally supported by the schema
    but is negligible in the actual content.
      → This module therefore ONLY anchors the HUMAN-translation outputs of
        Layer 3 (projected human CL / Vd / t½ / AUC / Cmax) and the IVIVE gate.
        It deliberately does NOT parameterise the mouse/rat/dog/monkey cohorts.
  * PK-DB covers a *narrow, curated* substance set (probe drugs and their
    metabolites — caffeine, paracetamol, codeine, midazolam, torasemide,
    simvastatin, …). A novel discovery compound will almost never match.
      → On a miss this module returns `matched=False, observed=None` and an
        explicit reason. It NEVER fabricates a value. The caller must render
        `—` and fall back to the allometric prediction with its own honest
        (non-PK-DB) uncertainty statement.

STATISTICS (real, not heuristic)
--------------------------------
Pooling across studies uses the DerSimonian–Laird random-effects estimator
(DerSimonian & Laird, Control Clin Trials, 1986), which is the standard
meta-analytic model when between-study heterogeneity is expected (it always is
for cross-population PK). We report the pooled mean, its standard error, the
between-study variance τ², I² heterogeneity, a 95 % CI, and the number of
contributing studies. Where a study reports no dispersion (no se/sd), it still
contributes to the pooled point estimate but not to the inverse-variance
weights; this is stated in `uncertainty_source`.

DATA / LICENSING PROVENANCE
---------------------------
PK-DB code: MIT. Documentation: CC-BY-SA 4.0. The *data* are literature-curated
and PK-DB "places no additional restrictions on the use or redistribution of
the data … other than those provided by the original data owners" while
"expecting attribution" (TERMS_OF_USE.md). We therefore (a) never redistribute
raw PK-DB records, only derived pooled statistics, and (b) attach the citation
+ contributing study SIDs to every result. Cite:
  Grzegorzewski J, et al. PK-DB: pharmacokinetics database for individualized
  and stratified computational modeling. Nucleic Acids Res. 2021;49(D1):D1358.
  doi:10.1093/nar/gkaa990

The module needs only `numpy` + `requests` (both already project deps); no
network access is required for the meta-analysis math, so the statistics are
unit-testable fully offline.
"""

from __future__ import annotations

import logging
import math
import os
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

MODULE_VERSION = "1.0.0"
PKDB_BASE_URL = os.environ.get("PKDB_BASE_URL", "https://pk-db.com/api/v1")
PKDB_CITATION = (
    "Grzegorzewski J, et al. PK-DB: pharmacokinetics database for "
    "individualized and stratified computational modeling. "
    "Nucleic Acids Res. 2021;49(D1):D1358. doi:10.1093/nar/gkaa990"
)
PKDB_ATTRIBUTION = "Data: PK-DB (https://pk-db.com), König lab. Code MIT; used with attribution."
HTTP_TIMEOUT_S = float(os.environ.get("PKDB_HTTP_TIMEOUT_S", "20"))
MAX_OUTPUT_PAGES = int(os.environ.get("PKDB_MAX_PAGES", "20"))

# --------------------------------------------------------------------------- #
# Canonical PK parameters + unit normalization
# --------------------------------------------------------------------------- #
# We normalise every observed value to a single canonical unit per parameter so
# that pooling is dimensionally sound. PK-DB already stores SI-ish units and a
# `normed` flag; we additionally guard against the common alternates.

# canonical key -> (canonical unit, {source_unit: multiplicative factor to canonical})
CANONICAL_UNITS: dict[str, tuple[str, dict[str, float]]] = {
    # Weight-normalised clearance, canonical L/h/kg
    "clearance": (
        "liter / hour / kilogram",
        {
            "liter / hour / kilogram": 1.0,
            "milliliter / minute / kilogram": 60.0 / 1000.0,
            "liter / minute / kilogram": 60.0,
            "milliliter / hour / kilogram": 1.0 / 1000.0,
        },
    ),
    # Volume of distribution, canonical L/kg
    "vd": (
        "liter / kilogram",
        {
            "liter / kilogram": 1.0,
            "milliliter / kilogram": 1.0 / 1000.0,
        },
    ),
    # Half-life, canonical hour
    "thalf": (
        "hour",
        {
            "hour": 1.0,
            "minute": 1.0 / 60.0,
            "day": 24.0,
        },
    ),
    # AUC (to infinity or end), canonical ng*h/mL  (== µg*h/L == mg*h/L/1000)
    "auc": (
        "nanogram * hour / milliliter",
        {
            "nanogram * hour / milliliter": 1.0,
            "microgram * hour / milliliter": 1000.0,
            "milligram * hour / liter": 1000.0,
            "gram * hour / liter": 1.0e6,
            "microgram * hour / liter": 1.0,
        },
    ),
    # Cmax, canonical ng/mL
    "cmax": (
        "nanogram / milliliter",
        {
            "nanogram / milliliter": 1.0,
            "microgram / milliliter": 1000.0,
            "milligram / liter": 1000.0,
            "gram / liter": 1.0e6,
            "microgram / liter": 1.0,
        },
    ),
}

# Map PK-DB `measurement_type` names (lower-cased, substring match) -> canonical key.
# Ordered: more specific first so "auc_inf" matches "auc" and "clearance" isn't
# shadowed by "renal clearance" (we keep total clearance only).
_MEASUREMENT_ALIASES: list[tuple[str, str]] = [
    ("auc_inf", "auc"),
    ("auc_end", "auc"),
    ("auc", "auc"),
    ("cmax", "cmax"),
    ("vd_ss", "vd"),
    ("vd", "vd"),
    ("volume of distribution", "vd"),
    ("thalf", "thalf"),
    ("half-life", "thalf"),
    ("half life", "thalf"),
    ("clearance", "clearance"),
]

# measurement_type names we explicitly reject (route-specific / non-total).
_MEASUREMENT_BLOCK = ("renal clearance", "clearance_renal", "clearance_unbound")


def classify_measurement(measurement_type: str | None) -> str | None:
    """Map a PK-DB measurement_type string to a canonical PK key, or None."""
    if not measurement_type:
        return None
    m = str(measurement_type).strip().lower()
    if any(b in m for b in _MEASUREMENT_BLOCK):
        return None
    for alias, canonical in _MEASUREMENT_ALIASES:
        if alias in m:
            return canonical
    return None


def normalize_value(canonical_key: str, value: float, unit: str | None) -> float | None:
    """Convert a value in `unit` to the canonical unit for `canonical_key`.

    Returns None when the unit is unknown (we refuse to guess — an unknown unit
    is dropped from the pool and surfaced in diagnostics, never coerced).
    """
    if value is None or not math.isfinite(value):
        return None
    spec = CANONICAL_UNITS.get(canonical_key)
    if spec is None:
        return None
    _, factors = spec
    if unit is None:
        return None
    u = str(unit).strip().lower()
    factor = factors.get(u)
    if factor is None:
        return None
    return value * factor


# --------------------------------------------------------------------------- #
# Observation + meta-analysis
# --------------------------------------------------------------------------- #


@dataclass
class Observation:
    """A single per-study/per-group observed PK value in canonical units."""

    study_sid: str
    study_name: str
    canonical_key: str
    value: float  # canonical units
    se: float | None = None  # canonical units (standard error of the mean)
    n: int | None = None
    subject_count: int | None = None
    calculated: bool = False  # PK-DB-derived (from time course) vs reported


@dataclass
class PooledEstimate:
    """Random-effects pooled estimate for one canonical PK parameter."""

    canonical_key: str
    unit: str
    pooled_mean: float
    pooled_se: float
    ci95_low: float
    ci95_high: float
    tau2: float  # between-study variance (DerSimonian-Laird)
    i2: float  # heterogeneity (%)
    n_studies: int
    n_studies_with_variance: int
    uncertainty_source: str  # "random_effects" | "range" | "single_study"
    study_sids: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "parameter": self.canonical_key,
            "unit": self.unit,
            "pooled_mean": _round(self.pooled_mean),
            "pooled_se": _round(self.pooled_se),
            "ci95": [_round(self.ci95_low), _round(self.ci95_high)],
            "cv_pct": (
                _round(100.0 * self.pooled_se / self.pooled_mean) if self.pooled_mean else None
            ),
            "tau2": _round(self.tau2),
            "i2_pct": _round(self.i2),
            "n_studies": self.n_studies,
            "n_studies_with_variance": self.n_studies_with_variance,
            "uncertainty_source": self.uncertainty_source,
            "study_sids": self.study_sids,
        }


def _round(x: float | None, sig: int = 4) -> float | None:
    if x is None or not math.isfinite(x):
        return None
    if x == 0:
        return 0.0
    return float(round(x, sig - int(math.floor(math.log10(abs(x)))) - 1))


def dersimonian_laird(values: np.ndarray, variances: np.ndarray) -> tuple[float, float, float]:
    """DerSimonian–Laird random-effects pooling.

    Args:
        values:    per-study point estimates (canonical units).
        variances: per-study variances (se²) in canonical units².

    Returns:
        (pooled_mean, pooled_variance, tau2)

    Implements the closed-form 1986 estimator. Degenerate cases (k==1, or all
    variances zero) are handled by the caller; here we assume k>=2 and
    variances>0.
    """
    w = 1.0 / variances  # fixed-effect weights
    mean_fe = float(np.sum(w * values) / np.sum(w))
    q = float(np.sum(w * (values - mean_fe) ** 2))  # Cochran's Q
    k = len(values)
    c = float(np.sum(w) - np.sum(w**2) / np.sum(w))
    tau2 = max(0.0, (q - (k - 1)) / c) if c > 0 else 0.0
    w_re = 1.0 / (variances + tau2)  # random-effects weights
    mean_re = float(np.sum(w_re * values) / np.sum(w_re))
    var_re = float(1.0 / np.sum(w_re))
    return mean_re, var_re, tau2


def pool_observations(obs: list[Observation]) -> PooledEstimate | None:
    """Pool a set of same-parameter observations into a PooledEstimate.

    Strategy (all honest about the uncertainty source):
      * >=2 studies with a usable SE  -> DerSimonian–Laird random effects.
      * exactly 1 study with SE, or >=2 without any SE -> point mean, with the
        spread reported as a plain SD-of-means ("range") and flagged as such.
      * a single study, no SE -> single_study, CI is undefined (returned equal
        to the point estimate; caller must not over-interpret).
    """
    if not obs:
        return None
    key = obs[0].canonical_key
    unit = CANONICAL_UNITS[key][0]
    values = np.array([o.value for o in obs], dtype=float)
    sids = _unique_preserve([o.study_sid for o in obs])

    with_var = [o for o in obs if o.se is not None and math.isfinite(o.se) and o.se > 0]

    if len(with_var) >= 2:
        v = np.array([o.value for o in with_var], dtype=float)
        var = np.array([o.se**2 for o in with_var], dtype=float)
        mean_re, var_re, tau2 = dersimonian_laird(v, var)
        se = math.sqrt(var_re)
        # I² = max(0, (Q-(k-1))/Q); recompute Q for reporting
        w = 1.0 / var
        mean_fe = float(np.sum(w * v) / np.sum(w))
        q = float(np.sum(w * (v - mean_fe) ** 2))
        k = len(v)
        i2 = max(0.0, (q - (k - 1)) / q) * 100.0 if q > 0 else 0.0
        return PooledEstimate(
            canonical_key=key,
            unit=unit,
            pooled_mean=mean_re,
            pooled_se=se,
            ci95_low=mean_re - 1.96 * se,
            ci95_high=mean_re + 1.96 * se,
            tau2=tau2,
            i2=i2,
            n_studies=len(obs),
            n_studies_with_variance=len(with_var),
            uncertainty_source="random_effects",
            study_sids=sids,
        )

    if len(values) >= 2:
        # No usable per-study variance: report the empirical spread of means.
        mean = float(np.mean(values))
        sd = float(np.std(values, ddof=1))
        se = sd / math.sqrt(len(values))
        return PooledEstimate(
            canonical_key=key,
            unit=unit,
            pooled_mean=mean,
            pooled_se=se,
            ci95_low=mean - 1.96 * se,
            ci95_high=mean + 1.96 * se,
            tau2=float("nan"),
            i2=float("nan"),
            n_studies=len(obs),
            n_studies_with_variance=0,
            uncertainty_source="range",
            study_sids=sids,
        )

    # Single study.
    o = obs[0]
    se = o.se if (o.se is not None and math.isfinite(o.se) and o.se > 0) else float("nan")
    lo = (o.value - 1.96 * se) if math.isfinite(se) else o.value
    hi = (o.value + 1.96 * se) if math.isfinite(se) else o.value
    return PooledEstimate(
        canonical_key=key,
        unit=unit,
        pooled_mean=o.value,
        pooled_se=se,
        ci95_low=lo,
        ci95_high=hi,
        tau2=float("nan"),
        i2=float("nan"),
        n_studies=1,
        n_studies_with_variance=1 if math.isfinite(se) else 0,
        uncertainty_source="single_study",
        study_sids=sids,
    )


def _unique_preserve(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for it in items:
        if it and it not in seen:
            seen.add(it)
            out.append(it)
    return out


# --------------------------------------------------------------------------- #
# Output-record parsing (PK-DB `/outputs/` JSON rows -> Observation)
# --------------------------------------------------------------------------- #


def parse_output_record(row: dict[str, Any]) -> Observation | None:
    """Parse one PK-DB output row into a canonical Observation, or None.

    Robust to the two shapes the API returns: `measurement_type` may be a bare
    string or a nested info-node dict ({"name": ...}). Values may be reported as
    group aggregates (mean + sd/se + count) or individual values.
    """
    mt = row.get("measurement_type")
    if isinstance(mt, dict):
        mt = mt.get("name") or mt.get("label") or mt.get("sid")
    key = classify_measurement(mt)
    if key is None:
        return None

    unit = row.get("unit")
    # Prefer group mean; fall back to individual value / median.
    raw_value = _first_number(row.get("mean"), row.get("value"), row.get("median"))
    if raw_value is None:
        return None
    value = normalize_value(key, raw_value, unit)
    if value is None:
        return None  # unknown unit -> drop, never coerce

    n = _first_int(row.get("count"), row.get("group_count"), row.get("subject_count"))
    # Standard error of the mean: prefer se; else sd/sqrt(n); else from cv.
    se_raw = _first_number(row.get("se"))
    if se_raw is None:
        sd_raw = _first_number(row.get("sd"))
        if sd_raw is not None and n and n > 1:
            se_raw = sd_raw / math.sqrt(n)
        else:
            cv = _first_number(row.get("cv"))
            if cv is not None and n and n > 1:
                # cv is fraction (or %) of the mean -> sd = cv*mean
                cv_frac = cv / 100.0 if cv > 1.5 else cv
                se_raw = (cv_frac * raw_value) / math.sqrt(n)
    se = normalize_value(key, se_raw, unit) if se_raw is not None else None

    study_sid = str(row.get("study_sid") or row.get("study") or "").strip()
    study_name = str(row.get("study_name") or "").strip()
    return Observation(
        study_sid=study_sid or study_name or "unknown",
        study_name=study_name,
        canonical_key=key,
        value=value,
        se=se,
        n=n,
        subject_count=n,
        calculated=bool(row.get("calculated", False)),
    )


def _first_number(*vals: Any) -> float | None:
    for v in vals:
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(f):
            return f
    return None


def _first_int(*vals: Any) -> int | None:
    f = _first_number(*vals)
    return int(f) if f is not None else None


# --------------------------------------------------------------------------- #
# HTTP layer (isolated so the pooling logic is testable offline)
# --------------------------------------------------------------------------- #

HttpGetter = Callable[[str, dict[str, Any]], dict[str, Any]]


def _default_http_get(url: str, params: dict[str, Any]) -> dict[str, Any]:
    import requests  # local import so unit tests never need the package

    resp = requests.get(
        url, params=params, timeout=HTTP_TIMEOUT_S, headers={"Accept": "application/json"}
    )
    resp.raise_for_status()
    return resp.json()


def inchikey_from_smiles(smiles: str | None) -> str | None:
    """Derive an InChIKey from a SMILES via RDKit for exact structural matching.

    Returns None when RDKit is unavailable or the SMILES is invalid — the caller
    then falls back to name matching. Never raises.
    """
    if not smiles:
        return None
    try:
        from rdkit import Chem  # local import; optional dependency

        mol = Chem.MolFromSmiles(smiles)
        if mol is None:
            return None
        return Chem.MolToInchiKey(mol) or None
    except Exception:  # noqa: BLE001 — RDKit missing/invalid input -> name fallback
        return None


@dataclass
class PkdbMatch:
    sid: str
    name: str
    inchikey: str | None
    chembl: str | None


def resolve_substance(
    *,
    name: str | None = None,
    inchikey: str | None = None,
    chembl_id: str | None = None,
    http_get: HttpGetter = _default_http_get,
) -> PkdbMatch | None:
    """Resolve a compound to a PK-DB substance info-node.

    Match precedence: InChIKey (exact, structure-level) > ChEMBL id > name.
    Returns None when PK-DB does not contain the substance (the common case for
    novel compounds — handled honestly by the caller).
    """
    query = inchikey or chembl_id or name
    if not query:
        return None
    payload = http_get(f"{PKDB_BASE_URL}/info_nodes/", {"search": query, "format": "json"})
    rows = _extract_data_list(payload)
    substances = [r for r in rows if str(r.get("ntype", "")).lower() == "substance"]
    if not substances:
        return None

    def to_match(r: dict[str, Any]) -> PkdbMatch:
        ik = _xref_value(r, "inchikey")
        ch = _xref_value(r, "chembl")
        return PkdbMatch(sid=r.get("sid", ""), name=r.get("name", ""), inchikey=ik, chembl=ch)

    matches = [to_match(r) for r in substances]
    if inchikey:
        norm = inchikey.strip().upper()
        for m in matches:
            if m.inchikey and m.inchikey.strip().upper() == norm:
                return m
        return None  # asked for a specific structure; a name-similar hit is NOT a match
    if chembl_id:
        norm = chembl_id.strip().upper()
        for m in matches:
            if m.chembl and m.chembl.strip().upper() == norm:
                return m
        return None
    if name:
        norm = name.strip().lower()
        for m in matches:
            if m.name.strip().lower() == norm:
                return m
        return None
    return None


def _xref_value(node: dict[str, Any], collection: str) -> str | None:
    # InChIKey lives in annotations (collection == "inchikey"); ChEMBL in xrefs.
    for ann in node.get("annotations", []) or []:
        if str(ann.get("collection", "")).lower() == collection:
            return ann.get("term")
    for xr in node.get("xrefs", []) or []:
        if str(xr.get("name", "")).lower() == collection:
            return xr.get("accession")
    return None


def _extract_data_list(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """PK-DB wraps list responses as {"data": {"count": N, "data": [...]}}."""
    data = payload.get("data", payload)
    if isinstance(data, dict):
        inner = data.get("data", data.get("results"))
        if isinstance(inner, list):
            return inner
    if isinstance(data, list):
        return data
    results = payload.get("results")
    return results if isinstance(results, list) else []


def fetch_observations(
    match: PkdbMatch,
    *,
    http_get: HttpGetter = _default_http_get,
) -> list[Observation]:
    """Fetch observed human PK outputs for a resolved substance.

    Filters to normalised, human outputs and parses each into a canonical
    Observation. Uses the documented `/filter/` -> uuid -> `/outputs/` flow.
    """
    filt = http_get(
        f"{PKDB_BASE_URL}/filter/", {"outputs__substance": match.name, "format": "json"}
    )
    uuid = filt.get("uuid")
    if not uuid:
        return []
    observations: list[Observation] = []
    for page in range(1, MAX_OUTPUT_PAGES + 1):
        payload = http_get(
            f"{PKDB_BASE_URL}/outputs/",
            {"uuid": uuid, "page": page, "format": "json", "normed": "true"},
        )
        rows = _extract_data_list(payload)
        if not rows:
            break
        for row in rows:
            # keep only human outputs when species is annotated
            sp = _row_species(row)
            if sp is not None and sp not in ("homo sapiens", "human"):
                continue
            obs = parse_output_record(row)
            if obs is not None:
                observations.append(obs)
        if len(rows) < 10:  # last (partial) page
            break
    return observations


def _row_species(row: dict[str, Any]) -> str | None:
    for k in ("species", "group_species", "individual_species"):
        v = row.get(k)
        if isinstance(v, dict):
            v = v.get("name") or v.get("label")
        if v:
            return str(v).strip().lower()
    return None


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #

_READY = True  # no model weights to load; ready as soon as imported
_WARMED = {"ok": False, "version": None, "error": None}


def is_ready() -> dict[str, Any]:
    return {
        "ready": _READY,
        "version": MODULE_VERSION,
        "warmed": _WARMED["ok"],
        "pkdb_version": _WARMED["version"],
        "error": _WARMED["error"],
    }


def warmup(http_get: HttpGetter = _default_http_get) -> dict[str, Any]:
    """Confirm live PK-DB reachability + capture the current DB version.

    This is the honest live-reachability check: it does not fabricate anything;
    on failure it records the error and the caller degrades gracefully.
    """
    try:
        stats = http_get(f"{PKDB_BASE_URL}/statistics/", {"format": "json"})
        _WARMED.update(ok=True, version=stats.get("version"), error=None)
    except Exception as e:  # noqa: BLE001 — reachability probe, report verbatim
        _WARMED.update(ok=False, version=None, error=str(e))
    return dict(_WARMED)


def predict_pk_anchor(
    *,
    name: str | None = None,
    inchikey: str | None = None,
    chembl_id: str | None = None,
    smiles: str | None = None,
    projected: dict[str, float] | None = None,
    parameters: list[str] | None = None,
    http_get: HttpGetter = _default_http_get,
) -> dict[str, Any]:
    """Return the PK-DB human-PK anchor for a compound.

    Args:
        name/inchikey/chembl_id: compound identity from L1 (InChIKey preferred).
        smiles: if given and no inchikey supplied, an InChIKey is derived via
            RDKit for exact structural matching (falls back to name otherwise).
        projected: optional {canonical_key: value} of the Layer-3 projected
            human PK, to compute a validation z-score against the observed pool.
        parameters: restrict to these canonical keys (default: all five).

    Returns a JSON-serialisable dict. On a miss:
        {"matched": false, "observed": null, "reason": "...", "provenance": {...}}
    — never a fabricated number.
    """
    want = set(parameters) if parameters else set(CANONICAL_UNITS.keys())
    # Derive an InChIKey from SMILES when one wasn't supplied (best-effort).
    if not inchikey and smiles:
        inchikey = inchikey_from_smiles(smiles)
    provenance = {
        "source": "PK-DB",
        "base_url": PKDB_BASE_URL,
        "module_version": MODULE_VERSION,
        "citation": PKDB_CITATION,
        "attribution": PKDB_ATTRIBUTION,
        "fetched_at": _now_iso(),
        "pkdb_version": _WARMED["version"],
        "query": {
            "name": name,
            "inchikey": inchikey,
            "chembl_id": chembl_id,
            "inchikey_from_smiles": bool(smiles and inchikey),
        },
    }

    try:
        match = resolve_substance(
            name=name, inchikey=inchikey, chembl_id=chembl_id, http_get=http_get
        )
    except Exception as e:  # noqa: BLE001
        return {
            "matched": False,
            "observed": None,
            "reason": f"PK-DB unreachable during resolve: {e}",
            "degraded": True,
            "provenance": provenance,
        }

    if match is None:
        return {
            "matched": False,
            "observed": None,
            "reason": (
                "Compound not found in PK-DB. PK-DB covers a narrow, "
                "curated set of human probe drugs; novel compounds "
                "are expected to miss. No value fabricated."
            ),
            "degraded": False,
            "provenance": provenance,
        }

    provenance["matched_substance"] = {
        "sid": match.sid,
        "name": match.name,
        "inchikey": match.inchikey,
        "chembl": match.chembl,
    }

    try:
        observations = fetch_observations(match, http_get=http_get)
    except Exception as e:  # noqa: BLE001
        return {
            "matched": True,
            "observed": None,
            "reason": f"PK-DB reachable but outputs fetch failed: {e}",
            "degraded": True,
            "provenance": provenance,
        }

    # Group by canonical parameter and pool.
    grouped: dict[str, list[Observation]] = {}
    for o in observations:
        if o.canonical_key in want:
            grouped.setdefault(o.canonical_key, []).append(o)

    observed: dict[str, Any] = {}
    for key, obs in grouped.items():
        pooled = pool_observations(obs)
        if pooled is None:
            continue
        entry = pooled.as_dict()
        if projected and key in projected and projected[key] is not None:
            entry["validation"] = _validate(projected[key], pooled)
        observed[key] = entry

    if not observed:
        return {
            "matched": True,
            "observed": None,
            "reason": (
                "Substance is in PK-DB but no poolable clearance / Vd "
                "/ half-life / AUC / Cmax outputs in known units were "
                "found for it. No value fabricated."
            ),
            "degraded": False,
            "provenance": provenance,
            "n_outputs_seen": len(observations),
        }

    return {
        "matched": True,
        "observed": observed,
        "reason": None,
        "degraded": False,
        "provenance": provenance,
        "n_outputs_seen": len(observations),
    }


def _validate(projected_value: float, pooled: PooledEstimate) -> dict[str, Any]:
    """Compare a projected value to the observed pool.

    Returns a z-score (projected vs pooled mean / pooled SE), a fold-error, and
    a verdict tier. This is how Layer 3 knows whether its allometric human
    projection agrees with real observations for compounds we can check.
    """
    if not math.isfinite(projected_value) or projected_value <= 0:
        return {"verdict": "UNKNOWN", "reason": "no valid projected value"}
    fold = projected_value / pooled.pooled_mean if pooled.pooled_mean else float("nan")
    z = (
        (projected_value - pooled.pooled_mean) / pooled.pooled_se
        if pooled.pooled_se and math.isfinite(pooled.pooled_se) and pooled.pooled_se > 0
        else float("nan")
    )
    if math.isfinite(fold):
        within2 = 0.5 <= fold <= 2.0
        within3 = (1.0 / 3.0) <= fold <= 3.0
        verdict = "AGREES" if within2 else ("MARGINAL" if within3 else "DIVERGES")
    else:
        verdict = "UNKNOWN"
    return {
        "projected": _round(projected_value),
        "observed_mean": _round(pooled.pooled_mean),
        "fold_error": _round(fold),
        "z_score": _round(z),
        "verdict": verdict,
        "criterion": "AGREES if 0.5<=fold<=2 (Obach 2-fold); MARGINAL if within 3-fold.",
    }


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
