import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes/index.js";
import authRouter from "./routes/auth.js";
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

// 3. /api/auth — public, internally rate-limited and CSRF-protected
app.use("/api/auth", authRouter);

// 4. /api — everything else, behind a global API rate limit
app.use("/api", apiRateLimit(), router);

// 5. SPA static
const frontendDistPath = path.resolve(__dirname, "../../hakase-ai/dist");
if (existsSync(frontendDistPath)) {
  console.log(`[api-server] Serving static files from: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath, { maxAge: "1h", index: false }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
} else {
  console.warn(
    `[api-server] Frontend build not found at: ${frontendDistPath}. Run 'pnpm run build' first to enable frontend serving.`,
  );
}

// 6. 404 + error handler last
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
