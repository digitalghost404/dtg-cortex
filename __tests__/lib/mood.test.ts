import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/vault", () => ({
  getVaultMeta: vi.fn(),
}));
vi.mock("@/lib/lineage", () => ({
  getLineageStats: vi.fn(),
}));
vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

import { computeMood, detectMoodTransition, getMoodHistory } from "@/lib/mood";
import { getVaultMeta } from "@/lib/vault";
import { getLineageStats } from "@/lib/lineage";
import { getJSON, setJSON } from "@/lib/kv";

const mockVaultMeta = getVaultMeta as ReturnType<typeof vi.fn>;
const mockLineageStats = getLineageStats as ReturnType<typeof vi.fn>;
const mockGetJSON = getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = setJSON as ReturnType<typeof vi.fn>;

function makeLineageStats(overrides: {
  recentEntries?: Array<{
    timestamp: string;
    sourceNotes: Array<{ name: string }>;
  }>;
  queriesPerDay?: Array<{ date: string; count: number }>;
} = {}) {
  return {
    totalQueries: 0,
    uniqueNotesReferenced: 0,
    mostReferencedNotes: [],
    recentEntries: overrides.recentEntries ?? [],
    noteTimeline: [],
    queriesPerDay: overrides.queriesPerDay ?? [],
  };
}

describe("computeMood", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    mockVaultMeta.mockResolvedValue({ totalNotes: 50 });
    mockGetJSON.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns DORMANT when last visit was over 24h ago", async () => {
    const twoDaysAgo = new Date("2025-06-13T12:00:00Z").toISOString();
    mockGetJSON.mockResolvedValue(twoDaysAgo);
    mockLineageStats.mockResolvedValue(makeLineageStats());

    const result = await computeMood();
    expect(result.mood).toBe("DORMANT");
  });

  it("DORMANT intensity scales with hours since visit (capped at 1)", async () => {
    const threeDaysAgo = new Date("2025-06-12T12:00:00Z").toISOString();
    mockGetJSON.mockResolvedValue(threeDaysAgo);
    mockLineageStats.mockResolvedValue(makeLineageStats());

    const result = await computeMood();
    expect(result.mood).toBe("DORMANT");
    // 72 hours ago => intensity = min(1, 72/72) = 1
    expect(result.intensity).toBe(1);
  });

  it("returns FOCUSED when top 2 topics account for >60% of references", async () => {
    const now = new Date("2025-06-15T12:00:00Z");
    const recent = new Date("2025-06-15T10:00:00Z").toISOString();
    mockGetJSON.mockResolvedValue(now.toISOString()); // lastVisit = now (not dormant)

    // 5 entries, all referencing the same 2 notes
    const entries = Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 3_600_000).toISOString(),
      sourceNotes: [{ name: "note-a" }, { name: "note-b" }],
    }));

    mockLineageStats.mockResolvedValue(makeLineageStats({ recentEntries: entries }));

    const result = await computeMood();
    expect(result.mood).toBe("FOCUSED");
  });

  it("returns RESTLESS when many queries but few unique notes referenced", async () => {
    const now = new Date("2025-06-15T12:00:00Z");
    mockGetJSON.mockResolvedValue(now.toISOString());

    // RESTLESS needs: recentQueryCount > 5 AND topicCounts.size < 3
    // FOCUSED checks first: recentQueryCount >= 3 AND topTwoShare > 0.6
    // With empty sourceNotes, topTwoShare = 0, so FOCUSED won't trigger
    const entries = Array.from({ length: 8 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 600_000).toISOString(),
      sourceNotes: [] as Array<{ name: string }>,
    }));

    mockLineageStats.mockResolvedValue(makeLineageStats({ recentEntries: entries }));

    const result = await computeMood();
    expect(result.mood).toBe("RESTLESS");
  });

  it("RESTLESS intensity scales with query count", async () => {
    const now = new Date("2025-06-15T12:00:00Z");
    mockGetJSON.mockResolvedValue(now.toISOString());

    const entries = Array.from({ length: 15 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 600_000).toISOString(),
      sourceNotes: [] as Array<{ name: string }>,
    }));

    mockLineageStats.mockResolvedValue(makeLineageStats({ recentEntries: entries }));

    const result = await computeMood();
    expect(result.mood).toBe("RESTLESS");
    expect(result.intensity).toBe(1); // 15/15 = 1
  });

  it("returns ABSORBING when many queries spread across many topics", async () => {
    const now = new Date("2025-06-15T12:00:00Z");
    mockGetJSON.mockResolvedValue(now.toISOString());

    // 6 queries each referencing a different note
    const entries = Array.from({ length: 6 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 600_000).toISOString(),
      sourceNotes: [{ name: `note-${i}` }],
    }));

    mockLineageStats.mockResolvedValue(makeLineageStats({ recentEntries: entries }));

    const result = await computeMood();
    expect(result.mood).toBe("ABSORBING");
  });

  it("returns CONTEMPLATIVE as the default (low activity)", async () => {
    const now = new Date("2025-06-15T12:00:00Z");
    mockGetJSON.mockResolvedValue(now.toISOString());

    // 1 query (not enough to trigger any other mood)
    const entries = [
      {
        timestamp: new Date(now.getTime() - 3_600_000).toISOString(),
        sourceNotes: [{ name: "note-a" }],
      },
    ];

    mockLineageStats.mockResolvedValue(makeLineageStats({ recentEntries: entries }));

    const result = await computeMood();
    expect(result.mood).toBe("CONTEMPLATIVE");
  });

  it("includes queriesPerDay in weekly query count calculation", async () => {
    // Exercises the reduce callback on queriesPerDay (line 68): s + d.count
    const now = new Date("2025-06-15T12:00:00Z");
    mockGetJSON.mockResolvedValue(now.toISOString());

    const recentDays = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10),
      count: 3,
    }));

    mockLineageStats.mockResolvedValue(
      makeLineageStats({ queriesPerDay: recentDays })
    );

    // weeklyQueries = 7 × 3 = 21, but the mood is still determined by recentEntries
    const result = await computeMood();
    // No entries → CONTEMPLATIVE (hoursSinceVisit is NOT > 24 since lastVisit = now)
    expect(result.mood).toBe("CONTEMPLATIVE");
  });

  it("CONTEMPLATIVE intensity decreases with more queries", async () => {
    const now = new Date("2025-06-15T12:00:00Z");
    mockGetJSON.mockResolvedValue(now.toISOString());

    const entries = Array.from({ length: 3 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 3_600_000).toISOString(),
      sourceNotes: [{ name: `note-${i}` }, { name: `note-${i + 10}` }],
    }));

    mockLineageStats.mockResolvedValue(makeLineageStats({ recentEntries: entries }));

    const result = await computeMood();
    expect(result.mood).toBe("CONTEMPLATIVE");
    // intensity = max(0.3, 1 - 3/10) = 0.7
    expect(result.intensity).toBeCloseTo(0.7, 1);
  });

  it("handles null vault meta gracefully", async () => {
    mockVaultMeta.mockResolvedValue(null);
    mockGetJSON.mockResolvedValue(null);
    mockLineageStats.mockResolvedValue(makeLineageStats());

    const result = await computeMood();
    // No lastVisit => hoursSinceVisit = Infinity => DORMANT
    expect(result.mood).toBe("DORMANT");
  });

  it("intensity is always between 0 and 1", async () => {
    const now = new Date("2025-06-15T12:00:00Z");
    mockGetJSON.mockResolvedValue(now.toISOString());

    const entries = Array.from({ length: 20 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 60_000).toISOString(),
      sourceNotes: [{ name: `note-${i}` }],
    }));

    mockLineageStats.mockResolvedValue(makeLineageStats({ recentEntries: entries }));

    const result = await computeMood();
    expect(result.intensity).toBeGreaterThanOrEqual(0);
    expect(result.intensity).toBeLessThanOrEqual(1);
  });
});

describe("detectMoodTransition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    vi.clearAllMocks();
    mockSetJSON.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no previous mood exists (first call)", async () => {
    // getJSON for MOOD_PREVIOUS_KEY returns null; getJSON for history returns null
    mockGetJSON.mockResolvedValue(null);

    const result = await detectMoodTransition({ mood: "CONTEMPLATIVE", intensity: 0.7 });
    expect(result).toBeNull();
  });

  it("returns null when previous mood equals current mood (no transition)", async () => {
    mockGetJSON
      .mockResolvedValueOnce("FOCUSED")  // MOOD_PREVIOUS_KEY
      .mockResolvedValueOnce([]);         // history key

    const result = await detectMoodTransition({ mood: "FOCUSED", intensity: 0.8 });
    expect(result).toBeNull();
  });

  it("returns a transition object when mood changes", async () => {
    mockGetJSON
      .mockResolvedValueOnce("CONTEMPLATIVE") // MOOD_PREVIOUS_KEY
      .mockResolvedValueOnce([]);              // history key

    const result = await detectMoodTransition({ mood: "FOCUSED", intensity: 0.9 });
    expect(result).not.toBeNull();
    expect(result!.transitioned).toBe(true);
    expect(result!.from).toBe("CONTEMPLATIVE");
    expect(result!.to).toBe("FOCUSED");
  });

  it("saves current mood to MOOD_PREVIOUS_KEY and appends to history", async () => {
    mockGetJSON
      .mockResolvedValueOnce(null)  // MOOD_PREVIOUS_KEY
      .mockResolvedValueOnce([]);   // history key

    await detectMoodTransition({ mood: "RESTLESS", intensity: 0.6 });

    expect(mockSetJSON).toHaveBeenCalledWith("cortex:mood:previous", "RESTLESS");
    expect(mockSetJSON).toHaveBeenCalledWith(
      expect.stringMatching(/^cortex:mood:history:/),
      expect.arrayContaining([
        expect.objectContaining({ mood: "RESTLESS", intensity: 0.6 }),
      ])
    );
  });

  it("appends to existing history array rather than replacing it", async () => {
    const existingHistory = [
      { mood: "DORMANT", intensity: 1, timestamp: "2025-06-15T08:00:00Z" },
    ];
    mockGetJSON
      .mockResolvedValueOnce("DORMANT") // MOOD_PREVIOUS_KEY
      .mockResolvedValueOnce(existingHistory); // history key

    await detectMoodTransition({ mood: "CONTEMPLATIVE", intensity: 0.5 });

    const savedHistory = mockSetJSON.mock.calls.find(
      ([key]: [string]) => key.startsWith("cortex:mood:history:")
    )?.[1] as Array<{ mood: string }>;
    expect(savedHistory).toHaveLength(2);
    expect(savedHistory[0].mood).toBe("DORMANT");
    expect(savedHistory[1].mood).toBe("CONTEMPLATIVE");
  });

  // inferTransitionReason branches
  it("reason: RESTLESS target → 'query rate spiking'", async () => {
    mockGetJSON
      .mockResolvedValueOnce("CONTEMPLATIVE")
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "RESTLESS", intensity: 0.8 });
    expect(result!.reason).toBe("query rate spiking");
  });

  it("reason: FOCUSED target → 'topic concentration increasing'", async () => {
    mockGetJSON
      .mockResolvedValueOnce("RESTLESS")
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "FOCUSED", intensity: 0.9 });
    expect(result!.reason).toBe("topic concentration increasing");
  });

  it("reason: DORMANT target → 'activity ceased'", async () => {
    mockGetJSON
      .mockResolvedValueOnce("FOCUSED")
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "DORMANT", intensity: 1 });
    expect(result!.reason).toBe("activity ceased");
  });

  it("reason: ABSORBING target → 'intake volume rising'", async () => {
    mockGetJSON
      .mockResolvedValueOnce("CONTEMPLATIVE")
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "ABSORBING", intensity: 0.7 });
    expect(result!.reason).toBe("intake volume rising");
  });

  it("reason: CONTEMPLATIVE from RESTLESS → 'search patterns settling'", async () => {
    mockGetJSON
      .mockResolvedValueOnce("RESTLESS")
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "CONTEMPLATIVE", intensity: 0.5 });
    expect(result!.reason).toBe("search patterns settling");
  });

  it("reason: CONTEMPLATIVE from FOCUSED → 'attention broadening'", async () => {
    mockGetJSON
      .mockResolvedValueOnce("FOCUSED")
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "CONTEMPLATIVE", intensity: 0.5 });
    expect(result!.reason).toBe("attention broadening");
  });

  it("reason: CONTEMPLATIVE from ABSORBING → 'activity winding down'", async () => {
    mockGetJSON
      .mockResolvedValueOnce("ABSORBING")
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "CONTEMPLATIVE", intensity: 0.4 });
    expect(result!.reason).toBe("activity winding down");
  });

  it("reason: CONTEMPLATIVE from DORMANT → 'activity winding down'", async () => {
    mockGetJSON
      .mockResolvedValueOnce("DORMANT")
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "CONTEMPLATIVE", intensity: 0.4 });
    expect(result!.reason).toBe("activity winding down");
  });

  it("reason: unknown mood combination → 'internal state shift'", async () => {
    // This exercises the fallthrough return in inferTransitionReason.
    // All known CortexMood values are covered above; use a cast to reach the dead branch.
    mockGetJSON
      .mockResolvedValueOnce("UNKNOWN_PREV" as never)
      .mockResolvedValueOnce([]);

    const result = await detectMoodTransition({ mood: "UNKNOWN_CURR" as never, intensity: 0.5 });
    expect(result!.reason).toBe("internal state shift");
  });
});

describe("getMoodHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    vi.clearAllMocks();
    mockSetJSON.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty array when no history exists for today", async () => {
    mockGetJSON.mockResolvedValue(null);

    const result = await getMoodHistory();
    expect(result).toEqual([]);
  });

  it("returns stored history entries for today when no date passed", async () => {
    const history = [
      { mood: "CONTEMPLATIVE", intensity: 0.7, timestamp: "2025-06-15T08:00:00Z" },
      { mood: "FOCUSED", intensity: 0.9, timestamp: "2025-06-15T10:00:00Z" },
    ];
    mockGetJSON.mockResolvedValue(history);

    const result = await getMoodHistory();
    expect(result).toHaveLength(2);
    expect(result[0].mood).toBe("CONTEMPLATIVE");
    expect(result[1].mood).toBe("FOCUSED");
  });

  it("returns empty array when no history exists for a specific date", async () => {
    mockGetJSON.mockResolvedValue(null);

    const result = await getMoodHistory(new Date("2025-06-10"));
    expect(result).toEqual([]);
  });

  it("returns stored history for a specific date", async () => {
    const history = [
      { mood: "DORMANT", intensity: 1, timestamp: "2025-06-10T06:00:00Z" },
    ];
    mockGetJSON.mockImplementation((key: string) => {
      if (key === "cortex:mood:history:2025-06-10") return Promise.resolve(history);
      return Promise.resolve(null);
    });

    const result = await getMoodHistory(new Date("2025-06-10T00:00:00Z"));
    expect(result).toHaveLength(1);
    expect(result[0].mood).toBe("DORMANT");
  });

  it("queries the correct KV key for the given date", async () => {
    mockGetJSON.mockResolvedValue(null);

    await getMoodHistory(new Date("2025-01-20"));
    expect(mockGetJSON).toHaveBeenCalledWith("cortex:mood:history:2025-01-20");
  });
});
