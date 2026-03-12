import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcrypt";
import { generateSecret as otpGenerateSecret, verifySync as otpVerifySync, generateURI as otpGenerateURI } from "otplib";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Config file path
// ---------------------------------------------------------------------------

const AUTH_CONFIG_PATH = path.join(process.cwd(), ".cortex-auth.json");
const REVOCATION_PATH = path.join(process.cwd(), ".cortex-revoked.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthConfig {
  passwordHash: string;
  totpSecret: string;
  setupComplete: boolean;
  lastTotpWindow?: number;  // TOTP replay prevention
  lastTotpToken?: string;
}

// ---------------------------------------------------------------------------
// Config I/O (H-3: file permissions 0o600)
// ---------------------------------------------------------------------------

export async function getAuthConfig(): Promise<AuthConfig | null> {
  try {
    const data = await fs.readFile(AUTH_CONFIG_PATH, "utf-8");
    return JSON.parse(data) as AuthConfig;
  } catch {
    return null;
  }
}

export async function saveAuthConfig(config: AuthConfig): Promise<void> {
  await fs.writeFile(AUTH_CONFIG_PATH, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
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

  const currentWindow = Math.floor(Date.now() / 30000);
  const config = await getAuthConfig();

  // Reject reuse of same token in same window
  if (config && config.lastTotpToken === token && config.lastTotpWindow === currentWindow) {
    return false;
  }

  // Record this token usage
  if (config) {
    config.lastTotpToken = token;
    config.lastTotpWindow = currentWindow;
    await saveAuthConfig(config);
  }

  return true;
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

    // Check revocation list
    if (payload.jti && await isTokenRevoked(payload.jti)) {
      return null;
    }

    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token revocation (H-5)
// ---------------------------------------------------------------------------

interface RevocationList {
  revoked: { jti: string; exp: number }[];
}

async function getRevocationList(): Promise<RevocationList> {
  try {
    const data = await fs.readFile(REVOCATION_PATH, "utf-8");
    return JSON.parse(data) as RevocationList;
  } catch {
    return { revoked: [] };
  }
}

async function saveRevocationList(list: RevocationList): Promise<void> {
  await fs.writeFile(REVOCATION_PATH, JSON.stringify(list, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function revokeToken(token: string): Promise<void> {
  try {
    // Decode without full verification to get jti/exp (we're revoking it, not trusting it)
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "cortex",
      audience: "cortex-owner",
    });
    if (!payload.jti) return;

    const list = await getRevocationList();
    const now = Math.floor(Date.now() / 1000);

    // Prune expired entries
    list.revoked = list.revoked.filter((r) => r.exp > now);

    // Add this token
    list.revoked.push({
      jti: payload.jti,
      exp: (payload.exp as number) || now + 86400,
    });

    await saveRevocationList(list);
  } catch {
    // Token already invalid — nothing to revoke
  }
}

async function isTokenRevoked(jti: string): Promise<boolean> {
  const list = await getRevocationList();
  return list.revoked.some((r) => r.jti === jti);
}

// ---------------------------------------------------------------------------
// Rate limiting (C-2: in-process sliding window)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const LOGIN_RATE_LIMIT = { maxAttempts: 5, windowMs: 15 * 60 * 1000 }; // 5 per 15 min
const SETUP_RATE_LIMIT = { maxAttempts: 10, windowMs: 15 * 60 * 1000 }; // 10 per 15 min

export function checkRateLimit(
  key: string,
  limit: { maxAttempts: number; windowMs: number } = LOGIN_RATE_LIMIT
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { timestamps: [] };

  // Prune old entries
  entry.timestamps = entry.timestamps.filter((t) => now - t < limit.windowMs);

  if (entry.timestamps.length >= limit.maxAttempts) {
    return false; // Rate limited
  }

  entry.timestamps.push(now);
  rateLimitStore.set(key, entry);
  return true; // Allowed
}

export { COOKIE_NAME, LOGIN_RATE_LIMIT, SETUP_RATE_LIMIT };
