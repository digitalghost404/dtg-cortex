import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/vault", () => ({
  getAllNotes: vi.fn(),
}));
vi.mock("@/lib/lineage", () => ({
  loadLineage: vi.fn(),
}));
vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

import { computeSynapticWeights, getSynapticWeights } from "@/lib/synaptic-weights";
import { getAllNotes } from "@/lib/vault";
import { loadLineage } from "@/lib/lineage";
import * as kv from "@/lib/kv";

const mockGetAllNotes = getAllNotes as ReturnType<typeof vi.fn>;
const mockLoadLineage = loadLineage as ReturnType<typeof vi.fn>;
const mockGetJSON = kv.getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = kv.setJSON as ReturnType<typeof vi.fn>;

function note(name: string, path: string, outgoing: string[] = []) {
  return { name, path, outgoing, tags: [], folder: "(root)", modifiedAt: new Date().toISOString() };
}

describe("computeSynapticWeights", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLoadLineage.mockResolvedValue({ entries: [] });
  });

  it("returns empty object for no notes", async () => {
    mockGetAllNotes.mockResolvedValue([]);
    const result = await computeSynapticWeights();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("assigns weight for a wikilink connection", async () => {
    mockGetAllNotes.mockResolvedValue([
      note("A", "a.md", ["B"]),
      note("B", "b.md"),
    ]);

    const result = await computeSynapticWeights();
    expect(result["a.md::b.md"]).toBe(1); // normalized: 1/1 = 1
  });

  it("edge key is always alphabetically ordered", async () => {
    mockGetAllNotes.mockResolvedValue([
      note("Z", "z.md", ["A"]),
      note("A", "a.md"),
    ]);

    const result = await computeSynapticWeights();
    // Should use "a.md::z.md" not "z.md::a.md"
    expect(result["a.md::z.md"]).toBeDefined();
    expect(result["z.md::a.md"]).toBeUndefined();
  });

  it("adds 0.5 for lineage co-occurrences", async () => {
    mockGetAllNotes.mockResolvedValue([
      note("A", "a.md"),
      note("B", "b.md"),
    ]);
    mockLoadLineage.mockResolvedValue({
      entries: [
        {
          id: "1",
          timestamp: new Date().toISOString(),
          sessionId: "s1",
          query: "test",
          sourceNotes: [
            { name: "A", path: "a.md", score: 0.9 },
            { name: "B", path: "b.md", score: 0.8 },
          ],
        },
      ],
    });

    const result = await computeSynapticWeights();
    // maxWeight = max(1, 0.5) = 1, so normalized = 0.5/1 = 0.5
    expect(result["a.md::b.md"]).toBe(0.5);
  });

  it("combines wikilink and co-occurrence weights", async () => {
    mockGetAllNotes.mockResolvedValue([
      note("A", "a.md", ["B"]),
      note("B", "b.md"),
      note("C", "c.md"),
    ]);
    mockLoadLineage.mockResolvedValue({
      entries: [
        {
          id: "1",
          timestamp: new Date().toISOString(),
          sessionId: "s1",
          query: "test",
          sourceNotes: [
            { name: "A", path: "a.md", score: 0.9 },
            { name: "B", path: "b.md", score: 0.8 },
          ],
        },
      ],
    });

    const result = await computeSynapticWeights();
    // A->B: 1 (link) + 0.5 (co-occurrence) = 1.5, max = 1.5, normalized = 1
    expect(result["a.md::b.md"]).toBe(1);
  });

  it("normalizes all weights to 0-1 range", async () => {
    mockGetAllNotes.mockResolvedValue([
      note("A", "a.md", ["B", "C"]),
      note("B", "b.md", ["A"]),
      note("C", "c.md"),
    ]);

    const result = await computeSynapticWeights();
    for (const weight of Object.values(result)) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it("handles multiple lineage co-occurrences (stacking)", async () => {
    mockGetAllNotes.mockResolvedValue([
      note("A", "a.md"),
      note("B", "b.md"),
      note("C", "c.md"),
    ]);
    mockLoadLineage.mockResolvedValue({
      entries: [
        {
          id: "1",
          timestamp: new Date().toISOString(),
          sessionId: "s1",
          query: "test1",
          sourceNotes: [
            { name: "A", path: "a.md", score: 0.9 },
            { name: "B", path: "b.md", score: 0.8 },
          ],
        },
        {
          id: "2",
          timestamp: new Date().toISOString(),
          sessionId: "s2",
          query: "test2",
          sourceNotes: [
            { name: "A", path: "a.md", score: 0.9 },
            { name: "B", path: "b.md", score: 0.7 },
          ],
        },
        {
          id: "3",
          timestamp: new Date().toISOString(),
          sessionId: "s3",
          query: "test3",
          sourceNotes: [
            { name: "A", path: "a.md", score: 0.9 },
            { name: "C", path: "c.md", score: 0.6 },
          ],
        },
      ],
    });

    const result = await computeSynapticWeights();
    // A-B: 0.5 + 0.5 = 1.0, A-C: 0.5, max = 1.0
    expect(result["a.md::b.md"]).toBe(1);
    expect(result["a.md::c.md"]).toBe(0.5);
  });

  it("does not create self-links", async () => {
    mockGetAllNotes.mockResolvedValue([
      note("A", "a.md", ["A"]), // self-link
    ]);

    const result = await computeSynapticWeights();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("ignores links to notes not in the vault", async () => {
    mockGetAllNotes.mockResolvedValue([
      note("A", "a.md", ["NonExistent"]),
    ]);

    const result = await computeSynapticWeights();
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("getSynapticWeights", () => {
  const FRESH_WEIGHTS = { "a.md::b.md": 0.8 };
  const STALE_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    vi.clearAllMocks();
    mockSetJSON.mockResolvedValue(undefined);
    // Default: vault has two linked notes so computeSynapticWeights returns something
    mockGetAllNotes.mockResolvedValue([note("A", "a.md", ["B"]), note("B", "b.md")]);
    mockLoadLineage.mockResolvedValue({ entries: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached weights when computedAt is within 24h", async () => {
    const freshTimestamp = new Date(Date.now() - 1000).toISOString(); // 1s ago
    mockGetJSON
      .mockResolvedValueOnce(freshTimestamp)   // CACHE_TS_KEY
      .mockResolvedValueOnce(FRESH_WEIGHTS);    // CACHE_KEY

    const result = await getSynapticWeights();
    expect(result).toEqual(FRESH_WEIGHTS);
    // Should NOT call getAllNotes (no recompute)
    expect(mockGetAllNotes).not.toHaveBeenCalled();
  });

  it("recomputes when computedAt is older than 24h", async () => {
    const staleTimestamp = new Date(Date.now() - STALE_MS - 1000).toISOString();
    mockGetJSON
      .mockResolvedValueOnce(staleTimestamp)   // CACHE_TS_KEY
      .mockResolvedValueOnce(FRESH_WEIGHTS);    // CACHE_KEY (not reached)

    const result = await getSynapticWeights();
    // A recompute happened — getAllNotes was called
    expect(mockGetAllNotes).toHaveBeenCalled();
    // Result is freshly computed (not the stale cached object)
    expect(result["a.md::b.md"]).toBeDefined();
  });

  it("recomputes when there is no cached timestamp", async () => {
    mockGetJSON
      .mockResolvedValueOnce(null)  // CACHE_TS_KEY missing
      .mockResolvedValueOnce(FRESH_WEIGHTS);

    const result = await getSynapticWeights();
    expect(mockGetAllNotes).toHaveBeenCalled();
    expect(result["a.md::b.md"]).toBeDefined();
  });

  it("recomputes when timestamp is fresh but cached weights are absent", async () => {
    const freshTimestamp = new Date(Date.now() - 1000).toISOString();
    mockGetJSON
      .mockResolvedValueOnce(freshTimestamp) // CACHE_TS_KEY
      .mockResolvedValueOnce(null);           // CACHE_KEY missing

    const result = await getSynapticWeights();
    expect(mockGetAllNotes).toHaveBeenCalled();
    expect(result["a.md::b.md"]).toBeDefined();
  });

  it("saves new weights and timestamp after recompute", async () => {
    mockGetJSON.mockResolvedValue(null); // No cache at all

    await getSynapticWeights();

    expect(mockSetJSON).toHaveBeenCalledWith("cortex:synaptic-weights", expect.any(Object));
    expect(mockSetJSON).toHaveBeenCalledWith(
      "cortex:synaptic-weights:computedAt",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );
  });

  it("forceRecompute=true skips cache check and always recomputes", async () => {
    const freshTimestamp = new Date(Date.now() - 1000).toISOString();
    mockGetJSON
      .mockResolvedValueOnce(freshTimestamp)
      .mockResolvedValueOnce(FRESH_WEIGHTS);

    const result = await getSynapticWeights(true);
    // Cache was bypassed — getAllNotes called
    expect(mockGetAllNotes).toHaveBeenCalled();
    expect(result["a.md::b.md"]).toBeDefined();
  });

  it("forceRecompute=true saves updated cache after recompute", async () => {
    mockGetJSON.mockResolvedValue(null);

    await getSynapticWeights(true);

    expect(mockSetJSON).toHaveBeenCalledWith("cortex:synaptic-weights", expect.any(Object));
    expect(mockSetJSON).toHaveBeenCalledWith(
      "cortex:synaptic-weights:computedAt",
      expect.any(String)
    );
  });
});
