# HakaseAI FEP Worker — RunPod Serverless

Relative-binding free-energy perturbation worker for **HakaseAI L2 Stage 5**.
Runs the OpenMM + OpenFF Sage + TIES-MD protocol on a RunPod Serverless H100
endpoint and returns ΔΔG (B − A) with per-λ-window detail.

This worker is the GPU counterpart to `artifacts/ai-service/models/fep_runpod.py`
in the main HakaseAI repo. The two communicate exclusively through the I/O
contract documented below — no shared state, no shared filesystem.

---

## Honesty contract (project-wide, MUST be honoured)

- **No fabricated ΔΔG.** If TIES fails, the handler raises the exact reason
  and the upstream UI surfaces it verbatim.
- **No silent fallback.** If a required dependency is missing or a binding
  pose cannot be generated, the worker errors out — it does not substitute
  a docked-only ΔG, an MM-PBSA estimate, or any other surrogate.
- **No defaults for missing output fields.** The handler returns all eight
  required keys or it raises — `fep_runpod.py` validates this server-side.

---

## I/O contract

### Input (`event["input"]`)

| field | type | default | meaning |
| --- | --- | --- | --- |
| `ligand_a_smiles`  | str    | required | reference ligand SMILES |
| `ligand_b_smiles`  | str    | required | perturbed ligand SMILES |
| `pdb_id`           | str    | required | 4-letter RCSB ID — receptor |
| `n_lambda_windows` | int    | 12       | number of alchemical λ windows |
| `n_replicas`       | int    | 3        | independent replicas per window |
| `ns_per_window`    | float  | 5.0      | production ns per (λ, replica) |

### Output (handler return value)

All eight non-`warnings` fields are required. Missing any of them causes
`fep_runpod.py` to raise `RunPod worker output missing required fields [...]`.

```json
{
  "ddg_kcal_mol":            -1.42,
  "ddg_uncertainty_kcalmol":  0.31,
  "ddg_kT":                  -2.39,
  "windows": [
    { "lambda": 0.0,   "dG_kcal_mol": 0.00,  "stderr_kcal_mol": 0.05 },
    { "lambda": 0.083, "dG_kcal_mol": -0.12, "stderr_kcal_mol": 0.04 }
  ],
  "wallclock_minutes": 412.5,
  "gpu_minutes":       408.1,
  "engine_version":    "OpenMM 8.1.1 + OpenFF Sage 2.2.0 + TIES-MD 1.7",
  "force_field":       "openff-2.2.0",
  "warnings":          []
}
```

---

## Deployment via RunPod GitHub integration

1. Push this monorepo to GitHub.
2. RunPod Serverless → New Endpoint → **Custom deployment** → **Deploy from GitHub**.
3. Connect GitHub, select this repo, set **Dockerfile path** to `runpod_worker/Dockerfile`
   and **build context** to `runpod_worker/`.
4. GPU: **H100 SXM 80GB** (fallback: A100 80GB).
5. Endpoint settings:
   - Max workers: **3** (cost cap; in-flight FEP jobs are gated to 1 in `fep_runpod.py` anyway).
   - Active workers: **0** (per-second billing only).
   - Idle timeout: **5 s**.
   - Execution timeout: **86 400 s** (24 h).
   - Flashboot: **on**.
6. Save → copy the endpoint ID.
7. In Replit, set secrets:
   - `RUNPOD_API_KEY` — from RunPod User Settings → API Keys.
   - `RUNPOD_FEP_ENDPOINT_ID` — the ID from step 6.

That's it. Stage 5 in HakaseAI will now reach this worker.

---

## What this worker does **not** handle (intentional scope)

- **Pose generation beyond the docking heuristic.** The worker uses smina
  to generate a starting pose for both ligands centred on the receptor's
  co-crystal ligand (or the protein's geometric centre if none). For
  publication-grade FEP you want an expert-curated bound pose, not an
  auto-docked one. Treat the auto-pose as a screening estimate; surface
  this caveat upstream.
- **Atom-mapping QC.** TIES-MD's default mapping works for congeneric
  series. If the perturbation changes scaffold (`A → B` are not congeneric),
  results will be garbage. The handler does not refuse such cases; the
  upstream UI must guard SAR scope.
- **Convergence checking.** The worker reports per-window stderr but does
  not auto-extend short trajectories. If `ddg_uncertainty_kcalmol > 1.0`,
  rerun with longer `ns_per_window`.

These limitations are echoed in the `warnings` field of the output payload
when triggered.

---

## Local development / smoke test

```bash
cd runpod_worker
docker build -t hakase-fep-worker:dev .
docker run --rm --gpus all -e RUNPOD_TEST=1 hakase-fep-worker:dev
```

`RUNPOD_TEST=1` runs the handler once with a tiny in-tree input
(2 ns/window, 3 windows, 1 replica) against a small receptor (`1HVR`) so
you can verify the stack inside ~20 minutes on an H100.

Without `RUNPOD_TEST`, the container starts the RunPod serverless event
loop and waits for jobs from the queue.
