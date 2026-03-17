import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/indexer", () => ({
  queryIndex: vi.fn(),
}));

import { findResonances, type Resonance } from "@/lib/resonance";
import { queryIndex } from "@/lib/indexer";
import type { BriefingStory } from "@/lib/briefing";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStory(overrides: Partial<BriefingStory> = {}): BriefingStory {
  return {
    title: overrides.title ?? "Test Story Title",
    url: overrides.url ?? "https://example.com/story",
    snippet: overrides.snippet ?? "This is a story snippet.",
    source: overrides.source ?? "Example News",
    ...overrides,
  };
}

function makeIndexResult(overrides: {
  name?: string;
  path?: string;
  score?: number;
  text?: string;
} = {}) {
  return {
    text: overrides.text ?? "some note text",
    name: overrides.name ?? "Note Name",
    path: overrides.path ?? "notes/note.md",
    score: overrides.score ?? 0.85,
  };
}

// ---------------------------------------------------------------------------
// findResonances
// ---------------------------------------------------------------------------

describe("findResonances", () => {
  it("returns an empty map for an empty stories array", async () => {
    const result = await findResonances([]);
    expect(result.size).toBe(0);
    expect(queryIndex).not.toHaveBeenCalled();
  });

  it("queries the index using title + snippet for each story", async () => {
    vi.mocked(queryIndex).mockResolvedValueOnce([]);
    const story = makeStory({ title: "AI News", snippet: "LLMs are improving." });

    await findResonances([story]);

    expect(queryIndex).toHaveBeenCalledWith("AI News LLMs are improving.", 3);
  });

  it("includes stories with results scoring above 0.7", async () => {
    vi.mocked(queryIndex).mockResolvedValueOnce([
      makeIndexResult({ name: "Deep Learning", path: "notes/dl.md", score: 0.85 }),
      makeIndexResult({ name: "Transformers", path: "notes/transformers.md", score: 0.72 }),
    ]);

    const result = await findResonances([makeStory()]);

    expect(result.size).toBe(1);
    const resonances = result.get(0)!;
    expect(resonances).toHaveLength(2);
    expect(resonances[0]).toEqual<Resonance>({
      noteName: "Deep Learning",
      notePath: "notes/dl.md",
      score: 0.85,
    });
    expect(resonances[1]).toEqual<Resonance>({
      noteName: "Transformers",
      notePath: "notes/transformers.md",
      score: 0.72,
    });
  });

  it("filters out results with score at or below 0.7", async () => {
    vi.mocked(queryIndex).mockResolvedValueOnce([
      makeIndexResult({ score: 0.7 }),  // exactly 0.7 — NOT included (> required)
      makeIndexResult({ score: 0.69 }), // below threshold
      makeIndexResult({ score: 0.5 }),  // well below threshold
    ]);

    const result = await findResonances([makeStory()]);

    expect(result.size).toBe(0);
  });

  it("does not add an entry to the map when all results are below threshold", async () => {
    vi.mocked(queryIndex).mockResolvedValueOnce([
      makeIndexResult({ score: 0.65 }),
    ]);

    const result = await findResonances([makeStory()]);

    expect(result.has(0)).toBe(false);
  });

  it("deduplicates results by notePath, keeping the first occurrence", async () => {
    vi.mocked(queryIndex).mockResolvedValueOnce([
      makeIndexResult({ name: "Note A", path: "notes/a.md", score: 0.95 }),
      makeIndexResult({ name: "Note A chunk 2", path: "notes/a.md", score: 0.88 }), // same path
      makeIndexResult({ name: "Note B", path: "notes/b.md", score: 0.80 }),
    ]);

    const result = await findResonances([makeStory()]);
    const resonances = result.get(0)!;

    expect(resonances).toHaveLength(2);
    expect(resonances[0].notePath).toBe("notes/a.md");
    expect(resonances[0].noteName).toBe("Note A"); // first one kept
    expect(resonances[1].notePath).toBe("notes/b.md");
  });

  it("stores results at the correct story index in the map", async () => {
    vi.mocked(queryIndex)
      .mockResolvedValueOnce([]) // story 0 — no matches
      .mockResolvedValueOnce([makeIndexResult({ score: 0.9 })]) // story 1 — match
      .mockResolvedValueOnce([makeIndexResult({ score: 0.8 })]); // story 2 — match

    const stories = [makeStory({ title: "Zero" }), makeStory({ title: "One" }), makeStory({ title: "Two" })];
    const result = await findResonances(stories);

    expect(result.has(0)).toBe(false);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
  });

  it("catches errors thrown by queryIndex and skips that story without throwing", async () => {
    vi.mocked(queryIndex)
      .mockRejectedValueOnce(new Error("Index not built yet"))
      .mockResolvedValueOnce([makeIndexResult({ score: 0.9 })]);

    const stories = [makeStory({ title: "Error Story" }), makeStory({ title: "Good Story" })];
    const result = await findResonances(stories);

    // Story 0 errored — should be skipped
    expect(result.has(0)).toBe(false);
    // Story 1 succeeded
    expect(result.has(1)).toBe(true);
    expect(result.get(1)).toHaveLength(1);
  });

  it("returns an empty map when all stories throw errors", async () => {
    vi.mocked(queryIndex).mockRejectedValue(new Error("Offline"));

    const result = await findResonances([makeStory(), makeStory()]);

    expect(result.size).toBe(0);
  });

  it("handles a story with all three results from the top-3 query being unique and above threshold", async () => {
    vi.mocked(queryIndex).mockResolvedValueOnce([
      makeIndexResult({ path: "a.md", score: 0.99 }),
      makeIndexResult({ path: "b.md", score: 0.88 }),
      makeIndexResult({ path: "c.md", score: 0.75 }),
    ]);

    const result = await findResonances([makeStory()]);
    expect(result.get(0)).toHaveLength(3);
  });

  it("processes multiple stories independently", async () => {
    vi.mocked(queryIndex)
      .mockResolvedValueOnce([makeIndexResult({ path: "a.md", score: 0.9 })])
      .mockResolvedValueOnce([makeIndexResult({ path: "b.md", score: 0.8 })]);

    const stories = [makeStory({ title: "Story One" }), makeStory({ title: "Story Two" })];
    const result = await findResonances(stories);

    expect(queryIndex).toHaveBeenCalledTimes(2);
    expect(queryIndex).toHaveBeenNthCalledWith(1, "Story One This is a story snippet.", 3);
    expect(queryIndex).toHaveBeenNthCalledWith(2, "Story Two This is a story snippet.", 3);
    expect(result.size).toBe(2);
  });
});
