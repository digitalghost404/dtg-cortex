import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computePhantomThreads,
  getPhantomThreads,
  removePhantomThread,
  type PhantomThread,
} from "@/lib/phantom-threads";

vi.mock("@/lib/vector", () => ({
  fetchAllVectors: vi.fn(),
}));

vi.mock("@/lib/vault", () => ({
  getAllNotes: vi.fn(),
}));

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

import { fetchAllVectors } from "@/lib/vector";
import { getAllNotes } from "@/lib/vault";
import * as kv from "@/lib/kv";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(path: string, name: string, vec: number[]) {
  return {
    id: `${path}#chunk0`,
    vector: vec,
    metadata: { path, name, chunk: 0, text: "content", tags: [] },
  };
}

function makeNote(
  path: string,
  name: string,
  outgoing: string[] = []
) {
  return {
    name,
    path,
    content: "",
    rawContent: "",
    tags: [],
    outgoing,
    folder: "(root)",
    words: 0,
    modifiedAt: "2026-03-17T10:00:00.000Z",
    size: 0,
  };
}

// Two nearly identical unit vectors → cosine similarity close to 1
const vecA = [1, 0, 0];
const vecB = [0.99, 0.14, 0]; // ~cos 0.99 with vecA
// Orthogonal vector → similarity 0
const vecC = [0, 1, 0];
// Zero vector
const vecZero = [0, 0, 0];

// ---------------------------------------------------------------------------
// computePhantomThreads
// ---------------------------------------------------------------------------

describe("computePhantomThreads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when there are no vectors", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([]);

    const result = await computePhantomThreads();

    expect(result).toEqual([]);
  });

  it("returns empty array when only one note has vectors", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecA),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", "Note A")]);

    const result = await computePhantomThreads();

    expect(result).toEqual([]);
  });

  it("detects a phantom thread between two similar unlinked notes", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecA),
      makeVector("b.md", "Note B", vecB),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", "Note A"),
      makeNote("b.md", "Note B"),
    ]);

    const result = await computePhantomThreads();

    expect(result).toHaveLength(1);
    expect(result[0].sourceNotePath).toBe("a.md");
    expect(result[0].targetNotePath).toBe("b.md");
    expect(result[0].similarity).toBeGreaterThan(0.7);
  });

  it("excludes pairs where source links to target (outgoing A→B)", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecA),
      makeVector("b.md", "Note B", vecB),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", "Note A", ["Note B"]),
      makeNote("b.md", "Note B"),
    ]);

    const result = await computePhantomThreads();

    expect(result).toHaveLength(0);
  });

  it("excludes pairs where target links to source (outgoing B→A)", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecA),
      makeVector("b.md", "Note B", vecB),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", "Note A"),
      makeNote("b.md", "Note B", ["Note A"]),
    ]);

    const result = await computePhantomThreads();

    expect(result).toHaveLength(0);
  });

  it("filters out pairs with similarity at or below 0.7 threshold", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecA),
      makeVector("c.md", "Note C", vecC),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", "Note A"),
      makeNote("c.md", "Note C"),
    ]);

    const result = await computePhantomThreads();

    expect(result).toHaveLength(0);
  });

  it("handles zero vectors (denominator=0) — returns similarity 0, not a phantom", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecZero),
      makeVector("b.md", "Note B", vecZero),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", "Note A"),
      makeNote("b.md", "Note B"),
    ]);

    const result = await computePhantomThreads();

    expect(result).toHaveLength(0);
  });

  it("averages multiple chunk vectors per note before comparing", async () => {
    // Two chunks for note A: vecA and vecC → avg = [0.5, 0.5, 0]
    // Note B has one chunk: [0.5, 0.5, 0] exactly → similarity should be 1
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecA),
      {
        id: "a.md#chunk1",
        vector: vecC,
        metadata: { path: "a.md", name: "Note A", chunk: 1, text: "content", tags: [] },
      },
      makeVector("b.md", "Note B", [0.5, 0.5, 0]),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", "Note A"),
      makeNote("b.md", "Note B"),
    ]);

    const result = await computePhantomThreads();

    // avg of vecA=[1,0,0] + vecC=[0,1,0] = [0.5, 0.5, 0]
    // cos([0.5, 0.5, 0], [0.5, 0.5, 0]) = 1.0 → above threshold
    expect(result).toHaveLength(1);
    expect(result[0].similarity).toBeCloseTo(1.0);
  });

  it("sorts results by similarity descending", async () => {
    // Three notes: A similar to both B and C, but A-C more similar than A-B
    const vecHigh = [0.9999, 0.01, 0]; // very close to vecA
    const vecMid = [0.95, 0.31, 0];  // also close to vecA but less

    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecA),
      makeVector("b.md", "Note B", vecMid),
      makeVector("c.md", "Note C", vecHigh),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", "Note A"),
      makeNote("b.md", "Note B"),
      makeNote("c.md", "Note C"),
    ]);

    const result = await computePhantomThreads();

    // All pairs above 0.7 — just verify sorted descending
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].similarity).toBeGreaterThanOrEqual(result[i].similarity);
    }
  });

  it("caps results at 20 entries", async () => {
    // Build 21 notes all similar to each other (identical vectors)
    const vectors = Array.from({ length: 21 }, (_, i) =>
      makeVector(`note${i}.md`, `Note ${i}`, [1, 0, 0])
    );
    const notes = Array.from({ length: 21 }, (_, i) =>
      makeNote(`note${i}.md`, `Note ${i}`)
    );

    vi.mocked(fetchAllVectors).mockResolvedValueOnce(vectors);
    vi.mocked(getAllNotes).mockResolvedValueOnce(notes);

    const result = await computePhantomThreads();

    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("sets correct name fields on returned PhantomThread", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("alpha.md", "Alpha Note", vecA),
      makeVector("beta.md", "Beta Note", vecB),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("alpha.md", "Alpha Note"),
      makeNote("beta.md", "Beta Note"),
    ]);

    const [thread] = await computePhantomThreads();

    expect(thread.sourceNoteName).toBe("Alpha Note");
    expect(thread.targetNoteName).toBe("Beta Note");
  });
});

// ---------------------------------------------------------------------------
// getPhantomThreads
// ---------------------------------------------------------------------------

describe("getPhantomThreads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached data when timestamp is fresh (within 24h)", async () => {
    const freshTs = new Date(Date.now() - 1000).toISOString(); // 1 second ago
    const cachedThreads: PhantomThread[] = [
      {
        sourceNotePath: "a.md",
        sourceNoteName: "A",
        targetNotePath: "b.md",
        targetNoteName: "B",
        similarity: 0.9,
      },
    ];

    vi.mocked(kv.getJSON)
      .mockResolvedValueOnce(freshTs)      // CACHE_TS_KEY
      .mockResolvedValueOnce(cachedThreads); // CACHE_KEY

    const result = await getPhantomThreads(false);

    expect(result).toEqual(cachedThreads);
    // fetchAllVectors should NOT have been called
    expect(fetchAllVectors).not.toHaveBeenCalled();
  });

  it("recomputes when cached timestamp is stale (>24h)", async () => {
    const staleTs = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    vi.mocked(kv.getJSON).mockResolvedValueOnce(staleTs); // stale timestamp
    // computePhantomThreads will call fetchAllVectors + getAllNotes
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([]);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    const result = await getPhantomThreads(false);

    expect(result).toEqual([]);
    expect(fetchAllVectors).toHaveBeenCalled();
    expect(kv.setJSON).toHaveBeenCalledTimes(2); // cache data + timestamp
  });

  it("recomputes when there is no cached timestamp", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null); // no timestamp
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([]);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    const result = await getPhantomThreads(false);

    expect(result).toEqual([]);
    expect(fetchAllVectors).toHaveBeenCalled();
  });

  it("recomputes when cached data is null even with fresh timestamp", async () => {
    const freshTs = new Date(Date.now() - 1000).toISOString();

    vi.mocked(kv.getJSON)
      .mockResolvedValueOnce(freshTs) // fresh timestamp
      .mockResolvedValueOnce(null);  // but null cache data
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([]);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    const result = await getPhantomThreads(false);

    expect(result).toEqual([]);
    expect(fetchAllVectors).toHaveBeenCalled();
  });

  it("always recomputes when forceRecompute=true, ignoring fresh cache", async () => {
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([]);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    const result = await getPhantomThreads(true);

    expect(result).toEqual([]);
    expect(fetchAllVectors).toHaveBeenCalled();
    // Should not have read cache keys at all
    expect(kv.getJSON).not.toHaveBeenCalled();
  });

  it("saves recomputed threads and new timestamp to cache", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);
    vi.mocked(fetchAllVectors).mockResolvedValueOnce([
      makeVector("a.md", "Note A", vecA),
      makeVector("b.md", "Note B", vecB),
    ]);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", "Note A"),
      makeNote("b.md", "Note B"),
    ]);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    await getPhantomThreads(false);

    expect(kv.setJSON).toHaveBeenCalledWith(
      "cortex:phantom-threads",
      expect.any(Array)
    );
    expect(kv.setJSON).toHaveBeenCalledWith(
      "cortex:phantom-threads:computedAt",
      expect.any(String)
    );
  });
});

// ---------------------------------------------------------------------------
// removePhantomThread
// ---------------------------------------------------------------------------

describe("removePhantomThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when the cache is empty", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);

    await removePhantomThread("a.md", "b.md");

    expect(kv.setJSON).not.toHaveBeenCalled();
  });

  it("removes the exact matching source→target pair", async () => {
    const threads: PhantomThread[] = [
      {
        sourceNotePath: "a.md",
        sourceNoteName: "A",
        targetNotePath: "b.md",
        targetNoteName: "B",
        similarity: 0.9,
      },
      {
        sourceNotePath: "c.md",
        sourceNoteName: "C",
        targetNotePath: "d.md",
        targetNoteName: "D",
        similarity: 0.85,
      },
    ];
    vi.mocked(kv.getJSON).mockResolvedValueOnce(threads);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    await removePhantomThread("a.md", "b.md");

    const saved = vi.mocked(kv.setJSON).mock.calls[0][1] as PhantomThread[];
    expect(saved).toHaveLength(1);
    expect(saved[0].sourceNotePath).toBe("c.md");
  });

  it("removes the reverse target→source pair too", async () => {
    const threads: PhantomThread[] = [
      {
        sourceNotePath: "b.md",
        sourceNoteName: "B",
        targetNotePath: "a.md",
        targetNoteName: "A",
        similarity: 0.9,
      },
    ];
    vi.mocked(kv.getJSON).mockResolvedValueOnce(threads);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    await removePhantomThread("a.md", "b.md");

    const saved = vi.mocked(kv.setJSON).mock.calls[0][1] as PhantomThread[];
    expect(saved).toHaveLength(0);
  });

  it("saves the filtered list even when nothing matched (no-op filter)", async () => {
    const threads: PhantomThread[] = [
      {
        sourceNotePath: "c.md",
        sourceNoteName: "C",
        targetNotePath: "d.md",
        targetNoteName: "D",
        similarity: 0.8,
      },
    ];
    vi.mocked(kv.getJSON).mockResolvedValueOnce(threads);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    await removePhantomThread("a.md", "b.md");

    const saved = vi.mocked(kv.setJSON).mock.calls[0][1] as PhantomThread[];
    expect(saved).toHaveLength(1);
    expect(saved[0].sourceNotePath).toBe("c.md");
  });

  it("removes both directions from a list containing both orderings", async () => {
    const threads: PhantomThread[] = [
      {
        sourceNotePath: "a.md",
        sourceNoteName: "A",
        targetNotePath: "b.md",
        targetNoteName: "B",
        similarity: 0.95,
      },
      {
        sourceNotePath: "b.md",
        sourceNoteName: "B",
        targetNotePath: "a.md",
        targetNoteName: "A",
        similarity: 0.95,
      },
    ];
    vi.mocked(kv.getJSON).mockResolvedValueOnce(threads);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    await removePhantomThread("a.md", "b.md");

    const saved = vi.mocked(kv.setJSON).mock.calls[0][1] as PhantomThread[];
    expect(saved).toHaveLength(0);
  });
});
