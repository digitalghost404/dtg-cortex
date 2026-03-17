import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

import { getLineageStats, saveLineageEntry, loadLineage, type LineageEntry } from "@/lib/lineage";
import * as kv from "@/lib/kv";

const mockGetJSON = kv.getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = kv.setJSON as ReturnType<typeof vi.fn>;

function makeEntry(overrides: Partial<LineageEntry> = {}): LineageEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: "s1",
    query: "test query",
    sourceNotes: [],
    ...overrides,
  };
}

// Top-level beforeEach to clear call history between all tests
beforeEach(() => {
  vi.clearAllMocks();
  mockSetJSON.mockResolvedValue(undefined);
});

describe("loadLineage", () => {

  it("returns empty store when KV returns null", async () => {
    mockGetJSON.mockResolvedValue(null);
    const store = await loadLineage();
    expect(store.entries).toEqual([]);
  });

  it("returns stored entries", async () => {
    const entry = makeEntry({ query: "hello" });
    mockGetJSON.mockResolvedValue({ entries: [entry] });

    const store = await loadLineage();
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].query).toBe("hello");
  });

  it("returns empty store on KV error", async () => {
    mockGetJSON.mockRejectedValue(new Error("connection failed"));
    const store = await loadLineage();
    expect(store.entries).toEqual([]);
  });
});

describe("saveLineageEntry", () => {
  it("appends entry to existing store", async () => {
    const existing = makeEntry({ query: "first" });
    mockGetJSON.mockResolvedValue({ entries: [existing] });

    const newEntry = makeEntry({ query: "second" });
    await saveLineageEntry(newEntry);

    expect(mockSetJSON).toHaveBeenCalledWith(
      "lineage:entries",
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ query: "first" }),
          expect.objectContaining({ query: "second" }),
        ]),
      })
    );
  });

  it("prunes to 1000 entries when over limit", async () => {
    const entries = Array.from({ length: 1001 }, (_, i) =>
      makeEntry({ query: `query-${i}` })
    );
    mockGetJSON.mockResolvedValue({ entries });

    await saveLineageEntry(makeEntry({ query: "overflow" }));

    // Find the setJSON call for lineage:entries
    const call = mockSetJSON.mock.calls.find((c: unknown[]) => c[0] === "lineage:entries");
    expect(call).toBeDefined();
    expect(call![1].entries.length).toBe(1000);
  });

  it("catches and logs error when setJSON throws", async () => {
    mockGetJSON.mockResolvedValue({ entries: [] });
    mockSetJSON.mockRejectedValue(new Error("write failed"));

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await saveLineageEntry(makeEntry({ query: "will-fail" }));
    expect(spy).toHaveBeenCalledWith("[lineage saveLineageEntry]", expect.any(Error));
    spy.mockRestore();
  });
});

describe("getLineageStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns zero stats for empty lineage", async () => {
    mockGetJSON.mockResolvedValue({ entries: [] });

    const stats = await getLineageStats();
    expect(stats.totalQueries).toBe(0);
    expect(stats.uniqueNotesReferenced).toBe(0);
    expect(stats.mostReferencedNotes).toEqual([]);
    expect(stats.recentEntries).toEqual([]);
  });

  it("counts total queries", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [makeEntry(), makeEntry(), makeEntry()],
    });

    const stats = await getLineageStats();
    expect(stats.totalQueries).toBe(3);
  });

  it("counts unique notes referenced", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeEntry({
          sourceNotes: [
            { name: "note-a", path: "a.md", score: 0.9 },
            { name: "note-b", path: "b.md", score: 0.8 },
          ],
        }),
        makeEntry({
          sourceNotes: [
            { name: "note-a", path: "a.md", score: 0.9 },
            { name: "note-c", path: "c.md", score: 0.7 },
          ],
        }),
      ],
    });

    const stats = await getLineageStats();
    expect(stats.uniqueNotesReferenced).toBe(3);
  });

  it("ranks most referenced notes correctly", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeEntry({
          timestamp: "2025-06-15T10:00:00Z",
          sourceNotes: [{ name: "popular", path: "popular.md", score: 0.9 }],
        }),
        makeEntry({
          timestamp: "2025-06-15T11:00:00Z",
          sourceNotes: [{ name: "popular", path: "popular.md", score: 0.8 }],
        }),
        makeEntry({
          timestamp: "2025-06-15T11:30:00Z",
          sourceNotes: [{ name: "rare", path: "rare.md", score: 0.7 }],
        }),
      ],
    });

    const stats = await getLineageStats();
    expect(stats.mostReferencedNotes[0].name).toBe("popular");
    expect(stats.mostReferencedNotes[0].count).toBe(2);
    expect(stats.mostReferencedNotes[1].name).toBe("rare");
  });

  it("returns recent entries sorted newest-first, capped at 50", async () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      makeEntry({
        timestamp: new Date(Date.now() - i * 3_600_000).toISOString(),
        query: `query-${i}`,
      })
    );
    mockGetJSON.mockResolvedValue({ entries });

    const stats = await getLineageStats();
    expect(stats.recentEntries.length).toBe(50);
    // First should be newest
    expect(stats.recentEntries[0].query).toBe("query-0");
  });

  it("builds note timeline with first/last seen", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeEntry({
          timestamp: "2025-06-10T10:00:00Z",
          sourceNotes: [{ name: "note-a", path: "a.md", score: 0.9 }],
        }),
        makeEntry({
          timestamp: "2025-06-15T10:00:00Z",
          sourceNotes: [{ name: "note-a", path: "a.md", score: 0.8 }],
        }),
      ],
    });

    const stats = await getLineageStats();
    const timeline = stats.noteTimeline.find((n) => n.name === "note-a");
    expect(timeline).toBeDefined();
    expect(timeline!.firstSeen).toBe("2025-06-10T10:00:00Z");
    expect(timeline!.lastSeen).toBe("2025-06-15T10:00:00Z");
    expect(timeline!.count).toBe(2);
  });

  it("generates queriesPerDay for last 30 days", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeEntry({ timestamp: "2025-06-15T10:00:00Z" }),
        makeEntry({ timestamp: "2025-06-15T11:00:00Z" }),
        makeEntry({ timestamp: "2025-06-14T08:00:00Z" }),
      ],
    });

    const stats = await getLineageStats();
    expect(stats.queriesPerDay.length).toBe(30);
    const today = stats.queriesPerDay.find((d) => d.date === "2025-06-15");
    expect(today?.count).toBe(2);
    const yesterday = stats.queriesPerDay.find((d) => d.date === "2025-06-14");
    expect(yesterday?.count).toBe(1);
  });
});
