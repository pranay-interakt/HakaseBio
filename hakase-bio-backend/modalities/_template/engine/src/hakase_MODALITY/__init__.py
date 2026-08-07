"""Engine for this modality.

Depend on ``hakase_kernel`` plus whichever substrates you need:
``hakase_chemistry`` (SMILES), ``hakase_sequence`` (amino acids),
``hakase_structure`` (3D).

Never import another modality. If you need something a sibling already has,
promote it into a platform substrate — that is exactly what
``platform/sequence/`` exists for, and ``scripts/check_boundaries.py`` will
fail the build otherwise.
"""
