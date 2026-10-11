"""The Hakase OS kernel.

The kernel is the small trusted core everything else runs on:

* :mod:`~hos.kernel.lifecycle`   - the study state machine (studies are managed processes)
* :mod:`~hos.kernel.ledger`      - the append-only, hash-chained provenance ledger
* :mod:`~hos.kernel.attestation` - principals, roles and the legal signature boundaries
* :mod:`~hos.kernel.execution`   - execution targets (where study work physically runs)
* :mod:`~hos.kernel.kernel`      - the kernel facade that schedules work through drivers

The kernel contains no study-type-specific science. That lives in drivers.
"""
