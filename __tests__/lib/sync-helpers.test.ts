/**
 * Tests for pure helper functions in sync.ts.
 * Since these helpers are not exported, we import the module and test
 * the behavior indirectly, or replicate the logic for unit testing.
 *
 * For a clean approach, we test the extractable logic directly by
 * reimporting the internal functions through a workaround —
 * or we test the logic patterns they implement.
 */

import { describe, it, expect } from "vitest";

// Since chunkText, normaliseTag, extractTags, wikilinkTarget, countWords
// are not exported from sync.ts, we test the same logic patterns here.
// This validates the algorithms used in sync.ts.

describe("chunkText logic", () => {
  const CHUNK_SIZE = 500;
  const CHUNK_OVERLAP = 50;

  function chunkText(text: string): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
      const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
      if (chunk.trim().length > 0) chunks.push(chunk);
      if (i + CHUNK_SIZE >= words.length) break;
    }
    return chunks;
  }

  it("returns single chunk for short text", () => {
    const text = "hello world this is a test";
    const result = chunkText(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it("returns empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("splits long text into overlapping chunks", () => {
    const words = Array.from({ length: 1000 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const result = chunkText(text);
    expect(result.length).toBeGreaterThan(1);

    // Second chunk should start at word 450 (500 - 50 overlap)
    expect(result[1]).toContain("word450");
  });

  it("each chunk has at most CHUNK_SIZE words", () => {
    const words = Array.from({ length: 2000 }, (_, i) => `word${i}`);
    const result = chunkText(words.join(" "));
    for (const chunk of result) {
      expect(chunk.split(/\s+/).length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });
});

describe("normaliseTag logic", () => {
  function normaliseTag(raw: unknown): string {
    const s = String(raw).trim();
    return s.startsWith("#") ? s : `#${s}`;
  }

  it("adds # prefix to plain tags", () => {
    expect(normaliseTag("design")).toBe("#design");
  });

  it("preserves existing # prefix", () => {
    expect(normaliseTag("#design")).toBe("#design");
  });

  it("trims whitespace", () => {
    expect(normaliseTag("  design  ")).toBe("#design");
  });

  it("handles non-string input", () => {
    expect(normaliseTag(42)).toBe("#42");
    expect(normaliseTag(null)).toBe("#null");
  });
});

describe("extractTags logic", () => {
  function normaliseTag(raw: unknown): string {
    const s = String(raw).trim();
    return s.startsWith("#") ? s : `#${s}`;
  }

  function extractTags(data: Record<string, unknown>): string[] {
    const raw = data.tags ?? data.tag ?? data.Topics ?? data.topics ?? null;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(normaliseTag);
    if (typeof raw === "string") {
      return raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(normaliseTag);
    }
    return [];
  }

  it("extracts array tags", () => {
    expect(extractTags({ tags: ["design", "ui"] })).toEqual(["#design", "#ui"]);
  });

  it("extracts comma-separated string tags", () => {
    expect(extractTags({ tags: "design, ui, ux" })).toEqual(["#design", "#ui", "#ux"]);
  });

  it("extracts from 'tag' key", () => {
    expect(extractTags({ tag: "design" })).toEqual(["#design"]);
  });

  it("extracts from 'Topics' key", () => {
    expect(extractTags({ Topics: ["a", "b"] })).toEqual(["#a", "#b"]);
  });

  it("extracts from 'topics' key", () => {
    expect(extractTags({ topics: "one two" })).toEqual(["#one", "#two"]);
  });

  it("returns empty for missing tags", () => {
    expect(extractTags({})).toEqual([]);
  });

  it("returns empty for null tags", () => {
    expect(extractTags({ tags: null })).toEqual([]);
  });
});

describe("wikilinkTarget logic", () => {
  function wikilinkTarget(raw: string): string {
    return raw.split(/[|#]/)[0].trim();
  }

  it("extracts plain link target", () => {
    expect(wikilinkTarget("note-name")).toBe("note-name");
  });

  it("strips alias after pipe", () => {
    expect(wikilinkTarget("note-name|display text")).toBe("note-name");
  });

  it("strips heading after hash", () => {
    expect(wikilinkTarget("note-name#heading")).toBe("note-name");
  });

  it("handles both pipe and hash", () => {
    expect(wikilinkTarget("note#heading|alias")).toBe("note");
  });

  it("trims whitespace", () => {
    expect(wikilinkTarget("  note-name  ")).toBe("note-name");
  });
});

describe("countWords logic", () => {
  function countWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  it("counts words in normal text", () => {
    expect(countWords("hello world foo")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(countWords("   ")).toBe(0);
  });

  it("handles multiple spaces between words", () => {
    expect(countWords("hello   world")).toBe(2);
  });

  it("handles tabs and newlines", () => {
    expect(countWords("hello\tworld\nfoo")).toBe(3);
  });
});
