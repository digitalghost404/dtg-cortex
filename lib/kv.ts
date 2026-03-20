import { Redis } from "@upstash/redis";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Dual-mode KV abstraction: Upstash Redis (Vercel) or filesystem (local dev)
// ---------------------------------------------------------------------------

const isRedisMode = !!process.env.KV_REST_API_URL;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
    });
  }
  return redis;
}

// ---------------------------------------------------------------------------
// Filesystem fallback helpers
// ---------------------------------------------------------------------------

const FS_DIR = path.join(process.cwd(), ".cortex-kv");
const resolvedFsDir = path.resolve(FS_DIR);

function fsPath(key: string): string {
  // Use base64url encoding for safe, injective key-to-filename mapping
  const safe = Buffer.from(key).toString("base64url");
  const resolved = path.join(FS_DIR, `${safe}.json`);
  // Path traversal guard
  if (!path.resolve(resolved).startsWith(resolvedFsDir)) {
    throw new Error("KV key path traversal detected");
  }
  return resolved;
}

function ensureFsDir(): void {
  if (!fs.existsSync(FS_DIR)) {
    fs.mkdirSync(FS_DIR, { recursive: true });
  }
}

function fsRead<T>(key: string): T | null {
  try {
    const data = fs.readFileSync(fsPath(key), "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function fsWrite<T>(key: string, value: T): void {
  ensureFsDir();
  fs.writeFileSync(fsPath(key), JSON.stringify(value, null, 2), "utf-8");
}

function fsDelete(key: string): void {
  try {
    fs.unlinkSync(fsPath(key));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// JSON get/set
// ---------------------------------------------------------------------------

export async function getJSON<T>(key: string): Promise<T | null> {
  if (isRedisMode) {
    return getRedis().get<T>(key);
  }
  return fsRead<T>(key);
}

export async function setJSON<T>(key: string, value: T): Promise<void> {
  if (isRedisMode) {
    await getRedis().set(key, value);
    return;
  }
  fsWrite(key, value);
}

export async function deleteKey(key: string): Promise<void> {
  if (isRedisMode) {
    await getRedis().del(key);
    return;
  }
  fsDelete(key);
}

// ---------------------------------------------------------------------------
// Set with TTL
// ---------------------------------------------------------------------------

export async function setWithTTL(key: string, value: string, ttlSec: number): Promise<void> {
  if (isRedisMode) {
    await getRedis().set(key, value, { ex: ttlSec });
    return;
  }
  // Filesystem: store with expiry timestamp
  fsWrite(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

/**
 * Read a value previously written with setWithTTL.
 * In Redis mode the TTL is managed natively, so this is a plain GET.
 * In filesystem mode the expiry envelope is checked and unwrapped.
 * Returns null when the key is absent or has expired.
 */
export async function getWithTTL(key: string): Promise<string | null> {
  if (isRedisMode) {
    return getRedis().get<string>(key);
  }
  const data = fsRead<{ value: string; expiresAt?: number }>(key);
  if (!data) return null;
  if (data.expiresAt && Date.now() > data.expiresAt) {
    fsDelete(key);
    return null;
  }
  return data.value;
}

/**
 * Atomic set-if-not-exists with TTL. Returns true if the key was set (did not exist).
 * Used for TOTP replay prevention.
 */
export async function setNX(key: string, value: string, ttlSec: number): Promise<boolean> {
  if (isRedisMode) {
    const result = await getRedis().set(key, value, { ex: ttlSec, nx: true });
    return result === "OK";
  }
  // Filesystem fallback
  const existing = fsRead<{ value: string; expiresAt?: number }>(key);
  if (existing && (!existing.expiresAt || Date.now() < existing.expiresAt)) {
    return false; // key exists and not expired
  }
  fsWrite(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  return true;
}

export async function exists(key: string): Promise<boolean> {
  if (isRedisMode) {
    const result = await getRedis().exists(key);
    return result === 1;
  }
  const data = fsRead<{ value: string; expiresAt?: number }>(key);
  if (!data) return false;
  if (data.expiresAt && Date.now() > data.expiresAt) {
    fsDelete(key);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hash operations
// ---------------------------------------------------------------------------

export async function hset(key: string, fields: Record<string, string | number>): Promise<void> {
  if (isRedisMode) {
    await getRedis().hset(key, fields);
    return;
  }
  const existing = fsRead<Record<string, string | number>>(key) ?? {};
  fsWrite(key, { ...existing, ...fields });
}

export async function hgetall<T extends Record<string, unknown> = Record<string, string>>(key: string): Promise<T | null> {
  if (isRedisMode) {
    return getRedis().hgetall<T>(key);
  }
  return fsRead<T>(key);
}

export async function hdel(key: string, ...fields: string[]): Promise<void> {
  if (isRedisMode) {
    await getRedis().hdel(key, ...fields);
    return;
  }
  const existing = fsRead<Record<string, unknown>>(key);
  if (existing) {
    for (const f of fields) delete existing[f];
    fsWrite(key, existing);
  }
}

// ---------------------------------------------------------------------------
// Set operations
// ---------------------------------------------------------------------------

export async function sadd(key: string, ...members: string[]): Promise<void> {
  if (isRedisMode) {
    if (members.length > 0) {
      await getRedis().sadd(key, members[0], ...members.slice(1));
    }
    return;
  }
  const existing = fsRead<string[]>(key) ?? [];
  const set = new Set(existing);
  for (const m of members) set.add(m);
  fsWrite(key, [...set]);
}

export async function smembers(key: string): Promise<string[]> {
  if (isRedisMode) {
    return getRedis().smembers(key);
  }
  return fsRead<string[]>(key) ?? [];
}

export async function srem(key: string, ...members: string[]): Promise<void> {
  if (isRedisMode) {
    await getRedis().srem(key, ...members);
    return;
  }
  const existing = fsRead<string[]>(key) ?? [];
  const set = new Set(existing);
  for (const m of members) set.delete(m);
  fsWrite(key, [...set]);
}

// ---------------------------------------------------------------------------
// Sorted set operations
// ---------------------------------------------------------------------------

export async function zadd(key: string, score: number, member: string): Promise<void> {
  if (isRedisMode) {
    await getRedis().zadd(key, { score, member });
    return;
  }
  const existing = fsRead<Array<{ score: number; member: string }>>(key) ?? [];
  const idx = existing.findIndex((e) => e.member === member);
  if (idx >= 0) {
    existing[idx].score = score;
  } else {
    existing.push({ score, member });
  }
  existing.sort((a, b) => a.score - b.score);
  fsWrite(key, existing);
}

export async function zrange(key: string, start: number, end: number): Promise<string[]> {
  if (isRedisMode) {
    return getRedis().zrange(key, start, end);
  }
  const existing = fsRead<Array<{ score: number; member: string }>>(key) ?? [];
  // zrange with negative end means relative to end
  const actualEnd = end < 0 ? existing.length + end + 1 : end + 1;
  return existing.slice(start, actualEnd).map((e) => e.member);
}

export async function zrem(key: string, member: string): Promise<void> {
  if (isRedisMode) {
    await getRedis().zrem(key, member);
    return;
  }
  const existing = fsRead<Array<{ score: number; member: string }>>(key) ?? [];
  fsWrite(key, existing.filter((e) => e.member !== member));
}

// ---------------------------------------------------------------------------
// Rate limiting (atomic INCR + EXPIRE via pipeline)
// ---------------------------------------------------------------------------

export async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  if (isRedisMode) {
    const r = getRedis();
    // Use pipeline for atomic INCR + conditional EXPIRE
    const pipe = r.pipeline();
    pipe.incr(key);
    pipe.expire(key, windowSec, "NX"); // NX: only set expire if not already set
    const results = await pipe.exec();
    const count = results[0] as number;
    return count <= max;
  }
  // Filesystem fallback: sliding window
  const data = fsRead<{ timestamps: number[] }>(key) ?? { timestamps: [] };
  const now = Date.now();
  const windowMs = windowSec * 1000;
  data.timestamps = data.timestamps.filter((t) => now - t < windowMs);
  if (data.timestamps.length >= max) {
    return false;
  }
  data.timestamps.push(now);
  fsWrite(key, data);
  return true;
}

// ---------------------------------------------------------------------------
// Scan keys (for vault note iteration)
// ---------------------------------------------------------------------------

export async function scanKeys(pattern: string): Promise<string[]> {
  if (isRedisMode) {
    const keys: string[] = [];
    let cursor = 0;
    do {
      const result = await getRedis().scan(cursor, { match: pattern, count: 200 });
      cursor = Number(result[0]);
      keys.push(...result[1]);
    } while (cursor !== 0);
    return keys;
  }
  // Filesystem: not used in production; return empty for safety
  return [];
}

// ---------------------------------------------------------------------------
// Multi-get for batch operations
// ---------------------------------------------------------------------------

export async function mget<T>(...keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  if (isRedisMode) {
    return getRedis().mget<(T | null)[]>(...keys);
  }
  return keys.map((k) => fsRead<T>(k));
}
