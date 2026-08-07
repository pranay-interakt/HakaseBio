"""Layer 4 — First-in-Human Translation Engine.

Takes a completed L3 virtual preclinical study and answers the question a
clinical pharmacologist asks next: what is the safe starting dose in humans,
what exposure will it produce, how should the dose escalate, and what margin
separates the clinic from the animal point of departure.

Design contract (inherited from L1/L2/L3, non-negotiable):
  • No fabricated / hard-coded / LLM-generated scientific numbers. A quantity is
    either produced by a validated model, a published regulatory calculation, an
    open engine, or a public dataset — or it is returned as a typed
    ``not_predicted`` / ``available=False`` with a reason.
  • Every output block carries {model, confidence, limitations, provenance}.
  • The browser renders; it never computes science ("display-only" contract).

The regulatory backbone is explicit and cited in each engine:
  • FDA (2005) Estimating the Maximum Safe Starting Dose in Initial Clinical
    Trials for Therapeutics in Adult Healthy Volunteers — HED by body-surface-
    area (km) conversion, safety factor, MRSD, and the pharmacologically active
    dose check.
  • EMA/CHMP/SWP/28367/07 Rev.1 (2017) Strategies to Identify and Mitigate Risks
    for First-in-Human and Early Clinical Trials — MABEL, the exposure-based
    approach, sentinel dosing, and stopping rules.
  • ICH M3(R2) — nonclinical safety studies for the conduct of human clinical
    trials.
"""

from __future__ import annotations

SCHEMA_VERSION = "hakase.small-molecule.l4.first-in-human.v1"

__all__ = ["SCHEMA_VERSION"]
