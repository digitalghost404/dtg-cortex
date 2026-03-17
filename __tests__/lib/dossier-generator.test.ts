import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateDossier } from "@/lib/dossier-generator";

vi.mock("@/lib/indexer", () => ({
  queryIndex: vi.fn(),
}));

vi.mock("@/lib/websearch", () => ({
  webSearch: vi.fn(),
}));

vi.mock("@/lib/dossier", () => ({
  saveDossier: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-haiku-model"),
}));

import { queryIndex } from "@/lib/indexer";
import { webSearch } from "@/lib/websearch";
import { saveDossier } from "@/lib/dossier";
import { generateObject } from "ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryResult(name: string, path: string, score: number, text: string) {
  return { name, path, score, text };
}

function makeWebResult(title: string, url: string, content: string) {
  return { title, url, content, score: 0.9 };
}

function makeHaikuSynthesis() {
  return {
    vaultSummary: "The vault has relevant notes on this topic.",
    webSummary: "The web shows recent developments.",
    agreements: ["Both agree on core concepts."],
    gaps: ["Missing coverage of edge cases."],
    recommendations: ["Explore related papers."],
    suggestedTags: ["ai", "research", "llm"],
  };
}

// ---------------------------------------------------------------------------
// generateDossier
// ---------------------------------------------------------------------------

describe("generateDossier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("successful generation with vault and web findings", () => {
    it("returns a dossier with vault and web findings populated", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([
        makeQueryResult("Note A", "note-a.md", 0.95, "Note A content about AI research."),
        makeQueryResult("Note B", "note-b.md", 0.82, "Note B related context."),
      ]);
      vi.mocked(webSearch).mockResolvedValueOnce([
        makeWebResult("Web Story 1", "https://example.com/1", "Web content about AI."),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("AI research");

      expect(result.topic).toBe("AI research");
      expect(result.vaultFindings).toHaveLength(2);
      expect(result.webFindings).toHaveLength(1);
      expect(result.savedToVault).toBe(false);
    });

    it("maps vault findings with correct fields", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([
        makeQueryResult("My Note", "folder/my-note.md", 0.88, "x".repeat(400)),
      ]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("topic");

      const vf = result.vaultFindings[0];
      expect(vf.noteName).toBe("My Note");
      expect(vf.notePath).toBe("folder/my-note.md");
      expect(vf.score).toBe(0.88);
      // excerpt should be capped at 300 chars
      expect(vf.excerpt).toHaveLength(300);
    });

    it("maps web findings with correct fields, extracting domain", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([
        makeWebResult("Article", "https://www.techcrunch.com/article", "y".repeat(400)),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("tech topic");

      const wf = result.webFindings[0];
      expect(wf.title).toBe("Article");
      expect(wf.url).toBe("https://www.techcrunch.com/article");
      expect(wf.source).toBe("techcrunch.com"); // www. stripped
      // snippet capped at 300 chars
      expect(wf.snippet).toHaveLength(300);
    });

    it("falls back to raw URL as source when URL is invalid", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([
        makeWebResult("Article", "not-valid-url", "content"),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("tech topic");

      expect(result.webFindings[0].source).toBe("not-valid-url");
    });

    it("assigns synthesis fields from Haiku output", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("quantum computing");

      expect(result.synthesis.vaultSummary).toBe(
        "The vault has relevant notes on this topic."
      );
      expect(result.synthesis.webSummary).toBe("The web shows recent developments.");
      expect(result.synthesis.agreements).toEqual(["Both agree on core concepts."]);
      expect(result.synthesis.gaps).toEqual(["Missing coverage of edge cases."]);
      expect(result.synthesis.recommendations).toEqual(["Explore related papers."]);
      expect(result.suggestedTags).toEqual(["ai", "research", "llm"]);
    });

    it("calls saveDossier with the assembled dossier", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("topic");

      expect(saveDossier).toHaveBeenCalledTimes(1);
      const savedArg = vi.mocked(saveDossier).mock.calls[0][0];
      expect(savedArg.id).toMatch(/^dos_/);
      expect(savedArg.topic).toBe("topic");
    });

    it("generates a unique id starting with dos_", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("unique test");

      expect(result.id).toMatch(/^dos_/);
      expect(result.id.length).toBeGreaterThan(5);
    });

    it("sets createdAt to a valid ISO string", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const before = new Date().toISOString();
      const result = await generateDossier("topic");
      const after = new Date().toISOString();

      expect(result.createdAt >= before).toBe(true);
      expect(result.createdAt <= after).toBe(true);
    });
  });

  describe("empty vault findings — queryIndex throws", () => {
    it("proceeds with empty vaultFindings and still generates dossier", async () => {
      vi.mocked(queryIndex).mockRejectedValueOnce(new Error("Index not built yet."));
      vi.mocked(webSearch).mockResolvedValueOnce([
        makeWebResult("Web Story", "https://example.com/s", "web content"),
      ]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("topic");

      expect(result.vaultFindings).toHaveLength(0);
      expect(result.webFindings).toHaveLength(1);
      expect(result.topic).toBe("topic");
    });

    it("builds prompt with 'No relevant vault notes found.' when vault is empty", async () => {
      vi.mocked(queryIndex).mockRejectedValueOnce(new Error("Index not built."));
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      await generateDossier("topic");

      const callArg = vi.mocked(generateObject).mock.calls[0][0] as any;
      expect(callArg.prompt).toContain("No relevant vault notes found.");
    });
  });

  describe("empty web findings — webSearch throws", () => {
    it("proceeds with empty webFindings and still generates dossier", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([
        makeQueryResult("Note A", "a.md", 0.9, "vault content"),
      ]);
      vi.mocked(webSearch).mockRejectedValueOnce(new Error("network error"));
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("topic");

      expect(result.webFindings).toHaveLength(0);
      expect(result.vaultFindings).toHaveLength(1);
    });

    it("builds prompt with 'No web results found.' when web is empty", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockRejectedValueOnce(new Error("timeout"));
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      await generateDossier("topic");

      const callArg = vi.mocked(generateObject).mock.calls[0][0] as any;
      expect(callArg.prompt).toContain("No web results found.");
    });
  });

  describe("both vault and web fail", () => {
    it("generates a dossier with empty findings when both sources fail", async () => {
      vi.mocked(queryIndex).mockRejectedValueOnce(new Error("vault down"));
      vi.mocked(webSearch).mockRejectedValueOnce(new Error("web down"));
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      const result = await generateDossier("topic");

      expect(result.vaultFindings).toHaveLength(0);
      expect(result.webFindings).toHaveLength(0);
      expect(saveDossier).toHaveBeenCalled();
    });
  });

  describe("Haiku prompt construction", () => {
    it("includes the topic in the prompt", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      await generateDossier("distributed systems");

      const callArg = vi.mocked(generateObject).mock.calls[0][0] as any;
      expect(callArg.prompt).toContain("distributed systems");
    });

    it("includes vault note names and scores in the prompt when findings exist", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([
        makeQueryResult("Graph Theory Note", "gt.md", 0.92, "Graph theory content"),
      ]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      await generateDossier("graph theory");

      const callArg = vi.mocked(generateObject).mock.calls[0][0] as any;
      expect(callArg.prompt).toContain("Graph Theory Note");
      expect(callArg.prompt).toContain("0.92");
    });

    it("calls queryIndex with topic and topK=8", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      await generateDossier("my topic");

      expect(queryIndex).toHaveBeenCalledWith("my topic", 8);
    });

    it("calls webSearch with topic and maxResults=5", async () => {
      vi.mocked(queryIndex).mockResolvedValueOnce([]);
      vi.mocked(webSearch).mockResolvedValueOnce([]);
      vi.mocked(generateObject).mockResolvedValueOnce({
        object: makeHaikuSynthesis(),
      } as any);
      vi.mocked(saveDossier).mockResolvedValueOnce(undefined);

      await generateDossier("my topic");

      expect(webSearch).toHaveBeenCalledWith("my topic", 5);
    });
  });
});
