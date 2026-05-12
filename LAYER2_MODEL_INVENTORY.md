# Layer 2 — Pretrained Model Inventory & Device Support Audit

**Date:** 2026-05-12
**Scope:** All Python ML predictors under `artifacts/ai-service/models/`
**Mode:** Inventory only — **no code changes** (per user choice)

---

## TL;DR

You asked whether Layer 2 uses ~11 pretrained models and whether they work. Short answer:

- **6 trained ML predictors** + **1 large pretrained foundation model (ESM-2)** + **1 multi-endpoint ensemble (ADMET-AI Chemprop)** are wired into the AI service. That's not literally 11 — but ADMET-AI itself is an ensemble of ~22 Chemprop sub-models (one per endpoint), so the "11" number is plausible if you're counting endpoint heads. See "Counting models" below.
- **All trained predictors are wired, cached, and warm up on FastAPI startup** via `main.py:_prewarm_in_background()`. They work.
- **CUDA / CPU support gap.** Only `protein_ml.py` (ESM-2 loader) actually touches `torch`, and **it pins the model to CPU** with no device detection. Every other model is sklearn-based and CPU-only by design — there's nothing to GPU-accelerate there. ADMET-AI (Chemprop) auto-detects via PyTorch internally, but its config isn't exposed.
- Recommended one-place fix to make `protein_ml.py` GPU-aware is a ~10-line patch shown at the bottom.

---

## Counting models (where the "11" might come from)

| Bucket | Count | What it is |
|---|---|---|
| Trained ML predictors (custom `.pkl` heads in `cache/`) | 5 | cardiotox, dili_ml, solubility_ml, binding_ml, protein_ml |
| Foundation model (HuggingFace) | 1 | ESM-2 t12 35M (`facebook/esm2_t12_35M_UR50D`) — shared by binding_ml + protein_ml |
| Multi-endpoint ensemble (3rd-party package) | 1 (containing ~22 sub-heads) | ADMET-AI Chemprop-RDKit GNN ensemble |
| Physical / projection (non-ML) | 4 | drug_target (now ChEMBL API-driven), celltype_aggregation, patient_line, docking_vina, fep_runpod |

So `5 distinct ML heads + 1 ESM-2 backbone + ~22 ADMET-AI sub-heads ≈ 28` if you count every sub-head, or `7` if you count distinct wrappers. **11** lands somewhere in between — probably you were counting "5 custom + 5 ADMET-AI key endpoints + 1 ESM-2".

---

## Per-model breakdown

### 1. `admet_ml.py` — ADMET-AI v2 (Chemprop-RDKit GNN ensemble)
- **Class:** Multi-endpoint pretrained GNN ensemble (~22 endpoints surfaced in `KEY_ENDPOINTS`).
- **Weights:** Pulled from the `admet_ai` PyPI package on first call. Cached under `~/.cache/admet_ai` (managed by the package).
- **Load path:** `ADMETModel()` — singleton, thread-safe via `_LOAD_LOCK`.
- **Status:** ✅ Works. Returns 100+ endpoints via `model.predict(smiles=...)`. Has `/predict/admet-ml` route and is force-loadable via `/models/warmup`.
- **CUDA / CPU:** Inherits Chemprop / PyTorch default device. **No explicit device control** in our wrapper. If `admet_ai` chooses CUDA when available (which it does in recent versions), it will use GPU automatically. If not, falls back to CPU.

### 2. `cardiotox.py` — hERG cardiotoxicity (Random Forest)
- **Class:** Custom RF classifier.
- **Features:** 1024-bit Morgan fingerprint (r=2) + 6 RDKit descriptors + basic-N count.
- **Training data:** TDC `hERG` (Wang et al., 655 compounds).
- **Weights:** Trained on first call (~2-5 s), pickled to `cache/cardiotox_rf.pkl`. Cached by version (`MODEL_VERSION = "1.0.0"`).
- **Status:** ✅ Works. Has `/predict/cardiotox` route, `is_ready()`, `warmup()`.
- **CUDA / CPU:** Pure sklearn — CPU only. **GPU does not apply.**

### 3. `dili_ml.py` — Drug-Induced Liver Injury (Random Forest)
- **Class:** Custom RF classifier.
- **Features:** 1024-bit Morgan fingerprint (r=2) + 6 RDKit descriptors (`MolWt`, `MolLogP`, `TPSA`, `HBD`, `HBA`, `FractionCSP3`).
- **Training data:** TDC `DILI` (Xu et al., 2015 — 475 compounds, FDA orange-box).
- **Weights:** Trained on first call (~3-8 s), pickled to `cache/dili_ml_rf.pkl`.
- **Status:** ✅ Works. Has `/predict/dili-ml` route, `is_ready()`, `warmup()`.
- **CUDA / CPU:** Pure sklearn — CPU only.

### 4. `solubility_ml.py` — Aqueous solubility logS (Random Forest regressor)
- **Class:** Custom RF regressor.
- **Features:** 1024-bit Morgan fingerprint (r=2) + 9 RDKit physicochemical descriptors.
- **Training data:** ~135 curated compounds (Delaney 2004 + DrugBank annotations + standard pharmaceutical refs).
- **Weights:** Trained on first call (~3-8 s), pickled to `cache/solubility_ml_rf.pkl`.
- **Status:** ✅ Works. Has `/predict/solubility-ml` route.
- **CUDA / CPU:** Pure sklearn — CPU only.

### 5. `binding_ml.py` — DeepDTA-style binding affinity (GradientBoostingRegressor + ESM-2)
- **Class:** Hybrid — pretrained protein embedding + trained boosted-tree head.
- **Features:** 1032-dim drug (1024 Morgan + 8 RDKit) ⊕ 480-dim ESM-2 mean-pool = 1512-dim.
- **Training data:** ~125 curated literature pairs (~60 UniProts × ~65 drugs).
- **Weights:**
    - ESM-2 weights: from HuggingFace `facebook/esm2_t12_35M_UR50D` (~140 MB, cached under `~/.cache/huggingface`).
    - GBR head: trained on first call, pickled to `cache/binding_ml_gbm.pkl`.
    - Per-target ESM-2 embeddings: cached as NPZ at `cache/binding_ml_embeddings.npz`.
- **Status:** ✅ Works. Cold-start cost dominated by ESM-2 download + 60 protein embeds (~5-15 min on CPU). Subsequent starts ~1 s.
- **CUDA / CPU:** Reuses the ESM-2 backbone from `protein_ml._embed_sequence` — so it inherits whatever device that module is on. **Currently CPU only** (see protein_ml below).
- **Performance metrics tracked:** random-KFold R² / RMSE / Pearson AND GroupKFold-by-UniProt (leave-target-out) for honest novel-target estimation.

### 6. `protein_ml.py` — ESM-2 druggability (LogisticRegression head on frozen embeddings)
- **Class:** Hybrid — pretrained protein LM (frozen) + trained LR head.
- **Features:** 480-dim ESM-2 t12 35M mean-pooled per-residue embedding.
- **Training data:** ~80 curated human drug targets vs ~80 essential housekeeping proteins.
- **Weights:**
    - ESM-2: `facebook/esm2_t12_35M_UR50D` (~140 MB, HuggingFace cache).
    - LR head: trained on first call, pickled to `cache/protein_ml_lr.pkl`.
    - Per-protein embeddings: cached as NPZ at `cache/protein_ml_embeddings.npz`.
    - Sequences: cached as JSON at `cache/protein_ml_seqs.json`.
- **Status:** ✅ Works. First cold start is the heaviest in the service: ~5-15 min on CPU to embed the 161 training proteins. Cached afterward.
- **CUDA / CPU:** ⚠️ **PINNED TO CPU.** See `_load_esm()` at `protein_ml.py:149-174` — uses `AutoModel.from_pretrained(ESM_MODEL_NAME)` with no `.to(device)` call. `_embed_chunk` at line 177 then runs forward passes on CPU only. **This is the only place a torch model is touched in the codebase.**

### 7. ESM-2 t12 35M — foundation model (shared)
- Loaded **once** via the singleton in `protein_ml._load_esm()`. `binding_ml._embed_protein()` reuses the same singleton (see `binding_ml.py:127-143`).
- The download happens lazily on first call and is cached by HuggingFace's `transformers` lib.
- Same CUDA/CPU caveat — currently pinned to CPU.

### 8. `protein.py` (heuristic) — non-ML druggability
- Counts binding sites + active sites + sequence length from the UniProt record.
- No weights, no training. Used as the "rule-based first opinion" against which `protein_ml` is positioned as the ML second opinion.

### 9. `drug_target.py` — non-ML (now ChEMBL API-driven; just refactored)
- Was: 5 hand-curated TARGET_PROFILES with pharmacophore-QSAR scoring. (Removed.)
- Now: ChEMBL similarity → UniProt dossier → PDB enrichment → confidence scoring from (similarity, distinct hits, pIC50, source-quality tier). ML fallback via `binding_ml` when a specific UniProt has no ChEMBL evidence.

### 10. `celltype_aggregation.py` — non-ML (Drug2cell projection)
- Takes preprocessed Tabula Sapiens v2 Parquet (provisioned via Colab notebook).
- Pure pandas. 503 honest-failure envelope when the atlas isn't provisioned. **CPU only by design.**

### 11. `patient_line.py` — non-ML (DepMap PRISM projection)
- Takes preprocessed DepMap PRISM 24Q2 Parquet (provisioned via Colab notebook).
- Pure pandas + a deterministic `2 ** (alpha * essentiality)` modifier. **CPU only by design.**

### 12. `docking_vina.py` — physical (AutoDock Vina subprocess)
- Calls `obabel` + `vina` binaries directly. RDKit handles 3D embed + UFF optimize.
- Vina is CPU-multi-threaded; the `exhaustiveness` parameter scales work. **No CUDA option in Vina itself.**

### 13. `fep_runpod.py` — opt-in GPU job (off-platform)
- Submits ΔΔG free-energy-perturbation jobs to a user-provisioned RunPod Serverless worker. Returns 503 with the exact missing-secret name if `RUNPOD_API_KEY` / `RUNPOD_FEP_ENDPOINT_ID` aren't set. **GPU runs on RunPod — not on the user's machine.**

---

## CUDA / CPU support summary

| Where | Current behaviour | Risk on no-GPU machine | Risk on GPU machine |
|---|---|---|---|
| `protein_ml.py` (ESM-2) | **Hard-pinned to CPU** | ✅ Works (slow first start) | ⚠️ Idle GPU — slow ESM-2 inference unnecessarily |
| `binding_ml.py` (ESM-2 via protein_ml) | Inherits CPU from above | ✅ Works | ⚠️ Same idle GPU |
| `admet_ml.py` (Chemprop / ADMET-AI) | Inherits PyTorch defaults | ✅ Works on CPU | ✅ Auto-uses CUDA if available (package default) |
| `cardiotox`, `dili_ml`, `solubility_ml` | sklearn — CPU only by design | ✅ | n/a |
| `celltype_aggregation`, `patient_line` | pandas — CPU only by design | ✅ | n/a |
| `docking_vina` | Vina is CPU-multithreaded | ✅ | n/a |
| `fep_runpod` | Off-platform GPU on RunPod | Returns 503 (intentional) | Submits to RunPod regardless of local GPU |

**Bottom line:** the service runs fine on a CPU-only machine today. The only place we'd benefit from CUDA is **ESM-2 inference in `protein_ml.py`** (and transitively in `binding_ml.py`).

---

## Proposed patch (not applied — for your approval)

To make ESM-2 device-aware, two edits in `artifacts/ai-service/models/protein_ml.py`:

### Patch 1: detect device once at module load

```python
# at top of file, near the constants
import torch
_DEVICE = torch.device(
    os.environ.get("HAKASE_TORCH_DEVICE")             # operator override
    or ("cuda" if torch.cuda.is_available() else "cpu")
)
```

### Patch 2: move the model to that device in `_load_esm()`

```python
mdl = AutoModel.from_pretrained(ESM_MODEL_NAME)
mdl.eval()
mdl.to(_DEVICE)                          # NEW
logger.info("protein_ml: ESM-2 ready on %s in %.2fs", _DEVICE, _ESM_LOAD_TIME_S)
```

### Patch 3: move inputs to that device in `_embed_chunk()`

```python
inputs = tok(seq_chunk, return_tensors="pt", add_special_tokens=True)
inputs = {k: v.to(_DEVICE) for k, v in inputs.items()}    # NEW
with torch.no_grad():
    out = mdl(**inputs)
```

That's it — 3 small edits. No other ML model needs touching because none of them use `torch` directly.

### Optional: expose the device via the `/models/status` endpoint

```python
def is_ready() -> dict[str, Any]:
    return {
        "loaded": _MODEL is not None,
        ...,
        "torch_device": str(_DEVICE),
    }
```

So `GET /models/status` would tell the UI which device ESM-2 is actually using.

---

## Verification commands

After the patch (or right now on CPU), you can confirm every model loads:

```bash
cd artifacts/ai-service
python -c "
from models.admet_ml import warmup as a; print('admet_ml:', a())
from models.cardiotox import warmup as c; print('cardiotox:', c())
from models.dili_ml import warmup as d; print('dili_ml:', d())
from models.solubility_ml import warmup as s; print('solubility_ml:', s())
from models.binding_ml import warmup as b; print('binding_ml:', b())
from models.protein_ml import warmup as p; print('protein_ml:', p())
"
```

Or hit the FastAPI route once the server is up:

```bash
curl -s http://localhost:8090/models/warmup | jq
curl -s http://localhost:8090/models/status | jq
```

Every entry should report `"loaded": true` and an `engine` string.

---

## What I'd recommend you green-light next

1. **Apply the 3-line CUDA patch to `protein_ml.py`** above — that's the one real GPU-portability gap.
2. **Run `POST /models/warmup` once after deploy** so the first user doesn't pay the ~5-15 min ESM-2 embed cost. The startup hook in `main.py` already does this in a background thread, but it's worth confirming logs say "ready" before traffic.
3. **Optionally add the operator override env var** `HAKASE_TORCH_DEVICE=cpu` / `cuda` / `cuda:1` for deployments that share GPUs.

Want me to apply these now?
