/**
 * Validated environment surface.
 * Boot fails LOUD if anything required is missing.
 * No silent fallbacks — that's an explicit project rule.
 */
import { z } from "zod";

const bool = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((v) => v === true || v === "true");

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive(),

  // Public canonical URL (used for CORS, OAuth redirect URIs, cookie domain).
  APP_URL: z
    .string()
    .url()
    .describe(
      "Canonical public URL of the app, e.g. http://localhost:3000 in dev, https://app.hakase.ai in prod.",
    ),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Auth secrets — generate with: openssl rand -base64 48
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  COOKIE_SECRET: z.string().min(32, "COOKIE_SECRET must be at least 32 chars"),
  CSRF_SECRET: z.string().min(32, "CSRF_SECRET must be at least 32 chars"),

  // Resend (email)
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  EMAIL_FROM: z
    .string()
    .min(3)
    .default("Hakase BioTwin <no-reply@hakase.ai>"),

  // OAuth — Google
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  // OAuth — Apple
  APPLE_CLIENT_ID: z.string().min(1).optional(), // services ID
  APPLE_TEAM_ID: z.string().min(1).optional(),
  APPLE_KEY_ID: z.string().min(1).optional(),
  APPLE_PRIVATE_KEY: z.string().min(1).optional(), // PEM with literal \n

  // RunPod (Layer 2)
  GPU_PROVIDER: z
    .enum(["local", "runpod", "aws", "azure"])
    .default("local"),
  RUNPOD_API_KEY: z.string().min(1).optional(),
  RUNPOD_FEP_ENDPOINT_ID: z.string().min(1).optional(),
  RUNPOD_BOLTZ_ENDPOINT_ID: z.string().min(1).optional(),

  // Security tuning
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().positive().default(120),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(60 * 15), // 15 min
  REFRESH_TOKEN_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30), // 30 days
  ACCOUNT_LOCK_THRESHOLD: z.coerce.number().int().positive().default(8),
  ACCOUNT_LOCK_WINDOW_MIN: z.coerce.number().int().positive().default(15),

  TRUST_PROXY: bool.default(false),
  ENABLE_CSP: bool.default(true),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Loud, structured, fatal. No silent fallback.
    console.error(
      "\n[api-server] FATAL: environment validation failed.\n" + issues + "\n",
    );
    throw new Error("Environment validation failed");
  }
  cached = parsed.data;
  return cached;
}

/**
 * Cross-cuts: hosts allowed by CORS. We expand APP_URL into origin and
 * also accept the same origin without the path. localhost variants are
 * accepted only in development.
 */
export function allowedOrigins(env: AppEnv): string[] {
  const set = new Set<string>();
  set.add(new URL(env.APP_URL).origin);
  if (env.NODE_ENV !== "production") {
    set.add("http://localhost:3000");
    set.add("http://localhost:5173");
    set.add("http://127.0.0.1:3000");
    set.add("http://127.0.0.1:5173");
  }
  return [...set];
}
