# Driving Claude Code to build the PBPK layer

A practical playbook for turning [`pbpk-layer.md`](pbpk-layer.md) into code with Claude Code, **one task at a time**. The spec is the source of truth; this file is how you feed it in.

## The golden rule
**One task = one Claude Code session/prompt = one branch = one commit.** Do not ask it to "build Stage 1." Ask it to build `S1-T1`, review, merge, then `S1-T2`. Small scoped diffs are reviewable; a 2000-line drop is not.

## Setup (once)
1. Open Claude Code with its working directory at `hakase-bio-backend` (the git repo; default branch `dev`).
2. Make sure the spec is present: `docs/pbpk-layer.md`. Claude Code will read it.
3. Confirm the repo `.venv` exists and `ruff`, `black`, `pytest` run.

## The per-task loop
For each task ID in Part 6 (start at S1-T1, in order):

1. **Prompt** Claude Code with the task (template below).
2. Let it **branch, implement, and run the four checks** (ruff, black, `scripts/check_boundaries.py`, pytest).
3. **Review the diff yourself** — is it scoped to just this task? Does it meet the acceptance criterion?
4. If good, let it **commit** (author `bh-yeshwanth`, no Claude trailer).
5. Merge to `dev`, then move to the next task ID.

## Master prompt template (paste, fill the two blanks)

```
Read docs/pbpk-layer.md in full — it is the authoritative spec. You are implementing
exactly ONE task from Part 6: <TASK-ID>.

Do only that task. Follow Part 7 guardrails without exception:
- Branch from dev first (never commit to dev directly).
- Use the repo's own .venv for pytest.
- Before committing, run and pass all four: ruff, black, python scripts/check_boundaries.py, pytest.
- Respect the boundary rule: platform/ must not import modalities/; no RDKit/SMILES in platform/.
- Commit as author bh-yeshwanth with NO "Co-Authored-By: Claude" trailer.

Scope limits: do NOT delete animal_sim.py, do NOT touch the frontend, do NOT start any
other task. Write the tests named in the task's Acceptance column and make them pass.

When done: show me the diff and the output of the four checks, then wait for my review
before committing. The acceptance criterion you must demonstrably meet is:
<PASTE THE ACCEPTANCE CELL FOR THIS TASK>
```

## Per-task prompts (paste one at a time, in this order)

Each prompt is self-contained and paste-ready. Every one tells Claude Code to read
`docs/pbpk-layer.md` and follow the Part 7 guardrails; the one-line guardrail reminder in
each is a backstop, not a substitute for the spec. Run them in the order below (dependencies
matter). Review the diff + the four checks, then let it commit, before moving to the next.

**Guardrail line embedded in every prompt (for reference):** branch from dev; run ruff, black,
`python scripts/check_boundaries.py`, and pytest via the repo `.venv` and pass all four; keep
`platform/` modality-agnostic (no RDKit/SMILES in `platform/`); commit as `bh-yeshwanth` with
NO `Co-Authored-By: Claude` trailer; do ONLY this task; don't touch the frontend or delete
`animal_sim.py`; show the diff + checks and wait for review before committing.

### S1-T1 — DispositionParameters contract
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S1-T1.

Create platform/kernel/src/hakase_kernel/pbpk/contract.py with a DispositionParameters
dataclass: a common core (fu_plasma, fu_blood, blood_plasma_ratio, cl_hepatic, cl_renal,
cl_total, kp per organ, vdss, extraction_ratio, hepatic_first_pass, species_context,
applicability_domain) plus a modality-extension slot for future modalities. Every numeric
field carries {value, ci_low, ci_high, provenance, source, units}.

Guardrails (Part 7): branch from dev; platform/ stays modality-agnostic (no RDKit/SMILES);
run ruff, black, python scripts/check_boundaries.py, pytest via the repo .venv and pass all
four; commit as bh-yeshwanth with no Claude trailer. Do only this task.

Acceptance: dataclass instantiable; a unit test round-trips a small-molecule instance and an
empty modality extension; check_boundaries.py green.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S1-T2 — Species/strain physiology store
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S1-T2.

Create platform/kernel/src/hakase_kernel/pbpk/physiology/ — a store keyed by
(species, strain, sex, age, body_weight). Populate the `human` row by COPYING the constants
currently in pk_ivive.py (Q_h=20.7 mL/min/kg, HPGL=99e6/g, liver=25.7 g/kg, BW=70) — do NOT
modify pk_ivive.py yet. Add rows for rat (SD, Wistar), mouse (CD-1, C57BL/6), dog (beagle),
cynomolgus monkey with organ volumes, blood flows, cardiac output, GFR, plasma protein, and
per-organ tissue-composition tables (fractional water / neutral-lipid / neutral-phospholipid /
acidic-phospholipid + intracellular pH) needed for Rodgers & Rowland. Every constant needs a
cited literature source in a comment. Sex/age/BW apply as typed modifiers, not new rows.

Guardrails (Part 7): branch from dev; platform/ stays modality-agnostic; run and pass ruff,
black, check_boundaries.py, pytest via the repo .venv; commit as bh-yeshwanth, no Claude
trailer. Do only this task; do not modify pk_ivive.py.

Acceptance: constants match their cited literature (unit tests); lookup by
(species,strain,sex,age,bw) with modifiers works; body-weight allometric scaling test passes.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S1-T2b — Generic-mammal allometric fallback (any-animal support)
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S1-T2b.

Extend platform/kernel/src/hakase_kernel/pbpk/physiology/ so the store resolves ANY species,
not just the calibrated rows. When the requested species is not a calibrated row, build a
"generic mammal" row: scale organ volumes, blood flows, cardiac output, and GFR allometrically
from body weight, and use a conserved mammalian tissue-composition default (fNL/fNP/water/[AP]/
intracellular pH) for the R&R tables. Set an `allometric_extrapolation` flag on the row, inflate
its parameter uncertainty, and mark metabolic-clearance-related parameters as the least reliable
for non-human species. Load species definitions from a data file (YAML/JSON), so adding a species
needs no code change. Calibrated species must behave exactly as before.

Guardrails (Part 7): branch from dev; platform/ stays modality-agnostic; run and pass ruff,
black, check_boundaries.py, pytest via the repo .venv; commit as bh-yeshwanth, no Claude trailer.
Do only this task.

Acceptance: an unknown species (e.g. "rabbit" with only a body weight) resolves to an allometric
row carrying the extrapolation flag and widened uncertainty; a calibrated species (e.g. rat_sd)
is byte-for-byte unaffected (regression test); adding a species via the data file requires no
code change (test loads a fixture species).

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S1-T3a — pKa predictor wrapper
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S1-T3a (see §4.5).

Create modalities/small-molecule/engine/src/hakase_smallmol/pk_ivive/pka.py wrapping a pKa
predictor behind one interface: QupKake primary (GNN + GFN2-xTB), pkasolver as fallback.
Return per-site micro-pKa, ionisation class (acid/base/neutral/zwitterion/ampholyte), and
fraction ionised at a given pH. Support a measured-pKa override (provenance "measured") that
bypasses prediction. Cache results per canonical SMILES. Flag low confidence when a predicted
pKa is in [6, 8]. Benchmark on a public set (SAMPL6/7 or the JCIM public benchmark) and record
the RMSE. If the xtb binary cannot be installed in this environment, implement the pkasolver
path first, stub QupKake behind the same interface, and tell me.

Guardrails (Part 7): branch from dev; this file is in a modality so RDKit/xtb are allowed here
(never in platform/); run and pass ruff, black, check_boundaries.py, pytest via the repo .venv;
commit as bh-yeshwanth, no Claude trailer. Do only this task.

Acceptance: benchmark RMSE reported; returns per-site pKa + ionisation class; measured override
bypasses prediction; cache-hit test passes.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S1-T3 — Rodgers & Rowland Kp
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S1-T3.

Create modalities/small-molecule/engine/src/hakase_smallmol/pk_ivive/kp.py computing
Rodgers & Rowland tissue:plasma partition coefficients per organ. Import the tissue-composition
tables from the kernel physiology store (S1-T2) and consume the pKa / ionisation output from
pka.py (S1-T3a). Inputs: logP (RDKit), pKa + fraction ionised, fu_plasma, blood:plasma ratio.
Output kp for the full compartment set. Watch units carefully.

Guardrails (Part 7): branch from dev; modality file (RDKit allowed); run and pass ruff, black,
check_boundaries.py, pytest via the repo .venv; commit as bh-yeshwanth, no Claude trailer.
Do only this task.

Acceptance: Kp for at least 3 published reference drugs within tolerance of literature
Rodgers & Rowland values (unit tests); ionisation handled via the S1-T3a output.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S1-T4 — Uncertainty helpers
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S1-T4.

Create platform/kernel/src/hakase_kernel/uncertainty/residuals.py (map an ML model's
validation residuals to an error distribution — lognormal for PK parameters) and
applicability_domain.py (descriptor/fingerprint distance to a training set -> in/edge/
out-of-domain state). Keep both modality-agnostic.

Guardrails (Part 7): branch from dev; platform/ stays modality-agnostic (no RDKit/SMILES);
run and pass ruff, black, check_boundaries.py, pytest via the repo .venv; commit as
bh-yeshwanth, no Claude trailer. Do only this task.

Acceptance: residual->lognormal unit test; applicability_domain returns in/edge/out on
fixtures.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S1-T5 — Extend IVIVE (species-aware, renal CL, uncertainty)
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S1-T5.

Extend modalities/small-molecule/engine/src/hakase_smallmol/pk_ivive/pk_ivive.py:
(1) source system parameters from the kernel physiology store (S1-T2) keyed by species,
    replacing the hard-coded human literals;
(2) add renal clearance (GFR*fu) and total CL;
(3) add a Monte-Carlo wrapper that samples each ML input from its residual distribution
    (S1-T4) and reports median + 90% intervals — WITHOUT modifying the pure compute_ivive core;
(4) preserve the provenance tags and the no-fallback "insufficient-input" envelope EXACTLY,
    and keep the deterministic point-estimate path working.

Guardrails (Part 7): branch from dev; modality file; run and pass ruff, black,
check_boundaries.py, pytest via the repo .venv; commit as bh-yeshwanth, no Claude trailer.
Do only this task.

Acceptance: ALL existing pk_ivive tests pass unchanged; new interval outputs present; runs
per species; seed-reproducible; no-fallback envelope preserved.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S1-T6 — Assemble DispositionParameters
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S1-T6.

Create modalities/small-molecule/engine/src/hakase_smallmol/pk_ivive/disposition.py that
assembles a DispositionParameters object (the S1-T1 contract) from the extended IVIVE (S1-T5),
the Kp module (S1-T3), the fu/CL split, vdss, species_context, and applicability_domain.
Add the Kp-derived Vss cross-check (Vss = Vplasma + sum over tissues of Vtissue*Kp) against
the ML VDss and flag divergence beyond ~2-3x.

Guardrails (Part 7): branch from dev; modality file; run and pass ruff, black,
check_boundaries.py, pytest via the repo .venv; commit as bh-yeshwanth, no Claude trailer.
Do only this task.

Acceptance: emits a valid DispositionParameters object; the Vss cross-check flags divergence
correctly (unit test).

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S2-T1 — Multi-compartment PBPK ODE
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S2-T1.

Create platform/kernel/src/hakase_kernel/pbpk/model.py: a general multi-compartment
perfusion-limited whole-body ODE that consumes a DispositionParameters object and a physiology
row, integrated with scipy solve_ivp. The per-organ transport law and the clearance/binding
terms MUST be injected (passed in), not hard-coded, so other modalities can supply different
laws (spec §5.1 req 2). Compartments: arterial + venous blood, lung, liver, kidney, heart,
brain, muscle, adipose, skin, gut, spleen, rest. Parent drug only (no metabolites). Watch units.

Guardrails (Part 7): branch from dev; platform/ stays modality-agnostic (no RDKit/SMILES);
run and pass ruff, black, check_boundaries.py, pytest via the repo .venv; commit as
bh-yeshwanth, no Claude trailer. Do only this task.

Acceptance: mass-balance conservation test (total drug conserved to tolerance); reduces to the
known one-compartment analytic solution for a degenerate single-tissue case.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S2-T2 — Absorption sub-models
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S2-T2.

Create platform/kernel/src/hakase_kernel/pbpk/absorption.py with per-route input models:
IV (bolus/infusion to venous), oral (dissolution/BCS -> gut -> portal -> hepatic first-pass),
SC (first-order depot), plus repeat-dose periodic forcing. COPY the BCS/formulation logic out
of animal_sim.py into here — do not delete animal_sim.py.

Guardrails (Part 7): branch from dev; platform/ stays modality-agnostic; run and pass ruff,
black, check_boundaries.py, pytest via the repo .venv; commit as bh-yeshwanth, no Claude
trailer. Do only this task; leave animal_sim.py in place.

Acceptance: per-route unit tests; oral first-pass reproduces a hand calculation; repeat-dose
accumulation test.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S2-T3 — Virtual cohort + Monte-Carlo
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S2-T3.

Create platform/kernel/src/hakase_kernel/pbpk/cohort.py: sample N virtual animals from real
physiological parameter distributions (log-normal body weight + correlated organ scaling) and
run Monte-Carlo over the DispositionParameters uncertainty. Aggregate per-endpoint medians +
90% intervals and mean/CI concentration-time curves.

Guardrails (Part 7): branch from dev; platform/ stays modality-agnostic; run and pass ruff,
black, check_boundaries.py, pytest via the repo .venv; commit as bh-yeshwanth, no Claude
trailer. Do only this task.

Acceptance: reproducible under a fixed seed; per-endpoint intervals emitted.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S2-T4 — Exposure endpoint
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S2-T4.

Add POST /predict/pbpk/exposure to service/src/hakase_service/main.py. Request:
{smiles, animal:{species,strain,sex,age,body_weight}, study:{route,dose,frequency,duration},
formulation, cohort_size, overrides?}. Wire the disposition producer (S1-T6) -> PBPK model
(S2-T1) + absorption (S2-T2) + cohort (S2-T3). Response = the .odt §8 block: plasma + per-organ
Cmax/Tmax/AUC/CL/Vss/t½ + curves, every value with a CI. Apply sanitize(). For out-of-
applicability-domain compounds, return the structured 422 envelope (mirror the existing IVIVE
422 pattern).

Guardrails (Part 7): branch from dev; run and pass ruff, black, check_boundaries.py, pytest via
the repo .venv; commit as bh-yeshwanth, no Claude trailer. Do only this task.

Acceptance: endpoint returns the documented schema; smoke test passes; OOD compound -> 422.

Show me the diff and the four checks' output, then wait for my review before committing.
```

### S2-T5 — Validation harness (HARD GATE)
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S2-T5. This is the
hard validation gate — nothing downstream proceeds until it passes.

Build the validation harness in modalities/small-molecule/validation/, RAT FIRST: scaffold/
cluster split of a public rat PK set (ChEMBL animal assays / PK-DB, rat only); compute
fold-error distribution (% within 2x / 3x) for Cmax/AUC/CL and interval coverage (target ≈
nominal), plus a permutation control. Defer the cross-species-transfer test until a second
species is calibrated. Deduplicate salts/analogues across splits to prevent leakage. Produce a
report. Keep the harness parameterised by species so adding a species later is a data change.

Guardrails (Part 7): branch from dev; run and pass ruff, black, check_boundaries.py, pytest via
the repo .venv; commit as bh-yeshwanth, no Claude trailer. Do only this task.

Acceptance: report generated with the metrics above on a held-out set; leakage controls in
place. Report the numbers to me — do NOT proceed to S2-T6 unless fold-error is within 2-3x and
coverage is calibrated.

Show me the diff, the report, and the four checks' output, then wait for my review.
```

### S2-T6 — Retirement / rewire (only after S2-T5 passes)
```
Read docs/pbpk-layer.md in full (authoritative spec). Implement ONLY task S2-T6. Do this ONLY
after S2-T5 has passed its gate.

Frontend: delete runAnimalCohortSimulation from apps/hakase-ai/src/lib/animalSim.ts and repoint
HakaseAI.tsx to POST /predict/pbpk/exposure via aiService.ts. Backend: delete the stale
duplicate AnimalCohortRequest class definitions in the small-molecule, antibody, and structure
routers; relocate the live-DB query functions (CCTE/PubChem/ChEMBL/PK-DB) to
platform/datasources. LEAVE animal_sim.py in place — its animal-layer code is still live.

Guardrails (Part 7): branch from dev; run and pass ruff, black, check_boundaries.py, pytest via
the repo .venv; commit as bh-yeshwanth, no Claude trailer. Do only this task.

Acceptance: the frontend calls the new endpoint; stale duplicates gone; boundaries green;
animal_sim.py untouched; existing tests pass.

Show me the diff and the four checks' output, then wait for my review before committing.
```

## Keeping it on the rails
- **If it over-reaches** (edits files outside the task, deletes `animal_sim.py`, touches the frontend early): stop it, say "revert that, this task is only <TASK-ID>," and re-scope.
- **If a check fails:** have it fix and re-run rather than skip — "all four checks must be green; do not commit until they are."
- **If it invents parameters** (Kp constants, physiology values): require a cited source in a comment. The spec's provenance/no-fallback discipline applies to new code too — no magic numbers.
- **Between tasks:** a fresh session per task keeps context clean; point each new session back at `docs/pbpk-layer.md`.

## Order & gates
- **Rat-first, modular.** Calibrate and validate the whole vertical on rat (Sprague Dawley) only; species live in a data file so mouse/dog/monkey are added later as data + their own validation, not code. Any non-rat species stays flagged `provisional/unvalidated` until it passes S2-T5. The R&R tissue composition is rat-specific — future species need their own, never a copy of rat's. When reviewing S1-T3/S2-T5, hold Claude Code to rat.
- Do Stage 1 (S1-T1 → S1-T2 → S1-T2b → S1-T3a → S1-T3 → S1-T4 → S1-T5 → S1-T6) before Stage 2 (S2-T1 → S2-T2 → S2-T3 → S2-T4 → S2-T5 → S2-T6). Note **S1-T2b (any-animal fallback) follows S1-T2**; **S1-T3a (pKa) comes before S1-T3 (Kp)**; and S1-T3 depends on both S1-T2 (tissue tables) and S1-T3a.
- **Verify the R&R acidic-phospholipid [AP] + intracellular-pH constants** (from S1-T2) against the Open Systems Pharmacology / PK-Sim database or the httk R package before trusting Kp for basic drugs — the primary papers are paywalled; those two are the open cross-check. R&R intracellular pH should be a uniform 7.0 across tissues (plasma 7.4, blood cells 7.22).
- **S2-T5 (validation) is a hard gate:** do not run S2-T6 retirement (frontend rewire) until exposure validation passes (fold-error within 2–3×, calibrated coverage). Until then the old paths stay live.
- **pKa decision is settled:** QupKake (primary, GNN + xtb) with pkasolver as the lightweight fallback; measured pKa overrides prediction. See `pbpk-layer.md` §4.5. Remaining open decision at S1-T5: whether **ADMET per-endpoint residuals** exist for the uncertainty distributions.

## What NOT to hand to Claude Code yet
The animal-testing layer (organ response, toxicity, NOAEL, study design, `.odt` beyond §8). That is a separate spec and a separate build, gated on the frozen exposure engine.
