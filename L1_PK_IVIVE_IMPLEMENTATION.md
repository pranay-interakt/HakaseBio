# L1 Quantitative PK (IVIVE) — Implementation Note

**Date:** 2026-06-25
**Workstream:** A1 (quantitative human PK by IVIVE) from the L1 enhancement plan.
**Status:** Shipped, typechecked (frontend + api-server `tsc --noEmit` clean), unit-tested against literature.

---

## What was built

A real, deterministic **in-vitro → in-vivo extrapolation (IVIVE)** engine that turns the
L1 ADMET endpoints into quantitative human PK — hepatic clearance, hepatic
extraction / first-pass availability, steady-state volume, half-life, and an
assumption-free IV concentration–time curve. This is the same well-stirred-liver
methodology that underpins Simcyp/GastroPlus first-in-human work, implemented over
the platform's existing open inputs.

It is wired into the L1 layer as a **WATCH-only readout** (the user-selected
integration): it can raise monitor-level flags but never a hard veto, and it does
**not** feed the MPO composite — so the calibrated thresholds are unchanged.

## The no-fallback / no-fake contract (enforced, not aspirational)

Every number that drives a PK output is a **real input** — either an ADMET-AI ML
prediction (provenance `ml`) or a user-supplied **measured** value (provenance
`measured`). There is **no heuristic substitution**:

- The hepatic-clearance block strictly requires **CLint** (`Clearance_Hepatocyte_AZ`)
  and **fu** (from `PPBR_AZ`). If either is absent, the engine returns
  `source: "insufficient-input"` (HTTP 422) with a `missing` list — it never
  computes on a guessed value.
- Half-life / C-t curve additionally require **VDss** (`VDss_Lombardo`); when it is
  absent, clearance is still returned but those blocks are flagged unavailable —
  never faked.
- `fu = 0` (≈100% bound) → `insufficient-input` rather than an infinite half-life.
- Physiological **system** constants (hepatic blood flow, hepatocellularity, liver
  weight, body weight, blood:plasma ratio) are named, **cited** reference values
  with provenance `reference`/`assumed` — the same reference-physiology every PBPK
  tool uses — not per-molecule guesses. The assumed ones (R_bp, body weight) are
  surfaced explicitly in every response.
- Oral curves are **omitted** rather than drawn with an assumed `ka`/`Fa·Fg`. Only
  the IV-bolus curve (fully determined by CL and Vss) is emitted.

## Validation (pure core vs literature)

The pure `compute_ivive` core was tested against the classic high-first-pass
benchmark and behaves correctly across the extraction spectrum:

| Case | Predicted | Observed (literature) |
|---|---|---|
| Propranolol-like (high extraction) | E_h 0.71, **F_h 0.29**, **t½ 3.1 h** | F ≈ 0.26, t½ ≈ 3–4 h |
| Low-extraction drug | E_h 0.06, F_h 0.94 | — (directionally correct) |
| Structural guards (CLint≤0, fu>1, fu=0) | raise / insufficient-input | — |
| Missing fu + ML offline | `insufficient-input` | — (no fallback) |
| `ml_inputs` path | provenance `ml`, no 2nd inference | — |
| measured override vs `ml_inputs` | `measured` wins | — |

All cases pass. The "ADMET-AI failed to load" lines seen when testing in an
environment without the model weights are the contract **working** — they route to
`insufficient-input`, not to a fabricated number.

## Files changed

**AI service (Python)**
- `artifacts/ai-service/models/pk_ivive.py` — **new.** Pure `compute_ivive` core +
  `predict_pk_ivive` wrapper (input precedence: measured override → caller-supplied
  `ml_inputs` → server ADMET-AI → insufficient-input). Cited constants, per-value
  provenance.
- `artifacts/ai-service/main.py` — `POST /predict/pk/ivive` endpoint + `PkIviveRequest`;
  maps `insufficient-input`→422, `input-error`→400; added to `/models/status`.

**API gateway (TypeScript)**
- `artifacts/api-server/src/routes/ai-service.ts` — `POST /ai/pk/ivive` proxy that
  forwards the AI-service status verbatim (so 422/400 reach the client unaltered).

**Frontend (TypeScript)**
- `artifacts/hakase-ai/src/lib/aiService.ts` — `predictPkIvive()` client + types;
  unwraps the 422 `insufficient-input` payload as a normal `available:false` result
  (only true 5xx throws).
- `artifacts/hakase-ai/src/lib/l1Scorecard.ts` — optional `pk` input on
  `L1ScorecardInput`; new section 13b raises WATCH/info flags (high first-pass,
  short/long t½, cross-check disagreement, model caveats). No composite contribution.
- `artifacts/hakase-ai/src/lab/pipeline.ts` — builds `ml_inputs` from the overlay's
  real ADMET-AI values (so **no second ADMET-AI inference**), calls the engine, maps
  to the scorecard `pk`, and returns the full `pk` result in `SmallMoleculeL1Result`.

## How to run / verify

```bash
# AI service (prod venv with ADMET-AI installed): endpoint is live at
#   POST /api/ai/pk/ivive   { "smiles": "...", "dose_mg": 80 }
# Returns source:"ivive" with parameters+curve, or source:"insufficient-input".

# Typecheck (both pass clean):
( cd artifacts/hakase-ai  && pnpm run typecheck )
( cd artifacts/api-server && pnpm run typecheck )
```

## Independent cross-check (built in)

The engine compares its mechanistic t½ against ADMET-AI's independent
`Half_Life_Obach` prediction and reports an agreement flag (within 3-fold). Two
independent **real** signals — agreement raises trust, disagreement raises an info
flag and is surfaced as directional. No fabrication.

## Explicitly NOT done (honest scope)

- **A2 (mechanistic-static DDI, FDA R1/R2):** not in this change. It requires a real
  measured **Ki** (from ChEMBL) per CYP; when absent it must return
  `insufficient-evidence` (no R-value invented from an inhibition probability). The
  A1 engine already emits the Cmax/[I] that A2 will consume.
- **A3 (full PK-Sim whole-body PBPK):** left as honest roadmap — it needs an external
  PK-Sim/OSP engine that cannot be run as a real model here, and stubbing it would
  violate the no-mock rule.
- **PK display panel:** the full result (parameters + IV curve + provenance) is now
  returned in `SmallMoleculeL1Result.pk`, ready for a UI panel; rendering it is a
  follow-up.
