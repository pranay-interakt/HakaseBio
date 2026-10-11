import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API runs separately (uvicorn hos.api.app:app --port 8000); /api is proxied to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
});
