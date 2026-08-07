"""Privacy primitives for the AI service.

Backs the platform's privacy commitments with real enforcement:

  * `scrub_smiles` — structures (SMILES) are NEVER written to logs verbatim.
    Anywhere we previously logged a SMILES we now log a short, non-reversible
    SHA-256 tag (`mol:ab12cd34`) that is stable enough to correlate log lines
    for one request but cannot reconstruct the molecule.

  * `NO_STORE_HEADERS` — response headers asserting no caching / no retention,
    applied by the app middleware.

Design intent (what the marketing copy is allowed to claim, truthfully):
  * Fingerprint-only models (hERG/DILI/solubility/binding) can be driven by a
    client-computed Morgan fingerprint + descriptors — the server then never
    receives the structure. See each model's optional `features` input.
  * Graph models (ADMET-AI/Chemprop) require the molecular graph and therefore
    receive the SMILES; that structure is processed in-memory only and is never
    logged (scrubbed) and never persisted (no DB writes, no disk writes, no
    request-body logging).
"""

from __future__ import annotations

import hashlib

# Applied to every response by the app middleware.
NO_STORE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    # Explicit, auditable assertion of our data-handling posture.
    "X-Privacy-Policy": "no-retention; structures-processed-in-memory-only; not-logged",
}


def scrub_smiles(smiles: str | None) -> str:
    """Return a non-reversible short tag for a SMILES, safe to log.

    Same input → same tag within/across log lines (useful for correlation),
    but the original structure cannot be recovered from the tag.
    """
    if not smiles:
        return "mol:none"
    digest = hashlib.sha256(smiles.strip().encode("utf-8")).hexdigest()
    return f"mol:{digest[:8]}"
