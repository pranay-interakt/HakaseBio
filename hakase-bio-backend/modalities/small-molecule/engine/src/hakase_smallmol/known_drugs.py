"""DEPRECATED — hardcoded known-drug table removed.

This file used to vendor 46 hand-curated drug records with measured ADMET
liabilities. That was the wrong architecture: a hand-typed table can never
be authoritative, and any value in it is by definition a hardcoded answer
that the user can't audit against a primary source.

The replacement lives at `models/drug_lookup.py` and queries live public
APIs only:

  - ChEMBL    (https://www.ebi.ac.uk/chembl/api/data/) — bioactivity + ADMET
  - PubChem   (https://pubchem.ncbi.nlm.nih.gov/rest/pug/) — chemistry + names
  - DrugCentral (https://drugcentral.org/) — FDA-approved drug metadata
  - DILIrank  (FDA CSV download) — DILI severity classifications
  - UniProt   (already wired) — target sequence & PDB cross-refs

When no live source returns a hit, the lookup returns None and the L1
pipeline falls through to the properly-trained ML stack (Hakase ADMET Chemprop,
BindingDB-pretrained DTA). When the ML stack is also unavailable, the
endpoint value is null + a "no model available" envelope. NEVER a fake
number.

This file is kept so existing imports compile during the rollout; it is
removed in the next cleanup pass.
"""

from __future__ import annotations

# Empty list preserved so legacy `from data.known_drugs import KNOWN_DRUGS`
# imports don't crash during the rollout. Anything that consumes this list
# will simply see no entries — which is the correct behaviour: no hardcoded
# data anywhere.
KNOWN_DRUGS: list = []
KnownDrug = dict  # type alias retained for legacy type hints
