"""Variable taxonomy & extraction (doc 05 ch.5–7).

A Variable is a single named quantity drawn from an Evidence Object. Each
VariableSpec knows where to find its raw value (evidence type + dotted path) and
how to normalize it to a [0,1] "favorability" score using a documented,
literature-anchored transform. Normalization thresholds are inspectable
configuration — not hidden coefficients — and each carries a reference.

Normalization convention: higher normalized value = more favorable for the
axis the variable speaks to (e.g. lower hemolysis probability normalizes high).
Policies decide which variables participate and how they are weighted.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..domain.evidence import EvidenceType
from ..domain.platform_evidence import PlatformEvidence


# ---- normalizers ------------------------------------------------------------
def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def linear_high_good(lo: float, hi: float) -> Callable[[float], float]:
    def f(raw: float) -> float:
        if hi == lo:
            return 1.0 if raw >= hi else 0.0
        return _clamp01((raw - lo) / (hi - lo))

    return f


def linear_low_good(good: float, bad: float) -> Callable[[float], float]:
    def f(raw: float) -> float:
        if bad == good:
            return 1.0 if raw <= good else 0.0
        return _clamp01((bad - raw) / (bad - good))

    return f


def band_good(lo: float, hi: float, soft: float) -> Callable[[float], float]:
    def f(raw: float) -> float:
        if lo <= raw <= hi:
            return 1.0
        dist = (lo - raw) if raw < lo else (raw - hi)
        return _clamp01(1.0 - dist / soft) if soft > 0 else 0.0

    return f


def prob_high_good() -> Callable[[float], float]:
    return lambda raw: _clamp01(float(raw))


def prob_low_good() -> Callable[[float], float]:
    return lambda raw: _clamp01(1.0 - float(raw))


def categorical(mapping: dict[str, float]) -> Callable[[Any], float]:
    def f(raw: Any) -> float:
        return _clamp01(mapping.get(str(raw), 0.5))

    return f


@dataclass(frozen=True)
class VariableSpec:
    name: str
    domain: EvidenceType
    path: str  # dotted path within the payload
    normalizer: Callable[[Any], float]
    default_class: str  # "soft" | "hard" | "supporting"
    higher_is_better_raw: bool | None  # documentation of raw direction
    reference: str
    description: str = ""

    def extract_raw(self, payload: dict[str, Any]) -> Any:
        cur: Any = payload
        for part in self.path.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return None
        return cur


# ---- registry ---------------------------------------------------------------
def _registry() -> dict[str, VariableSpec]:
    P = EvidenceType.PHYSICOCHEMICAL
    S = EvidenceType.STRUCTURAL
    F = EvidenceType.FUNCTIONAL
    D = EvidenceType.DEVELOPABILITY
    SF = EvidenceType.SAFETY
    specs = [
        # Physicochemical (mostly supporting / band-shaped)
        VariableSpec(
            "net_charge_pH7",
            P,
            "physicochemical.net_charge_pH7",
            band_good(2.0, 7.0, 6.0),
            "soft",
            None,
            "Yeaman & Yount 2003 Pharmacol Rev 55:27 (cationicity of AMPs)",
            "Net charge at pH 7.4; +2..+7 favourable for cationic AMP activity.",
        ),
        VariableSpec(
            "instability_index",
            P,
            "physicochemical.instability_index",
            linear_low_good(40.0, 70.0),
            "soft",
            False,
            "Guruprasad 1990 Protein Eng 4:155",
            "Guruprasad instability index; <40 predicts a stable peptide.",
        ),
        VariableSpec(
            "hydrophobic_moment",
            P,
            "physicochemical.hydrophobic_moment",
            linear_high_good(0.3, 1.0),
            "supporting",
            True,
            "Eisenberg 1984 J Mol Biol 179:125",
            "Amphipathicity; higher supports membrane-active helices.",
        ),
        # Structural
        VariableSpec(
            "mean_plddt",
            S,
            "geometry.mean_plddt",
            linear_high_good(50.0, 90.0),
            "soft",
            True,
            "Lin 2023 Science 379:1123 (ESMFold pLDDT)",
            "Mean per-residue pLDDT; structural-model confidence.",
        ),
        # Functional
        VariableSpec(
            "amp_probability",
            F,
            "antimicrobial.probability",
            prob_high_good(),
            "soft",
            True,
            "CAMP v3.0 Wang 2016 NAR 44:D1087",
            "Trained AMP-classifier probability.",
        ),
        VariableSpec(
            "cpp_probability",
            F,
            "cell_permeability.probability",
            prob_high_good(),
            "soft",
            True,
            "CPPsite 2.0 Gautam 2015 Database 2015:bav007",
            "Trained CPP-classifier probability.",
        ),
        VariableSpec(
            "receptor_engagement_score",
            F,
            "receptor_engagement.receptor_engagement_score",
            linear_high_good(0.0, 8.0),
            "soft",
            True,
            "Boman 2003 J Intern Med 254:197",
            "Boman-index-based receptor engagement (0..8).",
        ),
        # Developability
        VariableSpec(
            "camsol_score",
            D,
            "solubility.camsol_score",
            linear_high_good(-0.45, 0.45),
            "soft",
            True,
            "Sormanni 2015 J Mol Biol 427:478 (CamSol)",
            "CamSol intrinsic solubility; >0.45 highly soluble, <-0.45 poor.",
        ),
        VariableSpec(
            "aggregation_mean_a3v",
            D,
            "aggregation.mean_a3v",
            linear_low_good(-0.02, 0.10),
            "soft",
            False,
            "Conchillo-Sole 2007 BMC Bioinformatics 8:65 (AGGRESCAN)",
            "Mean AGGRESCAN a3v; higher => aggregation-prone.",
        ),
        VariableSpec(
            "synthesis_difficulty",
            D,
            "synthesis.difficulty_score",
            linear_low_good(2.0, 8.0),
            "supporting",
            False,
            "SPPS feasibility triage",
            "SPPS difficulty score; lower is easier to manufacture.",
        ),
        # Safety
        VariableSpec(
            "hemolysis_probability",
            SF,
            "hemolysis.probability",
            prob_low_good(),
            "soft",
            False,
            "HemoPI-2 Chaudhary 2016 Biomed Res Int 2016:8525987",
            "Trained hemolysis-classifier probability; lower is safer.",
        ),
        VariableSpec(
            "immunogenicity_band",
            SF,
            "immunogenicity.band",
            categorical({"Low": 1.0, "Moderate": 0.5, "High": 0.0}),
            "soft",
            False,
            "IEDB MHC-II motifs",
            "Sequence-based immunogenicity band.",
        ),
        VariableSpec(
            "chemical_liabilities_high",
            SF,
            "chemical_liabilities.n_high",
            linear_low_good(0.0, 3.0),
            "supporting",
            False,
            "reactive-motif scan",
            "Count of high-severity chemical liabilities; fewer is safer.",
        ),
    ]
    return {s.name: s for s in specs}


VARIABLE_REGISTRY: dict[str, VariableSpec] = _registry()


@dataclass(frozen=True)
class ExtractedVariable:
    name: str
    domain: str
    raw: Any
    normalized: float | None
    present: bool
    reference: str


def extract_variables(
    platform_evidence: PlatformEvidence, names: list[str]
) -> dict[str, ExtractedVariable]:
    """Pull and normalize the named variables from the platform evidence.

    A variable whose evidence is unavailable or whose raw value is missing/
    non-numeric is returned with ``present=False`` and ``normalized=None`` — it
    is treated as missing downstream, never defaulted to a fabricated value.
    """
    out: dict[str, ExtractedVariable] = {}
    for name in names:
        spec = VARIABLE_REGISTRY.get(name)
        if spec is None:
            raise KeyError(f"Unknown variable '{name}'.")
        ev = platform_evidence.get(spec.domain)
        raw = None
        normalized = None
        present = False
        if ev is not None and ev.is_available:
            raw = spec.extract_raw(ev.scientific_payload)
            if raw is not None:
                try:
                    normalized = float(spec.normalizer(raw))
                    present = True
                except (TypeError, ValueError):
                    normalized = None
                    present = False
        out[name] = ExtractedVariable(
            name=name,
            domain=spec.domain.value,
            raw=raw,
            normalized=normalized,
            present=present,
            reference=spec.reference,
        )
    return out
