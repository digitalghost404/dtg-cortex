import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — must be hoisted before any imports of the module under test
// ---------------------------------------------------------------------------

// vi.hoisted() runs before module evaluation so the variable is available
// inside the vi.mock() factory, which is hoisted to the top of the file.
const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => ({ search: mockSearch })),
}));

import { webSearch, type WebSearchResult } from "@/lib/websearch";
import { tavily } from "@tavily/core";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTavilyResult(overrides: Partial<{
  title: string;
  url: string;
  content: string;
  score: number;
}> = {}) {
  return {
    title: overrides.title ?? "Test Title",
    url: overrides.url ?? "https://example.com",
    content: overrides.content ?? "Some content",
    score: overrides.score ?? 0.9,
    // Extra fields that the real Tavily SDK returns but we discard
    publishedDate: "2026-03-17",
    rawContent: null,
  };
}

// ---------------------------------------------------------------------------
// Module initialisation — tavily() called at module load time
// ---------------------------------------------------------------------------

describe("module initialisation", () => {
  it("tavily factory returns a client with a search method that webSearch calls", async () => {
    // The module-level client was created via tavily() at load time.
    // Verify that webSearch routes calls through the mock client.
    mockSearch.mockResolvedValueOnce({ results: [] });
    await webSearch("probe query");
    expect(mockSearch).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// webSearch
// ---------------------------------------------------------------------------

describe("webSearch", () => {
  it("returns mapped results from the Tavily client", async () => {
    const raw = [
      makeTavilyResult({ title: "Article A", url: "https://a.com", content: "Content A", score: 0.95 }),
      makeTavilyResult({ title: "Article B", url: "https://b.com", content: "Content B", score: 0.82 }),
    ];
    mockSearch.mockResolvedValueOnce({ results: raw });

    const results = await webSearch("test query");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual<WebSearchResult>({
      title: "Article A",
      url: "https://a.com",
      content: "Content A",
      score: 0.95,
    });
    expect(results[1]).toEqual<WebSearchResult>({
      title: "Article B",
      url: "https://b.com",
      content: "Content B",
      score: 0.82,
    });
  });

  it("uses default maxResults of 5 when not specified", async () => {
    mockSearch.mockResolvedValueOnce({ results: [] });

    await webSearch("my query");

    expect(mockSearch).toHaveBeenCalledWith("my query", {
      maxResults: 5,
      searchDepth: "basic",
      includeAnswer: false,
    });
  });

  it("passes a custom maxResults to the client", async () => {
    mockSearch.mockResolvedValueOnce({ results: [] });

    await webSearch("another query", 10);

    expect(mockSearch).toHaveBeenCalledWith("another query", {
      maxResults: 10,
      searchDepth: "basic",
      includeAnswer: false,
    });
  });

  it("returns an empty array when Tavily returns no results", async () => {
    mockSearch.mockResolvedValueOnce({ results: [] });

    const results = await webSearch("empty results query");

    expect(results).toEqual([]);
  });

  it("maps only the four required fields, discarding extra Tavily fields", async () => {
    const raw = [makeTavilyResult({ title: "Only fields", url: "https://x.com", content: "ctx", score: 0.7 })];
    mockSearch.mockResolvedValueOnce({ results: raw });

    const results = await webSearch("fields query");

    expect(Object.keys(results[0])).toEqual(["title", "url", "content", "score"]);
  });

  it("propagates errors thrown by the Tavily client", async () => {
    mockSearch.mockRejectedValueOnce(new Error("Network failure"));

    await expect(webSearch("bad query")).rejects.toThrow("Network failure");
  });

  it("handles a single result correctly", async () => {
    const raw = [makeTavilyResult({ title: "Single", score: 0.6 })];
    mockSearch.mockResolvedValueOnce({ results: raw });

    const results = await webSearch("single result");

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Single");
    expect(results[0].score).toBe(0.6);
  });
});
