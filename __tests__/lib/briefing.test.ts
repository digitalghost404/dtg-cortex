import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TOPICS,
  getBriefing,
  saveBriefing,
  listBriefingDates,
  getLatestBriefing,
  pruneBriefings,
  type Briefing,
} from "@/lib/briefing";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
  zadd: vi.fn(),
  zrange: vi.fn(),
  zrem: vi.fn(),
  deleteKey: vi.fn(),
}));

import * as kv from "@/lib/kv";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBriefing(date: string): Briefing {
  return {
    date,
    generatedAt: new Date(date).toISOString(),
    sections: [],
    summary: "Test summary",
  };
}

// ---------------------------------------------------------------------------
// TOPICS constant
// ---------------------------------------------------------------------------

describe("TOPICS", () => {
  it("has exactly 4 entries", () => {
    expect(TOPICS).toHaveLength(4);
  });

  it("contains the expected topic ids", () => {
    const ids = TOPICS.map((t) => t.id);
    expect(ids).toContain("ai-ml");
    expect(ids).toContain("tech");
    expect(ids).toContain("cloud-devops");
    expect(ids).toContain("science-space");
  });

  it("every topic has id, label, and query", () => {
    for (const topic of TOPICS) {
      expect(topic.id).toBeTruthy();
      expect(topic.label).toBeTruthy();
      expect(topic.query).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// getBriefing
// ---------------------------------------------------------------------------

describe("getBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getJSON with the correct key and returns data", async () => {
    const briefing = makeBriefing("2026-03-17");
    vi.mocked(kv.getJSON).mockResolvedValueOnce(briefing);

    const result = await getBriefing("2026-03-17");

    expect(kv.getJSON).toHaveBeenCalledWith("briefing:2026-03-17");
    expect(result).toEqual(briefing);
  });

  it("returns null when getJSON resolves null", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);

    const result = await getBriefing("2026-03-17");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveBriefing
// ---------------------------------------------------------------------------

describe("saveBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls setJSON with briefing key and data", async () => {
    vi.mocked(kv.setJSON).mockResolvedValueOnce(undefined);
    vi.mocked(kv.zadd).mockResolvedValueOnce(undefined);

    const briefing = makeBriefing("2026-03-17");
    await saveBriefing(briefing);

    expect(kv.setJSON).toHaveBeenCalledWith("briefing:2026-03-17", briefing);
  });

  it("calls zadd with DATES_KEY, timestamp score, and date member", async () => {
    vi.mocked(kv.setJSON).mockResolvedValueOnce(undefined);
    vi.mocked(kv.zadd).mockResolvedValueOnce(undefined);

    const briefing = makeBriefing("2026-03-17");
    await saveBriefing(briefing);

    const expectedScore = new Date("2026-03-17").getTime();
    expect(kv.zadd).toHaveBeenCalledWith("briefing:dates", expectedScore, "2026-03-17");
  });
});

// ---------------------------------------------------------------------------
// listBriefingDates
// ---------------------------------------------------------------------------

describe("listBriefingDates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dates in reverse order (newest first)", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce([
      "2026-03-15",
      "2026-03-16",
      "2026-03-17",
    ]);

    const result = await listBriefingDates();

    expect(kv.zrange).toHaveBeenCalledWith("briefing:dates", 0, -1);
    expect(result).toEqual(["2026-03-17", "2026-03-16", "2026-03-15"]);
  });

  it("returns empty array when no dates stored", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce([]);

    const result = await listBriefingDates();

    expect(result).toEqual([]);
  });

  it("returns single-element array unchanged after reverse", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce(["2026-03-17"]);

    const result = await listBriefingDates();

    expect(result).toEqual(["2026-03-17"]);
  });
});

// ---------------------------------------------------------------------------
// getLatestBriefing
// ---------------------------------------------------------------------------

describe("getLatestBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there are no dates", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce([]);

    const result = await getLatestBriefing();

    expect(result).toBeNull();
  });

  it("fetches the most recent (first after reverse) briefing", async () => {
    const briefing = makeBriefing("2026-03-17");
    vi.mocked(kv.zrange).mockResolvedValueOnce([
      "2026-03-15",
      "2026-03-16",
      "2026-03-17",
    ]);
    vi.mocked(kv.getJSON).mockResolvedValueOnce(briefing);

    const result = await getLatestBriefing();

    expect(kv.getJSON).toHaveBeenCalledWith("briefing:2026-03-17");
    expect(result).toEqual(briefing);
  });

  it("returns null when the latest date has no stored briefing", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce(["2026-03-17"]);
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);

    const result = await getLatestBriefing();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pruneBriefings
// ---------------------------------------------------------------------------

describe("pruneBriefings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes entries older than the keepDays cutoff", async () => {
    // Freeze time so cutoff is deterministic
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    // old date: 40 days ago
    const oldDate = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // recent date: today
    const recentDate = new Date(now).toISOString().slice(0, 10);

    vi.mocked(kv.zrange).mockResolvedValueOnce([oldDate, recentDate]);
    vi.mocked(kv.deleteKey).mockResolvedValue(undefined);
    vi.mocked(kv.zrem).mockResolvedValue(undefined);

    await pruneBriefings(30);

    expect(kv.deleteKey).toHaveBeenCalledTimes(1);
    expect(kv.deleteKey).toHaveBeenCalledWith(`briefing:${oldDate}`);
    expect(kv.zrem).toHaveBeenCalledTimes(1);
    expect(kv.zrem).toHaveBeenCalledWith("briefing:dates", oldDate);

    vi.restoreAllMocks();
  });

  it("does not delete entries newer than the cutoff", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const recentDate = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    vi.mocked(kv.zrange).mockResolvedValueOnce([recentDate]);
    vi.mocked(kv.deleteKey).mockResolvedValue(undefined);
    vi.mocked(kv.zrem).mockResolvedValue(undefined);

    await pruneBriefings(30);

    expect(kv.deleteKey).not.toHaveBeenCalled();
    expect(kv.zrem).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("uses default keepDays=30 when no argument provided", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const oldDate = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    vi.mocked(kv.zrange).mockResolvedValueOnce([oldDate]);
    vi.mocked(kv.deleteKey).mockResolvedValue(undefined);
    vi.mocked(kv.zrem).mockResolvedValue(undefined);

    await pruneBriefings();

    expect(kv.deleteKey).toHaveBeenCalledWith(`briefing:${oldDate}`);

    vi.restoreAllMocks();
  });

  it("handles empty dates list without calling deleteKey or zrem", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce([]);

    await pruneBriefings(30);

    expect(kv.deleteKey).not.toHaveBeenCalled();
    expect(kv.zrem).not.toHaveBeenCalled();
  });

  it("deletes multiple old entries when multiple are below the cutoff", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const old1 = new Date(now - 35 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const old2 = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    vi.mocked(kv.zrange).mockResolvedValueOnce([old1, old2]);
    vi.mocked(kv.deleteKey).mockResolvedValue(undefined);
    vi.mocked(kv.zrem).mockResolvedValue(undefined);

    await pruneBriefings(30);

    expect(kv.deleteKey).toHaveBeenCalledTimes(2);
    expect(kv.zrem).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });
});
