import { Router } from "express";

const router = Router();
const AI_SERVICE_URL = "http://localhost:8090";

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

export default router;
