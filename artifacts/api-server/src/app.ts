import express, { type Express } from "express";
import cors from "cors";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve frontend static assets in production
const frontendDistPath = path.resolve(__dirname, "../../hakase-ai/dist");
if (existsSync(frontendDistPath)) {
  console.log(`[api-server] Serving static files from: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath));
  
  // SPA fallback: redirect all unhandled requests to index.html
  app.use((req, res) => {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
} else {
  console.warn(`[api-server] Frontend build not found at: ${frontendDistPath}. Run 'pnpm run build' first to enable frontend serving.`);
}

export default app;
