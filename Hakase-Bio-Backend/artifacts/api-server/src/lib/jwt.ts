/**
 * JWT helpers — HS256, short-lived access tokens only.
 * Refresh tokens are opaque (stored hashed in DB) — see auth/service.ts.
 */
import jwt from "jsonwebtoken";
import { loadEnv } from "./env.js";

export interface AccessTokenPayload {
  sub: string; // user id
  sid: string; // session id (so we can revoke individual sessions)
  role: string;
  email: string;
  email_verified: boolean;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const env = loadEnv();
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: "HS256",
    expiresIn: env.ACCESS_TOKEN_TTL_SEC,
    issuer: "hakase-biotwin",
    audience: "hakase-biotwin-web",
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const env = loadEnv();
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ["HS256"],
    issuer: "hakase-biotwin",
    audience: "hakase-biotwin-web",
  }) as AccessTokenPayload;
}
