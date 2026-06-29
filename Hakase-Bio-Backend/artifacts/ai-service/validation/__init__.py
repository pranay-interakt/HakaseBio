"""Hakase L1 validation & calibration framework.

Produces the receipts a buyer asks for: verdict-level performance on a held-out
approved/withdrawn set, endpoint-level AUROC / fold-error, conformal-interval
coverage, and FPR-controlled veto thresholds — all from real predictions vs real
measured truth, never fabricated.
"""
