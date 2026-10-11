# UniProtKB responses (test fixtures)

Captured 2026-10-11 from the UniProt REST API, unmodified:

| file | URL | SHA-256 |
|---|---|---|
| P01308.json | https://rest.uniprot.org/uniprotkb/P01308.json?fields=accession,protein_name,sequence | f3115021cf41086969c8057dc5534e993c8dfa93ab26cd22f5bd59eb0b876ba4 |
| P01275.json | https://rest.uniprot.org/uniprotkb/P01275.json?fields=accession,protein_name,sequence | 37824df14906e5e366c6fc5d4a2972f66fe6ba375b0d3b3706e914767dbba7dd |

Used as known values for the average-mass method (`seq.average_mass`): UniProt states the sequence and
its molecular weight in daltons (rounded to an integer). UniProt data are CC BY 4.0.
