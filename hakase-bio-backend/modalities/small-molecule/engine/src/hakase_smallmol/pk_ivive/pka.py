"""pKa prediction for the PBPK layer (task S1-T3a, docs/pbpk-layer.md §4.5).

One interface (:func:`predict_pka` / :class:`PkaPredictor`) over three backends,
selected in this preference order:

  1. **QupKake** (primary) — GNN + GFN2-xTB semiempirical-QM micro-pKa; SOTA open
     model (RMSE ~0.5-0.8 on independent sets). Needs the ``xtb`` binary
     (conda-forge) and PyTorch-Geometric.
  2. **pkasolver** (fallback) — pure GNN, fast, no QM binary; use when xtb is
     unavailable or per-molecule latency matters.
  3. **heuristic** (last resort) — a small RDKit SMARTS group-contribution table.
     Coarse; present so the interface is always functional and testable. It is
     NOT a substitute for QupKake/pkasolver and its results are flagged.

ENVIRONMENT NOTE (2026-07): in this repo's venv neither the ``xtb`` binary nor
pkasolver is installable — pkasolver is not on PyPI and its GitHub build pins
old torch/PyG; xtb is a compiled QM binary (conda-forge only). So the QupKake
and pkasolver backends are wired behind the interface but report themselves
*unavailable*, and the **heuristic** backend is what actually runs here. Install
the QM/ML stack to activate the real predictors (see each backend's docstring).

Contract (mirrors the pk_ivive provenance / no-fallback policy):
  * A caller-supplied **measured** pKa bypasses prediction (provenance
    ``"measured"``) and is trusted.
  * Results are per-site **micro-pKa** with an ionisation class
    (acid / base / neutral / zwitterion / ampholyte) and fraction-ionised at any
    pH via Henderson-Hasselbalch.
  * Predictions are cached per **canonical SMILES** (+ backend).
  * A predicted pKa in ``[6, 8]`` flags the result low-confidence: fraction
    ionised at plasma pH 7.4 is then highly sensitive to pKa error.

RDKit / optional ML imports are deferred (import-on-use), so importing this
module does not drag rdkit/torch into the process — matching pk_ivive.py.
"""

from __future__ import annotations

import importlib.util
import math
import os
import shutil
from dataclasses import dataclass, field
from enum import Enum

# Physiological reference and the sensitivity band from §4.5.
PLASMA_PH = 7.4
LOW_CONFIDENCE_PKA_RANGE = (6.0, 8.0)
# Sites outside this window do not meaningfully ionise in any biological
# compartment; used only for the acid/base/zwitterion classification.
_IONISABLE_WINDOW = (0.0, 14.0)


class SiteType(str, Enum):
    ACID = "acid"  # loses a proton when ionised (negatively charged conjugate base)
    BASE = "base"  # gains a proton when ionised (positively charged conjugate acid)


class IonisationClass(str, Enum):
    ACID = "acid"
    BASE = "base"
    NEUTRAL = "neutral"
    ZWITTERION = "zwitterion"
    AMPHOLYTE = "ampholyte"


class Provenance(str, Enum):
    MEASURED = "measured"
    QUPKAKE = "qupkake"
    PKASOLVER = "pkasolver"
    HEURISTIC = "heuristic"


class PkaBackendUnavailable(RuntimeError):
    """Raised when a backend is selected but its dependencies are absent."""


class PkaPredictionError(RuntimeError):
    """Raised when an available backend fails on a specific molecule."""


@dataclass(frozen=True)
class MicroPka:
    """A single ionisable site."""

    pka: float
    site_type: SiteType
    atom_index: int | None = None  # RDKit atom index of the ionisable centre
    label: str | None = None  # rule/group name (heuristic) or model note

    def ionised_fraction(self, ph: float) -> float:
        """Fraction of molecules with this site in its *charged* form at ``ph``.

        Acid: deprotonated fraction ``1 / (1 + 10**(pKa - pH))``.
        Base: protonated fraction ``1 / (1 + 10**(pH - pKa))``.
        """
        if self.site_type is SiteType.ACID:
            return 1.0 / (1.0 + 10.0 ** (self.pka - ph))
        return 1.0 / (1.0 + 10.0 ** (ph - self.pka))


@dataclass(frozen=True)
class PkaResult:
    """Per-molecule pKa prediction."""

    smiles: str  # canonical SMILES
    sites: tuple[MicroPka, ...]
    ionisation_class: IonisationClass
    provenance: str
    backend: str
    low_confidence: bool
    notes: tuple[str, ...] = ()

    def fraction_ionised(self, ph: float = PLASMA_PH) -> dict[int, float]:
        """Per-site charged fraction at ``ph`` (keyed by position in ``sites``)."""
        return {i: s.ionised_fraction(ph) for i, s in enumerate(self.sites)}

    def net_charge(self, ph: float = PLASMA_PH) -> float:
        """Expected net charge at ``ph`` (bases +, acids -)."""
        total = 0.0
        for s in self.sites:
            f = s.ionised_fraction(ph)
            total += f if s.site_type is SiteType.BASE else -f
        return total


def _module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _strict_pka() -> bool:
    """Whether the coarse heuristic is refused in the auto path (default: yes).

    Set ``STRICT_PKA=0`` (or false/no/off) to permit the heuristic fallback.
    Mirrors the pk_ivive ``STRICT_ML`` gate.
    """
    val = os.environ.get("STRICT_PKA")
    if val is None:
        return True
    return val.strip().lower() not in ("0", "false", "no", "off")


def canonical_smiles(smiles: str) -> str:
    """RDKit canonical SMILES; raises ``ValueError`` on an unparseable input."""
    from rdkit import Chem

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"invalid SMILES: {smiles!r}")
    return Chem.MolToSmiles(mol)


def classify(sites: tuple[MicroPka, ...] | list[MicroPka]) -> IonisationClass:
    """Classify a molecule from its ionisable sites (Rodgers & Rowland classes)."""
    lo, hi = _IONISABLE_WINDOW
    acids = [s for s in sites if s.site_type is SiteType.ACID and lo <= s.pka <= hi]
    bases = [s for s in sites if s.site_type is SiteType.BASE and lo <= s.pka <= hi]
    if not acids and not bases:
        return IonisationClass.NEUTRAL
    if acids and not bases:
        return IonisationClass.ACID
    if bases and not acids:
        return IonisationClass.BASE
    # Both present: zwitterion if an acid and a base are BOTH ionised at plasma
    # pH (acid pKa <= 7.4 <= base pKa); otherwise an ampholyte.
    if any(a.pka <= PLASMA_PH for a in acids) and any(b.pka >= PLASMA_PH for b in bases):
        return IonisationClass.ZWITTERION
    return IonisationClass.AMPHOLYTE


# --------------------------------------------------------------------------- #
# Backends
# --------------------------------------------------------------------------- #
class PkaBackend:
    """A pKa predictor behind a common interface.

    ``trusted`` marks a validated predictor (QupKake / pkasolver). The coarse
    heuristic is untrusted and is only used when a caller explicitly opts in
    (see :meth:`PkaPredictor.predict`), mirroring the pk_ivive no-fallback /
    ``STRICT_ML`` contract.
    """

    name: str = "abstract"
    provenance: Provenance = Provenance.HEURISTIC
    trusted: bool = False

    def is_available(self) -> bool:  # pragma: no cover - trivial
        raise NotImplementedError

    def predict_sites(self, canonical_smi: str) -> list[MicroPka]:
        raise NotImplementedError


class QupKakeBackend(PkaBackend):
    """QupKake (GNN + GFN2-xTB) — primary backend.

    Requires the ``qupkake`` package (PyPI) *and* the ``xtb`` binary on PATH
    (conda-forge: ``conda install -c conda-forge xtb``). When both are present,
    ``predict_sites`` runs QupKake's micro-pKa prediction; otherwise it is
    reported unavailable and the predictor falls through to the next backend.
    """

    name = "qupkake"
    provenance = Provenance.QUPKAKE
    trusted = True

    def is_available(self) -> bool:
        return _module_available("qupkake") and shutil.which("xtb") is not None

    def predict_sites(self, canonical_smi: str) -> list[MicroPka]:
        if not self.is_available():
            raise PkaBackendUnavailable(
                "QupKake unavailable: needs the 'qupkake' package and the 'xtb' "
                "binary (conda-forge). Falling back to another backend."
            )
        # Real integration (exercised only where the QM stack is installed).
        # QupKake predicts per-site micro-pKa with an acid/base label; map those
        # onto MicroPka. Guarded so an API drift surfaces as a clear error rather
        # than a wrong number.
        try:  # pragma: no cover - requires xtb + qupkake, absent in this env
            from qupkake.predict import predict_smiles  # type: ignore

            records = predict_smiles(canonical_smi)
            sites: list[MicroPka] = []
            for rec in records:
                stype = (
                    SiteType.ACID if str(rec["type"]).lower().startswith("acid") else SiteType.BASE
                )
                sites.append(
                    MicroPka(
                        pka=float(rec["pka"]),
                        site_type=stype,
                        atom_index=rec.get("atom_index"),
                        label="qupkake",
                    )
                )
            return sites
        except Exception as exc:  # pragma: no cover
            raise PkaPredictionError(f"QupKake failed on {canonical_smi!r}: {exc}") from exc


class PkasolverBackend(PkaBackend):
    """pkasolver (pure GNN) — fallback backend.

    Requires the ``pkasolver`` package (currently GitHub: ``mayrf/pkasolver``;
    not on PyPI). When present, ``predict_sites`` runs pkasolver's microstate
    enumeration; otherwise it is reported unavailable.
    """

    name = "pkasolver"
    provenance = Provenance.PKASOLVER
    trusted = True

    def is_available(self) -> bool:
        return _module_available("pkasolver")

    def predict_sites(self, canonical_smi: str) -> list[MicroPka]:
        if not self.is_available():
            raise PkaBackendUnavailable(
                "pkasolver unavailable: install from github.com/mayrf/pkasolver. "
                "Falling back to another backend."
            )
        try:  # pragma: no cover - pkasolver not installable in this env
            from pkasolver.query import QueryModel, calculate_microstate_pka_values
            from rdkit import Chem

            mol = Chem.MolFromSmiles(canonical_smi)
            states = calculate_microstate_pka_values(mol, query_model=QueryModel())
            sites: list[MicroPka] = []
            for st in states:
                # pkasolver reports the pKa of a protonation step and which atom
                # (de)protonates; a step that removes a proton is acidic.
                stype = SiteType.ACID if getattr(st, "is_acid", True) else SiteType.BASE
                sites.append(
                    MicroPka(
                        pka=float(st.pka),
                        site_type=stype,
                        atom_index=getattr(st, "atom_idx", None),
                        label="pkasolver",
                    )
                )
            return sites
        except Exception as exc:  # pragma: no cover
            raise PkaPredictionError(f"pkasolver failed on {canonical_smi!r}: {exc}") from exc


# Group-contribution table for the heuristic backend. Representative aqueous
# pKa (25 C) per functional group; sources: CRC Handbook of Chemistry & Physics;
# Perrin D.D. (1965) "Dissociation Constants of Organic Bases in Aqueous
# Solution". These are GROUP means — substituent effects are not modelled, so
# the heuristic is deliberately coarse and its results are flagged.
# Each rule: (label, SMARTS, representative_pKa, SiteType). Order matters:
# stronger/more-specific groups first so a matched atom is not double-counted.
_HEURISTIC_RULES: tuple[tuple[str, str, float, SiteType], ...] = (
    ("sulfonic_acid", "[SX4](=O)(=O)[OX2H1]", 1.0, SiteType.ACID),
    ("carboxylic_acid", "[CX3](=O)[OX2H1]", 4.5, SiteType.ACID),
    # Acidic C-H flanked by two carbonyls (e.g. phenylbutazone's pyrazolidine-3,5-
    # dione methine). Restricted to a monosubstituted CH (H1): the 5,5-disubstituted
    # barbiturate carbon is quaternary (H0) and does NOT match, so barbiturates keep
    # their (correct) weakly-acidic/neutral handling.
    ("active_methine_dicarbonyl", "[CX4;H1]([CX3]=[OX1])[CX3]=[OX1]", 4.5, SiteType.ACID),
    ("tetrazole", "c1nnn[nH]1", 4.9, SiteType.ACID),
    ("phenol", "[c][OX2H1]", 10.0, SiteType.ACID),
    ("thiol", "[#6][SX2H1]", 8.3, SiteType.ACID),
    ("guanidine", "[NX3][CX3](=[NX2])[NX3]", 12.5, SiteType.BASE),
    ("amidine", "[NX3][CX3]=[NX2]", 11.5, SiteType.BASE),
    # Aniline: aromatic-N base, but exclude amide/imide N (N adjacent to C=O, e.g.
    # phenylbutazone's ring nitrogens, acetanilides) which are not basic.
    ("aniline", "[NX3;H2,H1,H0;$(N[c]);!$(NC=O)]", 4.6, SiteType.BASE),
    ("pyridine", "[nX2r6]", 5.2, SiteType.BASE),
    ("imidazole", "[nX2r5]", 7.0, SiteType.BASE),
    # Aliphatic amine, excluding amides/anilines/nitro etc.
    ("aliphatic_amine", "[NX3;!$(N=*);!$(N[a]);!$(NC=O);!$(N~[!#6;!#1])]", 10.5, SiteType.BASE),
)


class HeuristicBackend(PkaBackend):
    """RDKit SMARTS group-contribution fallback. Always available (RDKit only).

    A coarse baseline for when neither QupKake nor pkasolver is installed. It
    assigns each matched functional group its representative group pKa; it does
    NOT model substituent effects, so treat it as a rough estimate.
    """

    name = "heuristic"
    provenance = Provenance.HEURISTIC

    def is_available(self) -> bool:
        return _module_available("rdkit")

    def predict_sites(self, canonical_smi: str) -> list[MicroPka]:
        from rdkit import Chem

        mol = Chem.MolFromSmiles(canonical_smi)
        if mol is None:
            raise PkaPredictionError(f"RDKit could not parse {canonical_smi!r}")
        claimed: set[int] = set()
        sites: list[MicroPka] = []
        for label, smarts, pka, stype in _HEURISTIC_RULES:
            patt = Chem.MolFromSmarts(smarts)
            if patt is None:
                continue
            for match in mol.GetSubstructMatches(patt):
                centre = match[0]  # the acidic/basic atom is the first in each SMARTS
                if centre in claimed:
                    continue
                claimed.add(centre)
                sites.append(MicroPka(pka=pka, site_type=stype, atom_index=centre, label=label))
        return sites


# Default preference order: best predictor first, heuristic last.
def default_backends() -> list[PkaBackend]:
    return [QupKakeBackend(), PkasolverBackend(), HeuristicBackend()]


# --------------------------------------------------------------------------- #
# Orchestrator
# --------------------------------------------------------------------------- #
class PkaPredictor:
    """Selects a backend, caches per canonical SMILES, applies the contract."""

    def __init__(self, backends: list[PkaBackend] | None = None) -> None:
        self._backends = backends if backends is not None else default_backends()
        self._cache: dict[tuple[str, str], PkaResult] = {}
        self.hits = 0
        self.misses = 0

    def available_backends(self) -> list[str]:
        return [b.name for b in self._backends if b.is_available()]

    def _select(self, force: str | None, allow_heuristic: bool) -> PkaBackend:
        if force is not None:
            # Naming a backend is itself an explicit opt-in, so a forced
            # heuristic does not additionally require allow_heuristic.
            for b in self._backends:
                if b.name == force:
                    if not b.is_available():
                        raise PkaBackendUnavailable(f"backend {force!r} is not available")
                    return b
            raise KeyError(f"unknown backend {force!r}; known: {[b.name for b in self._backends]}")
        # Auto path: prefer a trusted (validated) backend.
        for b in self._backends:
            if b.trusted and b.is_available():
                return b
        # No validated predictor. Only fall to the coarse heuristic on opt-in.
        heuristic = next((b for b in self._backends if not b.trusted and b.is_available()), None)
        if heuristic is not None and allow_heuristic:
            return heuristic
        raise PkaBackendUnavailable(
            "no validated pKa predictor is available (QupKake needs the xtb binary; "
            "pkasolver is not installed). Supply a measured pKa via measured_sites, "
            "install the QM/ML stack, or opt into the coarse heuristic with "
            "allow_heuristic=True (or STRICT_PKA=0)."
        )

    def predict(
        self,
        smiles: str,
        *,
        measured_sites: list[MicroPka] | None = None,
        backend: str | None = None,
        allow_heuristic: bool | None = None,
    ) -> PkaResult:
        """Predict (or accept a measured) pKa for ``smiles``.

        ``measured_sites`` bypasses prediction entirely (provenance
        ``"measured"``, trusted, not cached). ``backend`` forces a specific
        backend. Otherwise the first available *validated* backend (QupKake,
        then pkasolver) is used; if none is installed the call **refuses** rather
        than silently returning the coarse heuristic — unless ``allow_heuristic``
        is True (defaulting from the ``STRICT_PKA`` env var; strict by default).
        """
        canonical = canonical_smiles(smiles)

        if measured_sites is not None:
            if not measured_sites:
                raise ValueError("measured_sites was provided but empty")
            sites = tuple(measured_sites)
            return PkaResult(
                smiles=canonical,
                sites=sites,
                ionisation_class=classify(sites),
                provenance=Provenance.MEASURED.value,
                backend="measured",
                low_confidence=False,  # a measured value is trusted
                notes=("measured override — prediction bypassed",),
            )

        allow = (not _strict_pka()) if allow_heuristic is None else allow_heuristic
        chosen = self._select(backend, allow_heuristic=allow)
        key = (canonical, chosen.name)
        cached = self._cache.get(key)
        if cached is not None:
            self.hits += 1
            return cached

        self.misses += 1
        sites = tuple(chosen.predict_sites(canonical))
        lo, hi = LOW_CONFIDENCE_PKA_RANGE
        sensitive = [s for s in sites if lo <= s.pka <= hi]
        notes: list[str] = []
        if sensitive:
            notes.append(
                "low confidence: predicted pKa in [6, 8] — fraction ionised at "
                "pH 7.4 is highly sensitive to pKa error"
            )
        if chosen.provenance is Provenance.HEURISTIC:
            notes.append("heuristic backend — coarse group-contribution estimate")
        result = PkaResult(
            smiles=canonical,
            sites=sites,
            ionisation_class=classify(sites),
            provenance=chosen.provenance.value,
            backend=chosen.name,
            low_confidence=bool(sensitive),
            notes=tuple(notes),
        )
        self._cache[key] = result
        return result


_DEFAULT_PREDICTOR: PkaPredictor | None = None


def default_predictor() -> PkaPredictor:
    """Process-wide cached predictor (so the SMILES cache is shared)."""
    global _DEFAULT_PREDICTOR
    if _DEFAULT_PREDICTOR is None:
        _DEFAULT_PREDICTOR = PkaPredictor()
    return _DEFAULT_PREDICTOR


def predict_pka(
    smiles: str,
    *,
    measured_sites: list[MicroPka] | None = None,
    backend: str | None = None,
    allow_heuristic: bool | None = None,
) -> PkaResult:
    """Convenience wrapper over :func:`default_predictor`."""
    return default_predictor().predict(
        smiles,
        measured_sites=measured_sites,
        backend=backend,
        allow_heuristic=allow_heuristic,
    )


# --------------------------------------------------------------------------- #
# Public benchmark set + harness (S1-T3a acceptance: report RMSE).
#
# A small public monoprotic reference set. Literature aqueous pKa (25 C) from the
# CRC Handbook of Chemistry & Physics and Perrin (1965); these overlap the kinds
# of compounds in the SAMPL6/7 pKa challenges and the JCIM public benchmark. Each
# entry is (name, SMILES, experimental_pKa, expected SiteType).
# --------------------------------------------------------------------------- #
BENCHMARK_SET: tuple[tuple[str, str, float, SiteType], ...] = (
    ("formic_acid", "OC=O", 3.75, SiteType.ACID),
    ("acetic_acid", "CC(=O)O", 4.76, SiteType.ACID),
    ("propionic_acid", "CCC(=O)O", 4.87, SiteType.ACID),
    ("benzoic_acid", "OC(=O)c1ccccc1", 4.20, SiteType.ACID),
    ("phenol", "Oc1ccccc1", 9.99, SiteType.ACID),
    ("p_cresol", "Cc1ccc(O)cc1", 10.26, SiteType.ACID),
    ("thiophenol", "Sc1ccccc1", 6.62, SiteType.ACID),
    ("methylamine", "CN", 10.66, SiteType.BASE),
    ("ethylamine", "CCN", 10.70, SiteType.BASE),
    ("trimethylamine", "CN(C)C", 9.80, SiteType.BASE),
    ("piperidine", "C1CCNCC1", 11.12, SiteType.BASE),
    ("morpholine", "C1COCCN1", 8.36, SiteType.BASE),
    ("aniline", "Nc1ccccc1", 4.60, SiteType.BASE),
    ("pyridine", "c1ccncc1", 5.23, SiteType.BASE),
    ("imidazole", "c1c[nH]cn1", 6.95, SiteType.BASE),
)


@dataclass(frozen=True)
class BenchmarkResult:
    backend: str
    n_total: int
    n_covered: int  # compounds for which the backend returned a matching site
    rmse: float | None  # over the covered compounds; None if none covered
    mae: float | None
    per_compound: tuple[tuple[str, float, float | None], ...] = field(default_factory=tuple)


def _nearest_site_pka(
    sites: tuple[MicroPka, ...], expected_type: SiteType, expected: float
) -> float | None:
    same = [s.pka for s in sites if s.site_type is expected_type]
    if not same:
        return None
    return min(same, key=lambda p: abs(p - expected))


def benchmark(
    predictor: PkaPredictor | None = None,
    dataset: tuple[tuple[str, str, float, SiteType], ...] = BENCHMARK_SET,
    backend: str | None = None,
) -> BenchmarkResult:
    """Run the active backend over ``dataset`` and report RMSE/MAE.

    For each monoprotic reference compound, the predicted micro-pKa of the
    expected ionisation type nearest the experimental value is compared. Reports
    coverage (how many compounds the backend returned a matching site for) so a
    partial predictor is not silently flattered. Benchmarking the fallback is an
    explicit action, so the heuristic is permitted here (``allow_heuristic``).
    """
    pred = predictor if predictor is not None else default_predictor()
    used = backend or (pred.available_backends() or ["<none>"])[0]
    errors: list[float] = []
    per: list[tuple[str, float, float | None]] = []
    for name, smi, exp, stype in dataset:
        result = pred.predict(smi, backend=backend, allow_heuristic=True)
        got = _nearest_site_pka(result.sites, stype, exp)
        per.append((name, exp, got))
        if got is not None:
            errors.append(got - exp)
    if errors:
        rmse = math.sqrt(sum(e * e for e in errors) / len(errors))
        mae = sum(abs(e) for e in errors) / len(errors)
    else:
        rmse = mae = None
    return BenchmarkResult(
        backend=used,
        n_total=len(dataset),
        n_covered=len(errors),
        rmse=rmse,
        mae=mae,
        per_compound=tuple(per),
    )


__all__ = [
    "PLASMA_PH",
    "LOW_CONFIDENCE_PKA_RANGE",
    "SiteType",
    "IonisationClass",
    "Provenance",
    "PkaBackendUnavailable",
    "PkaPredictionError",
    "MicroPka",
    "PkaResult",
    "canonical_smiles",
    "classify",
    "PkaBackend",
    "QupKakeBackend",
    "PkasolverBackend",
    "HeuristicBackend",
    "default_backends",
    "PkaPredictor",
    "default_predictor",
    "predict_pka",
    "BENCHMARK_SET",
    "BenchmarkResult",
    "benchmark",
]
