import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Hoist the mock method stubs so they are available inside vi.mock() factories
// (vi.mock calls are hoisted to the top of the file by Vitest's transformer).
const { mockInfo, mockUpsert, mockQuery, mockDelete, mockReset, mockRange } =
  vi.hoisted(() => ({
    mockInfo: vi.fn(),
    mockUpsert: vi.fn(),
    mockQuery: vi.fn(),
    mockDelete: vi.fn(),
    mockReset: vi.fn(),
    mockRange: vi.fn(),
  }));

// Index is used as `new Index(...)` in the source, so the mock must be a
// proper constructor (class or named function), not an arrow function.
vi.mock("@upstash/vector", () => ({
  Index: class MockIndex {
    info = mockInfo;
    upsert = mockUpsert;
    query = mockQuery;
    delete = mockDelete;
    reset = mockReset;
    range = mockRange;
  },
}));

import {
  indexHasItems,
  upsertVectors,
  queryVectors,
  deleteVectors,
  deleteVectorsByPath,
  resetIndex,
  fetchAllVectors,
  getIndexInfo,
  type VectorMetadata,
} from "@/lib/vector";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(overrides: Partial<VectorMetadata> = {}): VectorMetadata {
  return {
    path: overrides.path ?? "notes/test.md",
    name: overrides.name ?? "test",
    chunk: overrides.chunk ?? 0,
    text: overrides.text ?? "sample text",
    tags: overrides.tags ?? ["tag1"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// indexHasItems
// ---------------------------------------------------------------------------

describe("indexHasItems", () => {
  it("returns true when vectorCount > 0", async () => {
    mockInfo.mockResolvedValueOnce({ vectorCount: 42 });
    expect(await indexHasItems()).toBe(true);
  });

  it("returns false when vectorCount is 0", async () => {
    mockInfo.mockResolvedValueOnce({ vectorCount: 0 });
    expect(await indexHasItems()).toBe(false);
  });

  it("returns false when index.info() throws", async () => {
    mockInfo.mockRejectedValueOnce(new Error("Upstash down"));
    expect(await indexHasItems()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// upsertVectors
// ---------------------------------------------------------------------------

describe("upsertVectors", () => {
  it("does nothing and does not call upsert for an empty array", async () => {
    await upsertVectors([]);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("upserts a small batch in a single call", async () => {
    mockUpsert.mockResolvedValueOnce(undefined);
    const items = [
      { id: "note#chunk0", vector: [0.1, 0.2], metadata: makeMetadata() },
      { id: "note#chunk1", vector: [0.3, 0.4], metadata: makeMetadata({ chunk: 1 }) },
    ];

    await upsertVectors(items);

    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockUpsert).toHaveBeenCalledWith(items);
  });

  it("splits a large batch (>1000) into multiple upsert calls", async () => {
    mockUpsert.mockResolvedValue(undefined);

    // 2001 items — should produce 3 batches: 1000, 1000, 1
    const items = Array.from({ length: 2001 }, (_, i) => ({
      id: `note#chunk${i}`,
      vector: [i * 0.001],
      metadata: makeMetadata({ chunk: i }),
    }));

    await upsertVectors(items);

    expect(mockUpsert).toHaveBeenCalledTimes(3);
    expect(vi.mocked(mockUpsert).mock.calls[0][0]).toHaveLength(1000);
    expect(vi.mocked(mockUpsert).mock.calls[1][0]).toHaveLength(1000);
    expect(vi.mocked(mockUpsert).mock.calls[2][0]).toHaveLength(1);
  });

  it("upserts exactly 1000 items in a single call (boundary)", async () => {
    mockUpsert.mockResolvedValueOnce(undefined);
    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: `note#chunk${i}`,
      vector: [i * 0.001],
      metadata: makeMetadata({ chunk: i }),
    }));

    await upsertVectors(items);

    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// queryVectors
// ---------------------------------------------------------------------------

describe("queryVectors", () => {
  it("returns filtered and mapped results (only those with metadata)", async () => {
    const meta = makeMetadata({ name: "article", path: "articles/one.md" });
    mockQuery.mockResolvedValueOnce([
      { id: "articles/one.md#chunk0", score: 0.92, metadata: meta },
      { id: "articles/two.md#chunk0", score: 0.88, metadata: null }, // filtered out
    ]);

    const results = await queryVectors([0.1, 0.2, 0.3]);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ id: "articles/one.md#chunk0", score: 0.92, metadata: meta });
  });

  it("uses default topK of 6", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await queryVectors([0.5]);
    expect(mockQuery).toHaveBeenCalledWith({
      vector: [0.5],
      topK: 6,
      includeMetadata: true,
      includeVectors: false,
    });
  });

  it("accepts a custom topK value", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await queryVectors([0.1, 0.2], 12);
    expect(mockQuery).toHaveBeenCalledWith({
      vector: [0.1, 0.2],
      topK: 12,
      includeMetadata: true,
      includeVectors: false,
    });
  });

  it("returns an empty array when no results have metadata", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: "x", score: 0.9, metadata: null },
      { id: "y", score: 0.8, metadata: undefined },
    ]);
    const results = await queryVectors([0.1]);
    expect(results).toEqual([]);
  });

  it("returns empty array when query returns no results at all", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await queryVectors([0.1])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteVectors
// ---------------------------------------------------------------------------

describe("deleteVectors", () => {
  it("does nothing for an empty array", async () => {
    await deleteVectors([]);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("calls index.delete with the provided IDs", async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await deleteVectors(["id1", "id2", "id3"]);
    expect(mockDelete).toHaveBeenCalledWith(["id1", "id2", "id3"]);
  });
});

// ---------------------------------------------------------------------------
// deleteVectorsByPath
// ---------------------------------------------------------------------------

describe("deleteVectorsByPath", () => {
  it("queries with the path filter and deletes matching IDs", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: "notes/example.md#chunk0", score: 1.0 },
      { id: "notes/example.md#chunk1", score: 1.0 },
    ]);
    mockDelete.mockResolvedValueOnce(undefined);

    await deleteVectorsByPath("notes/example.md");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "path = 'notes/example.md'",
        topK: 1000,
        includeMetadata: false,
      })
    );
    expect(mockDelete).toHaveBeenCalledWith([
      "notes/example.md#chunk0",
      "notes/example.md#chunk1",
    ]);
  });

  it("does not call delete when no matching vectors are found", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await deleteVectorsByPath("notes/nonexistent.md");

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("escapes single quotes in the path to prevent filter injection", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await deleteVectorsByPath("notes/O'Reilly.md");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: "path = 'notes/O\\'Reilly.md'",
      })
    );
  });

  it("uses a 1024-element zero vector as the dummy vector for the filter query", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await deleteVectorsByPath("notes/test.md");

    const callArg = vi.mocked(mockQuery).mock.calls[0][0] as { vector: number[] };
    expect(callArg.vector).toHaveLength(1024);
    expect(callArg.vector.every((v: number) => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetIndex
// ---------------------------------------------------------------------------

describe("resetIndex", () => {
  it("calls index.reset()", async () => {
    mockReset.mockResolvedValueOnce(undefined);
    await resetIndex();
    expect(mockReset).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// fetchAllVectors
// ---------------------------------------------------------------------------

describe("fetchAllVectors", () => {
  it("returns an empty array when the index is empty (cursor stays '0')", async () => {
    mockRange.mockResolvedValueOnce({ vectors: [], nextCursor: "0" });
    const result = await fetchAllVectors();
    expect(result).toEqual([]);
  });

  it("returns vectors from a single page when nextCursor is '0'", async () => {
    const meta = makeMetadata();
    mockRange.mockResolvedValueOnce({
      vectors: [
        { id: "note#chunk0", vector: [0.1, 0.2], metadata: meta },
        { id: "note#chunk1", vector: [0.3, 0.4], metadata: meta },
      ],
      nextCursor: "0",
    });

    const result = await fetchAllVectors();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "note#chunk0", vector: [0.1, 0.2], metadata: meta });
  });

  it("paginates across multiple pages until nextCursor is '0'", async () => {
    const meta = makeMetadata();

    // Page 1: returns cursor "abc"
    mockRange.mockResolvedValueOnce({
      vectors: [{ id: "a#chunk0", vector: [0.1], metadata: meta }],
      nextCursor: "abc",
    });
    // Page 2: returns cursor "0" (last page)
    mockRange.mockResolvedValueOnce({
      vectors: [{ id: "b#chunk0", vector: [0.2], metadata: meta }],
      nextCursor: "0",
    });

    const result = await fetchAllVectors();

    expect(result).toHaveLength(2);
    expect(mockRange).toHaveBeenCalledTimes(2);
    expect(vi.mocked(mockRange).mock.calls[0][0]).toMatchObject({ cursor: "0", limit: 1000 });
    expect(vi.mocked(mockRange).mock.calls[1][0]).toMatchObject({ cursor: "abc", limit: 1000 });
  });

  it("paginates until nextCursor is empty string", async () => {
    const meta = makeMetadata();
    mockRange.mockResolvedValueOnce({
      vectors: [{ id: "a#chunk0", vector: [0.1], metadata: meta }],
      nextCursor: "",
    });

    const result = await fetchAllVectors();
    expect(result).toHaveLength(1);
    expect(mockRange).toHaveBeenCalledOnce();
  });

  it("skips vectors that are missing metadata or vector data", async () => {
    const meta = makeMetadata();
    mockRange.mockResolvedValueOnce({
      vectors: [
        { id: "good", vector: [0.1], metadata: meta },
        { id: "no-meta", vector: [0.2], metadata: null },
        { id: "no-vec", vector: null, metadata: meta },
      ],
      nextCursor: "0",
    });

    const result = await fetchAllVectors();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("good");
  });

  it("requests includeMetadata and includeVectors as true", async () => {
    mockRange.mockResolvedValueOnce({ vectors: [], nextCursor: "0" });
    await fetchAllVectors();
    expect(mockRange).toHaveBeenCalledWith({
      cursor: "0",
      limit: 1000,
      includeMetadata: true,
      includeVectors: true,
    });
  });
});

// ---------------------------------------------------------------------------
// getIndexInfo
// ---------------------------------------------------------------------------

describe("getIndexInfo", () => {
  it("returns an object with vectorCount from index.info()", async () => {
    mockInfo.mockResolvedValueOnce({ vectorCount: 256, dimension: 1024 });
    const info = await getIndexInfo();
    expect(info).toEqual({ vectorCount: 256 });
  });
});
