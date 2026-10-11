"""Clients for external scientific databases.

Every client returns a :class:`~hos.data_sources.base.SourceResult` with an explicit
status. A network failure, a rate limit or an unknown identifier yields a result whose
status says so and whose values are UNAVAILABLE; a client never substitutes a default.
Values retrieved from a database carry LITERATURE provenance with the source URL,
record id and original retrieval time (kept when served from cache).
"""

from hos.data_sources.base import SourceResult, SourceStatus
from hos.data_sources.chembl import ChEMBLClient
from hos.data_sources.http import CachedHttp
from hos.data_sources.pubchem import PubChemClient

__all__ = ["CachedHttp", "ChEMBLClient", "PubChemClient", "SourceResult", "SourceStatus"]
