"""Layer 3 — Virtual Preclinical Study Engine (Animal Cohort).

Study-level orchestration over the validated Phase-0 PBPK exposure engine
(kernel ``pbpk`` + IVIVE handoff). L3 turns a single-arm exposure simulation
into a complete *virtual preclinical study*: multiple dose groups, PK metrics,
target coverage, PK/PD, safety margins, public animal evidence, sensitivity, a
stage-gate recommendation, and a provenance-stamped scientific report.

Design contract (inherited from L1/L2, non-negotiable):
  • No fabricated / hard-coded / LLM-generated scientific numbers. A quantity is
    either produced by a validated model, a mechanistic calculation, an open
    engine, or a public dataset — or it is returned as a typed ``not_predicted``
    / ``available=False`` with a ``missing`` list and a reason.
  • Every output block carries {model, confidence, limitations, provenance}.
  • The browser renders; it never computes science ("display-only" contract).

See ``docs/animal-cohort-layer.md`` for the full architecture.
"""

from __future__ import annotations

SCHEMA_VERSION = "hakase.small-molecule.l3.animal-cohort.v1"

__all__ = ["SCHEMA_VERSION"]
