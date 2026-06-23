import { Router } from "express";

const router = Router();
// AI_SERVICE_URL: override via env var when API server and AI service
// run on different machines (e.g. DigitalOcean droplet vs RunPod pod).
// Defaults to localhost for single-machine / docker-compose setups.
const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8090";

router.post("/ai/admet", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/admet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/properties", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/binding", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/binding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/protein", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/protein`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/full-pipeline", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/full-pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.get("/ai/health", async (_req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/health`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/admet-ml", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/admet-ml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/cardiotox", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/cardiotox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/dili-ml", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/dili-ml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/protein-ml", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/protein-ml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/solubility-ml", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/solubility-ml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/binding-ml", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/binding-ml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// ── New mechanistic safety endpoints ─────────────────────────────────────

// Reactive metabolite structural alert scanner (26 SMARTS patterns, literature-curated)
router.post("/ai/reactive-metabolites", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/reactive-metabolites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// BSEP inhibition + phospholipidosis predictor
router.post("/ai/bsep", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/bsep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// Cytotoxicity (cell viability / CC50) — real Ersilia model or honest unavailable
router.post("/ai/cytotoxicity", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/cytotoxicity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// Generic Ersilia Model Hub passthrough (configured endpoints only)
router.post("/ai/ersilia", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/ersilia`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.get("/ai/ersilia/status", async (_req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/ersilia/status`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// Applicability domain (AD) confidence scorer
router.post("/ai/applicability-domain", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/applicability-domain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// L1 — Lookup-first known-drug resolver (live ChEMBL InChIKey). Returns the
// measured published profile so approved/withdrawn drugs bypass the ML veto stack.
router.post("/ai/known-drug", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/known-drug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// L1 — Peptide-native property engine (physicochemical, stability, permeability, AMP, developability)
router.post("/ai/peptide", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/peptide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// L1 — Antibody-native developability engine
router.post("/ai/antibody", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/antibody`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});


// L2 Stage 2 — AutoDock Vina docking (async job submission + polling)
router.post("/ai/dock", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/dock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.get("/ai/dock/status/:jobId", async (req, res) => {
  try {
    const resp = await fetch(
      `${AI_SERVICE_URL}/predict/dock/status/${encodeURIComponent(req.params.jobId)}`,
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// L2 Stage 5 — TIES relative-binding FEP via RunPod Serverless (async, ~24 GPU-h)
router.get("/ai/fep/config", async (_req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/fep/config`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/fep", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/fep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.get("/ai/fep/status/:jobId", async (req, res) => {
  try {
    const resp = await fetch(
      `${AI_SERVICE_URL}/predict/fep/status/${encodeURIComponent(req.params.jobId)}`,
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/celltype-aggregation", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/celltype-aggregation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/patient-line", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/patient-line`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.get("/ai/models/status", async (_req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/models/status`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/models/warmup", async (_req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/models/warmup`, {
      method: "POST",
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

// L2 Stage 2b — Biologics Co-Folding (Boltz-2, AlphaFold3-class structure + affinity)
router.get("/ai/cofold/config", async (_req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/cofold/config`);
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/cofold/validate", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/cofold/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.post("/ai/cofold", async (req, res) => {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/predict/cofold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

router.get("/ai/cofold/status/:jobId", async (req, res) => {
  try {
    const resp = await fetch(
      `${AI_SERVICE_URL}/predict/cofold/status/${encodeURIComponent(req.params.jobId)}`,
    );
    const data = await resp.json();
    res.status(resp.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "AI service unavailable" });
  }
});

export default router;
