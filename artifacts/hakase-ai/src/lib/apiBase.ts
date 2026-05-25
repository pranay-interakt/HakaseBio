/**
 * apiBase — single source of truth for the backend API origin.
 *
 * Same-origin deployments (RunPod pod, DigitalOcean single VPS, localhost):
 *   VITE_API_BASE_URL is not set → API_ROOT = "" → all /api/* calls are relative ✓
 *
 * Cross-origin deployments (Vercel frontend + separate backend):
 *   Set VITE_API_BASE_URL=https://your-backend.example.com in Vercel project env vars
 *   → API_ROOT = "https://your-backend.example.com" → calls go to the correct origin ✓
 *
 * Usage:
 *   import { API_ROOT } from "@/lib/apiBase";
 *   fetch(`${API_ROOT}/api/something`)
 */
export const API_ROOT: string = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
