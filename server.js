const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const DIST = path.join(__dirname, "dist");
const PORT = 7860;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain",
};

const STUB_ENDPOINTS = {
  "/api/health": { status: "ok", service: "HakaseBio (frontend-only)", mode: "demo" },
  "/health": { status: "ok" },
  "/models/status": {},
  "/predict/pbpk/species": {
    schema_version: "hakase.pbpk.species-catalogue.v1",
    species: [
      { id: "rat", label: "Rat", default_strain: "sprague_dawley", reference_body_weight_kg: 0.25, strains: [{ id: "sprague_dawley", label: "Sprague Dawley", reference_body_weight_kg: 0.25 }] },
      { id: "mouse", label: "Mouse", default_strain: "cd1", reference_body_weight_kg: 0.025, strains: [{ id: "cd1", label: "Cd1", reference_body_weight_kg: 0.025 }] },
      { id: "dog", label: "Dog", default_strain: "beagle", reference_body_weight_kg: 10.0, strains: [{ id: "beagle", label: "Beagle", reference_body_weight_kg: 10.0 }] },
      { id: "monkey", label: "Monkey", default_strain: "cynomolgus", reference_body_weight_kg: 3.5, strains: [{ id: "cynomolgus", label: "Cynomolgus", reference_body_weight_kg: 3.5 }] },
    ],
  },
};

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith("/api") || pathname.startsWith("/predict") ||
      pathname.startsWith("/models") || pathname.startsWith("/registry") ||
      pathname === "/health") {

    const stub = STUB_ENDPOINTS[pathname];
    if (stub) {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(stub));
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      res.end();
      return;
    }

    res.writeHead(503, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      error: "Backend not connected",
      message: "This is a frontend-only deployment. The AI/ML backend is not available in this demo.",
      available: false,
    }));
    return;
  }

  let filePath = path.join(DIST, pathname === "/" ? "index.html" : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST, "index.html");
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(PORT, "0.0.0.0", () => {
  console.log(`HakaseBio running on :${PORT}`);
});
