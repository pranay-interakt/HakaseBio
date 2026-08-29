import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";

const rdkitDir = path.resolve("node_modules/@rdkit/rdkit/dist");
const rdkitAssets = ["RDKit_minimal.js", "RDKit_minimal.wasm"] as const;

/** Expose RDKit's paired JS/WASM assets in dev and include them in production. */
function serveRdkitAssets() {
  return {
    name: "serve-rdkit-assets",
    configureServer(server: any) {
      server.middlewares.use((request: any, response: any, next: () => void) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const asset = rdkitAssets.find((file) => pathname === `/rdkit/${file}`);
        if (!asset) return next();
        response.setHeader("Content-Type", asset.endsWith(".wasm") ? "application/wasm" : "application/javascript");
        response.end(readFileSync(path.join(rdkitDir, asset)));
      });
    },
    generateBundle(this: { emitFile(file: { type: "asset"; fileName: string; source: Uint8Array }): void }) {
      for (const asset of rdkitAssets) {
        this.emitFile({ type: "asset", fileName: `rdkit/${asset}`, source: readFileSync(path.join(rdkitDir, asset)) });
      }
    },
  };
}

export default defineConfig({
  // GitHub Pages serves this repository at /HakaseBio/. Local development
  // stays at /, while the deployment workflow supplies the public base path.
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react(), serveRdkitAssets()],
  server: { port: 5178, host: "0.0.0.0" },
  preview: { port: 5178, host: "0.0.0.0" },
});
