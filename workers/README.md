# Hakase BioTwin — GPU Workers

Two RunPod Serverless workers that power the GPU features in the app.

| Worker | Feature in app | GPU needed |
|---|---|---|
| `fep-worker` | Free Energy Perturbation (FEP/TIES) — Stage 5 ΔΔG | A100 40GB+ |
| `boltz-worker` | Boltz-2 Co-folding + affinity prediction | A100 40GB+ |

---

## How to deploy (do this once per worker)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- [Docker Hub](https://hub.docker.com) account (free) — or any container registry
- RunPod account with API key

---

### Step 1 — Build and push the Docker image

Replace `yourdockerhubusername` with your actual Docker Hub username.

**FEP worker:**
```bash
cd workers/fep-worker
docker build -t yourdockerhubusername/hakase-fep-worker:latest .
docker push yourdockerhubusername/hakase-fep-worker:latest
```

**Boltz-2 worker:**
```bash
cd workers/boltz-worker
docker build -t yourdockerhubusername/hakase-boltz-worker:latest .
docker push yourdockerhubusername/hakase-boltz-worker:latest
```

> The Boltz-2 image is ~8 GB (model weights baked in). Build takes ~10 min the first time.

---

### Step 2 — Deploy as RunPod Serverless endpoint

1. Go to [runpod.io](https://runpod.io) → **Serverless** → **New Endpoint**
2. Choose **Custom** (not a template)
3. Set **Container Image** to your pushed image, e.g. `yourdockerhubusername/hakase-fep-worker:latest`
4. Set **GPU** to `NVIDIA A100 40GB` or better
5. Set **Max Workers** to `1` (start small — GPU costs add up)
6. Set **Idle Timeout** to `5` seconds (shuts down when not in use → no idle cost)
7. Click **Deploy** → wait ~2 min for it to initialize
8. Copy the **Endpoint ID** (looks like `abc123xyz`)

Repeat for the Boltz-2 worker to get a second Endpoint ID.

---

### Step 3 — Add to your .env

```
GPU_PROVIDER=runpod
RUNPOD_API_KEY=your_runpod_api_key
RUNPOD_FEP_ENDPOINT_ID=endpoint_id_from_fep_worker
RUNPOD_BOLTZ_ENDPOINT_ID=endpoint_id_from_boltz_worker
```

Then restart the backend:
```bash
pnpm backend
```

That's it. Click FEP or Co-folding in the app — the job dispatches to RunPod automatically.

---

## Cost estimate

| Job | Typical runtime | A100 cost |
|---|---|---|
| Boltz-2 co-fold (small complex) | 2–5 min | ~$0.05–0.15 |
| Boltz-2 co-fold (large complex) | 10–20 min | ~$0.30–0.60 |
| FEP/TIES (12 windows, 3 replicas, 5 ns) | 4–8 hours | ~$7–14 |

RunPod charges per second of GPU use only. No idle cost with Idle Timeout = 5s.

---

## Switching to AWS or Azure later

No code changes needed. Just change `GPU_PROVIDER` in `.env`:

```
GPU_PROVIDER=aws        # or azure
```

And fill in the corresponding AWS/Azure vars from `.env.example`.
The same worker Docker images run on all three providers.
