import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcrypt";
import { generateSecret as otpGenerateSecret, verifySync as otpVerifySync, generateURI as otpGenerateURI } from "otplib";
import crypto from "crypto";
import * as kv from "./kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthConfig {
  passwordHash: string;
  totpSecret: string;
  setupComplete: boolean;
}

// ---------------------------------------------------------------------------
// Config I/O (dual-mode via kv)
// ---------------------------------------------------------------------------

const AUTH_KEY = "auth:config";

export async function getAuthConfig(): Promise<AuthConfig | null> {
  try {
    return await kv.getJSON<AuthConfig>(AUTH_KEY);
  } catch {
    return null;
  }
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  await kv.setJSON(AUTH_KEY, config);
}

export async function isSetupComplete(): Promise<boolean> {
  const config = await getAuthConfig();
  return config?.setupComplete === true;
}

// ---------------------------------------------------------------------------
// Password (M-1: enforce 12 char min, 72 byte max for bcrypt)
// ---------------------------------------------------------------------------

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;

export function validatePassword(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (new TextEncoder().encode(plain).length > MAX_PASSWORD_BYTES) {
    return `Password must not exceed ${MAX_PASSWORD_BYTES} bytes`;
  }
  if (!/[a-z]/.test(plain)) return "Password must contain a lowercase letter";
  if (!/[A-Z]/.test(plain)) return "Password must contain an uppercase letter";
  if (!/[0-9]/.test(plain)) return "Password must contain a digit";
  if (!/[^a-zA-Z0-9]/.test(plain)) return "Password must contain a special character";
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// TOTP (M-2: replay prevention)
// ---------------------------------------------------------------------------

export function generateTotpSecret(): string {
  return otpGenerateSecret();
}

export function verifyTotp(token: string, secret: string): boolean {
  const result = otpVerifySync({ token, secret });
  return result.valid;
}

export async function verifyTotpWithReplay(token: string, secret: string): Promise<boolean> {
  const valid = verifyTotp(token, secret);
  if (!valid) return false;

  // Atomic replay prevention: setNX ensures only the first use of a token succeeds.
  // TTL of 60s covers the current TOTP window (30s) plus adjacency tolerance.
  const replayKey = `totp:used:${token}`;
  const wasNew = await kv.setNX(replayKey, "1", 60);
  return wasNew;
}

export function getTotpUri(secret: string): string {
  return otpGenerateURI({ secret, issuer: "Cortex", label: "owner" });
}

// ---------------------------------------------------------------------------
// JWT (H-2: iss/aud/jti, H-5: revocation)
// ---------------------------------------------------------------------------

const JWT_EXPIRY = "24h";
const COOKIE_NAME = "cortex-token";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return new TextEncoder().encode(secret);
}

export async function signJWT(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("cortex")
    .setAudience("cortex-owner")
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getJwtSecret());
}

export async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "cortex",
      audience: "cortex-owner",
    });

    // Check revocation
    if (payload.jti && await isTokenRevoked(payload.jti)) {
      return null;
    }

    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token revocation (H-5) — uses Redis SET+TTL per revoked jti
// ---------------------------------------------------------------------------

export async function revokeToken(token: string): Promise<void> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "cortex",
      audience: "cortex-owner",
    });
    if (!payload.jti) return;

    const now = Math.floor(Date.now() / 1000);
    const exp = (payload.exp as number) || now + 86400;
    const ttl = Math.max(exp - now, 1);

    await kv.setWithTTL(`revoked:${payload.jti}`, "1", ttl);
  } catch {
    // Token already invalid — nothing to revoke
  }
}

async function isTokenRevoked(jti: string): Promise<boolean> {
  return kv.exists(`revoked:${jti}`);
}

// ---------------------------------------------------------------------------
// Rate limiting (Redis INCR+EXPIRE or filesystem fallback)
// ---------------------------------------------------------------------------

const LOGIN_RATE_LIMIT = { maxAttempts: 5, windowMs: 15 * 60 * 1000 }; // 5 per 15 min
const SETUP_RATE_LIMIT = { maxAttempts: 10, windowMs: 15 * 60 * 1000 }; // 10 per 15 min

export async function checkRateLimit(
  key: string,
  limit: { maxAttempts: number; windowMs: number } = LOGIN_RATE_LIMIT
): Promise<boolean> {
  const windowSec = Math.ceil(limit.windowMs / 1000);
  return kv.rateLimit(`ratelimit:${key}`, limit.maxAttempts, windowSec);
}

export { COOKIE_NAME, LOGIN_RATE_LIMIT, SETUP_RATE_LIMIT };
