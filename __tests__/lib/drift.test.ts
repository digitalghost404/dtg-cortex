import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/lineage", () => ({
  loadLineage: vi.fn(),
}));

import { detectDrift } from "@/lib/drift";
import { loadLineage } from "@/lib/lineage";

const mockLoadLineage = loadLineage as ReturnType<typeof vi.fn>;

describe("detectDrift", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const NOW = new Date("2025-06-15T12:00:00Z").getTime();

  function entry(query: string, daysAgo: number) {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date(NOW - daysAgo * 86_400_000).toISOString(),
      sessionId: "s1",
      query,
      sourceNotes: [],
    };
  }

  it("returns empty arrays for an empty lineage", async () => {
    mockLoadLineage.mockResolvedValue({ entries: [] });

    const result = await detectDrift();
    expect(result.emerging).toEqual([]);
    expect(result.fading).toEqual([]);
    expect(result.stable).toEqual([]);
  });

  it("detects emerging topics (new in recent window)", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        entry("tell me about kubernetes deployments", 1),
        entry("kubernetes scaling patterns", 2),
        // No kubernetes mentions in baseline (8-30 days)
        entry("react component patterns", 15),
      ],
    });

    const result = await detectDrift();
    expect(result.emerging).toContain("kubernetes");
  });

  it("detects fading topics (disappeared from recent)", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        // Nothing about docker in recent (0-7 days)
        entry("something else entirely here", 1),
        // Docker was popular in baseline
        entry("docker container networking", 15),
        entry("docker compose configuration", 20),
      ],
    });

    const result = await detectDrift();
    expect(result.fading).toContain("docker");
  });

  it("detects stable topics (similar frequency in both windows)", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        // Recent: 1 mention
        entry("typescript generics patterns", 2),
        // Baseline: 1 mention
        entry("typescript advanced types", 15),
      ],
    });

    const result = await detectDrift();
    expect(result.stable).toContain("typescript");
  });

  it("filters stop words from keyword extraction", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        entry("the and or but not", 1),
        entry("the and or but not", 2),
      ],
    });

    const result = await detectDrift();
    // All stop words, nothing should emerge
    expect(result.emerging).toEqual([]);
  });

  it("filters words shorter than 3 characters", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        entry("go is an ok language", 1),
        entry("go is an ok language", 2),
      ],
    });

    const result = await detectDrift();
    // "go", "is", "an", "ok" are all <=2 chars or stop words
    expect(result.emerging).not.toContain("go");
    expect(result.emerging).not.toContain("is");
  });

  it("caps results at 5 per category", async () => {
    // Create 10 unique keywords appearing twice in recent only
    const recentEntries = [];
    for (let i = 0; i < 10; i++) {
      recentEntries.push(entry(`uniquetopic${i} analysis`, 1));
      recentEntries.push(entry(`uniquetopic${i} research`, 2));
    }

    mockLoadLineage.mockResolvedValue({ entries: recentEntries });

    const result = await detectDrift();
    expect(result.emerging.length).toBeLessThanOrEqual(5);
  });

  it("ignores entries older than 30 days", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        entry("ancient history topic", 45),
        entry("ancient history topic", 50),
      ],
    });

    const result = await detectDrift();
    expect(result.emerging).toEqual([]);
    expect(result.fading).toEqual([]);
    expect(result.stable).toEqual([]);
  });

  it("emerging requires count >= 2 for new topics", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        // Only 1 mention of "quantum" in recent — not enough
        entry("quantum computing basics", 1),
      ],
    });

    const result = await detectDrift();
    expect(result.emerging).not.toContain("quantum");
  });

  it("detects significant increase as emerging (>2x baseline)", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        // Recent: 3 mentions
        entry("machine learning models", 1),
        entry("machine learning training", 2),
        entry("machine learning inference", 3),
        // Baseline: 1 mention
        entry("machine learning overview", 15),
      ],
    });

    const result = await detectDrift();
    expect(result.emerging).toContain("machine");
    expect(result.emerging).toContain("learning");
  });

  it("detects significant decrease as fading (baseline >2x recent)", async () => {
    mockLoadLineage.mockResolvedValue({
      entries: [
        // Recent: 1 mention
        entry("graphql query basics", 2),
        // Baseline: 3 mentions
        entry("graphql schema design", 10),
        entry("graphql resolvers", 15),
        entry("graphql mutations", 20),
      ],
    });

    const result = await detectDrift();
    expect(result.fading).toContain("graphql");
  });
});
