import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateBriefing } from "@/lib/briefing-generator";

vi.mock("@/lib/websearch", () => ({
  webSearch: vi.fn(),
}));

vi.mock("@/lib/briefing", () => ({
  TOPICS: [
    { id: "ai-ml", label: "AI & Machine Learning", query: "AI ml news" },
    { id: "tech", label: "Tech Industry", query: "tech news" },
    { id: "cloud-devops", label: "Cloud & DevOps", query: "cloud news" },
    { id: "science-space", label: "Science & Space", query: "science news" },
  ],
  getBriefing: vi.fn(),
  saveBriefing: vi.fn(),
  pruneBriefings: vi.fn(),
}));

vi.mock("@/lib/resonance", () => ({
  findResonances: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-haiku-model"),
}));

import { webSearch } from "@/lib/websearch";
import { getBriefing, saveBriefing, pruneBriefings, TOPICS } from "@/lib/briefing";
import { findResonances } from "@/lib/resonance";
import { generateObject } from "ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearchResult(title: string, url: string, content: string) {
  return { title, url, content, score: 0.9 };
}

function makeHaikuOutput() {
  return {
    object: {
      sections: [
        { topicId: "ai-ml", analysis: "AI analysis text." },
        { topicId: "tech", analysis: "Tech analysis text." },
        { topicId: "cloud-devops", analysis: "Cloud analysis text." },
        { topicId: "science-space", analysis: "Science analysis text." },
      ],
      summary: "Overall summary across all topics.",
    },
  };
}

// ---------------------------------------------------------------------------
// generateBriefing
// ---------------------------------------------------------------------------

describe("generateBriefing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("existing briefing", () => {
    it("returns the existing briefing without searching or calling Haiku", async () => {
      const existingBriefing = {
        date: "2026-03-17",
        generatedAt: "2026-03-17T08:00:00.000Z",
        sections: [],
        summary: "Previously generated summary.",
      };
      vi.mocked(getBriefing).mockResolvedValueOnce(existingBriefing);

      const result = await generateBriefing();

      expect(result).toEqual(existingBriefing);
      expect(webSearch).not.toHaveBeenCalled();
      expect(generateObject).not.toHaveBeenCalled();
      expect(saveBriefing).not.toHaveBeenCalled();
    });
  });

  describe("new briefing generation", () => {
    it("generates and saves a new briefing when none exists for today", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);

      vi.mocked(webSearch).mockResolvedValue([
        makeSearchResult("AI News", "https://ai.example.com/story", "AI content here."),
      ]);

      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      expect(result).not.toBeNull();
      expect(result!.sections).toHaveLength(4);
      expect(saveBriefing).toHaveBeenCalledTimes(1);
      expect(pruneBriefings).toHaveBeenCalledWith(30);
    });

    it("calls webSearch once per TOPIC", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([]);
      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      await generateBriefing();

      expect(webSearch).toHaveBeenCalledTimes(TOPICS.length);
    });

    it("uses 'No results available' analysis for a topic when search returns empty", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([]); // All topics return empty
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          sections: [], // No sections returned from Haiku
          summary: "Nothing to summarize.",
        },
      } as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      expect(result).not.toBeNull();
      // All sections have empty results → "No results available" fallback
      for (const section of result!.sections) {
        expect(section.analysis).toBe("No results available for this topic today.");
      }
    });

    it("handles a search failure for one topic without crashing", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);

      // First topic throws, others succeed
      vi.mocked(webSearch)
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValue([
          makeSearchResult("Tech Story", "https://tech.example.com/a", "tech content."),
        ]);

      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      expect(result).not.toBeNull();
      // First topic's section should have empty stories
      expect(result!.sections[0].stories).toHaveLength(0);
    });

    it("returns null when Haiku generateObject throws", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([]);
      vi.mocked(generateObject).mockRejectedValueOnce(new Error("Haiku rate limit"));

      const result = await generateBriefing();

      expect(result).toBeNull();
      expect(saveBriefing).not.toHaveBeenCalled();
    });

    it("continues without resonances when findResonances throws (non-fatal)", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([
        makeSearchResult("Story", "https://example.com/s", "content."),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);
      vi.mocked(findResonances).mockRejectedValueOnce(new Error("index unavailable"));
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      // Should still return a valid briefing even though resonances failed
      expect(result).not.toBeNull();
      expect(saveBriefing).toHaveBeenCalled();
    });

    it("attaches resonances to stories when findResonances returns matches", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([
        makeSearchResult("Story A", "https://example.com/a", "content A."),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);

      const resonanceMap = new Map([
        [
          0, // first story across all sections (storyIdx=0)
          [{ noteName: "Note X", notePath: "note-x.md", score: 0.85 }],
        ],
      ]);
      vi.mocked(findResonances).mockResolvedValueOnce(resonanceMap);
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      expect(result).not.toBeNull();
      // First story in first section should have resonances
      const firstSection = result!.sections[0];
      if (firstSection.stories.length > 0) {
        expect(firstSection.stories[0].resonances).toBeDefined();
        expect(firstSection.stories[0].resonances![0].noteName).toBe("Note X");
      }
    });

    it("does not set story.resonances when resonanceMap has empty array for that index", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([
        makeSearchResult("Story", "https://example.com/s", "content."),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);

      // Non-empty map but empty array for story 0
      const resonanceMap = new Map([[0, []]]);
      vi.mocked(findResonances).mockResolvedValueOnce(resonanceMap);
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      expect(result).not.toBeNull();
      const firstStory = result!.sections[0].stories[0];
      // Empty resonances array → not attached
      expect(firstStory.resonances).toBeUndefined();
    });

    it("extracts domain correctly from story URLs (strips www.)", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([
        makeSearchResult("Story", "https://www.example.com/article", "content."),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      const firstSection = result!.sections.find((s) => s.stories.length > 0);
      expect(firstSection).toBeDefined();
      expect(firstSection!.stories[0].source).toBe("example.com");
    });

    it("falls back to raw URL as source when URL is not parseable", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([
        makeSearchResult("Story", "not-a-valid-url", "content."),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      const firstSection = result!.sections.find((s) => s.stories.length > 0);
      expect(firstSection).toBeDefined();
      expect(firstSection!.stories[0].source).toBe("not-a-valid-url");
    });

    it("uses 'Analysis unavailable' fallback when topicId missing from Haiku output but results exist", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([
        makeSearchResult("Story", "https://example.com/s", "content."),
      ]);

      // Haiku returns no sections
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          sections: [],
          summary: "Overall summary.",
        },
      } as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      expect(result).not.toBeNull();
      // Each topic had results but no matching analysis → "Analysis unavailable."
      for (const section of result!.sections) {
        expect(section.analysis).toBe("Analysis unavailable.");
      }
    });

    it("caps snippet to 200 characters in the assembled story", async () => {
      const longContent = "x".repeat(500);
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([
        makeSearchResult("Story", "https://example.com/s", longContent),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce(makeHaikuOutput() as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      const firstSection = result!.sections.find((s) => s.stories.length > 0);
      expect(firstSection!.stories[0].snippet).toHaveLength(200);
    });

    it("returns the correct date and summary on the assembled Briefing", async () => {
      vi.mocked(getBriefing).mockResolvedValueOnce(null);
      vi.mocked(webSearch).mockResolvedValue([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: {
          sections: [],
          summary: "Test summary text.",
        },
      } as any);
      vi.mocked(findResonances).mockResolvedValueOnce(new Map());
      vi.mocked(saveBriefing).mockResolvedValueOnce(undefined);
      vi.mocked(pruneBriefings).mockResolvedValueOnce(undefined);

      const result = await generateBriefing();

      expect(result).not.toBeNull();
      expect(result!.summary).toBe("Test summary text.");
      expect(result!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result!.generatedAt).toBeTruthy();
    });
  });
});
