"""gnomAD — population genetics of the target gene.

Two questions matter for a drug target and both are answered by measured
population data rather than by a model:

  constraint   How intolerant is the gene to loss of function in the general
               population? pLI and the LoF observed/expected ratio are the
               standard measures. A highly constrained gene (pLI ≥ 0.9, low
               o/e) says that losing this protein is not well tolerated in
               humans — a direct read on the safety of inhibiting it.
  variation    Which coding variants segregate, at what frequency, and what
               does ClinVar say about them? This is the pharmacogenomic
               heterogeneity a first-in-human population will actually carry.

Queried through the public gnomAD GraphQL API (no key required).
"""

from __future__ import annotations

from typing import Any

from hakase_smallmol.external._http import (
    SourceUnavailable,
    as_float,
    no_data,
    post_json,
    unavailable,
)

GNOMAD_GRAPHQL = "https://gnomad.broadinstitute.org/api"
SOURCE = "gnomAD (gnomad.broadinstitute.org)"
DEFAULT_DATASET = "gnomad_r4"

# pLI ≥ 0.9 is the gnomAD/ExAC convention for "loss-of-function intolerant".
PLI_INTOLERANT = 0.9
# LOEUF (upper bound of the LoF o/e confidence interval) < 0.35 is the gnomAD
# recommended threshold for the most constrained decile.
LOEUF_CONSTRAINED = 0.35

_GENE_QUERY = """
query GeneConstraintAndVariants($geneSymbol: String!, $dataset: DatasetId!) {
  gene(gene_symbol: $geneSymbol, reference_genome: GRCh38) {
    gene_id
    symbol
    name
    chrom
    gnomad_constraint {
      exp_lof
      obs_lof
      oe_lof
      oe_lof_lower
      oe_lof_upper
      pLI
      oe_mis
      z_score_mis
    }
    variants(dataset: $dataset) {
      variant_id
      rsids
      consequence
      lof
      flags
      genome { ac an af }
      exome { ac an af }
    }
  }
}
"""


def _allele_frequency(variant: dict[str, Any]) -> float | None:
    for key in ("exome", "genome"):
        block = variant.get(key) or {}
        af = as_float(block.get("af"))
        if af is not None:
            return af
    return None


def fetch_gnomad(
    gene_symbol: str, *, dataset: str = DEFAULT_DATASET, max_variants: int = 50
) -> dict[str, Any]:
    """Constraint metrics plus the most common coding variants for a gene."""
    symbol = (gene_symbol or "").strip().upper()
    if not symbol:
        return no_data(SOURCE, "No gene symbol was resolved upstream, so gnomAD cannot be queried.")

    try:
        payload = post_json(
            GNOMAD_GRAPHQL,
            {"query": _GENE_QUERY, "variables": {"geneSymbol": symbol, "dataset": dataset}},
            timeout=30.0,
        )
    except SourceUnavailable as exc:
        return unavailable(SOURCE, str(exc), gene_symbol=symbol)

    errors = payload.get("errors") or []
    gene = (payload.get("data") or {}).get("gene")
    if not gene:
        reason = (errors[0] or {}).get("message") if errors else None
        return no_data(
            SOURCE,
            reason or f"gnomAD has no GRCh38 gene record for {symbol!r}.",
            gene_symbol=symbol,
        )

    constraint = gene.get("gnomad_constraint") or {}
    pli = as_float(constraint.get("pLI"))
    oe_lof = as_float(constraint.get("oe_lof"))
    loeuf = as_float(constraint.get("oe_lof_upper"))

    raw_variants = gene.get("variants") or []
    rows: list[dict[str, Any]] = []
    for variant in raw_variants:
        consequence = variant.get("consequence") or ""
        af = _allele_frequency(variant)
        rows.append(
            {
                "variant_id": variant.get("variant_id"),
                "rsid": (variant.get("rsids") or [None])[0],
                "consequence": consequence,
                "allele_frequency": af,
                "is_loss_of_function": variant.get("lof") == "HC",
                "is_missense": "missense" in consequence,
                "flags": variant.get("flags") or [],
            }
        )
    rows.sort(key=lambda r: (r["allele_frequency"] or 0.0), reverse=True)
    top = rows[:max_variants]

    lof_total = sum(1 for r in rows if r["is_loss_of_function"])
    missense_total = sum(1 for r in rows if r["is_missense"])

    if pli is None and loeuf is None:
        constraint_call = "not_available"
        constraint_note = (
            "gnomAD publishes no constraint metrics for this gene (typically because it is "
            "short or has low coverage), so LoF tolerance is unresolved."
        )
    elif (pli is not None and pli >= PLI_INTOLERANT) or (
        loeuf is not None and loeuf < LOEUF_CONSTRAINED
    ):
        constraint_call = "loss_of_function_intolerant"
        constraint_note = (
            "The gene is loss-of-function intolerant in the general population. Complete "
            "pharmacological inhibition mimics loss of function, so on-target toxicity is a "
            "live hypothesis and the therapeutic index should be argued explicitly."
        )
    else:
        constraint_call = "loss_of_function_tolerant"
        constraint_note = (
            "Loss-of-function variation is observed at close to the expected rate, so humans "
            "carrying reduced function of this gene exist in the population — supportive, "
            "though not proof, of on-target tolerability."
        )

    return {
        "status": "live",
        "source": SOURCE,
        "dataset": dataset,
        "gene_symbol": gene.get("symbol") or symbol,
        "gene_id": gene.get("gene_id"),
        "gene_name": gene.get("name"),
        "chromosome": gene.get("chrom"),
        "constraint": {
            "pLI": pli,
            "oe_lof": oe_lof,
            "oe_lof_lower": as_float(constraint.get("oe_lof_lower")),
            "loeuf": loeuf,
            "observed_lof": constraint.get("obs_lof"),
            "expected_lof": as_float(constraint.get("exp_lof")),
            "oe_missense": as_float(constraint.get("oe_mis")),
            "missense_z": as_float(constraint.get("z_score_mis")),
            "call": constraint_call,
            "note": constraint_note,
            "thresholds": {"pLI_intolerant": PLI_INTOLERANT, "loeuf_constrained": LOEUF_CONSTRAINED},
        },
        "variants": top,
        "n_variants_returned": len(top),
        "n_variants_total": len(rows),
        "n_loss_of_function": lof_total,
        "n_missense": missense_total,
        "url": f"https://gnomad.broadinstitute.org/gene/{gene.get('gene_id') or symbol}",
        "limitations": (
            "Constraint is a population-genetics measure of gene essentiality, not a "
            "pharmacological prediction. It speaks to complete, lifelong loss of function; a "
            "reversible, partial, time-limited pharmacological block is a weaker perturbation."
        ),
        "provenance": "measured (population sequencing)",
    }


__all__ = ["LOEUF_CONSTRAINED", "PLI_INTOLERANT", "fetch_gnomad"]
