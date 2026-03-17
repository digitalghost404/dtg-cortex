import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist env setup so it runs before any module is imported/evaluated.
// VOYAGE_API_KEY is read as a module-level const in echo.ts, so we must
// ensure it is set in process.env before that module loads.
// ---------------------------------------------------------------------------

vi.hoisted(() => {
  process.env.VOYAGE_API_KEY = "test-voyage-key";
});

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/lineage", () => ({
  loadLineage: vi.fn(),
}));

import { findEcho, type MemoryEchoMatch } from "@/lib/echo";
import { loadLineage } from "@/lib/lineage";
import type { LineageEntry, LineageStore } from "@/lib/lineage";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// Keep a reference to the original fetch so we can restore it after tests
// that replace global.fetch. Node 18+ provides a built-in global fetch.
const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<LineageEntry> = {}): LineageEntry {
  return {
    id: overrides.id ?? "entry-1",
    timestamp: overrides.timestamp ?? "2026-03-10T12:00:00.000Z",
    sessionId: overrides.sessionId ?? "sess-abc",
    query: overrides.query ?? "What is machine learning?",
    sourceNotes: overrides.sourceNotes ?? [],
    ...overrides,
  };
}

function makeStore(entries: LineageEntry[]): LineageStore {
  return { entries };
}

/**
 * Build a unit-vector embedding of length 4 pointing in the direction of `index`.
 * Two vectors with the same index will have cosine similarity 1.0.
 * Adjacent indices will have low similarity.
 */
function makeEmbedding(index: number): number[] {
  const vec = [0, 0, 0, 0];
  vec[index % 4] = 1;
  return vec;
}

/**
 * Set up global.fetch to return pre-canned embeddings.
 *
 * callOrder:
 *  - call 1: single-embedding response for the current query
 *  - call 2: batch response for past queries
 */
function mockFetchWithEmbeddings(queryEmbedding: number[], pastEmbeddings: number[][]) {
  let callCount = 0;
  global.fetch = vi.fn(async () => {
    callCount++;
    const embedding = callCount === 1 ? queryEmbedding : null;
    const data =
      callCount === 1
        ? [{ embedding: queryEmbedding }]
        : pastEmbeddings.map((e) => ({ embedding: e }));
    return {
      ok: true,
      json: async () => ({ data }),
    } as unknown as Response;
  });
}

// ---------------------------------------------------------------------------
// findEcho
// ---------------------------------------------------------------------------

describe("findEcho", () => {
  it("returns null when the lineage store has no entries", async () => {
    vi.mocked(loadLineage).mockResolvedValueOnce(makeStore([]));
    // Spy on fetch to confirm it is never called when there are no entries
    const fetchSpy = vi.spyOn(global, "fetch");
    expect(await findEcho("some query")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns null when all entries deduplicate to zero unique queries", async () => {
    // All entries have the same query (after trim + lowercase)
    const entries = [
      makeEntry({ query: "machine learning", timestamp: "2026-03-01T10:00:00.000Z" }),
      makeEntry({ query: "Machine Learning", timestamp: "2026-03-02T10:00:00.000Z" }),
      makeEntry({ query: "  machine learning  ", timestamp: "2026-03-03T10:00:00.000Z" }),
    ];
    vi.mocked(loadLineage).mockResolvedValueOnce(makeStore(entries));

    // After dedup only one unique remains — but that 1 entry will still trigger embedding.
    // We need to make no match happen. Actually: one unique entry will be embedded and
    // compared. If similarity > 0.98 it's treated as exact and skipped → returns null.
    mockFetchWithEmbeddings(makeEmbedding(0), [makeEmbedding(0)]);

    const result = await findEcho("machine learning");
    expect(result).toBeNull();
  });

  it("returns null when no past query exceeds the 0.8 similarity threshold", async () => {
    vi.mocked(loadLineage).mockResolvedValueOnce(
      makeStore([makeEntry({ query: "deep learning basics", timestamp: "2026-01-01T00:00:00.000Z" })])
    );

    // Orthogonal vectors → cosine similarity = 0
    mockFetchWithEmbeddings(makeEmbedding(0), [makeEmbedding(1)]);

    const result = await findEcho("quantum computing");
    expect(result).toBeNull();
  });

  it("returns the best match when similarity is above 0.8 and not an exact match", async () => {
    const timestamp = "2026-03-01T00:00:00.000Z";
    vi.mocked(loadLineage).mockResolvedValueOnce(
      makeStore([makeEntry({ query: "neural networks", timestamp })])
    );

    // Similarity = 0.9 (not orthogonal, not identical)
    const queryVec = [1, 0.5, 0, 0];
    const pastVec = [1, 0, 0, 0];
    // cosine: dot=1, |q|=sqrt(1.25), |p|=1 → 1/sqrt(1.25) ≈ 0.894

    mockFetchWithEmbeddings(queryVec, [pastVec]);

    const result = await findEcho("deep neural networks");

    expect(result).not.toBeNull();
    expect(result!.previousQuery).toBe("neural networks");
    expect(result!.timestamp).toBe(timestamp);
    expect(result!.similarity).toBeGreaterThan(0.8);
    expect(result!.daysAgo).toBeGreaterThanOrEqual(0);
  });

  it("skips exact matches (similarity > 0.98) and returns null when only exact match exists", async () => {
    vi.mocked(loadLineage).mockResolvedValueOnce(
      makeStore([makeEntry({ query: "exact query" })])
    );

    // Identical embeddings → cosine similarity = 1.0 (> 0.98, should be skipped)
    const vec = [1, 0, 0, 0];
    mockFetchWithEmbeddings(vec, [vec]);

    const result = await findEcho("exact query");
    expect(result).toBeNull();
  });

  it("finds the best match among multiple past queries", async () => {
    // Entries are sorted newest-first inside findEcho, so the batch embedding
    // response index 0 = newest entry, index 1 = middle, index 2 = oldest.
    const entries = [
      makeEntry({ query: "low similarity topic", timestamp: "2026-01-01T00:00:00.000Z" }),
      makeEntry({ query: "medium match", timestamp: "2026-02-01T00:00:00.000Z" }),
      makeEntry({ query: "best match topic", timestamp: "2026-03-01T00:00:00.000Z" }),
    ];
    vi.mocked(loadLineage).mockResolvedValueOnce(makeStore(entries));

    const queryVec = [1, 0, 0, 0];
    // After sorting newest-first: "best match topic"(0), "medium match"(1), "low similarity"(2)
    const pastVecs = [
      [1, 0.5, 0, 0],  // "best match topic" — sim = 1/sqrt(1.25) ≈ 0.894, above threshold
      [1, 1, 0, 0],    // "medium match" — sim = 1/sqrt(2) ≈ 0.707, below threshold
      [0, 1, 0, 0],    // "low similarity topic" — orthogonal, sim = 0
    ];
    mockFetchWithEmbeddings(queryVec, pastVecs);

    const result = await findEcho("neural network topic");

    expect(result).not.toBeNull();
    expect(result!.previousQuery).toBe("best match topic");
  });

  it("deduplicates past queries (case-insensitive, trimmed) before embedding", async () => {
    const entries = [
      makeEntry({ query: "Machine Learning", timestamp: "2026-03-05T00:00:00.000Z" }),
      makeEntry({ query: "machine learning", timestamp: "2026-03-04T00:00:00.000Z" }),
      makeEntry({ query: "  MACHINE LEARNING  ", timestamp: "2026-03-03T00:00:00.000Z" }),
      makeEntry({ query: "different topic", timestamp: "2026-03-02T00:00:00.000Z" }),
    ];
    vi.mocked(loadLineage).mockResolvedValueOnce(makeStore(entries));

    // Only 2 unique past queries after dedup; both get embedded in batch call
    const queryVec = [1, 0, 0, 0];
    // "Machine Learning" (newest first after sort) → index 0 in pastVecs
    // "different topic" → index 1
    const pastVecs = [
      [0, 1, 0, 0], // orthogonal to queryVec
      [1, 0, 0, 0], // identical to queryVec → exact match, skipped
    ];
    mockFetchWithEmbeddings(queryVec, pastVecs);

    const result = await findEcho("a brand new query");
    // "Machine Learning" orthogonal (sim=0, below threshold), "different topic" exact (skipped)
    expect(result).toBeNull();
  });

  it("respects the MAX_PAST_QUERIES limit of 100", async () => {
    // Create 150 distinct entries (newest first will be kept up to 100)
    const entries = Array.from({ length: 150 }, (_, i) => {
      const d = new Date(2026, 2, 1, 0, 0, i); // each 1 second apart
      return makeEntry({ query: `query number ${i}`, timestamp: d.toISOString() });
    });
    vi.mocked(loadLineage).mockResolvedValueOnce(makeStore(entries));

    // The batch fetch should receive an array of 100 embeddings
    let capturedBatchInput: string[] = [];
    global.fetch = vi.fn(async (url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string);
      if (Array.isArray(body.input) && body.input.length > 1) {
        capturedBatchInput = body.input;
      }
      const data = Array.from({ length: body.input.length }, (_, i) => ({
        embedding: [i === 0 ? 1 : 0, 0, 0, 0],
      }));
      return { ok: true, json: async () => ({ data }) } as unknown as Response;
    }) as typeof global.fetch;

    await findEcho("latest query");

    expect(capturedBatchInput.length).toBeLessThanOrEqual(100);
  });

  it("sorts entries newest-first before deduplication and picks newest duplicate", async () => {
    const entries = [
      makeEntry({ query: "repeated query", timestamp: "2026-01-01T00:00:00.000Z" }), // older
      makeEntry({ query: "repeated query", timestamp: "2026-03-01T00:00:00.000Z" }), // newer
    ];
    vi.mocked(loadLineage).mockResolvedValueOnce(makeStore(entries));

    // After sorting newest-first, the 2026-03-01 entry comes first and is kept;
    // 2026-01-01 is a duplicate and dropped.
    // Provide a match so we can check which timestamp is returned.
    const queryVec = [1, 0.5, 0, 0];
    const pastVec = [1, 0, 0, 0]; // sim ≈ 0.894 > 0.8, not exact
    mockFetchWithEmbeddings(queryVec, [pastVec]);

    const result = await findEcho("new query about repeated topic");

    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe("2026-03-01T00:00:00.000Z");
  });

  it("throws when the single-query Voyage API call fails", async () => {
    vi.mocked(loadLineage).mockResolvedValueOnce(
      makeStore([makeEntry({ query: "some past query" })])
    );

    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      return { ok: false, status: 429 } as unknown as Response;
    }) as typeof global.fetch;

    await expect(findEcho("new query")).rejects.toThrow("Voyage AI error: 429");
  });

  it("throws when the batch Voyage API call fails", async () => {
    vi.mocked(loadLineage).mockResolvedValueOnce(
      makeStore([makeEntry({ query: "some past query" })])
    );

    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // First call (single embedding) succeeds
        return {
          ok: true,
          json: async () => ({ data: [{ embedding: [1, 0, 0, 0] }] }),
        } as unknown as Response;
      }
      // Second call (batch) fails
      return { ok: false, status: 500 } as unknown as Response;
    }) as typeof global.fetch;

    await expect(findEcho("new query")).rejects.toThrow("Voyage AI batch error: 500");
  });

  it("computes daysAgo correctly relative to the timestamp", async () => {
    const pastDate = new Date(Date.now() - 5 * 86_400_000).toISOString(); // 5 days ago
    vi.mocked(loadLineage).mockResolvedValueOnce(
      makeStore([makeEntry({ query: "past topic", timestamp: pastDate })])
    );

    const queryVec = [1, 0.5, 0, 0];
    const pastVec = [1, 0, 0, 0]; // sim ≈ 0.894
    mockFetchWithEmbeddings(queryVec, [pastVec]);

    const result = await findEcho("similar topic");

    expect(result).not.toBeNull();
    expect(result!.daysAgo).toBe(5);
  });

  it("sends the Voyage API request with the correct headers and model", async () => {
    vi.mocked(loadLineage).mockResolvedValueOnce(
      makeStore([makeEntry({ query: "past query" })])
    );

    const capturedRequests: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = vi.fn(async (url: unknown, init: unknown) => {
      capturedRequests.push({ url: url as string, init: init as RequestInit });
      const body = JSON.parse((init as RequestInit).body as string);
      const data = body.input.map((_: unknown) => ({ embedding: [0, 0, 0, 0] }));
      return { ok: true, json: async () => ({ data }) } as unknown as Response;
    }) as typeof global.fetch;

    await findEcho("test query");

    expect(capturedRequests.length).toBeGreaterThanOrEqual(1);
    const firstReq = capturedRequests[0];
    expect(firstReq.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(firstReq.init.method).toBe("POST");
    expect((firstReq.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-voyage-key"
    );
    const firstBody = JSON.parse(firstReq.init.body as string);
    expect(firstBody.model).toBe("voyage-3");
  });
});
