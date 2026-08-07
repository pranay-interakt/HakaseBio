"""Peptide property engine.

Re-exports the peptide-native surface. The generic amino-acid science these
build on lives in the `hakase_sequence` platform substrate, so antibody (and any
future sequence modality) can use it without importing this package.
"""

from .properties import *  # noqa: F401,F403 — public surface is defined by properties.py
