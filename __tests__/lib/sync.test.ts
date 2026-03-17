/**
 * Integration-style tests for lib/sync.ts — runSync() and SyncResult.
 *
 * All external I/O is mocked: Redis, Vector Index, filesystem, gray-matter,
 * and the Voyage AI fetch call. Tests cover the full runSync() state machine:
 * env validation, new files, unchanged files, updates, deletes, pending
 * creates, vector upsert batching, and correct SyncResult totals.
 *
 * Mock architecture
 * -----------------
 * The Redis and Index constructors are mocked with plain `function`
 * constructors (not arrow functions) so they survive vi.clearAllMocks().
 * Both return a single stable mock object, so every test can configure the
 * same redisMock / vectorMock via mockResolvedValue calls directly.
 *
 * vi.clearAllMocks() runs in the outer beforeEach and resets call counts.
 * All default mock responses are restored after the clear in the same hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Stable mock instances — created once at module scope
// ---------------------------------------------------------------------------

const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  hset: vi.fn(),
  sadd: vi.fn(),
  smembers: vi.fn(),
  srem: vi.fn(),
  hgetall: vi.fn(),
};

const vectorMock = {
  upsert: vi.fn(),
  query: vi.fn(),
  delete: vi.fn(),
};

// ---------------------------------------------------------------------------
// Module-level mocks — MUST come before any import that loads these modules.
// Using `function` constructors (not arrow functions) so vi.clearAllMocks()
// does not break the `new Redis(...)` / `new Index(...)` calls.
// ---------------------------------------------------------------------------

vi.mock("@upstash/redis", () => {
  // eslint-disable-next-line prefer-arrow-callback
  function RedisCtor() { return redisMock; }
  return { Redis: RedisCtor };
});

vi.mock("@upstash/vector", () => {
  // eslint-disable-next-line prefer-arrow-callback
  function IndexCtor() { return vectorMock; }
  return { Index: IndexCtor };
});

vi.mock("@/lib/scars", () => ({
  saveScar: vi.fn(),
}));

vi.mock("fs");
vi.mock("gray-matter");

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { runSync } from "@/lib/sync";
import { saveScar } from "@/lib/scars";
import fs from "fs";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const VAULT = "/mock/vault";

/** Minimal Dirent-like object accepted by collectMarkdownFiles. */
function makeDirent(name: string, type: "file" | "directory") {
  return {
    name,
    isDirectory: () => type === "directory",
    isFile: () => type === "file",
  };
}

const MOCK_STAT = {
  mtime: new Date("2026-01-15T10:00:00.000Z"),
  size: 512,
};

function setupMatter(tags: string[] = ["#test"], content = "Hello world content") {
  (matter as unknown as Mock).mockReturnValue({ data: { tags }, content });
}

function setupFetchSuccess(embeddings: number[][] = [[0.1, 0.2, 0.3]]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: embeddings.map((e) => ({ embedding: e })),
    }),
    text: async () => "",
  });
}

/**
 * Wire smembers for the two sequential calls runSync makes:
 *   1st call → "vault:notes:index"
 *   2nd call → "vault:pending-creates"
 */
function setupSmembers(vaultIndex: string[] = [], pendingCreates: string[] = []) {
  redisMock.smembers
    .mockResolvedValueOnce(vaultIndex)
    .mockResolvedValueOnce(pendingCreates);
}

// ---------------------------------------------------------------------------
// Global beforeEach — runs before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Env vars
  process.env.VAULT_PATH = VAULT;
  process.env.KV_REST_API_URL = "https://mock-redis.upstash.io";
  process.env.KV_REST_API_TOKEN = "mock-token";
  process.env.UPSTASH_VECTOR_REST_URL = "https://mock-vector.upstash.io";
  process.env.UPSTASH_VECTOR_REST_TOKEN = "mock-vector-token";
  process.env.VOYAGE_API_KEY = "mock-voyage-key";

  // Filesystem defaults: empty vault
  (fs.readdirSync as unknown as Mock).mockReturnValue([]);
  (fs.statSync as unknown as Mock).mockReturnValue(MOCK_STAT);
  (fs.readFileSync as unknown as Mock).mockReturnValue(
    "---\ntags: [test]\n---\nHello world",
  );
  (fs.existsSync as unknown as Mock).mockReturnValue(false);
  (fs.mkdirSync as unknown as Mock).mockReturnValue(undefined);
  (fs.writeFileSync as unknown as Mock).mockReturnValue(undefined);

  // Redis defaults
  setupSmembers();
  redisMock.get.mockResolvedValue(null);
  redisMock.hgetall.mockResolvedValue(null);
  redisMock.set.mockResolvedValue("OK");
  redisMock.hset.mockResolvedValue(1);
  redisMock.sadd.mockResolvedValue(1);
  redisMock.del.mockResolvedValue(1);
  redisMock.srem.mockResolvedValue(1);

  // Vector defaults
  vectorMock.query.mockResolvedValue([]);
  vectorMock.upsert.mockResolvedValue(undefined);
  vectorMock.delete.mockResolvedValue(undefined);

  setupMatter();
  setupFetchSuccess();
});

afterEach(() => {
  delete process.env.VAULT_PATH;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_VECTOR_REST_URL;
  delete process.env.UPSTASH_VECTOR_REST_TOKEN;
  delete process.env.VOYAGE_API_KEY;
});

// ===========================================================================
// 1. Empty vault
// ===========================================================================

describe("empty vault", () => {
  it("returns all-zero SyncResult when no files exist and no Redis entries", async () => {
    const result = await runSync();

    expect(result).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      vectorsUpserted: 0,
      pendingWritten: 0,
      totalNotes: 0,
      totalWords: 0,
    });
  });

  it("writes vault:meta with zeros", async () => {
    await runSync();

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:meta",
      expect.objectContaining({ totalNotes: "0", totalWords: "0" }),
    );
  });

  it("does not call fetch when the vault is empty", async () => {
    await runSync();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 2. New file (no stored hash) → created = 1
// ===========================================================================

describe("new file", () => {
  beforeEach(() => {
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("note-one.md", "file"),
    ]);
    (fs.readFileSync as unknown as Mock).mockReturnValue(
      "---\ntags: [alpha]\n---\nThis is the content",
    );
    setupMatter(["#alpha"], "This is the content");
  });

  it("increments created to 1", async () => {
    const result = await runSync();

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
  });

  it("stores note data via hset", async () => {
    await runSync();

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:note-one.md",
      expect.objectContaining({
        name: "note-one",
        content: "This is the content",
        folder: "(root)",
      }),
    );
  });

  it("stores the computed hash via set", async () => {
    await runSync();

    expect(redisMock.set).toHaveBeenCalledWith(
      "vault:hash:note-one.md",
      expect.any(String),
    );
  });

  it("adds the relative path to vault:notes:index", async () => {
    await runSync();

    expect(redisMock.sadd).toHaveBeenCalledWith(
      "vault:notes:index",
      "note-one.md",
    );
  });

  it("counts totalNotes and totalWords correctly", async () => {
    (matter as unknown as Mock).mockReturnValue({
      data: { tags: ["#alpha"] },
      content: "one two three",
    });

    const result = await runSync();

    expect(result.totalNotes).toBe(1);
    expect(result.totalWords).toBe(3);
  });

  it("assigns '(root)' folder for a top-level file", async () => {
    await runSync();

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:note-one.md",
      expect.objectContaining({ folder: "(root)" }),
    );
  });

  it("assigns the subdirectory name as folder for a nested file", async () => {
    (fs.readdirSync as unknown as Mock)
      .mockReturnValueOnce([makeDirent("journal", "directory")])
      .mockReturnValueOnce([makeDirent("entry.md", "file")]);

    const result = await runSync();

    expect(result.created).toBe(1);
    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:journal/entry.md",
      expect.objectContaining({ folder: "journal" }),
    );
  });

  it("stores modifiedAt as ISO string derived from stat.mtime", async () => {
    await runSync();

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:note-one.md",
      expect.objectContaining({
        modifiedAt: MOCK_STAT.mtime.toISOString(),
        size: String(MOCK_STAT.size),
      }),
    );
  });
});

// ===========================================================================
// 3. Unchanged file (stored hash matches) → unchanged = 1
// ===========================================================================

describe("unchanged file", () => {
  const RAW_CONTENT = "---\ntags: [alpha]\n---\nNo change here";

  beforeEach(() => {
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("stable.md", "file"),
    ]);
    (fs.readFileSync as unknown as Mock).mockReturnValue(RAW_CONTENT);
    setupMatter(["#alpha"], "No change here");
  });

  async function getMatchingHash() {
    const { createHash } = await import("crypto");
    return createHash("md5").update(RAW_CONTENT).digest("hex");
  }

  it("increments unchanged to 1 when the stored hash matches", async () => {
    const hash = await getMatchingHash();
    // Reset smembers so the stable note appears already indexed
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce(["stable.md"])
      .mockResolvedValueOnce([]);
    redisMock.get.mockResolvedValue(hash);

    const result = await runSync();

    expect(result.unchanged).toBe(1);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
  });

  it("does not call hset for an unchanged note", async () => {
    const hash = await getMatchingHash();
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce(["stable.md"])
      .mockResolvedValueOnce([]);
    redisMock.get.mockResolvedValue(hash);

    await runSync();

    const noteCalls = redisMock.hset.mock.calls.filter(
      (c) => c[0] !== "vault:meta",
    );
    expect(noteCalls).toHaveLength(0);
  });

  it("does not call fetch for an unchanged file", async () => {
    const hash = await getMatchingHash();
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce(["stable.md"])
      .mockResolvedValueOnce([]);
    redisMock.get.mockResolvedValue(hash);

    await runSync();

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Updated file (hash differs, path already in index) → updated = 1
// ===========================================================================

describe("updated file", () => {
  beforeEach(() => {
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("changed.md", "file"),
    ]);
    (fs.readFileSync as unknown as Mock).mockReturnValue("new raw content");
    setupMatter(["#beta"], "new content");
    // Path exists in Redis with a stale hash
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce(["changed.md"])
      .mockResolvedValueOnce([]);
    redisMock.get.mockResolvedValue("old-hash-value");
  });

  it("increments updated when the path was already indexed", async () => {
    const result = await runSync();

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
  });

  it("does not double-count: updated and created are mutually exclusive", async () => {
    const result = await runSync();

    expect(result.updated + result.created).toBe(1);
  });
});

// ===========================================================================
// 5. Deleted file (in Redis index but not on disk)
// ===========================================================================

describe("deleted file", () => {
  /** Helper: set up a single ghost file that exists in Redis but not on disk. */
  function setupDeleteScenario(ghostPath: string, hgetallData: Record<string, string> | null) {
    (fs.readdirSync as unknown as Mock).mockReturnValue([]);
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce([ghostPath])
      .mockResolvedValueOnce([]);
    redisMock.get.mockResolvedValue(null);
    redisMock.hgetall.mockResolvedValue(hgetallData);
  }

  it("increments deleted to 1 for a ghost file", async () => {
    setupDeleteScenario("ghost.md", {
      name: "ghost",
      folder: "(root)",
      tags: JSON.stringify(["#old"]),
      outgoing: JSON.stringify(["linked-note"]),
    });

    const result = await runSync();

    expect(result.deleted).toBe(1);
  });

  it("calls saveScar with the correct tombstone data", async () => {
    setupDeleteScenario("journal/lost.md", {
      name: "lost",
      folder: "journal",
      tags: JSON.stringify(["#memory"]),
      outgoing: JSON.stringify(["other-note"]),
    });

    await runSync();

    expect(saveScar).toHaveBeenCalledWith({
      path: "journal/lost.md",
      name: "lost",
      folder: "journal",
      tags: ["#memory"],
      connectedNotes: ["other-note"],
    });
  });

  it("removes all three Redis keys for the deleted file", async () => {
    setupDeleteScenario("removed.md", {
      name: "removed",
      folder: "(root)",
      tags: "[]",
      outgoing: "[]",
    });

    await runSync();

    expect(redisMock.del).toHaveBeenCalledWith("vault:note:removed.md");
    expect(redisMock.del).toHaveBeenCalledWith("vault:hash:removed.md");
    expect(redisMock.srem).toHaveBeenCalledWith("vault:notes:index", "removed.md");
  });

  it("skips saveScar but still deletes Redis keys when hgetall returns null", async () => {
    setupDeleteScenario("no-data.md", null);

    await runSync();

    expect(saveScar).not.toHaveBeenCalled();
    expect(redisMock.del).toHaveBeenCalledWith("vault:note:no-data.md");
  });

  it("falls back to path-derived name and '(root)' folder when noteData fields are falsy", async () => {
    // name and folder keys are absent — exercises the || fallback branches
    setupDeleteScenario("folder/fallback.md", { tags: "[]", outgoing: "[]" });

    await runSync();

    expect(saveScar).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "fallback",  // path.basename("folder/fallback.md", ".md")
        folder: "(root)",  // noteData.folder is undefined → fallback
      }),
    );
  });

  it("saves empty tags and outgoing when the stored JSON is malformed", async () => {
    setupDeleteScenario("broken.md", {
      name: "broken",
      folder: "(root)",
      tags: "{not-json",
      outgoing: "also-bad",
    });

    // Should not throw — inner try/catch in source handles the JSON.parse error
    await expect(runSync()).resolves.toMatchObject({ deleted: 1 });

    expect(saveScar).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [], connectedNotes: [] }),
    );
  });

  it("deletes stale vector chunks when they exist", async () => {
    setupDeleteScenario("chunked.md", {
      name: "chunked",
      folder: "(root)",
      tags: "[]",
      outgoing: "[]",
    });
    vectorMock.query.mockResolvedValue([{ id: "chunked.md#chunk0" }]);

    await runSync();

    expect(vectorMock.delete).toHaveBeenCalledWith(["chunked.md#chunk0"]);
  });

  it("does not call vectorIndex.delete when query returns an empty result", async () => {
    setupDeleteScenario("empty-chunks.md", {
      name: "empty-chunks",
      folder: "(root)",
      tags: "[]",
      outgoing: "[]",
    });
    vectorMock.query.mockResolvedValue([]);

    await runSync();

    expect(vectorMock.delete).not.toHaveBeenCalled();
    expect(redisMock.del).toHaveBeenCalledWith("vault:note:empty-chunks.md");
  });

  it("swallows vector query errors during delete cleanup and still deletes from Redis", async () => {
    setupDeleteScenario("errored.md", {
      name: "errored",
      folder: "(root)",
      tags: "[]",
      outgoing: "[]",
    });
    vectorMock.query.mockRejectedValue(new Error("index empty"));

    await expect(runSync()).resolves.toMatchObject({ deleted: 1 });
    expect(redisMock.del).toHaveBeenCalledWith("vault:note:errored.md");
  });
});

// ===========================================================================
// 6. Pending creates written to disk
// ===========================================================================

describe("pending creates", () => {
  it("writes a pending note to disk and increments pendingWritten", async () => {
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["pending/new-idea.md"]);
    redisMock.hgetall.mockResolvedValue({ rawContent: "# New Idea\n\nContent here" });
    (fs.existsSync as unknown as Mock).mockReturnValue(false);

    const result = await runSync();

    expect(result.pendingWritten).toBe(1);
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      "/mock/vault/pending",
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/mock/vault/pending/new-idea.md",
      "# New Idea\n\nContent here",
      "utf-8",
    );
    expect(redisMock.srem).toHaveBeenCalledWith(
      "vault:pending-creates",
      "pending/new-idea.md",
    );
  });

  it("skips writeFileSync but still calls srem when the file already exists on disk", async () => {
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["exists.md"]);
    redisMock.hgetall.mockResolvedValue({ rawContent: "# Already exists" });
    (fs.existsSync as unknown as Mock).mockReturnValue(true);

    const result = await runSync();

    expect(result.pendingWritten).toBe(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(redisMock.srem).toHaveBeenCalledWith("vault:pending-creates", "exists.md");
  });

  it("skips write AND srem when hgetall returns null (continue branch)", async () => {
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["missing-data.md"]);
    redisMock.hgetall.mockResolvedValue(null);

    const result = await runSync();

    expect(result.pendingWritten).toBe(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    const pendingRemoveCalls = redisMock.srem.mock.calls.filter(
      (c) => c[0] === "vault:pending-creates",
    );
    expect(pendingRemoveCalls).toHaveLength(0);
  });

  it("skips write AND srem when noteData exists but rawContent key is missing", async () => {
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["no-content.md"]);
    redisMock.hgetall.mockResolvedValue({ name: "no-content" });

    const result = await runSync();

    expect(result.pendingWritten).toBe(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    const pendingRemoveCalls = redisMock.srem.mock.calls.filter(
      (c) => c[0] === "vault:pending-creates",
    );
    expect(pendingRemoveCalls).toHaveLength(0);
  });

  it("swallows mkdirSync errors and still calls srem (error is outside the try/catch)", async () => {
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["blocked.md"]);
    redisMock.hgetall.mockResolvedValue({ rawContent: "content" });
    (fs.existsSync as unknown as Mock).mockReturnValue(false);
    (fs.mkdirSync as unknown as Mock).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    // Inner try/catch swallows the fs error, runSync does not throw
    const result = await runSync();

    expect(result.pendingWritten).toBe(0);
    expect(redisMock.srem).toHaveBeenCalledWith(
      "vault:pending-creates",
      "blocked.md",
    );
  });

  it("handles a root-level pending note (no subdirectory)", async () => {
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["flat.md"]);
    redisMock.hgetall.mockResolvedValue({ rawContent: "# Flat" });
    (fs.existsSync as unknown as Mock).mockReturnValue(false);

    const result = await runSync();

    expect(result.pendingWritten).toBe(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/mock/vault/flat.md",
      "# Flat",
      "utf-8",
    );
  });
});

// ===========================================================================
// 7. Vector upsert for changed files
// ===========================================================================

describe("vector upsert", () => {
  /** Shared setup: one new .md file with short content. */
  function setupOneNewFile(content = "word ".repeat(10).trim()) {
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("vectored.md", "file"),
    ]);
    (fs.readFileSync as unknown as Mock).mockReturnValue("raw text");
    setupMatter(["#vec"], content);
    redisMock.smembers.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    redisMock.get.mockResolvedValue(null);
  }

  it("calls the Voyage API when VOYAGE_API_KEY is set", async () => {
    setupOneNewFile();

    await runSync();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends the note's chunks as input to the embedding API", async () => {
    const content = "alpha beta gamma";
    setupOneNewFile(content);
    setupFetchSuccess([[0.1, 0.2, 0.3]]);

    await runSync();

    const body = JSON.parse(
      (global.fetch as unknown as Mock).mock.calls[0][1].body,
    );
    expect(body.input).toEqual([content]);
    expect(body.model).toBe("voyage-3");
  });

  it("increments vectorsUpserted to 1 for a single-chunk file", async () => {
    setupOneNewFile("word ".repeat(10).trim());
    setupFetchSuccess([[0.1, 0.2]]);

    const result = await runSync();

    expect(result.vectorsUpserted).toBe(1);
  });

  it("calls vectorIndex.upsert with the correct metadata shape", async () => {
    setupOneNewFile();
    setupFetchSuccess([[0.5, 0.6, 0.7]]);

    await runSync();

    expect(vectorMock.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "vectored.md#chunk0",
          vector: [0.5, 0.6, 0.7],
          metadata: expect.objectContaining({
            path: "vectored.md",
            name: "vectored",
            chunk: 0,
            tags: ["#vec"],
          }),
        }),
      ]),
    );
  });

  it("does not call fetch when VOYAGE_API_KEY is absent", async () => {
    delete process.env.VOYAGE_API_KEY;
    setupOneNewFile();
    global.fetch = vi.fn();

    const result = await runSync();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.vectorsUpserted).toBe(0);
  });

  it("purges stale vector chunks before upserting fresh ones", async () => {
    setupOneNewFile();
    setupFetchSuccess([[0.1, 0.2]]);
    vectorMock.query.mockResolvedValue([{ id: "vectored.md#chunk0" }]);

    await runSync();

    expect(vectorMock.delete).toHaveBeenCalledWith(["vectored.md#chunk0"]);
    expect(vectorMock.upsert).toHaveBeenCalled();
  });

  it("does not call vectorIndex.delete when old query returns empty", async () => {
    setupOneNewFile();
    setupFetchSuccess([[0.1, 0.2]]);
    vectorMock.query.mockResolvedValue([]);

    await runSync();

    expect(vectorMock.delete).not.toHaveBeenCalled();
    expect(vectorMock.upsert).toHaveBeenCalled();
  });

  it("continues processing (upserts) when the old-chunk query throws", async () => {
    setupOneNewFile();
    setupFetchSuccess([[0.1, 0.2]]);
    vectorMock.query.mockRejectedValue(new Error("index empty"));

    // Inner try/catch swallows the error; upsert should still run
    await expect(runSync()).resolves.toBeDefined();
    expect(vectorMock.upsert).toHaveBeenCalled();
  });

  it("throws when the Voyage API returns a non-ok HTTP status", async () => {
    setupOneNewFile();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    });

    await expect(runSync()).rejects.toThrow("Voyage AI error: 429");
  });

  it("produces multiple chunk IDs for content that exceeds CHUNK_SIZE words", async () => {
    // 1000 words → chunkText with CHUNK_SIZE=500, CHUNK_OVERLAP=50, step=450:
    //   chunk 0: words[0..499]
    //   chunk 1: words[450..949]
    //   chunk 2: words[900..999]  (i+500=1400 >= 1000 → break after this)
    // = 3 chunks total
    const content = Array.from({ length: 1000 }, (_, i) => `word${i}`).join(" ");
    setupOneNewFile(content);
    // Voyage API is called in batches of 20; all 3 chunks fit in one batch call
    (global.fetch as unknown as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.1] },
          { embedding: [0.2] },
          { embedding: [0.3] },
        ],
      }),
      text: async () => "",
    });

    const result = await runSync();

    expect(result.vectorsUpserted).toBe(3);
    expect(vectorMock.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "vectored.md#chunk0" }),
        expect.objectContaining({ id: "vectored.md#chunk1" }),
        expect.objectContaining({ id: "vectored.md#chunk2" }),
      ]),
    );
  });
});

// ===========================================================================
// 8. Env var validation
// ===========================================================================

describe("env var validation", () => {
  it("throws when VAULT_PATH is not set", async () => {
    delete process.env.VAULT_PATH;
    await expect(runSync()).rejects.toThrow("VAULT_PATH is not set");
  });

  it("throws when KV_REST_API_URL is not set", async () => {
    delete process.env.KV_REST_API_URL;
    await expect(runSync()).rejects.toThrow("KV_REST_API_URL is not set");
  });

  it("resolves without error when VOYAGE_API_KEY is absent (vectors are skipped)", async () => {
    delete process.env.VOYAGE_API_KEY;
    // File exists so embeddings would be attempted if the key were present
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("note.md", "file"),
    ]);
    (fs.readFileSync as unknown as Mock).mockReturnValue("raw");
    setupMatter([], "body text");

    await expect(runSync()).resolves.toMatchObject({ vectorsUpserted: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 9. SyncResult totals across a mixed-operation sync
// ===========================================================================

describe("SyncResult totals", () => {
  it("correctly tallies created + updated + unchanged + deleted in a single pass", async () => {
    // note-a.md → new (no hash, not in index)
    // note-b.md → unchanged (hash matches)
    // note-c.md → updated (hash differs, was indexed)
    // ghost.md  → deleted (indexed but no local file)
    const noteB_raw = "---\ntags: [b]\n---\ncontent b";
    const { createHash } = await import("crypto");
    const noteB_hash = createHash("md5").update(noteB_raw).digest("hex");

    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("note-a.md", "file"),
      makeDirent("note-b.md", "file"),
      makeDirent("note-c.md", "file"),
    ]);
    (fs.readFileSync as unknown as Mock)
      .mockReturnValueOnce("raw a")
      .mockReturnValueOnce(noteB_raw)
      .mockReturnValueOnce("raw c new");
    (matter as unknown as Mock)
      .mockReturnValueOnce({ data: { tags: ["#a"] }, content: "content a" })
      .mockReturnValueOnce({ data: { tags: ["#b"] }, content: "content b" })
      .mockReturnValueOnce({ data: { tags: ["#c"] }, content: "content c updated" });

    // Voyage returns one embedding per chunk (one chunk per small file)
    (global.fetch as unknown as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
      text: async () => "",
    });

    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce(["note-b.md", "note-c.md", "ghost.md"])
      .mockResolvedValueOnce([]);
    // Hash responses: note-a → null, note-b → matching, note-c → stale
    redisMock.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(noteB_hash)
      .mockResolvedValueOnce("stale-c");
    redisMock.hgetall.mockResolvedValue({
      name: "ghost",
      folder: "(root)",
      tags: "[]",
      outgoing: "[]",
    });

    const result = await runSync();

    expect(result.created).toBe(1);    // note-a
    expect(result.unchanged).toBe(1);  // note-b
    expect(result.updated).toBe(1);    // note-c
    expect(result.deleted).toBe(1);    // ghost
    expect(result.totalNotes).toBe(3); // a, b, c (local files only)
    // "content a" = 2 words, "content b" = 2, "content c updated" = 3 → 7
    expect(result.totalWords).toBe(7);
  });

  it("reports pendingWritten in addition to other counts", async () => {
    redisMock.smembers
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["to-write.md"]);
    redisMock.hgetall.mockResolvedValue({ rawContent: "# To Write" });
    (fs.existsSync as unknown as Mock).mockReturnValue(false);

    const result = await runSync();

    expect(result.pendingWritten).toBe(1);
    expect(result.created).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("writes a valid ISO lastSyncAt timestamp to vault:meta", async () => {
    await runSync();

    const metaCall = redisMock.hset.mock.calls.find(
      (c) => c[0] === "vault:meta",
    );
    expect(metaCall).toBeDefined();
    const meta = metaCall![1] as Record<string, string>;
    expect(meta.lastSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ===========================================================================
// 10. collectMarkdownFiles — filtering exercised via runSync
// ===========================================================================

describe("collectMarkdownFiles filtering", () => {
  it("ignores dotfiles and dot-directories", async () => {
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent(".obsidian", "directory"),
      makeDirent(".DS_Store", "file"),
      makeDirent("visible.md", "file"),
    ]);

    const result = await runSync();

    // Only visible.md reaches the processing loop
    expect(result.totalNotes).toBe(1);
  });

  it("ignores non-.md files", async () => {
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("image.png", "file"),
      makeDirent("README.txt", "file"),
      makeDirent("note.md", "file"),
    ]);

    const result = await runSync();

    expect(result.totalNotes).toBe(1);
  });

  it("recurses into subdirectories", async () => {
    (fs.readdirSync as unknown as Mock)
      .mockReturnValueOnce([
        makeDirent("sub", "directory"),
        makeDirent("root-note.md", "file"),
      ])
      .mockReturnValueOnce([makeDirent("nested.md", "file")]);

    const result = await runSync();

    expect(result.totalNotes).toBe(2);
  });

  it("does not recurse into dot-directories", async () => {
    // readdirSync is called once for root, should never be called for .hidden
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent(".hidden", "directory"),
      makeDirent("real.md", "file"),
    ]);

    const result = await runSync();

    // readdirSync should only be called once (for VAULT_PATH)
    expect(fs.readdirSync).toHaveBeenCalledTimes(1);
    expect(result.totalNotes).toBe(1);
  });
});

// ===========================================================================
// 11. Wikilink extraction stored in hset metadata
// ===========================================================================

describe("wikilink extraction", () => {
  function setupFileWithContent(content: string) {
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("links.md", "file"),
    ]);
    (fs.readFileSync as unknown as Mock).mockReturnValue("raw");
    (matter as unknown as Mock).mockReturnValue({ data: { tags: [] }, content });
  }

  it("extracts plain wikilinks into the outgoing array", async () => {
    setupFileWithContent("See [[Note A]] and [[Note B]] for more.");

    await runSync();

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:links.md",
      expect.objectContaining({
        outgoing: JSON.stringify(["Note A", "Note B"]),
      }),
    );
  });

  it("strips the alias portion after the pipe character", async () => {
    setupFileWithContent("[[Target|display alias]]");

    await runSync();

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:links.md",
      expect.objectContaining({ outgoing: JSON.stringify(["Target"]) }),
    );
  });

  it("strips the heading portion after the hash character", async () => {
    setupFileWithContent("[[Page#section-heading]]");

    await runSync();

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:links.md",
      expect.objectContaining({ outgoing: JSON.stringify(["Page"]) }),
    );
  });

  it("stores an empty outgoing array when the content has no wikilinks", async () => {
    setupFileWithContent("Just plain text, no links here.");

    await runSync();

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:links.md",
      expect.objectContaining({ outgoing: JSON.stringify([]) }),
    );
  });
});

// ===========================================================================
// 12. Tag extraction paths via extractTags (frontmatter key variants)
// ===========================================================================

describe("tag extraction via frontmatter keys", () => {
  /** Run a full sync with a single file using the given frontmatter data. */
  async function syncWithFrontmatter(data: Record<string, unknown>) {
    (fs.readdirSync as unknown as Mock).mockReturnValue([
      makeDirent("tagged.md", "file"),
    ]);
    (fs.readFileSync as unknown as Mock).mockReturnValue("raw");
    (matter as unknown as Mock).mockReturnValue({ data, content: "body" });
    redisMock.smembers.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    redisMock.get.mockResolvedValue(null);
    return runSync();
  }

  it("extracts tags from the 'tags' array key", async () => {
    await syncWithFrontmatter({ tags: ["design", "#ui"] });

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:tagged.md",
      expect.objectContaining({ tags: JSON.stringify(["#design", "#ui"]) }),
    );
  });

  it("extracts tags from the 'tag' string key", async () => {
    await syncWithFrontmatter({ tag: "writing" });

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:tagged.md",
      expect.objectContaining({ tags: JSON.stringify(["#writing"]) }),
    );
  });

  it("extracts tags from the 'Topics' key", async () => {
    await syncWithFrontmatter({ Topics: ["research", "ai"] });

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:tagged.md",
      expect.objectContaining({ tags: JSON.stringify(["#research", "#ai"]) }),
    );
  });

  it("extracts tags from the 'topics' space-separated string key", async () => {
    await syncWithFrontmatter({ topics: "one two" });

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:tagged.md",
      expect.objectContaining({ tags: JSON.stringify(["#one", "#two"]) }),
    );
  });

  it("extracts comma-separated tags from a string value", async () => {
    await syncWithFrontmatter({ tags: "alpha, beta, gamma" });

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:tagged.md",
      expect.objectContaining({
        tags: JSON.stringify(["#alpha", "#beta", "#gamma"]),
      }),
    );
  });

  it("preserves existing # prefix on tags", async () => {
    await syncWithFrontmatter({ tags: ["#already-prefixed"] });

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:tagged.md",
      expect.objectContaining({ tags: JSON.stringify(["#already-prefixed"]) }),
    );
  });

  it("stores an empty tags array when no recognised tag key is present", async () => {
    await syncWithFrontmatter({});

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:tagged.md",
      expect.objectContaining({ tags: JSON.stringify([]) }),
    );
  });

  it("returns empty tags for a null tag value", async () => {
    await syncWithFrontmatter({ tags: null });

    expect(redisMock.hset).toHaveBeenCalledWith(
      "vault:note:tagged.md",
      expect.objectContaining({ tags: JSON.stringify([]) }),
    );
  });
});
