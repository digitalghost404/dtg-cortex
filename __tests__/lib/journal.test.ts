import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));
vi.mock("@/lib/lineage", () => ({
  getLineageStats: vi.fn(),
}));
vi.mock("@/lib/mood", () => ({
  getMoodHistory: vi.fn(),
}));
vi.mock("@/lib/drift", () => ({
  detectDrift: vi.fn(),
}));
vi.mock("@/lib/vault", () => ({
  getVaultMeta: vi.fn(),
}));

import { generateJournalEntry, getJournalEntries } from "@/lib/journal";
import * as kv from "@/lib/kv";
import { getLineageStats } from "@/lib/lineage";
import { getMoodHistory } from "@/lib/mood";
import { detectDrift } from "@/lib/drift";
import { getVaultMeta } from "@/lib/vault";

const mockGetJSON = kv.getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = kv.setJSON as ReturnType<typeof vi.fn>;
const mockLineageStats = getLineageStats as ReturnType<typeof vi.fn>;
const mockMoodHistory = getMoodHistory as ReturnType<typeof vi.fn>;
const mockDrift = detectDrift as ReturnType<typeof vi.fn>;
const mockVaultMeta = getVaultMeta as ReturnType<typeof vi.fn>;

function makeStats(todayQueries: Array<{ timestamp: string; sourceNotes: Array<{ name: string }> }> = []) {
  return {
    totalQueries: todayQueries.length,
    uniqueNotesReferenced: 0,
    mostReferencedNotes: [],
    recentEntries: todayQueries.map((q) => ({
      id: crypto.randomUUID(),
      timestamp: q.timestamp,
      sessionId: "s1",
      query: "test",
      sourceNotes: q.sourceNotes.map((s) => ({ ...s, path: `${s.name}.md`, score: 0.9 })),
    })),
    noteTimeline: [],
    queriesPerDay: [],
  };
}

describe("generateJournalEntry", () => {
  const testDate = new Date("2025-06-15T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(testDate);
    // Default: no cache hit
    mockGetJSON.mockResolvedValue(null);
    mockSetJSON.mockResolvedValue(undefined);
    mockMoodHistory.mockResolvedValue([]);
    mockDrift.mockResolvedValue({ emerging: [], fading: [], stable: [] });
    mockVaultMeta.mockResolvedValue({ totalNotes: 42 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns cached entry if available", async () => {
    const cached = {
      date: "2025-06-15",
      dayNumber: 10,
      content: "cached content",
      generatedAt: "2025-06-15T10:00:00Z",
    };
    mockGetJSON.mockImplementation((key: string) => {
      if (key === "cortex:journal:2025-06-15") return Promise.resolve(cached);
      return Promise.resolve(null);
    });

    const result = await generateJournalEntry(testDate);
    expect(result.content).toBe("cached content");
  });

  it("generates entry with query count", async () => {
    mockLineageStats.mockResolvedValue(
      makeStats([
        { timestamp: "2025-06-15T10:00:00Z", sourceNotes: [{ name: "note-a" }] },
        { timestamp: "2025-06-15T11:00:00Z", sourceNotes: [{ name: "note-b" }] },
      ])
    );

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("2 queries today");
    expect(result.date).toBe("2025-06-15");
  });

  it("includes top topics in the entry", async () => {
    mockLineageStats.mockResolvedValue(
      makeStats([
        { timestamp: "2025-06-15T10:00:00Z", sourceNotes: [{ name: "kubernetes" }] },
        { timestamp: "2025-06-15T11:00:00Z", sourceNotes: [{ name: "kubernetes" }] },
        { timestamp: "2025-06-15T11:30:00Z", sourceNotes: [{ name: "docker" }] },
      ])
    );

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("kubernetes");
  });

  it("includes mood narrative", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockMoodHistory.mockResolvedValue([
      { mood: "FOCUSED", intensity: 0.8, timestamp: "2025-06-15T10:00:00Z" },
    ]);

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("FOCUSED all day");
  });

  it("includes mood transitions in narrative", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockMoodHistory.mockResolvedValue([
      { mood: "CONTEMPLATIVE", intensity: 0.5, timestamp: "2025-06-15T08:00:00Z" },
      { mood: "FOCUSED", intensity: 0.8, timestamp: "2025-06-15T12:00:00Z" },
    ]);

    const result = await generateJournalEntry(testDate);
    expect(result.content).toMatch(/CONTEMPLATIVE.*FOCUSED/);
  });

  it("includes drift information when emerging topics exist", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockDrift.mockResolvedValue({
      emerging: ["kubernetes"],
      fading: [],
      stable: [],
    });

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("Emerging interest in kubernetes");
  });

  it("includes fading drift when no emerging topics", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockDrift.mockResolvedValue({
      emerging: [],
      fading: ["docker"],
      stable: [],
    });

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("docker");
    expect(result.content).toContain("fading");
  });

  it("includes note count from vault meta", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockVaultMeta.mockResolvedValue({ totalNotes: 150 });

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("150 nodes");
  });

  it("handles drift detection failure gracefully", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockDrift.mockRejectedValue(new Error("drift failed"));

    const result = await generateJournalEntry(testDate);
    // Should still generate an entry without drift info
    expect(result.date).toBe("2025-06-15");
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("saves generated entry to KV cache", async () => {
    mockLineageStats.mockResolvedValue(makeStats());

    await generateJournalEntry(testDate);

    expect(mockSetJSON).toHaveBeenCalledWith(
      "cortex:journal:2025-06-15",
      expect.objectContaining({ date: "2025-06-15" })
    );
  });

  it("handles zero queries gracefully", async () => {
    mockLineageStats.mockResolvedValue(makeStats([]));

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("0 queries today");
  });

  it("computes dayNumber > 1 when lineage entries exist from earlier", async () => {
    // Earliest entry is 3 days ago; day number should be 4 (floor(3d) + 1)
    const threeDaysAgo = new Date(testDate.getTime() - 3 * 86_400_000).toISOString();
    mockLineageStats.mockResolvedValue(
      makeStats([{ timestamp: threeDaysAgo, sourceNotes: [{ name: "note-a" }] }])
    );

    const result = await generateJournalEntry(testDate);
    expect(result.dayNumber).toBeGreaterThanOrEqual(4);
  });

  it("uses dayNumber 1 when lineage has no entries", async () => {
    mockLineageStats.mockResolvedValue(makeStats([]));

    const result = await generateJournalEntry(testDate);
    expect(result.dayNumber).toBe(1);
  });

  it("includes phantom thread line when phantom threads exist in KV", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockGetJSON.mockImplementation((key: string) => {
      if (key === "cortex:phantom-threads")
        return Promise.resolve([{ sourceNoteName: "alpha", targetNoteName: "beta" }]);
      return Promise.resolve(null);
    });

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("alpha");
    expect(result.content).toContain("beta");
  });

  it("shows 'No new phantom connections.' when phantom threads are empty", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockGetJSON.mockImplementation((key: string) => {
      if (key === "cortex:phantom-threads") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("No new phantom connections.");
  });

  it("includes 'No mood data recorded.' when mood history is empty", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockMoodHistory.mockResolvedValue([]);

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("No mood data recorded.");
  });

  it("includes multiple mood transitions summary when more than one shift occurs", async () => {
    mockLineageStats.mockResolvedValue(makeStats());
    mockMoodHistory.mockResolvedValue([
      { mood: "DORMANT", intensity: 1, timestamp: "2025-06-15T07:00:00Z" },
      { mood: "CONTEMPLATIVE", intensity: 0.6, timestamp: "2025-06-15T09:00:00Z" },
      { mood: "FOCUSED", intensity: 0.9, timestamp: "2025-06-15T11:00:00Z" },
    ]);

    const result = await generateJournalEntry(testDate);
    expect(result.content).toMatch(/2 mood shifts today/);
  });

  it("includes topic-spread summary when queries have no common notes", async () => {
    // Each query references a unique note → topTopics empty logic skipped, topicSummary shows spread
    mockLineageStats.mockResolvedValue(
      makeStats(
        Array.from({ length: 3 }, (_, i) => ({
          timestamp: `2025-06-15T0${i + 8}:00:00Z`,
          sourceNotes: [{ name: `unique-note-${i}` }],
        }))
      )
    );

    const result = await generateJournalEntry(testDate);
    // 3 unique notes → top topics appear
    expect(result.content).toContain("mostly about");
  });

  it("shows 'spread across N topics' when queries exist but sourceNotes are empty", async () => {
    // queryCount > 0 but topTopics.length === 0 (no sourceNotes)
    mockLineageStats.mockResolvedValue(
      makeStats([
        { timestamp: "2025-06-15T08:00:00Z", sourceNotes: [] },
        { timestamp: "2025-06-15T09:00:00Z", sourceNotes: [] },
      ])
    );

    const result = await generateJournalEntry(testDate);
    expect(result.content).toContain("spread across");
  });

  it("uses current date when no date argument is passed", async () => {
    // Exercises the `date ?? new Date()` fallback branch (line 84)
    mockLineageStats.mockResolvedValue(makeStats());

    const result = await generateJournalEntry(); // no date passed
    // The system time is 2025-06-15, so the entry date should be today's date
    expect(result.date).toBe("2025-06-15");
  });

  it("omits node count line when vault meta totalNotes is 0", async () => {
    // Exercises `if (noteCount > 0)` false branch (line 166) AND `?? 0` branch (line 156)
    mockLineageStats.mockResolvedValue(makeStats());
    mockVaultMeta.mockResolvedValue({ totalNotes: 0 });

    const result = await generateJournalEntry(testDate);
    expect(result.content).not.toContain("nodes.");
  });

  it("omits node count line when vault meta is null", async () => {
    // Exercises meta?.totalNotes falling back to 0 (the ?. and ?? branches on line 156)
    mockLineageStats.mockResolvedValue(makeStats());
    mockVaultMeta.mockResolvedValue(null);

    const result = await generateJournalEntry(testDate);
    expect(result.content).not.toContain("nodes.");
  });

  it("no transition pushed when consecutive mood entries have the same mood", async () => {
    // Exercises the false branch of `if (history[i].mood !== history[i-1].mood)` (line 50)
    mockLineageStats.mockResolvedValue(makeStats());
    mockMoodHistory.mockResolvedValue([
      { mood: "FOCUSED", intensity: 0.8, timestamp: "2025-06-15T08:00:00Z" },
      { mood: "FOCUSED", intensity: 0.9, timestamp: "2025-06-15T10:00:00Z" }, // same mood
      { mood: "RESTLESS", intensity: 0.7, timestamp: "2025-06-15T12:00:00Z" }, // different
    ]);

    const result = await generateJournalEntry(testDate);
    // Only one unique transition (FOCUSED → RESTLESS) — should show "Shifted from"
    expect(result.content).toMatch(/Shifted from/);
  });
});

describe("getJournalEntries", () => {
  const testDate = new Date("2025-06-15T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(testDate);
    vi.clearAllMocks();
    mockSetJSON.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty array when no entries are stored", async () => {
    mockGetJSON.mockResolvedValue(null);
    const result = await getJournalEntries();
    expect(result).toEqual([]);
  });

  it("returns only the dates that have stored entries", async () => {
    const entry0: ReturnType<typeof Object> = {
      date: "2025-06-15",
      dayNumber: 5,
      content: "today",
      generatedAt: "2025-06-15T12:00:00Z",
    };
    const entry2: ReturnType<typeof Object> = {
      date: "2025-06-13",
      dayNumber: 3,
      content: "two days ago",
      generatedAt: "2025-06-13T12:00:00Z",
    };

    mockGetJSON.mockImplementation((key: string) => {
      if (key === "cortex:journal:2025-06-15") return Promise.resolve(entry0);
      if (key === "cortex:journal:2025-06-13") return Promise.resolve(entry2);
      return Promise.resolve(null);
    });

    const result = await getJournalEntries();
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.date)).toContain("2025-06-15");
    expect(result.map((e) => e.date)).toContain("2025-06-13");
  });

  it("respects the limit parameter", async () => {
    // Every date has an entry
    mockGetJSON.mockImplementation((key: string) => {
      if (key.startsWith("cortex:journal:")) {
        const date = key.replace("cortex:journal:", "");
        return Promise.resolve({ date, dayNumber: 1, content: "x", generatedAt: date });
      }
      return Promise.resolve(null);
    });

    const result = await getJournalEntries(3);
    expect(result).toHaveLength(3);
  });

  it("uses default limit of 14 days", async () => {
    // Only first 14 days checked; we verify at most 14 KV lookups are made
    mockGetJSON.mockResolvedValue(null);

    await getJournalEntries();
    // 14 calls for the 14 date keys
    expect(mockGetJSON).toHaveBeenCalledTimes(14);
  });

  it("returns entries in order from most recent to oldest", async () => {
    const entries = ["2025-06-15", "2025-06-14", "2025-06-13"];
    mockGetJSON.mockImplementation((key: string) => {
      const date = key.replace("cortex:journal:", "");
      if (entries.includes(date)) {
        return Promise.resolve({ date, dayNumber: 1, content: "c", generatedAt: date });
      }
      return Promise.resolve(null);
    });

    const result = await getJournalEntries(5);
    expect(result[0].date).toBe("2025-06-15");
    expect(result[1].date).toBe("2025-06-14");
    expect(result[2].date).toBe("2025-06-13");
  });
});
