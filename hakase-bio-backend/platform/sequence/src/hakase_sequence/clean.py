VALID_AAS = list("ACDEFGHIKLMNPQRSTVWY")


def clean_sequence(seq: str) -> str:
    """Removes invalid amino acids from a sequence."""
    return "".join(c for c in seq.upper() if c in VALID_AAS)
