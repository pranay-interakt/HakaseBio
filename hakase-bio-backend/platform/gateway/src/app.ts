import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes/index.js";
import { rootMounts } from "./routes/ai-service.js";
import { loadEnv } from "./lib/env.js";
import {
  apiRateLimit,
  installSecurity,
} from "./middlewares/security.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = loadEnv();
const app: Express = express();

// 1. security headers / cors / ip-block / proxy trust
installSecurity(app);

// 2. body parsers + signed cookies
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser(env.COOKIE_SECRET));
app.use(compression());

// 3. Authentication is intentionally not mounted while the workspace is in
// open-access development mode. The implementation remains isolated in
// routes/auth.ts for a later reintroduction.

// 4. Modality wildcard prefixes are also served at the server root, because
//    some clients call them directly rather than under /api (the frontend hits
//    /v3/peptide/* for example). The prefixes come from each modality's own
//    route spec, so this needs no edit when a modality is added.
for (const { prefix, router: modalityRouter } of rootMounts) {
  app.use(prefix, apiRateLimit(), modalityRouter);
}

// 5. /api — everything else, behind a global API rate limit
app.use("/api", apiRateLimit(), router);

// 5. SPA static (OPTIONAL).
// In the standard split deployment the frontend is hosted separately (its own
// repo, served by nginx/PM2), so the backend runs API-only and this block is a
// no-op. To have the API also serve a built SPA (single-host setups), set
// FRONTEND_DIST_PATH to the built `dist` directory. Falls back to a co-located
// frontend build if one happens to exist next to the backend.
const frontendDistPath = process.env.FRONTEND_DIST_PATH
  ? path.resolve(process.env.FRONTEND_DIST_PATH)
  : path.resolve(__dirname, "../../hakase-ai/dist");
if (existsSync(frontendDistPath)) {
  console.log(`[api-server] Serving static files from: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath, { maxAge: "1h", index: false }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
} else {
  console.log(
    "[api-server] Running API-only (no SPA build found). " +
      "Set FRONTEND_DIST_PATH to also serve a built frontend from this server.",
  );
}

// 6. 404 + error handler last
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
