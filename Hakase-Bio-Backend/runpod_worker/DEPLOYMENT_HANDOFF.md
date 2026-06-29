# HakaseAI FEP Worker — Deployment Handoff

**Audience:** Engineering team taking over RunPod deployment of the L2 Stage 5 FEP worker.
**Owner of this doc:** (assign)
**Last updated:** 2026-05-10
**Status:** Code scaffolded and reviewed. RunPod-side provisioning + GitHub push pending.

---

## What this is

A GPU worker that runs **relative-binding free-energy perturbation (FEP)** for HakaseAI Stage 5. Given two ligand SMILES (A, B) and a receptor PDB ID, it returns ΔΔG = ΔG(B) − ΔG(A) in kcal/mol with per-λ-window detail, using OpenMM + OpenFF Sage 2.2.0 + TIES-MD 1.7 on an H100 SXM.

The worker code lives at `runpod_worker/` in the HakaseAI monorepo.
The upstream caller is `artifacts/ai-service/models/fep_runpod.py` in the same monorepo — it submits jobs to RunPod via REST and polls for results.

---

## Hard rules (non-negotiable, project-wide)

1. **No fabricated ΔΔG.** If TIES fails, the worker raises with the exact reason. Do not add fallback paths that return a docking score, MM-PBSA estimate, or any other surrogate as if it were a real ΔΔG.
2. **No silent defaults for missing required output fields.** All 8 output fields (see contract below) must be real measurements from TIES. The upstream server validates this and rejects the job otherwise.
3. **Errors propagate verbatim.** The handler re-raises `TiesRunError` unchanged. Do not wrap with prefixes like "FEP failed: ..." — the upstream UI shows the raw text to users (often researchers debugging their input).

If you ever feel tempted to "just return something so the UI doesn't break", stop. The UI is designed to surface honest failures. Silent fallbacks would invalidate every published number from this system.

---

## Tasks for the team (in order)

### 1. Push the monorepo to GitHub

The Replit project needs to live in a GitHub repo so RunPod's GitHub integration can build from it.

**Steps:**
- Create a private GitHub repo (suggested name: `hakase-ai` or `biodigital-twin`).
- In Replit: Tools → Git → Connect to GitHub → select that repo → push the `main` branch.
- Confirm the push includes the entire `runpod_worker/` directory.

**Acceptance:** the GitHub repo shows `runpod_worker/Dockerfile`, `runpod_worker/handler.py`, `runpod_worker/ties_runner.py`, `runpod_worker/dock_runner.py`, `runpod_worker/environment.yml`, `runpod_worker/requirements.txt`.

---

### 2. Create the RunPod Serverless endpoint

**Account prerequisites:**
- RunPod account with billing enabled.
- ~$50 credit minimum for first deployment + smoke test.
- A team member with RunPod org admin rights to install the GitHub app.

**Endpoint configuration:**

| Setting | Value | Why |
| --- | --- | --- |
| Deployment type | Custom — Deploy from GitHub | Auto-rebuild on commit |
| Repo | `<your-org>/<repo-name>` | The repo from step 1 |
| Branch | `main` | Stable line |
| Dockerfile path | `runpod_worker/Dockerfile` | Subdir build |
| Build context | `runpod_worker/` | Don't ship the whole monorepo |
| GPU type | **H100 SXM 80GB** (fallback: A100 80GB) | TIES-MD throughput |
| Max workers | 3 | Cost cap. Upstream gates in-flight jobs to 1 anyway. |
| Active workers | 0 | Per-second billing only |
| Idle timeout | 5 s | Release GPU fast after job completes |
| Execution timeout | 86 400 s (24 h) | FEP runs are long |
| Flashboot | On | Faster cold start |
| Container disk | 30 GB | Image is ~6–8 GB |

**First build will take 10–20 minutes** because the chemistry stack (CUDA + OpenMM + AmberTools + RDKit + smina) is large. Subsequent builds are much faster due to layer caching.

**If the build fails:** the most likely cause is a conda-forge package version conflict. Check the `environment.yml` and pin the failing package to the version reported in the build log. Do **not** disable the build-time smoke import in `Dockerfile` — that check is intentional (fails at build time so you don't pay for a broken worker).

**Acceptance:** RunPod dashboard shows endpoint status "Active", and the endpoint detail page shows a green checkmark next to the latest build. Note the endpoint ID (looks like `xy9z8w7v6u5t4s`).

---

### 3. Wire up secrets in Replit

Once the endpoint exists:

1. RunPod → User Settings → API Keys → create a new key with "Endpoint Run" permission. Copy the secret.
2. In Replit (or wherever HakaseAI is hosted): set two environment variables:
   - `RUNPOD_API_KEY` — the API key from step 1.
   - `RUNPOD_FEP_ENDPOINT_ID` — the endpoint ID from step 2.
3. Restart the `AI Service (Python)` workflow so it picks up the new env vars.

**Acceptance:** open the HakaseAI Stage 5 panel — the "FEP unavailable" warning should disappear and the "Submit FEP job" button should activate.

---

### 4. Run the smoke test (DO NOT SKIP)

Before any real research workload, run the in-tree smoke test. This catches stack issues for ~$2 instead of catching them on a $20 production run.

**Smoke-test input** (paste into the Stage 5 form):

| Field | Value |
| --- | --- |
| Ligand A SMILES | `CC(C)NC(=O)C(NC(=O)c1ccccc1)Cc1ccccc1` |
| Ligand B SMILES | `CC(C)NC(=O)C(NC(=O)c1ccc(F)cc1)Cc1ccccc1` |
| PDB ID | `1HVR` (HIV-1 protease) |
| n_lambda_windows | `3` |
| n_replicas | `1` |
| ns_per_window | `2.0` |

**Expected result:** ΔΔG between roughly −2 and +2 kcal/mol (this perturbation adds a single para-fluorine — a small effect). Wallclock ~20 minutes on H100 SXM. Cost ~$2.

**If the smoke test fails:** the error message from TIES propagates verbatim to the UI. The most common failure modes are:
- "RCSB PDB fetch failed" — check the worker has outbound HTTPS (RunPod's default network policy allows it; only an issue if you've added a VPC).
- "PDBFixer preparation failed" — usually a malformed input PDB; rare for canonical RCSB structures.
- "smina failed" — check the worker logs for the smina stderr tail (printed in the error).
- "ties_md exited rc=N" — the most informative case; the TIES-MD stderr tail is in the error message.

Post the verbatim error in the team's debugging channel before changing anything.

**Acceptance:** smoke test returns a result with all 8 fields populated and `ddg_uncertainty_kcalmol < 1.5`. UI shows the per-window plot.

---

### 5. Cost monitoring + alerting

H100 SXM is **~$2.99/hr**. A typical production run (12 windows × 3 replicas × 5 ns) takes ~7–10 hours = **~$22–30 per ΔΔG**. Set a billing alert.

**Recommended alerts in RunPod:**
- Daily spend > $200 → Slack/email.
- Endpoint queue depth > 5 → page (means upstream rate-limiting broke).
- Job failure rate > 25% over 1 h → page (means stack is degrading).

---

## I/O contract reference (read-only — do not modify)

This is enforced server-side in `artifacts/ai-service/models/fep_runpod.py`. Worker output that doesn't conform is rejected.

### Input (`event["input"]`)

| field | type | required | default | range |
| --- | --- | --- | --- | --- |
| `ligand_a_smiles` | str | yes | — | — |
| `ligand_b_smiles` | str | yes | — | — |
| `pdb_id` | str | yes | — | 4-char alphanumeric |
| `n_lambda_windows` | int | no | 12 | 3..32 |
| `n_replicas` | int | no | 3 | 1..5 |
| `ns_per_window` | float | no | 5.0 | 0.5..50.0 |

### Output (return value of `handler`)

```json
{
  "ddg_kcal_mol":            -1.42,
  "ddg_uncertainty_kcalmol":  0.31,
  "ddg_kT":                  -2.39,
  "windows": [
    { "lambda": 0.0,   "dG_kcal_mol":  0.00, "stderr_kcal_mol": 0.05 },
    { "lambda": 0.083, "dG_kcal_mol": -0.12, "stderr_kcal_mol": 0.04 }
  ],
  "wallclock_minutes": 412.5,
  "gpu_minutes":       408.1,
  "engine_version":    "OpenMM 8.1.1 + OpenFF Sage 2.2.0 + TIES-MD 1.7",
  "force_field":       "openff-2.2.0",
  "warnings": [
    "Bound poses were auto-generated by smina, not expert-curated. ..."
  ]
}
```

All 8 non-`warnings` fields are required. Missing any → upstream raises and the job is marked FAILED.

---

## Known limitations (already documented in `warnings`)

These are deliberate scope decisions, not bugs. Surface them to users; do not "fix" them by adding fallbacks.

1. **Auto-generated poses.** The worker uses smina to dock both ligands centred on the receptor's co-crystal ligand. For publication-grade FEP, supply an expert-curated bound pose. Currently the contract has no field for a user-supplied pose — that's a future contract change requiring upstream work too.
2. **No atom-mapping QC.** TIES-MD's default mapping works for congeneric series. The worker emits a warning if Tanimoto similarity < 0.5 but does not refuse the job. The upstream UI must guard SAR scope.
3. **No auto-extension.** If `ddg_uncertainty_kcalmol > 1.0`, the worker emits a warning but does not silently rerun. Users must resubmit with longer `ns_per_window`.

---

## Future work (not blocking deployment)

- Add a `user_pose_pdb` optional input so researchers can supply a curated bound pose. Requires contract update on both sides.
- Add a `n_intermediate_states` option for non-congeneric perturbations (currently warned-against but not blocked).
- Move from CLI subprocess invocation of `ties_md` to its Python API once we trust it not to crash the event loop.
- Add a `protocol_version` field to the output payload so we can version-gate UI rendering.

---

## Contacts

- **Worker code:** `runpod_worker/` in the HakaseAI monorepo.
- **Upstream contract:** `artifacts/ai-service/models/fep_runpod.py`.
- **Project owner:** (assign)
- **Chemistry/FEP escalation:** (assign — needs computational chemistry background)
- **DevOps/RunPod escalation:** (assign)
