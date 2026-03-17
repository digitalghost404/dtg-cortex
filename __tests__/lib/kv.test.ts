// ---------------------------------------------------------------------------
// kv.test.ts — filesystem mode (no KV_REST_API_URL set)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @upstash/redis before module import so the Redis constructor is never
// reached in the test environment.
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}));

// Mock fs so all disk I/O is fully controlled in tests.
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

import fs from "fs";
import {
  getJSON,
  setJSON,
  deleteKey,
  setWithTTL,
  setNX,
  exists,
  hset,
  hgetall,
  hdel,
  sadd,
  smembers,
  srem,
  zadd,
  zrange,
  zrem,
  rateLimit,
  scanKeys,
  mget,
} from "@/lib/kv";

// ---------------------------------------------------------------------------
// Typed aliases so TypeScript knows these are mocks
// ---------------------------------------------------------------------------
const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = fs.mkdirSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = fs.writeFileSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = fs.unlinkSync as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a key the same way fsPath does, return the JSON written by the last
 *  writeFileSync call parsed back to a value. */
function lastWritten(): unknown {
  const calls = mockWriteFileSync.mock.calls;
  if (calls.length === 0) return undefined;
  const lastCall = calls[calls.length - 1];
  return JSON.parse(lastCall[1] as string);
}

/** Simulate fs.readFileSync returning a stored JSON value for a given key. */
function mockRead(value: unknown): void {
  mockReadFileSync.mockReturnValueOnce(JSON.stringify(value));
}

/** Simulate fs.readFileSync throwing (key not found). */
function mockReadMissing(): void {
  mockReadFileSync.mockImplementationOnce(() => {
    throw new Error("ENOENT");
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: directory already exists so ensureFsDir skips mkdir.
  mockExistsSync.mockReturnValue(true);
  // Default: reads throw (key not found).
  mockReadFileSync.mockImplementation(() => {
    throw new Error("ENOENT");
  });
});

// ---------------------------------------------------------------------------
// getJSON
// ---------------------------------------------------------------------------

describe("getJSON", () => {
  it("returns parsed value when file exists", async () => {
    mockRead({ hello: "world" });
    const result = await getJSON<{ hello: string }>("my-key");
    expect(result).toEqual({ hello: "world" });
  });

  it("returns null when file does not exist", async () => {
    const result = await getJSON("missing-key");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setJSON
// ---------------------------------------------------------------------------

describe("setJSON", () => {
  it("writes JSON to disk", async () => {
    await setJSON("k", { a: 1 });
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    expect(lastWritten()).toEqual({ a: 1 });
  });

  it("creates the directory when it does not exist yet", async () => {
    mockExistsSync.mockReturnValue(false);
    await setJSON("k", "value");
    expect(mockMkdirSync).toHaveBeenCalledOnce();
  });

  it("skips mkdir when directory already exists", async () => {
    mockExistsSync.mockReturnValue(true);
    await setJSON("k", "value");
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteKey
// ---------------------------------------------------------------------------

describe("deleteKey", () => {
  it("calls unlinkSync for the key", async () => {
    await deleteKey("some-key");
    expect(mockUnlinkSync).toHaveBeenCalledOnce();
  });

  it("swallows errors when the file does not exist", async () => {
    mockUnlinkSync.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    await expect(deleteKey("ghost-key")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setWithTTL
// ---------------------------------------------------------------------------

describe("setWithTTL", () => {
  it("stores value with an expiresAt timestamp", async () => {
    const before = Date.now();
    await setWithTTL("ttl-key", "hello", 60);
    const written = lastWritten() as { value: string; expiresAt: number };
    expect(written.value).toBe("hello");
    expect(written.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(written.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});

// ---------------------------------------------------------------------------
// setNX
// ---------------------------------------------------------------------------

describe("setNX", () => {
  it("returns true and writes when key does not exist", async () => {
    // readFileSync throws -> fsRead returns null -> key absent
    const result = await setNX("new-key", "v", 30);
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it("returns false when key exists and has not expired", async () => {
    mockRead({ value: "old", expiresAt: Date.now() + 60_000 });
    const result = await setNX("existing-key", "v", 30);
    expect(result).toBe(false);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("returns false when key exists with no expiresAt (permanent key)", async () => {
    mockRead({ value: "old" });
    const result = await setNX("perm-key", "v", 30);
    expect(result).toBe(false);
  });

  it("returns true and overwrites when existing key has expired", async () => {
    mockRead({ value: "old", expiresAt: Date.now() - 1 });
    const result = await setNX("expired-key", "v", 30);
    expect(result).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe("exists", () => {
  it("returns false when file does not exist", async () => {
    expect(await exists("missing")).toBe(false);
  });

  it("returns true when data is present and not expired", async () => {
    mockRead({ value: "x", expiresAt: Date.now() + 60_000 });
    expect(await exists("live-key")).toBe(true);
  });

  it("returns true when data is present with no expiresAt", async () => {
    mockRead({ value: "x" });
    expect(await exists("perm-key")).toBe(true);
  });

  it("returns false and deletes when key has expired", async () => {
    mockRead({ value: "x", expiresAt: Date.now() - 1 });
    const result = await exists("stale-key");
    expect(result).toBe(false);
    // Should call unlinkSync to clean up the expired key
    expect(mockUnlinkSync).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// hset
// ---------------------------------------------------------------------------

describe("hset", () => {
  it("writes new fields when no existing hash", async () => {
    await hset("h", { a: "1", b: 2 });
    expect(lastWritten()).toEqual({ a: "1", b: 2 });
  });

  it("merges new fields onto existing hash", async () => {
    mockRead({ a: "old", c: "keep" });
    await hset("h", { a: "new", b: "added" });
    expect(lastWritten()).toEqual({ a: "new", b: "added", c: "keep" });
  });
});

// ---------------------------------------------------------------------------
// hgetall
// ---------------------------------------------------------------------------

describe("hgetall", () => {
  it("returns the stored object", async () => {
    mockRead({ x: "1", y: "2" });
    const result = await hgetall("h");
    expect(result).toEqual({ x: "1", y: "2" });
  });

  it("returns null when key is absent", async () => {
    expect(await hgetall("missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hdel
// ---------------------------------------------------------------------------

describe("hdel", () => {
  it("removes specified fields and rewrites", async () => {
    mockRead({ a: "1", b: "2", c: "3" });
    await hdel("h", "a", "c");
    expect(lastWritten()).toEqual({ b: "2" });
  });

  it("is a no-op when key does not exist", async () => {
    // readFileSync throws -> fsRead returns null
    await hdel("missing", "field");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sadd / smembers / srem
// ---------------------------------------------------------------------------

describe("sadd", () => {
  it("creates a new set from scratch", async () => {
    await sadd("s", "a", "b");
    expect(lastWritten()).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("adds members to an existing set and deduplicates", async () => {
    mockRead(["a", "b"]);
    await sadd("s", "b", "c");
    const written = lastWritten() as string[];
    expect(written).toHaveLength(3);
    expect(written).toContain("c");
  });
});

describe("smembers", () => {
  it("returns the stored array", async () => {
    mockRead(["x", "y"]);
    expect(await smembers("s")).toEqual(["x", "y"]);
  });

  it("returns empty array when key does not exist", async () => {
    expect(await smembers("missing")).toEqual([]);
  });
});

describe("srem", () => {
  it("removes specified members", async () => {
    mockRead(["a", "b", "c"]);
    await srem("s", "b");
    expect(lastWritten()).toEqual(["a", "c"]);
  });

  it("removes multiple members at once", async () => {
    mockRead(["a", "b", "c", "d"]);
    await srem("s", "a", "d");
    const written = lastWritten() as string[];
    expect(written).not.toContain("a");
    expect(written).not.toContain("d");
    expect(written).toContain("b");
  });

  it("handles removal from non-existent key gracefully", async () => {
    await srem("missing", "x");
    // Should still write an empty array (empty set after no-op removal)
    expect(lastWritten()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// zadd / zrange / zrem
// ---------------------------------------------------------------------------

describe("zadd", () => {
  it("adds a new member to an empty sorted set", async () => {
    await zadd("z", 100, "alpha");
    expect(lastWritten()).toEqual([{ score: 100, member: "alpha" }]);
  });

  it("updates score for an existing member", async () => {
    mockRead([{ score: 10, member: "alpha" }]);
    await zadd("z", 99, "alpha");
    const written = lastWritten() as Array<{ score: number; member: string }>;
    expect(written).toHaveLength(1);
    expect(written[0].score).toBe(99);
  });

  it("maintains ascending sort order by score", async () => {
    mockRead([
      { score: 50, member: "b" },
      { score: 10, member: "a" },
    ]);
    await zadd("z", 30, "c");
    const written = lastWritten() as Array<{ score: number; member: string }>;
    expect(written.map((e) => e.member)).toEqual(["a", "c", "b"]);
  });

  it("creates set when key does not exist", async () => {
    await zadd("z", 42, "only");
    expect((lastWritten() as Array<unknown>)).toHaveLength(1);
  });
});

describe("zrange", () => {
  /** Seed the 3-element sorted set for a single read call. */
  function seedZrangeSet(): void {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify([
        { score: 1, member: "a" },
        { score: 2, member: "b" },
        { score: 3, member: "c" },
      ])
    );
  }

  it("returns members for a positive range [0, 1]", async () => {
    seedZrangeSet();
    expect(await zrange("z", 0, 1)).toEqual(["a", "b"]);
  });

  it("returns all members for [0, 2]", async () => {
    seedZrangeSet();
    expect(await zrange("z", 0, 2)).toEqual(["a", "b", "c"]);
  });

  it("returns all members for negative end -1 (full range)", async () => {
    seedZrangeSet();
    expect(await zrange("z", 0, -1)).toEqual(["a", "b", "c"]);
  });

  it("returns last element for [2, -1]", async () => {
    seedZrangeSet();
    expect(await zrange("z", 2, -1)).toEqual(["c"]);
  });

  it("returns empty array when key does not exist", async () => {
    // readFileSync already throws by default (set in top-level beforeEach)
    expect(await zrange("empty-z", 0, -1)).toEqual([]);
  });
});

describe("zrem", () => {
  it("removes the specified member", async () => {
    mockRead([
      { score: 1, member: "a" },
      { score: 2, member: "b" },
    ]);
    await zrem("z", "a");
    expect(lastWritten()).toEqual([{ score: 2, member: "b" }]);
  });

  it("is a no-op for a member that does not exist", async () => {
    mockRead([{ score: 1, member: "a" }]);
    await zrem("z", "ghost");
    expect(lastWritten()).toEqual([{ score: 1, member: "a" }]);
  });

  it("handles empty set gracefully", async () => {
    await zrem("missing-z", "x");
    expect(lastWritten()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rateLimit
// ---------------------------------------------------------------------------

describe("rateLimit", () => {
  it("allows requests up to the max limit", async () => {
    // First call: no existing timestamps
    expect(await rateLimit("rl", 3, 60)).toBe(true);

    // Subsequent calls within the window: simulate accumulating timestamps
    mockRead({ timestamps: [Date.now() - 100] });
    expect(await rateLimit("rl", 3, 60)).toBe(true);

    mockRead({ timestamps: [Date.now() - 200, Date.now() - 100] });
    expect(await rateLimit("rl", 3, 60)).toBe(true);
  });

  it("rejects when the window is full", async () => {
    const now = Date.now();
    mockRead({ timestamps: [now - 300, now - 200, now - 100] });
    expect(await rateLimit("rl", 3, 60)).toBe(false);
  });

  it("allows again after timestamps have slid outside the window", async () => {
    const old = Date.now() - 120_000; // 2 minutes ago — outside a 60-second window
    mockRead({ timestamps: [old, old, old] });
    expect(await rateLimit("rl", 3, 60)).toBe(true);
  });

  it("filters expired timestamps and counts only recent ones", async () => {
    const now = Date.now();
    const stale = now - 90_000; // outside 60-second window
    // 2 stale + 2 recent; max = 3, so should still allow (only 2 count)
    mockRead({ timestamps: [stale, stale, now - 1000, now - 500] });
    expect(await rateLimit("rl", 3, 60)).toBe(true);
  });

  it("pushes the current timestamp when allowed", async () => {
    await rateLimit("rl", 5, 60);
    const written = lastWritten() as { timestamps: number[] };
    expect(written.timestamps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// scanKeys
// ---------------------------------------------------------------------------

describe("scanKeys", () => {
  it("returns an empty array in filesystem mode", async () => {
    expect(await scanKeys("vault:note:*")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mget
// ---------------------------------------------------------------------------

describe("mget", () => {
  it("returns empty array for zero keys", async () => {
    expect(await mget()).toEqual([]);
  });

  it("returns an array with null for missing keys", async () => {
    // readFileSync already throws by default -> fsRead returns null
    const result = await mget<string>("k1", "k2");
    expect(result).toEqual([null, null]);
  });

  it("returns values for keys that exist", async () => {
    mockRead("first");
    mockRead("second");
    const result = await mget<string>("k1", "k2");
    expect(result).toEqual(["first", "second"]);
  });

  it("mixes found and missing keys correctly", async () => {
    mockRead({ id: "obj" });
    // Second key throws -> null
    const result = await mget<unknown>("k1", "k2");
    expect(result[0]).toEqual({ id: "obj" });
    expect(result[1]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Redis mode — dynamic import with KV_REST_API_URL stubbed
// These tests cover the isRedisMode=true branches that are unreachable when
// the module is loaded without the env variable set.
//
// Because kv.ts calls `new Redis(...)` and caches the instance in a module-
// level variable, we must:
//   1. Reset modules before each load so the singleton is re-created.
//   2. Use a proper function constructor (not an arrow function) in the mock
//      so `new Redis(...)` works correctly.
//   3. Expose the mock redis methods via a shared mutable object that the
//      constructor populates, so individual tests can adjust return values.
// ---------------------------------------------------------------------------

describe("Redis mode (dynamic import)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // Shared container — the Redis constructor writes its mock methods here
  // so tests can reference them after import.
  const shared = {
    pipeline: null as null | {
      incr: ReturnType<typeof vi.fn>;
      expire: ReturnType<typeof vi.fn>;
      exec: ReturnType<typeof vi.fn>;
    },
    redis: null as null | Record<string, ReturnType<typeof vi.fn>>,
  };

  async function loadRedisKv() {
    vi.stubEnv("KV_REST_API_URL", "https://fake.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "fake-token");
    vi.resetModules();

    vi.doMock("@upstash/redis", () => {
      const pipeline = {
        incr: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([1, 1]),
      };
      const methods = {
        get: vi.fn().mockResolvedValue("value"),
        set: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
        exists: vi.fn().mockResolvedValue(1),
        hset: vi.fn().mockResolvedValue(1),
        hgetall: vi.fn().mockResolvedValue({ a: "1" }),
        hdel: vi.fn().mockResolvedValue(1),
        sadd: vi.fn().mockResolvedValue(1),
        smembers: vi.fn().mockResolvedValue(["x"]),
        srem: vi.fn().mockResolvedValue(1),
        zadd: vi.fn().mockResolvedValue(1),
        zrange: vi.fn().mockResolvedValue(["m"]),
        zrem: vi.fn().mockResolvedValue(1),
        mget: vi.fn().mockResolvedValue(["a", null]),
        scan: vi.fn().mockResolvedValue([0, ["key1"]]),
        pipeline: vi.fn().mockReturnValue(pipeline),
      };
      // Populate the shared container so tests can inspect / mutate mocks
      shared.pipeline = pipeline;
      shared.redis = methods;

      // Must use function constructor — arrow functions can't be `new`-ed
      function RedisMock() {
        Object.assign(this as object, methods);
      }

      return { Redis: RedisMock };
    });

    vi.doMock("fs", () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn().mockImplementation(() => { throw new Error("ENOENT"); }),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      },
    }));

    const mod = await import("@/lib/kv");
    return { mod };
  }

  it("getJSON delegates to redis.get in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    const result = await mod.getJSON("some-key");
    expect(shared.redis!.get).toHaveBeenCalledWith("some-key");
    expect(result).toBe("value");
  });

  it("setJSON delegates to redis.set in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.setJSON("k", { x: 1 });
    expect(shared.redis!.set).toHaveBeenCalledWith("k", { x: 1 });
  });

  it("deleteKey delegates to redis.del in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.deleteKey("k");
    expect(shared.redis!.del).toHaveBeenCalledWith("k");
  });

  it("setWithTTL delegates to redis.set with ex option in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.setWithTTL("k", "v", 30);
    expect(shared.redis!.set).toHaveBeenCalledWith("k", "v", { ex: 30 });
  });

  it("setNX returns true when redis.set returns OK", async () => {
    const { mod } = await loadRedisKv();
    const result = await mod.setNX("k", "v", 30);
    expect(result).toBe(true);
  });

  it("setNX returns false when redis.set returns null", async () => {
    const { mod } = await loadRedisKv();
    shared.redis!.set.mockResolvedValueOnce(null);
    const result = await mod.setNX("k", "v", 30);
    expect(result).toBe(false);
  });

  it("exists returns true when redis.exists returns 1", async () => {
    const { mod } = await loadRedisKv();
    expect(await mod.exists("k")).toBe(true);
  });

  it("exists returns false when redis.exists returns 0", async () => {
    const { mod } = await loadRedisKv();
    shared.redis!.exists.mockResolvedValueOnce(0);
    expect(await mod.exists("k")).toBe(false);
  });

  it("hset delegates to redis.hset in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.hset("h", { field: "val" });
    expect(shared.redis!.hset).toHaveBeenCalledWith("h", { field: "val" });
  });

  it("hgetall delegates to redis.hgetall in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    const result = await mod.hgetall("h");
    expect(shared.redis!.hgetall).toHaveBeenCalledWith("h");
    expect(result).toEqual({ a: "1" });
  });

  it("hdel delegates to redis.hdel in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.hdel("h", "f1", "f2");
    expect(shared.redis!.hdel).toHaveBeenCalledWith("h", "f1", "f2");
  });

  it("sadd calls redis.sadd once per member in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.sadd("s", "a", "b");
    expect(shared.redis!.sadd).toHaveBeenCalledTimes(2);
  });

  it("smembers delegates to redis.smembers in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    const result = await mod.smembers("s");
    expect(shared.redis!.smembers).toHaveBeenCalledWith("s");
    expect(result).toEqual(["x"]);
  });

  it("srem delegates to redis.srem in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.srem("s", "a", "b");
    expect(shared.redis!.srem).toHaveBeenCalledWith("s", "a", "b");
  });

  it("zadd delegates to redis.zadd in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.zadd("z", 10, "m");
    expect(shared.redis!.zadd).toHaveBeenCalledWith("z", { score: 10, member: "m" });
  });

  it("zrange delegates to redis.zrange in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    const result = await mod.zrange("z", 0, -1);
    expect(shared.redis!.zrange).toHaveBeenCalledWith("z", 0, -1);
    expect(result).toEqual(["m"]);
  });

  it("zrem delegates to redis.zrem in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    await mod.zrem("z", "m");
    expect(shared.redis!.zrem).toHaveBeenCalledWith("z", "m");
  });

  it("rateLimit returns true when pipeline count <= max", async () => {
    const { mod } = await loadRedisKv();
    // pipeline.exec returns [1, 1] by default -> count=1 <= max=5
    const result = await mod.rateLimit("rl", 5, 60);
    expect(result).toBe(true);
  });

  it("rateLimit returns false when pipeline count > max", async () => {
    const { mod } = await loadRedisKv();
    // Simulate count=6 with max=5
    shared.pipeline!.exec.mockResolvedValueOnce([6, 1]);
    const result = await mod.rateLimit("rl", 5, 60);
    expect(result).toBe(false);
  });

  it("scanKeys iterates cursor until 0 and returns all keys", async () => {
    const { mod } = await loadRedisKv();
    // First scan returns cursor=1 with one key; second returns cursor=0
    shared.redis!.scan
      .mockResolvedValueOnce([1, ["key-a"]])
      .mockResolvedValueOnce([0, ["key-b"]]);
    const result = await mod.scanKeys("vault:*");
    expect(result).toEqual(["key-a", "key-b"]);
  });

  it("mget delegates to redis.mget in Redis mode", async () => {
    const { mod } = await loadRedisKv();
    const result = await mod.mget<string>("k1", "k2");
    expect(shared.redis!.mget).toHaveBeenCalledWith("k1", "k2");
    expect(result).toEqual(["a", null]);
  });
});

// ---------------------------------------------------------------------------
// Path traversal guard (kv.ts line 36)
// fsPath uses base64url encoding so the guard is never triggered by normal
// keys. We force it by mocking path.join to return an escaped path so that
// path.resolve resolves outside the FS_DIR.
// ---------------------------------------------------------------------------

describe("fsPath path traversal guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws when the resolved key path escapes the KV directory", async () => {
    vi.resetModules();

    // Mock path so that path.join returns a path that escapes the KV dir
    vi.doMock("path", async () => {
      const actual = await vi.importActual<typeof import("path")>("path");
      return {
        default: {
          ...actual,
          join: vi.fn((...args: string[]) => {
            // Only intercept calls that look like fsPath building a key path
            const joined = actual.join(...args);
            if (joined.includes(".cortex-kv") && joined.endsWith(".json")) {
              // Return a path that escapes upward so path.resolve produces
              // something outside resolvedFsDir
              return "/tmp/escape.json";
            }
            return joined;
          }),
        },
      };
    });

    vi.doMock("@upstash/redis", () => ({
      Redis: vi.fn().mockImplementation(() => ({})),
    }));

    vi.doMock("fs", () => ({
      default: {
        existsSync: vi.fn().mockReturnValue(true),
        mkdirSync: vi.fn(),
        readFileSync: vi.fn(),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
      },
    }));

    const { setJSON } = await import("@/lib/kv");

    // setJSON calls fsWrite (no try/catch) -> fsPath -> throws on traversal
    await expect(setJSON("any-key", "value")).rejects.toThrow("KV key path traversal detected");

    vi.resetModules();
  });
});
